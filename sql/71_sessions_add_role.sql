-- ============================================================
-- Foundation 本地 session 表兼容迁移：加 role/username 列
-- 因为用户数据迁到 Supabase public.users，getSessionUser()
-- 不再能 JOIN ops.users 拿角色。改为登录时写入 sessions。
-- 在 Foundation VPS 数据库上运行。
-- ============================================================

-- 1. 给 ops.sessions 加角色和用户名列
ALTER TABLE ops.sessions
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('admin', 'operator', 'user'));

-- 2. 回填已有 session（从 ops.users 迁过来）
UPDATE ops.sessions s
SET
  username = u.username,
  role = u.role
FROM ops.users u
WHERE s.user_id = u.user_id
  AND s.username IS NULL;

-- 3. 建索引（getSessionUser 会用来过滤 enabled 用户）
-- 注：enabled 检查移到 Supabase 端（login_user 拒绝 enabled=false）
--    这里的 session 本身就代表了登录时的状态
