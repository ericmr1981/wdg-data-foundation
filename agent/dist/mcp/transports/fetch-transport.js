// agent/src/mcp/transports/fetch-transport.ts
// MCP Transport adapter for stateless JSON-RPC-over-HTTP backends.
// Wraps fetch() into the @modelcontextprotocol/sdk Transport interface,
// so backends that speak JSON-RPC (like WDG's current /api/mcp) can be
// consumed via the standard MCP SDK Client without server-side changes.
//
// Each send() makes one HTTP POST, waits for the JSON response, and
// delivers it via onmessage(). The SDK Client matches responses to
// pending requests by JSON-RPC id, so the transport doesn't need to
// track anything.
export class FetchTransport {
    url;
    onclose;
    onerror;
    onmessage;
    headers;
    timeoutMs;
    fetchFn;
    label;
    closed = false;
    constructor(url, options = {}) {
        this.url = url;
        this.headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.fetchFn = options.fetchFn ?? fetch;
        this.label = options.label ?? '[fetch-transport]';
    }
    // ─── Transport interface ───────────────────────
    async start() {
        // Stateless HTTP: no persistent connection to establish.
    }
    async send(message) {
        if (this.closed) {
            this.onerror?.(new Error(`${this.label} transport is closed`));
            return;
        }
        // Notifications have no `id` and no response is expected.
        // The server may return an empty body.
        const isNotification = message.id === undefined;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await this.fetchFn(this.url, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(message),
                signal: controller.signal,
            });
            // ok may be a getter on Response, or a plain property in tests.
            // deno-lint-ignore no-explicit-any
            const ok = typeof res.ok === 'boolean'
                ? res.ok
                : res.status >= 200 && res.status < 300;
            if (!ok) {
                const body = await res.text().catch(() => '<unreadable>');
                throw new Error(`${this.label} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
            }
            // For notifications, ignore the response body entirely.
            if (isNotification)
                return;
            const json = (await res.json());
            this.onmessage?.(json);
        }
        catch (e) {
            if (e?.name === 'AbortError') {
                this.onerror?.(new Error(`${this.label} request timed out after ${this.timeoutMs}ms`));
            }
            else {
                this.onerror?.(e instanceof Error ? e : new Error(String(e)));
            }
        }
        finally {
            clearTimeout(timer);
        }
    }
    async close() {
        this.closed = true;
        this.onclose?.();
    }
}
