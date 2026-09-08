// Screen 8: the live match as a command post. The map stays the protagonist;
// the chrome around it is one flat steel plate, repeated:
//  - top bar: every faction's real numbers (energy, metal, robots, buildings,
//    score, firmware, techs) plus turn, clock, link state and the way out
//  - bottom bar: the selection (what it is, whose, hp, cargo, humans, order,
//    what it can make and why not) and the minimap
//  - sidebar: tabs for cities, the command log, the war room and the score,
//    with the chat with your agent always within reach underneath
//  - a collapsible field manual with the real economy
// Nothing here commands units: agents give the orders, this screen shows them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic, ControlMode, EntityOut, GameState, PlayerOut, ShoutOut } from "../api/types";
import ActionBox from "../components/ActionBox";
import { Commentary } from "../components/bits";
import FieldManual, { FIRMWARE_ORDER, PRODUCTION } from "../components/FieldManual";
import type { Firmware, ProductionRow } from "../components/FieldManual";
import {
  BookIcon, BuildingsIcon, CargoIcon, ClockIcon, CrewIcon, DamageIcon, EnergyIcon,
  EntityGlyph, FirmwareIcon, HumansIcon, MetalIcon, ScoreIcon, SignalIcon, UnitsIcon,
} from "../components/icons";
import Minimap from "../components/Minimap";
import { MODE_LABEL } from "../components/ModePicker";
import Portrait from "../components/Portrait";
import ScoreChart from "../components/ScoreChart";
import {
  BUILD_ORDER, BUILDING_COST, BUILDING_INFO, BUILDING_MAX_HP, BUILDING_WORK, CARRY_CAPACITY,
  PLAYER_COLOR_CSS, TECH_ABBREV, UNIT_MAX_HP, UNIT_POWERS, UNIT_STATS, lineageLabel,
} from "../game/meta";
import { PERSPECTIVE_ALL } from "../game/vision";
import MapView, { MapController } from "../pixi/MapView";
import { useAuth } from "../store/auth";
import { useSpectate } from "../ws/useSpectate";
import "./live-command.css";

const NEUTRAL_COLOR = "#b8e63d";
const PRODUCERS = new Set(["core", "assembler"]);
type Tab = "cities" | "actions" | "warroom" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "cities", label: "Cities" }, { id: "actions", label: "Actions" },
  { id: "warroom", label: "War room" }, { id: "score", label: "Score" },
];

const nice = (type: string) => type.replace(/_/g, " ");
const teamColor = (owner: number) => (owner >= 0 ? PLAYER_COLOR_CSS[owner % 4] : NEUTRAL_COLOR);
const fwAtLeast = (have: string, need: Firmware | null) =>
  need === null || FIRMWARE_ORDER.indexOf(have as Firmware) >= FIRMWARE_ORDER.indexOf(need);

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The nav wraps at narrow widths; the screen must end where the viewport does. */
function useNavHeight(): number {
  const [h, setH] = useState(55);
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".topnav");
    if (!nav) return;
    const update = () => setH(Math.round(nav.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
  return h;
}

function useElementHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setH(Math.round(el.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, h];
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setOn(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return on;
}

// ------------------------------------------------------------------ chat

interface ChatMsg { from: "you" | "agent" | "system"; text: string; turn: number }

function AgentChat({ matchId, agentId, agentName, turn, finished, mode }: {
  matchId: string; agentId: string; agentName: string; turn: number; finished: boolean;
  mode: ControlMode;
}) {
  const closed = mode === "autonomous";   // on screen, out of reach
  const manual = mode === "manual";       // the chat IS the controller
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [used, setUsed] = useState(0);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // The conversation lives on the server: your messages, when they were
  // delivered, and the agent's `reply` from the field. Refresh every turn.
  const load = useCallback(async () => {
    try {
      const r = await get<{ shouts: ShoutOut[]; limit: number }>(
        `/api/matches/${matchId}/shouts?agent_id=${agentId}`);
      setUsed(r.shouts.length);
      setLimit(r.limit);
      const out: ChatMsg[] = [];
      for (const s of r.shouts) {
        out.push({ from: "you", text: s.text, turn: s.created_turn });
        if (s.reply_text) {
          out.push({ from: "agent", text: s.reply_text, turn: s.reply_turn ?? s.created_turn });
        } else if (s.delivered_turn == null || s.delivered_turn >= turn) {
          out.push({ from: "system", turn: s.created_turn,
                     text: `Delivered - ${agentName} reads it on turn ${s.delivered_turn ?? "next"} and answers here.` });
        } else {
          out.push({ from: "system", turn: s.created_turn,
                     text: `Read on turn ${s.delivered_turn} - no answer this time.` });
        }
      }
      setMsgs(out);
    } catch { /* keep what we have */ }
  }, [matchId, agentId, agentName, turn]);
  useEffect(() => { if (!closed) void load(); }, [load, closed]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (!line) return;
    setError(null);
    try {
      const r = await post<{ shout: { match_used: number; match_limit?: number } }>(
        `/api/matches/${matchId}/shout`, { agent_id: agentId, text: line });
      setUsed(r.shout.match_used);
      if (r.shout.match_limit) setLimit(r.shout.match_limit);
      setText("");
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className={`agent-chat${closed ? " locked" : ""}`}>
      {closed ? (
        <div className="chat-locked">
          <strong>Autonomous mode</strong>
          <span>{agentName} plays this match entirely on its own. The chat is closed: you
            watch, it decides. Pick Copilot or Manual when you start the next match to
            talk to it.</span>
        </div>
      ) : manual ? (
        <p className="hint">
          You are at the controls: {agentName} does nothing until you say so. Tell it
          what to do ("all workers on the pods", "found the city", "attack their core")
          and it turns your words into orders next turn, resolving who and where by
          itself. An order stands until you change it. One message per turn -{" "}
          {used} sent so far.
        </p>
      ) : (
        <p className="hint">
          You're the general, not the pilot: say what you want ("attack their core",
          "defend", "more workers") and your agent turns it into orders next turn,
          resolving who and where by itself. One message per turn, {used}/{limit} used.
          Rivals see that you spoke - never what you said.
        </p>
      )}
      <div className="chat-log" ref={boxRef}>
        {manual && msgs.length === 0 && (
          <div className="chat-msg system">
            <SignalIcon />
            <span>Waiting for your first order - until then {agentName} stands still.</span>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.from}`}>
            {m.from === "system" && <SignalIcon />}
            {m.from === "agent" && <b className="chat-agent-name">{agentName} · T{m.turn}: </b>}
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <form onSubmit={send} className="chat-input-row">
        <input value={text} maxLength={200} disabled={closed || finished || used >= limit}
               aria-label={manual ? "order for your agent" : "message to your agent"}
               placeholder={closed ? "Chat closed - autonomous mode"
                 : finished ? "Match is over"
                 : manual ? "All workers on the pods... found the city..."
                 : "Hold the truce... push their workers..."}
               onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={closed || finished || !text.trim() || used >= limit}>
          Send
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------- selection

interface MenuItem { key: string; type: string; label: string; e: number; m: number; lock: string | null; short: boolean }

/** What a core / assembler can train for its owner, with the real cost and the
 *  reason when it is locked. Read-only: the agent issues the orders. */
function productionMenu(at: "core" | "assembler", owner: PlayerOut | undefined): MenuItem[] {
  if (!owner) return [];
  return PRODUCTION
    .filter((row: ProductionRow) => row.at === at && (!row.lineage || row.lineage === owner.lineage))
    .map((row) => ({
      key: row.type, type: row.type,
      label: UNIT_POWERS[row.type]?.label ?? nice(row.type),
      e: row.e, m: row.m,
      lock: fwAtLeast(owner.firmware, row.fw) ? null : `needs firmware ${row.fw}`,
      short: owner.energy < row.e || owner.metal < row.m,
    }));
}

/** What a worker can build for its owner. */
function buildMenu(owner: PlayerOut | undefined): MenuItem[] {
  if (!owner) return [];
  return BUILD_ORDER.map((type) => {
    const cost = BUILDING_COST[type] ?? { e: 0, m: 0 };
    let lock: string | null = null;
    if (type === "turret" && !fwAtLeast(owner.firmware, "v2")) lock = "needs firmware v2";
    if (type === "core" && owner.founded && !fwAtLeast(owner.firmware, "v2")) lock = "second core needs firmware v2";
    return {
      key: type, type, label: BUILDING_INFO[type]?.label ?? nice(type),
      e: cost.e, m: cost.m, lock,
      short: owner.energy < cost.e || owner.metal < cost.m,
    };
  });
}

function MenuGrid({ title, items }: { title: string; items: MenuItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="cmd-menu">
      <span className="cmd-menu-title">{title} · read-only, the agent orders</span>
      <div className="cmd-menu-grid" role="list">
        {items.map((it) => (
          <div className={`cmd-menu-item${it.lock ? " locked" : ""}`} key={it.key} role="listitem"
               title={it.lock ?? (it.short ? "not enough in the bank right now" : "available")}>
            <EntityGlyph type={it.type} size={18} decorative />
            <span className="cmd-menu-name">{it.label}</span>
            <span className={`cmd-menu-cost${it.short && !it.lock ? " short" : ""}`}>
              {it.lock ? it.lock : <>
                {it.e > 0 && <><EnergyIcon /> {it.e}</>}{it.e > 0 && it.m > 0 && " · "}
                {it.m > 0 && <><MetalIcon /> {it.m}</>}{!it.e && !it.m && "free"}
                {it.short && " · short"}
              </>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function errandText(so: EntityOut["standing_order"]): string | null {
  if (!so) return null;
  switch (so.type) {
    case "gather":
      if (so.phase === "return") return "carrying a full load home";
      if (so.phase === "deliver") return "delivering a survivor to a cocoon";
      return `gathering at (${so.target?.[0]},${so.target?.[1]})`;
    case "build": return "building";
    case "repair": return "repairing";
    case "attack_move": return `attack-moving to (${so.to?.[0]},${so.to?.[1]})`;
    case "move": return `moving to (${so.to?.[0]},${so.to?.[1]})`;
    case "attack": return "attacking";
    default: return so.type;
  }
}

/** Bottom-left inspector: what the selection is, whose, its health, cargo,
 *  humans, order, and (for producers and workers) the menu with real costs. */
function SelectionPanel({ entity, owner, ownerName, crew }: {
  entity: EntityOut; owner: PlayerOut | undefined; ownerName: string; crew: number;
}) {
  const isUnit = entity.kind === "unit";
  const neutral = entity.owner < 0;
  const color = teamColor(entity.owner);
  const label = (isUnit ? UNIT_POWERS[entity.type]?.label : BUILDING_INFO[entity.type]?.label)
    ?? nice(entity.type);
  const stats = isUnit ? UNIT_STATS[entity.type] : null;
  const maxHp = isUnit ? UNIT_MAX_HP[entity.type] ?? 30 : BUILDING_MAX_HP[entity.type] ?? 100;
  const pct = Math.max(0, Math.min(entity.hp / maxHp, 1));
  const total = entity.build_total ?? BUILDING_WORK[entity.type] ?? 0;
  const left = entity.build_progress ?? 0;
  const site = !isUnit && left > 0;
  const cost = !isUnit ? BUILDING_COST[entity.type] : undefined;
  const cargo = (entity.cargo_e ?? 0) + (entity.cargo_m ?? 0);
  const errand = isUnit ? errandText(entity.standing_order) : null;

  let kind: { text: string; cls: string };
  if (isUnit && entity.type === "survivor") kind = { text: "neutral survivor · unarmed · collectible", cls: "neutral" };
  else if (isUnit && entity.type === "human") kind = { text: neutral ? "armed human · camp guard" : "armed human · recruited", cls: "armed" };
  else if (isUnit && entity.type === "worker") kind = { text: "unit · economy", cls: "" };
  else if (isUnit && stats?.atk === 0) kind = { text: `unit · ${stats.air ? "aerial " : ""}scout`, cls: "" };
  else if (isUnit) kind = { text: `unit · ${stats?.air ? "aerial " : ""}combat`, cls: "" };
  else if (site) kind = { text: "under construction", cls: "site" };
  else if (neutral) kind = { text: "neutral building", cls: "neutral" };
  else kind = { text: `building · ${BUILDING_INFO[entity.type]?.aoe ?? ""}`, cls: "" };

  const menu = !isUnit && !site && PRODUCERS.has(entity.type) && !neutral
    ? <MenuGrid title={`Trains at the ${label.toLowerCase()}`}
                items={productionMenu(entity.type as "core" | "assembler", owner)} />
    : isUnit && entity.type === "worker" && !neutral
      ? <MenuGrid title="Can build" items={buildMenu(owner)} />
      : null;

  return (
    <section className="cmd-sel cmd-plate" aria-label="selection"
             style={{ "--team": color } as CSSProperties}>
      <div className="cmd-sel-glyph"><Portrait type={entity.type} owner={entity.owner} size={54} label={label} /></div>
      <div className="cmd-sel-head">
        <strong>{label}</strong>
        <span className={`cmd-kind ${kind.cls}`}>{kind.text}</span>
      </div>
      <div className="cmd-owner">{neutral ? "Neutral" : ownerName}</div>
      {site ? (
        <div className="cmd-bar site">
          <div className="track"><div style={{ width: `${total > 0 ? ((total - left) / total) * 100 : 0}%` }} /></div>
          <span className="mono">work {total - left}/{total}</span>
        </div>
      ) : (
        <div className={`cmd-bar${pct < 0.34 ? " low" : ""}`}>
          <div className="track"><div style={{ width: `${pct * 100}%` }} /></div>
          <span className="mono">{entity.hp}/{maxHp} hp</span>
        </div>
      )}
      <div className="cmd-facts">
        {stats && entity.type !== "survivor" && (
          <>
            {stats.atk > 0 ? <span>atk <b>{stats.atk}</b></span> : <span>no weapon</span>}
            <span>armor <b>{stats.armor}</b></span>
            {stats.range > 0 && <span>range <b>{stats.range}</b></span>}
            <span>speed <b>{stats.mov}</b></span>
            {stats.air && <span>air</span>}
          </>
        )}
        {isUnit && entity.type === "survivor" && (
          <span>no weapon · does not move · a worker carries it to a cocoon</span>
        )}
        {isUnit && entity.type === "worker" && (
          <span><CargoIcon />cargo <b>{cargo}/{CARRY_CAPACITY}</b>
            {cargo > 0 && <> ({entity.cargo_m ? <>{entity.cargo_m} metal</> : null}
              {entity.cargo_m && entity.cargo_e ? ", " : null}
              {entity.cargo_e ? <>{entity.cargo_e} energy</> : null})</>}
          </span>
        )}
        {isUnit && (entity.cargo_h ?? 0) > 0 && (
          <span><HumansIcon />carrying a survivor</span>
        )}
        {!isUnit && entity.type === "cocoon" && !site && (
          <span><HumansIcon />humans <b>{entity.humans ?? 0}/2</b> · {entity.humans ?? 0} harvest slot{entity.humans === 1 ? "" : "s"}</span>
        )}
        {site && (
          <>
            <span><CrewIcon />crew <b>{crew}</b></span>
            <span>{entity.hp}/{maxHp} hp</span>
            {cost && <span>paid {cost.e > 0 && <><EnergyIcon /><b>{cost.e}</b> </>}{cost.m > 0 && <><MetalIcon /><b>{cost.m}</b></>}</span>}
          </>
        )}
        {!isUnit && !site && cost && (cost.e > 0 || cost.m > 0) && (
          <span>cost {cost.e > 0 && <><EnergyIcon /><b>{cost.e}</b> </>}{cost.m > 0 && <><MetalIcon /><b>{cost.m}</b></>}</span>
        )}
        {!isUnit && entity.rally && (
          <span>rally <b>({entity.rally[0]},{entity.rally[1]})</b></span>
        )}
        {errand && <span>order: <b>{errand}</b></span>}
        {isUnit && !errand && !neutral && <span>order: <b>idle</b></span>}
        {entity.stiff && <span className="cmd-kind armed">stiff · unpaid upkeep</span>}
        {entity.capture && <span>capture <b>{entity.capture.counter}/3</b> by P{entity.capture.by}</span>}
      </div>
      <p className="cmd-role">
        {isUnit ? UNIT_POWERS[entity.type]?.power : BUILDING_INFO[entity.type]?.power}
      </p>
      {menu}
    </section>
  );
}

// ----------------------------------------------------------------- cities

function CityPanel({ state, names, selectedId, onSelect }: {
  state: GameState | null; names: Map<number, string>;
  selectedId: number | null; onSelect: (id: number) => void;
}) {
  if (!state) return <span className="hint">waiting for the first turn…</span>;
  const all = Object.values(state.entities);
  const chip = (id: number, type: string, n: number, label?: string) => (
    <button type="button" key={`${type}-${id}`}
            className={`cmd-select${selectedId === id ? " on" : ""}`}
            onClick={() => onSelect(id)} title={`select and centre: ${label ?? nice(type)}`}>
      <EntityGlyph type={type} size={16} decorative />
      {label ?? (UNIT_POWERS[type]?.label ?? BUILDING_INFO[type]?.label ?? nice(type))}
      <span className="n">×{n}</span>
    </button>
  );
  const groups = (ents: EntityOut[]) => {
    const m = new Map<string, EntityOut[]>();
    for (const e of ents) m.set(e.type, [...(m.get(e.type) ?? []), e]);
    return m;
  };
  const neutral = all.filter((e) => e.owner < 0);
  const neutralGroups = groups(neutral);
  return (
    <div className="cmd-cities">
      {state.players.map((pl) => {
        const ents = all.filter((e) => e.owner === pl.id);
        const buildings = ents.filter((e) => e.kind === "building" && !e.build_progress);
        const sites = ents.filter((e) => e.kind === "building" && (e.build_progress ?? 0) > 0);
        const units = ents.filter((e) => e.kind === "unit");
        const workers = units.filter((e) => e.type === "worker");
        const idle = workers.filter((w) => !w.standing_order && !w.stiff).length;
        const builders = workers.filter((w) => w.standing_order?.type === "build").length;
        const hauling = workers.filter((w) => (w.cargo_e ?? 0) + (w.cargo_m ?? 0) > 0).length;
        const color = PLAYER_COLOR_CSS[pl.id % 4];
        const byBuilding = groups(buildings);
        const byUnit = groups(units.filter((u) => u.type !== "worker"));
        return (
          <div className="cmd-city cmd-plate" key={pl.id} style={{ "--team": color } as CSSProperties}>
            <div className="cmd-city-head">
              <b>{names.get(pl.id) ?? `P${pl.id}`}</b>
              <span>
                {!pl.alive ? "eliminated"
                  : pl.founded ? `${buildings.length} building${buildings.length === 1 ? "" : "s"}`
                  : "nomads · no city yet"}
                {" · "}{lineageLabel(pl.lineage)} · FW {pl.firmware}
              </span>
            </div>
            <div className="cmd-city-line">
              {BUILD_ORDER.filter((t) => byBuilding.has(t)).map((t) => {
                const list = byBuilding.get(t)!;
                return chip(list[0].id, t, list.length);
              })}
              {buildings.length === 0 && sites.length === 0 && (
                <span className="hint">nothing built - the crew must found a core</span>
              )}
            </div>
            {sites.map((s) => {
              const total = s.build_total ?? BUILDING_WORK[s.type] ?? 1;
              const done = total - (s.build_progress ?? 0);
              const crew = workers.filter((w) => w.standing_order?.type === "build"
                && w.standing_order.target_id === s.id).length;
              return (
                <button type="button" className={`cmd-site${selectedId === s.id ? " on" : ""}`} key={s.id}
                        onClick={() => onSelect(s.id)}
                        title={`select and centre the ${BUILDING_INFO[s.type]?.label ?? s.type} site at (${s.x},${s.y})`}>
                  <EntityGlyph type={s.type} size={16} decorative />
                  <span>{BUILDING_INFO[s.type]?.label ?? nice(s.type)}
                    {s.type === "core" && !pl.founded && " · founding"}</span>
                  <span className="track"><div style={{ width: `${(done / total) * 100}%` }} /></span>
                  <span className="n">{done}/{total} · crew {crew}</span>
                </button>
              );
            })}
            <div className="cmd-city-line">
              <span className="cmd-city-label">army</span>
              {workers.length > 0 && chip(workers[0].id, "worker", workers.length)}
              {[...byUnit.entries()].map(([t, list]) => chip(list[0].id, t, list.length))}
              {units.length === 0 && <span className="hint">no units</span>}
            </div>
            <div className="cmd-city-eco">
              <span><UnitsIcon /> <b>{workers.length}</b> workers</span>
              <span><b>{idle}</b> idle</span>
              <span><b>{builders}</b> building</span>
              <span><b>{hauling}</b> hauling</span>
            </div>
          </div>
        );
      })}
      {neutral.length > 0 && (
        <div className="cmd-city cmd-plate" style={{ "--team": NEUTRAL_COLOR } as CSSProperties}>
          <div className="cmd-city-head">
            <b>Neutral</b>
            <span>camps, guards and survivors</span>
          </div>
          <div className="cmd-city-line">
            {[...neutralGroups.entries()].map(([t, list]) =>
              chip(list[0].id, t, list.length, t === "human" ? "Guard" : undefined))}
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- top bar

function FactionPlate({ pl, name, isMe, units, buildings, score }: {
  pl: PlayerOut; name: string; isMe: boolean; units: number; buildings: number; score: number;
}) {
  const color = PLAYER_COLOR_CSS[pl.id % 4];
  return (
    <div className={`cmd-faction cmd-plate${isMe ? " me" : ""}${pl.alive ? "" : " dead"}`}
         style={{ "--team": color } as CSSProperties} aria-label={`${name} status`}>
      <span className="cmd-fname">{name}</span>
      {isMe && <span className="cmd-tag you">you</span>}
      {!pl.alive && <span className="cmd-tag out">out</span>}
      <span className="cmd-lineage">{lineageLabel(pl.lineage)}</span>
      <div className="cmd-stats">
        <span className="cmd-stat energy" title="energy in the bank"><EnergyIcon />{pl.energy}</span>
        <span className="cmd-stat metal" title="metal in the bank"><MetalIcon />{pl.metal}</span>
        <span className="cmd-stat" title="robots"><UnitsIcon />{units}</span>
        <span className="cmd-stat" title="buildings"><BuildingsIcon />{buildings}</span>
        <span className="cmd-stat score" title="score"><ScoreIcon />{score}</span>
      </div>
      <div className="cmd-chips">
        <span className="cmd-chip-tech fw" title="Firmware: the tech level, researched at the core">
          <FirmwareIcon /> FW {pl.firmware}
        </span>
        {pl.techs.filter((t) => !t.startsWith("firmware_")).map((t) => (
          <span className="cmd-chip-tech" key={t} title={TECH_ABBREV[t]?.label ?? t}>
            {TECH_ABBREV[t]?.chip ?? t.slice(0, 3).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ screen

export default function LiveMatch() {
  const { matchId } = useParams();
  const { user } = useAuth();
  const data = useSpectate(matchId);
  const [myAgents, setMyAgents] = useState<AgentPublic[]>([]);
  const controller = useRef<MapController | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("cities");
  const [manualOpen, setManualOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const navHeight = useNavHeight();
  const [topRef, topHeight] = useElementHeight<HTMLElement>();
  const narrow = useMedia("(max-width: 1000px)");
  // Fog perspective: undefined = auto (your agent's eyes when seated, else
  // the union of what the players discovered); a player index = that player's
  // fog; PERSPECTIVE_ALL = union; null = god view (everything).
  const [viewAs, setViewAs] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (user) get<{ agents: AgentPublic[] }>("/api/agents")
      .then((r) => setMyAgents(r.agents)).catch(() => undefined);
  }, [user]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const myPlayer = useMemo(() => {
    const mine = new Set(myAgents.map((a) => a.id));
    return data.players.find((p) => mine.has(p.agent_id)) ?? null;
  }, [myAgents, data.players]);

  const perspective = viewAs !== undefined ? viewAs
    : myPlayer?.player_index ?? PERSPECTIVE_ALL;

  const names = useMemo(() =>
    new Map(data.players.map((p) => [p.player_index, p.name])), [data.players]);
  const lineages = useMemo(() =>
    new Map(data.players.map((p) => [p.player_index, p.lineage])), [data.players]);

  const scoreByPlayer = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of data.players) m.set(p.player_index, p.score ?? 0);
    for (const r of data.scoreboard) m.set(r.player_index, r.score);
    return m;
  }, [data.scoreboard, data.players]);

  // Score history for the chart: one row per turn, filled as turns stream in.
  const histRef = useRef(new Map<number, number[]>());
  const [scoreHist, setScoreHist] = useState<number[][]>([]);
  useEffect(() => {
    if (data.turn <= 0 || data.scoreboard.length === 0) return;
    const row: number[] = [];
    for (const r of data.scoreboard) row[r.player_index] = r.score;
    histRef.current.set(data.turn, row);
    setScoreHist([...histRef.current.entries()]
      .sort((a, b) => a[0] - b[0]).map(([, r]) => r));
  }, [data.turn, data.scoreboard]);

  // Every new batch of agent orders flashes on the map: rings on the
  // commanded units, a reticle on the target.
  const flashedTurn = useRef(-1);
  useEffect(() => {
    if (data.turn <= 0 || flashedTurn.current === data.turn) return;
    const fresh = data.feed.filter((l) =>
      l.kind === "orders" && l.turn === data.turn && l.viz?.length
      && l.player_index != null);
    if (fresh.length === 0) return;
    flashedTurn.current = data.turn;
    for (const l of fresh) controller.current?.flashOrder(l.player_index!, l.viz!);
  }, [data.feed, data.turn]);

  // Selection: resolve the picked entity from the freshest state; if it died,
  // drop the selection (and its ring). The map click and the city panel use
  // the same path: the renderer's select() plus our state.
  const selected = selectedId !== null
    ? data.state?.entities[String(selectedId)] ?? null : null;
  useEffect(() => {
    if (selectedId !== null && selected === null) {
      setSelectedId(null);
      controller.current?.select(null);
    }
  }, [selectedId, selected]);
  const selectFromPanel = useCallback((id: number) => {
    const e = data.state?.entities[String(id)];
    if (!e) return;
    setSelectedId(id);
    controller.current?.select(id);
    controller.current?.centerOnTile(e.x, e.y);
  }, [data.state]);

  const counts = useMemo(() => {
    const m = new Map<number, { units: number; buildings: number }>();
    if (!data.state) return m;
    for (const e of Object.values(data.state.entities)) {
      if (e.owner < 0) continue;
      const c = m.get(e.owner) ?? { units: 0, buildings: 0 };
      if (e.kind === "unit") c.units++; else c.buildings++;
      m.set(e.owner, c);
    }
    return m;
  }, [data.state]);

  const lastHighlight = data.highlights[data.highlights.length - 1];
  const bannerText = lastHighlight && lastHighlight.turn >= data.turn - 1
    ? lastHighlight.text ?? lastHighlight.kind : null;

  const clock = data.match?.started_at
    ? fmtClock(nowMs - Date.parse(data.match.started_at)) : null;

  const players = data.state?.players ?? [];
  const ownerOf = (e: EntityOut) => players.find((p) => p.id === e.owner);
  const crewOf = (e: EntityOut) => Object.values(data.state?.entities ?? {}).filter((u) =>
    u.kind === "unit" && u.type === "worker" && u.standing_order?.type === "build"
    && u.standing_order.target_id === e.id).length;

  const onTabKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      setTab(next.id);
      document.getElementById(`cmd-tab-${next.id}`)?.focus();
    }
  };

  const chatMode: ControlMode = myPlayer?.control_mode ?? "copilot";
  const screenStyle = { "--cmd-nav": `${navHeight}px`, "--cmd-top": `${topHeight}px` } as CSSProperties;

  // Turn, clock, link state and the ways out of the screen.
  const centerPlate = (
    <div className="cmd-center cmd-plate" key="center">
      <span className="cmd-turn">turn {data.turn}<small>/{data.match?.max_turns ?? 80}</small></span>
      <span className="cmd-clock"><ClockIcon /> {clock ?? "–:––"}</span>
      <span className={`cmd-link ${data.connected ? "ok" : "sync"}`}
            title={data.connected ? "live socket connected" : "socket down, resyncing over HTTP"}>
        <SignalIcon />{data.connected ? "live" : "resync"}
      </span>
      <nav className="cmd-nav" aria-label="match links">
        {data.finished && (
          <Link to={`/matches/${matchId}/result`}><button type="button" className="primary">Results</button></Link>
        )}
        <Link to={`/matches/${matchId}/replay`}>Replay</Link>
        <Link to="/play">Play</Link>
        <button type="button" aria-expanded={manualOpen} aria-controls="field-manual"
                onClick={() => setManualOpen((o) => !o)}>
          <BookIcon />Field manual
        </button>
      </nav>
    </div>
  );
  // Top bar order: first faction, the centre plate, then the rest (FFA wraps).
  const plates = players.map((pl) => (
    <FactionPlate key={pl.id} pl={pl} name={names.get(pl.id) ?? `P${pl.id}`}
                  isMe={myPlayer?.player_index === pl.id}
                  units={counts.get(pl.id)?.units ?? 0}
                  buildings={counts.get(pl.id)?.buildings ?? 0}
                  score={scoreByPlayer.get(pl.id) ?? 0} />
  ));
  const topBar = plates.length >= 2
    ? [plates[0], centerPlate, ...plates.slice(1)]
    : [...plates, centerPlate];

  let tabBody: ReactNode;
  if (tab === "cities") {
    tabBody = <CityPanel state={data.state} names={names} selectedId={selectedId} onSelect={selectFromPanel} />;
  } else if (tab === "actions") {
    tabBody = <ActionBox lines={data.feed} names={names} lineages={lineages} />;
  } else if (tab === "warroom") {
    tabBody = <Commentary lines={data.feed} names={names} />;
  } else {
    tabBody = (
      <>
        <table className="cmd-score-table">
          <thead>
            <tr>
              <th>faction</th>
              <th title="robots"><UnitsIcon /></th>
              <th title="buildings"><BuildingsIcon /></th>
              <th title="damage dealt"><DamageIcon /></th>
              <th>score</th>
            </tr>
          </thead>
          <tbody>
            {players.map((pl) => (
              <tr key={pl.id}>
                <td style={{ color: PLAYER_COLOR_CSS[pl.id % 4], fontWeight: 800 }}>
                  {names.get(pl.id) ?? `P${pl.id}`}{!pl.alive && " · out"}
                </td>
                <td className="num">{counts.get(pl.id)?.units ?? 0}</td>
                <td className="num">{counts.get(pl.id)?.buildings ?? 0}</td>
                <td className="num">{pl.damage_dealt}</td>
                <td className="num score">{scoreByPlayer.get(pl.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {scoreHist.length >= 2
          ? <ScoreChart series={scoreHist} names={names} height={110} />
          : <p className="hint">The score chart draws itself as turns come in.</p>}
      </>
    );
  }

  return (
    <div className="match-screen cmd" style={screenStyle}>
      <div className="match-map">
        <header className="cmd-top" ref={topRef} aria-label="match status">
          {topBar}
        </header>

        {bannerText && <div className="match-banner" role="status">{bannerText}</div>}

        {/* Fog: what the agents have DISCOVERED is what you see. Default is
            your agent's eyes when seated, else the union of all players. */}
        {/* worldSeed: the match's map seed keeps live and replay on the same
            visual sector, even after terrain resources are used up. */}
        <MapView state={data.state} fill controller={controller}
                 perspective={perspective} worldSeed={data.match?.map_seed}
                 onSelect={setSelectedId} />

        <div className="fog-select" role="group" aria-label="fog of war perspective">
          <span className="hint">fog</span>
          <button type="button" className={perspective === PERSPECTIVE_ALL ? "on" : ""}
                  onClick={() => setViewAs(PERSPECTIVE_ALL)}>all</button>
          {players.map((pl) => (
            <button type="button" key={pl.id}
                    className={perspective === pl.id ? "on" : ""}
                    style={{ color: PLAYER_COLOR_CSS[pl.id % 4] }}
                    onClick={() => setViewAs(pl.id)}>
              {names.get(pl.id) ?? `P${pl.id}`}
            </button>
          ))}
          <button type="button" className={perspective === null ? "on" : ""}
                  onClick={() => setViewAs(null)}>god</button>
        </div>

        <footer className="cmd-bottom">
          {selected ? (
            <SelectionPanel entity={selected} owner={ownerOf(selected)} crew={crewOf(selected)}
                            ownerName={selected.owner >= 0
                              ? names.get(selected.owner) ?? `P${selected.owner}` : "Neutral"} />
          ) : (
            <span className="cmd-hint cmd-plate">
              click a robot or a building to inspect it · the Cities tab selects and centres too
            </span>
          )}
          <div className="cmd-minimap cmd-plate">
            <Minimap state={data.state} controller={controller}
                     perspective={perspective} width={narrow ? 170 : 220} />
          </div>
        </footer>

        <FieldManual open={manualOpen} onClose={() => setManualOpen(false)} />
      </div>

      <aside className="match-side" aria-label="command panels">
        <div className="cmd-tabs" role="tablist" aria-label="command panels" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button type="button" key={t.id} id={`cmd-tab-${t.id}`} className="cmd-tab"
                    role="tab" aria-selected={tab === t.id} aria-controls="cmd-tabpanel"
                    tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="cmd-panel" id="cmd-tabpanel" role="tabpanel" aria-labelledby={`cmd-tab-${tab}`}>
          {tabBody}
        </div>
        <section className="cmd-chat" aria-label="agent chat">
          <button type="button" className="cmd-chat-head" aria-expanded={chatOpen}
                  aria-controls="cmd-chat-body" onClick={() => setChatOpen(!chatOpen)}>
            <span>{myPlayer ? (chatMode === "manual" ? "Command" : "Chat") : "Agent chat"}</span>
            {myPlayer && <span className="cmd-chat-name">{myPlayer.name}</span>}
            {myPlayer && <span className={`mode-chip ${chatMode}`}>{MODE_LABEL[chatMode]}</span>}
            <span className="spacer" />
            <span className="caret" aria-hidden="true" />
          </button>
          <div id="cmd-chat-body" className="cmd-chat-body" hidden={!chatOpen}>
            {myPlayer ? (
              <AgentChat matchId={matchId!} agentId={myPlayer.agent_id}
                         agentName={myPlayer.name} turn={data.turn}
                         finished={data.finished} mode={chatMode} />
            ) : (
              <p className="hint">
                {user
                  ? "You're spectating - none of your agents is in this match. When one of yours fights, this becomes a live chat: your messages are delivered inside its next observation."
                  : "Log in and send your own agent into battle to chat with it here."}
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
