/* Escape from Barbi Blue: the light baker (spec C3/C4). Pure functions on typed arrays: no DOM and no THREE inside bake(),
   so the same file can later run in a worker. Every client bakes the same maps from the same floor data.
   It turns the walls, furniture boxes, lamps, windows and the moon of a floor into:
     floorLM, ceilLM    plan lightmaps over the whole floor: RGB steady lamp light (sRGB), A flicker luminance (linear)
     floorAux, ceilAux  R moon (linear), G 0 (reserved for moon bounce), B and A 255
     wallLM, wallAux    one atlas cell per wall face (uv1): wallLM like floorLM; wallAux R moon, G 0, B ambient-occlusion multiply
     lf0, lf1           the light field at 1.1 m for furniture and characters: lf0 RGB steady E (sRGB) + A flicker;
                        lf1 R,G dominant direction x,z (0.5 + 0.5 d), B its up component, A moon (all linear)
     flickId            GW x GH, R = flicker group + 1 (0 = none), for uFlick[] / uFlickCol[]
   Light values are three.js punctual-light irradiance (no pi): a texel stores E / E_MAX (E_MAX = 4) through the sRGB curve,
   so a material's lightMapIntensity = E_MAX * uLampK gives back E. Moon values are stored as E itself (0..1, no E_MAX).

   Usage: const maps = LightBaker.bake(input, 'hi' | 'md' | 'lo');      (also 'high' | 'medium' | 'low')
          const tex = LightBaker.toTextures(THREE, maps);                 (CanvasTexture(new ImageData(...)) per map, flipY = true)
          LightBaker.packAtlas(faces, tier, heights) -> {W, H, ppm, cells}: the wall atlas layout alone (pure; bake() uses the same).
                     heights = LightBaker.faceHeights(input) or the bake input itself; it may be left out only when every face has h,
                     else it throws (a guessed height would give cells that bake() fills differently). Simplest: uv1 from
                     result.wallCells after the bake.
          LightBaker.faceHeights(input, faces?) -> the wall height per face that bake() uses (f.h, else spec A10's rule)
          LightBaker.facesFromGrid(grid, GW, GH, L) -> wall faces in level.js wallGeometry's order and shape
          LightBaker.warm()  builds the tables and runs a tiny bake (~0.1 s), so the first floor's bake doesn't pay for them
   Profiles are converted once per profile object and cached by identity (don't edit a profile's data in place). A bake keeps
   per-lamp scratch rasters between calls (about 0.1 MB per lamp); everything it returns is freshly allocated.
   Occlusion: walls by a grid DDA from each lamp to 8 sub-cells per tile (0.28 m) within 7 m, sampled bilinearly (wall sub-cells
   left out, so floors and walls don't darken at their joint). Tall and low boxes block by the ray's height where it crosses them;
   the ceiling raster ignores low boxes; a point of the light field inside a box (the furniture itself) isn't shaded by that box,
   and a box holding a lamp (a lantern on a trunk, a kiln glow) doesn't shade that lamp. Ceiling height steps shade too: a ray that
   crosses into the next tile above the lower of the two ceilings (through the soffit or step quad between them) is blocked. A
   pinched corner (two open tiles meeting only diagonally) lets no light through the bilinear sample.
   Every map is { w, h, data: Uint8ClampedArray(w*h*4), srgb } with row 0 = grid row 0 (z = 0); with flipY = true the plan uv of a
   point is (x / (GW*L), 1 - z / (GH*L)), the floor plane's own uv.

   input = {
     GW, GH       grid size in tiles (optional when grid is an array of rows)
     grid         walls: Uint8Array(GW*GH) (1 = wall, index y*GW + x), or rows ['0101..'] (d.rows), or [[0,1,..], ..]
     L            tile size in m (default 2.25)
     ceil         flat ceiling height per tile in m: Float32Array(GW*GH) (CEIL), or one number (default 3.0)
     gables       optional gable halls [{tx0, ty0, tx1, ty1, eave, ridge, alongY}] (tiles inclusive; alongY: the ridge runs along grid y)
                  (also [tx0, ty0, tx1, ty1, eave, ridge, alongY]); h = eave + (ridge - eave)(1 - |offset from ridge| / half width)
     solids       [{x0, y0, x1, y1, h, occ}]: a box in GAME UNITS like SOLIDS (1 u = 0.045 m; solidUnits: 'm' for metres), h = top in m,
                  occ 'tall' | 'low' | 'none' (or NAV.occ bits: 1 tall, 2 low). Tall and low boxes block lamp and moon light by the ray's
                  height where it crosses them; 'none' boxes (under 1 m) block nothing (Surface paints their contact shadow).
                  Every box darkens the wall behind it (AO).
     faces        wall faces [{x0, z0, x1, z1, nx, nz, x, y, h}] in m, exactly level.js wallGeometry's records: n points into the open
                  tile (x, y), u runs 0 -> 1 from (x0, z0) to (x1, z1); h = face height in m (optional; else spec A10: the tile's ceiling,
                  or under a gable the highest point of the tile's gable on the face line at u = 0, .14, .5, .86, 1).
                  Omitted: LightBaker.facesFromGrid(). The atlas has one cell per face, in this order (see packAtlas).
     fixtures     [{x, y, z, nx, nz, profile, color, state, k, group}]
                    x, y, z   node origin in m (y up); the light centre = origin + profiles[profile].mount (fixture-local, see below).
                              Without a mount, (x, y, z) is the light centre, and a wall fixture's is kept >= 0.1 m in front of the wall
                              plane behind it. A centre on a tile edge goes 1 mm into an open tile touching it; one inside a wall tile
                              moves out along the front (<= 0.36 m), else the fixture is skipped (stats.skipped, stats.warnings).
                    nx, nz    mount normal = the fixture's front (local +z); 0, 0 for pendants (front = +z)
                    color     linear RGB (default warm 2700 K white); k = intensity (default profile k0, else 2: E ~ 2 at 1 m below)
                    state     'ok' steady | 'flicker' flicker channel | 'glow' practical glow, baked at 40% | 'dead' nothing
                    group     optional flicker group 0..15 (from Dress.plan; null, undefined or -1: assigned here, after the explicit
                              ones, from the ids still free). Lamps of different groups must be >= 14 m apart (their 7 m discs never
                              overlap); a flicker lamp that breaks this, asks for an id outside 0..15, or would be a 17th group is baked
                              as steady light (fixGroup in the result; stats.demoted, stats.badGroup).
     windows      [{face, type, u0, u1, v0, v1, moonlit}]: face = index into faces; the opening runs u0..u1 along the face (0..1) and
                  v0..v1 in height (m); moonlit optional (default: outward normal within 75 deg of the moon's azimuth).
     moon         {az, el, k}: az in radians, the plan direction TOWARD the moon is (sin az, cos az) in (x, z); el = elevation in
                  radians; k = K_moon (default 0.7). Colour is not baked (uMoonCol). Omitted: no moon.
     profiles     optional {id: {w: 64, h: 32, rgb (or data): [r, g, b, ...], mount: [x, y, z], k0}} (a {profiles: {...}} wrapper is fine):
                  an equirect panorama of relative intensity (mean 1) seen from the light centre in fixture-local axes
                  (+z front, +y up, +x right = the face's x0 -> x1 direction for a wall mount). Column i is the longitude
                  atan2(x, z) = (i + 0.5)/w * 2pi - pi (the centre column looks along the front), row j the angle from straight up
                  (j + 0.5)/h * pi (row 0 = up). Mono data (w*h values) is accepted. A missing profile -> isotropic.
     cookies      optional {'<type>_<az>': {w, h, data}} with az -30 | 0 | 30, the moon's azimuth relative to the window's outward normal
                  (positive toward x1, i.e. to the right when looking out). Grey transmittance in window space: column 0 = the u0 side,
                  row 0 = the top of the opening; Uint8 (0..255, 1 or 4 channels) or floats 0..1. '_-30' missing -> '_30' mirrored;
                  a type without cookies -> a soft-edged opening (the trapezoid patch).
     aoProfiles   optional {inside, outside, floor, ceil, skirting, boxFloor, boxWall}: 64 AO multipliers each over 0..0.6 m
                  (ao_profiles.json; a {curves: {...}} wrapper is fine); missing curves use built-in ones
     albedo       optional {floor, wall, ceil}: number or [r, g, b] (the floor's tints the lamp bounce; default 0.3)
     band         optional wall items [{face, u0, u1, h}] standing against a face (AO on the wall around them)
   }
   result = { floorLM, floorAux, ceilLM, ceilAux, wallLM, wallAux, lf0, lf1, flickId,
     wallCells  per face {x, y, w, h, lw, lh, H, u0, v0, su, sv}: uv1 of a face point = (u0 + u*su, v0 + y*sv), u 0..1 along the face, y in m
     fixGroup   Int8Array(fixtures.length): the flicker group each fixture was baked into, -1 = steady / dead / glow
     groups     [{id, lamps: [fixture index], x, z (its first lamp), color (its lamps' k-weighted mean: uFlickCol)}], by id
     moonDir    [x, y, z] the moonlight's travel direction (uMoonDir)    moonlit: [window index]    atlas: {W, H, ppm}
     stats      {ms: {...}, lamp counts (steady, flicker, demoted, badGroup, dead, glow, skipped), warnings: [text] (fixtures not
                baked, bad groups, mixed group colours, solids or windows ignored), sizes} } */
(function () {
'use strict';

const UM = 0.045;                                          // metres per game unit
const E_MAX = 4, REACH = 7, R2 = REACH * REACH, SUB = 8, FIELD_Y = 1.1, K_MOON = 0.7, OCT = 128, LN = 8192, BP = 5;
const TIERS = { hi: { plan: 20, wall: 20, lf: 8 }, md: { plan: 12, wall: 12, lf: 8 }, lo: { plan: 8, wall: 6, lf: 4 } };
const ATLAS = [[512, 512], [1024, 512], [1024, 1024], [2048, 1024], [2048, 2048]];
const WARM = [1, 0.72, 0.45];
const NUDGE = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];   // 1 mm steps off a tile edge (sorted front first)
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tierOf = t => { t = String(t || 'md').toLowerCase(); return { high: 'hi', medium: 'md', low: 'lo' }[t] || (TIERS[t] ? t : 'md'); };
const rgb = (v, d) => v == null ? d.slice() : typeof v === 'number' ? [v, v, v] : [+v[0], +v[1], +v[2]];
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* ---------- tables made once ---------- */
let LUT = null, BN = null;
function srgbLut() {                                       // linear 0..1 -> sRGB byte x 256 (8 fraction bits for the dither; 16 KB stays in cache)
  if (!LUT) { LUT = new Uint16Array(LN); for (let i = 0; i < LN; i++) { const v = i / (LN - 1); LUT[i] = Math.round(65280 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); } }
  return LUT;
}
// 32 x 32 blue noise (void and cluster, Ulichney 1993) as thresholds 0..255 (1/256 LSB): (x*256 + n) >> 8 is a +-0.5 LSB dither that keeps 0 at 0.
// The energy kernel (1 - r^2/R^2)^4 (close to a Gaussian of sigma 1.9) uses only exactly rounded arithmetic, so every browser ranks alike.
function blueNoise() {
  if (BN) return BN;
  const N = 32, n = N * N, G = new Float64Array(n), E = new Float64Array(n), on = new Uint8Array(n), rank = new Int32Array(n);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = Math.min(x, N - x), dy = Math.min(y, N - y), q = 1 - (dx * dx + dy * dy) / 49; G[y * N + x] = q > 0 ? q * q * q * q : 0; }
  const put = (p, s) => { const px = p % N, py = (p / N) | 0; on[p] = s > 0 ? 1 : 0;
    for (let y = 0; y < N; y++) { const gy = ((y - py + N) % N) * N; for (let x = 0; x < N; x++) E[y * N + x] += s * G[gy + (x - px + N) % N]; } };
  const tight = () => { let b = 0, bv = -1; for (let p = 0; p < n; p++) if (on[p] && E[p] > bv) { bv = E[p]; b = p; } return b; };
  const empty = () => { let b = 0, bv = Infinity; for (let p = 0; p < n; p++) if (!on[p] && E[p] < bv) { bv = E[p]; b = p; } return b; };
  let s = 12345; const m = n / 10 | 0;
  for (let k = 0; k < m;) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; const p = (s >>> 8) % n; if (!on[p]) { put(p, 1); k++; } }
  for (let it = 0; it < 4 * n; it++) { const t = tight(); put(t, -1); const v = empty(); put(v, 1); if (v === t) break; }   // relax the start pattern
  const keep = on.slice(), Ek = E.slice();
  for (let r = m - 1; r >= 0; r--) { const t = tight(); put(t, -1); rank[t] = r; }
  on.set(keep); E.set(Ek);
  for (let r = m; r < n; r++) { const v = empty(); put(v, 1); rank[v] = r; }
  BN = new Uint8Array(n); for (let p = 0; p < n; p++) BN[p] = rank[p] * 256 / n | 0;
  return BN;
}

/* ---------- encoders (small top-level functions so the hot loops below get them inlined) ---------- */
// E -> sRGB byte of E / E_MAX, and 0..1 -> linear byte, with a dither n (0..255 = 1/256 steps). Texels are packed little-endian
// (r | g << 8 | b << 16 | a << 24) into a Uint32Array view; bake() swaps the bytes afterwards on a big-endian machine.
const LSC = (LN - 1) / E_MAX, LE = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
function eS(e, n) { const v = e * LSC; return (LUT[v >= LN - 1 ? LN - 1 : (v + 0.5) | 0] + n) >> 8; }
function eL(v, n) { const q = (v * 65280 + n) | 0; return q >= 65280 ? 255 : q <= 0 ? 0 : q >> 8; }
// one tile of a plan lightmap: RGB steady (sRGB), A flicker (linear); the floor's moon (this tile's P x P buffer, if any) into aux
function encPlan(out, acc, P, X0, Y0, W, aux, moon) {
  for (let j = 0; j < P; j++) {
    const Y = Y0 + j, row = Y * W + X0, y0 = (Y & 31) << 5, y1 = ((Y + 7) & 31) << 5;
    for (let i = 0; i < P; i++) {
      const X = X0 + i, o = (j * P + i) << 2, n = BN[y0 | (X & 31)], av = acc[o + 3];
      out[row + i] = eS(acc[o], n) | eS(acc[o + 1], n) << 8 | eS(acc[o + 2], n) << 16 | (av > 0 ? eL(av / E_MAX, BN[y1 | ((X + 21) & 31)]) : 0) << 24;
      if (moon !== null) { const m = moon[j * P + i]; if (m > 0) aux[row + i] = eL(m, BN[y1 | ((X + 21) & 31)]) | 0xffff0000; }
    }
  }
}
// one tile of the light field: lf0 (RGB steady sRGB, A flicker) and lf1 (direction, moon)
function encField(l0, l1, fa, P, X0, Y0, W, moon) {
  for (let j = 0; j < P; j++) {
    const Y = Y0 + j, row = Y * W + X0, y0 = (Y & 31) << 5, y1 = ((Y + 7) & 31) << 5;
    for (let i = 0; i < P; i++) {
      const X = X0 + i, o = (j * P + i) * 7, n0 = BN[y0 | (X & 31)], n1 = BN[y1 | ((X + 21) & 31)];
      l0[row + i] = eS(fa[o], n0) | eS(fa[o + 1], n0) << 8 | eS(fa[o + 2], n0) << 16 | eL(fa[o + 3] / E_MAX, n1) << 24;
      let ax = fa[o + 4], ay = fa[o + 5], az = fa[o + 6]; const al = Math.sqrt(ax * ax + ay * ay + az * az);
      if (al > 1e-9) { ax /= al; ay /= al; az /= al; } else { ax = 0; ay = 1; az = 0; }   // (no lamp: straight up, harmless)
      l1[row + i] = eL(0.5 + 0.5 * ax, n1) | eL(0.5 + 0.5 * az, n0) << 8 | eL(0.5 + 0.5 * ay, n1) << 16 | eL(moon[row + i], n0) << 24;
    }
  }
}
// one wall cell: lamps + the bounce faded up the wall into wallLM; moon (wmoon) and AO into wallAux. The AO is colAO x rowAO x wao
// (boxes, a gable, a sill). Faces without moon or extra AO pass shared zeros / ones, so every argument is always a Float32Array
function encWall(wl, wa, AW, X0, Y0, lw, lh, wacc, wmoon, wao, colB, rowF, colAO, rowAO) {
  for (let j = 0; j < lh; j++) {
    const Y = Y0 + j, row = Y * AW + X0, y0 = (Y & 31) << 5, y1 = ((Y + 7) & 31) << 5, fade = rowF[j], ra = rowAO[j];
    for (let i = 0; i < lw; i++) {
      const X = X0 + i, k = j * lw + i, a = k << 2, n0 = BN[y0 | (X & 31)], n2 = BN[y1 | ((X + 21) & 31)], av = wacc[a + 3], mv = wmoon[k];
      wl[row + i] = eS(wacc[a] + colB[i * 3] * fade, n0) | eS(wacc[a + 1] + colB[i * 3 + 1] * fade, n0) << 8 | eS(wacc[a + 2] + colB[i * 3 + 2] * fade, n0) << 16 | (av > 0 ? eL(av / E_MAX, n2) : 0) << 24;
      wa[row + i] = (mv > 0 ? eL(mv, n2) : 0) | eL(colAO[i] * ra * wao[k], n0) << 16 | -16777216;
    }
  }
}
// the bounce of one tile, bilinear from its coarse grid (rows interpolated once), as the start of the tile's RGBA accumulator
function upsample(bounce, Wb, Hb, tb, tx, tz, Pn, step, buf, bI, bA, bRow) {
  let c0 = 1e9;
  for (let i = 0; i < Pn; i++) { let fx = (tx * Pn + i + 0.5) * step / tb - 0.5; fx = fx < 0 ? 0 : fx > Wb - 1.001 ? Wb - 1.001 : fx; bI[i] = fx | 0; bA[i] = fx - (fx | 0); if (bI[i] < c0) c0 = bI[i]; }
  const nc = Math.min(Wb - 1, bI[Pn - 1] + 1) - c0 + 1;
  for (let j = 0; j < Pn; j++) {
    let fz = (tz * Pn + j + 0.5) * step / tb - 0.5; fz = fz < 0 ? 0 : fz > Hb - 1.001 ? Hb - 1.001 : fz;
    const j0 = fz | 0, b = fz - j0, r0 = (j0 * Wb + c0) * 3, r1 = r0 + Wb * 3;
    for (let q = 0; q < nc * 3; q++) bRow[q] = bounce[r0 + q] * (1 - b) + bounce[r1 + q] * b;
    for (let i = 0; i < Pn; i++) { const k = (bI[i] - c0) * 3, a = bA[i], o = (j * Pn + i) << 2;
      buf[o] = bRow[k] + (bRow[k + 3] - bRow[k]) * a; buf[o + 1] = bRow[k + 1] + (bRow[k + 4] - bRow[k + 1]) * a; buf[o + 2] = bRow[k + 2] + (bRow[k + 5] - bRow[k + 2]) * a; buf[o + 3] = 0; }
  }
}
function swap32(u) { for (let k = 0; k < u.length; k++) { const v = u[k]; u[k] = (v & 255) << 24 | (v >> 8 & 255) << 16 | (v >> 16 & 255) << 8 | v >>> 24; } }

/* ---------- AO curves (ao_profiles.json, or built-in ones) ---------- */
const AO_DEF = { inside: [0.42, 0.11], outside: [0.06, 0.05], floor: [0.32, 0.12], ceil: [0.28, 0.14], skirting: [0.22, 0.05], boxFloor: [0.55, 0.1], boxWall: [0.45, 0.13] };
function aoCurves(src) {
  src = src && src.curves ? src.curves : src || {};
  const out = {};
  for (const k in AO_DEF) {
    let c = src[k]; const t = new Float32Array(64);
    if (c && c.length >= 2) for (let i = 0; i < 64; i++) { const f = i / 63 * (c.length - 1), a = Math.floor(f), b = Math.min(c.length - 1, a + 1); t[i] = c[a] + (c[b] - c[a]) * (f - a); }
    else for (let i = 0; i < 64; i++) t[i] = 1 - AO_DEF[k][0] * Math.exp(-(i / 63 * 0.6) / AO_DEF[k][1]);
    const e = t[63] > 0 ? t[63] : 1;                       // relative to open wall at 0.6 m, so several curves don't dim a whole wall
    for (let i = 0; i < 64; i++) t[i] = Math.min(1, Math.max(0, t[i] / e));
    out[k] = t;
  }
  return out;
}
const cv = (t, d) => { if (d >= 0.6) return 1; if (d <= 0) return t[0]; const f = d / 0.6 * 63, i = f | 0; return t[i] + (t[i + 1] - t[i]) * (f - i); };

/* ---------- fixture profiles: the lat-long table resampled into an octahedral map (no trig per sample) ----------
   128 x 128: at 64 a shade's hard hem edge stair-steps where it grazes a nearby wall. Made once per profile object (OCTS). */
const OCTS = new WeakMap();
function profileData(p) {
  if (!p) return null;
  let d = p.rgb || p.data || p.values || (Array.isArray(p) || ArrayBuffer.isView(p) ? p : null);
  const w = p.w || p.width || 64, h = p.h || p.height || 32;
  if (Array.isArray(d) && Array.isArray(d[0])) d = d.flat(Infinity);
  if (!d || !d.length) return null;
  const ch = d.length >= w * h * 3 ? 3 : d.length >= w * h ? 1 : 0;
  return ch ? { w, h, ch, d: Float32Array.from(d), mount: p.mount || null, k0: p.k0 } : null;
}
// octahedral map, centre = straight down (where floors need detail): local (x, y, z) -> a = x/s, b = z/s, folded when y > 0.
// Where each octahedral texel lands in a w x h lat-long table is the same for every profile of that size (made once: OCTMAP).
const OCTMAP = {};
function octLayout(w, h) {
  const key = w + 'x' + h; if (OCTMAP[key]) return OCTMAP[key];
  const n = OCT * OCT, idx = new Int32Array(n * 4), wt = new Float32Array(n * 4);
  const cell = (i, j) => { i = ((i % w) + w) % w; j = j < 0 ? 0 : j >= h ? h - 1 : j; return j * w + i; };
  for (let jj = 0; jj < OCT; jj++) for (let ii = 0; ii < OCT; ii++) {
    let a = (ii + 0.5) / OCT * 2 - 1, b = (jj + 0.5) / OCT * 2 - 1; const c = 1 - Math.abs(a) - Math.abs(b);
    if (c < 0) { const ta = (1 - Math.abs(b)) * (a < 0 ? -1 : 1); b = (1 - Math.abs(a)) * (b < 0 ? -1 : 1); a = ta; }
    const len = Math.hypot(a, b, c), x = a / len, z = b / len, y = -c / len;
    const fu = (Math.atan2(x, z) + Math.PI) / (2 * Math.PI) * w - 0.5, fv = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI * h - 0.5;
    const i0 = Math.floor(fu), j0 = Math.floor(fv), du = fu - i0, dv = fv - j0, k = (jj * OCT + ii) * 4;
    idx[k] = cell(i0, j0); idx[k + 1] = cell(i0 + 1, j0); idx[k + 2] = cell(i0, j0 + 1); idx[k + 3] = cell(i0 + 1, j0 + 1);
    wt[k] = (1 - du) * (1 - dv); wt[k + 1] = du * (1 - dv); wt[k + 2] = (1 - du) * dv; wt[k + 3] = du * dv;
  }
  return OCTMAP[key] = { idx, wt };
}
function octMap(P) {
  const o = new Float32Array(OCT * OCT * 3), { w, h, ch, d } = P, { idx, wt } = octLayout(w, h);
  for (let t = 0; t < OCT * OCT; t++) {
    const k = t * 4;
    for (let q = 0; q < 3; q++) { const c = ch === 3 ? q : 0;
      o[t * 3 + q] = d[idx[k] * ch + c] * wt[k] + d[idx[k + 1] * ch + c] * wt[k + 1] + d[idx[k + 2] * ch + c] * wt[k + 2] + d[idx[k + 3] * ch + c] * wt[k + 3]; }
  }
  return o;
}
const IO = new Float64Array(3);                            // the last profile lookup (a typed array: doubles in closure slots get boxed)
function look(o, x, y, z) {                                // x, y, z: direction from the light in fixture-local axes, any length
  if (!o) { IO[0] = IO[1] = IO[2] = 1; return; }
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1; let a = x / s, b = z / s;
  if (y > 0) { const t = (1 - Math.abs(b)) * (a < 0 ? -1 : 1); b = (1 - Math.abs(a)) * (b < 0 ? -1 : 1); a = t; }
  let fx = (a + 1) * (OCT / 2) - 0.5, fy = (b + 1) * (OCT / 2) - 0.5;
  fx = fx < 0 ? 0 : fx > OCT - 1.0001 ? OCT - 1.0001 : fx; fy = fy < 0 ? 0 : fy > OCT - 1.0001 ? OCT - 1.0001 : fy;
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = (j * OCT + i) * 3, k2 = k + OCT * 3;
  const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
  IO[0] = o[k] * w00 + o[k + 3] * w10 + o[k2] * w01 + o[k2 + 3] * w11;
  IO[1] = o[k + 1] * w00 + o[k + 4] * w10 + o[k2 + 1] * w01 + o[k2 + 4] * w11;
  IO[2] = o[k + 2] * w00 + o[k + 5] * w10 + o[k2 + 2] * w01 + o[k2 + 5] * w11;
}

/* ---------- geometry helpers ---------- */
// wall faces from the grid, in the same order and shape as level.js wallGeometry
function facesFromGrid(grid, GW, GH, L = 2.25) {
  const W = gridMask(grid, GW, GH), w = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || W[y * GW + x] === 1, out = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (w(x, y)) continue;
    const X0 = x * L, X1 = X0 + L, Z0 = y * L, Z1 = Z0 + L;
    if (w(x, y - 1)) out.push({ x0: X0, z0: Z0, x1: X1, z1: Z0, nx: 0, nz: 1, x, y });
    if (w(x, y + 1)) out.push({ x0: X1, z0: Z1, x1: X0, z1: Z1, nx: 0, nz: -1, x, y });
    if (w(x - 1, y)) out.push({ x0: X0, z0: Z1, x1: X0, z1: Z0, nx: 1, nz: 0, x, y });
    if (w(x + 1, y)) out.push({ x0: X1, z0: Z0, x1: X1, z1: Z1, nx: -1, nz: 0, x, y });
  }
  return out;
}
function gridMask(g, GW, GH) {
  if (g instanceof Uint8Array && g.length === GW * GH && !g.some(v => v > 1)) return g;
  const W = new Uint8Array(GW * GH);
  if (ArrayBuffer.isView(g) || (g.length === GW * GH && typeof g[0] !== 'string' && !Array.isArray(g[0]))) for (let i = 0; i < GW * GH; i++) W[i] = +g[i] ? 1 : 0;
  else for (let y = 0; y < GH; y++) { const r = g[y]; for (let x = 0; x < GW; x++) W[y * GW + x] = (typeof r === 'string' ? r.charCodeAt(x) === 49 : !!+r[x]) ? 1 : 0; }
  return W;
}
// wall atlas: one (len*ppm + 2) x (H*ppm + 2) cell per face (1 px gutter), shelf-packed tallest first into the smallest of
// 512^2, 1024x512, 1024^2, 2048x1024, 2048^2 that fits; if none does, ppm shrinks by 20% and it tries again.
// Pure and deterministic, so arch.js can call it for uv1 before the bake, as long as it gets the heights bake() uses: heights is
// an array (LightBaker.faceHeights(input)) or the bake input itself; without it every face must carry h (else it throws, rather
// than guess a height and hand out cells that bake() fills differently).
function packAtlas(faces, tier, heights) {
  let hs = heights;
  if (hs && !Array.isArray(hs) && !ArrayBuffer.isView(hs)) hs = faceHeights(hs, faces);
  if (!hs) {
    const k = faces.findIndex(f => !(f.h > 0));
    if (k >= 0) throw new Error(`LightBaker.packAtlas: face ${k} has no h; pass heights (LightBaker.faceHeights(input)) or the bake input`);
    hs = faces.map(f => f.h);
  }
  if (hs.length !== faces.length) throw new Error(`LightBaker.packAtlas: ${hs.length} heights for ${faces.length} faces`);
  let ppm = TIERS[tierOf(tier)].wall;
  for (let tries = 0; tries < 8; tries++, ppm *= 0.8) {
    const cells = faces.map((f, i) => { const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), H = hs[i];
      const lw = Math.max(2, Math.round(len * ppm)), lh = Math.max(2, Math.round(H * ppm)); return { i, lw, lh, w: lw + 2, h: lh + 2, H, x: 0, y: 0 }; });
    const order = cells.slice().sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
    for (const [AW, AH] of ATLAS) {
      let x = 0, y = 0, rowH = 0, ok = true;
      for (const c of order) {
        if (x + c.w > AW) { y += rowH; x = 0; rowH = 0; }
        if (c.w > AW || y + c.h > AH) { ok = false; break; }
        c.x = x; c.y = y; x += c.w; if (c.h > rowH) rowH = c.h;
      }
      if (!ok) continue;
      for (const c of cells) { c.u0 = (c.x + 1) / AW; c.su = c.lw / AW; c.v0 = 1 - (c.y + 1 + c.lh) / AH; c.sv = c.lh / c.H / AH; delete c.i; }
      return { W: AW, H: AH, ppm, cells };
    }
  }
  throw new Error('LightBaker: wall atlas does not fit');
}

function prep(inp, faceList) {
  const g = inp.grid; if (!g) throw new Error('LightBaker: input.grid is required');
  const GH = inp.GH || g.length, GW = inp.GW || (g[0] && g[0].length), L = inp.L || 2.25, n = GW * GH;
  const W = gridMask(g, GW, GH);
  const isW = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || W[y * GW + x] === 1;
  const C = new Float32Array(n), c0 = typeof inp.ceil === 'number' ? inp.ceil : 3;
  for (let i = 0; i < n; i++) C[i] = inp.ceil && typeof inp.ceil !== 'number' && inp.ceil[i] > 0 ? inp.ceil[i] : c0;
  const gid = new Int16Array(n).fill(-1), gab = [];
  for (const q0 of inp.gables || []) {
    const q = Array.isArray(q0) ? { tx0: q0[0], ty0: q0[1], tx1: q0[2], ty1: q0[3], eave: q0[4], ridge: q0[5], alongY: q0[6] } : q0, k = gab.length;
    const x0 = q.tx0 * L, x1 = (q.tx1 + 1) * L, z0 = q.ty0 * L, z1 = (q.ty1 + 1) * L, y = !!q.alongY;
    gab.push({ e: q.eave, r: q.ridge, y, c: y ? (x0 + x1) / 2 : (z0 + z1) / 2, hw: y ? (x1 - x0) / 2 : (z1 - z0) / 2 });
    for (let ty = q.ty0; ty <= q.ty1; ty++) for (let tx = q.tx0; tx <= q.tx1; tx++) if (tx >= 0 && ty >= 0 && tx < GW && ty < GH) gid[ty * GW + tx] = k;
  }
  const tileOf = (xm, zm) => { let tx = Math.floor(xm / L), tz = Math.floor(zm / L); tx = tx < 0 ? 0 : tx >= GW ? GW - 1 : tx; tz = tz < 0 ? 0 : tz >= GH ? GH - 1 : tz; return tz * GW + tx; };
  const ceilAt = (xm, zm) => { const t = tileOf(xm, zm), k = gid[t]; return k < 0 ? C[t] : gabH(gab[k], xm, zm); };
  // the ceiling's slope (dh/dx, dh/dz) at a point, for the downward normal (dh/dx, -1, dh/dz) of a gable
  const slope = (xm, zm, out) => { const k = gid[tileOf(xm, zm)]; out[0] = out[1] = 0; if (k < 0) return out; const q = gab[k];
    const o = (q.y ? xm : zm) - q.c, s = Math.abs(o) < q.hw ? -(q.r - q.e) / q.hw * (o < 0 ? -1 : 1) : 0; out[q.y ? 0 : 1] = s; return out; };
  const box = [], allBox = [], f = inp.solidUnits === 'm' ? 1 : UM, bad = [];
  (inp.solids || []).forEach((s, i) => {
    if (!s || ![s.x0, s.y0, s.x1, s.y1].every(Number.isFinite)) { bad.push('solid ' + i + ' has a non-finite corner: ignored'); return; }
    const occ = s.occ === 'tall' || s.occ === 1 ? 1 : s.occ === 'low' || s.occ === 2 ? 2 : typeof s.occ === 'number' ? (s.occ & 1 ? 1 : s.occ & 2 ? 2 : 0) : 0;
    const b = { x0: Math.min(s.x0, s.x1) * f, z0: Math.min(s.y0, s.y1) * f, x1: Math.max(s.x0, s.x1) * f, z1: Math.max(s.y0, s.y1) * f,
      h: Number.isFinite(s.h) && s.h > 0 ? s.h : occ === 1 ? 2 : occ === 2 ? 1.3 : 0.8, occ };
    allBox.push(b); if (occ) box.push(b);
  });
  // the lowest ceiling over each tile (a gable's is its eave): rays that never rise above it need no height-step test
  const Clo = new Float32Array(n); for (let t = 0; t < n; t++) Clo[t] = gid[t] < 0 ? C[t] : Math.min(gab[gid[t]].e, gab[gid[t]].r);
  const faces = (faceList || inp.faces || facesFromGrid(W, GW, GH, L)).map(q => {
    const len = Math.hypot(q.x1 - q.x0, q.z1 - q.z0) || 1e-6, tx = (q.x1 - q.x0) / len, tz = (q.z1 - q.z0) / len;
    let x = q.x, y = q.y;
    if (!(x >= 0 && y >= 0)) { const t = tileOf((q.x0 + q.x1) / 2 + q.nx * 0.01, (q.z0 + q.z1) / 2 + q.nz * 0.01); x = t % GW; y = (t / GW) | 0; }
    // height (spec A10): f.h if given; else a flat face takes its tile's ceiling, and a gable face the highest point of its
    // tile's gable on the face line at u = 0, .14, .5, .86, 1 (the gable is the face's own tile's, so no rounding at tile edges)
    let H = q.h;
    if (!(H > 0)) { const t = y * GW + x, k = gid[t]; if (k < 0) H = C[t]; else { H = 0; for (const u of FACE_U) H = Math.max(H, gabH(gab[k], q.x0 + (q.x1 - q.x0) * u, q.z0 + (q.z1 - q.z0) * u)); } }
    return { x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1, nx: q.nx, nz: q.nz, x, y, len, tx, tz, H, gable: gid[y * GW + x] >= 0 };
  });
  return { GW, GH, L, W, isW, C, Clo, gid, gab, ceilAt, slope, tileOf, box, allBox, faces, bad };
}
const FACE_U = [0, 0.14, 0.5, 0.86, 1];
// a gable's ceiling at (xm, zm): h = eave + (ridge - eave)(1 - |offset from the ridge| / half width)
const gabH = (q, xm, zm) => q.e + (q.r - q.e) * Math.max(0, 1 - Math.abs((q.y ? xm : zm) - q.c) / q.hw);
// the ceiling of tile t at a point on or in it (flat, or its gable's slope)
const ceilT = (B, t, xm, zm) => { const k = B.gid[t]; return k < 0 ? B.C[t] : gabH(B.gab[k], xm, zm); };
// the face heights bake() uses for the atlas (one per face of input.faces, or of faceList, or of facesFromGrid): give them to
// packAtlas when building uv1 before the bake
function faceHeights(input, faceList) { return prep(input, faceList).faces.map(f => f.H); }

// grid DDA (Amanatides and Woo) in tile units: true if the segment crosses no wall tile (both end tiles included)
function clear(W, GW, x0, z0, x1, z1) {
  let tx = Math.floor(x0), tz = Math.floor(z0);
  const ex = Math.floor(x1), ez = Math.floor(z1), dx = x1 - x0, dz = z1 - z0;
  if (W[tz * GW + tx]) return false;
  let n = Math.abs(ex - tx) + Math.abs(ez - tz);
  if (!n) return true;
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, adx = Math.abs(dx), adz = Math.abs(dz);
  let mx = adx < 1e-12 ? Infinity : (dx > 0 ? tx + 1 - x0 : x0 - tx) / adx, mz = adz < 1e-12 ? Infinity : (dz > 0 ? tz + 1 - z0 : z0 - tz) / adz;
  const ddx = adx < 1e-12 ? Infinity : 1 / adx, ddz = adz < 1e-12 ? Infinity : 1 / adz;
  while (n-- > 0) {
    if (mx < mz) { mx += ddx; tx += sx; } else { mz += ddz; tz += sz; }
    if (W[tz * GW + tx]) return false;
  }
  return true;
}
// the same walk, also testing ceiling height steps: a ray that crosses from one tile into the next above the lower of their two
// ceilings goes through the soffit or step quad between them (a low corridor's lamp can't light the high hall ceiling behind the
// step). One walk tests a sub-cell's floor (bit 1, down to 0), field (2, to 1.1 m) and ceiling (4, to hc) rays from the lamp at
// height h0 and returns the bits that get through (0 when a wall tile is in the way). x, z in tile units. Under one gable no ray
// is stopped: the space under a ridge roof is convex.
function clearH(B, x0, z0, h0, x1, z1, hc) {
  const W = B.W, GW = B.GW, L = B.L;
  let tx = Math.floor(x0), tz = Math.floor(z0), t = tz * GW + tx, bits = 7;
  const ex = Math.floor(x1), ez = Math.floor(z1), dx = x1 - x0, dz = z1 - z0;
  if (W[t]) return 0;
  let n = Math.abs(ex - tx) + Math.abs(ez - tz);
  if (!n) return 7;
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, adx = Math.abs(dx), adz = Math.abs(dz);
  let mx = adx < 1e-12 ? Infinity : (dx > 0 ? tx + 1 - x0 : x0 - tx) / adx, mz = adz < 1e-12 ? Infinity : (dz > 0 ? tz + 1 - z0 : z0 - tz) / adz;
  const ddx = adx < 1e-12 ? Infinity : 1 / adx, ddz = adz < 1e-12 ? Infinity : 1 / adz;
  while (n-- > 0) {
    let s;
    if (mx < mz) { s = mx; mx += ddx; tx += sx; } else { s = mz; mz += ddz; tz += sz; }
    const t2 = tz * GW + tx; if (W[t2]) return 0;
    const px = (x0 + dx * s) * L, pz = (z0 + dz * s) * L, ca = ceilT(B, t, px, pz), cb = ceilT(B, t2, px, pz), cm = (ca < cb ? ca : cb) + 1e-4;
    if (h0 * (1 - s) > cm) bits &= ~1;
    if (h0 + (FIELD_Y - h0) * s > cm) bits &= ~2;
    if (h0 + (hc - h0) * s > cm) bits &= ~4;
    if (!bits) return 0;
    t = t2;
  }
  return bits;
}
// does a box block the segment (ax, az, height ha) -> (bx, bz, height hb)? The ray's height where it crosses the box footprint
// against the box top (the lowest point of a straight ray over an interval is at one of its ends)
function boxBlocks(b, ax, az, ha, bx, bz, hb) {
  const dx = bx - ax, dz = bz - az; let t0 = 0, t1 = 1;
  if (dx > 1e-9 || dx < -1e-9) { let p = (b.x0 - ax) / dx, q = (b.x1 - ax) / dx; if (p > q) { const t = p; p = q; q = t; } if (p > t0) t0 = p; if (q < t1) t1 = q; }
  else if (ax <= b.x0 || ax >= b.x1) return false;
  if (dz > 1e-9 || dz < -1e-9) { let p = (b.z0 - az) / dz, q = (b.z1 - az) / dz; if (p > q) { const t = p; p = q; q = t; } if (p > t0) t0 = p; if (q < t1) t1 = q; }
  else if (az <= b.z0 || az >= b.z1) return false;
  if (t0 >= t1) return false;
  return Math.min(ha + (hb - ha) * t0, ha + (hb - ha) * t1) < b.h;
}

// a lamp's raster arrays, kept between bakes (one set per lamp slot, zeroed for reuse) so a bake doesn't feed the garbage collector
const POOL = [];
function rasterPool(i, N) {
  let p = POOL[i];
  if (!p || p.N !== N) POOL[i] = p = { N, vis: new Uint8Array(N * N), vF: new Float32Array(N * N * 3), vD: new Float32Array(N * N * 3), vC: new Float32Array(N * N * 3) };
  else { p.vis.fill(0); p.vF.fill(0); p.vD.fill(0); p.vC.fill(0); }
  return p;
}
/* ---------- per lamp: visibility raster (8 sub-cells per tile within 7 m) and profile intensity toward each sub-cell ---------- */
// vis bits: 1 floor receiver, 2 field (1.1 m), 4 ceiling; 128 = sub-cell inside a wall tile (left out of the bilinear sample)
function rasterize(lp, B) {
  const { L, GW, GH, W } = B, s = L / SUB, R = Math.ceil(REACH / s) + 1, N = 2 * R + 1;
  const gi0 = Math.floor(lp.x / s) - R, gj0 = Math.floor(lp.z / s) - R, ox = gi0 * s, oz = gj0 * s, ext = N * s;
  const pool = rasterPool(lp.li, N), vis = pool.vis, lim = (REACH + s) * (REACH + s), X0 = lp.x / L, Z0 = lp.z / L, hL = lp.y;
  // boxes that can block this lamp; a box holding the lamp (a lantern on a trunk, a glow in a kiln) doesn't shade its own light
  const bx = B.box.filter(b => b.x1 > ox && b.x0 < ox + ext && b.z1 > oz && b.z0 < oz + ext &&
    !(lp.x > b.x0 - 0.05 && lp.x < b.x1 + 0.05 && lp.z > b.z0 - 0.05 && lp.z < b.z1 + 0.05));
  // the lowest ceiling within reach: a ray that never rises above it can't meet a height step, so only the others take clearH
  let cmin = Infinity;
  for (let tz = Math.max(0, Math.floor(gj0 / SUB)); tz <= Math.min(GH - 1, Math.floor((gj0 + N - 1) / SUB)); tz++)
    for (let tx = Math.max(0, Math.floor(gi0 / SUB)); tx <= Math.min(GW - 1, Math.floor((gi0 + N - 1) / SUB)); tx++) { const t = tz * GW + tx; if (!W[t] && B.Clo[t] < cmin) cmin = B.Clo[t]; }
  cmin += 1e-4;
  for (let j = 0; j < N; j++) {
    const gj = gj0 + j, tz = Math.floor(gj / SUB), cz = (gj + 0.5) * s, dz = cz - lp.z;
    for (let i = 0; i < N; i++) {
      const gi = gi0 + i, tx = Math.floor(gi / SUB), k = j * N + i;
      if (tx < 0 || tz < 0 || tx >= GW || tz >= GH || W[tz * GW + tx]) { vis[k] = 128; continue; }
      const cx = (gi + 0.5) * s, dx = cx - lp.x;
      if (dx * dx + dz * dz > lim) continue;
      const hc = B.ceilAt(cx, cz);
      let bits = hL > cmin || hc > cmin || FIELD_Y > cmin ? clearH(B, X0, Z0, hL, cx / L, cz / L, hc) : clear(W, GW, X0, Z0, cx / L, cz / L) ? 7 : 0;
      for (let q = 0; q < bx.length && bits; q++) {
        const b = bx[q];
        if ((bits & 1) && boxBlocks(b, lp.x, lp.z, hL, cx, cz, 0)) bits &= ~1;
        // a field point inside a box is that furniture itself: its own box doesn't shade it (the shader's wrap term does)
        if ((bits & 2) && !(cx > b.x0 && cx < b.x1 && cz > b.z0 && cz < b.z1) && boxBlocks(b, lp.x, lp.z, hL, cx, cz, FIELD_Y)) bits &= ~2;
        if ((bits & 4) && b.occ === 1 && boxBlocks(b, lp.x, lp.z, hL, cx, cz, hc)) bits &= ~4;   // (the ceiling ignores low boxes)
      }
      vis[k] = bits;
    }
  }
  // V * profile * k * colour per sub-cell and receiver height (flicker lamps: luminance only, in the first slot)
  const vF = pool.vF, vD = pool.vD, vC = pool.vC, o = lp.oct;
  const cr = lp.k * lp.col[0], cg = lp.k * lp.col[1], cb = lp.k * lp.col[2], fl = lp.grp >= 0;
  const put = (v, q) => { if (fl) v[q] = lp.k * lum(IO[0], IO[1], IO[2]); else { v[q] = IO[0] * cr; v[q + 1] = IO[1] * cg; v[q + 2] = IO[2] * cb; } };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, bits = vis[k]; if (!bits || bits & 128) continue;
    const cx = ox + (i + 0.5) * s, cz = oz + (j + 0.5) * s, dx = cx - lp.x, dz = cz - lp.z;
    const xl = dx * lp.fz - dz * lp.fx, zl = dx * lp.fx + dz * lp.fz;
    if (bits & 1) { look(o, xl, -hL, zl); put(vF, k * 3); }
    if (bits & 2) { look(o, xl, FIELD_Y - hL, zl); put(vD, k * 3); }
    if (bits & 4) { look(o, xl, B.ceilAt(cx, cz) - hL, zl); put(vC, k * 3); }
  }
  return { vis, N, ox, oz, s, inv: 1 / s, gi0, gj0, vF, vD, vC };
}

// masked bilinear sample of a lamp raster at plan point (x, z): returns the first corner's index (-1 outside) and leaves the
// corner weights in SM[0..3] (0 for sub-cells inside wall tiles) and their sum in SM[4].
// A pinched corner (two open tiles touching only diagonally, both tiles beside them walls) leaves exactly the two diagonal
// sub-cells of the 2 x 2 open: the one across the pinch is dropped too, or light would seep through the corner. The point's own
// sub-cell is the one on its side of the footprint's centre (a + b < 1, or a > b).
const SM = new Float64Array(5);
function sample(r, x, z) {
  const fx = (x - r.ox) * r.inv - 0.5, fz = (z - r.oz) * r.inv - 0.5, i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, N = r.N, v = r.vis;
  if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) { SM[4] = 0; return -1; }
  const k = j * N + i, m = (v[k] & 128 ? 1 : 0) | (v[k + 1] & 128 ? 2 : 0) | (v[k + N] & 128 ? 4 : 0) | (v[k + N + 1] & 128 ? 8 : 0);
  let w00 = m & 1 ? 0 : (1 - a) * (1 - b), w10 = m & 2 ? 0 : a * (1 - b), w01 = m & 4 ? 0 : (1 - a) * b, w11 = m & 8 ? 0 : a * b;
  if (m === 6) { if (a + b < 1) w11 = 0; else w00 = 0; } else if (m === 9) { if (a > b) w01 = 0; else w10 = 0; }
  SM[0] = w00; SM[1] = w10; SM[2] = w01; SM[3] = w11; SM[4] = w00 + w10 + w01 + w11;
  return k;
}

// one lamp onto one wall cell (lw x lh texels): visibility from the lamp's floor / field / ceiling rasters at each column's floor
// point 2 cm into the room, blended by height (floor below 1.1 m, field at 1.1 m, ceiling at the top); E = k I cos / d^2 * window * V
function wallLamp(lp, f, lw, lh, rowY, colH, wacc) {
  const r = lp.r, vis = r.vis, N = r.N, fl = lp.grp >= 0, o = lp.oct, kk = lp.k, cr = kk * lp.col[0], cg = kk * lp.col[1], cb = kk * lp.col[2];
  const dX = f.x1 - f.x0, dZ = f.z1 - f.z0, nx = f.nx, nz = f.nz, ly = lp.y;
  let cnt = 0;
  for (let i = 0; i < lw; i++) {
    const u = (i + 0.5) / lw, wx = f.x0 + dX * u, wz = f.z0 + dZ * u, dxp = lp.x - wx, dzp = lp.z - wz, dp2 = dxp * dxp + dzp * dzp;
    if (dp2 >= R2) continue;
    const ndot = dxp * nx + dzp * nz; if (ndot <= 0) continue;
    const K00 = sample(r, wx + nx * 0.02, wz + nz * 0.02), SW = SM[4]; if (SW <= 0) continue;
    const W00 = SM[0], W10 = SM[1], W01 = SM[2], W11 = SM[3], v00 = vis[K00], v10 = vis[K00 + 1], v01 = vis[K00 + N], v11 = vis[K00 + N + 1];
    const vf = ((v00 & 1) * W00 + (v10 & 1) * W10 + (v01 & 1) * W01 + (v11 & 1) * W11) / SW;
    const vd = ((v00 >> 1 & 1) * W00 + (v10 >> 1 & 1) * W10 + (v01 >> 1 & 1) * W01 + (v11 >> 1 & 1) * W11) / SW;
    const vc = ((v00 >> 2 & 1) * W00 + (v10 >> 2 & 1) * W10 + (v01 >> 2 & 1) * W01 + (v11 >> 2 & 1) * W11) / SW;
    if (vf + vd + vc <= 0) continue;
    const up = 1 / Math.max(0.1, colH[i] - FIELD_Y), xl0 = -dxp * lp.fz + dzp * lp.fx, zl0 = -dxp * lp.fx - dzp * lp.fz;
    for (let j = 0; j < lh; j++) {
      const y = rowY[j], dy = ly - y, d2 = dp2 + dy * dy; if (d2 >= R2) continue;
      const V = y <= FIELD_Y ? vf + (vd - vf) * (y / FIELD_Y) : vd + (vc - vd) * Math.min(1, (y - FIELD_Y) * up);
      if (V <= 0) continue;
      look(o, xl0, -dy, zl0);
      const q = d2 * (1 / R2), w = 1 - q * q, G = ndot * w * w * V / (Math.sqrt(d2) * (d2 > 0.01 ? d2 : 0.01)), a = (j * lw + i) * 4;
      if (fl) wacc[a + 3] += G * kk * (0.2126 * IO[0] + 0.7152 * IO[1] + 0.0722 * IO[2]);
      else { wacc[a] += G * IO[0] * cr; wacc[a + 1] += G * IO[1] * cg; wacc[a + 2] += G * IO[2] * cb; }
      cnt++;
    }
  }
  return cnt;
}

/* ---------- the bake ---------- */
function bake(input, tier) {
  const T = { start: now() }, tk = tierOf(tier), TI = TIERS[tk], ms = {};
  const lap = name => { const t = now(); ms[name] = +(t - T.last).toFixed(2); T.last = t; };
  T.last = T.start;
  const B = prep(input), { GW, GH, L, W, isW, faces } = B; srgbLut(); blueNoise();
  const ao = aoCurves(input.aoProfiles), alb = input.albedo || {}, rho = rgb(alb.floor, [0.3, 0.3, 0.3]);

  // profiles (lat-long -> octahedral, once per id)
  const pin = input.profiles && input.profiles.profiles ? input.profiles.profiles : input.profiles || {}, prof = {};
  const getProf = id => {
    if (id == null) return null;
    if (!(id in prof)) {
      const src = pin[id], p = src && typeof src === 'object' ? OCTS.get(src) || profileData(src) : null;
      if (p && !p.oct) { p.oct = octMap(p); p.d = null; if (src) OCTS.set(src, p); }
      prof[id] = p ? { oct: p.oct, mount: p.mount, k0: p.k0 } : null;
    }
    return prof[id];
  };

  // lamps: light centre, axes, strength. Nothing is dropped silently: a fixture that can't be baked is counted in stats.skipped
  // and named in stats.warnings.
  const fx = input.fixtures || [], fixGroup = new Int8Array(fx.length).fill(-1), lamps = [], warn = B.bad.slice();
  const counts = { dead: 0, glow: 0, steady: 0, flicker: 0, demoted: 0, badGroup: 0, skipped: 0 };
  const skip = (i, why) => { counts.skipped++; warn.push(`fixture ${i} ${why}: not baked`); };
  const openAt = (x, z) => !isW(Math.floor(x / L), Math.floor(z / L));
  fx.forEach((f, i) => {
    if (!f) { skip(i, 'is empty'); return; }
    if (f.state === 'dead') { counts.dead++; return; }
    if (![f.x, f.y, f.z].every(Number.isFinite)) { skip(i, 'has a non-finite position'); return; }
    const P = getProf(f.profile), mt = P && P.mount && [0, 1, 2].every(q => Number.isFinite(P.mount[q])) ? P.mount : null;
    let ax = Number.isFinite(f.nx) ? f.nx : 0, az = Number.isFinite(f.nz) ? f.nz : 0; const nl = Math.hypot(ax, az), onWall = nl >= 1e-6;
    if (onWall) { ax /= nl; az /= nl; } else { ax = 0; az = 1; }
    let x = f.x, y = f.y, z = f.z;
    if (mt) { x += mt[0] * az + mt[2] * ax; y += mt[1]; z += -mt[0] * ax + mt[2] * az; }
    else if (onWall && (Math.abs(ax) > 0.999 || Math.abs(az) > 0.999)) {
      // no mount offset (no profile yet): a wall fixture's centre stays >= 0.1 m in front of the wall plane behind it, whichever
      // way it faces (on the plane itself it would light its own wall with nothing, or with E_MAX when rounded 3 cm out)
      const ix = Math.abs(ax) > 0.999, s = (ix ? ax : az) > 0 ? 1 : -1, p = ix ? x : z, b = Math.round(p / L), o = Math.floor((ix ? z : x) / L);
      const wallAt = q => ix ? isW(q, o) : isW(o, q);
      if (wallAt(s > 0 ? b - 1 : b) && !wallAt(s > 0 ? b : b - 1) && (p - b * L) * s < 0.1) { if (ix) x = b * L + 0.1 * s; else z = b * L + 0.1 * s; }
    }
    // the centre must lie inside an open tile, where its DDA starts: one on a tile edge or corner (a pendant over a pillar's
    // corner) goes 1 mm into an open tile touching it, in front first; one inside a wall (a mount rounding into it) moves out
    // along the front
    if (!openAt(x, z)) {
      const d = NUDGE.slice().sort((p, q) => (q[0] * ax + q[1] * az) - (p[0] * ax + p[1] * az)).find(([dx, dz]) => openAt(x + dx * 1e-3, z + dz * 1e-3));
      if (d) { x += d[0] * 1e-3; z += d[1] * 1e-3; }
      for (let k = 0; k < 12 && !openAt(x, z); k++) { x += ax * 0.03; z += az * 0.03; }
    }
    if (!openAt(x, z)) { skip(i, `has its light centre inside a wall tile (${x.toFixed(2)}, ${z.toFixed(2)})`); return; }
    if (!(y > 0)) { skip(i, 'has its light centre at or below the floor'); return; }
    if (f.state === 'glow') counts.glow++;
    const k = (Number.isFinite(f.k) && f.k > 0 ? f.k : P && P.k0 > 0 ? P.k0 : 2) * (f.state === 'glow' ? 0.4 : 1);
    let col = rgb(f.color, WARM); if (!col.every(Number.isFinite)) col = WARM.slice();
    lamps.push({ i, x, y, z, fx: ax, fz: az, oct: P ? P.oct : null, k, col, flick: f.state === 'flicker', want: f.group, grp: -1 });
  });
  // flicker groups (<= 16; lamps of different groups >= 14 m apart, so their 7 m discs never overlap). Explicit groups (Dress.plan's)
  // are placed first, so an auto-assigned lamp can't take an id a later fixture asks for. A group that isn't an integer 0..15
  // (null, undefined and -1 mean auto) or that breaks the 14 m rule makes its lamp steady (stats.demoted; stats.badGroup for a bad id).
  const groups = [], used = new Set(), D14 = 14 * 14, isAuto = w => w == null || w === -1;
  const nearG = l => lamps.filter(o => o !== l && o.grp >= 0 && (o.x - l.x) ** 2 + (o.z - l.z) ** 2 < D14);
  const join = (l, g) => { l.grp = g; used.add(g); fixGroup[l.i] = g; let G = groups.find(q => q.id === g); if (!G) groups.push(G = { id: g, lamps: [], x: l.x, z: l.z, color: null }); G.lamps.push(l.i); };
  const demote = l => { l.flick = false; counts.demoted++; };
  for (const l of lamps) if (l.flick && !isAuto(l.want)) {
    if (!(Number.isInteger(l.want) && l.want >= 0 && l.want < 16)) { demote(l); counts.badGroup++; warn.push(`fixture ${l.i}: flicker group ${l.want} is not an integer 0..15, baked steady`); continue; }
    if (nearG(l).every(o => o.grp === l.want)) join(l, l.want); else demote(l);
  }
  for (const l of lamps) if (l.flick && isAuto(l.want)) {
    const nb = nearG(l); let g = -1;
    if (!nb.length) { for (let q = 0; q < 16; q++) if (!used.has(q)) { g = q; break; } }
    else if (nb.every(o => o.grp === nb[0].grp && (o.x - l.x) ** 2 + (o.z - l.z) ** 2 < 1)) g = nb[0].grp;   // (a second candle of one sconce)
    if (g < 0) demote(l); else join(l, g);
  }
  groups.sort((a, b) => a.id - b.id);
  // the flicker channel holds luminance and the shader tints it with uFlickCol[group]: a group's colour is its lamps' k-weighted mean
  for (const G of groups) {
    const ls = lamps.filter(l => l.grp === G.id), c = [0, 0, 0]; let kw = 0;
    for (const l of ls) { for (let q = 0; q < 3; q++) c[q] += l.k * l.col[q]; kw += l.k; }
    G.color = c.map(v => v / kw);
    if (ls.some(l => l.col.some((v, q) => Math.abs(v - ls[0].col[q]) > 0.02))) warn.push(`flicker group ${G.id} mixes lamp colours: uFlickCol gets their k-weighted mean`);
  }
  for (const l of lamps) if (l.grp >= 0) counts.flicker++; else counts.steady++;
  // flickId: each open tile belongs to the group of the nearest grouped lamp whose 7 m disc can reach it
  const n = GW * GH, fg = new Uint8Array(n), gl = lamps.filter(l => l.grp >= 0), reachT = (REACH + L * 0.7072) ** 2;
  for (let t = 0; t < n; t++) {
    if (W[t]) continue;
    const cx = (t % GW + 0.5) * L, cz = ((t / GW | 0) + 0.5) * L; let bd = reachT, bg = -1;
    for (const l of gl) { const d = (l.x - cx) ** 2 + (l.z - cz) ** 2; if (d < bd) { bd = d; bg = l.grp; } }
    fg[t] = bg + 1;
  }
  lap('prep');

  // visibility rasters, then per tile the lamps that see any of it
  const tl = Array.from({ length: n }, () => []);
  lamps.forEach((lp, li) => {
    lp.li = li; const r = lp.r = rasterize(lp, B), N = r.N;
    const tx0 = Math.max(0, Math.floor(r.gi0 / SUB)), tx1 = Math.min(GW - 1, Math.floor((r.gi0 + N - 1) / SUB));
    const tz0 = Math.max(0, Math.floor(r.gj0 / SUB)), tz1 = Math.min(GH - 1, Math.floor((r.gj0 + N - 1) / SUB));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = tz * GW + tx; if (W[t]) continue;
      const nx = Math.max(tx * L, Math.min(lp.x, (tx + 1) * L)) - lp.x, nz = Math.max(tz * L, Math.min(lp.z, (tz + 1) * L)) - lp.z;
      if (nx * nx + nz * nz >= R2) continue;
      let bits = 0;
      const i0 = Math.max(0, tx * SUB - r.gi0 - 1), i1 = Math.min(N - 1, tx * SUB - r.gi0 + SUB), j0 = Math.max(0, tz * SUB - r.gj0 - 1), j1 = Math.min(N - 1, tz * SUB - r.gj0 + SUB);
      for (let j = j0; j <= j1 && bits !== 7; j++) for (let i = i0; i <= i1; i++) { const v = r.vis[j * N + i]; if (!(v & 128)) bits |= v; }
      if (bits) tl[t].push(li << 3 | bits);
    }
  });
  lap('rasters');

  // lamp bounce: steady floor light on a coarse grid (BP per tile), blurred (sigma 1 m) without crossing walls, x 0.35 x floor albedo
  const Wb = GW * BP, Hb = GH * BP, tb = L / BP, Eb = new Float32Array(Wb * Hb * 3), openB = new Uint8Array(Wb * Hb);
  for (let t = 0; t < n; t++) {
    if (W[t]) continue;
    const tx = t % GW, tz = t / GW | 0;
    for (let j = 0; j < BP; j++) for (let i = 0; i < BP; i++) openB[(tz * BP + j) * Wb + tx * BP + i] = 1;
    for (const e of tl[t]) {
      if (!(e & 1)) continue; const lp = lamps[e >> 3]; if (lp.grp >= 0) continue;
      const r = lp.r, V = r.vF;
      for (let j = 0; j < BP; j++) {
        const pz = (tz * BP + j + 0.5) * tb, dz = lp.z - pz;
        for (let i = 0; i < BP; i++) {
          const px = (tx * BP + i + 0.5) * tb, dx = lp.x - px, d2 = dx * dx + dz * dz + lp.y * lp.y; if (d2 >= R2) continue;
          const k0 = sample(r, px, pz), SW = SM[4]; if (SW <= 0) continue;
          const W00 = SM[0], W10 = SM[1], W01 = SM[2], W11 = SM[3];
          const q = d2 / R2, w = 1 - q * q, G = lp.y / Math.sqrt(d2) * w * w / Math.max(d2, 0.01) / SW, k = k0 * 3, k2 = k + r.N * 3, o = ((tz * BP + j) * Wb + tx * BP + i) * 3;
          Eb[o] += G * (W00 * V[k] + W10 * V[k + 3] + W01 * V[k2] + W11 * V[k2 + 3]);
          Eb[o + 1] += G * (W00 * V[k + 1] + W10 * V[k + 4] + W01 * V[k2 + 1] + W11 * V[k2 + 4]);
          Eb[o + 2] += G * (W00 * V[k + 2] + W10 * V[k + 5] + W01 * V[k2 + 2] + W11 * V[k2 + 5]);
        }
      }
    }
  }
  const bounce = blurBarrier(Eb, openB, Wb, Hb, 1 / tb);
  for (let k = 0; k < Wb * Hb; k++) { bounce[k * 3] *= 0.35 * rho[0]; bounce[k * 3 + 1] *= 0.35 * rho[1]; bounce[k * 3 + 2] *= 0.35 * rho[2]; }
  dilateCells(bounce, openB, Wb, Hb);
  const BO = new Float64Array(3);
  const bnc = (x, z) => {                                  // bilinear bounce at a plan point -> BO
    let fx = x / tb - 0.5, fz = z / tb - 0.5; fx = fx < 0 ? 0 : fx > Wb - 1.001 ? Wb - 1.001 : fx; fz = fz < 0 ? 0 : fz > Hb - 1.001 ? Hb - 1.001 : fz;
    const i = fx | 0, j = fz | 0, a = fx - i, b = fz - j, k = (j * Wb + i) * 3, k2 = k + Wb * 3, w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
    BO[0] = bounce[k] * w00 + bounce[k + 3] * w10 + bounce[k2] * w01 + bounce[k2 + 3] * w11;
    BO[1] = bounce[k + 1] * w00 + bounce[k + 4] * w10 + bounce[k2 + 1] * w01 + bounce[k2 + 4] * w11;
    BO[2] = bounce[k + 2] * w00 + bounce[k + 5] * w10 + bounce[k2 + 2] * w01 + bounce[k2 + 5] * w11;
  };
  lap('bounce');

  // moon: which windows face it; patches are traced back from each receiver to the window opening
  const m0 = input.moon, moon = m0 && Number.isFinite(m0.el) && Number.isFinite(m0.az) && m0.el > 0 ? m0 : null, KM = moon && Number.isFinite(moon.k) && moon.k > 0 ? moon.k : K_MOON;
  const ce = moon ? Math.cos(moon.el) : 0, se = moon ? Math.sin(moon.el) : 0, mx = moon ? Math.sin(moon.az) : 0, mz = moon ? Math.cos(moon.az) : 0;
  const cookies = input.cookies || {}, wins = [], moonlit = [];
  (input.windows || []).forEach((w, wi) => {
    const f = w && faces[w.face]; if (!f) { warn.push(`window ${wi} names no face (${w && w.face}): ignored`); return; }
    if (![w.u0, w.u1, w.v0, w.v1].every(Number.isFinite)) { warn.push(`window ${wi} has a non-finite opening: ignored`); return; }
    const out = -(f.nx * mx + f.nz * mz), lit = moon ? (w.moonlit != null ? !!w.moonlit : out >= Math.cos(75 * Math.PI / 180)) : false;
    let ck = null, mir = false;
    if (lit) {
      const rel = Math.atan2(mx * f.tx + mz * f.tz, out) * 180 / Math.PI, bk = rel > 15 ? 30 : rel < -15 ? -30 : 0, ty = w.type || 'window';
      ck = cookies[ty + '_' + bk] || null;
      if (!ck && bk === -30 && cookies[ty + '_30']) { ck = cookies[ty + '_30']; mir = true; }
      if (!ck) ck = cookies[ty + '_0'] || cookies[ty] || null;
      ck = ck ? cookieData(ck) : null;
      moonlit.push(wi);
    }
    const u0 = Math.min(w.u0, w.u1), u1 = Math.max(w.u0, w.u1), v0 = Math.min(w.v0, w.v1), v1 = Math.max(w.v0, w.v1);
    // boxes that can stand in a beam (within 3 tiles + the beam's spread of the window)
    const cx = f.x0 + (f.x1 - f.x0) * (u0 + u1) / 2, cz = f.z0 + (f.z1 - f.z0) * (u0 + u1) / 2, rr = 3 * L + 5;
    const bx = B.box.filter(b => b.x1 > cx - rr && b.x0 < cx + rr && b.z1 > cz - rr && b.z0 < cz + rr);
    wins.push({ wi, fi: w.face, f, lit, ck, mir, u0, u1, v0, v1, cx, cz, bx, mn: mx * f.nx + mz * f.nz });
  });
  // moon at a receiver point (x, h, z) through window w: K * cookie, or 0 (caller multiplies by its cosine)
  const moonAt = (w, x, h, z) => {
    const f = w.f, dpl = (x - f.x0) * f.nx + (z - f.z0) * f.nz; if (dpl <= 0 || w.mn >= 0) return 0;
    const t = -dpl / (ce * w.mn), qx = x + t * ce * mx, qz = z + t * ce * mz, qy = h + t * se;
    if (t * ce > 3 * L) return 0;
    const u = ((qx - f.x0) * f.tx + (qz - f.z0) * f.tz) / f.len; if (u < w.u0 || u > w.u1 || qy < w.v0 || qy > w.v1) return 0;
    if (!clear(W, GW, x / L, z / L, (qx + f.nx * 1e-3) / L, (qz + f.nz * 1e-3) / L)) return 0;
    for (const b of w.bx) if (boxBlocks(b, x, z, h, qx, qz, qy)) return 0;
    let uq = (u - w.u0) / (w.u1 - w.u0); const vq = (qy - w.v0) / (w.v1 - w.v0); if (w.mir) uq = 1 - uq;
    return KM * (w.ck ? cookieAt(w.ck, uq, vq) : softBox(uq, vq));
  };
  // a window facing away from the moon gets a faint cool skylight stamp reaching 1.5 m into the room
  const stampAt = (w, x, z) => {
    const f = w.f, a = (x - f.x0) * f.nx + (z - f.z0) * f.nz; if (a <= 0 || a >= 1.5) return 0;
    const hw = (w.u1 - w.u0) * f.len / 2, bl = Math.abs((x - w.cx) * f.tx + (z - w.cz) * f.tz), lat = bl <= hw ? 1 : bl >= hw + 0.5 ? 0 : (1 - (bl - hw) / 0.5) ** 2;
    if (!lat || !clear(W, GW, x / L, z / L, (w.cx + f.nx * 1e-3) / L, (w.cz + f.nz * 1e-3) / L)) return 0;
    return 0.15 * KM * (1 - a / 1.5) ** 2 * lat;
  };
  const P = Math.round(L * TI.plan), Wp = GW * P, Hp = GH * P, tp = L / P;
  const Pf = Math.round(L * TI.lf), Wf = GW * Pf, Hf = GH * Pf, tf = L / Pf;
  const moonF = new Map(), moonD = new Float32Array(Wf * Hf);   // (moonF: P x P buffers for the few tiles with moon on the floor)
  const region = (w, fn) => {                              // texels a window's beam or stamp can reach, as tile-clipped rectangles
    const f = w.f, pts = [];
    if (w.lit) { const cot = ce / se; for (const u of [w.u0, w.u1]) for (const v of [0, w.v1]) { const qx = f.x0 + (f.x1 - f.x0) * u, qz = f.z0 + (f.z1 - f.z0) * u; pts.push([qx - mx * v * cot, qz - mz * v * cot], [qx, qz]); } }
    else for (const u of [w.u0, w.u1]) { const qx = f.x0 + (f.x1 - f.x0) * u, qz = f.z0 + (f.z1 - f.z0) * u; pts.push([qx, qz], [qx + f.nx * 1.5, qz + f.nz * 1.5]); }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pad = w.lit ? 0.05 : 0.55; fn(Math.max(0, x0 - pad), Math.max(0, z0 - pad), Math.min(GW * L, x1 + pad), Math.min(GH * L, z1 + pad));
  };
  for (const w of wins) {
    region(w, (x0, z0, x1, z1) => {
      for (let pass = 0; pass < 2; pass++) {
        const step = pass ? tf : tp, res = pass ? Wf : Wp, h = pass ? FIELD_Y : 0, Pn = pass ? Pf : P;
        const i0 = Math.floor(x0 / step), i1 = Math.min(res - 1, Math.floor(x1 / step)), j0 = Math.floor(z0 / step), j1 = Math.min((pass ? Hf : Hp) - 1, Math.floor(z1 / step));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * step, z = (j + 0.5) * step, t = Math.floor(z / L) * GW + Math.floor(x / L); if (W[t]) continue;
          const e = w.lit ? moonAt(w, x, h, z) * (h ? 1 : se) : stampAt(w, x, z);   // floor: x sin(elevation); field: no cosine (the shader's)
          if (!e) continue;
          if (pass) { moonD[j * res + i] += e; continue; }
          let mt = moonF.get(t); if (!mt) moonF.set(t, mt = new Float32Array(Pn * Pn));
          mt[(j - Math.floor(z / L) * Pn) * Pn + i - (t % GW) * Pn] += e;
        }
      }
    });
  }
  lap('moon');

  // encoding: E / E_MAX through the sRGB curve (or linear) plus the blue-noise dither, packed into one 32-bit store per texel.
  // RGB share one dither value (no colour speckle); alpha and the aux channels use the noise shifted by (21, 7).
  const u32 = m => new Uint32Array(m.data.buffer, m.data.byteOffset, m.w * m.h);

  /* ---------- floor and ceiling plan maps, tile by tile ---------- */
  const floorLM = img(Wp, Hp, true), ceilLM = img(Wp, Hp, true), floorAux = img(Wp, Hp, false), ceilAux = img(Wp, Hp, false);
  fill32(floorAux.data, 0, 0, 255, 255); fill32(ceilAux.data, 0, 0, 255, 255);
  const fAux32 = u32(floorAux);
  const acc = new Float32Array(P * P * 4), rowN = new Float32Array(80 * 3), rowM = new Float32Array(80), rowK = new Uint8Array(80), PK = 76 * 3;
  const cI = new Int32Array(Math.max(P, 64)), cA = new Float32Array(Math.max(P, 64)), cX = new Float32Array(Math.max(P, 64)), slp = [0, 0];
  const bI = new Int32Array(P), bA = new Float32Array(P), bRow = new Float32Array((BP + 3) * 3);
  const startTile = (tx, tz, Pn, step, buf) => upsample(bounce, Wb, Hb, tb, tx, tz, Pn, step, buf, bI, bA, bRow);
  // one lamp into a tile's accumulator: masked bilinear of its raster (rows interpolated once per texel row), times the geometry.
  // mode 0 floor (n up), 1 flat ceiling (n down), 2 gable ceiling, 3 light field (no cosine, plus the direction sums)
  const lampTile = (lp, V, tx, tz, Pn, step, buf, stride, mode, hc) => {
    const r = lp.r, vis = r.vis, N = r.N, fl = lp.grp >= 0, fx0 = ((tx * Pn + 0.5) * step - r.ox) * r.inv - 0.5, fst = step * r.inv;
    for (let i = 0; i < Pn; i++) { const fx = fx0 + i * fst, i0 = Math.floor(fx); cI[i] = i0; cA[i] = fx - i0; cX[i] = lp.x - (tx * Pn + i + 0.5) * step; }
    const c0 = Math.max(0, cI[0]), c1 = Math.min(N - 1, cI[Pn - 1] + 1), nc = c1 - c0;
    if (nc < 1) return 0;
    const h = mode === 0 ? lp.y : mode === 3 ? lp.y - FIELD_Y : hc - lp.y, h2 = h * h;
    let cnt = 0;
    for (let j = 0; j < Pn; j++) {
      const pz = (tz * Pn + j + 0.5) * step, dz = lp.z - pz, fz = (pz - r.oz) * r.inv - 0.5, j0 = Math.floor(fz);
      if (j0 < 0 || j0 >= N - 1) continue;
      const rowBase = dz * dz + (mode === 2 ? 0 : h2); if (rowBase >= R2) continue;
      const b = fz - j0, b1 = 1 - b;
      let pin = false, kp = 0;                             // pin: this row pair has a pinched corner (see sample())
      for (let c = c0, q = 0; c <= c1; c++, q++) {
        const k = j0 * N + c, kb = k + N, m = (vis[k] & 128 ? 1 : 0) | (vis[kb] & 128 ? 2 : 0);
        rowM[q] = (m & 1 ? 0 : b1) + (m & 2 ? 0 : b); rowK[q] = m;
        if ((m === 1 || m === 2) && m + kp === 3) pin = true;
        kp = m;
        rowN[q * 3] = V[k * 3] * b1 + V[kb * 3] * b;
        if (!fl) { rowN[q * 3 + 1] = V[k * 3 + 1] * b1 + V[kb * 3 + 1] * b; rowN[q * 3 + 2] = V[k * 3 + 2] * b1 + V[kb * 3 + 2] * b; }
      }
      for (let i = 0; i < Pn; i++) {
        const q = cI[i] - c0; if (q < 0 || q >= nc) continue;
        const dx = cX[i]; let d2 = dx * dx + rowBase, cos;
        if (mode === 2) { const px = lp.x - dx, pz2 = lp.z - dz, hh = B.ceilAt(px, pz2) - lp.y; d2 += hh * hh; B.slope(px, pz2, slp); cos = (hh + slp[0] * dx + slp[1] * dz) / Math.sqrt(1 + slp[0] * slp[0] + slp[1] * slp[1]); }
        else cos = h;
        if (d2 >= R2 || cos <= 0) continue;
        const a = cA[i], a1 = 1 - a; let ws = rowM[q] * a1 + rowM[q + 1] * a, k3 = q * 3;
        if (pin) {                                         // a pinched corner: only the texel's own sub-cell (put twice in a spare
          const pk = rowK[q] | rowK[q + 1] << 2;           // rowN slot, so the interpolation below returns it unchanged)
          if (pk === 6 || pk === 9) {
            const k0 = (j0 * N + cI[i]) * 3, kk = pk === 6 ? (a + b < 1 ? k0 : k0 + (N + 1) * 3) : (a > b ? k0 + 3 : k0 + N * 3);
            rowN[PK] = rowN[PK + 3] = V[kk]; if (!fl) { rowN[PK + 1] = rowN[PK + 4] = V[kk + 1]; rowN[PK + 2] = rowN[PK + 5] = V[kk + 2]; }
            k3 = PK; ws = 1;
          }
        }
        if (ws <= 0) continue;
        const qq = d2 * (1 / R2), w = 1 - qq * qq, sq = Math.sqrt(d2), G = (mode === 3 ? sq : cos) * w * w / (sq * (d2 > 0.01 ? d2 : 0.01) * ws), o = (j * Pn + i) * stride;
        let wt;
        if (fl) { const e = G * (rowN[k3] * a1 + rowN[k3 + 3] * a); buf[o + 3] += e; wt = e; }
        else {
          const er = G * (rowN[k3] * a1 + rowN[k3 + 3] * a), eg = G * (rowN[k3 + 1] * a1 + rowN[k3 + 4] * a), eb = G * (rowN[k3 + 2] * a1 + rowN[k3 + 5] * a);
          buf[o] += er; buf[o + 1] += eg; buf[o + 2] += eb; wt = 0.2126 * er + 0.7152 * eg + 0.0722 * eb;
        }
        if (mode === 3) { const s = wt / sq; buf[o + 4] += dx * s; buf[o + 5] += h * s; buf[o + 6] += dz * s; }
        cnt++;
      }
    }
    return cnt;
  };
  let evals = 0;
  for (let pass = 0; pass < 2; pass++) {                   // 0 floor, 1 ceiling
    const out = u32(pass ? ceilLM : floorLM);
    for (let t = 0; t < n; t++) {
      if (W[t]) continue;
      const tx = t % GW, tz = t / GW | 0, g = fg[t] - 1, mode = pass ? (B.gid[t] < 0 ? 1 : 2) : 0;
      startTile(tx, tz, P, tp, acc);
      for (const e of tl[t]) {
        if (!(e & (pass ? 4 : 1))) continue;
        const lp = lamps[e >> 3]; if (lp.grp >= 0 && lp.grp !== g) continue;
        evals += lampTile(lp, pass ? lp.r.vC : lp.r.vF, tx, tz, P, tp, acc, 4, mode, B.C[t]);
      }
      encPlan(out, acc, P, tx * P, tz * P, Wp, fAux32, pass ? null : moonF.get(t) || null);
    }
    lap(pass ? 'ceil' : 'floor');
  }

  /* ---------- light field at 1.1 m ---------- */
  const lf0 = img(Wf, Hf, true), lf1 = img(Wf, Hf, false), l0 = u32(lf0), l1 = u32(lf1), fa = new Float32Array(Pf * Pf * 7);
  for (let t = 0; t < n; t++) {
    if (W[t]) continue;
    const tx = t % GW, tz = t / GW | 0, g = fg[t] - 1;
    fa.fill(0);
    for (const e of tl[t]) {
      if (!(e & 2)) continue;
      const lp = lamps[e >> 3]; if (lp.grp >= 0 && lp.grp !== g) continue;
      evals += lampTile(lp, lp.r.vD, tx, tz, Pf, tf, fa, 7, 3, 0);
    }
    encField(l0, l1, fa, Pf, tx * Pf, tz * Pf, Wf, moonD);
  }
  lap('field');

  /* ---------- walls: one atlas cell per face ---------- */
  const atlas = packAtlas(faces, tk, faces.map(f => f.H)), AW = atlas.W, AH = atlas.H;
  const wallLM = img(AW, AH, true), wallAux = img(AW, AH, false), wl = u32(wallLM), wa = u32(wallAux);
  let maxC = 0, maxW = 0, maxH = 0; for (const c of atlas.cells) { maxC = Math.max(maxC, c.lw * c.lh); maxW = Math.max(maxW, c.lw); maxH = Math.max(maxH, c.lh); }
  const wacc = new Float32Array(maxC * 4), wmoon = new Float32Array(maxC), wao = new Float32Array(maxC), zeros = new Float32Array(maxC), ones = new Float32Array(maxC).fill(1), colAO = new Float32Array(maxW), colB = new Float32Array(maxW * 3), colH = new Float32Array(maxW);
  const rowY = new Float32Array(maxH), rowF = new Float32Array(maxH), rowAO = new Float32Array(maxH);
  const bandBy = {}; for (const b of input.band || []) (bandBy[b.face] = bandBy[b.face] || []).push(b);
  const sillBy = {}, NONE = []; for (const w of wins) if (w.v0 > 0.25) (sillBy[w.fi] = sillBy[w.fi] || []).push(w);
  let near = new Float64Array(64);
  const forder = faces.map((_, i) => i).sort((a, b) => atlas.cells[a].y - atlas.cells[b].y || atlas.cells[a].x - atlas.cells[b].x);
  for (const fi of forder) {
    const f = faces[fi], c = atlas.cells[fi], lw = c.lw, lh = c.lh, Hm = c.H, t = f.y * GW + f.x, g = fg[t] - 1, dX = f.x1 - f.x0, dZ = f.z1 - f.z0;
    wacc.fill(0, 0, lw * lh * 4);
    let moonHere = false;                                   // (wmoon is cleared only for faces a window can reach)
    for (let j = 0; j < lh; j++) { const y = Hm - (j + 0.5) * Hm / lh; rowY[j] = y; rowF[j] = y < 2.2 ? 1 - 0.65 * (y / 2.2) ** 2 * (3 - 2 * y / 2.2) : 0.35; }
    for (let i = 0; i < lw; i++) { const u = (i + 0.5) / lw, sx = f.x0 + dX * u + f.nx * 0.02, sz = f.z0 + dZ * u + f.nz * 0.02; colH[i] = f.gable ? B.ceilAt(sx, sz) : Hm; bnc(sx, sz); colB[i * 3] = BO[0]; colB[i * 3 + 1] = BO[1]; colB[i * 3 + 2] = BO[2]; }
    // lamps (the visibility is the floor, field and ceiling rasters at the column's floor point 2 cm into the room, blended by height)
    for (const e of tl[t]) {
      const lp = lamps[e >> 3]; if (lp.grp >= 0 && lp.grp !== g) continue;
      if ((lp.x - f.x0) * f.nx + (lp.z - f.z0) * f.nz <= 0.001) continue;
      evals += wallLamp(lp, f, lw, lh, rowY, colH, wacc);
    }
    // moon through windows of other faces (columns share the trace back in plan; only the height changes per row)
    const fm = f.nx * mx + f.nz * mz;
    for (const w of wins) {
      if (w.f === f) continue;
      const wcx = w.cx - (f.x0 + f.x1) / 2, wcz = w.cz - (f.z0 + f.z1) / 2; if (wcx * wcx + wcz * wcz > (3 * L + 2.7) ** 2) continue;
      if (!moonHere) { moonHere = true; wmoon.fill(0, 0, lw * lh); }
      if (w.lit && fm > 0 && w.mn < 0) {
        const wf = w.f;
        for (let i = 0; i < lw; i++) {
          const u = (i + 0.5) / lw, wx = f.x0 + dX * u + f.nx * 0.02, wz = f.z0 + dZ * u + f.nz * 0.02;
          const dpl = (wx - wf.x0) * wf.nx + (wz - wf.z0) * wf.nz; if (dpl <= 0) continue;
          const tt = -dpl / (ce * w.mn), qx = wx + tt * ce * mx, qz = wz + tt * ce * mz; if (tt * ce > 3 * L) continue;
          const uw = ((qx - wf.x0) * wf.tx + (qz - wf.z0) * wf.tz) / wf.len; if (uw < w.u0 || uw > w.u1) continue;
          if (!clear(W, GW, wx / L, wz / L, (qx + wf.nx * 1e-3) / L, (qz + wf.nz * 1e-3) / L)) continue;
          const uq = w.mir ? 1 - (uw - w.u0) / (w.u1 - w.u0) : (uw - w.u0) / (w.u1 - w.u0);
          for (let j = 0; j < lh; j++) {
            const y = rowY[j], qy = y + tt * se; if (qy < w.v0 || qy > w.v1) continue;
            let hit = false; for (let q = 0; q < w.bx.length; q++) if (boxBlocks(w.bx[q], wx, wz, y, qx, qz, qy)) { hit = true; break; }
            if (hit) continue;
            const vq = (qy - w.v0) / (w.v1 - w.v0);
            wmoon[j * lw + i] += KM * (w.ck ? cookieAt(w.ck, uq, vq) : softBox(uq, vq)) * fm * ce;
          }
        }
      } else if (!w.lit) {
        const wy = (w.v0 + w.v1) / 2;
        for (let i = 0; i < lw; i++) {
          const u = (i + 0.5) / lw, wx = f.x0 + dX * u, wz = f.z0 + dZ * u, ex = w.cx - wx, ez = w.cz - wz;
          const into = -(ex * w.f.nx + ez * w.f.nz), facing = ex * f.nx + ez * f.nz; if (into <= 0 || facing <= 0 || ex * ex + ez * ez >= 2.25) continue;
          if (!clear(W, GW, (wx + f.nx * 0.02) / L, (wz + f.nz * 0.02) / L, (w.cx + w.f.nx * 1e-3) / L, (w.cz + w.f.nz * 1e-3) / L)) continue;
          for (let j = 0; j < lh; j++) {
            const ey = wy - rowY[j], rr = Math.sqrt(ex * ex + ey * ey + ez * ez); if (rr >= 1.5) continue;
            wmoon[j * lw + i] += 0.15 * KM * (1 - rr / 1.5) ** 2 * (into / rr) * (facing / rr);
          }
        }
      }
    }
    // AO: corners per column, floor and ceiling lines per row (per texel under a gable), boxes and band items, window sills
    const sx0 = Math.round(Math.sign(dX)), sz0 = Math.round(Math.sign(dZ));
    const in0 = isW(f.x - sx0, f.y - sz0), in1 = isW(f.x + sx0, f.y + sz0);
    const out0 = !in0 && !isW(f.x - sx0 - f.nx, f.y - sz0 - f.nz), out1 = !in1 && !isW(f.x + sx0 - f.nx, f.y + sz0 - f.nz);
    for (let i = 0; i < lw; i++) { const s = (i + 0.5) / lw * f.len; colAO[i] = (in0 ? cv(ao.inside, s) : out0 ? cv(ao.outside, s) : 1) * (in1 ? cv(ao.inside, f.len - s) : out1 ? cv(ao.outside, f.len - s) : 1); }
    for (let j = 0; j < lh; j++) rowAO[j] = cv(ao.floor, rowY[j]) * (f.gable ? 1 : cv(ao.ceil, Hm - rowY[j]));
    let nn = 0;                                            // near: [along0, along1, gap, top] of boxes within 0.6 m of the face
    for (const b of B.allBox) {
      const gx = f.nx > 0 ? b.x0 - f.x0 : f.nx < 0 ? f.x0 - b.x1 : -1, gz = f.nz > 0 ? b.z0 - f.z0 : f.nz < 0 ? f.z0 - b.z1 : -1;
      const gap = Math.max(f.nx ? gx : -1, f.nz ? gz : -1); if (gap < -0.05 || gap > 0.6) continue;
      const pa = (b.x0 - f.x0) * f.tx + (b.z0 - f.z0) * f.tz, pb = (b.x1 - f.x0) * f.tx + (b.z1 - f.z0) * f.tz, a0 = Math.min(pa, pb), a1 = Math.max(pa, pb);
      if (a1 < -0.6 || a0 > f.len + 0.6) continue;
      if (nn + 4 > near.length) near = Float64Array.from({ length: near.length * 2 }, (_, k) => near[k] || 0);
      near[nn++] = a0; near[nn++] = a1; near[nn++] = Math.max(0, gap); near[nn++] = b.h;
    }
    for (const b of bandBy[fi] || []) { if (nn + 4 > near.length) near = Float64Array.from({ length: near.length * 2 }, (_, k) => near[k] || 0);
      near[nn++] = Math.min(b.u0, b.u1) * f.len; near[nn++] = Math.max(b.u0, b.u1) * f.len; near[nn++] = 0; near[nn++] = b.h; }
    const sills = sillBy[fi] || NONE;
    const extra = f.gable || nn || sills.length;
    if (extra) for (let j = 0; j < lh; j++) {
      const y = rowY[j];
      for (let i = 0; i < lw; i++) {
        let k = 1;
        if (f.gable) k *= cv(ao.ceil, colH[i] - y);
        if (nn) { const s = (i + 0.5) / lw * f.len;
          for (let q = 0; q < nn; q += 4) { const du = s < near[q] ? near[q] - s : s > near[q + 1] ? s - near[q + 1] : 0, dh = y > near[q + 3] ? y - near[q + 3] : 0, gp = near[q + 2]; k *= cv(ao.boxWall, Math.sqrt(gp * gp + du * du + dh * dh)); } }
        if (sills.length) { const u = (i + 0.5) / lw; for (const w of sills) if (y < w.v0 && u > w.u0 - 0.05 && u < w.u1 + 0.05) k *= cv(ao.skirting, w.v0 - y); }
        wao[j * lw + i] = k;
      }
    }
    // write the cell: lamps + bounce on the lower wall (RGB, A flicker), moon and AO into the aux atlas
    encWall(wl, wa, AW, c.x + 1, c.y + 1, lw, lh, wacc, moonHere ? wmoon : zeros, extra ? wao : ones, colB, rowF, colAO, rowAO);
    gutter(wl, AW, c); gutter(wa, AW, c);
  }
  lap('walls');
  // texels under wall tiles copy their open neighbours, so bilinear filtering and mipmaps never pull in black at a wall's foot
  const D = Math.min(4, P >> 1), Df = Math.min(2, Pf >> 1);
  dilateTiles(floorLM.data, W, GW, GH, P, D); dilateTiles(floorAux.data, W, GW, GH, P, D); dilateTiles(ceilLM.data, W, GW, GH, P, D);
  dilateTiles(lf0.data, W, GW, GH, Pf, Df); dilateTiles(lf1.data, W, GW, GH, Pf, Df);
  if (!LE) for (const m of [floorLM, floorAux, ceilLM, ceilAux, wallLM, wallAux, lf0, lf1]) swap32(u32(m));
  const flickId = img(GW, GH, false);
  for (let t = 0; t < n; t++) { flickId.data[t * 4] = fg[t]; flickId.data[t * 4 + 3] = 255; }
  lap('finish');
  ms.total = +(now() - T.start).toFixed(2);
  const wallCells = atlas.cells.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h, lw: c.lw, lh: c.lh, H: c.H, u0: c.u0, v0: c.v0, su: c.su, sv: c.sv }));
  return { floorLM, floorAux, ceilLM, ceilAux, wallLM, wallAux, lf0, lf1, flickId, wallCells, fixGroup, groups,
    moonDir: moon ? [-ce * mx, -se, -ce * mz] : [0, -1, 0], moonlit, atlas: { W: AW, H: AH, ppm: atlas.ppm },
    stats: { tier: tk, ms, lamps: lamps.length, ...counts, warnings: warn.length > 50 ? warn.slice(0, 50).concat(`... and ${warn.length - 50} more`) : warn, groups: groups.length, windows: wins.length, moonlit: moonlit.length, faces: faces.length,
      evals, plan: [Wp, Hp], field: [Wf, Hf], atlas: [AW, AH, +atlas.ppm.toFixed(2)] } };
}

/* ---------- small helpers ---------- */
const img = (w, h, srgb) => ({ w, h, data: new Uint8ClampedArray(w * h * 4), srgb });
function fill32(d, r, g, b, a) { const u = new Uint8Array(d.buffer, d.byteOffset, 4); u[0] = r; u[1] = g; u[2] = b; u[3] = a; const v = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2); v.fill(v[0]); }
function cookieData(c) {
  const w = c.w || c.width, h = c.h || c.height, d = c.data; if (!w || !h || !d) return null;
  const ch = d.length >= w * h * 4 ? 4 : 1, sc = d instanceof Float32Array || d instanceof Float64Array || (Array.isArray(d) && Math.max(...d.slice(0, 64)) <= 1) ? 1 : 1 / 255;
  const o = new Float32Array(w * h); for (let k = 0; k < w * h; k++) o[k] = d[k * ch] * sc;
  return { w, h, d: o };
}
function cookieAt(c, u, v) {                               // bilinear, window space: column 0 = u0 side, row 0 = top of the opening
  let fx = u * c.w - 0.5, fy = (1 - v) * c.h - 0.5; fx = fx < 0 ? 0 : fx > c.w - 1.001 ? c.w - 1.001 : fx; fy = fy < 0 ? 0 : fy > c.h - 1.001 ? c.h - 1.001 : fy;
  const i = fx | 0, j = fy | 0, a = fx - i, b = fy - j, k = j * c.w + i;
  return (c.d[k] * (1 - a) + c.d[k + 1] * a) * (1 - b) + (c.d[k + c.w] * (1 - a) + c.d[k + c.w + 1] * a) * b;
}
function softBox(u, v) {                                   // no cookie: the opening with softened edges (its patch is the trapezoid)
  const e = x => x <= 0 ? 0 : x >= 0.04 ? 1 : x / 0.04;
  return 0.9 * e(u) * e(1 - u) * e(v) * e(1 - v);
}
// separable Gaussian that stops at closed cells, normalised over the open cells it reached (so no light leaks through a wall)
function blurBarrier(src, open, w, h, pxPerM) {
  const sig = pxPerM, R = Math.ceil(3 * sig), g = new Float32Array(R + 1), tmp = new Float32Array(src.length), dst = new Float32Array(src.length);
  for (let k = 0; k <= R; k++) g[k] = Math.exp(-(k * k) / (2 * sig * sig));
  const pass = (a, b, n1, n2, s1, s2) => {
    for (let q = 0; q < n2; q++) for (let p = 0; p < n1; p++) {
      const c = q * s2 + p * s1; if (!open[c]) continue;
      let r = a[c * 3] * g[0], gg = a[c * 3 + 1] * g[0], bb = a[c * 3 + 2] * g[0], ws = g[0];
      for (let k = 1; k <= R && p - k >= 0; k++) { const e = c - k * s1; if (!open[e]) break; r += a[e * 3] * g[k]; gg += a[e * 3 + 1] * g[k]; bb += a[e * 3 + 2] * g[k]; ws += g[k]; }
      for (let k = 1; k <= R && p + k < n1; k++) { const e = c + k * s1; if (!open[e]) break; r += a[e * 3] * g[k]; gg += a[e * 3 + 1] * g[k]; bb += a[e * 3 + 2] * g[k]; ws += g[k]; }
      b[c * 3] = r / ws; b[c * 3 + 1] = gg / ws; b[c * 3 + 2] = bb / ws;
    }
  };
  pass(src, tmp, w, h, 1, w); pass(tmp, dst, h, w, w, 1);
  return dst;
}
function dilateCells(a, open, w, h) {                      // closed cells next to open ones take their mean (for bilinear lookups at walls)
  const src = a.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y * w + x; if (open[c]) continue; let r = 0, g = 0, b = 0, m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const e = Y * w + X; if (!open[e]) continue;
      r += src[e * 3]; g += src[e * 3 + 1]; b += src[e * 3 + 2]; m++;
    }
    if (m) { a[c * 3] = r / m; a[c * 3 + 1] = g / m; a[c * 3 + 2] = b / m; }
  }
}
// copy the edge texels of open tiles D texels into neighbouring wall tiles (and corner texels into wall corners)
function dilateTiles(d, W, GW, GH, P, D) {
  if (D < 1) return;
  const u = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2), Wp = GW * P, open = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && !W[y * GW + x];
  for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
    if (open(tx, ty)) continue;
    const X0 = tx * P, Y0 = ty * P;
    if (open(tx, ty - 1)) for (let k = 0; k < D; k++) for (let i = 0; i < P; i++) u[(Y0 + k) * Wp + X0 + i] = u[(Y0 - 1) * Wp + X0 + i];
    if (open(tx, ty + 1)) for (let k = 0; k < D; k++) for (let i = 0; i < P; i++) u[(Y0 + P - 1 - k) * Wp + X0 + i] = u[(Y0 + P) * Wp + X0 + i];
    if (open(tx - 1, ty)) for (let k = 0; k < D; k++) for (let j = 0; j < P; j++) u[(Y0 + j) * Wp + X0 + k] = u[(Y0 + j) * Wp + X0 - 1];
    if (open(tx + 1, ty)) for (let k = 0; k < D; k++) for (let j = 0; j < P; j++) u[(Y0 + j) * Wp + X0 + P - 1 - k] = u[(Y0 + j) * Wp + X0 + P];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (!open(tx + sx, ty + sy) || open(tx + sx, ty) || open(tx, ty + sy)) continue;
      const cx = sx < 0 ? X0 - 1 : X0 + P, cy = sy < 0 ? Y0 - 1 : Y0 + P, v = u[cy * Wp + cx];
      for (let k = 0; k < D; k++) for (let m = 0; m < D; m++) u[(sy < 0 ? Y0 + k : Y0 + P - 1 - k) * Wp + (sx < 0 ? X0 + m : X0 + P - 1 - m)] = v;
    }
  }
}
function gutter(u, AW, c) {                                // the 1 px border of an atlas cell repeats its edge texels (u: Uint32 view)
  const x0 = c.x, y0 = c.y, x1 = c.x + c.w - 1, y1 = c.y + c.h - 1;
  for (let x = x0 + 1; x < x1; x++) { u[y0 * AW + x] = u[(y0 + 1) * AW + x]; u[y1 * AW + x] = u[(y1 - 1) * AW + x]; }
  for (let y = y0; y <= y1; y++) { u[y * AW + x0] = u[y * AW + x0 + 1]; u[y * AW + x1] = u[y * AW + x1 - 1]; }
}

// wrap the maps as textures: CanvasTexture(new ImageData(...)) (the bundle has no DataTexture; a 2D canvas would premultiply
// alpha and destroy RGB where A is small). flipY = true so row 0 = grid row 0 at plan v = 1.
function toTextures(THREE, m) {
  const mk = (b, kind) => {
    const t = new THREE.CanvasTexture(new ImageData(b.data, b.w, b.h));
    t.flipY = true; t.premultiplyAlpha = false;
    t.colorSpace = b.srgb ? THREE.SRGBColorSpace : '';    // ('' = NoColorSpace: raw upload. sRGB: RGB decoded by the GPU, A stays linear)
    t.wrapS = t.wrapT = 1001;                             // ClampToEdgeWrapping (not exported by the bundle)
    if (kind === 'id') { t.magFilter = t.minFilter = 1003; t.generateMipmaps = false; }        // NearestFilter: group ids must not blend
    else if (kind === 'atlas') { t.magFilter = t.minFilter = 1006; t.generateMipmaps = false; } // LinearFilter: mipmaps would bleed across cells
    else { t.magFilter = 1006; t.minFilter = 1008; t.generateMipmaps = true; }                  // LinearMipmapLinearFilter
    t.needsUpdate = true;
    return t;
  };
  return { floorLM: mk(m.floorLM), floorAux: mk(m.floorAux), ceilLM: mk(m.ceilLM), ceilAux: mk(m.ceilAux), wallLM: mk(m.wallLM, 'atlas'),
    wallAux: mk(m.wallAux, 'atlas'), lf0: mk(m.lf0), lf1: mk(m.lf1), flickId: mk(m.flickId, 'id') };
}

// build the tables and run one tiny bake, so the first floor's bake doesn't also pay for them and for compiling the hot loops
// (call it once at boot, e.g. while the kit loads)
function warm() {
  const g = new Uint8Array(49).fill(1); for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) if (x & 1 || y & 1) g[y * 7 + x] = 0;
  const faces = facesFromGrid(g, 7, 7), prof = { w: 64, h: 32, data: new Float32Array(64 * 32).fill(1) }, wf = faces.findIndex(f => f.nz === 1);
  for (const tier of ['lo', 'md']) bake({ GW: 7, GH: 7, grid: g, ceil: 3, faces, solids: [{ x0: 112, y0: 140, x1: 128, y1: 160, h: 1.8, occ: 'tall' }],
    fixtures: [{ x: 3.4, y: 2.4, z: 3.4, profile: 'p', state: 'ok' }, { x: 5.6, y: 1.9, z: 7.9, nx: 1, nz: 0, state: 'flicker' }],
    windows: wf >= 0 ? [{ face: wf, u0: 0.3, u1: 0.7, v0: 0.8, v1: 2.4 }] : [], moon: { az: Math.PI, el: 0.6 }, profiles: { p: prof } }, tier);
}

window.LightBaker = { bake, toTextures, packAtlas, faceHeights, facesFromGrid, warm, E_MAX, TIERS, REACH, FIELD_Y };
})();
