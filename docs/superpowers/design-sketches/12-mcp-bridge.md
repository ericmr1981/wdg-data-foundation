# WDG v1 — MCP Bridge

> 把 Anthropic SDK 的 tool_use 调用转成对既有 /api/mcp 的 JSON-RPC 请求。
> 这是 v1 最"无聊"的一个模块, 因为 90% 是 HTTP 转发。

## 1. 接口

```typescript
// agent/src/mcp/bridge.ts

import Anthropic from '@anthropic-ai/sdk'
import { AgentConfig } from '../config/store'

export interface McpCallResult {
  success: boolean
  data: any
  error?: string
  retryable: boolean
}

export class McpBridge {
  constructor(
    private endpoint: string,                  // 'http://ui:3000/api/mcp'
    private config: AgentConfig,                // 拿到 apiKey, model
    private retryMax: number = 2,              // 来自 config.params.mcpRetryMaxAttempts
  ) {}

  /**
   * 调一个 MCP tool, 自动重试, 返回结构化结果。
   */
  async call(toolName: string, args: any, userId: string): Promise<McpCallResult> {
    let lastErr: any
    for (let attempt = 0; attempt <= this.retryMax; attempt++) {
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-mcp-session': 'internal',
            'x-wdg-user-id': userId,             // 透传给 MCP server, 用于审计
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'tools/call',
            params: { name: toolName, arguments: args },
          }),
        })
        const json = await res.json()
        if (json.error) {
          return {
            success: false,
            data: null,
            error: json.error.message,
            retryable: this.isRetryable(json.error.code),
          }
        }
        return { success: true, data: json.result, retryable: false }
      } catch (e: any) {
        lastErr = e
        if (attempt < this.retryMax) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))  // 1s, 2s backoff
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

  /**
   * 列出所有可用 MCP tool 的 schema (用于拼 system prompt 的 tools 段)。
   */
  async listTools(): Promise<Anthropic.Tool[]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mcp-session': 'internal' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} }),
    })
    const json = await res.json()
    // MCP tool schema → Anthropic Tool schema (基本一对一, 调一下 input_schema 即可)
    return (json.result?.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
  }

  private isRetryable(code: number): boolean {
    return code === -32603   // internal error
        || code === 408       // timeout
        || code === 429       // rate limit
        || code === 502       // bad gateway
        || code === 503       // unavailable
        || code === 504       // gateway timeout
  }
}
```

## 2. AgentRunner 集成 (伪代码)

```typescript
// agent/src/agent/runner.ts (片段)

import { McpBridge } from '../mcp/bridge'

async function handleToolCall(
  toolCall: Anthropic.ToolUseBlock,
  ctx: { userId: string; conversationId: string },
): Promise<Anthropic.ToolResultBlock> {
  // 1. load_skill 走特殊路径
  if (toolCall.name === 'load_skill') {
    const result = handleLoadSkill(toolCall.input)
    return toolResult(toolCall.id, result.content, /* is_error */ !result.content)
  }

  // 2. 其他都走 MCP Bridge
  const mcp = await mcpBridge.call(toolCall.name, toolCall.input, ctx.userId)
  return toolResult(
    toolCall.id,
    mcp.success ? JSON.stringify(mcp.data) : `ERROR: ${mcp.error}`,
    /* is_error */ !mcp.success,
  )
}
```

## 3. v0 → v1 兼容性

v0 的 `ui/src/lib/chat/mcp-bridge.ts` 已经有几乎一样的实现。**agent 端的 mcp/bridge.ts 是 v0 那一版的 Node.js 版本**, 逻辑复制即可。

| 项 | v0 | v1 |
|---|---|---|
| 协议 | JSON-RPC 2.0 | **同上** |
| 鉴权 | `x-mcp-session: internal` | **同上, + `x-wdg-user-id` 用于审计** |
| 重试 | 2 次, 1s/2s backoff | **同上** |
| 错误处理 | code → retryable | **同上** |
| listTools | 启动时调一次 | **同上, + 每次 config 改了重调** (config 改了不重调也行, v1 暂不做) |

## 4. 这个组件你看什么

- **整个文件 ~80 行**, 没新东西
- **跟 v0 唯一区别**: 多传一个 `x-wdg-user-id` header (审计用)
- **AgentRunner 调用方式**: 跟 v0 一样 `mcpBridge.call(name, args)`, 返回结构化结果
- **未来 v2 才有意思**: 比如 cache、rate limit、batch call
