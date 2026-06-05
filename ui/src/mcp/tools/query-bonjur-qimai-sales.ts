import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const QueryBonjurQimaiSalesInput = z.object({
  month: z.string().optional().describe('Month in YYYY-MM format (required if date_from/date_to not provided)'),
  date_from: z.string().optional().describe('Start date YYYY-MM-DD'),
  date_to: z.string().optional().describe('End date YYYY-MM-DD'),
  store: z.string().optional().describe('Filter by store code'),
  summary_only: z.boolean().optional().default(false).describe('Return aggregated summary instead of detail'),
});

export const queryBonjurQimaiSalesTool = {
  name: 'query_bonjur_qimai_sales',
  description: `Query Bonjur Qimai POS channel sales (微信支付-企迈数店POS / 支付宝支付-企迈数店POS).

**Parameters**:
- month (conditional): YYYY-MM format
- store (optional): filter by store
- summary_only (optional): true returns aggregated totals

**Use cases**: check daily Qimai POS sales, compare wechat vs alipay POS revenue`,
  inputSchema: QueryBonjurQimaiSalesInput,
  async execute(params: z.infer<typeof QueryBonjurQimaiSalesInput>) {
    const { month, date_from, date_to, store, summary_only = false } = params;
    const qs = new URLSearchParams();
    if (month) qs.set('month', month);
    if (date_from) qs.set('date_from', date_from);
    if (date_to) qs.set('date_to', date_to);
    if (store) qs.set('store', store);
    if (summary_only) qs.set('summary_only', 'true');

    const res = await mcpFetch(`/api/bonjur/sales/qimai-pos?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`query_bonjur_qimai_sales failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};
