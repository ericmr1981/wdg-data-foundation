# 输入规范与目录约定

## 1. 目录结构

所有源数据文件（RAW 层）必须存放在 `inputs/` 目录下，按照以下层级结构组织：

```
inputs/
└── {brand_code}/
    └── {store_code}/
        └── {source_type}/
            └── {YYYY-MM}/
                └── {原始文件名}
```

### 目录层级说明

| 层级 | 占位符 | 说明 | 示例 |
|------|--------|------|------|
| 1 | `brand_code` | 品牌代码（统一小写） | `bonjur`, `yufeng` |
| 2 | `store_code` | 门店代码 | `wz_oh_wxc`, `wz_ra_wy`, `yf_gh` |
| 3 | `source_type` | 数据源类型 | `sales`（营业数据）, `bank`（银行流水） |
| 4 | `YYYY-MM` | 数据所属月份 | `2025-02`, `2026-03` |
| 5 | 原始文件名 | 保持原文件名，可带日期 | `银行流水_工行_250301-250731.xlsx` |

## 2. 命名规则

### 2.1 品牌代码 (brand_code)

| 品牌 | brand_code |
|------|------------|
| 本就 | `bonjur` |
| 榆枫与山 | `yufeng` |

### 2.2 门店代码 (store_code)

| 品牌 | 门店名称 | store_code |
|------|----------|------------|
| Bonjur | 温州瓯海万象城店 | `wz_oh_wxc` |
| Bonjur | 温州瑞安吾悦广场店 | `wz_ra_wy` |
| Yufeng | 榆枫国华 | `yf_gh` |

### 2.3 数据源类型 (source_type)

| source_type | 说明 | 文件格式 |
|-------------|------|----------|
| `sales` | 营业数据报告 | CSV, Excel (.xlsx/.xls) |
| `bank` | 银行流水单 | Excel (.xlsx/.xls) |

### 2.4 月份格式

- **必须使用**：`YYYY-MM` 格式，例如 `2025-02`、`2026-03`
- 月份取源数据所属的**自然月**，非文件创建时间
- 若文件跨月（如 02/01~03/15），取起始日期所在月份，或按业务规则划分

### 2.5 文件命名示例

```
# Bonjur 营业数据 - 2026年2月
inputs/bonjur/wz_oh_wxc/sales/2026-02/营业日报_温州瓯海万象城_2026-02.csv
inputs/bonjur/wz_ra_wy/sales/2026-02/营业数据_自助营业取数_2026-02.csv

# Yufeng 银行流水 - 2025年3月~7月
inputs/yufeng/yf_gh/bank/2025-03/银行流水_工行_250301-250731.xlsx
inputs/yufeng/yf_gh/bank/2025-04/银行流水_工行_250401-250430.xlsx
```

## 3. 脚本解析规则

导入脚本应自动从文件路径解析以下信息：

| 字段 | 解析来源 | 示例 |
|------|----------|------|
| `brand_code` | 路径第1级 | `bonjur` |
| `store_code` | 路径第2级 | `yf_gh` |
| `source_type` | 路径第3级 | `bank` |
| `month` | 路径第4级 | `2025-03` |
| `file_name` | 文件名 | `银行流水_工行_250301-250731.xlsx` |

**解析失败处理**：
- 若路径不符合上述结构，脚本应抛出明确错误并退出
- 错误信息示例：`路径格式错误：inputs/{brand_code}/{store_code}/{source_type}/{YYYY-MM}/{filename}`

## 4. 唯一约束与重复检测

- **同一门店、同一月份、同一数据源**：
  - 目录结构保证唯一性（`{brand_code}/{store_code}/{source_type}/{YYYY-MM}/` 唯一）
- **跨月/跨门店/跨类型**：
  - 允许同名文件共存于不同目录
- **hash 唯一性**：
  - 通过 `raw.ingest_file.file_hash` 检测文件内容是否重复
  - 若 hash 已存在，应标记为 `skipped` 而非重复导入

## 5. 导入流程

```
1. 文件放置 → 2. 脚本扫描 inputs/ → 3. 解析路径获取元数据
4. 计算 file_hash → 5. 登记到 raw.ingest_file → 6. 读取并清洗数据
7. 写入 ods 表 → 8. 更新 ingest_file 状态
```

---

## 附录：幂等导入策略

详见 [sql/raw_ingest_file.sql](../sql/raw_ingest_file.sql)

### 核心操作

```sql
-- 按 source_file_id 删除当次导入数据（幂等）
DELETE FROM ods.bank_txn WHERE source_file_id = :source_file_id;
DELETE FROM ods.sales_daily WHERE source_file_id = :source_file_id;

-- 重新导入数据（source_file_id 保持不变）
```
