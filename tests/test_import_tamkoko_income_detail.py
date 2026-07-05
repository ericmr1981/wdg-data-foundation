"""Tests for scripts/import_tamkoko_income_detail.py"""
import csv
import sys
import tempfile
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import import_tamkoko_income_detail as mod  # noqa: E402


FIXTURE_CSV = Path(__file__).resolve().parent / "fixtures" / "tamkoko_income_sample.csv"


def test_parse_path_valid():
    meta = mod.parse_path("inputs/tamkoko/hz_fuyang/income_detail/2026-03/qimai_202603.csv")
    assert meta["brand_code"] == "tamkoko"
    assert meta["store_code"] == "hz_fuyang"
    assert meta["source_type"] == "income_detail"
    assert meta["month"] == "2026-03"


def test_parse_path_wrong_source_type():
    with pytest.raises(ValueError, match="source_type"):
        mod.parse_path("inputs/tamkoko/hz_fuyang/bank/2026-03/file.xlsx")


def test_parse_path_bad_month():
    with pytest.raises(ValueError, match="月份"):
        mod.parse_path("inputs/tamkoko/hz_fuyang/income_detail/2026-3/file.csv")


def test_extract_month_from_filename():
    assert mod.extract_month_from_filename("企迈 收入明细表 2026-02-01 至 2026-03-31.csv") == "2026-03"
    assert mod.extract_month_from_filename("营收 2026年3月.csv") == "2026-03"
    assert mod.extract_month_from_filename("random.csv") is None


def test_strip_backtick():
    assert mod.strip_backtick("`D001") == "D001"
    assert mod.strip_backtick("D001") == "D001"
    assert mod.strip_backtick("  `D001  ") == "D001"


def test_to_numeric():
    assert mod.to_numeric("1,234.50") == 1234.50
    assert mod.to_numeric("") == 0.0
    assert mod.to_numeric(None) == 0.0


def test_parse_date():
    assert mod.parse_date("2026-03-15") == "2026-03-15"
    assert mod.parse_date("2026/03/15") == "2026-03-15"
    assert mod.parse_date("") is None


def test_map_channel():
    assert mod.map_channel("微信支付") == "WECHAT"
    assert mod.map_channel("支付宝支付") == "ALIPAY"
    assert mod.map_channel("美团团购券") == "MEITUAN"
    assert mod.map_channel("抖音团购券") == "DOUYIN"
    assert mod.map_channel("淘宝闪购") == "TAOBAO"
    assert mod.map_channel("未知渠道") == "OTHER"
    assert mod.map_channel("") is None


def test_get_target_table():
    assert mod.get_target_table("tamkoko") == "brand_tamkoko_ods.income_detail"
    assert mod.get_target_table("bonjur") == "bonjur_ods.income_detail"
    assert mod.get_target_table("gelatomiiix") == "gelatomiiix_ods.income_detail"
    with pytest.raises(ValueError):
        mod.get_target_table("nonexistent")


def test_fixture_csv_exists():
    """sanity: fixture 文件存在且有 3 行数据"""
    assert FIXTURE_CSV.exists()
    with FIXTURE_CSV.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 3
    assert all(r["订单号"].startswith("`") for r in rows)
