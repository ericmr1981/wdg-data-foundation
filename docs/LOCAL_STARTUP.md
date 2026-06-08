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

## Agent Service (v1 新增)

启动后验证:

```bash
# 健康检查
curl http://localhost:4101/health
# {"status":"ok"}

# Metrics
curl http://localhost:4101/metrics | head -3
# 输出 prometheus 格式 (agent_llm_call_total 等)
```

切流到 agent:

```bash
# 改 .env
echo "NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=100" >> .env
docker compose restart ui
```

回滚到 v0 chat:

```bash
# 改回 0
sed -i '' 's/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=.*/NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=0/' .env
docker compose restart ui
```

查看任务执行历史: 浏览器打开 http://localhost:4100/u/notifications
