import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import type { FileRow } from '@/lib/query-types';

// POST /api/pipeline/rerun-match-by-file - 按文件重跑分类匹配
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { brand, source_file_ids, all_files } = body as {
      brand?: string;
      source_file_ids?: number[];
      all_files?: boolean;
    };

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Missing brand' }, { status: 400 });
    }

    const normalizedBrand = normalizeBrand(brand);
    if (!normalizedBrand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }
    const dmSchema = getDmSchema(normalizedBrand);

    const rerunAll = Boolean(all_files);

    if (!rerunAll && (!source_file_ids || !Array.isArray(source_file_ids) || source_file_ids.length === 0)) {
      return NextResponse.json(
        { success: false, error: 'Missing source_file_ids (or set all_files=true)' },
        { status: 400 }
      );
    }

    // 目标文件列表：全部 or 指定
    const targetIds: number[] = rerunAll
      ? []
      : (source_file_ids || []).map((x) => Number(x));

    // 1. 查询文件信息
    const filesResult = rerunAll
      ? await pool.query(
          `
          SELECT id, file_name, store_code, status
          FROM raw.ingest_file
          WHERE brand_code = $1 AND source_type='bank' AND status='success'
          ORDER BY created_at DESC
          `,
          [normalizedBrand]
        )
      : await pool.query(
          `
          SELECT id, file_name, store_code, status
          FROM raw.ingest_file
          WHERE brand_code = $1 AND id = ANY($2)
          `,
          [normalizedBrand, targetIds]
        );

    const files = filesResult.rows;
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No files found' },
        { status: 404 }
      );
    }

    // 2. 对每个 source_file_id 重新执行分类
    // L2 snapshot 模式：通过 refresh_*_snapshot(source_file_id) 触发增量重算
    const results: { source_file_id: number; status: string; message: string }[] = [];

    const idsToProcess = rerunAll ? (files as FileRow[]).map((f) => Number(f.id)) : targetIds;

    for (const fileId of idsToProcess) {
      try {
        await pool.query(
          `SELECT ${dmSchema}.refresh_bank_txn_classified_snapshot($1)`,
          [fileId]
        );

        // 记录一下“我确实动过这个文件”
        await pool.query(
          `UPDATE raw.ingest_file SET updated_at = NOW() WHERE id = $1`,
          [fileId]
        );

        results.push({
          source_file_id: fileId,
          status: 'success',
          message: 'Snapshot refreshed'
        });
      } catch (err: unknown) {
        results.push({
          source_file_id: fileId,
          status: 'error',
          message: getErrorMessage(err)
        });
      }
    }

    // 3. 写入 pipeline_run 记录（run_id 为 uuid，使用默认 gen_random_uuid()）
    const noteJson = JSON.stringify({
      run_type: 'rerun_match',
      all_files: rerunAll,
      source_file_ids: idsToProcess,
      file_names: (files as FileRow[]).map((f) => f.file_name)
    });

    const runInsert = await pool.query(
      `
      INSERT INTO ops.pipeline_run (run_id, brand_code, store_code, started_at, finished_at, status, triggered_by, note)
      VALUES (gen_random_uuid(), $1, $2, NOW(), NOW(), 'success', 'ui', $3)
      RETURNING run_id
      `,
      [normalizedBrand, files[0]?.store_code || null, noteJson]
    );

    const runId = runInsert.rows[0].run_id;

    // 4. 写入 pipeline_step_run 记录
    await pool.query(
      `
      INSERT INTO ops.pipeline_step_run (run_id, step_name, step_order, status, started_at, finished_at, rows_out)
      VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
      `,
      [runId, rerunAll ? 'rerun_match_all_files' : 'rerun_match_by_file', 1, 'success', idsToProcess.length]
    );

    return NextResponse.json({
      success: true,
      data: {
        run_id: runId,
        results,
        processed: idsToProcess.length,
        all_files: rerunAll
      }
    });
  } catch (error: unknown) {
    console.error('Error in rerun-match-by-file:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
