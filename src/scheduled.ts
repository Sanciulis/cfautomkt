import type { Bindings, JourneyPhase } from './types'
import { toNumber } from './utils'
import { getAIInferenceOverview, logAgentDecision } from './db'
import { evaluateFreezingRules } from './freezing-rules'
import { logAIInference } from './ai-observability'
import {
  ADMIN_AUTONOMOUS_AGENT_STATE_KEY,
  AI_HEALTH_MIN_INFERENCES,
  AI_HEALTH_WARNING_THRESHOLDS,
  AI_HEALTH_CRITICAL_THRESHOLDS,
} from './constants'

const AI_ALERT_DEDUPE_PREFIX = 'ai_ops_alert'
const AI_WARNING_DEDUPE_SECONDS = 60 * 60
const AI_CRITICAL_DEDUPE_SECONDS = 60 * 30
const STRATEGY_ALERT_DEDUPE_PREFIX = 'strategy_alignment'
const STRATEGY_ALERT_DEDUPE_SECONDS = 60 * 60 * 12

const STRATEGY_TARGETS = {
  nsmGrowthTarget: 0.25,
  optOutRateMax: 0.05,
  avgTimeToConversionReductionTarget: 0.3,
  staleOperationDays: 7,
}

async function shouldEmitAIOpsAlert(env: Bindings, severity: 'warning' | 'critical'): Promise<boolean> {
  const key = `${AI_ALERT_DEDUPE_PREFIX}:${severity}`
  const existing = await env.MARTECH_KV.get(key)
  if (existing) return false

  const ttl = severity === 'critical' ? AI_CRITICAL_DEDUPE_SECONDS : AI_WARNING_DEDUPE_SECONDS
  await env.MARTECH_KV.put(key, new Date().toISOString(), { expirationTtl: ttl })
  return true
}

async function shouldEmitStrategyAlert(env: Bindings, keySuffix: string): Promise<boolean> {
  const key = `${STRATEGY_ALERT_DEDUPE_PREFIX}:${keySuffix}`
  const existing = await env.MARTECH_KV.get(key)
  if (existing) return false

  await env.MARTECH_KV.put(key, new Date().toISOString(), {
    expirationTtl: STRATEGY_ALERT_DEDUPE_SECONDS,
  })
  return true
}

async function notifyAIOpsWebhook(
  env: Bindings,
  payload: {
    severity: 'warning' | 'critical'
    reason: string
    rangeHours: number
    totals: {
      total: number
      errorRate: number
      fallbackRate: number
      latencyP95Ms: number
    }
    generatedAt: string
  }
): Promise<void> {
  const webhookUrl = env.AI_ALERT_WEBHOOK_URL
  if (!webhookUrl) return

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.AI_ALERT_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${env.AI_ALERT_WEBHOOK_TOKEN}`
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: 'martech_ai_health_check',
      ...payload,
    }),
  })

  if (!response.ok) {
    console.error('AI alert webhook failed:', response.status, await response.text())
  }
}

async function runAIOperationalHealthCheck(env: Bindings): Promise<void> {
  const overview = await getAIInferenceOverview(env, 24)
  const { errorRate, fallbackRate, latencyP95Ms, total } = overview.totals

  if (total < AI_HEALTH_MIN_INFERENCES) {
    console.log('[AI HEALTH CHECK] skipped due to low sample size', {
      total,
      minRequired: AI_HEALTH_MIN_INFERENCES,
    })
    return
  }

  const warning =
    errorRate > AI_HEALTH_WARNING_THRESHOLDS.errorRate ||
    fallbackRate > AI_HEALTH_WARNING_THRESHOLDS.fallbackRate ||
    latencyP95Ms > AI_HEALTH_WARNING_THRESHOLDS.latencyP95Ms

  const critical =
    errorRate > AI_HEALTH_CRITICAL_THRESHOLDS.errorRate ||
    fallbackRate > AI_HEALTH_CRITICAL_THRESHOLDS.fallbackRate ||
    latencyP95Ms > AI_HEALTH_CRITICAL_THRESHOLDS.latencyP95Ms

  if (!warning && !critical) return

  const severity = critical ? 'critical' : 'warning'
  const reason = critical
    ? 'AI operational health degraded (critical threshold reached)'
    : 'AI operational health degraded (warning threshold reached)'

  const shouldEmit = await shouldEmitAIOpsAlert(env, severity)
  if (!shouldEmit) {
    console.log('[AI HEALTH CHECK] alert suppressed by dedupe window', { severity })
    return
  }

  await logAgentDecision(env, 'ai_ops_alert', 'ai_inference_logs', reason, {
    severity,
    rangeHours: overview.rangeHours,
    totals: {
      total,
      errorRate,
      fallbackRate,
      latencyP95Ms,
    },
    minInferences: AI_HEALTH_MIN_INFERENCES,
    thresholds: {
      warning: AI_HEALTH_WARNING_THRESHOLDS,
      critical: AI_HEALTH_CRITICAL_THRESHOLDS,
    },
    generatedAt: overview.generatedAt,
  })

  if (severity === 'critical') {
    await notifyAIOpsWebhook(env, {
      severity,
      reason,
      rangeHours: overview.rangeHours,
      totals: {
        total,
        errorRate,
        fallbackRate,
        latencyP95Ms,
      },
      generatedAt: overview.generatedAt,
    })
  }

  console.warn('[AI HEALTH CHECK]', {
    severity,
    total,
    errorRate,
    fallbackRate,
    latencyP95Ms,
  })
}

async function runStrategicAlignmentChecks(env: Bindings): Promise<void> {
  try {
    const nsmRow = await env.DB.prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM interactions
          WHERE event_type = 'converted'
            AND timestamp >= datetime('now', '-7 days')) +
        (SELECT COUNT(*) FROM newsletter_conversation_sessions
          WHERE status = 'converted'
            AND COALESCE(converted_at, updated_at, created_at) >= datetime('now', '-7 days')) +
        (SELECT COUNT(*) FROM service_conversation_sessions
          WHERE status IN ('scheduled', 'quoted')
            AND COALESCE(updated_at, created_at) >= datetime('now', '-7 days'))
          AS current_week_converted,
        (SELECT COUNT(*) FROM interactions
          WHERE event_type = 'converted'
            AND timestamp >= datetime('now', '-14 days')
            AND timestamp < datetime('now', '-7 days')) +
        (SELECT COUNT(*) FROM newsletter_conversation_sessions
          WHERE status = 'converted'
            AND COALESCE(converted_at, updated_at, created_at) >= datetime('now', '-14 days')
            AND COALESCE(converted_at, updated_at, created_at) < datetime('now', '-7 days')) +
        (SELECT COUNT(*) FROM service_conversation_sessions
          WHERE status IN ('scheduled', 'quoted')
            AND COALESCE(updated_at, created_at) >= datetime('now', '-14 days')
            AND COALESCE(updated_at, created_at) < datetime('now', '-7 days'))
          AS previous_week_converted
      `
    ).first<{ current_week_converted: number; previous_week_converted: number }>()

    const currentWeekConverted = toNumber(nsmRow?.current_week_converted)
    const previousWeekConverted = toNumber(nsmRow?.previous_week_converted)
    const growthRate =
      previousWeekConverted > 0
        ? (currentWeekConverted - previousWeekConverted) / previousWeekConverted
        : currentWeekConverted > 0
          ? 1
          : 0

    if (growthRate < STRATEGY_TARGETS.nsmGrowthTarget) {
      const shouldEmit = await shouldEmitStrategyAlert(env, 'nsm_growth_gap')
      if (shouldEmit) {
        await logAgentDecision(
          env,
          'strategy_alignment_gap',
          'north_star',
          'NSM growth below strategic target (+25% converted leads/week).',
          {
            metric: 'converted_leads_per_week',
            targetGrowth: STRATEGY_TARGETS.nsmGrowthTarget,
            currentWeekConverted,
            previousWeekConverted,
            growthRate,
          }
        )
      }
    }
  } catch (error) {
    console.warn('[STRATEGY CHECK] NSM growth check skipped:', String(error))
  }

  try {
    const optOutRow = await env.DB.prepare(
      `
      SELECT
        (
          (SELECT SUM(CASE WHEN status = 'opt_out' THEN 1 ELSE 0 END)
             FROM newsletter_conversation_sessions
            WHERE created_at >= datetime('now', '-7 days')) +
          (SELECT SUM(CASE WHEN status = 'opt_out' THEN 1 ELSE 0 END)
             FROM service_conversation_sessions
            WHERE created_at >= datetime('now', '-7 days'))
        ) AS total_opt_out,
        (
          (SELECT COUNT(*) FROM newsletter_conversation_sessions
            WHERE created_at >= datetime('now', '-7 days')) +
          (SELECT COUNT(*) FROM service_conversation_sessions
            WHERE created_at >= datetime('now', '-7 days'))
        ) AS total_sessions
      `
    ).first<{ total_opt_out: number; total_sessions: number }>()

    const totalOptOut = toNumber(optOutRow?.total_opt_out)
    const totalSessions = toNumber(optOutRow?.total_sessions)
    const optOutRate = totalSessions > 0 ? totalOptOut / totalSessions : 0

    if (totalSessions >= 20 && optOutRate > STRATEGY_TARGETS.optOutRateMax) {
      const shouldEmit = await shouldEmitStrategyAlert(env, 'opt_out_guardrail_breach')
      if (shouldEmit) {
        await logAgentDecision(
          env,
          'strategy_guardrail_breach',
          'opt_out_rate',
          'Opt-out rate above strategic threshold (<5%).',
          {
            targetMax: STRATEGY_TARGETS.optOutRateMax,
            optOutRate,
            totalOptOut,
            totalSessions,
            windowDays: 7,
          }
        )
      }
    }
  } catch (error) {
    console.warn('[STRATEGY CHECK] opt-out check skipped:', String(error))
  }

  try {
    const staleRow = await env.DB.prepare(
      `
      SELECT
        (SELECT COUNT(*)
           FROM campaigns c
          WHERE c.status = 'active'
            AND (
              c.updated_at < datetime('now', '-7 days')
              OR NOT EXISTS (
                SELECT 1 FROM interactions i
                 WHERE i.campaign_id = c.id
                   AND i.timestamp >= datetime('now', '-7 days')
              )
            )) AS stale_campaigns,
        (SELECT COUNT(*)
           FROM journeys j
          WHERE j.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM journey_enrollments je
               WHERE je.journey_id = j.id
                 AND je.last_interaction_at >= datetime('now', '-7 days')
            )) AS stale_journeys
      `
    ).first<{ stale_campaigns: number; stale_journeys: number }>()

    const staleCampaigns = toNumber(staleRow?.stale_campaigns)
    const staleJourneys = toNumber(staleRow?.stale_journeys)

    if (staleCampaigns > 0 || staleJourneys > 0) {
      const shouldEmit = await shouldEmitStrategyAlert(env, 'stale_operations')
      if (shouldEmit) {
        await logAgentDecision(
          env,
          'strategy_control_room_alert',
          'operations_staleness',
          'Active operations stale for more than 7 days; review in Control Room.',
          {
            staleCampaigns,
            staleJourneys,
            staleThresholdDays: STRATEGY_TARGETS.staleOperationDays,
          }
        )
      }
    }
  } catch (error) {
    console.warn('[STRATEGY CHECK] stale operations check skipped:', String(error))
  }

  try {
    const ttcRow = await env.DB.prepare(
      `
      SELECT
        (
          SELECT AVG((julianday(converted_at) - julianday(created_at)) * 24.0)
          FROM newsletter_conversation_sessions
          WHERE status = 'converted'
            AND converted_at IS NOT NULL
            AND created_at >= datetime('now', '-30 days')
        ) AS current_avg_hours,
        (
          SELECT AVG((julianday(converted_at) - julianday(created_at)) * 24.0)
          FROM newsletter_conversation_sessions
          WHERE status = 'converted'
            AND converted_at IS NOT NULL
            AND created_at >= datetime('now', '-60 days')
            AND created_at < datetime('now', '-30 days')
        ) AS previous_avg_hours
      `
    ).first<{ current_avg_hours: number | null; previous_avg_hours: number | null }>()

    const currentAvg = Number(ttcRow?.current_avg_hours ?? Number.NaN)
    const previousAvg = Number(ttcRow?.previous_avg_hours ?? Number.NaN)

    if (Number.isFinite(currentAvg) && Number.isFinite(previousAvg) && previousAvg > 0) {
      const reductionRate = (previousAvg - currentAvg) / previousAvg
      if (reductionRate < STRATEGY_TARGETS.avgTimeToConversionReductionTarget) {
        const shouldEmit = await shouldEmitStrategyAlert(env, 'time_to_conversion_gap')
        if (shouldEmit) {
          await logAgentDecision(
            env,
            'strategy_alignment_gap',
            'time_to_conversion',
            'Average time-to-conversion reduction below strategic target (-30%).',
            {
              targetReduction: STRATEGY_TARGETS.avgTimeToConversionReductionTarget,
              currentAvgHours: currentAvg,
              previousAvgHours: previousAvg,
              reductionRate,
              windowDays: 30,
            }
          )
        }
      }
    }
  } catch (error) {
    console.warn('[STRATEGY CHECK] time-to-conversion check skipped:', String(error))
  }
}

export async function runScheduledAgent(env: Bindings): Promise<void> {
  const autonomousAgentStateRaw = await env.MARTECH_KV.get(ADMIN_AUTONOMOUS_AGENT_STATE_KEY)
  const autonomousAgentEnabled = autonomousAgentStateRaw === null
    ? true
    : !['false', '0', 'off', 'disabled'].includes(String(autonomousAgentStateRaw).trim().toLowerCase())

  if (!autonomousAgentEnabled) {
    console.log('Autonomous Agent cycle skipped because agent is disabled by admin config')
    return
  }

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

  // ── 6. AI Learning Loop: Systematic Review ─────────────────
  // Find journeys with more than 5 stale leads to generate insights
  const problematicJourneys = await env.DB.prepare(
    `SELECT je.journey_id, j.name, COUNT(*) as stale_count
     FROM journey_enrollments je
     JOIN journeys j ON j.id = je.journey_id
     WHERE j.status = 'active'
       AND je.current_phase NOT IN ('action', 'retained')
       AND je.last_interaction_at < datetime('now', '-3 days')
     GROUP BY je.journey_id
     HAVING stale_count >= 3
     LIMIT 3`
  ).all<{ journey_id: string; name: string; stale_count: number }>()

  for (const p of problematicJourneys.results) {
    const samples = await env.DB.prepare(
      "SELECT conversation_history FROM journey_enrollments WHERE journey_id = ? AND last_interaction_at < datetime('now', '-3 days') LIMIT 2"
    ).bind(p.journey_id).all<{ conversation_history: string }>()

    const chatContext = samples.results
      .map(s => s.conversation_history)
      .filter(Boolean)
      .join('\n---\n')

    if (!chatContext) continue

    try {
      const prompt = `Analise estes diálogos de chat marketing que pararam de responder. Identifique por que o lead perdeu o interesse e sugira UM PEQUENO AJUSTE no System Prompt da persona para melhorar a conversão. Mantenha o tom profissional. 
      Conversas:
      ${chatContext}`

      const startedAt = Date.now()
      const model = '@cf/meta/llama-3-8b-instruct'

      const aiResponse: any = await env.AI.run(model, {
        messages: [{ role: 'user', content: prompt }]
      })

      const insight = aiResponse.response || "Sem insight gerado pela IA."
      await logAIInference(env, {
        flow: 'scheduled_ai_learning_loop',
        model,
        status: 'success',
        latencyMs: Date.now() - startedAt,
        fallbackUsed: !aiResponse.response,
        promptSource: prompt,
        metadata: {
          journeyId: p.journey_id,
          staleCount: p.stale_count,
        },
      })

      await env.DB.prepare(
        "INSERT INTO ai_learning_loops (id, journey_id, ai_insight, status) VALUES (?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), p.journey_id, insight, 'pending_review')
      .run()

      console.log(`AI Insight generated for journey ${p.name}`)
    } catch (e) {
      await logAIInference(env, {
        flow: 'scheduled_ai_learning_loop',
        model: '@cf/meta/llama-3-8b-instruct',
        status: 'error',
        latencyMs: 0,
        fallbackUsed: true,
        promptSource: chatContext,
        errorMessage: String(e),
        metadata: {
          journeyId: p.journey_id,
          staleCount: p.stale_count,
        },
      })
      console.error(`AI Learning Loop error for ${p.journey_id}:`, e)
    }
  }

  // ── 6. Freezing Rules Evaluation ───────────────────────────
  await evaluateFreezingRules(env)

  // ── 7. AI Operational Health Check ─────────────────────────
  await runAIOperationalHealthCheck(env)
  await runStrategicAlignmentChecks(env)
}
