---
name: wdg-data-platform
description: |
  平台基础工具使用规范. 任何 LLM 调 MCP 工具前都应加载.
  涵盖品牌代码校验、期间解析、分类权限.
triggers:
  - "tool"
  - "MCP"
---

# WDG Data Platform Tool Conventions

## 品牌代码

调 `get_brand_stores` 前必须先确认品牌代码:
- gelatomiiix (蜜可诗): sh_sc, sh_xtd
- bonjur (旺鼎阁): sh_wdg, wz_ra, wz_wxc
- tamkoko (泰柯茶园): hz_fuyang, wz_bjwxc

## 回复用语规范

回复用户时，**所有代码/缩写一律用中文名替代**：

| 代码/缩写 | 回复中应使用 |
|---|---|
| `gelatomiiix` / `yufeng` | 蜜可诗 |
| `bonjur` | Bonjour / 旺鼎阁 |
| `tamkoko` | 泰柯茶园 |
| `sh_sc` / `sh_xtd` | 上海供应链 / 上海新天地店 |
| `sh_wdg` / `wz_ra` / `wz_wxc` | 温州总公司 / 瑞安吾悦广场店 / 温州万象城店 |
| `hz_fuyang` / `wz_bjwxc` | 富阳店 / 滨江万象城店 |
| `EXP_HR` | 人力支出 |
| `EXP_MATERIAL` / `MATERIAL` | 物料采购 |
| `EXP_MKT` | 市场推广 |
| `EXP_RENT_UTIL` | 租金物业 |
| `EXP_SHIP` | 物流运费 |
| `EXP_TAX_SURCHARGE` | 税金附加 |
| `EXP_ADMIN` | 行政办公 |
| `EXP_BUILD` | 装修基建 |
| `EXP_OTHER` / `BONUS` | 其他支出 / 分红 |
| `REV_BIZ` | 营业收入 |
| `REV_OTHER` | 其他收入 |

例外：在解释工具参数（如 `mention store_code`）时可保留代码。

## 期间解析

- 期间格式 YYYY-MM
- "本月" = Today 的 YYYY-MM
- "上月" = Today 减 1 个月
- "今天" = period 留空 (tool 默认)

ctx.period 是用户**当前查看的页面**的期间, 跟"用户想查的期间"不一定是同一个. 用户说"本月/上月/今天" 时, 以 Today 为准, 不要用 ctx.period.

## 分类权限

`submit_proposal` 只有 admin / finance / store_manager 能用. 如果用户是 operator 身份, 礼貌回"权限不足, 请联系 admin".
