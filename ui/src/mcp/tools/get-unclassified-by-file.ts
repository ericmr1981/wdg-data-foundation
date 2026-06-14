import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const GetUnclassifiedByFileInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  file_id: z.number().int().positive().optional()
    .describe('Filter by specific source file ID (recommended)'),
  limit: z.number().int().positive().max(500).optional().default(100)
    .describe('Max rows to return (default 100)'),
});

export const getUnclassifiedByFileTool = {
  name: 'get_unclassified_by_file',
  description: `Get unclassified bank transactions grouped by source file. Finer-grained than get_unclassified — shows per-file breakdown.

**Use case**: After upload, pinpoint which exact file has unclassified records; get the unclassified txn list per file for proposal generation.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- file_id (optional): filter by source file ID
- limit (optional): max rows, default 100

**Response**: rows of { source_file_id, file_name, bank_txn_id, txn_time, summary, in_amt, out_amt, ... }`,
  inputSchema: GetUnclassifiedByFileInput,
  async execute(params: z.infer<typeof GetUnclassifiedByFileInput>) {
    const { brand = 'gelatomiiix', file_id, limit = 100 } = params;
    const qs = new URLSearchParams({ brand, limit: String(limit) });
    if (file_id !== undefined) qs.set('file_id', String(file_id));
    const res = await mcpFetch(`/api/coverage/unclassified-by-file?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'get_unclassified_by_file');
    return (json as Record<string, unknown>).data;
  },
};
