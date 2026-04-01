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

