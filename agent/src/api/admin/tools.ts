import type { FastifyInstance } from 'fastify'
import { UnifiedMcpBridge } from '../../mcp/bridge.js'

// 工具启用/禁用列表 (v1 在内存，v1.1 移到 DB)
const disabledTools = new Set<string>()

export function registerAdminToolRoutes(app: FastifyInstance, mcpBridge?: UnifiedMcpBridge) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin/')) return
    const role = req.headers['x-wdg-user-role']
    if (role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
  })

  // GET 列表 (读取共享 bridge — 包含所有 backend)
  app.get('/api/admin/tools', async () => {
    const bridge = mcpBridge ?? new UnifiedMcpBridge()
    if (!mcpBridge) {
      await bridge.connectBackends([{
        name: 'wdg',
        url: process.env.MCP_ENDPOINT ?? 'http://ui:3000/api/mcp',
        transport: 'fetch',
        required: true,
        headers: { 'x-mcp-session': 'internal', 'x-wdg-user-id': 'agent-system' },
      }])
    }
    const tools = await bridge.listTools()
    if (!mcpBridge) await bridge.disconnectAll()
    return {
      success: true,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? {},
        enabled: !disabledTools.has(t.name),
      })),
    }
  })

  // PUT toggle
  app.put<{ Params: { name: string }; Body: { enabled?: boolean } }>(
    '/api/admin/tools/:name',
    async (req) => {
      const { enabled } = req.body
      if (enabled === true) disabledTools.delete(req.params.name)
      if (enabled === false) disabledTools.add(req.params.name)
      return { success: true, enabled: enabled ?? !disabledTools.has(req.params.name) }
    },
  )
}

// Export for AgentRunner
export function isToolEnabled(name: string): boolean {
  return !disabledTools.has(name)
}
