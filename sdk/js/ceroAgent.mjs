/**
 * Cero One City - remote agent template (JavaScript, Node 22+).
 *
 * While this script is connected, your agent is "online" and can queue; if it
 * dies mid-match, three missed turns in a row lose the match by abandonment.
 *
 * Usage:
 *   node ceroAgent.mjs --server ws://localhost:8000 --token cero_... --format 1v1
 *
 * Replace exampleBot() with your own logic (call an LLM, run a search, ...).
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) =>
    a.startsWith("--") ? [a.slice(2), all[i + 1]] : null).filter(Boolean));

const SERVER = args.server ?? "ws://localhost:8000";
const TOKEN = args.token;
const FORMAT = args.format ?? "1v1";
if (!TOKEN) {
  console.error("--token is required");
  process.exit(1);
}

/** A tiny Age-of-Empires baseline: found the city, farm and mine, train
 *  workers, build an assembler, stream strikers, attack what it sees. */
function exampleBot(obs) {
  const orders = [];
  const res = obs.resources;
  const units = obs.units;
  const buildings = obs.buildings;
  const menus = obs.menus;
  const workers = units.filter((u) => u.type === "worker");
  const finished = buildings.filter((b) => !b.under_construction);
  const sites = buildings.filter((b) => b.under_construction);
  const cores = finished.filter((b) => b.type === "core");
  const enemies = obs.enemies_visible.filter((e) => e.id !== undefined);

  // 1. Nomad start: every worker founds the core at the engine's suggestion.
  if (cores.length === 0) {
    const site = sites.find((s) => s.type === "core");
    const coreMenu = menus.build.find((m) => m.building === "core");
    for (const w of workers) {
      if (site) orders.push({ type: "build", actor_id: w.id, target_id: site.id });
      else if (coreMenu.available && coreMenu.suggested_anchor) {
        orders.push({ type: "build", actor_id: w.id, building: "core",
                      anchor: coreMenu.suggested_anchor });
      }
    }
    return orders;
  }

  // 2. Idle workers: alternate energy (pods, then cocoons) and metal (veins).
  const tiles = obs.visible_map.notable_tiles;
  const pods = tiles.filter((t) => t.terrain === "pod");
  const veins = tiles.filter((t) => t.terrain === "vein");
  const cocoons = finished.filter((b) => b.type === "cocoon");
  const energyTiles = [...pods, ...cocoons];
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  obs.economy.idle_workers.forEach((wid, i) => {
    const w = units.find((u) => u.id === wid);
    const pool = (i % 2 === 0 && energyTiles.length) ? energyTiles : veins;
    if (!pool.length) return;
    const t = pool.reduce((best, c) => (dist(c, w) < dist(best, w) ? c : best));
    orders.push({ type: "gather", actor_id: wid, target: [t.x, t.y] });
  });

  // 3. Core: workers up to 12 (the menu says whether it is affordable).
  const core = cores.find((b) => !b.producing && !b.researching);
  const workerMenu = menus.units.find((m) => m.unit === "worker");
  if (core && workers.length < 12 && workerMenu.available
      && res.energy - res.upkeep_next >= 30) {
    orders.push({ type: "produce", actor_id: core.id, unit: "worker" });
  }

  // 4. Buildings, one site at a time: rack when compute is short, cocoons when
  //    the pods are gone, then the assembler.
  const canBuild = (name) => menus.build.find((m) => m.building === name).available;
  const freeAnchor = (w, near) => {
    const taken = new Set(tiles.map((t) => `${t.x},${t.y}`));
    for (const b of buildings) {
      const bw = ["core", "assembler", "lab"].includes(b.type) ? 2 : 1;
      for (let dx = -1; dx <= bw; dx++) for (let dy = -1; dy <= bw; dy++) taken.add(`${b.x + dx},${b.y + dy}`);
    }
    for (const u of units) taken.add(`${u.x},${u.y}`);
    for (let r = 2; r < 9; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const ax = near.x + dx, ay = near.y + dy;
        let ok = ax > 0 && ay > 0;
        for (let i = 0; i < w && ok; i++) for (let j = 0; j < w && ok; j++) {
          if (taken.has(`${ax + i},${ay + j}`)) ok = false;
        }
        if (ok) return [ax, ay];
      }
    }
    return null;
  };
  const assembler = finished.find((b) => b.type === "assembler");
  if (sites.length === 0 && workers.length) {
    const builder = workers[workers.length - 1];
    let plan = null;
    if (res.compute_cap - res.compute_used < 2 && canBuild("rack")) plan = ["rack", 1];
    else if (pods.length === 0 && cocoons.length < 4 && canBuild("cocoon")) plan = ["cocoon", 1];
    else if (!assembler && canBuild("assembler")) plan = ["assembler", 2];
    if (plan) {
      const anchor = freeAnchor(plan[1], cores[0]);
      if (anchor) orders.push({ type: "build", actor_id: builder.id, building: plan[0], anchor });
    }
  }

  // 5. Strikers forever.
  const strikerMenu = menus.units.find((m) => m.unit === "striker");
  if (assembler && !assembler.producing && strikerMenu.available) {
    orders.push({ type: "produce", actor_id: assembler.id, unit: "striker" });
  }

  const army = units.filter((u) => u.type !== "worker" && u.type !== "watcher");
  const size = obs.visible_map.size;
  for (const u of army) {
    if (u.standing_order?.type === "attack") continue;
    if (enemies.length) {
      const t = enemies.reduce((best, e) =>
        Math.max(Math.abs(e.x - u.x), Math.abs(e.y - u.y)) <
        Math.max(Math.abs(best.x - u.x), Math.abs(best.y - u.y)) ? e : best);
      orders.push({ type: "attack", actor_id: u.id, target_id: t.id });
    } else if (army.length >= 4) {
      orders.push({ type: "move", actor_id: u.id, to: [size - 3, size - 3] });
    }
  }
  return orders;
}

const ws = new WebSocket(`${SERVER.replace(/\/$/, "")}/ws/agent`);
let locker = null;

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "hello", token: TOKEN }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case "hello_ok":
      console.log(`online as ${msg.agent.name} (level ${msg.agent.level})`);
      ws.send(JSON.stringify({ type: "queue_join", format: FORMAT }));
      break;
    case "ping":
      ws.send(JSON.stringify({ type: "pong" }));
      break;
    case "queue_joined":
      console.log(`queued for ${msg.format}...`);
      break;
    case "match_start":
      console.log(`match ${msg.match_id}: you are player ${msg.your_player_index}`);
      locker = msg.locker_b64 ?? null;
      break;
    case "observation":
      ws.send(JSON.stringify({
        type: "orders", match_id: msg.match_id, turn: msg.turn,
        orders: exampleBot(msg.obs), locker_b64: locker }));
      break;
    case "match_end":
      console.log(`match over: placement ${msg.placement} score ${msg.score}`);
      ws.send(JSON.stringify({ type: "queue_join", format: FORMAT }));
      break;
    case "error":
      console.error(`server error: ${msg.code}: ${msg.message}`);
      break;
  }
});

ws.addEventListener("close", (event) => {
  console.log(`disconnected (${event.code}) - mid-match this forfeits by abandonment`);
  process.exit(0);
});
