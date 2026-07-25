import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ensureAdmin } from '../_lib';
import { pipelinePids } from '../_pid-tracker';

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

  // 1) 如果内存中有子进程 PID，先 kill（Issue #36 Change 3）
  const pid = pipelinePids.get(runId);
  if (pid !== undefined) {
    try {
      // detached=true 的进程在独立进程组，kill 整个组
      process.kill(-pid, 'SIGTERM');
      console.log(`[discount-model] killed child process group ${-pid} for run ${runId}`);
      pipelinePids.delete(runId);
      // 给进程 5 秒优雅退出，超时则 SIGKILL
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch {}
      }, 5000);
    } catch (killErr) {
      // PID 可能已经结束（正常退出或被 cron 清理），忽略
      console.log(`[discount-model] kill pid ${pid} for run ${runId}: ${String(killErr)}`);
      pipelinePids.delete(runId);
    }
  }

  // 2) 写 cancel 标志（脚本 5 秒内检测并优雅退出）
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