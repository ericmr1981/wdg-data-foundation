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
    const res = await pool.query(`SELECT * FROM ops.brands ORDER BY sort_order NULLS LAST, brand_code`);
    return NextResponse.json({ success: true, data: res.rows });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}

// POST /api/admin/brands
// body: { brand_code, brand_name, has_delivery?: boolean, modules?: string[] }
//   has_delivery: if true, also provision the delivery schema/tables
//   modules: alternative to has_delivery, array of module names e.g. ['delivery', 'bank']
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const brand_code = normalizeBrandCode(body.brand_code);
    const brand_name = String(body.brand_name || '').trim() || brand_code;

    // Check if delivery module should be provisioned
    const modules: string[] = body.modules || [];
    const hasDelivery = body.has_delivery || modules.includes('delivery');

    const schema_prefix = ['yufeng', 'bonjur'].includes(brand_code) ? brand_code : `brand_${brand_code}`;
    const ods = `${schema_prefix}_ods`;
    const cfg = `${schema_prefix}_cfg`;
    const dm = `${schema_prefix}_dm`;
    const ops = `${schema_prefix}_ops`;
    const delivery = `${schema_prefix}_delivery`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO ops.brands (brand_code, brand_name, schema_prefix)
         VALUES ($1,$2,$3)
         ON CONFLICT (brand_code) DO UPDATE SET brand_name=EXCLUDED.brand_name, schema_prefix=EXCLUDED.schema_prefix, updated_at=NOW()`
        , [brand_code, brand_name, schema_prefix]
      );

      // Register all schemas in allowed_schemas (required for API access control)
      const schemaList: [string, string][] = [
        [schema_prefix, `${schema_prefix} shared`],
        [ods, `${ods} ODS`],
        [cfg, `${cfg} config/rules`],
        [dm, `${dm} data mart`],
        [ops, `${ops} ops`],
      ];
      // Add delivery schema if requested
      if (hasDelivery) {
        schemaList.push([delivery, `${delivery} delivery data`]);
      }
      for (const [sName, sDesc] of schemaList) {
        await client.query(
          `INSERT INTO ops.allowed_schemas (schema_name, brand_code, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (schema_name) DO UPDATE SET brand_code = EXCLUDED.brand_code, description = EXCLUDED.description`,
          [sName, brand_code, sDesc]
        );
      }

      // Create schemas
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ods}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${cfg}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${dm}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ops}`);
      if (hasDelivery) {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${delivery}`);
      }

      // Create dictionary tables by cloning from yufeng_cfg
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_category_lvl1 (LIKE yufeng_cfg.dim_category_lvl1 INCLUDING ALL)`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_category_lvl2 (LIKE yufeng_cfg.dim_category_lvl2 INCLUDING ALL)`);
      await client.query(`INSERT INTO ${cfg}.dim_category_lvl1 SELECT * FROM yufeng_cfg.dim_category_lvl1 ON CONFLICT (lvl1_code) DO NOTHING`);
      await client.query(`INSERT INTO ${cfg}.dim_category_lvl2 SELECT * FROM yufeng_cfg.dim_category_lvl2 ON CONFLICT (lvl1_code,lvl2_code) DO NOTHING`);

      // Create bank_rule_map table (code-based)
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${cfg}.bank_rule_map (LIKE yufeng_cfg.bank_rule_map INCLUDING ALL)`
      );

      // Create dim_store (for dropdowns)
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_store (LIKE yufeng_cfg.dim_store INCLUDING ALL)`);

      // Install history trigger
      await client.query(`DROP TRIGGER IF EXISTS trg_bank_rule_map_history ON ${cfg}.bank_rule_map`);
      await client.query(
        `CREATE TRIGGER trg_bank_rule_map_history
         AFTER INSERT OR UPDATE OR DELETE ON ${cfg}.bank_rule_map
         FOR EACH ROW EXECUTE FUNCTION ops.fn_log_bank_rule_map_change('${brand_code}')`
      );

      // Provision delivery module if requested
      let deliveryResult: any = null;
      if (hasDelivery) {
        await client.query(`CREATE TABLE IF NOT EXISTS ${delivery}.delivery_detail (LIKE xintiandi.delivery_detail INCLUDING ALL)`);
        await client.query(`CREATE TABLE IF NOT EXISTS ${delivery}.monthly_summary (LIKE xintiandi.monthly_summary INCLUDING ALL)`);
        await client.query(`CREATE TABLE IF NOT EXISTS ${delivery}.import_batch (LIKE xintiandi.import_batch INCLUDING ALL)`);

        // Create indexes
        await client.query(`CREATE INDEX IF NOT EXISTS idx_delivery_store ON ${delivery}.delivery_detail(store_code)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_delivery_created ON ${delivery}.delivery_detail(created_time)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_delivery_item ON ${delivery}.delivery_detail(item_code)`);

        // Create refresh function
        await client.query(`
          CREATE OR REPLACE FUNCTION ${delivery}.refresh_monthly_summary(p_year_month TEXT, p_batch_id UUID DEFAULT NULL)
          RETURNS void AS $$
          BEGIN
              INSERT INTO ${delivery}.monthly_summary (
                  year_month, store_code, store_name, item_category,
                  total_order_qty, total_audit_qty, total_ship_qty, total_deliver_qty,
                  total_order_amt, delivery_count, source_batch, updated_at
              )
              SELECT 
                  TO_CHAR(created_time, 'YYYY-MM') AS year_month,
                  store_code,
                  store_name,
                  item_category,
                  SUM(order_qty), SUM(audit_qty), SUM(ship_qty), SUM(deliver_qty),
                  SUM(order_amt), COUNT(DISTINCT delivery_no), p_batch_id, NOW()
              FROM ${delivery}.delivery_detail
              WHERE TO_CHAR(created_time, 'YYYY-MM') = p_year_month
              GROUP BY 1, 2, 3, 4
              ON CONFLICT (year_month, store_code, item_category) DO UPDATE SET
                  total_order_qty = EXCLUDED.total_order_qty,
                  total_audit_qty = EXCLUDED.total_audit_qty,
                  total_ship_qty = EXCLUDED.total_ship_qty,
                  total_deliver_qty = EXCLUDED.total_deliver_qty,
                  total_order_amt = EXCLUDED.total_order_amt,
                  delivery_count = EXCLUDED.delivery_count,
                  source_batch = EXCLUDED.source_batch,
                  updated_at = NOW();
          END;
          $$ LANGUAGE plpgsql;
        `);

        deliveryResult = {
          schema: delivery,
          tables: [`${delivery}.delivery_detail`, `${delivery}.monthly_summary`, `${delivery}.import_batch`],
          functions: [`${delivery}.refresh_monthly_summary`],
        };
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        data: {
          brand_code,
          brand_name,
          schema_prefix,
          delivery_module: deliveryResult,
        },
      });
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
