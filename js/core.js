/* Escape from Barbi Blue: Setup, settings, the floors' content and the maze (the game logic works on a flat grid: a tile is T = 50 units).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- setup ---------- */
const T = 50;                       // world units per tile (2.25 m: wide enough for two players side by side)
const cvs = document.getElementById('c'), ctx = cvs.getContext('2d');   // 2D overlay on top of the 3D view
const faceCv = document.createElement('canvas'); faceCv.width = faceCv.height = 512;
const fctx = faceCv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  if (!renderer) return;
  applyQuality(); renderer.setSize(W, H, false);
  // keep the chosen field of view sideways (80 degrees unless changed in the settings), in portrait and landscape
  const asp = W / H, fov = clamp(2 * Math.atan(Math.tan(clamp(settings.fov || 80, 65, 110) / 2 * Math.PI / 180) / asp) * 180 / Math.PI, 50, 110);
  camera.aspect = asp; camera.fov = fov; camera.updateProjectionMatrix();
  titleCam.aspect = asp; titleCam.fov = asp < 1 ? 38 : 30;
  // wide screens: the menu is on the left, so she is moved to the right of the picture
  if (asp >= 1 && W >= 700) titleCam.setViewOffset(W, H, -W * 0.22, 0, W, H);
  else titleCam.setViewOffset(W, H, 0, H * 0.05, W, H);   // phones: her face sits between the title and the buttons
  titleCam.updateProjectionMatrix();
}
// Graphics: Low = no shadows, no glow, lower resolution. Medium = flashlight shadows and beam pattern. High = plus glow (bloom)
let resScale = 1;                 // dynamic resolution (js/main.js lowers it when frames get slow)
function applyQuality() {
  if (!renderer) return;
  const q = settings.quality, pr = (q === 'low' ? 1 : Math.min(DPR, LOWQ ? 1.5 : 2)) * resScale;
  renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
  flash.castShadow = q !== 'low';
  flash.map = q !== 'low' ? flashCookie : null;
  useBloom = q === 'high' && !!composer;
  if (composer) { composer.setPixelRatio(pr); composer.setSize(W, H); bloomPass.resolution.set(W * pr / 2, H * pr / 2); }
}

const grain = document.createElement('canvas'); grain.width = grain.height = 128;
{ const g = grain.getContext('2d'), id = g.createImageData(128, 128);
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i+1] = id.data[i+2] = v; id.data[i+3] = 255; }
  g.putImageData(id, 0, 0); }
const grainPat = ctx.createPattern(grain, 'repeat');

const $ = id => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const lerpAngle = (a, b, k) => a - angDiff(a, b) * k;
/* ---------- settings (kept on this device) ---------- */
const settings = { sens: 1, vol: 0.9, quality: matchMedia('(pointer: coarse)').matches ? 'medium' : 'high', fov: 80, invert: false, calm: false, difficulty: 'medium' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('bb_settings') || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('bb_settings', JSON.stringify(settings)); } catch (e) {} };
function applySettings() {
  $('setSens').value = settings.sens; $('outSens').textContent = Number(settings.sens).toFixed(2) + '×';
  $('setVol').value = settings.vol; $('outVol').textContent = Math.round(settings.vol * 100) + '%';
  $('setFov').value = settings.fov; $('outFov').textContent = Math.round(settings.fov) + '°';
  $('setInvert').checked = !!settings.invert; $('setCalm').checked = !!settings.calm;
  document.querySelectorAll('#qSeg button').forEach(b => b.classList.toggle('on', b.dataset.q === settings.quality));
  if (typeof master !== 'undefined' && master) master.gain.value = settings.vol;
  if (typeof applyQuality === 'function') applyQuality();
  if (typeof resize === 'function' && typeof camera !== 'undefined' && camera) resize();
}
$('setSens').oninput = e => { settings.sens = +e.target.value; applySettings(); saveSettings(); };
$('setVol').oninput = e => { settings.vol = +e.target.value; applySettings(); saveSettings(); };
$('setFov').oninput = e => { settings.fov = +e.target.value; applySettings(); saveSettings(); };
$('setInvert').onchange = e => { settings.invert = e.target.checked; saveSettings(); };
$('setCalm').onchange = e => { settings.calm = e.target.checked; saveSettings(); };
const calm = () => !!settings.calm;          // "Calm effects": no strobing or shaking (for anyone sensitive to flashing)
document.querySelectorAll('#qSeg button').forEach(b => b.onclick = () => { settings.quality = b.dataset.q; applySettings(); saveSettings(); });
// the menu's "How to play" and "Settings" panels
function openPanel(name) {
  document.querySelectorAll('#panel section').forEach(sec => sec.classList.toggle('hidden', sec.dataset.panel !== name));
  show('panel', true); $('panelBack').focus();
}
const closePanel = () => { show('panel', false); stopTest(); };
document.querySelectorAll('nav [data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
$('panelBack').onclick = closePanel;
$('panel').addEventListener('click', e => { if (e.target.id === 'panel') closePanel(); });
let titleHover = false;   // hovering "Enter the house": she notices
['pointerenter', 'focus'].forEach(ev => $('play').addEventListener(ev, () => { titleHover = true; }));
['pointerleave', 'blur'].forEach(ev => $('play').addEventListener(ev, () => { titleHover = false; }));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- content ---------- */
const FLOORS = [
  { name: 'The Nursery', cw: 7, ch: 11,
    text: "You wake up in a nursery that isn't yours. The door is locked. Someone has left puzzle boxes on the walls.",
    style: 'wood', floorA: '#3b2722', wallTop: '#1c1118', face: '#6a3d54', pattern: '#7f4b66', dot: '#d3a9bd', base: '#2a1820', frames: 0.12 },
  { name: 'The Doll Hallway', cw: 8, ch: 13,
    text: 'The stairs only go down. Porcelain faces line the walls. Some of them turn to watch you.',
    style: 'tile', floorA: '#22333a', floorB: '#0f181b', grout: '#070b0c', wallTop: '#0d171b', face: '#244650', pattern: '#2f5a67', base: '#0e1e23', frames: 0.4 },
  { name: 'The Basement', cw: 9, ch: 15,
    text: "It's wet down here. The humming is louder. This is where she was left.",
    style: 'concrete', floorA: '#2c2a25', wallTop: '#151410', face: '#4d3b2e', mortar: '#241d17', base: '#1b1611', frames: 0.05 },
  // (floor: which floor painting, and which footsteps; walls: which wall painting; style: how js/house.js dresses it)
  { name: 'The Attic', cw: 9, ch: 15,
    text: "The basement door didn't lead outside. It led up. Everything up here is covered in sheets, and something under them is breathing.",
    style: 'attic', floor: 'wood', walls: 'attic', floorA: '#3a2c20', wallTop: '#140f0b', face: '#4a3726', pattern: '#3a2a1c', base: '#1f160f', frames: 0.06 },
  { name: 'The Workshop', cw: 10, ch: 16,
    text: 'This is where she was made. Shelves of glass eyes watch you work. The front door is on the other side.',
    style: 'workshop', floor: 'tile', walls: 'workshop', floorA: '#4a4640', floorB: '#191816', grout: '#0c0b0a', wallTop: '#12140f', face: '#4e5647', pattern: '#3c4236', base: '#15130f', frames: 0.2 },
];
// difficulty: single player picks it with the floor; together, the lobby owner picks it for everyone.
// speed/hear: her speed and hearing; sight: how far she sees (units); hunt: seconds added to the time between her screams;
// spawn: seconds before she wakes; check: the chance she opens a wardrobe she stops at; phone: its cooldown;
// down: seconds to revive a teammate. (How many puzzles, and how hard they are: js/puzzles.js)
const DIFFS = {
  easy:   { name: 'Easy', speed: 0.85, hear: 0.75, sight: 300, hunt: 18, spawn: 5, check: 0.12, phone: 35, down: 65,
            text: 'She is slower and hears less. One puzzle less, and smaller, easier ones. The phone recharges faster.' },
  medium: { name: 'Medium', speed: 1, hear: 1, sight: 360, hunt: 0, spawn: 0, check: 0.3, phone: 45, down: 50,
            text: 'The house as it was meant to be played.' },
  hard:   { name: 'Hard', speed: 1.1, hear: 1.3, sight: 430, hunt: -10, spawn: -1, check: 0.5, phone: 60, down: 40,
            text: 'She is faster (you can still outrun her), hears and sees further, and opens wardrobes more often. Bigger, harder puzzles.' },
};
let curDiff = 'medium';                                   // (the difficulty of the floor being played)
const DF = () => DIFFS[curDiff] || DIFFS.medium;
// progress (kept on this device): the floors you've escaped, and your best time on each. A floor opens once the one before it is escaped.
const progress = { done: [], best: [] };
try { Object.assign(progress, JSON.parse(localStorage.getItem('bb_progress') || '{}')); } catch (e) {}
const saveProgress = () => { try { localStorage.setItem('bb_progress', JSON.stringify(progress)); } catch (e) {} };
const unlocked = i => i === 0 || !!progress.done[i - 1];
function floorDone(i, secs) {
  progress.done[i] = true;
  if (secs > 1 && (!progress.best[i] || secs < progress.best[i])) progress.best[i] = Math.round(secs);
  saveProgress();
}
// what a floor looks and sounds like underfoot, and what its walls are painted with
const floorKind = F => F.floor || F.style, wallKind = F => F.walls || F.style;
const NOTES = [
  "Day 3.\nThe house keeps getting longer. I hear a music box behind the walls.\nMom says we don't own a music box.",
  "Don't run unless you have to.\nShe hears running.\nShe hears EVERYTHING.",
  "If the melody gets close, get in a wardrobe.\nShe doesn't look inside...\nunless she SAW you go in.",
  "Her eyes glow in the dark.\nIf you can see them,\nshe can see you.",
  "Solve every puzzle box and the door unlocks.\nBut the lock is loud. It wakes her up.\nBe ready to move.",
  "I can see the door.\nI can hear her humming right behind m",
  "The attic ladder was already down.\nSomeone wanted me up here.\nThe sheets move when I'm not looking.",
  "Wardrobes won't save you forever.\nIf she lost you close by,\nshe checks every one of them.",
  "Workshop ledger, 1961.\nOrder 12: one porcelain doll, blue glass eyes.\nNever collected.",
  "She only wants someone to stay.\nThe front door is past the workbenches.\nDon't look at the shelves.",
];
const DECAL_WORDS = ['RUN', 'HIDE', 'SHE SEES', 'BLUE', "DON'T", 'LA LA LA', 'NO WAY OUT'];
const MELODY = [659, 784, 988, 880, 784, 659, 740, 622, 659, 0, 523, 494, 523, 587, 659, 0];

/* ---------- maze ---------- */
let grid, GW, GH, CELLS = [];
const idx = (x, y) => y * GW + x;
const isWall = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || grid[y][x] === 1;
const wallAt = (x, y) => isWall(Math.floor(x / T), Math.floor(y / T));
const blocked = (x, y, r) => wallAt(x - r, y - r) || wallAt(x + r, y - r) || wallAt(x - r, y + r) || wallAt(x + r, y + r);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function genMaze(cw, ch) {
  GW = cw * 2 + 1; GH = ch * 2 + 1;
  grid = Array.from({ length: GH }, () => new Uint8Array(GW).fill(1));
  const vis = new Set(['0,0']), stack = [[0, 0]];
  grid[1][1] = 0;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nb = DIRS.map(([dx, dy]) => [cx + dx, cy + dy])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < cw && y < ch && !vis.has(x + ',' + y));
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny] = nb[Math.random() * nb.length | 0];
    vis.add(nx + ',' + ny);
    grid[cy + ny + 1][cx + nx + 1] = 0;
    grid[ny * 2 + 1][nx * 2 + 1] = 0;
    stack.push([nx, ny]);
  }
  // knock out some walls so there are loops to escape through
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    if (grid[y][x] !== 1) continue;
    const h = !grid[y][x-1] && !grid[y][x+1] && grid[y-1][x] && grid[y+1][x];
    const v = !grid[y-1][x] && !grid[y+1][x] && grid[y][x-1] && grid[y][x+1];
    if ((h || v) && Math.random() < 0.11) grid[y][x] = 0;
  }
  CELLS = [];
  for (let y = 1; y < GH; y += 2) for (let x = 1; x < GW; x += 2) CELLS.push([x, y]);
}
function bfsDist(sx, sy) {
  const d = new Int16Array(GW * GH).fill(-1), q = [[sx, sy]]; d[idx(sx, sy)] = 0;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy;
      if (!isWall(nx, ny) && d[idx(nx, ny)] < 0) { d[idx(nx, ny)] = d[idx(x, y)] + 1; q.push([nx, ny]); } }
  }
  return d;
}
function bfsPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const prev = new Int32Array(GW * GH).fill(-1), q = [[sx, sy]]; prev[idx(sx, sy)] = idx(sx, sy);
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    if (x === tx && y === ty) break;
    for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy;
      if (!isWall(nx, ny) && prev[idx(nx, ny)] < 0) { prev[idx(nx, ny)] = idx(x, y); q.push([nx, ny]); } }
  }
  if (isWall(tx, ty) || prev[idx(tx, ty)] < 0) return null;
  const path = []; let c = idx(tx, ty);
  while (c !== idx(sx, sy)) { path.push([c % GW, (c / GW) | 0]); c = prev[c]; }
  return path.reverse();
}
const wallCount = (x, y) => DIRS.reduce((n, [dx, dy]) => n + (isWall(x + dx, y + dy) ? 1 : 0), 0);
const center = c => ({ x: c[0] * T + T / 2, y: c[1] * T + T / 2 });
function los(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, n = Math.ceil(Math.hypot(dx, dy) / 8);
  for (let i = 1; i < n; i++) if (wallAt(ax + dx * i / n, ay + dy * i / n)) return false;
  return true;
}
function moveEntity(e, dx, dy, r) {
  if (!blocked(e.x + dx, e.y, r)) e.x += dx;
  if (!blocked(e.x, e.y + dy, r)) e.y += dy;
}
