# Yufeng｜UI：人工匹配与规则管理（一期新增需求）

## 0) 目标
当银行流水自动分类覆盖率未达 100% 时，需要一套 **可视化 UI**：
1) 对”未分类/分类不确定”的流水进行人工匹配（选择 lvl1/lvl2，必要时绑定到某条规则）
2) 查看/新增/编辑/启停/调整优先级：`yufeng_cfg.bank_rule_map`

原则：
- **人工 override 优先于规则**（先人工兜底，后规则逐步完善）
- 所有修改可追溯（谁改的、何时改的、改了什么）

## 0.1 数据流与优先级

### 优先级顺序
```
override（人工兜底） > 规则匹配（bank_rule_map） > 未分类
```

### 数据流
```
yufeng_ods.bank_txn（原始流水）
        ↓
   ┌────┴────┐
   ↓         ↓
检查 override   匹配规则
(yufeng_dm.   (yufeng_cfg.
 bank_txn_    bank_rule_map
 override)     first-match)
   ↓         ↓
   └────┬────┘
        ↓
   yufeng_dm.v_bank_txn_classified（视图）
        ↓
   UI 展示 + 覆盖率统计
```

### 写回表字段
| 表 | 字段 | 说明 |
|----|------|------|
| `yufeng_dm.bank_txn_override` | bank_txn_id | 原始流水 ID（FK） |
| | lvl1 | 一级分类（必填） |
| | lvl2 | 二级分类（可空） |
| | note | 备注说明 |
| | created_by | 创建人（默认 'ui'） |
| | created_at | 创建时间 |
| | updated_at | 更新时间 |

> **注意**：override 表采用 `upsert` 逻辑，同一流水 ID 重复提交会更新而非新增。

### Classified 视图字段
| 字段 | 说明 |
|------|------|
| bank_txn_id | 原始流水 ID |
| store_code | 门店编码 |
| txn_time | 交易时间 |
| counterparty_name | 对方单位 |
| summary | 摘要 |
| memo | 附言/备注 |
| purpose | 用途 |
| in_amt | 收入金额 |
| out_amt | 支出金额 |
| matched_rule_id | 命中的规则 ID（override 时为 override 记录 ID） |
| lvl1 | 一级分类 |
| lvl2 | 二级分类 |
| classified_source | 来源：`override` \| `rule` \| `unclassified` |

### 写回接口（UI 调用）
```sql
-- 保存/更新 override
select yufeng_dm.upsert_bank_txn_override(
    p_bank_txn_id := 123,   -- 流水 ID
    p_lvl1 := '营业收入',    -- 一级分类
    p_lvl2 := '美团',       -- 二级分类（可 null）
    p_note := '人工确认',   -- 备注
    p_created_by := 'ui'    -- 创建人
);

-- 删除 override（恢复为规则匹配/未分类）
select yufeng_dm.delete_bank_txn_override(p_bank_txn_id := 123);
```

## 1) 数据库设计补充（建议）
### 1.1 人工匹配覆盖表（override）
表：`yufeng_dm.bank_txn_override`
- bank_txn_id (FK -> yufeng_ods.bank_txn.id)
- lvl1 text not null
- lvl2 text null
- note text
- created_by text
- created_at timestamptz

用途：
- 只存“例外/兜底”结果；不直接改原始 ods

### 1.2 分类结果视图/表
表或 view：`yufeng_dm.bank_txn_classified`
分类优先级：
1) override（若存在）
2) bank_rule_map（first-match）
3) 未分类

字段建议：
- bank_txn_id
- txn_time
- counterparty_name/summary/memo/purpose
- in_amt/out_amt
- matched_rule_id
- lvl1/lvl2
- classified_source (override|rule|unclassified)

## 2) UI 功能清单（一期最小可用）
### 2.1 人工匹配页面（重点）
- 列表：按“未分类优先 + 金额降序”展示
- 筛选：月份、方向(in/out)、对方单位、关键词、金额区间、是否已匹配
- 操作：
  - 选择 lvl1/lvl2（下拉）
  - 保存为 override
  - 批量操作（同对方单位/同关键词批量归类）
- 辅助：显示“推荐分类”（基于命中候选规则/关键词）

### 2.2 规则管理页面
- CRUD：新增/编辑/删除(软删)/启停
- 调整 priority（上移/下移）
- 规则测试：输入一条流水（或选择现有流水）→ 展示命中哪条规则

### 2.3 覆盖率面板
- 本月覆盖率（按笔数/按金额）
- 未分类 Top 对方单位 / Top 关键词

## 3) 技术实现建议（开源/自建）
为了最快落地，建议增加一个轻量“Admin Console”服务（Docker compose 增加 1 个容器）：
- 后端：Django + Django Admin（最快实现规则 CRUD 和 override CRUD）
- 数据库：同 PostgreSQL（读写 yufeng_cfg/yufeng_dm）
- 权限：基础登录 + 角色（只给内部使用）

备选：FastAPI + 简单前端（React/Next.js），但一期开发量更大。

## 4) 一期验收
- [ ] 未分类流水可在 UI 中被人工归类并生效（查询结果立即变化）
- [ ] 规则可在 UI 中维护并可测试命中
- [ ] 覆盖率（按笔数/按金额）可在 UI 中查看
- [ ] 所有变更有日志（谁在何时做了什么）
