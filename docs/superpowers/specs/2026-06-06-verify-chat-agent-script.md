# verify-chat-agent.sh — 自动化保障脚本设计

## 1. 概述

为 WDG chat agent 模块建立"单一来源"的本地/CI 共用验证脚本 `scripts/verify-chat-agent.sh`，覆盖单元测试、类型检查、构建、TOOLS 注册表一致性。任何 push to main 都会自动跑这个脚本，dev 本地也能直接调。

**核心目标**：未来任何设备 clone 仓库后，跑这条命令就能确认"chat agent 逻辑"未破。无需记任何额外步骤。

## 2. 范围

### 包含（4 项检查）
1. **Chat 单元测试**：`cd ui && node --test --experimental-strip-types tests/chat/*.test.ts`
2. **DDL pytest**：`pytest tests/test_chat_ddl.py`（DB 不可达时 SKIP，不算失败）
3. **TypeScript 类型**：`cd ui && npx tsc --noEmit`
4. **TOOLS 注册表一致性**：扫 `ui/src/mcp/tools/*.ts` 的 `*Tool` 导出 vs `ui/src/mcp/server.ts:TOOLS` map，缺一即错

### 不包含（一期 YAGNI）
- LLM 行为 e2e 测试（需真实 Anthropic API 调用 + 高成本 + 不稳定）
- 写审计表（已识别为缺口，但不属于"验证脚本"范畴 — 单独 task）
- Sentry / 监控接入（不是测试范畴）
- 暗色模式 / 国际化 / 性能基准

## 3. 架构

```
scripts/verify-chat-agent.sh   ← 入口（bash）
  │
  ├─ ① source .env 拿 DB vars（不存在就 skip DDL）
  │
  ├─ ② cd ui && node --test --experimental-strip-types tests/chat/*.test.ts
  │     └─ 失败 → exit 1
  │
  ├─ ③ pytest tests/test_chat_ddl.py（if DATABASE_URL set）
  │     └─ 失败 → exit 1（但 skip 不算失败）
  │
  ├─ ④ cd ui && npx tsc --noEmit
  │     └─ 失败 → exit 1
  │
  ├─ ⑤ node scripts/check-tools-registry.mjs
  │     └─ 失败 → exit 1
  │
  └─ ⑥ 全部过 → "✅ chat agent verification passed"

CI 接入 (.github/workflows/deploy.yml):
  - 在 "Deploy via SSH" 之前加一个 step:
      - name: Run verify-chat-agent.sh
        run: bash scripts/verify-chat-agent.sh
  - 失败 → Action 标红 → 不 deploy
```

## 4. 文件清单

**新增**：
- `scripts/verify-chat-agent.sh` — 主脚本（bash）
- `scripts/check-tools-registry.mjs` — TOOLS 一致性检查（node + TS source loader）

**修改**：
- `.github/workflows/deploy.yml` — 加 verify step 在 deploy step 之前

## 5. 关键设计决策

### 5.1 脚本目录在哪？

- `scripts/verify-chat-agent.sh` — 仓库根（与 `scripts/run_pipeline_oneclick.py` 等并列）
- `scripts/check-tools-registry.mjs` — 同目录

**不用** `ui/scripts/` —— 脚本跨 ui 和 db 两边的事，放根目录一致。

### 5.2 退出码策略

| 退出码 | 含义 |
|---|---|
| 0 | 全部通过 |
| 1 | 至少一个检查失败 |
| 2 | 调用方式错（参数错、缺依赖） |

### 5.3 输出风格

每个 check 之前打印：
```
========================================
[1/4] Chat unit tests
========================================
```

最后总结：
```
========================================
Summary:
  [✓] Chat unit tests:    43 passed
  [✓] DDL pytest:          6 passed (or 6 skipped)
  [✓] TypeScript:          0 errors
  [✓] TOOLS registry:      45/45 registered
========================================
✅ chat agent verification passed
========================================
```

失败时：
```
[✗] Chat unit tests:    2 failed
```

### 5.4 TOOLS 检查实现

**入口**：`scripts/check-tools-registry.mjs`（node 跑）

**算法**：
1. 扫 `ui/src/mcp/tools/*.ts`（跳过 `index.ts`）
2. 提取每个文件的 `export const xxxTool` 或 `export { xxxTool }`（正则）
3. 提取 `ui/src/mcp/server.ts` 中 `TOOLS` map 的 keys（正则）
4. 比较两个集合：
   - 文件中导出但未在 TOOLS map → 缺注册 → 失败
   - TOOLS map 中有但文件没导出 → 死引用 → 失败

**实现**：
- 用 node + 内置 fs.readdirSync + 正则
- 简单 50-80 行 mjs
- 不引入 TypeScript 编译器（避免再装 tsx/ts-node）

**局限**：用正则解析 TypeScript 是脆的。简化策略：
- 只支持"export const xxxTool"和"export { xxxTool }"两种形式
- 报错信息清晰指向文件名 + 变量名

**生产准确性**：当前项目所有 tool 都用 `export const xxxTool` 形式（已在 server.ts import 看到），正则足够。

### 5.5 数据库可选

`pytest tests/test_chat_ddl.py` 需要 `DATABASE_URL`。
- 本地开发：通常从 `.env` 拿
- CI 容器：可能没有
- 脚本行为：找不到 DATABASE_URL → SKIP pytest → 警告但不算失败

实现：
```bash
if [ -n "$DATABASE_URL" ]; then
  pytest tests/test_chat_ddl.py -v
else
  echo "  (skipped: DATABASE_URL not set)"
fi
```

### 5.6 工具链版本无关

脚本应**不**绑定 Node/Python/pytest 的具体版本（用 shebang + PATH 里的版本）。这样 dev 升级 Node 不破脚本。

`#!/usr/bin/env bash` 和 `python3`（不 `python`）保证兼容性。

## 6. 错误处理

| 失败模式 | 处理 |
|---|---|
| Node 不在 PATH | 脚本 exit 2 + 提示 "Node.js not found" |
| pytest 不在 PATH | SKIP DDL（不阻断）+ warn "pip install pytest" |
| 找不到 tsconfig | 失败 + 提示 "run from repo root" |
| 找不到 ui/src/mcp/tools/ | 失败 + 提示 "run from repo root" |
| TOOLS 正则不匹配 | 失败 + 列出未注册的 + 提示查看 server.ts |
| 测试运行超时 | 5 分钟上限（CI 默认 6 小时 但我们设紧些） |

## 7. 测试

### 7.1 单元测试

- 脚本本身的测试难（bash 行为需 e2e）
- 但 TOOLS 检查 node 脚本可以测：
  - `scripts/check-tools-registry.test.mjs`（用 node --test）
  - 准备一个 fixture 目录（mock tools/ + server.ts）验证各种 mismatch 情况

**但**：bash 脚本部分靠手动跑 + CI 验证。本期不强求单测 bash。

### 7.2 Live / CI 验证

1. dev 本地：`bash scripts/verify-chat-agent.sh` → 应 exit 0
2. dev 故意改 `tools/foo.ts` 加新 tool 但不注册 → `bash scripts/verify-chat-agent.sh` → 应 exit 1
3. dev 故意改 `TOOLS` map 删一行 → 同样 exit 1
4. push to main → Action 跑过这个 step → 失败时 deploy 不跑

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| TOOLS 正则对复杂 export 形式失效 | 限制支持形式 + 报错清晰；后续若需可换 ts-morph 之类 |
| 脚本在 dev 本地就报错（让人恼火） | 只检查"会真正影响 chat agent 工作"的项（不跑 lint / e2e） |
| CI 失败 dev 不知道为什么 | 失败时 step 打印详细（test 哪几条、tsc 哪行、tools 缺哪个） |
| 脚本忘了 source .env | 显式 grep `if [ -z "$DATABASE_URL" ] && source .env` |

## 9. 验收目标

- `bash scripts/verify-chat-agent.sh` 退出码 0
- 故意把 `ui/src/mcp/tools/get-brand-stores.ts` 里的导出改名 → 脚本 exit 1 + 清晰错误
- 故意从 `TOOLS` map 删一行 → 同样 exit 1
- 故意 `console.log(undefined)` 引入 tsc 错误 → 同样 exit 1
- `pytest tests/test_chat_ddl.py` 单独跑也通过（确认脚本没破坏 pytest 自身）
- push 一个带错误的 commit 到 main → CI Action 标红，deploy step 跳过

## 10. 不在本任务范围

- **写审计表**（已识别为缺口，单独 task）— 那是 `route.ts` 改造，不是测试范畴
- **添加 Sentry**（生产监控）— 不是测试
- **Anthropic API e2e**（LLM 行为断言）— 成本高 + 不稳定
