# 配置约定（本地）

本项目的脚本默认通过 **环境变量**读取配置。

> 目标：同一套脚本在本地可复跑；配置统一通过 `.env`/环境变量管理，不改代码。

## 1. 环境变量（推荐用 `.env` 管理）

项目根目录提供：
- 示例文件：`/.env.example`

使用方式：
```bash
cd 项目/数据中台
cp .env.example .env
set -a && source .env && set +a
```

必须覆盖的变量：
- `DB_HOST`：PostgreSQL host（默认 `localhost`）
- `DB_PORT`：PostgreSQL port（默认 `5432`）
- `DB_NAME`：数据库名（默认 `dataplatform`）
- `DB_USER`：用户名（默认 `postgres`）
- `DB_PASSWORD`：密码（默认 `postgres`）

可选变量：
- `RAW_INPUT_DIR`：原始输入数据根目录（相对项目根目录，默认 `inputs/`）

## 2. 原始数据目录约定（RAW_INPUT_DIR）

默认根目录为 `inputs/`（即 `RAW_INPUT_DIR=inputs`）。

推荐路径结构：
```
{RAW_INPUT_DIR}/{brand_code}/{store_code}/{source_type}/{YYYY-MM}/{filename}
```
示例：
- `inputs/bonjur/wz_oh_wxc/sales/2026-02/营业日报_温州瓯海万象城_2026-02.csv`

> 备注：当前部分脚本在路径解析上写死了 `inputs/`（见 `scripts/import_bonjur_sales_daily.py: parse_path()`），
> 先把 RAW_INPUT_DIR 作为“约定层”的配置沉淀；后续若需要彻底可配置，可在 T9.2 或后续任务中统一改造。

## 3. brand/store mapping 放置方式（先文档约定）

现状：
- `Bonjur` 的“门店名 → store_code”映射目前写在脚本常量（`scripts/import_bonjur_sales_daily.py` 的 `STORE_NAME_MAPPING`）。

约定：
- 将可配置的映射文件统一放在：
  - `brand-docs/<brand_code>/mappings/`

建议文件：
- `brand-docs/bonjur/mappings/store_name_mapping.yaml`

YAML 示例（仅示意）：
```yaml
# 门店名（原始文件中出现的门店名）: store_code
"温州瓯海万象城店": "wz_oh_wxc"
"温州瑞安吾悦广场店": "wz_ra_wy"
```

后续改造建议（非本任务范围）：
- 在导入脚本中优先读取 `brand-docs/<brand>/mappings/*.yaml`，找不到再回退到脚本默认映射。

## 4. schema 命名（口径约定）

- `raw`：原始文件入库与 ingest 元数据（如 `raw.ingest_file`）
- `<brand>_ods`：按品牌的 ODS（例如 `bonjur_ods`, `yufeng_ods`）
- `<brand>_dm`：按品牌的 DM（例如 `yufeng_dm`）
- `ops`：pipeline 运行元数据与监控（如 `ops.pipeline_run`）
