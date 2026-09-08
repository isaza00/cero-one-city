import { expect, test } from "@playwright/test";

test("3D preview renders, moves, respects fog, and releases its canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/world-renderer-harness", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body></body></html>",
  }));
  await page.goto("/world-renderer-harness");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/three/WorldRenderer.ts";
    const { WorldRenderer } = await import(/* @vite-ignore */ modulePath);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#171e20";
    document.body.append(host);
    const renderer = new WorldRenderer();
    await renderer.init(host, 960, 640);
    const size = 16;
    const tiles = Array.from({ length: size }, () => Array<string>(size).fill("plain"));
    tiles[5][5] = "blocked";
    tiles[6][5] = "pod";
    tiles[7][5] = "vein";
    tiles[8][5] = "rubble";
    const state = {
      turn: 0, size, format: "1v1", max_turns: 100, tiles, veins: {}, scrap: {},
      finished: false, winner: null,
      players: [{ id: 0, lineage: "forge", explored: [0], energy: 0, metal: 0,
        techs: [], firmware: "v1", alive: true, eliminated_turn: null, damage_dealt: 0 }],
      entities: {
        "1": { id: 1, owner: 0, kind: "unit", type: "striker", x: 3, y: 3, hp: 30 },
        "2": { id: 2, owner: 1, kind: "unit", type: "human", x: 15, y: 15, hp: 15 },
        "3": { id: 3, owner: 0, kind: "building", type: "core", x: 2, y: 5, hp: 450 },
      },
    };
    renderer.render(state, 0);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const hiddenEnemy = !renderer.actors.get(2).root.visible;
    const ownVisible = renderer.actors.get(1).root.visible;
    const rigged = renderer.actors.get(1).unitModel.model.userData.articulation && !!renderer.actors.get(2).character;
    const normalized = renderer.actors.get(1).unitModel.model.scale.y < 2
      && renderer.actors.get(2).character.model.scale.y < 2;
    const terrainPositions = renderer.tiles.geometry.attributes.position;
    const heights = Array.from({ length: terrainPositions.count }, (_, index) => terrainPositions.getY(index));
    // Flat suburb with faint undulation: not a plane, not a sea swell either.
    const variedHeight = Math.max(...heights) - Math.min(...heights) > 0.15;
    const nonEmptyFrame = renderer.renderer.info.render.triangles > 100;
    await new Promise(resolve => setTimeout(resolve, 1000));
    state.turn = 1;
    state.entities["1"].x = 4;
    renderer.render(state, null);
    await new Promise(resolve => setTimeout(resolve, 400));
    const moved = renderer.actors.get(1).root.position.x > 3.5;
    const revealedEnemy = renderer.actors.get(2).root.visible;
    const walking = Math.abs(renderer.actors.get(1).unitModel.model.getObjectByName("hip-0").rotation.x) > 0.001;
    state.turn = 2;
    renderer.render({ ...state, events_last_turn: [{ type: "attack", attacker: 1, target: 2,
      src: [4, 3], dst: [15, 15], ranged: true, attacker_type: "launcher" }] }, null);
    const combat = renderer.transient.length > 0;
    // Column x=5 is solid from row 5 to 8: a walk from (4,6) to (6,6) has to go
    // round it, never through it.
    state.turn = 3;
    state.entities["1"].y = 6;
    renderer.render(state, null);
    await new Promise(resolve => setTimeout(resolve, 100));
    state.turn = 4;
    state.entities["1"].x = 6;
    renderer.render(state, null);
    const route = renderer.actors.get(1).path as { x: number; z: number }[];
    const detours = route.length > 2 && route.every(point =>
      !(Math.floor(point.x) === 5 && Math.floor(point.z) >= 5 && Math.floor(point.z) <= 8));
    // Death: the body stays in the scene, tips over and only then goes away.
    const enemy = state.entities["2"];
    const corpse = renderer.actors.get(2).root;
    state.turn = 5;
    delete state.entities["2"];
    renderer.render(state, null);
    await new Promise(resolve => setTimeout(resolve, 450));
    const dying = renderer.transient.some((effect: { object: unknown }) => effect.object === corpse)
      && corpse.parent === renderer.scene && renderer.actors.get(2) === undefined
      && Math.max(Math.abs(corpse.children[0].rotation.x), Math.abs(corpse.children[0].rotation.z)) > 1;
    state.entities["2"] = enemy;
    renderer.select(1);
    renderer.centerOnTile(4, 4);
    renderer.resizeView(800, 500);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const selected = renderer.ring.visible;
    const quad = renderer.getViewTileQuad();
    const finiteQuad = quad.length === 4 && quad.every((point: { tx: number; ty: number }) =>
      Number.isFinite(point.tx) && Number.isFinite(point.ty));
    renderer.fitWorld();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const overviewVisible = renderer.scene.fog.density * renderer.camera.position.distanceTo(renderer.controls.target) < 0.5;
    const exteriorBlack = renderer.scene.background.getHex() === 0 && renderer.scenery.children.length === 0;
    renderer.render(state, 0);
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    // The light map: black where nobody has been, lit around the striker,
    // and round: a tile diagonally past its radius is dark although the
    // square rule would still cover it.
    const hiddenMask = renderer.fog.sample(renderer.renderer, 15.5, 15.5) === 0
      && renderer.fog.sample(renderer.renderer, 6.5, 6.5) > 0.9;
    const fullFog = renderer.actors.get(1).unitModel.model.getObjectByName("chassis").children
      .some((part: { material?: { customProgramCacheKey: () => string } }) => part.material?.customProgramCacheKey().includes("integral-world-fog"));
    renderer.render({ ...state, turn: 0 }, null);
    const rewindSnaps = renderer.actors.get(1).duration === 0;
    renderer.destroy();
    const cleanedUp = host.querySelectorAll("canvas").length === 0;
    host.remove();
    return { hiddenEnemy, ownVisible, rigged, normalized, variedHeight, nonEmptyFrame, moved, revealedEnemy, walking, combat,
      detours, dying, selected, finiteQuad, overviewVisible, exteriorBlack, hiddenMask, fullFog, rewindSnaps, cleanedUp };
  });
  expect(result).toEqual({ hiddenEnemy: true, ownVisible: true, rigged: true, normalized: true, variedHeight: true,
    nonEmptyFrame: true, moved: true, revealedEnemy: true, walking: true, combat: true, detours: true, dying: true,
    selected: true, finiteQuad: true, overviewVisible: true, exteriorBlack: true, hiddenMask: true, fullFog: true,
    rewindSnaps: true, cleanedUp: true });
  expect(errors).toEqual([]);
});

test("replay defaults to 3D and can switch renderers without duplicate canvases", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const size = 16;
  const tiles = Array.from({ length: size }, (_, vertical) => Array.from({ length: size }, (_, horizontal) =>
    vertical === 7 && horizontal > 7 && horizontal < 13 ? "blocked" : "plain"));
  tiles[6][5] = "pod";
  tiles[4][5] = "vein";
  const state = {
    turn: 0, size, format: "1v1", max_turns: 100, tiles, veins: { "5,4": 200 }, pods: { "5,6": 200 }, scrap: {},
    finished: false, winner: null, players: [],
    entities: {
      "1": { id: 1, owner: 0, kind: "unit", type: "striker", x: 7, y: 5, hp: 25 },
      "2": { id: 2, owner: 1, kind: "unit", type: "human", x: 6, y: 5, hp: 15 },
      "3": { id: 3, owner: 0, kind: "building", type: "core", x: 3, y: 3, hp: 450 },
      "4": { id: 4, owner: 0, kind: "building", type: "lab", x: 3, y: 7, hp: 80 },
      "5": { id: 5, owner: 0, kind: "unit", type: "wasp", x: 8, y: 6, hp: 20 },
    },
  };
  await page.route("**/api/matches/visual-test**", route => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/replay") ? { turns_available: [0] }
      : path.includes("/turns/") ? { turn_number: 0, state, feed: [] } : { players: [] };
    return route.fulfill({ json });
  });
  await page.goto("/matches/visual-test/replay");
  const canvas = page.locator(".map-surface canvas");
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute("aria-label", /^3D battlefield/);
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.screenshot({ path: testInfo.outputPath("world-replay.png") });
  await page.getByRole("button", { name: "Classic 2D" }).click();
  await expect(page.getByRole("button", { name: "Enter 3D" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(canvas).toHaveCount(1);
  await page.getByRole("button", { name: "Enter 3D" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute("aria-label", /^3D battlefield/);
  expect(errors).toEqual([]);
});
