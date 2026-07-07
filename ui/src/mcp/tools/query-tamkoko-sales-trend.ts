import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesTrendTool = {
    name: 'query_tamkoko_sales_trend',
    description: '查询 tamkoko 最近 N 个月趋势(默认 12),委托 v_cash_register_overview',
    inputSchema: z.object({
        store: z.string().optional().describe('store_code,如 sh_sjh。省略 = 返回所有门店数据(多店模式,按 store 分组)'),
        months: z.number().int().min(1).max(24).optional().default(12),
    }),
    async execute(params: { store?: string; months?: number }) {
        const qs = new URLSearchParams();
        if (params.store) qs.set('store', params.store);
        qs.set('months', String(params.months ?? 12));
        const res = await mcpFetch(`/api/tamkoko/sales/trend?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_trend failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
