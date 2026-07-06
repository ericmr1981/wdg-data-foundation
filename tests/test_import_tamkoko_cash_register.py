"""Tests for scripts/import_tamkoko_cash_register.py"""
import csv
import sys
from pathlib import Path

import pytest
import psycopg2

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import import_tamkoko_cash_register as mod  # noqa: E402


SAMPLE_CSV = Path(__file__).resolve().parent / "test_fixtures" / "cash_register_sample_3rows.csv"
REFUND_CSV = Path(__file__).resolve().parent / "test_fixtures" / "cash_register_with_refund.csv"


def test_parse_path_valid():
    meta = mod.parse_path("inputs/tamkoko/sh_sjh/sales/cash_register/2026-06/qimai.csv")
    assert meta["brand_code"] == "tamkoko"
    assert meta["store_code"] == "sh_sjh"
    assert meta["source_type"] == "cash_register"
    assert meta["month"] == "2026-06"


def test_parse_path_wrong_source_type():
    with pytest.raises(ValueError, match="source_type"):
        mod.parse_path("inputs/tamkoko/sh_sjh/income_detail/2026-06/file.csv")


def test_parse_path_bad_month():
    with pytest.raises(ValueError, match="月份"):
        mod.parse_path("inputs/tamkoko/sh_sjh/sales/cash_register/2026-6/file.csv")


def test_strip_backtick():
    assert mod.strip_backtick("`D001") == "D001"
    assert mod.strip_backtick("D001") == "D001"
    assert mod.strip_backtick("  `D001  ") == "D001"


def test_to_numeric():
    assert mod.to_numeric("1,234.50") == 1234.50
    assert mod.to_numeric("") == 0.0
    assert mod.to_numeric(None) == 0.0
    assert mod.to_numeric("-50.00") == -50.00


def test_parse_date():
    assert mod.parse_date("2026-06-15") == "2026-06-15"
    assert mod.parse_date("2026/06/15") == "2026-06-15"
    assert mod.parse_date("") is None


def test_aggregate_by_order_no_merges_refund_rows():
    """同订单号的多行(正+负退款)SUM 后得净订单"""
    with REFUND_CSV.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    aggregated = mod.aggregate_by_order_no(rows)
    assert len(aggregated) == 2, f"应有 2 个净订单,实际 {len(aggregated)}"
    by_order_no = {r["order_no"]: r for r in aggregated}
    refund = by_order_no["`D00200000000000000001"]
    assert refund["gross_amt"] == 0.0
    assert refund["revenue_amt"] == 0.0
    assert refund["net_amt"] == 0.0
    assert refund["qty"] == 0.0
    normal = by_order_no["`D00200000000000000002"]
    assert normal["gross_amt"] == 30.0
    assert normal["revenue_amt"] == 28.0


def test_aggregate_preserves_single_rows():
    """非退款单行原样保留"""
    with SAMPLE_CSV.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    aggregated = mod.aggregate_by_order_no(rows)
    assert len(aggregated) == 3
    assert all(r["gross_amt"] > 0 for r in aggregated)


def test_aggregate_skips_summary_row():
    """含 汇总: 行的 CSV 应跳过"""
    summary_csv = SAMPLE_CSV.parent / "_tmp_summary.csv"
    content = SAMPLE_CSV.read_text(encoding="utf-8-sig") + "汇总：,--,--,58.00,56.90,1.10,--,--,--,55.90,3\n"
    summary_csv.write_text(content, encoding="utf-8-sig")
    try:
        with summary_csv.open(encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        aggregated = mod.aggregate_by_order_no(rows)
        assert len(aggregated) == 3, f"汇总行应跳过,实际 {len(aggregated)} 净订单"
    finally:
        summary_csv.unlink()


def test_sample_fixture_has_backtick_order_no():
    """sanity: fixture 文件存在且订单号都带反引号"""
    assert SAMPLE_CSV.exists()
    with SAMPLE_CSV.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 3
    assert all(r["订单号"].startswith("`") for r in rows)


def test_is_already_imported_returns_id_when_success(monkeypatch):
    """SHA256 命中且 status='success' 时返回 source_file_id,主流程据此 SKIPPED"""
    captured = {"calls": []}

    class FakeCursor:
        def execute(self, sql, params=None):
            captured["calls"].append((sql, params))

        def fetchone(self):
            return (42,)  # 已存在的 source_file_id

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeConn:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(mod, "_get_db_config", lambda: {"host": "x"})
    result = mod.is_already_imported(FakeConn(), "abc123hash")
    assert result == 42


def test_is_already_imported_returns_none_when_new(monkeypatch):
    """SHA256 未命中或 status != 'success' 时返回 None"""

    class FakeCursor:
        def execute(self, sql, params=None):
            pass

        def fetchone(self):
            return None

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeConn:
        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr(mod, "_get_db_config", lambda: {"host": "x"})
    assert mod.is_already_imported(FakeConn(), "newhash") is None


def test_replace_existing_for_period_deletes_old_files(monkeypatch):
    """replace=true 时按 ODS 中 biz_date 年/月判定旧 source_file 并删除"""
    executed = []

    class FakeCursor:
        def execute(self, sql, params=None):
            executed.append((sql, params))

        def fetchall(self):
            # 模拟:旧月份有 2 个 source_file_id
            return [(101,), (102,)]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeConn:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            pass

    monkeypatch.setattr(mod, "_get_db_config", lambda: {"host": "x"})
    mod.replace_existing_for_period(FakeConn(), "sh_sjh", "2026-06-15")

    # 期望:先 SELECT 找旧 source_file_id,再 DELETE ingest_file(CASCADE 清 ODS)
    assert any("SELECT DISTINCT source_file_id" in s[0] for s in executed)
    assert any("DELETE FROM raw.ingest_file" in s[0] and 101 in (s[1] or ()) for s in executed) \
        or any("DELETE FROM raw.ingest_file" in s[0] for s in executed)


def _has_db() -> bool:
    import os
    return bool(os.environ.get("DB_PASSWORD"))


@pytest.mark.integration
def test_import_one_file_writes_ods_rows(tmp_path, monkeypatch):
    """用 tests/test_fixtures/cash_register_sample_3rows.csv 跑 import_one_file,
    验证 ODS 写入 3 行(3 个净订单,无退款)"""
    # 这需要真 DB,标记 integration;若环境无 DB 可 skip
    if not _has_db():
        pytest.skip("需要 DATABASE 环境变量 DB_PASSWORD 连接到本地 PG")

    import os
    monkeypatch.setenv("CASH_REGISTER_STORE_CODE", "sh_sjh")
    monkeypatch.setenv("CASH_REGISTER_STORE_NAME", "上海世纪汇店")

    conn = psycopg2.connect(**mod._get_db_config())
    try:
        # 清测试 store 的旧数据(避免污染)
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM raw.ingest_file WHERE brand_code='tamkoko' AND source_type='cash_register' AND file_hash=%s",
                (mod.calculate_sha256(str(SAMPLE_CSV)),),
            )
            conn.commit()

        meta = {
            "brand_code": "tamkoko",
            "store_code": "sh_sjh",
            "source_type": "cash_register",
            "month": "2026-06",
            "file_name": SAMPLE_CSV.name,
            "file_path": str(SAMPLE_CSV),
        }
        result = mod.import_one_file(conn, meta, replace=False)

        assert result["skipped"] is False
        assert result["row_count"] == 3
        assert result["source_file_id"] > 0

        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM brand_tamkoko_ods.cash_register_order WHERE source_file_id = %s",
                (result["source_file_id"],),
            )
            (n,) = cur.fetchone()
            assert n == 3

        # 二次运行 → SKIPPED
        result2 = mod.import_one_file(conn, meta, replace=False)
        assert result2["skipped"] is True
        assert result2["source_file_id"] == result["source_file_id"]
    finally:
        # Teardown: clean up test data so we don't pollute the DB across runs.
        # ON DELETE CASCADE on cash_register_order.source_file_id clears ODS rows.
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM raw.ingest_file WHERE brand_code='tamkoko' AND source_type='cash_register' AND file_hash=%s",
                    (mod.calculate_sha256(str(SAMPLE_CSV)),),
                )
                conn.commit()
        except Exception:
            pass
        conn.close()


@pytest.mark.integration
def test_import_one_file_with_refund_merges_rows(tmp_path, monkeypatch):
    """退款 fixture 应合并为 1 个净订单(SUM 后全 0)+ 1 个普通订单"""
    if not _has_db():
        pytest.skip("需要 DATABASE 环境变量 DB_PASSWORD 连接到本地 PG")

    import os
    monkeypatch.setenv("CASH_REGISTER_STORE_CODE", "sh_sjh")
    monkeypatch.setenv("CASH_REGISTER_STORE_NAME", "上海世纪汇店")

    conn = psycopg2.connect(**mod._get_db_config())
    try:
        # 用 refund fixture
        meta = {
            "brand_code": "tamkoko",
            "store_code": "sh_sjh",
            "source_type": "cash_register",
            "month": "2026-06",
            "file_name": REFUND_CSV.name,
            "file_path": str(REFUND_CSV),
        }
        # 清旧 hash
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM raw.ingest_file WHERE brand_code='tamkoko' AND source_type='cash_register' AND file_hash=%s",
                (mod.calculate_sha256(str(REFUND_CSV)),),
            )
            conn.commit()

        result = mod.import_one_file(conn, meta, replace=False)
        assert result["row_count"] == 2, f"应为 2 个净订单(1 退款合并 + 1 普通),实际 {result['row_count']}"

        with conn.cursor() as cur:
            cur.execute(
                "SELECT order_no, gross_amt, revenue_amt, net_amt, qty FROM brand_tamkoko_ods.cash_register_order WHERE source_file_id = %s ORDER BY order_no",
                (result["source_file_id"],),
            )
            rows = cur.fetchall()
        # 退款订单 SUM 后为 0
        refund_row = next(r for r in rows if r[0].endswith("001"))
        assert refund_row[1] == 0.0  # gross
        assert refund_row[2] == 0.0  # revenue
        assert refund_row[3] == 0.0  # net
        assert refund_row[4] == 0.0  # qty
    finally:
        # Teardown: clean up test data (ON DELETE CASCADE clears ODS rows).
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM raw.ingest_file WHERE brand_code='tamkoko' AND source_type='cash_register' AND file_hash=%s",
                    (mod.calculate_sha256(str(REFUND_CSV)),),
                )
                conn.commit()
        except Exception:
            pass
        conn.close()
