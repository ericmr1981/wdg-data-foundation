# Sprint Contract — sprint-1

## 任务
WDG: 按方案A交付『门店看板一键初始化』：新增门店后不创建新dashboard，而是提供一键同步/初始化功能，将 Metabase 现有品牌经营看板/营业看板/财务看板中的 store_code 静态下拉列表（static-list）自动同步为 ops.stores 当前门店集合；并在 /admin/stores 页面提供按钮触发（按品牌或按门店）。要求：1) 不新增 dashboard；2) 同步后看板门店下拉立即包含新门店；3) 兼容多品牌（yufeng/bonjur/gelatomiiix 等）；4) 给出 README/验收步骤；5) 提供安全机制（dry-run/预览/二次确认/仅 admin 权限）。

## 项目
workspace | /Users/ericmr/Documents/GitHub/wdg-data-foundation

## Agent
engineering-senior-developer

## Matrix Flags
- **[COMPLEXITY_HIGH]** complexity=8 — PGE-sprint enforced
- **[COMPLEXITY_MED]** complexity=8 — consider multi-sprint
## Continue Gate (v5 preview)
- **Final Oracle**: Live acceptance for "WDG: 按方案A交付『门店看板一键初始化』：新增门店后不创建新dashboard，而是提供一键同步/初始化功能，将 Metabase 现有品牌经营看板/营业看板/财务看板中的 store_code 静态下拉列表（static-list）自动同步为 ops.stores 当前门店集合；并在 /admin/stores 页面提供按钮触发（按品牌或按门店）。要求：1) 不新增 dashboard；2) 同步后看板门店下拉立即包含新门店；3) 兼容多品牌（yufeng/bonjur/gelatomiiix 等）；4) 给出 README/验收步骤；5) 提供安全机制（dry-run/预览/二次确认/仅 admin 权限）。" plus local oracle: bash scripts/run_change_guard.sh
- **Current Blocker**: Not yet verified against final oracle. Replace with concrete blocker after the first failed live check.
- **Round Outcome**: retry_with_new_bet
- **Stop Allowed**: no
- **Next Forced Bet**: Execute one bounded bet, then run bash scripts/run_change_guard.sh; if final oracle still fails, record evidence delta and launch the next repair step.
- **Local Oracle**: bash scripts/run_change_guard.sh
- **Evidence Delta**: new-branch
- **No-Evidence Rounds**: 0
- **Last Evidence**: none yet
- **Pivot Trigger**: 2 no-evidence rounds on same branch


## 依赖
_无_

## 验收
```bash
cd "/Users/ericmr/Documents/GitHub/wdg-data-foundation" && bash scripts/run_change_guard.sh
```

## 注意事项
代码库: Python / Python。主要文件: ui/src/app/match/page.tsx, ui/src/app/rules/page.tsx, ui/src/app/admin/config/category-dictionary/page.tsx, ui/.next/server/vendor-chunks/next.js, ui/src/app/api/rules/route.ts。

---
*Generated: 2026-04-02T08:26:57.730Z*