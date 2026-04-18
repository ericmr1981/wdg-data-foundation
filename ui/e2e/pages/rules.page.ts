import { Page, Locator, expect } from '@playwright/test';

export class RulesPage {
  readonly page: Page;
  readonly keywordInput: Locator;
  readonly clearFiltersBtn: Locator;
  readonly addRuleBtn: Locator;
  readonly dragSortBtn: Locator;
  readonly saveOrderBtn: Locator;
  readonly rerunMatchBtn: Locator;
  readonly importRulesBtn: Locator;
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

  async openEditRule(rowIndex: number = 0) {
    await this.page.locator('button.text-blue-600').nth(rowIndex).click();
    await this.page.locator('button:has-text("保存")').last().waitFor({ state: 'visible' });
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

  async rerunMatch() {
    await this.rerunMatchBtn.click();
  }

  async openImportModal() {
    await this.importRulesBtn.click();
    await this.page.locator('button:has-text("开始导入")').waitFor({ state: 'visible' });
  }

  async enableDragSort() {
    await this.dragSortBtn.click();
  }
}
