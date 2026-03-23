# UI 技术落地方案 v0

## 0) 概述

本文档为 T4「人工匹配 + 规则管理 UI」的技术落地实现方案，聚焦最小可用产品（MVP）。

### 目标
- 提供可视化界面完成人工分类兜底
- 支持规则 CRUD 与测试
- 展示覆盖率统计

### 技术选型
**推荐方案：Next.js 14 (App Router) + PostgreSQL（直连）**

| 方案 | 优点 | 缺点 |
|------|------|------|
| Next.js + API Routes | 单仓库、前后端一体化、Vercel/Node 部署简单 | 需写 TypeScript |
| Django + Admin | Python 技术栈一致、CRUD 快速 | 前后端分离、部署重 |
| FastAPI + React | 性能高、API 清晰 | 两套代码、需协调 |

**选型理由**：
1. Next.js API Routes 可直接作为 BFF 层与 PostgreSQL 通信
2. 与现有 Python ETL 解耦，独立部署
3. 一期最小可用：3 个页面，复杂度可控

---

## 1) 架构设计

### 1.1 系统架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Browser       │────▶│   Next.js       │────▶│  PostgreSQL     │
│   (React UI)    │     │   (API Routes)  │     │  (yufeng_*)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  ETL Pipeline   │
                        │  (Python)       │
                        └─────────────────┘
```

### 1.2 目录结构

```
ui/
├── app/
│   ├── layout.tsx          # 根布局
│   ├── page.tsx            # 首页 / 覆盖率面板
│   ├── matching/           # 人工匹配页面
│   │   └── page.tsx
│   ├── rules/              # 规则管理页面
│   │   ├── page.tsx
│   │   └── test/           # 规则测试
│   │       └── page.tsx
│   └── api/                # API Routes
│       ├── txn/            # 流水 CRUD
│       ├── override/       # Override CRUD
│       ├── rules/          # 规则 CRUD
│       ├── coverage/      # 覆盖率统计
│       └── test/           # 规则测试
├── lib/
│   ├── db.ts               # PostgreSQL 连接
│   └── types.ts            # TypeScript 类型
├── components/
│   ├── DataTable.tsx       # 通用表格
│   ├── FilterPanel.tsx     # 筛选面板
│   ├── CategorySelect.tsx  # 分类下拉
│   └── CoverageChart.tsx   # 覆盖率图表
├── package.json
└── .env.local              # 数据库连接配置
```

### 1.3 技术栈版本

| 依赖 | 版本 | 用途 |
|------|------|------|
| Next.js | 14.x | React 框架 + API Routes |
| React | 18.x | UI 库 |
| TypeScript | 5.x | 类型安全 |
| pg | 8.x | PostgreSQL 客户端 |
| @tanstack/react-table | 8.x | 表格组件 |
| recharts | 2.x | 覆盖率图表 |
| tailwindcss | 3.x | 样式框架 |

---

## 2) API 设计

### 2.1 数据库连接配置

```bash
# .env.local
DATABASE_URL=postgresql://user:password@localhost:5432/datacenter
```

### 2.2 API 路由总览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/txn` | 获取流水列表（支持筛选/分页） |
| GET | `/api/txn/:id` | 获取单条流水详情 |
| POST | `/api/override` | 创建/更新 override |
| DELETE | `/api/override/:bankTxnId` | 删除 override |
| GET | `/api/rules` | 获取规则列表 |
| POST | `/api/rules` | 创建规则 |
| PUT | `/api/rules/:id` | 更新规则 |
| DELETE | `/api/rules/:id` | 删除规则（软删） |
| GET | `/api/coverage` | 获取覆盖率统计 |
| POST | `/api/test` | 测试规则命中 |

---

### 2.3 流水列表 API

**GET /api/txn**

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| month | string | 否 | 月份 YYYY-MM |
| direction | string | 否 | in / out |
| keyword | string | 否 | 关键词搜索 |
| classified | boolean | 否 | 是否已分类 |
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 20 |

请求示例：
```bash
GET /api/txn?month=2026-03&direction=out&page=1&pageSize=20
```

响应：
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "bank_txn_id": 123,
        "txn_time": "2026-03-15T10:30:00Z",
        "counterparty_name": "美团",
        "summary": "二维码收款",
        "in_amt": 1580.00,
        "out_amt": null,
        "lvl1": "营业收入",
        "lvl2": "美团",
        "classified_source": "rule"
      }
    ],
    "total": 150,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

---

### 2.4 Override 写回 API

**POST /api/override**

请求体：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| bank_txn_id | number | 是 | 流水 ID |
| lvl1 | string | 是 | 一级分类 |
| lvl2 | string | 否 | 二级分类 |
| note | string | 否 | 备注 |

请求示例：
```json
{
  "bank_txn_id": 123,
  "lvl1": "营业收入",
  "lvl2": "美团",
  "note": "人工确认"
}
```

响应：
```json
{
  "success": true,
  "message": "Override 已保存"
}
```

---

**DELETE /api/override/:bankTxnId**

响应：
```json
{
  "success": true,
  "message": "Override 已删除"
}
```

---

### 2.5 规则 CRUD API

**GET /api/rules**

响应：
```json
{
  "success": true,
  "data": [
    {
      "rule_id": 1,
      "priority": 1,
      "direction": "in",
      "match_field": "counterparty_name",
      "match_value": "美团",
      "lvl1": "营业收入",
      "lvl2": "美团",
      "enabled": true,
      "created_at": "2026-03-01T00:00:00Z"
    }
  ]
}
```

**POST /api/rules**

请求体：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| priority | number | 是 | 优先级（越小越高） |
| direction | string | 是 | in / out / any |
| match_field | string | 是 | 匹配字段 |
| match_value | string | 是 | 匹配关键词 |
| lvl1 | string | 是 | 一级分类 |
| lvl2 | string | 否 | 二级分类 |
| enabled | boolean | 否 | 是否启用，默认 true |

---

### 2.6 覆盖率统计 API

**GET /api/coverage**

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| month | string | 否 | 月份 YYYY-MM，默认当月 |

响应：
```json
{
  "success": true,
  "data": {
    "month": "2026-03",
    "total_count": 200,
    "classified_count": 180,
    "override_count": 15,
    "rule_count": 165,
    "unclassified_count": 20,
    "coverage_by_count": "90%",
    "coverage_by_amount": "92%",
    "total_in_amt": 50000.00,
    "classified_in_amt": 46000.00,
    "unclassified_top_counterparties": [
      { "counterparty_name": "测试公司A", "count": 5, "amount": 2000.00 },
      { "counterparty_name": "测试公司B", "count": 3, "amount": 1500.00 }
    ]
  }
}
```

---

### 2.7 规则测试 API

**POST /api/test**

请求体：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| counterparty_name | string | 否 | 对方单位 |
| summary | string | 否 | 摘要 |
| memo | string | 否 | 附言 |
| purpose | string | 否 | 用途 |
| in_amt | number | 否 | 收入金额 |
| out_amt | number | 否 | 支出金额 |

响应：
```json
{
  "success": true,
  "data": {
    "matched": true,
    "matched_rule": {
      "rule_id": 1,
      "priority": 1,
      "match_field": "counterparty_name",
      "match_value": "美团",
      "lvl1": "营业收入",
      "lvl2": "美团"
    }
  }
}
```

---

## 3) 页面设计

### 3.1 覆盖率面板（首页）

**路径**：`/` 或 `/dashboard`

**功能**：
- 当月覆盖率卡片（按笔数/按金额）
- 覆盖率趋势图（近 6 个月）
- 未分类 Top 对方单位列表（可点击跳转匹配页面）

**布局**：
```
┌─────────────────────────────────────────────────┐
│  覆盖率面板                    [品牌: Yufeng ▼] │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐              │
│  │ 按笔数      │  │ 按金额       │              │
│  │ 90% (180/200)│ │ 92%         │              │
│  └─────────────┘  └─────────────┘              │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ 覆盖率趋势 (折线图)                      │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  未分类 Top 对方单位                            │
│  ┌─────────────────────────────────────────┐   │
│  │ 测试公司A   5笔   ¥2,000    [去匹配 →]  │   │
│  │ 测试公司B   3笔   ¥1,500    [去匹配 →]  │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 3.2 人工匹配页面

**路径**：`/matching`

**功能**：
- 列表展示未分类流水（默认按金额降序）
- 支持筛选：月份、方向、关键词、是否已分类
- 支持单条/批量匹配
- 显示"推荐分类"（基于候选规则）

**布局**：
```
┌─────────────────────────────────────────────────────────────┐
│  人工匹配                          [筛选 ▼] [批量操作 ▼]   │
├─────────────────────────────────────────────────────────────┤
│  筛选条件：                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ 2026-03 ▼│ │ 支出 ▼   │ │ 关键词   │ │ 未分类 ▼ │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
├─────────────────────────────────────────────────────────────┤
│  □   时间        对方单位      金额      分类    操作      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ □   03-15 10:30  美团        +¥1,580  [营业收入-美团]│  │
│  │     推荐: 营业收入-美团 (规则)                         │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ □   03-14 09:15  未知商家    -¥500   [未分类]  [匹配] │  │
│  │     推荐: 运费-顺丰 (规则)                             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                 共 20 条    │
├─────────────────────────────────────────────────────────────┤
│  批量操作: 选中 2 条 → [批量归类 ▼]                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │ 分类:  [一级分类 ▼] [二级分类 ▼]  [保存]            │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**关键交互**：
1. 点击单条记录 → 展开详情弹窗，支持选择 lvl1/lvl2 后保存
2. 批量选择 → 底部出现批量操作栏，选择分类后批量保存
3. 推荐分类：显示命中的候选规则（可点击查看规则详情）

### 3.3 规则管理页面

**路径**：`/rules`

**功能**：
- 规则列表（支持启用/禁用、优先级调整）
- 新增/编辑规则
- 规则测试

**布局**：
```
┌─────────────────────────────────────────────────────────────┐
│  规则管理                              [+ 新增规则]         │
├─────────────────────────────────────────────────────────────┤
│  筛选: [全部 ▼] [已启用 ▼]                                 │
├─────────────────────────────────────────────────────────────┤
│  优先级  方向  匹配字段    关键词      分类          操作  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1     收入  对方单位    美团       营业收入-美团  ⋮   │  │
│  │  2     支出  摘要        顺丰       运费-顺丰      ⋮   │  │
│  │  3     收入  关键词      支付宝     营业收入-支付  ⋮   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**新增/编辑弹窗**：
```
┌─────────────────────────────────────┐
│  新增规则                      [X]  │
├─────────────────────────────────────┤
│  优先级:    [1]                     │
│  方向:     [收入 ▼]                │
│  匹配字段:  [对方单位 ▼]            │
│  关键词:   [美团]                  │
│  一级分类: [营业收入 ▼]             │
│  二级分类: [美团]                   │
│  启用:     [✓]                      │
│                                     │
│         [测试]  [取消]  [保存]      │
└─────────────────────────────────────┘
```

**规则测试入口**：`/rules/test`

---

### 3.4 规则测试页面

**路径**：`/rules/test`

**功能**：
- 输入测试数据或选择已有流水
- 展示命中结果（哪条规则、分类结果）

**布局**：
```
┌─────────────────────────────────────────────────────────────┐
│  规则测试                                                  │
├─────────────────────────────────────────────────────────────┤
│  测试输入:                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 对方单位: [美团                    ]                 │   │
│  │ 摘要:     [二维码收款              ]                 │   │
│  │ 收入金额: [1580          ]                         │   │
│  │ 支出金额: [             ]                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          [测试]                             │
├─────────────────────────────────────────────────────────────┤
│  测试结果:                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✓ 命中规则 #1                                        │   │
│  │   优先级: 1 | 方向: 收入 | 匹配字段: 对方单位        │   │
│  │   关键词: 美团 → 分类: 营业收入-美团                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                     [从已有流水选择 ▼]      │
└─────────────────────────────────────────────────────────────┘
```

---

## 4) 批量操作设计

### 4.1 批量匹配

**场景**：多条流水来自同一对方单位，需要批量归类

**交互**：
1. 勾选多条流水（支持全选当前筛选结果）
2. 点击「批量归类」按钮
3. 弹出框选择 lvl1/lvl2
4. 确认后批量调用 POST /api/override

**API 调用示例**：
```typescript
// 批量写回 override
async function batchOverride(txnIds: number[], lvl1: string, lvl2?: string) {
  await Promise.all(txnIds.map(id =>
    fetch('/api/override', {
      method: 'POST',
      body: JSON.stringify({ bank_txn_id: id, lvl1, lvl2 })
    })
  ));
}
```

---

### 4.2 批量撤销

**场景**：多条流水被错误批量归类，需要撤销

**交互**：
1. 在已分类列表中勾选
2. 点击「批量撤销」
3. 确认后调用 DELETE /api/override/:bankTxnId

---

## 5) 撤销功能设计

### 5.1 单条撤销

**场景**：用户误操作，需要撤销单条 override

**交互**：
1. 在流水列表中，找到已 override 的记录
2. 点击「撤销」按钮
3. 确认后删除 override，记录恢复为规则匹配/未分类

**API**：DELETE /api/override/:bankTxnId

### 5.2 撤销历史（可选）

如需审计，可通过 override 表的 created_at/updated_at 字段追溯。

---

## 6) 推荐分类逻辑

### 6.1 候选规则展示

在人工匹配页面，每条未分类流水显示「推荐分类」，逻辑如下：

1. 获取该流水的所有候选规则（所有 enabled=true 的规则，按 priority 排序）
2. 过滤出命中的规则（前 3 条）
3. 展示第一条作为「推荐」，其余作为「备选」

### 6.2 推荐算法（前端实现）

```typescript
// 伪代码
function getRecommendedRules(txn: BankTxn, rules: Rule[]): Rule[] {
  return rules
    .filter(r => r.enabled && matches(txn, r))
    .slice(0, 3);
}

function matches(txn: BankTxn, rule: Rule): boolean {
  const value = txn[rule.match_field];
  return value?.includes(rule.match_value);
}
```

---

## 7) 部署方案

### 7.1 开发环境

```bash
cd ui
npm install
npm run dev
# 访问 http://localhost:3000
```

### 7.2 生产环境

**方案 A：Vercel（推荐）**
- 推送代码到 GitHub
- Vercel 自动部署
- 环境变量配置 DATABASE_URL

**方案 B：Docker**

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
services:
  ui:
    build: ./ui
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/datacenter
    depends_on:
      - db
```

---

## 8) 待补充

- [ ] 分类枚举配置化（一级/二级分类从数据库读取）
- [ ] 操作日志记录（审计谁在何时做了什么）
- [ ] 权限控制（basic auth 或简单密码）
- [ ] Bonjur 品牌切换（当前仅 Yufeng）

---

## 9) 验收标准

- [ ] 未分类流水可在 UI 中被人工归类并生效（查询结果立即变化）
- [ ] 规则可在 UI 中维护（CRUD）并可测试命中
- [ ] 覆盖率（按笔数/按金额）可在首页查看
- [ ] 批量匹配功能可用
- [ ] 撤销功能可用
- [ ] 页面加载时间 < 2s（列表 20 条）

---

## 10) 相关文档

- [UI 交互原型 v0](../brand-docs/Yufeng_UI_交互原型_v0.md)
- [人工匹配与规则管理需求](../brand-docs/Yufeng_UI_人工匹配与规则管理.md)
- [Override DDL](../brand-docs/Yufeng_DM_DDL_override_and_classified.sql)
- [分类体系枚举](../brand-docs/Yufeng_T2_分类体系枚举_v0.md)
