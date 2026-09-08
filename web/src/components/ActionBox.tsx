// The COMMAND LOG, visually: every order an agent issues becomes one row of
// "who → does what → to whom": technical glyphs with names and counts, a
// crisp action icon, and the target (unit, building, resource or tile). The
// panel keeps the whole match's history - new rows stick to the bottom unless
// the viewer scrolled up to read older ones.

import { useEffect, useMemo, useRef } from "react";
import type { FeedLine, OrderViz, OrderVizTarget } from "../api/types";
import { BUILDING_INFO, PLAYER_COLOR_CSS, TERRAIN_INFO, UNIT_POWERS } from "../game/meta";
import { BuildingGlyph, EnergyIcon, EntityGlyph, MetalIcon, TerrainGlyph, UnitGlyph } from "./icons";

const ACTION_LABEL: Record<string, string> = {
  move: "move", push: "attack-move", attack: "attack", gather: "gather",
  produce: "train", build: "build", found: "found city", research: "research",
  rally: "rally point", fuse: "fuse", recruit: "recruit", capture: "capture",
  diplomacy: "diplomacy",
};

const NEUTRAL = "#b8e63d";

/** Crisp action icons (emoji render blurry and inconsistent). */
function Glyph({ action }: { action: string }) {
  const s = { width: 22, height: 22, flex: "none" } as const;
  const stroke = { fill: "none", strokeWidth: 1.8, strokeLinecap: "round",
                   strokeLinejoin: "round" } as const;
  switch (action) {
    case "move":
      return <svg style={s} viewBox="0 0 16 16" stroke="#8ecbff" {...stroke} aria-hidden="true">
        <path d="M2 8h10M9 4.5L12.5 8 9 11.5" /></svg>;
    case "push":
    case "attack":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ff6b6b" {...stroke} aria-hidden="true">
        <path d="M3 13L12 4M10.5 4H12v1.5M3 3l10 10M3 10.5v2.5h2.5" /></svg>;
    case "gather":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ffd54f" {...stroke} aria-hidden="true">
        <path d="M4 14L11 7M8 3q4-1 6 3M9.5 2.5L13.5 6.5" /></svg>;
    case "build":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ffb74d" {...stroke} aria-hidden="true">
        <path d="M9 7L3.5 12.5M6.5 2.5h6v4h-6z" /></svg>;
    case "found":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ffd54f" {...stroke} aria-hidden="true">
        <path d="M2 14h12M3 14V7l5-4 5 4v7M6.5 14v-4h3v4" /></svg>;
    case "rally":
      return <svg style={s} viewBox="0 0 16 16" stroke="#8ecbff" {...stroke} aria-hidden="true">
        <path d="M4 14V2M4 2.5h8l-2 3 2 3H4" /></svg>;
    case "produce":
      return <svg style={s} viewBox="0 0 16 16" stroke="#9ccc65" {...stroke} aria-hidden="true">
        <circle cx="8" cy="8" r="3.4" />
        <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2" /></svg>;
    case "research":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ba9df5" {...stroke} aria-hidden="true">
        <path d="M6.5 2h3M7 2v4l-3.6 6.2A1.4 1.4 0 004.6 14h6.8a1.4 1.4 0 001.2-1.8L9 6V2" /></svg>;
    case "fuse":
      return <svg style={s} viewBox="0 0 16 16" stroke="#4dd0e1" {...stroke} aria-hidden="true">
        <path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z" /></svg>;
    case "recruit":
      return <svg style={s} viewBox="0 0 16 16" stroke="#9ccc65" {...stroke} aria-hidden="true">
        <circle cx="6" cy="6" r="2.4" /><path d="M2.5 13.5c0-2.4 1.8-3.8 3.5-3.8s3.5 1.4 3.5 3.8M11.5 5v4M9.5 7h4" /></svg>;
    case "capture":
      return <svg style={s} viewBox="0 0 16 16" stroke="#d500f9" {...stroke} aria-hidden="true">
        <path d="M4 2v6a4 4 0 008 0V2M4 2h3M9 2h3M4 12.5h3M9 12.5h3" transform="translate(0,1)" /></svg>;
    default:
      return <svg style={s} viewBox="0 0 16 16" stroke="#c0cbdc" {...stroke} aria-hidden="true">
        <path d="M3 12.5h10M3 12.5V9l7-6 3 3-6.5 6.5z" /></svg>;
  }
}

const IS_BUILDING = new Set(Object.keys(BUILDING_INFO));

function entityLabel(type: string): string {
  return (IS_BUILDING.has(type) ? BUILDING_INFO[type]?.label : UNIT_POWERS[type]?.label)
    ?? type.replace(/_/g, " ");
}

/** One actor or target: glyph in the owner's colour, then the name (and count). */
function Portrait({ type, ring, count }: { type: string; ring?: string; count?: number }) {
  const label = entityLabel(type);
  return (
    <span className="abx-actor" title={label}>
      <span className="abx-portrait" style={ring ? { borderColor: ring, color: ring } : undefined}>
        <EntityGlyph type={type} size={20} decorative />
      </span>
      <span className="abx-name">
        {label}
        {count !== undefined && count > 1 && <span className="abx-count">×{count}</span>}
      </span>
    </span>
  );
}

function TerrainTarget({ terrain }: { terrain: string }) {
  const info = TERRAIN_INFO[terrain];
  const res = terrain === "pod" ? "energy" : terrain === "field" ? null : "metal";
  return (
    <span className="abx-target" title={info ? `${info.label}: ${info.power}` : terrain}>
      <span className="abx-portrait abx-terrain">
        <TerrainGlyph terrain={terrain} size={20} decorative />
      </span>
      <span className="abx-name">
        {info?.label ?? terrain.replace(/_/g, " ")}
        {res && <span className={`abx-res ${res}`}>
          {res === "energy" ? <EnergyIcon /> : <MetalIcon />}
        </span>}
      </span>
    </span>
  );
}

function Target({ t }: { t: OrderVizTarget | null }) {
  if (!t) return <span className="abx-chip">—</span>;
  if ((t.kind === "unit" || t.kind === "building") && t.type) {
    const owner = t.owner ?? -1;
    return <Portrait type={t.type} ring={owner >= 0 ? PLAYER_COLOR_CSS[owner % 4] : NEUTRAL} />;
  }
  if (t.kind === "terrain") {
    if (t.terrain === "survivor") {
      return (
        <span className="abx-target" title="a neutral survivor: a worker carries it to a cocoon">
          <span className="abx-portrait" style={{ color: NEUTRAL, borderColor: NEUTRAL }}>
            <UnitGlyph type="survivor" size={20} decorative />
          </span>
          <span className="abx-name">Survivor</span>
        </span>
      );
    }
    if (t.terrain === "cocoon") {
      return (
        <span className="abx-target" title="cocoon (energy farm)">
          <span className="abx-portrait"><BuildingGlyph type="cocoon" size={20} decorative /></span>
          <span className="abx-name">Cocoon</span>
        </span>
      );
    }
    return <TerrainTarget terrain={t.terrain ?? "field"} />;
  }
  if (t.kind === "tile" && typeof t.x === "number") {
    return (
      <span className="abx-target" title={`map position (${t.x},${t.y})`}>
        <span className="abx-portrait abx-tile"><TerrainGlyph terrain="field" size={20} decorative /></span>
        <span className="abx-name mono">({t.x},{t.y})</span>
      </span>
    );
  }
  if ((t.kind === "tech" || t.kind === "diplomacy") && t.type) {
    return <span className="abx-chip">{t.type.replace(/_/g, " ")}</span>;
  }
  return <span className="abx-chip">—</span>;
}

export default function ActionBox({ lines, names, lineages }: {
  lines: FeedLine[];
  names: Map<number, string>;
  /** Kept for callers: the log now names things by shape, not by lineage sprite. */
  lineages?: Map<number, string>;
}) {
  void lineages;
  // ONE action per row: flatten every order group into its own line.
  const rows = useMemo(() => {
    const out: { pid: number; turn: number | undefined; g: OrderViz }[] = [];
    for (const l of lines) {
      if (l.kind !== "orders" || !l.viz?.length || l.player_index == null) continue;
      for (const g of l.viz) out.push({ pid: l.player_index, turn: l.turn, g });
    }
    return out;
  }, [lines]);
  const boxRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true); // stick to bottom until the viewer scrolls up

  useEffect(() => {
    const el = boxRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  if (rows.length === 0) {
    return <span className="hud-hint hint">agents are issuing their first orders…</span>;
  }
  return (
    <div className="actionbox" ref={boxRef} aria-label="command log"
         onScroll={(e) => {
           const el = e.currentTarget;
           pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
         }}>
      {rows.map(({ pid, turn, g }, i) => {
        const color = PLAYER_COLOR_CSS[pid % 4];
        return (
          <div className="abx-row" key={i} style={{ borderLeftColor: color }}>
            <span className="abx-who mono">
              <b style={{ color }}>{names.get(pid) ?? `P${pid}`}</b>
              <span className="abx-turn">T{turn ?? "?"}</span>
            </span>
            {g.actors.length === 0 && <span className="abx-chip">—</span>}
            {g.actors.slice(0, 2).map(([type, n]) => (
              <Portrait key={type} type={type} ring={color} count={n} />
            ))}
            <span className="abx-verb">
              <Glyph action={g.action} />
              <span>{ACTION_LABEL[g.action] ?? g.action}</span>
            </span>
            <Target t={g.target} />
          </div>
        );
      })}
    </div>
  );
}
