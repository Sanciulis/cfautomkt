import { Hono } from 'hono'
import type { Bindings, UserRecord } from '../types'
import { DEFAULT_LANDING_PAGE } from '../constants'
import { hashValue, buildReferralRedirect } from '../utils'
import { isUserOptedOut } from '../consent'
import { setUserMarketingConsent } from '../consent'
import { renderUnsubscribePage } from '../templates'

const publicRoutes = new Hono<{ Bindings: Bindings }>()

// Root - System Info
publicRoutes.get('/', (c) => {
  return c.json({
    name: 'Viral Marketing System',
    status: 'ok',
    env: c.env.APP_ENV ?? 'production',
  })
})

// Public Unsubscribe (LGPD opt-out)
publicRoutes.get('/unsubscribe/:code', async (c) => {
  const referralCode = c.req.param('code').trim().toLowerCase()
  if (!referralCode) {
    return c.html(
      renderUnsubscribePage({
        title: 'Link invalido',
        message: 'Nao foi possivel processar seu descadastro.',
        success: false,
      }),
      400
    )
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE referral_code = ?')
    .bind(referralCode)
    .first<UserRecord>()

  if (!user?.id) {
    return c.html(
      renderUnsubscribePage({
        title: 'Usuario nao encontrado',
        message: 'Este link de descadastro nao e valido ou expirou.',
        success: false,
      }),
      404
    )
  }

  const alreadyOptedOut = isUserOptedOut(user)
  await setUserMarketingConsent(c.env, user.id, false, 'unsubscribe_link')

  return c.html(
    renderUnsubscribePage({
      title: 'Descadastro concluido',
      message: alreadyOptedOut
        ? 'Seu contato ja estava descadastrado de comunicacoes de marketing.'
        : 'Seu contato foi removido das comunicacoes de marketing com sucesso.',
      success: true,
    })
  )
})

// Referral Tracking
publicRoutes.get('/ref/:code', async (c) => {
  const referralCode = c.req.param('code').trim().toLowerCase()
  if (!referralCode) return c.json({ error: 'Referral code is required' }, 400)

  const landingBase = c.env.LANDING_PAGE_URL ?? DEFAULT_LANDING_PAGE
  const redirectUrl = buildReferralRedirect(landingBase, referralCode)

  const referrer = await c.env.DB.prepare('SELECT id FROM users WHERE referral_code = ?')
    .bind(referralCode)
    .first<{ id: string }>()

  if (!referrer?.id) return c.redirect(redirectUrl, 302)

  const requesterIp = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const ipHash = await hashValue(requesterIp)
  const dedupeKey = `referral:${referrer.id}:${ipHash}`
  const alreadyCounted = await c.env.MARTECH_KV.get(dedupeKey)

  if (!alreadyCounted) {
    await c.env.DB.prepare(
      'INSERT INTO interactions (user_id, channel, event_type, metadata) VALUES (?, ?, ?, ?)'
    )
      .bind(referrer.id, 'whatsapp', 'referral_click', JSON.stringify({ referralCode }))
      .run()

    await c.env.DB.prepare('UPDATE users SET viral_points = viral_points + 1 WHERE id = ?')
      .bind(referrer.id)
      .run()

    await c.env.MARTECH_KV.put(dedupeKey, '1', { expirationTtl: 3600 })
  }

  return c.redirect(redirectUrl, 302)
})

export { publicRoutes }
