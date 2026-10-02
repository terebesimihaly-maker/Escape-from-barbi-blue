// Accounts and your character: the sign in / sign up screen first (guest mode below it), the profile and its character
// creator, an account keeping your character (the stand-in server in tests/server.mjs), signing back in by itself,
// signing out, wrong passwords, the server unreachable, and in multiplayer everyone seeing your character.
import { launch, check, summary, until, click, fill, text, pageErrors, OUT, BASE, player, openMp } from './lib.mjs';
const b = await launch();
const API = 'http://127.0.0.1:8766/fake', AURL = BASE + '?auth=1&api=' + encodeURIComponent(API);
const ctx = await b.newContext({ viewport: { width: 760, height: 520 } });
await ctx.addInitScript(() => { try { if (!localStorage.getItem('bb_settings')) localStorage.setItem('bb_settings', JSON.stringify({ sens: 1, vol: 0.5, quality: 'low' })); } catch (e) {} });
const p = await ctx.newPage();
p.on('pageerror', e => { console.log('  pageerror:', e.message); pageErrors.push(e.message); });
const server = async () => (await fetch(API + '/debug')).json();
const open = async () => { await p.goto(AURL, { waitUntil: 'domcontentloaded', timeout: 120000 }); await p.waitForFunction(() => typeof account === 'object', null, { timeout: 60000 }); };

console.log('== the first thing: sign in / create account, and guest mode below');
await open();
check(await until(p, () => !document.getElementById('auth').classList.contains('hidden') && document.getElementById('title').classList.contains('hidden'), null, 20000),
  'the game opens on the sign-in screen (the menu waits behind it)');
const layout = await p.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect();
  return { tabs: [...document.querySelectorAll('#authTabs button')].map(b => b.textContent), guestBelow: r('auGuest').top > r('auGo').bottom, user: !!document.getElementById('auUser'), pass: document.getElementById('auPass').type }; });
check(layout.tabs.join() === 'Sign in,Create account' && layout.guestBelow && layout.user && layout.pass === 'password', 'Sign in / Create account, and "Play as a guest" below them', layout);
await p.screenshot({ path: OUT + '/auth.png' });

console.log('== guest mode and the character creator');
await click(p, '#auGuest');
check(await until(p, () => document.getElementById('auth').classList.contains('hidden') && !document.getElementById('title').classList.contains('hidden'), null, 10000), 'as a guest: straight to the menu');
check(await p.evaluate(() => document.getElementById('pfName').textContent === 'Guest'), 'your profile button says "Guest"');
await click(p, '#profileBtn');
check(await until(p, () => !document.querySelector('#panel section[data-panel=profile]').classList.contains('hidden'), null, 10000), 'clicking it opens your profile');
check(await until(p, () => pv.r && pv.fig, null, 90000), 'your character, in 3D', await p.evaluate(() => document.getElementById('pfLoading').textContent));
const ctl = await p.evaluate(() => [...document.querySelectorAll('#pfCtl .pfrow > span')].map(s => s.textContent));
check(['Top', 'Top colour', 'Bottoms', 'Bottoms colour', 'Shoes', 'Hair', 'Hair colour', 'Skin', 'Eyes', 'Beard', 'Glasses', 'Freckles', 'Make-up', 'Build', 'Height'].every(k => ctl.includes(k)), 'you can change: ' + ctl.join(', '));
// the real clothes and hair (models/player.glb, made in Blender): what you pick is what the character wears
await p.evaluate(() => { document.querySelector('#pfCtl .ch[data-k=top][data-v=hoodie]').click(); document.querySelector('#pfCtl .ch[data-k=bottom][data-v=skirt]').click(); document.querySelector('#pfCtl .ch[data-k=hairStyle][data-v=ponytail]').click(); });
const worn = await until(p, () => { const f = pv.fig, v = n => { const o = f && f.obj.getObjectByName(n); return !!(o && o.visible); };
  return f && f.look.top === 'hoodie' && v('Hoodie') && !v('Tee') && !v('LongTop') && v('Skirt') && !v('Trousers') && v('HairPony') && !v('HairLong') && v('Sneakers')
    && v('FurPony') && v('HairTie') && !v('FurBuzz'); }, null, 30000);
check(worn, 'a hoodie, a skirt and a ponytail (real hairs combed back to its tie): the character wears exactly those', await p.evaluate(() => { const r = {}; pv.fig && pv.fig.obj.traverse(o => { if (o.isMesh && /^(Tee|LongTop|Hoodie|Trousers|ShortPants|Skirt|Hair|Fur|Sneakers)/.test(o.name)) r[o.name] = o.visible; }); return r; }));
const hairs = await p.evaluate(async () => { const seen = []; for (const h of PlayerModel.LOOK_OPTIONS.hairStyle) { setLook(Object.assign({}, account.look, { hairStyle: h })); await new Promise(r => setTimeout(r, 50)); seen.push(h); } return seen; });
check(hairs.length === 7, 'seven hairstyles to choose from: ' + hairs.join(', '));
const pick = await p.evaluate(() => { const b = [...document.querySelectorAll('#pfCtl .sw[data-k=shirt]')].find(b => +b.dataset.v !== account.look.shirt); b.click(); return +b.dataset.v; });
check(await p.evaluate(v => account.look.shirt === v && JSON.parse(localStorage.getItem('bb_look')).shirt === v, pick), 'a new shirt colour: chosen and kept on this device');
check(await until(p, v => pv.fig && pv.fig.look.jacket === v, pick, 20000), 'the 3D character wears it');
await p.evaluate(() => { document.querySelector('#pfCtl .ch[data-k=hairStyle][data-v=long]').click(); document.querySelector('#pfCtl .ch[data-k=glasses][data-v=round]').click();
  document.querySelector('#pfCtl .ch[data-k=beard][data-v=goatee]').click(); });
check(await until(p, () => pv.fig && pv.fig.look.long && pv.fig.face.glasses && pv.fig.face.glasses.round && pv.fig.face.beard === 'goatee', null, 20000), 'long hair, round glasses and a goatee: all on the character');
// (made in Blender: the glasses a real pair on the nose, the goatee real hairs on the chin, stacked a fraction of a millimetre apart)
check(await until(p, () => { const v = n => { const o = pv.fig.obj.getObjectByName(n); return !!(o && o.visible); }, fur = pv.fig.obj.getObjectByName('FurFace');
  return v('GlassesRound') && v('GlassesLensRound') && !v('GlassesSquare') && v('FurFace') && fur.geometry.attributes._layer && fur.geometry.attributes._layer.array.at(-1) === 1 && fur.geometry.attributes._layer.array[0] === 0; }, null, 20000),
  'the round glasses are the real pair, and the goatee is real hairs');
check(await until(p, () => pv.zoomT === 1 && pv.zoom > 0.9, null, 20000), 'choosing something for the face: the camera goes close to the face');
await p.evaluate(() => document.querySelector('#pfCtl .sw[data-k=shoes]').click());
check(await p.evaluate(() => pv.zoomT === 0), 'choosing shoes: back out to see all of you');
await p.evaluate(() => { const i = document.querySelector('#pfCtl input[type=color][data-k=pants]'); i.value = '#ff00aa'; i.dispatchEvent(new Event('input')); });
check(await until(p, () => account.look.pants === 0xff00aa && pv.fig && pv.fig.look.pants === 0xff00aa, null, 20000), 'any colour you like (pink trousers, from the colour picker)');
const seed0 = await p.evaluate(() => account.look.seed); await click(p, '#pfFace');
check(await p.evaluate(s => account.look.seed !== s && account.look.shirt !== undefined, seed0), '"New face" gives a new face and keeps the rest');
await p.waitForTimeout(1500); await p.screenshot({ path: OUT + '/profile.png' });
check(await p.evaluate(() => /guest/i.test(document.getElementById('pfAcct').textContent) && !document.getElementById('pfSignUp').classList.contains('hidden')), 'as a guest it says so, and offers to create an account');

console.log('== an account keeps your character');
const guestLook = await p.evaluate(() => JSON.stringify(account.look));
await click(p, '#pfSignUp');
check(await until(p, () => !document.getElementById('auth').classList.contains('hidden') && !document.getElementById('auPass2Row').classList.contains('hidden'), null, 10000), '"Create an account" opens the sign-up form');
await fill(p, '#auUser', 'Tester_1'); await fill(p, '#auPass', 'secret12'); await fill(p, '#auPass2', 'secret13'); await click(p, '#auGo');
check(await until(p, () => /don't match/.test(document.getElementById('auMsg').textContent), null, 5000), 'two different passwords: "The two passwords don\'t match"');
await fill(p, '#auPass2', 'secret12'); await click(p, '#auGo');
check(await until(p, () => account.token && document.getElementById('pfName').textContent === 'Tester_1' && !document.getElementById('title').classList.contains('hidden'), null, 15000), 'account created: signed in as Tester_1, back at the menu');
let sv = await server();
check(sv.players.length === 1 && JSON.stringify(sv.players[0].look) === guestLook, 'the character you made as a guest came with you (saved on the server)');
await click(p, '#profileBtn');
await until(p, () => pv.fig, null, 60000);
check(await p.evaluate(() => /Signed in as Tester_1/.test(document.getElementById('pfAcct').textContent) && !document.getElementById('pfSignOut').classList.contains('hidden')), 'the profile says who you are, with "Sign out"');
await p.evaluate(() => document.querySelector('#pfCtl .ch[data-k=hairStyle][data-v=short]').click());
const savedLater = await (async () => { for (let i = 0; i < 60; i++) { sv = await server(); if (sv.players[0].look.hairStyle === 'short') return true; await new Promise(r => setTimeout(r, 250)); } return false; })();
check(savedLater, 'a change is saved to your account a moment later');

console.log('== changing your username');
check(await p.evaluate(() => !document.getElementById('pfNameSave').classList.contains('hidden') && document.getElementById('pfNameLbl').textContent === 'Username' && document.getElementById('pfNameIn').value === 'Tester_1'), 'signed in, the profile shows your username with "Save name"');
await p.evaluate(() => api('efbb_sign_up', { p_username: 'Other_1', p_password: 'secret99', p_look: {} }));   // (someone else's account)
await fill(p, '#pfNameIn', 'other_1'); await click(p, '#pfNameSave');
check(await until(p, () => /taken/.test(document.getElementById('pfAcct').textContent), null, 10000) && await p.evaluate(() => account.user === 'Tester_1'), 'a name someone else has (any capitals): "That username is taken", nothing changes');
await fill(p, '#pfNameIn', 'x!'); await click(p, '#pfNameSave');
check(await until(p, () => /3 to 16/.test(document.getElementById('pfAcct').textContent), null, 10000), 'a name that breaks the rules: told what a username can be');
await fill(p, '#pfNameIn', 'Renamed_9'); await click(p, '#pfNameSave');
check(await until(p, () => account.user === 'Renamed_9' && document.getElementById('pfName').textContent === 'Renamed_9' && /now Renamed_9/.test(document.getElementById('pfAcct').textContent), null, 10000), 'a free name: your username is changed (shown on the menu chip too)');
sv = await server();
check(sv.players.some(q => q.username === 'Renamed_9') && !sv.players.some(q => q.username === 'Tester_1'), 'the server has the new name');
check(await p.evaluate(async () => (await api('efbb_me', { p_token: account.token })).username === 'Renamed_9' && JSON.parse(localStorage.getItem('bb_session')).user === 'Renamed_9' && myName === 'Renamed_9'), 'still signed in under the new name; your nametag in multiplayer follows');
await fill(p, '#pfNameIn', 'Tester_1'); await click(p, '#pfNameSave');
check(await until(p, () => account.user === 'Tester_1', null, 10000), 'and back again');

console.log('== next time: signed in by itself');
await open();
check(await until(p, () => account.token && !document.getElementById('title').classList.contains('hidden') && document.getElementById('auth').classList.contains('hidden'), null, 15000), 'opening the game again: straight in as Tester_1');
check(await p.evaluate(() => account.look.hairStyle === 'short' && document.getElementById('pfName').textContent === 'Tester_1'), 'with your character from the server');

console.log('== signing out, and back in');
await click(p, '#profileBtn'); await click(p, '#pfSignOut');
check(await until(p, () => !document.getElementById('auth').classList.contains('hidden') && !account.token && !localStorage.getItem('bb_session'), null, 10000), 'signing out: back to the sign-in screen, nothing kept');
await fill(p, '#auUser', 'tester_1'); await fill(p, '#auPass', 'wrongpass'); await click(p, '#auGo');
check(await until(p, () => /Wrong username or password/.test(document.getElementById('auMsg').textContent), null, 10000), 'a wrong password: "Wrong username or password"');
await fill(p, '#auPass', 'secret12'); await click(p, '#auGo');
check(await until(p, () => account.token && account.user === 'Tester_1', null, 10000), 'the right one (any capitals in the name): signed in');
await p.evaluate(() => signedOut());
await p.evaluate(() => { setAuthMode('up'); });
await fill(p, '#auUser', 'TESTER_1'); await fill(p, '#auPass', 'another1'); await fill(p, '#auPass2', 'another1'); await click(p, '#auGo');
check(await until(p, () => /taken/.test(document.getElementById('auMsg').textContent), null, 10000), 'a name that\'s taken: "That username is taken"');
await fill(p, '#auUser', 'no'); await click(p, '#auGo');
check(await until(p, () => /3 to 16/.test(document.getElementById('auMsg').textContent), null, 10000), 'a name too short: told what a username can be');

console.log('== the server unreachable');
await p.evaluate(async () => { setAuthMode('in'); });
await fill(p, '#auUser', 'Tester_1'); await fill(p, '#auPass', 'secret12'); await click(p, '#auGo'); await until(p, () => account.token, null, 10000);
await fetch(API + '/down');
await open();
check(await until(p, () => /Can't reach the account server/.test(document.getElementById('auMsg').textContent) && !document.getElementById('auth').classList.contains('hidden'), null, 30000),
  'no connection to the server: told so, on the sign-in screen', await text(p, 'auMsg'));
await click(p, '#auGuest');
check(await until(p, () => !document.getElementById('title').classList.contains('hidden'), null, 10000), 'and you can still play as a guest');
await fetch(API + '/down');

await ctx.close();                                        // (fewer pages drawing 3D at once: the machine running the tests has no graphics card)
console.log('== playing together: everyone sees your character');
const A = await player(b, 'Anna'), B = await player(b, 'Ben');
await A.evaluate(() => setLook(Object.assign({}, account.look, { shirt: 0x11ee22, hairStyle: 'long', glasses: 'square' })));
await B.evaluate(() => setLook(Object.assign({}, account.look, { shirt: 0xee2211, hairStyle: 'short', beard: 'beard' })));
await openMp(A); await click(A, '#mpCreate');
await until(A, () => !document.getElementById('lobby').classList.contains('hidden'));
const code = (await text(A, 'lbCode')).replace(/\s/g, '');
await openMp(B); await fill(B, '#mpCode', code); await click(B, '#mpJoin');
await until(B, () => !document.getElementById('lobby').classList.contains('hidden'), null, 60000);
await click(A, '#lbReady'); await click(B, '#lbReady');
check((await Promise.all([A, B].map(P => until(P, () => bb.state === 'play' && bb.MP.inGame, null, 60000)))).every(Boolean), 'a game for two',
  await Promise.all([A, B].map(P => P.evaluate(() => [bb.state, bb.MP.inGame]))));
const aSeesB = await until(A, () => { const o = [...bb.MP.others.values()][0]; return o && o.av && o.av.look && o.av.look.jacket === 0xee2211 && o.av.face.beard === 'beard' && !o.av.look.long; }, null, 60000);
const bSeesA = await until(B, () => { const o = [...bb.MP.others.values()][0]; return o && o.av && o.av.look && o.av.look.jacket === 0x11ee22 && o.av.look.long && o.av.face.glasses && !o.av.face.glasses.round; }, null, 60000);
check(aSeesB, 'Anna sees Ben as he made himself (red shirt, short hair, a beard)', await A.evaluate(() => { const o = [...bb.MP.others.values()][0]; return o && o.av && o.av.look; }));
check(bSeesA, 'Ben sees Anna as she made herself (green shirt, long hair, square glasses)');
check(await B.evaluate(() => bb.MP.meAv && bb.MP.meAv.look.jacket === 0xee2211), 'and his own figure (the dance camera) is him too');

check(pageErrors.length === 0, 'no errors on the pages', pageErrors);
process.exitCode = summary(); await b.close();
