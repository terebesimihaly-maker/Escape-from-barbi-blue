// Walking the house with the real game code, much faster than real time and without drawing anything (each house runs in one go):
//   you   - the real updatePlayer, steered along the test's own route (A* on its own 5-unit grid of where a body of radius 11 fits),
//           reach every puzzle, note, wardrobe and the door, on every floor and difficulty, and never end a step inside furniture
//   she   - the real stepAlongPath gets to every room, every wardrobe's doors and a fake-leave spot, after bursts of running straight
//           at something, in time, never inside furniture, never stuck
//   and furniture between you and her (she goes round it), hiding behind tall and low furniture, and the start room together.
import { launch, solo, check, summary, pageErrors } from './lib.mjs';
const b = await launch();
const p = await solo(b, 'low', 480, 300);
const DIFFS = ['easy', 'medium', 'hard'];
const seedOf = (i, n, k) => (0x5eed + i * 1009 + n * 97 + k * 7919) >>> 0;      // (fixed seeds: the same houses every run)

// the walkers, in the page (they use the game's own globals; nothing in the game is changed)
await p.evaluate(() => {
  state = 'walk';                         // (between the runs nothing updates or draws: each run below is synchronous)
  const W = window.WT = {};
  const decode = d => d.solids.map(([k, x0, y0, x1, y1]) => ({ x0: x0 / 2, y0: y0 / 2, x1: x1 / 2, y1: y1 / 2 }));
  // where a body of radius r can stand, on a lattice 5 units apart: not touching a wall tile, a box, or a wardrobe (as closetBlocked)
  W.raster = (d, r) => {
    const NX = GW * 10, NY = GH * 10, B = new Uint8Array(NX * NY), wall = (x, y) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return tx < 0 || ty < 0 || tx >= GW || ty >= GH || d.rows[ty][tx] !== '0'; };
    for (let b = 0; b < NY; b++) for (let a = 0; a < NX; a++) { const x = a * 5, y = b * 5;
      if (wall(x - r, y - r) || wall(x + r, y - r) || wall(x - r, y + r) || wall(x + r, y + r)) B[b * NX + a] = 1; }
    for (const s of decode(d)) for (let b = Math.max(0, Math.floor((s.y0 - r) / 5)); b <= Math.min(NY - 1, Math.ceil((s.y1 + r) / 5)); b++)
      for (let a = Math.max(0, Math.floor((s.x0 - r) / 5)); a <= Math.min(NX - 1, Math.ceil((s.x1 + r) / 5)); a++)
        if (a * 5 + r > s.x0 && a * 5 - r < s.x1 && b * 5 + r > s.y0 && b * 5 - r < s.y1) B[b * NX + a] = 1;
    const CF = T / 2 - 0.6 / S;
    for (const [tx, ty, ox, oy] of d.closets) { const cx = tx * T + T / 2, cy = ty * T + T / 2;
      for (let b = Math.floor((cy - T) / 5); b <= Math.ceil((cy + T) / 5); b++) for (let a = Math.floor((cx - T) / 5); a <= Math.ceil((cx + T) / 5); a++) {
        const dx = a * 5 - cx, dy = b * 5 - cy, al = dx * ox + dy * oy, sd = Math.abs(dx * oy - dy * ox);
        if (a >= 0 && b >= 0 && a < NX && b < NY && sd < T / 2 && al > -T && al - r < -CF) B[b * NX + a] = 1; } }
    return { B, NX, NY };
  };
  // A* over the lattice (8 ways; a diagonal only where both straight neighbours are free, so the whole step is free) from (x, y) to the
  // first point that passes goal(x, y); h: a lower bound of the distance left. Returns the points, or null.
  W.route = (R, x, y, goal, h) => {
    const { B, NX, NY } = R, n = NX * NY, g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), shut = new Uint8Array(n);
    let s = -1, bd = 1e9;                                   // (start: the free lattice point nearest to you)
    for (let b = Math.round(y / 5) - 2; b <= Math.round(y / 5) + 2; b++) for (let a = Math.round(x / 5) - 2; a <= Math.round(x / 5) + 2; a++)
      if (a >= 0 && b >= 0 && a < NX && b < NY && !B[b * NX + a] && Math.hypot(a * 5 - x, b * 5 - y) < bd) { bd = Math.hypot(a * 5 - x, b * 5 - y); s = b * NX + a; }
    if (s < 0) return null;
    const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
    g[s] = 0; push(s, h((s % NX) * 5, Math.floor(s / NX) * 5));
    while (heap.length) {
      const [, k] = pop(); if (shut[k]) continue; shut[k] = 1;
      const a = k % NX, b = (k - a) / NX;
      if (goal(a * 5, b * 5)) { const pts = []; for (let c = k; c >= 0; c = from[c]) pts.push({ x: (c % NX) * 5, y: Math.floor(c / NX) * 5 }); return pts.reverse(); }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue;
        const na = a + dx, nb = b + dy; if (na < 0 || nb < 0 || na >= NX || nb >= NY) continue;
        const q = nb * NX + na; if (B[q] || shut[q] || (dx && dy && (B[b * NX + na] || B[nb * NX + a]))) continue;
        const ng = g[k] + (dx && dy ? 7.0711 : 5); if (ng < g[q]) { g[q] = ng; from[q] = k; push(q, ng + h(na * 5, nb * 5)); } }
    }
    return null;
  };
  const len = pts => pts.reduce((s, q, i) => s + (i ? Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0), 0);
  // you, from the start to every puzzle, note and wardrobe, then out of the door: the real updatePlayer at 60 steps a second
  W.walkHouse = (i, n, diff, seed) => withSeed(seed ^ 0x2545F491, () => {
    const rej = LAYOUT_REJECTS.length, d = generateFloor(i, n, diff, seed); applyFloor(d, 0);
    const P = player, m = monster; m.active = false; m.spawnT = 1e9; scares.next = 1e9; P.fear = 0;
    for (const k in keys) keys[k] = false;
    const R = W.raster(d, 11.5), res = { house: 'F' + (i + 1) + ' ' + n + 'p ' + diff + ' seed ' + seed, fails: [], inBox: 0, notes: 0, closets: 0, puzzles: 0, exit: false,
      want: [notes.length, closets.length, puzzles.length], simT: 0, classic: !!d.classic, rejects: LAYOUT_REJECTS.length - rej };
    const todo = [...notes.map((q, k) => ({ kind: 'note', k })), ...closets.map((q, k) => ({ kind: 'closet', k })), ...puzzles.map((q, k) => ({ kind: 'puzzle', k }))];
    const at = t => t.kind === 'note' ? notes[t.k] : t.kind === 'closet' ? closets[t.k] : t.kind === 'puzzle' ? wallPoint(puzzles[t.k].cell, puzzles[t.k].dir, 12) : exit;
    const done = t => t.kind === 'note' ? notes[t.k].read : t.kind === 'closet' ? hideTarget === closets[t.k] : t.kind === 'puzzle' ? puzzleTarget === t.k : state === (i === FLOORS.length - 1 ? 'win' : 'trans');
    const step = () => { updatePlayer(1 / 60); res.simT += 1 / 60;
      if (solidAt(P.x, P.y, 10.99)) res.inBox++;
      if (state === 'note') { noteAt = 0; closeNote(); } };
    const go = t => {
      const w = at(t), rad = t.kind === 'puzzle' ? 30 : t.kind === 'closet' ? 18 : 12;
      const goal = t.kind === 'puzzle' ? (x, y) => Math.hypot(x - w.x, y - w.y) < rad && los(x, y, w.x, w.y) : (x, y) => Math.hypot(x - w.x, y - w.y) < rad;
      const pts = W.route(R, P.x, P.y, goal, (x, y) => Math.max(0, Math.hypot(x - w.x, y - w.y) - rad));
      if (!pts) { res.fails.push(t.kind + ' ' + t.k + ': no route'); return false; }
      const lim = len(pts) / 105 * 2 + 5; let j = 0, tt = 0;
      keys.KeyW = true;
      while (tt < lim && !done(t)) {
        while (j < pts.length - 1 && Math.hypot(pts[j].x - P.x, pts[j].y - P.y) < 4) j++;
        if (j === pts.length - 1 && Math.hypot(pts[j].x - P.x, pts[j].y - P.y) < 2) break;
        P.ang = Math.atan2(pts[j].y - P.y, pts[j].x - P.x); step(); tt += 1 / 60;
        if (state !== 'play' && t.kind !== 'exit') break;
      }
      keys.KeyW = false; if (!done(t) && state === 'play') step();        // (standing still: what's next to you now)
      if (!done(t)) { res.fails.push(t.kind + ' ' + t.k + ': not reached in ' + lim.toFixed(1) + ' s (at ' + Math.round(P.x) + ',' + Math.round(P.y) + ', ' + Math.round(Math.hypot(P.x - w.x, P.y - w.y)) + ' u away)'); return false; }
      return true;
    };
    while (todo.length) {
      todo.sort((a, b) => Math.hypot(at(a).x - P.x, at(a).y - P.y) - Math.hypot(at(b).x - P.x, at(b).y - P.y));
      const t = todo.shift();
      if (t.kind === 'note' && notes[t.k].read) { res.notes++; continue; }       // (read on the way past)
      if (!go(t)) continue;
      if (t.kind === 'note') res.notes++;
      else if (t.kind === 'puzzle') { applyFuse(t.k); res.puzzles++; }
      else { toggleHide(); const hid = P.hidden; toggleHide(); if (hid && !P.hidden) res.closets++; else res.fails.push('wardrobe ' + t.k + ': toggleHide did not hide and leave'); }
    }
    if (powerOn) res.exit = go({ kind: 'exit' }); else res.fails.push('the door is still locked');
    for (const k in keys) keys[k] = false;
    state = 'walk';
    return res;
  });
  // her, from where she starts to 40 rooms, every wardrobe's doors (c + o*16) and a fake-leave spot, the real stepAlongPath at 30 steps
  // a second; before half of them she runs straight at something for 1.5 s (as when she sees you close), bumping into what's there
  W.herHouse = (i, n, diff, seed) => withSeed(seed ^ 0x68E31DA4, () => {
    const d = generateFloor(i, n, diff, seed); applyFloor(d, 0);
    let rs = seed; const rand = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    const m = monster, res = { house: 'F' + (i + 1) + ' ' + n + 'p ' + diff + ' seed ' + seed, targets: 0, late: [], inside: 0, stalls: 0, worst: 0, simT: 0 };
    const targets = [];
    for (let k = 0; k < 40; k++) targets.push(center(CELLS[rand() * CELLS.length | 0]));
    for (const c of closets) targets.push({ x: c.x + c.ox * 16, y: c.y + c.oy * 16 });
    // (a spot she'd pretend to leave to: from the first wardrobe that has one, 3 to 5 tiles away and out of its sight)
    if (closets.some(c => startFakeLeave(m, { x: c.x, y: c.y, id: 'me' }))) targets.push(m.target); else res.late.push('no fake-leave spot from any wardrobe');
    Object.assign(m, { active: true, state: 'search', quiet: 0, plan: [], stalls: 0, stall: 0 });
    for (const tg of targets) {
      res.targets++;
      if (rand() < 0.5) { const a = rand() * Math.PI * 2; for (let k = 0; k < 45; k++) { moveEntity(m, Math.cos(a) * 160 / 30, Math.sin(a) * 160 / 30, 12); if (blocked(m.x, m.y, 11.9)) res.inside++; } }
      m.path = []; m.repath = 0;
      const p0 = bfsPath(Math.floor(m.x / T), Math.floor(m.y / T), Math.floor(tg.x / T), Math.floor(tg.y / T));
      if (!p0) { res.late.push('no path to ' + Math.round(tg.x) + ',' + Math.round(tg.y)); continue; }
      const lim = p0.length * 50 / 26 * 1.3 + 5; let t = 0;
      while (Math.hypot(m.x - tg.x, m.y - tg.y) >= 8) {
        if (t > lim) { res.late.push(Math.round(tg.x) + ',' + Math.round(tg.y) + ' not reached in ' + lim.toFixed(1) + ' s'); break; }
        stepAlongPath(m, tg, 26, 1 / 30); t += 1 / 30;
        if (blocked(m.x, m.y, 11.9)) res.inside++;
      }
      res.simT += t; res.worst = Math.max(res.worst, t / lim);
    }
    res.stalls = m.stalls || 0; m.active = false; state = 'walk';
    return res;
  });
});

console.log('== you: every puzzle, note and wardrobe, then the door (every floor and difficulty twice, and every floor with 4 players)');
const houses = [];
for (let i = 0; i < 5; i++) for (let r = 0; r < 2; r++) DIFFS.forEach((df, k) => houses.push([i, 1, df, seedOf(i, 1, r * 3 + k)]));
for (let i = 0; i < 5; i++) houses.push([i, 4, DIFFS[i % 3], seedOf(i, 4, 0)]);
const walks = [];
for (const h of houses) { const r = await p.evaluate(h => WT.walkHouse(...h), h); walks.push(r);
  console.log(`  ${r.house}: notes ${r.notes}/${r.want[0]}, wardrobes ${r.closets}/${r.want[1]}, puzzles ${r.puzzles}/${r.want[2]}, door ${r.exit ? 'yes' : 'NO'}, ${r.simT.toFixed(0)} s walked` + (r.fails.length ? ' · ' + r.fails.join('; ') : '')); }
check(walks.every(r => !r.classic && !r.rejects), 'every house is a real layout (no plain-maze fallback, nothing rejected)', walks.filter(r => r.classic || r.rejects).map(r => r.house));
check(walks.every(r => r.puzzles === r.want[2]), 'every puzzle: walked up to it, the game offers it (USE), solved', walks.filter(r => r.puzzles !== r.want[2]).map(r => r.house));
check(walks.every(r => r.notes === r.want[0]), 'every torn note: walked onto it, it opens (and closes)', walks.filter(r => r.notes !== r.want[0]).map(r => r.house));
check(walks.every(r => r.closets === r.want[1]), 'every wardrobe: walked up to it, HIDE hides you, and you get out again', walks.filter(r => r.closets !== r.want[1]).map(r => r.house));
check(walks.every(r => r.exit), 'the door: walked out of it on every floor (the next floor screen, or the end of the game on floor 5)', walks.filter(r => !r.exit).map(r => r.house));
check(walks.every(r => r.inBox === 0), 'you never ended a step inside a piece of furniture', walks.filter(r => r.inBox).map(r => [r.house, r.inBox]));
check(walks.every(r => !r.fails.length), 'nothing failed on the way', walks.filter(r => r.fails.length).map(r => [r.house, r.fails]));

console.log('== her: 40 rooms, every wardrobe\'s doors and a fake-leave spot in each of those houses (half of them after a run at something)');
const hers = [];
for (const h of houses) { const r = await p.evaluate(h => WT.herHouse(...h), h); hers.push(r);
  console.log(`  ${r.house}: ${r.targets} places, ${r.simT.toFixed(0)} s, slowest ${(r.worst * 100).toFixed(0)}% of its time limit` + (r.late.length || r.inside || r.stalls ? ` · late ${r.late.length}, inside ${r.inside}, stalls ${r.stalls} ` + r.late.slice(0, 3).join('; ') : '')); }
check(hers.every(r => !r.late.length), 'she got everywhere within (tiles x 50/26 x 1.3 + 5) s', hers.filter(r => r.late.length).map(r => [r.house, r.late.slice(0, 3)]));
check(hers.every(r => !r.inside), 'never inside a wall or furniture (blocked at radius 11.9, after every step)', hers.filter(r => r.inside).map(r => [r.house, r.inside]));
check(hers.every(r => !r.stalls), 'the stall guard never had to step in', hers.filter(r => r.stalls).map(r => [r.house, r.stalls]));

console.log('== around the table: furniture between you and her');
const table = await p.evaluate(() => {
  const out = [];
  for (const [i, s0] of [[1, 11], [4, 23], [3, 37], [1, 51], [4, 67]]) for (let s = s0; s < s0 + 40 && out.length < 3; s++) withSeed(s * 7 + 1, () => {
    const d = generateFloor(i, 1, 'medium', s); applyFloor(d, 0);
    const bar = SOLIDS.find(q => q.kind === 'bar' && q.occ !== 'tall'); if (!bar || out.some(o => o.floor === i + 1)) { state = 'walk'; return; }
    // the bar lies on the grid line between two tiles: you on one side of its middle, her on the other
    const along = bar.x1 - bar.x0 > bar.y1 - bar.y0, mx = (bar.x0 + bar.x1) / 2, my = (bar.y0 + bar.y1) / 2;
    const A = along ? [Math.floor(mx / T), Math.round(my / T) - 1] : [Math.round(mx / T) - 1, Math.floor(my / T)], B = along ? [A[0], A[1] + 1] : [A[0] + 1, A[1]];
    const pc = center(A), hc = center(B), P = player, m = monster;
    P.x = pc.x; P.y = pc.y; P.crouching = false; P.moving = false; notes.forEach(q => q.read = true);
    Object.assign(m, { x: hc.x, y: hc.y, px: hc.x, py: hc.y, active: true, spawnT: 0, state: 'wander', target: null, path: [], repath: 0, screamT: 0, huntT: 0, last: null, ti: null, seenT: 99, stalls: 0 });
    const r = { floor: i + 1, seed: s, bar: bar.id, los: los(hc.x, hc.y, pc.x, pc.y), clear: clearLine(hc.x, hc.y, pc.x, pc.y, 12), caught: -1, inside: 0 };
    const real = downPlayer; let t = 0; downPlayer = () => { if (r.caught < 0) r.caught = +t.toFixed(2); };
    try { while (t < 12 && r.caught < 0) { updateMonster(1 / 60); t += 1 / 60; if (blocked(m.x, m.y, 11.9)) r.inside++; } } finally { downPlayer = real; }
    r.stalls = m.stalls || 0; m.active = false; state = 'walk'; out.push(r);
  });
  return out;
});
for (const r of table) console.log(`  floor ${r.floor} seed ${r.seed} (${r.bar}): walls-only sight ${r.los}, straight line clear ${r.clear}, caught after ${r.caught} s`);
check(table.length >= 2, 'found houses with a table (a bar piece she can see over) to play round', table.length);
check(table.every(r => r.los && !r.clear), 'each time: no wall between you (los), but the table is in her way (clearLine false)', table);
check(table.every(r => r.caught >= 0 && r.caught <= 12 && !r.inside && !r.stalls), 'she goes round the table and catches you within 12 s (never inside it, never stuck)', table);

console.log('== close by: you stand still somewhere (by a doorway corner, a box), she starts 2-3 tiles away');
// (running straight at you can clip a wall corner her body doesn't fit past: she must go round, not stand there pressing into it)
const close = await p.evaluate(() => {
  const out = { hunts: 0, caught: 0, frozen: [] };
  for (let i = 0; i < 5; i++) for (let h = 0; h < 5; h++) {
    const seed = 6100 + i * 100 + h, d = generateFloor(i, 1 + h % 4, ['easy', 'medium', 'hard'][h % 3], seed); applyFloor(d, 0); state = 'walk';
    let rs = seed; const rand = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    const P = player, m = monster; scares.next = 1e9; notes.forEach(z => z.read = true);
    const real = downPlayer; let caught = -1, t = 0; downPlayer = () => { if (caught < 0) caught = t; };
    try { for (let c = 0; c < 10; c++) {
      let x, y; do { x = rand() * GW * T; y = rand() * GH * T; } while (blocked(x, y, 11) || closetBlocked(x, y, 11));
      const dd = bfsDist(Math.floor(x / T), Math.floor(y / T)), cand = [];
      for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) { const k = dd[idx(tx, ty)]; if (k >= 2 && k <= 3) cand.push([tx, ty]); }
      if (!cand.length) continue; const s0 = center(cand[rand() * cand.length | 0]);
      Object.assign(P, { x, y, moving: false, hidden: false, down: false, crouching: rand() < 0.3, inv: 0 });
      Object.assign(m, { x: s0.x, y: s0.y, px: s0.x, py: s0.y, active: true, spawnT: 0, state: 'hunt', target: null, path: [], repath: 0, screamT: 0, huntT: 1e9, last: null, ti: null,
        seenT: 99, stalls: 0, stall: 0, noDirect: 0, kc: null, knowsCloset: false, fakeCool: 1e9 });
      caught = -1; t = 0; out.hunts++; let lx = m.x, ly = m.y, lm = 0, still = 0;
      while (t < 20 && caught < 0) { m.screamT = 0; updateMonster(1 / 60); t += 1 / 60; if (Math.hypot(m.x - lx, m.y - ly) > 2) { lx = m.x; ly = m.y; lm = t; } still = Math.max(still, t - lm); }
      if (caught >= 0) out.caught++;
      if (still >= 3) out.frozen.push({ floor: i + 1, seed, you: [Math.round(x), Math.round(y)], her: [Math.round(m.x), Math.round(m.y)], state: m.state, still: +still.toFixed(1) });
    } } finally { downPlayer = real; m.active = false; m.huntT = 0; state = 'walk'; }
  }
  return out;
});
console.log(`  ${close.hunts} hunts: caught ${close.caught}, stood still 3 s or more ${close.frozen.length}`);
check(close.hunts >= 200 && close.caught === close.hunts && !close.frozen.length, 'she catches you every time within 20 s, never standing still for 3 s', close.frozen.slice(0, 4));

console.log('== breaking her sight: behind tall and low furniture');
const sight = await p.evaluate(() => {
  const out = {};
  // she and you on either side of a piece (on a corner point, or in the middle of a room), 14 units from it: does she see you?
  const look = (crouch) => { const m = monster; m.seenT = 0; m.state = 'wander'; player.crouching = crouch;
    for (let k = 0; k < 20; k++) updateMonster(1 / 60); return { chase: m.state === 'chase', seenT: +m.seenT.toFixed(3) }; };
  for (const occ of ['tall', 'low']) for (const i of [3, 1, 2, 4, 0]) for (let s = 101; s < 141 && !out[occ]; s++) withSeed(s, () => {
    const d = generateFloor(i, 1, 'medium', s); applyFloor(d, 0);
    for (const bx of SOLIDS.filter(q => q.occ === occ && (q.kind === 'pocket' || q.kind === 'island'))) {
      const X = (bx.x0 + bx.x1) / 2, Y = (bx.y0 + bx.y1) / 2;
      for (const [dx, dy] of DIRS) { const o = (dx ? bx.x1 - bx.x0 : bx.y1 - bx.y0) / 2 + 14, h = { x: X - dx * o, y: Y - dy * o }, q = { x: X + dx * o, y: Y + dy * o };
        if (blocked(h.x, h.y, 12) || blocked(q.x, q.y, 11) || !los(h.x, h.y, q.x, q.y)) continue;
        const P = player, m = monster; P.x = q.x; P.y = q.y; P.moving = false; notes.forEach(n => n.read = true);
        Object.assign(m, { x: h.x, y: h.y, px: h.x, py: h.y, active: true, spawnT: 0, screamT: 1e9, huntT: 0, last: null, ti: null, target: null, path: [] });   // (screaming: she stands still)
        const r = { floor: i + 1, seed: s, piece: bx.id, los: los(h.x, h.y, q.x, q.y), standing: losSight(h.x, h.y, q.x, q.y, false), crouching: losSight(h.x, h.y, q.x, q.y, true) };
        r.crouch = look(true); r.stand = look(false); m.active = false; m.screamT = 0; out[occ] = r; break; }
      if (out[occ]) break; }
    state = 'walk';
  });
  return out;
});
console.log('  tall:', JSON.stringify(sight.tall)); console.log('  low: ', JSON.stringify(sight.low));
const tl = sight.tall, lw = sight.low;
check(tl && tl.los && !tl.standing && !tl.crouching, 'behind a tall piece: no wall in the way (los), but losSight is false', tl);
check(tl && !tl.stand.chase && !tl.crouch.chase && tl.stand.seenT > 0.3, 'and she doesn\'t see you there, standing or crouching (seen stays null)', tl);
check(lw && lw.los && lw.standing && !lw.crouching, 'behind a low piece: losSight false only while you crouch', lw);
check(lw && !lw.crouch.chase && lw.crouch.seenT > 0.3, 'crouching behind it: she doesn\'t see you', lw);
check(lw && lw.stand.chase && lw.stand.seenT === 0, 'standing up: she sees you (and comes for you)', lw);

// every tall and low piece, however narrow (a 13 u rack on a tile edge too): a line straight across its middle, 14 u out each side
const across = await p.evaluate(() => {
  const out = { lines: 0, through: [] };
  for (let i = 0; i < 5; i++) for (let s = 0; s < 40; s++) withSeed(9000 + s, () => {
    const d = generateFloor(i, 1 + s % 4, 'medium', 9000 + i * 97 + s); applyFloor(d, 0);
    for (const bx of SOLIDS) { if (bx.occ !== 'tall' && bx.occ !== 'low') continue;
      const X = (bx.x0 + bx.x1) / 2, Y = (bx.y0 + bx.y1) / 2;
      for (const [dx, dy] of [[1, 0], [0, 1]]) { const o = (dx ? bx.x1 - bx.x0 : bx.y1 - bx.y0) / 2 + 14, ax = X - dx * o, ay = Y - dy * o, bx2 = X + dx * o, by2 = Y + dy * o;
        if (!los(ax, ay, bx2, by2)) continue; out.lines++;
        if (losSight(ax, ay, bx2, by2, true) || (bx.occ === 'tall' && losSight(ax, ay, bx2, by2, false))) out.through.push([i + 1, bx.id, Math.round(bx.x1 - bx.x0), Math.round(bx.y1 - bx.y0)]); } }
    state = 'walk';
  });
  return out;
});
check(across.lines > 500 && !across.through.length, `no sight line straight across a tall or low piece gets through it (${across.lines} lines, 200 houses)`, across.through.slice(0, 8));

console.log('== the start room together (4 players)');
const room = await p.evaluate(() => {
  const bad = [], walk = [];
  for (let i = 0; i < 5; i++) for (let k = 0; k < 20; k++) { const d = generateFloor(i, 4, ['easy', 'medium', 'hard'][k % 3], 7000 + i * 100 + k);
    for (const [, x0, y0, x1, y1] of d.solids) if (x0 / 2 < 6 * T && x1 / 2 > T && y0 / 2 < 6 * T && y1 / 2 > T) bad.push('F' + (i + 1) + ' seed ' + (7000 + i * 100 + k));
    if (k) continue;
    // (multiplayer.test.mjs's walk: from (75, 125), facing +x, towards where a teammate stands at (175, 125))
    applyFloor(d, 0); const P = player, m = monster; m.active = false; m.spawnT = 1e9; notes.forEach(n => n.read = true);
    P.x = 75; P.y = 125; P.ang = 0; keys.KeyW = true; let stuck = 0;
    for (let f = 0; f < 60; f++) { const x = P.x; updatePlayer(1 / 60); if (P.x - x < 1.7) stuck++; }
    keys.KeyW = false; walk.push({ floor: i + 1, x: Math.round(P.x), stuck }); state = 'walk'; }
  return { bad, walk };
});
check(!room.bad.length, 'no furniture in tiles 1 to 5 of the start room (100 houses for 4 players)', room.bad);
check(room.walk.every(w => w.x >= 170 && !w.stuck), 'walking across it towards a teammate: nothing in the way for the first second (' + room.walk.map(w => w.x).join(', ') + ')', room.walk);

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary();
await b.close();
