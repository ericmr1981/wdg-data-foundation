// ui/src/app/api/admin/restart-agent/route.ts
// POST → Agent /api/admin/restart (触发 systemd restart)
//
// 修复假阳性 bug: 旧版对所有 status: 0 一律返回 success, 导致 agent 完全没启动
// 时 ("ECONNREFUSED") 也会被当成"重启成功"。现在先 health check (GET /api/admin/config),
// 不可达就明确返 503, 让 UI 立即红字报错, 而不是走 90 秒超时轮询。

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth-server';
import { callAgent } from '@/lib/agent-config-proxy';

const HEALTH_TIMEOUT_MS = 2000;

export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 1. Health check: 先确认 agent 进程在跑, 否则下面的 restart 永远传不进去
  const health = await callAgent(
    '/api/admin/config',
    { method: 'GET' },
    HEALTH_TIMEOUT_MS,
  );
  if (health.detail && health.status === 0) {
    return NextResponse.json(
      {
        error: 'agent_unreachable',
        message: 'Agent 服务未启动，请在 host 手动执行 `cd agent && npm start`',
      },
      { status: 503 },
    );
  }
  if (health.status >= 500) {
    return NextResponse.json(
      {
        error: 'agent_unhealthy',
        message: `Agent 返回 ${health.status}，请检查 agent 日志与数据库连接`,
      },
      { status: 503 },
    );
  }

  // 2. Forward restart
  const result = await callAgent('/api/admin/restart', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (result.status === 202) {
    return NextResponse.json({ success: true, message: 'restarting...' });
  }
  // 重启触发后 agent 立刻 exit, 可能 race → fetch failed. 这种场景 503 已经说过可达
  // 这里 agent 真正重启才丢 — 500 系列给前端分辨。
  if (result.detail && result.status === 0) {
    return NextResponse.json(
      {
        error: 'restart_lost',
        message: '已发出 restart 命令但连接断开，请检查 agent 日志确认是否被拉起',
      },
      { status: 502 },
    );
  }
  return NextResponse.json(result.body ?? {}, { status: result.status || 200 });
}
