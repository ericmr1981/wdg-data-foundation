# 手动匹配 & 规则管理页 — 数据来源清单

---

## API 调用

| 页面 | API | 用途 | 数据源 | 合规 |
|---|---|---|---|---|
| match | `GET /api/match` | 获取未分类流水 | v_unclassified_detail | ✅ 分类视图 |
| match | `PUT /api/match` | 批量覆盖分类 | bank_txn_override | N/A (写入) |
| match | `POST /api/match` | 单条覆盖分类 | bank_txn_override | N/A (写入) |
| match | `DELETE /api/match/override` | 撤销覆盖 | bank_txn_override | N/A (写入) |
| match | `GET /api/match/candidates` | 获取推荐关键词 | bank_txn (单行) | ✅ 管理操作 |
| match | `GET /api/match/preview` | 命中预览 | v_bank_txn_classified + bank_txn | ✅ 已修复 |
| match | `POST /api/rules/settle` | 沉淀规则 | bank_rule_map | N/A (写入) |
| match | `POST /api/rules/settle-batch` | 批量沉淀 | bank_rule_map | N/A (写入) |
| rules | `GET /api/rules` | 规则列表 | bank_rule_map | N/A (管理) |
| rules | `POST /api/rules` | 新增规则 | bank_rule_map | N/A (写入) |
| rules | `PUT /api/rules` | 更新规则 | bank_rule_map | N/A (写入) |
| rules | `DELETE /api/rules` | 删除规则 | bank_rule_map | N/A (写入) |
| rules | `POST /api/rules/reorder` | 排序 | bank_rule_map | N/A (写入) |
| rules | `POST /api/pipeline/rerun-match-by-file` | 触发重匹配 | refresh_bank_txn_classified_snapshot() | N/A |
| rules | `GET /api/rule-groups` | 规则分组 | cfg.bank_rule_group | N/A |
| rules | `GET /api/categories` | 分类字典 | dim_category_lvl1 / lvl2 | N/A |
| rules | `GET /api/match/preview` | 命中预览 | v_bank_txn_classified + bank_txn | ✅ 已修复 |

## match/preview 修复说明

**用途:** 规则创建前预览"如果这个 match_value 生效，会命中哪些历史流水"

**规范说明:** 这是规则管理操作（非财务数据分析），需要模拟分类引擎的 ILIKE 匹配。其本质是管理工具的辅助功能，且已做了以下合规处理：
- ✅ 使用 `v_bank_txn_classified` 分类视图获取分类信息
- ✅ 使用 `getOdsBankTxnTable(brand)` 动态解析表名（非硬编码）
- ✅ 分类列名使用 `lvl1_code`/`lvl2_code` 而非错误的 `lvl1`/`lvl2`
