// agent/test/helpers/mock-mcp.ts
import { UnifiedMcpBridge, type McpCallResult } from '../../src/mcp/bridge.ts'

export class MockMcpBridge extends UnifiedMcpBridge {
  private handlers: Record<string, (args: any) => McpCallResult> = {}

  constructor() {
    super()
  }

  call = async (toolName: string, args: any): Promise<McpCallResult> => {
    const handler = this.handlers[toolName]
    if (!handler) {
      return { success: false, data: null, error: `Tool not found: ${toolName}`, retryable: false }
    }
    return handler(args)
  }

  listTools = async () => Object.keys(this.handlers).map(name => ({
    name,
    description: `Mock ${name}`,
    inputSchema: { type: 'object', properties: {} } as Record<string, unknown>,
    _backend: 'mock',
  }))

  on(toolName: string, handler: (args: any) => McpCallResult) {
    this.handlers[toolName] = handler
  }

  reset() { this.handlers = {} }
}
