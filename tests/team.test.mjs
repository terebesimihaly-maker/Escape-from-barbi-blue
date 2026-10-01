// Playing together: the 90-second down time, pings, emotes, spectating and warning the others, loose boards and gasps
// heard by the host's her, her fading out for everyone, achievements for the team, and the ping in the performance overlay.
import { launch, player, check, summary, until, openMp, click, fill, text, pageErrors, OUT } from './lib.mjs';
const b = await launch();
const A = await player(b, 'Anna'), B = await player(b, 'Ben');
console.log('== a game for two');
await openMp(A); await click(A, '#mpCreate');
await until(A, () => !document.getElementById('lobby').classList.contains('hidden'));
const code = (await text(A, 'lbCode')).replace(/\s/g, '');
await openMp(B); await fill(B, '#mpCode', code); await click(B, '#mpJoin');
check(await until(B, () => !document.getElementById('lobby').classList.contains('hidden')), 'Ben joined');
await click(A, '#lbReady'); await click(B, '#lbReady');
check((await Promise.all([A, B].map(P => until(P, () => bb.state === 'play' && bb.MP.inGame, null, 30000)))).every(Boolean), 'the game started for both');
await A.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; huntTimer = 1e9; });
const benId = await B.evaluate(() => bb.MP.myId), annaId = await A.evaluate(() => bb.MP.myId);
check((await Promise.all([A, B].map(P => until(P, () => !document.getElementById('pingBtn').classList.contains('hidden') && !document.getElementById('emoteBtn').classList.contains('hidden'), null, 10000)))).every(Boolean),
  'both have the ping and emote buttons');

console.log('== pings');
await B.evaluate(() => { const p = bb.player, tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);    // (look down an open way)
  const d = DIRS.find(([dx, dy]) => !bb.isWall(tx + dx, ty + dy)); p.ang = Math.atan2(d[1], d[0]); });
await B.keyboard.press('KeyQ');
check(await until(A, id => team.pings.some(q => q.by === id && q.k === 'go' && q.name === 'Ben'), benId, 15000), 'Ben presses Q: Anna sees his ping ("Here", with his name)');
check(await until(B, () => team.pings.some(q => q.name === 'You'), null, 10000), 'Ben sees it too, as "You"');
const pg = await A.evaluate(id => { const q = team.pings.find(q => q.by === id); return { x: q.x, y: q.y, wall: bb.isWall(Math.floor(q.x / T), Math.floor(q.y / T)) }; }, benId);
check(!pg.wall, 'it marks the floor where he was looking, not inside a wall', pg);
await A.screenshot({ path: OUT + '/ping.png' });
// looking right at her: "She's here!"
await A.evaluate(() => { const m = bb.monster; m.active = true; m.state = 'lurk'; m.fakeT = 1e9; m.fakeFor = null; m.screamT = 1e9; });
await B.waitForTimeout(700);
await B.evaluate(() => { const p = bb.player, tx = Math.floor(p.x / T), ty = Math.floor(p.y / T), d = DIRS.find(([dx, dy]) => !bb.isWall(tx + dx, ty + dy));
  window.__herAt = [(tx + d[0]) * T + T / 2, (ty + d[1]) * T + T / 2]; p.ang = Math.atan2(d[1], d[0]); });
const herAt = await B.evaluate(() => window.__herAt);
await A.evaluate(([x, y]) => { const m = bb.monster; m.x = x; m.y = y; }, herAt);
check(await until(B, ([x, y]) => Math.hypot(bb.monster.x - x, bb.monster.y - y) < 5 && bb.monster.active, herAt, 10000), '(she stands right in front of Ben)');
await B.evaluate(([x, y]) => { bb.player.ang = Math.atan2(y - bb.player.y, x - bb.player.x); }, herAt);
await B.waitForTimeout(700);
await B.keyboard.press('KeyQ');
check(await until(A, id => team.pings.some(q => q.by === id && q.k === 'her'), benId, 15000), 'pinging her: "She\'s here!" for Anna', await A.evaluate(() => team.pings));
check(await until(A, () => /Ben: She's here!/.test(document.getElementById('msg').textContent), null, 5000), 'and a message: "Ben: She\'s here!"');
check(await A.evaluate(id => team.pings.filter(q => q.by === id).length === 1, benId), 'one ping each: the new one replaced his first');
await A.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; m.screamT = 0; m.state = 'wander'; });

console.log('== the dance wheel');
await B.keyboard.down('KeyR');
check(await until(B, () => !document.getElementById('emoteRing').classList.contains('hidden') && document.querySelectorAll('#emoteRing .seg').length === 8, null, 10000),
  'Ben holds R: the wheel with eight dances opens');
await B.evaluate(() => wheelMove(70, 40));                                // (the mouse, pointing down and to the right)
check(await B.evaluate(() => wheel.sel === 3 && document.querySelector('#emoteRing .seg.on').textContent.includes('Chicken') && /Chicken/.test(document.getElementById('emoteHub').textContent)),
  'pointing with the mouse picks "Chicken" (highlighted)', await B.evaluate(() => wheel.sel));
const lookBefore = await B.evaluate(() => bb.player.ang);
await B.screenshot({ path: OUT + '/dance_wheel.png' });
await B.keyboard.up('KeyR');
check(await B.evaluate(a => document.getElementById('emoteRing').classList.contains('hidden') && Math.abs(bb.player.ang - a) < 0.01 && bb.player.dance === 3, lookBefore),
  'letting go of R: the wheel closes (pointing didn\'t turn his view) and Ben dances');
check(await until(A, id => bb.MP.others.get(id).dance === 3 && bb.MP.others.get(id).av.anim.current === 'd_chicken', benId, 15000), 'Anna sees Ben\'s figure do the chicken dance');
check(await until(B, () => { const p = bb.player, c = bb.camera.position; return Math.hypot(c.x - p.x * S, c.z - p.y * S) > 1.2 && bb.MP.meAv && bb.MP.meAv.anim.current === 'd_chicken'; }, null, 15000),
  'Ben\'s camera pulls back and he sees himself dancing', await B.evaluate(() => { const p = bb.player, c = bb.camera.position; return Math.hypot(c.x - p.x * S, c.z - p.y * S); }));
await B.waitForTimeout(1500);
await A.screenshot({ path: OUT + '/dance_seen.png' }); await B.screenshot({ path: OUT + '/dance_self.png' });
await B.keyboard.down('KeyW'); await B.waitForTimeout(800); await B.keyboard.up('KeyW');
check(await until(B, () => bb.player.dance === -1, null, 10000), 'walking stops the dance');
check(await until(A, id => bb.MP.others.get(id).dance === -1, benId, 15000), 'for Anna too');
check(await until(B, () => { const p = bb.player, c = bb.camera.position; return Math.hypot(c.x - p.x * S, c.z - p.y * S) < 0.2; }, null, 15000), 'and Ben\'s camera is back in his eyes');
await A.evaluate(() => { document.getElementById('emoteBtn').dispatchEvent(new PointerEvent('pointerdown')); });
check(await A.evaluate(() => !document.getElementById('emoteRing').classList.contains('hidden')), 'on a touch screen, the dance button opens the wheel');
await A.evaluate(() => { document.querySelectorAll('#emoteRing .seg')[7].dispatchEvent(new PointerEvent('pointerdown')); });
check(await until(B, id => bb.MP.others.get(id).dance === 7 && bb.MP.others.get(id).av.anim.current === 'd_hype', annaId, 15000), 'Anna taps "Hype": Ben sees her jumping');
check(await A.evaluate(() => document.getElementById('emoteRing').classList.contains('hidden')), 'and the wheel closes');
await A.evaluate(() => stopDance());
console.log('== faces');
const fa = await A.evaluate(id => JSON.stringify(bb.MP.others.get(id).av.face), benId), fb = await B.evaluate(() => JSON.stringify(bb.MP.meAv.face));
check(fa === fb, 'Anna sees Ben with exactly the face Ben sees on his own figure');
check(await A.evaluate(id => JSON.stringify(bb.MP.others.get(id).av.face) !== JSON.stringify(bb.MP.meAv.face), benId), 'and Anna\'s face is a different one');


console.log('== holding breath, gasps and loose boards, for the host\'s her');
await B.evaluate(() => { const c = bb.closets.find(c => !bb.allPlayers().some(q => q.hidden)); hideTarget = c; bb.toggleHide(); keys.Space = true; });
check(await until(A, id => bb.MP.others.get(id).holding, benId, 15000), 'Anna\'s game knows Ben is holding his breath');
await B.evaluate(() => { keys.Space = false; });
check(await until(A, id => !bb.MP.others.get(id).holding, benId, 15000), '...and when he lets go');
await A.evaluate(id => { const o = bb.MP.others.get(id), m = bb.monster; m.active = true; m.spawnT = 0; m.state = 'lurk'; m.fakeT = 1e9; m.fakeFor = null; m.screamT = 0;
  const c = bb.closets[o.closet]; m.x = c.x + c.ox * 70; m.y = c.y + c.oy * 70; m.kc = null; m.bh = {}; m.quiet = 0; }, benId);
await B.evaluate(() => { bb.player.gasping = false; gasp(); });
check(await until(A, id => bb.monster.kc === id && bb.monster.kcWhy === 'gasp', benId, 15000), 'Ben gasps: the host\'s her heard it and knows his wardrobe');
await A.evaluate(() => { const m = bb.monster; m.kc = null; m.active = false; m.spawnT = 1e9; m.state = 'wander'; });
await B.evaluate(() => exitHide());
await A.evaluate(() => { window.__boards = 0; const o = sfx.board; sfx.board = (...a) => { window.__boards++; return o(...a); }; });
const bk = await B.evaluate(() => { const b0 = creaks[0]; bb.player.x = b0.x; bb.player.y = b0.y; return 0; });
await A.evaluate(() => { const m = bb.monster, b0 = creaks[0]; m.active = true; m.spawnT = 0; m.state = 'wander'; m.x = b0.x; m.y = b0.y; m.screamT = 0; m.last = null; m.target = null; });
await A.evaluate(() => { const b0 = creaks[0], tx = Math.floor(b0.x / T), ty = Math.floor(b0.y / T), d = DIRS.find(([dx, dy]) => !bb.isWall(tx + dx * 3, ty + dy * 3) && !bb.isWall(tx + dx, ty + dy) && !bb.isWall(tx + dx * 2, ty + dy * 2)) || [1, 0];
  const m = bb.monster; m.x = (tx + d[0] * 2) * T + T / 2; m.y = (ty + d[1] * 2) * T + T / 2; });
// (he walks up to it, then onto it: the host checks he was really there)
await B.evaluate(() => { const b0 = creaks[0]; if (b0.along) bb.player.y = b0.y + 30; else bb.player.x = b0.x + 30; updateBoards(); });
await B.waitForTimeout(1500);
await B.evaluate(() => { const b0 = creaks[0]; bb.player.x = b0.x; bb.player.y = b0.y; updateBoards(); });
check(await until(A, () => window.__boards >= 1, null, 15000), 'Ben steps on a loose board: Anna hears it creak');
check(await until(A, id => bb.monster.ti === id && (bb.monster.state === 'hunt' || bb.monster.state === 'chase'), benId, 10000), 'and the host\'s her comes for Ben', await A.evaluate(() => [bb.monster.state, bb.monster.ti]));
await A.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; m.state = 'wander'; });

console.log('== she fades out for everyone');
await A.evaluate(() => { const m = bb.monster; m.active = true; m.state = 'lurk'; m.quiet = 1; m.fakeT = 1e9; m.fakeFor = null; m.x = bb.exit.x; m.y = bb.exit.y; });
check(await until(B, () => bb.monster.quiet > 0.5, null, 15000), 'while she only pretends to be gone, she\'s silent on Ben\'s side too', await B.evaluate(() => bb.monster.quiet));
await A.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; m.state = 'wander'; m.quiet = 0; });

console.log('== the ping in the performance overlay');
check(await until(B, () => bb.MP.rtt > 0, null, 20000), 'Ben\'s game measures his ping to the host: ' + Math.round(await B.evaluate(() => bb.MP.rtt || 0)) + ' ms');
await A.evaluate(() => setPerf(true)); await B.evaluate(() => setPerf(true));
check(await until(A, () => /host · Ben \d+ ms/.test(document.getElementById('perf').textContent), null, 20000), 'Anna (the host) sees everyone\'s ping', await text(A, 'perf'));
check(await until(B, () => /ping \d+ ms/.test(document.getElementById('perf').textContent), null, 20000), 'Ben sees his', await text(B, 'perf'));
await A.evaluate(() => setPerf(false)); await B.evaluate(() => setPerf(false));

console.log('== down for 90 seconds, a revive');
await A.evaluate(id => bb.downPlayer(bb.allPlayers().find(q => q.id === id), 'test'), benId);
check(await until(B, () => bb.player.down, null, 15000), 'Ben is down');
const dl = await B.evaluate(() => bb.player.downLeft);
check(dl > 85 && dl <= 90, 'with 90 seconds (1:30) to be revived', dl);
check(await until(A, () => /within 90 seconds/.test(document.getElementById('msg').textContent), null, 5000), 'Anna is told: "Revive them within 90 seconds"', await text(A, 'msg'));
await A.evaluate(id => { const o = bb.MP.others.get(id); bb.player.x = o.x; bb.player.y = o.y; }, benId);    // (Anna goes to him)
await A.waitForTimeout(500);
await A.evaluate(id => { hostRevive(bb.MP.myId, id); }, benId);
check(await until(A, () => !!achieved.angel, null, 15000), 'Anna revives him: "Guardian angel"');

console.log('== escaping together');
await A.evaluate(() => { bb.fuses.forEach((f, k) => { if (!f.got) bb.hostEmit({ t: 'fuseGot', k, by: bb.MP.myId }); }); bb.player.x = bb.exit.x; bb.player.y = bb.exit.y; });
check((await Promise.all([A, B].map(P => until(P, () => bb.state === 'trans', null, 30000)))).every(Boolean), 'both out of the Nursery');
check((await Promise.all([A, B].map(P => P.evaluate(() => !!achieved.team && !!achieved.first)))).every(Boolean), 'nobody lost: "Nobody left behind" for both');
check((await Promise.all([A, B].map(P => until(P, () => bb.state === 'play' && bb.floorIdx === 1, null, 30000)))).every(Boolean), 'on to floor 2');
await A.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; huntTimer = 1e9; });

console.log('== out of the game: watching, and warning the others');
await A.evaluate(id => bb.downPlayer(bb.allPlayers().find(q => q.id === id), 'test'), benId);
await until(B, () => bb.player.down, null, 15000);
await A.evaluate(id => { bb.MP.others.get(id).downLeft = 0.01; }, benId);
check(await until(B, () => bb.player.dead, null, 15000), 'Ben didn\'t make it');
check(await until(B, () => /Watching Anna/.test(document.getElementById('downMsg').textContent) && /G: show them where she is/.test(document.getElementById('downMsg').textContent), null, 15000),
  'he watches Anna, and is told he can warn her', await text(B, 'downMsg'));
check(await B.evaluate(() => !document.getElementById('warnBtn').classList.contains('hidden') && document.getElementById('pingBtn').classList.contains('hidden')), 'the WARN button replaces the ping');
await B.waitForTimeout(1500);
const cam1 = await B.evaluate(() => [bb.camera.position.x, bb.camera.position.z]);
const annaPos = await A.evaluate(() => [bb.player.x * S, bb.player.y * S]);
check(Math.hypot(cam1[0] - annaPos[0], cam1[1] - annaPos[1]) < 3, 'his camera follows Anna', { cam1, annaPos });
await B.keyboard.press('ArrowRight');
check(await B.evaluate(() => bb.MP.spec === 1 && watched() && watched().name === 'Anna'), '← → switch who he watches (with one teammate left, still Anna)');
await B.keyboard.press('KeyG');
check(await until(B, () => /She isn't anywhere/.test(document.getElementById('msg').textContent), null, 5000), 'while she isn\'t in the house, there\'s nothing to show');
await A.evaluate(() => { const m = bb.monster; m.active = true; m.state = 'lurk'; m.fakeT = 1e9; m.fakeFor = null; m.screamT = 1e9; const c = center(CELLS[CELLS.length - 1]); m.x = c.x; m.y = c.y; });
// (Ben's game has to know she's in the house first: until then his G truthfully says she isn't anywhere)
await until(B, () => bb.monster.active, null, 30000);
await B.keyboard.press('KeyG');
check(await until(A, id => team.pings.some(q => q.by === id && q.k === 'ghost'), benId, 15000), 'G: Anna sees where she is ("👻 She\'s here", from Ben\'s ghost)');
const gp = await A.evaluate(id => { const q = team.pings.find(q => q.by === id), m = bb.monster; return Math.hypot(q.x - m.x, q.y - m.y); }, benId);
check(gp < 5, 'right where she is', gp);
check(await until(B, () => !!achieved.ghost, null, 10000), '"From beyond" for Ben');
check(await B.evaluate(() => WARN_COOL === 30 && team.warnCool > 0 && team.warnCool <= 30 && document.getElementById('warnBtn').disabled), 'then the button waits 30 seconds',
  await B.evaluate(() => team.warnCool));   // (counting down: how far, depends on how fast this machine draws)
await A.evaluate(() => { team.pings = []; });
await B.evaluate(() => { team.warnCool = 0; warnTeam(); });          // (his own game let him: the host still says no)
await A.waitForTimeout(2000);
check(await A.evaluate(id => !team.pings.some(q => q.by === id), benId), 'and the host won\'t pass on another one sooner');
await A.screenshot({ path: OUT + '/ghost_ping.png' }); await B.screenshot({ path: OUT + '/spectate.png' });
await A.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; m.screamT = 0; });

check(pageErrors.length === 0, 'no errors on the pages', pageErrors);
process.exitCode = summary(); await b.close();
