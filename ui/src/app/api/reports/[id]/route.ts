import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, statSync } from 'node:fs';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    const { rows } = await pool.query(
      'SELECT file_name, file_path, file_size FROM ops.report_file WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const { file_name, file_path, file_size } = rows[0];
    try {
      statSync(file_path);
    } catch {
      return NextResponse.json({ error: 'file missing on disk' }, { status: 410 });
    }
    const buf = readFileSync(file_path);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': String(file_size ?? buf.length),
        'Content-Disposition': `attachment; filename="${file_name}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
