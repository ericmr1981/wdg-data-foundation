// agent/src/mcp/bridge.ts
// Unified multi-backend MCP bridge — production-grade backend management.
//
// Backend tiers:
//   primary (required=true)  — blocks startup, fail-fast on connection error
//   secondary (required=false) — fire-and-forget, exponential backoff retry,
//                                periodic health checks
//
// Each backend gets independent lifecycle: connect → health-check → reconnect
// on failure. One failing backend does not affect others.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { FetchTransport } from './transports/fetch-transport.js'

// ─── Types ────────────────────────────────

export type BackendConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'disconnected'
  | 'dead'

export interface McpCallResult {
  success: boolean
  data: any
  error?: string
  retryable: boolean
}

export interface RetryPolicy {
  maxRetries: number
  backoffMs: number
  maxBackoffMs: number
}

export interface BackendConfig {
  name: string
  url: string
  transport: 'fetch' | 'sse'
  headers?: Record<string, string>
  timeoutMs?: number
  required?: boolean
  retryPolicy?: RetryPolicy
  healthCheckIntervalMs?: number
}

export interface BackendStatus {
  name: string
  url: string
  status: BackendConnectionStatus
  toolCount: number
  lastPingMs: number | null
  errorCount: number
  connectedAt: string | null
  lastError: string | null
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  _backend: string
}

interface BackendEntry {
  client: Client
  config: BackendConfig
  name: string
}

const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 10,
  backoffMs: 1_000,
  maxBackoffMs: 30_000,
}

const DEFAULT_HEALTH_CHECK_MS = 30_000

// ─── Bridge ────────────────────────────────

export class UnifiedMcpBridge {
  private backends = new Map<string, BackendEntry>()
  private toolBackend = new Map<string, string>()
  private cachedTools: ToolDef[] = []
  private statuses = new Map<string, BackendStatus>()
  private healthTimers = new Map<string, ReturnType<typeof setInterval>>()
  private shuttingDown = false

  // ─── Connection management ──────────────

  /**
   * Connect to primary (required) backends. Blocks until all primaries
   * succeed or fail. Returns true if all primaries connected.
   */
  async connectPrimary(configs: BackendConfig[]): Promise<boolean> {
    const primaries = configs.filter(c => c.required === true)
    if (primaries.length === 0) return true

    // Retry up to 3 times with increasing delay
    for (let attempt = 1; attempt <= 3; attempt++) {
      const promises = primaries.map(cfg => this._connectOne(cfg))
      await Promise.allSettled(promises)

      await this.refreshToolRoutes()
      this._logStatus()

      const statuses = primaries.map(c => this.statuses.get(c.name)?.status)
      const allConnected = statuses.every(s => s === 'connected')
      if (allConnected) return true

      if (attempt < 3) {
        const delay = attempt * 5_000
        console.warn(`[bridge] primary backends not ready, retry ${attempt}/3 in ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
      }
    }

    return false
  }

  /**
   * Start secondary (optional) backends asynchronously with retry.
   * These will reconnect automatically on failure.
   */
  startSecondary(configs: BackendConfig[]): void {
    const secondaries = configs.filter(c => c.required !== true)
    for (const cfg of secondaries) {
      this._connectWithRetry(cfg)
    }
  }

  /**
   * Legacy name kept for backward compat — connects all, primary blocks.
   */
  async connectBackends(configs: BackendConfig[]): Promise<void> {
    await this.connectPrimary(configs)
    this.startSecondary(configs)
  }

  private _initStatus(cfg: BackendConfig): void {
    if (this.statuses.has(cfg.name)) return
    this.statuses.set(cfg.name, {
      name: cfg.name,
      url: cfg.url,
      status: 'connecting',
      toolCount: 0,
      lastPingMs: null,
      errorCount: 0,
      connectedAt: null,
      lastError: null,
    })
  }

  private async _connectOne(cfg: BackendConfig): Promise<void> {
    this._initStatus(cfg)
    this._setStatus(cfg.name, 'connecting')

    const transport = this.createTransport(cfg)
    const client = new Client(
      { name: 'wdg-agent', version: '1.0.0' },
      { capabilities: {} },
    )

    try {
      await client.connect(transport)
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      this._setStatus(cfg.name, 'disconnected', { lastError: msg })
      throw e
    }

    this.backends.set(cfg.name, { client, config: cfg, name: cfg.name })
    this._setStatus(cfg.name, 'connected', { connectedAt: new Date().toISOString(), lastError: null })
    console.log(`[bridge] connected to "${cfg.name}" at ${cfg.url}`)

    // Discover tools from this backend
    await this.refreshToolRoutes()
    this._logStatus()

    // Start health checks for secondary backends
    if (cfg.required !== true) {
      this._startHealthCheck(cfg)
    }
  }

  /**
   * Connect with exponential backoff retry. Used for secondary backends.
   * Does not throw — failures are logged and retried.
   */
  private async _connectWithRetry(cfg: BackendConfig): Promise<void> {
    const retry = cfg.retryPolicy ?? DEFAULT_RETRY
    let attempt = 0

    while (!this.shuttingDown) {
      try {
        await this._connectOne(cfg)
        this._stopHealthCheck(cfg.name)
        this._startHealthCheck(cfg)
        return // success
      } catch (e: any) {
        attempt++
        const msg = e?.message ?? String(e)
        this._recordError(cfg.name, msg)

        if (attempt >= retry.maxRetries) {
          this._setStatus(cfg.name, 'dead', { lastError: msg })
          console.error(
            `[bridge] backend "${cfg.name}" gave up after ${attempt} attempts: ${msg}`,
          )
          return
        }

        const delay = Math.min(
          retry.backoffMs * Math.pow(2, attempt - 1),
          retry.maxBackoffMs,
        )
        console.warn(
          `[bridge] failed to connect "${cfg.name}" (attempt ${attempt}/${retry.maxRetries}), retry in ${delay}ms: ${msg}`,
        )

        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  // ─── Health checks ──────────────────────

  private _startHealthCheck(cfg: BackendConfig): void {
    if (this.healthTimers.has(cfg.name)) return

    const interval = cfg.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_MS
    const timer = setInterval(async () => {
      if (this.shuttingDown) return
      await this._ping(cfg.name)
    }, interval)
    this.healthTimers.set(cfg.name, timer)
  }

  private _stopHealthCheck(name: string): void {
    const timer = this.healthTimers.get(name)
    if (timer) {
      clearInterval(timer)
      this.healthTimers.delete(name)
    }
  }

  private async _ping(name: string): Promise<void> {
    const entry = this.backends.get(name)
    if (!entry) return

    const start = Date.now()
    try {
      await entry.client.ping()
      const elapsed = Date.now() - start
      this._setStatus(name, 'connected', { lastPingMs: elapsed })
    } catch (e: any) {
      const elapsed = Date.now() - start
      const msg = e?.message ?? String(e)
      this._recordError(name, msg)

      // Mark degraded, try reconnect
      this._setStatus(name, 'degraded', { lastPingMs: elapsed, lastError: msg })
      console.warn(`[bridge] health check failed for "${name}": ${msg}`)

      // Remove from backends so tools are unavailable
      this.backends.delete(name)
      this._stopHealthCheck(name)

      // Reconnect with retry
      const cfg = entry.config
      this._connectWithRetry(cfg)
    }
  }

  // ─── Tool routes ────────────────────────

  private async refreshToolRoutes(): Promise<void> {
    this.toolBackend.clear()
    this.cachedTools = []
    for (const [name, { client }] of this.backends) {
      try {
        const { tools } = await client.listTools()
        for (const tool of tools) {
          const existing = this.toolBackend.get(tool.name)
          if (existing) {
            console.warn(
              `[bridge] tool "${tool.name}" routed to "${existing}", overwritten by "${name}"`,
            )
          }
          this.toolBackend.set(tool.name, name)
          this.cachedTools.push({
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
            _backend: name,
          })
        }
        this._setStatus(name, 'connected', { toolCount: tools.length })
      } catch (e: any) {
        console.error(
          `[bridge] listTools failed for "${name}": ${e?.message ?? e}`,
        )
      }
    }
  }

  // ─── Status reporting ───────────────────

  /** Returns current status of all backends. */
  getStatus(): BackendStatus[] {
    // Recalculate tool counts from current backends
    for (const [name] of this.statuses) {
      const entry = this.backends.get(name)
      if (entry) {
        const tools = Array.from(this.toolBackend.entries())
          .filter(([, b]) => b === name)
          .length
        this._setStatus(name, 'connected', { toolCount: tools })
      }
    }
    return Array.from(this.statuses.values())
  }

  private _setStatus(
    name: string,
    status: BackendConnectionStatus,
    extra?: Partial<BackendStatus>,
  ): void {
    const s = this.statuses.get(name)
    if (!s) return
    s.status = status
    if (extra) Object.assign(s, extra)
  }

  private _recordError(name: string, error: string): void {
    const s = this.statuses.get(name)
    if (!s) return
    s.errorCount++
    s.lastError = error
  }

  private _logStatus(): void {
    const names = Array.from(this.backends.keys()).join(', ')
    console.log(
      `[bridge] ready: ${this.backends.size} backend(s) [${names}], ${this.toolBackend.size} tool(s)`,
    )
  }

  // ─── Tool discovery ──────────────────────

  async listTools(): Promise<ToolDef[]> {
    return this.cachedTools
  }

  // ─── Tool execution ──────────────────────

  async call(toolName: string, args: any): Promise<McpCallResult> {
    const backendName = this.toolBackend.get(toolName)
    if (!backendName) {
      return {
        success: false,
        data: null,
        error: `Unknown tool: ${toolName}`,
        retryable: false,
      }
    }

    const entry = this.backends.get(backendName)
    if (!entry) {
      return {
        success: false,
        data: null,
        error: `Backend "${backendName}" is not connected`,
        retryable: true,
      }
    }

    try {
      const result = await Promise.race([
        entry.client.callTool({
          name: toolName,
          arguments: args ?? {},
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tool call timed out after 10s')), 10_000),
        ),
      ])

      const text = (result.content as any[])
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n') ?? ''

      return {
        success: !result.isError,
        data: text,
        error: result.isError ? text : undefined,
        retryable: false,
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      const retryable =
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('fetch failed') ||
        msg.includes('timeout')

      return {
        success: false,
        data: null,
        error: msg,
        retryable,
      }
    }
  }

  // ─── Transport factory ───────────────────

  createTransport(cfg: BackendConfig) {
    const t = cfg.transport as string
    switch (t) {
      case 'fetch':
      case 'streamableHttp':
        return new FetchTransport(cfg.url, {
          headers: cfg.headers,
          timeoutMs: cfg.timeoutMs,
          label: `[fetch:${cfg.name}]`,
        })

      case 'sse': {
        return new SSEClientTransport(new URL(cfg.url), {
          requestInit: cfg.headers
            ? { headers: cfg.headers }
            : undefined,
        })
      }

      default:
        throw new Error(`Unknown transport: ${cfg.transport}`)
    }
  }

  // ─── Teardown ────────────────────────────

  /** Close all backend connections. Each backend gets its own timeout. */
  async disconnectAll(): Promise<void> {
    this.shuttingDown = true

    for (const name of this.healthTimers.keys()) {
      this._stopHealthCheck(name)
    }

    const timeoutMs = 5_000
    const promises = Array.from(this.backends.entries()).map(
      async ([name, { client }]) => {
        const timer = setTimeout(() => {
          console.warn(`[bridge] close timeout for "${name}", forcing`)
        }, timeoutMs)
        try {
          await client.close()
        } catch {
          // best-effort
        } finally {
          clearTimeout(timer)
        }
      },
    )

    await Promise.allSettled(promises)
    this.backends.clear()
    this.toolBackend.clear()
    this.cachedTools = []
  }

  get backendCount(): number {
    return this.backends.size
  }

  get toolCount(): number {
    return this.toolBackend.size
  }
}
