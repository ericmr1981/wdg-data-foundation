// AsyncLocalStorage<{ baseUrl, cookieHeader }> for the current MCP tool
// execution. Set by mcp/server.ts handleToolsCall (which derives baseUrl and
// reads cookie from the request). Read by mcpFetch() in tools/* to:
//   - construct correct localhost URLs (baseUrl)
//   - forward the user's auth cookie (cookieHeader) so internal API calls
//     authenticate as the same user

import { AsyncLocalStorage } from 'async_hooks';

export interface McpRequestContext {
  /** Base URL the calling Next.js process is listening on, e.g. http://localhost:4100 */
  baseUrl: string;
  /** Raw Cookie request header from the originating request, or null if none. */
  cookieHeader: string | null;
}

const storage = new AsyncLocalStorage<McpRequestContext>();

export function runWithMcpContext<T>(ctx: McpRequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getMcpBaseUrl(): string | undefined {
  return storage.getStore()?.baseUrl;
}

export function getMcpCookieHeader(): string | null | undefined {
  return storage.getStore()?.cookieHeader;
}
