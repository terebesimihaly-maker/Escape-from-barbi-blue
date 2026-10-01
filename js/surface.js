/* Escape from Barbi Blue: the surface detail of a floor (build spec D1-D6, C4, C5, H14, H15): what a floor looks like close up
   under the flashlight. Corner shade and contact shadows under the furniture, dust that gathers along the walls and in the halls,
   the paths worn clean between the places everyone walks, wet patches, stains, prints, and the decals on the walls and ceilings.
   Painted once per floor into plan-space maps that js/matlib.js's floor and ceiling programs read, plus one merged decal mesh per
   6 x 6 tiles and the dust prints that you, your teammates and she leave in thick dust.
   Pure: every byte comes from the floor's data (its grid, boxes, the plan of js/dress.js) and vh, the tile hash mixed with the
   floor's seed (spec A14). No Math.random; the quality tier only sets the resolution (H7, H24). Every player sees the same dust.

   Surface.build(lv) -> {
     ovAlbedo   ImageData (RGB multiply, alpha 255), plan space (row 0 = grid row 0, uv = (x / W, 1 - z / H): H14), 2048 / 1024 / 512 px
                on the long side for high / medium / low: corner shade and the floor line (ao_profiles curves, built in until
                textures/light/ao_profiles.json is loaded), contact shadows under boxes, wardrobes and floor-standing band pieces (H15:
                under the flashlight a contact shadow must be in the albedo), floor decals (plan.decalSources.floor, and d.decals through
                level.js's paintDecal), rug fringe shadows, a faint tint under her bare prints
     ovSurf     ImageData, same size, data in every channel (never through a 2D canvas: alpha is a value here, H14):
                R wet (plan.wet: the basement's 18% of tiles, drains, the attic's leaks, spills; plus by sinks; 0 on every note tile),
                G dust (D2: the style's base, +0.4 within 0.3 m of walls and boxes, x the space's dust factor (1.3 in halls), slow vh
                noise; clumps where the plan puts dust, plaster and rubble), B clean (paths walked clean along the game's own bfsPath,
                cut-aware: spawn -> exit, spawn -> each puzzle, puzzle -> puzzle and plan.paths.pairs; 0.7 m wide, +-0.15 m meander,
                blurred 0.3 m; static child shoe prints beside some paths and one trail of her bare prints ending at a wardrobe),
                A wear (the polish along the same paths, wood and tile floors only)
     tileInfo   ImageData GW x GH (nearest): R 255 = albedo variant B (worn tiles along the paths, and a few by vh), G 255 = boards turned
                90 degrees (per region: rooms along their long side, passages along their way, doorway thresholds across)
     ovCeil     ImageData (RGB multiply), half the floor size: water rings over wet patches, soot over lamps, cracks, mould by cold
                outer walls (plan.decalSources.ceiling)
     detail     { data, w, h } 256 x 256 tileable stand-in for B9's detail tiles (R dust_detail, G wet_edge) until Blender's exist
     dustCol    the style's dust colour (hex)
     maps       { ovAlbedo, ovSurf, tileInfo, ovCeil, detail, dustCol }: hand to MatLib.setLevelMaps (or spread the whole result)
     cpuSurf    { w, h, ppmX, ppmY, data (ovSurf's bytes, shared), dust(x, z), wet(x, z), clean(x, z) } (m): the CPU side of ovSurf
     decals     { group (one Mesh per 6 x 6 chunk that has decals), meshes, material, quads [{face, kind, src, corners [[x, y, z] x 4],
                centre, half}], atlas {W, H, source 'procedural' | 'file'} }: merged quads 3 mm proud of their face (or of a servant
                run's inset, or a chimney breast's front), uv0 = the decal atlas rect, uv1 = the face's cell of the wall lightmap atlas,
                so a decal is lit exactly like the wall behind it (MatLib.decalMaterial). Fitted inside their faces, <= 2 a face.
     dustPrints InstancedMesh of 200 (ring buffer) at y = 0.003
     update(dt, actors)  every frame: actors [{x, z (m), id, kind ('player' | 'mate' | 'her' | 'child'...)}]; every 0.65 m of an actor's
                walk a print where cpuSurf dust > 0.4 (not on rugs). Visual only. Her wet blue prints stay render.js's.
     stats      { ms, w, h, paths, prints, wet, decals, ... };   dispose()   frees what build made (not the ImageData maps: MatLib owns
                the textures it makes of them) }
   lv: the floor (Surface.lvFromData(d, {tier}) builds it from d; Surface.lvFromGame({tier, spawns, plan}) from the live globals):
     grid | rows, solids | SOLIDS, closets, creaks, notes, decals (d.decals: the floor's painted stains, petals and words), puzzles, exit,
     spawns (d.spawns, game units), style, floorIdx, tier ('low' | 'medium' | 'high' | 'lo' | 'md' | 'hi'), plan (Dress.plan; made from
     lv when missing), and optionally: cells (LightBaker's result.wallCells, else LightBaker.packAtlas gives the same), aoProfiles,
     materials { decal } (a decal material to use instead of MatLib.decalMaterial).
   Surface.load(tier) -> Promise: fetches textures/light/ao_profiles.json and the Blender decal atlas (textures/decals/decals.json and
   decals_{albedo,normal}.<tier>.webp) once; later builds use them. Without them: built-in AO curves and a procedural decal atlas. */
(function () {
'use strict';

const UM = 0.045, TU = 50, L = TU * UM, PT = 40, CH = 6, R_NAV0 = 13, PRINTS = 200, STEP = 0.65;
const RES = [512, 1024, 2048], TIER = { low: 0, medium: 1, high: 2, lo: 0, md: 1, hi: 2 };
const FACE_U = [0, 0.14, 0.5, 0.86, 1], DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], PI = Math.PI;
const STYLE_OF = ['wood', 'tile', 'concrete', 'attic', 'workshop'];
const DUST_COL = { wood: 0x8a8378, tile: 0x86817a, concrete: 0x76726b, attic: 0x8c8272, workshop: 0x7c776b };
const WEAR = { wood: 1, tile: 1, attic: 1, workshop: 1, concrete: 0 };           // (polish shows on boards and tiles, not on a slab)
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const def = (a, b) => a !== undefined && a !== null ? a : b;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

// world3d.js's tile hash (copied, so this file stands alone) and vh, the same mixed with the floor's seed (spec A14)
function hash(x, y, k) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((k | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const vhOf = seed => (x, y, k) => hash(x, y, (Math.imul(k, 2654435761) ^ seed) | 0);
// a small seeded generator for the shapes inside one stain or crack (seeded from vh, so still pure)
const rngOf = s => { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const tierOf = t => def(TIER[String(t || 'low').toLowerCase()], 0);

/* ---------- AO curves: textures/light/ao_profiles.json when loaded, else the same built-in ones as js/lightbake.js ---------- */
const AO_DEF = { inside: [0.42, 0.11], outside: [0.06, 0.05], floor: [0.32, 0.12], ceil: [0.28, 0.14], skirting: [0.22, 0.05], boxFloor: [0.55, 0.1], boxWall: [0.45, 0.13] };
function aoCurves(src) {
  src = src && src.curves ? src.curves : src || {};
  const out = {};
  for (const k in AO_DEF) {
    const c = src[k], t = new Float32Array(64);
    if (c && c.length >= 2) for (let i = 0; i < 64; i++) { const f = i / 63 * (c.length - 1), a = Math.floor(f), b = Math.min(c.length - 1, a + 1); t[i] = c[a] + (c[b] - c[a]) * (f - a); }
    else for (let i = 0; i < 64; i++) t[i] = 1 - AO_DEF[k][0] * Math.exp(-(i / 63 * 0.6) / AO_DEF[k][1]);
    const e = t[63] > 0 ? t[63] : 1;                         // (relative to the open floor at 0.6 m, as LightBaker does)
    for (let i = 0; i < 64; i++) t[i] = clamp(t[i] / e, 0, 1);
    out[k] = t;
  }
  return out;
}
const cv = (t, d) => { if (d >= 0.6) return 1; if (d <= 0) return t[0]; const f = d / 0.6 * 63, i = f | 0; return t[i] + (t[i + 1] - t[i]) * (f - i); };

/* ---------- reading lv ---------- */
function decodeSolid(a) {
  const id = KIT.solidIds[a[0]] || null, base = id ? KIT.items[id] : null, it = base ? Object.assign({}, base, (base.var || [])[a[6]]) : { slot: 'pocket', h: 1 };
  const s = { id, kind: it.slot, x0: a[1] / 2, y0: a[2] / 2, x1: a[3] / 2, y1: a[4] / 2, rot: a[5], h: it.h, isl: null };
  if (s.kind === 'island') s.isl = [Math.floor((s.x0 + s.x1) / 2 / TU), Math.floor((s.y0 + s.y1) / 2 / TU)];
  return s;
}
function norm(lv) {
  const P = lv.plan || (typeof Dress !== 'undefined' ? Dress.plan(lv) : null);
  if (!P) throw new Error('Surface.build: lv.plan is required (or load js/dress.js)');
  const GW = P.GW, GH = P.GH, n = GW * GH, W = new Uint8Array(n), g = lv.grid || lv.rows;
  if (!g) throw new Error('Surface.build: lv.grid (or rows) is required');
  if (ArrayBuffer.isView(g) && g.length === n) for (let i = 0; i < n; i++) W[i] = g[i] ? 1 : 0;
  else for (let y = 0; y < GH; y++) { const r = g[y]; for (let x = 0; x < GW; x++) W[y * GW + x] = (typeof r === 'string' ? r.charCodeAt(x) === 49 : +r[x] === 1) ? 1 : 0; }
  const isW = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || W[y * GW + x] === 1;
  const solids = (lv.solids || lv.SOLIDS || []).map(s => Array.isArray(s) ? decodeSolid(s) : s);
  const tileOf = c => Array.isArray(c) ? [c[0], c[1]] : c.tx !== undefined ? [c.tx, c.ty] : [Math.floor(c.x / TU), Math.floor(c.y / TU)];
  const closets = (lv.closets || []).map(c => Array.isArray(c) ? [c[0], c[1], c[2], c[3]] : [Math.floor(c.x / TU), Math.floor(c.y / TU), c.ox, c.oy]);
  const notes = (lv.notes || []).map(tileOf);
  const exit = lv.exit ? tileOf(lv.exit) : null;
  const spawns = (lv.spawns && lv.spawns.length ? lv.spawns : [[TU * 1.5, TU * 1.5]]).map(s => [Math.floor(s[0] / TU), Math.floor(s[1] / TU)]);
  const puzzles = (lv.puzzles || []).map(p => ({ cell: [p.cell[0], p.cell[1]], dir: [p.dir[0], p.dir[1]] }));
  const fi = def(lv.floorIdx, def(lv.i, P.floorIdx)) | 0, style = lv.style || P.style || STYLE_OF[fi] || 'wood';
  return { P, GW, GH, n, W, isW, solids, closets, notes, exit, spawns, puzzles, decals: lv.decals || [], style, fi, tier: tierOf(lv.tier || (typeof settings !== 'undefined' && settings.quality)),
    vh: vhOf(P.seed >>> 0) };
}

/* ---------- the game's searches, on this floor's own grid (core.js bfsPath, the same order of steps, so the same paths) ---------- */
function cutsOf(E) {
  const { GW, GH, W, solids } = E;
  if (typeof cutsFrom === 'function') return cutsFrom(solids, GW, GH, W);   // (js/layout.js's own, when it's loaded)
  const R = typeof R_NAV !== 'undefined' ? R_NAV : R_NAV0, cut = new Uint8Array(GW * GH);
  for (const s of solids) {
    const tx0 = Math.max(0, Math.floor(s.x0 / TU) - 2), tx1 = Math.min(GW - 2, Math.floor(s.x1 / TU) + 1), ty0 = Math.max(0, Math.floor(s.y0 / TU) - 2), ty1 = Math.min(GH - 2, Math.floor(s.y1 / TU) + 1);
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) { const k = y * GW + x; if (W[k]) continue; const cx = x * TU + TU / 2, cy = y * TU + TU / 2;
      if (!W[k + 1] && s.x1 > cx - R && s.x0 < cx + TU + R && s.y1 > cy - R && s.y0 < cy + R) cut[k] |= 1;
      if (!W[k + GW] && s.x1 > cx - R && s.x0 < cx + R && s.y1 > cy - R && s.y0 < cy + TU + R) cut[k] |= 2; }
  }
  return cut;
}
function bfsPathOn(E, cut, sx, sy, tx, ty) {
  const { GW, GH, isW } = E, id = (x, y) => y * GW + x;
  if (sx === tx && sy === ty) return [];
  const cutAt = (x, y, dx, dy) => !!(dx === 1 ? cut[id(x, y)] & 1 : dx === -1 ? cut[id(x - 1, y)] & 1 : dy === 1 ? cut[id(x, y)] & 2 : cut[id(x, y - 1)] & 2);
  const prev = new Int32Array(GW * GH).fill(-1), q = [[sx, sy]]; prev[id(sx, sy)] = id(sx, sy);
  for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; if (x === tx && y === ty) break;
    for (const [dx, dy] of DIRS4) { const nx = x + dx, ny = y + dy;
      if (!isW(nx, ny) && prev[id(nx, ny)] < 0 && !cutAt(x, y, dx, dy)) { prev[id(nx, ny)] = id(x, y); q.push([nx, ny]); } } }
  if (isW(tx, ty) || prev[id(tx, ty)] < 0) return null;
  const path = []; let c = id(tx, ty);
  while (c !== id(sx, sy)) { path.push([c % GW, (c / GW) | 0]); c = prev[c]; }
  return path.reverse();
}

/* ---------- rasters (plan space, Uint8, w x h; pixel (i, j) is world (i + 0.5) / ppmX, (j + 0.5) / ppmY) ---------- */
function Raster(w, h, ppmX, ppmY) { return { w, h, ppmX, ppmY, a: new Uint8Array(w * h) }; }
// max-combine a capsule (segment a -> b, half width hw m) of value v (0..255), 1 px soft edge
function capsule(R, ax, az, bx, bz, hw, v) {
  const { w, h, ppmX, ppmY, a } = R, i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw) * ppmX) - 1), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + hw) * ppmX) + 1);
  const j0 = Math.max(0, Math.floor((Math.min(az, bz) - hw) * ppmY) - 1), j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + hw) * ppmY) + 1);
  const dx = bx - ax, dz = bz - az, ll = dx * dx + dz * dz || 1e-9, px = 0.5 * (ppmX + ppmY);
  for (let j = j0; j <= j1; j++) { const z = (j + 0.5) / ppmY;
    for (let i = i0; i <= i1; i++) { const x = (i + 0.5) / ppmX, t = clamp(((x - ax) * dx + (z - az) * dz) / ll, 0, 1);
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz), c = clamp((hw - d) * px + 0.5, 0, 1) * v, k = j * w + i;
      if (c > a[k]) a[k] = c; } }
}
// max-combine (or add) an ellipse at (cx, cz), half axes ra (along angle ang) and rb, value v; edge: soft rim in m (0: 1 px);
// wob: [amp, phase...] a wobbly outline (puddles)
function ellipse(R, cx, cz, ra, rb, ang, v, edge, add, wob) {
  const { w, h, ppmX, ppmY, a } = R, rr = Math.max(ra, rb) * (wob ? 1 + wob[0] * 1.9 : 1) + (edge || 0);
  const i0 = Math.max(0, Math.floor((cx - rr) * ppmX)), i1 = Math.min(w - 1, Math.ceil((cx + rr) * ppmX)), j0 = Math.max(0, Math.floor((cz - rr) * ppmY)), j1 = Math.min(h - 1, Math.ceil((cz + rr) * ppmY));
  const c = Math.cos(ang), s = Math.sin(ang), px = 0.5 * (ppmX + ppmY), soft = Math.max(edge || 0, 1 / px);
  for (let j = j0; j <= j1; j++) { const z = (j + 0.5) / ppmY - cz;
    for (let i = i0; i <= i1; i++) { const x = (i + 0.5) / ppmX - cx, lu = x * c + z * s, lv = -x * s + z * c;
      const rho = Math.hypot(lu / ra, lv / rb); let lim = 1;
      if (wob) { const th = Math.atan2(lv / rb, lu / ra); lim = 1 + wob[0] * (Math.sin(3 * th + wob[1]) * 0.55 + Math.sin(5 * th + wob[2]) * 0.3 + Math.sin(9 * th + wob[3]) * 0.15); }
      const dm = (lim - rho) * Math.min(ra, rb);           // (m inside the rim, roughly)
      const k = j * w + i, val = clamp(dm / soft + (edge ? 0 : 0.5), 0, 1) * v;
      if (val <= 0) continue;
      if (add) a[k] = Math.min(255, a[k] + val); else if (val > a[k]) a[k] = val; } }
}
// separable box blur of radius r px (twice: close to a Gaussian), in place
function blur(R, r) {
  if (r < 1) return;
  const { w, h, a } = R, tmp = new Uint8Array(Math.max(w, h)), n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < h; j++) { const o = j * w; let s = 0;
      for (let i = -r; i <= r; i++) s += a[o + clamp(i, 0, w - 1)];
      for (let i = 0; i < w; i++) { tmp[i] = (s + (n >> 1)) / n; s += a[o + Math.min(w - 1, i + r + 1)] - a[o + Math.max(0, i - r)]; }
      a.set(tmp.subarray(0, w), o); }
    for (let i = 0; i < w; i++) { let s = 0;
      for (let j = -r; j <= r; j++) s += a[clamp(j, 0, h - 1) * w + i];
      for (let j = 0; j < h; j++) { tmp[j] = (s + (n >> 1)) / n; s += a[Math.min(h - 1, j + r + 1) * w + i] - a[Math.max(0, j - r) * w + i]; }
      for (let j = 0; j < h; j++) a[j * w + i] = tmp[j]; }
  }
}
function imageOf(data, w, h) {   // ImageData in a browser ({data, w, h} elsewhere: MatLib.dataTexture takes both)
  return typeof ImageData !== 'undefined' ? new ImageData(data, w, h) : { data, w, h, width: w, height: h };
}
function canvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null;
}
// (willReadFrequently keeps the 2D canvas on the CPU rasteriser: the same pixels every time on a machine)
const ctx2d = c => c && c.getContext('2d', { willReadFrequently: true });

/* ---------- the floor's paths (D2) ---------- */
// a tile path as a polyline of centres (m) with a seeded meander of +-0.15 m across the way, its corners rounded
function polyOf(E, tiles, key) {
  const { vh } = E, pts = tiles.map(([x, y]) => [(x + 0.5) * L, (y + 0.5) * L]);
  for (let k = 0; k < pts.length; k++) {
    const a = tiles[Math.max(0, k - 1)], b = tiles[Math.min(tiles.length - 1, k + 1)], dx = b[0] - a[0], dy = b[1] - a[1], ll = Math.hypot(dx, dy) || 1;
    const m = (vh(tiles[k][0], tiles[k][1], 1210 + key) - 0.5) * 0.3;
    pts[k][0] += -dy / ll * m; pts[k][1] += dx / ll * m;
  }
  let p = pts;                                             // (Chaikin, twice: a walker cuts corners in a curve)
  for (let it = 0; it < 2 && p.length > 2; it++) { const q = [p[0]];
    for (let k = 0; k < p.length - 1; k++) { const a = p[k], b = p[k + 1]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    q.push(p[p.length - 1]); p = q; }
  return p;
}
// points every `step` m along a polyline, with the direction there: [x, z, dirX, dirZ]
function along(poly, step, start) {
  const out = []; let need = start || 0;
  for (let k = 0; k < poly.length - 1; k++) { const a = poly[k], b = poly[k + 1], ll = Math.hypot(b[0] - a[0], b[1] - a[1]); if (ll < 1e-6) continue;
    const ux = (b[0] - a[0]) / ll, uz = (b[1] - a[1]) / ll;
    while (need <= ll) { out.push([a[0] + ux * need, a[1] + uz * need, ux, uz]); need += step; }
    need -= ll; }
  return out;
}
// a shoe or bare print into a raster (and its outline on a 2D context, for the albedo tint): fw = forward unit, side -1 | +1
function footprint(R, x, z, ux, uz, bare, v, scale) {
  const s = scale || 1, ang = Math.atan2(uz, ux), at = (f, l) => [x + ux * f * s - uz * l * s, z + uz * f * s + ux * l * s];
  let p = at(bare ? 0.02 : 0.035, 0); ellipse(R, p[0], p[1], (bare ? 0.08 : 0.075) * s, (bare ? 0.042 : 0.04) * s, ang, v, 0);
  p = at(-0.075, 0); ellipse(R, p[0], p[1], 0.036 * s, 0.033 * s, ang, v, 0);
  if (bare) for (let t = 0; t < 5; t++) { p = at(0.112 - Math.abs(t - 1.2) * 0.009, (t - 2) * 0.017); ellipse(R, p[0], p[1], (t ? 0.011 : 0.016) * s, (t ? 0.011 : 0.016) * s, 0, v, 0); }
}

/* ---------- the build ---------- */
let assets = { ao: null, decals: null };                  // (Surface.load: Blender's AO curves and decal atlas, when loaded)
function build(lv) {
  const t0 = now(), TM = {}, lap = k => { TM[k] = +(now() - t0).toFixed(1); }, E = norm(lv), { P, GW, GH, n, W, isW, vh, style } = E, idx = (x, y) => y * GW + x, stats = {};
  const N = RES[E.tier], ppt = N / Math.max(GW, GH), w = Math.max(1, Math.round(GW * ppt)), h = Math.max(1, Math.round(GH * ppt));
  const ppmX = w / (GW * L), ppmY = h / (GH * L), np = w * h, ao = aoCurves(lv.aoProfiles || assets.ao);
  const noteT = new Uint8Array(n); for (const q of E.notes) if (q[0] >= 0 && q[1] >= 0 && q[0] < GW && q[1] < GH) noteT[idx(q[0], q[1])] = 1;
  const tileSpace = P.identities && P.identities.tileSpace, spaces = (P.identities && P.identities.spaces) || [];
  const fpt = (f, u, d) => [f.x0 + (f.x1 - f.x0) * u + f.nx * d, f.z0 + (f.z1 - f.z0) * u + f.nz * d];

  /* distances: to the walls (per pixel, from its tile's neighbours) and to the boxes (their footprints grown by 0.6 m), in cm */
  // the neighbours of each tile as bits (1 W, 2 E, 4 N, 8 S, 16 NW, 32 NE, 64 SW, 128 SE), and a wall distance (m) from them
  const nb = new Uint8Array(n);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) nb[idx(x, y)] = (isW(x - 1, y) ? 1 : 0) | (isW(x + 1, y) ? 2 : 0) | (isW(x, y - 1) ? 4 : 0) | (isW(x, y + 1) ? 8 : 0)
    | (isW(x - 1, y - 1) ? 16 : 0) | (isW(x + 1, y - 1) ? 32 : 0) | (isW(x - 1, y + 1) ? 64 : 0) | (isW(x + 1, y + 1) ? 128 : 0);
  const EX = [0, 0], wallD = (t, lx, lz) => {             // (EX: the distances to the nearest wall across x and across z)
    const b = nb[t], ex = Math.min(b & 1 ? lx : 9, b & 2 ? L - lx : 9), ez = Math.min(b & 4 ? lz : 9, b & 8 ? L - lz : 9); let d = ex < ez ? ex : ez;
    // (the corner of a wall tile across the diagonal: an outside corner, or a pillar)
    if (b & 16) d = Math.min(d, Math.hypot(lx, lz)); if (b & 32) d = Math.min(d, Math.hypot(L - lx, lz));
    if (b & 64) d = Math.min(d, Math.hypot(lx, L - lz)); if (b & 128) d = Math.min(d, Math.hypot(L - lx, L - lz));
    EX[0] = ex; EX[1] = ez; return d; };
  const wallAt = (x, z) => { const tx = clamp(Math.floor(x / L), 0, GW - 1), ty = clamp(Math.floor(z / L), 0, GH - 1), t = idx(tx, ty); return W[t] ? 0 : wallD(t, x - tx * L, z - ty * L); };
  const colT = new Int32Array(w), colL = new Float32Array(w);
  for (let i = 0; i < w; i++) { const x = (i + 0.5) / ppmX; colT[i] = Math.min(GW - 1, Math.floor(x / L)); colL[i] = x - colT[i] * L; }
  const dWall = new Uint8Array(np), dBox = new Uint8Array(np).fill(255), inside = new Float32Array(np).fill(1);
  for (let j = 0; j < h; j++) { const z = (j + 0.5) / ppmY, ty = Math.min(GH - 1, Math.floor(z / L)), lz = z - ty * L, row = ty * GW;
    for (let i = 0; i < w; i++) { const t = row + colT[i], k = j * w + i;
      if (W[t]) { inside[k] = ao.inside[0]; continue; }
      const d = wallD(t, colL[i], lz);
      dWall[k] = d >= 2.55 ? 255 : Math.round(d * 100);
      if (EX[0] < 0.6 && EX[1] < 0.6) inside[k] = cv(ao.inside, Math.hypot(EX[0], EX[1]));   // (an inside corner: the two walls' AO meet)
    } }
  const boxes = [];                                        // [x0, z0, x1, z1] m: what stands on the floor
  const boxAt = (x, z) => { let d = 9; for (const [x0, z0, x1, z1] of boxes) d = Math.min(d, Math.hypot(x < x0 ? x0 - x : x > x1 ? x - x1 : 0, z < z0 ? z0 - z : z > z1 ? z - z1 : 0)); return d; };
  for (const s of E.solids) boxes.push([s.x0 * UM, s.y0 * UM, s.x1 * UM, s.y1 * UM]);
  for (const c of E.closets) { const back = L / 2 - 0.31, cx = (c[0] + 0.5) * L - c[2] * back, cz = (c[1] + 0.5) * L - c[3] * back, hx = c[2] ? 0.3 : 0.575, hz = c[2] ? 0.575 : 0.3;
    boxes.push([cx - hx, cz - hz, cx + hx, cz + hz]); }
  for (const b of P.band || []) { if ((b.z0 || 0) > 0.15) continue; const f = P.faces[b.face]; if (!f) continue;
    const a = fpt(f, b.u0, 0), c = fpt(f, b.u1, b.depth); boxes.push([Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])]); }
  for (const [x0, z0, x1, z1] of boxes) {
    const i0 = Math.max(0, Math.floor((x0 - 0.6) * ppmX)), i1 = Math.min(w - 1, Math.ceil((x1 + 0.6) * ppmX)), j0 = Math.max(0, Math.floor((z0 - 0.6) * ppmY)), j1 = Math.min(h - 1, Math.ceil((z1 + 0.6) * ppmY));
    for (let j = j0; j <= j1; j++) { const z = (j + 0.5) / ppmY, dz = z < z0 ? z0 - z : z > z1 ? z - z1 : 0;
      for (let i = i0; i <= i1; i++) { const x = (i + 0.5) / ppmX, dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, d = Math.round(Math.hypot(dx, dz) * 100), k = j * w + i;
        if (d < dBox[k]) dBox[k] = d; } } }

  lap('dist');
  /* B: the paths walked clean, A: their polish; child shoe prints beside some of them, her bare prints to a wardrobe */
  const cut = cutsOf(E), routes = [], pathR = Raster(w, h, ppmX, ppmY), printR = Raster(w, h, ppmX, ppmY), herPrints = [];
  const sp = E.spawns[0], route = (a, b, val) => { if (!a || !b) return; const p = bfsPathOn(E, cut, a[0], a[1], b[0], b[1]); if (p && p.length) routes.push({ tiles: [a].concat(p), val }); };
  route(sp, E.exit, 1);
  for (const q of E.puzzles) route(sp, q.cell, 1);
  for (let k = 0; k + 1 < E.puzzles.length; k++) route(E.puzzles[k].cell, E.puzzles[k + 1].cell, 1);
  for (const pr of (P.paths && P.paths.pairs) || []) route([pr[0], pr[1]], [pr[2], pr[3]], 0.75);
  routes.forEach((r, k) => { r.poly = polyOf(E, r.tiles, k % 7); const v = Math.round(255 * r.val);
    for (let s = 0; s + 1 < r.poly.length; s++) capsule(pathR, r.poly[s][0], r.poly[s][1], r.poly[s + 1][0], r.poly[s + 1][1], 0.35, v); });
  blur(pathR, Math.max(1, Math.round(0.15 * 0.5 * (ppmX + ppmY))));
  // child shoe prints: beside three of the paths (0.5 m off the worn line, so they show in the dust), every 0.7 m
  let nPrints = 0;
  routes.map((r, k) => [vh(k, 3, 1220), k]).filter(([, k]) => routes[k].val < 1).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 3).forEach(([, k]) => {
    const side = vh(k, 4, 1221) < 0.5 ? -1 : 1;
    // (left, right, left...: 0.35 m apart, so each foot every 0.7 m; never within 0.22 m of a wall or a box)
    along(routes[k].poly, 0.35, 0.2).forEach(([x, z, ux, uz], q) => { const foot = q & 1 ? 1 : -1, off = side * 0.5 + foot * 0.09, px = x - uz * off, pz = z + ux * off;
      if (wallAt(px, pz) < 0.22 || boxAt(px, pz) < 0.22) return;     // (exact distances: the same prints at every resolution)
      if (q >= 48) return;
      footprint(printR, px, pz, ux, uz, false, 235, 0.85); nPrints++; }); });
  // her bare prints: the last six tiles of the way from the exit to one wardrobe, ending at its doors (about 13 m)
  const ht = P.paths ? P.paths.herTrail : -1, hc = E.closets[ht];
  if (hc && E.exit) { const p = bfsPathOn(E, cut, E.exit[0], E.exit[1], hc[0], hc[1]);
    if (p && p.length) { const tiles = [E.exit].concat(p).slice(-7), poly = polyOf(E, tiles, 5), end = poly[poly.length - 1];
      end[0] = (hc[0] + 0.5) * L - hc[2] * 0.35; end[1] = (hc[1] + 0.5) * L - hc[3] * 0.35;
      along(poly, 0.33, 0.1).forEach(([x, z, ux, uz], q) => { const foot = q & 1 ? 1 : -1, px = x - uz * foot * 0.1, pz = z + ux * foot * 0.1;
        footprint(printR, px, pz, ux, uz, true, 245, 1.05); herPrints.push([px, pz, ux, uz]); nPrints++; }); } }

  lap('paths');
  /* R: wet patches (the plan's, and by sinks), never on a note's tile */
  const wetR = Raster(w, h, ppmX, ppmY), wets = (P.wet || []).slice();
  for (const b of P.band || []) if (/sink|washstand|washtub/.test(b.id || b.node || '')) { const f = P.faces[b.face], q = fpt(f, b.u, b.depth + 0.35);
    wets.push({ kind: 'sink', x: q[0], z: q[1], rx: 0.45, rz: 0.32, rot: Math.atan2(f.nz, f.nx), amount: 0.5, tile: [f.x, f.y] }); }
  for (const s of E.solids) if (/wash|sink/.test(s.id || '')) { const cx = (s.x0 + s.x1) / 2 * UM, cz = (s.y0 + s.y1) / 2 * UM;
    wets.push({ kind: 'sink', x: cx + 0.2, z: cz + ((s.y1 - s.y0) / 2 * UM + 0.3), rx: 0.4, rz: 0.3, rot: 0, amount: 0.45, tile: [Math.floor(cx / L), Math.floor(cz / L)] }); }
  wets.forEach((q, k) => { const tx = q.tile ? q.tile[0] : Math.floor(q.x / L), ty = q.tile ? q.tile[1] : Math.floor(q.z / L);
    const wob = [0.16, vh(tx, ty, 1230) * 6.28, vh(tx, ty, 1231) * 6.28, vh(tx, ty, 1232) * 6.28];
    if (q.kind === 'drain') { ellipse(wetR, q.x, q.z, q.rx, q.rz, 0, Math.round(255 * q.amount), 0.12, false, wob); return; }
    ellipse(wetR, q.x, q.z, q.rx, q.rz, q.rot || 0, Math.round(255 * q.amount), 0.12, false, wob);
    if (q.kind === 'leak') ellipse(wetR, q.x, q.z, q.rx * 0.45, q.rz * 0.45, q.rot, Math.round(255 * Math.min(1, q.amount + 0.25)), 0.08);   // (wettest under the drip)
  });
  for (let j = 0; j < h; j++) { const ty = Math.min(GH - 1, Math.floor((j + 0.5) / ppmY / L)); for (let i = 0; i < w; i++) {
    const tx = Math.min(GW - 1, Math.floor((i + 0.5) / ppmX / L)); if (noteT[idx(tx, ty)]) wetR.a[j * w + i] = 0; } }

  lap('wet');
  /* G: dust; clumps where the plan drops dust, plaster or rubble */
  const D = P.dust || { base: 0.45, nearWall: 0.4, nearDist: 0.3, noiseKey: 1101 }, clumps = Raster(w, h, ppmX, ppmY);
  for (const q of (P.decalSources && P.decalSources.floor) || []) if (q.kind === 'dust' || q.kind === 'plaster' || q.kind === 'rubble') {
    const tx = Math.floor(q.x / L), ty = Math.floor(q.z / L);
    ellipse(clumps, q.x, q.z, q.size / 2, q.size / 2 * 0.7, q.rot, q.kind === 'dust' ? 110 : 80, q.size * 0.25, true, [0.2, vh(tx, ty, 1240) * 6.28, vh(tx, ty, 1241) * 6.28, 1]); }
  const NC = 1.6, nx = Math.ceil(GW * L / NC) + 2, nz = Math.ceil(GH * L / NC) + 2, lat = new Float32Array(nx * nz);
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) lat[b * nx + a] = vh(a, b, D.noiseKey || 1101);
  const spMul = new Float32Array(n).fill(1);
  if (tileSpace) for (let t = 0; t < n; t++) { const s = spaces[tileSpace[t]]; if (s && s.dustMul) spMul[t] = s.dustMul; }
  const surf = new Uint8ClampedArray(np * 4), wear = WEAR[style] ? 0.85 : 0, nd = D.nearDist || 0.3, nw = D.nearWall || 0.4;
  const nearLut = new Float32Array(256), cAx = new Int32Array(w), cSx = new Float32Array(w);   // (per cm of distance; per column of the noise)
  for (let c = 0; c < 256; c++) nearLut[c] = smooth(1 - c / 100 / nd);
  for (let i = 0; i < w; i++) { const fx = (i + 0.5) / ppmX / NC; cAx[i] = Math.floor(fx); cSx[i] = smooth(fx - cAx[i]); }
  for (let j = 0; j < h; j++) { const z = (j + 0.5) / ppmY, row = Math.min(GH - 1, Math.floor(z / L)) * GW, fz = z / NC, bz = Math.floor(fz), sz = smooth(fz - bz), r0 = bz * nx, r1 = r0 + nx;
    for (let i = 0; i < w; i++) { const k = j * w + i, ax = cAx[i], sx = cSx[i];
      const n0 = lat[r0 + ax] + (lat[r0 + ax + 1] - lat[r0 + ax]) * sx, n1 = lat[r1 + ax] + (lat[r1 + ax + 1] - lat[r1 + ax]) * sx;
      const noise = n0 + (n1 - n0) * sz, dw = dWall[k], db = dBox[k], wet = wetR.a[k];
      const dust = ((D.base + nw * nearLut[dw < db ? dw : db]) * spMul[row + colT[i]] * (0.7 + 0.6 * noise) + clumps.a[k] / 255) * (1 - 0.7 / 255 * wet);
      const o = k * 4, pth = pathR.a[k], pr = printR.a[k];
      surf[o] = wet; surf[o + 1] = dust * 255 + 0.5; surf[o + 2] = pth > pr ? pth : pr; surf[o + 3] = pth * wear + 0.5;
    } }

  lap('surf');
  /* tileInfo: albedo variant B where the paths wear the floor (and a few by vh), boards turned per region */
  const tinfo = new Uint8ClampedArray(n * 4), straight = (x, y) => { const ns = isW(x - 1, y) && isW(x + 1, y), ew = isW(x, y - 1) && isW(x, y + 1); return ns === ew ? null : ns ? 'z' : 'x'; };
  const doorAx = new Map((P.doorways || []).map(d => [d.y * GW + d.x, d.axis])), spaceRot = new Map();
  for (const s of spaces) {                               // a room's boards along its long side; a passage's along its way (majority)
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sx = 0, sz = 0;
    if (tileSpace) for (let t = 0; t < n; t++) if (tileSpace[t] === s.id && !doorAx.has(t)) { const x = t % GW, y = (t / GW) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); const st = straight(x, y); if (st === 'x') sx++; else if (st === 'z') sz++; }
    const passage = s.type === 'corridor' || s.type === 'service';
    spaceRot.set(s.id, { passage, rot: passage ? (sz > sx ? 255 : 0) : (y1 - y0 > x1 - x0 ? 255 : 0) });
  }
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const t = idx(x, y), o = t * 4; tinfo[o + 3] = 255; if (W[t]) continue;
    let sum = 0, cnt = 0;                                  // (how worn: the path value over the tile's middle)
    for (let j = Math.floor((y + 0.25) * L * ppmY); j < Math.ceil((y + 0.75) * L * ppmY) && j < h; j++) for (let i = Math.floor((x + 0.25) * L * ppmX); i < Math.ceil((x + 0.75) * L * ppmX) && i < w; i++) { sum += pathR.a[j * w + i]; cnt++; }
    tinfo[o] = (cnt && sum / cnt > 110) || vh(x, y, 1301) < 0.1 ? 255 : 0;
    const ax = doorAx.get(t), sr = tileSpace ? spaceRot.get(tileSpace[t]) : null, st = straight(x, y);
    tinfo[o + 1] = ax ? (ax === 'x' ? 255 : 0) : sr && sr.passage && st ? (st === 'z' ? 255 : 0) : sr ? sr.rot : (st === 'z' ? 255 : 0);   // (a threshold lies across its doorway)
  }

  lap('tile');
  /* ovAlbedo: shade (floor line, inside corners, box contact) x what the 2D canvas paints (decals, rug fringes, her prints' tint) */
  const alb = new Uint8ClampedArray(np * 4), cvs = canvas(w, h), g = ctx2d(cvs);
  if (g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.setTransform(ppmX, 0, 0, ppmY, 0, 0);
    for (const q of (P.decalSources && P.decalSources.floor) || []) floorDecal(g, q, rngOf(hash(Math.round(q.x * 100), Math.round(q.z * 100), 1250 ^ P.seed)));
    for (const r of P.rugs || []) {                        // (a rug's edge throws a soft line of shade just outside it)
      g.save(); g.translate(r.x, r.z); g.rotate(-(r.rot || 0)); const hw = r.w / 2, hl = r.l / 2;
      for (const [grow, a] of [[0.06, 0.16], [0.03, 0.2], [0.012, 0.26]]) { g.fillStyle = 'rgba(20,14,10,' + a + ')'; g.fillRect(-hw - grow, -hl - grow, 2 * (hw + grow), 2 * (hl + grow)); }
      g.restore(); }
    for (const [x, z, ux, uz] of herPrints) { g.save(); g.translate(x, z); g.rotate(Math.atan2(uz, ux)); g.fillStyle = 'rgba(40,52,88,.22)';
      g.beginPath(); g.ellipse(0.02, 0, 0.085, 0.045, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(-0.075, 0, 0.038, 0.034, 0, 0, 7); g.fill(); g.restore(); }
    // d.decals: the floor's own stains, petals and words, painted by level.js's paintDecal in its units (PT per tile)
    g.setTransform(w / (GW * PT), 0, 0, h / (GH * PT), 0, 0);
    const paint = typeof paintDecal === 'function' ? paintDecal : paintDecalOwn;
    for (const d of E.decals) paint(g, d);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  lap('canvas');
  const pix = g ? g.getImageData(0, 0, w, h).data : null;
  const fLut = new Float32Array(256), bLut = new Float32Array(256);
  for (let c = 0; c < 256; c++) { fLut[c] = cv(ao.floor, c / 100); bLut[c] = cv(ao.boxFloor, c / 100); }
  for (let k = 0; k < np; k++) {
    const s = fLut[dWall[k]] * inside[k] * bLut[dBox[k]], o = k * 4;
    alb[o] = pix ? s * pix[o] : s * 255; alb[o + 1] = pix ? s * pix[o + 1] : s * 255; alb[o + 2] = pix ? s * pix[o + 2] : s * 255; alb[o + 3] = 255;
  }

  lap('albedo');
  /* ovCeil: half size, the plan's ceiling decals over white */
  const cw = Math.max(1, Math.round(w / 2)), chh = Math.max(1, Math.round(h / 2)), cc = canvas(cw, chh), gc = ctx2d(cc);
  let ceilPix;
  if (gc) { gc.fillStyle = '#fff'; gc.fillRect(0, 0, cw, chh); gc.setTransform(cw / (GW * L), 0, 0, chh / (GH * L), 0, 0);
    for (const q of (P.decalSources && P.decalSources.ceiling) || []) ceilDecal(gc, q, rngOf(hash(Math.round(q.x * 100), Math.round(q.z * 100), 1260 ^ P.seed)));
    ceilPix = new Uint8ClampedArray(gc.getImageData(0, 0, cw, chh).data.buffer); for (let k = 3; k < ceilPix.length; k += 4) ceilPix[k] = 255; }
  else ceilPix = new Uint8ClampedArray(cw * chh * 4).fill(255);

  lap('ceil');
  const ovSurf = imageOf(surf, w, h);
  const cpuSurf = { w, h, ppmX, ppmY, data: surf,
    px(x, z) { return (clamp(Math.floor(z * ppmY), 0, h - 1) * w + clamp(Math.floor(x * ppmX), 0, w - 1)) * 4; },
    dust(x, z) { const o = this.px(x, z); return surf[o + 1] / 255 * (1 - surf[o + 2] / 255); },
    wet(x, z) { return surf[this.px(x, z)] / 255; }, clean(x, z) { return surf[this.px(x, z) + 2] / 255; } };
  const maps = { ovAlbedo: imageOf(alb, w, h), ovSurf, tileInfo: imageOf(tinfo, GW, GH), ovCeil: imageOf(ceilPix, cw, chh), detail: detailTile(), dustCol: DUST_COL[style] || DUST_COL.wood };
  const decals = wallDecals(E, lv), prints = dustPrints(E, cpuSurf);
  lap('decals');
  Object.assign(stats, { T: TM, w, h, ceil: [cw, chh], routes: routes.length, prints: nPrints, herPrints: herPrints.length, wet: wets.length, boxes: boxes.length,
    decals: decals.quads.length, decalChunks: decals.meshes.length, ms: +(now() - t0).toFixed(1) });
  return Object.assign({}, maps, { maps, cpuSurf, decals, dustPrints: prints.mesh, update: prints.update, routes: routes.map(r => r.tiles), stats,
    dispose() { decals.dispose(); prints.dispose(); } });
}

/* ---------- painters (2D canvas, metres; colours multiply the floor / ceiling: white = nothing) ---------- */
function blob(g, r, rng, k) {                              // a wobbly closed outline of radius ~r
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28]; g.beginPath();
  for (let a = 0; a <= 6.3; a += 0.25) { const rr = r * (1 + (k || 0.18) * (Math.sin(3 * a + ph[0]) * 0.6 + Math.sin(5 * a + ph[1]) * 0.3 + Math.sin(8 * a + ph[2]) * 0.2)); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath();
}
function crackLines(g, rng, len, col, lw) {                // a branching random walk from the centre
  g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
  const walk = (x, y, a, l, depth) => { g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { a += (rng() - 0.5) * 0.9; x += Math.cos(a) * l / 6; y += Math.sin(a) * l / 6; g.lineTo(x, y);
      if (depth < 2 && rng() < 0.25) { g.stroke(); walk(x, y, a + (rng() < 0.5 ? 0.8 : -0.8), l * 0.5, depth + 1); g.beginPath(); g.moveTo(x, y); } }
    g.stroke(); };
  const a0 = rng() * 6.28; walk(0, 0, a0, len, 0); walk(0, 0, a0 + PI + (rng() - 0.5), len * 0.7, 1);
}
function floorDecal(g, q, rng) {
  const r = q.size / 2; g.save(); g.translate(q.x, q.z); g.rotate(q.rot || 0);
  if (q.kind === 'puddle') { g.fillStyle = 'rgba(40,46,56,.10)'; blob(g, r, rng); g.fill(); }        // (the wet itself is in ovSurf R)
  else if (q.kind === 'drain') { g.fillStyle = 'rgba(30,28,26,.55)'; g.beginPath(); g.arc(0, 0, 0.16, 0, 7); g.fill();
    g.fillStyle = 'rgba(8,8,8,.8)'; for (let k = -2; k <= 2; k++) g.fillRect(-0.11, k * 0.05 - 0.012, 0.22, 0.024);
    g.fillStyle = 'rgba(90,70,40,.18)'; g.beginPath(); g.arc(0, 0, 0.32, 0, 7); g.fill(); }
  else if (q.kind === 'ring') { g.strokeStyle = 'rgba(95,72,42,.28)'; g.lineWidth = 0.03; blob(g, r * 0.8, rng, 0.08); g.stroke();
    g.fillStyle = 'rgba(120,96,60,.08)'; g.fill(); g.lineWidth = 0.015; blob(g, r * 0.55, rng, 0.1); g.stroke(); }
  else if (q.kind === 'rust') { g.fillStyle = 'rgba(150,72,28,.26)'; blob(g, r * 0.75, rng, 0.3); g.fill();
    g.strokeStyle = 'rgba(110,50,20,.35)'; g.lineWidth = 0.025; blob(g, r * 0.5, rng, 0.05); g.stroke(); }
  else if (q.kind === 'paint') { const c = [[150, 40, 40], [60, 80, 150], [200, 190, 160], [60, 110, 70]][(rng() * 4) | 0];
    g.fillStyle = 'rgba(' + c + ',.5)'; blob(g, r * 0.6, rng, 0.35); g.fill();
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc((rng() - 0.5) * r * 2, (rng() - 0.5) * r * 2, 0.01 + rng() * 0.03, 0, 7); g.fill(); } }
  else if (q.kind === 'scorch') { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, 'rgba(12,8,6,.55)'); gr.addColorStop(1, 'rgba(12,8,6,0)');
    g.fillStyle = gr; blob(g, r, rng, 0.2); g.fill(); }
  else if (q.kind === 'rubble' || q.kind === 'plaster') { g.fillStyle = q.kind === 'rubble' ? 'rgba(45,38,32,.45)' : 'rgba(120,112,100,.3)';
    for (let k = 0; k < (q.kind === 'rubble' ? 26 : 12); k++) { const x = (rng() - 0.5) * r * 1.6, y = (rng() - 0.5) * r * 1.6, s = 0.015 + rng() * 0.05;
      g.beginPath(); g.moveTo(x - s, y); g.lineTo(x, y - s * 0.8); g.lineTo(x + s, y + s * 0.3); g.lineTo(x - s * 0.2, y + s); g.fill(); } }
  g.restore();
}
function ceilDecal(g, q, rng) {
  const r = q.size / 2; g.save(); g.translate(q.x, q.z); g.rotate(q.rot || 0);
  if (q.kind === 'ring') { g.fillStyle = 'rgba(150,118,70,.18)'; blob(g, r, rng, 0.15); g.fill();
    g.strokeStyle = 'rgba(110,80,40,.38)'; g.lineWidth = 0.035; g.stroke(); g.lineWidth = 0.02; blob(g, r * 0.7, rng, 0.2); g.stroke(); blob(g, r * 0.4, rng, 0.25); g.stroke(); }
  else if (q.kind === 'soot') { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, 'rgba(25,20,16,.5)'); gr.addColorStop(1, 'rgba(25,20,16,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); }
  else if (q.kind === 'mould') { for (let k = 0; k < 40; k++) { const a = rng() * 6.28, d = Math.sqrt(rng()) * r, s = 0.01 + rng() * 0.04 * (1 - d / r);
    g.fillStyle = 'rgba(' + (30 + rng() * 20 | 0) + ',' + (40 + rng() * 20 | 0) + ',28,' + (0.25 + rng() * 0.35).toFixed(2) + ')'; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d * 0.7, s, 0, 7); g.fill(); } }
  else if (q.kind === 'crack') crackLines(g, rng, r, 'rgba(30,24,20,.6)', 0.012);
  g.restore();
}
// level.js's paintDecal, for when level.js isn't loaded (the tests' own pages always have it)
function paintDecalOwn(g, d) {
  g.save(); g.translate(d.x * PT / TU, d.y * PT / TU); g.rotate(d.rot);
  if (d.type === 'stain') { const sg = g.createRadialGradient(0, 0, 0, 0, 0, d.s); sg.addColorStop(0, 'rgba(70,4,10,.6)'); sg.addColorStop(1, 'rgba(70,4,10,0)');
    g.fillStyle = sg; g.beginPath(); g.ellipse(0, 0, d.s, d.s * 0.65, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(70,4,10,.55)'; g.beginPath(); g.arc(d.s * 1.2, 2, 1.6, 0, 7); g.arc(d.s * 1.6, -1, 1, 0, 7); g.fill(); }
  else if (d.type === 'petal') for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? 'rgba(90,130,255,.55)' : 'rgba(150,180,255,.45)'; g.beginPath(); g.ellipse(k * 4 - 6, (k % 2) * 4 - 2, 3.2, 1.6, k * 1.3, 0, 7); g.fill(); }
  else { g.fillStyle = 'rgba(120,10,18,.6)'; g.font = 'bold 9px Georgia, serif'; g.textAlign = 'center'; g.fillText(d.text, 0, 3); g.fillRect(-2, 4, 0.7, 4 + d.s * 0.3); }
  g.restore();
}

/* ---------- the detail tiles' stand-in (B9 dust_detail, wet_edge): 256 x 256, tileable value noise, made once ---------- */
let detailCache = null;
function detailTile() {
  if (detailCache) return detailCache;
  const S = 256, d = new Uint8ClampedArray(S * S * 4);
  const oct = (x, y, f, k) => { const fx = x * f / S, fy = y * f / S, ax = Math.floor(fx), ay = Math.floor(fy), sx = smooth(fx - ax), sy = smooth(fy - ay);
    const v = (a, b) => hash(((a % f) + f) % f, ((b % f) + f) % f, k);
    const a0 = v(ax, ay) + (v(ax + 1, ay) - v(ax, ay)) * sx, a1 = v(ax, ay + 1) + (v(ax + 1, ay + 1) - v(ax, ay + 1)) * sx; return a0 + (a1 - a0) * sy; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dn = oct(x, y, 8, 1501) * 0.5 + oct(x, y, 32, 1502) * 0.3 + oct(x, y, 128, 1503) * 0.2, we = oct(x, y, 6, 1504) * 0.6 + oct(x, y, 24, 1505) * 0.4, o = (y * S + x) * 4;
    d[o] = Math.round(clamp(0.25 + dn * 0.85, 0, 1) * 255); d[o + 1] = Math.round(clamp((we - 0.2) * 1.4, 0, 1) * 255); d[o + 3] = 255;
  }
  return (detailCache = { data: d, w: S, h: S });
}

/* ---------- wall decals (D4): merged quads per 6 x 6 chunk, lit like the wall behind them ---------- */
const KINDS = ['stain', 'mould', 'soot', 'scratch', 'drawing', 'handprint', 'crack', 'flakes', 'rust', 'ghost', 'damp', 'height_chart'];
const ASPECT = { soot: 0.62, ghost: 0.78, damp: 3, height_chart: 0.25, drawing: 1.2, rust: 0.55 };   // (width / height of the decal)
const BASE = { stain: [120, 92, 55], mould: [38, 46, 30], soot: [24, 20, 17], scratch: [205, 196, 178], drawing: [180, 40, 40], handprint: [60, 40, 32],
  crack: [28, 22, 18], flakes: [212, 204, 186], rust: [130, 62, 26], ghost: [228, 218, 196], damp: [92, 78, 55], height_chart: [226, 214, 186] };
let atlasCache = {};
// the procedural atlas: 8 variants of each kind, one cell each. Colour and coverage are drawn on two opaque canvases (colour, and
// coverage in white), then joined into RGBA bytes: a 2D canvas never holds the alpha (H14)
function proceduralAtlas(cell) {
  if (atlasCache[cell]) return atlasCache[cell];
  const AW = cell * 8, AH = cell * KINDS.length, cc = canvas(AW, AH), ca = canvas(AW, AH), gC = ctx2d(cc), gA = ctx2d(ca);
  if (!gC) return null;
  gA.fillStyle = '#000'; gA.fillRect(0, 0, AW, AH);
  const rects = {};
  KINDS.forEach((kind, row) => { rects[kind] = [];
    for (let v = 0; v < 8; v++) {
      const asp = ASPECT[kind] || 1, pad = 3, inner = cell - 2 * pad, rw = asp >= 1 ? inner : inner * asp, rh = asp >= 1 ? inner / asp : inner;
      const x = v * cell + (cell - rw) / 2, y = row * cell + (cell - rh) / 2;
      rects[kind].push([x, y, rw, rh]);
      gC.fillStyle = 'rgb(' + BASE[kind] + ')'; gC.fillRect(v * cell, row * cell, cell, cell);
      for (const mode of [0, 1]) { const g = mode ? gA : gC, rng = rngOf(hash(row, v, 1601));
        g.save(); g.translate(x + rw / 2, y + rh / 2); g.scale(rw / 2, rh / 2);   // (draw in -1..1 across the decal)
        const st = (r, gg, b, a) => mode ? 'rgba(255,255,255,' + a + ')' : 'rgb(' + r + ',' + gg + ',' + b + ')';
        decalArt(g, kind, v, rng, st, rw / rh, cell);
        g.restore(); }
    } });
  const c = gC.getImageData(0, 0, AW, AH).data, a = gA.getImageData(0, 0, AW, AH).data, out = new Uint8ClampedArray(AW * AH * 4);
  for (let k = 0; k < out.length; k += 4) { out[k] = c[k]; out[k + 1] = c[k + 1]; out[k + 2] = c[k + 2]; out[k + 3] = a[k]; }
  return (atlasCache[cell] = { data: out, W: AW, H: AH, rects });
}
// one decal's art in -1..1 (x right, y down; asp = width / height, so a circle is drawn as an ellipse of 1/asp)
function decalArt(g, kind, v, rng, st, asp, cell) {
  const lw = k => k * 2 / Math.max(8, cell * 0.5);          // (line widths that stay a few pixels whatever the cell size)
  const B = BASE[kind];
  if (kind === 'stain') { for (let k = 0; k < 3; k++) { g.fillStyle = st(B[0] - k * 15, B[1] - k * 12, B[2] - k * 8, 0.18 + k * 0.08); g.save(); g.translate(0, -0.15 + k * 0.1); g.scale(1, 1.1); blob(g, 0.85 - k * 0.22, rng, 0.25); g.fill(); g.restore(); }
    g.strokeStyle = st(B[0] - 40, B[1] - 35, B[2] - 25, 0.55); g.lineWidth = lw(2); blob(g, 0.8, rng, 0.2); g.stroke();
    for (let k = 0; k < 2 + v % 3; k++) { const x = (rng() - 0.5) * 1.2; g.fillStyle = st(B[0] - 30, B[1] - 25, B[2] - 20, 0.35); g.fillRect(x, 0.2, lw(1.5), 0.5 + rng() * 0.4); } }
  else if (kind === 'mould') for (let k = 0; k < 90; k++) { const a = rng() * 6.28, d = Math.pow(rng(), 0.7) * 0.95, s = (0.03 + rng() * 0.09) * (1.1 - d);
    g.fillStyle = st(B[0] + (rng() * 25 | 0), B[1] + (rng() * 25 | 0), B[2] + (rng() * 15 | 0), (0.3 + rng() * 0.5) * (1.1 - d)); g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, s, 0, 7); g.fill(); }
  else if (kind === 'soot') { for (let k = 0; k < 12; k++) { const t = k / 11, y = 0.95 - t * 1.9, rx = 0.25 + t * 0.7;
    g.fillStyle = st(B[0], B[1], B[2], 0.12 * (1 - t * 0.6)); g.beginPath(); g.ellipse((rng() - 0.5) * 0.15, y, rx, 0.3, 0, 0, 7); g.fill(); } }
  else if (kind === 'scratch') { g.strokeStyle = st(B[0], B[1], B[2], 0.8); g.lineCap = 'round'; const nS = 3 + v % 3, a = -0.6 + rng() * 1.2;
    for (let k = 0; k < nS; k++) { g.lineWidth = lw(1 + rng()); const o = (k - nS / 2) * 0.18; g.beginPath(); g.moveTo(-0.8 * Math.cos(a) - o * Math.sin(a), -0.8 * Math.sin(a) + o * Math.cos(a) - 0.2);
      g.quadraticCurveTo(o, rng() * 0.2, 0.8 * Math.cos(a) - o * Math.sin(a) + rng() * 0.1, 0.8 * Math.sin(a) + o * Math.cos(a) + 0.2); g.stroke(); } }
  else if (kind === 'drawing') {                           // crayon: stick figures, a tall figure in a blue dress, a house with no door, a sun, tally marks, words
    const cols = [[190, 40, 40], [40, 70, 170], [210, 170, 40], [50, 130, 60], [30, 30, 30]], c = cols[v % 5], sx = 1 / asp;
    g.strokeStyle = st(c[0], c[1], c[2], 0.85); g.fillStyle = st(c[0], c[1], c[2], 0.85); g.lineWidth = lw(2.2); g.lineCap = 'round'; g.lineJoin = 'round';
    const fig = (x, s) => { g.beginPath(); g.ellipse(x, -0.5 * s, 0.14 * s * sx, 0.14 * s, 0, 0, 7); g.moveTo(x, -0.36 * s); g.lineTo(x, 0.25 * s);
      g.moveTo(x - 0.25 * s * sx, -0.1 * s); g.lineTo(x + 0.25 * s * sx, -0.1 * s); g.moveTo(x, 0.25 * s); g.lineTo(x - 0.18 * s * sx, 0.7 * s); g.moveTo(x, 0.25 * s); g.lineTo(x + 0.18 * s * sx, 0.7 * s); g.stroke(); };
    const k = v % 6;
    if (k === 0) { fig(-0.55, 0.8); fig(-0.1, 0.65); fig(0.3, 0.55); }
    else if (k === 1) { fig(-0.5, 0.6); g.strokeStyle = st(40, 70, 170, 0.85); g.fillStyle = st(40, 70, 170, 0.6); g.beginPath(); g.ellipse(0.35, -0.75, 0.12 * sx, 0.12, 0, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(0.35, -0.62); g.lineTo(0.1, 0.8); g.lineTo(0.6, 0.8); g.closePath(); g.fill(); }
    else if (k === 2) { g.beginPath(); g.rect(-0.5, -0.1, 1, 0.8); g.moveTo(-0.6, -0.1); g.lineTo(0, -0.7); g.lineTo(0.6, -0.1); g.stroke();
      g.beginPath(); g.rect(-0.35, 0.1, 0.22, 0.2); g.rect(0.13, 0.1, 0.22, 0.2); g.stroke(); }
    else if (k === 3) { g.beginPath(); g.ellipse(0, 0, 0.35 * sx, 0.35, 0, 0, 7); g.stroke(); for (let r = 0; r < 10; r++) { const a = r * 0.628; g.beginPath(); g.moveTo(Math.cos(a) * 0.45 * sx, Math.sin(a) * 0.45); g.lineTo(Math.cos(a) * 0.75 * sx, Math.sin(a) * 0.75); g.stroke(); }
      g.beginPath(); g.arc(-0.12 * sx, -0.08, 0.04, 0, 7); g.arc(0.12 * sx, -0.08, 0.04, 0, 7); g.fill(); g.beginPath(); g.arc(0, 0.05, 0.18, 0.3, 2.8); g.stroke(); }
    else if (k === 4) { for (let t = 0; t < 4; t++) { const x0 = -0.8 + t * 0.42; for (let q = 0; q < 4; q++) { g.beginPath(); g.moveTo(x0 + q * 0.07, -0.4); g.lineTo(x0 + q * 0.07 + 0.02, 0.4); g.stroke(); }
      g.beginPath(); g.moveTo(x0 - 0.04, 0.25); g.lineTo(x0 + 0.3, -0.25); g.stroke(); } }
    else { const words = ['LA LA LA', 'LET ME OUT', "DONT LET HER IN"]; g.save(); g.scale(sx * 0.012, 0.012); g.font = 'bold 34px sans-serif'; g.textAlign = 'center';
      g.fillText(words[v % 3], 0, 12); g.restore(); } }
  else if (kind === 'handprint') { const c = [[60, 40, 32], [110, 20, 22], [30, 28, 26], [70, 55, 40]][v % 4], smear = v === 5;
    g.fillStyle = st(c[0], c[1], c[2], 0.7); g.save(); g.rotate((rng() - 0.5) * 0.5); g.scale(v % 2 ? -1 : 1, 1);
    g.beginPath(); g.ellipse(0, 0.3, 0.38, 0.42, 0, 0, 7); g.fill();
    for (let f = 0; f < 4; f++) { g.save(); g.translate(-0.27 + f * 0.18, -0.12); g.rotate(-0.15 + f * 0.1); g.beginPath(); g.ellipse(0, -0.35, 0.075, 0.3 - Math.abs(f - 1.5) * 0.05, 0, 0, 7); g.fill(); g.restore(); }
    g.save(); g.translate(0.4, 0.25); g.rotate(0.9); g.beginPath(); g.ellipse(0, -0.2, 0.08, 0.22, 0, 0, 7); g.fill(); g.restore();
    if (smear) { g.fillStyle = st(c[0], c[1], c[2], 0.35); g.fillRect(-0.3, 0.5, 0.6, 0.45); }
    g.restore(); }
  else if (kind === 'crack') crackLines(g, rng, 0.95, st(B[0], B[1], B[2], 0.85), lw(1.6));
  else if (kind === 'flakes') for (let k = 0; k < 14; k++) { const x = (rng() - 0.5) * 1.5, y = (rng() - 0.5) * 1.5, s = 0.08 + rng() * 0.2;
    g.fillStyle = st(B[0] - (rng() * 30 | 0), B[1] - (rng() * 30 | 0), B[2] - (rng() * 30 | 0), 0.85); g.save(); g.translate(x, y); blob(g, s, rng, 0.45); g.fill(); g.restore(); }
  else if (kind === 'rust') for (let k = 0; k < 7; k++) { const x = (rng() - 0.5) * 1.4, l = 0.6 + rng() * 1.3;
    const gr = g.createLinearGradient(0, -1, 0, -1 + l); gr.addColorStop(0, st(B[0], B[1], B[2], 0.75)); gr.addColorStop(1, st(B[0] + 30, B[1] + 20, B[2], 0)); g.fillStyle = gr;
    g.fillRect(x, -1, 0.08 + rng() * 0.2, l); }
  else if (kind === 'ghost') { g.fillStyle = st(B[0], B[1], B[2], 0.32); g.fillRect(-0.9, -0.9, 1.8, 1.8); g.strokeStyle = st(70, 60, 45, 0.3); g.lineWidth = lw(2); g.strokeRect(-0.92, -0.92, 1.84, 1.84);
    g.fillStyle = st(60, 50, 40, 0.5); g.beginPath(); g.arc(0, -0.97, 0.03, 0, 7); g.fill(); }
  else if (kind === 'damp') { for (let k = 0; k < 6; k++) { g.fillStyle = st(B[0] - k * 6, B[1] - k * 6, B[2] - k * 4, 0.12); g.beginPath(); g.moveTo(-1, 1);
    for (let x = -1; x <= 1.001; x += 0.05) g.lineTo(x, 0.9 - (1.6 - k * 0.22) * (0.75 + 0.25 * Math.sin(x * 9 + k + rng() * 2))); g.lineTo(1, 1); g.closePath(); g.fill(); } }
  else if (kind === 'height_chart') { g.fillStyle = st(B[0], B[1], B[2], 0.9); g.fillRect(-0.9, -1, 1.8, 2); g.fillStyle = st(40, 30, 25, 0.9);
    for (let t = 0; t <= 20; t++) g.fillRect(-0.9, -1 + t * 0.1, t % 5 ? 0.6 : 1.1, 0.012);
    g.fillStyle = st(170, 40, 50, 0.85); for (let t = 0; t < 4; t++) g.fillRect(-0.2, 0.6 - t * 0.33 - rng() * 0.1, 1.0, 0.02); }
}
// the decal atlas: Blender's (Surface.load) when present, else the procedural one. -> {tex, normal, W, H, rect(kind, id), source}
function atlasFor(E, style) {
  const A = assets.decals;
  if (A && A.albedo && A.entries) {
    const byKind = {};
    for (const e of A.entries) for (const k of e.kinds || []) if (!e.styles || e.styles.includes(style)) (byKind[k] || (byKind[k] = [])).push(e);
    const W = A.albedo.naturalWidth || A.albedo.width, H = A.albedo.naturalHeight || A.albedo.height;
    return { img: A.albedo, normal: A.normal, W, H, source: 'file', rect: (kind, id) => { const l = byKind[kind]; return l && l.length ? l[id % l.length].rect : null; } };
  }
  const P = proceduralAtlas(E.tier ? 128 : 64); if (!P) return null;
  return { data: P.data, W: P.W, H: P.H, source: 'procedural', rect: (kind, id) => (P.rects[kind] || P.rects.stain)[id % 8] };
}
function wallDecals(E, lv) {
  const { P, GW, GH, tier } = E, F = P.faces, src = (P.decalSources && P.decalSources.wall) || [], quads = [], group = typeof THREE !== 'undefined' ? new THREE.Group() : null, meshes = [];
  const out = { group, meshes, quads, material: null, atlas: null, dispose() {
    for (const m of meshes) m.geometry.dispose();
    if (out.material && out.ownMaterial) { const ds = out.material.userData.disposables || []; for (const t of ds) t.dispose(); if (out.material.map && !ds.includes(out.material.map)) out.material.map.dispose(); out.material.dispose(); } } };
  if (group) group.name = 'SurfaceDecals';
  if (!src.length) return out;
  // the wall lightmap atlas cells (uv1): LightBaker's own wallCells when given, else packAtlas (the same cells as bake(), from the faces' h)
  let cells = lv.cells || lv.wallCells || null;
  if (!cells && typeof LightBaker !== 'undefined') { try { cells = LightBaker.packAtlas(F.map(f => ({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, nx: f.nx, nz: f.nz, x: f.x, y: f.y, h: f.h })), ['lo', 'md', 'hi'][tier]).cells; } catch (e) { cells = null; } }
  const at = atlasFor(E, P.style || E.style); if (!at) return out;
  out.atlas = { W: at.W, H: at.H, source: at.source };
  const NCX = Math.ceil(GW / CH), bufs = new Map();
  const topAt = (f, u) => { if (!f.hs) return f.h; let j = 0; while (j < 3 && u > FACE_U[j + 1]) j++; const s = (u - FACE_U[j]) / (FACE_U[j + 1] - FACE_U[j]); return f.hs[j] + (f.hs[j + 1] - f.hs[j]) * s; };
  for (const q of src) {
    const f = F[q.face], rect = at.rect(q.kind, q.id | 0); if (!f || !rect) continue;
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), asp = ASPECT[q.kind] || 1;
    let hw = (asp >= 1 ? q.size : q.size * asp) / 2, hh = (asp >= 1 ? q.size / asp : q.size) / 2;
    const uc = q.u * len, vc = q.v, c = Math.cos(q.rot || 0), s = Math.sin(q.rot || 0);
    // fit it inside the face: shrink about its centre until every corner is within the face and under the ceiling line
    const corners = k => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [uc + (a * hw * k) * c - (b * hh * k) * s, vc + (a * hw * k) * s + (b * hh * k) * c]);
    let k = 1;
    for (let it = 0; it < 30; it++) { const cs = corners(k); if (cs.every(([u, y]) => u >= 0.01 && u <= len - 0.01 && y >= 0.01 && y <= topAt(f, clamp(u / len, 0, 1)) - 0.01)) break; k *= 0.9; }
    if (k < 0.2) continue;
    hw *= k; hh *= k;
    const cs = corners(1), d = (q.proud || 0) + 0.003, cell = cells && cells[q.face];
    const pts = cs.map(([u, y]) => { const t = u / len; return [f.x0 + (f.x1 - f.x0) * t + f.nx * d, y, f.z0 + (f.z1 - f.z0) * t + f.nz * d, t]; });
    const [rx, ry, rw, rh] = rect, u0 = rx / at.W, u1 = (rx + rw) / at.W, vT = 1 - ry / at.H, vB = 1 - (ry + rh) / at.H;
    const uv = [[u0, vB], [u1, vB], [u1, vT], [u0, vT]];   // (corner order: -u -y, +u -y, +u +y, -u +y)
    const ch = Math.floor(f.y / CH) * NCX + Math.floor(f.x / CH);
    let b = bufs.get(ch); if (!b) bufs.set(ch, b = { p: [], n: [], uv: [], uv1: [], ix: [] });
    const base = b.p.length / 3;
    pts.forEach((p, i) => { b.p.push(p[0], p[1], p[2]); b.n.push(f.nx, 0, f.nz); b.uv.push(uv[i][0], uv[i][1]);
      b.uv1.push(cell ? cell.u0 + p[3] * cell.su : 0, cell ? cell.v0 + p[1] * cell.sv : 0); });
    // wound so the front faces the room: corners 0 -> 1 -> 2 run +u then +y, counter-clockwise from the side (t x up) points to
    const tx = (f.x1 - f.x0) / len, tz = (f.z1 - f.z0) / len, front = -tz * f.nx + tx * f.nz;   // ((t x up) . n, up = +y)
    if (front > 0) b.ix.push(base, base + 1, base + 2, base, base + 2, base + 3); else b.ix.push(base, base + 2, base + 1, base, base + 3, base + 2);
    quads.push({ face: q.face, kind: q.kind, src: q, corners: pts.map(p => [p[0], p[1], p[2]]), centre: [f.x0 + (f.x1 - f.x0) * q.u + f.nx * d, vc, f.z0 + (f.z1 - f.z0) * q.u + f.nz * d], half: Math.hypot(hw, hh) });
  }
  if (!group || !bufs.size) return out;
  // the material: the integrator's, else MatLib's decal family (lit through uv1 like the wall), else a plain transparent one
  let mat = lv.materials && lv.materials.decal;
  if (!mat) {
    let tex;
    if (at.data) tex = typeof MatLib !== 'undefined' ? MatLib.dataTexture(imageOf(at.data, at.W, at.H), { srgb: true }) : Object.assign(new THREE.CanvasTexture(imageOf(at.data, at.W, at.H)), { colorSpace: THREE.SRGBColorSpace });
    else { tex = new THREE.CanvasTexture(at.img); tex.colorSpace = THREE.SRGBColorSpace; }
    let ntex = null; if (at.normal) ntex = new THREE.CanvasTexture(at.normal);
    if (typeof MatLib !== 'undefined') mat = MatLib.decalMaterial({ map: tex, normalMap: ntex || undefined, tier: ['low', 'medium', 'high'][tier] });
    else mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const ds = mat.userData.disposables || (mat.userData.disposables = []); ds.push(tex); if (ntex) ds.push(ntex);
    out.ownMaterial = true;
  }
  out.material = mat;
  for (const [ch, b] of [...bufs.entries()].sort((a, c) => a[0] - c[0])) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.p), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2)); g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(b.uv1), 2));
    g.setIndex(new THREE.BufferAttribute(b.p.length / 3 > 65535 ? new Uint32Array(b.ix) : new Uint16Array(b.ix), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = 'surf_decals_' + ch; m.userData.chunk = ch; m.userData.surface = 'decals'; m.renderOrder = 1; m.receiveShadow = true;
    group.add(m); meshes.push(m);
  }
  return out;
}

/* ---------- dust prints (D2): one InstancedMesh of 200, a ring buffer, stamped where the dust is thick ---------- */
function dustPrints(E, cpu) {
  const st = new Map(), rugs = E.P.rugs || [];
  const none = { mesh: null, update() {}, dispose() {} };
  if (typeof THREE === 'undefined') return none;
  const c = canvas(64, 32), g = ctx2d(c);                  // (alpha map: white sole on black, an opaque canvas read as data in G)
  if (!g) return none;
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(39, 16, 20, 10, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(10, 16, 8.5, 7.5, 0, 0, 7); g.fill();
  g.fillStyle = '#000'; for (let k = 0; k < 5; k++) g.fillRect(24 + k * 6, 8, 1.5, 16);   // (tread lines)
  const tex = new THREE.CanvasTexture(c), geo = new THREE.PlaneGeometry(0.26, 0.11); geo.rotateX(-PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, alphaMap: tex, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.userData.disposables = [tex];
  if (typeof MatLib !== 'undefined') MatLib.withLightField(mat);
  const mesh = new THREE.InstancedMesh(geo, mat, PRINTS); mesh.count = 0; mesh.frustumCulled = false; mesh.name = 'SurfDustPrints'; mesh.renderOrder = 1;
  const col = new THREE.Color(0x4a4741); for (let i = 0; i < PRINTS; i++) mesh.setColorAt(i, col);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let head = 0;
  const onRug = (x, z) => rugs.some(r => { const dx = x - r.x, dz = z - r.z, c2 = Math.cos(r.rot || 0), s2 = Math.sin(r.rot || 0), a = dx * c2 - dz * s2, b = dx * s2 + dz * c2;
    return Math.abs(a) < r.w / 2 + 0.05 && Math.abs(b) < r.l / 2 + 0.05; });
  const stamp = (x, z, ang, kind) => {
    const k = kind === 'her' ? 1.15 : kind === 'child' ? 0.8 : 1;
    m4.compose(v.set(x, 0.003, z), q.setFromAxisAngle(up, -ang), sc.set(k, 1, k)); mesh.setMatrixAt(head, m4);
    mesh.setColorAt(head, col.setHex(kind === 'her' ? 0x55524b : 0x4a4741)); head = (head + 1) % PRINTS;
    mesh.count = Math.min(PRINTS, mesh.count + 1); mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  const stamped = [];                                      // (the last ones, for the tests: [x, z, dust])
  const update = (dt, actors) => {
    for (const a of actors || []) {
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
      const id = a.id !== undefined ? a.id : a.kind, s = st.get(id);
      if (!s) { st.set(id, { x: a.x, z: a.z, acc: 0, foot: 1, ang: 0 }); continue; }
      const dx = a.x - s.x, dz = a.z - s.z, d = Math.hypot(dx, dz);
      if (d > 3) { s.x = a.x; s.z = a.z; s.acc = 0; continue; }   // (a teleport, a respawn: no trail across the house)
      if (d < 1e-5) continue;
      s.ang = Math.atan2(dz, dx); s.acc += d; s.x = a.x; s.z = a.z;
      while (s.acc >= STEP) { s.acc -= STEP; s.foot = -s.foot;
        const back = s.acc, ux = Math.cos(s.ang), uz = Math.sin(s.ang), px = a.x - ux * back - uz * s.foot * 0.09, pz = a.z - uz * back + ux * s.foot * 0.09;
        const dust = cpu.dust(px, pz);
        if (dust > 0.4 && !onRug(px, pz)) { stamp(px, pz, s.ang, a.kind); stamped.push([px, pz, dust]); if (stamped.length > PRINTS) stamped.shift(); } }
    }
  };
  mesh.userData.stamped = stamped;
  return { mesh, update, dispose() { geo.dispose(); tex.dispose(); mat.dispose(); mesh.dispose && mesh.dispose(); } };
}

/* ---------- lv from d, or from the live game ---------- */
function lvFromData(d, o) {
  o = o || {};
  const env = typeof Dress !== 'undefined' ? Dress.envFromData(d) : { rows: d.rows, solids: d.solids || [], rooms: d.rooms || [], runs: d.runs || [], VSEED: d.seed >>> 0, closets: d.closets,
    exit: d.exit, puzzles: d.puzzles, notes: d.notes, creaks: d.creaks, floorIdx: d.i };
  const lv = Object.assign({}, env, { decals: d.decals || [], spawns: d.spawns, tier: o.tier || 'low' });
  lv.plan = o.plan || (typeof Dress !== 'undefined' ? Dress.plan(env) : null);
  return lv;
}
function lvFromGame(o) {
  /* global grid, GW, GH, SOLIDS, closets, notes, decals, puzzles, exit, creaks, floorIdx, FLOORS */
  o = o || {};
  const env = Dress.envFromGame();
  return Object.assign({}, env, { decals, spawns: o.spawns || null, tier: o.tier || (typeof settings !== 'undefined' ? settings.quality : 'low'), plan: o.plan || Dress.plan(env) });
}

/* ---------- Blender's data, when it's there ---------- */
let loading = null;
function load(tier) {
  if (loading) return loading;
  const t = ['lo', 'md', 'hi'][tierOf(tier)];
  const json = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
  const img = url => new Promise(res => { if (typeof Image === 'undefined') return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  loading = Promise.all([json('textures/light/ao_profiles.json'), json('textures/decals/decals.json')]).then(([ao, dj]) => {
    assets.ao = ao;
    if (!dj) return assets;
    return Promise.all([img('textures/decals/decals_albedo.' + t + '.webp'), img('textures/decals/decals_normal.' + t + '.webp')]).then(([albedo, normal]) => {
      if (albedo) assets.decals = { entries: Array.isArray(dj) ? dj : dj.decals || [], albedo, normal }; return assets; });
  });
  return loading;
}

window.Surface = { build, lvFromData, lvFromGame, load, bfsPath: bfsPathOn, vh: vhOf, aoCurves, assets: () => assets, KINDS };
})();
