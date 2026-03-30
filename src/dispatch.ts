import type {
  Bindings,
  UserRecord,
  CampaignRecord,
  DispatchRequestBody,
  DispatchResult,
  DispatchErrorStatus,
} from './types'
import { DEFAULT_AI_MODEL } from './constants'
import { safeString, toNumber, toBoolean, resolveDispatchUrl, validatePreviewWebhookOverrideUrl } from './utils'
import { logInteraction } from './db'
import { isUserOptedOut } from './consent'
import { generatePersonalizedMessage } from './ai'

export async function executeCampaignDispatch(
  env: Bindings,
  campaignId: string,
  body: DispatchRequestBody,
  requestOrigin: string
): Promise<{ ok: true; data: DispatchResult } | { ok: false; status: DispatchErrorStatus; error: string }> {
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
    .bind(campaignId)
    .first<CampaignRecord>()

  if (!campaign) return { ok: false, status: 404, error: 'Campaign not found' }

  const force = toBoolean(body.force, false)
  if (campaign.status === 'paused' && !force) {
    return { ok: false, status: 409, error: 'Campaign is paused. Use force=true to dispatch anyway.' }
  }

  const channel = (safeString(body.channel) ?? campaign.channel ?? 'whatsapp').toLowerCase()
  const baseDispatchUrl = resolveDispatchUrl(channel, env)
  let dispatchUrl = baseDispatchUrl

  const overrideUrl = safeString(body.webhookUrlOverride)
  if ((env.APP_ENV ?? '').toLowerCase() === 'preview' && overrideUrl) {
    const overrideValidation = validatePreviewWebhookOverrideUrl(overrideUrl, env)
    if (!overrideValidation.ok) {
      return { ok: false, status: 400, error: overrideValidation.error }
    }
    dispatchUrl = overrideValidation.normalizedUrl
  }

  if (!dispatchUrl) {
    return { ok: false, status: 500, error: 'Dispatch webhook URL is not configured for this channel.' }
  }

  const limit = Math.min(Math.max(toNumber(body.limit) || 100, 1), 500)
  const personalize = toBoolean(body.personalize, true)
  const dryRun = toBoolean(body.dryRun, false)
  const includeInactive = toBoolean(body.includeInactive, false)
  const requestedUserIds = Array.isArray(body.userIds)
    ? body.userIds.map((id) => safeString(id)).filter((id): id is string => Boolean(id))
    : []

  let users: UserRecord[] = []
  if (requestedUserIds.length > 0) {
    const placeholders = requestedUserIds.map(() => '?').join(', ')
    const query = `SELECT * FROM users WHERE id IN (${placeholders}) LIMIT ?`
    const usersResult = await env.DB.prepare(query).bind(...requestedUserIds, limit).all<UserRecord>()
    users = usersResult.results
  } else {
    const query = includeInactive
      ? 'SELECT * FROM users WHERE preferred_channel = ? ORDER BY engagement_score DESC LIMIT ?'
      : "SELECT * FROM users WHERE preferred_channel = ? AND last_active >= datetime('now', '-30 days') ORDER BY engagement_score DESC LIMIT ?"
    const usersResult = await env.DB.prepare(query).bind(channel, limit).all<UserRecord>()
    users = usersResult.results
  }

  if (users.length === 0) {
    return {
      ok: true,
      data: {
        status: 'success',
        campaignId,
        channel,
        dryRun,
        requested: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        failures: [],
      },
    }
  }

  let sentCount = 0
  let failedCount = 0
  let skippedCount = 0
  const failures: Array<{ userId: string; reason: string; status?: number }> = []

  for (const user of users) {
    if (isUserOptedOut(user)) {
      skippedCount += 1
      const reason = 'User opted out of marketing communications'
      failures.push({ userId: user.id, reason })
      await logInteraction(env, {
        userId: user.id,
        campaignId,
        channel,
        eventType: 'send_failed',
        metadata: { reason, stage: 'consent' },
      })
      continue
    }

    const destination = channel === 'email' ? user.email : user.phone
    if (!destination) {
      skippedCount += 1
      const reason = `Missing destination for channel ${channel}`
      failures.push({ userId: user.id, reason })
      await logInteraction(env, {
        userId: user.id,
        campaignId,
        channel,
        eventType: 'send_failed',
        metadata: { reason, stage: 'validation' },
      })
      continue
    }

    let message = campaign.base_copy
    if (personalize) {
      try {
        message = await generatePersonalizedMessage(env, user, campaign.base_copy, channel)
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'personalized',
          metadata: { model: DEFAULT_AI_MODEL, source: 'campaign_dispatch' },
        })
      } catch (error) {
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'send_failed',
          metadata: { reason: 'Personalization failed, fallback to base copy', error: String(error) },
        })
      }
    }

    const referralUrl = user.referral_code
      ? `${requestOrigin}/ref/${encodeURIComponent(user.referral_code)}`
      : null
    const unsubscribeUrl = user.referral_code
      ? `${requestOrigin}/unsubscribe/${encodeURIComponent(user.referral_code)}`
      : null

    const payload = {
      channel,
      campaign: {
        id: campaign.id,
        name: campaign.name,
      },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        preferredChannel: user.preferred_channel,
      },
      message,
      referralUrl,
      unsubscribeUrl,
      metadata: body.metadata ?? null,
    }

    if (dryRun) {
      sentCount += 1
      continue
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (env.DISPATCH_BEARER_TOKEN) {
        headers.Authorization = `Bearer ${env.DISPATCH_BEARER_TOKEN}`
      }

      const response = await fetch(dispatchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      const responseBody = await response.text()
      const responsePreview = responseBody.slice(0, 500)

      if (response.ok) {
        sentCount += 1
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'sent',
          metadata: {
            statusCode: response.status,
            responsePreview,
          },
        })
      } else {
        failedCount += 1
        failures.push({ userId: user.id, reason: 'Dispatch webhook returned error', status: response.status })
        await logInteraction(env, {
          userId: user.id,
          campaignId,
          channel,
          eventType: 'send_failed',
          metadata: {
            statusCode: response.status,
            responsePreview,
          },
        })
      }
    } catch (error) {
      failedCount += 1
      failures.push({ userId: user.id, reason: 'Dispatch request failed' })
      await logInteraction(env, {
        userId: user.id,
        campaignId,
        channel,
        eventType: 'send_failed',
        metadata: { error: String(error) },
      })
    }
  }

  return {
    ok: true,
    data: {
      status: 'success',
      campaignId,
      channel,
      dryRun,
      requested: users.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
      failures: failures.slice(0, 25),
    },
  }
}
