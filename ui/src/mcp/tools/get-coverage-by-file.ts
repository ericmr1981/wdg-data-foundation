import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const GetCoverageByFileInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code: gelatomiiix | bonjur | tamkoko'),
});

export const getCoverageByFileTool = {
  name: 'get_coverage_by_file',
  description: `Get classification coverage grouped by source file. Shows per-file txn counts (auto / manual / unclassified) and coverage percentage.

**Use case**: After upload, find which files still have unclassified txns; identify data quality issues per upload batch.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix

**Response**: rows of { source_file_id, file_name, store_code, total_txn, auto_count, manual_count, unclassified_count, coverage_pct, ... }`,
  inputSchema: GetCoverageByFileInput,
  async execute(params: z.infer<typeof GetCoverageByFileInput>) {
    const { brand = 'gelatomiiix' } = params;
    const qs = new URLSearchParams({ brand });
    const res = await mcpFetch(`/api/coverage/by-file?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'get_coverage_by_file');
    return (json as Record<string, unknown>).data;
  },
};
