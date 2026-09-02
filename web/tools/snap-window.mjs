// Screenshot a page with a real desktop Chromium (Playwright, headed). Windows node:
//   node tools/snap-window.mjs "http://localhost:5173/matches/<id>" "D:\\path\\out.png"
const { chromium } = await import('file:///D:/Cero-One-City/web/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ headless: false, args: ['--window-size=1600,1000'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
await page.goto(process.argv[2] ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);
await page.screenshot({ path: process.argv[3] ?? 'live-window.png' });
await browser.close();
