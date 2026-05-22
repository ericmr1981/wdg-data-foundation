# 新天地门店配送/库存模块 (xintiandi)

## 概述

本模块为新天地门店（上海黄浦新天地时尚二期Nano店）提供配送明细数据的导入、存储和报表功能。

## 门店信息

- **门店编码**: `sh_xtd_nano`
- **门店名称**: 上海黄浦新天地时尚二期Nano店
- **品牌**: xintiandi

## 数据字段

配送明细 Excel 预期字段：

| Excel字段 | 数据库字段 | 说明 |
|-----------|-----------|------|
| 配送单号 | delivery_no | 配送单唯一标识 |
| 门店编码 | store_code | 门店编码 |
| 门店名称 | store_name | 门店名称 |
| 创建时间 | created_time | 配送单创建时间 |
| 品项名称 | item_name | 商品名称 |
| 品项编码 | item_code | 商品编码 |
| 品项分类 | item_category | 商品分类 |
| 订货数量 | order_qty | 订货数量 |
| 审核数量 | audit_qty | 审核通过数量 |
| 发货数量 | ship_qty | 已发货数量 |
| 送达数量 | deliver_qty | 已送达数量 |
| 订货金额 | order_amt | 订货金额 |

## 架构

```
Excel File
    ↓
API: POST /api/xintiandi/upload
    ↓
Script: import_xintiandi_delivery.py
    ↓
Table: xintiandi.delivery_detail (原始明细)
    ↓ (自动刷新)
Table: xintiandi.monthly_summary (月度汇总)
    ↓
Dashboard: /xintiandi (Web UI)
    ↓
Metabase: 新天地｜配送看板
```

## 数据库 Schema

### xintiandi.delivery_detail
配送明细表，存储每条配送记录。

### xintiandi.monthly_summary
月度汇总表，按月份和品项分类聚合。

### xintiandi.import_batch
导入批次记录表。

## API

### POST /api/xintiandi/upload
上传配送明细 Excel 文件。

**参数:**
- `file`: Excel 文件 (.xlsx, .xls, .csv)
- `triggerImport`: 是否自动导入 (默认: true)

**响应:**
```json
{
  "success": true,
  "data": {
    "filePath": "/path/to/file.xlsx",
    "fileName": "配送明细_2026-03.xlsx",
    "yearMonth": "2026-04",
    "importResult": "导入成功！..."
  }
}
```

### GET /api/xintiandi/dashboard
获取看板数据。

**参数:**
- `type`: overview | trend | items | stats

### GET /api/xintiandi/batch
获取导入批次历史。

## 脚本

### import_xintiandi_delivery.py
配送明细导入脚本。

**用法:**
```bash
# 常规导入
python3 scripts/import_xintiandi_delivery.py inputs/xintiandi/delivery/2026-03/配送明细.xlsx

# 预览模式（不导入）
python3 scripts/import_xintiandi_delivery.py inputs/xintiandi/delivery/2026-03/配送明细.xlsx --dry-run

# 指定批次ID
python3 scripts/import_xintiandi_delivery.py <file> --batch-id <uuid>
```

### metabase_seed_xintiandi_dashboard.py
Metabase 看板生成脚本。

**用法:**
```bash
export METABASE_URL=http://localhost:8082
export METABASE_API_KEY='your-api-key'
python3 scripts/metabase_seed_xintiandi_dashboard.py
```

## SQL 文件

| 文件 | 说明 |
|------|------|
| `sql/xintiandi/xintiandi_ddl.sql` | Schema 和表结构定义 |

**应用方式:**
```bash
psql -h localhost -U postgres -d dataplatform -f sql/xintiandi/xintiandi_ddl.sql
```

## Web UI

访问 `/xintiandi` 页面可查看：
- 月总览数据
- 月度趋势
- 品项分析
- 文件上传
- 导入历史

## Metabase Dashboard

创建看板后访问: `{METABASE_URL}/dashboard/{id}`

看板包含：
1. **月总览** - 月度汇总表格
2. **月度趋势** - 数量和金额变化趋势
3. **品项分类汇总** - 各品项分类统计
4. **品项明细** - 具体商品数据
5. **配送统计** - 配送单数和送达率

## 验收步骤

1. **Schema 部署**
   ```bash
   psql -h localhost -U postgres -d dataplatform -f sql/xintiandi/xintiandi_ddl.sql
   # 预期: CREATE SCHEMA, CREATE TABLE, CREATE FUNCTION 执行成功
   ```

2. **脚本验证**
   ```bash
   python3 -m py_compile scripts/import_xintiandi_delivery.py
   # 预期: 无语法错误
   ```

3. **UI 编译**
   ```bash
   cd ui && npx tsc --noEmit
   # 预期: 无类型错误
   ```

4. **示例数据导入** (准备样本 Excel 后)
   ```bash
   python3 scripts/import_xintiandi_delivery.py <sample.xlsx>
   # 预期: 导入成功，xintiandi.delivery_detail 有数据
   ```

5. **Dashboard API**
   ```bash
   curl http://localhost:3000/api/xintiandi/dashboard?type=overview
   # 预期: 返回 JSON 数据
   ```

## 注意事项

1. 导入脚本会自动刷新 `monthly_summary` 表
2. 幂等导入：同一 delivery_no + item_code 会更新而非重复插入
3. 文件类型白名单: .xlsx, .xls, .csv
4. 门店信息如 Excel 中无，会使用默认值 `sh_xtd_nano`

## 后续扩展

如需支持更多门店：
1. 在 `ops.stores` 添加新门店记录
2. 在 Excel 中指定 `门店编码`
3. 扩展 `import_xintiandi_delivery.py` 支持多门店

---

_模块版本: v1.0.0_
_创建日期: 2026-04-07_
