// ui/src/app/api/notifications/route.ts
// Proxy agent's /api/tasks endpoint for browser consumption.
// Auth: must be logged-in WDG user. The agent trusts the wdg user-id header
// for filtering, but only ops/agent-side tooling may schedule tasks.
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'

const AGENT_URL = process.env.AGENT_INTERNAL_URL ?? 'http://agent:4101'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = url.searchParams.get('limit') ?? '20'

  try {
    const r = await fetch(
      `${AGENT_URL}/api/tasks?user_id=${user.user_id}&limit=${limit}`,
      {
        headers: {
          'x-wdg-user-id': user.user_id,
          'x-wdg-user-role': user.role,
        },
        cache: 'no-store',
      },
    )
    const data = await r.json().catch(() => ({}))
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    // Agent offline — return empty list rather than 500, so UI renders gracefully.
    return NextResponse.json({ tasks: [], note: 'agent_unreachable' })
  }
}
