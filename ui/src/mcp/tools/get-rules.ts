import { z } from 'zod';

const GetRulesInput = z.object({
  brand: z.string().describe('Brand code: yufeng | gelatomiiix | bonjur').optional().default('yufeng'),
});

export const getRulesTool = {
  name: 'get_rules',
  description: 'Fetch all existing bank transaction classification rules for a brand.',
  inputSchema: GetRulesInput,
  async execute({ brand = 'yufeng' }: z.infer<typeof GetRulesInput>) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/rules?brand=${brand}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await res.json();
    return json.data ?? json;
  },
};