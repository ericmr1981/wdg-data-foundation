import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const ALLOWED_DIMS = ['order_source', 'order_type', 'meal_period', 'weekday'] as const;

export const queryTamkokoSalesCombinedTool = {
    name: 'query_tamkoko_sales_combined',
    description: `查询 tamkoko 多维组合(${ALLOWED_DIMS.join('/')})指标,委托 fn_cash_register_combined`,
    inputSchema: z.object({
        store: z.string().optional(),
        month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dim1: z.enum(ALLOWED_DIMS).default('order_source'),
        dim2: z.enum(ALLOWED_DIMS).default('order_type'),
    }),
    async execute(params: { store?: string; month?: string; dim1?: typeof ALLOWED_DIMS[number]; dim2?: typeof ALLOWED_DIMS[number] }) {
        const qs = new URLSearchParams();
        if (params.store) qs.set('store', params.store);
        if (params.month) qs.set('month', params.month);
        qs.set('dim1', params.dim1 ?? 'order_source');
        qs.set('dim2', params.dim2 ?? 'order_type');
        const res = await mcpFetch(`/api/tamkoko/sales/combined?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_combined failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
