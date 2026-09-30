// Rejoining: losing the connection mid-game, closing the page and rejoining, and a player who never comes back.
import { launch, player, check, summary, until, openMp, click, fill, text, pageErrors } from './lib.mjs';
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
check(await until(B, () => bb.fusesGot === 1, null, 10000), 'a fuse was found');
const posBefore = await B.evaluate(() => { bb.player.x += 5; return [bb.player.x, bb.player.y]; });
await B.waitForTimeout(800);                                                                  // (let the host hear where Ben is)
await B.reload({ waitUntil: 'domcontentloaded' });
await B.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 120000, polling: 500 });
check(await until(A, id => { const o = bb.MP.others.get(id); return o && o.away; }, benId, 30000), 'Anna sees Ben as away after he closed the page');
check(await B.evaluate(() => !document.getElementById('rejoinBtn').classList.contains('hidden') && /Rejoin/.test(document.getElementById('rejoinBtn').textContent)),
  'the menu offers "Rejoin game"', await text(B, 'rejoinBtn'));
await click(B, '#rejoinBtn');
check(await until(B, () => bb.state === 'play' && bb.MP.inGame, null, 90000), 'Ben is back in the game', await text(B, 'mpStatus'));
const [ga, gb] = await Promise.all([A, B].map(P => P.evaluate(() => bb.grid.map(r => r.join('')).join('|'))));
check(ga === gb, 'on the same floor as Anna');
check(await B.evaluate(() => bb.fusesGot === 1 && bb.fuses[0].got), 'with the fuse already found');
const posAfter = await B.evaluate(() => [bb.player.x, bb.player.y]);
check(Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1]) < 30, 'where he was', { posBefore, posAfter });
check(await until(A, id => { const o = bb.MP.others.get(id); return o && !o.away; }, benId, 15000), 'Anna sees Ben back again');
check(await B.evaluate(id => bb.MP.myId === id, benId), 'as the same player');

console.log('== a player who never comes back');
await B.context().close();
check(await until(A, id => { const o = bb.MP.others.get(id); return o && o.away; }, benId, 30000), 'Anna sees Ben as away');
await A.evaluate(id => { const pl = bb.MP.lobby.players.find(p => p.id === id); pl.awayT = 0.2; }, benId);   // (instead of waiting 90 seconds)
check(await until(A, id => !bb.MP.others.has(id), benId, 15000), 'after the wait, his place is given up');
check(/left the game/.test(await text(A, 'msg')), 'Anna is told Ben left', await text(A, 'msg'));
check(await A.evaluate(() => bb.state === 'play'), 'Anna plays on alone');

check(pageErrors.length === 0, 'no errors on the pages', pageErrors);
process.exitCode = summary(); await b.close();
