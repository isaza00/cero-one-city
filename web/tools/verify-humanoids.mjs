// Close-ups of the five humanoid machines (the chrome endoskeleton rig with
// its fittings) as the live renderer draws them, both factions, idle and
// walking, plus one group shot. Output: web/test-results/humanoids/*.png.
//
//   cd D:/Cero-One-City/web && node tools/verify-humanoids.mjs [--headed]
//
// Needs the Vite dev server on :5173. Nothing reaches the backend.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const output = 'test-results/humanoids';
await mkdir(output, { recursive: true });
const TYPES = ['worker', 'striker', 'launcher', 'anvil', 'colossus'];
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.routeWebSocket(() => true, () => {});
await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: {} }));
await page.route('**/humanoid-preview', route => route.fulfill({ contentType: 'text/html',
  body: '<!doctype html><html><body style="margin:0;background:#000"><div id="world"></div></body></html>' }));
try {
  await page.goto('http://localhost:5173/humanoid-preview');
  await page.evaluate(async ({ types }) => {
    const { WorldRenderer } = await import('/src/three/WorldRenderer.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const renderer = new WorldRenderer();
    await renderer.init(document.getElementById('world'), 1200, 800, true);
    renderer.setWorldSeed(4242);
    const size = 24;
    const tiles = Array.from({ length: size }, () => Array(size).fill('plain'));
    const entities = {};
    types.forEach((type, index) => {
      entities[index + 1] = { id: index + 1, owner: 0, kind: 'unit', type, x: 6 + index * 2.4, y: 10, hp: 50 };
      entities[index + 11] = { id: index + 11, owner: 1, kind: 'unit', type, x: 6 + index * 2.4, y: 13, hp: 50 };
    });
    const state = { size, tiles, entities, turn: 0, max_turns: 200, format: '1v1', veins: {}, pods: {}, scrap: {},
      finished: false, winner: null,
      players: [0, 1].map(id => ({ id, lineage: id ? 'swarm' : 'forge', explored: [], energy: 75, metal: 100,
        techs: [], firmware: 'v1', alive: true, eliminated_turn: null, damage_dealt: 0 })) };
    renderer.render(state, null);
    window.preview = { renderer, state, THREE, types };
  }, { types: TYPES });
  const look = async (id, distance, name, wait = 500, level = 0.55) => {
    await page.evaluate(({ id, distance, level }) => {
      const { renderer } = window.preview;
      const actor = renderer.actors.get(id);
      const top = actor.hp.position.y * level;
      renderer.controls.target.copy(actor.root.position).add({ x: 0, y: top, z: 0 });
      renderer.camera.position.copy(renderer.controls.target).add({ x: distance * 0.55, y: distance * 0.42, z: distance });
      renderer.controls.minDistance = 0.5;
      renderer.controls.update();
    }, { id, distance, level });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${output}/${name}.png` });
  };
  await page.evaluate(() => {
    const { renderer, state } = window.preview;
    renderer.controls.target.set(11, 0.7, 11.5);
    renderer.camera.position.set(11, 4.2, 18.5);
    renderer.controls.update();
    renderer.render(state, null);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}/00-group.png` });
  for (let index = 0; index < TYPES.length; index++) {
    const type = TYPES[index];
    await look(index + 1, type === 'colossus' ? 3.6 : type === 'anvil' ? 2.9 : 2.5, `${String(index + 1).padStart(2, '0')}-${type}`);
  }
  // Faction 1 striker from the other side, then a walk and a drill at work.
  await look(12, 2.5, '06-striker-p1');
  await look(2, 1.0, '08-head', 500, 0.86);
  await page.evaluate(() => {
    const { renderer, state } = window.preview;
    state.turn = 1;
    state.entities[2].y = 8; state.entities[1].y = 8;
    renderer.render({ ...state, events_last_turn: [{ type: 'gather', unit: 1 }] }, null);
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${output}/07-walking.png` });
  const info = await page.evaluate(() => {
    const { renderer } = window.preview;
    const walker = renderer.actors.get(2).unitModel.model;
    return { gait: walker.userData.gait, drawCalls: renderer.renderer.info.render.calls, triangles: renderer.renderer.info.render.triangles,
      rigged: [...renderer.actors.values()].map(actor => actor.unitModel?.model.userData.unitType + ':' + (actor.unitModel?.model.children[0]?.isGroup ? 'rig' : '?')) };
  });
  console.log(JSON.stringify(info));
} finally {
  await browser.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
process.exit(errors.length ? 1 : 0);
