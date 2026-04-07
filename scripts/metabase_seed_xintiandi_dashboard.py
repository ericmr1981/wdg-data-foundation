#!/usr/bin/env python3
"""
Xintiandi Metabase Dashboard Seeder
用途：为新天地门店创建配送/库存数据看板

Dashboard 结构：
1. 月总览 - 月度汇总数据
2. 趋势数据 - 月度变化趋势
3. 品项分析 - 各品项数据

Usage:
  export METABASE_URL=http://localhost:3000
  export METABASE_API_KEY='...'
  python3 scripts/metabase_seed_xintiandi_dashboard.py
"""

import os
import sys
import json
import argparse
from typing import Optional, Any

import requests

MB_URL = os.environ.get("METABASE_URL", "http://localhost:8082").rstrip("/")
MB_KEY = os.environ.get("METABASE_API_KEY")

BRAND_CODE = "xintiandi"
BRAND_DISPLAY = "新天地"


def build_headers() -> dict:
    if not MB_KEY:
        user = os.environ.get("METABASE_USER", "demo@metabase.com")
        pwd = os.environ.get("METABASE_PASSWORD", "demo123456")
        
        r = requests.post(
            MB_URL + "/api/session",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"username": user, "password": pwd}),
            timeout=30,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Session auth failed: {r.status_code}")
        sid = r.json().get("id")
        return {"Content-Type": "application/json", "X-Metabase-Session": sid}
    
    return {"Content-Type": "application/json", "X-Api-Key": MB_KEY}


HEADERS = None


def die(msg: str):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def mb_get(path: str, params: Optional[dict] = None) -> Any:
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
        die("No databases found")
    
    hint = name_hint.lower()
    for d in items:
        if hint in (d.get("name") or "").lower():
            return int(d["id"])
    return int(items[0]["id"])


def search_one(model: str, name: str) -> Optional[dict]:
    raw = mb_get("/api/search", params={"q": name, "models": model})
    res = raw.get("data") if isinstance(raw, dict) else raw
    if not isinstance(res, list):
        return None
    for it in res:
        if it.get("model") == model and it.get("name") == name:
            return it
    return None


# Parameter UUIDs
PID_MONTH = "00000000-0000-0001-0001-000000000001"
PID_STORE = "00000000-0000-0001-0002-000000000002"


def create_native_question(name: str, sql: str, display: str = "table") -> dict:
    """Create a native SQL question"""
    db_id = find_database_id()
    
    # Check if exists
    existing = search_one("card", name)
    if existing:
        print(f"  Question '{name}' exists, updating...")
        card_id = existing["id"]
        mb_put(f"/api/card/{card_id}", {
            "dataset_query": {
                "type": "native",
                "native": {"query": sql, "template-tags": {}},
                "database": db_id
            },
            "name": name,
            "display": display,
            "visualization_settings": {}
        })
        return {"id": card_id, "name": name}
    
    # Create new
    result = mb_post("/api/card", {
        "name": name,
        "display": display,
        "dataset_query": {
            "type": "native",
            "native": {"query": sql, "template-tags": {}},
            "database": db_id
        },
        "visualization_settings": {}
    })
    print(f"  Created question: {name} (id={result.get('id')})")
    return result


def create_dashboard(name: str, description: str = "") -> dict:
    """Create or get existing dashboard"""
    existing = search_one("dashboard", name)
    if existing:
        print(f"Dashboard '{name}' exists")
        return existing
    
    result = mb_post("/api/dashboard", {
        "name": name,
        "description": description,
        "parameters": []
    })
    print(f"Created dashboard: {name} (id={result.get('id')})")
    return result


def add_card_to_dashboard(dashboard_id: int, card_id: int, row: int, col: int, 
                           size_x: int = 12, size_y: int = 8) -> dict:
    """Add or update a card on dashboard.

    Metabase versions in the wild are inconsistent here: some do not expose
    POST /api/dashboard/:id/cards. To stay compatible with the current VPS
    instance, fetch the existing dashboard definition and update it via
    PUT /api/dashboard/:id with a full dashcards payload.
    """
    dashboard = mb_get(f"/api/dashboard/{dashboard_id}") or {}
    current_dashcards = dashboard.get("dashcards") or dashboard.get("cards") or []

    for dc in current_dashcards:
        if int(dc.get("card_id") or 0) == int(card_id):
            dc.update({
                "col": col,
                "row": row,
                "size_x": size_x,
                "size_y": size_y,
                "card_id": card_id,
            })
            break
    else:
        current_dashcards.append({
            "id": -1000 - int(card_id),
            "card_id": card_id,
            "col": col,
            "row": row,
            "size_x": size_x,
            "size_y": size_y,
            "series": [],
            "visualization_settings": {},
            "parameter_mappings": [],
        })

    payload = {
        "name": dashboard.get("name") or f"{BRAND_DISPLAY}｜配送看板",
        "description": dashboard.get("description") or "",
        "parameters": dashboard.get("parameters") or [],
        "dashcards": current_dashcards,
    }
    return mb_put(f"/api/dashboard/{dashboard_id}", payload)


# ============================================================
# SQL Templates
# ============================================================

SQL_MONTHLY_OVERVIEW = """
SELECT 
    year_month AS "月份",
    store_name AS "门店",
    total_order_qty AS "订货数量",
    total_audit_qty AS "审核数量", 
    total_ship_qty AS "发货数量",
    total_deliver_qty AS "送达数量",
    total_order_amt AS "订货金额",
    delivery_count AS "配送单数"
FROM xintiandi.monthly_summary
ORDER BY year_month DESC, store_name
LIMIT 100
"""

SQL_MONTHLY_TREND = """
SELECT 
    year_month AS "月份",
    SUM(total_order_qty) AS "订货数量",
    SUM(total_deliver_qty) AS "送达数量",
    SUM(total_order_amt) AS "订货金额"
FROM xintiandi.monthly_summary
GROUP BY year_month
ORDER BY year_month
"""

SQL_ITEM_CATEGORY = """
SELECT 
    item_category AS "品项分类",
    SUM(order_qty) AS "订货数量",
    SUM(deliver_qty) AS "送达数量",
    SUM(order_amt) AS "订货金额"
FROM xintiandi.delivery_detail
WHERE created_time >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
GROUP BY item_category
ORDER BY SUM(order_amt) DESC
"""

SQL_ITEM_DETAIL = """
SELECT 
    item_name AS "品项名称",
    item_code AS "品项编码",
    item_category AS "品项分类",
    SUM(order_qty) AS "订货数量",
    SUM(deliver_qty) AS "送达数量",
    SUM(order_amt) AS "订货金额"
FROM xintiandi.delivery_detail
GROUP BY item_name, item_code, item_category
ORDER BY SUM(order_amt) DESC
LIMIT 100
"""

SQL_DELIVERY_STATS = """
SELECT 
    TO_CHAR(created_time, 'YYYY-MM') AS "月份",
    COUNT(DISTINCT delivery_no) AS "配送单数",
    COUNT(DISTINCT item_code) AS "品项数",
    ROUND(AVG(CASE WHEN order_qty > 0 THEN deliver_qty::numeric / order_qty END), 4) AS "送达率"
FROM xintiandi.delivery_detail
GROUP BY TO_CHAR(created_time, 'YYYY-MM')
ORDER BY "月份" DESC
"""


def main():
    global HEADERS
    HEADERS = build_headers()
    
    print(f"Connecting to Metabase: {MB_URL}")
    print(f"Brand: {BRAND_DISPLAY} ({BRAND_CODE})")
    
    # 1. Create dashboard
    dashboard = create_dashboard(
        f"{BRAND_DISPLAY}｜配送看板",
        f"{BRAND_DISPLAY}门店配送/库存数据看板 - 月总览、趋势分析、品项数据"
    )
    dashboard_id = dashboard["id"]
    
    # 2. Create questions
    questions = [
        ("月总览", SQL_MONTHLY_OVERVIEW, "table"),
        ("月度趋势", SQL_MONTHLY_TREND, "line"),
        ("品项分类汇总", SQL_ITEM_CATEGORY, "bar"),
        ("品项明细", SQL_ITEM_DETAIL, "table"),
        ("配送统计", SQL_DELIVERY_STATS, "table"),
    ]
    
    cards = []
    row = 0
    for name, sql, display in questions:
        print(f"\nCreating question: {name}")
        card = create_native_question(f"{BRAND_DISPLAY}｜{name}", sql, display)
        cards.append(card)
        
        # Add to dashboard
        size_x = 12 if display == "table" else 18
        size_y = 8
        add_card_to_dashboard(dashboard_id, card["id"], row, 0, size_x, size_y)
        row += 1
    
    print(f"\n{'='*60}")
    print(f"Dashboard created: {MB_URL}/dashboard/{dashboard_id}")
    print(f"Questions created: {len(cards)}")
    
    # Save to artifact
    artifact = {
        "dashboard": dashboard,
        "cards": cards,
        "urls": {
            "dashboard": f"{MB_URL}/dashboard/{dashboard_id}"
        }
    }
    
    artifact_path = "artifacts/xintiandi/metabase_dashboard.json"
    os.makedirs(os.path.dirname(artifact_path), exist_ok=True)
    with open(artifact_path, "w") as f:
        json.dump(artifact, f, indent=2, ensure_ascii=False)
    print(f"Artifact saved: {artifact_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=MB_URL, help="Metabase URL")
    parser.add_argument("--api-key", help="Metabase API Key")
    args = parser.parse_args()
    
    if args.url:
        MB_URL = args.url.rstrip("/")
    if args.api_key:
        MB_KEY = args.api_key
    
    main()
