// admin/discount-model/_lib.ts — 后端共享工具
import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export async function ensureAdmin(request: Request) {
  const { getSessionUser, assertRole } = await import('@/lib/auth-server');
  const user = await getSessionUser(request);
  if (!user) {
    return { user: null, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  try {
    assertRole(user, ['admin']);
  } catch {
    return { user: null, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { user, response: null };
}

export async function fetchRun(run_id: string) {
  const { rows } = await pool.query(
    `SELECT run_id, version, pipeline, status, is_active, cancel_requested,
            data_range_start, data_range_end, fallback_to, warnings,
            started_at, finished_at, store_code
       FROM ops.pipeline_run
      WHERE module='discount_model' AND run_id=$1`,
    [run_id],
  );
  return rows[0] || null;
}

export async function fetchSteps(run_id: string) {
  const { rows } = await pool.query(
    `SELECT step_id, step_name, step_order, status,
            started_at, finished_at, duration_sec, rows_out,
            error_message, detail
       FROM ops.pipeline_step_run
      WHERE run_id=$1
      ORDER BY step_order, step_id`,
    [run_id],
  );
  return rows;
}

export async function fetchLatestActive() {
  const { rows } = await pool.query(
    `SELECT run_id, version, status, is_active, fallback_to,
            data_range_start, data_range_end, warnings,
            started_at, finished_at, store_code
       FROM ops.pipeline_run
      WHERE module='discount_model' AND is_active=true
      LIMIT 1`,
  );
  return rows[0] || null;
}

export async function fetchRuns(limit = 20) {
  const { rows } = await pool.query(
    `SELECT run_id, version, pipeline, status, is_active, cancel_requested,
            started_at, finished_at, store_code,
            EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at))::int AS duration_sec,
            data_range_start, data_range_end
       FROM ops.pipeline_run
      WHERE module='discount_model'
      ORDER BY started_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export function newRunId(): string {
  // 32-char hex (uuid4 no dashes)
  return [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function newVersion(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}