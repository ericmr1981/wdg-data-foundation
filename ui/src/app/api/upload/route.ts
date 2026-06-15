import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import pool from '@/lib/db';
import * as XLSX from 'xlsx';

/**
 * Extract YYYY-MM from a filename. Returns null if no usable date is found.
 * Supports:
 *   - "2603-温州..."          → 2026-03
 *   - "2026-03-01 至 2026-03-31" → 2026-03 (latest)
 *   - "2025年12月"             → 2025-12
 *   - "2603", "2504" (4 digits, MM<=12) anywhere in filename → 20YY-MM
 */
function extractMonthFromFilename(fname: string): string | null {
  if (!fname) return null;
  const patterns: [RegExp, number, number?][] = [
    [/(\d{4})-(\d{2})-\d{2}/g, 1, 2],        // YYYY-MM-DD
    [/(\d{4})年(\d{1,2})月/g, 1, 2],          // YYYY年M月
  ];
  const candidates: number[] = [];
  for (const [pat, yi, mi] of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(fname)) !== null) {
      const y = parseInt(m[yi], 10);
      const mo = parseInt(m[mi!], 10);
      if (mo >= 1 && mo <= 12) candidates.push(y * 100 + mo);
    }
  }
  // YYMM: 4 consecutive digits where 1-12 followed by 01-12
  // e.g. "2603" in "2603-温州..." → YY=26 MM=03
  const yymmRe = /(?:^|[^\d])(\d{2})(0[1-9]|1[0-2])(?:[^\d]|$)/g;
  let ym: RegExpExecArray | null;
  while ((ym = yymmRe.exec(fname)) !== null) {
    const yy = parseInt(ym[1], 10);
    const mm = parseInt(ym[2], 10);
    // Only treat as YYMM if YY looks like a plausible recent year (00-40 = 2000-2040)
    if (yy >= 0 && yy <= 40) candidates.push((2000 + yy) * 100 + mm);
  }
  if (!candidates.length) return null;
  const latest = Math.max(...candidates);
  const y = Math.floor(latest / 100);
  const mo = latest % 100;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/**
 * Extract YYYY-MM from the first transaction record inside an xlsx file.
 * Used as fallback when filename has no date. Reads the first sheet and
 * scans cells for any parseable date, returning the month of the earliest
 * date found in the first ~5 data rows.
 *
 * Supports ICBC format ([HISTORYDETAIL] + 交易时间 col) and any xlsx where
 * a date appears in any cell of the first rows.
 */
function extractMonthFromXlsx(buffer: Buffer): string | null {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) return null;
    const ws = wb.Sheets[firstSheet];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const dates: number[] = [];
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i] || [];
      for (const cell of row) {
        if (cell == null) continue;
        const d = parseCellDate(cell);
        if (d) dates.push(d);
      }
    }
    if (!dates.length) return null;
    const earliest = Math.min(...dates);
    const d = new Date(earliest);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function parseCellDate(cell: unknown): number | null {
  if (cell instanceof Date) {
    const t = cell.getTime();
    return isNaN(t) ? null : t;
  }
  if (typeof cell === 'number') {
    // Excel serial date (days since 1899-12-30). Plausible range: 1900-2100.
    if (cell > 1 && cell < 80000) {
      const ms = (cell - 25569) * 86400 * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return null;
  }
  if (typeof cell === 'string') {
    const trimmed = cell.trim();
    if (!trimmed) return null;
    // Common formats: 2026-03-31, 2026/03/31, 2026-03-31 17:59:51, 2026年3月31日
    const m = trimmed.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const da = parseInt(m[3], 10);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        return new Date(y, mo - 1, da).getTime();
      }
    }
  }
  return null;
}

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
  const fallbackYYYYMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const uploadedFileName = file ? (file.name || '') : '';
  // 1) try filename (2603-, 2026-03, 2025年12月, etc.)
  // 2) if missing, read the first transaction date from inside the xlsx
  // 3) last resort: current month
  const fileBufferForMonth = file ? Buffer.from(await file.arrayBuffer()) : null;
  const yyyyMM =
    extractMonthFromFilename(uploadedFileName) ||
    (fileBufferForMonth ? extractMonthFromXlsx(fileBufferForMonth) : null) ||
    fallbackYYYYMM;

  if (!file || !brand || !store || !source) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), '..', 'inputs', brand, store, source, yyyyMM);
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true });
  }

  const fileName = file.name;
  const filePath = path.join(uploadDir, fileName);
  const fileBuffer = fileBufferForMonth ?? Buffer.from(await file.arrayBuffer());
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
      const scriptArgs = source === 'income'
        ? [filePath, '--brand', brand, '--store-code', store]
        : [filePath];

      if (source === 'bank') {
        scriptName = 'import_yufeng_bank_txn.py';
      } else if (source === 'income') {
        scriptName = brand === 'bonjur'
          ? 'import_bonjur_income_detail.py'
          : 'import_gelatomiiix_income_detail.py';
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
