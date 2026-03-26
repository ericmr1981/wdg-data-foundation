#!/usr/bin/env python3
"""Seed Metabase Questions + Dashboard for 榆枫与山 via API key (X-Api-Key).

Usage:
  # Option A (recommended): API key
  export METABASE_URL=http://127.0.0.1:8082
  export METABASE_API_KEY='...'
  python3 scripts/metabase_seed_dashboard.py

  # Option B (local/dev): username + password (script will create a session)
  export METABASE_URL=http://localhost:3001
  export METABASE_USER='demo@metabase.com'
  export METABASE_PASSWORD='demo123456'
  python3 scripts/metabase_seed_dashboard.py

Design goals
- Idempotent by *name* for Cards and Dashboard.
- Keep LOCAL and VPS consistent by making Metabase artifacts reproducible.
- Metabase v0.59+ compatible (dataset_query uses `stages` + `lib/type`).

Notes
- Do NOT hardcode secrets; use env vars.
- Dashboards in this instance require `dashcards[].id` when PUT updating.
  New dashcards can use negative temporary ids.
"""

import os
import sys
import json
from typing import Optional, Any

import requests

MB_URL = os.environ.get("METABASE_URL", "http://localhost:3000").rstrip("/")
MB_KEY = os.environ.get("METABASE_API_KEY")
MB_USER = os.environ.get("METABASE_USER")
MB_PASSWORD = os.environ.get("METABASE_PASSWORD")


def build_headers() -> dict:
    base = {"Content-Type": "application/json"}

    # Prefer API key when available.
    if MB_KEY:
        return {**base, "X-Api-Key": MB_KEY}

    # Fall back to session auth (local/dev convenience).
    user = MB_USER
    pwd = MB_PASSWORD

    # Safe default only for localhost dev.
    if not user and (MB_URL.startswith("http://localhost") or MB_URL.startswith("http://127.0.0.1")):
        user = "demo@metabase.com"
        pwd = pwd or "demo123456"

    if not user or not pwd:
        die("METABASE_API_KEY or METABASE_USER/METABASE_PASSWORD is required")

    r = requests.post(
        MB_URL + "/api/session",
        headers=base,
        data=json.dumps({"username": user, "password": pwd}),
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"POST /api/session -> {r.status_code}: {r.text[:800]}")

    sid = (r.json() or {}).get("id")
    if not sid:
        raise RuntimeError("Metabase /api/session did not return session id")

    return {**base, "X-Metabase-Session": sid}


HEADERS = build_headers()


def die(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def mb_get(path: str, *, params: Optional[dict] = None) -> Any:
    r = requests.get(MB_URL + path, headers=HEADERS, params=params, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"GET {path} -> {r.status_code}: {r.text[:800]}")
    return r.json() if r.text else None


def mb_post(path: str, payload: dict) -> Any:
    r = requests.post(MB_URL + path, headers=HEADERS, data=json.dumps(payload), timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"POST {path} -> {r.status_code}: {r.text[:1200]}")
    return r.json() if r.text else None


def mb_put(path: str, payload: dict) -> Any:
    r = requests.put(MB_URL + path, headers=HEADERS, data=json.dumps(payload), timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"PUT {path} -> {r.status_code}: {r.text[:1200]}")
    return r.json() if r.text else None


def find_database_id(name_hint: str = "dataplatform") -> int:
    dbs = mb_get("/api/database")
    items = dbs.get("data") if isinstance(dbs, dict) else dbs
    if not items:
        die("No databases found in Metabase")

    hint = name_hint.lower()
    for d in items:
        n = (d.get("name") or "").lower()
        if hint in n:
            return int(d["id"])

    return int(items[0]["id"])


def search_one(model: str, name: str) -> Optional[dict]:
    raw = mb_get("/api/search", params={"q": name, "models": model})
    res = raw.get("data") if isinstance(raw, dict) else raw
    if not isinstance(res, list):
        return None

    for it in res:
        if isinstance(it, dict) and it.get("model") == model and it.get("name") == name:
            return it

    for it in res:
        if isinstance(it, dict) and it.get("model") == model and (it.get("name") or "").lower() == name.lower():
            return it

    return None


# Stable parameter UUIDs (dashboard + template tags)
PID_MONTH = "00000000-0000-0000-0000-000000000001"
PID_STORE = "00000000-0000-0000-0000-000000000002"

# Dashboard filters (as requested)
PID_EXP_LVL1 = "00000000-0000-0000-0000-000000000003"  # dashboard 支出一级
PID_INC_LVL1 = "00000000-0000-0000-0000-000000000004"  # dashboard 收入一级

# Detail drilldown filters
PID_EXP_LVL2 = "00000000-0000-0000-0000-000000000005"  # dashboard 支出二级
PID_INC_LVL2 = "00000000-0000-0000-0000-000000000006"  # dashboard 收入二级
PID_KEYWORD = "00000000-0000-0000-0000-000000000007"   # dashboard 关键词（对方单位/摘要/附言/用途）

# Card template-tag UUIDs (for reproducible mappings)
TAG_EXP_LVL1 = "00000000-0000-0000-0000-00000000A001"
TAG_INC_LVL1 = "00000000-0000-0000-0000-00000000A002"
TAG_EXP_LVL2 = "00000000-0000-0000-0000-00000000A003"
TAG_INC_LVL2 = "00000000-0000-0000-0000-00000000A004"
TAG_KEYWORD = "00000000-0000-0000-0000-00000000A005"


def card_payload(*, name: str, database_id: int, sql: str, description: str, display: str, viz: dict, template_tags: dict, parameters: list[dict]) -> dict:
    return {
        "name": name,
        "description": description,
        "display": display,
        "type": "question",
        "visualization_settings": viz or {},
        "dataset_query": {
            "lib/type": "mbql/query",
            "database": database_id,
            "stages": [
                {
                    "lib/type": "mbql.stage/native",
                    "native": sql,
                    "template-tags": template_tags,
                }
            ],
        },
        "parameters": parameters,
    }


def upsert_card(*, name: str, database_id: int, sql: str, description: str = "", display: str = "table", visualization_settings: Optional[dict] = None, template_tags: Optional[dict] = None, parameters: Optional[list[dict]] = None) -> int:
    existing = search_one("card", name)

    payload = card_payload(
        name=name,
        database_id=database_id,
        sql=sql,
        description=description,
        display=display,
        viz=visualization_settings or {},
        template_tags=template_tags or {},
        parameters=parameters or [],
    )

    if existing and existing.get("id"):
        cid = int(existing["id"])
        mb_put(f"/api/card/{cid}", payload)
        return cid

    created = mb_post("/api/card", payload)
    return int(created["id"])


def upsert_dashboard(*, name: str, description: str, parameters: list[dict], dashcard_specs: list[dict], tabs: Optional[list[dict]] = None) -> int:
    """Upsert dashboard + dashcards.

    Supports Metabase dashboard tabs by best-effort calling:
      - PUT /api/dashboard/:id (meta)
      - PUT /api/dashboard/:id/cards (cards + tabs)

    If /cards fails (older/newer servers), falls back to PUT /api/dashboard/:id with `dashcards`.
    """

    existing = search_one("dashboard", name)

    if existing and existing.get("id"):
        did = int(existing["id"])
    else:
        created = mb_post("/api/dashboard", {"name": name, "description": description})
        did = int(created["id"])

    current = mb_get(f"/api/dashboard/{did}") or {}

    # Need existing dashcard IDs to update.
    current_dashcards = current.get("dashcards") or current.get("cards") or []
    by_card_id = {int(dc.get("card_id")): dc for dc in current_dashcards if dc.get("card_id") is not None}

    # Tabs: map desired names -> ids (reuse existing ids when present; otherwise use negative temp ids)
    desired_tabs: list[dict] = []
    tab_id_by_name: dict[str, int] = {}

    if tabs:
        existing_tabs = current.get("tabs") or []
        if isinstance(existing_tabs, list):
            for t in existing_tabs:
                if isinstance(t, dict) and t.get("id") is not None and t.get("name"):
                    try:
                        tab_id_by_name[str(t["name"])] = int(t["id"])
                    except Exception:
                        pass

        next_temp = -2
        for t in tabs:
            tname = str(t.get("name") or "").strip()
            if not tname:
                continue
            tid = tab_id_by_name.get(tname)
            if tid is None:
                # prefer provided id; else allocate temp
                if t.get("id") is not None:
                    tid = int(t["id"])
                else:
                    tid = next_temp
                    next_temp -= 1
            desired_tabs.append({"id": tid, "name": tname, "description": t.get("description") or ""})

    tab_id_map = {t["name"]: int(t["id"]) for t in desired_tabs} if desired_tabs else {}

    new_dashcards: list[dict] = []
    for spec in dashcard_specs:
        card_id = int(spec["card_id"])
        tab_name = spec.get("tab")
        dashboard_tab_id = None
        if tab_name and tab_id_map:
            dashboard_tab_id = tab_id_map.get(str(tab_name))

        if card_id in by_card_id:
            dc = by_card_id[card_id]
            dc_id = dc.get("id")
            if dc_id is None:
                dc_id = -card_id

            new_dashcards.append({
                "id": dc_id,
                "card_id": card_id,
                "col": spec["col"],
                "row": spec["row"],
                "size_x": spec["size_x"],
                "size_y": spec["size_y"],
                "series": dc.get("series") or [],
                "visualization_settings": dc.get("visualization_settings") or {},
                "parameter_mappings": spec.get("parameter_mappings") or [],
                "dashboard_tab_id": dashboard_tab_id,
            })
        else:
            new_dashcards.append({
                "id": spec.get("id") or (-1000 - card_id),
                "card_id": card_id,
                "col": spec["col"],
                "row": spec["row"],
                "size_x": spec["size_x"],
                "size_y": spec["size_y"],
                "series": [],
                "visualization_settings": {},
                "parameter_mappings": spec.get("parameter_mappings") or [],
                "dashboard_tab_id": dashboard_tab_id,
            })

    # 1) Update dashboard meta (name/desc/parameters + tabs)
    meta_payload: dict = {
        "name": name,
        "description": description,
        "parameters": parameters,
    }
    if desired_tabs:
        meta_payload["tabs"] = desired_tabs
    mb_put(f"/api/dashboard/{did}", meta_payload)

    # 2) Update cards + tabs (best-effort)
    if desired_tabs:
        try:
            mb_put(
                f"/api/dashboard/{did}/cards",
                {
                    "cards": new_dashcards,
                    "tabs": desired_tabs,
                    "ordered_tabs": [t["id"] for t in desired_tabs],
                },
            )
            return did
        except Exception as e:
            print(f"WARN: PUT /api/dashboard/{did}/cards failed, falling back to PUT /api/dashboard/:id with dashcards. err={e}")

    # Fallback: full update via /api/dashboard/:id
    payload = {
        "name": name,
        "description": description,
        "parameters": parameters,
        "dashcards": new_dashcards,
    }
    if desired_tabs:
        payload["tabs"] = desired_tabs
    mb_put(f"/api/dashboard/{did}", payload)
    return did


def mp(card_id: int, parameter_id: str, tag_name: str) -> dict:
    return {"card_id": card_id, "parameter_id": parameter_id, "target": ["variable", ["template-tag", tag_name]]}


def main() -> None:
    me = mb_get("/api/user/current")
    if not me.get("is_superuser"):
        print("WARN: api key user is not superuser; may lack permissions")

    db_id = find_database_id("dataplatform")

    # -----------------
    # Cards (Questions)
    # -----------------

    # Card 40: 收支总揽（表） + 利润/利润率/毛利率 + 当月现金流
    sql_card40 = r"""WITH base AS (
  SELECT
    to_char(t.txn_time, 'YYYY-MM') AS month,
    t.store_code,
    COALESCE(c.lvl1_name, c.lvl1) AS lvl1_name,
    c.classified_source,
    COALESCE(t.in_amt, 0)  AS in_amt,
    COALESCE(t.out_amt, 0) AS out_amt
  FROM yufeng_ods.bank_txn t
  JOIN yufeng_dm.v_bank_txn_classified c
    ON c.bank_txn_id = t.id
  WHERE t.txn_time IS NOT NULL
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
),
profit_agg AS (
  SELECT
    COALESCE(SUM(p.bank_revenue_amt), 0) AS in_biz,
    COALESCE(SUM(p.total_in_amt), 0) AS total_in_amt,
    COALESCE(SUM(p.expense_ex_build_amt), 0) AS total_out,
    COALESCE(SUM(p.profit_amt), 0) AS profit_amt,
    COALESCE(SUM(p.cashflow_amt), 0) AS cashflow_amt,
    COALESCE(SUM(p.material_purchase_amt), 0) AS material_purchase_amt,
    (COALESCE(SUM(p.bank_revenue_amt), 0) - COALESCE(SUM(p.material_purchase_amt), 0)) / NULLIF(COALESCE(SUM(p.bank_revenue_amt), 0), 0) AS gross_margin_rate
  FROM yufeng_dm.profit_monthly p
  WHERE 1=1
  [[ AND extract(year from p.month) = extract(year from {{month_date}})
     AND extract(month from p.month) = extract(month from {{month_date}}) ]]
  [[ AND p.store_code = {{store_code}} ]]
),
agg AS (
  SELECT
    COALESCE(SUM(in_amt)  FILTER (WHERE in_amt  > 0), 0) AS total_in,

    -- 来自 profit_monthly（单行），这里用 MAX() 避免与 base 的聚合冲突
    MAX(profit_agg.total_out)  AS total_out,

    -- 这里“营业收入”以 yufeng_dm.profit_monthly 口径为准（REV_BIZ）
    MAX(profit_agg.in_biz) AS in_biz,

    -- 当月现金流（综合时为多月合计）
    MAX(profit_agg.cashflow_amt) AS cashflow_amt,

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

    card40_name = "Yufeng｜收支总揽（表）"
    card40_id = upsert_card(
        name=card40_name,
        database_id=db_id,
        sql=sql_card40,
        description="收支总揽（按 Month/Store 可筛选）。含利润/利润率/毛利率/当月现金流。",
        display="table",
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card 41: 支出一级
    sql_41 = r"""SELECT
  COALESCE(c.lvl1_name, c.lvl1) AS "类别",
  SUM(COALESCE(t.out_amt,0)) AS "金额(元)"
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  AND COALESCE(t.out_amt,0) > 0
  [[ AND t.store_code = {{store_code}} ]]
GROUP BY COALESCE(c.lvl1_name, c.lvl1)
ORDER BY "金额(元)" DESC;"""

    card41_id = upsert_card(
        name="Yufeng｜支出一级分类（饼图）",
        database_id=db_id,
        sql=sql_41,
        description="支出一级分类饼图（类别+金额）。",
        display="pie",
        visualization_settings={"pie.show_values": True, "pie.value_formatting": "currency"},
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card 42: 支出二级（含 一级/二级 筛选）
    sql_42 = r"""SELECT
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）') AS "类别",
  SUM(COALESCE(t.out_amt,0)) AS "金额(元)"
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  AND COALESCE(t.out_amt,0) > 0
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, c.lvl1) = {{expense_lvl1}} ]]
GROUP BY COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）')
ORDER BY "金额(元)" DESC;"""

    card42_id = upsert_card(
        name="Yufeng｜支出二级分类（饼图）",
        database_id=db_id,
        sql=sql_42,
        description="支出二级分类饼图（类别+金额）；支持支出一级筛选。",
        display="pie",
        visualization_settings={"pie.show_values": True, "pie.value_formatting": "currency"},
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "expense_lvl1": {"id": TAG_EXP_LVL1, "name": "expense_lvl1", "display-name": "Expense Lvl1", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": TAG_EXP_LVL1, "type": "string/=", "name": "Expense Lvl1", "slug": "expense_lvl1", "target": ["variable", ["template-tag", "expense_lvl1"]]},
        ],
    )

    # Card 43: 收入二级（含 一级/二级 筛选）
    sql_43 = r"""SELECT
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）') AS "类别",
  SUM(COALESCE(t.in_amt,0)) AS "金额(元)"
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  AND COALESCE(t.in_amt,0) > 0
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, c.lvl1) = {{income_lvl1}} ]]
GROUP BY COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）')
ORDER BY "金额(元)" DESC;"""

    card43_id = upsert_card(
        name="Yufeng｜收入二级分类（柱状图）",
        database_id=db_id,
        sql=sql_43,
        description="收入二级分类柱状图（类别+金额）；支持收入一级筛选。",
        display="bar",
        visualization_settings={"graph.show_values": True, "graph.value_formatting": "currency"},
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "income_lvl1": {"id": TAG_INC_LVL1, "name": "income_lvl1", "display-name": "Income Lvl1", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": TAG_INC_LVL1, "type": "string/=", "name": "Income Lvl1", "slug": "income_lvl1", "target": ["variable", ["template-tag", "income_lvl1"]]},
        ],
    )

    # Card 45: 营业收入 vs 支出（不含营建）
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
  FROM yufeng_ods.bank_txn t
  LEFT JOIN yufeng_dm.v_bank_txn_classified c
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

    card45_id = upsert_card(
        name="Yufeng｜营业收入 vs 支出（不含营建）",
        database_id=db_id,
        sql=sql_45,
        description="按月对比：营业收入 vs 支出（剔除营建费用 BUILD）。支持 Month/Store Code 筛选。",
        display="bar",
        visualization_settings={"graph.show_values": True, "graph.value_formatting": "currency"},
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card 46: 支出一级分类趋势图（按月，多条线）
    sql_46 = r"""SELECT
  date_trunc('month', t.txn_time)::date AS "月份",
  COALESCE(c.lvl1_name, '（未分类）') AS "一级分类",
  ROUND(SUM(COALESCE(t.out_amt, 0)), 2) AS "金额(元)"
FROM yufeng_ods.bank_txn t
LEFT JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt, 0) > 0
  [[ AND t.store_code = {{store_code}} ]]
GROUP BY 1, 2
ORDER BY 1, 2;"""

    card46_id = upsert_card(
        name="Yufeng｜支出一级分类趋势（多线图）",
        database_id=db_id,
        sql=sql_46,
        description="支出的一级分类按月趋势（多线图）；支持 Store 筛选。",
        display="line",
        visualization_settings={"graph.show_values": True, "graph.value_formatting": "currency"},
        template_tags={
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # Card 47: 支出明细（用于下钻）
    sql_47 = r"""SELECT
  t.txn_time AS "时间",
  t.store_code AS "门店",
  COALESCE(c.lvl1_name, c.lvl1) AS "支出一级",
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）') AS "支出二级",
  t.counterparty_name AS "对方单位",
  t.summary AS "摘要",
  t.memo AS "附言",
  t.purpose AS "用途",
  ROUND(COALESCE(t.out_amt,0), 2) AS "支出(元)",
  t.id AS "bank_txn_id",
  t.source_file_id,
  c.matched_rule_id,
  c.classified_source
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.out_amt,0) > 0
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, c.lvl1) = {{expense_lvl1}} ]]
  [[ AND COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）') = {{expense_lvl2}} ]]
  [[ AND (
        COALESCE(t.counterparty_name,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.summary,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.memo,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.purpose,'') ILIKE '%' || {{keyword}} || '%'
  ) ]]
ORDER BY COALESCE(t.out_amt,0) DESC, t.txn_time DESC
LIMIT 2000;"""

    card47_id = upsert_card(
        name="Yufeng｜支出明细（下钻）",
        database_id=db_id,
        sql=sql_47,
        description="用于下钻查看支出明细：按月/门店/支出一级/支出二级/关键词筛选；按金额倒序。",
        display="table",
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "expense_lvl1": {"id": TAG_EXP_LVL1, "name": "expense_lvl1", "display-name": "Expense Lvl1", "type": "text"},
            "expense_lvl2": {"id": TAG_EXP_LVL2, "name": "expense_lvl2", "display-name": "Expense Lvl2", "type": "text"},
            "keyword": {"id": TAG_KEYWORD, "name": "keyword", "display-name": "Keyword", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": TAG_EXP_LVL1, "type": "string/=", "name": "Expense Lvl1", "slug": "expense_lvl1", "target": ["variable", ["template-tag", "expense_lvl1"]]},
            {"id": TAG_EXP_LVL2, "type": "string/=", "name": "Expense Lvl2", "slug": "expense_lvl2", "target": ["variable", ["template-tag", "expense_lvl2"]]},
            {"id": TAG_KEYWORD, "type": "string/contains", "name": "Keyword", "slug": "keyword", "target": ["variable", ["template-tag", "keyword"]]},
        ],
    )

    # Card 48: 收入明细（用于下钻）
    sql_48 = r"""SELECT
  t.txn_time AS "时间",
  t.store_code AS "门店",
  COALESCE(c.lvl1_name, c.lvl1) AS "收入一级",
  COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）') AS "收入二级",
  t.counterparty_name AS "对方单位",
  t.summary AS "摘要",
  t.memo AS "附言",
  t.purpose AS "用途",
  ROUND(COALESCE(t.in_amt,0), 2) AS "收入(元)",
  t.id AS "bank_txn_id",
  t.source_file_id,
  c.matched_rule_id,
  c.classified_source
FROM yufeng_ods.bank_txn t
JOIN yufeng_dm.v_bank_txn_classified c
  ON c.bank_txn_id = t.id
WHERE t.txn_time IS NOT NULL
  AND COALESCE(t.in_amt,0) > 0
  [[ AND extract(year from t.txn_time) = extract(year from {{month_date}})
     AND extract(month from t.txn_time) = extract(month from {{month_date}}) ]]
  [[ AND t.store_code = {{store_code}} ]]
  [[ AND COALESCE(c.lvl1_name, c.lvl1) = {{income_lvl1}} ]]
  [[ AND COALESCE(NULLIF(COALESCE(c.lvl2_name, c.lvl2),''), '（未填）') = {{income_lvl2}} ]]
  [[ AND (
        COALESCE(t.counterparty_name,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.summary,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.memo,'') ILIKE '%' || {{keyword}} || '%'
     OR COALESCE(t.purpose,'') ILIKE '%' || {{keyword}} || '%'
  ) ]]
ORDER BY COALESCE(t.in_amt,0) DESC, t.txn_time DESC
LIMIT 2000;"""

    card48_id = upsert_card(
        name="Yufeng｜收入明细（下钻）",
        database_id=db_id,
        sql=sql_48,
        description="用于下钻查看收入明细：按月/门店/收入一级/收入二级/关键词筛选；按金额倒序。",
        display="table",
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
            "income_lvl1": {"id": TAG_INC_LVL1, "name": "income_lvl1", "display-name": "Income Lvl1", "type": "text"},
            "income_lvl2": {"id": TAG_INC_LVL2, "name": "income_lvl2", "display-name": "Income Lvl2", "type": "text"},
            "keyword": {"id": TAG_KEYWORD, "name": "keyword", "display-name": "Keyword", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
            {"id": TAG_INC_LVL1, "type": "string/=", "name": "Income Lvl1", "slug": "income_lvl1", "target": ["variable", ["template-tag", "income_lvl1"]]},
            {"id": TAG_INC_LVL2, "type": "string/=", "name": "Income Lvl2", "slug": "income_lvl2", "target": ["variable", ["template-tag", "income_lvl2"]]},
            {"id": TAG_KEYWORD, "type": "string/contains", "name": "Keyword", "slug": "keyword", "target": ["variable", ["template-tag", "keyword"]]},
        ],
    )

    # -----------------
    # Options cards (for dropdown filters)
    # -----------------

    store_options_id = upsert_card(
        name="Yufeng｜门店下拉选项",
        database_id=db_id,
        sql=r"""SELECT store_code, store_name
FROM yufeng_cfg.dim_store
ORDER BY COALESCE(sort_order, 9999), store_code;""",
        description="Dashboard filter options: store_code + store_name",
        display="table",
    )

    # -----------------
    # Dashboard
    # -----------------

    dash_name = "榆枫与山｜经营看板"
    dash_desc = "榆枫与山：概览（收支总揽/支出一级/支出二级/收入二级/趋势）+ 明细下钻（支出/收入明细表）。筛选：月（按月）/门店（下拉）/支出一级/支出二级/收入一级/收入二级/关键词。"

    dash_params = [
        # 1) Month: month-only picker
        {"id": PID_MONTH, "name": "Month", "slug": "month_date", "type": "date/month-year", "sectionId": "date", "required": False},

        # 2) Store: dropdown with store names (static list for now)
        {
            "id": PID_STORE,
            "name": "门店",
            "slug": "store_code",
            "type": "category",
            "sectionId": "string",
            "required": False,
            "values_source_type": "card",
            "values_source_config": {
                "card_id": store_options_id,
                "value_field": ["field", 771, None],
                "label_field": ["field", 772, None]
            },
        },

        # 3) Expense lvl1
        {
            "id": PID_EXP_LVL1,
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
                    ["营销费用", "营销费用"],
                    ["其他费用", "其他费用"],
                    ["营建费用", "营建费用"],
                    ["（未分类）", "（未分类）"],
                ]
            },
        },

        # 4) Income lvl1
        {
            "id": PID_INC_LVL1,
            "name": "收入一级",
            "slug": "income_lvl1",
            "type": "category",
            "sectionId": "string",
            "required": False,
            "values_source_type": "static-list",
            "values_source_config": {"values": [["营业收入", "营业收入"], ["其他收入", "其他收入"]]},
        },

        # 5) Expense lvl2 (detail)
        {
            "id": PID_EXP_LVL2,
            "name": "支出二级",
            "slug": "expense_lvl2",
            "type": "category",
            "sectionId": "string",
            "required": False,
            "values_source_type": "static-list",
            "values_source_config": {
                "values": [
                    ["（未填）", "（未填）"],
                    ["租金", "租金"],
                    ["物业费", "物业费"],
                    ["水电费", "水电费"],
                    ["工资", "工资"],
                    ["社保", "社保"],
                    ["劳务派遣", "劳务派遣"],
                    ["人力服务", "人力服务"],
                    ["货拉拉", "货拉拉"],
                    ["快递", "快递"],
                    ["同城配送", "同城配送"],
                    ["其他运费", "其他运费"],
                    ["系统使用费", "系统使用费"],
                    ["办公费用", "办公费用"],
                    ["差旅费", "差旅费"],
                    ["维修费", "维修费"],
                    ["其他管理", "其他管理"],
                    ["银行手续费", "银行手续费"],
                    ["支付通道费", "支付通道费"],
                    ["原材料", "原材料"],
                    ["辅料", "辅料"],
                    ["包装", "包装"],
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

        # 6) Income lvl2 (detail)
        {
            "id": PID_INC_LVL2,
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

        # 7) Keyword (detail)
        {
            "id": PID_KEYWORD,
            "name": "关键词",
            "slug": "keyword",
            "type": "string/contains",
            "sectionId": "string",
            "required": False,
        },
    ]

    dashcard_specs = [
        # 概览 Tab
        {
            "id": -101,
            "tab": "概览",
            "card_id": card40_id,
            "col": 0,
            "row": 0,
            "size_x": 24,
            "size_y": 8,
            "parameter_mappings": [
                mp(card40_id, PID_MONTH, "month_date"),
                mp(card40_id, PID_STORE, "store_code"),
            ],
        },
        {
            "id": -102,
            "tab": "概览",
            "card_id": card41_id,
            "col": 0,
            "row": 8,
            "size_x": 12,
            "size_y": 8,
            "parameter_mappings": [
                mp(card41_id, PID_MONTH, "month_date"),
                mp(card41_id, PID_STORE, "store_code"),
            ],
        },
        {
            "id": -103,
            "tab": "概览",
            "card_id": card42_id,
            "col": 12,
            "row": 8,
            "size_x": 12,
            "size_y": 8,
            "parameter_mappings": [
                mp(card42_id, PID_MONTH, "month_date"),
                mp(card42_id, PID_STORE, "store_code"),
                mp(card42_id, PID_EXP_LVL1, "expense_lvl1"),
            ],
        },
        {
            "id": -104,
            "tab": "概览",
            "card_id": card43_id,
            "col": 0,
            "row": 16,
            "size_x": 24,
            "size_y": 8,
            "parameter_mappings": [
                mp(card43_id, PID_MONTH, "month_date"),
                mp(card43_id, PID_STORE, "store_code"),
                mp(card43_id, PID_INC_LVL1, "income_lvl1"),
            ],
        },
        {
            "id": -105,
            "tab": "概览",
            "card_id": card45_id,
            "col": 0,
            "row": 24,
            "size_x": 24,
            "size_y": 8,
            "parameter_mappings": [
                mp(card45_id, PID_MONTH, "month_date"),
                mp(card45_id, PID_STORE, "store_code"),
            ],
        },
        {
            "id": -106,
            "tab": "概览",
            "card_id": card46_id,
            "col": 0,
            "row": 32,
            "size_x": 24,
            "size_y": 8,
            "parameter_mappings": [
                mp(card46_id, PID_STORE, "store_code"),
            ],
        },

        # 明细 Tab（下钻）
        {
            "id": -107,
            "tab": "明细",
            "card_id": card47_id,
            "col": 0,
            "row": 0,
            "size_x": 24,
            "size_y": 12,
            "parameter_mappings": [
                mp(card47_id, PID_MONTH, "month_date"),
                mp(card47_id, PID_STORE, "store_code"),
                mp(card47_id, PID_EXP_LVL1, "expense_lvl1"),
                mp(card47_id, PID_EXP_LVL2, "expense_lvl2"),
                mp(card47_id, PID_KEYWORD, "keyword"),
            ],
        },
        {
            "id": -108,
            "tab": "明细",
            "card_id": card48_id,
            "col": 0,
            "row": 12,
            "size_x": 24,
            "size_y": 12,
            "parameter_mappings": [
                mp(card48_id, PID_MONTH, "month_date"),
                mp(card48_id, PID_STORE, "store_code"),
                mp(card48_id, PID_INC_LVL1, "income_lvl1"),
                mp(card48_id, PID_INC_LVL2, "income_lvl2"),
                mp(card48_id, PID_KEYWORD, "keyword"),
            ],
        },
    ]

    dash_id = upsert_dashboard(
        name=dash_name,
        description=dash_desc,
        parameters=dash_params,
        dashcard_specs=dashcard_specs,
        tabs=None,
    )

    print("DONE")
    print(f"Dashboard: {dash_name} (id={dash_id}) -> {MB_URL}/dashboard/{dash_id}")
    for name, cid in [
        (card40_name, card40_id),
        ("Yufeng｜支出一级分类（饼图）", card41_id),
        ("Yufeng｜支出二级分类（饼图）", card42_id),
        ("Yufeng｜收入二级分类（柱状图）", card43_id),
        ("Yufeng｜营业收入 vs 支出（不含营建）", card45_id),
        ("Yufeng｜支出一级分类趋势（多线图）", card46_id),
        ("Yufeng｜支出明细（下钻）", card47_id),
        ("Yufeng｜收入明细（下钻）", card48_id),
    ]:
        print(f"Card: {name} (id={cid}) -> {MB_URL}/question/{cid}")


if __name__ == "__main__":
    main()
