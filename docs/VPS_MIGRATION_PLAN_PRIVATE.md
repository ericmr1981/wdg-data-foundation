# WDG Data Foundation｜VPS 迁移计划（私有草案，不上 GitHub）（v0）

> 说明：这份文档用于“先把方案定清楚”，默认 **不提交到 GitHub**。
> VPS 部署动作本身走 GitHub（代码/CI/CD），但 **账号、密码、密钥、IP、端口等敏感信息不进入仓库**。

## 0. 迁移目标（一期）
- 在 VPS 上跑通同一套链路：文件入库 → ETL → 分类 → DM → UI 查询
- 保证本机与 VPS 的“运行方式一致”（优先 Docker 化、环境变量化、脚本幂等化）
- 支持：
  - 定时任务（T+1）
  - 基础监控（pipeline_run/step_run + 最小告警策略）
  - 可回滚（至少能回到上一个可用版本）

## 1. 迁移范围（建议分两阶段）
### Phase A（最小可上线）
- PostgreSQL 16（数据存储 + schema 初始化）
- ETL 脚本（在 VPS 上可被 cron 调度执行）
- UI（Next.js）以“服务方式”运行（PM2 或 Docker）
- 反向代理（Nginx/Caddy）+ HTTPS（可选，建议）

### Phase B（稳定性增强）
- DB 备份与恢复演练（每日备份、保留策略）
- 监控告警（覆盖率异常、未分类激增、ETL 失败）
- 权限与隔离（最小权限 DB 用户、限制外网暴露）

## 2. GitHub 驱动部署（两种路线）
> 你说“vps部署通过github”，我建议优先 Route 1（最简单）。

### Route 1：VPS 直接 `git pull`（最简单、可控）
- VPS 上部署一个工作目录（例如 `/opt/wdg-data-foundation`）
- 配置：
  - GitHub deploy key（只读）或使用个人 token（不推荐长期）
  - `.env` 放在 VPS 本地（不入库）
- 发布流程：
  1) 本机 push 到 GitHub（main 或 release tag）
  2) VPS 上执行 `git pull` + restart（手工或脚本）

优点：简单、调试方便。
缺点：需要登录 VPS 执行发布；发布一致性取决于脚本质量。

### Route 2：GitHub Actions → SSH 到 VPS（更自动化）
- GitHub Secrets 保存 VPS SSH key / host / user
- push/tag 后触发 workflow：
  - SSH 到 VPS
  - 拉取代码
  - 构建/重启服务

优点：全自动、可追溯。
缺点：初期配置成本更高；需要更严谨的 secret 管理。

## 3. VPS 侧运行形态（建议）
### 3.1 PostgreSQL
两种选型：
- A) 用 Docker 跑 PG（和本机脚本一致，迁移最省心）
- B) 裸机安装 PG（运维更传统，但版本/配置漂移风险更大）

一期建议：**A（Docker）**。

### 3.2 UI（Next.js）
- A) Docker（建议：多服务 compose）
- B) Node + PM2（简单，但需要你自己保证 node 版本一致）

一期建议：如果要和 DB 一起做 compose：选 Docker；否则 PM2 也可以。

### 3.3 ETL 与调度（Cron）
- 方案：cron 调 `python scripts/run_pipeline_oneclick.py ...`
- 运行前置：
  - 确保 `.env` 能在 cron 环境加载
  - 日志落盘（/var/log 或项目 logs/）
  - ops 表写入（用于 UI /pipeline 展示）

## 4. 迁移步骤（建议的执行顺序）
### Step 1：准备 GitHub 仓库结构（不含任何 secrets）
- `.env.example` 保留
- `.env` 加入 `.gitignore`（确认已忽略）
- 写清楚：VPS 部署需要的变量清单（文档内）

### Step 2：VPS 初始化（一次性）
- 建目录
- 配好 deploy key / git clone
- 装 Docker（若用 Docker 方案）

### Step 3：数据库启动 + 初始化
- 启动 PG
- 运行初始化脚本（需要脚本支持：VPS 环境）
  - 理想状态：`./scripts/init_local_env.sh` 可复用（容器名/端口参数可配置）

### Step 4：部署 UI
- build + start
- 配反代（可选）

### Step 5：跑一次“样例 E2E”
- 导入样例
- 看 /pipeline 覆盖率
- 查 DM 视图

### Step 6：接入真实数据 + 定时任务
- 增加上传/归档策略
- 上 cron

## 5. 风险清单（需要提前决定）
1) **数据文件怎么上 VPS**：
   - SCP 手工？
   - UI 上传？
   - 对接对象存储（后续）？

2) **数据备份策略**：
   - pg_dump（每日）
   - docker volume 备份（可选）

3) **安全边界**：
   - PG 是否对公网开放（强烈建议不开放）
   - UI 是否加鉴权（一期你之前定的是“无需登录”，这在 VPS 上要额外评估）

## 6. 我需要你确认的 5 个问题（决定方案细节）
1) VPS 系统是什么（Ubuntu/Debian/CentOS）？
2) 你倾向 Route 1（VPS pull）还是 Route 2（GitHub Actions 自动发布）？
3) UI 需要公网访问吗？还是只 VPN/内网？
4) 数据文件的上传入口：继续走 UI upload，还是先手工放目录？
5) 你希望的发布频率：按需发布还是每天自动？
