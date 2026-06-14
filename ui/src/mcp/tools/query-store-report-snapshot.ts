import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const QueryStoreReportSnapshotInput = z.object({
  brand: brandParamSchema.describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  store: z.string().describe('Store code'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Month in YYYY-MM format'),
});

export const queryStoreReportSnapshotTool = {
  name: 'query_store_report_snapshot',
  description: `Get the monthly store KPI snapshot for a single store. Returns current month + previous month for MoM comparison.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko
- store (required): store code
- month (required): YYYY-MM

**Response**: revenue / cost / expense / hr / rent / gross_profit / net_profit / operating_cf / cash_balance / loan_balance + rate metrics (gross_profit_rate_pct, net_profit_rate_pct, hr_ratio_pct, rent_ratio_pct, cashflow_runway_months).

**Download**: After calling this tool, if the user wants to download the report, tell them to click one of the links in the download_urls field (excel or pdf). Render the URLs as clickable markdown links: [📥 下载 Excel](url) and [📄 下载 PDF](url).

**Note**: net_profit_amt / net_profit_rate_pct exclude EXP_OTHER/BONUS (分红/bonus payouts). Other EXP_OTHER items (TAX, REPAY, REFUND) ARE deducted. For unprofitable months, view returns NULL.`,
  inputSchema: QueryStoreReportSnapshotInput,
  async execute(params: z.infer<typeof QueryStoreReportSnapshotInput>) {
    const { brand, store, month } = params;
    const qs = new URLSearchParams({ brand, store, month });

    const res = await mcpFetch(`/api/store-report/snapshot?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'query_store_report_snapshot');
    const data = (json as Record<string, unknown>).data ?? { note: (json as Record<string, unknown>).note ?? 'no data' };
    // Attach download URLs so the agent can share them with the user
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const exportQ = new URLSearchParams({ brand, store, month }).toString();
    (data as any).download_urls = {
      excel: `${baseUrl}/api/store-report/export?${exportQ}`,
      pdf: `${baseUrl}/api/store-report/pdf?${exportQ}`,
    };
    return data;
  },
};
