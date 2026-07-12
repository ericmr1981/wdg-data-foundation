// agent/src/mcp/bridge.ts
// Unified multi-backend MCP bridge using @modelcontextprotocol/sdk.
//
// Each backend is a standard MCP transport connection. The bridge:
//   1. Connects to all configured backends at startup
//   2. Discovers tools via listTools() across all backends
//   3. Routes call() to the correct backend by tool name
//   4. Returns McpCallResult compatible with the old interface
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { FetchTransport } from './transports/fetch-transport.js';
// ─── Bridge ────────────────────────────────
export class UnifiedMcpBridge {
    backends = new Map();
    toolBackend = new Map();
    connected = false;
    // ─── Connection management ──────────────
    /**
     * Connect to all configured backends and discover their tools.
     * Call once at startup. Idempotent: second call is a no-op.
     */
    async connectBackends(configs) {
        if (this.connected)
            return;
        const promises = [];
        for (const cfg of configs) {
            if (this.backends.has(cfg.name)) {
                console.warn(`[bridge] backend "${cfg.name}" already configured, skipping`);
                continue;
            }
            promises.push(this._connectOne(cfg));
        }
        // 并行连接所有后端，失败的不阻塞整体
        await Promise.allSettled(promises);
        await this.refreshToolRoutes();
        this.connected = true;
        const names = Array.from(this.backends.keys()).join(', ');
        console.log(`[bridge] ready: ${this.backends.size} backend(s) [${names}], ${this.toolBackend.size} tool(s)`);
    }
    async _connectOne(cfg) {
        const transport = this.createTransport(cfg);
        const client = new Client({ name: 'wdg-agent', version: '1.0.0' }, { capabilities: {} });
        try {
            await client.connect(transport);
            this.backends.set(cfg.name, { client, name: cfg.name });
            console.log(`[bridge] connected to "${cfg.name}" at ${cfg.url}`);
        }
        catch (e) {
            console.error(`[bridge] failed to connect "${cfg.name}": ${e?.message ?? e}`);
        }
    }
    createTransport(cfg) {
        const t = cfg.transport;
        switch (t) {
            case 'fetch':
            case 'streamableHttp':
                return new FetchTransport(cfg.url, {
                    headers: cfg.headers,
                    timeoutMs: cfg.timeoutMs,
                    label: `[fetch:${cfg.name}]`,
                });
            case 'sse': {
                // eslint-disable-next-line deprecation/deprecation
                return new SSEClientTransport(new URL(cfg.url), {
                    requestInit: cfg.headers
                        ? { headers: cfg.headers }
                        : undefined,
                });
            }
            default:
                throw new Error(`Unknown transport: ${cfg.transport}`);
        }
    }
    async refreshToolRoutes() {
        this.toolBackend.clear();
        for (const [name, { client }] of this.backends) {
            try {
                const { tools } = await client.listTools();
                for (const tool of tools) {
                    const existing = this.toolBackend.get(tool.name);
                    if (existing) {
                        console.warn(`[bridge] tool "${tool.name}" routed to "${existing}", overwritten by "${name}"`);
                    }
                    this.toolBackend.set(tool.name, name);
                }
            }
            catch (e) {
                console.error(`[bridge] listTools failed for "${name}": ${e?.message ?? e}`);
            }
        }
    }
    // ─── Tool discovery ──────────────────────
    /**
     * List all tools across all connected backends.
     * Returns Anthropic-compatible tool definitions.
     */
    async listTools() {
        if (!this.connected) {
            throw new Error('Bridge not connected — call connectBackends() first');
        }
        const all = [];
        for (const [, { client, name }] of this.backends) {
            try {
                const { tools } = await client.listTools();
                for (const t of tools) {
                    all.push({
                        name: t.name,
                        description: t.description ?? '',
                        inputSchema: (t.inputSchema ?? {}),
                        _backend: name,
                    });
                }
            }
            catch (e) {
                console.error(`[bridge] listTools failed for "${name}": ${e?.message ?? e}`);
            }
        }
        return all;
    }
    // ─── Tool execution ──────────────────────
    /**
     * Call a tool by name. Routes to the correct backend automatically.
     * Returns same McpCallResult shape as the old bridge for backward compat.
     */
    async call(toolName, args) {
        const backendName = this.toolBackend.get(toolName);
        if (!backendName) {
            return {
                success: false,
                data: null,
                error: `Unknown tool: ${toolName}`,
                retryable: false,
            };
        }
        const entry = this.backends.get(backendName);
        if (!entry) {
            return {
                success: false,
                data: null,
                error: `Backend "${backendName}" is not connected`,
                retryable: true,
            };
        }
        try {
            const result = await entry.client.callTool({
                name: toolName,
                arguments: args ?? {},
            });
            const text = result.content
                ?.filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n') ?? '';
            return {
                success: !result.isError,
                data: text,
                error: result.isError ? text : undefined,
                retryable: false,
            };
        }
        catch (e) {
            const msg = e?.message ?? String(e);
            const retryable = msg.includes('ECONNREFUSED') ||
                msg.includes('ETIMEDOUT') ||
                msg.includes('fetch failed') ||
                msg.includes('timeout');
            return {
                success: false,
                data: null,
                error: msg,
                retryable,
            };
        }
    }
    // ─── Teardown ────────────────────────────
    /** Close all backend connections. */
    async disconnectAll() {
        for (const [, { client }] of this.backends) {
            try {
                await client.close();
            }
            catch {
                // best-effort close
            }
        }
        this.backends.clear();
        this.toolBackend.clear();
        this.connected = false;
    }
    /** Number of connected backends. */
    get backendCount() {
        return this.backends.size;
    }
    /** Number of discovered tools. */
    get toolCount() {
        return this.toolBackend.size;
    }
}
