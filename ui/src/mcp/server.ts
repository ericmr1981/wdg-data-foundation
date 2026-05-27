import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

// Tool registry — keyed by method name, same as tool.name
import { uploadBankTxnTool } from './tools/upload-bank-txn';
import { uploadGelatomiiixIncomeDetailTool } from './tools/upload-gelatomiiix-income-detail';
import { getUnclassifiedTool } from './tools/get-unclassified';
import { getTxnDetailTool } from './tools/get-txn-detail';
import { getCandidatesTool } from './tools/get-candidates';
import { getRulesTool } from './tools/get-rules';
import { submitProposalTool } from './tools/submit-proposal';
import { queryStatusTool } from './tools/query-status';
import { getBrandStoresTool } from './tools/get-brand-stores';
import { queryGelatomiiixIncomeTool } from './tools/query-gelatomiiix-income';
import { uploadBonjurSalesSelfServiceTool } from './tools/upload-bonjur-sales-self-service';

type ToolModule = {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (params: any) => Promise<unknown>;
};

const TOOLS: Record<string, ToolModule> = {
  upload_bank_txn_file:   uploadBankTxnTool,
  upload_gelatomiiix_income_detail: uploadGelatomiiixIncomeDetailTool,
  upload_bonjur_sales_self_service: uploadBonjurSalesSelfServiceTool,
  get_unclassified:       getUnclassifiedTool,
  get_transaction_detail: getTxnDetailTool,
  get_candidates:         getCandidatesTool,
  get_existing_rules:     getRulesTool,
  submit_approval_proposal: submitProposalTool,
  query_approval_status:   queryStatusTool,
  get_brand_stores:       getBrandStoresTool,
  query_gelatomiiix_income: queryGelatomiiixIncomeTool,
};

/** Try short-name match, then long-name match */
function resolveTool(name: string): ToolModule | undefined {
  return TOOLS[name] ?? Object.values(TOOLS).find(t => t.name === name);
}

// JSON-RPC 2.0 request shape
const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id:      z.union([z.string(), z.number(), z.null()]),
  method:  z.string(),
  params:  z.record(z.unknown()).optional().default({}),
});

// JSON-RPC 2.0 response
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } };

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/**
 * Build the JSON-RPC "tools/list" result from the tool registry.
 */
function listToolsResult() {
  return {
    tools: Object.values(TOOLS).map(t => ({
      name:        t.name,
      description: t.description,
      inputSchema: {}, // JSON-RPC mode — clients use tool.name for dispatch
    })),
  };
}

/**
 * Dispatch a JSON-RPC "tools/call" request to the correct tool handler.
 */
async function handleToolsCall(id: string | number | null, params: Record<string, unknown>): Promise<JsonRpcResponse> {
  const toolName = params.name as string | undefined;
  const toolArgs = params.arguments as Record<string, unknown> | undefined;

  if (!toolName) {
    return jsonRpcError(id, -32600, 'Invalid Request: missing "name" in params');
  }

  const tool = resolveTool(toolName);
  if (!tool) {
    return jsonRpcError(id, -32602, `Method not found: ${toolName}`);
  }

  try {
    // Validate input against the tool's Zod schema
    const parsed = tool.inputSchema.safeParse(toolArgs ?? {});
    if (!parsed.success) {
      return jsonRpcError(id, -32602, `Invalid params for ${toolName}: ${parsed.error.message}`);
    }

    const rawResult = await tool.execute(parsed.data);

    // Convert plain object result → MCP CallToolResult content array
    const result: CallToolResult = {
      content: [
        {
          type: 'text',
          text: typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2),
        },
      ],
    };

    return { jsonrpc: '2.0', id, result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRpcError(id, -32603, `Internal error in ${toolName}: ${msg}`);
  }
}

/**
 * Handle an incoming JSON-RPC 2.0 request.
 */
export async function handleJsonRpcRequest(body: unknown): Promise<JsonRpcResponse> {
  const parsed = JsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonRpcError(null, -32600, `Invalid Request: ${parsed.error.message}`);
  }

  const { id, method, params } = parsed.data;

  // Standard JSON-RPC discovery
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: listToolsResult() };
  }

  if (method === 'tools/call') {
    return handleToolsCall(id, params);
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'wdg-bank-agent', version: '1.0.0' },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: null };
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}