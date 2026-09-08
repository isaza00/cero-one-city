// Lineage portrait: the lineage's signature unit (or a chosen unit), rendered
// from the final 3D model - the same one that fights on the battlefield - via
// the shared Portrait component. The old pixel-art atlas is no longer drawn
// here; if a portrait file is missing the technical glyph stands in.

import Portrait from "./Portrait";

const LINEAGE_UNIT: Record<string, string> = {
  swarm: "spark", forge: "anvil", oracle: "watcher", parasite: "leech", photon: "prism",
};

export default function LineageAvatar({ lineage, unit, size = 84 }: {
  lineage: string;
  /** Specific unit to draw; default: the lineage's special unit. */
  unit?: string;
  size?: number;
}) {
  const type = unit ?? LINEAGE_UNIT[lineage] ?? "striker";
  return (
    <span className="lineage-avatar" style={{ width: size, height: size, display: "inline-flex",
                                              alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <Portrait type={type} size={size} label={`${type.replace(/_/g, " ")} (${lineage})`} />
    </span>
  );
}
