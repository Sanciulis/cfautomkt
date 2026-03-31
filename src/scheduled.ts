import type { Bindings, JourneyPhase } from './types'
import { toNumber } from './utils'
import { logAgentDecision } from './db'

export async function runScheduledAgent(env: Bindings): Promise<void> {
  console.log('Autonomous Agent running optimization cycle')

  // ── 1. Cold User Channel Migration ─────────────────────────
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

  // ── 2. Low-performance Campaign Auto-kill ──────────────────
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

  // ── 3. Viral Milestone Recognition ─────────────────────────
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

  // ── 4. Journey: Stale Enrollment Re-engagement ─────────────
  // Find leads stuck in a phase for 2+ days without interaction
  const staleEnrollments = await env.DB.prepare(
    `SELECT je.user_id, je.journey_id, je.current_phase, je.last_interaction_at,
            j.name AS journey_name, j.status AS journey_status
     FROM journey_enrollments je
     JOIN journeys j ON j.id = je.journey_id
     WHERE j.status = 'active'
       AND je.current_phase != 'retained'
       AND je.last_interaction_at < datetime('now', '-2 days')
     LIMIT 100`
  ).all<{
    user_id: string
    journey_id: string
    current_phase: JourneyPhase
    last_interaction_at: string
    journey_name: string
    journey_status: string
  }>()

  for (const enrollment of staleEnrollments.results) {
    await logAgentDecision(
      env,
      'journey_nudge',
      enrollment.user_id,
      `Lead stale in phase "${enrollment.current_phase}" of journey "${enrollment.journey_name}" for 2+ days. Re-engagement recommended.`,
      {
        journeyId: enrollment.journey_id,
        phase: enrollment.current_phase,
        lastInteraction: enrollment.last_interaction_at,
      }
    )
  }

  // ── 5. Journey: Completed Leads → Retention Loop ───────────
  // Find leads who reached 'retained' phase recently
  const retainedLeads = await env.DB.prepare(
    `SELECT je.user_id, je.journey_id, j.name AS journey_name
     FROM journey_enrollments je
     JOIN journeys j ON j.id = je.journey_id
     WHERE je.current_phase = 'retained'
       AND je.last_interaction_at >= datetime('now', '-7 days')
     LIMIT 50`
  ).all<{ user_id: string; journey_id: string; journey_name: string }>()

  for (const lead of retainedLeads.results) {
    await logAgentDecision(
      env,
      'retention_outreach',
      lead.user_id,
      `Lead completed journey "${lead.journey_name}". Recommend referral program outreach and upsell.`,
      { journeyId: lead.journey_id }
    )
  }
}
