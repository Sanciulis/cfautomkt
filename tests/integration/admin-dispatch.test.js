import { describe, it, expect } from 'vitest'
import worker from '../../src/index.ts'

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

class MockPreparedStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.params = []
  }

  bind(...params) {
    this.params = params
    return this
  }

  async first() {
    return this.db.first(this.sql, this.params)
  }

  async all() {
    const results = await this.db.all(this.sql, this.params)
    return { results }
  }

  async run() {
    this.db.run(this.sql, this.params)
    return { success: true, meta: {} }
  }
}

class MockD1Database {
  constructor(seed = {}) {
    this.campaigns = seed.campaigns ?? []
    this.users = seed.users ?? []
    this.interactions = seed.interactions ?? []
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql)
  }

  async first(sql, params) {
    const normalized = normalizeSql(sql)

    if (normalized.startsWith('select * from campaigns where id = ?')) {
      const [campaignId] = params
      return this.campaigns.find((campaign) => campaign.id === campaignId) ?? null
    }

    if (normalized.startsWith('select * from users where id = ?')) {
      const [userId] = params
      return this.users.find((user) => user.id === userId) ?? null
    }

    throw new Error(`Unhandled first() query in test mock: ${sql}`)
  }

  async all(sql, params) {
    const normalized = normalizeSql(sql)

    if (normalized.includes('select * from users where id in (') && normalized.endsWith('limit ?')) {
      const limit = Number(params[params.length - 1]) || 0
      const ids = params.slice(0, Math.max(0, params.length - 1))
      return this.users.filter((user) => ids.includes(user.id)).slice(0, limit)
    }

    if (
      normalized ===
      "select * from users where preferred_channel = ? and last_active >= datetime('now', '-30 days') order by engagement_score desc limit ?"
    ) {
      const [channel, limitRaw] = params
      const limit = Number(limitRaw) || 0
      return this.users
        .filter((user) => user.preferred_channel === channel)
        .sort((a, b) => b.engagement_score - a.engagement_score)
        .slice(0, limit)
    }

    if (
      normalized === 'select * from users where preferred_channel = ? order by engagement_score desc limit ?'
    ) {
      const [channel, limitRaw] = params
      const limit = Number(limitRaw) || 0
      return this.users
        .filter((user) => user.preferred_channel === channel)
        .sort((a, b) => b.engagement_score - a.engagement_score)
        .slice(0, limit)
    }

    throw new Error(`Unhandled all() query in test mock: ${sql}`)
  }

  run(sql, params) {
    const normalized = normalizeSql(sql)

    if (normalized.startsWith('insert into interactions')) {
      this.interactions.push({
        user_id: params[0] ?? null,
        campaign_id: params[1] ?? null,
        channel: params[2] ?? null,
        event_type: params[3] ?? null,
        metadata: params[4] ?? null,
      })
      return
    }

    if (normalized.startsWith('update users set engagement_score = engagement_score + ?')) {
      const [weightRaw, userId] = params
      const weight = Number(weightRaw) || 0
      const user = this.users.find((row) => row.id === userId)
      if (user) user.engagement_score += weight
      return
    }

    throw new Error(`Unhandled run() query in test mock: ${sql}`)
  }
}

class MockKVNamespace {
  constructor() {
    this.store = new Map()
  }

  async get(key) {
    const record = this.store.get(key)
    if (!record) return null
    if (record.expiresAt !== null && Date.now() > record.expiresAt) {
      this.store.delete(key)
      return null
    }
    return record.value
  }

  async put(key, value, options) {
    const ttlSeconds = options?.expirationTtl
    const expiresAt =
      typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds)
        ? Date.now() + ttlSeconds * 1000
        : null
    this.store.set(key, { value, expiresAt })
  }

  async delete(key) {
    this.store.delete(key)
  }
}

function createMockEnv(seed = {}) {
  return {
    DB:
      seed.DB ??
      new MockD1Database({
        campaigns: [],
        users: [],
      }),
    MARTECH_KV: seed.MARTECH_KV ?? new MockKVNamespace(),
    AI: seed.AI ?? { run: async () => ({ response: 'Mensagem mock' }) },
    LANDING_PAGE_URL: 'https://preview.fluxoia.com/inscricao',
    APP_ENV: 'preview',
    DISPATCH_WEBHOOK_URL: 'https://preview-api.fluxoia.com/webhooks/dispatch',
    PREVIEW_WEBHOOK_OVERRIDE_ALLOWLIST: 'httpbin.org',
    WHATSAPP_WEBHOOK_URL: 'https://preview-api.fluxoia.com/webhooks/dispatch/whatsapp',
    EMAIL_WEBHOOK_URL: 'https://preview-api.fluxoia.com/webhooks/dispatch/email',
    TELEGRAM_WEBHOOK_URL: 'https://preview-api.fluxoia.com/webhooks/dispatch/telegram',
    DISPATCH_BEARER_TOKEN: 'dispatch-token',
    ADMIN_API_KEY: 'test-admin-api-key',
    ADMIN_PANEL_PASSWORD: 'test-admin-password',
    ADMIN_SESSION_SECRET: 'test-session-secret',
    ...seed,
  }
}

function createExecutionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  }
}

async function invokeWorker(path, init, env) {
  const request = new Request(`https://unit.test${path}`, init)
  return worker.fetch(request, env, createExecutionContext())
}

function createDispatchDbSeed() {
  return new MockD1Database({
    campaigns: [
      {
        id: 'cmp-001',
        name: 'Campanha Teste',
        base_copy: 'Oferta limitada hoje',
        incentive_offer: null,
        channel: 'whatsapp',
        status: 'active',
        updated_at: '2026-03-29 00:00:00',
      },
    ],
    users: [
      {
        id: 'u-001',
        name: 'Ana',
        email: 'ana@example.com',
        phone: '+5511999990001',
        preferred_channel: 'whatsapp',
        psychological_profile: 'generic',
        engagement_score: 3.5,
        referral_code: 'ana123',
        referred_by: null,
        viral_points: 0,
        last_active: '2026-03-29 00:00:00',
        created_at: '2026-03-28 00:00:00',
      },
    ],
  })
}

describe('Integration: admin login and campaign dispatch', () => {
  it('creates admin session cookie after valid login', async () => {
    const env = createMockEnv()
    const response = await invokeWorker(
      '/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=test-admin-password',
      },
      env
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/admin')
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('martech_admin_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
  })

  it('blocks repeated failed admin logins with HTTP 429', async () => {
    const env = createMockEnv()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await invokeWorker(
        '/admin/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'password=wrong-password',
        },
        env
      )
      expect(response.status).toBe(401)
    }

    const blockedResponse = await invokeWorker(
      '/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=wrong-password',
      },
      env
    )

    expect(blockedResponse.status).toBe(429)
    expect(blockedResponse.headers.get('Retry-After')).toBeTruthy()
  })

  it('allows preview webhook override for allowlisted host', async () => {
    const env = createMockEnv({
      DB: createDispatchDbSeed(),
    })

    const response = await invokeWorker(
      '/campaign/cmp-001/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-admin-api-key',
        },
        body: JSON.stringify({
          dryRun: true,
          personalize: false,
          includeInactive: true,
          webhookUrlOverride: 'https://httpbin.org/post',
        }),
      },
      env
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({
      status: 'success',
      campaignId: 'cmp-001',
      channel: 'whatsapp',
      sent: 1,
      failed: 0,
      skipped: 0,
    })
  })

  it('rejects preview webhook override for non-allowlisted host', async () => {
    const env = createMockEnv({
      DB: createDispatchDbSeed(),
    })

    const response = await invokeWorker(
      '/campaign/cmp-001/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-admin-api-key',
        },
        body: JSON.stringify({
          dryRun: true,
          personalize: false,
          includeInactive: true,
          webhookUrlOverride: 'https://example.com/hook',
        }),
      },
      env
    )

    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toContain('allowlisted')
  })
})
