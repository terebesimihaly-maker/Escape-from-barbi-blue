/* Escape from Barbi Blue: jump scares. Rare, never while she's after you, never with text on the screen.
     doll    - a doll you were looking at is gone when you look back. Turn around: it's sitting right behind you.
     phantom - at the far end of a long corridor, she's peeking around the corner. The flashlight stutters and she's gone.
               (only an apparition: it only happens while the real her is far away and out of sight)
     ceiling - heavy footsteps cross the floor above you, dust comes down, then something is dragged away.
     dark    - every light dies. When they come back, she is standing right in front of you. Then dark again, and she's gone.
     dash    - she sprints across a junction ahead of you, and is gone.
     breath  - breathing right behind you. Turn around: nothing there.
     door    - a wardrobe door nearby creaks open by itself... and slams shut.
   Each player gets their own (in multiplayer they're not shared). */
'use strict';

const scares = { next: 30, active: null, doll: null, phantom: null, steps: null, dim: 1, log: [], dust: null, app: null, s: null };
const SCARE_GAP = [35, 60];                  // seconds between two scares

function resetScares() {
  scares.next = rnd(20, 30); scares.active = null; scares.doll = null; scares.phantom = null; scares.steps = null; scares.dim = 1; scares.app = null; scares.s = null;
  if (scares.dust) scares.dust.visible = false;
}
// is this point (in world units, at height h metres) in front of you, and not behind a wall?
function inView(x, y, h, cone) {
  const cam = camera, f = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
  const dx = x * S - cam.position.x, dy = h - cam.position.y, dz = y * S - cam.position.z, d = Math.hypot(dx, dy, dz) || 1;
  return (dx * f.x + dy * f.y + dz * f.z) / d > (cone || 0.75) && los(player.x, player.y, x, y);
}
function scareCalm() {
  const p = player, m = monster;
  return state === 'play' && !p.hidden && !p.down && !p.dead && !closetScene && !(MP.on && MP.menu) &&
    !(m.active && (m.state === 'chase' || m.state === 'hunt' || m.state === 'check'));
}

/* ---------- the doll ---------- */
function startDoll() {
  const ds = level && level.house ? level.house.dolls : [];
  const d = ds.find(d => { const x = d.obj.position.x / S, y = d.obj.position.z / S, dist = Math.hypot(x - player.x, y - player.y) * S;
    return d.obj.visible && dist > 2.5 && dist < 8 && inView(x, y, d.headWorld.y, 0.8); });
  if (!d) return false;
  scares.doll = { d, phase: 'watch', away: 0, t: 0, home: d.obj.position.clone(), homeRy: d.obj.rotation.y };
  return true;
}
function updateDoll(dt) {
  const s = scares.doll, d = s.d, p = player; s.t += dt;
  const x = d.obj.position.x / S, y = d.obj.position.z / S, seen = d.obj.visible && inView(x, y, d.headWorld.y, 0.6);
  s.away = seen ? 0 : s.away + dt;
  if (s.phase === 'watch') {                          // wait until you look away...
    if (s.t > 20) return endScare();
    if (s.away > 0.7) {                               // ...then it moves: onto the floor right behind you, facing you
      const bx = p.x - Math.cos(p.ang) * 66, by = p.y - Math.sin(p.ang) * 66;       // (3 m: close, but where you'll see it)
      if (!blocked(bx, by, 8) && los(p.x, p.y, bx, by) && !inView(bx, by, 0.3, 0.2)) {
        d.obj.position.set(bx * S, 0, by * S); d.obj.rotation.y = Math.atan2(p.x - bx, p.y - by); s.phase = 'behind';
      } else { d.obj.visible = false; s.phase = 'gone'; }
      d.ry = d.obj.rotation.y; d.head.rotation.y = 0; d.obj.updateMatrixWorld(true); d.head.getWorldPosition(d.headWorld); s.t = 0;
    }
  } else if (s.phase === 'behind') {                  // you turn around: it's there
    if (seen && !s.found) { s.found = true; sfx.sting(0.55); sfx.whisper(0.08, { x, y, h: 0.4 }); shake = Math.max(shake, 3); if (navigator.vibrate) navigator.vibrate(80); }
    if ((s.found && s.away > 0.5) || s.t > 14) { d.obj.visible = false; endScare(); }   // look away again: gone for good
  } else if (s.phase === 'gone') {                    // no room behind you: it's just gone from where it was
    const hx = s.home.x / S, hy = s.home.z / S;
    if (inView(hx, hy, s.home.y + 0.3, 0.7)) { sfx.whisper(0.1, { x: hx, y: hy, h: s.home.y + 0.4 }); endScare(); } else if (s.t > 15) endScare();
  }
}

/* ---------- her, at the end of the corridor ---------- */
function startPhantom() {
  const p = player, m = monster;
  if (!barbi || !barbi.model) return false;
  if (m.active && (Math.hypot(m.x - p.x, m.y - p.y) < T * 8 || los(p.x, p.y, m.x, m.y))) return false;
  // look straight down a corridor (within ~20 degrees of one of the four directions)
  const q = Math.round(p.ang / (Math.PI / 2)), a = q * Math.PI / 2;
  if (Math.abs(angDiff(p.ang, a)) > 0.35) return false;
  const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
  let tx = Math.floor(p.x / T), ty = Math.floor(p.y / T), n = 0;
  // (not too far: past ~6 tiles the fog swallows her)
  while (n < 6 && !isWall(tx + dx, ty + dy)) { tx += dx; ty += dy; n++; }
  if (n < 4) return false;
  // at the end: half out of a side doorway if there is one, otherwise against the far wall
  let side = 0;
  for (const s of [1, -1]) if (!side && !isWall(tx - dy * s, ty + dx * s)) side = s;
  let x = tx * T + T / 2 - dx * 6, y = ty * T + T / 2 - dy * 6;
  if (side) { x += -dy * side * T * 0.42; y += dx * side * T * 0.42; }
  if (!los(p.x, p.y, x, y)) return false;
  scares.phantom = { x, y, ang: Math.atan2(p.y - y, p.x - x), t: 0, seen: 0, looked: false };
  return true;
}
function updatePhantom(dt) {
  const s = scares.phantom, p = player, m = monster; s.t += dt;
  const d = Math.hypot(s.x - p.x, s.y - p.y), real = m.active && Math.hypot(m.x - p.x, m.y - p.y) < T * 6;
  if (inView(s.x, s.y, 1.6, 0.82)) { s.seen += dt; s.looked = true; }
  // you've seen her (or come too close, or looked away for long): the flashlight stutters and she's gone
  if (s.seen > 0.45 || d < T * 3 || real || (s.looked && s.seen === 0) || s.t > 4) {
    if (s.looked) { flickTarget = 0.06; flickT = 0.35; sfx.buzz(); shake = Math.max(shake, 2); }
    scares.phantom = null; endScare(s.looked); return;
  }
  if (s.looked && !inView(s.x, s.y, 1.6, 0.82)) s.seen = 0;
}
// render3D calls this after placing her: while the apparition is up, she's drawn there instead
function drawPhantom() {
  const s = scares.app || scares.phantom; if (!barbi) return;
  if (scares.app && !scares.app.show) { barbi.obj.visible = false; return; }
  if (!s) return;
  barbi.obj.visible = true; barbi.obj.position.set(s.x * S, 0, s.y * S); barbi.obj.rotation.y = Math.PI / 2 - s.ang;
  setEyes(0.9);
}
// she's far away and can't see you (the apparitions need her out of the way)
const herAway = () => { const m = monster, p = player; return !m.active || (Math.hypot(m.x - p.x, m.y - p.y) > T * 8 && !los(p.x, p.y, m.x, m.y)); };

/* ---------- every light dies; she's in front of you when they come back ---------- */
function startDark() {
  const p = player; if (!barbi || !herAway()) return false;
  const x = p.x + Math.cos(p.ang) * 50, y = p.y + Math.sin(p.ang) * 50;          // (about 2 m in front)
  if (blocked(x, y, 10) || !los(p.x, p.y, x, y)) return false;
  scares.s = { t: 0, x, y, stung: false }; sfx.buzz(); return true;
}
function updateDark(dt) {
  const s = scares.s, p = player; s.t += dt;
  const out = s.t < 1.7 || (s.t > 2.25 && s.t < (calm() ? 2.25 : 2.55));             // (dark, her, dark, light)
  scares.dim = out ? (calm() ? Math.max(0.15, 1 - s.t) : 0) : 1;
  if (s.t >= 1.7 && s.t < 2.25) {                          // the lights are back: she's right there, looking at you
    scares.app = { x: s.x, y: s.y, ang: Math.atan2(p.y - s.y, p.x - s.x), anim: 'idle', show: true };
    if (!s.stung) { s.stung = true; sfx.sting(1); if (!songOn) sfx.scream(0.35); shake = Math.max(shake, 6); if (navigator.vibrate) navigator.vibrate([80, 40, 160]); }
  } else if (s.t >= 2.25) scares.app = { show: false };
  if (s.t > 2.7) { scares.dim = 1; scares.app = null; scares.s = null; endScare(true); }
}

/* ---------- she runs across a junction ahead ---------- */
function startDash() {
  const p = player; if (!barbi || !herAway()) return false;
  const q = Math.round(p.ang / (Math.PI / 2)), a = q * Math.PI / 2; if (Math.abs(angDiff(p.ang, a)) > 0.4) return false;
  const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
  let tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
  for (let n = 1; n <= 5; n++) { tx += dx; ty += dy; if (isWall(tx, ty)) return false;
    if (n >= 2 && !isWall(tx - dy, ty + dx) && !isWall(tx + dy, ty - dx)) {            // a crossing: open on both sides
      const cx = (tx + 0.5) * T, cy = (ty + 0.5) * T, side = Math.random() < 0.5 ? 1 : -1;
      scares.s = { t: 0, x0: cx - dy * side * T * 1.2, y0: cy + dx * side * T * 1.2, x1: cx + dy * side * T * 1.2, y1: cy - dx * side * T * 1.2, stepT: 0 };
      if (!los(p.x, p.y, cx, cy)) return false; return true; } }
  return false;
}
function updateDash(dt) {
  const s = scares.s; s.t += dt; const k = Math.min(1, s.t / 0.6), x = s.x0 + (s.x1 - s.x0) * k, y = s.y0 + (s.y1 - s.y0) * k;
  scares.app = { x, y, ang: Math.atan2(s.y1 - s.y0, s.x1 - s.x0), anim: 'chase', show: k < 1 };
  s.stepT -= dt; if (s.stepT <= 0 && k < 1) { s.stepT = 0.14; sfx.herStep(x, y, true, false); }
  if (s.t > 1) { scares.app = null; scares.s = null; endScare(true); }
}

/* ---------- breathing right behind you ---------- */
function startBreath() { if (!herAway()) return false; scares.s = { t: 0, n: 0, a0: player.ang }; return true; }
function updateBreath(dt) {
  const s = scares.s, p = player; s.t += dt;
  const bx = p.x - Math.cos(p.ang) * 16, by = p.y - Math.sin(p.ang) * 16;           // (always just behind your head)
  if (s.n < 3 && s.t > s.n * 1.1) { s.n++; sfx.breath({ x: bx, y: by, h: 1.7 }); if (s.n === 3) shake = Math.max(shake, 1.5); }
  // you turn around: nothing. A giggle from somewhere else.
  if (s.t > 1 && Math.abs(angDiff(p.ang, s.a0)) > 2.2 && !s.turned) { s.turned = true; sfx.whisper(0.08, { x: p.x + Math.cos(p.ang) * 150, y: p.y + Math.sin(p.ang) * 150, h: 1.5 }); }
  if (s.t > 5) { scares.s = null; endScare(true); }
}

/* ---------- a wardrobe door opens by itself ---------- */
function startDoor() {
  const c = closets.find(c => c.doors && !(player.hidden && player.closet === c) && Math.hypot(c.x - player.x, c.y - player.y) < T * 4 && inView(c.x, c.y, 1.2, 0.6));
  if (!c) return false; scares.s = { t: 0, c, creak: false, slam: false }; return true;
}
function updateDoor(dt) {
  const s = scares.s; s.t += dt;
  if (!s.creak) { s.creak = true; sfx.creak(0.2, { x: s.c.x, y: s.c.y, h: 1.2 }); }
  s.open = s.t < 2.5 ? (s.t / 2.5) * 0.7 : s.t < 4 ? 0.7 : Math.max(0, 0.7 - (s.t - 4) * 6);
  if (s.t > 4.1 && !s.slam) { s.slam = true; sfx.thump(0.8); shake = Math.max(shake, 4); }
  if (s.t > 4.5) { scares.s = null; endScare(true); }
}
// (js/render.js asks how far a wardrobe's door is open)
const scareDoorOpen = c => scares.active === 'door' && scares.s && scares.s.c === c ? scares.s.open || 0 : 0;

/* ---------- footsteps on the floor above ---------- */
function startCeiling() {
  const p = player, a = p.ang + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;      // they cross over you, from one side to the other
  scares.steps = { n: 0, of: 7, t: 0.2, x0: p.x + Math.cos(a) * 120, y0: p.y + Math.sin(a) * 120, x1: p.x - Math.cos(a) * 120, y1: p.y - Math.sin(a) * 120 };
  if (!scares.dust) {                               // a little dust shaken loose from the ceiling
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
    scares.dust = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.018, color: 0x8a847a, transparent: true, opacity: 0.8, depthWrite: false }));
    scares.dust.frustumCulled = false; scares.dust.userData.v = new Float32Array(60); scene.add(scares.dust);
  }
  scares.dust.visible = false;
  return true;
}
function updateCeiling(dt) {
  const s = scares.steps; s.t -= dt;
  if (s.t <= 0 && s.n < s.of) {
    const k = s.n / (s.of - 1), x = s.x0 + (s.x1 - s.x0) * k, y = s.y0 + (s.y1 - s.y0) * k, near = 1 - Math.abs(k - 0.5) * 1.2;
    sfx.ceilingStep(0.35 * near + 0.1, { x, y, h: WALL_H + 0.4 });
    if (Math.abs(k - 0.5) < 0.2) { shake = Math.max(shake, 1.5); dropDust(x, y); }
    s.n++; s.t = s.n === s.of ? 0.9 : 0.62 + Math.random() * 0.1;
  } else if (s.t <= 0 && s.n === s.of) { s.n++; sfx.drag(0.12, { x: s.x1, y: s.y1, h: WALL_H + 0.4 }); s.t = 2.2; }
  else if (s.t <= 0) { scares.steps = null; endScare(true); }
  const dp = scares.dust;
  if (dp && dp.visible) { const pos = dp.geometry.attributes.position, v = dp.userData.v;
    for (let i = 0; i < pos.count; i++) { v[i] += dt * 1.6; pos.setY(i, Math.max(0.02, pos.getY(i) - v[i] * dt)); } pos.needsUpdate = true; }
}
function dropDust(x, y) {
  const dp = scares.dust, pos = dp.geometry.attributes.position, v = dp.userData.v;
  for (let i = 0; i < pos.count; i++) { pos.setXYZ(i, (x + rnd(-25, 25)) * S, WALL_H - rnd(0, 0.3), (y + rnd(-25, 25)) * S); v[i] = rnd(0, 0.4); }
  pos.needsUpdate = true; dp.visible = true;
}

/* ---------- the director ---------- */
const SCARES = { doll: [startDoll, updateDoll], phantom: [startPhantom, updatePhantom], ceiling: [startCeiling, updateCeiling],
  dark: [startDark, updateDark], dash: [startDash, updateDash], breath: [startBreath, updateBreath], door: [startDoor, updateDoor] };
function startScare(k) { if (!SCARES[k][0]()) return false; scares.active = k; scares.log.push(k); return true; }
function endScare(counted) { scares.active = null; scares.doll = null; scares.next = counted === false ? rnd(8, 15) : rnd(SCARE_GAP[0], SCARE_GAP[1]); }
function updateScares(dt) {
  if (!level || state !== 'play') return;
  if (scares.active) {
    if (!scareCalm() && scares.active !== 'ceiling') {   // she's after you: drop it (a doll that moved stays where it is)
      if (scares.active === 'doll' && scares.doll.phase === 'behind') scares.doll.d.obj.visible = false;
      scares.phantom = null; scares.app = null; scares.s = null; scares.dim = 1; endScare(false); return; }
    SCARES[scares.active][1](dt); return;
  }
  if (scares.dust && scares.dust.visible) updateCeilingDustOnly(dt);
  scares.next -= dt;
  if (scares.next > 0) return;
  if (!scareCalm()) { scares.next = 3; return; }
  // the doll only where there are dolls, and the one you haven't had for a while first
  const order = shuffle(Object.keys(SCARES)).sort((a, b) => scares.log.lastIndexOf(a) - scares.log.lastIndexOf(b));
  for (const k of order) if (startScare(k)) return;
  scares.next = 4;                                     // nothing fits right now: try again in a moment
}
function updateCeilingDustOnly(dt) {
  const dp = scares.dust, pos = dp.geometry.attributes.position, v = dp.userData.v; let any = false;
  for (let i = 0; i < pos.count; i++) { v[i] += dt * 1.6; const y = Math.max(0.02, pos.getY(i) - v[i] * dt); pos.setY(i, y); if (y > 0.02) any = true; }
  pos.needsUpdate = true; if (!any) dp.visible = false;
}
scares.force = k => { scares.active = null; scares.phantom = null; scares.doll = null; scares.app = null; scares.s = null; scares.dim = 1; return startScare(k); };
