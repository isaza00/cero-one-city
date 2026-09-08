// Inline SVG icons for the HUD - crisp at 12-14px, tinted via currentColor.
// Deliberately not emojis. The first block is the original resource set (kept
// as-is: every export and aria-label is relied upon elsewhere); the second
// block is the command-post glyph library: one line-drawn silhouette per unit,
// building and terrain, so the live screen can name things by shape without
// pixel sprites.

import type { ReactNode } from "react";

const S = { width: 13, height: 13, viewBox: "0 0 16 16", fill: "currentColor" };

export const EnergyIcon = () => (
  <svg {...S} aria-label="energy"><path d="M9 0 3 9h3.5L5.5 16 13 6H8.8L11 0z" /></svg>
);

export const MetalIcon = () => (
  <svg {...S} aria-label="metal">
    <path d="M2 13.5 8.5 7l1.6 1.6L3.6 15 2 15z" />
    <path d="M8 2c3-1.6 6 .2 7 3l-2.4-.7L10 6.7 9 5.6l1.4-2.4C9.6 2.7 8.8 2.3 8 2z" />
  </svg>
);

export const UnitsIcon = () => (
  <svg {...S} aria-label="robots">
    <rect x="3" y="4" width="10" height="8" rx="1.5" />
    <rect x="5.5" y="6.5" width="2" height="2" fill="#0a0e13" />
    <rect x="8.5" y="6.5" width="2" height="2" fill="#0a0e13" />
    <rect x="7" y="1" width="2" height="2.5" />
    <rect x="4.5" y="13" width="2.5" height="2" />
    <rect x="9" y="13" width="2.5" height="2" />
  </svg>
);

export const BuildingsIcon = () => (
  <svg {...S} aria-label="buildings">
    <path d="M1 15V8l4-2v2l4-2v2l4-2v9z" />
    <rect x="3" y="10" width="2" height="2" fill="#0a0e13" />
    <rect x="7" y="10" width="2" height="2" fill="#0a0e13" />
    <rect x="11" y="10" width="2" height="2" fill="#0a0e13" />
  </svg>
);

export const DamageIcon = () => (
  <svg {...S} aria-label="damage">
    <path d="M8 0l1.8 4.6L14 3l-2.4 3.9L16 8l-4.4 1.1L14 13l-4.2-1.6L8 16l-1.8-4.6L2 13l2.4-3.9L0 8l4.4-1.1L2 3l4.2 1.6z" />
  </svg>
);

export const ClockIcon = () => (
  <svg {...S} aria-label="time">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M8 4v4.5l3 1.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

/* ------------------------------------------------------------------------
   Command-post glyph library. Line drawings on a 24x24 grid, stroke only,
   so they stay legible at 16-48px on graphite. A glyph is an image with a
   label unless the caller marks it decorative (text beside it already says
   what it is). */

export interface GlyphProps {
  size?: number;
  /** Accessible label; defaults to the type name. */
  label?: string;
  /** True when adjacent text already names the thing. */
  decorative?: boolean;
  className?: string;
}

function Glyph({ size = 20, label, decorative, className, children }: GlyphProps & {
  label: string; children: ReactNode;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}
         fill="none" stroke="currentColor" strokeWidth={1.6}
         strokeLinecap="round" strokeLinejoin="round"
         role={decorative ? undefined : "img"}
         aria-label={decorative ? undefined : label}
         aria-hidden={decorative ? true : undefined}>
      {children}
    </svg>
  );
}

/** The whole cast, engine keys, in roster order (nothing removed). */
export const UNIT_GLYPH_TYPES = [
  "worker", "striker", "launcher", "rider", "wasp", "walking_tower", "drone_swarm",
  "colossus", "human", "spark", "anvil", "watcher", "leech", "prism", "survivor",
] as const;

const UNIT_PATHS: Record<string, ReactNode> = {
  // mechanical worker: torso, rescue claw on the right, cargo crate at its feet
  worker: <>
    <rect x="9" y="3" width="6" height="4" rx="1" />
    <path d="M8 8h8v7H8z" />
    <path d="M16 10.5l3.5-1.5 1 2-2.5 1.5M16 12.5l3 1.5" />
    <path d="M9 15l-1 6M15 15l1 6" />
    <rect x="2.5" y="13" width="4.5" height="4.5" />
  </>,
  // assault endoskeleton: spine, open ribs, blade arm
  striker: <>
    <circle cx="12" cy="3.5" r="1.6" />
    <path d="M12 5.5v10.5" />
    <path d="M9 8.5h6M9.5 11.5h5" />
    <path d="M12 16l-3.5 5.5M12 16l3.5 5.5" />
    <path d="M14.5 9.5l5-5M18 4l2 2" />
  </>,
  // bipedal platform with a rocket tube on the shoulder
  launcher: <>
    <circle cx="8" cy="7" r="2" />
    <path d="M5.5 10h11v4.5h-11z" />
    <path d="M16.5 12h4.5M19 10.5l2 1.5-2 1.5" />
    <path d="M8 14.5l-2 6.5M14 14.5l2 6.5" />
  </>,
  // fast two-wheeler
  rider: <>
    <circle cx="6" cy="16" r="3.5" />
    <circle cx="18" cy="16" r="3.5" />
    <path d="M6 16l4-8h6l2 8M10 8l-2-3M14 8h4.5" />
  </>,
  // small attack aircraft: rotor, hull, ventral gun
  wasp: <>
    <path d="M4 5.5h16M12 5.5v3" />
    <path d="M7 12.5a5 4 0 0110 0 5 4 0 01-10 0z" />
    <path d="M12 16.5v4M12 20.5l-2 2M12 20.5l2 2" />
  </>,
  // tall four-legged siege walker with a long barrel
  walking_tower: <>
    <rect x="8" y="4" width="8" height="6" />
    <path d="M16 7h6" />
    <path d="M9 10l-4.5 11M15 10l4.5 11M11 10l-1 11M13 10l1 11" />
  </>,
  // several coordinated drones
  drone_swarm: <>
    <circle cx="7" cy="8" r="2.5" /><path d="M4 4.5h6" />
    <circle cx="17" cy="8" r="2.5" /><path d="M14 4.5h6" />
    <circle cx="12" cy="16.5" r="2.5" /><path d="M9 13h6" />
  </>,
  // massive fusion unit
  colossus: <>
    <path d="M9 3h6" />
    <rect x="7" y="6" width="10" height="10" rx="1" />
    <path d="M7 9H3v5M17 9h4v5" />
    <path d="M9 16v5M15 16v5" />
  </>,
  // armed human: helmet, rifle across the shoulder
  human: <>
    <circle cx="12" cy="5" r="2.5" />
    <path d="M9 4.5h6" />
    <path d="M12 8v8M12 16l-3 5.5M12 16l3 5.5M12 10.5l-4 3M12 10.5l4 2" />
    <path d="M15 12.5l6-5.5" />
  </>,
  // light discharge machine
  spark: <>
    <path d="M13 2.5L7 13h5l-1 8.5L17 11h-5z" />
  </>,
  // heavy armour block
  anvil: <>
    <path d="M4 7.5h16l-3 4.5h-4v4h4v3H7v-3h4v-4H8z" />
  </>,
  // unarmed aerial scout: sensor ring
  watcher: <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
  </>,
  // infiltrator with a segmented capture probe
  leech: <>
    <path d="M4 12a5 4 0 0110 0 5 4 0 01-10 0z" />
    <path d="M14 12h3l2 3 2.5-1" />
    <path d="M6 15.5l-2 3.5M9 16v4M12 15.5l2 3.5M6 8.5L4 5M9 8V4M12 8.5l2-3.5" />
  </>,
  // optical emitter
  prism: <>
    <path d="M12 4l8 14H4z" />
    <path d="M12 9v5M9.5 14h5" />
    <path d="M19.5 5.5l2-2M4.5 5.5l-2-2" />
  </>,
  // neutral survivor: slumped, empty-handed, no helmet
  survivor: <>
    <circle cx="12" cy="6" r="2.5" />
    <path d="M12 9v7M12 16l-3 5.5M12 16l3 5.5M12 11l-3.5 4.5M12 11l3.5 4.5" />
  </>,
};

export const BUILDING_GLYPH_TYPES = [
  "core", "cocoon", "rack", "depot", "assembler", "lab", "turret", "wall", "camp",
] as const;

const BUILDING_PATHS: Record<string, ReactNode> = {
  core: <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <circle cx="12" cy="12" r="3" />
  </>,
  cocoon: <>
    <rect x="7" y="3" width="10" height="18" rx="5" />
    <circle cx="12" cy="9" r="1.5" /><circle cx="12" cy="15" r="1.5" />
  </>,
  rack: <>
    <rect x="5" y="3" width="14" height="18" rx="1" />
    <path d="M8 7h8M8 11h8M8 15h8M8 19h4" />
  </>,
  depot: <>
    <path d="M4 9l8-4 8 4v10l-8 4-8-4z" />
    <path d="M4 9l8 4 8-4M12 13v10" />
  </>,
  assembler: <>
    <path d="M3 20V9l5 3V9l5 3V9l5 3v8z" />
    <circle cx="16.5" cy="5.5" r="2.5" />
  </>,
  lab: <>
    <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" />
    <path d="M8 16h8" />
  </>,
  turret: <>
    <path d="M5 21v-6h14v6" />
    <circle cx="12" cy="11" r="3" />
    <path d="M14 9l6-5" />
  </>,
  wall: <>
    <path d="M3 6h18v12H3z" />
    <path d="M3 12h18M9 6v6M15 6v6M6 12v6M12 12v6M18 12v6" />
  </>,
  camp: <>
    <path d="M3 20L12 4l9 16z" />
    <path d="M9 20l3-6 3 6" />
  </>,
};

const TERRAIN_PATHS: Record<string, ReactNode> = {
  vein: <>
    <path d="M3 20l4-9 4 4 3-8 4 6 3 7z" />
    <path d="M10 11l1.5 4" />
  </>,
  pod: <>
    <rect x="3.5" y="6" width="5" height="14" rx="2.5" />
    <rect x="9.5" y="3" width="5" height="17" rx="2.5" />
    <rect x="15.5" y="7" width="5" height="13" rx="2.5" />
  </>,
  scrap: <>
    <path d="M4 18l6-6 3 3-6 6z" />
    <path d="M13 5l6 6M11 7.5l6 6M16 4l4 4" />
  </>,
  rubble: <>
    <path d="M3 19h18" />
    <path d="M5 19l3-6 4 3 3-5 4 8" />
  </>,
  blocked: <>
    <path d="M4 20L12 5l8 15z" />
    <path d="M9 14h6" />
  </>,
  field: <>
    <path d="M12 21s-6-6-6-11a6 6 0 0112 0c0 5-6 11-6 11z" />
    <circle cx="12" cy="10" r="2" />
  </>,
};

const fallback = <>
  <rect x="5" y="5" width="14" height="14" rx="2" />
  <path d="M9 12h6M12 9v6" />
</>;

const nice = (type: string) => type.replace(/_/g, " ");

export function UnitGlyph({ type, label, ...rest }: GlyphProps & { type: string }) {
  return <Glyph label={label ?? nice(type)} {...rest}>{UNIT_PATHS[type] ?? fallback}</Glyph>;
}

export function BuildingGlyph({ type, label, ...rest }: GlyphProps & { type: string }) {
  return <Glyph label={label ?? nice(type)} {...rest}>{BUILDING_PATHS[type] ?? fallback}</Glyph>;
}

export function TerrainGlyph({ terrain, label, ...rest }: GlyphProps & { terrain: string }) {
  return <Glyph label={label ?? nice(terrain)} {...rest}>{TERRAIN_PATHS[terrain] ?? TERRAIN_PATHS.field}</Glyph>;
}

/** Units and buildings both resolve; unknown keys get a neutral placeholder. */
export function EntityGlyph({ type, ...rest }: GlyphProps & { type: string }) {
  if (type in BUILDING_PATHS) return <BuildingGlyph type={type} {...rest} />;
  return <UnitGlyph type={type} {...rest} />;
}

/* Small utility glyphs for the command post (13px, like the resource set). */

export const HumansIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="humans">
    <circle cx="5.5" cy="4.5" r="2" /><circle cx="11" cy="4.5" r="2" />
    <path d="M1.5 14c0-3 1.8-4.5 4-4.5s4 1.5 4 4.5M9.5 9.8c.5-.2 1-.3 1.5-.3 2.2 0 4 1.5 4 4.5" />
  </svg>
);

export const CargoIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="cargo">
    <path d="M2 5.5l6-3 6 3v6l-6 3-6-3z" /><path d="M2 5.5l6 3 6-3M8 8.5v6" />
  </svg>
);

export const SignalIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="link">
    <path d="M2 11a8.5 8.5 0 0112 0M4.5 13.5a5 5 0 017 0" /><circle cx="8" cy="15" r="1" fill="currentColor" />
  </svg>
);

export const BookIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="manual">
    <path d="M2.5 2.5h5a2 2 0 012 2v9a1.5 1.5 0 00-1.5-1.5h-5.5zM13.5 2.5h-5a2 2 0 00-2 2v9a1.5 1.5 0 011.5-1.5h5.5z" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.8" aria-label="close">
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
);

export const FirmwareIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="firmware">
    <rect x="4" y="4" width="8" height="8" rx="1" /><rect x="6.5" y="6.5" width="3" height="3" />
    <path d="M6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3" />
  </svg>
);

export const ScoreIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="score">
    <path d="M3.5 15V2M3.5 2.5h9l-2.5 3 2.5 3h-9" />
  </svg>
);

export const CrewIcon = () => (
  <svg {...S} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="crew">
    <path d="M2.5 13.5l5-5M9 3.5a3 3 0 014 4l-1.5.5-2.5-2.5z" /><path d="M7.5 8.5l1.5 1.5" />
  </svg>
);
