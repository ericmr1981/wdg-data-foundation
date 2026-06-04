'use client';

import type { StoreKpi, KpiMetricKey } from '@/lib/store-report-types';
import { KPI_LABELS } from '@/lib/store-report-types';

const CARD_ORDER: KpiMetricKey[] = [
  'revenue_amt', 'expense_amt', 'gross_profit_amt', 'net_profit_amt', 'operating_cf_amt',
  'cash_balance', 'cashflow_runway_months', 'hr_ratio_pct', 'rent_ratio_pct',
];

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '-';
  const abs = Math.abs(n);
  if (abs >= 100000000) return `¥${(n / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toFixed(0)}`;
}

function fmtMonths(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toFixed(1);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '-';
  return `${n.toFixed(1)}%`;
}

function fmtValue(key: KpiMetricKey, n: number | null | undefined): string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct') return fmtPct(n);
  if (key === 'cashflow_runway_months') return fmtMonths(n);
  return fmtCurrency(n);
}

function fmtDeltaPct(delta: number | null): { text: string; color: string; arrow: string } {
  if (delta == null || !isFinite(delta)) return { text: '-', color: 'text-gray-400', arrow: '' };
  const sign = delta > 0 ? '↑' : delta < 0 ? '↓' : '';
  const color = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-500';
  return { text: `${Math.abs(delta).toFixed(1)}%`, color, arrow: sign };
}

function calcDelta(key: KpiMetricKey, cur: StoreKpi, prev: StoreKpi | null): number | null {
  if (!prev) return null;
  const curV = (cur as any)[key] as number | null;
  const prevV = (prev as any)[key] as number | null;
  if (curV == null || prevV == null || prevV === 0) return null;
  return ((curV - prevV) / Math.abs(prevV)) * 100;
}

interface Props {
  current: StoreKpi;
  previous: StoreKpi | null;
}

export function KpiCards({ current, previous }: Props) {
  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {CARD_ORDER.map(key => {
        const curV = (current as any)[key];
        const delta = calcDelta(key, current, previous);
        const { text, color, arrow } = fmtDeltaPct(delta);
        return (
          <div key={key} className="bg-white rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">{KPI_LABELS[key]}</div>
            <div className="text-lg font-semibold text-gray-900">{fmtValue(key, curV)}</div>
            {key === 'gross_profit_amt' && current.gross_profit_rate_pct != null && (
              <div className="text-xs text-gray-500 mt-0.5">毛利率 {current.gross_profit_rate_pct.toFixed(1)}%</div>
            )}
            {key === 'net_profit_amt' && current.net_profit_rate_pct != null && (
              <div className="text-xs text-gray-500 mt-0.5">利润率 {current.net_profit_rate_pct.toFixed(1)}%</div>
            )}
            <div className={`text-xs ${color} mt-1`}>{arrow} {text}</div>
          </div>
        );
      })}
    </div>
  );
}
