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
}

const EXTRA_SOURCES: Record<string, string[]> = {
  gelatomiiix: ['cash_register_detail', 'product_sales_detail'],
};

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const brands: BrandRow[] = (await pool.query(`
    SELECT b.brand_code, b.brand_name, b.schema_prefix,
      (SELECT MAX(created_at)::text FROM raw.ingest_file WHERE brand_code = b.brand_code) as latest_import,
      (SELECT COUNT(*) FROM raw.ingest_file WHERE brand_code = b.brand_code) as file_count
    FROM ops.brands b WHERE b.enabled = true ORDER BY b.sort_order NULLS LAST, b.brand_code
  `)).rows;

  // Get stores with their latest bank transaction time
  const stores: StoreRow[] = [];
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
    } catch {
      stores.push({ store_code: '', store_name: '', brand_code: brand.brand_code, latest_txn: null });
    }
  }

  // Get extra data sources for each brand
  const allSources: DataSource[] = [];
  for (const brand of brands) {
    const tables = EXTRA_SOURCES[brand.brand_code] || [];
    for (const table of tables) {
      try {
        const schema = `${brand.brand_code}_ods`;
        const res = await pool.query(`
          SELECT count(*)::int as rows,
            (SELECT MAX(COALESCE(biz_date::text, created_at::text)) FROM ${sanitizeSchema(schema)}.${sanitizeSchema(table)}) as latest_at
          FROM ${sanitizeSchema(schema)}.${sanitizeSchema(table)}
        `);
        allSources.push({
          schema, table,
          rows: res.rows[0]?.rows || 0,
          latest_at: res.rows[0]?.latest_at || null,
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
          <table className="w-full text-sm mb-4">
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

          {/* 其他数据源 */}
          {brand.sources.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 font-medium">数据表</th>
                  <th className="py-2 font-medium">记录数</th>
                  <th className="py-2 font-medium">最新数据时间</th>
                </tr>
              </thead>
              <tbody>
                {brand.sources.map(src => (
                  <tr key={src.table} className="border-b last:border-0">
                    <td className="py-2.5">{src.table === 'cash_register_detail' ? '收银明细' : src.table === 'product_sales_detail' ? '产品销售明细' : src.table}</td>
                    <td className="py-2.5 text-gray-600">{src.rows.toLocaleString()}</td>
                    <td className="py-2.5 text-gray-600">
                      {src.latest_at ? new Date(src.latest_at).toLocaleString('zh-CN') : '暂无数据'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function sanitizeSchema(name: string): string {
  return name.replace(/[^a-z0-9_]/g, '');
}
