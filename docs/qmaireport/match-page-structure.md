# 手动匹配 & 规则管理页 — 页面结构

---

## `/match` 手动匹配

文件：[ui/src/app/match/page.tsx](ui/src/app/match/page.tsx)

```
MatchPage ('use client')
├── 顶部黄条: 待处理队列 (pending queue)
│   ├── 待匹配笔数
│   ├── 展开详情表格
│   ├── 清空按钮
│   └── 批量沉淀按钮
├── LeftMatchBar 子组件 (fixed)
│   └── lvl1/lvl2 快速分类选择器
├── 主表格 (checkbox + 交易明细 + 操作按钮)
│   ├── 全选/取消
│   ├── 每行: txn详情 / 收入/支出 / QuickMatchButton / 撤销
│   └── QuickMatchButton → 弹出分类选择器
├── 分页栏
└── 模态框 (4个)
    ├── 批量匹配模态框 (lvl1/lvl2 选择)
    ├── 规则沉淀模态框 (lvl1/lvl2 + 匹配字段 + 关键词)
    ├── 冲突检测模态框 (显示冲突规则 + 双条件匹配选项)
    └── 批量沉淀冲突模态框
```

## `/rules` 规则管理

文件：[ui/src/app/rules/page.tsx](ui/src/app/rules/page.tsx)

```
RulesPage ('use client')
├── 顶部工具栏
│   ├── 品牌标签
│   ├── 操作按钮 (排序/导入/新增)
│   └── 重新匹配模块
├── 重复规则警告条
├── 搜索/筛选栏
│   ├── 关键词 / lvl1 / 方向 / 分组
│   └── 结果计数
├── 主规则列表 (DnD 可排序)
│   └── SortableRuleRow 子组件
└── 模态框 (4个)
    ├── 删除确认
    ├── 导入规则 (源品牌选择 + 模式)
    ├── 编辑/新增规则 (lvl1/lvl2 + 匹配字段 + 关键词 + 命中预览)
    └── (编辑/新增内部依赖)
```
