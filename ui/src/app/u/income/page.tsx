import { redirect } from 'next/navigation';
import { getBrandServer, DEFAULT_BRAND, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { BRAND_OPTIONS } from '@/lib/brand-context';
import {
  getIncomeMetricsData,
  getIncomeCounterparties,
  getStoresForBrand,
} from '@/lib/queries/income';
import { getDashboardBrands } from '@/lib/queries/dashboard';
import { IncomeClient } from './IncomeClient';

interface PageProps {
  searchParams: {
    brand?: string;
    span?: string;
    period?: string;
    store?: string;
  };
}

export default async function IncomePage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  // Brand: URL param overrides cookie.
  const brandRaw = searchParams.brand ?? (await getBrandServer());
  const brand = normalizeBrand(brandRaw) ?? DEFAULT_BRAND;

  const span = searchParams.span === 'quarter'
    ? 'quarter'
    : searchParams.span === 'year'
      ? 'year'
      : 'month';

  const period = searchParams.period || 'all';
  const store = searchParams.store || 'all';

  // Fetch all data in parallel: stores + income metrics + counterparty list.
  const [stores, metrics, counterparties, brandRows] = await Promise.all([
    getStoresForBrand(brand),
    getIncomeMetricsData(brand, period, span, store),
    getIncomeCounterparties(brand, period, span, store),
    getDashboardBrands(),
  ]);

  // Brand options for the selector.
  const brandOptions =
    brandRows.length > 0
      ? brandRows.map((b) => ({ code: b.brand_code, name: b.brand_name }))
      : Array.from(BRAND_OPTIONS);

  return (
    <IncomeClient
      brand={brand}
      span={span}
      period={period}
      store={store}
      stores={stores.map((s) => ({ code: s.store_code, name: s.store_name }))}
      brandOptions={brandOptions}
      initialMetrics={metrics}
      initialCounterparties={counterparties}
    />
  );
}
