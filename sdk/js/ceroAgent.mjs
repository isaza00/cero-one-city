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

/** A tiny greedy baseline: eco up, build strikers, attack what it sees. */
function exampleBot(obs) {
  const orders = [];
  const res = obs.resources;
  const units = obs.units;
  const buildings = obs.buildings;
  const workers = units.filter((u) => u.type === "worker");
  const idle = workers.filter((u) => !u.standing_order);
  const cocoons = buildings.filter((b) => b.type === "cocoon" && !b.building_turns_left);
  const veins = obs.visible_map.notable_tiles.filter((t) => t.terrain === "vein");
  const enemies = obs.enemies_visible.filter((e) => e.id !== undefined);

  idle.forEach((w, i) => {
    if (i % 2 === 0 && cocoons.length) {
      const c = cocoons[Math.floor(i / 2) % cocoons.length];
      orders.push({ type: "gather", actor_id: w.id, target: [c.x, c.y] });
    } else if (veins.length) {
      const v = veins.reduce((best, t) =>
        Math.abs(t.x - w.x) + Math.abs(t.y - w.y) <
        Math.abs(best.x - w.x) + Math.abs(best.y - w.y) ? t : best);
      orders.push({ type: "gather", actor_id: w.id, target: [v.x, v.y] });
    }
  });

  const core = buildings.find((b) => b.type === "core" && !b.producing && !b.researching);
  if (core && workers.length < 7 && res.energy >= 25) {
    orders.push({ type: "produce", actor_id: core.id, unit: "worker" });
  }

  const assembler = buildings.find((b) => b.type === "assembler" && !b.building_turns_left);
  if (!assembler && res.metal >= 80 && workers.length) {
    const w = workers[0];
    orders.push({ type: "build", actor_id: w.id, building: "assembler",
                  anchor: [w.x + 1, w.y + 1] });
  } else if (assembler && !assembler.producing && res.energy >= 20 && res.metal >= 15) {
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
