// agent/src/server.ts
// Agent Service 完整入口 — 接所有模块
import 'dotenv/config'
import Fastify from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'

import { getPool } from './db.js'
import { getAgentConfig, initAgentConfig, isConfigReady } from './config/store.js'
import { initRegistry } from './skills/registry.js'
import { UnifiedMcpBridge, type BackendConfig } from './mcp/bridge.js'
import { ConversationManager } from './conversation/manager.js'
import { AgentRunner } from './agent/runner.js'
import { WebNotifier } from './notifications/notifier.js'
import { WebChannel } from './channels/web.js'
import { CronChannel } from './channels/cron.js'
import { ChannelManager } from './channels/manager.js'
import { TaskScheduler } from './tasks/scheduler.js'
import { registerWeeklyBankReview } from './tasks/handlers/weekly-bank-review.js'
import { registerAdminConfigRoutes } from './api/admin/config.js'
import { registerAdminTaskRoutes } from './api/admin/tasks.js'
import { registerAdminCronRoutes } from './api/admin/cron.js'
import { registerTestConnectionRoute } from './api/admin/test-connection.js'
import { registerTestChatRoute } from './api/admin/test-chat.js'
import { registerTestRunRoute } from './api/admin/test-run.js'
import { registerAdminSkillRoutes } from './api/admin/skills.js'
import { registerAdminToolRoutes } from './api/admin/tools.js'
import { registerConversationRoutes } from './api/conversations.js'
import { registerChatEventsRoutes } from './api/chat/events.js'
import { registerChatUploadRoutes } from './api/chat/upload.js'
import { getMetrics } from './metrics/server.js'

const PORT = parseInt(process.env.WS_PORT ?? '4101', 10)
const HTTP_PORT = PORT
const WS_PORT = PORT + 1
const MCP_URL = process.env.MCP_ENDPOINT ?? 'http://ui:3000/api/mcp'

async function main() {
  // 启动探活
  await getPool().query('SELECT 1')
  initRegistry()

  // R 设计: config 严格走 DB, 不读 ANTHROPIC_* env
  await initAgentConfig()
  const cfg = getAgentConfig()
  console.log(`[config] loaded source=${cfg.source} model=${cfg.model} hasApiKey=${cfg.apiKey !== null}`)

  // 路 4: 预取 JWKS(启动时 fetch,不干扰 ws 事件循环)
  const { initAuth } = await import('./channels/auth.js')
  await initAuth()
  console.log('[auth] initAuth done')

  const anthropic = new Anthropic({
    apiKey: cfg.apiKey ?? undefined,
    baseURL: cfg.baseURL ?? undefined,
  })
  if (!cfg.apiKey) {
    console.warn('[config] WARN: agent.config 有 row 但 apiKey 为空 — admin 需要去 /u/admin/agent-config 配')
  }

  // Fastify
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
  await app.register(cors, { origin: true, credentials: true })
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  })

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
  const notifier = new WebNotifier(null)

  const mcpBridge = new UnifiedMcpBridge()
  // WDG 内置后端 — 始终启用
  const mcpBackends: BackendConfig[] = [
    {
      name: 'wdg',
      url: MCP_URL,
      transport: 'fetch',
      headers: { 'x-mcp-session': 'internal', 'x-wdg-user-id': 'agent-system' },
      timeoutMs: 60_000,
    },
  ]
  // 外部 MCP 后端 — 从 DB agent.config.mcp_backends 读取
  // admin 在 /api/admin/config 编辑，即时生效（重启后重新加载）
  // Lima VM 环境下 127.0.0.1 指向 VM 自身，无法访问宿主机的服务。
  // 自动将 127.0.0.1:端口 替换为 host.lima.internal:端口 以便从 VM 内部连接宿主机。
  if (cfg.mcpBackends.length > 0) {
    const resolved = cfg.mcpBackends.map(b => ({
      ...b,
      url: b.url.replace(/^http:\/\/127\.0\.0\.1:/, 'http://host.lima.internal:'),
    }))
    mcpBackends.push(...resolved)
  }

  const conversation = new ConversationManager(getPool(), null)
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
  registerTestChatRoute(app)
  registerTestRunRoute(app, { mcpBridge })
  registerAdminSkillRoutes(app)
  registerAdminToolRoutes(app)

  // WS/Channels
  const webChannel = new WebChannel(WS_PORT, null)
  const manager = new ChannelManager(webChannel, runner, scheduler)
  webChannel.setManager(manager)

  notifier.wireWebChannel(webChannel)

  const cronChannel = new CronChannel(manager, process.env.CRON_TIMEZONE ?? 'Asia/Shanghai')

  // Admin API (tasks / cron, 依赖 scheduler + cronChannel)
  registerAdminTaskRoutes(app, scheduler)
  registerAdminCronRoutes(app, cronChannel)

  // User-facing SDK
  registerConversationRoutes(app, conversation)
  registerChatEventsRoutes(app, conversation)
  registerChatUploadRoutes(app, anthropic)

  // 先连接 MCP 后端，再启动 HTTP（确保 bridge 就绪后才接收请求）
  await mcpBridge.connectBackends(mcpBackends)
  await app.listen({ port: HTTP_PORT, host: '127.0.0.1' })

  await webChannel.start()
  await cronChannel.start()
  app.log.info(`HTTP listening on ${HTTP_PORT}, WS on ${WS_PORT}`)

  // 优雅关闭
  const shutdown = async () => {
    app.log.info('shutting down...')
    await cronChannel.stop()
    await webChannel.stop()
    await mcpBridge.disconnectAll()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(e => { console.error(e); process.exit(1) })
