import type { Bindings } from './types'

type AIInferenceStatus = 'success' | 'error'

type LogAIInferenceInput = {
  flow: string
  model: string
  status: AIInferenceStatus
  latencyMs: number
  fallbackUsed?: boolean
  promptSource?: string | null
  errorMessage?: string | null
  metadata?: unknown
}

async function hashPromptSource(value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hashArray = Array.from(new Uint8Array(digest))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function logAIInference(env: Bindings, input: LogAIInferenceInput): Promise<void> {
  try {
    const promptHash = await hashPromptSource(input.promptSource)
    await env.DB.prepare(
      `INSERT INTO ai_inference_logs
        (id, flow, model, status, latency_ms, fallback_used, prompt_hash, error_message, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        input.flow,
        input.model,
        input.status,
        Math.max(0, Math.round(input.latencyMs)),
        input.fallbackUsed ? 1 : 0,
        promptHash,
        input.errorMessage ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null
      )
      .run()
  } catch (error) {
    console.error('Failed to log AI inference telemetry:', error)
  }
}
