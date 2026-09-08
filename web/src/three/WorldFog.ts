import * as THREE from "three";

/** One source of light in the fog: a unit or building the viewer owns.
 *  `x`/`z` are world (tile) coordinates of its centre, `radius` the vision
 *  radius in tiles. Units hand in their interpolated position every frame, so
 *  the light walks with the character instead of jumping tile by tile. */
export interface FogEye { x: number; z: number; radius: number; }

/** Light map pixels per tile. */
const DETAIL = 4;
/** How much of the darkness the explored (remembered) ground lifts. */
const EXPLORED = 0.2;

/** Fog of war as a light map. Every frame a top-down orthographic pass draws
 *  the viewer's memory (explored tiles, dim) and a soft round light around
 *  every eye into a render target; world materials multiply their colour by
 *  that map, so terrain, props, units, particles and markers all obey the
 *  same mask. God view keeps the map lit and only blacks out the exterior. */
export class WorldFog {
  private size = 1;
  private enabled = false;
  private target: THREE.WebGLRenderTarget | null = null;
  /** Explored-tile mask (one texel per tile, bilinear so the staircase melts). */
  explored = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private uniforms = {
    worldFogMap: { value: null as THREE.Texture | null },
    worldFogSize: { value: 1 },
    worldFogEnabled: { value: 0 },
    worldFogFloor: { value: 0 },
  };
  private materials = new WeakSet<THREE.Material>();
  private lightScene = new THREE.Scene();
  private lightCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private base: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private lights: THREE.InstancedMesh | null = null;
  private lightGeometry = new THREE.PlaneGeometry(2, 2);
  private lightMaterial = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float fogInner;
      varying vec2 vUv;
      varying float vInner;
      void main() {
        vUv = uv;
        vInner = fogInner;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      varying float vInner;
      void main() {
        float distanceToEye = length(vUv * 2.0 - 1.0);
        float light = 1.0 - smoothstep(vInner, 1.0, distanceToEye);
        gl_FragColor = vec4(vec3(light), 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
  });
  private eyes: FogEye[] = [];
  private clearColor = new THREE.Color();
  private matrix = new THREE.Matrix4();

  constructor() {
    this.explored.minFilter = this.explored.magFilter = THREE.LinearFilter;
    this.explored.needsUpdate = true;
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { exploredMap: { value: this.explored }, exploredLevel: { value: EXPLORED }, texel: { value: 1 } },
      vertexShader: "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        uniform sampler2D exploredMap;
        uniform float exploredLevel;
        uniform float texel;
        varying vec2 vUv;
        void main() {
          // A box of four bilinear taps: the tile staircase of the memory
          // becomes a two-tile ramp with rounded corners.
          float memory = (texture2D(exploredMap, vUv + vec2(texel, texel) * 0.5).r
            + texture2D(exploredMap, vUv + vec2(-texel, texel) * 0.5).r
            + texture2D(exploredMap, vUv + vec2(texel, -texel) * 0.5).r
            + texture2D(exploredMap, vUv + vec2(-texel, -texel) * 0.5).r) * 0.25;
          gl_FragColor = vec4(vec3(smoothstep(0.0, 1.0, memory) * exploredLevel), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.base.frustumCulled = false;
    this.lightScene.add(this.base);
  }

  get texture(): THREE.Texture | null { return this.target?.texture ?? null; }

  /** Per-turn state: is the mask on (a player's or the union perspective), and
   *  which tiles has that perspective explored. */
  update(size: number, enabled: boolean, explored: Set<number> | null): void {
    if (size !== this.size || !this.target) {
      this.size = size;
      this.target?.dispose();
      const pixels = Math.min(1024, Math.max(64, size * DETAIL));
      this.target = new THREE.WebGLRenderTarget(pixels, pixels, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
      });
      this.uniforms.worldFogMap.value = this.target.texture;
      this.uniforms.worldFogSize.value = size;
      this.explored.dispose();
      this.explored = new THREE.DataTexture(new Uint8Array(size * size * 4), size, size);
      this.explored.minFilter = this.explored.magFilter = THREE.LinearFilter;
      this.base.material.uniforms.exploredMap.value = this.explored;
      this.base.material.uniforms.texel.value = 1 / size;
      this.base.geometry.dispose();
      this.base.geometry = new THREE.PlaneGeometry(size, size);
      this.base.position.set(size / 2, size / 2, 0);
      this.lightCamera.left = 0;
      this.lightCamera.right = size;
      this.lightCamera.top = size;
      this.lightCamera.bottom = 0;
      this.lightCamera.updateProjectionMatrix();
    }
    this.enabled = enabled;
    this.uniforms.worldFogEnabled.value = enabled ? 1 : 0;
    const data = this.explored.image.data as Uint8Array;
    for (let tile = 0; tile < size * size; tile++) {
      const known = !explored || explored.has(tile) ? 255 : 0;
      data.set([known, known, known, 255], tile * 4);
    }
    this.explored.needsUpdate = true;
  }

  /** Where the light comes from this frame. */
  setEyes(eyes: FogEye[]): void { this.eyes = eyes; }

  /** Draw the light map. Call once per frame before the world itself. */
  renderLights(renderer: THREE.WebGLRenderer): void {
    if (!this.target || !this.enabled) return;
    const count = this.eyes.length;
    if (!this.lights || (this.lights.instanceMatrix.count < count)) {
      this.lights?.removeFromParent();
      this.lights?.dispose();
      const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
      const geometry = this.lightGeometry.clone();
      geometry.setAttribute("fogInner", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      this.lights = new THREE.InstancedMesh(geometry, this.lightMaterial, capacity);
      this.lights.frustumCulled = false;
      this.lights.renderOrder = 1;
      this.lightScene.add(this.lights);
    }
    const inner = this.lights.geometry.getAttribute("fogInner") as THREE.InstancedBufferAttribute;
    this.eyes.forEach((eye, index) => {
      // Full light out to (radius - 1.4) tiles, gone at (radius + 0.6): the
      // same soft lamp the classic 2D map draws around every eye.
      const outer = Math.max(0.8, eye.radius + 0.6);
      this.matrix.makeScale(outer, outer, 1).setPosition(eye.x, eye.z, 0);
      this.lights!.setMatrixAt(index, this.matrix);
      inner.setX(index, THREE.MathUtils.clamp((eye.radius - 1.4) / outer, 0, 0.95));
    });
    this.lights.count = count;
    this.lights.instanceMatrix.needsUpdate = true;
    inner.needsUpdate = true;
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColor);
    const previousAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = true;
    renderer.render(this.lightScene, this.lightCamera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, previousAlpha);
    renderer.autoClear = previousAutoClear;
  }

  /** Light level (0..1) the map holds at a world position; 1 with the mask off. */
  sample(renderer: THREE.WebGLRenderer, x: number, z: number): number {
    if (!this.target || !this.enabled) return 1;
    const pixels = this.target.width;
    const column = THREE.MathUtils.clamp(Math.floor(x / this.size * pixels), 0, pixels - 1);
    const row = THREE.MathUtils.clamp(Math.floor(z / this.size * pixels), 0, pixels - 1);
    const buffer = new Uint8Array(4);
    renderer.readRenderTargetPixels(this.target, column, row, 1, 1, buffer);
    return buffer[0] / 255;
  }

  /** Mask every material under `root`. `floor` is the darkest the object may
   *  get: things the rules already gate by tile (units, effects, wrecks) keep a
   *  readable silhouette where the round light has faded but the square rule
   *  still says "seen"; the ground and its props go fully black. */
  apply(root: THREE.Object3D, floor = 0): void {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)) return;
      object.onBeforeRender = () => { this.uniforms.worldFogFloor.value = floor; };
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.material(material);
    });
  }

  private material(material: THREE.Material): void {
    if (this.materials.has(material)) return;
    this.materials.add(material);
    const original = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      original.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 fogWorldXZ;\n" + shader.vertexShader;
      const coordinate = `
        vec4 fogPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogPosition = instanceMatrix * fogPosition;
        #endif
        fogWorldXZ = (modelMatrix * fogPosition).xz;
      `;
      if (shader.vertexShader.includes("#include <project_vertex>")) {
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n" + coordinate);
      } else {
        shader.vertexShader = shader.vertexShader.replace("void main() {", "void main() {\nfogWorldXZ = modelMatrix[3].xz;");
      }
      shader.fragmentShader = "uniform sampler2D worldFogMap;\nuniform float worldFogSize;\nuniform float worldFogEnabled;\nuniform float worldFogFloor;\nvarying vec2 fogWorldXZ;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <fog_fragment>", `
        #include <fog_fragment>
        vec2 fogUV = fogWorldXZ / worldFogSize;
        float insideWorld = step(0.0, fogUV.x) * step(0.0, fogUV.y) * step(fogUV.x, 1.0) * step(fogUV.y, 1.0);
        float fogLight = mix(1.0, max(texture2D(worldFogMap, fogUV).r, worldFogFloor), worldFogEnabled);
        gl_FragColor.rgb *= fogLight * insideWorld;
      `);
    };
    material.customProgramCacheKey = () => `${cacheKey}:integral-world-fog-v2`;
    material.needsUpdate = true;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.explored.dispose();
    this.lights?.dispose();
    this.lights = null;
    this.lightGeometry.dispose();
    this.lightMaterial.dispose();
    this.base.geometry.dispose();
    this.base.material.dispose();
  }
}
