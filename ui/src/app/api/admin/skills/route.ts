// ui/src/app/api/admin/skills/route.ts
// 代理 agent /api/admin/skills (list + create)
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

async function proxy(req: NextRequest, method: 'GET' | 'POST') {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = method === 'GET' ? undefined : await req.text()
  const r = await fetch(`${AGENT_URL}/api/admin/skills`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-wdg-user-id': user.user_id,
      'x-wdg-user-role': user.role,
    },
    body,
  })
  return NextResponse.json(await r.json())
}

export async function GET(req: NextRequest) { return proxy(req, 'GET') }
export async function POST(req: NextRequest) { return proxy(req, 'POST') }
