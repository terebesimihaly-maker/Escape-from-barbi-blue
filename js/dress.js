/* Escape from Barbi Blue: dressing a floor (build spec A9-A11, B5-B8, C1, C3, C6, D2-D5). Dress.plan(env) decides, from the floor's
   data alone, everything about the house's look that has to come out the same for every player and feed the light bake. It builds
   nothing in 3D: js/arch.js, js/kit.js, js/surface.js, js/atmos.js, house.js (fallback) and LightBaker read the plan.
   Pure: the same env gives the identical plan. Every choice comes from vh (the tile hash mixed with the floor's seed, spec A14),
   never from Math.random, the quality setting or what has loaded (H7). Low may skip clutter under 0.3 m: the renderer's business.

   Dress.plan(env) -> plan            env (any of these spellings; the game's live globals or d's own fields):
     grid | rows       the walls: rows of Uint8Array (grid), d.rows ('0'/'1' strings), or a flat Uint8Array with GW, GH
     solids | SOLIDS   the furniture boxes: decoded ({x0, y0, x1, y1 in u, id, rot, ...}, layout.js applyLayout) or d.solids
     rooms | ROOMS     the halls: roomOf objects or d.rooms;   runs | RUNS: servant runs ({tx0, ty0, tx1, ty1} or d.runs)
     CEIL | ceil       ceiling height per tile (Float32Array GW*GH); left out: worked out from rooms and runs as layout.js does
     VSEED | seed      the floor's visual seed (d.seed);  floorIdx | i;  style (default FLOORS[i].style);  frames (FLOORS[i].frames)
     closets           [[tx, ty, ox, oy]] (d.closets) or the game's [{x, y, ox, oy}];  exit [x, y] or {tx, ty};  exitDir [dx, dy] (optional)
     puzzles           [{cell: [x, y], dir: [dx, dy]}];  notes: d.notes or the game's [{x, y}];  creaks: d.creaks or the game's boards
   Dress.envFromData(d) builds that env from the floor data alone (pure); Dress.envFromGame() from the live globals after applyFloor.

   plan = {
     faces[]     one per wall face, in level.js wallGeometry's order and format {x0, z0, x1, z1, nx, nz, x, y} (m; n into the open tile
                 (x, y), u 0 -> 1 from (x0, z0) to (x1, z1)) plus: h (height: the tile's CEIL, or a gable's highest point on the face at
                 u = 0 .14 .5 .86 1, as LightBaker.faceHeights), hs (gable faces: the heights at those five u, else null), kind ('service' in
                 a servant run, 'upper' when it rises above 3.0 m and carries the upper band, else 'main'), variant (0 = A, 1 = B wallpaper),
                 border (the wall tile behind is the house's outer wall), hall / run (index or -1), side ('side' | 'end' in a hallway or a
                 servant run, else null), inset (0.30 m on a servant run's side faces, else 0), busy (why nothing may go on it: 'puzzle',
                 'exit' (every face of the exit cell), 'wardrobe', 'door' (doorway tile), 'decor' (portrait or word)), skip (a recess module
                 replaces the face quad), mod ({type: 'window' | 'module', i} when skip), used (what the plan put on it)
     doorways[]  {x, y, axis ('x' | 'z': the way through), cx, cz, ry (frame: local x across, local z along), perimeter, hall, frame, leaf,
                 head {y0: 2.6, y1, skip}, swing (+1 | -1 along local z), board ('none' | 'side' | 'long'), leaves [{side -1 | +1, hinge [x, z],
                 rest (deg from closed), pin, tip (m from the side wall at rest)}] (empty under a long board)};  doorKeys ['x,y']
     decorFaces[] {face, kind 'portrait' | 'word', watch, glow, change, pick, word, text, y, w, h, rz}: what wallDecor hangs (A14 vh rule)
     windows[]   {face, x, y, type, node, u0, u1, v0, v1 (opening; m heights), moonlit, curtain, broken}: LightBaker's windows input as is
     modules[]   {kind, node, face (-1 for ceiling pieces), x, y (tile), pos [x, y, z] (node origin, m), ry}. On faces, replacing the face
                 quad from the floor to KIT.arch.faceH (3.0; arch.js still draws a taller face's upper band; above a lower ceiling the
                 ceiling hides the rest): 'exit' | 'fireplace' | 'door_closed' | 'niche' | 'wallhole'. On a face, no skip: 'peel' (Band_peel_*,
                 with u, u0, u1, z0, h, depth). On the ceiling: 'skylight' | 'ceilhole' | 'ceilingrose' (over a hall lamp) | 'ladder'.
                 A skylight also carries slope (rad, 0 on a flat ceiling), rise ([dx, dz] the way a gable roof rises, toward its ridge, or
                 null) and normal (the ceiling's unit normal into the room, [0, -1, 0] when flat); never on a gable's ridge tile
     fixtures[]  {id, profile, node, emitNode, mount, x, y, z (light centre, m), nx, nz, ox, oy, oz (node origin per KIT mount), ry,
                 color (linear RGB), state ('ok' | 'flicker' | 'dead' | 'glow'), k, group (0..15 for flicker, else -1), tile, face, src,
                 bottom/cord (hanging ones), solid (practical ones), hall + moved (a hall lamp shifted off a flue or column to the
                 nearest clear tile of its hall)}: LightBaker.bake's fixtures. With profiles that carry a mount, pass
                 Dress.forBake(plan.fixtures, profiles) instead (it swaps in the node origins); without, x, y, z are the light centres.
     band[]      {face, u (centre), u0, u1, node, id, depth (reach from the wall plane, <= 0.44, a servant run's 0.30 inset included), h, z0,
                 mount ('wall' | 'corner' | 'under_window'), inset, x, z (origin on the wall plane, or on the inset), ry, end (corner
                 pieces: u = end = 0 | 1)}: furniture and props against the walls, no collision
     dolls[]     {x, z, y, ry, face, u}: where house.js makeDoll seats the scare dolls (house.dolls keeps its contract)
     rugs[]      {x, z, w, l, rot, type}: rot 0 = l along z (rotation.y), never on a loose-board tile
     beams[]     {kind ('joist' | 'collar' | 'tie' | 'post' | 'beam' | 'ibeam'), x0, z0, x1, z1, y0 (bottom), y1 (top), w}
     identities  {spaces [{id, type, hall, run, identity, tiles, decalMul, dustMul}], tileSpace Int16Array(GW*GH) (-1 = wall)}
     decalSources {wall [{kind, face, u, v, size, rot, proud}], floor [{kind, x, z, size, rot}], ceiling [{kind, x, z, size, rot}]}
     wet[]       {kind, x, z, rx, rz, rot, amount, tile, drips};  dust {base, nearWall, nearDist, hallMul, noiseKey, seed}
     paths       {pairs [[x0, y0, x1, y1]], herTrail (wardrobe index)};  moon {az, el, k, color, colorLin};  gables (LightBaker form)
     stats       counts of everything, and ms }
   Also: Dress.doorTilesFrom(grid, seed, rooms, runs) (A9.3, the doorway tiles alone), Dress.vh(seed), Dress.hash(plan) (a stable
   checksum), Dress.bakeInput(plan, env, profiles) (LightBaker.bake's input from the plan), Dress.forBake(fixtures, profiles). */
(function () {
'use strict';

const UM = 0.045, TU = 50, L = TU * UM, BOARD_SHORT = 24, BOARD_W = 13, RUN_INSET = 0.30, REACH = 0.44;
const FACE_U = [0, 0.14, 0.5, 0.86, 1], DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FRAMES = [0.12, 0.4, 0.05, 0.06, 0.2], CEIL0 = [3.0, 3.2, 2.7, 2.8, 3.4], STYLE_OF = ['wood', 'tile', 'concrete', 'attic', 'workshop'];
const PI = Math.PI, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const r4 = v => Math.round(v * 1e4) / 1e4;                 // (metres to 0.1 mm: short numbers in the plan)
const def = (a, b) => a !== undefined && a !== null ? a : b;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// the tile hash of world3d.js (copied, so this file stands alone), and vh: the same hash mixed with the floor's seed (spec A14)
function hash(x, y, k) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((k | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const vhOf = seed => (x, y, k) => hash(x, y, (Math.imul(k, 2654435761) ^ seed) | 0);
const lin = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(c => { c /= 255; return r4(c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); });

/* ---------- per style ----------
   sconce: the corridor wall lamp (fixDen per face, house.js), roomSconce: the halls' (lights.wall), bulb: the lamp on cells (bulbP of them),
   win: window nodes, winDen: share of outer faces, band: share of faces with furniture against them, decal: decals per face (D4),
   dust: base dust (D2), varB: share of faces with the worn wallpaper, peel: share with peeling strips (D5), hole: wall hole nodes (% = A/B/C) */
const ST = {
  wood:     { sconce: 'sconce_shade', fixDen: 0.16, win: ['Win_sash'], winDen: 0.30, band: 0.35, decal: 0.35, dust: 0.45, varB: 0.35, peel: 0.06, lamp: 0xffc9b8,
              fire: 1, hole: 'Mod_wallhole_lath_%_wood', rose: 'Band_ceilingrose', dolls: 'floor' },
  tile:     { sconce: 'sconce_candles', fixDen: 0.2, win: ['Win_tall'], winDen: 0.30, band: 0.30, decal: 0.25, dust: 0.3, varB: 0.3, peel: 0.06, lamp: 0xffcf8a,
              fire: 1, hole: 'Mod_wallhole_lath_%_tile', rose: 'Band_coffer_rose', niche: 'Mod_niche_tile', dolls: 'table' },
  concrete: { sconce: null, roomSconce: 'bulkhead', fixDen: 0, win: ['Win_cellar'], winDen: 0.15, band: 0.30, decal: 0.5, dust: 0.35, varB: 0.45, peel: 0.04,
              lamp: 0xfff1d0, bulb: 'bare_bulb', bulbP: 0.3, hole: 'Mod_breach_brick_%_concrete' },
  attic:    { sconce: null, fixDen: 0, win: ['Win_dormer', 'Win_oculus'], winDen: 0.12, band: 0.40, decal: 0.4, dust: 0.85, varB: 0.4, peel: 0.04, lamp: 0xffe6b8,
              bulb: 'bulb_batten', bulbP: 0.3, hole: 'Mod_hole_boards_%_attic', dolls: 'floor', ladder: 1 },
  workshop: { sconce: null, fixDen: 0, win: ['Win_industrial'], winDen: 0.30, band: 0.40, decal: 0.45, dust: 0.55, varB: 0.4, peel: 0.04, lamp: 0xf4ffd8,
              bulb: 'green_shade', bulbP: 0.36, fire: 1, hole: 'Mod_wallhole_lath_%_workshop' },
};
/* per fixture: k (the starting intensity, LightBaker's units: E ~ k at 1 m; WP6 calibrates), col (linear; else the floor's lamp colour),
   c: a wall lamp's light centre from its origin on the wall plane at floor level [along, up, out] (m) */
const CANDLE = [1, 0.55, 0.25];
const FX = {
  sconce_shade: { k: 1.6, c: [0, 2.0, 0.2] }, sconce_candles: { k: 1.0, c: [0, 1.97, 0.14], col: CANDLE }, bulkhead: { k: 1.6, c: [0, 2.1, 0.09] },
  pendant_shade: { k: 2.4 }, chandelier: { k: 4 }, bare_bulb: { k: 2 }, bulb_batten: { k: 1.8 }, green_shade: { k: 2.2 }, batten_light: { k: 1.6 },
  night_light: { k: 0.35, col: [1, 0.62, 0.42] }, hurricane_lantern: { k: 0.8, col: CANDLE }, candelabrum: { k: 1.0, col: CANDLE },
  standard_lamp: { k: 1.4 }, anglepoise: { k: 1.0 }, boiler_glow: { k: 1.8, col: [1, 0.42, 0.15] }, kiln_glow: { k: 2.4, col: [1, 0.5, 0.2] },
  fire_embers: { k: 1.5, col: [1, 0.38, 0.12] },
};
// a practical lamp in its furniture: the light in the box's own frame [across, up, along the front] (m from the box centre; hz/hx = half
// depth/width), and its state ('glow': baked at 40% with an emissive pulse, C1; 'flicker': a flicker candidate; 'ok': steady; 'vh': like a lamp)
const PRACT = {
  boiler_glow: { at: (hx, hz) => [0, 0.45, hz - 0.08], state: 'glow', front: 1 }, kiln_glow: { at: (hx, hz) => [0, 0.6, hz - 0.08], state: 'glow', front: 1 },
  candelabrum: { at: () => [0, 1.02, 0], state: 'flicker' }, standard_lamp: { at: (hx, hz) => [hx - 0.25, 1.45, 0.25 - hz], state: 'ok' },
  hurricane_lantern: { at: hx => [-hx * 0.4, 0.82, 0], state: 'flicker' }, anglepoise: { at: (hx, hz) => [hx * 0.3, 1.25, hz * 0.35], state: 'vh' },
};
// rugs [w, l] (m), B6
const RUG = { runner: [0.9, 0.9], round: [1.6, 1.6], kilim: [1.4, 2.0], oriental: [1.7, 2.4], rag: [0.7, 1.2], jute: [1.0, 1.5] };
// room types: a hall's template, or (small rooms cut off by doorways, plain corridors) one of its style's, by vh (safety B8)
const SMALL = { wood: ['nursery', 'playroom', 'washroom', 'linen'], tile: ['parlour', 'gallery', 'study'], concrete: ['store', 'laundry', 'coal'],
  attic: ['junk', 'trunks', 'eaves'], workshop: ['parts', 'kiln', 'paint'] };
const TYPE_OF = { nursery_dormitory: 'nursery', playroom: 'playroom', night_nursery: 'nursery', washroom: 'washroom', schoolroom: 'playroom',
  gallery: 'gallery', portrait_hall: 'gallery', dining_room: 'parlour', parlour: 'parlour', library: 'study', colonnade: 'gallery', servants_hall: 'service',
  boiler_room: 'store', storage: 'store', laundry: 'laundry', coal_store: 'coal', wine_cellar: 'store', workroom: 'store',
  truss_hall: 'junk', storeroom: 'trunks', servants_dormitory: 'eaves', hideout: 'junk', box_room: 'trunks', sheet_room: 'junk',
  assembly_floor: 'parts', casting_hall: 'kiln', kiln_room: 'kiln', eye_room: 'parts', office: 'parts', paint_room: 'paint', parts_store: 'parts' };
// the furniture a room type prefers (4x the weight of its style's other pieces)
const PREF = {
  nursery: 'dresser changing_table night_stand kids_frames doll_shelf wall_clock', playroom: 'toy_shelf puppet_theatre bookshelf_low kids_frames doll_shelf',
  washroom: 'washstand coat_hooks', linen: 'dresser coat_hooks bookshelf_low', parlour: 'console grandfather_clock sideboard gilt_mirror',
  gallery: 'doll_cabinet china_cabinet hall_bench gilt_mirror', study: 'china_cabinet console grandfather_clock', service: 'bell_board hall_bench',
  store: 'metal_shelf barrel pegboard', laundry: 'utility_sink water_heater', coal: 'coal_bin barrel',
  junk: 'box_stack rolled_rug leaning_mirror', trunks: 'suitcase_pile box_stack', eaves: 'mannequin frames_leaning leaning_mirror',
  parts: 'parts_drawers filing_cabinet head_shelf limb_hooks', kiln: 'tool_wall paint_shelf parts_drawers', paint: 'paint_shelf tool_wall eye_shelf',
  corridor_wood: 'wall_clock kids_frames coat_hooks', corridor_tile: 'console hall_bench umbrella_stand grandfather_clock gilt_mirror',
  corridor_concrete: 'fuse_box pegboard barrel', corridor_attic: 'box_stack frames_leaning', corridor_workshop: 'tool_wall filing_cabinet eye_shelf',
};
const SPECIAL_BAND = { radiator: 1, console_mirror: 1, cobweb_card: 1, service_shelf: 1, bell_board: 1, conduit: 1 };
// wall decals (D4): size [lo, hi] (m), height of the centre [lo, hi] or top: from the ceiling line down; weights per style
const DK = { drawing: { s: [0.3, 0.6], v: [0.3, 1.1] }, handprint: { s: [0.15, 0.3], v: [0.5, 1.6] }, stain: { s: [0.5, 1.2], top: 1 },
  mould: { s: [0.4, 0.9], top: 1 }, crack: { s: [0.4, 1.0], v: [0.6, 2.2] }, scratch: { s: [0.3, 0.6], v: [0.6, 1.7] }, flakes: { s: [0.3, 0.7], v: [0.3, 1.8] },
  rust: { s: [0.4, 1.0], top: 1 }, damp: { s: [1.2, 1.8], v: [0.4, 0.4] }, ghost: { s: [0.5, 0.7], v: [1.5, 1.8] } };
const DW = { wood: 'drawing 3 handprint 2 stain 2 crack 1 scratch 1 mould 1 ghost 1', tile: 'stain 3 crack 2 handprint 1 mould 1 ghost 2 scratch 1',
  concrete: 'stain 3 damp 2 mould 2 rust 1 crack 1 handprint 1', attic: 'stain 3 mould 2 crack 2 scratch 1 handprint 1',
  workshop: 'stain 2 rust 2 handprint 2 crack 1 flakes 2 scratch 1' };
const weights = s => { const a = s.split(' '), o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], +a[i + 1]]); return o; };
const DWP = {}; for (const k in DW) DWP[k] = weights(DW[k]);

/* ---------- reading env ---------- */
function decodeSolid(a) {
  const id = KIT.solidIds[a[0]] || null, base = id ? KIT.items[id] : null, it = base ? Object.assign({}, base, (base.var || [])[a[6]]) : { slot: 'pocket', h: 1, occ: 'none' };
  const s = { k: a[0], id, kind: it.slot, x0: a[1] / 2, y0: a[2] / 2, x1: a[3] / 2, y1: a[4] / 2, rot: a[5], v: a[6], h: it.h, occ: it.occ, isl: null };
  if (s.kind === 'island') s.isl = [Math.floor((s.x0 + s.x1) / 2 / TU), Math.floor((s.y0 + s.y1) / 2 / TU)];
  return s;
}
// a hall's gable ceiling at a in tiles across its ridge (layout.js gableAt, the same arithmetic so the heights agree to the bit)
function gableAt(r, a) {
  const al = r.flags & 1, c = al ? (r.tx0 + r.tx1 + 1) / 2 : (r.ty0 + r.ty1 + 1) / 2, hw = al ? (r.tx1 - r.tx0 + 1) / 2 : (r.ty1 - r.ty0 + 1) / 2;
  return r.t.eave + (r.t.ceil - r.t.eave) * Math.max(0, 1 - Math.abs(a - c) / hw);
}
function norm(env) {
  const e = env || {}, fi = def(e.floorIdx, def(e.i, 0)) | 0, Fl = typeof FLOORS !== 'undefined' ? FLOORS[fi] : null;
  const g = e.grid || e.rows; if (!g) throw new Error('Dress.plan: env.grid (or rows) is required');
  let GW = e.GW, GH = e.GH;
  const flat = ArrayBuffer.isView(g) && GW > 0 && GH > 0 && g.length === GW * GH;
  if (!flat) { GH = g.length; GW = g[0].length; }
  const n = GW * GH, W = new Uint8Array(n);
  if (flat) for (let i = 0; i < n; i++) W[i] = g[i] ? 1 : 0;
  else for (let y = 0; y < GH; y++) { const r = g[y]; for (let x = 0; x < GW; x++) W[y * GW + x] = (typeof r === 'string' ? r.charCodeAt(x) === 49 : +r[x] === 1) ? 1 : 0; }
  const isW = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || W[y * GW + x] === 1;
  const TPL = typeof HALL_TEMPLATES !== 'undefined' ? HALL_TEMPLATES : {}, IDS = typeof HALL_TEMPLATE_IDS !== 'undefined' ? HALL_TEMPLATE_IDS : [];
  const rooms = (e.rooms || e.ROOMS || []).map((r, i) => {
    if (Array.isArray(r)) { const id = IDS[r[0]]; r = { id, t: TPL[id], tx0: r[1], ty0: r[2], tx1: r[3], ty1: r[4], flags: r[5] }; }
    const t = r.t || TPL[r.id] || { kind: 'room', ceil: 3, roof: 'flat' };
    return { i, id: r.id, t, tx0: r.tx0, ty0: r.ty0, tx1: r.tx1, ty1: r.ty1, flags: r.flags | 0, kind: t.kind || 'room', gable: t.roof === 'gable' };
  });
  const runs = (e.runs || e.RUNS || []).map(r => Array.isArray(r) ? { tx0: r[1], ty0: r[2], tx1: r[3], ty1: r[4] } : { tx0: r.tx0, ty0: r.ty0, tx1: r.tx1, ty1: r.ty1 });
  const solids = (e.solids || e.SOLIDS || []).map(s => Array.isArray(s) ? decodeSolid(s) : s).map((s, i) => {
    const it = (s.id && KIT.items[s.id]) || {};
    return { i, id: s.id, kind: s.kind, rot: s.rot | 0, h: s.h, occ: s.occ, isl: s.isl, fix: it.fix || null, top: Math.max(s.h || 0, it.top || 0),
      x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, mx0: s.x0 * UM, mz0: s.y0 * UM, mx1: s.x1 * UM, mz1: s.y1 * UM };
  });
  // ceilings: the floor's own, a hall's, 2.55 in a servant run (layout.js ceilings, the same Float32 values)
  let C = e.CEIL || e.ceil;
  if (!(C && C.length === n)) {
    C = new Float32Array(n).fill(Fl && Fl.ceil ? Fl.ceil : def(e.ceilBase, CEIL0[fi] || 3));
    for (const r of rooms) for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) {
      const a = r.flags & 1 ? x : y; C[y * GW + x] = r.gable ? Math.min(gableAt(r, a), gableAt(r, a + 1)) : r.t.ceil; }
    const sc = typeof SERVANT_CEIL !== 'undefined' ? SERVANT_CEIL : 2.55;
    for (const r of runs) for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) C[y * GW + x] = sc;
  }
  const gid = new Int16Array(n).fill(-1), gab = [];
  for (const r of rooms) { if (!r.gable) continue;
    const al = !!(r.flags & 1), x0 = r.tx0 * L, x1 = (r.tx1 + 1) * L, z0 = r.ty0 * L, z1 = (r.ty1 + 1) * L;
    gab[r.i] = { e: r.t.eave, r: r.t.ceil, y: al, c: al ? (x0 + x1) / 2 : (z0 + z1) / 2, hw: al ? (x1 - x0) / 2 : (z1 - z0) / 2 };
    for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) gid[y * GW + x] = r.i; }
  const gabH = (q, xm, zm) => q.e + (q.r - q.e) * Math.max(0, 1 - Math.abs((q.y ? xm : zm) - q.c) / q.hw);
  const tileM = (xm, zm) => clamp(Math.floor(zm / L), 0, GH - 1) * GW + clamp(Math.floor(xm / L), 0, GW - 1);
  const ceilXZ = (xm, zm) => { const t = tileM(xm, zm), k = gid[t]; return k < 0 ? C[t] : gabH(gab[k], xm, zm); };
  const tileOf = c => Array.isArray(c) ? [c[0], c[1]] : [Math.floor(c.x / TU), Math.floor(c.y / TU)];
  const closets = (e.closets || []).map(c => Array.isArray(c) ? [c[0], c[1], c[2], c[3]] : [Math.floor(c.x / TU), Math.floor(c.y / TU), c.ox, c.oy]);
  const ex = e.exit ? (Array.isArray(e.exit) ? [e.exit[0], e.exit[1]] : [e.exit.tx, e.exit.ty]) : null;
  let exitDir = e.exitDir || null;
  if (ex && !exitDir) {          // (level.js exitDir: the back wall of the dead end, or any wall of that tile)
    const open = DIRS4.filter(([dx, dy]) => !isW(ex[0] + dx, ex[1] + dy)), cand = DIRS4.filter(([dx, dy]) => isW(ex[0] + dx, ex[1] + dy));
    exitDir = cand.find(([dx, dy]) => open.some(([ox, oy]) => ox === -dx && oy === -dy)) || cand[0] || [0, -1];
  }
  const puzzles = (e.puzzles || []).map(p => ({ cell: [p.cell[0], p.cell[1]], dir: [p.dir[0], p.dir[1]] }));
  const notes = (e.notes || []).map(q => tileOf(q));
  const creaks = (e.creaks || []).map(b => Array.isArray(b) ? { x: b[0], y: b[1], along: b[2], len: b[3] || BOARD_SHORT } : { x: b.x, y: b.y, along: b.along, len: b.len || BOARD_SHORT })
    .map(b => Object.assign(b, { mid: b.len > BOARD_SHORT, tx: Math.floor(b.x / TU), ty: Math.floor(b.y / TU) }));
  const style = e.style || (Fl && Fl.style) || STYLE_OF[fi] || 'wood', seed = def(e.VSEED, def(e.seed, 0)) >>> 0;
  return { fi, GW, GH, n, W, isW, rooms, runs, solids, C, gid, gab, gabH, ceilXZ, tileM, closets, exit: ex, exitDir, puzzles, notes, creaks,
    style, S: ST[style] || ST.wood, frames: def(e.frames, Fl && Fl.frames !== undefined ? Fl.frames : def(FRAMES[fi], 0.1)), seed, vh: vhOf(seed) };
}

/* ---------- doorways (A9.3) ----------
   A connector with walls on both sides that is a hall's way in (always) or passes vh(x, y, 311) <= 0.72. Never a servant run tile, and
   never a tile inside a hall: a hallway is one space, not a row of doors (the spec's rule read literally would frame every other tile). */
function doorTiles(E) {
  const { GW, GH, isW, vh, rooms, runs } = E, hallAt = new Int16Array(GW * GH).fill(-1), runAt = new Uint8Array(GW * GH), out = [];
  for (const r of rooms) for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) hallAt[y * GW + x] = r.i;
  for (const r of runs) for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) runAt[y * GW + x] = 1;
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const t = y * GW + x; if (isW(x, y) || hallAt[t] >= 0 || runAt[t]) continue;
    const ns = isW(x - 1, y) && isW(x + 1, y), ew = isW(x, y - 1) && isW(x, y + 1);
    if (ns === ew) continue;                                 // (walls on both sides, one way through)
    let hall = -1; for (const [dx, dy] of DIRS4) { const h = hallAt[(y + dy) * GW + x + dx]; if (h >= 0) { hall = h; break; } }
    if (hall < 0 && ((x + y) % 2 === 0 || vh(x, y, 311) > 0.72)) continue;
    out.push({ x, y, axis: ns ? 'z' : 'x', perimeter: hall >= 0, hall });
  }
  return out;
}

/* ---------- the plan ---------- */
function plan(env) {
  const t0 = now(), E = norm(env), { GW, GH, n, isW, vh, rooms, runs, solids, C, gid, gab, gabH, ceilXZ, tileM, style, S } = E;
  const ARCH = KIT.arch.pieces, BAND = KIT.band, FIXK = KIT.fixtures, idx = (x, y) => y * GW + x;
  const P = { v: 1, style, floorIdx: E.fi, seed: E.seed, GW, GH, L, faces: [], doorways: [], doorKeys: [], decorFaces: [], windows: [], modules: [],
    fixtures: [], band: [], dolls: [], rugs: [], beams: [], identities: null, decalSources: null, wet: [], dust: null, paths: null, moon: null, gables: [], stats: {} };

  /* tile maps */
  const hallAt = new Int16Array(n).fill(-1), runAt = new Int16Array(n).fill(-1), keep = new Uint8Array(n), noteT = new Uint8Array(n), islT = new Uint8Array(n);
  const boardsAt = new Array(n).fill(null), doorAt = new Int16Array(n).fill(-1), fixT = new Uint8Array(n), ceilBusy = new Uint8Array(n);
  for (const r of rooms) for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) hallAt[idx(x, y)] = r.i;
  runs.forEach((r, k) => { for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) runAt[idx(x, y)] = k; });
  for (const c of E.closets) keep[idx(c[0], c[1])] = 1;
  if (E.exit) keep[idx(E.exit[0], E.exit[1])] = 2;
  for (const q of E.notes) if (q[0] >= 0 && q[1] >= 0 && q[0] < GW && q[1] < GH) noteT[idx(q[0], q[1])] = 1;
  for (const s of solids) if (s.isl) islT[idx(s.isl[0], s.isl[1])] = 1;
  for (const b of E.creaks) if (b.tx >= 0 && b.ty >= 0 && b.tx < GW && b.ty < GH) (boardsAt[idx(b.tx, b.ty)] || (boardsAt[idx(b.tx, b.ty)] = [])).push(b);
  const straight = (x, y) => { const ns = isW(x - 1, y) && isW(x + 1, y), ew = isW(x, y - 1) && isW(x, y + 1); return ns === ew ? null : ns ? 'z' : 'x'; };
  const hallAxisX = r => r.tx1 - r.tx0 >= r.ty1 - r.ty0;
  // boxes near each tile (grown by 1.2 m), for "is there furniture in front of this face" tests
  const bucket = new Array(n).fill(null);
  for (const s of solids) for (let y = Math.max(0, Math.floor((s.mz0 - 1.2) / L)); y <= Math.min(GH - 1, Math.floor((s.mz1 + 1.2) / L)); y++)
    for (let x = Math.max(0, Math.floor((s.mx0 - 1.2) / L)); x <= Math.min(GW - 1, Math.floor((s.mx1 + 1.2) / L)); x++) (bucket[idx(x, y)] || (bucket[idx(x, y)] = [])).push(s);
  const boxIn = (t, x0, z0, x1, z1, pred) => { const b = bucket[t]; if (b) for (const s of b) if (s.mx0 < x1 && s.mx1 > x0 && s.mz0 < z1 && s.mz1 > z0 && (!pred || pred(s))) return s; return null; };

  /* faces, in wallGeometry's order */
  const F = P.faces, faceAt = new Int32Array(n * 4).fill(-1), dirIx = (nx, nz) => nz === 1 ? 0 : nz === -1 ? 1 : nx === 1 ? 2 : 3;
  const faceOf = (x, y, nx, nz) => x < 0 || y < 0 || x >= GW || y >= GH ? -1 : faceAt[idx(x, y) * 4 + dirIx(nx, nz)];
  const addFace = (x0, z0, x1, z1, nx, nz, x, y) => {
    const t = idx(x, y), k = gid[t], f = { x0, z0, x1, z1, nx, nz, x, y, h: 0, hs: null, kind: 'main', variant: 0, border: false, hall: hallAt[t], run: runAt[t],
      side: null, inset: 0, busy: [], skip: false, mod: null, used: [] };
    if (k < 0) f.h = C[t];
    else { const hs = FACE_U.map(u => gabH(gab[k], x0 + (x1 - x0) * u, z0 + (z1 - z0) * u)); f.h = Math.max.apply(null, hs); f.hs = hs.map(r4); }
    const bx = x - nx, by = y - nz; f.border = bx === 0 || by === 0 || bx === GW - 1 || by === GH - 1;
    if (f.run >= 0) { const r = runs[f.run], ax = r.tx1 > r.tx0; f.side = (ax ? nz !== 0 : nx !== 0) ? 'side' : 'end'; f.inset = f.side === 'side' ? RUN_INSET : 0; f.kind = 'service'; }
    else if (f.hall >= 0 && rooms[f.hall].kind === 'hallway') f.side = (hallAxisX(rooms[f.hall]) ? nz !== 0 : nx !== 0) ? 'side' : 'end';
    if (f.kind !== 'service' && f.h > 3.0 + 1e-6) f.kind = 'upper';
    faceAt[t * 4 + dirIx(nx, nz)] = F.length; F.push(f);
  };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (isW(x, y)) continue;
    const X0 = x * L, X1 = X0 + L, Z0 = y * L, Z1 = Z0 + L;
    if (isW(x, y - 1)) addFace(X0, Z0, X1, Z0, 0, 1, x, y);
    if (isW(x, y + 1)) addFace(X1, Z1, X0, Z1, 0, -1, x, y);
    if (isW(x - 1, y)) addFace(X0, Z1, X0, Z0, 1, 0, x, y);
    if (isW(x + 1, y)) addFace(X1, Z0, X1, Z1, -1, 0, x, y);
  }
  const fkey = f => f.x * 7 + f.nx, fkeyY = f => f.y * 7 + f.nz;            // (a face's own hash coordinates, as level.js uses them)
  const fpt = (f, u, d) => [f.x0 + (f.x1 - f.x0) * u + f.nx * d, f.z0 + (f.z1 - f.z0) * u + f.nz * d];
  const boxFront = (f, u0, u1, d, pred) => { const a = fpt(f, u0, 0), b = fpt(f, u1, d);
    return boxIn(idx(f.x, f.y), Math.min(a[0], b[0]) + 1e-4, Math.min(a[1], b[1]) + 1e-4, Math.max(a[0], b[0]) - 1e-4, Math.max(a[1], b[1]) - 1e-4, pred); };
  // the lowest the ceiling gets over u0..u1 of a face (gable end walls rise to the middle)
  const minH = (f, u0, u1) => { if (!f.hs) return f.h; const k = gid[idx(f.x, f.y)]; let m = 1e9;
    for (const u of [u0, 0.5 * (u0 + u1), u1]) { const p = fpt(f, u, 0); m = Math.min(m, gabH(gab[k], p[0], p[1])); } return m; };
  const use = (i, what) => { F[i].used.push(what); };
  const ry = f => r4(Math.atan2(f.nx, f.nz));
  const free = f => !f.busy.length && !f.skip;

  /* doorways, then why each face is busy */
  for (const d of doorTiles(E)) {
    const { x, y, axis } = d, t = idx(x, y), cx = (x + 0.5) * L, cz = (y + 0.5) * L, H = C[t];
    // which way the two leaves swing (along the passage), each leaf's rest angle 72..88 deg (tip 0.11 + cos(rest) <= 0.42 m from its wall)
    const swing = vh(x, y, 314) < 0.5 ? -1 : 1, bs = boardsAt[t] || [];
    let board = 'none', pinSide = 0;
    for (const b of bs) {
      if (b.mid || (axis === 'z' ? b.along !== 1 : b.along !== 0)) { board = 'long'; break; }
      board = 'side'; pinSide = Math.sign(axis === 'z' ? b.x - (x * TU + TU / 2) : b.y - (y * TU + TU / 2)) || 1;
    }
    const leaves = board === 'long' ? [] : [-1, 1].map(s => {
      const pin = board === 'side' && s === pinSide, rest = pin ? 90 : r4(72 + 16 * vh(x, y, s < 0 ? 312 : 313)), a = s * (L / 2 - 0.11);
      return { side: s, hinge: axis === 'z' ? [r4(cx + a), r4(cz)] : [r4(cx), r4(cz + a)], rest, pin, tip: r4(0.11 + Math.cos(rest * PI / 180) * 1.0) };
    });
    doorAt[t] = P.doorways.length;
    P.doorways.push({ x, y, axis, cx: r4(cx), cz: r4(cz), ry: axis === 'z' ? 0 : r4(PI / 2), perimeter: d.perimeter, hall: d.hall,
      frame: 'Door_frame_' + style, leaf: 'Door_leaf_' + style, head: { y0: 2.6, y1: r4(H), skip: H - 2.6 < 0.08 }, swing, board, leaves });
    P.doorKeys.push(x + ',' + y);
  }
  const pzKey = new Set(E.puzzles.map(p => p.cell[0] + ',' + p.cell[1] + ',' + (-p.dir[0]) + ',' + (-p.dir[1])));
  F.forEach(f => { const t = idx(f.x, f.y);
    if (pzKey.has(f.x + ',' + f.y + ',' + f.nx + ',' + f.nz)) f.busy.push('puzzle');
    if (keep[t] === 2) f.busy.push('exit'); else if (keep[t] === 1) f.busy.push('wardrobe');
    if (doorAt[t] >= 0) f.busy.push('door'); });

  /* room identities: halls, servant runs, and the small rooms that the doorways cut the rest into (brief B3, safety B8) */
  const tileSpace = new Int16Array(n).fill(-1), spaces = [];
  const decalMulOf = type => type === 'nursery' || type === 'playroom' ? { drawing: 3 } : type === 'washroom' || type === 'laundry' ? { stain: 1.6 } : type === 'coal' ? { stain: 2 } : {};
  for (const r of rooms) { const type = TYPE_OF[r.id] || (r.kind === 'hallway' ? 'corridor' : SMALL[style][0]);
    spaces.push({ id: spaces.length, type, hall: r.i, run: -1, identity: r.t.identity || r.id, template: r.id, tiles: 0,
      decalMul: Object.assign(decalMulOf(type), r.t.decalMul || {}), dustMul: 1.3 }); }
  for (const r of runs) spaces.push({ id: spaces.length, type: 'service', hall: -1, run: spaces.length - rooms.length, identity: 'a servant corridor', template: null, tiles: 0, decalMul: { stain: 0.7 }, dustMul: 0.8 });
  for (let t = 0; t < n; t++) { if (E.W[t]) continue; if (hallAt[t] >= 0) tileSpace[t] = hallAt[t]; else if (runAt[t] >= 0) tileSpace[t] = rooms.length + runAt[t]; }
  for (let t0i = 0; t0i < n; t0i++) {
    if (E.W[t0i] || tileSpace[t0i] >= 0 || doorAt[t0i] >= 0) continue;
    const id = spaces.length, q = [t0i]; tileSpace[t0i] = id; let st = 0, start = false;
    for (let h = 0; h < q.length; h++) { const t = q[h], x = t % GW, y = (t / GW) | 0;
      if (straight(x, y)) st++; if (x <= 4 && y <= 4) start = true;
      for (const [dx, dy] of DIRS4) { const u = idx(x + dx, y + dy); if (!isW(x + dx, y + dy) && tileSpace[u] < 0 && doorAt[u] < 0) { tileSpace[u] = id; q.push(u); } } }
    const x0 = t0i % GW, y0 = (t0i / GW) | 0, sm = SMALL[style];
    const type = start ? 'start' : q.length >= 4 && st >= 0.6 * q.length ? 'corridor' : sm[(vh(x0, y0, 701) * sm.length) | 0];
    spaces.push({ id, type, hall: -1, run: -1, identity: type, template: null, tiles: q.length, decalMul: decalMulOf(type), dustMul: type === 'start' ? 0.7 : 1 });
  }
  for (const d of P.doorways) { const t = idx(d.x, d.y);                 // (a doorway belongs to the first space beside it)
    for (const [dx, dy] of DIRS4) { const u = idx(d.x + dx, d.y + dy); if (!isW(d.x + dx, d.y + dy) && doorAt[u] < 0 && tileSpace[u] >= 0) { tileSpace[t] = tileSpace[u]; break; } } }
  for (let t = 0; t < n; t++) if (tileSpace[t] >= 0 && spaces[tileSpace[t]]) spaces[tileSpace[t]].tiles += (hallAt[t] >= 0 || runAt[t] >= 0 || doorAt[t] >= 0) ? 1 : 0;
  const spaceOfFace = f => spaces[tileSpace[idx(f.x, f.y)]] || null;
  const typeOfFace = f => { const s = spaceOfFace(f); return s ? s.type : 'corridor'; };
  P.identities = { spaces, tileSpace };

  /* portraits and painted words (wallDecor's rule with vh): first, so nothing else goes on those faces. A hall's template may scale
     either (decalMul.portrait, decalMul.word); the tile floor's hallways hang 1.5x the portraits (A9.2) unless their template says */
  let nw = 0, nc = 0;
  const words = typeof DECAL_WORDS !== 'undefined' ? DECAL_WORDS : null;
  const decorMul = r => { const m = r.t.decalMul || {}; return [m.portrait || (r.kind === 'hallway' && style === 'tile' ? 1.5 : 1), m.word || 1]; };
  F.forEach((f, i) => {
    if (f.busy.length || f.run >= 0) return;
    const r = vh(fkey(f), fkeyY(f), 91), mul = f.hall >= 0 ? decorMul(rooms[f.hall]) : [1, 1], fr = E.frames * mul[0];
    if (r >= fr + 0.045 * mul[1]) return;
    if (boxFront(f, 0.3, 0.7, 0.6, s => s.top > 1.35)) return;           // (not behind a boiler or a tall cabinet)
    if (r < fr) {
      const kind = vh(f.x, f.y, 197), watch = kind < 0.3 && nw < 6, glow = vh(f.x, f.y, 98) > 0.55, change = !watch && !glow && kind > 0.55 && nc < 6;
      if (watch) nw++; else if (change) nc++;
      P.decorFaces.push({ face: i, kind: 'portrait', watch, glow, change, pick: (vh(f.x, f.y, 99) * 3) | 0, word: -1, text: null, y: watch ? 1.66 : 1.72,
        w: watch ? 0.66 : 0.44, h: watch ? 0.84 : 0.56, rz: 0 });
    } else {
      const wi = (vh(f.x, f.y, 92) * (words ? words.length : 7)) | 0;
      P.decorFaces.push({ face: i, kind: 'word', watch: false, glow: false, change: false, pick: -1, word: wi, text: words ? words[wi] : null,
        y: r4(1.2 + vh(f.x, f.y, 93) * 0.6), w: 1.2, h: 0.6, rz: r4((vh(f.x, f.y, 94) - 0.5) * 0.25) });
    }
    f.busy.push('decor'); use(i, 'decor');
  });

  /* wallpaper variant per face (B on worn faces), later forced on faces with peel or holes */
  F.forEach(f => { f.variant = vh(fkey(f), fkeyY(f), 401) < S.varB ? 1 : 0; });

  /* windows: outer faces only, never busy, never a servant run, never behind furniture; one of any two neighbouring faces (C6, B5) */
  const moonAz = r4(vh(0, 0, 901) * 2 * PI), moonEl = r4((32 + 6 * vh(0, 0, 902)) * PI / 180), mx = Math.sin(moonAz), mz = Math.cos(moonAz), COS75 = Math.cos(75 * PI / 180);
  P.moon = { az: moonAz, el: moonEl, k: 0.7, color: 0x8fa6d8, colorLin: lin(0x8fa6d8) };       // (az: toward the moon is (sin az, cos az) in x, z)
  const winAt = new Set(), skipFace = (i, type, k) => { F[i].skip = true; F[i].mod = { type, i: k }; };
  F.forEach((f, i) => {
    if (!f.border || !free(f) || f.run >= 0) return;
    const p = f.hall >= 0 && rooms[f.hall].kind === 'hallway' && f.side === 'side' ? 0.5 : S.winDen;
    if (vh(fkey(f), fkeyY(f), 501) >= p) return;
    const tx = Math.sign(f.x1 - f.x0), tz = Math.sign(f.z1 - f.z0);
    if (winAt.has(faceOf(f.x - tx, f.y - tz, f.nx, f.nz)) || winAt.has(faceOf(f.x + tx, f.y + tz, f.nx, f.nz))) return;
    if (boxFront(f, 0.05, 0.95, 0.8)) return;
    const base = S.win.length > 1 && vh(f.x, f.y, 502) < 0.3 ? S.win[1] : S.win[0];
    let node = null;
    for (const nm of minH(f, 0.05, 0.95) < 2.9 ? [base + '_short', base] : [base]) {
      const a = ARCH[nm]; if (!a || !a.open) continue;
      const [w, h, sill] = a.open, u0 = 0.5 - w / (2 * L), u1 = 0.5 + w / (2 * L);
      if (sill + h <= minH(f, u0, u1) - 0.08) { node = { nm, w, h, sill, u0, u1 }; break; }
    }
    if (!node) return;
    const lit = -f.nx * mx + -f.nz * mz >= COS75, a = ARCH[node.nm], k = P.windows.length;
    P.windows.push({ face: i, x: f.x, y: f.y, type: node.nm.replace(/^Win_/, ''), node: node.nm, u0: r4(node.u0), u1: r4(node.u1), v0: node.sill, v1: r4(node.sill + node.h),
      moonlit: lit, curtain: (a.children || []).some(c => /_curtain$/.test(c)) ? (vh(f.x, f.y, 503) < 0.7 ? 'open' : 'half') : null,
      broken: style === 'workshop' || vh(f.x, f.y, 504) < 0.15, pos: [r4((f.x0 + f.x1) / 2), 0, r4((f.z0 + f.z1) / 2)], ry: ry(f) });
    winAt.add(i); skipFace(i, 'window', k); use(i, 'window');
  });

  /* modules on faces: the exit porch, fireplaces, fake closed doors in hallways, niches, wall holes */
  const addMod = (kind, node, i, extra) => { const f = F[i], k = P.modules.length;
    P.modules.push(Object.assign({ kind, node, face: i, x: f.x, y: f.y, pos: [r4((f.x0 + f.x1) / 2), 0, r4((f.z0 + f.z1) / 2)], ry: ry(f) }, extra || {}));
    skipFace(i, 'module', k); use(i, kind); return P.modules[k]; };
  if (E.exit) { const i = faceOf(E.exit[0], E.exit[1], -E.exitDir[0], -E.exitDir[1]); if (i >= 0 && ARCH['Exit_' + style]) addMod('exit', 'Exit_' + style, i); }
  const fires = [];
  if (S.fire && ARCH['Mod_fireplace_' + style]) for (const r of rooms) {
    if (r.kind !== 'room' || fires.length >= 2 || vh(r.tx0, r.ty0, 611) >= 0.7) continue;
    let best = -1, bv = 2;
    F.forEach((f, i) => { if (f.hall !== r.i || f.border || !free(f) || f.h < 2.7) return;
      const v = vh(fkey(f), fkeyY(f), 612); if (v < bv && !boxFront(f, 0.1, 0.9, 1.1)) { bv = v; best = i; } });
    if (best >= 0) fires.push(addMod('fireplace', 'Mod_fireplace_' + style, best));
  }
  for (const r of rooms) {
    if (r.kind !== 'hallway' || !ARCH['Door_closed_' + style]) continue;
    const ax = hallAxisX(r), len = ax ? r.tx1 - r.tx0 + 1 : r.ty1 - r.ty0 + 1, ph = vh(r.tx0, r.ty0, 654) < 0.5 ? 0 : 1;
    for (let j = 1; j < len; j += 2) {                   // (the connectors between its cells: at most one door every two tiles, sides taking turns)
      const x = ax ? r.tx0 + j : r.tx0, y = ax ? r.ty0 : r.ty0 + j, s = (((j - 1) / 2 + ph) % 2) ? 1 : -1;
      const i = ax ? faceOf(x, y, 0, s) : faceOf(x, y, s, 0);
      if (i < 0 || F[i].border || !free(F[i]) || vh(x, y, 655) >= 0.75 || boxFront(F[i], 0.2, 0.8, 0.6)) continue;
      addMod('door_closed', 'Door_closed_' + style, i);
    }
  }
  if (S.niche && ARCH[S.niche]) { let nn = 0;
    F.forEach((f, i) => { if (nn >= 4 || !free(f) || f.run >= 0 || vh(fkey(f), fkeyY(f), 615) >= 0.05 || boxFront(f, 0.25, 0.75, 0.5)) return;
      const tx = Math.sign(f.x1 - f.x0), tz = Math.sign(f.z1 - f.z0), nb = [faceOf(f.x - tx, f.y - tz, f.nx, f.nz), faceOf(f.x + tx, f.y + tz, f.nx, f.nz)];
      if (nb.some(j => j >= 0 && F[j].mod && F[j].mod.type === 'module' && P.modules[F[j].mod.i].kind === 'niche')) return;
      addMod('niche', S.niche, i); nn++; }); }
  { const want = 2 + ((vh(0, 0, 601) * 5) | 0), cand = [];      // wall holes: 2..6 a floor (D5)
    F.forEach((f, i) => { if (free(f) && f.run < 0 && !boxFront(f, 0.1, 0.9, 0.5)) cand.push([vh(fkey(f), fkeyY(f), 602), i]); });
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const holeT = new Set();
    for (const [, i] of cand) { if (P.modules.filter(m => m.kind === 'wallhole').length >= want) break;
      const f = F[i]; if (holeT.has(idx(f.x, f.y))) continue;
      const v = 'ABC'[(vh(f.x, f.y, 603) * 3) | 0], node = S.hole.replace('%', v); if (!ARCH[node]) continue;
      holeT.add(idx(f.x, f.y)); addMod('wallhole', node, i, { variant: v }); f.variant = 1; } }

  /* lamps (B8, C1): every one gets its state from vh: ok 65%, flicker 15% (at most 16 groups 14 m apart, the rest steady), dead 20% */
  const FXL = P.fixtures, lampCol = lin(S.lamp);
  const stateOf = (a, b, k) => { const r = vh(a, b, k); return r < 0.2 ? 'dead' : r < 0.35 ? 'flicker' : 'ok'; };
  const colOf = id => (FX[id] && FX[id].col) ? FX[id].col.slice() : lampCol.slice();
  const pushFix = o => { const it = FIXK[o.id];
    const f = Object.assign({ id: o.id, profile: o.id, node: it.node, emitNode: it.emit, mount: it.mount }, o, { color: o.color || colOf(o.id), k: o.k || (FX[o.id] ? FX[o.id].k : 2), group: -1 });
    for (const q of ['x', 'y', 'z', 'ox', 'oy', 'oz', 'nx', 'nz', 'ry']) f[q] = r4(f[q] || 0);
    FXL.push(f); return f; };
  // a lamp hanging from the ceiling at (xm, zm): drop = ceiling to its bottom. Bulbs: min(0.63, H - 2.35) (A10); shades and chandeliers
  // hang lower in tall rooms, never below 2.35 (chandelier 2.80); a batten sits flush. Returns null where the ceiling is too low for it,
  // or where a box under it rises past its bottom (a boiler's or kiln's flue, a column, a chimney breast: the lamp would hang inside it).
  const hang = (id, xm, zm, src, extra) => {
    const it = FIXK[id]; if (!it) return null;
    const Hc = ceilXZ(xm, zm), Hf = it.H;
    // (a hall's bulbs and shades hang lower in a tall room, but never higher than A10's bulb drop: a 2.7 m coal store still gets its 0.35 m)
    const drop = id === 'chandelier' ? Math.min(Hc - 2.8, 1.2) : id === 'pendant_shade' ? Math.min(Hc - 2.35, 0.9) : id === 'batten_light' ? Hf
      : src === 'hall' ? Math.max(Math.min(Hc - 2.6, Math.max(0.63, Hc - 3.0)), Math.min(0.63, Hc - 2.35)) : Math.min(0.63, Hc - 2.35);
    if (!(drop >= Hf - 1e-6)) return null;
    const bottom = Hc - drop, tx = Math.floor(xm / L), ty = Math.floor(zm / L);
    if (boxIn(tileM(xm, zm), xm - it.W / 2, zm - it.D / 2, xm + it.W / 2, zm + it.D / 2, s => s.top > bottom - 0.02)) return null;
    fixT[idx(tx, ty)] = 1;
    return pushFix(Object.assign({ id, x: xm, y: bottom + Hf * 0.45, z: zm, nx: 0, nz: 0, ox: xm, oy: bottom + Hf, oz: zm, ry: 0, state: stateOf(tx * 3 + 1, ty * 3 + 1, 961),
      tile: [tx, ty], face: -1, src, bottom: r4(bottom), cord: r4(Hc - bottom - Hf) }, extra || {}));
  };
  // a lamp on a wall face (its node's origin on the wall plane at floor level, at the face's middle)
  const onWall = (id, i, src) => {
    const f = F[i], c = (FX[id] && FX[id].c) || [0, 2.0, 0.12], o = fpt(f, 0.5, 0), p = fpt(f, 0.5, c[2]);
    use(i, 'lamp');
    return pushFix({ id, x: p[0], y: c[1], z: p[1], nx: f.nx, nz: f.nz, ox: o[0], oy: 0, oz: o[1], ry: ry(f), state: stateOf(fkey(f), fkeyY(f), 962), tile: [f.x, f.y], face: i, src });
  };
  // the halls' own ceiling lights over their middle tiles (even/even: 1 in a 2x2, 2 in a 2x3, 4 in a 3x3), a rose or coffer above each.
  // Where an island's flue (or a column) stands under one, the lamp moves to the nearest tile of the hall that's clear (and not lit yet)
  const roseOK = !!(S.rose && ARCH[S.rose]);
  for (const r of rooms) {
    if (r.kind !== 'room' || !r.t.lights || !r.t.lights.hang) continue;
    const tiles = []; for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) if (!keep[idx(x, y)]) tiles.push([x, y]);
    for (let y = r.ty0 + 1; y < r.ty1; y++) for (let x = r.tx0 + 1; x < r.tx1; x++) {
      if (x & 1 || y & 1) continue;
      const near = tiles.map(([a, b]) => [(a - x) ** 2 + (b - y) ** 2, vh(a, b, 453), a, b]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (const [, , a, b] of near) {
        if (fixT[idx(a, b)]) continue;
        const xm = (a + 0.5) * L, zm = (b + 0.5) * L, fx = hang(r.t.lights.hang, xm, zm, 'hall', { hall: r.i, moved: a !== x || b !== y });
        if (!fx) continue;
        if (roseOK && !r.gable) {
          P.modules.push({ kind: 'ceilingrose', node: S.rose, face: -1, x: a, y: b, pos: [r4(xm), r4(ceilXZ(xm, zm)), r4(zm)], ry: 0, fixture: FXL.length - 1 }); ceilBusy[idx(a, b)] = 1; }
        break;
      }
    }
  }
  // hallways: a lamp every two tiles (on their cells), wall lamps taking turns between the sides; ceiling ones down the middle
  for (const r of rooms) {
    if (r.kind !== 'hallway' || !r.t.lights) continue;
    const id = r.t.lights.wall, it = id && FIXK[id]; if (!it) continue;
    const ax = hallAxisX(r), len = ax ? r.tx1 - r.tx0 + 1 : r.ty1 - r.ty0 + 1, every = r.t.lights.every || 2, ph = vh(r.tx0, r.ty0, 651) < 0.5 ? 0 : 1;
    for (let j = 0, k = 0; j < len; j += every, k++) {
      const x = ax ? r.tx0 + j : r.tx0, y = ax ? r.ty0 : r.ty0 + j;
      if (it.mount === 'ceiling') { hang(id, (x + 0.5) * L, (y + 0.5) * L, 'hallway', { hall: r.i }); continue; }
      const s = (k + ph) % 2 ? 1 : -1;
      for (const q of [s, -s]) { const i = ax ? faceOf(x, y, 0, q) : faceOf(x, y, q, 0);
        if (i >= 0 && free(F[i]) && !boxFront(F[i], 0.4, 0.6, 0.35, b => b.top > 1.7)) { onWall(id, i, 'hallway').hall = r.i; break; } }
    }
  }
  // wall lamps elsewhere: fixDen per face (house.js), the halls' wall lamp in rooms
  F.forEach((f, i) => {
    if (!free(f) || f.run >= 0 || (f.hall >= 0 && rooms[f.hall].kind === 'hallway')) return;
    const room = f.hall >= 0, id = room && S.roomSconce ? S.roomSconce : S.sconce, den = room ? Math.max(S.fixDen, S.roomSconce ? 0.15 : 0) : S.fixDen;
    if (!id || vh(f.x * 5 + f.nx, f.y * 5 + f.nz, 95) > den) return;               // (house.js's coordinates and key)
    if (boxFront(f, 0.4, 0.6, 0.35, b => b.top > 1.7)) return;
    onWall(id, i, 'sconce');
  });
  // bulbs on cells for the bulb styles (vh(x, y, 97) < 0.3, 0.36 in the workshop), not in halls (their own lights) or servant runs
  if (S.bulb) for (let y = 1; y < GH; y += 2) for (let x = 1; x < GW; x += 2) {
    const t = idx(x, y); if (isW(x, y) || hallAt[t] >= 0 || runAt[t] >= 0 || vh(x, y, 97) >= S.bulbP) continue;
    hang(S.bulb, (x + 0.5) * L, (y + 0.5) * L, 'bulb');
  }
  // servant runs: batten lights flush with the ceiling, every two tiles
  runs.forEach((r, k) => { const ax = r.tx1 > r.tx0, len = ax ? r.tx1 - r.tx0 + 1 : r.ty1 - r.ty0 + 1;
    for (let j = 1; j < len; j += 2) { const x = ax ? r.tx0 + j : r.tx0, y = ax ? r.ty0 : r.ty0 + j;
      hang('batten_light', (x + 0.5) * L, (y + 0.5) * L, 'run', { ry: ax ? 0 : PI / 2, run: k }); } });
  // practical lamps in their furniture (boiler and kiln glow, the dining candelabrum, the parlour's standard lamp, lanterns, anglepoises)
  solids.forEach(s => {
    const pr = s.fix && PRACT[s.fix]; if (!pr || !FIXK[s.fix]) return;
    const th = s.rot * PI / 2, fx = Math.round(Math.sin(th)), fz = Math.round(Math.cos(th)), rx = fz, rz = -fx;   // (front = local +z, right = local +x)
    const cx = (s.mx0 + s.mx1) / 2, cz = (s.mz0 + s.mz1) / 2, ex = (s.mx1 - s.mx0) / 2, ez = (s.mz1 - s.mz0) / 2, hx = s.rot & 1 ? ez : ex, hz = s.rot & 1 ? ex : ez;
    const [a, b, c] = pr.at(hx, hz), px = cx + rx * a + fx * c, pz = cz + rz * a + fz * c, tx = Math.floor(px / L), ty = Math.floor(pz / L);
    const state = pr.state === 'vh' ? stateOf(tx * 3 + 2, ty * 3 + 2, 963) : pr.state;
    pushFix({ id: s.fix, x: px, y: b, z: pz, nx: pr.front ? fx : 0, nz: pr.front ? fz : 0, ox: px, oy: b, oz: pz, ry: th, state, tile: [tx, ty], face: -1, src: 'practical',
      solid: s.i, originIsCentre: true });
  });
  // fireplace embers (a practical glow in the firebox, just in front of the wall plane)
  for (const m of fires) { const f = F[m.face], p = fpt(f, 0.5, 0.06);
    pushFix({ id: 'fire_embers', x: p[0], y: 0.3, z: p[1], nx: f.nx, nz: f.nz, ox: p[0], oy: 0.3, oz: p[1], ry: ry(f), state: 'glow', tile: [f.x, f.y], face: m.face, src: 'fireplace',
      module: P.modules.indexOf(m), originIsCentre: true }); }

  /* ceiling pieces: skylights (per template), holes in the ceiling (1-2 a floor), the attic's loft ladder */
  const adj8 = (set, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (set.has(idx(x + dx, y + dy))) return true; return false; };
  // a box on the tile rising to within 0.6 m of its ceiling (a flue, a chimney breast, a column): no shaft or hole cut over it
  const tallOn = (x, y) => !!boxIn(idx(x, y), x * L, y * L, (x + 1) * L, (y + 1) * L, s => s.top > C[idx(x, y)] - 0.6);
  for (const r of rooms) {
    const want = r.t.lights && r.t.lights.skylights, node = 'Mod_skylight_' + style; if (!want || !ARCH[node]) continue;
    const cand = [], got = new Set(), q = r.gable ? gab[r.i] : null, rc = r.flags & 1 ? r.tx0 + r.tx1 + 1 : r.ty0 + r.ty1 + 1;   // (rc: twice the ridge line, in tiles)
    for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) {
      if (fixT[idx(x, y)] || ceilBusy[idx(x, y)] || tallOn(x, y)) continue;
      if (q && 2 * (r.flags & 1 ? x : y) + 1 === rc) continue;              // (never on the tile the ridge runs through: it'd sit on both slopes)
      cand.push([vh(x, y, 661), x, y]); }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const [, x, y] of cand) { if (got.size >= want) break; if (adj8(got, x, y)) continue;
      got.add(idx(x, y)); ceilBusy[idx(x, y)] = 1; const xm = (x + 0.5) * L, zm = (y + 0.5) * L;
      // its tilt: on a gable, the slope (rad), the way the roof rises (toward the ridge) and the ceiling's normal into the room
      let slope = 0, rise = null, normal = [0, -1, 0];
      if (q) { const s = (q.r - q.e) / q.hw, side = 2 * (r.flags & 1 ? x : y) + 1 < rc ? 1 : -1, k = 1 / Math.sqrt(1 + s * s);
        slope = r4(Math.atan(s)); rise = q.y ? [side, 0] : [0, side]; normal = [r4(rise[0] * s * k), r4(-k), r4(rise[1] * s * k)]; }
      P.modules.push({ kind: 'skylight', node, face: -1, x, y, pos: [r4(xm), r4(ceilXZ(xm, zm)), r4(zm)], ry: 0, hall: r.i, slope, rise, normal }); }
  }
  { const node = 'Mod_ceilhole_' + style;
    if (ARCH[node]) { const want = 1 + (vh(0, 0, 631) < 0.5 ? 1 : 0), cand = [], got = new Set();
      for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const t = idx(x, y);
        if (isW(x, y) || gid[t] >= 0 || runAt[t] >= 0 || doorAt[t] >= 0 || keep[t] || fixT[t] || ceilBusy[t] || C[t] < 2.7 - 1e-6 || (x <= 4 && y <= 4) || tallOn(x, y)) continue;
        cand.push([vh(x, y, 632), x, y]); }
      cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      for (const [, x, y] of cand) { if (got.size >= want) break; if (adj8(got, x, y)) continue;
        got.add(idx(x, y)); ceilBusy[idx(x, y)] = 1;
        P.modules.push({ kind: 'ceilhole', node, face: -1, x, y, pos: [r4((x + 0.5) * L), r4(C[idx(x, y)]), r4((y + 0.5) * L)], ry: 0 }); } } }
  if (S.ladder && ARCH.Band_attic_ladder) { let best = null, bv = 2;
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const t = idx(x, y), ax = straight(x, y);
      if (isW(x, y) || !ax || gid[t] >= 0 || runAt[t] >= 0 || doorAt[t] >= 0 || keep[t] || fixT[t] || ceilBusy[t] || (x <= 5 && y <= 5) || C[t] < 2.7 - 1e-6 || tallOn(x, y)) continue;
      const v = vh(x, y, 641); if (v < bv) { bv = v; best = [x, y, ax]; } }
    if (best) { const [x, y, ax] = best; ceilBusy[idx(x, y)] = 1;
      P.modules.push({ kind: 'ladder', node: 'Band_attic_ladder', face: -1, x, y, pos: [r4((x + 0.5) * L), r4(C[idx(x, y)]), r4((y + 0.5) * L)], ry: ax === 'z' ? 0 : r4(PI / 2) }); } }

  /* what stands against the walls (B6). Each face keeps the boxes already taken on it: [u0, u1, y0, y1, d], an item may not share both
     u and height with one unless it reaches out no further than d (a loose board lying 0.25 m out lets a 0.22 m shelf stand behind it) */
  const res = F.map(() => []);
  const fits = (i, u0, u1, y0, y1, d) => !res[i].some(q => u0 < q[1] && u1 > q[0] && y0 < q[3] && y1 > q[2] && d > q[4]);
  const reserve = (i, u0, u1, y0, y1, d) => { res[i].push([u0, u1, y0, y1, d || 0]); };
  // the other wall face of the same tile at end 0 (u = 0) or 1 of face i, where the two meet in an inside corner: [face, its u there]
  const cornerOf = (i, end) => { const f = F[i], tx = Math.sign(f.x1 - f.x0), tz = Math.sign(f.z1 - f.z0);
    const g = end ? faceOf(f.x, f.y, -tx, -tz) : faceOf(f.x, f.y, tx, tz); if (g < 0) return null;
    const G = F[g], cx = end ? f.x1 : f.x0, cz = end ? f.z1 : f.z0; return [g, Math.abs(G.x0 - cx) + Math.abs(G.z0 - cz) < 1e-6 ? 0 : 1]; };
  // take u0..u1 x y0..y1 on face i for something reaching `depth` out, and its share of an inside corner: on the face across the corner,
  // within that depth of the corner, only things reaching out no further than this one's distance from the corner (so the two never meet)
  const claim = (i, u0, u1, y0, y1, depth) => {
    reserve(i, u0 - 0.02, u1 + 0.02, y0, y1, 0);
    for (const end of [0, 1]) { const a0 = (end ? 1 - u1 : u0) * L; if (a0 >= REACH + 0.02) continue;
      const c = cornerOf(i, end); if (!c) continue; const w = (depth + 0.02) / L;
      reserve(c[0], c[1] ? 1 - w : -0.01, c[1] ? 1.01 : w, y0, y1, Math.max(0, a0 - 0.02)); }
  };
  // a servant run's end wall: its side walls stand 0.30 m proud of their wall planes, so nothing goes in the corners they fill
  F.forEach((f, i) => { if (f.run < 0 || f.inset) return;
    for (const end of [0, 1]) { const c = cornerOf(i, end); if (!c || !F[c[0]].inset) continue; const w = F[c[0]].inset / L + 0.01;
      reserve(i, end ? 1 - w : -0.01, end ? 1.01 : w, 0, 99, 0); } });
  // ... nor where a fireplace's breast and hearth (up to KIT D = 0.42 m proud, the face's whole width in the kit's envelope) meet the corner
  for (const m of fires) for (const end of [0, 1]) { const c = cornerOf(m.face, end); if (!c) continue; const w = ((ARCH[m.node].D || 0.42) + 0.02) / L;
    reserve(c[0], c[1] ? 1 - w : -0.01, c[1] ? 1.01 : w, 0, 99, 0); }
  FXL.forEach(fx => { if (fx.face >= 0 && fx.src !== 'fireplace') reserve(fx.face, 0.38, 0.62, 1.7, 2.4, 0); });   // (wall lamps, and room to breathe)
  // loose boards (floors.js: 13 u wide; a side board lies 0.25-0.92 m out from its wall, a long one runs wall to wall): on each face of the
  // board's tile, the part of the wall it lies in front of takes nothing that would reach out over it
  for (const bs of boardsAt) if (bs) for (const b of bs) {
    const hx = (b.along ? BOARD_W / 2 : b.len / 2) * UM, hz = (b.along ? b.len / 2 : BOARD_W / 2) * UM, cx = b.x * UM, cz = b.y * UM;
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const i = faceOf(b.tx, b.ty, nx, nz); if (i < 0) continue;
      const f = F[i], tx = (f.x1 - f.x0) / L, tz = (f.z1 - f.z0) / L; let d = 1e9, u0 = 1e9, u1 = -1e9;
      for (const [px, pz] of [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]]) {
        d = Math.min(d, (px - f.x0) * f.nx + (pz - f.z0) * f.nz); const u = ((px - f.x0) * tx + (pz - f.z0) * tz) / L; u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
      if (d < REACH + 0.05) reserve(i, u0 - 0.02, u1 + 0.02, 0, 0.5, Math.max(0, d - 0.02)); }
  }
  const bandList = P.band;
  const placeBand = (i, id, u, o) => {
    const f = F[i], it = BAND[id] || ARCH[id], su = it.W / L, u0 = r4(u - su / 2), u1 = r4(u + su / 2), z0 = it.z0 || 0, inset = (o && o.inset) || 0;
    const p = fpt(f, u, inset);
    const e = Object.assign({ face: i, u: r4(u), u0, u1, node: it.node || id, id, depth: r4(inset + it.D), h: it.H, z0, mount: 'wall', inset, x: r4(p[0]), z: r4(p[1]), ry: ry(f) }, o || {});
    bandList.push(e); claim(i, u0, u1, z0, z0 + it.H, inset + it.D); use(i, 'band'); return e;
  };
  // where an item of width su fits on face i (centre u), trying the preferred spot first, then the free ends
  const spotFor = (i, it, pref, inset) => {
    const f = F[i], su = it.W / L, lo = 0.05 + su / 2, hi = 0.95 - su / 2, z0 = it.z0 || 0; if (lo > hi + 1e-9) return -1;
    for (const u of [clamp(pref, lo, hi), lo, hi, 0.5]) {
      const uu = clamp(u, lo, hi);
      if (!fits(i, uu - su / 2, uu + su / 2, z0, z0 + it.H, inset + it.D)) continue;
      if (boxFront(f, uu - su / 2, uu + su / 2, inset + it.D + 0.05, b => b.top > z0 - 0.02)) continue;   // (never inside a box: hung pieces may hang above a low one)
      if (z0 + it.H > minH(f, uu - su / 2, uu + su / 2) - 0.05) continue;
      return uu;
    }
    return -1;
  };
  // peeling wallpaper (D5: 6% of wood and tile faces; the flaking and split-board kinds 4% elsewhere), with a stain above
  const peels = [];
  F.forEach((f, i) => { if (!free(f) || f.run >= 0 || vh(fkey(f), fkeyY(f), 621) >= S.peel) return;
    const id = 'Band_peel_' + 'ABCD'[(vh(f.x, f.y, 622) * 4) | 0] + '_' + style, it = ARCH[id]; if (!it) return;
    const u = spotFor(i, it, 0.317 + vh(f.x, f.y, 623) * 0.366, 0); if (u < 0) return;
    const su = it.W / L, p = fpt(f, u, 0), m = { kind: 'peel', node: id, face: i, x: f.x, y: f.y, pos: [r4(p[0]), it.z0 || 0, r4(p[1])], ry: ry(f),
      u: r4(u), u0: r4(u - su / 2), u1: r4(u + su / 2), z0: it.z0 || 0, h: it.H, depth: it.D, variant: id.charAt(10) };
    P.modules.push(m); peels.push(m); claim(i, m.u0, m.u1, m.z0, m.z0 + m.h, m.depth); use(i, 'peel'); f.variant = 1; });
  // radiators under the nursery's windows
  if (BAND.radiator && BAND.radiator.style === style) for (const w of P.windows) { const it = BAND.radiator, su = it.W / L;
    if (vh(w.x, w.y, 505) < 0.6 && it.H < w.v0 - 0.05 && fits(w.face, 0.5 - su / 2, 0.5 + su / 2, 0, it.H, it.D)) placeBand(w.face, 'radiator', 0.5, { mount: 'under_window' }); }
  // scare dolls sitting on the floor against the walls (wood, attic: the best-ranked faces, at most 6), on shelves and tables below
  const DOLL_MAX = 10, dolls = P.dolls;
  const dollAt = (f, i, u, d, y) => { const p = fpt(f, u, d); dolls.push({ x: r4(p[0]), z: r4(p[1]), y: r4(y), ry: ry(f), face: i, u: r4(u) }); use(i, 'doll'); };
  if (S.dolls === 'floor') {
    const cand = [];
    F.forEach((f, i) => { if (free(f) && f.run < 0) { const v = vh(fkey(f) + f.x * 3, fkeyY(f) + f.y * 3, 168); if (v < 0.08) cand.push([v, i]); } });
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, i] of cand.slice(0, 6)) { const f = F[i], u = 0.5 + (vh(f.x, f.y, 169) - 0.5) * 0.5, du = 0.18 / L;
      if (!fits(i, u - du, u + du, 0, 0.5, 0.3) || boxFront(f, u - du, u + du, 0.35)) continue;
      claim(i, u - du, u + du, 0, 0.5, 0.3); dollAt(f, i, u, 0.22, 0); }
  }
  // the furniture itself: a share of the faces per style (more in rooms), a second piece when there's room; weighted by the room's type
  const styleItems = Object.keys(BAND).filter(id => BAND[id].style === style && !SPECIAL_BAND[id]);
  const prefOf = type => (PREF[type === 'corridor' || type === 'start' ? 'corridor_' + style : type] || '').split(' ').filter(id => BAND[id] && (BAND[id].style === style || BAND[id].style === 'common'));
  const pickItem = (f, type, key) => {
    const pref = prefOf(type), list = styleItems.map(id => [id, pref.includes(id) ? 4 : 1]); for (const id of pref) if (!styleItems.includes(id)) list.push([id, 4]);
    let tot = 0; for (const q of list) tot += q[1]; if (!tot) return null;
    let r = vh(f.x * 3 + f.nx, f.y * 3 + f.nz, key) * tot; for (const q of list) { r -= q[1]; if (r < 0) return q[0]; } return list[list.length - 1][0];
  };
  F.forEach((f, i) => {
    if (!free(f) || f.run >= 0) return;
    const room = f.hall >= 0 && rooms[f.hall].kind === 'room', den = S.band * (room ? 1.5 : 1), type = typeOfFace(f);
    if (vh(f.x * 3 + f.nx, f.y * 3 + f.nz, 160) >= den) return;
    for (let k = 0; k < 2; k++) {
      if (k === 1 && vh(f.x * 3 + f.nx, f.y * 3 + f.nz, 166) >= 0.35) break;
      let placed = null;
      for (let tr = 0; tr < 3 && !placed; tr++) {
        const id = pickItem(f, type, 167 + k * 7 + tr); if (!id) break;
        const it = BAND[id], u = spotFor(i, it, k ? (vh(f.x, f.y, 175) < 0.5 ? 0 : 1) : 0.5 + (vh(f.x, f.y, 174) - 0.5) * 0.6, 0);
        if (u >= 0) placed = placeBand(i, id, u);
      }
      if (!placed) break;
      const id = placed.id;
      if (id === 'console' && BAND.console_mirror) { const m = BAND.console_mirror, su = m.W / L;
        if (fits(i, placed.u - su / 2, placed.u + su / 2, m.z0, m.z0 + m.H, m.D) && m.z0 + m.H < minH(f, 0, 1) - 0.05) placeBand(i, 'console_mirror', placed.u); }
      if (id === 'doll_shelf' && dolls.length < DOLL_MAX - 1) for (const s of [-1, 1]) dollAt(f, i, placed.u + s * 0.3 / L, 0.12, 1.45);
      if (S.dolls === 'table' && (id === 'console' || id === 'sideboard' || id === 'hall_bench') && dolls.length < DOLL_MAX && vh(f.x, f.y, 176) < 0.3) dollAt(f, i, placed.u, 0.2, BAND[id].H);
      if (BAND[id].fix && FIXK[BAND[id].fix]) { const p = fpt(f, placed.u, BAND[id].D / 2), o = BAND[id].H;   // (a night light on a dresser)
        pushFix({ id: BAND[id].fix, x: p[0], y: o + 0.12, z: p[1], nx: f.nx, nz: f.nz, ox: p[0], oy: o, oz: p[1], ry: ry(f), state: FIXK[BAND[id].fix].flicker ? 'flicker' : 'ok',
          tile: [f.x, f.y], face: i, src: 'band', band: bandList.length - 1 }); }
    }
  });
  // cobweb cards across the attic's top inside corners (house.js's 14% of faces)
  if (BAND.cobweb_card && BAND.cobweb_card.style === style) F.forEach((f, i) => {
    if (!free(f) || f.run >= 0 || vh(f.x * 5 + f.nx, f.y * 5 + f.nz, 196) >= 0.14) return;
    const tx = Math.sign(f.x1 - f.x0), tz = Math.sign(f.z1 - f.z0), e0 = vh(f.x, f.y, 197) < 0.5 ? 0 : 1;
    for (const end of [e0, 1 - e0]) { if (!isW(end ? f.x + tx : f.x - tx, end ? f.y + tz : f.y - tz) || boxFront(f, end ? 0.8 : 0, end ? 1 : 0.2, 0.45, b => b.top > 2.15)) continue;
      const it = BAND.cobweb_card, p = fpt(f, end, 0), hEnd = f.hs ? f.hs[end ? 4 : 0] : f.h;   // (centred 0.25 m under the ceiling at that corner, A10)
      if (hEnd - it.H < it.z0 - 1e-6) continue;
      // it spans the corner, reaching it.D out along both walls: clear of anything tall on either face there
      const c = cornerOf(i, end), w = (it.D + 0.02) / L, z0 = hEnd - it.H;
      if (!c || !fits(i, end ? 1 - w : 0, end ? 1 : w, z0, hEnd, it.D) || !fits(c[0], c[1] ? 1 - w : 0, c[1] ? 1 : w, z0, hEnd, it.D)) continue;
      reserve(i, end ? 1 - w : -0.01, end ? 1.01 : w, z0, hEnd, 0); reserve(c[0], c[1] ? 1 - w : -0.01, c[1] ? 1.01 : w, z0, hEnd, 0);
      bandList.push({ face: i, u: end, u0: end, u1: end, node: it.node, id: 'cobweb_card', depth: it.D, h: it.H, z0: r4(z0), mount: 'corner', inset: 0, x: r4(p[0]), z: r4(p[1]), ry: ry(f), end });
      use(i, 'band'); break; }
  });
  // servant runs: thin service props on the inset side walls (the inset is 0.30 m, so <= 0.14 m more), a service shelf on their end walls
  F.forEach((f, i) => {
    if (f.run < 0 || f.busy.length || f.skip || vh(f.x * 3 + f.nx, f.y * 3 + f.nz, 171) >= 0.6) return;
    const ids = f.inset ? ['bell_board', 'conduit'] : ['service_shelf', 'bell_board'], id = ids[vh(f.x, f.y, 172) < 0.5 ? 0 : 1], it = BAND[id];
    if (!it || f.inset + it.D > REACH + 1e-9) return;
    const u = spotFor(i, it, 0.5, f.inset); if (u >= 0) placeBand(i, id, u, { inset: f.inset });
  });

  /* flicker groups: at most 16 lamps flicker, each its own group, every two >= 14 m apart (14.6 here: the baker's light centres may sit a
     few cm off ours); the others burn steady. Candidates in vh order, so the groups spread over the whole floor. */
  { const cand = FXL.map((f, i) => [f, i]).filter(([f]) => f.state === 'flicker').sort((a, b) => vh(a[0].tile[0], a[0].tile[1], 977 + (a[1] & 7)) - vh(b[0].tile[0], b[0].tile[1], 977 + (b[1] & 7)) || a[1] - b[1]);
    const got = [];
    for (const [f] of cand) {
      if (got.length < 16 && got.every(g => (g.x - f.x) ** 2 + (g.z - f.z) ** 2 >= 14.6 * 14.6)) { f.group = got.length; got.push(f); }
      else { f.state = 'ok'; f.demoted = true; }
    } }

  /* rugs (B6): never on a loose board's tile (nor wardrobes, the exit, islands); a hall's own rug, runners down hallways and the tile
     floor's corridors, round rugs in nursery cells, rag rugs now and then in the attic and the workshop */
  const rugT = new Uint8Array(n);
  const rugOK = (x0, z0, x1, z1) => { for (let y = Math.floor((z0 + 0.01) / L); y <= Math.floor((z1 - 0.01) / L); y++) for (let x = Math.floor((x0 + 0.01) / L); x <= Math.floor((x1 - 0.01) / L); x++) {
    const t = idx(x, y); if (isW(x, y) || boardsAt[t] || keep[t] || islT[t] || rugT[t]) return false; } return true; };
  const addRug = (x, z, w, l, rot, type) => { const hx = rot ? l / 2 : w / 2, hz = rot ? w / 2 : l / 2;
    if (!rugOK(x - hx, z - hz, x + hx, z + hz)) return false;
    for (let y = Math.floor((z - hz + 0.01) / L); y <= Math.floor((z + hz - 0.01) / L); y++) for (let q = Math.floor((x - hx + 0.01) / L); q <= Math.floor((x + hx - 0.01) / L); q++) rugT[idx(q, y)] = 1;
    P.rugs.push({ x: r4(x), z: r4(z), w, l: r4(l), rot: rot ? r4(PI / 2) : 0, type }); return true; };
  // a straight run of tiles (along x when ax) from tile a to b on line `line`, split at board tiles: runner pieces
  const runner = (ax, line, a, b, type) => {
    let s = -1;
    for (let j = a; j <= b + 1; j++) { const x = ax ? j : line, y = ax ? line : j, ok = j <= b && !boardsAt[idx(x, y)] && !keep[idx(x, y)] && !rugT[idx(x, y)];
      if (ok && s < 0) s = j;
      if (!ok && s >= 0) { const m0 = isW(ax ? s - 1 : line, ax ? line : s - 1) ? 0.3 : 0.05, m1 = isW(ax ? j : line, ax ? line : j) ? 0.3 : 0.05;
        const p0 = s * L + m0, p1 = j * L - m1, l = p1 - p0, c = (line + 0.5) * L;
        if (l >= 0.9) addRug(ax ? (p0 + p1) / 2 : c, ax ? c : (p0 + p1) / 2, RUG.runner[0], l, ax, type);
        s = -1; } }
  };
  for (const r of rooms) {
    const type = r.t.rug; if (!type || !RUG[type]) continue;
    const ax = hallAxisX(r);
    if (r.kind === 'hallway') { runner(ax, ax ? r.ty0 : r.tx0, ax ? r.tx0 : r.ty0, ax ? r.tx1 : r.ty1, 'runner'); continue; }
    const [w, l] = RUG[type], cells = [], hcx = (r.tx0 + r.tx1 + 1) / 2, hcy = (r.ty0 + r.ty1 + 1) / 2;
    for (let y = r.ty0; y <= r.ty1; y += 2) for (let x = r.tx0; x <= r.tx1; x += 2) cells.push([Math.hypot(x + 0.5 - hcx, y + 0.5 - hcy), vh(x, y, 741), x, y]);
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let left = (r.tx1 - r.tx0 + 2) * (r.ty1 - r.ty0 + 2) / 4 >= 9 ? 2 : 1;
    for (const [, , x, y] of cells) { if (!left) break; if (addRug((x + 0.5) * L, (y + 0.5) * L, w, l, ax, type)) left--; }
  }
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {          // the corridors and cells outside halls and runs
    const t = idx(x, y); if (isW(x, y) || hallAt[t] >= 0 || runAt[t] >= 0) continue;
    if (style === 'tile') { const ax = straight(x, y);                            // runners down the tile floor's straight corridors
      if (ax === 'x' && straight(x - 1, y) !== 'x') { let b = x; while (straight(b + 1, y) === 'x' && hallAt[idx(b + 1, y)] < 0 && runAt[idx(b + 1, y)] < 0) b++; runner(true, y, x, b, 'runner'); }
      if (ax === 'z' && straight(x, y - 1) !== 'z') { let b = y; while (straight(x, b + 1) === 'z' && hallAt[idx(x, b + 1)] < 0 && runAt[idx(x, b + 1)] < 0) b++; runner(false, x, y, b, 'runner'); } }
    if (x % 2 === 1 && y % 2 === 1) {
      if (style === 'wood' && vh(x, y, 120) < 0.35) addRug((x + 0.5) * L, (y + 0.5) * L, RUG.round[0], RUG.round[1], false, 'round');
      else if ((style === 'attic' || style === 'workshop') && vh(x, y, 121) < (style === 'attic' ? 0.1 : 0.06)) addRug((x + 0.5) * L, (y + 0.5) * L, RUG.rag[0], RUG.rag[1], vh(x, y, 122) < 0.5, 'rag');
    }
  }

  /* beams (A10, B5): basement joists (bottom 2.45, or under a higher hall ceiling), attic collar ties (2.45) and hall trusses (ties 2.60),
     workshop beams (bottom >= 3.05) and hall trusses. Never through a doorway (its leaves stand 2.55 tall, its header starts at 2.60),
     a skylight or a ceiling hole; split round anything that rises through them (columns, flues, chimneys). */
  const B = P.beams;
  const seg = (kind, x0, z0, x1, z1, y0, y1, w) => {
    const ax = Math.abs(x1 - x0) >= Math.abs(z1 - z0), a0 = ax ? Math.min(x0, x1) : Math.min(z0, z1), a1 = ax ? Math.max(x0, x1) : Math.max(z0, z1), c = ax ? z0 : x0, hw = w / 2 + 0.03;
    const cuts = [];
    for (const s of solids) { if (s.top <= y0 + 0.01) continue;
      const lo = ax ? s.mx0 : s.mz0, hi = ax ? s.mx1 : s.mz1, clo = ax ? s.mz0 : s.mx0, chi = ax ? s.mz1 : s.mx1;
      if (chi > c - hw && clo < c + hw && hi > a0 && lo < a1) cuts.push([lo - 0.05, hi + 0.05]); }
    cuts.sort((p, q) => p[0] - q[0]);
    let s0 = a0;
    const out = p1 => { if (p1 - s0 >= 0.3) B.push({ kind, x0: r4(ax ? s0 : c), z0: r4(ax ? c : s0), x1: r4(ax ? p1 : c), z1: r4(ax ? c : p1), y0: r4(y0), y1: r4(y1), w }); };
    for (const [lo, hi] of cuts) { if (hi <= s0) continue; out(Math.min(lo, a1)); s0 = Math.max(s0, hi); if (s0 >= a1) break; }
    if (s0 < a1) out(a1);
  };
  const flatOK = t => !E.W[t] && gid[t] < 0 && runAt[t] < 0 && doorAt[t] < 0 && !ceilBusy[t];
  // lines of tiles: along x (ax) on row `line` at offset o (m from the tile edge), merging neighbours with the same ceiling
  const lines = (ax, o, ok, emit) => {
    const N = ax ? GH : GW, M = ax ? GW : GH;
    for (let line = 0; line < N; line++) { let s = -1, h = 0;
      for (let j = 0; j <= M; j++) { const t = j < M ? (ax ? idx(j, line) : idx(line, j)) : -1, good = t >= 0 && ok(t, ax), hh = good ? C[t] : -1;
        if (s >= 0 && (!good || hh !== h)) { emit(ax, line, s, j, h, o); s = -1; }
        if (good && s < 0) { s = j; h = hh; } } }
  };
  if (style === 'concrete') {                        // 4 joists a tile, all one way across the floor
    const ax = vh(0, 0, 951) < 0.5;
    const ok = t => flatOK(t) && C[t] >= 2.7 - 1e-6 && !(hallAt[t] >= 0 && rooms[hallAt[t]].t.vault);
    for (let k = 0; k < 4; k++) lines(ax, (k + 0.5) * L / 4, ok, (ax, line, a, b, h, o) => {
      const y0 = Math.max(2.45, h - 0.25), c = line * L + o;
      seg('joist', ax ? a * L : c, ax ? c : a * L, ax ? b * L : c, ax ? c : b * L, y0, y0 + 0.25, 0.12); });
  }
  // a beam across each straight corridor tile at offset o along it (collar ties, workshop beams)
  const across = (kind, o, y0of, w, ok) => { for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const t = idx(x, y), ax = straight(x, y); if (!ax || !ok(t)) continue;
    const y0 = y0of(C[t]); if (y0 === null) continue;
    for (const oo of o) { if (ax === 'z') seg(kind, x * L, y * L + oo * L, (x + 1) * L, y * L + oo * L, y0, y0 + (kind === 'collar' ? 0.2 : C[t] - y0), w);
      else seg(kind, x * L + oo * L, y * L, x * L + oo * L, (y + 1) * L, y0, y0 + (kind === 'collar' ? 0.2 : C[t] - y0), w); } } };
  // trusses in a hall: a tie on every inner grid line across its ridge (or long axis) and a king post up to the roof
  const trusses = (r, kind, tieY, tieH, w, postTo) => {
    const al = r.gable ? !!(r.flags & 1) : !hallAxisX(r);      // (al: the ridge runs along y, so ties run along x)
    const n0 = al ? r.ty0 + 1 : r.tx0 + 1, n1 = al ? r.ty1 : r.tx1;
    // under a gable the tie stops where the roof comes down to its top (+2 cm), so it never pokes through the slope near the eaves
    let a0 = (al ? r.tx0 : r.ty0) * L, a1 = ((al ? r.tx1 : r.ty1) + 1) * L;
    if (r.gable) { const q = gab[r.i], need = tieY + tieH + 0.02;
      if (need >= q.r) return;
      if (need > q.e) { const k = q.hw * (1 - (need - q.e) / (q.r - q.e)); a0 = Math.max(a0, q.c - k); a1 = Math.min(a1, q.c + k); } }
    for (let k = n0; k <= n1; k++) { const c = k * L;
      if (al) seg(kind, a0, c, a1, c, tieY, tieY + tieH, w); else seg(kind, c, a0, c, a1, tieY, tieY + tieH, w);
      const mid = al ? (r.tx0 + r.tx1 + 1) / 2 * L : (r.ty0 + r.ty1 + 1) / 2 * L, top = postTo(al ? mid : c, al ? c : mid);
      if (top - (tieY + tieH) >= 0.3) B.push({ kind: 'post', x0: r4(al ? mid : c), z0: r4(al ? c : mid), x1: r4(al ? mid : c), z1: r4(al ? c : mid), y0: r4(tieY + tieH), y1: r4(top), w }); }
  };
  if (style === 'attic') {
    across('collar', [0.25, 0.75], h => h >= 2.67 ? 2.45 : null, 0.15, t => flatOK(t) && !(hallAt[t] >= 0 && rooms[hallAt[t]].kind === 'room'));
    for (const r of rooms) if (r.gable) trusses(r, 'tie', 2.6, 0.2, 0.15, (x, z) => ceilXZ(x, z));
  }
  if (style === 'workshop') {
    const kind = vh(0, 0, 952) < 0.5 ? 'beam' : 'ibeam';
    across(kind, [0.2], h => h - 0.3 >= 3.05 - 1e-6 ? h - 0.3 : null, 0.2, t => !E.W[t] && runAt[t] < 0 && !ceilBusy[t] && !(hallAt[t] >= 0 && rooms[hallAt[t]].kind === 'room'));
    for (const r of rooms) { if (r.kind !== 'room') continue;
      if (r.t.trusses) trusses(r, 'tie', Math.max(3.05, r.t.ceil - 1.1), 0.25, 0.2, () => r.t.ceil);
      else if (r.t.ceil - 0.3 >= 3.05) trusses(r, kind, r.t.ceil - 0.3, 0.3, 0.2, () => 0); }
  }

  /* wet patches (D3): the basement's 18% of tiles (house.js's puddles, now vh) and its drains, the attic's leaks (under ceiling stains,
     with drips), a few spills elsewhere. Never on a note's tile. */
  const noteHit = (x, z, r) => { for (let y = Math.floor((z - r) / L); y <= Math.floor((z + r) / L); y++) for (let q = Math.floor((x - r) / L); q <= Math.floor((x + r) / L); q++)
    if (q >= 0 && y >= 0 && q < GW && y < GH && noteT[idx(q, y)]) return true; return false; };
  const addWet = (kind, x, z, rx, rz, rot, amount, tx, ty, drips) => { if (noteHit(x, z, Math.max(rx, rz))) return false;
    P.wet.push({ kind, x: r4(x), z: r4(z), rx: r4(rx), rz: r4(rz), rot: r4(rot), amount, tile: [tx, ty], drips: drips || 0 }); return true; };
  if (style === 'concrete') for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    if (isW(x, y)) continue;
    if (vh(x, y, 130) <= 0.18) addWet('puddle', (x + 0.2 + vh(x, y, 134) * 0.6) * L, (y + 0.2 + vh(x, y, 135) * 0.6) * L, (0.9 + vh(x, y, 131) * 0.8) / 2, (0.7 + vh(x, y, 132) * 0.6) / 2, vh(x, y, 133) * 3, 0.9, x, y);
    else if (x & 1 && y & 1 && vh(x, y, 136) < 0.03) addWet('drain', (x + 0.5) * L, (y + 0.5) * L, 0.35, 0.35, 0, 0.6, x, y);
  }
  else if (style === 'attic') for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    if (isW(x, y) || ceilBusy[idx(x, y)] || vh(x, y, 137) >= 0.04) continue;
    const r = 0.45 + vh(x, y, 138) * 0.35;
    addWet('leak', (x + 0.3 + vh(x, y, 139) * 0.4) * L, (y + 0.3 + vh(x, y, 140) * 0.4) * L, r, r * 0.8, vh(x, y, 141) * 3, 0.6, x, y, 2 + ((vh(x, y, 142) * 5) | 0));
  }
  else { const want = 3 + ((vh(0, 0, 143) * 3) | 0), cand = [];
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const t = idx(x, y); if (!isW(x, y) && !keep[t] && doorAt[t] < 0 && !islT[t]) cand.push([vh(x, y, 144), x, y]); }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const [, x, y] of cand) { if (P.wet.length >= want) break;
      if (P.wet.some(w => Math.abs(w.tile[0] - x) + Math.abs(w.tile[1] - y) < 6)) continue;
      const r = 0.3 + vh(x, y, 145) * 0.3;
      addWet('spill', (x + 0.3 + vh(x, y, 146) * 0.4) * L, (y + 0.3 + vh(x, y, 147) * 0.4) * L, r, r * 0.7, vh(x, y, 148) * 3, 0.7, x, y); } }

  /* decal sources (D4, D5, D6) */
  const wallD = [], floorD = [], ceilD = [], perFace = new Uint8Array(F.length);
  // what wall decals keep 0.5 m from: puzzle boxes, portraits, painted words (centre, radius)
  const keepOut = [];
  for (const p of E.puzzles) { const i = faceOf(p.cell[0], p.cell[1], -p.dir[0], -p.dir[1]); if (i >= 0) { const q = fpt(F[i], 0.5, 0); keepOut.push([q[0], 1.25, q[1], 0.32]); } }
  for (const d of P.decorFaces) { const q = fpt(F[d.face], 0.5, 0); keepOut.push([q[0], d.y, q[1], Math.max(d.w, d.h) / 2]); }
  const clear5 = (x, y, z, r) => keepOut.every(k => (k[0] - x) ** 2 + (k[1] - y) ** 2 + (k[2] - z) ** 2 >= (0.5 + r + k[3]) ** 2);
  const addWallD = (kind, i, u, v, size, rot, extra) => {
    if (perFace[i] >= 2) return false;
    const f = F[i], q = fpt(f, u, 0); if (!clear5(q[0], v, q[1], size / 2)) return false;
    wallD.push(Object.assign({ kind, face: i, u: r4(u), v: r4(v), size: r4(size), rot: r4(rot), id: (vh(f.x * 11 + perFace[i], f.y * 11 + f.nz, 709) * 8) | 0, proud: f.inset }, extra || {}));
    perFace[i]++; use(i, 'decal'); return true;
  };
  // soot above every wall lamp and every fireplace, a stain over every peeling strip
  for (const fx of FXL) if (fx.face >= 0 && fx.src !== 'band' && fx.src !== 'fireplace') addWallD('soot', fx.face, 0.5, fx.y + 0.35, 0.45, 0);
  for (const m of fires) addWallD('soot', m.face, 0.5, 1.55, 0.7, 0, { proud: (ARCH[m.node] && ARCH[m.node].breast) || 0.4 });
  for (const e of peels) addWallD('stain', e.face, e.u, Math.min(F[e.face].h - 0.3, e.z0 + e.h + 0.35), 0.6, 0);
  // one height chart a floor in the nursery
  if (style === 'wood') { let best = -1, bv = 2;
    F.forEach((f, i) => { const tp = typeOfFace(f); if ((tp === 'nursery' || tp === 'playroom') && free(f) && f.run < 0 && !res[i].length) { const v = vh(fkey(f), fkeyY(f), 711); if (v < bv) { bv = v; best = i; } } });
    if (best >= 0) addWallD('height_chart', best, 0.5, 0.95, 1.6, 0); }
  const nearDoor = f => DIRS4.some(([dx, dy]) => doorAt[idx(f.x + dx, f.y + dy)] >= 0) || E.closets.some(c => c[0] + c[2] === f.x && c[1] + c[3] === f.y);
  F.forEach((f, i) => {
    if (f.busy.length || f.skip) return;
    const sp = spaceOfFace(f), mul = sp ? sp.decalMul : {}, den = S.decal * (mul.decal || 1);
    for (let k = 0; k < 2 && perFace[i] < 2; k++) {
      if (vh(fkey(f) + k * 13, fkeyY(f), 701 + k) >= (k ? den * 0.35 : den)) break;
      const w = DWP[style].map(([kd, wt]) => [kd, wt * (mul[kd] || 1) * (kd === 'scratch' && nearDoor(f) ? 3 : 1) * (kd === 'mould' && f.border ? 2 : 1)]);
      let tot = 0; for (const q of w) tot += q[1];
      let r = vh(f.x * 13 + k, f.y * 13 + f.nx, 703) * tot, kind = w[w.length - 1][0]; for (const q of w) { r -= q[1]; if (r < 0) { kind = q[0]; break; } }
      const D = DK[kind], size = D.s[0] + (D.s[1] - D.s[0]) * vh(f.x, f.y * 3 + k, 704), hh = minH(f, 0, 1);
      const u = clamp(0.1 + 0.8 * vh(f.x * 3 + k, f.y, 705), size / 2 / L + 0.02, 1 - size / 2 / L - 0.02);
      const v = D.top ? hh - 0.04 - size / 2 : clamp(D.v[0] + (D.v[1] - D.v[0]) * vh(f.x, f.y, 706 + k), size / 2, hh - size / 2);
      addWallD(kind, i, u, v, size, kind === 'drawing' || kind === 'handprint' || kind === 'scratch' ? (vh(f.x, f.y, 708 + k) - 0.5) * 0.6 : 0);
    }
  });
  // the floor: puddle masks on the wet patches, water and rust rings, scorch by kilns and boilers, paint spills, dust clumps, rubble
  for (const w of P.wet) floorD.push({ kind: w.kind === 'drain' ? 'drain' : 'puddle', x: w.x, z: w.z, size: r4(2 * Math.max(w.rx, w.rz)), rot: w.rot });
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const t = idx(x, y); if (isW(x, y) || islT[t]) continue;
    const jx = (x + 0.25 + vh(x, y, 725) * 0.5) * L, jz = (y + 0.25 + vh(x, y, 726) * 0.5) * L;
    if (vh(x, y, 721) < (style === 'concrete' || style === 'attic' ? 0.06 : 0.03)) floorD.push({ kind: 'ring', x: r4(jx), z: r4(jz), size: r4(0.3 + vh(x, y, 727) * 0.3), rot: r4(vh(x, y, 728) * 6.28) });
    else if ((style === 'concrete' || style === 'workshop') && vh(x, y, 722) < 0.04) floorD.push({ kind: 'rust', x: r4(jx), z: r4(jz), size: r4(0.4 + vh(x, y, 727) * 0.4), rot: r4(vh(x, y, 728) * 6.28) });
    else if (style === 'workshop' && hallAt[t] >= 0 && rooms[hallAt[t]].id === 'paint_room' && vh(x, y, 723) < 0.3) floorD.push({ kind: 'paint', x: r4(jx), z: r4(jz), size: r4(0.5 + vh(x, y, 727) * 0.5), rot: r4(vh(x, y, 728) * 6.28) });
    else if (style === 'attic' && !straight(x, y) && vh(x, y, 724) < 0.08) floorD.push({ kind: 'dust', x: r4(jx), z: r4(jz), size: r4(0.4 + vh(x, y, 727) * 0.4), rot: r4(vh(x, y, 728) * 6.28) });
  }
  for (const fx of FXL) if (fx.id === 'kiln_glow' || fx.id === 'boiler_glow') { const s = solids[fx.solid], th = s.rot * PI / 2, hz = (s.rot & 1 ? s.mx1 - s.mx0 : s.mz1 - s.mz0) / 2;
    floorD.push({ kind: 'scorch', x: r4((s.mx0 + s.mx1) / 2 + Math.sin(th) * (hz + 0.35)), z: r4((s.mz0 + s.mz1) / 2 + Math.cos(th) * (hz + 0.35)), size: 0.9, rot: r4(th) }); }
  for (const m of P.modules) {
    if (m.kind === 'ceilhole') floorD.push({ kind: 'rubble', x: m.pos[0], z: m.pos[2], size: 1.4, rot: r4(vh(m.x, m.y, 729) * 6.28) });
    if (m.kind === 'wallhole') { const q = fpt(F[m.face], 0.5, 0.25); floorD.push({ kind: 'plaster', x: r4(q[0]), z: r4(q[1]), size: 0.6, rot: r4(vh(m.x, m.y, 730) * 6.28) }); }
  }
  // the ceiling: a water ring over every wet patch, soot over every hanging lamp, mould by cold outer walls, cracks
  for (const w of P.wet) if (!ceilBusy[idx(w.tile[0], w.tile[1])]) ceilD.push({ kind: 'ring', x: w.x, z: w.z, size: r4(Math.max(w.rx, w.rz) * 1.6), rot: w.rot });
  for (const fx of FXL) if (fx.mount === 'ceiling' && fx.state !== 'dead') ceilD.push({ kind: 'soot', x: fx.x, z: fx.z, size: 0.6, rot: 0 });
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const t = idx(x, y); if (isW(x, y) || ceilBusy[t]) continue;
    const bd = DIRS4.find(([dx, dy]) => { const bx = x + dx, by = y + dy; return isW(bx, by) && (bx === 0 || by === 0 || bx === GW - 1 || by === GH - 1); });
    if (bd && vh(x, y, 731) < 0.1) ceilD.push({ kind: 'mould', x: r4((x + 0.5 + bd[0] * 0.3) * L), z: r4((y + 0.5 + bd[1] * 0.3) * L), size: 0.9, rot: r4(vh(x, y, 733) * 6.28) });
    else if (vh(x, y, 732) < 0.05) ceilD.push({ kind: 'crack', x: r4((x + 0.5) * L), z: r4((y + 0.5) * L), size: 1.2, rot: r4(vh(x, y, 733) * 6.28) });
  }
  P.decalSources = { wall: wallD, floor: floorD, ceiling: ceilD };

  /* dust (D2: the base per style; surface.js adds the walls, boxes, halls and noise), worn paths, the moon's light, LightBaker's gables */
  P.dust = { base: S.dust, nearWall: 0.4, nearDist: 0.3, hallMul: 1.3, noiseKey: 1101, seed: E.seed };
  { const cells = []; for (let y = 1; y < GH; y += 2) for (let x = 1; x < GW; x += 2) if (!isW(x, y)) cells.push([x, y]);
    const pairs = [];
    for (let k = 0; k < 12 && cells.length > 1; k++) { const a = cells[(vh(k, 0, 1201) * cells.length) | 0]; let b = cells[(vh(k, 1, 1201) * cells.length) | 0];
      if (a === b) b = cells[(cells.indexOf(a) + 1) % cells.length]; pairs.push([a[0], a[1], b[0], b[1]]); }
    P.paths = { pairs, herTrail: E.closets.length ? (vh(0, 0, 1202) * E.closets.length) | 0 : -1 }; }
  P.gables = rooms.filter(r => r.gable).map(r => ({ tx0: r.tx0, ty0: r.ty0, tx1: r.tx1, ty1: r.ty1, eave: r.t.eave, ridge: r.t.ceil, alongY: !!(r.flags & 1) }));

  /* counts */
  const cnt = (a, key) => { const o = {}; for (const e of a) o[e[key]] = (o[e[key]] || 0) + 1; return o; };
  P.stats = { faces: F.length, doorways: P.doorways.length, decor: P.decorFaces.length, windows: P.windows.length, modules: cnt(P.modules, 'kind'),
    fixtures: FXL.length, states: cnt(FXL, 'state'), flickerGroups: FXL.filter(f => f.group >= 0).length, demoted: FXL.filter(f => f.demoted).length, moved: FXL.filter(f => f.moved).length,
    band: bandList.length, dolls: dolls.length, rugs: P.rugs.length, beams: P.beams.length, spaces: spaces.length, wet: P.wet.length,
    decals: { wall: wallD.length, floor: floorD.length, ceiling: ceilD.length }, ms: +(now() - t0).toFixed(2) };
  return P;
}

/* ---------- helpers for the integrator and the tests ---------- */
// the floor's env from its data alone (pure; as applyFloor + applyLayout would set the globals)
function envFromData(d) {
  const ok = typeof LAYOUT_VERSION === 'undefined' || d.v === LAYOUT_VERSION, Fl = typeof FLOORS !== 'undefined' ? FLOORS[d.i] : null;
  return { rows: d.rows, rooms: ok ? d.rooms || [] : [], runs: ok ? d.runs || [] : [], solids: ok ? d.solids || [] : [], VSEED: ok ? d.seed >>> 0 : 0,
    closets: d.closets, exit: d.exit, puzzles: d.puzzles, notes: d.notes, creaks: d.creaks, floorIdx: d.i, style: Fl ? Fl.style : STYLE_OF[d.i], frames: Fl ? Fl.frames : FRAMES[d.i] };
}
// the env from the live game (after applyFloor): not pure, it reads the globals
function envFromGame() {
  /* global grid, GW, GH, SOLIDS, ROOMS, RUNS, CEIL, VSEED, closets, exit, puzzles, notes, creaks, floorIdx, FLOORS */
  const Fl = FLOORS[floorIdx];
  return { grid, GW, GH, SOLIDS, ROOMS, RUNS, CEIL, VSEED, closets, exit, exitDir: typeof exitDir === 'function' ? exitDir() : null,
    puzzles, notes, creaks, floorIdx, style: Fl.style, frames: Fl.frames };
}
// A9.3's doorway tiles alone: [{x, y, axis, perimeter, hall}]
function doorTilesFrom(grid, seed, rooms, runs) { return doorTiles(norm({ grid, VSEED: seed, rooms, runs })); }
// fixtures for LightBaker.bake: with a profile that carries a mount the baker adds it to the node origin, so hand it ox, oy, oz
function forBake(fixtures, profiles) {
  const pin = profiles && profiles.profiles ? profiles.profiles : profiles || {};
  return fixtures.map(f => { const p = pin[f.profile], mt = p && p.mount && [0, 1, 2].every(q => Number.isFinite(p.mount[q]));
    return mt && !f.originIsCentre ? Object.assign({}, f, { x: f.ox, y: f.oy, z: f.oz }) : f; });
}
// LightBaker.bake's whole input from the plan and its env (profiles, cookies, aoProfiles, albedo may be added)
function bakeInput(plan, env, extra) {
  const E = norm(env), x = extra || {};
  return Object.assign({ GW: E.GW, GH: E.GH, grid: E.W, L, ceil: E.C, gables: plan.gables,
    solids: E.solids.map(s => ({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, h: s.h, occ: s.occ })),
    faces: plan.faces.map(f => ({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, nx: f.nx, nz: f.nz, x: f.x, y: f.y, h: f.h })),
    fixtures: forBake(plan.fixtures, x.profiles), windows: plan.windows, moon: { az: plan.moon.az, el: plan.moon.el, k: plan.moon.k },
    band: plan.band.filter(b => b.mount !== 'corner').map(b => ({ face: b.face, u0: b.u0, u1: b.u1, h: b.z0 + b.h })) }, x);
}
// a stable checksum of a plan (FNV-1a over its JSON; typed arrays as plain lists; the timing left out)
function planHash(p) {
  const s = JSON.stringify(p, (k, v) => k === 'ms' ? undefined : ArrayBuffer.isView(v) ? Array.from(v) : v);
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}

window.Dress = { plan, envFromData, envFromGame, doorTilesFrom, forBake, bakeInput, hash: planHash, vh: vhOf, STYLE: ST, FIXTURE: FX };
})();
