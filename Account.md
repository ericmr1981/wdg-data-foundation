

• 访问：http://localhost:3001

• Metabase：http://localhost:3001

• 管理员账号（Admin）：
  - 登录名：<your-admin-email>
  - 密码：<your-admin-password>

• 数据库连接（示例）：dataplatform (local)
  - host: host.docker.internal
  - port: 5432
  - db: dataplatform
  - user/pass: postgres/postgres

• Metabase API Key：不要写进仓库。
  - 通过环境变量传入：`export METABASE_API_KEY='mb_...'`
  - 本机可放到 `.env`（已被 .gitignore 忽略），或单独文件 `Account.private.md`（建议自行创建并加入忽略）。