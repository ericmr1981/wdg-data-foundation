// ui/src/app/api/admin/skills/[name]/route.ts
// 代理 agent /api/admin/skills/:name (get / put / delete)
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

async function proxy(
  req: NextRequest,
  method: 'GET' | 'PUT' | 'DELETE',
  name: string,
) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = method === 'GET' ? undefined : await req.text()
  const r = await fetch(`${AGENT_URL}/api/admin/skills/${encodeURIComponent(name)}`, {
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  return proxy(req, 'GET', name)
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  return proxy(req, 'PUT', name)
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  return proxy(req, 'DELETE', name)
}
