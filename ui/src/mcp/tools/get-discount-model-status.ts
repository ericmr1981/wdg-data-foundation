import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetDiscountModelStatusInput = z.object({
  store_code: z.string().optional().default('sh_xtd')
    .describe('Store code (default sh_xtd)'),
});

export const getDiscountModelStatusTool = {
  name: 'get_discount_model_status',
  description: `Get the currently active version of the discount analysis model for a store.

Returns the latest pipeline_run row with is_active=true, including version, generated_at,
data_range_start/end, warnings, and fallback_to (the version we are rolling back to if active is false).

Use this to confirm the freshness of model results before reading coefficients or baseline.`,
  inputSchema: GetDiscountModelStatusInput,
  async execute(params: z.infer<typeof GetDiscountModelStatusInput>) {
    const qs = new URLSearchParams({ store_code: params.store_code });
    const res = await mcpFetch(`/api/discount-model/status?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) return { active: null, note: `HTTP ${res.status}` };
    return await res.json();
  },
};