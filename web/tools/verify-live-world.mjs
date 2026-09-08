import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const origin = process.argv[2] ?? 'http://localhost:5173';
const response = await fetch(`${origin}/api/matches?status=live`);
if (!response.ok) throw new Error(`Match API returned ${response.status}`);
const match = (await response.json()).matches?.[0];
if (!match) throw new Error('No live match is available; no match was created by this check.');
const browser = await chromium.launch({ headless: false, args: ['--window-size=1600,1000'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  await page.goto(`${origin}/matches/${match.id}`, { waitUntil: 'networkidle' });
  await page.locator('canvas[aria-label^="3D battlefield"]').waitFor();
  await page.getByText('Loading battlefield assets…', { exact: true }).waitFor({ state: 'hidden' });
  await page.waitForTimeout(1800);
  const frameTiming = await page.evaluate(async () => {
    const times = [];
    let previous = performance.now();
    for (let frame = 0; frame < 60; frame++) {
      const now = await new Promise(resolve => requestAnimationFrame(resolve));
      times.push(now - previous);
      previous = now;
    }
    times.sort((first, second) => first - second);
    return { medianFrameMs: times[30], p95FrameMs: times[57] };
  });
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/world-live.png' });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Full map', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/world-full-map.png' });
  if (await page.locator('.map-surface canvas').count() !== 1) throw new Error('Expected exactly one map canvas');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ url: page.url(), renderer: '3d', errors, ...frameTiming }, null, 2));
} finally {
  await browser.close();
}
