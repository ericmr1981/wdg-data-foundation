import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// POST /api/xintiandi/upload - 上传配送明细Excel并导入
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
    
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const batchId = formData.get('batchId') as string | null;
    const triggerImport = formData.get('triggerImport') !== 'false'; // default true

    if (!file) {
      return NextResponse.json({ success: false, error: 'Missing file' }, { status: 400 });
    }

    // File type validation
    const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;
    const fileExt = '.' + file.name.toLowerCase().split('.').pop()!;
    if (!ALLOWED_EXTENSIONS.includes(fileExt as typeof ALLOWED_EXTENSIONS[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid file type: ${fileExt}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
        { status: 400 }
      );
    }

    // 保存到 inputs/xintiandi 目录
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uploadDir = path.join(process.cwd(), '..', 'inputs', 'xintiandi', 'delivery', yearMonth);
    
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const fileName = file.name;
    const filePath = path.join(uploadDir, fileName);
    const buffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    let importResult = null;
    let importError = null;

    // 触发导入脚本
    if (triggerImport) {
      try {
        const projectRoot = path.join(process.cwd(), '..');
        const defaultScriptsDir = path.join(projectRoot, 'scripts');
        const scriptsDir = process.env.SCRIPTS_DIR || defaultScriptsDir;
        const scriptPath = path.join(scriptsDir, 'import_xintiandi_delivery.py');

        const venvPython = path.join(projectRoot, '.venv', 'bin', 'python');
        const pythonBin = process.env.PYTHON_BIN || (existsSync(venvPython) ? venvPython : 'python3');

        const scriptArgs = [filePath];
        if (batchId) scriptArgs.push('--batch-id', batchId);

        const importOutput = await new Promise<string>((resolve, reject) => {
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
        yearMonth,
        importResult,
        importError
      }
    });
  } catch (error: any) {
    console.error('Error uploading xintiandi file:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
