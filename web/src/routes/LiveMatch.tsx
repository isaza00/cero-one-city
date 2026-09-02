// Screen 8: live match with classic-RTS chrome (AoE2 as the blueprint):
//  - fullscreen isometric map (drag to pan, click to inspect, no wheel zoom)
//  - top bar: per-player resource blocks with tech ("upgrades") rows at the
//    edges, and a center plate: names, lineage, score, turn and match clock
//  - bottom bar: selected-unit card (left), DIAMOND minimap (center),
//    per-player stats table (right)
//  - right panel: score chart, chat with YOUR agent, war-room commentary.

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic, EntityOut, GameState, PlayerOut } from "../api/types";
import ActionBox from "../components/ActionBox";
import { Commentary } from "../components/bits";
import {
  BuildingsIcon, ClockIcon, DamageIcon, EnergyIcon, MetalIcon, UnitsIcon,
} from "../components/icons";
import Minimap from "../components/Minimap";
import LineageAvatar from "../components/LineageAvatar";
import ScoreChart from "../components/ScoreChart";
import {
  BUILD_ORDER, BUILDING_INFO, BUILDING_MAX_HP, BUILDING_WORK, PLAYER_COLOR_CSS,
  TECH_ABBREV, UNIT_MAX_HP, UNIT_POWERS, UNIT_STATS, lineageLabel,
} from "../game/meta";
import { buildingDataURL, tintForIndex } from "../game/dompack";
import { PERSPECTIVE_ALL } from "../game/vision";
import MapView, { MapController } from "../pixi/MapView";
import { useAuth } from "../store/auth";
import { useSpectate } from "../ws/useSpectate";

interface ChatMsg { from: "you" | "system"; text: string; turn: number }

function AgentChat({ matchId, agentId, agentName, turn, finished }: {
  matchId: string; agentId: string; agentName: string; turn: number; finished: boolean;
}) {
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [used, setUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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
      const r = await post<{ shout: { match_used: number } }>(
        `/api/matches/${matchId}/shout`, { agent_id: agentId, text: line });
      setUsed(r.shout.match_used);
      setMsgs((m) => [...m,
        { from: "you", text: line, turn },
        { from: "system",
          text: `Delivered. ${agentName} reads this next turn and decides on its own.`,
          turn }]);
      setText("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="side-section agent-chat">
      <h3>Talk to {agentName} <span className="hint">({used}/6)</span></h3>
      <p className="hint">
        You're the coach, not the pilot: your agent hears you, then does what IT
        thinks is best. One message per turn. Rivals see that you spoke - never
        what you said.
      </p>
      <div className="chat-log" ref={boxRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.from}`}>
            {m.from === "system" && <span className="chat-sys-icon">📡 </span>}
            {m.text}
          </div>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <form onSubmit={send} className="chat-input-row">
        <input value={text} maxLength={200} disabled={finished || used >= 6}
               placeholder={finished ? "Match is over"
                 : "Hold the truce... push their workers..."}
               onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={finished || !text.trim() || used >= 6}>
          Send
        </button>
      </form>
    </div>
  );
}

function BuildingPortrait({ type, owner, size }: {
  type: string; owner: number; size: number;
}) {
  const url = useMemo(() => buildingDataURL(type, tintForIndex(owner)),
                      [type, owner]);
  if (!url) return <span className="lineage-avatar" style={{ width: size, height: size }} />;
  return <img src={url} width={size} height={size} className="lineage-avatar"
              style={{ imageRendering: "pixelated" }} alt={type} />;
}

/** Bottom-left inspector: the clicked robot/building, its hp, stats and power
 * - and, AoE2-style, what it is doing: a foundation shows its work and crew, a
 * worker shows its cargo and errand. */
function UnitCard({ entity, name, lineage, crew }: {
  entity: EntityOut; name: string; lineage: string; crew: number;
}) {
  const isUnit = entity.kind === "unit";
  const stats = isUnit ? UNIT_STATS[entity.type] : null;
  const info = isUnit ? UNIT_POWERS[entity.type] : BUILDING_INFO[entity.type];
  const aoe = isUnit ? null : BUILDING_INFO[entity.type]?.aoe;
  const maxHp = isUnit ? UNIT_MAX_HP[entity.type] ?? 30
                       : BUILDING_MAX_HP[entity.type] ?? 100;
  const pct = Math.max(0, Math.min(entity.hp / maxHp, 1));
  const total = entity.build_total ?? BUILDING_WORK[entity.type] ?? 0;
  const left = entity.build_progress ?? 0;
  const so = entity.standing_order;
  const cargo = (entity.cargo_e ?? 0) + (entity.cargo_m ?? 0);
  let errand: string | null = null;
  if (isUnit && so) {
    if (so.type === "gather") {
      errand = so.phase === "return" ? "carrying a full load home"
        : `gathering at (${so.target?.[0]},${so.target?.[1]})`;
    } else if (so.type === "build") errand = "building";
    else if (so.type === "repair") errand = "repairing";
    else if (so.type === "attack_move") errand = `attack-moving to (${so.to?.[0]},${so.to?.[1]})`;
    else if (so.type === "move") errand = `moving to (${so.to?.[0]},${so.to?.[1]})`;
    else if (so.type === "attack") errand = "attacking";
    else errand = so.type;
  }
  return (
    <div className="hud-unitcard">
      {isUnit
        ? <LineageAvatar lineage={lineage} unit={entity.type} size={88} />
        : <BuildingPortrait type={entity.type} owner={entity.owner} size={88} />}
      <div className="hud-unitcard-body">
        <strong>
          {info?.label ?? entity.type.replace(/_/g, " ")}
          {aoe && <span className="hud-aoe"> · {aoe}</span>}
          {left > 0 && <span className="hud-site-tag"> under construction</span>}
        </strong>
        <span className="hint" style={{
          color: entity.owner >= 0 ? PLAYER_COLOR_CSS[entity.owner % 4] : undefined }}>
          {name}
        </span>
        {left > 0 ? (
          <>
            <div className="progress hud-hp site">
              <div style={{ width: `${total > 0 ? ((total - left) / total) * 100 : 0}%` }} />
            </div>
            <span className="hint mono">
              work {total - left}/{total} · {crew} builder{crew === 1 ? "" : "s"}
              {" · "}{entity.hp}/{maxHp} hp
            </span>
          </>
        ) : (
          <>
            <div className="progress hud-hp">
              <div style={{ width: `${pct * 100}%` }} />
            </div>
            <span className="hint mono">{entity.hp}/{maxHp} hp
              {stats && <>
                {"  ·  ATK "}{stats.atk}{"  ARM "}{stats.armor}
                {"  RNG "}{stats.range}{"  SPD "}{stats.mov}{stats.air ? "  AIR" : ""}
              </>}
            </span>
          </>
        )}
        {isUnit && (cargo > 0 || errand) && (
          <span className="hint hud-errand">
            {cargo > 0 && <>
              carrying {entity.cargo_m ? <><MetalIcon /> {entity.cargo_m}</> : null}
              {entity.cargo_e ? <> <EnergyIcon /> {entity.cargo_e}</> : null}
              {errand ? " · " : ""}
            </>}
            {errand}
          </span>
        )}
        {info && <p className="hint hud-power">{info.power}</p>}
      </div>
    </div>
  );
}

/** Side panel: every player's city as an AoE2 build panel - what stands, what
 * is under construction (crew + progress), and the crew's employment. This is
 * where the agents' build decisions become visible. */
function CityPanel({ state, names }: { state: GameState | null; names: Map<number, string> }) {
  if (!state) return <span className="hint">waiting for the first turn…</span>;
  return (
    <div className="city-panel">
      {state.players.map((pl) => {
        const ents = Object.values(state.entities).filter((e) => e.owner === pl.id);
        const counts = new Map<string, number>();
        const sites: EntityOut[] = [];
        for (const e of ents) {
          if (e.kind !== "building") continue;
          if (e.build_progress) sites.push(e);
          else counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
        }
        const workers = ents.filter((e) => e.kind === "unit" && e.type === "worker");
        const idle = workers.filter((w) => !w.standing_order && !w.stiff).length;
        const builders = workers.filter((w) => w.standing_order?.type === "build").length;
        const hauling = workers.filter((w) => (w.cargo_e ?? 0) + (w.cargo_m ?? 0) > 0).length;
        const standing = [...counts.values()].reduce((a, b) => a + b, 0);
        const color = PLAYER_COLOR_CSS[pl.id % 4];
        return (
          <div className="city-row" key={pl.id} style={{ borderLeftColor: color }}>
            <div className="city-head">
              <b style={{ color }}>{names.get(pl.id) ?? `P${pl.id}`}</b>
              <span className="hint">
                {!pl.alive ? "eliminated"
                  : pl.founded ? `${standing} building${standing === 1 ? "" : "s"}`
                  : "nomads · no city yet"}
              </span>
            </div>
            <div className="city-buildings">
              {BUILD_ORDER.map((t) => {
                const n = counts.get(t) ?? 0;
                if (!n) return null;
                return (
                  <span className="city-b" key={t}
                        title={`${BUILDING_INFO[t].label} (${BUILDING_INFO[t].aoe})`}>
                    <BuildingPortrait type={t} owner={pl.id} size={40} />
                    <span className="city-count mono">×{n}</span>
                  </span>
                );
              })}
              {standing === 0 && sites.length === 0 && (
                <span className="hint">— nothing built —</span>
              )}
            </div>
            {sites.map((s) => {
              const total = s.build_total ?? BUILDING_WORK[s.type] ?? 1;
              const done = total - (s.build_progress ?? 0);
              const crew = workers.filter((w) => w.standing_order?.type === "build"
                && w.standing_order.target_id === s.id).length;
              return (
                <div className="city-site" key={s.id}
                     title={`${BUILDING_INFO[s.type]?.label} at (${s.x},${s.y})`}>
                  <BuildingPortrait type={s.type} owner={pl.id} size={32} />
                  <span className="city-site-name">
                    {BUILDING_INFO[s.type]?.label ?? s.type}
                    {s.type === "core" && !pl.founded && <span className="hud-site-tag"> founding</span>}
                  </span>
                  <div className="progress city-bar"><div style={{ width: `${(done / total) * 100}%` }} /></div>
                  <span className="mono hint">{done}/{total} · {crew}👷</span>
                </div>
              );
            })}
            <div className="city-eco hint">
              <UnitsIcon /> {workers.length} workers · {idle} idle · {builders} building · {hauling} hauling
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Top-bar block: one player's resources + researched-tech chips (the "guns"). */
function PlayerBlock({ pl, name, units, buildings, right, isMe }: {
  pl: PlayerOut; name: string; units: number; buildings: number; right?: boolean;
  isMe?: boolean;
}) {
  const color = PLAYER_COLOR_CSS[pl.id % 4];
  return (
    <div className={`hud-block ${right ? "right" : ""}${isMe ? " mine" : ""}`}
         style={{ borderColor: color,
                  background: `linear-gradient(180deg, ${color}24, rgba(8,11,18,0.86) 60%)`,
                  boxShadow: isMe ? `0 0 0 1px ${color}, 0 0 14px ${color}66` : undefined }}>
      <div className="hud-res-row">
        <span className="hud-swatch" style={{ background: color }} />
        <span className="hud-name" style={{ color }}>{name}</span>
        {isMe && <span className="hud-you">YOU</span>}
        {!pl.alive && <span className="hud-dead">OUT</span>}
        <span className="hud-res energy" title="energy"><EnergyIcon />{pl.energy}</span>
        <span className="hud-res metal" title="metal"><MetalIcon />{pl.metal}</span>
        <span className="hud-res robots" title="robots"><UnitsIcon />{units}</span>
        <span className="hud-res builds" title="buildings"><BuildingsIcon />{buildings}</span>
      </div>
      <div className="hud-tech-row">
        <span className="tech-chip fw"
              title="Firmware - the agent's tech level. Upgrading it at the core unlocks stronger units.">
          FW {pl.firmware}
        </span>
        {pl.techs.filter((t) => !t.startsWith("firmware_")).map((t) => (
          <span className="tech-chip" key={t} title={TECH_ABBREV[t]?.label ?? t}>
            {TECH_ABBREV[t]?.chip ?? t.slice(0, 3).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function LiveMatch() {
  const { matchId } = useParams();
  const { user } = useAuth();
  const data = useSpectate(matchId);
  const [myAgents, setMyAgents] = useState<AgentPublic[]>([]);
  const controller = useRef<MapController | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
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

  // Resolved fog perspective for both the main map and the minimap.
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

  // Score history for the live chart: one row per turn, filled as turns stream in.
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
  // drop the selection (and its ring).
  const selected = selectedId !== null
    ? data.state?.entities[String(selectedId)] ?? null : null;
  useEffect(() => {
    if (selectedId !== null && selected === null) {
      setSelectedId(null);
      controller.current?.select(null);
    }
  }, [selectedId, selected]);

  // Army counts per player ("characters remaining").
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

  const selLineage = selected && selected.owner >= 0
    ? lineages.get(selected.owner) ?? "neutral" : "neutral";

  const players = data.state?.players ?? [];
  const p0 = players[0];
  const p1 = players[1];
  const extra = players.slice(2);

  return (
    <div className="match-screen">
      <div className="match-map">

        <div className="hud-topbar">
          {p0 && <PlayerBlock pl={p0} name={names.get(p0.id) ?? "P0"}
                              isMe={myPlayer?.player_index === p0.id}
                              units={counts.get(p0.id)?.units ?? 0}
                              buildings={counts.get(p0.id)?.buildings ?? 0} />}
          <div className={`hud-plate ${players.length > 2 ? "inline" : ""}`}>
            {p0 && (
              <div className="plate-side">
                <span className="plate-name" style={{ color: PLAYER_COLOR_CSS[0] }}>
                  {names.get(0) ?? "P0"}
                  {myPlayer?.player_index === 0 && <span className="hud-you">YOU</span>}
                </span>
                <span className="plate-lineage">{lineageLabel(lineages.get(0) ?? "")}</span>
              </div>
            )}
            <span className="plate-score">{scoreByPlayer.get(0) ?? 0}</span>
            <div className="plate-mid">
              <span className="mono plate-turn">turn {data.turn}/{data.match?.max_turns ?? 40}</span>
              <span className="mono plate-clock">
                <ClockIcon /> {clock ?? "–:––"}
                {data.connected
                  ? <span className="badge ok">live</span>
                  : <span className="badge warn">sync</span>}
              </span>
              <span className="plate-links">
                {data.finished && <Link to={`/matches/${matchId}/result`}>results</Link>}
                <Link to={`/matches/${matchId}/replay`}>replay</Link>
              </span>
            </div>
            <span className="plate-score">{scoreByPlayer.get(1) ?? 0}</span>
            {p1 && (
              <div className="plate-side right">
                <span className="plate-name" style={{ color: PLAYER_COLOR_CSS[1] }}>
                  {names.get(1) ?? "P1"}
                  {myPlayer?.player_index === 1 && <span className="hud-you">YOU</span>}
                </span>
                <span className="plate-lineage">{lineageLabel(lineages.get(1) ?? "")}</span>
              </div>
            )}
            {players.length === 2 && (() => {
              const a = scoreByPlayer.get(0) ?? 0, b = scoreByPlayer.get(1) ?? 0;
              const pct = a + b > 0 ? (a / (a + b)) * 100 : 50;
              return <div className="plate-vs" aria-hidden>
                <div style={{ width: `${pct}%`, background: PLAYER_COLOR_CSS[0] }} />
                <div style={{ width: `${100 - pct}%`, background: PLAYER_COLOR_CSS[1] }} />
              </div>;
            })()}
          </div>
          {p1 && <PlayerBlock pl={p1} name={names.get(p1.id) ?? "P1"} right
                              isMe={myPlayer?.player_index === p1.id}
                              units={counts.get(p1.id)?.units ?? 0}
                              buildings={counts.get(p1.id)?.buildings ?? 0} />}
          {extra.map((pl) => (
            <PlayerBlock key={pl.id} pl={pl} name={names.get(pl.id) ?? `P${pl.id}`}
                         isMe={myPlayer?.player_index === pl.id}
                         units={counts.get(pl.id)?.units ?? 0}
                         buildings={counts.get(pl.id)?.buildings ?? 0} />
          ))}
        </div>

        {bannerText && <div className="match-banner">{bannerText}</div>}

        {/* Fog: what the agents have DISCOVERED is what you see. Default is
            your agent's eyes when seated, else the union of all players. */}
        <MapView state={data.state} fill controller={controller}
                 perspective={perspective}
                 onSelect={setSelectedId} />

        <div className="fog-select">
          <span className="hint">fog</span>
          <button className={perspective === PERSPECTIVE_ALL ? "on" : ""}
                  onClick={() => setViewAs(PERSPECTIVE_ALL)}>all</button>
          {players.map((pl) => (
            <button key={pl.id}
                    className={perspective === pl.id ? "on" : ""}
                    style={{ color: PLAYER_COLOR_CSS[pl.id % 4] }}
                    onClick={() => setViewAs(pl.id)}>
              {names.get(pl.id) ?? `P${pl.id}`}
            </button>
          ))}
          <button className={perspective === null ? "on" : ""}
                  onClick={() => setViewAs(null)}>god</button>
        </div>

        <div className="hud-bottombar">
          <div className="bottom-left">
            {selected ? (
              <UnitCard entity={selected} lineage={selLineage}
                        crew={Object.values(data.state?.entities ?? {}).filter((u) =>
                          u.kind === "unit" && u.type === "worker"
                          && u.standing_order?.type === "build"
                          && u.standing_order.target_id === selected.id).length}
                        name={selected.owner >= 0
                          ? names.get(selected.owner) ?? `P${selected.owner}`
                          : "the wasteland"} />
            ) : (
              <span className="hud-hint hint">
                click a robot to inspect it · wheel to zoom · minimap to move
              </span>
            )}
          </div>
          <div className="bottom-center">
            <table className="hud-stats-table">
              <thead>
                <tr>
                  <th></th>
                  <th title="robots"><UnitsIcon /></th>
                  <th title="buildings"><BuildingsIcon /></th>
                  <th title="damage dealt"><DamageIcon /></th>
                  <th>score</th>
                </tr>
              </thead>
              <tbody>
                {players.map((pl) => (
                  <tr key={pl.id}>
                    <td style={{ color: PLAYER_COLOR_CSS[pl.id % 4] }}>
                      {names.get(pl.id) ?? `P${pl.id}`}
                    </td>
                    <td className="mono">{counts.get(pl.id)?.units ?? 0}</td>
                    <td className="mono">{counts.get(pl.id)?.buildings ?? 0}</td>
                    <td className="mono">{pl.damage_dealt}</td>
                    <td className="mono score">{scoreByPlayer.get(pl.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bottom-right">
            <div className="minimap-box">
              <Minimap state={data.state} controller={controller}
                       perspective={perspective} width={230} />
            </div>
          </div>
        </div>
      </div>

      <aside className="match-side">
        {scoreHist.length >= 2 && (
          <div className="side-section">
            <h3>Score over time</h3>
            <ScoreChart series={scoreHist} names={names} height={110} />
          </div>
        )}
        <div className="side-section">
          <h3>Cities <span className="hint">what each agent has built</span></h3>
          <CityPanel state={data.state} names={names} />
        </div>
        <div className="side-section">
          <h3>Actions</h3>
          <ActionBox lines={data.feed} names={names} lineages={lineages} />
        </div>
        {myPlayer ? (
          <AgentChat matchId={matchId!} agentId={myPlayer.agent_id}
                     agentName={myPlayer.name} turn={data.turn}
                     finished={data.finished} />
        ) : (
          <div className="side-section">
            <h3>Agent chat</h3>
            <p className="hint">
              {user
                ? "You're spectating - none of your agents is in this match. When one of yours fights (hosted or remote), this becomes a live chat: your instructions are delivered inside its next observation."
                : "Log in and send your own agent into battle to chat with it here."}
            </p>
          </div>
        )}
        <div className="side-section side-fill">
          <h3>War room</h3>
          <Commentary lines={data.feed} names={names} />
        </div>
      </aside>
    </div>
  );
}
