import type {
  Bindings,
  NewsletterConversationMessageRecord,
  NewsletterSentimentLabel,
} from './types'
import { DEFAULT_AI_MODEL } from './constants'
import { extractAIText, safeString } from './utils'
import { logAIInference } from './ai-observability'

type NewsletterIntent = 'subscribe' | 'opt_out' | 'feedback' | 'question' | 'other'

type NewsletterSentiment = {
  score: number
  label: NewsletterSentimentLabel
}

type NewsletterAgentReply = {
  replyText: string
  intent: NewsletterIntent
  sentiment: NewsletterSentiment
  feedbackRating: number | null
  shouldConvert: boolean
  shouldOptOut: boolean
}

const POSITIVE_HINTS = [
  'quero',
  'gostei',
  'top',
  'massa',
  'perfeito',
  'curti',
  'sim',
  'interessante',
  'legal',
  'bom',
]

const NEGATIVE_HINTS = [
  'nao',
  'não',
  'pare',
  'sair',
  'chato',
  'ruim',
  'odio',
  'ódio',
  'nunca',
  'irritado',
  'incomoda',
  'incômoda',
]

const SUBSCRIBE_HINTS = [
  'quero assinar',
  'me inscreve',
  'me cadastrar',
  'quero receber',
  'pode mandar',
  'assinar newsletter',
  'inscrever newsletter',
]

const OPTOUT_HINTS = [
  'nao quero',
  'não quero',
  'parar',
  'sair',
  'remove',
  'remover',
  'cancelar',
  'descadastrar',
  'pare de mandar',
]

const FEEDBACK_HINTS = ['nota', 'feedback', 'avalio', 'avaliacao', 'avaliação']

function clampSentiment(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

function detectFeedbackRating(message: string): number | null {
  const normalized = message.toLowerCase()

  const directMatch = normalized.match(/\b([1-5])\s*(?:\/\s*5)?\b/)
  if (directMatch?.[1]) {
    return Number(directMatch[1])
  }

  const stars = (normalized.match(/[⭐★]/g) ?? []).length
  if (stars >= 1 && stars <= 5) {
    return stars
  }

  const textualRatings: Record<string, number> = {
    'nota um': 1,
    'nota dois': 2,
    'nota tres': 3,
    'nota três': 3,
    'nota quatro': 4,
    'nota cinco': 5,
  }

  for (const [pattern, value] of Object.entries(textualRatings)) {
    if (normalized.includes(pattern)) return value
  }

  return null
}

export function analyzeNewsletterSentiment(message: string): NewsletterSentiment {
  const normalized = message.toLowerCase()
  let score = 0

  for (const hint of POSITIVE_HINTS) {
    if (normalized.includes(hint)) score += 0.2
  }

  for (const hint of NEGATIVE_HINTS) {
    if (normalized.includes(hint)) score -= 0.3
  }

  if (normalized.includes('!')) score += 0.05
  if (normalized.includes('??')) score -= 0.05

  const finalScore = clampSentiment(score)
  let label: NewsletterSentimentLabel = 'neutral'
  if (finalScore >= 0.2) label = 'positive'
  if (finalScore <= -0.2) label = 'negative'

  return {
    score: Number(finalScore.toFixed(3)),
    label,
  }
}

export function detectNewsletterIntent(message: string): {
  intent: NewsletterIntent
  feedbackRating: number | null
} {
  const normalized = message.toLowerCase()
  const feedbackRating = detectFeedbackRating(normalized)

  if (OPTOUT_HINTS.some((hint) => normalized.includes(hint))) {
    return { intent: 'opt_out', feedbackRating }
  }

  if (SUBSCRIBE_HINTS.some((hint) => normalized.includes(hint))) {
    return { intent: 'subscribe', feedbackRating }
  }

  if (feedbackRating !== null || FEEDBACK_HINTS.some((hint) => normalized.includes(hint))) {
    return { intent: 'feedback', feedbackRating }
  }

  if (normalized.includes('?')) {
    return { intent: 'question', feedbackRating }
  }

  return { intent: 'other', feedbackRating }
}

function buildSystemPrompt(input: {
  customerName: string | null
  sentiment: NewsletterSentiment
}): string {
  const customerLabel = safeString(input.customerName) ?? 'lead'

  return `Voce e um especialista em relacionamento via WhatsApp para conversao de newsletter semanal.

Objetivo:
- Converter o lead para inscricao na newsletter semanal.
- Fazer isso com tom humano, curto e respeitoso.

Regras:
- Escreva em portugues brasileiro coloquial.
- Maximo de 320 caracteres.
- Nunca pressione se o lead estiver negativo.
- Sempre ofereca saida simples: "se quiser parar, e so falar SAIR".
- Finalize com CTA claro para inscricao.

Contexto atual:
- Nome do lead: ${customerLabel}
- Sentimento atual: ${input.sentiment.label} (${input.sentiment.score})`
}

function buildConversationContext(messages: NewsletterConversationMessageRecord[]): string {
  const window = messages.slice(-8)
  if (!window.length) return 'Sem historico previo.'

  return window
    .map((entry) => `${entry.direction.toUpperCase()}: ${entry.message_text}`)
    .join('\n')
}

function fallbackReply(intent: NewsletterIntent): string {
  if (intent === 'opt_out') {
    return 'Combinado, vou pausar seus envios agora. Se quiser voltar depois, e so me chamar com "quero assinar".'
  }

  if (intent === 'subscribe') {
    return 'Perfeito! Inscricao confirmada na newsletter semanal. Toda semana chega um resumo pratico aqui. Se quiser pausar, diga SAIR. Se puder, me de uma nota de 1 a 5 sobre este atendimento?'
  }

  if (intent === 'feedback') {
    return 'Obrigado pelo feedback! Isso ajuda a melhorar bastante as proximas conversas.'
  }

  return 'Posso te enviar um resumo semanal com ideias praticas para melhorar seus resultados? Se topar, responde "quero assinar".'
}

function fallbackOpeningMessage(customerName: string | null): string {
  const nameChunk = customerName ? ` ${customerName}` : ''
  return `Oi${nameChunk}! Eu preparo um resumo semanal com ideias praticas de crescimento em 2 minutos de leitura. Quer que eu te envie a proxima edicao gratuitamente?`
}

export async function generateNewsletterOpeningMessage(
  env: Bindings,
  input: {
    customerName: string | null
    contextHint?: string | null
  }
): Promise<string> {
  const systemPrompt =
    'Voce escreve mensagens curtas para abordagem inicial no WhatsApp com foco em inscricao de newsletter semanal.'
  const contextHint = safeString(input.contextHint)
  const prompt = [
    'Gere uma mensagem inicial de abordagem para convidar a pessoa a assinar uma newsletter semanal.',
    'Regras: portugues brasileiro, natural, sem cara de bot, maximo 260 caracteres, CTA claro.',
    'Inclua opcao de saida: "se quiser parar, e so falar SAIR".',
    input.customerName ? `Nome da pessoa: ${input.customerName}.` : null,
    contextHint ? `Contexto adicional: ${contextHint}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const startedAt = Date.now()
  try {
    const response = await env.AI.run(DEFAULT_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    })

    const generated = safeString(extractAIText(response))
    const openingMessage = generated ? generated.slice(0, 260) : fallbackOpeningMessage(input.customerName)

    await logAIInference(env, {
      flow: 'newsletter_agent_opening_message',
      model: DEFAULT_AI_MODEL,
      status: 'success',
      latencyMs: Date.now() - startedAt,
      fallbackUsed: !generated,
      promptSource: `${systemPrompt}\n${prompt}`,
    })

    return openingMessage
  } catch (error) {
    await logAIInference(env, {
      flow: 'newsletter_agent_opening_message',
      model: DEFAULT_AI_MODEL,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      fallbackUsed: true,
      promptSource: `${systemPrompt}\n${prompt}`,
      errorMessage: String(error),
    })
    return fallbackOpeningMessage(input.customerName)
  }
}

export async function generateNewsletterAgentReply(
  env: Bindings,
  input: {
    customerName: string | null
    inboundMessage: string
    history: NewsletterConversationMessageRecord[]
  }
): Promise<NewsletterAgentReply> {
  const message = safeString(input.inboundMessage)
  if (!message) {
    throw new Error('inboundMessage is required')
  }

  const sentiment = analyzeNewsletterSentiment(message)
  const { intent, feedbackRating } = detectNewsletterIntent(message)

  if (intent === 'subscribe' || intent === 'opt_out' || intent === 'feedback') {
    return {
      replyText: fallbackReply(intent),
      intent,
      sentiment,
      feedbackRating,
      shouldConvert: intent === 'subscribe',
      shouldOptOut: intent === 'opt_out',
    }
  }

  const systemPrompt = buildSystemPrompt({
    customerName: input.customerName,
    sentiment,
  })
  const conversationContext = buildConversationContext(input.history)
  const promptSource = `${systemPrompt}\n\nHISTORICO:\n${conversationContext}\n\nNOVA_MENSAGEM:${message}`
  const startedAt = Date.now()

  try {
    const response = await env.AI.run(DEFAULT_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            `Historico recente:\n${conversationContext}\n\nMensagem atual do lead: ${message}\n\nResponda com uma unica mensagem pronta para WhatsApp.`,
        },
      ],
    })

    const generated = safeString(extractAIText(response))
    const replyText = generated ? generated.slice(0, 320) : fallbackReply(intent)

    await logAIInference(env, {
      flow: 'newsletter_agent_reply',
      model: DEFAULT_AI_MODEL,
      status: 'success',
      latencyMs: Date.now() - startedAt,
      fallbackUsed: !generated,
      promptSource,
      metadata: {
        intent,
        sentimentLabel: sentiment.label,
      },
    })

    return {
      replyText,
      intent,
      sentiment,
      feedbackRating,
      shouldConvert: false,
      shouldOptOut: false,
    }
  } catch (error) {
    await logAIInference(env, {
      flow: 'newsletter_agent_reply',
      model: DEFAULT_AI_MODEL,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      fallbackUsed: true,
      promptSource,
      errorMessage: String(error),
      metadata: {
        intent,
        sentimentLabel: sentiment.label,
      },
    })

    return {
      replyText: fallbackReply(intent),
      intent,
      sentiment,
      feedbackRating,
      shouldConvert: false,
      shouldOptOut: false,
    }
  }
}
