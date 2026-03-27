#!/usr/bin/env python3
"""Seed Metabase dashboard for Bonjur sales self-service daily report.

This creates a small dashboard that focuses on:
- 实收率 = 营业收入/营业额
- 营业额拆分 & 营业收入拆分（尽可能细分：微信/支付宝子渠道）

Auth: reuse scripts/metabase_seed_dashboard.py auth logic via import.

Usage:
  export METABASE_URL=http://localhost:3001
  export METABASE_USER=demo@metabase.com
  export METABASE_PASSWORD=demo123456
  python3 scripts/metabase_seed_bonjur_sales_dashboard.py

Tip:
  If you prefer module mode:
    python3 -m scripts.metabase_seed_bonjur_sales_dashboard
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running as a script (python3 scripts/xxx.py) without PYTHONPATH fiddling.
PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from scripts.metabase_seed_dashboard import (  # type: ignore
    mb_get,
    find_database_id,
    upsert_card,
    upsert_dashboard,
    mp,
)


# Dashboard parameter IDs (stable)
PID_MONTH = "00000000-0000-0000-0000-00000000B001"
PID_STORE = "00000000-0000-0000-0000-00000000B002"


def main() -> None:
    me = mb_get("/api/user/current")
    if not me.get("is_superuser"):
        print("WARN: metabase api user is not superuser; may lack permissions")

    db_id = find_database_id("dataplatform")

    # -----------------
    # Cards
    # -----------------

    sql_overview = r"""
SELECT
  month,
  store_code,
  store_name,
  gross_sales_amt AS "营业额",
  revenue_amt AS "营业收入",
  cash_in_rate_pct AS "实收率(%)",
  discount_amt AS "折扣/优惠额(营业额-营业收入)",
  refund_amt AS "退款金额",
  platform_service_fee_amt AS "平台服务费",
  revenue_incl_service_fee_amt AS "营业收入(含服务费)",
  service_fee_adjust_amt AS "服务费调整项"
FROM bonjur_dm.sales_daily_report_v1
WHERE 1=1
  [[ AND month = {{month_date}} ]]
  [[ AND store_code = {{store_code}} ]]
ORDER BY biz_date DESC
LIMIT 31;
"""

    card_overview_id = upsert_card(
        name="Bonjur｜营业日报（近31天）",
        database_id=db_id,
        sql=sql_overview,
        description="Bonjur 自助下载营业数据（日报）。含实收率、折扣、服务费校验项。",
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

    # Fine-grained breakdown: include level=1 children for wechat/alipay; include other channels at level=0.
    sql_breakdown_gross = r"""
SELECT
  channel_name AS "渠道",
  gross_sales_amt AS "营业额"
FROM bonjur_dm.v_sales_monthly_channel_breakdown_v1
WHERE month = COALESCE({{month_date}}, (SELECT max(month) FROM bonjur_dm.sales_monthly_report_v1))
  [[ AND store_code = {{store_code}} ]]
  AND (
    channel_level = 1
    OR (channel_level = 0 AND channel_code NOT IN ('wechat','alipay'))
  )
ORDER BY gross_sales_amt DESC;
"""

    card_gross_id = upsert_card(
        name="Bonjur｜营业额拆分（月/渠道）",
        database_id=db_id,
        sql=sql_breakdown_gross,
        description="营业额按渠道拆分（尽可能细：微信/支付宝拆到子渠道；其他渠道用大类）。",
        display="bar",
        visualization_settings={
            "graph.dimensions": ["渠道"],
            "graph.metrics": ["营业额"],
        },
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    sql_breakdown_rev = r"""
SELECT
  channel_name AS "渠道",
  revenue_amt AS "营业收入"
FROM bonjur_dm.v_sales_monthly_channel_breakdown_v1
WHERE month = COALESCE({{month_date}}, (SELECT max(month) FROM bonjur_dm.sales_monthly_report_v1))
  [[ AND store_code = {{store_code}} ]]
  AND (
    channel_level = 1
    OR (channel_level = 0 AND channel_code NOT IN ('wechat','alipay'))
  )
ORDER BY revenue_amt DESC;
"""

    card_rev_id = upsert_card(
        name="Bonjur｜营业收入拆分（月/渠道）",
        database_id=db_id,
        sql=sql_breakdown_rev,
        description="营业收入按渠道拆分（尽可能细：微信/支付宝拆到子渠道；其他渠道用大类）。",
        display="bar",
        visualization_settings={
            "graph.dimensions": ["渠道"],
            "graph.metrics": ["营业收入"],
        },
        template_tags={
            "month_date": {"id": PID_MONTH, "name": "month_date", "display-name": "Month", "type": "date"},
            "store_code": {"id": PID_STORE, "name": "store_code", "display-name": "Store Code", "type": "text"},
        },
        parameters=[
            {"id": PID_MONTH, "type": "date/single", "name": "Month", "slug": "month_date", "target": ["variable", ["template-tag", "month_date"]]},
            {"id": PID_STORE, "type": "string/=", "name": "Store Code", "slug": "store_code", "target": ["variable", ["template-tag", "store_code"]]},
        ],
    )

    # -----------------
    # Dashboard
    # -----------------

    dash_name = "Bonjur｜营业看板（自助下载）"
    dash_desc = "Bonjur 营业数据（自助下载）报表：实收率 + 渠道拆分（细分到微信/支付宝子渠道）。"

    dash_params = [
        {"id": PID_MONTH, "name": "Month", "slug": "month_date", "type": "date/single"},
        {"id": PID_STORE, "name": "Store Code", "slug": "store_code", "type": "string/="},
    ]

    dashcard_specs = [
        {
            "id": -201,
            "card_id": card_overview_id,
            "col": 0,
            "row": 0,
            "size_x": 24,
            "size_y": 10,
            "parameter_mappings": [
                mp(card_overview_id, PID_MONTH, "month_date"),
                mp(card_overview_id, PID_STORE, "store_code"),
            ],
        },
        {
            "id": -202,
            "card_id": card_gross_id,
            "col": 0,
            "row": 10,
            "size_x": 12,
            "size_y": 10,
            "parameter_mappings": [
                mp(card_gross_id, PID_MONTH, "month_date"),
                mp(card_gross_id, PID_STORE, "store_code"),
            ],
        },
        {
            "id": -203,
            "card_id": card_rev_id,
            "col": 12,
            "row": 10,
            "size_x": 12,
            "size_y": 10,
            "parameter_mappings": [
                mp(card_rev_id, PID_MONTH, "month_date"),
                mp(card_rev_id, PID_STORE, "store_code"),
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
    print(f"Dashboard: {dash_name} (id={dash_id})")


if __name__ == "__main__":
    main()
