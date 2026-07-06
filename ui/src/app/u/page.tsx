import pool from '@/lib/db';
import { BrandCard } from './BrandCard';

interface BrandRow {
  brand_code: string;
  brand_name: string;
  schema_prefix: string;
  latest_import: string | null;
  file_count: number;
}

interface StoreRow {
  store_code: string;
  store_name: string;
  brand_code: string;
  min_txn: string | null;
  latest_txn: string | null;
}

interface StoreWithGaps extends StoreRow {
  gap_dates: string[];
}

interface DataSourceStore {
  table: string;
  brand_code: string;
  store_code: string;
  store_name: string;
  rows: number;
  latest_at: string | null;
  min_date: string | null;
  gap_dates: string[];
}

interface InventoryStore {
  brand_code: string;
  store_code: string;
  store_name: string;
  period_count: number;
  sku_count: number;
  total_inventory_amt: number | null;
  min_period: string | null;
  max_period: string | null;
  gap_months: string[];
  latest_turnover_times: number | null;
}


function findPeriodGaps(periods: string[]): string[] {
  const gaps: string[] = [];
  for (let i = 0; i < periods.length - 1; i++) {
    const [y1, m1] = periods[i].split('-').map(Number);
    const [y2, m2] = periods[i + 1].split('-').map(Number);
    const cur = y1 * 12 + m1;
    const next = y2 * 12 + m2;
    if (next - cur > 1) {
      for (let m = cur + 1; m < next; m++) {
        const gy = Math.floor(m / 12);
        const gm = m % 12;
        gaps.push(`${gy}-${String(gm).padStart(2, '0')}`);
      }
    }
  }
  return gaps;
}

const TABLE_LABELS: Record<string, string> = {
  income_detail: '收入明细',
  product_sales_detail: '产品销售明细',
  cash_register_detail: '收银明细',
};

const EXTRA_SOURCES: Record<string, string[]> = {
  gelatomiiix: ['income_detail', 'product_sales_detail'],
  bonjur: ['income_detail', 'product_sales_detail'],
  tamkoko: ['income_detail'],
};

export const dynamic = 'force-dynamic';

function findGaps(dates: string[]): string[] {
  const gaps: string[] = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const d1 = new Date(dates[i]).getTime();
    const d2 = new Date(dates[i + 1]).getTime();
    const diff = (d2 - d1) / 86400000;
    if (diff > 1) {
      for (let d = 1; d < diff; d++) {
        const missing = new Date(d1 + d * 86400000);
        gaps.push(missing.toISOString().slice(0, 10));
      }
    }
  }
  return gaps;
}

function GapBadge({ gapCount }: { gapCount: number }) {
  if (gapCount === 0) return null;
  return (
    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
      缺 {gapCount} 天
    </span>
  );
}

function GapDetail({ gaps }: { gaps: string[] }) {
  if (gaps.length === 0) return null;
  // Show most recent gaps first, limit to avoid overflow
  const display = gaps.slice(-20).reverse();
  return (
    <div className="mt-1 text-xs text-amber-600">
      缺失日期:
      {display.slice(0, 10).map(d => (
        <span key={d} className="ml-1.5 inline-block bg-amber-50 px-1 rounded">{d}</span>
      ))}
      {display.length > 10 && <span className="ml-1 text-gray-400">... 共 {gaps.length} 天</span>}
    </div>
  );
}

export default async function HomePage() {
  const brands: BrandRow[] = (await pool.query(`
    SELECT b.brand_code, b.brand_name, b.schema_prefix,
      (SELECT MAX(created_at)::text FROM raw.ingest_file WHERE brand_code = b.brand_code) as latest_import,
      (SELECT COUNT(*) FROM raw.ingest_file WHERE brand_code = b.brand_code) as file_count
    FROM ops.brands b WHERE b.enabled = true ORDER BY b.sort_order NULLS LAST, b.brand_code
  `)).rows;

  // Get stores with their bank transaction time range and per-store gaps
  const stores: StoreWithGaps[] = [];
  for (const brand of brands) {
    const odsSchema = `${brand.schema_prefix}_ods`;
    try {
      const res = await pool.query(`
        SELECT s.store_code, s.store_name, s.brand_code,
          (SELECT MIN(txn_time)::text FROM ${sanitizeSchema(odsSchema)}.bank_txn WHERE store_code = s.store_code) as min_txn,
          (SELECT MAX(txn_time)::text FROM ${sanitizeSchema(odsSchema)}.bank_txn WHERE store_code = s.store_code) as latest_txn
        FROM ops.stores s
        WHERE s.brand_code = $1 AND s.enabled = true
        ORDER BY s.store_name
      `, [brand.brand_code]);

      // 计算每行门店的 txn_time 日期缺口
      const storeGapRes = await pool.query(`
        SELECT store_code, ARRAY_AGG(d::text ORDER BY d) as dates
        FROM (
          SELECT DISTINCT store_code, txn_time::date AS d
          FROM ${sanitizeSchema(odsSchema)}.bank_txn
        ) sub
        GROUP BY store_code
      `);
      const storeGapMap: Record<string, string[]> = {};
      for (const row of storeGapRes.rows as { store_code: string; dates: string[] }[]) {
        storeGapMap[row.store_code] = findGaps(row.dates);
      }

      // 构造 StoreWithGaps 对象（immutable）
      const storeRows: StoreRow[] = res.rows;
      stores.push(...storeRows.map(s => ({
        ...s,
        gap_dates: storeGapMap[s.store_code] || [],
      })));
    } catch {
      stores.push({ store_code: '', store_name: '', brand_code: brand.brand_code, min_txn: null, latest_txn: null, gap_dates: [] });
    }
  }

  // Get per-store data for extra Qimai data sources
  const allSources: DataSourceStore[] = [];
  for (const brand of brands) {
    const tables = EXTRA_SOURCES[brand.brand_code] || [];
    for (const table of tables) {
      try {
        // gelatomiiix 的 income_detail/product_sales_detail 仍在 legacy gelatomiiix_ods
        const schema = brand.brand_code === 'gelatomiiix' ? 'gelatomiiix_ods' : `${brand.schema_prefix}_ods`;
        const tn = sanitizeSchema(table);
        // Per-store rows, date range, and gap detection
        const res = await pool.query(`
          SELECT store_code, COALESCE(store_name, store_code) as store_name,
            count(*)::int as rows,
            MIN(biz_date)::text as min_date,
            MAX(biz_date)::text as latest_at
          FROM ${sanitizeSchema(schema)}.${tn}
          GROUP BY store_code, store_name
          ORDER BY store_name
        `);
        for (const row of res.rows as { store_code: string; store_name: string; rows: number; min_date: string; latest_at: string }[]) {
          // Gap detection per store
          const gapRes = await pool.query(`
            SELECT DISTINCT biz_date::text AS d
            FROM ${sanitizeSchema(schema)}.${tn}
            WHERE store_code = $1
            ORDER BY d
          `, [row.store_code]);
          const dates: string[] = (gapRes.rows as { d: string }[]).map(r => r.d);
          allSources.push({
            table,
            brand_code: brand.brand_code,
            store_code: row.store_code,
            store_name: row.store_name,
            rows: row.rows,
            latest_at: row.latest_at || null,
            min_date: row.min_date || null,
            gap_dates: findGaps(dates),
          });
        }
      } catch {
        // table might not exist
      }
    }
  }

  // Inventory tracking (tamkoko only, monthly snapshots)
  const inventoryStores: InventoryStore[] = [];
  for (const brand of brands) {
    try {
      const odsSchema = `${brand.schema_prefix}_ods`;
      const isTamkoko = brand.brand_code === 'tamkoko';
      // tamkoko reads the new monthly summary table; other brands keep the SKU path.
      const invTable = isTamkoko ? 'inventory_monthly_summary' : 'inventory_month_end';
      // Per-store summary: latest period, sku count, total amount
      const invRes = await pool.query(`
        SELECT
          i.store_code,
          COALESCE(s.store_name, i.store_code) AS store_name,
          COUNT(*)::int AS period_count,
          ${isTamkoko ? 'NULL::int' : 'COUNT(DISTINCT i.sku)'} AS sku_count,
          SUM(${isTamkoko ? 'i.total_amount' : 'i.amount'}) AS total_inventory_amt,
          MIN(i.period) AS min_period,
          MAX(i.period) AS max_period
        FROM ${sanitizeSchema(odsSchema)}.${invTable} i
        LEFT JOIN ops.stores s ON s.store_code = i.store_code AND s.brand_code = $1
        GROUP BY i.store_code, s.store_name
        ORDER BY i.store_code
      `, [brand.brand_code]);
      for (const row of invRes.rows as any[]) {
        // Get sorted periods for gap detection
        const gapRes = await pool.query(`
          SELECT DISTINCT period
          FROM ${sanitizeSchema(odsSchema)}.${invTable}
          WHERE store_code = $1
          ORDER BY period
        `, [row.store_code]);
        const periods: string[] = (gapRes.rows as { period: string }[]).map(r => r.period);
        // For tamkoko: fetch turnover for the latest period (only place it matters on the dashboard)
        let latestTurnover: number | null = null;
        if (isTamkoko && row.max_period) {
          const turnRes = await pool.query(`
            SELECT turnover_times FROM brand_tamkoko_dm.v_inventory_turnover
             WHERE store_code = $1 AND period = $2
          `, [row.store_code, row.max_period]);
          const turnRow = turnRes.rows[0] as { turnover_times: number | null } | undefined;
          latestTurnover = turnRow?.turnover_times ?? null;
        }
        inventoryStores.push({
          brand_code: brand.brand_code,
          store_code: row.store_code,
          store_name: row.store_name,
          period_count: row.period_count,
          sku_count: row.sku_count,
          total_inventory_amt: row.total_inventory_amt,
          min_period: row.min_period,
          max_period: row.max_period,
          gap_months: findPeriodGaps(periods),
          latest_turnover_times: latestTurnover,
        });
      }
    } catch {
      // table doesn't exist or no data
    }
  }

  const grouped = brands.map(brand => ({
    ...brand,
    stores: stores.filter(s => s.brand_code === brand.brand_code),
    sources: allSources.filter(s => s.brand_code === brand.brand_code),
    inventory: inventoryStores.filter(s => s.brand_code === brand.brand_code),
  }));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">数据概览</h1>

      {grouped.map(brand => (
        <BrandCard key={brand.brand_code} brand={brand}>
          {/* 银行流水 */}
          <div className="mb-4">
            <div className="flex items-center mb-2">
              <h3 className="text-sm font-medium text-gray-700">银行流水</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 font-medium">门店</th>
                  <th className="py-2 font-medium">数据范围</th>
                  <th className="py-2 font-medium">完整性</th>
                </tr>
              </thead>
              <tbody>
                {brand.stores.map(store => {
                  const hasGaps = store.gap_dates.length > 0;
                  return (
                    <tr key={store.store_code} className="border-b last:border-0">
                      <td className="py-2.5">{store.store_name}</td>
                      <td className="py-2.5 text-gray-600">
                        {store.min_txn && store.latest_txn
                          ? `${store.min_txn.slice(0, 10)} ~ ${store.latest_txn.slice(0, 10)}`
                          : '暂无数据'}
                      </td>
                      <td className="py-2.5">
                        {hasGaps ? (
                          <span className="text-amber-600 text-xs">缺 {store.gap_dates.length} 天</span>
                        ) : (
                          <span className="text-green-600 text-xs">连续</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {brand.stores.length === 0 && (
                  <tr><td colSpan={3} className="py-3 text-gray-400">暂未配置门店</td></tr>
                )}
              </tbody>
            </table>
            {(() => {
              const storesWithGaps = brand.stores.filter(s => s.gap_dates.length > 0);
              return storesWithGaps.length > 0 && (
                <div className="mt-2 space-y-1">
                  {storesWithGaps.map(s => (
                    <GapDetail key={s.store_code} gaps={s.gap_dates} />
                  ))}
                </div>
              );
            })()}
          </div>

          {/* 其他数据源 — 按门店分组 */}
          {brand.sources.length > 0 && (
            <div>
              <div className="flex items-center mb-2">
                <h3 className="text-sm font-medium text-gray-700">企迈数据</h3>
              </div>
              {(() => {
                // Group sources by store, preserving store order
                const storeMap = new Map<string, { store_name: string; tables: DataSourceStore[] }>();
                for (const src of brand.sources) {
                  if (!storeMap.has(src.store_code)) {
                    storeMap.set(src.store_code, { store_name: src.store_name, tables: [] });
                  }
                  storeMap.get(src.store_code)!.tables.push(src);
                }
                return Array.from(storeMap.entries()).map(([storeCode, group]) => (
                  <div key={storeCode} className="mb-3 border rounded p-3 bg-gray-50">
                    <div className="text-sm font-medium text-gray-800 mb-2">{group.store_name}</div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500">
                          <th className="py-1.5 font-medium">数据表</th>
                          <th className="py-1.5 font-medium">记录数</th>
                          <th className="py-1.5 font-medium">数据范围</th>
                          <th className="py-1.5 font-medium">完整性</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.tables.map(src => {
                          const hasGaps = src.gap_dates.length > 0;
                          return (
                            <tr key={src.table} className="border-b last:border-0">
                              <td className="py-2">{TABLE_LABELS[src.table] || src.table}</td>
                              <td className="py-2 text-gray-600">{src.rows.toLocaleString()}</td>
                              <td className="py-2 text-gray-600">
                                {src.min_date && src.latest_at
                                  ? `${src.min_date} ~ ${src.latest_at}`
                                  : '暂无数据'}
                              </td>
                              <td className="py-2">
                                {hasGaps ? (
                                  <span className="text-amber-600 text-xs">缺 {src.gap_dates.length} 天</span>
                                ) : (
                                  <span className="text-green-600 text-xs">连续</span>
                                )}
                                {hasGaps && (() => {
                                  const display = src.gap_dates.slice(-10).reverse();
                                  return (
                                    <div className="mt-1 text-xs text-amber-600">
                                      {display.map(d => <span key={d} className="mr-1 inline-block bg-amber-50 px-1 rounded">{d}</span>)}
                                      {src.gap_dates.length > 10 && <span className="text-gray-400">... 共 {src.gap_dates.length} 天</span>}
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ));
              })()}
            </div>
          )}

          {/* 库存盘点 — tamkoko 特有 */}
          {brand.inventory.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center mb-2">
                <h3 className="text-sm font-medium text-gray-700">库存盘点</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2 font-medium">门店</th>
                    <th className="py-2 font-medium">SKU 数</th>
                    <th className="py-2 font-medium">盘点点数</th>
                    <th className="py-2 font-medium">数据范围</th>
                    <th className="py-2 font-medium">完整性</th>
                    <th className="py-2 font-medium">周转次数</th>
                  </tr>
                </thead>
                <tbody>
                  {brand.inventory.map(inv => {
                    const hasGaps = inv.gap_months.length > 0;
                    return (
                      <tr key={inv.store_code} className="border-b last:border-0">
                        <td className="py-2.5">{inv.store_name}</td>
                        <td className="py-2.5 text-gray-600">
                          {inv.sku_count > 0 ? `${inv.sku_count.toLocaleString()} 种` : '暂无'}
                        </td>
                        <td className="py-2.5 text-gray-600">{inv.period_count} 个月</td>
                        <td className="py-2.5 text-gray-600">
                          {inv.min_period && inv.max_period
                            ? `${inv.min_period} ~ ${inv.max_period}`
                            : '暂无数据'}
                        </td>
                        <td className="py-2.5">
                          {hasGaps ? (
                            <span className="text-amber-600 text-xs">缺 {inv.gap_months.length} 个月</span>
                          ) : (
                            <span className="text-green-600 text-xs">连续</span>
                          )}
                        </td>
                        <td className="py-2.5 text-gray-600 tabular-nums">
                          {inv.latest_turnover_times != null
                            ? `${inv.latest_turnover_times.toFixed(2)} 次`
                            : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(() => {
                const storesWithGaps = brand.inventory.filter(s => s.gap_months.length > 0);
                return storesWithGaps.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {storesWithGaps.map(s => (
                      <div key={s.store_code} className="text-xs text-amber-600">
                        {s.store_name} 缺失:
                        {s.gap_months.slice(-10).reverse().map(m => (
                          <span key={m} className="ml-1.5 inline-block bg-amber-50 px-1 rounded">{m}</span>
                        ))}
                        {s.gap_months.length > 10 && <span className="ml-1 text-gray-400">... 共 {s.gap_months.length} 个月</span>}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </BrandCard>
      ))}
    </div>
  );
}

function sanitizeSchema(name: string): string {
  return name.replace(/[^a-z0-9_]/g, '');
}
