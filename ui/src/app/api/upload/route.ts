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
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const brand = formData.get('brand') as string;
    const store = formData.get('store') as string;
    const source = formData.get('source') as string;
    // month 不再从表单接收，改用系统当前时间（Asia/Shanghai）
    const triggerImport = formData.get('triggerImport') === 'true';

    // 使用系统当前时间（上海时区）
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const yyyyMM = `${year}-${month}`;

    if (!file || !brand || !store || !source) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // 创建上传目录
    const uploadDir = path.join(process.cwd(), '..', 'inputs', brand, store, source, yyyyMM);
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 保存文件
    const fileName = file.name;
    const filePath = path.join(uploadDir, fileName);
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // 上传回执：提前计算 SHA-256（与导入脚本的幂等逻辑对齐）
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    await writeFile(filePath, fileBuffer);

    let importResult = null;
    let importError = null;

    // 触发导入脚本
    if (triggerImport) {
      try {
        // Resolve scripts directory with Docker-friendly defaults
        const defaultScriptsDir = path.join(process.cwd(), '..', 'scripts');
        const scriptsDir =
          process.env.SCRIPTS_DIR ||
          (existsSync(defaultScriptsDir) ? defaultScriptsDir : existsSync('/scripts') ? '/scripts' : defaultScriptsDir);

        let scriptName = '';
        let scriptArgs = [filePath];

        if (source === 'bank') {
          scriptName = 'import_yufeng_bank_txn.py';
        } else if (source === 'sales') {
          scriptName = 'import_bonjur_sales_daily.py';
        } else {
          return NextResponse.json({ success: false, error: 'Unknown source type' }, { status: 400 });
        }

        const scriptPath = path.join(scriptsDir, scriptName);

        // 运行导入脚本
        const importOutput = await new Promise<string>((resolve, reject) => {
          // Robust python binary selection: env var > venv (if exists) > python3
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

          childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          childProcess.on('close', (code) => {
            if (code === 0) {
              resolve(stdout);
            } else {
              reject(new Error(stderr || `Process exited with code ${code}`));
            }
          });

          childProcess.on('error', (err) => {
            reject(err);
          });
        });

        importResult = importOutput;
      } catch (error: any) {
        importError = error.message;
      }
    }

    // 上传回执：尝试回读 raw.ingest_file（无论 triggerImport 与否，只要库里存在就会回显）
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
      // best-effort: do not block upload on receipt query
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
        importError
      }
    });
  } catch (error: any) {
    console.error('Error uploading file:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
