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

export function normalizePhoneToJid(rawPhone) {
  const digits = normalizePhoneDigits(rawPhone)
  return `${digits}@s.whatsapp.net`
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

export class WhatsAppClient {
  constructor({ config, logger }) {
    this.config = config
    this.logger = logger

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
