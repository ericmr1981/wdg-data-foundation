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

如果用户问"\<品牌\>的\<渠道\>"，先确认该品牌是否支持该工具。
