import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetQimaiEntryRateInput = z.object({
  brand: z.enum(['gelatomiiix', 'bonjur', 'tamkoko', 'yufeng', 'xintiandi'])
    .describe('Brand code'),
  period: z.string().describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
});

export const getQimaiEntryRateTool = {
  name: 'get_qimai_entry_rate',
  description: `Analyze Qimai-to-bank entry rate for any supported brand. Compares Qimai income detail (net_amt) against bank transaction entries classified as REV_BIZ.

**Note**: Only brands with both income_detail ODS and bank_txn_classified_snapshot are supported.

**Tamkoko special**: WECHAT and ALIPAY channels are merged into a single \`WECHAT_ALIPAY\` row. Tamkoko's WeChat/Alipay orders are settled via parent-company (苏州泰柯) bank transfers, not direct merchant settlement — the merged card reflects the parent-company transfer health rather than the actual WeChat/Alipay merchant entries. Other brands keep WECHAT and ALIPAY as separate rows.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko | yufeng | xintiandi
  - gelatomiiix, bonjur, tamkoko: supported
  - yufeng: not_supported (no income_detail DDL)
  - xintiandi: not_deployed (template only)
- period (required): YYYY-MM format
- span (optional): month (default), quarter, or year
- store (optional): filter by store

**Response**: channel-level entry rates, monthly trend, unmatched order aggregates`,
  inputSchema: GetQimaiEntryRateInput,
  async execute(params: z.infer<typeof GetQimaiEntryRateInput>) {
    const { brand, period, span = 'month', store } = params;
    const qs = new URLSearchParams({ brand, period, span });
    if (store) qs.set('store', store);

    const res = await mcpFetch(`/api/income/bank-entry-stats?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_qimai_entry_rate failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};