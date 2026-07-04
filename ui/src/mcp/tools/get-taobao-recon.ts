import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetTaobaoReconInput = z.object({
  brand: z.enum(['tamkoko']).describe('Brand code (only tamkoko supported)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to all)'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month, quarter, or year'),
  store: z.string().optional().describe('Filter by store code'),
  t_offset: z.number().int().min(0).optional()
    .describe('Use T+N daily aggregation mode (e.g. 3 = T+3). Only suitable for 世纪汇店 (wz_bjwxc) where orders settle daily. Default LAG mode for other stores.'),
});

export const getTaobaoReconTool = {
  name: 'get_taobao_recon',
  description: 'Taobao (网商银行) settlement reconciliation for Tamkoko (泰柯茶园). Matches Qimai orders against bank entries from 网商银行 (Rule 421 银行分类).\n\n**Two modes**:\n1. **LAG mode (default)**: LAG-based window matching — each bank entry covers the Qimai order range [prev_txn_time + 1 day, current_txn_time - 3 days]. Suitable for 富阳店 (hz_fuyang).\n2. **T+N daily mode** (pass t_offset): Daily aggregation with T+N offset. Suitable for 世纪汇店 (sh_sjh). Default T+3 (calibrated against Dec 2025 data).\n\n**Parameters**:\n- brand (required): tamkoko only\n- period (optional): YYYY-MM format; defaults to all historical data\n- span (optional): month (default), quarter, or year\n- store (optional): filter by store code\n- t_offset (optional): T+N offset in days. Pass to switch to daily aggregation mode. Omit for LAG mode.\n\n**Returns**: { brand, period, span, store, mode, t_offset, rows: [...] }',
  inputSchema: GetTaobaoReconInput,
  async execute(params: z.infer<typeof GetTaobaoReconInput>) {
    const { brand, period, span = 'month', store, t_offset } = params;
    const qs = new URLSearchParams({ brand, span });
    if (period) qs.set('period', period);
    if (store) qs.set('store', store);
    if (t_offset !== undefined) qs.set('t_offset', String(t_offset));

    const res = await mcpFetch('/api/income/taobao-recon?' + qs, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error('get_taobao_recon failed: ' + err);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};