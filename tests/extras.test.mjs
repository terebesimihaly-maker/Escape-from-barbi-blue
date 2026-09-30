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
  const bad = [];
  for (let i = 0; i < FLOORS.length; i++) for (const diff of ['easy', 'medium', 'hard']) for (let s = 0; s < 10; s++) {
    const d = generateFloor(i, 1, diff), rows = d.rows, wall = (x, y) => rows[y] === undefined || rows[y][x] !== '0';
    const taken = new Set([...d.closets.map(c => c[0] + ',' + c[1]), ...d.puzzles.map(z => z.cell.join()), d.exit.join(), ...d.notes.map(n => n[0] + ',' + n[1])]);
    if (!d.creaks.length) bad.push('floor ' + (i + 1) + ' has none');
    for (const [x, y, along] of d.creaks) {
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      if (wall(tx, ty)) bad.push('a board in a wall'); if (taken.has(tx + ',' + ty)) bad.push('a board on a wardrobe, puzzle, note or the door');
      if (tx <= 3 && ty <= 3) bad.push('a board at the start');
      // room to walk past: somewhere across the tile a player (radius 11) stands clear of the board
      const off = along ? x - (tx * T + T / 2) : y - (ty * T + T / 2); let lane = false;
      for (let a = -(T / 2 - 11); a <= T / 2 - 11; a++) if (Math.abs(a - off) >= BOARD_ACROSS) lane = true;
      if (!lane) bad.push('no room to step around a board');
    }
  }
  return [...new Set(bad)];
});
check(boards.length === 0, 'on every floor and difficulty: boards in the open, never on anything important, always with room to step around', boards);
await p.evaluate(() => { window.__boards = 0; const o = sfx.board; sfx.board = (...a) => { window.__boards++; return o(...a); }; });
const bd = await p.evaluate(() => {
  const b0 = creaks[0], m = bb.monster; m.active = true; m.spawnT = 0; m.state = 'wander'; m.x = b0.x + (b0.along ? 0 : 150); m.y = b0.y + (b0.along ? 150 : 0);
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
await p.evaluate(() => { bb.player.x += 60; updateBoards(); bb.player.x -= 60; bb.player.y = creaks[0].y; bb.player.x = creaks[0].x; updateBoards(); });
check(await p.evaluate(() => window.__boards === 2), 'step off and on again: it creaks again');
await p.screenshot({ path: OUT + '/board.png' });

console.log('== holding your breath');
await calmHer();
await p.evaluate(() => { const c = bb.closets[0]; bb.player.x = c.x + c.ox * 30; bb.player.y = c.y + c.oy * 30; });
await p.evaluate(() => { const c = bb.closets[0]; hideTarget = c; bb.toggleHide(); });
check(await until(p, () => bb.player.hidden && !document.getElementById('breath').classList.contains('hidden') && !document.getElementById('breathBar').classList.contains('hidden') && document.getElementById('run').classList.contains('hidden'), null, 10000),
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

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary(); await b.close();
