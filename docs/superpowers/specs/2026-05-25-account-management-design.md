# 账号管理功能设计

## 1. 概述

在管理后台新增账号管理页面，支持对 `ops.users` 表中的用户进行 CRUD 操作。仅限 `admin` 角色访问。

## 2. 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `ui/src/app/api/admin/users/route.ts` | 新增 | CRUD API |
| `ui/src/app/admin/users/page.tsx` | 新增 | 账号管理页面 |
| `ui/src/app/providers.tsx` | 修改 | NavBar 添加"账号管理"入口 |

## 3. API 设计

### `GET /api/admin/users`
返回全部用户列表（不含 `password_hash`）。

### `POST /api/admin/users`
创建新用户。Body: `{ username, password, role }`。
密码用 `crypt($2, gen_salt('bf'))` 加密存储。

### `PUT /api/admin/users`
更新用户。Body: `{ user_id, username?, role?, enabled?, password? }`。
- 仅提供 `password` 字段时更新密码
- 其他字段按需更新，使用 `COALESCE` 模式

### `DELETE /api/admin/users?id={user_id}`
硬删除用户。不允许删除自己。

## 4. 页面设计

- **列表页**（`/admin/users`）：表格展示用户名、角色（admin/operator）、状态（启用/禁用开关）、创建时间
- **新增 Modal**：用户名 + 密码 + 角色选择
- **编辑 Modal**：修改用户名、角色、启用/禁用、重置密码（可选输入）
- **删除确认**：确认弹窗后硬删除
- **权限**：页面级 `assertRole(user, ['admin'])`，每个 API 操作同理
- **保护**：不允许删除或禁用当前登录用户自己

## 5. 数据库

使用现有 `ops.users` 表，无需 DDL 变更。

## 6. NavBar

在管理下拉菜单中新增"账号管理"链接，仅在 `role === 'admin'` 时显示。
