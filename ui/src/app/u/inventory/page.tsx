import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth-server';
import { redirect } from 'next/navigation';
import { getOdsSchema } from '@/lib/brand-server';
import { InventoryEntryForm } from './InventoryEntryForm';
import { InventoryMonthlyTable } from './InventoryMonthlyTable';
import { GelatomiiixInventoryTab } from './GelatomiiixInventoryTab';
import { InventoryTabs } from './InventoryTabs';
import type { InventorySummaryRow } from '@/lib/inventory-summary-types';

export const dynamic = 'force-dynamic';

type BrandCode = 'tamkoko' | 'gelatomiiix';
const ALLOWED: BrandCode[] = ['tamkoko', 'gelatomiiix'];

function pickBrand(input: string | string[] | undefined): BrandCode {
  const v = Array.isArray(input) ? input[0] : input;
  return (ALLOWED as string[]).includes(v ?? '') ? (v as BrandCode) : 'tamkoko';
}

interface StoreRow { store_code: string; store_name: string; }

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { brand?: string | string[] };
}) {
  const user = await getSessionUser();
  if (!user || !['admin', 'operator'].includes(user.role)) redirect('/');

  const brand = pickBrand(searchParams.brand);
  const odsSchema = getOdsSchema(brand);

  const storesRes = await pool.query<StoreRow>(
    `SELECT store_code, store_name FROM ops.stores
       WHERE brand_code = $1 AND enabled = TRUE
       ORDER BY store_code`,
    [brand]
  );

  const dmJoin = brand === 'tamkoko'
    ? `LEFT JOIN brand_tamkoko_dm.v_inventory_turnover v
         ON v.store_code = m.store_code AND v.period = m.period`
    : '';
  const extraCols = brand === 'tamkoko'
    ? `v.cogs_amt, v.opening_amt, v.closing_amt, v.turnover_times, v.turnover_days`
    : `NULL::numeric AS cogs_amt, NULL::numeric AS opening_amt, NULL::numeric AS closing_amt, NULL::numeric AS turnover_times, NULL::numeric AS turnover_days`;

  const rowsRes = await pool.query(
    `SELECT
       m.store_code, m.period, m.total_amount, m.note, m.updated_by,
       m.created_at, m.updated_at,
       s.store_name,
       ${extraCols}
     FROM ${odsSchema}.inventory_monthly_summary m
     LEFT JOIN ops.stores s
       ON s.store_code = m.store_code AND s.brand_code = $1
     ${dmJoin}
     ORDER BY m.period DESC, m.store_code`,
    [brand]
  );

  // pg returns numeric columns as strings — coerce to JS numbers for table rendering
  const numericFields = ["total_amount", "cogs_amt", "opening_amt", "closing_amt", "turnover_times", "turnover_days"] as const;
  const rows = (rowsRes.rows as Array<Record<string, unknown>>).map((r) => {
    const out = { ...r };
    for (const k of numericFields) {
      if (k in out) {
        const v = out[k];
        out[k] = v == null ? null : (typeof v === "number" ? v : Number(v));
      }
    }
    return out as unknown as InventorySummaryRow;
  });
  const stores = storesRes.rows;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">月度盘点</h1>
      <InventoryTabs current={brand} />

      {brand === 'gelatomiiix' ? (
        <GelatomiiixInventoryTab stores={stores} initialRows={rows} />
      ) : (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            仅录入每店每月期末库存总额(CNY)。毛利率会基于此数据 + 银行物料采购流水计算 COGS;库存周转次数 = COGS ÷ 平均库存。
          </p>
          <InventoryEntryForm brand="tamkoko" stores={stores} />
          <InventoryMonthlyTable rows={rows} />
        </div>
      )}
    </div>
  );
}
