import type { Bindings, UserRecord, InteractionPayload, CampaignCreateInput } from './types'
import { EVENT_WEIGHTS } from './constants'
import { toNumber, safeString, toBoolean, buildReferralCode, resolveConsentSource } from './utils'

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
