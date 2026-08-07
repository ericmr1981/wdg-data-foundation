"""Tests for scripts/import_tamkoko_income_detail.py"""
import csv
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import import_tamkoko_income_detail as mod  # noqa: E402


FIXTURE_CSV = Path(__file__).resolve().parent / "fixtures" / "tamkoko_income_sample.csv"


def test_parse_path_valid():
    meta = mod.parse_path("inputs/tamkoko/hz_fuyang/income/2026-03/qimai_202603.csv", "income")
    assert meta["brand_code"] == "tamkoko"
    assert meta["store_code"] == "hz_fuyang"
    assert meta["source_type"] == "income"
    assert meta["month"] == "2026-03"


def test_parse_path_wrong_source_type():
    with pytest.raises(ValueError, match="source_type"):
        mod.parse_path("inputs/tamkoko/hz_fuyang/bank/2026-03/file.xlsx", "income")


def test_parse_path_bad_month():
    with pytest.raises(ValueError, match="月份"):
        mod.parse_path("inputs/tamkoko/hz_fuyang/income/2026-3/file.csv", "income")


def test_source_type_matches_ui_upload_convention():
    """UI 上传 source='income'，落盘 inputs/{brand}/{store}/income/{YYYY-MM}/（issue #41）"""
    assert mod.SOURCE_TYPE == "income"


def test_strip_backtick():
    assert mod.strip_backtick("`D001") == "D001"
    assert mod.strip_backtick("D001") == "D001"
    assert mod.strip_backtick("  `D001  ") == "D001"


def test_strip_backtick_none_safe():
    """issue #41 bug 3: CSV 空字段曾崩 AttributeError"""
    assert mod.strip_backtick(None) is None
    assert mod.strip_backtick("") == ""
    assert mod.strip_backtick("--") == "--"


def test_to_numeric():
    assert mod.to_numeric("1,234.50") == 1234.50
    assert mod.to_numeric("") == 0.0
    assert mod.to_numeric(None) == 0.0
    assert mod.to_numeric("--") == 0.0


def test_parse_date():
    assert mod.parse_date("2026-03-15") == "2026-03-15"
    assert mod.parse_date("2026/03/15") == "2026-03-15"
    assert mod.parse_date("") is None


def test_get_target_table():
    assert mod.get_target_table("tamkoko") == "brand_tamkoko_ods.income_detail"
    assert mod.get_target_table("bonjur") == "bonjur_ods.income_detail"
    assert mod.get_target_table("gelatomiiix") == "gelatomiiix_ods.income_detail"
    with pytest.raises(ValueError):
        mod.get_target_table("nonexistent")


def test_columns_match_28_col_schema():
    """COLUMNS 必须与实际表 28 列新 schema 一致（issue #41 bug 4）"""
    assert len(mod.COLUMNS) == 26  # 28 列中 id/created_at 由 DB 生成
    assert "order_no_clean" in mod.COLUMNS
    assert "brand_name" not in mod.COLUMNS
    assert "city" not in mod.COLUMNS
    assert "channel" not in mod.COLUMNS
    assert "order_source" not in mod.COLUMNS
    for col in ("store_code", "store_name", "biz_date", "order_no", "order_no_clean",
                "pay_time", "order_time", "revenue_amt", "net_amt", "gross_amt",
                "discount_amt", "overflow_amt", "coupon_fee", "payment_methods",
                "third_party_txn_no", "third_party_order_no", "merchant_order_no",
                "coupon_id", "biz_source", "order_type", "is_refund",
                "is_member_payment", "member_id", "member_phone",
                "source_file", "source_file_id"):
        assert col in mod.COLUMNS


def test_transform_row_full_mapping():
    r = {
        "订单号": "`D260301001",
        "营业日期": "2026-03-01",
        "支付时间": "2026-03-01 12:30:00",
        "下单时间": "2026-03-01 12:28:00",
        "营业收入": "98.50",
        "营业净收": "96.00",
        "营业额": "100.00",
        "优惠总额": "1.50",
        "溢收金额": "0.00",
        "团购券手续费": "0.50",
        "结账方式拆分": "微信支付,支付宝支付",
        "三方支付流水号": "`WX260301001",
        "三方订单号": "`T260301001",
        "商户订单号": "M260301001",
        "三方券id": "C001",
        "订单来源": "企迈数店POS",
        "订单类型": "堂食",
        "是否反结": "否",
        "会员id": "`M001",
        "用户手机号": "13800000000",
        "门店名称": "富阳店",
    }
    row = mod.transform_row(r, "hz_fuyang", "qimai_202603.csv")
    assert row is not None
    assert row["store_code"] == "hz_fuyang"
    assert row["store_name"] == "富阳店"
    assert row["order_no"] == "`D260301001"
    assert row["order_no_clean"] == "D260301001"
    assert row["biz_date"] == "2026-03-01"
    assert row["pay_time"] is not None and row["pay_time"].year == 2026
    assert row["revenue_amt"] == 98.50
    assert row["discount_amt"] == 1.50
    assert row["coupon_fee"] == 0.50
    assert row["payment_methods"] == ["微信支付", "支付宝支付"]
    assert row["third_party_txn_no"] == "WX260301001"
    assert row["third_party_order_no"] == "T260301001"
    assert row["merchant_order_no"] == "M260301001"
    assert row["coupon_id"] == "C001"
    assert row["biz_source"] == "企迈数店POS"
    assert row["order_type"] == "堂食"
    assert row["is_refund"] is False
    assert row["is_member_payment"] is False
    assert row["member_id"] == "M001"
    assert row["member_phone"] == "13800000000"


def test_transform_row_none_fields_safe():
    """issue #41 bug 3: 三方支付流水号等字段为空时不应崩"""
    r = {
        "订单号": "`D260301002",
        "营业日期": "2026-03-01",
        "三方支付流水号": "",
        "结账方式拆分": "微信支付",
        "会员id": "--",
    }
    row = mod.transform_row(r, "hz_fuyang", "q.csv")
    assert row is not None
    assert row["third_party_txn_no"] is None
    assert row["member_id"] is None
    assert row["member_phone"] is None
    assert row["payment_methods"] == ["微信支付"]


def test_transform_row_member_payment_excluded_from_methods():
    """会员快速支付不入 payment_methods，标记 is_member_payment"""
    r = {
        "订单号": "`D260301003",
        "营业日期": "2026-03-01",
        "结账方式拆分": "会员快速支付",
    }
    row = mod.transform_row(r, "hz_fuyang", "q.csv")
    assert row is not None
    assert row["is_member_payment"] is True
    assert row["payment_methods"] is None


def test_transform_row_invalid_rows_return_none():
    assert mod.transform_row({}, "hz_fuyang", "q.csv") is None
    assert mod.transform_row({"订单号": "`D1", "营业日期": "bad-date"}, "hz_fuyang", "q.csv") is None


def test_fixture_csv_exists():
    """sanity: fixture 文件存在且有 3 行数据"""
    assert FIXTURE_CSV.exists()
    with FIXTURE_CSV.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 3
    assert all(r["订单号"].startswith("`") for r in rows)


def test_fixture_rows_transform():
    """fixture 3 行全部可转换，映射 28 列新 schema（issue #41 bug 4 回归锁死）"""
    with FIXTURE_CSV.open() as f:
        rows = list(csv.DictReader(f))
    transformed = [mod.transform_row(r, "hz_fuyang", FIXTURE_CSV.name) for r in rows]
    assert len(transformed) == 3
    assert all(t is not None for t in transformed)
    assert all(t["order_no_clean"] == t["order_no"].strip("`") for t in transformed)
    # 第 1 行：完整字段
    t0 = transformed[0]
    assert t0["pay_time"] is not None
    assert t0["discount_amt"] == 1.50
    assert t0["coupon_fee"] == 0.50
    assert t0["third_party_order_no"] == "T260301001"
    assert t0["merchant_order_no"] == "M260301001"
    assert t0["coupon_id"] == "C001"
    assert t0["member_id"] == "M001"
    assert t0["member_phone"] == "13800000001"
    assert t0["is_refund"] is False
    assert t0["is_member_payment"] is False
    # 第 2 行：会员/三方字段为空
    t1 = transformed[1]
    assert t1["member_id"] is None
    assert t1["third_party_order_no"] is None
    # 第 3 行：会员快速支付 + 反结
    t2 = transformed[2]
    assert t2["is_member_payment"] is True
    assert t2["payment_methods"] is None
    assert t2["is_refund"] is True
