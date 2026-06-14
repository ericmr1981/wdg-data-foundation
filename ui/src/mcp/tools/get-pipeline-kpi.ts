import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const GetPipelineKpiInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code: gelatomiiix | bonjur | tamkoko'),
});

export const getPipelineKpiTool = {
  name: 'get_pipeline_kpi',
  description: `Get pipeline classification KPI (unclassified / auto-classified / manual-classified counts and amounts). Reads from bank_txn_classified_snapshot (pre-classified BASE TABLE).

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix

**Response**: rows by classified_source (auto / manual / unclassified) with txn_count and total_amt.`,
  inputSchema: GetPipelineKpiInput,
  async execute(params: z.infer<typeof GetPipelineKpiInput>) {
    const { brand = 'gelatomiiix' } = params;
    const qs = new URLSearchParams({ brand });

    const res = await mcpFetch(`/api/pipeline/kpi?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'get_pipeline_kpi');
    return (json as Record<string, unknown>).data;
  },
};
