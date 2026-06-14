import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';

const GetBrandStoresInput = z.object({
  brand: brandParamSchema.optional().describe('Brand code: gelatomiiix | bonjur | tamkoko'),
});

export const getBrandStoresTool = {
  name: 'get_brand_stores',
  description: 'Get brand and store metadata: brand codes, brand names, and store codes with store names. Use this after fetching transactions so you can look up human-readable names for store_code fields before presenting to the user.',
  inputSchema: GetBrandStoresInput,
  async execute(params: z.infer<typeof GetBrandStoresInput>) {

    // Fetch all brands
    const brandsRes = await mcpFetch(`/api/brands`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!brandsRes.ok) {
      const err = await brandsRes.text();
      throw new Error(`get_brand_stores (brands) failed: ${err}`);
    }
    const brandsJson = await brandsRes.json();
    const brands: Array<{ brand_code: string; brand_name: string }> = brandsJson.data ?? [];

    // If specific brand requested, filter; otherwise fetch all stores
    const targetBrands = params.brand
      ? brands.filter(b => b.brand_code === params.brand)
      : brands;

    // Fetch stores for each brand
    const storeResults: Record<string, Array<{ store_code: string; store_name: string }>> = {};
    for (const brand of targetBrands) {
      const storesRes = await mcpFetch(`/api/stores?brand=${brand.brand_code}`, {
        headers: { 'x-mcp-session': 'internal' },
      });
      if (storesRes.ok) {
        const storesJson = await storesRes.json();
        storeResults[brand.brand_code] = storesJson.data ?? [];
      } else {
        storeResults[brand.brand_code] = [];
      }
    }

    return {
      brands: targetBrands.map(b => ({
        ...b,
        stores: storeResults[b.brand_code] ?? [],
      })),
    };
  },
};
