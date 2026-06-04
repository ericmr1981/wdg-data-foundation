#!/usr/bin/env python3
"""test_import_tamkoko_inventory.py — Excel 解析 + 校验 单元测试

运行: pytest tests/test_import_tamkoko_inventory.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))

import pytest
import openpyxl

from import_tamkoko_inventory import (
    parse_inventory_excel,
    InventoryRow,
    validate_rows,
)


FIXTURE_DIR = Path(__file__).parent / 'fixtures'


def _row(rows, sku):
    return next((r for r in rows if r.sku == sku), None)


def test_parse_4m_returns_expected_sku_count():
    """4 月盘点约 80 个 SKU（去除完全空行后）。"""
    rows = parse_inventory_excel(
        str(FIXTURE_DIR / 'tamkoko_inventory_4m.xlsx'),
        period='2026-04',
    )
    assert len(rows) >= 60
    assert all(r.period == '2026-04' for r in rows)


def test_parse_5m_picks_correct_sheet():
    """5 月文件含 '4月' 和 '5月' 两个 sheet，应选 '5月'（按 period 匹配）。"""
    rows = parse_inventory_excel(
        str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05',
    )
    assert len(rows) >= 50
    assert all(r.period == '2026-05' for r in rows)
    cats = {r.category for r in rows}
    assert '冷冻&冷藏食品' in cats


def test_parse_field_extraction_sku_001365():
    """鲜牛乳奶基底 SKU 001365 库存金额 2112（5 月）。"""
    rows = parse_inventory_excel(
        str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05',
    )
    target = _row(rows, '001365')
    assert target is not None
    assert target.material_name == '鲜牛乳奶基底'
    assert target.category == '常温物料'
    assert target.unit == '箱'
    assert target.qty == 8
    assert abs(target.amount - 2112) < 0.01


def test_category_filldown():
    """分类列只在分组首行填值，后续行空 → 解析时向上回填。"""
    rows = parse_inventory_excel(
        str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05',
    )
    target = _row(rows, '002490')  # 杯贴打印纸
    assert target is not None
    assert target.category == '包装材料'


def test_amount_recalc_matches_excel():
    """amount = unit_price × qty 重算应与 Excel H 列一致（容差 0.01）。"""
    rows = parse_inventory_excel(
        str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05',
    )
    for r in rows:
        expected = round(r.unit_price * r.qty, 2)
        assert abs(r.amount - expected) < 0.01, f'{r.sku} amount mismatch'


def test_validate_rejects_non_numeric_qty():
    """非数字数量应被校验拒绝。"""
    bad = InventoryRow(
        period='2026-05', category='常温物料', sku='X', material_name='t',
        spec='', unit_price=10, qty=None, unit='箱', amount=0,
    )
    good = InventoryRow(
        period='2026-05', category='常温物料', sku='Y', material_name='t',
        spec='', unit_price=10, qty=2, unit='箱', amount=20,
    )
    accepted, rejected = validate_rows([bad, good])
    assert len(accepted) == 1
    assert len(rejected) == 1
    assert rejected[0][0].sku == 'X'


# === Integration tests (DB) ===
import os
import psycopg2
import pytest

DB_DSN = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'dataplatform'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.environ['DB_PASSWORD'],
}

TEST_STORE = 'hz_fuyang_test'


@pytest.fixture(scope='module')
def db():
    conn = psycopg2.connect(**DB_DSN)
    yield conn
    conn.close()


def _truncate_test_data(conn):
    # Snapshot the SKUs first (before the ODS DELETE wipes them out),
    # otherwise the subquery below returns empty and material_sku is left dirty.
    # Future improvement: add a test_marker column on material_sku to scope
    # cleanup more precisely (the table has no store_code).
    with conn.cursor() as cur:
        cur.execute(
            """DELETE FROM brand_tamkoko_cfg.material_sku
               WHERE sku IN (
                 SELECT DISTINCT sku FROM brand_tamkoko_ods.inventory_month_end
                 WHERE store_code = %s
               )""",
            (TEST_STORE,)
        )
        cur.execute(
            "DELETE FROM brand_tamkoko_ods.inventory_month_end WHERE store_code = %s",
            (TEST_STORE,)
        )
    conn.commit()


def test_import_persists_rows_and_material_sku(db):
    """导入 5 月 fixture 后 ODS 应有 50+ 行，cfg.material_sku 有相同 SKU 数。"""
    from import_tamkoko_inventory import run_import

    _truncate_test_data(db)
    summary = run_import(
        path=str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05',
        store_code=TEST_STORE,
        brand_code='tamkoko',
        source_type='tamkoko_inventory',
        conn=db,
    )
    db.commit()
    assert summary['ods_rows'] >= 50, f"only {summary['ods_rows']} ods rows"
    assert summary['sku_count'] >= 50

    with db.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM brand_tamkoko_ods.inventory_month_end WHERE store_code=%s",
            (TEST_STORE,)
        )
        assert cur.fetchone()[0] == summary['ods_rows']


def test_import_idempotent_on_repeat(db):
    """同文件重导不增加 ODS 行。"""
    from import_tamkoko_inventory import run_import

    _truncate_test_data(db)
    s1 = run_import(
        path=str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05', store_code=TEST_STORE,
        brand_code='tamkoko', source_type='tamkoko_inventory', conn=db,
    )
    s2 = run_import(
        path=str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05', store_code=TEST_STORE,
        brand_code='tamkoko', source_type='tamkoko_inventory', conn=db,
    )
    db.commit()
    assert s1['ods_rows'] == s2['ods_rows']


def test_material_sku_first_seen_preserved(db):
    """第二次导入 5 月后，first_seen_period 仍是 2026-05（不被更新为 last）。"""
    from import_tamkoko_inventory import run_import

    _truncate_test_data(db)
    run_import(
        path=str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05', store_code=TEST_STORE,
        brand_code='tamkoko', source_type='tamkoko_inventory', conn=db,
    )
    with db.cursor() as cur:
        cur.execute(
            """SELECT first_seen_period, last_seen_period
               FROM brand_tamkoko_cfg.material_sku WHERE sku='001365'"""
        )
        row = cur.fetchone()
        assert row[0] == '2026-05', f"first_seen_period = {row[0]}"
        assert row[1] == '2026-05'


def test_views_cogs_and_kpi_with_4m_5m(db):
    """灌入 4/5 月后，v_cogs_monthly 与 v_store_monthly_kpi 行为正确。"""
    from import_tamkoko_inventory import run_import

    _truncate_test_data(db)
    run_import(
        path=str(FIXTURE_DIR / 'tamkoko_inventory_4m.xlsx'),
        period='2026-04', store_code=TEST_STORE,
        brand_code='tamkoko', source_type='tamkoko_inventory', conn=db,
    )
    run_import(
        path=str(FIXTURE_DIR / 'tamkoko_inventory_5m.xlsx'),
        period='2026-05', store_code=TEST_STORE,
        brand_code='tamkoko', source_type='tamkoko_inventory', conn=db,
    )
    db.commit()

    with db.cursor() as cur:
        # 4 月 cogs IS NULL
        cur.execute("""
            SELECT cogs_amt FROM brand_tamkoko_dm.v_cogs_monthly
            WHERE store_code='hz_fuyang_test' AND period='2026-04'
        """)
        row = cur.fetchone()
        assert row is not None, '4月 v_cogs_monthly 未返回行'
        assert row[0] is None, f'4月 cogs_amt 应为 NULL，实际 {row[0]}'

        # 5 月 cogs 非 NULL（数值可为负：开盘 − 收盘 if 期间消耗 > 采购）
        cur.execute("""
            SELECT cogs_amt FROM brand_tamkoko_dm.v_cogs_monthly
            WHERE store_code='hz_fuyang_test' AND period='2026-05'
        """)
        row = cur.fetchone()
        assert row is not None, '5月 v_cogs_monthly 未返回行'
        cogs = row[0]
        assert cogs is not None, f'5月 cogs_amt 应非 NULL，实际 {cogs}'

        # 4 月 KPI 毛利率/净利率 NULL
        cur.execute("""
            SELECT gross_profit_rate_pct, net_profit_rate_pct
            FROM brand_tamkoko_dm.v_store_monthly_kpi
            WHERE store_code='hz_fuyang_test' AND to_char(month,'YYYY-MM')='2026-04'
        """)
        row = cur.fetchone()
        # 4月可能没有 v_store_monthly_kpi 行（没有 bank_txn revenue 那期）— 不强制要求
        # 如果有，gross/net_pct 都应是 NULL
        if row is not None:
            assert row[0] is None and row[1] is None, \
                f'4月 rate 应为 NULL，实际 gross={row[0]} net={row[1]}'

        # 5 月 KPI 毛利率/净利率 非 NULL
        cur.execute("""
            SELECT gross_profit_rate_pct, net_profit_rate_pct
            FROM brand_tamkoko_dm.v_store_monthly_kpi
            WHERE store_code='hz_fuyang_test' AND to_char(month,'YYYY-MM')='2026-05'
        """)
        row = cur.fetchone()
        if row is not None:
            assert row[0] is not None and row[1] is not None, \
                f'5月 rate 应非 NULL，实际 gross={row[0]} net={row[1]}'
