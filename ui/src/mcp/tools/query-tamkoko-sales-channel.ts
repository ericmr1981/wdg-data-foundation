import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const queryTamkokoSalesChannelTool = {
    name: 'query_tamkoko_sales_channel',
    description: '查询 tamkoko 收银按订单来源(渠道)分布(企迈POS/美团外卖/淘宝闪购/...),委托 v_cash_register_channel',
    inputSchema: z.object({
        store: z.string().optional().describe('store_code'),
        month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('月份第一天'),
        source: z.string().optional().describe('订单来源,如 美团外卖'),
    }),
    async execute(params: { store?: string; month?: string; source?: string }) {
        const qs = new URLSearchParams();
        if (params.store) qs.set('store', params.store);
        if (params.month) qs.set('month', params.month);
        if (params.source) qs.set('source', params.source);
        const res = await mcpFetch(`/api/tamkoko/sales/channel?${qs}`);
        if (!res.ok) throw new Error(`query_tamkoko_sales_channel failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
