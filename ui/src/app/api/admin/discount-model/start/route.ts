import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import pool from '@/lib/db';
import { ensureAdmin, newRunId, newVersion } from '../_lib';
import { pipelinePids } from '../_pid-tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PipelineKind = 'full' | 'prepare' | 'train' | 'publish';

const VALID: PipelineKind[] = ['full', 'prepare', 'train', 'publish'];

export async function POST(req: NextRequest) {
  const { user, response } = await ensureAdmin(req);
  if (response) return response;

  let body: { pipeline?: PipelineKind; store_code?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  const pipeline: PipelineKind = (body.pipeline && VALID.includes(body.pipeline))
    ? body.pipeline : 'full';
  const storeCode = body.store_code || 'sh_xtd';

  const runId = newRunId();
  const version = newVersion();

  // 1. INSERT ops.pipeline_run（status=running）
  try {
    await pool.query(
      `INSERT INTO ops.pipeline_run
        (run_id, brand_code, module, pipeline, version, store_code, status, triggered_by)
       VALUES ($1, 'discount_model', 'discount_model', $2, $3, $4, 'running', 'manual')`,
      [runId, pipeline, version, storeCode],
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  // 2. 启动 Python 脚本（subprocess，detached，Node 不阻塞）
  const scriptsDir = `${process.cwd().replace(/\/ui$/, '')}/scripts/discount_model`;
  const scriptMap: Record<PipelineKind, string> = {
    full: '04_run_pipeline.py',
    prepare: '01_prepare_data.py',
    train: '02_train_models.py',
    publish: '03_publish_results.py',
  };
  const script = scriptMap[pipeline];

  const args = [
    '--run-id', runId,
    '--version', version,
    '--start', '2025-08-01',
    '--end', '2026-07-31',
    '--store-code', storeCode,
  ];
  if (pipeline === 'full' || pipeline === 'train') {
    args.push('--train-end', '2026-05-31');
  }

  // DB 连接从 docker-compose / .env.local 继承，不硬编码。
  const env = { ...process.env, DB_PASSWORD: process.env.DB_PASSWORD || 'postgres' };
  // Python：宿主机用 managed venv，Docker 内用系统 python3。
  const python = process.env.PYTHON_BIN || '/usr/bin/python3';
  try {
    const child = spawn(
      python,
      [`${scriptsDir}/${script}`, ...args],
      { env, detached: true, stdio: 'ignore' },
    );
    // 记录 PID 供 cancel 时 kill 进程（Issue #36 Change 3）
    if (child.pid !== undefined) {
      pipelinePids.set(runId, child.pid);
      // 持久化到 DB 以便进程重启 / cron 清理时仍可追踪
      pool.query(
        `UPDATE ops.pipeline_run SET pid=$1 WHERE run_id=$2`,
        [child.pid, runId],
      ).catch(err => console.error(`[discount-model] failed to persist pid for ${runId}: ${err}`));
      // 子进程退出时自动清理 Map，防止内存泄漏
      child.on('exit', () => {
        pipelinePids.delete(runId);
      });
    }
    child.unref();
  } catch (e) {
    try {
      await pool.query(
        `UPDATE ops.pipeline_run
         SET status='failed', finished_at=NOW()
         WHERE run_id=$1`,
        [runId],
      );
    } catch (cleanupErr) {
      console.error(`[discount-model] cleanup failed for ${runId}: ${String(cleanupErr)}`);
    }
    return NextResponse.json({ error: `spawn failed: ${String(e)}` }, { status: 500 });
  }

  return NextResponse.json({ run_id: runId, version, pipeline });
}