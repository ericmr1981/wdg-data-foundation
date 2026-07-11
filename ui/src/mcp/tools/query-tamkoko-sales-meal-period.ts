import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesMealPeriodTool = {
    name: 'query_tamkoko_sales_meal_period',
    description: '查询 tamkoko 按餐段(早/午/晚市)分布,委托 v_cash_register_meal_period_overview/detail,detail=true 时按日',
    inputSchema: z.object({
        store: z.string().optional().describe('store_code,如 sh_sjh。省略 = 返回所有门店数据(多店模式,按 store 分组)'),
        month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'YYYY-MM or YYYY-MM-DD').optional().describe('月份,如 2026-06 或 2026-06-01'),
        detail: z.boolean().optional().default(false).describe('true 时返回日×餐段明细'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('detail=true 时单日'),
    }),
    async execute(params: { store?: string; month?: string; detail?: boolean; date?: string }) {
        const qs = new URLSearchParams();
        if (params.store) qs.set('store', params.store);
        if (params.month) qs.set('month', params.month);
        if (params.detail) qs.set('detail', 'true');
        if (params.date) qs.set('date', params.date);
        const res = await mcpFetch(`/api/tamkoko/sales/meal-period?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_meal_period failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
