# UI 分层重组实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将页面按用户/管理员分层，重组 URL 结构，更新导航栏

**Architecture:** 重组 `ui/src/app/` 目录结构，用户页面移至 `/u/` 下，管理页面移至 `/admin/` 下，更新导航栏组件

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript

---

## 文件变更总览

| 操作 | 源路径 | 目标路径 |
|------|--------|----------|
| 移动 | `ui/src/app/page.tsx` | `ui/src/app/u/page.tsx` |
| 移动 | `ui/src/app/financial/` | `ui/src/app/u/financial/` |
| 移动 | `ui/src/app/payment/` | `ui/src/app/u/payment/` |
| 移动 | `ui/src/app/income/` | `ui/src/app/u/income/` |
| 移动 | `ui/src/app/pipeline/` | `ui/src/app/admin/pipeline/` |
| 移动 | `ui/src/app/rules/` | `ui/src/app/admin/rules/` |
| 移动 | `ui/src/app/match/` | `ui/src/app/admin/match/` |
| 移动 | `ui/src/app/upload/` | `ui/src/app/admin/upload/` |
| 修改 | `ui/src/app/providers.tsx` | - |
| 修改 | `ui/src/app/login/page.tsx` | - |
| 修改 | `ui/src/app/api/auth/login/route.ts` | - |

---

## Task 1: 创建目录结构

**Files:**
- Modify: `ui/src/app/`

- [ ] **Step 1: 创建新目录**

Run: `mkdir -p ui/src/app/u ui/src/app/admin`
Expected: 目录创建成功

- [ ] **Step 2: 验证目录存在**

Run: `ls ui/src/app/u ui/src/app/admin`
Expected: 两个空目录

---

## Task 2: 移动用户页面

**Files:**
- Move: `ui/src/app/page.tsx` → `ui/src/app/u/page.tsx`
- Move: `ui/src/app/financial/` → `ui/src/app/u/financial/`
- Move: `ui/src/app/payment/` → `ui/src/app/u/payment/`
- Move: `ui/src/app/income/` → `ui/src/app/u/income/`

- [ ] **Step 1: 移动页面文件**

Run: `git mv ui/src/app/page.tsx ui/src/app/u/page.tsx && git mv ui/src/app/financial ui/src/app/u/ && git mv ui/src/app/payment ui/src/app/u/ && git mv ui/src/app/income ui/src/app/u/`
Expected: 文件移动成功

- [ ] **Step 2: 验证文件存在**

Run: `ls ui/src/app/u/`
Expected: 显示 page.tsx financial payment income 目录

---

## Task 3: 移动管理页面

**Files:**
- Move: `ui/src/app/pipeline/` → `ui/src/app/admin/pipeline/`
- Move: `ui/src/app/rules/` → `ui/src/app/admin/rules/`
- Move: `ui/src/app/match/` → `ui/src/app/admin/match/`
- Move: `ui/src/app/upload/` → `ui/src/app/admin/upload/`
- Move: `ui/src/app/admin/` (已存在，保持不变)

- [ ] **Step 1: 移动管理页面文件**

Run: `git mv ui/src/app/pipeline ui/src/app/admin/ && git mv ui/src/app/rules ui/src/app/admin/ && git mv ui/src/app/match ui/src/app/admin/ && git mv ui/src/app/upload ui/src/app/admin/`
Expected: 文件移动成功

- [ ] **Step 2: 验证文件存在**

Run: `ls ui/src/app/admin/`
Expected: 显示 pipeline rules match upload admin(config) 目录

---

## Task 4: 更新 providers.tsx 导航栏

**Files:**
- Modify: `ui/src/app/providers.tsx`

- [ ] **Step 1: 读取当前 providers.tsx**

- [ ] **Step 2: 更新导航栏链接**

将以下链接更新：
- `/` → `/u`
- `/financial` → `/u/financial`
- `/payment` → `/u/payment`
- `/income` → `/u/income`
- `/pipeline` → `/admin/pipeline`
- `/rules` → `/admin/rules`
- `/match` → `/admin/match`
- `/upload` → `/admin/upload`
- `/admin/config` 保持不变

**更新后导航结构：**
```
[首页] [财务报表] [付款分析] [收入分析] [▼ 管理 (admin可见)]
                                              [品牌] [用户] [退出]
```

**管理下拉菜单内容：**
- Pipeline 监控 → `/admin/pipeline`
- 规则管理 → `/admin/rules`
- 人工匹配 → `/admin/match`
- 文件上传 → `/admin/upload`
- 配置 → `/admin/config`

- [ ] **Step 3: 验证构建**

Run: `cd ui && npx next build 2>&1 | tail -15`
Expected: 构建成功

---

## Task 5: 更新登录跳转目标

**Files:**
- Modify: `ui/src/app/login/page.tsx`
- Modify: `ui/src/app/api/auth/login/route.ts`

- [ ] **Step 1: 更新 login/page.tsx 跳转目标**

在 `onSubmit` 函数中，更新：
```typescript
const next = new URLSearchParams(window.location.search).get('next') || '/u/financial';
```

- [ ] **Step 2: 验证登录页构建**

Run: `cd ui && npx next build 2>&1 | grep -E "error|Error|✓" | tail -5`
Expected: 无 error

---

## Task 6: 更新 API 路由中的重定向

**Files:**
- Modify: `ui/src/app/api/auth/login/route.ts`

- [ ] **Step 1: 检查并更新成功重定向**

查看 `login/route.ts` 是否有硬编码的重定向 URL，如有则更新为 `/u/financial`

---

## Task 7: 全局链接检查

**Files:**
- Grep: 所有 `ui/src/` 目录下的 `.tsx` 和 `.ts` 文件

- [ ] **Step 1: 搜索所有旧链接**

Run: `grep -rn "href=['\"]/financial['\"]\|href=['\"]/payment['\"]\|href=['\"]/income['\"]" ui/src/app/ --include="*.tsx"`
Expected: 列出所有需要更新的链接

- [ ] **Step 2: 搜索管理页面链接**

Run: `grep -rn "href=['\"]/pipeline['\"]\|href=['\"]/rules['\"]\|href=['\"]/match['\"]\|href=['\"]/upload['\"]" ui/src/app/ --include="*.tsx"`
Expected: 列出所有需要更新的链接

- [ ] **Step 3: 更新所有查到的链接**

将查到的所有旧链接替换为新路径

---

## Task 8: 验证和构建

- [ ] **Step 1: 完整构建测试**

Run: `cd ui && npx next build 2>&1 | tail -20`
Expected: 构建成功，无 error

- [ ] **Step 2: 提交代码**

Run: `git add -A && git status --short`
Expected: 显示变更的文件列表

- [ ] **Step 3: 创建提交**

Run: `git commit -m "refactor: reorganize pages into /u and /admin routes"`
Expected: 提交成功