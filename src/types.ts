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

export type AIInferenceFlowMetrics = {
  flow: string
  total: number
  success: number
  error: number
  errorRate: number
  fallback: number
  fallbackRate: number
  latencyAvgMs: number
  latencyP50Ms: number
  latencyP95Ms: number
  lastSeenAt: string | null
}

export type AIInferenceOverview = {
  rangeHours: number
  generatedAt: string
  totals: {
    total: number
    success: number
    error: number
    errorRate: number
    fallback: number
    fallbackRate: number
    latencyAvgMs: number
    latencyP50Ms: number
    latencyP95Ms: number
  }
  flows: AIInferenceFlowMetrics[]
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
  AI_ALERT_WEBHOOK_URL?: string
  AI_ALERT_WEBHOOK_TOKEN?: string
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

export type JourneyPhase = 'discovery' | 'interest' | 'desire' | 'action' | 'retained'

export const JOURNEY_PHASES: JourneyPhase[] = ['discovery', 'interest', 'desire', 'action', 'retained']

export type PersonaRecord = {
  id: string
  name: string
  base_tone: string
  system_prompt: string
  interaction_constraints: string | null
  created_at?: string
}

export type ProductRecord = {
  id: string
  name: string
  description: string
  pricing_details: string | null
  conversion_url: string | null
  metadata: string | null
  created_at?: string
}

export type AILearningLoopRecord = {
  id: string
  journey_id: string
  phase_transitions: string | null
  conversion_rate: number | null
  ai_insight: string | null
  status: 'pending_review' | 'applied' | 'rejected'
  created_at?: string
}

export type SegmentCriteria = {
  field: string // e.g., 'engagement_score', 'preferred_channel'
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in'
  value: string | number | boolean | string[]
}

export type SegmentRecord = {
  id: string
  name: string
  description: string | null
  criteria: SegmentCriteria[]
  created_at: string
  updated_at: string
}

export type UserSegmentRecord = {
  user_id: string
  segment_id: string
  added_at: string
}

export type FreezingRuleType = 'user_freeze' | 'campaign_freeze' | 'segment_freeze'

export type FreezingRule = {
  id: string
  type: FreezingRuleType
  name: string
  description: string | null
  conditions: FreezingCondition[]
  actions: FreezingAction[]
  enabled: boolean
  priority: number
  created_at: string
  updated_at: string
}

export type FreezingCondition = {
  field: string
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'not_contains'
  value: string | number | boolean
  timeframe?: string // e.g., '7 days', '30 days'
}

export type FreezingAction = {
  type: 'update_field' | 'log_decision' | 'send_notification'
  target_field?: string
  target_value?: any
  message?: string
  notification_channel?: string
}

export type JourneyRecord = {
  id: string
  name: string
  persona_id: string
  product_id: string
  status: 'active' | 'paused'
  created_at?: string
  
  // Campos virtuais populados pelos JOINs em tempo de consulta
  persona_name?: string
  system_prompt?: string
  product_name?: string
  objective?: string
}

export type JourneyEnrollment = {
  user_id: string
  journey_id: string
  current_phase: JourneyPhase
  last_interaction_at?: string
  conversation_history?: string | null
  metadata?: string | null
}

export type JourneyConversationMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp?: string
}

export type NewsletterConversationStatus = 'active' | 'converted' | 'opt_out' | 'closed'

export type NewsletterSentimentLabel = 'positive' | 'neutral' | 'negative'

export type NewsletterConversationDirection = 'inbound' | 'agent' | 'system'

export type NewsletterConversationSessionRecord = {
  id: string
  user_id: string | null
  source_channel: string
  source_contact: string
  status: NewsletterConversationStatus
  sentiment_score: number | null
  sentiment_label: NewsletterSentimentLabel | null
  feedback_rating: number | null
  feedback_text: string | null
  converted_at: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export type NewsletterConversationMessageRecord = {
  id: number
  session_id: string
  direction: NewsletterConversationDirection
  message_text: string
  sentiment_score: number | null
  sentiment_label: NewsletterSentimentLabel | null
  ai_model: string | null
  metadata: string | null
  created_at: string
}

export type NewsletterAgentRecentSession = {
  id: string
  userId: string | null
  userName: string | null
  sourceContact: string
  status: NewsletterConversationStatus
  sentimentScore: number | null
  sentimentLabel: NewsletterSentimentLabel | null
  feedbackRating: number | null
  lastMessageAt: string | null
  messageCount: number
}

export type NewsletterAgentOverview = {
  generatedAt: string
  totals: {
    totalSessions: number
    activeSessions: number
    convertedSessions: number
    optOutSessions: number
    averageSentiment: number
    averageFeedback: number
  }
  sentimentBuckets: {
    positive: number
    neutral: number
    negative: number
  }
  recentSessions: NewsletterAgentRecentSession[]
}

export type ServiceConversationStatus =
  | 'active'
  | 'qualified'
  | 'scheduled'
  | 'quoted'
  | 'opt_out'
  | 'closed'

export type ServiceAgentIntent = 'appointment' | 'quote' | 'question' | 'opt_out' | 'other'

export type ServiceConversationDirection = 'inbound' | 'agent' | 'system'

export type ServiceConversationSessionRecord = {
  id: string
  user_id: string | null
  source_channel: string
  source_contact: string
  status: ServiceConversationStatus
  latest_intent: ServiceAgentIntent | null
  sentiment_score: number | null
  sentiment_label: NewsletterSentimentLabel | null
  notes: string | null
  next_followup_at: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export type ServiceConversationMessageRecord = {
  id: number
  session_id: string
  direction: ServiceConversationDirection
  message_text: string
  intent: ServiceAgentIntent | null
  sentiment_score: number | null
  sentiment_label: NewsletterSentimentLabel | null
  ai_model: string | null
  metadata: string | null
  created_at: string
}

export type ServiceAppointmentStatus = 'pending' | 'confirmed' | 'rescheduled' | 'cancelled'

export type ServiceQuoteStatus = 'requested' | 'sent' | 'accepted' | 'rejected' | 'expired'

export type ServiceAppointmentRecord = {
  id: string
  session_id: string
  user_id: string | null
  source_contact: string
  service_type: string | null
  requested_date: string | null
  requested_time: string | null
  timezone: string | null
  notes: string | null
  status: ServiceAppointmentStatus
  created_at: string
  updated_at: string
}

export type ServiceQuoteRecord = {
  id: string
  session_id: string
  user_id: string | null
  source_contact: string
  service_type: string | null
  budget_range: string | null
  timeline: string | null
  details: string | null
  status: ServiceQuoteStatus
  quote_value: number | null
  created_at: string
  updated_at: string
}

export type ServiceAgentRecentSession = {
  id: string
  userId: string | null
  userName: string | null
  sourceContact: string
  status: ServiceConversationStatus
  latestIntent: ServiceAgentIntent | null
  sentimentScore: number | null
  sentimentLabel: NewsletterSentimentLabel | null
  lastMessageAt: string | null
  messageCount: number
}

export type ServiceAgentOverview = {
  generatedAt: string
  totals: {
    totalSessions: number
    activeSessions: number
    qualifiedSessions: number
    scheduledSessions: number
    quotedSessions: number
    optOutSessions: number
    averageSentiment: number
  }
  intentBuckets: {
    appointment: number
    quote: number
    question: number
    optOut: number
    other: number
  }
  pipeline: {
    appointmentsPending: number
    appointmentsConfirmed: number
    quotesRequested: number
    quotesSent: number
    quotesAccepted: number
  }
  recentSessions: ServiceAgentRecentSession[]
}

export type TelegramConversationStatus = 'active' | 'opt_out' | 'closed'

export type TelegramConversationDirection = 'inbound' | 'agent' | 'system'

export type TelegramConversationSessionRecord = {
  id: string
  user_id: string | null
  chat_id: string
  username: string | null
  first_name: string | null
  last_name: string | null
  status: TelegramConversationStatus
  sentiment_score: number | null
  sentiment_label: NewsletterSentimentLabel | null
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export type TelegramConversationMessageRecord = {
  id: number
  session_id: string
  direction: TelegramConversationDirection
  message_text: string
  message_id: number
  sentiment_score: number | null
  sentiment_label: NewsletterSentimentLabel | null
  ai_model: string | null
  metadata: string | null
  created_at: string
}

export type TelegramWebhookUpdate = {
  update_id: number
  message?: {
    message_id: number
    from: {
      id: number
      is_bot: boolean
      first_name: string
      last_name?: string
      username?: string
      language_code?: string
    }
    chat: {
      id: number
      first_name?: string
      last_name?: string
      username?: string
      type: 'private' | 'group' | 'supergroup' | 'channel'
    }
    date: number
    text?: string
    entities?: Array<{
      offset: number
      length: number
      type: string
    }>
  }
}

export type JourneyCreateInput = {
  id?: string | null
  name: string
  personaId: string
  productId: string
}

export type PersonaCreateInput = {
  id?: string | null
  name: string
  baseTone: string
  systemPrompt: string
  interactionConstraints?: string | null
}

export type ProductCreateInput = {
  id?: string | null
  name: string
  description: string
  pricingDetails?: string | null
  conversionUrl?: string | null
  metadata?: string | null
}

export type JourneyEnrollInput = {
  userId: string
  journeyId: string
  phase?: JourneyPhase
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
  inboundWebhookUrl: string | null
  testChatId: string | null
  testMessage: string | null
  updatedAt: string | null
  conversationEnabled: boolean
  aiModel: string
  maxReplyChars: number
}

export type AdminServiceAgentConfig = {
  autoReplyEnabled: boolean
  autoCreateAppointments: boolean
  autoCreateQuotes: boolean
  businessHoursEnabled: boolean
  businessHoursStart: string | null
  businessHoursEnd: string | null
  timezone: string
  offHoursAutoReply: string | null
  openingTemplate: string | null
  qualificationScript: string | null
  aiModel: string
  maxReplyChars: number
  updatedAt: string | null
}
