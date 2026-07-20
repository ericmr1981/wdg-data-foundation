import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetInventoryTurnoverInput = z.object({
  brand: z.enum(['tamkoko']).optional().default('tamkoko')
    .describe('Brand code. Only tamkoko has inventory views; other brands return no rows.'),
  store_code: z.string().optional()
    .describe('Filter to a single store_code (e.g. hz_fuyang). Optional.'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM').optional()
    .describe('Filter to a single period (YYYY-MM). Optional.'),
});

export const getInventoryTurnoverTool = {
  name: 'get_inventory_turnover',
  description: `Get inventory turnover (库存周转) for tamkoko. Reads from brand_tamkoko_dm.v_inventory_turnover, which exposes cogs_amt, opening_amt, closing_amt, turnover_times, turnover_days per (store, period).

Formula: turnover_times = COGS / ((opening + closing) / 2); turnover_days = 30 / turnover_times. NULL when opening or closing is NULL (first period or no closing inventory).

**Parameters**:
- brand (optional, default 'tamkoko')
- store_code (optional): filter to a single store
- period (optional): filter to YYYY-MM

**Response**: array of { store_code, period, cogs_amt, opening_amt, closing_amt, turnover_times, turnover_days }. Use this for "本月周转几次?哪几个月数据缺?" type questions.`,
  inputSchema: GetInventoryTurnoverInput,
  async execute(params: z.infer<typeof GetInventoryTurnoverInput>) {
    const { brand = 'tamkoko', store_code, period } = params;
    const qs = new URLSearchParams({ brand });
    if (store_code) qs.set('store_code', store_code);
    if (period) qs.set('period', period);

    const res = await mcpFetch(`/api/tamkoko/inventory/summary?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_inventory_turnover failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};
