import type { InteractionEvent } from './types'

export const EVENT_WEIGHTS: Record<InteractionEvent, number> = {
  sent: 0.25,
  opened: 1,
  clicked: 2,
  shared: 3,
  converted: 5,
  referral_click: 1,
  personalized: 1.5,
  send_failed: 0,
}

export const DEFAULT_LANDING_PAGE = 'https://fluxoia.com/inscricao'
export const DEFAULT_AI_MODEL = '@cf/meta/llama-3-8b-instruct'
export const DEFAULT_PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST = ['httpbin.org']
export const ADMIN_SESSION_COOKIE = 'martech_admin_session'
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12
export const ADMIN_LOGIN_WINDOW_SECONDS = 60 * 10
export const ADMIN_LOGIN_MAX_FAILURES = 5
export const ADMIN_LOGIN_BLOCK_SECONDS = 60 * 15
export const ADMIN_WHATSAPP_INTEGRATION_CONFIG_KEY = 'admin_config:integration:whatsapp'
export const DEFAULT_WHATSAPP_TEST_MESSAGE =
  'Mensagem de teste do painel admin. Se voce recebeu isso, a integracao esta funcionando.'
