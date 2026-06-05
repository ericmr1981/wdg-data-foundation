// ui/src/lib/chat/mcp-bridge.ts
// Spec §3 / §4.3: translate Claude tool_use blocks into JSON-RPC 2.0
// requests for /api/mcp.

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function toolUseToMcpRequest(
  toolUseId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  rpcId: number | string,
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'tools/call',
    params: { name: toolName, arguments: toolInput },
  };
}

export class McpCallError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'McpCallError';
    this.code = code;
  }
}

export type McpResult =
  | { ok: true; text: string }
  | McpCallError;

export function parseMcpResult(body: unknown): McpResult {
  if (typeof body !== 'object' || body === null) {
    return new McpCallError(-32700, 'Non-object JSON-RPC response');
  }
  const b = body as { error?: { code: number; message: string }; result?: { content?: Array<{ type: string; text?: string }> } };
  if (b.error) {
    return new McpCallError(b.error.code, b.error.message);
  }
  const first = b.result?.content?.[0];
  if (first?.type === 'text' && typeof first.text === 'string') {
    return { ok: true, text: first.text };
  }
  return new McpCallError(-32603, 'Unexpected MCP response shape');
}

/**
 * POST a JSON-RPC request to the local /api/mcp endpoint.
 * Caller passes cookies for auth (forwarded from chat request).
 */
export async function callMcp(
  request: JsonRpcRequest,
  cookieHeader: string | null,
  baseUrl: string,
): Promise<McpResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
  } catch (e) {
    return new McpCallError(-32603, `fetch failed: ${(e as Error).message}`);
  }

  if (!res.ok) {
    return new McpCallError(res.status, `MCP HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    return new McpCallError(-32700, `non-JSON response: ${(e as Error).message}`);
  }
  return parseMcpResult(body);
}
