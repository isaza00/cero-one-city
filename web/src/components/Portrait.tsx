// A portrait of a unit, building or resource tile, rendered from the final 3D
// model (web/public/portraits/, produced by tools/render-portraits.mjs with
// the in-game lighting and ground). Per-faction variants carry the faction
// plates; neutral things (survivors, camps, tiles) have one. When a file is
// missing the line glyph stands in, so a screen never shows a broken image.

import { useEffect, useState } from "react";
import { EntityGlyph, TerrainGlyph } from "./icons";

const nice = (type: string) => type.replace(/_/g, " ");

export function portraitFile(type: string, owner = -1, terrain = false): string {
  if (terrain) return `/portraits/tile_${type}.jpg`;
  const team = Number.isInteger(owner) && owner >= 0 ? `p${owner % 4}` : "n";
  return `/portraits/${type}_${team}.jpg`;
}

export default function Portrait({ type, owner = -1, size = 56, terrain = false, label, className, decorative }: {
  type: string;
  /** Player index for the faction variant; anything below 0 is neutral. */
  owner?: number;
  size?: number;
  /** A resource tile (vein, pod, rubble, blocked) instead of an entity. */
  terrain?: boolean;
  label?: string;
  className?: string;
  /** True when adjacent text already names the thing. */
  decorative?: boolean;
}) {
  const src = portraitFile(type, owner, terrain);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (failed) {
    const glyphSize = Math.round(size * 0.62);
    return terrain
      ? <TerrainGlyph terrain={type} size={glyphSize} label={label} decorative={decorative} className={className} />
      : <EntityGlyph type={type} size={glyphSize} label={label} decorative={decorative} className={className} />;
  }
  return (
    <img src={src} width={size} height={size} className={className} draggable={false}
         alt={decorative ? "" : (label ?? nice(type))} aria-hidden={decorative ? true : undefined}
         style={{ display: "block", width: size, height: size, objectFit: "cover", imageRendering: "auto" }}
         onError={() => setFailed(true)} />
  );
}
