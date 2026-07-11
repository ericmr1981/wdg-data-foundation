import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { getMcpBaseUrl } from '@/lib/mcp-request-context';

const QueryStoreReportSnapshotInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur', 'tamkoko']).describe('Brand code'),
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

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`query_store_report_snapshot failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    const data = json.data ?? { note: json.note ?? 'no data' };
    // Attach download URLs so the agent can share them with the user
    const baseUrl = getMcpBaseUrl() || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const exportQ = new URLSearchParams({ brand, store, month }).toString();
    (data as any).download_urls = {
      excel: `${baseUrl}/api/store-report/export?${exportQ}`,
      pdf: `${baseUrl}/api/store-report/pdf?${exportQ}`,
    };
    return data;
  },
};
