// ui/src/app/u/sales/tamkoko/components/MultiStoreTrendChart.tsx
'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { STORES } from '../stores';
import type { TrendMetric, TrendByStoreRow } from '../aggregation';

const fmtNum = (v: unknown, digits = 0): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const METRIC_LABEL: Record<TrendMetric, string> = {
    gross_amt: '营业额',
    revenue_amt: '营业收入',
    cash_in_rate: '实收率',
    order_cnt: '订单数',
};

interface Props {
    data: TrendByStoreRow[];
    metric: TrendMetric;
    onDrillDown?: (month: string) => void;
    height?: number;
}

/** 多店多线趋势图:每店一条线;点击某月触发 drill-down */
export function MultiStoreTrendChart({ data, metric, onDrillDown, height = 280 }: Props) {
    const isPct = metric === 'cash_in_rate';
    return (
        <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} onClick={(e: { activeLabel?: string | number }) => {
                if (onDrillDown && e?.activeLabel != null) {
                    const label = String(e.activeLabel);
                    const row = data.find(d => d.month === label);
                    // 任一店该月有数据才允许 drill-down
                    if (row && STORES.some(s => (row[s.code] ?? 0) > 0)) {
                        onDrillDown(label + '-01');
                    }
                }
            }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" interval={0} />
                <YAxis
                    tickFormatter={(v: number) => isPct ? `${v.toFixed(0)}%` : fmtNum(v, 0)}
                    domain={isPct ? [0, 100] : undefined}
                />
                <Tooltip formatter={(v: unknown) => isPct ? `${Number(v).toFixed(2)}%` : fmtNum(v, 2)} />
                <Legend />
                {STORES.map(s => (
                    <Line
                        key={s.code}
                        type="monotone"
                        dataKey={s.code}
                        name={s.name}
                        stroke={s.color}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls={false}
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}

export { METRIC_LABEL };
