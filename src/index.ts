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
  }>
): Promise<{ userId: string; referralCode: string }> {
  const userId = safeString(input.id) ?? crypto.randomUUID()
  const name = safeString(input.name)
  const email = safeString(input.email)
  const phone = safeString(input.phone)
  const preferredChannel = safeString(input.preferredChannel) ?? 'whatsapp'
  const psychologicalProfile = safeString(input.psychologicalProfile) ?? 'generic'
  const referredBy = safeString(input.referredBy)
  const referralCode = buildReferralCode(userId)

  await env.DB.prepare(
    `INSERT INTO users (
      id, name, email, phone, preferred_channel, psychological_profile, referral_code, referred_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      userId,
      name,
      email,
      phone,
      preferredChannel,
      psychologicalProfile,
      referralCode,
      referredBy
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
    .field input, .field select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      font: inherit;
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
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eef2f6; font-size: 0.92rem; }
    th { color: var(--muted); font-weight: 600; }
    ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; }
    .logout { display: inline; }
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
    <section class="cards">
      <article class="card"><small>Usuarios</small><strong>${data.totals.users}</strong></article>
      <article class="card"><small>Interacoes</small><strong>${data.totals.interactions}</strong></article>
      <article class="card"><small>Envios</small><strong>${data.totals.sent}</strong></article>
      <article class="card"><small>Conversoes</small><strong>${data.totals.conversions}</strong></article>
      <article class="card"><small>K-factor</small><strong>${data.metrics.kFactor.toFixed(2)}</strong></article>
      <article class="card"><small>Campanhas ativas</small><strong>${data.totals.activeCampaigns}</strong></article>
    </section>
    <section class="grid">
      <form method="post" action="/admin/actions/user/create">
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
        <button type="submit">Criar usuario</button>
      </form>
      <form method="post" action="/admin/actions/campaign/create">
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
      <form method="post" action="/admin/actions/campaign/dispatch">
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
      <section class="log">
        <h2 class="panel-title">Decisoes recentes do agente</h2>
        <ul>${decisionsHtml || '<li>Sem decisoes registradas.</li>'}</ul>
      </section>
    </section>
    <section>
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

  const overview = await getOverviewMetrics(c.env)
  const campaigns = await c.env.DB.prepare(
    'SELECT id, name, channel, status, updated_at FROM campaigns ORDER BY updated_at DESC LIMIT 30'
  ).all<{ id: string; name: string; channel: string; status: string; updated_at: string }>()
  const decisions = await c.env.DB.prepare(
    'SELECT decision_type, target_id, reason, created_at FROM agent_decisions ORDER BY created_at DESC LIMIT 20'
  ).all<{ decision_type: string; target_id: string | null; reason: string; created_at: string }>()

  const notice = safeString(c.req.query('notice'))
  const noticeKind = safeString(c.req.query('kind'))

  return c.html(
    renderAdminDashboardPage({
      notice,
      noticeKind,
      totals: overview.totals,
      metrics: overview.metrics,
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
    })
    return c.redirect(buildAdminRedirect(`Usuario criado: ${result.userId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar usuario: ${String(error)}`, 'error'), 302)
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
