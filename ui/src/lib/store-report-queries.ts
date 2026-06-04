import type { ApiResult, SnapshotResponse, TrendResponse } from './store-report-types';

async function get<T>(url: string): Promise<ApiResult<T>> {
  const res = await fetch(url, { cache: 'no-store' });
  return res.json() as Promise<ApiResult<T>>;
}

export function fetchSnapshot(brand: string, store: string, month: string): Promise<ApiResult<SnapshotResponse>> {
  const qs = new URLSearchParams({ brand, store, month }).toString();
  return get<SnapshotResponse>(`/api/store-report/snapshot?${qs}`);
}

export function fetchTrend(brand: string, store: string, months = 12): Promise<ApiResult<TrendResponse>> {
  const qs = new URLSearchParams({ brand, store, months: String(months) }).toString();
  return get<TrendResponse>(`/api/store-report/trend?${qs}`);
}

export function exportUrl(brand: string, store: string, month: string): string {
  const qs = new URLSearchParams({ brand, store, month }).toString();
  return `/api/store-report/export?${qs}`;
}

export function pdfUrl(brand: string, store: string, month: string): string {
  const qs = new URLSearchParams({ brand, store, month }).toString();
  return `/api/store-report/pdf?${qs}`;
}
