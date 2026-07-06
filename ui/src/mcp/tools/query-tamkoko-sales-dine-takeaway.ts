import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesDineTakeawayTool = {
    name: 'query_tamkoko_sales_dine_takeaway',
    description: '查询 tamkoko 堂食 vs 外卖月度对比,委托 v_cash_register_dine_takeaway',
    inputSchema: z.object({
        store: z.string().optional(),
        month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        type: z.string().optional().describe('堂食 / 外卖'),
    }),
    async execute(params: { store?: string; month?: string; type?: string }) {
        const qs = new URLSearchParams();
        if (params.store) qs.set('store', params.store);
        if (params.month) qs.set('month', params.month);
        if (params.type) qs.set('type', params.type);
        const res = await mcpFetch(`/api/tamkoko/sales/dine-takeaway?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_dine_takeaway failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
