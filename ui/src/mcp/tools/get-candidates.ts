import { z } from 'zod';

const GetCandidatesInput = z.object({
  brand:       z.string().describe('Brand code: yufeng | gelatomiiix | bonjur').optional().default('yufeng'),
  bank_txn_id: z.number().int().positive().describe('Bank transaction ID'),
});

export const getCandidatesTool = {
  name: 'get_candidates',
  description: 'Get keyword candidates (match_value fragments) for a specific bank transaction to help write classification rules.',
  inputSchema: GetCandidatesInput,
  async execute({ brand = 'yufeng', bank_txn_id }: z.infer<typeof GetCandidatesInput>) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
    const res = await fetch(
      `${baseUrl}/api/match/candidates?brand=${brand}&bank_txn_id=${bank_txn_id}`,
      { headers: { 'x-mcp-session': 'internal' } }
    );
    if (!res.ok) throw new Error(`get_candidates failed: ${await res.text()}`);
    const json = await res.json();
    return json.data ?? json;
  },
};