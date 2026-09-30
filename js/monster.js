/* Escape from Barbi Blue: her AI.
     wander - a slow, stalking walk around the house
     hunt   - she heard you: she runs to where you're going (not where you were), to cut you off
     chase  - she sees you
     search - she lost you: first the way you were heading, then the wardrobes near where she lost you
              (stopping at each door to listen: 'check'), stopping now and then to listen, then nearby rooms
     leave  - she gave up... or so it sounds: she walks off, her footsteps and her song fading as if she's far away
     lurk   - ...and waits around the corner, silent, for whoever comes out of the wardrobe first
   She hears someone breathing in a wardrobe right next to her (unless they hold their breath: js/stealth.js).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

function randomCellNear(pt, r) {
  const tx = Math.floor(pt.x / T), ty = Math.floor(pt.y / T);
  const c = CELLS.filter(c => Math.abs(c[0] - tx) + Math.abs(c[1] - ty) <= r * 2);
  return center((c.length ? c : CELLS)[Math.random() * (c.length || CELLS.length) | 0]);
}

// the tile you'd reach by carrying on in direction (dx, dy) for up to n tiles (stops at walls)
function aheadOf(pt, dx, dy, n) {
  let tx = Math.floor(pt.x / T), ty = Math.floor(pt.y / T);
  const sx = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0, sy = sx ? 0 : Math.sign(dy);
  for (let i = 0; i < n && (sx || sy) && !isWall(tx + sx, ty + sy); i++) { tx += sx; ty += sy; }
  return { x: tx * T + T / 2, y: ty * T + T / 2 };
}
// she lost you: where to look, in order
function planSearch(m) {
  const from = m.last || m, fx = Math.floor(from.x / T), fy = Math.floor(from.y / T), d = bfsDist(fx, fy), plan = [];
  // 1. the way you were going: the room furthest along your direction, a few rooms away
  if (m.dir) {
    let best = null, bs = 0.35;
    for (const c of CELLS) { const k = d[idx(c[0], c[1])]; if (k < 2 || k > 10) continue;
      const vx = c[0] - fx, vy = c[1] - fy, l = Math.hypot(vx, vy), sc = (vx * m.dir.x + vy * m.dir.y) / l - k * 0.02;
      if (sc > bs) { bs = sc; best = c; } }
    if (best) plan.push({ at: center(best) });
  }
  // 2. the wardrobes close to where she lost you, nearest first
  closets.map((c, i) => ({ c, i, k: d[idx(Math.floor(c.x / T), Math.floor(c.y / T))] }))
    .filter(w => w.k <= 12 && !m.checked.has(w.i)).sort((a, b) => a.k - b.k).slice(0, 3)
    .forEach(w => plan.push({ at: { x: w.c.x + w.c.ox * 16, y: w.c.y + w.c.oy * 16 }, closet: w.i }));
  m.plan = plan; m.searchT = 8 + plan.length * 4; m.target = null;
}
// she stands at a wardrobe's doors, listening. Is anyone in there? Holding your breath, you're almost always safe
function checkWardrobe(m, k, alive) {
  const q = alive.find(q => q.hidden && q.closet === k); m.checked.add(k);
  if (!q) return;
  if (q.holding) {
    if (Math.random() < DF().check * 0.15) { downPlayer(q, 'She heard your heart pounding.'); return; }
    award(q.id, 'breath', 'She listens at the doors... and moves on.'); return; }
  if (!MP.on && q.me && sceneCool <= 0) {                // single player: "I know you're in here..."
    closetScene = { t: 0, spoke: false }; return; }
  if (Math.random() < Math.min(0.9, DF().check * 1.6)) downPlayer(q, 'She heard you breathing.');   // (in multiplayer the others can still revive you)
}
// she gives up the search with someone hiding close by: sometimes she only pretends to leave. She walks off (sounding further
// and further away) to a spot around a corner, 3 to 5 tiles from their wardrobe and out of its sight, and waits there, silent
function startFakeLeave(m, q) {
  const dq = bfsDist(Math.floor(q.x / T), Math.floor(q.y / T)), spots = [];
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const k = dq[idx(x, y)];
    if (k >= 3 && k <= 5 && !los(q.x, q.y, x * T + T / 2, y * T + T / 2)) spots.push([x, y]); }
  if (!spots.length) return false;
  m.state = 'leave'; m.target = center(spots[Math.random() * spots.length | 0]); m.fakeT = 20; m.fakeFor = q.id; m.fakeCool = 60;   // (fakeT: in case she somehow can't get there)
  m.path = []; m.repath = 0; m.plan = []; m.checked.clear(); m.fakes = (m.fakes || 0) + 1;
  return true;
}

function updateMonster(dt) {
  const m = monster, p = player, n = MP.on ? MP.n : 1;
  const everyone = allPlayers(), alive = everyone.filter(q => !q.down && !q.dead), me = everyone[0];
  if (!m.active) { m.spawnT -= dt;
    if (m.spawnT <= 0) {
      if (m.relocate) { m.relocate = false;
        const far = CELLS.map(center).filter(c => everyone.every(q => Math.hypot(c.x - q.x, c.y - q.y) > T * 8));
        const c = far.length ? far[Math.random() * far.length | 0] : center(CELLS[Math.random() * CELLS.length | 0]);
        m.x = c.x; m.y = c.y; m.target = null; }
      m.active = true; showMsg('Somewhere in the house, a music box starts playing.', 3); }
    return; }
  // together she hears a little further and moves a little faster (but a sprinting player can always get away from her)
  const D = DF(), hearMul = (1 + 0.05 * (n - 1)) * D.hear, spdMul = (1 + 0.03 * (n - 1)) * D.speed;
  const dist = q => Math.hypot(q.x - m.x, q.y - m.y);
  let seen = null, sd = 1e9;
  for (const q of alive) if (!q.hidden) { const d = dist(q); if (d < D.sight && d < sd && los(m.x, m.y, q.x, q.y)) { sd = d; seen = q; } }
  // she remembers which way you were going (from where she last saw or heard you)
  const track = q => {
    if (m.ti === q.id && m.last) { const vx = q.x - m.last.x, vy = q.y - m.last.y, l = Math.hypot(vx, vy);
      if (l > 2) { const k = m.dir ? 0.3 : 1; m.dir = { x: (m.dir ? m.dir.x : 0) * (1 - k) + vx / l * k, y: (m.dir ? m.dir.y : 0) * (1 - k) + vy / l * k };
        const dl = Math.hypot(m.dir.x, m.dir.y) || 1; m.dir.x /= dl; m.dir.y /= dl; } }
    else if (m.ti !== q.id) m.dir = null;
    m.last = { x: q.x, y: q.y }; m.ti = q.id;
  };
  if (seen) {
    if ((m.state !== 'chase' || m.ti !== seen.id) && seen.me) { sfx.sting(); shake = Math.max(shake, 5); if (navigator.vibrate) navigator.vibrate(120); }
    track(seen); m.state = 'chase'; m.seenT = 0; m.heard = false; m.listenT = 0;
  } else {
    m.seenT += dt;
    let hd = 1e9, heard = null;
    const listening = m.listenT > 0 ? 2 : 1;               // (standing still and listening, she hears further)
    for (const q of alive) { if (q.hidden || !q.moving) continue;
      const d = dist(q), hear = (q.sprinting ? 300 : 70 * listening) * hearMul;
      if (d < hear && d < hd) { hd = d; heard = q; } }
    if (heard) { track(heard); m.heard = true; m.listenT = 0; if (m.state !== 'chase') m.state = 'hunt'; }
  }
  // someone breathing in a wardrobe right next to her: she stops, listens... and goes to open that one
  m.bh = m.bh || {}; m.fakeCool -= dt;
  for (const q of alive) {
    if (!q.hidden || q.holding || q.closet < 0 || m.state === 'chase' || m.state === 'check' || dist(q) > 75 * D.hear) { m.bh[q.id] = 0; continue; }
    if ((m.bh[q.id] = (m.bh[q.id] || 0) + dt) > 1.8) { const c = closets[q.closet]; m.bh[q.id] = 0; m.fakeFor = null;
      m.state = 'search'; m.checked.delete(q.closet); m.plan = []; m.listenT = 0; m.searchT = Math.max(m.searchT, 6);
      m.target = { x: c.x + c.ox * 16, y: c.y + c.oy * 16, closet: q.closet }; }
  }
  if (m.huntT > 0) { m.huntT -= dt;
    let best = null, bd = 1e9; for (const q of alive) if (!q.hidden) { const d = dist(q); if (d < bd) { bd = d; best = q; } }
    if (best) { track(best); if (m.state !== 'chase') m.state = 'hunt'; } }
  // she saw someone climb into a wardrobe: she goes straight for it
  const kcId = MP.on ? m.kc : (m.knowsCloset ? me.id : null), kq = kcId ? alive.find(q => q.id === kcId) : null;
  if (kq && kq.hidden) { m.state = 'chase'; m.last = { x: kq.x, y: kq.y }; m.ti = kq.id; }
  else if (kcId) { m.kc = null; m.knowsCloset = false; }

  const chaseSpd = Math.min(D.speed > 1 ? 165 : 160, (118 + floorIdx * 8 + fusesGot * 3) * spdMul);    // (you sprint at 170)
  let spd = 23 * spdMul, target;                  // wandering: a slow, stalking walk
  if ((m.state === 'chase' || m.state === 'hunt') && !m.last) m.last = { x: m.x, y: m.y };
  if (m.state === 'chase' || m.state === 'hunt') {
    spd = m.state === 'chase' ? chaseSpd : chaseSpd * 0.8; target = m.last;
    // she only heard you: she heads for where you're going, to cut you off (a couple of tiles ahead of you)
    if (m.state === 'hunt' && !seen && m.dir) { const ah = aheadOf(m.last, m.dir.x, m.dir.y, 2);
      if (Math.hypot(ah.x - m.x, ah.y - m.y) > T) target = ah; }
    if (!seen && !kq && Math.hypot(m.x - target.x, m.y - target.y) < 14) { m.state = 'search'; planSearch(m); }
  }
  if (m.state === 'check') {                              // at a wardrobe's doors, listening
    spd = 0; target = m; m.checkT -= dt; const c = closets[m.checking];
    if (c) m.ang = lerpAngle(m.ang, Math.atan2(-c.oy, -c.ox), Math.min(1, dt * 6));
    if (m.checkT <= 0) { m.state = 'search'; checkWardrobe(m, m.checking, alive); if (state !== 'play' && !MP.on) return; }
  }
  if (m.state === 'search') { spd = 26 * spdMul; m.searchT -= dt;
    if (m.listenT > 0) { m.listenT -= dt; spd = 0; }            // standing still, listening
    const hid = m.searchT <= 0 ? alive.find(q => q.hidden && dist(q) < T * 7) : null;
    if (hid && m.fakeCool <= 0 && Math.random() < D.fake && startFakeLeave(m, hid)) { /* (she's "leaving") */ }
    else if (m.searchT <= 0) { m.state = 'wander'; m.target = null; m.plan = []; m.checked.clear(); }
    else {
      if (!m.target || Math.hypot(m.x - m.target.x, m.y - m.target.y) < 8) {
        const done = m.target && m.target.closet !== undefined ? m.target : null;
        if (done) { m.state = 'check'; m.checking = done.closet; m.checkT = 1.8; m.target = null; spd = 0; }
        else {
          if (m.target && Math.random() < 0.35) m.listenT = 1 + Math.random();
          const next = m.plan.shift();
          m.target = next ? Object.assign({ x: next.at.x, y: next.at.y }, next.closet !== undefined ? { closet: next.closet } : {}) : randomCellNear(m.last || m, 4);
        }
      }
      target = m.target || m;
    } }
  if (m.state === 'leave') {                              // "leaving": walking off, sounding further and further away
    spd = 30 * spdMul; target = m.target; m.fakeT -= dt; m.quiet = Math.min(1, m.quiet + dt / 4);
    if (m.fakeT <= 0 || Math.hypot(m.x - m.target.x, m.y - m.target.y) < 10) { m.state = 'lurk'; m.fakeT = rnd(9, 14); m.quiet = 1; }
  }
  if (m.state === 'lurk') {                               // ...and waiting around the corner, silent
    spd = 0; target = m; m.fakeT -= dt;
    const q = everyone.find(q => q.id === m.fakeFor);
    if (q) m.ang = lerpAngle(m.ang, Math.atan2(q.y - m.y, q.x - m.x), Math.min(1, dt * 2));
    if (m.fakeT <= 0) { m.state = 'wander'; m.target = null;             // she really leaves: they didn't fall for it
      if (q && q.hidden && !q.down) award(q.id, 'notfooled', 'Her footsteps fade for real this time.'); m.fakeFor = null; }
  }
  if (m.state !== 'leave' && m.state !== 'lurk' && m.quiet > 0) m.quiet = Math.max(0, m.quiet - dt / 1.5);
  if (m.state === 'wander') {
    if (!m.target || Math.hypot(m.x - m.target.x, m.y - m.target.y) < 8) m.target = center(CELLS[Math.random() * CELLS.length | 0]);
    target = m.target; }

  const tq = seen || kq, tdx = tq ? tq.x - m.x : Math.cos(m.ang), tdy = tq ? tq.y - m.y : Math.sin(m.ang);
  if (m.screamT > 0) {                      // she stops to scream (the animation plays)
    m.screamT -= dt; if (tq) m.ang = lerpAngle(m.ang, Math.atan2(tdy, tdx), Math.min(1, dt * 3));
  } else if (seen && sd < T * 2.2) {
    const a = Math.atan2(tdy, tdx); m.ang = lerpAngle(m.ang, a, Math.min(1, dt * 8));
    moveEntity(m, Math.cos(a) * spd * dt, Math.sin(a) * spd * dt, 12); m.path = []; m.repath = 0;
  } else if (spd > 0) {
    m.repath -= dt;
    const ttx = Math.floor(target.x / T), tty = Math.floor(target.y / T);
    if (m.repath <= 0 || !m.path.length) { m.path = bfsPath(Math.floor(m.x / T), Math.floor(m.y / T), ttx, tty) || []; m.repath = m.state === 'wander' ? 1.5 : 0.3; }
    let gx, gy;
    if (m.path.length) { gx = m.path[0][0] * T + T / 2; gy = m.path[0][1] * T + T / 2; } else { gx = target.x; gy = target.y; }
    const ex = gx - m.x, ey = gy - m.y, el = Math.hypot(ex, ey);
    if (el < 3 && m.path.length) m.path.shift();
    else if (el > 0.5) { const st = Math.min(el, spd * dt); m.x += ex / el * st; m.y += ey / el * st; m.ang = lerpAngle(m.ang, Math.atan2(ey, ex), Math.min(1, dt * 8)); }
  }
  m.anim += dt * spd * 0.05;
  const mv = Math.hypot(m.x - m.px, m.y - m.py); m.px = m.x; m.py = m.y;
  m.vel += ((mv < 20 ? mv / dt : 0) - m.vel) * Math.min(1, dt * 8);
  m.sndAcc = (m.sndAcc || 0) + (mv < 20 ? mv : 0);            // her footsteps: every stride walking, every other when she runs
  if (m.active && m.sndAcc > (m.vel > 60 ? 38 : 17)) { m.sndAcc = 0; sfx.herStep(m.x, m.y, m.vel > 60, m.vel < 60 && m.foot > 0, 1 - herQuiet()); }
  if (mv < 20) { m.stepAcc += mv;
    if (m.stepAcc > 17) { m.stepAcc = 0; m.foot = -m.foot;
      prints.push({ x: m.x + Math.cos(m.ang + 1.57) * 3.5 * m.foot, y: m.y + Math.sin(m.ang + 1.57) * 3.5 * m.foot, a: m.ang, t: 14 });
      if (prints.length > 90) prints.shift(); } }

  const dMe = Math.hypot(p.x - m.x, p.y - m.y);
  if (p.hidden && kcId !== me.id && dMe < 115 && !breathShown && herQuiet() < 0.5) { breathShown = true; showMsg(canLock ? "She's close. Hold your breath: hold Space." : "She's close. Hold your breath: hold BREATH.", 2.5); }
  if (m.screamT > 0) return;
  for (const q of alive) {
    if (dist(q) < 24 && (!q.hidden || kcId === q.id) && !(q.inv > 0)) {
      downPlayer(q, q.hidden ? (m.kcWhy === 'gasp' ? 'She heard you gasp for air.' : 'She saw you climb into the wardrobe.') : ['She was faster.', 'The song got louder. Then it stopped behind you.', 'Now you get to stay forever.'][Math.random() * 3 | 0]);
      return;
    }
  }
}
