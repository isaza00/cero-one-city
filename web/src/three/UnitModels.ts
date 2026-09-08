import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PLAYER_COLORS } from "../game/meta";

export interface UnitModel {
  model: THREE.Group;
  update(delta: number, speed: number, moving: boolean, attack: number, working: boolean): void;
  dispose(): void;
  weaponMuzzle?: THREE.Object3D;
}

export interface UnitMaterials { teamColors?: readonly THREE.ColorRepresentation[]; }
type Triple = [number, number, number];
type Surface = "metal" | "team" | "eyes";
const DESIGNS = {
  worker: ["biped", 0.85, 0.34, 0.38, 0.27], striker: ["biped", 1.02, 0.43, 0.46, 0.23],
  launcher: ["biped", 0.95, 0.38, 0.44, 0.29], rider: ["cycle", 0.45, 0, 0, 0.2],
  wasp: ["air", 0.35, 0, 0, 0.42], walking_tower: ["walker", 1.65, 0.72, 0.79, 0.48],
  drone_swarm: ["swarm", 0.45, 0, 0, 0.5], colossus: ["walker", 0.87, 0.33, 0.40, 0.55],
  spark: ["tripod", 0.66, 0.24, 0.29, 0.28], anvil: ["biped", 0.76, 0.28, 0.35, 0.38],
  watcher: ["air", 0.45, 0, 0, 0.44], leech: ["crawler", 0.38, 0.15, 0.17, 0.29],
  prism: ["tripod", 0.67, 0.24, 0.30, 0.35],
} as const;
const TITANIUM = 0x9ba6a7, GRAPHITE = 0x252e33, ARMOR = 0x4e5d60, BRASS = 0x978468;
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;

export class UnitModels {
  private templates = new Map<string, THREE.Group>();
  private geometry = new Set<THREE.BufferGeometry>();
  private active = new Set<UnitModel>();
  private serial = 0;
  private disposed = false;
  private metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.64 });
  private eyes = new THREE.MeshStandardMaterial({ color: 0xe52f22, emissive: 0xff1808, emissiveIntensity: 2.4, roughness: 0.5 });
  private teams: THREE.MeshStandardMaterial[];
  private neutral = new THREE.MeshStandardMaterial({ color: 0x99958a, roughness: 0.78, metalness: 0.25 });
  private shapes: Record<string, THREE.BufferGeometry>;

  constructor(materials: UnitMaterials = {}) {
    this.teams = (materials.teamColors?.length ? materials.teamColors : PLAYER_COLORS).map(color =>
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.23, roughness: 0.76, metalness: 0.28 }));
    const outline = new THREE.Shape();
    outline.moveTo(-0.36, -0.5); outline.lineTo(0.36, -0.5); outline.lineTo(0.5, -0.36);
    outline.lineTo(0.5, 0.36); outline.lineTo(0.36, 0.5); outline.lineTo(-0.36, 0.5);
    outline.lineTo(-0.5, 0.36); outline.lineTo(-0.5, -0.36); outline.closePath();
    this.shapes = {
      plate: new THREE.ExtrudeGeometry(outline, { depth: 0.9, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.05, bevelSegments: 2, steps: 1 }).center(),
      tube: new THREE.CylinderGeometry(1, 1, 1, 16), ball: new THREE.SphereGeometry(1, 16, 10),
      ring: new THREE.TorusGeometry(1, 0.15, 8, 24), cone: new THREE.ConeGeometry(1, 1, 16),
      crystal: new THREE.OctahedronGeometry(1),
    };
    for (const shape of Object.values(this.shapes)) {
      shape.deleteAttribute("uv"); shape.clearGroups(); this.geometry.add(shape);
    }
  }

  private build(type: keyof typeof DESIGNS): THREE.Group {
    const [layout, hipHeight, upperLength, lowerLength, width] = DESIGNS[type];
    const heavy = ["anvil", "colossus", "walking_tower"].includes(type);
    const root = new THREE.Group();
    const batches = new Map<THREE.Group, Map<Surface, THREE.BufferGeometry[]>>();
    const joint = (parent: THREE.Group, name: string, position: Triple, motion = "", phase = 0) => {
      const group = new THREE.Group(); group.name = name; group.position.set(...position);
      group.userData = { motion, phase }; parent.add(group); return group;
    };
    const part = (parent: THREE.Group, shape: string, position: Triple, scale: Triple,
      color = TITANIUM, surface: Surface = "metal", rotation: Triple = [0, 0, 0]) => {
      const source = this.shapes[shape];
      const buffer = source.index ? source.toNonIndexed() : source.clone();
      buffer.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)));
      const tint = new THREE.Color(color), colors = new Float32Array(buffer.getAttribute("position").count * 3);
      for (let vertex = 0; vertex < colors.length; vertex += 3) tint.toArray(colors, vertex);
      buffer.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      if (!batches.has(parent)) batches.set(parent, new Map());
      const surfaces = batches.get(parent)!;
      if (!surfaces.has(surface)) surfaces.set(surface, []);
      surfaces.get(surface)!.push(buffer);
    };
    const rod = (parent: THREE.Group, start: Triple, end: Triple, radius = 0.024, color = TITANIUM) => {
      const first = new THREE.Vector3(...start), second = new THREE.Vector3(...end), direction = second.clone().sub(first);
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
      part(parent, "tube", first.add(second).multiplyScalar(0.5).toArray() as Triple,
        [radius, direction.length(), radius], color, "metal", [rotation.x, rotation.y, rotation.z]);
    };
    const chassis = joint(root, "chassis", [0, hipHeight, 0], layout === "air" || layout === "swarm" ? "hover" : "chassis");
    const badge = joint(chassis, "faction-mark", [0, 0.25, 0.16]);
    for (let stripe = 0; stripe < 4; stripe++) part(badge, "plate", [(stripe - 1.5) * 0.037, 0, 0], [0.019, 0.07, 0.012], 0xffffff, "team");
    const leg = (horizontal: number, depth: number, phase: number) => {
      const thickness = heavy ? 0.065 : layout === "crawler" ? 0.022 : 0.037;
      const hip = joint(chassis, `hip-${phase}`, [horizontal, 0, depth], "hip", phase);
      hip.rotation.z = Math.sign(horizontal) * (layout === "biped" ? 0.04 : 0.32);
      const knee = joint(hip, `knee-${phase}`, [0, -upperLength, 0], "knee", phase);
      const ankle = joint(knee, `ankle-${phase}`, [0, -lowerLength, 0], "ankle", phase);
      ankle.rotation.z = -hip.rotation.z;
      for (const [segment, length] of [[hip, upperLength], [knee, lowerLength]] as const) {
        part(segment, "tube", [0, 0, 0], [thickness * 1.9, thickness * 3.5, thickness * 1.9], GRAPHITE, "metal", [0, 0, Math.PI / 2]);
        for (const side of [-1, 1]) {
          rod(segment, [side * thickness, -0.04, 0], [side * thickness, -length * 0.73, -0.025], thickness * 0.62, ARMOR);
          rod(segment, [side * thickness, -length * 0.48, -0.025], [side * thickness, -length, 0], thickness * 0.38);
        }
        part(segment, "plate", [0, -length * 0.4, 0.032], [thickness * 2.5, length * 0.34, thickness], ARMOR);
        part(segment, "tube", [thickness * 1.85, 0, 0], [thickness * 0.6, 0.012, thickness * 0.6], BRASS, "metal", [0, 0, Math.PI / 2]);
      }
      part(ankle, "ball", [0, 0, 0], [thickness, thickness, thickness], GRAPHITE);
      part(ankle, "plate", [0, -0.035, 0.045], [thickness * 4.2, 0.065, heavy ? 0.29 : 0.19], ARMOR);
      for (const side of [-1, 1]) rod(ankle, [side * thickness, 0, 0], [side * thickness, -0.038, 0.12], thickness * 0.35);
    };
    const head = (skull: boolean, position: Triple) => {
      const sensor = joint(chassis, "sensor-head", position, "head");
      rod(chassis, [position[0], position[1] - 0.28, position[2] - 0.025], [position[0], position[1] - 0.085, position[2] - 0.025], 0.027, TITANIUM);
      if (skull) {
        part(sensor, "ball", [0, 0.055, -0.018], [0.083, 0.087, 0.075], ARMOR);
        part(sensor, "plate", [0, 0.107, 0.025], [0.047, 0.075, 0.045], TITANIUM);
        for (const side of [-1, 1]) {
          part(sensor, "plate", [side * 0.052, 0.064, 0.09], [0.088, 0.029, 0.035], TITANIUM, "metal", [0, 0, side * 0.16]);
          part(sensor, "plate", [side * 0.088, 0.04, 0.005], [0.023, 0.082, 0.078], ARMOR, "metal", [0.2, 0, 0]);
          part(sensor, "tube", [side * 0.078, -0.025, 0.026], [0.025, 0.025, 0.025], BRASS, "metal", [0, 0, Math.PI / 2]);
        }
      } else part(sensor, "plate", [0, 0.065, 0], [0.27, 0.15, 0.14], ARMOR);
      part(sensor, "plate", [0, 0.015, 0.078], [0.18, 0.066, 0.036], GRAPHITE);
      for (const side of [-1, 1]) {
        part(sensor, "ring", [side * 0.055, 0.03, 0.099], [0.029, 0.025, 0.024], TITANIUM);
        part(sensor, "ball", [side * 0.055, 0.03, 0.104], [0.018, 0.013, 0.009], 0xffffff, skull ? "eyes" : "team");
        if (skull) rod(sensor, [side * 0.087, 0.005, 0.067], [side * 0.047, -0.066, 0.08], 0.018);
      }
      if (skull) {
        part(sensor, "plate", [0, -0.07, 0.063], [0.12, 0.024, 0.065], TITANIUM);
        for (let vent = 0; vent < 4; vent++) part(sensor, "plate", [(vent - 1.5) * 0.025, -0.044, 0.085], [0.013, 0.017, 0.017], ARMOR);
      }
      rod(sensor, [0, -0.10, -0.025], [0, -0.02, -0.025], 0.036);
    };
    const weapon = (position: Triple, style = "rifle") => {
      const gun = joint(chassis, "weapon", position, "gun");
      const length = style === "siege" ? 1.1 : style === "rifle" ? 0.60 : 0.40;
      part(gun, "plate", [0, 0, 0], [0.17, 0.16, 0.36], GRAPHITE);
      rod(gun, [0, 0.025, 0.10], [0, 0.025, length], style === "siege" ? 0.075 : 0.035);
      for (let collar = 0; collar < 4; collar++) part(gun, "ring", [0, 0.025, 0.2 + collar * (length - 0.2) / 4], [0.07, 0.07, 0.1], ARMOR);
      part(gun, "ring", [0, 0.025, length], [0.042, 0.042, 0.08], 0xffffff, "team");
      part(gun, "tube", [0, 0.025, length - 0.005], [0.03, 0.012, 0.03], GRAPHITE, "metal", [Math.PI / 2, 0, 0]);
      part(gun, "plate", [0.09, 0.01, -0.015], [0.012, 0.07, 0.17], 0xffffff, "team");
      part(gun, "plate", [0, -0.13, -0.10], [0.055, 0.18, 0.06], ARMOR, "metal", [-0.23, 0, 0]);
      part(gun, "plate", [-0.025, -0.07, 0.17], [0.05, 0.1, 0.07], GRAPHITE);
      part(gun, "plate", [0, 0.01, -0.25], [0.12, 0.1, 0.18], ARMOR);
      part(gun, "plate", [0, 0.115, -0.06], [0.035, 0.04, 0.17], TITANIUM);
      joint(gun, "weapon-muzzle", [0, 0.025, length + 0.01]);
      joint(gun, "grip-left", [-0.055, -0.09, 0.17]); joint(gun, "grip-right", [0.04, -0.09, -0.12]);
      return gun;
    };
    const arm = (side: number, tool: boolean) => {
      const shoulder = joint(chassis, `shoulder-${side}`, [side * (width + 0.075), 0.49, 0], "shoulder", side);
      const elbow = joint(shoulder, `elbow-${side}`, [0, -0.38, 0], "elbow", side);
      shoulder.userData.ik = type === "striker";
      for (const segment of [shoulder, elbow]) {
        part(segment, "ball", [0, 0, 0], [0.067, 0.067, 0.067], GRAPHITE);
        rod(segment, [-0.032, -0.025, 0], [-0.032, -0.34, 0], 0.023);
        rod(segment, [0.035, -0.03, -0.018], [0.035, -0.24, -0.018], 0.031, ARMOR);
        rod(segment, [0.035, -0.18, -0.018], [0.035, -0.37, -0.018], 0.015);
      }
      part(shoulder, "plate", [side * 0.025, -0.045, -0.01], [0.15, 0.09, 0.15], ARMOR);
      const wrist = joint(elbow, `wrist-${side}`, [0, -0.39, 0], tool && side > 0 ? "drill" : "");
      part(wrist, "plate", [0, 0, 0], [0.078, 0.075, 0.08], GRAPHITE);
      if (tool && side > 0) {
        part(wrist, "cone", [0, -0.15, 0], [0.07, 0.24, 0.07], TITANIUM, "metal", [Math.PI, 0, 0]);
        for (let flute = 0; flute < 4; flute++) part(wrist, "ring", [0, -0.07 - flute * 0.04, 0], [0.065 - flute * 0.013, 0.065 - flute * 0.013, 0.05], BRASS, "metal", [Math.PI / 2, 0.15, 0]);
      } else for (const finger of [-1, 1]) {
        const claw = tool ? joint(wrist, `claw-${finger}`, [finger * 0.05, 0, 0], "claw", finger) : wrist;
        rod(claw, [finger * 0.04, 0, 0.02], [finger * 0.04, -0.085, 0.04], 0.013);
        rod(claw, [finger * 0.04, -0.085, 0.04], [finger * 0.012, -0.085, 0.055], 0.013);
      }
      if (type === "anvil" && side < 0) part(elbow, "plate", [0, -0.16, 0.13], [0.46, 0.78, 0.15], ARMOR);
      if (type === "colossus") part(elbow, "plate", [0, -0.28, 0.10], [0.33, 0.37, 0.3], ARMOR);
    };
    const rotor = (parent: THREE.Group, position: Triple, radius: number, phase: number) => {
      part(parent, "ring", position, [radius, radius, radius * 0.9], ARMOR, "metal", [Math.PI / 2, 0, 0]);
      const fan = joint(parent, `rotor-${phase}`, position, "rotor", phase);
      part(fan, "tube", [0, 0, 0], [radius * 0.2, 0.045, radius * 0.2], TITANIUM);
      for (let blade = 0; blade < 3; blade++) part(fan, "plate", [0, 0, 0], [radius * 1.65, 0.014, radius * 0.17], GRAPHITE, "metal", [0, blade * Math.PI / 3, 0]);
    };
    if (!["air", "swarm", "cycle"].includes(layout)) {
      if (layout === "biped") for (const side of [-1, 1]) leg(side * width, 0, side < 0 ? 0 : Math.PI);
      else if (layout === "tripod") for (let index = 0; index < 3; index++) leg(Math.sin(index * Math.PI * 2 / 3) * width, Math.cos(index * Math.PI * 2 / 3) * width, index * Math.PI * 2 / 3);
      else for (let index = 0; index < (layout === "crawler" ? 6 : 4); index++) leg((index % 2 ? 1 : -1) * width, (Math.floor(index / 2) - (layout === "crawler" ? 1 : 0.5)) * 0.36, (index % 2 + Math.floor(index / 2)) % 2 * Math.PI + index * 0.01);
      rod(chassis, [-width, 0, 0], [width, 0, 0], heavy ? 0.065 : 0.035, GRAPHITE);
      const endoskeleton = layout === "biped" || type === "colossus";
      rod(chassis, [0, -0.02, -0.035], [0, endoskeleton ? 0.46 : 0.2, -0.035], 0.028);
      for (let vertebra = 0; vertebra < (endoskeleton ? 6 : 3); vertebra++) part(chassis, "tube", [0, vertebra * 0.085, -0.035], [0.055, 0.056, 0.055], vertebra % 2 ? TITANIUM : GRAPHITE);
      for (const side of [-1, 1]) for (let rib = 0; rib < (endoskeleton ? 4 : 1); rib++) {
        const level = 0.22 + rib * 0.078, reach = width * (0.66 + rib * 0.075);
        rod(chassis, [0, level, -0.035], [side * reach, level - 0.04, 0.02], 0.021);
        rod(chassis, [side * reach, level - 0.04, 0.02], [side * 0.065, level - 0.075, 0.115], 0.017);
      }
      for (const side of [-1, 1]) rod(chassis, [side * width, 0, 0], [side * 0.1, 0.23, -0.035], 0.03, ARMOR);
      part(chassis, "plate", [width * 0.74, endoskeleton ? 0.43 : 0.16, 0.088], [width * 0.55, 0.15, 0.05], 0xffffff, "team");
      if (!endoskeleton) {
        badge.position.set(0, 0.14, 0.19);
        for (const side of [-1, 1]) rod(chassis, [side * width, 0, 0], [side * 0.09, 0.45, 0.04], 0.026, ARMOR);
      }
      if (layout === "biped" || type === "colossus") {
        head(type === "striker" || type === "colossus", [0, 0.71, 0]); arm(-1, type === "worker"); arm(1, type === "worker");
      }
      if (type === "striker") weapon([0.08, 0.18, 0.30]);
      if (type === "worker") for (const side of [-1, 1]) {
        part(chassis, "tube", [side * 0.22, 0.27, -0.26], [0.09, 0.43, 0.09], ARMOR);
        for (let rail = 0; rail < 3; rail++) rod(chassis, [side * 0.30, rail * 0.22, -0.11], [side * 0.30, rail * 0.22, -0.41], 0.025, BRASS);
        rod(chassis, [side * 0.30, 0, -0.41], [side * 0.30, 0.49, -0.41], 0.026);
      }
      if (type === "launcher") {
        const rack = joint(chassis, "rocket-rack", [0.36, 0.63, -0.03], "gun");
        part(rack, "plate", [0, 0, 0], [0.43, 0.50, 0.54], ARMOR);
        for (let socket = 0; socket < 6; socket++) {
          const horizontal = (socket % 2 - 0.5) * 0.19, vertical = (Math.floor(socket / 2) - 1) * 0.15;
          part(rack, "tube", [horizontal, vertical, 0.29], [0.069, 0.06, 0.069], GRAPHITE, "metal", [Math.PI / 2, 0, 0]);
          part(rack, "ring", [horizontal, vertical, 0.33], [0.072, 0.072, 0.07], TITANIUM);
        }
        joint(rack, "weapon-muzzle", [-0.095, 0, 0.35]);
      }
      if (heavy) for (const side of [-1, 1]) part(chassis, "plate", [side * width * 0.52, 0.33, 0.13], [width * 0.87, type === "walking_tower" ? 0.26 : 0.42, 0.14], ARMOR, "metal", [0, side * 0.15, side * 0.09]);
      if (type === "walking_tower") { weapon([0, 0.49, 0.15], "siege"); head(false, [-0.32, 0.61, -0.17]); rod(chassis, [0.31, 0.4, -0.24], [0.31, 1.02, -0.24], 0.014); }
      if (type === "colossus") for (let cell = 0; cell < 5; cell++) part(chassis, "tube", [(cell - 2) * 0.18, 0.5, -0.22], [0.073, 0.45 + (2 - Math.abs(cell - 2)) * 0.09, 0.073], BRASS);
      if (type === "spark" || type === "prism") {
        const emitter = joint(chassis, "optical-emitter", [0, 0.55, 0.1], "gun");
        rod(emitter, [-0.15, -0.13, -0.075], [0.15, -0.13, -0.075], 0.027, ARMOR);
        rod(emitter, [0, -0.13, -0.075], [0, 0, 0], 0.022, ARMOR);
        part(emitter, type === "prism" ? "crystal" : "tube", [0, 0, 0.09], type === "prism" ? [0.095, 0.095, 0.22] : [0.055, 0.24, 0.055], TITANIUM);
        if (type === "prism") part(emitter, "ring", [0, 0, 0.23], [0.11, 0.11, 0.10], 0xffffff, "team");
        else for (let coil = 0; coil < 4; coil++) part(emitter, "ring", [0, coil * 0.055 - 0.08, 0.09], [0.085, 0.085, 0.065], BRASS, "metal", [Math.PI / 2, 0, 0]);
        for (const side of [-1, 1]) {
          rod(emitter, [side * 0.15, -0.16, -0.10], [side * 0.15, 0.17, 0.30], 0.026, BRASS);
          part(emitter, "ball", [side * 0.15, 0.17, 0.30], [0.032, 0.032, 0.032], 0xffffff, "team");
          if (type === "prism") for (let fin = 0; fin < 4; fin++) part(chassis, "plate", [side * (0.18 + fin * 0.055), 0.3, -0.05], [0.02, 0.37 - fin * 0.055, 0.29], TITANIUM, "metal", [0, 0, -side * 0.3]);
        }
        joint(emitter, "weapon-muzzle", [0, 0, 0.33]);
      }
      if (type === "leech") {
        part(chassis, "plate", [0, 0.16, -0.1], [0.48, 0.20, 0.83], ARMOR);
        let probe = chassis;
        for (let section = 0; section < 3; section++) {
          probe = joint(probe, `capture-probe-${section}`, [0, section ? 0.18 : 0.31, section ? 0.08 : 0.19], "probe", section);
          rod(probe, [0, 0, 0], [0, 0.18, 0.08], 0.033, BRASS);
          part(probe, "ring", [0, 0, 0], [0.06, 0.06, 0.06], GRAPHITE);
        }
        for (const side of [-1, 1]) rod(probe, [0, 0.18, 0.08], [side * 0.09, 0.18, 0.23], 0.017);
      }
    } else if (layout === "cycle") {
      part(chassis, "plate", [0, 0.12, 0], [0.26, 0.20, 1.1], ARMOR);
      for (const depth of [-0.54, 0.54]) {
        const wheel = joint(chassis, `wheel-${depth}`, [0, -0.10, depth], "wheel");
        part(wheel, "ring", [0, 0, 0], [0.29, 0.29, 0.55], GRAPHITE, "metal", [0, Math.PI / 2, 0]);
        for (let spoke = 0; spoke < 8; spoke++) rod(wheel, [0, 0, 0], [0, Math.cos(spoke * Math.PI / 4) * 0.27, Math.sin(spoke * Math.PI / 4) * 0.27], 0.018);
        for (const side of [-1, 1]) rod(chassis, [side * 0.12, 0.2, depth * 0.4], [side * 0.12, -0.1, depth], 0.027);
      }
      for (const side of [-1, 1]) rod(chassis, [0, 0, 0], [side * 0.35, -0.22, -0.15], 0.023);
      head(false, [0, 0.49, -0.25]); weapon([0, 0.28, 0.18], "pulse");
    } else if (layout === "swarm") {
      badge.position.set(0, 0.09, 0.2);
      for (let index = 0; index < 5; index++) {
        const pod = joint(chassis, `swarm-drone-${index}`, [(index % 3 - 1) * 0.48, index % 2 * 0.21, Math.floor(index / 3) * -0.63], "hover", index * 1.7);
        part(pod, "plate", [0, 0, 0], [0.22, 0.13, 0.35], ARMOR);
        part(pod, "ball", [0, 0, 0.19], [0.05, 0.035, 0.018], 0xffffff, "team");
        rotor(pod, [0, 0.07, -0.07], 0.18, index);
        if (!index) { joint(pod, "weapon-muzzle", [0, 0, 0.22]); pod.add(badge); badge.position.set(0, 0.035, 0.185); badge.scale.setScalar(0.65); }
      }
    } else {
      part(chassis, "plate", [0, 0, 0], [0.25, 0.18, type === "wasp" ? 0.83 : 0.35], ARMOR);
      if (type === "wasp") {
        for (const side of [-1, 1]) {
          rod(chassis, [0, 0, 0], [side * 0.46, 0, -0.09], 0.026);
          rotor(chassis, [side * 0.46, 0, -0.09], 0.25, side);
          part(chassis, "plate", [side * 0.18, 0.05, -0.38], [0.06, 0.25, 0.3], ARMOR, "metal", [0.3, 0, side * 0.5]);
        }
        head(false, [0, 0.15, 0.23]); weapon([0, -0.16, 0.25], "pulse");
      } else {
        badge.position.set(0, 0.44, 0.02);
        part(chassis, "ring", [0, 0, 0], [0.45, 0.45, 0.45], TITANIUM, "metal", [Math.PI / 2, 0, 0]);
        for (let index = 0; index < 3; index++) rotor(chassis, [Math.sin(index * Math.PI * 2 / 3) * 0.42, 0, Math.cos(index * Math.PI * 2 / 3) * 0.42], 0.14, index);
        const sensor = joint(chassis, "survey-gimbal", [0, -0.20, 0], "head");
        part(sensor, "ball", [0, 0, 0], [0.16, 0.13, 0.14], GRAPHITE);
        part(sensor, "ring", [0, -0.015, 0.13], [0.095, 0.095, 0.07], TITANIUM);
        part(sensor, "ball", [0, -0.015, 0.14], [0.068, 0.068, 0.014], 0xffffff, "team");
        rod(chassis, [0, 0, 0], [0, 0.55, 0], 0.014);
        part(chassis, "plate", [0, 0.44, 0], [0.31, 0.08, 0.03], ARMOR);
      }
    }
    for (const [parent, surfaces] of batches) for (const [surface, buffers] of surfaces) {
      const merged = mergeGeometries(buffers, false)!; buffers.forEach(buffer => buffer.dispose());
      merged.computeBoundingBox(); merged.computeBoundingSphere(); this.geometry.add(merged);
      const mesh = new THREE.Mesh(merged, surface === "metal" ? this.metal : surface === "eyes" ? this.eyes : this.neutral);
      mesh.name = `${parent.name}-${surface}`; mesh.userData.surface = surface;
      mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    }
    return root;
  }

  create(type: string, owner: number, height: number): UnitModel {
    if (this.disposed) throw new Error("UnitModels has been disposed");
    if (!Object.hasOwn(DESIGNS, type)) throw new Error(`Unsupported mechanical unit: ${type}`);
    if (!Number.isFinite(height) || height <= 0) throw new RangeError("Unit height must be finite and positive");
    if (!this.templates.has(type)) this.templates.set(type, this.build(type as keyof typeof DESIGNS));
    const rig = this.templates.get(type)!.clone(true), model = new THREE.Group(); model.add(rig);
    model.name = `unit-${type}`; model.userData = { unitType: type, articulation: true, owner };
    const nodes: { node: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Euler }[] = [];
    rig.traverse(node => {
      if (node instanceof THREE.Mesh && node.userData.surface === "team") node.material = this.teams[owner] ?? this.neutral;
      if (node.userData.motion) nodes.push({ node, position: node.position.clone(), rotation: node.rotation.clone() });
    });
    const badge = rig.getObjectByName("faction-mark")!; badge.scale.x = 0.55 + (Number.isInteger(owner) && owner >= 0 ? owner % 4 : 0) * 0.15;
    const arms = nodes.filter(({ node }) => node.userData.ik).map(({ node }) => ({
      shoulder: node, elbow: rig.getObjectByName(`elbow-${node.userData.phase}`)!, wrist: rig.getObjectByName(`wrist-${node.userData.phase}`)!,
      grip: rig.getObjectByName(node.userData.phase < 0 ? "grip-left" : "grip-right")!,
    }));
    const target = new THREE.Vector3(), direction = new THREE.Vector3(), bend = new THREE.Vector3(), elbowPoint = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0), rotation = new THREE.Quaternion();
    let time = this.serial++ * 2.399963, phase = time, stride = 0, activity = 0, travel = 0, drilling = 0, released = false;
    const unit: UnitModel = {
      model, weaponMuzzle: rig.getObjectByName("weapon-muzzle"),
      update: (delta, speed, moving, attack, working) => {
        if (released) return;
        const step = THREE.MathUtils.clamp(finite(delta), 0, 0.1), recoil = THREE.MathUtils.clamp(finite(attack), 0, 1);
        const pace = THREE.MathUtils.clamp(Math.abs(finite(speed)) / height, 0, 3);
        time += step; phase += step * (2.5 + pace * 5);
        stride = THREE.MathUtils.damp(stride, moving ? Math.min(1, pace * 2) : 0, 12, step);
        activity = THREE.MathUtils.damp(activity, working ? 1 : 0, 10, step);
        if (moving) travel += step * finite(speed) / (model.scale.x * 0.29);
        drilling += step * 22 * activity;
        for (const { node, position, rotation: rest } of nodes) {
          node.position.copy(position); node.rotation.copy(rest);
          const offset = node.userData.phase, wave = Math.sin(phase + offset), lift = Math.max(0, -wave) * stride;
          switch (node.userData.motion) {
            case "chassis": node.position.y += (1 - Math.cos(phase * 2)) * 0.009 * stride; break;
            case "hip": node.rotation.x += wave * 0.34 * stride; break;
            case "knee": node.rotation.x += lift * 0.62; break;
            case "ankle": node.rotation.x -= wave * 0.34 * stride + lift * 0.62; break;
            case "shoulder": node.rotation.x = -0.18 - wave * 0.22 * stride - activity * (0.65 + Math.sin(time * 7) * 0.13); break;
            case "elbow": node.rotation.x = -0.48 - activity * 0.35 - recoil * 0.3; break;
            case "head": node.rotation.y += Math.sin(time * 0.65) * 0.16 * (1 - recoil); break;
            case "gun": node.position.z -= recoil * 0.065; node.rotation.x -= recoil * 0.075; break;
            case "hover": node.position.y += Math.sin(time * 2.6 + offset) * 0.035; node.rotation.z += Math.sin(time * 1.8 + offset) * 0.045; break;
            case "wheel": node.rotation.x = travel; break;
            case "rotor": node.rotation.y = time * (30 + pace * 8) + offset; break;
            case "drill": node.rotation.y = drilling; break;
            case "claw": node.rotation.z = offset * (0.14 + activity * (0.2 + Math.sin(time * 6) * 0.17)); break;
            case "probe": node.rotation.x = Math.sin(time * 2 + offset) * 0.12 + activity * 0.2; break;
          }
        }
        if (arms.length) rig.updateWorldMatrix(true, true);
        for (const { shoulder, elbow, wrist, grip } of arms) {
          shoulder.parent!.worldToLocal(grip.getWorldPosition(target)); direction.copy(target).sub(shoulder.position);
          const distance = THREE.MathUtils.clamp(direction.length(), 0.025, 0.769); direction.normalize();
          const reach = (0.38 ** 2 - 0.39 ** 2 + distance ** 2) / (2 * distance);
          bend.set(Math.sign(shoulder.userData.phase) * 0.8, -1, -0.25).addScaledVector(direction, -bend.dot(direction)).normalize();
          elbowPoint.copy(direction).multiplyScalar(reach).addScaledVector(bend, Math.sqrt(Math.max(0, 0.38 ** 2 - reach ** 2)));
          shoulder.quaternion.setFromUnitVectors(down, target.copy(elbowPoint).normalize());
          target.copy(direction).multiplyScalar(distance).sub(elbowPoint).normalize();
          elbow.quaternion.copy(shoulder.quaternion).invert().multiply(rotation.setFromUnitVectors(down, target));
          wrist.quaternion.copy(shoulder.quaternion).multiply(elbow.quaternion).invert().multiply(grip.parent!.quaternion);
        }
      },
      dispose: () => {
        if (released) return;
        released = true; model.removeFromParent(); model.clear(); rig.clear(); nodes.length = arms.length = 0;
        unit.weaponMuzzle = undefined; this.active.delete(unit);
      },
    };
    unit.update(0, 0, false, 0, false);
    const bounds = new THREE.Box3().setFromObject(rig, true);
    rig.position.y -= bounds.min.y; model.scale.setScalar(height / (bounds.max.y - bounds.min.y));
    this.active.add(unit); return unit;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.active.forEach(unit => unit.dispose()); this.templates.clear();
    this.geometry.forEach(buffer => buffer.dispose()); this.geometry.clear();
    [this.metal, this.eyes, this.neutral, ...this.teams].forEach(material => material.dispose());
  }
}
