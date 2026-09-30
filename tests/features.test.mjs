// Her hand-made sprint, her smarter searching, and the jump scares.
import { launch, solo, check, summary, until, click, OUT, pageErrors, startSolo } from './lib.mjs';
const b = await launch();
const p = await solo(b, 'low', 640, 360);   // (the test browser draws on the CPU: keep it light, and give it time)
await startSolo(p);
check(await until(p, () => bb.state === 'play'), 'the game starts');
const calm = () => p.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; m.state = 'wander'; });
await calm();

console.log('== her sprint (hand-made)');
check(await p.evaluate(() => !bb.barbi.anim.defs.chase.mocap && !bb.barbi.anim.defs.run.mocap), 'chase and hunt use the hand-made sprint, not motion capture');
// (she "knows where you are" for a while, like after her scream, so she runs at you whether or not she can see you)
await p.evaluate(() => { const m = bb.monster, P = bb.player, far = bb.CELLS().map(bb.center).sort((a, c) => Math.hypot(c.x - P.x, c.y - P.y) - Math.hypot(a.x - P.x, a.y - P.y))[0];
  Object.assign(m, { active: true, spawnT: 0, state: 'hunt', x: far.x, y: far.y, huntT: 30, screamT: 0, path: [], repath: 0 }); });
check(await until(p, () => bb.barbi.anim.current === 'chase' || bb.barbi.anim.current === 'run', null, 20000), 'she plays it while chasing', await p.evaluate(() => bb.barbi.anim.current));
await calm();

console.log('== smarter searching');
// where she looks first: the way you were going
const plan = await p.evaluate(() => {
  const m = bb.monster, c = bb.CELLS().map(bb.center);
  // a spot with a long corridor to the east or west
  let best = null;
  for (const q of bb.CELLS()) { let n = 0; while (!bb.isWall(q[0] + n + 1, q[1])) n++; if (n >= 4 && (!best || n > best[2])) best = [q[0], q[1], n]; }
  if (!best) return { skip: true };
  m.last = bb.center(best); m.dir = { x: 1, y: 0 }; m.checked = new Set(); planSearch(m);
  const first = m.plan[0];
  return { first: first && first.at, from: m.last, closets: m.plan.filter(s => s.closet !== undefined).length };
});
check(plan.skip || (plan.first && plan.first.x > plan.from.x), 'she first heads the way you were going', plan);
// cutting you off: when she only hears you, she runs ahead of where you are
const ahead = await p.evaluate(() => { let best = null;
  for (const q of bb.CELLS()) { let n = 0; while (!bb.isWall(q[0] + n + 1, q[1])) n++; if (n >= 3) { best = q; break; } }
  if (!best) return { skip: true };
  const from = bb.center(best), a = aheadOf(from, 1, 0, 2); return { from, a }; });
check(ahead.skip || ahead.a.x > ahead.from.x + 50, 'hunting by ear, she aims a couple of tiles ahead of you', ahead);
// the wardrobes: you hide in one right where she lost you; she comes to check it
await p.evaluate(() => { const c = bb.closets[0], P = bb.player; P.x = c.x + c.ox * 10; P.y = c.y + c.oy * 10; });
await until(p, () => !!document.querySelector('#hide:not(.hidden)'), null, 32000);
await p.evaluate(() => { bb.sceneCool = 999; bb.toggleHide(); });
check(await p.evaluate(() => bb.player.hidden), 'hidden in a wardrobe');
const idx = await p.evaluate(() => { const c = bb.closets[0], m = bb.monster;
  const far = bb.CELLS().map(bb.center).filter(q => Math.hypot(q.x - c.x, q.y - c.y) > bb.T * 3 && Math.hypot(q.x - c.x, q.y - c.y) < bb.T * 7)[0];
  Object.assign(m, { active: true, spawnT: 0, state: 'hunt', x: far.x, y: far.y, last: { x: c.x + c.ox * 16, y: c.y + c.oy * 16 }, dir: null, ti: 'me', huntT: 0, screamT: 0, path: [], repath: 0, checked: new Set(), plan: [] });
  return 0; });
const checking = await until(p, i => bb.monster.state === 'check' && bb.monster.checking === i || bb.state === 'dead', idx, 120000);
check(checking, 'she comes to the wardrobe you hid in and stops at its doors to listen', await p.evaluate(() => [bb.monster.state, bb.monster.plan.length]));
check(await p.evaluate(() => bb.barbi.anim.current === 'peek' || bb.state === 'dead'), 'she leans in at the doors while she listens (peek)', await p.evaluate(() => bb.barbi.anim.current));
await p.screenshot({ path: OUT + '/search_check.png' });
const after = await until(p, () => bb.state === 'dead' || (bb.monster.state !== 'check' && bb.monster.checked.has(0)), null, 40000);
check(after, 'then she either opens it (30%) or moves on, and does not check it again', await p.evaluate(() => [bb.state, bb.monster.state]));
if (await p.evaluate(() => bb.state === 'dead')) { console.log('  (she opened it this time)'); await until(p, () => !document.getElementById('dead').classList.contains('hidden'), null, 240000); await click(p, '#retry'); await until(p, () => bb.state === 'play'); }
else await p.evaluate(() => bb.toggleHide());
await calm();

console.log('== jump scares');
// the phantom: stand at the start of the longest straight corridor, looking down it
const spot = await p.evaluate(() => {
  let best = null;
  for (const q of bb.CELLS()) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { let n = 0; while (n < 12 && !bb.isWall(q[0] + dx * (n + 1), q[1] + dy * (n + 1))) n++; if (!best || n > best[4]) best = [q[0], q[1], dx, dy, n]; }
  return best; });
await p.evaluate(s => { const P = bb.player; P.x = (s[0] + 0.5) * bb.T; P.y = (s[1] + 0.5) * bb.T; P.ang = Math.atan2(s[3], s[2]); P.pitch = 0; }, spot);
await p.waitForTimeout(400);
check(await p.evaluate(() => bb.scares.force('phantom')), 'the phantom can appear down a long corridor', spot);
check(await until(p, () => !!bb.scares.phantom && bb.barbi.obj.visible, null, 8000), 'she is standing at the far end');
await p.screenshot({ path: OUT + '/scare_phantom.png' });
check(await until(p, () => !bb.scares.phantom, null, 20000), 'looking at her: she is gone');
check(await p.evaluate(() => !bb.barbi.obj.visible), 'and not drawn any more (the real her is not around)');

// the doll (the nursery has dolls)
const dollSpot = await p.evaluate(() => {
  const ds = bb.level.house.dolls.filter(d => d.obj.visible);
  for (const d of ds) { const x = d.obj.position.x / 0.045, y = d.obj.position.z / 0.045;
    for (const k of [120, 100, 80]) for (let a = 0; a < 6.28; a += 0.2) { const px = x + Math.cos(a) * k, py = y + Math.sin(a) * k;
      if (!bb.isWall(Math.floor(px / bb.T), Math.floor(py / bb.T)) && bb.los(px, py, x, y)) {
        const bx = px + (px - x) / k * 66, by = py + (py - y) / k * 66;      // (room behind you, so the doll can move there)
        if (!bb.isWall(Math.floor(bx / bb.T), Math.floor(by / bb.T)) && bb.los(px, py, bx, by)) return { px, py, x, y }; } } }
  return null; });
if (!dollSpot) console.log('  (no doll with room around it on this floor, skipping the doll)');
else {
  await p.evaluate(s => { const P = bb.player; P.x = s.px; P.y = s.py; P.ang = Math.atan2(s.y - s.py, s.x - s.px); P.pitch = -0.25; }, dollSpot);
  await p.waitForTimeout(400);
  check(await p.evaluate(() => bb.scares.force('doll')), 'the doll scare starts while you look at a doll');
  await p.evaluate(() => { bb.player.ang += Math.PI; });        // look away...
  check(await until(p, () => bb.scares.doll && bb.scares.doll.phase !== 'watch', null, 16000), 'looking away: the doll moves', await p.evaluate(() => bb.scares.doll && bb.scares.doll.phase));
  await p.evaluate(() => { bb.player.ang += Math.PI; });        // ...and back
  check(await until(p, () => !bb.scares.doll || bb.scares.doll.found || !bb.scares.active, null, 16000), 'looking back: it is right there, closer (or gone)');
  await p.screenshot({ path: OUT + '/scare_doll.png' });
  await p.evaluate(() => { bb.player.ang += Math.PI; });
  check(await until(p, () => !bb.scares.active, null, 64000), 'then it is gone for good');
}
// footsteps above
check(await p.evaluate(() => bb.scares.force('ceiling')), 'footsteps on the ceiling start');
check(await until(p, () => bb.scares.dust && bb.scares.dust.visible, null, 24000), 'dust comes down from the ceiling when they pass over you');
check(await until(p, () => !bb.scares.active, null, 48000), 'they end (something is dragged away)');
// the new ones: the lights die (and she's there), she dashes past, breathing behind you, a wardrobe door
check(await p.evaluate(() => bb.scares.force('breath')), 'breathing behind you starts');
check(await until(p, () => !bb.scares.active, null, 40000), '...and ends');
await p.evaluate(s => { const P = bb.player; P.x = (s[0] + 0.5) * bb.T; P.y = (s[1] + 0.5) * bb.T; P.ang = Math.atan2(s[3], s[2]); }, spot);
await p.waitForTimeout(500);
if (await p.evaluate(() => bb.scares.force('dark'))) {
  check(await until(p, () => bb.scares.dim < 0.2, null, 8000), 'the lights die');
  check(await until(p, () => bb.scares.app && bb.scares.app.show && bb.barbi.obj.visible, null, 20000), 'the lights come back: she is right in front of you');
  await p.screenshot({ path: OUT + '/scare_dark.png' });
  check(await until(p, () => !bb.scares.active && bb.scares.dim === 1 && !bb.barbi.obj.visible, null, 20000), 'dark again, then light, and she is gone');
} else console.log('  (no room in front for the lights-out scare here)');
const door = await p.evaluate(() => { const c = bb.closets.find(c => c.doors); if (!c) return false; const P = bb.player;
  P.x = c.x + c.ox * bb.T * 1.5; P.y = c.y + c.oy * bb.T * 1.5; P.ang = Math.atan2(-c.oy, -c.ox); P.pitch = 0; return true; });
if (door) { await p.waitForTimeout(800);
  if (await p.evaluate(() => bb.scares.force('door'))) {
    check(await until(p, () => bb.closets.some(c => c.doors && Math.abs(c.doors.find(d => d.side < 0).pivot.rotation.y) > 0.3), null, 20000), 'a wardrobe door creaks open by itself');
    check(await until(p, () => !bb.scares.active, null, 30000), '...and slams shut');
  } else console.log('  (no wardrobe in view for the door scare)'); }
// the director: scares only when she isn't after you
await p.evaluate(() => { const m = bb.monster, P = bb.player, far = bb.CELLS().map(bb.center).sort((a, c) => Math.hypot(c.x - P.x, c.y - P.y) - Math.hypot(a.x - P.x, a.y - P.y))[0];
  bb.scares.next = 0; Object.assign(m, { active: true, spawnT: 0, state: 'hunt', x: far.x, y: far.y, huntT: 30, screamT: 0, path: [], repath: 0 }); });
await p.waitForTimeout(3000);
const during = await p.evaluate(() => [bb.monster.state, bb.scares.active]);
check((during[0] === 'hunt' || during[0] === 'chase') && !during[1], 'no scare while she is after you', during);
await calm();

console.log('== settings');
const fov0 = await p.evaluate(() => bb.camera.fov);
await p.evaluate(() => { const r = document.getElementById('setFov'); r.value = 100; r.dispatchEvent(new Event('input')); });
check(await p.evaluate(f => bb.camera.fov > f + 5, fov0), 'a wider field of view widens the camera', await p.evaluate(() => bb.camera.fov));
await p.evaluate(() => { const r = document.getElementById('setFov'); r.value = 80; r.dispatchEvent(new Event('input')); });
const pitch = await p.evaluate(() => { const c = document.getElementById('setInvert'); c.checked = true; c.dispatchEvent(new Event('change'));
  const P = bb.player; P.pitch = 0; lookBy(0, 0.1); const inv = P.pitch; c.checked = false; c.dispatchEvent(new Event('change')); P.pitch = 0; lookBy(0, 0.1); return [inv, P.pitch]; });
check(pitch[0] > 0 && pitch[1] < 0, 'invert flips looking up and down', pitch);
await p.evaluate(() => { const c = document.getElementById('setCalm'); c.checked = true; c.dispatchEvent(new Event('change')); });
check(await p.evaluate(() => JSON.parse(localStorage.getItem('bb_settings')).calm === true), 'calm effects is saved');
await p.evaluate(() => { const c = document.getElementById('setCalm'); c.checked = false; c.dispatchEvent(new Event('change')); });

console.log('== 3D sound');
// count the 3D sound sources made while she walks around near you
const sound = await p.evaluate(async () => {
  if (!bb.acState) return { skip: 'no audio' };
  const proto = Object.getPrototypeOf(bb.audio()), orig = proto.createPanner; let n = 0; proto.createPanner = function () { n++; return orig.call(this); };
  const m = bb.monster, P = bb.player, c = bb.CELLS().map(bb.center).filter(q => Math.hypot(q.x - P.x, q.y - P.y) < bb.T * 5)[0] || P;
  Object.assign(m, { active: true, spawnT: 0, state: 'wander', x: c.x, y: c.y, target: null, path: [] });
  await new Promise(r => setTimeout(r, 6000));
  proto.createPanner = orig; m.active = false; m.spawnT = 1e9;
  return { panners: n, ac: bb.acState };
});
check(sound.skip || sound.panners > 0, 'her footsteps come from where she is (3D sound sources are made)', sound);

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary(); await b.close();
