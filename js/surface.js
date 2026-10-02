/* Escape from Barbi Blue: the surface detail of a floor (build spec D1-D6, C4, C5, H14, H15): what a floor looks like close up
   under the flashlight. Corner shade and contact shadows under the furniture, dust that gathers along the walls and in the halls,
   the paths worn clean between the places everyone walks, wet patches, stains, prints, and the decals on the walls and ceilings.
   Painted once per floor into plan-space maps that js/matlib.js's floor and ceiling programs read, plus one merged decal mesh per
   6 x 6 tiles and the dust prints that you, your teammates and she leave in thick dust.
   Pure: every byte comes from the floor's data (its grid, boxes, the plan of js/dress.js) and vh, the tile hash mixed with the
   floor's seed (spec A14). No Math.random; the quality tier only sets the resolution (H7, H24). Every player sees the same dust.

   Surface.build(lv) -> {
     ovAlbedo   ImageData (RGB multiply, sRGB-encoded: the linear AO curves are applied to the decoded colour), plan space (row 0 = grid row 0, uv = (x / W, 1 - z / H): H14), 2048 / 1024 / 512 px
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
                centre, half}], atlas {W, H, source 'procedural' | 'file', data | img, normal, rect(kind, id), texture(), normalTexture()} }: merged quads 3 mm proud of their face (or of a servant
                run's inset, or a chimney breast's front), uv0 = the decal atlas rect, uv1 = the face's cell of the wall lightmap atlas,
                so a decal is lit exactly like the wall behind it (MatLib.decalMaterial). Fitted inside their faces, <= 2 a face.
     dustPrints InstancedMesh of 200 shoe prints (ring buffer) at y = 0.003. Its children: her bare prints (a ring of 100) and the
                floor's static prints (staticPrints), so adding dustPrints to the level adds them all
     staticPrints { child, her }: InstancedMeshes, the child shoe prints beside some paths and her bare trail to a wardrobe (vh-placed,
                crisp at every tier; ovSurf B holds only their soft smear)
     update(dt, actors)  every frame: actors [{x, z (m), id, kind ('player' | 'mate' | 'her' | 'child'...)}]; every 0.65 m of an actor's
                walk a print where cpuSurf dust > 0.4 (not on rugs or loose boards); her prints bare. Visual only. Returns this frame's
                prints [{id, kind, x, z}]: render.js keeps its wet blue prints for her, but leaves one out where she left a dust print
                (or wherever cpuSurf.dust(x, z) > 0.4)
     stats      { ms, w, h, paths, prints, wet, decals, ... };   dispose()   frees what build made (not the ImageData maps: MatLib owns
                the textures it makes of them) }
   lv: the floor (Surface.lvFromData(d, {tier}) builds it from d; Surface.lvFromGame({tier, spawns, plan}) from the live globals):
     grid | rows, solids | SOLIDS, closets, creaks, notes, decals (d.decals: the floor's painted stains, petals and words), puzzles, exit,
     spawns (d.spawns, game units), style, floorIdx, tier ('low' | 'medium' | 'high' | 'lo' | 'md' | 'hi'), plan (Dress.plan; made from
     lv when missing), and optionally: cells (LightBaker's result.wallCells, else LightBaker.packAtlas gives the same), aoProfiles,
     materials { decal } (a decal material to use instead of MatLib.decalMaterial).
   Surface.load(tier) -> Promise: fetches textures/light/ao_profiles.json and the Blender decal atlas (textures/decals/decals.json and
   decals_{albedo,normal}.<tier>.webp) once per tier; later builds use the last tier asked for.
   Cost: the smooth layers are worked out at <= 1024 px (WORK_MAX) and scaled up for High; stats.T has the time per phase. Without them: built-in AO curves and a procedural decal atlas. */
(function () {
'use strict';

const UM = 0.045, TU = 50, L = TU * UM, PT = 40, CH = 6, R_NAV0 = 13, PRINTS = 200, BARE_PRINTS = 100, STEP = 0.65, BOARD_LEN = 24, BOARD_W = 13;
// the smooth layers (distances, paths, wet, dust) are worked out at most this many px on the long side and scaled up for High:
// they change over 0.1 m and more, and doing them at 2048 px made High cost seconds (the crisp things, the canvas decals and the
// prints, stay at full size)
const WORK_MAX = 1024;
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
// sRGB <-> linear: ovAlbedo is uploaded as an sRGB texture, so a linear multiplier (the AO curves) is applied to the decoded colour
// and encoded again: the GPU then multiplies by exactly the curve, and the floor meets the wall's own AO at the floor line
const DEC = new Float32Array(256), ENC = new Uint8Array(4096);
for (let c = 0; c < 256; c++) { const v = c / 255; DEC[c] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
for (let i = 0; i < 4096; i++) { const v = i / 4095; ENC[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
// bilinear resampling tables, n destination px from m source px (pixel centres line up): [i0, i1, frac]
function resTab(n, m) {
  const a0 = new Int32Array(n), a1 = new Int32Array(n), f = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = clamp((i + 0.5) * m / n - 0.5, 0, m - 1), x0 = Math.floor(x); a0[i] = x0; a1[i] = Math.min(m - 1, x0 + 1); f[i] = x - x0; }
  return [a0, a1, f];
}
// an RGBA byte image scaled up bilinearly: whole pixels as 32-bit words, two channels at a time (R B, then G A, 16 bits a lane),
// weights in 1/256 (the same bytes on every machine: integer arithmetic only)
function upsample4(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4), S = new Uint32Array(src.buffer, src.byteOffset, sw * sh), O = new Uint32Array(out.buffer);
  const [X0, X1, FXf] = resTab(dw, sw), [Y0, Y1, FYf] = resTab(dh, sh), FX = Int32Array.from(FXf, f => Math.round(f * 256)), FY = Int32Array.from(FYf, f => Math.round(f * 256));
  const M = 0x00FF00FF, RND = 0x00800080;
  const lerp = (p, q, f) => { const g = 256 - f;   // (two words -> one, both lane pairs)
    const rb = (((p & M) * g + (q & M) * f + RND) >>> 8) & M, ga = ((((p >>> 8) & M) * g + ((q >>> 8) & M) * f + RND) >>> 8) & M; return (rb | (ga << 8)) >>> 0; };
  for (let j = 0; j < dh; j++) { const r0 = Y0[j] * sw, r1 = Y1[j] * sw, fy = FY[j], o = j * dw;
    for (let i = 0; i < dw; i++) { const x0 = X0[i], x1 = X1[i], fx = FX[i];
      O[o + i] = lerp(lerp(S[r0 + x0], S[r0 + x1], fx), lerp(S[r1 + x0], S[r1 + x1], fx), fy); } }
  return out;
}
// zero one channel of an RGBA (or 1-channel: stride 1) image where the pixel centre is inside any of the rects [x0, z0, x1, z1] (m)
function maskRects(a, stride, ch, w, h, ppX, ppY, rects) {
  for (const [x0, z0, x1, z1] of rects) {
    const i0 = Math.max(0, Math.ceil(x0 * ppX - 0.5)), i1 = Math.min(w - 1, Math.floor(x1 * ppX - 0.5)), j0 = Math.max(0, Math.ceil(z0 * ppY - 0.5)), j1 = Math.min(h - 1, Math.floor(z1 * ppY - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) a[(j * w + i) * stride + ch] = 0;
  }
}
const onRugOf = (rugs, x, z) => rugs.some(r => { const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0), a = dx * c - dz * s, b = dx * s + dz * c;
  return Math.abs(a) < r.w / 2 + 0.05 && Math.abs(b) < r.l / 2 + 0.05; });
const inRects = (rects, x, z) => { for (const r of rects) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return true; return false; };

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
  // the loose floorboards (d.creaks [x, y, along, len] in u, or the game's {x, y, along, len}): their rectangles in m, a little grown.
  // The 3D boards lie on the floor, so no wet runs under them and no dust print lands on them (as with rugs)
  const boards = (lv.creaks || []).map(b => { const a = Array.isArray(b) ? { x: b[0], y: b[1], along: b[2], len: b[3] } : b, len = a.len || BOARD_LEN;
    const hx = (a.along ? BOARD_W / 2 : len / 2) * UM + 0.04, hz = (a.along ? len / 2 : BOARD_W / 2) * UM + 0.04, cx = a.x * UM, cz = a.y * UM;
    return [cx - hx, cz - hz, cx + hx, cz + hz]; });
  return { P, GW, GH, n, W, isW, solids, closets, notes, exit, spawns, puzzles, boards, decals: lv.decals || [], style, fi, tier: tierOf(lv.tier || (typeof settings !== 'undefined' && settings.quality)),
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
    // (the vertical pass row by row, a running sum per column: the image is read in order, not a column at a time)
    const sums = new Int32Array(w), out = new Uint8Array(w * h);
    for (let j = -r; j <= r; j++) { const o = clamp(j, 0, h - 1) * w; for (let i = 0; i < w; i++) sums[i] += a[o + i]; }
    for (let j = 0; j < h; j++) { const o = j * w, add = Math.min(h - 1, j + r + 1) * w, sub = Math.max(0, j - r) * w;
      for (let i = 0; i < w; i++) { out[o + i] = (sums[i] + (n >> 1)) / n; sums[i] += a[add + i] - a[sub + i]; } }
    a.set(out);
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
  for (let k = 1; k < pts.length - 1; k++) {               // (the meander on straight runs; a turn stays on its tile centre)
    const a = tiles[k - 1], b = tiles[k + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx && dy) continue;
    const ll = Math.hypot(dx, dy) || 1, m = (vh(tiles[k][0], tiles[k][1], 1210 + key) - 0.5) * 0.3;
    pts[k][0] += -dy / ll * m; pts[k][1] += dx / ll * m;
  }
  // corners rounded the way a walker cuts them, but only 0.3 m in from each turn: the path still crosses every tile's middle
  if (pts.length < 3) return pts;
  const q = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) { const p = pts[k], a = pts[k - 1], b = pts[k + 1], la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ta = Math.min(0.3, la / 2) / la, tb = Math.min(0.3, lb / 2) / lb, s0 = [p[0] + (a[0] - p[0]) * ta, p[1] + (a[1] - p[1]) * ta], s1 = [p[0] + (b[0] - p[0]) * tb, p[1] + (b[1] - p[1]) * tb];
    q.push(s0, [0.25 * s0[0] + 0.5 * p[0] + 0.25 * s1[0], 0.25 * s0[1] + 0.5 * p[1] + 0.25 * s1[1]], s1); }
  q.push(pts[pts.length - 1]);
  return q;
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
  // the work grid: the smooth layers at <= WORK_MAX px (the full size below that), scaled up at the end when High asks for more
  const NW = Math.min(N, WORK_MAX), pW = NW / Math.max(GW, GH), ww = Math.max(1, Math.round(GW * pW)), wh = Math.max(1, Math.round(GH * pW));
  const wpX = ww / (GW * L), wpY = wh / (GH * L), nw = ww * wh, up = ww !== w || wh !== h;
  const noteRects = E.notes.filter(q => q[0] >= 0 && q[1] >= 0 && q[0] < GW && q[1] < GH).map(q => [q[0] * L, q[1] * L, (q[0] + 1) * L, (q[1] + 1) * L]);
  const dryRects = noteRects.concat(E.boards);             // (no wet on a note's tile, nor under a loose board)
  const tileSpace = P.identities && P.identities.tileSpace, spaces = (P.identities && P.identities.spaces) || [];
  const fpt = (f, u, d) => [f.x0 + (f.x1 - f.x0) * u + f.nx * d, f.z0 + (f.z1 - f.z0) * u + f.nz * d];

  /* distances (work grid): to the walls (per pixel, from its tile's neighbours) and to the boxes (their footprints grown by 0.6 m), in cm */
  // the neighbours of each tile as bits (1 W, 2 E, 4 N, 8 S, 16 NW, 32 NE, 64 SW, 128 SE), and a wall distance (m) from them
  const nb = new Uint8Array(n);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) nb[idx(x, y)] = (isW(x - 1, y) ? 1 : 0) | (isW(x + 1, y) ? 2 : 0) | (isW(x, y - 1) ? 4 : 0) | (isW(x, y + 1) ? 8 : 0)
    | (isW(x - 1, y - 1) ? 16 : 0) | (isW(x + 1, y - 1) ? 32 : 0) | (isW(x - 1, y + 1) ? 64 : 0) | (isW(x + 1, y + 1) ? 128 : 0);
  const EX = [0, 0], wallD = (t, lx, lz) => {             // (EX: the distances to the nearest wall across x and across z)
    const b = nb[t], ex = Math.min(b & 1 ? lx : 9, b & 2 ? L - lx : 9), ez = Math.min(b & 4 ? lz : 9, b & 8 ? L - lz : 9); let d = ex < ez ? ex : ez;
    // (the corner of a wall tile across the diagonal: an outside corner, or a pillar; only within 0.6 m does it matter)
    if (b & 240) { if (b & 16 && lx < d && lz < d) d = Math.min(d, Math.hypot(lx, lz)); if (b & 32 && L - lx < d && lz < d) d = Math.min(d, Math.hypot(L - lx, lz));
      if (b & 64 && lx < d && L - lz < d) d = Math.min(d, Math.hypot(lx, L - lz)); if (b & 128 && L - lx < d && L - lz < d) d = Math.min(d, Math.hypot(L - lx, L - lz)); }
    EX[0] = ex; EX[1] = ez; return d; };
  const wallAt = (x, z) => { const tx = clamp(Math.floor(x / L), 0, GW - 1), ty = clamp(Math.floor(z / L), 0, GH - 1), t = idx(tx, ty); return W[t] ? 0 : wallD(t, x - tx * L, z - ty * L); };
  const colT = new Int32Array(ww), colL = new Float32Array(ww);
  for (let i = 0; i < ww; i++) { const x = (i + 0.5) / wpX; colT[i] = Math.min(GW - 1, Math.floor(x / L)); colL[i] = x - colT[i] * L; }
  // the shade (a linear multiplier): the floor line and inside corners here, box contact below. Under a wall tile it holds the floor
  // line's own value at the wall, so scaling up never darkens the seam by blending in a wall pixel
  const fLut = new Float32Array(256), bLut = new Float32Array(256), shade = new Float32Array(nw);
  for (let c = 0; c < 256; c++) { fLut[c] = cv(ao.floor, c / 100); bLut[c] = cv(ao.boxFloor, c / 100); }
  const dWall = new Uint8Array(nw), dBox = new Uint8Array(nw).fill(255);
  for (let j = 0; j < wh; j++) { const z = (j + 0.5) / wpY, ty = Math.min(GH - 1, Math.floor(z / L)), lz = z - ty * L, row = ty * GW;
    for (let i = 0; i < ww; i++) { const t = row + colT[i], k = j * ww + i;
      if (W[t]) { shade[k] = fLut[0]; continue; }
      const d = wallD(t, colL[i], lz), c = d >= 2.55 ? 255 : Math.round(d * 100);
      dWall[k] = c; shade[k] = fLut[c];
      if (EX[0] < 0.6 && EX[1] < 0.6) shade[k] *= cv(ao.inside, Math.hypot(EX[0], EX[1]));   // (an inside corner: the two walls' AO meet)
    } }
  const boxes = [];                                        // [x0, z0, x1, z1] m: what stands on the floor
  const boxAt = (x, z) => { let d = 9; for (const [x0, z0, x1, z1] of boxes) d = Math.min(d, Math.hypot(x < x0 ? x0 - x : x > x1 ? x - x1 : 0, z < z0 ? z0 - z : z > z1 ? z - z1 : 0)); return d; };
  for (const s of E.solids) boxes.push([s.x0 * UM, s.y0 * UM, s.x1 * UM, s.y1 * UM]);
  for (const c of E.closets) { const back = L / 2 - 0.31, cx = (c[0] + 0.5) * L - c[2] * back, cz = (c[1] + 0.5) * L - c[3] * back, hx = c[2] ? 0.3 : 0.575, hz = c[2] ? 0.575 : 0.3;
    boxes.push([cx - hx, cz - hz, cx + hx, cz + hz]); }
  for (const b of P.band || []) { if ((b.z0 || 0) > 0.15) continue; const f = P.faces[b.face]; if (!f) continue;
    const a = fpt(f, b.u0, 0), c = fpt(f, b.u1, b.depth); boxes.push([Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])]); }
  for (const [x0, z0, x1, z1] of boxes) {
    const i0 = Math.max(0, Math.floor((x0 - 0.6) * wpX)), i1 = Math.min(ww - 1, Math.ceil((x1 + 0.6) * wpX)), j0 = Math.max(0, Math.floor((z0 - 0.6) * wpY)), j1 = Math.min(wh - 1, Math.ceil((z1 + 0.6) * wpY));
    for (let j = j0; j <= j1; j++) { const z = (j + 0.5) / wpY, dz = z < z0 ? z0 - z : z > z1 ? z - z1 : 0, dz2 = dz * dz;
      for (let i = i0; i <= i1; i++) { const x = (i + 0.5) / wpX, dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, d = Math.round(Math.sqrt(dx * dx + dz2) * 100), k = j * ww + i;
        if (d < dBox[k]) dBox[k] = d; } } }
  for (let k = 0; k < nw; k++) if (dBox[k] < 60) shade[k] *= bLut[dBox[k]];

  lap('dist');
  /* B: the paths walked clean, A: their polish; child shoe prints beside some of them, her bare prints to a wardrobe */
  const cut = cutsOf(E), routes = [], pathR = Raster(ww, wh, wpX, wpY), printR = Raster(ww, wh, wpX, wpY), herPrints = [], childPrints = [];
  const sp = E.spawns[0], route = (a, b, val) => { if (!a || !b) return; const p = bfsPathOn(E, cut, a[0], a[1], b[0], b[1]); if (p && p.length) routes.push({ tiles: [a].concat(p), val }); };
  route(sp, E.exit, 1);
  for (const q of E.puzzles) route(sp, q.cell, 1);
  for (let k = 0; k + 1 < E.puzzles.length; k++) route(E.puzzles[k].cell, E.puzzles[k + 1].cell, 1);
  for (const pr of (P.paths && P.paths.pairs) || []) route([pr[0], pr[1]], [pr[2], pr[3]], 0.75);
  routes.forEach((r, k) => { r.poly = polyOf(E, r.tiles, k % 7); const v = Math.round(255 * r.val);
    for (let s = 0; s + 1 < r.poly.length; s++) capsule(pathR, r.poly[s][0], r.poly[s][1], r.poly[s + 1][0], r.poly[s + 1][1], 0.35, v); });
  blur(pathR, Math.max(1, Math.round(0.15 * 0.5 * (wpX + wpY))));
  // the static prints are crisp instances (staticPrints); here only their soft smear in the dust (B), which is all a few px can hold.
  // Placed by exact distances, so the same prints at every resolution; never on a rug or a loose board (they'd be under it)
  const free = (x, z) => !inRects(E.boards, x, z) && !onRugOf(P.rugs || [], x, z);
  // child shoe prints: beside three of the paths (0.5 m off the worn line, so they show in the dust), every 0.7 m
  routes.map((r, k) => [vh(k, 3, 1220), k]).filter(([, k]) => routes[k].val < 1).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 3).forEach(([, k]) => {
    const side = vh(k, 4, 1221) < 0.5 ? -1 : 1;
    // (left, right, left...: 0.35 m apart, so each foot every 0.7 m; never within 0.22 m of a wall or a box)
    along(routes[k].poly, 0.35, 0.2).forEach(([x, z, ux, uz], q) => { const foot = q & 1 ? 1 : -1, off = side * 0.5 + foot * 0.09, px = x - uz * off, pz = z + ux * off;
      if (q >= 48 || wallAt(px, pz) < 0.22 || boxAt(px, pz) < 0.22 || !free(px, pz)) return;
      footprint(printR, px, pz, ux, uz, false, 235, 0.85); childPrints.push([px, pz, ux, uz]); }); });
  // her bare prints: the last six tiles of the way from the exit to one wardrobe, ending at its doors (about 13 m)
  const ht = P.paths ? P.paths.herTrail : -1, hc = E.closets[ht];
  if (hc && E.exit) { const p = bfsPathOn(E, cut, E.exit[0], E.exit[1], hc[0], hc[1]);
    if (p && p.length) { const tiles = [E.exit].concat(p).slice(-7), poly = polyOf(E, tiles, 5), end = poly[poly.length - 1];
      end[0] = (hc[0] + 0.5) * L - hc[2] * 0.35; end[1] = (hc[1] + 0.5) * L - hc[3] * 0.35;
      along(poly, 0.33, 0.1).forEach(([x, z, ux, uz], q) => { const foot = q & 1 ? 1 : -1, px = x - uz * foot * 0.1, pz = z + ux * foot * 0.1;
        if (!free(px, pz)) return;
        footprint(printR, px, pz, ux, uz, true, 245, 1.05); herPrints.push([px, pz, ux, uz]); }); } }
  blur(printR, 1);

  lap('paths');
  /* R: wet patches (the plan's, by sinks and washstands, and the workshop's sinks), never on a note's tile or under a loose board */
  const wetR = Raster(ww, wh, wpX, wpY), wets = (P.wet || []).slice();
  const bandWet = (b, amount) => { const f = P.faces[b.face]; if (!f) return; const q = fpt(f, b.u, b.depth + 0.35);
    wets.push({ kind: 'sink', x: q[0], z: q[1], rx: 0.45, rz: 0.32, rot: Math.atan2(f.nz, f.nx), amount, tile: [f.x, f.y] }); };
  // (a piece's open front: rot r turns it r x 90 degrees, its front +z at rot 0 (layout.js kitSize); 0.3 m out, a little to one side)
  const frontWet = (s, amount, k) => { const th = (s.rot | 0) * PI / 2, fx = Math.round(Math.sin(th)), fz = Math.round(Math.cos(th)), cx = (s.x0 + s.x1) / 2 * UM, cz = (s.y0 + s.y1) / 2 * UM;
    const reach = (fx ? (s.x1 - s.x0) : (s.y1 - s.y0)) / 2 * UM + 0.3, side = (vh(k, 7, 1237) - 0.5) * 0.5, x = cx + fx * reach + fz * side, z = cz + fz * reach - fx * side;
    wets.push({ kind: 'sink', x, z, rx: 0.4, rz: 0.3, rot: Math.atan2(fz, fx) + PI / 2, amount, tile: [Math.floor(x / L), Math.floor(z / L)] }); };
  for (const b of P.band || []) if (/sink|washstand|washtub/.test(b.id || b.node || '')) bandWet(b, 0.5);
  E.solids.forEach((s, k) => { if (/wash|sink/.test(s.id || '')) frontWet(s, 0.45, k); });
  if (style === 'workshop') {                              // (D3's workshop sinks: no sink in the kit, so by the benches and the paint shelves)
    const cand = [];
    E.solids.forEach((s, k) => { if (/workbench|sorting_table/.test(s.id || '')) cand.push([vh(k, 0, 1235), k, s, null]); });
    (P.band || []).forEach((b, k) => { if (/paint_shelf|tool_wall/.test(b.id || b.node || '')) cand.push([vh(k, 1, 1235), k + 100000, null, b]); });
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 1 + (vh(GW, GH, 1236) < 0.5 ? 1 : 0)).forEach(([, k, s, b]) => s ? frontWet(s, 0.5, k) : bandWet(b, 0.5));
  }
  wets.forEach((q, k) => { const tx = q.tile ? q.tile[0] : Math.floor(q.x / L), ty = q.tile ? q.tile[1] : Math.floor(q.z / L);
    const wob = [0.16, vh(tx, ty, 1230) * 6.28, vh(tx, ty, 1231) * 6.28, vh(tx, ty, 1232) * 6.28];
    if (q.kind === 'drain') { ellipse(wetR, q.x, q.z, q.rx, q.rz, 0, Math.round(255 * q.amount), 0.12, false, wob); return; }
    ellipse(wetR, q.x, q.z, q.rx, q.rz, q.rot || 0, Math.round(255 * q.amount), 0.12, false, wob);
    if (q.kind === 'leak') ellipse(wetR, q.x, q.z, q.rx * 0.45, q.rz * 0.45, q.rot, Math.round(255 * Math.min(1, q.amount + 0.25)), 0.08);   // (wettest under the drip)
  });
  maskRects(wetR.a, 1, 0, ww, wh, wpX, wpY, dryRects);

  lap('wet');
  /* G: dust; clumps where the plan drops dust, plaster or rubble */
  const D = P.dust || { base: 0.45, nearWall: 0.4, nearDist: 0.3, noiseKey: 1101 }, clumps = Raster(ww, wh, wpX, wpY);
  for (const q of (P.decalSources && P.decalSources.floor) || []) if (q.kind === 'dust' || q.kind === 'plaster' || q.kind === 'rubble') {
    const tx = Math.floor(q.x / L), ty = Math.floor(q.z / L);
    ellipse(clumps, q.x, q.z, q.size / 2, q.size / 2 * 0.7, q.rot, q.kind === 'dust' ? 110 : 80, q.size * 0.25, true, [0.2, vh(tx, ty, 1240) * 6.28, vh(tx, ty, 1241) * 6.28, 1]); }
  const NC = 1.6, nx = Math.ceil(GW * L / NC) + 2, nz = Math.ceil(GH * L / NC) + 2, lat = new Float32Array(nx * nz);
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) lat[b * nx + a] = vh(a, b, D.noiseKey || 1101);
  const spMul = new Float32Array(n).fill(1);
  if (tileSpace) for (let t = 0; t < n; t++) { const s = spaces[tileSpace[t]]; if (s && s.dustMul) spMul[t] = s.dustMul; }
  const surfW = new Uint8ClampedArray(nw * 4), wear = WEAR[style] ? 0.85 : 0, nd = D.nearDist || 0.3, nwl = D.nearWall || 0.4;
  const nearLut = new Float32Array(256), cAx = new Int32Array(ww), cSx = new Float32Array(ww);   // (per cm of distance; per column of the noise)
  for (let c = 0; c < 256; c++) nearLut[c] = smooth(1 - c / 100 / nd);
  for (let i = 0; i < ww; i++) { const fx = (i + 0.5) / wpX / NC; cAx[i] = Math.floor(fx); cSx[i] = smooth(fx - cAx[i]); }
  for (let j = 0; j < wh; j++) { const z = (j + 0.5) / wpY, row = Math.min(GH - 1, Math.floor(z / L)) * GW, fz = z / NC, bz = Math.floor(fz), sz = smooth(fz - bz), r0 = bz * nx, r1 = r0 + nx;
    for (let i = 0; i < ww; i++) { const k = j * ww + i, ax = cAx[i], sx = cSx[i];
      const n0 = lat[r0 + ax] + (lat[r0 + ax + 1] - lat[r0 + ax]) * sx, n1 = lat[r1 + ax] + (lat[r1 + ax + 1] - lat[r1 + ax]) * sx;
      const noise = n0 + (n1 - n0) * sz, dw = dWall[k], db = dBox[k], wet = wetR.a[k];
      const dust = ((D.base + nwl * nearLut[dw < db ? dw : db]) * spMul[row + colT[i]] * (0.7 + 0.6 * noise) + clumps.a[k] / 255) * (1 - 0.7 / 255 * wet);
      const o = k * 4, pth = pathR.a[k], pr = printR.a[k];
      surfW[o] = wet; surfW[o + 1] = dust * 255 + 0.5; surfW[o + 2] = pth > pr ? pth : pr; surfW[o + 3] = pth * wear + 0.5;
    } }
  // High: scaled up (then the dry rects again, exactly, at the full size)
  const surf = up ? upsample4(surfW, ww, wh, w, h) : surfW;
  if (up) maskRects(surf, 4, 0, w, h, ppmX, ppmY, dryRects);

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
    for (let j = Math.floor((y + 0.25) * L * wpY); j < Math.ceil((y + 0.75) * L * wpY) && j < wh; j++) for (let i = Math.floor((x + 0.25) * L * wpX); i < Math.ceil((x + 0.75) * L * wpX) && i < ww; i++) { sum += pathR.a[j * ww + i]; cnt++; }
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
    const stampOf = floorStamps(style);                     // (Blender's floor decals, multiplied in, when its atlas is loaded)
    for (const q of (P.decalSources && P.decalSources.floor) || []) { const rng = rngOf(hash(Math.round(q.x * 100), Math.round(q.z * 100), 1250 ^ P.seed));
      if (!stampOf || !stampOf(g, q, (rng() * 64) | 0)) floorDecal(g, q, rng); }
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
  // (the canvas colours are sRGB; the shade is linear: decode, multiply, encode)
  const pix = g ? g.getImageData(0, 0, w, h).data : null, [X0, X1, FX] = resTab(w, ww), [Y0, Y1, FY] = resTab(h, wh);
  for (let j = 0; j < h; j++) { const r0 = Y0[j] * ww, r1 = Y1[j] * ww, fy = FY[j];
    for (let i = 0; i < w; i++) { let s;
      if (up) { const fx = FX[i], a = shade[r0 + X0[i]], b = shade[r0 + X1[i]], c = shade[r1 + X0[i]], d = shade[r1 + X1[i]], t = a + (b - a) * fx; s = t + (c + (d - c) * fx - t) * fy; }
      else s = shade[j * ww + i];
      const o = (j * w + i) * 4, s4 = s * 4095 + 0.5;
      if (pix && (pix[o] & pix[o + 1] & pix[o + 2]) !== 255) { alb[o] = ENC[(DEC[pix[o]] * s4) | 0]; alb[o + 1] = ENC[(DEC[pix[o + 1]] * s4) | 0]; alb[o + 2] = ENC[(DEC[pix[o + 2]] * s4) | 0]; }
      else alb[o] = alb[o + 1] = alb[o + 2] = ENC[s4 | 0];
      alb[o + 3] = 255; } }

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
  const decals = wallDecals(E, lv), prints = dustPrints(E, cpuSurf, { child: childPrints, her: herPrints });
  lap('decals');
  Object.assign(stats, { T: TM, w, h, work: [ww, wh], ceil: [cw, chh], routes: routes.length, prints: childPrints.length + herPrints.length, childPrints: childPrints.length, herPrints: herPrints.length,
    wet: wets.length, boxes: boxes.length, decals: decals.quads.length, decalChunks: decals.meshes.length, ms: +(now() - t0).toFixed(1) });
  return Object.assign({}, maps, { maps, cpuSurf, decals, dustPrints: prints.mesh, staticPrints: prints.statics, update: prints.update, routes: routes.map(r => r.tiles), stats,
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
// Blender's floor decals (B11: puddle masks, water and rust rings, scorch, paint, dust clumps) stamped from its atlas, multiplied over
// the floor: -> stamp(g, q, pick) (false when the atlas has none of that kind), or null until Surface.load has the atlas
function floorStamps(style) {
  const A = assets.decals; if (!A || !A.albedo || !A.entries) return null;
  const by = {};
  for (const e of A.entries) for (const k of e.kinds || []) if (!e.styles || e.styles.includes(style)) (by[k] || (by[k] = [])).push(e);
  return (g, q, pick) => {
    const l = by['floor_' + q.kind] || (by.floor && by[q.kind] && by[q.kind].filter(e => by.floor.includes(e))); if (!l || !l.length) return false;
    const [rx, ry, rw, rh] = l[pick % l.length].rect, s = q.size, asp = rw / rh;
    g.save(); g.translate(q.x, q.z); g.rotate(q.rot || 0); g.globalCompositeOperation = 'multiply';
    g.drawImage(A.albedo, rx, ry, rw, rh, -s / 2 * Math.min(1, asp), -s / 2 / Math.max(1, asp), s * Math.min(1, asp), s / Math.max(1, asp));
    g.restore(); return true;
  };
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
// (dust_detail averages about 0.5: MatLib's floor reads dust = G (1 - B) x detail x 1.6, so open floor stays half dusty and the thick
// dust is along the walls and in the halls, as D2 means; a brighter tile buried the boards everywhere but on the paths)
let detailCache = null;
function detailTile() {
  if (detailCache) return detailCache;
  const S = 256, d = new Uint8ClampedArray(S * S * 4);
  const oct = (x, y, f, k) => { const fx = x * f / S, fy = y * f / S, ax = Math.floor(fx), ay = Math.floor(fy), sx = smooth(fx - ax), sy = smooth(fy - ay);
    const v = (a, b) => hash(((a % f) + f) % f, ((b % f) + f) % f, k);
    const a0 = v(ax, ay) + (v(ax + 1, ay) - v(ax, ay)) * sx, a1 = v(ax, ay + 1) + (v(ax + 1, ay + 1) - v(ax, ay + 1)) * sx; return a0 + (a1 - a0) * sy; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dn = oct(x, y, 8, 1501) * 0.5 + oct(x, y, 32, 1502) * 0.3 + oct(x, y, 128, 1503) * 0.2, we = oct(x, y, 6, 1504) * 0.6 + oct(x, y, 24, 1505) * 0.4, o = (y * S + x) * 4;
    d[o] = Math.round(clamp(0.1 + dn * 0.8, 0, 1) * 255); d[o + 1] = Math.round(clamp((we - 0.2) * 1.4, 0, 1) * 255); d[o + 3] = 255;
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
  // (dispose frees only what this made: its geometry, and its own material with the atlas textures it made. MatLib also keeps the
  // level's wall lightmap in that material's userData.disposables; that one stays MatLib's to free, in releaseLevel)
  const own = [];
  const out = { group, meshes, quads, material: null, atlas: null, dispose() {
    for (const m of meshes) m.geometry.dispose();
    for (const t of own.splice(0)) t.dispose();
    if (out.material && out.ownMaterial) out.material.dispose(); } };
  if (group) group.name = 'SurfaceDecals';
  if (!src.length) return out;
  // the wall lightmap atlas cells (uv1): LightBaker's own wallCells when given, else packAtlas (the same cells as bake(), from the faces' h)
  let cells = lv.cells || lv.wallCells || null;
  if (!cells && typeof LightBaker !== 'undefined') { try { cells = LightBaker.packAtlas(F.map(f => ({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, nx: f.nx, nz: f.nz, x: f.x, y: f.y, h: f.h })), ['lo', 'md', 'hi'][tier]).cells; } catch (e) { cells = null; } }
  const at = atlasFor(E, P.style || E.style); if (!at) return out;
  // the atlas the quads' uv0 point into, with a texture factory, so a material handed in through lv.materials.decal can sample it
  // (texture() makes a new texture each call: whoever calls it owns it)
  out.atlas = { W: at.W, H: at.H, source: at.source, data: at.data || null, img: at.img || null, normal: at.normal || null, rect: at.rect,
    texture() {
      if (typeof THREE === 'undefined') return null;
      if (at.data) return typeof MatLib !== 'undefined' ? MatLib.dataTexture(imageOf(at.data, at.W, at.H), { srgb: true }) : Object.assign(new THREE.CanvasTexture(imageOf(at.data, at.W, at.H)), { colorSpace: THREE.SRGBColorSpace });
      const t = new THREE.CanvasTexture(at.img); t.colorSpace = THREE.SRGBColorSpace; return t; },
    normalTexture() { return at.normal && typeof THREE !== 'undefined' ? new THREE.CanvasTexture(at.normal) : null; } };
  const NCX = Math.ceil(GW / CH), bufs = new Map();
  const topAt = (f, u) => { if (!f.hs) return f.h; let j = 0; while (j < 3 && u > FACE_U[j + 1]) j++; const s = (u - FACE_U[j]) / (FACE_U[j + 1] - FACE_U[j]); return f.hs[j] + (f.hs[j + 1] - f.hs[j]) * s; };
  for (const q of src) {
    const f = F[q.face], rect = at.rect(q.kind, q.id | 0); if (!f || !rect) continue;
    // (the decal's width / height: the atlas rect's own when it is Blender's, so nothing is stretched; the procedural one is made from ASPECT)
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), asp = at.source === 'file' && rect[3] > 0 ? rect[2] / rect[3] : ASPECT[q.kind] || 1;
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
    const tex = out.atlas.texture(), ntex = out.atlas.normalTexture();
    if (typeof MatLib !== 'undefined') mat = MatLib.decalMaterial({ map: tex, normalMap: ntex || undefined, tier: ['low', 'medium', 'high'][tier] });
    else mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    own.push(tex); if (ntex) own.push(ntex);
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

/* ---------- prints (D2): the dust prints people leave (ring buffers), and the floor's static ones (crisp instances) ---------- */
// the two soles as alpha maps (64 x 32, white on black: an opaque canvas, read by three's alphaMap from G). Toes to the right (+x)
function soleTex(bare) {
  const c = canvas(64, 32), g = ctx2d(c); if (!g) return null;
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#fff';
  if (!bare) { g.beginPath(); g.ellipse(39, 16, 20, 10, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(10, 16, 8.5, 7.5, 0, 0, 7); g.fill();
    g.fillStyle = '#000'; for (let k = 0; k < 5; k++) g.fillRect(24 + k * 6, 8, 1.5, 16); }     // (tread lines)
  else { g.beginPath(); g.ellipse(38, 16.5, 11, 8.5, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(11, 16, 7.5, 6.5, 0, 0, 7); g.fill();   // (ball, heel)
    g.beginPath(); g.ellipse(24, 19.5, 9, 3.6, 0, 0, 7); g.fill();                                // (the outer edge of the arch)
    for (let t = 0; t < 5; t++) { g.beginPath(); g.arc(53 - Math.abs(t - 0.6) * 1.6, 8.5 + t * 3.9, t ? 2.1 : 3.1, 0, 7); g.fill(); } }   // (toes, the big one first)
  return new THREE.CanvasTexture(c);
}
function dustPrints(E, cpu, statics) {
  const st = new Map(), rugs = E.P.rugs || [], boards = E.boards || [];
  const none = { mesh: null, statics: null, update() { return []; }, dispose() {} };
  if (typeof THREE === 'undefined') return none;
  const texS = soleTex(false), texB = soleTex(true); if (!texS || !texB) return none;
  const geo = new THREE.PlaneGeometry(0.26, 0.11); geo.rotateX(-PI / 2);
  const mats = [], meshes = [];
  const meshOf = (tex, count, name, opacity) => {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, alphaMap: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (typeof MatLib !== 'undefined') MatLib.withLightField(mat);
    mats.push(mat);
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count)); m.count = 0; m.frustumCulled = false; m.name = name; m.renderOrder = 1; meshes.push(m); return m;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const put = (m, i, x, z, ang, k, hex) => { m4.compose(v.set(x, 0.003, z), q.setFromAxisAngle(up, -ang), sc.set(k, 1, k)); m.setMatrixAt(i, m4); m.setColorAt(i, col.setHex(hex)); };
  // the dynamic ones: shoes (player, teammates, a child) in dustPrints, a ring of 200; her bare feet in its child, a ring of 100
  const mesh = meshOf(texS, PRINTS, 'SurfDustPrints', 0.6), bare = meshOf(texB, BARE_PRINTS, 'SurfDustPrintsBare', 0.55);
  for (let i = 0; i < PRINTS; i++) mesh.setColorAt(i, col.setHex(0x4a4741));
  for (let i = 0; i < BARE_PRINTS; i++) bare.setColorAt(i, col.setHex(0x55524b));
  mesh.add(bare);
  // the static ones (build's child shoe prints beside the paths, her bare trail to a wardrobe), placed once, also children of dustPrints
  const sChild = meshOf(texS, statics.child.length, 'SurfChildPrints', 0.5), sHer = meshOf(texB, statics.her.length, 'SurfHerPrints', 0.5);
  statics.child.forEach(([x, z, ux, uz], i) => put(sChild, i, x, z, Math.atan2(uz, ux), 0.85, 0x4a4741));
  statics.her.forEach(([x, z, ux, uz], i) => put(sHer, i, x, z, Math.atan2(uz, ux), 1.05, 0x4d4f58));
  sChild.count = statics.child.length; sHer.count = statics.her.length;
  for (const m of [sChild, sHer]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; mesh.add(m); }
  const heads = new Map([[mesh, 0], [bare, 0]]);
  const stamp = (x, z, ang, kind) => {
    const her = kind === 'her', m = her ? bare : mesh, N = her ? BARE_PRINTS : PRINTS, i = heads.get(m);
    put(m, i, x, z, ang, her ? 1.1 : kind === 'child' ? 0.8 : 1, her ? 0x55524b : 0x4a4741); heads.set(m, (i + 1) % N);
    m.count = Math.min(N, m.count + 1); m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  const stamped = [];                                      // (the last ones, for the tests: [x, z, dust, kind])
  // -> this frame's prints [{id, kind, x, z}]: render.js leaves out its own (wet, blue) print for her where she left a dust print
  const update = (dt, actors) => {
    const out = [];
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
        if (dust > 0.4 && !onRugOf(rugs, px, pz) && !inRects(boards, px, pz)) { stamp(px, pz, s.ang, a.kind); out.push({ id, kind: a.kind, x: px, z: pz });
          stamped.push([px, pz, dust, a.kind]); if (stamped.length > PRINTS) stamped.shift(); } }
    }
    return out;
  };
  mesh.userData.stamped = stamped;
  return { mesh, statics: { child: sChild, her: sHer }, update,
    dispose() { geo.dispose(); texS.dispose(); texB.dispose(); for (const m of mats) m.dispose(); for (const m of meshes) if (m.dispose) m.dispose(); } };
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
  // the spawns, when not handed in (applyFloor keeps no d.spawns): floors.js's rule, tile (2, 2) for a team, else (1, 1). Only the
  // first spawn's tile matters here (where the clean paths start)
  const team = typeof MP !== 'undefined' && MP.on && (MP.n || 1) > 1, sp = o.spawns || [[TU * (team ? 2.5 : 1.5), TU * (team ? 2.5 : 1.5)]];
  return Object.assign({}, env, { decals, spawns: sp, tier: o.tier || (typeof settings !== 'undefined' ? settings.quality : 'low'), plan: o.plan || Dress.plan(env) });
}

/* ---------- Blender's data, when it's there ---------- */
const loading = {};                                       // (one fetch per tier; the atlas in use is the last tier asked for)
let wanted = null;
function load(tier) {
  const t = ['lo', 'md', 'hi'][tierOf(tier)]; wanted = t;
  if (loading[t]) return loading[t].then(r => { if (wanted === t && r) assets.decals = r; return assets; });
  const json = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
  const img = url => new Promise(res => { if (typeof Image === 'undefined') return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  loading[t] = Promise.all([json('textures/light/ao_profiles.json'), json('textures/decals/decals.json')]).then(([ao, dj]) => {
    if (ao) assets.ao = ao;
    if (!dj) return null;
    return Promise.all([img('textures/decals/decals_albedo.' + t + '.webp'), img('textures/decals/decals_normal.' + t + '.webp')]).then(([albedo, normal]) =>
      albedo ? { entries: Array.isArray(dj) ? dj : dj.decals || [], albedo, normal, tier: t } : null);
  });
  return loading[t].then(r => { if (wanted === t && r) assets.decals = r; return assets; });
}

window.Surface = { build, lvFromData, lvFromGame, load, bfsPath: bfsPathOn, vh: vhOf, aoCurves, aoAt: cv, srgb: { DEC, ENC }, assets: () => assets, KINDS };
})();
