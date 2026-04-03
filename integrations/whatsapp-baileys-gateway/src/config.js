import 'dotenv/config'

import path from 'node:path'
import process from 'node:process'

function normalizeString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseBoolean(value, fallback) {
  const normalized = normalizeString(value)
  if (!normalized) return fallback
  if (normalized.toLowerCase() === 'true') return true
  if (normalized.toLowerCase() === 'false') return false
  return fallback
}

function parseInteger(value, fallback) {
  const normalized = normalizeString(value)
  if (!normalized) return fallback
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const dispatchBearerToken = normalizeString(process.env.DISPATCH_BEARER_TOKEN)
if (!dispatchBearerToken) {
  throw new Error('DISPATCH_BEARER_TOKEN is required.')
}

const gatewayAdminToken = normalizeString(process.env.GATEWAY_ADMIN_TOKEN) ?? dispatchBearerToken
const inboundWebhookUrl = normalizeString(process.env.INBOUND_WEBHOOK_URL)
const inboundWebhookToken =
  normalizeString(process.env.INBOUND_WEBHOOK_TOKEN) ?? dispatchBearerToken

export const config = {
  host: normalizeString(process.env.HOST) ?? '0.0.0.0',
  port: parseInteger(process.env.PORT, 8788),
  logLevel: normalizeString(process.env.LOG_LEVEL) ?? 'info',
  dispatchBearerToken,
  gatewayAdminToken,
  inboundWebhook: {
    url: inboundWebhookUrl,
    token: inboundWebhookToken,
  },
  baileys: {
    sessionDir: path.resolve(
      process.cwd(),
      normalizeString(process.env.BAILEYS_SESSION_DIR) ?? './session'
    ),
    printQrInTerminal: parseBoolean(process.env.BAILEYS_PRINT_QR, true),
    reconnectDelayMs: parseInteger(process.env.BAILEYS_RECONNECT_DELAY_MS, 5000),
  },
  messageFormatting: {
    appendReferral: parseBoolean(process.env.WHATSAPP_APPEND_REFERRAL, true),
    appendUnsubscribe: parseBoolean(process.env.WHATSAPP_APPEND_UNSUBSCRIBE, true),
  },
}
