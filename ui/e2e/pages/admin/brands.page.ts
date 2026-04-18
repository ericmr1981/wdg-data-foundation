import { Page, Locator } from '@playwright/test';

export class BrandsPage {
  readonly page: Page;
  readonly createBtn: Locator;
  readonly brandCodeInput: Locator;
  readonly brandNameInput: Locator;
  readonly initTemplateBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createBtn = page.locator('button:has-text("创建")');
    this.brandCodeInput = page.locator('input[placeholder*="brand_code"]');
    this.brandNameInput = page.locator('input[placeholder*="brand_name"]');
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
