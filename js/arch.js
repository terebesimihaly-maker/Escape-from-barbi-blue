/* Escape from Barbi Blue: the house's architecture in 3D (build spec A9, A10, B5, B9, C4, C5, D5, E2 step 4, E5, H11, H21, H22).
   From a floor's plan (js/dress.js Dress.plan) it builds the walls, the ceilings and their height steps, the mouldings, the beams,
   the doorways (frames, two leaves each, the header above them) and the kit's wall and ceiling modules, as three.js meshes. It
   decides nothing itself: every position comes from the plan and the floor's grid and ceilings (the same data LightBaker bakes),
   so every player sees the same house (H7). No Math.random, nothing from the quality setting except the light atlas's tier.
   The integrator gives the materials (js/matlib.js families) in opts.materials; without them a plain grey stands in.

   Every builder takes opts.env (the env given to Dress.plan) or opts.bake (Dress.bakeInput(plan, env), LightBaker's input); with
   neither it reads the live game (Dress.envFromGame()). Heavy merges are chunked per 6 x 6 tiles (13.5 m) so frustum culling works
   (H22). Each result has .group (add it to the level), .stats {tris, draws, chunks, verts, ms} and .dispose().

   Arch.walls(plan, opts)     one quad strip per wall face at its height (gable faces follow the roof at u = 0 .14 .5 .86 1), in three
                              material groups per chunk: main (up to 3.0 m), upper (the band above 3.0 m) and service (servant runs,
                              their faces 0.30 m proud, with reveal quads where the inset stops and the wall plane behind as the
                              pocket's back). A face a module replaces is left out only where that module is drawn: with opts.kit,
                              where the kit has it; with no kit (E7) only when opts.skipModules === true; skipModules false keeps all.
                              The upper band above a module stays. A face's end that goes straight on into a lower neighbour gets a
                              vertex at the neighbour's top (no T-junction). uv0: the variant trick on main walls (u = 0.5 u + 0.5 variant, v = y / 3);
                              upper and service u = u, v = y / 3. uv1: the face's cell of LightBaker.packAtlas (heights from
                              LightBaker.faceHeights, so the cells are bake().wallCells exactly; opts.cells = those wallCells; opts.tier
                              the bake's tier). No vertex colours: wall AO comes from the bake.
                              -> {group, faces (LightBaker's faces, in the bake's order), cells, atlas {W, H, ppm}, reveals, faceVerts}
   Arch.ceilings(plan, opts)  one quad per open tile at its height, gable tiles as sloped strips (split at the ridge and at the walls'
                              u = .14 / .86, so wall tops and ceiling edges share their vertices), and a vertical step between
                              neighbours of different height, facing the higher side. uv0 = world xz / 2.25, uv1 = plan uv
                              (x / (GW L), 1 - z / (GH L)). Skylight and ceiling-hole tiles are left open for their modules (same
                              skip rule as the walls). receiveShadow.  -> {group, steps, cut (tile indices left open)}
   Arch.trims(plan, opts)     skirting, dado rail, cornice (top at the face's height, following a gable) and a picture rail at 3.0 m
                              where a wall rises above it: the style's profiles swept along every wall with 45 degree mitres at inside
                              and outside corners, butt joints along straight walls, and capped stops at doorway posts, modules,
                              window openings, the exit's door (always), peeling paper (dado), the wardrobe in front of its back wall
                              and wherever the neighbouring wall has no such moulding (another height). An exit or fireplace module
                              (3.0 m tall) keeps the cornice above it and the picture rail on its top seam. Profiles: opts.profiles, else textures/arch/<style>.profiles.json once
                              Arch.loadProfiles(style) has fetched it, else built-in polylines with B5's sizes. uv: u = metres along
                              the wall / 2.25 (continuous round straight runs), v = the profile's band of the trim sheet.
                              -> {group, joints (each mitre or butt: the two meeting rings, for the tests)}
   Arch.beams(plan, opts)     plan.beams as boxes (joists, collar ties, truss ties, workshop timbers), posts and steel I-beams, split at
                              chunk lines; u = metres along / 2.25, v = round the section. A beam lower than 2.56 m ending at a
                              doorway tile's edge along its passage stops 0.10 m short (the leaves reach that far).
   Arch.doorways(plan, kit, opts)  per plan.doorways entry the kit's Door_frame_<style> and two Door_leaf_<style> (the side +1 one mirrored,
                              in its own instanced mesh whose matrix is the mirror), instanced per chunk on the kit's own geometry and
                              materials (userData.shared / kit, H21), and a header from the frame head's top (2.66 m) up to the ceiling
                              (skipped under 0.08 m) in the wall material. The leaves hang on the posts' inner faces just past the
                              frame's architraves on their swing side, their thickness toward their side wall, so a leaf's
                              farthest point from its wall is 0.11 + cos(angle) m (0.42 at 72 degrees, 0.44 at the sway's 70.5): never in
                              the walkway (H11). Pinned leaves stand at 90 degrees, a long board's doorway has none. No kit: the frame
                              as house.js draws it and plain leaf boxes of the same size.  -> {group, doors, procedural}
   Arch.updateDoors(dt, actors, sfx)  every frame: when any actor ({x, z} m: you, teammates, her) comes within 1.6 m of a doorway its
                              leaves ease to 89 degrees over 0.8 s with a creak at the door; 6-10 s after the last one left they drift back
                              to rest (2.5 s, a softer creak); at rest a +-1.5 degree draught sway. sfx: left out = the game's global
                              sfx (js/audio.js: sfx.creak(volume, {x, y, h}) in game units), null = silent, or an sfx-like object, or a
                              function (kind, {x, y, z} m, volume, soft). Muted while herQuiet() > 0.5 (opts.herQuiet of doorways(),
                              else the game's). Cosmetic and local.
   Arch.modules(plan, kit, opts)  plan.modules (fireplaces, closed doors, niches, wall holes, peeling paper, ceiling roses, ceiling holes,
                              skylights, the loft ladder; the exit only with opts.exit: makeExit owns it; the windows only with
                              opts.windows === true: Kit.furnish owns them by default) at their faces or tiles, origins per B1, cloned
                              on shared geometry. Parts in the reserved WallSurface material get opts.materials.wall and their own
                              geometry with uv0 (the variant trick) and uv1 (their face's atlas cell): that geometry is the floor's
                              (userData.shared / kit cleared, freed by dispose); Glass / SkyPlane / Emit parts get opts.materials.glass
                              / sky / emit when given. A sloped skylight follows its gable.  -> {group, placed, missing}
   Arch.build(plan, kit, opts) all six at once (opts.kit = kit; modules only with a kit) -> {group, walls, ceilings, trims, beams,
                              doorways, modules?, stats, dispose()}. Arch.rebuild(prev, plan, kit, opts) disposes prev and builds
                              again: needed when the kit arrives after the floor was built, as the skipped faces change with it.
   uv1 must index the bake's atlas: give opts.cells (the bake's wallCells) or opts.tier (its tier); without either a warning is
   printed once and settings.quality stands in.
   Arch.loadProfiles(style) -> Promise of the profile set (fetched once; null when there's no file). Arch.profiles(style) gives the set
   in use. Arch.dispose(result) = result.dispose(). */
(function () {
'use strict';

const FR = [0, 0.14, 0.5, 0.86, 1], FACE_H = 3.0, CH = 6, EPS = 1e-6, PI = Math.PI, DEG = PI / 180;
const POST = 0.11, LINING = 0.34, HEAD_Y0 = 2.6, HEAD_D = 0.28, LEAF = { W: 1.0, H: 2.55, D: 0.045 };
const NEAR = 1.6, OPEN_DEG = 89, OPEN_T = 0.8, BACK_T = 2.5, SWAY = 1.5;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// world3d.js's tile hash (copied so this file stands alone): the doors' hold times and sway phases
function hash(x, y, k) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((k | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const gabH = (q, xm, zm) => q.e + (q.r - q.e) * Math.max(0, 1 - Math.abs((q.y ? xm : zm) - q.c) / q.hw);

/* ---------- the floor behind a plan: grid, ceilings, gables, faces, the light atlas ---------- */
const FLOOR = new WeakMap();
function gridMask(g, GW, GH) {
  const n = GW * GH, W = new Uint8Array(n);
  if (ArrayBuffer.isView(g) && g.length === n) { for (let i = 0; i < n; i++) W[i] = g[i] ? 1 : 0; return W; }
  for (let y = 0; y < GH; y++) { const r = g[y]; for (let x = 0; x < GW; x++) W[y * GW + x] = (typeof r === 'string' ? r.charCodeAt(x) === 49 : +r[x] === 1) ? 1 : 0; }
  return W;
}
function floorOf(plan, opts) {
  opts = opts || {};
  const src = opts.bake || opts.env || null, had = FLOOR.get(plan);
  if (had && (!src || had.src === src)) return had;
  let B = opts.bake;
  if (!B) {
    if (typeof Dress === 'undefined') throw new Error('Arch: give opts.bake or opts.env (and load js/dress.js)');
    B = Dress.bakeInput(plan, opts.env || Dress.envFromGame());
  }
  const GW = plan.GW, GH = plan.GH, L = plan.L || 2.25, n = GW * GH;
  if ((B.GW && B.GW !== GW) || (B.GH && B.GH !== GH)) throw new Error('Arch: the bake input is ' + B.GW + 'x' + B.GH + ', the plan ' + GW + 'x' + GH);
  const W = gridMask(B.grid, GW, GH), C = new Float32Array(n), c0 = typeof B.ceil === 'number' ? B.ceil : 3;
  for (let i = 0; i < n; i++) C[i] = B.ceil && typeof B.ceil !== 'number' && B.ceil[i] > 0 ? B.ceil[i] : c0;
  const isW = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || W[y * GW + x] === 1;
  // gables as LightBaker reads them (so the heights agree with the bake and with js/dress.js to the bit)
  const gid = new Int16Array(n).fill(-1), gab = [];
  for (const q0 of plan.gables || B.gables || []) {
    const q = Array.isArray(q0) ? { tx0: q0[0], ty0: q0[1], tx1: q0[2], ty1: q0[3], eave: q0[4], ridge: q0[5], alongY: q0[6] } : q0, k = gab.length;
    const x0 = q.tx0 * L, x1 = (q.tx1 + 1) * L, z0 = q.ty0 * L, z1 = (q.ty1 + 1) * L, y = !!q.alongY;
    gab.push({ e: q.eave, r: q.ridge, y, c: y ? (x0 + x1) / 2 : (z0 + z1) / 2, hw: y ? (x1 - x0) / 2 : (z1 - z0) / 2, q });
    for (let ty = q.ty0; ty <= q.ty1; ty++) for (let tx = q.tx0; tx <= q.tx1; tx++) if (tx >= 0 && ty >= 0 && tx < GW && ty < GH) gid[ty * GW + tx] = k;
  }
  const ceilT = (t, xm, zm) => gid[t] < 0 ? C[t] : gabH(gab[gid[t]], xm, zm);
  const F = plan.faces, faceAt = new Int32Array(n * 4).fill(-1), dirIx = (nx, nz) => nz === 1 ? 0 : nz === -1 ? 1 : nx === 1 ? 2 : 3;
  F.forEach((f, i) => { faceAt[(f.y * GW + f.x) * 4 + dirIx(f.nx, f.nz)] = i; });
  const faceOf = (x, y, nx, nz) => x < 0 || y < 0 || x >= GW || y >= GH ? -1 : faceAt[(y * GW + x) * 4 + dirIx(nx, nz)];
  const bakeFaces = B.faces && B.faces.length === F.length ? B.faces : F.map(f => ({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, nx: f.nx, nz: f.nz, x: f.x, y: f.y, h: f.h }));
  const Fl = { src, B, GW, GH, L, n, W, C, isW, gid, gab, ceilT, faceOf, bakeFaces, atlas: {}, segs: null,
    NCX: Math.ceil(GW / CH), chunkOf: (tx, ty) => Math.floor(clamp(ty, 0, GH - 1) / CH) * Math.ceil(GW / CH) + Math.floor(clamp(tx, 0, GW - 1) / CH) };
  FLOOR.set(plan, Fl);
  return Fl;
}
// the wall atlas cells (uv1): the bake's own wallCells when given, else LightBaker.packAtlas with LightBaker.faceHeights (the same cells)
const WARNED = {};
function cellsOf(Fl, opts) {
  if (opts && opts.cells) return { cells: opts.cells, W: 0, H: 0, ppm: 0 };
  if (typeof LightBaker === 'undefined') throw new Error('Arch: needs js/lightbake.js (or opts.cells) for the walls\' uv1');
  // (the tier must be the bake's: a guessed one indexes the wrong atlas. Said once, then the quality setting stands in)
  if (!(opts && opts.tier) && !WARNED.tier) { WARNED.tier = true; console.warn('Arch: no opts.cells or opts.tier given: uv1 assumes the bake used settings.quality'); }
  const tier = (opts && opts.tier) || (typeof settings !== 'undefined' && settings.quality) || 'low';
  if (!Fl.atlas[tier]) Fl.atlas[tier] = LightBaker.packAtlas(Fl.bakeFaces, tier, LightBaker.faceHeights(Fl.B, Fl.bakeFaces));
  return Fl.atlas[tier];
}

/* ---------- geometry buffers, one per (chunk, material group) ---------- */
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.uv1 = null; this.ix = []; }
  v(x, y, z, nx, ny, nz, u, w, u1, w1) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w);
    if (u1 !== undefined) (this.uv1 || (this.uv1 = [])).push(u1, w1);
    return this.p.length / 3 - 1;
  }
  get count() { return this.p.length / 3; }
}
// a convex planar polygon (pts [[x, y, z]...]) as a fan, wound so its front faces normal nrm (Newell's normal decides the order)
function poly(b, pts, nrm, uv, uv1) {
  // (repeated points, e.g. where a gable's top touches 3.0 m at a band's corner, are dropped first)
  const keep = pts.map((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 1e-9; });
  if (keep.includes(false)) { const f = q => q && q.filter((_, i) => keep[i]); pts = f(pts); uv = f(uv); uv1 = f(uv1); }
  let m = pts.length; if (m < 3) return;
  // vertices lying on a straight edge (shared with a neighbour's split: a wall's step, a gable's 3.0 m line or FR points) must be
  // used by real triangles, or a T-junction is left. The fan starts at one that is alone on its edge; when every such vertex has
  // company on its edge, the fan starts from an added centre point instead (uv and uv1 are affine, so the average is exact)
  const onEdge = [];
  if (m > 3) for (let k = 0; k < m; k++) {
    const a = pts[(k + m - 1) % m], c = pts[k], e = pts[(k + 1) % m], ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = e[0] - c[0], vy = e[1] - c[1], vz = e[2] - c[2];
    onEdge.push(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9 * Math.max(1e-3, Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)));
  }
  let centre = false;
  if (onEdge.some(Boolean)) {
    const k = onEdge.findIndex((x, i) => x && !onEdge[(i + m - 1) % m] && !onEdge[(i + 1) % m]);
    if (k > 0) { const rot = q => q && q.slice(k).concat(q.slice(0, k)); pts = rot(pts); uv = rot(uv); uv1 = rot(uv1); }
    else if (k < 0) centre = true;
  }
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < m; i++) { const a = pts[i], c = pts[(i + 1) % m]; nx += (a[1] - c[1]) * (a[2] + c[2]); ny += (a[2] - c[2]) * (a[0] + c[0]); nz += (a[0] - c[0]) * (a[1] + c[1]); }
  const area = Math.hypot(nx, ny, nz); if (area < 1e-10) return;
  const flip = nx * nrm[0] + ny * nrm[1] + nz * nrm[2] < 0, ids = [];
  for (let i = 0; i < m; i++) ids.push(b.v(pts[i][0], pts[i][1], pts[i][2], nrm[0], nrm[1], nrm[2], uv[i][0], uv[i][1], uv1 ? uv1[i][0] : undefined, uv1 ? uv1[i][1] : undefined));
  if (centre) {
    const avg = (q, j) => q.reduce((s, r) => s + r[j], 0) / m;
    const c = b.v(avg(pts, 0), avg(pts, 1), avg(pts, 2), nrm[0], nrm[1], nrm[2], avg(uv, 0), avg(uv, 1), uv1 ? avg(uv1, 0) : undefined, uv1 ? avg(uv1, 1) : undefined);
    for (let i = 0; i < m; i++) flip ? b.ix.push(c, ids[(i + 1) % m], ids[i]) : b.ix.push(c, ids[i], ids[(i + 1) % m]);
    return;
  }
  for (let i = 1; i < m - 1; i++) {
    // (a vertex on a straight edge would make a zero-area sliver of the fan: left out)
    const a = pts[0], c = pts[i], e = pts[i + 1], ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = e[0] - a[0], vy = e[1] - a[1], vz = e[2] - a[2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) continue;
    flip ? b.ix.push(ids[0], ids[i + 1], ids[i]) : b.ix.push(ids[0], ids[i], ids[i + 1]);
  }
}
// ear clipping for the small simple polygons of mould profiles and beam sections ([[x, y]...]), counter-clockwise first
function triangulate(P) {
  const m = P.length; let a = 0; for (let i = 0; i < m; i++) { const p = P[i], q = P[(i + 1) % m]; a += p[0] * q[1] - q[0] * p[1]; }
  const idx = []; for (let i = 0; i < m; i++) idx.push(a >= 0 ? i : m - 1 - i);
  const out = [], cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const inside = (p, A, Bp, Cp) => cross(A, Bp, p) >= -1e-12 && cross(Bp, Cp, p) >= -1e-12 && cross(Cp, A, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length], A = P[i0], Bp = P[i1], Cp = P[i2];
      if (cross(A, Bp, Cp) <= 1e-12) continue;
      let ear = true; for (const j of idx) if (j !== i0 && j !== i1 && j !== i2 && inside(P[j], A, Bp, Cp)) { ear = false; break; }
      if (!ear) continue;
      out.push([i0, i1, i2]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
function grey() { return new THREE.MeshLambertMaterial({ color: 0x8a8580 }); }
function matOf(opts, ...keys) { const M = (opts && opts.materials) || {}; for (const k of keys) if (M[k]) return M[k]; return (opts && opts.material) || null; }
// one Mesh per non-empty buffer, named and tagged, with its bounds for culling
function meshOf(b, mat, name, tag, chunk, sh) {
  if (!b || !b.ix.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.p), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.n), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
  if (b.uv1) g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(b.uv1), 2));
  g.setIndex(new THREE.BufferAttribute(b.count > 65535 ? new Uint32Array(b.ix) : new Uint16Array(b.ix), 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = !!(sh && sh.cast); m.receiveShadow = !(sh && sh.receive === false);
  m.userData.arch = tag; m.userData.chunk = chunk;
  return m;
}
function finish(res, group, t0) {
  let tris = 0, verts = 0, draws = 0; const chunks = new Set();
  group.traverse(o => { if (!o.isMesh) return; draws++; const g = o.geometry, c = o.isInstancedMesh ? o.count : 1;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * c; verts += g.attributes.position.count * c; if (o.userData.chunk !== undefined) chunks.add(o.userData.chunk); });
  res.group = group; res.stats = Object.assign({ tris, verts, draws, chunks: chunks.size, ms: +(now() - t0).toFixed(2) }, res.stats || {});
  res.dispose = () => dispose(res);
  return res;
}
// frees what this result owns: its merged geometry and instance buffers, never the kit's geometry or materials (H21)
function dispose(res) {
  if (!res || !res.group) return;
  const seen = new Set();
  res.group.traverse(o => { if (!o.isMesh) return;
    if (o.isInstancedMesh && o.dispose) o.dispose();
    if (!(o.userData.shared || o.userData.kit || o.userData.sharedGeo) && o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
  if (res.group.parent) res.group.parent.remove(res.group);
  if (res === DOORS.res) { DOORS.list = []; DOORS.res = null; }
}
function chunkBufs() { const m = new Map(); return { get(c, k) { const key = c + '|' + k; let b = m.get(key); if (!b) { b = new Buf(); b.c = c; b.k = k; m.set(key, b); } return b; }, all: () => [...m.values()] }; }

/* ---------- the walls as runs of segments: faces (a servant run's 0.30 m proud), reveals, and how each end meets the next ---------- */
// each face end: 'inside' (the wall turns into the room), 'flat' (the wall goes straight on) or 'outside' (a pillar's end), and the
// segment it meets there. A servant run's inset face that stops (at the run's end, or where a corridor joins) gets a reveal quad back
// to the wall plane. Endpoints at inside corners are where the two (inset) walls meet.
function segsOf(Fl, plan) {
  if (Fl.segs) return Fl.segs;
  const F = plan.faces, L = Fl.L, S = [];
  F.forEach((f, i) => { const t = [Math.sign(f.x1 - f.x0), Math.sign(f.z1 - f.z0)];
    S.push({ i, face: i, kind: 'face', f, n: [f.nx, f.nz], t, inset: f.inset || 0, tile: [f.x, f.y], h: f.h, group: f.kind, ends: [null, null] }); });
  for (const s of S) { const f = s.f;
    for (const e of [0, 1]) { const dE = e ? 1 : -1, ax = f.x + dE * s.t[0], ay = f.y + dE * s.t[1]; let cls, g;
      if (Fl.isW(ax, ay)) { cls = 'inside'; g = Fl.faceOf(f.x, f.y, -dE * s.t[0], -dE * s.t[1]); }
      else { const qx = ax - f.nx, qy = ay - f.nz;
        if (Fl.isW(qx, qy)) { cls = 'flat'; g = Fl.faceOf(ax, ay, f.nx, f.nz); } else { cls = 'outside'; g = Fl.faceOf(qx, qy, dE * s.t[0], dE * s.t[1]); } }
      s.ends[e] = { cls, seg: g }; } }
  for (const s of S.slice()) {
    if (!s.inset) continue;
    for (const e of [0, 1]) {
      const lk = s.ends[e], g = lk.seg >= 0 ? S[lk.seg] : null;
      if (lk.cls === 'inside' || (lk.cls === 'flat' && g && g.inset === s.inset)) continue;
      const f = s.f, dE = e ? 1 : -1, P = e ? [f.x1, f.z1] : [f.x0, f.z0], Q = [P[0] + f.nx * s.inset, P[1] + f.nz * s.inset];
      const nR = [dE * s.t[0], dE * s.t[1]], tR = [nR[1], -nR[0]], r = S.length, qEnd = e ? 0 : 1, pEnd = 1 - qEnd;
      const R = { i: r, face: -1, kind: 'reveal', parent: s.i, pend: e, n: nR, t: tR, inset: 0, tile: s.tile, h: s.h, group: 'service', ends: [null, null],
        p0: e ? Q : P, p1: e ? P : Q };
      R.ends[qEnd] = { cls: 'outside', seg: s.i }; R.ends[pEnd] = { cls: lk.cls === 'flat' ? 'inside' : 'flat', seg: lk.seg };
      s.ends[e] = { cls: 'outside', seg: r };
      if (g) for (const k of [0, 1]) if (g.ends[k] && g.ends[k].seg === s.i) g.ends[k] = { cls: R.ends[pEnd].cls, seg: r };
      S.push(R);
    }
  }
  // effective endpoints: faces on their (inset) line, ends at inside corners where the two lines cross
  for (const s of S) {
    if (s.kind === 'face') { const f = s.f; s.p0 = [f.x0 + f.nx * s.inset, f.z0 + f.nz * s.inset]; s.p1 = [f.x1 + f.nx * s.inset, f.z1 + f.nz * s.inset]; }
    s.b0 = s.p0.slice(); s.b1 = s.p1.slice();
  }
  for (const s of S) for (const e of [0, 1]) {
    const lk = s.ends[e]; if (lk.cls !== 'inside' || lk.seg < 0) continue;
    const g = S[lk.seg], P = e ? s.b1 : s.b0, den = s.t[0] * g.n[0] + s.t[1] * g.n[1]; if (Math.abs(den) < 1e-9) continue;
    const lam = ((g.b0[0] - P[0]) * g.n[0] + (g.b0[1] - P[1]) * g.n[1]) / den;
    const q = [P[0] + s.t[0] * lam, P[1] + s.t[1] * lam]; if (e) s.p1 = q; else s.p0 = q;
  }
  for (const s of S) { s.len = (s.p1[0] - s.p0[0]) * s.t[0] + (s.p1[1] - s.p0[1]) * s.t[1]; s.sw0 = s.p0[0] * s.t[0] + s.p0[1] * s.t[1]; }
  return (Fl.segs = S);
}

/* ---------- faces: their top line and points ---------- */
// a face's points at the canonical fractions: (tile edge + FR[k] L) exactly as the ceilings compute theirs, so they share vertices
function faceCoord(f, L, u) {
  const k = FR.indexOf(u), along = f.z0 === f.z1, a0 = along ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1), fwd = along ? f.x1 > f.x0 : f.z1 > f.z0;
  const fr = fwd ? u : 1 - u, kk = FR.indexOf(fr), c = kk === 0 ? a0 : kk === 4 ? a0 + L : kk > 0 ? a0 + FR[kk] * L : a0 + fr * L;
  return along ? [c, f.z0] : [f.x0, c];
}
// the top of face f as [[u, y]...]: flat [0, h] [1, h]; a gable face at FR, from the gable itself (the bake's numbers, not plan's rounded hs)
function faceTop(Fl, f) {
  const t = f.y * Fl.GW + f.x, k = Fl.gid[t];
  if (k < 0) return [[0, Fl.C[t]], [1, Fl.C[t]]];
  // a face along the ridge keeps one height: two points, as the ceiling's edge there has only the tile's corners (no T-junctions)
  if (Fl.gab[k].y === (f.x0 === f.x1)) { const p = faceCoord(f, Fl.L, 0), h = gabH(Fl.gab[k], p[0], p[1]); return [[0, h], [1, h]]; }
  return FR.map(u => { const p = faceCoord(f, Fl.L, u); return [u, gabH(Fl.gab[k], p[0], p[1])]; });
}
const topAt = (top, u) => { for (let j = 0; j < top.length - 1; j++) { const a = top[j], b = top[j + 1]; if (u <= b[0] + 1e-12) return a[1] + (b[1] - a[1]) * (u - a[0]) / ((b[0] - a[0]) || 1); } return top[top.length - 1][1]; };
// the parts of the area under `top` between heights lo and hi, as polygons in (u, y)
function band(top, lo, hi) {
  const pts = [];                                         // (the top line split where it crosses lo or hi)
  for (let j = 0; j < top.length; j++) {
    if (j) { const a = top[j - 1], b = top[j];
      for (const yc of [lo, hi]) if ((a[1] - yc) * (b[1] - yc) < 0) { const s = (yc - a[1]) / (b[1] - a[1]); pts.push([a[0] + (b[0] - a[0]) * s, yc]); }
      pts.sort((p, q) => p[0] - q[0]); }
    pts.push(top[j].slice());
  }
  pts.sort((p, q) => p[0] - q[0]);
  const out = [];
  for (let j = 0; j < pts.length - 1; j++) {
    const a = pts[j], b = pts[j + 1]; if (b[0] - a[0] < 1e-9) continue;
    const ya = Math.min(a[1], hi), yb = Math.min(b[1], hi);
    if (ya <= lo + 1e-9 && yb <= lo + 1e-9) continue;
    out.push([[a[0], lo], [b[0], lo], [b[0], Math.max(yb, lo)], [a[0], Math.max(ya, lo)]]);
  }
  return out;
}
// the face point at u (any u: between canonical fractions linearly), on its inset line
function facePt(Fl, f, u, inset) {
  let p;
  if (FR.indexOf(u) >= 0) p = faceCoord(f, Fl.L, u);
  else { let j = 0; while (j < 3 && u > FR[j + 1]) j++; const a = faceCoord(f, Fl.L, FR[j]), b = faceCoord(f, Fl.L, FR[j + 1]), s = (u - FR[j]) / (FR[j + 1] - FR[j]); p = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]; }
  return [p[0] + f.nx * inset, p[1] + f.nz * inset];
}
// does face f lose its quad to a module? (the plan says so, the integrator hasn't turned it off, and the kit, if given, has that module)
// No kit (E7 'kit missing', ?kit=off): the face keeps its quad, unless the integrator says skipModules: true (it draws them itself).
function skipped(plan, f, opts) {
  if (!f.skip || (opts && opts.skipModules === false)) return false;
  if (!opts || !opts.kit) return !!(opts && opts.skipModules === true);
  if (!f.mod) return true;
  const node = f.mod.type === 'window' ? plan.windows[f.mod.i] && plan.windows[f.mod.i].node : plan.modules[f.mod.i] && plan.modules[f.mod.i].node;
  return !!kitNode(opts.kit, node);
}

/* ---------- walls ---------- */
function walls(plan, opts) {
  const t0 = now(); opts = opts || {};
  const Fl = floorOf(plan, opts), L = Fl.L, at = cellsOf(Fl, opts), cells = at.cells, S = segsOf(Fl, plan), bufs = chunkBufs(), faceVerts = [];
  const emit = (buf, f, polys, inset, uvU, c) => {
    for (const q of polys) {
      const P = q.map(([u, y]) => { const p = facePt(Fl, f, u, inset); return [p[0], y, p[1]]; });
      poly(buf, P, [f.nx, 0, f.nz], q.map(([u, y]) => [uvU(u), y / FACE_H]), q.map(([u, y]) => [c.u0 + u * c.su, c.v0 + y * c.sv]));
    }
  };
  // where a face meets a neighbour of another height (straight on, or round a corner), the taller one's end gets a vertex at the
  // shorter one's top (and so at the foot of the ceiling step there): no T-junction on that seam
  const endSplits = (i, f) => {
    const s = S[i], out = [];
    for (const e of [0, 1]) { const lk = s.ends[e], g = lk && lk.seg >= 0 ? S[lk.seg] : null;
      if (!g) continue;
      // (a servant run's reveal ends on the wall plane, where a plain face's end is)
      if (g.kind === 'reveal') { if (!s.inset) out.push([e, topAt(faceTop(Fl, plan.faces[g.parent]), g.pend)]); continue; }
      if (g.kind !== 'face' || (g.inset || 0) !== (s.inset || 0)) continue;
      const ge = g.ends[0] && g.ends[0].seg === i ? 0 : g.ends[1] && g.ends[1].seg === i ? 1 : -1; if (ge < 0) continue;
      out.push([e, topAt(faceTop(Fl, g.f), ge)]); }
    return out;
  };
  const splitAt = (polys, sp) => { if (!sp.length) return polys;
    return polys.map(q => { if (q.length !== 4) return q; let L4 = [q[0], q[1]], R4 = [q[3]];
      const a = q[0][0], b = q[1][0], lo = q[0][1];
      const mid = []; for (const [u, y] of sp) {
        if (Math.abs(u - b) < 1e-9 && y > lo + 1e-6 && y < q[2][1] - 1e-6) mid.push([b, y]);
        if (Math.abs(u - a) < 1e-9 && y > lo + 1e-6 && y < q[3][1] - 1e-6) R4.push([a, y]); }
      return L4.concat(mid, [q[2]], R4); });
  };
  plan.faces.forEach((f, i) => {
    const c = cells[i], top = faceTop(Fl, f), ch = Fl.chunkOf(f.x, f.y), skip = skipped(plan, f, opts), rec = { face: i, parts: [] }, sp = endSplits(i, f);
    const part = (k, polys, uvU) => { if (!polys.length) return; polys = splitAt(polys, sp); const b = bufs.get(ch, k), s0 = b.count; emit(b, f, polys, f.inset || 0, uvU, c); rec.parts.push({ group: k, chunk: ch, first: s0, count: b.count - s0 }); };
    if (f.kind === 'service') { if (!skip) { part('service', band(top, 0, 1e9), u => u);
      // (an inset face's pocket gets its back: the wall plane behind it, so a camera that comes within 0.30 m of the wall sees wall)
      if (f.inset) emit(bufs.get(ch, 'service'), f, splitAt(band(top, 0, 1e9), sp), 0, u => u, c); } }
    else {
      if (!skip) part('main', band(top, 0, f.kind === 'upper' ? FACE_H : 1e9), u => 0.5 * u + 0.5 * (f.variant ? 1 : 0));
      if (f.kind === 'upper') part('upper', band(top, FACE_H, 1e9), u => u);
    }
    faceVerts.push(rec);
  });
  // reveals: from a servant run's inset face back to the wall plane, lit like the end of that face
  const reveals = [];
  for (const s of S) {
    if (s.kind !== 'reveal') continue;
    const pf = plan.faces[s.parent], c = cells[s.parent], ue = s.pend, H = topAt(faceTop(Fl, pf), ue), b = bufs.get(Fl.chunkOf(s.tile[0], s.tile[1]), 'service'), w = s.len;
    let P = [[s.p0[0], 0, s.p0[1]], [s.p1[0], 0, s.p1[1]], [s.p1[0], H, s.p1[1]], [s.p0[0], H, s.p0[1]]];
    // (its wall-plane end meets the plain wall going on: a vertex at that wall's top when it is lower, no T-junction)
    const lk = s.ends[s.pend], g = lk && lk.seg >= 0 ? S[lk.seg] : null;
    if (g && g.kind === 'face' && !g.inset) { const ge = g.ends[0] && g.ends[0].seg === s.i ? 0 : g.ends[1] && g.ends[1].seg === s.i ? 1 : -1;
      const hn = ge < 0 ? -1 : topAt(faceTop(Fl, g.f), ge);
      if (hn > 1e-6 && hn < H - 1e-6) P = s.pend ? [P[0], P[1], [s.p1[0], hn, s.p1[1]], P[2], P[3]] : [P[0], P[1], P[2], P[3], [s.p0[0], hn, s.p0[1]]]; }
    poly(b, P, [s.n[0], 0, s.n[1]], P.map(p => [((p[0] - s.p0[0]) * s.t[0] + (p[2] - s.p0[1]) * s.t[1]) / L, p[1] / FACE_H]), P.map(p => [c.u0 + ue * c.su, c.v0 + p[1] * c.sv]));
    reveals.push({ face: s.parent, end: ue, p0: s.p0, p1: s.p1, n: s.n, h: H });
  }
  const group = new THREE.Group(); group.name = 'arch_walls';
  const mats = { main: matOf(opts, 'wall') || grey(), upper: matOf(opts, 'upper', 'wall') || grey(), service: matOf(opts, 'service', 'wall') || grey() }, meshes = [];
  for (const b of bufs.all()) { const m = meshOf(b, mats[b.k], 'arch_walls_' + b.k + '_' + b.c, 'walls_' + b.k, b.c, { cast: opts.castShadow !== false }); if (m) { group.add(m); meshes.push(m); } }
  // (faceVerts: which vertices of which chunk mesh each face got, for the tests)
  const meshAt = new Map(meshes.map(m => [m.userData.chunk + '|' + m.userData.arch.slice(6), m]));
  for (const r of faceVerts) for (const p of r.parts) p.mesh = meshes.indexOf(meshAt.get(p.chunk + '|' + p.group));
  return finish({ faces: Fl.bakeFaces, cells, atlas: { W: at.W, H: at.H, ppm: at.ppm }, reveals, faceVerts, meshes }, group, t0);
}

/* ---------- ceilings ---------- */
function ceilings(plan, opts) {
  const t0 = now(); opts = opts || {};
  const Fl = floorOf(plan, opts), { GW, GH, L, W, C, gid, gab } = Fl, bufs = chunkBufs(), PW = GW * L, PH = GH * L;
  const cut = new Set();
  if (opts.skipModules !== false) for (const m of plan.modules) if ((m.kind === 'skylight' || m.kind === 'ceilhole') && (opts.kit ? kitNode(opts.kit, m.node) : opts.skipModules === true)) cut.add(m.y * GW + m.x);
  const edge = (t0i, k) => { const x = t0i * L; return k === 0 ? x : k === 4 ? x + L : x + FR[k] * L; };   // (tile edge + FR[k] L: walls compute theirs the same way)
  const planUV = (x, z) => [x / PW, 1 - z / PH];
  // the points along the edge between open tiles ta < tb (ax: the edge runs along x, tb below ta; else along z, tb right of ta):
  // its ends, the FR points where a gable tile's roof slopes along it, where a sloping side crosses 3.0 m (the walls split there)
  // and where the two ceilings cross. The tiles on both sides and the step between them all use these, so no T-junctions
  const fineAx = (t, ax) => gid[t] >= 0 && gab[gid[t]].y === ax, ES = new Map();
  const edgeS = (ta, tb, ax) => {
    const key = ta * 2 + (ax ? 1 : 0); if (ES.has(key)) return ES.get(key);
    const xa = ta % GW, ya = (ta / GW) | 0, ks = fineAx(ta, ax) || fineAx(tb, ax) ? [0, 1, 2, 3, 4] : [0, 4];
    const at = (sv, extra) => { const p = ax ? [sv, (ya + 1) * L] : [(xa + 1) * L, sv]; return Object.assign({ s: sv, p, ha: Fl.ceilT(ta, p[0], p[1]), hb: Fl.ceilT(tb, p[0], p[1]) }, extra); };
    const pts = ks.map(k => at(edge(ax ? xa : ya, k))), all = [pts[0]];
    for (let j = 1; j < pts.length; j++) { const a = pts[j - 1], c = pts[j], mid = [];
      const da = a.ha - a.hb, dc = c.ha - c.hb;
      if (da * dc < 0 && Math.abs(da) > EPS && Math.abs(dc) > EPS) mid.push(at(a.s + (c.s - a.s) * (da / (da - dc)), { cross: true }));
      for (const h of ['ha', 'hb']) if ((a[h] - FACE_H) * (c[h] - FACE_H) < 0) mid.push(at(a.s + (c.s - a.s) * (FACE_H - a[h]) / (c[h] - a[h])));
      mid.sort((u, v) => u.s - v.s); for (const q of mid) if (q.s - all[all.length - 1].s > 1e-7 && c.s - q.s > 1e-7) all.push(q);
      all.push(c); }
    ES.set(key, all); return all;
  };
  // the points strictly inside the edge from (x, z) p to q shared with open tile nb (ax as above), in order from p to q
  const inner = (t, nb, ax, p, q) => {
    if (nb < 0 || W[nb]) return null;
    const E = edgeS(Math.min(t, nb), Math.max(t, nb), ax), s0 = ax ? p[0] : p[1], s1 = ax ? q[0] : q[1], lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    const r = E.filter(e => e.s > lo + 1e-7 && e.s < hi - 1e-7).map(e => e.p); return s1 < s0 ? r.reverse() : r;
  };
  const nbOf = (tx, ty) => tx < 0 || ty < 0 || tx >= GW || ty >= GH ? -1 : ty * GW + tx;
  for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
    const t = ty * GW + tx; if (W[t] || cut.has(t)) continue;
    const b = bufs.get(Fl.chunkOf(tx, ty), 'c'), k = gid[t];
    const vtx = (x, z) => { const y = Fl.ceilT(t, x, z); return [x, y, z]; };
    if (k < 0) {
      // (an edge next to a gable tile that slopes along it takes the points edgeS gives it)
      const x0 = tx * L, z0 = ty * L, x1 = x0 + L, z1 = z0 + L, C4 = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      const NB = [[nbOf(tx, ty - 1), true], [nbOf(tx + 1, ty), false], [nbOf(tx, ty + 1), true], [nbOf(tx - 1, ty), false]], P = [];
      for (let e = 0; e < 4; e++) { const a = C4[e], c = C4[(e + 1) % 4], [nb, ax] = NB[e]; P.push(vtx(a[0], a[1]));
        if (nb >= 0 && !W[nb] && fineAx(nb, ax)) for (const q of inner(t, nb, ax, a, c)) P.push(vtx(q[0], q[1])); }
      poly(b, P, [0, -1, 0], P.map(p => [p[0] / L, p[2] / L]), P.map(p => planUV(p[0], p[2])));
      continue;
    }
    // a gable tile: strips across the ridge at FR (planar between them: the ridge sits at a tile's middle or edge)
    const q = gab[k];
    for (let j = 0; j < 4; j++) {
      let C4, NB;      // (the strip's corners; on its two tile borders along the slope, the neighbour there)
      if (q.y) { const a = edge(tx, j), c = edge(tx, j + 1); C4 = [[a, ty * L], [c, ty * L], [c, ty * L + L], [a, ty * L + L]]; NB = [[nbOf(tx, ty - 1), true], null, [nbOf(tx, ty + 1), true], null]; }
      else { const a = edge(ty, j), c = edge(ty, j + 1); C4 = [[tx * L, a], [tx * L + L, a], [tx * L + L, c], [tx * L, c]]; NB = [null, [nbOf(tx + 1, ty), false], null, [nbOf(tx - 1, ty), false]]; }
      // (plus, along those borders, edgeS's points next to an open tile, else where the edge crosses 3.0 m: the walls split there
      // into main wall and upper band, so they share that vertex)
      let P = [];
      for (let e = 0; e < 4; e++) { const a = C4[e], c = C4[(e + 1) % 4], A = vtx(a[0], a[1]); P.push(A);
        if (!NB[e]) continue;
        const r = inner(t, NB[e][0], NB[e][1], a, c);
        if (r) for (const p of r) P.push(vtx(p[0], p[1]));
        else { const C = vtx(c[0], c[1]); if ((A[1] - FACE_H) * (C[1] - FACE_H) < 0) { const f = (FACE_H - A[1]) / (C[1] - A[1]); P.push([A[0] + (C[0] - A[0]) * f, FACE_H, A[2] + (C[2] - A[2]) * f]); } } }
      // the strip's normal, pointing down into the room
      const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], vx = P[P.length - 1][0] - P[0][0], vy = P[P.length - 1][1] - P[0][1], vz = P[P.length - 1][2] - P[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const ln = Math.hypot(nx, ny, nz) || 1; if (ny > 0) { nx = -nx; ny = -ny; nz = -nz; }
      poly(b, P, [nx / ln, ny / ln, nz / ln], P.map(p => [p[0] / L, p[2] / L]), P.map(p => planUV(p[0], p[2])));
    }
  }
  // steps between neighbouring open tiles: along their shared edge, wherever one ceiling is higher, a vertical strip facing that side
  const steps = [];
  const atWall = p => { const cx = Math.round(p[0] / L), cz = Math.round(p[1] / L); return Fl.isW(cx - 1, cz - 1) || Fl.isW(cx, cz - 1) || Fl.isW(cx - 1, cz) || Fl.isW(cx, cz); };
  const step = (ta, tb, ax) => {          // ax: the edge runs along x (tb is below ta in z); else along z (tb right of ta)
    const all = edgeS(ta, tb, ax);
    for (let j = 0; j < all.length - 1; j++) {
      const a = all[j], c = all[j + 1], dm = (a.ha - a.hb) + (c.ha - c.hb);
      if (Math.abs(a.ha - a.hb) < 1e-5 && Math.abs(c.ha - c.hb) < 1e-5) continue;
      const hiB = dm < 0, th = hiB ? tb : ta, nrm = ax ? [0, 0, hiB ? 1 : -1] : [hiB ? 1 : -1, 0, 0];
      const lo = q => Math.min(q.ha, q.hb), hi = q => Math.max(q.ha, q.hb);
      const P = [[a.p[0], lo(a), a.p[1]], [c.p[0], lo(c), c.p[1]], [c.p[0], hi(c), c.p[1]], [a.p[0], hi(a), a.p[1]]].filter((p, i, A) => i === 0 || Math.abs(p[1] - A[i - 1][1]) > 1e-9 || p[0] !== A[i - 1][0] || p[2] !== A[i - 1][2]);
      let Q = P.filter((p, i) => !(i === P.length - 1 && p[0] === P[0][0] && p[2] === P[0][2] && Math.abs(p[1] - P[0][1]) < 1e-9));
      // (where the step ends at a wall whose band splits at 3.0 m, its end edge gets that vertex too: no T-junction there)
      if (Q.length === 4) {
        const cut3 = (q, ok) => ok && lo(q) < FACE_H - 1e-6 && hi(q) > FACE_H + 1e-6 && atWall(q.p);
        const A3 = cut3(a, j === 0), C3 = cut3(c, j === all.length - 2);
        if (A3 || C3) Q = [Q[0], Q[1]].concat(C3 ? [[c.p[0], FACE_H, c.p[1]]] : [], [Q[2], Q[3]], A3 ? [[a.p[0], FACE_H, a.p[1]]] : []);
      }
      const b = bufs.get(Fl.chunkOf(th % GW, (th / GW) | 0), 'c'), off = 0.01;     // (uv1: the plan uv 1 cm into the higher tile)
      poly(b, Q, nrm, Q.map(p => [(ax ? p[0] : p[2]) / L, p[1] / L]), Q.map(p => planUV(p[0] + nrm[0] * off, p[2] + nrm[2] * off)));
      steps.push({ a: ta, b: tb, high: th, p0: [a.p[0], a.p[1]], p1: [c.p[0], c.p[1]], lo: [lo(a), lo(c)], hi: [hi(a), hi(c)], n: nrm });
    }
  };
  for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
    const t = ty * GW + tx; if (W[t]) continue;
    if (tx + 1 < GW && !W[t + 1]) step(t, t + 1, false);
    if (ty + 1 < GH && !W[t + GW]) step(t, t + GW, true);
  }
  const group = new THREE.Group(); group.name = 'arch_ceilings';
  const mat = matOf(opts, 'ceiling') || grey(), meshes = [];
  for (const b of bufs.all()) { const m = meshOf(b, mat, 'arch_ceil_' + b.c, 'ceilings', b.c, { cast: false }); if (m) { m.receiveShadow = true; group.add(m); meshes.push(m); } }
  return finish({ steps, cut: [...cut].sort((a, b) => a - b), meshes }, group, t0);
}

/* ---------- moulding profiles (B5) ----------
   A profile is a polyline [[d, y]...] in metres: d out from the wall, y up from its anchor: the floor (skirting), the rail's height
   (dado y, picture rail y, both centred on it) or the ceiling (cornice: y <= 0, from the wall down at -h out to the ceiling at d).
   v: its band of the trim sheet. textures/arch/<style>.profiles.json has the same shape: {skirting, dado, cornice, pictureRail},
   each {pts, y?, v?} or null (none); missing kinds fall back to these. */
const arc = (cx, cy, rx, ry, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return o; };
const PROF = {
  ogee: (h, d) => [[0, 0], [d, 0], [d, 0.66 * h], ...[1, 2, 3, 4, 5, 6].map(i => { const s = i / 6; return [d - 0.6 * d * (0.5 - 0.5 * Math.cos(PI * s)), 0.66 * h + 0.26 * h * s]; }),
    [0.4 * d, h], [0, h]],
  bullnose: (h, d) => { const r = Math.min(d * 0.8, 0.02); return [[0, 0], [d, 0], [d, h - r], ...arc(d - r, h - r, r, r, 0, PI / 2, 5).slice(1), [0, h]]; },
  chamfer: (h, d, c) => [[0, 0], [d, 0], [d, h - c], [d - c, h], [0, h]],
  rail: (h, d) => { const f = 0.35 * d; return [[0, -h / 2], [f, -h / 2], ...arc(f, 0, d - f, h * 0.36, -PI / 2, PI / 2, 8), [f, h / 2], [0, h / 2]]; },
  cove: (h, d) => { const k = Math.min(0.015, h * 0.12, d * 0.12); return [[0, -h], [k, -h], [k, -h + k], ...arc(d - k, -h + k, d - 2 * k, h - 2 * k, PI, PI / 2, 8).slice(1), [d, -k], [d, 0]]; },
  stepped: (h, d) => { const k = Math.min(0.02, h * 0.12); return [[0, -h], [0.25 * d, -h], [0.25 * d, -h + 0.3 * h], [0.5 * d, -h + 0.3 * h], ...arc(d - k, -h + 0.3 * h, 0.5 * d - k, 0.7 * h - k, PI, PI / 2, 6).slice(1), [d, -k], [d, 0]]; },
  batten: (h, d) => [[0, -h / 2], [d - 0.004, -h / 2], [d, -h / 2 + 0.004], [d, h / 2 - 0.004], [d - 0.004, h / 2], [0, h / 2]],
};
const V = { skirting: [0, 0.4], dado: [0.4, 0.55], cornice: [0.55, 0.85], pictureRail: [0.85, 1] };
function builtinProfiles(style) {
  const T = (typeof KIT !== 'undefined' && KIT.arch && KIT.arch.trims && KIT.arch.trims[style]) || {}, sk = T.skirting || {};
  const rail = (y, h, d) => ({ pts: PROF.rail(h, d), y, v: V.dado }), pic = { pts: PROF.batten(0.045, 0.025), y: (T.pictureRail || FACE_H), v: V.pictureRail };
  const C = T.cornice || {};
  switch (style) {
    case 'wood': return { skirting: { pts: PROF.ogee(sk.h || 0.18, sk.d || 0.025), v: V.skirting }, dado: rail(T.dado || 0.93, 0.06, 0.03),
      cornice: { pts: PROF.cove(C.h || 0.14, C.d || 0.12), v: V.cornice }, pictureRail: { pts: PROF.rail(0.045, 0.025), y: pic.y, v: V.pictureRail } };
    case 'tile': return { skirting: { pts: PROF.bullnose(sk.h || 0.25, sk.d || 0.03), v: V.skirting }, dado: rail(T.dado || 0.87, 0.06, 0.03),
      cornice: { pts: PROF.stepped(C.h || 0.2, C.d || 0.16), v: V.cornice }, pictureRail: { pts: PROF.rail(0.045, 0.025), y: pic.y, v: V.pictureRail } };
    case 'concrete': return { skirting: { pts: PROF.chamfer(sk.h || 0.1, sk.d || 0.04, 0.012), v: V.skirting }, dado: null, cornice: null, pictureRail: pic };
    case 'attic': return { skirting: { pts: PROF.chamfer(sk.h || 0.09, sk.d || 0.02, 0.005), v: V.skirting }, dado: null, cornice: null, pictureRail: pic };
    default: return { skirting: { pts: PROF.chamfer(sk.h || 0.14, sk.d || 0.022, 0.005), v: V.skirting }, dado: { pts: PROF.batten(0.05, 0.04), y: T.dado || 0.93, v: V.dado },
      cornice: { pts: PROF.stepped(C.h || 0.12, C.d || 0.08), v: V.cornice }, pictureRail: pic };
  }
}
const LOADED = {};
function profiles(style, given) {
  const base = builtinProfiles(style), src = given || LOADED[style] || null;
  if (!src) return base;
  const out = {};
  for (const k of ['skirting', 'dado', 'cornice', 'pictureRail']) {
    if (src[k] === null) { out[k] = null; continue; }
    const p = src[k]; if (!p || !Array.isArray(p.pts) || p.pts.length < 2) { out[k] = base[k]; continue; }
    out[k] = { pts: p.pts.map(q => [+q[0], +q[1]]), y: p.y !== undefined ? +p.y : base[k] && base[k].y, v: p.v || V[k] };
  }
  return out;
}
function loadProfiles(style) {
  if (LOADED[style] !== undefined) return Promise.resolve(LOADED[style]);
  if (typeof fetch === 'undefined') return Promise.resolve(null);
  return fetch('textures/arch/' + style + '.profiles.json').then(r => r.ok ? r.json() : null).catch(() => null).then(j => (LOADED[style] = j || null));
}
// a profile ready to sweep: its points, closed outline (for end caps), each segment's outward normal and v, which segments to draw
function prepProfile(p, anchor) {
  const pts = p.pts, m = pts.length;
  const ring = pts.slice(); if (Math.abs(pts[m - 1][0]) > 1e-9) ring.push([0, pts[m - 1][1]]); if (Math.abs(pts[0][0]) > 1e-9) ring.push([0, pts[0][1]]);
  let a = 0; for (let i = 0; i < ring.length; i++) { const P = ring[i], Q = ring[(i + 1) % ring.length]; a += P[0] * Q[1] - Q[0] * P[1]; }
  const ccw = a >= 0, segN = [], draw = [], arcs = [0];
  for (let k = 0; k < m - 1; k++) {
    const dd = pts[k + 1][0] - pts[k][0], dy = pts[k + 1][1] - pts[k][1], l = Math.hypot(dd, dy) || 1;
    const nd = (ccw ? dy : -dy) / l, ny = (ccw ? -dd : dd) / l; segN.push([nd, ny]); arcs.push(arcs[k] + l);
    const onWall = Math.abs(pts[k][0]) < 1e-9 && Math.abs(pts[k + 1][0]) < 1e-9, onFloor = anchor === 'floor' && ny < -0.99 && Math.abs(pts[k][1]) < 1e-9 && Math.abs(pts[k + 1][1]) < 1e-9;
    const onCeil = anchor === 'ceil' && ny > 0.99 && Math.abs(pts[k][1]) < 1e-9 && Math.abs(pts[k + 1][1]) < 1e-9;
    draw.push(!(onWall || onFloor || onCeil || nd < -0.99));
  }
  // smooth normals at a profile vertex when its two segments turn less than 40 degrees
  const vn = (k, seg) => { const own = segN[seg], o = seg === k ? segN[k - 1] : segN[k]; if (!o) return own;
    if (own[0] * o[0] + own[1] * o[1] < Math.cos(40 * DEG)) return own; const x = own[0] + o[0], y = own[1] + o[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  return { pts, m, ring, tris: triangulate(ring), segN, draw, arcs, total: arcs[m - 1] || 1, vn, v: p.v || [0, 1], depth: Math.max(...pts.map(q => q[0])) };
}

/* ---------- trims ---------- */
function trims(plan, opts) {
  const t0 = now(); opts = opts || {};
  const Fl = floorOf(plan, opts), L = Fl.L, S = segsOf(Fl, plan), F = plan.faces, style = plan.style, bufs = chunkBufs();
  const PR = profiles(style, opts.profiles), KINDS = ['skirting', 'dado', 'cornice', 'pictureRail'], prep = {};
  for (const k of KINDS) if (PR[k]) prep[k] = prepProfile(PR[k], k === 'skirting' ? 'floor' : k === 'cornice' ? 'ceil' : 'mid');
  const ARCH = (typeof KIT !== 'undefined' && KIT.arch && KIT.arch.pieces) || {}, CAS = 0.08;
  const railY = PR.pictureRail ? (PR.pictureRail.y || FACE_H) : FACE_H, railTop = prep.pictureRail ? Math.max(...PR.pictureRail.pts.map(q => q[1])) : 0;
  const corH = prep.cornice ? -Math.min(...PR.cornice.pts.map(q => q[1])) : 0;
  // the open tile of a wardrobe and the face its back stands against (the one facing its only way out)
  const isW = Fl.isW, peelsOn = new Map();
  for (const m of plan.modules) if (m.kind === 'peel') { if (!peelsOn.has(m.face)) peelsOn.set(m.face, []); peelsOn.get(m.face).push(m); }
  // each segment's own top (gable faces slope) as a function of lambda, metres along its effective line
  const topOf = s => {
    if (s.kind === 'reveal') { const H = topAt(faceTop(Fl, F[s.parent]), s.pend); return () => H; }
    const f = s.f, top = faceTop(Fl, f), fx = s.t[0], fz = s.t[1];
    return lam => { const px = s.p0[0] + fx * lam - f.nx * s.inset, pz = s.p0[1] + fz * lam - f.nz * s.inset, u = clamp(((px - f.x0) * fx + (pz - f.z0) * fz) / L, 0, 1); return topAt(top, u); };
  };
  // u on the face -> lambda on the segment
  const lamOf = (s, u) => { const f = s.f, px = f.x0 + (f.x1 - f.x0) * u + f.nx * s.inset, pz = f.z0 + (f.z1 - f.z0) * u + f.nz * s.inset; return (px - s.p0[0]) * s.t[0] + (pz - s.p0[1]) * s.t[1]; };
  const sub = (iv, a, b) => { const out = []; for (const [x, y] of iv) { if (b <= x || a >= y) { out.push([x, y]); continue; } if (a > x) out.push([x, a]); if (b < y) out.push([b, y]); } return out; };
  // where each kind of moulding runs on each segment: [lambda0, lambda1] intervals
  const IV = S.map(s => {
    const o = {}, len = s.len, f = s.f, top = topOf(s);
    if (s.kind === 'reveal' || s.group === 'service') { if (prep.skirting) o.skirting = [[0, len]]; s.top = top; return o; }
    s.top = top;
    const sk = skipped(plan, f, opts), mod = sk && f.mod ? (f.mod.type === 'window' ? Object.assign({ kind: 'window' }, plan.windows[f.mod.i]) : plan.modules[f.mod.i]) : null;
    for (const k of KINDS) { if (prep[k]) o[k] = [[0, len]]; }
    // the picture rail only where the wall rises clear above it (below the cornice), and only on faces above 3.0 m
    // (where the wall's top stands at least `need` high: [lambda0, lambda1] intervals)
    const clear = need => { const iv = []; let st = -1; const N = 32;
      for (let j = 0; j <= N; j++) { const lam = len * j / N, ok = top(lam) >= need - 1e-9;
        if (ok && st < 0) st = lam; if ((!ok || j === N) && st >= 0) { const e = ok ? len : lam - len / N; if (e - st > 0.05) iv.push([st, e]); st = -1; } }
      return iv; };
    if (o.pictureRail) {
      if (f.kind !== 'upper') delete o.pictureRail;
      else { const iv = clear(railY + railTop + 0.05 + corH); if (iv.length) o.pictureRail = iv; else delete o.pictureRail; }
    }
    const stop = (kinds, u0, u1) => { const a = lamOf(s, u0), b = lamOf(s, u1); for (const k of kinds) if (o[k]) o[k] = sub(o[k], Math.min(a, b), Math.max(a, b)); };
    // the exit is always drawn (makeExit's door or the kit's Mod_exit): no skirting or dado runs across its door, skipped face or not
    const fm = f.mod && f.mod.type !== 'window' ? plan.modules[f.mod.i] : null;
    if (fm && fm.kind === 'exit' && !mod) { const w = (0.575 + CAS) / L; stop(['skirting', 'dado'], 0.5 - w, 0.5 + w); }
    // peeling paper (0.4-1.6 m, no skip): the dado rail stops either side of it
    for (const m of peelsOn.get(s.face) || []) stop(['dado'], m.u0 - 0.02 / L, m.u1 + 0.02 / L);
    if (mod) {
      // an exit or fireplace module covers the face up to faceH (3.0 m): no skirting or dado; the cornice stays where the wall rises
      // clear above the module, the picture rail (on the module's top seam) where the face has an upper band
      if (mod.kind === 'exit' || mod.kind === 'fireplace') { delete o.skirting; delete o.dado;
        if (o.cornice) { const iv = clear(FACE_H + corH + 0.02); if (iv.length) o.cornice = iv; else delete o.cornice; } }
      else if (mod.kind === 'window') stop(['dado'], mod.u0 - CAS / L, mod.u1 + CAS / L);
      else if (mod.kind === 'door_closed') { const a = ARCH[mod.node], w = (a && a.door ? a.door[0] : 0.9) / 2 + CAS; stop(['skirting', 'dado'], 0.5 - w / L, 0.5 + w / L); }
      else if (mod.kind === 'niche') { const a = ARCH[mod.node], w = (a && a.niche ? a.niche[0] : 0.6) / 2 + CAS; stop(['dado'], 0.5 - w / L, 0.5 + w / L); }
      else if (mod.kind === 'wallhole') { const a = ARCH[mod.node], w = (a && a.hole ? a.hole[0] : 0.8) / 2 + CAS; stop(['skirting', 'dado'], 0.5 - w / L, 0.5 + w / L); }
    }
    if (f.busy.indexOf('door') >= 0) { const w = (LINING / 2 + 0.03) / L; stop(KINDS, 0.5 - w, 0.5 + w); }      // (a doorway's posts and header)
    if (f.busy.indexOf('wardrobe') >= 0) {                                           // (the wardrobe's back against this wall)
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !isW(f.x + dx, f.y + dy));
      if (open.length === 1 && open[0][0] === f.nx && open[0][1] === f.nz) { const w = (0.575 + 0.03) / L; stop(['skirting', 'dado'], 0.5 - w, 0.5 + w); }
    }
    for (const k of KINDS) if (o[k]) { o[k] = o[k].filter(([a, b]) => b - a > 0.02); if (!o[k].length) delete o[k]; }
    return o;
  });
  // does segment g have moulding k reaching the end that meets segment s, at the same height there?
  const meets = (s, e, k) => {
    const lk = s.ends[e]; if (!lk || lk.seg < 0) return false;
    const g = S[lk.seg], iv = IV[g.i][k]; if (!iv) return false;
    const ge = g.ends[0] && g.ends[0].seg === s.i ? 0 : g.ends[1] && g.ends[1].seg === s.i ? 1 : -1; if (ge < 0) return false;
    if (!(ge ? iv[iv.length - 1][1] >= g.len - 1e-6 : iv[0][0] <= 1e-6)) return false;
    if (k === 'cornice') return Math.abs(s.top(e ? s.len : 0) - g.top(ge ? g.len : 0)) < 1e-4;
    return true;
  };
  const rings = new Map(), joints = [];
  // per profile segment, once: its two vertex normals (in the profile's d, y) and v range
  for (const k in prep) { const P = prep[k]; P.seg = [];
    for (let q = 0; q < P.m - 1; q++) if (P.draw[q]) P.seg.push({ q, n0: P.vn(q, q), n1: P.vn(q + 1, q), sn: P.segN[q],
      v0: P.v[0] + (P.v[1] - P.v[0]) * P.arcs[q] / P.total, v1: P.v[0] + (P.v[1] - P.v[0]) * P.arcs[q + 1] / P.total }); }
  // straight runs: a moulding that goes on flat into the next face of the same wall line (same chunk, same height) is one sweep,
  // so no butt rings are made inside it. joinNext(s, k): the face it continues into, or null
  const joinNext = (s, k) => {
    if (s.kind !== 'face') return null;
    const lk = s.ends[1]; if (!lk || lk.cls !== 'flat' || lk.seg < 0) return null;
    const g = S[lk.seg]; if (g.kind !== 'face' || !g.ends[0] || g.ends[0].seg !== s.i || g.t[0] !== s.t[0] || g.t[1] !== s.t[1] || g.n[0] !== s.n[0] || g.n[1] !== s.n[1]) return null;
    const iv = IV[s.i][k], ig = IV[g.i][k]; if (!iv || !ig || iv[iv.length - 1][1] < s.len - 1e-6 || ig[0][0] > 1e-6 || !meets(s, 1, k)) return null;
    if (Fl.chunkOf(s.tile[0], s.tile[1]) !== Fl.chunkOf(g.tile[0], g.tile[1])) return null;
    if (k === 'cornice' && (s.f.hs || g.f.hs || Math.abs(s.top(s.len) - g.top(0)) > 1e-9)) return null;
    return g;
  };
  // (s's first interval of k is the tail of a run that starts on an earlier face)
  const isTail = (s, k) => { const lk = s.ends[0]; return !!(s.kind === 'face' && lk && lk.cls === 'flat' && lk.seg >= 0 && joinNext(S[lk.seg], k) === s); };
  // sweep the run from lambda a on segment s0 to lambda b on segment s1 (s1 after s0 on one straight line, off1 metres on, or s0 itself)
  const sweep = (s0, s1, off1, k, a, b) => {
    const P = prep[k], pr = PR[k], s = s0, ch = Fl.chunkOf(s.tile[0], s.tile[1]), buf = bufs.get(ch, 't'), B = off1 + b, sx = s.t[0], sz = s.t[1], nx = s.n[0], nz = s.n[1];
    // each end: mitre (inside: -d at the end, +d at the start; outside: the other way), butt (flat, nothing to cap) or a capped stop
    const endOf = (g, lam, e) => { const atEnd = e ? lam >= g.len - 1e-6 : lam <= 1e-6; if (!atEnd) return { m: 0, cap: true, cls: 'stop' };
      const lk = g.ends[e], has = meets(g, e, k);
      if (lk.cls === 'inside') return { m: has ? (e ? -1 : 1) : 0, cap: false, cls: has ? 'inside' : 'butt-wall' };
      if (lk.cls === 'outside') return has ? { m: e ? 1 : -1, cap: false, cls: 'outside' } : { m: 0, cap: true, cls: 'stop' };
      return has ? { m: 0, cap: false, cls: 'flat' } : { m: 0, cap: true, cls: 'stop' }; };
    const A = endOf(s0, a, 0), Bn = endOf(s1, b, 1);
    // stations along the run: the ends, plus the gable's kinks for a cornice under a sloped top (never part of a longer run)
    const st = [a];
    if (k === 'cornice' && s.kind === 'face' && s.f.hs) for (const u of FR) { const l = lamOf(s, u); if (l > a + 1e-6 && l < B - 1e-6) st.push(l); }
    st.push(B); st.sort((x, y) => x - y);
    const ns = st.length, m = P.m, py = pr.y || 0;
    const base = lam => k === 'skirting' ? 0 : k === 'cornice' ? s.top(clamp(lam, 0, s.len)) : py;
    // the stations' rings: flat arrays of x, y, z and lambda per profile point
    const RX = new Float64Array(ns * m), RY = new Float64Array(ns * m), RZ = new Float64Array(ns * m), RL = new Float64Array(ns * m);
    for (let j = 0; j < ns; j++) { const lam = st[j], by = base(lam), mm = j === 0 ? A.m : j === ns - 1 ? Bn.m : 0;
      for (let q = 0; q < m; q++) { const d = P.pts[q][0], l = lam + mm * d, o = j * m + q;
        RX[o] = s.p0[0] + sx * l + nx * d; RY[o] = by + P.pts[q][1]; RZ[o] = s.p0[1] + sz * l + nz * d; RL[o] = l; } }
    const I4 = [0, 0, 0, 0];
    for (let j = 0; j < ns - 1; j++) for (const g of P.seg) {
      const q = g.q, o00 = j * m + q, o01 = o00 + 1, o11 = o01 + m, o10 = o00 + m;
      // (wound by the segment's own normal: Newell's normal of the quad decides; each vertex gets its smoothed normal)
      const wx = nx * g.sn[0], wy = g.sn[1], wz = nz * g.sn[0];
      I4[0] = o00; I4[1] = o01; I4[2] = o11; I4[3] = o10; let cx = 0, cy = 0, cz = 0;
      for (let i2 = 0; i2 < 4; i2++) { const p0 = I4[i2], p1 = I4[(i2 + 1) & 3]; cx += (RY[p0] - RY[p1]) * (RZ[p0] + RZ[p1]); cy += (RZ[p0] - RZ[p1]) * (RX[p0] + RX[p1]); cz += (RX[p0] - RX[p1]) * (RY[p0] + RY[p1]); }
      if (cx * cx + cy * cy + cz * cz < 1e-24) continue;
      const flip = cx * wx + cy * wy + cz * wz < 0, n0 = g.n0, n1 = g.n1, b0 = buf.count;
      buf.v(RX[o00], RY[o00], RZ[o00], nx * n0[0], n0[1], nz * n0[0], (s.sw0 + RL[o00]) / L, g.v0);
      buf.v(RX[o01], RY[o01], RZ[o01], nx * n1[0], n1[1], nz * n1[0], (s.sw0 + RL[o01]) / L, g.v1);
      buf.v(RX[o11], RY[o11], RZ[o11], nx * n1[0], n1[1], nz * n1[0], (s.sw0 + RL[o11]) / L, g.v1);
      buf.v(RX[o10], RY[o10], RZ[o10], nx * n0[0], n0[1], nz * n0[0], (s.sw0 + RL[o10]) / L, g.v0);
      flip ? buf.ix.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2) : buf.ix.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
    const ringAt = j => { const out = []; for (let q = 0; q < m; q++) { const o = j * m + q; out.push([RX[o], RY[o], RZ[o]]); } return out; };
    // end caps on stops
    for (const [j, E, sgn] of [[0, A, -1], [ns - 1, Bn, 1]]) {
      if (!E.cap) continue;
      const lam = st[j], by = base(lam), ring = P.ring.map(([d, y]) => [s.p0[0] + sx * lam + nx * d, by + y, s.p0[1] + sz * lam + nz * d]), nrm = [sx * sgn, 0, sz * sgn];
      const uu = (s.sw0 + lam) / L, vv = P.v[0] + (P.v[1] - P.v[0]) * 0.5;
      for (const [i0, i1, i2] of P.tris) poly(buf, [ring[i0], ring[i1], ring[i2]], nrm, [[uu, vv], [uu, vv], [uu, vv]]);
    }
    if (a <= 1e-6) rings.set(s0.i + ':' + k + ':0', { cls: A.cls, ring: ringAt(0), lam: a });                // (the run's own ends only)
    if (b >= s1.len - 1e-6) rings.set(s1.i + ':' + k + ':1', { cls: Bn.cls, ring: ringAt(ns - 1), lam: b });
  };
  S.forEach((s, i) => { const o = IV[i]; for (const k of KINDS) if (o[k]) o[k].forEach(([a, b], n) => {
    if (n === 0 && isTail(s, k)) return;
    // follow the straight run on as far as it goes (it ends inside a face at a stop: that face's other intervals sweep on their own)
    let last = s, lb = b, off = 0;
    if (n === o[k].length - 1) for (let g = joinNext(last, k), guard = 0; g && g !== s && guard++ < 999; g = joinNext(last, k)) {
      off += last.len; const ig = IV[g.i][k]; last = g; lb = ig[0][1];
      if (ig.length > 1) break;
    }
    sweep(s, last, off, k, a, lb);
  }); });
  // the joints, each once: the two rings that meet (for the tests: they must coincide, at 45 degrees on corners)
  for (const s of S) for (const e of [0, 1]) for (const k of KINDS) {
    const r = rings.get(s.i + ':' + k + ':' + e); if (!r || (r.cls !== 'inside' && r.cls !== 'outside' && r.cls !== 'flat')) continue;
    const g = S[s.ends[e].seg], ge = g.ends[0].seg === s.i ? 0 : 1, rg = rings.get(g.i + ':' + k + ':' + ge); if (!rg || s.i > g.i) continue;
    joints.push({ kind: k, cls: r.cls, a: r.ring, b: rg.ring, ta: [s.t[0] * (e ? 1 : -1), s.t[1] * (e ? 1 : -1)], tb: [g.t[0] * (ge ? 1 : -1), g.t[1] * (ge ? 1 : -1)], segA: s.i, segB: g.i, na: s.n, nb: g.n });
  }
  const group = new THREE.Group(); group.name = 'arch_trims';
  const mat = matOf(opts, 'trim') || grey(), meshes = [];
  for (const b of bufs.all()) { const m = meshOf(b, mat, 'arch_trim_' + b.c, 'trims', b.c, { cast: !!opts.castShadow }); if (m) { group.add(m); meshes.push(m); } }
  return finish({ joints, profiles: PR, meshes }, group, t0);
}

/* ---------- beams ---------- */
// a closed section [[p, q]...] (counter-clockwise) swept from s0 to s1 along axis A (P, Q: the section's axes in the world)
function extrude(buf, sec, O, A, P, Q, s0, s1, uvLen) {
  const per = []; let tot = 0; for (let i = 0; i < sec.length; i++) { per.push(tot); const a = sec[i], b = sec[(i + 1) % sec.length]; tot += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const W = (s, p, q) => [O[0] + A[0] * s + P[0] * p + Q[0] * q, O[1] + A[1] * s + P[1] * p + Q[1] * q, O[2] + A[2] * s + P[2] * p + Q[2] * q];
  const sw = (s) => (O[0] * A[0] + O[1] * A[1] + O[2] * A[2] + s) / uvLen;
  for (let i = 0; i < sec.length; i++) {
    const a = sec[i], b = sec[(i + 1) % sec.length], dp = b[0] - a[0], dq = b[1] - a[1], l = Math.hypot(dp, dq) || 1, np = dq / l, nq = -dp / l;
    const N = [P[0] * np + Q[0] * nq, P[1] * np + Q[1] * nq, P[2] * np + Q[2] * nq], va = per[i] / tot, vb = (per[i] + l) / tot;
    poly(buf, [W(s0, a[0], a[1]), W(s1, a[0], a[1]), W(s1, b[0], b[1]), W(s0, b[0], b[1])], N, [[sw(s0), va], [sw(s1), va], [sw(s1), vb], [sw(s0), vb]]);
  }
  const tris = triangulate(sec), sz = Math.max(...sec.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1])))) * 2 || 1;
  for (const [s, sg] of [[s0, -1], [s1, 1]]) for (const [i0, i1, i2] of tris) {
    const T3 = [sec[i0], sec[i1], sec[i2]];
    poly(buf, T3.map(p => W(s, p[0], p[1])), [A[0] * sg, A[1] * sg, A[2] * sg], T3.map(p => [0.5 + p[0] / sz, 0.5 + p[1] / sz]));
  }
}
function beams(plan, opts) {
  const t0 = now(); opts = opts || {};
  const Fl = floorOf(plan, opts), L = Fl.L, bufs = chunkBufs(), CL = CH * L, out = [];
  // a doorway's leaves reach up to ~0.08 m past its tile along the passage (hinged past the architraves, 2.55 m tall): a low beam
  // (bottom under 2.56 m) that ends at that tile edge, over the doorway's width, stops BEAM_CUT short of it
  const BEAM_CUT = 0.1, ends = [];
  for (const d of plan.doorways || []) if (d.leaves && d.leaves.length) {
    const ax = d.axis === 'x', e0 = (ax ? d.x : d.y) * L, c0 = (ax ? d.y : d.x) * L;
    ends.push({ ax, near: e0, far: e0 + L, c0, c1: c0 + L });
  }
  const trimEnds = (ax, a0, a1, c, y0) => {
    if (y0 >= 2.56) return [a0, a1];
    for (const q of ends) if (q.ax === ax && c > q.c0 - 1e-6 && c < q.c1 + 1e-6) {
      if (Math.abs(a1 - q.near) < 0.02) a1 = q.near - BEAM_CUT;
      if (Math.abs(a0 - q.far) < 0.02) a0 = q.far + BEAM_CUT;
    }
    return [a0, a1];
  };
  for (const b of plan.beams || []) {
    const H = b.y1 - b.y0; if (!(H > 0)) continue;
    if (b.kind === 'post' || (Math.abs(b.x1 - b.x0) < 1e-6 && Math.abs(b.z1 - b.z0) < 1e-6)) {
      const w = b.w, sec = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
      extrude(bufs.get(Fl.chunkOf(Math.floor(b.x0 / L), Math.floor(b.z0 / L)), 'b'), sec, [b.x0, b.y0, b.z0], [0, 1, 0], [1, 0, 0], [0, 0, -1], 0, H, L);
      out.push({ kind: 'post', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y0: b.y0, y1: b.y1, w: b.w });
      continue;
    }
    const ax = Math.abs(b.x1 - b.x0) >= Math.abs(b.z1 - b.z0), c = ax ? b.z0 : b.x0;
    const [a0, a1] = trimEnds(ax, ax ? Math.min(b.x0, b.x1) : Math.min(b.z0, b.z1), ax ? Math.max(b.x0, b.x1) : Math.max(b.z0, b.z1), c, b.y0);
    if (!(a1 - a0 > 0.05)) continue;
    const A = ax ? [1, 0, 0] : [0, 0, 1], P = ax ? [0, 0, -1] : [1, 0, 0], w = b.w, tf = 0.022, tw = 0.012;
    const sec = b.kind === 'ibeam' ? [[-w / 2, 0], [w / 2, 0], [w / 2, tf], [tw / 2, tf], [tw / 2, H - tf], [w / 2, H - tf], [w / 2, H], [-w / 2, H], [-w / 2, H - tf], [-tw / 2, H - tf], [-tw / 2, tf], [-w / 2, tf]]
      : [[-w / 2, 0], [w / 2, 0], [w / 2, H], [-w / 2, H]];
    // split at chunk lines, so each piece's bounds stay in its chunk
    const cuts = [a0]; for (let k = Math.floor(a0 / CL) + 1; k * CL < a1 - 1e-6; k++) cuts.push(k * CL); cuts.push(a1);
    const mk = b.kind === 'ibeam' ? 'i' : 'b';
    for (let j = 0; j < cuts.length - 1; j++) {
      const s0 = cuts[j], s1 = cuts[j + 1], mid = (s0 + s1) / 2, O = ax ? [0, b.y0, c] : [c, b.y0, 0];
      extrude(bufs.get(ax ? Fl.chunkOf(Math.floor(mid / L), Math.floor(c / L)) : Fl.chunkOf(Math.floor(c / L), Math.floor(mid / L)), mk), sec, O, A, P, [0, 1, 0], s0, s1, L);
      out.push({ kind: b.kind, x0: ax ? s0 : c, z0: ax ? c : s0, x1: ax ? s1 : c, z1: ax ? c : s1, y0: b.y0, y1: b.y1, w });
    }
  }
  const group = new THREE.Group(); group.name = 'arch_beams';
  const mb = matOf(opts, 'beam') || grey(), mi = matOf(opts, 'ibeam', 'beam') || mb, meshes = [];
  for (const b of bufs.all()) { const m = meshOf(b, b.k === 'i' ? mi : mb, 'arch_beam_' + b.k + '_' + b.c, 'beams', b.c, { cast: opts.castShadow !== false }); if (m) { group.add(m); meshes.push(m); } }
  return finish({ pieces: out, meshes }, group, t0);
}

/* ---------- the kit ---------- */
// a node of the kit by name: the kit may be a loaded scene, a gltf result, {scene}/{scenes}, an object with node(name) or get(name),
// a {name: Object3D} map, or an array of any of these (the style's file and common.glb)
const NODE_CACHE = new WeakMap();
function kitNode(kit, name) {
  if (!kit || !name) return null;
  if (typeof kit === 'object') { const c = NODE_CACHE.get(kit); if (c && c.has(name)) return c.get(name); }
  let r = null;
  if (Array.isArray(kit)) { for (const k of kit) if ((r = kitNode(k, name))) break; }
  else if (kit.isObject3D) r = kit.name === name ? kit : kit.getObjectByName(name) || null;
  else {
    if (!r && typeof kit.node === 'function') { const o = kit.node(name); if (o && o.isObject3D) r = o; }
    if (!r && typeof kit.get === 'function') { try { const o = kit.get(name); if (o && o.isObject3D) r = o; } catch (e) { /* not a getter of nodes */ } }
    if (!r && kit.nodes && kit.nodes[name] && kit.nodes[name].isObject3D) r = kit.nodes[name];
    if (!r && kit[name] && kit[name].isObject3D) r = kit[name];
    if (!r) for (const k of [kit.scene, kit.style, kit.common].concat(kit.scenes || [])) if (k && (r = kitNode(k, name))) break;
  }
  if (typeof kit === 'object') { let c = NODE_CACHE.get(kit); if (!c) NODE_CACHE.set(kit, (c = new Map())); c.set(name, r); }
  return r;
}
// a node's meshes with their transforms relative to the node's own origin (its placement in the kit file left out)
function partsOf(node) {
  node.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), parts = [];
  node.traverse(o => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, rel: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), name: o.name }); });
  return parts;
}
function partsBox(parts) {
  const b = new THREE.Box3(), tmp = new THREE.Box3();
  for (const p of parts) { if (!p.geometry.boundingBox) p.geometry.computeBoundingBox(); tmp.copy(p.geometry.boundingBox).applyMatrix4(p.rel); b.union(tmp); }
  return b;
}
function boxGeo(x0, y0, z0, x1, y1, z1) { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; }
// boxes merged into a buffer, in a frame given by a matrix
function addBox(buf, m4, x0, y0, z0, x1, y1, z1, uvs) {
  const g = boxGeo(x0, y0, z0, x1, y1, z1), p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m4), base = buf.count;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m4); const x = v.x, y = v.y, z = v.z; v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
    const uv = uvs ? uvs(x, y, z, v) : [u.getX(i), u.getY(i)]; buf.v(x, y, z, v.x, v.y, v.z, uv[0], uv[1], uv[2], uv[3]); }
  for (let i = 0; i < g.index.count; i++) buf.ix.push(base + g.index.getX(i));
  g.dispose();
}

/* ---------- doorways (A9.3) ---------- */
const DOORS = { list: [], res: null, time: 0, herQuiet: null };
function doorways(plan, kit, opts) {
  const t0 = now(); opts = opts || {};
  const Fl = floorOf(plan, opts), L = Fl.L, at = cellsOf(Fl, opts), cells = at.cells, group = new THREE.Group(); group.name = 'arch_doorways';
  const ds = plan.doorways || [], style = plan.style;
  const frameN = kitNode(kit, 'Door_frame_' + style), leafN = kitNode(kit, 'Door_leaf_' + style), procedural = !frameN || !leafN;
  const frameParts = frameN ? partsOf(frameN) : null;
  let leafParts = leafN ? partsOf(leafN) : null, ownLeaf = null;
  if (!leafParts) { ownLeaf = boxGeo(0, 0, -LEAF.D / 2, LEAF.W, LEAF.H, LEAF.D / 2); leafParts = [{ geometry: ownLeaf, material: matOf(opts, 'leaf', 'frame', 'trim') || grey(), rel: new THREE.Matrix4(), own: true }]; }
  // (a half-glazed leaf's panes come in the opaque 'Glass' stand-in, which read as flat white panels: the floor's glass instead, B1)
  const gM = (opts.materials || {}).glass;
  if (gM) for (const pt of leafParts) if (pt.material && /^Glass/.test(pt.material.name || '')) pt.material = gM;
  const lb = partsBox(leafParts), thick = Math.max(0.005, lb.max.z - lb.min.z), zc = (lb.max.z + lb.min.z) / 2;
  // the frame's real extent: the header starts on top of its head (no soffit coplanar with the head's at 2.60 m), the leaves hinge
  // just past its architraves (no leaf end buried in them)
  const fb0 = frameParts ? partsBox(frameParts) : null;
  const headTop = fb0 ? clamp(fb0.max.y, HEAD_Y0, HEAD_Y0 + 0.08) : HEAD_Y0 + 0.06;
  const hingeD = fb0 ? Math.max(LINING / 2, fb0.max.z, -fb0.min.z) : LINING / 2 + 0.02;
  const M = () => new THREE.Matrix4(), V3 = (x, y, z) => new THREE.Vector3(x, y, z), Y = V3(0, 1, 0), Q = new THREE.Quaternion();
  const doorM = d => M().compose(V3(d.cx, 0, d.cz), Q.clone().setFromAxisAngle(Y, d.ry), V3(1, 1, 1));
  const frameBuf = chunkBufs(), headBuf = chunkBufs(), frames = new Map(), leaves = new Map();
  const doors = [];
  for (const d of ds) {
    const ch = Fl.chunkOf(d.x, d.y), Md = doorM(d), H = Fl.C[d.y * Fl.GW + d.x];
    // the header: wall from 2.60 m up to the ceiling, the lining's depth less the architraves, lit like the middle of a side wall
    if (!d.head.skip && H - headTop >= 0.08) {
      const fi = d.axis === 'z' ? (Fl.faceOf(d.x, d.y, 1, 0) >= 0 ? Fl.faceOf(d.x, d.y, 1, 0) : Fl.faceOf(d.x, d.y, -1, 0)) : (Fl.faceOf(d.x, d.y, 0, 1) >= 0 ? Fl.faceOf(d.x, d.y, 0, 1) : Fl.faceOf(d.x, d.y, 0, -1));
      const c = fi >= 0 ? cells[fi] : null;
      addBox(headBuf.get(ch, 'h'), Md, -L / 2, headTop, -HEAD_D / 2, L / 2, H, HEAD_D / 2, (x, y, z, n) => {
        const u = Math.abs(n.y) > 0.5 ? 0.5 : clamp(((d.axis === 'z' ? x : z) - (d.axis === 'z' ? d.cx : d.cz)) / L + 0.5, 0, 1);
        return [0.5 * u, y / FACE_H, c ? c.u0 + 0.5 * c.su : 0, c ? c.v0 + clamp(y, 0, c.H || H) * c.sv : 0]; });
    }
    if (procedural) {                      // (no kit: posts, a head bar and architraves, as house.js draws a doorway, in the frame's sizes)
      const fb = frameBuf.get(ch, 'f'), a = L / 2;
      for (const s of [-1, 1]) {
        addBox(fb, Md, s < 0 ? -a : a - POST, 0, -LINING / 2, s < 0 ? -a + POST : a, HEAD_Y0 + 0.06, LINING / 2);
        for (const z of [-1, 1]) addBox(fb, Md, s < 0 ? -a + POST : a - POST - 0.07, 0, z < 0 ? -LINING / 2 - 0.02 : LINING / 2, s < 0 ? -a + POST + 0.07 : a - POST, HEAD_Y0 + 0.07, z < 0 ? -LINING / 2 : LINING / 2 + 0.02);
      }
      addBox(fb, Md, -a + POST, HEAD_Y0, -LINING / 2, a - POST, HEAD_Y0 + 0.06, LINING / 2);
      for (const z of [-1, 1]) addBox(fb, Md, -a + POST, HEAD_Y0, z < 0 ? -LINING / 2 - 0.02 : LINING / 2, a - POST, HEAD_Y0 + 0.07, z < 0 ? -LINING / 2 : LINING / 2 + 0.02);
    } else { if (!frames.has(ch)) frames.set(ch, []); frames.get(ch).push(Md); }
    // the leaves: hinged at the posts' inner faces (0.11 m from the side walls: the plan's hinge, whose side is the sign along the
    // world's across axis), just past the frame's architraves on the swing side, the leaf's thickness toward its wall: its far edge
    // is then 0.11 + cos(angle) m from that wall, inside the band players never reach (H11). The side +1 leaf is the kit leaf
    // mirrored (B1): its instances live in a mesh whose own matrix is a mirror, so three.js flips the winding for it.
    const door = { d, x: d.x, y: d.y, cx: d.cx, cz: d.cz, leaves: [], open: false, away: 0, hold: 6 + 4 * hash(d.x, d.y, 1301), near: false };
    const sp = d.axis === 'z' ? [0, d.swing] : [d.swing, 0], ac = d.axis === 'z' ? [1, 0] : [0, 1];
    for (const lf of d.leaves) {
      const s = lf.side, c = [-s * ac[0], -s * ac[1]];                  // (closed: from the hinge toward the opening's middle)
      const sig = Math.sign(c[0] * sp[1] - c[1] * sp[0]) || 1;     // (c x up = (-cz, 0, cx) = sig * sp)
      const hw = [lf.hinge[0] + sp[0] * hingeD, lf.hinge[1] + sp[1] * hingeD], mir = s > 0;
      // (tail: the leaf's thickness centred, mirrored through its own plane for side +1, then moved toward its wall)
      const tail = mir ? M().makeTranslation(0, 0, sig * thick / 2).multiply(M().makeScale(1, 1, -1)).multiply(M().makeTranslation(0, 0, -zc)) : M().makeTranslation(0, 0, sig * thick / 2 - zc);
      const leaf = { side: s, rest: lf.rest, pin: !!lf.pin, angle: lf.rest, from: lf.rest, to: lf.rest, t: 1, dur: 1, sway: 0, door, c, sp, sig, hw, mir, tail,
        w: 2 * PI / (4.5 + 3.5 * hash(d.x, d.y, 1302 + (s > 0 ? 1 : 0))), ph: 2 * PI * hash(d.x, d.y, 1304 + (s > 0 ? 1 : 0)), ch, k: -1, mat: M() };
      const lk = ch + ':' + (mir ? 1 : 0);
      if (!leaves.has(lk)) leaves.set(lk, []);
      leaf.k = leaves.get(lk).length; leaves.get(lk).push(leaf); door.leaves.push(leaf);
    }
    doors.push(door);
  }
  // instanced per chunk on the kit's geometry and materials (H21: shared, kit), or the procedural pieces merged per chunk
  const tag = (m, shared) => { m.userData.arch = m.userData.arch || 'doorways'; if (shared) { m.userData.shared = true; m.userData.kit = true; } return m; };
  const IM = THREE.InstancedMesh;
  for (const [ch, list] of frames) for (const p of frameParts) {
    const im = new IM(p.geometry, p.material, list.length), m = M();
    list.forEach((Md, i) => im.setMatrixAt(i, m.multiplyMatrices(Md, p.rel)));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = opts.castShadow !== false; im.receiveShadow = true;
    im.name = 'arch_frame_' + ch; im.userData.chunk = ch; im.userData.arch = 'door_frame'; group.add(tag(im, true));
  }
  const leafMeshes = new Map();
  for (const [lk, list] of leaves) {
    const ch = list[0].ch, mir = list[0].mir;
    const ims = leafParts.map(p => { const im = new IM(p.geometry, p.material, list.length); im.name = 'arch_leaf_' + lk; im.userData.chunk = ch; im.userData.arch = 'door_leaf';
      if (mir) { im.scale.set(-1, 1, 1); im.updateMatrix(); im.userData.mirror = true; }     // (instance = mirror x the leaf's matrix: world = the mirrored leaf)
      im.castShadow = opts.castShadow !== false; im.receiveShadow = true; im.userData.rel = p.rel; im.instanceMatrix.setUsage && im.instanceMatrix.setUsage(35048); group.add(tag(im, !p.own)); return im; });
    leafMeshes.set(lk, ims);
    for (const lf of list) { lf.ims = ims; place(lf); }
    // bounds that hold every angle a leaf takes (the sphere at rest, grown by a leaf's reach)
    for (const im of ims) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); if (im.boundingSphere) im.boundingSphere.radius += 1.2; }
  }
  for (const b of frameBuf.all()) { const m = meshOf(b, matOf(opts, 'frame', 'trim') || grey(), 'arch_frame_' + b.c, 'door_frame', b.c, { cast: opts.castShadow !== false }); if (m) group.add(m); }
  for (const b of headBuf.all()) { const m = meshOf(b, matOf(opts, 'header', 'wall') || grey(), 'arch_header_' + b.c, 'door_header', b.c, { cast: opts.castShadow !== false }); if (m) group.add(m); }
  const res = finish({ doors, procedural, leafSize: { w: lb.max.x - lb.min.x, h: lb.max.y - lb.min.y, d: thick }, headTop, hingeD }, group, t0);
  DOORS.list = doors; DOORS.res = res; DOORS.herQuiet = opts.herQuiet || null;
  return res;
}
// a leaf's matrix at its angle (degrees from closed): x along the leaf (closed direction turned toward the swing), y up, z = x cross y
function leafMatrix(lf, out) {
  const a = lf.angle * DEG, ca = Math.cos(a), sa = Math.sin(a), dx = ca * lf.c[0] + sa * lf.sp[0], dz = ca * lf.c[1] + sa * lf.sp[1];
  // (columns x = (dx, 0, dz), y = up, z = x cross y = (-dz, 0, dx): a proper rotation)
  out.set(dx, 0, -dz, lf.hw[0], 0, 1, 0, 0, dz, 0, dx, lf.hw[1], 0, 0, 0, 1);
  return out.multiply(lf.tail);
}
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1), TMP4 = new THREE.Matrix4();
function place(lf) {
  leafMatrix(lf, lf.mat);
  for (const im of lf.ims) { TMP4.multiplyMatrices(lf.mat, im.userData.rel); if (lf.mir) TMP4.premultiply(MIRROR); im.setMatrixAt(lf.k, TMP4); im.instanceMatrix.needsUpdate = true; }
}
function creak(sfx, door, vol, soft) {
  if (!sfx) return;
  const hq = DOORS.herQuiet || (typeof herQuiet === 'function' ? herQuiet : null);
  if (hq && hq() > 0.5) return;
  if (typeof sfx === 'function') sfx('creak', { x: door.cx, y: 1.4, z: door.cz }, vol, !!soft);
  else if (sfx.creak) sfx.creak(vol, { x: door.cx / 0.045, y: door.cz / 0.045, h: 1.4 });
}
// the game's own sound (js/audio.js's global sfx), read here where no parameter hides it
function gameSfx() { try { return typeof sfx !== 'undefined' ? sfx : null; } catch (e) { return null; } }
// snd: undefined = the game's sfx; null = silent; else the sfx object or a function (see the header)
function updateDoors(dt, actors, snd) {
  const sfx = snd === undefined ? gameSfx() : snd;
  dt = Math.min(Math.max(+dt || 0, 0), 0.25); DOORS.time += dt;
  const T = DOORS.time, acts = actors || [], R2 = NEAR * NEAR;
  for (const door of DOORS.list) {
    if (!door.leaves.length) continue;
    const near = acts.some(a => a && (a.x - door.cx) * (a.x - door.cx) + (a.z - door.cz) * (a.z - door.cz) < R2);
    if (near) { door.away = 0; if (!door.open) { door.open = true; for (const lf of door.leaves) if (!lf.pin) { lf.from = lf.angle; lf.to = OPEN_DEG; lf.t = 0; lf.dur = OPEN_T; } creak(sfx, door, 0.5, false); } }
    else if (door.open) { door.away += dt;
      if (door.away >= door.hold) { door.open = false; for (const lf of door.leaves) if (!lf.pin) { lf.from = lf.angle; lf.to = lf.rest; lf.t = 0; lf.dur = BACK_T; lf.sway = 0; } creak(sfx, door, 0.22, true); } }
    for (const lf of door.leaves) {
      if (lf.pin) continue;
      let a;
      if (lf.t < 1) { lf.t = Math.min(1, lf.t + dt / lf.dur); a = lf.from + (lf.to - lf.from) * smooth(lf.t); }
      else if (!door.open) { lf.sway = Math.min(1, lf.sway + dt / 2); a = lf.rest + SWAY * lf.sway * Math.sin(T * lf.w + lf.ph); }   // (the draught, eased in)
      else a = OPEN_DEG;
      a = clamp(a, Math.min(lf.rest, 72) - SWAY, 90);
      if (Math.abs(a - lf.angle) > 1e-4) { lf.angle = a; place(lf); }
    }
  }
}

/* ---------- modules (B1, B5) ---------- */
function modules(plan, kit, opts) {
  const t0 = now(); opts = opts || {};
  const Fl = floorOf(plan, opts), L = Fl.L, group = new THREE.Group(); group.name = 'arch_modules';
  const placed = [], missing = [];
  // windows only when asked (opts.windows: true): Kit.furnish places plan.windows with the level's sky and glass by default
  const items = (opts.windows !== true ? [] : plan.windows.map((w, i) => ({ kind: 'window', node: w.node, face: w.face, x: w.x, y: w.y, pos: w.pos, ry: w.ry, window: i })))
    .concat(plan.modules.filter(m => m.kind !== 'exit' || opts.exit));
  let at = null;
  const wallMat = matOf(opts, 'wall'), M = opts.materials || {};
  // the other reserved materials (B1) swapped like Kit.furnish does, when the integrator gives them
  const roleMat = q => { const n = (q && q.name) || ''; return /^SkyPlane/.test(n) ? M.sky : /^Glass/.test(n) ? M.glass : /^Emit/.test(n) ? M.emit : null; };
  for (const it of items) {
    const src = kitNode(kit, it.node); if (!src) { missing.push(it.node); continue; }
    const o = src.clone(true); o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
    const holder = new THREE.Group(); holder.name = 'arch_mod_' + it.kind; holder.add(o);
    let px = it.pos[0], py = it.pos[1], pz = it.pos[2];
    if (it.kind === 'peel' || (it.face >= 0 && it.kind !== 'window')) py = 0;          // (wall pieces: their origin is on the floor, B1)
    if (it.kind === 'window') py = 0;
    holder.position.set(px, py, pz);
    if (it.kind === 'skylight' && it.normal) {                                          // (up the shaft = against the ceiling's normal)
      const up = new THREE.Vector3(-it.normal[0], -it.normal[1], -it.normal[2]).normalize();
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      if (it.slope && it.rise) { const c = Math.cos(it.slope); if (Math.abs(it.rise[0]) > 0.5) o.scale.x = 1 / c; else o.scale.z = 1 / c; }   // (covers its tile's sloped hole)
    } else holder.rotation.y = it.ry || 0;
    // parts in the reserved WallSurface material: the wall material, the face's wallpaper (variant trick) and its atlas cell
    const f = it.face >= 0 ? plan.faces[it.face] : null;
    o.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    o.traverse(m => {
      if (!m.isMesh) return;
      const mats = [].concat(m.material), wall = mats.some(q => q && q.name === 'WallSurface');
      if (!wall || !f) { m.userData.shared = true; m.userData.kit = true;      // (the kit's geometry; materials swapped by role keep it shared)
        if (mats.some(roleMat)) m.material = Array.isArray(m.material) ? m.material.map(q => roleMat(q) || q) : roleMat(m.material);
        return; }
      if (!at) at = cellsOf(Fl, opts);
      const c = at.cells[it.face], g = m.geometry.clone(), rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), nm = new THREE.Matrix3().getNormalMatrix(rel);
      const P = g.attributes.position, N = g.attributes.normal, n = P.count, uv = new Float32Array(n * 2), uv1 = new Float32Array(n * 2), v = new THREE.Vector3(), w = new THREE.Vector3();
      const mirror = u => { const r = ((u % 2) + 2) % 2; return r > 1 ? 2 - r : r; }, H = c.H || f.h;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(rel); if (N) w.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); else w.set(0, 0, 1);
        let u = 0.5 + v.x / L, vv = v.y / FACE_H;
        if (Math.abs(w.x) > 0.7) u = 0.5 + (v.x - Math.sign(w.x) * v.z) / L;             // (a recess's sides unwrap into its depth)
        else if (Math.abs(w.y) > 0.7) vv = (v.y + Math.sign(w.y) * v.z) / FACE_H;
        uv[i * 2] = 0.5 * mirror(u) + 0.5 * (f.variant ? 1 : 0); uv[i * 2 + 1] = vv;
        uv1[i * 2] = c.u0 + clamp(0.5 + v.x / L, 0, 1) * c.su; uv1[i * 2 + 1] = c.v0 + clamp(v.y, 0, H) * c.sv;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
      // (this geometry is ours, made for this floor: no longer the kit's, so dispose() and level.js's disposeLevel free it. The kit's
      // own materials left on it are marked shared (material.userData.shared) for a disposeLevel that honours that)
      m.geometry = g; m.userData.arch = 'wallsurface'; m.userData.shared = false; m.userData.kit = false; m.userData.sharedGeo = false; m.userData.ownGeo = true;
      if (wallMat) m.material = Array.isArray(m.material) ? m.material.map(q => q && q.name === 'WallSurface' ? wallMat : (roleMat(q) || q)) : wallMat;
      for (const q of [].concat(m.material)) if (q && q !== wallMat && !Object.values(M).includes(q)) q.userData.shared = true;
    });
    holder.traverse(m => { if (m.isMesh) { m.castShadow = opts.castShadow !== false && it.face >= 0; m.receiveShadow = true; } });
    holder.userData.chunk = Fl.chunkOf(it.x, it.y); holder.userData.arch = 'module';
    group.add(holder); placed.push({ kind: it.kind, node: it.node, face: it.face, x: it.x, y: it.y, obj: holder });
  }
  return finish({ placed, missing }, group, t0);
}

/* ---------- everything at once ---------- */
// all six builders into one group, with the same opts (opts.kit = kit for the skip rules). rebuild(prev, ...) disposes prev first:
// call it when the kit arrives after the floor was built (Kit.upgradeInPlace), since which faces a module replaces changes with it
function build(plan, kit, opts) {
  const t0 = now(), o = Object.assign({}, opts || {}, { kit: kit || null }), group = new THREE.Group(); group.name = 'arch';
  const parts = { walls: walls(plan, o), ceilings: ceilings(plan, o), trims: trims(plan, o), beams: beams(plan, o), doorways: doorways(plan, kit || null, o) };
  if (kit) parts.modules = modules(plan, kit, o);
  const res = Object.assign({ parts }, parts);
  for (const k in parts) group.add(parts[k].group);
  const st = { tris: 0, verts: 0, draws: 0 }; for (const k in parts) for (const q in st) st[q] += parts[k].stats[q];
  res.group = group; res.stats = Object.assign(st, { ms: +(now() - t0).toFixed(2) });
  res.dispose = () => { for (const k in parts) parts[k].dispose(); if (group.parent) group.parent.remove(group); };
  return res;
}
function rebuild(prev, plan, kit, opts) { if (prev && prev.dispose) prev.dispose(); return build(plan, kit, opts); }

window.Arch = { walls, ceilings, trims, beams, doorways, modules, updateDoors, build, rebuild, loadProfiles, profiles, dispose,
  kitNode, FR, FACE_H };
})();
