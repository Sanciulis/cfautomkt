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
  WHATSAPP_WEBHOOK_URL?: string
  EMAIL_WEBHOOK_URL?: string
  TELEGRAM_WEBHOOK_URL?: string
  DISPATCH_BEARER_TOKEN?: string
  ADMIN_API_KEY?: string
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

// Root - System Info
app.get('/', (c) => {
  return c.json({
    name: 'Viral Marketing System',
    status: 'ok',
    env: c.env.APP_ENV ?? 'production',
  })
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

  const userId = safeString(body.id) ?? crypto.randomUUID()
  const name = safeString(body.name)
  const email = safeString(body.email)
  const phone = safeString(body.phone)
  const preferredChannel = safeString(body.preferredChannel) ?? 'whatsapp'
  const psychologicalProfile = safeString(body.psychologicalProfile) ?? 'generic'
  const referredBy = safeString(body.referredBy)
  const referralCode = buildReferralCode(userId)

  await c.env.DB.prepare(
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

  return c.json(
    {
      status: 'success',
      user: {
        id: userId,
        referralCode,
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

  const campaignId = safeString(body.id) ?? crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, name, base_copy, incentive_offer, channel)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      campaignId,
      safeString(body.name),
      safeString(body.baseCopy),
      safeString(body.incentiveOffer),
      safeString(body.channel) ?? 'whatsapp'
    )
    .run()

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

  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
    .bind(campaignId)
    .first<CampaignRecord>()

  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)

  const force = toBoolean(body.force, false)
  if (campaign.status === 'paused' && !force) {
    return c.json({ error: 'Campaign is paused. Use force=true to dispatch anyway.' }, 409)
  }

  const channel = (safeString(body.channel) ?? campaign.channel ?? 'whatsapp').toLowerCase()
  const baseDispatchUrl = resolveDispatchUrl(channel, c.env)
  let dispatchUrl = baseDispatchUrl

  const overrideUrl = safeString(body.webhookUrlOverride)
  if ((c.env.APP_ENV ?? '').toLowerCase() === 'preview' && overrideUrl) {
    if (!overrideUrl.startsWith('https://')) {
      return c.json({ error: 'webhookUrlOverride must use https://' }, 400)
    }
    dispatchUrl = overrideUrl
  }

  if (!dispatchUrl) {
    return c.json({ error: 'Dispatch webhook URL is not configured for this channel.' }, 500)
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
    const usersResult = await c.env.DB.prepare(query)
      .bind(...requestedUserIds, limit)
      .all<UserRecord>()
    users = usersResult.results
  } else {
    const query = includeInactive
      ? 'SELECT * FROM users WHERE preferred_channel = ? ORDER BY engagement_score DESC LIMIT ?'
      : "SELECT * FROM users WHERE preferred_channel = ? AND last_active >= datetime('now', '-30 days') ORDER BY engagement_score DESC LIMIT ?"
    const usersResult = await c.env.DB.prepare(query).bind(channel, limit).all<UserRecord>()
    users = usersResult.results
  }

  if (users.length === 0) {
    return c.json({
      status: 'success',
      campaignId,
      sent: 0,
      failed: 0,
      skipped: 0,
      dryRun,
      reason: 'No users matched dispatch filters',
    })
  }

  const referralBase = new URL(c.req.url).origin
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
      await logInteraction(c.env, {
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
        message = await generatePersonalizedMessage(c.env, user, campaign.base_copy, channel)
        await logInteraction(c.env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'personalized',
          metadata: { model: DEFAULT_AI_MODEL, source: 'campaign_dispatch' },
        })
      } catch (error) {
        await logInteraction(c.env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'send_failed',
          metadata: { reason: 'Personalization failed, fallback to base copy', error: String(error) },
        })
      }
    }

    const referralUrl = user.referral_code ? `${referralBase}/ref/${encodeURIComponent(user.referral_code)}` : null

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
      if (c.env.DISPATCH_BEARER_TOKEN) {
        headers.Authorization = `Bearer ${c.env.DISPATCH_BEARER_TOKEN}`
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
        await logInteraction(c.env, {
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
        await logInteraction(c.env, {
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
      await logInteraction(c.env, {
        userId: user.id,
        campaignId,
        channel,
        eventType: 'send_failed',
        metadata: { error: String(error) },
      })
    }
  }

  return c.json({
    status: 'success',
    campaignId,
    channel,
    dryRun,
    requested: users.length,
    sent: sentCount,
    failed: failedCount,
    skipped: skippedCount,
    failures: failures.slice(0, 25),
  })
})

// Dashboard Metrics
app.get('/metrics/overview', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const [
    totalUsersRow,
    totalInteractionsRow,
    sentRow,
    conversionsRow,
    sharesRow,
    activeCampaignsRow,
    topReferrersResult,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS value FROM users').first<{ value: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS value FROM interactions').first<{ value: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM interactions WHERE event_type = 'sent'").first<{
      value: number
    }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM interactions WHERE event_type = 'converted'").first<{
      value: number
    }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS value FROM interactions WHERE event_type IN ('shared', 'referral_click')"
    ).first<{ value: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM campaigns WHERE status = 'active'").first<{
      value: number
    }>(),
    c.env.DB.prepare(
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

  return c.json({
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
  })
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
