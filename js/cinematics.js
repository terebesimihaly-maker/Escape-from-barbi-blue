/* Escape from Barbi Blue: The death screen (her face, cracks) and the title screen.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- jumpscare ---------- */
function prepDeath() {
  if (!renderer) return;
  const m = monster;
  deathCam = { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: camera.rotation.y, pitch: camera.rotation.x,
    a: Math.atan2(m.y * S - camera.position.z, m.x * S - camera.position.x) };
  if (barbi) barbi.anim.play('lunge', 0.06, true);
}
function renderDead(dt, overGame) {
  deadT += dt;
  const cw = cvs.width, ch = cvs.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
  if (renderer && barbi && deathCam) {
    // she's right in front of you: the camera snaps to her, she lunges
    const D = deathCam, a = D.a, k = Math.min(1, dt * 18);
    D.yaw = D.yaw - angDiff(D.yaw, -Math.PI / 2 - a) * k; D.pitch += (0.2 - D.pitch) * k;
    const sh = (deadT < 1.5 ? 0.05 : 0.008) * (calm() ? 0.1 : 1);
    camera.position.set(D.x + rnd(-sh, sh), D.y + rnd(-sh, sh), D.z + rnd(-sh, sh)); camera.rotation.set(D.pitch + rnd(-sh, sh), D.yaw, rnd(-sh, sh) * 2);
    const dist = 1.3;
    putBarbi(scene); barbi.obj.visible = true;
    barbi.obj.position.set(D.x + Math.cos(a) * dist, 0, D.z + Math.sin(a) * dist); barbi.obj.rotation.y = Math.PI / 2 - (a + Math.PI);
    barbi.anim.update(dt); setEyes(0.8 + Math.random() * 0.2);
    flash.visible = true; flash.intensity = FLASH_I * (deadT < 1.4 ? (calm() ? 0.9 : Math.random() < 0.3 ? 0.15 : 1.1) : 0.5);
    draw(scene, camera);
    ctx.fillStyle = deadT < 1.4 && !calm() && Math.random() < 0.25 ? 'rgba(90,0,0,.45)' : 'rgba(0,0,0,' + clamp((deadT - 1.4) * 0.5, 0, 0.5) + ')';
    ctx.fillRect(0, 0, cw, ch);
    // tear the picture into glitching strips
    if (deadT < 1.5) { const n = 14;
      for (let i = 0; i < n; i++) if (Math.random() < 0.3) { const y = i * ch / n, off = rnd(-50, 50) * DPR;
        ctx.drawImage(renderer.domElement, 0, y / ch * renderer.domElement.height, renderer.domElement.width, renderer.domElement.height / n, off, y, cw, ch / n + 1); } }
  } else {
    paintFace(fctx, deadT);
    ctx.fillStyle = deadT < 1.4 && !calm() && Math.random() < 0.25 ? '#3a0000' : '#000'; ctx.fillRect(0, 0, cw, ch);
    const z = deadT < 0.22 ? 0.35 + deadT / 0.22 * 0.95 : 1.3 + Math.sin(deadT * 40) * 0.03;
    const size = Math.min(cw, ch) * 1.15 * z, sh = (deadT < 1.5 ? 30 * DPR : 4 * DPR) * (calm() ? 0.1 : 1);
    const dx = cw / 2 - size / 2 + rnd(-sh, sh), dy = ch / 2 - size / 2 + rnd(-sh, sh), n = 14;
    for (let i = 0; i < n; i++) {
      const off = Math.random() < 0.3 ? rnd(-50, 50) * DPR * (deadT < 1.5 ? 1 : 0.2) : 0;
      ctx.drawImage(faceCv, 0, i * 512 / n, 512, 512 / n, dx + off, dy + i * size / n, size, size / n + 1);
    }
  }
  if (deadT < 1.5 && !calm() && Math.random() < 0.3) { ctx.fillStyle = 'rgba(255,0,0,.18)'; ctx.fillRect(0, 0, cw, ch); }
  drawGrain(0.12);
  if (!overGame && deadT > 1.8 && $('dead').classList.contains('hidden')) { $('dText').textContent = deathReason; show('dead', true); }
}

/* the painted face: used for the jumpscare only if her 3D model could not be loaded */
const CRACKS = [[[40, -170], [55, -120], [38, -90], [60, -60]], [[-120, -40], [-95, 10], [-110, 50]], [[90, 90], [120, 130], [105, 170]]];
const BANGS = Array.from({ length: 22 }, (_, i) => ({ x: -170 + i * 16, len: 60 + ((i * 37) % 50) }));
function paintFace(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 512, 512);
  g.save(); g.translate(256, 270);
  g.fillStyle = '#04060f'; g.beginPath(); g.ellipse(0, -10, 215, 260, 0, 0, 7); g.fill();
  const fg = g.createRadialGradient(-30, -60, 20, 0, 0, 220);
  fg.addColorStop(0, '#d4e3ff'); fg.addColorStop(0.55, '#6f93db'); fg.addColorStop(1, '#1a2a62');
  g.fillStyle = fg; g.beginPath(); g.ellipse(0, 0, 150, 195, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(8,12,35,.85)'; g.lineWidth = 2.5;
  for (const c of CRACKS) { g.beginPath(); c.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
  for (const s of [-1, 1]) {
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(s * 58, -30, 44, 54, s * 0.15, 0, 7); g.fill();
    const dl = 95 + Math.sin(t * 3 + s) * 12; g.fillRect(s * 58 - 5, 0, 10, dl); g.beginPath(); g.arc(s * 58, dl, 6, 0, 7); g.fill();
    g.save(); g.shadowColor = '#7fd4ff'; g.shadowBlur = 30; g.fillStyle = '#eaffff';
    g.beginPath(); g.arc(s * 58 + rnd(-3, 3), -28 + rnd(-3, 3), 7, 0, 7); g.fill(); g.restore();
  }
  g.fillStyle = '#10183a'; g.beginPath(); g.ellipse(-8, 40, 3, 7, 0.3, 0, 7); g.ellipse(8, 40, 3, 7, -0.3, 0, 7); g.fill();
  const open = 130 + Math.sin(t * 28) * 12;
  g.fillStyle = '#030005'; g.beginPath(); g.moveTo(-95, 70); g.quadraticCurveTo(0, 40, 95, 70); g.quadraticCurveTo(0, open * 2, -95, 70); g.fill();
  g.fillStyle = '#d9d4c2';
  for (let i = 0; i < 10; i++) { const x = -82 + i * 18, u = (x + 95) / 190, y = 70 - 60 * u * (1 - u);
    g.beginPath(); g.moveTo(x - 7, y - 1); g.lineTo(x + 7, y - 1); g.lineTo(x, y + 20 + (i % 3) * 4); g.fill(); }
  for (let i = 0; i < 8; i++) { const x = -63 + i * 18, u = (95 - x) / 190, y = 70 + 2 * u * (1 - u) * (open * 2 - 70);
    g.beginPath(); g.moveTo(x - 7, y + 1); g.lineTo(x + 7, y + 1); g.lineTo(x, y - 18 - (i % 2) * 5); g.fill(); }
  g.fillStyle = '#04060f';
  for (const b of BANGS) { const sw = Math.sin(t * 2 + b.x) * 3;
    g.beginPath(); g.moveTo(b.x - 10, -210); g.lineTo(b.x + 12, -210); g.lineTo(b.x + sw, -210 + b.len + 80); g.fill(); }
  g.strokeStyle = '#04060f'; g.lineWidth = 5;
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    g.beginPath(); g.moveTo(s * (120 + k * 8), -150);
    g.quadraticCurveTo(s * (150 - k * 6) + Math.sin(t * 3 + k) * 8, 50, s * (110 + k * 12), 240); g.stroke(); }
  g.restore();
}
let titleFlick = 0;
function renderTitle(dt) {
  titleT += dt;
  const cw = cvs.width, ch = cvs.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
  const three = renderer && barbi;
  if (three) {   // her, standing at the end of a hallway, lit by a failing bulb
    putBarbi(titleScene); barbi.obj.visible = true; barbi.obj.position.set(0, 0, -2.2); barbi.obj.rotation.y = 0;
    barbi.anim.play('idle', 0.3); barbi.anim.update(dt);
    // a close-up of her face: the camera follows the point between her eyes (smoothly, so her twitches still show)
    barbi.obj.updateMatrixWorld(true);
    const eyes = ['eyeL', 'eyeR'].map(n => barbi.model.getObjectByName(n)).filter(Boolean);
    const tgt = new THREE.Vector3();
    if (eyes.length) { eyes.forEach(e => tgt.add(e.getWorldPosition(_v))); tgt.divideScalar(eyes.length); } else tgt.set(0, 1.9, -2.1);
    if (!titleAim) titleAim = tgt.clone(); else titleAim.lerp(tgt, Math.min(1, dt * 3));
    const dist = W < H ? 1.05 : 0.95;
    titleCam.position.set(titleAim.x + Math.sin(titleT * 0.23) * 0.06, titleAim.y + 0.02 + Math.sin(titleT * 0.17) * 0.02, titleAim.z + dist);
    titleCam.lookAt(titleAim);
    titleKey.position.set(titleAim.x + 0.55, titleAim.y - 0.05, titleAim.z + 1.0); titleKey.target.position.copy(titleAim);
    // the bulb over her keeps failing; when you point at "Enter the house" it goes mad and her eyes flare
    if (titleFlick > 0) titleFlick -= dt; else if (Math.random() < dt * (titleHover ? 6 : 0.5)) titleFlick = rnd(0.05, titleHover ? 0.15 : 0.4);
    const on = titleFlick > 0 && !calm() ? (Math.random() < 0.5 ? 0.05 : 0.25) : 1;
    titleLight.intensity = 9 * on; titleBulbLight.intensity = 2.5 * on; titleKey.intensity = 2.2 * on;
    titleBulb.material.color.setScalar(0.25 + 0.75 * on);
    titleLight.color.setHex(titleHover ? 0xa8b8ff : 0x86a8ff);
    setEyes(titleHover ? 1 : 0.75 + Math.random() * 0.2);
    for (const e of barbi.eyes) e.scale.setScalar(e.userData.base * (titleHover ? 0.75 + Math.random() * 0.15 : 0.4));   // smaller glow, this close
    draw(titleScene, titleCam);
  } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch); }
  for (let i = 0; i < 6; i++) {   // slow drifting fog
    const fx = (0.5 + 0.45 * Math.sin(titleT * 0.05 * (1 + i * 0.3) + i * 1.7)) * cw, fy = (0.5 + 0.45 * Math.cos(titleT * 0.04 * (1 + i * 0.2) + i * 2.3)) * ch;
    const r = Math.max(cw, ch) * (0.3 + 0.08 * i), fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
    fg.addColorStop(0, 'rgba(50,70,130,.07)'); fg.addColorStop(1, 'rgba(50,70,130,0)'); ctx.fillStyle = fg; ctx.fillRect(0, 0, cw, ch);
  }
  if (!three) {   // (while her model loads) eyes in the dark
    if (!titleEyes || titleT > titleEyes.end + 2.5) titleEyes = { x: rnd(0.15, 0.85) * cw, y: rnd(0.08, 0.92) * ch, start: titleT + rnd(0.5, 2), end: 0 };
    if (!titleEyes.end) titleEyes.end = titleEyes.start + rnd(1.2, 2.5);
    if (titleT > titleEyes.start && titleT < titleEyes.end) {
      const k = Math.sin((titleT - titleEyes.start) / (titleEyes.end - titleEyes.start) * Math.PI);
      const blink = Math.sin(titleT * 3) > 0.97 ? 0 : 1;
      ctx.globalCompositeOperation = 'lighter';
      for (const s of [-1, 1]) { const ex = titleEyes.x + s * 12 * DPR, ey = titleEyes.y;
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 14 * DPR);
        g.addColorStop(0, 'rgba(220,250,255,' + 0.8 * k * blink + ')'); g.addColorStop(1, 'rgba(40,80,255,0)');
        ctx.fillStyle = g; ctx.fillRect(ex - 14 * DPR, ey - 14 * DPR, 28 * DPR, 28 * DPR); }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  drawGrain(0.07);
}
