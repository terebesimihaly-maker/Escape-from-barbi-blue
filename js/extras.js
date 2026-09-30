/* Escape from Barbi Blue: Achievements, the torn notes you've collected, and the performance overlay.
     achievements - kept on this device; a card slides in when you get one, the menu lists them all
     notes        - every note you've read counts once, forever: "Note 7 of 20 found"; the HUD shows this floor's
     performance  - F3, or Settings: frames per second, frame time, resolution, draw calls, and your ping when playing together
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

const ACH = [
  ['first', 'Out of the nursery', 'Escape the first floor.'],
  ['escape', 'Real sky', 'Escape the Workshop, the last floor.'],
  ['hard', 'Nightmare', 'Escape a floor on Hard.'],
  ['allhard', 'Porcelain nerves', 'Escape all five floors on Hard.'],
  ['fast', 'In a hurry', 'Escape a floor in under 3 minutes.'],
  ['nohide', 'Never hid', 'Escape a floor without hiding once.'],
  ['unseen', 'Unseen', 'Escape a floor without her ever chasing you.'],
  ['light', 'Light feet', 'Escape a floor without stepping on a loose floorboard you could have gone round.'],
  ['calm', 'Steady hands', 'Escape a floor without your fear ever going over half.'],
  ['lost', 'Lost her', 'Get away from her in a chase.'],
  ['breath', 'Not a sound', 'Hold your breath while she listens at your wardrobe.'],
  ['notfooled', 'Not fooled', 'Stay hidden when she only pretends to leave.'],
  ['phone', 'Seen ✓✓', 'Make her walk away with a text.'],
  ['reader', 'Reader', 'Find 10 torn notes.'],
  ['bookworm', 'The whole story', 'Find every torn note.'],
  ['angel', 'Guardian angel', 'Revive a teammate.'],
  ['team', 'Nobody left behind', 'Escape a floor together, with nobody lost.'],
  ['ghost', 'From beyond', 'Warn your team while you watch from beyond.'],
];
const achieved = {};
try { Object.assign(achieved, JSON.parse(localStorage.getItem('bb_ach') || '{}')); } catch (e) {}
// this floor so far: did you hide, did she chase you, how many loose boards, how afraid did you get
let fstat = { hid: false, seen: false, creaks: 0, fearMax: 0 }, chasedAt = -99;

function resetFloorExtras() {
  fstat = { hid: false, seen: false, creaks: 0, fearMax: 0 }; chasedAt = -99;
  resetTeam(); updateNoteHud();
}
function unlock(id) {
  if (achieved[id] || !ACH.some(a => a[0] === id)) return false;
  achieved[id] = Date.now(); try { localStorage.setItem('bb_ach', JSON.stringify(achieved)); } catch (e) {}
  const a = ACH.find(a => a[0] === id); toast('🏆 ' + a[1], a[2]); return true;
}
// (the host, or single player) something a player did that earns one: theirs to unlock, on their own device
function award(id, ach, msg) {
  if (!MP.on || id === MP.myId) { unlock(ach); if (msg) showMsg(msg, 2.5); }
  else hostEmit({ t: 'ach', id, a: ach, msg });
}
const toasts = [];
function toast(title, sub) {
  toasts.push([title, sub]); if (toasts.length === 1) nextToast();
}
function nextToast() {
  const t = toasts[0]; if (!t) return; const el = $('toast');
  el.firstChild.textContent = t[0]; el.lastChild.textContent = t[1]; el.classList.add('on');
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => { toasts.shift(); nextToast(); }, 450); }, 3200);
}
// escaped a floor (single player, or together): everything that counts for it
function floorAchievements(i, secs) {
  if (i === 0) unlock('first'); if (i === FLOORS.length - 1) unlock('escape');
  if (curDiff === 'hard') unlock('hard');
  if (FLOORS.every((F, k) => progress.hard[k])) unlock('allhard');
  if (secs > 1 && secs < 180) unlock('fast');
  if (!fstat.hid) unlock('nohide');
  if (!fstat.seen) unlock('unseen');
  if (!fstat.creaks && creaks.length) unlock('light');
  if (fstat.fearMax <= 0.5) unlock('calm');
  if (MP.on && !player.dead && [...MP.others.values()].every(o => !o.dead)) unlock('team');
}
function noteAchievements(n) { if (n >= 10) unlock('reader'); if (n >= NOTES_TOTAL) unlock('bookworm'); }
function updateNoteHud() { $('hNote').textContent = notes.length ? '📜 ' + notes.filter(n => n.read).length + '/' + notes.length : ''; }

// every frame of play: her chasing you (and losing you), pings, the overlay
function updateExtras(dt) {
  const m = monster, p = player, me = MP.on ? MP.myId : 'me';
  if (m.active && m.state === 'chase' && m.ti === me) { fstat.seen = true; chasedAt = levelTime; }
  else if (levelTime - chasedAt < 10 && m.active && !p.down && !p.dead && (m.state === 'search' || m.state === 'wander' || m.state === 'leave')) {
    chasedAt = -99; unlock('lost'); }
  updateTeam(dt);
}
function renderAchievements() {
  const ul = $('achList'); ul.textContent = '';
  for (const [id, name, desc] of ACH) {
    const li = document.createElement('li'), got = !!achieved[id]; li.className = got ? 'got' : '';
    const i = document.createElement('span'); i.className = 'i'; i.textContent = got ? '🏆' : '🔒';
    const t = document.createElement('span'), b = document.createElement('b'), s = document.createElement('small');
    b.textContent = name; s.textContent = desc; t.append(b, s); li.append(i, t); ul.appendChild(li);
  }
  $('achCount').textContent = Object.keys(achieved).filter(k => ACH.some(a => a[0] === k)).length + ' of ' + ACH.length + ' · torn notes found: ' + progress.notes.length + ' of ' + NOTES_TOTAL;
}
document.querySelector('nav [data-panel=ach]').addEventListener('click', renderAchievements);

/* ---------- the performance overlay ---------- */
const perf = { frames: 0, t: 0, fps: 0, ms: 0, calls: 0, tris: 0 };
function perfFrame(ms) {
  if (!settings.perf) return;
  perf.frames++; perf.t += ms; perf.ms += (ms - perf.ms) * 0.1;
  if (renderer) { perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles; }
  if (perf.t < 500) return;
  perf.fps = perf.frames * 1000 / perf.t; perf.frames = 0; perf.t = 0;
  let net = '';
  if (MP.on && !MP.host) net = '\nping ' + (MP.rtt ? Math.round(MP.rtt) + ' ms' : '…');
  else if (MP.on) net = '\nhost' + [...MP.others.values()].map(o => ' · ' + o.name + ' ' + (o.away ? 'away' : o.rt ? o.rt + ' ms' : '…')).join('');
  $('perf').textContent = Math.round(perf.fps) + ' fps · ' + perf.ms.toFixed(1) + ' ms\nres ' + Math.round(resScale * 100) + '% · ' +
    (settings.quality || '') + '\n' + perf.calls + ' draws · ' + Math.round(perf.tris / 1000) + 'k tris' + net;
}
function setPerf(on) { settings.perf = !!on; saveSettings(); $('setPerf').checked = settings.perf; show('perf', settings.perf); perf.frames = perf.t = 0; }
$('setPerf').onchange = e => setPerf(e.target.checked);
$('setPerf').checked = !!settings.perf; show('perf', !!settings.perf);
// playing together: how long a message takes to the lobby owner and back (the owner sees everyone's)
function pingHost(dt) {
  if (!MP.on || MP.host || !MP.hostConn) return;
  if ((MP.pingT = (MP.pingT || 0) - dt) > 0) return;
  MP.pingT = 2; send(MP.hostConn, { t: 'pi', s: performance.now() });
}
