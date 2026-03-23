# 端到端验收运行手册

本文档说明从零开始运行数据中台端到端链路的完整步骤。

## 前置条件

- PostgreSQL 16 已安装并运行
- Python 3.11+ 已安装
- 项目依赖已安装（`pip install -r requirements.txt` 或使用 `.venv`）

## 快速开始（4 步完成）

---

### a) 设置数据库连接

```bash
# 方式1：环境变量（推荐）
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=dataplatform
export DB_USER=postgres
export DB_PASSWORD=postgres

# 方式2：Docker Compose（若使用容器）
# 启动 PostgreSQL：
docker run -d --name dataplatform-pg \
  -e POSTGRES_DB=dataplatform \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16
```

> **注**：首次使用需先执行 DDL 建表，参考 `ops/OPS_DDL.sql`、`brand-docs/Yufeng_ODS_DDL.sql`、`brand-docs/Bonjur_ODS_DDL.sql` 等文件。

---

### a.1) 初始化数据库（全新库首次部署）

**PostgreSQL 全新库 + schema 已创建** 场景下，按以下顺序执行 SQL 文件：

| 顺序 | SQL 文件 | 说明 |
|------|----------|------|
| 1 | `ops/OPS_DDL.sql` | 创建 ops schema 及基础表（ingest_file, pipeline_run 等） |
| 2 | `brand-docs/Yufeng_ODS_DDL.sql` | 创建 yufeng_ods schema 及银行流水表结构 |
| 3 | `brand-docs/Yufeng_CFG_DDL.sql` | 创建 yufeng_cfg schema 及规则表结构（空表） |
| 4 | `sql/yufeng_apply_classification.sql` | **一键落库**：创建 yufeng_dm schema、override 表、分类函数、分类视图、统计视图，并插入初版规则数据 |
| 5 | `brand-docs/Yufeng_DM_DDL_override_and_classified.sql` | 补充 DM 层其他视图（如已有重复可跳过） |

> **注意**：`yufeng_apply_classification.sql` 包含 `IF NOT EXISTS` 和 `ON CONFLICT DO NOTHING`，可安全重复执行。

---

### b) 导入样例数据

#### Yufeng 银行流水

```bash
# 干运行（不写库，验证解析）
python scripts/import_yufeng_bank_txn.py inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx --dry-run

# 真实导入
python scripts/import_yufeng_bank_txn.py inputs/yufeng/yf_gh/bank/2025-07/银行流水_工行_250301-250731.xlsx
```

#### Bonjur 营业数据

```bash
# 干运行（不写库，验证解析）
python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/mock_营业数据_自助营业取数_2026-02.csv --dry-run

# 真实导入
python scripts/import_bonjur_sales_daily.py inputs/bonjur/wz_oh_wxc/sales/2026-02/mock_营业数据_自助营业取数_2026-02.csv
```

---

### c) 运行分类 / 覆盖率 / DM 管道

```bash
# 全部品牌，dry-run（验证 SQL 语法，不写库）
python scripts/run_pipeline_oneclick.py --brand all --dry-run

# 仅 Yufeng（实际执行）
python scripts/run_pipeline_oneclick.py --brand yufeng

# 仅 Yufeng，指定月份
python scripts/run_pipeline_oneclick.py --brand yufeng --month 2025-07
```

---

### d) 查询验收结果

```sql
-- Yufeng 收入月报（业务口径 vs 银行口径 + 差异）
SELECT * FROM yufeng_dm.revenue_monthly;

-- Yufeng 费用月报（按 lvl1/lvl2 分类）
SELECT * FROM yufeng_dm.expense_monthly;

-- Yufeng 利润月报
SELECT * FROM yufeng_dm.profit_monthly;

-- 分类覆盖率月度统计（含 in/out 分开统计）
SELECT * FROM yufeng_dm.v_coverage_monthly;

-- 未分类 Top 20（默认全部月份）
SELECT * FROM yufeng_dm.v_unclassified_top LIMIT 20;

-- 未分类（指定月份）
SELECT * FROM yufeng_dm.v_unclassified_top WHERE month = '2025-07' LIMIT 20;

-- Bonjur 导入记录
SELECT * FROM raw.ingest_file WHERE brand_code = 'bonjur' ORDER BY created_at DESC;
```

---

## 本地一键初始化

> 新机器/新库 10 分钟内跑起本地全链路

### 快速开始

```bash
# 进入项目目录
cd /path/to/数据中台

# 方式1：仅初始化数据库（不含样例数据）
./scripts/init_local_env.sh

# 方式2：初始化 + 导入样例数据 + 运行 pipeline
./scripts/init_local_env.sh --with-sample-data
```

> **幂等性**：以上命令可重复执行，第二次执行零 ERROR（仅输出 NOTICE/INFO 级别日志）。

### 执行内容

| 步骤 | 说明 |
|------|------|
| 1. Docker PG | 启动/复用 `dataplatform-pg` 容器 |
| 2. Schema | 创建 raw/ops/bonjur_ods/yufeng_ods/yufeng_cfg/yufeng_dm |
| 3. DDL | 依次执行所有 SQL 文件（幂等） |
| 4. 兼容视图 | 创建 `bonjur_ods.sales_daily` 视图 |
| 5. 样例数据 | 可选：导入样例 + 运行 pipeline |

### 依赖要求

- Docker 已安装并运行
- 项目目录存在 `inputs/` 样例数据（可选）

### 验证

```sql
-- 检查 schema
SELECT schema_name FROM information_schema.schemata
WHERE schema_name IN ('raw', 'ops', 'bonjur_ods', 'yufeng_ods', 'yufeng_cfg', 'yufeng_dm');

-- 检查 Yufeng 规则
SELECT COUNT(*) FROM yufeng_cfg.bank_rule_map;

-- 检查 DM 视图
SELECT * FROM yufeng_dm.revenue_monthly LIMIT 1;
```

### 故障排查

| 问题 | 解决方案 |
|------|----------|
| Docker 未运行 | 启动 Docker Desktop |
| 端口冲突 | 修改 `DB_PORT` 环境变量 |
| 重复执行报错 | 已修复，脚本幂等，重复执行零 ERROR |

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| `ModuleNotFoundError: No module named 'psycopg2'` | 确保虚拟环境激活：`source .venv/bin/activate` |
| `relation does not exist` | 确认已执行 DDL 建表（见 a) 步） |
| 导入后数据未出现 | 检查 `ops.pipeline_run` 表确认步骤执行状态 |

## 相关文档

- 真实跑通记录（2026-03-22）：`docs/REAL_RUN_2026-03-22.md`

- 输入规范：`inputs/README.md`
- 幂等导入策略：`scripts/idempotent_import.md`
- 任务进度：`ProjectTasks.md`
