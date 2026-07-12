-- ============================================================
-- Supabase 用户表兼容迁移：让 public.users 同时支持
-- WGD Portal (admin | user) + WDG Data Foundation (admin | operator)
-- 属于 commit: feat(agent): UnifiedMcpBridge 多后端支持
-- 跑法: bash sql/migrate-all.sh
--    或: Supabase Dashboard → SQL Editor 中逐条粘贴运行
-- ============================================================

-- 1. 加 enabled 列（Foundation 需要，默认 true 保持 Portal 兼容）
ALTER TABLE IF EXISTS public.users
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. 给 enabled 建索引（Foundation 的 login_user 会用到）
CREATE INDEX IF NOT EXISTS idx_users_enabled ON public.users (enabled) WHERE enabled = true;

-- 3. 放宽 role CHECK 约束：加 operator
ALTER TABLE IF EXISTS public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE IF EXISTS public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'operator', 'user'));

-- ============================================================
-- 4. 替换 login_user RPC：同时支持 Portal 和 Foundation
-- 新增功能：校验 enabled 标志、支持 operator 角色
-- ============================================================
CREATE OR REPLACE FUNCTION login_user(p_username TEXT, p_password TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  matched_user RECORD;
BEGIN
  SELECT id, username, name, role, password_hash, enabled
  INTO matched_user FROM public.users WHERE username = p_username;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', '账号或密码错误');
  END IF;

  -- Foundation 需要检查 enabled（Portal 种子用户默认 enabled=true，不受影响）
  IF matched_user.enabled = false THEN
    RETURN json_build_object('success', false, 'error', '账号已被禁用');
  END IF;

  IF matched_user.password_hash = crypt(p_password, matched_user.password_hash) THEN
    RETURN json_build_object(
      'success', true,
      'user_id', matched_user.id::text,
      'user', json_build_object(
        'id', matched_user.id,
        'username', matched_user.username,
        'name', matched_user.name,
        'role', matched_user.role
      )
    );
  ELSE
    RETURN json_build_object('success', false, 'error', '账号或密码错误');
  END IF;
END;
$$;

-- ============================================================
-- 5. 如果 Foundation 的 admin 用户尚未在 public.users 中，建一个
-- 密码哈希来自 Foundation ops.users 的 password_hash
-- （运行前检查：SELECT * FROM public.users WHERE username = 'admin';）
-- ============================================================
-- INSERT INTO public.users (username, password_hash, name, role)
-- SELECT 'admin', (SELECT password_hash FROM ops.users WHERE username = 'admin'),
--        '管理员', 'admin'
-- WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE username = 'admin');
