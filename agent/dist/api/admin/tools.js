import { McpBridge } from '../../mcp/bridge.js';
import { getAgentConfig } from '../../config/store.js';
// 工具启用/禁用列表 (v1 在内存，v1.1 移到 DB)
const disabledTools = new Set();
export function registerAdminToolRoutes(app) {
    app.addHook('preHandler', async (req, reply) => {
        if (!req.url.startsWith('/api/admin/'))
            return;
        const role = req.headers['x-wdg-user-role'];
        if (role !== 'admin')
            return reply.code(403).send({ error: 'forbidden' });
    });
    // GET 列表 (从 McpBridge.listTools 实时拉)
    app.get('/api/admin/tools', async () => {
        const cfg = getAgentConfig();
        const bridge = new McpBridge(process.env.MCP_ENDPOINT ?? 'http://ui:3000/api/mcp', cfg);
        const tools = await bridge.listTools();
        return {
            success: true,
            tools: tools.map((t) => ({
                name: t.name,
                description: t.description ?? '',
                inputSchema: t.input_schema ?? {},
                enabled: !disabledTools.has(t.name),
            })),
        };
    });
    // PUT toggle
    app.put('/api/admin/tools/:name', async (req) => {
        const { enabled } = req.body;
        if (enabled === true)
            disabledTools.delete(req.params.name);
        if (enabled === false)
            disabledTools.add(req.params.name);
        return { success: true, enabled: enabled ?? !disabledTools.has(req.params.name) };
    });
}
// Export for AgentRunner
export function isToolEnabled(name) {
    return !disabledTools.has(name);
}
