# WD Refactoring — Project Tasks

## 目标
将 WD Data Foundation 整改到 P2 安全+可测试基线。

---

## T-006 ✅ Metabase Dashboards 卡在 "Waiting for results" — 已修复 (2026-04-01)

### 根因
1. Metabase `site-url` 端口配置与实际访问端口不一致，导致前端 API 调用异常。
2. Dashboard 的 Month 参数缺少 `values` 配置，导致查询时参数为空或触发慢查询。

### 修复操作
1. 修正 Metabase `site-url` 配置（通过 Metabase API）。
2. 为相关 Dashboard 的 Month 参数添加 `static-list` 值来源 + 月份列表 + default 值。

### 修复后验证（示例）
- 相关 Dashboard 能正常加载，卡片均返回数据。

### 待办
- [ ] 部署方需确保相关 DDL（如 `ops.login_attempts`、`ops.allowed_schemas`）在目标环境已执行（T-001/T-004 前置条件）
- [ ] 品牌（gelatomiiix/yufeng/bonjur）前端 UI 端到端验收

## 任务清单

- [ ] **T-001** P0-1: Login 防暴力破解（加 login_attempts 表 + 限速逻辑）
- [ ] **T-002** P0-2: 上传文件类型验证（白名单 .xlsx/.csv + MIME 检查）
- [ ] **T-003** P1:   ETL pipeline 加 transaction + 步骤失败回滚
- [ ] **T-004** P1:   加 schema 白名单校验（allowed_schemas 表 + brand-server.ts 集成）
- [ ] **T-005** P2:   分类规则抽成 JSON + Python 单测

## T-001: Login 防暴力破解

### 验收标准
```
Given: 同一 IP 5分钟内连续5次输错密码
When:  第6次登录请求
Then: 返回 429 Too Many Requests，不查库
```

### 文件变更
1. `ops/OPS_DDL.sql` — 新增 `ops.login_attempts` 表
2. `ui/src/app/api/auth/login/route.ts` — 限速 + 账户锁定逻辑
3. `ui/src/lib/auth-server.ts` — 封装 `checkRateLimit()` 辅助函数

### Oracle（L1）
```bash
# 编译通过 + TypeScript 类型检查
cd ui && npx tsc --noEmit 2>&1 | tail -5
```

---

## T-002: 上传文件类型验证

### 验收标准
```
Given: 上传文件 foo.exe / foo.jpg
When:  POST /api/upload
Then: 返回 400 "Invalid file type"
```

### 文件变更
1. `ui/src/app/api/upload/route.ts` — 加文件类型白名单校验

### Oracle（L1）
```bash
cd ui && npx tsc --noEmit 2>&1 | tail -5
```

---

## T-003: ETL Transaction + Rollback

### 验收标准
```
Given: pipeline_step_run 已写入但下一步失败
When:  ops_logger 自动回滚上一步的 rows_out 记录
Then:  中间状态不残留，数据一致
```

### 文件变更
1. `scripts/ops_logger.py` — `step_end()` 支持 `rollback=True` 参数
2. `scripts/run_pipeline_oneclick.py` — 捕获异常并触发回滚

### Oracle（L1）
```bash
# 语法检查
python3 -m py_compile scripts/ops_logger.py scripts/run_pipeline_oneclick.py
```

---

## T-004: Schema 白名单校验

### 验收标准
```
Given: brand=random_inject WHERE 1=1--
When:  GET /api/coverage?brand=xxx
Then:  仅当 brand 在 ops.allowed_schemas 里才执行查询，否则 400
```

### 文件变更
1. `ops/OPS_DDL.sql` — 新增 `ops.allowed_schemas` 表 + 初始化数据
2. `ui/src/lib/brand-server.ts` — `isAllowedSchema()` 校验

### Oracle（L1）
```bash
cd ui && npx tsc --noEmit 2>&1 | tail -5
```

---

## T-005: 分类规则 JSON 化 + 单测

### 验收标准
```
Given: 一条银行流水 {"summary": "给对方:深圳XX餐厅", "direction": "out"}
When:  classify.py 返回分类结果
Then:  结果与 SQL 函数 fn_classify_v2 一致，且有 pytest 单测覆盖
```

### 文件变更
1. `rules/yufeng_bank_rules.json` — 关键词规则（从 CSV 导出）
2. `scripts/classify.py` — 读取 JSON，输出分类
3. `tests/test_classify.py` — pytest 单测（边界：空值/多关键词/无匹配）

### Oracle（L2）
```bash
# JSON 规则 vs SQL 函数输出一致性
python3 scripts/verify_yufeng_classification.py  # 对比测试
pytest tests/test_classify.py -v
```
