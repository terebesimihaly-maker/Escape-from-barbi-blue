/* Escape from Barbi Blue: Building a floor in 3D: floor, walls, ceiling, wardrobes, the exit door, notes and footprints (the puzzles: js/puzzles.js).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- building a floor ---------- */
const TEX_KEYS = ['map', 'emissiveMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'lightMap', 'alphaMap', 'envMap'];
function disposeLevel() {
  if (!level) return;
  if (level.house) level.house.dispose();
  if (level.atmos) level.atmos.dispose();                  // (the shafts, motes, near layer: js/atmos.js)
  if (level.surface) level.surface.dispose();              // (the decals' and prints' own geometry and textures: js/surface.js)
  scene.remove(level.group);
  const seen = new Set();
  // (a texture marked shared outlives the floor: the portraits painted in Blender, loaded once for every floor)
  // (nor MatLib's 1-pixel stand-ins, which every floor's materials share: js/matlib.js)
  const tex = t => { if (t && t !== glowTex && !t.userData.shared && !t.userData.mlStandIn && !seen.has(t)) { seen.add(t); t.dispose(); } };
  const mat = m => { if (!m || seen.has(m) || m.userData.shared) return; seen.add(m);   // (shared: the kit's own, left on a module's wall part)
    for (const k of TEX_KEYS) tex(m[k]);
    if (m.userData) { tex(m.userData.overlay); if (m.userData.disposables) m.userData.disposables.forEach(tex); }
    m.dispose(); };
  level.group.traverse(o => {
    const u = o.userData;                                  // (copies of a loaded model: the model keeps its geometry, materials and textures)
    if (u.shared || u.sharedGeo || u.kit) return;
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mat);
  });
  // (not always in the scene: a changer's second picture until it has changed, the exit door's open look until it opens)
  if (level.paintings) for (const p of level.paintings) if (p.mat) mat(p.mat);
  if (level.door && !level.door.kit) { mat(level.door.openMat); mat(level.door.lockedMat); }   // (the kit's door frees its own: js/kit.js)
  // the architecture's own geometry and instance buffers (js/arch.js); the kit's pieces in it stay (H21)
  if (level.arch) level.arch.dispose();
  // (and its materials: some sit only on the kit's pieces, which the traversal above leaves alone)
  if (level.archOpts) for (const m of Object.values(level.archOpts.materials)) mat(m);
  if (typeof MatLib !== 'undefined') MatLib.releaseLevel();   // (the level's lightmaps and overlays, back to the stand-ins)
  level = null;
}
function buildLevel() {
  disposeLevel(); evictSurfaces(floorIdx);
  const F = FLOORS[floorIdx], G = new THREE.Group(), L = TILE_M;
  level = { grid, group: G, door: null, prints: null, plan: null, arch: null };
  // the house's shell: from the floor's plan (js/dress.js), the walls at their real heights, the ceilings and their steps and gables,
  // the mouldings, beams, doorways with their leaves, and the kit's doors, windows, fireplaces and holes (js/arch.js). Without those
  // files (or if the plan fails) the old flat walls and ceiling stand in
  const plan = floorPlan(), lit = !!plan && typeof MatLib !== 'undefined';   // (lit: the baked light and MatLib's materials, below)
  if (lit) MatLib.tier = settings.quality;
  // the floor: with the plan, MatLib's (the baked lamps and moonlight, js/surface.js's overlays: dust, wet, corner shade, decals),
  // the painted boards standing in until the Blender ones load; else the painted floor, its own picture doubling as its relief
  const ftx = floorTexture(F, lit), fRough = { wood: 0.5, tile: 0.28, concrete: 0.85 }[floorKind(F)], fCol = new THREE.Color().setScalar(floorKind(F) === 'tile' ? 2.6 : 1.8);
  const floorMat = lit ? MatLib.floorMaterial({ map: ftx, GW: 1, GH: 1, roughness: fRough, color: fCol, env: envTex(F.style) || undefined })
    : new THREE.MeshStandardMaterial({ map: ftx, bumpMap: ftx, bumpScale: 2.5, roughness: fRough, metalness: 0, color: fCol });
  if (lit) ftx.dispose();                                   // (MatLib keeps its own copy of it, same picture)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(GW * L, GH * L), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(GW * L / 2, 0, GH * L / 2); floor.receiveShadow = true; G.add(floor);
  let faces, walls = null, ceil = null, wallMat;
  if (plan) { level.plan = plan; faces = plan.faces; wallMat = buildArch(F, plan, G).wall; }
  else {
    const ct = ceilingTexture(F); ct.repeat.set(GW, GH);
    ceil = new THREE.Mesh(new THREE.PlaneGeometry(GW * L, GH * L), new THREE.MeshLambertMaterial({ map: ct, bumpMap: ct, bumpScale: 2 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(GW * L / 2, WALL_H, GH * L / 2); G.add(ceil);
    faces = [];
    const wallTx = wallTexture(F);
    walls = new THREE.Mesh(wallGeometry(faces), new THREE.MeshLambertMaterial({ map: wallTx, bumpMap: wallTx.userData.bump, bumpScale: 3,
      vertexColors: true, color: new THREE.Color().setScalar(wallKind(F) === 'tile' ? 2.2 : wallKind(F) === 'attic' ? 1.4 : 1) }));
    walls.castShadow = walls.receiveShadow = true; G.add(walls); walls.material.userData.wallSurface = true; wallMat = walls.material;
  }
  // the floor's kit (the one buildArch used, so the shell and the furniture agree), and whether it furnishes the band decor (KIT_BAND_MIN)
  const kit = typeof Kit === 'undefined' ? null : plan ? level.archKit : Kit.get(F.style), kitBand = kitFurnishesBand(kit, plan);
  // the house around the maze: lamps, rugs, and (the fallback, when the kit doesn't furnish the walls) furniture and props
  // (js/house.js; without the plan its woodwork and doorways too)
  const pzFaces = puzzleFaces(), onPuzzleFace = f => pzFaces.has(f.x + ',' + f.y + ',' + f.nx + ',' + f.nz);   // (walls with a labyrinth box)
  const keep = new Set([...closets.map(c => Math.floor(c.x / T) + ',' + Math.floor(c.y / T)), exit.tx + ',' + exit.ty]);
  level.house = House.build(THREE, { style: F.style, L, H: WALL_H, GW, GH, isWall, faces, keep, wallMat, hash, toTex, glowTex, doll: dollTemplate || null,
    furnished: kitBand, lamps: plan ? fallbackLamps(kit, plan) : undefined, dolls: plan ? plan.dolls : null, clear: clearOfSolids,
    exitFace: plan ? null : faces.find(isExitFace), arch: !!plan, doorKeys: plan ? plan.doorKeys : null, ceilXZ: plan && typeof ceilAtXZ === 'function' ? ceilAtXZ : null,
    ceilKeep: plan ? new Set(plan.modules.filter(m => m.face < 0 && m.kind !== 'ceilingrose').map(m => m.x + ',' + m.y)) : null,
    decorFace: plan ? f => f.busy.includes('decor') || f.busy.includes('puzzle') : f => onPuzzleFace(f) || hash(f.x * 7 + f.nx, f.y * 7 + f.nz, 91) < F.frames + 0.045,
    quality: settings.quality, lowq: LOWQ });
  G.add(level.house.group);
  if (level.house.beam) { level.house.beam.position.copy(flash.position); camera.add(level.house.beam); }
  wallDecor(G, F, faces, level.house.doorTiles, f => onPuzzleFace(f) || isExitFace(f), plan);   // (no picture on the exit door's wall)
  // the wardrobes: the kit's (Kit.wardrobe, the same hinges and c.doors as makeWardrobe), else the painted ones
  let wt = null;
  for (const c of closets) G.add((kit && Kit.wardrobe(c, F.style, { kit, placeholders: false })) || makeWardrobe(c, wt || (wt = wardrobeMaterials())));
  if (!kitExit(level, level.archKit)) makeExit(G);
  // the furniture you bump into (SOLIDS, js/layout.js), every box exactly on its footprint (H5), and the band decor along the walls,
  // from the kit (js/kit.js; see KIT_BAND_MIN for what is real and what stands in)
  if (typeof Kit !== 'undefined') { Kit.furnish(level, plan || { style: F.style, floorIdx }, furnishOpts(F, kit, kitBand)); level.house.kitCount = level.kit.kitCount; }
  upgradeSurfaces(F, floor.material, G, walls, faces, ceil);   // (the surfaces baked in Blender, when they've loaded: tools/blender/kit/surfaces2.py)
  buildPuzzles3D(G);                                     // the labyrinth boxes on the walls (js/puzzles.js)
  notes.forEach(n => { const o = makeNote(n); n.obj = o; G.add(o); });
  if (boardsTemplate) for (const b of creaks) G.add(makeBoard(b));    // (the loose floorboards, in 3D; otherwise painted on the floor)
  level.prints = makePrints(); G.add(level.prints);
  if (lit) lightLevel(level, F);                         // the light: baked lamps, moonlight, the floor's overlays, the night outside (below)
  uploadKitTextures(G);                                  // (now, while the floor is being built, not the first time each piece comes into view)
  scene.add(G);
}

/* ---------- the house's shell from the floor's plan (js/dress.js, js/arch.js, spec E2 step 3-4) ---------- */
function floorPlan() {
  if (typeof Dress === 'undefined' || typeof Arch === 'undefined' || typeof LightBaker === 'undefined') return null;
  try { return Dress.plan(Dress.envFromGame()); } catch (e) { console.error('Dress.plan', e); return null; }
}
const BAKE_TIER = { low: 'lo', medium: 'md', high: 'hi' };
// Builds the shell with the floor's kit when it has loaded (Kit.get: doors, windows, fireplaces, holes, the exit's porch), else with
// procedural doorways and every face kept (E7); a kit that arrives during the floor rebuilds the shell alone (lateKit). Returns the materials.
function buildArch(F, plan, G) {
  const kit = typeof Kit !== 'undefined' ? Kit.get(F.style) : null, B = Dress.bakeInput(plan, Dress.envFromGame(), LIGHT_DATA.data || undefined);
  // (the wall faces' cells in the light atlas, uv1: the same ones LightBaker.bake will give, for the bake's tier)
  const tier = BAKE_TIER[settings.quality] || 'lo', atlas = LightBaker.packAtlas(B.faces, tier, LightBaker.faceHeights(B, B.faces));
  const materials = archMaterials(F, plan);
  level.archOpts = { bake: B, cells: atlas.cells, tier, materials, windows: true, lightData: !!LIGHT_DATA.data };
  level.arch = Arch.build(plan, kit, level.archOpts); level.archKit = kit; sheerVeils(level.arch.group);
  G.add(level.arch.group);
  if (typeof Kit !== 'undefined') {
    // (no eviction here yet: Kit.furnish does it on floor entry once the furniture comes from the kit, WP2.3)
    const next = FLOORS[floorIdx + 1];
    if (next) floorAssets(floorIdx + 1);                   // (the next floor's, fetched while you play this one)
    const lv = level;
    if (!kit) Kit.want(F.style).then(k => { if (k && level === lv && !lv.archKit) lateKit(lv, k); });   // (the shell, then the furniture)
  }
  return materials;
}
// The lace behind a window's curtains (Kit_*_curtain_veil) is drawn with the curtain's own picture, whose lace is about 70% opaque:
// lit by the flashlight it hid the window like a patterned wall. A sheer net lets the night through; the kit's material, changed once.
// And the window frames' glossy paint: right in the flashlight's hot spot the glazing bars threw a highlight that bloomed into a
// glowing cross over the pane; satin paint (a fixed roughness) keeps them plainly lit.
function sheerVeils(root) {
  root.traverse(o => { if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || m.userData.sheer) continue;
      if (/_veil$/.test(m.name || '')) { m.userData.sheer = true; m.transparent = true; m.opacity = 0.2; m.depthWrite = false; if (m.color) m.color.multiplyScalar(0.65); }
      else if (/^Kit_Win_.*_frame$/.test(m.name || '') && m.isMeshStandardMaterial) { m.userData.sheer = true; m.roughnessMap = null; m.roughness = 0.7; m.needsUpdate = true; }
    } });
}
// The floor's kit came after the floor was built (multiplayer, a slow connection): the shell again with it, compiled off screen first
// (no stutter, H13), then swapped in. Nothing else is rebuilt: the boards, the paintings and scares.doll stay (E4, brief B11).
function lateKit(lv, kit) {
  const A = Arch.build(lv.plan, kit, lv.archOpts); sheerVeils(A.group);
  if (lv.light) MatLib.withLightField(A.group);             // (the kit's frames, doors and curtains lit where they stand, like the rest)
  const swap = () => {
    if (level !== lv || lv.archKit) { A.dispose(); return; }
    lv.arch.dispose(); lv.arch = A; lv.archKit = kit; lv.group.add(A.group);
    const old = lv.door;
    if (old && !old.kit && kitExit(lv, kit)) {               // (the kit's exit door in place of the painted one, open if it was)
      for (const m of [old.door, old.lamp]) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); }
      for (const m of new Set([old.lockedMat, old.openMat, old.lamp.material])) { if (m.map) m.map.dispose(); if (m.bumpMap) m.bumpMap.dispose(); m.dispose(); }
      if (old.open) lv.door.setOpen(true, 10);
    }
    lv.compiled = false;
    if (lv.light) {                                         // (the windows are open now: their moonlight in again, spec E4, and the night)
      bakeLight(lv); if (lv.atmos) lv.atmos.dispose(); lv.atmos = buildAtmos(lv); }
    // then the furniture: the kit's pieces in place of the stand-ins, the kit's wardrobes in place of the painted ones (open as far
    // as they were), the band decor if the kit has it (house.js drops its props then: level.house.upgrade); compiled first too
    if (lv.kit) Kit.upgradeAsync(lv, lv.plan, { kit, band: kitFurnishesBand(kit, lv.plan), exitDoor: false })
      .then(R => { if (R && level === lv) { if (lv.house) lv.house.kitCount = R.kitCount; lv.compiled = false; uploadKitTextures(lv.group, true);
        if (lv.light) { MatLib.withLightField(R.group); lv.light.fix = null; } } });
  };
  if (renderer.compileAsync) renderer.compileAsync(A.group, camera, scene).then(swap, swap); else swap();
}

/* ---------- the furniture from the kit (js/kit.js) and what stands in for the art it doesn't have yet ----------
   The rule (WP4.1), decided by the manifest (models/kit/manifest.json: a node with placeholder: true is a grey stand-in, not art):
   - Boxes you bump into (SOLIDS: the gameplay truth, js/layout.js) go PER ITEM: the kit's model where it has real art for that
     node; otherwise (the manifest still marks it a stand-in, or the kit hasn't loaded) a procedural stand-in of the box's exact
     footprint and height: a dust sheet thrown over it, or a bare post, column or chimney breast for the ones that hold the roof. Never
     a grey box in play, and still nothing solid is invisible (H5). Each piece turns real as soon as its art is in the manifest.
   - The band decor along the walls (no collision) goes PER FLOOR: the kit furnishes it when it has real art for at least
     KIT_BAND_MIN of the plan's pieces (the few without are left out); then house.js places no furniture or props of its own (only
     its lamps, rugs, puddles and pipes). Below that, the kit places none and house.js's old props are the fallback, as without a
     kit: half a wall of real pieces beside half a wall of procedural ones would look worse than either.
   - Lamps are the kit's (fixtures: the plan's lamps, js/dress.js, with their emission profiles: js/lightbake.js bakes their light);
     house.js hangs plain stand-ins only for lamps the kit has no art for (or before it has loaded). Windows are Arch's.
   With the manifest as it is now, all five floors are furnished from the kit (only three common band pieces are still grey: they are
   left out); the stand-ins show only while a floor's kit is still loading, or for pieces a later manifest marks grey again. */
const KIT_BAND_MIN = 0.8;
// The kit's pictures go to the graphics card when a floor is built (renderer.initTexture, E2 step 13), not the first frame each piece is
// seen: with many of them that first frame is a hitch, worst on slow (software) renderers. Each texture once (the kit's are shared
// between floors); spread: a few per frame when the kit came late, during play.
const KIT_UPLOADED = new WeakSet();
function uploadKitTextures(root, spread) {
  if (!renderer || !renderer.initTexture) return;
  const list = [];
  root.traverse(o => { if (!o.userData.kit || !o.material) return;
    for (const m of [].concat(o.material)) for (const k of TEX_KEYS) { const t = m && m[k]; if (t && t.isTexture && !KIT_UPLOADED.has(t)) { KIT_UPLOADED.add(t); list.push(t); } } });
  const lv = level, step = () => { for (let n = 0; n < (spread ? 2 : list.length) && list.length; n++) renderer.initTexture(list.shift());
    if (list.length && level === lv) requestAnimationFrame(step); };
  step();
}
function kitFurnishesBand(kit, plan) { return !!(kit && plan && typeof Kit !== 'undefined' && Kit.covers(kit, plan, { placeholders: false }) >= KIT_BAND_MIN); }
function furnishOpts(F, kit, band) {
  return { kit, placeholders: false, windows: false, fixtures: true, band, standIn: (s, it, tier) => standInLook(F.style, s, tier),
    glassMat: typeof MatLib !== 'undefined' ? pieceGlass(F.style) : undefined };
}
// the glass of the kit's pieces (bell jars, cabinet doors, lanterns; the windows have js/atmos.js's, with rain on it): clear, thin, with the
// room's own reflections in it (textures/env/<style>.webp) instead of the night sky; one per style, kept (shared)
const PIECE_GLASS = {};
function pieceGlass(style) {
  if (PIECE_GLASS[style]) return PIECE_GLASS[style];
  const env = envTex(style), m = new THREE.MeshStandardMaterial({ name: 'KitGlass', color: 0xd4dce4, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.14,
    depthWrite: false, envMap: env || null, envMapIntensity: 0.6 });
  m.userData.shared = true; m.userData.kit = true;
  return env ? (PIECE_GLASS[style] = m) : m;                // (made again until the picture is in: a later swap would change its program)
}
// (house.js's props keep out of the boxes you bump into: a prop of radius rm at (xm, zm) m)
function clearOfSolids(xm, zm, rm) {
  for (const s of SOLIDS) if (xm + rm > s.x0 * S && xm - rm < s.x1 * S && zm + rm > s.y0 * S && zm - rm < s.y1 * S) return false;
  return true;
}
// a stand-in's look: {geo, mat}, a unit box's footprint ([-0.5, 0.5] across, 0..1 up) that Kit.furnish scales to the box; made once and
// kept (marked shared: no floor frees them), per style and tier
const STAND_IN = new Map();
function standInLook(style, s, tier) {
  const kind = /post|column|stanchion|pier|chimney/.test(s.id || '') ? (/steel|stanchion/.test(s.id) ? 'steel' : /pier|chimney/.test(s.id) ? 'brick' : /column/.test(s.id) ? 'plaster' : 'beam')
    : 'sheet', lo = tier === 'lo', key = style + '|' + kind + '|' + (lo ? 'lo' : 'md');
  if (STAND_IN.has(key)) return STAND_IN.get(key);
  const mark = o => { o.userData.shared = true; o.userData.kit = true; return o; };
  const geoKey = kind === 'sheet' ? 'sheet' : 'box';
  if (!STAND_IN.has(geoKey)) STAND_IN.set(geoKey, mark(kind === 'sheet' ? sheetGeometry() : new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)));
  const tex = c => { const t = toTex(c, true); t.userData.shared = true; return t; };
  const o = kind === 'sheet' ? { map: tex(sheetCanvas(style === 'workshop' ? '#766c5c' : '#a29a8a')), roughness: 0.95 }
    : kind === 'brick' ? { map: tex(brickCanvas()), roughness: 0.9 } : kind === 'steel' ? { color: 0x34302c, roughness: 0.55, metalness: 0.6 }
    : kind === 'plaster' ? { color: 0x8a8278, roughness: 0.9 } : { map: tex(postCanvas()), roughness: 0.8 };
  const mat = mark(lo ? new THREE.MeshLambertMaterial({ map: o.map || null, color: o.color !== undefined ? o.color : 0xffffff })
    : new THREE.MeshStandardMaterial(Object.assign({ metalness: 0 }, o)));
  mat.name = 'StandIn_' + kind;
  if (typeof MatLib !== 'undefined' && MatLib.withLightField) MatLib.withLightField(mat);
  const look = { geo: STAND_IN.get(geoKey), mat }; STAND_IN.set(key, look); return look;
}
// a sheet thrown over something: straight sides that round in toward a smaller top (the unit box's footprint, so the box stays exact)
function sheetGeometry() {
  const rings = [[0, 0.5], [0.08, 0.5], [0.82, 0.485], [0.94, 0.45], [1, 0.38]], P = [], U = [];
  const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < 4; k++) {
    const [y0, h0] = rings[r], [y1, h1] = rings[r + 1], a = corner[k], b = corner[(k + 1) % 4];
    const q = [[a[0] * h0, y0, a[1] * h0], [b[0] * h0, y0, b[1] * h0], [b[0] * h1, y1, b[1] * h1], [a[0] * h1, y1, a[1] * h1]];
    const uv = [[k, y0], [k + 1, y0], [k + 1, y1], [k, y1]];
    for (const i of [0, 2, 1, 0, 3, 2]) { P.push(...q[i]); U.push(uv[i][0] * 0.5, uv[i][1]); }
  }
  const t = rings[rings.length - 1], h = t[1];                                 // (the top)
  for (const [x, z] of [[-h, -h], [h, h], [h, -h], [-h, -h], [-h, h], [h, h]]) { P.push(x, 1, z); U.push(x + 0.5, z + 0.5); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
function sheetCanvas(base) {
  const c = mkCanvas(128, 128), g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 16; k++) { const x = Math.random() * 128, gr = g.createLinearGradient(x - 7, 0, x + 7, 0);          // (folds)
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 7, 0, 14, 128); }
  for (let k = 0; k < 2200; k++) { g.fillStyle = 'rgba(0,0,0,' + Math.random() * 0.06 + ')'; g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  const dg = g.createLinearGradient(0, 128, 0, 0); dg.addColorStop(0, 'rgba(90,80,60,.3)'); dg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = dg; g.fillRect(0, 0, 128, 128);   // (dust on top: v = 1 is up)
  return c;
}
function brickCanvas() {
  const c = mkCanvas(128, 128), g = c.getContext('2d'); g.fillStyle = '#2a201a'; g.fillRect(0, 0, 128, 128);
  for (let y = 0, r = 0; y < 128; y += 8, r++) for (let x = -(r % 2) * 8; x < 128; x += 16) {
    g.fillStyle = 'rgb(' + (92 + Math.random() * 30 | 0) + ',' + (48 + Math.random() * 16 | 0) + ',' + (36 + Math.random() * 10 | 0) + ')'; g.fillRect(x + 1, y + 1, 14, 6); }
  return c;
}
function postCanvas() {
  const c = mkCanvas(64, 128), g = c.getContext('2d'); g.fillStyle = '#3a2a1c'; g.fillRect(0, 0, 64, 128);
  g.strokeStyle = 'rgba(0,0,0,.3)'; for (let x = 2; x < 64; x += 4 + Math.random() * 5) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 3, 40, x - 3, 90, x + 1, 128); g.stroke(); }
  return c;
}
// the kit's exit (Kit.exit: its porch, the leaf that swings out, the boards that drop, the lamp) on the plan's exit face -> level.door
function kitExit(lv, kit) {
  if (!kit || !lv.plan || typeof Kit === 'undefined') return false;
  const ex = Kit.exit(lv.plan.style, { plan: lv.plan, kit, wallMat: lv.archOpts.materials.wall, wallCells: lv.archOpts.cells, bakeTier: lv.archOpts.tier, level: lv });
  if (!ex) return false;
  // (its leaf's glazing comes as an opaque mirror-like copy: the floor's glass instead, like the windows', so the flashlight doesn't
  // flare white off it; the copy is still freed by the door's dispose)
  ex.group.traverse(q => { if (q.isMesh && !Array.isArray(q.material) && /^Glass/.test(q.material.name || '')) q.material = lv.archOpts.materials.glass; });
  // (its porch's wall parts come with the kit's own uv: mapped here onto the face's wallpaper like Arch.modules does its modules'
  // wall parts: u across the face, the look's half of the picture by the face's variant, v = y / 3, a recess's sides unwrapped)
  const md = lv.plan.modules.find(q => q.kind === 'exit'), f = md && lv.plan.faces[md.face], wallMat = lv.archOpts.materials.wall, own = [];
  if (f) ex.group.traverse(q => {
    if (!q.isMesh || q.material !== wallMat || !q.geometry.attributes.uv) return;
    const g = q.geometry.clone(), P = g.attributes.position, N = g.attributes.normal, uv = g.attributes.uv, v = new THREE.Vector3(), n = new THREE.Vector3();
    const M = q.matrix, nm = new THREE.Matrix3().getNormalMatrix(M);
    const mirror = u => { const r = ((u % 2) + 2) % 2; return r > 1 ? 2 - r : r; };
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M); if (N) n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); else n.set(0, 0, 1);
      let u = 0.5 + v.x / TILE_M, w = v.y / WALL_H;
      if (Math.abs(n.x) > 0.7) u = 0.5 + (v.x - Math.sign(n.x) * v.z) / TILE_M; else if (Math.abs(n.y) > 0.7) w = (v.y + Math.sign(n.y) * v.z) / WALL_H;
      uv.setXY(i, 0.5 * mirror(u) + (f.variant ? 0.5 : 0), w);
    }
    uv.needsUpdate = true; q.geometry = g; own.push(g);
  });
  if (own.length) { const d0 = ex.door.dispose; ex.door.dispose = function () { d0.call(this); own.forEach(g => g.dispose()); }; }
  lv.group.add(ex.group); lv.door = ex.door; exitLight.position.copy(ex.door.lightPos);
  return true;
}
// The shell's materials: painted stand-ins at once, the surfaces baked in Blender (textures/surf/<style>/, B9) swapped into the same
// materials when they've loaded (no rebuild), at the tier Kit.tierFor picks (lo on Low, with the lighter Lambert materials).
function archMaterials(F, plan) {
  if (typeof MatLib !== 'undefined') return archMaterialsLit(F, plan);
  const low = settings.quality === 'low', style = F.style;
  const lit = o => { if (!low) return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o));
    const q = Object.assign({}, o); delete q.roughness; return new THREE.MeshLambertMaterial(q); };
  const col = c => new THREE.Color(c);
  // (the painted wallpaper is one wall tile wide: repeated twice, so the variant trick's half-width u (u / 2 + variant / 2) covers it once)
  const wt = wallTexture(F); wt.repeat.set(2, 1); wt.userData.bump.repeat.set(2, 1);
  const ct = ceilingTexture(F);
  const wood = { wood: '#a39680', tile: '#3a2616', concrete: '#3a2c20', attic: '#3a2a1c', workshop: '#2a1d14' }[style];
  const M = {
    wall: new THREE.MeshLambertMaterial({ map: wt, bumpMap: wt.userData.bump, bumpScale: 3, color: new THREE.Color().setScalar(wallKind(F) === 'tile' ? 2.2 : wallKind(F) === 'attic' ? 1.4 : 1) }),
    upper: new THREE.MeshLambertMaterial({ color: col(F.face) }),
    service: new THREE.MeshLambertMaterial({ color: col(F.face) }),
    ceiling: lit({ map: ct, bumpMap: ct, bumpScale: 2 }),
    trim: lit({ color: col({ wood: '#9e927e', tile: '#3b2718', concrete: '#3a3631', attic: '#2e2218', workshop: '#2a1d14' }[style]), roughness: 0.55 }),
    beam: lit({ color: col('#3a2a1c') }), ibeam: lit({ color: col('#34302c'), roughness: 0.6 }),
    frame: lit({ color: col(wood), roughness: 0.7 }), leaf: lit({ color: col(wood), roughness: 0.7 }),
    glass: lit({ color: 0x9db0c4, transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.06 }),
    sky: new THREE.MeshBasicMaterial({ color: 0x0b1530, fog: false }),            // (E7: no sky yet -> flat dark blue)
  };
  M.header = M.wall;                                       // (the wall above a doorway: look A of the wallpaper, Arch gives it u / 2)
  const lv = level, tier = surfTier();
  // a part's baked set into its materials: copies of the cached pictures, repeated as the part's uv needs (the level's own, freed with it)
  const swap = (part, mats, rx, nx, clampV) => bakedSet(style, part, tier).then(s => {
    if (!s || level !== lv) return;
    const rep = (t, x) => { const c = t.clone(); c.repeat.set(x, 1); if (clampV) c.wrapT = 1001; c.needsUpdate = true; return c; };   // (1001: ClampToEdgeWrapping)
    for (const m of mats) {
      for (const k of ['map', 'bumpMap']) if (m[k]) m[k].dispose();
      const orh = rep(s.orh, nx);
      m.map = rep(s.map, rx); m.normalMap = rep(s.normalMap, nx); m.bumpMap = null; m.aoMap = orh;
      if (m.isMeshStandardMaterial) { m.roughnessMap = orh; m.roughness = 1; }
      m.color.setScalar(part === 'wall' || part === 'upper' || part === 'service' ? 1.1 : 1); m.needsUpdate = true;
    }
  });
  // the wall's colour holds looks A and B side by side (uv0 u = u / 2 + variant / 2 from Arch): colour repeat 1, the relief (one look
  // wide) repeat 2 across, which recovers the face's u
  swap('wall', [M.wall], 1, 2); swap('upper', [M.upper], 1, 1); swap('service', [M.service], 1, 1); swap('ceil', [M.ceiling], 1, 1);
  swap('trim', [M.trim], 1, 1, true);
  if (plan.beams.some(b => b.kind !== 'ibeam')) swap('beam', [M.beam], 1, 1);
  if (plan.beams.some(b => b.kind === 'ibeam')) swap('ibeam', [M.ibeam], 1, 1);
  return M;
}

// The same with MatLib's families (js/matlib.js): walls and ceilings that take the baked lamps and moonlight through uv1, the woodwork
// lit by the light field. Every material has all its texture slots from the start (stand-ins), so the Blender sets swap in with no
// new program (H13); on Low the walls are Lambert with the colour alone (no relief: lighter).
function archMaterialsLit(F, plan) {
  const low = settings.quality === 'low', style = F.style, tier = settings.quality;
  const lit = o => { const m = low ? (() => { const q = Object.assign({}, o); delete q.roughness; return new THREE.MeshLambertMaterial(q); })()
    : new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o)); return MatLib.withLightField(m); };
  const col = c => new THREE.Color(c);
  const wt = wallTexture(F), ct = ceilingTexture(F);
  const M = {
    wall: MatLib.wallMaterial({ map: wt, tier, color: new THREE.Color().setScalar(wallKind(F) === 'tile' ? 2.2 : wallKind(F) === 'attic' ? 1.4 : 1) }),
    upper: MatLib.wallMaterial({ variant: false, tier, color: col(F.face) }),
    service: MatLib.wallMaterial({ variant: false, tier, color: col(F.face) }),
    ceiling: MatLib.ceilingMaterial({ map: ct, tier }),
    trim: lit({ color: col({ wood: '#9e927e', tile: '#3b2718', concrete: '#3a3631', attic: '#2e2218', workshop: '#2a1d14' }[style]), roughness: 0.55 }),
    beam: lit({ color: col('#3a2a1c') }), ibeam: lit({ color: col('#34302c'), roughness: 0.6 }),
    frame: lit({ color: col({ wood: '#a39680', tile: '#3a2616', concrete: '#3a2c20', attic: '#3a2a1c', workshop: '#2a1d14' }[style]), roughness: 0.7 }),
    // the windows' glass (rain, grime, the sky in it) and the sky behind them: js/atmos.js's, one of each for every floor (shared)
    glass: Atmos.glassMaterial(tier), sky: Atmos.skyMaterial(tier),
  };
  M.leaf = M.frame.clone(); M.header = M.wall;
  M.glass.userData.shared = M.sky.userData.shared = true;
  // (the painted wallpaper is one tile wide: twice across, so the variant trick's u / 2 + variant / 2 covers it once)
  M.wall.map.repeat.set(2, 1);
  wt.userData.bump.dispose(); wt.dispose();                 // (the material has its own copies of the painted pictures; no relief)
  const lv = level, stier = surfTier();
  // a part's baked set into its materials, in the slots they already have: copies repeated as the part's uv needs (freed with the level)
  const swap = (part, mats, rx, nx, clampV) => bakedSet(style, part, stier).then(s => {
    if (!s || level !== lv) return;
    const rep = (t, x) => { const c = t.clone(); c.repeat.set(x, 1); if (clampV) c.wrapT = 1001; c.needsUpdate = true; return c; };   // (1001: ClampToEdgeWrapping)
    const put = (m, k, t, x) => { const o = m[k]; if (!o) return; m[k] = rep(t, x); if (!o.userData.mlStandIn) o.dispose(); };
    for (const m of mats) {
      put(m, 'map', s.map, rx); if (!low) { put(m, 'normalMap', s.normalMap, nx); put(m, 'roughnessMap', s.orh, nx); }   // (Low: the colour alone, lighter)
      if (m.roughnessMap) m.roughness = 1;
      if (m.userData.mlFamily) m.color.setScalar(part === 'wall' || part === 'upper' || part === 'service' ? 1.1 : 1);
    }
  });
  swap('wall', [M.wall], 1, 2); swap('upper', [M.upper], 1, 1); swap('service', [M.service], 1, 1); swap('ceil', [M.ceiling], 1, 1);
  return M;
}

/* ---------- the light (spec C, E2 steps 8-10, E3) ----------
   The lamps are baked (js/lightbake.js): their light on the floor, walls and ceilings and a light field for everything else, from the
   plan's lamps (js/dress.js) with their Blender emission profiles (textures/light/profiles.json), so no lamp is a real light (C2).
   Moonlight comes in through the windows: baked patches shaped by each window's cookie (textures/light/cookies/), the night sky in
   the windows, and on Medium and High beams of light with dust in them (js/atmos.js). js/surface.js paints the floor's overlays (corner
   shade, contact shadows, dust, wet, walked paths) and the wall decals. Everything that changes during play is a uniform (MatLib.U:
   the lamps dimmed by a scare, flicker, the clock), so nothing recompiles (H13). Without the plan (or MatLib) none of this runs. */
// (MOON_GAIN: C9's ~0.7 on the floor is true to a real moon but reads as nothing on a dark floor beside the flashlight; the patches are
// kept clearly readable, still well under a lamp's pool. LAMP_GAIN: the profiles' k0 calibrated against Blender gives pools you barely
// see at 2.6 m below a pendant; the lamps light their rooms visibly, the flashlight stays far the brightest. SHAFTS: the beams' density)
const LIGHT_DATA = { data: null, loading: null }, MOON_GAIN = 5, LAMP_GAIN = 1.8, SHAFTS = 0.045;
const COOKIE_TYPES = ['sash', 'tall', 'cellar', 'cellar_short', 'dormer', 'industrial', 'oculus'];
// the light data from Blender (emission profiles, AO curves, window cookies): once, at boot; the bake works without (isotropic lamps,
// soft-edged window patches) and a floor built before it arrived is baked again when it does
function loadLightData() {
  if (LIGHT_DATA.loading) return LIGHT_DATA.loading;
  const json = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
  const grey = u => new Promise(res => { const im = new Image();
    im.onload = () => { try { const c = mkCanvas(im.width, im.height), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, im.width, im.height); res({ w: d.width, h: d.height, data: d.data }); } catch (e) { res(null); } };
    im.onerror = () => res(null); im.src = u; });
  const names = COOKIE_TYPES.flatMap(t => [-30, 0, 30].map(a => t + '_' + a));
  return (LIGHT_DATA.loading = Promise.all([json('textures/light/profiles.json'), json('textures/light/ao_profiles.json'),
    Promise.all(names.map(n => grey('textures/light/cookies/' + n + '.webp')))]).then(([profiles, ao, ck]) => {
    const cookies = {}; names.forEach((n, i) => { if (ck[i]) cookies[n] = ck[i]; });
    LIGHT_DATA.data = { profiles: profiles || undefined, aoProfiles: ao || undefined, cookies };
    const lv = level;                                       // (a floor already built without it: baked again, with it)
    if (lv && lv.light && !lv.archOpts.lightData && renderer) { lv.archOpts.lightData = true; Object.assign(lv.archOpts.bake, LIGHT_DATA.data, { fixtures: Dress.forBake(lv.plan.fixtures, LIGHT_DATA.data.profiles) }); bakeLight(lv); }
    return LIGHT_DATA.data;
  }));
}
// the style's dim interior panorama (textures/env/<style>.webp): the wet floor's reflections on Medium and High. Loaded at boot, used
// only when it's there as the floor is built (a later swap would change the reflection's program)
const ENV_TEX = {};
function envTex(style) {
  if (!(style in ENV_TEX)) { ENV_TEX[style] = null;
    loadTex('textures/env/' + style + '.webp', true).then(t => { if (t) { t.mapping = 303; t.userData.shared = true; ENV_TEX[style] = t; } }); }   // (303: equirect)
  return ENV_TEX[style];
}
// the plan's lamps the kit can't show (no kit yet, or no art for that lamp): house.js hangs plain ones there (none: the kit's all)
function fallbackLamps(kit, plan) {
  return plan.fixtures.filter(fx => !(kit && fx.node && kit.nodes[fx.node] && !kit.isPlaceholder(fx.node)));
}
// the light of a new floor: bake, overlays, the night outside; everything else in the level takes the light field
function lightLevel(lv, F) {
  const t0 = performance.now();
  lv.light = { flick: new Float32Array(16).fill(1), phase: Array.from({ length: 16 }, (_, g) => hash(g, floorIdx, 913) * 100), ms: {} };
  if (lv.house) lv.house.flick = lv.light.flick;
  try { lv.surface = Surface.build(Object.assign(Surface.lvFromGame({ tier: settings.quality, plan: lv.plan }), { cells: lv.archOpts.cells, aoProfiles: LIGHT_DATA.data && LIGHT_DATA.data.aoProfiles }));
    // (Low, the test tier and phones, leaves out the wall decals and the prints in the dust: overdraw and a few hundred instances for
    // detail you'd hardly see there; the overlays (shade, dust, wet, walked paths) stay. Medium and High have them)
    lv.surface.extras = settings.quality !== 'low';
    if (lv.surface.extras) { lv.group.add(lv.surface.decals.group); if (lv.surface.dustPrints) lv.group.add(lv.surface.dustPrints); } }
  catch (e) { console.error('Surface.build', e); lv.surface = null; }
  lv.light.ms.surface = +(performance.now() - t0).toFixed(1);
  bakeLight(lv);
  MatLib.withLightField(lv.group);                         // (the kit's pieces, wardrobes, woodwork, puzzles, props: lit where they stand)
  lv.atmos = buildAtmos(lv);
  lv.light.ms.total = +(performance.now() - t0).toFixed(1);
}
// the bake itself (again when the kit's windows or the light data arrive late), into the materials
function bakeLight(lv) {
  const t0 = performance.now(), B = lv.archOpts.bake;
  let R = null;
  // (no kit, no windows: the walls are closed there (E7), so no moonlight comes in until they open)
  // (the moon's K: K cookie sin(elevation) with K 0.7 gives floor patches of about 0.4; MOON_GAIN lifts them to a readable ~2, see above;
  // the lamps' k by LAMP_GAIN)
  const moon = B.moon ? Object.assign({}, B.moon, { k: (B.moon.k || 0.7) * MOON_GAIN }) : B.moon;
  const fixtures = (B.fixtures || []).map(f => Object.assign({}, f, { k: (Number.isFinite(f.k) && f.k > 0 ? f.k : 2) * LAMP_GAIN }));
  try { R = LightBaker.bake(Object.assign({}, B, { moon, fixtures }, lv.archKit ? {} : { windows: [] }), lv.archOpts.tier); }
  catch (e) { console.error('LightBaker.bake', e); }
  if (!R) { MatLib.setK(0, true, false); hemi.intensity = 0.3; lv.light.failed = true; return; }   // (E7: no baked lamps, the old ambient)
  if (R.stats && R.stats.warnings && R.stats.warnings.length) console.warn('LightBaker:', R.stats.warnings.slice(0, 5).join(' | '));
  const S = lv.surface;
  MatLib.setLevelMaps(Object.assign({}, R, S ? S.maps : {}, { GW, GH }));
  const cols = []; for (const g of R.groups || []) if (g.id >= 0 && g.id < 16) cols[g.id] = g.color;
  for (let i = 0; i < 16; i++) if (!cols[i]) cols[i] = [1, 0.75, 0.5];
  MatLib.setFlick(null, cols);
  lv.light.bake = { groups: R.groups, fixGroup: R.fixGroup, moonlit: R.moonlit, stats: R.stats, windows: !!lv.archKit };
  lv.light.ms.bake = +(performance.now() - t0).toFixed(1);
}
// the night outside: the sky in the windows, their glass, the moonlight's beams and the dust in them (js/atmos.js)
function buildAtmos(lv) {
  // (no kit yet: the walls are closed where the windows will be, so no beams either)
  try { return Atmos.build(lv, lv.archKit ? lv.plan : Object.assign({}, lv.plan, { windows: [] }), { tier: settings.quality, grid, shaftDensity: SHAFTS }); }
  catch (e) { console.error('Atmos.build', e); return null; }
}
// every frame (render.js): uniforms only. The lamps dim with a scare and go out in the dark one (the moon never does: C8), the
// flickering groups follow house.js's curve (each group its own phase; "Calm effects" holds them at 0.8), the clock for the sky's
// clouds and the dust
function updateLight(dt, t) {
  const L = level && level.light; if (!L) return;
  const calmNow = calm();
  for (let g = 0; g < 16; g++) { const ph = L.phase[g], n = Math.sin(t * 13 + ph) * 0.5 + Math.sin(t * 29 + ph * 2) * 0.5;
    L.flick[g] = (Math.sin(t * 2.3 + ph) > 0.35 && Math.random() < 0.55) ? 0.08 : 0.85 + 0.15 * n; }
  if (!L.failed) MatLib.setK(scares.dim, scares.dim < 0.5, calmNow, dt);
  MatLib.setFlick(L.flick); MatLib.setTime(t);
  if (level.atmos) level.atmos.update(t);
  if (settings.quality === 'low') farFixtures(L);
}
// Low: the lamps' bodies (the kit's fixtures, a few thousand triangles each) are left out past 8 m (their lo models are barely lighter than hi), in the fog where they’re
// barely shapes; their glow and emissive parts stay, so a far lamp still shines. Nothing solid is touched (H5). Medium and High draw all
const FAR_FIX = 8;
function farFixtures(L) {
  if (!L.fix) { L.fix = []; const g = level.kit && level.kit.group; if (!g) return;
    for (const o of g.children) if (o.isInstancedMesh && o.userData.kit && o.userData.kit.kind === 'fixture') {
      if (!o.boundingSphere) o.computeBoundingSphere(); L.fix.push({ o, c: o.boundingSphere.center.clone().applyMatrix4(o.matrixWorld), r: o.boundingSphere.radius }); } }
  const cp = camera.position;
  for (const f of L.fix) f.o.visible = f.c.distanceTo(cp) - f.r < FAR_FIX;
}

/* ---------- the surfaces baked in Blender (textures/surf/<style>/, made by tools/blender/kit/surfaces2.py) ----------
   Per floor style: the floor (one 2.25 m tile), the wall (2.25 x 3 m; two looks side by side in one picture: A as built,
   B damaged: stains, mould, peeling, flaking) and the ceiling, each with its colour, normal map (the relief) and orh map
   (R ambient occlusion, G roughness, B height), in three sizes (hi, md, lo) to suit the graphics card. Until they've
   loaded (or if they can't be), the painted textures stay; Low keeps the painted ones (lighter).
   (The older textures/*.webp sets and surfaceSet are still used by the lobby.) */
const SURF_STYLES = ['wood', 'tile', 'concrete', 'attic', 'workshop'];
const surfTier = () => typeof Kit !== 'undefined' && Kit.tierFor ? Kit.tierFor(settings.quality, LOWQ) : settings.quality === 'high' ? 'hi' : 'md';
const surfCache = new Map();
// (the game's three.js has no TextureLoader: a plain image, wrapped as a texture)
function loadTex(src, srgb) {
  return new Promise(res => { const img = new Image();
    img.onload = () => { const t = new THREE.CanvasTexture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); };
    img.onerror = () => res(null); img.src = src; });
}
function surfaceSet([colour, relief]) {
  const key = colour + '|' + relief; if (surfCache.has(key)) return surfCache.get(key);
  const p = Promise.all([loadTex('textures/' + colour + '_color.webp', true), loadTex('textures/' + relief + '_normal.webp'), loadTex('textures/' + relief + '_rough.webp')])
    .then(([map, normalMap, roughnessMap]) => map && normalMap ? { map, normalMap, roughnessMap } : null);
  surfCache.set(key, p); return p;
}
// one part (floor, wall, ceil) of a style's baked set: {map, normalMap, orh}, or null if any of it is missing
function bakedSet(style, part, tier) {
  const key = style + '/' + part + '.' + tier; if (surfCache.has(key)) return surfCache.get(key);
  const f = n => 'textures/surf/' + style + '/' + part + '_' + n + '.' + tier + '.webp';
  const p = Promise.all([loadTex(f(part === 'floor' ? 'colorA' : 'color'), true), loadTex(f('normal')), loadTex(f('orh'))])
    .then(([map, normalMap, orh]) => map && normalMap && orh ? { map, normalMap, orh } : null);
  surfCache.set(key, p); return p;
}
// Everything a floor is built from (E4): its kit, the mouldings' profiles, the light's data from Blender, the decal atlas and the
// baked surface sets, so the floor never starts half-built (the sky, the glass and the reflections load beside them). floorAssets(i)
// settles when all have loaded or failed (it never rejects); floorAssetsIn(i): they already have, for this quality.
const FLOOR_ASSETS = new Map();
function floorAssets(i) {
  const F = FLOORS[i]; if (!F) return Promise.resolve();
  const key = F.style + '/' + settings.quality; let e = FLOOR_ASSETS.get(key);
  if (e) return e.p;
  const ok = q => Promise.resolve(q).catch(() => null), lit = typeof MatLib !== 'undefined', tier = surfTier();
  if (lit && typeof Atmos !== 'undefined') Atmos.preload(F.style, settings.quality);
  if (lit) envTex(F.style);
  e = { done: false };
  e.p = Promise.all([typeof Kit !== 'undefined' ? ok(Kit.want(F.style)) : null, typeof Arch !== 'undefined' ? ok(Arch.loadProfiles(F.style)) : null,
    lit ? ok(loadLightData()) : null, lit && typeof Surface !== 'undefined' ? ok(Surface.load(settings.quality)) : null,
    ...['floor', 'wall', 'upper', 'service', 'ceil'].map(q => lit || q === 'floor' ? ok(bakedSet(F.style, q, tier)) : null)]).then(() => { e.done = true; });
  FLOOR_ASSETS.set(key, e); return e.p;
}
function floorAssetsIn(i) { const F = FLOORS[i], e = F && FLOOR_ASSETS.get(F.style + '/' + settings.quality); return !!(e && e.done); }
// (on floor entry: the baked sets of styles other than this floor's and the next are dropped, like the kits (Kit.furnish evicts
// them, E5): kept for every style, the High sets alone ran a page out of memory by the fifth floor)
function evictSurfaces(i) {
  const keep = new Set([FLOORS[i] && FLOORS[i].style, FLOORS[i + 1] && FLOORS[i + 1].style]);
  for (const [key, p] of surfCache) { if (keep.has(key.split('/')[0])) continue;
    surfCache.delete(key); p.then(s => { if (s) for (const t of Object.values(s)) t.dispose(); }); }
  for (const [key, e] of FLOOR_ASSETS) if (!keep.has(key.split('/')[0])) FLOOR_ASSETS.delete(key);
}
function upgradeSurfaces(F, floorMat, G, walls, faces, ceil) {
  const style = SURF_STYLES[floorIdx]; if (!style) return;
  const lv = level, tier = surfTier();
  if (floorMat.userData.mlFamily) {                         // MatLib's floor: the set into the slots it has, one picture per tile
    bakedSet(style, 'floor', tier).then(s => {
      if (!s || level !== lv) return;
      const rep = t => { const c = t.clone(); c.repeat.set(GW, GH); c.needsUpdate = true; return c; };
      // (Low: the colour alone, as Low always had: relief and gloss are the costly reads over the whole floor)
      const low = settings.quality === 'low';
      for (const [k, t] of low ? [['map', s.map]] : [['map', s.map], ['normalMap', s.normalMap], ['roughnessMap', s.orh]]) { const o = floorMat[k]; floorMat[k] = rep(t); if (o && !o.userData.mlStandIn) o.dispose(); }
      if (!low) floorMat.roughness = 1; floorMat.color.setScalar(1.25);
    });
    return;
  }
  if (settings.quality === 'low') return;                   // (low quality: the painted ones, lighter)
  // (copies of the cached textures, repeated as the level needs: the level's own, disposed with it)
  const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
  bakedSet(style, 'floor', tier).then(s => {
    if (!s || level !== lv) return;
    // the floor: the baked boards/tiles (one picture per tile), with the painted shade, stains and words multiplied over it
    const ov = floorOverlay(F), painted = floorMat.map;
    floorMat.map = rep(s.map, GW, GH); floorMat.normalMap = rep(s.normalMap, GW, GH); floorMat.roughnessMap = rep(s.orh, GW, GH);
    floorMat.bumpMap = null; floorMat.roughness = 1; floorMat.color.setScalar(1.25); floorMat.normalScale.set(1, 1);
    if (painted) painted.dispose();                      // (the painted floor, which was its relief too: nothing uses it any more)
    floorMat.userData.overlay = ov;
    floorMat.onBeforeCompile = sh => {
      sh.uniforms.uOverlay = { value: ov };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vOvUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\n  vOvUv = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vOvUv;\nuniform sampler2D uOverlay;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= texture2D(uOverlay, vOvUv).rgb;');
    };
    floorMat.customProgramCacheKey = () => 'floorOverlay'; floorMat.needsUpdate = true;
  });
  // (the walls and ceiling below are the old flat ones, used only without the plan: archMaterials dresses the shell built from it)
  if (walls) bakedSet(style, 'wall', tier).then(s => {
    if (!s || level !== lv) return;
    // each wall face picks look A or B: its u moves into the left or the right half of the colour picture. The normal and
    // orh pictures hold one tile only (both looks share the relief), so they repeat twice across, which undoes the halving.
    const uv = walls.geometry.attributes.uv, per = uv.count / faces.length;
    faces.forEach((f, i) => { const b = hash(f.x * 3 + f.nx, f.y * 3 + f.nz, 77) < 0.35 ? 0.5 : 0;
      for (let k = i * per; k < (i + 1) * per; k++) uv.setX(k, uv.getX(k) * 0.5 + b); });
    uv.needsUpdate = true;
    const mats = new Set(), painted = new Set();          // (the walls and the tops of the doorways share the painted wall and its relief)
    G.traverse(o => { const m = o.material; if (m && m.userData && m.userData.wallSurface) mats.add(m); });
    for (const m of mats) { painted.add(m.map).add(m.bumpMap);
      const own = m === walls.material;                   // (the doorway tops keep a 0..1 u: they show look A)
      m.map = rep(s.map, own ? 1 : 0.5, 1); m.normalMap = rep(s.normalMap, own ? 2 : 1, 1); m.bumpMap = null; m.color.setScalar(1.1); m.needsUpdate = true; }
    for (const t of painted) if (t) t.dispose();
  });
  if (ceil) bakedSet(style, 'ceil', tier).then(s => {
    if (!s || level !== lv) return;
    const old = ceil.material;                            // (painted and flat-shaded: now a real plaster/board ceiling that takes the flashlight)
    ceil.material = new THREE.MeshStandardMaterial({ map: rep(s.map, GW, GH), normalMap: rep(s.normalMap, GW, GH), roughnessMap: rep(s.orh, GW, GH), roughness: 1, metalness: 0 });
    if (old.map) old.map.dispose(); old.dispose(); ceil.receiveShadow = true;
  });
}
// what the painted floor adds over the baked one: shade in the corners, stains, petals, words, the loose boards (white = nothing)
function floorOverlay(F) {
  const res = Math.min(1, 1024 / (Math.max(GW, GH) * T));
  const c = mkCanvas(Math.ceil(GW * T * res), Math.ceil(GH * T * res)), g = c.getContext('2d');
  g.setTransform(res * T / PT, 0, 0, res * T / PT, 0, 0);
  g.fillStyle = '#fff'; g.fillRect(0, 0, GW * PT, GH * PT);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!grid[y][x]) paintShade(g, x, y);
  for (const d of decals) paintDecal(g, d);
  if (!boardsTemplate) for (const b of creaks) paintBoard(g, b);
  return toTex(c);
}

// a loose floorboard section (models/boards.glb): lengthwise along x, turned when it runs along y; a long one across a corridor
function makeBoard(b) {
  const pre = b.mid ? 'BoardLong' : 'BoardShort', g = new THREE.Group();
  for (const n of [pre, pre + 'Nails', pre + 'Gap']) { const o = boardsTemplate.getObjectByName(n); if (o) { const c = o.clone(); c.traverse(q => { q.userData.shared = true; }); g.add(c); } }
  g.position.set(b.x * S, 0, b.y * S); g.rotation.y = (b.along ? Math.PI / 2 : 0) + (hash(b.x, b.y, 7) - 0.5) * 0.05;
  if (hash(b.x, b.y, 8) < 0.5) g.rotation.y += Math.PI;   // (which end is lifted, which plank broken: either way round)
  return g;
}
// the floor is painted once per floor, tile by tile, into one big texture
function floorTexture(F, lit) {
  const res = Math.min(2, (LOWQ ? 1536 : 2048) / (Math.max(GW, GH) * T));
  const c = mkCanvas(Math.ceil(GW * T * res), Math.ceil(GH * T * res)), g = c.getContext('2d');
  g.setTransform(res * T / PT, 0, 0, res * T / PT, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, GW * PT, GH * PT);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!grid[y][x]) paintFloor(g, F, x, y);
  if (!lit) for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!grid[y][x]) paintShade(g, x, y);   // (lit: js/surface.js's overlay has them)
  if (!lit) for (const d of decals) paintDecal(g, d);
  if (!boardsTemplate) for (const b of creaks) paintBoard(g, b);   // the loose floorboards (js/stealth.js): painted, unless the 3D ones are here
  return toTex(c);
}
// a loose floorboard: two short dark planks, cracked, with a black gap around them and nails sticking up. Easy to learn, easy to miss when running
function paintBoard(g, b) {
  const k = PT / T, w = 13 * k, l = b.len * k;
  g.save(); g.translate(b.x * k, b.y * k); if (b.along) g.rotate(Math.PI / 2);
  g.fillStyle = 'rgba(0,0,0,.85)'; g.fillRect(-l / 2 - 1, -w / 2 - 1, l + 2, w + 2);
  for (const [y0, sh] of [[-w / 2, '#3a2616'], [0.3, '#2c1c10']]) {
    g.fillStyle = sh; g.fillRect(-l / 2, y0, l, w / 2 - 0.3);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.35;
    for (let q = 0; q < 2; q++) { const gy = y0 + 1.2 + q * 2.2; g.beginPath(); g.moveTo(-l / 2, gy); g.bezierCurveTo(-l / 6, gy - 0.8, l / 6, gy + 0.8, l / 2, gy); g.stroke(); }
  }
  g.strokeStyle = 'rgba(225,190,140,.55)'; g.lineWidth = 0.5;                  // the crack
  g.beginPath(); g.moveTo(-l / 2 + 2, -w / 2 + 1.5); g.lineTo(-2, -1); g.lineTo(1.5, 0.8); g.lineTo(l / 2 - 3, w / 2 - 1.2); g.stroke();
  g.fillStyle = 'rgba(230,220,200,.8)';                                        // nails
  for (const [x, y] of [[-l / 2 + 1.5, -w / 4], [l / 2 - 1.5, -w / 4], [-l / 2 + 1.5, w / 4], [l / 2 - 1.5, w / 4]]) { g.beginPath(); g.arc(x, y, 0.55, 0, 7); g.fill(); }
  g.restore();
}
// (the floor is painted in a 40-unit design space per tile, PT, and scaled to the real tile size)
const PT = 40;
function paintFloor(g, F, x, y) {
  const X = x * PT, Y = y * PT;
  if (floorKind(F) === 'wood') {
    for (let k = 0; k < 4; k++) {
      const row = y * 4 + k, py = Y + k * 10, seam = X + 4 + hash(row, x, 1) * (PT - 8);
      for (const [a, b] of [[X, seam], [seam, X + PT]]) {
        const v = hash(row, Math.round(a), 2);
        g.fillStyle = F.floorA; g.fillRect(a, py, b - a + 0.3, 10.3);
        g.fillStyle = v < 0.5 ? 'rgba(0,0,0,' + (0.5 - v) * 0.5 + ')' : 'rgba(255,215,190,' + (v - 0.5) * 0.14 + ')';
        g.fillRect(a, py, b - a + 0.3, 10.3);
        g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 0.4;
        for (let q = 0; q < 2; q++) { const gy = py + 2.5 + q * 4 + hash(row, q + a, 3) * 2;
          g.beginPath(); g.moveTo(a, gy); g.bezierCurveTo(a + (b - a) * 0.3, gy - 1, a + (b - a) * 0.6, gy + 1, b, gy); g.stroke(); }
        if (hash(row, a, 5) > 0.6) { g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.arc(a + 1.6, py + 5, 0.55, 0, 7); g.fill(); }
      }
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(X, py + 9.4, PT, 0.6); g.fillRect(seam, py, 0.6, 10);
      g.fillStyle = 'rgba(255,225,205,.07)'; g.fillRect(X, py, PT, 0.5);
    }
  } else if (floorKind(F) === 'tile') {
    for (let k = 0; k < 4; k++) {
      const ix = x * 2 + (k % 2), iy = y * 2 + (k >> 1), tx = ix * 20, ty = iy * 20, v = hash(ix, iy, 4);
      g.fillStyle = (ix + iy) % 2 ? F.floorB : F.floorA; g.fillRect(tx, ty, 20.3, 20.3);
      g.fillStyle = 'rgba(255,255,255,' + (0.03 + 0.04 * v) + ')'; g.fillRect(tx + 1.5, ty + 1.5, 17, 5);
      if (v > 0.84) { g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 0.6; g.beginPath();
        g.moveTo(tx + 2, ty + 3 + v * 10); g.lineTo(tx + 9, ty + 10); g.lineTo(tx + 12, ty + 17); g.moveTo(tx + 9, ty + 10); g.lineTo(tx + 18, ty + 6 + v * 8); g.stroke(); }
    }
    g.fillStyle = F.grout; g.fillRect(X, Y, PT, 0.9); g.fillRect(X, Y + 20, PT, 0.9); g.fillRect(X, Y, 0.9, PT); g.fillRect(X + 20, Y, 0.9, PT);
  } else {
    g.fillStyle = F.floorA; g.fillRect(X, Y, PT + 0.3, PT + 0.3);
    for (let k = 0; k < 8; k++) { const v = hash(x, y, 10 + k);
      g.fillStyle = v < 0.55 ? 'rgba(0,0,0,.13)' : 'rgba(255,240,220,.045)';
      g.beginPath(); g.arc(X + hash(x, y, 20 + k) * PT, Y + hash(x, y, 30 + k) * PT, 2 + v * 8, 0, 7); g.fill(); }
    if (hash(x, y, 40) > 0.72) { g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 0.6; g.beginPath();
      let cx = X + hash(x, y, 41) * PT, cy = Y; g.moveTo(cx, cy);
      for (let q = 1; q <= 5; q++) { cx += (hash(x, y, 42 + q) - 0.5) * 12; cy += PT / 5; g.lineTo(cx, cy); } g.stroke(); }
    if (hash(x, y, 50) > 0.78) { const px = X + 10 + hash(x, y, 51) * 20, py = Y + 10 + hash(x, y, 52) * 20;
      const pg = g.createRadialGradient(px - 3, py - 3, 1, px, py, 13);
      pg.addColorStop(0, 'rgba(140,170,210,.4)'); pg.addColorStop(0.5, 'rgba(25,35,60,.55)'); pg.addColorStop(1, 'rgba(10,15,25,0)');
      g.fillStyle = pg; g.beginPath(); g.ellipse(px, py, 13, 8, hash(x, y, 53) * 3, 0, 7); g.fill(); }
  }
}
function paintShade(g, x, y) { // corners and wall bases are darker
  const X = x * PT, Y = y * PT;
  const band = (x0, y0, x1, y1, a, rx, ry, rw, rh) => { const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(rx, ry, rw, rh); };
  if (isWall(x, y - 1)) band(0, Y, 0, Y + 9, 0.55, X, Y, PT, 9);
  if (isWall(x - 1, y)) band(X, 0, X + 9, 0, 0.55, X, Y, 9, PT);
  if (isWall(x + 1, y)) band(X + PT, 0, X + PT - 9, 0, 0.55, X + PT - 9, Y, 9, PT);
  if (isWall(x, y + 1)) band(0, Y + PT, 0, Y + PT - 9, 0.55, X, Y + PT - 9, PT, 9);
}
function paintDecal(g, d) {
  g.save(); g.translate(d.x * PT / T, d.y * PT / T); g.rotate(d.rot);
  if (d.type === 'stain') {
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, d.s);
    sg.addColorStop(0, 'rgba(70,4,10,.6)'); sg.addColorStop(1, 'rgba(70,4,10,0)');
    g.fillStyle = sg; g.beginPath(); g.ellipse(0, 0, d.s, d.s * 0.65, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(70,4,10,.55)'; g.beginPath(); g.arc(d.s * 1.2, 2, 1.6, 0, 7); g.arc(d.s * 1.6, -1, 1, 0, 7); g.fill();
  } else if (d.type === 'petal') {
    for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? 'rgba(90,130,255,.55)' : 'rgba(150,180,255,.45)';
      g.beginPath(); g.ellipse(k * 4 - 6, (k % 2) * 4 - 2, 3.2, 1.6, k * 1.3, 0, 7); g.fill(); }
  } else {
    g.fillStyle = 'rgba(120,10,18,.6)'; g.font = 'bold 9px Georgia, serif'; g.textAlign = 'center'; g.fillText(d.text, 0, 3);
    g.fillRect(-2, 4, 0.7, 4 + d.s * 0.3);   // a drip
  }
  g.restore();
}
function ceilingTexture(F) {
  const c = mkCanvas(128, 128), g = c.getContext('2d');
  g.fillStyle = F.style === 'concrete' ? '#2a2724' : F.style === 'attic' ? '#241a12' : '#2b2528'; g.fillRect(0, 0, 128, 128);
  if (F.style === 'attic') for (let x = 0; x < 128; x += 16) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, 0, 2, 128); }   // (boards)
  for (let k = 0; k < 40; k++) { g.fillStyle = Math.random() < 0.6 ? 'rgba(0,0,0,.12)' : 'rgba(255,240,220,.03)';
    g.beginPath(); g.arc(Math.random() * 128, Math.random() * 128, 3 + Math.random() * 14, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.beginPath(); let x = 20, y = 0; g.moveTo(x, y);
  while (y < 128) { x += rnd(-10, 10); y += rnd(8, 18); g.lineTo(x, y); } g.stroke();
  return toTex(c, true);
}
// one texture covers one tile of wall (1.8 m wide, 3 m high) and repeats sideways
function wallTexture(F) {
  const w = 384, h = 640, c = mkCanvas(w, h), g = c.getContext('2d'), pm = h / WALL_H;
  const rail = h - 0.95 * pm, base = h - 0.14 * pm;
  // the relief (bump map): mid grey is flat, lighter sticks out, darker is sunk in
  const hc = mkCanvas(w, h), hg = hc.getContext('2d');
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, w, h);
  for (let k = 0; k < 900; k++) { hg.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '0,0,0' : '255,255,255') + ',.05)'; hg.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 4); }
  const kind = wallKind(F);
  if (kind === 'attic') {                  // bare planks: raised boards, deep gaps
    for (let x = 0; x < w; x += 32) { hg.fillStyle = 'rgb(' + Array(3).fill(150 + (Math.random() * 30 | 0)).join(',') + ')'; hg.fillRect(x + 3, 0, 27, h); hg.fillStyle = '#202020'; hg.fillRect(x, 0, 3, h); }
  } else if (kind === 'workshop') {        // cracked plaster above, boards below
    hg.fillStyle = '#9a9a9a'; hg.fillRect(0, rail, w, h - rail);
    for (let x = 0; x < w; x += 24) { hg.fillStyle = '#383838'; hg.fillRect(x, rail, 2, h - rail); }
    hg.fillStyle = '#e8e8e8'; hg.fillRect(0, rail - 10, w, 12); hg.fillStyle = '#303030'; hg.fillRect(0, rail + 2, w, 4);
  } else if (kind === 'wood') {
    hg.fillStyle = '#9a9a9a'; hg.fillRect(0, rail, w, base - rail);
    for (let x = 0; x < w; x += 96) { hg.strokeStyle = '#303030'; hg.lineWidth = 5; hg.strokeRect(x + 12, rail + 26, 72, base - rail - 46);
      hg.fillStyle = '#b0b0b0'; hg.fillRect(x + 16, rail + 30, 64, base - rail - 54); }
    hg.fillStyle = '#e0e0e0'; hg.fillRect(0, rail - 7, w, 14); hg.fillStyle = '#404040'; hg.fillRect(0, rail + 7, w, 3);
  } else if (kind === 'tile') {
    hg.fillStyle = '#a8a8a8'; hg.fillRect(0, rail, w, h - rail);
    hg.fillStyle = '#303030'; for (let y = rail; y < h; y += 32) { hg.fillRect(0, y, w, 3); for (let x = 0; x < w; x += 48) hg.fillRect(x, y, 3, 32); }
    hg.fillStyle = '#e0e0e0'; hg.fillRect(0, rail - 6, w, 12);
  } else {
    for (let y = 0, r = 0; y < h; y += 18, r++) for (let x = -(r % 2) * 32; x < w; x += 64) {
      hg.fillStyle = 'rgb(' + Array(3).fill(150 + (Math.random() * 40 | 0)).join(',') + ')'; hg.fillRect(x + 3, y + 3, 61, 15);
      hg.fillStyle = '#2a2a2a'; hg.fillRect(x, y, 64, 3); hg.fillRect(x, y, 3, 18);
    }
  }
  hg.fillStyle = '#d0d0d0'; hg.fillRect(0, base, w, h - base); hg.fillStyle = '#404040'; hg.fillRect(0, base, w, 3);
  g.fillStyle = F.face; g.fillRect(0, 0, w, h);
  if (kind === 'attic') {              // attic: bare, uneven planks with nails and dark gaps
    for (let x = 0; x < w; x += 32) { const v = Math.random();
      g.fillStyle = F.face; g.fillRect(x, 0, 32, h);
      g.fillStyle = v < 0.5 ? 'rgba(0,0,0,' + (0.35 * (0.5 - v)) + ')' : 'rgba(255,220,180,' + (0.08 * (v - 0.5)) + ')'; g.fillRect(x, 0, 32, h);
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
      for (let k = 0; k < 5; k++) { const gx = x + 4 + Math.random() * 24; g.beginPath(); g.moveTo(gx, 0); g.bezierCurveTo(gx + 3, h * 0.3, gx - 3, h * 0.7, gx + 1, h); g.stroke(); }
      g.fillStyle = '#0a0705'; g.fillRect(x, 0, 3, h);
      g.fillStyle = 'rgba(20,20,20,.8)'; for (const ny of [60, h * 0.5, h - 70]) { g.beginPath(); g.arc(x + 16, ny, 1.6, 0, 7); g.fill(); }
      if (Math.random() < 0.3) { const ky = Math.random() * h; g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x + 16, ky, 4, 7, 0, 0, 7); g.fill(); }   // a knot
    }
  } else if (kind === 'workshop') {    // workshop: stained plaster, a shelf rail, dark boards below
    g.fillStyle = F.face; g.fillRect(0, 0, w, rail);
    for (let k = 0; k < 60; k++) { const x = Math.random() * w, y = Math.random() * rail, r = 8 + Math.random() * 40;
      const sg = g.createRadialGradient(x, y, 0, x, y, r); sg.addColorStop(0, Math.random() < 0.5 ? 'rgba(0,0,0,.1)' : 'rgba(255,255,230,.05)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sg; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.strokeStyle = 'rgba(20,20,15,.55)'; g.lineWidth = 1;
    for (let k = 0; k < 3; k++) { let x = Math.random() * w, y = Math.random() * rail * 0.6; g.beginPath(); g.moveTo(x, y);
      for (let q = 0; q < 6; q++) { x += (Math.random() - 0.5) * 30; y += 10 + Math.random() * 25; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = '#2a1d14'; g.fillRect(0, rail, w, h - rail);
    for (let x = 0; x < w; x += 24) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x, rail, 2, h - rail); g.fillStyle = 'rgba(255,220,190,' + (Math.random() * 0.05) + ')'; g.fillRect(x + 2, rail, 22, h - rail); }
    g.fillStyle = '#3a2a1e'; g.fillRect(0, rail - 10, w, 12); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, rail + 2, w, 4);
  } else if (kind === 'wood') {            // nursery: striped wallpaper with little flowers, wooden panels below
    g.fillStyle = F.pattern; for (let x = 0; x < w; x += 48) g.fillRect(x + 8, 0, 14, rail);
    g.fillStyle = F.dot;
    for (let x = 0; x < w; x += 48) for (let y = 24, r = 0; y < rail - 14; y += 44, r++) {
      const fx = x + 35, fy = y + (r % 2) * 18;
      for (let p = 0; p < 5; p++) { const a = p / 5 * 6.283; g.beginPath(); g.arc(fx + Math.cos(a) * 3.2, fy + Math.sin(a) * 3.2, 2.2, 0, 7); g.fill(); }
    }
    g.fillStyle = '#3a2418'; g.fillRect(0, rail, w, h - rail);
    for (let x = 0; x < w; x += 96) { g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4; g.strokeRect(x + 12, rail + 26, 72, base - rail - 46);
      g.strokeStyle = 'rgba(255,220,190,.08)'; g.lineWidth = 2; g.strokeRect(x + 15, rail + 29, 72, base - rail - 46); }
    g.fillStyle = '#5a3a28'; g.fillRect(0, rail - 7, w, 14); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, rail + 7, w, 3);
  } else if (kind === 'tile') {     // hallway: damask wallpaper over old tiles
    g.fillStyle = F.pattern;
    for (let x = 0; x < w; x += 64) for (let y = 0, r = 0; y < rail; y += 80, r++) {
      const cx = x + 32 + (r % 2) * 32, cy = y + 40;
      for (const ox of [cx, cx - w]) { g.beginPath(); g.moveTo(ox, cy - 26); g.lineTo(ox + 14, cy); g.lineTo(ox, cy + 26); g.lineTo(ox - 14, cy); g.fill();
        g.beginPath(); g.arc(ox, cy - 34, 4, 0, 7); g.arc(ox, cy + 34, 4, 0, 7); g.fill(); }
    }
    g.fillStyle = '#1f353b'; g.fillRect(0, rail, w, h - rail);
    for (let y = rail; y < h; y += 32) for (let x = 0; x < w; x += 48) {
      g.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.05) + ')'; g.fillRect(x + 2, y + 2, 44, 28);
      g.fillStyle = F.grout; g.fillRect(x, y, 48, 2); g.fillRect(x, y, 2, 32); }
    g.fillStyle = '#10262c'; g.fillRect(0, rail - 6, w, 12);
  } else {                             // basement: damp brick
    for (let y = 0, r = 0; y < h; y += 18, r++) for (let x = -(r % 2) * 32; x < w; x += 64) {
      const v = Math.random();
      g.fillStyle = F.face; g.fillRect(x, y, 64, 18);
      g.fillStyle = v < 0.5 ? 'rgba(0,0,0,' + (0.3 * (0.5 - v)) + ')' : 'rgba(255,220,190,' + (0.1 * (v - 0.5)) + ')'; g.fillRect(x, y, 64, 18);
      g.fillStyle = F.mortar; g.fillRect(x, y, 64, 3); g.fillRect(x, y, 3, 18);
    }
    const dg = g.createLinearGradient(0, h, 0, h - 1.3 * pm); dg.addColorStop(0, 'rgba(12,24,16,.75)'); dg.addColorStop(1, 'rgba(12,24,16,0)');
    g.fillStyle = dg; g.fillRect(0, 0, w, h);
  }
  // grime: dark top, water streaks, stains, dirty skirting
  const tg = g.createLinearGradient(0, 0, 0, 0.9 * pm); tg.addColorStop(0, 'rgba(0,0,0,.6)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = tg; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 7; k++) { const x = Math.random() * w, sw = 3 + Math.random() * 12, len = (0.4 + Math.random() * 1.6) * pm;
    const sg = g.createLinearGradient(0, 0, 0, len); sg.addColorStop(0, 'rgba(10,6,4,.35)'); sg.addColorStop(1, 'rgba(10,6,4,0)');
    g.fillStyle = sg; g.fillRect(x, 0, sw, len); }
  for (let k = 0; k < 4; k++) { const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 50;
    const sg = g.createRadialGradient(x, y, 0, x, y, r); sg.addColorStop(0, 'rgba(40,25,10,.22)'); sg.addColorStop(1, 'rgba(40,25,10,0)');
    g.fillStyle = sg; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const bg = g.createLinearGradient(0, h, 0, h - 0.5 * pm); bg.addColorStop(0, 'rgba(0,0,0,.55)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = F.base; g.fillRect(0, base, w, h - base); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, base, w, 3);
  const t = toTex(c, true), bump = new THREE.CanvasTexture(hc); bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  t.userData.bump = bump;
  return t;
}
// one wall piece for every wall side that faces an open tile. Each piece is a small grid so that
// inside corners, the ceiling line and the floor line can be shaded darker (fake ambient occlusion)
function wallGeometry(faces) {
  const P = [], N = [], U = [], C = [], I = [], L = TILE_M, h = WALL_H;
  const us = [0, 0.14, 0.86, 1], vs = [0, 0.12, 0.8, 1];
  const quad = (x0, z0, x1, z1, nx, nz, x, y) => {
    const tx = Math.sign(x1 - x0), tz = Math.sign(z1 - z0);
    // a wall at the next tile along means an inside corner at that end
    const dark0 = isWall(x - tx, y - tz) ? 0.42 : 1, dark1 = isWall(x + tx, y + tz) ? 0.42 : 1;
    const b = P.length / 3;
    for (const v of vs) for (const u of us) {
      P.push(x0 + (x1 - x0) * u, h * v, z0 + (z1 - z0) * u); N.push(nx, 0, nz); U.push(u, v);
      let k = u === 0 ? dark0 : u === 1 ? dark1 : 1;
      if (v === 0) k *= 0.62; else if (v === 1) k *= 0.5;
      C.push(k, k, k);
    }
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) {
      const i = b + r * 4 + q; I.push(i, i + 1, i + 5, i, i + 5, i + 4);
    }
    faces.push({ x0, z0, x1, z1, nx, nz, x, y });
  };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (grid[y][x]) continue;
    const X0 = x * L, X1 = X0 + L, Z0 = y * L, Z1 = Z0 + L;
    if (isWall(x, y - 1)) quad(X0, Z0, X1, Z0, 0, 1, x, y);
    if (isWall(x, y + 1)) quad(X1, Z1, X0, Z1, 0, -1, x, y);
    if (isWall(x - 1, y)) quad(X0, Z1, X0, Z0, 1, 0, x, y);
    if (isWall(x + 1, y)) quad(X1, Z0, X1, Z1, -1, 0, x, y);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(I);
  return geo;
}
// doll portraits (some with glowing eyes) and words written on the walls. Some portraits are more than paint:
//   watchers - bigger, with real glass eyes that turn to follow you
//   changers - look away from one you've been looking at, and when you look back it isn't the same picture any more
function wallDecor(G, F, faces, doorTiles, skip, plan) {
  const plain = portraitTexture(false), eyed = portraitTexture(true), eyeGlow = portraitEyes();
  level.paintings = [];
  const wGeoBig = new THREE.PlaneGeometry(0.66, 0.84), wMat = new THREE.MeshLambertMaterial({ map: portraitTexture('sockets') });
  const cMat = new THREE.MeshLambertMaterial({ map: portraitTexture('changed') });
  const eyeGeo = new THREE.SphereGeometry(0.021, 12, 8), irisGeo = new THREE.CircleGeometry(0.0115, 14), pupilGeo = new THREE.CircleGeometry(0.0055, 10);
  const scleraMat = new THREE.MeshLambertMaterial({ color: 0xd8d4c8 }), irisMat = new THREE.MeshLambertMaterial({ color: 0x2a5bd0, emissive: 0x0a1c50 }),
    pupilMat = new THREE.MeshBasicMaterial({ color: 0x020203 });
  const makeEye = (x, y) => { const e = new THREE.Group(), s = new THREE.Mesh(eyeGeo, scleraMat), ir = new THREE.Mesh(irisGeo, irisMat), pu = new THREE.Mesh(pupilGeo, pupilMat);
    ir.position.z = 0.0205; pu.position.z = 0.0209; e.add(s, ir, pu); e.position.set(x, y, 0.004); e.rotation.order = 'YXZ'; return e; };
  const pGeo = new THREE.PlaneGeometry(0.44, 0.56), wGeo = new THREE.PlaneGeometry(1.2, 0.6);
  let pMat = new THREE.MeshLambertMaterial({ map: plain });
  let eMat = new THREE.MeshLambertMaterial({ map: eyed, emissiveMap: eyeGlow, emissive: 0xffffff, emissiveIntensity: 2.5 });
  // (the portraits painted in Blender, when they've loaded: a different doll in each frame; the watcher's eyes where its sockets are)
  const P = portraits, pMats = P ? P.plain.map(t => new THREE.MeshLambertMaterial({ map: t })) : null;
  if (P) { wMat.map = P.watch; cMat.map = P.changed; eMat = new THREE.MeshLambertMaterial({ map: P.plain[0] }); }
  const eyeAt = k => P ? [P.eyes[k][0] * 1.5, P.eyes[k][1] * 1.5] : [k ? 0.0464 : -0.0464, 0.0307];   // (the watcher's frame is 1.5 times the size)
  const glowDot = P && new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe6ff).multiplyScalar(2.5) }), dotGeo = P && new THREE.CircleGeometry(0.009, 12);
  const words = {};
  // what hangs where: the plan's decorFaces (js/dress.js: the same rule, never on a doorway, a wardrobe's dead end, the exit, a module,
  // a window or a servant corridor, and never behind tall furniture); without the plan, the rule here on the old faces
  let list;
  if (plan) list = plan.decorFaces.map(d => ({ f: faces[d.face], kind: d.kind, watch: d.watch, glow: d.glow, change: d.change, pick: d.pick, text: d.text, y: d.y, rz: d.rz }));
  else {
    list = [];
    const exitFace = f => f.x === exit.tx && f.y === exit.ty;
    const inWardrobe = new Set(closets.map(c => Math.floor(c.x / T) + ',' + Math.floor(c.y / T)));   // (nothing on the walls of a wardrobe's dead end: it would hang inside it)
    let nw = 0, nc = 0;
    faces.forEach(f => {
      if (exitFace(f) || inWardrobe.has(f.x + ',' + f.y) || (doorTiles && doorTiles.has(f.x + ',' + f.y)) || (skip && skip(f))) return;
      const r = hash(f.x * 7 + f.nx, f.y * 7 + f.nz, 91);
      if (r < F.frames) {
        // (a few of each per floor: every pair of eyes is extra drawing)
        const kind = hash(f.x, f.y, 97), watch = kind < 0.3 && nw < 6, glow = hash(f.x, f.y, 98) > 0.55, change = !watch && !glow && kind > 0.55 && nc < 6;
        if (watch) nw++; else if (change) nc++;
        list.push({ f, kind: 'portrait', watch, glow, change, pick: (hash(f.x, f.y, 99) * 3) | 0, y: watch ? 1.66 : 1.72 });
      } else if (r < F.frames + 0.045) list.push({ f, kind: 'word', text: DECAL_WORDS[(hash(f.x, f.y, 92) * DECAL_WORDS.length) | 0], y: 1.2 + hash(f.x, f.y, 93) * 0.6, rz: (hash(f.x, f.y, 94) - 0.5) * 0.25 });
    });
  }
  for (const d of list) {
    const f = d.f; if (!f) continue;
    const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, rot = Math.atan2(f.nx, f.nz);
    if (d.kind === 'portrait') {
      const watch = d.watch, glow = d.glow;
      const m = new THREE.Mesh(watch ? wGeoBig : pGeo, watch ? wMat : glow ? eMat : pMats ? pMats[d.pick % 3] : pMat);
      if (P && glow && !watch) for (const k of [0, 1]) { const q = new THREE.Mesh(dotGeo, glowDot); q.position.set(P.eyes[k][0], P.eyes[k][1], 0.002); m.add(q); }   // (glowing eyes)
      m.position.set(cx + f.nx * 0.015, d.y, cz + f.nz * 0.015); m.rotation.y = rot; G.add(m);
      if (watch) {               // (eye positions: where the eyes are painted in portraitTexture, scaled to this frame)
        const eyes = [makeEye(...eyeAt(0)), makeEye(...eyeAt(1))]; m.add(...eyes);
        level.paintings.push({ kind: 'watch', mesh: m, eyes, x: (cx + f.nx * 0.3) / S, y: (cz + f.nz * 0.3) / S });
      } else if (d.change) level.paintings.push({ kind: 'change', mesh: m, mat: cMat, x: (cx + f.nx * 0.3) / S, y: (cz + f.nz * 0.3) / S, seen: false, away: 0, changed: false });
    } else {
      const txt = d.text || DECAL_WORDS[0];
      const mat = words[txt] || (words[txt] = new THREE.MeshLambertMaterial({ map: wordTexture(txt), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1 }));
      const m = new THREE.Mesh(wGeo, mat);
      m.position.set(cx + f.nx * 0.01, d.y, cz + f.nz * 0.01); m.rotation.y = rot; m.rotation.z = d.rz || 0;
      G.add(m);
    }
  }
}
// the paintings on every frame: watchers' eyes turn towards you; a changer you looked at, then looked away from, changes
function updatePaintings(dt) {
  if (!level || !level.paintings) return;
  const p = player, cam = camera.position;
  for (const P of level.paintings) {
    const d = Math.hypot(P.x - p.x, P.y - p.y) * S;
    if (P.kind === 'watch') {
      const near = d < 11; if (P.eyes[0].visible !== near) P.eyes.forEach(e => { e.visible = near; });
      if (!near) continue;
      const lp = P.mesh.worldToLocal(_v.copy(cam));
      for (const e of P.eyes) {
        const dx = lp.x - e.position.x, dy = lp.y - e.position.y, yaw = clamp(Math.atan2(dx, lp.z), -0.9, 0.9), pitch = clamp(Math.atan2(dy, Math.hypot(dx, lp.z)), -0.6, 0.6);
        const k = Math.min(1, dt * 5); e.rotation.y += (yaw - e.rotation.y) * k; e.rotation.x += (-pitch - e.rotation.x) * k;
      }
      P.look = Math.abs(P.eyes[0].rotation.y) + Math.abs(P.eyes[0].rotation.x);   // (for the tests)
    } else if (!P.changed || P.pending) {
      if (d > 8) { P.away = 0; continue; }
      const seen = inView(P.x, P.y, 1.7, 0.8);
      if (seen) { if (P.pending) { P.pending = false; sfx.whisper(0.07, { x: P.x, y: P.y, h: 1.7 }); addFear(0.12); } P.seen = true; P.away = 0; }
      else if (P.seen && (P.away += dt) > 2.5) { P.mesh.material = P.mat; P.changed = true; P.pending = true; }   // (while nobody's looking)
    }
  }
}
function portraitTexture(glowing) {
  const c = mkCanvas(128, 164), g = c.getContext('2d');
  g.fillStyle = '#7a602a'; g.fillRect(0, 0, 128, 164);
  g.strokeStyle = '#4a3a18'; g.lineWidth = 3; g.strokeRect(6, 6, 116, 152);
  g.fillStyle = '#1b1410'; g.fillRect(14, 14, 100, 136);
  g.fillStyle = '#0b0d18'; g.beginPath(); g.ellipse(64, 70, 36, 44, 0, 0, 7); g.fill();          // hair
  g.fillStyle = '#b9c6e4'; g.beginPath(); g.ellipse(64, 76, 22, 28, 0, 0, 7); g.fill();          // porcelain face
  g.fillStyle = '#0b0d18'; g.beginPath(); g.moveTo(40, 66); g.quadraticCurveTo(64, 40, 88, 66); g.lineTo(88, 56); g.quadraticCurveTo(64, 30, 40, 56); g.fill();
  g.fillStyle = '#2a4390'; g.beginPath(); g.moveTo(26, 150); g.quadraticCurveTo(64, 96, 102, 150); g.fill();   // blue dress
  if (glowing === 'sockets') {                    // (the watcher's real eyes sit in these)
    g.fillStyle = '#05060c'; g.beginPath(); g.arc(55, 76, 5, 0, 7); g.arc(73, 76, 5, 0, 7); g.fill();
  } else if (glowing === 'changed') {             // the same doll... wrong: black eyes running down her face, and a grin
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(55, 76, 5, 6, 0, 0, 7); g.ellipse(73, 76, 5, 6, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(54, 80); g.lineTo(52, 100); g.moveTo(74, 80); g.lineTo(76, 96); g.stroke();
    g.fillStyle = '#3a0508'; g.beginPath(); g.moveTo(48, 88); g.quadraticCurveTo(64, 104, 80, 88); g.quadraticCurveTo(64, 96, 48, 88); g.fill();
    g.strokeStyle = '#d8d0c0'; g.lineWidth = 0.8; for (let x = 52; x < 78; x += 3.5) { g.beginPath(); g.moveTo(x, 89 + Math.abs(64 - x) * -0.08 + 2); g.lineTo(x, 93); g.stroke(); }
    return toTex(c);
  } else { g.fillStyle = glowing ? '#9fe6ff' : '#05060c'; g.beginPath(); g.arc(55, 76, 3.2, 0, 7); g.arc(73, 76, 3.2, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(30,40,80,.8)'; g.lineWidth = 1; g.beginPath(); g.moveTo(70, 56); g.lineTo(74, 66); g.lineTo(71, 74); g.stroke();
  g.fillStyle = '#6a1c24'; g.fillRect(60, 92, 8, 2);
  return toTex(c);
}
function portraitEyes() {
  const c = mkCanvas(128, 164), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 164);
  g.fillStyle = '#7fd4ff'; g.beginPath(); g.arc(55, 76, 3.4, 0, 7); g.arc(73, 76, 3.4, 0, 7); g.fill();
  return toTex(c);
}
function wordTexture(txt) {
  const c = mkCanvas(256, 128), g = c.getContext('2d');
  g.font = 'bold ' + (txt.length > 6 ? 38 : 58) + 'px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(125,8,16,.85)'; g.fillText(txt, 128, 56);
  for (let k = 0; k < 6; k++) { const x = 40 + Math.random() * 176, len = 10 + Math.random() * 40; g.fillRect(x, 70, 2.5, len); g.beginPath(); g.arc(x + 1.2, 70 + len, 2.5, 0, 7); g.fill(); }
  return toTex(c);
}
function wardrobeMaterials() {
  const side = mkCanvas(128, 256), s = side.getContext('2d');
  s.fillStyle = '#3b2819'; s.fillRect(0, 0, 128, 256);
  s.strokeStyle = 'rgba(0,0,0,.35)'; s.lineWidth = 1;
  for (let x = 4; x < 128; x += 6 + Math.random() * 6) { s.beginPath(); s.moveTo(x, 0); s.bezierCurveTo(x + 4, 80, x - 4, 170, x + 2, 256); s.stroke(); }
  const door = mkCanvas(256, 512), d = door.getContext('2d');
  d.drawImage(side, 0, 0, 128, 512); d.drawImage(side, 128, 0, 128, 512);
  for (const x0 of [8, 132]) {
    d.strokeStyle = 'rgba(0,0,0,.55)'; d.lineWidth = 4; d.strokeRect(x0, 10, 116, 492);
    for (let y = 40; y < 290; y += 14) {           // louvres you can peek through
      d.fillStyle = '#080503'; d.fillRect(x0 + 12, y, 92, 6);
      d.fillStyle = 'rgba(255,220,180,.1)'; d.fillRect(x0 + 12, y + 6, 92, 2);
    }
    d.strokeStyle = 'rgba(0,0,0,.45)'; d.lineWidth = 3; d.strokeRect(x0 + 14, 318, 88, 160);
  }
  d.fillStyle = '#120b06'; d.fillRect(126, 0, 4, 512);
  d.fillStyle = '#c9a25a'; d.beginPath(); d.arc(118, 300, 5, 0, 7); d.arc(138, 300, 5, 0, 7); d.fill();
  const st = toTex(side), dt = toTex(door);
  const sideMat = new THREE.MeshLambertMaterial({ map: st, bumpMap: st, bumpScale: 2 });
  // each door leaf shows its half of the door picture, from both sides
  const half = off => { const t = dt.clone(); t.repeat.set(0.5, 1); t.offset.set(off, 0); t.needsUpdate = true;
    return new THREE.MeshLambertMaterial({ map: t, bumpMap: t, bumpScale: 3, side: THREE.DoubleSide }); };
  return { sideMat, innerMat: new THREE.MeshLambertMaterial({ color: 0x0a0604 }), leafR: half(0), leafL: half(0.5),
    leafGeo: new THREE.PlaneGeometry(0.575, 2.2), geo: new THREE.BoxGeometry(1.15, 2.25, 0.6), crown: new THREE.BoxGeometry(1.25, 0.1, 0.68) };
}
function makeWardrobe(c, wt) {
  const g = new THREE.Group(), body = new THREE.Mesh(wt.geo, [wt.sideMat, wt.sideMat, wt.sideMat, wt.sideMat, wt.innerMat, wt.sideMat]);
  body.position.y = 1.125; const crown = new THREE.Mesh(wt.crown, wt.sideMat); crown.position.y = 2.3;
  body.castShadow = body.receiveShadow = crown.castShadow = true;
  g.add(body, crown);
  // two doors on hinges at the outer edges. Seen from inside, the door on your right is at local -x.
  c.doors = []; c.swingT = -1;
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * 0.575, 1.125, 0.305);
    const leaf = new THREE.Mesh(wt.leafGeo, side < 0 ? wt.leafR : wt.leafL); leaf.position.x = -side * 0.2875; leaf.castShadow = true;
    pivot.add(leaf); g.add(pivot); c.doors.push({ pivot, leaf, side, open: 0 });
  }
  const back = TILE_M / 2 - 0.3 - 0.01;          // its back against the wall of the dead end, doors facing the way out
  g.position.set(c.x * S - c.ox * back, 0, c.y * S - c.oy * back); g.rotation.y = Math.atan2(c.ox, c.oy);
  return g;
}
// wardrobes are solid: you can't walk into one (only hide in it)
const CLOSET_FRONT = T / 2 - 0.6 / S;
function closetBlocked(x, y, r) {
  for (const c of closets) {
    const dx = x - c.x, dy = y - c.y, along = dx * c.ox + dy * c.oy, side = Math.abs(dx * c.oy - dy * c.ox);
    if (side < T / 2 && along > -T && along - r < -CLOSET_FRONT) return true;
  }
  return false;
}
// which wall of the exit tile the door is on: the back wall of the dead end (or any wall of that tile)
function exitDir() {
  const cx = exit.tx, cy = exit.ty;
  const open = DIRS.filter(([dx, dy]) => !isWall(cx + dx, cy + dy));
  const cand = DIRS.filter(([dx, dy]) => isWall(cx + dx, cy + dy));
  return cand.find(([dx, dy]) => open.some(([ox, oy]) => ox === -dx && oy === -dy)) || cand[0] || [0, -1];
}
// (a wall face is the exit door's: the face of the exit tile whose normal points away from the door's wall)
const isExitFace = f => { const [dx, dy] = exitDir(); return f.x === exit.tx && f.y === exit.ty && Math.round(f.nx) === -dx && Math.round(f.nz) === -dy; };
function makeExit(G) {
  const dir = exitDir();
  const ld = doorTexture(false), lockedMat = new THREE.MeshLambertMaterial({ map: ld, bumpMap: ld, bumpScale: 3 }), openMat = new THREE.MeshBasicMaterial({ map: doorTexture(true) });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.3), lockedMat);
  const px = exit.x * S + dir[0] * (TILE_M / 2 - 0.015), pz = exit.y * S + dir[1] * (TILE_M / 2 - 0.015);
  door.position.set(px, 1.15, pz); door.rotation.y = Math.atan2(-dir[0], -dir[1]); G.add(door);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  lamp.position.set(px - dir[0] * 0.05, 2.5, pz - dir[1] * 0.05); G.add(lamp);
  exitLight.position.set(px - dir[0] * 0.8, 1.7, pz - dir[1] * 0.8);
  level.door = { door, lamp, lockedMat, openMat, open: false };
}
function doorTexture(open) {
  const c = mkCanvas(256, 512), g = c.getContext('2d');
  g.fillStyle = '#2d1e13'; g.fillRect(0, 0, 256, 512);
  if (open) {
    g.fillStyle = '#020604'; g.fillRect(18, 18, 220, 494);
    const gl = g.createRadialGradient(128, 300, 0, 128, 300, 240); gl.addColorStop(0, 'rgba(120,255,170,.45)'); gl.addColorStop(1, 'rgba(0,40,20,0)');
    g.fillStyle = gl; g.fillRect(18, 18, 220, 494);
    g.fillStyle = '#4d3523'; g.beginPath(); g.moveTo(18, 18); g.lineTo(70, 40); g.lineTo(70, 490); g.lineTo(18, 512); g.fill();   // the door, swung open
    g.fillStyle = 'rgba(200,255,220,.9)'; g.font = 'bold 28px Georgia, serif'; g.textAlign = 'center'; g.fillText('EXIT', 150, 70);
  } else {
    g.fillStyle = '#4d3523'; g.fillRect(18, 18, 220, 494);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 4; g.strokeRect(40, 40, 76, 190); g.strokeRect(140, 40, 76, 190); g.strokeRect(40, 270, 76, 200); g.strokeRect(140, 270, 76, 200);
    for (const [a, b] of [[[20, 90], [236, 420]], [[236, 90], [20, 420]]]) {       // boards nailed across
      g.save(); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
      g.fillStyle = '#34231a'; g.fillRect(-200, -16, 400, 32); g.fillStyle = '#888'; g.fillRect(-150, -3, 6, 6); g.fillRect(144, -3, 6, 6); g.restore();
    }
    g.fillStyle = '#9a8540'; g.fillRect(112, 250, 32, 28); g.strokeStyle = '#9a8540'; g.lineWidth = 5; g.beginPath(); g.arc(128, 250, 11, Math.PI, 0); g.stroke();
  }
  return toTex(c);
}
function makeNote(n) {
  const c = mkCanvas(128, 168), g = c.getContext('2d');
  g.fillStyle = '#ddd2b8'; g.fillRect(0, 0, 128, 168);
  g.fillStyle = '#b9ad92'; g.beginPath(); g.moveTo(128, 120); g.lineTo(128, 168); g.lineTo(84, 168); g.fill();
  g.fillStyle = '#5e3e30'; for (let k = 0; k < 7; k++) g.fillRect(14, 22 + k * 16, 96 - (k % 3) * 18, 3);
  g.fillStyle = 'rgba(120,10,18,.8)'; g.fillRect(14, 140, 40, 4);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.32), new THREE.MeshLambertMaterial({ map: toTex(c), emissive: 0x2a2418 }));
  m.rotation.set(-Math.PI / 2, 0, n.rot); m.position.set(n.x * S, 0.006, n.y * S); m.receiveShadow = true;
  return m;
}
// her wet footprints: one instanced mesh, a slot per print
function makePrints() {
  const c = mkCanvas(64, 32), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(38, 16, 20, 10, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(10, 16, 8, 7, 0, 0, 7); g.fill();
  const geo = new THREE.PlaneGeometry(0.26, 0.12); geo.rotateX(-Math.PI / 2);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x1c3478, alphaMap: toTex(c), transparent: true, opacity: 0.7,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 90);
  m.frustumCulled = false; m.count = 0;
  return m;
}
