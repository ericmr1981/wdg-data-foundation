import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const QueryStoreReportTrendInput = z.object({
  brand: brandParamSchema.describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  store: z.string().describe('Store code'),
  months: z.number().int().min(1).max(24).optional().default(12)
    .describe('Number of trailing months (1-24, default 12)'),
});

export const queryStoreReportTrendTool = {
  name: 'query_store_report_trend',
  description: `Get historical KPI trend for a single store. Returns monthly time series for revenue / cost / expense / hr / rent / gross_profit / net_profit / operating_cf / cash_balance / loan_balance + rate metrics.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko
- store (required): store code
- months (optional): 1-24, default 12

**Response**: { month: string, values: { revenue_amt, cost_amt, hr_amt, rent_amt, gross_profit_amt, net_profit_amt, ... } }[]

**Note**: net_profit_amt / net_profit_rate_pct exclude EXP_OTHER/BONUS (分红/bonus payouts). Other EXP_OTHER items (TAX, REPAY, REFUND) ARE deducted. Months without cogs data return NULL.`,
  inputSchema: QueryStoreReportTrendInput,
  async execute(params: z.infer<typeof QueryStoreReportTrendInput>) {
    const { brand, store, months = 12 } = params;
    const qs = new URLSearchParams({ brand, store, months: String(months) });

    const res = await mcpFetch(`/api/store-report/trend?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'query_store_report_trend');
    const data = (json as Record<string, unknown>).data ?? { note: (json as Record<string, unknown>).note ?? 'no data' };
    // Attach download URLs for the latest month so the agent can share them
    const trendData = data as { monthly?: Array<{ month: string }> };
    if ((trendData as any).monthly?.length) {
      const latest = (trendData as any).monthly[(trendData as any).monthly.length - 1].month;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
      const exportQ = new URLSearchParams({ brand, store, month: latest }).toString();
      (data as any).download_urls = {
        excel: `${baseUrl}/api/store-report/export?${exportQ}`,
        pdf: `${baseUrl}/api/store-report/pdf?${exportQ}`,
      };
    }
    return data;
  },
};
