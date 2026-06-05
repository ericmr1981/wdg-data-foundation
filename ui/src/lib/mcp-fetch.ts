// Shared fetch wrapper for MCP tools. Reads the current request's base URL
// from AsyncLocalStorage (set by mcp/server.ts handleToolsCall) and prepends
// it to relative paths. Centralizes the localhost:3000 default.

import { getMcpBaseUrl } from './mcp-request-context';

export async function mcpFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = getMcpBaseUrl() || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, init);
}
