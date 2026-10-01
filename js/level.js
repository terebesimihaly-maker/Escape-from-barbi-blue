/* Escape from Barbi Blue: Building a floor in 3D: floor, walls, ceiling, wardrobes, the exit door, notes and footprints (the puzzles: js/puzzles.js).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- building a floor ---------- */
const TEX_KEYS = ['map', 'emissiveMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'lightMap', 'alphaMap', 'envMap'];
function disposeLevel() {
  if (!level) return;
  if (level.house) level.house.dispose();
  scene.remove(level.group);
  const seen = new Set();
  // (a texture marked shared outlives the floor: the portraits painted in Blender, loaded once for every floor)
  const tex = t => { if (t && t !== glowTex && !t.userData.shared && !seen.has(t)) { seen.add(t); t.dispose(); } };
  const mat = m => { if (seen.has(m)) return; seen.add(m);
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
  if (level.door) { mat(level.door.openMat); mat(level.door.lockedMat); }
  level = null;
}
function buildLevel() {
  disposeLevel();
  const F = FLOORS[floorIdx], G = new THREE.Group(), L = TILE_M;
  level = { grid, group: G, door: null, prints: null };
  const ftx = floorTexture(F);   // the floor's own picture doubles as its relief: dark seams and grout sit lower
  // (a physically based floor: varnished boards and polished tiles throw the flashlight and the lamps back at you)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(GW * L, GH * L), new THREE.MeshStandardMaterial({ map: ftx, bumpMap: ftx, bumpScale: 2.5,
    roughness: { wood: 0.5, tile: 0.28, concrete: 0.85 }[floorKind(F)], metalness: 0, color: new THREE.Color().setScalar(floorKind(F) === 'tile' ? 2.6 : 1.8) }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(GW * L / 2, 0, GH * L / 2); floor.receiveShadow = true; G.add(floor);
  const ct = ceilingTexture(F); ct.repeat.set(GW, GH);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(GW * L, GH * L), new THREE.MeshLambertMaterial({ map: ct, bumpMap: ct, bumpScale: 2 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(GW * L / 2, WALL_H, GH * L / 2); G.add(ceil);
  const faces = [];
  const wallTx = wallTexture(F);
  const walls = new THREE.Mesh(wallGeometry(faces), new THREE.MeshLambertMaterial({ map: wallTx, bumpMap: wallTx.userData.bump, bumpScale: 3,
    vertexColors: true, color: new THREE.Color().setScalar(wallKind(F) === 'tile' ? 2.2 : wallKind(F) === 'attic' ? 1.4 : 1) }));
  walls.castShadow = walls.receiveShadow = true; G.add(walls); walls.material.userData.wallSurface = true;
  // the house around the maze: woodwork, doorways, lamps, furniture and props (js/house.js)
  const pzFaces = puzzleFaces(), onPuzzleFace = f => pzFaces.has(f.x + ',' + f.y + ',' + f.nx + ',' + f.nz);   // (walls with a labyrinth box)
  const keep = new Set([...closets.map(c => Math.floor(c.x / T) + ',' + Math.floor(c.y / T)), exit.tx + ',' + exit.ty]);
  level.house = House.build(THREE, { style: F.style, L, H: WALL_H, GW, GH, isWall, faces, keep, wallMat: walls.material, hash, toTex, glowTex, exitFace: faces.find(isExitFace), doll: dollTemplate || null,
    decorFace: f => onPuzzleFace(f) || hash(f.x * 7 + f.nx, f.y * 7 + f.nz, 91) < F.frames + 0.045, quality: settings.quality, lowq: LOWQ });
  G.add(level.house.group);
  if (level.house.beam) { level.house.beam.position.copy(flash.position); camera.add(level.house.beam); }
  wallDecor(G, F, faces, level.house.doorTiles, f => onPuzzleFace(f) || isExitFace(f));   // (no picture on the exit door's wall)
  const wt = wardrobeMaterials();
  for (const c of closets) G.add(makeWardrobe(c, wt));
  makeExit(G);
  upgradeSurfaces(F, floor.material, G);                 // (the textures baked in Blender, when they've loaded: tools/blender/map_textures.py)
  buildPuzzles3D(G);                                     // the labyrinth boxes on the walls (js/puzzles.js)
  notes.forEach(n => { const o = makeNote(n); n.obj = o; G.add(o); });
  if (boardsTemplate) for (const b of creaks) G.add(makeBoard(b));    // (the loose floorboards, in 3D; otherwise painted on the floor)
  level.prints = makePrints(); G.add(level.prints);
  scene.add(G);
}

/* ---------- the surfaces baked in Blender (textures/, made by tools/blender/map_textures.py) ----------
   Colour, normal map (the relief: the gaps between boards and tiles, the grain, the wall panels) and roughness, for the floor
   and the walls of each floor of the house. Until they've loaded (or if they can't be), the painted textures stay. */
const SURFACES = [
  { floor: ['floor_wood1', 'floor_wood'], wall: ['wall_paper1', 'wall_paper'] },
  { floor: ['floor_tile2', 'floor_tile'], wall: ['wall_tile2', 'wall_tile'] },
  { floor: ['floor_concrete3', 'floor_concrete'], wall: ['wall_brick3', 'wall_brick'] },
  { floor: ['floor_wood4', 'floor_wood'], wall: ['wall_attic4', 'wall_attic'] },
  { floor: ['floor_tile5', 'floor_tile'], wall: ['wall_shop5', 'wall_shop'] },
];
const surfCache = new Map();
function surfaceSet([colour, relief]) {
  const key = colour + '|' + relief; if (surfCache.has(key)) return surfCache.get(key);
  // (the game's three.js has no TextureLoader: a plain image, wrapped as a texture)
  const one = (file, srgb) => new Promise(res => { const img = new Image();
    img.onload = () => { const t = new THREE.CanvasTexture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); };
    img.onerror = () => res(null); img.src = 'textures/' + file + '.webp'; });
  const p = Promise.all([one(colour + '_color', true), one(relief + '_normal'), one(relief + '_rough')]).then(([map, normalMap, roughnessMap]) => map && normalMap ? { map, normalMap, roughnessMap } : null);
  surfCache.set(key, p); return p;
}
function upgradeSurfaces(F, floorMat, G) {
  const set = SURFACES[floorIdx]; if (!set || settings.quality === 'low') return;   // (low quality: the painted ones, lighter)
  const lv = level;
  surfaceSet(set.floor).then(s => {
    if (!s || level !== lv) return;
    // the floor: the baked boards/tiles (one texture per tile), with the painted shade, stains and words multiplied over it
    const rep = t => { const c = t.clone(); c.repeat.set(GW, GH); c.needsUpdate = true; return c; };
    const ov = floorOverlay(F), painted = floorMat.map;
    floorMat.map = rep(s.map); floorMat.normalMap = rep(s.normalMap); floorMat.roughnessMap = s.roughnessMap && rep(s.roughnessMap);
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
  surfaceSet(set.wall).then(s => {
    if (!s || level !== lv) return;
    const mats = new Set(), painted = new Set();          // (the walls and the tops of the doorways share the painted wall and its relief)
    G.traverse(o => { const m = o.material; if (m && m.userData && m.userData.wallSurface) mats.add(m); });
    for (const m of mats) { painted.add(m.map).add(m.bumpMap);
      m.map = s.map.clone(); m.normalMap = s.normalMap.clone(); m.bumpMap = null; m.color.setScalar(1.15); m.needsUpdate = true; }   // (clones: the level's own, disposed with it)
    for (const t of painted) if (t) t.dispose();
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
function floorTexture(F) {
  const res = Math.min(2, (LOWQ ? 1536 : 2048) / (Math.max(GW, GH) * T));
  const c = mkCanvas(Math.ceil(GW * T * res), Math.ceil(GH * T * res)), g = c.getContext('2d');
  g.setTransform(res * T / PT, 0, 0, res * T / PT, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, GW * PT, GH * PT);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!grid[y][x]) paintFloor(g, F, x, y);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!grid[y][x]) paintShade(g, x, y);
  for (const d of decals) paintDecal(g, d);
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
function wallDecor(G, F, faces, doorTiles, skip) {
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
  const exitFace = f => f.x === exit.tx && f.y === exit.ty;
  const inWardrobe = new Set(closets.map(c => Math.floor(c.x / T) + ',' + Math.floor(c.y / T)));   // (nothing on the walls of a wardrobe's dead end: it would hang inside it)
  faces.forEach((f, i) => {
    if (exitFace(f) || inWardrobe.has(f.x + ',' + f.y) || (doorTiles && doorTiles.has(f.x + ',' + f.y)) || (skip && skip(f))) return;
    const r = hash(f.x * 7 + f.nx, f.y * 7 + f.nz, 91), cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, rot = Math.atan2(f.nx, f.nz);
    if (r < F.frames) {
      // (a few of each per floor: every pair of eyes is extra drawing)
      const kind = hash(f.x, f.y, 97), nw = level.paintings.filter(q => q.kind === 'watch').length, nc = level.paintings.length - nw;
      const watch = kind < 0.3 && nw < 6, glow = hash(f.x, f.y, 98) > 0.55;
      const m = new THREE.Mesh(watch ? wGeoBig : pGeo, watch ? wMat : glow ? eMat : pMats ? pMats[(hash(f.x, f.y, 99) * 3) | 0] : pMat);
      if (P && glow && !watch) for (const k of [0, 1]) { const d = new THREE.Mesh(dotGeo, glowDot); d.position.set(P.eyes[k][0], P.eyes[k][1], 0.002); m.add(d); }   // (glowing eyes)
      m.position.set(cx + f.nx * 0.015, watch ? 1.66 : 1.72, cz + f.nz * 0.015); m.rotation.y = rot; G.add(m);
      if (watch) {               // (eye positions: where the eyes are painted in portraitTexture, scaled to this frame)
        const eyes = [makeEye(...eyeAt(0)), makeEye(...eyeAt(1))]; m.add(...eyes);
        level.paintings.push({ kind: 'watch', mesh: m, eyes, x: (cx + f.nx * 0.3) / S, y: (cz + f.nz * 0.3) / S });
      } else if (!glow && kind > 0.55 && nc < 6) level.paintings.push({ kind: 'change', mesh: m, mat: cMat, x: (cx + f.nx * 0.3) / S, y: (cz + f.nz * 0.3) / S, seen: false, away: 0, changed: false });
    } else if (r < F.frames + 0.045) {
      const txt = DECAL_WORDS[(hash(f.x, f.y, 92) * DECAL_WORDS.length) | 0];
      const mat = words[txt] || (words[txt] = new THREE.MeshLambertMaterial({ map: wordTexture(txt), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1 }));
      const m = new THREE.Mesh(wGeo, mat);
      m.position.set(cx + f.nx * 0.01, 1.2 + hash(f.x, f.y, 93) * 0.6, cz + f.nz * 0.01); m.rotation.y = rot; m.rotation.z = (hash(f.x, f.y, 94) - 0.5) * 0.25;
      G.add(m);
    }
  });
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
