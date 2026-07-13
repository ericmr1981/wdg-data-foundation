"""Tests for scripts/import_yufeng_bank_txn.py"""
import os
import sys
from pathlib import Path

# Set dummy DB_PASSWORD before importing the module (avoids KeyError at module load)
os.environ.setdefault("DB_PASSWORD", "dummy")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_PORT", "5432")
os.environ.setdefault("DB_NAME", "dataplatform")
os.environ.setdefault("DB_USER", "postgres")

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import import_yufeng_bank_txn as mod  # noqa: E402


def test_get_ods_schema_tamkoko():
    """get_ods_schema('tamkoko') must return brand_tamkoko_ods"""
    assert mod.get_ods_schema("tamkoko") == "brand_tamkoko_ods"
    assert mod.get_ods_schema("gelatomiiix") == "brand_gelatomiiix_ods"
    assert mod.get_ods_schema("bonjur") == "bonjur_ods"
    assert mod.get_ods_schema("yufeng") == "yufeng_ods"


def test_get_dm_schema_tamkoko():
    """get_dm_schema('tamkoko') must return brand_tamkoko_dm"""
    assert mod.get_dm_schema("tamkoko") == "brand_tamkoko_dm"
    assert mod.get_dm_schema("gelatomiiix") == "brand_gelatomiiix_dm"
    assert mod.get_dm_schema("bonjur") == "bonjur_dm"
    assert mod.get_dm_schema("yufeng") == "yufeng_dm"


def test_parse_path_tamkoko():
    """parse_path must correctly extract metadata from tamkoko bank file paths"""
    meta = mod.parse_path_bank("inputs/tamkoko/hz_fuyang/bank/2026-03/工行流水_202603.xlsx")
    assert meta["brand_code"] == "tamkoko"
    assert meta["store_code"] == "hz_fuyang"
    assert meta["source_type"] == "bank"
    assert meta["month"] == "2026-03"


def test_parse_path_tamkoko_wz_bjwxc():
    """parse_path must correctly extract metadata from tamkoko wz_bjwxc bank file paths"""
    meta = mod.parse_path_bank("inputs/tamkoko/wz_bjwxc/bank/2026-03/工行流水_202603.xlsx")
    assert meta["brand_code"] == "tamkoko"
    assert meta["store_code"] == "wz_bjwxc"
    assert meta["source_type"] == "bank"
    assert meta["month"] == "2026-03"


def test_parse_path_gelatomiiix():
    """parse_path must correctly extract metadata from gelatomiiix bank file paths"""
    meta = mod.parse_path_bank("inputs/gelatomiiix/sh_sc/bank/2026-03/工行流水_202603.xlsx")
    assert meta["brand_code"] == "gelatomiiix"
    assert meta["store_code"] == "sh_sc"
    assert meta["source_type"] == "bank"
    assert meta["month"] == "2026-03"


def test_parse_path_bonjur():
    """parse_path must correctly extract metadata from bonjur bank file paths"""
    meta = mod.parse_path_bank("inputs/bonjur/sh_wdg/bank/2026-03/工行流水_202603.xlsx")
    assert meta["brand_code"] == "bonjur"
    assert meta["store_code"] == "sh_wdg"
    assert meta["source_type"] == "bank"
    assert meta["month"] == "2026-03"


def test_parse_path_yufeng():
    """parse_path must correctly extract metadata from yufeng bank file paths"""
    meta = mod.parse_path_bank("inputs/yufeng/yf_gh/bank/2026-03/工行流水_202603.xlsx")
    assert meta["brand_code"] == "yufeng"
    assert meta["store_code"] == "yf_gh"
    assert meta["source_type"] == "bank"
    assert meta["month"] == "2026-03"


def test_parse_path_wrong_source_type():
    """parse_path must reject non-bank/sales source types"""
    with pytest.raises(ValueError, match="Unexpected source_type"):
        mod.parse_path_bank("inputs/tamkoko/hz_fuyang/inventory/2026-03/file.xlsx")


def test_parse_path_bad_month():
    """parse_path must reject invalid month formats"""
    with pytest.raises(ValueError, match="月份"):
        mod.parse_path_bank("inputs/tamkoko/hz_fuyang/bank/2026-3/file.xlsx")
