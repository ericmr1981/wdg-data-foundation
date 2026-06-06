# Agent Config Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 admin 在 `/u/admin/agent-config` 编辑 Anthropic baseURL / API key / model，DB 加密存，热生效。

**Architecture:** DDL 新表 + AES-256-GCM 加密模块 + store 扩展 + route.ts 集成 + UI 三个新字段。

**Tech Stack:** Next.js 14, Node 22 crypto, PostgreSQL.

---

## File Structure

```
sql/
  00_chat_agent_credentials_ddl.sql           # NEW

ui/src/lib/chat/
  secret-crypto.ts                           # NEW: AES-256-GCM
  agent-config-store.ts                      # MODIFY: 加 baseURL/apiKey/model

ui/src/app/api/admin/agent-config/
  route.ts                                   # MODIFY: 处理 3 个新字段 + DB 持久化

ui/src/app/api/chat/
  route.ts                                   # MODIFY: 读 store baseURL/apiKey/model

ui/src/components/admin/
  AgentConfigEditor.tsx                      # MODIFY: 加 3 个 UI 字段

ui/src/app/u/admin/agent-config/
  ClientAgentConfig.tsx                      # MODIFY: 多传 3 字段

ui/tests/chat/
  secret-crypto.test.ts                      # NEW
  agent-config-store.test.ts                 # MODIFY: 加 3 测试

tests/
  test_chat_agent_credentials_ddl.py          # NEW

ui/.env.example                              # MODIFY: 加 AGENT_CRED_ENCRYPTION_KEY
```

---

## Task 1: DDL + pytest

**Files:**
- Create: `sql/00_chat_agent_credentials_ddl.sql`
- Create: `tests/test_chat_agent_credentials_ddl.py`

- [ ] **Step 1: 写 DDL**

```sql
-- sql/00_chat_agent_credentials_ddl.sql
-- One row, holds the optional override of the Anthropic API config.
-- If this row exists, it overrides process.env.ANTHROPIC_*. If absent, env is used.

CREATE TABLE IF NOT EXISTS ops.chat_agent_credentials (
  id                  INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_url            TEXT,
  encrypted_api_key   TEXT,
  model               TEXT        NOT NULL DEFAULT 'claude-opus-4-8',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          TEXT
);

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

- [ ] **Step 2: 写 pytest**

```python
# tests/test_chat_agent_credentials_ddl.py
import os
import psycopg2
import pytest

@pytest.fixture(scope="module")
def db_conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set; skip live DDL test")
    conn = psycopg2.connect(url)
    conn.autocommit = True
    yield conn
    conn.close()

def test_table_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.tables
            WHERE table_schema='ops' AND table_name='chat_agent_credentials'
        """)
        assert cur.fetchone() is not None

def test_default_row_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT model FROM ops.chat_agent_credentials WHERE id = 1")
        row = cur.fetchone()
        assert row is not None
        assert row[0] == "claude-opus-4-8"

def test_columns(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='ops' AND table_name='chat_agent_credentials'
            ORDER BY ordinal_position
        """)
        cols = [r[0] for r in cur.fetchall()]
    assert cols == ['id', 'base_url', 'encrypted_api_key', 'model', 'updated_at', 'updated_by']

def test_primary_key_constraint(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema='ops' AND table_name='chat_agent_credentials'
              AND constraint_type='PRIMARY KEY'
        """)
        assert cur.fetchone() is not None
```

- [ ] **Step 3: 应用 DDL + 跑测试**

```bash
psql "$DATABASE_URL" -f sql/00_chat_agent_credentials_ddl.sql
pytest tests/test_chat_agent_credentials_ddl.py -v
```

Expected: DDL applies, 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add sql/00_chat_agent_credentials_ddl.sql tests/test_chat_agent_credentials_ddl.py
git commit -m "feat(chat): add ops.chat_agent_credentials DDL + 4 tests"
```

---

## Task 2: AES-256-GCM 加密模块 + 测试

**Files:**
- Create: `ui/src/lib/chat/secret-crypto.ts`
- Create: `ui/tests/chat/secret-crypto.test.ts`

- [ ] **Step 1: 写测试**

```ts
// ui/tests/chat/secret-crypto.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { encrypt, decrypt, _getKey, SecretCryptoError } from '../../src/lib/chat/secret-crypto.ts';

const KEY = 'a'.repeat(64);  // 64-char hex-ish; SHA-256 will derive 32 bytes

test('round-trip simple string', () => {
  const ct = encrypt('sk-ant-test-1234', KEY);
  assert.ok(typeof ct === 'string' && ct.length > 0);
  assert.equal(decrypt(ct, KEY), 'sk-ant-test-1234');
});

test('round-trip empty string', () => {
  const ct = encrypt('', KEY);
  assert.equal(decrypt(ct, KEY), '');
});

test('round-trip unicode + long string (>1KB)', () => {
  const long = '中文字符串 ' + 'x'.repeat(2000);
  const ct = encrypt(long, KEY);
  assert.equal(decrypt(ct, KEY), long);
});

test('each encrypt produces different ciphertext (random IV)', () => {
  const a = encrypt('hello', KEY);
  const b = encrypt('hello', KEY);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, KEY), decrypt(b, KEY));
});

test('decrypt with wrong key throws SecretCryptoError', () => {
  const ct = encrypt('secret', KEY);
  assert.throws(() => decrypt(ct, KEY + 'x'), SecretCryptoError);
});

test('decrypt with tampered ciphertext throws', () => {
  const ct = encrypt('secret', KEY);
  // Flip a character in the middle
  const tampered = ct.slice(0, 20) + (ct[20] === 'A' ? 'B' : 'A') + ct.slice(21);
  assert.throws(() => decrypt(tampered, KEY), SecretCryptoError);
});

test('short encryption key throws on use', () => {
  assert.throws(() => encrypt('x', 'short'), SecretCryptoError);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && node --test --experimental-strip-types tests/chat/secret-crypto.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 实现 secret-crypto.ts**

```ts
// ui/src/lib/chat/secret-crypto.ts
// AES-256-GCM encryption for chat agent credentials.
// - Key is derived from `AGENT_CRED_ENCRYPTION_KEY` env var (any length string).
// - IV is 12 bytes random per encrypt() call.
// - Output format: base64( IV(12) || authTag(16) || ciphertext(N) )
//
// The authTag (GCM MAC) is verified on decrypt. Tampered ciphertexts throw.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export class SecretCryptoError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SecretCryptoError';
  }
}

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const MIN_KEY_LEN = 16;  // user-facing requirement; we derive 32 bytes via SHA-256 anyway

function deriveKey(userKey: string): Buffer {
  if (userKey.length < MIN_KEY_LEN) {
    throw new SecretCryptoError(`Encryption key too short (min ${MIN_KEY_LEN} chars)`);
  }
  return createHash('sha256').update(userKey, 'utf-8').digest();
}

export function encrypt(plaintext: string, userKey: string): string {
  if (!userKey) throw new SecretCryptoError('Encryption key required');
  const key = deriveKey(userKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(ciphertext: string, userKey: string): string {
  if (!userKey) throw new SecretCryptoError('Encryption key required');
  const key = deriveKey(userKey);
  let buf: Buffer;
  try {
    buf = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new SecretCryptoError('Invalid base64 ciphertext');
  }
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new SecretCryptoError('Ciphertext too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf-8');
  } catch (e) {
    throw new SecretCryptoError('Decrypt failed (wrong key or tampered ciphertext)');
  }
}

// Internal: exposed for testability only
export function _getKey(userKey: string): Buffer { return deriveKey(userKey); }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && node --test --experimental-strip-types tests/chat/secret-crypto.test.ts
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/secret-crypto.ts ui/tests/chat/secret-crypto.test.ts
git commit -m "feat(chat): AES-256-GCM secret-crypto module + 7 tests"
```

---

## Task 3: agent-config-store 扩展

**Files:**
- Modify: `ui/src/lib/chat/agent-config-store.ts`
- Modify: `ui/tests/chat/agent-config-store.test.ts`

- [ ] **Step 1: 加 3 个新测试到现有测试文件**

```ts
// Add to ui/tests/chat/agent-config-store.test.ts:
test('initial state: baseURL/apiKey null, model default', () => {
  resetAgentConfig();
  const c = getAgentConfig();
  assert.equal(c.baseURL, null);
  assert.equal(c.apiKey, null);
  assert.equal(c.model, 'claude-opus-4-8');
});

test('setCredentialConfig updates baseURL/apiKey/model', () => {
  resetAgentConfig();
  setCredentialConfig('https://proxy.example.com', 'sk-test-1234', 'claude-sonnet-4-6');
  const c = getAgentConfig();
  assert.equal(c.baseURL, 'https://proxy.example.com');
  assert.equal(c.apiKey, 'sk-test-1234');
  assert.equal(c.model, 'claude-sonnet-4-6');
});

test('setCredentialConfig with null baseURL/key is allowed', () => {
  setCredentialConfig('https://x', 'k', 'm');
  setCredentialConfig(null, null, 'claude-opus-4-8');
  const c = getAgentConfig();
  assert.equal(c.baseURL, null);
  assert.equal(c.apiKey, null);
  assert.equal(c.model, 'claude-opus-4-8');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ui && node --test --experimental-strip-types tests/chat/agent-config-store.test.ts
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: 改 agent-config-store.ts**

读当前文件，扩展：

```ts
// 在 AgentConfig interface 加 3 字段:
export interface AgentConfig {
  agentMd: string;
  params: AgentConfigParams;
  baseURL: string | null;
  apiKey: string | null;
  model: string;
}

// 改 current 初始值:
let current: AgentConfig = {
  agentMd: loadDefaultAgentMd(),
  params: { ...DEFAULT_PARAMS },
  baseURL: null,
  apiKey: null,
  model: 'claude-opus-4-8',
};

// 加 setter:
export function setCredentialConfig(
  baseURL: string | null,
  apiKey: string | null,
  model: string,
): void {
  current = { ...current, baseURL, apiKey, model };
}

// 加 getters (便利):
export function getBaseURL(): string | null { return current.baseURL; }
export function getApiKey(): string | null { return current.apiKey; }
export function getModel(): string { return current.model; }

// resetAgentConfig 重置时也重置 credentials:
export function resetAgentConfig(): void {
  current = {
    agentMd: loadDefaultAgentMd(),
    params: { ...DEFAULT_PARAMS },
    baseURL: null,
    apiKey: null,
    model: 'claude-opus-4-8',
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ui && node --test --experimental-strip-types tests/chat/agent-config-store.test.ts
```

Expected: 5+3 = 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/chat/agent-config-store.ts ui/tests/chat/agent-config-store.test.ts
git commit -m "feat(chat): agent-config-store supports baseURL/apiKey/model + 3 tests"
```

---

## Task 4: API 端点扩展

**Files:**
- Modify: `ui/src/app/api/admin/agent-config/route.ts`

- [ ] **Step 1: 改 import + 加 helper**

```ts
// At top of file, add:
import { encrypt, decrypt } from '@/lib/chat/secret-crypto';
import pool from '@/lib/db';

// Helper: load credentials from DB (returns null if no row, or DB unavailable)
async function loadCredFromDb() {
  const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY;
  if (!encKey) return null;
  try {
    const { rows } = await pool.query(
      'SELECT base_url, encrypted_api_key, model FROM ops.chat_agent_credentials WHERE id = 1'
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      baseURL: row.base_url as string | null,
      apiKey: row.encrypted_api_key ? decrypt(row.encrypted_api_key, encKey) : null,
      model: row.model as string,
    };
  } catch (e) {
    console.warn('[admin/agent-config] DB unavailable, falling back to env:', (e as Error).message);
    return null;
  }
}

async function saveCredToDb(baseURL: string | null, apiKey: string | null, model: string, userId: string) {
  const encKey = process.env.AGENT_CRED_ENCRYPTION_KEY;
  if (!encKey) throw new Error('AGENT_CRED_ENCRYPTION_KEY env not set');
  const encryptedKey = apiKey ? encrypt(apiKey, encKey) : null;
  await pool.query(
    `INSERT INTO ops.chat_agent_credentials (id, base_url, encrypted_api_key, model, updated_by)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       encrypted_api_key = EXCLUDED.encrypted_api_key,
       model = EXCLUDED.model,
       updated_by = EXCLUDED.updated_by`,
    [baseURL, encryptedKey, model, userId]
  );
}

function maskKey(k: string | null): string | null {
  if (!k) return null;
  if (k.length <= 8) return '***';
  return k.slice(0, 4) + '***' + k.slice(-4);
}
```

- [ ] **Step 2: 改 GET**

```ts
export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const cfg = getAgentConfig();
  const fromDb = await loadCredFromDb();
  return NextResponse.json({
    agentMd: cfg.agentMd,
    params: cfg.params,
    defaultParams: DEFAULT_PARAMS,
    baseURL: fromDb?.baseURL ?? cfg.baseURL ?? null,
    apiKeyMasked: maskKey(fromDb?.apiKey ?? cfg.apiKey),
    model: fromDb?.model ?? cfg.model,
  });
}
```

- [ ] **Step 3: 改 POST**

```ts
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  
  // Update agentMd (write file + in-memory)
  if (typeof body.agentMd === 'string') {
    setAgentMd(body.agentMd);
    try { writeFileSync(AGENT_MD_FILE_PATH, body.agentMd, 'utf-8'); } catch (e) {
      console.warn('[admin/agent-config] file write failed:', (e as Error).message);
    }
  }
  
  // Update params
  if (body.params && typeof body.params === 'object') {
    const validated: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.params)) {
      if (!VALID_KEYS.has(k)) continue;
      validated[k] = v;
    }
    setParams(validated as Partial<Parameters<typeof setParams>[0]>);
  }
  
  // Update credentials (NEW)
  if (body.baseURL !== undefined || body.apiKey !== undefined || body.model !== undefined) {
    const currentFromDb = await loadCredFromDb();
    let newBaseURL = body.baseURL !== undefined ? (body.baseURL || null) : (currentFromDb?.baseURL ?? null);
    let newApiKey: string | null;
    if (body.apiKey === '') {
      newApiKey = null;  // clear
    } else if (body.apiKey) {
      newApiKey = body.apiKey;
    } else {
      newApiKey = currentFromDb?.apiKey ?? null;  // unchanged
    }
    const newModel = body.model || currentFromDb?.model || 'claude-opus-4-8';
    
    await saveCredToDb(newBaseURL, newApiKey, newModel, user.user_id);
    setCredentialConfig(newBaseURL, newApiKey, newModel);
  }
  
  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}
```

- [ ] **Step 4: DELETE 也清 credentials**

```ts
export async function DELETE() {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  resetAgentConfig();
  setCredentialConfig(null, null, 'claude-opus-4-8');  // also clear credentials
  // Optionally clear DB row too:
  try {
    await pool.query("UPDATE ops.chat_agent_credentials SET base_url=NULL, encrypted_api_key=NULL, model='claude-opus-4-8', updated_by=$1 WHERE id=1", [user.user_id]);
  } catch (e) {
    console.warn('[admin/agent-config] DB clear on reset failed:', (e as Error).message);
  }
  applyConfigToGlobals();
  return NextResponse.json({ success: true, config: getAgentConfig() });
}
```

- [ ] **Step 5: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -6
```

Expected: 0 errors, build success.

- [ ] **Step 6: Commit**

```bash
git add ui/src/app/api/admin/agent-config/route.ts
git commit -m "feat(chat): admin/agent-config API handles baseURL/apiKey/model with DB encryption"
```

---

## Task 5: route.ts 集成（chat 路由用 store 的 credentials）

**Files:**
- Modify: `ui/src/app/api/chat/route.ts`

- [ ] **Step 1: 改 import + 读 DB credentials at request time**

在 `route.ts` 顶部 import：
```ts
import { getAgentConfig, applyConfigToGlobals } from '@/lib/chat/agent-config-store';
import { decrypt } from '@/lib/chat/secret-crypto';
import pool from '@/lib/db';
```

在 route handler 内（auth 之后、chat 处理之前）：
```ts
// ---------- 2.5 load credentials ----------
let credBaseURL: string | null = null;
let credApiKey: string | null = null;
const cfg = getAgentConfig();
credBaseURL = cfg.baseURL;
credApiKey = cfg.apiKey;
// DB override: if env ENCRYPTION_KEY is set, try to load from DB
if (process.env.AGENT_CRED_ENCRYPTION_KEY) {
  try {
    const { rows } = await pool.query(
      'SELECT base_url, encrypted_api_key, model FROM ops.chat_agent_credentials WHERE id = 1'
    );
    if (rows.length > 0) {
      const row = rows[0];
      if (row.base_url) credBaseURL = row.base_url;
      if (row.encrypted_api_key) credApiKey = decrypt(row.encrypted_api_key, process.env.AGENT_CRED_ENCRYPTION_KEY);
    }
  } catch (e) {
    // DB unavailable — fall back to store (which is already loaded above)
  }
}
```

- [ ] **Step 2: 替换 env 读取**

把现有：
```ts
const anthropicBaseURL = process.env.ANTHROPIC_BASE_URL || undefined;
const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(anthropicBaseURL ? { baseURL: anthropicBaseURL } : {}),
});
```

替换为：
```ts
const anthropicBaseURL = credBaseURL || process.env.ANTHROPIC_BASE_URL || undefined;
const anthropicModel = (cfg.model !== 'claude-opus-4-8' ? cfg.model : null) || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const apiKey = credApiKey || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  // 401-equivalent
  controller.enqueue(...encodeSseEvent({ type: 'error', message: 'AI service not configured (no ANTHROPIC_API_KEY)' }));
  return;
}
const client = new Anthropic({
  apiKey,
  ...(anthropicBaseURL ? { baseURL: anthropicBaseURL } : {}),
});
```

Wait — `controller` is inside the stream start callback. The apiKey check needs to happen before that. Restructure:

Read the current route.ts to see where auth/cookie/limiter happens — those return Response directly. The stream creation is at the end. So:

```ts
// Right after applyConfigToGlobals():
const apiKey = credApiKey || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  return new Response('AI service not configured (no ANTHROPIC_API_KEY)', { status: 503 });
}
const anthropicBaseURL = credBaseURL || process.env.ANTHROPIC_BASE_URL || undefined;
const anthropicModel = cfg.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const client = new Anthropic({
  apiKey,
  ...(anthropicBaseURL ? { baseURL: anthropicBaseURL } : {}),
});
```

This replaces the current client construction.

- [ ] **Step 3: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -6
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/app/api/chat/route.ts
git commit -m "feat(chat): route.ts reads credentials from agent-config-store + DB"
```

---

## Task 6: UI 加 3 个新字段

**Files:**
- Modify: `ui/src/components/admin/AgentConfigEditor.tsx`
- Modify: `ui/src/app/u/admin/agent-config/ClientAgentConfig.tsx`

- [ ] **Step 1: 改 AgentConfigEditor**

读 `ui/src/components/admin/AgentConfigEditor.tsx`，改 Props 加 3 个字段：

```tsx
interface Props {
  initial: { agentMd: string; params: AgentConfigParams; baseURL: string | null; apiKeyMasked: string | null; model: string };
  defaultParams: AgentConfigParams;
  onSave: (data: { agentMd: string; params: AgentConfigParams; baseURL: string | null; apiKey: string; model: string }) => Promise<void>;
  onReset: () => Promise<void>;
}
```

在 useState 初始值加：
```tsx
const [baseURL, setBaseURL] = useState(initial.baseURL ?? '');
const [apiKey, setApiKey] = useState('');  // 留空 = 保留原值
const [showKey, setShowKey] = useState(false);
const [model, setModel] = useState(initial.model);
```

加 new section "API 配置" — 插在"调试参数"section 之后、按钮之前：

```tsx
<div>
  <h3 className="text-sm font-semibold text-gray-700">API 配置</h3>
  <p className="mt-1 text-xs text-gray-500">Anthropic API 连接信息。Base URL / API Key 留空 = 保留当前值。Model 改后下一个请求生效。</p>
  <div className="mt-3 space-y-3">
    <div>
      <label className="block text-xs text-gray-600">Base URL (留空 = 用 .env 的 ANTHROPIC_BASE_URL)</label>
      <input
        type="text"
        value={baseURL}
        onChange={e => setBaseURL(e.target.value)}
        placeholder="https://your-proxy.example.com"
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
      />
    </div>
    <div>
      <label className="block text-xs text-gray-600">
        API Key {initial.apiKeyMasked && <span className="text-gray-400">(当前: {initial.apiKeyMasked})</span>}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-ant-...  (留空 = 保留当前值)"
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => setShowKey(s => !s)}
          className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
          title={showKey ? '隐藏' : '显示'}
        >{showKey ? '🙈' : '👁'}</button>
      </div>
    </div>
    <div>
      <label className="block text-xs text-gray-600">Model</label>
      <input
        type="text"
        value={model}
        onChange={e => setModel(e.target.value)}
        placeholder="claude-opus-4-8"
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
      />
    </div>
  </div>
</div>
```

改 handleSave 多传 3 字段：
```tsx
async function handleSave() {
  setSaving(true);
  setMessage(null);
  try {
    await onSave({
      agentMd, params,
      baseURL: baseURL.trim() || null,
      apiKey,  // empty string = "保留原值" (server detects undefined-vs-empty)
      model: model.trim() || 'claude-opus-4-8',
    });
    setMessage('✅ 已保存。下一个请求生效。');
    setApiKey('');  // clear after save
  } catch (e) {
    setMessage('❌ 保存失败：' + (e as Error).message);
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 2: 改 ClientAgentConfig.tsx**

读当前文件，改 onSave 多传 3 字段：
```tsx
async function handleSave(data: { agentMd: string; params: AgentConfigParams; baseURL: string | null; apiKey: string; model: string }) {
  const res = await fetch('/api/admin/agent-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentMd: data.agentMd,
      params: data.params,
      baseURL: data.baseURL,  // null = clear, undefined = leave
      apiKey: data.apiKey,    // '' = clear, undefined = leave (we always send '')
      model: data.model,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
```

注意：前端要 **始终** 传 `apiKey` 字段（即使是空字符串），让后端能区分"未传"vs"传了空字符串"。

- [ ] **Step 3: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -6
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/admin/AgentConfigEditor.tsx ui/src/app/u/admin/agent-config/ClientAgentConfig.tsx
git commit -m "feat(chat): admin UI fields for baseURL/apiKey/model with password toggle"
```

---

## Task 7: env 文档

**Files:**
- Modify: `ui/.env.example`

- [ ] **Step 1: 加 AGENT_CRED_ENCRYPTION_KEY**

读当前文件，加在 ANTHROPIC_API_KEY 之后：

```
# Optional: override the API base URL to use a third-party Anthropic-compatible
# proxy or gateway (e.g. OpenRouter-Anthropic, internal LLM gateway).
# Leave blank to use the official Anthropic API at https://api.anthropic.com.
# ANTHROPIC_BASE_URL=https://your-anthropic-compatible-proxy.example.com

# Optional: override the model name. Default is claude-opus-4-8 (the model the
# chat adapter is tuned for). Change to whatever your proxy supports
# (e.g. claude-sonnet-4-6, claude-3-5-sonnet-20241022, etc.).
# ANTHROPIC_MODEL=claude-opus-4-8

# ⚠️ REQUIRED if using /u/admin/agent-config to store API key in DB.
# Used to AES-256-GCM encrypt the API key in ops.chat_agent_credentials.
# Minimum 16 chars. RECOMMENDED: a long random string (e.g. `openssl rand -hex 32`).
# If this env is unset, the admin UI will refuse to save credentials, and
# the chat will fall back to ANTHROPIC_API_KEY env var.
# IMPORTANT: keep this the same across all server instances (if you run multiple).
# If you change it, previously-encrypted keys in the DB will be unreadable.
AGENT_CRED_ENCRYPTION_KEY=replace-with-32-byte-random-string-from-openssl
```

- [ ] **Step 2: Commit**

```bash
git add ui/.env.example
git commit -m "docs(env): document AGENT_CRED_ENCRYPTION_KEY for DB-stored API keys"
```

---

## Task 8: 最终验证

- [ ] **Step 1: 跑所有测试**

```bash
cd ui && node --test --experimental-strip-types tests/chat/*.test.ts
```

Expected: 35 + 5 + 3 + 7 = 50 PASS.

- [ ] **Step 2: tsc + build**

```bash
cd ui && npx tsc --noEmit && npx next build 2>&1 | tail -6
```

- [ ] **Step 3: 跑 verify-chat-agent.sh**

```bash
bash scripts/verify-chat-agent.sh
```

Expected: 4 项 ✓

- [ ] **Step 4: Live test（v1 — admin 在 UI 设 apiKey）**

需要 `AGENT_CRED_ENCRYPTION_KEY` env var。在 dev 加：
```bash
echo "AGENT_CRED_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> ui/.env.local
```
重启 dev server。

然后 admin 进 `/u/admin/agent-config` → 看到 3 个新字段 → 填 baseURL/apiKey/model → 保存 → 跳到 chat 测试。

- [ ] **Step 5: 推到 main + 看 CI**

```bash
git push origin main
gh run list --limit 1
```

- [ ] **Step 6: commit any post-test fixes**

---

## 验收目标

- 50/50 单元测试通过
- tsc 0 新错误
- next build 成功
- verify-chat-agent.sh 全过
- Live: admin UI 改 baseURL/apiKey/model → 下个 chat 请求生效
- Live: GET 返回 apiKeyMasked 形如 `sk-***1234`
- Live: DB 里 encrypted_api_key 列存的是密文（base64 IV+tag+ct）
