// The COMMAND LOG, visually: every order an agent issues becomes one
// fixed-height row of "who → does what → to whom": unit portraits with
// counts, a crisp action icon, and the target (portrait, resource or tile).
// The panel is scrollable and keeps the whole match's history — new rows
// stick to the bottom unless the viewer scrolled up to read older ones.

import { useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import type { FeedLine, OrderViz, OrderVizTarget } from "../api/types";
import { buildingDataURL, tintForIndex } from "../game/dompack";
import { BUILDING_INFO, PLAYER_COLOR_CSS } from "../game/meta";
import { EnergyIcon, MetalIcon } from "./icons";
import LineageAvatar from "./LineageAvatar";

const ACTION_LABEL: Record<string, string> = {
  move: "move", push: "attack-move", attack: "attack", gather: "gather",
  produce: "train", build: "build", found: "found city", research: "research",
  rally: "rally point", fuse: "fuse", recruit: "recruit", capture: "capture",
  diplomacy: "diplomacy",
};

/** Crisp action icons (emoji render blurry and inconsistent). */
function Glyph({ action }: { action: string }) {
  const s = { width: 22, height: 22, flex: "none" } as const;
  const stroke = { fill: "none", strokeWidth: 1.8, strokeLinecap: "round",
                   strokeLinejoin: "round" } as const;
  switch (action) {
    case "move":
      return <svg style={s} viewBox="0 0 16 16" stroke="#8ecbff" {...stroke}>
        <path d="M2 8h10M9 4.5L12.5 8 9 11.5" /></svg>;
    case "push":
    case "attack":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ff6b6b" {...stroke}>
        <path d="M3 13L12 4M10.5 4H12v1.5M3 3l10 10M3 10.5v2.5h2.5" /></svg>;
    case "gather":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ffd54f" {...stroke}>
        <path d="M4 14L11 7M8 3q4-1 6 3M9.5 2.5L13.5 6.5" /></svg>;
    case "build":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ffb74d" {...stroke}>
        <path d="M9 7L3.5 12.5M6.5 2.5h6v4h-6z" /></svg>;
    case "found":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ffd54f" {...stroke}>
        <path d="M2 14h12M3 14V7l5-4 5 4v7M6.5 14v-4h3v4" /></svg>;
    case "rally":
      return <svg style={s} viewBox="0 0 16 16" stroke="#8ecbff" {...stroke}>
        <path d="M4 14V2M4 2.5h8l-2 3 2 3H4" /></svg>;
    case "produce":
      return <svg style={s} viewBox="0 0 16 16" stroke="#9ccc65" {...stroke}>
        <circle cx="8" cy="8" r="3.4" />
        <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2" /></svg>;
    case "research":
      return <svg style={s} viewBox="0 0 16 16" stroke="#ba9df5" {...stroke}>
        <path d="M6.5 2h3M7 2v4l-3.6 6.2A1.4 1.4 0 004.6 14h6.8a1.4 1.4 0 001.2-1.8L9 6V2" /></svg>;
    case "fuse":
      return <svg style={s} viewBox="0 0 16 16" stroke="#4dd0e1" {...stroke}>
        <path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z" /></svg>;
    case "recruit":
      return <svg style={s} viewBox="0 0 16 16" stroke="#9ccc65" {...stroke}>
        <circle cx="6" cy="6" r="2.4" /><path d="M2.5 13.5c0-2.4 1.8-3.8 3.5-3.8s3.5 1.4 3.5 3.8M11.5 5v4M9.5 7h4" /></svg>;
    case "capture":
      return <svg style={s} viewBox="0 0 16 16" stroke="#d500f9" {...stroke}>
        <path d="M4 2v6a4 4 0 008 0V2M4 2h3M9 2h3M4 12.5h3M9 12.5h3" transform="translate(0,1)" /></svg>;
    default:
      return <svg style={s} viewBox="0 0 16 16" stroke="#c0cbdc" {...stroke}>
        <path d="M3 12.5h10M3 12.5V9l7-6 3 3-6.5 6.5z" /></svg>;
  }
}

const IS_BUILDING = new Set(Object.keys(BUILDING_INFO));

function BuildingIcon({ type, owner, size }: {
  type: string; owner: number; size: number;
}) {
  const url = useMemo(() => buildingDataURL(type, tintForIndex(owner)), [type, owner]);
  if (!url) return <span style={{ width: size, height: size }} />;
  return <img src={url} width={size} height={size}
              style={{ imageRendering: "pixelated" }} alt={type} />;
}

/** One actor or target portrait; buildings and units both resolve. */
function Portrait({ type, owner, lineage, ring }: {
  type: string; owner: number; lineage: string; ring?: string;
}) {
  return (
    <span className="abx-portrait" style={ring ? { borderColor: ring } : undefined}>
      {IS_BUILDING.has(type)
        ? <BuildingIcon type={type} owner={owner} size={38} />
        : <LineageAvatar lineage={lineage} unit={type} size={38} />}
    </span>
  );
}

const TERRAIN_TITLE: Record<string, string> = {
  vein: "metal vein (gold mine)", pod: "human pods (energy: the berries)",
  scrap: "scrap (chatarra) - metal left by dead robots", rubble: "rubble (10 metal to clear)",
  field: "ground",
};

/** Pixel-style portrait of a gather target: what the tile IS, not a word. */
function TerrainPortrait({ terrain }: { terrain: string }) {
  const s = { width: 38, height: 38, display: "block" } as const;
  let art: ReactElement;
  switch (terrain) {
    case "vein":
      art = <svg style={s} viewBox="0 0 16 16" shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#2a2617" />
        <rect x="2" y="9" width="5" height="4" fill="#c9a227" /><rect x="8" y="10" width="5" height="4" fill="#e6c352" />
        <rect x="5" y="5" width="5" height="4" fill="#9a7b1c" /><rect x="6" y="6" width="2" height="1" fill="#fff3c0" />
        <rect x="11" y="4" width="3" height="3" fill="#c9a227" /><rect x="12" y="4" width="1" height="1" fill="#fff3c0" />
      </svg>;
      break;
    case "pod":
      art = <svg style={s} viewBox="0 0 16 16" shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#16302a" />
        <rect x="2" y="4" width="4" height="9" fill="#0f1a17" /><rect x="3" y="5" width="2" height="7" fill="#2b4d44" />
        <rect x="3" y="6" width="2" height="4" fill="#3ddc97" /><rect x="3" y="6" width="1" height="1" fill="#d9ffe9" />
        <rect x="7" y="2" width="4" height="11" fill="#0f1a17" /><rect x="8" y="3" width="2" height="9" fill="#2b4d44" />
        <rect x="8" y="4" width="2" height="6" fill="#3ddc97" /><rect x="8" y="4" width="1" height="1" fill="#d9ffe9" />
        <rect x="12" y="5" width="3" height="8" fill="#0f1a17" /><rect x="13" y="6" width="1" height="6" fill="#3ddc97" />
      </svg>;
      break;
    case "scrap":
      art = <svg style={s} viewBox="0 0 16 16" shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#1b2432" />
        <rect x="2" y="10" width="12" height="3" fill="#8d99ae" /><rect x="5" y="11" width="4" height="1" fill="#39414e" />
        <rect x="4" y="6" width="5" height="4" fill="#aab4c4" /><rect x="10" y="4" width="4" height="3" fill="#8d99ae" />
        <rect x="6" y="3" width="3" height="3" fill="#5a6988" /><rect x="11" y="8" width="2" height="2" fill="#b86f50" />
      </svg>;
      break;
    case "rubble":
      art = <svg style={s} viewBox="0 0 16 16" shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#3a2f24" />
        <rect x="2" y="8" width="7" height="4" fill="#574634" /><rect x="9" y="10" width="5" height="3" fill="#6b5540" />
        <rect x="6" y="3" width="4" height="4" fill="#46392c" /><rect x="3" y="4" width="2" height="2" fill="#6b5540" />
      </svg>;
      break;
    default:
      art = <svg style={s} viewBox="0 0 16 16" shapeRendering="crispEdges">
        <rect width="16" height="16" fill="#18202e" /><rect x="3" y="10" width="4" height="2" fill="#1f2937" />
        <rect x="10" y="5" width="3" height="2" fill="#121826" />
      </svg>;
  }
  const res = terrain === "pod" ? "energy" : terrain === "field" ? null : "metal";
  return (
    <span className="abx-portrait abx-terrain" title={TERRAIN_TITLE[terrain] ?? terrain}>
      {art}
      {res && <span className={`abx-res ${res}`}>
        {res === "energy" ? <EnergyIcon /> : <MetalIcon />}
      </span>}
    </span>
  );
}

function Target({ t, lineages }: {
  t: OrderVizTarget | null; lineages: Map<number, string>;
}) {
  if (!t) return <span className="abx-chip">—</span>;
  if ((t.kind === "unit" || t.kind === "building") && t.type) {
    const owner = t.owner ?? -1;
    return <Portrait type={t.type} owner={owner}
                     lineage={owner >= 0 ? lineages.get(owner) ?? "neutral" : "neutral"}
                     ring={owner >= 0 ? PLAYER_COLOR_CSS[owner % 4] : undefined} />;
  }
  if (t.kind === "terrain") {
    if (t.terrain === "cocoon") {
      return <span className="abx-portrait" title="cocoon farm (energy)">
        <BuildingIcon type="cocoon" owner={-1} size={38} /></span>;
    }
    return <TerrainPortrait terrain={t.terrain ?? "field"} />;
  }
  if (t.kind === "tile" && typeof t.x === "number") {
    return <span className="abx-chip mono">({t.x},{t.y})</span>;
  }
  if ((t.kind === "tech" || t.kind === "diplomacy") && t.type) {
    return <span className="abx-chip">{t.type.replace(/_/g, " ")}</span>;
  }
  return <span className="abx-chip">—</span>;
}

export default function ActionBox({ lines, names, lineages }: {
  lines: FeedLine[];
  names: Map<number, string>;
  lineages: Map<number, string>;
}) {
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
    <div className="actionbox" ref={boxRef}
         onScroll={(e) => {
           const el = e.currentTarget;
           pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
         }}>
      {rows.map(({ pid, turn, g }, i) => {
        const lineage = lineages.get(pid) ?? "neutral";
        return (
          <div className="abx-row" key={i}
               style={{ borderLeftColor: PLAYER_COLOR_CSS[pid % 4] }}>
            <span className="abx-who mono">
              <b style={{ color: PLAYER_COLOR_CSS[pid % 4] }}>{names.get(pid) ?? `P${pid}`}</b>
              <span className="abx-turn">T{turn ?? "?"}</span>
            </span>
            {g.actors.length === 0 && <span className="abx-chip">—</span>}
            {g.actors.slice(0, 2).map(([type, n]) => (
              <span className="abx-actor" key={type}>
                <Portrait type={type} owner={pid} lineage={lineage}
                          ring={PLAYER_COLOR_CSS[pid % 4]} />
                {n > 1 && <span className="abx-count">×{n}</span>}
              </span>
            ))}
            <span className="abx-verb">
              <Glyph action={g.action} />
              <span>{ACTION_LABEL[g.action] ?? g.action}</span>
            </span>
            <Target t={g.target} lineages={lineages} />
          </div>
        );
      })}
    </div>
  );
}
