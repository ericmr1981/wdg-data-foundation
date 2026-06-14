import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const QueryFinancialStatementInput = z.object({
  statement: z.enum(['profit', 'cashflow', 'balance_sheet'])
    .describe('Statement type: profit | cashflow | balance_sheet'),
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code (default gelatomiiix)'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Period in YYYY-MM format'),
  span: z.enum(['month', 'quarter', 'year']).optional().default('month')
    .describe('Time span: month | quarter | year'),
  store: z.string().optional().default('all').describe('Store code or "all" (default)'),
});

const STATEMENT_PATH: Record<'profit' | 'cashflow' | 'balance_sheet', string> = {
  profit: '/api/financial/profit',
  cashflow: '/api/financial/cashflow',
  balance_sheet: '/api/financial/balance-sheet',
};

export const queryFinancialStatementTool = {
  name: 'query_financial_statement',
  description: `Query financial statement (利润表 / 现金流量表 / 资产负债表) for a brand.

**Parameters**:
- statement (required): profit | cashflow | balance_sheet
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- period (required): YYYY-MM
- span (optional): month (default) | quarter | year
- store (optional): store code or "all" (default)

**Response**: { data: { lines: [{ section, label, amount, indent, is_subtotal, is_highlight }] } }

**Note**: this tool returns line items, not margin/rate fields. amount is signed (revenue positive, expenses negative — cash-basis). For 毛利率/净利率 questions, use query_financial_overview instead.`,
  inputSchema: QueryFinancialStatementInput,
  async execute(params: z.infer<typeof QueryFinancialStatementInput>) {
    const { statement, brand = 'gelatomiiix', period, span = 'month', store = 'all' } = params;
    const qs = new URLSearchParams({ brand, period, span, store });

    const res = await mcpFetch(`${STATEMENT_PATH[statement]}?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'query_financial_statement');
    return (json as Record<string, unknown>).data ?? { note: (json as Record<string, unknown>).note ?? 'no data' };
  },
};
