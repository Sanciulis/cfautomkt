import process from 'node:process'

import express from 'express'
import pino from 'pino'

import { config } from './config.js'
import { WhatsAppClient } from './whatsapp-client.js'

function asNonEmptyString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildOutgoingMessage({
  baseMessage,
  referralUrl,
  unsubscribeUrl,
  appendReferral,
  appendUnsubscribe,
}) {
  const chunks = [baseMessage]

  if (appendReferral && referralUrl && !baseMessage.includes(referralUrl)) {
    chunks.push(`Indicacao: ${referralUrl}`)
  }

  if (appendUnsubscribe && unsubscribeUrl && !baseMessage.includes(unsubscribeUrl)) {
    chunks.push(`Descadastro: ${unsubscribeUrl}`)
  }

  return chunks.join('\n\n')
}

function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

function requireToken(expectedTokens) {
  const allowed = Array.isArray(expectedTokens) ? expectedTokens : [expectedTokens]
  return (req, res, next) => {
    const token = extractBearerToken(req.headers.authorization)
    if (!token || !allowed.includes(token)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    return next()
  }
}

const logger = pino({ level: config.logLevel })
const waClient = new WhatsAppClient({
  config,
  logger: logger.child({ service: 'whatsapp-client' }),
})

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '256kb' }))

const requireDispatchToken = requireToken([config.dispatchBearerToken])
const requireAdminToken = requireToken([config.gatewayAdminToken, config.dispatchBearerToken])

app.get('/health', (_req, res) => {
  const status = waClient.getStatus()
  return res.json({
    status: 'ok',
    service: 'whatsapp-baileys-gateway',
    connected: status.connected,
    connecting: status.connecting,
    startedAt: status.startedAt,
  })
})

app.get('/session/status', requireAdminToken, (_req, res) => {
  return res.json({
    status: 'success',
    session: waClient.getStatus(),
  })
})

app.get('/session/qr', requireAdminToken, (_req, res) => {
  const qr = waClient.getLatestQr()
  if (!qr.qr) {
    return res.status(404).json({
      error: 'QR is not currently available.',
      hint: 'Request status, then reconnect if needed.',
    })
  }

  return res.json({
    status: 'success',
    qr: qr.qr,
    generatedAt: qr.generatedAt,
  })
})

app.post('/session/pairing-code', requireAdminToken, async (req, res) => {
  try {
    const phone = asNonEmptyString(req.body?.phone)
    if (!phone) return res.status(400).json({ error: 'phone is required.' })

    const result = await waClient.requestPairingCode(phone)
    return res.json({
      status: 'success',
      pairingCode: result.code,
      phone: result.phone,
    })
  } catch (error) {
    logger.error({ error: String(error) }, 'Failed to generate pairing code')
    return res.status(500).json({
      error: 'Failed to generate pairing code.',
      details: String(error),
    })
  }
})

app.post('/session/reconnect', requireAdminToken, async (_req, res) => {
  await waClient.forceReconnect()
  return res.json({ status: 'success' })
})

app.get('/groups', requireAdminToken, async (_req, res) => {
  try {
    const groups = await waClient.getGroups()
    return res.json({ status: 'success', groups })
  } catch (error) {
    logger.error({ error: String(error) }, 'Failed to fetch groups')
    return res.status(500).json({ error: String(error) })
  }
})

app.get('/groups/:id/participants', requireAdminToken, async (req, res) => {
  try {
    const participants = await waClient.getGroupParticipants(req.params.id)
    return res.json({ status: 'success', participants })
  } catch (error) {
    logger.error({ error: String(error) }, 'Failed to fetch group participants')
    return res.status(500).json({ error: String(error) })
  }
})

app.post('/dispatch/whatsapp', requireDispatchToken, async (req, res) => {
  try {
    const channel = asNonEmptyString(req.body?.channel)?.toLowerCase()
    if (channel && channel !== 'whatsapp') {
      return res.status(400).json({ error: 'channel must be whatsapp when provided.' })
    }

    const phone = asNonEmptyString(req.body?.user?.phone)
    const message = asNonEmptyString(req.body?.message)
    if (!phone) return res.status(400).json({ error: 'user.phone is required.' })
    if (!message) return res.status(400).json({ error: 'message is required.' })

    const referralUrl = asNonEmptyString(req.body?.referralUrl)
    const unsubscribeUrl = asNonEmptyString(req.body?.unsubscribeUrl)

    const finalText = buildOutgoingMessage({
      baseMessage: message,
      referralUrl,
      unsubscribeUrl,
      appendReferral: config.messageFormatting.appendReferral,
      appendUnsubscribe: config.messageFormatting.appendUnsubscribe,
    })

    const result = await waClient.sendTextMessage({
      phone,
      message: finalText,
    })

    return res.json({
      status: 'success',
      provider: 'baileys',
      campaignId: req.body?.campaign?.id ?? null,
      userId: req.body?.user?.id ?? null,
      to: result.jid,
      messageId: result.messageId,
    })
  } catch (error) {
    const details = String(error)
    logger.error({ error: details }, 'WhatsApp dispatch failed')

    const notReady =
      details.includes('not connected') || details.includes('Authenticate and wait for status')
    const status = notReady ? 503 : 400

    return res.status(status).json({
      error: 'Dispatch failed',
      details,
    })
  }
})

app.use((err, _req, res, _next) => {
  logger.error({ error: String(err) }, 'Unhandled gateway error')
  return res.status(500).json({ error: 'Internal server error' })
})

async function start() {
  await waClient.start()
  const server = app.listen(config.port, config.host, () => {
    logger.info(
      {
        host: config.host,
        port: config.port,
      },
      'WhatsApp Baileys gateway running'
    )
  })

  const shutdown = async () => {
    logger.info('Graceful shutdown started')
    server.close()
    await waClient.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch((error) => {
  logger.error({ error: String(error) }, 'Failed to start gateway')
  process.exit(1)
})
