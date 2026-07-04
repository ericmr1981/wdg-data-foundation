const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1800 } });
  await context.addCookies([{name:'wdg_session',value:'1c3f7f60-84ac-4248-8d03-578fc2c60f17',domain:'127.0.0.1',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4100/u/income?brand=gelatomiiix&period=all&span=month&store=sh_xtd', {waitUntil: 'networkidle', timeout: 30000});
  await page.waitForTimeout(5000);
  // Log brand select value
  const brandVal = await page.evaluate(() => {
    const sel = document.querySelector('select');
    return sel ? sel.value : null;
  });
  console.log('brand select value:', brandVal);
  // List brand select options
  const brandOpts = await page.evaluate(() => {
    const sel = document.querySelector('select');
    return sel ? Array.from(sel.options).map(o => o.value) : [];
  });
  console.log('brand options:', brandOpts);
  await browser.close();
})();
