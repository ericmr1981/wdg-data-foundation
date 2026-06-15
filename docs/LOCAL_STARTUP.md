# WDG｜本地服务启动文档（v0）

> 目标：在一台新机器/新环境上，从 0 到「PG + 初始化 + 导入样例 + UI + 验证查询」跑通。

## 1. 目录位置
- 代码仓库目录：`/Users/ericmr/Documents/GitHub/wdg-data-foundation`

> 注：项目治理/验收证据等记录维护在 Obsidian（不在本 repo 版本控制内）。

后续所有命令默认在该目录执行。

## 2. 依赖与前置条件
- Docker Desktop（确保 `docker info` 可用）
- Python 3.11（用于 ETL 脚本）
- Node.js 18+（用于 UI：Next.js）
- psql（可选，但建议装，便于直接验证 SQL）

## 3. 配置（.env）
项目内提供：`.env.example`

初始化：
```bash
cd "/Users/ericmr/Documents/GitHub/wdg-data-foundation"
cp .env.example .env

# 让当前 shell 生效（脚本也会自动 source .env）
set -a && source .env && set +a
```

默认会使用：
- `DB_HOST=localhost`
- `DB_PORT=5432`
- `DB_NAME=dataplatform`
- `DB_USER=postgres`
- `DB_PASSWORD=postgres`

## 4. 启动 PostgreSQL + 初始化库表
### 4.1 一键初始化（推荐）
```bash
cd "/Users/ericmr/Documents/GitHub/wdg-data-foundation"
./scripts/init_local_env.sh
```

脚本做的事（概览）：
- 启动/复用 Docker PG 容器：`dataplatform-pg`
- 创建必要 schema（raw/ops/yufeng_ods/yufeng_cfg/yufeng_dm/bonjur_ods…）
- 依次执行 SQL 初始化文件

### 4.2 初始化 + 导入样例数据 + 跑一遍 pipeline
```bash
cd "/Users/ericmr/Documents/GitHub/wdg-data-foundation"
./scripts/init_local_env.sh --with-sample-data
```

> 备注：样例数据来自 `inputs/` 目录下的示例文件；该流程适合作为“本机快速验收”。

## 5. 启动 UI（Next.js）
```bash
cd "/Users/ericmr/Documents/GitHub/wdg-data-foundation/ui"

# 首次
npm install

# 启动
npm run dev
```

访问：
- `http://localhost:3000/`
- 关键页面：`/pipeline`（覆盖率/运行记录）、`/rules`（规则管理）、`/match`（人工匹配）、`/upload`（上传）

## 6. 常用验证 SQL（最小集）
> 以下 SQL 用于确认“导入→分类→覆盖率→DM”链路是通的。

### 6.1 最近导入文件登记
```sql
SELECT *
FROM raw.ingest_file
ORDER BY created_at DESC
LIMIT 10;
```

### 6.2 Yufeng：覆盖率（按月）
```sql
SELECT *
FROM yufeng_dm.v_coverage_monthly
ORDER BY month DESC;
```

### 6.3 Yufeng：未分类 Top
```sql
SELECT *
FROM yufeng_dm.v_unclassified_top
LIMIT 20;
```

### 6.4 Yufeng：三张主报表（视图）
```sql
SELECT * FROM yufeng_dm.revenue_monthly ORDER BY month DESC;
SELECT * FROM yufeng_dm.expense_monthly ORDER BY month DESC;
SELECT * FROM yufeng_dm.profit_monthly  ORDER BY month DESC;
```

## 7. 常见问题（FAQ）
### 7.1 端口被占用 / 想换端口
`.env` 中改 `DB_PORT`，再重跑：
```bash
./scripts/init_local_env.sh
```

### 7.2 想清空环境重来
优先建议：
- 停掉并删除容器 `dataplatform-pg`（这会丢数据，**谨慎**）
- 或者在 DB 内 drop schema / 清表（更可控）

> 需要我给“安全清空/重建”脚本的话我可以补一份（避免误删）。

## 8. 相关参考
- 端到端验收跑法：`docs/ACCEPTANCE_RUNBOOK.md`
- 本地测试 checklist：`docs/LOCAL_TEST_CHECKLIST.md`
- 一次真实跑通记录：`docs/REAL_RUN_2026-03-22.md`

## WDG Notification Scheduler (VPS deployment)

After deploying the app, install the APScheduler daemon that runs the 4 notification sweep tasks.

### One-time setup

```bash
# 1. Apply the DDL (already done in step "Database migrations")
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f /opt/wdg/sql/00_notifications_ddl.sql

# 2. Seed the default schedule
cd /opt/wdg
source .venv/bin/activate
python scripts/seed_notification_schedule.py

# 3. Create the report output directory
sudo mkdir -p /var/wdg/reports/{tamkoko,gelatomiiix,bonjur}
sudo chown -R www-data:www-data /var/wdg/reports

# 4. Install the systemd unit
sudo cp deploy/systemd/wdg-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wdg-scheduler

# 5. Verify it's running
sudo systemctl status wdg-scheduler
curl http://127.0.0.1:4711/health   # should return "ok"
```

### Day-to-day operations

- **View logs:** `sudo journalctl -u wdg-scheduler -f`
- **Trigger a sweep now:** `curl -X POST http://127.0.0.1:4711/reload` (or just edit the schedule in the UI)
- **Pause all sweeps:** `sudo systemctl stop wdg-scheduler`
- **Edit schedule:** in UI `/admin/config/notifications`, change cron expressions and Save — daemon reloads automatically within 5s.

### Health check

The daemon writes a row to `ops.notification_schedule_run` on every job. If the UI's "Recent 10 runs" panel shows the latest run > 2× the cron interval ago, the daemon may be hung.

## 9. VPS 部署 (systemd)

本地仍可用 docker-compose;VPS 走 systemd,详见 [docs/SYSTEMD_DEPLOY.md](SYSTEMD_DEPLOY.md)。

- Docker = 本地开发、容器化
- systemd = Linux VPS 生产

两者并存,按需选用。
