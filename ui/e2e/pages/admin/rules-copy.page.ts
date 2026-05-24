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
