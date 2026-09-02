// PixiJS map renderer - ISOMETRIC, the AoE2 way. There is no real 3D: the
// square game grid is projected into 2:1 diamonds (a tile is twice as wide as
// it is tall) and the sprites stand upright on top, y-sorted. That diagonal
// grid alone is what reads as "3D".
//
// Units are persistent "puppets" that GLIDE between tiles (the projection is
// affine, so tweening in screen space is exact), face where they walk, swap
// frames faster while moving, and flare out when they die.
//
// The canvas is a CAMERA: it fills whatever rectangle its host gives it,
// magnification is locked (cover for live matches, fit for replays), and the
// viewer moves it by dragging or via the minimap. No wheel zoom.

import { Application, Container, Graphics, Matrix, Sprite, Texture } from "pixi.js";
import type { EntityOut, GameEvent, GameState } from "../api/types";
import {
  BUILDING_MAX_HP, BUILDING_SIZE, BUILDING_VISION, CARRY_CAPACITY, UNIT_MAX_HP,
  UNIT_VISION,
} from "../game/meta";
import { PERSPECTIVE_ALL, exploredTilesFor, visibleTilesFor } from "../game/vision";
import { getBuildingFrames, getUnitFrames, packReady } from "./spritepack";

export const TILE_W = 64;   // diamond width in world px
export const TILE_H = 32;   // diamond height (2:1 - the AoE2 ratio)

const MOVE_MS = 550;        // glide duration between tiles
const WALK_FRAME_MS = 140;  // frame swap while moving
const IDLE_FRAME_MS = 380;  // frame swap while standing
const DEATH_MS = 420;       // flare + fade out
const BOLT_MS = 320;        // projectile flight time
const HIT_FLASH_MS = 160;   // red tint on the victim per landed hit
const DECAL_MS = 20000;     // wreck scorch marks fade over this long

const PLAYER_TINTS = [0x4fc3f7, 0xef5350, 0x9ccc65, 0xffb74d];

const PLAIN_SHADES = [0x18202e, 0x1b2432, 0x161d28, 0x1a2231];
const TERRAIN_BASE: Record<string, number> = {
  blocked: 0x39414e,
  vein: 0x2a2617,
  pod: 0x16302a,      // wild pods: the energy you FIND (berries), finite
  rubble: 0x3a2f24,
};

/** Multiply a color's brightness (atmospheric depth: far = darker). */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

interface Puppet {
  root: Container;
  sprite: Sprite;
  under: Graphics;   // drawn below the sprite: shadows, foundations
  status: Graphics;  // drawn above: hp bars, rings, effects
  kind: "unit" | "building";
  type: string;
  owner: number;
  big: boolean;
  fx: number; fy: number; tx: number; ty: number;
  t0: number; dur: number;
  facing: 1 | -1;
  gx: number; gy: number;   // last grid tile (for heading)
  dir: string;              // texture pose: "s" | "se" | "e" | "ne" | "n"
  mirror: boolean;          // true for w/sw/nw (left poses = mirrored right)
  frames: Texture[];
  framesKey: string;
  frameIx: number;
  frameAcc: number;
  dying: number | null;
  hitAt: number;     // last landed hit (red flash while recent)
}

/** A transient battle effect: its Graphics is cleared and redrawn each frame
 * by `draw(g, k)` with k in 0..1, then destroyed. t0 may be in the future
 * (e.g. an impact that waits for its projectile to land). */
interface Effect {
  g: Graphics;
  t0: number;
  dur: number;
  draw: (g: Graphics, k: number) => void;
}

export class MapRenderer {
  private app: Application | null = null;
  private terrain = new Graphics();
  private sprites = new Container();
  private overlay = new Graphics();
  private selection = new Graphics();
  // Fog is a CANVAS overlay, not tile fills: round radial light around every
  // eye, blurred edges - the classic RTS look. Drawn in grid space, mapped
  // onto the iso world with a matrix.
  private fog = new Sprite();
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogBlurCanvas: HTMLCanvasElement | null = null;
  private fogTex: Texture | null = null;
  private root = new Container();
  private terrainKey = "";
  private puppets = new Map<number, Puppet>();
  private lastEntities: EntityOut[] = [];
  // Battle feedback layers (AoE2 rule: the screen must PROVE the simulation).
  private decals = new Graphics();     // persistent scorch marks under everything
  private industry = new Graphics();   // gather beams/sparks, redrawn per frame
  private effectsLayer = new Container();
  private effects: Effect[] = [];
  private decalList: { x: number; y: number; r: number; t0: number }[] = [];
  private gatherLinks: { id: number; wx: number; wy: number }[] = [];
  // Builders hammering a foundation: sparks fly between worker and site.
  private builderLinks: { id: number; sx: number; sy: number }[] = [];
  private eventsTurn = -1;
  // Measured cadence of turn_resolved arrivals: glides stretch to fill it so
  // a marching unit flows tile-to-tile instead of dash-stop-dash.
  private lastTurnAt = 0;
  private turnMs = 2000;
  /** Fired on click: the picked entity's id, or null for empty ground. */
  onSelect: ((id: number | null) => void) | null = null;
  private selectedId: number | null = null;
  private size = 0;          // map size in tiles
  private worldW = 0;        // projected world bounds in px
  private worldH = 0;
  // camera
  private viewW = 640;
  private viewH = 640;
  private zoom = 1;
  private userCam = false;
  private dragging = false;
  private dragLast = { x: 0, y: 0 };
  private dragMoved = false;
  private dead = false;

  // -------------------------------------------------------------- projection

  /** Center of tile (tx,ty) in world px. Fractional tiles welcome. */
  private px(tx: number, ty: number): { x: number; y: number } {
    return {
      x: (tx - ty) * (TILE_W / 2) + this.worldW / 2,
      y: (tx + ty) * (TILE_H / 2) + TILE_H / 2,
    };
  }

  /** Inverse projection: world px -> fractional tile coords. */
  private tile(wx: number, wy: number): { tx: number; ty: number } {
    const rx = (wx - this.worldW / 2) / (TILE_W / 2);
    const ry = (wy - TILE_H / 2) / (TILE_H / 2);
    return { tx: (ry + rx) / 2, ty: (ry - rx) / 2 };
  }

  private diamond(g: Graphics, cx: number, cy: number, w = TILE_W, h = TILE_H): Graphics {
    return g.poly([cx, cy - h / 2, cx + w / 2, cy, cx, cy + h / 2, cx - w / 2, cy]);
  }

  // ------------------------------------------------------------- lifecycle

  async init(host: HTMLElement, viewW = 640, viewH = 640, _cover = false): Promise<void> {
    this.viewW = Math.max(60, viewW);
    this.viewH = Math.max(60, viewH);
    const app = new Application();
    await app.init({ width: this.viewW, height: this.viewH, background: 0x0b0f14,
                     antialias: false, autoDensity: true, roundPixels: true,
                     resolution: Math.min(window.devicePixelRatio || 1, 2) });
    if (this.dead) {
      // destroy() ran while awaiting (React StrictMode double-mount): this
      // renderer must NOT claim the host, or a zombie canvas with no resize
      // observer ends up on screen, frozen at its initial size.
      app.destroy(true, { children: true });
      return;
    }
    this.app = app;
    host.replaceChildren(app.canvas);
    this.root.addChild(this.terrain, this.decals, this.selection, this.sprites,
                       this.industry, this.effectsLayer, this.overlay, this.fog);
    app.stage.addChild(this.root);
    this.sprites.sortableChildren = true;
    app.ticker.add(() => this.tick(app.ticker.deltaMS));
    this.attachCameraControls(app.canvas);
  }

  destroy(): void {
    this.dead = true;
    this.fogTex?.destroy(true);
    this.fogTex = null;
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.puppets.clear();
    this.effects = [];
    this.decalList = [];
    this.gatherLinks = [];
  }

  /** Live-resize to the host rectangle; the canvas ALWAYS fills the host. */
  resizeView(viewW: number, viewH: number): void {
    if (!this.app || viewW < 60 || viewH < 60) return;
    if (viewW === this.viewW && viewH === this.viewH) return;
    this.viewW = viewW;
    this.viewH = viewH;
    this.app.renderer.resize(viewW, viewH);
    if (this.worldW > 0) {
      // A resize (the side panel growing as the match goes on) must NEVER
      // undo the viewer's zoom: keep it, only clamp so the map still fills.
      if (!this.userCam) this.resetCamera();
      else { this.zoom = Math.max(this.fitZoom(), this.zoom); this.applyCamera(); }
    }
  }

  // ------------------------------------------------------------------ camera

  private fitZoom(): number {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
  }

  private modeZoom(): number {
    // Default view: the whole battlefield, a notch closer than "fit" (fit
    // reads too small on wide screens); the wheel zooms between fit and 2.4x
    // and the minimap navigates when zoomed.
    return this.fitZoom() * 1.55;
  }

  private resetCamera(): void {
    this.zoom = this.modeZoom();
    this.root.scale.set(this.zoom);
    this.root.x = (this.viewW - this.worldW * this.zoom) / 2;
    this.root.y = (this.viewH - this.worldH * this.zoom) / 2;
    this.applyCamera();
  }

  /** Clamp the camera position so the world never drifts out of the viewport. */
  private applyCamera(): void {
    if (this.worldW <= 0) return;
    this.root.scale.set(this.zoom);
    const extW = this.worldW * this.zoom;
    const extH = this.worldH * this.zoom;
    this.root.x = extW <= this.viewW
      ? (this.viewW - extW) / 2
      : Math.min(0, Math.max(this.viewW - extW, this.root.x));
    this.root.y = extH <= this.viewH
      ? (this.viewH - extH) / 2
      : Math.min(0, Math.max(this.viewH - extH, this.root.y));
  }

  private attachCameraControls(canvas: HTMLCanvasElement): void {
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.dragMoved = false;
      this.dragLast = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragLast.x;
      const dy = e.clientY - this.dragLast.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        this.dragMoved = true;
        this.userCam = true;
      }
      this.root.x += dx;
      this.root.y += dy;
      this.dragLast = { x: e.clientX, y: e.clientY };
      this.applyCamera();
    });
    const stop = (e: PointerEvent) => {
      const wasClick = this.dragging && !this.dragMoved;
      this.dragging = false;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (wasClick) this.pick(e.offsetX, e.offsetY);
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", () => { this.dragging = false; });
    // Wheel zoom, anchored under the cursor: whole-map ... 2.4x close-up.
    canvas.addEventListener("wheel", (e) => {
      if (this.worldW <= 0) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = Math.min(2.4, Math.max(this.fitZoom(), this.zoom * factor));
      if (next === this.zoom) return;
      const wx = (e.offsetX - this.root.x) / this.zoom;
      const wy = (e.offsetY - this.root.y) / this.zoom;
      this.zoom = next;
      this.userCam = true;
      this.root.x = e.offsetX - wx * this.zoom;
      this.root.y = e.offsetY - wy * this.zoom;
      this.applyCamera();
    }, { passive: false });
  }

  /** Click -> select the entity on that tile (units win over buildings). */
  private pick(sx: number, sy: number): void {
    if (this.worldW <= 0) return;
    const { tx, ty } = this.tile((sx - this.root.x) / this.zoom,
                                 (sy - this.root.y) / this.zoom);
    const ix = Math.round(tx);
    const iy = Math.round(ty);
    let hit: EntityOut | null = null;
    for (const e of this.lastEntities) {
      if (e.kind === "unit") {
        if (e.x === ix && e.y === iy) { hit = e; break; }
      } else {
        const [w, h] = BUILDING_SIZE[e.type] ?? [1, 1];
        if (tx >= e.x - 0.5 && tx < e.x + w - 0.5 && ty >= e.y - 0.5 && ty < e.y + h - 0.5) {
          hit ??= e;
        }
      }
    }
    this.select(hit?.id ?? null);
    this.onSelect?.(hit?.id ?? null);
  }

  /** Highlight an entity (AoE2-style ring that follows it around). */
  select(id: number | null): void {
    this.selectedId = id;
    if (id === null) this.selection.clear();
  }

  // -------------------------------------------------- minimap / external API

  /** Visible world rectangle in 0..1 fractions (null before the first state). */
  getViewFrac(): { x: number; y: number; w: number; h: number } | null {
    if (this.worldW <= 0) return null;
    return {
      x: -this.root.x / this.zoom / this.worldW,
      y: -this.root.y / this.zoom / this.worldH,
      w: this.viewW / this.zoom / this.worldW,
      h: this.viewH / this.zoom / this.worldH,
    };
  }

  /** Center the camera on a 0..1 world position (minimap click). */
  centerOnFrac(fx: number, fy: number): void {
    if (this.worldW <= 0) return;
    this.userCam = true;
    this.root.x = this.viewW / 2 - fx * this.worldW * this.zoom;
    this.root.y = this.viewH / 2 - fy * this.worldH * this.zoom;
    this.applyCamera();
  }

  /** The visible world rectangle's corners in TILE coordinates, clockwise from
   * top-left (for a square top-down minimap; the iso camera maps to a rotated
   * quad there). Null before the first state. */
  getViewTileQuad(): { tx: number; ty: number }[] | null {
    if (this.worldW <= 0) return null;
    const corners: [number, number][] = [
      [0, 0], [this.viewW, 0], [this.viewW, this.viewH], [0, this.viewH]];
    return corners.map(([sx, sy]) =>
      this.tile((sx - this.root.x) / this.zoom, (sy - this.root.y) / this.zoom));
  }

  /** Center the camera on a tile position (square-minimap click). */
  centerOnTile(tx: number, ty: number): void {
    if (this.worldW <= 0) return;
    this.userCam = true;
    const c = this.px(tx, ty);
    this.root.x = this.viewW / 2 - c.x * this.zoom;
    this.root.y = this.viewH / 2 - c.y * this.zoom;
    this.applyCamera();
  }

  /** Make an agent's order VISIBLE: pulse selection rings on the commanded
   * units and drop a reticle on the target (entity or tile), AoE2-style. */
  flashOrder(playerIndex: number, groups: {
    actor_ids?: number[];
    target?: { id?: number; x?: number; y?: number; kind?: string };
    action?: string;
  }[]): void {
    const color = PLAYER_TINTS[playerIndex % 4];
    for (const gr of groups) {
      // Selection rings: the commanding player's COLOR around each unit.
      for (const id of (gr.actor_ids ?? []).slice(0, 10)) {
        const p = this.puppets.get(id);
        if (!p || p.dying !== null) continue;
        this.addEffect(2400, (g, k) => {
          if (p.root.destroyed) return;  // the unit died mid-flash
          const r = 12 + 2.5 * Math.sin(k * Math.PI * 6);
          const a = k < 0.8 ? 0.95 : 0.95 * (1 - (k - 0.8) / 0.2);
          g.ellipse(p.root.x, p.root.y + 8, r, r * 0.5)
            .stroke({ width: 2.5, color, alpha: a });
          g.ellipse(p.root.x, p.root.y + 8, r - 3, (r - 3) * 0.5)
            .stroke({ width: 1, color: 0xffffff, alpha: a * 0.35 });
        });
      }
      const t = gr.target;
      if (!t) continue;
      const hostile = gr.action === "attack" || gr.action === "push";
      let cx = 0, cy = 0, ok = false;
      if (typeof t.id === "number" && this.puppets.has(t.id)) {
        const tp = this.puppets.get(t.id)!;
        if (tp.root.destroyed) continue;
        cx = tp.root.x; cy = tp.root.y; ok = true;
      } else if (typeof t.x === "number" && typeof t.y === "number") {
        const c = this.px(t.x, t.y);
        cx = c.x; cy = c.y; ok = true;
      }
      if (!ok) continue;
      // Target marker: a BIG pulsing circle in the same player color, so
      // "who ordered this, at what" reads instantly. Hostile = double ring.
      this.addEffect(2400, (g, k) => {
        const a = k < 0.8 ? 0.9 : 0.9 * (1 - (k - 0.8) / 0.2);
        const r = TILE_W * (0.62 + 0.08 * Math.sin(k * Math.PI * 6));
        g.ellipse(cx, cy, r, r * 0.5).stroke({ width: 3, color, alpha: a });
        if (hostile) {
          g.ellipse(cx, cy, r * 0.72, r * 0.36)
            .stroke({ width: 2, color: 0xff5252, alpha: a });
        }
        g.circle(cx, cy, 2.2).fill({ color, alpha: a });
      });
    }
  }

  // ------------------------------------------------------------------ render

  render(state: GameState, perspective: number | null, snap = false): void {
    if (!this.app) return;
    if (this.size !== state.size) {
      this.size = state.size;
      this.worldW = state.size * TILE_W;
      this.worldH = state.size * TILE_H + TILE_H; // headroom for tall sprites
      this.terrainKey = "";
      this.resetCamera();  // whole map, centered (MAP-VIEW-SPEC invariant 1)
    }

    // Learn the live turn cadence (EMA), so glides last one whole turn.
    if (!snap && state.turn !== this.eventsTurn) {
      const now = performance.now();
      if (this.lastTurnAt > 0) {
        const dt = Math.min(9000, Math.max(700, now - this.lastTurnAt));
        this.turnMs = this.turnMs * 0.5 + dt * 0.5;
      }
      this.lastTurnAt = now;
    }

    // Fog sets (single player or the union of everyone): units are only drawn
    // inside current vision; buildings also on explored ground (last-seen,
    // AoE2-style). God view (null) draws everything.
    const fogged = perspective !== null
      && (perspective === PERSPECTIVE_ALL || !!state.players[perspective]);

    this.renderTerrain(state, fogged);
    this.overlay.clear();
    const visSet = fogged ? visibleTilesFor(state, perspective!) : null;
    const expSet = fogged ? exploredTilesFor(state, perspective!) : null;
    const canSee = (e: EntityOut): boolean => {
      if (!visSet) return true;
      const packed = e.y * this.size + e.x;
      if (e.kind === "unit") return visSet.has(packed);
      return visSet.has(packed) || expSet!.has(packed);
    };
    this.lastEntities = Object.values(state.entities).filter(canSee);

    const seen = new Set<number>();
    this.gatherLinks = [];
    this.builderLinks = [];
    for (const e of this.lastEntities) {
      seen.add(e.id);
      if (e.kind === "building") this.syncBuilding(e);
      else this.syncUnit(e, snap);
      // A worker adjacent to its gather target is visibly WORKING (not while
      // it walks a full load home).
      const so = e.standing_order;
      if (e.kind === "unit" && e.type === "worker" && so?.type === "gather"
          && so.phase !== "return" && Array.isArray(so.target)
          && Math.max(Math.abs(e.x - so.target[0]), Math.abs(e.y - so.target[1])) <= 1) {
        const t = this.px(so.target[0], so.target[1]);
        this.gatherLinks.push({ id: e.id, wx: t.x, wy: t.y });
      }
      // A worker next to the foundation it is tasked on is HAMMERING.
      if (e.kind === "unit" && e.type === "worker" && so?.type === "build"
          && typeof so.target_id === "number") {
        const site = state.entities[String(so.target_id)];
        if (site && site.build_progress) {
          const [w, h] = BUILDING_SIZE[site.type] ?? [1, 1];
          const near = e.x >= site.x - 1 && e.x <= site.x + w && e.y >= site.y - 1
            && e.y <= site.y + h;
          if (near) {
            const c = this.px(site.x + w / 2 - 0.5, site.y + h / 2 - 0.5);
            this.builderLinks.push({ id: e.id, sx: c.x, sy: c.y - TILE_H * 0.3 });
          }
        }
      }
    }

    // Battle effects: play each resolved turn's events exactly once.
    if (!snap && state.events_last_turn && state.turn !== this.eventsTurn) {
      this.eventsTurn = state.turn;
      for (const ev of state.events_last_turn) this.spawnEventFx(ev);
    } else if (snap) {
      this.eventsTurn = state.turn; // replay scrubbing: don't replay history
    }
    for (const [id, p] of this.puppets) {
      if (!seen.has(id) && p.dying === null) {
        p.dying = performance.now();
        p.fx = p.root.x; p.fy = p.root.y;
        p.tx = p.root.x; p.ty = p.root.y;
      }
    }

    if (visSet && expSet) {
      this.updateFog(state, perspective!, expSet);
      this.fog.visible = true;
    } else {
      this.fog.visible = false;
    }
  }

  // Fog canvas padding, in tiles: darkness extends PAST the map border so the
  // unknown interior and the world beyond the edge are ONE continuous black -
  // no cut-out diamond silhouette, no seams (MAP-VIEW-SPEC invariant 3).
  private static readonly FOG_PAD = 10;

  /** Soft round fog: opaque background-colored darkness everywhere, half
   * lifted over explored ground, fully melted in a radial gradient around
   * every unit/building the viewer owns (union for "all"), then blurred so
   * no tile edge survives. */
  private updateFog(state: GameState, perspective: number, expSet: Set<number>): void {
    const S = 6; // fog canvas pixels per tile
    const P = MapRenderer.FOG_PAD;
    const n = (this.size + P * 2) * S;
    if (!this.fogCanvas || this.fogCanvas.width !== n) {
      this.fogCanvas = document.createElement("canvas");
      this.fogCanvas.width = this.fogCanvas.height = n;
      this.fogBlurCanvas = document.createElement("canvas");
      this.fogBlurCanvas.width = this.fogBlurCanvas.height = n;
      this.fogTex?.destroy(true);
      this.fogTex = null;
    }
    const g = this.fogCanvas.getContext("2d")!;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, n, n);
    // Fully opaque and the SAME color as the app background: unknown map and
    // off-map world become indistinguishable.
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, n, n);
    g.globalCompositeOperation = "destination-out";
    // Explored ground: lift part of the darkness (dim memory of the terrain).
    g.fillStyle = "rgba(0,0,0,0.5)";
    for (const packed of expSet) {
      const x = packed % this.size;
      const y = Math.floor(packed / this.size);
      g.fillRect((x + P) * S, (y + P) * S, S, S);
    }
    // Current vision: a round soft LIGHT around every eye the viewer owns.
    const owners = new Set<number>(perspective === PERSPECTIVE_ALL
      ? state.players.map((p) => p.id) : [perspective]);
    for (const e of Object.values(state.entities)) {
      if (!owners.has(e.owner)) continue;
      const oracle = state.players[e.owner]?.lineage === "oracle" ? 2 : 0;
      const [w, h] = e.kind === "unit" ? [1, 1] : BUILDING_SIZE[e.type] ?? [1, 1];
      const vis = (e.kind === "unit"
        ? UNIT_VISION[e.type] ?? 3 : BUILDING_VISION[e.type] ?? 2) + oracle;
      const cx = (e.x + P + w / 2) * S;
      const cy = (e.y + P + h / 2) * S;
      const r = (vis + 0.6) * S;
      const grad = g.createRadialGradient(
        cx, cy, Math.max(1, (vis - 1.4) * S), cx, cy, r);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    // Blur the whole mask by ~1.5 tiles: the explored area's tile staircase
    // melts into round, organic light borders (MAP-VIEW-SPEC invariant 3).
    const bg = this.fogBlurCanvas!.getContext("2d")!;
    bg.clearRect(0, 0, n, n);
    bg.filter = `blur(${Math.round(S * 1.5)}px)`;
    bg.drawImage(this.fogCanvas, 0, 0);
    bg.filter = "none";
    if (!this.fogTex) {
      this.fogTex = Texture.from(this.fogBlurCanvas!);
      this.fogTex.source.scaleMode = "linear"; // smooth upscale, no pixel steps
      this.fog.texture = this.fogTex;
    } else {
      this.fogTex.source.update();
    }
    // Map the padded grid-space canvas onto the isometric world.
    this.fog.setFromMatrix(new Matrix(
      TILE_W / (2 * S), TILE_H / (2 * S),
      -TILE_W / (2 * S), TILE_H / (2 * S),
      this.worldW / 2, -P * TILE_H));
  }

  // ------------------------------------------------------------------ ticker

  private packWasReady = false;

  private tickErrors = 0;

  private tick(deltaMS: number): void {
    // PixiJS v8 stops scheduling frames if a ticker listener throws: one bad
    // effect would freeze the whole map for the rest of the match. Contain it.
    try {
      this.tickInner(deltaMS);
    } catch (err) {
      if (this.tickErrors++ < 3) console.error("map tick error (frame skipped)", err);
      this.effects.forEach((fx) => fx.g.destroy());
      this.effects = [];
    }
  }

  private tickInner(deltaMS: number): void {
    const now = performance.now();
    // The atlases can finish loading after the first render (or after the
    // match ended and no more renders come): re-skin every puppet once.
    if (!this.packWasReady && packReady()) {
      this.packWasReady = true;
      for (const p of this.puppets.values()) this.refreshFrames(p);
    }
    for (const [id, p] of this.puppets) {
      if (p.dying !== null) {
        const k = (now - p.dying) / DEATH_MS;
        if (k >= 1) {
          p.root.destroy({ children: true });
          this.puppets.delete(id);
          continue;
        }
        p.root.alpha = 1 - k;
        const s = 1 + k * 0.5;
        p.root.scale.set(s);
        continue;
      }
      const moving = p.dur > 0 && now - p.t0 < p.dur;
      if (moving) {
        const k = (now - p.t0) / p.dur;
        // Long glides run LINEAR (constant speed turn after turn = a smooth
        // march); only short hops keep the ease-in-out.
        const e = p.dur > 900 ? k
          : k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
        p.root.x = p.fx + (p.tx - p.fx) * e;
        p.root.y = p.fy + (p.ty - p.fy) * e;
      } else if (p.root.x !== p.tx || p.root.y !== p.ty) {
        p.root.x = p.tx;
        p.root.y = p.ty;
      }
      if (p.frames.length > 1) {
        p.frameAcc += deltaMS;
        const step = moving ? WALK_FRAME_MS : IDLE_FRAME_MS;
        if (p.frameAcc >= step) {
          p.frameAcc = 0;
          p.frameIx = (p.frameIx + 1) % p.frames.length;
          p.sprite.texture = p.frames[p.frameIx];
        }
      }
      // Hit flash: the victim flinches red for a beat after each landed hit.
      p.sprite.tint = p.hitAt && now - p.hitAt < HIT_FLASH_MS ? 0xff7a7a : 0xffffff;
    }
    this.tickEffects(now);
    this.drawSelectionRing();
  }

  /** Per-frame battle layers: transient effects, fading wrecks, gather beams. */
  private tickEffects(now: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      const k = (now - fx.t0) / fx.dur;
      if (k < 0) continue;               // scheduled (e.g. impact after flight)
      if (k >= 1) {
        fx.g.destroy();
        this.effects.splice(i, 1);
        continue;
      }
      fx.g.clear();
      fx.draw(fx.g, k);
    }

    const d = this.decals;
    d.clear();
    for (let i = this.decalList.length - 1; i >= 0; i--) {
      const s = this.decalList[i];
      const age = (now - s.t0) / DECAL_MS;
      if (age >= 1) { this.decalList.splice(i, 1); continue; }
      const alpha = 0.45 * (1 - age);
      d.ellipse(s.x, s.y + 2, s.r, s.r * 0.5).fill({ color: 0x0a0c10, alpha });
      d.ellipse(s.x - s.r * 0.3, s.y, s.r * 0.35, s.r * 0.18)
        .fill({ color: 0x1f1410, alpha: alpha * 0.8 });
    }

    // Industry: pulsing beam + a spark travelling worker -> resource, so the
    // economy is visibly alive (AoE2 villagers are never just standing there).
    const ind = this.industry;
    ind.clear();
    for (const link of this.gatherLinks) {
      const p = this.puppets.get(link.id);
      if (!p || p.dying !== null) continue;
      const wx = p.root.x, wy = p.root.y + 4;
      const pulse = (Math.sin(now / 160 + link.id) + 1) / 2;
      ind.moveTo(wx, wy).lineTo(link.wx, link.wy)
        .stroke({ width: 1.5, color: 0xe6c352, alpha: 0.12 + 0.22 * pulse });
      const t = ((now / 420 + link.id * 0.37) % 1);
      const sx = link.wx + (wx - link.wx) * t;  // sparks flow resource -> worker
      const sy = link.wy + (wy - link.wy) * t;
      ind.circle(sx, sy, 1.8).fill({ color: 0xffe082, alpha: 0.9 });
      ind.circle(sx, sy, 3.4).fill({ color: 0xe6c352, alpha: 0.25 });
    }
    // Construction: a hammer-blow spark burst from every builder onto its
    // site, on a per-worker rhythm, so crews visibly BUILD (AoE2 villagers
    // swing at foundations; the building rises with the blows).
    for (const link of this.builderLinks) {
      const p = this.puppets.get(link.id);
      if (!p || p.dying !== null) continue;
      const beat = ((now / 520 + link.id * 0.41) % 1);
      const wx = p.root.x, wy = p.root.y - 2;
      const hx = wx + (link.sx - wx) * 0.45;
      const hy = wy + (link.sy - wy) * 0.45;
      ind.moveTo(wx, wy).lineTo(hx, hy)
        .stroke({ width: 1.2, color: 0xffb020, alpha: 0.18 + 0.25 * (1 - beat) });
      if (beat < 0.35) {
        const k = beat / 0.35;
        for (let i = 0; i < 4; i++) {
          const ang = (link.id + i) * 1.57 + i * 0.5;
          const r = 2 + k * 7;
          ind.moveTo(hx, hy).lineTo(hx + Math.cos(ang) * r, hy + Math.sin(ang) * r * 0.55)
            .stroke({ width: 1.2, color: 0xffd27a, alpha: 1 - k });
        }
        ind.circle(hx, hy, 2 * (1 - k)).fill({ color: 0xffffff, alpha: 1 - k });
      }
    }
  }

  /** AoE2-style ellipse under the selected entity, following its glide. */
  private drawSelectionRing(): void {
    if (this.selectedId === null) return;
    const p = this.puppets.get(this.selectedId);
    const g = this.selection;
    g.clear();
    if (!p || p.dying !== null) return;
    const w = Math.abs(p.sprite.width);
    const feetY = p.root.y + Math.abs(p.sprite.height) * (p.kind === "unit" ? 0.32 : 0.28);
    g.ellipse(p.root.x, feetY, w * 0.5, w * 0.25)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    g.ellipse(p.root.x, feetY, w * 0.5 + 2.5, w * 0.25 + 1.6)
      .stroke({ width: 1, color: 0x23d4e8, alpha: 0.5 });
  }

  // ----------------------------------------------------------- battle effects

  private addEffect(dur: number, draw: (g: Graphics, k: number) => void,
                    delay = 0): void {
    const g = new Graphics();
    this.effectsLayer.addChild(g);
    this.effects.push({ g, t0: performance.now() + delay, dur, draw });
  }

  /** Turn one engine event into visible fire, explosions and scars. */
  private spawnEventFx(ev: GameEvent): void {
    const type = ev.type;

    if (type === "attack") {
      const src = ev.src as number[] | undefined;
      const dst = ev.dst as number[] | undefined;
      if (!src || !dst) return;
      const a = this.px(src[0], src[1]);
      const b = this.px(dst[0], dst[1]);
      a.y -= TILE_H * 0.45; // fire from the torso, not the feet
      b.y -= TILE_H * 0.35;
      const owner = typeof ev.owner === "number" ? ev.owner : -1;
      const color = owner >= 0 ? PLAYER_TINTS[owner % 4] : 0xdddddd;
      const victim = this.puppets.get(ev.target as number);
      const heavy = ev.attacker_type === "launcher" || ev.attacker_type === "turret"
        || ev.attacker_type === "walking_tower";

      if (ev.ranged) {
        // Plasma bolt: glowing head + short trail flying src -> dst.
        this.addEffect(BOLT_MS, (g, k) => {
          const x = a.x + (b.x - a.x) * k;
          const y = a.y + (b.y - a.y) * k;
          const tx = x - (b.x - a.x) * 0.08;
          const ty = y - (b.y - a.y) * 0.08;
          g.moveTo(tx, ty).lineTo(x, y)
            .stroke({ width: heavy ? 3 : 2, color, alpha: 0.9 });
          g.circle(x, y, heavy ? 4 : 2.6).fill({ color: 0xffffff, alpha: 0.95 });
          g.circle(x, y, heavy ? 8 : 5).fill({ color, alpha: 0.3 });
        });
        // Impact flash when the bolt lands (+ the victim flinches red).
        this.addEffect(200, (g, k) => {
          g.circle(b.x, b.y, 3 + k * 9).stroke({ width: 2, color: 0xffd54f, alpha: 1 - k });
          g.circle(b.x, b.y, 2 + (1 - k) * 3).fill({ color: 0xffffff, alpha: 1 - k });
        }, BOLT_MS);
        if (victim) setTimeout(() => { if (!victim.root.destroyed) victim.hitAt = performance.now(); }, BOLT_MS);
      } else {
        // Melee: spark burst on the victim, immediately.
        const seed = ((ev.attacker as number) ?? 0) * 7;
        this.addEffect(260, (g, k) => {
          for (let i = 0; i < 5; i++) {
            const ang = (seed + i) * 1.257;
            const r = 3 + k * 10;
            g.moveTo(b.x + Math.cos(ang) * 2, b.y + Math.sin(ang) * 1)
              .lineTo(b.x + Math.cos(ang) * r, b.y + Math.sin(ang) * r * 0.5)
              .stroke({ width: 1.5, color: 0xffe082, alpha: 1 - k });
          }
          g.circle(b.x, b.y, 2.5 * (1 - k)).fill({ color: 0xffffff, alpha: 1 - k });
        });
        if (victim) victim.hitAt = performance.now();
      }
      return;
    }

    if (type === "deposit") {
      // The economy made visible: a +N floater rises over the drop-off in the
      // resource's color (AoE2's resource counters ticking up, at the place).
      const x = ev.x as number, y = ev.y as number;
      if (typeof x !== "number") return;
      const c = this.px(x, y);
      const energy = (ev.energy as number) ?? 0;
      const metal = (ev.metal as number) ?? 0;
      const color = metal >= energy ? 0xaab4c4 : 0x3ddc97;
      const amount = Math.max(energy, metal);
      const seed = ((ev.unit as number) ?? 0) % 7;
      this.addEffect(1100, (g, k) => {
        const yy = c.y - TILE_H * 0.6 - k * TILE_H * 0.9;
        const a = k < 0.7 ? 0.95 : 0.95 * (1 - (k - 0.7) / 0.3);
        const w = 3 + Math.min(6, amount / 5);
        g.roundRect(c.x - w / 2 + seed - 3, yy - 2, w, 3.5, 1).fill({ color, alpha: a });
        g.rect(c.x - w / 2 + seed - 3, yy - 2, w * 0.35, 1).fill({ color: 0xffffff, alpha: a * 0.6 });
        g.circle(c.x + seed - 3, yy + 3, 1.2).fill({ color, alpha: a * 0.5 });
      }, seed * 40);
      return;
    }

    if (type === "site_placed") {
      // A foundation dropped: a pulse of the footprint in the owner's color.
      const c = this.px(ev.x as number, ev.y as number);
      const owner = typeof ev.player === "number" ? ev.player : -1;
      const color = owner >= 0 ? PLAYER_TINTS[owner % 4] : 0xdddddd;
      this.addEffect(900, (g, k) => {
        const r = TILE_W * (0.4 + 0.5 * k);
        g.ellipse(c.x + TILE_W * 0.25, c.y + TILE_H * 0.25, r, r * 0.5)
          .stroke({ width: 2, color, alpha: 0.8 * (1 - k) });
      });
      return;
    }

    if (type === "built" || type === "core_founded") {
      // The building pops to life; founding a city gets the big ring.
      const c = this.px(ev.x as number, ev.y as number);
      const owner = typeof ev.player === "number" ? ev.player : -1;
      const color = owner >= 0 ? PLAYER_TINTS[owner % 4] : 0xdddddd;
      const big = type === "core_founded";
      this.addEffect(big ? 1800 : 700, (g, k) => {
        const r = TILE_W * (big ? 0.8 + 1.6 * k : 0.5 + 0.5 * k);
        g.ellipse(c.x + TILE_W * 0.25, c.y + TILE_H * 0.25, r, r * 0.5)
          .stroke({ width: big ? 3 : 2, color, alpha: 0.9 * (1 - k) });
        if (big) {
          g.ellipse(c.x + TILE_W * 0.25, c.y + TILE_H * 0.25, r * 0.6, r * 0.3)
            .stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 * (1 - k) });
        }
      });
      return;
    }

    if (type === "pod_depleted" || type === "vein_depleted") {
      // The bushes are gone: a small puff where the tile turned to plain.
      const c = this.px(ev.x as number, ev.y as number);
      const color = type === "pod_depleted" ? 0x3ddc97 : 0xe6c352;
      this.addEffect(600, (g, k) => {
        g.ellipse(c.x, c.y, TILE_W * 0.3 * (1 + k), TILE_H * 0.3 * (1 + k))
          .stroke({ width: 1.5, color, alpha: 0.7 * (1 - k) });
      });
      return;
    }

    if (type === "unit_killed") {
      const x = ev.x as number, y = ev.y as number;
      if (typeof x !== "number") return;
      const big = ev.unit_type === "colossus" || ev.unit_type === "walking_tower";
      const span = big ? TILE_W * 0.78 : TILE_W * 0.56;
      this.explosionAt(this.px(x, y), span * 0.95, 550);
      this.decalList.push({ ...this.px(x, y), r: span * 0.3, t0: performance.now() });
      return;
    }

    if (type === "building_destroyed" || type === "rack_destroyed"
        || type === "core_destroyed") {
      const x = (ev.x as number) ?? null, y = (ev.y as number) ?? null;
      if (x === null) return;
      const span = type === "core_destroyed" ? TILE_W * 1.6 : TILE_W * 0.9;
      this.explosionAt(this.px(x, y), span, 850);
      this.decalList.push({ ...this.px(x, y), r: span * 0.4, t0: performance.now() });
      return;
    }

    if (type === "rack_cascade" || type === "cocoon_burst") {
      const c = this.px(ev.x as number, ev.y as number);
      this.addEffect(520, (g, k) => {  // shockwave over the blast radius
        g.ellipse(c.x, c.y, TILE_W * 1.4 * k, TILE_H * 1.4 * k)
          .stroke({ width: 3 * (1 - k) + 1, color: 0xff7043, alpha: 0.9 * (1 - k) });
      });
    }
  }

  /** Fireball + ring + flying debris, scaled to the victim ("as big as the
   * character"). The AoE2 rule: destruction must be proportional. */
  private explosionAt(c: { x: number; y: number }, size: number, dur: number): void {
    const seed = Math.floor(c.x + c.y);
    this.addEffect(dur, (g, k) => {
      const r = size * (0.3 + 0.7 * k);
      g.circle(c.x, c.y, r * 1.1).stroke({ width: 2.5, color: 0xff5722, alpha: 0.7 * (1 - k) });
      g.circle(c.x, c.y, r).fill({ color: 0xff9800, alpha: 0.5 * (1 - k) });
      g.circle(c.x, c.y, r * 0.55).fill({ color: 0xffeb3b, alpha: 0.85 * (1 - k) });
      g.circle(c.x, c.y, r * 0.25 * (1 - k)).fill({ color: 0xffffff, alpha: 1 - k });
      for (let i = 0; i < 7; i++) {  // debris chunks on iso-flattened arcs
        const ang = (seed + i) * 0.897;
        const dr = size * 1.25 * k;
        const px = c.x + Math.cos(ang) * dr;
        const py = c.y + Math.sin(ang) * dr * 0.5 - size * 0.5 * k * (1 - k) * 2;
        g.rect(px - 2, py - 2, 4, 4)
          .fill({ color: i % 2 ? 0x8d6e63 : 0x546e7a, alpha: 1 - k });
      }
      // smoke rising as the fire dies
      if (k > 0.35) {
        const ks = (k - 0.35) / 0.65;
        g.circle(c.x + 3, c.y - size * 0.4 * ks, size * 0.3 * ks)
          .fill({ color: 0x37474f, alpha: 0.5 * (1 - ks) });
        g.circle(c.x - 5, c.y - size * 0.6 * ks, size * 0.22 * ks)
          .fill({ color: 0x455a64, alpha: 0.4 * (1 - ks) });
      }
    });
  }

  // ----------------------------------------------------------------- puppets

  private makePuppet(id: number, e: EntityOut): Puppet {
    const root = new Container();
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    const under = new Graphics();
    const status = new Graphics();
    root.addChild(under, sprite, status);
    this.sprites.addChild(root);
    const p: Puppet = {
      root, sprite, under, status, kind: e.kind, type: e.type, owner: e.owner,
      big: e.type === "colossus" || e.type === "walking_tower",
      fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 0, facing: 1,
      gx: -1, gy: -1, dir: "s", mirror: false,
      frames: [], framesKey: "", frameIx: 0, frameAcc: 0, dying: null, hitAt: 0,
    };
    this.puppets.set(id, p);
    return p;
  }

  private refreshFrames(p: Puppet): void {
    const key = `${p.type}:${p.owner}:${packReady()}:${p.dir}`;
    if (key === p.framesKey) return;
    p.framesKey = key;
    p.frames = p.kind === "unit"
      ? getUnitFrames(p.type, p.owner, p.dir)
      : getBuildingFrames(p.type, p.owner);
    p.frameIx = p.frameIx % p.frames.length;
    p.sprite.texture = p.frames[p.frameIx];
  }

  /** 8-way heading from a grid move, in SCREEN space (iso: screen-x ~ gx-gy,
   * screen-y ~ gx+gy). Returns the texture pose + whether to mirror (left). */
  private static heading(dgx: number, dgy: number): { dir: string; mirror: boolean } {
    const sx2 = dgx - dgy;
    const sy2 = dgx + dgy;
    const octant = Math.round(Math.atan2(sy2, sx2) / (Math.PI / 4)) & 7;
    return [
      { dir: "e", mirror: false },   // 0
      { dir: "se", mirror: false },  // 1
      { dir: "s", mirror: false },   // 2
      { dir: "se", mirror: true },   // 3 sw
      { dir: "e", mirror: true },    // 4 w
      { dir: "ne", mirror: true },   // 5 nw
      { dir: "n", mirror: false },   // 6
      { dir: "ne", mirror: false },  // 7
    ][octant];
  }

  private syncUnit(e: EntityOut, snap: boolean): void {
    const p = this.puppets.get(e.id) ?? this.makePuppet(e.id, e);
    p.dying = null;
    // Heading -> one of 8 poses (front, back, profile, quarter turns).
    if (p.gx >= 0 && (p.gx !== e.x || p.gy !== e.y)) {
      const h = MapRenderer.heading(e.x - p.gx, e.y - p.gy);
      p.dir = h.dir;
      p.mirror = h.mirror;
    }
    p.gx = e.x; p.gy = e.y;
    this.refreshFrames(p);

    // Upright billboard standing on the diamond, like an AoE2 sprite.
    const span = p.big ? TILE_W * 0.78 : TILE_W * 0.56;
    p.sprite.width = span;
    p.sprite.height = span;
    const c = this.px(e.x, e.y);
    const cx = c.x;
    const cy = c.y - span * 0.28;
    const isNew = p.tx === 0 && p.ty === 0 && p.root.x === 0 && p.root.y === 0;

    if (isNew || snap) {
      p.tx = cx; p.ty = cy; p.fx = cx; p.fy = cy; p.dur = 0;
      p.root.x = cx; p.root.y = cy;
    } else if (cx !== p.tx || cy !== p.ty) {
      p.fx = p.root.x; p.fy = p.root.y;
      p.tx = cx; p.ty = cy;
      p.t0 = performance.now();
      // One glide = one turn: the unit is still arriving when the next state
      // lands, so multi-turn marches read as ONE continuous walk.
      p.dur = Math.max(MOVE_MS, this.turnMs * 0.96);
    }
    // Left-facing poses are the mirrored right-facing textures.
    p.sprite.scale.x = Math.abs(p.sprite.scale.x) * (p.mirror ? -1 : 1);
    p.root.zIndex = (e.x + e.y) * 10 + 5;
    p.root.alpha = e.stiff ? 0.4 : 1;

    // Grounding shadow at the feet - without it billboards look like they float.
    p.under.clear();
    p.under.ellipse(0, span * 0.34, span * 0.34, span * 0.13)
      .fill({ color: 0x000000, alpha: 0.3 });
    const g = p.status;
    g.clear();
    if (e.type === "human" && e.owner >= 0) {
      g.ellipse(0, span * 0.3, span * 0.5, span * 0.24)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
    }
    if (e.stiff) {
      g.rect(-span * 0.24, -span * 0.55, span * 0.48, span * 0.14)
        .fill({ color: 0x90caf9, alpha: 0.9 });
    }
    // Cargo: a worker carrying energy (green cell) or metal (steel crate) shows
    // it on its back - AoE2 villagers visibly haul what they gathered.
    const cargo = (e.cargo_e ?? 0) + (e.cargo_m ?? 0);
    if (cargo > 0) {
      const k = Math.min(1, cargo / CARRY_CAPACITY);
      const cw = span * (0.16 + 0.12 * k);
      const color = (e.cargo_m ?? 0) >= (e.cargo_e ?? 0) ? 0xaab4c4 : 0x3ddc97;
      g.roundRect(span * 0.18, -span * 0.12, cw, cw * 0.8, 1.5)
        .fill({ color, alpha: 0.95 }).stroke({ width: 1, color: 0x181425, alpha: 0.9 });
      g.rect(span * 0.18 + 1.5, -span * 0.12 + 1.5, cw * 0.4, 1.2)
        .fill({ color: 0xffffff, alpha: 0.6 });
      if (e.standing_order?.phase === "return") {
        // heading home with a full load: a small arrow over the crate
        g.moveTo(span * 0.3, -span * 0.22).lineTo(span * 0.3, -span * 0.34)
          .stroke({ width: 1.5, color: 0xffe082, alpha: 0.9 });
      }
    }
    // HP bar ABOVE the head, AoE2-style.
    this.hpBarOn(g, -span * 0.35, -span * 0.62, span * 0.7, e.hp,
                 UNIT_MAX_HP[e.type] ?? 30);
  }

  private syncBuilding(e: EntityOut): void {
    const p = this.puppets.get(e.id) ?? this.makePuppet(e.id, e);
    p.dying = null;
    this.refreshFrames(p);
    const [w, h] = BUILDING_SIZE[e.type] ?? [1, 1];
    // Footprint diamond is (w+h)/2 tiles wide; the building fills most of it.
    const span = ((w + h) / 2) * TILE_W * 0.72;
    p.sprite.width = span;
    p.sprite.height = span;
    const c = this.px(e.x + w / 2 - 0.5, e.y + h / 2 - 0.5);
    const cx = c.x;
    const cy = c.y - span * 0.2;
    p.tx = cx; p.ty = cy; p.fx = cx; p.fy = cy; p.dur = 0;
    p.root.x = cx; p.root.y = cy;
    p.root.zIndex = (e.x + w - 1 + e.y + h - 1) * 10;
    // Foundations rise with the work done (AoE2's three construction stages):
    // ghosted at 0%, solid when complete.
    const total = e.build_total ?? 0;
    const done = e.build_progress && total > 0
      ? Math.max(0, Math.min(1, 1 - e.build_progress / total)) : 1;
    p.root.alpha = e.build_progress ? 0.35 + 0.5 * done : 1;

    const footW = ((w + h) / 2) * TILE_W;
    const footY = span * 0.2;
    // Foundation plate: the building's footprint as a tinted diamond, so the
    // structure visibly OWNS its tiles on the grid (AoE2 buildings sit like this).
    const tint = e.owner >= 0
      ? [0x4fc3f7, 0xef5350, 0x9ccc65, 0xffb74d][e.owner % 4] : 0x9e9e9e;
    const rel = (dx: number, dy: number) => ({
      x: (dx - dy) * (TILE_W / 2),
      y: (dx + dy) * (TILE_H / 2),
    });
    p.under.clear();
    const c0 = rel(-w / 2, -h / 2), c1 = rel(w / 2, -h / 2),
          c2 = rel(w / 2, h / 2), c3 = rel(-w / 2, h / 2);
    const baseY = span * 0.2; // foundation sits at the sprite's feet
    p.under.poly([c0.x, c0.y + baseY, c1.x, c1.y + baseY,
                  c2.x, c2.y + baseY, c3.x, c3.y + baseY])
      .fill({ color: tint, alpha: 0.16 })
      .stroke({ width: 1.5, color: tint, alpha: 0.55 });

    const g = p.status;
    g.clear();
    if (e.build_progress) {
      // Construction site: scaffold poles + an amber progress bar (AoE2 draws
      // the building rising in stages; the bar says how many work points are in).
      const poleH = span * 0.5 * (0.4 + 0.6 * done);
      for (const [px, py] of [[-footW * 0.42, footY * 0.5], [footW * 0.42, footY * 0.5],
                              [0, -footY * 0.3]] as const) {
        g.rect(px - 1, py - poleH, 2, poleH).fill({ color: 0xd8a54a, alpha: 0.9 });
        g.rect(px - 5, py - poleH, 10, 1.5).fill({ color: 0xd8a54a, alpha: 0.8 });
      }
      g.rect(-footW * 0.3, -span * 0.62, footW * 0.6, 3.5).fill(0x1a1f2a);
      g.rect(-footW * 0.3, -span * 0.62, footW * 0.6 * done, 3.5).fill(0xffb020);
      g.rect(-footW * 0.3, -span * 0.62, footW * 0.6, 3.5)
        .stroke({ width: 1, color: 0xffd27a, alpha: 0.7 });
    } else if (e.type === "core") {
      // Death stages: warning ring below 300 hp, fire below 150.
      if (e.hp <= 150) {
        g.ellipse(0, footY, footW * 0.52, footW * 0.26)
          .stroke({ width: 3, color: 0xff3d00 });
        g.rect(-span * 0.18, -span * 0.32, span * 0.12, span * 0.2).fill(0xff7043);
        g.rect(span * 0.08, -span * 0.28, span * 0.1, span * 0.16).fill(0xffab40);
      } else if (e.hp <= 300) {
        g.ellipse(0, footY, footW * 0.52, footW * 0.26)
          .stroke({ width: 2, color: 0xffab00 });
      }
    }
    if (e.capture) {
      g.ellipse(0, footY, footW * 0.55, footW * 0.28)
        .stroke({ width: 2.5, color: 0xd500f9 });
    }
    this.hpBarOn(g, -footW * 0.3, -span * 0.55, footW * 0.6, e.hp,
                 BUILDING_MAX_HP[e.type] ?? 100);
  }

  // ----------------------------------------------------------------- terrain

  /** Diamond terrain + patchwork + grid + scrap; redrawn only when it changes.
   * With fog active, the decorative dead land outside the map is NOT drawn:
   * beyond the edge there is only the same darkness as unexplored ground. */
  private renderTerrain(state: GameState, fogged: boolean): void {
    const key = `${state.size}:${fogged}:${state.tiles.flat().join("")}:${Object.keys(state.scrap).join(",")}`;
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    const g = this.terrain;
    g.clear();
    const size = state.size;

    // Seamless world (god view only): the ground outside the playable area is
    // drawn with the same palette and haze as the inside, so no edge or
    // diamond silhouette is visible. (Sparse ruins hint at dead land.)
    const M = Math.ceil(size / 2) + 2;
    if (!fogged) {
      for (let ty = -M; ty < size + M; ty++) {
        for (let tx = -M; tx < size + M; tx++) {
          if (tx >= 0 && tx < size && ty >= 0 && ty < size) continue;
          const c = this.px(tx, ty);
          if (c.x < -TILE_W || c.x > this.worldW + TILE_W) continue;
          if (c.y < -TILE_H || c.y > this.worldH + TILE_H * 2) continue;
          const depth = Math.min(1, Math.max(0, (tx + ty) / (2 * (size - 1))));
          const f = 0.82 + depth * 0.34;
          const n = ((tx * 37 + ty * 71) % 97 + 97) % 97;
          const raw = PLAIN_SHADES[((tx * 7 + ty * 13 + ((tx * tx + ty) >> 1)) % PLAIN_SHADES.length
                                   + PLAIN_SHADES.length) % PLAIN_SHADES.length];
          this.diamond(g, c.x, c.y).fill(shade(raw, f));
          if (n === 13) { // collapsed slab out in the dead land
            g.rect(c.x - 7, c.y - 3, 13, 5).fill(shade(0x2c333e, f));
            g.rect(c.x - 3, c.y - 6, 6, 3).fill(shade(0x1c222d, f));
          } else if (n % 13 === 4) {
            g.rect(c.x - 2, c.y - 1, 3, 2).fill(shade(0x232b38, f));
          }
        }
      }
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const terrain = state.tiles[y][x];
        const c = this.px(x, y);
        // Atmospheric depth: the far rows sit in haze, the near rows catch
        // light - same trick AoE2 uses via art, here via brightness falloff.
        const depth = (x + y) / (2 * (size - 1));
        const f = 0.82 + depth * 0.34; // far 0.82 -> near 1.16
        const raw = terrain === "plain"
          ? PLAIN_SHADES[(x * 7 + y * 13 + ((x * x + y) >> 1)) % PLAIN_SHADES.length]
          : TERRAIN_BASE[terrain] ?? PLAIN_SHADES[0];
        const base = shade(raw, f);
        this.diamond(g, c.x, c.y).fill(base);
        const n = (x * 31 + y * 17) % 11;
        if (terrain === "plain") {
          if (n === 0) g.rect(c.x - 3, c.y + 2, 4, 2).fill(0x1f2937);
          if (n === 5) g.rect(c.x + 6, c.y - 3, 3, 2).fill(0x121826);
        } else if (terrain === "blocked") {
          g.rect(c.x - 12, c.y - 5, 12, 6).fill(0x4d5766);
          g.rect(c.x - 2, c.y - 1, 11, 6).fill(0x2c333e);
          g.rect(c.x - 6, c.y + 2, 6, 4).fill(0x59636f);
        } else if (terrain === "vein") {
          g.rect(c.x - 10, c.y - 4, 6, 4).fill(0xc9a227);
          g.rect(c.x + 3, c.y + 1, 5, 4).fill(0xe6c352);
          g.rect(c.x - 3, c.y + 4, 4, 3).fill(0x9a7b1c);
          g.rect(c.x + 6, c.y - 5, 2, 2).fill(0xfff3c0);
        } else if (terrain === "pod") {
          // A cluster of capsules half-buried in the ground, each with a
          // faint green life-light: the humans the machines farm for energy.
          for (const [dx, dy, w, h] of [[-11, -3, 7, 9], [-2, -6, 7, 10], [6, -2, 6, 8]] as const) {
            g.roundRect(c.x + dx, c.y + dy, w, h, 3).fill(0x2b4d44)
              .stroke({ width: 1, color: 0x0f1a17, alpha: 0.9 });
            g.rect(c.x + dx + 2, c.y + dy + 2, w - 4, h - 5).fill({ color: 0x3ddc97, alpha: 0.55 });
            g.rect(c.x + dx + 3, c.y + dy + 3, 1, 2).fill({ color: 0xd9ffe9, alpha: 0.9 });
          }
          g.ellipse(c.x, c.y + 6, 12, 3).fill({ color: 0x3ddc97, alpha: 0.12 });
        } else if (terrain === "rubble") {
          g.rect(c.x - 8, c.y - 2, 8, 4).fill(0x574634);
          g.rect(c.x + 2, c.y + 2, 6, 3).fill(0x6b5540);
          g.rect(c.x - 2, c.y - 5, 4, 3).fill(0x46392c);
        }
      }
    }
    // The diagonal lattice (the AoE2 grid), running seamlessly across the
    // whole visible world - it never stops at the playable edge, so no edge
    // can be seen.
    const corner = (a: number, b: number) => ({
      x: (a - b) * (TILE_W / 2) + this.worldW / 2,
      y: (a + b) * (TILE_H / 2),
    });
    const L = fogged ? 0 : -M;          // fogged: the grid stops at the edge
    const R = fogged ? size : size + M;
    for (let i = L; i <= R; i++) {
      const a1 = corner(i, L), a2 = corner(i, R);
      g.moveTo(a1.x, a1.y).lineTo(a2.x, a2.y)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.05 });
      const b1 = corner(L, i), b2 = corner(R, i);
      g.moveTo(b1.x, b1.y).lineTo(b2.x, b2.y)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.05 });
    }
    for (const key2 of Object.keys(state.scrap)) {
      const [x, y] = key2.split(",").map(Number);
      const c = this.px(x, y);
      g.ellipse(c.x, c.y + 2, 8, 4).fill(0x8d99ae);
      g.ellipse(c.x, c.y + 2, 3, 1.6).fill(0x39414e);
      g.rect(c.x + 5, c.y - 4, 4, 3).fill(0xaab4c4);
    }
  }

  private hpBarOn(g: Graphics, x: number, y: number, w: number,
                  hp: number, max: number): void {
    const pct = Math.max(Math.min(hp / max, 1), 0);
    if (pct >= 1) return;
    g.rect(x, y, w, 2.5).fill(0x263238);
    g.rect(x, y, w * pct, 2.5)
      .fill(pct > 0.5 ? 0x66bb6a : pct > 0.25 ? 0xffa726 : 0xef5350);
  }
}
