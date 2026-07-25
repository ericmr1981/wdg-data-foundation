import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 读取最新生效版本的 coefficients snapshot
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const version = url.searchParams.get('version');
  const store = url.searchParams.get('store_code') || 'sh_xtd';

  const params: any[] = [];
  let where = `s.store_code=$1`;
  params.push(store);

  let sql = `
    SELECT s.payload, s.version, s.generated_at, s.run_id,
           r.data_range_start, r.data_range_end, r.warnings,
           r.is_active, r.fallback_to
      FROM ops.discount_model_snapshot s
      JOIN ops.pipeline_run r
        ON r.module='discount_model' AND r.version=s.version
     WHERE s.kind='coefficients' AND ${where}
  `;
  if (version) {
    sql += ` AND s.version=$2`;
    params.push(version);
  } else {
    sql += ` AND r.is_active=true`;
  }
  sql += ` ORDER BY s.generated_at DESC LIMIT 1`;

  const { rows } = await pool.query(sql, params);
  if (!rows.length) {
    return NextResponse.json({ active: false, error: 'no active version' }, { status: 404 });
  }
  const r = rows[0];
  return NextResponse.json({
    active: r.is_active,
    version: r.version,
    generated_at: r.generated_at,
    data_range_start: r.data_range_start,
    data_range_end: r.data_range_end,
    warnings: r.warnings || [],
    fallback_to: r.fallback_to,
    payload: r.payload,
  });
}