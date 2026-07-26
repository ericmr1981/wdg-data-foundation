import { redirect } from 'next/navigation';
import { getBrandServer, DEFAULT_BRAND, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import {
  getSnapshotData,
  getTrendData,
  getStoresForBrand,
  getBrands,
} from '@/lib/queries/store-report';
import { BRAND_OPTIONS } from '@/lib/brand-context';
import type { SnapshotResponse, TrendResponse } from '@/lib/store-report-types';
import { StoreReportClient } from './StoreReportClient';

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface PageProps {
  searchParams: { brand?: string; store?: string; month?: string; pdfMode?: string };
}

export default async function StoreReportPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  // Brand: URL param overrides cookie (quick-link scenario).
  const brandRaw = searchParams.brand ?? (await getBrandServer());
  const brand = normalizeBrand(brandRaw) ?? DEFAULT_BRAND;

  // Stores for this brand (server-side query).
  const storeRows = await getStoresForBrand(brand);

  // Store: URL param if valid for this brand, else first available store.
  const urlStore = searchParams.store;
  const store =
    urlStore && storeRows.some((s) => s.store_code === urlStore)
      ? urlStore
      : (storeRows[0]?.store_code ?? '');

  // Month: URL param (validated) or current month.
  const month =
    searchParams.month && /^\d{4}-\d{2}$/.test(searchParams.month)
      ? searchParams.month
      : defaultMonth();

  const pdfMode = searchParams.pdfMode === '1';

  // Fetch snapshot + trend in parallel (only when a store is selected).
  let snapshot: SnapshotResponse | null = null;
  let snapshotNote: string | undefined;
  let trend: TrendResponse | null = null;
  let trendNote: string | undefined;
  if (store) {
    const [snapRes, trendRes] = await Promise.all([
      getSnapshotData(brand, store, month),
      getTrendData(brand, store, 12),
    ]);
    snapshot = snapRes.data;
    snapshotNote = snapRes.note;
    trend = trendRes.data;
    trendNote = trendRes.note;
  }

  // Brand options for the selector: prefer dynamic list from DB, fall back to static.
  const brandRows = await getBrands();
  const brandOptions =
    brandRows.length > 0
      ? brandRows.map((b) => ({ code: b.brand_code, name: b.brand_name }))
      : Array.from(BRAND_OPTIONS);

  return (
    <StoreReportClient
      brand={brand}
      store={store}
      month={month}
      pdfMode={pdfMode}
      brands={brandOptions}
      stores={storeRows.map((s) => ({ code: s.store_code, name: s.store_name }))}
      snapshot={snapshot}
      snapshotNote={snapshotNote}
      trend={trend}
      trendNote={trendNote}
    />
  );
}
