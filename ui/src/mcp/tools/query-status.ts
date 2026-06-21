import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const QueryStatusInput = z.object({
  brand:    z.string().describe('Brand code: yufeng | gelatomiiix | bonjur | tamkoko').optional().default('yufeng'),
  batch_id: z.string().optional().describe('Batch ID to filter by'),
});

export const queryStatusTool = {
  name: 'query_status',
  description: 'Query approval proposal status counts grouped by status (pending / approved / rejected) for a brand or batch.',
  inputSchema: QueryStatusInput,
  async execute({ brand = 'yufeng', batch_id }: z.infer<typeof QueryStatusInput>) {
    const qs = new URLSearchParams({ brand });
    if (batch_id) qs.set('batch_id', batch_id);
    const res = await mcpFetch(`/api/approval/proposals?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`query_status failed: ${await res.text()}`);
    const json = await res.json();

    // Group by status
    const items: any[] = json.data ?? [];
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.status ?? 'unknown'] = (counts[item.status ?? 'unknown'] ?? 0) + 1;
    }
    return { counts, items };
  },
};