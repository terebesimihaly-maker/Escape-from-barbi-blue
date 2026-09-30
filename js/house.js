/* The house around the maze: woodwork, doorways, lamps that really light the rooms, furniture and props.
   The maze itself (walls, floor, ceiling) is built in index.html; this dresses it, floor by floor:
     nursery  - painted skirting and rails, pink wall lamps, porcelain dolls (their heads turn when you look away),
                teddy bears, toy blocks, rugs
     hallway  - dark wood, brass candle sconces, side tables with vases and candles, grandfather clocks, a runner carpet
     basement - rusty pipes, bare hanging bulbs, crates, barrels, wet puddles
     attic    - bare bulbs, furniture under dust sheets, old trunks, cobwebs, a few dolls
     workshop - green-shaded lamps, workbenches covered in doll parts, shelves of doll heads, dress forms, dolls hanging on strings
   Usage: const h = House.build(THREE, env); scene.add(h.group); every frame: h.update(dt, t, camera, player);
   env: { style, L (tile, m), H (wall height), GW, GH, isWall(x,y), faces, keep (Set of 'x,y' tiles to leave empty),
          wallMat, hash, toTex, glowTex, quality: 'low'|'medium'|'high', lowq (true on phones) } */
(function () {
'use strict';

const TAU = Math.PI * 2;

// a tiny geometry merger: many small pieces -> one mesh per material (fewer draw calls)
class Merge {
  constructor(THREE) { this.T = THREE; this.P = []; this.N = []; this.U = []; this.I = []; }
  add(geo, m4, uv) {                                     // (uv: [scaleU, offsetU, scaleV, offsetV], optional)
    const g = geo.index ? geo : geo.toNonIndexed(), p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    const base = this.P.length / 3, v = new this.T.Vector3(), nm = new this.T.Matrix3().getNormalMatrix(m4);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m4); this.P.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); this.N.push(v.x, v.y, v.z);
      if (u) this.U.push(uv ? u.getX(i) * uv[0] + uv[1] : u.getX(i), uv ? u.getY(i) * uv[2] + uv[3] : u.getY(i)); else this.U.push(0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.I.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.I.push(base + i);
    geo.dispose();
  }
  box(w, h, d, x, y, z, ry, rx, uv) { const m = new this.T.Matrix4().compose(new this.T.Vector3(x, y, z),
    new this.T.Quaternion().setFromEuler(new this.T.Euler(rx || 0, ry || 0, 0, 'YXZ')), new this.T.Vector3(1, 1, 1));
    this.add(new this.T.BoxGeometry(w, h, d), m, uv); }
  mesh(mat, shadow) {
    if (!this.I.length) return null;
    const g = new this.T.BufferGeometry();
    g.setAttribute('position', new this.T.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new this.T.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new this.T.Float32BufferAttribute(this.U, 2));
    g.setIndex(this.I);
    const m = new this.T.Mesh(g, mat); m.castShadow = !!shadow; m.receiveShadow = true;
    return m;
  }
}

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function noiseFill(g, w, h, n, a, dark) {
  for (let k = 0; k < n; k++) { g.fillStyle = 'rgba(' + (dark ? '0,0,0' : '255,255,255') + ',' + (Math.random() * a) + ')';
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
}
function woodCanvas(base, w, h, vertical) {
  const c = mk(w, h), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 1;
  for (let i = 0; i < (vertical ? w : h); i += 3 + Math.random() * 5) { g.beginPath();
    if (vertical) { g.moveTo(i, 0); g.bezierCurveTo(i + 3, h * 0.3, i - 3, h * 0.7, i + 1, h); }
    else { g.moveTo(0, i); g.bezierCurveTo(w * 0.3, i + 2, w * 0.7, i - 2, w, i + 1); }
    g.stroke(); }
  noiseFill(g, w, h, w * h / 30, 0.08, true);
  return c;
}

function build(THREE, env) {
  const { style, L, H, isWall, faces, hash } = env;
  const group = new THREE.Group(), fixtures = [], dolls = [], clocks = [];
  const lowq = env.lowq, dens = env.quality === 'low' ? 0.45 : lowq ? 0.75 : 1;
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0 }, o));
  const tex = (c, rep) => env.toTex(c, rep);
  const cellOf = f => f.x + ',' + f.y;
  // a wall side that already has something on it (a picture, the exit, a wardrobe, a door frame) gets no lamp or furniture
  const busy = f => env.keep.has(cellOf(f)) || doorTiles.has(cellOf(f)) || (env.decorFace && env.decorFace(f));
  const P = {                                           // per floor: colours of the woodwork and the lamps
    wood:     { trim: '#9e927e', rail: '#8f8470', lamp: 0xffc9b8, shade: '#f2b8c6', light: 0xffc0a8 },
    tile:     { trim: '#3b2718', rail: '#2f1f13', lamp: 0xffcf8a, shade: '#e6c07a', light: 0xffc47a },
    concrete: { trim: '#3a3631', rail: '#2c2925', lamp: 0xfff1d0, shade: '#fff4dc', light: 0xffe9c8 },
    attic:    { trim: '#2e2218', rail: '#2e2218', lamp: 0xffe6b8, shade: '#fff0d0', light: 0xffd9a8 },
    workshop: { trim: '#2a1d14', rail: '#3a2a1e', lamp: 0xf4ffd8, shade: '#2f5a36', light: 0xf0f2c8 },
  }[style];
  const bulbs = style === 'concrete' || style === 'attic' || style === 'workshop';

  /* ---------- woodwork: skirting, chair rail, crown molding (real geometry, so it catches the light) ---------- */
  const trimTex = tex(woodCanvas(P.trim, 256, 32, false), true);
  const trimMat = std({ map: trimTex, roughness: style === 'wood' ? 0.45 : 0.55 });
  const trim = new Merge(THREE);
  const strip = (f, y0, y1, d, slope, a0 = 0, a1 = 1) => {
    if (!slope && f === env.exitFace && y0 < 2.45) {       // (the exit door's wall: the trim stops either side of the door)
      if (a0 === 0 && a1 === 1) { strip(f, y0, y1, d, slope, 0, 0.19); strip(f, y0, y1, d, slope, 0.81, 1); }
      if (a0 === 0 && a1 === 1) return;
    }
    const full = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), len = full * (a1 - a0), am = (a0 + a1) / 2;
    const cx = f.x0 + (f.x1 - f.x0) * am, cz = f.z0 + (f.z1 - f.z0) * am, ry = Math.atan2(f.nx, f.nz);
    if (slope) {                                         // crown molding: a sloped board under the ceiling
      const g = new THREE.BoxGeometry(len + 0.02, (y1 - y0) * 1.35, 0.02);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx + f.nx * d * 0.5, (y0 + y1) / 2, cz + f.nz * d * 0.5),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      trim.add(g, m); return;
    }
    trim.box(len + 0.02, y1 - y0, d, cx + f.nx * d / 2, (y0 + y1) / 2, cz + f.nz * d / 2, ry);
  };
  for (const f of faces) {
    if (style === 'concrete') strip(f, 0, 0.1, 0.04);    // (a concrete curb in the basement)
    else if (style === 'attic') strip(f, 0, 0.09, 0.02);  // (a plain floor board)
    else { strip(f, 0, 0.16, 0.026); strip(f, 0.155, 0.175, 0.034); }
    if (style === 'wood') strip(f, 0.93, 0.98, 0.03);
    if (style === 'tile') strip(f, 0.84, 0.9, 0.028);
    if (style === 'workshop') strip(f, 0.93, 0.97, 0.05);
    if (style !== 'concrete' && style !== 'attic') strip(f, H - 0.12, H, 0.1, true);
  }
  if (env.exitFace) {                                       // a proper frame round the exit door
    const f = env.exitFace, tx = f.x1 - f.x0, tz = f.z1 - f.z0, tl = Math.hypot(tx, tz), cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, ry = Math.atan2(f.nx, f.nz);
    for (const s of [-1, 1]) trim.box(0.11, 2.42, 0.05, cx + tx / tl * s * 0.63 + f.nx * 0.025, 1.21, cz + tz / tl * s * 0.63 + f.nz * 0.025, ry);
    trim.box(1.37, 0.13, 0.055, cx + f.nx * 0.0275, 2.4, cz + f.nz * 0.0275, ry);
  }

  /* ---------- doorways: between the rooms of the maze, a framed opening with a header wall above it ---------- */
  const frame = new Merge(THREE), header = new Merge(THREE), doorTiles = new Set();
  const DOOR_H = 2.6;                                     // (she is tall: her head clears it)
  for (let y = 1; y < env.GH - 1; y++) for (let x = 1; x < env.GW - 1; x++) {
    if (isWall(x, y) || (x + y) % 2 === 0) continue;       // (connecting tiles sit between the maze's cells)
    const ns = isWall(x - 1, y) && isWall(x + 1, y), ew = isWall(x, y - 1) && isWall(x, y + 1);
    if (!ns && !ew) continue;
    if (hash(x, y, 311) > 0.72 || env.keep.has(x + ',' + y)) continue;   // most of them
    doorTiles.add(x + ',' + y);
    const cx = (x + 0.5) * L, cz = (y + 0.5) * L, ry = ns ? 0 : Math.PI / 2;
    const off = (a, b) => ns ? [cx + a, cz + b] : [cx + b, cz + a];   // (a across the passage, b along it)
    header.box(L, H - DOOR_H, 0.28, cx, (H + DOOR_H) / 2, cz, ry, 0, [1, 0, (H - DOOR_H) / H, DOOR_H / H]);   // the top of the wallpaper
    for (const s of [-1, 1]) { const [px, pz] = off(s * (L / 2 - 0.055), 0); frame.box(0.11, DOOR_H + 0.06, 0.34, px, (DOOR_H + 0.06) / 2, pz, ry); }
    frame.box(L, 0.12, 0.34, cx, DOOR_H + 0.03, cz, ry);
  }
  const frameMat = std({ map: tex(woodCanvas({ wood: '#a39680', tile: '#3a2616', concrete: '#3a2c20', attic: '#3a2a1c', workshop: '#2a1d14' }[style], 64, 256, true), true), roughness: 0.7 });
  const headerMat = env.wallMat.clone(); headerMat.vertexColors = false; headerMat.userData = { wallSurface: true };   // (the walls' own corner shading doesn't apply here)
  [trim.mesh(trimMat, false), frame.mesh(frameMat, true), header.mesh(headerMat, true)].forEach(m => { if (m) group.add(m); });

  /* ---------- lamps ---------- */
  const fixMetal = std({ color: style === 'concrete' ? 0x2a2622 : 0x8a6a2e, metalness: 0.8, roughness: 0.35 });
  const fixStatic = new Merge(THREE), lampFaces = new Set();
  const addFixture = (x, y, z, kind) => {
    const r = Math.random(), state = r < 0.12 ? 'dead' : r < 0.32 ? 'flicker' : 'ok';
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: P.lamp, emissiveIntensity: state === 'dead' ? 0.05 : 1.6, roughness: 0.6 });
    let glowObj;
    if (kind === 'bulb') glowObj = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mat);
    else if (kind === 'candle') { glowObj = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.045, 8), mat); }
    else glowObj = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.14, 14, 1, true), mat);
    glowObj.position.set(x, y, z); group.add(glowObj);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: env.glowTex, color: new THREE.Color(P.lamp).multiplyScalar(kind === 'shade' ? 1.3 : 2), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: state === 'dead' ? 0 : 0.5 }));
    glow.position.set(x, y, z); glow.scale.setScalar(kind === 'candle' ? 0.35 : 0.45); group.add(glow);
    fixtures.push({ pos: new THREE.Vector3(x, y, z), mat, glow, state, phase: Math.random() * 100, base: kind === 'candle' ? 0.6 : 1, level: 1, em: kind === 'shade' ? 0.9 : 1.8 });
  };
  const fixDen = { wood: 0.16, tile: 0.2 }[style] || 0;
  for (const f of faces) {
    if (busy(f) || hash(f.x * 5 + f.nx, f.y * 5 + f.nz, 95) > fixDen) continue;
    const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, ry = Math.atan2(f.nx, f.nz);
    lampFaces.add(f);
    if (style === 'wood') {                               // a wall lamp with a fabric shade
      fixStatic.box(0.09, 0.16, 0.03, cx + f.nx * 0.015, 1.95, cz + f.nz * 0.015, ry);
      fixStatic.box(0.02, 0.02, 0.18, cx + f.nx * 0.1, 1.97, cz + f.nz * 0.1, ry);
      addFixture(cx + f.nx * 0.2, 2.02, cz + f.nz * 0.2, 'shade');
    } else {                                              // a brass sconce with two candles
      fixStatic.box(0.1, 0.22, 0.03, cx + f.nx * 0.015, 1.85, cz + f.nz * 0.015, ry);
      const tx = -f.nz, tz = f.nx;
      for (const s of [-1, 1]) {
        const px = cx + f.nx * 0.14 + tx * s * 0.1, pz = cz + f.nz * 0.14 + tz * s * 0.1;
        fixStatic.box(0.018, 0.018, 0.16, cx + f.nx * 0.08 + tx * s * 0.05, 1.8, cz + f.nz * 0.08 + tz * s * 0.05, ry + s * 0.5);
        fixStatic.box(0.05, 0.015, 0.05, px, 1.83, pz, 0);
        fixStatic.box(0.024, 0.12, 0.024, px, 1.9, pz, 0);
        addFixture(px, 1.985, pz, 'candle');
      }
    }
  }
  const shades = new Merge(THREE);
  if (bulbs) {                                            // lamps hanging from the ceiling: bare bulbs, or (workshop) under a green metal shade
    for (let y = 1; y < env.GH; y += 2) for (let x = 1; x < env.GW; x += 2) {
      if (isWall(x, y) || hash(x, y, 97) > (style === 'workshop' ? 0.36 : 0.3)) continue;
      const cx = (x + 0.5) * L, cz = (y + 0.5) * L;
      fixStatic.box(0.008, 0.55, 0.008, cx, H - 0.27, cz, 0); fixStatic.box(0.05, 0.05, 0.05, cx, H - 0.56, cz, 0);
      if (style === 'workshop') { const g = new THREE.CylinderGeometry(0.05, 0.24, 0.16, 16, 1, true); shades.add(g, new THREE.Matrix4().makeTranslation(cx, H - 0.64, cz)); }
      addFixture(cx, H - 0.63, cz, 'bulb');
    }
  }
  const shm = shades.mesh(std({ color: 0x2f5a36, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide }), false); if (shm) group.add(shm);
  const fs = fixStatic.mesh(fixMetal, false); if (fs) group.add(fs);
  // the closest lamps get real lights (a small pool, moved around as you walk)
  const poolN = env.quality === 'low' ? 0 : lowq || env.quality === 'medium' ? 2 : 4;
  const pool = [];
  for (let i = 0; i < poolN; i++) { const l = new THREE.PointLight(P.light, 0, 6.5, 1.6); l.userData.fix = null; group.add(l); pool.push(l); }

  /* ---------- rugs and carpets ---------- */
  if (style === 'tile') {                                 // a long runner down the middle of the hallways
    const c = mk(64, 256), g = c.getContext('2d');
    g.fillStyle = '#5a1216'; g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#c99a3a'; g.fillRect(4, 0, 3, 256); g.fillRect(57, 0, 3, 256);
    g.fillStyle = '#2a0709'; g.fillRect(9, 0, 2, 256); g.fillRect(53, 0, 2, 256);
    for (let y = 0; y < 256; y += 32) { g.fillStyle = '#8a2a22'; g.beginPath(); g.moveTo(32, y + 4); g.lineTo(46, y + 16); g.lineTo(32, y + 28); g.lineTo(18, y + 16); g.fill();
      g.fillStyle = '#c99a3a'; g.beginPath(); g.arc(32, y + 16, 3, 0, TAU); g.fill(); }
    noiseFill(g, 64, 256, 900, 0.12, true);
    const rt = tex(c, true), rugMat = std({ map: rt, roughness: 0.95 });
    const rug = new Merge(THREE);
    for (let y = 1; y < env.GH - 1; y++) for (let x = 1; x < env.GW - 1; x++) {
      if (isWall(x, y)) continue;
      const hx = !isWall(x - 1, y) || !isWall(x + 1, y), vz = !isWall(x, y - 1) || !isWall(x, y + 1);
      const cx = (x + 0.5) * L, cz = (y + 0.5) * L;
      if (hx) { const g2 = new THREE.PlaneGeometry(0.75, L + (vz ? 0 : 0.01)); g2.rotateX(-Math.PI / 2); g2.rotateY(Math.PI / 2);
        rug.add(g2, new THREE.Matrix4().makeTranslation(cx, 0.004, cz)); }
      if (vz) { const g2 = new THREE.PlaneGeometry(0.75, L); g2.rotateX(-Math.PI / 2);
        rug.add(g2, new THREE.Matrix4().makeTranslation(cx, 0.005, cz)); }
    }
    const rm = rug.mesh(rugMat, false); if (rm) group.add(rm);
  }
  if (style === 'wood') {                                 // round pastel rugs in some rooms
    const c = mk(256, 256), g = c.getContext('2d');
    const ring = ['#d9a8b4', '#f2d7c9', '#b98796', '#e9c3c9', '#caa0ae'];
    for (let i = 0; i < 9; i++) { g.fillStyle = ring[i % ring.length]; g.beginPath(); g.arc(128, 128, 126 - i * 13, 0, TAU); g.fill(); }
    noiseFill(g, 256, 256, 4000, 0.1, true);
    const rugMat = std({ map: tex(c), transparent: true, alphaTest: 0.5, roughness: 1 });
    const circ = mk(256, 256).getContext('2d');
    for (let y = 1; y < env.GH; y += 2) for (let x = 1; x < env.GW; x += 2) {
      if (isWall(x, y) || env.keep.has(x + ',' + y) || hash(x, y, 120) > 0.35 * dens) continue;
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), rugMat);
      m.rotation.x = -Math.PI / 2; m.position.set((x + 0.5) * L, 0.004, (y + 0.5) * L); m.receiveShadow = true; group.add(m);
    }
  }
  if (style === 'concrete') {                             // wet puddles: they catch the flashlight
    const c = mk(128, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 62); gr.addColorStop(0, '#fff'); gr.addColorStop(0.7, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath();
    for (let a = 0; a <= TAU + 0.01; a += 0.3) { const r = 44 + Math.random() * 18; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.fill();
    const puddle = std({ color: 0x0c0e10, roughness: 0.04, metalness: 0.2, alphaMap: tex(c), transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let y = 1; y < env.GH - 1; y++) for (let x = 1; x < env.GW - 1; x++) {
      if (isWall(x, y) || hash(x, y, 130) > 0.18) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9 + hash(x, y, 131) * 0.8, 0.7 + hash(x, y, 132) * 0.6), puddle);
      m.rotation.set(-Math.PI / 2, 0, hash(x, y, 133) * 3); m.position.set((x + 0.2 + hash(x, y, 134) * 0.6) * L, 0.006, (y + 0.2 + hash(x, y, 135) * 0.6) * L);
      group.add(m);
    }
  }

  /* ---------- pipes in the basement ---------- */
  if (style === 'concrete') {
    const pipes = new Merge(THREE);
    for (const f of faces) {
      const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      const along = new THREE.Vector3(f.x1 - f.x0, 0, f.z1 - f.z0).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
      for (const [h, r, d] of [[2.62, 0.055, 0.12], [2.78, 0.035, 0.09]]) {
        if (hash(f.x, f.y, 140 + h * 10) > 0.8) continue;
        pipes.add(new THREE.CylinderGeometry(r, r, len + 0.02, 10), new THREE.Matrix4().compose(new THREE.Vector3(cx + f.nx * d, h, cz + f.nz * d), q, new THREE.Vector3(1, 1, 1)));
      }
      if (hash(f.x, f.y, 150) < 0.12) pipes.add(new THREE.CylinderGeometry(0.045, 0.045, H, 10), new THREE.Matrix4().makeTranslation(cx + f.nx * 0.1, H / 2, cz + f.nz * 0.1));
    }
    const pm = pipes.mesh(std({ map: tex(rustCanvas(), true), metalness: 0.55, roughness: 0.55 }), true); if (pm) group.add(pm);
  }

  /* ---------- furniture and props, against the walls (never deep enough to get in anyone's way) ---------- */
  const spots = [];
  for (const f of faces) if (!busy(f) && !lampFaces.has(f)) spots.push(f);
  const placeAt = (f, along, depth) => {
    const tx = -f.nz, tz = f.nx, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    return { x: cx + tx * along + f.nx * depth, z: cz + tz * along + f.nz * depth, ry: Math.atan2(f.nx, f.nz) };
  };
  const woodMat = std({ map: tex(woodCanvas(style === 'tile' ? '#4a2c18' : style === 'wood' ? '#8a6446' : '#6b5238', 128, 128, true), true), roughness: 0.6 });
  if (style === 'wood') {
    const blocks = new Merge(THREE), bears = [];
    spots.forEach((f, i) => {
      const r = hash(f.x * 3 + f.nx, f.y * 3 + f.nz, 160);
      if (r < 0.1 * dens) { const p = placeAt(f, (hash(f.x, f.y, 161) - 0.5) * 0.9, 0.22); dolls.push(makeDoll(THREE, env, p, i)); }
      else if (r < 0.17 * dens) { const p = placeAt(f, (hash(f.x, f.y, 162) - 0.5) * 0.9, 0.2); group.add(makeBear(THREE, p)); }
      else if (r < 0.27 * dens) {                         // a few toy blocks, some stacked
        const p = placeAt(f, (hash(f.x, f.y, 163) - 0.5) * 1.0, 0.28), n = 1 + (hash(f.x, f.y, 164) * 4 | 0);
        for (let k = 0; k < n; k++) { const s = 0.11; blocks.box(s, s, s, p.x + (k % 2) * 0.13 * Math.cos(p.ry), s / 2 + (k >> 1) * s, p.z - (k % 2) * 0.13 * Math.sin(p.ry), p.ry + k * 0.4); }
      }
    });
    const bm = blocks.mesh(std({ map: tex(blocksCanvas()), roughness: 0.6 }), true); if (bm) group.add(bm);
  }
  if (style === 'tile') {
    const tables = new Merge(THREE);
    spots.forEach((f, i) => {
      const r = hash(f.x * 3 + f.nx, f.y * 3 + f.nz, 170);
      if (r < 0.1 * dens) {                               // a side table with a vase, or a candle, or a doll sitting on it
        const p = placeAt(f, (hash(f.x, f.y, 171) - 0.5) * 0.6, 0.2), c = Math.cos(p.ry), s = Math.sin(p.ry);
        tables.box(0.62, 0.04, 0.34, p.x, 0.8, p.z, p.ry);
        tables.box(0.56, 0.1, 0.3, p.x, 0.73, p.z, p.ry);
        for (const [a, b] of [[-0.27, -0.13], [0.27, -0.13], [-0.27, 0.13], [0.27, 0.13]]) tables.box(0.035, 0.78, 0.035, p.x + a * c + b * s, 0.39, p.z - a * s + b * c, p.ry);
        const what = hash(f.x, f.y, 172);
        if (what < 0.4) group.add(makeVase(THREE, p.x, 0.82, p.z));
        else if (what < 0.7) { tables.box(0.07, 0.02, 0.07, p.x, 0.83, p.z, 0); tables.box(0.03, 0.16, 0.03, p.x, 0.92, p.z, 0); addFixture(p.x, 1.02, p.z, 'candle'); }
        else dolls.push(makeDoll(THREE, env, { x: p.x, z: p.z, ry: p.ry, y: 0.82 }, i));
      } else if (r < 0.13 * dens) {                       // a grandfather clock
        const p = placeAt(f, 0, 0.19);
        clocks.push(makeClock(THREE, p, woodMat)); group.add(clocks[clocks.length - 1].obj);
      }
    });
    const tm = tables.mesh(woodMat, true); if (tm) group.add(tm);
  }
  if (style === 'concrete') {
    const crates = new Merge(THREE), barrels = new Merge(THREE);
    spots.forEach(f => {
      const r = hash(f.x * 3 + f.nx, f.y * 3 + f.nz, 180);
      if (r < 0.14 * dens) {
        const p = placeAt(f, (hash(f.x, f.y, 181) - 0.5) * 0.7, 0.21);
        crates.box(0.4, 0.4, 0.4, p.x, 0.2, p.z, p.ry + (hash(f.x, f.y, 182) - 0.5) * 0.3);
        if (hash(f.x, f.y, 183) < 0.5) crates.box(0.32, 0.32, 0.32, p.x, 0.56, p.z, p.ry + 0.3);
      } else if (r < 0.22 * dens) {
        const p = placeAt(f, (hash(f.x, f.y, 184) - 0.5) * 0.8, 0.23);
        barrels.add(new THREE.CylinderGeometry(0.2, 0.2, 0.82, 16), new THREE.Matrix4().makeTranslation(p.x, 0.41, p.z));
      }
    });
    const cm = crates.mesh(std({ map: tex(crateCanvas()), roughness: 0.8 }), true); if (cm) group.add(cm);
    const bm = barrels.mesh(std({ map: tex(barrelCanvas(), true), metalness: 0.35, roughness: 0.6 }), true); if (bm) group.add(bm);
  }
  const swingers = [];                                    // (dolls hanging on strings: they sway)
  if (style === 'attic') {
    // furniture under dust sheets (a tapered shape, like a sheet thrown over a chair or a cabinet), old trunks, a few dolls
    const sheets = new Merge(THREE), trunks = new Merge(THREE);
    spots.forEach((f, i) => {
      const r = hash(f.x * 3 + f.nx, f.y * 3 + f.nz, 190);
      if (r < 0.14 * dens) { const tall = hash(f.x, f.y, 191) < 0.35, p = placeAt(f, (hash(f.x, f.y, 192) - 0.5) * 0.7, 0.3);
        const g = new THREE.CylinderGeometry(tall ? 0.24 : 0.28, tall ? 0.38 : 0.44, tall ? 1.7 : 0.9, 4, 1); g.rotateY(Math.PI / 4);
        sheets.add(g, new THREE.Matrix4().compose(new THREE.Vector3(p.x, tall ? 0.85 : 0.45, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.ry + (hash(f.x, f.y, 193) - 0.5) * 0.3, 0)), new THREE.Vector3(1, 1, 0.75))); }
      else if (r < 0.22 * dens) { const p = placeAt(f, (hash(f.x, f.y, 194) - 0.5) * 0.7, 0.24);
        trunks.box(0.8, 0.42, 0.42, p.x, 0.21, p.z, p.ry); trunks.box(0.82, 0.06, 0.44, p.x, 0.45, p.z, p.ry); }
      else if (r < 0.28 * dens) { const p = placeAt(f, (hash(f.x, f.y, 195) - 0.5) * 0.8, 0.22); dolls.push(makeDoll(THREE, env, p, i)); }
    });
    const sm = sheets.mesh(std({ map: tex(clothCanvas('#b8b0a0'), true), roughness: 0.95 }), true); if (sm) group.add(sm);
    const tm = trunks.mesh(std({ map: tex(crateCanvas()), color: 0x8a6a4a, roughness: 0.7 }), true); if (tm) group.add(tm);
    // cobwebs across the top corners
    const web = std({ map: tex(webCanvas()), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, roughness: 1, depthWrite: false });
    for (const f of faces) { if (hash(f.x * 5 + f.nx, f.y * 5 + f.nz, 196) > 0.14) continue;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), web), end = hash(f.x, f.y, 197) < 0.5 ? 0 : 1;
      const ex = end ? f.x1 : f.x0, ez = end ? f.z1 : f.z0, tx = f.x1 - f.x0, tz = f.z1 - f.z0, tl = Math.hypot(tx, tz);
      w.position.set(ex - (end ? 1 : -1) * tx / tl * 0.25 + f.nx * 0.25, H - 0.25, ez - (end ? 1 : -1) * tz / tl * 0.25 + f.nz * 0.25);
      w.rotation.set(0, Math.atan2(f.nx, f.nz) + (end ? -1 : 1) * Math.PI / 4, 0); group.add(w); }
  }
  if (style === 'workshop') {
    const bench = new Merge(THREE), shelf = new Merge(THREE), parts = new Merge(THREE), heads = [], forms = [];
    spots.forEach((f, i) => {
      const r = hash(f.x * 3 + f.nx, f.y * 3 + f.nz, 200), p0 = placeAt(f, 0, 0);
      if (r < 0.12 * dens) {                              // a workbench with doll parts on it
        const p = placeAt(f, (hash(f.x, f.y, 201) - 0.5) * 0.4, 0.26), c = Math.cos(p.ry), s = Math.sin(p.ry);
        bench.box(1.1, 0.05, 0.48, p.x, 0.86, p.z, p.ry);
        for (const [a, b] of [[-0.5, -0.2], [0.5, -0.2], [-0.5, 0.2], [0.5, 0.2]]) bench.box(0.05, 0.84, 0.05, p.x + a * c + b * s, 0.42, p.z - a * s + b * c, p.ry);
        for (let k = 0; k < 4; k++) { const a = (hash(f.x, f.y, 202 + k) - 0.5) * 0.9, b = (hash(f.x, f.y, 206 + k) - 0.5) * 0.3, x = p.x + a * c + b * s, z = p.z - a * s + b * c;
          if (k % 2) heads.push([x, 0.92, z, p.ry + hash(f.x, f.y, 210 + k) * 3]);
          else parts.add(new THREE.CylinderGeometry(0.018, 0.022, 0.22, 8), new THREE.Matrix4().compose(new THREE.Vector3(x, 0.9, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, hash(f.x, f.y, 214 + k) * 3, 0)), new THREE.Vector3(1, 1, 1))); }
      } else if (r < 0.26 * dens) {                       // shelves on the wall, lined with doll heads
        const along = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) * 0.8;
        for (const h of [1.3, 1.78]) { const p = placeAt(f, 0, 0.13); shelf.box(along, 0.03, 0.24, p.x, h, p.z, p.ry);
          const n = 5 + (hash(f.x, f.y, 220 + h * 10) * 3 | 0);
          for (let k = 0; k < n; k++) { const q = placeAt(f, (k / (n - 1) - 0.5) * along * 0.9, 0.13); heads.push([q.x, h + 0.085, q.z, q.ry + (hash(f.x + k, f.y, 230) - 0.5) * 0.6]); } }
      } else if (r < 0.31 * dens) { forms.push(placeAt(f, (hash(f.x, f.y, 240) - 0.5) * 0.7, 0.3)); }   // a dress form
    });
    const bm = bench.mesh(woodMat, true); if (bm) group.add(bm);
    const sm = shelf.mesh(woodMat, true); if (sm) group.add(sm);
    const porcelain = std({ color: 0xf2ebe4, roughness: 0.25 });
    const pm = parts.mesh(porcelain, true); if (pm) group.add(pm);
    if (heads.length) {                                   // all the heads: one instanced mesh (one draw call)
      const faceTex = env.toTex(dollFaceCanvas(false)); faceTex.offset.set(0.25, 0);
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 16, 12), std({ map: faceTex, roughness: 0.3 }), heads.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      heads.forEach(([x, y, z, ry], i) => { q.setFromEuler(e.set(0, ry, 0)); m4.compose(v.set(x, y, z), q, one); im.setMatrixAt(i, m4); });
      im.castShadow = true; group.add(im);
    }
    const fabric = std({ color: 0x6a5a4a, roughness: 0.9 }), metal = std({ color: 0x222222, metalness: 0.7, roughness: 0.4 });
    const torso = new THREE.LatheGeometry([[0, 0], [0.17, 0.02], [0.2, 0.18], [0.16, 0.36], [0.19, 0.55], [0.14, 0.68], [0.05, 0.74], [0, 0.76]].map(([a, b]) => new THREE.Vector2(a, b)), 20);
    for (const p of forms) { const g = new THREE.Group(), t = new THREE.Mesh(torso, fabric); t.position.y = 0.95; t.scale.set(1, 1, 0.75); t.castShadow = true; g.add(t);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.95, 6), metal); pole.position.y = 0.48; g.add(pole);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 12), metal); foot.position.y = 0.015; g.add(foot);
      g.position.set(p.x, 0, p.z); g.rotation.y = p.ry; group.add(g); }
    // dolls hanging from the ceiling on strings, in some rooms
    for (let y = 1; y < env.GH; y += 2) for (let x = 1; x < env.GW; x += 2) {
      if (isWall(x, y) || env.keep.has(x + ',' + y) || hash(x, y, 250) > 0.12 * dens) continue;
      const pivot = new THREE.Group(); pivot.position.set((x + 0.5 + (hash(x, y, 251) - 0.5) * 0.4) * L, H, (y + 0.5 + (hash(x, y, 252) - 0.5) * 0.4) * L);
      const len = 0.9 + hash(x, y, 253) * 0.4, str = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 3), metal); str.position.y = -len / 2; pivot.add(str);
      const d = makeDoll(THREE, env, { x: 0, z: 0, ry: 0, y: 0 }, x * 7 + y);
      d.obj.position.set(0, -len - 0.45, 0); d.obj.rotation.set(0, hash(x, y, 254) * 6, 0); pivot.add(d.obj);
      group.add(pivot); swingers.push({ pivot, ph: hash(x, y, 255) * 6, sp: 0.6 + hash(x, y, 256) * 0.5 });
    }
  }
  dolls.forEach(d => group.add(d.obj));

  /* ---------- a flashlight beam you can see in the dusty air ---------- */
  let beam = null;
  if (env.quality !== 'low') {
    const len = 7, g = new THREE.ConeGeometry(Math.tan(0.42) * len, len, 32, 1, true);
    g.translate(0, -len / 2, 0); g.rotateX(-Math.PI / 2);          // apex at the lens, opening forward (-z of the camera)
    beam = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0.05 }, uLen: { value: len }, uT: { value: 0 } },
      vertexShader: 'varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uI; uniform float uLen; uniform float uT; varying vec3 vP; varying vec3 vN; varying vec3 vV;' +
        'void main(){ float d = clamp(-vP.z / uLen, 0.0, 1.0); float edge = abs(dot(normalize(vN), normalize(vV)));' +
        ' float n = 0.75 + 0.25 * sin(vP.x * 9.0 + uT * 0.7) * sin(vP.y * 7.0 - uT * 0.5);' +
        ' float a = uI * pow(1.0 - d, 1.6) * pow(edge, 1.5) * n; gl_FragColor = vec4(vec3(1.0, 0.88, 0.7) * a, 1.0); }',
    }));
    beam.renderOrder = 3; beam.frustumCulled = false;
  }

  /* ---------- every frame ---------- */
  let poolT = 0;
  const v3 = new THREE.Vector3(), fwd = new THREE.Vector3();
  function lampLevel(fx, t) {
    if (fx.state === 'dead' || api.dark) return 0;      // (dark: a jump scare turned every light off)
    const n = Math.sin(t * 13 + fx.phase) * 0.5 + Math.sin(t * 29 + fx.phase * 2) * 0.5;
    if (fx.state === 'flicker' && api.calm) return 0.8;          // ("Calm effects": no flickering lamps)
    if (fx.state === 'flicker') return (Math.sin(t * 2.3 + fx.phase) > 0.35 && Math.random() < 0.55) ? 0.08 : 0.85 + 0.15 * n;
    return fx.base === 1 ? 0.95 + 0.05 * n : 0.8 + 0.2 * n;   // candles waver more
  }
  function update(dt, t, camera, player, flash) {
    for (const fx of fixtures) { const lv = lampLevel(fx, t); fx.level = lv;
      fx.mat.emissiveIntensity = 0.05 + fx.em * lv; fx.glow.material.opacity = 0.55 * lv; }
    // the nearest working lamps get the real lights
    poolT -= dt;
    if (pool.length && poolT <= 0) { poolT = 0.3;
      const near = fixtures.filter(f => f.state !== 'dead').map(f => [f, f.pos.distanceToSquared(camera.position)]).sort((a, b) => a[1] - b[1]).slice(0, pool.length);
      pool.forEach((l, i) => { const f = near[i] && near[i][1] < 196 ? near[i][0] : null; l.userData.fix = f; if (f) l.position.copy(f.pos); }); }
    for (const l of pool) { const f = l.userData.fix; l.intensity = f ? 5.5 * f.level * f.base : 0; }
    // the dolls: when you're not looking at one, its head turns to watch you
    camera.getWorldDirection(fwd);
    for (const d of dolls) {
      v3.copy(d.headWorld).sub(camera.position); const dist = v3.length(); v3.normalize();
      const seen = v3.dot(fwd) > 0.55 && dist < 12;
      if (!seen && dist < 9) d.target = Math.atan2(camera.position.x - d.headWorld.x, camera.position.z - d.headWorld.z) - d.ry;
      let diff = ((d.target - d.head.rotation.y) % TAU + TAU * 1.5) % TAU - Math.PI;
      diff = Math.max(-1.1 - d.head.rotation.y, Math.min(1.1 - d.head.rotation.y, diff));
      if (!seen) d.head.rotation.y += diff * Math.min(1, dt * 4);
    }
    for (const c of clocks) c.pendulum.rotation.z = Math.sin(t * Math.PI) * 0.18;
    for (const s of swingers) { s.pivot.rotation.z = Math.sin(t * s.sp + s.ph) * 0.06; s.pivot.rotation.x = Math.sin(t * s.sp * 0.7 + s.ph * 2) * 0.04; }
    if (beam) { beam.material.uniforms.uT.value = t; beam.material.uniforms.uI.value = flash && flash.visible ? 0.045 * Math.min(1.2, flash.intensity / 25) : 0; }
  }
  function dispose() {
    const seen = new Set();
    group.traverse(o => { if (o.geometry && !o.userData.sharedGeo && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }   // (a doll's geometry is the loaded model's)
      if (o.material && !seen.has(o.material)) { seen.add(o.material); for (const k of ['map', 'alphaMap']) if (o.material[k] && o.material[k] !== env.glowTex) o.material[k].dispose(); o.material.dispose(); } });
    if (beam) { if (beam.parent) beam.parent.remove(beam); beam.geometry.dispose(); beam.material.dispose(); }
  }
  const api = { group, update, dispose, beam, fixtures, dolls, doorTiles, calm: false };
  return api;
}

/* ---------- the props ---------- */
function makeDoll(THREE, env, p, seed) {
  // a porcelain doll sitting against the wall, about 45 cm tall
  const g = new THREE.Group(), y0 = p.y || 0;
  const dresses = [0x9fb4e6, 0xe6a8b8, 0xf0ece0, 0xb6d4c0], hairs = [0x1a120c, 0xd8b06a, 0x5a2a14, 0x0b0b0b];
  if (env.doll) {                                          // the model made in Blender (models/doll.glb): its lowest point is at 0, so it sits on the floor or the table
    const d = env.doll.clone(true), glowEyes = seed % 3 === 0, faceTex = env.toTex(dollFaceCanvas(glowEyes));
    faceTex.wrapS = faceTex.wrapT = THREE.ClampToEdgeWrapping;
    const aged = [0x4d5f91, 0x93505f, 0xa49a84, 0x4f7560];     // (the model's dresses: older, dirtier colours than the stand-in's)
    d.traverse(o => { if (!o.isMesh) return; o.material = o.material.clone();
      const n = o.material.name;
      if (n === 'Dress') { o.material.color.setHex(aged[seed % 4]); o.material.roughness = 0.9; }
      else if (n === 'Hair') o.material.color.setHex(hairs[(seed >> 1) % 4]);
      else if (n === 'Lace') o.material.color.setHex(0xb9ae98);          // (yellowed)
      else if (n === 'Socks') o.material.color.setHex(0xbdb8ae);
      else if (n === 'Porcelain' && o.name !== 'DollHead') { o.material.color.setHex(0xcfc4bb); o.material.roughness = 0.35; }
      else if (n === 'Porcelain' && o.name === 'DollHead') { o.material.map = faceTex; o.material.color.setHex(0xd9d0c8); o.material.roughness = 0.35;
        if (glowEyes) { o.material.emissive = new THREE.Color(0x3a90c0); o.material.emissiveMap = faceTex; o.material.emissiveIntensity = 0.5; } }
    });
    d.traverse(o => { if (o.isMesh) o.userData.sharedGeo = true; });   // (the model keeps its geometry)
    const head = d.getObjectByName('DollHeadPivot') || d;
    g.add(d); g.position.set(p.x, y0, p.z); g.rotation.y = p.ry; g.updateMatrixWorld(true);
    return { obj: g, head, ry: p.ry, target: 0, headWorld: head.getWorldPosition(new THREE.Vector3()) };
  }
  const dress = new THREE.MeshStandardMaterial({ color: dresses[seed % 4], roughness: 0.85 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xf2ebe4, roughness: 0.25 });
  const hairM = new THREE.MeshStandardMaterial({ color: hairs[(seed >> 1) % 4], roughness: 0.7 });
  const mesh = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  mesh(new THREE.ConeGeometry(0.15, 0.22, 16), dress, 0, 0.11, 0);
  mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.13, 12), dress, 0, 0.27, 0);
  for (const s of [-1, 1]) {
    const leg = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), porcelain, s * 0.05, 0.03, 0.12); leg.rotation.x = Math.PI / 2;
    mesh(new THREE.SphereGeometry(0.028, 10, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }), s * 0.05, 0.03, 0.23);
    const arm = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.15, 8), porcelain, s * 0.08, 0.24, 0.03); arm.rotation.set(0.5, 0, s * 0.35);
  }
  const head = new THREE.Group(); head.position.set(0, 0.4, 0); g.add(head);
  const glowEyes = seed % 3 === 0, face = dollFaceCanvas(glowEyes);
  const faceTex = env.toTex(face); faceTex.center.set(0.5, 0.5); faceTex.rotation = 0; faceTex.offset.set(0.25, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 16), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.25,
    emissive: glowEyes ? 0x3a90c0 : 0x000000, emissiveMap: glowEyes ? faceTex : null, emissiveIntensity: glowEyes ? 0.5 : 0 }));
  skull.castShadow = true; head.add(skull);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.082, 18, 12, 0, TAU, 0, Math.PI * 0.55), hairM); hair.position.set(0, 0.008, -0.01); hair.rotation.x = -0.35; head.add(hair);
  for (const s of [-1, 1]) { const curl = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.12, 8), hairM); curl.position.set(s * 0.07, -0.04, -0.02); head.add(curl); }
  g.position.set(p.x, y0, p.z); g.rotation.y = p.ry;
  g.updateMatrixWorld(true);
  return { obj: g, head, ry: p.ry, target: 0, headWorld: head.getWorldPosition(new THREE.Vector3()) };
}
// a porcelain doll's face (painted onto a sphere: the face sits at the front)
function dollFaceCanvas(glowEyes) {
  const face = mk(128, 128), c = face.getContext('2d');
  c.fillStyle = '#f2ebe4'; c.fillRect(0, 0, 128, 128);
  const cheeks = c.createRadialGradient(40, 74, 1, 40, 74, 14); cheeks.addColorStop(0, 'rgba(220,120,130,.5)'); cheeks.addColorStop(1, 'rgba(220,120,130,0)');
  c.fillStyle = cheeks; c.fillRect(20, 55, 40, 40); c.save(); c.translate(48, 0); c.fillStyle = cheeks; c.fillRect(20, 55, 40, 40); c.restore();
  c.fillStyle = glowEyes ? '#7fd8ff' : '#111'; c.beginPath(); c.ellipse(46, 60, 7, 9, 0, 0, TAU); c.ellipse(82, 60, 7, 9, 0, 0, TAU); c.fill();
  c.fillStyle = '#000'; c.beginPath(); c.arc(46, 61, 3, 0, TAU); c.arc(82, 61, 3, 0, TAU); c.fill();
  c.fillStyle = '#a1202c'; c.beginPath(); c.ellipse(64, 88, 7, 4, 0, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(40,30,30,.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(78, 30); c.lineTo(86, 48); c.lineTo(80, 60); c.stroke();   // a crack
  return face;
}
function clothCanvas(base) {
  const c = mk(128, 128), g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 18; k++) { const x = Math.random() * 128; const gr = g.createLinearGradient(x - 6, 0, x + 6, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 6, 0, 12, 128); }   // folds
  noiseFill(g, 128, 128, 2500, 0.06, true);
  const dg = g.createLinearGradient(0, 0, 0, 128); dg.addColorStop(0, 'rgba(90,80,60,.25)'); dg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = dg; g.fillRect(0, 0, 128, 128);   // dust on top
  return c;
}
function webCanvas() {
  const c = mk(128, 128), g = c.getContext('2d'); g.strokeStyle = 'rgba(220,220,210,.55)'; g.lineWidth = 1;
  for (let a = 0; a <= Math.PI / 2 + 0.01; a += Math.PI / 12) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); g.stroke(); }
  for (let r = 14; r < 128; r += 14 + Math.random() * 6) { g.beginPath(); for (let a = 0; a <= Math.PI / 2 + 0.01; a += Math.PI / 12) { const rr = r * (0.9 + Math.random() * 0.15); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke(); }
  return c;
}
function makeBear(THREE, p) {
  const g = new THREE.Group(), fur = new THREE.MeshStandardMaterial({ color: 0x7a5234, roughness: 1 }), dark = new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 0.3 });
  const muzzleM = new THREE.MeshStandardMaterial({ color: 0xc19a74, roughness: 1 });
  const s = (r, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); o.position.set(x, y, z); if (sx) o.scale.set(sx, sy, sz); o.castShadow = true; g.add(o); return o; };
  s(0.13, fur, 0, 0.13, 0, 1, 1.15, 0.9);
  s(0.1, fur, 0, 0.33, 0.01); s(0.035, fur, -0.075, 0.41, 0); s(0.035, fur, 0.075, 0.41, 0);
  s(0.04, muzzleM, 0, 0.31, 0.085, 1, 0.8, 0.8); s(0.013, dark, 0, 0.325, 0.12);
  s(0.014, dark, -0.035, 0.355, 0.085); s(0.014, dark, 0.035, 0.355, 0.085);
  for (const k of [-1, 1]) { s(0.045, fur, k * 0.12, 0.17, 0.03, 0.8, 1.3, 0.8); s(0.055, fur, k * 0.07, 0.04, 0.12, 0.9, 0.8, 1.3); }
  g.position.set(p.x, 0, p.z); g.rotation.set(0, p.ry + 0.3, 0.12);
  g.updateMatrixWorld(true); g.position.y = -new THREE.Box3().setFromObject(g).min.y;   // (tilted: sitting on the floor, not sunk into it)
  return g;
}
function makeVase(THREE, x, y, z) {
  const pts = [[0, 0], [0.05, 0], [0.07, 0.04], [0.075, 0.1], [0.055, 0.17], [0.03, 0.21], [0.035, 0.24]].map(([a, b]) => new THREE.Vector2(a, b));
  const colors = [0x2a4a7a, 0x7a2a2a, 0xd8d0c0, 0x2a5a3a];
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({ color: colors[(x * 7 + z * 3 | 0) & 3], roughness: 0.15, metalness: 0.05 }));
  m.position.set(x, y, z); m.castShadow = true;
  const g = new THREE.Group(); g.add(m);
  for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
    st.position.set(x + (i - 1) * 0.02, y + 0.36, z); st.rotation.z = (i - 1) * 0.3; g.add(st);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a22, roughness: 1 }));   // dead flowers
    fl.position.set(x + (i - 1) * 0.065, y + 0.5, z); g.add(fl); }
  return g;
}
function makeClock(THREE, p, woodMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.05, 0.36), woodMat); body.position.y = 1.025; body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.4), woodMat); top.position.y = 2.1; g.add(top);
  const fc = mk(128, 128), c = fc.getContext('2d');
  c.fillStyle = '#e8dcc0'; c.beginPath(); c.arc(64, 64, 62, 0, TAU); c.fill();
  c.fillStyle = '#2a1a10'; c.font = 'bold 14px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) { const a = i / 12 * TAU - Math.PI / 2; c.fillText(['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][i - 1], 64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48); }
  c.strokeStyle = '#1a0e08'; c.lineWidth = 3; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 26); c.moveTo(64, 64); c.lineTo(88, 72); c.stroke();   // stopped at 3:12
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.19, 28), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(fc), roughness: 0.4 }));
  face.material.map.colorSpace = THREE.SRGBColorSpace;
  face.position.set(0, 1.72, 0.181); g.add(face);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.9), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.3 }));
  glass.position.set(0, 0.95, 0.181); g.add(glass);
  const pendulum = new THREE.Group(); pendulum.position.set(0, 1.35, 0.17); g.add(pendulum);
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.3 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 6), brass); rod.position.y = -0.3; pendulum.add(rod);
  const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20), brass); bob.rotation.x = Math.PI / 2; bob.position.y = -0.6; pendulum.add(bob);
  g.position.set(p.x, 0, p.z); g.rotation.y = p.ry;
  return { obj: g, pendulum };
}
function blocksCanvas() {
  const c = mk(128, 128), g = c.getContext('2d'), cols = ['#c0392b', '#2e6fb3', '#e0b030', '#3a9a5a'];
  for (let i = 0; i < 4; i++) { const x = (i % 2) * 64, y = (i >> 1) * 64;
    g.fillStyle = '#e8dcc4'; g.fillRect(x, y, 64, 64); g.strokeStyle = cols[i]; g.lineWidth = 6; g.strokeRect(x + 5, y + 5, 54, 54);
    g.fillStyle = cols[(i + 1) % 4]; g.font = 'bold 40px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ABCD'[i], x + 32, y + 35); }
  noiseFill(g, 128, 128, 1500, 0.08, true);
  return c;
}
function crateCanvas() {
  const c = woodCanvas('#6b5236', 128, 128, false), g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.45)'; for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 3);
  g.fillStyle = '#4a3622'; g.fillRect(0, 0, 128, 10); g.fillRect(0, 118, 128, 10); g.fillRect(0, 0, 10, 128); g.fillRect(118, 0, 10, 128);
  g.save(); g.translate(64, 64); g.rotate(0.78); g.fillRect(-90, -6, 180, 12); g.restore();
  return c;
}
function barrelCanvas() {
  const c = mk(128, 128), g = c.getContext('2d');
  g.fillStyle = '#3a4a3a'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) { g.fillStyle = 'rgba(120,60,20,' + (Math.random() * 0.25) + ')'; g.fillRect(Math.random() * 128, y, Math.random() * 40, 2); }
  g.fillStyle = '#1e1e1a'; g.fillRect(0, 14, 128, 7); g.fillRect(0, 107, 128, 7); g.fillRect(0, 60, 128, 5);
  return c;
}
function rustCanvas() {
  const c = mk(64, 64), g = c.getContext('2d');
  g.fillStyle = '#5a4030'; g.fillRect(0, 0, 64, 64);
  for (let k = 0; k < 120; k++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(140,70,30,.35)' : 'rgba(30,30,30,.3)'; g.beginPath(); g.arc(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 5, 0, TAU); g.fill(); }
  return c;
}

window.House = { build };
})();
