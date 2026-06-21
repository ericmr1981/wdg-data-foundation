import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetRulesInput = z.object({
  brand: z.string().describe('Brand code: yufeng | gelatomiiix | bonjur | tamkoko').optional().default('yufeng'),
});

export const getRulesTool = {
  name: 'get_rules',
  description: 'Fetch all existing bank transaction classification rules for a brand.',
  inputSchema: GetRulesInput,
  async execute({ brand = 'yufeng' }: z.infer<typeof GetRulesInput>) {
    const res = await mcpFetch(`/api/rules?brand=${brand}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await res.json();
    return json.data ?? json;
  },
};