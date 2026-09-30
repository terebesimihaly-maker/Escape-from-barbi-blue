// Floors: every one can be completed; the floor list, unlocking and difficulty; floors 4 and 5 played to the end;
// the phone button after a floor; mouse-look jumps; dynamic resolution; wide enough hallways.
import { launch, solo, check, summary, until, click, OUT, pageErrors, startSolo } from './lib.mjs';
const b = await launch();
const p = await solo(b, 'low', 640, 360);

console.log('== every floor can be completed');
// many random houses for every floor, number of players and difficulty: everything you need must be reachable
const report = await p.evaluate(() => {
  const bad = [], counts = {};
  for (let i = 0; i < FLOORS.length; i++) for (let n = 1; n <= 4; n++) for (const diff of ['easy', 'medium', 'hard']) for (let s = 0; s < 25; s++) {
    const d = generateFloor(i, n, diff), rows = d.rows, H = rows.length, W = rows[0].length, wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || rows[y][x] === '1';
    const tile = ([x, y]) => [Math.floor(x / T), Math.floor(y / T)];
    const start = tile(d.spawns[0]), seen = new Set([start.join()]), q = [start];
    while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of DIRS) { const k = (x + dx) + ',' + (y + dy); if (!wall(x + dx, y + dy) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); } } }
    const tag = `floor ${i + 1}, ${n}p, ${diff}`, reach = c => seen.has(c[0] + ',' + c[1]);
    const closetCells = new Set(d.closets.map(c => c[0] + ',' + c[1]));
    if (!reach(d.exit)) bad.push(tag + ': exit unreachable');
    d.fuses.forEach(f => { if (!reach(f)) bad.push(tag + ': a fuse is unreachable'); if (closetCells.has(f.join())) bad.push(tag + ': a fuse is inside a wardrobe'); if (f.join() === d.exit.join()) bad.push(tag + ': a fuse is on the exit'); });
    const want = Math.max(2, FLOORS[i].fuses + (n - 1) + DIFFS[diff].fuses);
    if (d.fuses.length < 2) bad.push(tag + ': fewer than 2 fuses');
    counts[d.fuses.length < want ? 'short' : 'full'] = (counts[d.fuses.length < want ? 'short' : 'full'] || 0) + 1;
    d.spawns.slice(0, n).forEach(sp => { const t = tile(sp); if (wall(t[0], t[1]) || !reach(t)) bad.push(tag + ': a spawn is in a wall');
      // room to stand: the player (radius 11) must not touch a wall at the spawn
      for (const [ox, oy] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) if (wall(Math.floor((sp[0] + ox) / T), Math.floor((sp[1] + oy) / T))) bad.push(tag + ': a spawn touches a wall'); });
    d.closets.forEach(([x, y, ox, oy]) => { if (!reach([x, y])) bad.push(tag + ': a wardrobe is unreachable'); if (wall(x + ox, y + oy)) bad.push(tag + ': a wardrobe faces a wall');
      if (DIRS.filter(([dx, dy]) => !wall(x + dx, y + dy)).length !== 1) bad.push(tag + ': a wardrobe is not in a dead end'); });
    if (!reach(d.m0)) bad.push(tag + ': she starts somewhere unreachable');
  }
  return { bad: [...new Set(bad)].slice(0, 20), counts, total: FLOORS.length * 4 * 3 * 25 };
});
check(report.bad.length === 0, `${report.total} random houses (5 floors x 1-4 players x 3 difficulties): every fuse, the exit, every spawn and wardrobe reachable`, report.bad);
console.log('  (fuses placed: all of them in', report.counts.full || 0, 'houses; fewer than planned in', report.counts.short || 0, '- still at least 2)');
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
check(await p.evaluate(() => curDiff === 'hard' && bb.fuses.length === 4), 'on Hard: her difficulty, and one more fuse (4)', await p.evaluate(() => [curDiff, bb.fuses.length]));
// the phone: use it, then finish the floor: on the next floor the button must be ready again
await p.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; usePhone(); });
check(await p.evaluate(() => document.getElementById('phone').disabled && /s$/.test(document.getElementById('phone').textContent)), 'the phone counts down after a text');
await p.evaluate(() => { bb.fuses.forEach((f, k) => bb.applyFuse(k)); const m = bb.monster; m.active = false; m.spawnT = 1e9; bb.player.x = bb.exit.x; bb.player.y = bb.exit.y; });
check(await until(p, () => bb.state === 'trans'), 'escaping floor 1');
check(await p.evaluate(() => progress.done[0] === true && JSON.parse(localStorage.getItem('bb_progress')).done[0] === true), 'floor 1 is saved as escaped');
await click(p, '#tGo');
check(await until(p, () => bb.state === 'play' && bb.floorIdx === 1), 'on to floor 2');
check(await p.evaluate(() => !document.getElementById('phone').disabled && document.getElementById('phone').textContent === 'PHONE'), 'the phone button is ready again on the new floor (it used to stay stuck)', await p.evaluate(() => document.getElementById('phone').textContent));
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
check(await p.evaluate(() => curDiff === 'easy' && bb.fuses.length === 4), 'on Easy: one fuse less (4)', await p.evaluate(() => [curDiff, bb.fuses.length]));
await p.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; });
await p.evaluate(() => { let best = null; for (const q of bb.CELLS()) { let n = 0; while (!bb.isWall(q[0] + n + 1, q[1])) n++; if (!best || n > best[2]) best = [q[0], q[1], n]; }
  bb.player.x = (best[0] + 0.5) * bb.T; bb.player.y = (best[1] + 0.5) * bb.T; bb.player.ang = 0; bb.player.pitch = 0; });
await p.waitForTimeout(2500); await p.screenshot({ path: OUT + '/floor4.png' });
check(await p.evaluate(() => bb.level && bb.level.house && bb.level.house.group.children.length > 5), 'the attic is dressed (lamps, sheets, trunks, cobwebs)');
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
const res = await p.evaluate(() => { state = 'play'; const r0 = resScale; for (let i = 0; i < 100; i++) adaptResolution(45, 0.05); const r1 = resScale;
  for (let i = 0; i < 400; i++) adaptResolution(10, 0.05); const r2 = resScale; state = 'win'; return [r0, r1, r2]; });
check(res[1] < res[0] && res[2] > res[1], 'slow frames lower the resolution, fast frames bring it back', res);

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary(); await b.close();
