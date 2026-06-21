import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetTxnDetailInput = z.object({
  brand:       z.string().describe('Brand code: yufeng | gelatomiiix | bonjur | tamkoko').optional().default('yufeng'),
  bank_txn_id: z.number().int().positive().describe('Bank transaction ID'),
});

export const getTxnDetailTool = {
  name: 'get_txn_detail',
  description: 'Fetch full detail for a specific bank transaction including counterparty, summary, memo, purpose, and keyword candidates for classification.',
  inputSchema: GetTxnDetailInput,
  async execute({ brand = 'yufeng', bank_txn_id }: z.infer<typeof GetTxnDetailInput>) {

    // Fetch candidates and the full unclassified list (filter locally for this txn)
    const [candRes, listRes] = await Promise.all([
      mcpFetch(`/api/match/candidates?brand=${brand}&bank_txn_id=${bank_txn_id}`, {
        headers: { 'x-mcp-session': 'internal' },
      }),
      mcpFetch(`/api/match?brand=${brand}&pageSize=500`, {
        headers: { 'x-mcp-session': 'internal' },
      }),
    ]);

    if (!candRes.ok) throw new Error(`get_txn_detail candidates failed: ${await candRes.text()}`);
    if (!listRes.ok) throw new Error(`get_txn_detail list failed: ${await listRes.text()}`);

    const [candJson, listJson] = await Promise.all([candRes.json(), listRes.json()]);

    const txn = (listJson.data?.items ?? []).find(
      (row: any) => String(row.bank_txn_id) === String(bank_txn_id)
    );

    return {
      bank_txn_id: bank_txn_id,
      candidates: candJson.data?.candidates ?? [],
      transaction: txn ?? null,
    };
  },
};