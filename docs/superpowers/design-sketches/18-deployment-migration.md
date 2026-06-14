# WDG v1 — 部署 + 迁移 + 回滚

> v0: 3 个服务 (db / ui / metabase), 一个 docker-compose.yml 起
> v1: + agent service, 切流 + 双跑 (shadow mode) + 出问题秒回滚

## 1. 部署拓扑变化

### 1.1 v0 现状 (3 服务)

```yaml
# docker-compose.yml (现状, 简化)
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
  ui:
    build: ./ui
    ports: ["4100:4100"]
    depends_on: [db]
  metabase:
    image: metabase/metabase
    ports: ["3030:3030"]
    depends_on: [db]
```

### 1.2 v1 目标 (4 服务)

```yaml
# docker-compose.yml (v1)
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
  ui:
    build: ./ui
    ports: ["4100:4100"]
    depends_on: [db, agent]      # ← 加 agent 依赖
    environment:
      - AGENT_URL=http://agent:4101   # ← 加这个
  agent:                              # ← 新增
    build: ./agent
    ports: ["4101:4101"]              # 内部端口, 不暴露公网
    environment:
      - MCP_ENDPOINT=http://ui:4100/api/mcp
      - DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@db:5432/wdg
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - WS_PORT=4101
      - CRON_TIMEZONE=Asia/Shanghai
      - LOG_LEVEL=info
    depends_on: [db]
    volumes:
      - ./agent/skills:/app/skills:ro   # skill 文件, 只读
    restart: unless-stopped
    healthcheck:                          # ← 健康检查
      test: ["CMD", "wget", "-q", "-O", "-", "http://localhost:4101/health"]
      interval: 30s
      timeout: 5s
      retries: 3
  metabase:
    image: metabase/metabase
    ports: ["3030:3030"]
    depends_on: [db]
```

### 1.3 端口分配

| 端口 | 服务 | 公网暴露 |
|---|---|---|
| 5432 | db | ❌ |
| 3030 | metabase | ✅ (BI 用户) |
| 4100 | ui (Next.js) | ✅ (业务用户) |
| **4101** | **agent (Node.js)** | **❌ (仅内部)** |

Agent 不暴露公网, 只能从 Next.js / 内网访问。

## 2. 切流策略 — 5 阶段

### 阶段 0: 准备 (W5 末尾, 部署前)

```
前置:
  · Agent Service 跑通
  · Skill 文件就位
  · DB schema migrate (00_agent_schema.sql)
  · ChatDrawer 改 endpoint (PR #1)
  · Admin UI proxy 改 endpoint (PR #2)
  · 部署到 staging 环境
  · 跑通 5 个 skill 的 e2e
```

### 阶段 1: Agent Service 上线, 旧 /api/chat 保留 (Shadow Mode)

```
状态: 4 服务都起, 但 ChatDrawer 仍走 v0 /api/chat
  · Agent Service 跑着, 但没人连
  · 每天 9 点的 cron 跑通, 输出落到 agent.tasks
  · admin 在 /u/notifications 看到巡检报告, 但**手动看**
  · 监控 Agent Service 的稳定性 (3-5 天)

持续: 3-5 天
回滚: 不需要 (没切流)
```

### 阶段 2: 单个 B 用户切流 (Canary)

```
状态: 选 1-2 个 B 用户 (例如"小李"), 他们的 ChatDrawer 走 agent:4101
  · 改法: 用 feature flag / env var / user_id 白名单
  · 小李看到 ChatDrawer 行为不变, 但背后是 Agent Service
  · 其他人仍走 v0 /api/chat

回滚: 把白名单关掉, 秒回
```

### 阶段 3: 灰度

```
状态: B 用户 50% 切流, A 用户 0%
  · 按 user_id 哈希分流
  · 监控 2 类指标: (a) 错误率, (b) 响应延迟
  · 出问题 (错误率 >5%) → 全部回滚到 0%

持续: 1-2 周
```

### 阶段 4: 全量 + 清理

```
状态: 100% 切流
  · 所有用户走 agent:4101
  · v0 的 /api/chat 保留 1-2 周作为 fallback
  · Admin UI 走 agent:4101
  · 监控无异常后, 删 v0 chat 相关代码
```

### 阶段 5: 完全退役 v0 chat

```
状态:
  · 删 ui/src/app/api/chat/route.ts
  · 删 ui/src/lib/chat/agent-config-store.ts (复制走的)
  · 删 ui/src/lib/chat/prompt.ts
  · 删 ui/src/lib/chat/secret-crypto.ts (模块搬到 agent 复用)
  · ChatDrawer 不再有 fallback URL
```

## 3. 切流实现 (Feature Flag)

```typescript
// ui/src/lib/feature-flags.ts (新增)
export function shouldUseAgentService(userId: string): boolean {
  const flag = process.env.AGENT_ROLLOUT_PERCENT ?? '0'  // 0-100
  const pct = parseInt(flag, 10)

  if (pct === 0) return false
  if (pct >= 100) return true

  // 简单哈希分流 (不保证严格均匀, 但够用)
  const hash = [...userId].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return (hash % 100) < pct
}
```

```typescript
// ui/src/components/chat/ChatDrawer.tsx (改造)
// 旧:
const ws = new EventSource('/api/chat')

// 新:
const useAgent = shouldUseAgentService(user.id)
const ws = useAgent
  ? new WebSocket('ws://agent:4101/ws')          // 走 agent
  : new EventSource('/api/chat')                  // 走 v0 fallback
```

## 4. 数据库迁移

### 4.1 Schema 迁移

```bash
# sql/00_agent_schema.sql (新文件)
# 5 张表 (conversations / messages / tasks / task_steps / audit_log)
# 跑一次, 不可逆 (真要回滚就 DROP SCHEMA agent CASCADE)
```

### 4.2 迁移步骤

```
1. 应用 sql/00_agent_schema.sql (CREATE SCHEMA agent + 5 张表)
2. 验证: SELECT * FROM agent.conversations LIMIT 0;
3. 不需要数据迁移 (新 schema, 旧数据无关)
```

## 5. 监控切流期间的关键指标

| 指标 | 阈值 | 触发动作 |
|---|---|---|
| Agent Service uptime | < 99% | 告警, 人工查 |
| WebSocket 连接成功率 | < 95% | 灰度回滚 |
| LLM 调用错误率 | > 5% | 灰度回滚 |
| MCP 工具调用错误率 | > 10% | 单 tool 告警 |
| 任务成功率 (Cron 跑过的) | < 80% | 告警 |
| P95 响应延迟 (LLM) | > 30s | 告警 |
| 内存占用 | > 80% | 告警, 重启 |

## 6. 回滚预案

### 6.1 立即回滚 (秒级)

```bash
# 1. 关闭 agent 服务
docker compose stop agent

# 2. 把 feature flag 改回 0
# 改 .env: AGENT_ROLLOUT_PERCENT=0
# 重启 ui 让 env 生效
docker compose restart ui
```

**效果**: 所有用户秒回 v0 chat, 不需要前端代码改动。

### 6.2 部分回滚 (分钟级)

```bash
# 1. 灰度回退 (AGENT_ROLLOUT_PERCENT=10)
# 2. 观察 30 分钟
# 3. 还不行 → 0%
```

### 6.3 紧急回滚 (小时级)

如果 Agent Service 出现**数据写入问题** (例如 audit_log 写爆), 需手动:
```sql
-- 1. 暂停所有 cron
UPDATE agent.tasks SET status = 'CANCELLED' WHERE status IN ('QUEUED', 'RUNNING');

-- 2. 删 agent schema (核弹选项,慎用)
DROP SCHEMA agent CASCADE;

-- 3. 回到 6.1
```

## 7. 灰度发布脚本

```bash
#!/bin/bash
# scripts/rollout-agent.sh
# 用法: ./scripts/rollout-agent.sh 0|10|50|100

set -e
PERCENT=$1

if [[ ! "$PERCENT" =~ ^(0|10|50|100)$ ]]; then
  echo "Usage: $0 <0|10|50|100>"
  exit 1
fi

# 1. 改 .env
sed -i '' "s/AGENT_ROLLOUT_PERCENT=.*/AGENT_ROLLOUT_PERCENT=$PERCENT/" .env

# 2. 重启 ui
docker compose restart ui

# 3. 验证
echo "Rollout set to $PERCENT%"
docker compose exec ui env | grep AGENT_ROLLOUT
```

## 8. 回滚 checklist (打印出来贴工位)

```
[ ] 1. AGENT_ROLLOUT_PERCENT=0
[ ] 2. docker compose restart ui
[ ] 3. 验证: 找 1 个用户, ChatDrawer 仍能用 (走 v0 chat)
[ ] 4. 查: agent.tasks 表, 没有新任务入队
[ ] 5. 通知: 在 #wdg-alert 频道发"Agent Service rolled back to 0%"
[ ] 6. 复盘: 24h 内写 postmortem
```

## 9. 部署顺序 (W5 收尾)

```
Day 1 (周一):
  · 跑 sql/00_agent_schema.sql
  · 起 agent 服务 (4 service compose)
  · 跑 cron 一次, 验证任务能跑通

Day 2-5:
  · 阶段 1: Shadow mode, 跑 5 天

Day 6:
  · 阶段 2: 选 1 个 B 用户, 切流

Day 7-13:
  · 阶段 3: 灰度 10% → 50%, 持续 1 周

Day 14:
  · 阶段 4: 100%

Day 28:
  · 阶段 5: 删 v0 chat 代码
```

## 10. 这个组件你看什么

- **5 阶段切流** — 不一步到位, 风险最小
- **Feature flag 用 env var + 哈希分流** — 简单, 不用 LaunchDarkly
- **Agent 端口不暴露公网** — 只能内网访问
- **回滚秒级** (改 env var 重启) / **分钟级** (灰度调整) / **小时级** (核弹 DROP SCHEMA)
- **DB 迁移只 1 步** — 新 schema, 旧数据无关
