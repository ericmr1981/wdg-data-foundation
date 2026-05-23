# UI 分层重组设计

## 目标

重新设计页面导航结构，将用户页面和管理页面分离，提升使用体验。

## URL 重构

| 旧路径 | 新路径 | 类型 |
|--------|--------|------|
| `/` | `/u` | 用户首页 |
| `/financial` | `/u/financial` | 财务报表 |
| `/payment` | `/u/payment` | 付款分析 |
| `/income` | `/u/income` | 收入分析 |
| `/pipeline` | `/admin/pipeline` | Pipeline 监控 |
| `/rules` | `/admin/rules` | 规则管理 |
| `/match` | `/admin/match` | 人工匹配 |
| `/upload` | `/admin/upload` | 文件上传 |
| `/admin/config` | `/admin/config` | 配置（保持不变） |

**其他 URL 保持不变：** `/login`、`/api/*`

## 导航设计

### 顶部导航栏

```
[WDG Logo]  首页  财务报表  付款分析  收入分析  [▼ 管理]
                                      [品牌选择器] [用户名] [退出]
```

### 管理下拉菜单（admin 角色可见）

```
▼ 管理
  ├─ Pipeline 监控
  ├─ 规则管理
  ├─ 人工匹配
  ├─ 文件上传
  └─ 配置
```

### 登录后默认跳转到 `/u/financial`

## 文件变更

### 重命名/移动

- `ui/src/app/page.tsx` → `ui/src/app/u/page.tsx`（用户首页）
- `ui/src/app/financial/` → `ui/src/app/u/financial/`
- `ui/src/app/payment/` → `ui/src/app/u/payment/`
- `ui/src/app/income/` → `ui/src/app/u/income/`
- `ui/src/app/pipeline/` → `ui/src/app/admin/pipeline/`
- `ui/src/app/rules/` → `ui/src/app/admin/rules/`
- `ui/src/app/match/` → `ui/src/app/admin/match/`
- `ui/src/app/upload/` → `ui/src/app/admin/upload/`

### 导航组件更新

- `ui/src/app/providers.tsx` - 更新导航栏链接
- `ui/src/app/login/page.tsx` - 登录后跳转改为 `/u/financial`
- `ui/src/app/api/auth/login/route.ts` - 登录成功后重定向地址改为 `/u/financial`

## 权限控制

- `/u/*` - 所有登录用户可访问
- `/admin/*` - 仅 admin 角色可访问
- 未登录访问 `/admin/*` → 重定向到 `/login`
- 未登录访问 `/u/*` → 重定向到 `/login`

## 实施步骤

1. 创建新目录结构 `u/` 和 `admin/`
2. 移动页面文件到新目录
3. 更新所有内部链接（页面内跳转、API 等）
4. 更新导航栏 `providers.tsx`
5. 更新登录跳转目标
6. 验证所有页面可正常访问
7. 删除旧目录