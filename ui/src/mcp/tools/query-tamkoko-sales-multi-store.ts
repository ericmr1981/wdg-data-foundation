import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesMultiStoreTool = {
    name: 'query_tamkoko_sales_multi_store',
    description: '查询 tamkoko 所有门店月度 KPI 对比 + gross rank,用于多店比对分析。委托 v_cash_register_multi_store',
    inputSchema: z.object({
        month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'YYYY-MM or YYYY-MM-DD').describe('月份,如 2026-06 或 2026-06-01'),
    }),
    async execute(params: { month: string }) {
        const qs = new URLSearchParams({ month: params.month });
        const res = await mcpFetch(`/api/tamkoko/sales/multi-store?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_multi_store failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
