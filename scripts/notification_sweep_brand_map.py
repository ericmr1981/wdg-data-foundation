"""
跨品牌表名映射 — sweep 子任务用
建表时如发现实际表名与本文件不符,直接改这里

任务 3 探索: dev DB 中 bank_rule_map 是按 brand 拆的,不存在 ops.bank_rule_map
"""
from __future__ import annotations

BRAND_SOURCE_MAP: dict[str, dict[str, str | None]] = {
    'tamkoko': {
        'sales_table': 'brand_tamkoko_ods.income_detail',
        'sales_date_col': 'biz_date',
        'bank_table': 'brand_tamkoko_ods.bank_txn',
        'bank_date_col': 'txn_time',
        'unclassified_table': 'brand_tamkoko_dm.v_unclassified_top',
        'bank_rule_map': 'brand_tamkoko_cfg.bank_rule_map',
    },
    'gelatomiiix': {
        'sales_table': 'gelatomiiix_ods.income_detail',  # legacy ods, NOT brand_*
        'sales_date_col': 'biz_date',
        'bank_table': 'brand_gelatomiiix_ods.bank_txn',  # bank-side lives in brand_*
        'bank_date_col': 'txn_time',
        'unclassified_table': 'brand_gelatomiiix_dm.v_unclassified_top',
        'bank_rule_map': 'brand_gelatomiiix_cfg.bank_rule_map',
    },
    'bonjur': {
        'sales_table': 'bonjur_ods.income_detail',
        'sales_date_col': 'biz_date',
        'bank_table': 'bonjur_ods.bank_txn',
        'bank_date_col': 'txn_time',
        'unclassified_table': 'bonjur_dm.v_unclassified_top',
        'bank_rule_map': 'bonjur_cfg.bank_rule_map',
    },
}

DM_REVENUE_SOURCES: dict[str, str] = {
    'tamkoko':     'brand_tamkoko_dm.v_store_monthly_kpi',
    'gelatomiiix': 'brand_gelatomiiix_dm.v_store_monthly_kpi',
    'bonjur':      'bonjur_dm.v_store_monthly_kpi',
}


def get_brand_config(brand_code: str) -> dict[str, str | None]:
    if brand_code not in BRAND_SOURCE_MAP:
        raise KeyError(f'Unknown brand: {brand_code}. Known: {list(BRAND_SOURCE_MAP)}')
    return BRAND_SOURCE_MAP[brand_code]


def all_brand_codes() -> list[str]:
    return list(BRAND_SOURCE_MAP.keys())
