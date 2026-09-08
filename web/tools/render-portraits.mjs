// Renders the HUD portraits from the final 3D models: every unit, building and
// resource tile exactly as the live renderer draws it (same materials, lights,
// ground), framed from one fixed three-quarter view. Output goes to
// web/public/portraits/ as PNG files plus manifest.json.
//
//   cd D:/Cero-One-City/web && node tools/render-portraits.mjs [http://localhost:5173] [--headed]
//
// Needs the Vite dev server (it imports /src/three/WorldRenderer.ts through it).
// Nothing reaches the backend: every /api call and WebSocket is intercepted.

import { chromium } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.argv.find(argument => argument.startsWith('http')) ?? 'http://localhost:5173';
const output = new URL('../public/portraits/', import.meta.url);
const SIZE = 160;
const ARENA = 16;
const UNITS = ['worker', 'striker', 'launcher', 'rider', 'wasp', 'walking_tower', 'drone_swarm',
  'colossus', 'human', 'spark', 'anvil', 'watcher', 'leech', 'prism', 'survivor'];
const BUILDINGS = ['core', 'cocoon', 'rack', 'depot', 'assembler', 'lab', 'turret', 'wall', 'camp'];
const TILES = ['vein', 'pod', 'rubble', 'blocked'];
const TEAMS = [-1, 0, 1, 2, 3];

// Tiles first: a tile subject follows no dying actor, so no death transient
// can land in its frame.
const subjects = [];
for (const type of TILES) subjects.push({ kind: 'tile', type, owner: -1 });
for (const type of BUILDINGS) for (const owner of (type === 'camp' ? [-1] : TEAMS)) subjects.push({ kind: 'building', type, owner });
for (const type of UNITS) for (const owner of (type === 'survivor' ? [-1] : TEAMS)) subjects.push({ kind: 'unit', type, owner });

// JPEG: the frames are opaque (in-game ground) and a 160px PNG of textured
// ground weighs ~35 KB; the whole set must stay well under a megabyte.
const fileFor = subject => subject.kind === 'tile' ? `tile_${subject.type}.jpg`
  : `${subject.type}_${subject.owner >= 0 ? `p${subject.owner}` : 'n'}.jpg`;

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.routeWebSocket(() => true, () => {});
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: {} }));
  await page.route('**/portrait-studio', route => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html><body style="margin:0;background:#000"><div id="world" style="width:${SIZE}px;height:${SIZE}px"></div></body></html>` }));
  await page.goto(`${origin}/portrait-studio`);
  await page.evaluate(async ({ size }) => {
    const { WorldRenderer } = await import('/src/three/WorldRenderer.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const renderer = new WorldRenderer();
    await renderer.init(document.getElementById('world'), size, size, true);
    renderer.setWorldSeed(4242);
    window.studio = { renderer, THREE };
  }, { size: SIZE });

  const manifest = [];
  for (const subject of subjects) {
    const info = await page.evaluate(async ({ subject, arena }) => {
      const { renderer, THREE } = window.studio;
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const at = arena / 2 - 1;
      const tiles = Array.from({ length: arena }, () => Array(arena).fill('plain'));
      const entities = {};
      if (subject.kind === 'tile') tiles[at][at] = subject.type;
      else entities[1] = { id: 1, owner: subject.owner, kind: subject.kind, type: subject.type, x: at, y: at, hp: 9999,
        ...(subject.type === 'cocoon' ? { humans: 2 } : {}) };
      const state = { size: arena, tiles, entities, turn: 0, max_turns: 80, format: '1v1',
        veins: { [`${at},${at}`]: 300 }, pods: { [`${at},${at}`]: 200 }, scrap: {}, finished: false, winner: null,
        players: [0, 1, 2, 3].map(id => ({ id, lineage: 'forge', explored: [], energy: 0, metal: 0, techs: [],
          firmware: 'v1', alive: true, eliminated_turn: null, damage_dealt: 0 })) };
      renderer.render(state, null);
      await frame(); await frame();
      const actor = renderer.actors.get(1);
      const target = subject.kind === 'tile' ? (renderer.resources.find(entry => entry.feature.tiles.includes(at * arena + at))?.group ?? renderer.chunks.get(renderer.chunkOf(at * arena + at))) : actor?.visual;
      if (!target) return { missing: true };
      const box = new THREE.Box3().setFromObject(target, true);
      const center = box.getCenter(new THREE.Vector3());
      const extent = box.getSize(new THREE.Vector3());
      const radius = Math.max(extent.x, extent.y, extent.z) * 0.5;
      const fov = THREE.MathUtils.degToRad(renderer.camera.fov);
      const distance = radius / Math.sin(fov / 2) * 1.04 + 0.15;
      const direction = new THREE.Vector3(0.9, 0.6, 1.15).normalize();
      renderer.controls.minDistance = 0.05;
      renderer.controls.target.copy(center);
      renderer.camera.position.copy(center).addScaledVector(direction, distance);
      renderer.controls.update();
      await frame(); await frame(); await frame();
      return { extent: extent.toArray().map(value => Number(value.toFixed(2))),
        triangles: renderer.renderer.info.render.triangles, calls: renderer.renderer.info.render.calls };
    }, { subject, arena: ARENA });
    if (info.missing) { console.warn('no model for', subject); continue; }
    const file = fileFor(subject);
    await page.locator('canvas').screenshot({ path: fileURLToPath(new URL(file, output)), type: 'jpeg', quality: 88 });
    manifest.push({ file, ...subject, ...info });
    process.stdout.write(`${file}\n`);
  }
  await writeFile(new URL('manifest.json', output), JSON.stringify({
    version: 'portraits-v1', size: SIZE, arena: ARENA, seed: 4242, view: [0.9, 0.6, 1.15],
    generatedAt: new Date().toISOString(), count: manifest.length, subjects: manifest,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ portraits: manifest.length, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
