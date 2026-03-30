import { Hono } from 'hono'
import type { Bindings } from '../types'
import { DEFAULT_WHATSAPP_TEST_MESSAGE } from '../constants'
import { safeString, toNumber, toBoolean, resolveConsentSource, buildAdminRedirect, constantTimeEqual } from '../utils'
import {
  hasValidAdminSession,
  ensureAdminSession,
  getAdminPanelPassword,
  getAdminSessionSecret,
  getRequesterIp,
  createAdminSessionToken,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  checkAdminLoginThrottle,
  recordAdminLoginFailure,
  clearAdminLoginThrottle,
} from '../auth'
import { createUserRecord, createCampaignRecord, getOverviewMetrics } from '../db'
import { setUserMarketingConsent } from '../consent'
import {
  validateAdminIntegrationWebhookUrl,
  getAdminWhatsAppIntegrationConfig,
  saveAdminWhatsAppIntegrationConfig,
} from '../integration'
import { executeCampaignDispatch } from '../dispatch'
import { renderAdminLoginPage, renderAdminDashboardPage } from '../templates'

const admin = new Hono<{ Bindings: Bindings }>()

// Login Page
admin.get('/login', async (c) => {
  const hasSession = await hasValidAdminSession(c)
  if (hasSession) return c.redirect('/admin', 302)
  return c.html(renderAdminLoginPage())
})

// Login Action
admin.post('/login', async (c) => {
  const configuredPassword = getAdminPanelPassword(c.env)
  const sessionSecret = getAdminSessionSecret(c.env)
  const requesterIp = getRequesterIp(c.req.raw)
  if (!configuredPassword || !sessionSecret) {
    return c.html(
      renderAdminLoginPage(
        'Admin nao configurado. Defina ADMIN_PANEL_PASSWORD e ADMIN_SESSION_SECRET nos secrets.'
      ),
      500
    )
  }

  const throttle = await checkAdminLoginThrottle(c.env.MARTECH_KV, requesterIp)
  if (!throttle.allowed) {
    c.header('Retry-After', `${throttle.retryAfterSeconds}`)
    return c.html(
      renderAdminLoginPage('Muitas tentativas de login. Tente novamente em alguns minutos.'),
      429
    )
  }

  const form = await c.req.parseBody()
  const password = safeString(typeof form.password === 'string' ? form.password : null)
  if (!password || !constantTimeEqual(password, configuredPassword)) {
    await recordAdminLoginFailure(c.env.MARTECH_KV, requesterIp)
    return c.html(renderAdminLoginPage('Credenciais invalidas.'), 401)
  }

  await clearAdminLoginThrottle(c.env.MARTECH_KV, requesterIp)
  const token = await createAdminSessionToken(sessionSecret)
  setAdminSessionCookie(c, token)
  return c.redirect('/admin', 302)
})

// Logout Action
admin.post('/logout', async (c) => {
  clearAdminSessionCookie(c)
  return c.redirect('/admin/login', 302)
})

// Dashboard
admin.get('/', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  const [overview, campaigns, decisions, whatsappIntegration] = await Promise.all([
    getOverviewMetrics(c.env),
    c.env.DB.prepare(
      'SELECT id, name, channel, status, updated_at FROM campaigns ORDER BY updated_at DESC LIMIT 30'
    ).all<{ id: string; name: string; channel: string; status: string; updated_at: string }>(),
    c.env.DB.prepare(
      'SELECT decision_type, target_id, reason, created_at FROM agent_decisions ORDER BY created_at DESC LIMIT 20'
    ).all<{ decision_type: string; target_id: string | null; reason: string; created_at: string }>(),
    getAdminWhatsAppIntegrationConfig(c.env),
  ])

  const notice = safeString(c.req.query('notice'))
  const noticeKind = safeString(c.req.query('kind'))

  return c.html(
    renderAdminDashboardPage({
      notice,
      noticeKind,
      totals: overview.totals,
      metrics: overview.metrics,
      whatsappIntegration: {
        webhookUrl: whatsappIntegration.webhookUrl,
        testPhone: whatsappIntegration.testPhone,
        testMessage: whatsappIntegration.testMessage,
        updatedAt: whatsappIntegration.updatedAt,
        dispatchTokenConfigured: Boolean(safeString(c.env.DISPATCH_BEARER_TOKEN)),
      },
      campaigns: campaigns.results ?? [],
      decisions: decisions.results ?? [],
    })
  )
})

// Action - Create User
admin.post('/actions/user/create', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const result = await createUserRecord(c.env, {
      id: typeof form.id === 'string' ? form.id : undefined,
      name: typeof form.name === 'string' ? form.name : undefined,
      email: typeof form.email === 'string' ? form.email : undefined,
      phone: typeof form.phone === 'string' ? form.phone : undefined,
      preferredChannel: typeof form.preferredChannel === 'string' ? form.preferredChannel : undefined,
      psychologicalProfile:
        typeof form.psychologicalProfile === 'string' ? form.psychologicalProfile : undefined,
      referredBy: typeof form.referredBy === 'string' ? form.referredBy : undefined,
      marketingOptIn: typeof form.marketingOptIn === 'string' ? form.marketingOptIn : undefined,
      consentSource: typeof form.consentSource === 'string' ? form.consentSource : undefined,
    })
    return c.redirect(buildAdminRedirect(`Usuario criado: ${result.userId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar usuario: ${String(error)}`, 'error'), 302)
  }
})

// Action - User Opt-out
admin.post('/actions/user/optout', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const userId = safeString(typeof form.userId === 'string' ? form.userId : null)
    if (!userId) return c.redirect(buildAdminRedirect('userId e obrigatorio.', 'error'), 302)

    const source = resolveConsentSource(
      typeof form.source === 'string' ? form.source : null,
      'admin_panel_optout'
    )
    const consentResult = await setUserMarketingConsent(c.env, userId, false, source)
    if (!consentResult.updated || !consentResult.user) {
      return c.redirect(buildAdminRedirect('Usuario nao encontrado para opt-out.', 'error'), 302)
    }

    return c.redirect(buildAdminRedirect(`Opt-out aplicado: ${consentResult.user.id}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha no opt-out: ${String(error)}`, 'error'), 302)
  }
})

// Action - Create Campaign
admin.post('/actions/campaign/create', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const name = safeString(typeof form.name === 'string' ? form.name : null)
    const baseCopy = safeString(typeof form.baseCopy === 'string' ? form.baseCopy : null)
    if (!name || !baseCopy) {
      return c.redirect(buildAdminRedirect('Nome e base copy sao obrigatorios.', 'error'), 302)
    }

    const campaignId = await createCampaignRecord(c.env, {
      id: typeof form.id === 'string' ? form.id : undefined,
      name,
      baseCopy,
      incentiveOffer: typeof form.incentiveOffer === 'string' ? form.incentiveOffer : undefined,
      channel: typeof form.channel === 'string' ? form.channel : undefined,
    })
    return c.redirect(buildAdminRedirect(`Campanha criada: ${campaignId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar campanha: ${String(error)}`, 'error'), 302)
  }
})

// Action - Campaign Dispatch
admin.post('/actions/campaign/dispatch', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  const form = await c.req.parseBody()
  const campaignId = safeString(typeof form.campaignId === 'string' ? form.campaignId : null)
  if (!campaignId) return c.redirect(buildAdminRedirect('campaignId e obrigatorio.', 'error'), 302)

  const dispatchInput = {
    limit: toNumber(typeof form.limit === 'string' ? form.limit : null) || 100,
    personalize: toBoolean(typeof form.personalize === 'string' ? form.personalize : null, true),
    dryRun: toBoolean(typeof form.dryRun === 'string' ? form.dryRun : null, true),
    includeInactive: toBoolean(typeof form.includeInactive === 'string' ? form.includeInactive : null, false),
    force: toBoolean(typeof form.force === 'string' ? form.force : null, false),
    channel: typeof form.channel === 'string' ? form.channel : undefined,
    webhookUrlOverride: typeof form.webhookUrlOverride === 'string' ? form.webhookUrlOverride : undefined,
    metadata: { source: 'admin_panel' },
  }

  const requestOrigin = new URL(c.req.url).origin
  const dispatchResult = await executeCampaignDispatch(c.env, campaignId, dispatchInput, requestOrigin)
  if (!dispatchResult.ok) {
    return c.redirect(buildAdminRedirect(dispatchResult.error, 'error'), 302)
  }

  const summary = dispatchResult.data
  return c.redirect(
    buildAdminRedirect(
      `Dispatch ${summary.campaignId}: sent=${summary.sent}, failed=${summary.failed}, skipped=${summary.skipped}`
    ),
    302
  )
})

// Action - Save WhatsApp integration config
admin.post('/actions/integration/save', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const currentConfig = await getAdminWhatsAppIntegrationConfig(c.env)
    const form = await c.req.parseBody()
    const rawWebhookUrl =
      safeString(typeof form.webhookUrl === 'string' ? form.webhookUrl : null) ??
      currentConfig.webhookUrl
    if (!rawWebhookUrl) {
      return c.redirect(buildAdminRedirect('Webhook URL e obrigatoria.', 'error'), 302)
    }

    const validation = validateAdminIntegrationWebhookUrl(rawWebhookUrl, c.env)
    if (!validation.ok) return c.redirect(buildAdminRedirect(validation.error, 'error'), 302)

    const testPhone =
      safeString(typeof form.testPhone === 'string' ? form.testPhone : null) ?? currentConfig.testPhone
    const testMessage =
      safeString(typeof form.testMessage === 'string' ? form.testMessage : null) ??
      currentConfig.testMessage ??
      DEFAULT_WHATSAPP_TEST_MESSAGE

    const config = {
      webhookUrl: validation.normalizedUrl,
      testPhone,
      testMessage,
      updatedAt: new Date().toISOString(),
    }
    await saveAdminWhatsAppIntegrationConfig(c.env, config)

    return c.redirect(buildAdminRedirect('Configuracao da integracao WhatsApp salva.'), 302)
  } catch (error) {
    return c.redirect(
      buildAdminRedirect(`Falha ao salvar configuracao da integracao: ${String(error)}`, 'error'),
      302
    )
  }
})

// Action - Test WhatsApp integration
admin.post('/actions/integration/test', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const currentConfig = await getAdminWhatsAppIntegrationConfig(c.env)
    const form = await c.req.parseBody()

    const rawWebhookUrl =
      safeString(typeof form.webhookUrl === 'string' ? form.webhookUrl : null) ??
      currentConfig.webhookUrl
    if (!rawWebhookUrl) {
      return c.redirect(buildAdminRedirect('Webhook URL e obrigatoria para testar.', 'error'), 302)
    }

    const validation = validateAdminIntegrationWebhookUrl(rawWebhookUrl, c.env)
    if (!validation.ok) return c.redirect(buildAdminRedirect(validation.error, 'error'), 302)

    const testPhone =
      safeString(typeof form.testPhone === 'string' ? form.testPhone : null) ?? currentConfig.testPhone
    if (!testPhone) {
      return c.redirect(buildAdminRedirect('Informe um telefone de teste para WhatsApp.', 'error'), 302)
    }

    const testMessage =
      safeString(typeof form.testMessage === 'string' ? form.testMessage : null) ??
      currentConfig.testMessage ??
      DEFAULT_WHATSAPP_TEST_MESSAGE

    const dispatchToken = safeString(c.env.DISPATCH_BEARER_TOKEN)
    if (!dispatchToken) {
      return c.redirect(
        buildAdminRedirect('DISPATCH_BEARER_TOKEN nao configurado no Worker.', 'error'),
        302
      )
    }

    const config = {
      webhookUrl: validation.normalizedUrl,
      testPhone,
      testMessage,
      updatedAt: new Date().toISOString(),
    }
    await saveAdminWhatsAppIntegrationConfig(c.env, config)

    const requestOrigin = new URL(c.req.url).origin
    const payload = {
      channel: 'whatsapp',
      campaign: {
        id: 'admin-integration-test',
        name: 'Admin Integration Test',
      },
      user: {
        id: 'admin-test-user',
        name: 'Teste Admin',
        email: null,
        phone: testPhone,
        preferredChannel: 'whatsapp',
      },
      message: testMessage,
      referralUrl: `${requestOrigin}/ref/admin-test`,
      unsubscribeUrl: `${requestOrigin}/unsubscribe/admin-test`,
      metadata: {
        source: 'admin_panel_integration_test',
        requestedAt: new Date().toISOString(),
      },
    }

    const response = await fetch(validation.normalizedUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dispatchToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    const compactPreview = responseText.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!response.ok) {
      const suffix = compactPreview ? ` - ${compactPreview}` : ''
      return c.redirect(
        buildAdminRedirect(`Teste WhatsApp falhou (HTTP ${response.status})${suffix}`, 'error'),
        302
      )
    }

    return c.redirect(
      buildAdminRedirect(`Teste WhatsApp enviado com sucesso (HTTP ${response.status}).`),
      302
    )
  } catch (error) {
    return c.redirect(
      buildAdminRedirect(`Falha ao executar teste da integracao: ${String(error)}`, 'error'),
      302
    )
  }
})

export { admin }
