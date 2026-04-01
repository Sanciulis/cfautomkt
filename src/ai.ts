import type { Bindings, UserRecord } from './types'
import { DEFAULT_AI_MODEL } from './constants'
import { extractAIText } from './utils'
import { logAIInference } from './ai-observability'
import { getActivePrompt } from './prompt-manager'

export async function generatePersonalizedMessage(
  env: Bindings,
  user: UserRecord,
  baseCopy: string,
  channel: string
): Promise<string> {
  const prompt = `
Generate a ${channel} marketing message in Brazilian Portuguese.
User profile:
- preferred_channel: ${user.preferred_channel}
- psychological_profile: ${user.psychological_profile}
- engagement_score: ${user.engagement_score}
- viral_points: ${user.viral_points}

Rules:
- max 400 characters
- include urgency and a clear CTA
- keep human tone and concise
- do not use fake claims

Base copy: "${baseCopy}"
  `.trim()

  const startedAt = Date.now()
  const fallbackSystemPrompt = 'You are a senior conversion copywriter specialized in multichannel campaigns.'
  const activeConfig = await getActivePrompt(env, 'flow:generate_personalized_message', fallbackSystemPrompt, DEFAULT_AI_MODEL)
  
  const systemContent = activeConfig.text
  const modelToUse = activeConfig.model

  let fallbackUsed = false

  try {
    const aiResult = await env.AI.run(modelToUse, {
      messages: [
        {
          role: 'system',
          content: systemContent,
        },
        { role: 'user', content: prompt },
      ],
    })

    const generated = extractAIText(aiResult)
    fallbackUsed = !generated

    await logAIInference(env, {
      flow: 'generate_personalized_message',
      model: modelToUse,
      status: 'success',
      latencyMs: Date.now() - startedAt,
      fallbackUsed,
      promptSource: `${systemContent}\n${prompt}`,
      metadata: {
        userId: user.id,
        channel,
      },
    })

    return generated || `Oferta exclusiva para voce. ${baseCopy} Clique no link e aproveite agora.`
  } catch (error) {
    await logAIInference(env, {
      flow: 'generate_personalized_message',
      model: modelToUse,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      fallbackUsed: true,
      promptSource: `${systemContent}\n${prompt}`,
      errorMessage: String(error),
      metadata: {
        userId: user.id,
        channel,
      },
    })

    return `Oferta exclusiva para voce. ${baseCopy} Clique no link e aproveite agora.`
  }
}
