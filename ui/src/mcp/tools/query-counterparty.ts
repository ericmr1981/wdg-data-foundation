import { z } from 'zod';

const QueryCounterpartyInput = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span (default month)'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
  counterparty: z.string().optional().default('')
    .describe('Filter by counterparty name (default all)'),
  direction: z.enum(['in', 'out']).optional().default('out')
    .describe('Transaction direction: in (incoming) or out (outgoing, default)'),
});

export const queryCounterpartyTool = {
  name: 'query_counterparty',
  description: `Query counterparty (交易对手) analysis from bank transactions. Shows aggregated in/out amount per counterparty.

**Parameters**:
- period (required): YYYY-MM
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)
- counterparty (optional): filter by counterparty name
- direction (optional): in | out (default out)

**Response**: rows of { counterparty, total_amt, txn_count, ... }`,
  inputSchema: QueryCounterpartyInput,
  async execute(params: z.infer<typeof QueryCounterpartyInput>) {
    const { period, span = 'month', store = 'all', counterparty = '', direction = 'out' } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ period, span, store, counterparty, direction });
    const res = await fetch(`${baseUrl}/api/financial/counterparty?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`query_counterparty failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data ?? { note: json.note ?? 'no data' };
  },
};
