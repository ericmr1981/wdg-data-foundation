-- ============================================================
-- 补充 Supabase 用户管理 RPC：兼容 Foundation admin/users API
-- 在 Foundation 已有的 Portal RPC 基础上加 username / enabled 字段
-- 在 Supabase SQL Editor 中运行（替换原有 admin_* RPC）
-- ============================================================

-- ─── admin_get_users（加 enabled 字段，兼容 Foundation）──────
CREATE OR REPLACE FUNCTION admin_get_users(admin_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  is_admin BOOLEAN;
BEGIN
  SELECT (u.role = 'admin') INTO is_admin FROM public.users u WHERE u.id = admin_id;
  IF NOT is_admin THEN
    RETURN json_build_object('success', false, 'error', 'permission_denied');
  END IF;
  RETURN json_build_object(
    'success', true,
    'users', (SELECT json_agg(row_to_json(r)) FROM (
      SELECT id, username, name, role, enabled, created_at FROM public.users ORDER BY created_at DESC
    ) r)
  );
END;
$$;

-- ─── admin_create_user（兼容 Foundation：username + password + role）─────
CREATE OR REPLACE FUNCTION admin_create_user(
  admin_id    UUID,
  p_username  TEXT,
  p_password  TEXT,
  p_name      TEXT DEFAULT NULL,
  p_role      TEXT DEFAULT 'operator'
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  is_admin BOOLEAN;
  new_id   UUID;
  display_name TEXT;
BEGIN
  SELECT (u.role = 'admin') INTO is_admin FROM public.users u WHERE u.id = admin_id;
  IF NOT is_admin THEN
    RETURN json_build_object('success', false, 'error', 'permission_denied');
  END IF;
  display_name := COALESCE(p_name, p_username);
  INSERT INTO public.users (username, password_hash, name, role)
  VALUES (p_username, crypt(p_password, gen_salt('bf', 10)), display_name, p_role)
  RETURNING id INTO new_id;
  RETURN json_build_object('success', true, 'id', new_id);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('success', false, 'error', '用户名已存在');
END;
$$;

-- ─── admin_update_user（扩展：加 username 和 enabled 字段）──────────
CREATE OR REPLACE FUNCTION admin_update_user(
  admin_id   UUID,
  target_id  UUID,
  p_name     TEXT DEFAULT NULL,
  p_role     TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL,
  p_enabled  BOOLEAN DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  is_admin BOOLEAN;
  target_exists BOOLEAN;
BEGIN
  SELECT (u.role = 'admin') INTO is_admin FROM public.users u WHERE u.id = admin_id;
  IF NOT is_admin THEN
    RETURN json_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = target_id) INTO target_exists;
  IF NOT target_exists THEN
    RETURN json_build_object('success', false, 'error', '用户不存在');
  END IF;

  IF p_username IS NOT NULL THEN
    UPDATE public.users SET username = p_username WHERE id = target_id;
  END IF;
  IF p_name IS NOT NULL THEN
    UPDATE public.users SET name = p_name WHERE id = target_id;
  END IF;
  IF p_role IS NOT NULL THEN
    UPDATE public.users SET role = p_role WHERE id = target_id;
  END IF;
  IF p_enabled IS NOT NULL THEN
    UPDATE public.users SET enabled = p_enabled WHERE id = target_id;
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('success', false, 'error', '用户名已存在');
END;
$$;

-- ─── admin_delete_user（已有，替换确保最新）────────────────────
CREATE OR REPLACE FUNCTION admin_delete_user(admin_id UUID, target_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  is_admin BOOLEAN;
BEGIN
  SELECT (u.role = 'admin') INTO is_admin FROM public.users u WHERE u.id = admin_id;
  IF NOT is_admin THEN
    RETURN json_build_object('success', false, 'error', 'permission_denied');
  END IF;
  IF admin_id = target_id THEN
    RETURN json_build_object('success', false, 'error', '不能删除自己的账号');
  END IF;
  DELETE FROM public.users WHERE id = target_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', '用户不存在');
  END IF;
  RETURN json_build_object('success', true);
END;
$$;

-- ─── admin_reset_password（已有，替换确保最新）─────────────────
CREATE OR REPLACE FUNCTION admin_reset_password(
  admin_id      UUID,
  target_id     UUID,
  new_password  TEXT
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  is_admin BOOLEAN;
BEGIN
  SELECT (u.role = 'admin') INTO is_admin FROM public.users u WHERE u.id = admin_id;
  IF NOT is_admin THEN
    RETURN json_build_object('success', false, 'error', 'permission_denied');
  END IF;
  UPDATE public.users SET password_hash = crypt(new_password, gen_salt('bf', 10)) WHERE id = target_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', '用户不存在');
  END IF;
  RETURN json_build_object('success', true);
END;
$$;
