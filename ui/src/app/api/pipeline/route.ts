import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import type { PipelineRunRow, PipelineStepRow } from '@/lib/query-types';

// GET /api/pipeline - 获取 pipeline 运行记录和步骤
export async function GET() {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
    // 获取最近 20 条 pipeline_run
    const runsResult = await pool.query(`
      SELECT run_id, brand_code, store_code, started_at, finished_at, status, triggered_by, month, note
      FROM ops.pipeline_run
      ORDER BY started_at DESC
      LIMIT 20
    `);

    const runs = runsResult.rows;

    // 获取对应的步骤
    if (runs.length > 0) {
      const runIds = runs.map(r => r.run_id);
      const stepsResult = await pool.query(`
        SELECT step_id, run_id, step_name, step_order, status, started_at, finished_at,
               rows_in, rows_out, rows_rejected, duration_sec, error_message
        FROM ops.pipeline_step_run
        WHERE run_id = ANY($1)
        ORDER BY run_id, step_order
      `, [runIds]);

      const stepsByRun: Record<string, PipelineStepRow[]> = {};
      (stepsResult.rows as PipelineStepRow[]).forEach((step) => {
        if (!stepsByRun[step.run_id]) {
          stepsByRun[step.run_id] = [];
        }
        stepsByRun[step.run_id].push(step);
      });

      (runs as PipelineRunRow[]).forEach((run) => {
        (run as PipelineRunRow & { steps?: PipelineStepRow[] }).steps = stepsByRun[run.run_id] || [];
      });
    }

    return NextResponse.json({ success: true, data: runs });
  } catch (error) {
    console.error('Error fetching pipeline:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch pipeline' }, { status: 500 });
  }
}
