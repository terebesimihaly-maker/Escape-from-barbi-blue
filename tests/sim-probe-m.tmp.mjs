import { serve } from './server.mjs';
import { launch, solo, startSolo, until } from './lib.mjs';
let web = null; try { web = await serve(8766); } catch (e) {}
const b = await launch(); const p = await solo(b, 'low', 320, 200);
await startSolo(p, 0); await until(p, () => bb.state === 'play', null, 120000);
const r = await p.evaluate(() => {
  const out = {}; const run = (sec, cond) => { let t = 0; state = 'play'; while (t < sec && !cond()) { update(1 / 60); t += 1 / 60; if (state !== 'play') break; } const s = state; state = 'walk'; return [+t.toFixed(2), s]; };
  for (let seed = 1; seed <= 6; seed++) {
    const res = out[seed] = {};
    // features: she comes to the wardrobe you hide in
    startFloor(0); state = 'play'; notes.forEach(n => n.read = true); scares.next = 1e9;
    let c = closets[0], m = monster, P = player; P.x = c.x + c.ox * 10; P.y = c.y + c.oy * 10; hideTarget = c; sceneCool = 999; toggleHide();
    const far = CELLS.map(center).filter(q => Math.hypot(q.x - c.x, q.y - c.y) > T * 3 && Math.hypot(q.x - c.x, q.y - c.y) < T * 7)[0];
    Object.assign(m, { active: true, spawnT: 0, state: 'hunt', x: far.x, y: far.y, last: { x: c.x + c.ox * 16, y: c.y + c.oy * 16 }, dir: null, ti: 'me', huntT: 0, screamT: 0, path: [], repath: 0, checked: new Set(), plan: [] });
    res.check = run(120, () => m.state === 'check' && m.checking === 0).concat(m.state, Math.round(Math.hypot(m.x - m.last.x, m.y - m.last.y)));
    // extras: the gasp
    startFloor(0); state = 'play'; notes.forEach(n => n.read = true); scares.next = 1e9; m.active = false; m.spawnT = 1e9;
    c = closets[0]; P.x = c.x + c.ox * 30; P.y = c.y + c.oy * 30; hideTarget = c; toggleHide(); DIFFS.medium.breath = 3; keys.Space = true;
    Object.assign(m, { active: true, spawnT: 0, state: 'lurk', fakeT: 1e9, fakeFor: null, quiet: 0, x: c.x + c.ox * 55, y: c.y + c.oy * 55, bh: {}, huntT: 0 }); huntTimer = 1e9;
    res.gasp = run(40, () => stealth.gasps >= 1).concat(stealth.gasps, P.holding, P.breath);
    keys.Space = false; DIFFS.medium.breath = 7;
    // extras: the fake leave
    startFloor(0); state = 'play'; notes.forEach(n => n.read = true); scares.next = 1e9; m.active = false; m.spawnT = 1e9;
    c = closets[0]; P.x = c.x + c.ox * 30; P.y = c.y + c.oy * 30; DIFFS.medium.fake = 1; hideTarget = c; toggleHide(); P.holding = true; keys.Space = true; DIFFS.medium.breath = 1e9;
    Object.assign(m, { active: true, spawnT: 0, state: 'search', searchT: 0.01, plan: [], target: null, fakeCool: 0, x: c.x + c.ox * 60, y: c.y + c.oy * 60 }); m.last = { x: m.x, y: m.y }; huntTimer = 1e9;
    res.leave = run(20, () => m.state === 'leave').concat(m.state);
    res.quiet = run(30, () => m.quiet > 0.5).concat(m.quiet);
    res.lurk = run(40, () => m.state === 'lurk').concat(m.state);
    keys.Space = false; DIFFS.medium.fake = 0.5; DIFFS.medium.breath = 7;
  }
  return out;
});
console.log(JSON.stringify(r, null, 0));
await b.close(); if (web) web.close();
