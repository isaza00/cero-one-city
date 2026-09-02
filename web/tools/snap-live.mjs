import { chromium } from 'playwright';

const api = 'http://localhost:8000/api';

async function liveMatch(minTurn) {
  const since = Date.now() - 5 * 60 * 1000;
  for (let i = 0; i < 120; i++) {
    const r = await fetch(`${api}/matches?status=live`).then(r => r.json()).catch(() => null);
    const fresh = (r?.matches ?? [])
      .filter(m => m.turn >= minTurn && Date.parse(m.created_at) > since)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    if (fresh[0]) return fresh[0];
    await new Promise(res => setTimeout(res, 3000));
  }
  return null;
}

const m = await liveMatch(14);
if (!m) { console.error('no live match reached turn 14'); process.exit(1); }
console.log('match', m.id, 'turn', m.turn, m.players.map(p => `${p.name}(${p.lineage})`).join(' vs '));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(`http://localhost:5173/matches/${m.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);
await page.screenshot({ path: process.argv[2] ?? 'live-match.png', fullPage: false });
console.log('screenshot saved');
await browser.close();
