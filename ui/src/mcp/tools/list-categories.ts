import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const ListCategoriesInput = z.object({
  brand: z.enum(['gelatomiiix', 'yufeng', 'bonjur']).optional().default('yufeng')
    .describe('Brand code (default yufeng = gelatomiiix)'),
  level: z.enum(['lvl1', 'lvl2', 'all']).optional().default('all')
    .describe('Category level filter (default all)'),
});

export const listCategoriesTool = {
  name: 'list_categories',
  description: `List classification category dictionary (lvl1 / lvl2 codes + names). Use this to look up valid lvl1_code / lvl2_code values before writing proposals.

**Use case**: Before submit_proposal, query categories to ensure the proposed lvl1_code exists and pick the correct lvl2_code.

**Parameters**:
- brand (optional): gelatomiiix | yufeng | bonjur, default yufeng
- level (optional): lvl1 | lvl2 | all, default all

**Response**: { lvl1: [{ code, name, ... }], lvl2: [{ lvl1_code, code, name, ... }] }`,
  inputSchema: ListCategoriesInput,
  async execute(params: z.infer<typeof ListCategoriesInput>) {
    const { brand = 'yufeng', level = 'all' } = params;
    const qs = new URLSearchParams({ brand, level });
    const res = await mcpFetch(`/api/categories?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`list_categories failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
