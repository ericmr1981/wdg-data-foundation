# WDG｜VPS 迁移计划（Route 1：VPS 通过 GitHub 拉取部署）

> 目标：把本机已跑通的「PG + ETL + UI + Dashboard(Metabase)」迁移到 VPS，部署过程以 GitHub 作为中转与版本源。
> 约束：**任何敏感信息（IP/域名/账号/密码/密钥）不写入仓库**。

---

## 0. 最终形态（一期）
- **全 Docker**（你已确认）：Postgres / UI / Metabase 均容器化
- **部署策略**：
  - GitHub：存放代码 + 部署文档 +（可选）Compose 文件
  - VPS：`git pull` 获取最新版本，然后 `docker compose up -d` 重启服务
- **运行模式**：T+1 批处理（cron 在 VPS 上调度 ETL）

---

## 1. 仓库内容与敏感信息隔离
### 1.1 仓库内（允许提交）
- `docker-compose.yml`（生产用）
- `.env.example`（变量名清单 + 默认值示例）
- `docs/`（本计划、Runbook、验收清单）
- `scripts/` / `sql/` / `ui/` 等代码

### 1.2 仓库外（禁止提交）
- `.env`（VPS 真实环境变量）
- `docs/VPS_MIGRATION_SECRETS.md`（敏感参数清单，见下文模板）
- 任意私钥/证书文件

建议在仓库根目录 `.gitignore` 添加：
```gitignore
.env
.env.*
docs/VPS_MIGRATION_SECRETS.md
```

---

## 2. VPS 目录规范（建议）
在 VPS 上：
- 代码目录：`/opt/wdg-data-foundation`
- 数据卷：由 Docker volumes 管理（PG / Metabase）

---

## 3. 部署流程（Route 1：VPS pull）

> 原则：**先检测目标环境 → 安装依赖 → 确定部署路径 → 更新文档 → 按文档推进 → 完成检验 → 交付**。
> 要求：全程保持文档及时更新（每一步有“可验证证据/命令输出/截图/URL”）。

### 3.1 目标环境检测（必做）
在 VPS 执行（建议先记录到部署日志）：
```bash
whoami && hostname
uname -a
free -h || true
df -h

# docker / compose
docker -v
(docker compose version) || true
(docker-compose -v) || true

# 端口占用（按需）
ss -lntp | head -n 50
```
产出：确认 VPS 具备 docker，compose 使用 `docker compose` 还是 `docker-compose`（二选一固定下来）。

### 3.2 安装/补齐依赖（一次性）
- 安装：Docker Engine + Compose（若缺）
- 建议额外装：`git`, `curl`, `jq`
- 确保：`docker ps` 可运行；当前用户具备 docker 权限（root 或已加入 docker 组）

### 3.3 首次部署（一次性）
1) 创建目录（建议）：`/opt/wdg-data-foundation`
2) 从 GitHub clone 仓库（只拉代码，不拉任何 secrets）
3) 在 VPS 写入 `.env`（从 `.env.example` 拷贝，填真实值）
4) 启动服务：
   ```bash
   cd /opt/wdg-data-foundation

   # 二选一：根据你的环境
   docker compose up -d --build
   # 或
   docker-compose up -d --build
   ```
5) 初始化数据库（运行初始化脚本/或 init 容器任务）
   - 目标：schema/DDL/视图/规则都落库
   - 证据：关键视图可查询（例如 `yufeng_dm.profit_monthly`）

> 注：UI 禁止使用 `next dev` 上 VPS；生产应走 `next build && next start`（建议写入 Dockerfile）。

### 3.4 日常发布（每次更新）
```bash
cd /opt/wdg-data-foundation

git pull

# 二选一
docker compose up -d --build
# 或
docker-compose up -d --build
```

### 3.5 部署后检验（必做）
1) 容器状态：`docker ps`
2) UI 可访问：/pipeline /rules /match /upload
3) Metabase 可访问，并能连到 PG
4) 导入一份样例/真实文件后：覆盖率/未分类 KPI 有数据
5) 关键 SQL 抽检：
   - `select * from yufeng_dm.profit_monthly limit 5;`

### 3.6 交付标准（Done）
- 文档更新完成：本计划 + Runbook（含“复制即用”的命令）
- 部署可复现：新机器按文档可从 0 到可用
- 回滚可执行：能切回上一个 commit 并恢复服务

---

## 4. 服务清单（端口规划建议）
> 实际端口由 `.env` 控制。

- UI：`UI_PORT=3000`
- Metabase：`METABASE_PORT=3001`
- Postgres：**不建议暴露公网**；如果必须暴露，使用安全组白名单 + 强口令。

---

## 5. ETL 调度（Cron）
一期建议：在 VPS 上创建 cron，调用容器内或宿主机脚本。

最低要求：
- 能指定 brand / month（或默认跑“昨天/本月”）
- 日志落盘
- ops 元数据可在 UI `/pipeline` 里看到

---

## 6. 验收清单（上线前必须过）
1) `docker compose ps` 全部容器 healthy/running
2) UI 页面可访问（/pipeline /rules /match /upload）
3) Metabase 可访问（并能连到 PG）
4) 导入一份样例/真实文件，覆盖率视图有数据：
   - `yufeng_dm.v_coverage_monthly`
   - `yufeng_dm.v_coverage_by_file`
5) 回滚演练：
   - 能切回上一个 git commit/tag 并恢复服务

---

## 7. 回滚策略（最小可行）
- 使用 Git tag 或记录上一次 commit hash
- 回滚命令：
  ```bash
  cd /opt/wdg-data-foundation
  git checkout <good_commit>
  docker compose up -d --build
  ```

---

## 8. 需要你补充的信息（写入 Secrets 文件，不入库）
见：`docs/VPS_MIGRATION_SECRETS.example.md`
