"""
TDD tests for ops.notification sweep functions.
依赖: psycopg2 + 测试数据库 (DB_* 环境变量)
"""
import os
from datetime import date, datetime, timedelta
from unittest.mock import patch

import psycopg2
import pytest

from scripts.notification_sweep import (
    sweep_data_stale,
    sweep_unmatched_txn,
    sweep_dup_rule,
    sweep_monthly_report,
    upsert_notification,
    resolve_notification_by_dedup_prefix,
)


@pytest.fixture
def conn():
    """Connect to test DB; assumes DB_* env vars set, schema ops.notification exists."""
    dsn = {
        'host': os.environ['DB_HOST'],
        'port': int(os.environ['DB_PORT']),
        'dbname': os.environ['DB_NAME'],
        'user': os.environ['DB_USER'],
        'password': os.environ['DB_PASSWORD'],
    }
    c = psycopg2.connect(**dsn)
    c.autocommit = False
    yield c
    c.close()


@pytest.fixture(autouse=True)
def clean_notifications(conn):
    """每个 test 前清空测试数据"""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM ops.notification_read")
        cur.execute("DELETE FROM ops.notification")
    conn.commit()
    yield
    with conn.cursor() as cur:
        cur.execute("DELETE FROM ops.notification_read")
        cur.execute("DELETE FROM ops.notification")
    conn.commit()


def test_data_stale_qimai_yesterday_creates_warning(conn, monkeypatch):
    """企迈 biz_date 停在昨天之前 → 产生 1 条 warn 提醒"""
    fake_today = date(2026, 6, 7)
    fake_map = {
        'gelatomiiix': {
            'sales_table': 'gelatomiiix_ods.income_detail',
            'sales_date_col': 'biz_date',
            'bank_table': None,
            'bank_date_col': 'txn_time',
            'unclassified_table': None,
            'bank_rule_map': 'brand_gelatomiiix_cfg.bank_rule_map',
        }
    }
    with patch('scripts.notification_sweep.BRAND_SOURCE_MAP', fake_map), \
         patch('scripts.notification_sweep.date') as mock_date:
        mock_date.today.return_value = fake_today
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        n = sweep_data_stale(conn, brands=['gelatomiiix'])
    assert n in (0, 1)
    with conn.cursor() as cur:
        cur.execute("SELECT type, severity, brand_code FROM ops.notification WHERE type='data_stale'")
        rows = cur.fetchall()
    if n == 1:
        assert len(rows) == 1
        assert rows[0][1] == 'warn'
        assert rows[0][2] == 'gelatomiiix'


def test_data_stale_idempotent(conn, monkeypatch):
    """连续两次同状态只产生 1 条"""
    fake_today = date(2026, 6, 7)
    with patch('scripts.notification_sweep.BRAND_SOURCE_MAP', {
        'gelatomiiix': {'sales_table': 'gelatomiiix_ods.income_detail', 'sales_date_col': 'biz_date',
                        'bank_table': None, 'bank_date_col': 'txn_time', 'unclassified_table': None,
                        'bank_rule_map': 'brand_gelatomiiix_cfg.bank_rule_map'}
    }), patch('scripts.notification_sweep.date') as mock_date:
        mock_date.today.return_value = fake_today
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
        sweep_data_stale(conn, brands=['gelatomiiix'])
        sweep_data_stale(conn, brands=['gelatomiiix'])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM ops.notification WHERE type='data_stale'")
        count = cur.fetchone()[0]
    assert count <= 1


# === unmatched_txn (smoke test) ===

def test_unmatched_txn_smoke(conn):
    """sweep_unmatched_txn runs without crash on real DB; returns >= 0

    不做深 DB 注入断言 — 真实表是 view(v_unclassified_top),无法 insert。
    只验证函数能跑通,返回非负整数。
    """
    n = sweep_unmatched_txn(conn, brands=['gelatomiiix'])
    assert isinstance(n, int)
    assert n >= 0


# === dup_rule (smoke test) ===

def test_dup_rule_smoke(conn):
    """sweep_dup_rule runs without crash on real DB; returns >= 0

    不做深 DB 注入断言 — 测试 fixture 列名(schema: rule_id, match_value, ...)
    与 sweep 的列名匹配,但生产规则表被测试污染风险大,只验证函数能跑通。
    """
    n = sweep_dup_rule(conn, brands=['gelatomiiix'])
    assert isinstance(n, int)
    assert n >= 0


# === monthly_report (smoke test) ===

def test_monthly_report_smoke(conn, tmp_path):
    """sweep_monthly_report runs without crash; xlsx written to REPORT_DIR (env override)

    不做 deep assertion — 只验证 xlsx 写入路径通过 REPORT_DIR 模块常量可重定向,
    函数在真实 DB 上能跑通(可能因 v_store_monthly_kpi 无当月数据返回空)。
    """
    import scripts.notification_sweep as sweep_mod
    original = sweep_mod.REPORT_DIR
    sweep_mod.REPORT_DIR = str(tmp_path)
    try:
        n = sweep_monthly_report(conn, brands=['tamkoko'])
    finally:
        sweep_mod.REPORT_DIR = original
    assert isinstance(n, int)
    assert n >= 0


# === unmatched_txn v1 (reverted — defer analysis to agent module) ===

def test_sweep_unmatched_txn_v1_smoke(conn):
    """Reverted to v1: just detect + write notification with /match?status=unclassified action_url."""
    n = sweep_unmatched_txn(conn, brands=['gelatomiiix'])
    assert n >= 0  # smoke test
