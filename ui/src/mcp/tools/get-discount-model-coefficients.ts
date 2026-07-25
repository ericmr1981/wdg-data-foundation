import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetDiscountModelCoefficientsInput = z.object({
  store_code: z.string().optional().default('sh_xtd'),
  version: z.string().optional()
    .describe('Specific version (YYYY-MM-DDTHH-MM-SS); defaults to active version'),
});

export const getDiscountModelCoefficientsTool = {
  name: 'get_discount_model_coefficients',
  description: `Get the discount-rate model coefficients (OLS / Poisson / NegativeBinomial) for a store.

Returns the coefficients snapshot (kind='coefficients') including:
- simple_correlation between discount rate and order count
- ols_r_squared
- poisson_pearson_dispersion
- negative_binomial_alpha
- models[] with coef / exp_coef / p_value per model
- formula and caveats

Read-only. No trigger.`,
  inputSchema: GetDiscountModelCoefficientsInput,
  async execute(params: z.infer<typeof GetDiscountModelCoefficientsInput>) {
    const qs = new URLSearchParams({ store_code: params.store_code });
    if (params.version) qs.set('version', params.version);
    const res = await mcpFetch(`/api/discount-model/coefficients?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) return { active: false, note: `HTTP ${res.status}` };
    return await res.json();
  },
};