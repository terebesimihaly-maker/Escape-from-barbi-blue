// Single player: torn notes (random, counted), loose floorboards, holding your breath, her pretending to leave, fear,
// the paintings, achievements, the performance overlay, and the 90-second down time.
import { launch, solo, check, summary, until, click, OUT, pageErrors, startSolo } from './lib.mjs';
const b = await launch();
const p = await solo(b, 'low', 640, 360);
const calmHer = () => p.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; });

console.log('== down time');
check(await p.evaluate(() => ['easy', 'medium', 'hard'].every(d => DIFFS[d].down === 90)), 'a downed player has 90 seconds (1:30) on every difficulty');

console.log('== torn notes: three of four, somewhere different every time');
const gen = await p.evaluate(() => {
  const picks = new Set(), spots = new Set(), bad = [];
  for (let i = 0; i < FLOORS.length; i++) for (let s = 0; s < 20; s++) {
    const d = generateFloor(i, 1, 'medium'), ks = d.notes.map(n => n[3]);
    if (d.notes.length !== 3 || new Set(ks).size !== 3 || ks.some(k => !NOTE_POOL[i][k])) bad.push('floor ' + (i + 1) + ': ' + JSON.stringify(ks));
    if (i === 0) { picks.add(ks.slice().sort().join()); spots.add(d.notes.map(n => n[0] + ',' + n[1]).join(' ')); }
  }
  return { bad, picks: picks.size, spots: spots.size, total: NOTES_TOTAL };
});
check(gen.bad.length === 0, 'every floor: 3 different notes from its own 4', gen.bad);
check(gen.picks > 1 && gen.spots > 15, 'which notes, and where, changes from game to game (floor 1, 20 games: ' + gen.picks + ' different sets, ' + gen.spots + ' different placements)');
check(gen.total === 20, 'there are 20 notes to find in all');
await p.evaluate(() => { localStorage.removeItem('bb_progress'); progress.done = []; progress.best = []; progress.notes = []; progress.hard = [];
  localStorage.removeItem('bb_ach'); for (const k in achieved) delete achieved[k]; });
await startSolo(p, 0);
await until(p, () => bb.state === 'play');
await calmHer();
check(await p.evaluate(() => ['pingBtn', 'emoteBtn', 'warnBtn'].every(id => document.getElementById(id).classList.contains('hidden'))), 'no ping or emote buttons in single player');
check(await p.evaluate(() => document.getElementById('hNote').textContent === '📜 0/3'), 'the HUD shows this floor\'s notes: 📜 0/3', await p.evaluate(() => document.getElementById('hNote').textContent));
await p.evaluate(() => { const n = notes[0]; bb.player.x = n.x; bb.player.y = n.y; });
check(await until(p, () => bb.state === 'note', null, 20000), 'walking onto a note opens it');
check(await p.evaluate(() => /Note 1 of 20 found/.test(document.getElementById('paper').textContent) && progress.notes.length === 1 && progress.notes[0] === notes[0].id), 'it says "Note 1 of 20 found" and is saved', await p.evaluate(() => document.getElementById('paper').textContent.slice(-40)));
check(await p.evaluate(() => document.getElementById('hNote').textContent === '📜 1/3'), 'the HUD counts it: 📜 1/3');
await p.evaluate(() => { noteAt = 0; closeNote(); });
check(await p.evaluate(() => JSON.parse(localStorage.getItem('bb_progress')).notes.length === 1), 'kept on the device');

console.log('== loose floorboards');
const boards = await p.evaluate(() => {
  const bad = []; let side = 0, mid = 0, minLane = 99;
  for (let i = 0; i < FLOORS.length; i++) for (const diff of ['easy', 'medium', 'hard']) for (let s = 0; s < 10; s++) {
    const d = generateFloor(i, 1, diff), rows = d.rows, wall = (x, y) => rows[y] === undefined || rows[y][x] !== '0';
    const taken = new Set([...d.closets.map(c => c[0] + ',' + c[1]), ...d.puzzles.map(z => z.cell.join()), d.exit.join(), ...d.notes.map(n => n[0] + ',' + n[1])]);
    if (!d.creaks.length) bad.push('floor ' + (i + 1) + ' has none');
    for (const [x, y, along, len] of d.creaks) {
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      if (wall(tx, ty)) bad.push('a board in a wall'); if (taken.has(tx + ',' + ty)) bad.push('a board on a wardrobe, puzzle, note or the door');
      if (tx <= 3 && ty <= 3) bad.push('a board at the start');
      // where a player (radius 11) can stand across the tile without stepping on it
      const off = along ? x - (tx * T + T / 2) : y - (ty * T + T / 2); let lane = 0;
      for (let a = -(T / 2 - 11); a <= T / 2 - 11; a++) if (Math.abs(a - off) >= BOARD_ACROSS) lane++;
      if (len > BOARD_LEN) {                                   // one right across a corridor: from wall to wall, no way round
        mid++;
        const v = wall(tx - 1, ty) && wall(tx + 1, ty), h = wall(tx, ty - 1) && wall(tx, ty + 1);
        if (v === h) bad.push('a long board that is not in a corridor');
        if (along !== (v ? 0 : 1)) bad.push('a long board lying along the corridor, not across it');
        if ((v ? Math.abs(x - (tx * T + T / 2)) : Math.abs(y - (ty * T + T / 2))) > 0.5) bad.push('a long board off the middle');
        if (len / 2 + 3 < T / 2 - 11) bad.push('a long board you could squeeze past');
      } else { side++; minLane = Math.min(minLane, lane); if (lane < 14) bad.push('not enough room to step around a board: ' + lane); }
    }
  }
  return { bad: [...new Set(bad)], side, mid, share: mid / (side + mid), minLane };
});
check(boards.bad.length === 0, 'on every floor and difficulty: boards in the open, never on anything important', boards.bad);
check(boards.share > 0.04 && boards.share < 0.18, 'about one in ten lies right across a corridor, wall to wall (no way round): ' + boards.mid + ' of ' + (boards.side + boards.mid), boards);
check(boards.minLane >= 14, 'the others: always a wide lane to walk past (at least ' + boards.minLane + ' of 28 units)', boards);
const b3d = await until(p, () => typeof boardsTemplate !== 'undefined' && boardsTemplate, null, 60000) && await p.evaluate(() => { startFloor(0); state = 'play'; notes.forEach(n => n.read = true); const m = bb.monster; m.active = false; m.spawnT = 1e9; buildLevel();   // (the level is built on the next frame otherwise)
  const groups = bb.level.group.children.filter(g => g.children && g.children.some(c => /^Board(Short|Long)$/.test(c.name)));
  return { n: creaks.length, groups: groups.length, long: groups.filter(g => g.children.some(c => c.name === 'BoardLong')).length, mid: creaks.filter(c => c.mid).length }; });
check(b3d && b3d.groups === b3d.n && b3d.long === b3d.mid, 'every loose board is a real 3D board (made in Blender), a long one wherever it lies across a corridor', b3d);
await p.evaluate(() => { window.__boards = 0; const o = sfx.board; sfx.board = (...a) => { window.__boards++; return o(...a); }; });
const bd = await p.evaluate(() => {
  const b0 = window.__b0 = creaks.find(b => !b.mid) || creaks[0], m = bb.monster; m.active = true; m.spawnT = 0; m.state = 'wander'; m.x = b0.x + (b0.along ? 0 : 150); m.y = b0.y + (b0.along ? 150 : 0);
  if (bb.isWall(Math.floor(m.x / T), Math.floor(m.y / T))) { m.x = b0.x; m.y = b0.y; }
  // beside it first (the other side of the corridor), then on it
  const off = b0.along ? b0.x - (Math.floor(b0.x / T) * T + T / 2) : b0.y - (Math.floor(b0.y / T) * T + T / 2), side = off > 0 ? -12 : 12;
  bb.player.x = b0.along ? Math.floor(b0.x / T) * T + T / 2 + side : b0.x; bb.player.y = b0.along ? b0.y : Math.floor(b0.y / T) * T + T / 2 + side;
  updateBoards(); const beside = window.__boards;
  bb.player.x = b0.x; bb.player.y = b0.y; updateBoards(); const on = window.__boards; updateBoards(); const again = window.__boards;
  return { beside, on, again, st: m.state, last: m.last, b: [b0.x, b0.y], creaks: fstat.creaks };
});
check(bd.beside === 0, 'walking past beside a board: silent');
check(bd.on === 1 && bd.again === 1, 'stepping on it: one loud creak (not again while you stand on it)', bd);
check(bd.st === 'hunt' && bd.last && bd.last.x === bd.b[0] && bd.last.y === bd.b[1], 'she heard it and comes to the board', bd);
await p.evaluate(() => { const b0 = window.__b0; bb.player.x += 60; updateBoards(); bb.player.x -= 60; bb.player.y = b0.y; bb.player.x = b0.x; updateBoards(); });
check(await p.evaluate(() => window.__boards === 2), 'step off and on again: it creaks again');
const across = await p.evaluate(() => {                    // one right across a corridor: it creaks, but it doesn't spoil "Light feet"
  const p0 = bb.player, n0 = window.__boards, c0 = fstat.creaks, b = { x: p0.x + 80, y: p0.y, along: 1, len: BOARD_MID_LEN, mid: true, on: false };
  creaks.push(b); p0.x += 80; p0.y += 20; updateBoards(); const r = { creak: window.__boards - n0, counted: fstat.creaks - c0 };
  creaks.pop(); p0.x -= 80; p0.y -= 20; return r; });
check(across.creak === 1 && across.counted === 0, 'a long board across a corridor: it creaks too (even 20 units off its middle), but it doesn\'t count against "Light feet"', across);
await p.screenshot({ path: OUT + '/board.png' });

console.log('== crouching (Ctrl): slower, completely silent');
check(await p.evaluate(() => settings.keys.run[0] === 'ShiftLeft' && !settings.keys.run.includes('ControlLeft') && settings.keys.crouch[0] === 'ControlLeft'), 'Shift runs, Ctrl crouches');
check(await p.evaluate(() => { const k = migrateKeys({ run: ['ShiftLeft', 'ControlLeft'] }); return k.run.join() === 'ShiftLeft,'; }), 'keys saved before crouching existed: Ctrl no longer runs');
const cr = await p.evaluate(async () => {
  const P = bb.player, m = bb.monster; notes.forEach(n => n.read = true); if (bb.state === 'note') { noteAt = 0; closeNote(); } bb.state = 'play';
  if (P.hidden) exitHide();
  m.active = false; m.spawnT = 1e9; m.state = 'wander'; m.x = -9999; m.y = -9999;   // (the board test left her hunting)
  // (stand in the middle of the longest open corridor from here, facing along it)
  const tx = Math.floor(P.x / bb.T), ty = Math.floor(P.y / bb.T); let best = [0, 0];
  for (const [dx, dy] of DIRS) { let n = 0; while (!bb.isWall(tx + dx * (n + 1), ty + dy * (n + 1))) n++; if (n > best[0]) best = [n, Math.atan2(dy, dx)]; }
  P.x = (tx + 0.5) * bb.T; P.y = (ty + 0.5) * bb.T; P.ang = best[1];
  const frames = n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const eye0 = EYE;                                       // (standing height)
  let steps = 0; const os = sfx.step; sfx.step = (...a) => { steps++; return os(...a); };
  keys.ControlLeft = true; keys.KeyW = true; const x0 = P.x, y0 = P.y, t0 = levelTime;
  await frames(40);
  const crouching = P.crouching, eye1 = bb.camera.position.y, dist = Math.hypot(P.x - x0, P.y - y0), dt = levelTime - t0;
  // she's right there, walking about: she doesn't hear a crouching player move
  // (behind you, facing away, walking off: she can only hear, not see)
  m.active = true; m.spawnT = 0; m.state = 'wander'; m.x = P.x - Math.cos(P.ang) * 55; m.y = P.y - Math.sin(P.ang) * 55; m.ang = P.ang + Math.PI; m.last = null; m.heard = false;
  await frames(4); const heard = m.heard; m.active = false; m.spawnT = 1e9;
  // a loose board under a crouching foot: no creak
  const n0 = window.__boards; const b = { x: P.x, y: P.y, along: 0, len: BOARD_LEN, mid: false, on: false }; creaks.push(b); updateBoards(); const creak = window.__boards - n0; creaks.pop();
  keys.ControlLeft = false; keys.KeyW = false; sfx.step = os; m.active = false; m.spawnT = 1e9;
  return { state: bb.state, locked: document.pointerLockElement ? 1 : 0, paused: !document.getElementById('paused').classList.contains('hidden'), crouching, eyeDrop: +(eye0 - eye1).toFixed(2), speed: +(dist / Math.max(dt, 1e-3)).toFixed(1), steps, heard, creak };
});
check(cr.crouching && cr.eyeDrop > 0.4, 'holding Ctrl: you crouch, the camera goes down', cr);
check(cr.speed > 20 && cr.speed < 70, 'and move at about half speed (' + cr.speed + ' a second; walking is 105)', cr);
check(cr.steps === 0 && !cr.heard && cr.creak === 0, 'completely silent: no footsteps, she doesn\'t hear you, the boards don\'t creak', cr);

console.log('== holding your breath');
await calmHer();
// (the board test teleports the player around: it may have landed on a note. Read them all, close any that's open)
await p.evaluate(() => { notes.forEach(n => { n.read = true; }); if (bb.state === 'note') { noteAt = 0; closeNote(); } });
await p.evaluate(() => { const c = bb.closets[0]; bb.player.x = c.x + c.ox * 30; bb.player.y = c.y + c.oy * 30; });
await p.evaluate(() => { const c = bb.closets[0]; hideTarget = c; bb.toggleHide(); });
check(await until(p, () => bb.player.hidden && !document.getElementById('breath').classList.contains('hidden') && !document.getElementById('breathBar').classList.contains('hidden') && document.getElementById('run').classList.contains('hidden'), null, 30000),
  'in the wardrobe: the BREATH button and bar replace RUN');
await p.evaluate(() => { DIFFS.medium.breath = 3; });           // (a short breath: the test machine is slow)
await p.keyboard.down('Space');
check(await until(p, () => bb.player.holding && bb.player.breath < 0.9, null, 20000), 'holding Space: holding your breath, the bar goes down');
// (she stands still a few steps away: 'lurk' with no end, the same as waiting around a corner)
const standBy = `const m = bb.monster, c = bb.closets[0]; m.active = true; m.spawnT = 0; m.state = 'lurk'; m.fakeT = 1e9; m.fakeFor = null; m.quiet = 0;
  m.x = c.x + c.ox * 55; m.y = c.y + c.oy * 55; m.bh = {}; m.huntT = 0; huntTimer = 1e9;`;
await p.evaluate(standBy);
await p.waitForTimeout(1500);
check(await p.evaluate(() => !(bb.monster.bh && Object.values(bb.monster.bh).some(v => v > 0))), 'she stands right outside but hears nothing while you hold it');
check(await until(p, () => stealth.gasps === 1, null, 40000), 'too long: you gasp for air');
await p.keyboard.up('Space');
check(await p.evaluate(() => bb.monster.knowsCloset && bb.monster.kcWhy === 'gasp' && bb.monster.state === 'chase'), 'she heard the gasp and knows which wardrobe', await p.evaluate(() => [bb.monster.knowsCloset, bb.monster.kcWhy, bb.monster.state]));
check(await until(p, () => bb.state === 'dead', null, 40000), 'and she opens it');
check(await p.evaluate(() => /gasp/.test(deathReason)), 'the reason: ' + await p.evaluate(() => deathReason));
await p.evaluate(() => { DIFFS.medium.breath = 7; });

// breathing, not holding, with her right outside: she hears it and goes to open that wardrobe
await p.evaluate(() => { bb.startFloor(0); bb.state = 'play'; });
await calmHer();
await p.evaluate(() => { const c = bb.closets[0]; hideTarget = c; bb.toggleHide(); });
await p.evaluate(standBy);
check(await until(p, () => (bb.monster.state === 'search' || bb.monster.state === 'check') && bb.monster.target && bb.monster.target.closet === 0 || bb.monster.checking === 0, null, 40000),
  'not holding it with her a few steps away: she hears you breathing and comes to that wardrobe', await p.evaluate(() => [bb.monster.state, bb.monster.target, bb.monster.bh]));
// at the doors, listening: hold your breath and she moves on
// (her choice is random: the tests pick the unlucky roll each time, to show what can happen)
await p.evaluate(() => { const r = Math.random; Math.random = () => 0.99; bb.player.holding = true; checkWardrobe(bb.monster, 0, bb.allPlayers()); Math.random = r; });
check(await until(p, () => !!achieved.breath, null, 20000), 'holding your breath while she listens at your doors: she moves on ("Not a sound")');
check(await p.evaluate(() => bb.state === 'play' && bb.player.hidden && !bb.closetScene), 'you\'re still there, safe');
check(await until(p, () => document.getElementById('toast').classList.contains('on'), null, 5000), 'an achievement card slides in');
await p.screenshot({ path: OUT + '/achievement_toast.png' });
// without holding it (and after the "I know you're in here" scene): she can open the doors
await p.evaluate(() => { const r = Math.random; Math.random = () => 0.3; bb.player.holding = false; bb.sceneCool = 99; checkWardrobe(bb.monster, 0, bb.allPlayers()); Math.random = r; });
check(await until(p, () => bb.state === 'dead', null, 20000) && await p.evaluate(() => /breathing/.test(deathReason)), 'not holding it (after the "I know you\'re in here" scene): she can hear you breathing', await p.evaluate(() => deathReason));
check(await p.evaluate(() => { const r = Math.random; Math.random = () => 0.3; bb.startFloor(0); bb.state = 'play'; const m = bb.monster; m.active = false;
  const c = bb.closets[0]; hideTarget = c; bb.toggleHide(); bb.player.holding = true; checkWardrobe(m, 0, bb.allPlayers()); Math.random = r; return bb.state === 'play'; }),
  'the same roll while holding your breath: safe');

console.log('== she pretends to leave');
await p.evaluate(() => { bb.startFloor(0); bb.state = 'play'; });
await calmHer();
await p.evaluate(() => { DIFFS.medium.fake = 1; const c = bb.closets[0]; hideTarget = c; bb.toggleHide(); bb.player.holding = true; keys.Space = true; DIFFS.medium.breath = 1e9;
  const m = bb.monster; m.active = true; m.spawnT = 0; m.state = 'search'; m.searchT = 0.01; m.plan = []; m.target = null; m.fakeCool = 0; huntTimer = 1e9;
  m.x = c.x + c.ox * 60; m.y = c.y + c.oy * 60; m.last = { x: m.x, y: m.y }; });
check(await until(p, () => bb.monster.state === 'leave', null, 20000), 'she gives up the search... and walks off');
check(await until(p, () => bb.monster.quiet > 0.5, null, 30000), 'her footsteps and song fade, as if she were far away');
check(await until(p, () => bb.monster.state === 'lurk', null, 40000), 'then she waits around the corner');
const lurk = await p.evaluate(() => { const m = bb.monster, c = bb.player.closet, dq = bfsDist(Math.floor(c.x / T), Math.floor(c.y / T)); return {
  path: dq[idx(Math.floor(m.x / T), Math.floor(m.y / T))], seen: los(c.x, c.y, m.x, m.y), quiet: herQuiet(), song: m.quiet }; });
check(lurk.path >= 2 && lurk.path <= 6 && !lurk.seen, 'close by (' + lurk.path + ' tiles), out of sight of your wardrobe', lurk);
check(lurk.quiet === 1, 'silent: no song, no music box, no heartbeat', lurk);
await p.evaluate(() => { bb.monster.fakeT = 0.01; });
check(await until(p, () => bb.monster.state === 'wander' && !!achieved.notfooled, null, 20000), 'you stayed put: she really leaves ("Not fooled")');
check(await until(p, () => bb.monster.quiet === 0, null, 20000), 'and you can hear her again');
// the other way: come out while she lurks, in her sight
await p.evaluate(() => { const m = bb.monster; m.state = 'search'; m.searchT = 0.01; m.fakeCool = 0; m.plan = []; m.target = null; const c = bb.player.closet; m.x = c.x + c.ox * 60; m.y = c.y + c.oy * 60; });
await until(p, () => bb.monster.state === 'lurk', null, 60000);
await p.evaluate(() => { keys.Space = false; exitHide(); const m = bb.monster, tx = Math.floor(m.x / T), ty = Math.floor(m.y / T);
  const [dx, dy] = DIRS.find(([dx, dy]) => !bb.isWall(tx + dx, ty + dy)); bb.player.x = (tx + dx) * T + T / 2; bb.player.y = (ty + dy) * T + T / 2; });
check(await until(p, () => bb.monster.state === 'chase', null, 20000), 'come out too soon and she\'s right there');
await p.evaluate(() => { DIFFS.medium.fake = 0.5; DIFFS.medium.breath = 7; });

console.log('== fear');
await p.evaluate(() => { bb.startFloor(0); bb.state = 'play'; });
await calmHer();
check(await p.evaluate(() => bb.player.fear === 0 && !document.getElementById('fearBar').classList.contains('hidden')), 'the fear bar is on the screen, empty');
await p.evaluate(() => { const m = bb.monster; m.active = true; m.state = 'chase'; m.ti = 'me'; m.x = bb.player.x; m.y = bb.player.y; m.screamT = 1e9; });   // (standing right there, screaming, not moving)
check(await until(p, () => bb.player.fear > 0.6, null, 60000), 'with her close and after you, fear rises', await p.evaluate(() => bb.player.fear));
await p.evaluate(() => { bb.player.fear = 1; halluT = 0.01; stealth.hallu = 0; });
check(await until(p, () => stealth.hallu > 0, null, 20000), 'very afraid: you hear things that aren\'t there');
check(await p.evaluate(() => fearK() === 1 && document.getElementById('fearBar').classList.contains('high')), 'the bar pulses red');
await p.evaluate(() => { bb.player.fear = 1; }); await p.waitForTimeout(600);
const sway = await p.evaluate(() => { bb.player.fear = 1; const r = []; for (let t = 0; t < 3; t += 0.5) { placeCamera(t); r.push(bb.camera.rotation.z); } return r; });
check(sway.some(z => Math.abs(z) > 0.005), 'the picture sways', sway);
check(await p.evaluate(() => { const a = bb.player.ang; bb.player.fear = 1; levelTime = 2; updatePlayer(0.05); return bb.player.ang !== a; }), 'and the view drifts (your hands shake)');
await p.screenshot({ path: OUT + '/fear.png' });
await p.evaluate(() => { settings.calm = true; });
const swayCalm = await p.evaluate(() => { bb.player.fear = 1; const r = []; for (let t = 0; t < 3; t += 0.5) { placeCamera(t); r.push(bb.camera.rotation.z); } return r; });
check(swayCalm.every(z => z === 0), '"Calm effects": no swaying', swayCalm);
await p.evaluate(() => { settings.calm = false; const m = bb.monster; m.active = false; m.spawnT = 1e9; m.screamT = 0; m.state = 'wander'; bb.player.fear = 0.5; });
check(await until(p, () => bb.player.fear < 0.45, null, 60000), 'safe again, it slowly goes back down');

console.log('== paintings');
await p.evaluate(() => { progress.done = [true]; });
let found = null;
for (let s = 0; s < 6 && !found; s++) {
  await p.evaluate(() => { bb.startFloor(1); bb.state = 'play'; });
  await calmHer();
  await until(p, () => bb.level && bb.level.grid === bb.grid && bb.level.paintings, null, 30000);
  found = await p.evaluate(() => { const P = bb.level.paintings.find(q => q.kind === 'watch'); if (!P) return null;
    return { n: bb.level.paintings.filter(q => q.kind === 'watch').length, c: bb.level.paintings.filter(q => q.kind === 'change').length }; });
}
check(!!found && found.n <= 6 && found.c <= 6, 'the Doll Hallway has portraits whose eyes follow you (and ones that change), a few of each', found);
if (found) {
  // stand in front of a watcher, to its left, then to its right: its eyes turn to follow
  const look = await p.evaluate(async () => {
    const P = bb.level.paintings.find(q => q.kind === 'watch'), n = new THREE.Vector3(0, 0, 1).applyQuaternion(P.mesh.quaternion), r = new THREE.Vector3(1, 0, 0).applyQuaternion(P.mesh.quaternion);
    const put = s => { bb.player.x = P.x + (n.x * 1.5 + r.x * s) / S; bb.player.y = P.y + (n.z * 1.5 + r.z * s) / S; bb.player.ang = Math.atan2(-n.z, -n.x); };
    const settle = () => new Promise(res => setTimeout(res, 2500));
    put(-0.9); await settle(); const left = P.eyes[0].rotation.y;
    put(0.9); await settle(); const right = P.eyes[0].rotation.y;
    return { left, right };
  });
  check(look.left < -0.1 && look.right > 0.1, 'its eyes follow you from one side to the other', look);
  await p.screenshot({ path: OUT + '/watcher.png' });
  const ch = {};
  const hasChanger = await p.evaluate(() => { const P = bb.level.paintings.find(q => q.kind === 'change'); if (!P) return false; window.__P = P; window.__before = P.mesh.material;
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(P.mesh.quaternion); window.__n = n;
    bb.player.x = P.x + n.x * 1.4 / S; bb.player.y = P.y + n.z * 1.4 / S; bb.player.ang = Math.atan2(-n.z, -n.x); return true; });
  if (hasChanger) {
    ch.seen = await until(p, () => __P.seen, null, 20000);
    await p.evaluate(() => { bb.player.ang += Math.PI; });
    ch.changed = await until(p, () => __P.changed && __P.mesh.material !== __before, null, 40000);
    await p.evaluate(() => { bb.player.ang -= Math.PI; });
    ch.noticed = await until(p, () => !__P.pending, null, 20000);
  }
  check(ch && ch.seen && ch.changed && ch.noticed, 'look at one, look away: when you look back, it\'s a different picture', ch);
}

console.log('== achievements');
await calmHer();
await p.evaluate(() => { bb.startFloor(0); bb.state = 'play'; const m = bb.monster; m.active = false; m.spawnT = 1e9; });
await p.evaluate(() => { bb.fuses.forEach((f, k) => bb.applyFuse(k)); const m = bb.monster; m.active = false; m.spawnT = 1e9; fstat.fearMax = 0; bb.player.x = bb.exit.x; bb.player.y = bb.exit.y; });
check(await until(p, () => bb.state === 'trans', null, 30000), 'escaping floor 1');
const got = await p.evaluate(() => Object.keys(achieved));
check(got.includes('first') && got.includes('nohide') && got.includes('unseen') && got.includes('calm'), 'escaping without hiding, unseen and calm earns those', got);
check(await p.evaluate(() => JSON.parse(localStorage.getItem('bb_ach')).first > 0), 'kept on the device');
await p.evaluate(() => { toTitle(); document.querySelector('nav [data-panel=ach]').click(); });
const list = await p.evaluate(() => ({ n: document.querySelectorAll('#achList li').length, got: document.querySelectorAll('#achList li.got').length, count: document.getElementById('achCount').textContent }));
check(list.n === 18 && list.got >= 5 && /of 18/.test(list.count) && /notes found: 1 of 20/.test(list.count), 'the menu lists all 18 (' + list.count + ')', list);
await p.screenshot({ path: OUT + '/achievements.png' });
await p.evaluate(() => closePanel());
await click(p, '#play');
check(await p.evaluate(() => /Torn notes found: 1 of 20/.test(document.getElementById('lvNotes').textContent) && /📜 1\/4/.test(document.querySelector('#lvList button[data-lv="0"]').textContent)),
  'the floor list shows the notes found: overall and per floor');
await p.evaluate(() => closePanel());
await p.evaluate(() => { unlock('phone'); unlock('phone'); });
check(await p.evaluate(() => Object.keys(achieved).filter(k => k === 'phone').length === 1), 'each one only once');

console.log('== the performance overlay');
await p.evaluate(() => closePanel());
await startSolo(p, 0);
await until(p, () => bb.state === 'play');
await calmHer();
await p.keyboard.press('F3');
check(await until(p, () => /fps/.test(document.getElementById('perf').textContent) && !document.getElementById('perf').classList.contains('hidden'), null, 20000), 'F3 shows frames per second, frame time, resolution and draw calls', await p.evaluate(() => document.getElementById('perf').textContent));
check(await p.evaluate(() => /draws/.test(document.getElementById('perf').textContent) && +document.getElementById('perf').textContent.match(/(\d+) draws/)[1] > 0), 'the draw calls are counted');
check(await p.evaluate(() => settings.perf === true && document.getElementById('setPerf').checked), 'the setting is on (and saved)');
await p.screenshot({ path: OUT + '/perf.png' });
await p.keyboard.press('F3');
check(await p.evaluate(() => document.getElementById('perf').classList.contains('hidden') && !settings.perf), 'F3 again hides it');

console.log('== the portrait puzzle: drag the pieces with the mouse');
await p.evaluate(() => { progress.done = [true]; bb.startFloor(1); bb.state = 'play'; const m = bb.monster; m.active = false; m.spawnT = 1e9; openPuzzle(0); });
check(await until(p, () => pzOpen && puzzles[pzOpen.k].kind === 'slide' && !document.getElementById('puzzle').classList.contains('hidden'), null, 20000), 'the portrait puzzle is open');
check(await p.evaluate(() => /Drag a piece/.test(document.getElementById('pzHelp').textContent)), 'it says to drag the pieces', await p.evaluate(() => document.getElementById('pzHelp').textContent));
// (screen position of a board point, and the piece next to the gap)
const geo = await p.evaluate(() => { const o = pzOpen, n = puzzles[o.k].data.n, cv = document.getElementById('pzBoard'), r = cv.getBoundingClientRect(),
  s = Math.min(cv.width, cv.height) * 0.9, cs = s / n, ox = (cv.width - s) / 2, oy = (cv.height - s) / 2, ex = o.empty % n, ey = o.empty / n | 0;
  const [cx, cy] = [[ex - 1, ey], [ex + 1, ey], [ex, ey - 1], [ex, ey + 1]].find(([x, y]) => x >= 0 && y >= 0 && x < n && y < n);
  const k = r.width / cv.width, at = (x, y) => [r.left + (ox + (x + 0.5) * cs) * k, r.top + (oy + (y + 0.5) * cs) * k];
  return { from: at(cx, cy), gap: at(ex, ey), j: cy * n + cx, e: o.empty, v: o.tiles[cy * n + cx] }; });
// a short pull: it springs back
await p.mouse.move(...geo.from); await p.mouse.down();
await p.mouse.move(geo.from[0] + (geo.gap[0] - geo.from[0]) * 0.25, geo.from[1] + (geo.gap[1] - geo.from[1]) * 0.25, { steps: 4 });
check(await p.evaluate(() => pzOpen.drag && pzOpen.drag.off > 0.1 && pzOpen.drag.off < 0.4), 'grabbing a piece next to the gap, it follows the mouse', await p.evaluate(() => pzOpen.drag && pzOpen.drag.off));
await p.mouse.up();
check(await p.evaluate(e => pzOpen.empty === e && !pzOpen.drag, geo.e), 'let go early: it springs back');
// pulled most of the way: it slides into the gap
await p.mouse.move(...geo.from); await p.mouse.down(); await p.mouse.move(...geo.gap, { steps: 6 }); await p.screenshot({ path: OUT + '/slide_drag.png' }); await p.mouse.up();
check(await p.evaluate(g => pzOpen.empty === g.j && pzOpen.tiles[g.e] === g.v, geo), 'dragged into the gap: the piece moves there', geo);
await p.evaluate(() => closePuzzle());

console.log('== a puzzle you leave stays as you left it');
await p.evaluate(() => { openPuzzle(0); });
const before = await p.evaluate(() => JSON.stringify(pzOpen.tiles));
await p.evaluate(() => closePuzzle());
check(await p.evaluate(() => !!puzzles[0].saved && JSON.stringify(puzzles[0].saved.tiles) !== JSON.stringify(puzzles[0].data.tiles)), 'closing the portrait half done keeps how far you got');
await p.evaluate(() => { openPuzzle(0); });
check(await p.evaluate(b => JSON.stringify(pzOpen.tiles) === b && /Carrying on/.test(document.getElementById('pzMsg').textContent), before), 'opening it again: every piece where you left it ("Carrying on where you left off")');
await p.evaluate(() => closePuzzle());
check(await p.evaluate(() => { const pz = puzzles[0], g = pz.cv.getContext('2d'); const a = g.getImageData(0, 0, pz.cv.width, pz.cv.height).data;
  const c = document.createElement('canvas'); c.width = pz.cv.width; c.height = pz.cv.height; KINDS.slide.draw(KINDS.slide.start(pz), pz, c);
  const b = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let diff = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) diff++; return diff > 100; }),
  'the box on the wall shows your progress too');
// the labyrinth (floor 1): the ball stays where it was; the music box (floor 4): you're back at the round you'd reached
await p.evaluate(() => { bb.startFloor(0); bb.state = 'play'; const m = bb.monster; m.active = false; m.spawnT = 1e9; openPuzzle(0); pzOpen.ball.x = 0.31; pzOpen.ball.y = 0.72; pzOpen.ball.vx = 0.5; closePuzzle(); openPuzzle(0); });
check(await p.evaluate(() => Math.abs(pzOpen.ball.x - 0.31) < 1e-9 && Math.abs(pzOpen.ball.y - 0.72) < 1e-9 && pzOpen.ball.vx === 0), 'the labyrinth ball is where you left it (and still)');
await p.evaluate(() => { closePuzzle(); progress.done = [true, true, true]; bb.startFloor(3); bb.state = 'play'; const m = bb.monster; m.active = false; m.spawnT = 1e9;
  openPuzzle(0); pzOpen.round = 3; pzOpen.phase = 'play'; pzOpen.i = 1; closePuzzle(); openPuzzle(0); });
check(await p.evaluate(() => puzzles[0].kind === 'simon' && pzOpen.round === 3 && pzOpen.phase === 'listen' && pzOpen.i === 0), 'the music box: back at round 3, and it plays the melody to you again');
await p.evaluate(() => { pzOpen.won = 0.001; closePuzzle(); });
check(await p.evaluate(() => puzzles[0].saved.round === 3), '(a solved one isn\'t saved over)');
await p.evaluate(() => closePuzzle());

console.log('== faces: every player their own');
await p.evaluate(() => loadPlayerTemplate());
check(await until(p, () => !!playerTemplate, null, 60000), '(the teammates\' model loaded)');
const faces = await p.evaluate(() => {
  const mk = id => PlayerModel.createHuman(THREE, { slot: 1, name: 'x', template: playerTemplate, mocap: mocapData, face: id });
  const ids = ['escape-barbi-blue-111111', 'escape-barbi-blue-111111-abcd1234', 'escape-barbi-blue-111111-zzzz9999', 'escape-barbi-blue-111111-q1w2e3r4'];
  const figs = ids.map(mk), again = mk(ids[1]), heads = figs.map(f => { let h; f.obj.traverse(o => { if (o.isMesh && o.name === 'Head') h = o; }); return h; });
  let tplHead; playerTemplate.traverse(o => { if (o.isMesh && o.name === 'Head') tplHead = o; });
  const key = f => JSON.stringify(f.face), px = h => { const c = h.material.map.image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 97) s = (s * 31 + d[i]) >>> 0; return s; };
  const out = { distinct: new Set(figs.map(key)).size, same: key(again) === key(figs[1]), samePaint: px(heads[1]) === px((() => { let h; again.obj.traverse(o => { if (o.isMesh && o.name === 'Head') h = o; }); return h; })()),
    notHers: heads.every(h => h.material.map !== tplHead.material.map && h.geometry !== tplHead.geometry), white: heads.every(h => h.material.color.getHex() === 0xffffff),
    moved: heads.map(h => { const a = h.geometry.attributes.position.array, b = tplHead.geometry.attributes.position.array; let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return +m.toFixed(4); }),
    glasses: figs.map(f => !!f.face.glasses) };
  figs.concat(again).forEach(f => f.dispose()); return out; });
check(faces.distinct === 4, 'four players: four different faces', faces);
check(faces.same && faces.samePaint, 'the same player id always gives the same face (shape and paint): everyone sees the same person');
check(faces.notHers && faces.white, 'none of them has her face any more (their own painted face and head shape)');
check(faces.moved.every(m => m > 0.002 && m < 0.03), 'the head shape changes (by a few millimetres to a couple of centimetres)', faces.moved);

console.log('== Settings → Controls: your own keys');
await p.evaluate(() => { toTitle(); document.querySelector('nav [data-panel=settings]').click(); });
await click(p, '#openKeys');
check(await p.evaluate(() => !document.querySelector('#panel section[data-panel=keys]').classList.contains('hidden') && document.querySelectorAll('#keyList li').length === KEY_ACTIONS.length),
  'Settings has "Change keys": a list of every action');
await click(p, '#keyList button[data-a="forward"][data-i="0"]');
check(await p.evaluate(() => /Press a key/.test(document.querySelector('#keyList button[data-a="forward"][data-i="0"]').textContent)), 'click one: "Press a key…"');
await p.keyboard.press('KeyI');
check(await p.evaluate(() => settings.keys.forward[0] === 'KeyI' && JSON.parse(localStorage.getItem('bb_settings')).keys.forward[0] === 'KeyI'), 'press I: walking forward is now I (saved)');
await click(p, '#keyList button[data-a="use"][data-i="0"]'); await p.keyboard.press('KeyQ');
check(await p.evaluate(() => settings.keys.use[0] === 'KeyQ' && !settings.keys.ping.includes('KeyQ') && /no longer does "Ping/.test(document.getElementById('keyMsg').textContent)),
  'giving Q (ping) to "use": ping loses it, and you\'re told', await p.evaluate(() => document.getElementById('keyMsg').textContent));
check(await p.evaluate(() => document.getElementById('hide').dataset.key === 'Q'), 'the key shown next to the HIDE button follows');
await click(p, '#keyList button[data-a="left"][data-i="1"]'); await p.keyboard.press('Escape');
check(await p.evaluate(() => settings.keys.left[1] === '' && !document.getElementById('panel').classList.contains('hidden')), 'Esc cancels (and doesn\'t close the menu)');
await p.screenshot({ path: OUT + '/controls.png' });
await click(p, '#panelBack');
check(await p.evaluate(() => !document.querySelector('#panel section[data-panel=settings]').classList.contains('hidden')), 'Back goes back to Settings');
await p.evaluate(() => closePanel());
await startSolo(p, 0); await until(p, () => bb.state === 'play');
await calmHer();
const y0 = await p.evaluate(() => { const pl = bb.player, tx = Math.floor(pl.x / T), ty = Math.floor(pl.y / T), d = DIRS.find(([dx, dy]) => !bb.isWall(tx + dx, ty + dy)); pl.ang = Math.atan2(d[1], d[0]); return [pl.x, pl.y]; });
await p.keyboard.down('KeyI'); await p.waitForTimeout(1500); await p.keyboard.up('KeyI');
const y1 = await p.evaluate(() => [bb.player.x, bb.player.y]);
check(Math.hypot(y1[0] - y0[0], y1[1] - y0[1]) > 5, 'in the game, I walks forward', { y0, y1 });
await p.evaluate(() => { const w = bb.player; window.__w = [w.x, w.y]; });
await p.keyboard.down('KeyW'); await p.waitForTimeout(1000); await p.keyboard.up('KeyW');
check(await p.evaluate(() => Math.hypot(bb.player.x - __w[0], bb.player.y - __w[1]) < 1), 'and W does nothing any more');
await p.evaluate(() => { toTitle(); document.querySelector('nav [data-panel=settings]').click(); });
await click(p, '#openKeys'); await click(p, '#keysReset');
check(await p.evaluate(() => settings.keys.forward[0] === 'KeyW' && settings.keys.use[0] === 'KeyE' && settings.keys.ping[0] === 'KeyQ' && document.getElementById('hide').dataset.key === 'E'), '"Default keys" puts everything back');
await p.evaluate(() => closePanel());

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary(); await b.close();
