// Field manual: the ruleset's economy and cast as a collapsible reference on
// the live screen. Every figure mirrors engine/cero_engine/rules.py (s2.0) and
// is display-only: nothing here changes, extends or guesses a rule. Values the
// client already mirrors (game/meta.ts) are reused, not repeated.

import { useEffect, useRef } from "react";
import { BUILD_ORDER, BUILDING_COST, BUILDING_INFO, BUILDING_WORK, UNIT_POWERS } from "../game/meta";
import {
  BookIcon, BuildingGlyph, CloseIcon, EnergyIcon, MetalIcon, TerrainGlyph, UnitGlyph,
  UNIT_GLYPH_TYPES,
} from "./icons";
import Portrait from "./Portrait";
import "./field-manual.css";

/** Ruleset figures the manual quotes (engine/cero_engine/rules.py, s2.0). */
export const RULES = {
  maxTurns: 80,
  startWorkers: 4, startEscorts: 1, startEnergy: 75, startMetal: 100,
  coreWork: 8, maxBuilders: 4,
  podEnergy: 200, podRate: 8, veinMetal: 300, mineRate: 6, scrapRate: 20,
  rubbleTurns: 2, rubbleMetal: 10, carry: 20, carryServos: 30,
  cocoonHumans: 2, cocoonRate: 8,
  upkeep: 1, computeCore: 10, computeRack: 4, computeRackSwarm: 6,
  campRecruitEnergy: 50, campGuards: 3, colossusFuse: 5,
  fw2: { e: 120, m: 80, turns: 2 },
  fw3: { e: 350, m: 250, turns: 3 },
} as const;

export const FIRMWARE_ORDER = ["v1", "v2", "v3"] as const;
export type Firmware = typeof FIRMWARE_ORDER[number];

/** Where each unit comes from and what it costs (rules.py UNITS, display only). */
export interface ProductionRow {
  type: string;
  at: "core" | "assembler" | "fusion" | "camp" | "wild";
  fw: Firmware | null;
  e: number;
  m: number;
  turns: number;
  compute: number;
  lineage?: string;
  note?: string;
}

export const PRODUCTION: ProductionRow[] = [
  { type: "worker", at: "core", fw: "v1", e: 25, m: 0, turns: 1, compute: 1 },
  { type: "striker", at: "assembler", fw: "v1", e: 20, m: 15, turns: 1, compute: 1 },
  { type: "launcher", at: "assembler", fw: "v2", e: 25, m: 20, turns: 1, compute: 1 },
  { type: "rider", at: "assembler", fw: "v2", e: 35, m: 30, turns: 2, compute: 2 },
  { type: "wasp", at: "assembler", fw: "v2", e: 30, m: 25, turns: 2, compute: 2 },
  { type: "walking_tower", at: "assembler", fw: "v3", e: 60, m: 80, turns: 3, compute: 4 },
  { type: "drone_swarm", at: "assembler", fw: "v3", e: 50, m: 40, turns: 2, compute: 3 },
  { type: "colossus", at: "fusion", fw: "v3", e: 0, m: 0, turns: 0, compute: 5,
    note: `fused from ${RULES.colossusFuse} strikers` },
  { type: "human", at: "camp", fw: null, e: RULES.campRecruitEnergy, m: 0, turns: 0, compute: 0,
    note: "recruited at a neutral camp" },
  { type: "spark", at: "assembler", fw: "v1", e: 10, m: 5, turns: 1, compute: 1, lineage: "swarm",
    note: "built two at a time" },
  { type: "anvil", at: "assembler", fw: "v2", e: 30, m: 40, turns: 2, compute: 2, lineage: "forge" },
  { type: "watcher", at: "core", fw: "v1", e: 15, m: 10, turns: 1, compute: 1, lineage: "oracle" },
  { type: "leech", at: "assembler", fw: "v1", e: 20, m: 15, turns: 1, compute: 1, lineage: "parasite" },
  { type: "prism", at: "assembler", fw: "v1", e: 20, m: 10, turns: 1, compute: 1, lineage: "photon" },
  { type: "survivor", at: "wild", fw: null, e: 0, m: 0, turns: 0, compute: 0,
    note: "neutral; freed when a pod is drained" },
];

/** Role tags for the cast grid: silhouette and function, not stats. */
const CAST_TAGS: Record<string, { tag: string; cls?: "neutral" | "armed" }> = {
  worker: { tag: "economy · builder · carries" },
  striker: { tag: "melee assault · v1" },
  launcher: { tag: "rockets · range 4 · v2" },
  rider: { tag: "fast raider · v2" },
  wasp: { tag: "small aircraft · v2" },
  walking_tower: { tag: "siege walker · v3" },
  drone_swarm: { tag: "coordinated drones · v3" },
  colossus: { tag: "fusion of 5 strikers · v3" },
  human: { tag: "armed human · guard or recruit", cls: "armed" },
  spark: { tag: "swarm special · light zapper" },
  anvil: { tag: "forge special · heavy armour" },
  watcher: { tag: "oracle special · unarmed scout" },
  leech: { tag: "parasite special · capture probe" },
  prism: { tag: "photon special · optical support" },
  survivor: { tag: "neutral · unarmed · collectible", cls: "neutral" },
};

const AT_LABEL: Record<ProductionRow["at"], string> = {
  core: "core", assembler: "assembler", fusion: "fusion", camp: "neutral camp", wild: "wild",
};

const nice = (type: string) => type.replace(/_/g, " ");

function Cost({ e, m }: { e: number; m: number }) {
  if (!e && !m) return <>—</>;
  return (
    <>
      {e > 0 && <><EnergyIcon /> {e}</>}
      {e > 0 && m > 0 && " · "}
      {m > 0 && <><MetalIcon /> {m}</>}
    </>
  );
}

export default function FieldManual({ open, onClose, id = "field-manual" }: {
  open: boolean; onClose: () => void; id?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside className="field-manual" id={id} role="dialog" aria-labelledby={`${id}-title`}
           hidden={!open}>
      <div className="fm-head">
        <h2 id={`${id}-title`}><BookIcon /> Field manual</h2>
        <button type="button" className="fm-close" ref={closeRef} onClick={onClose}>
          <CloseIcon /> Close
        </button>
      </div>
      <div className="fm-body">
        <details open>
          <summary>Nomad start</summary>
          <div className="fm-section">
            <div className="fm-figures">
              <div className="fm-figure"><b>{RULES.startWorkers}</b><span>workers</span></div>
              <div className="fm-figure"><b>{RULES.startEscorts}</b><span>striker</span></div>
              <div className="fm-figure"><b>{RULES.startEnergy}</b><span>energy</span></div>
              <div className="fm-figure"><b>{RULES.startMetal}</b><span>metal</span></div>
              <div className="fm-figure"><b>0</b><span>buildings</span></div>
            </div>
            <p>Everyone starts as nomads. The first <strong>core</strong> costs{" "}
              <b className="num">{BUILDING_COST.core.m} metal</b> - exactly the bank - and takes{" "}
              <b className="num">{RULES.coreWork}</b> work points: one per adjacent worker per turn,
              up to <b className="num">{RULES.maxBuilders}</b> builders. Until it stands there is
              no compute and nothing to train. A match lasts up to{" "}
              <b className="num">{RULES.maxTurns}</b> turns.</p>
          </div>
        </details>

        <details open>
          <summary>Energy: pods, survivors, cocoons</summary>
          <div className="fm-section">
            <div className="fm-flow" aria-label="energy loop">
              <span className="fm-step"><TerrainGlyph terrain="pod" size={16} decorative />wild pod</span>
              <span className="fm-arrow">→</span>
              <span className="fm-step"><UnitGlyph type="survivor" size={16} decorative />survivor</span>
              <span className="fm-arrow">→</span>
              <span className="fm-step"><UnitGlyph type="worker" size={16} decorative />carried</span>
              <span className="fm-arrow">→</span>
              <span className="fm-step"><BuildingGlyph type="cocoon" size={16} decorative />cocoon</span>
              <span className="fm-arrow">→</span>
              <span className="fm-step"><EnergyIcon />harvest</span>
            </div>
            <p>A wild pod holds <b className="num">{RULES.podEnergy}</b> energy; a worker beside it
              gathers <b className="num">{RULES.podRate}</b> per turn until it is drained. A drained
              pod frees its sleeper as a neutral <strong>survivor</strong>: no weapon, no movement.
              A worker carries the survivor to a <strong>cocoon</strong>, which houses up to{" "}
              <b className="num">{RULES.cocoonHumans}</b> humans; each human is one harvesting slot
              worth <b className="num">{RULES.cocoonRate}</b> energy per worker per turn, renewable.
              An empty cocoon makes nothing.</p>
            <p>Every combat unit costs <b className="num">{RULES.upkeep}</b> energy per turn
              (workers, watchers and survivors are exempt). With an empty bank the army freezes
              stiff.</p>
          </div>
        </details>

        <details>
          <summary>Metal: veins, scrap, rubble, drop-off</summary>
          <div className="fm-section">
            <p>A vein holds <b className="num">{RULES.veinMetal}</b> metal, mined at{" "}
              <b className="num">{RULES.mineRate}</b> per worker per turn. Dead robots leave scrap
              worth <b className="num">{RULES.scrapRate}</b> per turn of salvage. Rubble takes{" "}
              <b className="num">{RULES.rubbleTurns}</b> turns to clear and pays{" "}
              <b className="num">{RULES.rubbleMetal}</b> metal.</p>
            <p>A worker carries up to <b className="num">{RULES.carry}</b> ({RULES.carryServos} with
              cargo servos) and banks it only at a <strong>core</strong> or a{" "}
              <strong>depot</strong>. What is being carried is not in the bank yet: gathering and
              the numbers at the top move at different moments.</p>
          </div>
        </details>

        <details>
          <summary>Compute and firmware</summary>
          <div className="fm-section">
            <p>Compute caps the army: a core gives <b className="num">{RULES.computeCore}</b>, a
              rack <b className="num">{RULES.computeRack}</b> (swarm{" "}
              <b className="num">{RULES.computeRackSwarm}</b>). Firmware is the tech level, researched
              at the core: <strong>v2</strong> costs <b className="num">{RULES.fw2.e}</b> energy /{" "}
              <b className="num">{RULES.fw2.m}</b> metal over {RULES.fw2.turns} turns and needs an
              assembler; <strong>v3</strong> costs <b className="num">{RULES.fw3.e}</b> /{" "}
              <b className="num">{RULES.fw3.m}</b> over {RULES.fw3.turns} turns and needs a lab and
              two racks. Turrets and a second core need v2.</p>
          </div>
        </details>

        <details>
          <summary>Orders and control</summary>
          <div className="fm-section">
            <p><strong>Agents give the orders, not you.</strong> Every turn each agent answers
              with a batch of orders; the Actions tab shows them as they land.</p>
            <p><strong>Manual</strong> mode: you write one message per turn in the chat and the
              agent turns your words into orders next turn, resolving who and where by itself.{" "}
              <strong>Copilot</strong>: it plays on its own and takes your messages as guidance.{" "}
              <strong>Autonomous</strong>: the chat is closed.</p>
            <p>There is no click-to-command on this screen: selecting a unit or a building shows
              what it is and what it is doing, it never commands it.</p>
          </div>
        </details>

        <details>
          <summary>Cast</summary>
          <div className="fm-section">
            <div className="fm-cast">
              {UNIT_GLYPH_TYPES.map((type) => {
                const info = UNIT_POWERS[type];
                const tags = CAST_TAGS[type];
                return (
                  <div className="fm-unit" key={type} data-unit={type}>
                    <Portrait type={type} size={44} label={info?.label ?? nice(type)} />
                    <div>
                      <strong>{info?.label ?? nice(type)}</strong>
                      <span className={`fm-tags${tags?.cls ? ` ${tags.cls}` : ""}`}>{tags?.tag}</span>
                      <p>{info?.power}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>

        <details>
          <summary>Production</summary>
          <div className="fm-section">
            <p>The <strong>core</strong> trains workers (and the oracle's watchers); the{" "}
              <strong>assembler</strong> trains combat units, gated by firmware and lineage. A
              colossus is fused, humans are recruited, survivors are found.</p>
            <table className="fm-table">
              <thead>
                <tr><th>Unit</th><th>Where</th><th>Firmware</th><th>Cost</th><th>Turns</th></tr>
              </thead>
              <tbody>
                {PRODUCTION.map((row) => (
                  <tr key={row.type}>
                    <td><UnitGlyph type={row.type} size={16} decorative />
                      {UNIT_POWERS[row.type]?.label ?? nice(row.type)}
                      {row.lineage && <span className="fm-note"> · {row.lineage}</span>}
                    </td>
                    <td>{AT_LABEL[row.at]}{row.note && <span className="fm-note"> · {row.note}</span>}</td>
                    <td className="num">{row.fw ?? "—"}</td>
                    <td className="num"><Cost e={row.e} m={row.m} /></td>
                    <td className="num">{row.turns || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <details>
          <summary>Buildings</summary>
          <div className="fm-section">
            <table className="fm-table">
              <thead>
                <tr><th>Building</th><th>Role</th><th>Cost</th><th>Work</th></tr>
              </thead>
              <tbody>
                {[...BUILD_ORDER, "camp"].map((type) => {
                  const info = BUILDING_INFO[type];
                  const cost = BUILDING_COST[type];
                  return (
                    <tr key={type}>
                      <td><BuildingGlyph type={type} size={16} decorative />{info?.label ?? nice(type)}</td>
                      <td>{type === "camp" ? "neutral, not buildable" : info?.aoe}
                        {type === "turret" && <span className="fm-note"> · needs v2</span>}</td>
                      <td className="num">{cost ? <Cost e={cost.e} m={cost.m} /> : "—"}</td>
                      <td className="num">{BUILDING_WORK[type] || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="fm-note">Figures mirror engine/cero_engine/rules.py (ruleset s2.0) and
              are for reading only.</p>
          </div>
        </details>
      </div>
    </aside>
  );
}
