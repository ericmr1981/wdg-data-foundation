// agent/test/helpers/mock-mcp.ts
import { McpBridge, type McpCallResult } from '../../src/mcp/bridge.ts'

export class MockMcpBridge extends McpBridge {
  private handlers: Record<string, (args: any, userId: string) => McpCallResult> = {}

  constructor() {
    super('http://mock', {
      agentMd: '',
      params: { mcpRetryMaxAttempts: 0 } as any,
      baseURL: null,
      apiKey: null,
      model: 'mock',
      source: 'mock',
    } as any)
  }

  call = async (toolName: string, args: any, userId: string): Promise<McpCallResult> => {
    const handler = this.handlers[toolName]
    if (!handler) {
      return { success: false, data: null, error: `Tool not found: ${toolName}`, retryable: false }
    }
    return handler(args, userId)
  }

  listTools = async () => Object.keys(this.handlers).map(name => ({
    name,
    description: `Mock ${name}`,
    input_schema: { type: 'object', properties: {} },
  }))

  on(toolName: string, handler: (args: any, userId: string) => McpCallResult) {
    this.handlers[toolName] = handler
  }

  reset() { this.handlers = {} }
}
