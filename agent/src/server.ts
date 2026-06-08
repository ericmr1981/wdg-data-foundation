// agent/src/server.ts
// Agent Service 完整入口 — 接所有模块
import Fastify from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'

import { getPool } from './db'
import { getAgentConfig } from './config/store'
import { initRegistry } from './skills/registry'
import { McpBridge } from './mcp/bridge'
import { ConversationManager } from './conversation/manager'
import { AgentRunner } from './agent/runner'
import { NullNotifier } from './notifications/notifier'
import { WebChannel } from './channels/web'
import { CronChannel } from './channels/cron'
import { ChannelManager } from './channels/manager'
import { TaskScheduler } from './tasks/scheduler'
import { registerWeeklyBankReview } from './tasks/handlers/weekly-bank-review'
import { registerAdminConfigRoutes } from './api/admin/config'
import { getMetrics } from './metrics/server'

const PORT = parseInt(process.env.WS_PORT ?? '4101', 10)
const MCP_URL = process.env.MCP_ENDPOINT ?? 'http://ui:3000/api/mcp'

async function main() {
  // 启动探活
  await getPool().query('SELECT 1')
  initRegistry()

  const cfg = getAgentConfig()
  const anthropic = new Anthropic({
    apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: cfg.baseURL ?? undefined,
  })

  // Fastify
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
  await app.register(cors, { origin: true, credentials: true })
  await app.register(websocket)

  // Health + metrics
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/ready', async (req, reply) => {
    try {
      await getPool().query('SELECT 1')
      return { status: 'ready' }
    } catch (e) {
      reply.code(503)
      return { status: 'not_ready', error: (e as Error).message }
    }
  })
  app.get('/metrics', async (req, reply) => {
    reply.type('text/plain').send(await getMetrics())
  })

  // 业务模块 wire-up
  const mcpBridge = new McpBridge(MCP_URL, cfg)
  const conversation = new ConversationManager(getPool(), anthropic)
  const notifier = new NullNotifier()
  const runner = new AgentRunner({ anthropic, mcpBridge, conversation, notifier })

  // 注册任务 handler
  registerWeeklyBankReview(mcpBridge)

  // 任务队列
  const scheduler = new TaskScheduler(
    getPool(),
    notifier,
    mcpBridge,
    parseInt(process.env.TASK_WORKER_COUNT ?? '4', 10),
  )
  scheduler.start()

  // Admin API
  registerAdminConfigRoutes(app)

  // Channels: WebChannel 需要 manager 注入, 但 manager 又需要 webChannel, 用临时 null 后回填
  const webChannel = new WebChannel(PORT, null)
  const manager = new ChannelManager(webChannel, runner, scheduler)
  ;(webChannel as any).manager = manager  // inject

  const cronChannel = new CronChannel(manager, process.env.CRON_TIMEZONE ?? 'Asia/Shanghai')

  await webChannel.start()
  await cronChannel.start()
  app.log.info(`Agent Service listening on ${PORT}`)

  // 优雅关闭
  const shutdown = async () => {
    app.log.info('shutting down...')
    await cronChannel.stop()
    await webChannel.stop()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(e => { console.error(e); process.exit(1) })
