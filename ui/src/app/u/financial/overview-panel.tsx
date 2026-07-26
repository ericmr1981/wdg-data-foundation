import type { FinancialOverviewResult } from '@/lib/queries/financial';

interface OverviewPanelProps {
  data: FinancialOverviewResult | null;
}

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function TrendArrow({ value }: { value: number }) {
  if (value > 0.01) return <span className="text-green-600 text-xs">↑ {(value * 100).toFixed(1)}%</span>;
  if (value < -0.01) return <span className="text-amber-500 text-xs">↓ {Math.abs(value * 100).toFixed(1)}%</span>;
  return <span className="text-gray-400 text-xs">-</span>;
}

function MetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  trend?: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 text-center">
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold mt-1 text-gray-900">{value}</div>
      {trend && <div className="mt-0.5">{trend}</div>}
    </div>
  );
}

export default function OverviewPanel({ data }: OverviewPanelProps) {
  if (!data) return null;

  const cfColor = data.operatingCashflow >= 0 ? 'text-green-600' : 'text-red-600';
  const cfLabel = data.operatingCashflow >= 0 ? '✅ 正向' : '⚠️ 负向';
  const cfTrend = (
    <>
      <TrendArrow value={data.vsPrevPeriod.operatingCashflow} />
      <span className="text-xs text-gray-400 ml-1">{cfLabel}</span>
    </>
  );

  const cashValue = (
    <>
      <div className="text-xl font-bold">{formatCurrency(data.cashBalance)}</div>
      {data.cashRunway != null && (
        <div className="text-xs text-gray-500">现金跑道 {data.cashRunway} 个月</div>
      )}
    </>
  );

  return (
    <div className="grid grid-cols-3 gap-3">
      <MetricCard
        label="营业收入"
        value={formatCurrency(data.revenue)}
        trend={<TrendArrow value={data.vsPrevPeriod.revenue} />}
      />
      <MetricCard
        label="毛利率"
        value={formatPercent(data.grossMarginRate ?? 0)}
        trend={<TrendArrow value={data.vsPrevPeriod.grossMarginRate} />}
      />
      <MetricCard
        label="净利率（不含分红）"
        value={formatPercent(data.netProfitRate)}
        trend={<TrendArrow value={data.vsPrevPeriod.netProfitRate} />}
      />
      <MetricCard
        label="经营现金流"
        value={<span className={cfColor}>{formatCurrency(data.operatingCashflow)}</span>}
        trend={cfTrend}
      />
      <MetricCard label="期末现金" value={cashValue} />
      <MetricCard
        label="单店营收"
        value={formatCurrency(data.revenuePerStore)}
        trend={<span className="text-xs text-gray-400">{data.storeCount} 家门店</span>}
      />
    </div>
  );
}
