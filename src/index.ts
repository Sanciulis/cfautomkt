import { Hono } from 'hono'

type InteractionEvent =
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'shared'
  | 'converted'
  | 'referral_click'
  | 'personalized'
  | 'send_failed'

type AIResponse = {
  response?: unknown
  result?: unknown
}

type Bindings = {
  DB: D1Database
  MARTECH_KV: KVNamespace
  AI: {
    run: (model: string, input: unknown) => Promise<AIResponse>
  }
  LANDING_PAGE_URL?: string
  APP_ENV?: string
  DISPATCH_WEBHOOK_URL?: string
  PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST?: string
  WHATSAPP_WEBHOOK_URL?: string
  EMAIL_WEBHOOK_URL?: string
  TELEGRAM_WEBHOOK_URL?: string
  DISPATCH_BEARER_TOKEN?: string
  ADMIN_API_KEY?: string
  ADMIN_PANEL_PASSWORD?: string
  ADMIN_SESSION_SECRET?: string
}

type UserRecord = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  preferred_channel: string
  psychological_profile: string
  engagement_score: number
  referral_code: string | null
  referred_by: string | null
  viral_points: number
  marketing_opt_in?: number | null
  opt_out_at?: string | null
  consent_source?: string | null
  consent_updated_at?: string | null
  last_active: string
  created_at: string
}

type CampaignRecord = {
  id: string
  name: string
  base_copy: string
  incentive_offer: string | null
  channel: string
  status: 'active' | 'paused'
}

type InteractionPayload = {
  userId: string
  eventType: InteractionEvent
  campaignId?: string | null
  channel?: string
  metadata?: unknown
}

type DispatchRequestBody = {
  userIds?: string[]
  limit?: number
  personalize?: boolean
  dryRun?: boolean
  channel?: string
  webhookUrlOverride?: string
  metadata?: unknown
  includeInactive?: boolean
  force?: boolean
}

type CampaignCreateInput = {
  id?: string | null
  name: string
  baseCopy: string
  incentiveOffer?: string | null
  channel?: string | null
}

type DispatchResult = {
  status: 'success'
  campaignId: string
  channel: string
  dryRun: boolean
  requested: number
  sent: number
  failed: number
  skipped: number
  failures: Array<{ userId: string; reason: string; status?: number }>
}

type DispatchErrorStatus = 400 | 404 | 409 | 500

type AdminLoginThrottleState = {
  failures: number
  windowStartedAt: number
  blockedUntil: number
}

type AdminWhatsAppIntegrationConfig = {
  webhookUrl: string | null
  testPhone: string | null
  testMessage: string | null
  updatedAt: string | null
}

const EVENT_WEIGHTS: Record<InteractionEvent, number> = {
  sent: 0.25,
  opened: 1,
  clicked: 2,
  shared: 3,
  converted: 5,
  referral_click: 1,
  personalized: 1.5,
  send_failed: 0,
}

const DEFAULT_LANDING_PAGE = 'https://fluxoia.com/inscricao'
const DEFAULT_AI_MODEL = '@cf/meta/llama-3-8b-instruct'
const DEFAULT_PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST = ['httpbin.org']
const ADMIN_SESSION_COOKIE = 'martech_admin_session'
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12
const ADMIN_LOGIN_WINDOW_SECONDS = 60 * 10
const ADMIN_LOGIN_MAX_FAILURES = 5
const ADMIN_LOGIN_BLOCK_SECONDS = 60 * 15
const ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY = 'admin_config:integration:whatsapp'
const DEFAULT_WHATSAPP_TEST_MESSAGE =
  'Mensagem de teste do painel admin. Se voce recebeu isso, a integracao esta funcionando.'

const app = new Hono<{ Bindings: Bindings }>()

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isInteractionEvent(value: unknown): value is InteractionEvent {
  return (
    value === 'sent' ||
    value === 'opened' ||
    value === 'clicked' ||
    value === 'shared' ||
    value === 'converted' ||
    value === 'referral_click' ||
    value === 'personalized' ||
    value === 'send_failed'
  )
}

function buildReferralCode(userId: string): string {
  const compact = userId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8)
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  return `${compact || 'user'}${suffix}`
}

function buildReferralRedirect(baseUrl: string, referralCode: string): string {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('ref', referralCode)
    return url.toString()
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}ref=${encodeURIComponent(referralCode)}`
  }
}

async function hashValue(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function extractAIText(aiResponse: AIResponse): string {
  if (typeof aiResponse.response === 'string') return aiResponse.response
  if (typeof aiResponse.result === 'string') return aiResponse.result
  return ''
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function resolveDispatchUrl(channel: string, env: Bindings): string | null {
  const normalizedChannel = channel.toLowerCase()
  if (normalizedChannel === 'whatsapp') return env.WHATSAPP_WEBHOOK_URL ?? env.DISPATCH_WEBHOOK_URL ?? null
  if (normalizedChannel === 'email') return env.EMAIL_WEBHOOK_URL ?? env.DISPATCH_WEBHOOK_URL ?? null
  if (normalizedChannel === 'telegram') return env.TELEGRAM_WEBHOOK_URL ?? env.DISPATCH_WEBHOOK_URL ?? null
  return env.DISPATCH_WEBHOOK_URL ?? null
}

function getPreviewWebhookOverrideAllowlist(env: Bindings): string[] {
  const raw = safeString(env.PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST)
  if (!raw) return DEFAULT_PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

function isHostAllowed(hostname: string, allowlist: string[]): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  return allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      const baseDomain = entry.slice(2)
      if (!baseDomain) return false
      return normalized === baseDomain || normalized.endsWith(`.${baseDomain}`)
    }
    return normalized === entry
  })
}

function validatePreviewWebhookOverrideUrl(
  overrideUrl: string,
  env: Bindings
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(overrideUrl)
  } catch {
    return { ok: false, error: 'webhookUrlOverride must be a valid URL' }
  }

  if (parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'webhookUrlOverride must use https://' }
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: 'webhookUrlOverride cannot contain URL credentials' }
  }

  const allowlist = getPreviewWebhookOverrideAllowlist(env)
  if (!isHostAllowed(parsedUrl.hostname, allowlist)) {
    return {
      ok: false,
      error:
        'webhookUrlOverride host is not allowlisted for preview. Configure PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST.',
    }
  }

  return { ok: true, normalizedUrl: parsedUrl.toString() }
}

async function generatePersonalizedMessage(
  env: Bindings,
  user: UserRecord,
  baseCopy: string,
  channel: string
): Promise<string> {
  const prompt = `
Generate a ${channel} marketing message in Brazilian Portuguese.
User profile:
- preferred_channel: ${user.preferred_channel}
- psychological_profile: ${user.psychological_profile}
- engagement_score: ${user.engagement_score}
- viral_points: ${user.viral_points}

Rules:
- max 400 characters
- include urgency and a clear CTA
- keep human tone and concise
- do not use fake claims

Base copy: "${baseCopy}"
  `.trim()

  const aiResult = await env.AI.run(DEFAULT_AI_MODEL, {
    messages: [
      {
        role: 'system',
        content: 'You are a senior conversion copywriter specialized in multichannel campaigns.',
      },
      { role: 'user', content: prompt },
    ],
  })

  return (
    extractAIText(aiResult) ||
    `Oferta exclusiva para voce. ${baseCopy} Clique no link e aproveite agora.`
  )
}

async function getUserById(env: Bindings, id: string): Promise<UserRecord | null> {
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRecord>()
  return user ?? null
}

async function logInteraction(env: Bindings, payload: InteractionPayload): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO interactions (user_id, campaign_id, channel, event_type, metadata) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(
      payload.userId,
      payload.campaignId ?? null,
      payload.channel ?? 'whatsapp',
      payload.eventType,
      payload.metadata ? JSON.stringify(payload.metadata) : null
    )
    .run()

  await env.DB.prepare(
    'UPDATE users SET engagement_score = engagement_score + ?, last_active = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind(EVENT_WEIGHTS[payload.eventType], payload.userId)
    .run()
}

async function logAgentDecision(
  env: Bindings,
  decisionType: string,
  targetId: string,
  reason: string,
  payload: unknown
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO agent_decisions (decision_type, target_id, reason, payload) VALUES (?, ?, ?, ?)'
  )
    .bind(decisionType, targetId, reason, payload ? JSON.stringify(payload) : null)
    .run()
}

function extractApiKeyFromRequest(request: Request): string | null {
  const direct = request.headers.get('x-api-key')
  if (direct && direct.trim().length > 0) return direct.trim()

  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  const token = match[1]?.trim()
  return token && token.length > 0 ? token : null
}

function ensureAdminAccess(c: { env: Bindings; req: { raw: Request }; json: (obj: unknown, status?: number) => Response }): Response | null {
  const configuredKey = safeString(c.env.ADMIN_API_KEY)
  if (!configuredKey) return null

  const providedKey = extractApiKeyFromRequest(c.req.raw)
  if (!providedKey || providedKey !== configuredKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return null
}

function parseCookies(rawCookie: string | null): Record<string, string> {
  if (!rawCookie) return {}
  const entries = rawCookie
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const separatorIndex = chunk.indexOf('=')
      if (separatorIndex < 0) return null
      const key = chunk.slice(0, separatorIndex).trim()
      const value = chunk.slice(separatorIndex + 1).trim()
      return [key, value] as const
    })
    .filter((item): item is readonly [string, string] => item !== null)
  return Object.fromEntries(entries)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function getAdminPanelPassword(env: Bindings): string | null {
  return safeString(env.ADMIN_PANEL_PASSWORD) ?? safeString(env.ADMIN_API_KEY)
}

function getAdminSessionSecret(env: Bindings): string | null {
  return safeString(env.ADMIN_SESSION_SECRET) ?? safeString(env.ADMIN_API_KEY)
}

async function createAdminSessionToken(secret: string): Promise<string> {
  const timestamp = `${Date.now()}`
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const payload = `${timestamp}.${nonce}`
  const signature = await hmacSha256Hex(secret, payload)
  return `${payload}.${signature}`
}

async function validateAdminSessionToken(secret: string, token: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [timestamp, nonce, signature] = parts
  if (!timestamp || !nonce || !signature) return false

  const issuedAt = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(issuedAt)) return false

  const now = Date.now()
  if (issuedAt > now) return false
  if (now - issuedAt > ADMIN_SESSION_TTL_SECONDS * 1000) return false

  const expected = await hmacSha256Hex(secret, `${timestamp}.${nonce}`)
  return constantTimeEqual(signature, expected)
}

function setAdminSessionCookie(c: { header: (name: string, value: string) => void }, token: string): void {
  c.header(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}`
  )
}

function clearAdminSessionCookie(c: { header: (name: string, value: string) => void }): void {
  c.header(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
  )
}

async function hasValidAdminSession(c: { env: Bindings; req: { raw: Request } }): Promise<boolean> {
  const secret = getAdminSessionSecret(c.env)
  if (!secret) return false
  const cookies = parseCookies(c.req.raw.headers.get('Cookie'))
  const token = safeString(cookies[ADMIN_SESSION_COOKIE])
  if (!token) return false
  return validateAdminSessionToken(secret, token)
}

async function ensureAdminSession(c: {
  env: Bindings
  req: { raw: Request }
  json: (obj: unknown, status?: number) => Response
}): Promise<Response | null> {
  const valid = await hasValidAdminSession(c)
  if (!valid) return c.json({ error: 'Unauthorized' }, 401)
  return null
}

function getRequesterIp(request: Request): string {
  const cfIp = safeString(request.headers.get('CF-Connecting-IP'))
  if (cfIp) return cfIp
  const forwarded = safeString(request.headers.get('X-Forwarded-For'))
  if (!forwarded) return 'unknown'
  const first = forwarded
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  return first ?? 'unknown'
}

function getAdminLoginThrottleKey(ip: string): string {
  return `admin_login_throttle:${ip}`
}

async function readAdminLoginThrottleState(
  kv: KVNamespace,
  ip: string
): Promise<AdminLoginThrottleState | null> {
  const raw = await kv.get(getAdminLoginThrottleKey(ip))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AdminLoginThrottleState>
    const failures = toNumber(parsed.failures)
    const windowStartedAt = toNumber(parsed.windowStartedAt)
    const blockedUntil = toNumber(parsed.blockedUntil)
    if (!Number.isFinite(failures) || !Number.isFinite(windowStartedAt) || !Number.isFinite(blockedUntil)) {
      return null
    }
    return {
      failures: Math.max(0, Math.floor(failures)),
      windowStartedAt: Math.max(0, Math.floor(windowStartedAt)),
      blockedUntil: Math.max(0, Math.floor(blockedUntil)),
    }
  } catch {
    return null
  }
}

function buildAdminLoginThrottleTtlSeconds(state: AdminLoginThrottleState, now: number): number {
  const windowTtl = ADMIN_LOGIN_WINDOW_SECONDS + 60
  if (state.blockedUntil <= now) return windowTtl
  const blockedFor = Math.ceil((state.blockedUntil - now) / 1000)
  return Math.max(windowTtl, blockedFor + 60)
}

async function checkAdminLoginThrottle(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const now = Date.now()
  const state = await readAdminLoginThrottleState(kv, ip)
  if (!state) return { allowed: true }

  if (state.blockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000))
    return { allowed: false, retryAfterSeconds }
  }

  if (now - state.windowStartedAt > ADMIN_LOGIN_WINDOW_SECONDS * 1000) {
    await kv.delete(getAdminLoginThrottleKey(ip))
  }

  return { allowed: true }
}

async function recordAdminLoginFailure(kv: KVNamespace, ip: string): Promise<void> {
  const now = Date.now()
  const existing = await readAdminLoginThrottleState(kv, ip)
  const withinWindow =
    existing !== null && now - existing.windowStartedAt <= ADMIN_LOGIN_WINDOW_SECONDS * 1000

  const state: AdminLoginThrottleState = withinWindow
    ? {
        failures: existing.failures + 1,
        windowStartedAt: existing.windowStartedAt,
        blockedUntil: existing.blockedUntil,
      }
    : {
        failures: 1,
        windowStartedAt: now,
        blockedUntil: 0,
      }

  if (state.failures >= ADMIN_LOGIN_MAX_FAILURES) {
    state.blockedUntil = now + ADMIN_LOGIN_BLOCK_SECONDS * 1000
    state.failures = 0
    state.windowStartedAt = now
  }

  await kv.put(getAdminLoginThrottleKey(ip), JSON.stringify(state), {
    expirationTtl: buildAdminLoginThrottleTtlSeconds(state, now),
  })
}

async function clearAdminLoginThrottle(kv: KVNamespace, ip: string): Promise<void> {
  await kv.delete(getAdminLoginThrottleKey(ip))
}

function isUserOptedOut(user: UserRecord): boolean {
  if (typeof user.marketing_opt_in === 'number') return user.marketing_opt_in === 0
  if (typeof user.marketing_opt_in === 'string') {
    const parsed = Number(user.marketing_opt_in)
    return Number.isFinite(parsed) ? parsed === 0 : false
  }
  return false
}

function resolveConsentSource(rawSource: unknown, fallback: string): string {
  return safeString(rawSource) ?? fallback
}

async function setUserMarketingConsent(
  env: Bindings,
  userId: string,
  marketingOptIn: boolean,
  consentSource: string
): Promise<{ updated: boolean; user: UserRecord | null }> {
  const existing = await getUserById(env, userId)
  if (!existing) return { updated: false, user: null }

  const normalizedSource = resolveConsentSource(consentSource, 'admin_api')
  if (marketingOptIn) {
    await env.DB.prepare(
      `UPDATE users
       SET marketing_opt_in = 1,
           opt_out_at = NULL,
           consent_source = ?,
           consent_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(normalizedSource, userId)
      .run()
  } else {
    await env.DB.prepare(
      `UPDATE users
       SET marketing_opt_in = 0,
           opt_out_at = CURRENT_TIMESTAMP,
           consent_source = ?,
           consent_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(normalizedSource, userId)
      .run()
  }

  const updated = await getUserById(env, userId)
  return { updated: true, user: updated }
}

function renderUnsubscribePage(data: {
  title: string
  message: string
  success: boolean
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(data.title)}</title>
  <style>
    :root {
      --bg: #f4f7f9;
      --panel: #ffffff;
      --ink: #1a2228;
      --ok-bg: #e7f7ef;
      --ok-ink: #16653f;
      --err-bg: #fde9e9;
      --err-ink: #9f1c1c;
      --line: #d8e0e8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: Arial, sans-serif;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    main {
      width: min(520px, 100%);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 22px;
    }
    h1 { margin: 0 0 10px 0; font-size: 1.4rem; }
    p {
      margin: 0;
      padding: 10px 12px;
      border-radius: 10px;
      background: ${data.success ? 'var(--ok-bg)' : 'var(--err-bg)'};
      color: ${data.success ? 'var(--ok-ink)' : 'var(--err-ink)'};
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(data.title)}</h1>
    <p>${escapeHtml(data.message)}</p>
  </main>
</body>
</html>`
}

async function createUserRecord(
  env: Bindings,
  input: Partial<{
    id: string
    name: string
    email: string
    phone: string
    preferredChannel: string
    psychologicalProfile: string
    referredBy: string
    marketingOptIn: boolean | string
    consentSource: string
  }>
): Promise<{ userId: string; referralCode: string }> {
  const userId = safeString(input.id) ?? crypto.randomUUID()
  const name = safeString(input.name)
  const email = safeString(input.email)
  const phone = safeString(input.phone)
  const preferredChannel = safeString(input.preferredChannel) ?? 'whatsapp'
  const psychologicalProfile = safeString(input.psychologicalProfile) ?? 'generic'
  const referredBy = safeString(input.referredBy)
  const marketingOptIn = toBoolean(input.marketingOptIn, true)
  const consentSource = resolveConsentSource(input.consentSource, 'api_create')
  const referralCode = buildReferralCode(userId)

  await env.DB.prepare(
    `INSERT INTO users (
      id, name, email, phone, preferred_channel, psychological_profile, referral_code, referred_by,
      marketing_opt_in, opt_out_at, consent_source, consent_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  )
    .bind(
      userId,
      name,
      email,
      phone,
      preferredChannel,
      psychologicalProfile,
      referralCode,
      referredBy,
      marketingOptIn ? 1 : 0,
      marketingOptIn ? null : new Date().toISOString(),
      consentSource
    )
    .run()

  return { userId, referralCode }
}

async function createCampaignRecord(env: Bindings, input: CampaignCreateInput): Promise<string> {
  const campaignId = safeString(input.id) ?? crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO campaigns (id, name, base_copy, incentive_offer, channel)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      campaignId,
      safeString(input.name),
      safeString(input.baseCopy),
      safeString(input.incentiveOffer),
      safeString(input.channel) ?? 'whatsapp'
    )
    .run()
  return campaignId
}

async function getOverviewMetrics(env: Bindings): Promise<{
  totals: {
    users: number
    interactions: number
    sent: number
    conversions: number
    shares: number
    activeCampaigns: number
  }
  metrics: {
    conversionRate: number
    kFactor: number
  }
  topReferrers: Array<{ id: string; viral_points: number }>
}> {
  const [
    totalUsersRow,
    totalInteractionsRow,
    sentRow,
    conversionsRow,
    sharesRow,
    activeCampaignsRow,
    topReferrersResult,
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS value FROM users').first<{ value: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS value FROM interactions').first<{ value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM interactions WHERE event_type = 'sent'").first<{
      value: number
    }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM interactions WHERE event_type = 'converted'").first<{
      value: number
    }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM interactions WHERE event_type IN ('shared', 'referral_click')"
    ).first<{ value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM campaigns WHERE status = 'active'").first<{
      value: number
    }>(),
    env.DB.prepare(
      'SELECT id, viral_points FROM users WHERE viral_points > 0 ORDER BY viral_points DESC LIMIT 5'
    ).all<{ id: string; viral_points: number }>(),
  ])

  const totalUsers = toNumber(totalUsersRow?.value)
  const totalInteractions = toNumber(totalInteractionsRow?.value)
  const totalSent = toNumber(sentRow?.value)
  const totalConversions = toNumber(conversionsRow?.value)
  const totalShares = toNumber(sharesRow?.value)
  const activeCampaigns = toNumber(activeCampaignsRow?.value)

  const conversionRate = totalSent > 0 ? totalConversions / totalSent : 0
  const kFactor = totalShares > 0 ? totalConversions / totalShares : 0

  return {
    totals: {
      users: totalUsers,
      interactions: totalInteractions,
      sent: totalSent,
      conversions: totalConversions,
      shares: totalShares,
      activeCampaigns,
    },
    metrics: {
      conversionRate,
      kFactor,
    },
    topReferrers: topReferrersResult.results ?? [],
  }
}

function buildAdminRedirect(notice: string, kind: 'success' | 'error' = 'success'): string {
  return `/admin?notice=${encodeURIComponent(notice)}&kind=${encodeURIComponent(kind)}`
}

function validateAdminIntegrationWebhookUrl(
  value: string,
  env: Bindings
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    return { ok: false, error: 'Webhook URL invalida.' }
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { ok: false, error: 'Webhook URL deve usar http:// ou https://.' }
  }

  if ((env.APP_ENV ?? '').toLowerCase() === 'production' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'Em producao, webhook URL deve usar https://.' }
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: 'Webhook URL nao pode conter credenciais.' }
  }

  return { ok: true, normalizedUrl: parsedUrl.toString() }
}

function normalizeWhatsAppIntegrationConfig(input: unknown, env: Bindings): AdminWhatsAppIntegrationConfig {
  const defaultsWebhook =
    safeString(env.WHATSAPP_WEBHOOK_URL) ?? safeString(env.DISPATCH_WEBHOOK_URL) ?? null

  if (!input || typeof input !== 'object') {
    return {
      webhookUrl: defaultsWebhook,
      testPhone: null,
      testMessage: DEFAULT_WHATSAPP_TEST_MESSAGE,
      updatedAt: null,
    }
  }

  const parsed = input as Partial<AdminWhatsAppIntegrationConfig>
  return {
    webhookUrl: safeString(parsed.webhookUrl) ?? defaultsWebhook,
    testPhone: safeString(parsed.testPhone),
    testMessage: safeString(parsed.testMessage) ?? DEFAULT_WHATSAPP_TEST_MESSAGE,
    updatedAt: safeString(parsed.updatedAt),
  }
}

async function getAdminWhatsAppIntegrationConfig(env: Bindings): Promise<AdminWhatsAppIntegrationConfig> {
  const raw = await env.MARTECH_KV.get(ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY)
  if (!raw) return normalizeWhatsAppIntegrationConfig(null, env)

  try {
    const parsed = JSON.parse(raw)
    return normalizeWhatsAppIntegrationConfig(parsed, env)
  } catch {
    return normalizeWhatsAppIntegrationConfig(null, env)
  }
}

async function saveAdminWhatsAppIntegrationConfig(
  env: Bindings,
  config: AdminWhatsAppIntegrationConfig
): Promise<void> {
  await env.MARTECH_KV.put(ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY, JSON.stringify(config))
}

function renderAdminLoginPage(message?: string): string {
  const messageHtml = message
    ? `<p class="notice">${escapeHtml(message)}</p>`
    : '<p class="hint">Use sua senha administrativa para entrar.</p>'
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Martech Admin Login</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
    :root {
      --bg: #f7f4ea;
      --panel: #fffdf6;
      --ink: #192126;
      --muted: #5d666d;
      --accent: #005f5a;
      --accent-soft: #d6f0ee;
      --danger: #b42318;
      --line: #d7d8cf;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 10% 10%, #d6f0ee 0%, transparent 40%),
        radial-gradient(circle at 90% 90%, #f0e7d3 0%, transparent 38%),
        var(--bg);
      color: var(--ink);
      font-family: 'Space Grotesk', sans-serif;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(480px, 100%);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 20px 55px rgba(0, 0, 0, 0.12);
    }
    h1 {
      margin: 0 0 6px 0;
      font-size: 1.55rem;
      letter-spacing: 0.02em;
    }
    .subtitle {
      margin: 0 0 14px 0;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .notice, .hint {
      margin: 0 0 16px 0;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.92rem;
    }
    .notice {
      background: #fde8e8;
      color: var(--danger);
      border: 1px solid #f9c8c8;
    }
    .hint {
      background: var(--accent-soft);
      color: var(--accent);
      border: 1px solid #b7e2de;
    }
    label {
      display: block;
      font-size: 0.9rem;
      margin-bottom: 8px;
    }
    input[type="password"] {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      font: inherit;
      background: #ffffff;
    }
    button {
      width: 100%;
      margin-top: 14px;
      border: none;
      border-radius: 10px;
      background: var(--accent);
      color: #fff;
      padding: 12px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Martech Admin</h1>
    <p class="subtitle">Acesso protegido para operacao de campanhas.</p>
    ${messageHtml}
    <form method="post" action="/admin/login">
      <label for="password">Senha administrativa</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Entrar</button>
    </form>
  </main>
</body>
</html>`
}

function renderAdminDashboardPage(data: {
  notice: string | null
  noticeKind: string | null
  totals: {
    users: number
    interactions: number
    sent: number
    conversions: number
    shares: number
    activeCampaigns: number
  }
  metrics: {
    conversionRate: number
    kFactor: number
  }
  whatsappIntegration: {
    webhookUrl: string | null
    testPhone: string | null
    testMessage: string | null
    updatedAt: string | null
    dispatchTokenConfigured: boolean
  }
  campaigns: Array<{ id: string; name: string; channel: string; status: string; updated_at: string }>
  decisions: Array<{ decision_type: string; target_id: string | null; reason: string; created_at: string }>
}): string {
  const noticeHtml =
    data.notice && data.noticeKind
      ? `<p class="notice ${data.noticeKind === 'error' ? 'error' : 'success'}">${escapeHtml(data.notice)}</p>`
      : ''

  const campaignsHtml = data.campaigns
    .map(
      (campaign) =>
        `<tr><td>${escapeHtml(campaign.id)}</td><td>${escapeHtml(campaign.name)}</td><td>${escapeHtml(campaign.channel)}</td><td>${escapeHtml(campaign.status)}</td><td>${escapeHtml(campaign.updated_at ?? '-')}</td></tr>`
    )
    .join('')

  const decisionsHtml = data.decisions
    .map(
      (decision) =>
        `<li><strong>${escapeHtml(decision.decision_type)}</strong> - ${escapeHtml(decision.reason)} <span>(${escapeHtml(decision.created_at)})</span></li>`
    )
    .join('')

  const whatsappWebhookUrl = escapeHtml(data.whatsappIntegration.webhookUrl ?? '')
  const whatsappTestPhone = escapeHtml(data.whatsappIntegration.testPhone ?? '')
  const whatsappTestMessage = escapeHtml(data.whatsappIntegration.testMessage ?? DEFAULT_WHATSAPP_TEST_MESSAGE)
  const whatsappUpdatedAtLabel = data.whatsappIntegration.updatedAt
    ? `Atualizado em ${data.whatsappIntegration.updatedAt}`
    : 'Sem configuracao salva ainda.'
  const dispatchTokenStatus = data.whatsappIntegration.dispatchTokenConfigured
    ? '<span class="status-pill status-ok">DISPATCH_BEARER_TOKEN configurado</span>'
    : '<span class="status-pill status-warn">DISPATCH_BEARER_TOKEN nao configurado</span>'

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Martech Admin</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
    :root {
      --bg: #f4f7f9;
      --panel: #ffffff;
      --ink: #141b22;
      --muted: #64707b;
      --line: #d8e0e8;
      --accent: #0a7f78;
      --accent-dark: #085e59;
      --ok-bg: #e7f7ef;
      --ok-ink: #17663f;
      --err-bg: #fde9e9;
      --err-ink: #9f1c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 0% 0%, #d6f2f0 0%, transparent 32%),
        radial-gradient(circle at 100% 100%, #e8eef8 0%, transparent 34%),
        var(--bg);
      color: var(--ink);
      font-family: 'Space Grotesk', sans-serif;
      padding: 20px;
    }
    .layout {
      max-width: 1180px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .topbar {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    .menu {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      position: sticky;
      top: 12px;
      z-index: 4;
      box-shadow: 0 8px 24px rgba(20, 27, 34, 0.08);
    }
    .menu a {
      text-decoration: none;
      color: var(--accent-dark);
      border: 1px solid #c2d4d3;
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 0.86rem;
      font-weight: 700;
      background: #eef8f7;
      transition: all 0.2s ease;
    }
    .menu a:hover {
      background: #d8f1ef;
      border-color: #8dc6c1;
    }
    h1 { margin: 0; font-size: 1.5rem; }
    .muted { color: var(--muted); font-size: 0.9rem; margin-top: 4px; }
    .notice {
      padding: 10px 12px;
      border-radius: 10px;
      margin: 0;
      border: 1px solid transparent;
    }
    .notice.success { background: var(--ok-bg); color: var(--ok-ink); border-color: #b5e7cc; }
    .notice.error { background: var(--err-bg); color: var(--err-ink); border-color: #f7c3c3; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
    }
    .card small { color: var(--muted); }
    .card strong { font-size: 1.4rem; display: block; margin-top: 6px; }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 980px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }
    form, table, .log {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
    }
    form h2, .panel-title { margin: 0 0 10px 0; font-size: 1rem; }
    .field {
      display: grid;
      gap: 5px;
      margin-bottom: 10px;
    }
    .field input, .field select, .field textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      font: inherit;
    }
    .field textarea {
      min-height: 88px;
      resize: vertical;
    }
    .row {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr;
    }
    @media (min-width: 760px) { .row { grid-template-columns: 1fr 1fr; } }
    button {
      border: none;
      border-radius: 9px;
      background: var(--accent);
      color: #fff;
      padding: 10px 12px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button.secondary { background: #5f6b76; }
    .helper { color: var(--muted); font-size: 0.85rem; margin: 0 0 10px 0; line-height: 1.35; }
    .status-pill {
      display: inline-block;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 0.8rem;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .status-ok { background: #e7f7ef; color: #17663f; border: 1px solid #b5e7cc; }
    .status-warn { background: #fff4e5; color: #8b5d14; border: 1px solid #efd7b2; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .actions button { flex: 1; min-width: 190px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eef2f6; font-size: 0.92rem; }
    th { color: var(--muted); font-weight: 600; }
    ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; }
    .logout { display: inline; }
    .anchor-target { scroll-margin-top: 92px; }
  </style>
</head>
<body>
  <main class="layout">
    <section class="topbar">
      <div>
        <h1>Martech Admin</h1>
        <p class="muted">Painel operacional com autenticacao por sessao segura.</p>
      </div>
      <form class="logout" method="post" action="/admin/logout">
        <button class="secondary" type="submit">Sair</button>
      </form>
    </section>
    ${noticeHtml}
    <nav class="menu" aria-label="Menu admin">
      <a href="#visao-geral">Visao geral</a>
      <a href="#usuarios">Usuarios</a>
      <a href="#campanhas">Campanhas</a>
      <a href="#disparo">Disparo</a>
      <a href="#integracao">Config. integracao</a>
      <a href="#integracao-teste">Teste integracao</a>
      <a href="#agente">Agente</a>
      <a href="#lista-campanhas">Lista de campanhas</a>
    </nav>
    <section id="visao-geral" class="cards anchor-target">
      <article class="card"><small>Usuarios</small><strong>${data.totals.users}</strong></article>
      <article class="card"><small>Interacoes</small><strong>${data.totals.interactions}</strong></article>
      <article class="card"><small>Envios</small><strong>${data.totals.sent}</strong></article>
      <article class="card"><small>Conversoes</small><strong>${data.totals.conversions}</strong></article>
      <article class="card"><small>K-factor</small><strong>${data.metrics.kFactor.toFixed(2)}</strong></article>
      <article class="card"><small>Campanhas ativas</small><strong>${data.totals.activeCampaigns}</strong></article>
    </section>
    <section class="grid">
      <form id="usuarios" class="anchor-target" method="post" action="/admin/actions/user/create">
        <h2>Criar Usuario</h2>
        <div class="row">
          <label class="field"><span>ID (opcional)</span><input name="id" /></label>
          <label class="field"><span>Nome</span><input name="name" required /></label>
        </div>
        <div class="row">
          <label class="field"><span>Email</span><input name="email" type="email" /></label>
          <label class="field"><span>Telefone</span><input name="phone" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Canal preferido</span>
            <select name="preferredChannel">
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
              <option value="telegram">telegram</option>
              <option value="sms">sms</option>
            </select>
          </label>
          <label class="field"><span>Perfil psicologico</span><input name="psychologicalProfile" value="generic" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Consentimento marketing</span>
            <select name="marketingOptIn">
              <option value="true">opt_in</option>
              <option value="false">opt_out</option>
            </select>
          </label>
          <label class="field"><span>Fonte do consentimento</span><input name="consentSource" value="admin_panel" /></label>
        </div>
        <button type="submit">Criar usuario</button>
      </form>
      <form method="post" action="/admin/actions/user/optout">
        <h2>Opt-out Usuario</h2>
        <div class="row">
          <label class="field"><span>User ID</span><input name="userId" required /></label>
          <label class="field"><span>Fonte</span><input name="source" value="admin_panel_optout" /></label>
        </div>
        <button class="secondary" type="submit">Aplicar opt-out</button>
      </form>
      <form id="campanhas" class="anchor-target" method="post" action="/admin/actions/campaign/create">
        <h2>Criar Campanha</h2>
        <div class="row">
          <label class="field"><span>ID (opcional)</span><input name="id" /></label>
          <label class="field"><span>Nome</span><input name="name" required /></label>
        </div>
        <label class="field"><span>Base copy</span><input name="baseCopy" required /></label>
        <div class="row">
          <label class="field"><span>Incentivo</span><input name="incentiveOffer" /></label>
          <label class="field"><span>Canal</span>
            <select name="channel">
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
              <option value="telegram">telegram</option>
            </select>
          </label>
        </div>
        <button type="submit">Criar campanha</button>
      </form>
      <form id="disparo" class="anchor-target" method="post" action="/admin/actions/campaign/dispatch">
        <h2>Disparar Campanha</h2>
        <div class="row">
          <label class="field"><span>Campaign ID</span><input name="campaignId" required /></label>
          <label class="field"><span>Limite</span><input name="limit" type="number" value="100" min="1" max="500" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Canal (opcional)</span><input name="channel" placeholder="whatsapp/email/telegram" /></label>
          <label class="field"><span>Webhook override (preview)</span><input name="webhookUrlOverride" placeholder="https://..." /></label>
        </div>
        <div class="row">
          <label class="field"><span>Personalizar</span>
            <select name="personalize"><option value="true">true</option><option value="false">false</option></select>
          </label>
          <label class="field"><span>Dry run</span>
            <select name="dryRun"><option value="true">true</option><option value="false">false</option></select>
          </label>
        </div>
        <div class="row">
          <label class="field"><span>Incluir inativos</span>
            <select name="includeInactive"><option value="false">false</option><option value="true">true</option></select>
          </label>
          <label class="field"><span>Force (campanha pausada)</span>
            <select name="force"><option value="false">false</option><option value="true">true</option></select>
          </label>
        </div>
        <button type="submit">Executar dispatch</button>
      </form>
      <form id="integracao" class="anchor-target" method="post" action="/admin/actions/integration/save">
        <h2>Configuracao WhatsApp</h2>
        ${dispatchTokenStatus}
        <p class="helper">Defina a URL do webhook de entrega WhatsApp (ex.: gateway Baileys). Esta URL sera usada pelo botao de teste e tambem para os dispatches da campanha quando informado override no admin.</p>
        <label class="field"><span>Webhook URL da integracao</span><input name="webhookUrl" value="${whatsappWebhookUrl}" placeholder="https://wa-gateway.seu-dominio.com/dispatch/whatsapp" required /></label>
        <div class="row">
          <label class="field"><span>Telefone padrao de teste (opcional)</span><input name="testPhone" value="${whatsappTestPhone}" placeholder="+5511999990001" /></label>
          <label class="field"><span>Ultima atualizacao</span><input value="${escapeHtml(whatsappUpdatedAtLabel)}" readonly /></label>
        </div>
        <label class="field"><span>Mensagem padrao de teste</span><textarea name="testMessage">${whatsappTestMessage}</textarea></label>
        <button type="submit">Salvar configuracao</button>
      </form>
      <form id="integracao-teste" class="anchor-target" method="post" action="/admin/actions/integration/test">
        <h2>Teste da Integracao WhatsApp</h2>
        <p class="helper">Este teste envia um payload real para o webhook com Authorization Bearer usando o secret <code>DISPATCH_BEARER_TOKEN</code>.</p>
        <div class="row">
          <label class="field"><span>Webhook configurado (somente leitura)</span><input value="${whatsappWebhookUrl || 'Nao configurado'}" readonly /></label>
          <label class="field"><span>Webhook override para este teste (opcional)</span><input name="webhookUrl" placeholder="https://wa-gateway.seu-dominio.com/dispatch/whatsapp" /></label>
        </div>
        <div class="row">
          <label class="field"><span>Telefone de teste</span><input name="testPhone" value="${whatsappTestPhone}" placeholder="+5511999990001" /></label>
          <label class="field"><span>Canal</span><input value="whatsapp" readonly /></label>
        </div>
        <label class="field"><span>Mensagem de teste</span><textarea name="testMessage">${whatsappTestMessage}</textarea></label>
        <button class="secondary" type="submit">Executar teste da integracao</button>
      </form>
      <section id="agente" class="log anchor-target">
        <h2 class="panel-title">Decisoes recentes do agente</h2>
        <ul>${decisionsHtml || '<li>Sem decisoes registradas.</li>'}</ul>
      </section>
    </section>
    <section id="lista-campanhas" class="anchor-target">
      <h2 class="panel-title">Campanhas</h2>
      <table>
        <thead><tr><th>ID</th><th>Nome</th><th>Canal</th><th>Status</th><th>Atualizado em</th></tr></thead>
        <tbody>${campaignsHtml || '<tr><td colspan="5">Sem campanhas.</td></tr>'}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`
}

async function executeCampaignDispatch(
  env: Bindings,
  campaignId: string,
  body: DispatchRequestBody,
  requestOrigin: string
): Promise<{ ok: true; data: DispatchResult } | { ok: false; status: DispatchErrorStatus; error: string }> {
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
    .bind(campaignId)
    .first<CampaignRecord>()

  if (!campaign) return { ok: false, status: 404, error: 'Campaign not found' }

  const force = toBoolean(body.force, false)
  if (campaign.status === 'paused' && !force) {
    return { ok: false, status: 409, error: 'Campaign is paused. Use force=true to dispatch anyway.' }
  }

  const channel = (safeString(body.channel) ?? campaign.channel ?? 'whatsapp').toLowerCase()
  const baseDispatchUrl = resolveDispatchUrl(channel, env)
  let dispatchUrl = baseDispatchUrl

  const overrideUrl = safeString(body.webhookUrlOverride)
  if ((env.APP_ENV ?? '').toLowerCase() === 'preview' && overrideUrl) {
    const overrideValidation = validatePreviewWebhookOverrideUrl(overrideUrl, env)
    if (!overrideValidation.ok) {
      return { ok: false, status: 400, error: overrideValidation.error }
    }
    dispatchUrl = overrideValidation.normalizedUrl
  }

  if (!dispatchUrl) {
    return { ok: false, status: 500, error: 'Dispatch webhook URL is not configured for this channel.' }
  }

  const limit = Math.min(Math.max(toNumber(body.limit) || 100, 1), 500)
  const personalize = toBoolean(body.personalize, true)
  const dryRun = toBoolean(body.dryRun, false)
  const includeInactive = toBoolean(body.includeInactive, false)
  const requestedUserIds = Array.isArray(body.userIds)
    ? body.userIds.map((id) => safeString(id)).filter((id): id is string => Boolean(id))
    : []

  let users: UserRecord[] = []
  if (requestedUserIds.length > 0) {
    const placeholders = requestedUserIds.map(() => '?').join(', ')
    const query = `SELECT * FROM users WHERE id IN (${placeholders}) LIMIT ?`
    const usersResult = await env.DB.prepare(query).bind(...requestedUserIds, limit).all<UserRecord>()
    users = usersResult.results
  } else {
    const query = includeInactive
      ? 'SELECT * FROM users WHERE preferred_channel = ? ORDER BY engagement_score DESC LIMIT ?'
      : "SELECT * FROM users WHERE preferred_channel = ? AND last_active >= datetime('now', '-30 days') ORDER BY engagement_score DESC LIMIT ?"
    const usersResult = await env.DB.prepare(query).bind(channel, limit).all<UserRecord>()
    users = usersResult.results
  }

  if (users.length === 0) {
    return {
      ok: true,
      data: {
        status: 'success',
        campaignId,
        channel,
        dryRun,
        requested: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        failures: [],
      },
    }
  }

  let sentCount = 0
  let failedCount = 0
  let skippedCount = 0
  const failures: Array<{ userId: string; reason: string; status?: number }> = []

  for (const user of users) {
    if (isUserOptedOut(user)) {
      skippedCount += 1
      const reason = 'User opted out of marketing communications'
      failures.push({ userId: user.id, reason })
      await logInteraction(env, {
        userId: user.id,
        campaignId,
        channel,
        eventType: 'send_failed',
        metadata: { reason, stage: 'consent' },
      })
      continue
    }

    const destination = channel === 'email' ? user.email : user.phone
    if (!destination) {
      skippedCount += 1
      const reason = `Missing destination for channel ${channel}`
      failures.push({ userId: user.id, reason })
      await logInteraction(env, {
        userId: user.id,
        campaignId,
        channel,
        eventType: 'send_failed',
        metadata: { reason, stage: 'validation' },
      })
      continue
    }

    let message = campaign.base_copy
    if (personalize) {
      try {
        message = await generatePersonalizedMessage(env, user, campaign.base_copy, channel)
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'personalized',
          metadata: { model: DEFAULT_AI_MODEL, source: 'campaign_dispatch' },
        })
      } catch (error) {
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'send_failed',
          metadata: { reason: 'Personalization failed, fallback to base copy', error: String(error) },
        })
      }
    }

    const referralUrl = user.referral_code
      ? `${requestOrigin}/ref/${encodeURIComponent(user.referral_code)}`
      : null
    const unsubscribeUrl = user.referral_code
      ? `${requestOrigin}/unsubscribe/${encodeURIComponent(user.referral_code)}`
      : null

    const payload = {
      channel,
      campaign: {
        id: campaign.id,
        name: campaign.name,
      },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        preferredChannel: user.preferred_channel,
      },
      message,
      referralUrl,
      unsubscribeUrl,
      metadata: body.metadata ?? null,
    }

    if (dryRun) {
      sentCount += 1
      continue
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (env.DISPATCH_BEARER_TOKEN) {
        headers.Authorization = `Bearer ${env.DISPATCH_BEARER_TOKEN}`
      }

      const response = await fetch(dispatchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      const responseBody = await response.text()
      const responsePreview = responseBody.slice(0, 500)

      if (response.ok) {
        sentCount += 1
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'sent',
          metadata: {
            statusCode: response.status,
            responsePreview,
          },
        })
      } else {
        failedCount += 1
        failures.push({ userId: user.id, reason: 'Dispatch webhook returned error', status: response.status })
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'send_failed',
          metadata: {
            statusCode: response.status,
            responsePreview,
          },
        })
      }
    } catch (error) {
      failedCount += 1
      failures.push({ userId: user.id, reason: 'Dispatch request failed' })
      await logInteraction(env, {
        userId: user.id,
        campaignId,
        channel,
        eventType: 'send_failed',
        metadata: { error: String(error) },
      })
    }
  }

  return {
    ok: true,
    data: {
      status: 'success',
      campaignId,
      channel,
      dryRun,
      requested: users.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
      failures: failures.slice(0, 25),
    },
  }
}

// Root - System Info
app.get('/', (c) => {
  return c.json({
    name: 'Viral Marketing System',
    status: 'ok',
    env: c.env.APP_ENV ?? 'production',
  })
})

// Admin Login Page
app.get('/admin/login', async (c) => {
  const hasSession = await hasValidAdminSession(c)
  if (hasSession) return c.redirect('/admin', 302)
  return c.html(renderAdminLoginPage())
})

// Admin Login Action
app.post('/admin/login', async (c) => {
  const configuredPassword = getAdminPanelPassword(c.env)
  const sessionSecret = getAdminSessionSecret(c.env)
  const requesterIp = getRequesterIp(c.req.raw)
  if (!configuredPassword || !sessionSecret) {
    return c.html(
      renderAdminLoginPage(
        'Admin nao configurado. Defina ADMIN_PANEL_PASSWORD e ADMIN_SESSION_SECRET nos secrets.'
      ),
      500
    )
  }

  const throttle = await checkAdminLoginThrottle(c.env.MARTECH_KV, requesterIp)
  if (!throttle.allowed) {
    c.header('Retry-After', `${throttle.retryAfterSeconds}`)
    return c.html(
      renderAdminLoginPage('Muitas tentativas de login. Tente novamente em alguns minutos.'),
      429
    )
  }

  const form = await c.req.parseBody()
  const password = safeString(typeof form.password === 'string' ? form.password : null)
  if (!password || !constantTimeEqual(password, configuredPassword)) {
    await recordAdminLoginFailure(c.env.MARTECH_KV, requesterIp)
    return c.html(renderAdminLoginPage('Credenciais invalidas.'), 401)
  }

  await clearAdminLoginThrottle(c.env.MARTECH_KV, requesterIp)
  const token = await createAdminSessionToken(sessionSecret)
  setAdminSessionCookie(c, token)
  return c.redirect('/admin', 302)
})

// Admin Logout Action
app.post('/admin/logout', async (c) => {
  clearAdminSessionCookie(c)
  return c.redirect('/admin/login', 302)
})

// Admin Dashboard
app.get('/admin', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  const [overview, campaigns, decisions, whatsappIntegration] = await Promise.all([
    getOverviewMetrics(c.env),
    c.env.DB.prepare(
      'SELECT id, name, channel, status, updated_at FROM campaigns ORDER BY updated_at DESC LIMIT 30'
    ).all<{ id: string; name: string; channel: string; status: string; updated_at: string }>(),
    c.env.DB.prepare(
      'SELECT decision_type, target_id, reason, created_at FROM agent_decisions ORDER BY created_at DESC LIMIT 20'
    ).all<{ decision_type: string; target_id: string | null; reason: string; created_at: string }>(),
    getAdminWhatsAppIntegrationConfig(c.env),
  ])

  const notice = safeString(c.req.query('notice'))
  const noticeKind = safeString(c.req.query('kind'))

  return c.html(
    renderAdminDashboardPage({
      notice,
      noticeKind,
      totals: overview.totals,
      metrics: overview.metrics,
      whatsappIntegration: {
        webhookUrl: whatsappIntegration.webhookUrl,
        testPhone: whatsappIntegration.testPhone,
        testMessage: whatsappIntegration.testMessage,
        updatedAt: whatsappIntegration.updatedAt,
        dispatchTokenConfigured: Boolean(safeString(c.env.DISPATCH_BEARER_TOKEN)),
      },
      campaigns: campaigns.results ?? [],
      decisions: decisions.results ?? [],
    })
  )
})

// Admin Action - Create User
app.post('/admin/actions/user/create', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const result = await createUserRecord(c.env, {
      id: typeof form.id === 'string' ? form.id : undefined,
      name: typeof form.name === 'string' ? form.name : undefined,
      email: typeof form.email === 'string' ? form.email : undefined,
      phone: typeof form.phone === 'string' ? form.phone : undefined,
      preferredChannel: typeof form.preferredChannel === 'string' ? form.preferredChannel : undefined,
      psychologicalProfile:
        typeof form.psychologicalProfile === 'string' ? form.psychologicalProfile : undefined,
      referredBy: typeof form.referredBy === 'string' ? form.referredBy : undefined,
      marketingOptIn: typeof form.marketingOptIn === 'string' ? form.marketingOptIn : undefined,
      consentSource: typeof form.consentSource === 'string' ? form.consentSource : undefined,
    })
    return c.redirect(buildAdminRedirect(`Usuario criado: ${result.userId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar usuario: ${String(error)}`, 'error'), 302)
  }
})

// Admin Action - User Opt-out
app.post('/admin/actions/user/optout', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const userId = safeString(typeof form.userId === 'string' ? form.userId : null)
    if (!userId) return c.redirect(buildAdminRedirect('userId e obrigatorio.', 'error'), 302)

    const source = resolveConsentSource(
      typeof form.source === 'string' ? form.source : null,
      'admin_panel_optout'
    )
    const consentResult = await setUserMarketingConsent(c.env, userId, false, source)
    if (!consentResult.updated || !consentResult.user) {
      return c.redirect(buildAdminRedirect('Usuario nao encontrado para opt-out.', 'error'), 302)
    }

    return c.redirect(buildAdminRedirect(`Opt-out aplicado: ${consentResult.user.id}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha no opt-out: ${String(error)}`, 'error'), 302)
  }
})

// Admin Action - Create Campaign
app.post('/admin/actions/campaign/create', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const name = safeString(typeof form.name === 'string' ? form.name : null)
    const baseCopy = safeString(typeof form.baseCopy === 'string' ? form.baseCopy : null)
    if (!name || !baseCopy) {
      return c.redirect(buildAdminRedirect('Nome e base copy sao obrigatorios.', 'error'), 302)
    }

    const campaignId = await createCampaignRecord(c.env, {
      id: typeof form.id === 'string' ? form.id : undefined,
      name,
      baseCopy,
      incentiveOffer: typeof form.incentiveOffer === 'string' ? form.incentiveOffer : undefined,
      channel: typeof form.channel === 'string' ? form.channel : undefined,
    })
    return c.redirect(buildAdminRedirect(`Campanha criada: ${campaignId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar campanha: ${String(error)}`, 'error'), 302)
  }
})

// Admin Action - Campaign Dispatch
app.post('/admin/actions/campaign/dispatch', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  const form = await c.req.parseBody()
  const campaignId = safeString(typeof form.campaignId === 'string' ? form.campaignId : null)
  if (!campaignId) return c.redirect(buildAdminRedirect('campaignId e obrigatorio.', 'error'), 302)

  const dispatchInput: DispatchRequestBody = {
    limit: toNumber(typeof form.limit === 'string' ? form.limit : null) || 100,
    personalize: toBoolean(typeof form.personalize === 'string' ? form.personalize : null, true),
    dryRun: toBoolean(typeof form.dryRun === 'string' ? form.dryRun : null, true),
    includeInactive: toBoolean(typeof form.includeInactive === 'string' ? form.includeInactive : null, false),
    force: toBoolean(typeof form.force === 'string' ? form.force : null, false),
    channel: typeof form.channel === 'string' ? form.channel : undefined,
    webhookUrlOverride: typeof form.webhookUrlOverride === 'string' ? form.webhookUrlOverride : undefined,
    metadata: { source: 'admin_panel' },
  }

  const requestOrigin = new URL(c.req.url).origin
  const dispatchResult = await executeCampaignDispatch(c.env, campaignId, dispatchInput, requestOrigin)
  if (!dispatchResult.ok) {
    return c.redirect(buildAdminRedirect(dispatchResult.error, 'error'), 302)
  }

  const summary = dispatchResult.data
  return c.redirect(
    buildAdminRedirect(
      `Dispatch ${summary.campaignId}: sent=${summary.sent}, failed=${summary.failed}, skipped=${summary.skipped}`
    ),
    302
  )
})

// Admin Action - Save WhatsApp integration config
app.post('/admin/actions/integration/save', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const currentConfig = await getAdminWhatsAppIntegrationConfig(c.env)
    const form = await c.req.parseBody()
    const rawWebhookUrl =
      safeString(typeof form.webhookUrl === 'string' ? form.webhookUrl : null) ??
      currentConfig.webhookUrl
    if (!rawWebhookUrl) {
      return c.redirect(buildAdminRedirect('Webhook URL e obrigatoria.', 'error'), 302)
    }

    const validation = validateAdminIntegrationWebhookUrl(rawWebhookUrl, c.env)
    if (!validation.ok) return c.redirect(buildAdminRedirect(validation.error, 'error'), 302)

    const testPhone =
      safeString(typeof form.testPhone === 'string' ? form.testPhone : null) ?? currentConfig.testPhone
    const testMessage =
      safeString(typeof form.testMessage === 'string' ? form.testMessage : null) ??
      currentConfig.testMessage ??
      DEFAULT_WHATSAPP_TEST_MESSAGE

    const config: AdminWhatsAppIntegrationConfig = {
      webhookUrl: validation.normalizedUrl,
      testPhone,
      testMessage,
      updatedAt: new Date().toISOString(),
    }
    await saveAdminWhatsAppIntegrationConfig(c.env, config)

    return c.redirect(buildAdminRedirect('Configuracao da integracao WhatsApp salva.'), 302)
  } catch (error) {
    return c.redirect(
      buildAdminRedirect(`Falha ao salvar configuracao da integracao: ${String(error)}`, 'error'),
      302
    )
  }
})

// Admin Action - Save and test WhatsApp integration
app.post('/admin/actions/integration/test', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const currentConfig = await getAdminWhatsAppIntegrationConfig(c.env)
    const form = await c.req.parseBody()

    const rawWebhookUrl =
      safeString(typeof form.webhookUrl === 'string' ? form.webhookUrl : null) ??
      currentConfig.webhookUrl
    if (!rawWebhookUrl) {
      return c.redirect(buildAdminRedirect('Webhook URL e obrigatoria para testar.', 'error'), 302)
    }

    const validation = validateAdminIntegrationWebhookUrl(rawWebhookUrl, c.env)
    if (!validation.ok) return c.redirect(buildAdminRedirect(validation.error, 'error'), 302)

    const testPhone =
      safeString(typeof form.testPhone === 'string' ? form.testPhone : null) ?? currentConfig.testPhone
    if (!testPhone) {
      return c.redirect(buildAdminRedirect('Informe um telefone de teste para WhatsApp.', 'error'), 302)
    }

    const testMessage =
      safeString(typeof form.testMessage === 'string' ? form.testMessage : null) ??
      currentConfig.testMessage ??
      DEFAULT_WHATSAPP_TEST_MESSAGE

    const dispatchToken = safeString(c.env.DISPATCH_BEARER_TOKEN)
    if (!dispatchToken) {
      return c.redirect(
        buildAdminRedirect('DISPATCH_BEARER_TOKEN nao configurado no Worker.', 'error'),
        302
      )
    }

    const config: AdminWhatsAppIntegrationConfig = {
      webhookUrl: validation.normalizedUrl,
      testPhone,
      testMessage,
      updatedAt: new Date().toISOString(),
    }
    await saveAdminWhatsAppIntegrationConfig(c.env, config)

    const requestOrigin = new URL(c.req.url).origin
    const payload = {
      channel: 'whatsapp',
      campaign: {
        id: 'admin-integration-test',
        name: 'Admin Integration Test',
      },
      user: {
        id: 'admin-test-user',
        name: 'Teste Admin',
        email: null,
        phone: testPhone,
        preferredChannel: 'whatsapp',
      },
      message: testMessage,
      referralUrl: `${requestOrigin}/ref/admin-test`,
      unsubscribeUrl: `${requestOrigin}/unsubscribe/admin-test`,
      metadata: {
        source: 'admin_panel_integration_test',
        requestedAt: new Date().toISOString(),
      },
    }

    const response = await fetch(validation.normalizedUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dispatchToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    const compactPreview = responseText.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!response.ok) {
      const suffix = compactPreview ? ` - ${compactPreview}` : ''
      return c.redirect(
        buildAdminRedirect(`Teste WhatsApp falhou (HTTP ${response.status})${suffix}`, 'error'),
        302
      )
    }

    return c.redirect(
      buildAdminRedirect(`Teste WhatsApp enviado com sucesso (HTTP ${response.status}).`),
      302
    )
  } catch (error) {
    return c.redirect(
      buildAdminRedirect(`Falha ao executar teste da integracao: ${String(error)}`, 'error'),
      302
    )
  }
})

// Create User
app.post('/user', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => null)) as Partial<{
    id: string
    name: string
    email: string
    phone: string
    preferredChannel: string
    psychologicalProfile: string
    referredBy: string
    marketingOptIn: boolean | string
    consentSource: string
  }> | null

  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  const result = await createUserRecord(c.env, body)

  return c.json(
    {
      status: 'success',
      user: {
        id: result.userId,
        referralCode: result.referralCode,
      },
    },
    201
  )
})

// Get User Profile
app.get('/user/:id', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const userId = c.req.param('id')
  const user = await getUserById(c.env, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json(user)
})

// Update User Marketing Consent
app.post('/user/:id/consent', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const userId = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as
    | Partial<{ marketingOptIn: boolean | string; source: string }>
    | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  if (typeof body.marketingOptIn === 'undefined') {
    return c.json({ error: 'marketingOptIn is required' }, 400)
  }

  const marketingOptIn = toBoolean(body.marketingOptIn, true)
  const source = resolveConsentSource(body.source, 'admin_api')
  const consentResult = await setUserMarketingConsent(c.env, userId, marketingOptIn, source)
  if (!consentResult.updated || !consentResult.user) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({
    status: 'success',
    user: {
      id: consentResult.user.id,
      marketingOptIn: toNumber(consentResult.user.marketing_opt_in) === 1,
      optOutAt: consentResult.user.opt_out_at ?? null,
      consentSource: consentResult.user.consent_source ?? null,
      consentUpdatedAt: consentResult.user.consent_updated_at ?? null,
    },
  })
})

// Create Campaign
app.post('/campaign', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => null)) as Partial<{
    id: string
    name: string
    baseCopy: string
    incentiveOffer: string
    channel: string
  }> | null

  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  if (!safeString(body.name) || !safeString(body.baseCopy)) {
    return c.json({ error: 'name and baseCopy are required' }, 400)
  }

  const campaignId = await createCampaignRecord(c.env, {
    id: body.id,
    name: safeString(body.name) ?? '',
    baseCopy: safeString(body.baseCopy) ?? '',
    incentiveOffer: body.incentiveOffer,
    channel: body.channel,
  })

  return c.json({ status: 'success', campaignId }, 201)
})

// Log Interaction
app.post('/interaction', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => null)) as Partial<InteractionPayload> | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  const userId = safeString(body.userId)
  if (!userId) return c.json({ error: 'userId is required' }, 400)
  if (!isInteractionEvent(body.eventType)) {
    return c.json({ error: 'eventType is invalid' }, 400)
  }

  const user = await getUserById(c.env, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  await logInteraction(c.env, {
    userId,
    eventType: body.eventType,
    campaignId: safeString(body.campaignId),
    channel: safeString(body.channel) ?? user.preferred_channel,
    metadata: body.metadata,
  })

  if (body.eventType === 'shared') {
    await c.env.DB.prepare('UPDATE users SET viral_points = viral_points + 1 WHERE id = ?')
      .bind(userId)
      .run()
  }

  return c.json({ status: 'success' })
})

// Hyper-Personalized AI Hook
app.post('/personalize/:id', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const userId = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as Partial<{
    campaignId: string
    baseCopy: string
  }> | null

  const user = await getUserById(c.env, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  let campaign: CampaignRecord | null = null
  const campaignId = safeString(body?.campaignId)
  if (campaignId) {
    campaign =
      (await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
        .bind(campaignId)
        .first<CampaignRecord>()) ?? null
  }

  const baseCopy = safeString(body?.baseCopy) ?? campaign?.base_copy ?? 'Get 20% off your next purchase!'
  const personalizedMessage = await generatePersonalizedMessage(
    c.env,
    user,
    baseCopy,
    user.preferred_channel
  )

  await logInteraction(c.env, {
    userId,
    campaignId,
    channel: user.preferred_channel,
    eventType: 'personalized',
    metadata: { model: DEFAULT_AI_MODEL },
  })

  return c.json({
    user: {
      id: user.id,
      preferredChannel: user.preferred_channel,
      engagementScore: user.engagement_score,
    },
    campaignId,
    personalizedMessage,
  })
})

// Public Unsubscribe (LGPD opt-out)
app.get('/unsubscribe/:code', async (c) => {
  const referralCode = c.req.param('code').trim().toLowerCase()
  if (!referralCode) {
    return c.html(
      renderUnsubscribePage({
        title: 'Link invalido',
        message: 'Nao foi possivel processar seu descadastro.',
        success: false,
      }),
      400
    )
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE referral_code = ?')
    .bind(referralCode)
    .first<UserRecord>()

  if (!user?.id) {
    return c.html(
      renderUnsubscribePage({
        title: 'Usuario nao encontrado',
        message: 'Este link de descadastro nao e valido ou expirou.',
        success: false,
      }),
      404
    )
  }

  const alreadyOptedOut = isUserOptedOut(user)
  await setUserMarketingConsent(c.env, user.id, false, 'unsubscribe_link')

  return c.html(
    renderUnsubscribePage({
      title: 'Descadastro concluido',
      message: alreadyOptedOut
        ? 'Seu contato ja estava descadastrado de comunicacoes de marketing.'
        : 'Seu contato foi removido das comunicacoes de marketing com sucesso.',
      success: true,
    })
  )
})

// Referral Tracking
app.get('/ref/:code', async (c) => {
  const referralCode = c.req.param('code').trim().toLowerCase()
  if (!referralCode) return c.json({ error: 'Referral code is required' }, 400)

  const landingBase = c.env.LANDING_PAGE_URL ?? DEFAULT_LANDING_PAGE
  const redirectUrl = buildReferralRedirect(landingBase, referralCode)

  const referrer = await c.env.DB.prepare('SELECT id FROM users WHERE referral_code = ?')
    .bind(referralCode)
    .first<{ id: string }>()

  if (!referrer?.id) return c.redirect(redirectUrl, 302)

  const requesterIp = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const ipHash = await hashValue(requesterIp)
  const dedupeKey = `referral:${referrer.id}:${ipHash}`
  const alreadyCounted = await c.env.MARTECH_KV.get(dedupeKey)

  if (!alreadyCounted) {
    await c.env.DB.prepare(
      'INSERT INTO interactions (user_id, channel, event_type, metadata) VALUES (?, ?, ?, ?)'
    )
      .bind(referrer.id, 'whatsapp', 'referral_click', JSON.stringify({ referralCode }))
      .run()

    await c.env.DB.prepare('UPDATE users SET viral_points = viral_points + 1 WHERE id = ?')
      .bind(referrer.id)
      .run()

    await c.env.MARTECH_KV.put(dedupeKey, '1', { expirationTtl: 3600 })
  }

  return c.redirect(redirectUrl, 302)
})

// Campaign Dispatcher (Webhook)
app.post('/campaign/:id/send', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const campaignId = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as DispatchRequestBody | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  const requestOrigin = new URL(c.req.url).origin
  const result = await executeCampaignDispatch(c.env, campaignId, body, requestOrigin)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.data)
})

// Dashboard Metrics
app.get('/metrics/overview', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const overview = await getOverviewMetrics(c.env)
  return c.json(overview)
})

// Cloudflare Scheduled Agent (Cron Logic)
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
    console.log('Autonomous Agent running optimization cycle')

    const coldUsers = await env.DB.prepare(
      "SELECT id, preferred_channel FROM users WHERE last_active < datetime('now', '-3 days') AND preferred_channel != 'sms' LIMIT 200"
    ).all<{ id: string; preferred_channel: string }>()

    for (const user of coldUsers.results) {
      await env.DB.prepare('UPDATE users SET preferred_channel = ? WHERE id = ?').bind('sms', user.id).run()
      await logAgentDecision(
        env,
        'channel_switch',
        user.id,
        'User inactive for 3+ days, migrated channel to sms',
        { from: user.preferred_channel, to: 'sms' }
      )
    }

    const campaignPerf = await env.DB.prepare(
      `
      SELECT
        c.id AS campaign_id,
        SUM(CASE WHEN i.event_type = 'sent' THEN 1 ELSE 0 END) AS sent_count,
        SUM(CASE WHEN i.event_type = 'converted' THEN 1 ELSE 0 END) AS converted_count
      FROM campaigns c
      LEFT JOIN interactions i
        ON i.campaign_id = c.id
        AND i.timestamp >= datetime('now', '-7 days')
      WHERE c.status = 'active'
      GROUP BY c.id
      `
    ).all<{ campaign_id: string; sent_count: number; converted_count: number }>()

    for (const campaign of campaignPerf.results) {
      const sentCount = toNumber(campaign.sent_count)
      const convertedCount = toNumber(campaign.converted_count)
      const conversionRate = sentCount > 0 ? convertedCount / sentCount : 0

      if (sentCount >= 20 && conversionRate < 0.02) {
        await env.DB.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind('paused', campaign.campaign_id)
          .run()

        await logAgentDecision(
          env,
          'campaign_pause',
          campaign.campaign_id,
          'Low conversion in the last 7 days',
          { sentCount, convertedCount, conversionRate }
        )
      }
    }

    const powerReferrers = await env.DB.prepare(
      "SELECT id, viral_points FROM users WHERE viral_points >= 5 ORDER BY viral_points DESC LIMIT 20"
    ).all<{ id: string; viral_points: number }>()

    for (const user of powerReferrers.results) {
      await logAgentDecision(
        env,
        'reward_recommendation',
        user.id,
        'User reached viral milestone, reward recommended',
        { viralPoints: user.viral_points }
      )
    }
  },
}
