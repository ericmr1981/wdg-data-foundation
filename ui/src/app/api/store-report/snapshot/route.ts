import { NextResponse } from 'next/server';
import { normalizeBrand } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { getSnapshotData } from '@/lib/queries/store-report';
import type { ApiResult, SnapshotResponse } from '@/lib/store-report-types';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json<ApiResult<SnapshotResponse>>({ success: false, data: null, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const month = searchParams.get('month'); // YYYY-MM

    if (!brandRaw || !store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json<ApiResult<SnapshotResponse>>(
        { success: false, data: null, error: 'Missing or invalid params: brand, store, month (YYYY-MM)' },
        { status: 400 }
      );
    }

    const brand = normalizeBrand(brandRaw);
    if (!brand) {
      return NextResponse.json<ApiResult<SnapshotResponse>>(
        { success: false, data: null, error: `Invalid brand: ${brandRaw}` },
        { status: 400 }
      );
    }

    const result = await getSnapshotData(brand, store, month);
    if (!result.data) {
      if (result.note) {
        return NextResponse.json<ApiResult<SnapshotResponse>>({ success: true, data: null, note: result.note });
      }
      return NextResponse.json<ApiResult<SnapshotResponse>>(
        { success: false, data: null, error: `No data for ${store}@${month}` },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResult<SnapshotResponse>>({ success: true, data: result.data });
  } catch (err: unknown) {
    return NextResponse.json<ApiResult<SnapshotResponse>>(
      { success: false, data: null, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
