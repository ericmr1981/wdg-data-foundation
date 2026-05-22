import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';

// 该接口依赖 cookies()，必须强制动态 + 禁止缓存，否则可能出现“重新登录后 Nav 仍读到旧 401 缓存”的诡异现象。
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(
    { success: true, data: user },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
