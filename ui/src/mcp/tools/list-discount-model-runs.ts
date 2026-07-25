import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const ListDiscountModelRunsInput = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const listDiscountModelRunsTool = {
  name: 'list_discount_model_runs',
  description: `List recent discount_model pipeline runs (admin scope).
Returns runs ordered by started_at desc, including status / is_active / cancel_requested /
duration_sec / data_range. Read-only.`,
  inputSchema: ListDiscountModelRunsInput,
  async execute(params: z.infer<typeof ListDiscountModelRunsInput>) {
    const qs = new URLSearchParams({ limit: String(params.limit) });
    const res = await mcpFetch(`/api/admin/discount-model/runs?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) return { runs: [], note: `HTTP ${res.status}` };
    return await res.json();
  },
};