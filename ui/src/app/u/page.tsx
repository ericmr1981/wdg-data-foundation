'use client';

import { useState } from 'react';
import pool from '@/lib/db';

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

interface DataSource {
  schema: string;
  table: string;
  rows: number;
  latest_at: string | null;
  min_date: string | null;
  gap_dates: string[];
}


const TABLE_LABELS: Record<string, string> = {
  income_detail: '收入明细',
  product_sales_detail: '产品销售明细',
  cash_register_detail: '收银明细',
};

const EXTRA_SOURCES: Record<string, string[]> = {
  gelatomiiix: ['income_detail', 'product_sales_detail'],
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
        ORDER BY s.sort_order NULLS LAST
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

  // Get extra data sources for each brand
  const allSources: DataSource[] = [];
  for (const brand of brands) {
    const tables = EXTRA_SOURCES[brand.brand_code] || [];
    for (const table of tables) {
      try {
        const schema = `${brand.brand_code}_ods`;
        const tn = sanitizeSchema(table);
        const res = await pool.query(`
          SELECT count(*)::int as rows,
            (SELECT MAX(biz_date)::text FROM ${sanitizeSchema(schema)}.${tn}) as latest_at,
            (SELECT MIN(biz_date)::text FROM ${sanitizeSchema(schema)}.${tn}) as min_date
          FROM ${sanitizeSchema(schema)}.${tn}
        `);
        // Gap detection
        const gapRes = await pool.query(`
          SELECT DISTINCT biz_date::text AS d FROM ${sanitizeSchema(schema)}.${tn} ORDER BY d
        `);
        const dates: string[] = (gapRes.rows as { d: string }[]).map(r => r.d);
        allSources.push({
          schema, table,
          rows: res.rows[0]?.rows || 0,
          latest_at: res.rows[0]?.latest_at || null,
          min_date: res.rows[0]?.min_date || null,
          gap_dates: findGaps(dates),
        });
      } catch {
        // table might not exist
      }
    }
  }

  const grouped = brands.map(brand => ({
    ...brand,
    stores: stores.filter(s => s.brand_code === brand.brand_code),
    sources: allSources.filter(s => s.schema.startsWith(brand.brand_code)),
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

          {/* 其他数据源 */}
          {brand.sources.length > 0 && (
            <div>
              <div className="flex items-center mb-2">
                <h3 className="text-sm font-medium text-gray-700">企迈数据</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2 font-medium">数据表</th>
                    <th className="py-2 font-medium">记录数</th>
                    <th className="py-2 font-medium">数据范围</th>
                    <th className="py-2 font-medium">完整性</th>
                  </tr>
                </thead>
                <tbody>
                  {brand.sources.map(src => {
                    const hasGaps = src.gap_dates.length > 0;
                    return (
                      <tr key={src.table} className="border-b last:border-0">
                        <td className="py-2.5">{TABLE_LABELS[src.table] || src.table}</td>
                        <td className="py-2.5 text-gray-600">{src.rows.toLocaleString()}</td>
                        <td className="py-2.5 text-gray-600">
                          {src.min_date && src.latest_at
                            ? `${src.min_date} ~ ${src.latest_at}`
                            : '暂无数据'}
                        </td>
                        <td className="py-2.5">
                          {hasGaps ? (
                            <span className="text-amber-600 text-xs">
                              缺 {src.gap_dates.length} 天
                            </span>
                          ) : (
                            <span className="text-green-600 text-xs">连续</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(() => {
                const sourcesWithGaps = brand.sources.filter(s => s.gap_dates.length > 0);
                return sourcesWithGaps.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {sourcesWithGaps.map(src => (
                      <GapDetail key={src.table} gaps={src.gap_dates} />
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

function BrandCard({
  brand,
  children,
}: {
  brand: { brand_code: string; brand_name: string; file_count: number; latest_import: string | null };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white border rounded-lg">
      <button
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">{brand.brand_name}</span>
          <span className="text-sm text-gray-500">已导入 {brand.file_count} 个文件</span>
          {brand.latest_import && (
            <span className="text-sm text-gray-400">
              最近: {new Date(brand.latest_import).toLocaleString('zh-CN')}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-lg">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
