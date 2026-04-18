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
