import { Hono } from 'hono'
import type { Bindings, InteractionPayload, CampaignRecord, DispatchRequestBody, JourneyPhase, JourneyConversationMessage, TelegramWebhookUpdate } from '../types'
import { DEFAULT_AI_MODEL } from '../constants'
import {
  safeString,
  toNumber,
  toBoolean,
  isInteractionEvent,
  resolveConsentSource,
  resolveDispatchUrl,
  constantTimeEqual,
} from '../utils'
import { ensureAdminAccess } from '../auth'
import {
  getUserById,
  logInteraction,
  createUserRecord,
  createCampaignRecord,
  getOverviewMetrics,
  createJourneyRecord,
  getJourneyById,
  listJourneys,
  updateJourneyStatus,
  updateJourneyRecord,
  enrollUserInJourney,
  getEnrollment,
  listJourneyEnrollments,
  advanceJourneyPhase,
  parseConversationHistory,
  createPersonaRecord,
  createProductRecord,
  getLatestNewsletterConversationSessionByContact,
  createNewsletterConversationSession,
  updateNewsletterConversationSession,
  appendNewsletterConversationMessage,
  listNewsletterConversationMessages,
  getLatestServiceConversationSessionByContact,
  createServiceConversationSession,
  updateServiceConversationSession,
  appendServiceConversationMessage,
  listServiceConversationMessages,
  createServiceAppointment,
  createServiceQuote,
} from '../db'
import { setUserMarketingConsent } from '../consent'
import { generatePersonalizedMessage } from '../ai'
import { executeCampaignDispatch } from '../dispatch'
import { runPersonaConversation, generateJourneyOpeningMessage, simulatePersonaConversation } from '../persona'
import { generateNewsletterAgentReply } from '../newsletter-agent'
import {
  analyzeServiceSentiment,
  detectServiceIntent,
  generateServiceAgentReply,
} from '../service-agent'
import { getAdminServiceAgentConfig } from '../integration'
import { handleTelegramWebhook, sendTelegramMessage } from '../telegram-agent'
import { getAdminTelegramIntegrationConfig } from '../integration'

const api = new Hono<{ Bindings: Bindings }>()

function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) return null
  return safeString(match[1])
}

function normalizeWhatsAppInboundContact(value: unknown): string | null {
  const raw = safeString(value)
  if (!raw) return null

  const normalized = raw.toLowerCase()
  const atIndex = normalized.indexOf('@')
  if (atIndex > 0) {
    const localPart = normalized.slice(0, atIndex).trim()
    const domainPart = normalized.slice(atIndex + 1).trim()
    if (!localPart || !domainPart) return null

    if (domainPart === 's.whatsapp.net' || domainPart === 'c.us' || domainPart === 'lid') {
      return `${localPart}@${domainPart}`
    }

    return null
  }

  const digits = normalized.replace(/[^0-9]/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}

function buildInboundContactCandidates(contact: string): string[] {
  const candidates = new Set<string>()
  const normalized = contact.toLowerCase()
  candidates.add(normalized)

  const atIndex = normalized.indexOf('@')
  if (atIndex > 0) {
    const localPart = normalized.slice(0, atIndex)
    const digits = localPart.split(':')[0].replace(/[^0-9]/g, '')
    if (digits.length >= 10 && digits.length <= 15) {
      candidates.add(digits)
      candidates.add(`+${digits}`)
      candidates.add(`${digits}@s.whatsapp.net`)
      candidates.add(`${digits}@c.us`)
    }
  } else {
    const digits = normalized.replace(/[^0-9]/g, '')
    if (digits.length >= 10 && digits.length <= 15) {
      candidates.add(digits)
      candidates.add(`+${digits}`)
      candidates.add(`${digits}@s.whatsapp.net`)
      candidates.add(`${digits}@c.us`)
    }
  }

  return Array.from(candidates)
}

function isDebugRouteEnabled(env: Bindings): boolean {
  const appEnv = safeString(env.APP_ENV)?.toLowerCase()
  return appEnv === 'development' || appEnv === 'dev' || appEnv === 'preview' || appEnv === 'staging'
}

async function resolveInboundUserByContact(env: Bindings, contact: string) {
  const candidates = buildInboundContactCandidates(contact)
  if (!candidates.length) return null

  const placeholders = candidates.map(() => '?').join(', ')
  const query = `SELECT * FROM users WHERE phone IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`
  const user = await env.DB.prepare(query).bind(...candidates).first<{
    id: string
    name: string | null
    phone: string | null
    marketing_opt_in?: number | null
  }>()
  return user ?? null
}

async function sendNewsletterAgentWhatsAppReply(
  env: Bindings,
  destinationContact: string,
  message: string,
  sessionId: string
): Promise<{ ok: boolean; status: number; responsePreview: string }> {
  const dispatchUrl = await resolveDispatchUrl('whatsapp', env)
  const dispatchToken = safeString(env.DISPATCH_BEARER_TOKEN)

  if (!dispatchUrl || !dispatchToken) {
    return {
      ok: false,
      status: 500,
      responsePreview: 'WhatsApp dispatch is not configured for newsletter agent.',
    }
  }

  const payload = {
    channel: 'whatsapp',
    campaign: {
      id: 'newsletter-agent',
      name: 'Newsletter Conversational Agent',
    },
    user: {
      id: `newsletter-session-${sessionId}`,
      phone: destinationContact,
      preferredChannel: 'whatsapp',
    },
    message,
    metadata: {
      source: 'newsletter_conversation_agent',
      sessionId,
    },
  }

  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dispatchToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    responsePreview: responseText.slice(0, 500),
  }
}

async function sendServiceAgentWhatsAppReply(
  env: Bindings,
  destinationContact: string,
  message: string,
  sessionId: string
): Promise<{ ok: boolean; status: number; responsePreview: string }> {
  const dispatchUrl = await resolveDispatchUrl('whatsapp', env)
  const dispatchToken = safeString(env.DISPATCH_BEARER_TOKEN)

  if (!dispatchUrl || !dispatchToken) {
    return {
      ok: false,
      status: 500,
      responsePreview: 'WhatsApp dispatch is not configured for service agent.',
    }
  }

  const payload = {
    channel: 'whatsapp',
    campaign: {
      id: 'service-agent',
      name: 'Service Conversational Agent',
    },
    user: {
      id: `service-session-${sessionId}`,
      phone: destinationContact,
      preferredChannel: 'whatsapp',
    },
    message,
    metadata: {
      source: 'service_conversation_agent',
      sessionId,
    },
  }

  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dispatchToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    responsePreview: responseText.slice(0, 500),
  }
}

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
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized
  if (!isDebugRouteEnabled(c.env)) return c.json({ error: 'Not found' }, 404)

  try {
    const res = await fetch('https://wainews.com.br/webhooks/gateway/groups')
    const text = await res.text()
    return c.json({ status: res.status, text })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

api.get('/test-fetch-ip', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized
  if (!isDebugRouteEnabled(c.env)) return c.json({ error: 'Not found' }, 404)

  try {
    const res = await fetch('http://168.231.94.189/health')
    const text = await res.text()
    return c.json({ status: res.status, text })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// WhatsApp inbound webhook for newsletter conversational agent
api.post('/webhooks/whatsapp/inbound', async (c) => {
  const configuredToken = safeString(c.env.DISPATCH_BEARER_TOKEN)
  if (!configuredToken) {
    return c.json({ error: 'DISPATCH_BEARER_TOKEN is not configured.' }, 500)
  }

  const providedToken = extractBearerToken(c.req.header('authorization') ?? null)
  if (!providedToken || !constantTimeEqual(providedToken, configuredToken)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = (await c.req.json().catch(() => null)) as
    | Partial<{
        sourceContact: string
        from: string
        contact: string
        message: string
        text: string
        user: {
          phone?: string
          name?: string
          id?: string
        }
        messageId: string
        timestamp: string
      }>
    | null

  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  const inboundMessage = safeString(body.message ?? body.text)
  const normalizedContact = normalizeWhatsAppInboundContact(
    body.sourceContact ?? body.from ?? body.contact ?? body.user?.phone
  )

  if (!normalizedContact) {
    return c.json({ error: 'Missing or invalid source contact.' }, 400)
  }

  if (!inboundMessage) {
    return c.json({ error: 'Missing inbound message text.' }, 400)
  }

  const inboundUser = await resolveInboundUserByContact(c.env, normalizedContact)
  const customerName = safeString(body.user?.name) ?? safeString(inboundUser?.name)

  let session = await getLatestNewsletterConversationSessionByContact(c.env, normalizedContact)
  if (!session) {
    session = await createNewsletterConversationSession(c.env, {
      userId: inboundUser?.id ?? null,
      sourceChannel: 'whatsapp',
      sourceContact: normalizedContact,
      status: 'active',
    })
  } else if (!session.user_id && inboundUser?.id) {
    const updatedSession = await updateNewsletterConversationSession(c.env, session.id, {
      userId: inboundUser.id,
    })
    if (updatedSession) session = updatedSession
  }

  const history = await listNewsletterConversationMessages(c.env, session.id, 30)
  const agentReply = await generateNewsletterAgentReply(c.env, {
    customerName,
    inboundMessage,
    history,
  })

  const nowIso = new Date().toISOString()

  await appendNewsletterConversationMessage(c.env, {
    sessionId: session.id,
    direction: 'inbound',
    messageText: inboundMessage,
    sentimentScore: agentReply.sentiment.score,
    sentimentLabel: agentReply.sentiment.label,
    metadata: {
      source: 'gateway_inbound',
      messageId: safeString(body.messageId),
      timestamp: safeString(body.timestamp),
    },
  })

  let sessionStatus = session.status
  if (agentReply.shouldOptOut) {
    sessionStatus = 'opt_out'
  } else if (agentReply.shouldConvert) {
    sessionStatus = 'converted'
  } else if (sessionStatus !== 'opt_out' && sessionStatus !== 'converted') {
    sessionStatus = 'active'
  }

  const feedbackRating = agentReply.feedbackRating ?? session.feedback_rating
  const convertedAt =
    sessionStatus === 'converted' ? safeString(session.converted_at) ?? nowIso : safeString(session.converted_at)

  const updatedAfterInbound = await updateNewsletterConversationSession(c.env, session.id, {
    userId: session.user_id ?? inboundUser?.id ?? null,
    status: sessionStatus,
    sentimentScore: agentReply.sentiment.score,
    sentimentLabel: agentReply.sentiment.label,
    feedbackRating,
    convertedAt,
    lastMessageAt: nowIso,
  })
  if (updatedAfterInbound) session = updatedAfterInbound

  if (inboundUser?.id) {
    if (sessionStatus === 'converted') {
      await setUserMarketingConsent(c.env, inboundUser.id, true, 'newsletter_agent_convert')
    }
    if (sessionStatus === 'opt_out') {
      await setUserMarketingConsent(c.env, inboundUser.id, false, 'newsletter_agent_optout')
    }
  }

  const dispatchResult = await sendNewsletterAgentWhatsAppReply(
    c.env,
    normalizedContact,
    agentReply.replyText,
    session.id
  )

  if (!dispatchResult.ok) {
    await appendNewsletterConversationMessage(c.env, {
      sessionId: session.id,
      direction: 'system',
      messageText: `Falha ao enviar resposta do agente (HTTP ${dispatchResult.status}).`,
      metadata: {
        responsePreview: dispatchResult.responsePreview,
      },
    })

    return c.json(
      {
        error: 'Failed to dispatch newsletter agent response.',
        statusCode: dispatchResult.status,
        details: dispatchResult.responsePreview,
        sessionId: session.id,
      },
      502
    )
  }

  await appendNewsletterConversationMessage(c.env, {
    sessionId: session.id,
    direction: 'agent',
    messageText: agentReply.replyText,
    aiModel: DEFAULT_AI_MODEL,
    metadata: {
      intent: agentReply.intent,
      feedbackRating: agentReply.feedbackRating,
      dispatchStatus: dispatchResult.status,
    },
  })

  await updateNewsletterConversationSession(c.env, session.id, {
    status: sessionStatus,
    sentimentScore: agentReply.sentiment.score,
    sentimentLabel: agentReply.sentiment.label,
    feedbackRating,
    convertedAt,
    lastMessageAt: nowIso,
  })

  const storedMessages = await listNewsletterConversationMessages(c.env, session.id, 100)

  return c.json({
    status: 'success',
    sessionId: session.id,
    sessionStatus,
    intent: agentReply.intent,
    sentiment: agentReply.sentiment,
    feedbackRating,
    reply: agentReply.replyText,
    messagesStored: storedMessages.length,
  })
})

// WhatsApp inbound webhook for service conversational agent
api.post('/webhooks/whatsapp/services/inbound', async (c) => {
  const configuredToken = safeString(c.env.DISPATCH_BEARER_TOKEN)
  if (!configuredToken) {
    return c.json({ error: 'DISPATCH_BEARER_TOKEN is not configured.' }, 500)
  }

  const providedToken = extractBearerToken(c.req.header('authorization') ?? null)
  if (!providedToken || !constantTimeEqual(providedToken, configuredToken)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = (await c.req.json().catch(() => null)) as
    | Partial<{
        sourceContact: string
        from: string
        contact: string
        message: string
        text: string
        user: {
          phone?: string
          name?: string
          id?: string
        }
        messageId: string
        timestamp: string
      }>
    | null

  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  const inboundMessage = safeString(body.message ?? body.text)
  const normalizedContact = normalizeWhatsAppInboundContact(
    body.sourceContact ?? body.from ?? body.contact ?? body.user?.phone
  )

  if (!normalizedContact) {
    return c.json({ error: 'Missing or invalid source contact.' }, 400)
  }

  if (!inboundMessage) {
    return c.json({ error: 'Missing inbound message text.' }, 400)
  }

  const inboundUser = await resolveInboundUserByContact(c.env, normalizedContact)
  const customerName = safeString(body.user?.name) ?? safeString(inboundUser?.name)

  let session = await getLatestServiceConversationSessionByContact(c.env, normalizedContact)
  if (!session) {
    session = await createServiceConversationSession(c.env, {
      userId: inboundUser?.id ?? null,
      sourceChannel: 'whatsapp',
      sourceContact: normalizedContact,
      status: 'active',
    })
  } else if (!session.user_id && inboundUser?.id) {
    const updatedSession = await updateServiceConversationSession(c.env, session.id, {
      userId: inboundUser.id,
    })
    if (updatedSession) session = updatedSession
  }

  const serviceAgentConfig = await getAdminServiceAgentConfig(c.env)
  const history = await listServiceConversationMessages(c.env, session.id, 30)

  if (!serviceAgentConfig.autoReplyEnabled) {
    const nowIso = new Date().toISOString()
    const manualIntent = detectServiceIntent(inboundMessage)
    const manualSentiment = analyzeServiceSentiment(inboundMessage)
    const manualStatus = manualIntent === 'opt_out' ? 'opt_out' : 'active'

    await appendServiceConversationMessage(c.env, {
      sessionId: session.id,
      direction: 'inbound',
      messageText: inboundMessage,
      intent: manualIntent,
      sentimentScore: manualSentiment.score,
      sentimentLabel: manualSentiment.label,
      metadata: {
        source: 'gateway_inbound',
        messageId: safeString(body.messageId),
        timestamp: safeString(body.timestamp),
        autoReplyEnabled: false,
      },
    })

    await updateServiceConversationSession(c.env, session.id, {
      userId: session.user_id ?? inboundUser?.id ?? null,
      status: manualStatus,
      latestIntent: manualIntent,
      sentimentScore: manualSentiment.score,
      sentimentLabel: manualSentiment.label,
      lastMessageAt: nowIso,
    })

    if (inboundUser?.id && manualIntent === 'opt_out') {
      await setUserMarketingConsent(c.env, inboundUser.id, false, 'service_agent_optout')
    }

    await appendServiceConversationMessage(c.env, {
      sessionId: session.id,
      direction: 'system',
      messageText:
        'Auto reply desativado no painel. Mensagem inbound registrada para tratamento manual.',
      metadata: {
        source: 'service_agent_config',
      },
    })

    const storedMessages = await listServiceConversationMessages(c.env, session.id, 100)

    return c.json(
      {
        status: 'manual_queue',
        sessionId: session.id,
        sessionStatus: manualStatus,
        intent: manualIntent,
        sentiment: manualSentiment,
        reply: null,
        messagesStored: storedMessages.length,
      },
      202
    )
  }

  const agentReply = await generateServiceAgentReply(c.env, {
    customerName,
    inboundMessage,
    history,
    config: serviceAgentConfig,
  })

  const nowIso = new Date().toISOString()

  await appendServiceConversationMessage(c.env, {
    sessionId: session.id,
    direction: 'inbound',
    messageText: inboundMessage,
    intent: agentReply.intent,
    sentimentScore: agentReply.sentiment.score,
    sentimentLabel: agentReply.sentiment.label,
    metadata: {
      source: 'gateway_inbound',
      messageId: safeString(body.messageId),
      timestamp: safeString(body.timestamp),
    },
  })

  const appointmentRecord =
    serviceAgentConfig.autoCreateAppointments &&
    agentReply.shouldCreateAppointment &&
    agentReply.appointmentDraft
      ? await createServiceAppointment(c.env, {
          sessionId: session.id,
          userId: session.user_id ?? inboundUser?.id ?? null,
          sourceContact: normalizedContact,
          serviceType: agentReply.appointmentDraft.serviceType,
          requestedDate: agentReply.appointmentDraft.requestedDate,
          requestedTime: agentReply.appointmentDraft.requestedTime,
          timezone: agentReply.appointmentDraft.timezone,
          notes: agentReply.appointmentDraft.notes,
          status: 'pending',
        })
      : null

  const quoteRecord =
    serviceAgentConfig.autoCreateQuotes &&
    agentReply.shouldCreateQuote &&
    agentReply.quoteDraft
      ? await createServiceQuote(c.env, {
          sessionId: session.id,
          userId: session.user_id ?? inboundUser?.id ?? null,
          sourceContact: normalizedContact,
          serviceType: agentReply.quoteDraft.serviceType,
          budgetRange: agentReply.quoteDraft.budgetRange,
          timeline: agentReply.quoteDraft.timeline,
          details: agentReply.quoteDraft.details,
          status: 'requested',
        })
      : null

  const sessionStatus = agentReply.shouldOptOut
    ? 'opt_out'
    : appointmentRecord
      ? 'scheduled'
      : quoteRecord
        ? 'quoted'
        : agentReply.sessionStatus

  const updatedAfterInbound = await updateServiceConversationSession(c.env, session.id, {
    userId: session.user_id ?? inboundUser?.id ?? null,
    status: sessionStatus,
    latestIntent: agentReply.intent,
    sentimentScore: agentReply.sentiment.score,
    sentimentLabel: agentReply.sentiment.label,
    lastMessageAt: nowIso,
  })
  if (updatedAfterInbound) session = updatedAfterInbound

  if (inboundUser?.id) {
    if (agentReply.shouldOptOut) {
      await setUserMarketingConsent(c.env, inboundUser.id, false, 'service_agent_optout')
    } else if (appointmentRecord || quoteRecord) {
      await setUserMarketingConsent(c.env, inboundUser.id, true, 'service_agent_intent_capture')
    }
  }

  const dispatchResult = await sendServiceAgentWhatsAppReply(
    c.env,
    normalizedContact,
    agentReply.replyText,
    session.id
  )

  if (!dispatchResult.ok) {
    await appendServiceConversationMessage(c.env, {
      sessionId: session.id,
      direction: 'system',
      messageText: `Falha ao enviar resposta do agente de servicos (HTTP ${dispatchResult.status}).`,
      metadata: {
        responsePreview: dispatchResult.responsePreview,
      },
    })

    return c.json(
      {
        error: 'Failed to dispatch service agent response.',
        statusCode: dispatchResult.status,
        details: dispatchResult.responsePreview,
        sessionId: session.id,
      },
      502
    )
  }

  await appendServiceConversationMessage(c.env, {
    sessionId: session.id,
    direction: 'agent',
    messageText: agentReply.replyText,
    intent: agentReply.intent,
    sentimentScore: agentReply.sentiment.score,
    sentimentLabel: agentReply.sentiment.label,
    aiModel: serviceAgentConfig.aiModel,
    metadata: {
      dispatchStatus: dispatchResult.status,
      appointmentId: appointmentRecord?.id ?? null,
      quoteId: quoteRecord?.id ?? null,
    },
  })

  await updateServiceConversationSession(c.env, session.id, {
    status: sessionStatus,
    latestIntent: agentReply.intent,
    sentimentScore: agentReply.sentiment.score,
    sentimentLabel: agentReply.sentiment.label,
    lastMessageAt: nowIso,
  })

  const storedMessages = await listServiceConversationMessages(c.env, session.id, 100)

  return c.json({
    status: 'success',
    sessionId: session.id,
    sessionStatus,
    intent: agentReply.intent,
    sentiment: agentReply.sentiment,
    reply: agentReply.replyText,
    appointmentId: appointmentRecord?.id ?? null,
    quoteId: quoteRecord?.id ?? null,
    messagesStored: storedMessages.length,
  })
})

export { api }

// ── Journey API Routes ──────────────────────────────────────────

// Create Journey
api.post('/journey', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => null)) as Partial<{
    id: string
    name: string
    objective: string
    systemPrompt: string
  }> | null

  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  if (!safeString(body.name) || !safeString(body.objective) || !safeString(body.systemPrompt)) {
    return c.json({ error: 'name, objective, and systemPrompt are required' }, 400)
  }

  const personaId = await createPersonaRecord(c.env, {
    name: `API Persona (${safeString(body.name)})`,
    baseTone: 'amigável',
    systemPrompt: safeString(body.systemPrompt)!
  })
  
  const productId = await createProductRecord(c.env, {
    name: `API Produto (${safeString(body.name)})`,
    description: safeString(body.objective)!
  })

  const journeyId = await createJourneyRecord(c.env, {
    id: body.id,
    name: safeString(body.name)!,
    personaId,
    productId,
  })

  return c.json({ status: 'success', journeyId }, 201)
})

// List Journeys
api.get('/journeys', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized
  const journeys = await listJourneys(c.env)
  return c.json({ journeys })
})

// Get Journey by ID
api.get('/journey/:id', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized
  const journey = await getJourneyById(c.env, c.req.param('id'))
  if (!journey) return c.json({ error: 'Journey not found' }, 404)
  return c.json(journey)
})

// Update Journey
api.put('/journey/:id', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => null)) as Partial<{
    name: string
    objective: string
    systemPrompt: string
  }> | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  // Since updating structured sub-entities via simple legacy payload is complex,
  // we either map them or just fail gracefully. For now, we omit the objective/prompt update.
  const payload: any = { name: safeString(body.name) }

  const updated = await updateJourneyRecord(c.env, c.req.param('id'), payload)
  if (!updated) return c.json({ error: 'Journey not found' }, 404)
  return c.json({ status: 'success' })
})

// Toggle Journey Status
api.post('/journey/:id/toggle', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const journey = await getJourneyById(c.env, c.req.param('id'))
  if (!journey) return c.json({ error: 'Journey not found' }, 404)

  const newStatus = journey.status === 'active' ? 'paused' : 'active'
  await updateJourneyStatus(c.env, journey.id, newStatus)
  return c.json({ status: 'success', newStatus })
})

// Enroll User in Journey
api.post('/journey/:id/enroll', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => null)) as Partial<{
    userId: string
    phase: JourneyPhase
  }> | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  const userId = safeString(body.userId)
  if (!userId) return c.json({ error: 'userId is required' }, 400)

  const user = await getUserById(c.env, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const journey = await getJourneyById(c.env, c.req.param('id'))
  if (!journey) return c.json({ error: 'Journey not found' }, 404)

  const enrollment = await enrollUserInJourney(c.env, {
    userId,
    journeyId: journey.id,
    phase: body.phase,
  })

  return c.json({ status: 'success', enrollment }, 201)
})

// List Journey Enrollments
api.get('/journey/:id/enrollments', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const enrollments = await listJourneyEnrollments(c.env, c.req.param('id'))
  return c.json({ enrollments })
})

// Advance Journey Phase
api.post('/journey/:journeyId/user/:userId/advance', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const result = await advanceJourneyPhase(c.env, c.req.param('userId'), c.req.param('journeyId'))
  if (!result.advanced && !result.completed) {
    return c.json({ error: 'Enrollment not found' }, 404)
  }
  return c.json({ status: 'success', ...result })
})

// Persona Conversation — send a message within a journey context
api.post('/journey/:journeyId/user/:userId/chat', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => null)) as Partial<{ message: string }> | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  const message = safeString(body.message)
  if (!message) return c.json({ error: 'message is required' }, 400)

  const journeyId = c.req.param('journeyId')
  const userId = c.req.param('userId')

  const [journey, user, enrollment] = await Promise.all([
    getJourneyById(c.env, journeyId),
    getUserById(c.env, userId),
    getEnrollment(c.env, userId, journeyId),
  ])

  if (!journey) return c.json({ error: 'Journey not found' }, 404)
  if (!user) return c.json({ error: 'User not found' }, 404)
  if (!enrollment) return c.json({ error: 'User is not enrolled in this journey' }, 404)

  const result = await runPersonaConversation(c.env, journey, user, enrollment, message)

  return c.json({
    status: 'success',
    response: result.response,
    phaseAdvanced: result.phaseAdvanced,
    currentPhase: result.newPhase,
  })
})

// Generate opening message for a journey
api.post('/journey/:journeyId/user/:userId/open', async (c) => {
  const unauthorized = ensureAdminAccess(c)
  if (unauthorized) return unauthorized

  const journeyId = c.req.param('journeyId')
  const userId = c.req.param('userId')

  const [journey, user] = await Promise.all([
    getJourneyById(c.env, journeyId),
    getUserById(c.env, userId),
  ])

  if (!journey) return c.json({ error: 'Journey not found' }, 404)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const message = await generateJourneyOpeningMessage(c.env, journey, user)
  return c.json({ status: 'success', message })
})

// ── Playground API Routes ───────────────────────────────────────

// -- Telegram Webhook for Conversational Agent -----------------------------

api.post('/webhooks/telegram/inbound', async (c) => {
  const body = (await c.req.json().catch(() => null)) as TelegramWebhookUpdate | null

  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  // Get Telegram configuration
  const telegramConfig = await getAdminTelegramIntegrationConfig(c.env)

  if (!telegramConfig.conversationEnabled) {
    return c.json({ status: 'conversations_disabled' }, 200)
  }

  // Handle the webhook
  const result = await handleTelegramWebhook(c.env, body, {
    aiModel: telegramConfig.aiModel,
    maxReplyChars: telegramConfig.maxReplyChars,
    conversationEnabled: telegramConfig.conversationEnabled,
  })

  if (!result.shouldReply || !result.replyText) {
    return c.json({ status: 'no_reply_needed' }, 200)
  }

  // Send reply via Telegram API
  const chatId = body.message?.chat.id.toString()
  if (!chatId) {
    return c.json({ error: 'Missing chat ID' }, 400)
  }

  const sendResult = await sendTelegramMessage(c.env, chatId, result.replyText)

  if (!sendResult) {
    return c.json({ error: 'Failed to send Telegram message' }, 502)
  }

  return c.json({
    status: 'success',
    sessionId: result.sessionId,
    reply: result.replyText,
  })
})

// -- Playground API Routes ------------------------------------------------
