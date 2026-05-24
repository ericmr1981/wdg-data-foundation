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
  latest_txn: string | null;
}

interface DataSource {
  schema: string;
  table: string;
  rows: number;
  latest_at: string | null;
  min_date: string | null;
  gap_dates: string[];
}

interface BrandGaps {
  bank_gaps: string[];
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

  // Get stores with their latest bank transaction time
  const stores: StoreRow[] = [];
  const brandGaps: Record<string, BrandGaps> = {};
  for (const brand of brands) {
    const odsSchema = `${brand.schema_prefix}_ods`;
    try {
      const res = await pool.query(`
        SELECT s.store_code, s.store_name, s.brand_code,
          (SELECT MAX(txn_time)::text FROM ${sanitizeSchema(odsSchema)}.bank_txn WHERE store_code = s.store_code) as latest_txn
        FROM ops.stores s
        WHERE s.brand_code = $1 AND s.enabled = true
        ORDER BY s.sort_order NULLS LAST
      `, [brand.brand_code]);
      stores.push(...res.rows);

      // Check bank txn date gaps per brand
      const gapRes = await pool.query(`
        SELECT DISTINCT txn_time::date::text AS d FROM ${sanitizeSchema(odsSchema)}.bank_txn ORDER BY d
      `);
      const dates: string[] = (gapRes.rows as { d: string }[]).map(r => r.d);
      brandGaps[brand.brand_code] = { bank_gaps: findGaps(dates) };
    } catch {
      stores.push({ store_code: '', store_name: '', brand_code: brand.brand_code, latest_txn: null });
      brandGaps[brand.brand_code] = { bank_gaps: [] };
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
    gaps: brandGaps[brand.brand_code] || { bank_gaps: [] },
  }));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">数据概览</h1>

      {grouped.map(brand => (
        <div key={brand.brand_code} className="bg-white border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{brand.brand_name}</h2>
            <span className="text-sm text-gray-500">
              已导入 {brand.file_count} 个文件
              {brand.latest_import && (
                <span className="ml-3">
                  最近导入: {new Date(brand.latest_import).toLocaleString('zh-CN')}
                </span>
              )}
            </span>
          </div>

          {/* 银行流水 */}
          <div className="mb-4">
            <div className="flex items-center mb-2">
              <h3 className="text-sm font-medium text-gray-700">银行流水</h3>
              <GapBadge gapCount={brand.gaps.bank_gaps.length} />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 font-medium">门店</th>
                  <th className="py-2 font-medium">最近银行流水</th>
                </tr>
              </thead>
              <tbody>
                {brand.stores.map(store => (
                  <tr key={store.store_code} className="border-b last:border-0">
                    <td className="py-2.5">{store.store_name}</td>
                    <td className="py-2.5 text-gray-600">
                      {store.latest_txn
                        ? new Date(store.latest_txn).toLocaleString('zh-CN')
                        : '暂无数据'}
                    </td>
                  </tr>
                ))}
                {brand.stores.length === 0 && (
                  <tr><td colSpan={2} className="py-3 text-gray-400">暂未配置门店</td></tr>
                )}
              </tbody>
            </table>
            <GapDetail gaps={brand.gaps.bank_gaps} />
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
              {brand.sources.some(s => s.gap_dates.length > 0) && (
                <div className="mt-2 space-y-1">
                  {brand.sources.filter(s => s.gap_dates.length > 0).map(src => (
                    <GapDetail key={src.table} gaps={src.gap_dates} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function sanitizeSchema(name: string): string {
  return name.replace(/[^a-z0-9_]/g, '');
}
