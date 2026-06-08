# Agent Service

> WDG Agent-First Product 的核心服务. 独立 Node.js 进程, 提供 Agent 能力 (主动巡检 / Skill 工作流 / 任务队列 / 短期记忆).

## 架构

```
浏览器用户 (B/A)          Cron (定时)         钉钉 (v2)
     │                      │                   │
     ▼ WebSocket            ▼ IncomingMsg       ▼
┌──────────────────────────────────────────┐
│       Agent Service (port 4101)         │
│  ┌─────────┐ ┌────────┐ ┌──────────┐    │
│  │Channel  │→│ConvoMgr│→│LLM Runner │    │
│  └─────────┘ └────────┘ └────┬─────┘    │
│                              │          │
│                  ┌───────────┴──┐       │
│                  ▼              ▼       │
│            MCP Bridge    Task Scheduler │
│       (调 /api/mcp)    (DB-backed queue)│
└──────────────────────────┬──────────────┘
                           ▼
                    PostgreSQL (agent.* schema)
```

## 启动

```bash
# 起 4 个服务 (db / ui / agent / metabase)
docker compose up -d

# 验证 agent 健康
curl http://localhost:4101/health
# {"status":"ok"}

# 验证 agent 暴露 metrics
curl http://localhost:4101/metrics | head -3
```

## 配置

通过 `/u/admin/agent-config` (admin only) 在线改:
- 业务指令 (agent.md 内容)
- LLM 调试参数 (maxTokens / temperature / thinking / 等)
- Credentials (baseURL / apiKey / model)

变更**热生效**, 下一个 WebSocket 消息 / Cron tick 用新配置.

## 添加新 Skill

1. 写 `agent/skills/<name>.md`, 含 YAML frontmatter:
   ```yaml
   ---
   name: my-skill
   description: 1-2 句说明, LLM 据此判断何时加载
   triggers: ["关键词1", "关键词2"]
   ---
   ```
2. 正文是 markdown 工作流说明
3. 重启 agent (未来 v1.1 加 hot reload)
4. 启动时自动扫, 不用改代码

## 添加新任务类型

1. 在 `agent/src/tasks/handlers/<name>.ts` 写 AsyncGenerator handler
2. `registerTaskHandler('type_name', handler)` 在 server.ts 启动时调
3. (可选) 在 `agent/src/channels/cron.ts` 加 cron 表达式

## 监控

- `/metrics` 端点: Prometheus 格式 (llm_call_total / mcp_call_total / tasks_by_status 等)
- `/u/notifications` 页面: 任务执行历史
- `agent.audit_log` 表: 所有 tool_call / 消息 / 错误的审计

## 切流

通过 `NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT` env 控制:
- 0 = 所有人走 v0 chat (fallback)
- 100 = 所有人走 agent
- 其他 = 按 user_id 哈希分流

```bash
# 切流到 50%
sed -i '' 's/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=.*/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=50/' .env
docker compose restart ui
```

## 详细参考

- [Spec](../superpowers/specs/2026-06-08-agent-first-product.md)
- [Plan](../superpowers/plans/2026-06-08-agent-first-product.md)
- [MCP Tools 清单](mcp-tools.md)
