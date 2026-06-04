'use client';

import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LabelList } from 'recharts';
import type { TrendResponse, KpiMetricKey } from '@/lib/store-report-types';
import { KPI_LABELS } from '@/lib/store-report-types';

interface Props {
  title: string;
  trend: TrendResponse;
  metrics: KpiMetricKey[]; // 1 or 2 metrics
  barMetric?: KpiMetricKey; // if set, render this metric as Bar (others as Line)
  colors?: string[];
}

const DEFAULT_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04'];

const RATE_KEYS: Set<KpiMetricKey> = new Set([
  'hr_ratio_pct', 'rent_ratio_pct',
  'gross_profit_rate_pct', 'net_profit_rate_pct',
]);

function fmtY(key: KpiMetricKey, n: number): string {
  if (RATE_KEYS.has(key)) return `${n.toFixed(1)}%`;
  if (key === 'cashflow_runway_months') return n.toFixed(1);
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toFixed(1);
}

function getAxisId(k: KpiMetricKey): 'left' | 'right' {
  return RATE_KEYS.has(k) || k === 'cashflow_runway_months' ? 'right' : 'left';
}

function getPaddedDomain(data: any[], metrics: KpiMetricKey[], axis: 'left' | 'right'): [number, number] {
  const axisMetrics = metrics.filter(m => getAxisId(m) === axis);
  // 毛利率 / 净利率 / 人力占比率 / 租金占比率：y 轴固定 0-100%
  if (axisMetrics.length > 0 && axisMetrics.every(m => RATE_KEYS.has(m))) {
    return [0, 100];
  }
  const values: number[] = [];
  for (const row of data) {
    for (const m of axisMetrics) {
      const v = row[m];
      if (typeof v === 'number' && isFinite(v)) values.push(v);
    }
  }
  const max = values.length ? Math.max(...values, 0) : 1;
  const padded = max + Math.abs(max) * 0.1;
  return [0, padded > 0 ? padded : 1];
}

export function TrendChart({ title, trend, metrics, barMetric, colors = DEFAULT_COLORS }: Props) {
  const data = trend.months.map((m, i) => {
    const row: any = { month: m };
    for (const k of metrics) row[k] = trend.series[k]?.[i] ?? null;
    return row;
  });

  const usedLeft = metrics.some(k => getAxisId(k) === 'left');
  const usedRight = metrics.some(k => getAxisId(k) === 'right');
  const leftAnchor = metrics.find(k => getAxisId(k) === 'left');
  const rightAnchor = metrics.find(k => getAxisId(k) === 'right');

  return (
    <div className="bg-white rounded border p-3">
      <div className="text-sm font-medium text-gray-700 mb-2">{title}</div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            {usedLeft && leftAnchor && (
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fontSize: 10 }}
                tickFormatter={v => fmtY(leftAnchor, Number(v))}
                width={50}
                domain={getPaddedDomain(data, metrics, 'left')}
                allowDataOverflow
              />
            )}
            {usedRight && rightAnchor && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10 }}
                tickFormatter={v => fmtY(rightAnchor, Number(v))}
                width={50}
                domain={getPaddedDomain(data, metrics, 'right')}
                allowDataOverflow
              />
            )}
            <Tooltip
              formatter={(v: any, n: any) => [fmtY(n as KpiMetricKey, Number(v)), KPI_LABELS[n as KpiMetricKey] ?? n]}
            />
            <Legend formatter={n => KPI_LABELS[n as KpiMetricKey] ?? n} />
            {metrics.map((k, i) => {
              const color = colors[i % colors.length];
              const axisId = getAxisId(k);
              if (k === barMetric) {
                return (
                  <Bar key={k} yAxisId={axisId} dataKey={k} fill={color}>
                    <LabelList
                      dataKey={k}
                      position="top"
                      style={{ fontSize: 9, fill: color }}
                      formatter={(v: any) => v == null ? '' : fmtY(k, Number(v))}
                    />
                  </Bar>
                );
              }
              return (
                <Line
                  key={k}
                  yAxisId={axisId}
                  type="monotone"
                  dataKey={k}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                >
                  <LabelList
                    dataKey={k}
                    position="top"
                    style={{ fontSize: 9, fill: color }}
                    formatter={(v: any) => v == null ? '' : fmtY(k, Number(v))}
                  />
                </Line>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
