// Landing hero: a perpetual mock battle rendered as chunky pixels covering the
// screen - workers mining, waves marching, turrets firing, racks cascading.
// Pure client-side simulation (no backend), drawn 100% from the shipped sprite
// pack (units AND buildings) so it looks exactly like a real match.

import { useEffect, useRef } from "react";
import { domPack, drawBuilding, drawUnit, loadDomPack } from "../game/dompack";

void loadDomPack(); // warm the atlases; frames before load simply skip sprites

const TILE = 16;
const COLS = 62;
const ROWS = 34;
const W = COLS * TILE;
const H = ROWS * TILE;

interface Unit {
  side: number; type: string; x: number; y: number; hp: number; max: number;
  range: number; dps: number; speed: number; cool: number; lane: number;
  wob: number; air: boolean; dir: number;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }
interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; c: string }
interface Building { side: number; type: string; tx: number; ty: number; tiles: number; hp: number; max: number }

const SPECS: Record<string, { hp: number; range: number; dps: number; speed: number; air?: boolean }> = {
  worker: { hp: 20, range: 1, dps: 2, speed: 26 },
  striker: { hp: 30, range: 1, dps: 9, speed: 30 },
  launcher: { hp: 25, range: 3, dps: 8, speed: 28 },
  drone_swarm: { hp: 35, range: 2, dps: 6, speed: 40 },
  rider: { hp: 55, range: 1, dps: 12, speed: 46 },
  wasp: { hp: 20, range: 1, dps: 7, speed: 55, air: true },
  anvil: { hp: 60, range: 1, dps: 10, speed: 20 },
  walking_tower: { hp: 80, range: 4, dps: 18, speed: 14 },
  colossus: { hp: 150, range: 1, dps: 20, speed: 24 },
};

const WAVES: string[][] = [
  ["striker", "striker", "striker"],
  ["launcher", "launcher", "striker"],
  ["rider", "rider"],
  ["drone_swarm", "drone_swarm", "striker", "striker"],
  ["wasp", "wasp"],
  ["anvil", "striker", "launcher"],
  ["walking_tower", "striker", "striker"],
  ["colossus"],
];

const TEAM = [0, 1];
const P_COLORS = ["#4fc3f7", "#ef5350"];

function terrainCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const base = ["#232b34", "#26303a", "#202832", "#252d38"];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      g.fillStyle = base[(x * 31 + y * 17) % 11 % base.length];
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      const n = (x * 73 + y * 151) % 97;
      if (n < 9) {
        g.fillStyle = "#31404c";
        g.fillRect(x * TILE + (n % 8), y * TILE + (n % 5), 4, 2);
      }
      if (n > 90) {
        g.fillStyle = "#171d24";
        g.fillRect(x * TILE + 4, y * TILE + 8, 5, 3);
      }
      if (n === 42 || n === 77) {  // ember cracks in the crust
        g.fillStyle = "#4a2418";
        g.fillRect(x * TILE + 2, y * TILE + 10, 9, 2);
        g.fillStyle = "#ff5c33";
        g.fillRect(x * TILE + 5, y * TILE + 10, 3, 1);
      }
    }
  }
  // Ruined city silhouettes: broken slabs scattered mid-field.
  const slabs = [[26, 4], [31, 7], [28, 25], [34, 28], [24, 15], [36, 13], [30, 18]];
  for (const [sx, sy] of slabs) {
    g.fillStyle = "#10151b";
    g.fillRect(sx * TILE - 4, sy * TILE - 10, 22, 26);
    g.fillStyle = "#2c3743";
    g.fillRect(sx * TILE - 2, sy * TILE - 8, 18, 22);
    g.fillStyle = "#12181f";
    for (let wy = 0; wy < 3; wy++) {
      for (let wx = 0; wx < 3; wx++) {
        g.fillRect(sx * TILE + wx * 6, sy * TILE - 4 + wy * 7, 3, 4);
      }
    }
    g.fillStyle = "#ffb020";  // one lit window still burning
    g.fillRect(sx * TILE + 6, sy * TILE - 4 + 7, 3, 4);
  }
  // Metal veins with gold sparkle.
  for (const [vx, vy] of [[12, 7], [12, 27], [49, 7], [49, 27], [30, 11], [31, 22]]) {
    g.fillStyle = "#2b2417";
    g.fillRect(vx * TILE, vy * TILE, TILE, TILE);
    g.fillStyle = "#ffd54f";
    g.fillRect(vx * TILE + 3, vy * TILE + 4, 3, 2);
    g.fillRect(vx * TILE + 9, vy * TILE + 9, 3, 2);
    g.fillRect(vx * TILE + 6, vy * TILE + 12, 2, 2);
  }
  return c;
}

function makeBuildings(): Building[] {
  const list: Building[] = [];
  const layout = (side: number, bx: number) => {
    const m = side === 0 ? 1 : -1;
    list.push({ side, type: "core", tx: bx, ty: 15, tiles: 2, hp: 450, max: 450 });
    list.push({ side, type: "assembler", tx: bx + m * 1 - (side ? 1 : 0), ty: 20, tiles: 2, hp: 100, max: 100 });
    list.push({ side, type: "cocoon", tx: bx + m * 3, ty: 12, tiles: 1, hp: 30, max: 30 });
    list.push({ side, type: "cocoon", tx: bx - m * 2, ty: 12, tiles: 1, hp: 30, max: 30 });
    list.push({ side, type: "rack", tx: bx + m * 4, ty: 17, tiles: 1, hp: 40, max: 40 });
    list.push({ side, type: "rack", tx: bx + m * 4, ty: 19, tiles: 1, hp: 40, max: 40 });
    list.push({ side, type: "turret", tx: bx + m * 6, ty: 14, tiles: 1, hp: 90, max: 90 });
    list.push({ side, type: "turret", tx: bx + m * 6, ty: 21, tiles: 1, hp: 90, max: 90 });
  };
  layout(0, 8);
  layout(1, 52);
  list.push({ side: -1, type: "camp", tx: 30, ty: 6, tiles: 1, hp: 60, max: 60 });
  return list;
}

export default function HeroBattle() {
  const hostRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = hostRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    const terrain = terrainCanvas();
    const buildings = makeBuildings();
    const units: Unit[] = [];
    const particles: Particle[] = [];
    const beams: Beam[] = [];
    const scrap: { x: number; y: number }[] = [];
    const spawnAt = [1.5, 4.0];
    const waveIx = [0, 3];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    const spawn = (side: number, type: string) => {
      const s = SPECS[type];
      const lane = [9, 17, 26][Math.floor(rnd() * 3)];
      units.push({
        side, type, hp: s.hp, max: s.hp, range: s.range, dps: s.dps,
        speed: s.speed, cool: rnd(), air: !!s.air, wob: rnd() * 6.28,
        x: (side === 0 ? 11 : 50) * TILE, dir: side === 0 ? 1 : -1,
        y: lane * TILE + (rnd() - 0.5) * 40, lane,
      });
    };
    // Workers exist from the start; a modest standing army too.
    for (const side of TEAM) {
      for (let i = 0; i < 3; i++) spawn(side, "worker");
      spawn(side, "striker");
      spawn(side, "launcher");
    }

    const boom = (x: number, y: number, color: string, n: number, big = false) => {
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.28;
        const v = 20 + rnd() * (big ? 90 : 50);
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          life: 0.4 + rnd() * (big ? 0.7 : 0.4), c: rnd() < 0.4 ? "#ffd54f" : color,
          s: big ? 3 : 2 });
      }
    };

    const enemyCore = (side: number) => buildings.find((b) => b.side === 1 - side && b.type === "core")!;

    const tick = (dt: number, t: number) => {
      // Waves march out of each assembler on a timer.
      for (const side of TEAM) {
        spawnAt[side] -= dt;
        if (spawnAt[side] <= 0) {
          const wave = WAVES[waveIx[side] % WAVES.length];
          waveIx[side] += 1;
          for (const type of wave) spawn(side, type);
          spawnAt[side] = 4 + rnd() * 3;
          const a = buildings.find((b) => b.side === side && b.type === "assembler")!;
          boom((a.tx + 1) * TILE, a.ty * TILE, "#90a4ae", 4);
        }
      }

      for (const u of units) {
        u.cool -= dt;
        u.wob += dt * 6;
        if (u.type === "worker") {
          // Shuttle between the nearest vein column and home; just pace and sparkle.
          const home = u.side === 0 ? 10.5 * TILE : 50.5 * TILE;
          const out = u.side === 0 ? 12.2 * TILE : 48.8 * TILE;
          const ph = (t * 0.25 + u.wob) % 2;
          u.x = ph < 1 ? home + (out - home) * ph : out + (home - out) * (ph - 1);
          u.y = (u.lane < 17 ? 8 : 26.5) * TILE + Math.sin(u.wob * 0.4) * 8;
          if (u.cool <= 0 && rnd() < 0.3) {
            particles.push({ x: u.x + 8, y: u.y + 6, vx: 0, vy: -14,
              life: 0.5, c: "#ffd54f", s: 1 });
            u.cool = 0.6;
          }
          continue;
        }
        // Find a target: nearest enemy unit within aggro, else the enemy core.
        let target: Unit | null = null;
        let best = 8 * TILE;
        for (const v of units) {
          if (v.side === u.side || v.type === "worker") continue;
          if (v.air && !(u.type === "launcher" || u.air || u.type === "drone_swarm")) continue;
          const d = Math.hypot(v.x - u.x, v.y - u.y);
          if (d < best) { best = d; target = v; }
        }
        const core = enemyCore(u.side);
        const goalX = target ? target.x : (core.tx + 1) * TILE;
        const goalY = target ? target.y : (core.ty + 1) * TILE;
        const dist = Math.hypot(goalX - u.x, goalY - u.y);
        const reach = u.range * TILE + 6;
        if (dist > reach) {
          u.x += ((goalX - u.x) / dist) * u.speed * dt;
          u.y += ((goalY - u.y) / dist) * u.speed * dt + (u.air ? Math.sin(u.wob) * 0.5 : 0);
        } else if (u.cool <= 0) {
          u.cool = 0.55;
          if (u.range > 1) {
            beams.push({ x1: u.x + 8, y1: u.y + 4, x2: goalX + 8, y2: goalY + 6,
              life: 0.12, c: u.type === "drone_swarm" ? "#b3e5fc" : "#ffd54f" });
          }
          if (target) {
            target.hp -= u.dps * 0.55;
            boom(target.x + 8, target.y + 6, P_COLORS[target.side], 2);
          } else {
            core.hp = Math.max(core.hp - u.dps * 0.4, 130);
            boom(goalX + rnd() * 12, goalY + rnd() * 12, "#ff8a65", 2);
          }
        }
      }

      // Turrets defend their base.
      for (const b of buildings) {
        if (b.type !== "turret" || b.side < 0) continue;
        const bx = b.tx * TILE + 8;
        const by = b.ty * TILE + 8;
        for (const u of units) {
          if (u.side === b.side || u.type === "worker") continue;
          const d = Math.hypot(u.x - bx, u.y - by);
          if (d < 4.5 * TILE && Math.floor(t * 2) % 2 === 0) {
            u.hp -= 9 * dt * 2;
            if (rnd() < 0.3) {
              beams.push({ x1: bx, y1: by - 4, x2: u.x + 8, y2: u.y + 6,
                life: 0.1, c: "#ff8a65" });
            }
            break;
          }
        }
      }

      // Deaths -> explosion + scrap. Cores slowly self-repair (the war never ends).
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        if (u.hp <= 0) {
          boom(u.x + 8, u.y + 8, P_COLORS[u.side], u.type === "colossus" ? 26 : 12,
               u.type === "colossus" || u.type === "walking_tower");
          if (!u.air && scrap.length < 46) scrap.push({ x: u.x, y: u.y });
          units.splice(i, 1);
        }
      }
      for (const b of buildings) {
        if (b.type === "core") b.hp = Math.min(b.hp + 4 * dt, b.max);
      }
      if (units.length > 90) units.splice(0, units.length - 90);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 40 * dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = beams.length - 1; i >= 0; i--) {
        beams[i].life -= dt;
        if (beams[i].life <= 0) beams.splice(i, 1);
      }
    };

    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Slow cinematic drift.
      const zoom = 1.12 + Math.sin(t * 0.05) * 0.05;
      const panX = Math.sin(t * 0.031) * 26;
      const panY = Math.cos(t * 0.023) * 14;
      ctx.setTransform(zoom, 0, 0, zoom,
        W / 2 - zoom * (W / 2 + panX), H / 2 - zoom * (H / 2 + panY));

      ctx.drawImage(terrain, 0, 0);
      for (const s of scrap) {
        ctx.fillStyle = "#3e2723";
        ctx.fillRect(s.x + 4, s.y + 8, 8, 5);
        ctx.fillStyle = "#8d6e63";
        ctx.fillRect(s.x + 6, s.y + 9, 4, 2);
      }
      const p = domPack();
      const bframe = Math.floor(t * 1.4) % 2;
      for (const b of buildings) {
        const tint = b.side === 0 ? "swarm" : b.side === 1 ? "forge" : "neutral";
        const bs = b.tiles * TILE + 8;
        drawBuilding(ctx, b.type, tint, bframe,
                     b.tx * TILE - 4, b.ty * TILE - (bs - b.tiles * TILE), bs, bs);
        if (b.type === "core" && b.hp < b.max * 0.85) {
          ctx.fillStyle = "rgba(255,120,60,0.35)";
          ctx.fillRect(b.tx * TILE + 6, b.ty * TILE + 20, 6, 4);
        }
      }
      const sorted = [...units].sort((a, b) => (Number(a.air) - Number(b.air)) || a.y - b.y);
      for (const u of sorted) {
        const bobY = u.air ? Math.sin(u.wob) * 3 - 6 : 0;
        if (u.air) {
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(u.x + 5, u.y + 13, 7, 2);
        }
        // Shipped pack: 32px frames, idle animation, side-facers mirrored.
        const big = u.type === "walking_tower" || u.type === "colossus";
        const S = big ? 30 : 26;
        const frame = Math.abs(Math.floor(t * 3 + u.wob));
        const dx = u.x - (S - 16) / 2;
        const dy = u.y + bobY + 16 - S + (u.air ? -2 : 2);
        const tint = u.side === 0 ? "swarm" : "forge";
        drawUnit(ctx, u.type, tint, frame, dx, dy, S, S,
                 (p?.mirror.has(u.type) ?? false) && u.dir < 0);
        if (u.hp < u.max) {
          ctx.fillStyle = "#000";
          ctx.fillRect(u.x, u.y - 10 + bobY, 16, 2);
          ctx.fillStyle = u.hp / u.max > 0.5 ? "#66bb6a" : "#ef5350";
          ctx.fillRect(u.x, u.y - 10 + bobY, Math.max(1, (u.hp / u.max) * 16), 2);
        }
      }
      for (const beam of beams) {
        ctx.strokeStyle = beam.c;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(beam.x1, beam.y1);
        ctx.lineTo(beam.x2, beam.y2);
        ctx.stroke();
      }
      for (const p of particles) {
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
    };

    let raf = 0;
    let last = performance.now();
    let simT = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Pre-run so the first visible frame is already mid-war.
    for (let i = 0; i < 400; i++) { tick(1 / 20, simT); simT += 1 / 20; }

    if (reduced) {
      draw(simT);
      return;
    }
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!document.hidden) {
        simT += dt;
        tick(dt, simT);
        draw(simT);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={hostRef} className="hero-canvas" aria-hidden="true" />;
}
