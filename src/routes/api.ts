import { Hono } from 'hono'
import type { Bindings, InteractionPayload, CampaignRecord, DispatchRequestBody } from '../types'
import { DEFAULT_AI_MODEL } from '../constants'
import { safeString, toNumber, toBoolean, isInteractionEvent, resolveConsentSource } from '../utils'
import { ensureAdminAccess } from '../auth'
import { getUserById, logInteraction, createUserRecord, createCampaignRecord, getOverviewMetrics } from '../db'
import { setUserMarketingConsent } from '../consent'
import { generatePersonalizedMessage } from '../ai'
import { executeCampaignDispatch } from '../dispatch'

const api = new Hono<{ Bindings: Bindings }>()

// Create User
api.post('/user', async (c) => {
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
api.get('/user/:id', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const userId = c.req.param('id')
  const user = await getUserById(c.env, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json(user)
})

// Update User Marketing Consent
api.post('/user/:id/consent', async (c) => {
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
api.post('/campaign', async (c) => {
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
api.post('/interaction', async (c) => {
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
api.post('/personalize/:id', async (c) => {
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

// Campaign Dispatcher (Webhook)
api.post('/campaign/:id/send', async (c) => {
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
api.get('/metrics/overview', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const overview = await getOverviewMetrics(c.env)
  return c.json(overview)
})

api.get('/test-fetch', async (c) => {
  try {
    const res = await fetch('https://wainews.com.br/webhooks/gateway/groups')
    const text = await res.text()
    return c.json({ status: res.status, text })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

api.get('/test-fetch-ip', async (c) => {
  try {
    const res = await fetch('http://168.231.94.189/health')
    const text = await res.text()
    return c.json({ status: res.status, text })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

export { api }
