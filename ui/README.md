# 数据中台 UI

数据中台人工匹配与规则管理 Web UI (MVP)。

## 技术栈

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- PostgreSQL (直连)

## 快速启动

### 1. 安装依赖

```bash
cd ui
npm install
```

### 2. 配置数据库连接

编辑 `.env.local` 文件，确保数据库连接正确：

```bash
# 方式1: 使用连接字符串
DATABASE_URL=postgresql://user:password@localhost:5432/dataplatform

# 方式2: 使用单独参数
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dataplatform
DB_USER=postgres
DB_PASSWORD=postgres
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:4100

### 4. 生产构建

```bash
npm run build
npm start
```

## 页面说明

| 路径 | 说明 |
|------|------|
| `/pipeline` | Pipeline 监控 - 展示最近运行记录和覆盖率统计 |
| `/rules` | 规则管理 - CRUD、启用/禁用、优先级调整 |
| `/match` | 人工匹配 - 未分类流水列表、批量归类、撤销 |
| `/upload` | 文件上传 - 上传 Excel/CSV 并触发导入脚本 |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/pipeline` | 获取 Pipeline 运行记录 |
| GET | `/api/coverage` | 获取覆盖率统计 |
| GET | `/api/rules` | 获取规则列表 |
| POST | `/api/rules` | 创建规则 |
| PUT | `/api/rules` | 更新规则 |
| DELETE | `/api/rules?id={id}` | 删除规则 |
| GET | `/api/match` | 获取未分类流水 |
| POST | `/api/match` | 创建/更新单条 override |
| PUT | `/api/match` | 批量创建 override |
| DELETE | `/api/match/override?bank_txn_id={id}` | 删除 override |
| POST | `/api/upload` | 上传文件并可选触发导入 |

## 数据库依赖

需要以下表/视图存在：

- `ops.pipeline_run`
- `ops.pipeline_step_run`
- `yufeng_dm.v_coverage_monthly`
- `yufeng_cfg.bank_rule_map`
- `yufeng_dm.bank_txn_override`
- `yufeng_dm.v_unclassified_detail`

## 验收步骤

1. 启动数据库和 Next.js 服务
2. 访问 `/pipeline` - 确认能看到 Pipeline 运行记录和覆盖率
3. 访问 `/rules` - 确认能查看、添加、编辑、删除规则
4. 访问 `/match` - 确认能看到未分类流水，并能归类和撤销
5. 访问 `/upload` - 确认能上传文件并触发导入

## 目录结构

```
ui/
├── src/
│   ├── app/
│   │   ├── api/           # API Routes
│   │   │   ├── pipeline/
│   │   │   ├── coverage/
│   │   │   ├── rules/
│   │   │   ├── match/
│   │   │   └── upload/
│   │   ├── pipeline/       # Pipeline 监控页面
│   │   ├── rules/         # 规则管理页面
│   │   ├── match/        # 人工匹配页面
│   │   └── upload/       # 文件上传页面
│   └── lib/
│       ├── db.ts          # 数据库连接
│       └── types.ts       # TypeScript 类型
├── .env.local             # 环境变量
├── package.json
└── tsconfig.json
```
