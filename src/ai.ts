import type { Bindings, UserRecord } from './types'
import { DEFAULT_AI_MODEL } from './constants'
import { extractAIText } from './utils'

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

  const aiResult = await env.AI.run(DEFAULT_AI_MODEL, {
    messages: [
      {
        role: 'system',
        content: 'You are a senior conversion copywriter specialized in multichannel campaigns.',
      },
      { role: 'user', content: prompt },
    ],
  })

  return (
    extractAIText(aiResult) ||
    `Oferta exclusiva para voce. ${baseCopy} Clique no link e aproveite agora.`
  )
}
