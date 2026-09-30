/* Escape from Barbi Blue: Playing together: pings, dances, and helping from beyond.
     ping   - Q (or the 📍 button) marks the spot you're looking at, for everyone, for 8 seconds. Looking at her it says
              "She's here!", at a puzzle box "Puzzle". A marker off the screen sits at its edge, pointing the way.
     dances - hold R (or tap 💬): a wheel of eight dances. Point at one with the mouse and let go (or click, or tap it):
              your figure dances for everyone, and your camera pulls back so you can see it. Moving stops it.
     beyond - out of the game you watch the others (click / tap, or ← →, to switch), and once every 30 seconds you can
              warn them (G, or WARN): everyone sees where she is, right now.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

// [name, icon, animation (js/barbi-anim.js)]
const DANCES = [['Floss', '🕺', 'd_floss'], ['Robot', '🤖', 'd_robot'], ['Disco', '🪩', 'd_disco'], ['Chicken', '🐔', 'd_chicken'],
  ['Wave', '🌊', 'd_wave'], ['Twist', '🌀', 'd_twist'], ['Air guitar', '🎸', 'd_guitar'], ['Hype', '🙌', 'd_hype']];
const DANCE_MAX = 30;                                   // (seconds: a dance stops by itself after this)
const PING_LIFE = 8, WARN_COOL = 30, PING_KINDS = {
  her: { label: "She's here!", col: '255,90,90' }, pz: { label: 'Puzzle', col: '255,190,85' },
  go: { label: 'Here', col: '232,236,255' }, ghost: { label: "👻 She's here", col: '143,208,255' } };
const team = { pings: [], sentAt: {}, warnCool: 0, sent: 0 };

function resetTeam() { team.pings = []; team.warnCool = 0; closeWheel(false); }
// (no spamming: one ping every 0.6 seconds, in real time)
function teamReady(k) { const now = performance.now(); if (now - (team.sentAt[k] || 0) < 600) return false; team.sentAt[k] = now; return true; }
function updateTeam(dt) {
  team.warnCool = Math.max(0, team.warnCool - dt);
  for (const q of team.pings) q.t -= dt;
  team.pings = team.pings.filter(q => q.t > 0);
  // your dance: moving, hiding, going down (or half a minute) ends it
  const p = player;
  if (p.dance >= 0) { p.danceT += dt; if (p.moving || p.hidden || p.down || p.dead || !MP.on || p.danceT > DANCE_MAX) stopDance(); }
  const on = MP.on && MP.inGame && state === 'play', dead = on && player.dead;
  teamButtons(on && !dead, on && !dead && !player.down, dead);
}
let teamBtnState = '';
function teamButtons(ping, emote, warn) {
  const k = [ping, emote, warn, warn && team.warnCool > 0 ? Math.ceil(team.warnCool) : 0].join();
  if (k === teamBtnState) return; teamBtnState = k;
  show('pingBtn', ping); show('emoteBtn', emote); show('warnBtn', warn);
  if (!emote) closeWheel(false);
  if (warn) { const b = $('warnBtn'); b.disabled = team.warnCool > 0; b.textContent = team.warnCool > 0 ? Math.ceil(team.warnCool) + 's' : 'WARN'; }
}
/* ---------- the dance wheel ---------- */
// eight dances in a ring, the first at the top, clockwise. With the mouse captured, moving it points at one (it doesn't turn
// the view while the wheel is open); letting go of the key, or a click, sends it. With a cursor or a finger: point, or tap one
const wheel = { open: false, byKey: false, vx: 0, vy: 0, sel: -1 };
DANCES.forEach(([txt, icon], i) => { const b = document.createElement('button'), a = i / DANCES.length * Math.PI * 2;
  b.className = 'seg'; b.dataset.i = i; b.innerHTML = '<i></i><span></span>'; b.firstChild.textContent = icon; b.lastChild.textContent = txt;
  b.style.left = (50 + Math.sin(a) * 38) + '%'; b.style.top = (50 - Math.cos(a) * 38) + '%';
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); wheel.sel = i; closeWheel(true); });
  b.addEventListener('pointerenter', () => { if (wheel.open) { wheel.sel = i; wheelShow(); } });
  $('emoteRing').appendChild(b); });
function openWheel(byKey) {
  if (!MP.on || !MP.inGame || state !== 'play' || MP.menu || pzOpen || wheel.open) return;
  Object.assign(wheel, { open: true, byKey, vx: 0, vy: 0, sel: -1 }); show('emoteRing', true); $('emoteBtn').classList.add('on'); wheelShow();
}
function closeWheel(send) {
  if (!wheel.open) return; wheel.open = false; show('emoteRing', false); $('emoteBtn').classList.remove('on');
  if (send && wheel.sel >= 0) startDance(wheel.sel);
}
function wheelMove(dx, dy) {
  wheel.vx = clamp(wheel.vx + dx, -150, 150); wheel.vy = clamp(wheel.vy + dy, -150, 150);
  const d = Math.hypot(wheel.vx, wheel.vy), n = DANCES.length;
  wheel.sel = d < 30 ? -1 : ((Math.round(Math.atan2(wheel.vx, -wheel.vy) / (Math.PI * 2 / n)) % n) + n) % n;
  wheelShow();
}
function wheelShow() {
  document.querySelectorAll('#emoteRing .seg').forEach(b => b.classList.toggle('on', +b.dataset.i === wheel.sel));
  $('emoteHub').textContent = wheel.sel >= 0 ? DANCES[wheel.sel][0] : (canLock ? 'point with the mouse' : 'tap one');
}
// a click with the mouse captured sends what's pointed at; a click on the empty middle closes it
document.addEventListener('mousedown', e => { if (wheel.open && locked()) { e.stopImmediatePropagation(); closeWheel(true); } }, true);
$('emoteRing').addEventListener('pointerdown', e => { if (e.target.id === 'emoteRing' || e.target.id === 'emoteHub') closeWheel(false); });

/* ---------- sending ---------- */
function doPing() {
  if (!MP.on || !MP.inGame || state !== 'play' || MP.menu || pzOpen) return;
  if (player.dead) { warnTeam(); return; }
  if (!teamReady('ping')) return;
  const at = pingTarget(); team.sent++;
  toHost({ t: 'ping', x: Math.round(at.x), y: Math.round(at.y), k: at.k });
}
// dancing: your state (player.dance) goes out with your position, ~15 times a second, so everyone sees it (js/multiplayer.js)
function startDance(i) {
  const p = player; if (!MP.on || !MP.inGame || state !== 'play' || !DANCES[i] || p.hidden || p.down || p.dead) return;
  p.dance = i; p.danceT = 0; team.sent++; setSprint(false);
}
function stopDance() { player.dance = -1; player.danceT = 0; }
function warnTeam() {
  if (!MP.on || !player.dead || team.warnCool > 0) return;
  if (!monster.active) { showMsg("She isn't anywhere right now.", 2); return; }
  team.warnCool = WARN_COOL; toHost({ t: 'warn' });
}
// what you're pointing at: her (in sight, in front of you), a puzzle box, or the floor in front of the first wall you look at
function pingTarget() {
  const p = player, m = monster, ahead = (x, y, cone) => Math.abs(angDiff(Math.atan2(y - p.y, x - p.x), p.ang)) < cone && los(p.x, p.y, x, y);
  if (m.active && Math.hypot(m.x - p.x, m.y - p.y) < 700 && ahead(m.x, m.y, 0.3)) return { x: m.x, y: m.y, k: 'her' };
  for (const t of hintTargets()) if (Math.hypot(t.x - p.x, t.y - p.y) < 500 && ahead(t.x, t.y, 0.2)) return { x: t.x, y: t.y, k: 'pz' };
  let x = p.x, y = p.y; const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
  for (let i = 0; i < 12 * T / 5; i++) { const nx = x + ca * 5, ny = y + sa * 5; if (blocked(nx, ny, 6)) break; x = nx; y = ny; }
  return { x, y, k: 'go' };
}

/* ---------- the host passes them on ---------- */
function teamRate(q, k) { const now = performance.now(), at = q.teamAt || (q.teamAt = {}); if (now - (at[k] || 0) < 400) return false; at[k] = now; return true; }
function hostPing(id, m) {
  const q = meOrOther(id); if (!q || !MP.inGame || !teamRate(q, 'ping')) return;
  const k = m.k === 'her' || m.k === 'pz' ? m.k : 'go', num = v => Number.isFinite(+v) ? +v : 0;
  hostEmit({ t: 'ping', by: id, x: clamp(num(m.x), 0, GW * T), y: clamp(num(m.y), 0, GH * T), k });
}
function hostWarn(id) {
  const q = meOrOther(id), now = performance.now(); if (!q || !q.dead || !MP.inGame || !monster.active) return;
  if (now - (q.warnAt || -1e9) < (WARN_COOL - 1) * 1000) return; q.warnAt = now;
  hostEmit({ t: 'ping', by: id, x: Math.round(monster.x), y: Math.round(monster.y), k: 'ghost' });
}

/* ---------- receiving ---------- */
function gotPing(m) {
  if (!PING_KINDS[m.k]) return;
  team.pings = team.pings.filter(q => q.by !== m.by);        // (one ping each: a new one replaces your last)
  team.pings.push({ x: m.x, y: m.y, k: m.k, by: m.by, name: m.by === MP.myId ? 'You' : nameOf(m.by), t: PING_LIFE });
  sfx.ping({ x: m.x, y: m.y }, m.k === 'her' || m.k === 'ghost');
  if (m.k === 'ghost') { if (m.by === MP.myId) unlock('ghost'); else showMsg(nameOf(m.by) + "'s ghost shows you where she is.", 3); }
  else if (m.k === 'her' && m.by !== MP.myId) showMsg(nameOf(m.by) + ": She's here!", 2.5);
}

/* ---------- drawing (on top of the 3D view) ---------- */
// a point in the house (world units, h metres up) on the 2D overlay: its position, and whether it's behind you
function toScreen(x, y, h) {
  const v = _v.set(x * S, h, y * S).project(camera), behind = v.z > 1;
  let sx = (v.x + 1) / 2 * cvs.width, sy = (1 - v.y) / 2 * cvs.height;
  if (behind) { sx = cvs.width - sx; sy = cvs.height - sy; }
  return { x: sx, y: sy, behind };
}
function drawTeamMarks(t) {   // (pings)
  const D = DPR, cw = cvs.width, ch = cvs.height, p = player, pad = 34 * D;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const q of team.pings) {
    const K = PING_KINDS[q.k], s = toScreen(q.x, q.y, q.k === 'her' || q.k === 'ghost' ? 1.7 : 0.9), a = Math.min(1, q.t / 1.5);
    let x = s.x, y = s.y; const off = s.behind || x < pad || x > cw - pad || y < pad || y > ch - pad;
    if (off) {                                    // off the screen: at the edge, an arrow pointing the way
      const dx = x - cw / 2, dy = y - ch / 2, k = Math.min((cw / 2 - pad) / Math.abs(dx || 1e-6), (ch / 2 - pad) / Math.abs(dy || 1e-6));
      x = cw / 2 + dx * k; y = ch / 2 + dy * k;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx)); ctx.fillStyle = 'rgba(' + K.col + ',' + 0.9 * a + ')';
      ctx.beginPath(); ctx.moveTo(22 * D, 0); ctx.lineTo(12 * D, -7 * D); ctx.lineTo(12 * D, 7 * D); ctx.fill(); ctx.restore();
    }
    const r = (9 + 2 * Math.sin(t * 6)) * D;
    ctx.strokeStyle = 'rgba(' + K.col + ',' + a + ')'; ctx.lineWidth = 2.5 * D; ctx.fillStyle = 'rgba(0,0,0,' + 0.45 * a + ')';
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(' + K.col + ',' + a + ')'; ctx.font = '600 ' + 12 * D + 'px system-ui,sans-serif';
    ctx.fillText(K.label, x, y - r - 10 * D);
    ctx.fillStyle = 'rgba(230,230,240,' + 0.8 * a + ')'; ctx.font = 11 * D + 'px system-ui,sans-serif';
    ctx.fillText(q.name + ' · ' + Math.round(Math.hypot(q.x - p.x, q.y - p.y) * S) + ' m', x, y + r + 11 * D);
  }
  ctx.restore();
}
