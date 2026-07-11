import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesOverviewTool = {
    name: 'query_tamkoko_sales_overview',
    description: '查询 tamkoko 收银明细月度 KPI 概览(营业额/营业收入/实收率/收益率/订单数),委托 brand_tamkoko_dm.v_cash_register_overview',
    inputSchema: z.object({
        store: z.string().optional().describe('store_code,如 sh_sjh。省略 = 返回所有门店数据(多店模式,按 store 分组)'),
        month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'YYYY-MM or YYYY-MM-DD').optional().describe('月份,如 2026-06 或 2026-06-01'),
    }),
    async execute(params: { store?: string; month?: string }) {
        const qs = new URLSearchParams();
        if (params.store) qs.set('store', params.store);
        if (params.month) qs.set('month', params.month);
        const url = `/api/tamkoko/sales/overview${qs.toString() ? `?${qs}` : ''}`;
        const res = await mcpFetch(url);
        if (!res.ok) throw new Error(`query_tamkoko_sales_overview failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
