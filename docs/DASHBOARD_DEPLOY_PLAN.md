# Dashboard 部署计划（数据中台）

> 目标：把「Pipeline 监控 + 覆盖率/未分类」做成可长期查看的 Dashboard。

## 0) 现状与输入

- 数据源：PostgreSQL（db: `dataplatform`）
- 关键表/视图：
  - Pipeline 运行：`ops.pipeline_run` / `ops.pipeline_step_run`
  - 覆盖率：`yufeng_dm.v_coverage_monthly`
  - 未分类 Top：`yufeng_dm.v_unclassified_top`
- 本地一键初始化：`scripts/init_local_env.sh --with-sample-data`

## 1) 部署形态（推荐）

采用 Docker Compose（VPS/本机一致），包含：

1. `postgres:16`（可选；若已有独立 PG，可替换为外部连接）
2. `metabase/metabase`（Dashboard 主载体）
3. `nextjs-ui`（本项目 UI MVP，提供可操作界面：规则管理/人工匹配/上传）

> 原则：Dashboard（读为主）用 Metabase；操作台（写回 DB）用 Next.js UI。

## 2) 端口与访问路径

### Phase 1（最小可用 / 内网）
- Postgres: `5432`
- Metabase: `3001` → `http://<host>:3001`
- Next.js UI: `3000` → `http://<host>:3000`

### Phase 2（对外 / 生产）
- 推荐统一走 443，使用 Nginx/Caddy 反代：
  - `/metabase` → `metabase:3000`
  - `/` → `nextjs-ui:3000`

> 反代与 TLS 暂不在本次文件中强行落地，先保证服务可跑。

## 3) Compose 文件

- 文件：`docker-compose.dashboard.yml`
- 使用：

```bash
cd /Users/ericmr/Documents/GitHub/Obsidian/项目/数据中台

docker compose -f docker-compose.dashboard.yml up -d

# 查看日志
# docker compose -f docker-compose.dashboard.yml logs -f metabase
```

## 4) Metabase Dashboard 设计（落地清单）

### 4.1 Pipeline Health（单页）

**图表 1：最近 20 次 pipeline_run 列表**
- 表：`ops.pipeline_run`
- 字段：started_at, finished_at, status, brand_code/store_code/month, note

**图表 2：最近一次 run 的 step_run 明细**
- 表：`ops.pipeline_step_run`
- 过滤：run_id = (select run_id from ops.pipeline_run order by started_at desc limit 1)
- 字段：step_name, status, duration_sec, rows_out, error_message

**图表 3：覆盖率趋势（近 6 个月）**
- 视图：`yufeng_dm.v_coverage_monthly`
- 字段：month, coverage_rate_rows, coverage_rate_in_amt, coverage_rate_out_amt

**图表 4：未分类 TopN（按金额）**
- 视图：`yufeng_dm.v_unclassified_top`
- 字段：month, counterparty_name, summary, txn_rows, total_amt

### 4.2 预置 SQL（可复制到 Metabase SQL Question）

```sql
-- 最近 20 次 pipeline_run
select *
from ops.pipeline_run
order by started_at desc
limit 20;

-- 最近一次 run 的 step 明细
with latest as (
  select run_id from ops.pipeline_run order by started_at desc limit 1
)
select *
from ops.pipeline_step_run
where run_id = (select run_id from latest)
order by step_order;

-- 覆盖率趋势
select month, coverage_rate_rows, coverage_rate_in_amt, coverage_rate_out_amt
from yufeng_dm.v_coverage_monthly
order by month;

-- 未分类 Top20（最近月）
with latest as (
  select max(month) as month from yufeng_dm.v_unclassified_top
)
select *
from yufeng_dm.v_unclassified_top
where month = (select month from latest)
order by total_amt desc
limit 20;
```

## 5) 验收（Definition of Done）

- [ ] `docker compose ... up -d` 后，Metabase 与 UI 均可访问
- [ ] Metabase 能连接 Postgres（通过环境变量注入连接信息）
- [ ] Pipeline Health Dashboard 能看到：run 列表、step 明细、覆盖率趋势、未分类 TopN

