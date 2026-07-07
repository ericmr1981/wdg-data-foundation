// Tamkoko 收银明细上传 API
// 镜像 ui/src/app/api/tamkoko/income/upload-qimai/route.ts
// 委托到 scripts/import_tamkoko_cash_register.py
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';

export async function POST(request: NextRequest) {
    // 1. auth: x-mcp-session bypass OR admin/operator
    const isMcp = request.headers.get('x-mcp-session') === 'internal';
    if (!isMcp) {
        const user = await getSessionUser(request);
        try {
            assertRole(user, ['admin', 'operator']);
        } catch (err) {
            const status = (err as { status?: number })?.status ?? 401;
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status });
        }
    }

    // 2. parse form
    const form = await request.formData();
    const file = form.get('file');
    const store = (form.get('store') as string | null) ?? null;
    const period = (form.get('period') as string | null) ?? null;
    const replace = (form.get('replace') as string | null) === 'true';

    if (!(file instanceof File) || !store) {
        return NextResponse.json({ success: false, error: 'file + store required' }, { status: 400 });
    }

    // 3. store guard
    try {
        const { rows } = await pool.query(
            `SELECT 1 FROM ops.stores WHERE brand_code='tamkoko' AND store_code=$1 AND enabled=true LIMIT 1`,
            [store]
        );
        if (!rows?.length) {
            const { rows: valid } = await pool.query(
                `SELECT store_code FROM ops.stores WHERE brand_code='tamkoko' AND enabled=true ORDER BY store_code`
            );
            return NextResponse.json({
                success: false,
                error: `invalid store; valid: ${valid.map((r: { store_code: string }) => r.store_code).join(',')}`,
            }, { status: 400 });
        }
    } catch (error) {
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }

    // 4. SHA256 + ingest_file dedup (best-effort)
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    try {
        const q = await pool.query(
            `SELECT id, status, row_count::int FROM raw.ingest_file WHERE file_hash=$1 LIMIT 1`,
            [fileHash]
        );
        if (q.rows?.length && q.rows[0].status === 'success') {
            return NextResponse.json({
                success: true,
                data: {
                    sourceFileId: q.rows[0].id,
                    fileName: file.name,
                    totalRows: q.rows[0].row_count,
                    insertedRows: q.rows[0].row_count,
                    skipped: true,
                },
            });
        }
    } catch { /* best-effort */ }

    // 5. save file
    const now = new Date();
    const yyyyMM = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const projectRoot = path.join(process.cwd(), '..');
    const uploadDir = path.join(projectRoot, 'inputs', 'tamkoko', store, 'sales', 'cash_register', yyyyMM);
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, file.name);
    writeFileSync(filePath, fileBuffer);

    // 6. spawn import script
    const venvPython = path.join(projectRoot, '.venv', 'bin', 'python');
    const pythonBin = process.env.PYTHON_BIN || (existsSync(venvPython) ? venvPython : 'python3');
    const scriptPath = path.join(projectRoot, 'scripts', 'import_tamkoko_cash_register.py');
    let importError: string | null = null;
    let stdout = '';
    let stderr = '';
    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(pythonBin, [scriptPath, filePath, ...(replace ? ['--replace'] : [])], {
                cwd: projectRoot,
                env: { ...process.env, CASH_REGISTER_STORE_CODE: store },
            });
            child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
            child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
            child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr}`)));
        });
    } catch (err) {
        importError = getErrorMessage(err);
    }

    // 7. read back sourceFileId from raw.ingest_file
    let sourceFileId: number | null = null;
    let totalRows: number | null = null;
    try {
        const q = await pool.query(
            `SELECT id, row_count::int, status FROM raw.ingest_file WHERE file_hash=$1 LIMIT 1`,
            [fileHash]
        );
        if (q.rows?.length) {
            sourceFileId = q.rows[0].id;
            totalRows = q.rows[0].row_count;
        }
    } catch { /* best-effort */ }

    if (importError) {
        return NextResponse.json({ success: false, error: importError, data: { sourceFileId, stdout, stderr } }, { status: 500 });
    }
    return NextResponse.json({
        success: true,
        data: { sourceFileId, fileName: file.name, totalRows, insertedRows: totalRows, skipped: false, stdout },
    });
}