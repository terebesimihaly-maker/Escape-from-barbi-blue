/* Escape from Barbi Blue: the puzzles. Each floor has 1-4 wooden labyrinth boxes on its walls, like the tilting ball maze game:
   tilt the board to roll a steel ball from the start to the gold hole, around the holes. Solve them all and the front door unlocks.
   (In the rest of the code a solved puzzle counts as a "fuse", from when the game had fuses.)
   Tilting: the mouse (the ball rolls towards where you point), arrow keys / WASD, dragging a finger, or tilting the phone.
   A ball that falls into a hole makes a loud clack, and she hears it; the game keeps going while you play, so she can come.
   The maze of each box is made from a seed, so every player sees the same one. Harder floors and difficulties: bigger mazes, more holes. */
'use strict';

let puzzles = [], puzzleTarget = null, pzOpen = null;
// how many boxes on a floor: more on later floors, one less on Easy
const puzzleCount = (i, diff) => Math.max(1, Math.min(4, [2, 3, 3, 4, 4][i] + (diff === 'easy' ? -1 : 0)));
// the size of a maze, and its holes: bigger on later floors and harder difficulties
function mazeSpec(floor, diff) {
  const d = diff === 'easy' ? 0 : diff === 'hard' ? 2 : 1;
  return { cols: 4 + Math.min(3, (floor >> 1) + d), rows: 3 + Math.min(3, ((floor + 1) >> 1) + (d >> 1)), holes: [1, 3, 5][d] + (floor >> 1), speed: [0.8, 1, 1.15][d] };
}
// a small seeded random number generator (the same maze for everyone)
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- making a floor's boxes (on the host: everyone gets the same ones) ---------- */
function makePuzzles(n, cells, floor, diff) {
  const out = [];
  for (let i = 0; i < cells.length && out.length < n; i++) {
    const [x, y] = cells[i], walls = DIRS.filter(([dx, dy]) => isWall(x + dx, y + dy));
    if (!walls.length) continue;
    const [dx, dy] = walls[Math.random() * walls.length | 0];
    out.push({ cell: [x, y], dir: [dx, dy], seed: Math.random() * 1e9 | 0, spec: mazeSpec(floor, diff) });
  }
  return out;
}
// the maze of a box: cells with walls (bit 1 north, 2 east, 4 south, 8 west), the route, and the holes beside it
function buildMaze(pz) {
  const { cols: C, rows: R, holes: H } = pz.spec, rnd = seeded(pz.seed), W = Array.from({ length: R }, () => new Array(C).fill(15));
  const seen = W.map(r => r.map(() => false)), stack = [[0, 0]], D = [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]];
  seen[0][0] = true;
  while (stack.length) {                                   // (a depth-first maze: long winding corridors)
    const [x, y] = stack[stack.length - 1], nb = D.filter(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < C && ny < R && !seen[ny][nx]; });
    if (!nb.length) { stack.pop(); continue; }
    const [dx, dy, b, ob] = nb[rnd() * nb.length | 0]; W[y][x] &= ~b; W[y + dy][x + dx] &= ~ob; seen[y + dy][x + dx] = true; stack.push([x + dx, y + dy]);
  }
  // the route from the start (top left) to the goal (bottom right)
  const prev = {}, q = [[0, 0]]; prev['0,0'] = null;
  while (q.length) { const [x, y] = q.shift(); if (x === C - 1 && y === R - 1) break;
    for (const [dx, dy, b] of D) { const k = (x + dx) + ',' + (y + dy); if (!(W[y][x] & b) && !(k in prev)) { prev[k] = [x, y]; q.push([x + dx, y + dy]); } } }
  const route = []; for (let c = [C - 1, R - 1]; c; c = prev[c.join()]) route.unshift(c);
  // holes: in cells along and beside the route, off to one side, so you have to steer around them (never the first or last cells)
  const holes = [], onRoute = new Set(route.map(c => c.join())), cand = [];
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) { const k = x + ',' + y, ri = route.findIndex(c => c.join() === k);
    if ((x + y < 2) || (x >= C - 2 && y >= R - 2) || (onRoute.has(k) && (ri < 2 || ri > route.length - 3))) continue; cand.push([x, y]); }
  for (let i = cand.length - 1; i > 0; i--) { const j = rnd() * (i + 1) | 0; [cand[i], cand[j]] = [cand[j], cand[i]]; }
  for (const [x, y] of cand) { if (holes.length >= H) break;
    // put the hole against a wall of its cell (or a corner), so there's always room to pass on the open side
    const open = D.filter(([, , b]) => !(W[y][x] & b)), wallSides = D.filter(([, , b]) => W[y][x] & b);
    if (!wallSides.length) continue;                     // (a crossing: no side to put it against)
    const side = wallSides[rnd() * wallSides.length | 0];
    holes.push({ x: x + 0.5 + side[0] * 0.22, y: y + 0.5 + side[1] * 0.22 });
  }
  return { C, R, W, route, holes };
}

/* ---------- setting up a floor's boxes (everyone) ---------- */
function applyPuzzles(list) {
  closePuzzle(); puzzleTarget = null;
  puzzles = (list || []).map(p => Object.assign({}, p, { solved: false, maze: buildMaze(p) }));
  puzzles.forEach((p, k) => { const f = fuses[k]; if (!f) return; const w = wallPoint(p.cell, p.dir, 12); f.x = w.x; f.y = w.y; f.pz = p; });
}
// a point on the wall of a cell, pulled back into the room by `back` units
function wallPoint(cell, dir, back) { return { x: (cell[0] + 0.5) * T + dir[0] * (T / 2 - back), y: (cell[1] + 0.5) * T + dir[1] * (T / 2 - back) }; }
const faceKey = (cell, dir) => cell[0] + ',' + cell[1] + ',' + (-dir[0]) + ',' + (-dir[1]);   // (the wall face, as js/level.js names them)
function puzzleFaces() { return new Set(puzzles.map(p => faceKey(p.cell, p.dir))); }

/* ---------- in 3D: a wooden box on the wall, its maze on the front ---------- */
function buildPuzzles3D(G) {
  const L = TILE_M;
  puzzles.forEach(p => {
    const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.6 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 0.1), wood); box.castShadow = true; g.add(box);
    const cv = mazeCanvas(p.maze, 256, 214, null), tx = toTex(cv);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.46), new THREE.MeshLambertMaterial({ map: tx, color: 0xb0b0b0, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 0.03 }));
    face.position.z = 0.051; g.add(face);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0xffb050).multiplyScalar(1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5 }));
    glow.scale.setScalar(1.1); glow.position.z = 0.08; g.add(glow);
    g.position.set((p.cell[0] + 0.5) * L + p.dir[0] * (L / 2 - 0.06), 1.3, (p.cell[1] + 0.5) * L + p.dir[1] * (L / 2 - 0.06));
    g.rotation.set(0, Math.atan2(-p.dir[0], -p.dir[1]), 0); g.rotateX(-0.25);     // (tilted towards you, like a board)
    G.add(g); p.obj = g; p.glow = glow;
  });
}
function animatePuzzles(t) {
  puzzles.forEach((p, k) => { if (!p.glow) return;
    p.glow.material.color.setHex(p.solved ? 0x50ff90 : 0xffb050).multiplyScalar(1.6);
    p.glow.material.opacity = p.solved ? 0.35 : 0.4 + Math.sin(t * 3 + k) * 0.15; });
}
// the board: wood, grooves (walls), holes, the gold goal, and the ball (if given)
function mazeCanvas(mz, w, h, ball, cv) {
  cv = cv || mkCanvas(w, h); const g = cv.getContext('2d'), pad = w * 0.04, cs = Math.min((w - pad * 2) / mz.C, (h - pad * 2) / mz.R);
  const ox = (w - cs * mz.C) / 2, oy = (h - cs * mz.R) / 2, th = Math.max(3, cs * 0.12);
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#b98a52'); gr.addColorStop(1, '#8a5e30'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(60,30,10,.18)'; g.lineWidth = 1; for (let y = 3; y < h; y += 5) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 2, w * 0.7, y - 2, w, y + 1); g.stroke(); }
  g.strokeStyle = '#3a2210'; g.lineWidth = th * 0.8; g.strokeRect(ox, oy, cs * mz.C, cs * mz.R);
  const hole = (x, y, r, goal) => { const X = ox + x * cs, Y = oy + y * cs, rg = g.createRadialGradient(X - r * 0.3, Y - r * 0.3, 0, X, Y, r);
    rg.addColorStop(0, goal ? '#fff2a8' : '#000'); rg.addColorStop(0.7, goal ? '#d8a020' : '#050302'); rg.addColorStop(1, goal ? '#8a5a10' : '#2a1a0c');
    g.fillStyle = rg; g.beginPath(); g.arc(X, Y, r, 0, 7); g.fill(); };
  for (const hl of mz.holes) hole(hl.x, hl.y, cs * 0.2);
  hole(mz.C - 0.5, mz.R - 0.5, cs * 0.24, true);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(ox + cs * 0.5, oy + cs * 0.5, cs * 0.2, 0, 7); g.fill();   // (the start)
  g.fillStyle = '#4a2a14';
  for (let y = 0; y < mz.R; y++) for (let x = 0; x < mz.C; x++) { const b = mz.W[y][x], X = ox + x * cs, Y = oy + y * cs;
    if (b & 1) g.fillRect(X - th / 2, Y - th / 2, cs + th, th); if (b & 8) g.fillRect(X - th / 2, Y - th / 2, th, cs + th);
    if (b & 4 && y === mz.R - 1) g.fillRect(X - th / 2, Y + cs - th / 2, cs + th, th); if (b & 2 && x === mz.C - 1) g.fillRect(X + cs - th / 2, Y - th / 2, th, cs + th); }
  if (ball) { const X = ox + ball.x * cs, Y = oy + ball.y * cs, r = cs * 0.14 * (ball.s === undefined ? 1 : ball.s);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(X + r * 0.3, Y + r * 0.4, r, 0, 7); g.fill();
    const bg = g.createRadialGradient(X - r * 0.35, Y - r * 0.4, r * 0.1, X, Y, r); bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.4, '#b8c0c8'); bg.addColorStop(1, '#3a4048');
    g.fillStyle = bg; g.beginPath(); g.arc(X, Y, r, 0, 7); g.fill(); }
  return cv;
}

/* ---------- every frame: the box you're next to, the hum, and the ball while a board is open ---------- */
let pzHum = 0;
function updatePuzzles(dt) {
  const p = player; puzzleTarget = null;
  if (pzOpen) updateBall(dt);
  if (p.hidden || p.down || p.dead) return;
  let bd = 36;
  puzzles.forEach((pz, k) => { if (pz.solved) return; const w = wallPoint(pz.cell, pz.dir, 12), d = Math.hypot(w.x - p.x, w.y - p.y);
    if (d < bd && los(p.x, p.y, w.x, w.y)) { bd = d; puzzleTarget = k; } });
  pzHum -= dt;
  if (pzHum <= 0) { pzHum = 1.1; for (const pz of puzzles) if (!pz.solved) { const w = wallPoint(pz.cell, pz.dir, 12); if (Math.hypot(w.x - p.x, w.y - p.y) < T * 6) sfx.hum({ x: w.x, y: w.y, h: 1.3 }); } }
}

/* ---------- playing a board ---------- */
const tilt = { mx: 0, my: 0, kx: 0, ky: 0, gx: 0, gy: 0, gyro: false, drag: false };
function openPuzzle(k) {
  const pz = puzzles[k]; if (!pz || pz.solved) return;
  pzOpen = { k, ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 }, fall: 0, won: 0 };
  Object.assign(tilt, { mx: 0, my: 0, kx: 0, ky: 0 });
  setSprint(false); joy.id = null; joy.x = joy.y = 0;
  if (locked()) document.exitPointerLock();                // (the mouse tilts the board; the game keeps going: she can still come)
  $('pzTitle').textContent = 'The labyrinth box';
  $('pzHelp').innerHTML = document.body.classList.contains('pc')
    ? 'Roll the ball into the <b>gold hole</b>. Point the mouse where you want it to roll (or use the arrow keys). Mind the holes: they are loud.'
    : 'Roll the ball into the <b>gold hole</b>. Drag your finger where you want it to roll, or tilt your phone. Mind the holes: they are loud.';
  show('pzGyro', !document.body.classList.contains('pc') && 'DeviceOrientationEvent' in window && !tilt.gyro);
  $('pzMsg').textContent = ''; show('puzzle', true); drawBoard();
}
function closePuzzle() {
  if (!pzOpen) return; pzOpen = null; show('puzzle', false);
  if (state === 'play') lockMouse();
}
function drawBoard() {
  const o = pzOpen; if (!o) return; const pz = puzzles[o.k], cv = $('pzBoard');
  mazeCanvas(pz.maze, cv.width, cv.height, { x: o.ball.x, y: o.ball.y, s: o.fall ? Math.max(0, 1 - o.fall * 1.6) : 1 }, cv);
  const tx = clamp(tilt.mx + tilt.kx + tilt.gx, -1, 1), ty = clamp(tilt.my + tilt.ky + tilt.gy, -1, 1);
  cv.style.transform = 'perspective(700px) rotateX(' + (-ty * 9).toFixed(1) + 'deg) rotateY(' + (tx * 9).toFixed(1) + 'deg)';
}
// the physics: the tilt pushes the ball; it rolls, bumps off walls, drops into holes
function updateBall(dt) {
  const o = pzOpen, pz = puzzles[o.k], mz = pz.maze, b = o.ball, sp = pz.spec.speed;
  if (o.won) { o.won += dt; if (o.won > 0.5) { if (MP.on) toHost({ t: 'solve', k: o.k }); else applyFuse(o.k); } drawBoard(); return; }
  if (o.fall) { o.fall += dt; if (o.fall > 0.8) { o.fall = 0; Object.assign(b, { x: 0.5, y: 0.5, vx: 0, vy: 0 }); } drawBoard(); return; }
  tilt.kx = ((keys.ArrowRight || keys.KeyD) ? 1 : 0) - ((keys.ArrowLeft || keys.KeyA) ? 1 : 0);
  tilt.ky = ((keys.ArrowDown || keys.KeyS) ? 1 : 0) - ((keys.ArrowUp || keys.KeyW) ? 1 : 0);
  const tx = clamp(tilt.mx + tilt.kx + tilt.gx, -1, 1), ty = clamp(tilt.my + tilt.ky + tilt.gy, -1, 1);
  const r = 0.14, wt = 0.06, steps = Math.max(1, Math.ceil(dt / 0.004)), h = dt / steps;
  for (let s = 0; s < steps; s++) {
    b.vx += tx * 9 * sp * h; b.vy += ty * 9 * sp * h;      // (cells per second squared)
    const f = Math.max(0, 1 - 1.6 * h); b.vx *= f; b.vy *= f;
    const v = Math.hypot(b.vx, b.vy), vmax = 4.5 * sp; if (v > vmax) { b.vx *= vmax / v; b.vy *= vmax / v; }
    b.x += b.vx * h; b.y += b.vy * h;
    // walls: the grooves around the cells near the ball, as thin boxes
    const cx = Math.floor(b.x), cy = Math.floor(b.y);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= mz.C || y >= mz.R) continue; const w = mz.W[y][x];
      if (w & 1) bump(b, x - wt, y - wt, x + 1 + wt, y + wt, r); if (w & 4) bump(b, x - wt, y + 1 - wt, x + 1 + wt, y + 1 + wt, r);
      if (w & 8) bump(b, x - wt, y - wt, x + wt, y + 1 + wt, r); if (w & 2) bump(b, x + 1 - wt, y - wt, x + 1 + wt, y + 1 + wt, r);
    }
    b.x = clamp(b.x, r, mz.C - r); b.y = clamp(b.y, r, mz.R - r);
  }
  for (const hl of mz.holes) if (Math.hypot(b.x - hl.x, b.y - hl.y) < 0.15) {       // into a hole: a loud clack, and she hears it
    o.fall = 0.001; b.x = hl.x; b.y = hl.y; sfx.clang(); shake = Math.max(shake, 2); $('pzMsg').textContent = 'It fell in. That was loud...';
    if (MP.on) toHost({ t: 'noise' }); else puzzleNoise(player.x, player.y, 'me');
    break; }
  if (!o.fall && Math.hypot(b.x - (mz.C - 0.5), b.y - (mz.R - 0.5)) < 0.18) { o.won = 0.001; b.x = mz.C - 0.5; b.y = mz.R - 0.5; sfx.pickup(); $('pzMsg').textContent = 'Click.'; }
  drawBoard();
}
// the ball against a wall (a box from x0,y0 to x1,y1): pushed out, bouncing a little
function bump(b, x0, y0, x1, y1, r) {
  const px = clamp(b.x, x0, x1), py = clamp(b.y, y0, y1), dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy);
  if (d >= r || d === 0) return;
  const nx = dx / d, ny = dy / d; b.x = px + nx * r; b.y = py + ny * r;
  const vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 1.35 * vn * nx; b.vy -= 1.35 * vn * ny; }
}
// (the host, or single player) she heard that
function puzzleNoise(x, y, id) {
  const m = monster; if (!m.active) return;
  if (Math.hypot(m.x - x, m.y - y) > 700 * DF().hear) return;
  m.last = { x, y }; m.ti = id; if (m.state !== 'chase') m.state = 'hunt';
}
// solved (applyFuse calls this)
function puzzleSolved(k) { const pz = puzzles[k]; if (!pz) return; pz.solved = true; if (pzOpen && pzOpen.k === k) closePuzzle(); }
// the hint arrow (js/render.js): the boxes not solved yet
function hintTargets() { return puzzles.filter(p => !p.solved).map(p => Object.assign(wallPoint(p.cell, p.dir, 12), { what: 'puzzle' })); }

// tilting: the mouse (where it points, from the middle of the board), a finger (drag), the arrow keys, or the phone itself
function pointTilt(e) {
  const r = $('pzBoard').getBoundingClientRect(); if (!r.width) return;
  tilt.mx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.35), -1, 1); tilt.my = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 0.35), -1, 1);
}
addEventListener('pointermove', e => { if (pzOpen && (e.pointerType === 'mouse' || tilt.drag)) pointTilt(e); });
$('pzBoard').addEventListener('pointerdown', e => { tilt.drag = true; pointTilt(e); e.preventDefault(); });
addEventListener('pointerup', () => { if (tilt.drag) { tilt.drag = false; if (!tilt.gyro) tilt.mx = tilt.my = 0; } });
$('pzGyro').onclick = async () => {
  try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } } catch (e) { return; }
  tilt.gyro = true; show('pzGyro', false);
  addEventListener('deviceorientation', ev => { if (!pzOpen) return; const land = Math.abs(window.orientation || 0) === 90 || innerWidth > innerHeight;
    const a = land ? ev.beta : ev.gamma, bb = land ? -ev.gamma : ev.beta - 35;       // (held at a comfortable angle)
    tilt.gx = clamp((a || 0) / 25, -1, 1) * (land && window.orientation === -90 ? -1 : 1); tilt.gy = clamp((bb || 0) / 25, -1, 1) * (land && window.orientation === -90 ? -1 : 1); });
};
$('pzClose').onclick = closePuzzle;
addEventListener('keydown', e => {
  if (!pzOpen) return;
  if (e.code === 'Escape' || (e.code === 'KeyE' && !e.repeat)) closePuzzle();
  keys[e.code] = true; e.stopImmediatePropagation();       // (the arrow keys / WASD tilt the board; the player doesn't walk)
}, true);
