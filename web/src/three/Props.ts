import * as THREE from "three";
import type { Feature } from "./Features";
import { terrainHash } from "./Landscape";

/** Geometry and material kit shared by every terrain prop. All positions are
 *  world coordinates: a human is 1.24 tile units tall, so a tile is about
 *  1.4 m - a car is 2.7 tiles long, a house floor 1.9 tiles high, a tree 4. */
export interface PropKit {
  box: THREE.BufferGeometry;
  cylinder: THREE.BufferGeometry;
  sphere: THREE.BufferGeometry;
  boulder: THREE.BufferGeometry;
  /** Six-sided cylinder for bones, rebar and thin rods. */
  rod: THREE.BufferGeometry;
  concrete: THREE.Material;
  plaster: THREE.Material[];
  steel: THREE.Material;
  dark: THREE.Material;
  rust: THREE.Material;
  bone: THREE.Material;
  glow: THREE.Material;
  skin: THREE.Material;
  rock: THREE.Material;
  trunk: THREE.Material;
  canopy: THREE.Material[];
  paint: THREE.Material[];
  roofing: THREE.Material[];
  glass: THREE.Material;
  /** Emissive flame and charred wood/plaster. */
  fire: THREE.Material;
  char: THREE.Material;
  elevation(x: number, z: number): number;
  seed: number;
}

/** What is on fire right now - one rule, shared by the flames (Props) and the
 *  smoke (WorldRenderer). */
export function isBurning(feature: Feature, seed: number): boolean {
  const roll = terrainHash(feature.minX, feature.minY, seed + 5);
  switch (feature.kind) {
    case "house": return roll > 0.72;
    case "ruin": return roll > 0.7;
    case "jam": return roll > 0.75;
    case "grove": return roll > 0.45;
    case "farm": return roll > 0.45;
    default: return false;
  }
}

type Vec3 = [number, number, number];

class Builder {
  constructor(readonly group: THREE.Group, readonly kit: PropKit) {}

  add(geometry: THREE.BufferGeometry, material: THREE.Material, position: Vec3, scale: Vec3, rotation?: Vec3): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** A sub-frame at a world point with a heading, so a car or a skeleton can be
   *  modelled around its own origin and dropped anywhere. */
  frame(x: number, y: number, z: number, heading: number): Builder {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.rotation.y = heading;
    this.group.add(pivot);
    return new Builder(pivot as THREE.Group, this.kit);
  }
}

function rng(seed: number, salt: number, index = 0): number {
  return terrainHash(salt * 131 + index, salt + 7, seed);
}

/** A tongue of flame: three tapering emissive lumps, biggest at the bottom. */
function addFire(build: Builder, x: number, y: number, z: number, scale: number, seed: number, salt: number): void {
  const roll = (index: number) => rng(seed, salt, index);
  for (let tongue = 0; tongue < 3; tongue++) {
    const width = scale * (0.2 - tongue * 0.045);
    build.add(build.kit.boulder, build.kit.fire,
      [x + (roll(tongue) - 0.5) * 0.3 * scale, y + scale * (0.22 + tongue * 0.12), z + (roll(10 + tongue) - 0.5) * 0.3 * scale],
      [width, scale * (0.32 + roll(20 + tongue) * 0.25), width], [roll(30 + tongue) * 0.4, roll(40 + tongue) * 6, roll(50 + tongue) * 0.4]);
  }
}

// ------------------------------------------------------------------ houses

export function buildHouse(group: THREE.Group, feature: Feature, kit: PropKit, size: number): void {
  const build = new Builder(group, kit);
  const width = feature.maxX - feature.minX + 1;
  const depth = feature.maxY - feature.minY + 1;
  const area = width * depth;
  const salt = feature.minY * 1000 + feature.minX;
  const roll = (index: number) => rng(kit.seed, salt, index);
  // The bigger lots are the taller buildings, and those are the ones the war
  // left as concrete skeletons cut in half.
  if (area >= 20 && roll(9) < 0.45) {
    buildRuin(group, feature, kit, size);
    return;
  }
  const centreX = feature.minX + width / 2;
  const centreZ = feature.minY + depth / 2;
  const base = kit.elevation(centreX, centreZ);
  // A suburb: mostly one- and two-storey homes, the odd small apartment block.
  const apartment = area >= 20 && roll(6) < 0.14;
  const floors = apartment ? 3 + Math.floor(roll(1) * 2) : 1 + Math.floor(roll(1) * 2) + (area >= 24 && roll(7) < 0.3 ? 1 : 0);
  const floorHeight = 1.9;
  const height = floors * floorHeight;
  // This is a war going on: nothing is intact. Burnt houses are black inside
  // and out, with the roof gone; some are still burning.
  const burnt = roll(30) < 0.6;
  const burning = isBurning(feature, kit.seed);
  const damage = burnt ? 0.55 + roll(2) * 0.35 : 0.45 + roll(2) * 0.4;
  const wall = burnt ? kit.char : kit.plaster[Math.floor(roll(3) * kit.plaster.length)];
  const roofing = kit.roofing[Math.floor(roll(8) * kit.roofing.length)];
  const gable = !apartment && floors <= 2;
  const thickness = 0.2;
  const slabChunk = (x: number, y: number, z: number, index: number) => build.add(kit.box, roll(index + 3) < 0.65 ? kit.concrete : kit.dark,
    [x, y, z], [0.28 + roll(index) * 0.35, 0.07 + roll(index + 1) * 0.08, 0.22 + roll(index + 2) * 0.3],
    [(roll(index + 4) - 0.5) * 0.5, roll(index + 5) * 3, (roll(index + 6) - 0.5) * 0.5]);
  // Slab and a low plinth that swallows the ground's small slopes.
  build.add(kit.box, kit.concrete, [centreX, base - 0.18, centreZ], [width - 0.08, 0.5, depth - 0.08]);
  // Walls: one segment per tile per side. Every segment survives on its own
  // (hash), so a house is missing a corner here, a whole side there.
  const sides: { along: "x" | "z"; fixed: number; count: number; from: number; out: number }[] = [
    { along: "x", fixed: feature.minY + thickness / 2, count: width, from: feature.minX, out: -1 },
    { along: "x", fixed: feature.maxY + 1 - thickness / 2, count: width, from: feature.minX, out: 1 },
    { along: "z", fixed: feature.minX + thickness / 2, count: depth, from: feature.minY, out: -1 },
    { along: "z", fixed: feature.maxX + 1 - thickness / 2, count: depth, from: feature.minY, out: 1 },
  ];
  const doorSide = Math.floor(roll(4) * 4);
  const doorSegment = Math.floor(roll(5) * 3);
  sides.forEach((side, sideIndex) => {
    for (let segment = 0; segment < side.count; segment++) {
      const along = side.from + segment + 0.5;
      const position = (y: number): Vec3 => side.along === "x" ? [along, y, side.fixed] : [side.fixed, y, along];
      const scale = (h: number, len = 1.02): Vec3 => side.along === "x" ? [len, h, thickness] : [thickness, h, len];
      const survives = roll(10 + sideIndex * 40 + segment) > damage;
      if (survives) {
        build.add(kit.box, wall, position(base + height / 2), scale(height));
        // Floor-line ledges and a darker plinth give the facade some relief.
        for (let floor = 1; floor < floors; floor++) {
          const p = position(base + floor * floorHeight);
          build.add(kit.box, kit.concrete, [p[0] + (side.along === "z" ? side.out * 0.03 : 0), p[1], p[2] + (side.along === "x" ? side.out * 0.03 : 0)],
            side.along === "x" ? [1.02, 0.08, thickness + 0.06] : [thickness + 0.06, 0.08, 1.02]);
        }
        const plinth = position(base + 0.16);
        build.add(kit.box, kit.concrete, [plinth[0] + (side.along === "z" ? side.out * 0.02 : 0), plinth[1], plinth[2] + (side.along === "x" ? side.out * 0.02 : 0)],
          side.along === "x" ? [1.02, 0.32, thickness + 0.04] : [thickness + 0.04, 0.32, 1.02]);
        for (let floor = 0; floor < floors; floor++) {
          const isDoor = floor === 0 && sideIndex === doorSide && segment === doorSegment;
          if (!isDoor && roll(200 + sideIndex * 40 + segment * 4 + floor) < 0.35) continue;
          const y = base + floor * floorHeight + (isDoor ? 0.95 : 1.05);
          const pane = isDoor ? [0.62, 1.7] : [0.6, 0.72];
          const proud = side.along === "x" ? [0, 0, side.out * 0.03] : [side.out * 0.03, 0, 0];
          const p = position(y);
          build.add(kit.box, isDoor ? kit.dark : kit.glass,
            [p[0] + proud[0], p[1], p[2] + proud[2]],
            side.along === "x" ? [pane[0], pane[1], thickness + 0.04] : [thickness + 0.04, pane[1], pane[0]]);
          // Soot licks up the wall above a window where the fire got out.
          if (!isDoor && (burnt || roll(250 + sideIndex * 40 + segment * 4 + floor) < 0.3)) {
            build.add(kit.box, kit.char, [p[0] + proud[0] * 1.3, p[1] + 0.62, p[2] + proud[2] * 1.3],
              side.along === "x" ? [0.72, 0.5, thickness + 0.05] : [thickness + 0.05, 0.5, 0.72]);
          }
        }
      } else {
        const stub = 0.25 + roll(300 + sideIndex * 40 + segment) * Math.min(1.4, height * 0.45);
        build.add(kit.box, wall, position(base + stub / 2), scale(stub, 0.9), [0, 0, (roll(400 + segment) - 0.5) * 0.12]);
        for (let rod = 0; rod < 2; rod++) {
          const p = position(base + stub + 0.22);
          build.add(kit.rod, kit.rust, [p[0] + (rod - 0.5) * 0.3, p[1], p[2]], [0.015, 0.5, 0.015],
            [(roll(500 + segment + rod) - 0.5) * 0.9, 0, (roll(520 + segment + rod) - 0.5) * 0.9]);
        }
        // What fell off the wall lies at its foot: broken slabs, not stones.
        for (let chunk = 0; chunk < 2; chunk++) {
          const p = position(base + 0.06);
          const spread = (roll(600 + segment + chunk * 7) - 0.5) * 0.9;
          const outward = side.out * (0.35 + roll(650 + segment) * 0.5);
          const [x, z] = side.along === "x" ? [p[0] + spread, p[2] + outward] : [p[0] + outward, p[2] + spread];
          slabChunk(x, p[1], z, 700 + sideIndex * 50 + segment * 3 + chunk);
        }
      }
    }
  });
  // Floor slabs and the roof. A damaged house loses part of its top slab: it
  // hangs, tilted, over the rooms below.
  for (let floor = 1; floor <= floors; floor++) {
    const y = base + floor * floorHeight;
    const top = floor === floors;
    const broken = top && damage > 0.42 || !top && roll(800 + floor) < damage * 0.6;
    if (top && gable) {
      // Pitched roof along the long axis; a damaged house keeps one slope.
      const alongX = width >= depth;
      const span = alongX ? depth : width;
      const long = alongX ? width : depth;
      const rise = 0.35 + span * 0.12;
      const angle = Math.atan2(rise, span / 2);
      const slope = Math.hypot(span / 2, rise) + 0.18;
      build.add(kit.box, kit.concrete, [centreX, y, centreZ], [width - 0.1, 0.14, depth - 0.1]);
      build.add(kit.box, wall, [centreX, y + rise / 2, centreZ], alongX ? [long - 0.2, rise, span * 0.5] : [span * 0.5, rise, long - 0.2]);
      for (const half of [-1, 1]) {
        if (damage > 0.42 && half === (roll(830) < 0.5 ? -1 : 1)) {
          for (let rod = 0; rod < 3; rod++) {
            build.add(kit.rod, kit.rust, alongX ? [centreX + (rod - 1) * long * 0.3, y + rise * 0.6, centreZ + half * span * 0.3]
              : [centreX + half * span * 0.3, y + rise * 0.6, centreZ + (rod - 1) * long * 0.3], [0.014, 0.6, 0.014],
              alongX ? [half * (angle + 0.4), 0, 0] : [0, 0, -half * (angle + 0.4)]);
          }
          continue;
        }
        const offset = half * span / 4;
        build.add(kit.box, roofing,
          alongX ? [centreX, y + rise / 2 + 0.05, centreZ + offset] : [centreX + offset, y + rise / 2 + 0.05, centreZ],
          alongX ? [long + 0.3, 0.1, slope] : [slope, 0.1, long + 0.3],
          // Rotating about x by +a tips the +z end down; about z by -a tips +x down.
          alongX ? [half * angle, 0, 0] : [0, 0, -half * angle]);
      }
      if (roll(902) > 0.5) build.add(kit.box, kit.concrete, [centreX + long * 0.2 * (alongX ? 1 : 0), y + rise + 0.25, centreZ + long * 0.2 * (alongX ? 0 : 1)], [0.35, 0.8, 0.35]);
    } else if (!broken) {
      build.add(kit.box, kit.concrete, [centreX, y, centreZ], [width - 0.1, 0.14, depth - 0.1]);
      if (top) {
        // Parapet and a rooftop box (stairwell / water tank).
        build.add(kit.box, wall, [centreX, y + 0.2, feature.minY + 0.12], [width - 0.05, 0.3, 0.14]);
        build.add(kit.box, wall, [centreX, y + 0.2, feature.maxY + 0.88], [width - 0.05, 0.3, 0.14]);
        if (roll(900) > 0.5) build.add(kit.box, kit.concrete, [centreX - width * 0.2, y + 0.45, centreZ], [1.1, 0.8, 1.2]);
        if (roll(901) > 0.55) build.add(kit.cylinder, kit.rust, [centreX + width * 0.25, y + 0.55, centreZ + depth * 0.2], [0.35, 0.9, 0.35]);
      }
    } else {
      const keep = 0.35 + roll(820 + floor) * 0.35;
      const slab = build.add(kit.box, kit.concrete,
        [feature.minX + width * keep / 2 + 0.05, y - (1 - keep) * 0.35, centreZ],
        [width * keep, 0.14, depth - 0.1]);
      slab.rotation.z = -(1 - keep) * 0.5;
      for (let rod = 0; rod < 3; rod++) {
        build.add(kit.rod, kit.rust, [feature.minX + width * keep + 0.15, y - 0.25, feature.minY + 0.5 + rod * (depth - 1) / 2],
          [0.014, 0.7, 0.014], [0, 0, 1.2 + roll(840 + rod) * 0.6]);
      }
    }
  }
  // Interior rubble where the roof gave way.
  const fallen = 2 + Math.floor(damage * 6);
  for (let chunk = 0; chunk < fallen; chunk++) {
    slabChunk(feature.minX + 0.5 + roll(950 + chunk) * (width - 1), base + 0.08,
      feature.minY + 0.5 + roll(970 + chunk) * (depth - 1), 990 + chunk * 7);
  }
  if (burning) {
    for (let flame = 0; flame < 2 + Math.floor(roll(1200) * 2); flame++) {
      addFire(build, feature.minX + 0.7 + roll(1210 + flame) * (width - 1.4), base + (roll(1230 + flame) < 0.5 ? 0.1 : height - 0.4),
        feature.minY + 0.7 + roll(1220 + flame) * (depth - 1.4), 0.9 + roll(1240 + flame) * 0.6, kit.seed, salt + 300 + flame);
    }
  }
}

// -------------------------------------------------------------------- cars

function buildCar(build: Builder, kind: "car" | "van" | "bus" | "bike" | "chassis", seed: number, salt: number): void {
  const kit = build.kit;
  const roll = (index: number) => rng(seed, salt, index);
  const burned = roll(1) < 0.68;
  const paint = burned ? kit.dark : kit.paint[Math.floor(roll(2) * kit.paint.length)];
  const glass = burned ? kit.dark : kit.glass;
  const flipped = kind !== "bus" && kind !== "bike" && roll(3) < 0.12;
  // Crushed: the roof came down; the whole car sits lower and leans.
  const crushed = !flipped && kind !== "bike" && kind !== "chassis" && roll(8) < 0.5;
  const body = flipped ? build.frame(0, 0.95, 0, 0) : crushed ? build.frame(0, 0, 0, 0) : build;
  if (flipped) body.group.rotation.z = Math.PI + (roll(4) - 0.5) * 0.3;
  if (crushed) {
    body.group.scale.y = 0.62;
    body.group.rotation.z = (roll(9) - 0.5) * 0.3;
    body.group.rotation.x = (roll(10) - 0.5) * 0.12;
  }
  // Doors torn off lie beside the car; a wheel or two got away.
  if (kind !== "bike" && kind !== "chassis" && roll(11) < 0.6) {
    build.add(kit.box, paint, [(roll(12) < 0.5 ? -1 : 1) * 1.05, 0.05, (roll(13) - 0.5) * 1.6], [0.9, 0.04, 0.55], [0, roll(14) * 1.2, 0.1]);
  }
  if (kind !== "bike" && roll(15) < 0.3) {
    build.add(kit.cylinder, kit.dark, [(roll(16) < 0.5 ? -1 : 1) * 1.1, 0.12, -1.2 - roll(17) * 0.6], [0.24, 0.18, 0.24], [0.3, roll(18) * 3, Math.PI / 2]);
  }
  const wheel = (x: number, z: number, radius = 0.24) =>
    body.add(kit.cylinder, kit.dark, [x, radius, z], [radius, 0.2, radius], [0, 0, Math.PI / 2]);
  if (kind === "bike") {
    wheel(0, 0.42, 0.22);
    wheel(0, -0.42, 0.22);
    body.add(kit.box, paint, [0, 0.42, 0], [0.16, 0.2, 0.9], [0.15, 0, 0]);
    body.add(kit.cylinder, kit.steel, [0, 0.55, 0.32], [0.02, 0.5, 0.02], [0.6, 0, 0]);
    body.group.rotation.z = 1.35;
    body.group.position.y = -0.05;
    return;
  }
  if (kind === "chassis") {
    // A burnt-out shell: body and cabin gone black, two wheels missing, sagging.
    body.add(kit.box, kit.dark, [0, 0.3, 0], [1.05, 0.34, 1.9], [0, 0, 0.1]);
    body.add(kit.box, kit.rust, [0, 0.62, -0.15], [0.85, 0.32, 1.0], [0.05, 0, 0.1]);
    body.add(kit.box, kit.dark, [0, 0.78, -0.15], [0.7, 0.03, 0.8], [0, 0, 0.1]);
    body.add(kit.cylinder, kit.rust, [0.5, 0.22, 0.6], [0.22, 0.18, 0.22], [0, 0, Math.PI / 2]);
    body.add(kit.cylinder, kit.dark, [-0.55, 0.22, -0.6], [0.24, 0.2, 0.24], [0.3, 0, Math.PI / 2]);
    body.add(kit.rod, kit.rust, [0.3, 0.15, -0.6], [0.03, 0.9, 0.03], [0, 0, Math.PI / 2]);
    return;
  }
  const length = kind === "bus" ? 5.2 : kind === "van" ? 3.3 : 2.7;
  const width = kind === "bus" ? 1.25 : 1.15;
  const axle = kind === "bus" ? 1.9 : length * 0.32;
  for (const side of [-1, 1]) for (const end of [-1, 1]) wheel(side * (width / 2 - 0.02), end * axle);
  if (kind === "bus") {
    body.add(kit.box, paint, [0, 0.95, 0], [width, 1.4, length]);
    for (const side of [-1, 1]) body.add(kit.box, glass, [side * (width / 2 + 0.01), 1.15, 0.2], [0.03, 0.6, length - 1.2]);
    body.add(kit.box, glass, [0, 1.15, length / 2 + 0.01], [width - 0.2, 0.7, 0.03]);
    body.add(kit.box, kit.dark, [0, 0.28, 0], [width + 0.05, 0.12, length - 0.3]);
    if (roll(5) < 0.5) body.add(kit.box, paint, [width / 2 + 0.5, 0.75, -length * 0.25], [0.9, 0.04, 1.4], [0, 0.3, 1.0]);
    return;
  }
  // Lower body, cabin, glass, hood and trunk lines.
  body.add(kit.box, paint, [0, 0.45, 0], [width, 0.46, length]);
  // Nothing drives any more: rust eating through the panels, dents and soot.
  for (let patch = 0; patch < 2 + Math.floor(roll(60) * 3); patch++) {
    const side = roll(61 + patch) < 0.5 ? -1 : 1;
    body.add(kit.box, roll(62 + patch) < 0.55 ? kit.rust : kit.char,
      [side * (width / 2 + 0.005), 0.4 + roll(63 + patch) * 0.25, (roll(64 + patch) - 0.5) * length * 0.8],
      [0.02, 0.12 + roll(65 + patch) * 0.2, 0.25 + roll(66 + patch) * 0.5]);
  }
  if (roll(67) < 0.5) body.add(kit.box, kit.char, [0, 0.69, (roll(68) - 0.5) * length * 0.5], [width * 0.6, 0.02, 0.4 + roll(69) * 0.5]);
  body.add(kit.box, kit.dark, [0, 0.24, 0], [width - 0.1, 0.1, length - 0.2]);
  const cabinLength = kind === "van" ? length * 0.7 : length * 0.5;
  const cabinOffset = kind === "van" ? -length * 0.1 : -length * 0.05;
  body.add(kit.box, paint, [0, 0.88, cabinOffset], [width - 0.14, 0.42, cabinLength]);
  body.add(kit.box, glass, [0, 0.9, cabinOffset + cabinLength / 2 + 0.01], [width - 0.32, 0.3, 0.05], [-0.35, 0, 0]);
  body.add(kit.box, glass, [0, 0.9, cabinOffset - cabinLength / 2 - 0.01], [width - 0.32, 0.3, 0.05], [0.35, 0, 0]);
  for (const side of [-1, 1]) {
    body.add(kit.box, glass, [side * (width / 2 - 0.06), 0.9, cabinOffset], [0.03, 0.28, cabinLength - 0.3]);
    body.add(kit.box, kit.steel, [side * (width / 2 + 0.02), 0.62, cabinOffset + 0.1], [0.03, 0.02, cabinLength - 0.2]);
  }
  body.add(kit.box, kit.steel, [0, 0.32, length / 2 + 0.01], [width - 0.1, 0.12, 0.05]);
  body.add(kit.box, kit.steel, [0, 0.32, -length / 2 - 0.01], [width - 0.1, 0.12, 0.05]);
  body.add(kit.box, kit.glow, [-0.35, 0.5, length / 2 + 0.02], [0.18, 0.08, 0.02]);
  body.add(kit.box, kit.glow, [0.35, 0.5, length / 2 + 0.02], [0.18, 0.08, 0.02]);
  if (roll(6) < 0.35) body.add(kit.box, paint, [0, 0.95, length * 0.32], [width - 0.2, 0.03, length * 0.36], [-1.1, 0, 0]);
  if (roll(7) < 0.4) body.add(kit.box, paint, [width / 2 + 0.35, 0.5, cabinOffset + 0.2], [0.7, 0.4, 0.03], [0, 1.2, 0]);
  if (burned) {
    for (let scorch = 0; scorch < 3; scorch++) {
      body.add(kit.boulder, kit.dark, [(roll(20 + scorch) - 0.5) * 0.7, 0.72, (roll(30 + scorch) - 0.5) * length * 0.6],
        [0.2, 0.08, 0.25]);
    }
    if (roll(40) < 0.35) addFire(body, 0, 0.75, cabinOffset, 0.7, seed, salt + 9);
  }
}

/** A queue of wrecks on one lane: cars nose to tail, a van or a bus now and
 *  then, and whatever did not fit at the end of the run. */
export function buildJam(group: THREE.Group, feature: Feature, kit: PropKit): void {
  const build = new Builder(group, kit);
  const lane = feature.lane!;
  const start = feature.start!;
  const length = feature.length!;
  const salt = feature.minY * 1000 + feature.minX + 77;
  const roll = (index: number) => rng(kit.seed, salt, index);
  const across = lane.centre + lane.offset + 0.5;
  // Lanes flow in opposite directions; the middle lane is whoever swerved.
  const forward = lane.offset === 0 ? roll(0) < 0.5 : lane.offset > 0;
  let cursor = 0;
  let vehicle = 0;
  while (cursor < length) {
    const remaining = length - cursor;
    let kind: "car" | "van" | "bus" | "bike" | "chassis" = "car";
    let need = 3;
    if (remaining >= 6 && roll(100 + vehicle) < 0.16) { kind = "bus"; need = 6; }
    else if (remaining >= 4 && roll(120 + vehicle) < 0.22) { kind = "van"; need = 4; }
    else if (remaining < 3) { kind = roll(140 + vehicle) < 0.5 ? "bike" : "chassis"; need = remaining; }
    else if (roll(150 + vehicle) < 0.18) { kind = "chassis"; need = 3; }
    const along = start + cursor + need / 2;
    const jitter = (roll(160 + vehicle) - 0.5) * 0.2;
    const heading = (lane.horizontal ? Math.PI / 2 : 0) + (forward ? 0 : Math.PI) + (roll(180 + vehicle) - 0.5) * 0.28;
    const x = lane.horizontal ? along : across + jitter;
    const z = lane.horizontal ? across + jitter : along;
    buildCar(build.frame(x, kit.elevation(x, z), z, heading), kind, kit.seed, salt + vehicle * 13);
    cursor += need;
    vehicle++;
  }
  // Things that came off: tyres and doors on the asphalt, all along the queue.
  for (let part = 0; part < Math.max(2, Math.floor(length / 2)); part++) {
    const along = start + roll(300 + part) * length;
    const sideways = across + (roll(320 + part) - 0.5) * 0.9;
    const x = lane.horizontal ? along : sideways;
    const z = lane.horizontal ? sideways : along;
    const y = kit.elevation(x, z);
    if (roll(340 + part) < 0.5) build.add(kit.cylinder, kit.dark, [x, y + 0.1, z], [0.24, 0.18, 0.24], [0, roll(part) * 3, Math.PI / 2 + 0.2]);
    else build.add(kit.box, kit.paint[Math.floor(roll(360 + part) * kit.paint.length)], [x, y + 0.05, z], [0.9, 0.04, 0.5], [0, roll(part) * 3, 0.15]);
  }
}

// ------------------------------------------------------------------- trees

export function buildGrove(group: THREE.Group, feature: Feature, kit: PropKit, size: number): void {
  const build = new Builder(group, kit);
  const salt = feature.minY * 1000 + feature.minX + 991;
  const groveBurning = isBurning(feature, kit.seed);
  feature.tiles.forEach((index, order) => {
    const roll = (i: number) => rng(kit.seed, salt + order * 7, i);
    const x = index % size + 0.5 + (roll(1) - 0.5) * 0.5;
    const z = Math.floor(index / size) + 0.5 + (roll(2) - 0.5) * 0.5;
    const y = kit.elevation(x, z);
    // Living, dry and dead, charred, or still burning.
    const fate = roll(3);
    const alive = fate < (groveBurning ? 0.06 : 0.14);
    const charred = groveBurning ? fate > 0.45 : fate > 0.7;
    const flaming = groveBurning && fate > 0.62;
    const trunkHeight = charred ? 1.4 + roll(4) * 1.0 : 1.7 + roll(4) * 1.2;
    const trunkRadius = 0.12 + roll(5) * 0.08;
    build.add(kit.cylinder, charred ? kit.char : kit.trunk, [x, y + trunkHeight / 2, z], [trunkRadius, trunkHeight, trunkRadius],
      [(roll(6) - 0.5) * 0.12, 0, (roll(7) - 0.5) * 0.12]);
    if (flaming) addFire(build, x, y + trunkHeight * 0.55, z, 1.1 + roll(9) * 0.5, kit.seed, salt + order * 7 + 3);
    if (alive) {
      const canopy = kit.canopy[Math.floor(roll(8) * kit.canopy.length)];
      const spread = 0.85 + roll(9) * 0.5;
      build.add(kit.boulder, canopy, [x, y + trunkHeight + spread * 0.5, z], [spread, spread * 0.85, spread], [roll(10), roll(11) * 3, 0]);
      build.add(kit.boulder, canopy, [x + (roll(12) - 0.5) * 0.8, y + trunkHeight + spread * 0.15, z + (roll(13) - 0.5) * 0.8],
        [spread * 0.7, spread * 0.6, spread * 0.7], [roll(14), roll(15) * 3, 0]);
      if (roll(16) > 0.5) build.add(kit.boulder, canopy, [x + (roll(17) - 0.5) * 0.6, y + trunkHeight + spread * 0.9, z], [spread * 0.55, spread * 0.5, spread * 0.55]);
    } else {
      for (let branch = 0; branch < (charred ? 2 : 4) + Math.floor(roll(20) * 3); branch++) {
        const angle = roll(21 + branch) * Math.PI * 2;
        const tilt = 0.5 + roll(30 + branch) * 0.7;
        const length = 0.7 + roll(40 + branch) * 0.8;
        const height = trunkHeight * (0.55 + roll(50 + branch) * 0.45);
        build.add(kit.cylinder, charred ? kit.char : kit.trunk,
          [x + Math.sin(angle) * Math.sin(tilt) * length / 2, y + height + Math.cos(tilt) * length / 2, z + Math.cos(angle) * Math.sin(tilt) * length / 2],
          [trunkRadius * 0.45, length, trunkRadius * 0.45], [0, 0, 0]).rotation.setFromQuaternion(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(Math.sin(angle) * Math.sin(tilt), Math.cos(tilt), Math.cos(angle) * Math.sin(tilt)).normalize()));
      }
    }
  });
}

// ------------------------------------------------------------------- ruins

/** The concrete skeleton of a bigger building: a pillar at every tile corner,
 *  a slab per floor per tile, fragments of wall on the outside, rebar where
 *  the structure broke. Full height on one side, collapsed on the other, so
 *  it reads as a tower cut in half. Works on any tile shape. */
export function buildRuin(group: THREE.Group, feature: Feature, kit: PropKit, size: number): void {
  const build = new Builder(group, kit);
  const salt = feature.minY * 1000 + feature.minX + 4242;
  const roll = (index: number) => rng(kit.seed, salt, index);
  const tiles = new Set(feature.tiles);
  const width = feature.maxX - feature.minX + 1;
  const depth = feature.maxY - feature.minY + 1;
  const centreX = feature.minX + width / 2;
  const centreZ = feature.minY + depth / 2;
  const base = kit.elevation(centreX, centreZ) - 0.05;
  const burning = isBurning(feature, kit.seed);
  const floorHeight = 1.9;
  const maxFloors = feature.tiles.length >= 24 ? 4 + Math.floor(roll(1) * 3) : 3 + Math.floor(roll(1) * 2);
  const wall = kit.plaster[Math.floor(roll(3) * kit.plaster.length)];
  // Cut plane: how far a point is along a random direction across the lot.
  const angle = roll(2) * Math.PI * 2;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const corners = [[feature.minX, feature.minY], [feature.maxX + 1, feature.minY], [feature.minX, feature.maxY + 1], [feature.maxX + 1, feature.maxY + 1]]
    .map(([x, z]) => x * dx + z * dz);
  const low = Math.min(...corners);
  const span = Math.max(1, Math.max(...corners) - low);
  const floorsAt = (x: number, z: number) => {
    const along = (x * dx + z * dz - low) / span;
    const profile = THREE.MathUtils.clamp(1.25 - 1.9 * along, 0, 1);
    return Math.round(maxFloors * profile - rng(kit.seed, salt + 7, Math.round(x) * 131 + Math.round(z)) * 0.7);
  };
  const tileFloors = new Map<number, number>();
  for (const index of feature.tiles) {
    tileFloors.set(index, Math.max(0, floorsAt(index % size + 0.5, Math.floor(index / size) + 0.5)));
  }
  // Pillars on a two-tile column grid (plus the outer corners), as tall as the
  // tallest tile they touch.
  const pillars = new Map<string, number>();
  for (const index of feature.tiles) {
    const x = index % size;
    const z = Math.floor(index / size);
    const floors = tileFloors.get(index)!;
    for (const [cx, cz] of [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]]) {
      const onGrid = (cx - feature.minX) % 2 === 0 && (cz - feature.minY) % 2 === 0;
      const outerCorner = (cx === feature.minX || cx === feature.maxX + 1) && (cz === feature.minY || cz === feature.maxY + 1);
      if (!onGrid && !outerCorner) continue;
      const key = `${cx},${cz}`;
      pillars.set(key, Math.max(pillars.get(key) ?? 0, floors));
    }
  }
  let order = 0;
  for (const [key, floors] of pillars) {
    const [cx, cz] = key.split(",").map(Number);
    const r = (i: number) => rng(kit.seed, salt + 11, order * 17 + i);
    order++;
    const height = floors > 0 ? floors * floorHeight + 0.1 : 0.2 + r(1) * 0.8;
    build.add(kit.box, kit.concrete, [cx, base + height / 2, cz], [0.26, height, 0.26]);
    if (floors < maxFloors) {
      for (let rod = 0; rod < 2; rod++) {
        build.add(kit.rod, kit.rust, [cx + (rod - 0.5) * 0.12, base + height + 0.25, cz + (r(2 + rod) - 0.5) * 0.1], [0.014, 0.55, 0.014],
          [(r(4 + rod) - 0.5) * 0.8, 0, (r(6 + rod) - 0.5) * 0.8]);
      }
    }
  }
  // Slabs, edge walls and what fell down.
  feature.tiles.forEach((index, tile) => {
    const x = index % size;
    const z = Math.floor(index / size);
    const floors = tileFloors.get(index)!;
    const r = (i: number) => rng(kit.seed, salt + 13, tile * 41 + i);
    build.add(kit.box, kit.concrete, [x + 0.5, base + 0.08, z + 0.5], [1.0, 0.16, 1.0]);
    for (let floor = 1; floor <= floors; floor++) {
      const top = floor === floors && floors < maxFloors;
      const y = base + floor * floorHeight;
      if (top && r(floor) < 0.35) {
        // The broken top slab hangs tilted off its last intact edge.
        build.add(kit.box, kit.concrete, [x + 0.5, y - 0.25, z + 0.5], [0.9, 0.12, 0.7], [(r(floor + 20) - 0.5) * 0.8, 0, (r(floor + 30) - 0.5) * 0.8]);
        continue;
      }
      build.add(kit.box, kit.concrete, [x + 0.5, y, z + 0.5], [1.0, 0.12, 1.0]);
    }
    const edges: [number, number, boolean, number][] = [[x, z - 1, true, -1], [x, z + 1, true, 1], [x - 1, z, false, -1], [x + 1, z, false, 1]];
    edges.forEach(([nx, nz, alongX, out], edge) => {
      if (tiles.has(nz * size + nx)) return;
      for (let floor = 0; floor < floors; floor++) {
        const e = (i: number) => rng(kit.seed, salt + 17, tile * 97 + edge * 13 + floor * 3 + i);
        if (e(0) < 0.4) continue;
        const fragment = floor === floors - 1 && floors < maxFloors ? 0.4 + e(1) * 0.8 : 0.8 + e(1) * 1.0;
        const y = base + floor * floorHeight + 0.12 + fragment / 2;
        const px = alongX ? x + 0.5 : x + 0.5 + out * 0.42;
        const pz = alongX ? z + 0.5 + out * 0.42 : z + 0.5;
        build.add(kit.box, e(2) < 0.7 ? wall : kit.concrete, [px, y, pz], alongX ? [0.92, fragment, 0.16] : [0.16, fragment, 0.92]);
        if (fragment > 1.2 && e(3) < 0.5) {
          build.add(kit.box, kit.glass, alongX ? [px, y + 0.1, pz + out * 0.03] : [px + out * 0.03, y + 0.1, pz],
            alongX ? [0.5, 0.6, 0.16] : [0.16, 0.6, 0.5]);
        }
      }
    });
    const fallen = floors < maxFloors ? 2 + Math.floor(r(50) * 3) : Math.floor(r(50) * 2);
    for (let chunk = 0; chunk < fallen; chunk++) {
      build.add(kit.box, r(60 + chunk) < 0.6 ? kit.concrete : kit.dark, [x + 0.15 + r(70 + chunk) * 0.7, base + 0.22, z + 0.15 + r(80 + chunk) * 0.7],
        [0.25 + r(90 + chunk) * 0.35, 0.08 + r(100 + chunk) * 0.1, 0.2 + r(110 + chunk) * 0.3], [(r(120 + chunk) - 0.5) * 0.6, r(130 + chunk) * 3, (r(140 + chunk) - 0.5) * 0.6]);
    }
    if (burning && floors > 0 && r(150) < 0.14) {
      addFire(build, x + 0.5, base + (floors - (r(151) < 0.5 ? 1 : 0)) * floorHeight + 0.1, z + 0.5, 0.7 + r(152) * 0.4, kit.seed, salt + 500 + tile);
    }
  });
}

// ------------------------------------------------------------------- farms

/** A burnt smallholding on the edge of town: rows of charred crops, a fence,
 *  a shed that lost its roof, hay that is still smouldering, and the animals
 *  that did not get out. */
export function buildFarm(group: THREE.Group, feature: Feature, kit: PropKit, size: number): void {
  const build = new Builder(group, kit);
  const salt = feature.minY * 1000 + feature.minX + 7171;
  const roll = (index: number) => rng(kit.seed, salt, index);
  const tiles = new Set(feature.tiles);
  const burning = isBurning(feature, kit.seed);
  const rowsAlongX = roll(1) < 0.5;
  const shedTile = feature.tiles[Math.floor(roll(2) * feature.tiles.length)];
  const animals = new Set<number>();
  for (let pick = 0; pick < 2 + Math.floor(roll(3) * 2); pick++) animals.add(feature.tiles[Math.floor(roll(10 + pick) * feature.tiles.length)]);
  feature.tiles.forEach((index, order) => {
    const r = (i: number) => rng(kit.seed, salt + order * 19, i);
    const x = index % size;
    const z = Math.floor(index / size);
    const y = kit.elevation(x + 0.5, z + 0.5);
    // Crop rows: charred stubble in lines, a few stalks still standing.
    for (let row = 0; row < 3; row++) {
      const offset = 0.2 + row * 0.3;
      const scorched = r(20 + row) < 0.75;
      build.add(kit.box, scorched ? kit.char : kit.trunk,
        rowsAlongX ? [x + 0.5, y + 0.07, z + offset] : [x + offset, y + 0.07, z + 0.5],
        rowsAlongX ? [0.96, 0.14, 0.12] : [0.12, 0.14, 0.96]);
      if (!scorched) {
        for (let stalk = 0; stalk < 3; stalk++) {
          const along = 0.15 + stalk * 0.32 + r(30 + row * 3 + stalk) * 0.1;
          build.add(kit.rod, kit.trunk, rowsAlongX ? [x + along, y + 0.3, z + offset] : [x + offset, y + 0.3, z + along], [0.02, 0.45, 0.02],
            [(r(40 + stalk) - 0.5) * 0.4, 0, (r(50 + stalk) - 0.5) * 0.4]);
        }
      }
    }
    // Fence posts and rails along the outside edges (with gaps burnt through).
    const edges: [number, number, boolean, number][] = [[x, z - 1, true, 0], [x, z + 1, true, 1], [x - 1, z, false, 0], [x + 1, z, false, 1]];
    edges.forEach(([nx, nz, alongX, far], edge) => {
      if (tiles.has(nz * size + nx) || r(60 + edge) < 0.3) return;
      const px = alongX ? x + 0.5 : x + far * 0.96 + 0.02;
      const pz = alongX ? z + far * 0.96 + 0.02 : z + 0.5;
      const material = r(70 + edge) < 0.5 ? kit.char : kit.trunk;
      build.add(kit.rod, material, alongX ? [x + 0.1, y + 0.4, pz] : [px, y + 0.4, z + 0.1], [0.04, 0.8, 0.04]);
      build.add(kit.box, material, [px, y + 0.62, pz], alongX ? [1.0, 0.05, 0.04] : [0.04, 0.05, 1.0]);
      build.add(kit.box, material, [px, y + 0.32, pz], alongX ? [1.0, 0.05, 0.04] : [0.04, 0.05, 1.0]);
    });
    if (animals.has(index)) {
      // A dead cow on its side: body, head, legs in the air.
      const cow = build.frame(x + 0.5, y, z + 0.5, r(80) * Math.PI * 2);
      const hide = r(81) < 0.4 ? kit.char : kit.trunk;
      cow.add(kit.box, hide, [0, 0.3, 0], [0.55, 0.5, 1.05], [0, 0, 1.2]);
      cow.add(kit.box, hide, [-0.05, 0.22, 0.72], [0.3, 0.28, 0.42], [0, 0, 1.2]);
      for (const [dx, dz] of [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.3], [0.12, -0.3]]) {
        cow.add(kit.rod, hide, [0.45 + dx, 0.45, dz], [0.045, 0.5, 0.045], [0, 0, -1.3 + (r(90 + dx * 10) - 0.5) * 0.3]);
      }
    } else if (index === shedTile) {
      // The shed: two walls left, the roof beams down, hay bales beside it.
      build.add(kit.box, kit.char, [x + 0.5, y + 0.55, z + 0.1], [1.0, 1.1, 0.12]);
      build.add(kit.box, kit.trunk, [x + 0.1, y + 0.45, z + 0.5], [0.12, 0.9, 0.9]);
      build.add(kit.box, kit.char, [x + 0.55, y + 0.4, z + 0.6], [1.0, 0.06, 0.9], [0, 0, 0.55]);
      build.add(kit.cylinder, r(95) < 0.5 ? kit.char : kit.rust, [x + 0.85, y + 0.22, z + 1.25], [0.24, 0.42, 0.24], [Math.PI / 2, 0, 0.4]);
      if (burning) addFire(build, x + 0.75, y + 0.2, z + 1.2, 0.8, kit.seed, salt + 900);
    } else if (burning && r(96) < 0.12) {
      addFire(build, x + 0.5, y, z + 0.5, 0.6 + r(97) * 0.4, kit.seed, salt + 950 + order);
    }
  });
}

// ------------------------------------------------------------------ rubble

function buildSkeleton(build: Builder, seed: number, salt: number): void {
  const kit = build.kit;
  const roll = (index: number) => rng(seed, salt, index);
  // Lying on its back: skull, spine, five ribs, pelvis, legs and arms. 1.2 tiles
  // long, bones thick enough to read from the command camera.
  build.add(kit.sphere, kit.bone, [0, 0.11, 0.52], [0.12, 0.105, 0.135]);
  build.add(kit.sphere, kit.dark, [-0.04, 0.13, 0.62], [0.03, 0.025, 0.02]);
  build.add(kit.sphere, kit.dark, [0.04, 0.13, 0.62], [0.03, 0.025, 0.02]);
  build.add(kit.box, kit.bone, [0, 0.05, 0.42], [0.11, 0.06, 0.07]);
  build.add(kit.rod, kit.bone, [0, 0.05, 0.08], [0.032, 0.64, 0.032], [Math.PI / 2, 0, 0]);
  for (let rib = 0; rib < 5; rib++) {
    const spread = 0.2 - rib * 0.02;
    for (const side of [-1, 1]) {
      build.add(kit.rod, kit.bone, [side * spread / 2, 0.07, 0.32 - rib * 0.065], [0.018, spread, 0.018], [0, 0, Math.PI / 2 + side * 0.5]);
    }
  }
  build.add(kit.box, kit.bone, [0, 0.05, -0.24], [0.28, 0.06, 0.12]);
  for (const side of [-1, 1]) {
    build.add(kit.rod, kit.bone, [side * 0.08, 0.05, -0.46], [0.028, 0.42, 0.028], [Math.PI / 2 + (roll(1 + side) - 0.5) * 0.2, 0, side * 0.15]);
    build.add(kit.rod, kit.bone, [side * 0.12, 0.04, -0.84], [0.024, 0.36, 0.024], [Math.PI / 2, 0, side * 0.1]);
    build.add(kit.rod, kit.bone, [side * 0.24, 0.05, 0.2], [0.02, 0.38, 0.02], [Math.PI / 2 + (roll(4 + side) - 0.5) * 0.6, 0, side * 0.35]);
  }
}

/** A skull and a few long bones: what is left when nothing lies in order. */
function buildBonePile(build: Builder, seed: number, salt: number): void {
  const kit = build.kit;
  const roll = (index: number) => rng(seed, salt, index);
  build.add(kit.sphere, kit.bone, [0, 0.12, 0], [0.13, 0.115, 0.145], [0.3, roll(1) * 3, 0.5]);
  build.add(kit.sphere, kit.dark, [0.05, 0.15, 0.1], [0.03, 0.025, 0.02]);
  build.add(kit.sphere, kit.dark, [-0.04, 0.15, 0.11], [0.03, 0.025, 0.02]);
  for (let bone = 0; bone < 3; bone++) {
    build.add(kit.rod, kit.bone, [(roll(2 + bone) - 0.5) * 0.7, 0.04, (roll(6 + bone) - 0.5) * 0.7], [0.026, 0.3 + roll(10 + bone) * 0.25, 0.026],
      [Math.PI / 2, roll(14 + bone) * 3, 0]);
  }
}
function buildCarPart(build: Builder, seed: number, salt: number): void {
  const kit = build.kit;
  const roll = (index: number) => rng(seed, salt, index);
  const pick = roll(1);
  if (pick < 0.3) {
    build.add(kit.cylinder, kit.dark, [0, 0.12, 0], [0.24, 0.2, 0.24], [0, 0, Math.PI / 2 + 0.25]);
  } else if (pick < 0.55) {
    build.add(kit.box, kit.paint[1 + Math.floor(roll(2) * (kit.paint.length - 1))], [0, 0.3, 0], [0.04, 0.55, 1.0], [0, 0, 0.9]);
    build.add(kit.box, kit.glass, [0.12, 0.42, 0], [0.03, 0.22, 0.6], [0, 0, 0.9]);
  } else if (pick < 0.8) {
    build.add(kit.box, kit.dark, [0, 0.24, 0], [0.62, 0.42, 0.55], [0.05, 0, 0.08]);
    build.add(kit.cylinder, kit.steel, [0.28, 0.38, 0.1], [0.05, 0.5, 0.05], [0, 0, 1.1]);
  } else {
    build.add(kit.cylinder, kit.rust, [0, 0.22, 0], [0.04, 1.3, 0.04], [0, 0, Math.PI / 2]);
    for (const side of [-1, 1]) build.add(kit.cylinder, kit.dark, [side * 0.62, 0.22, 0], [0.22, 0.18, 0.22], [0, 0, Math.PI / 2]);
  }
}

/** Debris: concrete chunks and bricks on every rubble tile, the walls of a
 *  collapsed house along the edges of a big patch, and the reason it is here -
 *  car parts near a street, bones anywhere else. */
export function buildRubble(group: THREE.Group, feature: Feature, kit: PropKit, size: number): void {
  const build = new Builder(group, kit);
  const salt = feature.minY * 1000 + feature.minX + 555;
  const collapsed = feature.tiles.length >= 8;
  feature.tiles.forEach((index, order) => {
    const roll = (i: number) => rng(kit.seed, salt + order * 11, i);
    const tileX = index % size;
    const tileZ = Math.floor(index / size);
    for (let chunk = 0; chunk < 3 + Math.floor(roll(1) * 3); chunk++) {
      const x = tileX + 0.15 + roll(10 + chunk) * 0.7;
      const z = tileZ + 0.15 + roll(20 + chunk) * 0.7;
      const scale = 0.14 + roll(30 + chunk) * 0.24;
      // Broken slabs, bricks and burnt timber: grey, dark and rust, never
      // stones and nothing pale.
      const material = roll(40 + chunk) < 0.25 ? kit.rust : roll(41 + chunk) < 0.55 ? kit.concrete : kit.dark;
      build.add(kit.box, material, [x, kit.elevation(x, z) + 0.06, z], [scale * 1.4, 0.06 + roll(43 + chunk) * 0.1, scale],
        [(roll(50 + chunk) - 0.5) * 0.6, roll(60 + chunk) * 6, (roll(70 + chunk) - 0.5) * 0.6]);
    }
    if (collapsed) {
      const edge = tileX === feature.minX || tileX === feature.maxX || tileZ === feature.minY || tileZ === feature.maxY;
      if (edge && roll(80) < 0.6) {
        const x = tileX + 0.5;
        const z = tileZ + 0.5;
        const stub = 0.25 + roll(81) * 0.5;
        const alongX = tileZ === feature.minY || tileZ === feature.maxY;
        build.add(kit.box, roll(83) < 0.5 ? kit.concrete : kit.plaster[(feature.minX + feature.minY) % kit.plaster.length], [x, kit.elevation(x, z) + stub / 2, z],
          alongX ? [0.95, stub, 0.2] : [0.2, stub, 0.95], [0, 0, (roll(82) - 0.5) * 0.25]);
      }
    }
    const x = tileX + 0.5;
    const z = tileZ + 0.5;
    const y = kit.elevation(x, z);
    if (feature.nearRoad && roll(90) < 0.45) buildCarPart(build.frame(x, y, z, roll(91) * Math.PI * 2), kit.seed, salt + order * 11);
    else if (roll(92) < (collapsed ? 0.28 : 0.45)) buildSkeleton(build.frame(x, y, z, roll(93) * Math.PI * 2), kit.seed, salt + order * 11);
    else if (roll(94) < 0.3) buildBonePile(build.frame(x + (roll(95) - 0.5) * 0.4, y, z + (roll(96) - 0.5) * 0.4, roll(97) * Math.PI * 2), kit.seed, salt + order * 11);
  });
}

// ------------------------------------------------------------- resources

export function buildPod(group: THREE.Group, x: number, z: number, kit: PropKit): void {
  const build = new Builder(group, kit).frame(x + 0.5, kit.elevation(x + 0.5, z + 0.5), z + 0.5, Math.floor(rng(kit.seed, x * 31 + z, 1) * 4) * Math.PI / 2);
  build.add(kit.box, kit.dark, [0, 0.14, 0], [0.7, 0.28, 1.1]);
  build.add(kit.cylinder, kit.steel, [0, 0.58, 0], [0.28, 0.9, 0.28], [Math.PI / 3, 0, 0]);
  build.add(kit.box, kit.glow, [0, 0.72, 0.09], [0.2, 0.05, 0.55]);
  build.add(kit.sphere, kit.skin, [0, 0.7, -0.2], [0.09, 0.07, 0.09]);
  build.add(kit.box, kit.dark, [0, 0.64, 0.06], [0.15, 0.07, 0.27]);
  for (const side of [-1, 1]) {
    build.add(kit.cylinder, kit.steel, [side * 0.3, 0.38, 0], [0.045, 0.7, 0.045]);
    build.add(kit.box, kit.dark, [0, 0.25, side * 0.48], [0.7, 0.17, 0.09]);
  }
}

/** A metal vein: not a rock, a salvage pit - a tripod derrick over a hole,
 *  dark ore and steel scrap heaped beside it, a drum and a crate. */
export function buildVein(group: THREE.Group, x: number, z: number, kit: PropKit): void {
  const build = new Builder(group, kit).frame(x + 0.5, kit.elevation(x + 0.5, z + 0.5), z + 0.5, Math.floor(rng(kit.seed, x * 31 + z, 2) * 4) * Math.PI / 2);
  const roll = (i: number) => rng(kit.seed, x * 31 + z + 5, i);
  build.add(kit.cylinder, kit.dark, [0.05, 0.02, -0.05], [0.3, 0.05, 0.3]);
  for (let leg = 0; leg < 3; leg++) {
    const a = leg * Math.PI * 2 / 3 + 0.4;
    const foot = [Math.sin(a) * 0.38, Math.cos(a) * 0.38];
    const mesh = build.add(kit.rod, kit.steel, [foot[0] / 2 + 0.025, 0.72, foot[1] / 2 - 0.025], [0.03, 1.5, 0.03]);
    mesh.rotation.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0.05 - foot[0], 1.4, -0.05 - foot[1]).normalize()));
  }
  build.add(kit.box, kit.dark, [0.05, 1.45, -0.05], [0.18, 0.12, 0.18]);
  build.add(kit.rod, kit.steel, [0.05, 0.75, -0.05], [0.012, 1.35, 0.012]);
  build.add(kit.box, kit.dark, [0.05, 0.2, -0.05], [0.16, 0.14, 0.16]);
  for (let piece = 0; piece < 6; piece++) {
    const a = roll(piece) * Math.PI * 2;
    const d = 0.32 + roll(10 + piece) * 0.14;
    const s = 0.14 + roll(20 + piece) * 0.14;
    build.add(kit.boulder, piece % 3 === 0 ? kit.rust : kit.dark, [Math.sin(a) * d, s * 0.5, Math.cos(a) * d], [s, s * 0.8, s * 1.1],
      [roll(30 + piece) * 3, roll(40 + piece) * 4, 0]);
  }
  build.add(kit.cylinder, kit.rust, [-0.36, 0.27, 0.3], [0.13, 0.54, 0.13], [0, 0, 0.08]);
  build.add(kit.box, kit.dark, [0.34, 0.16, 0.32], [0.32, 0.3, 0.3], [0, 0.4, 0]);
  build.add(kit.box, kit.steel, [0.28, 0.1, -0.36], [0.06, 0.06, 0.7], [0, 0.5, 0]);
  build.add(kit.box, kit.steel, [-0.3, 0.05, -0.3], [0.5, 0.04, 0.08], [0, -0.3, 0]);
}

/** Grass tufts where the weeds took over (walkable, flat, only visual). */
export function buildGrass(group: THREE.Group, x: number, z: number, kit: PropKit, vegetation: THREE.Material): void {
  const build = new Builder(group, kit);
  const roll = (i: number) => rng(kit.seed, x * 31 + z + 9, i);
  for (let blade = 0; blade < 12; blade++) {
    const px = x + 0.1 + roll(blade) * 0.8;
    const pz = z + 0.1 + roll(20 + blade) * 0.8;
    build.add(kit.box, vegetation, [px, kit.elevation(px, pz) + 0.12, pz], [0.02, 0.18 + roll(40 + blade) * 0.25, 0.02],
      [(roll(60 + blade) - 0.5) * 0.5, roll(80 + blade) * 6, (roll(100 + blade) - 0.5) * 0.7]);
  }
}
