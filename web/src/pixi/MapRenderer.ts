// PixiJS map renderer: pixel-art sprites for entities, textured terrain,
// hp bars, status overlays and the fog layer.

import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { EntityOut, GameState } from "../api/types";
import { BUILDING_MAX_HP, BUILDING_SIZE, UNIT_MAX_HP } from "../game/meta";
import { exploredTiles, visibleTiles } from "../game/vision";
import { getBuildingTexture, getUnitTexture } from "./spritepack";

const TERRAIN_BASE: Record<string, number> = {
  plain: 0x18202e,
  blocked: 0x39414e,
  vein: 0x2a2617,
  rubble: 0x3a2f24,
};

export class MapRenderer {
  private app: Application | null = null;
  private terrain = new Graphics();
  private sprites = new Container();
  private overlay = new Graphics();
  private fog = new Graphics();
  private root = new Container();
  private pixelSize = 640;
  private terrainKey = "";

  async init(host: HTMLElement, pixelSize = 640): Promise<void> {
    this.pixelSize = pixelSize;
    const app = new Application();
    await app.init({ width: pixelSize, height: pixelSize, background: 0x0b0f14,
                     antialias: false });
    if (this.app) return; // destroyed while awaiting
    this.app = app;
    host.replaceChildren(app.canvas);
    this.root.addChild(this.terrain, this.sprites, this.overlay, this.fog);
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

    this.renderTerrain(state, t);

    this.sprites.removeChildren();
    this.overlay.clear();
    const sorted = Object.values(state.entities).sort((a, b) => a.id - b.id);
    for (const e of sorted) {
      if (e.kind === "building") this.drawBuilding(e, t);
    }
    for (const e of sorted) {
      if (e.kind === "unit") this.drawUnit(e, t);
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
          const alpha = explored.has(packed) ? 0.55 : 0.94;
          fog.rect(x * t, y * t, t, t).fill({ color: 0x04060a, alpha });
        }
      }
    }
  }

  /** Terrain + scrap piles; redrawn only when tiles/scrap actually change. */
  private renderTerrain(state: GameState, t: number): void {
    const key = `${state.size}:${state.tiles.flat().join("")}:${Object.keys(state.scrap).join(",")}`;
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    const g = this.terrain;
    g.clear();
    const size = state.size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const terrain = state.tiles[y][x];
        g.rect(x * t, y * t, t, t).fill(TERRAIN_BASE[terrain] ?? 0x18202e);
        const n = (x * 31 + y * 17) % 11;  // deterministic texture noise
        if (terrain === "plain") {
          if (n === 0) g.rect(x * t + t * 0.3, y * t + t * 0.55, t * 0.14, t * 0.14)
            .fill(0x1f2937);
          if (n === 5) g.rect(x * t + t * 0.62, y * t + t * 0.25, t * 0.1, t * 0.1)
            .fill(0x121826);
        } else if (terrain === "blocked") {
          g.rect(x * t + t * 0.12, y * t + t * 0.15, t * 0.5, t * 0.28).fill(0x4d5766);
          g.rect(x * t + t * 0.42, y * t + t * 0.5, t * 0.42, t * 0.3).fill(0x2c333e);
          g.rect(x * t + t * 0.2, y * t + t * 0.58, t * 0.22, t * 0.22).fill(0x59636f);
        } else if (terrain === "vein") {
          g.rect(x * t + t * 0.15, y * t + t * 0.2, t * 0.24, t * 0.24).fill(0xc9a227);
          g.rect(x * t + t * 0.55, y * t + t * 0.45, t * 0.2, t * 0.2).fill(0xe6c352);
          g.rect(x * t + t * 0.3, y * t + t * 0.62, t * 0.14, t * 0.14).fill(0x9a7b1c);
          g.rect(x * t + t * 0.6, y * t + t * 0.15, t * 0.08, t * 0.08).fill(0xfff3c0);
        } else if (terrain === "rubble") {
          g.rect(x * t + t * 0.2, y * t + t * 0.3, t * 0.3, t * 0.18).fill(0x574634);
          g.rect(x * t + t * 0.5, y * t + t * 0.55, t * 0.26, t * 0.16).fill(0x6b5540);
          g.rect(x * t + t * 0.35, y * t + t * 0.15, t * 0.12, t * 0.12).fill(0x46392c);
        }
      }
    }
    for (const key2 of Object.keys(state.scrap)) {
      const [x, y] = key2.split(",").map(Number);
      // scrap pile: gray gear-ish blob
      g.circle(x * t + t / 2, y * t + t * 0.62, t / 4.5).fill(0x8d99ae);
      g.circle(x * t + t / 2, y * t + t * 0.62, t / 9).fill(0x39414e);
      g.rect(x * t + t * 0.6, y * t + t * 0.3, t * 0.16, t * 0.16).fill(0xaab4c4);
    }
  }

  private drawBuilding(e: EntityOut, t: number): void {
    const [w, h] = BUILDING_SIZE[e.type] ?? [1, 1];
    const sprite = new Sprite(getBuildingTexture(e.type, e.owner, Math.max(w, h)));
    sprite.x = e.x * t + 0.5;
    sprite.y = e.y * t + 0.5;
    sprite.width = w * t - 1;
    sprite.height = h * t - 1;
    if (e.build_progress) sprite.alpha = 0.45;
    this.sprites.addChild(sprite);

    const g = this.overlay;
    const px0 = e.x * t;
    const py0 = e.y * t;
    if (e.type === "core") {
      // Death stages: cracks below 300, fire below 150.
      if (e.hp <= 150) {
        g.rect(px0 + 1, py0 + 1, w * t - 2, h * t - 2)
          .stroke({ width: 3, color: 0xff3d00 });
        g.rect(px0 + w * t * 0.25, py0 + h * t * 0.1, t * 0.18, t * 0.3).fill(0xff7043);
        g.rect(px0 + w * t * 0.6, py0 + h * t * 0.15, t * 0.14, t * 0.24).fill(0xffab40);
      } else if (e.hp <= 300) {
        g.rect(px0 + 1, py0 + 1, w * t - 2, h * t - 2)
          .stroke({ width: 2, color: 0xffab00 });
        g.moveTo(px0 + w * t * 0.3, py0 + 4).lineTo(px0 + w * t * 0.5, py0 + h * t * 0.5)
          .stroke({ width: 1.5, color: 0x0a0e13 });
      }
    }
    if (e.capture) {
      g.rect(px0, py0, w * t, h * t).stroke({ width: 2.5, color: 0xd500f9 });
    }
    this.hpBar(px0 + 1, py0 - 3.5, w * t - 2, e.hp, BUILDING_MAX_HP[e.type] ?? 100);
  }

  private drawUnit(e: EntityOut, t: number): void {
    const sprite = new Sprite(getUnitTexture(e.type, e.owner));
    const big = e.type === "colossus" || e.type === "walking_tower";
    const span = big ? t * 1.15 : t * 0.92;
    sprite.width = span;
    sprite.height = span;
    sprite.x = e.x * t + (t - span) / 2;
    sprite.y = e.y * t + (t - span) / 2 - (big ? t * 0.12 : 0);
    if (e.stiff) sprite.alpha = 0.4;
    this.sprites.addChild(sprite);

    const g = this.overlay;
    if (e.type === "human" && e.owner >= 0) {
      g.circle(e.x * t + t / 2, e.y * t + t / 2, t * 0.5)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
    }
    if (e.stiff) {
      g.rect(e.x * t + t * 0.28, e.y * t + t * 0.05, t * 0.44, t * 0.16)
        .fill({ color: 0x90caf9, alpha: 0.9 }); // "frozen" bar
    }
    this.hpBar(e.x * t + t * 0.1, e.y * t + t * 0.95, t * 0.8, e.hp,
               UNIT_MAX_HP[e.type] ?? 30);
  }

  private hpBar(x: number, y: number, w: number, hp: number, max: number): void {
    const pct = Math.max(Math.min(hp / max, 1), 0);
    if (pct >= 1) return;
    const g = this.overlay;
    g.rect(x, y, w, 2.5).fill(0x263238);
    g.rect(x, y, w * pct, 2.5)
      .fill(pct > 0.5 ? 0x66bb6a : pct > 0.25 ? 0xffa726 : 0xef5350);
  }
}
