// ui/src/app/api/admin/test-connection/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // 任何登录用户都能测 (测连接是只读)

  const r = await fetch(`${AGENT_URL}/api/admin/test-connection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-wdg-user-id': user.user_id,
      'x-wdg-user-role': user.role,
    },
  })
  return NextResponse.json(await r.json())
}
