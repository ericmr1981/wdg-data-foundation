#!/usr/bin/env python3
"""
classify.py — Yufeng 银行流水分类器（JSON 规则驱动）

功能：
  - 读取 rules/yufeng_bank_rules.json（版本化规则配置）
  - 对单条银行流水做分类，输出 lvl1_code / lvl2_code
  - 匹配顺序：summary → memo → purpose → counterparty_name（与 SQL fn_classify_v2 一致）

使用示例：
  from classify import classify_txn

  result = classify_txn({
      "summary": "给对方:深圳XX餐厅",
      "counterparty_name": None,
      "memo": None,
      "purpose": None,
      "in_amt": None,
      "out_amt": 500,
  })
  print(result)  # {"lvl1_code": "DINING", "lvl2_code": "RESTAURANT", "rule_id": 1234, "source": "rule"}
"""

import json
import re
from pathlib import Path
from typing import Optional

# ── 匹配顺序（与 SQL fn_classify_v2 一致）──
MATCH_FIELD_ORDER = ['summary', 'memo', 'purpose', 'counterparty_name']

# ── 规则加载（模块级缓存）──
_rules_cache: Optional[list[dict]] = None
_rules_version: Optional[str] = None


def _load_rules(rules_path: Optional[Path] = None) -> list[dict]:
    """加载 JSON 规则，按 priority ASC 排序（低 priority = 高优先级）"""
    global _rules_cache, _rules_version
    if _rules_cache is not None:
        return _rules_cache

    if rules_path is None:
        rules_path = Path(__file__).parent.parent / 'rules' / 'yufeng_bank_rules.json'

    with open(rules_path, encoding='utf-8') as f:
        data = json.load(f)

    _rules_version = data.get('version', 'unknown')
    rules = data.get('rules', [])
    # 按 priority 升序（数字越小优先级越高）
    rules.sort(key=lambda r: r['priority'])
    _rules_cache = rules
    return rules


def _matches(text: str, rule: dict) -> bool:
    """判断单条规则是否命中某文本字段"""
    match_type = rule['match_type']
    pattern = rule['match_value']

    if match_type == 'contains':
        return pattern.lower() in text.lower()
    elif match_type == 'exact':
        return text.lower() == pattern.lower()
    elif match_type == 'regex':
        try:
            return bool(re.search(pattern, text, flags=re.IGNORECASE))
        except re.error:
            return False
    return False


def _check_field2(txn: dict, rule: dict) -> bool:
    """检查 match_field2 AND 条件（可选）"""
    f2 = rule.get('match_field2')
    v2 = rule.get('match_value2')
    if not f2 or not v2:
        return True
    text = (txn.get(f2) or '').strip()
    return _matches(text, {**rule, 'match_value': v2, 'match_type': rule.get('match_type', 'contains')})


def _direction_matches(txn: dict, rule: dict) -> bool:
    """检查方向是否匹配（any / in / out）"""
    direction = rule['direction']
    if direction == 'any':
        return True
    in_amt = txn.get('in_amt')
    out_amt = txn.get('out_amt')
    if direction == 'in':
        return in_amt is not None and float(in_amt) > 0
    if direction == 'out':
        return out_amt is not None and float(out_amt) > 0
    return True


def classify_txn(txn: dict, rules_path: Optional[Path] = None) -> Optional[dict]:
    """
    对一条银行流水分类。

    Args:
        txn: 包含以下可选字段的字典：
             summary, memo, purpose, counterparty_name,
             in_amt, out_amt
        rules_path: 可选，规则 JSON 文件路径

    Returns:
        {"lvl1_code": "xxx", "lvl2_code": "xxx", "rule_id": 1234, "source": "rule"}
        如果无匹配：None
    """
    rules = _load_rules(rules_path)

    for rule in rules:
        # 方向过滤
        if not _direction_matches(txn, rule):
            continue

        # 按顺序检查字段
        for field in MATCH_FIELD_ORDER:
            text = (txn.get(field) or '').strip()
            if not text:
                continue

            if not _matches(text, rule):
                continue

            # AND 条件（可选）
            if not _check_field2(txn, rule):
                continue

            # 命中
            return {
                'lvl1_code': rule['lvl1_code'],
                'lvl2_code': rule.get('lvl2_code'),
                'rule_id': rule['rule_id'],
                'source': 'rule',
            }

    return None


# ── CLI 入口 ────────────────────────────────────────────
if __name__ == '__main__':
    import argparse, json, sys

    parser = argparse.ArgumentParser(description='Yufeng 银行流水分类器')
    parser.add_argument('--txn-json', help='单条流水的 JSON 字符串')
    parser.add_argument('--rules', help='规则 JSON 路径（默认 rules/yufeng_bank_rules.json）')
    args = parser.parse_args()

    if args.txn_json:
        txn = json.loads(args.txn_json)
        result = classify_txn(txn)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        # 内置测试用例
        test_cases = [
            {
                'name': '报销 (out)',
                'txn': {'summary': '给对方:差旅报销', 'counterparty_name': None, 'memo': None, 'purpose': None, 'in_amt': None, 'out_amt': 500},
                'expected_lvl1': 'ADMIN',
            },
            {
                'name': '营销补贴 (in)',
                'txn': {'summary': '开业营销推广补贴', 'counterparty_name': None, 'memo': None, 'purpose': None, 'in_amt': 1000, 'out_amt': None},
                'expected_lvl1': 'REV_BIZ',
            },
            {
                'name': '空 summary（无匹配）',
                'txn': {'summary': '', 'counterparty_name': None, 'memo': None, 'purpose': None, 'in_amt': None, 'out_amt': 100},
                'expected_lvl1': None,
            },
            {
                'name': '方向不匹配 (in_amt=0 但规则要求 out)',
                'txn': {'summary': '报销', 'counterparty_name': None, 'memo': None, 'purpose': None, 'in_amt': 0, 'out_amt': None},
                'expected_lvl1': None,
            },
        ]
        for tc in test_cases:
            result = classify_txn(tc['txn'])
            lvl1 = result['lvl1_code'] if result else None
            status = '✅' if lvl1 == tc['expected_lvl1'] else '❌'
            print(f"{status} {tc['name']}: got={lvl1} expected={tc['expected_lvl1']}")
