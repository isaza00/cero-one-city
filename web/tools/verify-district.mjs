// Renders a real generated map (engine/tools/dump_map.py output) with the 3D
// renderer against a mocked API and writes screenshots + metrics under
// web/test-results/district/. No match is created.
//
//   wsl python engine/tools/dump_map.py 101 1v1 web/test-results/district-map.json
//   node tools/verify-district.mjs [--headed] [path/to/map.json]
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const headed = process.argv.includes('--headed');
const mapPath = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'test-results/district-map.json';
const dump = JSON.parse(await readFile(mapPath, 'utf8'));
const browser = await chromium.launch({ headless: !headed });
const output = 'test-results/district';
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.routeWebSocket(() => true, () => {});
await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: {} }));
await page.route('**/district-preview', route => route.fulfill({ contentType: 'text/html',
  body: '<!doctype html><html><body style="margin:0;background:#000"><div id="world"></div></body></html>' }));
try {
  await page.goto('http://localhost:5173/district-preview');
  const summary = await page.evaluate(async ({ seed, state }) => {
    const { WorldRenderer } = await import('/src/three/WorldRenderer.ts');
    const { classifyFeatures } = await import('/src/three/Features.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const renderer = new WorldRenderer();
    await renderer.init(document.getElementById('world'), 1600, 1000, true);
    renderer.setWorldSeed(seed);
    // A few units for scale next to the first house block: the engine state
    // already carries the crews, survivors and camp guards.
    const started = performance.now();
    renderer.render(state, null);
    const buildMs = performance.now() - started;
    const features = classifyFeatures(state.tiles, renderer.landscape.roads, renderer.landscape.seed);
    const counts = {};
    for (const feature of features) counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
    const house = features.find(f => f.kind === 'house' && f.tiles.length >= 12);
    const jam = features.find(f => f.kind === 'jam' && f.length >= 6);
    const grove = features.find(f => f.kind === 'grove' && f.tiles.length >= 8);
    const ruin = features.find(f => f.kind === 'ruin' && f.tiles.length >= 10);
    const rubble = features.find(f => f.kind === 'rubble' && f.tiles.length >= 8);
    const farm = features.find(f => f.kind === 'farm' && f.tiles.length >= 8);
    const crater = renderer.landscape.craters[0];
    window.preview = { renderer, state, THREE, features, house, jam, grove };
    return { buildMs: Math.round(buildMs), counts, roads: { rows: renderer.landscape.roads.rows, cols: renderer.landscape.roads.cols },
      house: house && [house.minX, house.minY, house.maxX, house.maxY],
      jam: jam && [jam.minX, jam.minY, jam.length, jam.lane.horizontal], grove: grove && [grove.minX, grove.minY],
      ruin: ruin && [(ruin.minX + ruin.maxX + 1) / 2, (ruin.minY + ruin.maxY + 1) / 2],
      rubble: rubble && [(rubble.minX + rubble.maxX + 1) / 2, (rubble.minY + rubble.maxY + 1) / 2],
      farm: farm && [(farm.minX + farm.maxX + 1) / 2, (farm.minY + farm.maxY + 1) / 2],
      crater: crater && [crater.x, crater.z, crater.radius], craters: renderer.landscape.craters.length };
  }, dump);
  const look = async (name, target, offset, wait = 600) => {
    await page.evaluate(({ target, offset }) => {
      const { renderer } = window.preview;
      renderer.controls.target.set(target[0], renderer.elevation(target[0], target[1]) + (target[2] ?? 0), target[1]);
      renderer.camera.position.copy(renderer.controls.target).add({ x: offset[0], y: offset[1], z: offset[2] });
      renderer.controls.minDistance = 1;
      renderer.controls.minPolarAngle = 0;
      renderer.controls.update();
    }, { target, offset });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${output}/${name}.png` });
  };
  await page.evaluate(() => window.preview.renderer.fitWorld());
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${output}/01-overview.png` });
  if (summary.house) {
    const [minX, minY, maxX, maxY] = summary.house;
    await look('02-neighbourhood', [(minX + maxX) / 2, (minY + maxY) / 2 + 3], [9, 7.5, 11]);
    await look('03-street-level', [(minX + maxX) / 2, maxY + 4, 0.8], [3.5, 1.6, 5]);
  }
  if (summary.jam) {
    const [x, y, length, horizontal] = summary.jam;
    await look('04-traffic-jam', horizontal ? [x + length / 2, y + 0.5] : [x + 0.5, y + length / 2], horizontal ? [0.5, 14, 9] : [9, 14, 0.5]);
  }
  const { rows, cols } = summary.roads;
  if (rows.length > 1 && cols.length > 1) {
    await look('08-crossing-topdown', [cols[1] + 0.5, rows[1] + 0.5], [0.01, 30, 0.01]);
  }
  if (summary.grove) await look('05-grove', [summary.grove[0] + 2, summary.grove[1] + 2], [7, 10, 9]);
  if (summary.ruin) await look('09-ruin', [summary.ruin[0], summary.ruin[1], 2], [9, 6, 11]);
  if (summary.rubble) await look('10-rubble-field', [summary.rubble[0], summary.rubble[1]], [3.5, 3, 4.5]);
  if (summary.farm) await look('11-farm', [summary.farm[0], summary.farm[1]], [6, 5, 8]);
  if (summary.crater) await look('12-crater', [summary.crater[0], summary.crater[1]], [7, 6, 9]);
  // The start crew: workers and a striker on the cleared ground, for scale.
  const crew = Object.values(dump.state.entities).find(e => e.type === 'striker');
  if (crew) await look('06-crew-scale', [crew.x + 0.5, crew.y + 0.5, 0.6], [4, 2.6, 5]);
  await look('07-quarter', [dump.state.size / 4, dump.state.size / 4], [26, 22, 30]);
  const metrics = await page.evaluate(() => {
    const { renderer } = window.preview;
    return { triangles: renderer.renderer.info.render.triangles, drawCalls: renderer.renderer.info.render.calls,
      chunks: renderer.chunks.size, resources: renderer.resources.length };
  });
  // Rubble cleared: only the touched chunk rebuilds.
  const rebuild = await page.evaluate(() => {
    const { renderer, state } = window.preview;
    const size = state.size;
    let tile = null;
    for (let y = 0; y < size && tile === null; y++) for (let x = 0; x < size; x++) if (state.tiles[y][x] === 'rubble') { tile = [x, y]; break; }
    if (!tile) return null;
    const before = new Set([...renderer.chunks.values()]);
    const next = { ...state, turn: state.turn + 1, tiles: state.tiles.map(row => row.slice()) };
    next.tiles[tile[1]][tile[0]] = 'plain';
    const started = performance.now();
    renderer.render(next, null);
    const ms = performance.now() - started;
    let rebuilt = 0;
    for (const group of renderer.chunks.values()) if (!before.has(group)) rebuilt++;
    return { tile, ms: Math.round(ms), rebuiltChunks: rebuilt, totalChunks: renderer.chunks.size };
  });
  const report = { ...summary, ...metrics, rebuild, errors };
  await writeFile(`${output}/metrics.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
if (errors.length) process.exit(1);
