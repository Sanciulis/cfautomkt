import type {
  Bindings,
  TelegramConversationMessageRecord,
  NewsletterSentimentLabel,
  TelegramWebhookUpdate,
} from './types'
import { DEFAULT_AI_MODEL } from './constants'
import { extractAIText, safeString } from './utils'
import { logAIInference } from './ai-observability'
import { getActivePrompt } from './prompt-manager'
import {
  getLatestTelegramConversationSessionByChatId,
  createTelegramConversationSession,
  appendTelegramConversationMessage,
  updateTelegramConversationSession,
  listTelegramConversationMessages,
} from './db'

type TelegramIntent = 'question' | 'feedback' | 'opt_out' | 'other'

type TelegramSentiment = {
  score: number
  label: NewsletterSentimentLabel
}

type TelegramAgentReply = {
  replyText: string
  intent: TelegramIntent
  sentiment: TelegramSentiment
  shouldOptOut: boolean
}

const POSITIVE_HINTS = [
  'obrigado',
  'valeu',
  'ótimo',
  'bom',
  'gostei',
  'interessante',
  'legal',
  'top',
  'massa',
  'perfeito',
  'curti',
  'sim',
]

const NEGATIVE_HINTS = [
  'não',
  'nao',
  'pare',
  'sair',
  'chato',
  'ruim',
  'ódio',
  'irritado',
  'problema',
  'erro',
]

const OPT_OUT_HINTS = [
  'parar',
  'cancelar',
  'desinscrever',
  'remover',
  'bloquear',
  'stop',
  'sair',
  'adeus',
  'tchau',
]

function analyzeTelegramSentiment(text: string): TelegramSentiment {
  const lowerText = text.toLowerCase()
  let score = 0.5 // neutral default

  // Count positive and negative hints
  const positiveCount = POSITIVE_HINTS.reduce(
    (count, hint) => count + (lowerText.includes(hint) ? 1 : 0),
    0
  )
  const negativeCount = NEGATIVE_HINTS.reduce(
    (count, hint) => count + (lowerText.includes(hint) ? 1 : 0),
    0
  )

  // Adjust score based on hints
  score += (positiveCount * 0.1) - (negativeCount * 0.1)
  score = Math.max(0, Math.min(1, score))

  let label: NewsletterSentimentLabel = 'neutral'
  if (score >= 0.7) label = 'positive'
  else if (score <= 0.3) label = 'negative'

  return { score, label }
}

function analyzeTelegramIntent(text: string): TelegramIntent {
  const lowerText = text.toLowerCase()

  // Check for opt-out first
  if (OPT_OUT_HINTS.some(hint => lowerText.includes(hint))) {
    return 'opt_out'
  }

  // Check for feedback
  if (lowerText.includes('feedback') || lowerText.includes('avaliacao') || lowerText.includes('avaliação')) {
    return 'feedback'
  }

  // Check for questions
  if (lowerText.includes('?') || lowerText.includes('como') || lowerText.includes('quando') ||
      lowerText.includes('onde') || lowerText.includes('por que') || lowerText.includes('porque') ||
      lowerText.includes('qual') || lowerText.includes('quem')) {
    return 'question'
  }

  return 'other'
}

async function generateTelegramReply(
  env: Bindings,
  conversationHistory: TelegramConversationMessageRecord[],
  userMessage: string,
  config: { aiModel: string; maxReplyChars: number }
): Promise<TelegramAgentReply> {
  const intent = analyzeTelegramIntent(userMessage)
  const sentiment = analyzeTelegramSentiment(userMessage)

  // Build conversation context
  const contextMessages = conversationHistory.slice(-10) // Last 10 messages
  const conversationContext = contextMessages
    .map(msg => `${msg.direction === 'inbound' ? 'User' : 'Bot'}: ${msg.message_text}`)
    .join('\n')

  const promptText = `Você é um assistente de conversação amigável no Telegram.

CONTEXTO DA CONVERSAÇÃO:
${conversationContext}

ÚLTIMA MENSAGEM DO USUÁRIO: ${userMessage}

INSTRUÇÕES:
- Responda de forma natural e amigável em português brasileiro
- Mantenha a resposta concisa (máximo ${config.maxReplyChars} caracteres)
- Seja útil e informativo
- Não use formatação markdown desnecessária
- Se o usuário quiser parar a conversa, respeite isso

Responda à mensagem do usuário:`

  try {
    const startTime = Date.now()
    const aiResponse = await env.AI.run(config.aiModel, {
      messages: [{ role: 'user', content: promptText }],
    })
    const endTime = Date.now()

    const replyText = extractAIText(aiResponse) || 'Desculpe, não consegui processar sua mensagem.'

    // Truncate if too long
    const truncatedReply = replyText.length > config.maxReplyChars
      ? replyText.substring(0, config.maxReplyChars - 3) + '...'
      : replyText

    // Log AI inference
    await logAIInference(env, {
      flow: 'telegram_agent_reply',
      model: config.aiModel,
      status: 'success',
      latencyMs: endTime - startTime,
    })

    return {
      replyText: truncatedReply,
      intent,
      sentiment,
      shouldOptOut: intent === 'opt_out',
    }
  } catch (error) {
    console.error('Telegram AI reply generation failed:', error)

    // Log failed inference
    await logAIInference(env, {
      flow: 'telegram_agent_reply',
      model: config.aiModel,
      status: 'error',
      latencyMs: 0,
      errorMessage: String(error),
    })

    // Fallback response
    const fallbackReply = intent === 'opt_out'
      ? 'Entendido. Se quiser conversar novamente, é só me chamar!'
      : 'Desculpe, estou com dificuldades técnicas no momento. Tente novamente mais tarde.'

    return {
      replyText: fallbackReply,
      intent,
      sentiment,
      shouldOptOut: intent === 'opt_out',
    }
  }
}

export async function generateTelegramAgentReply(
  env: Bindings,
  sessionId: string,
  userMessage: string,
  config: { aiModel: string; maxReplyChars: number }
): Promise<TelegramAgentReply> {
  // Get conversation history
  const conversationHistory = await listTelegramConversationMessages(env, sessionId, 50)

  // Generate AI reply
  const reply = await generateTelegramReply(env, conversationHistory, userMessage, config)

  return reply
}

export async function handleTelegramWebhook(
  env: Bindings,
  update: TelegramWebhookUpdate,
  config: { aiModel: string; maxReplyChars: number; conversationEnabled: boolean }
): Promise<{ shouldReply: boolean; replyText?: string; sessionId?: string }> {
  // Only handle messages
  if (!update.message || !update.message.text) {
    return { shouldReply: false }
  }

  const message = update.message
  const chatId = message.chat.id.toString()
  const userMessage = message.text?.trim()

  if (!userMessage) {
    return { shouldReply: false }
  }

  // Skip if conversations are disabled
  if (!config.conversationEnabled) {
    return { shouldReply: false }
  }

  // Get or create conversation session
  let session = await getLatestTelegramConversationSessionByChatId(env, chatId)

  if (!session) {
    // Create new session
    session = await createTelegramConversationSession(env, {
      chatId,
      username: message.from.username,
      firstName: message.from.first_name,
      lastName: message.from.last_name,
    })
  }

  // Skip if session is closed or opted out
  if (session.status === 'closed' || session.status === 'opt_out') {
    return { shouldReply: false }
  }

  // Add user message to conversation
  await appendTelegramConversationMessage(env, session.id, {
    direction: 'inbound',
    messageText: userMessage,
    messageId: message.message_id,
  })

  // Generate reply
  const reply = await generateTelegramAgentReply(env, session.id, userMessage, config)

  // Add bot reply to conversation
  await appendTelegramConversationMessage(env, session.id, {
    direction: 'agent',
    messageText: reply.replyText,
    messageId: 0, // Bot messages don't have Telegram message IDs
    sentimentScore: reply.sentiment.score,
    sentimentLabel: reply.sentiment.label,
    aiModel: config.aiModel,
  })

  // Update session status if needed
  if (reply.shouldOptOut) {
    await updateTelegramConversationSession(env, session.id, { status: 'opt_out' })
  }

  // Update session sentiment
  await updateTelegramConversationSession(env, session.id, {
    sentimentScore: reply.sentiment.score,
    sentimentLabel: reply.sentiment.label,
  })

  return {
    shouldReply: true,
    replyText: reply.replyText,
    sessionId: session.id,
  }
}

export async function sendTelegramMessage(
  env: Bindings,
  chatId: string,
  text: string
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return false
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Telegram API error:', response.status, errorText)
      return false
    }

    return true
  } catch (error) {
    console.error('Failed to send Telegram message:', error)
    return false
  }
}