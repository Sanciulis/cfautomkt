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
import { Resend } from 'resend'
import type { CreateEmailOptions } from 'resend'

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
  const isDirectEmail = channel === 'email' && !!env.RESEND_API_KEY
  let dispatchUrl: string | null = null

  if (!isDirectEmail) {
    const baseDispatchUrl = resolveDispatchUrl(channel, env)
    dispatchUrl = baseDispatchUrl

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

  const emailBatchOptions: CreateEmailOptions[] = []
  const emailBatchUsers: UserRecord[] = []

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

    if (isDirectEmail) {
      const formattedMessage = message.replace(/\n/g, '<br/>')
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; line-height: 1.6;">
          <p>Olá${user.name ? ` ${user.name}` : ''},</p>
          <div style="margin: 20px 0;">
            ${formattedMessage}
          </div>
          ${referralUrl ? `<div style="margin: 30px 0;"><a href="${referralUrl}" style="display:inline-block;padding:12px 24px;background:#005f5a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Seu Link de Convite</a></div>` : ''}
          ${unsubscribeUrl ? `<hr style="border:none;border-top:1px solid #eaeaea;margin-top:40px;"/><p style="font-size:12px;color:#888;"><a href="${unsubscribeUrl}" style="color:#005f5a;">Cancelar inscrição</a></p>` : ''}
        </div>
      `

      emailBatchOptions.push({
        from: safeString(env.RESEND_DEFAULT_FROM) || 'Acme <onboarding@resend.dev>',
        to: [destination],
        subject: campaign.name,
        html: htmlContent,
        text: message + (referralUrl ? `\n\nLink: ${referralUrl}` : ''),
      })
      emailBatchUsers.push(user)
      continue
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (env.DISPATCH_BEARER_TOKEN) {
        headers.Authorization = `Bearer ${env.DISPATCH_BEARER_TOKEN}`
      }

      const response = await fetch(dispatchUrl as string, {
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

  if (isDirectEmail && emailBatchOptions.length > 0 && !dryRun) {
    const resend = new Resend(env.RESEND_API_KEY)
    
    for (let i = 0; i < emailBatchOptions.length; i += 100) {
      const chunkOptions = emailBatchOptions.slice(i, i + 100)
      const chunkUsers = emailBatchUsers.slice(i, i + 100)
      
      try {
        const result = await resend.batch.send(chunkOptions)
        
        if (result.error) {
          failedCount += chunkUsers.length
          for (const u of chunkUsers) {
            failures.push({ userId: u.id, reason: result.error.message || 'Batch failed' })
            await logInteraction(env, {
              userId: u.id,
              campaignId,
              channel,
              eventType: 'send_failed',
              metadata: { error: result.error.message },
            })
          }
        } else if (result.data?.data) {
          for (let j = 0; j < chunkUsers.length; j++) {
            const u = chunkUsers[j]
            const responseItem = result.data.data[j]
            // We assume success if we got back an ID
            if (responseItem?.id) {
              sentCount += 1
              await logInteraction(env, {
                userId: u.id,
                campaignId,
                channel,
                eventType: 'sent',
                metadata: { messageId: responseItem.id },
              })
            } else {
              failedCount += 1
              failures.push({ userId: u.id, reason: 'Email rejected' })
              await logInteraction(env, {
                userId: u.id,
                campaignId,
                channel,
                eventType: 'send_failed',
                metadata: { error: 'Rejected by Resend' },
              })
            }
          }
        }
      } catch (error) {
        failedCount += chunkUsers.length
        for (const u of chunkUsers) {
          failures.push({ userId: u.id, reason: 'Batch request failed' })
          await logInteraction(env, {
            userId: u.id,
            campaignId,
            channel,
            eventType: 'send_failed',
            metadata: { error: String(error) },
          })
        }
      }
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
