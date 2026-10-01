// The house's layout (js/layout.js): halls, the furniture you bump into, cuts and nav. Logic only, nothing is drawn.
// 1,800 houses with explicit seeds: each one is checked by the game (validateFloor) and then again here by this test's own code, which
// shares nothing with the game's: walls from the rows, boxes from d.solids and the footprints in js/kitdefs.js, its own floods and cuts.
import { launch, solo, check, summary, pageErrors } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kitSrc = fs.readFileSync(path.join(ROOT, 'js/kitdefs.js'), 'utf8');
const KIT = JSON.parse(kitSrc.slice(kitSrc.indexOf('/*KITDEFS*/') + 11, kitSrc.indexOf('/*END*/')));
const T = 50, DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIFFS = ['easy', 'medium', 'hard'], SEEDS = 30;
const BASELINE = [54, 64, 68, 66, 70];                                   // (today's longest way per floor, measured before the layout)
const seedOf = (i, n, di, s) => (i * 1000003 + n * 7919 + di * 31 + s * 104729 + 17) >>> 0;
const puzzleCount = (i, diff) => Math.max(1, Math.min(5, [3, 3, 4, 4, 5][i] + (diff === 'easy' ? -1 : 0)));
const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

const b = await launch();
const p = await solo(b, 'low', 480, 300);
const C = await p.evaluate(() => ({ BOARD_LEN, BOARD_MID_LEN, BOARD_ACROSS, plan: HALL_PLAN.map(f => f.length) }));

/* ---------- this test's own model of a house ---------- */
function model(d) {
  const rows = d.rows, H = rows.length, W = rows[0].length;
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || rows[y][x] !== '0';
  const boxes = d.solids.map(([k, x0, y0, x1, y1, rot, v]) => { const id = KIT.solidIds[k], it = Object.assign({}, KIT.items[id], (KIT.items[id].var || [])[v]);
    return { id, it, slot: it.slot, x0: x0 / 2, y0: y0 / 2, x1: x1 / 2, y1: y1 / 2, rot, v, tall: it.occ === 'tall' }; });
  const islands = new Set(boxes.filter(o => o.slot === 'island').map(o => Math.floor((o.x0 + o.x1) / 2 / T) + ',' + Math.floor((o.y0 + o.y1) / 2 / T)));
  const hit = (o, x0, y0, x1, y1) => o.x0 < x1 && o.x1 > x0 && o.y0 < y1 && o.y1 > y0;
  // the band of the step from (x, y) to (x+dx, y+dy): the line between the centres, 13 u either side
  const band = (x, y, dx) => { const cx = x * T + T / 2, cy = y * T + T / 2; return dx ? [cx, cy - 13, cx + T, cy + 13] : [cx - 13, cy, cx + 13, cy + T]; };
  const cut = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!wall(x, y)) {
    if (!wall(x + 1, y) && boxes.some(o => hit(o, ...band(x, y, 1)))) cut[y * W + x] |= 1;
    if (!wall(x, y + 1) && boxes.some(o => hit(o, ...band(x, y, 0)))) cut[y * W + x] |= 2; }
  const blockedStep = (x, y, dx, dy) => dx === 1 ? cut[y * W + x] & 1 : dx === -1 ? cut[y * W + x - 1] & 1 : dy === 1 ? cut[y * W + x] & 2 : cut[(y - 1) * W + x] & 2;
  const tiles = (sx, sy, useCuts = true) => { const dist = new Map([[sx + ',' + sy, 0]]), q = [[sx, sy]];
    for (let k = 0; k < q.length; k++) { const [x, y] = q[k]; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy, key = nx + ',' + ny;
      if (!wall(nx, ny) && !dist.has(key) && !(useCuts && blockedStep(x, y, dx, dy))) { dist.set(key, dist.get(x + ',' + y) + 1); q.push([nx, ny]); } } }
    return dist; };
  return { rows, W, H, wall, boxes, islands, hit, band, cut, tiles };
}
// walking: a 5 u flood fill for a body of radius r (walls by its corners, boxes, and for you the wardrobes' fronts as game.js has them)
function walker(m, r, closets) {
  const NX = m.W * 10, NY = m.H * 10, memo = new Int8Array(NX * NY).fill(-1), CF = T / 2 - 0.6 / KIT.u;
  const free = (a, b) => { const k = b * NX + a; if (memo[k] >= 0) return memo[k] === 1; const x = a * 5, y = b * 5;
    let ok = !m.wall(Math.floor((x - r) / T), Math.floor((y - r) / T)) && !m.wall(Math.floor((x + r) / T), Math.floor((y - r) / T)) &&
      !m.wall(Math.floor((x - r) / T), Math.floor((y + r) / T)) && !m.wall(Math.floor((x + r) / T), Math.floor((y + r) / T)) && !m.boxes.some(o => m.hit(o, x - r, y - r, x + r, y + r));
    if (ok && closets) ok = !closets.some(([tx, ty, ox, oy]) => { const dx = x - (tx * T + T / 2), dy = y - (ty * T + T / 2), al = dx * ox + dy * oy;
      return Math.abs(dx * oy - dy * ox) < T / 2 && al > -T && al - r < -CF; });
    memo[k] = ok ? 1 : 0; return ok; };
  return (sx, sy) => { const seen = new Uint8Array(NX * NY), st = [[Math.round(sx / 5), Math.round(sy / 5)]];
    if (!free(...st[0])) st.pop(); else seen[st[0][1] * NX + st[0][0]] = 1;
    while (st.length) { const [a, b] = st.pop(); for (const [da, db] of DIRS) { const na = a + da, nb = b + db;
      if (na >= 0 && nb >= 0 && na < NX && nb < NY && !seen[nb * NX + na] && free(na, nb)) { seen[nb * NX + na] = 1; st.push([na, nb]); } } }
    return (x, y, rad, also) => { for (let b = Math.ceil((y - rad) / 5); b <= Math.floor((y + rad) / 5); b++) for (let a = Math.ceil((x - rad) / 5); a <= Math.floor((x + rad) / 5); a++)
      if (a >= 0 && b >= 0 && a < NX && b < NY && seen[b * NX + a] && Math.hypot(a * 5 - x, b * 5 - y) < rad && (!also || also(a * 5, b * 5))) return true; return false; };
  };
}
// a box on a legal slot (A8.1), its footprint KIT's, rotated
function slotProblem(o, m, rooms) {
  const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, whole = v => Math.abs(v - Math.round(v)) < 1e-9;
  const r = rooms.find(([, x0, y0, x1, y1]) => x0 !== x1 && y0 !== y1 && cx > x0 * T && cx < (x1 + 1) * T && cy > y0 * T && cy < (y1 + 1) * T);
  if (!r) return 'a box outside the halls';
  const [, X0, Y0, X1, Y1] = r, w = Math.round(o.it.w / KIT.u), dd = Math.round(o.it.d / KIT.u), [ex, ey] = o.rot & 1 ? [dd, w] : [w, dd];
  if (Math.abs(o.x1 - o.x0 - ex) > 0.5 || Math.abs(o.y1 - o.y0 - ey) > 0.5) return 'a box not its KIT footprint';
  if (o.slot === 'pocket') return whole(cx / T) && whole(cy / T) && cx / T > X0 && cx / T <= X1 && cy / T > Y0 && cy / T <= Y1 && ex <= 22 && ey <= 22 ? null : 'a pocket off a corner point';
  if (o.slot === 'bar') { const hz = o.rot & 1, a = (hz ? cx : cy) / T - 0.5, c = (hz ? cy : cx) / T, [a0, a1, c0, c1] = hz ? [X0, X1, Y0, Y1] : [Y0, Y1, X0, X1];
    return whole(a) && whole(c) && a > a0 && a + 1 <= a1 && c > c0 && c <= c1 && (hz ? ey : ex) <= 22 && (hz ? ex : ey) <= 72 ? null : 'a bar off its corner points'; }
  if (o.slot === 'island') { const x = Math.floor(cx / T), y = Math.floor(cy / T), ins = [o.x0 - x * T, (x + 1) * T - o.x1, o.y0 - y * T, (y + 1) * T - o.y1];
    if (x % 2 || y % 2 || !(x > X0 && x < X1 && y > Y0 && y < Y1)) return 'an island off an even tile inside a hall';
    return ins.every(v => v >= 3.33 && v <= 11) ? null : 'an island inset outside 3.33..11 u'; }
  // wall: the back on the hall's wall plane at a corner point, both wall tiles behind it solid and inside the border
  const side = [o.x0 === X0 * T && o.rot === 1, o.x1 === (X1 + 1) * T && o.rot === 3, o.y0 === Y0 * T && o.rot === 0, o.y1 === (Y1 + 1) * T && o.rot === 2].indexOf(true);
  if (side < 0) return 'a wall piece off its wall';
  const along = side < 2 ? cy / T : cx / T, lo = side < 2 ? Y0 : X0, hi = side < 2 ? Y1 : X1, dep = side < 2 ? ex : ey, acr = side < 2 ? ey : ex;
  const bt = [[X0 - 1, along - 1, X0 - 1, along], [X1 + 1, along - 1, X1 + 1, along], [along - 1, Y0 - 1, along, Y0 - 1], [along - 1, Y1 + 1, along, Y1 + 1]][side];
  if (!whole(along) || along <= lo || along > hi || !m.wall(bt[0], bt[1]) || !m.wall(bt[2], bt[3])) return 'a wall piece not against two wall tiles';
  if ([bt[0], bt[2]].some(x => x <= 0 || x >= m.W - 1) || [bt[1], bt[3]].some(y => y <= 0 || y >= m.H - 1)) return 'a wall piece against the outside wall';
  return dep >= 13 && dep <= 61 && acr <= 22 ? null : 'a wall piece of the wrong size';
}
function prove(d, navCut) {
  const bad = [], add = s => { if (!bad.includes(s)) bad.push(s); }, m = model(d), { W, H, wall, boxes } = m, mid = c => [c[0] * T + T / 2, c[1] * T + T / 2];
  const deadEnd = (x, y) => DIRS.filter(([dx, dy]) => !wall(x + dx, y + dy)).length === 1;
  // invariants
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!/[01]/.test(m.rows[y][x])) add('rows hold something other than 0/1');
    if ((x % 2 && y % 2 && wall(x, y))) add('a cell is closed'); if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && !wall(x, y)) add('the border is open'); }
  if (d.closets.length !== 4 + 2 * d.i + (d.n - 1)) add('wardrobes != quota');
  for (const [x, y, ox, oy] of d.closets) if (!deadEnd(x, y) || wall(x + ox, y + oy)) add('a wardrobe not in a dead end facing open floor');
  if (d.puzzles.length !== puzzleCount(d.i, d.diff)) add('puzzles != puzzleCount');
  for (const z of d.puzzles) { if (!wall(z.cell[0] + z.dir[0], z.cell[1] + z.dir[1])) add('a puzzle hangs on no wall');
    if (d.closets.some(c => c[0] === z.cell[0] && c[1] === z.cell[1]) || z.cell.join() === d.exit.join()) add('a puzzle in a wardrobe or the exit cell'); }
  if (!deadEnd(...d.exit)) add('the exit is not a dead end');
  const dist = m.tiles(1, 1); let maxD = 0; for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) maxD = Math.max(maxD, dist.get(x + ',' + y) || 0);
  if (!((dist.get(d.m0.join()) || -1) > 0.55 * maxD)) add('she starts within 0.55 of the longest way');
  // protected zones
  const near = (o, x0, y0, x1, y1) => m.hit(o, x0, y0, x1, y1), tileBox = (x, y, g = 0) => [x * T - g, y * T - g, x * T + T + g, y * T + T + g];
  const zones = [];
  for (const [x, y, ox, oy] of d.closets) for (let k = 0; k <= 2; k++) zones.push(['a wardrobe or its front', tileBox(x + ox * k, y + oy * k)]);
  const eo = DIRS.find(([dx, dy]) => !wall(d.exit[0] + dx, d.exit[1] + dy)); zones.push(['the exit', tileBox(...d.exit)], ['the exit front', tileBox(d.exit[0] + eo[0], d.exit[1] + eo[1])]);
  for (const c of d.notes) { const [x, y] = mid(c), g = 0.2 / KIT.u + 0.1 / KIT.u; zones.push(['a note', [x - g, y - g, x + g, y + g]]); }
  for (const z of d.puzzles) { const [x, y] = mid(z.cell), wx = x + z.dir[0] * T / 2, wy = y + z.dir[1] * T / 2;
    zones.push(['a puzzle front', z.dir[0] ? [Math.min(wx, wx - z.dir[0] * 20), wy - 20, Math.max(wx, wx - z.dir[0] * 20), wy + 20] : [wx - 20, Math.min(wy, wy - z.dir[1] * 20), wx + 20, Math.max(wy, wy - z.dir[1] * 20)]]); }
  for (const [x, y, along, len] of d.creaks) { const a = along ? C.BOARD_ACROSS : len / 2, c = along ? len / 2 : C.BOARD_ACROSS; zones.push(['a loose board (+14 u)', [x - a - 14, y - c - 14, x + a + 14, y + c + 14]]); }
  boxes.forEach((o, j) => {
    for (let y = Math.floor(o.y0 / T); y < Math.ceil(o.y1 / T); y++) for (let x = Math.floor(o.x0 / T); x < Math.ceil(o.x1 / T); x++) {
      if (wall(x, y)) add('a box not inside open tiles'); if (x <= 5 && y <= 5) add('a box at the start'); }
    for (const [what, z] of zones) if (near(o, ...z)) add('a box on ' + what);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!wall(x, y) && !m.islands.has(x + ',' + y) && near(o, x * T + 12, y * T + 12, x * T + 38, y * T + 38)) add("a box on a tile's core");
    for (let k = j + 1; k < boxes.length; k++) { const q = boxes[k]; if (near(o, q.x0 - 26, q.y0 - 26, q.x1 + 26, q.y1 + 26)) add('boxes less than 26 u apart'); }
    const e = slotProblem(o, m, d.rooms); if (e) add(e);
  });
  // nav: the game's cuts are exactly the steps whose band a box crosses, and they leave every open tile but the islands connected
  if (navCut) for (let k = 0; k < W * H; k++) if (navCut[k] !== m.cut[k]) { add("the game's cuts differ from the bands boxes cross"); break; }
  let open = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!wall(x, y) && !m.islands.has(x + ',' + y)) open++;
  for (const [sx, sy] of d.spawns) if (m.tiles(Math.floor(sx / T), Math.floor(sy / T)).size !== open) add('the cut graph does not reach every open tile from a spawn');
  // walking: from every spawn (radius 11) to the exit, notes, puzzles (with a sight line past walls and tall boxes) and wardrobes
  const sight = (ax, ay, bx, by) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 3); for (let k = 1; k < n; k++) { const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
    if (wall(Math.floor(x / T), Math.floor(y / T)) || boxes.some(o => o.tall && x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1)) return false; } return true; };
  const you = walker(m, 11, d.closets);
  for (const [sx, sy] of d.spawns) { const at = you(sx, sy);
    if (!at(...mid(d.exit), 18)) add('the exit out of reach');
    for (const c of d.notes) if (!at(...mid(c), 20)) add('a note out of reach');
    for (const z of d.puzzles) { const wx = (z.cell[0] + 0.5) * T + z.dir[0] * (T / 2 - 12), wy = (z.cell[1] + 0.5) * T + z.dir[1] * (T / 2 - 12);
      if (!at(wx, wy, 36, (x, y) => sight(x, y, wx, wy))) add('a puzzle out of reach'); }
    for (const c of d.closets) if (!at(...mid(c), 28)) add('a wardrobe out of reach'); }
  // her (radius 12, no wardrobes) from where she starts: every cell, every open tile that isn't an island, every wardrobe's stand point
  const her = walker(m, 12, null)(...mid(d.m0));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!wall(x, y) && !m.islands.has(x + ',' + y) && !her(...mid([x, y]), 4)) add(x % 2 && y % 2 ? 'a cell she cannot reach' : 'an open tile she cannot reach');
  for (const [x, y, ox, oy] of d.closets) if (!her(x * T + T / 2 + ox * 16, y * T + T / 2 + oy * 16, 4)) add("a wardrobe's stand point she cannot reach");
  // boards (extras.test.mjs's rules), and never on a servant run or by a box
  const taken = new Set([...d.closets.map(c => c[0] + ',' + c[1]), ...d.puzzles.map(z => z.cell.join()), d.exit.join(), ...d.notes.map(n => n[0] + ',' + n[1])]);
  const onRun = new Set(); for (const [, x0, y0, x1, y1] of d.runs) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) onRun.add(x + ',' + y);
  let lane = 99;
  for (const [x, y, along, len] of d.creaks) { const tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (wall(tx, ty)) add('a board in a wall'); if (taken.has(tx + ',' + ty)) add('a board on a wardrobe, puzzle, note or the exit'); if (tx <= 3 && ty <= 3) add('a board at the start');
    if (onRun.has(tx + ',' + ty)) add('a board on a servant run'); if (boxes.some(o => near(o, ...tileBox(tx, ty, 14)))) add('a board on a tile a box (+14 u) touches');
    if (len > C.BOARD_LEN) { const v = wall(tx - 1, ty) && wall(tx + 1, ty), h = wall(tx, ty - 1) && wall(tx, ty + 1);
      if (v === h || along !== (v ? 0 : 1) || (v ? Math.abs(x - (tx * T + T / 2)) : Math.abs(y - (ty * T + T / 2))) > 0.5) add('a long board not straight across a corridor'); }
    else { const off = along ? x - (tx * T + T / 2) : y - (ty * T + T / 2); let l = 0; for (let a = -(T / 2 - 11); a <= T / 2 - 11; a++) if (Math.abs(a - off) >= C.BOARD_ACROSS) l++; lane = Math.min(lane, l); } }
  if (lane < 14) add('a board with no lane to step past');
  // servant runs: straight, 4+ tiles, away from halls and the start, walls both sides but at most 2 tiles
  for (const [, x0, y0, x1, y1] of d.runs) { const hz = y0 === y1; let j = 0;
    if ((x0 !== x1 && y0 !== y1) || Math.max(x1 - x0, y1 - y0) < 3) add('a servant run not a straight run of 4+');
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (wall(x, y) || (x <= 5 && y <= 5) || d.rooms.some(([, a0, b0, a1, b1]) => x >= a0 - 1 && x <= a1 + 1 && y >= b0 - 1 && y <= b1 + 1)) add('a servant run tile in the wrong place');
      if (d.closets.some(([cx, cy, ox, oy]) => [0, 1, 2].some(k => cx + ox * k === x && cy + oy * k === y)) || d.puzzles.some(z => z.cell[0] === x && z.cell[1] === y) ||
        (x === d.exit[0] && y === d.exit[1]) || (x === d.exit[0] + eo[0] && y === d.exit[1] + eo[1])) add('a servant run through a wardrobe, the exit or a puzzle');
      if (hz ? !(wall(x, y - 1) && wall(x, y + 1)) : !(wall(x - 1, y) && wall(x + 1, y))) j++; }
    if (j > 2) add('a servant run open to the side at more than 2 tiles'); }
  return { bad, maxD, cuts: [...m.cut].reduce((s, v) => s + (v & 1) + (v >> 1), 0), lane };
}

/* ---------- 1. 1,800 houses: completable (the game's check, then this test's proof) ---------- */
console.log('== 1,800 houses (5 floors x 1-4 players x 3 difficulties x 30 seeds), checked by the game and by this test');
const stats = [], failures = [], gameBad = []; let classicN = 0, msAll = 0, nAll = 0;
for (let i = 0; i < 5; i++) {
  const seeds = []; for (let n = 1; n <= 4; n++) for (let di = 0; di < 3; di++) for (let s = 0; s < SEEDS; s++) seeds.push([n, DIFFS[di], seedOf(i, n, di, s)]);
  const r = await p.evaluate(({ i, seeds }) => {
    const out = []; let ms = 0;
    for (const [n, diff, seed] of seeds) {
      const t = performance.now(), d = generateFloor(i, n, diff, seed); ms += performance.now() - t;
      const bad = validateFloor(d); applyLayout(d);                      // (generateFloor leaves the grid as this house's)
      // today's maze from the same seed (the maze before halls, alcoves and furniture), for the longest-way comparison
      const plain = withSeed(d.seed, () => { genMaze(FLOORS[i].cw, FLOORS[i].ch); if (n > 1) for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) grid[y][x] = 0; return grid.map(r => Array.from(r).join('')); });
      delete d.decals; out.push({ d, bad, cut: Array.from(NAV.cut), plain });
    }
    return { out, ms, rejects: LAYOUT_REJECTS.slice() };
  }, { i, seeds });
  msAll += r.ms; nAll += r.out.length;
  if (r.rejects.length) gameBad.push(...r.rejects.map(x => 'F' + (x.i + 1) + ' rejected seed ' + x.s + ': ' + x.bad.join('; ')));
  const st = { floor: 'F' + (i + 1), halls: 0, planned: C.plan[i], islands: 0, boxes: 0, cuts: 0, coverage: 0, runs: 0, maxD: [], maxD1: [], today: [], today1: [], ms: r.ms / r.out.length };
  for (const { d, bad, cut, plain } of r.out) {
    if (d.classic) classicN++;
    if (bad.length) gameBad.push('F' + (i + 1) + ' ' + d.n + 'p ' + d.diff + ' seed ' + d.seed + ': ' + bad.join('; '));
    const pr = prove(d, cut);
    if (pr.bad.length) failures.push('F' + (i + 1) + ' ' + d.n + 'p ' + d.diff + ' seed ' + d.seed + ': ' + pr.bad.join('; '));
    let open = 0, inHall = 0; for (let y = 0; y < d.rows.length; y++) for (let x = 0; x < d.rows[0].length; x++) if (d.rows[y][x] === '0') { open++; if (d.rooms.some(([, x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) inHall++; }
    // today's longest way: plain search over the same seed's maze
    const W = plain[0].length, H = plain.length, seen = new Map([['1,1', 0]]), q = [[1, 1]]; let today = 0;
    for (let k = 0; k < q.length; k++) { const [x, y] = q[k]; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy, key = nx + ',' + ny;
      if (plain[ny][nx] === '0' && !seen.has(key)) { seen.set(key, seen.get(x + ',' + y) + 1); q.push([nx, ny]); if (nx % 2 && ny % 2) today = Math.max(today, seen.get(key)); } } }
    st.halls += d.rooms.length; st.islands += d.solids.filter(s => KIT.items[KIT.solidIds[s[0]]].slot === 'island').length; st.boxes += d.solids.length; st.cuts += pr.cuts; st.runs += d.runs.length;
    st.coverage += inHall / open; st.maxD.push(pr.maxD); st.today.push(today); if (d.n === 1) { st.maxD1.push(pr.maxD); st.today1.push(today); }
  }
  for (const f of ['halls', 'islands', 'boxes', 'cuts', 'coverage', 'runs']) st[f] /= r.out.length;
  stats.push(st);
}
check(gameBad.length === 0, 'validateFloor finds nothing wrong in any of the 1,800 houses, and LAYOUT_REJECTS stays empty', gameBad.slice(0, 5));
check(classicN === 0, 'no house fell back to the plain maze (d.classic)', classicN);
check(failures.length === 0, "this test's own proof agrees: every house completable, every rule kept (invariants, protected zones, nav, boards, servant runs)", failures.slice(0, 5));
console.log('  floor | halls placed/planned | islands | boxes | cut steps | coverage | servant runs | longest way (all; 1 player) | today, same seeds (all; 1 player) | ms per house');
for (const s of stats) console.log(`  ${s.floor}    | ${s.halls.toFixed(2)} / ${s.planned} | ${s.islands.toFixed(1)} | ${s.boxes.toFixed(1)} | ${s.cuts.toFixed(1)} | ${(100 * s.coverage).toFixed(1)}% | ${s.runs.toFixed(2)} | ` +
  `${avg(s.maxD).toFixed(1)}; ${avg(s.maxD1).toFixed(1)} | ${avg(s.today).toFixed(1)}; ${avg(s.today1).toFixed(1)} | ${s.ms.toFixed(2)}`);
check(stats.every(s => s.coverage >= 0.30), 'on every floor at least 30% of the open tiles are in halls (average)', stats.map(s => +s.coverage.toFixed(3)));

console.log('== the hall templates');
// (the build spec's table A4, and KIT's room lists: every piece a template may pick is that kind of piece and lists the template)
const A4 = [[[2, 3], [2, 2], [1, 4], [2, 2], [2, 2], [2, 3], [1, 3]], [[3, 3], [1, 5], [2, 3], [2, 2], [2, 2], [2, 3], [1, 4]], [[3, 3], [2, 3], [1, 5], [2, 2], [2, 2], [2, 3], [2, 3], [1, 4]],
  [[3, 3], [2, 3], [2, 3], [1, 5], [2, 2], [2, 2], [2, 3], [1, 4]], [[3, 3], [3, 3], [2, 3], [1, 5], [2, 2], [2, 2], [2, 3], [2, 3], [1, 4]]];
const tpl = await p.evaluate(() => ({ plan: HALL_PLAN, t: HALL_TEMPLATES }));
check(JSON.stringify(tpl.plan.map(f => f.map(id => tpl.t[id].cells))) === JSON.stringify(A4), 'every floor plans the halls of table A4, in order');
const pickBad = [];
for (const [id, t] of Object.entries(tpl.t)) {
  const picks = [...(t.mode === 'islands' ? t.islands.pick.map(k => [k, 'island']) : []), ...(t.mode === 'columns' ? [[t.column.id, 'pocket']] : []), ...t.slots.flatMap(sl => sl.pick.map(k => [k, sl.type]))];
  for (const [k, slot] of picks) if (!KIT.items[k] || KIT.items[k].slot !== slot || !KIT.items[k].rooms.includes(id)) pickBad.push(id + ': ' + k);
  if (t.kind === 'room' && t.mode === 'islands' && !t.islands.pick.length) pickBad.push(id + ': no islands');
}
for (const [k, it] of Object.entries(KIT.items)) for (const room of it.rooms) { const t = tpl.t[room];
  if (!t || ![...(t.islands.pick || []), ...(t.column ? [t.column.id] : []), ...t.slots.flatMap(sl => sl.pick)].includes(k)) pickBad.push(k + ' lists ' + room + ', which never picks it'); }
check(pickBad.length === 0, "the templates' picks and KIT's room lists agree (each pick the right kind of piece)", pickBad);

console.log('== collision, cuts and sight at run time (js/core.js)');
const rt = await p.evaluate(() => {
  const r = {}, use = d => { grid = d.rows.map(x => Uint8Array.from(x, ch => ch === '1' ? 1 : 0)); GH = grid.length; GW = grid[0].length; applyLayout(d); };
  const d = generateFloor(4, 1, 'medium', 5150); use(d);               // (the workshop: tall, low and see-through islands)
  // (boxes are 26 u apart, so 11.5 u beside one nothing else is within 11)
  r.blocked = SOLIDS.length > 0 && SOLIDS.every(s => { const cy = (s.y0 + s.y1) / 2; return blocked((s.x0 + s.x1) / 2, cy, 11) && solidAt(s.x0 - 10.5, cy, 11) && !solidAt(s.x0 - 11.5, cy, 11) && solidAt(s.x1 + 10.5, cy, 11) && !solidAt(s.x1 + 11.5, cy, 11); });
  r.free = !blocked(T * 1.5, T * 1.5, 11);
  let ok = true; for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) if (!isWall(x, y)) {
    if (!isWall(x + 1, y) && cutAt(x, y, 1, 0) !== !!(NAV.cut[idx(x, y)] & 1) || cutAt(x, y, 1, 0) !== cutAt(x + 1, y, -1, 0)) ok = false;
    if (!isWall(x, y + 1) && cutAt(x, y, 0, 1) !== !!(NAV.cut[idx(x, y)] & 2) || cutAt(x, y, 0, 1) !== cutAt(x, y + 1, 0, -1)) ok = false; }
  r.cutAt = ok;
  const dist = bfsDist(1, 1), plain = bfsDist(1, 1, null), isl = SOLIDS.filter(s => s.isl);
  r.islands = isl.length > 0 && isl.every(s => dist[idx(...s.isl)] === -1 && plain[idx(...s.isl)] > 0);
  // across an island: a tall one hides you, a low one only when you crouch; walls-only los() sees through both
  const across = s => { const y = (s.y0 + s.y1) / 2; return [s.x0 - 12, y, s.x1 + 12, y]; };
  const tall = isl.find(s => s.occ === 'tall'), low = isl.find(s => s.occ === 'low'), none = isl.find(s => s.occ === 'none');
  r.tall = !tall || (los(...across(tall)) && !losSight(...across(tall), false) && !clearLine(...across(tall), 12));
  r.low = !low || (los(...across(low)) && losSight(...across(low), false) && !losSight(...across(low), true));
  r.none = !none || (losSight(...across(none), true) && !clearLine(...across(none), 0));
  r.clear = clearLine(T * 1.5, T * 1.5, T * 1.5, T * 3.5, 12);
  r.kinds = [!!tall, !!low, !!none];
  // ceilings: a hall's own height; under a gable roof, the eave at the walls and the ridge in the middle
  const d4 = generateFloor(3, 1, 'medium', 777); use(d4);
  const g = ROOMS.find(o => o.t.roof === 'gable'), L = T * 0.045, al = g.flags & 1;
  const mx = (g.tx0 + g.tx1 + 1) / 2 * L, mz = (g.ty0 + g.ty1 + 1) / 2 * L;
  r.gable = Math.abs(ceilAtXZ(mx, mz) - g.t.ceil) < 1e-6 && Math.abs(ceilAtXZ(al ? g.tx0 * L + 0.001 : mx, al ? mz : g.ty0 * L + 0.001) - g.t.eave) < 0.01 && ceilAt(g.tx0, g.ty0) >= g.t.eave - 1e-6 && ceilAt(g.tx0, g.ty0) < g.t.ceil;
  const flat = ROOMS.find(o => o.t.roof === 'flat');
  r.flat = Math.abs(ceilAt(flat.tx0, flat.ty0) - flat.t.ceil) < 1e-6 && Math.abs(ceilAt(1, 1) - FLOORS[3].ceil) < 1e-6 && RUNS.every(u => Math.abs(ceilAt(u.tx0, u.ty0) - 2.55) < 1e-6);
  return r;
});
check(rt.blocked && rt.free, 'blocked() stops a body at the furniture, 11 u from its box, and nowhere else', rt);
check(rt.cutAt, 'cutAt() reads NAV.cut, the same from either side of a step');
check(rt.islands, 'bfsDist goes round the furniture: island tiles are out of reach (-1), and in reach without the cuts');
check(rt.tall && rt.low && rt.none && rt.kinds.every(Boolean), 'losSight: a tall box hides you, a low one only when you crouch (los() still sees through both); clearLine stops at boxes', rt);
check(rt.clear, 'clearLine: a free line is clear');
check(rt.gable && rt.flat, 'ceilings: a hall its own height, the floor its own, servant runs 2.55 m; a gable from eave to ridge', rt);

/* ---------- 6. determinism ---------- */
console.log('== the same seed, the same house');
const det = await p.evaluate(() => {
  const fnv = (h, bytes) => { for (let k = 0; k < bytes.length; k++) { h ^= bytes[k]; h = Math.imul(h, 16777619); } return h >>> 0; };
  const txt = s => new TextEncoder().encode(s);
  const hash = d => { grid = d.rows.map(r => Uint8Array.from(r, ch => ch === '1' ? 1 : 0)); GH = grid.length; GW = grid[0].length; applyLayout(d);
    let h = 2166136261; h = fnv(h, NAV.cut); h = fnv(h, txt(JSON.stringify(NAV.bucket))); h = fnv(h, NAV.occ); h = fnv(h, new Uint8Array(CEIL.buffer)); h = fnv(h, txt(JSON.stringify(SOLIDS))); return h; };
  const res = { twice: 0, round: 0, quality: 0, hashes: [] }, q0 = settings.quality;
  for (let k = 0; k < 25; k++) { const i = k % 5, n = 1 + (k % 4), seed = 4242 + k * 977;
    const a = JSON.stringify(generateFloor(i, n, 'medium', seed)), c = JSON.stringify(generateFloor(i, n, 'medium', seed)); if (a === c) res.twice++;
    const d = JSON.parse(a), h1 = hash(d), h2 = hash(JSON.parse(JSON.stringify(d))); if (h1 === h2) res.round++; res.hashes.push(h1);
    settings.quality = 'high'; const e = JSON.stringify(generateFloor(i, n, 'medium', seed)); settings.quality = 'low'; const f = JSON.stringify(generateFloor(i, n, 'medium', seed)); if (e === a && f === a) res.quality++; }
  settings.quality = q0; return res;
});
check(det.twice === 25, 'the same seed twice: identical floor data (25 houses)', det.twice);
check(det.round === 25, 'applyLayout after a JSON round trip: the same hash of NAV.cut, buckets, occ, CEIL and SOLIDS', det.round);
check(det.quality === 25, 'the graphics quality (low or high) never changes the house', det.quality);
// (LOWQ is a constant and the kit isn't part of the game yet: the house builder must never read them, or the quality, at all)
const src = fs.readFileSync(path.join(ROOT, 'js/layout.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'js/floors.js'), 'utf8').split('function applyFloor')[0];
check(!/\bLOWQ\b|settings\.quality|\bKit\.|kitReady/.test(src), 'building a house never reads LOWQ, the quality setting or whether the kit has loaded');
const p2 = await solo(b, 'low', 480, 300);
const det2 = await p2.evaluate(() => {
  const fnv = (h, bytes) => { for (let k = 0; k < bytes.length; k++) { h ^= bytes[k]; h = Math.imul(h, 16777619); } return h >>> 0; };
  const txt = s => new TextEncoder().encode(s), out = [];
  for (let k = 0; k < 25; k++) { const d = generateFloor(k % 5, 1 + (k % 4), 'medium', 4242 + k * 977);
    grid = d.rows.map(r => Uint8Array.from(r, ch => ch === '1' ? 1 : 0)); GH = grid.length; GW = grid[0].length; applyLayout(d);
    let h = 2166136261; h = fnv(h, NAV.cut); h = fnv(h, txt(JSON.stringify(NAV.bucket))); h = fnv(h, NAV.occ); h = fnv(h, new Uint8Array(CEIL.buffer)); h = fnv(h, txt(JSON.stringify(SOLIDS))); out.push(h); }
  return out;
});
check(det2.join() === det.hashes.join(), 'a second page with the same seeds builds the same houses (same hashes)', [det.hashes.slice(0, 3), det2.slice(0, 3)]);
await p2.context().close();

/* ---------- 8. the plain maze (the last fallback) ---------- */
console.log('== the plain maze (LAYOUT_FORCE_CLASSIC), with the original completability checks');
const classic = await p.evaluate(() => {
  LAYOUT_FORCE_CLASSIC = true; const bad = []; let marked = 0, total = 0;
  try {
    for (let i = 0; i < FLOORS.length; i++) for (let n = 1; n <= 4; n++) for (const diff of ['easy', 'medium', 'hard']) for (let s = 0; s < 5; s++) {
      const d = generateFloor(i, n, diff, 9000 + s * 131 + i * 7 + n), rows = d.rows, H = rows.length, W = rows[0].length, wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || rows[y][x] === '1';
      total++; if (d.classic === 1 && !d.solids.length && !d.rooms.length) marked++;
      const tile = ([x, y]) => [Math.floor(x / T), Math.floor(y / T)], start = tile(d.spawns[0]), seen = new Set([start.join()]), q = [start];
      while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of DIRS) { const k = (x + dx) + ',' + (y + dy); if (!wall(x + dx, y + dy) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); } } }
      const tag = `floor ${i + 1}, ${n}p, ${diff}`, reach = c => seen.has(c[0] + ',' + c[1]), closetCells = new Set(d.closets.map(c => c[0] + ',' + c[1]));
      if (!reach(d.exit)) bad.push(tag + ': exit unreachable');
      d.puzzles.forEach(z => { const f = z.cell; if (!reach(f)) bad.push(tag + ': a puzzle is unreachable'); if (closetCells.has(f.join())) bad.push(tag + ': a puzzle in a wardrobe cell');
        if (f.join() === d.exit.join()) bad.push(tag + ': a puzzle on the exit'); if (!wall(f[0] + z.dir[0], f[1] + z.dir[1])) bad.push(tag + ': a puzzle on no wall'); });
      if (d.puzzles.length < 1) bad.push(tag + ': no puzzle');
      d.spawns.slice(0, n).forEach(sp => { const t = tile(sp); if (wall(t[0], t[1]) || !reach(t)) bad.push(tag + ': a spawn in a wall');
        for (const [ox, oy] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) if (wall(Math.floor((sp[0] + ox) / T), Math.floor((sp[1] + oy) / T))) bad.push(tag + ': a spawn touches a wall'); });
      d.closets.forEach(([x, y, ox, oy]) => { if (!reach([x, y])) bad.push(tag + ': a wardrobe unreachable'); if (wall(x + ox, y + oy)) bad.push(tag + ': a wardrobe faces a wall');
        if (DIRS.filter(([dx, dy]) => !wall(x + dx, y + dy)).length !== 1) bad.push(tag + ': a wardrobe not in a dead end'); });
      if (!reach(d.m0)) bad.push(tag + ': she starts somewhere unreachable');
    }
  } finally { LAYOUT_FORCE_CLASSIC = false; }
  return { bad: [...new Set(bad)].slice(0, 10), marked, total, rejects: LAYOUT_REJECTS.length };
});
check(classic.bad.length === 0 && classic.marked === classic.total, `${classic.total} plain-maze houses: all marked classic, every puzzle, the exit, spawns and wardrobes reachable`, classic);
check(classic.rejects === 0, 'and still no rejected house anywhere (LAYOUT_REJECTS empty)', classic.rejects);

/* ---------- 9, 10: speed and the longest way ---------- */
const ms = msAll / nAll;
console.log(`== speed: ${ms.toFixed(2)} ms per house on average, validation included (target 25 ms)`);
check(ms <= 60, `generateFloor (with validateFloor) takes ${ms.toFixed(2)} ms on average (target 25, fails above 60)`, ms);
check(ms <= 25, `and meets the 25 ms target`, ms);
console.log('== the longest way through each floor stays about as long as before the halls');
// (against today's maze grown from the very same seeds, and against the fixed baseline 54/64/68/66/70 measured before)
for (const [i, s] of stats.entries()) {
  const ours = avg(s.maxD), today = avg(s.today), ours1 = avg(s.maxD1);
  check(ours >= 0.9 * today, `F${i + 1}: ${ours.toFixed(1)} tiles on average, today's maze from the same seeds ${today.toFixed(1)} (at least 0.9x)`, +(ours / today).toFixed(3));
  console.log(`  (1 player: ${ours1.toFixed(1)}, the fixed baseline ${BASELINE[i]} x 0.9 = ${(0.9 * BASELINE[i]).toFixed(1)}: ${ours1 >= 0.9 * BASELINE[i] ? 'above' : 'BELOW'})`);
}

console.log('== a house from before layouts (no d.v) still plays');
const old = await p.evaluate(async () => {
  const d = generateFloor(1, 1, 'medium', 2024); ['v', 'kv', 'seed', 'rooms', 'runs', 'solids'].forEach(k => delete d[k]);
  applyFloor(d, 0); const m = bb.monster; m.active = false; m.spawnT = 1e9;
  const r = { solids: SOLIDS.length, rooms: ROOMS.length, runs: RUNS.length, cuts: NAV.cut.some(v => v), ceil: CEIL.every(c => Math.abs(c - FLOORS[1].ceil) < 1e-6), state: bb.state };
  await new Promise(res => { let k = 0; const f = () => (++k >= 20 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  r.built = !!(bb.level && bb.level.grid === bb.grid); toTitle(); return r;
});
check(old.solids === 0 && old.rooms === 0 && old.runs === 0 && !old.cuts && old.ceil && old.state === 'play' && old.built, 'no furniture, halls or cuts, the floor\'s own ceiling, and the floor builds and plays', old);

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary(); await b.close();
