import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { assertApiSuccess } from '@/lib/api-error';

const QueryGelatomiiixIncomeInput = z.object({
  month: z.string().optional().describe('Month in YYYY-MM format (required if date_from/date_to not provided)'),
  date_from: z.string().optional().describe('Start date YYYY-MM-DD (required if month not provided)'),
  date_to: z.string().optional().describe('End date YYYY-MM-DD (required if month not provided)'),
  channel: z.enum(['WECHAT', 'ALIPAY', 'MEITUAN', 'UNIONPAY', 'DOUYIN', 'ELEME', 'JD', 'OTHER']).optional()
    .describe('Filter by payment channel'),
  store: z.string().optional().describe('Filter by store code'),
  summary_only: z.boolean().optional().default(false).describe('Return aggregated summary instead of detail'),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().positive().max(200).optional().default(100),
});

export const queryGelatomiiixIncomeTool = {
  name: 'query_gelatomiiix_income',
  description: `Query Qimai income detail records for Gelatomiiix brand.

**Parameters**:
- month (conditional): YYYY-MM format, or use date_from/date_to
- channel (optional): WECHAT | ALIPAY | MEITUAN | UNIONPAY | DOUYIN | ELEME | JD | OTHER
- store (optional): filter by store
- summary_only (optional): true returns aggregated data by channel

**Use cases**: find specific orders, check payment channel breakdown, verify transaction details`,
  inputSchema: QueryGelatomiiixIncomeInput,
  async execute(params: z.infer<typeof QueryGelatomiiixIncomeInput>) {
    const { month, date_from, date_to, channel, store, summary_only = false, page = 1, page_size = 100 } = params;
    const qs = new URLSearchParams();
    if (month) qs.set('month', month);
    if (date_from) qs.set('date_from', date_from);
    if (date_to) qs.set('date_to', date_to);
    if (channel) qs.set('channel', channel);
    if (store) qs.set('store', store);
    if (summary_only) qs.set('summary_only', 'true');
    qs.set('page', String(page));
    qs.set('page_size', String(page_size));

    const res = await mcpFetch(`/api/gelatomiiix/income/qimai-detail?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'query_gelatomiiix_income');
    return (json as Record<string, unknown>).data;
  },
};
