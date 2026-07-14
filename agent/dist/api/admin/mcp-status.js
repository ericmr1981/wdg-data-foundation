// agent/src/api/admin/mcp-status.ts
// MCP 后端连接状态监控 API
export function registerMcpStatusRoutes(app, mcpBridge) {
    app.get('/api/admin/mcp-status', async () => {
        const statuses = mcpBridge.getStatus();
        return {
            success: true,
            backends: statuses,
            summary: {
                total: statuses.length,
                connected: statuses.filter((s) => s.status === 'connected').length,
                degraded: statuses.filter((s) => s.status === 'degraded').length,
                dead: statuses.filter((s) => s.status === 'dead').length,
                toolCount: mcpBridge.toolCount,
            },
        };
    });
}
