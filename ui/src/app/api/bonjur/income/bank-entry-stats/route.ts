import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const client = await pool.connect();
  try {
    const test = await client.query('SELECT 1 AS ok');
    const dbOk = test.rows[0]?.ok === 1;

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    const store = searchParams.get('store') || '';

    return NextResponse.json({
      success: true,
      data: { db_ok: dbOk, period, store, message: 'minimal endpoint works' },
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    client.release();
  }
}
