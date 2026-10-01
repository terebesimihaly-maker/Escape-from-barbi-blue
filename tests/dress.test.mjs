// How each floor is dressed (js/dress.js, Dress.plan): doorways, windows, modules, lamps, furniture against the walls, rugs, beams,
// decals. Real floors from the game (5 floors x 1 and 4 players x 3 seeds), each plan checked here by this test's own code: the walls
// from d.rows, the boxes from d.solids and js/kitdefs.js, its own hash, its own doorway and portrait rules. js/dress.js is not in
// index.html yet, so it's added to the page at run time (as is js/lightbake.js, to check the plan feeds the light baker as it is).
import { launch, solo, check, summary, pageErrors } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kitSrc = fs.readFileSync(path.join(ROOT, 'js/kitdefs.js'), 'utf8');
const KIT = JSON.parse(kitSrc.slice(kitSrc.indexOf('/*KITDEFS*/') + 11, kitSrc.indexOf('/*END*/')));
const UM = 0.045, TU = 50, L = TU * UM, DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], SEEDS = +process.env.DRESS_SEEDS || 3, EPS = 1e-6;   // (DRESS_SEEDS=1: a quick run)
const seedOf = (i, n, s) => (i * 7919 + n * 104729 + s * 15485863 + 99991) >>> 0;
// world3d.js's tile hash, and vh with the floor's seed (spec A14)
const hash = (x, y, k) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((k | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vhOf = seed => (x, y, k) => hash(x, y, (Math.imul(k, 2654435761) ^ seed) | 0);
const ARCH = KIT.arch.pieces, BAND = KIT.band, FIX = KIT.fixtures;

const b = await launch();
const p = await solo(b, 'low', 480, 300), p2 = await solo(b, 'low', 480, 300);
for (const q of [p, p2]) if (!await q.evaluate(() => typeof Dress !== 'undefined')) await q.addScriptTag({ url: '/js/dress.js' });   // (until index.html loads it)
if (!await p.evaluate(() => typeof LightBaker !== 'undefined')) await p.addScriptTag({ url: '/js/lightbake.js' });
check(await p.evaluate(() => typeof Dress === 'object' && typeof Dress.plan === 'function' && typeof LightBaker === 'object'), 'js/dress.js and js/lightbake.js load into the game page');
const G = await p.evaluate(() => ({ ids: HALL_TEMPLATE_IDS, t: HALL_TEMPLATES, frames: FLOORS.map(f => f.frames), styles: FLOORS.map(f => f.style) }));

/* ---------- this test's own model of a floor ---------- */
function model(d, CEIL) {
  const rows = d.rows, H = rows.length, W = rows[0].length, wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || rows[y][x] !== '0', at = (x, y) => y * W + x;
  const rooms = d.rooms.map(([tpl, tx0, ty0, tx1, ty1, flags]) => { const id = G.ids[tpl]; return { id, t: G.t[id], tx0, ty0, tx1, ty1, flags }; });
  const runs = d.runs.map(([, tx0, ty0, tx1, ty1]) => ({ tx0, ty0, tx1, ty1 }));
  const hallAt = new Int16Array(W * H).fill(-1), runAt = new Int16Array(W * H).fill(-1);
  rooms.forEach((r, k) => { for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) hallAt[at(x, y)] = k; });
  runs.forEach((r, k) => { for (let y = r.ty0; y <= r.ty1; y++) for (let x = r.tx0; x <= r.tx1; x++) runAt[at(x, y)] = k; });
  const boxes = d.solids.map(([k, x0, y0, x1, y1, rot, v]) => { const id = KIT.solidIds[k], it = Object.assign({}, KIT.items[id], (KIT.items[id].var || [])[v]);
    return { id, x0: x0 / 2 * UM, z0: y0 / 2 * UM, x1: x1 / 2 * UM, z1: y1 / 2 * UM, h: it.h, top: Math.max(it.h, it.top || 0), slot: it.slot }; });
  const boardT = new Set(d.creaks.map(([x, y]) => Math.floor(x / TU) + ',' + Math.floor(y / TU)));
  const noteT = new Set(d.notes.map(([x, y]) => x + ',' + y));
  const keepT = new Set([d.exit.join(','), ...d.closets.map(c => c[0] + ',' + c[1])]);
  const border = (x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1;
  const ceil = (x, y) => CEIL[at(x, y)];
  return { W, H, wall, at, rooms, runs, hallAt, runAt, boxes, boardT, noteT, keepT, border, ceil, vh: vhOf(d.seed >>> 0) };
}
const fpt = (f, u, dd) => [f.x0 + (f.x1 - f.x0) * u + f.nx * dd, f.z0 + (f.z1 - f.z0) * u + f.nz * dd];
// a box within the rect in front of a face (u0..u1 along it, up to dd out)
const boxFront = (M, f, u0, u1, dd, pred) => { const a = fpt(f, u0, 0), c = fpt(f, u1, dd), x0 = Math.min(a[0], c[0]) + 1e-4, x1 = Math.max(a[0], c[0]) - 1e-4,
  z0 = Math.min(a[1], c[1]) + 1e-4, z1 = Math.max(a[1], c[1]) - 1e-4; return M.boxes.some(s => s.x0 < x1 && s.x1 > x0 && s.z0 < z1 && s.z1 > z0 && (!pred || pred(s))); };
// the ceiling at (x, z) m: a gable hall's slope (eave to ridge along its long-axis centreline, A10), else the tile's CEIL
const roofAt = (M, x, z) => { for (const r of M.rooms) { if (r.t.roof !== 'gable' || x < r.tx0 * L - 1e-9 || x > (r.tx1 + 1) * L + 1e-9 || z < r.ty0 * L - 1e-9 || z > (r.ty1 + 1) * L + 1e-9) continue;
  const al = r.flags & 1, c = (al ? r.tx0 + r.tx1 + 1 : r.ty0 + r.ty1 + 1) / 2 * L, hw = (al ? r.tx1 - r.tx0 + 1 : r.ty1 - r.ty0 + 1) / 2 * L;
  return r.t.eave + (r.t.ceil - r.t.eave) * Math.max(0, 1 - Math.abs((al ? x : z) - c) / hw); }
  return M.ceil(Math.min(M.W - 1, Math.floor(x / L)), Math.min(M.H - 1, Math.floor(z / L))); };
// A9.3, read the same way as js/dress.js documents it: walls on both sides, a hall's way in (always) or vh(x, y, 311) <= 0.72 on a
// connector; never in a hall or a servant run
function doorTiles(M) {
  const out = new Map();
  for (let y = 1; y < M.H - 1; y++) for (let x = 1; x < M.W - 1; x++) {
    if (M.wall(x, y) || M.hallAt[M.at(x, y)] >= 0 || M.runAt[M.at(x, y)] >= 0) continue;
    const ns = M.wall(x - 1, y) && M.wall(x + 1, y), ew = M.wall(x, y - 1) && M.wall(x, y + 1); if (ns === ew) continue;
    const per = DIRS.some(([dx, dy]) => M.hallAt[M.at(x + dx, y + dy)] >= 0);
    if (per || ((x + y) % 2 === 1 && M.vh(x, y, 311) <= 0.72)) out.set(x + ',' + y, ns ? 'z' : 'x');
  }
  return out;
}

/* ---------- checks, gathered over every floor ---------- */
const bad = {}, put = (k, v) => { (bad[k] || (bad[k] = [])).push(v); }, logs = [];
const ok = (k, cond, v) => { if (!cond) put(k, v); };
let f5ms = null, bakes = 0;
for (let i = 0; i < 5; i++) for (const n of [1, 4]) for (let s = 0; s < SEEDS; s++) {
  const seed = seedOf(i, n, s), tag = `F${i + 1}/${n}p/s${s}`;
  const R = await p.evaluate(([i, n, seed, bake]) => {
    const d = generateFloor(i, n, 'medium', seed), real = Math.random; let used = 0;
    Math.random = () => { used++; return real(); };              // (the plan may never draw a random number)
    let pl, h2;
    try { pl = Dress.plan(Dress.envFromData(d)); h2 = Dress.hash(Dress.plan(Dress.envFromData(JSON.parse(JSON.stringify(d))))); } finally { Math.random = real; }
    const h1 = Dress.hash(pl), q0 = settings.quality; settings.quality = 'high';
    const hq = Dress.hash(Dress.plan(Dress.envFromData(d))); settings.quality = q0;
    // the live globals (as applyFloor leaves them; no frame runs in between, so no level is built) and level.js's own wall faces
    const st = state; applyFloor(d, 0); const hg = Dress.hash(Dress.plan(Dress.envFromGame())), wf = []; wallGeometry(wf).dispose(); state = st;
    const C = Array.from(CEIL);
    let bk = null;
    if (bake) { const r = LightBaker.bake(Dress.bakeInput(pl, Dress.envFromData(d)), 'lo'); bk = { stats: r.stats, groups: r.groups.length, moonlit: r.moonlit.length }; }
    return { d, json: JSON.stringify(pl, (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v), h1, h2, hq, hg, used, C, wf, bk, decalWords: DECAL_WORDS.length };
  }, [i, n, seed, s === 0]);
  const d = R.d, P = JSON.parse(R.json), M = model(d, R.C), F = P.faces, vh = M.vh;
  const h3 = await p2.evaluate(d => Dress.hash(Dress.plan(Dress.envFromData(d))), d);
  if (d.classic) put('classic', tag);
  // determinism
  ok('same', R.h1 === R.h2, tag); ok('page2', R.h1 === h3, tag); ok('globals', R.h1 === R.hg, tag); ok('quality', R.h1 === R.hq, tag); ok('random', R.used === 0, [tag, R.used]);
  // faces: level.js wallGeometry's records in its order, with the ceiling heights
  ok('faces', R.wf.length === F.length && R.wf.every((w, k) => ['x0', 'z0', 'x1', 'z1'].every(q => Math.abs(w[q] - F[k][q]) < 1e-9) && w.nx === F[k].nx && w.nz === F[k].nz && w.x === F[k].x && w.y === F[k].y),
    [tag, R.wf.length, F.length]);
  F.forEach((f, k) => { const c = M.ceil(f.x, f.y);
    ok('heights', f.hs ? f.h >= c - EPS && Math.abs(f.h - Math.max(...f.hs)) < 1e-3 : Math.abs(f.h - c) < 1e-6, [tag, k, f.h, c]);
    ok('kinds', f.kind === (M.runAt[M.at(f.x, f.y)] >= 0 ? 'service' : f.h > 3 + EPS ? 'upper' : 'main') && (f.variant === 0 || f.variant === 1), [tag, k, f.kind]);
    const bx = f.x - f.nx, by = f.y - f.nz; ok('border', f.border === M.border(bx, by), [tag, k]); });
  // busy faces, recomputed: puzzle faces, every face of the exit cell and of wardrobe cells, doorway tiles, portraits and words
  const doors = doorTiles(M), pz = new Set(d.puzzles.map(q => q.cell[0] + ',' + q.cell[1] + ',' + (-q.dir[0]) + ',' + (-q.dir[1])));
  ok('doorset', doors.size === P.doorways.length && P.doorways.every(w => doors.get(w.x + ',' + w.y) === w.axis), [tag, doors.size, P.doorways.length]);
  const hard = f => { const r = []; if (pz.has(f.x + ',' + f.y + ',' + f.nx + ',' + f.nz)) r.push('puzzle');
    if (f.x === d.exit[0] && f.y === d.exit[1]) r.push('exit'); else if (d.closets.some(c => c[0] === f.x && c[1] === f.y)) r.push('wardrobe');
    if (doors.has(f.x + ',' + f.y)) r.push('door'); return r; };
  // portraits and words: wallDecor's rule (vh(x*7+nx, y*7+nz, 91) < frames x portrait multiplier + 0.045 x word multiplier: a template's
  // decalMul.portrait / .word, and 1.5x portraits in the tile floor's hallways, A9.2), on faces otherwise free, never in a servant run or
  // behind a tall box
  const decor = new Set();
  F.forEach((f, k) => { if (hard(f).length || M.runAt[M.at(f.x, f.y)] >= 0) return; const h = M.hallAt[M.at(f.x, f.y)], t = h >= 0 ? M.rooms[h].t : null;
    const m = (t && t.decalMul) || {}, pm = t ? m.portrait || (t.kind === 'hallway' && G.styles[i] === 'tile' ? 1.5 : 1) : 1, wm = m.word || 1;
    if (vh(f.x * 7 + f.nx, f.y * 7 + f.nz, 91) < G.frames[i] * pm + 0.045 * wm && !boxFront(M, f, 0.3, 0.7, 0.6, s => s.top > 1.35)) decor.add(k); });
  ok('decorset', decor.size === P.decorFaces.length && P.decorFaces.every(q => decor.has(q.face)), [tag, decor.size, P.decorFaces.length]);
  ok('decorcaps', P.decorFaces.filter(q => q.watch).length <= 6 && P.decorFaces.filter(q => q.change).length <= 6, tag);
  F.forEach((f, k) => { const want = hard(f).concat(decor.has(k) ? ['decor'] : []); ok('busyset', want.join() === f.busy.join(), [tag, k, want, f.busy]); });
  const onBusy = (what, k) => ok('busy', k >= 0 && k < F.length && !F[k].busy.length, [tag, what, k, F[k] && F[k].busy]);
  // windows: outer faces, under the ceiling, nothing in front, never two side by side, the moon's side
  const moon = [Math.sin(P.moon.az), Math.cos(P.moon.az)], winF = new Set(P.windows.map(w => w.face));
  for (const w of P.windows) { const f = F[w.face], a = ARCH[w.node]; onBusy('window', w.face);
    ok('winborder', f.border && M.runAt[M.at(f.x, f.y)] < 0, [tag, w.face]);
    ok('winnode', a && a.open && Math.abs(w.v1 - w.v0 - a.open[1]) < 1e-6 && w.u0 >= 0.05 - EPS && w.u1 <= 0.95 + EPS && w.v1 <= Math.min(...(f.hs || [f.h])) - 0.08 + EPS
      && (!/_short$/.test(w.node) || f.h < 2.9), [tag, w.node, w.v1, f.h]);
    ok('winbox', !boxFront(M, f, 0.05, 0.95, 0.8), [tag, w.face]);
    const tx = Math.sign(f.x1 - f.x0), tz = Math.sign(f.z1 - f.z0);
    const nb = [[f.x - tx, f.y - tz], [f.x + tx, f.y + tz]];
    ok('winpair', !F.some((g, k) => winF.has(k) && g.nx === f.nx && g.nz === f.nz && nb.some(([x, y]) => g.x === x && g.y === y)), [tag, w.face]);
    ok('moonlit', w.moonlit === (-f.nx * moon[0] - f.nz * moon[1] >= Math.cos(75 * Math.PI / 180)), [tag, w.face]);
    ok('skip', f.skip && f.mod && f.mod.type === 'window', [tag, w.face]); }
  // modules: on free faces (the exit's on its own face), skipped faces match, fake doors only inside hallways away from the outer wall
  for (const m of P.modules) {
    ok('modnode', !!ARCH[m.node], [tag, m.node]);
    if (m.kind === 'peel') { const f = F[m.face]; onBusy('peel', m.face); ok('peel', m.u0 >= 0.05 - EPS && m.u1 <= 0.95 + EPS && m.depth <= 0.44 && !boxFront(M, f, m.u0, m.u1, 0.1, s => s.top > m.z0)
      && m.z0 + m.h <= f.h && f.run < 0 && (!f.skip || f.mod.type !== 'module' || P.modules[f.mod.i] !== m), [tag, m.face]); continue; }
    if (m.face >= 0) { const f = F[m.face]; ok('skip', f.skip && f.mod && f.mod.type === 'module' && P.modules[f.mod.i] === m, [tag, m.kind]);
      if (m.kind === 'exit') ok('exitmod', f.x === d.exit[0] && f.y === d.exit[1] && f.busy.includes('exit'), tag); else onBusy(m.kind, m.face);
      if (m.kind === 'door_closed') { const h = M.hallAt[M.at(f.x, f.y)]; ok('doorclosed', !f.border && h >= 0 && M.rooms[h].t.kind === 'hallway' && f.side === 'side', [tag, m.face]); }
      if (m.kind === 'fireplace') ok('fireplace', !f.border && !boxFront(M, f, 0.1, 0.9, 1.1), [tag, m.face]);
      if (m.kind === 'wallhole' || m.kind === 'niche') ok('holebox', !boxFront(M, f, 0.25, 0.75, 0.5), [tag, m.face]); }
    else { ok('ceilmod', !M.wall(m.x, m.y) && (m.kind !== 'ceilhole' || M.ceil(m.x, m.y) - 0.3 >= 2.4 - EPS), [tag, m.kind, m.x, m.y]);
      // never cut over a box that rises into it (a flue, a chimney breast, a column); a rose never over one reaching its underside
      const a = ARCH[m.node], rose = m.kind === 'ceilingrose', hw = rose ? a.W / 2 : m.kind === 'ladder' ? Math.max(a.W, a.D) / 2 : L / 2, hd = rose ? a.D / 2 : hw;
      const cx = rose || m.kind === 'ladder' ? m.pos[0] : (m.x + 0.5) * L, cz = rose || m.kind === 'ladder' ? m.pos[2] : (m.y + 0.5) * L, lim = rose ? m.pos[1] - a.H - 0.02 : M.ceil(m.x, m.y) - 0.35;
      const hit = M.boxes.find(s => s.x0 < cx + hd && s.x1 > cx - hw && s.z0 < cz + hd && s.z1 > cz - hd && s.top > lim);
      ok('ceilmodbox', !hit, [tag, m.kind, m.x, m.y, hit && hit.id, hit && hit.top]);
      if (m.kind === 'skylight') { const g = M.rooms.find(r => r.t.roof === 'gable' && m.x >= r.tx0 && m.x <= r.tx1 && m.y >= r.ty0 && m.y <= r.ty1);
        if (!g) ok('skyslope', m.slope === 0 && m.normal[1] === -1, [tag, m.x, m.y]);
        else { const al = g.flags & 1, rc = al ? g.tx0 + g.tx1 + 1 : g.ty0 + g.ty1 + 1, a2 = 2 * (al ? m.x : m.y) + 1, n = m.normal, side = a2 < rc ? 1 : -1;
          ok('skyridge', a2 !== rc, [tag, m.x, m.y]);
          const s = (g.t.ceil - g.t.eave) / ((al ? g.tx1 - g.tx0 + 1 : g.ty1 - g.ty0 + 1) / 2 * L);
          ok('skyslope', Math.abs(m.slope - Math.atan(s)) < 1e-3 && Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-3 && n[1] < 0 && (al ? n[0] * side > 0 && n[2] === 0 : n[2] * side > 0 && n[0] === 0)
            && Math.abs(m.pos[1] - roofAt(M, (m.x + 0.5) * L, (m.y + 0.5) * L)) < 1e-3, [tag, m.x, m.y, m.slope, n]); } } }
  }
  F.forEach((f, k) => { if (f.skip) ok('skip2', f.mod && (f.mod.type === 'window' ? P.windows[f.mod.i].face === k : P.modules[f.mod.i].face === k), [tag, k]); });
  const holes = P.modules.filter(m => m.kind === 'wallhole').length; ok('holes', holes >= 2 && holes <= 6, [tag, holes]);
  // doorways: leaves rest 72..88 deg open (90 when a board pins them), tips <= 0.42 m from their wall; a long board: no leaves
  for (const w of P.doorways) {
    const bs = d.creaks.filter(([x, y]) => Math.floor(x / TU) === w.x && Math.floor(y / TU) === w.y), long = bs.some(q => q[3] > 24 || (w.axis === 'z' ? q[2] !== 1 : q[2] !== 0));
    ok('leaves', long ? w.leaves.length === 0 : w.leaves.length === 2, [tag, w.x, w.y]);
    for (const lf of w.leaves) { const tip = 0.11 + Math.cos(lf.rest * Math.PI / 180);
      const pinned = !long && bs.some(q => Math.sign(w.axis === 'z' ? q[0] - (w.x * TU + TU / 2) : q[1] - (w.y * TU + TU / 2)) === lf.side);
      ok('leafrest', pinned ? lf.pin && lf.rest === 90 : !lf.pin && lf.rest >= 72 - EPS && lf.rest <= 88 + EPS, [tag, w.x, w.y, lf]);
      ok('leaftip', tip <= 0.42 + EPS && Math.abs(lf.tip - tip) < 1e-3, [tag, w.x, w.y, tip]);
      const wallP = w.axis === 'z' ? (lf.side < 0 ? w.x * L : (w.x + 1) * L) : (lf.side < 0 ? w.y * L : (w.y + 1) * L);
      ok('hinge', Math.abs(Math.abs((w.axis === 'z' ? lf.hinge[0] : lf.hinge[1]) - wallP) - 0.11) < 1e-3, [tag, w.x, w.y]); }
    ok('doornode', !!ARCH[w.frame] && !!ARCH[w.leaf], [tag, w.frame]);
  }
  // furniture against the walls: within 0.44 m of its wall and u 0.05..0.95 (corner pieces aside), on free faces, not overlapping
  for (const e of P.band) {
    const f = F[e.face];
    ok('banddepth', e.depth <= 0.44 + EPS && e.depth > 0, [tag, e.id, e.depth]);
    if (e.mount === 'corner') { const tx = Math.sign(f.x1 - f.x0), tz = Math.sign(f.z1 - f.z0); ok('corner', M.wall(e.end ? f.x + tx : f.x - tx, e.end ? f.y + tz : f.y - tz) && e.z0 >= 2.2 - EPS
      && e.z0 + e.h <= (f.hs ? f.hs[e.end ? 4 : 0] : f.h) + 1e-3, [tag, e.face]); }
    else ok('bandu', e.u0 >= 0.05 - EPS && e.u1 <= 0.95 + EPS && Math.abs(e.u1 - e.u0 - (BAND[e.id] || ARCH[e.id]).W / L) < 1e-3, [tag, e.id, e.u0, e.u1]);
    if (e.mount === 'under_window') ok('underwin', winF.has(e.face) && e.z0 + e.h < P.windows.find(w => w.face === e.face).v0, [tag, e.face]);
    else onBusy('band ' + e.id, e.face);
    ok('bandnode', !!(BAND[e.id] || ARCH[e.id]), [tag, e.id]);
    ok('bandtop', e.z0 + e.h <= Math.min(...(f.hs || [f.h])) + EPS || e.mount === 'corner', [tag, e.id]);
    if (M.runAt[M.at(f.x, f.y)] >= 0) ok('runband', f.inset === 0 || e.depth - e.inset <= 0.14 + EPS, [tag, e.id]);
  }
  // nothing standing on the floor reaches over a loose board (13 u wide, its length along or across its tile)
  const boardRects = d.creaks.map(([x, y, along, len]) => { const hx = (along ? 6.5 : len / 2) * UM, hz = (along ? len / 2 : 6.5) * UM; return [x * UM - hx, y * UM - hz, x * UM + hx, y * UM + hz]; });
  const overBoard = (f, u0, u1, dd) => { const a = fpt(f, u0, 0), c = fpt(f, u1, dd), x0 = Math.min(a[0], c[0]) + 1e-3, x1 = Math.max(a[0], c[0]) - 1e-3,
    z0 = Math.min(a[1], c[1]) + 1e-3, z1 = Math.max(a[1], c[1]) - 1e-3; return boardRects.some(r => r[0] < x1 && r[2] > x0 && r[1] < z1 && r[3] > z0); };
  for (const e of P.band) if (e.mount !== 'corner' && e.z0 < 0.5) ok('bandboard', !overBoard(F[e.face], e.u0, e.u1, e.depth), [tag, e.id, e.face]);
  for (const q of P.dolls) if (q.y < 0.5) { const du = 0.18 / L; ok('bandboard', !overBoard(F[q.face], q.u - du, q.u + du, 0.3), [tag, 'doll', q.face]); }
  P.band.forEach((e, k) => P.band.forEach((o, j) => { if (j <= k || o.face !== e.face || e.mount === 'corner' || o.mount === 'corner') return;
    const uo = e.u0 < o.u1 - 1e-6 && e.u1 > o.u0 + 1e-6, yo = e.z0 < o.z0 + o.h - 1e-6 && e.z0 + e.h > o.z0 + 1e-6; ok('bandoverlap', !(uo && yo), [tag, e.id, o.id]); }));
  // ... nor do pieces on two walls of one tile meet in its inside corner: furniture, floor dolls, cobweb cards (their 0.44 m square in
  // the corner), a servant run's 0.30 m side insets and a fireplace's breast (the kit's whole-face envelope, D deep), as boxes on the floor
  // plan with their heights
  { const rectOf = (f, u0, u1, d0, d1) => { const a = fpt(f, u0, d0), c = fpt(f, u1, d1); return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])]; };
    const it = P.band.map(e => { const f = F[e.face], w = e.depth / L;
      return { id: e.id, face: e.face, t: f.x + ',' + f.y, y0: e.z0, y1: e.z0 + e.h, r: e.mount === 'corner' ? rectOf(f, e.end ? 1 - w : 0, e.end ? 1 : w, 0, e.depth) : rectOf(f, e.u0, e.u1, e.inset || 0, e.depth) }; });
    for (const q of P.dolls) if (q.y < 0.5) { const f = F[q.face], du = 0.18 / L; it.push({ id: 'doll', face: q.face, t: f.x + ',' + f.y, y0: 0, y1: 0.5, r: rectOf(f, q.u - du, q.u + du, 0, 0.3) }); }
    F.forEach((f, k) => { if (f.inset) it.push({ id: 'inset', face: k, t: f.x + ',' + f.y, y0: 0, y1: 9, r: rectOf(f, 0, 1, 0, f.inset), inset: true }); });
    for (const m of P.modules) if (m.kind === 'fireplace') { const f = F[m.face]; it.push({ id: 'fireplace', face: m.face, t: f.x + ',' + f.y, y0: 0, y1: 9, r: rectOf(f, 0, 1, 0, ARCH[m.node].D), inset: true }); }
    const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    for (let a = 0; a < it.length; a++) for (let c = a + 1; c < it.length; c++) { const A = it[a], B = it[c];
      if (A.face === B.face || A.t !== B.t || (A.inset && B.inset)) continue;
      const o = Math.min(ov(A.r[0], A.r[2], B.r[0], B.r[2]), ov(A.r[1], A.r[3], B.r[1], B.r[3]));
      ok('bandcorner', !(o > 0.005 && ov(A.y0, A.y1, B.y0, B.y1) > 0.005), [tag, A.id, B.id, +o.toFixed(3)]); } }
  // dolls: the nursery always has some; at most 10; against a wall
  ok('dolls', P.dolls.length <= 10 && (i !== 0 || P.dolls.length >= 1), [tag, P.dolls.length]);
  for (const q of P.dolls) { const f = F[q.face], dd = (q.x - f.x0) * f.nx + (q.z - f.z0) * f.nz; ok('dollspot', dd >= 0 && dd <= 0.44 && q.y <= 1.5, [tag, q]); onBusy('doll', q.face); }
  // lamps: on open tiles, below the ceiling, hanging ones clear of heads, flicker groups (<= 16, >= 14 m apart)
  const st = { ok: 0, flicker: 0, dead: 0, glow: 0 };
  for (const fx of P.fixtures) {
    st[fx.state] = (st[fx.state] || 0) + 1;
    ok('fixnode', FIX[fx.id] && fx.node === FIX[fx.id].node && fx.emitNode === FIX[fx.id].emit, [tag, fx.id]);
    ok('fixshape', ['x', 'y', 'z', 'nx', 'nz', 'k'].every(q => Number.isFinite(fx[q])) && fx.color.length === 3 && ['ok', 'flicker', 'dead', 'glow'].includes(fx.state) && fx.profile === fx.id, [tag, fx.id]);
    const tx = Math.floor(fx.x / L), ty = Math.floor(fx.z / L);
    ok('fixopen', !M.wall(tx, ty) && fx.y > 0 && fx.y < M.ceil(tx, ty) + 2, [tag, fx.id, fx.x, fx.z]);
    if (fx.face >= 0) onBusy('lamp ' + fx.id, fx.face);
    if (FIX[fx.id].mount === 'ceiling') { const over = M.boxes.some(s => s.x0 < fx.x + 0.25 && s.x1 > fx.x - 0.25 && s.z0 < fx.z + 0.25 && s.z1 > fx.z - 0.25);
      ok('fixclear', fx.bottom >= (over ? 1.95 : 2.3) - EPS && (fx.id !== 'chandelier' || fx.bottom >= 2.8 - EPS) && fx.cord >= -EPS, [tag, fx.id, fx.bottom]);
      // never inside a box that rises past its bottom (a boiler's or kiln's flue, a column, a chimney breast)
      const w = FIX[fx.id].W / 2, dd = FIX[fx.id].D / 2, hx = fx.ry && Math.abs(Math.sin(fx.ry)) > 0.5 ? dd : w, hz = hx === w ? dd : w;
      const inBox = M.boxes.find(s => s.x0 < fx.x + hx && s.x1 > fx.x - hx && s.z0 < fx.z + hz && s.z1 > fx.z - hz && s.top > fx.bottom);
      ok('fixbox', !inBox, [tag, fx.id, fx.src, inBox && inBox.id, inBox && inBox.top, fx.bottom]); }
    ok('groups', fx.state === 'flicker' ? fx.group >= 0 && fx.group < 16 : fx.group === -1, [tag, fx.id, fx.state, fx.group]);
  }
  const fl = P.fixtures.filter(fx => fx.state === 'flicker');
  ok('flicker16', fl.length <= 16 && new Set(fl.map(fx => fx.group)).size === fl.length, [tag, fl.length]);
  fl.forEach((a, k) => fl.forEach((c, j) => { if (j > k) ok('flicker14', Math.hypot(a.x - c.x, a.z - c.z) >= 14, [tag, a.id, c.id, Math.hypot(a.x - c.x, a.z - c.z)]); }));
  // every hall whose template hangs a ceiling light gets at least one (a 2.7 m coal store too: bulb drop min(0.63, H - 2.35), A10)
  M.rooms.forEach((r, k) => { if (r.t.kind === 'room' && r.t.lights && r.t.lights.hang) ok('halllit', P.fixtures.some(fx => fx.src === 'hall' && fx.hall === k && fx.id === r.t.lights.hang), [tag, r.id]); });
  const lamps = P.fixtures.filter(fx => fx.src !== 'practical' && fx.src !== 'fireplace' && fx.src !== 'band');
  ok('fixcount', P.fixtures.length >= 8 && lamps.filter(fx => fx.state === 'dead').length <= 0.4 * lamps.length && lamps.filter(fx => fx.state === 'dead').length >= 1, [tag, P.fixtures.length, st]);
  // beams: clear of heads (A10), under the ceiling, never over a doorway (joists, collar ties)
  const gable = (x, y) => M.rooms.some(r => r.t.roof === 'gable' && x >= r.tx0 && x <= r.tx1 && y >= r.ty0 && y <= r.ty1);
  for (const q of P.beams) {
    const min = { joist: 2.45, collar: 2.45, tie: G.styles[i] === 'workshop' ? 3.05 : 2.6, beam: 3.05, ibeam: 3.05, post: 2.6 }[q.kind];
    ok('beamclear', q.y0 >= 2.3 - EPS && q.y0 >= min - EPS && q.y1 > q.y0 && (q.kind !== 'collar' || Math.abs(q.y0 - 2.45) < 1e-6), [tag, q.kind, q.y0]);
    const len = Math.hypot(q.x1 - q.x0, q.z1 - q.z0), steps = Math.max(1, Math.ceil(len / 0.1));
    for (let k = 0; k <= steps; k++) { const x = q.x0 + (q.x1 - q.x0) * k / steps, z = q.z0 + (q.z1 - q.z0) * k / steps;
      const tx = Math.min(M.W - 1, Math.floor(x / L - (k === steps && q.x1 > q.x0 ? 1e-9 : 0))), ty = Math.min(M.H - 1, Math.floor(z / L - (k === steps && q.z1 > q.z0 ? 1e-9 : 0)));
      if (q.kind === 'tie' && gable(tx, ty) && k > 0 && k < steps) ok('tieroof', q.y1 <= roofAt(M, x, z) + 1e-3, [tag, +x.toFixed(2), +z.toFixed(2), q.y1, +roofAt(M, x, z).toFixed(3)]);
      if (q.kind === 'post' || q.kind === 'tie' || gable(tx, ty)) continue;
      ok('beamceil', q.y1 <= M.ceil(tx, ty) + EPS, [tag, q.kind, q.y1, M.ceil(tx, ty)]);
      if (q.kind === 'joist' || q.kind === 'collar') ok('beamdoor', !doors.has(tx + ',' + ty), [tag, q.kind, tx, ty]); }
  }
  // rugs: never on a loose board's tile, a wardrobe or the exit; on open floor
  for (const r of P.rugs) { const hx = r.rot ? r.l / 2 : r.w / 2, hz = r.rot ? r.w / 2 : r.l / 2;
    for (let y = Math.floor((r.z - hz + 0.01) / L); y <= Math.floor((r.z + hz - 0.01) / L); y++) for (let x = Math.floor((r.x - hx + 0.01) / L); x <= Math.floor((r.x + hx - 0.01) / L); x++)
      ok('rugs', !M.wall(x, y) && !M.boardT.has(x + ',' + y) && !M.keepT.has(x + ',' + y), [tag, r.type, x, y]); }
  // decals: at most 2 a face, on free faces, 0.5 m clear of puzzle boxes, portraits and words
  const keepOut = d.puzzles.map(q => { const k = F.findIndex(f => f.x === q.cell[0] && f.y === q.cell[1] && f.nx === -q.dir[0] && f.nz === -q.dir[1]), c = fpt(F[k], 0.5, 0); return [c[0], 1.25, c[1], 0.32]; })
    .concat(P.decorFaces.map(q => { const c = fpt(F[q.face], 0.5, 0); return [c[0], q.y, c[1], Math.max(q.w, q.h) / 2]; }));
  const per = new Map();
  for (const e of P.decalSources.wall) { per.set(e.face, (per.get(e.face) || 0) + 1); onBusy('decal', e.face); ok('decalskip', !F[e.face].skip || e.proud > 0, [tag, e.kind]);
    const c = fpt(F[e.face], e.u, 0); ok('decal05', keepOut.every(k => Math.hypot(k[0] - c[0], k[1] - e.v, k[2] - c[1]) >= 0.5 + e.size / 2 + k[3] - 1e-6), [tag, e.kind, e.face]);
    ok('decaluv', e.u >= 0 && e.u <= 1 && e.v >= 0 && e.v <= F[e.face].h + EPS, [tag, e.kind, e.u, e.v]); }
  ok('decal2', [...per.values()].every(c => c <= 2), tag);
  // wet: never on a note's tile
  for (const w of P.wet) { const r = Math.max(w.rx, w.rz);
    for (let y = Math.floor((w.z - r) / L); y <= Math.floor((w.z + r) / L); y++) for (let x = Math.floor((w.x - r) / L); x <= Math.floor((w.x + r) / L); x++) ok('wetnote', !M.noteT.has(x + ',' + y), [tag, w.kind]); }
  // the light baker takes the plan as it is: every lamp baked, no group refused
  if (R.bk) { bakes++; const S = R.bk.stats;
    ok('bake', S.skipped === 0 && S.demoted === 0 && S.badGroup === 0 && R.bk.groups === fl.length, [tag, S.skipped, S.demoted, S.badGroup, R.bk.groups, fl.length, (S.warnings || []).slice(0, 3)]); }
  logs.push(`${tag}: faces ${F.length}, doorways ${P.doorways.length}, decor ${P.decorFaces.length}, windows ${P.windows.length}, modules ${JSON.stringify(P.stats.modules)}, ` +
    `lamps ${P.fixtures.length} ${JSON.stringify(st)} groups ${fl.length}, band ${P.band.length}, dolls ${P.dolls.length}, rugs ${P.rugs.length}, beams ${P.beams.length}, ` +
    `decals ${P.decalSources.wall.length}/${P.decalSources.floor.length}/${P.decalSources.ceiling.length}, wet ${P.wet.length}, ${P.stats.ms} ms`);
}
// how long a plan takes: the 4-player Workshop, best and median of 9
{ const r = await p.evaluate(seed => { const env = Dress.envFromData(generateFloor(4, 4, 'medium', seed)), t = [];
    for (let k = 0; k < 9; k++) { const a = performance.now(); Dress.plan(env); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); return { best: t[0], median: t[4] }; }, seedOf(4, 4, 0));
  f5ms = r; }

for (const l of logs) console.log('  ' + l);
const show = k => (bad[k] || []).slice(0, 4);
const none = k => !(bad[k] || []).length, N = 5 * 2 * SEEDS;
check(none('classic'), `every floor built with halls (no classic fallback) [${N} floors]`, show('classic'));
check(none('same') && none('page2'), 'the same d gives the identical plan (twice, and on a second page)', show('same').concat(show('page2')));
check(none('globals'), 'the live globals (envFromGame after applyFloor) give the same plan as d alone', show('globals'));
check(none('quality') && none('random'), 'no Math.random and no quality setting in the plan', show('quality').concat(show('random')));
check(none('faces'), 'faces are level.js wallGeometry records, in its order', show('faces'));
check(none('heights') && none('kinds') && none('border'), 'face heights from CEIL / gables, kinds and outer-wall flags right', show('heights').concat(show('kinds'), show('border')));
check(none('doorset'), 'doorway tiles follow A9.3 (hall ways in always, vh(311) <= 0.72, not in halls or servant runs)', show('doorset'));
check(none('decorset') && none('decorcaps'), "portraits and words follow wallDecor's rule with vh (and its caps)", show('decorset'));
check(none('busyset'), 'busy faces: puzzle, exit cell, wardrobe cells, doorway tiles, portraits and words', show('busyset'));
check(none('busy') && none('exitmod'), 'no window, module, lamp, furniture, doll or decal on a busy face (the exit porch on its own face)', show('busy').concat(show('exitmod')));
check(none('winborder') && none('winnode') && none('winbox') && none('winpair') && none('moonlit'),
  'windows: outer faces only, fit under the ceiling (_short below 2.9 m), nothing in front, never two side by side, moonlit by azimuth',
  show('winborder').concat(show('winnode'), show('winbox'), show('winpair'), show('moonlit')));
check(none('modnode') && none('doorclosed') && none('fireplace') && none('holebox') && none('ceilmod') && none('holes') && none('peel'),
  'modules: KIT nodes, fake doors on hallway side faces off the outer wall, nothing in front of fireplaces and holes, 2-6 wall holes, ceiling holes >= 2.40, peeling strips in the band',
  show('modnode').concat(show('doorclosed'), show('fireplace'), show('holebox'), show('ceilmod'), show('holes'), show('peel')));
check(none('ceilmodbox'), 'skylights, ceiling holes, the loft ladder and roses never over a box rising into them (flues, chimney breasts, columns)', show('ceilmodbox'));
check(none('skyridge') && none('skyslope'), "skylights never on a gable's ridge tile; gable ones carry the slope and the ceiling normal", show('skyridge').concat(show('skyslope')));
check(none('skip') && none('skip2'), 'skipped faces are exactly the window and module faces', show('skip').concat(show('skip2')));
check(none('leaves') && none('leafrest') && none('leaftip') && none('hinge') && none('doornode'),
  'doorway leaves: rest 72-88 deg, tips <= 0.42 m from the side wall, pinned at 90 by a side board, none over a long board, hinged 0.11 m off the wall',
  show('leaves').concat(show('leafrest'), show('leaftip'), show('hinge')));
check(none('banddepth') && none('bandu') && none('corner') && none('underwin') && none('bandnode') && none('bandtop') && none('runband'),
  'furniture against the walls: depth <= 0.44 m, u within 0.05..0.95 (corner cobwebs at inside corners), radiators under windows, under the ceiling',
  show('banddepth').concat(show('bandu'), show('corner'), show('underwin'), show('bandtop'), show('runband')));
check(none('bandoverlap'), 'furniture pieces on one face never overlap', show('bandoverlap'));
check(none('bandboard'), 'no furniture or floor doll reaches over a loose board', show('bandboard'));
check(none('bandcorner'), "pieces on two walls of a tile never meet in its corner (furniture, floor dolls, cobweb cards, servant-run insets, fireplace breasts)", show('bandcorner'));
check(none('dolls') && none('dollspot'), 'doll spots: some in the nursery, at most 10 a floor, against a wall', show('dolls').concat(show('dollspot')));
check(none('fixnode') && none('fixshape') && none('fixopen') && none('fixcount'), 'lamps: KIT nodes, LightBaker shape, on open tiles, plausible counts and dead share',
  show('fixnode').concat(show('fixshape'), show('fixopen'), show('fixcount')));
check(none('fixclear'), 'hanging lamps clear of heads (bottom >= 2.30, 1.95 over a box, chandeliers 2.80)', show('fixclear'));
check(none('fixbox'), 'no hanging lamp inside a box that rises past its bottom (flues, columns)', show('fixbox'));
check(none('halllit'), 'every hall whose template hangs a ceiling light gets one (2.7 m coal stores included)', show('halllit'));
check(none('groups') && none('flicker16') && none('flicker14'), '<= 16 flicker groups, one lamp each, >= 14 m apart; steady lamps have no group', show('groups').concat(show('flicker16'), show('flicker14')));
check(none('beamclear') && none('beamceil') && none('beamdoor') && none('tieroof'),
  'beams: bottoms >= 2.30 (joists 2.45, collar ties 2.45, attic ties 2.60, workshop >= 3.05), under the ceiling (attic ties under the roof slope), never through a doorway',
  show('beamclear').concat(show('beamceil'), show('beamdoor'), show('tieroof')));
check(none('rugs'), 'rugs never on a loose board, a wardrobe or the exit', show('rugs'));
check(none('decalskip') && none('decal05') && none('decaluv') && none('decal2'), 'wall decals: <= 2 a face, on free faces, 0.5 m clear of puzzle boxes, portraits and words',
  show('decalskip').concat(show('decal05'), show('decaluv'), show('decal2')));
check(none('wetnote'), 'wet patches never on a note', show('wetnote'));
check(bakes === 10 && none('bake'), `LightBaker.bake takes the plan as it is (${bakes} floors at lo: no lamp skipped, demoted or refused)`, show('bake'));
console.log(`  Dress.plan on the 4-player Workshop: best ${f5ms.best.toFixed(1)} ms, median ${f5ms.median.toFixed(1)} ms (target < 30 ms)`);
check(f5ms.best < 30, 'plan() on F5 with 4 players runs in under 30 ms (best of 9)', f5ms);
check(!pageErrors.length, 'no page errors', pageErrors.slice(0, 3));
await b.close();
process.exit(summary());
