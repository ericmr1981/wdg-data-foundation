// ui/tests/e2e/agent-chat-flow.test.ts
// E2E for Agent-First product surface (Task 23).
//
// NOTE: v0 ChatWidget has no data-testid attributes — we use the textarea
// placeholder ("问点什么…(Enter 发送, Shift+Enter 换行)") as a robust selector.
// The /u/notifications page renders SSR with an <h1>通知中心</h1> heading.
//
// Test 1 (chat flow) depends on:
//   - NEXT_PUBLIC_AGENT_ROLLOUT_PERCENT=100  (server env)
//   - Agent service running + valid ANTHROPIC_API_KEY
//   - LLM is slow + flaky — keep this in `test.describe.skip` by default
//     so CI does not fail on transient model errors. Run locally via:
//       npx playwright test agent-chat-flow --grep "@agent" --headed
//
// Test 2 (notification center) is pure SSR — runs in CI.

import { test, expect, type Page } from '@playwright/test'

const ADMIN_USER = process.env.WDG_ADMIN_USER || 'analyst@wdg.com'
const ADMIN_PASS = process.env.WDG_ADMIN_PASS || 'test-password'

async function loginViaUi(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  // v0 login form: first input is username, second is password (no name=email).
  const userInput = page.locator('input').first()
  const passInput = page.locator('input[type="password"]')
  await userInput.fill(ADMIN_USER)
  await passInput.fill(ADMIN_PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/u/, { timeout: 15_000 })
}

test.describe('Agent-First product surface', () => {
  test('B 用户在 ChatWidget 问问题, Agent 回应', async ({ page }) => {
    test.skip(
      !process.env.RUN_AGENT_E2E,
      'Set RUN_AGENT_E2E=1 to run. Requires Agent service + LLM key (slow + flaky).',
    )

    await loginViaUi(page)

    // Open ChatWidget (Cmd/Ctrl+K), same shortcut as ChatDrawer
    await page.keyboard.press('Control+K')

    // v0 ChatInput textarea uses placeholder; no data-testid.
    const input = page.locator('textarea[placeholder*="问点什么"]')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill('蜜可诗上月财务')
    await input.press('Enter')

    // Assistant bubble: bg-white + rounded-2xl on the left side of MessageList.
    // We use a structural selector because v0 has no data-testid.
    const assistantBubble = page.locator('div.bg-white.rounded-2xl.rounded-tl-sm').first()
    await expect(assistantBubble).toBeVisible({ timeout: 30_000 })
    // Sanity: bubble has rendered some content
    await expect(assistantBubble).not.toBeEmpty()
  })

  test('通知中心页面能加载', async ({ page }) => {
    // 验证 SSR 渲染 — 不需要 agent 真起, 跑得快, CI 友好
    await loginViaUi(page)
    await page.goto('/u/notifications')
    await expect(page.locator('h1')).toContainText('通知中心')
  })
})
