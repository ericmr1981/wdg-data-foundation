import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await pool.query(
    `SELECT run_id, version, status, is_active, fallback_to,
            data_range_start, data_range_end, warnings,
            started_at, finished_at, store_code
       FROM ops.pipeline_run
      WHERE module='discount_model' AND is_active=true
      LIMIT 1`,
  );
  const active = rows[0] || null;
  return NextResponse.json({ active });
}