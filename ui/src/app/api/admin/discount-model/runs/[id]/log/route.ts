import { NextRequest, NextResponse } from 'next/server';
import { ensureAdmin } from '../../../_lib';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 返回结构化日志（每个 step 的 detail + error_message 聚合）
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await ensureAdmin(req);
  if (response) return response;

  const { rows } = await pool.query(
    `SELECT step_name, step_order, status, error_message, detail,
            started_at, finished_at, duration_sec
       FROM ops.pipeline_step_run
      WHERE run_id=$1
      ORDER BY step_order, step_id`,
    [params.id],
  );
  return NextResponse.json({ steps: rows });
}