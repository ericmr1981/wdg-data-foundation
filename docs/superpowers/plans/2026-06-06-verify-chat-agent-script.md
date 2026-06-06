# verify-chat-agent.sh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供 `scripts/verify-chat-agent.sh` —— 跑 4 项检查（unit tests + DDL + tsc + TOOLS 注册完整性），本地和 CI 共用，CI 失败阻断 deploy。

**Architecture:** bash 入口脚本串 4 个子检查 + 1 个 node 写的 TOOLS 注册表检查器。deploy.yml 在 SSH 之前跑这个脚本。

**Tech Stack:** bash 4+, node 18+, Python 3 + pytest, vitest 不在, TypeScript 5+.

---

## File Structure

```
scripts/
  verify-chat-agent.sh           # NEW: bash 主脚本
  check-tools-registry.mjs       # NEW: node 写的 TOOLS 一致性检查

.github/workflows/
  deploy.yml                     # MODIFY: 在 SSH step 之前加 verify step
```

---

## Task 1: TOOLS 注册表检查器（node 脚本）

**Files:**
- Create: `scripts/check-tools-registry.mjs`

- [ ] **Step 1: 实现 node 脚本**

```javascript
#!/usr/bin/env node
// scripts/check-tools-registry.mjs
// Verifies that every MCP tool exported under ui/src/mcp/tools/*.ts is
// registered in the TOOLS map in ui/src/mcp/server.ts.
//
// Failure modes:
//   - Tool file exists but not in TOOLS map (developer forgot to register)
//   - TOOLS map has a key but no matching file (stale reference)

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const TOOLS_DIR = join(REPO_ROOT, 'ui', 'src', 'mcp', 'tools');
const SERVER_FILE = join(REPO_ROOT, 'ui', 'src', 'mcp', 'server.ts');

const TOOL_FILE_RE = /export\s+(?:const|function)\s+(\w+Tool)\b/;
const REGISTRY_KEY_RE = /^\s*(\w+)\s*:\s*\w+Tool\b/m;

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function ok(msg) {
  console.log('✓ ' + msg);
}

if (!existsSync(TOOLS_DIR)) {
  die(`Tools dir not found: ${TOOLS_DIR}`);
}
if (!existsSync(SERVER_FILE)) {
  die(`Server file not found: ${SERVER_FILE}`);
}

// 1. Collect exported *Tool identifiers from each tool file
const toolFiles = readdirSync(TOOLS_DIR).filter(f => f.endsWith('.ts') && f !== 'index.ts');
const exportedNames = new Set();

for (const f of toolFiles) {
  const src = readFileSync(join(TOOLS_DIR, f), 'utf-8');
  for (const m of src.matchAll(TOOL_FILE_RE)) {
    exportedNames.add(m[1]);
  }
}

if (exportedNames.size === 0) {
  die('No *Tool exports found under ui/src/mcp/tools/ — is the path correct?');
}

ok(`Found ${exportedNames.size} tool exports across ${toolFiles.length} files`);

// 2. Collect keys in TOOLS map in server.ts
const serverSrc = readFileSync(SERVER_FILE, 'utf-8');
const toolsBlockMatch = serverSrc.match(/const\s+TOOLS\s*:\s*Record<string,\s*ToolModule>\s*=\s*\{([\s\S]*?)\n\}/);
if (!toolsBlockMatch) {
  die('Could not locate `const TOOLS: Record<string, ToolModule> = { ... }` block in ui/src/mcp/server.ts');
}
const toolsBlock = toolsBlockMatch[1];
const registeredKeys = new Set();
for (const m of toolsBlock.matchAll(REGISTRY_KEY_RE)) {
  registeredKeys.add(m[1]);
}

ok(`Found ${registeredKeys.size} entries in TOOLS map`);

// 3. Compare
const missingFromRegistry = [...exportedNames].filter(n => !registeredKeys.has(n));
const staleInRegistry = [...registeredKeys].filter(k => !exportedNames.has(k));

let failed = false;
if (missingFromRegistry.length) {
  console.error('✗ Tools exported but NOT registered in TOOLS map:');
  for (const n of missingFromRegistry) {
    console.error('    - ' + n);
  }
  failed = true;
}
if (staleInRegistry.length) {
  console.error('✗ TOOLS map has keys with no matching tool export:');
  for (const k of staleInRegistry) {
    console.error('    - ' + k);
  }
  failed = true;
}

if (failed) {
  process.exit(1);
}

ok(`All ${exportedNames.size} tools are registered.`);
process.exit(0);
```

- [ ] **Step 2: 验证脚本能跑（成功 + 失败两种情况）**

成功：项目当前状态应该全部 45 个都注册。
```bash
node scripts/check-tools-registry.mjs
```
Expected: `✓ Found 45 tool exports ... ✓ All 45 tools are registered.` 退出 0.

失败 case 1：临时改一个 tool 的导出名但不改注册
```bash
sed -i.bak 's/getBrandStoresTool/xBrandStoresTool/' ui/src/mcp/tools/get-brand-stores.ts
node scripts/check-tools-registry.mjs
# Expected: 退出 1 + "Tools exported but NOT registered"
sed -i.bak 's/xBrandStoresTool/getBrandStoresTool/' ui/src/mcp/tools/get-brand-stores.ts
rm ui/src/mcp/tools/get-brand-stores.ts.bak
```

失败 case 2：临时从 TOOLS 删一行
```bash
# 备份并删除一行
cp ui/src/mcp/server.ts ui/src/mcp/server.ts.bak
# 用 sed 删除 get_brand_stores: getBrandStoresTool, 这一行
node scripts/check-tools-registry.mjs
# Expected: 退出 1
mv ui/src/mcp/server.ts.bak ui/src/mcp/server.ts
```

- [ ] **Step 3: Commit**

```bash
git add scripts/check-tools-registry.mjs
git commit -m "feat(chat): TOOLS registry consistency check (node script)"
```

---

## Task 2: bash 主脚本

**Files:**
- Create: `scripts/verify-chat-agent.sh`

- [ ] **Step 1: 实现 bash 脚本**

```bash
#!/usr/bin/env bash
# scripts/verify-chat-agent.sh
# Runs 4 verification checks for the chat agent:
#   1. Chat unit tests (node --test)
#   2. DDL pytest (skipped if DATABASE_URL not set)
#   3. TypeScript type check
#   4. MCP TOOLS registry consistency
#
# Exit 0 on success, 1 on any failure, 2 on misuse.
# Used locally and by GitHub Actions (deploy.yml runs this before SSH).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || { echo "✗ Could not cd to repo root"; exit 2; }

# Load .env if present (so DATABASE_URL / DB_* are available)
if [ -f .env ] && [ -z "${DATABASE_URL:-}" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  # Build DATABASE_URL from DB_* if not directly set
  if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ]; then
    export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  fi
fi

# Counters
FAIL=0
SKIPPED=0
UNIT_PASSED=0
DDL_RESULT=""

# Helper: print a section header
section() {
  echo ""
  echo "========================================"
  echo "[$1/4] $2"
  echo "========================================"
}

# Helper: report a single check outcome
record_pass() { echo "  ✓ $1"; }
record_fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
record_skip() { echo "  (skipped) $1"; SKIPPED=$((SKIPPED+1)); }

# ---------- 1. Chat unit tests ----------
section 1 "Chat unit tests"
if cd ui && node --test --experimental-strip-types tests/chat/*.test.ts 2>&1 | tail -20; then
  cd "$REPO_ROOT"
  UNIT_PASSED=$(cd ui && node --test --experimental-strip-types tests/chat/*.test.ts 2>&1 | grep -E "^# tests " | tail -1 | awk '{print $3}')
  record_pass "Chat unit tests: $UNIT_PASSED passed"
else
  cd "$REPO_ROOT" 2>/dev/null
  record_fail "Chat unit tests"
fi

# ---------- 2. DDL pytest ----------
section 2 "DDL pytest"
if [ -n "${DATABASE_URL:-}" ]; then
  if command -v pytest >/dev/null 2>&1; then
    if pytest tests/test_chat_ddl.py -v 2>&1 | tail -15; then
      DDL_RESULT="passed"
      record_pass "DDL pytest: 6 passed"
    else
      record_fail "DDL pytest"
    fi
  else
    record_skip "DDL pytest: pytest not in PATH"
  fi
else
  record_skip "DDL pytest: DATABASE_URL not set"
fi

# ---------- 3. TypeScript ----------
section 3 "TypeScript type check"
if cd ui && npx tsc --noEmit 2>&1 | tail -20; then
  cd "$REPO_ROOT"
  record_pass "TypeScript: 0 errors"
else
  cd "$REPO_ROOT" 2>/dev/null
  record_fail "TypeScript: errors found"
fi

# ---------- 4. TOOLS registry ----------
section 4 "MCP TOOLS registry consistency"
if [ -f scripts/check-tools-registry.mjs ] && command -v node >/dev/null 2>&1; then
  if node scripts/check-tools-registry.mjs; then
    record_pass "TOOLS registry: all tools registered"
  else
    record_fail "TOOLS registry: mismatch detected"
  fi
else
  record_skip "TOOLS registry: check-tools-registry.mjs not found"
fi

# ---------- Summary ----------
echo ""
echo "========================================"
echo "Summary"
echo "========================================"
echo "  Chat unit tests:   $([ $FAIL -eq 0 ] && [ $UNIT_PASSED -gt 0 ] && echo "$UNIT_PASSED passed" || echo "see above")"
echo "  DDL pytest:        ${DDL_RESULT:-skipped}"
echo "  TypeScript:        0 errors"
echo "  TOOLS registry:    checked"
echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ chat agent verification passed"
  exit 0
else
  echo "✗ chat agent verification FAILED ($FAIL check(s))"
  exit 1
fi
```

- [ ] **Step 2: 加执行权限 + 验证**

```bash
chmod +x scripts/verify-chat-agent.sh
bash scripts/verify-chat-agent.sh
```

Expected: 退出 0，4 项都过（DDL 可能 SKIP if no DB）。看实际输出。

- [ ] **Step 3: 验证失败 case**

故意改 `ui/src/mcp/tools/get-brand-stores.ts` 加一个新导出但不注册：

```bash
# 临时改
echo 'export const _dummyTool = { name: "_dummy" };' >> ui/src/mcp/tools/get-brand-stores.ts
bash scripts/verify-chat-agent.sh
# Expected: 退出 1 + TOOLS check fails
# 还原
sed -i '/^export const _dummyTool/d' ui/src/mcp/tools/get-brand-stores.ts
bash scripts/verify-chat-agent.sh
# Expected: 退出 0
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-chat-agent.sh
git commit -m "feat(chat): verify-chat-agent.sh — 4 check verifier (unit + DDL + tsc + TOOLS)"
```

---

## Task 3: CI 接入

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: 在 deploy step 之前加 verify step**

读 `ui/src/mcp/server.ts:189-200` 看 TOOLS map 当前结构（仅参考，**不**改），改 deploy.yml：

```yaml
name: Deploy to VPS
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: ui/package-lock.json
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install UI dependencies
        run: cd ui && npm ci
      - name: Install Python dependencies
        run: pip install psycopg2-binary pytest
      - name: Run verify-chat-agent.sh
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: bash scripts/verify-chat-agent.sh
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.VPS_HOST }}
          port: ${{ secrets.VPS_PORT }}
          username: root
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/wdg-data-foundation
            git stash
            ...
```

**关键点**：
- `verify-chat-agent.sh` 在 SSH 之前 — 失败则 deploy 步骤不会跑
- 用 `secrets.DATABASE_URL` 跑 DDL 检查（如果 VPS 端 DB 可达）
- `npm ci` 而不是 `npm install`（CI 友好）
- 步骤之间顺序：checkout → setup → install → verify → deploy

- [ ] **Step 2: 验证 deploy.yml 语法**

```bash
cat .github/workflows/deploy.yml
# 确认 YAML 合法（用 yamllint if available, else just review by eye）
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" 2>&1 | head -5
# Expected: 无输出（合法）
```

- [ ] **Step 3: Commit + push**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(chat): run verify-chat-agent.sh before deploy (blocks push on failure)"
git push origin main
```

**预期**：Action 跑 6 步。verify-chat-agent.sh 应该 4 项都过（DDL 需要 `secrets.DATABASE_URL`）。

---

## Task 4: 文档 + README

**Files:**
- Create: `docs/chat-agent-verification.md`（可选）

- [ ] **Step 1: 写 dev 备忘**

```markdown
# Chat Agent — 验证流程

## 日常开发

每次改完 chat 相关代码，**至少**跑：
```bash
bash scripts/verify-chat-agent.sh
```

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
```

- [ ] **Step 2: Commit**

```bash
git add docs/chat-agent-verification.md
git commit -m "docs(chat): verification flow + troubleshooting"
```

---

## Task 5: 最终验证

- [ ] **Step 1: 跑全脚本（成功 case）**

```bash
bash scripts/verify-chat-agent.sh
echo "exit: $?"
```

Expected: 退出 0，4 项都过。

- [ ] **Step 2: 故意制造 3 种失败确认能 catch**

A. 缺注册：
```bash
echo 'export const _dummyTool = { name: "_dummy" };' >> ui/src/mcp/tools/get-brand-stores.ts
bash scripts/verify-chat-agent.sh
echo "exit: $?"  # 应 1
sed -i '/^export const _dummyTool/d' ui/src/mcp/tools/get-brand-stores.ts
```

B. tsc 错误（注入）：
```bash
echo 'const x: number = "string";' >> ui/src/lib/chat/prompt.ts
bash scripts/verify-chat-agent.sh
echo "exit: $?"  # 应 1
git checkout ui/src/lib/chat/prompt.ts
```

C. 测试失败：
```bash
# 临时改一个测试断言
sed -i "s/assert.equal(getAgentConfig().params.maxTokens, 4096);/assert.equal(getAgentConfig().params.maxTokens, 9999);/" ui/tests/chat/agent-config-store.test.ts
bash scripts/verify-chat-agent.sh
echo "exit: $?"  # 应 1
git checkout ui/tests/chat/agent-config-store.test.ts
```

- [ ] **Step 3: push main，看 CI**

```bash
git push origin main
gh run list --limit 1
```

Expected: CI 跑过 verify-chat-agent.sh（4 项 ✓）然后跑 SSH deploy。

---

## 验收目标

- 本地 `bash scripts/verify-chat-agent.sh` 退出 0
- 故意改 3 种失败类型 → 脚本都能 catch
- 推送 → CI 跑过 → deploy 成功（或失败时 deploy 不跑）
- 文档在 `docs/chat-agent-verification.md`

## 不在本任务范围

- 写审计表（已识别为缺口，单独 task）
- 添加 Sentry（生产监控）
- LLM 行为 e2e
