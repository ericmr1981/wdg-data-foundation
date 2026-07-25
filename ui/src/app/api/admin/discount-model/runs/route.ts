import { NextRequest, NextResponse } from 'next/server';
import { ensureAdmin, fetchRuns, fetchLatestActive } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { response } = await ensureAdmin(req);
  if (response) return response;

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || '20');

  const [runs, active] = await Promise.all([fetchRuns(limit), fetchLatestActive()]);
  return NextResponse.json({ runs, active });
}