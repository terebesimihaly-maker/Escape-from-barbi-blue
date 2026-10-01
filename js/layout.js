/* Escape from Barbi Blue: the house's layout. Halls (rooms several tiles across, and long hallways), the furniture you bump into,
   the servant corridors and the ceiling heights, and the navigation that goes with them (js/floors.js builds a floor with these).
   How it hangs together:
   - The tile grid is still the only thing that makes walls (rows stay '0'/'1'). A hall only opens tiles: it is stamped over cells that
     were already connected, so nothing gets cut off. Tiles are only ever closed one connector at a time (a hall's door budget, the
     wardrobe alcoves), and a closure is kept only if every open tile can still be reached.
   - The furniture you bump into is a list of boxes (d.solids), in the footprints of js/kitdefs.js. A box only goes in a slot: on a
     corner point inside a hall (pocket), between two of them (bar), with its back to a hall wall (wall), or filling a tile in the
     middle of a hall (island). Slots never cover a tile's core (13 u around its centre; an island's own tile aside), boxes stay 26 u
     apart (wider than she is: no gap that only you fit through), and none touches the start, a wardrobe, the exit or their fronts.
   - A cut is a step between two neighbouring tile centres that a box blocks (the box crosses the 13 u band along that step). The
     searches (bfsDist, bfsPath, js/core.js) never take a cut step, and a box is kept only if the tiles stay connected without them.
   - Why every floor can be finished: every tile's core is free, every uncut band is free and 12 u from the walls, and the uncut
     steps connect every open tile (an island's tile is boxed in, never anyone's target). So you (radius 11) and she (12) can walk
     centre to centre to anywhere, and every note, wardrobe, puzzle and the exit is at or next to a centre. validateFloor checks it
     all again on its own, down to a 5 u flood fill; generateFloor tries another seed (6 in all) before falling back to the plain
     maze. Everything is seeded (withSeed), so it's the same house for everyone; the other clients only rebuild cuts, nav and
     ceilings from d (applyLayout). */
'use strict';

const LAYOUT_VERSION = 2, LAYOUT_REJECTS = [];      // (rejects: houses validateFloor turned down; the tests expect none)
let LAYOUT_FORCE_CLASSIC = false;                 // (tests: build the plain maze, as the last fallback does)
const R_NAV = 13, BOX_GAP = 26, SERVANT_CEIL = 2.55;

/* ---------- hall templates ----------
   style, cells [w, h] (turned at random when stamped), kind room or hallway (wall decor only), ceil (m; a gable roof rises from eave to
   ceil along the long axis), mode islands (sets in the middle, slots around them) or columns (a column on corner points, no islands),
   slots: what may go in each kind of slot (KIT ids, js/kitdefs.js), and how many. lights, rug, decalMul, identity: how js/dress.js
   dresses it (hang: the hall's ceiling light, wall: its sconces). */
const HALL_TEMPLATES = (() => {
  const L = { wood: { hang: 'pendant_shade', wall: 'sconce_shade' }, tile: { hang: 'chandelier', wall: 'sconce_candles' }, concrete: { hang: 'bare_bulb', wall: 'bulkhead' },
    attic: { hang: 'bulb_batten', wall: null }, workshop: { hang: 'green_shade', wall: null } };
  const room = (style, cells, ceil, identity, islands, slots, o) => Object.assign({ style, cells, kind: 'room', ceil, roof: 'flat', mode: 'islands',
    islands: { max: cells[0] * cells[1] >= 9 ? 3 : cells[0] * cells[1] >= 6 ? 2 : 1, pick: islands }, slots, lights: L[style], rug: null, decalMul: {}, identity }, o);
  const hallway = (style, cells, ceil, identity, o) => Object.assign({ style, cells, kind: 'hallway', ceil, roof: 'flat', mode: 'islands', islands: { max: 0, pick: [] }, slots: [],
    lights: { hang: null, wall: L[style].wall || L[style].hang, every: 2 }, rug: 'runner', decalMul: {}, identity }, o);
  const gable = (eave, ridge) => ({ roof: 'gable', eave, ceil: ridge });
  const bar = (...pick) => ({ type: 'bar', pick, max: 1 }), pocket = (...pick) => ({ type: 'pocket', pick, max: 2 }), wall = (...pick) => ({ type: 'wall', pick, max: 3 });
  return {
    // F1 The Nursery (wood)
    nursery_dormitory: room('wood', [2, 3], 3.6, 'rows of cribs and iron beds', ['isl_crib_rocker', 'isl_twin_cribs', 'isl_bed_screen'],
      [pocket('rocking_chair', 'toy_chest', 'pram'), wall('crib', 'iron_bed')], { rug: 'rag' }),
    playroom: room('wood', [2, 2], 3.6, 'toys left mid-game', ['isl_tea_party', 'isl_dollhouse'],
      [bar('nursery_table'), pocket('rocking_chair', 'toy_chest', 'doll_house', 'rocking_horse', 'pram')], { rug: 'round', decalMul: { petal: 1.5 } }),
    landing_hall: hallway('wood', [1, 4], 3.0, 'the landing'),
    night_nursery: room('wood', [2, 2], 3.3, 'a night nursery, a crib by the wall', ['isl_crib_rocker', 'isl_twin_cribs', 'isl_bed_screen'],
      [pocket('rocking_chair', 'pram'), wall('crib', 'iron_bed')], { rug: 'rag' }),
    washroom: room('wood', [2, 2], 3.0, 'tin bath and washstand', ['isl_washstand'], [pocket('rocking_chair')], { decalMul: { stain: 1.6 } }),
    schoolroom: room('wood', [2, 3], 3.6, 'a schoolroom with low tables', ['isl_tea_party', 'isl_dollhouse'],
      [bar('nursery_table'), pocket('toy_chest', 'rocking_horse')], { rug: 'jute', decalMul: { word: 1.5 } }),
    back_landing: hallway('wood', [1, 3], 3.0, 'the back landing'),
    // F2 The Doll Hallway (tile)
    gallery: room('tile', [3, 3], 4.5, 'a gallery of dolls under glass', [], [Object.assign(bar('display_bench'), { max: 2 }), pocket('plinth_bust')],
      { mode: 'columns', column: { pattern: 'ring', id: 'column_tile' }, rug: 'oriental' }),
    portrait_hall: hallway('tile', [1, 5], 3.5, 'the portrait hall', { decalMul: { portrait: 1.5 } }),
    dining_room: room('tile', [2, 3], 4.0, 'a dining table laid for guests', ['isl_dining'], [bar('vitrine_double'), pocket('column_tile', 'plinth_bust')], { rug: 'oriental' }),
    parlour: room('tile', [2, 2], 4.0, 'a parlour with a grand piano', ['isl_grand_piano', 'isl_parlour'], [bar('vitrine_double'), pocket('column_tile', 'plinth_bust')], { rug: 'kilim' }),
    library: room('tile', [2, 2], 4.0, 'a reading room', ['isl_reading'], [bar('vitrine_double'), pocket('column_tile', 'plinth_bust')], { rug: 'kilim' }),
    colonnade: room('tile', [2, 3], 4.5, 'a colonnade', [], [], { mode: 'columns', column: { pattern: 'all', id: 'column_tile' } }),
    servants_hall: hallway('tile', [1, 4], 3.2, "the servants' hall"),
    // F3 The Basement (concrete)
    boiler_room: room('concrete', [3, 3], 3.3, 'the boilers', ['isl_boiler'], [pocket('brick_pier', 'stanchion'), wall('boiler_wall')], { decalMul: { stain: 1.5 } }),
    storage: room('concrete', [2, 3], 3.0, 'shelving and crates', ['isl_shelving_double', 'isl_crate_stack'],
      [bar('shelf_rack'), pocket('brick_pier', 'stanchion', 'chest_freezer', 'crate_stack')]),
    cellar_passage: hallway('concrete', [1, 5], 2.7, 'a cellar passage under a brick barrel vault', { vault: true }),
    laundry: room('concrete', [2, 2], 3.0, 'washtubs and a mangle', ['isl_washtubs'], [pocket('stanchion', 'chest_freezer'), wall('boiler_wall')], { decalMul: { stain: 1.8 } }),
    coal_store: room('concrete', [2, 2], 2.7, 'the coal store', ['isl_crate_stack'], [pocket('brick_pier', 'crate_stack')], { decalMul: { stain: 2 } }),
    wine_cellar: room('concrete', [2, 3], 3.0, 'wine racks', ['isl_wine_rack'], [bar('shelf_rack'), pocket('brick_pier', 'crate_stack')]),
    workroom: room('concrete', [2, 3], 3.0, 'a workroom', ['isl_shelving_double', 'isl_crate_stack'], [bar('shelf_rack'), pocket('stanchion', 'chest_freezer', 'crate_stack')]),
    coal_passage: hallway('concrete', [1, 4], 2.7, 'the coal passage'),
    // F4 The Attic (gable roofs over the halls)
    truss_hall: room('attic', [3, 3], 3.9, 'the roof trusses, things under sheets', ['isl_sheeted_sofa', 'isl_trunk_pile', 'isl_dress_forms'],
      [bar('sheet_sofa'), pocket('truss_post', 'steamer_trunk', 'chimney_breast')], Object.assign(gable(2.6, 3.9), { lights: { hang: 'bulb_batten', wall: null, skylights: 2 } })),
    storeroom: room('attic', [2, 3], 3.6, 'a storeroom', ['isl_trunk_pile', 'isl_sheeted_armoire'],
      [bar('sheet_sofa'), pocket('truss_post', 'sheet_chair', 'sheet_tall', 'steamer_trunk')], gable(2.6, 3.6)),
    servants_dormitory: room('attic', [2, 3], 3.6, "the servants' beds", ['isl_servant_bed'],
      [pocket('truss_post', 'chimney_breast'), wall('iron_bed_sheeted')], Object.assign(gable(2.6, 3.6), { rug: 'rag' })),
    plank_passage: hallway('attic', [1, 5], 2.8, 'a plank passage'),
    hideout: room('attic', [2, 2], 3.4, 'a hideout, toys in a circle', ['isl_toy_circle'],
      [pocket('sheet_chair', 'steamer_trunk', 'chimney_breast'), wall('iron_bed_sheeted')], Object.assign(gable(2.6, 3.4), { rug: 'round' })),
    box_room: room('attic', [2, 2], 3.4, 'a box room', ['isl_trunk_pile', 'isl_sheeted_armoire'], [pocket('sheet_chair', 'steamer_trunk')], gable(2.6, 3.4)),
    sheet_room: room('attic', [2, 3], 3.6, 'furniture under dust sheets', ['isl_sheeted_sofa', 'isl_sheeted_armoire', 'isl_dress_forms'],
      [bar('sheet_sofa'), pocket('truss_post', 'sheet_chair', 'sheet_tall')], gable(2.6, 3.6)),
    eaves_passage: hallway('attic', [1, 4], 2.8, 'the eaves passage'),
    // F5 The Workshop
    assembly_floor: room('workshop', [3, 3], 4.5, 'the assembly floor', ['isl_workbench_double', 'isl_sorting_table', 'isl_hanging_dolls'],
      [bar('workbench'), pocket('sewing_table', 'dress_form', 'steel_column')], { lights: { hang: 'green_shade', wall: null, skylights: 3 }, trusses: true }),
    casting_hall: room('workshop', [3, 3], 4.5, 'the casting hall', ['isl_workbench_double', 'isl_kiln', 'isl_drying_rack'],
      [bar('workbench', 'drying_rack'), pocket('kiln', 'steel_column')], { decalMul: { stain: 1.4 } }),
    kiln_room: room('workshop', [2, 3], 4.2, 'the kilns', ['isl_kiln', 'isl_drying_rack'], [bar('drying_rack'), pocket('kiln', 'steel_column')]),
    workshop_corridor: hallway('workshop', [1, 5], 3.4, 'the workshop corridor'),
    eye_room: room('workshop', [2, 2], 3.6, 'trays of glass eyes', ['isl_workbench_double', 'isl_sorting_table'], [pocket('sewing_table')]),
    office: room('workshop', [2, 2], 3.6, "the maker's office", ['isl_office_desk'], [pocket('sewing_table')], { rug: 'oriental', decalMul: { word: 1.5 } }),
    paint_room: room('workshop', [2, 3], 4.2, 'the paint room', ['isl_drying_rack', 'isl_hanging_dolls'], [bar('workbench', 'drying_rack'), pocket('sewing_table', 'dress_form')],
      { decalMul: { stain: 1.6 } }),
    parts_store: room('workshop', [2, 3], 3.6, 'the parts store', ['isl_sorting_table', 'isl_hanging_dolls'], [bar('workbench'), pocket('dress_form', 'steel_column')]),
    materials_passage: hallway('workshop', [1, 4], 3.4, 'the materials passage'),
  };
})();
const HALL_TEMPLATE_IDS = Object.keys(HALL_TEMPLATES);     // (d.rooms keeps the index: the order is part of LAYOUT_VERSION)
// the halls each floor tries to fit, in this order (40 tries each)
const HALL_PLAN = [
  ['nursery_dormitory', 'playroom', 'landing_hall', 'night_nursery', 'washroom', 'schoolroom', 'back_landing'],
  ['gallery', 'portrait_hall', 'dining_room', 'parlour', 'library', 'colonnade', 'servants_hall'],
  ['boiler_room', 'storage', 'cellar_passage', 'laundry', 'coal_store', 'wine_cellar', 'workroom', 'coal_passage'],
  ['truss_hall', 'storeroom', 'servants_dormitory', 'plank_passage', 'hideout', 'box_room', 'sheet_room', 'eaves_passage'],
  ['assembly_floor', 'casting_hall', 'kiln_room', 'workshop_corridor', 'eye_room', 'office', 'paint_room', 'parts_store', 'materials_passage'],
];

/* ---------- small pure helpers (validateFloor uses them too, so they take the grid as arguments) ---------- */
const inRect = (r, x, y, g = 0) => x >= r.tx0 - g && x <= r.tx1 + g && y >= r.ty0 - g && y <= r.ty1 + g;
const boxOverlap = (a, b, g = 0) => a.x0 < b.x1 + g && a.x1 > b.x0 - g && a.y0 < b.y1 + g && a.y1 > b.y0 - g;
const kitPiece = (id, v) => Object.assign({}, KIT.items[id], (KIT.items[id].var || [])[v]);
// a KIT piece's box in u for its rotation: [along x, along y]. rot r turns it r x 90 degrees (three.js rotation.y = r * PI / 2):
// rot 0 has w along x, d along y and its front towards +y; a wall piece faces away from its wall.
function kitSize(id, rot, v) { const it = kitPiece(id, v), w = Math.round(it.w / KIT.u), d = Math.round(it.d / KIT.u); return rot & 1 ? [d, w] : [w, d]; }
const roomOf = ([tpl, tx0, ty0, tx1, ty1, flags]) => { const id = HALL_TEMPLATE_IDS[tpl]; return { tpl, id, t: HALL_TEMPLATES[id], tx0, ty0, tx1, ty1, flags }; };
const encodeSolid = s => [s.k, s.x0 * 2, s.y0 * 2, s.x1 * 2, s.y1 * 2, s.rot, s.v];          // (half units: every edge is a whole number)
function decodeSolid([k, x0, y0, x1, y1, rot, v]) {
  const id = KIT.solidIds[k] || null, it = id ? kitPiece(id, v) : { slot: 'pocket', h: 1, occ: 'none' };
  const s = { k, id, kind: it.slot, x0: x0 / 2, y0: y0 / 2, x1: x1 / 2, y1: y1 / 2, rot, v, h: it.h, occ: it.occ, isl: null };
  if (s.kind === 'island') s.isl = [Math.floor((s.x0 + s.x1) / 2 / T), Math.floor((s.y0 + s.y1) / 2 / T)];
  return s;
}
// the live grid as one flat array (1 = wall), for the searches below
const gridFlat = () => { const a = new Uint8Array(GW * GH); for (let y = 0; y < GH; y++) a.set(grid[y], y * GW); return a; };
const countOpen = wall => { let c = 0; for (let k = 0; k < wall.length; k++) if (!wall[k]) c++; return c; };
// tiles from (sx, sy), never across a cut step (cut may be null); -1 = not reached
function navDist(W, H, wall, cut, sx, sy) {
  const d = new Int16Array(W * H).fill(-1), q = new Int32Array(W * H); let h = 0, t = 0; const s = sy * W + sx;
  if (wall[s]) return d;
  d[s] = 0; q[t++] = s;
  while (h < t) { const k = q[h++], x = k % W, n = d[k] + 1;
    if (x + 1 < W && !wall[k + 1] && d[k + 1] < 0 && !(cut && cut[k] & 1)) { d[k + 1] = n; q[t++] = k + 1; }
    if (x > 0 && !wall[k - 1] && d[k - 1] < 0 && !(cut && cut[k - 1] & 1)) { d[k - 1] = n; q[t++] = k - 1; }
    if (k + W < W * H && !wall[k + W] && d[k + W] < 0 && !(cut && cut[k] & 2)) { d[k + W] = n; q[t++] = k + W; }
    if (k >= W && !wall[k - W] && d[k - W] < 0 && !(cut && cut[k - W] & 2)) { d[k - W] = n; q[t++] = k - W; } }
  return d;
}
const reachCount = (W, H, wall, cut, sx, sy) => { const d = navDist(W, H, wall, cut, sx, sy); let c = 0; for (let k = 0; k < d.length; k++) if (d[k] >= 0) c++; return c; };
// cuts: bit 0 = the step to (x+1, y) is blocked, bit 1 = the step to (x, y+1). A step is cut when a box crosses its band (the line
// between the two centres, 13 u either side).
function addCuts(cut, s, W, H, wall) {
  const tx0 = Math.max(0, Math.floor(s.x0 / T) - 2), tx1 = Math.min(W - 2, Math.floor(s.x1 / T) + 1);
  const ty0 = Math.max(0, Math.floor(s.y0 / T) - 2), ty1 = Math.min(H - 2, Math.floor(s.y1 / T) + 1);
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) { const k = y * W + x; if (wall[k]) continue;
    const cx = x * T + T / 2, cy = y * T + T / 2;
    if (!wall[k + 1] && s.x1 > cx - R_NAV && s.x0 < cx + T + R_NAV && s.y1 > cy - R_NAV && s.y0 < cy + R_NAV) cut[k] |= 1;
    if (!wall[k + W] && s.x1 > cx - R_NAV && s.x0 < cx + R_NAV && s.y1 > cy - R_NAV && s.y0 < cy + T + R_NAV) cut[k] |= 2; }
}
function cutsFrom(solids, W = GW, H = GH, wall = gridFlat()) { const cut = new Uint8Array(W * H); for (const s of solids) addCuts(cut, s, W, H, wall); return cut; }
// a puzzle box can go on a wall face only if no box stands within 20 u in front of it, 20 u either side of its middle
function faceClear(solids, x, y, dx, dy) {
  const wx = x * T + T / 2 + dx * T / 2, wy = y * T + T / 2 + dy * T / 2;
  const z = dx ? { x0: Math.min(wx, wx - dx * 20), x1: Math.max(wx, wx - dx * 20), y0: wy - 20, y1: wy + 20 } : { x0: wx - 20, x1: wx + 20, y0: Math.min(wy, wy - dy * 20), y1: Math.max(wy, wy - dy * 20) };
  return !solids.some(s => boxOverlap(s, z));
}
// tiles a box comes within g u of (no loose board goes there)
function nearBoxes(solids, W, H, g) {
  const m = new Uint8Array(W * H);
  for (const s of solids) for (let y = Math.max(0, Math.floor((s.y0 - g) / T)); y <= Math.min(H - 1, Math.floor((s.y1 + g) / T)); y++)
    for (let x = Math.max(0, Math.floor((s.x0 - g) / T)); x <= Math.min(W - 1, Math.floor((s.x1 + g) / T)); x++)
      if (s.x0 - g < x * T + T && s.x1 + g > x * T && s.y0 - g < y * T + T && s.y1 + g > y * T) m[y * W + x] = 1;
  return m;
}
// where no box may go: the start, each wardrobe and the two tiles in front of it, the exit and the tile in front of it
function protectedTiles(closets, exit, W = GW, H = GH, wallAt = isWall) {
  const p = new Uint8Array(W * H), mark = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) p[y * W + x] = 1; };
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) mark(x, y);
  for (const [x, y, ox, oy] of closets) for (let k = 0; k <= 2; k++) mark(x + ox * k, y + oy * k);
  const o = DIRS.find(([dx, dy]) => !wallAt(exit[0] + dx, exit[1] + dy)) || [0, 0];
  mark(exit[0], exit[1]); mark(exit[0] + o[0], exit[1] + o[1]);
  return p;
}
// what a servant corridor must keep clear of: each wardrobe and its two tiles, the exit and its front, every puzzle's cell
function keepTiles(closets, exit, puzzles, W = GW, H = GH, wallAt = isWall) {
  const p = protectedTiles(closets, exit, W, H, wallAt);
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) p[y * W + x] = 0;
  for (const z of puzzles) p[z.cell[1] * W + z.cell[0]] = 1;
  return p;
}
const startCell = (x, y) => x <= 3 && y <= 3;                // (the four cells of the start, never a wardrobe or the exit)
const deadEnds = () => CELLS.filter(([x, y]) => !startCell(x, y) && wallCount(x, y) === 3);
const openSetConnected = () => { const w = gridFlat(); return reachCount(GW, GH, w, null, 1, 1) === countOpen(w); };

/* ---------- building a floor's layout (on the host, inside withSeed: js/floors.js) ---------- */
// stamp the floor's halls over the maze: they only open tiles (never at the start, a tile apart, keeping the dead ends)
function stampHalls(i) {
  const F = FLOORS[i], rooms = [];
  for (const id of HALL_PLAN[i]) {
    const t = HALL_TEMPLATES[id], [a, b] = t.cells, [sw, sh] = Math.random() < 0.5 ? [a, b] : [b, a];
    for (let k = 0; k < 40; k++) {
      const cx0 = Math.random() * (F.cw - sw + 1) | 0, cy0 = Math.random() * (F.ch - sh + 1) | 0;
      const r = { tx0: 2 * cx0 + 1, ty0: 2 * cy0 + 1, tx1: 2 * (cx0 + sw - 1) + 1, ty1: 2 * (cy0 + sh - 1) + 1 };
      if (r.tx0 <= 5 && r.ty0 <= 5) continue;
      if (rooms.some(o => r.tx0 - 1 <= o.tx1 && r.tx1 + 1 >= o.tx0 && r.ty0 - 1 <= o.ty1 && r.ty1 + 1 >= o.ty0)) continue;
      let dead = 0; for (let y = r.ty0; y <= r.ty1; y += 2) for (let x = r.tx0; x <= r.tx1; x += 2) if (wallCount(x, y) === 3) dead++;
      if (dead > 1) continue;
      for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) grid[y][x] = 0;
      const w = r.tx1 - r.tx0, h = r.ty1 - r.ty0;   // (a gable's ridge runs along the long side: flags bit 0 = along y)
      r.flags = t.roof === 'gable' ? (h > w ? 1 : h < w ? 0 : Math.random() < 0.5 ? 1 : 0) : 0;
      rooms.push(Object.assign(r, { id, tpl: HALL_TEMPLATE_IDS.indexOf(id), t })); break;
    }
  }
  return rooms;
}
// each hall keeps at most 4 ways in (5 for a hallway), so the floor stays as long to walk as before: close spare connectors, one at a time
function doorBudget(rooms) {
  const inAny = (x, y) => rooms.some(o => inRect(o, x, y));
  for (const r of rooms) {
    const per = [];
    for (let x = r.tx0; x <= r.tx1; x++) per.push([x, r.ty0 - 1], [x, r.ty1 + 1]);
    for (let y = r.ty0; y <= r.ty1; y++) per.push([r.tx0 - 1, y], [r.tx1 + 1, y]);
    const ways = shuffle(per.filter(([x, y]) => !isWall(x, y))), lim = r.t.kind === 'hallway' ? 5 : 4; let n = ways.length;
    for (const [x, y] of ways) { if (n <= lim) break;
      if ((x + y) % 2 === 0 || inAny(x, y) || (x <= 4 && y <= 4) || x <= 0 || y <= 0 || x >= GW - 1 || y >= GH - 1) continue;
      grid[y][x] = 1; if (openSetConnected()) n--; else grid[y][x] = 0; }
  }
}
// wardrobes need dead ends: close corridor connectors next to two-way cells until there are enough (one more for the exit)
function alcovePass(quota, rooms) {
  const inRoom = (x, y) => rooms.some(r => inRect(r, x, y));
  for (let guard = 0; guard < 40 && deadEnds().length < quota + 1; guard++) {
    const cand = [];
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
      if (grid[y][x] || (x + y) % 2 === 0 || inRoom(x, y) || (x <= 4 && y <= 4)) continue;
      const v = !isWall(x, y - 1) && !isWall(x, y + 1) && isWall(x - 1, y) && isWall(x + 1, y);
      const h = !isWall(x - 1, y) && !isWall(x + 1, y) && isWall(x, y - 1) && isWall(x, y + 1);
      if (!v && !h) continue;
      if ([v ? [x, y - 1] : [x - 1, y], v ? [x, y + 1] : [x + 1, y]].some(([cx, cy]) => cx % 2 === 1 && cy % 2 === 1 && !inRoom(cx, cy) && !startCell(cx, cy) && wallCount(cx, cy) === 2))
        cand.push([x, y]);
    }
    let ok = false;
    for (const [x, y] of shuffle(cand)) { grid[y][x] = 1; if (openSetConnected()) { ok = true; break; } grid[y][x] = 0; }
    if (!ok) break;
  }
}
// the exit: the dead end farthest from the start (by plain search), chosen before anything else is placed
function reserveExit() {
  const d0 = bfsDist(1, 1, null), far = (a, c) => !a || d0[idx(c[0], c[1])] > d0[idx(a[0], a[1])] ? c : a;
  return deadEnds().reduce(far, null) || CELLS.filter(([x, y]) => !startCell(x, y) && wallCount(x, y) >= 1).reduce(far, null) || [1, 1];
}
// the wardrobes: other dead ends, as many as the quota; [x, y, ox, oy] with (ox, oy) the way out
function pickClosets(quota, exit) {
  return shuffle(deadEnds().filter(c => c[0] !== exit[0] || c[1] !== exit[1])).slice(0, quota).map(c => {
    const [ox, oy] = DIRS.find(([dx, dy]) => !isWall(c[0] + dx, c[1] + dy)); return [c[0], c[1], ox, oy]; });
}
// the furniture you bump into: islands first (the even tiles in the middle of a hall), then each template's slots. A box is kept only
// if it passes every rule (A8.2 of the build spec). Returns the boxes and the cuts they make.
function furnishHalls(rooms, prot) {
  const W = GW, H = GH, wall = gridFlat(), open = countOpen(wall), solids = [];
  let cut = new Uint8Array(W * H), nIsl = 0;
  const pickOf = a => a[Math.random() * a.length | 0];
  // a box for KIT piece id, turned by rot, placed by at(ex, ey) (its size along x and y) -> its edges
  const mk = (id, rot, at) => { const v = Math.random() * (KIT.items[id].vars || 1) | 0, [ex, ey] = kitSize(id, rot, v);
    return Object.assign(at(ex, ey), { k: KIT.solidIds.indexOf(id), id, kind: KIT.items[id].slot, rot, v }); };
  const pocketAt = (id, X, Y) => mk(id, Math.random() * 4 | 0, (ex, ey) => ({ x0: X * T - ex / 2, y0: Y * T - ey / 2, x1: X * T + ex / 2, y1: Y * T + ey / 2 }));
  const add = s => {
    const ax = Math.floor(s.x0 / T), bx = Math.ceil(s.x1 / T) - 1, ay = Math.floor(s.y0 / T), by = Math.ceil(s.y1 / T) - 1;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (wall[y * W + x] || prot[y * W + x]) return false;     // on open, unprotected tiles
    for (let y = ay - 1; y <= by + 1; y++) for (let x = ax - 1; x <= bx + 1; x++) {                                          // off every tile core
      if (wall[y * W + x] || (s.isl && s.isl[0] === x && s.isl[1] === y)) continue;
      const cx = x * T + T / 2, cy = y * T + T / 2;
      if (s.x0 < cx + R_NAV && s.x1 > cx - R_NAV && s.y0 < cy + R_NAV && s.y1 > cy - R_NAV) return false; }
    for (const o of solids) if (boxOverlap(s, o, BOX_GAP)) return false;                                                     // 26 u from the others
    const c2 = cut.slice(); addCuts(c2, s, W, H, wall);                                                                      // and still all connected
    if (reachCount(W, H, wall, c2, 1, 1) !== open - nIsl - (s.isl ? 1 : 0)) return false;
    solids.push(s); cut = c2; if (s.isl) nIsl++; return true;
  };
  for (const r of rooms) {
    const t = r.t; if (t.kind === 'hallway') continue;
    // corner points inside the hall ([X, Y]: the point X*T, Y*T), the island tiles, and the corner points nothing stands on yet
    const corners = [], isl = [], free = new Set();
    for (let Y = r.ty0 + 1; Y <= r.ty1; Y++) for (let X = r.tx0 + 1; X <= r.tx1; X++) { corners.push([X, Y]); free.add(X + ',' + Y); }
    for (let y = r.ty0 + 1; y < r.ty1; y++) for (let x = r.tx0 + 1; x < r.tx1; x++) if (!(x & 1) && !(y & 1)) isl.push([x, y]);
    const use = (X, Y) => free.delete(X + ',' + Y), isFree = ([X, Y]) => free.has(X + ',' + Y);
    if (t.mode === 'islands') for (const [x, y] of shuffle(isl).slice(0, t.islands.max)) {
      const s = mk(pickOf(t.islands.pick), Math.random() * 4 | 0, (ex, ey) => ({ x0: x * T + (T - ex) / 2, y0: y * T + (T - ey) / 2, x1: x * T + (T + ex) / 2, y1: y * T + (T + ey) / 2, isl: [x, y] }));
      if (add(s)) { use(x, y); use(x + 1, y); use(x, y + 1); use(x + 1, y + 1); }
    }
    if (t.mode === 'columns') for (const [X, Y] of corners) {
      const p = t.column.pattern, on = p === 'all' || (p === 'ring' ? X === r.tx0 + 1 || X === r.tx1 || Y === r.ty0 + 1 || Y === r.ty1 : (X + Y) % 2 === 0);
      if (on && add(pocketAt(t.column.id, X, Y))) use(X, Y);
    }
    for (const sl of t.slots) {
      let placed = 0;
      if (sl.type === 'pocket') for (const [X, Y] of shuffle(corners.filter(isFree))) {
        if (placed >= sl.max) break; if (add(pocketAt(pickOf(sl.pick), X, Y))) { placed++; use(X, Y); } }
      if (sl.type === 'bar') {                    // between two free corner points, along the grid line between them
        const pairs = [];
        for (const [X, Y] of corners.filter(isFree)) { if (isFree([X + 1, Y]) && X + 1 <= r.tx1) pairs.push([X, Y, 1]); if (isFree([X, Y + 1]) && Y + 1 <= r.ty1) pairs.push([X, Y, 0]); }
        for (const [X, Y, hz] of shuffle(pairs)) { if (placed >= sl.max) break;
          const cx = (X + (hz ? 0.5 : 0)) * T, cy = (Y + (hz ? 0 : 0.5)) * T, rot = (hz ? 1 : 0) + (Math.random() < 0.5 ? 2 : 0);
          if (add(mk(pickOf(sl.pick), rot, (ex, ey) => ({ x0: cx - ex / 2, y0: cy - ey / 2, x1: cx + ex / 2, y1: cy + ey / 2 })))) { placed++; use(X, Y); use(X + hz, Y + 1 - hz); } }
      }
      if (sl.type === 'wall') {                   // its back to the hall's wall at a corner point, both wall tiles behind it solid; never
        const wl = [];                            // an outside wall (that's where js/dress.js may put windows)
        for (let Y = r.ty0 + 1; Y <= r.ty1; Y++) {
          if (r.tx0 - 1 > 0 && isWall(r.tx0 - 1, Y - 1) && isWall(r.tx0 - 1, Y)) wl.push([r.tx0, Y, 1, 0]);
          if (r.tx1 + 1 < W - 1 && isWall(r.tx1 + 1, Y - 1) && isWall(r.tx1 + 1, Y)) wl.push([r.tx1 + 1, Y, -1, 0]); }
        for (let X = r.tx0 + 1; X <= r.tx1; X++) {
          if (r.ty0 - 1 > 0 && isWall(X - 1, r.ty0 - 1) && isWall(X, r.ty0 - 1)) wl.push([X, r.ty0, 0, 1]);
          if (r.ty1 + 1 < H - 1 && isWall(X - 1, r.ty1 + 1) && isWall(X, r.ty1 + 1)) wl.push([X, r.ty1 + 1, 0, -1]); }
        for (const [X, Y, nx, ny] of shuffle(wl)) { if (placed >= sl.max) break;
          const px = X * T, py = Y * T, rot = ny > 0 ? 0 : nx > 0 ? 1 : ny < 0 ? 2 : 3;
          if (add(mk(pickOf(sl.pick), rot, (ex, ey) => nx ? { x0: nx > 0 ? px : px - ex, x1: nx > 0 ? px + ex : px, y0: py - ey / 2, y1: py + ey / 2 }
            : { y0: ny > 0 ? py : py - ey, y1: ny > 0 ? py + ey : py, x0: px - ex / 2, x1: px + ex / 2 }))) placed++; }
      }
    }
  }
  return { solids, cut };
}
// servant corridors: one straight run of 4+ open tiles a floor (two in the basement), away from the halls and the start, with walls on
// both sides (at most 2 tiles open to the side), never through a wardrobe, the exit or a puzzle. Only how it looks changes (js/arch.js).
function markRuns(i, rooms, keep) {
  const ok = (x, y) => !isWall(x, y) && !keep[y * GW + x] && !(x <= 5 && y <= 5) && !rooms.some(r => inRect(r, x, y, 1));
  let cand = [];
  for (const hz of [1, 0]) for (let line = 1; line < (hz ? GH : GW) - 1; line++) {
    const len = hz ? GW : GH, at = j => hz ? [j, line] : [line, j];
    const side = j => { const [x, y] = at(j); return hz ? !(isWall(x, y - 1) && isWall(x, y + 1)) : !(isWall(x - 1, y) && isWall(x + 1, y)); };
    let prevEnd = -1;
    for (let a = 1; a < len - 1; a++) {           // the longest run from each tile (one that only repeats the last one's end is skipped)
      if (!ok(...at(a))) { prevEnd = -1; continue; }
      let b = a, j = 0;
      for (; b < len - 1 && ok(...at(b)); b++) if (side(b) && ++j > 2) break;
      const end = b - 1;
      if (end - a >= 3 && end !== prevEnd) cand.push(hz ? [0, a, line, end, line] : [0, line, a, line, end]);
      prevEnd = end;
    }
  }
  const runs = [];
  for (let k = i === 2 ? 2 : 1; k > 0 && cand.length; k--) {
    const r = cand[Math.random() * cand.length | 0]; runs.push(r);
    cand = cand.filter(c => c[1] > r[3] + 1 || c[3] < r[1] - 1 || c[2] > r[4] + 1 || c[4] < r[2] - 1);     // (a second one apart from it)
  }
  return runs;
}
// a servant run is legal (validateFloor): straight, 4+ tiles, the tile rules above
function runLegal([kind, x0, y0, x1, y1], W, H, isW, rooms, keep) {
  if (kind !== 0 || (x0 !== x1 && y0 !== y1) || x1 < x0 || y1 < y0 || Math.max(x1 - x0, y1 - y0) < 3) return false;
  const hz = y0 === y1 && x1 > x0; let j = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (isW(x, y) || keep[y * W + x] || (x <= 5 && y <= 5) || rooms.some(r => inRect(r, x, y, 1))) return false;
    if (hz ? !(isW(x, y - 1) && isW(x, y + 1)) : !(isW(x - 1, y) && isW(x + 1, y))) j++;
  }
  return j <= 2;
}

/* ---------- on every client: nav, ceilings ---------- */
// NAV: cut (as above), bucket (per tile: the boxes within 14 u of it, for solidAt), isl (1 on island tiles),
// occ (a 10 u raster for losSight: bit 0 a tall box, bit 1 a low one; a cell counts if its centre is 2 u inside the box)
function buildNav(solids) {
  const W = GW, H = GH, n = W * H, NX = W * 5, nav = { cut: cutsFrom(solids, W, H, gridFlat()), bucket: new Array(n).fill(null), isl: new Uint8Array(n), occ: new Uint8Array(n * 25) };
  solids.forEach((s, i) => {
    for (let y = Math.max(0, Math.floor((s.y0 - 14) / T)); y <= Math.min(H - 1, Math.floor((s.y1 + 14) / T)); y++)
      for (let x = Math.max(0, Math.floor((s.x0 - 14) / T)); x <= Math.min(W - 1, Math.floor((s.x1 + 14) / T)); x++) (nav.bucket[y * W + x] || (nav.bucket[y * W + x] = [])).push(i);
    if (s.isl) nav.isl[s.isl[1] * W + s.isl[0]] = 1;
    const bit = s.occ === 'tall' ? 1 : s.occ === 'low' ? 2 : 0;
    if (bit) for (let b = Math.floor(s.y0 / 10); b * 10 < s.y1; b++) for (let a = Math.floor(s.x0 / 10); a * 10 < s.x1; a++)
      if (a * 10 + 5 > s.x0 + 2 && a * 10 + 5 < s.x1 - 2 && b * 10 + 5 > s.y0 + 2 && b * 10 + 5 < s.y1 - 2) nav.occ[b * NX + a] |= bit;
  });
  return nav;
}
// a gable hall's ceiling at a point, a in tiles across the ridge (x when the ridge runs along y, else y)
function gableAt(r, a) {
  const al = r.flags & 1, c = al ? (r.tx0 + r.tx1 + 1) / 2 : (r.ty0 + r.ty1 + 1) / 2, hw = al ? (r.tx1 - r.tx0 + 1) / 2 : (r.ty1 - r.ty0 + 1) / 2;
  return r.t.eave + (r.t.ceil - r.t.eave) * Math.max(0, 1 - Math.abs(a - c) / hw);
}
// the ceiling height of every tile (m): the floor's own, a hall's, 2.55 in a servant run; under a gable, the tile's lowest point
function ceilings(i, rooms, runs, W = GW, H = GH) {
  const c = new Float32Array(W * H).fill(FLOORS[i] ? FLOORS[i].ceil : 3);
  for (const r of rooms) for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) {
    const a = r.flags & 1 ? x : y; c[y * W + x] = r.t.roof === 'gable' ? Math.min(gableAt(r, a), gableAt(r, a + 1)) : r.t.ceil; }
  for (const [, x0, y0, x1, y1] of runs) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) c[y * W + x] = SERVANT_CEIL;
  return c;
}
const ceilAt = (tx, ty) => CEIL && tx >= 0 && ty >= 0 && tx < GW && ty < GH ? CEIL[ty * GW + tx] : FLOORS[floorIdx] ? FLOORS[floorIdx].ceil : 3;
// the ceiling at a point in metres (x, z), with the slope of a gable hall
function ceilAtXZ(xm, zm) {
  const L = T * KIT.u, tx = Math.floor(xm / L), ty = Math.floor(zm / L);
  for (const r of ROOMS) if (r.t.roof === 'gable' && inRect(r, tx, ty)) return gableAt(r, (r.flags & 1 ? xm : zm) / L);
  return ceilAt(tx, ty);
}
// set up a floor's layout from its data, after the grid (js/floors.js applyFloor). Houses from before layouts (no d.v) get none.
function applyLayout(d) {
  const ok = d.v === LAYOUT_VERSION;
  VSEED = ok ? d.seed >>> 0 : 0;
  ROOMS = ok ? (d.rooms || []).map(roomOf) : [];
  RUNS = ok ? (d.runs || []).map(([kind, tx0, ty0, tx1, ty1]) => ({ kind, tx0, ty0, tx1, ty1 })) : [];
  SOLIDS = ok ? (d.solids || []).map(decodeSolid) : [];
  CEIL = ceilings(d.i, ROOMS, ok ? d.runs || [] : []);
  NAV = buildNav(SOLIDS);
}

/* ---------- validateFloor: is this house completable? (pure: its own grid, nothing global) ---------- */
// what's wrong with one box: its slot, its footprint against KIT, its tiles (null if nothing)
function boxProblem(s, rooms, W, H, isW, prot) {
  if (!s.id) return 'a box of an unknown kind';
  const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2, r = rooms.find(o => o.t.kind === 'room' && inRect(o, Math.floor(cx / T), Math.floor(cy / T)));
  if (!r) return 'a box outside the halls';
  const t = r.t, [ex, ey] = kitSize(s.id, s.rot, s.v), near = (a, b) => Math.abs(a - b) <= 0.5, line = v => near(v, Math.round(v / T) * T);   // (line: on a tile edge, in u)
  if ((t.mode === 'islands' ? t.islands.pick : []).concat(t.mode === 'columns' ? [t.column.id] : [], ...t.slots.map(sl => sl.pick)).indexOf(s.id) < 0) return "a box its hall's template doesn't list";
  if (!near(s.x1 - s.x0, ex) || !near(s.y1 - s.y0, ey)) return "a box that doesn't match its KIT footprint";
  if (s.kind === 'island') {
    const [x, y] = s.isl, ins = [s.x0 - x * T, (x + 1) * T - s.x1, s.y0 - y * T, (y + 1) * T - s.y1];
    if (x & 1 || y & 1 || !(x > r.tx0 && x < r.tx1 && y > r.ty0 && y < r.ty1)) return 'an island off an island tile';
    if (ins.some(v => v < 3.33 || v > 11)) return 'an island inset outside 3.33..11 u';
  } else if (s.kind === 'pocket') {
    const X = Math.round(cx / T), Y = Math.round(cy / T);
    if (!line(cx) || !line(cy) || !(X > r.tx0 && X <= r.tx1 && Y > r.ty0 && Y <= r.ty1)) return 'a pocket off a corner point';
    if (ex > 22 || ey > 22) return 'a pocket too big';
  } else if (s.kind === 'bar') {
    const hz = s.rot & 1, ca = (hz ? cx : cy) - T / 2, cb = hz ? cy : cx, a = Math.round(ca / T), b = Math.round(cb / T);
    const a0 = hz ? r.tx0 : r.ty0, a1 = hz ? r.tx1 : r.ty1, b0 = hz ? r.ty0 : r.tx0, b1 = hz ? r.ty1 : r.tx1;
    if (!line(ca) || !line(cb) || !(a > a0 && a + 1 <= a1 && b > b0 && b <= b1)) return 'a bar off its two corner points';
    if ((hz ? ey : ex) > 22 || (hz ? ex : ey) > 72) return 'a bar too big';
  } else if (s.kind === 'wall') {
    const nx = s.rot === 1 ? 1 : s.rot === 3 ? -1 : 0, ny = s.rot === 0 ? 1 : s.rot === 2 ? -1 : 0, bk = nx ? (nx > 0 ? s.x0 : s.x1) : ny > 0 ? s.y0 : s.y1, ac = nx ? cy : cx;
    const X = Math.round((nx ? bk : cx) / T), Y = Math.round((nx ? cy : bk) / T), along = nx ? Y : X;
    const plane = bk === (nx > 0 ? r.tx0 : nx < 0 ? r.tx1 + 1 : ny > 0 ? r.ty0 : r.ty1 + 1) * T, inside = nx ? along > r.ty0 && along <= r.ty1 : along > r.tx0 && along <= r.tx1;
    const back = nx ? [[X - (nx > 0 ? 1 : 0), Y - 1], [X - (nx > 0 ? 1 : 0), Y]] : [[X - 1, Y - (ny > 0 ? 1 : 0)], [X, Y - (ny > 0 ? 1 : 0)]];
    if (!plane || !line(ac) || !inside || !back.every(([x, y]) => isW(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1)) return 'a wall piece off a solid inside wall';
    const dep = nx ? ex : ey, acr = nx ? ey : ex;
    if (dep < 13 || dep > 61 || acr > 22) return 'a wall piece too big';
  }
  const ax = Math.floor(s.x0 / T), bx = Math.ceil(s.x1 / T) - 1, ay = Math.floor(s.y0 / T), by = Math.ceil(s.y1 / T) - 1;
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { if (isW(x, y)) return 'a box in a wall'; if (prot[y * W + x]) return 'a box on a protected tile'; }
  for (let y = ay - 1; y <= by + 1; y++) for (let x = ax - 1; x <= bx + 1; x++) {
    if (isW(x, y) || (s.isl && s.isl[0] === x && s.isl[1] === y)) continue;
    if (boxOverlap(s, { x0: x * T + T / 2 - R_NAV, y0: y * T + T / 2 - R_NAV, x1: x * T + T / 2 + R_NAV, y1: y * T + T / 2 + R_NAV })) return "a box on a tile's core"; }
  return null;
}
// where a body of radius r can't stand, on a 5 u lattice (walls, boxes, and for you the wardrobes, as game.js has them)
function bodyRaster(W, H, isW, solids, r, closets) {
  const NX = W * 10, NY = H * 10, B = new Uint8Array(NX * NY), CF = T / 2 - 0.6 / KIT.u;
  for (let b = 0; b < NY; b++) { const ya = Math.floor((b * 5 - r) / T), yb = Math.floor((b * 5 + r) / T);
    for (let a = 0; a < NX; a++) { const xa = Math.floor((a * 5 - r) / T), xb = Math.floor((a * 5 + r) / T);
      if (isW(xa, ya) || isW(xb, ya) || isW(xa, yb) || isW(xb, yb)) B[b * NX + a] = 1; } }
  for (const s of solids) for (let b = Math.max(0, Math.floor((s.y0 - r) / 5) + 1); b <= Math.min(NY - 1, Math.ceil((s.y1 + r) / 5) - 1); b++)
    for (let a = Math.max(0, Math.floor((s.x0 - r) / 5) + 1); a <= Math.min(NX - 1, Math.ceil((s.x1 + r) / 5) - 1); a++) B[b * NX + a] = 1;
  if (closets) for (const [tx, ty, ox, oy] of closets) { const x = tx * T + T / 2, y = ty * T + T / 2;
    for (let b = Math.max(0, Math.floor((y - T) / 5)); b <= Math.min(NY - 1, Math.ceil((y + T) / 5)); b++) for (let a = Math.max(0, Math.floor((x - T) / 5)); a <= Math.min(NX - 1, Math.ceil((x + T) / 5)); a++) {
      const dx = a * 5 - x, dy = b * 5 - y, al = dx * ox + dy * oy, sd = Math.abs(dx * oy - dy * ox);
      if (sd < T / 2 && al > -T && al - r < -CF) B[b * NX + a] = 1; } }
  return B;
}
// flood the lattice from a point; returns a query: is some reached lattice point within rad of (x, y) (and passes ok, if given)?
function flood5(W, H, B, sx, sy) {
  const NX = W * 10, NY = H * 10, seen = new Uint8Array(NX * NY), q = new Int32Array(NX * NY), s0 = Math.round(sy / 5) * NX + Math.round(sx / 5);
  let h = 0, t = 0; if (!B[s0]) { seen[s0] = 1; q[t++] = s0; }
  while (h < t) { const k = q[h++], a = k % NX;
    if (a + 1 < NX && !seen[k + 1] && !B[k + 1]) { seen[k + 1] = 1; q[t++] = k + 1; }
    if (a > 0 && !seen[k - 1] && !B[k - 1]) { seen[k - 1] = 1; q[t++] = k - 1; }
    if (k + NX < NX * NY && !seen[k + NX] && !B[k + NX]) { seen[k + NX] = 1; q[t++] = k + NX; }
    if (k >= NX && !seen[k - NX] && !B[k - NX]) { seen[k - NX] = 1; q[t++] = k - NX; } }
  return (x, y, rad, ok) => {
    for (let b = Math.max(0, Math.ceil((y - rad) / 5)); b <= Math.min(NY - 1, Math.floor((y + rad) / 5)); b++)
      for (let a = Math.max(0, Math.ceil((x - rad) / 5)); a <= Math.min(NX - 1, Math.floor((x + rad) / 5)); a++)
        if (seen[b * NX + a] && Math.hypot(a * 5 - x, b * 5 - y) < rad && (!ok || ok(a * 5, b * 5))) return true;
    return false;
  };
}
// the checks (a)..(j) of the build spec (A13); returns what's wrong (empty: the house is good)
function validateFloor(d) {
  const bad = [], add = m => { if (!bad.includes(m)) bad.push(m); };
  const rows = d.rows, H = rows.length, W = rows[0].length, n = W * H, wall = new Uint8Array(n);
  // (a) the grid: nothing but '0' and '1', every cell open, the border solid
  for (let y = 0; y < H; y++) { if (rows[y].length !== W) add('rows of different lengths');
    for (let x = 0; x < W; x++) { const ch = rows[y][x]; if (ch !== '0' && ch !== '1') add('a tile that is neither 0 nor 1'); wall[y * W + x] = ch === '0' ? 0 : 1; } }
  const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y * W + x] === 1, open = (x, y) => !isW(x, y);
  for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) if (isW(x, y)) add('a cell is closed');
  for (let x = 0; x < W; x++) if (open(x, 0) || open(x, H - 1)) add('the border is open');
  for (let y = 0; y < H; y++) if (open(0, y) || open(W - 1, y)) add('the border is open');
  const fresh = d.v === LAYOUT_VERSION, rooms = fresh ? d.rooms.map(roomOf) : [], runs = fresh ? d.runs : [], solids = fresh ? d.solids.map(decodeSolid) : [];
  const ways = (x, y) => DIRS.filter(([dx, dy]) => open(x + dx, y + dy)).length, key = c => c[0] + ',' + c[1], mid = c => [c[0] * T + T / 2, c[1] * T + T / 2];
  // (b) wardrobes: the quota, each in a dead end facing open floor (and the exit in a dead end)
  if (d.closets.length !== 4 + 2 * d.i + (d.n - 1)) add('wardrobes short');
  for (const [x, y, ox, oy] of d.closets) if (ways(x, y) !== 1 || !open(x + ox, y + oy)) add('a wardrobe not in a dead end');
  if (ways(d.exit[0], d.exit[1]) !== 1) add('the exit not in a dead end');
  const taken = new Set(d.closets.map(key).concat([key(d.exit)]));
  // (c) puzzles: all of them, each on a wall, not in a wardrobe or the exit, nothing in front
  if (d.puzzles.length !== puzzleCount(d.i, d.diff)) add('puzzles short');
  for (const z of d.puzzles) { const [x, y] = z.cell, [dx, dy] = z.dir;
    if (open(x + dx, y + dy)) add('a puzzle on no wall'); if (taken.has(key(z.cell))) add('a puzzle in a wardrobe or the exit');
    if (!faceClear(solids, x, y, dx, dy)) add('a box in front of a puzzle'); }
  // (d) spawns: open, 11 u clear of walls and boxes
  for (const [sx, sy] of d.spawns) if ([[-11, -11], [11, -11], [-11, 11], [11, 11]].some(([ox, oy]) => isW(Math.floor((sx + ox) / T), Math.floor((sy + oy) / T)))
    || solids.some(s => sx + 11 > s.x0 && sx - 11 < s.x1 && sy + 11 > s.y0 && sy - 11 < s.y1)) add('a spawn touches a wall or a box');
  // (e) every box: its slot, its footprint, open and unprotected tiles (the whole start counts here), off the cores, 26 u apart
  const prot = protectedTiles(d.closets, d.exit, W, H, isW), islT = new Uint8Array(n);
  for (let y = 0; y <= 5; y++) for (let x = 0; x <= 5; x++) prot[y * W + x] = 1;
  solids.forEach((s, j) => { const e = boxProblem(s, rooms, W, H, isW, prot); if (e) add(e); if (s.isl) islT[s.isl[1] * W + s.isl[0]] = 1;
    for (let k = j + 1; k < solids.length; k++) if (boxOverlap(s, solids[k], BOX_GAP)) add('boxes closer than 26 u'); });
  // (f) the nav graph (cut steps left out) from every spawn reaches every open tile that isn't an island
  const cut = cutsFrom(solids, W, H, wall); let want = 0; for (let k = 0; k < n; k++) if (!wall[k] && !islT[k]) want++;
  for (const t of new Set(d.spawns.map(([sx, sy]) => Math.floor(sx / T) + ',' + Math.floor(sy / T)))) { const [tx, ty] = t.split(',').map(Number);
    if (reachCount(W, H, wall, cut, tx, ty) !== want) add('an open tile unreachable (nav graph)'); }
  // (g) you (radius 11; walls, boxes, wardrobes), from the first spawn: the exit, notes, puzzles (with a sight line past walls and tall
  // boxes), wardrobes and the other spawns
  const P = flood5(W, H, bodyRaster(W, H, isW, solids, 11, d.closets), d.spawns[0][0], d.spawns[0][1]), tall = solids.filter(s => s.occ === 'tall');
  const sight = (ax, ay, bx, by) => { const m = Math.ceil(Math.hypot(bx - ax, by - ay) / 4);
    for (let k = 1; k < m; k++) { const x = ax + (bx - ax) * k / m, y = ay + (by - ay) * k / m;
      if (isW(Math.floor(x / T), Math.floor(y / T)) || tall.some(s => x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1)) return false; }
    return true; };
  if (!P(...mid(d.exit), 18)) add('the exit unreachable');
  for (const c of d.notes) if (!P(...mid(c), 20)) add('a note unreachable');
  for (const z of d.puzzles) { const wx = (z.cell[0] + 0.5) * T + z.dir[0] * (T / 2 - 12), wy = (z.cell[1] + 0.5) * T + z.dir[1] * (T / 2 - 12);
    if (!P(wx, wy, 36, (x, y) => sight(x, y, wx, wy))) add('a puzzle out of reach'); }
  for (const c of d.closets) if (!P(...mid(c), 28)) add('a wardrobe unreachable');
  for (const [sx, sy] of d.spawns) if (!P(sx, sy, 5)) add('a spawn cut off');
  // (h) her (radius 12; walls and boxes) from where she starts: every open tile's centre that isn't an island, and her stand point
  // in front of every wardrobe
  const M = flood5(W, H, bodyRaster(W, H, isW, solids, 12, null), ...mid(d.m0));
  let lost = false;
  for (let k = 0; k < n && !lost; k++) if (!wall[k] && !islT[k] && !M(...mid([k % W, (k - k % W) / W]), 4)) lost = true;
  if (lost) add('a tile she cannot reach');
  for (const [x, y, ox, oy] of d.closets) if (!M(x * T + T / 2 + ox * 16, y * T + T / 2 + oy * 16, 4)) add('a wardrobe she cannot reach');
  // (i) she starts somewhere you can reach, far from the start (over half the longest way)
  const d1 = navDist(W, H, wall, cut, 1, 1); let maxD = 0; for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) maxD = Math.max(maxD, d1[y * W + x]);
  if (!P(...mid(d.m0), 4)) add('her start unreachable');
  if (!(d1[d.m0[1] * W + d.m0[0]] > maxD * 0.55)) add('she starts too close');
  // (j) servant runs legal; no loose board on a run, or within 14 u of a box
  const keep = keepTiles(d.closets, d.exit, d.puzzles, W, H, isW), onRun = new Uint8Array(n), nearB = nearBoxes(solids, W, H, 14);
  for (const r of runs) { if (!runLegal(r, W, H, isW, rooms, keep)) add('a servant run that breaks the rules');
    for (let y = r[2]; y <= r[4]; y++) for (let x = r[1]; x <= r[3]; x++) onRun[y * W + x] = 1; }
  for (const [x, y] of d.creaks || []) { const k = Math.floor(y / T) * W + Math.floor(x / T); if (onRun[k] || nearB[k]) add('a loose board on a servant run or by a box'); }
  return bad;
}
