import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand, getSchemaPrefix, getOdsSchema, getDmSchema, getCfgSchema, getOpsSchema } from '@/lib/brand-server';

function applyBrandSql(sql: string, brand: string) {
  const prefix = getSchemaPrefix(brand);
  const ods = getOdsSchema(brand);
  const dm = getDmSchema(brand);
  const cfg = getCfgSchema(brand);
  const ops = getOpsSchema(brand);

  let out = sql;

  // Schema name replacement
  out = out.replaceAll('yufeng_ods', ods);
  out = out.replaceAll('yufeng_dm', dm);
  out = out.replaceAll('yufeng_cfg', cfg);
  out = out.replaceAll('yufeng_ops', ops);

  // brand_code filters inside views
  out = out.replaceAll("f.brand_code = 'yufeng'", `f.brand_code = '${brand}'`);
  out = out.replaceAll("and f.brand_code = 'yufeng'", `and f.brand_code = '${brand}'`);

  // Avoid unused var lint (prefix kept for future)
  void prefix;
  return out;
}

function sliceFromMarker(sql: string, marker: string) {
  const idx = sql.indexOf(marker);
  if (idx === -1) throw new Error(`Marker not found: ${marker}`);
  return sql.slice(idx);
}

// POST /api/admin/brands/init-bank-template
// body: { brand: string }
// Purpose: bootstrap a brand's "bank" pipeline objects using yufeng as the standard template.
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const brand = normalizeBrand(body.brand);
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const ods = getOdsSchema(brand);
    const dm = getDmSchema(brand);
    const cfg = getCfgSchema(brand);
    const ops = getOpsSchema(brand);

    const repoRoot = path.join(process.cwd(), '..', '..', '..', '..'); // ui/ -> repo root

    const yufengApply = await readFile(path.join(repoRoot, 'sql', 'yufeng_apply_classification.sql'), 'utf8');
    const yufengCoverage = await readFile(path.join(repoRoot, 'sql', 'yufeng_coverage_and_unclassified.sql'), 'utf8');
    const yufengByFile = await readFile(path.join(repoRoot, 'sql', 'yufeng_coverage_by_file.sql'), 'utf8');
    const yufengSnapshot = await readFile(path.join(repoRoot, 'sql', 'yufeng_classification_snapshot.sql'), 'utf8');
    const yufengDmModels = await readFile(path.join(repoRoot, 'sql', 'yufeng_dm_models.sql'), 'utf8');

    // We only take the function+views+seed part from apply_classification, because table DDL differs by runtime.
    const applyPart = sliceFromMarker(yufengApply, '------------------------------------------------------------\n-- 分类函数 v2（返回 code）');

    const sqlApply = applyBrandSql(applyPart, brand);
    const sqlCoverage = applyBrandSql(yufengCoverage, brand);
    const sqlByFile = applyBrandSql(yufengByFile, brand);
    const sqlSnapshot = applyBrandSql(yufengSnapshot, brand);
    const sqlDmModels = applyBrandSql(yufengDmModels, brand);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      // 1) Ensure schemas exist
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ods};`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${dm};`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${cfg};`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ops};`);

      // 2) Ensure core tables exist (clone from yufeng as template)
      await client.query(`CREATE TABLE IF NOT EXISTS ${ods}.bank_txn (LIKE yufeng_ods.bank_txn INCLUDING ALL);`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${dm}.bank_txn_override (LIKE yufeng_dm.bank_txn_override INCLUDING ALL);`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${ops}.unclassified_resolution_log (LIKE yufeng_ops.unclassified_resolution_log INCLUDING ALL);`);

      // cfg dictionaries + rules + store dim
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_category_lvl1 (LIKE yufeng_cfg.dim_category_lvl1 INCLUDING ALL);`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_category_lvl2 (LIKE yufeng_cfg.dim_category_lvl2 INCLUDING ALL);`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.bank_rule_map (LIKE yufeng_cfg.bank_rule_map INCLUDING ALL);`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${cfg}.dim_store (LIKE yufeng_cfg.dim_store INCLUDING ALL);`);

      // 3) Apply function + views + seeds
      await client.query(sqlApply);

      // 4) Apply coverage/unclassified views
      await client.query(sqlCoverage);
      await client.query(sqlByFile);

      // 5) Snapshot table + refresh function (expense/profit/revenue views)
      await client.query(sqlSnapshot);
      await client.query(sqlDmModels);

      await client.query('COMMIT');
      return NextResponse.json({
        success: true,
        data: {
          brand,
          created: {
            ods_bank_txn: `${ods}.bank_txn`,
            dm_override: `${dm}.bank_txn_override`,
            dm_snapshot_table: `${dm}.bank_txn_classified_snapshot`,
            dm_refresh_fn: `${dm}.refresh_bank_txn_classified_snapshot`,
            dm_views: [`${dm}.v_bank_txn_classified`, `${dm}.v_unclassified_detail`, `${dm}.v_coverage_by_file`],
            dm_profit_views: [`${dm}.expense_monthly`, `${dm}.profit_monthly`, `${dm}.revenue_monthly`, `${dm}.v_expense_lvl1_monthly`],
          },
        },
      });
    } catch (e: any) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const status = err?.status || 500;
    console.error('init-bank-template failed:', { status, code: err?.code, message: err?.message });
    return NextResponse.json({ success: false, error: err?.message || 'Failed', code: err?.code }, { status });
  }
}
