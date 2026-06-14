import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const RerunMatchByFileInput = z.object({
  brand: brandParamSchema.describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  source_file_ids: z.array(z.number().int().positive()).optional()
    .describe('Specific source file IDs to rerun (provide this OR all_files=true)'),
  all_files: z.boolean().optional().default(false)
    .describe('If true, rerun for ALL successful bank source files for this brand (use with caution)'),
});

export const rerunMatchByFileTool = {
  name: 'rerun_match_by_file',
  description: `Rerun classification matching for bank transactions. Refreshes the bank_txn_classified_snapshot for the given source files using current rules.

**Use case**: After rules are updated (via human-approved proposals that settled), call this to re-apply the new rules to historical data.

**Parameters**:
- brand (required): gelatomiiix | bonjur | tamkoko
- source_file_ids (optional): array of source file IDs to rerun
- all_files (optional): if true, rerun for ALL successful bank files for the brand (use with caution — large impact)

**Note**: This is a pipeline operation that refreshes the snapshot. It does NOT modify rules. Safe to re-run.

**Response**: { affected_files: N, affected_txns: N, duration_ms: N }`,
  inputSchema: RerunMatchByFileInput,
  async execute(params: z.infer<typeof RerunMatchByFileInput>) {
    const { brand, source_file_ids, all_files = false } = params;
    if (!all_files && (!source_file_ids || source_file_ids.length === 0)) {
      throw new Error('Provide source_file_ids or set all_files=true');
    }
    const body: Record<string, unknown> = { brand };
    if (all_files) body.all_files = true;
    if (source_file_ids && source_file_ids.length > 0) body.source_file_ids = source_file_ids;
    const res = await mcpFetch(`/api/pipeline/rerun-match-by-file`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mcp-session': 'internal',
      },
      body: JSON.stringify(body),
    });
    const json = await assertApiSuccess(res, 'rerun_match_by_file');
    return (json as Record<string, unknown>).data ?? json;
  },
};
