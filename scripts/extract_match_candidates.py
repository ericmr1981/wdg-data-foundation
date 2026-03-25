#!/usr/bin/env python3
# =============================================================================
# extract_match_candidates.py
# 用途：从 bank_txn 的 summary/memo/purpose 字段提取 match_value 候选片段
# 作者：Claude Code
# =============================================================================

import re
from typing import List, Tuple

# 中文停用词表
CHINESE_STOPWORDS = {
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '自己', '这', '那', '么', '她', '他', '它', '们', '把', '给', '从', '来', '为',
    '对', '但', '还', '能', '被', '让', '于', '与', '或', '而', '及', '以', '等',
    '已', '正在', '曾', '将', '可', '此', '其', '中', '后', '前', '所', '又', '之'
}

# 数字相关模式（用于去噪声）
NUMBER_PATTERNS = [
    r'\d{4}[-/年]\d{1,2}[-/月]\d{1,2}',  # 日期：2024-01-01, 2024年1月1日
    r'\d{1,3}([,，]\d{3})+([.。]\d+)?',  # 金额：1,234.56, 1，234.56
    r'\d+([.。]\d+)?元',                 # 金额：100元, 123.45元
    r'\d+\.\d+',                         # 小数
    r'\d{8,}',                           # 长数字序列
    r'[ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]+',                 # 罗马数字
]

# 常见分隔符
DELIMITERS = r'[,，\.。;；:：\s\n\r\t]+'


def is_number_string(s: str) -> bool:
    """检查字符串是否为纯数字（含小数点、中文数字）"""
    # 移除常见数字相关字符后检查
    cleaned = re.sub(r'[0-9０-９.．,，]', '', s)
    return len(cleaned) == 0 or s.isdigit() or s.isdecimal()


def is_noise(text: str) -> bool:
    """检查文本是否为噪声（数字、日期、金额）"""
    # 检查是否匹配数字模式
    for pattern in NUMBER_PATTERNS:
        if re.search(pattern, text):
            return True

    # 检查是否为纯数字
    if is_number_string(text):
        return True

    # 检查是否全为字母/数字混合（可能是账号等）
    if re.match(r'^[A-Za-z0-9]+$', text):
        return True

    return False


def tokenize(text: str) -> List[str]:
    """分词：按分隔符切分"""
    if not text:
        return []

    # 预处理：移除多余空白
    text = re.sub(r'\s+', ' ', str(text).strip())

    # 切分
    tokens = re.split(DELIMITERS, text)

    # 清理每个 token
    result = []
    for token in tokens:
        token = token.strip()
        if token:
            result.append(token)

    return result


def filter_candidates(candidates: List[str], min_length: int = 2) -> List[str]:
    """过滤候选：长度<2、纯数字、停用词"""
    result = []
    seen = set()

    for candidate in candidates:
        # 去重
        if candidate in seen:
            continue

        # 长度过滤
        if len(candidate) < min_length:
            continue

        # 纯数字过滤
        if is_number_string(candidate):
            continue

        # 停用词过滤
        if candidate in CHINESE_STOPWORDS:
            continue

        # 噪声过滤
        if is_noise(candidate):
            continue

        seen.add(candidate)
        result.append(candidate)

    return result


def score_candidate(candidate: str, original_text: str) -> float:
    """给候选词打分：优先选择有区分度的词"""
    score = 0.0

    # 长度加分（太长或太短都减分）
    if 3 <= len(candidate) <= 6:
        score += 2
    elif len(candidate) > 6:
        score += 1

    # 包含数字但不是纯数字（可能是规格、型号）加分
    if re.search(r'\d', candidate) and not is_number_string(candidate):
        score += 0.5

    # 中文优先
    if re.search(r'[\u4e00-\u9fff]', candidate):
        score += 1

    return score


def extract_match_candidates(
    counterparty_name: str = '',
    summary: str = '',
    memo: str = '',
    purpose: str = '',
    max_candidates: int = 8
) -> List[Tuple[str, float]]:
    """
    从银行流水的多个字段提取 match_value 候选

    Args:
        counterparty_name: 对方单位名称
        summary: 摘要
        memo: 备注
        purpose: 用途说明
        max_candidates: 最大候选数量

    Returns:
        List[Tuple[str, float]]: (候选词, 分数) 按分数降序排列
    """
    # 合并所有文本字段
    all_texts = [counterparty_name, summary, memo, purpose]
    combined_text = ' '.join(t for t in all_texts if t)

    # 分词
    tokens = tokenize(combined_text)

    # 过滤
    candidates = filter_candidates(tokens)

    # 评分并排序
    scored = []
    for candidate in candidates:
        score = score_candidate(candidate, combined_text)
        scored.append((candidate, score))

    # 按分数降序，截取前 max_candidates 个
    scored.sort(key=lambda x: -x[1])
    return scored[:max_candidates]


def extract_candidates_for_unclassified(
    bank_txn_data: dict,
    max_candidates: int = 8
) -> List[dict]:
    """
    为单条未分类流水提取候选（适合 API 返回格式）

    Args:
        bank_txn_data: 包含 counterparty_name, summary, memo, purpose 的字典
        max_candidates: 最大候选数量

    Returns:
        List[dict]: [{candidate: str, score: float}, ...]
    """
    candidates = extract_match_candidates(
        counterparty_name=bank_txn_data.get('counterparty_name', ''),
        summary=bank_txn_data.get('summary', ''),
        memo=bank_txn_data.get('memo', ''),
        purpose=bank_txn_data.get('purpose', ''),
        max_candidates=max_candidates
    )

    return [
        {'candidate': c, 'score': round(s, 2)}
        for c, s in candidates
    ]


# =============================================================================
# 测试入口
# =============================================================================
if __name__ == '__main__':
    # 测试用例
    test_cases = [
        {
            'counterparty_name': '北京钱袋宝支付技术有限公司',
            'summary': '美团-餐饮生意-收款-2024-01',
            'memo': '订单号: 1234567890, 金额: 158.50元',
            'purpose': '平台结算'
        },
        {
            'counterparty_name': '',
            'summary': '抖音月付-还款-1234',
            'memo': '',
            'purpose': ''
        },
        {
            'counterparty_name': '美团',
            'summary': '转账-工资-张三-20240115',
            'memo': '备注：员工工资',
            'purpose': '工资发放'
        }
    ]

    for i, txn in enumerate(test_cases, 1):
        print(f"\n{'='*60}")
        print(f"测试用例 {i}")
        print(f"{'='*60}")
        print(f"counterparty_name: {txn.get('counterparty_name')}")
        print(f"summary: {txn.get('summary')}")
        print(f"memo: {txn.get('memo')}")
        print(f"purpose: {txn.get('purpose')}")
        print("-" * 40)

        candidates = extract_candidates_for_unclassified(txn, max_candidates=8)
        print("候选 match_value:")
        for c in candidates:
            print(f"  - {c['candidate']} (score: {c['score']})")