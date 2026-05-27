import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import pool from '@/lib/db';

// POST /api/bonjur/sales/upload-self-service
export async function POST(request: Request) {
  const isMcp = request.headers.get('x-mcp-session') === 'internal';
  if (!isMcp) {
    const user = await getSessionUser();
    try {
      assertRole(user, ['admin', 'operator']);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const formData = await request.formData();
  const file = formData.get('file') as File;
  const store = formData.get('store') as string;

  if (!file || !store) {
    return NextResponse.json({ success: false, error: 'Missing required fields: file, store' }, { status: 400 });
  }

  const now = new Date();
  const yyyyMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const uploadDir = path.join(process.cwd(), '..', 'inputs', 'bonjur', store, 'sales', yyyyMM);
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true });
  }

  const fileName = file.name;
  const filePath = path.join(uploadDir, fileName);
  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Check if already imported (before writing to disk)
  const existingRes = await pool.query(
    `SELECT id, status, row_count FROM raw.ingest_file WHERE file_hash = $1 LIMIT 1`,
    [fileHash]
  );

  if (existingRes.rows.length > 0 && existingRes.rows[0].status === 'success') {
    return NextResponse.json({
      success: true,
      data: {
        sourceFileId: Number(existingRes.rows[0].id),
        fileName,
        totalRows: existingRes.rows[0].row_count,
        insertedRows: 0,
        skipped: true,
      },
    });
  }

  await writeFile(filePath, fileBuffer);

  // Run Python import
  let importError: string | null = null;

  try {
    const projectRoot = path.join(process.cwd(), '..');
    const venvPython = path.join(projectRoot, '.venv', 'bin', 'python');
    const pythonBin = process.env.PYTHON_BIN || (existsSync(venvPython) ? venvPython : 'python3');
    const scriptPath = path.join(projectRoot, 'scripts', 'import_bonjur_sales_self_service_daily.py');

    // Set env var so the script picks up the correct store
    const env = { ...process.env, BONJUR_STORE_CODE: store };

    const childProcess = spawn(pythonBin, [scriptPath, filePath], { cwd: projectRoot, env });

    let stderr = '';

    childProcess.stdout.on('data', () => {});
    childProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    await new Promise<void>((resolve, reject) => {
      childProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `Process exited with code ${code}`));
      });
      childProcess.on('error', reject);
    });
  } catch (err: unknown) {
    importError = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `Import failed: ${importError}` }, { status: 500 });
  }

  // Read back import stats
  let sourceFileId: number | null = null;
  let rowCount: number | null = null;
  try {
    const q = await pool.query(
      `SELECT id, row_count FROM raw.ingest_file WHERE file_hash = $1`,
      [fileHash]
    );
    if (q.rows.length > 0) {
      sourceFileId = Number(q.rows[0].id);
      rowCount = q.rows[0].row_count;
    }
  } catch { /* best-effort */ }

  return NextResponse.json({
    success: true,
    data: {
      sourceFileId,
      fileName,
      totalRows: rowCount,
      insertedRows: rowCount,
      skipped: false,
    },
  });
}
