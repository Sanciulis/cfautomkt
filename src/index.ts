import { Hono } from 'hono'
import type { Bindings } from './types'
import { admin } from './routes/admin'
import { api } from './routes/api'
import { publicRoutes } from './routes/public'
import { runScheduledAgent } from './scheduled'

const app = new Hono<{ Bindings: Bindings }>()

// Mount route groups
app.route('/admin', admin)
app.route('/', api)
app.route('/', publicRoutes)

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
    await runScheduledAgent(env)
  },
}
