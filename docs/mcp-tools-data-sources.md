# MCP Tools — Data Source Inventory

> 将所有46个MCP工具与其对应的数据源（数据库表、视图、API路由）逐一对应。
> MCP 工具注册入口: `ui/src/mcp/server.ts`，每个工具实现在 `ui/src/mcp/tools/*.ts`。

---

## 背景：品牌与Schema映射

`normalizeBrand()` 决定品牌→schema前缀:

| 品牌 | 内部code | ods | cfg | dm | 备注 |
|------|-----------|-----|-----|-----|------|
| gelatomiiix (蜜可诗) | `gelatomiiix` | `brand_gelatomiiix_ods` / `gelatomiiix_ods` | `brand_gelatomiiix_cfg` | `brand_gelatomiiix_dm` | `yufeng`=别名, 部分表硬编码 `gelatomiiix_ods.income_detail` |
| bonjur (旺鼎阁) | `bonjur` | `bonjur_ods` | `bonjur_cfg` | `bonjur_dm` | 无 `brand_` 前缀(历史原因) |
| tamkoko (泰柯茶园) | `tamkoko` | `brand_tamkoko_ods` | `brand_tamkoko_cfg` | `brand_tamkoko_dm` | 新建品牌遵循 `brand_` 前缀规范 |

---

## 工具—数据源清单

### 1. Bank-txn 模块 (11个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 1 | `upload_bank_txn_file` | `POST /api/upload` | `raw.ingest_file`(去重) → `{brand}_dm.v_bank_txn_classified`(覆盖率统计) | 保存文件→触发 `import_*_bank_txn.py` → `{brand}_ods.bank_txn` + 刷新snapshot | **导入** |
| 2 | `get_unclassified_transactions` | `GET /api/match` | `{brand}_ods.bank_txn` + `{brand}_dm.bank_txn_classified_snapshot`(WHERE classified_source='unclassified') | — | **查询** |
| 3 | `get_txn_detail` | `GET /api/match/candidates` + `/api/match` | `{brand}_ods.bank_txn` + `{brand}_dm.bank_txn_classified_snapshot` | — | **查询** |
| 4 | `get_candidates` | `GET /api/match/candidates` | `{brand}_ods.bank_txn`(读 counterparty_name/summary/memo/purpose) | — | **查询** |
| 5 | `get_rules` | `GET /api/rules` | `{brand}_cfg.bank_rule_map` + `{brand}_cfg.dim_category_lvl1` + `{brand}_cfg.dim_category_lvl2` | — | **查询** |
| 6 | `preview_match` | `GET /api/match/preview` | `{brand}_dm.v_bank_txn_classified` + `{brand}_ods.bank_txn`(ILIKE 匹配模拟) | — | **查询** |
| 7 | `submit_proposal` | `POST /api/approval/proposals` | — | `ops.approval_proposal` (写入审批队列) | **写入(提案)** |
| 8 | `get_pipeline_kpi` | `GET /api/pipeline/kpi` | `{brand}_dm.bank_txn_classified_snapshot` + `{brand}_ods.bank_txn` | — | **查询** |
| 9 | `get_coverage_by_file` | `GET /api/coverage/by-file` | `{brand}_dm.v_coverage_by_file` | — | **查询** |
| 10 | `get_unclassified_by_file` | `GET /api/coverage/unclassified-by-file` | `{brand}_dm.v_unclassified_top_by_file` | — | **查询** |
| 11 | `rerun_match_by_file` | `POST /api/pipeline/rerun-match-by-file` | `raw.ingest_file`(查找目标文件) | 调用 `{brand}_dm.refresh_bank_txn_classified_snapshot(file_id)` + 写 `ops.pipeline_run`/`ops.pipeline_step_run` | **写入(snapshot刷新)** |

### 2. Approval 模块 (3个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 12 | `submit_proposal` | (同第7条) | — | `ops.approval_proposal` | **写入(提案)** |
| 13 | `get_proposal` | `GET /api/approval/proposals/{id}` | `ops.approval_proposal` + `{brand}_ods.bank_txn`(LEFT JOIN LATERAL) | — | **查询** |
| 14 | `query_approval_status`(即query-status) | `GET /api/approval/proposals` | `ops.approval_proposal` + `{brand}_ods.bank_txn`(LEFT JOIN LATERAL) | — | **查询** |

### 3. Store Report 模块 (2个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 15 | `query_store_report_snapshot` | `GET /api/store-report/snapshot` | `{brand}_dm.v_store_monthly_kpi`(当月+上月) | — | **查询** |
| 16 | `query_store_report_trend` | `GET /api/store-report/trend` | `{brand}_dm.v_store_monthly_kpi`(最高24个月) | — | **查询** |

### 4. Financial 模块 (7个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 17 | `query_financial_statement` | `GET /api/financial/profit` + `/cashflow` + `/balance-sheet` | `{brand}_dm.v_profit_statement` + `v_cashflow_statement` + `v_balance_sheet` | — | **查询** |
| 18 | `query_financial_overview` | `GET /api/financial/overview` | `{brand}_dm.v_profit_statement` + `v_cashflow_statement` + `v_balance_sheet` + `v_store_monthly_kpi` + `bank_txn_classified_snapshot` | — | **查询** |
| 19 | `query_financial_kpi_trend` | `GET /api/financial/kpi-trend` | `{brand}_dm.bank_txn_classified_snapshot` + `{brand}_ods.bank_txn` + `v_store_monthly_kpi` + `dim_category_lvl1`/`lvl2` | — | **查询** |
| 20 | `query_counterparty` | `GET /api/financial/counterparty` | `{brand}_ods.bank_txn` + `{brand}_dm.bank_txn_classified_snapshot` + `{brand}_cfg.dim_category_lvl1` | — | **查询** |
| 21 | `query_income_metrics` | `GET /api/financial/income-metrics` | `{brand}_dm.v_cashflow_statement`(net_amount>0) + `{brand}_cfg.dim_category_lvl1`/`lvl2` | — | **查询** |
| 22 | `query_payment_metrics` | `GET /api/financial/payment-metrics` | `{brand}_dm.v_cashflow_statement`(net_amount<0) + `{brand}_cfg.dim_category_lvl1` | — | **查询** |
| 23 | `query_qimai_revenue` | `GET /api/financial/qimai-revenue` | `{brand}_dm.v_profit_statement`(bank revenue) + `{brand}_ods.income_detail`(Qimai revenue) | — | **查询** |

### 5. Income 模块 (4个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 24 | `upload_gelatomiiix_income_detail` | `POST /api/gelatomiiix/income/upload-qimai` | `raw.ingest_file`(去重+统计) | 保存CSV→触发 `import_gelatomiiix_income_detail.py`→写入 `gelatomiiix_ods.income_detail` | **导入** |
| 25 | `upload_bonjur_income_detail` | `POST /api/bonjur/income/upload-qimai` | `raw.ingest_file`(去重+统计) | 保存CSV→触发 `import_bonjur_income_detail.py`→写入 `bonjur_ods.income_detail` | **导入** |
| 26 | `query_gelatomiiix_income` | `GET /api/gelatomiiix/income/qimai-detail` | `gelatomiiix_ods.income_detail` | — | **查询** |
| 27 | `get_qimai_entry_rate` | `GET /api/gelatomiiix/income/bank-entry-stats` | `gelatomiiix_ods.income_detail` + `brand_gelatomiiix_ods.bank_txn` + `brand_gelatomiiix_dm.bank_txn_classified_snapshot` + `{brand}_cfg.channel_mapping` | — | **查询** |

### 6. Sales 模块 (11个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 28 | `upload_bonjur_product_sales` | `POST /api/bonjur/sales/upload-product` | `raw.ingest_file`(去重) | 保存文件→触发脚本→写入 `bonjur_ods.product_sales_detail` | **导入** |
| 29 | `upload_bonjur_sales_self_service` | `POST /api/bonjur/sales/upload-self-service` | `raw.ingest_file`(去重) | 保存文件→触发脚本→写入 `bonjur_ods.sales_daily_self_service` | **导入** |
| 30 | `query_bonjur_qimai_sales` | `GET /api/bonjur/sales/qimai-pos` | `bonjur_ods.sales_daily_self_service` | — | **查询** |
| 31 | `query_bonjur_sales_summary` | `GET /api/bonjur/sales/overview` + `/trend` + `/channels` | `bonjur_ods.income_detail` | — | **查询** |
| 32 | `query_bonjur_sales_products` | `GET /api/bonjur/sales/products` | `bonjur_ods.product_sales_detail` | — | **查询** |
| 33 | `query_bonjur_sales_details` | `GET /api/bonjur/sales/details` | `bonjur_ods.sales_daily_self_service`(cash_register) / `bonjur_ods.sales_qimai_pos`(qimai) | — | **查询** |
| 34 | `query_gelatomiiix_sales_overview` | `GET /api/gelatomiiix/sales/overview` | `gelatomiiix_ods.income_detail` | — | **查询** |
| 35 | `query_gelatomiiix_sales_trend` | `GET /api/gelatomiiix/sales/trend` | `gelatomiiix_ods.income_detail` | — | **查询** |
| 36 | `query_gelatomiiix_sales_channels` | `GET /api/gelatomiiix/sales/channels` | `gelatomiiix_ods.income_detail` | — | **查询** |
| 37 | `query_gelatomiiix_sales_products` | `GET /api/gelatomiiix/sales/products` | `gelatomiiix_ods.income_detail` | — | **查询** |
| 38 | `query_gelatomiiix_sales_details` | `GET /api/gelatomiiix/sales/details` | `gelatomiiix_ods.income_detail` | — | **查询** |
| 39 | `query_gelatomiiix_sales_distribution` | `GET /api/gelatomiiix/sales/distribution` | `gelatomiiix_ods.income_detail` | — | **查询** |
| 40 | `query_gelatomiiix_sales_hourly` | `GET /api/gelatomiiix/sales/hourly` | `gelatomiiix_ods.income_detail` | — | **查询** |

> 注：Gelatomiiix 7个 sales 子工具 + 1个 income 工具 (`query_gelatomiiix_income`) 均读 `gelatomiiix_ods.income_detail` 同一张表。

### 7. Tamkoko Inventory 模块 (1个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 41 | `upload_tamkoko_inventory` | `POST /api/tamkoko/upload` | — | 保存XLSX→触发 `import_tamkoko_inventory.py`→写入 `brand_tamkoko_ods.inventory_month_end` | **导入** |

### 8. Metadata 模块 (4个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 42 | `get_brand_stores` | `GET /api/brands` + `GET /api/stores` | `ops.brands`(enabled=true) + `ops.stores`(enabled=true) | — | **查询** |
| 43 | `list_categories` | `GET /api/categories` | `{brand}_cfg.dim_category_lvl1`(enabled=true) + `{brand}_cfg.dim_category_lvl2`(enabled=true) | — | **查询** |
| 44 | `list_rule_groups` | `GET /api/rule-groups` | `ops.rule_groups`(enabled=true) | — | **查询** |
| 45 | `list_rule_files` | `GET /api/rules/files` | `raw.ingest_file`(WHERE brand_code=... AND source_type='bank' AND status='success') | — | **查询** |

### 9. Store Creation 模块 (1个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 46 | `create_store` | `POST /api/admin/stores` | — (验证传入参数) | `ops.stores` + `{brand}_cfg.dim_store` + 可选: `{brand}_cfg.bank_rule_map`(从姐妹店复制快照) | **写入(直接落库)** |

### 10. Audit 模块 (1个工具)

| # | 工具 | API路由 | 读取的表/视图 | 写入的表/动作 | 分类 |
|---|------|---------|--------------|--------------|------|
| 47 | `get_rules_history` | `GET /api/rules/history` | `ops.bank_rule_map_history` | — | **查询** |

---

## 跨库核心表汇总

### `ops` schema (跨品牌运营表)

| 表名 | 用途 | 被哪些工具读 | 被哪些工具写 |
|------|------|-------------|-------------|
| `ops.brands` | 品牌注册 | `get_brand_stores` | — |
| `ops.stores` | 门店注册 | `get_brand_stores` | `create_store` |
| `ops.rule_groups` | 规则分组 | `list_rule_groups` | — |
| `ops.approval_proposal` | 审批提案 | `get_proposal`, `query_approval_status` | `submit_proposal` |
| `ops.bank_rule_map_history` | 规则变更审计 | `get_rules_history` | — |
| `ops.pipeline_run` | 管道运行记录 | — | `rerun_match_by_file` |
| `ops.pipeline_step_run` | 管道步骤记录 | — | `rerun_match_by_file` |

### `raw` schema (文件跟踪)

| 表名 | 用途 | 被哪些工具读 | 被哪些工具写 |
|------|------|-------------|-------------|
| `raw.ingest_file` | 所有上传文件的跟踪记录 | `list_rule_files`, `rerun_match_by_file`, `upload_*`(去重) | `upload_*`(写入新记录) |

### `{brand}_cfg` schema (各品牌配置)

| 表/视图 | 用途 | 被哪些工具读 |
|---------|------|-------------|
| `{brand}_cfg.bank_rule_map` | 分类规则 | `get_rules`, `create_store`(可选复制) |
| `{brand}_cfg.dim_category_lvl1` | lvl1 分类字典 | `get_rules`, `list_categories`, `query_counterparty`, `query_income_metrics`, `query_payment_metrics`, `query_financial_kpi_trend` |
| `{brand}_cfg.dim_category_lvl2` | lvl2 分类字典 | `get_rules`, `list_categories`, `query_income_metrics`, `query_financial_kpi_trend` |
| `{brand}_cfg.dim_store` | 门店维度 | `create_store`(写入) |
| `{brand}_cfg.channel_mapping` | 支付方式→渠道映射 | `get_qimai_entry_rate` |

### `{brand}_ods` schema (各品牌原始数据)

| 表/视图 | 用途 | 被哪些工具读/写 |
|---------|------|----------------|
| `{brand}_ods.bank_txn` | 银行流水原始记录 | `get_unclassified_transactions`, `get_txn_detail`, `get_candidates`, `preview_match`, `get_proposal`, `query_counterparty`, `query_financial_kpi_trend`, `query_approval_status`, `get_qimai_entry_rate` |
| `gelatomiiix_ods.income_detail` | 企迈收入明细(蜜可诗) | `query_gelatomiiix_income`, `get_qimai_entry_rate`, 7个sales查询工具; `upload_gelatomiiix_income_detail`(写入) |
| `bonjur_ods.income_detail` | 企迈收入明细(旺鼎阁) | `query_bonjur_sales_summary`; `upload_bonjur_income_detail`(写入) |
| `bonjur_ods.sales_daily_self_service` | 自助收银日销售 | `query_bonjur_qimai_sales`, `query_bonjur_sales_details`(cash_register); `upload_bonjur_sales_self_service`(写入) |
| `bonjur_ods.product_sales_detail` | 产品销售明细 | `query_bonjur_sales_products`; `upload_bonjur_product_sales`(写入) |
| `brand_tamkoko_ods.inventory_month_end` | 期末库存 | `upload_tamkoko_inventory`(写入) |

### `{brand}_dm` schema (各品牌数据集市)

| 表/视图 | 用途 | 被哪些工具读 |
|---------|------|-------------|
| `{brand}_dm.bank_txn_classified_snapshot` | 预分类快照(BASE TABLE) | `get_unclassified_transactions`, `get_txn_detail`, `get_pipeline_kpi`, `rerun_match_by_file`(刷新), `query_counterparty`, `query_financial_kpi_trend`, `query_financial_overview`, `get_qimai_entry_rate` |
| `{brand}_dm.v_bank_txn_classified` | 分类交易视图 | `preview_match`, `upload_bank_txn_file`(覆盖率统计) |
| `{brand}_dm.v_coverage_by_file` | 按文件覆盖率 | `get_coverage_by_file` |
| `{brand}_dm.v_unclassified_top_by_file` | 未分类交易(按文件) | `get_unclassified_by_file` |
| `{brand}_dm.v_profit_statement` | 利润表(收付实现制) | `query_financial_statement`, `query_financial_overview`, `query_qimai_revenue` |
| `{brand}_dm.v_cashflow_statement` | 现金流量表 | `query_financial_statement`, `query_financial_overview`, `query_income_metrics`, `query_payment_metrics` |
| `{brand}_dm.v_balance_sheet` | 资产负债表 | `query_financial_statement`, `query_financial_overview` |
| `{brand}_dm.v_store_monthly_kpi` | 门店月度KPI | `query_store_report_snapshot`, `query_store_report_trend`, `query_financial_overview`, `query_financial_kpi_trend` |

---

## 按操作类型分布

| 分类 | 工具数 | 工具列表 |
|------|--------|---------|
| **查询(只读)** | 37 | `get_unclassified_transactions`, `get_txn_detail`, `get_candidates`, `get_rules`, `preview_match`, `get_pipeline_kpi`, `get_coverage_by_file`, `get_unclassified_by_file`, `get_proposal`, `query_approval_status`, `query_store_report_snapshot`, `query_store_report_trend`, `query_financial_statement`, `query_financial_overview`, `query_financial_kpi_trend`, `query_counterparty`, `query_income_metrics`, `query_payment_metrics`, `query_qimai_revenue`, `query_gelatomiiix_income`, `get_qimai_entry_rate`, `query_bonjur_qimai_sales`, `query_bonjur_sales_summary`, `query_bonjur_sales_products`, `query_bonjur_sales_details`, 7个gelatomiiix sales查询, `get_brand_stores`, `list_categories`, `list_rule_groups`, `list_rule_files`, `get_rules_history` |
| **导入(写ODS)** | 7 | `upload_bank_txn_file`, `upload_gelatomiiix_income_detail`, `upload_bonjur_income_detail`, `upload_bonjur_product_sales`, `upload_bonjur_sales_self_service`, `upload_tamkoko_inventory` |
| **写入(提案)** | 1 | `submit_proposal`(写审批队列) |
| **写入(snapshot刷新)** | 1 | `rerun_match_by_file`(调用Postgres函数) |
| **写入(直接落库)** | 1 | `create_store`(写ops.stores + cfg.dim_store) |

---

*生成日期: 2026-06-14*
