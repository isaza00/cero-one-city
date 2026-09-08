import { RoadGrid, terrainBits, type Lane } from "./roads";

/** What a group of impassable tiles looks like. The engine only knows
 *  `blocked` and `rubble`; the shape of a component and its position relative
 *  to the street grid decide whether it is a house, a traffic jam, a grove of
 *  trees or a rock outcrop - and units path around all of them the same way. */
export type FeatureKind = "house" | "jam" | "grove" | "ruin" | "farm" | "rubble" | "pod" | "vein";

export interface Feature {
  kind: FeatureKind;
  /** Tile indices (row * size + column). */
  tiles: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Jams: the lane the wrecks queue on, first tile along the axis and run length. */
  lane?: Lane;
  start?: number;
  length?: number;
  /** Rubble: whether a street runs within reach (car parts) or not (bones and bricks). */
  nearRoad?: boolean;
}

function neighbours4(x: number, y: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < size - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < size - 1) out.push([x, y + 1]);
  return out;
}

export function classifyFeatures(tiles: string[][], roads: RoadGrid, seed: number): Feature[] {
  const size = tiles.length;
  const features: Feature[] = [];
  const claimed = new Uint8Array(size * size);
  const blockedRoad = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && tiles[y][x] === "blocked" && roads.isRoad(x, y);

  // 1. Wrecks on the streets: runs of blocked road tiles along one lane. A tile
  //    at a crossing joins the axis where its queue is longer.
  const runLength = (x: number, y: number, dx: number, dy: number) => {
    let length = 1;
    for (let step = 1; blockedRoad(x + dx * step, y + dy * step); step++) length++;
    for (let step = 1; blockedRoad(x - dx * step, y - dy * step); step++) length++;
    return length;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!blockedRoad(x, y) || claimed[y * size + x]) continue;
      const horizontal = runLength(x, y, 1, 0) >= runLength(x, y, 0, 1);
      const lane = horizontal
        ? roads.rows.map(r => ({ horizontal: true, centre: r, offset: y - r })).find(l => Math.abs(l.offset) <= 1)
        : roads.cols.map(c => ({ horizontal: false, centre: c, offset: x - c })).find(l => Math.abs(l.offset) <= 1);
      if (!lane) continue;
      const run: number[] = [];
      let cursor = 0;
      // Scanning left-to-right / top-to-bottom means this tile starts the run
      // for its axis unless a previous run (the other axis) already took it.
      while (true) {
        const tx = horizontal ? x + cursor : x;
        const ty = horizontal ? y : y + cursor;
        if (!blockedRoad(tx, ty) || claimed[ty * size + tx]) break;
        const other = horizontal ? runLength(tx, ty, 0, 1) : runLength(tx, ty, 1, 0);
        const mine = horizontal ? runLength(tx, ty, 1, 0) : runLength(tx, ty, 0, 1);
        if (cursor > 0 && other > mine) break;
        claimed[ty * size + tx] = 1;
        run.push(ty * size + tx);
        cursor++;
      }
      if (!run.length) continue;
      features.push({
        kind: "jam", tiles: run, lane, start: horizontal ? x : y, length: run.length,
        minX: x, minY: y, maxX: horizontal ? x + run.length - 1 : x, maxY: horizontal ? y : y + run.length - 1,
      });
    }
  }

  // 2. Everything else impassable: 4-connected components off the streets.
  //    Full rectangles beside an avenue are houses; the rest are groves or the
  //    concrete skeletons of bigger buildings.
  const flood = (startX: number, startY: number, kind: string): Feature => {
    const stack: [number, number][] = [[startX, startY]];
    const feature: Feature = { kind: "ruin", tiles: [], minX: startX, minY: startY, maxX: startX, maxY: startY };
    claimed[startY * size + startX] = 1;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      feature.tiles.push(y * size + x);
      feature.minX = Math.min(feature.minX, x);
      feature.maxX = Math.max(feature.maxX, x);
      feature.minY = Math.min(feature.minY, y);
      feature.maxY = Math.max(feature.maxY, y);
      for (const [nx, ny] of neighbours4(x, y, size)) {
        const index = ny * size + nx;
        if (claimed[index] || tiles[ny][nx] !== kind || (kind === "blocked" && roads.isRoad(nx, ny))) continue;
        claimed[index] = 1;
        stack.push([nx, ny]);
      }
    }
    return feature;
  };
  const nearStreet = (feature: Feature) => feature.tiles.some(index =>
    roads.distance(index % size + 0.5, Math.floor(index / size) + 0.5) < 3.6);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      if (claimed[index]) continue;
      const kind = tiles[y][x];
      if (kind === "blocked" && !roads.isRoad(x, y)) {
        const feature = flood(x, y, "blocked");
        const area = (feature.maxX - feature.minX + 1) * (feature.maxY - feature.minY + 1);
        const fill = feature.tiles.length / area;
        if (fill >= 0.75 && area >= 8 && nearStreet(feature)) feature.kind = "house";
        else {
          const pick = terrainBits(feature.minX, feature.minY, seed) % 100;
          feature.kind = pick < 45 ? "grove" : pick < 75 ? "ruin" : "farm";
        }
        features.push(feature);
      } else if (kind === "rubble") {
        const feature = flood(x, y, "rubble");
        feature.kind = "rubble";
        feature.nearRoad = nearStreet(feature);
        features.push(feature);
      } else if (kind === "pod" || kind === "vein") {
        claimed[index] = 1;
        features.push({ kind, tiles: [index], minX: x, minY: y, maxX: x, maxY: y });
      }
    }
  }
  return features;
}
