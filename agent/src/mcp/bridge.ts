// agent/src/mcp/bridge.ts
// 调既有 /api/mcp 的 JSON-RPC 客户端

import { McpError, mapMcpError } from '../errors.js'
import type { AgentConfig } from '../config/store.js'

export interface McpCallResult {
  success: boolean
  data: any
  error?: string
  retryable: boolean
}

export class McpBridge {
  constructor(
    private endpoint: string,
    private config: AgentConfig,
    private retryMax: number = config.params.mcpRetryMaxAttempts,
  ) {}

  async call(toolName: string, args: any, userId: string): Promise<McpCallResult> {
    let lastErr: any
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
        })
        const json = await res.json() as any
        if (json.error) {
          const code = mapMcpError(json.error.code ?? 0)
          return {
            success: false,
            data: null,
            error: json.error.message,
            retryable: this.isRetryable(code),
          }
        }
        return { success: true, data: json.result, retryable: false }
      } catch (e: any) {
        lastErr = e
        if (attempt < this.retryMax) {
          await sleep(1000 * (attempt + 1))
        }
      }
    }
    return {
      success: false,
      data: null,
      error: lastErr?.message ?? 'MCP call failed',
      retryable: true,
    }
  }

  async listTools(): Promise<any[]> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mcp-session': 'internal' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} }),
      })
      const json = await res.json() as any
      return (json.result?.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }))
    } catch (e) {
      console.error('[McpBridge] listTools failed:', e)
      return []
    }
  }

  private isRetryable(code: string): boolean {
    return code === 'MCP_DB_ERROR' || code === 'MCP_NETWORK'
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
