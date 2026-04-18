# E2E Testing Plan — wdg-data-foundation/ui

## Status
Approved

## Overview

Add Playwright-based E2E tests covering all frontend pages of the wdg-data-foundation Next.js app. Tests live in `ui/e2e/`, runnable locally and in CI.

---

## 1. Framework & Setup

| Item | Choice |
|------|--------|
| Framework | Playwright (already in `package.json` deps) |
| Test directory | `ui/e2e/` |
| Config file | `ui/playwright.config.ts` |
| Test script | `npm run test:e2e` (add to `package.json`) |

### Browser Targets
- Chromium (default, fastest)
- Firefox, WebKit (optional, `ui/playwright.config.ts` includes them commented out)

### Base URL
`http://localhost:4100` (matches `npm run dev`)

---

## 2. Authentication Strategy

Use Playwright **storage state** files to avoid logging in via UI before every test.

| File | Role |
|------|------|
| `ui/e2e/storage-states/admin.json` | Admin user session |
| `ui/e2e/storage-states/operator.json` | Operator user session |

**How to generate:**
1. Run `npm run dev` in `ui/`
2. Run `npx playwright test --project=chromium --grep "" ui/e2e/tests/setup/auth.setup.ts` (setup script logs in once, saves state)
3. States are checked in; tests reuse them without re-authenticating

All test specs declare `use: { storageState: './storage-states/admin.json' }` (or `operator.json` where relevant) so tests run authenticated.

---

## 3. Test Data (Known Fixtures)

Tests rely on pre-existing database fixtures created once:

| Entity | Name | Purpose |
|--------|------|---------|
| Brand | `TEST_BRANCH` | Target brand for most tests |
| Store | `TEST_STORE` | Associated store |
| Rule Group | `TEST_GROUP` | Group for rule tests |
| Rule | Test rule created in rules.spec.ts | Match tests |

**Seed instructions** in `ui/e2e/seed/README.md`:
1. Log in as admin
2. Create brand `TEST_BRANCH`
3. Create store `TEST_STORE` under it
4. Create rule group `TEST_GROUP`
5. Tests that need additional data create it in `beforeAll` / `beforeEach` via UI or API

---

## 4. Code Organization — Hybrid Page Objects

```
ui/e2e/
├── playwright.config.ts
├── storage-states/
│   ├── admin.json
│   └── operator.json
├── pages/
│   ├── login.page.ts          # Simple — direct locators in tests instead
│   ├── pipeline.page.ts       # Simple — direct locators in tests instead
│   ├── upload.page.ts         # Simple — direct locators in tests instead
│   ├── rules.page.ts          # Complex — Page Object
│   ├── match.page.ts          # Complex — Page Object
│   └── admin/
│       ├── brands.page.ts     # Complex — Page Object
│       ├── stores.page.ts     # Complex — Page Object
│       ├── rule-groups.page.ts # Complex — Page Object
│       ├── category-dictionary.page.ts
│       └── rules-copy.page.ts
├── tests/
│   ├── login.spec.ts
│   ├── pipeline.spec.ts
│   ├── rules.spec.ts
│   ├── match.spec.ts
│   ├── upload.spec.ts
│   └── admin/
│       ├── brands.spec.ts
│       ├── stores.spec.ts
│       ├── rule-groups.spec.ts
│       ├── category-dictionary.spec.ts
│       └── rules-copy.spec.ts
└── seed/
    └── README.md
```

**Rule:** `pages/` = Page Objects for complex pages. Simple pages (Login, Pipeline, Upload) put locators directly in `tests/*.spec.ts`.

---

## 5. Test Coverage

### 5.1 Login (`login.spec.ts`)
- Success: login as admin, redirect to `/pipeline`
- Success: login as operator
- Failure: wrong password shows error message

### 5.2 Pipeline (`pipeline.spec.ts`)
- KPI cards display (total, matched, unmatched, coverage %)
- Coverage table renders rows
- Expand a file row to see details (toggle)

### 5.3 Rules (`rules.spec.ts`)
- Create a new rule via modal form
- Edit an existing rule
- Delete a rule (with confirmation)
- Drag and drop to reorder rules (save order)
- Filter by keyword
- Click "重新匹配" (rerun match)

### 5.4 Match (`match.spec.ts`)
- Unclassified transactions listed
- Single-row quick match (dropdown)
- Batch select + batch match
- Settle transaction to rule (open settle modal, pick rule, confirm)
- Undo a match

### 5.5 Upload (`upload.spec.ts`)
- Upload a `.xlsx` file
- Upload a `.csv` file
- Form validation (missing file, missing store)
- "自动触发导入" checkbox behavior

### 5.6 Admin — Brands (`admin/brands.spec.ts`)
- Create a new brand
- Drag and drop to reorder brands
- Initialize bank template

### 5.7 Admin — Stores (`admin/stores.spec.ts`)
- Create a new store
- Delete a store
- Drag and drop to reorder stores

### 5.8 Admin — Rule Groups (`admin/rule-groups.spec.ts`)
- Create a rule group
- Delete a rule group
- Drag and drop to reorder

### 5.9 Admin — Category Dictionary (`admin/category-dictionary.spec.ts`)
- Edit lvl1 category (add / rename)
- Edit lvl2 category
- Preview sync diff
- Sync to brands

### 5.10 Admin — Rules Copy (`admin/rules-copy.spec.ts`)
- Select source and target brand
- Confirm copy (overwrite mode)

---

## 6. CI Support

```json
// ui/package.json — add script
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

Optional GitHub Actions workflow at `.github/workflows/e2e.yml` (documented as future step, not implemented in initial plan).

---

## 7. Implementation Steps

1. Create `ui/playwright.config.ts`
2. Create `ui/e2e/` directory structure
3. Create auth setup script (`ui/e2e/tests/setup/auth.setup.ts`) to generate storage states
4. Add `test:e2e` script to `package.json`
5. Implement Page Objects for complex pages
6. Implement test specs for all 10 pages
7. Document seed instructions in `ui/e2e/seed/README.md`
8. Verify tests run against dev server
