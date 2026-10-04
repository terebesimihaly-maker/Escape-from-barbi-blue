// Floors: every one can be completed; the floor list, unlocking and difficulty; floors 4 and 5 played to the end;
// the phone button after a floor; mouse-look jumps; dynamic resolution; wide enough hallways.
import { launch, solo, check, summary, until, click, OUT, pageErrors, startSolo } from './lib.mjs';
const b = await launch();
const p = await solo(b, 'low', 640, 360);

console.log('== every floor can be completed');
// many houses for every floor, number of players and difficulty (fixed seeds): everything you need must be reachable. The furniture you
// bump into blocks steps between tiles: the search here goes round them with its own cuts (a step is cut when a box from d.solids crosses
// the 13 u band between the two tile centres), and each box must be its KIT footprint (js/kitdefs.js).
const report = await p.evaluate(() => {
  const bad = [], counts = {};
  for (let i = 0; i < FLOORS.length; i++) for (let n = 1; n <= 4; n++) for (const diff of ['easy', 'medium', 'hard']) for (let s = 0; s < 25; s++) {
    const d = generateFloor(i, n, diff, (i * 7907 + n * 503 + diff.length * 97 + s * 65537) >>> 0), rows = d.rows, H = rows.length, W = rows[0].length, wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || rows[y][x] === '1';
    const tag = `floor ${i + 1}, ${n}p, ${diff}`, tile = ([x, y]) => [Math.floor(x / T), Math.floor(y / T)];
    const boxes = d.solids.map(([k, x0, y0, x1, y1, rot, v]) => { const it = Object.assign({}, KIT.items[KIT.solidIds[k]], (KIT.items[KIT.solidIds[k]].var || [])[v]);
      const w = Math.round(it.w / KIT.u), dd = Math.round(it.d / KIT.u), [ex, ey] = rot & 1 ? [dd, w] : [w, dd];
      if (Math.abs((x1 - x0) / 2 - ex) > 0.5 || Math.abs((y1 - y0) / 2 - ey) > 0.5) bad.push(tag + ': a box that is not its KIT footprint');
      return { x0: x0 / 2, y0: y0 / 2, x1: x1 / 2, y1: y1 / 2 }; });
    const cutStep = (x, y, dx, dy) => { const ax = Math.min(x, x + dx) * T + T / 2, ay = Math.min(y, y + dy) * T + T / 2;
      const [bx0, by0, bx1, by1] = dx ? [ax, ay - 13, ax + T, ay + 13] : [ax - 13, ay, ax + 13, ay + T];
      return boxes.some(o => o.x0 < bx1 && o.x1 > bx0 && o.y0 < by1 && o.y1 > by0); };
    const start = tile(d.spawns[0]), seen = new Set([start.join()]), q = [start];
    while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of DIRS) { const k = (x + dx) + ',' + (y + dy); if (!wall(x + dx, y + dy) && !seen.has(k) && !cutStep(x, y, dx, dy)) { seen.add(k); q.push([x + dx, y + dy]); } } }
    const reach = c => seen.has(c[0] + ',' + c[1]);
    const closetCells = new Set(d.closets.map(c => c[0] + ',' + c[1]));
    if (!reach(d.exit)) bad.push(tag + ': exit unreachable');
    d.puzzles.forEach(z => { const f = z.cell; if (!reach(f)) bad.push(tag + ': a labyrinth box is unreachable'); if (closetCells.has(f.join())) bad.push(tag + ': a box is in a wardrobe cell');
      if (f.join() === d.exit.join()) bad.push(tag + ': a box is on the exit'); if (!wall(f[0] + z.dir[0], f[1] + z.dir[1])) bad.push(tag + ': a box hangs on no wall'); });
    const want = puzzleCount(i, diff);
    if (d.puzzles.length !== want) bad.push(tag + ': ' + d.puzzles.length + ' labyrinth boxes, not ' + want);
    counts[d.puzzles.length < want ? 'short' : 'full'] = (counts[d.puzzles.length < want ? 'short' : 'full'] || 0) + 1;
    if (d.closets.length !== 4 + i * 2 + (n - 1)) bad.push(tag + ': ' + d.closets.length + ' wardrobes, not ' + (4 + i * 2 + (n - 1)));
    d.spawns.slice(0, n).forEach(sp => { const t = tile(sp); if (wall(t[0], t[1]) || !reach(t)) bad.push(tag + ': a spawn is in a wall');
      // room to stand: the player (radius 11) must not touch a wall or a box at the spawn
      for (const [ox, oy] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) if (wall(Math.floor((sp[0] + ox) / T), Math.floor((sp[1] + oy) / T))) bad.push(tag + ': a spawn touches a wall');
      if (boxes.some(o => sp[0] + 11 > o.x0 && sp[0] - 11 < o.x1 && sp[1] + 11 > o.y0 && sp[1] - 11 < o.y1)) bad.push(tag + ': a spawn touches a box'); });
    d.closets.forEach(([x, y, ox, oy]) => { if (!reach([x, y])) bad.push(tag + ': a wardrobe is unreachable'); if (wall(x + ox, y + oy)) bad.push(tag + ': a wardrobe faces a wall');
      if (DIRS.filter(([dx, dy]) => !wall(x + dx, y + dy)).length !== 1) bad.push(tag + ': a wardrobe is not in a dead end'); });
    if (!reach(d.m0)) bad.push(tag + ': she starts somewhere unreachable');
  }
  return { bad: [...new Set(bad)].slice(0, 20), counts, total: FLOORS.length * 4 * 3 * 25 };
});
check(report.bad.length === 0, `${report.total} houses (5 floors x 1-4 players x 3 difficulties, fixed seeds): every labyrinth box, the exit, every spawn and wardrobe reachable around the furniture; all the wardrobes and boxes there`, report.bad);
console.log('  (labyrinth boxes placed: all of them in', report.counts.full || 0, 'houses; fewer than planned in', report.counts.short || 0, ')');
check(await p.evaluate(() => T - 2 * 11 >= 22), 'hallways are wide enough for two players side by side (tile ' + await p.evaluate(() => T) + ' units)');

console.log('== the floor list and unlocking');
await p.evaluate(() => { localStorage.removeItem('bb_progress'); progress.done = []; progress.best = []; });
await click(p, '#play');
check(await p.evaluate(() => !document.getElementById('panel').classList.contains('hidden') && document.querySelectorAll('#lvList button').length === 5), '"Enter the house" shows the 5 floors');
const locks = await p.evaluate(() => [...document.querySelectorAll('#lvList button')].map(b => b.disabled));
check(!locks[0] && locks.slice(1).every(Boolean), 'at first only floor 1 is open', locks);
await p.screenshot({ path: OUT + '/menu_levels.png' });
await click(p, '#diffSeg button[data-d="hard"]');
await click(p, '#lvList button[data-lv="0"]');
check(await until(p, () => bb.state === 'play'), 'floor 1 starts');
check(await p.evaluate(() => curDiff === 'hard' && bb.fuses.length === puzzleCount(0, 'hard') && puzzles[0].spec.holes === mazeSpec(0, 'hard').holes), 'on Hard: her difficulty, and harder mazes', await p.evaluate(() => [curDiff, bb.fuses.length, puzzles[0].spec]));
// the phone: use it, then finish the floor: on the next floor the button must be ready again
await p.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; usePhone(); });
check(await p.evaluate(() => document.getElementById('phone').disabled && /s$/.test(document.getElementById('phone').textContent)), 'the phone counts down after a text');
await p.evaluate(() => { bb.fuses.forEach((f, k) => bb.applyFuse(k)); const m = bb.monster; m.active = false; m.spawnT = 1e9; bb.player.x = bb.exit.x; bb.player.y = bb.exit.y; });
check(await until(p, () => bb.state === 'trans'), 'escaping floor 1');
check(await p.evaluate(() => progress.done[0] === true && JSON.parse(localStorage.getItem('bb_progress')).done[0] === true), 'floor 1 is saved as escaped');
await click(p, '#tGo');
check(await until(p, () => bb.state === 'play' && bb.floorIdx === 1), 'on to floor 2');
check(await p.evaluate(() => !document.getElementById('phone').disabled && document.getElementById('phone').textContent === 'PHONE'), 'the phone button is ready again on the new floor (it used to stay stuck)', await p.evaluate(() => document.getElementById('phone').textContent));
console.log('== torn notes: carry on with a click or E, the mouse stays captured');
await p.evaluate(() => { const cv = document.getElementById('c'); window.__exits = 0; window.__origExit = document.exitPointerLock;
  document.exitPointerLock = () => { window.__exits++; };
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => cv });     // (as if the mouse were captured)
  const m = bb.monster; m.active = false; m.spawnT = 1e9; const n = notes.find(n => !n.read); bb.player.x = n.x; bb.player.y = n.y; });
check(await until(p, () => bb.state === 'note' && !document.getElementById('note').classList.contains('hidden'), null, 20000), 'walking onto a note opens it');
await p.waitForTimeout(1500);
check(await p.evaluate(() => window.__exits === 0), 'the mouse stays captured while the note is open', await p.evaluate(() => window.__exits));
check(await p.evaluate(() => /click or press E/.test(document.querySelector('#note .tip').textContent)), 'the note says "click or press E" on a computer');
await p.evaluate(() => document.dispatchEvent(new MouseEvent('mousedown')));
check(await until(p, () => bb.state === 'play' && document.getElementById('note').classList.contains('hidden'), null, 5000), 'a click (with the mouse captured) closes the note');
await p.evaluate(() => { const n = notes.find(n => !n.read); if (n) { bb.player.x = n.x; bb.player.y = n.y; } });
if (await until(p, () => bb.state === 'note', null, 20000)) {
  await p.waitForTimeout(800);
  await p.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
  check(await until(p, () => bb.state === 'play' && document.getElementById('note').classList.contains('hidden'), null, 5000), 'pressing E closes the note too');
  check(await p.evaluate(() => !bb.player.hidden), '(and E did not also climb into a wardrobe)');
}
await p.evaluate(() => { dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })); delete document.pointerLockElement; document.exitPointerLock = window.__origExit; });
await p.evaluate(() => toTitle());
await click(p, '#play');
const locks2 = await p.evaluate(() => [...document.querySelectorAll('#lvList button')].map(b => b.disabled));
check(!locks2[0] && !locks2[1] && locks2.slice(2).every(Boolean), 'now floor 2 is open too, the rest still locked', locks2);
check(await p.evaluate(() => /Escaped/.test(document.querySelector('#lvList button[data-lv="0"]').textContent)), 'floor 1 shows as escaped (with its best time)');
await p.evaluate(() => closePanel());

console.log('== floors 4 and 5, to the end');
await p.evaluate(() => { progress.done = [true, true, true]; saveProgress(); });
await startSolo(p, 3, 'easy');
check(await until(p, () => bb.state === 'play' && bb.floorIdx === 3), 'floor 4 (The Attic) starts');
check(await p.evaluate(() => curDiff === 'easy' && bb.fuses.length === puzzleCount(3, 'easy')), 'on Easy: one labyrinth box less', await p.evaluate(() => [curDiff, bb.fuses.length]));
await p.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; });
await p.evaluate(() => { let best = null; for (const q of bb.CELLS()) { let n = 0; while (!bb.isWall(q[0] + n + 1, q[1])) n++; if (!best || n > best[2]) best = [q[0], q[1], n]; }
  bb.player.x = (best[0] + 0.5) * bb.T; bb.player.y = (best[1] + 0.5) * bb.T; bb.player.ang = 0; bb.player.pitch = 0; });
await p.waitForTimeout(2500); await p.screenshot({ path: OUT + '/floor4.png' });
check(await p.evaluate(() => bb.level && bb.level.house && (bb.level.house.group.children.length > 5 || bb.level.house.kitCount > 20)), 'the attic is dressed (lamps, sheets, trunks, cobwebs)');
// every box you bump into is drawn: something in the level covers at least 85% of its width, depth and height (H5)
const drawn = await p.evaluate(() => {
  const U = 0.045, n = SOLIDS.length, boxes = Array.from({ length: n }, () => new THREE.Box3()), m = new THREE.Matrix4(), bx = new THREE.Box3();
  bb.level.group.updateMatrixWorld(true);
  bb.level.group.traverse(o => { const k = o.userData.kit; if (!o.isInstancedMesh || !k || !Array.isArray(k.solid)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    k.solid.forEach((s, j) => { if (s < 0 || s >= n) return; o.getMatrixAt(j, m); m.premultiply(o.matrixWorld); boxes[s].union(bx.copy(o.geometry.boundingBox).applyMatrix4(m)); }); });
  const short = SOLIDS.map((s, i) => { const b = boxes[i]; if (b.isEmpty()) return s.id + ' not drawn';
    const cov = (a0, a1, c0, c1) => Math.max(0, Math.min(a1, c1) - Math.max(a0, c0)) / (c1 - c0);
    const c = [cov(b.min.x, b.max.x, s.x0 * U, s.x1 * U), cov(b.min.z, b.max.z, s.y0 * U, s.y1 * U), cov(b.min.y, b.max.y, 0, Math.min(s.h, WALL_H))];
    return c.every(v => v >= 0.85) ? null : s.id + ' ' + c.map(v => v.toFixed(2)).join('/'); }).filter(Boolean);
  return { n, short };
});
check(drawn.n > 0 && !drawn.short.length, `every piece of furniture you bump into is drawn, at its size (${drawn.n} on the attic floor)`, drawn.short.slice(0, 5));
await p.evaluate(() => { bb.fuses.forEach((f, k) => bb.applyFuse(k)); const m = bb.monster; m.active = false; m.spawnT = 1e9; bb.player.x = bb.exit.x; bb.player.y = bb.exit.y; });
check(await until(p, () => bb.state === 'trans'), 'floor 4 escaped');
await click(p, '#tGo');
check(await until(p, () => bb.state === 'play' && bb.floorIdx === 4), 'floor 5 (The Workshop) starts');
await p.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; let best = null;
  for (const q of bb.CELLS()) { let n = 0; while (!bb.isWall(q[0] + n + 1, q[1])) n++; if (!best || n > best[2]) best = [q[0], q[1], n]; }
  bb.player.x = (best[0] + 0.5) * bb.T; bb.player.y = (best[1] + 0.5) * bb.T; bb.player.ang = 0; bb.player.pitch = 0; });
await p.waitForTimeout(2500); await p.screenshot({ path: OUT + '/floor5.png' });
await p.evaluate(() => { bb.fuses.forEach((f, k) => bb.applyFuse(k)); const m = bb.monster; m.active = false; m.spawnT = 1e9; bb.player.x = bb.exit.x; bb.player.y = bb.exit.y; });
check(await until(p, () => bb.state === 'win' && !document.getElementById('win').classList.contains('hidden')), 'escaping floor 5 wins the game');
check(await p.evaluate(() => progress.done[4] === true), 'floor 5 saved as escaped');

console.log('== every puzzle can be solved (each kind, every floor and difficulty; the game\'s own code, fast-forwarded)');
const sim = await p.evaluate(() => {
  const keep = drawBoard, fx = fuses, res = [], cv = { width: 440, height: 340 }; drawBoard = () => {};
  for (let fl = 0; fl < 5; fl++) for (const diff of ['easy', 'medium', 'hard']) for (let s = 0; s < 5; s++) {
    const kind = FLOOR_KIND[fl], pz = { cell: [0, 0], dir: [0, -1], seed: (fl * 1000 + s * 7919 + diff.length * 31) | 0, kind, spec: puzzleSpec(kind, fl, diff) };
    pz.data = KINDS[kind].build(pz); pz.solved = false; puzzles = [pz]; fuses = [];
    const o = pzOpen = Object.assign({ k: 0, won: 0 }, KINDS[kind].start(pz)); let t = 0, info = '';
    if (kind === 'maze') { const mz = pz.data; let i = 0, falls = 0, was = 0;
      while (t < 180 && !o.won) { const b = o.ball; if (o.fall && !was) { falls++; i = 0; } was = o.fall;
        while (i < mz.route.length - 1 && Math.hypot(b.x - (mz.route[i][0] + 0.5), b.y - (mz.route[i][1] + 0.5)) < 0.3) i++;
        const g = mz.route[i], dx = g[0] + 0.5 - b.x, dy = g[1] + 0.5 - b.y, d = Math.hypot(dx, dy) || 1;
        tilt.mx = clamp(dx / d * 0.9 - b.vx * 0.35, -1, 1); tilt.my = clamp(dy / d * 0.9 - b.vy * 0.35, -1, 1); updateBall(1 / 60); t += 1 / 60; }
      info = mz.C + 'x' + mz.R + ', ' + mz.holes.length + ' holes'; }
    else if (kind === 'slide') { for (let i = pz.data.hist.length - 1; i >= 0 && !o.won; i--) slideAt(o, pz, pz.data.hist[i]); info = pz.data.n + 'x' + pz.data.n + ', ' + pz.data.hist.length + ' moves'; }
    else if (kind === 'pipes') { const n = pz.data.n, sz = Math.min(cv.width * 0.8, cv.height * 0.9), cs = sz / n, ox = (cv.width - sz) / 2, oy = (cv.height - sz) / 2;
      for (let y = 0; y < n && !o.won; y++) for (let x = 0; x < n && !o.won; x++) while (o.rot[y][x] !== 0 && !o.won) KINDS.pipes.click(o, pz, ox + (x + 0.5) * cs, oy + (y + 0.5) * cs, cv);
      info = n + 'x' + n; }
    else if (kind === 'simon') { while (t < 120 && !o.won) { KINDS.simon.update(o, pz, 1 / 30); t += 1 / 30;
        if (o.phase === 'play') for (let i = 0; i < o.round && !o.won && o.phase === 'play'; ) { const r = o.round; musicKey(o, pz, pz.data.seq[i]); if (o.round !== r) break; i = o.i; } }
      info = pz.spec.len + ' notes'; }
    else { if (pz.data.moves) { for (let i = 0; i < pz.data.R && !o.won; i++) for (let n = (pz.data.S - pz.data.moves[i]) % pz.data.S; n > 0 && !o.won; n--) turnRing(o, pz, i); }   // (each scrambling turn undone by going on round)
      else for (let i = 0; i < pz.data.R && !o.won; i++) while (o.off[i] !== 0 && !o.won) turnRing(o, pz, i);
      info = pz.data.R + ' rings'; }
    res.push({ fl, diff, kind, ok: !!o.won, info });
  }
  pzOpen = null; puzzles = []; fuses = fx; drawBoard = keep; tilt.mx = tilt.my = 0;
  return res;
});
const failed = sim.filter(r => !r.ok);
check(failed.length === 0, `all ${sim.length} puzzles (5 floors x 3 difficulties x 5 random boards) can be solved`, failed.slice(0, 5));
for (let fl = 0; fl < 5; fl++) { const rs = sim.filter(r => r.fl === fl); console.log(`  floor ${fl + 1}: ${rs[0].kind} (${[...new Set(rs.map(r => r.info))].slice(0, 4).join('; ')})`); }
check(await p.evaluate(() => [0, 1, 2, 3, 4].every(fl => { startFloor(fl); return puzzles.length === puzzleCount(fl, settings.difficulty) && puzzles.every(z => z.kind === FLOOR_KIND[fl]); })),
  'every floor has its own kind of puzzle, 3 to 5 of them');
await p.evaluate(() => { state = 'win'; });
// and one for real: walk up, USE, tilt the ball in, the door unlocks
const real = await p.evaluate(async () => {
  settings.difficulty = 'medium'; startFloor(0); state = 'play'; const m = bb.monster; m.active = false; m.spawnT = 1e9; notes.forEach(n => n.read = true);
  const wait = ms => new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 100 && !(bb.level && bb.level.grid === bb.grid); k++) await wait(100);
  for (let k = 0; k < puzzles.length; k++) {
    const z = puzzles[k], w = wallPoint(z.cell, z.dir, 22); bb.player.x = w.x; bb.player.y = w.y;
    for (let j = 0; j < 50 && puzzleTarget !== k; j++) await wait(100);
    bb.toggleHide(); if (!pzOpen) return { k, opened: false };
    const mz = z.data, t0 = performance.now(); let i = 0;
    while (pzOpen && performance.now() - t0 < 120000) { const o = pzOpen, b = o.ball; if (o.fall) i = 0;
      while (i < mz.route.length - 1 && Math.hypot(b.x - (mz.route[i][0] + 0.5), b.y - (mz.route[i][1] + 0.5)) < 0.3) i++;
      const g = mz.route[i], dx = g[0] + 0.5 - b.x, dy = g[1] + 0.5 - b.y, d = Math.hypot(dx, dy) || 1;
      tilt.mx = clamp(dx / d * 0.9 - b.vx * 0.35, -1, 1); tilt.my = clamp(dy / d * 0.9 - b.vy * 0.35, -1, 1); await wait(25); }
    if (!z.solved) return { k, solved: false };
  }
  tilt.mx = tilt.my = 0; return { all: bb.fusesGot === puzzles.length, power: bb.powerOn };
});
check(real.all && real.power, 'for real on floor 1: walk up, USE, tilt the ball into the gold hole (every box), the door unlocks', real);
await p.evaluate(() => { settings.difficulty = 'medium'; state = 'win'; });
const hint = await p.evaluate(() => { startFloor(2); state = 'play'; const m = bb.monster; m.active = false; m.spawnT = 1e9;
  const a = !!fuseHintOn(); levelTime = 61; const b = !!fuseHintOn(); levelTime = 0; bb.fuses.slice(1).forEach((f, k) => { f.got = true; puzzles[k + 1].solved = true; }); fusesGot = bb.fuses.length - 1; const c = !!fuseHintOn(); state = 'win'; return [a, b, c]; });
check(!hint[0] && hint[1] && hint[2], 'the arrow to the nearest labyrinth box shows after a minute without solving one, or when only one is left', hint);

console.log('== mouse look: no jumps');
const look = await p.evaluate(() => {
  state = 'play'; const cv = document.getElementById('c');
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => cv });
  document.dispatchEvent(new Event('pointerlockchange'));
  const mv = dx => document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0 }));
  const a0 = bb.player.ang; mv(5); mv(5); mv(5); const aSkip = bb.player.ang;        // (the first moves after locking are skipped)
  mv(10); const aSmall = bb.player.ang; mv(900); const aBig = bb.player.ang;
  delete document.pointerLockElement; state = 'win';
  return { skipped: aSkip === a0, small: aSmall !== aSkip, big: aBig === aSmall };
});
check(look.skipped, 'the first mouse moves right after the cursor locks are ignored', look);
check(look.small, 'normal mouse moves turn the view', look);
check(look.big, 'an impossible jump (900 px in one move) is ignored', look);

console.log('== dynamic resolution');
const res = await p.evaluate(() => { state = 'play'; resScale = 1; frameAvg = 16; slowT = fastT = 0; const r0 = resScale; for (let i = 0; i < 100; i++) adaptResolution(45, 0.05); const r1 = resScale;
  for (let i = 0; i < 400; i++) adaptResolution(10, 0.05); const r2 = resScale; state = 'win'; return [r0, r1, r2]; });
check(res[1] < res[0] && res[2] > res[1], 'slow frames lower the resolution, fast frames bring it back', res);

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary(); await b.close();
