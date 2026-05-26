import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import pool from '@/lib/db';

// POST /api/upload - 上传文件并触发导入
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
  const brand = formData.get('brand') as string;
  const store = formData.get('store') as string;
  const source = formData.get('source') as string;
  const triggerImport = formData.get('triggerImport') === 'true';

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const yyyyMM = `${year}-${month}`;

  if (!file || !brand || !store || !source) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), '..', 'inputs', brand, store, source, yyyyMM);
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true });
  }

  const fileName = file.name;
  const filePath = path.join(uploadDir, fileName);
  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  await writeFile(filePath, fileBuffer);

  let importResult: string | null = null;
  let importError: string | null = null;

  if (triggerImport) {
    try {
      const defaultScriptsDir = path.join(process.cwd(), '..', 'scripts');
      const scriptsDir =
        process.env.SCRIPTS_DIR ||
        (existsSync(defaultScriptsDir) ? defaultScriptsDir : existsSync('/scripts') ? '/scripts' : defaultScriptsDir);

      let scriptName = '';
      const scriptArgs = [filePath];

      if (source === 'bank') {
        scriptName = 'import_yufeng_bank_txn.py';
      } else if (source === 'sales') {
        scriptName = brand === 'bonjur'
          ? 'import_bonjur_sales_self_service_daily.py'
          : 'import_bonjur_sales_daily.py';
      } else {
        return NextResponse.json({ success: false, error: 'Unknown source type' }, { status: 400 });
      }

      const scriptPath = path.join(scriptsDir, scriptName);

      const importOutput = await new Promise<string>((resolve, reject) => {
        const projectRoot = path.join(process.cwd(), '..');
        const venvPython = path.join(projectRoot, '.venv', 'bin', 'python');
        const pythonBin =
          process.env.PYTHON_BIN ||
          (existsSync(venvPython) ? venvPython : 'python3');

        const childProcess = spawn(pythonBin, [scriptPath, ...scriptArgs], {
          cwd: projectRoot,
          env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data) => { stdout += data.toString(); });
        childProcess.stderr.on('data', (data) => { stderr += data.toString(); });

        childProcess.on('close', (code) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(stderr || `Process exited with code ${code}`));
          }
        });

        childProcess.on('error', (err) => { reject(err); });
      });

      importResult = importOutput;
    } catch (error: any) {
      importError = error.message;
    }
  }

  let sourceFileId: number | null = null;
  let importStatus: string | null = null;
  let rowCount: number | null = null;
  let errorMessage: string | null = null;

  try {
    const q = await pool.query(
      `SELECT id, status, row_count, error_message
       FROM raw.ingest_file
       WHERE file_hash = $1
       LIMIT 1`,
      [fileHash]
    );
    if (q.rows?.length) {
      sourceFileId = Number(q.rows[0].id);
      importStatus = q.rows[0].status;
      rowCount = q.rows[0].row_count ?? null;
      errorMessage = q.rows[0].error_message ?? null;
    }
  } catch {
    // best-effort
  }

  if (!importError && triggerImport && source === 'bank') {
    try {
      const schemaPrefix = ['yufeng', 'bonjur'].includes(brand) ? brand : `brand_${brand}`;
      await pool.query(`SELECT ${schemaPrefix}_dm.refresh_bank_txn_classified_snapshot(NULL)`);
      importResult = (importResult || '') + '\n✅ 分类完成';
    } catch (classifyErr: any) {
      importError = `分类失败: ${classifyErr.message}`;
    }
  }

  // Build coverage stats for bank uploads
  let unclassifiedThisFile: number | null = null;
  let unclassifiedThisBrandMonth: number | null = null;
  let totalThisBrandMonth: number | null = null;
  let coveragePct: number | null = null;

  if (source === 'bank' && sourceFileId && !importError) {
    const schemaPrefix = ['yufeng', 'bonjur'].includes(brand) ? brand : `brand_${brand}`;
    try {
      // Get the month from ingest_file (set by import script from file path)
      const metaRow = await pool.query(
        `SELECT month::date AS file_month FROM raw.ingest_file WHERE id = $1`,
        [sourceFileId]
      );
      const fileMonth = metaRow.rows[0]?.file_month;

      // Count unclassified in this file
      const thisFileRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${schemaPrefix}_dm.v_bank_txn_classified
         WHERE source_file_id = $1 AND classified_source = 'unclassified'`,
        [sourceFileId]
      );
      unclassifiedThisFile = parseInt(thisFileRes.rows[0]?.cnt ?? '0');

      if (fileMonth) {
        const dmSchema = `${schemaPrefix}_dm`;
        const [monthTotalRes, monthUnclassRes] = await Promise.all([
          pool.query(
            `SELECT COUNT(*) AS cnt FROM ${dmSchema}.v_bank_txn_classified
             WHERE source_file_id IN (
               SELECT id FROM raw.ingest_file
               WHERE brand_code = $1 AND source_type = 'bank' AND month::date = $2
             )`,
            [brand, fileMonth]
          ),
          pool.query(
            `SELECT COUNT(*) AS cnt FROM ${dmSchema}.v_bank_txn_classified
             WHERE source_file_id IN (
               SELECT id FROM raw.ingest_file
               WHERE brand_code = $1 AND source_type = 'bank' AND month::date = $2
             ) AND classified_source = 'unclassified'`,
            [brand, fileMonth]
          ),
        ]);
        totalThisBrandMonth = parseInt(monthTotalRes.rows[0]?.cnt ?? '0');
        unclassifiedThisBrandMonth = parseInt(monthUnclassRes.rows[0]?.cnt ?? '0');
        if (totalThisBrandMonth > 0) {
          coveragePct = Math.round((1 - unclassifiedThisBrandMonth / totalThisBrandMonth) * 10000) / 100;
        }
      }
    } catch {
      // best-effort, don't fail the upload
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      filePath,
      fileName,
      fileMonth: yyyyMM,
      fileHash,
      sourceFileId,
      importStatus,
      rowCount,
      errorMessage,
      importResult,
      importError,
      unclassifiedThisFile,
      unclassifiedThisBrandMonth,
      totalThisBrandMonth,
      coveragePct
    }
  });
}
