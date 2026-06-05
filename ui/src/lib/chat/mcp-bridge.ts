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

/**
 * callMcp with automatic retry on 5xx / network errors.
 * 4xx errors are NOT retried (they're caller errors, retrying won't help).
 *
 * @param onRetry Called BEFORE sleeping to wait for next attempt.
 *                `attempt` is the 1-indexed attempt number that just failed.
 */
export async function callMcpWithRetry(
  request: JsonRpcRequest,
  cookieHeader: string | null,
  baseUrl: string,
  onRetry: (attempt: number, maxAttempts: number, err: McpCallError) => void,
  maxAttempts: number = 2,
): Promise<McpResult> {
  let lastErr: McpCallError | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await callMcp(request, cookieHeader, baseUrl);
    if (!(r instanceof McpCallError)) return r;
    lastErr = r;
    const shouldRetry = r.code >= 500 || r.code < 0; // 5xx or network (negative code)
    if (!shouldRetry) return r;
    if (attempt < maxAttempts) {
      onRetry(attempt, maxAttempts, r);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return lastErr!;
}
