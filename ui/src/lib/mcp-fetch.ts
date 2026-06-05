// Shared fetch wrapper for MCP tools. Reads the current request's base URL
// and cookie header from AsyncLocalStorage (set by mcp/server.ts handleToolsCall)
// and prepends/attaches them. Centralizes the localhost:3000 default and the
// x-mcp-session internal header convention.

import { getMcpBaseUrl, getMcpCookieHeader } from './mcp-request-context';

export async function mcpFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = getMcpBaseUrl() || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  // Merge headers: caller's init.headers + Cookie (from context) +
  // x-mcp-session marker. Caller's headers win on conflict.
  const ctxCookie = getMcpCookieHeader();
  const merged: Record<string, string> = {
    ...(ctxCookie ? { Cookie: ctxCookie } : {}),
    'x-mcp-session': 'internal',
    ...(init?.headers as Record<string, string> | undefined),
  };

  return fetch(url, {
    ...init,
    headers: merged,
  });
}
