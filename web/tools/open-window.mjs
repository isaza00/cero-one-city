// Open the app in a real desktop Chromium window (Playwright, headed).
// Run with the WINDOWS node (PowerShell / Git Bash, or node.exe from WSL) so the
// browser shares localhost with the Vite dev server:
//   node tools/open-window.mjs "http://localhost:5173/matches/<id>"
const { chromium } = await import('file:///D:/Cero-One-City/web/node_modules/playwright/index.mjs');
const browser = await chromium.launch({
  headless: false,
  args: ['--window-size=1600,1000', '--window-position=60,40'],
});
const page = await (await browser.newContext({ viewport: null })).newPage();
await page.goto(process.argv[2] ?? 'http://localhost:5173/');
browser.on('disconnected', () => process.exit(0));
await new Promise(() => {});   // keep the window alive until it is closed
