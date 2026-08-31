// PixiJS map renderer: tiles, entities, hp bars and fog overlay.

import { Application, Container, Graphics } from "pixi.js";
import type { EntityOut, GameState } from "../api/types";
import { BUILDING_MAX_HP, BUILDING_SIZE, NEUTRAL_COLOR, PLAYER_COLORS, UNIT_MAX_HP } from "../game/meta";
import { exploredTiles, visibleTiles } from "../game/vision";

const TERRAIN_COLORS: Record<string, number> = {
  plain: 0x18202e,
  blocked: 0x3a4150,
  vein: 0xc9a227,
  rubble: 0x574634,
};

export class MapRenderer {
  private app: Application | null = null;
  private terrain = new Graphics();
  private entities = new Graphics();
  private fog = new Graphics();
  private root = new Container();
  private pixelSize = 640;

  async init(host: HTMLElement, pixelSize = 640): Promise<void> {
    this.pixelSize = pixelSize;
    const app = new Application();
    await app.init({ width: pixelSize, height: pixelSize, background: 0x0d1117,
                     antialias: true });
    if (this.app) return; // destroyed while awaiting
    this.app = app;
    host.replaceChildren(app.canvas);
    this.root.addChild(this.terrain, this.entities, this.fog);
    app.stage.addChild(this.root);
  }

  destroy(): void {
    this.app?.destroy(true, { children: true });
    this.app = null;
  }

  render(state: GameState, perspective: number | null): void {
    if (!this.app) return;
    const size = state.size;
    const t = this.pixelSize / size;

    const terrain = this.terrain;
    terrain.clear();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        terrain.rect(x * t, y * t, t - 0.5, t - 0.5)
          .fill(TERRAIN_COLORS[state.tiles[y][x]] ?? 0x18202e);
      }
    }
    for (const key of Object.keys(state.scrap)) {
      const [x, y] = key.split(",").map(Number);
      terrain.circle(x * t + t / 2, y * t + t / 2, t / 5).fill(0x8d99ae);
    }

    const g = this.entities;
    g.clear();
    const sorted = Object.values(state.entities).sort((a, b) => a.id - b.id);
    for (const e of sorted) {
      if (e.kind === "building") this.drawBuilding(g, e, t);
    }
    for (const e of sorted) {
      if (e.kind === "unit") this.drawUnit(g, e, t);
    }

    const fog = this.fog;
    fog.clear();
    if (perspective !== null && state.players[perspective]) {
      const visible = visibleTiles(state, perspective);
      const explored = exploredTiles(state, perspective);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const packed = y * size + x;
          if (visible.has(packed)) continue;
          const alpha = explored.has(packed) ? 0.55 : 0.92;
          fog.rect(x * t, y * t, t, t).fill({ color: 0x05070c, alpha });
        }
      }
    }
  }

  private color(owner: number): number {
    return owner >= 0 ? PLAYER_COLORS[owner % PLAYER_COLORS.length] : NEUTRAL_COLOR;
  }

  private drawBuilding(g: Graphics, e: EntityOut, t: number): void {
    const [w, h] = BUILDING_SIZE[e.type] ?? [1, 1];
    const px = e.x * t + 1;
    const py = e.y * t + 1;
    const pw = w * t - 2;
    const ph = h * t - 2;
    const color = this.color(e.owner);
    const alpha = e.build_progress ? 0.45 : 0.95;
    g.rect(px, py, pw, ph).fill({ color, alpha });
    if (e.type === "core") {
      // Death stages: cracks below 300 hp, fire below 150.
      if (e.hp <= 150) g.rect(px, py, pw, ph).stroke({ width: 3, color: 0xff3d00 });
      else if (e.hp <= 300) g.rect(px, py, pw, ph).stroke({ width: 2, color: 0xffab00 });
      g.rect(px + pw / 4, py + ph / 4, pw / 2, ph / 2).fill(0x0d1117);
    }
    if (e.type === "turret") {
      g.circle(px + pw / 2, py + ph / 2, t / 4).fill(0x0d1117);
    }
    if (e.type === "cocoon") {
      g.circle(px + pw / 2, py + ph / 2, t / 4).fill({ color: 0x76ff03, alpha: 0.7 });
    }
    if (e.capture) {
      g.rect(px, py, pw, ph).stroke({ width: 2, color: 0xd500f9 }); // disputed rack
    }
    this.hpBar(g, px, py - 3, pw, e.hp, BUILDING_MAX_HP[e.type] ?? 100);
  }

  private drawUnit(g: Graphics, e: EntityOut, t: number): void {
    const cx = e.x * t + t / 2;
    const cy = e.y * t + t / 2;
    const r = Math.max(t / 3, 2.5);
    const color = this.color(e.owner);
    const big = e.type === "colossus" || e.type === "walking_tower";
    g.circle(cx, cy, big ? r * 1.35 : r).fill({ color, alpha: e.stiff ? 0.4 : 1 });
    // Head silhouette: every robot is a bighead.
    g.circle(cx, cy - r / 2, r / 2.2).fill({ color: 0x0d1117, alpha: 0.85 });
    if (e.type === "worker") g.circle(cx, cy, r / 4).fill(0xffffff);
    if (e.type === "human") g.circle(cx, cy, r).stroke({ width: 1, color: 0xffffff });
    this.hpBar(g, cx - r, cy + r + 1, r * 2, e.hp, UNIT_MAX_HP[e.type] ?? 30);
  }

  private hpBar(g: Graphics, x: number, y: number, w: number, hp: number, max: number): void {
    const pct = Math.max(Math.min(hp / max, 1), 0);
    if (pct >= 1) return;
    g.rect(x, y, w, 2).fill(0x263238);
    g.rect(x, y, w * pct, 2).fill(pct > 0.5 ? 0x66bb6a : pct > 0.25 ? 0xffa726 : 0xef5350);
  }
}
