import type {
  Bindings,
  AIInferenceOverview,
  AIInferenceFlowMetrics,
  UserRecord,
  InteractionPayload,
  CampaignCreateInput,
  JourneyRecord,
  PersonaRecord,
  ProductRecord,
  PersonaCreateInput,
  ProductCreateInput,
  JourneyEnrollment,
  JourneyCreateInput,
  JourneyEnrollInput,
  JourneyPhase,
  JourneyConversationMessage,
  NewsletterConversationSessionRecord,
  NewsletterConversationMessageRecord,
  NewsletterConversationDirection,
  NewsletterConversationStatus,
  NewsletterSentimentLabel,
  NewsletterAgentOverview,
  NewsletterAgentRecentSession,
  ServiceConversationSessionRecord,
  ServiceConversationMessageRecord,
  ServiceConversationDirection,
  ServiceConversationStatus,
  ServiceAgentIntent,
  ServiceAppointmentRecord,
  ServiceQuoteRecord,
  ServiceAppointmentStatus,
  ServiceQuoteStatus,
  ServiceAgentOverview,
  ServiceAgentRecentSession,
  TelegramConversationSessionRecord,
  TelegramConversationMessageRecord,
  TelegramConversationDirection,
  TelegramConversationStatus,
} from './types'
import { JOURNEY_PHASES } from './types'
import { EVENT_WEIGHTS } from './constants'
import { toNumber, safeString, toBoolean, buildReferralCode, resolveConsentSource } from './utils'

function percentile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const rest = position - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

export async function getUserById(env: Bindings, id: string): Promise<UserRecord | null> {
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRecord>()
  return user ?? null
}

export async function logInteraction(env: Bindings, payload: InteractionPayload): Promise<void> {
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

export async function logAgentDecision(
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

export async function createUserRecord(
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

export async function createCampaignRecord(env: Bindings, input: CampaignCreateInput): Promise<string> {
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

export async function getOverviewMetrics(env: Bindings): Promise<{
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

export async function getAIInferenceOverview(
  env: Bindings,
  rangeHours: number
): Promise<AIInferenceOverview> {
  const hours = Math.max(1, Math.min(168, Math.floor(rangeHours)))
  const rows = await env.DB.prepare(
    `SELECT flow, status, fallback_used, latency_ms, created_at
     FROM ai_inference_logs
     WHERE created_at >= datetime('now', ?)
     ORDER BY created_at DESC`
  )
    .bind(`-${hours} hours`)
    .all<{
      flow: string
      status: 'success' | 'error'
      fallback_used: number
      latency_ms: number
      created_at: string
    }>()

  const records = rows.results ?? []
  const flowMap = new Map<string, {
    latencies: number[]
    total: number
    success: number
    error: number
    fallback: number
    lastSeenAt: string | null
  }>()

  const globalLatencies: number[] = []
  let globalTotal = 0
  let globalSuccess = 0
  let globalError = 0
  let globalFallback = 0

  for (const row of records) {
    const flow = row.flow || 'unknown'
    const status = row.status === 'error' ? 'error' : 'success'
    const fallbackUsed = toNumber(row.fallback_used) === 1
    const latencyMs = Math.max(0, toNumber(row.latency_ms))
    const createdAt = safeString(row.created_at)

    globalTotal += 1
    if (status === 'success') globalSuccess += 1
    if (status === 'error') globalError += 1
    if (fallbackUsed) globalFallback += 1
    globalLatencies.push(latencyMs)

    const existing = flowMap.get(flow) ?? {
      latencies: [],
      total: 0,
      success: 0,
      error: 0,
      fallback: 0,
      lastSeenAt: null,
    }

    existing.total += 1
    if (status === 'success') existing.success += 1
    if (status === 'error') existing.error += 1
    if (fallbackUsed) existing.fallback += 1
    existing.latencies.push(latencyMs)
    if (!existing.lastSeenAt || (createdAt && createdAt > existing.lastSeenAt)) {
      existing.lastSeenAt = createdAt ?? existing.lastSeenAt
    }

    flowMap.set(flow, existing)
  }

  const flows: AIInferenceFlowMetrics[] = Array.from(flowMap.entries())
    .map(([flow, stats]) => {
      const total = stats.total
      const latencySum = stats.latencies.reduce((acc, v) => acc + v, 0)
      return {
        flow,
        total,
        success: stats.success,
        error: stats.error,
        errorRate: total > 0 ? stats.error / total : 0,
        fallback: stats.fallback,
        fallbackRate: total > 0 ? stats.fallback / total : 0,
        latencyAvgMs: total > 0 ? latencySum / total : 0,
        latencyP50Ms: percentile(stats.latencies, 0.5),
        latencyP95Ms: percentile(stats.latencies, 0.95),
        lastSeenAt: stats.lastSeenAt,
      }
    })
    .sort((a, b) => b.total - a.total)

  const globalLatencySum = globalLatencies.reduce((acc, v) => acc + v, 0)

  return {
    rangeHours: hours,
    generatedAt: new Date().toISOString(),
    totals: {
      total: globalTotal,
      success: globalSuccess,
      error: globalError,
      errorRate: globalTotal > 0 ? globalError / globalTotal : 0,
      fallback: globalFallback,
      fallbackRate: globalTotal > 0 ? globalFallback / globalTotal : 0,
      latencyAvgMs: globalTotal > 0 ? globalLatencySum / globalTotal : 0,
      latencyP50Ms: percentile(globalLatencies, 0.5),
      latencyP95Ms: percentile(globalLatencies, 0.95),
    },
    flows,
  }
}

// ── Journey CRUD ────────────────────────────────────────────────

export async function createJourneyRecord(env: Bindings, input: JourneyCreateInput): Promise<string> {
  const journeyId = safeString(input.id) ?? crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO journeys (id, name, persona_id, product_id)
     VALUES (?, ?, ?, ?)`
  )
    .bind(journeyId, input.name, input.personaId, input.productId)
    .run()
  return journeyId
}

export async function getJourneyById(env: Bindings, id: string): Promise<JourneyRecord | null> {
  const journey = await env.DB.prepare(
    `SELECT j.*, 
            pe.name as persona_name, pe.system_prompt, pe.base_tone,
            pr.name as product_name, pr.description as objective, pr.conversion_url
     FROM journeys j 
     LEFT JOIN personas pe ON j.persona_id = pe.id
     LEFT JOIN products pr ON j.product_id = pr.id
     WHERE j.id = ?`
  )
    .bind(id)
    .first<JourneyRecord>()
  return journey ?? null
}

export async function listJourneys(env: Bindings): Promise<JourneyRecord[]> {
  const result = await env.DB.prepare(
    `SELECT j.*, 
            pe.name as persona_name, pe.system_prompt, pe.base_tone,
            pr.name as product_name, pr.description as objective, pr.conversion_url
     FROM journeys j 
     LEFT JOIN personas pe ON j.persona_id = pe.id
     LEFT JOIN products pr ON j.product_id = pr.id
     ORDER BY j.created_at DESC LIMIT 50`
  ).all<JourneyRecord>()
  return result.results ?? []
}

export async function updateJourneyStatus(
  env: Bindings,
  journeyId: string,
  status: 'active' | 'paused'
): Promise<boolean> {
  const existing = await getJourneyById(env, journeyId)
  if (!existing) return false
  await env.DB.prepare('UPDATE journeys SET status = ? WHERE id = ?')
    .bind(status, journeyId)
    .run()
  return true
}

export async function updateJourneyRecord(
  env: Bindings,
  journeyId: string,
  input: Partial<JourneyCreateInput>
): Promise<boolean> {
  const existing = await getJourneyById(env, journeyId)
  if (!existing) return false

  const name = safeString(input.name) ?? existing.name
  const personaId = safeString(input.personaId) ?? existing.persona_id
  const productId = safeString(input.productId) ?? existing.product_id

  await env.DB.prepare(
    'UPDATE journeys SET name = ?, persona_id = ?, product_id = ? WHERE id = ?'
  )
    .bind(name, personaId, productId, journeyId)
    .run()
  return true
}

// ── Personas & Products ────────────────────────────────────────────────

export async function createPersonaRecord(env: Bindings, input: PersonaCreateInput): Promise<string> {
  const personaId = safeString(input.id) ?? crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO personas (id, name, base_tone, system_prompt, interaction_constraints)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(personaId, input.name, input.baseTone, input.systemPrompt, input.interactionConstraints ?? null)
    .run()
  return personaId
}

export async function listPersonas(env: Bindings): Promise<PersonaRecord[]> {
  const result = await env.DB.prepare('SELECT * FROM personas ORDER BY created_at DESC LIMIT 100').all<PersonaRecord>()
  return result.results ?? []
}

export async function createProductRecord(env: Bindings, input: ProductCreateInput): Promise<string> {
  const productId = safeString(input.id) ?? crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO products (id, name, description, pricing_details, conversion_url, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(productId, input.name, input.description, input.pricingDetails ?? null, input.conversionUrl ?? null, input.metadata ?? null)
    .run()
  return productId
}

export async function listProducts(env: Bindings): Promise<ProductRecord[]> {
  const result = await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 100').all<ProductRecord>()
  return result.results ?? []
}

// ── Journey Enrollments ─────────────────────────────────────────

export async function enrollUserInJourney(
  env: Bindings,
  input: JourneyEnrollInput
): Promise<JourneyEnrollment> {
  const phase: JourneyPhase = input.phase ?? 'discovery'
  await env.DB.prepare(
    `INSERT INTO journey_enrollments (user_id, journey_id, current_phase, conversation_history)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, journey_id) DO UPDATE SET
       current_phase = excluded.current_phase,
       last_interaction_at = CURRENT_TIMESTAMP`
  )
    .bind(input.userId, input.journeyId, phase, '[]')
    .run()
  return {
    user_id: input.userId,
    journey_id: input.journeyId,
    current_phase: phase,
    conversation_history: '[]',
  }
}

export async function getEnrollment(
  env: Bindings,
  userId: string,
  journeyId: string
): Promise<JourneyEnrollment | null> {
  const enrollment = await env.DB.prepare(
    'SELECT * FROM journey_enrollments WHERE user_id = ? AND journey_id = ?'
  )
    .bind(userId, journeyId)
    .first<JourneyEnrollment>()
  return enrollment ?? null
}

export async function listJourneyEnrollments(
  env: Bindings,
  journeyId: string
): Promise<JourneyEnrollment[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM journey_enrollments WHERE journey_id = ? ORDER BY last_interaction_at DESC LIMIT 100'
  ).bind(journeyId).all<JourneyEnrollment>()
  return result.results ?? []
}

export async function listUserEnrollments(
  env: Bindings,
  userId: string
): Promise<(JourneyEnrollment & { journey_name?: string; journey_status?: string })[]> {
  const result = await env.DB.prepare(
    `SELECT je.*, j.name AS journey_name, j.status AS journey_status
     FROM journey_enrollments je
     JOIN journeys j ON j.id = je.journey_id
     WHERE je.user_id = ?
     ORDER BY je.last_interaction_at DESC`
  ).bind(userId).all<JourneyEnrollment & { journey_name?: string; journey_status?: string }>()
  return result.results ?? []
}

export async function advanceJourneyPhase(
  env: Bindings,
  userId: string,
  journeyId: string
): Promise<{ advanced: boolean; newPhase: JourneyPhase | null; completed: boolean }> {
  const enrollment = await getEnrollment(env, userId, journeyId)
  if (!enrollment) return { advanced: false, newPhase: null, completed: false }

  const currentIndex = JOURNEY_PHASES.indexOf(enrollment.current_phase)
  if (currentIndex === -1 || currentIndex >= JOURNEY_PHASES.length - 1) {
    return { advanced: false, newPhase: enrollment.current_phase, completed: true }
  }

  const newPhase = JOURNEY_PHASES[currentIndex + 1]
  await env.DB.prepare(
    `UPDATE journey_enrollments
     SET current_phase = ?, last_interaction_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND journey_id = ?`
  )
    .bind(newPhase, userId, journeyId)
    .run()

  await logAgentDecision(env, 'journey_phase_advance', userId, `Phase advanced to ${newPhase}`, {
    journeyId,
    from: enrollment.current_phase,
    to: newPhase,
  })

  return { advanced: true, newPhase, completed: newPhase === 'retained' }
}

// ── Conversation History ────────────────────────────────────────

export function parseConversationHistory(raw: string | null | undefined): JourneyConversationMessage[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function appendConversationMessage(
  env: Bindings,
  userId: string,
  journeyId: string,
  message: JourneyConversationMessage
): Promise<JourneyConversationMessage[]> {
  const enrollment = await getEnrollment(env, userId, journeyId)
  if (!enrollment) return []

  const history = parseConversationHistory(enrollment.conversation_history)
  const stamped = { ...message, timestamp: message.timestamp ?? new Date().toISOString() }
  history.push(stamped)

  // Keep last 30 messages to avoid D1 row size limits
  const trimmed = history.slice(-30)

  await env.DB.prepare(
    `UPDATE journey_enrollments
     SET conversation_history = ?, last_interaction_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND journey_id = ?`
  )
    .bind(JSON.stringify(trimmed), userId, journeyId)
    .run()

  return trimmed
}

// ── Newsletter Conversational Agent ────────────────────────────

function isMissingNewsletterTableError(error: unknown): boolean {
  const text = String(error || '').toLowerCase()
  return (
    text.includes('no such table') &&
    (text.includes('newsletter_conversation_sessions') ||
      text.includes('newsletter_conversation_messages'))
  )
}

export async function getNewsletterConversationSessionById(
  env: Bindings,
  sessionId: string
): Promise<NewsletterConversationSessionRecord | null> {
  try {
    const session = await env.DB.prepare(
      'SELECT * FROM newsletter_conversation_sessions WHERE id = ?'
    )
      .bind(sessionId)
      .first<NewsletterConversationSessionRecord>()
    return session ?? null
  } catch (error) {
    if (isMissingNewsletterTableError(error)) return null
    throw error
  }
}

export async function getLatestNewsletterConversationSessionByContact(
  env: Bindings,
  sourceContact: string
): Promise<NewsletterConversationSessionRecord | null> {
  const normalizedContact = safeString(sourceContact)
  if (!normalizedContact) return null

  try {
    const session = await env.DB.prepare(
      `SELECT *
       FROM newsletter_conversation_sessions
       WHERE source_contact = ?
       ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
       LIMIT 1`
    )
      .bind(normalizedContact)
      .first<NewsletterConversationSessionRecord>()

    return session ?? null
  } catch (error) {
    if (isMissingNewsletterTableError(error)) return null
    throw error
  }
}

export async function createNewsletterConversationSession(
  env: Bindings,
  input: {
    userId?: string | null
    sourceChannel?: string | null
    sourceContact: string
    status?: NewsletterConversationStatus
  }
): Promise<NewsletterConversationSessionRecord> {
  const sessionId = crypto.randomUUID()
  const sourceContact = safeString(input.sourceContact)
  if (!sourceContact) {
    throw new Error('sourceContact is required to create newsletter conversation session')
  }

  const sourceChannel = safeString(input.sourceChannel) ?? 'whatsapp'
  const status = input.status ?? 'active'
  const now = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO newsletter_conversation_sessions (
      id,
      user_id,
      source_channel,
      source_contact,
      status,
      last_message_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sessionId, safeString(input.userId ?? null), sourceChannel, sourceContact, status, now, now, now)
    .run()

  const created = await getNewsletterConversationSessionById(env, sessionId)
  if (!created) {
    throw new Error('Failed to create newsletter conversation session')
  }
  return created
}

export async function updateNewsletterConversationSession(
  env: Bindings,
  sessionId: string,
  updates: Partial<{
    userId: string | null
    status: NewsletterConversationStatus
    sentimentScore: number | null
    sentimentLabel: NewsletterSentimentLabel | null
    feedbackRating: number | null
    feedbackText: string | null
    convertedAt: string | null
    lastMessageAt: string | null
  }>
): Promise<NewsletterConversationSessionRecord | null> {
  const existing = await getNewsletterConversationSessionById(env, sessionId)
  if (!existing) return null

  const nextUserId = updates.userId === undefined ? existing.user_id : safeString(updates.userId)
  const nextStatus = updates.status ?? existing.status
  const nextSentimentScore =
    updates.sentimentScore === undefined ? existing.sentiment_score : updates.sentimentScore
  const nextSentimentLabel =
    updates.sentimentLabel === undefined ? existing.sentiment_label : updates.sentimentLabel
  const nextFeedbackRating =
    updates.feedbackRating === undefined ? existing.feedback_rating : updates.feedbackRating
  const nextFeedbackText =
    updates.feedbackText === undefined ? existing.feedback_text : safeString(updates.feedbackText)
  const nextConvertedAt =
    updates.convertedAt === undefined ? existing.converted_at : safeString(updates.convertedAt)
  const nextLastMessageAt =
    updates.lastMessageAt === undefined
      ? existing.last_message_at
      : safeString(updates.lastMessageAt)

  await env.DB.prepare(
    `UPDATE newsletter_conversation_sessions
     SET user_id = ?,
         status = ?,
         sentiment_score = ?,
         sentiment_label = ?,
         feedback_rating = ?,
         feedback_text = ?,
         converted_at = ?,
         last_message_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      nextUserId,
      nextStatus,
      nextSentimentScore,
      nextSentimentLabel,
      nextFeedbackRating,
      nextFeedbackText,
      nextConvertedAt,
      nextLastMessageAt,
      sessionId
    )
    .run()

  return getNewsletterConversationSessionById(env, sessionId)
}

export async function appendNewsletterConversationMessage(
  env: Bindings,
  input: {
    sessionId: string
    direction: NewsletterConversationDirection
    messageText: string
    sentimentScore?: number | null
    sentimentLabel?: NewsletterSentimentLabel | null
    aiModel?: string | null
    metadata?: unknown
  }
): Promise<NewsletterConversationMessageRecord | null> {
  const sessionId = safeString(input.sessionId)
  const messageText = safeString(input.messageText)
  if (!sessionId || !messageText) {
    throw new Error('sessionId and messageText are required to append newsletter message')
  }

  await env.DB.prepare(
    `INSERT INTO newsletter_conversation_messages (
      session_id,
      direction,
      message_text,
      sentiment_score,
      sentiment_label,
      ai_model,
      metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      input.direction,
      messageText,
      input.sentimentScore ?? null,
      input.sentimentLabel ?? null,
      safeString(input.aiModel),
      input.metadata ? JSON.stringify(input.metadata) : null
    )
    .run()

  const message = await env.DB.prepare(
    `SELECT *
     FROM newsletter_conversation_messages
     WHERE session_id = ?
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(sessionId)
    .first<NewsletterConversationMessageRecord>()

  return message ?? null
}

export async function listNewsletterConversationMessages(
  env: Bindings,
  sessionId: string,
  limit = 100
): Promise<NewsletterConversationMessageRecord[]> {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  try {
    const result = await env.DB.prepare(
      `SELECT *
       FROM newsletter_conversation_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
      .bind(sessionId, boundedLimit)
      .all<NewsletterConversationMessageRecord>()

    return result.results ?? []
  } catch (error) {
    if (isMissingNewsletterTableError(error)) return []
    throw error
  }
}

export async function listNewsletterAgentRecentSessions(
  env: Bindings,
  limit = 30
): Promise<NewsletterAgentRecentSession[]> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  try {
    const result = await env.DB.prepare(
      `SELECT s.id,
              s.user_id,
              u.name AS user_name,
              s.source_contact,
              s.status,
              s.sentiment_score,
              s.sentiment_label,
              s.feedback_rating,
              s.last_message_at,
              (
                SELECT COUNT(*)
                FROM newsletter_conversation_messages m
                WHERE m.session_id = s.id
              ) AS message_count
       FROM newsletter_conversation_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY COALESCE(s.last_message_at, s.updated_at, s.created_at) DESC
       LIMIT ?`
    )
      .bind(boundedLimit)
      .all<{
        id: string
        user_id: string | null
        user_name: string | null
        source_contact: string
        status: NewsletterConversationStatus
        sentiment_score: number | null
        sentiment_label: NewsletterSentimentLabel | null
        feedback_rating: number | null
        last_message_at: string | null
        message_count: number
      }>()

    return (result.results ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      sourceContact: row.source_contact,
      status: row.status,
      sentimentScore: row.sentiment_score,
      sentimentLabel: row.sentiment_label,
      feedbackRating: row.feedback_rating,
      lastMessageAt: row.last_message_at,
      messageCount: toNumber(row.message_count),
    }))
  } catch (error) {
    if (isMissingNewsletterTableError(error)) return []
    throw error
  }
}

export async function getNewsletterAgentOverview(
  env: Bindings,
  recentLimit = 30
): Promise<NewsletterAgentOverview> {
  try {
    const totalsRow = await env.DB.prepare(
      `SELECT COUNT(*) AS total_sessions,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_sessions,
              SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted_sessions,
              SUM(CASE WHEN status = 'opt_out' THEN 1 ELSE 0 END) AS opt_out_sessions,
              AVG(sentiment_score) AS avg_sentiment,
              AVG(feedback_rating) AS avg_feedback
       FROM newsletter_conversation_sessions`
    ).first<{
      total_sessions: number
      active_sessions: number
      converted_sessions: number
      opt_out_sessions: number
      avg_sentiment: number | null
      avg_feedback: number | null
    }>()

    const bucketsRow = await env.DB.prepare(
      `SELECT SUM(CASE WHEN sentiment_label = 'positive' THEN 1 ELSE 0 END) AS positive,
              SUM(CASE WHEN sentiment_label = 'neutral' THEN 1 ELSE 0 END) AS neutral,
              SUM(CASE WHEN sentiment_label = 'negative' THEN 1 ELSE 0 END) AS negative
       FROM newsletter_conversation_sessions`
    ).first<{ positive: number; neutral: number; negative: number }>()

    const recentSessions = await listNewsletterAgentRecentSessions(env, recentLimit)

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        totalSessions: toNumber(totalsRow?.total_sessions),
        activeSessions: toNumber(totalsRow?.active_sessions),
        convertedSessions: toNumber(totalsRow?.converted_sessions),
        optOutSessions: toNumber(totalsRow?.opt_out_sessions),
        averageSentiment: Number(totalsRow?.avg_sentiment ?? 0),
        averageFeedback: Number(totalsRow?.avg_feedback ?? 0),
      },
      sentimentBuckets: {
        positive: toNumber(bucketsRow?.positive),
        neutral: toNumber(bucketsRow?.neutral),
        negative: toNumber(bucketsRow?.negative),
      },
      recentSessions,
    }
  } catch (error) {
    if (!isMissingNewsletterTableError(error)) throw error
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        totalSessions: 0,
        activeSessions: 0,
        convertedSessions: 0,
        optOutSessions: 0,
        averageSentiment: 0,
        averageFeedback: 0,
      },
      sentimentBuckets: {
        positive: 0,
        neutral: 0,
        negative: 0,
      },
      recentSessions: [],
    }
  }
}

// ── Service Conversational Agent (WhatsApp Services) ──────────

function isMissingServiceTableError(error: unknown): boolean {
  const text = String(error || '').toLowerCase()
  return (
    text.includes('no such table') &&
    (text.includes('service_conversation_sessions') ||
      text.includes('service_conversation_messages') ||
      text.includes('service_appointments') ||
      text.includes('service_quotes'))
  )
}

export async function getServiceConversationSessionById(
  env: Bindings,
  sessionId: string
): Promise<ServiceConversationSessionRecord | null> {
  try {
    const session = await env.DB.prepare(
      'SELECT * FROM service_conversation_sessions WHERE id = ?'
    )
      .bind(sessionId)
      .first<ServiceConversationSessionRecord>()

    return session ?? null
  } catch (error) {
    if (isMissingServiceTableError(error)) return null
    throw error
  }
}

export async function getLatestServiceConversationSessionByContact(
  env: Bindings,
  sourceContact: string
): Promise<ServiceConversationSessionRecord | null> {
  const normalizedContact = safeString(sourceContact)
  if (!normalizedContact) return null

  try {
    const session = await env.DB.prepare(
      `SELECT *
       FROM service_conversation_sessions
       WHERE source_contact = ?
       ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
       LIMIT 1`
    )
      .bind(normalizedContact)
      .first<ServiceConversationSessionRecord>()

    return session ?? null
  } catch (error) {
    if (isMissingServiceTableError(error)) return null
    throw error
  }
}

export async function createServiceConversationSession(
  env: Bindings,
  input: {
    userId?: string | null
    sourceChannel?: string | null
    sourceContact: string
    status?: ServiceConversationStatus
    latestIntent?: ServiceAgentIntent | null
    notes?: string | null
  }
): Promise<ServiceConversationSessionRecord> {
  const sessionId = crypto.randomUUID()
  const sourceContact = safeString(input.sourceContact)
  if (!sourceContact) {
    throw new Error('sourceContact is required to create service conversation session')
  }

  const sourceChannel = safeString(input.sourceChannel) ?? 'whatsapp'
  const status = input.status ?? 'active'
  const now = new Date().toISOString()

  try {
    await env.DB.prepare(
      `INSERT INTO service_conversation_sessions (
        id,
        user_id,
        source_channel,
        source_contact,
        status,
        latest_intent,
        notes,
        last_message_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sessionId,
        safeString(input.userId ?? null),
        sourceChannel,
        sourceContact,
        status,
        input.latestIntent ?? null,
        safeString(input.notes),
        now,
        now,
        now
      )
      .run()
  } catch (error) {
    if (isMissingServiceTableError(error)) {
      throw new Error(
        'Tabelas do agente de serviços não encontradas. Execute as migrações do banco de dados (wrangler d1 migrations apply).'
      )
    }
    throw error
  }

  const created = await getServiceConversationSessionById(env, sessionId)
  if (!created) {
    throw new Error('Failed to create service conversation session')
  }

  return created
}

export async function updateServiceConversationSession(
  env: Bindings,
  sessionId: string,
  updates: Partial<{
    userId: string | null
    status: ServiceConversationStatus
    latestIntent: ServiceAgentIntent | null
    sentimentScore: number | null
    sentimentLabel: NewsletterSentimentLabel | null
    notes: string | null
    nextFollowupAt: string | null
    lastMessageAt: string | null
  }>
): Promise<ServiceConversationSessionRecord | null> {
  const existing = await getServiceConversationSessionById(env, sessionId)
  if (!existing) return null

  const nextUserId = updates.userId === undefined ? existing.user_id : safeString(updates.userId)
  const nextStatus = updates.status ?? existing.status
  const nextLatestIntent =
    updates.latestIntent === undefined ? existing.latest_intent : updates.latestIntent
  const nextSentimentScore =
    updates.sentimentScore === undefined ? existing.sentiment_score : updates.sentimentScore
  const nextSentimentLabel =
    updates.sentimentLabel === undefined ? existing.sentiment_label : updates.sentimentLabel
  const nextNotes = updates.notes === undefined ? existing.notes : safeString(updates.notes)
  const nextFollowupAt =
    updates.nextFollowupAt === undefined
      ? existing.next_followup_at
      : safeString(updates.nextFollowupAt)
  const nextLastMessageAt =
    updates.lastMessageAt === undefined
      ? existing.last_message_at
      : safeString(updates.lastMessageAt)

  await env.DB.prepare(
    `UPDATE service_conversation_sessions
     SET user_id = ?,
         status = ?,
         latest_intent = ?,
         sentiment_score = ?,
         sentiment_label = ?,
         notes = ?,
         next_followup_at = ?,
         last_message_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      nextUserId,
      nextStatus,
      nextLatestIntent,
      nextSentimentScore,
      nextSentimentLabel,
      nextNotes,
      nextFollowupAt,
      nextLastMessageAt,
      sessionId
    )
    .run()

  return getServiceConversationSessionById(env, sessionId)
}

export async function appendServiceConversationMessage(
  env: Bindings,
  input: {
    sessionId: string
    direction: ServiceConversationDirection
    messageText: string
    intent?: ServiceAgentIntent | null
    sentimentScore?: number | null
    sentimentLabel?: NewsletterSentimentLabel | null
    aiModel?: string | null
    metadata?: unknown
  }
): Promise<ServiceConversationMessageRecord | null> {
  const sessionId = safeString(input.sessionId)
  const messageText = safeString(input.messageText)

  if (!sessionId || !messageText) {
    throw new Error('sessionId and messageText are required to append service message')
  }

  await env.DB.prepare(
    `INSERT INTO service_conversation_messages (
      session_id,
      direction,
      message_text,
      intent,
      sentiment_score,
      sentiment_label,
      ai_model,
      metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      input.direction,
      messageText,
      input.intent ?? null,
      input.sentimentScore ?? null,
      input.sentimentLabel ?? null,
      safeString(input.aiModel),
      input.metadata ? JSON.stringify(input.metadata) : null
    )
    .run()

  const message = await env.DB.prepare(
    `SELECT *
     FROM service_conversation_messages
     WHERE session_id = ?
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(sessionId)
    .first<ServiceConversationMessageRecord>()

  return message ?? null
}

export async function listServiceConversationMessages(
  env: Bindings,
  sessionId: string,
  limit = 100
): Promise<ServiceConversationMessageRecord[]> {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))

  try {
    const result = await env.DB.prepare(
      `SELECT *
       FROM service_conversation_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
      .bind(sessionId, boundedLimit)
      .all<ServiceConversationMessageRecord>()

    return result.results ?? []
  } catch (error) {
    if (isMissingServiceTableError(error)) return []
    throw error
  }
}

export async function createServiceAppointment(
  env: Bindings,
  input: {
    sessionId: string
    userId?: string | null
    sourceContact: string
    serviceType?: string | null
    requestedDate?: string | null
    requestedTime?: string | null
    timezone?: string | null
    notes?: string | null
    status?: ServiceAppointmentStatus
  }
): Promise<ServiceAppointmentRecord | null> {
  const id = crypto.randomUUID()
  const sessionId = safeString(input.sessionId)
  const sourceContact = safeString(input.sourceContact)
  if (!sessionId || !sourceContact) {
    throw new Error('sessionId and sourceContact are required to create appointment')
  }

  await env.DB.prepare(
    `INSERT INTO service_appointments (
      id,
      session_id,
      user_id,
      source_contact,
      service_type,
      requested_date,
      requested_time,
      timezone,
      notes,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      sessionId,
      safeString(input.userId),
      sourceContact,
      safeString(input.serviceType),
      safeString(input.requestedDate),
      safeString(input.requestedTime),
      safeString(input.timezone),
      safeString(input.notes),
      input.status ?? 'pending'
    )
    .run()

  const created = await env.DB.prepare('SELECT * FROM service_appointments WHERE id = ?')
    .bind(id)
    .first<ServiceAppointmentRecord>()

  return created ?? null
}

export async function createServiceQuote(
  env: Bindings,
  input: {
    sessionId: string
    userId?: string | null
    sourceContact: string
    serviceType?: string | null
    budgetRange?: string | null
    timeline?: string | null
    details?: string | null
    status?: ServiceQuoteStatus
    quoteValue?: number | null
  }
): Promise<ServiceQuoteRecord | null> {
  const id = crypto.randomUUID()
  const sessionId = safeString(input.sessionId)
  const sourceContact = safeString(input.sourceContact)
  if (!sessionId || !sourceContact) {
    throw new Error('sessionId and sourceContact are required to create quote')
  }

  await env.DB.prepare(
    `INSERT INTO service_quotes (
      id,
      session_id,
      user_id,
      source_contact,
      service_type,
      budget_range,
      timeline,
      details,
      status,
      quote_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      sessionId,
      safeString(input.userId),
      sourceContact,
      safeString(input.serviceType),
      safeString(input.budgetRange),
      safeString(input.timeline),
      safeString(input.details),
      input.status ?? 'requested',
      input.quoteValue ?? null
    )
    .run()

  const created = await env.DB.prepare('SELECT * FROM service_quotes WHERE id = ?')
    .bind(id)
    .first<ServiceQuoteRecord>()

  return created ?? null
}

export async function listServiceSessionAppointments(
  env: Bindings,
  sessionId: string,
  limit = 30
): Promise<ServiceAppointmentRecord[]> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)))

  try {
    const result = await env.DB.prepare(
      `SELECT *
       FROM service_appointments
       WHERE session_id = ?
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT ?`
    )
      .bind(sessionId, boundedLimit)
      .all<ServiceAppointmentRecord>()

    return result.results ?? []
  } catch (error) {
    if (isMissingServiceTableError(error)) return []
    throw error
  }
}

export async function listServiceSessionQuotes(
  env: Bindings,
  sessionId: string,
  limit = 30
): Promise<ServiceQuoteRecord[]> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)))

  try {
    const result = await env.DB.prepare(
      `SELECT *
       FROM service_quotes
       WHERE session_id = ?
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT ?`
    )
      .bind(sessionId, boundedLimit)
      .all<ServiceQuoteRecord>()

    return result.results ?? []
  } catch (error) {
    if (isMissingServiceTableError(error)) return []
    throw error
  }
}

export async function listServiceAgentRecentSessions(
  env: Bindings,
  limit = 30
): Promise<ServiceAgentRecentSession[]> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)))

  try {
    const result = await env.DB.prepare(
      `SELECT s.id,
              s.user_id,
              u.name AS user_name,
              s.source_contact,
              s.status,
              s.latest_intent,
              s.sentiment_score,
              s.sentiment_label,
              s.last_message_at,
              (
                SELECT COUNT(*)
                FROM service_conversation_messages m
                WHERE m.session_id = s.id
              ) AS message_count
       FROM service_conversation_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY COALESCE(s.last_message_at, s.updated_at, s.created_at) DESC
       LIMIT ?`
    )
      .bind(boundedLimit)
      .all<{
        id: string
        user_id: string | null
        user_name: string | null
        source_contact: string
        status: ServiceConversationStatus
        latest_intent: ServiceAgentIntent | null
        sentiment_score: number | null
        sentiment_label: NewsletterSentimentLabel | null
        last_message_at: string | null
        message_count: number
      }>()

    return (result.results ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      sourceContact: row.source_contact,
      status: row.status,
      latestIntent: row.latest_intent,
      sentimentScore: row.sentiment_score,
      sentimentLabel: row.sentiment_label,
      lastMessageAt: row.last_message_at,
      messageCount: toNumber(row.message_count),
    }))
  } catch (error) {
    if (isMissingServiceTableError(error)) return []
    throw error
  }
}

export async function getServiceAgentOverview(
  env: Bindings,
  recentLimit = 30
): Promise<ServiceAgentOverview> {
  try {
    const totalsRow = await env.DB.prepare(
      `SELECT COUNT(*) AS total_sessions,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_sessions,
              SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified_sessions,
              SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_sessions,
              SUM(CASE WHEN status = 'quoted' THEN 1 ELSE 0 END) AS quoted_sessions,
              SUM(CASE WHEN status = 'opt_out' THEN 1 ELSE 0 END) AS opt_out_sessions,
              AVG(sentiment_score) AS avg_sentiment
       FROM service_conversation_sessions`
    ).first<{
      total_sessions: number
      active_sessions: number
      qualified_sessions: number
      scheduled_sessions: number
      quoted_sessions: number
      opt_out_sessions: number
      avg_sentiment: number | null
    }>()

    const intentBucketsRow = await env.DB.prepare(
      `SELECT SUM(CASE WHEN latest_intent = 'appointment' THEN 1 ELSE 0 END) AS appointment,
              SUM(CASE WHEN latest_intent = 'quote' THEN 1 ELSE 0 END) AS quote,
              SUM(CASE WHEN latest_intent = 'question' THEN 1 ELSE 0 END) AS question,
              SUM(CASE WHEN latest_intent = 'opt_out' THEN 1 ELSE 0 END) AS opt_out,
              SUM(CASE WHEN latest_intent = 'other' OR latest_intent IS NULL THEN 1 ELSE 0 END) AS other
       FROM service_conversation_sessions`
    ).first<{
      appointment: number
      quote: number
      question: number
      opt_out: number
      other: number
    }>()

    const pipelineRow = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM service_appointments WHERE status = 'pending') AS appointments_pending,
              (SELECT COUNT(*) FROM service_appointments WHERE status = 'confirmed') AS appointments_confirmed,
              (SELECT COUNT(*) FROM service_quotes WHERE status = 'requested') AS quotes_requested,
              (SELECT COUNT(*) FROM service_quotes WHERE status = 'sent') AS quotes_sent,
              (SELECT COUNT(*) FROM service_quotes WHERE status = 'accepted') AS quotes_accepted`
    ).first<{
      appointments_pending: number
      appointments_confirmed: number
      quotes_requested: number
      quotes_sent: number
      quotes_accepted: number
    }>()

    const recentSessions = await listServiceAgentRecentSessions(env, recentLimit)

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        totalSessions: toNumber(totalsRow?.total_sessions),
        activeSessions: toNumber(totalsRow?.active_sessions),
        qualifiedSessions: toNumber(totalsRow?.qualified_sessions),
        scheduledSessions: toNumber(totalsRow?.scheduled_sessions),
        quotedSessions: toNumber(totalsRow?.quoted_sessions),
        optOutSessions: toNumber(totalsRow?.opt_out_sessions),
        averageSentiment: Number(totalsRow?.avg_sentiment ?? 0),
      },
      intentBuckets: {
        appointment: toNumber(intentBucketsRow?.appointment),
        quote: toNumber(intentBucketsRow?.quote),
        question: toNumber(intentBucketsRow?.question),
        optOut: toNumber(intentBucketsRow?.opt_out),
        other: toNumber(intentBucketsRow?.other),
      },
      pipeline: {
        appointmentsPending: toNumber(pipelineRow?.appointments_pending),
        appointmentsConfirmed: toNumber(pipelineRow?.appointments_confirmed),
        quotesRequested: toNumber(pipelineRow?.quotes_requested),
        quotesSent: toNumber(pipelineRow?.quotes_sent),
        quotesAccepted: toNumber(pipelineRow?.quotes_accepted),
      },
      recentSessions,
    }
  } catch (error) {
    if (!isMissingServiceTableError(error)) throw error

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        totalSessions: 0,
        activeSessions: 0,
        qualifiedSessions: 0,
        scheduledSessions: 0,
        quotedSessions: 0,
        optOutSessions: 0,
        averageSentiment: 0,
      },
      intentBuckets: {
        appointment: 0,
        quote: 0,
        question: 0,
        optOut: 0,
        other: 0,
      },
      pipeline: {
        appointmentsPending: 0,
        appointmentsConfirmed: 0,
        quotesRequested: 0,
        quotesSent: 0,
        quotesAccepted: 0,
      },
      recentSessions: [],
    }
  }
}

// ── Telegram Conversational Agent ─────────────────────────────

function isMissingTelegramTableError(error: unknown): boolean {
  const text = String(error || '').toLowerCase()
  return (
    text.includes('no such table') &&
    (text.includes('telegram_conversation_sessions') ||
      text.includes('telegram_conversation_messages'))
  )
}

export async function getTelegramConversationSessionById(
  env: Bindings,
  sessionId: string
): Promise<TelegramConversationSessionRecord | null> {
  try {
    const session = await env.DB.prepare(
      'SELECT * FROM telegram_conversation_sessions WHERE id = ?'
    )
      .bind(sessionId)
      .first<TelegramConversationSessionRecord>()
    return session ?? null
  } catch (error) {
    if (isMissingTelegramTableError(error)) return null
    throw error
  }
}

export async function getLatestTelegramConversationSessionByChatId(
  env: Bindings,
  chatId: string
): Promise<TelegramConversationSessionRecord | null> {
  const normalizedChatId = safeString(chatId)
  if (!normalizedChatId) return null

  try {
    const session = await env.DB.prepare(
      `SELECT *
       FROM telegram_conversation_sessions
       WHERE chat_id = ?
       ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
       LIMIT 1`
    )
      .bind(normalizedChatId)
      .first<TelegramConversationSessionRecord>()

    return session ?? null
  } catch (error) {
    if (isMissingTelegramTableError(error)) return null
    throw error
  }
}

export async function createTelegramConversationSession(
  env: Bindings,
  input: {
    userId?: string | null
    chatId: string
    username?: string | null
    firstName?: string | null
    lastName?: string | null
  }
): Promise<TelegramConversationSessionRecord> {
  const sessionId = crypto.randomUUID()

  try {
    await env.DB.prepare(
      `INSERT INTO telegram_conversation_sessions (
        id,
        user_id,
        chat_id,
        username,
        first_name,
        last_name,
        status,
        sentiment_score,
        sentiment_label,
        last_message_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
      .bind(
        sessionId,
        input.userId ?? null,
        safeString(input.chatId),
        safeString(input.username),
        safeString(input.firstName),
        safeString(input.lastName),
        'active',
        null,
        null,
        new Date().toISOString()
      )
      .run()

    const session = await getTelegramConversationSessionById(env, sessionId)
    if (!session) throw new Error('Failed to create Telegram conversation session')
    return session
  } catch (error) {
    if (isMissingTelegramTableError(error)) {
      throw new Error('Telegram conversation tables not found. Please run database migrations.')
    }
    throw error
  }
}

export async function updateTelegramConversationSession(
  env: Bindings,
  sessionId: string,
  updates: Partial<{
    status: string
    sentimentScore: number | null
    sentimentLabel: string | null
    userId: string | null
  }>
): Promise<boolean> {
  try {
    const setParts: string[] = []
    const values: unknown[] = []

    if (updates.status !== undefined) {
      setParts.push('status = ?')
      values.push(updates.status)
    }

    if (updates.sentimentScore !== undefined) {
      setParts.push('sentiment_score = ?')
      values.push(updates.sentimentScore)
    }

    if (updates.sentimentLabel !== undefined) {
      setParts.push('sentiment_label = ?')
      values.push(updates.sentimentLabel)
    }

    if (updates.userId !== undefined) {
      setParts.push('user_id = ?')
      values.push(updates.userId)
    }

    if (setParts.length === 0) return true

    setParts.push('updated_at = CURRENT_TIMESTAMP')
    values.push(sessionId)

    await env.DB.prepare(
      `UPDATE telegram_conversation_sessions
       SET ${setParts.join(', ')}
       WHERE id = ?`
    )
      .bind(...values)
      .run()

    return true
  } catch (error) {
    if (isMissingTelegramTableError(error)) return false
    throw error
  }
}

export async function appendTelegramConversationMessage(
  env: Bindings,
  sessionId: string,
  input: {
    direction: string
    messageText: string
    messageId: number
    sentimentScore?: number | null
    sentimentLabel?: string | null
    aiModel?: string | null
    metadata?: unknown
  }
): Promise<TelegramConversationMessageRecord | null> {
  const messageText = safeString(input.messageText)
  if (!messageText) return null

  try {
    await env.DB.prepare(
      `INSERT INTO telegram_conversation_messages (
        session_id,
        direction,
        message_text,
        message_id,
        sentiment_score,
        sentiment_label,
        ai_model,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sessionId,
        input.direction,
        messageText,
        input.messageId,
        input.sentimentScore ?? null,
        input.sentimentLabel ?? null,
        safeString(input.aiModel),
        input.metadata ? JSON.stringify(input.metadata) : null
      )
      .run()

    // Update session last_message_at
    await env.DB.prepare(
      'UPDATE telegram_conversation_sessions SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
      .bind(sessionId)
      .run()

    const message = await env.DB.prepare(
      `SELECT *
       FROM telegram_conversation_messages
       WHERE session_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
      .bind(sessionId)
      .first<TelegramConversationMessageRecord>()

    return message ?? null
  } catch (error) {
    if (isMissingTelegramTableError(error)) return null
    throw error
  }
}

export async function listTelegramConversationMessages(
  env: Bindings,
  sessionId: string,
  limit = 100
): Promise<TelegramConversationMessageRecord[]> {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))

  try {
    const result = await env.DB.prepare(
      `SELECT *
       FROM telegram_conversation_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
      .bind(sessionId, boundedLimit)
      .all<TelegramConversationMessageRecord>()

    return result.results ?? []
  } catch (error) {
    if (isMissingTelegramTableError(error)) return []
    throw error
  }
}

