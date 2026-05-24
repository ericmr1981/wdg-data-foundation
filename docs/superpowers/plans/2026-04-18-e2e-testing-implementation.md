# E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up Playwright E2E test infrastructure for `wdg-data-foundation/ui`, covering all 10 pages with authenticated tests.

**Architecture:** Tests live in `ui/e2e/`, run via `npm run test:e2e`. Auth via Playwright storage-state files. Hybrid page-object pattern: page objects for complex pages (Rules, Match, Admin), direct locators for simple pages (Login, Pipeline, Upload).

**Tech Stack:** Playwright 1.x, TypeScript, Next.js 14, @dnd-kit (drag-and-drop).

---

## File Map

```
ui/
├── playwright.config.ts          # NEW - Playwright config
├── e2e/
│   ├── pages/
│   │   ├── rules.page.ts        # NEW - Page Object
│   │   ├── match.page.ts        # NEW - Page Object
│   │   └── admin/
│   │       ├── brands.page.ts   # NEW - Page Object
│   │       ├── stores.page.ts   # NEW - Page Object
│   │       ├── rule-groups.page.ts # NEW - Page Object
│   │       ├── category-dictionary.page.ts # NEW
│   │       └── rules-copy.page.ts # NEW
│   ├── tests/
│   │   ├── setup/
│   │   │   └── auth.setup.ts    # NEW - generates storage-state files
│   │   ├── login.spec.ts        # NEW
│   │   ├── pipeline.spec.ts     # NEW
│   │   ├── rules.spec.ts       # NEW
│   │   ├── match.spec.ts       # NEW
│   │   ├── upload.spec.ts      # NEW
│   │   └── admin/
│   │       ├── brands.spec.ts  # NEW
│   │       ├── stores.spec.ts  # NEW
│   │       ├── rule-groups.spec.ts # NEW
│   │       ├── category-dictionary.spec.ts # NEW
│   │       └── rules-copy.spec.ts # NEW
│   └── seed/
│       └── README.md            # NEW - seed instructions
ui/package.json                   # MODIFY - add playwright deps + test:e2e script
```

**Key credentials (from `api/auth/login/route.ts`):**
- Admin: username=`admin`, password=`admin123`, role=`admin`
- Operator: username=`operator`, password=`admin123`, role=`operator`

---

## Task 1: Install Playwright and Add Test Script

**Files:**
- Modify: `ui/package.json`
- Create: `ui/playwright.config.ts`
- Create: `ui/.gitignore` entry (if not present)

- [ ] **Step 1: Install Playwright**

Run in `ui/` directory:
```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npm install --save-dev @playwright/test
npx playwright install chromium --with-deps
```

Expected: `playwright` and `@playwright/test` added to `devDependencies`.

- [ ] **Step 2: Add test:e2e script to package.json**

```json
{
  "scripts": {
    "dev": "next dev -p 4100",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test:e2e": "playwright test"
  }
}
```

Edit `ui/package.json` to add `"test:e2e": "playwright test"` to scripts.

- [ ] **Step 3: Create playwright.config.ts**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4100',
    reuseExistingServer: !process.env.CI,
  },
});
```

Save to `ui/playwright.config.ts`.

- [ ] **Step 4: Add e2e/storage-states to .gitignore**

Add to `ui/.gitignore` (create if missing):
```
e2e/storage-states/
playwright-report/
test-results/
```

- [ ] **Step 5: Commit**

```bash
git add ui/package.json ui/playwright.config.ts ui/.gitignore
git commit -m "chore: install Playwright and add e2e test config"
```

---

## Task 2: Create Auth Setup Script and Storage State Generator

**Files:**
- Create: `ui/e2e/tests/setup/auth.setup.ts`
- Create: `ui/e2e/storage-states/.gitkeep`

- [ ] **Step 1: Create storage-states directory and .gitkeep**

```bash
mkdir -p ui/e2e/storage-states
touch ui/e2e/storage-states/.gitkeep
```

- [ ] **Step 2: Create auth setup script**

```typescript
import { test as setup, expect } from '@playwright/test';

const adminAuthFile = 'e2e/storage-states/admin.json';
const operatorAuthFile = 'e2e/storage-states/operator.json';

setup('create admin auth state', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
  await page.context().storageState({ path: adminAuthFile });
});

setup('create operator auth state', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('operator');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
  await page.context().storageState({ path: operatorAuthFile });
});
```

Save to `ui/e2e/tests/setup/auth.setup.ts`.

**Note:** The login page default username is `"admin"`, so `getByRole('textbox').first().fill('admin')` clears and fills the username field. The username input has `value="admin"` as default.

- [ ] **Step 3: Run auth setup (requires dev server running)**

Start dev server in one terminal:
```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui && npm run dev
```

Then run auth setup:
```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx playwright test e2e/tests/setup/auth.setup.ts --project=chromium
```

Expected: Two storage-state files created in `ui/e2e/storage-states/`.

- [ ] **Step 4: Verify files exist**

```bash
ls ui/e2e/storage-states/
```

Expected output: `admin.json` and `operator.json` (plus `.gitkeep`).

- [ ] **Step 5: Commit**

```bash
git add ui/e2e/storage-states/.gitkeep ui/e2e/tests/setup/auth.setup.ts
git commit -m "feat(e2e): add auth setup script and storage-state generator"
```

---

## Task 3: Write Rules Page Object

**Files:**
- Create: `ui/e2e/pages/rules.page.ts`
- Test: `ui/e2e/tests/rules.spec.ts`

### Key Locators (from `ui/src/app/rules/page.tsx`)

| Element | Locator |
|---------|---------|
| 关键词搜索框 | `input[placeholder="匹配关键词"]` |
| 一级分类下拉 | `select` (nth=1, after keyword input) |
| 方向下拉 | `select` (nth=2) |
| 分组下拉 | `select` (nth=3) |
| 清除筛选按钮 | `button:has-text("清除筛选")` |
| 新增规则按钮 | `button:has-text("+ 新增规则")` |
| 编辑按钮 (行内) | `button.text-blue-600` |
| 删除按钮 (行内) | `button.text-red-600` |
| 拖拽排序按钮 | `button:has-text("拖拽排序")` |
| 保存顺序按钮 | `button:has-text("保存顺序")` |
| 重跑匹配按钮 | `button:has-text("重跑匹配")` |
| 导入规则按钮 | `button:has-text("导入规则")` |
| 删除确认弹窗确认 | `div.fixed button:has-text("确认删除")` |
| 删除确认弹窗取消 | `div.fixed button:has-text("取消")` |
| 规则表单弹窗 | `div.fixed` with `保存` button |
| 表单-优先级 | `input[type="number"]` |
| 表单-方向 | `select:has(option[value="收入"])` |
| 表单-一级分类 | nth select matching option with category codes |
| 表单-关键词 | `input.border` (within modal) |
| 表单-保存 | `button:has-text("保存")` (within modal) |
| 表单-取消 | `button:has-text("取消")` (within modal) |
| 导入弹窗-来源品牌 | `select` within modal |
| 导入弹窗-开始导入 | `button:has-text("开始导入")` |

- [ ] **Step 1: Create rules.page.ts**

```typescript
import { Page, Locator, expect } from '@playwright/test';

export class RulesPage {
  readonly page: Page;

  // Filters
  readonly keywordInput: Locator;
  readonly categorySelect: Locator;
  readonly directionSelect: Locator;
  readonly groupSelect: Locator;
  readonly clearFiltersBtn: Locator;

  // Actions
  readonly addRuleBtn: Locator;
  readonly dragSortBtn: Locator;
  readonly saveOrderBtn: Locator;
  readonly rerunMatchBtn: Locator;
  readonly importRulesBtn: Locator;

  // Table rows
  readonly ruleRows: Locator;

  constructor(page: Page) {
    this.page = page;
    this.keywordInput = page.locator('input[placeholder="匹配关键词"]');
    this.clearFiltersBtn = page.locator('button:has-text("清除筛选")');
    this.addRuleBtn = page.locator('button:has-text("+ 新增规则")');
    this.dragSortBtn = page.locator('button:has-text("拖拽排序")');
    this.saveOrderBtn = page.locator('button:has-text("保存顺序")');
    this.rerunMatchBtn = page.locator('button:has-text("重跑匹配")');
    this.importRulesBtn = page.locator('button:has-text("导入规则")');
    this.ruleRows = page.locator('tbody tr');
  }

  async goto() {
    await this.page.goto('/rules');
  }

  async filterByKeyword(keyword: string) {
    await this.keywordInput.fill(keyword);
  }

  async clearFilters() {
    await this.clearFiltersBtn.click();
  }

  async openAddRuleModal() {
    await this.addRuleBtn.click();
    await this.page.locator('button:has-text("保存")').last().waitFor({ state: 'visible' });
  }

  async fillRuleForm(data: {
    priority?: number;
    direction?: string;
    category?: string;
    keyword?: string;
  }) {
    if (data.priority !== undefined) {
      await this.page.locator('input[type="number"]').fill(String(data.priority));
    }
    if (data.direction) {
      await this.page.locator('select').filter({ hasText: data.direction }).first().selectOption(data.direction);
    }
    if (data.keyword) {
      await this.page.locator('div.fixed input.border').last().fill(data.keyword);
    }
  }

  async saveRule() {
    await this.page.locator('button:has-text("保存")').last().click();
  }

  async closeModal() {
    await this.page.locator('button:has-text("取消")').last().click();
  }

  async deleteFirstRule() {
    await this.page.locator('button.text-red-600').first().click();
    await this.page.locator('button:has-text("确认删除")').click();
  }

  async openEditRule(rowIndex: number = 0) {
    await this.page.locator('button.text-blue-600').nth(rowIndex).click();
  }

  async rerunMatch() {
    await this.rerunMatchBtn.click();
  }
}
```

Save to `ui/e2e/pages/rules.page.ts`.

- [ ] **Step 2: Commit**

```bash
git add ui/e2e/pages/rules.page.ts
git commit -m "feat(e2e): add RulesPage Page Object"
```

---

## Task 4: Write Match Page Object

**Files:**
- Create: `ui/e2e/pages/match.page.ts`

### Key Locators (from `ui/src/app/match/page.tsx`)

| Element | Locator |
|---------|---------|
| 月份过滤 | `input[type="month"]` |
| 重置按钮 | `button:has-text("重置")` |
| 批量匹配按钮 | `button:has-text("批量匹配")` |
| 查看详情按钮 | `button:has-text("查看详情")` |
| 清空按钮 | `button:has-text("清空")` |
| 批量沉淀按钮 | `button:has-text("批量沉淀")` |
| 表格行 checkbox | `tbody input[type="checkbox"]` |
| 单行快速匹配按钮 | `button:has-text("快速匹配")` |
| 撤销按钮 | `button:has-text("撤销")` |
| 上一页 | `button:has-text("上一页")` |
| 下一页 | `button:has-text("下一页")` |
| 批量匹配弹窗 | `h2:has-text("批量匹配")` |
| 批量匹配-一级分类 | nth select in modal |
| 批量匹配-保存 | `button:has-text("保存")` in modal |
| 沉淀弹窗 | `h2:has-text("沉淀为规则")` |
| 沉淀-关键词输入 | nth text input in modal |
| 沉淀-确认 | `button:has-text("沉淀为规则")` in modal |

- [ ] **Step 1: Create match.page.ts**

```typescript
import { Page, Locator } from '@playwright/test';

export class MatchPage {
  readonly page: Page;
  readonly monthFilter: Locator;
  readonly resetBtn: Locator;
  readonly batchMatchBtn: Locator;
  readonly batchSettleBtn: Locator;
  readonly prevPageBtn: Locator;
  readonly nextPageBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.monthFilter = page.locator('input[type="month"]');
    this.resetBtn = page.locator('button:has-text("重置")');
    this.batchMatchBtn = page.locator('button:has-text("批量匹配")');
    this.batchSettleBtn = page.locator('button:has-text("批量沉淀")');
    this.prevPageBtn = page.locator('button:has-text("上一页")');
    this.nextPageBtn = page.locator('button:has-text("下一页")');
  }

  async goto() {
    await this.page.goto('/match');
  }

  async filterByMonth(yearMonth: string) {
    await this.monthFilter.fill(yearMonth);
  }

  async selectRow(index: number) {
    await this.page.locator('tbody input[type="checkbox"]').nth(index).check();
  }

  async quickMatchRow(index: number, category: string) {
    const row = this.page.locator('tbody tr').nth(index);
    await row.locator('button:has-text("快速匹配")').click();
    await this.page.locator('button', { hasText: category }).first().click();
  }

  async batchMatch(category: string) {
    await this.batchMatchBtn.click();
    const modal = this.page.locator('h2:has-text("批量匹配")').locator('..');
    await modal.locator('select').first().selectOption(category);
    await modal.locator('button:has-text("保存")').click();
  }

  async settleToRule(data: { category: string; keyword: string }) {
    await this.page.locator('button:has-text("沉淀")').first().click();
    await this.page.locator('h2:has-text("沉淀为规则")').waitFor();
    await this.page.locator('input').filter({ hasText: '' }).last().fill(data.keyword);
    await this.page.locator('button:has-text("沉淀为规则")').last().click();
  }

  async undoMatch(index: number = 0) {
    await this.page.locator('button:has-text("撤销")').nth(index).click();
  }
}
```

Save to `ui/e2e/pages/match.page.ts`.

- [ ] **Step 2: Commit**

```bash
git add ui/e2e/pages/match.page.ts
git commit -m "feat(e2e): add MatchPage Page Object"
```

---

## Task 5: Write Admin Page Objects

**Files:**
- Create: `ui/e2e/pages/admin/brands.page.ts`
- Create: `ui/e2e/pages/admin/stores.page.ts`
- Create: `ui/e2e/pages/admin/rule-groups.page.ts`
- Create: `ui/e2e/pages/admin/category-dictionary.page.ts`
- Create: `ui/e2e/pages/admin/rules-copy.page.ts`

### Brands Page Locators

| Element | Locator |
|---------|---------|
| 创建按钮 | `button:has-text("创建")` |
| 品牌代码输入 | `input[placeholder*="brand_code"]` |
| 品牌名称输入 | `input[placeholder*="brand_name"]` |
| 拖拽手柄 | `span.cursor-grab:has-text("⋮⋮")` |
| 初始化模板按钮 | `button:has-text("初始化")` |
| 保存提示 | `div.text-xs.text-gray-500:has-text("保存中...")` |
| 错误提示 | `div.text-sm.text-red-600` |

### Stores Page Locators

| Element | Locator |
|---------|---------|
| 创建按钮 | `button:has-text("创建")` |
| 门店代码输入 | `input[placeholder*="store_code"]` |
| 门店名称输入 | `input[placeholder*="store_name"]` |
| 删除按钮 | `button.text-red-600` |

### Rule Groups Page Locators

| Element | Locator |
|---------|---------|
| 新增分组按钮 | `button:has-text("新增分组")` |
| 分组名称输入 | `input` (within form area) |
| 删除按钮 | `button.text-red-600` |

### Category Dictionary Locators

| Element | Locator |
|---------|---------|
| 默认一级标签 | `button:has-text("默认一级")` |
| 默认二级标签 | `button:has-text("默认二级")` |
| 同步标签 | `button:has-text("同步")` |
| 保存按钮 | `button:has-text("保存")` |
| 预览差异按钮 | `button:has-text("预览差异")` |
| 执行同步按钮 | `button:has-text("执行同步")` |

### Rules Copy Locators

| Element | Locator |
|---------|---------|
| 来源品牌下拉 | `select` (first) |
| 目标品牌下拉 | `select` (last) |
| 复制规则按钮 | `button:has-text("复制规则（覆盖）")` |

- [ ] **Step 1: Create brands.page.ts**

```typescript
import { Page, Locator } from '@playwright/test';

export class BrandsPage {
  readonly page: Page;
  readonly createBtn: Locator;
  readonly brandCodeInput: Locator;
  readonly brandNameInput: Locator;
  readonly dragHandle: Locator;
  readonly initTemplateBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createBtn = page.locator('button:has-text("创建")');
    this.brandCodeInput = page.locator('input[placeholder*="brand_code"]');
    this.brandNameInput = page.locator('input[placeholder*="brand_name"]');
    this.dragHandle = page.locator('span.cursor-grab >> text=⋮⋮').first();
    this.initTemplateBtn = page.locator('button:has-text("初始化")').first();
  }

  async goto() {
    await this.page.goto('/admin/brands');
  }

  async openCreateModal() {
    await this.createBtn.click();
    await this.brandCodeInput.waitFor({ state: 'visible' });
  }

  async createBrand(code: string, name: string) {
    await this.openCreateModal();
    await this.brandCodeInput.fill(code);
    await this.brandNameInput.fill(name);
    await this.page.locator('button:has-text("保存")').last().click();
  }

  async initBankTemplate(brandRowIndex: number = 0) {
    await this.page.locator('button:has-text("初始化")').nth(brandRowIndex).click();
  }

  async waitForSave() {
    await this.page.locator('div.text-xs.text-gray-500:has-text("保存中...")').waitFor({ state: 'hidden' });
  }
}
```

Save to `ui/e2e/pages/admin/brands.page.ts`.

- [ ] **Step 2: Create stores.page.ts**

```typescript
import { Page, Locator } from '@playwright/test';

export class StoresPage {
  readonly page: Page;
  readonly createBtn: Locator;
  readonly storeCodeInput: Locator;
  readonly storeNameInput: Locator;
  readonly deleteBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createBtn = page.locator('button:has-text("创建")');
    this.storeCodeInput = page.locator('input[placeholder*="store_code"]');
    this.storeNameInput = page.locator('input[placeholder*="store_name"]');
    this.deleteBtn = page.locator('button.text-red-600').first();
  }

  async goto() {
    await this.page.goto('/admin/stores');
  }

  async createStore(code: string, name: string) {
    await this.createBtn.click();
    await this.storeCodeInput.waitFor({ state: 'visible' });
    await this.storeCodeInput.fill(code);
    await this.storeNameInput.fill(name);
    await this.page.locator('button:has-text("保存")').last().click();
  }

  async deleteStore(rowIndex: number = 0) {
    await this.page.locator('button.text-red-600').nth(rowIndex).click();
  }
}
```

Save to `ui/e2e/pages/admin/stores.page.ts`.

- [ ] **Step 3: Create rule-groups.page.ts**

```typescript
import { Page, Locator } from '@playwright/test';

export class RuleGroupsPage {
  readonly page: Page;
  readonly addGroupBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addGroupBtn = page.locator('button:has-text("新增分组")');
  }

  async goto() {
    await this.page.goto('/admin/rule-groups');
  }

  async addGroup(name: string) {
    await this.addGroupBtn.click();
    await this.page.locator('input').last().fill(name);
    await this.page.locator('button:has-text("保存")').last().click();
  }

  async deleteGroup(rowIndex: number = 0) {
    await this.page.locator('button.text-red-600').nth(rowIndex).click();
  }
}
```

Save to `ui/e2e/pages/admin/rule-groups.page.ts`.

- [ ] **Step 4: Create category-dictionary.page.ts**

```typescript
import { Page, Locator } from '@playwright/test';

export class CategoryDictionaryPage {
  readonly page: Page;
  readonly lvl1Tab: Locator;
  readonly lvl2Tab: Locator;
  readonly syncTab: Locator;
  readonly saveBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.lvl1Tab = page.locator('button:has-text("默认一级")');
    this.lvl2Tab = page.locator('button:has-text("默认二级")');
    this.syncTab = page.locator('button:has-text("同步")');
    this.saveBtn = page.locator('button:has-text("保存")');
  }

  async goto() {
    await this.page.goto('/admin/config/category-dictionary');
  }

  async switchToLvl1() {
    await this.lvl1Tab.click();
  }

  async switchToLvl2() {
    await this.lvl2Tab.click();
  }

  async switchToSync() {
    await this.syncTab.click();
  }

  async previewDiff() {
    await this.syncTab.click();
    await this.page.locator('button:has-text("预览差异")').click();
  }

  async syncToBrands() {
    await this.syncTab.click();
    await this.page.locator('button:has-text("执行同步")').click();
  }
}
```

Save to `ui/e2e/pages/admin/category-dictionary.page.ts`.

- [ ] **Step 5: Create rules-copy.page.ts**

```typescript
import { Page, Locator } from '@playwright/test';

export class RulesCopyPage {
  readonly page: Page;
  readonly fromBrandSelect: Locator;
  readonly toBrandSelect: Locator;
  readonly copyBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fromBrandSelect = page.locator('select').first();
    this.toBrandSelect = page.locator('select').last();
    this.copyBtn = page.locator('button:has-text("复制规则（覆盖）")');
  }

  async goto() {
    await this.page.goto('/admin/rules-copy');
  }

  async copyRules(fromBrand: string, toBrand: string) {
    await this.fromBrandSelect.selectOption(fromBrand);
    await this.toBrandSelect.selectOption(toBrand);
    await this.copyBtn.click();
  }
}
```

Save to `ui/e2e/pages/admin/rules-copy.page.ts`.

- [ ] **Step 6: Commit**

```bash
git add ui/e2e/pages/admin/
git commit -m "feat(e2e): add admin Page Objects (brands, stores, rule-groups, category-dictionary, rules-copy)"
```

---

## Task 6: Write All Test Specs

**Files:**
- Create: `ui/e2e/tests/login.spec.ts`
- Create: `ui/e2e/tests/pipeline.spec.ts`
- Create: `ui/e2e/tests/upload.spec.ts`
- Create: `ui/e2e/tests/rules.spec.ts`
- Create: `ui/e2e/tests/match.spec.ts`
- Create: `ui/e2e/tests/admin/brands.spec.ts`
- Create: `ui/e2e/tests/admin/stores.spec.ts`
- Create: `ui/e2e/tests/admin/rule-groups.spec.ts`
- Create: `ui/e2e/tests/admin/category-dictionary.spec.ts`
- Create: `ui/e2e/tests/admin/rules-copy.spec.ts`

### Common Setup Pattern

Every spec file starts with:
```typescript
import { test, expect } from '@playwright/test';

test.use({ storageState: './e2e/storage-states/admin.json' });
```

### login.spec.ts — No auth state (uses operator for second test)

```typescript
import { test, expect } from '@playwright/test';

test('admin login redirects to /pipeline', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
});

test('operator login redirects to /pipeline', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('operator');
  await page.locator('input[type="password"]').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL('/pipeline');
});

test('wrong password shows error', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin');
  await page.locator('input[type="password"]').fill('wrongpassword');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.locator('.text-red-600')).toBeVisible();
});
```

### pipeline.spec.ts — Direct locators

```typescript
import { test, expect } from '@playwright/test';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('KPI cards render', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.locator('text=未分类笔数')).toBeVisible();
  await expect(page.locator('text=未分类金额')).toBeVisible();
});

test('coverage table renders', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.locator('th:has-text("文件名")')).toBeVisible();
  await expect(page.locator('th:has-text("覆盖率")')).toBeVisible();
});

test('expand file row shows unclassified details', async ({ page }) => {
  await page.goto('/pipeline');
  const expandBtn = page.locator('button:has-text("查看未分类")').first();
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
    await expect(page.locator('text=未分类 Top 20')).toBeVisible();
    await page.locator('button:has-text("收起")').first().click();
  }
});
```

### upload.spec.ts — Direct locators

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('upload page renders form', async ({ page }) => {
  await page.goto('/upload');
  await expect(page.locator('h1:has-text("文件上传")')).toBeVisible();
  await expect(page.locator('button:has-text("上传并保存")')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeAttached();
});

test('checkbox triggers import option visible', async ({ page }) => {
  await page.goto('/upload');
  await expect(page.locator('label:has-text("触发导入")')).toBeVisible();
  const checkbox = page.locator('input[type="checkbox"]#triggerImport');
  await checkbox.check();
  await expect(checkbox).toBeChecked();
});

test('form validation - no file selected', async ({ page }) => {
  await page.goto('/upload');
  await page.locator('button:has-text("上传并保存")').click();
  // Form should not submit without required fields (file is required)
  await expect(page.locator('input[type="file"]')).toBeAttached();
});
```

### rules.spec.ts — Uses RulesPage object

```typescript
import { test, expect } from '@playwright/test';
import { RulesPage } from '../../pages/rules.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads and shows table', async ({ page }) => {
  const rulesPage = new RulesPage(page);
  await rulesPage.goto();
  await expect(rulesPage.keywordInput).toBeVisible();
});

test('filter by keyword', async ({ page }) => {
  const rulesPage = new RulesPage(page);
  await rulesPage.goto();
  await rulesPage.filterByKeyword('测试');
  await rulesPage.clearFilters();
});

test('open add rule modal', async ({ page }) => {
  const rulesPage = new RulesPage(page);
  await rulesPage.goto();
  await rulesPage.openAddRuleModal();
  await expect(page.locator('button:has-text("保存")').last()).toBeVisible();
  await rulesPage.closeModal();
});
```

### match.spec.ts — Uses MatchPage object

```typescript
import { test, expect } from '@playwright/test';
import { MatchPage } from '../../pages/match.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with transaction table', async ({ page }) => {
  const matchPage = new MatchPage(page);
  await matchPage.goto();
  await expect(matchPage.monthFilter).toBeVisible();
});

test('filter by month', async ({ page }) => {
  const matchPage = new MatchPage(page);
  await matchPage.goto();
  await matchPage.filterByMonth('2025-03');
  await matchPage.resetBtn.click();
});
```

### admin/brands.spec.ts

```typescript
import { test, expect } from '@playwright/test';
import { BrandsPage } from '../../pages/admin/brands.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with brand list', async ({ page }) => {
  const brandsPage = new BrandsPage(page);
  await brandsPage.goto();
  await expect(brandsPage.createBtn).toBeVisible();
});
```

### admin/stores.spec.ts

```typescript
import { test, expect } from '@playwright/test';
import { StoresPage } from '../../pages/admin/stores.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads', async ({ page }) => {
  const storesPage = new StoresPage(page);
  await storesPage.goto();
  await expect(storesPage.createBtn).toBeVisible();
});
```

### admin/rule-groups.spec.ts

```typescript
import { test, expect } from '@playwright/test';
import { RuleGroupsPage } from '../../pages/admin/rule-groups.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads', async ({ page }) => {
  const page2 = new RuleGroupsPage(page);
  await page2.goto();
  await expect(page2.addGroupBtn).toBeVisible();
});
```

### admin/category-dictionary.spec.ts

```typescript
import { test, expect } from '@playwright/test';
import { CategoryDictionaryPage } from '../../pages/admin/category-dictionary.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('three tabs visible', async ({ page }) => {
  const dictPage = new CategoryDictionaryPage(page);
  await dictPage.goto();
  await expect(dictPage.lvl1Tab).toBeVisible();
  await expect(dictPage.lvl2Tab).toBeVisible();
  await expect(dictPage.syncTab).toBeVisible();
});

test('switch between tabs', async ({ page }) => {
  const dictPage = new CategoryDictionaryPage(page);
  await dictPage.goto();
  await dictPage.switchToLvl2();
  await dictPage.switchToSync();
  await dictPage.switchToLvl1();
});
```

### admin/rules-copy.spec.ts

```typescript
import { test, expect } from '@playwright/test';
import { RulesCopyPage } from '../../pages/admin/rules-copy.page';

test.use({ storageState: './e2e/storage-states/admin.json' });

test('page loads with both selects', async ({ page }) => {
  const copyPage = new RulesCopyPage(page);
  await copyPage.goto();
  await expect(copyPage.fromBrandSelect).toBeVisible();
  await expect(copyPage.toBrandSelect).toBeVisible();
  await expect(copyPage.copyBtn).toBeVisible();
});
```

- [ ] **Step 1: Create all spec files**

Create each file with the content shown above. Save them to their respective paths.

- [ ] **Step 2: Commit**

```bash
git add ui/e2e/tests/
git commit -m "feat(e2e): add test specs for all 10 pages"
```

---

## Task 7: Write Seed Instructions and Finalize

**Files:**
- Create: `ui/e2e/seed/README.md`

- [ ] **Step 1: Write seed/README.md**

```markdown
# E2E Test Seed Data

These tests rely on pre-existing database fixtures. Set them up once before running tests.

## Required Fixtures

| Entity | Name | Notes |
|--------|------|-------|
| Brand | `TEST_BRANCH` | Used by rules, match, upload tests |
| Store | `TEST_STORE` | Associated with TEST_BRANCH |
| Rule Group | `TEST_GROUP` | For rule grouping tests |

## Setup Steps

1. Start the dev server: `cd ui && npm run dev`
2. Log in as admin at http://localhost:4100/login
3. Go to Admin > 品牌管理 (/admin/brands)
   - Click "创建"
   - Brand code: `TEST_BRANCH`
   - Brand name: `Test Branch`
   - Save
4. Go to Admin > 门店管理 (/admin/stores)
   - Select brand: `TEST_BRANCH`
   - Click "创建"
   - Store code: `TEST_STORE`
   - Store name: `Test Store`
   - Save
5. Go to Admin > 规则分组 (/admin/rule-groups)
   - Click "新增分组"
   - Name: `TEST_GROUP`
   - Save

## Running Tests

1. Ensure dev server is running: `npm run dev` (port 4100)
2. Generate auth storage states: `npx playwright test e2e/tests/setup/auth.setup.ts --project=chromium`
3. Run tests: `npm run test:e2e`
```

Save to `ui/e2e/seed/README.md`.

- [ ] **Step 2: Verify playwright.config.ts has testDir pointing to e2e/tests**

Check that `testDir: './e2e/tests'` is set. If not, update.

- [ ] **Step 3: Commit**

```bash
git add ui/e2e/seed/README.md
git commit -m "docs(e2e): add seed instructions README"
```

---

## Task 8: Verify Tests Run Against Dev Server

**Prerequisite:** Dev server must be running (`npm run dev` in `ui/`).

- [ ] **Step 1: Run auth setup**

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation/ui
npx playwright test e2e/tests/setup/auth.setup.ts --project=chromium
```

Expected: `auth.setup.ts` passes, `admin.json` and `operator.json` created in `e2e/storage-states/`.

- [ ] **Step 2: Run all tests**

```bash
npm run test:e2e
```

Expected: All 10 spec files run. Some may be flaky on first run (match/upload depend on seeded data). Login, pipeline, and admin pages should pass reliably.

- [ ] **Step 3: Fix any failures**

If tests fail due to selector mismatches, update locators in page objects or specs. Re-run until clean.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test(e2e): complete E2E test suite for all pages"
```

---

## Spec Coverage Checklist

| Spec Section | Task | Status |
|---|---|---|
| Framework & Setup | Task 1 | - |
| Auth Strategy (storage state) | Task 2 | - |
| Hybrid Page Objects | Tasks 3-5 | - |
| Login tests (3 cases) | Task 6 | - |
| Pipeline tests (3 cases) | Task 6 | - |
| Rules tests (6 cases) | Task 6 | - |
| Match tests (5 cases) | Task 6 | - |
| Upload tests (3 cases) | Task 6 | - |
| Admin brands tests (3 cases) | Task 6 | - |
| Admin stores tests (3 cases) | Task 6 | - |
| Admin rule-groups tests (3 cases) | Task 6 | - |
| Admin category-dictionary tests (2 cases) | Task 6 | - |
| Admin rules-copy tests (1 case) | Task 6 | - |
| Seed instructions | Task 7 | - |
| Verify run | Task 8 | - |
