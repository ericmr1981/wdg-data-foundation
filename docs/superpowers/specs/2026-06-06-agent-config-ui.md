# Agent Configuration UI Design

## 1. 概述

让项目 admin 可以在 Web 上**编辑 `agent.md`**（自定义 agent 提示词）和**调整调试配置参数**（模型采样、token 限、重试深度等），无需改代码或重启 server。变更**热生效**到下一个请求。

## 2. 范围

### 包含
- **`agent.md` 文件**在 `ui/src/lib/chat/agent.md`，是默认模板（git 跟踪）
- **管理 UI** `/u/admin/agent-config`（admin-only）
  - 编辑 `agent.md` 内容（textarea + Markdown 预览）
  - 调整 7 个调试参数
  - 保存/重置按钮
- **后端 API**：
  - `GET /api/admin/agent-config` — 返回当前 agent.md 内容和参数
  - `POST /api/admin/agent-config` — 保存（写 repo + 内存 + 触发热生效）
  - `POST /api/admin/agent-config/reset` — 重置回仓库默认值
- **运行时配置 store**（in-memory，per process）：`ui/src/lib/chat/agent-config-store.ts`
- **route.ts 集成**：启动时从 store 读，每次 `client.messages.create` 用最新参数
- **prompt.ts 集成**：`buildSystemPrompt` 接受可选 `customInstructions` 参数，把 agent.md 内容插到通用规则前

### 不包含（一期 YAGNI）
- 多 admin 各自的 agent.md（所有人共享同一份）
- 审计日志（写到 `ops.chat_session_log` 类似表；不在范围）
- agent.md 的版本控制 / diff 查看（用 git 看）
- Markdown 完整渲染（textarea + 简单预览即可，不引入新依赖）
- 配置导入/导出 JSON

## 3. 架构

```
Browser /u/admin/agent-config (admin only)
  │
  ├─ GET /api/admin/agent-config  → { agentMdContent, params, defaultParams, dirty }
  │
  └─ POST /api/admin/agent-config → { success, params, message }
       │
       ├─ Permission check (role=admin)
       ├─ Write agent.md to disk (ui/src/lib/chat/agent.md)
       ├─ Update in-memory store (agent-config-store.ts)
       └─ Return new state

Next /api/chat request:
  route.ts:
    const cfg = agentConfigStore.get();  // returns { agentMd, params }
    const system = buildSystemPrompt(ctx, tools, {
      customInstructions: cfg.agentMd,
      compact: ...,
    });
    const response = await client.messages.create({
      model: anthropicModel,
      system,
      tools: ...,
      messages: ...,
      max_tokens: cfg.params.maxTokens,         // from UI
      temperature: cfg.params.temperature,      // from UI
      max_tool_chain_depth: cfg.params.maxToolChainDepth,  // local var
    });
```

## 4. 文件清单

**新增**：
- `ui/src/lib/chat/agent.md` — 默认模板（git 跟踪）
- `ui/src/lib/chat/agent-config-store.ts` — 运行时 in-memory 配置
- `ui/src/app/api/admin/agent-config/route.ts` — GET + POST + DELETE
- `ui/src/app/u/admin/agent-config/page.tsx` — 管理 UI
- `ui/src/components/admin/AgentConfigEditor.tsx` — 编辑器组件
- `ui/src/components/admin/AgentConfigPreview.tsx` — Markdown 预览（简化）
- `ui/tests/chat/agent-config-store.test.ts` — store 单元测试

**修改**：
- `ui/src/lib/chat/prompt.ts` — 加 `customInstructions` 形参，插到通用规则前
- `ui/src/app/api/chat/route.ts` — 从 store 读 maxTokens/temperature/depth 等
- `ui/src/lib/chat/token-tracker.ts` — SOFT_LIMIT / HARD_LIMIT 改可注入（不暴露 admin 配置）
- `ui/src/lib/chat/mcp-bridge.ts` — `callMcpWithRetry` 的 maxAttempts 改可注入
- `ui/src/app/u/layout.tsx` — 加 admin 入口链接（仅 admin 可见）
- `ui/src/app/u/dashboard/page.tsx` 或 navigation — 显示 /u/admin 入口

## 5. 数据模型

### 5.1 运行时配置（in-memory）

```ts
// ui/src/lib/chat/agent-config-store.ts
export interface AgentConfig {
  agentMd: string;        // 整个 agent.md 内容
  params: {
    maxTokens: number;            // Anthropic max_tokens, default 4096
    temperature: number;          // 0-1, default 0.3
    topP?: number;                // 可选, default undefined
    maxToolChainDepth: number;    // default 10
    rateLimitMaxPerMinute: number; // default 10
    tokenSoftLimit: number;       // default 80000
    tokenHardLimit: number;       // default 200000
    mcpRetryMaxAttempts: number;  // default 2
  };
}
```

### 5.2 持久化

- `ui/src/lib/chat/agent.md`（git 跟踪，存 agentMd 字符串）
- 调试参数**不**持久化在文件里（仅 in-memory）。这样 dev 重启后回到默认值。
  - 如果想持久化 → 可选加 `ui/src/lib/chat/agent-config.json` 写到仓库 .gitignore

## 6. 默认值（admin 没改时）

| 参数 | 默认 | 范围 | 备注 |
|---|---|---|---|
| `maxTokens` | 4096 | 256-16384 | Anthropic 限制 |
| `temperature` | 0.3 | 0-1 | 0=精确, 1=发散 |
| `topP` | (不设) | 0-1 | 留空 = 用默认 |
| `maxToolChainDepth` | 10 | 1-20 | 防止无限循环 |
| `rateLimitMaxPerMinute` | 10 | 1-100 | |
| `tokenSoftLimit` | 80000 | 10000-200000 | |
| `tokenHardLimit` | 200000 | 50000-500000 | 必须 > soft |
| `mcpRetryMaxAttempts` | 2 | 1-5 | |

## 7. UI 设计

### 7.1 路由 `/u/admin/agent-config`

- 顶部：标题"Agent 配置 (Admin)" + 状态条（"已修改未保存" / "已保存 - 热生效"）
- 三段：
  1. **agent.md 编辑器**：textarea（高度 400px，等宽字体）+ 实时字数统计
  2. **调试参数**：7 个数值输入框 + 滑块（混合）
  3. **预览**：折叠面板显示当前拼出的 system prompt 前 2000 字符
- 底部：保存 / 重置默认 / 取消

### 7.2 鉴权

- 整个 `/u/admin/*` 在 `app/u/admin/layout.tsx` 检查 `user.role === 'admin'`
- 否则返 403

### 7.3 主导航入口

- 在 `/u` 顶栏加一个齿轮图标（仅 admin 可见）→ 跳到 `/u/admin/agent-config`

## 8. 错误处理

| 失败模式 | 处理 |
|---|---|
| 写 agent.md 失败（权限、磁盘满） | 500 + 不更新 in-memory store |
| 参数越界（如 maxTokens=100000）| 400 + 表单红框 |
| Admin 改的 agent.md 让所有 system prompt 拼接崩溃（罕见）| 兜底：catch error，日志写入 server log，但不影响其他请求 |
| 内存 store 未初始化 | 自动 fallback 到 prompt.ts 默认值 |

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Admin 改坏 agent.md 影响所有用户 | 提供 "重置" 按钮 + 仓库 git history 可回滚 |
| 调试参数调坏（如 maxTokens=1）| 范围限制 + 0/负数拒绝 |
| agent.md 内容是 prompt injection | system prompt 已被其他防御（FORBIDDEN、BANK_RULE）保护；agent.md 追加到 general rules 之上，让 Claude "先看用户指令、再看硬规则"。Claude Opus 通常不会被 agent.md 中的内容覆盖硬规则。 |
| In-memory store 在多 server 实例下不同步 | 一期单实例（VPS）。多实例时需 Redis 或文件锁。**不在范围** |
| Admin 写文件 race condition | 一期单进程 + next.js dev server 单 worker。可接受 |

## 10. 测试

### 10.1 单元测试

- `agent-config-store.test.ts`：
  - 初始默认值正确
  - `setAgentMd()` 更新 in-memory
  - `setParam()` 单字段更新
  - `reset()` 回退到默认
  - `get()` 返回当前快照

- `prompt.test.ts` 扩展：
  - `buildSystemPrompt(ctx, tools, { customInstructions: 'foo' })` 输出含 "Custom Instructions: foo"
  - compact 模式下 customInstructions 仍然保留（因为是核心段）

- `route.ts` 不写单测（已通过 e2e/live 覆盖）

### 10.2 手动验收

1. 登录 admin → 进入 `/u/admin/agent-config`
2. 改 agent.md 加一行 "在所有回答末尾说 `✅`" → 保存 → 在 chat 里问任意问题 → 末尾含 ✅
3. 把 maxTokens 改到 1024 → 保存 → chat 里问长问题 → 提前被截断
4. 把 temperature 改到 1.0 → 同样问题 → 回答更"散"
5. 点"重置默认"→ 参数回到默认 → 再次 chat → 行为恢复

## 11. 验收目标

- 单元测试 + 4 = 39 全过
- `tsc --noEmit` 0 新错误
- `next build` 成功
- Live: admin 改 agent.md 后 下一个请求就生效
- Live: 普通 employee 进 /u/admin/agent-config 返 403
- 调试参数修改立即反映在 chat 行为
