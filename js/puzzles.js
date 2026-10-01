/* Escape from Barbi Blue: the puzzles. Every floor has its own kind of puzzle, in wooden boxes on the walls (3 to 5 of them).
   Solve them all and the front door unlocks. (In the rest of the code a solved puzzle counts as a "fuse", from when the game had fuses.)
     1 The Nursery    maze   - a tilting ball maze: roll the ball into the gold hole, around the holes (a hole is loud: she hears it)
     2 The Hallway    slide  - a sliding-tile puzzle: put the doll's portrait back together
     3 The Basement   pipes  - turn the pipes until the water runs from the valve to the drain
     4 The Attic      simon  - a music box plays a melody on four keys; play it back, one note longer each time (a wrong note is loud)
     5 The Workshop   rings  - turn the rings until her face lines up; turning a ring also turns the next one
   The game keeps going while you play: she can come. Each box is made from a seed, so every player gets the same one.
   Later floors and harder difficulties: bigger boards, more holes, longer melodies, more rings. */
'use strict';

let puzzles = [], puzzleTarget = null, pzOpen = null;
const FLOOR_KIND = ['maze', 'slide', 'pipes', 'simon', 'rings'];
const puzzleCount = (i, diff) => Math.max(1, Math.min(5, [3, 3, 4, 4, 5][i] + (diff === 'easy' ? -1 : 0)));
const diffN = diff => diff === 'easy' ? 0 : diff === 'hard' ? 2 : 1;
function mazeSpec(floor, diff) {
  const d = diffN(diff);
  return { cols: 4 + Math.min(3, (floor >> 1) + d), rows: 3 + Math.min(3, ((floor + 1) >> 1) + (d >> 1)), holes: [1, 3, 5][d] + (floor >> 1), speed: [0.8, 1, 1.15][d] };
}
function puzzleSpec(kind, floor, diff) {
  const d = diffN(diff);
  if (kind === 'maze') return mazeSpec(floor, diff);
  if (kind === 'slide') return { n: d === 2 ? 4 : 3, moves: [16, 36, 70][d] };
  if (kind === 'pipes') return { n: 4 + d };
  if (kind === 'simon') return { len: 4 + d };
  return { rings: 3 + (d === 2 ? 1 : 0), steps: 8 };
}
// a small seeded random number generator (the same box for everyone)
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- making a floor's boxes (on the host: everyone gets the same ones) ---------- */
// okFace(x, y, dx, dy), if given: may a box hang on that wall (no furniture in front of it, js/layout.js faceClear)
function makePuzzles(n, cells, floor, diff, okFace) {
  const out = [], kind = FLOOR_KIND[floor] || 'maze';
  for (let i = 0; i < cells.length && out.length < n; i++) {
    const [x, y] = cells[i], walls = DIRS.filter(([dx, dy]) => isWall(x + dx, y + dy) && (!okFace || okFace(x, y, dx, dy)));
    if (!walls.length) continue;
    const [dx, dy] = walls[Math.random() * walls.length | 0];
    out.push({ cell: [x, y], dir: [dx, dy], seed: Math.random() * 1e9 | 0, kind, spec: puzzleSpec(kind, floor, diff) });
  }
  return out;
}
function applyPuzzles(list) {
  closePuzzle(); puzzleTarget = null;
  puzzles = (list || []).map(p => { const z = Object.assign({ kind: 'maze' }, p, { solved: false }); z.data = KINDS[z.kind].build(z); return z; });
  puzzles.forEach((p, k) => { const f = fuses[k]; if (!f) return; const w = wallPoint(p.cell, p.dir, 12); f.x = w.x; f.y = w.y; f.pz = p; });
}
// a point on the wall of a cell, pulled back into the room by `back` units
function wallPoint(cell, dir, back) { return { x: (cell[0] + 0.5) * T + dir[0] * (T / 2 - back), y: (cell[1] + 0.5) * T + dir[1] * (T / 2 - back) }; }
const faceKey = (cell, dir) => cell[0] + ',' + cell[1] + ',' + (-dir[0]) + ',' + (-dir[1]);   // (the wall face, as js/level.js names them)
function puzzleFaces() { return new Set(puzzles.map(p => faceKey(p.cell, p.dir))); }

/* ---------- the five kinds. Each: build (from the seed), start (a fresh board), draw, and optionally update, click, key ---------- */
const KINDS = {};

// 1. the tilting ball maze
KINDS.maze = {
  title: 'The labyrinth box',
  help: pc => pc ? 'Roll the ball into the <b>gold hole</b>. Point the mouse where it should roll (or use the arrow keys). Mind the holes: they are loud.'
                 : 'Roll the ball into the <b>gold hole</b>. Drag your finger where it should roll, or tilt your phone. Mind the holes: they are loud.',
  build: pz => buildMaze(pz),
  start: () => ({ ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 }, fall: 0 }),
  resume: s => ({ ball: s.fall ? { x: 0.5, y: 0.5, vx: 0, vy: 0 } : { x: s.ball.x, y: s.ball.y, vx: 0, vy: 0 }, fall: 0 }),   // (the ball where you left it, still)
  draw: (o, pz, cv) => mazeCanvas(pz.data, cv.width, cv.height, { x: o.ball.x, y: o.ball.y, s: o.fall ? Math.max(0, 1 - o.fall * 1.6) : 1 }, cv),
  update: (o, pz, dt) => updateBall(dt),
  tilts: true,
};
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

// the physics: the tilt pushes the ball; it rolls, bumps off walls, drops into holes
function updateBall(dt) {
  const o = pzOpen, pz = puzzles[o.k], mz = pz.data, b = o.ball, sp = pz.spec.speed;
  if (o.fall) { o.fall += dt; if (o.fall > 0.8) { o.fall = 0; Object.assign(b, { x: 0.5, y: 0.5, vx: 0, vy: 0 }); } return; }
  tilt.kx = ((keys.ArrowRight || keyDown('right')) ? 1 : 0) - ((keys.ArrowLeft || keyDown('left')) ? 1 : 0);
  tilt.ky = ((keys.ArrowDown || keyDown('back')) ? 1 : 0) - ((keys.ArrowUp || keyDown('forward')) ? 1 : 0);
  const tx = clamp(tilt.mx + tilt.kx + tilt.gx, -1, 1), ty = clamp(tilt.my + tilt.ky + tilt.gy, -1, 1);
  const r = 0.14, wt = 0.06, steps = Math.max(1, Math.ceil(dt / 0.004)), h = dt / steps;
  for (let s = 0; s < steps; s++) {
    b.vx += tx * 9 * sp * h; b.vy += ty * 9 * sp * h;
    const f = Math.max(0, 1 - 1.6 * h); b.vx *= f; b.vy *= f;
    const v = Math.hypot(b.vx, b.vy), vmax = 4.5 * sp; if (v > vmax) { b.vx *= vmax / v; b.vy *= vmax / v; }
    b.x += b.vx * h; b.y += b.vy * h;
    const cx = Math.floor(b.x), cy = Math.floor(b.y);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= mz.C || y >= mz.R) continue; const w = mz.W[y][x];
      if (w & 1) bump(b, x - wt, y - wt, x + 1 + wt, y + wt, r); if (w & 4) bump(b, x - wt, y + 1 - wt, x + 1 + wt, y + 1 + wt, r);
      if (w & 8) bump(b, x - wt, y - wt, x + wt, y + 1 + wt, r); if (w & 2) bump(b, x + 1 - wt, y - wt, x + 1 + wt, y + 1 + wt, r);
    }
    b.x = clamp(b.x, r, mz.C - r); b.y = clamp(b.y, r, mz.R - r);
  }
  for (const hl of mz.holes) if (Math.hypot(b.x - hl.x, b.y - hl.y) < 0.15) { o.fall = 0.001; b.x = hl.x; b.y = hl.y; pzFail('It fell in. That was loud...'); return; }
  if (Math.hypot(b.x - (mz.C - 0.5), b.y - (mz.R - 0.5)) < 0.18) { b.x = mz.C - 0.5; b.y = mz.R - 0.5; pzWin(); }
}
function bump(b, x0, y0, x1, y1, r) {
  const px = clamp(b.x, x0, x1), py = clamp(b.y, y0, y1), dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy);
  if (d >= r || d === 0) return;
  const nx = dx / d, ny = dy / d; b.x = px + nx * r; b.y = py + ny * r;
  const vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 1.35 * vn * nx; b.vy -= 1.35 * vn * ny; }
}

// 2. the sliding tiles: a doll's portrait, cut up and shuffled (by legal moves, so it can always be put back)
KINDS.slide = {
  title: 'The portrait',
  help: pc => 'Slide the pieces back into place to put her portrait together. ' + (pc ? 'Drag a piece next to the gap into it with the mouse (or click it, or use the arrow keys).' : 'Drag a piece next to the gap into it (or tap it).'),
  build: pz => { const n = pz.spec.n, rnd = seeded(pz.seed), t = Array.from({ length: n * n }, (_, i) => i); let e = n * n - 1, prev = -1; const hist = [];
    for (let m = 0; m < pz.spec.moves; m++) { const ex = e % n, ey = e / n | 0;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [ex + dx, ey + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && y * n + x !== prev);
      const [x, y] = nb[rnd() * nb.length | 0], j = y * n + x; hist.push(e); [t[e], t[j]] = [t[j], t[e]]; prev = e; e = j; }
    if (t.every((v, i) => v === i)) { const j = e - 1 >= 0 && (e % n) ? e - 1 : e + 1; hist.push(e); [t[e], t[j]] = [t[j], t[e]]; e = j; }
    return { n, tiles: t, empty: e, hist, pic: portraitCanvas(pz.seed) }; },
  start: pz => ({ tiles: pz.data.tiles.slice(), empty: pz.data.empty }),
  draw: (o, pz, cv) => { const g = cv.getContext('2d'), n = pz.data.n, W = cv.width, H = cv.height, s = Math.min(W, H) * 0.9, cs = s / n, ox = (W - s) / 2, oy = (H - s) / 2, P = pz.data.pic;
    g.fillStyle = '#1a1210'; g.fillRect(0, 0, W, H); g.fillStyle = '#5a3a20'; g.fillRect(ox - 8, oy - 8, s + 16, s + 16);
    g.fillStyle = '#0a0706'; const ex = o.empty % n, ey = o.empty / n | 0; g.fillRect(ox + ex * cs + 1, oy + ey * cs + 1, cs - 2, cs - 2);
    const dr = o.drag;
    o.tiles.forEach((v, i) => { if (v === n * n - 1) return; const sx = v % n, sy = v / n | 0; let x = ox + (i % n) * cs, y = oy + (i / n | 0) * cs;
      if (dr && dr.j === i) { x += dr.dir[0] * dr.off * cs; y += dr.dir[1] * dr.off * cs; }     // (the piece you're dragging, part way into the gap)
      g.drawImage(P, sx * P.width / n, sy * P.height / n, P.width / n, P.height / n, x + 1, y + 1, cs - 2, cs - 2);
      if (dr && dr.j === i) { g.strokeStyle = 'rgba(255,230,180,.8)'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, cs - 4, cs - 4); }
      if (curDiff === 'easy') { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x + 3, y + 3, 18, 16); g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(v + 1, x + 6, y + 15); } });
  },
  // dragging: grab a piece next to the gap and pull it in; past halfway (or a plain click) it slides in, otherwise it springs back
  down: (o, pz, x, y, cv) => { const n = pz.data.n, s = Math.min(cv.width, cv.height) * 0.9, cs = s / n, ox = (cv.width - s) / 2, oy = (cv.height - s) / 2;
    const cx = Math.floor((x - ox) / cs), cy = Math.floor((y - oy) / cs), ex = o.empty % n, ey = o.empty / n | 0;
    if (cx < 0 || cy < 0 || cx >= n || cy >= n || Math.abs(cx - ex) + Math.abs(cy - ey) !== 1) return;
    o.drag = { j: cy * n + cx, dir: [ex - cx, ey - cy], x0: x, y0: y, off: 0, cs, moved: 0 }; },
  move: (o, pz, x, y) => { const d = o.drag; if (!d) return; d.moved = Math.max(d.moved, Math.hypot(x - d.x0, y - d.y0));
    d.off = clamp(((x - d.x0) * d.dir[0] + (y - d.y0) * d.dir[1]) / d.cs, 0, 1); },
  up: (o, pz) => { const d = o.drag; if (!d) return; o.drag = null; if (d.off > 0.45 || d.moved < 6) slideAt(o, pz, d.j); },
  // a tap: the piece moves into the gap if it's next to it
  click: (o, pz, x, y, cv) => { const n = pz.data.n, s = Math.min(cv.width, cv.height) * 0.9, cs = s / n, ox = (cv.width - s) / 2, oy = (cv.height - s) / 2;
    const cx = Math.floor((x - ox) / cs), cy = Math.floor((y - oy) / cs); if (cx < 0 || cy < 0 || cx >= n || cy >= n) return; slideAt(o, pz, cy * n + cx); },
  key: (o, pz, code) => { const n = pz.data.n, ex = o.empty % n, ey = o.empty / n | 0, d = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[code] ||
      (isKey(code, 'left') ? [1, 0] : isKey(code, 'right') ? [-1, 0] : isKey(code, 'forward') ? [0, 1] : isKey(code, 'back') ? [0, -1] : null);
    if (d) { const x = ex + d[0], y = ey + d[1]; if (x >= 0 && y >= 0 && x < n && y < n) slideAt(o, pz, y * n + x); } },
};
function slideAt(o, pz, j) {
  const n = pz.data.n, e = o.empty; if (Math.abs(j % n - e % n) + Math.abs((j / n | 0) - (e / n | 0)) !== 1) return;
  [o.tiles[e], o.tiles[j]] = [o.tiles[j], o.tiles[e]]; o.empty = j; sfx.step(false);
  if (o.tiles.every((v, i) => v === i)) pzWin();
}
// the picture: a porcelain doll in an old frame (a different one for each seed)
function portraitCanvas(seed) {
  const rnd = seeded(seed ^ 0x5bd1e995), c = mkCanvas(300, 300), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 300); bg.addColorStop(0, ['#3a2a4a', '#2a3a4a', '#4a2a2a'][rnd() * 3 | 0]); bg.addColorStop(1, '#0a0808'); g.fillStyle = bg; g.fillRect(0, 0, 300, 300);
  g.fillStyle = ['#0b0d18', '#5a2a14', '#d8b06a'][rnd() * 3 | 0]; g.beginPath(); g.ellipse(150, 140, 95, 110, 0, 0, 7); g.fill();
  g.fillStyle = '#e8e0d8'; g.beginPath(); g.ellipse(150, 155, 62, 76, 0, 0, 7); g.fill();
  const eye = ['#3a6ad8', '#6ab8ff', '#1a1a1a'][rnd() * 3 | 0];
  for (const x of [125, 175]) { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 145, 15, 11, 0, 0, 7); g.fill(); g.fillStyle = eye; g.beginPath(); g.arc(x, 146, 8, 0, 7); g.fill(); g.fillStyle = '#000'; g.beginPath(); g.arc(x, 146, 3.5, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(220,110,120,.45)'; for (const x of [112, 188]) { g.beginPath(); g.arc(x, 180, 14, 0, 7); g.fill(); }
  g.fillStyle = '#9a1a28'; g.beginPath(); g.ellipse(150, 200, 14, 7, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(40,30,30,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(160, 95); g.lineTo(172, 128); g.lineTo(165, 150); g.stroke();   // a crack
  g.fillStyle = ['#2a4390', '#8a2a4a', '#2a6a4a'][rnd() * 3 | 0]; g.beginPath(); g.moveTo(40, 300); g.quadraticCurveTo(150, 215, 260, 300); g.fill();
  g.strokeStyle = '#b8903a'; g.lineWidth = 10; g.strokeRect(5, 5, 290, 290);
  return c;
}

// 3. the pipes: turn them until the water runs from the valve (left) to the drain (right)
KINDS.pipes = {
  title: 'The pipes',
  help: pc => 'Turn the pipes (' + (pc ? 'click' : 'tap') + ' one to turn it) until the water runs from the valve on the left to the drain on the right.',
  build: pz => { const n = pz.spec.n, rnd = seeded(pz.seed), M = Array.from({ length: n }, () => new Array(n).fill(0)), seen = M.map(r => r.map(() => false));
    const D = [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]], r0 = rnd() * n | 0, r1 = rnd() * n | 0, st = [[0, r0]]; seen[r0][0] = true;
    while (st.length) { const [x, y] = st[st.length - 1], nb = D.filter(([dx, dy]) => { const a = x + dx, b = y + dy; return a >= 0 && b >= 0 && a < n && b < n && !seen[b][a]; });
      if (!nb.length) { st.pop(); continue; } const [dx, dy, b, ob] = nb[rnd() * nb.length | 0]; M[y][x] |= b; M[y + dy][x + dx] |= ob; seen[y + dy][x + dx] = true; st.push([x + dx, y + dy]); }
    M[r0][0] |= 8; M[r1][n - 1] |= 2;                      // (the valve and the drain)
    let rot; do { rot = M.map(r => r.map(() => rnd() * 4 | 0)); } while (pipesFlow(n, M, rot, r0, r1).done);
    return { n, M, rot, r0, r1 }; },
  start: pz => ({ rot: pz.data.rot.map(r => r.slice()) }),
  draw: (o, pz, cv) => { const { n, M, r0, r1 } = pz.data, g = cv.getContext('2d'), W = cv.width, H = cv.height, s = Math.min(W * 0.8, H * 0.9), cs = s / n, ox = (W - s) / 2, oy = (H - s) / 2;
    const flow = pipesFlow(n, M, o.rot, r0, r1);
    g.fillStyle = '#141614'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a2e2a'; g.lineWidth = 1; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(ox + i * cs, oy); g.lineTo(ox + i * cs, oy + s); g.moveTo(ox, oy + i * cs); g.lineTo(ox + s, oy + i * cs); g.stroke(); }
    const pipe = (x0, y0, x1, y1, wet) => { g.lineCap = 'round'; g.strokeStyle = '#1a1a1a'; g.lineWidth = cs * 0.34; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = wet ? '#3a8ad8' : '#6a5a4a'; g.lineWidth = cs * 0.24; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const m = rotMask(M[y][x], o.rot[y][x]), cx = ox + (x + 0.5) * cs, cy = oy + (y + 0.5) * cs, wet = flow.wet.has(x + ',' + y);
      [[1, 0, -0.5], [2, 0.5, 0], [4, 0, 0.5], [8, -0.5, 0]].forEach(([b, dx, dy]) => { if (m & b) pipe(cx, cy, cx + dx * cs, cy + dy * cs, wet); });
      g.fillStyle = wet ? '#3a8ad8' : '#6a5a4a'; g.beginPath(); g.arc(cx, cy, cs * 0.14, 0, 7); g.fill(); }
    g.fillStyle = '#b8903a'; g.beginPath(); g.arc(ox - 14, oy + (r0 + 0.5) * cs, 12, 0, 7); g.fill(); pipe(ox - 14, oy + (r0 + 0.5) * cs, ox, oy + (r0 + 0.5) * cs, true);
    g.fillStyle = flow.done ? '#3a8ad8' : '#0a0a0a'; g.beginPath(); g.arc(ox + s + 14, oy + (r1 + 0.5) * cs, 12, 0, 7); g.fill(); g.strokeStyle = '#888'; g.lineWidth = 2; g.stroke(); },
  click: (o, pz, x, y, cv) => { const n = pz.data.n, s = Math.min(cv.width * 0.8, cv.height * 0.9), cs = s / n, ox = (cv.width - s) / 2, oy = (cv.height - s) / 2;
    const cx = Math.floor((x - ox) / cs), cy = Math.floor((y - oy) / cs); if (cx < 0 || cy < 0 || cx >= n || cy >= n) return;
    o.rot[cy][cx] = (o.rot[cy][cx] + 1) % 4; sfx.creak(0.05); if (pipesFlow(n, pz.data.M, o.rot, pz.data.r0, pz.data.r1).done) pzWin(); },
};
const rotMask = (m, r) => ((m << r) | (m >> (4 - r))) & 15;   // (turned clockwise r quarter turns: N to E to S to W)
function pipesFlow(n, M, rot, r0, r1) {
  const wet = new Set(), m = (x, y) => rotMask(M[y][x], rot[y][x]), q = [];
  if (m(0, r0) & 8) { wet.add('0,' + r0); q.push([0, r0]); }
  while (q.length) { const [x, y] = q.shift(), a = m(x, y);
    for (const [b, dx, dy, ob] of [[1, 0, -1, 4], [2, 1, 0, 8], [4, 0, 1, 1], [8, -1, 0, 2]]) { const nx = x + dx, ny = y + dy;
      if ((a & b) && nx >= 0 && ny >= 0 && nx < n && ny < n && (m(nx, ny) & ob) && !wet.has(nx + ',' + ny)) { wet.add(nx + ',' + ny); q.push([nx, ny]); } } }
  return { wet, done: wet.has((n - 1) + ',' + r1) && !!(m(n - 1, r1) & 2) };
}

// 4. the music box: it plays a melody; play it back, one more note each time. A wrong note is loud.
const MB_KEYS = [{ col: '#d8423a', f: 523 }, { col: '#e8d24a', f: 659 }, { col: '#5ab85a', f: 784 }, { col: '#4a7ae8', f: 988 }];
KINDS.simon = {
  title: 'The music box',
  help: pc => 'Listen, then play the melody back. One note longer each time. A wrong note is loud. ' + (pc ? '(Click the keys, or press 1 2 3 4.)' : ''),
  build: pz => { const rnd = seeded(pz.seed); return { seq: Array.from({ length: pz.spec.len }, () => rnd() * 4 | 0) }; },
  start: () => ({ round: 1, phase: 'listen', t: -0.6, i: 0, lit: -1, litT: 0 }),
  resume: s => ({ round: s.round, phase: 'listen', t: -0.6, i: 0, lit: -1, litT: 0 }),   // (the round you'd reached, played to you again)
  draw: (o, pz, cv) => { const g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.42;
    g.fillStyle = '#1a1210'; g.fillRect(0, 0, W, H); g.fillStyle = '#4a2e18'; g.beginPath(); g.arc(cx, cy, R + 14, 0, 7); g.fill();
    MB_KEYS.forEach((k, i) => { const a0 = i * Math.PI / 2 - Math.PI / 2 + 0.05, a1 = a0 + Math.PI / 2 - 0.1;
      g.fillStyle = k.col; g.globalAlpha = o.lit === i ? 1 : 0.35; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill(); g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,.7)'; g.font = 'bold 18px system-ui'; g.textAlign = 'center'; const am = (a0 + a1) / 2; g.fillText(i + 1, cx + Math.cos(am) * R * 0.7, cy + Math.sin(am) * R * 0.7 + 6); });
    g.fillStyle = '#2a1a0e'; g.beginPath(); g.arc(cx, cy, R * 0.32, 0, 7); g.fill();
    g.fillStyle = '#e8d8b8'; g.font = '15px Georgia'; g.textAlign = 'center';
    g.fillText(o.phase === 'listen' ? 'listen...' : 'your turn', cx, cy - 4); g.fillText(Math.min(o.round, pz.spec.len) + ' / ' + pz.spec.len, cx, cy + 16); },
  update: (o, pz, dt) => { if (o.litT > 0 && (o.litT -= dt) <= 0) o.lit = -1;
    if (o.phase !== 'listen') return; o.t += dt;
    if (o.t >= 0.65) { o.t = 0; if (o.i < o.round) { const k = pz.data.seq[o.i++]; o.lit = k; o.litT = 0.45; sfx.note(MB_KEYS[k].f, 0.3, 0); } else { o.phase = 'play'; o.i = 0; } } },
  click: (o, pz, x, y, cv) => { const cx = cv.width / 2, cy = cv.height / 2, R = Math.min(cv.width, cv.height) * 0.42, d = Math.hypot(x - cx, y - cy);
    if (d < R * 0.32 || d > R) return; let a = Math.atan2(y - cy, x - cx) + Math.PI / 2; if (a < 0) a += Math.PI * 2; musicKey(o, pz, Math.floor(a / (Math.PI / 2)) % 4); },
  key: (o, pz, code) => { const k = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[code]; if (k !== undefined) musicKey(o, pz, k); },
};
function musicKey(o, pz, k) {
  if (o.phase !== 'play') return;
  o.lit = k; o.litT = 0.25; sfx.note(MB_KEYS[k].f, 0.3, 0);
  if (k !== pz.data.seq[o.i]) { Object.assign(o, { phase: 'listen', t: -0.9, i: 0 }); pzFail('Wrong note. That was loud...'); return; }
  if (++o.i >= o.round) { if (o.round >= pz.spec.len) { pzWin(); return; } Object.assign(o, { round: o.round + 1, phase: 'listen', t: -0.5, i: 0 }); }
}

// 5. the rings: her face in rings, turned out of place. Turning a ring also turns the next one out.
KINDS.rings = {
  title: 'Her face',
  help: pc => 'Turn the rings until her face lines up. ' + (pc ? 'Click' : 'Tap') + ' a ring to turn it; the next ring out turns with it.',
  build: pz => { const rnd = seeded(pz.seed), R = pz.spec.rings, S = pz.spec.steps; let off;
    do { off = Array.from({ length: R }, () => rnd() * S | 0); } while (off.every(v => v === 0));
    return { R, S, off, pic: portraitCanvas(pz.seed) }; },
  start: pz => ({ off: pz.data.off.slice() }),
  draw: (o, pz, cv) => { const g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, Rm = Math.min(W, H) * 0.46, { R, S, pic } = pz.data;
    g.fillStyle = '#1a1210'; g.fillRect(0, 0, W, H);
    for (let i = R; i >= 0; i--) {                         // (the middle disc doesn't turn: it shows which way is up)
      const r = Rm * (i + 1) / (R + 1), a = i === 0 ? 0 : o.off[i - 1] / S * Math.PI * 2;
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip(); g.translate(cx, cy); g.rotate(a); g.drawImage(pic, -Rm, -Rm, Rm * 2, Rm * 2); g.restore();
      g.strokeStyle = '#b8903a'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); } },
  click: (o, pz, x, y, cv) => { const cx = cv.width / 2, cy = cv.height / 2, Rm = Math.min(cv.width, cv.height) * 0.46, { R } = pz.data, d = Math.hypot(x - cx, y - cy);
    const ring = Math.ceil(d / (Rm / (R + 1))) - 1; if (ring < 1 || ring > R) return; turnRing(o, pz, ring - 1); },
};
function turnRing(o, pz, i) {
  const { R, S } = pz.data; o.off[i] = (o.off[i] + 1) % S; if (i + 1 < R) o.off[i + 1] = (o.off[i + 1] + 1) % S; sfx.creak(0.06);
  if (o.off.every(v => v === 0)) pzWin();
}

/* ---------- in 3D: a wooden box on the wall, showing its puzzle ---------- */
function buildPuzzles3D(G) {
  const L = TILE_M;
  puzzles.forEach(p => {
    const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.6 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 0.1), wood); box.castShadow = true; g.add(box);
    const cv = mkCanvas(256, 214); KINDS[p.kind].draw(p.saved || KINDS[p.kind].start(p), p, cv); const tx = toTex(cv); p.cv = cv; p.tx = tx;
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

/* ---------- every frame: the box you're next to, the hum, and the open puzzle ---------- */
let pzHum = 0;
function updatePuzzles(dt) {
  const p = player; puzzleTarget = null;
  if (pzOpen) { const o = pzOpen, pz = puzzles[o.k], K = KINDS[pz.kind];
    if (o.won) { o.won += dt; if (o.won > 0.5 && !o.sent) { o.sent = true; if (MP.on) toHost({ t: 'solve', k: o.k }); else applyFuse(o.k); } }
    else if (K.update) K.update(o, pz, dt);
    drawBoard(); }
  if (p.hidden || p.down || p.dead) return;
  let bd = 36;
  puzzles.forEach((pz, k) => { if (pz.solved) return; const w = wallPoint(pz.cell, pz.dir, 12), d = Math.hypot(w.x - p.x, w.y - p.y);
    if (d < bd && los(p.x, p.y, w.x, w.y)) { bd = d; puzzleTarget = k; } });
  pzHum -= dt;
  if (pzHum <= 0) { pzHum = 1.1; for (const pz of puzzles) if (!pz.solved) { const w = wallPoint(pz.cell, pz.dir, 12); if (Math.hypot(w.x - p.x, w.y - p.y) < T * 6) sfx.hum({ x: w.x, y: w.y, h: 1.3 }); } }
}

/* ---------- the puzzle screen ---------- */
const tilt = { mx: 0, my: 0, kx: 0, ky: 0, gx: 0, gy: 0, gyro: false, drag: false };
// A puzzle you leave half done stays as you left it (for you: each player has their own go at it). Coming back, you carry on.
function openPuzzle(k) {
  const pz = puzzles[k]; if (!pz || pz.solved) return; const K = KINDS[pz.kind], saved = pz.saved;
  pzOpen = Object.assign({ k, won: 0 }, saved ? (K.resume ? K.resume(saved, pz) : saved) : K.start(pz));
  Object.assign(tilt, { mx: 0, my: 0, kx: 0, ky: 0 });
  setSprint(false); joy.id = null; joy.x = joy.y = 0;
  if (locked()) document.exitPointerLock();                // (the puzzle needs a cursor; the game keeps going: she can still come)
  const pc = document.body.classList.contains('pc');
  $('pzTitle').textContent = K.title; $('pzHelp').innerHTML = K.help(pc);
  show('pzGyro', !!K.tilts && !pc && 'DeviceOrientationEvent' in window && !tilt.gyro);
  $('pzMsg').textContent = saved ? 'Carrying on where you left off.' : ''; show('puzzle', true); drawBoard();
}
function closePuzzle() {
  if (!pzOpen) return; const o = pzOpen, pz = puzzles[o.k]; pzOpen = null; show('puzzle', false);
  if (pz && !o.won && !pz.solved) {                       // (keep how far you got; the box on the wall shows it too)
    const st = Object.assign({}, o); delete st.k; delete st.won; delete st.sent; delete st.drag;
    pz.saved = typeof structuredClone === 'function' ? structuredClone(st) : JSON.parse(JSON.stringify(st));
    if (pz.cv && pz.tx) { KINDS[pz.kind].draw(pz.saved, pz, pz.cv); pz.tx.needsUpdate = true; }
  }
  if (state === 'play') lockMouse();
}
function drawBoard() {
  const o = pzOpen; if (!o) return; const pz = puzzles[o.k], cv = $('pzBoard');
  KINDS[pz.kind].draw(o, pz, cv);
  if (KINDS[pz.kind].tilts) { const tx = clamp(tilt.mx + tilt.kx + tilt.gx, -1, 1), ty = clamp(tilt.my + tilt.ky + tilt.gy, -1, 1);
    cv.style.transform = 'perspective(700px) rotateX(' + (-ty * 9).toFixed(1) + 'deg) rotateY(' + (tx * 9).toFixed(1) + 'deg)'; }
  else cv.style.transform = '';
}
// solved: a click, and (half a second later) it counts
function pzWin() { const o = pzOpen; if (!o || o.won) return; o.won = 0.001; sfx.pickup(); $('pzMsg').textContent = 'Click. Something unlocked.'; }
// a loud mistake (a ball in a hole, a wrong note): she hears it
function pzFail(msg) {
  sfx.clang(); shake = Math.max(shake, 2); $('pzMsg').textContent = msg;
  if (MP.on) toHost({ t: 'noise' }); else puzzleNoise(player.x, player.y, 'me');
}
// (the host, or single player) she heard that
function puzzleNoise(x, y, id) { makeNoise(x, y, id, 700 * DF().hear); }   // (js/stealth.js)
// solved (applyFuse calls this)
function puzzleSolved(k) { const pz = puzzles[k]; if (!pz) return; pz.solved = true; if (pzOpen && pzOpen.k === k) closePuzzle(); }
// the hint arrow (js/render.js): the boxes not solved yet
function hintTargets() { return puzzles.filter(p => !p.solved).map(p => Object.assign(wallPoint(p.cell, p.dir, 12), { what: 'puzzle' })); }

// input: taps and clicks on the board; the mouse / a finger / the arrow keys / the phone tilt the maze
function boardXY(e) { const cv = $('pzBoard'), r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height]; }
function pointTilt(e) {
  const r = $('pzBoard').getBoundingClientRect(); if (!r.width) return;
  tilt.mx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.35), -1, 1); tilt.my = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 0.35), -1, 1);
}
addEventListener('pointermove', e => { if (pzOpen && KINDS[puzzles[pzOpen.k].kind].tilts && (e.pointerType === 'mouse' || tilt.drag)) pointTilt(e); });
$('pzBoard').addEventListener('pointerdown', e => {
  if (!pzOpen) return; const pz = puzzles[pzOpen.k], K = KINDS[pz.kind]; e.preventDefault();
  if (K.tilts) { tilt.drag = true; pointTilt(e); return; }
  const [x, y] = boardXY(e);
  if (K.down && !pzOpen.won) { K.down(pzOpen, pz, x, y, $('pzBoard')); return; }       // (a piece you can drag)
  if (K.click && !pzOpen.won) K.click(pzOpen, pz, x, y, $('pzBoard'));
});
addEventListener('pointermove', e => { if (pzOpen && pzOpen.drag) { const K = KINDS[puzzles[pzOpen.k].kind]; if (K.move) { const [x, y] = boardXY(e); K.move(pzOpen, puzzles[pzOpen.k], x, y); } } });
addEventListener('pointerup', () => {
  if (pzOpen && pzOpen.drag) { const K = KINDS[puzzles[pzOpen.k].kind]; if (K.up && !pzOpen.won) K.up(pzOpen, puzzles[pzOpen.k]); else pzOpen.drag = null; }
  if (tilt.drag) { tilt.drag = false; if (!tilt.gyro) tilt.mx = tilt.my = 0; } });
$('pzGyro').onclick = async () => {
  try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } } catch (e) { return; }
  tilt.gyro = true; show('pzGyro', false);
  addEventListener('deviceorientation', ev => { if (!pzOpen) return; const land = Math.abs(window.orientation || 0) === 90 || innerWidth > innerHeight;
    const a = land ? ev.beta : ev.gamma, bb = land ? -ev.gamma : ev.beta - 35, flip = land && window.orientation === -90 ? -1 : 1;
    tilt.gx = clamp((a || 0) / 25, -1, 1) * flip; tilt.gy = clamp((bb || 0) / 25, -1, 1) * flip; });
};
$('pzClose').onclick = closePuzzle;
addEventListener('keydown', e => {
  if (!pzOpen) return;
  if (e.code === 'Escape' || (isKey(e.code, 'use') && !e.repeat)) { closePuzzle(); e.stopImmediatePropagation(); return; }
  const pz = puzzles[pzOpen.k], K = KINDS[pz.kind];
  if (K.key && !e.repeat && !pzOpen.won) K.key(pzOpen, pz, e.code);
  keys[normKey(e.code)] = true; e.stopImmediatePropagation();       // (the keys work the puzzle; the player doesn't walk)
}, true);
