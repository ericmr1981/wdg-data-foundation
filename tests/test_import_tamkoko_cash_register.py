"""Tests for scripts/import_tamkoko_cash_register.py"""
import csv
import sys
from pathlib import Path

import pytest

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
