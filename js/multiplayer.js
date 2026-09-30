/* Escape from Barbi Blue: Multiplayer: the lobby (PeerJS / WebRTC) and the shared game. The lobby owner runs the game; the others send their position and get the world back.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- multiplayer: lobby and networking ---------- */
// Peer to peer (WebRTC, through PeerJS). The lobby owner's browser is the host: it makes the house, runs her AI and decides
// who is down. Everyone sends their own position ~15 times a second and gets everybody else's (and hers) back.
// PeerJS's free public server is only used to introduce the players to each other; the game itself goes browser to browser.
const MP = { on: false, host: false, peer: null, conns: new Map(), hostConn: null, myId: '', code: '', lobby: null, others: new Map(),
  sendT: 0, menu: false, n: 1, leaving: false, inGame: false, overSent: false, floorDone: false, exitAsked: false, spec: 0, scareT: 0, kicked: false, rejected: '' };
const PEER_PREFIX = 'escape-barbi-blue-', MAX_PLAYERS = 4, SEND_HZ = 15, DOWN_TIME = 50, REVIVE_TIME = 3;
const cleanName = t => String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
let myName = '';
try { myName = cleanName(localStorage.getItem('bb_name')); } catch (e) {}
if (!myName) myName = 'Player ' + (10 + Math.random() * 89 | 0);
function saveName(n) { myName = cleanName(n) || myName; try { localStorage.setItem('bb_name', myName); } catch (e) {} }
// ?peer=host:port uses your own PeerJS server instead of the public one (for testing)
function peerOptions() {
  const q = new URLSearchParams(location.search).get('peer');
  if (q) { const [host, port] = q.split(':'); return { host, port: +port || 9000, path: '/', secure: false, config: { iceServers: [] }, debug: 0 }; }
  return { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } };
}
const mpStatus = t => { $('mpStatus').textContent = t || ''; };
function netError(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'No lobby with that code.';
  if (t === 'browser-incompatible') return "This browser can't play together (no WebRTC).";
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return "Couldn't reach the matchmaking server. Check your internet connection.";
  return 'Something went wrong (' + (t || 'unknown') + ').';
}
const send = (c, msg) => { try { if (c && c.open) c.send(msg); } catch (e) {} };
function broadcast(msg) { for (const c of MP.conns.values()) send(c, msg); }
function hostEmit(msg) { broadcast(msg); clientHandle(msg); }            // to everyone, the host included
function toHost(msg) { if (MP.host) hostHandle(MP.myId, msg); else send(MP.hostConn, msg); }
const lobbyPlayer = id => MP.lobby && MP.lobby.players.find(p => p.id === id);
const nameOf = id => id === MP.myId ? myName : (lobbyPlayer(id) || MP.others.get(id) || { name: 'Someone' }).name;

function leaveMP(quiet) {
  MP.leaving = true;
  if (MP.lobbyTimer) { clearInterval(MP.lobbyTimer); MP.lobbyTimer = null; }
  if (MP.hostConn) { send(MP.hostConn, { t: 'leave' }); }
  const peer = MP.peer;
  setTimeout(() => { try { if (peer) peer.destroy(); } catch (e) {} }, 150);
  for (const o of MP.others.values()) removeAvatar(o);
  Object.assign(MP, { on: false, host: false, peer: null, hostConn: null, myId: '', code: '', lobby: null, inGame: false, menu: false, n: 1, scareT: 0 });
  MP.conns = new Map(); MP.others = new Map();
  MP.leaving = false;
  if (!quiet) mpStatus('');
}

// ---- the host side
function createLobby() {
  if (!window.peerjs) { mpStatus('Playing together could not load.'); return; }
  leaveMP(true); saveName($('mpName').value);
  const code = String(100000 + Math.floor(Math.random() * 900000));
  mpStatus('Creating a lobby…');
  const peer = new peerjs.Peer(PEER_PREFIX + code, peerOptions()); MP.peer = peer;
  peer.on('open', id => {
    Object.assign(MP, { on: true, host: true, myId: id, code, overSent: false });
    MP.lobby = { code, players: [{ id, name: myName, ready: false }], count: 0, started: false };
    mpStatus(''); showLobby(); hostLobbyChanged();
  });
  peer.on('connection', hostAccept);
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && !MP.on) { try { peer.destroy(); } catch (e) {} createLobby(); return; }
    if (!MP.on) { mpStatus(netError(err)); leaveMP(true); }
  });
  peer.on('disconnected', () => { if (MP.on && MP.peer === peer && !MP.leaving) try { peer.reconnect(); } catch (e) {} });
}
function hostAccept(conn) {
  conn.on('open', () => {
    if (!MP.lobby) { conn.close(); return; }
    const why = MP.lobby.started ? 'That game has already started.' : MP.lobby.players.length >= MAX_PLAYERS ? 'That lobby is full (4 players).' : '';
    if (why) { send(conn, { t: 'reject', why }); setTimeout(() => { try { conn.close(); } catch (e) {} }, 3000); return; }
    MP.conns.set(conn.peer, conn);
  });
  conn.on('data', d => { if (MP.conns.get(conn.peer) === conn) hostHandle(conn.peer, d); });
  conn.on('close', () => { if (MP.conns.get(conn.peer) === conn) hostDrop(conn.peer); });
  conn.on('error', () => { if (MP.conns.get(conn.peer) === conn) hostDrop(conn.peer); });
}
function hostDrop(id) {
  const c = MP.conns.get(id); MP.conns.delete(id);
  if (c) setTimeout(() => { try { c.close(); } catch (e) {} }, 300);
  if (!MP.lobby) return;
  const pl = lobbyPlayer(id);
  MP.lobby.players = MP.lobby.players.filter(p => p.id !== id);
  if (pl && MP.inGame) hostEmit({ t: 'left', id, name: pl.name });
  hostLobbyChanged();
}
function kickPlayer(id) {
  const c = MP.conns.get(id); if (!c) return;
  send(c, { t: 'kicked' });
  hostDrop(id);
}
function hostLobbyChanged() {
  const L = MP.lobby; if (!L) return;
  // when everybody is ready, count down 3 seconds; anyone un-readying, joining or leaving stops the countdown
  const all = !L.started && L.players.length >= 1 && L.players.every(p => p.ready);
  if (all && !MP.lobbyTimer) {
    L.count = 3;
    MP.lobbyTimer = setInterval(() => {
      L.count--;
      if (L.count <= 0) { clearInterval(MP.lobbyTimer); MP.lobbyTimer = null; hostStartMatch(); return; }
      hostSendLobby();
    }, 1000);
  } else if (!all && MP.lobbyTimer) { clearInterval(MP.lobbyTimer); MP.lobbyTimer = null; L.count = 0; }
  hostSendLobby();
}
function hostSendLobby() { const L = MP.lobby; hostEmit({ t: 'lobby', lobby: { code: L.code, players: L.players, count: L.count, started: L.started } }); }
function hostHandle(id, m) {
  if (!m || typeof m !== 'object' || !MP.lobby) return;
  const pl = lobbyPlayer(id);
  switch (m.t) {
    case 'hello':
      if (!pl && MP.conns.has(id) && MP.lobby.players.length < MAX_PLAYERS && !MP.lobby.started) {
        MP.lobby.players.push({ id, name: cleanName(m.name) || 'Player', ready: false }); hostLobbyChanged(); }
      break;
    case 'name': if (pl) { pl.name = cleanName(m.name) || pl.name; hostLobbyChanged(); } break;
    case 'ready': if (pl && !MP.lobby.started) { pl.ready = !!m.ready; hostLobbyChanged(); } break;
    case 'leave': hostDrop(id); break;
    case 'st': hostPlayerState(id, m); break;
    case 'fuse': hostFuse(id, m.k | 0); break;
    case 'exit': hostExit(); break;
    case 'phone': hostPhone(id); break;
    case 'revive': hostRevive(id, String(m.id)); break;
  }
}

// ---- the joining side
function joinLobby() {
  if (!window.peerjs) { mpStatus('Playing together could not load.'); return; }
  const code = $('mpCode').value.replace(/\D/g, '');
  if (code.length !== 6) { mpStatus('The code has 6 digits.'); return; }
  leaveMP(true); saveName($('mpName').value);
  mpStatus('Connecting…'); MP.kicked = false; MP.rejected = '';
  const peer = new peerjs.Peer(peerOptions()); MP.peer = peer;
  let joined = false;
  const fail = t => { if (joined || MP.peer !== peer) return; clearTimeout(timer); leaveMP(true); mpStatus(t); };
  const timer = setTimeout(() => fail("Couldn't reach that lobby. Check the code and try again."), 15000);
  peer.on('open', id => {
    MP.myId = id;
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true }); MP.hostConn = conn;
    conn.on('open', () => send(conn, { t: 'hello', name: myName }));
    conn.on('data', d => {
      if (d && d.t === 'reject') { MP.rejected = d.why; fail(d.why); return; }
      if (!joined && d && d.t === 'lobby') { joined = true; clearTimeout(timer); Object.assign(MP, { on: true, host: false, code }); mpStatus(''); showLobby(); }
      if (joined) clientHandle(d);
    });
    conn.on('close', () => { if (!joined) fail(MP.rejected || "Couldn't join that lobby."); else clientLost(); });
    conn.on('error', () => { if (!joined) fail(MP.rejected || "Couldn't join that lobby."); });
  });
  peer.on('error', err => { if (!joined) fail(netError(err)); else if (err.type !== 'peer-unavailable') clientLost(); });
}
function clientLost() {
  if (MP.leaving || !MP.on) return;
  const why = MP.kicked ? 'The lobby owner removed you from the lobby.' : 'Lost the connection to the lobby owner.';
  leaveMP(true); toTitle(); openPanel('mp'); mpStatus(why);
}

// ---- the lobby screen
function showLobby() {
  ['title', 'panel', 'dead', 'win', 'trans', 'paused', 'note'].forEach(id => show(id, false)); setHud(false);
  show('lobby', true); stopSong(); state = 'lobby'; MP.inGame = false; MP.menu = false;
  if (document.activeElement !== $('lbName')) $('lbName').value = myName;
  renderLobby();
}
function renderLobby() {
  const L = MP.lobby; if (!L) return;
  $('lbCode').textContent = L.code.slice(0, 3) + ' ' + L.code.slice(3);
  const ul = $('lbList'); ul.textContent = '';
  L.players.forEach((pl, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = PlayerModel.TAGS[i % 4];
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (i === 0 ? '👑 ' : '') + pl.name;
    if (pl.id === MP.myId) { const y = document.createElement('span'); y.className = 'you'; y.textContent = '  (you)'; nm.appendChild(y); }
    const rd = document.createElement('span'); rd.className = 'rd' + (pl.ready ? ' on' : ''); rd.textContent = pl.ready ? 'Ready' : 'Not ready';
    li.append(dot, nm, rd);
    if (MP.host && pl.id !== MP.myId) { const k = document.createElement('button'); k.className = 'kick'; k.textContent = 'Kick'; k.onclick = () => kickPlayer(pl.id); li.appendChild(k); }
    ul.appendChild(li);
  });
  for (let i = L.players.length; i < MAX_PLAYERS; i++) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Waiting for a player…'; ul.appendChild(li); }
  const me = lobbyPlayer(MP.myId), nReady = L.players.filter(p => p.ready).length;
  $('lbReady').textContent = me && me.ready ? 'Not ready' : 'Ready'; $('lbReady').classList.toggle('on', !!(me && me.ready));
  $('lbStatus').textContent = L.count > 0 ? 'Starting in ' + L.count + '…' :
    L.players.length + '/' + MAX_PLAYERS + ' players · ' + nReady + ' of ' + L.players.length + ' ready' + (nReady < L.players.length ? ' — everyone has to be ready' : '');
}
$('mpName').value = myName;
$('mpCreate').onclick = () => { unlockAudio(); createLobby(); };
$('mpJoin').onclick = () => { unlockAudio(); joinLobby(); };
$('mpCode').addEventListener('keydown', e => { if (e.key === 'Enter') { unlockAudio(); joinLobby(); } });
$('mpName').addEventListener('change', e => saveName(e.target.value));
$('lbReady').onclick = () => {
  unlockAudio(); primeVoice();
  const me = lobbyPlayer(MP.myId); if (!me) return;
  if (MP.host) { me.ready = !me.ready; hostLobbyChanged(); } else { send(MP.hostConn, { t: 'ready', ready: !me.ready }); }
};
$('lbName').addEventListener('input', e => {
  saveName(e.target.value);
  if (MP.host) { const me = lobbyPlayer(MP.myId); if (me) { me.name = myName; hostLobbyChanged(); } } else send(MP.hostConn, { t: 'name', name: myName });
});
$('lbLeave').onclick = () => { leaveMP(); toTitle(); openPanel('mp'); };

/* ---------- multiplayer: the game ---------- */
function hostStartMatch() {
  const L = MP.lobby; if (!L || L.started) return;
  L.started = true; L.count = 0; MP.overSent = false; runTime = 0;
  hostSendLobby(); hostStartFloor(0);
}
function hostStartFloor(i) {
  const L = MP.lobby; if (!L) return;
  const d = generateFloor(i, L.players.length);
  d.order = L.players.map(p => p.id); d.names = L.players.map(p => p.name);
  MP.floorDone = false; MP.overSent = false;
  hostEmit({ t: 'floor', d });
}
// the host ends the round (everyone down, or out of the house): the lobby opens again for the next game
function hostEndMatch() {
  const L = MP.lobby; if (!L) return;
  L.started = false; L.players.forEach(p => { p.ready = false; });
  hostSendLobby();
}
function makeOther(id, slot, name) {
  let o = MP.others.get(id);
  if (!o) { o = { id, x: 0, y: 0, tx: 0, ty: 0, ang: 0, pitch: 0, hidden: false, closet: -1, moving: false, sprinting: false,
    down: false, dead: false, downLeft: 0, inv: 0, rv: '', spd: 0, px: 0, py: 0, av: null }; MP.others.set(id, o); }
  o.slot = slot; o.name = name;
  if (renderer && (!o.av || o.avSlot !== slot)) {
    removeAvatar(o);
    try { o.av = playerTemplate ? PlayerModel.createHuman(THREE, { slot, name, template: playerTemplate, mocap: mocapData }) : PlayerModel.create(THREE, { slot, name }); }
    catch (e) { console.error(e); o.av = PlayerModel.create(THREE, { slot, name }); }
    o.avSlot = slot; scene.add(o.av.obj); }
  return o;
}
function removeAvatar(o) { if (o.av) { scene.remove(o.av.obj); o.av.dispose(); o.av = null; } }
const meOrOther = id => id === MP.myId ? player : MP.others.get(id);

// messages from the host (the host runs these too, for everything it sends)
function clientHandle(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'lobby':
      MP.lobby = m.lobby;
      for (const pl of m.lobby.players) { const o = MP.others.get(pl.id); if (o && o.name !== pl.name) o.name = pl.name; }
      if (state === 'lobby') renderLobby();
      break;
    case 'kicked': MP.kicked = true; break;
    case 'lockedout': if (player.hidden) { exitHide(); lockedOut(); } break;
    case 'floor': {
      const d = m.d, slot = Math.max(0, d.order.indexOf(MP.myId));
      for (const [id, o] of MP.others) if (!d.order.includes(id)) { removeAvatar(o); MP.others.delete(id); }
      d.order.forEach((id, i) => { if (id === MP.myId) return;
        const o = makeOther(id, i, d.names[i]), sp = d.spawns[Math.min(i, d.spawns.length - 1)];
        Object.assign(o, { x: sp[0], y: sp[1], tx: sp[0], ty: sp[1], ang: d.a0, down: false, dead: false, downLeft: 0, hidden: false, closet: -1, inv: 0 }); });
      MP.n = d.order.length; MP.inGame = true; MP.menu = false; MP.exitAsked = false; MP.scareT = 0; MP.spec = 0;
      ['lobby', 'title', 'panel', 'dead', 'win', 'trans', 'paused', 'note'].forEach(id => show(id, false));
      if (m.d.i === 0) runTime = 0;
      applyFloor(d, slot);
      break; }
    case 'w': clientWorld(m); break;
    case 'fuseGot': applyFuse(m.k, m.by); break;
    case 'scream': {
      const d = Math.hypot(monster.x - player.x, monster.y - player.y);
      startScream(); sfx.scream(clamp(1 - d / 700, 0.2, 0.8)); shake = 7;
      showMsg('A scream tears through the house. She knows where you are. HIDE.', 3.5); break; }
    case 'phoned': {
      if (m.by === MP.myId) $('popRes').textContent = m.ok ? 'Seen ✓✓ ... she stopped and walked away.' : 'Delivered';
      if (m.ok) { sfx.sting(); showMsg((m.by === MP.myId ? 'The music box goes quiet' : nameOf(m.by) + ' texted her. The music box goes quiet') + '. She left. 15 seconds.', 3); }
      break; }
    case 'down': {
      const q = meOrOther(m.id); if (!q) break;
      q.down = true; q.dead = false; q.downLeft = DOWN_TIME; q.hidden = false;
      if (m.id === MP.myId) goDown(m.reason);
      else { sfx.sting(); showMsg(nameOf(m.id) + ' is down! Revive them within ' + DOWN_TIME + ' seconds.', 3.5); }
      break; }
    case 'bled': {
      const q = meOrOther(m.id); if (!q) break;
      q.dead = true; q.downLeft = 0;
      showMsg(m.id === MP.myId ? "You didn't make it. You'll be back on the next floor if the others escape." : nameOf(m.id) + " didn't make it.", 4);
      break; }
    case 'revived': {
      const q = meOrOther(m.id); if (!q) break;
      q.down = false; q.dead = false; q.downLeft = 0; q.inv = 3;
      if (m.id === MP.myId) { player.stam = 0.6; player.exhausted = false; show('downMsg', false); setHud(true); showMsg(nameOf(m.by) + ' got you back up!', 2.5); }
      else showMsg(nameOf(m.by) + ' revived ' + nameOf(m.id) + '.', 2.5);
      sfx.pickup(); break; }
    case 'left': {
      const o = MP.others.get(m.id); if (o) { removeAvatar(o); MP.others.delete(m.id); }
      showMsg(m.name + ' left the game.', 3); break; }
    case 'next': {
      stopSong(); $('pop').classList.remove('on'); setHud(false); show('downMsg', false); show('revive', false);
      state = 'trans'; setSprint(false);
      const F = FLOORS[m.i];
      $('tNum').textContent = 'Floor ' + (m.i + 1); $('tName').textContent = F.name;
      show('tGo', false); show('trans', true);
      let n = 4; const tick = () => { $('tText').textContent = F.text + '  Everyone goes down together in ' + n + '…'; };
      tick(); clearInterval(MP.transTimer); MP.transTimer = setInterval(() => { n--; if (n <= 0 || state !== 'trans') { clearInterval(MP.transTimer); return; } tick(); }, 1000);
      break; }
    case 'win': mpEnd(true); break;
    case 'over': mpEnd(false); break;
  }
}
function mpEnd(won) {
  stopSong(); $('pop').classList.remove('on'); setHud(false); show('downMsg', false); show('revive', false);
  MP.inGame = false; MP.scareT = 0;
  if (won) {
    state = 'win'; $('wTime').textContent = 'Time: ' + fmtTime(runTime);
    $('again').textContent = 'Back to lobby'; show('winLeave', true); show('win', true);
  } else {
    state = 'dead'; deadT = 2; $('dTitle').textContent = 'SHE GOT EVERYONE';
    $('dText').textContent = 'Nobody was left to help. The music box plays on.';
    $('retry').textContent = 'Back to lobby'; $('menu1').textContent = 'Leave'; show('dead', true);
  }
  if (MP.host) hostEndMatch();
}
// everybody's position and state from the host, ~15 times a second
function clientWorld(m) {
  if (!MP.inGame || MP.host) return;
  for (const q of m.ps) {
    if (q.id === MP.myId) {                    // being down is decided by the host
      player.downLeft = q.dl;
      continue;
    }
    const o = MP.others.get(q.id); if (!o) continue;
    o.tx = q.x; o.ty = q.y; o.ang = q.a; o.pitch = q.p; o.hidden = !!q.h; o.closet = q.c; o.moving = !!q.mv; o.sprinting = !!q.sp;
    o.down = !!q.dn; o.dead = !!q.dd; o.downLeft = q.dl; o.rv = q.rv || '';
  }
  const M = m.m, mo = monster;
  if (M.ac && !mo.active) showMsg('Somewhere in the house, a music box starts playing.', 3);
  if (M.s === 'chase' && M.ti === MP.myId && !(mo.state === 'chase' && mo.ti === MP.myId)) { sfx.sting(); shake = Math.max(shake, 5); if (navigator.vibrate) navigator.vibrate(120); }
  mo.tx = M.x; mo.ty = M.y; mo.tang = M.a; mo.state = M.s; mo.active = !!M.ac; mo.vel = M.v; mo.screamT = M.sc; mo.ti = M.ti;
  if (!mo.seen) { mo.x = mo.tx; mo.y = mo.ty; mo.px = mo.x; mo.py = mo.y; mo.ang = mo.tang; mo.seen = true; }
}
// on the joining players' screens she is moved smoothly to where the host says she is
function updateMonsterClient(dt) {
  const m = monster, k = 1 - Math.exp(-dt * 12);
  if (m.tx === undefined) return;
  if (Math.hypot(m.tx - m.x, m.ty - m.y) > T * 3) { m.x = m.tx; m.y = m.ty; }   // (she was moved far away: no sliding across the map)
  m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; m.ang = lerpAngle(m.ang, m.tang || 0, k);
  const mv = Math.hypot(m.x - m.px, m.y - m.py); m.px = m.x; m.py = m.y;
  if (m.active && mv < 20) { m.stepAcc += mv;
    if (m.stepAcc > 17) { m.stepAcc = 0; m.foot = -m.foot;
      prints.push({ x: m.x + Math.cos(m.ang + 1.57) * 3.5 * m.foot, y: m.y + Math.sin(m.ang + 1.57) * 3.5 * m.foot, a: m.ang, t: 14 });
      if (prints.length > 90) prints.shift(); } }
  if (m.screamT > 0) m.screamT -= dt;
}
// the host keeps each player's latest state
function hostPlayerState(id, m) {
  const o = MP.others.get(id); if (!o || !MP.inGame) return;
  const num = v => Number.isFinite(v) ? v : 0;
  o.tx = clamp(num(m.x), 0, GW * T); o.ty = clamp(num(m.y), 0, GH * T); o.ang = num(m.a); o.pitch = clamp(num(m.p), -1.2, 1.2);
  const wasHidden = o.hidden; o.hidden = !!m.h; o.closet = m.c | 0; o.moving = !!m.mv; o.sprinting = !!m.sp; o.rv = typeof m.rv === 'string' ? m.rv : '';
  // two players in one wardrobe (they climbed in at the same moment): whoever was there first stays, the other is pushed out
  if (o.hidden && !wasHidden) {
    const k = o.closet, first = (player.hidden && closets.indexOf(player.closet) === k) ||
      [...MP.others.values()].some(q => q !== o && q.hidden && q.closet === k);
    if (first) { o.hidden = false; send(MP.conns.get(id), { t: 'lockedout' }); return; }
    onPlayerHid(id, o.tx, o.ty);
  }
}
// a player climbed into a wardrobe: if she was chasing that player and saw it happen, she knows where they are
function onPlayerHid(id, x, y) {
  const mo = monster;
  if (mo.active && mo.state === 'chase' && mo.ti === id && mo.seenT < 0.8 && Math.hypot(mo.x - x, mo.y - y) < 230) mo.kc = id;
}
function hostFuse(id, k) {
  const f = fuses[k]; if (!f || f.got || !MP.inGame) return;
  hostEmit({ t: 'fuseGot', k, by: id });
}
function applyFuse(k, by) {
  const f = fuses[k]; if (!f || f.got) return;
  f.got = true; fusesGot++; sfx.pickup(); updateFuseHud();
  if (fusesGot === fuses.length) {
    powerOn = true; updateFuseHud(); shake = 8; sfx.scream(0.5);
    if (!MP.on || MP.host) { monster.huntT = 7; if (!monster.active) monster.active = true; }
    if (monster.active) startScream();
    showMsg('The lights buzz. The door unlocks... and she heard it. RUN.', 4);
  } else showMsg(by && by !== MP.myId ? nameOf(by) + ' found a fuse (' + fusesGot + ' of ' + fuses.length + ').' : 'Fuse ' + fusesGot + ' of ' + fuses.length + '.', 2);
}
function hostExit() {
  if (!powerOn || MP.floorDone || !MP.inGame) return;
  MP.floorDone = true;
  if (floorIdx >= FLOORS.length - 1) { hostEmit({ t: 'win' }); return; }
  const next = floorIdx + 1;
  hostEmit({ t: 'next', i: next });
  setTimeout(() => { if (MP.on && MP.host && MP.lobby && MP.lobby.started) hostStartFloor(next); }, 4000);
}
function hostPhone(id) {
  const m = monster, ok = m.active && (m.state === 'chase' || m.state === 'hunt');
  if (ok) { m.active = false; m.spawnT = 15; m.relocate = true; m.state = 'wander'; m.path = []; m.huntT = 0; m.kc = null; m.ti = null; }
  setTimeout(() => hostEmit({ t: 'phoned', by: id, ok }), 900);
}
function hostRevive(by, id) {
  const r = meOrOther(by), q = meOrOther(id);
  if (!r || !q || r.down || r.dead || !q.down || q.dead) return;
  if (Math.hypot(r.x - q.x, r.y - q.y) > 70) return;
  hostEmit({ t: 'revived', id, by });
}
// everyone the monster can go after: you, and your teammates
function allPlayers() {
  const list = [{ id: MP.myId || 'me', me: true, x: player.x, y: player.y, hidden: player.hidden, moving: player.moving, sprinting: player.sprinting,
    down: player.down, dead: player.dead, inv: player.inv, closet: player.hidden ? closets.indexOf(player.closet) : -1 }];
  if (MP.on) for (const o of MP.others.values()) list.push({ id: o.id, x: o.x, y: o.y, hidden: o.hidden, moving: o.moving, sprinting: o.sprinting, down: o.down, dead: o.dead, inv: o.inv,
    closet: o.hidden ? o.closet : -1 });
  return list;
}
function downPlayer(q, reason) {
  if (!MP.on) { die(reason); return; }
  const m = monster;
  hostEmit({ t: 'down', id: q.id, reason });
  // she leaves her victim and wanders off (so the others can try a revive)
  m.state = 'wander'; m.kc = null; m.ti = null; m.huntT = 0; m.screamT = 1.3; m.path = [];
  const far = CELLS.map(center).filter(c => Math.hypot(c.x - m.x, c.y - m.y) > T * 6);
  m.target = far.length ? far[Math.random() * far.length | 0] : null;
}
// you're down: the jumpscare plays over the game (the game keeps running for everyone), then you wait for a revive
function goDown(reason) {
  const p = player;
  if (p.hidden) { p.hidden = false; p.closet = null; $('hide').textContent = 'HIDE'; }
  prepDeath(); deadT = 0; MP.scareT = 1.8; deathReason = reason;
  setHud(false); show('hud', true); setSprint(false); show('revive', false); show('hide', false);
  joy.id = null; joy.x = joy.y = 0;
  sfx.sting(); if (!songOn) sfx.scream(1);
  if (navigator.vibrate) navigator.vibrate([300, 80, 500]);
}
// runs every frame in multiplayer (also between floors): smooth the teammates' movement, send our state, host bookkeeping
function mpTick(dt) {
  if (!MP.inGame) return;
  const k = 1 - Math.exp(-dt * 12);
  for (const o of MP.others.values()) {
    if (Math.hypot(o.tx - o.x, o.ty - o.y) > T * 3) { o.x = o.tx; o.y = o.ty; }
    const ox = o.x, oy = o.y;
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
    o.spd += (Math.hypot(o.x - ox, o.y - oy) / Math.max(dt, 1e-3) - o.spd) * Math.min(1, dt * 10);
    if (o.inv > 0) o.inv -= dt;
    if (o.down && !o.dead && o.downLeft > 0) o.downLeft = Math.max(0, o.downLeft - dt);
  }
  if (player.inv > 0) player.inv -= dt;
  if (player.down && !player.dead && player.downLeft > 0) player.downLeft = Math.max(0, player.downLeft - dt);
  if (MP.host && state === 'play') {
    // bleeding out, and the end of the game when nobody is left standing
    for (const q of [player, ...MP.others.values()]) if (q.down && !q.dead && q.downLeft <= 0) hostEmit({ t: 'bled', id: q === player ? MP.myId : q.id });
    const everyone = [player, ...MP.others.values()];
    if (!MP.overSent && everyone.every(q => q.down || q.dead)) { MP.overSent = true; setTimeout(() => { if (MP.on && MP.host) hostEmit({ t: 'over' }); }, 2500); }
  }
  MP.sendT -= dt;
  if (MP.sendT > 0) return;
  MP.sendT = 1 / SEND_HZ;
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, p = player;
  const cl = p.closet ? closets.indexOf(p.closet) : -1, rv = reviveTarget && revP > 0 ? reviveTarget.id : '';
  if (!MP.host) { send(MP.hostConn, { t: 'st', x: r1(p.x), y: r1(p.y), a: r2(p.ang), p: r2(p.pitch), h: p.hidden ? 1 : 0, c: cl, mv: p.moving ? 1 : 0, sp: p.sprinting ? 1 : 0, rv }); return; }
  const ps = [{ id: MP.myId, x: r1(p.x), y: r1(p.y), a: r2(p.ang), p: r2(p.pitch), h: p.hidden ? 1 : 0, c: cl, mv: p.moving ? 1 : 0, sp: p.sprinting ? 1 : 0,
    dn: p.down ? 1 : 0, dd: p.dead ? 1 : 0, dl: r1(p.downLeft), rv }];
  for (const o of MP.others.values()) ps.push({ id: o.id, x: r1(o.tx), y: r1(o.ty), a: r2(o.ang), p: r2(o.pitch), h: o.hidden ? 1 : 0, c: o.closet, mv: o.moving ? 1 : 0,
    sp: o.sprinting ? 1 : 0, dn: o.down ? 1 : 0, dd: o.dead ? 1 : 0, dl: r1(o.downLeft), rv: o.rv });
  const m = monster;
  broadcast({ t: 'w', ps, m: { x: r1(m.x), y: r1(m.y), a: r2(m.ang), s: m.state, ac: m.active ? 1 : 0, v: r1(m.vel), sc: r2(m.screamT), ti: m.ti } });
}
// teammates are solid: you can't walk through them (you can always move away from one you overlap)
function mateBlocked(x, y) {
  if (!MP.on) return false;
  for (const o of MP.others.values()) {
    if (o.hidden || o.down || o.dead) continue;
    const d = Math.hypot(x - o.x, y - o.y);
    if (d < 22 && d < Math.hypot(player.x - o.x, player.y - o.y) - 0.01) return true;
  }
  return false;
}
