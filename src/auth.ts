import type { Bindings, AdminLoginThrottleState } from './types'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  ADMIN_LOGIN_WINDOW_SECONDS,
  ADMIN_LOGIN_MAX_FAILURES,
  ADMIN_LOGIN_BLOCK_SECONDS,
} from './constants'
import { safeString, toNumber, constantTimeEqual } from './utils'

export function extractApiKeyFromRequest(request: Request): string | null {
  const direct = request.headers.get('x-api-key')
  if (direct && direct.trim().length > 0) return direct.trim()

  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  const token = match[1]?.trim()
  return token && token.length > 0 ? token : null
}

export function ensureAdminAccess(c: {
  env: Bindings
  req: { raw: Request }
  json: (obj: unknown, status?: number) => Response
}): Response | null {
  const configuredKey = safeString(c.env.ADMIN_API_KEY)
  if (!configuredKey) return null

  const providedKey = extractApiKeyFromRequest(c.req.raw)
  if (!providedKey || providedKey !== configuredKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return null
}

export function parseCookies(rawCookie: string | null): Record<string, string> {
  if (!rawCookie) return {}
  const entries = rawCookie
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const separatorIndex = chunk.indexOf('=')
      if (separatorIndex < 0) return null
      const key = chunk.slice(0, separatorIndex).trim()
      const value = chunk.slice(separatorIndex + 1).trim()
      return [key, value] as const
    })
    .filter((item): item is readonly [string, string] => item !== null)
  return Object.fromEntries(entries)
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function getAdminPanelPassword(env: Bindings): string | null {
  return safeString(env.ADMIN_PANEL_PASSWORD) ?? safeString(env.ADMIN_API_KEY)
}

export function getAdminSessionSecret(env: Bindings): string | null {
  return safeString(env.ADMIN_SESSION_SECRET) ?? safeString(env.ADMIN_API_KEY)
}

export async function createAdminSessionToken(secret: string): Promise<string> {
  const timestamp = `${Date.now()}`
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const payload = `${timestamp}.${nonce}`
  const signature = await hmacSha256Hex(secret, payload)
  return `${payload}.${signature}`
}

export async function validateAdminSessionToken(secret: string, token: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [timestamp, nonce, signature] = parts
  if (!timestamp || !nonce || !signature) return false

  const issuedAt = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(issuedAt)) return false

  const now = Date.now()
  if (issuedAt > now) return false
  if (now - issuedAt > ADMIN_SESSION_TTL_SECONDS * 1000) return false

  const expected = await hmacSha256Hex(secret, `${timestamp}.${nonce}`)
  return constantTimeEqual(signature, expected)
}

export function setAdminSessionCookie(
  c: { header: (name: string, value: string) => void },
  token: string
): void {
  c.header(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}`
  )
}

export function clearAdminSessionCookie(c: { header: (name: string, value: string) => void }): void {
  c.header(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
  )
}

export async function hasValidAdminSession(c: { env: Bindings; req: { raw: Request } }): Promise<boolean> {
  const secret = getAdminSessionSecret(c.env)
  if (!secret) return false
  const cookies = parseCookies(c.req.raw.headers.get('Cookie'))
  const token = safeString(cookies[ADMIN_SESSION_COOKIE])
  if (!token) return false
  return validateAdminSessionToken(secret, token)
}

export async function ensureAdminSession(c: {
  env: Bindings
  req: { raw: Request }
  json: (obj: unknown, status?: number) => Response
}): Promise<Response | null> {
  const valid = await hasValidAdminSession(c)
  if (!valid) return c.json({ error: 'Unauthorized' }, 401)
  return null
}

export function getRequesterIp(request: Request): string {
  const cfIp = safeString(request.headers.get('CF-Connecting-IP'))
  if (cfIp) return cfIp
  const forwarded = safeString(request.headers.get('X-Forwarded-For'))
  if (!forwarded) return 'unknown'
  const first = forwarded
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  return first ?? 'unknown'
}

function getAdminLoginThrottleKey(ip: string): string {
  return `admin_login_throttle:${ip}`
}

async function readAdminLoginThrottleState(
  kv: KVNamespace,
  ip: string
): Promise<AdminLoginThrottleState | null> {
  const raw = await kv.get(getAdminLoginThrottleKey(ip))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AdminLoginThrottleState>
    const failures = toNumber(parsed.failures)
    const windowStartedAt = toNumber(parsed.windowStartedAt)
    const blockedUntil = toNumber(parsed.blockedUntil)
    if (!Number.isFinite(failures) || !Number.isFinite(windowStartedAt) || !Number.isFinite(blockedUntil)) {
      return null
    }
    return {
      failures: Math.max(0, Math.floor(failures)),
      windowStartedAt: Math.max(0, Math.floor(windowStartedAt)),
      blockedUntil: Math.max(0, Math.floor(blockedUntil)),
    }
  } catch {
    return null
  }
}

function buildAdminLoginThrottleTtlSeconds(state: AdminLoginThrottleState, now: number): number {
  const windowTtl = ADMIN_LOGIN_WINDOW_SECONDS + 60
  if (state.blockedUntil <= now) return windowTtl
  const blockedFor = Math.ceil((state.blockedUntil - now) / 1000)
  return Math.max(windowTtl, blockedFor + 60)
}

export async function checkAdminLoginThrottle(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const now = Date.now()
  const state = await readAdminLoginThrottleState(kv, ip)
  if (!state) return { allowed: true }

  if (state.blockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000))
    return { allowed: false, retryAfterSeconds }
  }

  if (now - state.windowStartedAt > ADMIN_LOGIN_WINDOW_SECONDS * 1000) {
    await kv.delete(getAdminLoginThrottleKey(ip))
  }

  return { allowed: true }
}

export async function recordAdminLoginFailure(kv: KVNamespace, ip: string): Promise<void> {
  const now = Date.now()
  const existing = await readAdminLoginThrottleState(kv, ip)
  const withinWindow =
    existing !== null && now - existing.windowStartedAt <= ADMIN_LOGIN_WINDOW_SECONDS * 1000

  const state: AdminLoginThrottleState = withinWindow
    ? {
        failures: existing.failures + 1,
        windowStartedAt: existing.windowStartedAt,
        blockedUntil: existing.blockedUntil,
      }
    : {
        failures: 1,
        windowStartedAt: now,
        blockedUntil: 0,
      }

  if (state.failures >= ADMIN_LOGIN_MAX_FAILURES) {
    state.blockedUntil = now + ADMIN_LOGIN_BLOCK_SECONDS * 1000
    state.failures = 0
    state.windowStartedAt = now
  }

  await kv.put(getAdminLoginThrottleKey(ip), JSON.stringify(state), {
    expirationTtl: buildAdminLoginThrottleTtlSeconds(state, now),
  })
}

export async function clearAdminLoginThrottle(kv: KVNamespace, ip: string): Promise<void> {
  await kv.delete(getAdminLoginThrottleKey(ip))
}
