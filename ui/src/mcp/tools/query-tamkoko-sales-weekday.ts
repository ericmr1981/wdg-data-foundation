import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesWeekdayTool = {
    name: 'query_tamkoko_sales_weekday',
    description: '查询 tamkoko 按周+星期几分布(0=周日..6=周六),委托 v_cash_register_weekday',
    inputSchema: z.object({
        store: z.string().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    async execute(params: { store?: string; from?: string; to?: string }) {
        const qs = new URLSearchParams();
        if (params.store) qs.set('store', params.store);
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        const res = await mcpFetch(`/api/tamkoko/sales/weekday?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_weekday failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
