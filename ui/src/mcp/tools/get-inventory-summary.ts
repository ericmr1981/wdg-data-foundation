import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetInventorySummaryInput = z.object({
  brand: z.enum(['tamkoko']).optional().default('tamkoko')
    .describe('Brand code. Only tamkoko has the inventory_monthly_summary table.'),
  store_code: z.string().optional()
    .describe('Filter to a single store_code (e.g. hz_fuyang). Optional. Must be a tamkoko store code, not wh_XXX format.'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM').optional()
    .describe('Filter to a single period (YYYY-MM). Optional.'),
});

export const getInventorySummaryTool = {
  name: 'get_inventory_summary',
  description: `Get monthly inventory summary entries for tamkoko. Reads from brand_tamkoko_ods.inventory_monthly_summary (each row = one (store, period) with total_amount, note, updated_by, updated_at). Response also joins v_inventory_turnover for cogs_amt / opening_amt / closing_amt / turnover_times / turnover_days.

Use this for "某店某月盘点录入了吗?谁改的?什么时候?值多少?" type questions. Note: soft-deleted rows have total_amount=0 and note='deleted <iso>'.

**Parameters**:
- brand (optional, default 'tamkoko')
- store_code (optional). Must be a tamkoko store code (e.g. hz_fuyang), NOT wh_XXX format.
- period (optional, YYYY-MM)

**Response**: array of { store_code, store_name, period, total_amount, note, updated_by, created_at, updated_at, cogs_amt, opening_amt, closing_amt, turnover_times, turnover_days } sorted by period DESC.`,
  inputSchema: GetInventorySummaryInput,
  async execute(params: z.infer<typeof GetInventorySummaryInput>) {
    const { brand = 'tamkoko', store_code, period } = params;

    // Defensive validation: reject non-tamkoko store_code format (wh_XXX)
    if (store_code && /^wh_\d{3}$/i.test(store_code)) {
      throw new Error(`get_inventory_summary: store_code "${store_code}" is not a tamkoko store (wh_XXX format detected). Only tamkoko stores (e.g. hz_fuyang) are supported. Use warehouse_list to find the correct tamkoko store codes.`);
    }
    const qs = new URLSearchParams({ brand });
    if (store_code) qs.set('store_code', store_code);
    if (period) qs.set('period', period);

    const res = await mcpFetch(`/api/inventory/${brand}/summary?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_inventory_summary failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};
