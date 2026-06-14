import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';

const GetRulesInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix').describe('Brand code: gelatomiiix | bonjur | tamkoko'),
});

export const getRulesTool = {
  name: 'get_rules',
  description: 'Fetch all existing bank transaction classification rules for a brand.',
  inputSchema: GetRulesInput,
  async execute({ brand = 'gelatomiiix' }: z.infer<typeof GetRulesInput>) {
    const res = await mcpFetch(`/api/rules?brand=${brand}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await res.json();
    return json.data ?? json;
  },
};