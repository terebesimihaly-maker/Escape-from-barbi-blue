// Joining a lobby when things go wrong: a wrong code, an owner whose game doesn't answer, a first attempt that fails
// (tried again by itself), the relay (TURN) setting, the countdown, and four players joining.
import { launch, player, check, summary, until, openMp, click, fill, text, pageErrors, lobbyBuilt, URL as GAME } from './lib.mjs';
const b = await launch();
const A = await player(b, 'Anna'), B = await player(b, 'Ben'), C = await player(b, 'Cara'), D = await player(b, 'Dan');
await openMp(A); await click(A, '#mpCreate');
await until(A, () => !document.getElementById('lobby').classList.contains('hidden'));
await lobbyBuilt(A);
const code = (await text(A, 'lbCode')).replace(/\s/g, '');

console.log('== a wrong code');
await openMp(B); await fill(B, '#mpCode', code === '999999' ? '999998' : '999999'); await click(B, '#mpJoin');
check(await until(B, () => /No lobby with that code/.test(document.getElementById('mpStatus').textContent), null, 30000), 'told right away: "No lobby with that code"', await text(B, 'mpStatus'));

console.log('== the first attempt fails: tried again by itself');
// (Anna's game drops Ben's first connection the moment it opens, as a bad network might)
await A.evaluate(() => { window.__drops = 0; const orig = hostAccept; hostAccept = conn => { if (window.__drops++ === 0) { conn.on('open', () => conn.close()); return; } orig(conn); };
  bb.MP.peer.off('connection'); bb.MP.peer.on('connection', c => hostAccept(c)); });
await fill(B, '#mpCode', code); await click(B, '#mpJoin');
check(await until(B, () => /Connecting… \d+ s/.test(document.getElementById('mpStatus').textContent), null, 10000), 'a countdown while connecting', await text(B, 'mpStatus'));
check(await until(B, () => !document.getElementById('lobby').classList.contains('hidden'), null, 45000), 'Ben gets in on the next attempt');
check(await A.evaluate(() => window.__drops >= 2), 'it took a second attempt');

console.log('== four players');
for (const P of [C, D]) { const t = Date.now(); await openMp(P); await fill(P, '#mpCode', code); await click(P, '#mpJoin');
  check(await until(P, () => !document.getElementById('lobby').classList.contains('hidden'), null, 90000), P.pname + ' joined (' + Math.round((Date.now() - t) / 100) / 10 + ' s)'); }
check(await until(A, () => bb.MP.lobby.players.length === 4, null, 20000), 'the lobby has 4 players');

console.log('== the owner\'s game doesn\'t answer');
const E = await player(b, 'Eve');
await A.evaluate(() => { const orig = hostHandle; hostHandle = (id, m) => { if (m && m.t === 'hello' && !lobbyPlayer(id)) return; orig(id, m); }; });   // (hears nothing)
await A.evaluate(() => { const L = bb.MP.lobby; L.players = L.players.slice(0, 3); });                                        // (room for one more)
await openMp(E); await fill(E, '#mpCode', code); await click(E, '#mpJoin');
check(await until(E, () => /lobby owner's computer answered, but their game didn't/.test(document.getElementById('mpStatus').textContent), null, 60000),
  'after 30 seconds: "the lobby owner\'s computer answered, but their game didn\'t"', await text(E, 'mpStatus'));

console.log('== the relay (TURN) setting');
const ctx = await b.newContext(); const R = await ctx.newPage();
await R.goto(GAME + '&turn=' + encodeURIComponent('http://127.0.0.1:8766/tests/fake-turn.json'), { waitUntil: 'domcontentloaded', timeout: 120000 });
await R.waitForFunction(() => typeof iceReady === 'function', null, { timeout: 60000 });
const ice = await R.evaluate(async () => { await iceReady(); return { relay: hasRelay(), n: iceList.length }; });
check(ice.relay && ice.n === 4, 'a relay link is fetched and added to the STUN servers', ice);
const noTurn = await A.evaluate(async () => { await iceReady(); return hasRelay(); });
check(!noTurn, 'without one there is no relay (and the game still works)');

check(pageErrors.length === 0, 'no errors on the pages', pageErrors);
process.exitCode = summary(); await b.close();
