"""
导入脚本的门店合法性校验工具。

核心约束：跨品牌导入是历史 bug 的根源（gelatomiiix_ods.income_detail 曾被
tamkoko 的 TK00132 写脏 31,676 行）。所有写入 *_ods.* 表的导入脚本必须在
import 之前确认 store_code ∈ 该 brand 在 ops.stores 中的合法集合。

提供：
- load_valid_stores(brand_code, conn) -> set[str]
- validate_store_or_die(brand_code, store_code, conn)  -> None (raise)
- safe_resolve_store(row_store, override, brand_code, conn) -> tuple[str, str]
    返回 (resolved_store_code, source)  source ∈ {override, csv, fallback}
    若 fallback 必须落在合法集合里；若 CSV 内的 store_code 不在合法集合
    抛 CrossBrandStoreError 让上层决定 skip / 报错。
"""

from __future__ import annotations

import os
from typing import Optional

import psycopg2


class CrossBrandStoreError(ValueError):
    """CSV 内的 store_code 不属于该 brand 的合法 store 集合。"""


def _query_valid_stores(brand_code: str, conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT store_code FROM ops.stores WHERE brand_code = %s AND enabled = true",
            (brand_code,),
        )
        return {row[0] for row in cur.fetchall()}


# psycopg2 connection 不支持 setattr 加任意字段，缓存用进程级 dict。
# 同进程里同 (conn_id, brand) 只查一次。
_VALID_STORES_CACHE: dict[tuple[int, str], set[str]] = {}


def load_valid_stores(brand_code: str, conn) -> set[str]:
    """加载 brand 下所有 enabled 的 store_code 集合。带进程内缓存。"""
    key = (id(conn), brand_code)
    cached = _VALID_STORES_CACHE.get(key)
    if cached is not None:
        return cached
    valid = _query_valid_stores(brand_code, conn)
    _VALID_STORES_CACHE[key] = valid
    return valid


def validate_store_or_die(brand_code: str, store_code: str, conn) -> None:
    """确认 store_code 是 brand 的合法门店；否则抛 CrossBrandStoreError。"""
    if not store_code:
        raise CrossBrandStoreError(f"empty store_code for brand={brand_code}")
    valid = load_valid_stores(brand_code, conn)
    if store_code not in valid:
        raise CrossBrandStoreError(
            f"store_code={store_code!r} 不属于 brand={brand_code!r} 的合法门店 "
            f"(合法集合: {sorted(valid)})"
        )


def safe_resolve_store(
    row_store: str,
    override: str,
    brand_code: str,
    conn,
    fallback: Optional[str] = None,
) -> str:
    """
    决定最终写入 *_ods.* 的 store_code。

    优先级：
    1. override（CLI/--store-code 显式传入）—— 必须属于 brand 合法集合
    2. row_store（CSV 内的「门店编码」列）—— 必须属于 brand 合法集合
    3. fallback（环境/默认）—— 必须属于 brand 合法集合

    任何一个候选不在合法集合中，都抛 CrossBrandStoreError，由调用方
    决定是 skip 行（transform_row 入口）还是终止整个导入（main 入口）。
    """
    candidates = []
    if override:
        candidates.append(("override", override))
    elif row_store:
        candidates.append(("csv", row_store))
    elif fallback:
        candidates.append(("fallback", fallback))
    else:
        raise CrossBrandStoreError(
            f"无法解析 store_code: override/row_store/fallback 全空 (brand={brand_code})"
        )

    source, value = candidates[0]
    validate_store_or_die(brand_code, value, conn)
    return value
