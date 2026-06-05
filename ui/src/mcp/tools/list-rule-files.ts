import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const ListRuleFilesInput = z.object({
  brand: z.string().optional().describe('Filter by brand code (optional)'),
  limit: z.number().int().positive().max(100).optional().default(20)
    .describe('Max rows (default 20)'),
});

export const listRuleFilesTool = {
  name: 'list_rule_files',
  description: `List rule source files (Excel imports). Useful for tracing which file a rule came from.

**Parameters**:
- brand (optional): brand code
- limit (optional): max rows, default 20

**Response**: rows of { file_id, file_name, brand_code, imported_at, imported_by, rule_count, ... }`,
  inputSchema: ListRuleFilesInput,
  async execute(params: z.infer<typeof ListRuleFilesInput>) {
    const { brand, limit = 20 } = params;
    const qs = new URLSearchParams({ limit: String(limit) });
    if (brand) qs.set('brand', brand);
    const res = await mcpFetch(`/api/rules/files?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`list_rule_files failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
