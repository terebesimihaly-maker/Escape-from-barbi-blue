// Rejoining: losing the connection mid-game, closing the page and rejoining, and a player who never comes back.
import { launch, player, check, summary, until, openMp, click, fill, text, pageErrors } from './lib.mjs';
const b = await launch();
// the layout each page was sent (d.v, d.kv, d.seed: kept as the floor arrives) and a hash of what it built from it (the nav, the
// ceilings, the furniture): a rejoining player must have exactly the host's
const keepFloor = P => P.evaluate(() => { if (window.__keepD) return; window.__keepD = true;
  const o = applyFloor; applyFloor = (d, slot) => { window.__d = { v: d.v, kv: d.kv, seed: d.seed }; return o(d, slot); }; });
const layoutOf = P => P.evaluate(() => { let h = 0x811c9dc5; const add = v => { h = Math.imul(h ^ (v & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ (v >>> 16), 16777619) >>> 0; };
  for (const a of [NAV.cut, NAV.isl, NAV.occ, new Uint8Array(CEIL.buffer)]) for (const v of a) add(v);
  for (const q of NAV.bucket) { add(q ? q.length : 0); if (q) q.forEach(add); }
  for (const s of SOLIDS) [s.k, s.x0 * 2, s.y0 * 2, s.x1 * 2, s.y1 * 2, s.rot, s.v].forEach(add);
  return Object.assign({ want: [LAYOUT_VERSION, KIT.version], vseed: VSEED, solids: SOLIDS.length, nav: h }, window.__d); });
const sameLayout = L => L.every(l => l.v === l.want[0] && l.kv === l.want[1] && l.seed === L[0].seed && l.vseed === (l.seed >>> 0) && l.nav === L[0].nav && l.solids === L[0].solids);
const A = await player(b, 'Anna'), B = await player(b, 'Ben');
console.log('== a game for two');
await openMp(A); await click(A, '#mpCreate');
await until(A, () => !document.getElementById('lobby').classList.contains('hidden'));
const code = (await text(A, 'lbCode')).replace(/\s/g, '');
await openMp(B); await fill(B, '#mpCode', code); await click(B, '#mpJoin');
check(await until(B, () => !document.getElementById('lobby').classList.contains('hidden')), 'Ben joined');
console.log('== the owner picks the floor and the difficulty');
check(await B.evaluate(() => document.getElementById('lbLevel').disabled && [...document.querySelectorAll('#lbDiff button')].every(b => b.disabled)), 'Ben can see the choice but not change it');
check(await A.evaluate(() => document.querySelector('#lbLevel option[value="2"]').disabled), 'Anna cannot pick a floor she has not opened yet');
await A.evaluate(() => { progress.done = [true, true]; saveProgress(); renderLobby(); });
await A.evaluate(() => { const s = document.getElementById('lbLevel'); s.value = 2; s.dispatchEvent(new Event('change')); document.querySelector('#lbDiff button[data-d="hard"]').click(); });
check(await until(B, () => document.getElementById('lbLevel').value === '2' && document.querySelector('#lbDiff button.on').dataset.d === 'hard', null, 10000), 'Ben sees floor 3 and Hard');
await keepFloor(A); await keepFloor(B);
await click(A, '#lbReady'); await click(B, '#lbReady');
check((await Promise.all([A, B].map(P => until(P, () => bb.state === 'play' && bb.MP.inGame, null, 30000)))).every(Boolean), 'the game started for both');
const lay1 = await Promise.all([A, B].map(layoutOf));
check(sameLayout(lay1), 'the same layout for both: this version\'s (d.v, d.kv), the same seed, the same furniture, nav and ceilings (hash)', lay1);
check((await Promise.all([A, B].map(P => P.evaluate(() => bb.floorIdx === 2 && curDiff === 'hard')))).every(Boolean), 'on floor 3, on Hard, for both');
await A.evaluate(() => { const m = bb.monster; m.active = false; m.spawnT = 1e9; });
const benId = await B.evaluate(() => bb.MP.myId);

console.log('== the connection drops for a moment');
await B.evaluate(() => bb.MP.hostConn.close());
check(await until(B, () => !document.getElementById('reconn').classList.contains('hidden'), null, 10000), 'Ben sees "Connection lost, reconnecting"');
check(await until(A, id => { const o = bb.MP.others.get(id); return o && o.away; }, benId, 15000), 'Anna sees Ben as away (his place is kept)');
check(await A.evaluate(id => !bb.allPlayers().some(q => q.id === id), benId), 'she ignores Ben while he is away');
check(await until(B, () => document.getElementById('reconn').classList.contains('hidden') && bb.state === 'play', null, 40000), 'Ben is reconnected and back in the game');
check(await until(A, id => { const o = bb.MP.others.get(id); return o && !o.away; }, benId, 15000), 'Anna sees Ben back');

console.log('== closing the page and rejoining');
await A.evaluate(() => bb.hostEmit({ t: 'fuseGot', k: 0, by: bb.MP.myId }));         // (some progress to come back to)
check(await until(B, () => bb.fusesGot === 1, null, 10000), 'a labyrinth box was solved');
const posBefore = await B.evaluate(() => { bb.player.x += 5; return [bb.player.x, bb.player.y]; });
await B.waitForTimeout(800);                                                                  // (let the host hear where Ben is)
await B.reload({ waitUntil: 'domcontentloaded' });
await B.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 120000, polling: 500 });
check(await until(A, id => { const o = bb.MP.others.get(id); return o && o.away; }, benId, 30000), 'Anna sees Ben as away after he closed the page');
check(await B.evaluate(() => !document.getElementById('rejoinBtn').classList.contains('hidden') && /Rejoin/.test(document.getElementById('rejoinBtn').textContent)),
  'the menu offers "Rejoin game"', await text(B, 'rejoinBtn'));
await keepFloor(B);
await click(B, '#rejoinBtn');
check(await until(B, () => bb.state === 'play' && bb.MP.inGame, null, 90000), 'Ben is back in the game', await text(B, 'mpStatus'));
const [ga, gb] = await Promise.all([A, B].map(P => P.evaluate(() => bb.grid.map(r => r.join('')).join('|'))));
check(ga === gb, 'on the same floor as Anna');
const lay2 = await Promise.all([A, B].map(layoutOf));
check(sameLayout(lay2) && lay2[0].seed === lay1[0].seed, 'with the same layout as Anna, rebuilt from what the host kept (d.v, d.kv, d.seed, nav hash)', lay2);
check(await B.evaluate(() => bb.fusesGot === 1 && bb.fuses[0].got), 'with that box already solved');
const posAfter = await B.evaluate(() => [bb.player.x, bb.player.y]);
check(Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1]) < 30, 'where he was', { posBefore, posAfter });
check(await until(A, id => { const o = bb.MP.others.get(id); return o && !o.away; }, benId, 15000), 'Anna sees Ben back again');
check(await B.evaluate(id => bb.MP.myId === id, benId), 'as the same player');

console.log('== every puzzle box on the basement (2 players, Hard)');
const fz = await A.evaluate(() => bb.fuses.map((f, k) => ({ k, got: f.got })));
const want = await A.evaluate(() => puzzleCount(2, 'hard'));
check(fz.length === want, 'the basement has ' + want + ' puzzle boxes on Hard', fz.length);
for (const f of fz.filter(f => !f.got)) { await B.evaluate(k => { openPuzzle(k); if (pzOpen) pzOpen.won = 0.001; }, f.k); await until(A, k => bb.fuses[k].got, f.k, 20000); }
check((await Promise.all([A, B].map(P => until(P, n => bb.fusesGot === n && bb.powerOn, want, 20000)))).every(Boolean), 'Ben solves all ' + want + ': both see ' + want + ' of ' + want + ', the door opens');

console.log('== a player who never comes back');
await B.context().close();
check(await until(A, id => { const o = bb.MP.others.get(id); return o && o.away; }, benId, 30000), 'Anna sees Ben as away');
await A.evaluate(id => { const pl = bb.MP.lobby.players.find(p => p.id === id); pl.awayT = 0.2; }, benId);   // (instead of waiting 90 seconds)
check(await until(A, id => !bb.MP.others.has(id), benId, 15000), 'after the wait, his place is given up');
check(/left the game/.test(await text(A, 'msg')), 'Anna is told Ben left', await text(A, 'msg'));
check(await A.evaluate(() => bb.state === 'play'), 'Anna plays on alone');

check(pageErrors.length === 0, 'no errors on the pages', pageErrors);
process.exitCode = summary(); await b.close();
