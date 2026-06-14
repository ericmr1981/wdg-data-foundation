import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const QueryStatusInput = z.object({
  brand:    brandParamSchema.optional().default('gelatomiiix').describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  batch_id: z.string().optional().describe('Batch ID to filter by'),
});

export const queryStatusTool = {
  name: 'query_status',
  description: 'Query approval proposal status counts grouped by status (pending / approved / rejected) for a brand or batch.',
  inputSchema: QueryStatusInput,
  async execute({ brand = 'gelatomiiix', batch_id }: z.infer<typeof QueryStatusInput>) {
    const qs = new URLSearchParams({ brand });
    if (batch_id) qs.set('batch_id', batch_id);
    const res = await mcpFetch(`/api/approval/proposals?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'query_status');

    // Group by status
    const items: any[] = ((json as Record<string, unknown>).data as any[]) ?? [];
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.status ?? 'unknown'] = (counts[item.status ?? 'unknown'] ?? 0) + 1;
    }
    return { counts, items };
  },
};