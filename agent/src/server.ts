// agent/src/server.ts
// Agent Service 完整入口 — 接所有模块
import 'dotenv/config'
import Fastify from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import cors from '@fastify/cors'

import { getPool } from './db.js'
import { getAgentConfig, initAgentConfig } from './config/store.js'
import { initRegistry } from './skills/registry.js'
import { McpBridge } from './mcp/bridge.js'
import { ConversationManager } from './conversation/manager.js'
import { AgentRunner } from './agent/runner.js'
import { NullNotifier } from './notifications/notifier.js'
import { WebChannel } from './channels/web.js'
import { CronChannel } from './channels/cron.js'
import { ChannelManager } from './channels/manager.js'
import { TaskScheduler } from './tasks/scheduler.js'
import { registerWeeklyBankReview } from './tasks/handlers/weekly-bank-review.js'
import { registerAdminConfigRoutes } from './api/admin/config.js'
import { registerAdminTaskRoutes } from './api/admin/tasks.js'
import { registerAdminCronRoutes } from './api/admin/cron.js'
import { registerTestConnectionRoute } from './api/admin/test-connection.js'
import { registerAdminSkillRoutes } from './api/admin/skills.js'
import { registerAdminToolRoutes } from './api/admin/tools.js'
import { registerConversationRoutes } from './api/conversations.js'
import { getMetrics } from './metrics/server.js'

const PORT = parseInt(process.env.WS_PORT ?? '4101', 10)
const MCP_URL = process.env.MCP_ENDPOINT ?? 'http://ui:3000/api/mcp'

async function main() {
  // 启动探活
  await getPool().query('SELECT 1')
  initRegistry()

  // Phase 1: 从 DB 读 config (env fallback); 必须在 Anthropic 客户端实例化前完成
  await initAgentConfig()
  const cfg = getAgentConfig()
  console.log(`[config] loaded source=${cfg.source} model=${cfg.model} hasApiKey=${cfg.apiKey !== null}`)

  const anthropic = new Anthropic({
    apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: cfg.baseURL ?? undefined,
  })

  // Fastify
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
  await app.register(cors, { origin: true, credentials: true })
  // 不再 register @fastify/websocket plugin: WebChannel 自己起 ws.WebSocketServer
  // (plugin 接管所有 GET 转 WS upgrade, 跟 WebChannel 冲突)

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

  // Admin API (config / test / skills, 不依赖 channels)
  registerAdminConfigRoutes(app)
  registerTestConnectionRoute(app)
  registerAdminSkillRoutes(app)
  registerAdminToolRoutes(app)

  // Channels: WebChannel listen WS_PORT + 1, Fastify listen WS_PORT (HTTP)
  // (单进程无法让 2 个 server 共享 1 个端口, 临时方案: 分两个端口)
  const HTTP_PORT = PORT
  const WS_PORT = PORT + 1  // 4102 (如果 HTTP_PORT=4101)
  const webChannel = new WebChannel(WS_PORT, null)
  const manager = new ChannelManager(webChannel, runner, scheduler)
  ;(webChannel as any).manager = manager  // inject

  const cronChannel = new CronChannel(manager, process.env.CRON_TIMEZONE ?? 'Asia/Shanghai')

  // Admin API (tasks / cron, 依赖 scheduler + cronChannel)
  registerAdminTaskRoutes(app, scheduler)
  registerAdminCronRoutes(app, cronChannel)

  // User-facing SDK (供 portal 调; 依赖 conversation)
  registerConversationRoutes(app, conversation)

  await webChannel.start()
  await cronChannel.start()
  await app.listen({ port: HTTP_PORT, host: '127.0.0.1' })
  app.log.info(`HTTP listening on ${HTTP_PORT}, WS on ${WS_PORT}`)

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
