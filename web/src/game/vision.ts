// Client-side fog computation for the replay "view as player X" selector.
// Approximates engine vision (Chebyshev radii; oracle +2) for display only.

import type { GameState } from "../api/types";
import { BUILDING_SIZE, BUILDING_VISION, UNIT_VISION } from "./meta";

export function visibleTiles(state: GameState, playerIndex: number): Set<number> {
  const out = new Set<number>();
  const size = state.size;
  const oracle = state.players[playerIndex]?.lineage === "oracle" ? 2 : 0;
  for (const e of Object.values(state.entities)) {
    if (e.owner !== playerIndex) continue;
    const base = e.kind === "unit" ? UNIT_VISION[e.type] ?? 3 : BUILDING_VISION[e.type] ?? 2;
    const vis = base + oracle;
    const [w, h] = e.kind === "unit" ? [1, 1] : BUILDING_SIZE[e.type] ?? [1, 1];
    for (let fy = e.y; fy < e.y + h; fy++) {
      for (let fx = e.x; fx < e.x + w; fx++) {
        for (let y = Math.max(0, fy - vis); y <= Math.min(size - 1, fy + vis); y++) {
          for (let x = Math.max(0, fx - vis); x <= Math.min(size - 1, fx + vis); x++) {
            out.add(y * size + x);
          }
        }
      }
    }
  }
  return out;
}

export function exploredTiles(state: GameState, playerIndex: number): Set<number> {
  return new Set(state.players[playerIndex]?.explored ?? []);
}

/** Sentinel perspective: the UNION of every player's fog (spectator default -
 * you see what the agents have discovered, never more). */
export const PERSPECTIVE_ALL = -2;

export function visibleTilesFor(state: GameState, perspective: number): Set<number> {
  if (perspective !== PERSPECTIVE_ALL) return visibleTiles(state, perspective);
  const out = new Set<number>();
  for (const p of state.players) {
    for (const t of visibleTiles(state, p.id)) out.add(t);
  }
  return out;
}

export function exploredTilesFor(state: GameState, perspective: number): Set<number> {
  if (perspective !== PERSPECTIVE_ALL) return exploredTiles(state, perspective);
  const out = new Set<number>();
  for (const p of state.players) {
    for (const t of p.explored ?? []) out.add(t);
  }
  return out;
}
