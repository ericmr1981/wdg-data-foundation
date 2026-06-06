# Chat Agent — 验证流程

## 日常开发

每次改完 chat 相关代码，**至少**跑：

```bash
bash scripts/verify-chat-agent.sh
```

verify 脚本会串行检查以下 4 项（任一失败即非零退出）：

1. **Chat unit tests** — `cd ui && node --test --experimental-strip-types tests/chat/*.test.ts`
2. **DDL pytest** — `pytest tests/test_chat_ddl.py -v`（需要 `DATABASE_URL`）
3. **TypeScript** — `cd ui && npx tsc --noEmit`
4. **TOOLS registry** — `node scripts/check-tools-registry.mjs`（确保 `ui/src/mcp/tools/*.ts` 中的每个 tool 都在 `ui/src/mcp/server.ts:TOOLS` map 注册过）

## 添加新 MCP tool

1. 写 `ui/src/mcp/tools/foo.ts`，导出 `xxxTool` 对象
2. 在 `ui/src/mcp/server.ts:TOOLS` map 注册
3. 跑 `bash scripts/verify-chat-agent.sh` 确认 4 项都过
4. 推 commit

## 如果 verify 失败

| 失败项 | 看哪 |
|---|---|
| Chat unit tests | `cd ui && node --test --experimental-strip-types tests/chat/*.test.ts`（详细输出） |
| DDL pytest | `pytest tests/test_chat_ddl.py -v`（需 DB） |
| TypeScript | `cd ui && npx tsc --noEmit`（看具体行） |
| TOOLS registry | `node scripts/check-tools-registry.mjs`（看缺哪个） |

## CI

`push to main` → GitHub Actions 跑 verify → 失败阻断 deploy。

Secrets 需：`DATABASE_URL`（for DDL check）。其他 secrets 已有。

## 相关文档

- [chat-acceptance.md](./chat-acceptance.md) — Chat widget 人工验收清单（手动 checklist + Agent 行为断言）
- [mcp-tools.md](./mcp-tools.md) — 45 个 MCP 工具的完整清单与写权限原则
- [architecture.md](./architecture.md) — 系统架构总览
