import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetDiscountModelRunDetailInput = z.object({
  run_id: z.string().describe('Run ID returned by list_discount_model_runs'),
});

export const getDiscountModelRunDetailTool = {
  name: 'get_discount_model_run_detail',
  description: `Get a single discount_model run with its steps and progress (admin scope).

Returns the run row, ordered steps (step_name / status / started_at / finished_at /
duration_sec / error_message / detail), and a progress summary (completed/total/percent/current).

Read-only.`,
  inputSchema: GetDiscountModelRunDetailInput,
  async execute(params: z.infer<typeof GetDiscountModelRunDetailInput>) {
    const res = await mcpFetch(
      `/api/admin/discount-model/runs/${encodeURIComponent(params.run_id)}`,
      { headers: { 'x-mcp-session': 'internal' } },
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  },
};