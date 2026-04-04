import type { Bindings, FreezingRule, FreezingCondition, FreezingAction, UserRecord, CampaignRecord, SegmentRecord } from './types'
import { toNumber, safeString } from './utils'
import { logAgentDecision } from './db'

const RULE_TABLE_MAP: Record<FreezingRule['type'], string> = {
  user_freeze: 'users',
  campaign_freeze: 'campaigns',
  segment_freeze: 'segments',
}

const ALLOWED_UPDATE_FIELDS: Record<FreezingRule['type'], Set<string>> = {
  user_freeze: new Set(['marketing_opt_in', 'preferred_channel', 'psychological_profile']),
  campaign_freeze: new Set(['status', 'channel']),
  segment_freeze: new Set(['description']),
}

export async function createFreezingRule(
  env: Bindings,
  type: FreezingRule['type'],
  name: string,
  conditions: FreezingCondition[],
  actions: FreezingAction[],
  description?: string,
  priority: number = 0
): Promise<FreezingRule> {
  const id = crypto.randomUUID()
  const conditionsJson = JSON.stringify(conditions)
  const actionsJson = JSON.stringify(actions)

  await env.DB.prepare(
    'INSERT INTO freezing_rules (id, type, name, description, conditions, actions, priority) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, type, name, description || null, conditionsJson, actionsJson, priority)
    .run()

  return {
    id,
    type,
    name,
    description: description || null,
    conditions,
    actions,
    enabled: true,
    priority,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

export async function getFreezingRules(env: Bindings, type?: FreezingRule['type']): Promise<FreezingRule[]> {
  let query = 'SELECT * FROM freezing_rules WHERE enabled = 1'
  const params: any[] = []

  if (type) {
    query += ' AND type = ?'
    params.push(type)
  }

  query += ' ORDER BY priority DESC, created_at DESC'

  const rules = await env.DB.prepare(query).bind(...params).all()
  return rules.results.map(rule => ({
    id: rule.id as string,
    type: rule.type as FreezingRule['type'],
    name: rule.name as string,
    description: rule.description as string | null,
    conditions: JSON.parse(rule.conditions as string) as FreezingCondition[],
    actions: JSON.parse(rule.actions as string) as FreezingAction[],
    enabled: Boolean(rule.enabled),
    priority: rule.priority as number,
    created_at: rule.created_at as string,
    updated_at: rule.updated_at as string
  }))
}

export async function updateFreezingRule(
  env: Bindings,
  id: string,
  updates: Partial<Pick<FreezingRule, 'name' | 'description' | 'conditions' | 'actions' | 'enabled' | 'priority'>>
): Promise<FreezingRule | null> {
  const existing = await getFreezingRuleById(env, id)
  if (!existing) return null

  const newName = updates.name ?? existing.name
  const newDescription = updates.description ?? existing.description
  const newConditions = updates.conditions ?? existing.conditions
  const newActions = updates.actions ?? existing.actions
  const newEnabled = updates.enabled ?? existing.enabled
  const newPriority = updates.priority ?? existing.priority

  const conditionsJson = JSON.stringify(newConditions)
  const actionsJson = JSON.stringify(newActions)

  await env.DB.prepare(
    'UPDATE freezing_rules SET name = ?, description = ?, conditions = ?, actions = ?, enabled = ?, priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind(newName, newDescription, conditionsJson, actionsJson, newEnabled ? 1 : 0, newPriority, id)
    .run()

  return {
    ...existing,
    name: newName,
    description: newDescription,
    conditions: newConditions,
    actions: newActions,
    enabled: newEnabled,
    priority: newPriority,
    updated_at: new Date().toISOString()
  }
}

export async function getFreezingRuleById(env: Bindings, id: string): Promise<FreezingRule | null> {
  const rule = await env.DB.prepare('SELECT * FROM freezing_rules WHERE id = ?').bind(id).first()
  if (!rule) return null

  return {
    id: rule.id as string,
    type: rule.type as FreezingRule['type'],
    name: rule.name as string,
    description: rule.description as string | null,
    conditions: JSON.parse(rule.conditions as string) as FreezingCondition[],
    actions: JSON.parse(rule.actions as string) as FreezingAction[],
    enabled: Boolean(rule.enabled),
    priority: rule.priority as number,
    created_at: rule.created_at as string,
    updated_at: rule.updated_at as string
  }
}

export async function deleteFreezingRule(env: Bindings, id: string): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM freezing_rules WHERE id = ?').bind(id).run()
  return result.meta.changes > 0
}

function evaluateCondition(condition: FreezingCondition, data: Record<string, any>): boolean {
  const { field, operator, value, timeframe } = condition
  if (!Object.prototype.hasOwnProperty.call(data, field)) {
    return false
  }

  let fieldValue = data[field]

  // Handle timeframe-based conditions
  if (timeframe && field === 'last_active') {
    // For last_active, check if it's older than timeframe
    const lastActive = new Date(fieldValue)
    if (Number.isNaN(lastActive.getTime())) {
      return false
    }
    const now = new Date()
    const timeframeMs = parseTimeframe(timeframe)
    if (timeframeMs <= 0) {
      return false
    }
    if (now.getTime() - lastActive.getTime() > timeframeMs) {
      fieldValue = true // Consider as "inactive for timeframe"
    } else {
      fieldValue = false
    }
  }

  switch (operator) {
    case 'eq':
      return fieldValue === value
    case 'gt':
      return toNumber(fieldValue) > toNumber(value)
    case 'lt':
      return toNumber(fieldValue) < toNumber(value)
    case 'gte':
      return toNumber(fieldValue) >= toNumber(value)
    case 'lte':
      return toNumber(fieldValue) <= toNumber(value)
    case 'contains':
      return String(fieldValue).includes(String(value))
    case 'not_contains':
      return !String(fieldValue).includes(String(value))
    default:
      return false
  }
}

function parseTimeframe(timeframe: string): number {
  const match = timeframe.match(/^\s*(\d+)\s*(days?|hours?|minutes?)\s*$/i)
  if (!match) return 0

  const num = parseInt(match[1], 10)
  if (!Number.isFinite(num) || num <= 0) return 0
  const unit = match[2].toLowerCase()

  switch (unit) {
    case 'day':
    case 'days':
      return num * 24 * 60 * 60 * 1000
    case 'hour':
    case 'hours':
      return num * 60 * 60 * 1000
    case 'minute':
    case 'minutes':
      return num * 60 * 1000
    default:
      return 0
  }
}

function normalizeTimeframeModifier(timeframe?: string): string {
  const fallback = '-7 days'
  const normalized = safeString(timeframe)
  if (!normalized) return fallback

  const match = normalized.match(/^(\d+)\s*(days?|hours?|minutes?)$/i)
  if (!match) return fallback

  const amount = parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return fallback

  const rawUnit = match[2].toLowerCase()
  const unit = rawUnit.startsWith('day')
    ? 'days'
    : rawUnit.startsWith('hour')
      ? 'hours'
      : 'minutes'

  return `-${amount} ${unit}`
}

function resolveCampaignMetricsWindow(conditions: FreezingCondition[]): string {
  const conditionWithWindow = conditions.find(
    (condition) =>
      (condition.field === 'sent_count' ||
        condition.field === 'converted_count' ||
        condition.field === 'conversion_rate') &&
      safeString(condition.timeframe)
  )

  return normalizeTimeframeModifier(conditionWithWindow?.timeframe)
}

async function loadTargetsForRule(env: Bindings, rule: FreezingRule): Promise<Record<string, any>[]> {
  if (rule.type === 'user_freeze') {
    const users = await env.DB.prepare('SELECT * FROM users').all<UserRecord>()
    return users.results ?? []
  }

  if (rule.type === 'campaign_freeze') {
    const metricsWindow = resolveCampaignMetricsWindow(rule.conditions)
    const campaigns = await env.DB.prepare(
      `SELECT
        c.*,
        COALESCE(m.sent_count, 0) AS sent_count,
        COALESCE(m.converted_count, 0) AS converted_count,
        CASE
          WHEN COALESCE(m.sent_count, 0) > 0
            THEN CAST(m.converted_count AS REAL) / CAST(m.sent_count AS REAL)
          ELSE 0
        END AS conversion_rate
      FROM campaigns c
      LEFT JOIN (
        SELECT
          campaign_id,
          SUM(CASE WHEN event_type = 'sent' THEN 1 ELSE 0 END) AS sent_count,
          SUM(CASE WHEN event_type = 'converted' THEN 1 ELSE 0 END) AS converted_count
        FROM interactions
        WHERE campaign_id IS NOT NULL
          AND timestamp >= datetime('now', ?)
        GROUP BY campaign_id
      ) m ON m.campaign_id = c.id
      WHERE c.status = ?`
    )
      .bind(metricsWindow, 'active')
      .all<CampaignRecord & { sent_count: number; converted_count: number; conversion_rate: number }>()

    return campaigns.results ?? []
  }

  const segments = await env.DB.prepare(
    `SELECT
      s.*,
      COUNT(us.user_id) AS member_count
    FROM segments s
    LEFT JOIN user_segments us ON us.segment_id = s.id
    GROUP BY s.id`
  ).all<SegmentRecord & { member_count: number }>()

  return segments.results ?? []
}

async function executeAction(env: Bindings, action: FreezingAction, targetId: string, rule: FreezingRule): Promise<void> {
  switch (action.type) {
    case 'update_field':
      if (action.target_field && action.target_value !== undefined) {
        const table = RULE_TABLE_MAP[rule.type]
        const targetField = safeString(action.target_field)

        if (!targetField || !ALLOWED_UPDATE_FIELDS[rule.type].has(targetField)) {
          console.warn(`Skipping update_field action for rule ${rule.id}: field not allowed`, {
            ruleType: rule.type,
            targetField,
          })
          return
        }

        await env.DB.prepare(
          `UPDATE ${table} SET ${targetField} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(action.target_value, targetId).run()
      }
      break

    case 'log_decision':
      await logAgentDecision(
        env,
        'freezing_rule_applied',
        targetId,
        action.message || `Freezing rule '${rule.name}' applied`,
        { rule_id: rule.id, rule_type: rule.type }
      )
      break

    case 'send_notification':
      // For now, just log. Could be extended to send actual notifications
      console.log(`Freezing notification: ${action.message} for ${targetId}`)
      break
  }
}

export async function evaluateFreezingRules(env: Bindings): Promise<void> {
  console.log('Evaluating freezing rules...')

  const rules = await getFreezingRules(env)

  for (const rule of rules) {
    try {
      const targets = await loadTargetsForRule(env, rule)

      for (const target of targets) {
        const targetId = safeString(target.id)
        if (!targetId) continue

        const matches = rule.conditions.every(condition => evaluateCondition(condition, target))
        if (matches) {
          console.log(`Applying freezing rule '${rule.name}' to ${rule.type} ${targetId}`)
          for (const action of rule.actions) {
            await executeAction(env, action, targetId, rule)
          }
        }
      }
    } catch (error) {
      console.error(`Error evaluating freezing rule '${rule.name}':`, error)
    }
  }
}

// Predefined rules for common freezing scenarios
export async function createDefaultFreezingRules(env: Bindings): Promise<void> {
  // Rule 1: Freeze users inactive for 30 days
  await createFreezingRule(
    env,
    'user_freeze',
    'Freeze Inactive Users (30 days)',
    [
      { field: 'last_active', operator: 'eq', value: true, timeframe: '30 days' },
      { field: 'marketing_opt_in', operator: 'eq', value: 1 }
    ],
    [
      { type: 'update_field', target_field: 'marketing_opt_in', target_value: 0 },
      { type: 'log_decision', message: 'User frozen due to 30+ days inactivity' }
    ],
    'Automatically freeze users who haven\'t been active for 30 days',
    10
  )

  // Rule 2: Freeze campaigns with < 1% conversion rate after 50 sends
  await createFreezingRule(
    env,
    'campaign_freeze',
    'Freeze Low-Performance Campaigns',
    [
      { field: 'sent_count', operator: 'gte', value: 50, timeframe: '7 days' },
      { field: 'conversion_rate', operator: 'lt', value: 0.01, timeframe: '7 days' }
    ],
    [
      { type: 'update_field', target_field: 'status', target_value: 'paused' },
      { type: 'log_decision', message: 'Campaign frozen due to low conversion rate (< 1% after 50+ sends)' }
    ],
    'Pause campaigns with poor performance to optimize resource usage',
    5
  )

  // Rule 3: Freeze users who opted out
  await createFreezingRule(
    env,
    'user_freeze',
    'Freeze Opted-Out Users',
    [
      { field: 'marketing_opt_in', operator: 'eq', value: 0 }
    ],
    [
      { type: 'log_decision', message: 'User confirmed as opted-out and frozen' }
    ],
    'Ensure opted-out users are properly frozen',
    20
  )
}