import type { 
  Bindings, 
  AdminWhatsAppIntegrationConfig, 
  AdminEmailIntegrationConfig, 
  AdminTelegramIntegrationConfig 
} from './types'
import { 
  ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY, 
  ADMIN_EMAIL_INTEGRATION_CONFIG_KEY, 
  ADMIN_TELEGRAM_INTEGRATION_CONFIG_KEY, 
  DEFAULT_WHATSAPP_TEST_MESSAGE,
  DEFAULT_EMAIL_TEST_MESSAGE,
  DEFAULT_TELEGRAM_TEST_MESSAGE
} from './constants'
import { safeString } from './utils'

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
  return {
    webhookUrl: safeString(parsed.webhookUrl) ?? defaultsWebhook,
    testChatId: safeString(parsed.testChatId),
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
