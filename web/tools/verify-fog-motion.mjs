// Fog, walking and dying on a real generated map (engine/tools/dump_map.py
// output), rendered against a mocked API. Screenshots + metrics land under
// web/test-results/fog-motion/. No match is created.
//
//   wsl python engine/tools/dump_map.py 101 1v1 web/test-results/district-map.json
//   node tools/verify-fog-motion.mjs [--headed] [path/to/map.json]
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const headed = process.argv.includes('--headed');
const mapPath = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'test-results/district-map.json';
const dump = JSON.parse(await readFile(mapPath, 'utf8'));
const browser = await chromium.launch({ headless: !headed });
const output = 'test-results/fog-motion';
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.routeWebSocket(() => true, () => {});
await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: {} }));
await page.route('**/fog-preview', route => route.fulfill({ contentType: 'text/html',
  body: '<!doctype html><html><body style="margin:0;background:#000"><div id="world"></div></body></html>' }));
const timeline = [];
const shot = async (name, wait = 0) => {
  if (wait) await page.waitForTimeout(wait);
  const mark = await page.evaluate(() => {
    const { renderer, walkId, corpse } = window.preview;
    const walker = walkId !== undefined ? renderer.actors.get(walkId) : null;
    return { now: Math.round(performance.now()), walker: walker && walker.root.position.toArray().map(v => +v.toFixed(2)),
      corpseY: corpse && +corpse.position.y.toFixed(2), corpseTilt: corpse && [corpse.children[0].rotation.x, corpse.children[0].rotation.z].map(v => +v.toFixed(2)) };
  });
  timeline.push({ shot: name, ...mark });
  await page.screenshot({ path: `${output}/${name}.png` });
};
const look = async (target, offset) => page.evaluate(({ target, offset }) => {
  const { renderer } = window.preview;
  renderer.controls.target.set(target[0], renderer.elevation(target[0], target[1]) + (target[2] ?? 0), target[1]);
  renderer.camera.position.copy(renderer.controls.target).add({ x: offset[0], y: offset[1], z: offset[2] });
  renderer.controls.minDistance = 1;
  renderer.controls.minPolarAngle = 0;
  renderer.controls.update();
}, { target, offset });
try {
  await page.goto('http://localhost:5173/fog-preview');
  const setup = await page.evaluate(async ({ seed, state }) => {
    const { WorldRenderer } = await import('/src/three/WorldRenderer.ts');
    const renderer = new WorldRenderer();
    await renderer.init(document.getElementById('world'), 1600, 1000, true);
    renderer.setWorldSeed(seed);
    const size = state.size;
    const mine = Object.values(state.entities).filter(e => e.owner === 0);
    const anchor = mine.find(e => e.type === 'core') ?? mine[0];
    // Memory: the player has walked a patch around the start (the dump is turn
    // 0, before any fog update), so the dim explored ring shows around the light.
    const explored = [];
    for (let y = Math.max(0, anchor.y - 16); y <= Math.min(size - 1, anchor.y + 16); y++) {
      for (let x = Math.max(0, anchor.x - 16); x <= Math.min(size - 1, anchor.x + 16); x++) {
        if (Math.hypot(x - anchor.x, y - anchor.y) < 16) explored.push(y * size + x);
      }
    }
    state.players[0].explored = explored;
    renderer.render(state, 0);
    // A walker and a wall to walk round: the nearest solid tile cluster to a
    // worker, and a destination mirrored across it.
    const blocked = (x, y) => x < 0 || y < 0 || x >= size || y >= size || state.tiles[y][x] !== 'plain';
    let walk = null;
    for (const unit of mine.filter(e => e.kind === 'unit' && !['wasp', 'watcher', 'drone_swarm'].includes(e.type))) {
      for (let radius = 2; radius <= 12 && !walk; radius++) {
        for (let dy = -radius; dy <= radius && !walk; dy++) {
          for (let dx = -radius; dx <= radius && !walk; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius || !blocked(unit.x + dx, unit.y + dy)) continue;
            // Cluster centre-ish: step further in the same direction while solid.
            let cx = unit.x + dx, cy = unit.y + dy, steps = 0;
            while (blocked(cx + Math.sign(dx), cy + Math.sign(dy)) && steps++ < 6) { cx += Math.sign(dx); cy += Math.sign(dy); }
            const tx = cx + Math.sign(dx) * 2, ty = cy + Math.sign(dy) * 2;
            if (blocked(tx, ty) || Object.values(state.entities).some(e => e.x === tx && e.y === ty)) continue;
            walk = { id: unit.id, from: [unit.x, unit.y], to: [tx, ty], wall: [cx, cy] };
          }
        }
      }
      if (walk) break;
    }
    const victim = mine.find(e => e.kind === 'unit' && e.type !== 'worker') ?? mine.find(e => e.kind === 'unit');
    window.preview = { renderer, state, walk, victim };
    return { anchor: [anchor.x, anchor.y], walk, victim: victim && [victim.id, victim.type, victim.x, victim.y], size };
  }, dump);
  const [ax, ay] = setup.anchor;
  await look([ax + 1, ay + 1], [0.01, 46, 0.01]);
  await shot('01-fog-topdown', 900);
  await look([ax + 1, ay + 4], [10, 9, 12]);
  await shot('02-fog-oblique', 500);
  const cadenceMs = 2200;
  let walkReport = null;
  if (setup.walk) {
    const { from, to, wall } = setup.walk;
    await look([(from[0] + to[0]) / 2 + 0.5, (from[1] + to[1]) / 2 + 0.5], [0.01, 13, 0.01]);
    await page.waitForTimeout(cadenceMs);
    walkReport = await page.evaluate(({ id, to }) => {
      const { renderer, state } = window.preview;
      window.preview.walkId = id;
      const next = { ...state, turn: state.turn + 1, entities: { ...state.entities } };
      next.entities[id] = { ...state.entities[id], x: to[0], y: to[1] };
      window.preview.state = next;
      renderer.render(next, 0);
      const actor = renderer.actors.get(id);
      const size = state.size;
      const crosses = actor.path.filter(p => state.tiles[Math.floor(p.z)]?.[Math.floor(p.x)] !== 'plain').length;
      // Sample the polyline densely: no sample may sit on a solid tile.
      let samples = 0, solid = 0;
      for (let i = 1; i < actor.path.length; i++) {
        const a = actor.path[i - 1], b = actor.path[i];
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          samples++;
          if (state.tiles[Math.floor(z)]?.[Math.floor(x)] !== 'plain') solid++;
        }
      }
      return { waypoints: actor.path.length, length: Math.round(actor.cumulative.at(-1) * 100) / 100,
        straight: Math.round(Math.hypot(actor.target.x - actor.from.x, actor.target.z - actor.from.z) * 100) / 100,
        waypointsOnSolid: crosses, samples, samplesOnSolid: solid, durationMs: actor.duration, size };
    }, setup.walk);
    await shot('03-walk-around-a', cadenceMs * 0.3);
    await shot('03-walk-around-b', cadenceMs * 0.3);
    await shot('03-walk-around-c', cadenceMs * 0.45);
    void wall;
  }
  let deathReport = null;
  if (setup.victim) {
    const [id, , x, y] = setup.victim;
    await look([x + 0.5, y + 0.5, 0.5], [2.6, 2.2, 3.4]);
    await page.waitForTimeout(400);
    await shot('04-death-0-alive');
    deathReport = await page.evaluate(id => {
      const { renderer, state } = window.preview;
      const next = { ...state, turn: state.turn + 1, entities: { ...state.entities } };
      const root = renderer.actors.get(id).root;
      delete next.entities[id];
      window.preview.state = next;
      window.preview.corpse = root;
      renderer.render(next, 0);
      return { transient: renderer.transient.some(t => t.object === root), stillInScene: root.parent === renderer.scene };
    }, id);
    await shot('04-death-1-falling', 120);
    await shot('04-death-2-down', 800);
    const lying = await page.evaluate(() => {
      const { corpse } = window.preview;
      return { rotationX: Math.round(corpse.children[0].rotation.x * 100) / 100, y: Math.round(corpse.position.y * 100) / 100 };
    });
    await shot('04-death-3-sinking', 1500);
    await shot('04-death-4-gone', 1200);
    const gone = await page.evaluate(() => {
      const { corpse, renderer } = window.preview;
      return corpse.parent !== renderer.scene && !renderer.transient.some(t => t.object === corpse);
    });
    deathReport = { ...deathReport, lying, gone };
  }
  const fog = await page.evaluate(() => {
    const { renderer, state } = window.preview;
    const mine = Object.values(state.entities).filter(e => e.owner === 0 && e.kind === 'unit');
    const unit = mine[0];
    const { UNIT_VISION } = { UNIT_VISION: { worker: 5, striker: 5 } };
    const radius = UNIT_VISION[unit.type] ?? 5;
    const at = (dx, dz) => renderer.fog.sample(renderer.renderer, unit.x + 0.5 + dx, unit.y + 0.5 + dz);
    return { unit: [unit.type, unit.x, unit.y], centre: at(0, 0), edgeAxis: at(radius + 0.4, 0),
      corner: at((radius + 0.4) * 0.71, (radius + 0.4) * 0.71), diagonalPastRadius: at(radius, radius),
      far: at(radius + 4, radius + 4), eyes: renderer.fog.eyes.length, owned: Object.values(state.entities).filter(e => e.owner === 0).length };
  });
  const report = { ...setup, walk: walkReport, death: deathReport, fog, timeline, errors };
  await writeFile(`${output}/metrics.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
if (errors.length) process.exit(1);
