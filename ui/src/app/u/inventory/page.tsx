import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth-server';
import { redirect } from 'next/navigation';
import { InventoryForm } from './InventoryForm';
import type { InventorySummaryRow } from '@/lib/inventory-summary-types';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const user = await getSessionUser();
  if (!user || !['admin', 'operator'].includes(user.role)) redirect('/');

  const storesRes = await pool.query(
    `SELECT store_code, store_name FROM ops.stores
      WHERE brand_code = 'tamkoko' AND enabled = TRUE
      ORDER BY store_code`
  );

  const rowsRes = await pool.query(`
    SELECT
      m.store_code, m.period, m.total_amount, m.note, m.updated_by,
      m.created_at, m.updated_at,
      s.store_name,
      v.cogs_amt, v.opening_amt, v.closing_amt,
      v.turnover_times, v.turnover_days
    FROM brand_tamkoko_ods.inventory_monthly_summary m
    LEFT JOIN ops.stores s
      ON s.store_code = m.store_code AND s.brand_code = 'tamkoko'
    LEFT JOIN brand_tamkoko_dm.v_inventory_turnover v
      ON v.store_code = m.store_code AND v.period = m.period
    ORDER BY m.period DESC, m.store_code
  `);
  const rows = rowsRes.rows as InventorySummaryRow[];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">月度盘点</h1>
      <p className="text-sm text-gray-600 mb-4">
        仅录入每店每月期末库存总额（CNY）。毛利率会基于此数据 + 银行物料采购流水计算 COGS；库存周转次数 = COGS ÷ 平均库存。
      </p>

      <InventoryForm stores={storesRes.rows as { store_code: string; store_name: string }[]} />

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
                  {Number(r.total_amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.cogs_amt != null
                    ? Number(r.cogs_amt).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
                    : '-'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.turnover_times != null ? Number(r.turnover_times).toFixed(2) : '-'}
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
    </div>
  );
}
