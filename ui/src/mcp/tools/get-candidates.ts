import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetCandidatesInput = z.object({
  brand:       z.string().describe('Brand code: yufeng | gelatomiiix | bonjur | tamkoko').optional().default('yufeng'),
  bank_txn_id: z.number().int().positive().describe('Bank transaction ID'),
});

export const getCandidatesTool = {
  name: 'get_candidates',
  description: 'Get keyword candidates (match_value fragments) for a specific bank transaction to help write classification rules.',
  inputSchema: GetCandidatesInput,
  async execute({ brand = 'yufeng', bank_txn_id }: z.infer<typeof GetCandidatesInput>) {
    const res = await mcpFetch(`/api/match/candidates?brand=${brand}&bank_txn_id=${bank_txn_id}`,
      { headers: { 'x-mcp-session': 'internal' } }
    );
    if (!res.ok) throw new Error(`get_candidates failed: ${await res.text()}`);
    const json = await res.json();
    return json.data ?? json;
  },
};