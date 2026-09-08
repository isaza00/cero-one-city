import * as THREE from "three";
import { RoadGrid } from "./roads";

export function terrainHash(horizontal: number, vertical: number, seed = 0): number {
  let value = Math.imul(horizontal | 0, 374761393) ^ Math.imul(vertical | 0, 668265263) ^ seed;
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

function field(horizontal: number, vertical: number, seed: number): number {
  const column = Math.floor(horizontal);
  const row = Math.floor(vertical);
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const fractionX = smooth(horizontal - column);
  const fractionZ = smooth(vertical - row);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(terrainHash(column, row, seed), terrainHash(column + 1, row, seed), fractionX),
    THREE.MathUtils.lerp(terrainHash(column, row + 1, seed), terrainHash(column + 1, row + 1, seed), fractionX), fractionZ);
}

export function landscapeSeed(tiles: string[][]): number {
  let seed = 2166136261;
  for (const row of tiles) for (const tile of row) seed = Math.imul(seed ^ tile.charCodeAt(0), 16777619);
  return seed >>> 0;
}

/** The ground of one sector of a 20x larger world: a mostly flat suburb with
 *  a few low hills (Age of Empires elevation, not rolling swell), a street
 *  grid shared with the engine, and a surface mask for asphalt, lane paint and
 *  the weeds that grow between the blocks. */
export class Landscape {
  readonly worldSize: number;
  readonly origin: THREE.Vector2;
  readonly surface: THREE.DataTexture;
  readonly roads: RoadGrid;
  /** Bomb craters: a dip in the ground with a raised rim and scorched earth. */
  readonly craters: { x: number; z: number; radius: number }[] = [];

  constructor(readonly size: number, readonly seed: number, readonly format = "1v1", tiles?: string[][]) {
    this.worldSize = size * 20;
    this.origin = new THREE.Vector2(
      Math.floor(terrainHash(seed, 31) * (this.worldSize - size)),
      Math.floor(terrainHash(17, seed) * (this.worldSize - size)));
    this.roads = new RoadGrid(seed, format, size);
    // A few craters on open ground (never under a building), some on a street.
    const wanted = Math.max(2, Math.floor(size / 36));
    for (let attempt = 0; this.craters.length < wanted && attempt < wanted * 30; attempt++) {
      const x = 6 + terrainHash(attempt, 501, seed) * (size - 12);
      const z = 6 + terrainHash(503, attempt, seed) * (size - 12);
      const radius = 2.4 + terrainHash(attempt, 505, seed) * 2.2;
      if (this.roads.distance(x, z) < radius + 1 && terrainHash(attempt, 507, seed) < 0.65) continue;
      let clear = true;
      for (let tz = Math.floor(z - radius - 1); clear && tz <= Math.ceil(z + radius + 1); tz++) {
        for (let tx = Math.floor(x - radius - 1); tx <= Math.ceil(x + radius + 1); tx++) {
          const tile = tiles?.[tz]?.[tx];
          if (tile !== undefined && tile !== "plain") { clear = false; break; }
        }
      }
      if (!clear || this.craters.some(other => Math.hypot(other.x - x, other.z - z) < other.radius + radius + 4)) continue;
      this.craters.push({ x, z, radius });
    }
    const texels = 8;
    const resolution = size * texels;
    const data = new Uint8Array(resolution * resolution * 4);
    for (let row = 0; row < resolution; row++) {
      for (let column = 0; column < resolution; column++) {
        const horizontal = (column + 0.5) / texels;
        const vertical = (row + 0.5) / texels;
        const { alongRow, alongCol } = this.roads.axisDistance(horizontal, vertical);
        const distance = Math.min(alongRow, alongCol);
        // Asphalt: 3 tiles wide with a ragged, eroded edge. Whole stretches are
        // gone (integrity): the street reads through the dirt, then vanishes.
        const erosion = (this.sample(horizontal * 1.6, vertical * 1.6) - 0.5) * 0.5;
        const integrity = THREE.MathUtils.smoothstep(this.sample(horizontal / 5, vertical / 5), 0.2, 0.42);
        const road = (1 - THREE.MathUtils.smoothstep(distance + erosion, 1.3, 1.65)) * integrity;
        // Lane paint: a dashed centre line and solid edge lines, only where the
        // asphalt survived and the paint itself did not wear off.
        const along = alongRow < alongCol ? horizontal : vertical;
        const dash = Math.floor(along / 1.2) % 2 === 0 ? 1 : 0;
        const centreLine = (1 - THREE.MathUtils.smoothstep(distance, 0.04, 0.1)) * dash;
        const edgeLine = 1 - THREE.MathUtils.smoothstep(Math.abs(distance - 1.26), 0.03, 0.08);
        const wear = THREE.MathUtils.smoothstep(this.sample(horizontal * 0.9 + 4, vertical * 0.9), 0.42, 0.58);
        const stripe = Math.max(centreLine, edgeLine) * road * wear;
        const growth = THREE.MathUtils.smoothstep(this.sample(horizontal / 7, vertical / 7), 0.58, 0.82) * (1 - road * 0.7);
        const offset = (row * resolution + column) * 4;
        data.set([road * 255, stripe * 255, growth * 255, this.scorch(horizontal, vertical) * 255], offset);
      }
    }
    this.surface = new THREE.DataTexture(data, resolution, resolution);
    this.surface.minFilter = this.surface.magFilter = THREE.LinearFilter;
    this.surface.needsUpdate = true;
  }

  sample(horizontal: number, vertical: number): number {
    return field(horizontal + this.origin.x / 13, vertical + this.origin.y / 13, this.seed);
  }

  /** Hill mask 0..1: a handful of low mounds per sector. */
  hill(horizontal: number, vertical: number): number {
    const globalX = horizontal + this.origin.x;
    const globalZ = vertical + this.origin.y;
    return THREE.MathUtils.smoothstep(field(globalX / 23, globalZ / 23, this.seed + 731), 0.56, 0.96);
  }

  /** Burnt ground 0..1 around the craters. */
  scorch(horizontal: number, vertical: number): number {
    let burnt = 0;
    for (const crater of this.craters) {
      const distance = Math.hypot(horizontal - crater.x, vertical - crater.z) / crater.radius;
      burnt = Math.max(burnt, (1 - THREE.MathUtils.smoothstep(distance, 0.7, 1.6)) * 0.85);
    }
    return burnt;
  }

  /** Crater relief: the bowl and the rim thrown up around it. */
  craterHeight(horizontal: number, vertical: number): number {
    let relief = 0;
    for (const crater of this.craters) {
      const distance = Math.hypot(horizontal - crater.x, vertical - crater.z) / crater.radius;
      if (distance > 1.4) continue;
      const bowl = -(1 - THREE.MathUtils.smoothstep(distance, 0.05, 1)) * crater.radius * 0.32;
      const rim = THREE.MathUtils.smoothstep(distance, 0.75, 1) * (1 - THREE.MathUtils.smoothstep(distance, 1, 1.4)) * 0.3;
      relief += bowl + rim;
    }
    return relief;
  }

  height(horizontal: number, vertical: number): number {
    const globalX = horizontal + this.origin.x;
    const globalZ = vertical + this.origin.y;
    // Flat ground with a faint undulation, plus hills that the streets cut
    // through (an avenue stays level, the ground rises beside it).
    const undulation = (field(globalX / 40, globalZ / 40, this.seed) - 0.5) * 1.1
      + (field(globalX / 9, globalZ / 9, this.seed + 17) - 0.5) * 0.28;
    const roadFlat = 1 - THREE.MathUtils.smoothstep(this.roads.distance(horizontal, vertical), 1.4, 3.2);
    return undulation * (1 - roadFlat * 0.6) + this.hill(horizontal, vertical) * 2.6 * (1 - roadFlat * 0.85)
      + this.craterHeight(horizontal, vertical);
  }

  dispose(): void { this.surface.dispose(); }
}
