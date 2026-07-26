import { redirect } from 'next/navigation';
import { getBrandServer, DEFAULT_BRAND, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import {
  getDashboardOverview,
  getDashboardTrend,
  getDashboardQimaiRevenue,
  getDashboardStores,
  getDashboardBrands,
} from '@/lib/queries/dashboard';
import { BRAND_OPTIONS } from '@/lib/brand-context';
import { DashboardClient } from './DashboardClient';

type SpanId = 'month' | 'quarter' | 'year';

interface PageProps {
  searchParams: {
    brand?: string;
    span?: string;
    period?: string;
    store?: string;
  };
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  // Brand: URL param overrides cookie.
  const brandRaw = searchParams.brand ?? (await getBrandServer());
  const brand = normalizeBrand(brandRaw) ?? DEFAULT_BRAND;

  const span: SpanId =
    searchParams.span === 'quarter'
      ? 'quarter'
      : searchParams.span === 'year'
        ? 'year'
        : 'month';

  const period = searchParams.period || 'all';
  const store = searchParams.store || 'all';

  // Fetch all data in parallel.
  const [stores, overviewRes, trendRes, qimaiRes, brandRows] =
    await Promise.all([
      getDashboardStores(brand),
      getDashboardOverview(brand, period, span, store),
      getDashboardTrend(brand, period, span, store),
      getDashboardQimaiRevenue(brand, period, span, store),
      getDashboardBrands(),
    ]);

  // Brand options for the selector.
  const brandOptions =
    brandRows.length > 0
      ? brandRows.map((b) => ({ code: b.brand_code, name: b.brand_name }))
      : Array.from(BRAND_OPTIONS);

  return (
    <DashboardClient
      brand={brand}
      span={span}
      period={period}
      store={store}
      stores={stores.map((s) => ({ code: s.store_code, name: s.store_name }))}
      brandOptions={brandOptions}
      overview={overviewRes.data}
      overviewNote={overviewRes.note}
      trend={trendRes.data}
      trendNote={trendRes.note}
      qimaiRevenue={qimaiRes.data}
    />
  );
}
