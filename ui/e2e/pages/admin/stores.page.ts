import { Page, Locator } from '@playwright/test';

export class StoresPage {
  readonly page: Page;
  readonly createBtn: Locator;
  readonly storeCodeInput: Locator;
  readonly storeNameInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createBtn = page.locator('button:has-text("创建")');
    this.storeCodeInput = page.locator('input[placeholder*="store_code"]');
    this.storeNameInput = page.locator('input[placeholder*="store_name"]');
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
