import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesDailyTool = {
    name: 'query_tamkoko_sales_daily',
    description: '查询 tamkoko 月内日级趋势(drill-down),委托 v_cash_register_daily,month 必填 YYYY-MM-01',
    inputSchema: z.object({
        store: z.string().optional(),
        month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-01'),
    }),
    async execute(params: { store?: string; month: string }) {
        const qs = new URLSearchParams({ month: params.month });
        if (params.store) qs.set('store', params.store);
        const res = await mcpFetch(`/api/tamkoko/sales/daily?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_daily failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
