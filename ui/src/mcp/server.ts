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
import { getQimaiEntryRateTool } from './tools/get-qimai-entry-rate';
import { queryBonjurQimaiSalesTool } from './tools/query-bonjur-qimai-sales';
import { queryGelatomiiixIncomeTool } from './tools/query-gelatomiiix-income';
import { uploadBonjurIncomeDetailTool } from './tools/upload-bonjur-income-detail';
import { uploadBonjurProductSalesTool } from './tools/upload-bonjur-product-sales';
import { uploadBonjurSalesSelfServiceTool } from './tools/upload-bonjur-sales-self-service';
import { queryStoreReportSnapshotTool } from './tools/query-store-report-snapshot';
import { queryStoreReportTrendTool } from './tools/query-store-report-trend';
import { queryFinancialStatementTool } from './tools/query-financial-statement';
import { queryBonjurSalesSummaryTool } from './tools/query-bonjur-sales-summary';
import { getPipelineKpiTool } from './tools/get-pipeline-kpi';
import { previewMatchTool } from './tools/preview-match';
import { uploadTamkokoInventoryTool } from './tools/upload-tamkoko-inventory';
import { queryFinancialOverviewTool } from './tools/query-financial-overview';
import { queryFinancialKpiTrendTool } from './tools/query-financial-kpi-trend';
import { queryCounterpartyTool } from './tools/query-counterparty';
import { queryIncomeMetricsTool } from './tools/query-income-metrics';
import { queryPaymentMetricsTool } from './tools/query-payment-metrics';
import { queryQimaiRevenueTool } from './tools/query-qimai-revenue';
import {
  queryGelatomiiixSalesOverviewTool,
  queryGelatomiiixSalesTrendTool,
  queryGelatomiiixSalesChannelsTool,
  queryGelatomiiixSalesProductsTool,
  queryGelatomiiixSalesDetailsTool,
  queryGelatomiiixSalesDistributionTool,
  queryGelatomiiixSalesHourlyTool,
} from './tools/query-gelatomiiix-sales';
import {
  queryBonjurSalesProductsTool,
  queryBonjurSalesDetailsTool,
} from './tools/query-bonjur-sales';
import { getCoverageByFileTool } from './tools/get-coverage-by-file';
import { getUnclassifiedByFileTool } from './tools/get-unclassified-by-file';
import { getProposalTool } from './tools/get-proposal';
import { getRulesHistoryTool } from './tools/get-rules-history';
import { listRuleFilesTool } from './tools/list-rule-files';
import { listRuleGroupsTool } from './tools/list-rule-groups';
import { listCategoriesTool } from './tools/list-categories';
import { rerunMatchByFileTool } from './tools/rerun-match-by-file';

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
  upload_bonjur_income_detail: uploadBonjurIncomeDetailTool,
  upload_bonjur_product_sales: uploadBonjurProductSalesTool,
  upload_bonjur_sales_self_service: uploadBonjurSalesSelfServiceTool,
  get_unclassified:       getUnclassifiedTool,
  get_transaction_detail: getTxnDetailTool,
  get_candidates:         getCandidatesTool,
  get_existing_rules:     getRulesTool,
  get_qimai_entry_rate:   getQimaiEntryRateTool,
  submit_approval_proposal: submitProposalTool,
  query_approval_status:   queryStatusTool,
  query_bonjur_qimai_sales: queryBonjurQimaiSalesTool,
  get_brand_stores:       getBrandStoresTool,
  query_gelatomiiix_income: queryGelatomiiixIncomeTool,
  query_store_report_snapshot: queryStoreReportSnapshotTool,
  query_store_report_trend:    queryStoreReportTrendTool,
  query_financial_statement:   queryFinancialStatementTool,
  query_bonjur_sales_summary:  queryBonjurSalesSummaryTool,
  get_pipeline_kpi:            getPipelineKpiTool,
  preview_match:               previewMatchTool,
  upload_tamkoko_inventory:    uploadTamkokoInventoryTool,
  query_financial_overview:    queryFinancialOverviewTool,
  query_financial_kpi_trend:   queryFinancialKpiTrendTool,
  query_counterparty:          queryCounterpartyTool,
  query_income_metrics:        queryIncomeMetricsTool,
  query_payment_metrics:       queryPaymentMetricsTool,
  query_qimai_revenue:         queryQimaiRevenueTool,
  query_gelatomiiix_sales_overview:    queryGelatomiiixSalesOverviewTool,
  query_gelatomiiix_sales_trend:       queryGelatomiiixSalesTrendTool,
  query_gelatomiiix_sales_channels:    queryGelatomiiixSalesChannelsTool,
  query_gelatomiiix_sales_products:    queryGelatomiiixSalesProductsTool,
  query_gelatomiiix_sales_details:     queryGelatomiiixSalesDetailsTool,
  query_gelatomiiix_sales_distribution: queryGelatomiiixSalesDistributionTool,
  query_gelatomiiix_sales_hourly:      queryGelatomiiixSalesHourlyTool,
  query_bonjur_sales_products:         queryBonjurSalesProductsTool,
  query_bonjur_sales_details:          queryBonjurSalesDetailsTool,
  get_coverage_by_file:                getCoverageByFileTool,
  get_unclassified_by_file:            getUnclassifiedByFileTool,
  get_proposal:                        getProposalTool,
  get_rules_history:                   getRulesHistoryTool,
  list_rule_files:                     listRuleFilesTool,
  list_rule_groups:                    listRuleGroupsTool,
  list_categories:                     listCategoriesTool,
  rerun_match_by_file:                 rerunMatchByFileTool,
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

// ui/src/mcp/server.ts (追加)
/**
 * Public schema snapshot for the chat adapter. Re-uses the live tool
 * registry so changes to TOOLS propagate without code edits.
 * Returns Anthropic-compatible tool definitions (name + description +
 * input_schema in JSON Schema form).
 */
import {
  ZodObject,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodArray,
  ZodEnum,
  ZodOptional,
  ZodNullable,
  ZodType,
} from 'zod';

export function listToolSchemas(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return Object.values(TOOLS).map(t => ({
    name: t.name,
    description: t.description,
    // Zod → JSON Schema.  We re-use the zod instance; for the chat
    // adapter a best-effort description is enough (the MCP dispatcher
    // re-validates server-side).
    input_schema: zodToJsonSchemaSafe(t.inputSchema),
  }));
}

function zodToJsonSchemaSafe(schema: ZodType<unknown>): Record<string, unknown> {
  // Minimal subset: object → {type:'object', properties, required}
  // Zod v3 exposes .shape on ZodObject.  Fall back to {} otherwise.
  if (schema instanceof ZodObject) {
    const shape = schema.shape as Record<string, ZodType<unknown>>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = describeZod(value);
      if (!value.isOptional()) required.push(key);
    }
    const out: Record<string, unknown> = { type: 'object', properties };
    if (required.length) out.required = required;
    return out;
  }
  return {};
}

function describeZod(z: ZodType<unknown>): Record<string, unknown> {
  const desc = (z.description ? { description: z.description } : {});
  if (z instanceof ZodString)  return { ...desc, type: 'string' };
  if (z instanceof ZodNumber)  return { ...desc, type: 'number' };
  if (z instanceof ZodBoolean) return { ...desc, type: 'boolean' };
  if (z instanceof ZodArray)   return { ...desc, type: 'array', items: describeZod(z.element) };
  if (z instanceof ZodEnum)    return { ...desc, type: 'string', enum: z.options };
  if (z instanceof ZodObject)  return zodToJsonSchemaSafe(z);
  if (z instanceof ZodOptional) return describeZod(z.unwrap());
  if (z instanceof ZodNullable) return { ...describeZod(z.unwrap()), nullable: true };
  return desc;
}