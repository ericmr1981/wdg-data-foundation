// ui/src/app/api/admin/agent-config/route.ts
// v1: 改为 5 行 fetch 代理, 实际配置存在 Agent 进程
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

async function proxy(req: NextRequest, method: 'GET' | 'POST' | 'DELETE') {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = method === 'GET' ? undefined : await req.text()
  const r = await fetch(`${AGENT_URL}/api/admin/config`, {
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
