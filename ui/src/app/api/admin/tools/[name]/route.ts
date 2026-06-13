// ui/src/app/api/admin/tools/[name]/route.ts
// 代理 agent /api/admin/tools/:name (PUT toggle)
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

export async function PUT(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { name } = await ctx.params
  const body = await req.text()
  const r = await fetch(`${AGENT_URL}/api/admin/tools/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-wdg-user-id': user.user_id,
      'x-wdg-user-role': user.role,
    },
    body,
  })
  return NextResponse.json(await r.json())
}
