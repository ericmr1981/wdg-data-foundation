import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

function normalizeBrandCode(code: string) {
  const c = String(code || '').trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(c)) throw Object.assign(new Error('Invalid brand_code'), { status: 400 });
  return c;
}

// GET /api/admin/brands
export async function GET() {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
    const res = await pool.query(`SELECT * FROM ops.brands ORDER BY brand_code`);
    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}

// POST /api/admin/brands
// body: { brand_code, brand_name }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const brand_code = normalizeBrandCode(body.brand_code);
    const brand_name = String(body.brand_name || '').trim() || brand_code;

    const schema_prefix = ['yufeng', 'bonjur'].includes(brand_code) ? brand_code : `brand_${brand_code}`;
    const ods = `${schema_prefix}_ods`;
    const cfg = `${schema_prefix}_cfg`;
    const dm = `${schema_prefix}_dm`;
    const ops = `${schema_prefix}_ops`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO ops.brands (brand_code, brand_name, schema_prefix)
         VALUES ($1,$2,$3)
         ON CONFLICT (brand_code) DO UPDATE SET brand_name=EXCLUDED.brand_name, schema_prefix=EXCLUDED.schema_prefix, updated_at=NOW()`
        , [brand_code, brand_name, schema_prefix]
      );

      // Create schemas
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ods}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${cfg}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${dm}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ops}`);

      // Create dictionary tables by cloning from yufeng_cfg
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_category_lvl1 (LIKE yufeng_cfg.dim_category_lvl1 INCLUDING ALL)`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_category_lvl2 (LIKE yufeng_cfg.dim_category_lvl2 INCLUDING ALL)`);
      await client.query(`INSERT INTO ${cfg}.dim_category_lvl1 SELECT * FROM yufeng_cfg.dim_category_lvl1 ON CONFLICT (lvl1_code) DO NOTHING`);
      await client.query(`INSERT INTO ${cfg}.dim_category_lvl2 SELECT * FROM yufeng_cfg.dim_category_lvl2 ON CONFLICT (lvl1_code,lvl2_code) DO NOTHING`);

      // Create bank_rule_map table (code-based)
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${cfg}.bank_rule_map (LIKE yufeng_cfg.bank_rule_map INCLUDING ALL)`
      );

      // Install history trigger
      await client.query(`DROP TRIGGER IF EXISTS trg_bank_rule_map_history ON ${cfg}.bank_rule_map`);
      await client.query(
        `CREATE TRIGGER trg_bank_rule_map_history
         AFTER INSERT OR UPDATE OR DELETE ON ${cfg}.bank_rule_map
         FOR EACH ROW EXECUTE FUNCTION ops.fn_log_bank_rule_map_change('${brand_code}')`
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, data: { brand_code, brand_name, schema_prefix } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
