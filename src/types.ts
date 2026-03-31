export type InteractionEvent =
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'shared'
  | 'converted'
  | 'referral_click'
  | 'personalized'
  | 'send_failed'

export type AIResponse = {
  response?: unknown
  result?: unknown
}

export type Bindings = {
  DB: D1Database
  MARTECH_KV: KVNamespace
  AI: {
    run: (model: string, input: unknown) => Promise<AIResponse>
  }
  LANDING_PAGE_URL?: string
  APP_ENV?: string
  DISPATCH_WEBHOOK_URL?: string
  PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST?: string
  WHATSAPP_WEBHOOK_URL?: string
  EMAIL_WEBHOOK_URL?: string
  TELEGRAM_WEBHOOK_URL?: string
  DISPATCH_BEARER_TOKEN?: string
  ADMIN_API_KEY?: string
  ADMIN_PANEL_PASSWORD?: string
  ADMIN_SESSION_SECRET?: string
  RESEND_API_KEY?: string
  RESEND_DEFAULT_FROM?: string
  TELEGRAM_BOT_TOKEN?: string
}

export type UserRecord = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  preferred_channel: string
  psychological_profile: string
  engagement_score: number
  referral_code: string | null
  referred_by: string | null
  viral_points: number
  marketing_opt_in?: number | null
  opt_out_at?: string | null
  consent_source?: string | null
  consent_updated_at?: string | null
  last_active: string
  created_at: string
}

export type CampaignRecord = {
  id: string
  name: string
  base_copy: string
  incentive_offer: string | null
  channel: string
  status: 'active' | 'paused'
}

export type InteractionPayload = {
  userId: string
  eventType: InteractionEvent
  campaignId?: string | null
  channel?: string
  metadata?: unknown
}

export type DispatchRequestBody = {
  userIds?: string[]
  limit?: number
  personalize?: boolean
  dryRun?: boolean
  channel?: string
  webhookUrlOverride?: string
  metadata?: unknown
  includeInactive?: boolean
  force?: boolean
}

export type CampaignCreateInput = {
  id?: string | null
  name: string
  baseCopy: string
  incentiveOffer?: string | null
  channel?: string | null
}

export type DispatchResult = {
  status: 'success'
  campaignId: string
  channel: string
  dryRun: boolean
  requested: number
  sent: number
  failed: number
  skipped: number
  failures: Array<{ userId: string; reason: string; status?: number }>
}

export type DispatchErrorStatus = 400 | 404 | 409 | 500

export type AdminLoginThrottleState = {
  failures: number
  windowStartedAt: number
  blockedUntil: number
}

export type AdminWhatsAppIntegrationConfig = {
  webhookUrl: string | null
  testPhone: string | null
  testMessage: string | null
  updatedAt: string | null
  gatewayToken: string | null
}

export type AdminEmailIntegrationConfig = {
  webhookUrl: string | null
  testEmail: string | null
  testSubject: string | null
  testMessage: string | null
  updatedAt: string | null
}

export type AdminTelegramIntegrationConfig = {
  webhookUrl: string | null
  testChatId: string | null
  testMessage: string | null
  updatedAt: string | null
}
