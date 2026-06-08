// agent/src/server.ts
// Agent Service 入口 (W4 整合后这里会接所有模块)
import Fastify from 'fastify'
import { WebChannel } from './channels/web.ts'
import { ChannelManager } from './channels/manager.ts'
import { getPool } from './db.ts'

const PORT = parseInt(process.env.WS_PORT ?? '4101', 10)

async function main() {
  // 启动探活
  await getPool().query('SELECT 1')

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
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

  // WebChannel
  const webChannel = new WebChannel(PORT, null)
  const manager = new ChannelManager()
  ;(webChannel as any).manager = manager  // inject

  await webChannel.start()
  app.log.info(`WebChannel listening on ${PORT}`)

  const shutdown = async () => {
    app.log.info('shutting down...')
    await webChannel.stop()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(e => { console.error(e); process.exit(1) })
