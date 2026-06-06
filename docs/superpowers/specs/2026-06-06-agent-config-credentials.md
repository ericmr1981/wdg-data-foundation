# Agent Config 增强: URL / API Key / Model 可编辑

## 1. 概述

扩展现有的 `/u/admin/agent-config` 页面，让 admin 能在 Web 上**编辑 Anthropic API 的 base URL、API key、模型名**三个 env 配置。当前这三项只能改 `.env.local` 后重启，现在通过管理页面 + DB 加密存储实现**热生效**。

## 2. 范围

### 包含
- **DDL 新增表** `ops.chat_agent_credentials`：1 行 1 config（id=1），含 base_url、encrypted_api_key、model
- **加密模块** `ui/src/lib/chat/secret-crypto.ts`：AES-256-GCM 加解密（key 从 `AGENT_CRED_ENCRYPTION_KEY` 环境变量派生；IV 每次随机 12 字节；附在密文前）
- **agent-config-store 扩展**：增加 3 个 setter / getter
- **API 端点扩展** `GET/POST /api/admin/agent-config`：现在处理 4 块数据 — agentMd + params + baseURL + encryptedApiKey + model；返回时把 apiKey **mask**（只显示前 4 + 后 4 字符）防止日志泄露
- **Admin UI 扩展**：在现有 `AgentConfigEditor` 加 3 个字段（baseURL、API key、model），API key 用密码框 + 显隐切换
- **route.ts 集成**：从 `getAgentConfig()` 读 `baseURL`、`apiKey`、`model` 替代 `process.env.ANTHROPIC_*` 三个 env
- **环境变量兼容**：env 仍是 fallback（首次启动没 DB config 时用 env）

### 不包含
- 多 agent profile 切换（不做）
- 跨多个代理选择（不做）
- API key 在 DB 之外的存储（仅 DB + env fallback）
- 加密 key 轮换（手动；不在范围）
- 写审计表（仍识别为缺口，单独 task）

## 3. 架构

```
Browser /u/admin/agent-config
  │
  ├─ GET /api/admin/agent-config
  │   → { agentMd, params, baseURL, apiKeyMasked, model, defaultParams }
  │
  └─ POST /api/admin/agent-config
       → { baseURL?, apiKey?, model?, agentMd?, params? }
       │
       ├─ 写 ops.chat_agent_credentials（API key AES 加密后存）
       ├─ 更新 agent-config-store 内存
       └─ applyConfigToGlobals()

/api/chat 下个请求:
  route.ts:
    const cfg = getAgentConfig();
    const apiKey = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
    const baseURL = cfg.baseURL || process.env.ANTHROPIC_BASE_URL;
    const model = cfg.model || 'claude-opus-4-8';
    const client = new Anthropic({ apiKey, baseURL });
    // 调 messages.create({ model, ... })
```

## 4. 文件清单

**新增**：
- `sql/00_chat_agent_credentials_ddl.sql` — 新表 DDL
- `ui/src/lib/chat/secret-crypto.ts` — AES 加解密
- `ui/tests/chat/secret-crypto.test.ts` — 加密测试（round-trip、错误 key 失败）

**修改**：
- `ui/src/lib/chat/agent-config-store.ts` — 加 baseURL/apiKey/model + 加密 set 时存 DB
- `ui/src/app/api/admin/agent-config/route.ts` — 处理 3 个新字段
- `ui/src/app/api/chat/route.ts` — 从 store 读 baseURL/apiKey/model
- `ui/src/components/admin/AgentConfigEditor.tsx` — 加 3 个 UI 字段（含密码框 + 显隐）
- `ui/src/app/u/admin/agent-config/ClientAgentConfig.tsx` — 改 onSave 多传 3 字段
- `ui/.env.example` — 加 `AGENT_CRED_ENCRYPTION_KEY` 示例
- `ui/tests/chat/agent-config-store.test.ts` — 加 3 个新测试

## 5. 数据模型

### 5.1 DDL

```sql
-- sql/00_chat_agent_credentials_ddl.sql
-- One row, holds the optional override of the Anthropic API config.
-- If this row exists, it overrides process.env.ANTHROPIC_*. If absent, env is used.

CREATE TABLE IF NOT EXISTS ops.chat_agent_credentials (
  id                  INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_url            TEXT,                                  -- nullable: if NULL, env ANTHROPIC_BASE_URL is used
  encrypted_api_key   TEXT,                                  -- AES-256-GCM ciphertext, base64; nullable
  model               TEXT        NOT NULL DEFAULT 'claude-opus-4-8',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          TEXT                                   -- user_id of admin who last changed
);

-- Trigger: keep updated_at fresh
CREATE OR REPLACE FUNCTION ops.touch_chat_agent_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_agent_credentials_updated_at ON ops.chat_agent_credentials;
CREATE TRIGGER trg_chat_agent_credentials_updated_at
  BEFORE UPDATE ON ops.chat_agent_credentials
  FOR EACH ROW
  EXECUTE FUNCTION ops.touch_chat_agent_credentials_updated_at();

INSERT INTO ops.chat_agent_credentials (id, model)
  VALUES (1, 'claude-opus-4-8')
  ON CONFLICT (id) DO NOTHING;
```

### 5.2 加密格式

```
ciphertext = base64( IV(12B) || authTag(16B) || encrypted(plaintext) )

key = SHA-256(AGENT_CRED_ENCRYPTION_KEY)  // 32 bytes
algo = 'aes-256-gcm'
```

**为什么 GCM？** 同时提供 confidentiality + authentication；authTag 在解密时验证密文不被篡改。

### 5.3 agent-config-store 新增

```ts
export interface AgentConfig {
  agentMd: string;
  params: AgentConfigParams;
  baseURL: string | null;       // null = use env ANTHROPIC_BASE_URL
  apiKey: string | null;         // null = use env ANTHROPIC_API_KEY
  model: string;                  // default 'claude-opus-4-8'
}

export function getBaseURL(): string | null;     // returns store value, NOT env
export function getApiKey(): string | null;
export function getModel(): string;
export function setCredentialConfig(baseURL, apiKey, model): void;
```

`getAgentConfig()` 返回所有 4 块数据。

### 5.4 启动时加载

agent-config-store 启动时（首次 module load）：
1. 查 `ops.chat_agent_credentials` 是否有 row
2. 如果有：解密 apiKey → 存到内存 store
3. 如果没有：保持 null（fallback to env）

启动时 DB 不可达怎么办：fallback to null → route.ts fallback to env。

## 6. UI 设计

### 6.1 现有 AgentConfigEditor 加 3 字段

在"调试参数"section 之后、按钮之前加新 section **"API 配置"**：

```
[API 配置]
  Base URL
  [_________________] (placeholder: https://your-proxy.example.com)
  留空 = 用 .env 的 ANTHROPIC_BASE_URL

  API Key  [👁]
  [••••••••••••••••••] (placeholder: sk-ant-...)
  点眼睛切换明文。留空 = 保留原值（不修改）。要清除需手动设为空字符串。

  Model
  [claude-opus-4-8          ] (default)
```

**密码框 + 显隐切换**：
- `type=password` 默认
- 旁边一个"👁"按钮 toggle `type=password/text`
- placeholder 提示"留空保留原值"

### 6.2 GET 返回时 mask API key

```ts
function maskKey(k: string | null): string | null {
  if (!k) return null;
  if (k.length <= 8) return '***';
  return k.slice(0, 4) + '***' + k.slice(-4);
}
```

UI 显示 `sk-***1234` 形式。保存时如果留空就**保留**当前 key（不覆盖）。

### 6.3 POST 接受部分更新

```ts
// 区分"未传" vs "传了空字符串"
// 未传: 不改该字段
// 传了空字符串: 清除该字段（清 DB）
```

实现：
```ts
if (body.apiKey === '') setApiKey(null);            // 清除
else if (body.apiKey) setApiKey(body.apiKey);       // 设置
// else body.apiKey === undefined → 不动
```

## 7. 错误处理

| 失败模式 | 处理 |
|---|---|
| `AGENT_CRED_ENCRYPTION_KEY` 未设 | 启动时抛错 "encryption key required" → fail-fast（不静默错） |
| 加密 key 长度 < 16 字符 | 抛错 "key too short" |
| DB 不可达 | store 启动时 catch → 退到 null（route.ts fallback env） |
| POST 写 DB 失败 | 500 + 不更新内存（一致性） |
| 解密失败（key 改了/数据损坏） | 抛错 + 启动时用空 store（fail-open 让其他功能工作） |
| UI 输入 baseURL 但格式错 | 不强制 URL 校验（Anthropic SDK 调时自报 401） |

## 8. 安全

- API key **绝不**进 git、log、SSE 事件
- API key **绝不**显示在 GET 响应（用 mask）
- API key **绝不**写错误日志（catch 时只打 "decrypt failed"）
- 加密 key 在 .env.example **必须** 32 字符以上 + 注释警告
- 启动时打日志说 "API key from DB" 或 "API key from env" 但**不打** key 内容

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| AGENT_CRED_ENCRYPTION_KEY 丢 → DB 里的密文变砖 | 文档警告 + 启动时 fail-fast；不静默用默认 key |
| 改了加密 key → 旧密文解不出 | 解密失败时启动用空 store（不会 crash，但 chat 不可用直到 key 还原） |
| UI 把 API key 误存到日志 | 严格：所有日志只记 "key present" / "key set" / "key from db" |
| 第一次部署没设加密 key | env.example 标 ⚠️ 必填；CI 启动时如果 DB 存在而 key 没设 → 报错 |
| 多实例部署需要共享加密 key | 文档强调：加密 key 必须在所有实例一致 |

## 10. 测试

### 10.1 单元测试

- `secret-crypto.test.ts`：
  - 加密 + 解密 round-trip
  - 错误 key 抛出
  - 短 key 抛出
  - 空字符串 round-trip
  - 长字符串 round-trip（> 4KB）

- `agent-config-store.test.ts`：加 3 个测试
  - 默认 baseURL/apiKey 是 null
  - setCredentialConfig 后能读
  - 多个 setter 调用更新内存

### 10.2 Live 验证

1. admin 进 `/u/admin/agent-config` → 看到 3 个新字段
2. 改 baseURL 为 `http://localhost:4100`、API key 留空、model `claude-sonnet-4-6` → 保存
3. 跳到 chat → 问问题 → 看到 model 在日志里变了
4. 故意把加密 key 删了 → 重启 → 看 fail-fast 行为
5. 把 apiKey 在 UI 改成 "sk-test-1234567890" → 保存 → 在 DB 里查 ops.chat_agent_credentials.encrypted_api_key → 是密文

## 11. 验收

- 35 + 5 + 5 + 5 = 50 单元测试全过
- DDL 新增 1 个测试（chat_agent_credentials 表存在 + 默认 row）
- tsc 0 新错误
- next build 成功
- Live: admin 改 baseURL/model/apiKey 后下个 chat 请求生效
- Live: API key 在 GET 响应里被 mask
- Live: agent_config 加密存的，DB 里看到的不是明文
