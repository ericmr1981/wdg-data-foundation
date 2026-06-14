import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { assertApiSuccess } from '@/lib/api-error';

const QueryBonjurSalesSummaryInput = z.object({
  view: z.enum(['overview', 'trend', 'channels'])
    .describe('Summary view: overview (monthly KPIs), trend (12-month time series), channels (payment method breakdown)'),
  store_code: z.string().describe('Store code'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM')
    .describe('Month in YYYY-MM format (required for overview/channels)'),
});

const VIEW_PATH: Record<'overview' | 'trend' | 'channels', string> = {
  overview: '/api/bonjur/sales/overview',
  trend:    '/api/bonjur/sales/trend',
  channels: '/api/bonjur/sales/channels',
};

export const queryBonjurSalesSummaryTool = {
  name: 'query_bonjur_sales_summary',
  description: `Query Bonjur sales aggregated views by store.

**Parameters**:
- view (required): overview | trend | channels
- store_code (required): store code
- month (required for overview/channels): YYYY-MM

**Views**:
- overview: monthly KPIs (gross/revenue/net/order count, avg order amount)
- trend: 12-month time series of gross / revenue / order count
- channels: payment method breakdown (wechat / alipay / unionpay / cash / other)`,
  inputSchema: QueryBonjurSalesSummaryInput,
  async execute(params: z.infer<typeof QueryBonjurSalesSummaryInput>) {
    const { view, store_code, month } = params;
    const qs = new URLSearchParams({ store_code });
    if (view !== 'trend') qs.set('month', month);

    const res = await mcpFetch(`${VIEW_PATH[view]}?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'query_bonjur_sales_summary');
    return (json as Record<string, unknown>).data;
  },
};
