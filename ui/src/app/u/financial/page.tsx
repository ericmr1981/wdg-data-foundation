import { redirect } from 'next/navigation';
import { getBrandServer, DEFAULT_BRAND, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import {
  getFinancialOffers,
  getProfitStatementData,
  getCashflowStatementData,
  getBalanceSheetData,
  getFinancialOverviewData,
} from '@/lib/queries/financial';
import type { FinancialStatementLine, FinancialOverviewResult } from '@/lib/queries/financial';
import { FinancialClient } from './FinancialClient';

type SpanId = 'month' | 'quarter' | 'year';

function defaultPeriod(span: SpanId): string {
  if (span === 'month') return '2026-06';
  if (span === 'quarter') return '2026-Q2';
  return '2026';
}

function validateSpan(raw: string | undefined): SpanId {
  if (raw === 'month' || raw === 'quarter' || raw === 'year') return raw;
  return 'month';
}

interface PageProps {
  searchParams: { brand?: string; span?: string; period?: string; store?: string };
}

export default async function FinancialPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  // Brand: URL param overrides cookie
  const brandRaw = searchParams.brand ?? (await getBrandServer());
  const brand = normalizeBrand(brandRaw) ?? DEFAULT_BRAND;

  // Span: validate from URL, default 'month'
  const span = validateSpan(searchParams.span);

  // Period: URL param or default for this span
  const period = searchParams.period || defaultPeriod(span);

  // Store: URL param or 'all'
  const store = searchParams.store || 'all';

  // Pre-fetch all data in parallel
  const [
    stores,
    profitRes,
    cashflowRes,
    balanceSheetRes,
    overviewRes,
  ] = await Promise.all([
    getFinancialOffers(brand),
    getProfitStatementData(brand, period, span, store),
    getCashflowStatementData(brand, period, span, store),
    getBalanceSheetData(brand, period, span, store),
    getFinancialOverviewData(brand, period, span, store),
  ]);

  // Collect notes from any statement that returned a note (e.g. 'view not ready')
  const overviewNote = profitRes.note || cashflowRes.note || balanceSheetRes.note;

  return (
    <FinancialClient
      brand={brand}
      span={span}
      period={period}
      store={store}
      stores={stores}
      profitData={profitRes.lines}
      cashflowData={cashflowRes.lines}
      balanceSheetData={balanceSheetRes.lines}
      overviewData={overviewRes}
      overviewNote={overviewNote}
    />
  );
}
