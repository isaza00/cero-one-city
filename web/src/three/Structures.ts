import * as THREE from "three";
import type { EntityOut } from "../api/types";
import { BUILDING_SIZE } from "../game/meta";

export interface StructureKit {
  box: THREE.BufferGeometry;
  cylinder: THREE.BufferGeometry;
  sphere: THREE.BufferGeometry;
  concrete: THREE.Material;
  steel: THREE.Material;
  dark: THREE.Material;
  glow: THREE.Material;
  rust: THREE.Material;
}

export function buildStructure(root: THREE.Group, entity: EntityOut, kit: StructureKit, team: THREE.Material): void {
  const [width, depth] = BUILDING_SIZE[entity.type] ?? [1, 1];
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material,
    position: [number, number, number], scale: [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const box = (material: THREE.Material, position: [number, number, number], scale: [number, number, number]) =>
    part(kit.box, material, position, scale);
  const drum = (material: THREE.Material, position: [number, number, number], scale: [number, number, number]) =>
    part(kit.cylinder, material, position, scale);
  box(kit.concrete, [0, 0.02, 0], [width * 0.95, 0.42, depth * 0.95]);
  if (entity.type === "core") {
    box(kit.dark, [0, 0.4, 0], [1.55, 0.65, 1.5]);
    drum(kit.steel, [0, 0.96, 0], [0.44, 1.12, 0.44]);
    drum(team, [0, 1.23, 0], [0.455, 0.05, 0.455]);
    drum(kit.dark, [0, 1.52, 0], [0.54, 0.16, 0.54]);
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2 + Math.PI / 4;
      const horizontal = Math.sin(angle) * 0.78;
      const vertical = Math.cos(angle) * 0.78;
      box(kit.concrete, [horizontal, 0.66, vertical], [0.28, 1.15, 0.28]);
      drum(kit.steel, [horizontal, 1.34, vertical], [0.09, 0.25, 0.09]);
      drum(kit.dark, [horizontal, 1.49, vertical], [0.13, 0.05, 0.13]);
    }
    box(kit.steel, [0, 0.34, 0.79], [0.52, 0.5, 0.06]);
    box(team, [0, 0.62, 0.83], [0.54, 0.05, 0.04]);
  } else if (entity.type === "assembler") {
    box(kit.dark, [0, 0.58, 0], [1.65, 0.9, 1.55]);
    const roof = drum(kit.steel, [0, 0.96, 0], [0.86, 1.64, 0.42]);
    roof.rotation.z = Math.PI / 2;
    box(kit.dark, [0, 0.54, 0.8], [1.2, 0.73, 0.04]);
    for (let door = 0; door < 7; door++) box(kit.steel, [0, 0.2 + door * 0.095, 0.83], [1.14, 0.025, 0.04]);
    box(team, [0, 1.05, 0.82], [1.5, 0.06, 0.05]);
    for (const side of [-1, 1]) {
      box(kit.concrete, [side * 0.8, 0.6, 0.83], [0.16, 1.03, 0.16]);
      drum(kit.dark, [side * 0.6, 1.2, -0.53], [0.1, 0.6, 0.1]);
    }
  } else if (entity.type === "lab") {
    box(kit.concrete, [0, 0.48, 0], [1.66, 0.73, 1.5]);
    box(kit.steel, [0.25, 1, -0.12], [0.95, 0.47, 0.95]);
    for (let pane = 0; pane < 5; pane++) box(team, [-0.6 + pane * 0.28, 0.66, 0.76], [0.2, 0.16, 0.025]);
    drum(kit.dark, [-0.5, 1.1, 0], [0.05, 0.85, 0.05]);
    const dish = part(kit.sphere, kit.steel, [-0.5, 1.55, 0], [0.38, 0.06, 0.38]);
    dish.rotation.z = -0.55;
    drum(kit.dark, [0.45, 1.65, -0.25], [0.02, 0.85, 0.02]);
    part(kit.sphere, kit.glow, [0.45, 2.07, -0.25], [0.035, 0.035, 0.035]);
  } else if (entity.type === "turret") {
    drum(kit.concrete, [0, 0.28, 0], [0.42, 0.35, 0.42]);
    drum(kit.steel, [0, 0.67, 0], [0.16, 0.5, 0.16]);
    box(kit.dark, [0, 0.96, 0], [0.55, 0.3, 0.45]);
    for (const side of [-1, 1]) {
      const barrel = drum(kit.steel, [side * 0.14, 1, 0.37], [0.045, 0.85, 0.045]);
      barrel.rotation.x = Math.PI / 2;
      box(team, [side * 0.28, 0.99, 0], [0.025, 0.08, 0.28]);
    }
  } else if (entity.type === "cocoon") {
    drum(kit.dark, [0, 0.27, 0], [0.35, 0.22, 0.35]);
    drum(kit.steel, [0, 0.78, 0], [0.23, 0.94, 0.23]);
    part(kit.sphere, kit.dark, [0, 1.23, 0], [0.27, 0.19, 0.27]);
    box(kit.glow, [0, 0.8, 0.23], [0.15, 0.57, 0.035]);
    for (const side of [-1, 1]) {
      drum(kit.dark, [side * 0.3, 0.74, 0], [0.04, 1.05, 0.04]);
      box(team, [side * 0.3, 1.05, 0.05], [0.045, 0.2, 0.04]);
    }
  } else if (entity.type === "rack") {
    box(kit.dark, [0, 0.75, 0], [0.67, 1.25, 0.54]);
    for (let shelf = 0; shelf < 5; shelf++) {
      box(kit.steel, [0, 0.27 + shelf * 0.22, 0.29], [0.59, 0.16, 0.04]);
      box(team, [0.2, 0.27 + shelf * 0.22, 0.315], [0.08, 0.022, 0.015]);
      for (let vent = 0; vent < 3; vent++) box(kit.dark, [-0.19 + vent * 0.09, 0.27 + shelf * 0.22, 0.316], [0.035, 0.09, 0.015]);
    }
  } else if (entity.type === "wall") {
    box(kit.concrete, [0, 0.54, 0], [0.94, 0.88, 0.38]);
    box(kit.steel, [0, 1.02, 0], [0.98, 0.1, 0.42]);
    for (const side of [-1, 1]) {
      const support = box(kit.dark, [side * 0.35, 0.4, 0.19], [0.09, 0.68, 0.12]);
      support.rotation.x = 0.32;
    }
    box(team, [0, 0.72, 0.2], [0.33, 0.04, 0.025]);
  } else {
    box(kit.rust, [-0.14, 0.44, -0.1], [0.55, 0.65, 0.62]);
    box(kit.steel, [-0.14, 0.8, -0.1], [0.61, 0.07, 0.68]);
    for (let rib = 0; rib < 4; rib++) box(kit.dark, [-0.35 + rib * 0.14, 0.44, 0.23], [0.025, 0.6, 0.04]);
    drum(kit.steel, [0.31, 0.36, 0.1], [0.12, 0.5, 0.12]);
    drum(team, [0.31, 0.5, 0.1], [0.125, 0.04, 0.125]);
  }
}
