import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import pool from '@/lib/db';

// POST /api/tamkoko/income/upload-qimai - 上传 Tamkoko 企迈收入明细 CSV 并触发导入
export async function POST(request: Request) {
  // 1. Auth check
  const isMcp = request.headers.get('x-mcp-session') === 'internal';
  if (!isMcp) {
    const user = await getSessionUser();
    try {
      assertRole(user, ['admin', 'operator']);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  // 2. Parse multipart form data
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const store = (formData.get('store') as string) || 'hz_fuyang';

  if (!file) {
    return NextResponse.json({ success: false, error: 'Missing required field: file' }, { status: 400 });
  }
  if (!store) {
    return NextResponse.json({ success: false, error: 'Missing required field: store' }, { status: 400 });
  }

  // 3. Validate store_code against ops.stores whitelist (before writing file)
  const storeCheck = await pool.query(
    `SELECT 1 FROM ops.stores WHERE brand_code = 'tamkoko' AND store_code = $1 AND enabled = true`,
    [store]
  );
  if (!storeCheck.rows.length) {
    const validStores = await pool.query(
      `SELECT store_code, store_name FROM ops.stores WHERE brand_code = 'tamkoko' AND enabled = true ORDER BY store_code`
    );
    const suggestions = validStores.rows
      .map((r: { store_code: string; store_name: string }) => `  · ${r.store_code} (${r.store_name})`)
      .join('\n');
    return NextResponse.json({
      success: false,
      error: `store_code '${store}' is not a valid enabled store for brand 'tamkoko'.\nValid stores:\n${suggestions}`
    }, { status: 400 });
  }

  // 4. Compute SHA256 hash before saving
  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // 4. Check for existing import
  let existingRecord: { id: number; status: string; row_count: number | null } | null = null;
  try {
    const q = await pool.query(
      `SELECT id, status, row_count::int FROM raw.ingest_file WHERE file_hash = $1 LIMIT 1`,
      [fileHash]
    );
    if (q.rows?.length && q.rows[0].status === 'success') {
      return NextResponse.json({
        success: true,
        data: {
          sourceFileId: Number(q.rows[0].id),
          fileName: file.name,
          totalRows: q.rows[0].row_count ?? null,
          insertedRows: q.rows[0].row_count ?? null,
          skipped: true,
        },
      });
    }
    if (q.rows?.length) {
      existingRecord = q.rows[0];
    }
  } catch {
    // best-effort
  }

  // 5. Save file to inputs/tamkoko/{store}/income_detail/{yyyyMM}/
  const now = new Date();
  const yyyyMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const uploadDir = path.join(process.cwd(), '..', 'inputs', 'tamkoko', store, 'income_detail', yyyyMM);
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true });
  }

  const fileName = file.name;
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, fileBuffer);

  // 6. Trigger Python import script
  const projectRoot = path.join(process.cwd(), '..');
  const venvPython = path.join(projectRoot, '.venv', 'bin', 'python');
  const pythonBin = process.env.PYTHON_BIN || (existsSync(venvPython) ? venvPython : 'python3');
  const scriptPath = path.join(projectRoot, 'scripts', 'import_tamkoko_income_detail.py');

  let importError: string | null = null;
  try {
    await new Promise<string>((resolve, reject) => {
      const childProcess = spawn(pythonBin, [scriptPath, filePath], {
        cwd: projectRoot,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      childProcess.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      childProcess.on('error', (err) => { reject(err); });
    });
  } catch (error: unknown) {
    importError = error instanceof Error ? error.message : String(error);
  }

  // 7. Read back import stats
  let sourceFileId: number | null = existingRecord?.id ?? null;
  let totalRows: number | null = null;
  let insertedRows: number | null = null;

  try {
    const q = await pool.query(
      `SELECT id, status, row_count::int FROM raw.ingest_file WHERE file_hash = $1 LIMIT 1`,
      [fileHash]
    );
    if (q.rows?.length) {
      sourceFileId = Number(q.rows[0].id);
      totalRows = q.rows[0].row_count ?? null;
      insertedRows = q.rows[0].row_count ?? null;
    }
  } catch {
    // best-effort
  }

  if (importError) {
    return NextResponse.json({ success: false, error: importError }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      sourceFileId,
      fileName,
      totalRows,
      insertedRows,
      skipped: false,
    },
  });
}
