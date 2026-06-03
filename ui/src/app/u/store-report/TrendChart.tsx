'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { TrendResponse, KpiMetricKey } from '@/lib/store-report-types';
import { KPI_LABELS } from '@/lib/store-report-types';

interface Props {
  title: string;
  trend: TrendResponse;
  metrics: KpiMetricKey[]; // 1 or 2 metrics (双线)
  colors?: string[];
}

const DEFAULT_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04'];

function fmtY(key: KpiMetricKey, n: number): string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct') return `${n.toFixed(1)}%`;
  if (key === 'cashflow_runway_months') return n.toFixed(1);
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(0)}万`;
  return n.toFixed(0);
}

export function TrendChart({ title, trend, metrics, colors = DEFAULT_COLORS }: Props) {
  const data = trend.months.map((m, i) => {
    const row: any = { month: m };
    for (const k of metrics) row[k] = trend.series[k]?.[i] ?? null;
    return row;
  });

  return (
    <div className="bg-white rounded border p-3">
      <div className="text-sm font-medium text-gray-700 mb-2">{title}</div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtY(metrics[0], Number(v))} width={50} />
            <Tooltip formatter={(v: any, n: any) => [fmtY(metrics[0], Number(v)), KPI_LABELS[n as KpiMetricKey] ?? n]} />
            <Legend formatter={n => KPI_LABELS[n as KpiMetricKey] ?? n} />
            {metrics.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
