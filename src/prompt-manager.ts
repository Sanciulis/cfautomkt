import type { Bindings } from './types'
import { DEFAULT_AI_MODEL } from './constants'

const PROMPT_TARGET_ALIAS_FALLBACKS: Record<string, string[]> = {
  'flow:run_persona_conversation': ['flow:simulate_persona'],
  'flow:simulate_persona_conversation': ['flow:simulate_persona'],
  'flow:generate_journey_opening_message': ['flow:journey_opening'],
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
