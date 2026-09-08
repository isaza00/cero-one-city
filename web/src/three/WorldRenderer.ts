import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WorldAssets, type AnimatedCharacter } from "./WorldAssets";
import { buildStructure } from "./Structures";
import { Landscape, landscapeSeed, terrainHash } from "./Landscape";
import { classifyFeatures, type Feature } from "./Features";
import { buildFarm, buildGrass, buildGrove, buildHouse, buildJam, buildPod, buildRubble, buildRuin, buildVein, isBurning, type PropKit } from "./Props";
import { WorldFog, type FogEye } from "./WorldFog";
import { UnitModels, type UnitModel } from "./UnitModels";
import type { EntityOut, GameState, GameEvent } from "../api/types";
import { BUILDING_SIZE, BUILDING_MAX_HP, BUILDING_VISION, UNIT_MAX_HP, UNIT_VISION, PLAYER_COLORS } from "../game/meta";
import { PERSPECTIVE_ALL, exploredTilesFor, visibleTilesFor } from "../game/vision";
import type { MapController } from "../pixi/MapView";

/** Static props are merged per CHUNK x CHUNK tiles. */
const CHUNK = 16;
/** Things the rules already gate by tile (units, effects, wrecks) never go
 *  darker than this inside the fog, so a seen enemy at the square edge of
 *  the rule keeps a silhouette where the round light has faded. */
const SEEN_FLOOR = 0.55;
/** The engine's step preference: N, E, S, W. */
const STEPS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

interface Actor {
  root: THREE.Group;
  limbs: THREE.Group[];
  from: THREE.Vector3;
  target: THREE.Vector3;
  /** Waypoints of the current move (world xz), and their cumulative length. */
  path: THREE.Vector3[];
  cumulative: number[];
  started: number;
  duration: number;
  signature: string;
  kind: "unit" | "building";
  owner: number;
  /** Radius of the light this actor opens in the fog (0 = none). */
  eye: number;
  airborne: boolean;
  character?: AnimatedCharacter;
  unitModel?: UnitModel;
  hp: THREE.Sprite;
  health: number;
  working: boolean;
  attackAt: number;
  visual: THREE.Group;
  construction: number;
}

interface Transient {
  object: THREE.Object3D;
  started: number;
  duration: number;
  update: (progress: number) => void;
  dispose: () => void;
}

export class WorldRenderer implements MapController {
  onSelect: ((id: number | null) => void) | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private assets = new WorldAssets();
  private landscape: Landscape | null = null;
  private mapSeed: number | undefined;
  private fog = new WorldFog();
  private unitModels = new UnitModels();
  private sun = new THREE.DirectionalLight(0xf2d6b4, 1.7);
  private scenery = new THREE.Group();
  private transient: Transient[] = [];
  private previousTime = 0;
  private visible: Set<number> | null = null;
  private perspective: number | null = null;
  private lastEvents = -1;
  private focused = false;
  private cover = false;
  private debris: THREE.InstancedMesh | null = null;
  private scrap = new THREE.Group();
  private scrapKey = "";
  private smoke: THREE.Points | null = null;
  private smokeSources: number[] = [];
  private smokeTexture: THREE.CanvasTexture | null = null;
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  private controls: OrbitControls | null = null;
  private terrain = new THREE.Group();
  private actors = new Map<number, Actor>();
  private tiles: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;
  private chunks = new Map<number, THREE.Group>();
  private resources: { feature: Feature; group: THREE.Group }[] = [];
  private tileChunk = new Int32Array(0);
  private previousTiles: string[][] | null = null;
  private grass: THREE.Group | null = null;
  private size = 0;
  private terrainKey = "";
  private turn = -1;
  private turnAt = 0;
  private cadence = 2000;
  private selected: number | null = null;
  private ring = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.48, 48),
    new THREE.MeshBasicMaterial({ color: 0xb7efdd, side: THREE.DoubleSide, depthWrite: false }));
  private orderRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 40),
    new THREE.MeshBasicMaterial({ color: 0xffcf86, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
  private orderUntil = 0;
  private abort = new AbortController();
  private dead = false;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private box = new THREE.BoxGeometry(1, 1, 1);
  private sphere = new THREE.SphereGeometry(1, 12, 8);
  private cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  private boulder = new THREE.IcosahedronGeometry(1, 1);
  private rod = new THREE.CylinderGeometry(1, 1, 1, 6);
  private ownedGeometry = new Set<THREE.BufferGeometry>();
  private matteClass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.04 });
  private metalClass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.6 });
  private plaster = [0x8a7f70, 0x746b61, 0x685d54, 0x7d7064, 0x62655f, 0x745a4d].map(color =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
  private trunk = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 });
  private canopy = [0x33471f, 0x445224, 0x585a2c].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  private paint = [0x6f7270, 0x5e2a24, 0x2a3e52, 0x4a5540, 0x6b5f30, 0x2c2f32, 0x565a58, 0x3f3128].map(color =>    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }));
  private glass = new THREE.MeshStandardMaterial({ color: 0x1c2a30, roughness: 0.3, metalness: 0.6 });
  private roofing = [0x4a332c, 0x3b3d3f, 0x574839, 0x323d41].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  private fire = new THREE.MeshStandardMaterial({ color: 0xd94a0c, emissive: 0xff3a00, emissiveIntensity: 1.7, roughness: 1 });
  private char = new THREE.MeshStandardMaterial({ color: 0x1b1715, roughness: 1 });
  private steel = new THREE.MeshStandardMaterial({ color: 0x69777b, roughness: 0.43, metalness: 0.8 });
  private dark = new THREE.MeshStandardMaterial({ color: 0x20292a, roughness: 0.74, metalness: 0.5 });
  private concrete = this.assets.concrete;
  private rust = new THREE.MeshStandardMaterial({ color: 0x72503a, roughness: 0.88, metalness: 0.35 });
  private skin = new THREE.MeshStandardMaterial({ color: 0x9d8270, roughness: 0.9 });
  private vegetation = new THREE.MeshStandardMaterial({ color: 0x4c5740, roughness: 1, side: THREE.DoubleSide });
  private bone = new THREE.MeshStandardMaterial({ color: 0x7a6d5c, roughness: 1 });
  private glow = new THREE.MeshStandardMaterial({ color: 0x77bfa7, emissive: 0x3caa88, emissiveIntensity: 1.4 });
  private teamMaterials = PLAYER_COLORS.map(color => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.35, metalness: 0.45, roughness: 0.55,
  }));

  async init(host: HTMLElement, width = 640, height = 640, cover = false): Promise<void> {
    if (this.dead) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer = renderer;
    this.cover = cover;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.86;
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.006);
    this.scene.add(new THREE.HemisphereLight(0x8f9ca6, 0x2c2a24, 1.1));
    const sun = this.sun;
    sun.position.set(-30, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -24;
    sun.shadow.camera.right = sun.shadow.camera.top = 24;
    sun.shadow.camera.far = 220;
    sun.shadow.normalBias = 0.035;
    sun.target.position.set(30, 0, 30);
    this.scene.add(sun, sun.target, this.terrain, this.scenery, this.scrap, this.ring, this.orderRing);
    this.ring.rotation.x = this.orderRing.rotation.x = -Math.PI / 2;
    this.ring.visible = this.orderRing.visible = false;
    this.camera.position.set(22, 22, 22);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 180;
    this.controls.maxPolarAngle = Math.PI / 2.5;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    const smokeCanvas = document.createElement("canvas");
    smokeCanvas.width = smokeCanvas.height = 64;
    const smokeContext = smokeCanvas.getContext("2d")!;
    const gradient = smokeContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.65)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.3)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    smokeContext.fillStyle = gradient;
    smokeContext.fillRect(0, 0, 64, 64);
    this.smokeTexture = new THREE.CanvasTexture(smokeCanvas);
    this.resizeView(width, height);
    host.replaceChildren(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "3D battlefield. Drag to pan, scroll to zoom, right-drag to orbit.");
    let pointer: { x: number; y: number } | null = null;
    renderer.domElement.addEventListener("pointerdown", event => {
      pointer = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    }, { signal: this.abort.signal });
    renderer.domElement.addEventListener("pointerup", event => {
      const start = pointer;
      pointer = null;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const candidates = [...this.actors.values()].filter(actor => actor.root.visible).map(actor => actor.root);
      let hit: THREE.Object3D | null = this.raycaster.intersectObjects(candidates, true)[0]?.object ?? null;
      while (hit && hit.userData.entityId === undefined) hit = hit.parent;
      const id = (hit?.userData.entityId as number | undefined) ?? null;
      this.select(id);
      this.onSelect?.(id);
    }, { signal: this.abort.signal });
    renderer.domElement.addEventListener("pointercancel", () => { pointer = null; }, { signal: this.abort.signal });
    await this.assets.load(renderer);
    if (this.dead) return;
    this.scene.environment = this.assets.environmentMap;
    this.scene.environmentIntensity = 0.48;
    this.steel.normalMap = this.concrete.normalMap;
    this.steel.normalScale.set(0.22, 0.22);
    this.steel.roughnessMap = this.concrete.roughnessMap;
    this.steel.roughness = 0.72;
    this.rust.map = this.assets.rock.map;
    this.rust.normalMap = this.assets.rock.normalMap;
    this.dark.normalMap = this.concrete.normalMap;
    this.dark.normalScale.set(0.15, 0.15);
    renderer.setAnimationLoop(() => this.tick());
  }

  private elevation(horizontal: number, vertical: number): number {
    return this.landscape?.height(horizontal, vertical) ?? 0;
  }

  private mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
    position: [number, number, number], scale: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private propKit(): PropKit {
    return {
      box: this.box, cylinder: this.cylinder, sphere: this.sphere, boulder: this.boulder, rod: this.rod,
      concrete: this.concrete, plaster: this.plaster, steel: this.steel, dark: this.dark, rust: this.rust,
      bone: this.bone, glow: this.glow, skin: this.skin, rock: this.assets.rock, trunk: this.trunk,
      canopy: this.canopy, paint: this.paint, roofing: this.roofing, glass: this.glass, fire: this.fire, char: this.char,
      elevation: (x, z) => this.elevation(x, z), seed: this.landscape?.seed ?? 0,
    };
  }

  private chunkOf(tile: number): number {
    const column = Math.floor(tile % this.size / CHUNK);
    const row = Math.floor(Math.floor(tile / this.size) / CHUNK);
    return row * Math.ceil(this.size / CHUNK) + column;
  }

  private disposeGroup(group: THREE.Object3D): void {
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      this.ownedGeometry.delete(object.geometry);
    });
    group.removeFromParent();
  }

  /** The ground itself: one mesh for the whole sector, pebbles where the
   *  ground is loose, weeds where the district went green. Independent of the
   *  tiles, so it is built once per landscape. */
  private buildGround(size: number): void {
    const landscape = this.landscape!;
    if (this.tiles) this.disposeGroup(this.tiles);
    if (this.debris) { this.debris.dispose(); this.debris.removeFromParent(); }
    if (this.grass) this.disposeGroup(this.grass);
    const positions: number[] = [];
    const uv: number[] = [];
    const normals: number[] = [];
    // No loose stones: the ground is dirt, asphalt and weeds; every solid
    // object stands on an impassable tile.
    const pebbles: THREE.Matrix4[] = [];
    const grass = new THREE.Group();
    const kit = this.propKit();
    for (let vertical = 0; vertical < size; vertical++) {
      for (let horizontal = 0; horizontal < size; horizontal++) {
        for (const [offsetX, offsetZ] of [[0, 0], [0, 1], [1, 0], [1, 0], [0, 1], [1, 1]]) {
          const worldX = horizontal + offsetX;
          const worldZ = vertical + offsetZ;
          positions.push(worldX, this.elevation(worldX, worldZ), worldZ);
          uv.push(worldX / 3, worldZ / 3);
          const normal = new THREE.Vector3(this.elevation(worldX - 0.05, worldZ) - this.elevation(worldX + 0.05, worldZ),
            0.1, this.elevation(worldX, worldZ - 0.05) - this.elevation(worldX, worldZ + 0.05)).normalize();
          normals.push(normal.x, normal.y, normal.z);
        }
        const onRoad = landscape.roads.distance(horizontal + 0.5, vertical + 0.5) < 1.8;
        const growth = landscape.sample(horizontal / 7, vertical / 7);
        if (growth > 0.64 && !onRoad && terrainHash(horizontal, vertical, landscape.seed) > 0.82) {
          buildGrass(grass, horizontal, vertical, kit, this.vegetation);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
    this.tiles = new THREE.Mesh(geometry, this.assets.ground);
    this.tiles.receiveShadow = true;
    this.terrain.add(this.tiles);
    this.debris = new THREE.InstancedMesh(this.boulder, this.assets.rock, Math.max(1, pebbles.length));
    pebbles.forEach((matrix, index) => this.debris!.setMatrixAt(index, matrix));
    if (!pebbles.length) this.debris.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
    this.debris.receiveShadow = true;
    this.debris.computeBoundingSphere();
    this.terrain.add(this.debris);
    this.mergeStatic(grass);
    this.grass = grass;
    this.terrain.add(grass);
  }

  /** Everything that stands on the tiles: houses, jams, groves, outcrops,
   *  rubble, pods and veins. Static props are merged per 16x16-tile chunk so
   *  the whole district costs a few draw calls per chunk, and only the chunks
   *  whose tiles changed (rubble cleared, a building razed) are rebuilt. */
  private buildTerrain(state: GameState): void {
    const size = state.size;
    const seed = this.mapSeed ?? landscapeSeed(state.tiles);
    const fresh = !this.landscape || this.landscape.size !== size || this.landscape.seed !== seed;
    if (fresh) {
      this.landscape?.dispose();
      this.landscape = new Landscape(size, seed, state.format, state.tiles);
      this.assets.setLandscape(this.landscape.surface, size);
      this.size = size;
      this.buildGround(size);
      this.chunks.forEach(group => this.disposeGroup(group));
      this.chunks.clear();
      this.resources.forEach(({ group }) => this.disposeGroup(group));
      this.resources = [];
      this.tileChunk = new Int32Array(size * size).fill(-1);
      this.previousTiles = null;
    }
    const landscape = this.landscape!;
    const kit = this.propKit();
    const features = classifyFeatures(state.tiles, landscape.roads, landscape.seed);
    // Which chunks need rebuilding: those holding a changed tile, those whose
    // feature had that tile, and those where a changed tile now belongs.
    const dirty = new Set<number>();
    const changed = new Set<number>();
    if (!this.previousTiles) {
      for (let chunk = 0; chunk < Math.ceil(size / CHUNK) ** 2; chunk++) dirty.add(chunk);
    } else {
      for (let vertical = 0; vertical < size; vertical++) {
        for (let horizontal = 0; horizontal < size; horizontal++) {
          if (this.previousTiles[vertical][horizontal] !== state.tiles[vertical][horizontal]) {
            const tile = vertical * size + horizontal;
            changed.add(tile);
            dirty.add(this.chunkOf(tile));
            if (this.tileChunk[tile] >= 0) dirty.add(this.tileChunk[tile]);
          }
        }
      }
      for (const feature of features) {
        if (feature.tiles.some(tile => changed.has(tile))) dirty.add(this.chunkOf(feature.minY * size + feature.minX));
      }
    }
    this.previousTiles = state.tiles.map(row => row.slice());
    for (const chunk of dirty) {
      const old = this.chunks.get(chunk);
      if (old) this.disposeGroup(old);
      this.chunks.delete(chunk);
    }
    for (const entry of this.resources) {
      if (dirty.has(this.chunkOf(entry.feature.tiles[0]))) this.disposeGroup(entry.group);
    }
    this.resources = this.resources.filter(entry => !dirty.has(this.chunkOf(entry.feature.tiles[0])));
    for (const feature of features) {
      const chunk = this.chunkOf(feature.minY * size + feature.minX);
      if (!dirty.has(chunk)) continue;
      if (feature.kind === "pod" || feature.kind === "vein") {
        const group = new THREE.Group();
        if (feature.kind === "pod") buildPod(group, feature.minX, feature.minY, kit);
        else buildVein(group, feature.minX, feature.minY, kit);
        this.mergeStatic(group);
        this.terrain.add(group);
        this.fog.apply(group);
        this.resources.push({ feature, group });
        continue;
      }
      let group = this.chunks.get(chunk);
      if (!group) {
        group = new THREE.Group();
        group.userData.chunk = chunk;
        this.chunks.set(chunk, group);
      }
      const part = new THREE.Group();
      switch (feature.kind) {
        case "house": buildHouse(part, feature, kit, size); break;
        case "jam": buildJam(part, feature, kit); break;
        case "grove": buildGrove(part, feature, kit, size); break;
        case "ruin": buildRuin(part, feature, kit, size); break;
        case "farm": buildFarm(part, feature, kit, size); break;
        case "rubble": buildRubble(part, feature, kit, size); break;
      }
      group.add(part);
      for (const tile of feature.tiles) this.tileChunk[tile] = chunk;
    }
    for (const chunk of dirty) {
      const group = this.chunks.get(chunk);
      if (!group) continue;
      this.mergeStatic(group);
      this.terrain.add(group);
      this.fog.apply(group);
    }
    // Smoke rises from whatever is on fire (the same rule Props uses for flames).
    this.smokeSources = [];
    for (const feature of features) {
      if (this.smokeSources.length >= 64) break;
      if (isBurning(feature, landscape.seed)) this.smokeSources.push(feature.tiles[Math.floor(feature.tiles.length / 2)]);
    }
    if (this.smoke) {
      this.scene.remove(this.smoke);
      this.smoke.geometry.dispose();
      (this.smoke.material as THREE.Material).dispose();
    }
    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(this.smokeSources.length * 9), 3));
    this.smoke = new THREE.Points(smokeGeometry, new THREE.PointsMaterial({
      map: this.smokeTexture, color: 0x69777d, size: 2.1, opacity: 0.23,
      transparent: true, depthWrite: false, sizeAttenuation: true,
    }));
    this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);
    this.scenery.clear();
    this.fog.apply(this.terrain);
    this.fog.apply(this.smoke);
  }

  /** Bake a group of many small meshes into a few: plain-coloured parts share
   *  two vertex-coloured materials (matte / metal), textured and glowing parts
   *  keep their own. Transforms are applied in world space, so the group can
   *  stay at the origin and merged parts keep their place. */
  private mergeStatic(group: THREE.Group): void {
    group.updateMatrixWorld(true);
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const color = new THREE.Color();
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const geometry = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrixWorld);
      const source = object.material as THREE.MeshStandardMaterial;
      let material: THREE.Material = source;
      const textured = !!source.map || source.emissiveIntensity > 0 && source.emissive?.getHex() !== 0;
      if (!textured && source.color) {
        material = source.metalness >= 0.3 ? this.metalClass : this.matteClass;
        color.copy(source.color);
        const count = geometry.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let vertex = 0; vertex < count; vertex++) colors.set([color.r, color.g, color.b], vertex * 3);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      const batch = batches.get(material) ?? [];
      batch.push(geometry);
      batches.set(material, batch);
    });
    group.clear();
    for (const [material, geometries] of batches) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      this.ownedGeometry.add(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  private makeActor(entity: EntityOut): Actor {
    const root = new THREE.Group();
    root.userData.entityId = entity.id;
    const limbs: THREE.Group[] = [];
    const team = this.teamMaterials[entity.owner] ?? this.rust;
    const airborne = ["wasp", "watcher", "drone_swarm"].includes(entity.type);
    let character: AnimatedCharacter | undefined;
    let unitModel: UnitModel | undefined;
    if (entity.kind === "building") {
      buildStructure(root, entity, { box: this.box, cylinder: this.cylinder, sphere: this.sphere,
        concrete: this.concrete, steel: this.steel, dark: this.dark, glow: this.glow, rust: this.rust }, team);
    } else if (!["human", "survivor"].includes(entity.type)) {
      const height = ({ colossus: 2.35, walking_tower: 2.8, anvil: 1.55, spark: 0.65,
        worker: 1.08, wasp: 0.55, watcher: 0.65, drone_swarm: 0.8, rider: 0.9, leech: 0.55,
        prism: 1.05 } as Record<string, number>)[entity.type] ?? 1.35;
      unitModel = this.unitModels.create(entity.type, entity.owner, height);
      root.add(unitModel.model);
    } else {
      const height = entity.type === "survivor" ? 1.15 : 1.24;
      character = this.assets.character(height, entity.type === "survivor");
      root.add(character.model);
      if (entity.type === "human") {
        const weapon = new THREE.Group();
        this.mesh(weapon, this.box, this.dark, [0.18, 0.76, 0.13], [0.08, 0.09, 0.28]);
        const barrel = this.mesh(weapon, this.cylinder, this.steel, [0.18, 0.78, 0.34], [0.022, 0.28, 0.022]);
        barrel.rotation.x = Math.PI / 2;
        this.mesh(weapon, this.box, team, [0.226, 0.78, 0.14], [0.008, 0.04, 0.14]);
        root.add(weapon);
        root.updateMatrixWorld(true);
        let hand: THREE.Object3D | null = null;
        character.model.traverse(object => { if (object.name.endsWith("RightHand")) hand = object; });
        (hand as THREE.Object3D | null)?.attach(weapon);
        this.mesh(root, this.box, team, [-0.18, 0.87, 0.01], [0.06, 0.05, 0.13]);
      }
    }
    const actorRoot = new THREE.Group();
    actorRoot.userData.entityId = entity.id;
    actorRoot.userData.owner = entity.owner;
    actorRoot.add(root);
    const hp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    hp.position.y = entity.kind === "building" ? 2.3 : ["colossus", "walking_tower", "anvil"].includes(entity.type) ? 2.1 : 1.55;
    hp.scale.set(0.7, 0.09, 1);
    hp.renderOrder = 20;
    actorRoot.add(hp);
    this.scene.add(actorRoot);
    this.fog.apply(actorRoot, SEEN_FLOOR);
    return { root: actorRoot, visual: root, limbs, character, unitModel, hp, health: -1, working: false,
      attackAt: -1000, construction: 1, from: new THREE.Vector3(), target: new THREE.Vector3(), path: [], cumulative: [],
      started: 0, duration: 0, signature: `${entity.kind}:${entity.type}:${entity.owner}`, airborne,
      kind: entity.kind, owner: entity.owner, eye: 0 };
  }

  /** The tiles a ground unit walked between two states: the shortest path over
   *  plain, building-free tiles with the engine's N, E, S, W preference, found
   *  inside a window around both ends. Corners are rounded a little (never
   *  enough to leave the tile), straight runs collapse to one segment. Falls
   *  back to the straight line when the ends are not connected in the window
   *  (spawns, rewinds, fliers). */
  private walkPath(blocked: Uint8Array, size: number, from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const straight = [from.clone(), to.clone()];
    const startX = THREE.MathUtils.clamp(Math.floor(from.x), 0, size - 1);
    const startZ = THREE.MathUtils.clamp(Math.floor(from.z), 0, size - 1);
    const endX = THREE.MathUtils.clamp(Math.floor(to.x), 0, size - 1);
    const endZ = THREE.MathUtils.clamp(Math.floor(to.z), 0, size - 1);
    if (startX === endX && startZ === endZ) return straight;
    const pad = 6;
    const minX = Math.max(0, Math.min(startX, endX) - pad);
    const minZ = Math.max(0, Math.min(startZ, endZ) - pad);
    const maxX = Math.min(size - 1, Math.max(startX, endX) + pad);
    const maxZ = Math.min(size - 1, Math.max(startZ, endZ) + pad);
    const width = maxX - minX + 1;
    const previous = new Int32Array(width * (maxZ - minZ + 1)).fill(-1);
    const startIndex = (startZ - minZ) * width + (startX - minX);
    const endIndex = (endZ - minZ) * width + (endX - minX);
    previous[startIndex] = startIndex;
    let frontier = [startIndex];
    let found = false;
    while (frontier.length && !found) {
      const next: number[] = [];
      for (const index of frontier) {
        const x = index % width + minX;
        const z = Math.floor(index / width) + minZ;
        for (const [dx, dz] of STEPS) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
          const candidate = (nz - minZ) * width + (nx - minX);
          if (previous[candidate] >= 0 || (blocked[nz * size + nx] && candidate !== endIndex)) continue;
          previous[candidate] = index;
          if (candidate === endIndex) { found = true; break; }
          next.push(candidate);
        }
        if (found) break;
      }
      frontier = next;
    }
    if (!found) return straight;
    const centers: THREE.Vector3[] = [];
    for (let cursor = previous[endIndex]; cursor !== startIndex; cursor = previous[cursor]) {
      centers.push(new THREE.Vector3(cursor % width + minX + 0.5, 0, Math.floor(cursor / width) + minZ + 0.5));
    }
    centers.reverse();
    const points = [from.clone()];
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    centers.forEach((center, index) => {
      before.subVectors(center, index ? centers[index - 1] : from).setY(0).normalize();
      after.subVectors(index + 1 < centers.length ? centers[index + 1] : to, center).setY(0).normalize();
      if (before.dot(after) > 0.999) return;
      points.push(center.clone().addScaledVector(before, -0.35), center.clone().addScaledVector(after, 0.35));
    });
    points.push(to.clone());
    return points;
  }

  /** A unit or building dies: it drops (a building crumbles in on itself),
   *  lies charred for a moment, then sinks into the ground and fades away.
   *  The corpse gets its own materials so shared team paint stays clean. */
  private killActor(actor: Actor, blocked: Uint8Array, size: number): void {
    actor.hp.visible = false;
    actor.character?.mixer.stopAllAction();
    const building = actor.kind === "building";
    // Which way the body drops: backwards by preference, else to a side, else
    // forwards - the first of those whose neighbouring tile is open ground, so
    // the corpse lies on the street and not inside the wall it died against.
    const facing = actor.root.rotation.y;
    const { x: originX, z: originZ } = actor.root.position;
    const open = (dx: number, dz: number) => {
      const column = Math.floor(originX + dx * 1.1);
      const row = Math.floor(originZ + dz * 1.1);
      return column >= 0 && row >= 0 && column < size && row < size && !blocked[row * size + column];
    };
    const ways: { axis: "x" | "z"; sign: number; dx: number; dz: number }[] = [
      { axis: "x", sign: -1, dx: -Math.sin(facing), dz: -Math.cos(facing) },
      { axis: "z", sign: 1, dx: -Math.cos(facing), dz: Math.sin(facing) },
      { axis: "z", sign: -1, dx: Math.cos(facing), dz: -Math.sin(facing) },
      { axis: "x", sign: 1, dx: Math.sin(facing), dz: Math.cos(facing) },
    ];
    const way = ways.find(candidate => open(candidate.dx, candidate.dz)) ?? ways[0];
    const clones: THREE.Material[] = [];
    const skins: { material: THREE.MeshStandardMaterial; color: THREE.Color; emissive: number }[] = [];
    actor.visual.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      // Same shader parameters as the living paint, so no program compiles
      // on a death: the body vanishes by sinking under the ground, not by fading.
      const adopt = (source: THREE.Material) => {
        const material = source.clone();
        clones.push(material);
        if (material instanceof THREE.MeshStandardMaterial) {
          skins.push({ material, color: material.color.clone(), emissive: material.emissiveIntensity });
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(adopt) : adopt(object.material);
    });
    const ground = this.elevation(actor.root.position.x, actor.root.position.z);
    const hover = actor.root.position.y - ground;
    const lean = (Math.random() - 0.5) * 0.7;
    const twist = (Math.random() - 0.5) * 0.5;
    const depth = building ? 2.6 : 1.3;
    const char = new THREE.Color(0x1a1614);
    let puffed = false;
    this.addTransient(actor.root, 3400, progress => {
      const fall = 1 - (1 - Math.min(1, progress / 0.16)) ** 3;
      const burn = THREE.MathUtils.clamp((progress - 0.14) / 0.36, 0, 1);
      const sink = THREE.MathUtils.smoothstep(progress, 0.55, 1);
      if (building) {
        actor.visual.scale.y = actor.construction * (1 - fall * 0.82);
        actor.visual.rotation.z = lean * 0.25 * fall;
        actor.visual.rotation.x = twist * 0.25 * fall;
        actor.visual.position.x = (1 - fall) * Math.sin(progress * 400) * 0.04;
      } else {
        const drop = way.sign * (Math.PI / 2 * fall + Math.sin(fall * Math.PI) * 0.15);
        actor.visual.rotation.x = way.axis === "x" ? drop : lean * 0.5 * fall;
        actor.visual.rotation.z = way.axis === "z" ? drop : lean * fall;
        actor.visual.rotation.y = twist * fall;
        actor.visual.position.y = -0.04 * fall;
      }
      actor.root.position.y = ground + hover * (1 - fall) ** 2 - sink * depth;
      for (const skin of skins) {
        skin.material.color.copy(skin.color).lerp(char, burn * 0.85);
        skin.material.emissiveIntensity = skin.emissive * (1 - burn);
      }
      if (!puffed && progress > 0.55) {
        puffed = true;
        this.puff(actor.root.position.x, ground, actor.root.position.z, building ? 1.6 : 1);
      }
    }, () => {
      clones.forEach(material => material.dispose());
      this.releaseActor(actor);
    }, SEEN_FLOOR);
    this.impact(actor.root.position, 0xefa05a, building ? 1.2 : 0.8);
  }

  /** A soft puff of dust where something sank into the ground. */
  private puff(x: number, ground: number, z: number, scale: number): void {
    if (!this.smokeTexture) return;
    const material = new THREE.SpriteMaterial({ map: this.smokeTexture, color: 0x8d8272, transparent: true, opacity: 0.55, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, ground + 0.3 * scale, z);
    this.addTransient(sprite, 1100, progress => {
      sprite.scale.setScalar((0.6 + progress * 1.6) * scale);
      sprite.position.y = ground + (0.3 + progress * 0.5) * scale;
      material.opacity = 0.55 * (1 - progress);
    }, () => material.dispose(), SEEN_FLOOR);
  }

  private healthBar(actor: Actor, entity: EntityOut): void {
    const max = (entity.kind === "unit" ? UNIT_MAX_HP : BUILDING_MAX_HP)[entity.type] ?? entity.hp;
    const fraction = THREE.MathUtils.clamp(entity.hp / Math.max(1, max), 0, 1);
    if (actor.health === fraction) return;
    actor.health = fraction;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 16;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#0b1215";
    context.fillRect(0, 0, 128, 16);
    context.fillStyle = fraction > 0.5 ? "#94bfa6" : fraction > 0.25 ? "#d5ad65" : "#c45e4b";
    context.fillRect(3, 3, 122 * fraction, 10);
    actor.hp.material.map?.dispose();
    actor.hp.material.map = new THREE.CanvasTexture(canvas);
    actor.hp.material.needsUpdate = true;
  }

  private releaseActor(actor: Actor): void {
    if (actor.character) this.assets.release(actor.character);
    actor.unitModel?.dispose();
    actor.hp.material.map?.dispose();
    actor.hp.material.dispose();
    this.scene.remove(actor.root);
  }

  render(state: GameState, perspective: number | null = null): void {
    if (this.dead || !this.renderer) return;
    const now = performance.now();
    const resized = state.size !== this.size;
    const reset = resized || state.turn < this.turn;
    if (reset) {
      this.transient.forEach(effect => { this.scene.remove(effect.object); effect.dispose(); });
      this.transient = [];
      this.lastEvents = state.turn;
    }
    const key = JSON.stringify(state.tiles);
    if (key !== this.terrainKey) {
      this.buildTerrain(state);
      this.terrainKey = key;
    }
    if (reset) {
      this.size = state.size;
      if (!this.focused || resized) {
        this.fitWorld();
      }
      this.controls?.update();
    }
    if (state.turn !== this.turn) {
      if (this.turnAt && !reset) this.cadence = THREE.MathUtils.clamp(now - this.turnAt, 250, 4000);
      this.turn = state.turn;
      this.turnAt = now;
    }
    const visible = perspective === null ? null : visibleTilesFor(state, perspective);
    const explored = perspective === null ? null : exploredTilesFor(state, perspective);
    this.visible = visible;
    this.perspective = perspective;
    this.fog.update(state.size, perspective !== null, explored);
    this.fog.apply(this.ring, SEEN_FLOOR);
    this.fog.apply(this.orderRing, SEEN_FLOOR);
    // What ground units cannot cross: anything but plain ground, and every
    // building footprint (the engine's own rule).
    const blocked = new Uint8Array(state.size * state.size);
    for (let vertical = 0; vertical < state.size; vertical++) {
      for (let horizontal = 0; horizontal < state.size; horizontal++) {
        if (state.tiles[vertical][horizontal] !== "plain") blocked[vertical * state.size + horizontal] = 1;
      }
    }
    for (const entity of Object.values(state.entities)) {
      if (entity.kind !== "building") continue;
      const [width, depth] = BUILDING_SIZE[entity.type] ?? [1, 1];
      for (let row = entity.y; row < entity.y + depth; row++) {
        for (let column = entity.x; column < entity.x + width; column++) {
          if (row >= 0 && row < state.size && column >= 0 && column < state.size) blocked[row * state.size + column] = 1;
        }
      }
    }
    this.transient.forEach(effect => {
      const position = effect.object.position;
      const tile = Math.floor(position.z) * state.size + Math.floor(position.x);
      effect.object.visible = !visible || visible.has(tile);
    });
    if (!this.focused && Object.keys(state.entities).length) {
      this.focused = true;
      if (this.cover) {
        const entities = Object.values(state.entities).filter(entity =>
          entity.owner >= 0 && (perspective === null || perspective < 0 || entity.owner === perspective));
        const focus = entities.find(entity => entity.type === "core") ?? entities[0];
        if (focus && this.controls) {
          this.controls.target.set(focus.x + 2, this.elevation(focus.x, focus.y), focus.y + 2);
          this.camera.position.copy(this.controls.target).add(new THREE.Vector3(11, 9.4, 11));
          this.controls.update();
        }
      }
    }
    const color = new THREE.Color();
    const colors = this.tiles?.geometry.attributes.color;
    for (let index = 0; index < state.size ** 2; index++) {
      const horizontal = index % state.size;
      const vertical = Math.floor(index / state.size);
      const district = this.landscape?.sample(horizontal / 9, vertical / 9) ?? 0.5;
      color.set(state.tiles[vertical][horizontal] === "vein" ? 0x8a8274 : 0xa6a99c);
      color.multiplyScalar(0.56 + district * 0.3);
      for (let vertex = 0; vertex < 6; vertex++) {
        colors?.setXYZ(index * 6 + vertex, color.r, color.g, color.b);
      }
    }
    if (colors) colors.needsUpdate = true;
    // Static props stay in the scene: the fog shader blacks out the unknown and
    // dims the explored. Only resources come and go (harvested to nothing).
    for (const { feature, group } of this.resources) {
      const key = `${feature.minX},${feature.minY}`;
      const exhausted = feature.kind === "pod" && state.pods !== undefined && !(state.pods[key] > 0)
        || feature.kind === "vein" && !(state.veins[key] > 0);
      const index = feature.tiles[0];
      group.visible = (!visible || visible.has(index)) && !exhausted;
    }
    const scrapKey = JSON.stringify(state.scrap);
    if (scrapKey !== this.scrapKey) {
      this.scrapKey = scrapKey;
      this.scrap.clear();
      for (const [key, resources] of Object.entries(state.scrap)) {
        if (resources.e + resources.m <= 0) continue;
        const [horizontal, vertical] = key.split(",").map(Number);
        if (![horizontal, vertical].every(Number.isFinite)) continue;
        const wreck = new THREE.Group();
        wreck.userData.tile = vertical * state.size + horizontal;
        wreck.position.set(horizontal + 0.5, this.elevation(horizontal + 0.5, vertical + 0.5), vertical + 0.5);
        this.mesh(wreck, this.box, this.dark, [0, 0.08, 0], [0.32, 0.15, 0.23]).rotation.z = 0.35;
        this.mesh(wreck, this.cylinder, this.steel, [0.16, 0.08, 0], [0.04, 0.3, 0.04]).rotation.z = 1.3;
        this.scrap.add(wreck);
        this.fog.apply(wreck, SEEN_FLOOR);
      }
    }
    for (const wreck of this.scrap.children) wreck.visible = !visible || visible.has(wreck.userData.tile);
    const active = new Set<number>();
    for (const entity of Object.values(state.entities)) {
      active.add(entity.id);
      let actor = this.actors.get(entity.id);
      const signature = `${entity.kind}:${entity.type}:${entity.owner}`;
      if (actor && actor.signature !== signature) {
        this.releaseActor(actor);
        this.actors.delete(entity.id);
        actor = undefined;
      }
      const fresh = !actor;
      if (!actor) {
        actor = this.makeActor(entity);
        this.actors.set(entity.id, actor);
      }
      this.healthBar(actor, entity);
      actor.working = ["gather", "build", "repair", "harvest", "mine"].includes(entity.standing_order?.type ?? "");
      actor.construction = entity.build_progress && entity.build_total
        ? THREE.MathUtils.clamp(1 - entity.build_progress / entity.build_total, 0.06, 1) : 1;
      if (entity.kind === "building") actor.visual.scale.y = actor.construction;
      const [width, depth] = entity.kind === "building" ? BUILDING_SIZE[entity.type] ?? [1, 1] : [1, 1];
      const horizontal = entity.x + width / 2;
      const vertical = entity.y + depth / 2;
      const oracle = state.players[entity.owner]?.lineage === "oracle" ? 2 : 0;
      actor.eye = entity.owner < 0 ? 0
        : (entity.kind === "unit" ? UNIT_VISION[entity.type] ?? 3 : BUILDING_VISION[entity.type] ?? 2) + oracle + (Math.max(width, depth) - 1) / 2;
      if (fresh || reset || actor.target.x !== horizontal || actor.target.z !== vertical) {
        actor.from.copy(actor.root.position);
        actor.target.set(horizontal, this.elevation(horizontal, vertical), vertical);
        actor.started = now;
        actor.duration = fresh || reset ? 0 : this.cadence;
        if (!actor.duration) actor.root.position.copy(actor.target);
        actor.path = actor.duration && entity.kind === "unit" && !actor.airborne
          ? this.walkPath(blocked, state.size, actor.from, actor.target) : [actor.from.clone(), actor.target.clone()];
        actor.cumulative = [0];
        for (let point = 1; point < actor.path.length; point++) {
          const previous = actor.path[point - 1];
          const next = actor.path[point];
          actor.cumulative.push(actor.cumulative[point - 1] + Math.hypot(next.x - previous.x, next.z - previous.z));
        }
      }
      actor.root.visible = !visible || entity.owner === perspective;
      for (let row = entity.y; row < entity.y + depth && !actor.root.visible; row++) {
        for (let column = entity.x; column < entity.x + width; column++) {
          if (visible?.has(row * state.size + column)) actor.root.visible = true;
        }
      }
    }
    for (const [id, actor] of this.actors) {
      if (!active.has(id)) {
        this.actors.delete(id);
        if (actor.root.visible && !reset) this.killActor(actor, blocked, state.size);
        else this.releaseActor(actor);
      }
    }
    if (this.lastEvents !== state.turn) {
      this.lastEvents = state.turn;
      for (const event of state.events_last_turn ?? []) this.eventEffect(event);
    }
  }

  private addTransient(object: THREE.Object3D, duration: number, update: (progress: number) => void,
    dispose: () => void, floor = SEEN_FLOOR): void {
    if (this.transient.length >= 96) {
      const oldest = this.transient.shift()!;
      this.scene.remove(oldest.object);
      oldest.dispose();
    }
    this.scene.add(object);
    this.fog.apply(object, floor);
    this.transient.push({ object, duration, started: performance.now(), update, dispose });
  }

  private impact(position: THREE.Vector3, color: number, radius = 0.4): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const burst = new THREE.Mesh(this.sphere, material);
    burst.position.copy(position);
    burst.position.y += 0.45;
    this.addTransient(burst, 330, progress => {
      burst.scale.setScalar((0.15 + progress) * radius);
      material.opacity = (1 - progress) * 0.8;
    }, () => material.dispose());
  }

  private eventEffect(event: GameEvent): void {
    if (event.type !== "attack" || !Array.isArray(event.src) || !Array.isArray(event.dst)) return;
    const [sourceX, sourceZ] = event.src as number[];
    const [targetX, targetZ] = event.dst as number[];
    if (![sourceX, sourceZ, targetX, targetZ].every(Number.isFinite)) return;
    if (this.visible && (!this.visible.has(sourceZ * this.size + sourceX) || !this.visible.has(targetZ * this.size + targetX))) return;
    const actor = this.actors.get(Number(event.attacker));
    if (actor) {
      actor.attackAt = performance.now();
      actor.root.rotation.y = Math.atan2(targetX - sourceX, targetZ - sourceZ);
    }
    const start = new THREE.Vector3(sourceX + 0.5, this.elevation(sourceX + 0.5, sourceZ + 0.5) + 0.85, sourceZ + 0.5);
    if (actor?.unitModel?.weaponMuzzle) {
      actor.root.updateMatrixWorld(true);
      actor.unitModel.weaponMuzzle.getWorldPosition(start);
    }
    const end = new THREE.Vector3(targetX + 0.5, this.elevation(targetX + 0.5, targetZ + 0.5) + 0.65, targetZ + 0.5);
    const heavy = ["launcher", "walking_tower", "turret"].includes(String(event.attacker_type));
    const teamColor = PLAYER_COLORS[actor?.root.userData.owner] ?? 0xd3c4a2;
    const material = new THREE.MeshBasicMaterial({ color: teamColor });
    const bolt = new THREE.Mesh(this.sphere, material);
    bolt.scale.set(0.055, 0.055, heavy ? 0.42 : 0.3);
    bolt.position.copy(start);
    bolt.lookAt(end);
    if (event.ranged) {
      const ray = end.clone().sub(start);
      const beamMaterial = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.7, depthWrite: false });
      const beam = new THREE.Mesh(this.cylinder, beamMaterial);
      beam.position.copy(start).addScaledVector(ray, 0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ray.clone().normalize());
      beam.scale.set(0.018, ray.length(), 0.018);
      this.addTransient(beam, 230, progress => { beamMaterial.opacity = (1 - progress) * 0.65; }, () => beamMaterial.dispose());
      this.impact(start.clone().add(new THREE.Vector3(0, -0.45, 0)), teamColor, 0.19);
    }
    let completed = false;
    this.addTransient(bolt, event.ranged ? 390 : 120, progress => {
      bolt.position.lerpVectors(start, end, progress);
      completed = progress === 1;
    }, () => {
      material.dispose();
      if (!this.dead && completed) this.impact(end.clone().add(new THREE.Vector3(0, -0.4, 0)), 0xffc58a, heavy ? 0.7 : 0.3);
    });
  }

  private tick(): void {
    const now = performance.now();
    const delta = Math.min(0.1, this.previousTime ? (now - this.previousTime) / 1000 : 0);
    this.previousTime = now;
    this.controls?.update();
    if (this.smoke) {
      const positions = this.smoke.geometry.attributes.position;
      this.smokeSources.forEach((tile, source) => {
        const horizontal = tile % this.size + 0.5;
        const vertical = Math.floor(tile / this.size) + 0.5;
        for (let puff = 0; puff < 3; puff++) {
          const phase = (now * 0.00009 + puff / 3 + source * 0.17) % 1;
          positions.setXYZ(source * 3 + puff, horizontal + phase * 0.8,
            !this.visible || this.visible.has(tile) ? this.elevation(horizontal, vertical) + 0.7 + phase * 3 : -1000,
            vertical + phase * 0.25);
        }
      });
      positions.needsUpdate = true;
    }
    if (this.controls && this.size) {
      const target = this.controls.target;
      const clamped = new THREE.Vector3(THREE.MathUtils.clamp(target.x, 0, this.size), target.y,
        THREE.MathUtils.clamp(target.z, 0, this.size));
      this.camera.position.add(clamped.clone().sub(target));
      target.copy(clamped);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.density = Math.min(0.006, 0.25 / Math.max(1, this.camera.position.distanceTo(target)));
      }
      this.sun.target.position.copy(target);
      this.sun.position.copy(target).add(new THREE.Vector3(-18, 36, -12));
    }
    const eyes: FogEye[] = [];
    for (const actor of this.actors.values()) {
      const progress = actor.duration ? Math.min(1, (now - actor.started) / actor.duration) : 1;
      const length = actor.cumulative[actor.cumulative.length - 1] ?? 0;
      let heading = actor.root.rotation.y;
      if (actor.path.length > 1 && length > 0) {
        // Walk the waypoints at a constant pace: the same distance per
        // millisecond whether the route bends round a house or not.
        const distance = progress * length;
        let segment = 1;
        while (segment < actor.cumulative.length - 1 && actor.cumulative[segment] < distance) segment++;
        const start = actor.path[segment - 1];
        const end = actor.path[segment];
        const span = actor.cumulative[segment] - actor.cumulative[segment - 1];
        actor.root.position.lerpVectors(start, end, span > 0 ? (distance - actor.cumulative[segment - 1]) / span : 1);
        heading = Math.atan2(end.x - start.x, end.z - start.z);
      } else {
        actor.root.position.lerpVectors(actor.from, actor.target, progress);
        heading = Math.atan2(actor.target.x - actor.from.x, actor.target.z - actor.from.z);
      }
      actor.root.position.y = this.elevation(actor.root.position.x, actor.root.position.z);
      if (actor.airborne) actor.root.position.y += 1.1 + Math.sin(now * 0.002 + actor.target.x) * 0.05;
      const moving = progress < 1;
      if (moving && now - actor.attackAt > 400) {
        const difference = Math.atan2(Math.sin(heading - actor.root.rotation.y), Math.cos(heading - actor.root.rotation.y));
        actor.root.rotation.y += difference * Math.min(1, delta * 12);
      }
      if (actor.eye > 0 && this.perspective !== null
          && (this.perspective === PERSPECTIVE_ALL || actor.owner === this.perspective)) {
        eyes.push({ x: actor.root.position.x, z: actor.root.position.z, radius: actor.eye });
      }
      actor.hp.visible = actor.health < 0.99 || actor.root.userData.entityId === this.selected;
      const speed = actor.duration ? length / (actor.duration / 1000) : 0;
      if (actor.unitModel && actor.root.visible) {
        const recoil = now - actor.attackAt < 340 ? Math.sin((now - actor.attackAt) / 340 * Math.PI) : 0;
        actor.unitModel.update(delta, speed, moving, recoil, actor.working);
      }
      if (actor.character && actor.root.visible) {
        this.assets.animate(actor.character, moving, speed, delta);
        actor.visual.rotation.x = now - actor.attackAt < 220 ? -Math.sin((now - actor.attackAt) / 220 * Math.PI) * 0.12 : 0;
        if (actor.working && !moving) actor.visual.rotation.x = 0.12 + Math.sin(now * 0.006) * 0.05;
      }
      actor.limbs.forEach((limb, index) => {
        const sign = index === 0 || index === 3 ? 1 : -1;
        limb.rotation.x = moving ? Math.sin(now * 0.009) * 0.48 * sign : 0;
    });
    }
    for (const effect of [...this.transient]) {
      const progress = Math.min(1, (now - effect.started) / effect.duration);
      effect.update(progress);
      if (progress >= 1) {
        this.transient = this.transient.filter(item => item !== effect);
        this.scene.remove(effect.object);
        effect.dispose();
      }
    }
    const selected = this.selected === null ? null : this.actors.get(this.selected);
    this.ring.visible = !!selected?.root.visible;
    if (selected) {
      this.ring.material.color.setHex(PLAYER_COLORS[selected.root.userData.owner] ?? 0xafa493);
      this.ring.position.copy(selected.root.position);
      this.ring.position.y = this.elevation(this.ring.position.x, this.ring.position.z) + 0.14;
    }
    this.orderRing.visible = now < this.orderUntil;
    if (this.orderRing.visible) {
      const progress = 1 - (this.orderUntil - now) / 1200;
      this.orderRing.scale.setScalar(1 + progress * 2);
      this.orderRing.material.opacity = 1 - progress;
    }
    if (!this.renderer) return;
    this.fog.setEyes(eyes);
    this.fog.renderLights(this.renderer);
    this.renderer.render(this.scene, this.camera);
  }

  resizeView(width: number, height: number): void {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(Math.max(1, width), Math.max(1, height));
  }

  setWorldSeed(seed: number): void {
    if (this.mapSeed === seed) return;
    this.mapSeed = seed;
    this.landscape?.dispose();
    this.landscape = null;
    this.terrainKey = "";
    this.focused = false;
  }

  fitWorld(): void {
    if (!this.controls || !this.size) return;
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const distance = this.size * 0.77 / Math.sin(Math.min(verticalFov, horizontalFov) / 2);
    this.controls.maxDistance = Math.max(180, distance * 1.1);
    this.controls.target.set(this.size / 2, this.elevation(this.size / 2, this.size / 2), this.size / 2);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(1, 1.05, 1).normalize().multiplyScalar(distance));
    this.controls.update();
  }

  zoomBy(factor: number): void {
    if (!this.controls) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.controls.update();
  }

  centerOnTile(horizontal: number, vertical: number): void {
    if (!this.controls) return;
    const target = new THREE.Vector3(THREE.MathUtils.clamp(horizontal + 0.5, 0, this.size), this.elevation(horizontal + 0.5, vertical + 0.5),
      THREE.MathUtils.clamp(vertical + 0.5, 0, this.size));
    this.camera.position.add(target.clone().sub(this.controls.target));
    this.controls.target.copy(target);
    this.controls.update();
  }

  centerOnFrac(horizontal: number, vertical: number): void {
    this.centerOnTile(horizontal * this.size - 0.5, vertical * this.size - 0.5);
  }

  getViewTileQuad(): { tx: number; ty: number }[] | null {
    if (!this.size) return null;
    this.camera.updateMatrixWorld();
    this.groundPlane.constant = -(this.controls?.target.y ?? 0);
    return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([horizontal, vertical]) => {
      this.raycaster.setFromCamera(new THREE.Vector2(horizontal, vertical), this.camera);
      const point = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3()) ?? this.controls!.target;
      return { tx: point.x - 0.5, ty: point.z - 0.5 };
    });
  }

  getViewFrac(): { x: number; y: number; w: number; h: number } | null {
    const quad = this.getViewTileQuad();
    if (!quad) return null;
    const left = THREE.MathUtils.clamp(Math.min(...quad.map(point => point.tx)) / this.size, 0, 1);
    const top = THREE.MathUtils.clamp(Math.min(...quad.map(point => point.ty)) / this.size, 0, 1);
    const right = THREE.MathUtils.clamp(Math.max(...quad.map(point => point.tx)) / this.size, 0, 1);
    const bottom = THREE.MathUtils.clamp(Math.max(...quad.map(point => point.ty)) / this.size, 0, 1);
    return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  }

  select(id: number | null): void { this.selected = id; }

  flashOrder(_playerIndex: number, groups: Parameters<MapController["flashOrder"]>[1]): void {
    const target = groups.find(group => group.target?.x !== undefined && group.target?.y !== undefined)?.target;
    if (target?.x === undefined || target.y === undefined) return;
    this.orderRing.position.set(target.x + 0.5, this.elevation(target.x + 0.5, target.y + 0.5) + 0.04, target.y + 0.5);
    this.orderUntil = performance.now() + 1200;
  }

  destroy(): void {
    this.dead = true;
    this.abort.abort();
    this.renderer?.setAnimationLoop(null);
    this.controls?.dispose();
    this.transient.forEach(effect => { this.scene.remove(effect.object); effect.dispose(); });
    this.transient = [];
    this.actors.forEach(actor => this.releaseActor(actor));
    const geometries = new Set<THREE.BufferGeometry>([this.box, this.sphere, this.cylinder, this.boulder, this.rod, this.ring.geometry, this.orderRing.geometry, ...this.ownedGeometry]);
    const materials = new Set<THREE.Material>([this.steel, this.dark, this.concrete, this.rust, this.skin, this.glow, this.vegetation, this.bone,
      this.matteClass, this.metalClass, ...this.plaster, this.trunk, ...this.canopy, ...this.paint, ...this.roofing, this.glass, this.fire, this.char,
      this.ring.material, this.orderRing.material, ...this.teamMaterials]);
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.assets.dispose();
    this.unitModels.dispose();
    this.landscape?.dispose();
    this.fog.dispose();
    this.debris?.dispose();
    this.smoke?.geometry.dispose();
    if (this.smoke) (this.smoke.material as THREE.Material).dispose();
    this.smokeTexture?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.scene.clear();
    this.actors.clear();
    this.chunks.clear();
    this.resources = [];
    this.renderer = null;
  }
}
