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

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types'

export interface FetchTransportOptions {
  /** Additional headers to include with every request (e.g. auth tokens). */
  headers?: Record<string, string>
  /** Timeout in milliseconds (default 30s). */
  timeoutMs?: number
  /** Optional custom fetch (e.g. for Node 18-). Defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Labels this transport in log messages. */
  label?: string
}

export class FetchTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  private headers: Record<string, string>
  private timeoutMs: number
  private fetchFn: typeof fetch
  private label: string
  private closed = false

  constructor(
    private url: string,
    options: FetchTransportOptions = {},
  ) {
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    }
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.fetchFn = options.fetchFn ?? fetch
    this.label = options.label ?? '[fetch-transport]'
  }

  // ─── Transport interface ───────────────────────

  async start(): Promise<void> {
    // Stateless HTTP: no persistent connection to establish.
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) {
      this.onerror?.(new Error(`${this.label} transport is closed`))
      return
    }

    // Notifications have no `id` and no response is expected.
    // The server may return an empty body.
    const isNotification = (message as any).id === undefined

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      // ok may be a getter on Response, or a plain property in tests.
      // deno-lint-ignore no-explicit-any
      const ok: boolean = typeof (res as any).ok === 'boolean'
        ? (res as any).ok
        : res.status >= 200 && res.status < 300

      if (!ok) {
        const body = await res.text().catch(() => '<unreadable>')
        throw new Error(
          `${this.label} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        )
      }

      // For notifications, ignore the response body entirely.
      if (isNotification) return

      const json = (await res.json()) as JSONRPCMessage
      this.onmessage?.(json)
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        this.onerror?.(new Error(`${this.label} request timed out after ${this.timeoutMs}ms`))
      } else {
        this.onerror?.(e instanceof Error ? e : new Error(String(e)))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.onclose?.()
  }
}
