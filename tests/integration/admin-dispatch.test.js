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
    this.agentDecisions = seed.agentDecisions ?? []
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql)
  }

  async first(sql, params) {
    const normalized = normalizeSql(sql)

    if (normalized === 'select count(*) as value from users') {
      return { value: this.users.length }
    }

    if (normalized === 'select count(*) as value from interactions') {
      return { value: this.interactions.length }
    }

    if (normalized === "select count(*) as value from interactions where event_type = 'sent'") {
      return {
        value: this.interactions.filter((interaction) => interaction.event_type === 'sent').length,
      }
    }

    if (normalized === "select count(*) as value from interactions where event_type = 'converted'") {
      return {
        value: this.interactions.filter((interaction) => interaction.event_type === 'converted').length,
      }
    }

    if (
      normalized ===
      "select count(*) as value from interactions where event_type in ('shared', 'referral_click')"
    ) {
      return {
        value: this.interactions.filter(
          (interaction) =>
            interaction.event_type === 'shared' || interaction.event_type === 'referral_click'
        ).length,
      }
    }

    if (normalized === "select count(*) as value from campaigns where status = 'active'") {
      return { value: this.campaigns.filter((campaign) => campaign.status === 'active').length }
    }

    if (normalized.startsWith('select * from campaigns where id = ?')) {
      const [campaignId] = params
      return this.campaigns.find((campaign) => campaign.id === campaignId) ?? null
    }

    if (normalized.startsWith('select * from users where id = ?')) {
      const [userId] = params
      return this.users.find((user) => user.id === userId) ?? null
    }

    if (normalized.startsWith('select * from users where referral_code = ?')) {
      const [referralCode] = params
      return this.users.find((user) => user.referral_code === referralCode) ?? null
    }

    throw new Error(`Unhandled first() query in test mock: ${sql}`)
  }

  async all(sql, params) {
    const normalized = normalizeSql(sql)

    if (
      normalized ===
      'select id, name, channel, status, updated_at from campaigns order by updated_at desc limit 30'
    ) {
      return [...this.campaigns]
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(0, 30)
        .map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          channel: campaign.channel,
          status: campaign.status,
          updated_at: campaign.updated_at,
        }))
    }

    if (
      normalized ===
      'select decision_type, target_id, reason, created_at from agent_decisions order by created_at desc limit 20'
    ) {
      return [...this.agentDecisions]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 20)
    }

    if (
      normalized ===
      'select id, viral_points from users where viral_points > 0 order by viral_points desc limit 5'
    ) {
      return this.users
        .filter((user) => Number(user.viral_points) > 0)
        .sort((a, b) => Number(b.viral_points) - Number(a.viral_points))
        .slice(0, 5)
        .map((user) => ({ id: user.id, viral_points: user.viral_points }))
    }

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

    if (normalized.startsWith('update users set marketing_opt_in = 1,')) {
      const [source, userId] = params
      const user = this.users.find((row) => row.id === userId)
      if (user) {
        user.marketing_opt_in = 1
        user.opt_out_at = null
        user.consent_source = source
        user.consent_updated_at = '2026-03-29 00:00:00'
      }
      return
    }

    if (normalized.startsWith('update users set marketing_opt_in = 0,')) {
      const [source, userId] = params
      const user = this.users.find((row) => row.id === userId)
      if (user) {
        user.marketing_opt_in = 0
        user.opt_out_at = '2026-03-29 00:00:00'
        user.consent_source = source
        user.consent_updated_at = '2026-03-29 00:00:00'
      }
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

function extractCookieHeader(setCookieValue) {
  return (setCookieValue ?? '').split(';')[0] ?? ''
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
        marketing_opt_in: 1,
        opt_out_at: null,
        consent_source: 'seed',
        consent_updated_at: '2026-03-28 00:00:00',
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

  it('renders WhatsApp integration form in admin dashboard', async () => {
    const env = createMockEnv()
    const loginResponse = await invokeWorker(
      '/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=test-admin-password',
      },
      env
    )
    const cookie = extractCookieHeader(loginResponse.headers.get('set-cookie'))

    const response = await invokeWorker(
      '/admin',
      {
        method: 'GET',
        headers: { Cookie: cookie },
      },
      env
    )

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Menu admin')
    expect(html).toContain('href="#integracao"')
    expect(html).toContain('href="#integracao-teste"')
    expect(html).toContain('/admin/actions/integration/save')
    expect(html).toContain('/admin/actions/integration/test')
    expect(html).toContain('Configuracao WhatsApp')
    expect(html).toContain('Teste da Integracao WhatsApp')
  })

  it('saves WhatsApp integration config via admin form', async () => {
    const env = createMockEnv()
    const loginResponse = await invokeWorker(
      '/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=test-admin-password',
      },
      env
    )
    const cookie = extractCookieHeader(loginResponse.headers.get('set-cookie'))

    const saveResponse = await invokeWorker(
      '/admin/actions/integration/save',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookie,
        },
        body:
          'webhookUrl=https%3A%2F%2Fwa.example.com%2Fdispatch%2Fwhatsapp&testPhone=%2B5511999990001&testMessage=Ping+admin',
      },
      env
    )

    expect(saveResponse.status).toBe(302)
    expect(saveResponse.headers.get('location')).toContain('/admin?')

    const storedRaw = await env.MARTECH_KV.get('admin_config:integration:whatsapp')
    expect(storedRaw).toBeTruthy()
    const stored = JSON.parse(storedRaw)
    expect(stored.webhookUrl).toBe('https://wa.example.com/dispatch/whatsapp')
    expect(stored.testPhone).toBe('+5511999990001')
    expect(stored.testMessage).toBe('Ping admin')
    expect(typeof stored.updatedAt).toBe('string')
  })

  it('runs WhatsApp integration test from admin panel', async () => {
    const env = createMockEnv()
    const loginResponse = await invokeWorker(
      '/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=test-admin-password',
      },
      env
    )
    const cookie = extractCookieHeader(loginResponse.headers.get('set-cookie'))

    const calls = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init })
      return new Response(JSON.stringify({ status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const testResponse = await invokeWorker(
        '/admin/actions/integration/test',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookie,
          },
          body:
            'webhookUrl=https%3A%2F%2Fwa.example.com%2Fdispatch%2Fwhatsapp&testPhone=%2B5511999990001&testMessage=Mensagem+de+teste',
        },
        env
      )

      expect(testResponse.status).toBe(302)
      expect(testResponse.headers.get('location')).toContain('/admin?')
      expect(calls.length).toBe(1)
      expect(calls[0].input).toBe('https://wa.example.com/dispatch/whatsapp')
      expect(calls[0].init?.method).toBe('POST')
      expect(calls[0].init?.headers?.Authorization).toBe('Bearer dispatch-token')
    } finally {
      globalThis.fetch = originalFetch
    }
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

  it('updates consent via admin API and skips opted-out user in dispatch', async () => {
    const db = createDispatchDbSeed()
    const env = createMockEnv({ DB: db })

    const consentResponse = await invokeWorker(
      '/user/u-001/consent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-admin-api-key',
        },
        body: JSON.stringify({
          marketingOptIn: false,
          source: 'admin_test',
        }),
      },
      env
    )

    expect(consentResponse.status).toBe(200)
    const consentPayload = await consentResponse.json()
    expect(consentPayload.user).toMatchObject({
      id: 'u-001',
      marketingOptIn: false,
      consentSource: 'admin_test',
    })

    const dispatchResponse = await invokeWorker(
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
          userIds: ['u-001'],
        }),
      },
      env
    )

    expect(dispatchResponse.status).toBe(200)
    const dispatchPayload = await dispatchResponse.json()
    expect(dispatchPayload.sent).toBe(0)
    expect(dispatchPayload.skipped).toBe(1)
    expect(dispatchPayload.failures[0].reason).toContain('opted out')
  })

  it('supports public unsubscribe route using referral code', async () => {
    const db = createDispatchDbSeed()
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker('/unsubscribe/ana123', { method: 'GET' }, env)
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain('Descadastro concluido')

    const updatedUser = db.users.find((user) => user.id === 'u-001')
    expect(updatedUser?.marketing_opt_in).toBe(0)
    expect(updatedUser?.consent_source).toBe('unsubscribe_link')
  })
})
