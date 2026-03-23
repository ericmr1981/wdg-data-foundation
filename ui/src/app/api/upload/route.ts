import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import pool from '@/lib/db';

// POST /api/upload - 上传文件并触发导入
export async function POST(request: Request) {
  try {
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
    const buffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    let importResult = null;
    let importError = null;

    // 触发导入脚本
    if (triggerImport) {
      try {
        const scriptDir = path.join(process.cwd(), '..', 'scripts');
        let scriptName = '';
        let scriptArgs = [filePath];

        if (source === 'bank') {
          scriptName = 'import_yufeng_bank_txn.py';
        } else if (source === 'sales') {
          scriptName = 'import_bonjur_sales_daily.py';
        } else {
          return NextResponse.json({ success: false, error: 'Unknown source type' }, { status: 400 });
        }

        const scriptPath = path.join(scriptDir, scriptName);

        // 运行导入脚本
        const importOutput = await new Promise<string>((resolve, reject) => {
          // Prefer project venv python (so pandas/openpyxl exist); fallback to python3
          const projectRoot = path.join(process.cwd(), '..');
          const pythonBin =
            process.env.PYTHON_BIN ||
            path.join(projectRoot, '.venv', 'bin', 'python') ||
            'python3';

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

    return NextResponse.json({
      success: true,
      data: {
        filePath,
        fileName,
        fileMonth: yyyyMM,
        importResult,
        importError
      }
    });
  } catch (error: any) {
    console.error('Error uploading file:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
