# 站内提醒消息与定时报表设计

**日期**: 2026-06-07
**状态**: 设计中
**作者**: Claude (brainstorming + user)

---

## 1. 背景与目标

### 1.1 业务诉求

运营/数据团队当前痛点:多品牌(泰柯茶园 tamkoko / 蜜可诗 gelatomiiix / 旺鼎阁 bonjur)数据分散在 4 个数据库场景中,问题发现滞后:

1. **数据未更新**:企迈日数据如果没有更新到 T-1 / 银行流水在每月第 5 日前未更新,财务对账时才发现
2. **未配条目堆积**:银行流水分类覆盖率掉到 80% 以下没人主动处理,直到月报对不齐
3. **重复匹配规则**:运营加规则时偶尔重复,导致同一条流水被两条规则匹配,分类结果不唯一
4. **月报表无交付节点**:每月 6 日应有上月报表 xlsx,目前靠人记得手动跑,偶尔漏发

### 1.2 设计目标

- 在 Next.js 站内提供统一**通知中心**(顶部铃铛 + 全屏列表),主动告知四类问题
- 提供**配置页面**让运营自行调整每个定时任务的 cron 表达式,无须 SSH 上 VPS
- 与现有 `ops.*` 体系 / `pipeline_run` / `submit_proposal` 模式一致,无新概念
- 优先在 **Tamkoko** 跑通,验证后推广到 gelatomiiix / bonjur

### 1.3 非目标(YAGNI)

站内通知;不做邮件/钉钉/Slack;不做移动 PUSH;不做用户偏好订阅;不做报表订阅;不做 i18n;不做 WebSocket 实时推送(用拉模式);不做调度看板。

---

## 2. 数据模型

### 2.1 `ops.notification`(主表,4 类提醒共用)

```sql
CREATE TABLE IF NOT EXISTS ops.notification (
    id              BIGSERIAL PRIMARY KEY,
    type            VARCHAR(40) NOT NULL,    -- 'data_stale' | 'unmatched_txn' | 'dup_rule' | 'monthly_report'
    brand_code      VARCHAR(50),              -- NULL = 跨品牌提醒
    severity        VARCHAR(10) NOT NULL DEFAULT 'info',  -- 'info' | 'warn' | 'error'
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    action_url      TEXT,
    action_label    VARCHAR(80),
    related_id      BIGINT,                   -- 关联 proposal_id / report_file_id
    dedup_key       VARCHAR(120) NOT NULL,    -- (type, brand, period, source_hash)
    status          VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'dismissed' | 'resolved'
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    swept_at        TIMESTAMP,                -- sweep 检测到此状态的时间
    CONSTRAINT chk_notification_type CHECK (type IN ('data_stale','unmatched_txn','dup_rule','monthly_report')),
    CONSTRAINT chk_notification_severity CHECK (severity IN ('info','warn','error')),
    CONSTRAINT chk_notification_status CHECK (status IN ('active','dismissed','resolved'))
);

-- 同 dedup_key 只能同时存在 1 条 active
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_active_dedup
    ON ops.notification (dedup_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_notification_brand_status
    ON ops.notification (brand_code, status, created_at DESC);
```

### 2.2 `ops.notification_read`(每用户已读)

```sql
CREATE TABLE IF NOT EXISTS ops.notification_read (
    notification_id BIGINT NOT NULL REFERENCES ops.notification(id) ON DELETE CASCADE,
    user_id         INT NOT NULL REFERENCES ops.users(id) ON DELETE CASCADE,
    read_at         TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
);
```

### 2.3 `ops.report_file`(报表文件元数据,沿用 source_file_id 跟踪风格)

```sql
CREATE TABLE IF NOT EXISTS ops.report_file (
    id              SERIAL PRIMARY KEY,
    brand_code      VARCHAR(50) NOT NULL,
    period          DATE NOT NULL,             -- 月初,如 2026-05-01
    report_type     VARCHAR(40) NOT NULL,      -- 首版: 'monthly_overview'
    file_name       VARCHAR(255) NOT NULL,
    file_path       TEXT NOT NULL,             -- /var/wdg/reports/{brand}/2026-05_tamkoko_monthly.xlsx
    file_hash       VARCHAR(64) NOT NULL,
    file_size       BIGINT,
    generated_at    TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (brand_code, period, report_type)
);
```

### 2.4 `ops.notification_schedule`(调度配置,可运行时改)

```sql
CREATE TABLE IF NOT EXISTS ops.notification_schedule (
    id              SERIAL PRIMARY KEY,
    task_name       VARCHAR(40) UNIQUE NOT NULL,  -- 'data_stale' | 'unmatched_txn' | 'dup_rule' | 'monthly_report'
    enabled         BOOLEAN NOT NULL DEFAULT true,
    cron_expr       VARCHAR(80) NOT NULL,         -- 标准 5 字段 cron,带时区(Asia/Shanghai)
    brands_filter   TEXT,                          -- CSV 品牌过滤,NULL=全品牌
    description     TEXT,
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_by      INT REFERENCES ops.users(id)
);
```

种子数据(初始化时插入 4 行,运营可改):

| task_name | 默认 cron | 含义 |
|---|---|---|
| data_stale | `0 9 * * *` | 每日 09:00 跑数据新鲜度 |
| unmatched_txn | `30 9 * * *` | 每日 09:30 跑未配条目 |
| dup_rule | `30 9 * * *` | 每日 09:30 跑重复规则 |
| monthly_report | `0 6 6 * *` | 每月 6 日 06:00 跑月报 |

### 2.5 `ops.notification_schedule_run`(每次执行日志)

```sql
CREATE TABLE IF NOT EXISTS ops.notification_schedule_run (
    id                  BIGSERIAL PRIMARY KEY,
    schedule_id         INT REFERENCES ops.notification_schedule(id),
    task_name           VARCHAR(40) NOT NULL,
    started_at          TIMESTAMP,
    finished_at         TIMESTAMP,
    status              VARCHAR(20),             -- 'success' | 'failed' | 'skipped'
    error_message       TEXT,
    new_notifications   INT,                     -- 本次 sweep 写入 ops.notification 行数
    trigger_source      VARCHAR(20)              -- 'cron' | 'manual' | 'reload'
);
```

---

## 3. 检测逻辑(4 个 sweep)

入口脚本 `scripts/run_notification_sweep.py --task {name} --brands {csv?} [--dry-run]`。

每个 sweep 函数签名统一:
```python
def sweep_<name>(conn, brands: list[str] | None) -> int:  # 返回本次新增通知条数
    ...
```

### 3.1 `data_stale` — 数据未更新

- 检测 1 — **企迈 T-1**:
  - 对每个有 qimai 表的 brand,查 `MAX(biz_date)`(从 `BRAND_SOURCE_MAP` 找表名)
  - 若 `MAX < today - 1 day` → 一条 `data_stale` 提醒(`severity='warn'`)
- 检测 2 — **银行流水 5 日前**:
  - 对每个有 bank 表的 brand,查 `MAX(txn_date)`
  - 若 `day(today) > 5` 且 `MAX < 当月 1 日` → 一条 `data_stale` 提醒(`severity='warn'`)
- 解决:下次 sweep 若 `MAX >= 阈值` → `UPDATE status='resolved', swept_at=now()`

### 3.2 `unmatched_txn` — 未配条目

- 跨所有 brand,跑:
  ```sql
  SELECT brand_code, COUNT(*) AS n
  FROM {brand}_bank_txn_unclassified
  GROUP BY brand_code
  HAVING COUNT(*) > 0
  ```
- 任一 brand 计数 > 0 → 一条 `unmatched_txn` 提醒
- `action_url = /match?brand={brand}&status=unclassified`
- `dedup_key = unmatched_txn:{brand_code}:{today ISO}`;同 (brand, day) 重复触发只更新 `swept_at`,不新增

### 3.3 `dup_rule` — 重复匹配规则

- 读 `ops.bank_rule_map`(跨所有 brand),按 `sha256(lower(trim(pattern)))` 分组
- 同 pattern_hash > 1 条 → 1 条 `dup_rule` 提醒
- 同步:对每组,选"按 `created_at DESC, id DESC` 排序第一条"为保留,其余生成 `submit_proposal`:
  - `proposal_type = 'merge_dup_rule'`
  - payload: `{ keep_id, disable_ids: [...], pattern_hash }`
  - **人不批准,不生效**
- 提醒 `action_url = /approval?proposal_id={proposal.id}`

### 3.4 `monthly_report` — 月报表

- 对每个 brand(`brands_filter` 不空则限定):
  - 计算 period = `(today - 1 month) 月初`
  - 从 `gelatomiiix_dm.*` / `bonjur_dm.*` / `tamkoko_dm.*` 聚合:营收 / 成本 / 费用 / 毛利 / 现金流(cash-basis)
  - 写 xlsx 到 `/var/wdg/reports/{brand}/{YYYY-MM}_{brand}_monthly.xlsx`
  - 写 `ops.report_file` 一条(唯一约束保证幂等)
  - 写一条 `monthly_report` 提醒,`action_url = /api/reports/{id}`,`action_label = '下载 Excel'`
  - 若该 period 已有 `report_file` 记录 → 跳过生成,仍写一条提醒给用户(可选优化,本期不实现)

### 3.5 通用幂等性

- 用 `dedup_key = "{type}:{brand_code or 'all'}:{period}:{source_hash}"` 保证同状态不重复插
- 跑过后 `swept_at = now()`
- 状态变化时(sweep 检测到问题已解决):`UPDATE status='resolved'`,不删行(留审计)

### 3.6 跨品牌表名映射

`scripts/notification_sweep_brand_map.py` 新建,导出:
```python
BRAND_SOURCE_MAP: dict[str, dict[str, str]] = {
    'tamkoko': {
        'qimai': 'tamkoko_ods.qimai_sales',       # 待 M1 探索期确认真实表名
        'bank':  'tamkoko_ods.bank_txn',
        'unclassified': 'tamkoko_ods.bank_txn_unclassified',
    },
    'gelatomiiix': { ... },
    'bonjur': { ... },
}
```

M1 第一步先去生产 schema 校对真实表名。

---

## 4. 调度 — APScheduler 常驻 daemon

### 4.1 进程

`scripts/wdg_scheduler_daemon.py`:
- 启动时 `SELECT * FROM ops.notification_schedule WHERE enabled = true` → APScheduler `add_job(cron_expr, func=run_sweep, args=[task_name])`
- 监听 UNIX socket 或 HTTP `/api/reload`(本地 127.0.0.1,端口 4711)→ 收到 reload 后清空 jobs 重新加载

### 4.2 systemd unit

`deploy/systemd/wdg-scheduler.service`:
```ini
[Unit]
Description=WDG Notification Scheduler
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
EnvironmentFile=/opt/wdg/.env
ExecStart=/opt/wdg/.venv/bin/python /opt/wdg/scripts/wdg_scheduler_daemon.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

部署:VPS 上 `systemctl daemon-reload && systemctl enable --now wdg-scheduler`。

### 4.3 故障检测

`wdg-scheduler` 自身也写 `ops.notification_schedule_run`(`trigger_source='cron'`),UI 配置页:
- 若最新一条 `started_at` 距今 > `2 × cron 间隔`,在 UI 顶部显示"调度器 X 小时未运行"二级提醒
- 同时:daemon 内置一个 self-watchdog,每 5 分钟往 `ops.notification_schedule_run` 写一条 `task_name='_heartbeat'`

---

## 5. 后端 API

| 路径 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/api/notifications` | GET | 拉当前用户的活跃通知列表 + 未读数 | 登录用户 |
| `/api/notifications/[id]/read` | POST | 标记一条已读 | 登录用户(只能读自己的) |
| `/api/notifications/[id]/dismiss` | POST | 关闭一条 | 登录用户 |
| `/api/notifications/read-all` | POST | 全部已读 | 登录用户 |
| `/api/reports/[id]` | GET | 流式返回 xlsx + 鉴权 | 登录用户 |
| `/api/admin/notifications/schedule` | GET / PUT | 调度配置列表/保存 | admin |
| `/api/admin/notifications/schedule/reload` | POST | 通知 daemon 重载 | admin |
| `/api/admin/notifications/schedule/runs` | GET | 执行历史 | admin |

**`GET /api/notifications` 响应**:
```json
{
  "unread_count": 3,
  "items": [
    {
      "id": 123,
      "type": "data_stale",
      "brand_code": "tamkoko",
      "severity": "warn",
      "title": "泰柯茶园 企迈数据未更新至 T-1",
      "body": "上次数据停留在 2026-06-05,已超过 1 天",
      "action_url": "/sales?brand=tamkoko&stale=1",
      "action_label": "查看",
      "related_id": null,
      "created_at": "2026-06-07T09:00:12+08:00",
      "is_read": false
    }
  ]
}
```

**Query SQL**:
```sql
SELECT n.id, n.type, n.brand_code, n.severity, n.title, n.body,
       n.action_url, n.action_label, n.related_id, n.created_at,
       (nr.user_id IS NOT NULL) AS is_read
FROM ops.notification n
LEFT JOIN ops.notification_read nr
  ON nr.notification_id = n.id AND nr.user_id = $1
WHERE n.status = 'active'
ORDER BY n.severity DESC, n.created_at DESC
LIMIT 100;
```

`unread_count`:
```sql
SELECT COUNT(*)
FROM ops.notification n
WHERE n.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM ops.notification_read nr
                  WHERE nr.notification_id = n.id AND nr.user_id = $1);
```

**报表下载 `/api/reports/[id]`**:
- 读 `ops.report_file` 验存在 → `Path(file_path).read_bytes()`
- `Response(bytes, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`
- `Content-Disposition: attachment; filename={file_name}`
- 404 / 403 走 `getErrorMessage` 标准错误

---

## 6. 前端 UI

### 6.1 `<NotificationBell>` 组件

- 路径:`ui/src/components/NotificationBell.tsx`
- 位置:`app/layout.tsx` 顶部 nav 右侧,登录后显示
- 视觉:铃铛 + 红色小圆点 badge(未读数,99+ 显示 99+)
- 行为:
  - mount 时 `GET /api/notifications`(拉模式,无轮询)
  - 点击展开下拉面板(类似 GitHub 通知),显示前 20 条
  - 面板底部"查看全部"→ `/notifications`
- 每条:
  - 点击行(非按钮)→ `router.push(item.action_url)`(若 `action_url` 是 `/api/reports/...` 则 `<a href download>` 直接下载)
  - 右侧 ✕ → POST dismiss
  - hover 显示已读/未读(未读有蓝色左边框)
- 面板顶部"全部已读"按钮

### 6.2 `/notifications` 全屏页

- 路径:`ui/src/app/notifications/page.tsx`
- 列表 + 类型 filter 标签(全部 / 数据未更新 / 未配条目 / 重复匹配 / 月报表)
- 空状态友好提示

### 6.3 `/admin/config/notifications` 配置页

- 路径:`ui/src/app/admin/config/notifications/page.tsx`
- 与 `/admin/config/category-dictionary` 平级
- 列表:4 行(4 个 task)
- 每行:
  - `enabled` 开关
  - `cron_expr` 文本框 + 预设下拉(每日 09:00 / 每日 09:30 / 每月 6 日 06:00 / 自定义)
  - `brands_filter` 复选(全选 / tamkoko / gelatomiiix / bonjur)
  - 保存按钮
- 保存流程:`PUT /api/admin/notifications/schedule` → 写表 → `POST /reload` → daemon 重载
- 页面底部"最近 10 次执行"小表(从 `ops.notification_schedule_run` 读)

### 6.4 跳入位置参数

| type | action_url |
|---|---|
| data_stale | `/sales?brand={brand}&stale=1` 或 `/match?stale=1` |
| unmatched_txn | `/match?brand={brand}&status=unclassified` |
| dup_rule | `/approval?proposal_id={related_id}` |
| monthly_report | `/api/reports/{related_id}`(下载触发) |

### 6.5 类型定义

`ui/src/lib/notification-types.ts`(新):
```ts
export type NotificationType = 'data_stale' | 'unmatched_txn' | 'dup_rule' | 'monthly_report';
export type Severity = 'info' | 'warn' | 'error';

export interface NotificationItem {
  id: number;
  type: NotificationType;
  brand_code: string | null;
  severity: Severity;
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  related_id: number | null;
  created_at: string;
  is_read: boolean;
}
```

---

## 7. 测试策略

### 7.1 Python(后端 sweep)
`tests/test_notification_sweep.py`:
- `test_data_stale_qimai`: mock MAX biz_date < today-1 → 产生提醒
- `test_data_stale_resolved`: 第二次 sweep 数据已更新 → 状态 resolved
- `test_data_stale_idempotent`: 连续两次同状态只产生 1 条
- `test_unmatched_txn_basic`: 给 tamkoko 注入 N 条 unclassified → 1 条提醒
- `test_dup_rule_basic`: 注入 2 条同 pattern → 1 条提醒 + 1 个 proposal
- `test_monthly_report_xlsx`: 注入 1 brand + 1 period → xlsx 存在 + report_file 1 条

### 7.2 Next.js API
`ui/src/app/api/notifications/route.test.ts`:
- 未登录 401
- 登录后看到自己 brand 的通知
- 标记已读后 unread_count 下降
- dismiss 后下次拉取不出现

### 7.3 E2E(Playwright)
- 登录 → 看到铃铛 → 红点 ≥ 1(预先 seed 1 条)
- 点击通知跳转目标页
- 配置页修改 cron 表达式 → 保存成功 → UI 显示"已生效"
- 月报表通知 → 点击下载 → 文件名正确

---

## 8. 部署 & 配置

### 8.1 一次性部署步骤

```bash
# 1. 应用 DDL
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f sql/00_notifications_ddl.sql

# 2. 装 Python 依赖
echo 'croniter>=2.0' >> requirements.txt
pip install -r requirements.txt
echo 'APScheduler>=3.10' >> requirements.txt
pip install -r requirements.txt
echo 'openpyxl>=3.1' >> requirements.txt
pip install -r requirements.txt

# 3. 启 daemon
sudo cp deploy/systemd/wdg-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wdg-scheduler

# 4. seed 调度配置(若 DDL 末尾已 INSERT,可跳过)
python scripts/seed_notification_schedule.py

# 5. 创建报表目录
sudo mkdir -p /var/wdg/reports/{tamkoko,gelatomiiix,bonjur}
sudo chown www-data:www-data /var/wdg/reports -R
```

### 8.2 文档更新

- `docs/LOCAL_STARTUP.md` 末尾追加"WDG Scheduler"段
- `CLAUDE.md` 项目说明在"MCP Tools"段后追加"Reminders & Reports"段(列出 4 个 sweep + 1 个 daemon + 1 个 UI 入口)
- `docs/superpowers/specs/README.md`(若存在)追加本次 spec 索引

---

## 9. 实现里程碑

| M | 范围 | 验证 |
|---|---|---|
| M1 | 5 张表 DDL + sweep 骨架 + 单测 | `pytest tests/test_notification_sweep.py -v` 全绿 |
| M2 | API route handlers + `<NotificationBell>` + `/notifications` 全屏页 + vitest + Playwright 关键路径 | `npm run build` 通过,Playwright 跑过登录→红点→跳转 |
| M3 | `wdg_scheduler_daemon.py` + systemd + `/admin/config/notifications` + reload 端点 | 本地启 daemon,改 1 表达式为 1 分钟后等 1 分钟看 `notification_schedule_run` 多一条 |
| M4 | 月报表 xlsx 模板 + 数据聚合 + 下载 API | 6 月手动跑 monthly_report,生成 3 个 xlsx,UI 通知可见,下载成功 |
| M5 | spec 文档收尾 + `LOCAL_STARTUP.md` 部署段 + `CLAUDE.md` 同步 + 删 worktree 提 PR | git log 干净,无未跟踪 .env/.pyc |

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `croniter` / `APScheduler` / `openpyxl` 未装 | `requirements.txt` 显式声明;M1 第一步 `pip install -r` |
| daemon 进程崩溃 | systemd `Restart=always` + heartbeat 监控 |
| 长时间没跑(daemon 挂) | `notification_schedule_run` + UI 二级告警(本期 M3 实现) |
| xlsx 占用磁盘 | 本期不做自动清理;`/var/wdg/reports/{brand}/*.xlsx` 文档说明需人工归档。后续在新的清理任务里实现(独立 spec)。 |
| 报表生成耗时 5min+ 阻塞 daemon | M4 阶段:子任务用 `subprocess.Popen` 异步跑,daemon 不阻塞 |
| 重复规则判定误判 | 仅按"normalize 后文本相同"判重;M3 用真实规则集跑 sample 验证 |
| 跨 brand 表名不一致 | M1 第一步去生产 schema 校对,落 `BRAND_SOURCE_MAP` |
| 首次 sweep 无数据时 bell 红点 0 | 正常,空状态不显示空状态图(用户没东西可看) |
| 重复规则只对 `bank_rule_map` 跨 brand 不友好 | M3 探索期确认 `bank_rule_map` 是按 brand 拆表还是统一;若拆表,4 个 brand 各跑一次 |
| APScheduler 与 OS cron 共存混乱 | **本期只走 APScheduler daemon**,OS cron 路径删除 |
