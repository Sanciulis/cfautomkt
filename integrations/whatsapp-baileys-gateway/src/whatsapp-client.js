import { mkdir } from 'node:fs/promises'

import { isBoom } from '@hapi/boom'
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from 'baileys'

function normalizePhoneDigits(rawPhone) {
  if (typeof rawPhone !== 'string') {
    throw new Error('Phone must be a string.')
  }

  const maybeJid = rawPhone.trim().toLowerCase()
  if (maybeJid.endsWith('@s.whatsapp.net')) {
    return maybeJid.replace(/[^0-9]/g, '')
  }

  const digits = rawPhone.replace(/[^0-9]/g, '')
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Phone must have between 10 and 15 digits including country code.')
  }
  return digits
}

function normalizeDestinationJid(rawPhoneOrJid) {
  if (typeof rawPhoneOrJid !== 'string') {
    throw new Error('Phone must be a string.')
  }

  const normalized = rawPhoneOrJid.trim().toLowerCase()
  if (!normalized) {
    throw new Error('Phone must be a non-empty string.')
  }

  const atIndex = normalized.indexOf('@')
  if (atIndex > 0) {
    const localPart = normalized.slice(0, atIndex).trim()
    const domainPart = normalized.slice(atIndex + 1).trim()
    if (!localPart || !domainPart) {
      throw new Error('Destination JID is invalid.')
    }

    if (domainPart === 's.whatsapp.net' || domainPart === 'c.us') {
      const userPart = localPart.split(':')[0]
      const digits = userPart.replace(/[^0-9]/g, '')
      if (digits.length >= 10 && digits.length <= 15) {
        return `${digits}@s.whatsapp.net`
      }
      return `${localPart}@${domainPart}`
    }

    if (domainPart === 'lid') {
      return `${localPart}@${domainPart}`
    }

    throw new Error('Unsupported WhatsApp destination domain.')
  }

  const digits = normalized.replace(/[^0-9]/g, '')
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Phone must have between 10 and 15 digits including country code.')
  }
  return `${digits}@s.whatsapp.net`
}

export function normalizePhoneToJid(rawPhone) {
  return normalizeDestinationJid(rawPhone)
}

export function normalizePhoneForPairing(rawPhone) {
  return normalizePhoneDigits(rawPhone)
}

function extractDisconnectStatusCode(lastDisconnectError) {
  if (!lastDisconnectError) return null
  if (isBoom(lastDisconnectError) && lastDisconnectError.output?.statusCode) {
    return lastDisconnectError.output.statusCode
  }

  const maybeOutput = lastDisconnectError?.output
  if (maybeOutput && Number.isFinite(maybeOutput.statusCode)) {
    return maybeOutput.statusCode
  }

  const maybeStatusCode = Number(lastDisconnectError?.statusCode)
  return Number.isFinite(maybeStatusCode) ? maybeStatusCode : null
}

function asText(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const TEXT_HINT_KEYS = new Set([
  'conversation',
  'text',
  'caption',
  'title',
  'description',
  'selectedDisplayText',
  'selectedButtonId',
  'selectedId',
  'selectedRowId',
  'contentText',
  'hydratedContentText',
  'body',
])

function findHintedText(node, depth = 0, visited = new Set()) {
  if (!node || typeof node !== 'object') return null
  if (depth > 8) return null
  if (visited.has(node)) return null
  visited.add(node)

  for (const [key, value] of Object.entries(node)) {
    if (TEXT_HINT_KEYS.has(key)) {
      const direct = asText(value)
      if (direct) return direct

      if (value && typeof value === 'object') {
        const nested = findHintedText(value, depth + 1, visited)
        if (nested) return nested
      }
    }
  }

  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue
    const nested = findHintedText(value, depth + 1, visited)
    if (nested) return nested
  }

  return null
}

function unwrapMessageContent(message) {
  let cursor = message
  for (let depth = 0; depth < 8; depth += 1) {
    if (!cursor || typeof cursor !== 'object') break

    const nested =
      cursor.ephemeralMessage?.message ??
      cursor.deviceSentMessage?.message ??
      cursor.viewOnceMessage?.message ??
      cursor.viewOnceMessageV2?.message ??
      cursor.viewOnceMessageV2Extension?.message ??
      cursor.protocolMessage?.editedMessage?.message ??
      cursor.documentWithCaptionMessage?.message ??
      cursor.editedMessage?.message ??
      cursor.keepInChatMessage?.message

    if (!nested || nested === cursor) {
      break
    }

    cursor = nested
  }

  return cursor
}

function extractInteractiveText(interactiveResponseMessage) {
  if (!interactiveResponseMessage || typeof interactiveResponseMessage !== 'object') return null

  const direct =
    asText(interactiveResponseMessage.body?.text) ??
    asText(interactiveResponseMessage.selectedDisplayText) ??
    asText(interactiveResponseMessage.selectedId)
  if (direct) return direct

  const paramsJson = asText(interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson)
  if (!paramsJson) return null

  try {
    const parsed = JSON.parse(paramsJson)
    return (
      asText(parsed?.selected_display_text) ??
      asText(parsed?.selectedDisplayText) ??
      asText(parsed?.id) ??
      asText(parsed?.title)
    )
  } catch {
    return paramsJson
  }
}

function extractMessageText(payload) {
  if (!payload || typeof payload !== 'object') return null

  const message = unwrapMessageContent(payload.message)
  if (!message || typeof message !== 'object') return null

  const candidates = [
    message.conversation,
    message.extendedTextMessage?.text,
    message.imageMessage?.caption,
    message.videoMessage?.caption,
    message.documentMessage?.caption,
    message.buttonsResponseMessage?.selectedDisplayText,
    message.buttonsResponseMessage?.selectedButtonId,
    message.templateButtonReplyMessage?.selectedDisplayText,
    message.templateButtonReplyMessage?.selectedId,
    message.listResponseMessage?.title,
    message.listResponseMessage?.singleSelectReply?.selectedRowId,
    extractInteractiveText(message.interactiveResponseMessage),
  ]

  for (const candidate of candidates) {
    const text = asText(candidate)
    if (text) return text
  }

  const recursiveFallback = findHintedText(message)
  if (recursiveFallback) return recursiveFallback

  return null
}

export class WhatsAppClient {
  constructor({ config, logger, onInboundMessage }) {
    this.config = config
    this.logger = logger
    this.onInboundMessage = typeof onInboundMessage === 'function' ? onInboundMessage : null

    this.socket = null
    this.connecting = false
    this.connected = false
    this.reconnectTimer = null
    this.reconnectAttempts = 0
    this.lastDisconnectCode = null
    this.lastDisconnectAt = null
    this.lastError = null
    this.latestQr = null
    this.latestQrAt = null
    this.startedAt = new Date().toISOString()
  }

  async start() {
    await mkdir(this.config.baileys.sessionDir, { recursive: true })
    await this.connect()
  }

  async connect() {
    if (this.connecting) return

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.connecting = true
    this.lastError = null

    const { state, saveCreds } = await useMultiFileAuthState(this.config.baileys.sessionDir)
    const { version, isLatest } = await fetchLatestBaileysVersion()

    this.logger.info(
      {
        version,
        isLatest,
        sessionDir: this.config.baileys.sessionDir,
      },
      'Starting Baileys socket'
    )

    const socketLogger = this.logger.child({ component: 'baileys-socket' })

    const socket = makeWASocket({
      auth: state,
      browser: Browsers.windows('MartechGateway'),
      version,
      printQRInTerminal: this.config.baileys.printQrInTerminal,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      logger: socketLogger,
    })

    this.socket = socket

    socket.ev.on('creds.update', saveCreds)
    socket.ev.on('connection.update', (update) => {
      this.handleConnectionUpdate(update)
    })
    socket.ev.on('messages.upsert', (event) => {
      void this.handleMessagesUpsert(event)
    })
    socket.ev.on('messaging-history.set', (event) => {
      const messages = Array.isArray(event?.messages) ? event.messages : []
      if (!messages.length) return

      this.logger.info(
        {
          messages: messages.length,
          isLatest: Boolean(event?.isLatest),
        },
        'Received WhatsApp messaging-history.set event'
      )

      void this.handleMessagesUpsert({
        type: 'messaging-history.set',
        messages,
      })
    })
  }

  async handleMessagesUpsert(event) {
    if (!this.onInboundMessage || !event) {
      return
    }

    const messages = Array.isArray(event.messages)
      ? event.messages
      : event?.messages && typeof event.messages === 'object'
        ? [event.messages]
        : []

    if (!messages.length) return

    this.logger.info(
      {
        eventType: event?.type ?? null,
        messages: messages.length,
      },
      'Received WhatsApp messages.upsert event'
    )

    for (const entry of messages) {
      if (entry?.key?.fromMe) continue

      const remoteJid = entry?.key?.remoteJid
      if (
        typeof remoteJid !== 'string' ||
        remoteJid.endsWith('@g.us') ||
        remoteJid.endsWith('@broadcast') ||
        remoteJid === 'status@broadcast'
      ) {
        continue
      }

      const messageText = extractMessageText(entry)
      if (!messageText) {
        this.logger.info(
          {
            sourceContact: remoteJid,
            messageId: entry?.key?.id ?? null,
            messageKeys:
              entry?.message && typeof entry.message === 'object'
                ? Object.keys(entry.message).slice(0, 12)
                : [],
          },
          'Skipping inbound message because text could not be extracted'
        )
        continue
      }

      this.logger.info(
        {
          sourceContact: remoteJid,
          messageId: entry?.key?.id ?? null,
          preview: messageText.slice(0, 120),
        },
        'Captured inbound WhatsApp message'
      )

      try {
        await this.onInboundMessage({
          sourceContact: remoteJid,
          message: messageText,
          messageId: entry?.key?.id ?? null,
          timestamp: entry?.messageTimestamp ? String(entry.messageTimestamp) : null,
          pushName: typeof entry?.pushName === 'string' ? entry.pushName : null,
        })
      } catch (error) {
        this.logger.error(
          {
            error: String(error),
            sourceContact: remoteJid,
          },
          'Failed to process inbound message callback'
        )
      }
    }
  }

  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      this.latestQr = qr
      this.latestQrAt = new Date().toISOString()
      this.logger.info('WhatsApp QR code generated')
    }

    if (connection === 'connecting') {
      this.connecting = true
      this.connected = false
      return
    }

    if (connection === 'open') {
      this.connecting = false
      this.connected = true
      this.reconnectAttempts = 0
      this.lastDisconnectCode = null
      this.lastDisconnectAt = null
      this.lastError = null
      this.latestQr = null
      this.latestQrAt = null
      this.logger.info({ user: this.socket?.user ?? null }, 'WhatsApp connection opened')
      return
    }

    if (connection !== 'close') return

    this.connecting = false
    this.connected = false
    this.lastDisconnectAt = new Date().toISOString()
    this.lastDisconnectCode = extractDisconnectStatusCode(lastDisconnect?.error)
    this.lastError = String(lastDisconnect?.error ?? 'Connection closed')

    const shouldReconnect = this.lastDisconnectCode !== DisconnectReason.loggedOut

    this.logger.warn(
      {
        disconnectCode: this.lastDisconnectCode,
        shouldReconnect,
      },
      'WhatsApp connection closed'
    )

    if (!shouldReconnect) {
      this.logger.error(
        'Session is logged out. Remove session files and authenticate again to reconnect.'
      )
      return
    }

    this.scheduleReconnect()
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return

    this.reconnectAttempts += 1
    const delay = this.config.baileys.reconnectDelayMs

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.connect()
      } catch (error) {
        this.lastError = String(error)
        this.logger.error({ error: this.lastError }, 'Reconnect attempt failed')
        this.scheduleReconnect()
      }
    }, delay)

    this.logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Scheduled WhatsApp reconnect'
    )
  }

  getStatus() {
    return {
      connected: this.connected,
      connecting: this.connecting,
      reconnectAttempts: this.reconnectAttempts,
      lastDisconnectCode: this.lastDisconnectCode,
      lastDisconnectAt: this.lastDisconnectAt,
      lastError: this.lastError,
      latestQrAt: this.latestQrAt,
      startedAt: this.startedAt,
      me: this.socket?.user ?? null,
      sessionDir: this.config.baileys.sessionDir,
    }
  }

  getLatestQr() {
    return {
      qr: this.latestQr,
      generatedAt: this.latestQrAt,
    }
  }

  async requestPairingCode(rawPhone) {
    if (!this.socket) {
      throw new Error('WhatsApp socket is not initialized.')
    }

    const phone = normalizePhoneForPairing(rawPhone)
    const code = await this.socket.requestPairingCode(phone)
    return { phone, code }
  }

  async forceReconnect() {
    if (this.socket) {
      try {
        this.socket.end(new Error('Manual reconnect requested'))
      } catch {
        // noop
      }
    }

    this.connected = false
    this.connecting = false
    this.scheduleReconnect()
  }

  assertReady() {
    if (!this.socket || !this.connected) {
      throw new Error('WhatsApp is not connected yet. Authenticate and wait for status=connected.')
    }
  }

  async sendTextMessage({ phone, message }) {
    this.assertReady()

    const jid = normalizePhoneToJid(phone)
    const response = await this.socket.sendMessage(jid, { text: message })

    return {
      jid,
      messageId: response?.key?.id ?? null,
      status: response?.status ?? null,
    }
  }

  async getGroups() {
    this.assertReady()
    const groups = await this.socket.groupFetchAllParticipating()
    return Object.values(groups).map((g) => ({
      id: g.id,
      name: g.subject,
      count: g.participants.length,
    }))
  }

  async getGroupParticipants(groupId) {
    this.assertReady()
    const metadata = await this.socket.groupMetadata(groupId)
    return metadata.participants.map((p) => ({
      id: p.id,
      admin: p.admin || null,
    }))
  }

  async stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.socket) {
      try {
        this.socket.end(new Error('Gateway shutdown'))
      } catch {
        // noop
      }
    }
  }
}
