import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const GetCandidatesInput = z.object({
  brand:       brandParamSchema.optional().default('gelatomiiix').describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  bank_txn_id: z.number().int().positive().describe('Bank transaction ID'),
});

export const getCandidatesTool = {
  name: 'get_candidates',
  description: 'Get keyword candidates (match_value fragments) for a specific bank transaction to help write classification rules.',
  inputSchema: GetCandidatesInput,
  async execute({ brand = 'gelatomiiix', bank_txn_id }: z.infer<typeof GetCandidatesInput>) {
    const res = await mcpFetch(`/api/match/candidates?brand=${brand}&bank_txn_id=${bank_txn_id}`,
      { headers: { 'x-mcp-session': 'internal' } }
    );
    const json = await assertApiSuccess(res, 'get_candidates');
    return (json as Record<string, unknown>).data ?? json;
  },
};