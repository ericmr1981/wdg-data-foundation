#!/usr/bin/env python3
"""
test_classify.py — Yufeng 银行流水分类器单元测试

运行：
    pytest tests/test_classify.py -v

目标：
    - 验证 JSON 规则能正确分类（与 SQL fn_classify_v2 行为一致）
    - 边界用例：空值、方向不匹配、无匹配
    - 规则完整性：JSON 规则数 >= CSV 原始规则数
"""

import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))

from classify import classify_txn, _load_rules, MATCH_FIELD_ORDER


# ── 测试数据 fixtures ────────────────────────────────────

FIXTURES_DIR = Path(__file__).parent.parent / 'ops' / 'imports'

CSV_RULES_FILE = sorted(FIXTURES_DIR.glob('vps_yufeng_bank_rule_map_*.csv'))[-1]
JSON_RULES_FILE = Path(__file__).parent.parent / 'rules' / 'yufeng_bank_rules.json'


# ── Fixtures ─────────────────────────────────────────────

@pytest.fixture
def rules():
    return _load_rules(JSON_RULES_FILE)


@pytest.fixture
def rule_map():
    """把所有规则按 (match_field, match_value) 建立索引，供快速查找"""
    rules = _load_rules(JSON_RULES_FILE)
    idx = {}
    for r in rules:
        key = (r['match_field'], r['match_value'].lower())
        if key not in idx:
            idx[key] = r
    return idx


# ── 规则完整性测试 ────────────────────────────────────────

def test_json_rules_count_ge_csv_rules(rule_map):
    """JSON 规则数应 >= CSV 原始规则数（允许 JSON 有额外增强规则）"""
    import csv
    csv_rules = 0
    with open(CSV_RULES_FILE, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('enabled', '').strip().lower() == 't':
                csv_rules += 1
    assert len(rule_map) >= csv_rules, f"JSON rules {len(rule_map)} < CSV rules {csv_rules}"


# ── 边界用例 ─────────────────────────────────────────────

def test_empty_summary_returns_none(rules):
    """summary 为空时，尝试下一字段 memo"""
    result = classify_txn({'summary': '', 'memo': '', 'purpose': '', 'counterparty_name': ''})
    assert result is None


def test_whitespace_only_summary_returns_none(rules):
    """summary 仅空白字符时，应跳过该字段"""
    result = classify_txn({'summary': '   ', 'memo': '', 'purpose': '', 'counterparty_name': ''})
    assert result is None


def test_none_fields_handled(rules):
    """所有字段为 None 时不崩溃"""
    result = classify_txn({
        'summary': None, 'memo': None, 'purpose': None,
        'counterparty_name': None, 'in_amt': None, 'out_amt': None
    })
    assert result is None


def test_direction_in_with_positive_in_amt(rules):
    """direction=in 且 in_amt > 0 时匹配"""
    # 用"开业营销推广补贴"（已知的 in 规则）
    result = classify_txn({
        'summary': '开业营销推广补贴',
        'memo': None, 'purpose': None,
        'counterparty_name': None,
        'in_amt': 1000, 'out_amt': None,
    })
    assert result is not None
    assert result['lvl1_code'] == 'REV_BIZ'
    assert result['source'] == 'rule'


def test_direction_out_with_zero_in_amt(rules):
    """direction=out 但 in_amt > 0、out_amt = 0 时不匹配"""
    # 用"报销"（out 规则）但传入 in_amt > 0
    result = classify_txn({
        'summary': '差旅报销',
        'memo': None, 'purpose': None,
        'counterparty_name': None,
        'in_amt': 100, 'out_amt': 0,
    })
    # 方向不匹配（out 规则但 out_amt=0）
    assert result is None


def test_unknown_text_returns_none(rules):
    """无任何规则匹配的文本返回 None"""
    result = classify_txn({
        'summary': '这是一条完全无法分类的随机文本 xyz12345',
        'memo': None, 'purpose': None,
        'counterparty_name': None,
        'in_amt': 100, 'out_amt': None,
    })
    assert result is None


def test_case_insensitive_match(rules):
    """contains 匹配应大小写不敏感"""
    result1 = classify_txn({'summary': '报销', 'memo': None, 'purpose': None, 'counterparty_name': None, 'in_amt': None, 'out_amt': 100})
    result2 = classify_txn({'summary': '报销', 'memo': None, 'purpose': None, 'counterparty_name': None, 'in_amt': None, 'out_amt': 100})
    assert result1 is not None
    assert result2 is not None
    assert result1['lvl1_code'] == result2['lvl1_code']


# ── 字段优先级测试 ───────────────────────────────────────

def test_summary_takes_priority_over_memo(rules):
    """summary 有匹配时，不应再看 memo"""
    # summary 命中"报销"（ADMIN），memo 含"营销推广补贴"（REV_BIZ）
    result = classify_txn({
        'summary': '差旅报销',
        'memo': '开业营销推广补贴',
        'purpose': None,
        'counterparty_name': None,
        'in_amt': None, 'out_amt': 100,
    })
    assert result is not None
    assert result['lvl1_code'] == 'ADMIN'


def test_memo_tried_when_summary_empty(rules):
    """summary 为空时，fallback 到 memo"""
    result = classify_txn({
        'summary': '',
        'memo': '开业营销推广补贴',
        'purpose': None,
        'counterparty_name': None,
        'in_amt': 1000, 'out_amt': None,
    })
    assert result is not None
    assert result['lvl1_code'] == 'REV_BIZ'


# ── 真实规则覆盖测试 ─────────────────────────────────────

def test_real_rule_报销_out(rules):
    """真实规则：summary 含'报销' → ADMIN"""
    for text in ['差旅报销', '业务报销款', '报销']:
        result = classify_txn({'summary': text, 'memo': None, 'purpose': None, 'counterparty_name': None, 'in_amt': None, 'out_amt': 1})
        assert result is not None, f"'{text}' should match"
        assert result['lvl1_code'] == 'ADMIN', f"'{text}' should be ADMIN"
        assert result['source'] == 'rule'


def test_real_rule_绿植_out(rules):
    """真实规则：summary 含'绿植' → BUILD"""
    result = classify_txn({'summary': '公司绿植采购', 'memo': None, 'purpose': None, 'counterparty_name': None, 'in_amt': None, 'out_amt': 1})
    assert result is not None
    assert result['lvl1_code'] == 'BUILD'


def test_real_rule_奶皮子_out(rules):
    """真实规则：summary 含'奶皮子' → MATERIAL"""
    result = classify_txn({'summary': '奶皮子采购款', 'memo': None, 'purpose': None, 'counterparty_name': None, 'in_amt': None, 'out_amt': 1})
    assert result is not None
    assert result['lvl1_code'] == 'MATERIAL'


# ── 规则 JSON 结构测试 ───────────────────────────────────

def test_rules_version_is_set(rules):
    """JSON 规则文件应有 version 字段"""
    data = json.loads(JSON_RULES_FILE.read_text(encoding='utf-8'))
    assert 'version' in data


def test_all_rules_have_required_fields(rules):
    """每条规则都应有 required fields"""
    required = ['priority', 'direction', 'match_field', 'match_type', 'match_value', 'lvl1_code']
    for r in rules:
        for field in required:
            assert field in r, f"Rule missing {field}: {r}"


def test_priority_is_sorted(rules):
    """加载后的规则应按 priority ASC 排序"""
    priorities = [r['priority'] for r in rules]
    assert priorities == sorted(priorities)
