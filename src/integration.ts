import type { 
  Bindings, 
  AdminWhatsAppIntegrationConfig, 
  AdminEmailIntegrationConfig, 
  AdminTelegramIntegrationConfig,
  AdminServiceAgentConfig 
} from './types'
import { 
  ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY, 
  ADMIN_EMAIL_INTEGRATION_CONFIG_KEY, 
  ADMIN_TELEGRAM_INTEGRATION_CONFIG_KEY, 
  ADMIN_SERVICE_AGENT_CONFIG_KEY,
  DEFAULT_WHATSAPP_TEST_MESSAGE,
  DEFAULT_EMAIL_TEST_MESSAGE,
  DEFAULT_TELEGRAM_TEST_MESSAGE,
  DEFAULT_AI_MODEL,
  DEFAULT_SERVICE_AGENT_OFF_HOURS_REPLY,
  DEFAULT_SERVICE_AGENT_OPENING_TEMPLATE,
  DEFAULT_SERVICE_AGENT_QUALIFICATION_SCRIPT
} from './constants'
import { safeString } from './utils'

const BUSINESS_HOUR_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{6,20}:[A-Za-z0-9_-]{20,}$/
const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{6,20}$/
const TELEGRAM_CHAT_USERNAME_PATTERN = /^@[A-Za-z0-9_]{5,32}$/

export function looksLikeTelegramBotToken(value: string): boolean {
  return TELEGRAM_BOT_TOKEN_PATTERN.test(value.trim())
}

export function isValidTelegramChatId(value: string): boolean {
  const normalized = value.trim()
  return TELEGRAM_CHAT_ID_PATTERN.test(normalized) || TELEGRAM_CHAT_USERNAME_PATTERN.test(normalized)
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'on') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'off') return false
  }
  return fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function normalizeBusinessHour(value: unknown): string | null {
  const parsed = safeString(value)
  if (!parsed) return null
  return BUSINESS_HOUR_PATTERN.test(parsed) ? parsed : null
}

function normalizeTimezone(value: unknown): string {
  const timezone = safeString(value) ?? 'America/Sao_Paulo'
  try {
    Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date())
    return timezone
  } catch {
    return 'America/Sao_Paulo'
  }
}

export function validateAdminIntegrationWebhookUrl(
  value: string,
  env: Bindings
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    return { ok: false, error: 'Webhook URL invalida.' }
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { ok: false, error: 'Webhook URL deve usar http:// ou https://.' }
  }

  if ((env.APP_ENV ?? '').toLowerCase() === 'production' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'Em producao, webhook URL deve usar https://.' }
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: 'Webhook URL nao pode conter credenciais.' }
  }

  return { ok: true, normalizedUrl: parsedUrl.toString() }
}

export function normalizeWhatsAppIntegrationConfig(
  input: unknown,
  env: Bindings
): AdminWhatsAppIntegrationConfig {
  const defaultsWebhook =
    safeString(env.WHATSAPP_WEBHOOK_URL) ?? safeString(env.DISPATCH_WEBHOOK_URL) ?? null

  if (!input || typeof input !== 'object') {
    return {
      webhookUrl: defaultsWebhook,
      testPhone: null,
      testMessage: DEFAULT_WHATSAPP_TEST_MESSAGE,
      updatedAt: null,
      gatewayToken: null,
    }
  }

  const parsed = input as Partial<AdminWhatsAppIntegrationConfig>
  return {
    webhookUrl: safeString(parsed.webhookUrl) ?? defaultsWebhook,
    testPhone: safeString(parsed.testPhone),
    testMessage: safeString(parsed.testMessage) ?? DEFAULT_WHATSAPP_TEST_MESSAGE,
    updatedAt: safeString(parsed.updatedAt),
    gatewayToken: safeString(parsed.gatewayToken),
  }
}

export async function getAdminWhatsAppIntegrationConfig(
  env: Bindings
): Promise<AdminWhatsAppIntegrationConfig> {
  const raw = await env.MARTECH_KV.get(ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY)
  if (!raw) return normalizeWhatsAppIntegrationConfig(null, env)

  try {
    const parsed = JSON.parse(raw)
    return normalizeWhatsAppIntegrationConfig(parsed, env)
  } catch {
    return normalizeWhatsAppIntegrationConfig(null, env)
  }
}

export async function saveAdminWhatsAppIntegrationConfig(
  env: Bindings,
  config: AdminWhatsAppIntegrationConfig
): Promise<void> {
  await env.MARTECH_KV.put(ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY, JSON.stringify(config))
}

export function normalizeEmailIntegrationConfig(
  input: unknown,
  env: Bindings
): AdminEmailIntegrationConfig {
  const defaultsWebhook =
    safeString(env.EMAIL_WEBHOOK_URL) ?? safeString(env.DISPATCH_WEBHOOK_URL) ?? null

  if (!input || typeof input !== 'object') {
    return {
      webhookUrl: defaultsWebhook,
      testEmail: null,
      testSubject: 'Test Message from Martech Cloud',
      testMessage: DEFAULT_EMAIL_TEST_MESSAGE,
      updatedAt: null,
    }
  }

  const parsed = input as Partial<AdminEmailIntegrationConfig>
  return {
    webhookUrl: safeString(parsed.webhookUrl) ?? defaultsWebhook,
    testEmail: safeString(parsed.testEmail),
    testSubject: safeString(parsed.testSubject) ?? 'Test Message from Martech Cloud',
    testMessage: safeString(parsed.testMessage) ?? DEFAULT_EMAIL_TEST_MESSAGE,
    updatedAt: safeString(parsed.updatedAt),
  }
}

export async function getAdminEmailIntegrationConfig(
  env: Bindings
): Promise<AdminEmailIntegrationConfig> {
  const raw = await env.MARTECH_KV.get(ADMIN_EMAIL_INTEGRATION_CONFIG_KEY)
  if (!raw) return normalizeEmailIntegrationConfig(null, env)

  try {
    const parsed = JSON.parse(raw)
    return normalizeEmailIntegrationConfig(parsed, env)
  } catch {
    return normalizeEmailIntegrationConfig(null, env)
  }
}

export async function saveAdminEmailIntegrationConfig(
  env: Bindings,
  config: AdminEmailIntegrationConfig
): Promise<void> {
  await env.MARTECH_KV.put(ADMIN_EMAIL_INTEGRATION_CONFIG_KEY, JSON.stringify(config))
}

export function normalizeTelegramIntegrationConfig(
  input: unknown,
  env: Bindings
): AdminTelegramIntegrationConfig {
  const defaultsWebhook =
    safeString(env.TELEGRAM_WEBHOOK_URL) ?? safeString(env.DISPATCH_WEBHOOK_URL) ?? null

  if (!input || typeof input !== 'object') {
    return {
      webhookUrl: defaultsWebhook,
      testChatId: null,
      testMessage: DEFAULT_TELEGRAM_TEST_MESSAGE,
      updatedAt: null,
    }
  }

  const parsed = input as Partial<AdminTelegramIntegrationConfig>
  const rawTestChatId = safeString(parsed.testChatId)
  const safeTestChatId =
    rawTestChatId && !looksLikeTelegramBotToken(rawTestChatId) ? rawTestChatId : null

  return {
    webhookUrl: safeString(parsed.webhookUrl) ?? defaultsWebhook,
    testChatId: safeTestChatId,
    testMessage: safeString(parsed.testMessage) ?? DEFAULT_TELEGRAM_TEST_MESSAGE,
    updatedAt: safeString(parsed.updatedAt),
  }
}

export async function getAdminTelegramIntegrationConfig(
  env: Bindings
): Promise<AdminTelegramIntegrationConfig> {
  const raw = await env.MARTECH_KV.get(ADMIN_TELEGRAM_INTEGRATION_CONFIG_KEY)
  if (!raw) return normalizeTelegramIntegrationConfig(null, env)

  try {
    const parsed = JSON.parse(raw)
    return normalizeTelegramIntegrationConfig(parsed, env)
  } catch {
    return normalizeTelegramIntegrationConfig(null, env)
  }
}

export async function saveAdminTelegramIntegrationConfig(
  env: Bindings,
  config: AdminTelegramIntegrationConfig
): Promise<void> {
  await env.MARTECH_KV.put(ADMIN_TELEGRAM_INTEGRATION_CONFIG_KEY, JSON.stringify(config))
}

export function normalizeServiceAgentConfig(
  input: unknown,
  _env: Bindings
): AdminServiceAgentConfig {
  if (!input || typeof input !== 'object') {
    return {
      autoReplyEnabled: true,
      autoCreateAppointments: true,
      autoCreateQuotes: true,
      businessHoursEnabled: false,
      businessHoursStart: '09:00',
      businessHoursEnd: '18:00',
      timezone: 'America/Sao_Paulo',
      offHoursAutoReply: DEFAULT_SERVICE_AGENT_OFF_HOURS_REPLY,
      openingTemplate: DEFAULT_SERVICE_AGENT_OPENING_TEMPLATE,
      qualificationScript: DEFAULT_SERVICE_AGENT_QUALIFICATION_SCRIPT,
      aiModel: DEFAULT_AI_MODEL,
      maxReplyChars: 340,
      updatedAt: null,
    }
  }

  const parsed = input as Partial<AdminServiceAgentConfig>

  return {
    autoReplyEnabled: parseBoolean(parsed.autoReplyEnabled, true),
    autoCreateAppointments: parseBoolean(parsed.autoCreateAppointments, true),
    autoCreateQuotes: parseBoolean(parsed.autoCreateQuotes, true),
    businessHoursEnabled: parseBoolean(parsed.businessHoursEnabled, false),
    businessHoursStart: normalizeBusinessHour(parsed.businessHoursStart) ?? '09:00',
    businessHoursEnd: normalizeBusinessHour(parsed.businessHoursEnd) ?? '18:00',
    timezone: normalizeTimezone(parsed.timezone),
    offHoursAutoReply:
      safeString(parsed.offHoursAutoReply) ?? DEFAULT_SERVICE_AGENT_OFF_HOURS_REPLY,
    openingTemplate: safeString(parsed.openingTemplate) ?? DEFAULT_SERVICE_AGENT_OPENING_TEMPLATE,
    qualificationScript:
      safeString(parsed.qualificationScript) ?? DEFAULT_SERVICE_AGENT_QUALIFICATION_SCRIPT,
    aiModel: safeString(parsed.aiModel) ?? DEFAULT_AI_MODEL,
    maxReplyChars: clampNumber(parsed.maxReplyChars, 340, 160, 700),
    updatedAt: safeString(parsed.updatedAt),
  }
}

export async function getAdminServiceAgentConfig(
  env: Bindings
): Promise<AdminServiceAgentConfig> {
  const raw = await env.MARTECH_KV.get(ADMIN_SERVICE_AGENT_CONFIG_KEY)
  if (!raw) return normalizeServiceAgentConfig(null, env)

  try {
    const parsed = JSON.parse(raw)
    return normalizeServiceAgentConfig(parsed, env)
  } catch {
    return normalizeServiceAgentConfig(null, env)
  }
}

export async function saveAdminServiceAgentConfig(
  env: Bindings,
  config: AdminServiceAgentConfig
): Promise<void> {
  await env.MARTECH_KV.put(ADMIN_SERVICE_AGENT_CONFIG_KEY, JSON.stringify(config))
}
