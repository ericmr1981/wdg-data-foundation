# Context Package
> Built by ContextAssembler | 2026-04-02T08-26-56 | task: WDG: 按方案A交付『门店看板一键初始化』：新增门店后不创建新dashboard，而是提供一键同步/初始化功能，将 Metabase 现有品牌经营看板/营业看板/财务看板中的 store_code 静态下拉列表（static-list）自动同步为 ops.stores 当前门店集合；并在 /admin/stores 页面提供按钮触发（按品牌或按门店）。要求：1) 不新增 dashboard；2) 同步后看板门店下拉立即包含新门店；3) 兼容多品牌（yufeng/bonjur/gelatomiiix 等）；4) 给出 README/验收步骤；5) 提供安全机制（dry-run/预览/二次确认/仅 admin 权限）。

## 📋 Git State
- **Branch**: `ops/sync-vps-20260401`
- **Status**: ⚠️ dirty
```
M CHANGELOG.md
 M docker-compose.yml
 M scripts/metabase_seed_bonjur_ops_dashboard.py
 M scripts/metabase_seed_dashboard.py
?? ACTIVE.md
?? artifacts/
?? harness/
```

## 📜 Recent Commits (last 5)
```
  4402a46 ops: solidify WDG VPS compose + ops scripts
  4f8ee61 fix(metabase): 修复 site-url 端口错误 + Month 参数无 values 导致 Dashboard 全卡死
  2621c24 fix(metabase): use static-list store filters for dashboards 8/9/10
  ef2f4cf docs: update CHANGELOG with full dashboard fix verification
  b2b5ca4 perf(gelatomiiix): fix v_bank_txn_classified performance (14x-19x faster)
```

## 🔍 Uncommitted Changes
```
CHANGELOG.md                                  | 13 +++++
 docker-compose.yml                            |  2 +-
 scripts/metabase_seed_bonjur_ops_dashboard.py | 20 ++++++-
 scripts/metabase_seed_dashboard.py            | 81 +++++++++++++++++++++++++--
 4 files changed, 110 insertions(+), 6 deletions(-)
```

## ▶️  ACTIVE.md
# ACTIVE.md — Current WIP

> This file lives inside the project repo. The workspace root WORKSPACE.md is only an index.

## Current Project
- **Name**: WDG（wdg-data-foundation）
- **Repo**: /Users/ericmr/Documents/GitHub/wdg-data-foundation
- **Task**: 项目WDG，VPS环境，修复metabase上所有表格数据无法显示，卡在waiting for results
- **Mode**: llm-full
- **Started**: 2026-04-01T16:33:26.979Z
- **Status**: running
- **Sprints**: sprint-1

## Sprint Plan
- **sprint-1**: engineering-senior-developer | deps: none | attachmen

## 📂 Relevant Source Files (task keywords matched)

### `.venv/lib/python3.14/site-packages/numpy/typing/tests/test_runtime.py`
```
"""Test the runtime usage of `numpy.typing`."""

from typing import (
    Any,
    NamedTuple,
    Union,  # pyright: ignore[reportDeprecated]
    get_args,
    get_origin,
    get_type_hints,
)

import pytest

import numpy as np
import numpy._typing as _npt
import numpy.typing as npt


class TypeTup(NamedTuple):
    typ: type
    args: tuple[type, ...]
    origin: type | None


def _flatten_type_alias(t: Any) -> Any:
    # "flattens" a TypeAliasType to its underlying type alias
    return getattr(t, "__value__", t)


NDArrayTup = TypeTup(npt.NDArray, npt.NDArray.__args__, np.ndarray)

TYPES = {
    "ArrayLike": TypeTup(
        _flatten_type_alias(npt.ArrayLike),
        _flatten_type_alias(npt.ArrayLike).__args__,
        Union,
    ),
    "DTypeLike": TypeTup(
        _flatten_type_alia
```

### `.venv/lib/python3.14/site-packages/numpy/typing/tests/data/pass/bitwise_ops.py`
```
import numpy as np

i8 = np.int64(1)
u8 = np.uint64(1)

i4 = np.int32(1)
u4 = np.uint32(1)

b_ = np.bool(1)

b = bool(1)
i = 1

AR = np.array([0, 1, 2], dtype=np.int32)
AR.setflags(write=False)


i8 << i8
i8 >> i8
i8 | i8
i8 ^ i8
i8 & i8

i << AR
i >> AR
i | AR
i ^ AR
i & AR

i8 << AR
i8 >> AR
i8 | AR
i8 ^ AR
i8 & AR

i4 << i4
i4 >> i4
i4 | i4
i4 ^ i4
i4 & i4

i8 << i4
i8 >> i4
i8 | i4
i8 ^ i4
i8 & i4

i8 << i
i8 >> i
i8 | i
i8 ^ i
i8 & i

i8 << b_
i8 >> b_
i8 | b_
i8 ^ b_
i8 & b_

i8 << b
i8 >> b
i8 | b
i8 ^ b
i8 & b

u8 << u8
u8 >> u8
u8 | u8
u8 ^ u8
u8 & u8

u4 << u4
u4 >> u4
u4 | u4
u4 ^ u4
u4 & u4

u4 << i4
u4 >> i4
u4 | i4
u4 ^ i4
u4 & i4

u4 << i
u4 >> i
u4 | i
u4 ^ i
u4 & i

u8 << b_
u8 >> b_
u8 | b_
u8 ^ b_
u8 & b_

u8 << b
u8 >> b
u8 | b
u8 ^ b
u8 & b

b_ << b_
b_ >> b_
b_ | b_
b
```

### `.venv/lib/python3.14/site-packages/pip/__pip-runner__.py`
```
"""Execute exactly this copy of pip, within a different environment.

This file is named as it is, to ensure that this module can't be imported via
an import statement.
"""

# /!\ This version compatibility check section must be Python 2 compatible. /!\

import sys

# Copied from pyproject.toml
PYTHON_REQUIRES = (3, 9)


def version_str(version):  # type: ignore
    return ".".join(str(v) for v in version)


if sys.version_info[:2] < PYTHON_REQUIRES:
    raise SystemExit(
        "This version of pip does not support python {} (requires >={}).".format(
            version_str(sys.version_info[:2]), version_str(PYTHON_REQUIRES)
        )
    )

# From here on, we can use Python 3 features, but the syntax must remain
# Python 2 compatible.

import runpy  # noqa: E402
from importlib.machinery
```

### `.venv/lib/python3.14/site-packages/pandas/core/internals/ops.py`
```
from __future__ import annotations

from typing import (
    TYPE_CHECKING,
    NamedTuple,
)

from pandas.core.dtypes.common import is_1d_only_ea_dtype

if TYPE_CHECKING:
    from collections.abc import Iterator

    from pandas._libs.internals import BlockPlacement
    from pandas._typing import ArrayLike

    from pandas.core.internals.blocks import Block
    from pandas.core.internals.managers import BlockManager


class BlockPairInfo(NamedTuple):
    lvals: ArrayLike
    rvals: ArrayLike
    locs: BlockPlacement
    left_ea: bool
    right_ea: bool
    rblk: Block


def _iter_block_pairs(
    left: BlockManager, right: BlockManager
) -> Iterator[BlockPairInfo]:
    # At this point we have already checked the parent DataFrames for
    #  assert rframe._indexed_same(lframe)

    for blk
```

---
*ContextAssembler v1 | 2026-04-02T08-26-56*