import { NextResponse } from 'next/server';
import { normalizeBrand } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { getTrendData } from '@/lib/queries/store-report';
import type { ApiResult, TrendResponse } from '@/lib/store-report-types';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json<ApiResult<TrendResponse>>({ success: false, data: null, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const monthsParam = searchParams.get('months') ?? '12';

    if (!brandRaw || !store) {
      return NextResponse.json<ApiResult<TrendResponse>>(
        { success: false, data: null, error: 'Missing params: brand, store' },
        { status: 400 }
      );
    }

    const brand = normalizeBrand(brandRaw);
    if (!brand) {
      return NextResponse.json<ApiResult<TrendResponse>>(
        { success: false, data: null, error: `Invalid brand: ${brandRaw}` },
        { status: 400 }
      );
    }

    const months = Math.min(Math.max(parseInt(monthsParam, 10) || 12, 1), 24);
    const result = await getTrendData(brand, store, months);
    if (!result.data) {
      return NextResponse.json<ApiResult<TrendResponse>>(
        { success: true, data: null, note: result.note ?? 'view not ready' }
      );
    }

    return NextResponse.json<ApiResult<TrendResponse>>({ success: true, data: result.data });
  } catch (err: unknown) {
    return NextResponse.json<ApiResult<TrendResponse>>(
      { success: false, data: null, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
