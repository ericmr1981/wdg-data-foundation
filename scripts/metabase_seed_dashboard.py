#!/usr/bin/env python3
"""Seed Metabase Questions/Dashboards via API key (X-Api-Key).

Usage:
  export METABASE_URL=http://localhost:3001
  export METABASE_API_KEY='...'
  python3 scripts/metabase_seed_dashboard.py

Notes:
- Idempotent by *name* for Cards (Questions): create-or-update.
- Do NOT hardcode secrets; use env vars.
"""

import os
import sys
import json
from typing import Optional

import requests

MB_URL = os.environ.get("METABASE_URL", "http://localhost:3001").rstrip("/")
MB_KEY = os.environ.get("METABASE_API_KEY")

HEADERS = {
    "X-Api-Key": MB_KEY or "",
    "Content-Type": "application/json",
}


def die(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def mb_get(path: str, *, params: Optional[dict] = None):
    r = requests.get(MB_URL + path, headers=HEADERS, params=params, timeout=20)
    if r.status_code >= 400:
        raise RuntimeError(f"GET {path} -> {r.status_code}: {r.text[:500]}")
    return r


def mb_post(path: str, payload: dict):
    r = requests.post(MB_URL + path, headers=HEADERS, data=json.dumps(payload), timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"POST {path} -> {r.status_code}: {r.text[:500]}")
    return r


def mb_put(path: str, payload: dict):
    r = requests.put(MB_URL + path, headers=HEADERS, data=json.dumps(payload), timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"PUT {path} -> {r.status_code}: {r.text[:500]}")
    return r


def find_database_id(name_hint: str = "dataplatform") -> int:
    dbs = mb_get("/api/database").json()
    items = dbs.get("data") if isinstance(dbs, dict) else dbs
    if not items:
        die("No databases found in Metabase")

    hint = name_hint.lower()
    for d in items:
        n = (d.get("name") or "").lower()
        if hint in n:
            return int(d["id"])

    return int(items[0]["id"])


def search_card_by_name(name: str) -> Optional[dict]:
    raw = mb_get("/api/search", params={"q": name, "models": "card"}).json()

    # Metabase may return either a list or an object {data:[...]}
    res = raw.get("data") if isinstance(raw, dict) else raw
    if not isinstance(res, list):
        return None

    for it in res:
        if isinstance(it, dict) and it.get("model") == "card" and it.get("name") == name:
            return it

    for it in res:
        if isinstance(it, dict) and it.get("model") == "card" and (it.get("name") or "").lower() == name.lower():
            return it

    return None


# Stable parameter UUIDs (so dashboard mappings stay consistent)
PARAM_MONTH_DATE = "00000000-0000-0000-0000-000000000001"
PARAM_STORE = "00000000-0000-0000-0000-000000000002"
PARAM_EXP_LVL1 = "00000000-0000-0000-0000-000000000003"
PARAM_INC_LVL1 = "00000000-0000-0000-0000-000000000004"


def upsert_card(
    *,
    name: str,
    database_id: int,
    sql: str,
    description: str = "",
    display: str = "table",
    visualization_settings: Optional[dict] = None,
    with_expense_lvl1: bool = False,
    with_income_lvl1: bool = False,
) -> int:
    existing = search_card_by_name(name)

    template_tags = {
        "month_date": {
            "id": PARAM_MONTH_DATE,
            "name": "month_date",
            "display-name": "Month",
            "type": "date",
        },
        "store_code": {
            "id": PARAM_STORE,
            "name": "store_code",
            "display-name": "Store Code",
            "type": "text",
        },
    }

    params = [
        {
            "id": PARAM_MONTH_DATE,
            "type": "date/single",  # Metabase v0.5x+: date/= 已废弃
            "name": "Month",
            "slug": "month_date",
            "target": ["variable", ["template-tag", "month_date"]],
        },
        {
            "id": PARAM_STORE,
            "type": "string/=",
            "name": "Store Code",
            "slug": "store_code",
            "target": ["variable", ["template-tag", "store_code"]],
        },
    ]

    if with_expense_lvl1:
        template_tags["expense_lvl1"] = {
            "id": PARAM_EXP_LVL1,
            "name": "expense_lvl1",
            "display-name": "Expense Lvl1",
            "type": "text",
        }
        params.append(
            {
                "id": PARAM_EXP_LVL1,
                "type": "string/=",
                "name": "Expense Lvl1",
                "slug": "expense_lvl1",
                "target": ["variable", ["template-tag", "expense_lvl1"]],
            }
        )

    if with_income_lvl1:
        template_tags["income_lvl1"] = {
            "id": PARAM_INC_LVL1,
            "name": "income_lvl1",
            "display-name": "Income Lvl1",
            "type": "text",
        }
        params.append(
            {
                "id": PARAM_INC_LVL1,
                "type": "string/=",
                "name": "Income Lvl1",
                "slug": "income_lvl1",
                "target": ["variable", ["template-tag", "income_lvl1"]],
            }
        )

    payload = {
        "name": name,
        "description": description,
        "display": display,
        "visualization_settings": visualization_settings or {},
        "dataset_query": {
            "database": database_id,
            "type": "native",
            "native": {
                "query": sql,
                "template-tags": template_tags,
            },
        },
        "parameters": params,
    }

    if existing and existing.get("id"):
        card_id = int(existing["id"])
        mb_put(f"/api/card/{card_id}", payload)
        return card_id

    created = mb_post("/api/card", payload).json()
    return int(created["id"])


def main():
    if not MB_KEY:
        die("METABASE_API_KEY is required")

    # Sanity check
    me = mb_get("/api/user/current").json()
    if not me.get("is_superuser"):
        print("WARN: api key user is not superuser; may lack permissions")

    db_id = find_database_id("dataplatform")

    # (1) 收支总揽（表）- 增加 expense_lvl1 字段用于 Dashboard 点击联动
    sql_cashflow_overview = r"""WITH base AS (
  SELECT
    to_char(t.txn_time, 'YYYY-MM') AS month,
    t.store_code,
    c.lvl1,
    COALESCE(t.in_amt, 0)  AS in_amt,
    COALESCE(t.out_amt, 0) AS out_amt
  FROM yufeng_ods.bank_txn t
  JOIN yufeng_dm.v_bank_txn_classified c
    ON c.bank_txn_id = t.id
  WHERE t.txn_time IS NOT NULL
  [[ AND date_trunc('month', t.txn_time)::date = {{month_date}} ]]
  [[ AND t.store_code = {{store_code}} ]]
),
profit_agg AS (
  SELECT
    COALESCE(SUM(p.bank_revenue_amt), 0) AS in_biz,
    COALESCE(SUM(p.total_expense_amt), 0) AS total_out,
    COALESCE(SUM(p.profit_amt), 0) AS profit_amt,
    COALESCE(SUM(p.material_purchase_amt), 0) AS material_purchase_amt,
    (COALESCE(SUM(p.bank_revenue_amt), 0) - COALESCE(SUM(p.material_purchase_amt), 0)) / NULLIF(COALESCE(SUM(p.bank_revenue_amt), 0), 0) AS gross_margin_rate
  FROM yufeng_dm.profit_monthly p
  WHERE 1=1
  [[ AND p.month = {{month_date}} ]]
  [[ AND p.store_code = {{store_code}} ]]
),
agg AS (
  SELECT
    COALESCE(SUM(in_amt)  FILTER (WHERE in_amt  > 0), 0) AS total_in,

    -- 来自 profit_monthly（单行），这里用 MAX() 避免与 base 的聚合冲突
    MAX(profit_agg.total_out)  AS total_out,

    -- 这里“营业收入”以 yufeng_dm.profit_monthly 口径为准（REV_BIZ）
    MAX(profit_agg.in_biz) AS in_biz,

    COALESCE(SUM(in_amt)  FILTER (WHERE in_amt  > 0 AND lvl1='其他收入'), 0) AS in_other,

    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='人力'), 0) AS out_hr,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='租金物业'), 0) AS out_rent,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='运费'), 0) AS out_ship,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='管理费用'), 0) AS out_admin,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='材料采购'), 0) AS out_material,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='营建费用'), 0) AS out_build,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='营销费用'), 0) AS out_mkt,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='其他费用'), 0) AS out_otherexp,
    COALESCE(SUM(out_amt) FILTER (WHERE out_amt > 0 AND lvl1='未分类'), 0) AS out_unclassified,

    MAX(profit_agg.profit_amt) AS profit_amt,
    MAX(profit_agg.gross_margin_rate) AS gross_margin_rate
  FROM base, profit_agg
),
rows AS (
  -- 收入总计：不展示占比
  SELECT 10 AS ord, '收入' AS section, '银行总收入' AS item, total_in AS amt, NULL::numeric AS ratio, NULL::text AS expense_lvl1, NULL::text AS income_lvl1 FROM agg
  UNION ALL SELECT 11,'收入','营业收入', in_biz,   COALESCE(in_biz/NULLIF(total_in,0), 0), NULL, '营业收入' FROM agg
  UNION ALL SELECT 12,'收入','其他收入', in_other, COALESCE(in_other/NULLIF(total_in,0), 0), NULL, '其他收入' FROM agg

  -- 支出总计：不展示占比
  UNION ALL SELECT 20,'支出','支出总金额', total_out, NULL::numeric, NULL::text, NULL::text FROM agg
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

    card_overview_name = "Yufeng｜收支总揽（表）"
    card_overview_id = upsert_card(
        name=card_overview_name,
        database_id=db_id,
        sql=sql_cashflow_overview,
        description="收支总揽（按 month/store_code 可筛选）。含 expense_lvl1/income_lvl1 字段用于 Dashboard 联动。",
        display="table",
        with_expense_lvl1=True,
        with_income_lvl1=True,
    )

    # (2) 支出一级分类（饼图）
    sql_expense_lvl1 = r"""SELECT
  c.lvl1 AS "类别",
  SUM(COALESCE(t.out_amt,0)) AS "金额(元)"
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt,0) > 0
  [[ AND date_trunc('month', t.txn_time)::date = {{month_date}} ]]
  [[ AND t.store_code = {{store_code}} ]]
GROUP BY c.lvl1
ORDER BY "金额(元)" DESC;"""

    card_pie1_name = "Yufeng｜支出一级分类（饼图）"
    card_pie1_id = upsert_card(
        name=card_pie1_name,
        database_id=db_id,
        sql=sql_expense_lvl1,
        description="支出一级分类饼图（类别+金额）。",
        display="pie",
        visualization_settings={"pie.show_values": True, "pie.value_formatting": "currency"},
        with_expense_lvl1=False,
    )

    # (3) 支出二级分类（饼图，可被 expense_lvl1 过滤；空时显示全部二级）
    sql_expense_lvl2 = r"""SELECT
  COALESCE(NULLIF(c.lvl2,''), '（未填）') AS "类别",
  SUM(COALESCE(t.out_amt,0)) AS "金额(元)"
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt,0) > 0
  [[ AND date_trunc('month', t.txn_time)::date = {{month_date}} ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND c.lvl1 = {{expense_lvl1}} ]]
GROUP BY COALESCE(NULLIF(c.lvl2,''), '（未填）')
ORDER BY "金额(元)" DESC;"""

    card_pie2_name = "Yufeng｜支出二级分类（饼图）"
    card_pie2_id = upsert_card(
        name=card_pie2_name,
        database_id=db_id,
        sql=sql_expense_lvl2,
        description="支出二级分类饼图（类别+金额）；可被 expense_lvl1 过滤，空时显示全部。",
        display="pie",
        visualization_settings={"pie.show_values": True, "pie.value_formatting": "currency"},
        with_expense_lvl1=True,
    )

    # (4) 收入二级分类（柱状图，可被 income_lvl1 过滤；空时显示全部二级）
    sql_income_lvl2_bar = r"""SELECT
  COALESCE(NULLIF(c.lvl2,''), '（未填）') AS "类别",
  SUM(COALESCE(t.in_amt,0)) AS "金额(元)"
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.in_amt,0) > 0
  [[ AND date_trunc('month', t.txn_time)::date = {{month_date}} ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND c.lvl1 = {{income_lvl1}} ]]
GROUP BY COALESCE(NULLIF(c.lvl2,''), '（未填）')
ORDER BY "金额(元)" DESC;"""

    card_bar_name = "Yufeng｜收入二级分类（柱状图）"
    card_bar_id = upsert_card(
        name=card_bar_name,
        database_id=db_id,
        sql=sql_income_lvl2_bar,
        description="收入二级分类柱状图（类别+金额）；可被 income_lvl1 过滤（营业收入/其他收入），空时显示全部。",
        display="bar",
        visualization_settings={"graph.show_values": True, "graph.value_formatting": "currency"},
        with_income_lvl1=True,
    )

    print("OK")
    for name, cid in [
        (card_overview_name, card_overview_id),
        (card_pie1_name, card_pie1_id),
        (card_pie2_name, card_pie2_id),
        (card_bar_name, card_bar_id),
    ]:
        print(f"Card: {name} (id={cid}) -> {MB_URL}/question/{cid}")


if __name__ == "__main__":
    main()
