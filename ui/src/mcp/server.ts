import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { runWithMcpContext } from '@/lib/mcp-request-context';

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
import { getUnmatchedOrdersTool } from './tools/get-unmatched-orders';
import { getSettlementCycleReconTool } from './tools/get-settlement-cycle-recon';
import { getTaobaoReconTool } from './tools/get-taobao-recon';
import { getMeituanReconTool } from './tools/get-meituan-recon';
import { getMeituanTuangouReconTool } from './tools/get-meituan-tuangou-recon';
import { getDouyinReconTool } from './tools/get-douyin-recon';
import { getGelatoWechatReconTool } from './tools/get-gelato-wechat-recon';
import { getGelatoAlipayReconTool } from './tools/get-gelato-alipay-recon';
import { queryBonjurQimaiSalesTool } from './tools/query-bonjur-qimai-sales';
import { queryGelatomiiixIncomeTool } from './tools/query-gelatomiiix-income';
import { uploadBonjurIncomeDetailTool } from './tools/upload-bonjur-income-detail';
import { uploadBonjurProductSalesTool } from './tools/upload-bonjur-product-sales';
import { uploadGelatomiiixProductSalesTool } from './tools/upload-gelatomiiix-product-sales';
import { uploadBonjurSalesSelfServiceTool } from './tools/upload-bonjur-sales-self-service';
import { queryStoreReportSnapshotTool } from './tools/query-store-report-snapshot';
import { queryStoreReportTrendTool } from './tools/query-store-report-trend';
import { queryFinancialStatementTool } from './tools/query-financial-statement';
import { queryBonjurSalesSummaryTool } from './tools/query-bonjur-sales-summary';
import { getPipelineKpiTool } from './tools/get-pipeline-kpi';
import { getInventoryTurnoverTool } from './tools/get-inventory-turnover';
import { getInventorySummaryTool } from './tools/get-inventory-summary';
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
  queryGelatomiiixSalesHourlyTool,
  queryGelatomiiixSalesDineTakeawayTool,
  queryGelatomiiixSalesDailyTool,
  queryGelatomiiixSalesChannelDailyTool,
  queryGelatomiiixSalesSpecTool,
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
import { createStoreTool } from './tools/create-store';
import { uploadTamkokoCashRegisterTool } from './tools/upload-tamkoko-cash-register';
import { queryTamkokoSalesOverviewTool } from './tools/query-tamkoko-sales-overview';
import { queryTamkokoSalesChannelTool } from './tools/query-tamkoko-sales-channel';
import { queryTamkokoSalesDineTakeawayTool } from './tools/query-tamkoko-sales-dine-takeaway';
import { queryTamkokoSalesMealPeriodTool } from './tools/query-tamkoko-sales-meal-period';
import { queryTamkokoSalesWeekdayTool } from './tools/query-tamkoko-sales-weekday';
import { queryTamkokoSalesMultiStoreTool } from './tools/query-tamkoko-sales-multi-store';
import { queryTamkokoSalesTrendTool } from './tools/query-tamkoko-sales-trend';
import { queryTamkokoSalesDailyTool } from './tools/query-tamkoko-sales-daily';

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
  upload_gelatomiiix_product_sales: uploadGelatomiiixProductSalesTool,
  upload_bonjur_sales_self_service: uploadBonjurSalesSelfServiceTool,
  get_unclassified:       getUnclassifiedTool,
  get_transaction_detail: getTxnDetailTool,
  get_candidates:         getCandidatesTool,
  get_existing_rules:     getRulesTool,
  get_qimai_entry_rate:   getQimaiEntryRateTool,
  get_unmatched_orders:   getUnmatchedOrdersTool,
  get_settlement_cycle_recon: getSettlementCycleReconTool,
  get_taobao_recon: getTaobaoReconTool,
  get_meituan_recon: getMeituanReconTool,
  get_meituan_tuangou_recon: getMeituanTuangouReconTool,
  get_douyin_recon: getDouyinReconTool,
  get_gelato_wechat_recon: getGelatoWechatReconTool,
  get_gelato_alipay_recon: getGelatoAlipayReconTool,
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
  get_inventory_turnover:      getInventoryTurnoverTool,
  get_inventory_summary:       getInventorySummaryTool,
  preview_match:               previewMatchTool,
  upload_tamkoko_inventory:    uploadTamkokoInventoryTool,
  query_financial_overview:    queryFinancialOverviewTool,
  query_financial_kpi_trend:   queryFinancialKpiTrendTool,
  query_counterparty:          queryCounterpartyTool,
  query_income_metrics:        queryIncomeMetricsTool,
  query_payment_metrics:       queryPaymentMetricsTool,
  query_qimai_revenue:         queryQimaiRevenueTool,
  query_gelatomiiix_sales_overview:     queryGelatomiiixSalesOverviewTool,
  query_gelatomiiix_sales_trend:        queryGelatomiiixSalesTrendTool,
  query_gelatomiiix_sales_channels:     queryGelatomiiixSalesChannelsTool,
  query_gelatomiiix_sales_products:     queryGelatomiiixSalesProductsTool,
  query_gelatomiiix_sales_hourly:       queryGelatomiiixSalesHourlyTool,
  query_gelatomiiix_sales_dine_takeaway:queryGelatomiiixSalesDineTakeawayTool,
  query_gelatomiiix_sales_daily:        queryGelatomiiixSalesDailyTool,
  query_gelatomiiix_sales_channel_daily:queryGelatomiiixSalesChannelDailyTool,
  query_gelatomiiix_sales_spec_analysis:queryGelatomiiixSalesSpecTool,
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
  create_store:                        createStoreTool,
  upload_tamkoko_cash_register:       uploadTamkokoCashRegisterTool,
  query_tamkoko_sales_overview:       queryTamkokoSalesOverviewTool,
  query_tamkoko_sales_channel:        queryTamkokoSalesChannelTool,
  query_tamkoko_sales_dine_takeaway:  queryTamkokoSalesDineTakeawayTool,
  query_tamkoko_sales_meal_period:    queryTamkokoSalesMealPeriodTool,
  query_tamkoko_sales_weekday:        queryTamkokoSalesWeekdayTool,
  query_tamkoko_sales_multi_store:    queryTamkokoSalesMultiStoreTool,
  query_tamkoko_sales_trend:         queryTamkokoSalesTrendTool,
  query_tamkoko_sales_daily:         queryTamkokoSalesDailyTool,
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
  // Re-use listToolSchemas so the JSON-RPC `tools/list` returns the same
  // zod-derived input_schema that the chat adapter sees.  Previously this
  // returned `inputSchema: {}` and the admin Tools page rendered an empty
  // schema panel.
  return {
    tools: listToolSchemas().map(t => ({
      name:        t.name,
      description: t.description,
      inputSchema: t.input_schema,
    })),
  };
}

/**
 * Dispatch a JSON-RPC "tools/call" request to the correct tool handler.
 */
async function handleToolsCall(
  id: string | number | null,
  params: Record<string, unknown>,
  baseUrl: string,
  cookieHeader: string | null,
): Promise<JsonRpcResponse> {
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

    // Set the AsyncLocalStorage context so mcpFetch() inside tool.execute()
    // knows the origin of the calling Next.js process (e.g. http://localhost:4100)
    // and forwards the user's auth cookie.
    const rawResult = await runWithMcpContext(
      { baseUrl, cookieHeader },
      () => tool.execute(parsed.data),
    );

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
 *
 * @param body         The parsed JSON-RPC request body.
 * @param baseUrl      Optional. The origin URL of the calling Next.js process
 *                     (e.g. "http://localhost:4100"). Used to set the
 *                     AsyncLocalStorage context that mcpFetch() reads, so
 *                     tools' internal fetch() calls hit the right host/port.
 *                     Falls back to NEXT_PUBLIC_APP_URL or localhost:3000.
 * @param cookieHeader Optional. Raw Cookie header from the originating
 *                     request. Forwarded into the AsyncLocalStorage context
 *                     so tools' internal fetch() calls authenticate as the
 *                     same user. Pass null if the caller is unauthenticated.
 */
export async function handleJsonRpcRequest(
  body: unknown,
  baseUrl?: string,
  cookieHeader?: string | null,
): Promise<JsonRpcResponse> {
  const parsed = JsonRpcRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonRpcError(null, -32600, `Invalid Request: ${parsed.error.message}`);
  }

  const { id, method, params } = parsed.data;
  const resolvedBaseUrl = baseUrl
    || process.env.NEXT_PUBLIC_APP_URL
    || 'http://localhost:3000';
  const resolvedCookie = cookieHeader ?? null;

  // Standard JSON-RPC discovery
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: listToolsResult() };
  }

  if (method === 'tools/call') {
    return handleToolsCall(id, params, resolvedBaseUrl, resolvedCookie);
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'wdg-bank-agent', version: '1.1.0' },
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
  if (z instanceof ZodString) {
    const out: Record<string, unknown> = { ...desc, type: 'string' };
    // Zod v3: ._def.checks 里可能有 { kind:'regex', regex:/.../, ... },
    // 提取第一个 regex → JSON Schema pattern。
    try {
      const def = (z as any)._def;
      if (def?.checks) {
        for (const c of def.checks) {
          if (c.kind === 'regex' && c.regex) {
            out.pattern = c.regex.source;   // 例如 "^\d{4}-\d{2}(-\d{2})?$"
            break;
          }
        }
      }
      // 也尝试 Zod v4 的 _zod (兼容未来升级)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_) { /* ignore */ }
    return out;
  }
  if (z instanceof ZodNumber)  return { ...desc, type: 'number' };
  if (z instanceof ZodBoolean) return { ...desc, type: 'boolean' };
  if (z instanceof ZodArray)   return { ...desc, type: 'array', items: describeZod(z.element) };
  if (z instanceof ZodEnum)    return { ...desc, type: 'string', enum: z.options };
  if (z instanceof ZodObject)  return zodToJsonSchemaSafe(z);
  if (z instanceof ZodOptional) return describeZod(z.unwrap());
  if (z instanceof ZodNullable) return { ...describeZod(z.unwrap()), nullable: true };
  return desc;
}