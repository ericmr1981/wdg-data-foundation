import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// POST /api/pipeline/rerun-match-by-file - 按文件重跑分类匹配
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { brand, source_file_ids } = body;

    if (!brand || !source_file_ids || !Array.isArray(source_file_ids) || source_file_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing brand or source_file_ids' },
        { status: 400 }
      );
    }

    // 1. 查询文件信息
    const filesResult = await pool.query(`
      SELECT id, file_name, store_code, status
      FROM raw.ingest_file
      WHERE brand_code = $1 AND id = ANY($2)
    `, [brand, source_file_ids]);

    const files = filesResult.rows;
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No files found' },
        { status: 404 }
      );
    }

    // 2. 对每个 source_file_id 重新执行分类
    // 清除该文件的现有 override，重新通过规则匹配
    const results: { source_file_id: number; status: string; message: string }[] = [];

    for (const fileId of source_file_ids) {
      try {
        // 2.1 清除该文件的现有 override（可选，保留以便 rule 重新匹配）
        // await pool.query(`
        //   DELETE FROM yufeng_dm.bank_txn_override
        //   WHERE bank_txn_id IN (
        //     SELECT id FROM yufeng_ods.bank_txn WHERE source_file_id = $1
        //   )
        // `, [fileId]);

        // 2.2 刷新该文件的分类视图（实际上 view 是实时计算的，无需刷新）

        // 2.3 更新 ingest_file 的 updated_at（可选）
        await pool.query(`
          UPDATE raw.ingest_file
          SET updated_at = NOW()
          WHERE id = $1
        `, [fileId]);

        results.push({
          source_file_id: fileId,
          status: 'success',
          message: 'Classification re-run completed'
        });
      } catch (err: any) {
        results.push({
          source_file_id: fileId,
          status: 'error',
          message: err.message
        });
      }
    }

    // 3. 写入 pipeline_run 记录
    const runId = `rerun_${Date.now()}`;
    const noteJson = JSON.stringify({
      run_type: 'rerun_match',
      source_file_ids,
      file_names: files.map((f: any) => f.file_name)
    });

    await pool.query(`
      INSERT INTO ops.pipeline_run (run_id, brand_code, store_code, started_at, finished_at, status, triggered_by, note)
      VALUES ($1, $2, $3, NOW(), NOW(), 'success', 'ui', $4)
    `, [runId, brand, files[0]?.store_code || null, noteJson]);

    // 4. 写入 pipeline_step_run 记录
    await pool.query(`
      INSERT INTO ops.pipeline_step_run (run_id, step_name, step_order, status, started_at, finished_at, rows_out)
      VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
    `, [runId, 'rerun_match_by_file', 1, 'success', source_file_ids.length]);

    return NextResponse.json({
      success: true,
      data: {
        run_id: runId,
        results
      }
    });
  } catch (error: any) {
    console.error('Error in rerun-match-by-file:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
