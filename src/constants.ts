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
export const ADMIN_EMAIL_INTEGRATION_CONFIG_KEY = 'admin_config:integration:email'
export const ADMIN_TELEGRAM_INTEGRATION_CONFIG_KEY = 'admin_config:integration:telegram'
export const ADMIN_SERVICE_AGENT_CONFIG_KEY = 'admin_config:service_agent'

export const DEFAULT_WHATSAPP_TEST_MESSAGE =
  'Mensagem de teste do painel admin. Se voce recebeu isso, a integracao esta funcionando.'

export const DEFAULT_EMAIL_TEST_MESSAGE =
  'Esta é uma mensagem de teste do painel admin Martech Cloud.'

export const DEFAULT_TELEGRAM_TEST_MESSAGE =
  'Esta é uma mensagem de teste do painel admin Martech Cloud via Telegram.'

export const DEFAULT_SERVICE_AGENT_OPENING_TEMPLATE =
  'Oi {{name}}! Sou do time comercial. Posso te ajudar com agendamento, orcamento ou tirar duvidas agora. Se preferir parar, responda SAIR.'

export const DEFAULT_SERVICE_AGENT_OFF_HOURS_REPLY =
  'Recebi sua mensagem e nosso time responde no horario comercial. Se quiser adiantar, me diga servico, objetivo e melhor horario para contato.'

export const DEFAULT_SERVICE_AGENT_QUALIFICATION_SCRIPT =
  'Priorize coletar servico, objetivo, prazo e faixa de investimento antes de sugerir proximo passo.'
