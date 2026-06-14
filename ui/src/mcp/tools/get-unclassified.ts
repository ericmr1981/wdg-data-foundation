import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const GetUnclassifiedInput = z.object({
  brand:          brandParamSchema.optional().default('gelatomiiix').describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  source_file_id:  z.number().int().positive().optional().describe('Filter to a specific upload batch (source_file_id from upload response)'),
  month:          z.string().describe('Period in YYYY-MM or YYYY-MM-01 format').optional(),
  page:           z.number().int().positive().optional().default(1),
  pageSize:       z.number().int().positive().max(200).optional().default(100),
});

export const getUnclassifiedTool = {
  name: 'get_unclassified_transactions',
  description: `Fetch unclassified bank transactions for a brand. Returns transactions that still need classification rules.

**Coverage logic**: "unclassified" means the txn has no override AND has no rule match result in the snapshot. Records with a pending approval proposal are included in the count.

**Calibration with upload response**: When upload_bank_txn_file returns unclassifiedThisFile=N, call get_unclassified_transactions with that source_file_id to get the exact N transaction records.

**Parameters**:
- brand (required): brand code
- source_file_id (optional, strongly recommended after upload): filter by specific upload batch
- month (optional): YYYY-MM format, filter by period
- page/pageSize (optional): pagination`,
  inputSchema: GetUnclassifiedInput,
  async execute(params: z.infer<typeof GetUnclassifiedInput>) {
    const { brand = 'gelatomiiix', source_file_id, month, page = 1, pageSize = 100 } = params;
    const qs = new URLSearchParams({ brand, page: String(page), pageSize: String(pageSize) });
    if (source_file_id) qs.set('source_file_id', String(source_file_id));
    if (month) qs.set('month', month);
    const res = await mcpFetch(`/api/match?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'get_unclassified_transactions');
    const data = (json as Record<string, unknown>).data as Record<string, unknown>;
    return {
      count: data?.total ?? 0,
      transactions: data?.items ?? [],
      ...data,
    };
  },
};