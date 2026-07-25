import { NextRequest, NextResponse } from 'next/server';
import { ensureAdmin, fetchRun, fetchSteps } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await ensureAdmin(req);
  if (response) return response;

  const run = await fetchRun(params.id);
  if (!run) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const steps = await fetchSteps(params.id);

  // 计算进度
  const total = steps.length;
  const completed = steps.filter(s => ['success', 'failed', 'skipped', 'cancelled'].includes(s.status)).length;
  const current = steps.find(s => s.status === 'running')?.step_name ?? null;

  return NextResponse.json({
    run,
    steps,
    progress: {
      completed, total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      current,
    },
  });
}