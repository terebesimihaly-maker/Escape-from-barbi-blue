// The lobby, like Dead by Daylight: everyone's character standing together (their own look), dances, and a chat.
import { launch, check, summary, until, click, fill, text, pageErrors, OUT, player, openMp } from './lib.mjs';
const b = await launch();
const A = await player(b, 'Anna', 900, 520), B = await player(b, 'Ben', 900, 520);
await A.evaluate(() => setLook(Object.assign({}, account.look, { shirt: 0x11ee22, top: 'hoodie', hairStyle: 'bob' })));
await B.evaluate(() => setLook(Object.assign({}, account.look, { shirt: 0xee2211, top: 'tee', hairStyle: 'short' })));
await openMp(A); await click(A, '#mpCreate');
await until(A, () => !document.getElementById('lobby').classList.contains('hidden'));
const code = (await text(A, 'lbCode')).replace(/\s/g, '');
await openMp(B); await fill(B, '#mpCode', code); await click(B, '#mpJoin');
check(await until(B, () => !document.getElementById('lobby').classList.contains('hidden'), null, 60000), 'Ben joins the lobby');

console.log('== standing together');
const both = P => until(P, () => LOB.figs.size === 2 && [...LOB.figs.values()].every(f => f.av.human), null, 90000);
check((await Promise.all([A, B].map(both))).every(Boolean), 'both see two characters standing in the lobby');
const looks = await A.evaluate(() => [...LOB.figs.entries()].map(([id, f]) => [id === bb.MP.myId ? 'me' : 'other', f.av.look.jacket, f.av.look.top]));
check(looks.some(([w, j, t]) => w === 'me' && j === 0x11ee22 && t === 'hoodie') && looks.some(([w, j, t]) => w === 'other' && j === 0xee2211 && t === 'tee'), 'each as they made themselves (Anna in her green hoodie, Ben in his red T-shirt)', looks);
await A.waitForTimeout(1500); await A.screenshot({ path: OUT + '/lobby3d.png' });

console.log('== chat');
await fill(B, '#chatIn', 'hello <b>anna</b>'); await B.evaluate(() => sendChat());
check(await until(A, () => /Ben: hello <b>anna<\/b>/.test(document.getElementById('chatLog').textContent), null, 20000), 'Ben says hello: Anna reads it (as plain text: no HTML gets in)');
check(await A.evaluate(() => !document.querySelector('#chatLog b b')), 'the <b> stays text');
check(await until(A, () => [...LOB.bubbles.values()].some(e => e.style.display !== 'none' && /hello/.test(e.textContent)), null, 20000), 'and it shows over his character\'s head');
await A.evaluate(() => { document.getElementById('chatIn').value = 'x'.repeat(300); sendChat(); });
check(await until(B, () => [...document.querySelectorAll('#chatLog li')].some(li => /Anna: x{120}$/.test(li.textContent)), null, 20000), 'a long message is cut to 120 characters');
const n0 = await B.evaluate(() => document.querySelectorAll('#chatLog li').length);
await B.evaluate(() => { for (let i = 0; i < 5; i++) { document.getElementById('chatIn').value = 'spam ' + i; sendChat(); } });
await A.waitForTimeout(3000);
check(await A.evaluate(n => document.querySelectorAll('#chatLog li').length - n <= 2, n0), 'flooding the chat: most of it is dropped');

console.log('== dancing');
await B.evaluate(() => lobbyDance(3));
check(await until(A, () => [...LOB.dance.values()].some(d => d.k === 3), null, 20000), 'Ben does the Chicken: Anna sees him dance');
check(await until(A, () => { const f = [...LOB.figs.entries()].find(([id]) => id !== bb.MP.myId); return f && f[1].av.anim.current === 'd_chicken'; }, null, 20000), 'his character really dances');
await B.evaluate(() => lobbyDance(-1));
check(await until(A, () => LOB.dance.size === 0, null, 20000), 'and stops');

check(pageErrors.length === 0, 'no errors on the pages', pageErrors);
process.exitCode = summary(); await b.close();
