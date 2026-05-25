import { z } from 'zod';

const GetUnclassifiedInput = z.object({
  brand: z.string().describe('Brand code: yufeng | gelatomiiix | bonjur').optional().default('yufeng'),
  month: z.string().describe('Period in YYYY-MM or YYYY-MM-01 format').optional(),
  page:  z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().max(100).optional().default(20),
});

export const getUnclassifiedTool = {
  name: 'get_unclassified',
  description: 'Fetch unclassified bank transactions for a brand. Returns transactions that need classification rules.',
  inputSchema: GetUnclassifiedInput,
  async execute(params: z.infer<typeof GetUnclassifiedInput>) {
    const { brand = 'yufeng', month, page = 1, pageSize = 20 } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
    const qs = new URLSearchParams({ brand, page: String(page), pageSize: String(pageSize) });
    if (month) qs.set('month', month);
    const res = await fetch(`${baseUrl}/api/match?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_unclassified failed: ${err}`);
    }
    const json = await res.json();
    return {
      count: json.data?.total ?? 0,
      transactions: json.data?.items ?? [],
      ...json.data,
    };
  },
};