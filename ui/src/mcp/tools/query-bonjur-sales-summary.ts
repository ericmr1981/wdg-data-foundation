import { z } from 'zod';

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
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ store_code });
    if (view !== 'trend') qs.set('month', month);

    const res = await fetch(`${baseUrl}${VIEW_PATH[view]}?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`query_bonjur_sales_summary failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};
