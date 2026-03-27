#!/usr/bin/env python3
"""Seed Metabase Questions + Dashboard for Bonjur (对标榆枫经营看板).

Usage:
  export METABASE_URL=http://127.0.0.1:8082
  export METABASE_API_KEY='...'
  python3 scripts/metabase_seed_bonjur_ops_dashboard.py

Notes
- Reuses the helper functions/constants from scripts/metabase_seed_dashboard.py
- Idempotent by *name*.
"""

from __future__ import annotations

import os
import sys
from typing import Optional

# Allow importing helper module from this directory.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

import metabase_seed_dashboard as mb  # noqa: E402


def main() -> None:
    db_id = mb.find_database_id("dataplatform")

    dash_name = "Bonjur｜经营看板（对标榆枫）"
    dash_desc = "Bonjur：对标榆枫的经营看板（收支总览 + 分类 + 趋势 + 明细下钻）。"

    # -----------------
    # Cards (Questions)
    # -----------------

    # Card: 收支总揽（表）
    sql_card40 = r"""WITH base AS (
  SELECT
    to_char(t.txn_time, 'YYYY-MM') AS month,
    t.store_code,
    c.lvl1_code,
    COALESCE(c.lvl1_name, '（未分类）') AS lvl1_name,
    c.classified_source,
    COALESCE(t.in_amt, 0)  AS in_amt,
    COALESCE(t.out_amt, 0) AS out_amt
  FROM bonjur_ods.bank_txn t
  LEFT JOIN bonjur_dm.v_bank_txn_classified c
    ON c.bank_txn_id = t.id
  WHERE t.txn_time IS NOT NULL
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
),
agg AS (
  SELECT
    COALESCE(SUM(in_amt)  FILTER (WHERE in_amt  > 0), 0) AS total_in,

    -- 支出总金额：不含营建（用于利润口径，对标榆枫）
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND (lvl1_code IS DISTINCT FROM 'BUILD')), 0) AS total_out,

    -- 营业收入（银行口径：REV_BIZ）
    COALESCE(SUM(in_amt)  FILTER (WHERE in_amt  > 0 AND lvl1_code = 'REV_BIZ'), 0) AS in_biz,

    -- 当月现金流（收入总额 - 支出总额，支出含营建更符合现金流）
    (COALESCE(SUM(in_amt)  FILTER (WHERE in_amt  > 0), 0)
     - COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0), 0)) AS cashflow_amt,

    COALESCE(SUM(in_amt)  FILTER (WHERE in_amt  > 0 AND lvl1_name='其他收入'), 0) AS in_other,

    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='人力'), 0) AS out_hr,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='租金物业'), 0) AS out_rent,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='运费'), 0) AS out_ship,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='管理费用'), 0) AS out_admin,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='材料采购'), 0) AS out_material,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='营建费用'), 0) AS out_build,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='营销费用'), 0) AS out_mkt,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_name='其他费用'), 0) AS out_otherexp,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND classified_source='unclassified'), 0) AS out_unclassified,

    -- 利润：营业收入（REV_BIZ）- 支出（不含营建）
    (COALESCE(SUM(in_amt) FILTER (WHERE in_amt > 0 AND lvl1_code = 'REV_BIZ'), 0)
     - COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND (lvl1_code IS DISTINCT FROM 'BUILD')), 0)) AS profit_amt,

    -- 毛利率： (营业收入 - 材料采购) / 营业收入
    (COALESCE(SUM(in_amt) FILTER (WHERE in_amt > 0 AND lvl1_code = 'REV_BIZ'), 0)
     - COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1_code = 'MATERIAL'), 0))
     / NULLIF(COALESCE(SUM(in_amt) FILTER (WHERE in_amt > 0 AND lvl1_code = 'REV_BIZ'), 0), 0) AS gross_margin_rate
  FROM base
),
rows AS (
  -- 收入总计：不展示占比
  SELECT 10 AS ord, '收入' AS section, '银行总收入' AS item, total_in AS amt, NULL::numeric AS ratio, NULL::text AS expense_lvl1, NULL::text AS income_lvl1 FROM agg
  UNION ALL SELECT 11,'收入','营业收入', in_biz,   COALESCE(in_biz/NULLIF(total_in,0), 0), NULL, '营业收入' FROM agg
  UNION ALL SELECT 12,'收入','其他收入', in_other, COALESCE(in_other/NULLIF(total_in,0), 0), NULL, '其他收入' FROM agg

  -- 支出总计：不展示占比
  UNION ALL SELECT 20,'支出','支出总金额(不含营建)', total_out, NULL::numeric, NULL::text, NULL::text FROM agg
  UNION ALL SELECT 21,'支出','人力',     out_hr,          COALESCE(out_hr/NULLIF(total_out,0), 0), '人力', NULL FROM agg
  UNION ALL SELECT 22,'支出','租金物业', out_rent,        COALESCE(out_rent/NULLIF(total_out,0), 0), '租金物业', NULL FROM agg
  UNION ALL SELECT 23,'支出','运费',     out_ship,        COALESCE(out_ship/NULLIF(total_out,0), 0), '运费', NULL FROM agg
  UNION ALL SELECT 24,'支出','管理费用', out_admin,       COALESCE(out_admin/NULLIF(total_out,0), 0), '管理费用', NULL FROM agg
  UNION ALL SELECT 25,'支出','材料采购', out_material,    COALESCE(out_material/NULLIF(total_out,0), 0), '材料采购', NULL FROM agg
  UNION ALL SELECT 26,'支出','营建费用', out_build,       COALESCE(out_build/NULLIF(total_out,0), 0), '营建费用', NULL FROM agg
  UNION ALL SELECT 27,'支出','营销费用', out_mkt,         COALESCE(out_mkt/NULLIF(total_out,0), 0), '营销费用', NULL FROM agg
  UNION ALL SELECT 28,'支出','其他费用', out_otherexp,    COALESCE(out_otherexp/NULLIF(total_out,0), 0), '其他费用', NULL FROM agg
  UNION ALL SELECT 29,'支出','未分类',   out_unclassified,COALESCE(out_unclassified/NULLIF(total_out,0), 0), '未分类', NULL FROM agg

  UNION ALL SELECT 30,'结果','利润', profit_amt, NULL, NULL, NULL FROM agg
  UNION ALL SELECT 33,'结果','当月现金流', cashflow_amt, NULL, NULL, NULL FROM agg
  UNION ALL SELECT 31,'结果','利润率', profit_amt/NULLIF(in_biz,0), NULL, NULL, NULL FROM agg
  UNION ALL SELECT 32,'结果','毛利率', gross_margin_rate, NULL, NULL, NULL FROM agg
)
SELECT
  section,
  item,
  ROUND(amt, 2) AS "金额(元)",
  CASE WHEN ratio IS NULL THEN NULL ELSE (to_char(ROUND(ratio * 100.0, 2), 'FM999990D00') || '%') END AS "占比(%)",
  expense_lvl1,
  income_lvl1
FROM rows
ORDER BY ord;"""

    card40_id = mb.upsert_card(
        name="Bonjur｜收支总揽（表）",
        database_id=db_id,
        sql=sql_card40,
        description="收支总揽（按 Month/Store 可筛选）。含利润/利润率/毛利率/当月现金流。",
        display="table",
        template_tags={
            "month_date": {"id": mb.PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card: 支出一级分类（饼图）
    sql_41 = r"""SELECT
  COALESCE(c.lvl1_name, '（未分类）') AS "一级分类",
  ROUND(SUM(COALESCE(t.out_amt, 0)), 2) AS "金额(元)"
FROM bonjur_ods.bank_txn t
LEFT JOIN bonjur_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt, 0) > 0
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
GROUP BY 1
ORDER BY 2 DESC;"""

    card41_id = mb.upsert_card(
        name="Bonjur｜支出一级分类（饼图）",
        database_id=db_id,
        sql=sql_41,
        description="支出一级分类占比；支持 Month/Store Code 筛选。",
        display="pie",
        visualization_settings={"pie.show_legend": True, "pie.percent_visibility": "legend"},
        template_tags={
            "month_date": {"id": mb.PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card: 支出二级分类（饼图）
    sql_42 = r"""SELECT
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2_code),''), '（未填）') AS "二级分类",
  ROUND(SUM(COALESCE(t.out_amt, 0)), 2) AS "金额(元)"
FROM bonjur_ods.bank_txn t
LEFT JOIN bonjur_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt, 0) > 0
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, '（未分类）') = {{expense_lvl1}} ]]
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;"""

    card42_id = mb.upsert_card(
        name="Bonjur｜支出二级分类（饼图）",
        database_id=db_id,
        sql=sql_42,
        description="支出二级分类占比（可按支出一级筛选）。",
        display="pie",
        visualization_settings={"pie.show_legend": True, "pie.percent_visibility": "legend"},
        template_tags={
            "month_date": {"id": mb.PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "expense_lvl1": {"id": mb.TAG_EXP_LVL1, "name": "expense_lvl1", "display-name": "Expense Lvl1", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": mb.TAG_EXP_LVL1, "type": "string/=", "name": "Expense Lvl1", "slug": "expense_lvl1", "target": ["variable", ["template-tag", "expense_lvl1"]]},
        ],
    )

    # Card: 收入二级分类（柱状图）
    sql_43 = r"""SELECT
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2_code),''), '（未填）') AS "二级分类",
  ROUND(SUM(COALESCE(t.in_amt, 0)), 2) AS "金额(元)"
FROM bonjur_ods.bank_txn t
LEFT JOIN bonjur_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.in_amt, 0) > 0
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, '（未分类）') = {{income_lvl1}} ]]
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;"""

    card43_id = mb.upsert_card(
        name="Bonjur｜收入二级分类（柱状图）",
        database_id=db_id,
        sql=sql_43,
        description="收入二级分类金额（可按收入一级筛选）。",
        display="bar",
        visualization_settings={"graph.show_values": True, "graph.value_formatting": "currency"},
        template_tags={
            "month_date": {"id": mb.PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "income_lvl1": {"id": mb.TAG_INC_LVL1, "name": "income_lvl1", "display-name": "Income Lvl1", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": mb.TAG_INC_LVL1, "type": "string/=", "name": "Income Lvl1", "slug": "income_lvl1", "target": ["variable", ["template-tag", "income_lvl1"]]},
        ],
    )

    # Card: 营业收入 vs 支出（不含营建）
    sql_45 = r"""WITH base AS (
  SELECT
    date_trunc('month', t.txn_time)::date AS month,
    COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN COALESCE(t.in_amt,0) ELSE 0 END), 0) AS biz_revenue_amt,
    COALESCE(SUM(
      CASE
        WHEN COALESCE(t.out_amt,0) > 0
         AND (c.lvl1_code IS DISTINCT FROM 'BUILD')
        THEN COALESCE(t.out_amt,0)
        ELSE 0
      END
    ), 0) AS expense_ex_build_amt
  FROM bonjur_ods.bank_txn t
  LEFT JOIN bonjur_dm.v_bank_txn_classified c
    ON c.bank_txn_id = t.id
  WHERE t.txn_time IS NOT NULL
    [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
       AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
    [[ AND t.store_code = {{store_code}} ]]
  GROUP BY 1
)
SELECT
  month AS "月份",
  ROUND(biz_revenue_amt, 2) AS "营业收入(元)",
  ROUND(expense_ex_build_amt, 2) AS "支出不含营建(元)"
FROM base
ORDER BY month;"""

    card45_id = mb.upsert_card(
        name="Bonjur｜营业收入 vs 支出（不含营建）",
        database_id=db_id,
        sql=sql_45,
        description="按月对比：营业收入 vs 支出（剔除营建费用 BUILD）。支持 Month/Store Code 筛选。",
        display="bar",
        visualization_settings={"graph.show_values": True, "graph.value_formatting": "currency"},
        template_tags={
            "month_date": {"id": mb.PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card: 支出一级分类趋势（多线图）
    sql_46 = r"""SELECT
  date_trunc('month', t.txn_time)::date AS "月份",
  COALESCE(c.lvl1_name, '（未分类）') AS "一级分类",
  ROUND(SUM(COALESCE(t.out_amt, 0)), 2) AS "金额(元)"
FROM bonjur_ods.bank_txn t
LEFT JOIN bonjur_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt, 0) > 0
  [[ AND t.store_code = {{store_code}} ]]
GROUP BY 1, 2
ORDER BY 1, 2;"""

    card46_id = mb.upsert_card(
        name="Bonjur｜支出一级分类趋势（多线图）",
        database_id=db_id,
        sql=sql_46,
        description="支出的一级分类按月趋势（多线图）；支持 Store 筛选。",
        display="line",
        visualization_settings={
            "graph.show_values": True,
            "graph.value_formatting": "currency",
            # multi-series by 一级分类
            "graph.dimensions": ["月份", "一级分类"],
            "graph.metrics": ["金额(元)"],
        },
        template_tags={
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card: 支出明细（下钻）
    sql_47 = r"""SELECT
  t.txn_time AS "时间",
  t.store_code AS "门店",
  COALESCE(c.lvl1_name, '（未分类）') AS "支出一级",
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2_code),''), '（未填）') AS "支出二级",
  t.counterparty_name AS "对方单位",
  t.summary AS "摘要",
  t.memo AS "附言",
  t.purpose AS "用途",
  ROUND(COALESCE(t.out_amt,0), 2) AS "支出(元)",
  t.id AS "bank_txn_id",
  t.source_file_id,
  c.matched_rule_id,
  c.classified_source
FROM bonjur_ods.bank_txn t
JOIN bonjur_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt,0) > 0
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, '（未分类）') = {{expense_lvl1}} ]]
  [[ AND COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2_code),''), '（未填）') = {{expense_lvl2}} ]]
  [[ AND (
        COALESCE(t.counterparty_name,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.summary,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.memo,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.purpose,'') ILIKE '%' || {{keyword}} || '%'
  ) ]]
ORDER BY COALESCE(t.out_amt,0) DESC, t.txn_time DESC
LIMIT 2000;"""

    card47_id = mb.upsert_card(
        name="Bonjur｜支出明细（下钻）",
        database_id=db_id,
        sql=sql_47,
        description="用于下钻查看支出明细：按月/门店/支出一级/支出二级/关键词筛选；按金额倒序。",
        display="table",
        template_tags={
            "month_date": {"id": mb.PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "expense_lvl1": {"id": mb.TAG_EXP_LVL1, "name": "expense_lvl1", "display-name": "Expense Lvl1", "type": "text"},
            "expense_lvl2": {"id": mb.TAG_EXP_LVL2, "name": "expense_lvl2", "display-name": "Expense Lvl2", "type": "text"},
            "keyword": {"id": mb.TAG_KEYWORD, "name": "keyword", "display-name": "Keyword", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": mb.TAG_EXP_LVL1, "type": "string/=", "name": "Expense Lvl1", "slug": "expense_lvl1", "target": ["variable", ["template-tag", "expense_lvl1"]]},
            {"id": mb.TAG_EXP_LVL2, "type": "string/=", "name": "Expense Lvl2", "slug": "expense_lvl2", "target": ["variable", ["template-tag", "expense_lvl2"]]},
            {"id": mb.TAG_KEYWORD, "type": "string/contains", "name": "Keyword", "slug": "keyword", "target": ["variable", ["template-tag", "keyword"]]},
        ],
    )

    # Card: 收入明细（下钻）
    sql_48 = r"""SELECT
  t.txn_time AS "时间",
  t.store_code AS "门店",
  COALESCE(c.lvl1_name, '（未分类）') AS "收入一级",
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2_code),''), '（未填）') AS "收入二级",
  t.counterparty_name AS "对方单位",
  t.summary AS "摘要",
  t.memo AS "附言",
  t.purpose AS "用途",
  ROUND(COALESCE(t.in_amt,0), 2) AS "收入(元)",
  t.id AS "bank_txn_id",
  t.source_file_id,
  c.matched_rule_id,
  c.classified_source
FROM bonjur_ods.bank_txn t
JOIN bonjur_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.in_amt,0) > 0
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, '（未分类）') = {{income_lvl1}} ]]
  [[ AND COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2_code),''), '（未填）') = {{income_lvl2}} ]]
  [[ AND (
        COALESCE(t.counterparty_name,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.summary,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.memo,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.purpose,'') ILIKE '%' || {{keyword}} || '%'
  ) ]]
ORDER BY COALESCE(t.in_amt,0) DESC, t.txn_time DESC
LIMIT 2000;"""

    card48_id = mb.upsert_card(
        name="Bonjur｜收入明细（下钻）",
        database_id=db_id,
        sql=sql_48,
        description="用于下钻查看收入明细：按月/门店/收入一级/收入二级/关键词筛选；按金额倒序。",
        display="table",
        template_tags={
            "month_date": {"id": mb.PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": mb.PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "income_lvl1": {"id": mb.TAG_INC_LVL1, "name": "income_lvl1", "display-name": "Income Lvl1", "type": "text"},
            "income_lvl2": {"id": mb.TAG_INC_LVL2, "name": "income_lvl2", "display-name": "Income Lvl2", "type": "text"},
            "keyword": {"id": mb.TAG_KEYWORD, "name": "keyword", "display-name": "Keyword", "type": "text"},
        },
        parameters=[
            {"id": mb.PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": mb.PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": mb.TAG_INC_LVL1, "type": "string/=", "name": "Income Lvl1", "slug": "income_lvl1", "target": ["variable", ["template-tag", "income_lvl1"]]},
            {"id": mb.TAG_INC_LVL2, "type": "string/=", "name": "Income Lvl2", "slug": "income_lvl2", "target": ["variable", ["template-tag", "income_lvl2"]]},
            {"id": mb.TAG_KEYWORD, "type": "string/contains", "name": "Keyword", "slug": "keyword", "target": ["variable", ["template-tag", "keyword"]]},
        ],
    )

    # -----------------
    # Dashboard
    # -----------------

    # Reuse the same dashboard filter schema as the Yufeng dashboard.
    dash_params = [
        {"id": mb.PID_MONTH, "name": "Month", "slug": "month_date", "type": "date/month-year", "sectionId": "date", "required": False},
        {"id": mb.PID_STORE, "name": "Store Code", "slug": "store_code", "type": "string/=", "sectionId": "string", "required": False},
        {
            "id": mb.PID_EXP_LVL1,
            "name": "支出一级",
            "slug": "expense_lvl1",
            "type": "category",
            "sectionId": "string",
            "required": False,
            "values_source_type": "static-list",
            "values_source_config": {
                "values": [
                    ["人力", "人力"],
                    ["租金物业", "租金物业"],
                    ["运费", "运费"],
                    ["管理费用", "管理费用"],
                    ["材料采购", "材料采购"],
                    ["营建费用", "营建费用"],
                    ["营销费用", "营销费用"],
                    ["其他费用", "其他费用"],
                    ["未分类", "未分类"],
                ]
            },
        },
        {
            "id": mb.PID_INC_LVL1,
            "name": "收入一级",
            "slug": "income_lvl1",
            "type": "category",
            "sectionId": "string",
            "required": False,
            "values_source_type": "static-list",
            "values_source_config": {
                "values": [
                    ["营业收入", "营业收入"],
                    ["其他收入", "其他收入"],
                ]
            },
        },
        {
            "id": mb.PID_EXP_LVL2,
            "name": "支出二级",
            "slug": "expense_lvl2",
            "type": "category",
            "sectionId": "string",
            "required": False,
            "values_source_type": "static-list",
            "values_source_config": {
                "values": [
                    ["（未填）", "（未填）"],
                    ["工资", "工资"],
                    ["社保公积金", "社保公积金"],
                    ["员工福利", "员工福利"],
                    ["其他人力", "其他人力"],
                    ["租金", "租金"],
                    ["物业费", "物业费"],
                    ["水电燃气", "水电燃气"],
                    ["其他租金物业", "其他租金物业"],
                    ["快递", "快递"],
                    ["同城配送", "同城配送"],
                    ["其他运费", "其他运费"],
                    ["办公", "办公"],
                    ["差旅", "差旅"],
                    ["服务费", "服务费"],
                    ["手续费", "手续费"],
                    ["税费", "税费"],
                    ["其他管理", "其他管理"],
                    ["食材", "食材"],
                    ["包材", "包材"],
                    ["其他采购", "其他采购"],
                    ["工程款", "工程款"],
                    ["施工费", "施工费"],
                    ["装修费", "装修费"],
                    ["设备采购", "设备采购"],
                    ["其他营建", "其他营建"],
                    ["广告费", "广告费"],
                    ["礼品费", "礼品费"],
                    ["推广费", "推广费"],
                    ["营销费", "营销费"],
                    ["其他营销", "其他营销"],
                ]
            },
        },
        {
            "id": mb.PID_INC_LVL2,
            "name": "收入二级",
            "slug": "income_lvl2",
            "type": "category",
            "sectionId": "string",
            "required": False,
            "values_source_type": "static-list",
            "values_source_config": {
                "values": [
                    ["（未填）", "（未填）"],
                    ["美团", "美团"],
                    ["饿了么", "饿了么"],
                    ["抖音", "抖音"],
                    ["京东", "京东"],
                    ["微信/财付通", "微信/财付通"],
                    ["支付宝", "支付宝"],
                    ["其他渠道", "其他渠道"],
                    ["注资", "注资"],
                    ["借款", "借款"],
                    ["贷款", "贷款"],
                    ["利息", "利息"],
                    ["退税", "退税"],
                    ["退款", "退款"],
                ]
            },
        },
        {"id": mb.PID_KEYWORD, "name": "关键词", "slug": "keyword", "type": "string/contains", "sectionId": "string", "required": False},
    ]

    dashcard_specs = [
        {"id": -201, "tab": "概览", "card_id": card40_id, "col": 0, "row": 0, "size_x": 24, "size_y": 8,
         "parameter_mappings": [mb.mp(card40_id, mb.PID_MONTH, "month_date"), mb.mp(card40_id, mb.PID_STORE, "store_code")]},
        {"id": -202, "tab": "概览", "card_id": card41_id, "col": 0, "row": 8, "size_x": 12, "size_y": 8,
         "parameter_mappings": [mb.mp(card41_id, mb.PID_MONTH, "month_date"), mb.mp(card41_id, mb.PID_STORE, "store_code")]},
        {"id": -203, "tab": "概览", "card_id": card42_id, "col": 12, "row": 8, "size_x": 12, "size_y": 8,
         "parameter_mappings": [mb.mp(card42_id, mb.PID_MONTH, "month_date"), mb.mp(card42_id, mb.PID_STORE, "store_code"), mb.mp(card42_id, mb.PID_EXP_LVL1, "expense_lvl1")]},
        {"id": -204, "tab": "概览", "card_id": card43_id, "col": 0, "row": 16, "size_x": 24, "size_y": 8,
         "parameter_mappings": [mb.mp(card43_id, mb.PID_MONTH, "month_date"), mb.mp(card43_id, mb.PID_STORE, "store_code"), mb.mp(card43_id, mb.PID_INC_LVL1, "income_lvl1")]},
        {"id": -205, "tab": "概览", "card_id": card45_id, "col": 0, "row": 24, "size_x": 24, "size_y": 8,
         "parameter_mappings": [mb.mp(card45_id, mb.PID_MONTH, "month_date"), mb.mp(card45_id, mb.PID_STORE, "store_code")]},
        {"id": -206, "tab": "概览", "card_id": card46_id, "col": 0, "row": 32, "size_x": 24, "size_y": 8,
         "parameter_mappings": [mb.mp(card46_id, mb.PID_STORE, "store_code")]},

        # 明细 Tab（下钻）
        {"id": -207, "tab": "明细", "card_id": card47_id, "col": 0, "row": 0, "size_x": 24, "size_y": 12,
         "parameter_mappings": [
             mb.mp(card47_id, mb.PID_MONTH, "month_date"),
             mb.mp(card47_id, mb.PID_STORE, "store_code"),
             mb.mp(card47_id, mb.PID_EXP_LVL1, "expense_lvl1"),
             mb.mp(card47_id, mb.PID_EXP_LVL2, "expense_lvl2"),
             mb.mp(card47_id, mb.PID_KEYWORD, "keyword"),
         ]},
        {"id": -208, "tab": "明细", "card_id": card48_id, "col": 0, "row": 12, "size_x": 24, "size_y": 12,
         "parameter_mappings": [
             mb.mp(card48_id, mb.PID_MONTH, "month_date"),
             mb.mp(card48_id, mb.PID_STORE, "store_code"),
             mb.mp(card48_id, mb.PID_INC_LVL1, "income_lvl1"),
             mb.mp(card48_id, mb.PID_INC_LVL2, "income_lvl2"),
             mb.mp(card48_id, mb.PID_KEYWORD, "keyword"),
         ]},
    ]

    dash_id = mb.upsert_dashboard(
        name=dash_name,
        description=dash_desc,
        parameters=dash_params,
        dashcard_specs=dashcard_specs,
        tabs=None,
    )

    print("DONE")
    print(f"Dashboard: {dash_name} (id={dash_id}) -> {mb.MB_URL}/dashboard/{dash_id}")


if __name__ == "__main__":
    main()
