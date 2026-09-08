// Play hub (/play) against a mocked API: guest access, the queue flow (1v1 /
// free-for-all bodies, double clicks, cancel, stale and reordered answers),
// the jump into the match, sign-out and account switches with actions in
// flight, errors with retry, practice, and the layout at 900x700.
// Nothing here reaches the backend: every /api/** call and every WebSocket is
// intercepted, and the "owners" only exist in this browser context.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import fs from "fs";

const SHOTS = "test-results/fable-01";

interface MockUser {
  id: string; email: string; display_name: string; role: string; practice_remaining: number;
}
interface MockAgent {
  id: string; name: string; lineage: string; kind: "hosted" | "remote"; level: number; xp: number;
  title: string | null; avatar_variant: number; is_house: boolean; house_tier: string | null;
  model_declared: string | null; elo_by_format: { "1v1": number; ffa: number };
  interventions_count: number; created_at: string; active: boolean; auto_queue: boolean;
  formats: string[]; queued_format: string | null; queued_mode: string | null;
  live_match_id: string | null; can_edit_charter: boolean;
}
interface MockPlayer {
  player_index: number; agent_id: string; name: string; lineage: string; level: number;
  is_house: boolean; kind: string; status: string; placement: null; score: null; elo_delta: null;
}
interface MockMatch {
  id: string; format: string; status: string; turn: number; max_turns: number;
  is_ranked: boolean; summary: null; players: MockPlayer[];
}
interface Call { method: string; path: string; body: unknown; auth: string | null }
interface Account { agents: MockAgent[]; me: MockUser }
type Failure = { status: number; code: string; message: string } | "abort" | null;
type HoldKind = "agents" | "queue" | "delete" | "practice";

const TOKEN = "pw-access";
const OWNER: MockUser = {
  id: "u-fable", email: "fable-owner@example.test", display_name: "Fable Owner",
  role: "player", practice_remaining: 2,
};
const SECOND_TOKEN = "pw-access-second";
const SECOND_OWNER: MockUser = {
  id: "u-second", email: "second-owner@example.test", display_name: "Second Owner",
  role: "player", practice_remaining: 3,
};

function agent(id: string, name: string, over: Partial<MockAgent> = {}): MockAgent {
  return {
    id, name, lineage: "forge", kind: "hosted", level: 3, xp: 120, title: null, avatar_variant: 0,
    is_house: false, house_tier: null, model_declared: "mock/boom",
    elo_by_format: { "1v1": 1040, ffa: 985 }, interventions_count: 0,
    created_at: "2026-09-01T00:00:00Z", active: true, auto_queue: false,
    formats: ["1v1", "ffa"], queued_format: null, queued_mode: null, live_match_id: null,
    can_edit_charter: true, ...over,
  };
}

const queuedAgent = () => agent("a-1", "pixelfist", { queued_format: "1v1", queued_mode: "copilot" });

function player(index: number, name: string, lineage = "forge"): MockPlayer {
  return { player_index: index, agent_id: `a-${name}`, name, lineage, level: 2, is_house: false,
           kind: "hosted", status: "alive", placement: null, score: null, elo_delta: null };
}

const LIVE: MockMatch[] = [
  { id: "m-live-1", format: "1v1", status: "live", turn: 12, max_turns: 200, is_ranked: true,
    summary: null, players: [player(0, "rustbucket"), player(1, "ironjaw", "swarm")] },
  { id: "m-live-2", format: "ffa4", status: "live", turn: 57, max_turns: 200, is_ranked: true,
    summary: null, players: [player(0, "oracle-9", "oracle"), player(1, "leechlord", "parasite"),
                              player(2, "photon-3", "photon"), player(3, "anvilhead")] },
];

const QUEUED_OK = { queued_at: "2026-09-06T12:00:00Z", elo_snapshot: 1040, mode: "copilot" };

/** In-memory stand-in for the API: records every call, answers from state.
 *  Requests of a kind in `hold` are parked unanswered until the test picks
 *  them up with `nextHeld` and fulfils them itself (state included). */
class MockApi {
  agents: MockAgent[];
  me: MockUser;
  live: MockMatch[] = [];
  /** Per-bearer-token data; when set, requests are answered for their own account. */
  accounts: Record<string, Account> | null = null;
  calls: Call[] = [];
  unmocked: string[] = [];
  queueDelayMs = 0;
  queueFailure: Failure = null;
  practiceFailure: Failure = null;
  liveFailure = false;
  hold = new Set<HoldKind>();
  onLeaveQueue: ((a: MockAgent) => void) | null = null;
  private held: Partial<Record<HoldKind, Route[]>> = {};
  private waiters: Partial<Record<HoldKind, ((r: Route) => void)[]>> = {};

  constructor(agents: MockAgent[], me: MockUser = { ...OWNER }) {
    this.agents = agents;
    this.me = me;
  }

  async install(page: Page) {
    await page.routeWebSocket(() => true, () => { /* swallowed: nothing reaches a server */ });
    await page.route((url) => url.pathname.startsWith("/api/"), (route) => this.handle(route));
  }

  /** The next parked request of that kind (already parked, or the next to arrive). */
  nextHeld(kind: HoldKind): Promise<Route> {
    const r = this.held[kind]?.shift();
    if (r) return Promise.resolve(r);
    return new Promise((res) => { (this.waiters[kind] ??= []).push(res); });
  }

  private park(kind: HoldKind, route: Route) {
    const w = this.waiters[kind]?.shift();
    if (w) w(route); else (this.held[kind] ??= []).push(route);
  }

  private account(req: Request): Account | null {
    const token = (req.headers()["authorization"] ?? "").replace(/^Bearer /i, "");
    return this.accounts?.[token] ?? null;
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    this.calls.push({ method, path, body, auth: req.headers()["authorization"] ?? null });
    const acct = this.account(req);
    const agents = acct?.agents ?? this.agents;
    const me = acct?.me ?? this.me;

    if (method === "GET" && path === "/api/agents") {
      if (this.hold.has("agents")) return this.park("agents", route);
      return route.fulfill({ json: { agents } });
    }
    if (method === "GET" && path === "/api/auth/me") return route.fulfill({ json: me });
    if (method === "GET" && path === "/api/matches") {
      if (this.liveFailure) {
        return route.fulfill({ status: 503, json: { detail: { code: "unavailable", message: "matches unavailable" } } });
      }
      return route.fulfill({ json: { matches: this.live } });
    }

    const queue = path.match(/^\/api\/agents\/([^/]+)\/queue$/);
    if (queue && method === "POST") {
      if (this.hold.has("queue")) return this.park("queue", route);
      if (this.queueDelayMs) await new Promise((r) => setTimeout(r, this.queueDelayMs));
      if (this.queueFailure === "abort") return route.abort("failed");
      if (this.queueFailure) {
        const f = this.queueFailure;
        return route.fulfill({ status: f.status, json: { detail: { code: f.code, message: f.message } } });
      }
      const a = agents.find((x) => x.id === queue[1]);
      if (!a) return route.fulfill({ status: 404, json: { detail: { code: "not_found", message: "no such agent" } } });
      if (a.queued_format || a.live_match_id) {
        return route.fulfill({ status: 409, json: { detail: { code: "busy", message: "agent already queued or playing" } } });
      }
      const b = body as { format: string; mode: string };
      a.queued_format = b.format;
      a.queued_mode = b.mode;
      return route.fulfill({ json: { ...QUEUED_OK, elo_snapshot: a.elo_by_format["1v1"], mode: b.mode } });
    }
    if (queue && method === "DELETE") {
      if (this.hold.has("delete")) return this.park("delete", route);
      const a = agents.find((x) => x.id === queue[1]);
      if (a) { a.queued_format = null; a.queued_mode = null; this.onLeaveQueue?.(a); }
      return route.fulfill({ status: 204, body: "" });
    }
    const practice = path.match(/^\/api\/agents\/([^/]+)\/practice$/);
    if (practice && method === "POST") {
      if (this.hold.has("practice")) return this.park("practice", route);
      if (this.practiceFailure === "abort") return route.abort("failed");
      if (this.practiceFailure) {
        const f = this.practiceFailure;
        return route.fulfill({ status: f.status, json: { detail: { code: f.code, message: f.message } } });
      }
      const spent = { ...me, practice_remaining: me.practice_remaining - 1 };
      if (acct) acct.me = spent; else this.me = spent;
      const b = body as { mode: string };
      return route.fulfill({ json: { match_id: "m-practice-1", mode: b.mode, practice_remaining: spent.practice_remaining } });
    }
    if (method === "GET" && /^\/api\/matches\/[^/]+/.test(path)) {
      return route.fulfill({ status: 404, json: { detail: { code: "not_found", message: "no such match (mock)" } } });
    }
    this.unmocked.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { detail: { code: "not_mocked", message: `${method} ${path}` } } });
  }
}

const authValue = (user: MockUser, token: string) => JSON.stringify({
  state: { accessToken: token, refreshToken: `${token}-refresh`, user }, version: 0 });

/** A signed-in owner that exists only in this browser context (zustand persist shape). */
async function signIn(page: Page, user: MockUser = OWNER, token: string = TOKEN) {
  await page.addInitScript((value) => localStorage.setItem("cero-auth", value), authValue(user, token));
}

/** Another tab signed in as someone else: cero-auth rotates and the store rehydrates. */
async function switchAccount(page: Page, user: MockUser, token: string) {
  await page.evaluate((value) => {
    localStorage.setItem("cero-auth", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "cero-auth", newValue: value }));
  }, authValue(user, token));
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const protectedCalls = (calls: Call[]) =>
  calls.filter((c) => c.path.startsWith("/api/agents") || c.path.startsWith("/api/auth") || c.auth !== null);

const searchingPanel = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Searching for opponents" });
const find1v1 = (page: Page) => page.getByRole("button", { name: "Find opponents (1v1 duel)" });
const findFfa = (page: Page) => page.getByRole("button", { name: "Find opponents (Free-for-all)" });
const HOUSE_NOTE = "house agents may fill empty seats when available";

test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

test("guest: visible Play entry, formats and live matches, no protected calls", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);   // exists server-side, must never be asked for
  api.live = LIVE;
  await api.install(page);
  const errors = trackErrors(page);
  await page.goto("/play");

  const nav = page.locator(".topnav a.play-nav-link");
  await expect(nav).toHaveText("Play");
  await expect(nav).toHaveClass(/active/);
  await expect(page.getByRole("heading", { level: 1, name: "Play" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to play" })).toBeVisible();
  const main = page.locator(".play-main");
  await expect(main.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Create an account" })).toBeVisible();
  await expect(page.locator(".play-format-name", { hasText: "1v1 duel" })).toBeVisible();
  await expect(page.locator(".play-format-name", { hasText: "Free-for-all" })).toBeVisible();
  const find = page.getByRole("button", { name: /Find opponents/ });
  await expect(find).toHaveCount(2);
  await expect(find.nth(0)).toBeDisabled();
  await expect(find.nth(1)).toBeDisabled();
  // No promised wait: matching by rating, house agents only "may" fill seats.
  await expect(page.locator(".play-lead")).toContainText(HOUSE_NOTE);
  await expect(page.getByText(/about a minute|within a minute|steps in/)).toHaveCount(0);

  const rows = page.locator(".play-live-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("rustbucket");
  await expect(rows.nth(0)).toContainText("ironjaw");
  await expect(rows.nth(0)).toContainText("turn 12/200");
  await expect(rows.nth(0).getByRole("link", { name: "Watch" })).toHaveAttribute("href", "/matches/m-live-1");
  await expect(rows.nth(1)).toContainText("ffa4");

  await page.waitForTimeout(800);
  expect(protectedCalls(api.calls)).toEqual([]);
  expect(api.calls.filter((c) => c.method !== "GET")).toEqual([]);
  expect(api.unmocked).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/00-guest.png`, fullPage: true });
});

test("signed in without agents: create-agent call to action, nothing queued", async ({ page }) => {
  const api = new MockApi([]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  await expect(page.getByRole("heading", { name: "No agent yet" })).toBeVisible();
  const cta = page.locator(".play-main a[href='/agents/new']").first();
  await expect(cta.getByRole("button", { name: "Create your first agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Find opponents/ })).toHaveCount(0);
  await expect(page.getByText("No match is running right now.")).toBeVisible();
  await expect(page.locator(".play-live-row")).toHaveCount(0);
  expect(api.calls.filter((c) => c.method !== "GET")).toEqual([]);
});

test("live list: an error shows no fake rows and recovers on retry", async ({ page }) => {
  const api = new MockApi([]);
  api.live = LIVE;
  api.liveFailure = true;
  await api.install(page);
  await page.goto("/play");
  const alert = page.locator(".play-side").getByRole("alert");
  await expect(alert).toContainText("Live matches could not be loaded.");
  await expect(alert).toContainText("matches unavailable");
  await expect(page.locator(".play-live-row")).toHaveCount(0);
  await expect(page.getByText("No match is running right now.")).toHaveCount(0);
  api.liveFailure = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".play-live-row")).toHaveCount(2);
  await expect(alert).toHaveCount(0);
});

test("owner: 1v1 and free-for-all bodies, no duplicate on double click, cancel", async ({ page }) => {
  const api = new MockApi([
    agent("a-1", "pixelfist"),
    agent("a-2", "ironjaw", { lineage: "swarm", kind: "remote", model_declared: null }),
  ]);
  api.live = LIVE;
  api.queueDelayMs = 350;   // long enough for the second click of a double click to land
  await api.install(page);
  await signIn(page);
  const errors = trackErrors(page);
  await page.goto("/play");

  await expect(page.getByRole("radio", { name: /pixelfist/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".mode-opt.copilot")).toHaveAttribute("aria-checked", "true");
  await expect(find1v1(page)).toBeEnabled();
  await expect(findFfa(page)).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/01-hub-formats.png`, fullPage: true });

  await find1v1(page).dblclick();
  const searching = searchingPanel(page);
  await expect(searching).toBeVisible();
  await expect(searching).toContainText("pixelfist");
  await expect(searching).toContainText("1v1 duel");
  await expect(searching).toContainText("Copilot");
  await expect(searching).toContainText(HOUSE_NOTE);
  await expect(searching).not.toContainText(/about a minute|within a minute|steps in/);
  await expect(searching.getByRole("button", { name: "Cancel search" })).toBeEnabled();
  let posts = api.calls.filter((c) => c.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ path: "/api/agents/a-1/queue", body: { format: "1v1", mode: "copilot" } });
  await expect(page.getByRole("radio", { name: /pixelfist/ })).toContainText("Searching · 1v1");
  await expect(page.getByRole("button", { name: /Find opponents/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Practice/ })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/02-searching.png`, fullPage: true });

  await searching.getByRole("button", { name: "Cancel search" }).click();
  await expect(page.getByText("Search cancelled.")).toBeVisible();
  await expect(searching).toHaveCount(0);
  expect(api.calls.filter((c) => c.method === "DELETE")).toMatchObject([{ path: "/api/agents/a-1/queue" }]);
  await expect(find1v1(page)).toBeEnabled();

  await page.locator(".mode-opt.manual").click();
  await findFfa(page).click();
  await expect(searching).toBeVisible();
  await expect(searching).toContainText("Free-for-all");
  await expect(searching).toContainText("Manual");
  posts = api.calls.filter((c) => c.method === "POST");
  expect(posts).toHaveLength(2);
  expect(posts[1]).toMatchObject({ path: "/api/agents/a-1/queue", body: { format: "ffa", mode: "manual" } });
  expect(api.unmocked).toEqual([]);
  expect(errors).toEqual([]);
});

test("disabled format and missing model are explained before any click", async ({ page }) => {
  const api = new MockApi([
    agent("a-1", "pixelfist", { formats: ["1v1"] }),
    agent("a-2", "ghost", { model_declared: null }),
  ]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  await expect(find1v1(page)).toBeEnabled();
  await expect(findFfa(page)).toBeDisabled();
  await expect(page.getByRole("link", { name: "Enable it in the agent's settings" }))
    .toHaveAttribute("href", "/agents/a-1");
  await page.getByRole("radio", { name: /ghost/ }).click();
  await expect(find1v1(page)).toBeDisabled();
  await expect(findFfa(page)).toBeDisabled();
  await expect(page.getByRole("link", { name: "Connect one" }).first())
    .toHaveAttribute("href", "/agents/a-2/connect");
  expect(api.calls.filter((c) => c.method !== "GET")).toEqual([]);
});

test("cancel: a stale 'still queued' answer issued before the cancel never brings the search back", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  await find1v1(page).click();
  const searching = searchingPanel(page);
  await expect(searching).toBeVisible();

  api.hold.add("agents");                           // the next poll (about 4.5 s) stays unanswered
  const stale = await api.nextHeld("agents");
  api.hold.delete("agents");

  await searching.getByRole("button", { name: "Cancel search" }).click();
  await expect(page.getByText("Search cancelled.")).toBeVisible();
  await expect(searching).toHaveCount(0);
  await stale.fulfill({ json: { agents: [queuedAgent()] } });   // the old answer lands after the cancel
  await page.waitForTimeout(700);
  await expect(searching).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel search" })).toHaveCount(0);
  await expect(find1v1(page)).toBeEnabled();
});

test("cancel: a poll issued while the DELETE is pending cannot restore the search (R1)", async ({ page }) => {
  const api = new MockApi([queuedAgent()]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  const searching = searchingPanel(page);
  await expect(searching).toBeVisible();

  api.hold.add("delete");
  await searching.getByRole("button", { name: "Cancel search" }).click();
  const heldDelete = await api.nextHeld("delete");
  await expect(searching.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  api.hold.add("agents");
  const duringDelete = await api.nextHeld("agents");   // the poll that fires while the DELETE is pending
  api.hold.delete("agents");

  api.agents = [agent("a-1", "pixelfist")];            // the server processes the DELETE...
  await heldDelete.fulfill({ status: 204, body: "" });
  await expect(page.getByText("Search cancelled.")).toBeVisible();   // ...and the read after it lands
  await expect(find1v1(page)).toBeEnabled();

  await duringDelete.fulfill({ json: { agents: [queuedAgent()] } });   // its snapshot predates the cancel
  await page.waitForTimeout(700);
  await expect(searching).toHaveCount(0);
  await expect(page.getByText("Search cancelled.")).toBeVisible();
  await expect(find1v1(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Practice (2 left)" })).toBeEnabled();
  expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  await page.screenshot({ path: `${SHOTS}/04-cancel-poll-race.png`, fullPage: true });
});

test("match found: opens the followed agent's match, never another agent's", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist"), agent("a-2", "ironjaw")]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  await find1v1(page).click();
  const searching = searchingPanel(page);
  await expect(searching).toBeVisible();

  api.agents[1].live_match_id = "m-other";          // a different agent of ours starts playing
  await page.waitForTimeout(5500);                  // more than one poll
  await expect(page).toHaveURL(/\/play$/);
  await expect(searching).toBeVisible();
  await expect(page.getByRole("radio", { name: /ironjaw/ })).toContainText("In a match");

  api.agents[0].queued_format = null;               // now the followed one gets its match
  api.agents[0].queued_mode = null;
  api.agents[0].live_match_id = "m-mine";
  await expect(page).toHaveURL(/\/matches\/m-mine$/, { timeout: 10_000 });
});

test("leaving the page: a late read does not navigate", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);
  api.live = LIVE;
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  await find1v1(page).click();
  await expect(searchingPanel(page)).toBeVisible();

  api.hold.add("agents");
  const late = await api.nextHeld("agents");
  api.hold.delete("agents");
  await page.locator(".topnav").getByRole("link", { name: "Live" }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await late.fulfill({ json: { agents: [agent("a-1", "pixelfist", { live_match_id: "m-late" })] } });
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/matches$/);
});

test("leaving the page with a DELETE in flight: the late answer leaves no trace (R2)", async ({ page }) => {
  const api = new MockApi([queuedAgent()]);
  api.live = LIVE;
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  const searching = searchingPanel(page);
  await expect(searching).toBeVisible();
  api.hold.add("delete");
  await searching.getByRole("button", { name: "Cancel search" }).click();
  const heldDelete = await api.nextHeld("delete");
  await page.locator(".topnav").getByRole("link", { name: "Live" }).click();
  await expect(page).toHaveURL(/\/matches$/);
  const mark = api.calls.length;
  api.agents = [agent("a-1", "pixelfist")];
  await heldDelete.fulfill({ status: 204, body: "" });
  await page.waitForTimeout(800);
  expect(protectedCalls(api.calls.slice(mark))).toEqual([]);   // no read on behalf of a page that is gone
  await expect(page).toHaveURL(/\/matches$/);
});

test("sign-out with a queue POST in flight: the late answer leaves no trace (R2)", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);
  api.live = LIVE;
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  api.hold.add("queue");
  await find1v1(page).click();
  const heldPost = await api.nextHeld("queue");
  await page.locator(".topnav").getByRole("link", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".topnav").getByRole("link", { name: "Log in" })).toBeVisible();
  const mark = api.calls.length;
  api.agents[0].queued_format = "1v1";              // the server did queue it
  api.agents[0].queued_mode = "copilot";
  await heldPost.fulfill({ json: QUEUED_OK });
  await page.waitForTimeout(800);
  expect(protectedCalls(api.calls.slice(mark))).toEqual([]);   // no GET /api/agents, nothing with a token
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("sign-out with a practice POST in flight: no late navigation (R2)", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);
  api.live = LIVE;
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  api.hold.add("practice");
  await page.getByRole("button", { name: "Practice (2 left)" }).click();
  const heldPost = await api.nextHeld("practice");
  await page.locator(".topnav").getByRole("link", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  const mark = api.calls.length;
  await heldPost.fulfill({ json: { match_id: "m-practice-late", mode: "copilot", practice_remaining: 1 } });
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/$/);              // never /matches/m-practice-late
  expect(protectedCalls(api.calls.slice(mark))).toEqual([]);
});

test("account switch with a queue POST in flight: the new owner is free and nothing leaks (R2)", async ({ page }) => {
  const api = new MockApi([]);
  api.accounts = {
    [TOKEN]: { agents: [agent("a-1", "pixelfist")], me: { ...OWNER } },
    [SECOND_TOKEN]: { agents: [agent("b-1", "brassjaw"), agent("b-2", "coilhead", { lineage: "oracle" })],
                      me: { ...SECOND_OWNER } },
  };
  await api.install(page);
  await signIn(page, OWNER, TOKEN);
  const errors = trackErrors(page);
  await page.goto("/play");
  api.hold.add("queue");
  await find1v1(page).click();
  const heldPost = await api.nextHeld("queue");
  api.hold.delete("queue");

  await switchAccount(page, SECOND_OWNER, SECOND_TOKEN);   // another tab signed in as someone else
  const brassjaw = page.getByRole("radio", { name: /brassjaw/ });
  await expect(brassjaw).toBeVisible();
  await expect(brassjaw).toBeEnabled();                    // not frozen by the old owner's action
  await expect(brassjaw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /coilhead/ })).toBeEnabled();
  await expect(find1v1(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Practice (3 left)" })).toBeEnabled();
  await expect(page.locator(".topnav")).toContainText("Second Owner");

  const mark = api.calls.length;
  api.accounts[TOKEN].agents[0].queued_format = "1v1";    // the old owner's request did succeed server-side
  await heldPost.fulfill({ json: QUEUED_OK });
  await page.waitForTimeout(800);
  const late = api.calls.slice(mark).filter((c) => !c.path.startsWith("/api/matches"));
  expect(late).toEqual([]);                                // no follow-up read for either account
  await expect(searchingPanel(page)).toHaveCount(0);       // nothing of the old owner's queue shows here
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(find1v1(page)).toBeEnabled();

  await find1v1(page).click();                             // the new owner acts normally, with their token
  await expect(searchingPanel(page)).toContainText("brassjaw");
  const posts = api.calls.filter((c) => c.method === "POST");
  expect(posts.at(-1)).toMatchObject({ path: "/api/agents/b-1/queue", auth: `Bearer ${SECOND_TOKEN}`,
                                       body: { format: "1v1", mode: "copilot" } });
  expect(api.calls.slice(mark).filter((c) => c.auth === `Bearer ${TOKEN}`)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/05-account-switch.png`, fullPage: true });
});

test("account switch with a failing POST in flight: the old owner's error never shows (R2)", async ({ page }) => {
  const api = new MockApi([]);
  api.accounts = {
    [TOKEN]: { agents: [agent("a-1", "pixelfist")], me: { ...OWNER } },
    [SECOND_TOKEN]: { agents: [agent("b-1", "brassjaw")], me: { ...SECOND_OWNER } },
  };
  await api.install(page);
  await signIn(page, OWNER, TOKEN);
  await page.goto("/play");
  api.hold.add("queue");
  await find1v1(page).click();
  const heldPost = await api.nextHeld("queue");
  api.hold.delete("queue");
  await switchAccount(page, SECOND_OWNER, SECOND_TOKEN);
  await expect(page.getByRole("radio", { name: /brassjaw/ })).toBeEnabled();
  const mark = api.calls.length;
  await heldPost.fulfill({ status: 503, json: { detail: { code: "unavailable", message: "Old account request failed" } } });
  await page.waitForTimeout(800);
  await expect(page.getByText("Old account request failed")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /brassjaw/ })).toBeEnabled();
  await expect(find1v1(page)).toBeEnabled();
  expect(protectedCalls(api.calls.slice(mark))).toEqual([]);
});

test("agent already in a match: Back to the match, no automatic jump", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist", { live_match_id: "m-existing" })]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  const back = page.locator(".play-main a[href='/matches/m-existing']");
  await expect(back.getByRole("button", { name: "Back to the match" })).toBeVisible();
  await expect(page.getByText("pixelfist is in a match right now")).toBeVisible();
  await expect(page.getByRole("button", { name: /Find opponents/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Practice/ })).toBeDisabled();
  await page.waitForTimeout(1200);
  await expect(page).toHaveURL(/\/play$/);
  expect(api.calls.filter((c) => c.method !== "GET")).toEqual([]);
});

test("cancel race: the server had already made the match", async ({ page }) => {
  const api = new MockApi([queuedAgent()]);
  api.onLeaveQueue = (a) => { a.live_match_id = "m-raced"; };
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  const searching = searchingPanel(page);
  await expect(searching).toBeVisible();           // queued before we arrived: followed from here on
  await searching.getByRole("button", { name: "Cancel search" }).click();
  await expect(page.getByText(/Too late to cancel/)).toBeVisible();
  await expect(page.locator(".play-main a[href='/matches/m-raced']")
    .getByRole("button", { name: "Back to the match" })).toBeVisible();
  await expect(page.getByText("Search cancelled.")).toHaveCount(0);
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/play$/);
  expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
});

test("API errors are explained, retried, and recovered from", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);
  await api.install(page);
  await signIn(page);
  const errors = trackErrors(page);
  await page.goto("/play");
  const alert = page.getByRole("alert");

  api.queueFailure = { status: 409, code: "format_disabled", message: "enable this format in settings first" };
  await find1v1(page).click();
  await expect(alert).toContainText("enable this format in settings first");
  await expect(alert.getByRole("link", { name: "Enable it in the agent's settings" }))
    .toHaveAttribute("href", "/agents/a-1");
  await expect(find1v1(page)).toBeEnabled();

  api.queueFailure = { status: 409, code: "no_model", message: "connect a working model first" };
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toContainText("connect a working model first");
  await expect(alert.getByRole("link", { name: "Connect a model" })).toHaveAttribute("href", "/agents/a-1/connect");

  api.queueFailure = "abort";                       // the network drops the request
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toContainText("Could not do that");
  await expect(alert).toContainText("Check the connection and try again");

  api.queueFailure = null;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(searchingPanel(page)).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(4);
  expect(errors).toEqual([]);
});

test("Try again sends the mode picked after the failure, not the old one (R3)", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  api.queueFailure = { status: 503, code: "unavailable", message: "queue is down" };
  await find1v1(page).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("queue is down");
  await page.locator(".mode-opt.manual").click();
  await expect(page.locator(".mode-opt.manual")).toHaveAttribute("aria-checked", "true");
  api.queueFailure = null;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(searchingPanel(page)).toContainText("Manual");
  const posts = api.calls.filter((c) => c.method === "POST");
  expect(posts.map((c) => (c.body as { format: string; mode: string }).mode)).toEqual(["copilot", "manual"]);
  expect(posts.map((c) => (c.body as { format: string; mode: string }).format)).toEqual(["1v1", "1v1"]);
  expect(posts.every((c) => c.path === "/api/agents/a-1/queue")).toBe(true);
});

test("Try again for practice uses the current mode; switching agent drops the retry (R3)", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist"), agent("a-2", "ironjaw")]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  const practiceBtn = page.getByRole("button", { name: "Practice (2 left)" });
  const alert = page.getByRole("alert");
  api.practiceFailure = { status: 503, code: "unavailable", message: "practice is down" };
  await practiceBtn.click();
  await expect(alert).toContainText("practice is down");

  await page.getByRole("radio", { name: /ironjaw/ }).click();   // another agent: the failure is not carried over
  await expect(alert).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(api.calls.filter((c) => c.path.endsWith("/practice"))).toHaveLength(1);

  await page.getByRole("radio", { name: /pixelfist/ }).click();
  await practiceBtn.click();
  await expect(alert).toContainText("practice is down");
  await page.locator(".mode-opt.autonomous").click();
  api.practiceFailure = null;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/matches\/m-practice-1$/);
  const practice = api.calls.filter((c) => c.path.endsWith("/practice"));
  expect(practice.map((c) => (c.body as { mode: string }).mode)).toEqual(["copilot", "copilot", "autonomous"]);
  expect(practice.every((c) => c.path === "/api/agents/a-1/practice")).toBe(true);
});

test("practice: only on click, with the picked mode and the known quota", async ({ page }) => {
  const api = new MockApi([agent("a-1", "pixelfist")]);
  await api.install(page);
  await signIn(page);
  await page.goto("/play");
  const practice = page.getByRole("button", { name: "Practice (2 left)" });
  await expect(practice).toBeEnabled();
  await expect(page.getByText("Uses one of your 2 free practice matches.")).toBeVisible();
  await page.waitForTimeout(500);
  expect(api.calls.filter((c) => c.path.endsWith("/practice"))).toEqual([]);

  await page.locator(".mode-opt.autonomous").click();
  await practice.click();
  await expect(page).toHaveURL(/\/matches\/m-practice-1$/);
  const calls = api.calls.filter((c) => c.path.endsWith("/practice"));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ method: "POST", path: "/api/agents/a-1/practice", body: { mode: "autonomous" } });
});

test("practice: an exhausted quota is stated and the button is disabled", async ({ page }) => {
  const broke = { ...OWNER, practice_remaining: 0 };
  const api = new MockApi([agent("a-1", "pixelfist")], broke);
  await api.install(page);
  await signIn(page, broke);
  await page.goto("/play");
  await expect(page.getByRole("button", { name: "Practice (0 left)" })).toBeDisabled();
  await expect(page.getByText("No free practice matches left on this account.")).toBeVisible();
  await expect(find1v1(page)).toBeEnabled();
});

test.describe("layout", () => {
  for (const vp of [{ width: 1440, height: 960 }, { width: 900, height: 700 }]) {
    test(`no horizontal overflow at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      const api = new MockApi([
        agent("a-1", "pixelfist"),
        agent("a-2", "ironjaw", { lineage: "swarm", kind: "remote", model_declared: null }),
      ]);
      api.live = LIVE;
      await api.install(page);
      await signIn(page);
      await page.goto("/play");
      await expect(find1v1(page)).toBeVisible();
      await expect(page.locator(".play-live-row")).toHaveCount(2);
      const m = await page.evaluate(() => {
        const hub = document.querySelector(".play-hub") as HTMLElement;
        const nav = document.querySelector(".topnav") as HTMLElement;
        return {
          docScroll: document.documentElement.scrollWidth, win: window.innerWidth,
          hubScroll: hub.scrollWidth, hubClient: hub.clientWidth,
          navScroll: nav.scrollWidth, navClient: nav.clientWidth,
        };
      });
      expect(m.hubScroll, "the hub must not scroll sideways").toBeLessThanOrEqual(m.hubClient);
      expect(m.docScroll, `document ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.win);
      await page.screenshot({ path: `${SHOTS}/03-owner-${vp.width}x${vp.height}.png`, fullPage: true });
    });
  }
});
