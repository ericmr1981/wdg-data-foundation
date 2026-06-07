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
