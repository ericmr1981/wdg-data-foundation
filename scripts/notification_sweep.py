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

import openpyxl

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

# 月报 xlsx 输出目录(可由 WDG_REPORT_DIR 环境变量覆盖,便于测试用 tmp_path)
REPORT_DIR = os.environ.get('WDG_REPORT_DIR', '/var/wdg/reports')


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


# === 2. unmatched_txn ===

def sweep_unmatched_txn(conn, brands: list[str] | None = None) -> int:
    target_brands = brands or all_brand_codes()
    today = date.today().isoformat()
    new_count = 0

    for brand in target_brands:
        cfg = BRAND_SOURCE_MAP[brand]
        unclassified = cfg.get('unclassified_table')
        if not unclassified:
            continue
        with conn.cursor() as cur:
            try:
                cur.execute(f'SELECT COUNT(*) FROM {unclassified}')
                count = cur.fetchone()[0]
            except psycopg2.Error as e:
                log.warning('sweep_unmatched_txn: %s failed: %s', unclassified, e)
                count = 0

        if count > 0:
            new_count += upsert_notification(
                conn,
                type_='unmatched_txn',
                dedup_key=f'unmatched_txn:{brand}:{today}',
                title=f'{brand} 有 {count} 条未配条目',
                body=f'{unclassified} 当前 {count} 条未分类,需分析匹配',
                brand_code=brand,
                severity='warn',
                action_url=f'/match?brand={brand}&status=unclassified',
                action_label='分析匹配',
            )
        else:
            resolve_notification_by_dedup_prefix(conn, f'unmatched_txn:{brand}:')

    return new_count


# === 3. dup_rule ===

def _normalize_pattern(p: str) -> str:
    return ' '.join((p or '').lower().split())


def _pattern_hash(p: str) -> str:
    return hashlib.sha256(_normalize_pattern(p).encode('utf-8')).hexdigest()[:16]


def sweep_dup_rule(conn, brands: list[str] | None = None) -> int:
    """检测 bank_rule_map 重复 pattern;按 brand 路由到 {cfg_schema}.bank_rule_map"""
    target_brands = brands or all_brand_codes()
    new_count = 0

    for brand in target_brands:
        cfg = BRAND_SOURCE_MAP[brand]
        rule_map_table = cfg.get('bank_rule_map')
        if not rule_map_table:
            continue
        with conn.cursor() as cur:
            try:
                cur.execute(
                    f'SELECT rule_id, match_value, created_at FROM {rule_map_table} ORDER BY created_at DESC, rule_id DESC'
                )
                rows = cur.fetchall()
            except psycopg2.Error as e:
                log.warning('sweep_dup_rule: %s failed: %s', rule_map_table, e)
                continue

        # 按 pattern_hash 分组(match_value 充当 pattern — match_value 是规则的"匹配模式")
        groups: dict[str, list] = {}
        for rid, pattern, created in rows:
            h = _pattern_hash(pattern)
            groups.setdefault(h, []).append((rid, pattern, created))

        has_dup = False
        for h, items in groups.items():
            if len(items) < 2:
                continue
            has_dup = True
            # 排序: created_at DESC, rule_id DESC → 第一条为保留
            items.sort(key=lambda x: (x[2] or datetime.min, x[0]), reverse=True)
            keep = items[0]
            disable_count = len(items) - 1

            new_count += upsert_notification(
                conn,
                type_='dup_rule',
                dedup_key=f'dup_rule:{brand}:{h}',
                title=f'{brand} 有 {len(items)} 条重复匹配规则',
                body=f'pattern_hash={h},推荐保留规则 #{keep[0]},禁用 {disable_count} 条',
                brand_code=brand,
                severity='warn',
                action_url=f'/rules?brand={brand}&dup_hash={h}',
                action_label='查看',
                related_id=None,
            )

        if not has_dup:
            resolve_notification_by_dedup_prefix(conn, f'dup_rule:{brand}:')
    return new_count


# === 4. monthly_report ===

def sweep_monthly_report(conn, brands: list[str] | None = None) -> int:
    """生成上月月报 xlsx"""
    from pathlib import Path
    today = date.today()
    if today.month == 1:
        period = date(today.year - 1, 12, 1)
    else:
        period = date(today.year, today.month - 1, 1)
    period_str = period.strftime('%Y-%m')

    target_brands = brands or list(DM_REVENUE_SOURCES.keys())
    new_count = 0

    for brand in target_brands:
        dm_view = DM_REVENUE_SOURCES.get(brand)
        if not dm_view:
            continue

        # 1) 检查是否已存在
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, file_name FROM ops.report_file
                WHERE brand_code = %s AND period = %s AND report_type = 'monthly_overview'
                """,
                (brand, period),
            )
            existing = cur.fetchone()

        if existing:
            report_id = existing[0]
            file_name = existing[1]
        else:
            # 2) 从 DM 视图聚合数据
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f'SELECT month, store_code, revenue_amt, cost_amt, expense_amt FROM {dm_view} '
                        f'WHERE month = %s ORDER BY store_code',
                        (period,),
                    )
                    rows = cur.fetchall()
            except psycopg2.Error as e:
                log.warning('sweep_monthly_report: %s query failed: %s', dm_view, e)
                rows = []

            # 3) 写 xlsx
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = period_str
            ws.append(['门店', '月份', '营收', '成本', '费用'])
            for r in rows:
                ws.append(list(r))

            out_dir = Path(REPORT_DIR) / brand
            out_dir.mkdir(parents=True, exist_ok=True)
            file_name = f'{period_str}_{brand}_monthly.xlsx'
            file_path = out_dir / file_name
            wb.save(file_path)

            # 4) 写 report_file
            file_bytes = file_path.read_bytes()
            file_hash = hashlib.sha256(file_bytes).hexdigest()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ops.report_file
                        (brand_code, period, report_type, file_name, file_path, file_hash, file_size)
                    VALUES (%s, %s, 'monthly_overview', %s, %s, %s, %s)
                    ON CONFLICT (brand_code, period, report_type) DO NOTHING
                    RETURNING id
                    """,
                    (brand, period, file_name, str(file_path), file_hash, len(file_bytes)),
                )
                row = cur.fetchone()
                conn.commit()
                if not row:
                    with conn.cursor() as cur2:
                        cur2.execute(
                            'SELECT id FROM ops.report_file WHERE brand_code=%s AND period=%s AND report_type=%s',
                            (brand, period, 'monthly_overview'),
                        )
                        row = cur2.fetchone()
                report_id = row[0]

        new_count += upsert_notification(
            conn,
            type_='monthly_report',
            dedup_key=f'monthly_report:{brand}:{period_str}',
            title=f'{brand} {period_str} 月报已生成',
            body=f'点击下载 Excel 报表',
            brand_code=brand,
            severity='info',
            action_url=f'/api/reports/{report_id}',
            action_label='下载 Excel',
            related_id=report_id,
        )

    return new_count
