import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';
import { getSessionUser, getCookieName } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { cookies } from 'next/headers';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const RENDER_WAIT_MS = 3_000; // wait for recharts to settle

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, data: null, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');
    const store = searchParams.get('store');
    const month = searchParams.get('month');

    if (!brand || !store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, data: null, error: 'Missing or invalid params: brand, store, month (YYYY-MM)' },
        { status: 400 }
      );
    }

    // Read the session cookie value to pass to puppeteer
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(getCookieName());
    if (!sessionCookie) {
      return NextResponse.json({ success: false, data: null, error: 'No session' }, { status: 401 });
    }

    // Build the page URL — render the same page with the user's filters
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const pageUrl = `${baseUrl}/u/store-report?brand=${encodeURIComponent(brand)}&store=${encodeURIComponent(store)}&month=${encodeURIComponent(month)}&pdfMode=1`;

    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 900 });
      // Set the session cookie so the page can authenticate
      await page.setCookie({
        name: getCookieName(),
        value: sessionCookie.value,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
      });
      await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: PAGE_LOAD_TIMEOUT_MS });
      // Give recharts a moment to render the SVG paths
      await new Promise(r => setTimeout(r, RENDER_WAIT_MS));
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });

      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${brand}_${store}_${month}.pdf"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (err: unknown) {
    return NextResponse.json({ success: false, data: null, error: getErrorMessage(err) }, { status: 500 });
  }
}
