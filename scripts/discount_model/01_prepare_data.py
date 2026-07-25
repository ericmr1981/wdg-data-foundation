#!/usr/bin/env python3
"""
01_prepare_data.py — 准备建模数据
  - 拉取上海 sh_xtd 日级订单
  - 更新上海天气
  - 生成节假日/周末/调休字段
  - 合并输出到 artifacts/sh_xtd_daily_regression_dataset_<start>_<end>.csv
  - 写 dataset_meta snapshot
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import _common as cm
from _common import step_context, artifact_path


SCRIPTS_DIR = Path(__file__).resolve().parent.parent


STEPS = [
    ("fetch_orders", 1),
    ("fetch_weather", 2),
    ("build_calendar", 3),
    ("merge_dataset", 4),
    ("write_snapshot", 5),
]


def fetch_orders(start: date, end: date, store_code: str) -> Path:
    out = artifact_path(f"{store_code}_daily_sales_{start.isoformat()}_{end.isoformat()}.csv")
    sql = f"""
        COPY (
            SELECT biz_date AS date, COUNT(*)::int AS order_count,
                   ROUND(AVG(100.0 * discount_amt / NULLIF(gross_amt,0))::numeric, 4) AS avg_discount_rate_pct,
                   ROUND(SUM(gross_amt)::numeric,2) AS gross_amount,
                   ROUND(SUM(discount_amt)::numeric,2) AS discount_amount,
                   ROUND(SUM(net_amt)::numeric,2) AS net_amount,
                   ROUND(SUM(revenue_amt)::numeric,2) AS revenue_amount,
                   ROUND(100.0 * SUM(net_amt) / NULLIF(SUM(gross_amt),0)::numeric,4) AS net_rate_pct
            FROM gelatomiiix_ods.income_detail
            WHERE NOT is_refund AND gross_amt > 0
              AND payment_methods IS NOT NULL
              AND revenue_amt > discount_amt
              AND store_code='{store_code}'
              AND biz_date BETWEEN DATE '{start.isoformat()}' AND DATE '{end.isoformat()}'
            GROUP BY biz_date ORDER BY biz_date
        ) TO STDOUT WITH CSV HEADER
    """
    with cm.connect() as conn, conn.cursor() as cur, open(out, "w") as f:
        cur.copy_expert(sql, f)
    return out


def fetch_weather(start: date, end: date) -> Path:
    out = artifact_path(f"shanghai_weather_{start.isoformat()}_{end.isoformat()}.json")
    # Open-Meteo archive 通常落后 1–5 天；超过最近可用日期会 400
    from datetime import datetime
    today = datetime.now().date()
    weather_end = min(end, today)
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude=31.2304&longitude=121.4737"
        f"&start_date={start.isoformat()}&end_date={weather_end.isoformat()}"
        "&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,"
        "precipitation_sum,rain_sum,weather_code&timezone=Asia%2FShanghai"
    )
    subprocess.run(["curl", "-L", "--fail", "--silent", "--show-error",
                    url, "-o", str(out)], check=True)
    return out


def build_calendar(start: date, end: date) -> Path:
    out = artifact_path(f"china_calendar_shanghai_{start.isoformat()}_{end.isoformat()}.csv")
    holidays: dict[date, str] = {}
    def span(a, b, name):
        d = a
        while d <= b:
            holidays[d] = name
            d += timedelta(days=1)
    # 与 artifacts 既有脚本一致（保持可复现）
    span(date(2025, 10, 1), date(2025, 10, 8), "国庆节/中秋节")
    span(date(2026, 1, 1), date(2026, 1, 3), "元旦")
    span(date(2026, 2, 15), date(2026, 2, 23), "春节")
    span(date(2026, 4, 4), date(2026, 4, 6), "清明节")
    span(date(2026, 5, 1), date(2026, 5, 5), "劳动节")
    span(date(2026, 6, 19), date(2026, 6, 21), "端午节")
    adjusted = {
        date(2025, 9, 28): "国庆节/中秋节调休",
        date(2025, 10, 11): "国庆节/中秋节调休",
        date(2026, 1, 4): "元旦调休",
        date(2026, 2, 14): "春节调休",
        date(2026, 2, 28): "春节调休",
        date(2026, 5, 9): "劳动节调休",
    }
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["date", "weekday", "is_weekend", "is_holiday",
                    "is_adjusted_workday", "holiday_name"])
        d = start
        while d <= end:
            w.writerow([d.isoformat(), d.strftime("%A"),
                        int(d.weekday() >= 5), int(d in holidays),
                        int(d in adjusted), adjusted.get(d, holidays.get(d, ""))])
            d += timedelta(days=1)
    return out


def merge_dataset(start: date, end: date, store_code: str) -> tuple[Path, dict]:
    import pandas as pd
    sales = artifact_path(f"{store_code}_daily_sales_{start.isoformat()}_{end.isoformat()}.csv")
    weather = artifact_path(f"shanghai_weather_{start.isoformat()}_{end.isoformat()}.json")
    cal = artifact_path(f"china_calendar_shanghai_{start.isoformat()}_{end.isoformat()}.csv")

    s = pd.read_csv(sales, parse_dates=["date"])
    c = pd.read_csv(cal, parse_dates=["date"])
    w = json.loads(weather.read_text())
    wd = pd.DataFrame({
        "date": pd.to_datetime(w["daily"]["time"]),
        "temp_mean_c": w["daily"]["temperature_2m_mean"],
        "temp_max_c": w["daily"]["temperature_2m_max"],
        "temp_min_c": w["daily"]["temperature_2m_min"],
        "precip_mm": w["daily"]["precipitation_sum"],
        "rain_mm": w["daily"]["rain_sum"],
        "weather_code": w["daily"]["weather_code"],
    })
    df = s.merge(c, on="date", how="left").merge(wd, on="date", how="left")
    df["rain_flag"] = (df["rain_mm"].fillna(0) > 0).astype(int)
    df["month"] = df["date"].dt.strftime("%Y-%m")
    df["dow"] = df["date"].dt.dayofweek.astype(str)

    out = artifact_path(f"{store_code}_daily_regression_dataset_{start.isoformat()}_{end.isoformat()}.csv")
    df.to_csv(out, index=False)
    meta = {
        "rows": int(len(df)),
        "order_total": int(df["order_count"].sum()) if "order_count" in df.columns else 0,
        "date_range": {"start": df["date"].min().date().isoformat(),
                       "end": df["date"].max().date().isoformat()},
        "weather_days": int(len(wd)),
        "calendar_days": int(len(c)),
        "features": [
            "avg_discount_rate_pct", "is_weekend", "is_holiday",
            "is_adjusted_workday", "temp_mean_c", "rain_flag",
            "C(dow)", "C(month)",
        ],
    }
    return out, meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--start", default="2025-08-01")
    parser.add_argument("--end", default="2026-07-31")
    parser.add_argument("--store-code", default="sh_xtd")
    args = parser.parse_args()

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    # run 行已由 04_run_pipeline.py 创建，此处不再重复 INSERT
    # 但如果 start/end 不同（单独调用 01_prepare），补齐 data_range
    with cm.connect() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE ops.pipeline_run
            SET data_range_start=COALESCE(data_range_start, %s),
                data_range_end=COALESCE(data_range_end, %s),
                pipeline=COALESCE(pipeline, 'prepare'),
                store_code=COALESCE(store_code, %s)
            WHERE run_id=%s
        """, (args.start, args.end, args.store_code, args.run_id))
        conn.commit()

    cancel_before = cm.is_cancel_requested(args.run_id)

    with step_context(args.run_id, "fetch_orders", 1,
                      detail={"start": args.start, "end": args.end}) as r:
        p = fetch_orders(start, end, args.store_code)
        rows = sum(1 for _ in open(p)) - 1
        r["rows_out"] = rows
        r["detail"] = {"file": str(p.name), "rows": rows}

    with step_context(args.run_id, "fetch_weather", 2,
                      detail={"start": args.start, "end": args.end}) as r:
        p = fetch_weather(start, end)
        r["detail"] = {"file": str(p.name)}

    with step_context(args.run_id, "build_calendar", 3,
                      detail={"start": args.start, "end": args.end}) as r:
        p = build_calendar(start, end)
        rows = sum(1 for _ in open(p)) - 1
        r["rows_out"] = rows
        r["detail"] = {"file": str(p.name), "rows": rows}

    with step_context(args.run_id, "merge_dataset", 4,
                      detail={"start": args.start, "end": args.end}) as r:
        p, meta = merge_dataset(start, end, args.store_code)
        r["rows_out"] = meta["rows"]
        r["detail"] = meta

    with step_context(args.run_id, "write_snapshot", 5) as r:
        p, meta = merge_dataset(start, end, args.store_code)
        cm.upsert_snapshot(
            version=args.version, kind="dataset_meta",
            store_code=args.store_code, payload=meta, run_id=args.run_id,
        )
        r["detail"] = {"version": args.version, "kind": "dataset_meta"}

    if cancel_before:
        cm.finish_pipeline_run(args.run_id, status="cancelled")
        print(f"[prepare] run {args.run_id} cancelled before start")
        sys.exit(2)

    cm.finish_pipeline_run(args.run_id, status="success",
                          warnings=["prepare 阶段不切换 is_active，需 train+publish 完成"])
    print(f"[prepare] run {args.run_id} version {args.version} success")


if __name__ == "__main__":
    main()