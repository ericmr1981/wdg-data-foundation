import { NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { getFinancialOverviewData } from '@/lib/queries/financial';

// GET /api/financial/overview?brand=gelatomiiix&period=2026-01&span=month&store=all
// MCP 的 query_financial_statement 工具通过 mcpFetch 调用此端点，不可删除。
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'all';
  const span = searchParams.get('span') || 'month';
  const store = searchParams.get('store') || 'all';

  try {
    assertRole(user, ['admin', 'operator']);

    const brandParam = searchParams.get('brand') || 'gelatomiiix';

    const result = await getFinancialOverviewData(brandParam, period, span, store);

    return NextResponse.json({
      success: true,
      data: {
        period,
        span,
        store,
        ...result,
      },
    });

  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    console.error('Error in overview route:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: (error as { status?: number })?.status || 500 });
  }
}
