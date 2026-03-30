import type { Bindings, UserRecord } from './types'
import { resolveConsentSource } from './utils'
import { getUserById } from './db'

export function isUserOptedOut(user: UserRecord): boolean {
  if (typeof user.marketing_opt_in === 'number') return user.marketing_opt_in === 0
  if (typeof user.marketing_opt_in === 'string') {
    const parsed = Number(user.marketing_opt_in)
    return Number.isFinite(parsed) ? parsed === 0 : false
  }
  return false
}

export async function setUserMarketingConsent(
  env: Bindings,
  userId: string,
  marketingOptIn: boolean,
  consentSource: string
): Promise<{ updated: boolean; user: UserRecord | null }> {
  const existing = await getUserById(env, userId)
  if (!existing) return { updated: false, user: null }

  const normalizedSource = resolveConsentSource(consentSource, 'admin_api')
  if (marketingOptIn) {
    await env.DB.prepare(
      `UPDATE users
       SET marketing_opt_in = 1,
           opt_out_at = NULL,
           consent_source = ?,
           consent_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(normalizedSource, userId)
      .run()
  } else {
    await env.DB.prepare(
      `UPDATE users
       SET marketing_opt_in = 0,
           opt_out_at = CURRENT_TIMESTAMP,
           consent_source = ?,
           consent_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(normalizedSource, userId)
      .run()
  }

  const updated = await getUserById(env, userId)
  return { updated: true, user: updated }
}
