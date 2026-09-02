// SQUARE top-down minimap: the whole battlefield as a straight grid, one cell
// per tile, entity dots in player colors, a visible tile lattice, and the
// camera's viewport drawn as a quad (the iso camera maps to a rotated rect
// here). Click/drag to fly the camera.

import { MutableRefObject, useEffect, useRef } from "react";
import type { GameState } from "../api/types";
import { PLAYER_COLOR_CSS } from "../game/meta";
import { PERSPECTIVE_ALL, exploredTilesFor, visibleTilesFor } from "../game/vision";
import type { MapController } from "../pixi/MapView";

const TERRAIN_MINI: Record<string, string> = {
  plain: "#141b27",
  blocked: "#39414e",
  vein: "#c9a227",
  pod: "#3ddc97",     // wild energy: the "berries" you go find
  rubble: "#574634",
};

export default function Minimap({ state, controller, perspective = null, width = 190 }: {
  state: GameState | null;
  controller: MutableRefObject<MapController | null>;
  perspective?: number | null;
  width?: number;
}) {
  const height = width; // square world, square minimap
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const perspRef = useRef(perspective);
  perspRef.current = perspective;
  // Fog sets are O(map); cache them per (state, perspective) snapshot.
  const fogCache = useRef<{ s: GameState | null; p: number | null;
                            vis: Set<number> | null; exp: Set<number> | null }>(
    { s: null, p: null, vis: null, exp: null });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext("2d")!;
    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 120) return;
      last = now;
      const s = stateRef.current;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, width, height);
      if (!s) return;
      // Fog for the minimap too: black until discovered, dim when explored.
      const p = perspRef.current;
      const fogged = p !== null && (p === PERSPECTIVE_ALL || !!s.players[p]);
      const cache = fogCache.current;
      if (fogged && (cache.s !== s || cache.p !== p)) {
        cache.s = s; cache.p = p;
        cache.vis = visibleTilesFor(s, p!);
        cache.exp = exploredTilesFor(s, p!);
      }
      const vis = fogged ? cache.vis : null;
      const exp = fogged ? cache.exp : null;
      const k = width / s.size; // px per tile
      g.setTransform(k, 0, 0, k, 0, 0);
      for (let y = 0; y < s.size; y++) {
        for (let x = 0; x < s.size; x++) {
          const packed = y * s.size + x;
          if (vis && !vis.has(packed) && !exp!.has(packed)) {
            g.fillStyle = "#05070c"; // never seen
            g.fillRect(x, y, 1.02, 1.02);
            continue;
          }
          g.fillStyle = TERRAIN_MINI[s.tiles[y][x]] ?? TERRAIN_MINI.plain;
          g.fillRect(x, y, 1.02, 1.02);
          if (vis && !vis.has(packed)) {
            g.fillStyle = "rgba(4,6,10,0.55)"; // explored, not currently seen
            g.fillRect(x, y, 1.02, 1.02);
          }
        }
      }
      for (const e of Object.values(s.entities)) {
        if (vis) {
          const packed = e.y * s.size + e.x;
          const show = e.kind === "unit" ? vis.has(packed)
            : vis.has(packed) || exp!.has(packed);
          if (!show) continue;
        }
        g.fillStyle = e.owner >= 0 ? PLAYER_COLOR_CSS[e.owner % 4] : "#9e9e9e";
        const d = e.kind === "building" ? 1.7 : 1.1;
        g.fillRect(e.x - d / 2 + 0.5, e.y - d / 2 + 0.5, d, d);
      }
      // Tile lattice so the grid actually reads as a grid.
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = "rgba(255,255,255,0.07)";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < s.size; i++) {
        g.moveTo(i * k, 0); g.lineTo(i * k, height);
        g.moveTo(0, i * k); g.lineTo(width, i * k);
      }
      g.stroke();
      // Camera locator: ALWAYS drawn. A plain rectangle centered where the
      // camera looks, sized to the screen's coverage; when the whole map is
      // on screen it frames the entire minimap.
      const quad = controller.current?.getViewTileQuad();
      if (quad && quad.length === 4) {
        const xs = quad.map((q) => q.tx), ys = quad.map((q) => q.ty);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const w = (Math.max(...xs) - Math.min(...xs)) * 0.72;
        const h = (Math.max(...ys) - Math.min(...ys)) * 0.72;
        const x0 = Math.min(Math.max(0, cx - w / 2), s.size - 2) * k;
        const y0 = Math.min(Math.max(0, cy - h / 2), s.size - 2) * k;
        const x1 = Math.max(Math.min(s.size, cx + w / 2), x0 / k + 2) * k;
        const y1 = Math.max(Math.min(s.size, cy + h / 2), y0 / k + 2) * k;
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = 1.5;
        g.strokeRect(x0 + 0.75, y0 + 0.75,
                     Math.max(2, x1 - x0 - 1.5), Math.max(2, y1 - y0 - 1.5));
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, controller]);

  const fly = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    if (!s) return;
    const rect = e.currentTarget.getBoundingClientRect();
    controller.current?.centerOnTile(
      ((e.clientX - rect.left) / rect.width) * s.size,
      ((e.clientY - rect.top) / rect.height) * s.size);
  };

  return (
    <canvas ref={ref} width={width} height={height} className="minimap"
            style={{ width, height }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fly(e); }}
            onPointerMove={(e) => { if (e.buttons & 1) fly(e); }} />
  );
}
