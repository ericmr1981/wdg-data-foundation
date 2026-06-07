"""
4 个 sweep 子任务实现。
所有函数签名: sweep_xxx(conn, brands: list[str] | None) -> int
返回: 本次新插入的 ops.notification 行数
"""
from __future__ import annotations

import hashlib
import logging
import os
import sys
from datetime import date, datetime, timedelta
from typing import Iterable

import psycopg2
from psycopg2 import extras

# 加载 brand map (用 importlib 避免与子模块名冲突)
import importlib.util
_brand_map_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'notification_sweep_brand_map.py')
_spec = importlib.util.spec_from_file_location('notification_sweep_brand_map', _brand_map_path)
_brand_map = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_brand_map)
BRAND_SOURCE_MAP = _brand_map.BRAND_SOURCE_MAP
all_brand_codes = _brand_map.all_brand_codes
get_brand_config = _brand_map.get_brand_config
DM_REVENUE_SOURCES = _brand_map.DM_REVENUE_SOURCES

log = logging.getLogger(__name__)


def upsert_notification(
    conn,
    *,
    type_: str,
    dedup_key: str,
    title: str,
    body: str,
    brand_code: str | None = None,
    severity: str = 'info',
    action_url: str | None = None,
    action_label: str | None = None,
    related_id: int | None = None,
) -> int:
    """
    插入一条通知(若 dedup_key 已存在 active 行,只更新 swept_at)。
    返回 1 = 新增, 0 = 已存在(刷新 swept_at)。
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ops.notification
                (type, brand_code, severity, title, body, action_url, action_label, related_id, dedup_key, swept_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (dedup_key) WHERE status = 'active'
            DO UPDATE SET swept_at = now()
            RETURNING (xmax = 0) AS inserted
            """,
            (type_, brand_code, severity, title, body, action_url, action_label, related_id, dedup_key),
        )
        row = cur.fetchone()
        conn.commit()
        return 1 if row and row[0] else 0


def resolve_notification_by_dedup_prefix(conn, prefix: str) -> int:
    """把所有 status='active' 且 dedup_key LIKE 'prefix%' 的通知置为 resolved。"""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ops.notification
            SET status = 'resolved', swept_at = now()
            WHERE status = 'active' AND dedup_key LIKE %s
            """,
            (prefix + '%',),
        )
        n = cur.rowcount
    conn.commit()
    return n


# === 1. data_stale ===

def _max_date(conn, table: str, col: str) -> date | None:
    with conn.cursor() as cur:
        cur.execute(f'SELECT MAX({col})::date FROM {table}')
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def sweep_data_stale(conn, brands: list[str] | None = None) -> int:
    """检查企迈 T-1 + 银行流水 5 日前"""
    target_brands = brands or all_brand_codes()
    today = date.today()
    yesterday = today - timedelta(days=1)
    new_count = 0

    for brand in target_brands:
        cfg = BRAND_SOURCE_MAP[brand]

        # 1) 企迈 T-1
        sales_tbl = cfg.get('sales_table')
        if sales_tbl:
            try:
                max_biz = _max_date(conn, sales_tbl, cfg['sales_date_col'])
            except psycopg2.Error as e:
                log.warning('sweep_data_stale: %s query failed: %s', sales_tbl, e)
                max_biz = None

            if max_biz is None:
                continue
            if max_biz < yesterday:
                new_count += upsert_notification(
                    conn,
                    type_='data_stale',
                    dedup_key=f'data_stale:{brand}:qimai:{today.isoformat()}',
                    title=f'{brand} 企迈数据未更新至 T-1',
                    body=f'上次数据停留在 {max_biz.isoformat()},已超过 1 天',
                    brand_code=brand,
                    severity='warn',
                    action_url=f'/sales?brand={brand}&stale=1',
                    action_label='查看',
                )
            else:
                resolve_notification_by_dedup_prefix(conn, f'data_stale:{brand}:qimai:')

        # 2) 银行流水 5 日前
        bank_tbl = cfg.get('bank_table')
        if bank_tbl:
            try:
                max_txn = _max_date(conn, bank_tbl, cfg['bank_date_col'])
            except psycopg2.Error as e:
                log.warning('sweep_data_stale: %s query failed: %s', bank_tbl, e)
                max_txn = None

            if today.day > 5 and max_txn is not None and max_txn < today.replace(day=1):
                new_count += upsert_notification(
                    conn,
                    type_='data_stale',
                    dedup_key=f'data_stale:{brand}:bank:{today.isoformat()}',
                    title=f'{brand} 银行流水未在每月 5 日前更新',
                    body=f'当前日期 {today.isoformat()},最新流水停留在 {max_txn.isoformat()}',
                    brand_code=brand,
                    severity='warn',
                    action_url=f'/match?brand={brand}&stale=1',
                    action_label='查看',
                )
            else:
                resolve_notification_by_dedup_prefix(conn, f'data_stale:{brand}:bank:')

    return new_count


# === 2. unmatched_txn (stubs, full impl in Task 5) ===

def sweep_unmatched_txn(conn, brands: list[str] | None = None) -> int:
    return 0


# === 3. dup_rule (stubs, full impl in Task 5) ===

def sweep_dup_rule(conn, brands: list[str] | None = None) -> int:
    return 0


# === 4. monthly_report (stubs, full impl in Task 5) ===

def sweep_monthly_report(conn, brands: list[str] | None = None) -> int:
    return 0
