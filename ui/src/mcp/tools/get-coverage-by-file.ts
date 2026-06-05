import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetCoverageByFileInput = z.object({
  brand: z.enum(['gelatomiiix', 'yufeng', 'bonjur']).optional().default('yufeng')
    .describe('Brand code (default yufeng = gelatomiiix)'),
});

export const getCoverageByFileTool = {
  name: 'get_coverage_by_file',
  description: `Get classification coverage grouped by source file. Shows per-file txn counts (auto / manual / unclassified) and coverage percentage.

**Use case**: After upload, find which files still have unclassified txns; identify data quality issues per upload batch.

**Parameters**:
- brand (optional): gelatomiiix | yufeng | bonjur, default yufeng

**Response**: rows of { source_file_id, file_name, store_code, total_txn, auto_count, manual_count, unclassified_count, coverage_pct, ... }`,
  inputSchema: GetCoverageByFileInput,
  async execute(params: z.infer<typeof GetCoverageByFileInput>) {
    const { brand = 'yufeng' } = params;
    const qs = new URLSearchParams({ brand });
    const res = await mcpFetch(`/api/coverage/by-file?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`get_coverage_by_file failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
