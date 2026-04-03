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
    this.journeys = seed.journeys ?? []
    this.personas = seed.personas ?? []
    this.products = seed.products ?? []
    this.journeyEnrollments = seed.journeyEnrollments ?? []
  }

  hydrateJourney(journey) {
    if (!journey) return null
    const persona = this.personas.find((p) => p.id === journey.persona_id)
    const product = this.products.find((p) => p.id === journey.product_id)
    return {
      ...journey,
      persona_name: persona?.name ?? null,
      system_prompt: persona?.system_prompt ?? null,
      base_tone: persona?.base_tone ?? null,
      product_name: product?.name ?? null,
      objective: product?.description ?? null,
      conversion_url: product?.conversion_url ?? null,
    }
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
      return { value: this.interactions.filter((i) => i.event_type === 'sent').length }
    }

    if (normalized === "select count(*) as value from interactions where event_type = 'converted'") {
      return { value: this.interactions.filter((i) => i.event_type === 'converted').length }
    }

    if (normalized === "select count(*) as value from interactions where event_type in ('shared', 'referral_click')") {
      return { value: this.interactions.filter((i) => i.event_type === 'shared' || i.event_type === 'referral_click').length }
    }

    if (normalized === "select count(*) as value from campaigns where status = 'active'") {
      return { value: this.campaigns.filter((c) => c.status === 'active').length }
    }

    if (
      normalized.includes(
        'from journeys j left join personas pe on j.persona_id = pe.id left join products pr on j.product_id = pr.id where j.id = ?'
      )
    ) {
      const [id] = params
      const journey = this.journeys.find((j) => j.id === id)
      return this.hydrateJourney(journey)
    }

    if (normalized.startsWith('select * from journeys where id = ?')) {
      const [id] = params
      return this.journeys.find((j) => j.id === id) ?? null
    }

    if (normalized.startsWith('select * from journey_enrollments where user_id = ? and journey_id = ?')) {
      const [userId, journeyId] = params
      return this.journeyEnrollments.find(
        (e) => e.user_id === userId && e.journey_id === journeyId
      ) ?? null
    }

    if (normalized.startsWith('select * from users where id = ?')) {
      const [userId] = params
      return this.users.find((u) => u.id === userId) ?? null
    }

    throw new Error(`[Journey test] Unhandled first() query: ${sql}`)
  }

  async all(sql, params) {
    const normalized = normalizeSql(sql)

    if (
      normalized.includes(
        'from journeys j left join personas pe on j.persona_id = pe.id left join products pr on j.product_id = pr.id order by j.created_at desc limit 50'
      )
    ) {
      return [...this.journeys]
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
        .slice(0, 50)
        .map((journey) => this.hydrateJourney(journey))
    }

    if (normalized === 'select * from journeys order by created_at desc limit 50') {
      return [...this.journeys].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, 50)
    }

    if (normalized.startsWith('select * from journey_enrollments where journey_id = ?')) {
      const [journeyId] = params
      return this.journeyEnrollments.filter((e) => e.journey_id === journeyId)
    }

    if (normalized === 'select id, viral_points from users where viral_points > 0 order by viral_points desc limit 5') {
      return this.users.filter((u) => Number(u.viral_points) > 0).sort((a, b) => b.viral_points - a.viral_points).slice(0, 5).map((u) => ({ id: u.id, viral_points: u.viral_points }))
    }

    if (normalized === 'select id, name, channel, status, updated_at from campaigns order by updated_at desc limit 30') {
      return [...this.campaigns].slice(0, 30)
    }

    if (normalized === 'select decision_type, target_id, reason, created_at from agent_decisions order by created_at desc limit 20') {
      return [...this.agentDecisions].slice(0, 20)
    }

    if (normalized === 'select id, name, email, phone, preferred_channel, created_at from users order by created_at desc limit 50') {
      return [...this.users].slice(0, 50)
    }

    throw new Error(`[Journey test] Unhandled all() query: ${sql}`)
  }

  run(sql, params) {
    const normalized = normalizeSql(sql)

    if (normalized.startsWith('insert into personas')) {
      this.personas.push({
        id: params[0],
        name: params[1],
        base_tone: params[2],
        system_prompt: params[3],
        interaction_constraints: params[4],
        created_at: new Date().toISOString(),
      })
      return
    }

    if (normalized.startsWith('insert into products')) {
      this.products.push({
        id: params[0],
        name: params[1],
        description: params[2],
        pricing_details: params[3],
        conversion_url: params[4],
        metadata: params[5],
        created_at: new Date().toISOString(),
      })
      return
    }

    if (normalized.startsWith('insert into journeys')) {
      this.journeys.push({
        id: params[0],
        name: params[1],
        persona_id: params[2],
        product_id: params[3],
        status: 'active',
        created_at: new Date().toISOString(),
      })
      return
    }

    if (normalized.startsWith('insert into journey_enrollments')) {
      // Handle ON CONFLICT - check if exists
      const existing = this.journeyEnrollments.find(
        (e) => e.user_id === params[0] && e.journey_id === params[1]
      )
      if (existing) {
        existing.current_phase = params[2]
        existing.last_interaction_at = new Date().toISOString()
      } else {
        this.journeyEnrollments.push({
          user_id: params[0],
          journey_id: params[1],
          current_phase: params[2],
          conversation_history: params[3],
          last_interaction_at: new Date().toISOString(),
        })
      }
      return
    }

    if (normalized.startsWith('update journeys set status = ?')) {
      const [status, journeyId] = params
      const j = this.journeys.find((j) => j.id === journeyId)
      if (j) j.status = status
      return
    }

    if (normalized.startsWith('update journey_enrollments')) {
      if (normalized.includes('set current_phase = ?')) {
        const [phase, userId, journeyId] = params
        const e = this.journeyEnrollments.find(
          (e) => e.user_id === userId && e.journey_id === journeyId
        )
        if (e) {
          e.current_phase = phase
          e.last_interaction_at = new Date().toISOString()
        }
      }
      if (normalized.includes('set conversation_history = ?')) {
        const [history, userId, journeyId] = params
        const e = this.journeyEnrollments.find(
          (e) => e.user_id === userId && e.journey_id === journeyId
        )
        if (e) {
          e.conversation_history = history
          e.last_interaction_at = new Date().toISOString()
        }
      }
      return
    }

    if (normalized.startsWith('update journeys set name = ?, persona_id = ?, product_id = ? where id = ?')) {
      const [name, personaId, productId, journeyId] = params
      const j = this.journeys.find((j) => j.id === journeyId)
      if (j) {
        j.name = name
        j.persona_id = personaId
        j.product_id = productId
      }
      return
    }

    if (normalized.startsWith('insert into agent_decisions')) {
      this.agentDecisions.push({
        decision_type: params[0],
        target_id: params[1],
        reason: params[2],
        payload: params[3],
        created_at: new Date().toISOString(),
      })
      return
    }

    if (normalized.startsWith('insert into interactions')) {
      this.interactions.push({
        user_id: params[0],
        campaign_id: params[1],
        channel: params[2],
        event_type: params[3],
        metadata: params[4],
      })
      return
    }

    if (normalized.startsWith('insert into ai_inference_logs')) {
      return
    }

    if (normalized.startsWith('update users set engagement_score')) {
      return
    }

    throw new Error(`[Journey test] Unhandled run() query: ${sql}`)
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

function createExecutionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  }
}

function createMockEnv(seed = {}) {
  return {
    DB: seed.DB ?? new MockD1Database(),
    MARTECH_KV: seed.MARTECH_KV ?? new MockKVNamespace(),
    AI: seed.AI ?? { run: async () => ({ response: 'Opa, tudo bem? Que legal que você se interessou!' }) },
    ADMIN_API_KEY: 'test-api-key',
    ADMIN_PANEL_PASSWORD: 'test-admin-password',
    ADMIN_SESSION_SECRET: 'test-session-secret',
    APP_ENV: 'preview',
    ...seed,
  }
}

async function invokeWorker(path, init, env) {
  const request = new Request(`https://unit.test${path}`, init)
  return worker.fetch(request, env, createExecutionContext())
}

function createJourneyDbSeed() {
  return new MockD1Database({
    personas: [
      {
        id: 'persona-onboarding',
        name: 'Ana Consultora',
        base_tone: 'consultiva',
        system_prompt: 'Você é a Ana, consultora de marketing com 5 anos de experiência.',
        interaction_constraints: null,
        created_at: '2026-03-30 00:00:00',
      },
    ],
    products: [
      {
        id: 'product-onboarding',
        name: 'Programa Premium',
        description: 'Converter leads frios em clientes pagantes',
        pricing_details: null,
        conversion_url: null,
        metadata: null,
        created_at: '2026-03-30 00:00:00',
      },
    ],
    users: [
      {
        id: 'u-lead-001',
        name: 'Carlos',
        email: 'carlos@example.com',
        phone: '+5511999990001',
        preferred_channel: 'whatsapp',
        psychological_profile: 'empreendedor',
        engagement_score: 5.0,
        referral_code: 'carlos123',
        referred_by: null,
        viral_points: 0,
        marketing_opt_in: 1,
        last_active: '2026-03-31 00:00:00',
        created_at: '2026-03-30 00:00:00',
      },
    ],
    journeys: [
      {
        id: 'j-onboarding',
        name: 'Onboarding Premium',
        persona_id: 'persona-onboarding',
        product_id: 'product-onboarding',
        status: 'active',
        created_at: '2026-03-30 00:00:00',
      },
    ],
    journeyEnrollments: [
      {
        user_id: 'u-lead-001',
        journey_id: 'j-onboarding',
        current_phase: 'discovery',
        conversation_history: '[]',
        last_interaction_at: '2026-03-30 00:00:00',
      },
    ],
  })
}

describe('Integration: Journey API', () => {
  it('creates a journey via API', async () => {
    const env = createMockEnv()

    const response = await invokeWorker(
      '/journey',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-api-key',
        },
        body: JSON.stringify({
          id: 'j-test-001',
          name: 'Test Journey',
          objective: 'Test conversion flow',
          systemPrompt: 'You are a friendly consultant.',
        }),
      },
      env
    )

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.status).toBe('success')
    expect(payload.journeyId).toBe('j-test-001')

    // Verify it was saved
    expect(env.DB.journeys).toHaveLength(1)
    expect(env.DB.journeys[0].name).toBe('Test Journey')
  })

  it('lists journeys via API', async () => {
    const db = createJourneyDbSeed()
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journeys',
      {
        method: 'GET',
        headers: { 'x-api-key': 'test-api-key' },
      },
      env
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.journeys).toHaveLength(1)
    expect(payload.journeys[0].name).toBe('Onboarding Premium')
  })

  it('gets a journey by ID via API', async () => {
    const db = createJourneyDbSeed()
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journey/j-onboarding',
      {
        method: 'GET',
        headers: { 'x-api-key': 'test-api-key' },
      },
      env
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.name).toBe('Onboarding Premium')
    expect(payload.status).toBe('active')
  })

  it('returns 404 for non-existent journey', async () => {
    const env = createMockEnv()

    const response = await invokeWorker(
      '/journey/non-existent',
      {
        method: 'GET',
        headers: { 'x-api-key': 'test-api-key' },
      },
      env
    )

    expect(response.status).toBe(404)
  })

  it('enrolls a user in a journey via API', async () => {
    const db = createJourneyDbSeed()
    // Remove existing enrollment for this test
    db.journeyEnrollments = []
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journey/j-onboarding/enroll',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-api-key',
        },
        body: JSON.stringify({ userId: 'u-lead-001' }),
      },
      env
    )

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.status).toBe('success')
    expect(payload.enrollment.current_phase).toBe('discovery')
    expect(db.journeyEnrollments).toHaveLength(1)
  })

  it('advances journey phase via API', async () => {
    const db = createJourneyDbSeed()
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journey/j-onboarding/user/u-lead-001/advance',
      {
        method: 'POST',
        headers: { 'x-api-key': 'test-api-key' },
      },
      env
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.status).toBe('success')
    expect(payload.advanced).toBe(true)
    expect(payload.newPhase).toBe('interest')
    expect(payload.completed).toBe(false)

    // Verify enrollment was updated
    const enrollment = db.journeyEnrollments[0]
    expect(enrollment.current_phase).toBe('interest')
  })

  it('toggles journey status via API', async () => {
    const db = createJourneyDbSeed()
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journey/j-onboarding/toggle',
      {
        method: 'POST',
        headers: { 'x-api-key': 'test-api-key' },
      },
      env
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.newStatus).toBe('paused')
    expect(db.journeys[0].status).toBe('paused')
  })

  it('sends a chat message and gets persona AI response', async () => {
    const db = createJourneyDbSeed()
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journey/j-onboarding/user/u-lead-001/chat',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-api-key',
        },
        body: JSON.stringify({ message: 'Olá, me conta mais sobre isso?' }),
      },
      env
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.status).toBe('success')
    expect(typeof payload.response).toBe('string')
    expect(payload.response.length).toBeGreaterThan(0)
    // "me conta mais" triggers interest signal in discovery phase
    expect(payload.phaseAdvanced).toBe(true)
    expect(payload.currentPhase).toBe('interest')
  })

  it('rejects chat for non-enrolled user', async () => {
    const db = createJourneyDbSeed()
    db.journeyEnrollments = [] // no enrollments
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journey/j-onboarding/user/u-lead-001/chat',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-api-key',
        },
        body: JSON.stringify({ message: 'Olá!' }),
      },
      env
    )

    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload.error).toContain('not enrolled')
  })

  it('generates opening message for a journey', async () => {
    const db = createJourneyDbSeed()
    const env = createMockEnv({ DB: db })

    const response = await invokeWorker(
      '/journey/j-onboarding/user/u-lead-001/open',
      {
        method: 'POST',
        headers: { 'x-api-key': 'test-api-key' },
      },
      env
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.status).toBe('success')
    expect(typeof payload.message).toBe('string')
    expect(payload.message.length).toBeGreaterThan(0)
  })

  it('requires API key for journey endpoints', async () => {
    const env = createMockEnv()

    const response = await invokeWorker(
      '/journeys',
      { method: 'GET' },
      env
    )

    expect(response.status).toBe(401)
  })
})
