// agent/src/api/admin/mcp-status.ts
// MCP 后端连接状态监控 API

import type { FastifyInstance } from 'fastify'
import type { UnifiedMcpBridge, BackendStatus } from '../../mcp/bridge.js'

export function registerMcpStatusRoutes(
  app: FastifyInstance,
  mcpBridge: UnifiedMcpBridge,
): void {
  app.get('/api/admin/mcp-status', async () => {
    const statuses = mcpBridge.getStatus()
    return {
      success: true,
      backends: statuses,
      summary: {
        total: statuses.length,
        connected: statuses.filter((s: { status: string }) => s.status === 'connected').length,
        degraded: statuses.filter((s: { status: string }) => s.status === 'degraded').length,
        dead: statuses.filter((s: { status: string }) => s.status === 'dead').length,
        toolCount: mcpBridge.toolCount,
      },
    }
  })
}
