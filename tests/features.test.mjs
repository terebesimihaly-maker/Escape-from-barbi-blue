// Her hand-made sprint, her smarter searching, and the jump scares.
import { launch, solo, check, summary, until, click, OUT, pageErrors } from './lib.mjs';
const b = await launch();
const p = await solo(b, 'low', 640, 360);   // (the test browser draws on the CPU: keep it light, and give it time)
await click(p, '#play');
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
check(ahead.skip || ahead.a.x > ahead.from.x + 40, 'hunting by ear, she aims a couple of tiles ahead of you', ahead);
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
// the director: scares only when she isn't after you
await p.evaluate(() => { bb.scares.next = 0; const m = bb.monster, P = bb.player; m.active = true; m.spawnT = 0; m.state = 'chase'; m.x = P.x + 300; m.y = P.y; });
await p.waitForTimeout(3000);
check(await p.evaluate(() => !bb.scares.active), 'no scare while she is chasing you');
await calm();

check(pageErrors.length === 0, 'no errors on the page', pageErrors);
process.exitCode = summary(); await b.close();
