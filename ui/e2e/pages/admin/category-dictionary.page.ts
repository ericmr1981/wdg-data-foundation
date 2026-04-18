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
