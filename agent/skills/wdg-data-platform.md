---
name: wdg-data-platform
description: |
  平台基础工具使用规范. 任何 LLM 调 MCP 工具前都应加载.
  涵盖品牌代码校验、期间解析、分类权限.
triggers:
  - "tool"
  - "MCP"
  - "库存"
  - "周转"
  - "盘点"
---

# WDG Data Platform Tool Conventions

## 品牌代码

调 `get_brand_stores` 前必须先确认品牌代码:
- gelatomiiix (蜜可诗): sh_sc, sh_xtd
- bonjur (旺鼎阁): sh_wdg, wz_ra, wz_wxc
- tamkoko (泰柯茶园): hz_fuyang, wz_bjwxc

## 渠道对账工具一览

| 工具 | 品牌 | 适用场景 | 算法 |
|---|---|---|---|
| `get_settlement_cycle_recon` | tamkoko | 泰柯支付宝+微信（母公司转账） | 摘要解析周月窗口 |
| `get_taobao_recon` | tamkoko | 淘宝闪购（网商银行） | LAG 连续窗口 |
| `get_meituan_recon` | tamkoko | 美团外卖（钱袋宝） | 每日 T+N 固定偏移 |
| `get_meituan_tuangou_recon` | tamkoko | 美团团购券 | LAG 连续窗口 + T+5 |
| `get_douyin_recon` | tamkoko | 抖音团购券 | 每日 T+6 固定偏移 |
| `get_gelato_wechat_recon` | gelatomiiix | 蜜可诗微信（财付通） | 每日 T+1 固定偏移 |
| `get_gelato_alipay_recon` | gelatomiiix | 蜜可诗支付宝 | LAG 月结窗口 |
| `get_unmatched_orders` | gelatomiiix, bonjur | 未入账订单（月度聚合） | GROUP BY month |
| `get_qimai_entry_rate` | gelatomiiix, bonjur, tamkoko | 全品牌渠道入账率总览 | 多维度分析 |

**入口顺序**：先 `get_qimai_entry_rate` 看总览 → 再调具体渠道明细。详见 `qimai-bank-reconciliation` 技能。

## 库存与盘点工具（仅泰柯茶园）

泰柯是唯一用真 COGS（`v_cogs_monthly` = 期初+银行物料采购−期末库存）的品牌，毛利率、库存周转、利润表营业成本、资产负债表存货、现金流量表存货变动都依赖月度库存盘点。录入入口是 `/u/inventory` 页面（admin/operator 可见），agent 不直接写入。

| 工具 | 品牌 | 适用场景 | 返回关键字段 |
|---|---|---|---|
| `get_inventory_turnover` | tamkoko | "本月周转几次？哪几个月缺期初？" | `turnover_times`, `turnover_days`, `cogs_amt`, `opening_amt`, `closing_amt` |
| `get_inventory_summary` | tamkoko | "某店某月盘点录入了？谁/何时改的？是否被软删？" | `total_amount`, `note`, `updated_by`, `updated_at`, 软删行 `total_amount=0` 且 `note='deleted <iso>'` |

**算法**：
- `turnover_times = cogs_amt / ((opening_amt + closing_amt) / 2)`，`turnover_days = 30 / turnover_times`
- 首期或缺 closing → turnover 返 NULL（类似首期缺期初库存毛利返 NULL）
- 数据源：`brand_tamkoko_ods.inventory_monthly_summary`（总额） + `v_cogs_monthly` + `v_inventory_turnover`

**权限**：
- 两个工具只读，无角色要求（通过 `x-mcp-session=internal` 走内部会话）
- 录入/修改盘点必须走 UI（`/u/inventory`，admin/operator），不要试图用 MCP 写

**典型用法**：
- 查 hz_fuyang 2026-05 周转：`get_inventory_turnover(store_code='hz_fuyang', period='2026-05')`
- 列出某店所有盘点历史：`get_inventory_summary(store_code='wz_bjwxc')`（按 period DESC 排序）
- 库存健康检查：看哪些 (store, period) 缺 closing → 周转返 NULL → 提示用户补录

如果用户问"\<品牌\>库存"，先确认是否 tamkoko——其他品牌无此视图。

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

## 对账相关 MCP 工具调用约定

调用对账工具时注意以下品牌限定:

| 工具 | 可用品牌 | 不可用品牌的原因 |
|---|---|---|
| `get_unmatched_orders` | gelatomiiix, bonjur | tamkoko/yufeng 无 income_detail DDL, xintiandi 未部署 |
| `get_settlement_cycle_recon` | tamkoko | 仅泰柯有苏州泰柯母公司转账模式 |
| `get_taobao_recon` | tamkoko | 仅泰柯有网商银行入账 |
| `get_meituan_recon` | tamkoko | — |
| `get_meituan_tuangou_recon` | tamkoko | — |
| `get_douyin_recon` | tamkoko | — |
| `get_gelato_wechat_recon` | gelatomiiix | — |
| `get_gelato_alipay_recon` | gelatomiiix | — |
| `get_inventory_turnover` | tamkoko | 其他品牌无 `v_cogs_monthly` / `v_inventory_turnover` 视图 |
| `get_inventory_summary` | tamkoko | 其他品牌无 `inventory_monthly_summary` 表 |

如果用户问"\<品牌\>的\<渠道\>"，先确认该品牌是否支持该工具。
