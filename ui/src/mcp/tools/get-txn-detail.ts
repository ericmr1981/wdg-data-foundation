import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const GetTxnDetailInput = z.object({
  bank_txn_id: z.number().int().positive().describe('Bank transaction ID'),
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code: gelatomiiix | bonjur | tamkoko'),
});

export const getTxnDetailTool = {
  name: 'get_txn_detail',
  description: `Fetch full detail for a specific bank transaction including counterparty, summary, memo, purpose, and keyword candidates for classification.

**Parameters**:
- bank_txn_id (required): bank transaction ID
- brand (optional): brand code, default gelatomiiix

**Response**: { bank_txn_id, candidates, transaction }`,
  inputSchema: GetTxnDetailInput,
  async execute({ bank_txn_id, brand }: z.infer<typeof GetTxnDetailInput>) {
    // Direct lookup: pass bank_txn_id to both API calls, no list-then-filter
    const [candRes, matchRes] = await Promise.all([
      mcpFetch(`/api/match/candidates?brand=${brand}&bank_txn_id=${bank_txn_id}`),
      mcpFetch(`/api/match?brand=${brand}&bank_txn_id=${bank_txn_id}&pageSize=1`),
    ]);

    const [candJson, matchJson] = await Promise.all([
      assertApiSuccess<{ data?: { candidates?: unknown } }>(candRes, 'get_txn_detail.candidates'),
      assertApiSuccess<{ data?: { items?: Array<Record<string, unknown>> } }>(matchRes, 'get_txn_detail.match'),
    ]);

    return {
      bank_txn_id,
      candidates: candJson.data?.candidates ?? [],
      transaction: matchJson.data?.items?.[0] ?? null,
    };
  },
};
