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

  async settleToRule(data: { keyword: string }) {
    await this.page.locator('button:has-text("沉淀")').first().click();
    await this.page.locator('h2:has-text("沉淀为规则")').waitFor();
    await this.page.locator('input').filter({ hasText: '' }).last().fill(data.keyword);
    await this.page.locator('button:has-text("沉淀为规则")').last().click();
  }

  async undoMatch(index: number = 0) {
    await this.page.locator('button:has-text("撤销")').nth(index).click();
  }
}
