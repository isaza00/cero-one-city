/** Street grid shared with the engine (engine/cero_engine/layout.py).
 *
 *  Pure 32-bit integer arithmetic so both sides recompute the same avenues
 *  from the map seed: the grid is never stored in the state. */

export function terrainBits(horizontal: number, vertical: number, seed = 0): number {
  let value = Math.imul(horizontal | 0, 374761393) ^ Math.imul(vertical | 0, 668265263) ^ seed;
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return (value ^ value >>> 16) >>> 0;
}

/** Centre lines of the avenues (rows, columns); every road is 3 tiles wide. */
export function roadLayout(seed: number, format: string, size: number): { rows: number[]; cols: number[] } {
  const half = Math.floor(size / 2);
  const axis = (salt: number, base: number): number[] => {
    const spacing = base + terrainBits(1, salt, seed) % 9;
    let centre = 5 + terrainBits(2, salt, seed) % (spacing - 6);
    const centres: number[] = [];
    while (centre < half - 3) {
      centres.push(centre + terrainBits(centre, salt, seed) % 5 - 2);
      centre += spacing;
    }
    return centres;
  };
  const mirror = (centres: number[]) =>
    [...new Set([...centres, ...centres.map(c => size - 1 - c)])].sort((a, b) => a - b);
  if (format === "1v1") return { rows: mirror(axis(1, 18)), cols: mirror(axis(2, 18)) };
  const both = mirror(axis(3, 24));
  return { rows: both, cols: both };
}

export interface Lane { horizontal: boolean; centre: number; offset: number }

export class RoadGrid {
  readonly rows: number[];
  readonly cols: number[];

  constructor(seed: number, format: string, readonly size: number) {
    const layout = roadLayout(seed, format, size);
    this.rows = layout.rows;
    this.cols = layout.cols;
  }

  /** Tile (integer) test: lanes -1, 0, 1 around a centre line. */
  isRoad(x: number, y: number): boolean {
    return this.rows.some(r => Math.abs(y - r) <= 1) || this.cols.some(c => Math.abs(x - c) <= 1);
  }

  /** Which avenue a road tile belongs to; null off the streets. Rows win at crossings. */
  lane(x: number, y: number): Lane | null {
    for (const r of this.rows) if (Math.abs(y - r) <= 1) return { horizontal: true, centre: r, offset: y - r };
    for (const c of this.cols) if (Math.abs(x - c) <= 1) return { horizontal: false, centre: c, offset: x - c };
    return null;
  }

  /** Continuous distance (tiles) from a world point to the nearest centre line.
   *  Centre lines run through the middle of their tile (c + 0.5). */
  distance(x: number, z: number): number {
    const { alongRow, alongCol } = this.axisDistance(x, z);
    return Math.min(alongRow, alongCol);
  }

  /** Distance to the nearest centre line per axis (for lane paint). */
  axisDistance(x: number, z: number): { alongRow: number; alongCol: number } {
    let alongRow = Infinity;
    let alongCol = Infinity;
    for (const r of this.rows) alongRow = Math.min(alongRow, Math.abs(z - r - 0.5));
    for (const c of this.cols) alongCol = Math.min(alongCol, Math.abs(x - c - 0.5));
    return { alongRow, alongCol };
  }
}
