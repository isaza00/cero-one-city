import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const output = 'test-results/apocalypse';
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.routeWebSocket(() => true, () => {});
await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: {} }));
await page.route('**/apocalypse-preview', route => route.fulfill({ contentType: 'text/html',
  body: '<!doctype html><html><body style="margin:0;background:#000"><div id="world"></div></body></html>' }));
try {
  await page.goto('http://localhost:5173/apocalypse-preview');
  await page.evaluate(async () => {
    const { WorldRenderer } = await import('/src/three/WorldRenderer.ts');
    const renderer = new WorldRenderer();
    await renderer.init(document.getElementById('world'), 1600, 1000, true);
    renderer.setWorldSeed(48793);
    const size = 48;
    const tiles = Array.from({ length: size }, () => Array(size).fill('plain'));
    for (let row = 8; row < 17; row++) for (let column = 11; column < 18; column++) {
      if ((column * 7 + row * 3) % 6 < 3) tiles[row][column] = 'blocked';
    }
    for (let row = 29; row < 40; row++) for (let column = 30; column < 39; column++) {
      if ((column + row * 7) % 7 < 4) tiles[row][column] = 'blocked';
    }
    tiles[21][15] = 'pod'; tiles[22][15] = 'pod'; tiles[23][10] = 'vein'; tiles[22][10] = 'rubble';
    const roster = ['worker', 'striker', 'launcher', 'rider', 'wasp', 'walking_tower', 'drone_swarm',
      'colossus', 'human', 'spark', 'anvil', 'watcher', 'leech', 'prism', 'survivor'];
    const entities = Object.fromEntries(roster.map((type, index) => [index + 1, {
      id: index + 1, owner: type === 'survivor' ? -1 : index % 2, kind: 'unit', type,
      x: 18 + index % 5 * 3, y: 18 + Math.floor(index / 5) * 3, hp: type === 'colossus' ? 150 : 20,
    }]));
    entities[40] = { id: 40, owner: 0, kind: 'building', type: 'core', x: 8, y: 18, hp: 450 };
    entities[41] = { id: 41, owner: 0, kind: 'building', type: 'assembler', x: 8, y: 15, hp: 100 };
    entities[42] = { id: 42, owner: 0, kind: 'building', type: 'cocoon', x: 11, y: 18, hp: 30, humans: 2 };
    const state = { size, tiles, entities, turn: 0, max_turns: 200, format: '1v1',
      veins: { '10,23': 200 }, pods: { '15,21': 200, '15,22': 200 }, scrap: {}, finished: false, winner: null,
      players: [0, 1].map(id => ({ id, lineage: id ? 'swarm' : 'forge', explored: [], energy: 75, metal: 100,
        techs: [], firmware: 'v1', alive: true, eliminated_turn: null, damage_dealt: 0 })) };
    renderer.render(state, null);
    renderer.controls.target.set(22, renderer.elevation(22, 21), 21);
    renderer.camera.position.copy(renderer.controls.target).add(new (await import('/node_modules/three/build/three.module.js')).Vector3(15, 14, 20));
    renderer.controls.update();
    window.preview = { renderer, state };
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${output}/01-district.png` });
  await page.evaluate(() => {
    const { renderer } = window.preview;
    const target = renderer.actors.get(2).root.position;
    renderer.controls.target.copy(target).add({ x: 0, y: 0.65, z: 0 });
    renderer.camera.position.copy(renderer.controls.target).add({ x: 1.8, y: 1.0, z: 3.4 });
    renderer.controls.minDistance = 2;
    renderer.controls.update();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/02-endoskeleton.png` });
  const metrics = await page.evaluate(async () => {
    const { renderer, state } = window.preview;
    renderer.fitWorld();
    await new Promise(resolve => setTimeout(resolve, 200));
    return { triangles: renderer.renderer.info.render.triangles, drawCalls: renderer.renderer.info.render.calls,
      roster: [...renderer.actors.values()].filter(actor => actor.unitModel).map(actor => actor.unitModel.model.userData.unitType),
      worldSize: renderer.landscape.worldSize, sector: renderer.landscape.origin.toArray(),
      outsideBlack: renderer.scene.background.getHex() === 0, units: Object.keys(state.entities).length };
  });
  await page.screenshot({ path: `${output}/03-sector.png` });
  await page.evaluate(() => {
    const { renderer, state } = window.preview;
    renderer.render({ ...state, turn: 1, events_last_turn: [{ type: 'attack', attacker: 3, target: 1,
      src: [24, 18], dst: [18, 18], ranged: true, attacker_type: 'launcher' }] }, null);
    renderer.controls.target.set(22, renderer.elevation(22, 18), 18);
    renderer.camera.position.copy(renderer.controls.target).add({ x: 7, y: 6, z: 10 });
    renderer.controls.update();
  });
  await page.waitForTimeout(90);
  await page.screenshot({ path: `${output}/04-combat.png` });
  await writeFile(`${output}/metrics.json`, JSON.stringify({ ...metrics, errors }, null, 2));
  console.log(JSON.stringify({ ...metrics, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  if (process.argv.includes('--keep-open')) await new Promise(() => {});
} finally { await browser.close(); }
