// agent/src/mcp/bridge.ts
// 调既有 /api/mcp 的 JSON-RPC 客户端
import { mapMcpError } from '../errors.js';
export class McpBridge {
    endpoint;
    config;
    retryMax;
    constructor(endpoint, config, retryMax = config.params.mcpRetryMaxAttempts) {
        this.endpoint = endpoint;
        this.config = config;
        this.retryMax = retryMax;
    }
    async call(toolName, args, userId) {
        let lastErr;
        for (let attempt = 0; attempt <= this.retryMax; attempt++) {
            try {
                const res = await fetch(this.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-mcp-session': 'internal',
                        'x-wdg-user-id': userId,
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: crypto.randomUUID(),
                        method: 'tools/call',
                        params: { name: toolName, arguments: args },
                    }),
                });
                const json = await res.json();
                if (json.error) {
                    const code = mapMcpError(json.error.code ?? 0);
                    return {
                        success: false,
                        data: null,
                        error: json.error.message,
                        retryable: this.isRetryable(code),
                    };
                }
                return { success: true, data: json.result, retryable: false };
            }
            catch (e) {
                lastErr = e;
                if (attempt < this.retryMax) {
                    await sleep(1000 * (attempt + 1));
                }
            }
        }
        return {
            success: false,
            data: null,
            error: lastErr?.message ?? 'MCP call failed',
            retryable: true,
        };
    }
    async listTools() {
        try {
            const res = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-mcp-session': 'internal' },
                body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} }),
            });
            const json = await res.json();
            return (json.result?.tools ?? []).map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
            }));
        }
        catch (e) {
            console.error('[McpBridge] listTools failed:', e);
            return [];
        }
    }
    isRetryable(code) {
        return code === 'MCP_DB_ERROR' || code === 'MCP_NETWORK';
    }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
