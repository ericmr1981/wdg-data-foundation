# dev.sh 使用文档

## 概述

`scripts/dev.sh` 是 WDG 项目的服务管理脚本，提供一键启动/停止/清理等功能。

**设计原则**：
- 不改变现有运行方式（沿用既有容器命名/端口）
- 只负责服务编排与健康管理，不执行数据初始化（初始化请用 `init_local_env.sh`）
- 所有操作幂等，可重复执行

---

## 命令清单

### 1. 启动服务

```bash
./scripts/dev.sh up
```

**功能**：
- 启动 Postgres（容器：`dataplatform-pg`，端口：`5432`）
- 启动 Metabase（容器：`dataplatform-metabase`，端口：`8082`）
- 执行健康检查（Postgres 可连接、Metabase HTTP 可访问）

**输出示例**：
```
[INFO] 启动 Postgres（容器：dataplatform-pg，端口：5432）
[INFO] Postgres 健康检查通过
[INFO] 启动 Metabase（容器：dataplatform-metabase，端口：8082）
[INFO] Metabase 健康检查通过：http://localhost:8082
[INFO] 完成。常用入口：
- Postgres: localhost:5432（容器：dataplatform-pg）
- Metabase: http://localhost:8082（容器：dataplatform-metabase）
- 初始化（如需）：./scripts/init_local_env.sh
```

---

### 2. 停止服务

```bash
./scripts/dev.sh down
```

**功能**：
- 停止 Postgres 与 Metabase 容器
- **保留数据卷**（数据不丢失）

---

### 3. 重启服务

```bash
./scripts/dev.sh restart
```

**功能**：先 `down` 再 `up`

---

### 4. 查看状态

```bash
./scripts/dev.sh status
```

**输出示例**：
```
Containers:
NAMES                       STATUS        PORTS
dataplatform-pg-dashboard   Up 11 hours   0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp
dataplatform-metabase       Up 11 hours   0.0.0.0:8082->3000/tcp, [::]:8082->3000/tcp
dataplatform-pg             Up 11 hours   0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp

Volumes (attached):
- dataplatform-pg:
    c568a902142e81d0e25e370dc62df28d8ebedce516dfb40b7327895d99f264a8 -> /var/lib/postgresql/data
    
- dataplatform-metabase:
    dataplatform_metabase_data -> /metabase-data
```

---

### 5. 查看日志

```bash
# 查看 Postgres 日志
./scripts/dev.sh logs pg

# 查看 Metabase 日志
./scripts/dev.sh logs metabase
```

---

### 6. 重置容器（保留数据）

```bash
./scripts/dev.sh reset
```

**功能**：
- 删除并重建 Postgres 与 Metabase 容器
- **不删除数据卷**（数据库内容保留）
- 适用于：容器状态异常、升级镜像版本后重建容器

**输出**：
```
[WARN] 重置容器（不删数据卷，保留数据库内容）...
[INFO] reset 完成（数据卷未动，规则/数据保留）
[INFO] 下次 up 时会复用现有数据卷
```

---

### 7. 清理原始数据（保留规则/配置）⭐

```bash
./scripts/dev.sh prune-data --yes
```

**功能**：
- TRUNCATE ODS 层原始数据（`yufeng_ods.bank_txn`、`bonjur_ods.sales_daily`）
- TRUNCATE RAW 层文件登记（`raw.ingest_file`）
- TRUNCATE OPS 层运行记录（`ops.pipeline_run/step_run`）
- **保留**：CFG 层规则/字典/门店维表、DM 视图、Metabase 配置

**适用场景**：
- 重新导入测试数据
- 清理脏数据但保留规则配置

**警告**：
- DM 视图会立即显示空数据（因为 ODS 已清空）
- 需要重新运行 `init_local_env.sh` 或导入脚本才能恢复数据

---

### 8. 彻底清理（恢复全新环境）⚠️

```bash
./scripts/dev.sh clean --yes
```

**功能**：
- 删除 Postgres 与 Metabase 容器
- 删除所有数据卷（**会丢失全部数据**）

**适用场景**：
- 真的要"从头再来"
- 数据脏了想彻底清空

**警告**：
- **所有数据丢失**（规则/配置/导入数据/DM 结果/Metabase 配置）
- 执行后需重新运行 `init_local_env.sh` 初始化

---

## 命令对比表

| 命令 | 容器 | 数据卷 | ODS 数据 | CFG 规则 | Metabase 配置 |
|------|------|--------|----------|----------|---------------|
| `down` | 停止 | 不动 | ✅ 保留 | ✅ 保留 | ✅ 保留 |
| `up` | 启动 | 不动 | ✅ 保留 | ✅ 保留 | ✅ 保留 |
| `reset` | 删 + 重建 | 不动 | ✅ 保留 | ✅ 保留 | ✅ 保留 |
| `prune-data --yes` | 不动 | 不动 | ❌ 删除 | ✅ 保留 | ✅ 保留 |
| `clean --yes` | 删除 | 删除 | ❌ 删除 | ❌ 删除 | ❌ 删除 |

---

## 常用工作流

### A. 日常开发
```bash
# 早上开工：启动服务
./scripts/dev.sh up

# 晚上下班：停止服务（省资源）
./scripts/dev.sh down
```

### B. 重新测试数据导入
```bash
# 清理原始数据（保留规则）
./scripts/dev.sh prune-data --yes

# 重新导入数据
./scripts/init_local_env.sh --with-sample-data
# 或
python scripts/import_yufeng_bank_txn.py inputs/...
```

### C. 容器异常修复
```bash
# 重置容器（数据不动）
./scripts/dev.sh reset

# 检查状态
./scripts/dev.sh status
```

### D. 彻底重来
```bash
# 彻底清理（会丢数据！）
./scripts/dev.sh clean --yes

# 重新初始化
./scripts/init_local_env.sh
```

---

## 环境变量（可选）

通过 `.env` 文件配置（与 `init_local_env.sh` 共享）：

```bash
# .env 示例
DB_NAME=dataplatform
DB_USER=postgres
DB_PASSWORD=postgres
DB_PORT=5432
METABASE_PORT=8082
```

---

## 故障排查

### Postgres 无法启动
```bash
# 查看日志
./scripts/dev.sh logs pg

# 检查端口占用
lsof -i :5432
```

### Metabase 无法访问
```bash
# 查看日志
./scripts/dev.sh logs metabase

# 检查容器状态
./scripts/dev.sh status
```

### 数据清理后 DM 为空
这是正常的——DM 是 VIEW，依赖 ODS 数据。重新导入数据即可：
```bash
./scripts/init_local_env.sh --with-sample-data
```



UI up：
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npm run dev