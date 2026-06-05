// AsyncLocalStorage<{ baseUrl: string }> for the current MCP tool execution.
// Set by mcp/server.ts handleToolsCall (which derives baseUrl from env + the
// request). Read by mcpFetch() in tools/* to construct correct localhost URLs.

import { AsyncLocalStorage } from 'async_hooks';

export interface McpRequestContext {
  /** Base URL the calling Next.js process is listening on, e.g. http://localhost:4100 */
  baseUrl: string;
}

const storage = new AsyncLocalStorage<McpRequestContext>();

export function runWithMcpContext<T>(ctx: McpRequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getMcpBaseUrl(): string | undefined {
  return storage.getStore()?.baseUrl;
}
