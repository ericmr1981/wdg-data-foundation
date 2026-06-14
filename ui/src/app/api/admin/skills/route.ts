// ui/src/app/api/admin/skills/route.ts
// 代理 agent /api/admin/skills (list + create)
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

async function proxy(req: NextRequest, method: 'GET' | 'POST') {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // POST /api/admin/skills 创建 skill body 是 JSON {name: string}
  // 只有 body 真为空时才省略 Content-Type (否则 Fastify 拒)
  const bodyText = method === 'GET' ? '' : await req.clone().text()
  const hasBody = bodyText.length > 0
  const r = await fetch(`${AGENT_URL}/api/admin/skills`, {
    method,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      'x-wdg-user-id': user.user_id,
      'x-wdg-user-role': user.role,
    },
    body: hasBody ? bodyText : undefined,
  })
  return NextResponse.json(await r.json())
}

export async function GET(req: NextRequest) { return proxy(req, 'GET') }
export async function POST(req: NextRequest) { return proxy(req, 'POST') }
