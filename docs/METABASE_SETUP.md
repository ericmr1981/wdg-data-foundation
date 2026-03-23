# Metabase Dashboard 配置指南

> 本文档记录 Pipeline Health Dashboard 的配置步骤。
> Metabase 已部署在 `http://localhost:3001`（用户名/密码：demo@metabase.com / demo123456）

## 0) 前置条件

- [x] Metabase 已启动（localhost:3001）
- [x] 数据库已连接（PostgreSQL dataplatform）
- [x] 数据已导入（参考 `docs/ACCEPTANCE_RUNBOOK.md`）

## 1) 添加数据库连接

### 操作步骤

1. **进入 Metabase** → 访问 `http://localhost:3001`
2. **登录** → 用户名 `demo@metabase.com`，密码 `demo123456`
3. **进入设置** → 点击右上角 ⚙️ 图标 → `Admin settings`
4. **添加数据库** → 点击左侧 `Databases` → 点击右上角 `Add database`
5. **填写连接信息**：

| 字段 | 值 |
|------|-----|
| Database type | PostgreSQL |
| Display name | `dataplatform` |
| Host | `localhost` |
| Port | `5432`（或 docker 内网 `172.17.0.1:5433`，如遇到连接问题） |
| Database name | `dataplatform` |
| Username | `postgres` |
| Password | `postgres` |
| Use a secure connection (SSL) | **不勾选**（本地开发） |

6. **保存** → 点击 `Save` 按钮
7. **验证** → 等待连接成功提示，如失败检查用户名/密码/端口

> **注意**：如本机 Docker 访问宿主机 PostgreSQL 遇到网络问题，可使用：
> - macOS: `host.docker.internal:5432`
> - 或确认 Docker 网络配置

## 2) 创建 Questions（4 个 SQL 查询）

### 2.1 Question 1: 最近 20 次 Pipeline Run

**操作步骤**：

1. **新建 Question** → 点击顶部导航栏 `+ New` → `SQL query`
2. **填写 SQL**：

```sql
SELECT
  run_id,
  brand_code,
  store_code,
  month,
  status,
  started_at,
  finished_at,
  note
FROM ops.pipeline_run
ORDER BY started_at DESC
LIMIT 20;
```

3. **保存** → 点击 `Save` → 填写名称：
   - **Name**: `Q1: Pipeline Run List`
   - **Collection**: `Pipeline Health`（如不存在可留空或选根目录）
4. **确认** → 点击 `Save`

---

### 2.2 Question 2: 最近一次 Run 的 Step 明细

**操作步骤**：

1. **新建 Question** → 点击顶部导航栏 `+ New` → `SQL query`
2. **填写 SQL**：

```sql
WITH latest AS (
  SELECT run_id
  FROM ops.pipeline_run
  ORDER BY started_at DESC
  LIMIT 1
)
SELECT
  psr.step_name,
  psr.status,
  psr.started_at,
  psr.finished_at,
  psr.duration_sec,
  psr.rows_out,
  psr.error_message
FROM ops.pipeline_step_run psr
WHERE psr.run_id = (SELECT run_id FROM latest)
ORDER BY psr.step_order;
```

3. **保存** → 点击 `Save` → 填写名称：
   - **Name**: `Q2: Latest Run Step Details`
   - **Collection**: `Pipeline Health`
4. **确认** → 点击 `Save`

---

### 2.3 Question 3: 覆盖率趋势（近 6 个月）

**操作步骤**：

1. **新建 Question** → 点击顶部导航栏 `+ New` → `SQL query`
2. **填写 SQL**：

```sql
SELECT
  month,
  total_rows,
  covered_rows,
  coverage_rate_rows,
  total_in_amt,
  covered_in_amt,
  coverage_rate_in_amt,
  total_out_amt,
  covered_out_amt,
  coverage_rate_out_amt
FROM yufeng_dm.v_coverage_monthly
ORDER BY month DESC
LIMIT 6;
```

3. **保存** → 点击 `Save` → 填写名称：
   - **Name**: `Q3: Coverage Trend (6 Months)`
   - **Collection**: `Pipeline Health`
4. **确认** → 点击 `Save`

---

### 2.4 Question 4: 未分类 Top20（最近月）

**操作步骤**：

1. **新建 Question** → 点击顶部导航栏 `+ New` → `SQL query`
2. **填写 SQL**：

```sql
WITH latest AS (
  SELECT MAX(month) AS month
  FROM yufeng_dm.v_unclassified_top
)
SELECT
  month,
  counterparty_name,
  summary,
  txn_rows,
  total_amt
FROM yufeng_dm.v_unclassified_top
WHERE month = (SELECT month FROM latest)
ORDER BY total_amt DESC
LIMIT 20;
```

3. **保存** → 点击 `Save` → 填写名称：
   - **Name**: `Q4: Unclassified Top20`
   - **Collection**: `Pipeline Health`
4. **确认** → 点击 `Save`

---

## 3) 创建 Dashboard

### 操作步骤

1. **新建 Dashboard** → 点击顶部导航栏 `+ New` → `Dashboard`
2. **填写名称**：
   - **Name**: `Pipeline Health`
   - **Description**: Pipeline 监控与覆盖率看板
3. **确认** → 点击 `Create`

### 添加图表

#### 3.1 添加 Q1: Pipeline Run List

1. **点击 Add card** → 在 Dashboard 空白处点击 `+` 或 `Add a question`
2. **选择 Question** → 搜索并选择 `Q1: Pipeline Run List`
3. **选择可视化类型** → 左侧 `Visualization` 选择 `Table`
4. **调整布局** → 拖拽卡片到合适位置和大小
5. **保存** → 点击右上角 `Save`

#### 3.2 添加 Q2: Latest Run Step Details

1. **点击 Add card** → 选择 `Q2: Latest Run Step Details`
2. **选择可视化类型** → `Table`
3. **保存** → 点击 `Save`

#### 3.3 添加 Q3: Coverage Trend

1. **点击 Add card** → 选择 `Q3: Coverage Trend (6 Months)`
2. **选择可视化类型** → `Line` 或 `Bar`
3. **设置 X 轴** → `month`
4. **设置 Y 轴** → 拖拽 `coverage_rate_rows`, `coverage_rate_in_amt`, `coverage_rate_out_amt` 到右侧 Metrics
5. **保存** → 点击 `Save`

#### 3.4 添加 Q4: Unclassified Top20

1. **点击 Add card** → 选择 `Q4: Unclassified Top20`
2. **选择可视化类型** → `Table` 或 `Bar`
3. **设置排序** → `total_amt` 降序
4. **保存** → 点击 `Save`

---

## 4) 设置刷新频率（可选）

### 操作步骤

1. **进入 Dashboard** → 打开刚创建的 `Pipeline Health`
2. **设置自动刷新** → 点击右上角时钟图标 ⏰
3. **选择刷新间隔** → 例如 `30 minutes`
4. **确认** → 点击 `Done`

> 刷新频率建议：生产环境 15-30 分钟，开发环境可更长

---

## 5) 设置过滤器（可选）

### 5.1 添加 Month 过滤器

1. **添加过滤器** → 点击 Dashboard 右上角 `Add filter` 或 `Filter`
2. **选择字段** → `Month` → 点击 `Add filter`
3. **设置默认值**（可选）→ 选择最近月份
4. **保存 Dashboard** → 点击 `Save`

### 5.2 添加 Brand 过滤器（未来扩展）

> 当前 Pipeline Run 表包含 `brand_code` 字段，如有需要可添加过滤器。

---

## 6) 验证清单

- [ ] 数据库连接成功
- [ ] Q1 显示最近 20 条 pipeline_run
- [ ] Q2 显示最近一次 run 的 step 明细
- [ ] Q3 显示覆盖率趋势（近 6 个月）
- [ ] Q4 显示未分类 Top20
- [ ] Dashboard 可正常访问
- [ ] 自动刷新已设置（如需要）
- [ ] 过滤器已设置（如需要）

---

## 7) 故障排查

### 问题：数据库连接失败

**检查项**：
1. PostgreSQL 是否运行：`docker ps | grep postgres` 或 `pg_isready -h localhost -p 5432`
2. 端口是否正确（5432 本机 / 5433 Docker）
3. 用户名密码是否正确

### 问题：Question 查询报错

**检查项**：
1. SQL 语法是否正确
2. 表/视图是否存在：`SELECT * FROM ops.pipeline_run LIMIT 1;`
3. Schema 是否在搜索路径：确认 `dataplatform` 数据库可访问

### 问题：Dashboard 无数据

**检查项**：
1. 先在 Question 中运行 SQL，确认有返回
2. 检查数据是否已导入：`SELECT COUNT(*) FROM ops.pipeline_run;`

---

## 附录：SQL 参考

### 覆盖率和未分类视图查询

```sql
-- 查看覆盖率视图
SELECT * FROM yufeng_dm.v_coverage_monthly ORDER BY month DESC;

-- 查看未分类 Top
SELECT * FROM yufeng_dm.v_unclassified_top ORDER BY total_amt DESC LIMIT 20;

-- 查看 Pipeline 运行记录
SELECT * FROM ops.pipeline_run ORDER BY started_at DESC LIMIT 10;
```

### 手动刷新视图

> 覆盖率/未分类基于视图，如遇数据延迟可手动刷新：

```sql
-- 刷新 Materialized View（如果有）
REFRESH MATERIALIZED VIEW yufeng_dm.v_coverage_monthly;
REFRESH MATERIALIZED VIEW yufeng_dm.v_unclassified_top;

-- 视图则无需刷新，自动反映最新数据
```
