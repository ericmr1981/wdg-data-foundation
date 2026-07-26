import { redirect } from 'next/navigation';
import { getBrandServer, DEFAULT_BRAND, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import {
  getStoresForBrand,
  getBrands,
  getCounterpartyList,
  getPaymentMetrics,
} from '@/lib/queries/payment';
import { BRAND_OPTIONS } from '@/lib/brand-context';
import type { CounterpartySummary, PaymentLvl1, PaymentTrend } from '@/lib/queries/payment';
import { PaymentClient } from './PaymentClient';

interface PageProps {
  searchParams: { brand?: string; span?: string; period?: string; store?: string };
}

export default async function PaymentPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  // Brand: URL param overrides cookie (quick-link scenario).
  const brandRaw = searchParams.brand ?? (await getBrandServer());
  const brand = normalizeBrand(brandRaw) ?? DEFAULT_BRAND;

  const span = searchParams.span || 'month';
  const period = searchParams.period || 'all';
  const store = searchParams.store || 'all';

  // Fetch stores, brands, counterparties, and metrics in parallel.
  const [storeRows, brandRows, counterpartiesResult, metricsResult] = await Promise.all([
    getStoresForBrand(brand),
    getBrands(),
    getCounterpartyList(brand, period, span, store),
    getPaymentMetrics(brand, period, span, store),
  ]);

  // Brand options for the selector: prefer dynamic list from DB, fall back to static.
  const brandOptions =
    brandRows.length > 0
      ? brandRows.map((b) => ({ code: b.brand_code, name: b.brand_name }))
      : Array.from(BRAND_OPTIONS.map((b) => ({ code: b.code, name: b.name })));

  return (
    <PaymentClient
      brand={brand}
      span={span}
      period={period}
      store={store}
      brands={brandOptions}
      stores={storeRows.map((s) => ({ code: s.store_code, name: s.store_name }))}
      counterparties={counterpartiesResult.data}
      counterpartiesNote={counterpartiesResult.note}
      metrics={metricsResult.data}
      metricsNote={metricsResult.note}
    />
  );
}
