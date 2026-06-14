import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';

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
    if (!res.ok) throw new Error(`get_candidates failed: ${await res.text()}`);
    const json = await res.json();
    return json.data ?? json;
  },
};