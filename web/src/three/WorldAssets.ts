import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export interface AnimatedCharacter {
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  moving: boolean;
  materials: THREE.Material[];
}

export class WorldAssets {
  private models = new Map<string, GLTF>();
  private textures = new Set<THREE.Texture>();
  private disposed = false;
  private environment: THREE.WebGLRenderTarget | null = null;
  ground = new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true });
  concrete = new THREE.MeshStandardMaterial({ color: 0x74766f, roughness: 0.95 });
  rock = new THREE.MeshStandardMaterial({ color: 0x9a9c98, roughness: 0.98, flatShading: true });
  private surfaceUniforms = { landscapeMap: { value: null as THREE.Texture | null }, landscapeSize: { value: 1 } };

  setLandscape(texture: THREE.Texture, size: number): void {
    this.surfaceUniforms.landscapeMap.value = texture;
    this.surfaceUniforms.landscapeSize.value = size;
  }

  async load(renderer: THREE.WebGLRenderer): Promise<void> {
    const environment = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    this.environment = generator.fromScene(environment, 0.04);
    environment.dispose();
    generator.dispose();
    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    // The only rigged asset: the human. Every machine is procedural (UnitModels).
    const jobs: Promise<void>[] = ["soldier"].map(async name => {
      const model = await loader.loadAsync(`/world/${name}.glb`);
      this.models.set(name, model);
      model.scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
        }
      });
    });
    for (const [name, material] of [["rubble", this.ground], ["concrete", this.concrete],
      ["rocky_terrain_02", this.rock]] as const) {
      for (const [channel, slot] of [["diff", "map"], ["nor_gl", "normalMap"], ["rough", "roughnessMap"]] as const) {
        jobs.push(textureLoader.loadAsync(`/world/${name}_${channel}.jpg`).then(texture => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          if (channel === "diff") texture.colorSpace = THREE.SRGBColorSpace;
          this.textures.add(texture);
          material[slot] = texture;
          material.needsUpdate = true;
        }));
      }
    }
    const results = await Promise.allSettled(jobs);
    if (this.disposed) this.dispose();
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    this.rock.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        float stoneGray = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(stoneGray), diffuseColor.rgb, 0.12);
      `);
    };
    this.ground.normalScale.set(0.65, 0.65);
    this.ground.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.surfaceUniforms);
      shader.vertexShader = "varying vec2 worldSurface;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\nworldSurface = position.xz;");
      shader.fragmentShader = "varying vec2 worldSurface;\nuniform sampler2D landscapeMap;\nuniform float landscapeSize;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        vec4 district = texture2D(landscapeMap, worldSurface / landscapeSize);
        float grit = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        // Asphalt keeps the scan's grain but goes dark and neutral; lane paint
        // is a worn off-white; weeds tint the dirt green.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grit * 0.09 + 0.028) * vec3(0.9, 0.93, 1.0), district.r * 0.95);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.52, 0.49, 0.40), district.g * 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.44, 0.65, 0.35), district.b * 0.62);
        // Scorched earth around the craters.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), district.a * 0.85);
        // The tile grid: a thin dark line on every tile edge that fades out
        // when a tile is only a few pixels wide (far camera).
        vec2 cell = abs(fract(worldSurface) - 0.5);
        vec2 slope = fwidth(worldSurface);
        vec2 edge = smoothstep(0.5 - slope * 1.8, 0.5 - slope * 0.5, cell);
        float gridLine = max(edge.x, edge.y) * clamp(1.0 - max(slope.x, slope.y) * 5.0, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - gridLine * 0.26;
      `);
    };
  }

  get environmentMap(): THREE.Texture | null { return this.environment?.texture ?? null; }

  /** A human from the rigged Soldier: the armed guard/recruit, or the unarmed
   *  survivor in weathered clothes with the visor gone. Machines never come
   *  from here - they are the procedural UnitModels library. */
  character(height: number, survivor = false): AnimatedCharacter {
    const source = this.models.get("soldier");
    if (!source) throw new Error("Character assets are not ready");
    const rig = clone(source.scene);
    const model = new THREE.Group();
    const materials: THREE.Material[] = [];
    model.add(rig);
    rig.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const weather = (base: THREE.Material) => {
        const material = base.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.multiply(new THREE.Color(survivor ? 0xb9a389 : 0x8d9980));
          material.roughness = 0.96;
          material.metalness = 0;
        }
        materials.push(material);
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(weather) : weather(object.material);
      if (survivor && object.name.toLowerCase().includes("visor")) object.visible = false;
    });
    const mixer = new THREE.AnimationMixer(rig);
    const idleClip = source.animations.find(clip => clip.name.toLowerCase() === "idle")!;
    const walkClip = source.animations.find(clip => clip.name.toLowerCase() === "walk")!;
    const idle = mixer.clipAction(idleClip).play();
    const walk = mixer.clipAction(walkClip);
    idle.time = Math.random() * idleClip.duration;
    mixer.update(0);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(rig, true);
    const scale = height / Math.max(0.01, bounds.max.y - bounds.min.y);
    model.scale.setScalar(scale);
    rig.position.y -= bounds.min.y;
    model.updateMatrixWorld(true);
    return { model, mixer, idle, walk, moving: false, materials };
  }

  animate(character: AnimatedCharacter, moving: boolean, speed: number, delta: number): void {
    if (character.moving !== moving) {
      const previous = character.moving ? character.walk : character.idle;
      const next = moving ? character.walk : character.idle;
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      previous.crossFadeTo(next, 0.22, false);
      character.moving = moving;
    }
    character.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 0.65, 0.3, 2.5));
    character.mixer.update(delta);
  }

  release(character: AnimatedCharacter): void {
    character.mixer.stopAllAction();
    character.mixer.uncacheRoot(character.mixer.getRoot());
    character.materials.forEach(material => material.dispose());
    character.model.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.environment?.dispose();
    this.environment = null;
    const materials = new Set<THREE.Material>();
    this.models.forEach(model => model.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    }));
    materials.forEach(material => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          value.dispose();
          if (typeof ImageBitmap !== "undefined" && value.image instanceof ImageBitmap) value.image.close();
        }
      }
      material.dispose();
    });
    this.textures.forEach(texture => texture.dispose());
    [this.ground, this.concrete, this.rock].forEach(material => material.dispose());
    this.models.clear();
    this.textures.clear();
  }
}
