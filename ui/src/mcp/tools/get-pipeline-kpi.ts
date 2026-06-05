import { z } from 'zod';

const GetPipelineKpiInput = z.object({
  brand: z.enum(['gelatomiiix', 'yufeng', 'bonjur']).optional().default('yufeng')
    .describe('Brand code (default yufeng = gelatomiiix)'),
});

export const getPipelineKpiTool = {
  name: 'get_pipeline_kpi',
  description: `Get pipeline classification KPI (unclassified / auto-classified / manual-classified counts and amounts). Reads from bank_txn_classified_snapshot (pre-classified BASE TABLE).

**Parameters**:
- brand (optional): gelatomiiix | yufeng | bonjur, default yufeng

**Response**: rows by classified_source (auto / manual / unclassified) with txn_count and total_amt.`,
  inputSchema: GetPipelineKpiInput,
  async execute(params: z.infer<typeof GetPipelineKpiInput>) {
    const { brand = 'yufeng' } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ brand });

    const res = await fetch(`${baseUrl}/api/pipeline/kpi?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`get_pipeline_kpi failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data;
  },
};
