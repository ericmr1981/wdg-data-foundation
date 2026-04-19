# 规则导出导入功能设计

## 状态
Approved

## 概述

在"规则管理"页面增加规则导出/导入功能，支持 CSV 格式，用于备份和迁移品牌规则。

---

## 1. CSV 格式

列（第一行为表头）：`priority,direction,match_field,match_type,match_value,match_field2,match_value2,lvl1_code,lvl2_code,note,enabled`

- `enabled` 值为 `true`/`false`
- 表头不导入，忽略
- 格式错误的行跳过并记录到错误列表

---

## 2. 导出功能

### UI

- 位置：规则管理页面工具栏，"导入规则"按钮旁边
- 按钮文案：`导出规则`
- 点击后浏览器下载 CSV 文件

### API

**`GET /api/rules/export`**

| 参数 | 类型 | 说明 |
|------|------|------|
| brand | string | 品牌代码，必填 |

Response:
- `Content-Type: text/csv`
- `Content-Disposition: attachment; filename="{brand}_rules_YYYYMMDD.csv"`
- Body: CSV 文件内容

### 错误处理

- 品牌参数缺失：返回 400
- 品牌无规则：返回空 CSV（仅表头行）

---

## 3. 导入功能

### UI

- 位置：规则管理页面工具栏
- 按钮文案：`导入规则`
- 点击后打开文件选择器（接受 `.csv`）
- 上传后显示结果弹窗

### 结果弹窗

标题：`导入完成`

内容：
- `成功 N 条`
- `跳过 M 条`（包括重复和格式错误）
- 如果有错误，展开显示错误详情列表

操作按钮：`确定`（关闭弹窗并刷新列表）

### API

**`POST /api/rules/import`**

Content-Type: `multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| brand | string | 目标品牌代码 |
| file | File | CSV 文件 |

Response:
```json
{
  "success": true,
  "imported": 10,
  "skipped": 2,
  "errors": [
    "第5行：lvl1_code 为空",
    "第8行：direction 值无效"
  ]
}
```

### 导入逻辑

1. 解析 CSV，识别表头行
2. 逐行映射字段到 `bank_rule_map` 表结构
3. `priority` 默认值：`max(priority) + 1`
4. `enabled` 默认为 `true`
5. `created_by` 设为 `import`
6. `created_at` / `updated_at` 设为当前时间
7. 必填字段缺失（`lvl1_code`、`direction`、`match_field`、`match_type`、`match_value`）或值无效的行跳过
8. 重复检测：与同品牌已有规则完全相同（`direction`、`match_field`、`match_type`、`match_value`、`lvl1_code`）则跳过
9. 返回统计结果

### 错误处理

- 文件非 CSV：返回 400
- brand 参数缺失：返回 400
- 解析失败：返回 400 及错误信息

---

## 4. 文件位置

| 文件 | 说明 |
|------|------|
| `ui/src/app/api/rules/export/route.ts` | 导出 API |
| `ui/src/app/api/rules/import/route.ts` | 导入 API |
| `ui/src/app/rules/page.tsx` | 页面（增加按钮） |
| `ui/src/app/api/rules/export/route.ts` 的数据库查询函数 | 复用或新增 `getRulesForExport(brand)` |