import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetDiscountModelBaselineInput = z.object({
  store_code: z.string().optional().default('sh_xtd'),
  version: z.string().optional(),
});

export const getDiscountModelBaselineTool = {
  name: 'get_discount_model_baseline',
  description: `Get the no-discount baseline backtest (predicted vs actual orders) for a store.

Returns the baseline snapshot including:
- train_range / eval_range
- alpha (NegativeBinomial overdispersion)
- metrics: actual_orders, predicted_orders, residual_orders, MAE, RMSE, Bias, WAPE
- daily[]: per-day actual / predicted / residual / avg_discount_rate_pct
- caveats (post-hoc weather usage, single-store, model underestimation)

Read-only.`,
  inputSchema: GetDiscountModelBaselineInput,
  async execute(params: z.infer<typeof GetDiscountModelBaselineInput>) {
    const qs = new URLSearchParams({ store_code: params.store_code });
    if (params.version) qs.set('version', params.version);
    const res = await mcpFetch(`/api/discount-model/baseline?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) return { active: false, note: `HTTP ${res.status}` };
    return await res.json();
  },
};