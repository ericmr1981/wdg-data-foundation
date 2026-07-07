# Tamkoko 收银明细销售报表 (/u/sales/tamkoko)

**日期**: 2026-07-07
**状态**: ✅ 已交付(Plan 1+2+3+4 全部完成)

## 入口

- **主页面**: `/u/sales/tamkoko`(8 section 纵向滚动)
- **上传子页**: `/u/sales/tamkoko/upload`(文件选择 + POST + 错误/成功显示)
- **Nav**:顶部"销售数据"dropdown → "泰柯销售"

## 数据流

```
收银明细表.csv (UTF-8 BOM, 11 列)
       │
       ▼
scripts/import_tamkoko_cash_register.py
       │  (SHA256 去重 + 同订单号 SUM 求净订单 + replace=true 模式)
       ▼
brand_tamkoko_ods.cash_register_order
       │  (UNIQUE (source_file_id, order_no), FK → raw.ingest_file)
       ▼
brand_tamkoko_dm.v_cash_register_*  (7 views + 1 PL/pgSQL function)
       │
       ▼
/api/tamkoko/sales/{overview|channel|dine-takeaway|meal-period|weekday|multi-store|combined}
       │  (Next.js API routes, 薄包装 SELECT)
       ▼
/u/sales/tamkoko/page.tsx
       │  (client component, useEffect + fetch + recharts)
       ▼
浏览器 (顶部 4 KPI + 8 section 图表)
```

## 8 个 section

| # | Section | 数据源 | 可视化 |
|---|---|---|---|
| 1 | 渠道分布(订单来源) | `v_cash_register_channel` | PieChart + 表格 |
| 2 | 堂食 vs 外卖 | `v_cash_register_dine_takeaway` | BarChart |
| 3 | 按餐段(早/午/晚市) | `v_cash_register_meal_period_overview` | BarChart |
| 4 | 按星期几 | `v_cash_register_weekday` | BarChart(0=日 ... 6=六) |
| 5 | 多门店对比 | `v_cash_register_multi_store` | 表格(带 gross_rank_in_month) |
| 6 | 多维组合 | `fn_cash_register_combined` | 2 维度 select + 表格 |
| 7 | 收益率与客单价 | overview 派生字段 | 3 stat 卡 |
| 8 | 优惠分析 | overview 派生字段 | 3 stat 卡 |

## 关键 KPI(顶部 4 卡)

- **营业额** = SUM(gross_amt)
- **营业收入** = SUM(revenue_amt)
- **实收率** = SUM(revenue) / SUM(gross)(显示为百分比)
- **订单数** = COUNT(*)

## 派生指标(其他 section)

- **营业净收** = SUM(net_amt)
- **收益率** = SUM(net_amt) / SUM(gross_amt)
- **客单价** = SUM(gross_amt) / order_cnt
- **折扣率** = SUM(discount_amt) / SUM(gross_amt)
- **环比 (MoM%)** = (current - prev) / prev × 100

## MCP 工具(同 API)

`ui/src/mcp/tools/` 下 8 个工具:

- `upload_tamkoko_cash_register`
- `query_tamkoko_sales_overview`
- `query_tamkoko_sales_channel`
- `query_tamkoko_sales_dine_takeaway`
- `query_tamkoko_sales_meal_period`
- `query_tamkoko_sales_weekday`
- `query_tamkoko_sales_multi_store`
- `query_tamkoko_sales_combined`

通过 `/api/mcp` JSON-RPC 暴露。

## 已知 issues(项目级,Plan 1+2+3+4 范围外)

- 其他 tamkoko 测试文件(`tests/test_import_tamkoko_inventory.py`, `tests/test_import_tamkoko_income_detail.py`)也有 module-level `os.environ["DB_PASSWORD"]` bug —— 修法同 Plan 3 Task 3(`_get_db_config()` 函数)
- `pytest.mark.integration` 未在 pytest.ini 注册 —— PytestUnknownMarkWarning
- `cd ui && npm run lint` 弹交互式 prompt(没有 .eslintrc)

## 计划文档

- **Spec**: `docs/superpowers/specs/2026-07-06-tamkoko-cash-register-design.md`
- **Plans**:
  - Plan 1: `docs/superpowers/plans/2026-07-06-tamkoko-cash-register-pipeline.md`
  - Plan 2: `docs/superpowers/plans/2026-07-06-tamkoko-cash-register-dm-views.md`
  - Plan 3: `docs/superpowers/plans/2026-07-06-tamkoko-cash-register-api-mcp.md`
  - Plan 4: `docs/superpowers/plans/2026-07-06-tamkoko-cash-register-ui.md`
