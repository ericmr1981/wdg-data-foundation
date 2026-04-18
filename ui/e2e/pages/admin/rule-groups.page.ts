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
