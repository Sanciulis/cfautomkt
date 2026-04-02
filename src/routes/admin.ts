import { Hono } from 'hono'
import type { Bindings, JourneyPhase, JourneyConversationMessage, JourneyRecord, SegmentCriteria } from '../types'
import { DEFAULT_WHATSAPP_TEST_MESSAGE, DEFAULT_EMAIL_TEST_MESSAGE, DEFAULT_TELEGRAM_TEST_MESSAGE } from '../constants'
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
import { createUserRecord, createCampaignRecord, getOverviewMetrics, getAIInferenceOverview, createJourneyRecord, listJourneys, getJourneyById, updateJourneyStatus, enrollUserInJourney, listJourneyEnrollments, createPersonaRecord, createProductRecord } from '../db'
import { setUserMarketingConsent } from '../consent'
import { simulatePersonaConversation } from '../persona'
import {
  validateAdminIntegrationWebhookUrl,
  getAdminWhatsAppIntegrationConfig,
  saveAdminWhatsAppIntegrationConfig,
  getAdminEmailIntegrationConfig,
  saveAdminEmailIntegrationConfig,
  getAdminTelegramIntegrationConfig,
  saveAdminTelegramIntegrationConfig
} from '../integration'
import { executeCampaignDispatch } from '../dispatch'
import { renderAdminLoginPage, renderAdminDashboardPage } from '../templates'
import { createSegment, listSegments, getSegmentById, updateSegment, deleteSegment, getUsersInSegment, refreshUserSegments } from '../segmentation'
import { createFreezingRule, getFreezingRules, getFreezingRuleById, updateFreezingRule, deleteFreezingRule, createDefaultFreezingRules } from '../freezing-rules'
import { runPromptEvaluation } from '../ai-eval'
import { getPromptHistory, publishPromptVersion, getActivePrompt } from '../prompt-manager'

const admin = new Hono<{ Bindings: Bindings }>()

function toCsvCell(value: unknown): string {
  const text = String(value ?? '')
  const escaped = text.replace(/"/g, '""')
  return `"${escaped}"`
}

type ControlEntityType = 'campaign' | 'journey'
type ControlDetailLevel = 'summary' | 'operations' | 'full'

function normalizeControlType(value: string | null): ControlEntityType {
  return value === 'journey' ? 'journey' : 'campaign'
}

function normalizeControlDetailLevel(value: string | null): ControlDetailLevel {
  if (value === 'summary' || value === 'operations' || value === 'full') {
    return value
  }
  return 'operations'
}

function normalizeWhatsAppParticipantPhone(value: unknown): string | null {
  const raw = safeString(value)
  if (!raw) return null

  const normalized = raw.toLowerCase()
  const atIndex = normalized.indexOf('@')

  if (atIndex > 0) {
    const localPart = normalized.slice(0, atIndex)
    const domainPart = normalized.slice(atIndex + 1)
    if (domainPart !== 's.whatsapp.net' && domainPart !== 'c.us') {
      return null
    }
    const digits = localPart.replace(/[^0-9]/g, '')
    if (digits.length < 10 || digits.length > 15) return null
    return digits
  }

  const digits = normalized.replace(/[^0-9]/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}

function buildAdminControlRedirect(
  notice: string,
  kind: 'success' | 'error',
  controlType: ControlEntityType,
  controlId: string | null,
  detailLevel: ControlDetailLevel
): string {
  const params = new URLSearchParams()
  params.set('notice', notice)
  params.set('kind', kind)
  params.set('controlType', controlType)
  params.set('detailLevel', detailLevel)
  if (controlId) params.set('controlId', controlId)
  return `/admin?${params.toString()}#control-room`
}

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

  const [overview, campaigns, decisions, users, whatsappIntegration, emailIntegration, telegramIntegration, journeys] = await Promise.all([
    getOverviewMetrics(c.env),
    c.env.DB.prepare(
      'SELECT id, name, channel, status, updated_at FROM campaigns ORDER BY updated_at DESC LIMIT 30'
    ).all<{ id: string; name: string; channel: string; status: string; updated_at: string }>(),
    c.env.DB.prepare(
      'SELECT decision_type, target_id, reason, created_at FROM agent_decisions ORDER BY created_at DESC LIMIT 20'
    ).all<{ decision_type: string; target_id: string | null; reason: string; created_at: string }>(),
    c.env.DB.prepare(
      'SELECT id, name, email, phone, preferred_channel, created_at FROM users ORDER BY created_at DESC LIMIT 50'
    ).all<{ id: string; name: string | null; email: string | null; phone: string | null; preferred_channel: string; created_at: string }>(),
    getAdminWhatsAppIntegrationConfig(c.env),
    getAdminEmailIntegrationConfig(c.env),
    getAdminTelegramIntegrationConfig(c.env),
    listJourneys(c.env),
  ])

  // Fetch enrollment counts for each journey
  const journeysWithCounts = await Promise.all(
    journeys.map(async (j) => {
      const enrollments = await listJourneyEnrollments(c.env, j.id)
      return { ...j, enrollmentCount: enrollments.length }
    })
  )

  const campaignRows = campaigns.results ?? []
  const controlType = normalizeControlType(safeString(c.req.query('controlType')))
  const detailLevel = normalizeControlDetailLevel(safeString(c.req.query('detailLevel')))
  const requestedControlId = safeString(c.req.query('controlId'))

  const selectedCampaignCore =
    controlType === 'campaign'
      ? campaignRows.find((item) => item.id === requestedControlId) ?? campaignRows[0] ?? null
      : null

  const selectedJourneyCore =
    controlType === 'journey'
      ? journeysWithCounts.find((item) => item.id === requestedControlId) ?? journeysWithCounts[0] ?? null
      : null

  let selectedCampaign: {
    id: string
    name: string
    channel: string
    status: string
    base_copy: string | null
    incentive_offer: string | null
    updated_at: string | null
    stats: {
      sent: number
      opened: number
      clicked: number
      converted: number
      shared: number
      failed: number
      lastEventAt: string | null
    }
    recentEvents: Array<{
      userId: string
      userName: string | null
      eventType: string
      channel: string
      timestamp: string
    }>
  } | null = null

  if (selectedCampaignCore) {
    const [campaignDetail, campaignEventCounts, campaignRecentEvents] = await Promise.all([
      c.env.DB.prepare(
        'SELECT id, name, channel, status, base_copy, incentive_offer, updated_at FROM campaigns WHERE id = ?'
      )
        .bind(selectedCampaignCore.id)
        .first<{
          id: string
          name: string
          channel: string
          status: string
          base_copy: string | null
          incentive_offer: string | null
          updated_at: string | null
        }>(),
      c.env.DB.prepare(
        'SELECT event_type, COUNT(*) AS total FROM interactions WHERE campaign_id = ? GROUP BY event_type'
      )
        .bind(selectedCampaignCore.id)
        .all<{ event_type: string; total: number }>(),
      c.env.DB.prepare(
        `SELECT i.user_id, u.name AS user_name, i.event_type, i.channel, i.timestamp
         FROM interactions i
         LEFT JOIN users u ON u.id = i.user_id
         WHERE i.campaign_id = ?
         ORDER BY i.timestamp DESC
         LIMIT 20`
      )
        .bind(selectedCampaignCore.id)
        .all<{
          user_id: string
          user_name: string | null
          event_type: string
          channel: string
          timestamp: string
        }>(),
    ])

    if (campaignDetail) {
      const eventCountMap = new Map<string, number>()
      for (const row of campaignEventCounts.results ?? []) {
        eventCountMap.set(String(row.event_type), toNumber(row.total))
      }

      const recentEvents = (campaignRecentEvents.results ?? []).map((row) => ({
        userId: String(row.user_id),
        userName: row.user_name,
        eventType: String(row.event_type),
        channel: String(row.channel || campaignDetail.channel || 'whatsapp'),
        timestamp: String(row.timestamp),
      }))

      selectedCampaign = {
        ...campaignDetail,
        stats: {
          sent: eventCountMap.get('sent') ?? 0,
          opened: eventCountMap.get('opened') ?? 0,
          clicked: eventCountMap.get('clicked') ?? 0,
          converted: eventCountMap.get('converted') ?? 0,
          shared: (eventCountMap.get('shared') ?? 0) + (eventCountMap.get('referral_click') ?? 0),
          failed: eventCountMap.get('send_failed') ?? 0,
          lastEventAt: recentEvents[0]?.timestamp ?? null,
        },
        recentEvents,
      }
    }
  }

  let selectedJourney: {
    id: string
    name: string
    status: string
    objective: string | null
    systemPrompt: string | null
    personaName: string | null
    phaseCounts: Array<{ phase: string; count: number }>
    totalEnrollments: number
    retainedEnrollments: number
    lastInteractionAt: string | null
    recentEnrollments: Array<{
      userId: string
      userName: string | null
      currentPhase: string
      lastInteractionAt: string | null
      turns: number
    }>
  } | null = null

  if (selectedJourneyCore) {
    const [journeyDetail, phaseRows, recentEnrollmentsRows] = await Promise.all([
      getJourneyById(c.env, selectedJourneyCore.id),
      c.env.DB.prepare(
        'SELECT current_phase, COUNT(*) AS total FROM journey_enrollments WHERE journey_id = ? GROUP BY current_phase'
      )
        .bind(selectedJourneyCore.id)
        .all<{ current_phase: string; total: number }>(),
      c.env.DB.prepare(
        `SELECT je.user_id, u.name AS user_name, je.current_phase, je.last_interaction_at, je.conversation_history
         FROM journey_enrollments je
         LEFT JOIN users u ON u.id = je.user_id
         WHERE je.journey_id = ?
         ORDER BY je.last_interaction_at DESC
         LIMIT 20`
      )
        .bind(selectedJourneyCore.id)
        .all<{
          user_id: string
          user_name: string | null
          current_phase: string
          last_interaction_at: string | null
          conversation_history: string | null
        }>(),
    ])

    if (journeyDetail) {
      const phaseOrder: JourneyPhase[] = ['discovery', 'interest', 'desire', 'action', 'retained']
      const phaseCountMap = new Map<string, number>()
      for (const row of phaseRows.results ?? []) {
        phaseCountMap.set(String(row.current_phase), toNumber(row.total))
      }

      const phaseCounts = phaseOrder.map((phase) => ({
        phase,
        count: phaseCountMap.get(phase) ?? 0,
      }))

      const recentEnrollments = (recentEnrollmentsRows.results ?? []).map((row) => {
        let turns = 0
        if (row.conversation_history) {
          try {
            const parsed = JSON.parse(row.conversation_history)
            if (Array.isArray(parsed)) turns = parsed.length
          } catch {
            turns = 0
          }
        }

        return {
          userId: String(row.user_id),
          userName: row.user_name,
          currentPhase: String(row.current_phase),
          lastInteractionAt: row.last_interaction_at,
          turns,
        }
      })

      const totalEnrollments = phaseCounts.reduce((sum, item) => sum + item.count, 0)
      const retainedEnrollments = phaseCountMap.get('retained') ?? 0

      selectedJourney = {
        id: journeyDetail.id,
        name: journeyDetail.name,
        status: journeyDetail.status,
        objective: safeString(journeyDetail.objective),
        systemPrompt: safeString(journeyDetail.system_prompt),
        personaName: safeString(journeyDetail.persona_name),
        phaseCounts,
        totalEnrollments,
        retainedEnrollments,
        lastInteractionAt: recentEnrollments[0]?.lastInteractionAt ?? null,
        recentEnrollments,
      }
    }
  }

  const activeControlId = selectedCampaign?.id ?? selectedJourney?.id ?? null

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
        gatewayToken: whatsappIntegration.gatewayToken,
      },
      emailIntegration: {
        webhookUrl: emailIntegration.webhookUrl,
        testEmail: emailIntegration.testEmail,
        testSubject: emailIntegration.testSubject,
        testMessage: emailIntegration.testMessage,
        updatedAt: emailIntegration.updatedAt,
      },
      telegramIntegration: {
        webhookUrl: telegramIntegration.webhookUrl,
        testChatId: telegramIntegration.testChatId,
        testMessage: telegramIntegration.testMessage,
        updatedAt: telegramIntegration.updatedAt,
      },
      users: users.results ?? [],
      campaigns: campaignRows,
      decisions: decisions.results ?? [],
      journeys: journeysWithCounts,
      controlPanel: {
        selectedType: controlType,
        selectedId: activeControlId,
        detailLevel,
        campaigns: campaignRows,
        journeys: journeysWithCounts,
        selectedCampaign,
        selectedJourney,
      },
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

// Action - Bulk User Upload CSV
admin.post('/actions/user/upload', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const body = await c.req.parseBody()
    const file = body['csvFile']
    
    // Hono yields standard Web API File 
    if (!(file instanceof File)) {
      return c.redirect(buildAdminRedirect('Arquivo invalido ou ausente.', 'error'), 302)
    }

    const text = await file.text()
    const lines = text.split('\n')
    if (lines.length < 2) {
      return c.redirect(buildAdminRedirect('O arquivo CSV parece estar vazio ou sem leads válidos.', 'error'), 302)
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    let imported = 0
    let failed = 0

    // Process sequentially to honor connection flow and simplicity scaling
    for (let i = 1; i < lines.length; i++) {
       const line = lines[i].trim()
       if (!line) continue
       
       const parts = line.split(',')
       const record: Record<string, string> = {}
       headers.forEach((h, idx) => {
           record[h] = parts[idx]?.trim()
       })

       if (!record.email && !record.phone) {
           failed++
           continue
       }

       try {
           await createUserRecord(c.env, {
               name: record.name,
               email: record.email || undefined,
               phone: record.phone || undefined,
               preferredChannel: record.channel || record.preferred_channel || 'whatsapp',
               consentSource: 'bulk_csv_upload',
               marketingOptIn: 'true'
           })
           imported++
       } catch (e) {
           failed++
       }
    }

    const m = failed > 0 ? `Injetados: ${imported}, Falhas: ${failed} (Já existem ou formato incorreto).` : `Todos os ${imported} leads foram injetados com sucesso!`
    return c.redirect(buildAdminRedirect(m), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Erro no processamento CSV: ${String(error)}`, 'error'), 302)
  }
})

// Action - Import Extracted Group Participants
admin.post('/actions/groups/import', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const groupName = safeString(typeof form.groupName === 'string' ? form.groupName : 'Desconhecido')
    const participantsRaw = typeof form.participants === 'string' ? form.participants : '[]'

    const parsedParticipants: unknown = JSON.parse(participantsRaw)
    if (!Array.isArray(parsedParticipants) || parsedParticipants.length === 0) {
      return c.redirect(buildAdminRedirect('Nenhum participante recebido para importação.', 'error'), 302)
    }

    const normalizedPhones = Array.from(
      new Set(
        parsedParticipants
          .map((participant) => normalizeWhatsAppParticipantPhone(participant))
          .filter((phone): phone is string => typeof phone === 'string')
      )
    )

    if (normalizedPhones.length === 0) {
      return c.redirect(
        buildAdminRedirect('Nao foi encontrado nenhum numero de telefone valido para importacao.', 'error'),
        302
      )
    }

    let imported = 0
    let failed = 0
    const ignored = parsedParticipants.length - normalizedPhones.length

    for (const phone of normalizedPhones) {
       try {
           await createUserRecord(c.env, {
               name: `Lead via ${groupName}`,
               phone: phone,
               preferredChannel: 'whatsapp',
               consentSource: `group_extraction`,
               marketingOptIn: 'true'
           })
           imported++
       } catch (e) {
           failed++
       }
    }

    const ignoredNotice = ignored > 0 ? ` Ignorados (nao telefonicos/duplicados): ${ignored}.` : ''
    const m =
      failed > 0
        ? `Contatos do grupo extraidos e salvos: ${imported}, Falhas (ou duplos): ${failed}.${ignoredNotice}`
        : `Sucesso absoluto! ${imported} contatos extraidos salvos.${ignoredNotice}`
    return c.redirect(buildAdminRedirect(m), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Erro na extração: ${String(error)}`, 'error'), 302)
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
    userIds: typeof form.targetUserId === 'string' && form.targetUserId.trim() ? [form.targetUserId.trim()] : undefined,
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

// Action - Control Room Status (Campaign or Journey)
admin.post('/actions/control/status', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const controlType = normalizeControlType(
      safeString(typeof form.controlType === 'string' ? form.controlType : null)
    )
    const detailLevel = normalizeControlDetailLevel(
      safeString(typeof form.detailLevel === 'string' ? form.detailLevel : null)
    )
    const controlId = safeString(typeof form.controlId === 'string' ? form.controlId : null)
    const action = safeString(typeof form.action === 'string' ? form.action : null)

    if (!controlId || !action) {
      return c.redirect(
        buildAdminControlRedirect(
          'Controle invalido: informe o item e a acao desejada.',
          'error',
          controlType,
          controlId,
          detailLevel
        ),
        302
      )
    }

    if (action !== 'start' && action !== 'pause' && action !== 'stop') {
      return c.redirect(
        buildAdminControlRedirect(
          'Acao invalida. Use iniciar, pausar ou parar.',
          'error',
          controlType,
          controlId,
          detailLevel
        ),
        302
      )
    }

    const statusTarget: 'active' | 'paused' = action === 'start' ? 'active' : 'paused'

    if (controlType === 'campaign') {
      const campaign = await c.env.DB.prepare('SELECT id, name FROM campaigns WHERE id = ?')
        .bind(controlId)
        .first<{ id: string; name: string }>()

      if (!campaign) {
        return c.redirect(
          buildAdminControlRedirect('Campanha nao encontrada.', 'error', controlType, controlId, detailLevel),
          302
        )
      }

      await c.env.DB.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(statusTarget, controlId)
        .run()

      await c.env.DB.prepare(
        'INSERT INTO agent_decisions (decision_type, target_id, reason, payload) VALUES (?, ?, ?, ?)'
      )
        .bind(
          'admin_control_campaign_status',
          controlId,
          `Campaign ${campaign.name} changed to ${statusTarget} via ${action}`,
          JSON.stringify({ source: 'admin_control_room', action, statusTarget })
        )
        .run()
    } else {
      const journey = await getJourneyById(c.env, controlId)
      if (!journey) {
        return c.redirect(
          buildAdminControlRedirect('Jornada nao encontrada.', 'error', controlType, controlId, detailLevel),
          302
        )
      }

      await updateJourneyStatus(c.env, controlId, statusTarget)

      await c.env.DB.prepare(
        'INSERT INTO agent_decisions (decision_type, target_id, reason, payload) VALUES (?, ?, ?, ?)'
      )
        .bind(
          'admin_control_journey_status',
          controlId,
          `Journey ${journey.name} changed to ${statusTarget} via ${action}`,
          JSON.stringify({ source: 'admin_control_room', action, statusTarget })
        )
        .run()
    }

    const statusLabel = action === 'start' ? 'iniciado' : action === 'pause' ? 'pausado' : 'parado'
    return c.redirect(
      buildAdminControlRedirect(
        `Controle aplicado com sucesso: ${controlType} ${controlId} ${statusLabel}.`,
        'success',
        controlType,
        controlId,
        detailLevel
      ),
      302
    )
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao aplicar controle: ${String(error)}`, 'error'), 302)
  }
})

// Action - Control Room Edit (Campaign or Journey)
admin.post('/actions/control/edit', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const controlType = normalizeControlType(
      safeString(typeof form.controlType === 'string' ? form.controlType : null)
    )
    const detailLevel = normalizeControlDetailLevel(
      safeString(typeof form.detailLevel === 'string' ? form.detailLevel : null)
    )
    const controlId = safeString(typeof form.controlId === 'string' ? form.controlId : null)

    if (!controlId) {
      return c.redirect(
        buildAdminControlRedirect(
          'Controle invalido: item nao informado para edicao.',
          'error',
          controlType,
          controlId,
          detailLevel
        ),
        302
      )
    }

    if (controlType === 'campaign') {
      const campaign = await c.env.DB.prepare(
        'SELECT id, name, base_copy, incentive_offer, channel FROM campaigns WHERE id = ?'
      )
        .bind(controlId)
        .first<{
          id: string
          name: string
          base_copy: string
          incentive_offer: string | null
          channel: string
        }>()

      if (!campaign) {
        return c.redirect(
          buildAdminControlRedirect('Campanha nao encontrada.', 'error', controlType, controlId, detailLevel),
          302
        )
      }

      const nextName = safeString(typeof form.name === 'string' ? form.name : null) ?? campaign.name
      const nextBaseCopy =
        safeString(typeof form.baseCopy === 'string' ? form.baseCopy : null) ?? campaign.base_copy
      const providedChannel = safeString(typeof form.channel === 'string' ? form.channel : null)?.toLowerCase()
      const nextChannel =
        providedChannel && ['whatsapp', 'email', 'telegram', 'sms'].includes(providedChannel)
          ? providedChannel
          : campaign.channel
      const nextIncentiveOffer =
        typeof form.incentiveOffer === 'string'
          ? safeString(form.incentiveOffer)
          : campaign.incentive_offer

      await c.env.DB.prepare(
        'UPDATE campaigns SET name = ?, base_copy = ?, channel = ?, incentive_offer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
        .bind(nextName, nextBaseCopy, nextChannel, nextIncentiveOffer, controlId)
        .run()

      return c.redirect(
        buildAdminControlRedirect(
          `Campanha ${controlId} atualizada com sucesso.`,
          'success',
          controlType,
          controlId,
          detailLevel
        ),
        302
      )
    }

    const journey = await getJourneyById(c.env, controlId)
    if (!journey) {
      return c.redirect(
        buildAdminControlRedirect('Jornada nao encontrada.', 'error', controlType, controlId, detailLevel),
        302
      )
    }

    const nextName = safeString(typeof form.name === 'string' ? form.name : null) ?? journey.name
    const nextObjective =
      safeString(typeof form.objective === 'string' ? form.objective : null) ??
      safeString(journey.objective)
    const nextSystemPrompt =
      safeString(typeof form.systemPrompt === 'string' ? form.systemPrompt : null) ??
      safeString(journey.system_prompt)

    await c.env.DB.prepare('UPDATE journeys SET name = ? WHERE id = ?').bind(nextName, controlId).run()

    if (nextObjective && journey.product_id) {
      await c.env.DB.prepare('UPDATE products SET description = ? WHERE id = ?')
        .bind(nextObjective, journey.product_id)
        .run()
    }

    if (nextSystemPrompt && journey.persona_id) {
      await c.env.DB.prepare('UPDATE personas SET system_prompt = ? WHERE id = ?')
        .bind(nextSystemPrompt, journey.persona_id)
        .run()
    }

    return c.redirect(
      buildAdminControlRedirect(
        `Jornada ${controlId} atualizada com sucesso.`,
        'success',
        controlType,
        controlId,
        detailLevel
      ),
      302
    )
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao editar controle: ${String(error)}`, 'error'), 302)
  }
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
      gatewayToken: safeString(typeof form.gatewayToken === 'string' ? form.gatewayToken : null) ?? currentConfig.gatewayToken,
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

// Action - Save Email integration config
admin.post('/actions/integration/email/save', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const currentConfig = await getAdminEmailIntegrationConfig(c.env)
    const form = await c.req.parseBody()
    const rawWebhookUrl =
      safeString(typeof form.webhookUrl === 'string' ? form.webhookUrl : null) ??
      currentConfig.webhookUrl
    if (!rawWebhookUrl) {
      return c.redirect(buildAdminRedirect('Webhook URL e obrigatoria.', 'error'), 302)
    }

    const validation = validateAdminIntegrationWebhookUrl(rawWebhookUrl, c.env)
    if (!validation.ok) return c.redirect(buildAdminRedirect(validation.error, 'error'), 302)

    const testEmail =
      safeString(typeof form.testEmail === 'string' ? form.testEmail : null) ?? currentConfig.testEmail
    const testSubject =
      safeString(typeof form.testSubject === 'string' ? form.testSubject : null) ?? currentConfig.testSubject ?? 'Test Message from Martech Cloud'
    const testMessage =
      safeString(typeof form.testMessage === 'string' ? form.testMessage : null) ??
      currentConfig.testMessage ??
      DEFAULT_EMAIL_TEST_MESSAGE

    const config = {
      webhookUrl: validation.normalizedUrl,
      testEmail,
      testSubject,
      testMessage,
      updatedAt: new Date().toISOString(),
    }
    await saveAdminEmailIntegrationConfig(c.env, config)

    return c.redirect(buildAdminRedirect('Configuracao da integracao de Email salva.'), 302)
  } catch (error) {
    return c.redirect(
      buildAdminRedirect(`Falha ao salvar configuracao de email: ${String(error)}`, 'error'),
      302
    )
  }
})

// Action - Save Telegram integration config
admin.post('/actions/integration/telegram/save', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const currentConfig = await getAdminTelegramIntegrationConfig(c.env)
    const form = await c.req.parseBody()
    const rawWebhookUrl =
      safeString(typeof form.webhookUrl === 'string' ? form.webhookUrl : null) ??
      currentConfig.webhookUrl
    if (!rawWebhookUrl) {
      return c.redirect(buildAdminRedirect('Webhook URL e obrigatoria.', 'error'), 302)
    }

    const validation = validateAdminIntegrationWebhookUrl(rawWebhookUrl, c.env)
    if (!validation.ok) return c.redirect(buildAdminRedirect(validation.error, 'error'), 302)

    const testChatId =
      safeString(typeof form.testChatId === 'string' ? form.testChatId : null) ?? currentConfig.testChatId
    const testMessage =
      safeString(typeof form.testMessage === 'string' ? form.testMessage : null) ??
      currentConfig.testMessage ??
      DEFAULT_TELEGRAM_TEST_MESSAGE

    const config = {
      webhookUrl: validation.normalizedUrl,
      testChatId,
      testMessage,
      updatedAt: new Date().toISOString(),
    }
    await saveAdminTelegramIntegrationConfig(c.env, config)

    return c.redirect(buildAdminRedirect('Configuracao da integracao do Telegram salva.'), 302)
  } catch (error) {
    return c.redirect(
      buildAdminRedirect(`Falha ao salvar configuracao do telegram: ${String(error)}`, 'error'),
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
      gatewayToken: safeString(typeof form.gatewayToken === 'string' ? form.gatewayToken : null) ?? currentConfig.gatewayToken,
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

// --- Gateway Proxy (same-origin, no CORS) ---

function deriveGatewayBaseUrl(webhookUrl: string | null): string | null {
  if (!webhookUrl) return null
  try {
    const parsed = new URL(webhookUrl)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

admin.get('/api/gateway/groups', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized Session' }, 401)

  const config = await getAdminWhatsAppIntegrationConfig(c.env)
  const baseUrl = deriveGatewayBaseUrl(config.webhookUrl)
  const token = safeString(config.gatewayToken) || safeString(c.env.DISPATCH_BEARER_TOKEN)

  if (!baseUrl || !token) {
    return c.json({ error: 'Gateway não configurado. Salve Webhook URL nas Integrações.' }, 400)
  }

  try {
    const response = await fetch(`${baseUrl}/webhooks/gateway/groups`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    return c.json(data, response.status as 200)
  } catch (error) {
    return c.json({ error: `Gateway inacessível: ${String(error)}` }, 502)
  }
})

admin.get('/api/gateway/groups/:groupId/participants', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized Session' }, 401)

  const config = await getAdminWhatsAppIntegrationConfig(c.env)
  const baseUrl = deriveGatewayBaseUrl(config.webhookUrl)
  const token = safeString(config.gatewayToken) || safeString(c.env.DISPATCH_BEARER_TOKEN)

  if (!baseUrl || !token) {
    return c.json({ error: 'Gateway não configurado.' }, 400)
  }

  const groupId = c.req.param('groupId')
  try {
    const response = await fetch(`${baseUrl}/webhooks/gateway/groups/${encodeURIComponent(groupId)}/participants`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    return c.json(data, response.status as 200)
  } catch (error) {
    return c.json({ error: `Gateway inacessível: ${String(error)}` }, 502)
  }
})

// -- Journey Admin Actions --

// Action - Create Journey
admin.post('/actions/journey/create', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const name = safeString(typeof form.name === 'string' ? form.name : null)
    const objective = safeString(typeof form.objective === 'string' ? form.objective : null)
    const systemPrompt = safeString(typeof form.systemPrompt === 'string' ? form.systemPrompt : null)

    if (!name || !objective || !systemPrompt) {
      return c.redirect(buildAdminRedirect('Nome, objetivo e system prompt são obrigatórios.', 'error'), 302)
    }

    const personaId = await createPersonaRecord(c.env, {
      name: `Auto Persona (${name})`,
      baseTone: 'amigável',
      systemPrompt: systemPrompt
    })

    const productId = await createProductRecord(c.env, {
      name: `Auto Produto (${name})`,
      description: objective
    })

    const journeyId = await createJourneyRecord(c.env, {
      id: typeof form.id === 'string' ? form.id : undefined,
      name,
      personaId,
      productId,
    })
    return c.redirect(buildAdminRedirect(`Jornada criada: ${journeyId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar jornada: ${String(error)}`, 'error'), 302)
  }
})

// Action - Toggle Journey Status
admin.post('/actions/journey/toggle', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const journeyId = safeString(typeof form.journeyId === 'string' ? form.journeyId : null)
    if (!journeyId) return c.redirect(buildAdminRedirect('journeyId é obrigatório.', 'error'), 302)

    const journey = await getJourneyById(c.env, journeyId)
    if (!journey) return c.redirect(buildAdminRedirect('Jornada não encontrada.', 'error'), 302)

    const newStatus = journey.status === 'active' ? 'paused' : 'active'
    await updateJourneyStatus(c.env, journeyId, newStatus)
    return c.redirect(buildAdminRedirect(`Jornada ${journeyId} alterada para ${newStatus}.`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao alterar status: ${String(error)}`, 'error'), 302)
  }
})

// Action - Enroll User in Journey
admin.post('/actions/journey/enroll', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const userId = safeString(typeof form.userId === 'string' ? form.userId : null)
    const journeyId = safeString(typeof form.journeyId === 'string' ? form.journeyId : null)

    if (!userId || !journeyId) {
      return c.redirect(buildAdminRedirect('userId e journeyId são obrigatórios.', 'error'), 302)
    }

    await enrollUserInJourney(c.env, { userId, journeyId })
    return c.redirect(buildAdminRedirect(`Lead ${userId} inscrito na jornada ${journeyId}.`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao inscrever lead: ${String(error)}`, 'error'), 302)
  }
})

// --- Playground Action ---
admin.post('/api/playground/chat', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  const body = (await c.req.json().catch(() => null)) as Partial<{
    message: string
    systemPrompt: string
    objective: string
    currentPhase: JourneyPhase
    chatHistory: JourneyConversationMessage[]
    userProfile: { name: string; preferredChannel: string; engagementScore: number; psychologicalProfile: string }
  }> | null

  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  const message = safeString(body.message)
  if (!message) return c.json({ error: 'message is required' }, 400)

  const phase = body.currentPhase ?? 'discovery'
  const history = Array.isArray(body.chatHistory) ? body.chatHistory : []

  const mockedJourney: JourneyRecord = {
    id: 'simulated-journey',
    name: 'Playground Simulation',
    objective: safeString(body.objective) || 'Converter em vendas',
    system_prompt: safeString(body.systemPrompt) || 'Você é um assistente amigável.',
    persona_id: 'simulated-persona',
    product_id: 'simulated-product',
    status: 'active' as const,
  }

  const mockedUser = {
    id: 'simulated-user',
    name: body.userProfile?.name || 'Visitante',
    email: null,
    phone: null,
    preferred_channel: body.userProfile?.preferredChannel || 'whatsapp',
    psychological_profile: body.userProfile?.psychologicalProfile || 'generic',
    engagement_score: toNumber(body.userProfile?.engagementScore) || 5.0,
    referral_code: 'simul123',
    referred_by: null,
    viral_points: 0,
    marketing_opt_in: 1,
    opt_out_at: null,
    consent_source: 'simulation',
    consent_updated_at: new Date().toISOString(),
    last_active: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }

  const result = await simulatePersonaConversation(
    c.env,
    mockedJourney,
    mockedUser,
    phase,
    history,
    message
  )

  return c.json({
    status: 'success',
    response: result.response,
    phaseAdvanced: result.phaseAdvanced,
    currentPhase: result.newPhase,
    updatedHistory: result.updatedHistory,
  })
})

// --- Segmentation Actions ---

// Action - Create Segment
admin.post('/actions/segment/create', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const name = safeString(typeof form.name === 'string' ? form.name : null)
    const description = safeString(typeof form.description === 'string' ? form.description : null)
    const criteriaRaw = safeString(typeof form.criteria === 'string' ? form.criteria : null)

    if (!name || !criteriaRaw) {
      return c.redirect(buildAdminRedirect('Nome e critérios são obrigatórios.', 'error'), 302)
    }

    let criteria: SegmentCriteria[]
    try {
      criteria = JSON.parse(criteriaRaw)
    } catch {
      return c.redirect(buildAdminRedirect('Critérios devem ser um JSON válido.', 'error'), 302)
    }

    const segment = await createSegment(c.env, name, criteria, description || undefined)
    return c.redirect(buildAdminRedirect(`Segmento criado: ${segment.id}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar segmento: ${String(error)}`, 'error'), 302)
  }
})

// Action - Update Segment
admin.post('/actions/segment/update', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const segmentId = safeString(typeof form.segmentId === 'string' ? form.segmentId : null)
    const name = safeString(typeof form.name === 'string' ? form.name : null)
    const description = safeString(typeof form.description === 'string' ? form.description : null)
    const criteriaRaw = safeString(typeof form.criteria === 'string' ? form.criteria : null)

    if (!segmentId) {
      return c.redirect(buildAdminRedirect('segmentId é obrigatório.', 'error'), 302)
    }

    const updates: any = {}
    if (name) updates.name = name
    if (description !== undefined) updates.description = description
    if (criteriaRaw) {
      try {
        updates.criteria = JSON.parse(criteriaRaw)
      } catch {
        return c.redirect(buildAdminRedirect('Critérios devem ser um JSON válido.', 'error'), 302)
      }
    }

    const segment = await updateSegment(c.env, segmentId, updates)
    if (!segment) {
      return c.redirect(buildAdminRedirect('Segmento não encontrado.', 'error'), 302)
    }

    return c.redirect(buildAdminRedirect(`Segmento atualizado: ${segment.id}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao atualizar segmento: ${String(error)}`, 'error'), 302)
  }
})

// Action - Delete Segment
admin.post('/actions/segment/delete', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const segmentId = safeString(typeof form.segmentId === 'string' ? form.segmentId : null)
    if (!segmentId) {
      return c.redirect(buildAdminRedirect('segmentId é obrigatório.', 'error'), 302)
    }

    const deleted = await deleteSegment(c.env, segmentId)
    if (!deleted) {
      return c.redirect(buildAdminRedirect('Segmento não encontrado.', 'error'), 302)
    }

    return c.redirect(buildAdminRedirect(`Segmento deletado: ${segmentId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao deletar segmento: ${String(error)}`, 'error'), 302)
  }
})

// API - List Segments
admin.get('/api/segments', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const segments = await listSegments(c.env)
    return c.json({ segments })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// API - Get Segment Users
admin.get('/api/segments/:segmentId/users', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const segmentId = c.req.param('segmentId')
    const users = await getUsersInSegment(c.env, segmentId)
    return c.json({ users })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// Action - Refresh User Segments
admin.post('/actions/segment/refresh', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const userId = safeString(typeof form.userId === 'string' ? form.userId : null)
    if (!userId) {
      return c.redirect(buildAdminRedirect('userId é obrigatório.', 'error'), 302)
    }

    await refreshUserSegments(c.env, userId)
    return c.redirect(buildAdminRedirect(`Segmentos atualizados para usuário: ${userId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao atualizar segmentos: ${String(error)}`, 'error'), 302)
  }
})

// --- Freezing Rules Actions ---

// Action - Create Freezing Rule
admin.post('/actions/freezing-rule/create', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const type = safeString(typeof form.type === 'string' ? form.type : null) as any
    const name = safeString(typeof form.name === 'string' ? form.name : null)
    const description = safeString(typeof form.description === 'string' ? form.description : null)
    const conditionsRaw = safeString(typeof form.conditions === 'string' ? form.conditions : null)
    const actionsRaw = safeString(typeof form.actions === 'string' ? form.actions : null)
    const priority = toNumber(typeof form.priority === 'string' ? form.priority : null) || 0

    if (!type || !name || !conditionsRaw || !actionsRaw) {
      return c.redirect(buildAdminRedirect('Tipo, nome, condições e ações são obrigatórios.', 'error'), 302)
    }

    let conditions: any[]
    let actions: any[]
    try {
      conditions = JSON.parse(conditionsRaw)
      actions = JSON.parse(actionsRaw)
    } catch {
      return c.redirect(buildAdminRedirect('Condições e ações devem ser JSON válidos.', 'error'), 302)
    }

    const rule = await createFreezingRule(c.env, type, name, conditions, actions, description || undefined, priority)
    return c.redirect(buildAdminRedirect(`Regra de congelamento criada: ${rule.id}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar regra: ${String(error)}`, 'error'), 302)
  }
})

// Action - Update Freezing Rule
admin.post('/actions/freezing-rule/update', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const ruleId = safeString(typeof form.ruleId === 'string' ? form.ruleId : null)
    const name = safeString(typeof form.name === 'string' ? form.name : null)
    const description = safeString(typeof form.description === 'string' ? form.description : null)
    const conditionsRaw = safeString(typeof form.conditions === 'string' ? form.conditions : null)
    const actionsRaw = safeString(typeof form.actions === 'string' ? form.actions : null)
    const enabled = toBoolean(typeof form.enabled === 'string' ? form.enabled : null, true)
    const priority = toNumber(typeof form.priority === 'string' ? form.priority : null)

    if (!ruleId) {
      return c.redirect(buildAdminRedirect('ruleId é obrigatório.', 'error'), 302)
    }

    const updates: any = {}
    if (name) updates.name = name
    if (description !== undefined) updates.description = description
    if (enabled !== undefined) updates.enabled = enabled
    if (!isNaN(priority)) updates.priority = priority

    if (conditionsRaw) {
      try {
        updates.conditions = JSON.parse(conditionsRaw)
      } catch {
        return c.redirect(buildAdminRedirect('Condições devem ser JSON válido.', 'error'), 302)
      }
    }

    if (actionsRaw) {
      try {
        updates.actions = JSON.parse(actionsRaw)
      } catch {
        return c.redirect(buildAdminRedirect('Ações devem ser JSON válido.', 'error'), 302)
      }
    }

    const rule = await updateFreezingRule(c.env, ruleId, updates)
    if (!rule) {
      return c.redirect(buildAdminRedirect('Regra não encontrada.', 'error'), 302)
    }

    return c.redirect(buildAdminRedirect(`Regra atualizada: ${rule.id}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao atualizar regra: ${String(error)}`, 'error'), 302)
  }
})

// Action - Delete Freezing Rule
admin.post('/actions/freezing-rule/delete', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    const form = await c.req.parseBody()
    const ruleId = safeString(typeof form.ruleId === 'string' ? form.ruleId : null)
    if (!ruleId) {
      return c.redirect(buildAdminRedirect('ruleId é obrigatório.', 'error'), 302)
    }

    const deleted = await deleteFreezingRule(c.env, ruleId)
    if (!deleted) {
      return c.redirect(buildAdminRedirect('Regra não encontrada.', 'error'), 302)
    }

    return c.redirect(buildAdminRedirect(`Regra deletada: ${ruleId}`), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao deletar regra: ${String(error)}`, 'error'), 302)
  }
})

// Action - Create Default Freezing Rules
admin.post('/actions/freezing-rule/create-defaults', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.redirect('/admin/login', 302)

  try {
    await createDefaultFreezingRules(c.env)
    return c.redirect(buildAdminRedirect('Regras padrão de congelamento criadas com sucesso.'), 302)
  } catch (error) {
    return c.redirect(buildAdminRedirect(`Falha ao criar regras padrão: ${String(error)}`, 'error'), 302)
  }
})

// API - List Freezing Rules
admin.get('/api/freezing-rules', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const type = c.req.query('type') as any
    const rules = await getFreezingRules(c.env, type)
    return c.json({ rules })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// API - AI Operational Metrics
admin.get('/api/ai/metrics', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const requestedHours = toNumber(c.req.query('hours'))
    const rangeHours = Number.isFinite(requestedHours) && requestedHours > 0 ? requestedHours : 24
    const data = await getAIInferenceOverview(c.env, rangeHours)
    return c.json({
      rangeHours: data.rangeHours,
      generatedAt: data.generatedAt,
      totals: data.totals,
      flows: data.flows,
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// API - AI Operational Alerts History
admin.get('/api/ai/alerts', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const requestedHours = toNumber(c.req.query('hours'))
    const rangeHours = Number.isFinite(requestedHours) && requestedHours > 0 ? Math.min(720, requestedHours) : 168

    const rows = await c.env.DB.prepare(
      `SELECT reason, payload, created_at
       FROM agent_decisions
       WHERE decision_type = 'ai_ops_alert'
         AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 200`
    )
      .bind(`-${Math.floor(rangeHours)} hours`)
      .all<{ reason: string; payload: string | null; created_at: string }>()

    const alerts = (rows.results ?? []).map((row) => {
      let payload: any = null
      try {
        payload = row.payload ? JSON.parse(row.payload) : null
      } catch {
        payload = null
      }

      return {
        severity: safeString(payload?.severity) ?? 'unknown',
        reason: safeString(row.reason) ?? 'AI operational alert',
        errorRate: toNumber(payload?.totals?.errorRate),
        fallbackRate: toNumber(payload?.totals?.fallbackRate),
        latencyP95Ms: toNumber(payload?.totals?.latencyP95Ms),
        total: toNumber(payload?.totals?.total),
        createdAt: safeString(row.created_at),
      }
    })

    const trendMap = new Map<string, { day: string; warning: number; critical: number; total: number }>()
    for (const alert of alerts) {
      const createdAt = safeString(alert.createdAt)
      const day = createdAt ? createdAt.slice(0, 10) : 'unknown'
      const entry = trendMap.get(day) ?? { day, warning: 0, critical: 0, total: 0 }
      const severity = safeString(alert.severity) ?? 'unknown'

      entry.total += 1
      if (severity === 'warning') entry.warning += 1
      if (severity === 'critical') entry.critical += 1

      trendMap.set(day, entry)
    }

    const trendByDay = Array.from(trendMap.values()).sort((a, b) => a.day.localeCompare(b.day))

    return c.json({
      rangeHours,
      generatedAt: new Date().toISOString(),
      alerts,
      trendByDay,
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// API - AI Operational Alerts CSV Export
admin.get('/api/ai/alerts/export.csv', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.text('Unauthorized', 401)

  try {
    const requestedHours = toNumber(c.req.query('hours'))
    const rangeHours = Number.isFinite(requestedHours) && requestedHours > 0 ? Math.min(720, requestedHours) : 168

    const rows = await c.env.DB.prepare(
      `SELECT reason, payload, created_at
       FROM agent_decisions
       WHERE decision_type = 'ai_ops_alert'
         AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 5000`
    )
      .bind(`-${Math.floor(rangeHours)} hours`)
      .all<{ reason: string; payload: string | null; created_at: string }>()

    const header = [
      'created_at',
      'severity',
      'reason',
      'error_rate',
      'fallback_rate',
      'latency_p95_ms',
      'total_inferences',
    ]

    const lines = [header.map(toCsvCell).join(',')]

    for (const row of rows.results ?? []) {
      let payload: any = null
      try {
        payload = row.payload ? JSON.parse(row.payload) : null
      } catch {
        payload = null
      }

      const line = [
        safeString(row.created_at) ?? '',
        safeString(payload?.severity) ?? 'unknown',
        safeString(row.reason) ?? 'AI operational alert',
        toNumber(payload?.totals?.errorRate),
        toNumber(payload?.totals?.fallbackRate),
        toNumber(payload?.totals?.latencyP95Ms),
        toNumber(payload?.totals?.total),
      ]
      lines.push(line.map(toCsvCell).join(','))
    }

    const csv = lines.join('\n')
    const fileName = `ai_ops_alerts_${rangeHours}h_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename=${fileName}`)
    return c.body(csv)
  } catch (error) {
    return c.text(`Export failed: ${String(error)}`, 500)
  }
})

// API - GenAI Evaluation Dataset Extraction
admin.get('/api/ai/eval-dataset/export', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.text('Unauthorized', 401)

  try {
    const format = c.req.query('format') === 'json' ? 'json' : 'csv'
    const limitParam = parseInt(c.req.query('limit') || '500', 10)
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 5000) : 500

    // Fetch journey enrollments with non-empty conversation history
    const query = `
      SELECT 
        je.journey_id,
        je.user_id,
        j.name as journey_name,
        j.persona_id,
        je.current_phase,
        je.conversation_history
      FROM journey_enrollments je
      JOIN journeys j ON je.journey_id = j.id
      WHERE je.conversation_history IS NOT NULL AND je.conversation_history != '[]'
      ORDER BY je.last_interaction_at DESC
      LIMIT ?
    `
    const rows = await c.env.DB.prepare(query).bind(limit).all()

    // Routine to strip basic PII (Emails and common Phone/CPF numbers)
    const stripPII = (text: string) => text
      .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[EMAIL_REDACTED]')
      .replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{4,5}[-.\s]?\d{4}/g, '[PHONE_REDACTED]')
      .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '[CPF_REDACTED]')

    const evalData = (rows.results ?? []).map((r: any) => {
      let rawHistory: JourneyConversationMessage[] = []
      try {
        rawHistory = JSON.parse(r.conversation_history || '[]')
      } catch {}
      
      // Build a local text transcript (ignoring system instructions for evaluation baseline focus)
      const transcriptBlock = rawHistory
        .filter((m) => m.role !== 'system')
        .map((m) => `[${m.role.toUpperCase()}]: ${stripPII(String(m.content || ''))}`)
        .join('\n')

      return {
        journey_id: String(r.journey_id),
        journey_name: String(r.journey_name),
        persona_id: String(r.persona_id),
        final_phase: String(r.current_phase),
        is_success: String(r.current_phase).toLowerCase() === 'converted' ? 1 : 0, 
        turn_count: rawHistory.length,
        transcript: transcriptBlock
      }
    })

    if (format === 'json') {
      const fileName = `eval_dataset_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
      c.header('Content-Type', 'application/json; charset=utf-8')
      c.header('Content-Disposition', `attachment; filename=${fileName}`)
      return c.body(JSON.stringify(evalData, null, 2))
    }

    // CSV format
    const header = ['journey_id', 'journey_name', 'persona_id', 'final_phase', 'is_success', 'turn_count', 'transcript']
    const lines = [header.join(',')]

    const toCsvCell = (val: any) => {
      if (val === null || val === undefined) return '""'
      const str = String(val)
      if (str.includes(',') || str.includes('\"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    evalData.forEach((row) => {
      const line = [
        row.journey_id,
        row.journey_name,
        row.persona_id,
        row.final_phase,
        row.is_success,
        row.turn_count,
        row.transcript
      ]
      lines.push(line.map(toCsvCell).join(','))
    })

    const csvOutput = lines.join('\n')
    const fileName = `eval_dataset_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename=${fileName}`)
    return c.body(csvOutput)
    
  } catch (error) {
    return c.text(`Export failed: ${String(error)}`, 500)
  }
})

// API - GenAI Evaluator (Scorecard A/B Target)
admin.post('/api/ai/eval/run', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const body = await c.req.json()
    const { promptA, promptB, transcript } = body

    if (!promptA || !transcript) {
      return c.json({ error: 'Missing promptA or transcript' }, 400)
    }

    // Run Eval A
    const evalA = await runPromptEvaluation(c.env, promptA, transcript)
    
    // Run Eval B if provided
    let evalB = null
    if (promptB) {
      evalB = await runPromptEvaluation(c.env, promptB, transcript)
    }

    return c.json({
      success: true,
      resultA: evalA,
      resultB: evalB
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// API - Get Prompt Info & History
admin.get('/api/ai/prompts/:targetId', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const targetId = c.req.param('targetId')
    
    const DEFAULT_PROMPTS: Record<string, string> = {
      'flow:generate_personalized_message': `Você é um Especialista Sênior em Copywriting de Resposta Direta e Marketing Viral atuando no Brasil.
Seu objetivo é transformar um rascunho (texto base) em uma mensagem hiper-personalizada, persuasiva e natural para o canal {{channel}}.

Contexto Analítico do Lead:
- Perfil Psicológico: {{psychological_profile}} (Mude a abordagem: pragmáticos querem dados; emocionais querem pertencimento; curiosos querem novidade).
- Engajamento: {{engagement_score}}/100 (Score baixo = use extrema urgência e gatilhos de dor rápida).
- Potencial Viral: {{viral_points}} (Se alto, crie um gatilho pedindo sutilmente para avisar outra pessoa que precise disso).

Restrições (Siga à risca):
1. Retorne APENAS a mensagem pronta para envio. Nunca inicie dizendo "Aqui está a reformulação...".
2. Limite-se a cerca de 400 caracteres para manter a retenção alta.
3. Feche com um único Call to Action (CTA) inegociável.
4. Use o português padrão (Brasil) de forma casual, como uma mensagem natural, adicionando no máximo 2 emojis.

Texto Base original a ser reescrito:
"{{baseCopy}}"`,

      'flow:simulate_persona': `Você é um formidável Consultor Digital em uma jornada de vendas e reengajamento via WhatsApp. 
Seu comportamento é 100% humanizado, empático, consultivo e focado em fazer o usuário avançar organicamente no funil AIDA.

Diretrizes de Comportamento (Sua Persona):
- Tom de Voz: Casual, respeitoso e direto. Você escreve como digita no seu próprio WhatsApp profissional. Mensagens precisas, sem blocos gigantes. Pode usar gírias muito sutis da internet ("legal", "poxa", "focado nisso").
- Odiamos "cara de bot": Nunca use formatações robóticas.
- Contexto de Memória: Você lembrará do que foi dito no resumo de conversa e usará isso para criar rapport imediato.

Atenção especial à FASE ATUAL DO FUNIL: "{{journey_phase}}"
- Se DISCOVERY: Não venda absolutamente nada. Apenas faça o lead responder à sua pergunta e expor a dor dele.
- Se INTEREST: Faça uma ponte leve entre o problema que ele narrou e mostre que existe um atalho (solução).
- Se DESIRE: Mude de marcha: mostre a prova do valor e faça-o sentir que precisa resolver isso logo validando com o seu projeto.
- Se ACTION: Envie a instrução final, o próximo passo imediato criando escassez ou urgência temporal.

Baseado no histórico do lead:
{{conversation_history}}

A mensagem enviada agora pelo Lead foi: "{{last_user_message}}"
Responda APENAS com a sua próxima fala como Consultor:`,

      'flow:journey_opening': `Você é um estrategista de Growth e reengajamento Dark Funnel (WhatsApp/Telegram).
Seu único papel é produzir uma mensagem curta de "Abertura de Conexão" que faça um lead inativo (silencioso) ser forçado psicologicamente a responder ou prestar atenção.

Regras do Quebra-Gelo:
1. Tamanho extremo: Máximo de 1 a 3 frases. Curto, seco, instigante.
2. Nenhuma "Venda": É proibido usar discursos corporativos, "Promoção", "Aproveite" ou links.
3. Abordagem estilo Amigo: Deve parecer uma mensagem esquecida de alguém lembrando de algo.
4. Hook Final: Tem que encerrar com uma pergunta interrogativa cruzada sobre o problema dele.

Contexto da quebra: "O modelo marcou esse usuário sob risco de perda (churn/inatividade)".
Ação Desejada: Chamar pelo primeiro nome (Ex: "Oi {{user_name}}") e questionar se ele ainda está enfrentando um certo problema que sua marca resolve.

Construa apenas a mensagem inicial, nada além:`
    }

    const fallbackText = DEFAULT_PROMPTS[targetId] || ''
    const history = await getPromptHistory(c.env, targetId, 15)
    
    // Load active version from history, or fallback to the hardcoded defaults
    const active = history.length > 0 
      ? { text: history[0].prompt_text, model: history[0].model } 
      : { text: fallbackText, model: '@cf/meta/llama-3-8b-instruct' }

    return c.json({ active, history })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// API - Publish New Prompt Version
admin.post('/api/ai/prompts', async (c) => {
  const unauthorized = await ensureAdminSession(c)
  if (unauthorized) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const body = await c.req.json()
    const { targetId, promptText, model, changeReason } = body

    if (!targetId || !promptText) return c.json({ error: 'Missing targetId or prompt text' }, 400)

    // The user's identity could be fetched from the session, but we use 'admin' by default right now.
    await publishPromptVersion(c.env, targetId, promptText, model || '@cf/meta/llama-3-8b-instruct', 'admin', changeReason)

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

export { admin }
