import type {
  Bindings,
  TelegramConversationMessageRecord,
  NewsletterSentimentLabel,
  TelegramWebhookUpdate,
} from './types'
import { DEFAULT_AI_MODEL, DEFAULT_TELEGRAM_AGENT_REPLY_PROMPT } from './constants'
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
  aiModelUsed: string
}

const POSITIVE_HINTS = [
  'obrigado',
  'valeu',
  'otimo',
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
  'nao',
  'pare',
  'sair',
  'chato',
  'ruim',
  'odio',
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
]

const REACTIVATE_HINTS = ['/start', 'voltar', 'retomar', 'reiniciar', 'recomecar']

function shouldIgnoreTelegramInboundText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return true

  // Inline bot mentions like @otherbot are typically not for this assistant.
  if (normalized.startsWith('@')) return true

  // Ignore slash commands except explicit reactivation/start commands.
  const isSlashCommand = normalized.startsWith('/')
  if (isSlashCommand) {
    const allowed = REACTIVATE_HINTS.some((hint) => normalized.startsWith(hint))
    return !allowed
  }

  return false
}

function analyzeTelegramSentiment(text: string): TelegramSentiment {
  const lowerText = text.toLowerCase()
  let score = 0.5

  const positiveCount = POSITIVE_HINTS.reduce(
    (count, hint) => count + (lowerText.includes(hint) ? 1 : 0),
    0
  )
  const negativeCount = NEGATIVE_HINTS.reduce(
    (count, hint) => count + (lowerText.includes(hint) ? 1 : 0),
    0
  )

  score += positiveCount * 0.1 - negativeCount * 0.1
  score = Math.max(0, Math.min(1, score))

  let label: NewsletterSentimentLabel = 'neutral'
  if (score >= 0.7) label = 'positive'
  else if (score <= 0.3) label = 'negative'

  return { score, label }
}

function analyzeTelegramIntent(text: string): TelegramIntent {
  const lowerText = text.toLowerCase()

  if (OPT_OUT_HINTS.some((hint) => lowerText.includes(hint))) {
    return 'opt_out'
  }

  if (
    lowerText.includes('feedback') ||
    lowerText.includes('avaliacao') ||
    lowerText.includes('avaliacao do atendimento')
  ) {
    return 'feedback'
  }

  if (
    lowerText.includes('?') ||
    lowerText.includes('como') ||
    lowerText.includes('quando') ||
    lowerText.includes('onde') ||
    lowerText.includes('por que') ||
    lowerText.includes('porque') ||
    lowerText.includes('qual') ||
    lowerText.includes('quem')
  ) {
    return 'question'
  }

  return 'other'
}

function renderTelegramPromptTemplate(
  promptText: string,
  context: {
    conversationContext: string
    userMessage: string
    detectedIntent: TelegramIntent
    maxReplyChars: number
  }
): string {
  return promptText
    .replace(/\{\{\s*conversation_context\s*\}\}/g, context.conversationContext)
    .replace(/\{\{\s*user_message\s*\}\}/g, context.userMessage)
    .replace(/\{\{\s*detected_intent\s*\}\}/g, context.detectedIntent)
    .replace(/\{\{\s*max_reply_chars\s*\}\}/g, String(context.maxReplyChars))
}

async function generateTelegramReply(
  env: Bindings,
  conversationHistory: TelegramConversationMessageRecord[],
  userMessage: string,
  config: { aiModel: string; maxReplyChars: number }
): Promise<TelegramAgentReply> {
  const intent = analyzeTelegramIntent(userMessage)
  const sentiment = analyzeTelegramSentiment(userMessage)

  const contextMessages = conversationHistory.slice(-10)
  const conversationContext = contextMessages
    .map((msg) => `${msg.direction === 'inbound' ? 'User' : 'Bot'}: ${msg.message_text}`)
    .join('\n')

  const activePrompt = await getActivePrompt(
    env,
    'flow:telegram_agent_reply',
    DEFAULT_TELEGRAM_AGENT_REPLY_PROMPT,
    config.aiModel || DEFAULT_AI_MODEL
  )

  const modelToUse = safeString(activePrompt.model) ?? config.aiModel ?? DEFAULT_AI_MODEL
  const promptText = renderTelegramPromptTemplate(activePrompt.text, {
    conversationContext: conversationContext || 'Sem historico anterior.',
    userMessage,
    detectedIntent: intent,
    maxReplyChars: config.maxReplyChars,
  })

  try {
    const startTime = Date.now()
    const aiResponse = await env.AI.run(modelToUse, {
      messages: [
        { role: 'system', content: promptText },
        { role: 'user', content: userMessage },
      ],
    })
    const endTime = Date.now()

    const replyText = extractAIText(aiResponse) || 'Desculpe, nao consegui processar sua mensagem.'
    const truncatedReply =
      replyText.length > config.maxReplyChars
        ? replyText.substring(0, config.maxReplyChars - 3) + '...'
        : replyText

    await logAIInference(env, {
      flow: 'telegram_agent_reply',
      model: modelToUse,
      status: 'success',
      latencyMs: endTime - startTime,
    })

    return {
      replyText: truncatedReply,
      intent,
      sentiment,
      shouldOptOut: intent === 'opt_out',
      aiModelUsed: modelToUse,
    }
  } catch (error) {
    console.error('Telegram AI reply generation failed:', error)

    await logAIInference(env, {
      flow: 'telegram_agent_reply',
      model: modelToUse,
      status: 'error',
      latencyMs: 0,
      errorMessage: String(error),
    })

    const fallbackReply =
      intent === 'opt_out'
        ? 'Entendido. Se quiser conversar novamente, e so me chamar.'
        : 'Desculpe, estou com dificuldades tecnicas no momento. Tente novamente mais tarde.'

    return {
      replyText: fallbackReply,
      intent,
      sentiment,
      shouldOptOut: intent === 'opt_out',
      aiModelUsed: modelToUse,
    }
  }
}

export async function generateTelegramAgentReply(
  env: Bindings,
  sessionId: string,
  userMessage: string,
  config: { aiModel: string; maxReplyChars: number }
): Promise<TelegramAgentReply> {
  const conversationHistory = await listTelegramConversationMessages(env, sessionId, 50)
  return generateTelegramReply(env, conversationHistory, userMessage, config)
}

export async function handleTelegramWebhook(
  env: Bindings,
  update: TelegramWebhookUpdate,
  config: { aiModel: string; maxReplyChars: number; conversationEnabled: boolean }
): Promise<{ shouldReply: boolean; replyText?: string; sessionId?: string }> {
  if (!update.message || !update.message.text) {
    return { shouldReply: false }
  }

  const message = update.message
  const chatId = message.chat.id.toString()
  const userMessage = message.text?.trim()

  if (!userMessage) {
    return { shouldReply: false }
  }

  if (shouldIgnoreTelegramInboundText(userMessage)) {
    return { shouldReply: false }
  }

  if (!config.conversationEnabled) {
    return { shouldReply: false }
  }

  let session = await getLatestTelegramConversationSessionByChatId(env, chatId)

  if (!session) {
    session = await createTelegramConversationSession(env, {
      chatId,
      username: message.from.username,
      firstName: message.from.first_name,
      lastName: message.from.last_name,
    })
  }

  if (session.status === 'closed') {
    return { shouldReply: false }
  }

  if (session.status === 'opt_out') {
    const lowerMessage = userMessage.toLowerCase()
    const wantsReactivate = REACTIVATE_HINTS.some((hint) => lowerMessage.includes(hint))
    if (!wantsReactivate) {
      return { shouldReply: false }
    }

    await updateTelegramConversationSession(env, session.id, { status: 'active' })
  }

  await appendTelegramConversationMessage(env, session.id, {
    direction: 'inbound',
    messageText: userMessage,
    messageId: message.message_id,
  })

  const reply = await generateTelegramAgentReply(env, session.id, userMessage, config)

  await appendTelegramConversationMessage(env, session.id, {
    direction: 'agent',
    messageText: reply.replyText,
    messageId: 0,
    sentimentScore: reply.sentiment.score,
    sentimentLabel: reply.sentiment.label,
    aiModel: reply.aiModelUsed,
  })

  if (reply.shouldOptOut) {
    await updateTelegramConversationSession(env, session.id, { status: 'opt_out' })
  }

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

export async function sendTelegramMessage(env: Bindings, chatId: string, text: string): Promise<boolean> {
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
        text,
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
