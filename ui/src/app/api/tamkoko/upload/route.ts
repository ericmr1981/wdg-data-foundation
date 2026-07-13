import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// POST /api/tamkoko/upload
// multipart/form-data: file=<xlsx>, period='YYYY-MM', storeCode='hz_fuyang' (default)
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    assertRole(user, ['admin', 'operator']);
  } catch {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const period = formData.get('period') as string | null;
  const storeCode = (formData.get('storeCode') as string | null) || 'hz_fuyang';

  if (!file) {
    return NextResponse.json({ success: false, error: 'Missing file' }, { status: 400 });
  }
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ success: false, error: 'Invalid period (YYYY-MM)' }, { status: 400 });
  }

  const ALLOWED: readonly string[] = ['.xlsx', '.xls'];
  const fileExt = '.' + file.name.toLowerCase().split('.').pop()!;
  if (!ALLOWED.includes(fileExt)) {
    return NextResponse.json({ success: false, error: `Invalid file type: ${fileExt}` }, { status: 400 });
  }

  const projectRoot = path.join(process.cwd(), '..');
  const uploadDir = path.join(projectRoot, 'inputs', 'tamkoko', storeCode, 'inventory', period);
  if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });

  const filePath = path.join(uploadDir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const scriptsDir = process.env.SCRIPTS_DIR || path.join(projectRoot, 'scripts');
  const scriptPath = path.join(scriptsDir, 'import_tamkoko_inventory.py');
  const venvPython = path.join(projectRoot, '.venv', 'bin', 'python');
  const pythonBin = process.env.PYTHON_BIN || (existsSync(venvPython) ? venvPython : 'python3');

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const cp = spawn(pythonBin, [
        scriptPath, filePath, '--period', period, '--store-code', storeCode,
      ], { cwd: projectRoot, env: { ...process.env } });
      let out = '', err = '';
      cp.stdout.on('data', d => out += d.toString());
      cp.stderr.on('data', d => err += d.toString());
      cp.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`)));
    });
    return NextResponse.json({ success: true, data: { stdout, filePath } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
