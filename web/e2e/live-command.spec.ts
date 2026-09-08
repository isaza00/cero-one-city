// Live command post (/matches/:id) against a mocked backend: the spectator
// WebSocket (snapshot and turn frames) and every /api/** call are intercepted,
// so no match, queue, account or model is touched. The map runs the classic 2D
// renderer (?renderer=2d) so these checks stay independent of the 3D world
// assets being reworked in parallel; one smoke test leaves the default.

import { expect, test, type Page, type Route, type WebSocketRoute } from "@playwright/test";
import fs from "fs";

const SHOTS = "test-results/fable-02";
const MATCH = "m-cmd-1";
const SIZE = 32;

type Json = Record<string, unknown>;
interface Call { method: string; path: string; body: unknown }

const OWNER = {
  id: "u-owner", email: "owner@example.test", display_name: "Owner", role: "player", practice_remaining: 2,
};
const NAMES = ["pixelfist", "ironjaw", "oracle-9", "photon-3"];
const LINEAGES = ["forge", "swarm", "oracle", "photon"];
const ALL_TILES = Array.from({ length: SIZE * SIZE }, (_, i) => i);

function tiles(): string[][] {
  const t = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill("plain"));
  for (const [x, y] of [[14, 10], [15, 10], [14, 11]]) t[y][x] = "pod";
  for (const [x, y] of [[6, 12], [7, 12], [24, 20]]) t[y][x] = "vein";
  t[20][20] = "rubble";
  for (let x = 5; x < 12; x++) t[16][x] = "blocked";
  return t;
}

function player(id: number, lineage: string, over: Json = {}): Json {
  return { id, lineage, energy: 75, metal: 100, techs: [], firmware: "v1", alive: true, founded: false,
           eliminated_turn: null, damage_dealt: 0, explored: ALL_TILES, ...over };
}

let nextId = 1;
function ent(owner: number, kind: "unit" | "building", type: string, x: number, y: number,
             hp: number, over: Json = {}): Json {
  return { id: nextId++, owner, kind, type, x, y, hp, ...over };
}
function byId(list: Json[]): Record<string, Json> {
  const m: Record<string, Json> = {};
  for (const e of list) m[String(e.id)] = e;
  return m;
}
function baseState(over: Json): Json {
  return {
    turn: 0, format: "1v1", size: SIZE, max_turns: 80, tiles: tiles(),
    veins: { "6,12": 300, "7,12": 300, "24,20": 300 },
    pods: { "14,10": 200, "15,10": 200, "14,11": 200 }, scrap: {},
    finished: false, winner: null, ...over,
  };
}

/** Turn 0: every crew is nomad (4 workers + 1 striker), plus wild neutrals. */
function nomadState(playerCount: number): Json {
  nextId = 1;
  const list: Json[] = [];
  const starts = [[4, 4], [26, 26], [26, 4], [4, 26]];
  const players: Json[] = [];
  for (let p = 0; p < playerCount; p++) {
    const [sx, sy] = starts[p];
    players.push(player(p, LINEAGES[p]));
    for (let i = 0; i < 4; i++) list.push(ent(p, "unit", "worker", sx + i, sy, 20));
    list.push(ent(p, "unit", "striker", sx + 1, sy + 1, 30));
  }
  list.push(ent(-1, "unit", "survivor", 9, 9, 10));
  list.push(ent(-1, "building", "camp", 16, 24, 60));
  for (let i = 0; i < 3; i++) list.push(ent(-1, "unit", "human", 15 + i, 25, 15));
  return baseState({ format: playerCount === 2 ? "1v1" : `ffa${playerCount}`, players, entities: byId(list) });
}

/** Turn 12: two founded cities, a lab under construction, cargo, humans. */
function cityState(): { state: Json; ids: Record<string, number> } {
  nextId = 1;
  const ids: Record<string, number> = {};
  const list: Json[] = [];
  const add = (key: string, e: Json) => { ids[key] = e.id as number; list.push(e); };
  add("core0", ent(0, "building", "core", 6, 6, 450, { rally: [9, 9] }));
  add("cocoon0", ent(0, "building", "cocoon", 9, 6, 30, { humans: 1 }));
  add("rack0", ent(0, "building", "rack", 10, 6, 40));
  add("assembler0", ent(0, "building", "assembler", 6, 10, 100));
  add("labSite0", ent(0, "building", "lab", 10, 10, 8, { build_progress: 2, build_total: 4 }));
  add("hauler", ent(0, "unit", "worker", 7, 9, 20,
    { cargo_m: 12, standing_order: { type: "gather", phase: "return", target: [6, 12] } }));
  add("builder1", ent(0, "unit", "worker", 9, 10, 20, { standing_order: { type: "build", target_id: ids.labSite0 } }));
  add("builder2", ent(0, "unit", "worker", 12, 10, 20, { standing_order: { type: "build", target_id: ids.labSite0 } }));
  add("idler", ent(0, "unit", "worker", 5, 9, 20));
  add("striker0", ent(0, "unit", "striker", 8, 12, 30));
  add("recruit", ent(0, "unit", "human", 12, 12, 15));
  add("core1", ent(1, "building", "core", 24, 24, 450));
  add("assembler1", ent(1, "building", "assembler", 20, 24, 100));
  add("carrier", ent(1, "unit", "worker", 23, 22, 20,
    { cargo_h: 1, standing_order: { type: "gather", phase: "deliver", target: [25, 22] } }));
  add("worker1b", ent(1, "unit", "worker", 22, 23, 20));
  add("launcher1", ent(1, "unit", "launcher", 21, 21, 25));
  add("rider1", ent(1, "unit", "rider", 22, 20, 55));
  add("survivor", ent(-1, "unit", "survivor", 14, 3, 10));
  add("camp", ent(-1, "building", "camp", 20, 4, 60));
  add("guard1", ent(-1, "unit", "human", 21, 4, 15));
  add("guard2", ent(-1, "unit", "human", 20, 5, 15));
  const players = [
    player(0, "forge", { energy: 140, metal: 62, founded: true, damage_dealt: 30 }),
    player(1, "swarm", { energy: 210, metal: 175, founded: true, firmware: "v2",
                         techs: ["firmware_v2", "armor_1"], damage_dealt: 12 }),
  ];
  return { ids, state: baseState({ turn: 12, players, entities: byId(list), scrap: { "18,18": { e: 0, m: 40 } } }) };
}

function seats(n: number, modes: string[] = []): Json[] {
  return Array.from({ length: n }, (_, i) => ({
    player_index: i, agent_id: `a-${i + 1}`, name: NAMES[i], lineage: LINEAGES[i], level: 3,
    is_house: false, kind: "hosted", status: "alive", placement: null, score: null, elo_delta: null,
    control_mode: modes[i] ?? "autonomous",
  }));
}

function agentFixture(id: string, name: string): Json {
  return { id, name, lineage: "forge", kind: "hosted", level: 3, xp: 120, title: null, avatar_variant: 0,
           is_house: false, house_tier: null, model_declared: "mock/boom",
           elo_by_format: { "1v1": 1040, ffa: 985 }, interventions_count: 0, created_at: "2026-09-01T00:00:00Z" };
}

const scoreboardFor = (players: Json[], scores: number[]) => players.map((p, i) => ({
  player_index: i, agent_id: p.agent_id, name: p.name, score: scores[i] ?? 0, alive: true,
}));

/** The whole backend of one live match, in memory. */
class Arena {
  state: Json;
  players: Json[];
  turn: number;
  feed: Json[] = [];
  highlights: Json[] = [];
  scoreboard: Json[] = [];
  ownerAgents: Json[] = [];
  shouts: Json[] = [];
  finished = false;
  calls: Call[] = [];
  unmocked: string[] = [];
  ws: WebSocketRoute | null = null;

  constructor(state: Json, players: Json[]) {
    this.state = state;
    this.players = players;
    this.turn = state.turn as number;
  }

  match(): Json {
    return { id: MATCH, format: this.state.format, status: this.finished ? "finished" : "live",
             turn: this.turn, max_turns: 80, is_ranked: true, summary: null, map_seed: 4242, map_size: SIZE,
             started_at: new Date(Date.now() - 95_000).toISOString() };
  }

  async install(page: Page) {
    await page.routeWebSocket(/\/ws\/matches\//, (ws) => {
      this.ws = ws;
      ws.send(JSON.stringify({ type: "snapshot", match: this.match(), players: this.players,
                               turn_number: this.turn, state: this.state, feed_recent: this.feed,
                               highlights: this.highlights }));
    });
    await page.route((url) => url.pathname.startsWith("/api/"), (route) => this.handle(route));
  }

  resolveTurn(turn: number, state: Json, feed: Json[], scores: number[]) {
    this.turn = turn;
    this.state = state;
    this.scoreboard = scoreboardFor(this.players, scores);
    this.feed = [...this.feed, ...feed.map((f) => ({ ...f, turn }))];
    this.ws?.send(JSON.stringify({ type: "turn_resolved", turn_number: turn, state, events: [],
                                   scoreboard: this.scoreboard, feed }));
  }

  end() {
    this.finished = true;
    this.ws?.send(JSON.stringify({ type: "match_end" }));
  }

  private mode(agentId: string): string {
    return (this.players.find((p) => p.agent_id === agentId)?.control_mode as string) ?? "copilot";
  }

  private handle(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    this.calls.push({ method, path, body });

    if (method === "GET" && path === `/api/matches/${MATCH}`) {
      return route.fulfill({ json: { match: this.match(), players: this.players } });
    }
    const turn = path.match(new RegExp(`^/api/matches/${MATCH}/turns/(\\d+)$`));
    if (method === "GET" && turn) {
      return route.fulfill({ json: { turn_number: Number(turn[1]), state: this.state, feed: [] } });
    }
    if (method === "GET" && path === "/api/agents") return route.fulfill({ json: { agents: this.ownerAgents } });
    if (method === "GET" && path === "/api/auth/me") return route.fulfill({ json: OWNER });
    if (method === "GET" && path === `/api/matches/${MATCH}/shouts`) {
      const agentId = url.searchParams.get("agent_id") ?? "";
      return route.fulfill({ json: { shouts: this.shouts, mode: this.mode(agentId), limit: 20 } });
    }
    if (method === "POST" && path === `/api/matches/${MATCH}/shout`) {
      const b = body as { agent_id: string; text: string };
      this.shouts.push({ text: b.text, created_turn: this.turn, delivered_turn: null, reply_text: null, reply_turn: null });
      return route.fulfill({ json: { shout: { text: b.text, created_turn: this.turn, match_used: this.shouts.length,
                                              match_limit: 20, mode: this.mode(b.agent_id), season_used: 1 } } });
    }
    this.unmocked.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { detail: { code: "not_mocked", message: `${method} ${path}` } } });
  }
}

async function signIn(page: Page) {
  await page.addInitScript((value) => localStorage.setItem("cero-auth", value), JSON.stringify({
    state: { accessToken: "pw-access", refreshToken: "pw-refresh", user: OWNER }, version: 0 }));
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function open(page: Page, renderer: "2d" | "default" = "2d") {
  await page.goto(`/matches/${MATCH}${renderer === "2d" ? "?renderer=2d" : ""}`);
  await expect(page.locator(".cmd-faction").first()).toBeVisible();
}

const selection = (page: Page) => page.locator(".cmd-sel");
const cities = (page: Page) => page.locator(".cmd-city");
const menu = (page: Page) => page.locator(".cmd-sel .cmd-menu");

async function overflowMetrics(page: Page) {
  return page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const map = rect(".match-map");
    const top = rect(".cmd-top");
    const bottom = rect(".cmd-bottom");
    const panel = document.querySelector(".cmd-panel") as HTMLElement | null;
    return {
      docScroll: document.documentElement.scrollWidth, win: window.innerWidth,
      docScrollH: document.documentElement.scrollHeight, winH: window.innerHeight,
      mapH: map?.height ?? 0, mapW: map?.width ?? 0,
      uncovered: map && top && bottom ? map.height - top.height - bottom.height : 0,
      panelOverflow: panel ? getComputedStyle(panel).overflowY : "",
      panelH: panel?.clientHeight ?? 0,
    };
  });
}

test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("nomad start: two crews, no buildings, real numbers on the top bar", async ({ page }) => {
  const arena = new Arena(nomadState(2), seats(2, ["copilot", "autonomous"]));
  arena.ownerAgents = [agentFixture("a-1", "pixelfist")];
  await arena.install(page);
  await signIn(page);
  const errors = trackErrors(page);
  await open(page);

  const p0 = page.locator(".cmd-faction").nth(0);
  await expect(p0).toContainText("pixelfist");
  await expect(p0.locator(".cmd-tag.you")).toBeVisible();
  await expect(p0.locator(".cmd-stat.energy")).toHaveText("75");
  await expect(p0.locator(".cmd-stat.metal")).toHaveText("100");
  await expect(p0.locator(".cmd-stat").nth(2)).toHaveText("5");    // robots
  await expect(p0.locator(".cmd-stat").nth(3)).toHaveText("0");    // buildings
  await expect(p0.locator(".cmd-chip-tech.fw")).toContainText("FW v1");
  await expect(page.locator(".cmd-faction")).toHaveCount(2);
  await expect(page.locator(".cmd-turn")).toContainText("turn 0/80");
  // The link chip reflects useSpectate's `connected` flag; the hook ignores
  // the socket StrictMode discards, so the mocked socket reads as live.
  await expect(page.locator(".cmd-link.ok")).toHaveText("live");
  await expect(page.locator(".cmd-nav").getByRole("link", { name: "Replay" })).toHaveAttribute("href", `/matches/${MATCH}/replay`);
  await expect(page.locator(".cmd-nav").getByRole("link", { name: "Play", exact: true })).toHaveAttribute("href", "/play");

  await expect(cities(page).nth(0)).toContainText("nomads · no city yet");
  await expect(cities(page).nth(0)).toContainText("nothing built - the crew must found a core");
  await expect(cities(page).nth(0)).toContainText("4 workers");
  await expect(cities(page).nth(1)).toContainText("nomads · no city yet");
  await expect(cities(page).last()).toContainText("Neutral");
  // No pixel sprites anywhere in the chrome; the only images are the model
  // portraits (selection panel, field manual), and nothing is selected yet.
  await expect(page.locator(".match-screen img:not(.field-manual img)")).toHaveCount(0);
  await expect(page.locator(".match-screen").getByText(/[\u{1F300}-\u{1FAFF}]/u)).toHaveCount(0);
  await expect(page.locator(".map-surface canvas")).toHaveCount(1);
  expect(arena.unmocked).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/01-nomad-2p.png` });
});

test("free-for-all: three factions on the top bar, a spectating owner, no overflow", async ({ page }) => {
  const arena = new Arena(nomadState(3), seats(3));
  arena.ownerAgents = [agentFixture("a-9", "benched")];   // owns an agent, but not one in this match
  await arena.install(page);
  await signIn(page);
  await open(page);
  await expect(page.locator(".cmd-faction")).toHaveCount(3);
  await expect(page.locator(".cmd-faction").nth(2)).toContainText("oracle-9");
  await expect(page.locator(".cmd-tag.you")).toHaveCount(0);
  await expect(page.locator(".cmd-chat-head")).toContainText("Agent chat");
  await expect(page.locator(".cmd-chat-body")).toContainText("You're spectating");
  await expect(page.locator(".fog-select button")).toHaveCount(5);   // all · 3 players · god
  const m = await overflowMetrics(page);
  expect(m.docScroll, JSON.stringify(m)).toBeLessThanOrEqual(m.win);
  await page.screenshot({ path: `${SHOTS}/02-ffa-3p.png` });
});

test("city phase: sites with crews, selection from the Cities tab, menus with real costs and locks", async ({ page }) => {
  const { state } = cityState();
  const arena = new Arena(state, seats(2, ["copilot", "autonomous"]));
  arena.ownerAgents = [agentFixture("a-1", "pixelfist")];
  await arena.install(page);
  await signIn(page);
  await open(page);

  const p0 = cities(page).nth(0);
  await expect(p0).toContainText("4 buildings");
  await expect(p0).toContainText("Forge · FW v1");
  const site = p0.locator(".cmd-site");
  await expect(site).toContainText("Lab");
  await expect(site).toContainText("2/4 · crew 2");
  await expect(p0.locator(".cmd-city-eco")).toContainText("4 workers");
  await expect(p0.locator(".cmd-city-eco")).toContainText("1 idle");
  await expect(p0.locator(".cmd-city-eco")).toContainText("2 building");
  await expect(p0.locator(".cmd-city-eco")).toContainText("1 hauling");

  await site.click();
  const sel = selection(page);
  await expect(sel).toContainText("Lab");
  await expect(sel).toContainText("under construction");
  await expect(sel).toContainText("work 2/4");
  await expect(sel).toContainText("crew 2");
  await expect(sel.locator(".cmd-facts")).toContainText("paid");
  await expect(sel.locator(".cmd-facts")).toContainText("60");
  await expect(site).toHaveClass(/on/);

  await p0.getByRole("button", { name: /^Core ×1/ }).click();
  await expect(sel).toContainText("Core");
  await expect(sel).toContainText("building · Town Center");
  await expect(sel).toContainText("450/450 hp");
  await expect(sel).toContainText("rally (9,9)");
  await expect(menu(page)).toContainText("Trains at the core");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Worker" })).toContainText("25");
  await expect(menu(page)).not.toContainText("Watcher");          // oracle only
  await expect(menu(page).getByRole("button")).toHaveCount(0);     // read-only: no fake orders
  const portrait = sel.locator(".cmd-sel-glyph img");             // the portrait is the final 3D model, per faction
  await expect(portrait).toHaveAttribute("src", "/portraits/core_p0.jpg");
  expect(await portrait.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/03-selection-core.png` });

  await p0.getByRole("button", { name: /^Assembler/ }).click();
  await expect(menu(page)).toContainText("Trains at the assembler");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Striker" })).not.toHaveClass(/locked/);
  const launcher = menu(page).locator(".cmd-menu-item", { hasText: "Launcher" });
  await expect(launcher).toHaveClass(/locked/);
  await expect(launcher).toContainText("needs firmware v2");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Anvil" })).toBeVisible();   // forge special
  await expect(menu(page)).not.toContainText("Spark");

  await cities(page).nth(1).getByRole("button", { name: /^Assembler/ }).click();
  await expect(sel).toContainText("ironjaw");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Launcher" })).not.toHaveClass(/locked/);
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Spark" })).toBeVisible();
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Walking Tower" })).toContainText("needs firmware v3");

  await p0.getByRole("button", { name: /^Worker ×4/ }).click();
  await expect(menu(page)).toContainText("Can build");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Turret" })).toContainText("needs firmware v2");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Core" })).toContainText("second core needs firmware v2");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Cocoon" })).toContainText("25");
  await expect(menu(page).locator(".cmd-menu-item", { hasText: "Assembler" })).toContainText("short");   // 80 metal > 62 banked
  expect(arena.calls.filter((c) => c.method === "POST")).toEqual([]);   // selecting never sends orders
});

test("survivor, camp guard and recruited human are told apart", async ({ page }) => {
  const { state } = cityState();
  const arena = new Arena(state, seats(2));
  await arena.install(page);
  await open(page);
  const neutral = cities(page).last();
  await expect(neutral).toContainText("Neutral");
  await neutral.getByRole("button", { name: /^Survivor/ }).click();
  const sel = selection(page);
  await expect(sel).toContainText("Survivor");
  await expect(sel).toContainText("neutral survivor · unarmed · collectible");
  await expect(sel.locator(".cmd-owner")).toHaveText("Neutral");
  await expect(sel).toContainText("a worker carries it to a cocoon");
  await expect(sel.locator(".cmd-facts")).not.toContainText("atk");

  await neutral.getByRole("button", { name: /^Guard/ }).click();
  await expect(sel).toContainText("Human");
  await expect(sel).toContainText("armed human · camp guard");
  await expect(sel).toContainText("atk 5");
  await expect(sel).toContainText("range 2");
  await page.screenshot({ path: `${SHOTS}/04-selection-guard.png` });

  await cities(page).nth(0).getByRole("button", { name: /^Human ×1/ }).click();
  await expect(sel).toContainText("armed human · recruited");
  await expect(sel.locator(".cmd-owner")).toHaveText("pixelfist");
});

test("workers show cargo and errands; cocoons show their humans", async ({ page }) => {
  const { state } = cityState();
  const arena = new Arena(state, seats(2));
  await arena.install(page);
  await open(page);
  await cities(page).nth(0).getByRole("button", { name: /^Worker ×4/ }).click();
  const sel = selection(page);
  await expect(sel).toContainText("cargo 12/20");
  await expect(sel).toContainText("12 metal");
  await expect(sel).toContainText("carrying a full load home");
  await cities(page).nth(1).getByRole("button", { name: /^Worker ×2/ }).click();
  await expect(sel).toContainText("carrying a survivor");
  await expect(sel).toContainText("delivering a survivor to a cocoon");
  await cities(page).nth(0).getByRole("button", { name: /^Cocoon/ }).click();
  await expect(sel).toContainText("humans 1/2");
  await expect(sel).toContainText("1 harvest slot");
  await page.screenshot({ path: `${SHOTS}/05-selection-cocoon.png` });
});

test("chat as a guest: sign-in prompt, no protected calls", async ({ page }) => {
  const arena = new Arena(nomadState(2), seats(2, ["copilot", "copilot"]));
  await arena.install(page);
  await open(page);
  await expect(page.locator(".cmd-chat-head")).toContainText("Agent chat");
  await expect(page.locator(".cmd-chat-body")).toContainText("Log in and send your own agent");
  await page.waitForTimeout(500);
  expect(arena.calls.filter((c) => c.path.startsWith("/api/agents") || c.path.includes("/shouts"))).toEqual([]);
});

test("chat in copilot: one message goes out with the agent id and shows as delivered", async ({ page }) => {
  const arena = new Arena(nomadState(2), seats(2, ["copilot", "autonomous"]));
  arena.ownerAgents = [agentFixture("a-1", "pixelfist")];
  await arena.install(page);
  await signIn(page);
  await open(page);
  const head = page.locator(".cmd-chat-head");
  await expect(head).toContainText("Chat");
  await expect(head).toContainText("pixelfist");
  await expect(head.locator(".mode-chip")).toHaveText("Copilot");
  await expect(page.locator(".cmd-chat-body")).toContainText("0/20 used");
  const input = page.getByLabel("message to your agent");
  await input.fill("attack their core");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".chat-msg.you")).toContainText("attack their core");
  await expect(page.locator(".chat-msg.system")).toContainText("Delivered - pixelfist reads it on turn next");
  const posts = arena.calls.filter((c) => c.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ path: `/api/matches/${MATCH}/shout`, body: { agent_id: "a-1", text: "attack their core" } });
  await expect(page.locator(".cmd-chat-body")).toContainText("1/20 used");
  await page.screenshot({ path: `${SHOTS}/06-chat-copilot.png` });
});

test("chat in manual and autonomous modes", async ({ page }) => {
  const arena = new Arena(nomadState(2), seats(2, ["manual", "copilot"]));
  arena.ownerAgents = [agentFixture("a-1", "pixelfist")];
  await arena.install(page);
  await signIn(page);
  await open(page);
  await expect(page.locator(".cmd-chat-head")).toContainText("Command");
  await expect(page.locator(".cmd-chat-head .mode-chip")).toHaveText("Manual");
  await expect(page.locator(".cmd-chat-body")).toContainText("You are at the controls");
  await expect(page.locator(".chat-msg.system")).toContainText("Waiting for your first order");
  await expect(page.getByLabel("order for your agent")).toBeEnabled();

  // collapse and reopen the chat: tabs above keep their room, the chat stays reachable
  await page.locator(".cmd-chat-head").click();
  await expect(page.locator(".cmd-chat-head")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#cmd-chat-body")).toBeHidden();
  await page.locator(".cmd-chat-head").click();
  await expect(page.locator("#cmd-chat-body")).toBeVisible();

  const locked = new Arena(nomadState(2), seats(2, ["autonomous", "copilot"]));
  locked.ownerAgents = [agentFixture("a-1", "pixelfist")];
  await locked.install(page);                       // newer routes win
  await open(page);
  await expect(page.locator(".cmd-chat-head .mode-chip")).toHaveText("Autonomous");
  await expect(page.locator(".chat-locked")).toContainText("Autonomous mode");
  await expect(page.locator(".chat-input-row input")).toBeDisabled();
  expect(locked.calls.filter((c) => c.path.includes("/shouts"))).toEqual([]);
});

test("field manual: real nomad figures, the whole cast, closes on Escape and on the button", async ({ page }) => {
  const arena = new Arena(nomadState(2), seats(2));
  await arena.install(page);
  await open(page);
  const toggle = page.getByRole("button", { name: "Field manual" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("dialog", { name: "Field manual" })).toBeHidden();
  await toggle.click();
  const manual = page.getByRole("dialog", { name: "Field manual" });
  await expect(manual).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const figures = manual.locator(".fm-figure");
  await expect(figures.nth(0)).toHaveText("4workers");
  await expect(figures.nth(1)).toHaveText("1striker");
  await expect(figures.nth(2)).toHaveText("75energy");
  await expect(figures.nth(3)).toHaveText("100metal");
  await expect(manual).toContainText("costs 100 metal");
  await expect(manual).toContainText("houses up to 2 humans");
  await expect(manual).toContainText("banks it only at a core or a depot");
  await expect(manual).toContainText("Manual mode: you write one message per turn");
  await expect(manual).toContainText("no click-to-command");
  await manual.getByText("Cast", { exact: true }).click();
  const cast = manual.locator(".fm-unit");
  await expect(cast).toHaveCount(15);
  for (const type of ["worker", "striker", "launcher", "rider", "wasp", "walking_tower", "drone_swarm",
                      "colossus", "human", "spark", "anvil", "watcher", "leech", "prism", "survivor"]) {
    await expect(manual.locator(`.fm-unit[data-unit="${type}"]`)).toHaveCount(1);
  }
  await expect(manual.locator('.fm-unit[data-unit="survivor"] .fm-tags')).toContainText("neutral · unarmed · collectible");
  await expect(manual.locator('.fm-unit[data-unit="human"] .fm-tags')).toContainText("armed human");
  await expect(manual.locator(".fm-unit img")).toHaveCount(15);   // portraits rendered from the final models
  await expect(manual.locator('.fm-unit[data-unit="survivor"] img')).toHaveAttribute("src", "/portraits/survivor_n.jpg");
  await page.screenshot({ path: `${SHOTS}/07-field-manual.png` });

  await page.keyboard.press("Escape");
  await expect(manual).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(manual).toBeVisible();
  await manual.getByRole("button", { name: "Close" }).click();
  await expect(manual).toBeHidden();
});

test("a resolved turn updates numbers, score and the command log; the end shows Results", async ({ page }) => {
  const { state } = cityState();
  const arena = new Arena(state, seats(2, ["copilot", "autonomous"]));
  arena.ownerAgents = [agentFixture("a-1", "pixelfist")];
  arena.highlights = [{ turn: 12, kind: "first_lab", text: "pixelfist lays the foundations of a lab" }];
  await arena.install(page);
  await signIn(page);
  await open(page);
  await expect(page.locator(".match-banner")).toContainText("lays the foundations");

  const next = JSON.parse(JSON.stringify(state)) as Json;
  (next.players as Json[])[0] = { ...(next.players as Json[])[0], energy: 156, metal: 74 };
  next.turn = 13;
  arena.resolveTurn(13, next, [
    { agent_id: "a-1", player_index: 0, text: "orders", kind: "orders", viz: [
      { action: "gather", actors: [["worker", 3]], actor_ids: [6, 7, 8],
        target: { kind: "terrain", terrain: "pod", x: 14, y: 10 } },
      { action: "build", actors: [["worker", 2]], actor_ids: [7, 8],
        target: { kind: "building", type: "lab", owner: 0, id: 5 } },
      { action: "attack", actors: [["striker", 1]], actor_ids: [10],
        target: { kind: "unit", type: "human", owner: -1, id: 21 } },
    ] },
  ], [420, 388]);

  await expect(page.locator(".cmd-turn")).toContainText("turn 13/80");
  await expect(page.locator(".cmd-faction").nth(0).locator(".cmd-stat.energy")).toHaveText("156");
  await expect(page.locator(".cmd-faction").nth(0).locator(".cmd-stat.score")).toHaveText("420");
  await page.getByRole("tab", { name: "Actions" }).click();
  const rows = page.locator(".abx-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("pixelfist");
  await expect(rows.nth(0)).toContainText("Worker");
  await expect(rows.nth(0)).toContainText("×3");
  await expect(rows.nth(0)).toContainText("gather");
  await expect(rows.nth(0)).toContainText("Human pods");
  await expect(rows.nth(1)).toContainText("build");
  await expect(rows.nth(1)).toContainText("Lab");
  await expect(rows.nth(2)).toContainText("attack");
  await expect(rows.nth(2)).toContainText("Human");
  await expect(page.locator(".actionbox img")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/08-actions-log.png` });

  await page.getByRole("tab", { name: "Score" }).click();
  await expect(page.locator(".cmd-score-table")).toContainText("420");
  await expect(page.locator(".cmd-score-table")).toContainText("388");

  arena.end();
  await expect(page.getByRole("button", { name: "Results" })).toBeVisible();
  await expect(page.locator(".cmd-nav a[href$='/result']")).toHaveCount(1);
});

test("reduced motion and keyboard: no banner animation, tabs move with the arrows", async ({ page }) => {
  const { state } = cityState();
  const arena = new Arena(state, seats(2));
  arena.highlights = [{ turn: 12, kind: "first_lab", text: "pixelfist lays the foundations of a lab" }];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await arena.install(page);
  await open(page);
  const banner = page.locator(".match-banner");
  await expect(banner).toBeVisible();
  expect(await banner.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  await page.locator(".cmd-tab[aria-selected='true']").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Actions" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "cmd-tab-actions");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Cities" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveClass(/cmd-select|cmd-site/);   // the first city chip is next in order
  await expect(page.locator(".fog-select button")).toHaveCount(4);
});

test.describe("layout", () => {
  for (const vp of [{ width: 1600, height: 1000 }, { width: 1440, height: 960 }, { width: 900, height: 700 }]) {
    test(`no horizontal overflow, map visible, sidebar scrolls at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      const { state } = cityState();
      const arena = new Arena(state, seats(2, ["copilot", "autonomous"]));
      arena.ownerAgents = [agentFixture("a-1", "pixelfist")];
      await arena.install(page);
      await signIn(page);
      await open(page);
      await expect(page.locator(".cmd-city")).toHaveCount(3);
      const before = await overflowMetrics(page);
      expect(before.docScroll, `doc ${JSON.stringify(before)}`).toBeLessThanOrEqual(before.win);
      expect(before.docScrollH, `vertical ${JSON.stringify(before)}`).toBeLessThanOrEqual(before.winH);
      expect(before.uncovered, `map band ${JSON.stringify(before)}`).toBeGreaterThan(180);
      expect(before.panelOverflow).toBe("auto");
      expect(before.panelH).toBeGreaterThan(100);

      await cities(page).nth(0).getByRole("button", { name: /^Core ×1/ }).click();
      await expect(selection(page)).toContainText("Trains at the core");
      const after = await overflowMetrics(page);
      expect(after.docScroll, `doc after ${JSON.stringify(after)}`).toBeLessThanOrEqual(after.win);
      expect(after.uncovered, `map band after ${JSON.stringify(after)}`).toBeGreaterThan(150);
      await page.screenshot({ path: `${SHOTS}/09-layout-${vp.width}x${vp.height}.png` });
    });
  }
});

test("3D world: nomad start, mid-game city and free-for-all render with the default renderer", async ({ page }) => {
  test.slow();
  const errors = trackErrors(page);
  await signIn(page);
  const scenes: [string, Arena][] = [
    ["nomad", new Arena(nomadState(2), seats(2, ["copilot", "autonomous"]))],
    ["city", new Arena(cityState().state, seats(2, ["copilot", "autonomous"]))],
    ["ffa", new Arena(nomadState(3), seats(3, ["copilot"]))],
  ];
  for (const [name, arena] of scenes) {
    arena.ownerAgents = [agentFixture("a-1", "pixelfist")];
    await arena.install(page);                          // newer routes win
    await open(page, "default");
    await expect(page.locator(".world-loading")).toHaveCount(0, { timeout: 90_000 });   // neither loading nor the WebGL alert
    await expect(page.locator("canvas[aria-label^='3D battlefield']")).toHaveCount(1);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/11-world-${name}.png` });
  }
  expect(errors).toEqual([]);
});

test("default renderer: the command post stands while the world loads", async ({ page }) => {
  const arena = new Arena(nomadState(2), seats(2));
  await arena.install(page);
  await open(page, "default");
  await expect(page.locator(".cmd-faction")).toHaveCount(2);
  await expect(page.locator(".world-toolbar")).toBeVisible();
  const m = await overflowMetrics(page);
  expect(m.docScroll, JSON.stringify(m)).toBeLessThanOrEqual(m.win);
  await page.screenshot({ path: `${SHOTS}/10-default-renderer.png` });
});
