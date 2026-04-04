import type {
  AdminServiceAgentConfig,
  Bindings,
  NewsletterSentimentLabel,
  ServiceAgentIntent,
  ServiceConversationMessageRecord,
  ServiceConversationStatus,
} from './types'
import {
  DEFAULT_AI_MODEL,
  DEFAULT_SERVICE_AGENT_OFF_HOURS_REPLY,
  DEFAULT_SERVICE_AGENT_OPENING_TEMPLATE,
  DEFAULT_SERVICE_AGENT_QUALIFICATION_SCRIPT,
} from './constants'
import { extractAIText, safeString } from './utils'
import { logAIInference } from './ai-observability'
import { getActivePrompt } from './prompt-manager'

type ServiceSentiment = {
  score: number
  label: NewsletterSentimentLabel
}

type ServiceAppointmentDraft = {
  serviceType: string | null
  requestedDate: string | null
  requestedTime: string | null
  timezone: string | null
  notes: string | null
}

type ServiceQuoteDraft = {
  serviceType: string | null
  budgetRange: string | null
  timeline: string | null
  details: string | null
}

export type ServiceAgentReply = {
  replyText: string
  intent: ServiceAgentIntent
  sentiment: ServiceSentiment
  sessionStatus: ServiceConversationStatus
  shouldOptOut: boolean
  shouldCreateAppointment: boolean
  shouldCreateQuote: boolean
  appointmentDraft: ServiceAppointmentDraft | null
  quoteDraft: ServiceQuoteDraft | null
}

const POSITIVE_HINTS = [
  'quero',
  'perfeito',
  'otimo',
  'bom',
  'massa',
  'show',
  'top',
  'sim',
]

const NEGATIVE_HINTS = [
  'nao',
  'ruim',
  'caro',
  'caro demais',
  'demorado',
  'chato',
  'desisti',
]

const OPTOUT_HINTS = [
  'sair',
  'parar',
  'nao quero mais',
  'pare de mandar',
  'remover',
  'cancelar mensagens',
]

const APPOINTMENT_HINTS = [
  'agendar',
  'agenda',
  'marcar',
  'horario',
  'reuniao',
  'consulta',
]

const QUOTE_HINTS = [
  'orcamento',
  'preco',
  'quanto custa',
  'valor',
  'proposta',
]

const QUESTION_HINTS = ['duvida', 'como funciona', 'explica', '?']

const SERVICE_KEYWORDS: Array<{ pattern: string; label: string }> = [
  { pattern: 'mentoria', label: 'mentoria' },
  { pattern: 'consultoria', label: 'consultoria' },
  { pattern: 'automacao', label: 'automacao' },
  { pattern: 'trafego', label: 'trafego pago' },
  { pattern: 'whatsapp', label: 'automacao whatsapp' },
  { pattern: 'crm', label: 'implantacao crm' },
  { pattern: 'site', label: 'site ou landing page' },
]

type ResolvedServiceAgentConfig = {
  businessHoursEnabled: boolean
  businessHoursStart: string | null
  businessHoursEnd: string | null
  timezone: string
  offHoursAutoReply: string
  openingTemplate: string
  qualificationScript: string
  aiModel: string
  maxReplyChars: number
}

function resolveRuntimeConfig(config?: AdminServiceAgentConfig | null): ResolvedServiceAgentConfig {
  const maxReplyChars = Number(config?.maxReplyChars)
  return {
    businessHoursEnabled: Boolean(config?.businessHoursEnabled),
    businessHoursStart: safeString(config?.businessHoursStart) ?? '09:00',
    businessHoursEnd: safeString(config?.businessHoursEnd) ?? '18:00',
    timezone: safeString(config?.timezone) ?? 'America/Sao_Paulo',
    offHoursAutoReply:
      safeString(config?.offHoursAutoReply) ?? DEFAULT_SERVICE_AGENT_OFF_HOURS_REPLY,
    openingTemplate:
      safeString(config?.openingTemplate) ?? DEFAULT_SERVICE_AGENT_OPENING_TEMPLATE,
    qualificationScript:
      safeString(config?.qualificationScript) ?? DEFAULT_SERVICE_AGENT_QUALIFICATION_SCRIPT,
    aiModel: safeString(config?.aiModel) ?? DEFAULT_AI_MODEL,
    maxReplyChars:
      Number.isFinite(maxReplyChars) && maxReplyChars >= 160 && maxReplyChars <= 700
        ? Math.round(maxReplyChars)
        : 340,
  }
}

function parseHourToMinutes(value: string | null): number | null {
  const raw = safeString(value)
  if (!raw) return null
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour * 60 + minute
}

function getLocalTimeMinutes(timezone: string): number | null {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())

    const [hourPart, minutePart] = formatted.split(':')
    const hour = Number(hourPart)
    const minute = Number(minutePart)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return hour * 60 + minute
  } catch {
    return null
  }
}

function isInsideBusinessHours(config: ResolvedServiceAgentConfig): boolean {
  if (!config.businessHoursEnabled) return true

  const startMinutes = parseHourToMinutes(config.businessHoursStart)
  const endMinutes = parseHourToMinutes(config.businessHoursEnd)
  const nowMinutes = getLocalTimeMinutes(config.timezone)

  if (startMinutes === null || endMinutes === null || nowMinutes === null) return true

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes
  }

  return nowMinutes >= startMinutes || nowMinutes <= endMinutes
}

function applyTemplate(template: string, customerName: string | null): string {
  const customerLabel = safeString(customerName) ?? 'cliente'
  return template
    .replace(/{{\s*name\s*}}/gi, customerLabel)
    .replace(/{{\s*optOutHint\s*}}/gi, 'Se preferir parar, e so responder SAIR.')
}

function clampSentiment(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

export function analyzeServiceSentiment(message: string): ServiceSentiment {
  const normalized = message.toLowerCase()
  let score = 0

  for (const hint of POSITIVE_HINTS) {
    if (normalized.includes(hint)) score += 0.2
  }

  for (const hint of NEGATIVE_HINTS) {
    if (normalized.includes(hint)) score -= 0.25
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

export function detectServiceIntent(message: string): ServiceAgentIntent {
  const normalized = message.toLowerCase()

  if (OPTOUT_HINTS.some((hint) => normalized.includes(hint))) return 'opt_out'
  if (APPOINTMENT_HINTS.some((hint) => normalized.includes(hint))) return 'appointment'
  if (QUOTE_HINTS.some((hint) => normalized.includes(hint))) return 'quote'
  if (QUESTION_HINTS.some((hint) => normalized.includes(hint))) return 'question'

  return 'other'
}

function extractServiceType(message: string): string | null {
  const normalized = message.toLowerCase()
  for (const item of SERVICE_KEYWORDS) {
    if (normalized.includes(item.pattern)) return item.label
  }
  return null
}

function extractRequestedDate(message: string): string | null {
  const normalized = message.toLowerCase()

  const explicitDate = normalized.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/)
  if (explicitDate?.[1]) return explicitDate[1]

  if (normalized.includes('amanha')) return 'amanha'
  if (normalized.includes('hoje')) return 'hoje'
  if (normalized.includes('segunda')) return 'segunda-feira'
  if (normalized.includes('terca')) return 'terca-feira'
  if (normalized.includes('quarta')) return 'quarta-feira'
  if (normalized.includes('quinta')) return 'quinta-feira'
  if (normalized.includes('sexta')) return 'sexta-feira'

  return null
}

function extractRequestedTime(message: string): string | null {
  const normalized = message.toLowerCase()
  const match = normalized.match(/\b([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\b/)
  if (!match?.[1]) return null

  const hour = match[1].padStart(2, '0')
  const minute = (match[2] ?? '00').padStart(2, '0')
  return `${hour}:${minute}`
}

function extractBudgetRange(message: string): string | null {
  const normalized = message.toLowerCase()

  const rangeMatch = normalized.match(/(r\$\s*\d[\d\.,]{1,}|\d+[k]?\s*(?:a|ate|-)\s*\d+[k]?)/i)
  if (rangeMatch?.[1]) {
    return safeString(rangeMatch[1])
  }

  if (normalized.includes('baixo custo') || normalized.includes('mais barato')) return 'baixo custo'
  if (normalized.includes('premium') || normalized.includes('completo')) return 'premium'

  return null
}

function extractTimeline(message: string): string | null {
  const normalized = message.toLowerCase()
  if (normalized.includes('urgente')) return 'urgente'
  if (normalized.includes('esta semana') || normalized.includes('essa semana')) return 'esta semana'
  if (normalized.includes('este mes') || normalized.includes('esse mes')) return 'este mes'

  const byDuration = normalized.match(/em\s+(\d+\s*(?:dias?|semanas?|meses?))/)
  if (byDuration?.[1]) return byDuration[1]

  return null
}

function buildConversationContext(messages: ServiceConversationMessageRecord[]): string {
  const window = messages.slice(-10)
  if (!window.length) return 'Sem historico previo.'

  return window
    .map((entry) => `${entry.direction.toUpperCase()}: ${entry.message_text}`)
    .join('\n')
}

function buildSystemPrompt(
  customerName: string | null,
  config: ResolvedServiceAgentConfig
): string {
  const customerLabel = safeString(customerName) ?? 'cliente'
  const qualificationScript = config.qualificationScript

  return `Voce e um consultor comercial via WhatsApp para servicos de marketing e automacao.

Objetivos:
- Ajudar com agendamentos, orcamentos e duvidas.
- Avancar para o proximo passo comercial com clareza.

Regras:
- Portugues brasileiro, tom humano, maximo ${config.maxReplyChars} caracteres.
- Seja direto, cordial e objetivo.
- Nunca invente preco fechado se nao tiver dado suficiente.
- Se faltar dado, faca ate duas perguntas curtas para fechar contexto.
- Sempre ofereca saida: "Se preferir parar, me avise com SAIR".

Diretriz de qualificacao:
- ${qualificationScript}

Contato atual: ${customerLabel}`
}

function fallbackOpeningMessage(
  customerName: string | null,
  config: ResolvedServiceAgentConfig
): string {
  return applyTemplate(config.openingTemplate, customerName).slice(0, 260)
}

function fallbackOptOutReply(): string {
  return 'Perfeito, vou encerrar as mensagens por aqui. Se quiser retomar no futuro, basta me chamar novamente.'
}

function buildAppointmentFallbackReply(draft: ServiceAppointmentDraft): string {
  if (!draft.requestedDate || !draft.requestedTime) {
    return 'Consigo te ajudar com o agendamento. Me diz o melhor dia e horario para voce? Se quiser, ja me passe tambem o tipo de servico.'
  }

  return `Perfeito! Vou registrar seu agendamento para ${draft.requestedDate} as ${draft.requestedTime}. Quer me confirmar o servico principal para ja adiantar o atendimento?`
}

function buildQuoteFallbackReply(draft: ServiceQuoteDraft): string {
  if (!draft.serviceType || !draft.budgetRange) {
    return 'Consigo montar seu orcamento. Me passa o servico que voce precisa e a faixa de investimento que faz sentido hoje.'
  }

  const timelineChunk = draft.timeline ? ` e prazo ${draft.timeline}` : ''
  return `Perfeito. Vou preparar uma proposta para ${draft.serviceType} na faixa ${draft.budgetRange}${timelineChunk}. Se preferir, me diga algum detalhe adicional do projeto.`
}

function fallbackQuestionReply(): string {
  return 'Posso te ajudar com detalhes de servicos, prazos e formatos de atendimento. Me conta sua principal duvida para eu te responder de forma objetiva.'
}

function inferSessionStatus(intent: ServiceAgentIntent): ServiceConversationStatus {
  if (intent === 'opt_out') return 'opt_out'
  if (intent === 'appointment') return 'scheduled'
  if (intent === 'quote') return 'quoted'
  if (intent === 'question') return 'qualified'
  return 'active'
}

export async function generateServiceOpeningMessage(
  env: Bindings,
  input: {
    customerName: string | null
    contextHint?: string | null
    config?: AdminServiceAgentConfig | null
  }
): Promise<string> {
  const runtimeConfig = resolveRuntimeConfig(input.config)
  if (!isInsideBusinessHours(runtimeConfig)) {
    return runtimeConfig.offHoursAutoReply.slice(0, 260)
  }

  const fallbackSystemPrompt =
    'Voce escreve mensagens iniciais para atendimento comercial no WhatsApp com foco em agendamento, orcamento e esclarecimento de duvidas.'
  const activePrompt = await getActivePrompt(
    env,
    'flow:service_agent_opening_message',
    fallbackSystemPrompt,
    runtimeConfig.aiModel
  )
  const systemPrompt = activePrompt.text
  const modelToUse = activePrompt.model

  const contextHint = safeString(input.contextHint)
  const prompt = [
    'Gere uma mensagem curta de abertura para atendimento comercial via WhatsApp.',
    'A mensagem deve oferecer: agendamento, orcamento e tira-duvidas.',
    'Tom humano, sem linguagem robotica, maximo 260 caracteres.',
    'Inclua opcao de saida: "se preferir parar, e so responder SAIR".',
    `Diretriz de qualificacao: ${runtimeConfig.qualificationScript}.`,
    `Template base desejado: ${runtimeConfig.openingTemplate}.`,
    input.customerName ? `Nome da pessoa: ${input.customerName}.` : null,
    contextHint ? `Contexto adicional: ${contextHint}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const startedAt = Date.now()
  try {
    const response = await env.AI.run(modelToUse, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    })

    const generated = safeString(extractAIText(response))
    const openingMessage = generated
      ? generated.slice(0, 260)
      : fallbackOpeningMessage(input.customerName, runtimeConfig)

    await logAIInference(env, {
      flow: 'service_agent_opening_message',
      model: modelToUse,
      status: 'success',
      latencyMs: Date.now() - startedAt,
      fallbackUsed: !generated,
      promptSource: `${systemPrompt}\n${prompt}`,
    })

    return openingMessage
  } catch (error) {
    await logAIInference(env, {
      flow: 'service_agent_opening_message',
      model: modelToUse,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      fallbackUsed: true,
      promptSource: `${systemPrompt}\n${prompt}`,
      errorMessage: String(error),
    })

    return fallbackOpeningMessage(input.customerName, runtimeConfig)
  }
}

export async function generateServiceAgentReply(
  env: Bindings,
  input: {
    customerName: string | null
    inboundMessage: string
    history: ServiceConversationMessageRecord[]
    config?: AdminServiceAgentConfig | null
  }
): Promise<ServiceAgentReply> {
  const message = safeString(input.inboundMessage)
  if (!message) {
    throw new Error('inboundMessage is required')
  }

  const runtimeConfig = resolveRuntimeConfig(input.config)

  const sentiment = analyzeServiceSentiment(message)
  const intent = detectServiceIntent(message)
  const sessionStatus = inferSessionStatus(intent)

  const appointmentDraft: ServiceAppointmentDraft | null =
    intent === 'appointment'
      ? {
          serviceType: extractServiceType(message),
          requestedDate: extractRequestedDate(message),
          requestedTime: extractRequestedTime(message),
          timezone: 'America/Sao_Paulo',
          notes: message,
        }
      : null

  const quoteDraft: ServiceQuoteDraft | null =
    intent === 'quote'
      ? {
          serviceType: extractServiceType(message),
          budgetRange: extractBudgetRange(message),
          timeline: extractTimeline(message),
          details: message,
        }
      : null

  if (intent === 'opt_out') {
    return {
      replyText: fallbackOptOutReply(),
      intent,
      sentiment,
      sessionStatus,
      shouldOptOut: true,
      shouldCreateAppointment: false,
      shouldCreateQuote: false,
      appointmentDraft: null,
      quoteDraft: null,
    }
  }

  if (!isInsideBusinessHours(runtimeConfig)) {
    return {
      replyText: runtimeConfig.offHoursAutoReply.slice(0, runtimeConfig.maxReplyChars),
      intent,
      sentiment,
      sessionStatus: 'active',
      shouldOptOut: false,
      shouldCreateAppointment: false,
      shouldCreateQuote: false,
      appointmentDraft: null,
      quoteDraft: null,
    }
  }

  if (intent === 'appointment') {
    return {
      replyText: buildAppointmentFallbackReply(appointmentDraft!),
      intent,
      sentiment,
      sessionStatus,
      shouldOptOut: false,
      shouldCreateAppointment: true,
      shouldCreateQuote: false,
      appointmentDraft,
      quoteDraft: null,
    }
  }

  if (intent === 'quote') {
    return {
      replyText: buildQuoteFallbackReply(quoteDraft!),
      intent,
      sentiment,
      sessionStatus,
      shouldOptOut: false,
      shouldCreateAppointment: false,
      shouldCreateQuote: true,
      appointmentDraft: null,
      quoteDraft,
    }
  }

  if (intent === 'question') {
    const conversationContext = buildConversationContext(input.history)
    const fallbackSystemPrompt = buildSystemPrompt(input.customerName, runtimeConfig)
    const activePrompt = await getActivePrompt(
      env,
      'flow:service_agent_reply',
      fallbackSystemPrompt,
      runtimeConfig.aiModel
    )
    const systemPrompt = activePrompt.text
    const modelToUse = activePrompt.model
    const promptSource = `${systemPrompt}\n\nHISTORICO:\n${conversationContext}\n\nNOVA_MENSAGEM:${message}`
    const startedAt = Date.now()

    try {
      const response = await env.AI.run(modelToUse, {
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content:
              `Historico recente:\n${conversationContext}\n\nDuvida do cliente: ${message}\n\nResponda de forma curta e objetiva para WhatsApp.`,
          },
        ],
      })

      const generated = safeString(extractAIText(response))
      const replyText = generated
        ? generated.slice(0, runtimeConfig.maxReplyChars)
        : fallbackQuestionReply()

      await logAIInference(env, {
        flow: 'service_agent_reply',
        model: modelToUse,
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
        sessionStatus,
        shouldOptOut: false,
        shouldCreateAppointment: false,
        shouldCreateQuote: false,
        appointmentDraft: null,
        quoteDraft: null,
      }
    } catch (error) {
      await logAIInference(env, {
        flow: 'service_agent_reply',
        model: modelToUse,
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
        replyText: fallbackQuestionReply(),
        intent,
        sentiment,
        sessionStatus,
        shouldOptOut: false,
        shouldCreateAppointment: false,
        shouldCreateQuote: false,
        appointmentDraft: null,
        quoteDraft: null,
      }
    }
  }

  return {
    replyText: 'Posso te ajudar com agendamento, orcamento ou tirar duvidas. Qual desses voce quer resolver agora?',
    intent,
    sentiment,
    sessionStatus,
    shouldOptOut: false,
    shouldCreateAppointment: false,
    shouldCreateQuote: false,
    appointmentDraft: null,
    quoteDraft: null,
  }
}
