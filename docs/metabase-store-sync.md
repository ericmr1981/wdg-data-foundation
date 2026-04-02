# Metabase 门店下拉同步 (方案A)

## 背景

新增门店后，Metabase 经营看板的 `store_code` 下拉默认是硬编码的 static-list。
方案A：不新增 dashboard，而是提供**一键同步**，把 `ops.stores` 的当前门店集合写入 Metabase 现有看板的下拉参数。

## 工作原理

```
ops.stores (DB)
    ↓
POST /api/admin/metabase/sync-store-dropdown  (dry_run / apply)
    ↓
GET  /api/dashboard/{id}          ← 读取当前 parameters
    ↓
PUT  /api/dashboard/{id}          ← 更新 store_code 参数的 static-list
    ↓
Metabase 看板下拉自动更新
```

## API

### POST /api/admin/metabase/sync-store-dropdown

| 参数 | 位置 | 说明 |
|------|------|------|
| `brand` | query/body | 品牌代码，如 `yufeng`、`bonjur`（默认：`yufeng`） |
| `dry_run` | query/body | `true`=预览 diff，`false`=真正写入（默认：`true`） |

**Dry-run 响应示例：**
```json
{
  "success": true,
  "dry_run": true,
  "brand": "bonjur",
  "dashboard_id": 11,
  "dashboard_name": "Bonjur｜经营看板（对标榆枫）",
  "changes": {
    "adds":    [["sh_pudong", "上海浦东店"]],
    "removes": [["hz_in77", "杭州in77"]],
    "current": [["hz_in77", "杭州in77"], ["sh_wdg", "上海旺鼎阁"]],
    "target":  [["sh_pudong", "上海浦东店"], ["sh_wdg", "上海旺鼎阁"]]
  }
}
```

**Apply 响应示例：**
```json
{
  "success": true,
  "dry_run": false,
  "applied": true,
  "brand": "bonjur",
  "dashboard_id": 11,
  "changes": { ... },
  "log_file": "metabase-store-sync-bonjur-2026-04-02T16-00-00.log"
}
```

### GET /api/admin/metabase/sync-store-dropdown

同 dry-run 预览，但不写 Metabase。用于页面加载时展示 diff。

## 路由规则

| 路由 | 权限 | 说明 |
|------|------|------|
| `POST /api/admin/metabase/sync-store-dropdown` | admin | 同步/预览 |
| `GET  /api/admin/metabase/sync-store-dropdown` | admin | 仅预览 |

## UI 入口

`/admin/stores` → "同步门店下拉" 按钮

1. 点击 → 发起 dry-run 请求
2. 弹出预览面板（新增/删除数量）
3. 点击预览确认 → 弹出二次确认框
4. 确认 → apply 写入 Metabase

## 多品牌支持

品牌 → Dashboard ID 通过以下方式确定（按优先级）：

1. **环境变量**：`METABASE_DASHBOARD_<BRAND>`（推荐，VPS 上配置）
   ```bash
   METABASE_DASHBOARD_YUFENG=8
   METABASE_DASHBOARD_BONJUR=11
   METABASE_DASHBOARD_GELATOMIIIX=12
   ```
2. **代码默认映射**（`ui/src/lib/metabase.ts` 中的 `getBrandDashboardId`）：
   ```ts
   const MAP = { yufeng: 8, bonjur: 11, gelatomiiix: 12 }
   ```

**如何确认 Dashboard ID：**
```bash
# 方法1：看 seeding 脚本输出
python3 scripts/metabase_seed_dashboard.py 2>&1 | grep "dashboard"

# 方法2：直接查 Metabase API
curl -H "X-Api-Key: $METABASE_API_KEY" \
  "$METABASE_URL/api/search?q=yufeng+经营看板&models=dashboard"
```

## VPS / Docker 环境变量配置

在 `docker-compose.yml` 的 `ui` 服务中补充：

```yaml
ui:
  environment:
    METABASE_URL: http://metabase:3000
    METABASE_API_KEY: ${METABASE_API_KEY}
    METABASE_DASHBOARD_YUFENG: 8
    METABASE_DASHBOARD_BONJUR: 11
    METABASE_DASHBOARD_GELATOMIIIX: 12
```

## 验收步骤

### 前置条件
- [ ] `ops.stores` 表已有测试门店数据
- [ ] Metabase 已成功 seed 看板（`store_code` 参数存在）
- [ ] `METABASE_URL` + `METABASE_API_KEY` 环境变量已配置

### 验收用例

**UC-1: Dry-run 预览**
```bash
curl -X POST "http://localhost:3002/api/admin/metabase/sync-store-dropdown?brand=yufeng&dry_run=true" \
  -H "Cookie: wdg_session=<admin-session-token>"
```
预期：`changes.adds`、`changes.removes` 非空则显示 diff

**UC-2: Apply 写入**
```bash
curl -X POST "http://localhost:3002/api/admin/metabase/sync-store-dropdown?brand=yufeng&dry_run=false" \
  -H "Content-Type: application/json" \
  -H "Cookie: wdg_session=<admin-session-token>" \
  -d '{"brand":"yufeng","dry_run":false}'
```
预期：`"applied": true`，去 Metabase 看看板下拉已更新

**UC-3: UI 流程**
1. 登录 admin 账号 → 访问 `/admin/stores`
2. 点击"同步门店下拉" → 弹出预览（新增/删除数量）
3. 点击"×"关闭预览 → 弹出确认框 → 点"确认同步"
4. 页面显示"✅ 同步完成"

### Oracle
```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation
bash scripts/run_change_guard.sh
```
预期：`typescript check` PASS；所有已有关键 feature 通过

## 约束

- ❌ 不新增 dashboard
- ❌ 不复制看板
- ✅ 仅修改现有看板的 `store_code` 参数的 `values_source_config.values`
- ✅ 所有写操作记录到 `artifacts/metabase-store-sync-*.log`

## 相关文件

| 文件 | 用途 |
|------|------|
| `ui/src/lib/metabase.ts` | Metabase API 客户端（共用） |
| `ui/src/app/api/admin/metabase/sync-store-dropdown/route.ts` | API 路由 |
| `ui/src/app/admin/stores/page.tsx` | 同步按钮 + 预览 UI |
| `scripts/metabase_seed_dashboard.py` | Dashboard seeding（含 `store_values_for_brand`） |
| `.env.example` | 环境变量文档 |
