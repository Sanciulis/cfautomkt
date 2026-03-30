import type { Bindings, AdminWhatsAppIntegrationConfig } from './types'
import { ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY, DEFAULT_WHATSAPP_TEST_MESSAGE } from './constants'
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
    }
  }

  const parsed = input as Partial<AdminWhatsAppIntegrationConfig>
  return {
    webhookUrl: safeString(parsed.webhookUrl) ?? defaultsWebhook,
    testPhone: safeString(parsed.testPhone),
    testMessage: safeString(parsed.testMessage) ?? DEFAULT_WHATSAPP_TEST_MESSAGE,
    updatedAt: safeString(parsed.updatedAt),
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
