import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ensureAdmin } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { response } = await ensureAdmin(req);
  if (response) return response;

  let body: { run_id?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  const runId = body.run_id;
  if (!runId) {
    return NextResponse.json({ error: 'run_id required' }, { status: 400 });
  }

  // 写 cancel 标志（脚本 5 秒内检测并优雅退出）
  const { rows } = await pool.query(
    `UPDATE ops.pipeline_run
        SET cancel_requested=true
      WHERE module='discount_model' AND run_id=$1 AND status='running'
      RETURNING run_id`,
    [runId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'run not running or not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, run_id: runId });
}