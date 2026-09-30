/* Escape from Barbi Blue: Drawing a frame: the camera, her, teammates, props, and the 2D effects on top (wardrobe slats, team arrows, grain).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- drawing a frame ---------- */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _sc = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function draw(sc, cam) {
  if (useBloom) { renderPass.scene = sc; renderPass.camera = cam; composer.render(); }
  else renderer.render(sc, cam);
}
function relPan(x, y) {   // -1 = to your left, 1 = to your right
  const dx = x - player.x, dy = y - player.y, d = Math.hypot(dx, dy) || 1;
  return (-Math.sin(player.ang) * dx + Math.cos(player.ang) * dy) / d;
}
/* ---------- getting into and out of a wardrobe ----------
   The doors swing open, the camera steps in (or out) while they're open, and they close again. The game already has you
   inside (or out) from the first moment: only the picture takes its time. */
const HIDE_T = 0.95, hideAnim = { t: -1, dir: 'in', from: null, c: null };
function startHideAnim(dir, c) {
  const p = player;
  hideAnim.from = dir === 'in' ? { x: p.x, y: p.y, yaw: p.ang, pitch: p.pitch, h: EYE } : insideView(c, 0);
  Object.assign(hideAnim, { t: 0, dir, c }); startSwing(c);
}
// where your eyes are inside a wardrobe, looking out through the slats
function insideView(c, t) { return { x: c.x - c.ox * (CLOSET_FRONT + 5), y: c.y - c.oy * (CLOSET_FRONT + 5), yaw: Math.atan2(c.oy, c.ox), pitch: -0.03, h: 1.55 + Math.sin(t * 1.7) * 0.006 }; }
const startSwing = c => { if (c) c.swingT = 0; };
// how far the doors are open during the swing: quickly open, held while you step through, then pulled shut
function doorSwing(t) {
  if (t < 0 || t > HIDE_T) return 0;
  const e = x => x * x * (3 - 2 * x);
  return t < 0.2 ? e(t / 0.2) : t < 0.55 ? 1 : 1 - e((t - 0.55) / (HIDE_T - 0.55));
}
function placeCamera(t) {
  const p = player;
  let cx = p.x, cy = p.y, yaw = p.ang, pitch = p.pitch, h = EYE;
  if (p.hidden && p.closet) {                    // inside the wardrobe, looking out through the slats
    const c = p.closet; cx = c.x - c.ox * (CLOSET_FRONT + 5); cy = c.y - c.oy * (CLOSET_FRONT + 5);
    const cs = closetScene;
    yaw = Math.atan2(c.oy, c.ox) + (cs ? 0 : p.hideYaw) + Math.sin(t * 0.7) * 0.03;
    pitch = cs ? (cs.t > SC.lean ? 0.02 : 0.1) : -0.03 + p.hidePitch; h = 1.55 + Math.sin(t * 1.7) * 0.006;
  } else if (p.dead && MP.on) {                   // out: watch a teammate who's still standing (tap, or ← →, to switch)
    const w = watched();
    if (w) { cx = w.x - Math.cos(w.ang) * 30; cy = w.y - Math.sin(w.ang) * 30; yaw = w.ang; pitch = -0.25; h = 2.3;
      if (blocked(cx, cy, 2)) { cx = w.x; cy = w.y; h = EYE; pitch = w.pitch; }
      // (the camera glides after them, and to whoever you switch to, instead of jumping)
      const sc = specCam, k = sc.id === w.id ? 1 - Math.exp(-lastDt * 6) : 1 - Math.exp(-lastDt * 3);
      if (!sc.on || Math.hypot(sc.x - cx, sc.y - cy) > T * 12) Object.assign(sc, { x: cx, y: cy, h, yaw, pitch });
      sc.on = true; sc.id = w.id; sc.x += (cx - sc.x) * k; sc.y += (cy - sc.y) * k; sc.h += (h - sc.h) * k;
      sc.yaw = lerpAngle(sc.yaw, yaw, k); sc.pitch += (pitch - sc.pitch) * k;
      cx = sc.x; cy = sc.y; h = sc.h; yaw = sc.yaw; pitch = sc.pitch; }
    else { h = 0.35; }
  } else if (p.down) { h = 0.32 + Math.sin(t * 1.2) * 0.01; pitch = clamp(pitch, -0.3, 1.1); }   // lying on the floor
  else if (p.moving) { h += Math.sin(stepPhase) * (p.sprinting ? 0.045 : p.crouching ? 0.012 : 0.025); yaw += Math.sin(stepPhase * 0.5) * 0.006; }
  crouchCam = clamp(crouchCam + lastDt * (p.crouching && !p.hidden && !p.down && !p.dead ? 5 : -5), 0, 1);   // (crouching: your eyes about a metre from the floor)
  if (!p.hidden && !p.down && !(p.dead && MP.on)) h -= 0.62 * crouchCam * crouchCam * (3 - 2 * crouchCam);
  if (!(p.dead && MP.on)) specCam.on = false;
  if (hideAnim.t >= 0) {                            // stepping into or out of a wardrobe: from where you were to where you are
    hideAnim.t += lastDt; const f = hideAnim.from, k0 = clamp((hideAnim.t - 0.12) / 0.42, 0, 1), k = k0 * k0 * (3 - 2 * k0);
    if (hideAnim.t > HIDE_T || !f) hideAnim.t = -1;
    else { cx = f.x + (cx - f.x) * k; cy = f.y + (cy - f.y) * k; h = f.h + (h - f.h) * k; yaw = lerpAngle(f.yaw, yaw, k); pitch = f.pitch + (pitch - f.pitch) * k; }
  }
  // dancing (js/team.js): the camera slides out in front of you and turns round to watch you (the mouse turns it around you)
  const dancing = p.dance >= 0 && !p.hidden && !p.down && !p.dead;
  danceCam.k = clamp(danceCam.k + lastDt * (dancing ? 2.2 : -4), 0, 1);
  if (danceCam.k > 0 && !p.hidden && !p.down && !p.dead) {
    const e = danceCam.k * danceCam.k * (3 - 2 * danceCam.k), ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    let d = 64; while (d > 18 && (blocked(p.x + ca * d, p.y + sa * d, 5) || !los(p.x, p.y, p.x + ca * d, p.y + sa * d))) d -= 4;   // (never through a wall)
    cx = p.x + ca * d * e; cy = p.y + sa * d * e; h += (1.45 - h) * e; yaw = p.ang + Math.PI * e; pitch += (-0.12 - pitch) * e;
  }
  const sh = calm() ? 0 : shake * 0.01;
  // very afraid: the picture sways and breathes (js/stealth.js; not with "Calm effects")
  const fk = calm() || p.dead ? 0 : fearK(), fk2 = fk * fk;
  camera.position.set(cx * S + rnd(-sh, sh), h + rnd(-sh, sh) * 0.6, cy * S + rnd(-sh, sh));
  camera.rotation.set(pitch + Math.sin(t * 0.9) * 0.02 * fk2, -Math.PI / 2 - yaw, Math.sin(t * 1.1) * 0.05 * fk2);
  const fov = (camera.userData.fov || camera.fov) + Math.sin(t * 0.8) * 5 * fk2;
  if (Math.abs(camera.fov - fov) > 0.01) { if (!camera.userData.fov) camera.userData.fov = camera.fov; camera.fov = fov; camera.updateProjectionMatrix(); }
}
const specCam = { on: false, id: '', x: 0, y: 0, h: 0, yaw: 0, pitch: 0 }, danceCam = { k: 0 };
let crouchCam = 0;
// your own figure (playing together): only shown while you dance, when the camera is out in front of you
function updateMyFigure() {
  if (!MP.on || !playerTemplate || !renderer) return;
  const slot = MP.mySlot || 0, lk = myLook(), key = lk ? JSON.stringify(lk) : '';
  if (!MP.meAv || MP.meAvSlot !== slot || MP.meAvLook !== key) {
    if (MP.meAv) { scene.remove(MP.meAv.obj); MP.meAv.dispose(); }
    MP.meAv = PlayerModel.createHuman(THREE, { slot, name: myName, template: playerTemplate, mocap: mocapData, face: MP.myId, look: lk }); MP.meAvSlot = slot; MP.meAvLook = key; scene.add(MP.meAv.obj);
  }
  const p = player, av = MP.meAv, on = danceCam.k > 0.05 && !p.hidden && !p.down && !p.dead;
  av.obj.position.set(p.x * S, 0, p.y * S); av.obj.rotation.y = Math.PI / 2 - p.ang;
  av.update(lastDt, { speed: 0, dance: p.dance >= 0 ? DANCES[p.dance][2] : null, hidden: !on, lightOn: false });
  av.setName(myName, false);
}
// who you're watching when you're out of the game (MP.spec: tap / ← → to switch)
function watched() {
  const al = [...MP.others.values()].filter(o => !o.down && !o.dead && !o.away);
  return al.length ? al[((MP.spec % al.length) + al.length) % al.length] : null;
}
function render3D(t) {
  const p = player, m = monster;
  if (!level || level.grid !== grid) buildLevel();
  placeCamera(t); setListener(camera);
  // (the flashlight is dimmed to 0 rather than switched off: switching lights on and off makes every material recompile, a stutter)
  flash.intensity = p.hidden || p.dead ? 0 : FLASH_I * (calm() ? 0.8 + 0.2 * flicker : flicker) * (p.down ? 0.5 : 1) * scares.dim;
  aura.intensity = p.hidden ? (closetScene && closetScene.t > 0 ? 3.5 : 3.2) : 1.2 * (p.hidden ? 1 : scares.dim); aura.distance = p.hidden ? 8 : 4.5;

  // her
  if (barbi) {
    putBarbi(scene);
    const sc = closetScene && p.closet ? closetScene : null;
    let mx = m.x, my = m.y, ma = m.ang, show = m.active;
    if (sc) { const c = p.closet, al = sceneAlong(sc.t, c), sd = sceneSide(sc.t);
      // (-oy, ox) is to your right as you look out of the wardrobe: that's the door that opens, so she leans in there
      mx = c.x + c.ox * al - c.oy * sd; my = c.y + c.oy * al + c.ox * sd; ma = Math.atan2(-c.oy, -c.ox); show = sc.t < SC.gone;
      if (sc.t > SC.vanish && sc.t < SC.gone) {                                    // glitching away (calm: just gone, no strobing)
        if (calm()) show = sc.t < (SC.vanish + SC.gone) / 2; else { show = Math.random() < 0.55; mx += rnd(-3, 3); my += rnd(-3, 3); } } }
    barbi.obj.visible = show;
    barbi.obj.position.set(mx * S, 0, my * S); barbi.obj.rotation.y = Math.PI / 2 - ma;
    let eye = 0;
    if (show) { const d = Math.hypot(mx - p.x, my - p.y), toP = Math.atan2(p.y - my, p.x - mx);
      if (sc) eye = 0.95;
      else if (d < 420 && los(p.x, p.y, mx, my)) eye = clamp(1 - d / 420, 0, 1) * (0.75 + Math.random() * 0.25) * clamp((Math.cos(angDiff(toP, ma)) + 0.3) * 1.6, 0, 1); }
    setEyes(eye);
    // her face is right in front of yours when she leans in: the eye glow shrinks to fit
    const near = sc ? clamp((sc.t - SC.lean) / (SC.leanEnd - SC.lean), 0, 1) : 0;
    for (const e of barbi.eyes) if (e.userData.base) e.scale.setScalar(e.userData.base * (1 - 0.65 * near));
  }
  drawPhantom();
  // a new floor: compile every material now (her included, even while she's hidden), not the first time each one is seen
  if (!level.compiled && renderer.compileAsync) { level.compiled = true;
    const was = barbi ? barbi.obj.visible : false; if (barbi) barbi.obj.visible = true;
    renderer.compileAsync(scene, camera).catch(() => {}); if (barbi) barbi.obj.visible = was; }
  // in the wardrobe scene the camera turns to look her in the eyes as she leans in
  if (barbi && closetScene && p.closet && barbi.eyes.length) {
    const k = clamp((closetScene.t - SC.lean) / (SC.leanEnd - SC.lean), 0, 1) * (closetScene.t < SC.vanish ? 1 : 0);
    if (k > 0) {
      barbi.obj.updateMatrixWorld(true);
      const e = new THREE.Vector3(); barbi.eyes.forEach(s => e.add(s.parent.getWorldPosition(_v))); e.divideScalar(barbi.eyes.length);
      const dx = e.x - camera.position.x, dy = e.y - camera.position.y, dz = e.z - camera.position.z;
      const yaw = Math.atan2(-dx, -dz), pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.9, 0.9), kk = k * k * (3 - 2 * k);
      // mostly tilt, only turn a little: turning fully would slide her face behind the door that stays shut
      camera.rotation.y += angDiff(yaw, camera.rotation.y) * kk * 0.4; camera.rotation.x += (pitch - camera.rotation.x) * kk;
    }
  }
  // wardrobe doors: only the one you're in ever opens (in the scene). From inside, closed doors are drawn as the slats overlay.
  for (const c of closets) if (c.doors) {
    const sw = c.swingT >= 0 ? doorSwing(c.swingT) : 0;          // (someone getting in or out: both doors swing)
    if (c.swingT >= 0) { c.swingT += lastDt; if (c.swingT > HIDE_T) c.swingT = -1; }
    for (const d of c.doors) {
      const mine = p.hidden && p.closet === c, k = Math.max(mine && closetScene && d.side < 0 ? sceneDoor(closetScene.t) : d.side < 0 ? scareDoorOpen(c) : 0, sw * 0.62);
      d.pivot.rotation.y = d.side * k * 1.9; d.leaf.visible = !mine || k > 0.12;
    }
  }
  updateMyFigure();
  // teammates
  if (MP.on) for (const o of MP.others.values()) {
    if (!!o.hidden !== !!o.wasHidden) {             // a teammate getting into or out of a wardrobe: its doors swing
      o.wasHidden = !!o.hidden; let best = null, bd = T * 1.2;
      for (const c of closets) { const d = Math.hypot(c.x - o.x, c.y - o.y); if (d < bd) { bd = d; best = c; } }
      startSwing(best);
    }
    if (!o.av) continue;
    o.av.obj.position.set(o.x * S, 0, o.y * S); o.av.obj.rotation.y = Math.PI / 2 - o.ang;
    o.av.update(lastDt, { speed: o.spd * S, sprinting: o.sprinting, crouching: o.crouching, down: o.down, dead: o.dead, hidden: o.hidden, away: o.away, pitch: o.pitch, lightOn: settings.quality !== 'low',
      dance: o.dance >= 0 && DANCES[o.dance] ? DANCES[o.dance][2] : null });
    o.av.setName(o.dead ? o.name + ' ✝' : o.down ? o.name + ' · ' + Math.ceil(o.downLeft) + 's' : o.name, o.down || o.dead); }
  // things on the floor, and on the walls
  animatePuzzles(t); updatePaintings(lastDt);
  for (const n of notes) if (n.obj) n.obj.visible = !n.read;
  const D = level.door;
  if (D) { if (powerOn && !D.open) { D.open = true; D.door.material = D.openMat; }
    D.lamp.material.color.setHex(powerOn ? 0x4dff88 : (Math.sin(t * 6) > 0 ? 0xff3030 : 0x401010)).multiplyScalar(4);
    exitLight.intensity = powerOn ? 2.5 + Math.sin(t * 5) * 0.5 : 0; }
  const P = level.prints;
  prints.forEach((f, i) => { const k = Math.min(1, f.t / 4);
    _m4.compose(_v.set(f.x * S, 0.004, f.y * S), _q.setFromAxisAngle(_up, -f.a), _sc.set(k, 1, k)); P.setMatrixAt(i, _m4); });
  P.count = prints.length; P.instanceMatrix.needsUpdate = true;
  // dust floating in the flashlight beam
  const pos = dustPts.geometry.attributes.position, col = dustPts.geometry.attributes.color;
  dust.forEach((d, i) => {
    pos.setXYZ(i, d.x * S, d.h, d.y * S);
    const dx = d.x - p.x, dy = d.y - p.y, dd = Math.hypot(dx, dy);
    let b = 0;
    if (!p.hidden && dd > 14 && dd < 280 && Math.abs(angDiff(Math.atan2(dy, dx), p.ang)) < 0.55) b = (1 - dd / 280) * 0.8 * flicker * (0.6 + 0.4 * Math.sin(d.ph * 2));
    col.setXYZ(i, b, b * 0.92, b * 0.8);
  });
  pos.needsUpdate = col.needsUpdate = true;
  if (level.house) { level.house.calm = calm(); level.house.dark = scares.dim < 0.5; }
  if (level.house) level.house.update(lastDt, t, camera, p, flash);
  draw(scene, camera);
}

function updateDust(dt) {
  const p = player;
  while (dust.length < 50) dust.push({ x: p.x + rnd(-260, 260), y: p.y + rnd(-260, 260), h: rnd(0.2, 2.7), vx: rnd(-5, 5), vy: rnd(-5, 5), ph: rnd(0, 6.28) });
  for (const d of dust) { d.x += d.vx * dt; d.y += d.vy * dt; d.ph += dt; d.h += Math.sin(d.ph) * dt * 0.03;
    if (Math.abs(d.x - p.x) > 280 || Math.abs(d.y - p.y) > 280) { d.x = p.x + rnd(-260, 260); d.y = p.y + rnd(-260, 260); } }
  for (const f of prints) f.t -= dt;
  while (prints.length && prints[0].t <= 0) prints.shift();
}

function drawScreenFx(t) {
  const p = player, m = monster, cw = cvs.width, ch = cvs.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sc = closetScene && closetScene.t > 0 ? closetScene : null;
  if (p.hidden) { // looking out between the louvres of the wardrobe doors
    const per = 34 * DPR, slat = 14 * DPR, off = (ch / 2) % per;
    const open = closetScene ? sceneDoor(closetScene.t) : 0, rx = cw / 2 + open * cw * 0.6;   // the right door swings away
    for (let y = off - per; y < ch; y += per) {
      const g = ctx.createLinearGradient(0, y, 0, y + slat);
      g.addColorStop(0, 'rgba(40,24,14,.96)'); g.addColorStop(0.35, 'rgba(22,13,7,.97)'); g.addColorStop(1, 'rgba(6,3,2,.98)');
      ctx.fillStyle = g; ctx.fillRect(0, y, cw / 2, slat); if (rx < cw) ctx.fillRect(rx, y, cw - rx + 1, slat);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, y + slat, cw / 2, 2 * DPR); if (rx < cw) ctx.fillRect(rx, y + slat, cw - rx + 1, 2 * DPR);
    }
    ctx.fillStyle = 'rgba(8,4,2,.97)'; ctx.fillRect(cw / 2 - 5 * DPR, 0, 10 * DPR, ch);   // the edge of the door that stays shut
    if (open > 0 && rx < cw) ctx.fillRect(rx - 5 * DPR, 0, 10 * DPR, ch);
    const fr = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    fr.addColorStop(0, 'rgba(8,4,2,0)'); fr.addColorStop(1, 'rgba(8,4,2,.7)'); ctx.fillStyle = fr; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(160,130,100,.5)'; ctx.font = (12 * DPR) + 'px Georgia'; ctx.textAlign = 'center';
    if (!closetScene) ctx.fillText('hiding · move to leave', cw / 2, ch - 110 * DPR);
  }
  const d = m.active ? Math.hypot(m.x - p.x, m.y - p.y) : 9999, c = clamp(1 - d / 380, 0, 1) * (1 - herQuiet());
  const vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(' + Math.round(110 * c) + ',0,0,' + (0.45 + 0.4 * c * (0.7 + 0.3 * Math.sin(t * 10))) + ')');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);
  // once the power is back: an arrow towards the door (up = straight ahead)
  if (powerOn && !p.hidden) { const ex = exit.x - p.x, ey = exit.y - p.y, de = Math.hypot(ex, ey);
    if (de > 150) { const a = angDiff(Math.atan2(ey, ex), p.ang) - Math.PI / 2, r = Math.min(cw, ch) * 0.36;
      ctx.save(); ctx.translate(cw / 2 + Math.cos(a) * r, ch / 2 + Math.sin(a) * r); ctx.rotate(a);
      ctx.fillStyle = 'rgba(80,255,140,' + (0.35 + 0.2 * Math.sin(t * 5)) + ')';
      ctx.beginPath(); ctx.moveTo(12 * DPR, 0); ctx.lineTo(-6 * DPR, -8 * DPR); ctx.lineTo(-6 * DPR, 8 * DPR); ctx.fill(); ctx.restore(); } }
  if (p.hidden && sc) drawClosetLine(sc.t);
  drawFearFx(t);                                       // (js/stealth.js)
  if (MP.on) { drawTeamFx(t); drawTeamMarks(t); }      // (js/team.js: pings and emotes)
  drawFuseHint(t);
  drawGrain(0.06);
  if (canLock && !locked() && state === 'play') {
    ctx.fillStyle = 'rgba(200,210,255,.75)'; ctx.font = (15 * DPR) + 'px Georgia'; ctx.textAlign = 'center';
    ctx.fillText('click to look around', cw / 2, ch / 2 + 60 * DPR);
  }
  if (joy.id !== null) {
    ctx.strokeStyle = 'rgba(160,180,255,.25)'; ctx.lineWidth = 2 * DPR;
    ctx.beginPath(); ctx.arc(joy.ox * DPR, joy.oy * DPR, 55 * DPR, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(160,180,255,.3)'; ctx.beginPath(); ctx.arc((joy.ox + joy.x * 55) * DPR, (joy.oy + joy.y * 55) * DPR, 22 * DPR, 0, 7); ctx.fill();
  }
}
// Multiplayer overlay: in the top right corner an arrow for every downed teammate (up = straight ahead),
// with their name, how far away they are and how long they have left; and the revive progress ring.
// stuck? When one labyrinth box is left, or none has been solved for a minute, an amber arrow points to the nearest one
function fuseHintOn() {
  const left = hintTargets();
  return state === 'play' && !powerOn && left.length > 0 && !player.hidden && !player.down && !pzOpen && (fuses.length - fusesGot === 1 || levelTime - lastFuseAt > 60) ? left : null;
}
function drawFuseHint(t) {
  const left = fuseHintOn(); if (!left) return;
  const p = player, D = DPR, cx = 44 * D, cy = 86 * D, r = 20 * D;
  let f = left[0], bd = 1e9; for (const q of left) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; f = q; } }
  const a = angDiff(Math.atan2(f.y - p.y, f.x - p.x), p.ang) - Math.PI / 2, pulse = 0.6 + 0.3 * Math.sin(t * 4);
  ctx.save(); ctx.fillStyle = 'rgba(40,24,0,.5)'; ctx.strokeStyle = 'rgba(255,190,80,' + pulse + ')'; ctx.lineWidth = 2 * D;
  ctx.beginPath(); ctx.arc(cx, cy + 24 * D, r, 0, 7); ctx.fill(); ctx.stroke();
  ctx.translate(cx, cy + 24 * D); ctx.rotate(a); ctx.fillStyle = 'rgba(255,200,100,' + pulse + ')';
  ctx.beginPath(); ctx.moveTo(13 * D, 0); ctx.lineTo(-7 * D, -8 * D); ctx.lineTo(-3 * D, 0); ctx.lineTo(-7 * D, 8 * D); ctx.fill(); ctx.restore();
  ctx.save(); ctx.fillStyle = 'rgba(255,210,140,.85)'; ctx.font = (11 * D) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
  drawIco(ctx, 'puzzle', cx + 20 * D - 22 * D, cy + 58 * D - 9 * D, 17 * D, ctx.fillStyle); ctx.fillText(Math.round(bd / T) + ' tiles', cx + 20 * D, cy + 58 * D); ctx.restore();
}
function drawTeamFx(t) {
  const p = player, cw = cvs.width, ch = cvs.height, D = DPR;
  let row = 0;
  for (const o of MP.others.values()) {
    if (!o.down || o.dead || o.away) continue;
    const cx = cw - 44 * D, cy = 86 * D + row * 64 * D, r = 20 * D; row++;
    const a = angDiff(Math.atan2(o.y - p.y, o.x - p.x), p.ang) - Math.PI / 2, pulse = 0.65 + 0.35 * Math.sin(t * 6);
    ctx.save();
    ctx.fillStyle = 'rgba(40,0,0,.55)'; ctx.strokeStyle = 'rgba(255,90,90,' + pulse + ')'; ctx.lineWidth = 2 * D;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.translate(cx, cy); ctx.rotate(a); ctx.fillStyle = 'rgba(255,120,120,' + pulse + ')';
    ctx.beginPath(); ctx.moveTo(13 * D, 0); ctx.lineTo(-7 * D, -8 * D); ctx.lineTo(-3 * D, 0); ctx.lineTo(-7 * D, 8 * D); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffd0cc'; ctx.font = '600 ' + (12 * D) + 'px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(o.name, cx - r - 8 * D, cy - 7 * D);
    ctx.fillStyle = 'rgba(255,208,204,.75)'; ctx.font = (11 * D) + 'px system-ui, sans-serif';
    ctx.fillText(Math.round(Math.hypot(o.x - p.x, o.y - p.y) * S) + ' m · ' + Math.ceil(o.downLeft) + 's', cx - r - 8 * D, cy + 8 * D);
  }
  if (reviveTarget && revP > 0) {
    const cx = cw / 2, cy = ch / 2 + 40 * D, r = 30 * D;
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 6 * D; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#8ff0b5'; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + revP * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e6fff0'; ctx.font = '600 ' + (13 * D) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Reviving ' + reviveTarget.name + '…', cx, cy + r + 18 * D);
  } else if (reviveTarget) {
    ctx.fillStyle = 'rgba(255,220,215,.85)'; ctx.font = '600 ' + (13 * D) + 'px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText((canLock ? keyLabel('use', true) : 'Hold REVIVE') + ' to get ' + reviveTarget.name + ' up', cw / 2, ch / 2 + 60 * D);
  }
}
function drawClosetLine(t) {
  const cw = cvs.width, ch = cvs.height, shown = Math.floor(clamp((t - SC.speak) / 1.6, 0, 1) * CLOSET_LINE.length);
  if (!shown) return;
  const fs = 22 * DPR, alpha = clamp((SC.vanish + 0.3 - t) / 0.5, 0, 1);
  ctx.save(); ctx.font = 'italic ' + fs + 'px Georgia, serif'; ctx.textBaseline = 'middle';
  const txt = CLOSET_LINE.slice(0, shown), full = ctx.measureText(CLOSET_LINE).width;
  let x = cw / 2 - full / 2; const y = ch - 150 * DPR;
  for (const chr of txt) {
    ctx.fillStyle = 'rgba(255,' + (40 + Math.random() * 40 | 0) + ',50,' + alpha + ')';
    ctx.shadowColor = '#f00'; ctx.shadowBlur = 12 * DPR;
    ctx.fillText(chr, x + rnd(-2, 2) * DPR, y + rnd(-2, 2) * DPR); x += ctx.measureText(chr).width;
  }
  ctx.restore();
}
function drawGrain(a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = grainPat;
  const ox = Math.random() * 128 | 0, oy = Math.random() * 128 | 0;
  ctx.setTransform(1, 0, 0, 1, -ox, -oy); ctx.fillRect(0, 0, cvs.width + 128, cvs.height + 128); ctx.restore();
}

function renderGame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cvs.width, cvs.height);
  if (MP.on && MP.scareT > 0) { MP.scareT -= realDt; renderDead(lastDt, true); return; }   // (1.8 real seconds, however slow the frames)
  if (renderer) render3D(t);
  drawScreenFx(t);
}
