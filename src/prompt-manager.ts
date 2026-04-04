import type { Bindings } from './types'
import { DEFAULT_AI_MODEL } from './constants'

const PROMPT_TARGET_ALIAS_FALLBACKS: Record<string, string[]> = {
  'flow:run_persona_conversation': ['flow:simulate_persona'],
  'flow:simulate_persona_conversation': ['flow:simulate_persona'],
  'flow:generate_journey_opening_message': ['flow:journey_opening'],
}

export const SUPPORTED_PROMPT_TARGETS = [
  'flow:generate_personalized_message',
  'flow:run_persona_conversation',
  'flow:simulate_persona_conversation',
  'flow:generate_journey_opening_message',
  'flow:newsletter_agent_opening_message',
  'flow:newsletter_agent_reply',
  'flow:service_agent_opening_message',
  'flow:service_agent_reply',
  // Legacy targets kept for compatibility with existing prompt history.
  'flow:simulate_persona',
  'flow:journey_opening',
] as const

const SUPPORTED_PROMPT_TARGET_SET = new Set<string>(SUPPORTED_PROMPT_TARGETS)
const PLACEHOLDER_TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

const PROMPT_ALLOWED_PLACEHOLDERS: Record<string, Set<string>> = {
  'flow:generate_personalized_message': new Set([
    'channel',
    'psychological_profile',
    'engagement_score',
    'viral_points',
    'baseCopy',
  ]),
  'flow:run_persona_conversation': new Set(['journey_phase', 'conversation_history', 'last_user_message']),
  'flow:simulate_persona_conversation': new Set([
    'journey_phase',
    'conversation_history',
    'last_user_message',
  ]),
  'flow:simulate_persona': new Set(['journey_phase', 'conversation_history', 'last_user_message']),
  'flow:generate_journey_opening_message': new Set(['user_name']),
  'flow:journey_opening': new Set(['user_name']),
}

export type PromptVersion = {
  id: number
  target_id: string
  prompt_text: string
  model: string
  updated_by: string
  change_reason: string
  created_at: string
}

export type PromptValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
  normalizedTargetId: string
  detectedPlaceholders: string[]
}

export function isSupportedPromptTarget(targetId: string): boolean {
  return SUPPORTED_PROMPT_TARGET_SET.has(targetId)
}

function extractPromptPlaceholders(promptText: string): string[] {
  const placeholders = new Set<string>()
  let match: RegExpExecArray | null = PLACEHOLDER_TOKEN_PATTERN.exec(promptText)

  while (match?.[1]) {
    placeholders.add(match[1])
    match = PLACEHOLDER_TOKEN_PATTERN.exec(promptText)
  }

  PLACEHOLDER_TOKEN_PATTERN.lastIndex = 0
  return Array.from(placeholders)
}

export function validatePromptForTarget(targetId: string, promptText: string): PromptValidationResult {
  const normalizedTargetId = targetId.trim()
  const normalizedPromptText = promptText.trim()
  const errors: string[] = []
  const warnings: string[] = []

  if (!normalizedTargetId) {
    errors.push('targetId is required.')
  } else if (!isSupportedPromptTarget(normalizedTargetId)) {
    errors.push(`Unsupported targetId: ${normalizedTargetId}`)
  }

  if (!normalizedPromptText) {
    errors.push('Prompt text is required.')
  } else {
    if (normalizedPromptText.length < 40) {
      errors.push('Prompt text is too short. Use at least 40 characters.')
    }
    if (normalizedPromptText.length > 12000) {
      errors.push('Prompt text is too long. Limit to 12000 characters.')
    }
  }

  const detectedPlaceholders = extractPromptPlaceholders(normalizedPromptText)
  const allowedPlaceholders = PROMPT_ALLOWED_PLACEHOLDERS[normalizedTargetId] ?? new Set<string>()

  if (detectedPlaceholders.length > 0 && allowedPlaceholders.size === 0) {
    warnings.push(
      'Detected template placeholders in a target that usually does not require placeholders. Review before publishing.'
    )
  }

  if (detectedPlaceholders.length > 0 && allowedPlaceholders.size > 0) {
    const unsupportedPlaceholders = detectedPlaceholders.filter((placeholder) => !allowedPlaceholders.has(placeholder))
    if (unsupportedPlaceholders.length > 0) {
      errors.push(
        `Unsupported placeholders for target ${normalizedTargetId}: ${unsupportedPlaceholders.join(', ')}`
      )
    }
  }

  if (detectedPlaceholders.length === 0 && allowedPlaceholders.size > 0) {
    warnings.push(
      `No template placeholders detected. This target usually references: ${Array.from(allowedPlaceholders).join(', ')}`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedTargetId,
    detectedPlaceholders,
  }
}

/**
 * Gets the latest prompt version for a target, or a hard fallback if none exists yet.
 */
export async function getActivePrompt(
  env: Bindings,
  targetId: string,
  fallbackPromptText: string,
  fallbackModel: string = DEFAULT_AI_MODEL
): Promise<{ text: string; model: string }> {
  const candidateTargetIds = [targetId, ...(PROMPT_TARGET_ALIAS_FALLBACKS[targetId] ?? [])]

  for (const candidate of candidateTargetIds) {
    try {
      const row = await env.DB.prepare(
        'SELECT prompt_text, model FROM ai_prompt_versions WHERE target_id = ? ORDER BY created_at DESC LIMIT 1'
      )
        .bind(candidate)
        .first<{ prompt_text: string; model: string }>()

      if (row) {
        return { text: row.prompt_text, model: row.model ?? fallbackModel }
      }
    } catch (error) {
      console.warn('Prompt lookup failed. Falling back to bundled prompt.', {
        targetId: candidate,
        error: String(error),
      })
    }
  }

  return { text: fallbackPromptText, model: fallbackModel }
}

/**
 * Saves a new version of the prompt, acting as our Audit and Rollout tracker.
 */
export async function publishPromptVersion(
  env: Bindings,
  targetId: string,
  promptText: string,
  model: string,
  updatedBy: string = 'admin',
  changeReason: string = 'Atualização padrão via Admin'
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_prompt_versions (target_id, prompt_text, model, updated_by, change_reason)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(targetId, promptText, model, updatedBy, changeReason)
    .run()
}

/**
 * Lists the audit history of a specific prompt target.
 */
export async function getPromptHistory(env: Bindings, targetId: string, limit: number = 20): Promise<PromptVersion[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM ai_prompt_versions WHERE target_id = ? ORDER BY created_at DESC LIMIT ?'
  )
    .bind(targetId, limit)
    .all<PromptVersion>()

  return rows.results ?? []
}
