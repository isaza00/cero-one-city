// Animated lineage portrait: the lineage's signature unit, blown up from the
// shipped pixel-art atlas (crisp, no smoothing), idling at 2 frames.
// Pack-only art: before the atlases load, the canvas just stays dark.

import { useEffect, useRef } from "react";
import { domPack, loadDomPack } from "../game/dompack";

const LINEAGE_UNIT: Record<string, { tint: string; unit: string }> = {
  swarm: { tint: "swarm", unit: "striker" },
  forge: { tint: "forge", unit: "anvil" },
  oracle: { tint: "oracle", unit: "watcher" },
  parasite: { tint: "parasite", unit: "leech" },
  photon: { tint: "neutral", unit: "spark" }, // photon atlas not shipped yet
};

export default function LineageAvatar({ lineage, unit, size = 84 }: {
  lineage: string;
  /** Specific unit to draw (in the lineage's colors); default: its signature unit. */
  unit?: string;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const base = LINEAGE_UNIT[lineage] ?? { tint: "neutral", unit: "striker" };
    const pick = unit ? { tint: base.tint, unit } : base;
    let frame = 0;
    let timer = 0;
    let cancelled = false;

    loadDomPack().then(() => {
      if (cancelled) return;
      const draw = () => {
        g.clearRect(0, 0, size, size);
        const p = domPack();
        if (!p) return;
        const info = p.units[pick.unit];
        const img = p.unitImg[pick.tint];
        if (info && img) {
          const t = p.tile;
          g.drawImage(img, (frame % info.frames) * t, info.row * t, t, t,
                      0, 0, size, size);
        }
        frame++;
      };
      draw();
      timer = window.setInterval(draw, 420);
    });
    return () => { cancelled = true; clearInterval(timer); };
  }, [lineage, unit, size]);

  return <canvas ref={ref} width={size} height={size} className="lineage-avatar"
                 style={{ width: size, height: size }} />;
}
