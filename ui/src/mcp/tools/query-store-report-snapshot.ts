import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

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

**Response**: revenue / cost / expense / hr / rent / gross_profit / net_profit / operating_cf / cash_balance / loan_balance + rate metrics (gross_profit_rate_pct, net_profit_rate_pct, hr_ratio_pct, rent_ratio_pct, cashflow_runway_months).`,
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
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
