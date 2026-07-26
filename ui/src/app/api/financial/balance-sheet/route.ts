import { NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { getBalanceSheetData } from '@/lib/queries/financial';

// GET /api/financial/balance-sheet?brand=gelatomiiix&period=2026-01&span=month&store=all
// MCP 的 query_financial_statement 工具通过 mcpFetch 调用此端点，不可删除。
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || '';
  const span = searchParams.get('span') || 'month';
  const store = searchParams.get('store') || 'all';
  try {
    assertRole(user, ['admin', 'operator']);

    const brandParam = searchParams.get('brand') || 'gelatomiiix';

    const result = await getBalanceSheetData(brandParam, period, span, store);

    if (result.note) {
      return NextResponse.json({
        success: true,
        data: { brand: '', period, span, store: '', lines: [] },
        note: result.note,
      });
    }

    return NextResponse.json({
      success: true,
      data: { brand: brandParam, period, span, store, lines: result.lines },
    });

  } catch (error: unknown) {
    console.error('Error in balance-sheet route:', error);
    const errRecord = error as Record<string, unknown>;
    const status = (errRecord?.status as number) || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) || 'Failed to load balance sheet' }, { status });
  }
}
