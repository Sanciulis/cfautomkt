import type { InteractionEvent, AIResponse, Bindings } from './types'
import { DEFAULT_PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST } from './constants'

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function isInteractionEvent(value: unknown): value is InteractionEvent {
  return (
    value === 'sent' ||
    value === 'opened' ||
    value === 'clicked' ||
    value === 'shared' ||
    value === 'converted' ||
    value === 'referral_click' ||
    value === 'personalized' ||
    value === 'send_failed'
  )
}

export function buildReferralCode(userId: string): string {
  const compact = userId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8)
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  return `${compact || 'user'}${suffix}`
}

export function buildReferralRedirect(baseUrl: string, referralCode: string): string {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('ref', referralCode)
    return url.toString()
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}ref=${encodeURIComponent(referralCode)}`
  }
}

export async function hashValue(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function extractAIText(aiResponse: AIResponse): string {
  if (typeof aiResponse.response === 'string') return aiResponse.response
  if (typeof aiResponse.result === 'string') return aiResponse.result
  return ''
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

// Bypasses Cloudflare Worker to Proxied Domain DNS resolution issues (error 1016)
export function applyWorkerSubrequestBypass(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.host === 'wainews.com.br' || parsed.host === 'preview-api.fluxoia.com') {
      return `http://168.231.94.189${parsed.pathname}${parsed.search}`
    }
    return url
  } catch {
    return url
  }
}

export async function resolveDispatchUrl(channel: string, env: Bindings): Promise<string | null> {
  const normalizedChannel = channel.toLowerCase()
  let resultUrl: string | null = null
  
  if (normalizedChannel === 'whatsapp') {
    const raw = await env.MARTECH_KV.get('admin_config:integration:whatsapp')
    if (raw) {
       try {
         const parsed = JSON.parse(raw)
         if (parsed.webhookUrl) resultUrl = parsed.webhookUrl
       } catch {}
    }
    if (!resultUrl) resultUrl = env.WHATSAPP_WEBHOOK_URL ?? env.DISPATCH_WEBHOOK_URL ?? null
  }
  
  else if (normalizedChannel === 'email') {
    const raw = await env.MARTECH_KV.get('admin_config:integration:email')
    if (raw) {
       try {
         const parsed = JSON.parse(raw)
         if (parsed.webhookUrl) resultUrl = parsed.webhookUrl
       } catch {}
    }
    if (!resultUrl) resultUrl = env.EMAIL_WEBHOOK_URL ?? env.DISPATCH_WEBHOOK_URL ?? null
  }
  
  else if (normalizedChannel === 'telegram') {
    const raw = await env.MARTECH_KV.get('admin_config:integration:telegram')
    if (raw) {
       try {
         const parsed = JSON.parse(raw)
         if (parsed.webhookUrl) resultUrl = parsed.webhookUrl
       } catch {}
    }
    if (!resultUrl) resultUrl = env.TELEGRAM_WEBHOOK_URL ?? env.DISPATCH_WEBHOOK_URL ?? null
  }
  
  if (!resultUrl) resultUrl = env.DISPATCH_WEBHOOK_URL ?? null
  return applyWorkerSubrequestBypass(resultUrl)
}

export function getPreviewWebhookOverrideAllowlist(env: Bindings): string[] {
  const raw = safeString(env.PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST)
  if (!raw) return DEFAULT_PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

export function isHostAllowed(hostname: string, allowlist: string[]): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  return allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      const baseDomain = entry.slice(2)
      if (!baseDomain) return false
      return normalized === baseDomain || normalized.endsWith(`.${baseDomain}`)
    }
    return normalized === entry
  })
}

export function validatePreviewWebhookOverrideUrl(
  overrideUrl: string,
  env: Bindings
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(overrideUrl)
  } catch {
    return { ok: false, error: 'webhookUrlOverride must be a valid URL' }
  }

  if (parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'webhookUrlOverride must use https://' }
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: 'webhookUrlOverride cannot contain URL credentials' }
  }

  const allowlist = getPreviewWebhookOverrideAllowlist(env)
  if (!isHostAllowed(parsedUrl.hostname, allowlist)) {
    return {
      ok: false,
      error:
        'webhookUrlOverride host is not allowlisted for preview. Configure PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST.',
    }
  }

  return { ok: true, normalizedUrl: parsedUrl.toString() }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export function resolveConsentSource(rawSource: unknown, fallback: string): string {
  return safeString(rawSource) ?? fallback
}

export function buildAdminRedirect(notice: string, kind: 'success' | 'error' = 'success'): string {
  return `/admin?notice=${encodeURIComponent(notice)}&kind=${encodeURIComponent(kind)}`
}
