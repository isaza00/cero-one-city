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
import type { AgentPublic, EntityOut, PlayerOut } from "../api/types";
import { Commentary } from "../components/bits";
import {
  BuildingsIcon, ClockIcon, DamageIcon, EnergyIcon, MetalIcon, UnitsIcon,
} from "../components/icons";
import Minimap from "../components/Minimap";
import LineageAvatar from "../components/LineageAvatar";
import ScoreChart from "../components/ScoreChart";
import {
  BUILDING_INFO, BUILDING_MAX_HP, PLAYER_COLOR_CSS, TECH_ABBREV, UNIT_MAX_HP,
  UNIT_POWERS, UNIT_STATS, lineageLabel,
} from "../game/meta";
import { buildingDataURL, tintForIndex } from "../game/dompack";
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

/** Bottom-left inspector: the clicked robot/building, its hp, stats and power. */
function UnitCard({ entity, name, lineage }: {
  entity: EntityOut; name: string; lineage: string;
}) {
  const isUnit = entity.kind === "unit";
  const stats = isUnit ? UNIT_STATS[entity.type] : null;
  const info = isUnit ? UNIT_POWERS[entity.type] : BUILDING_INFO[entity.type];
  const maxHp = isUnit ? UNIT_MAX_HP[entity.type] ?? 30
                       : BUILDING_MAX_HP[entity.type] ?? 100;
  const pct = Math.max(0, Math.min(entity.hp / maxHp, 1));
  return (
    <div className="hud-unitcard">
      {isUnit
        ? <LineageAvatar lineage={lineage} unit={entity.type} size={62} />
        : <BuildingPortrait type={entity.type} owner={entity.owner} size={62} />}
      <div className="hud-unitcard-body">
        <strong>{info?.label ?? entity.type.replace(/_/g, " ")}</strong>
        <span className="hint" style={{
          color: entity.owner >= 0 ? PLAYER_COLOR_CSS[entity.owner % 4] : undefined }}>
          {name}
        </span>
        <div className="progress hud-hp">
          <div style={{ width: `${pct * 100}%` }} />
        </div>
        <span className="hint mono">{entity.hp}/{maxHp} hp
          {stats && <>
            {"  ·  ATK "}{stats.atk}{"  ARM "}{stats.armor}
            {"  RNG "}{stats.range}{"  SPD "}{stats.mov}{stats.air ? "  AIR" : ""}
          </>}
        </span>
        {info && <p className="hint hud-power">{info.power}</p>}
      </div>
    </div>
  );
}

/** Top-bar block: one player's resources + researched-tech chips (the "guns"). */
function PlayerBlock({ pl, name, units, buildings, right }: {
  pl: PlayerOut; name: string; units: number; buildings: number; right?: boolean;
}) {
  const color = PLAYER_COLOR_CSS[pl.id % 4];
  return (
    <div className={`hud-block ${right ? "right" : ""}`}
         style={{ borderColor: color,
                  background: `linear-gradient(180deg, ${color}24, rgba(8,11,18,0.86) 60%)` }}>
      <div className="hud-res-row">
        <span className="hud-swatch" style={{ background: color }} />
        <span className="hud-name" style={{ color }}>{name}</span>
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
                              units={counts.get(p0.id)?.units ?? 0}
                              buildings={counts.get(p0.id)?.buildings ?? 0} />}
          <div className={`hud-plate ${players.length > 2 ? "inline" : ""}`}>
            {p0 && (
              <div className="plate-side">
                <span className="plate-name" style={{ color: PLAYER_COLOR_CSS[0] }}>
                  {names.get(0) ?? "P0"}
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
                </span>
                <span className="plate-lineage">{lineageLabel(lineages.get(1) ?? "")}</span>
              </div>
            )}
          </div>
          {p1 && <PlayerBlock pl={p1} name={names.get(p1.id) ?? "P1"} right
                              units={counts.get(p1.id)?.units ?? 0}
                              buildings={counts.get(p1.id)?.buildings ?? 0} />}
          {extra.map((pl) => (
            <PlayerBlock key={pl.id} pl={pl} name={names.get(pl.id) ?? `P${pl.id}`}
                         units={counts.get(pl.id)?.units ?? 0}
                         buildings={counts.get(pl.id)?.buildings ?? 0} />
          ))}
        </div>

        {bannerText && <div className="match-banner">{bannerText}</div>}

        <MapView state={data.state} fill controller={controller}
                 onSelect={setSelectedId} />

        <div className="hud-bottombar">
          <div className="bottom-left">
            {selected ? (
              <UnitCard entity={selected} lineage={selLineage}
                        name={selected.owner >= 0
                          ? names.get(selected.owner) ?? `P${selected.owner}`
                          : "the wasteland"} />
            ) : (
              <span className="hud-hint hint">
                click a robot to inspect it · drag the map or use the minimap to move
              </span>
            )}
          </div>
          <div className="bottom-center">
            <Minimap state={data.state} controller={controller} />
          </div>
          <div className="bottom-right">
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
        </div>
      </div>

      <aside className="match-side">
        {scoreHist.length >= 2 && (
          <div className="side-section">
            <h3>Score over time</h3>
            <ScoreChart series={scoreHist} names={names} height={110} />
          </div>
        )}
        {myPlayer ? (
          <AgentChat matchId={matchId!} agentId={myPlayer.agent_id}
                     agentName={myPlayer.name} turn={data.turn}
                     finished={data.finished} />
        ) : (
          <div className="side-section">
            <h3>Agent chat</h3>
            <p className="hint">
              {user
                ? "You're spectating - none of your agents is in this match. When one of yours fights, you can talk to it right here."
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
