# Notifications v2: Agent-Powered Unmatched Analysis & UI Polish

**日期**: 2026-06-07
**状态**: 设计中(v2 增量,基于 v1 spec `2026-06-07-notifications-design.md`)
**作者**: Claude (brainstorming + user)

---

## 1. 背景与目标

v1 落地后,4 类提醒 + APScheduler daemon + UI 通知中心都跑通。但用户实地验证发现:

1. **未配条目提醒只是"通知",没真正帮用户分析** — 当前跳到 `/match?brand=...&status=unclassified`,让人自己翻 bank_txn;而项目已经具备 chat agent 能力(mcp server + Anthropic SDK),应让 agent 直接生成候选分类(proposals)待人工审批。
2. **UI 太丑** — 铃铛、全屏列表、调度配置页三页 UI 简陋,需重做。
3. **调度配置页找不到** — `/admin/config` 索引里没列"通知调度"卡片,用户在 nav 看不到入口。

**v1 范围已实现(不在本增量)**:5 张表 DDL、4 个 sweep 任务、APScheduler daemon、systemd unit、9 个 API 端点、3 个 UI 页、pytest + node:test、spec + plan 文档。

**v2 目标**:
- 未配条目提醒:检测 → **自动调 Claude 分析** → 写 proposal → 跳审批页,全自动闭环
- 调度配置页:在 admin/config 索引加卡片,让用户能找到
- UI 三页重做,production-grade 视觉

### 1.1 非目标(YAGNI)

- ❌ 手动分析页 `/admin/analyze-unmatched`(用户明确不要)
- ❌ 邮件/钉钉/Slack 推送
- ❌ WebSocket 实时推送
- ❌ Service token 自动轮换
- ❌ 跨日 proposal 去重(只保证**同日**幂等,通过 dedup_key)
- ❌ UI 移动端深度优化
- ❌ i18n
- ❌ 通知分组(按 brand / day / type)— 第一版全平铺

---

## 2. 数据模型

### 2.1 DDL 改动(`sql/00_notifications_ddl.sql` 追加)

**新增表 `ops.service_token`**:
```sql
CREATE TABLE IF NOT EXISTS ops.service_token (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(80) UNIQUE NOT NULL,    -- e.g. 'sweep-notification'
    token_hash    VARCHAR(64) NOT NULL,            -- SHA-256 of the raw token (16 bytes hex = 64 chars wait, 32 bytes hex = 64; standardize on 32 bytes = sha-256 output)
    enabled       BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_token_name
    ON ops.service_token (name) WHERE enabled = true;
```

**修改 `ops.notification`**: 新增 `related_uuid VARCHAR(64)` 字段(关联 batch_id 等 UUID;`related_id BIGINT` 仍保留,关联数值 ID)
```sql
ALTER TABLE ops.notification ADD COLUMN IF NOT EXISTS related_uuid VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_notification_related_uuid
    ON ops.notification (related_uuid) WHERE related_uuid IS NOT NULL;
```

**复用现有表**(不动 DDL):
- `ops.notification` / `ops.notification_read` — 通知主表 + 已读位
- `ops.notification_schedule` / `ops.notification_schedule_run` — 调度配置 + 执行日志
- `ops.approval_proposals` — 审批表(已有,batch_id 字段已有,UNIQUE(batch_id, bank_txn_id) 已存在)
- `{brand}_ods.bank_txn` / `{brand}_dm.v_unclassified_top` — 银行流水 + 未配视图

### 2.2 通知 ↔ 批次关联

- `ops.notification.related_uuid` = `ops.approval_proposals.batch_id`
- 用户点击提醒 → 跳 `/u/approvals?source=unmatched&brand={brand}&batch={batch_id}&filter=pending`
- 提醒文案:`{brand} 有 {N} 条未配条目,已生成建议待审批` + body `批次 {batch_id[:8]}, 共 {proposals_created} 条建议`

---

## 3. API 契约

### 3.1 新增:`POST /api/admin/analyze-unclassified`

**鉴权**:`X-Service-Token: <raw>`(Service token,**不**走 user cookie)

**请求**:
```json
{
  "brand": "tamkoko",
  "limit": 50,                    // 可选, 上限 50, 默认 50
  "unclassified_txn_ids": [123, 456, 789]   // 可选; 不传则服务端从视图查
}
```

**响应 (200)**:
```json
{
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "brand": "tamkoko",
  "proposals_created": 8,
  "skipped": 2,
  "errors": []
}
```

**响应 (错误)**:
- 401: token 缺失或无效
- 403: token 已 disabled 或 name 不匹配
- 400: 参数非法(brand 不在 3 个内 / limit > 50)
- 502: Claude API 不可用,返回 `{ batch_id: null, proposals_created: 0, errors: [{reason: 'claude_unavailable'}] }`
- 500: 其他(捕获后写 `error_message` 进 run log)

### 3.2 服务端实现要点

**调用**:`Anthropic.messages.create({model: 'claude-sonnet-4-5', max_tokens: 8000, system: ..., messages: [{role: 'user', content: ...}]})`

**重要降级**:**不**走 MCP `submit_proposal` tool(它的 zod schema 适合交互式 chat tool_use loop,不适合 batch 场景)。直接 `messages.create` + 让模型返回结构化 JSON。

**Prompt 结构**:
```
[system]
{buildSystemPrompt({brand, page: 'batch-analyze'})}

[user]
你是 wdg-data-platform 的财务分类员。
以下是 {brand} 品牌当前 {N} 条未配条目的银行流水(JSON array)。
请为每条输出 {lvl1_code, lvl2_code, keyword, match_field, confidence, reasoning},包装成一个 JSON array 返回。
不要调用任何工具,直接给 JSON。

[嵌入未配条目]
[
  {"txn_id": 123, "txn_time": "...", "summary": "...", "memo": "...",
   "purpose": "...", "counterparty_name": "...", "in_amt": 0, "out_amt": 100.50},
  ...
]

[assistant 期望返回]
```json
[
  {"bank_txn_id": 123, "type": "type1", "llm_proposal": {"lvl1_code": "EXP_HR", "lvl2_code": "SALARY", "keyword": "工资", "match_field": "purpose", "confidence": "high", "reasoning": "..."}},
  ...
]
```

**`buildSystemPrompt` 需要扩展 `page: 'batch-analyze'` 分支**:
- 现有的 `compact: true` 模式(rule 数量从 5 升到 10)适用 — batch 任务需要更密集的规则调用
- 添加一句 "For batch tasks, return JSON array directly without tool calls"

**写库**:对每条 proposal,INSERT INTO `ops.approval_proposals`:
- `bank_txn_id`, `type='type1'`, `status='pending'`
- `batch_id=batch_id`(UUID)
- `lvl1_code`, `lvl2_code`, `keyword`, `match_field`, `confidence`, `reasoning` 来自模型返回
- `created_by = NULL`(service token 调用,不是真实用户)— 或用一个固定 system user UUID,在 seed 里创建

**错误隔离**:单条 INSERT 失败不阻塞整批,加进 `errors` 数组继续。

### 3.3 新增 lib:`lib/service-auth.ts`

```ts
import { createHash } from 'node:crypto';
import pool from '@/lib/db';

export interface ServiceAuth {
  name: string;
  id: number;
}

export async function requireServiceToken(req: Request, name: string): Promise<ServiceAuth | null> {
  const raw = req.headers.get('x-service-token');
  if (!raw) return null;
  const hash = createHash('sha256').update(raw).digest('hex');
  const { rows } = await pool.query(
    `SELECT id, name FROM ops.service_token
     WHERE token_hash = $1 AND enabled = true AND name = $2`,
    [hash, name]
  );
  if (rows.length === 0) return null;
  // 更新 last_used_at(不阻塞, fire-and-forget)
  pool.query(
    `UPDATE ops.service_token SET last_used_at = now() WHERE id = $1`,
    [rows[0].id]
  ).catch(() => {/* ignore */});
  return { id: rows[0].id, name: rows[0].name };
}
```

**使用**:
```ts
export async function POST(req: NextRequest) {
  const svc = await requireServiceToken(req, 'sweep-notification');
  if (!svc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // ... handle ...
}
```

### 3.4 Seed 脚本:`scripts/seed_service_token.py`

```python
"""
为 sweep-notification 服务生成 service token。
明文 token 仅打印一次(运行环境),DB 存 SHA-256 哈希。
"""
import os, secrets, hashlib, psycopg2

# 不接受参数,直接生成 32 字节随机 token (URL-safe base64)
raw = secrets.token_urlsafe(32)
hash_ = hashlib.sha256(raw.encode()).hexdigest()

conn = psycopg2.connect(...)  # 走 DEFAULT_DB_CONFIG
with conn.cursor() as cur:
    cur.execute(
        """INSERT INTO ops.service_token (name, token_hash, enabled)
           VALUES ('sweep-notification', %s, true)
           ON CONFLICT (name) DO UPDATE
           SET token_hash = EXCLUDED.token_hash, enabled = true""",
        (hash_,)
    )
conn.commit()
print(f"[OK] service token created. SAVE THIS (won't be shown again):\n  WDG_SERVICE_TOKEN={raw}")
```

---

## 4. Sweep 改造

### 4.1 `sweep_unmatched_txn` 新逻辑

```python
# scripts/notification_sweep.py
def sweep_unmatched_txn(conn, brands=None) -> int:
    target_brands = brands or all_brand_codes()
    today_iso = date.today().isoformat()
    new_count = 0

    for brand in target_brands:
        cfg = BRAND_SOURCE_MAP[brand]
        unclassified = cfg.get('unclassified_table')
        if not unclassified:
            continue

        # 1. 查数量 + 取最多 50 个 id
        with conn.cursor() as cur:
            cur.execute(f'SELECT COUNT(*) FROM {unclassified}')
            count = cur.fetchone()[0]
        if count == 0:
            resolve_notification_by_dedup_prefix(conn, f'unmatched_txn:{brand}:')
            continue

        with conn.cursor() as cur:
            cur.execute(
                f'SELECT bank_txn_id FROM {unclassified} ORDER BY txn_time DESC LIMIT 50'
            )
            # 注: 不同 brand 的视图列名可能不同, 需要根据 cfg 调整
            txn_ids = [r[0] for r in cur.fetchall()]

        # 2. 调分析 API
        api_result = call_analyze_api(brand, txn_ids)

        # 3. 写通知(含 batch_id)
        if api_result and api_result.get('proposals_created', 0) > 0:
            new_count += upsert_notification(
                conn,
                type_='unmatched_txn',
                dedup_key=f'unmatched_txn:{brand}:{today_iso}:{api_result["batch_id"]}',
                title=f'{brand} 有 {count} 条未配条目,已生成建议待审批',
                body=f'批次 {api_result["batch_id"][:8]}, 共 {api_result["proposals_created"]} 条建议',
                brand_code=brand,
                severity='warn',
                action_url=f'/u/approvals?source=unmatched&brand={brand}&batch={api_result["batch_id"]}&filter=pending',
                action_label='去审批',
            )
        else:
            # 调分析失败或 0 proposal, 仍写一条提示
            new_count += upsert_notification(
                conn,
                type_='unmatched_txn',
                dedup_key=f'unmatched_txn:{brand}:{today_iso}:no-analysis',
                title=f'{brand} 有 {count} 条未配条目待分析',
                body='自动分析暂未完成, 请人工处理或检查 service token 配置',
                brand_code=brand,
                severity='warn',
                action_url=f'/match?brand={brand}&status=unclassified',
                action_label='去查看',
            )

    return new_count
```

**dedup_key 改动**:
- v1: `unmatched_txn:{brand}:{YYYY-MM-DD}`(同日重跑不重复,但不区分 batch)
- v2: `unmatched_txn:{brand}:{YYYY-MM-DD}:{batch_id}`(精确到批次)— 同日重跑且 batch 相同 → 跳过;批次不同 → 允许多次
- 失败分支:dedup_key 用 `:no-analysis` 标识,每日只写一条

### 4.2 `call_analyze_api()` 工具函数

```python
# scripts/notification_sweep.py
import os, json, urllib.request, urllib.error

NEXT_BASE_URL = os.getenv('WDG_NEXT_BASE_URL', 'http://localhost:4100')
SERVICE_TOKEN = os.getenv('WDG_SERVICE_TOKEN', '')

def call_analyze_api(brand: str, txn_ids: list[int]) -> dict | None:
    """
    调 /api/admin/analyze-unclassified, 失败返回 None.
    失败时不抛异常, 让 sweep 继续处理其他 brand.
    """
    if not SERVICE_TOKEN:
        log.warning('WDG_SERVICE_TOKEN not set; skipping analyze for %s', brand)
        return None
    try:
        req = urllib.request.Request(
            f"{NEXT_BASE_URL}/api/admin/analyze-unclassified",
            data=json.dumps({'brand': brand, 'unclassified_txn_ids': txn_ids}).encode(),
            headers={
                'Content-Type': 'application/json',
                'X-Service-Token': SERVICE_TOKEN,
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as e:
        log.warning('analyze api failed for %s: %s', brand, e)
        return None
```

### 4.3 env 变量

| 变量 | 用途 | 默认 |
|---|---|---|
| `WDG_SERVICE_TOKEN` | 调 Next.js 的 service token 明文 | (无, 必须配) |
| `WDG_NEXT_BASE_URL` | Next.js 基础 URL | `http://localhost:4100` |

**Sweep 启动脚本 + systemd unit 更新**:从 `EnvironmentFile=/opt/wdg/.env` 读这两个变量。

---

## 5. `/u/approvals` 改造

### 5.1 接受新 query params

`/u/approvals/page.tsx` 已有 `useSearchParams()`,当前读 `?batch=...`。改造:

```ts
// 现状 (v1)
const [batchId, setBatchId] = useState<string | null>(() => searchParams.get('batch') ?? null);

// 改造 (v2)
const source = searchParams.get('source');          // 'unmatched' | null
const brandParam = searchParams.get('brand');        // override brand selector
const batchId = searchParams.get('batch');
const filterParam = searchParams.get('filter');      // 'all' | 'type1' | 'type2' | 'pending'

useEffect(() => {
  if (filterParam === 'pending') setFilter('pending');   // 新值
  if (brandParam) setSelectedBrand(brandParam);          // 切品牌
}, [filterParam, brandParam]);
```

### 5.2 Filter 状态扩展

```ts
type FilterTab = 'all' | 'type1' | 'type2' | 'pending';
```

**注意**:`'pending'` 是按 `status === 'pending'` 过滤,**不**是 type 过滤。需要在 filter 逻辑里加分支:
```ts
const filtered = useMemo(() => {
  if (filter === 'type1') return proposals.filter(p => p.type === 'type1');
  if (filter === 'type2') return proposals.filter(p => p.type === 'type2');
  if (filter === 'pending') return proposals.filter(p => p.status === 'pending');
  return proposals;
}, [proposals, filter]);
```

### 5.3 顶部横幅

```tsx
{source === 'unmatched' && batchId && (
  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm">
    📌 来自未配分析批次 <code>{batchId.slice(0, 8)}</code>,
    共 <b>{countInBatch}</b> 条建议,已为你筛选 status='pending' 的项。
  </div>
)}
```

`countInBatch` 从 API 拿到 batch 对应的 proposals 后算。

---

## 6. `/admin/config` 加卡片

`/admin/config/page.tsx` 现有 4 张 Card,追加 2 张:

```tsx
<Card
  title="通知调度"
  desc="配置 4 个 sweep 任务的 cron 表达式与品牌过滤,改完即生效。"
  href="/admin/config/notifications"
/>
<Card
  title="通知列表"
  desc="查看所有活跃通知,按类型筛选,标已读/关闭。"
  href="/notifications"
/>
```

---

## 7. UI 重做(3 页) — frontend-design skill

调 `frontend-design` skill 重做 3 个文件:
- `ui/src/components/NotificationBell.tsx` — 顶 nav 铃铛
- `ui/src/app/notifications/page.tsx` — 全屏列表
- `ui/src/app/admin/config/notifications/page.tsx` — 调度配置页

**设计原则**:
- 风格与项目现有 admin 子页(`/admin/config/category-dictionary`、`/admin/users`)保持视觉语言一致
- 不引入新依赖(shadcn / tailwind-ui 等)
- 中文文案
- 移动端基本可用
- 性能:铃铛仍用拉模式,no polling

**期望的视觉元素**:
- 配色:severity 三档(red error / amber warn / blue info)
- 卡片:border + rounded + shadow + hover
- 间距:p-4 / p-6 一致
- 字体:text-sm / text-base 标题
- 空状态:icon + 一句话 + 可选 CTA

---

## 8. 测试

### 8.1 Python(扩展 sweep tests)
- `test_sweep_unmatched_txn_calls_analyze_api` — mock `call_analyze_api` 验证 sweep 调它, 把 batch_id 写进通知
- `test_sweep_unmatched_txn_handles_api_failure` — mock API 返回 None, 写 `:no-analysis` 通知

### 8.2 node:test(API)
- `analyze-unclassified.test.ts`:
  - 无 token → 401
  - 无效 token → 401
  - 有效 token + 合法 brand → 200(可能 mock Claude 或用真实 API key)
  - brand 不在 3 个内 → 400
  - limit > 50 → 400

### 8.3 node:test(UI)
- `/u/approvals?filter=pending` 走测试覆盖 searchParams
- `/admin/config` 包含 2 张新卡片

### 8.4 Playwright(手动验证)
- 浏览器看 3 页 UI 重做效果

---

## 9. 部署

### 9.1 .env 追加

```
WDG_SERVICE_TOKEN=<seed script 生成的明文>
WDG_NEXT_BASE_URL=http://localhost:4100  # 生产改为 https://...
```

### 9.2 systemd unit 更新

`deploy/systemd/wdg-scheduler.service` 已经 `EnvironmentFile=/opt/wdg/.env`,所以 env 自动注入,**不需要改 service 文件**。

### 9.3 一次性 seed

```bash
python scripts/seed_service_token.py
# 打印 WDG_SERVICE_TOKEN=<raw>, 把它加到 /opt/wdg/.env
```

---

## 10. 里程碑

| Task | 范围 | 验证 |
|---|---|---|
| T1 | DDL 改动 (`ops.service_token` + `ops.notification.related_uuid`) | `\d ops.service_token` 存在; `\d ops.notification` 看到新字段 |
| T2 | `lib/service-auth.ts` + `scripts/seed_service_token.py` + `scripts/notification_sweep.py` 改造 + `call_analyze_api` | curl 调 `/api/admin/analyze-unclassified` 用 service token 200, 无 token 401; 跑 sweep → 通知表里看到新行 + related_uuid 填 |
| T3 | `/api/admin/analyze-unclassified/route.ts` 实现 | curl + node:test 覆盖 (4 cases) |
| T4 | `/u/approvals` 接受新 query params + 顶部横幅 + filter 扩展 | 浏览器进 `/u/approvals?source=unmatched&brand=tamkoko&batch=xxx&filter=pending` 看到效果 |
| T5 | `/admin/config` 加 2 张卡片 | 浏览器进 `/admin/config` 看到 |
| T6 | UI 重做 3 页 (frontend-design skill) | npm run build 通过; 浏览器看效果 |
| T7 | 验收 + 文档 | build + tests + 手动 walkthrough; 更新 spec + CLAUDE.md |

---

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `ops.notification.related_uuid` 字段类型错(装不下 UUID) | VARCHAR(64) 装 36-char UUID 没问题 |
| Sweep 端调 `/api/admin/analyze-unclassified` 超时 | handler 设 `maxDuration=60`, sweep 用 `urllib.request` 默认 60s. Claude 失败时 sweep 不抛错, 只写 `:no-analysis` 通知 |
| Service token 泄露 | token_hash 不存明文; sweep 端 token 在环境变量, 不入 git; seed 脚本只打印一次明文 |
| Claude API 限流 | handler 退避一次 (linear backoff 5s); 失败写 `:no-analysis` 通知, 不阻塞 sweep |
| `submit_proposal` MCP tool 强耦合 | **降级**: batch handler **不**走 MCP tool, 直接用 `anthropic.messages.create()` + 解析 JSON |
| `bank_txn_unclassified` 视图与 bank_txn 表的 join 性能 | sweep 取 id 用 `LIMIT 50`, handler 用 id 列表 `WHERE id = ANY($1)` |
| 跨 brand 多次调用 | sweep 在循环里逐 brand 调, 每个 brand 独立 batch. 一个失败不影响其他 |
| 同一天多次 sweep (daemon 重启等) | dedup_key 含 batch_id 区分; 同 batch 重跑被 partial unique index 阻止 |
| frontend-design skill 输出风格不符 | 完成后用户审, 不符就要求重做或局部修 |
| Dev server 还在运行(我之前的 bwr48eh79) | Task T1-T5 不需要重启 dev server; 只有 T6 UI 改动需要 HMR 自动刷新 |

---

## 12. 偏离 v1 spec 的部分

- `sweep_unmatched_txn` 的 action_url 从 `/match?brand=...&status=unclassified` 改为 `/u/approvals?source=unmatched&brand=...&batch=...&filter=pending`
- dedup_key 加上 batch_id 段
- 新增 DDL: `ops.service_token` 表 + `ops.notification.related_uuid` 字段
- 新增 API: `POST /api/admin/analyze-unclassified`
- 新增 Python 函数: `call_analyze_api()`
- 新增 sweep 环境变量: `WDG_SERVICE_TOKEN` / `WDG_NEXT_BASE_URL`
- `/u/approvals` 接受 source/brand/batch/filter=pending
- `/admin/config` 加 2 张卡片
- UI 重做 3 页

未变:v1 的 4 类通知、DSDL、daemon、9 个 API(除新加的 1 个)、3 个原 UI 页(除重做的 3 个)、pytest + node:test 基础测试。
