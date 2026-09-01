// AoE2-style minimap: the world drawn as a DIAMOND (same isometric projection
// as the main view), entity dots in player colors, the camera's viewport as a
// white rectangle, click/drag to fly the camera there.

import { MutableRefObject, useEffect, useRef } from "react";
import type { GameState } from "../api/types";
import { PLAYER_COLOR_CSS } from "../game/meta";
import type { MapController } from "../pixi/MapView";

const TERRAIN_MINI: Record<string, string> = {
  plain: "#141b27",
  blocked: "#39414e",
  vein: "#c9a227",
  rubble: "#574634",
};

export default function Minimap({ state, controller, width = 232 }: {
  state: GameState | null;
  controller: MutableRefObject<MapController | null>;
  width?: number;
}) {
  const height = width / 2; // 2:1, same as the world
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

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
      // Isometric transform: tile (x,y) -> diamond. One fillRect per tile.
      const a = width / (2 * s.size);
      const b = height / (2 * s.size);
      g.setTransform(a, b, -a, b, width / 2, 0);
      for (let y = 0; y < s.size; y++) {
        for (let x = 0; x < s.size; x++) {
          g.fillStyle = TERRAIN_MINI[s.tiles[y][x]] ?? TERRAIN_MINI.plain;
          g.fillRect(x, y, 1.05, 1.05);
        }
      }
      for (const e of Object.values(s.entities)) {
        g.fillStyle = e.owner >= 0 ? PLAYER_COLOR_CSS[e.owner % 4] : "#9e9e9e";
        const d = e.kind === "building" ? 1.7 : 1.1;
        g.fillRect(e.x - d / 2 + 0.5, e.y - d / 2 + 0.5, d, d);
      }
      // Viewport rectangle: axis-aligned in projected world space.
      g.setTransform(1, 0, 0, 1, 0, 0);
      const view = controller.current?.getViewFrac();
      if (view) {
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = 1.5;
        g.strokeRect(view.x * width, view.y * height,
                     Math.min(view.w, 1) * width, Math.min(view.h, 1) * height);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, controller]);

  const fly = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    controller.current?.centerOnFrac(
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height);
  };

  return (
    <canvas ref={ref} width={width} height={height} className="minimap"
            style={{ width, height }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fly(e); }}
            onPointerMove={(e) => { if (e.buttons & 1) fly(e); }} />
  );
}
