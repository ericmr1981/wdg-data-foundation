import type { InventorySummaryRow } from '@/lib/inventory-summary-types';

function fmtNum(n: number | null): string {
  return n == null
    ? '-'
    : n.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
}

export function InventoryMonthlyTable({ rows }: { rows: InventorySummaryRow[] }) {
  return (
    <div className="bg-white rounded border">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-600">
          <tr>
            <th className="px-3 py-2">期间</th>
            <th className="px-3 py-2">门店</th>
            <th className="px-3 py-2 text-right">金额</th>
            <th className="px-3 py-2 text-right">COGS</th>
            <th className="px-3 py-2 text-right">周转次数</th>
            <th className="px-3 py-2">修改人</th>
            <th className="px-3 py-2">修改时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-gray-500">
                暂无盘点记录
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.store_code}-${r.period}`} className="border-t">
              <td className="px-3 py-2">{r.period}</td>
              <td className="px-3 py-2">{r.store_name ?? r.store_code}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(r.total_amount)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(r.cogs_amt)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.turnover_times != null ? r.turnover_times.toFixed(2) : '-'}
              </td>
              <td className="px-3 py-2">{r.updated_by}</td>
              <td className="px-3 py-2 text-xs text-gray-600">
                {new Date(r.updated_at).toLocaleString('zh-CN')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
