/* Escape from Barbi Blue: Game state, and generating and starting a floor (the same floor data is sent to everyone in multiplayer).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- game state ---------- */
let state = 'title', floorIdx = 0, fuses = [], notes = [], closets = [], decals = [], exit = null;
let player, monster, fusesGot = 0, powerOn = false, runTime = 0, huntTimer = 0, creakTimer = 5;
let phoneCool = 0, popT = 0, closetScene = null, sceneCool = 0, levelTime = 0, runFrom = 0, lastFuseAt = 0;
let shake = 0, deadT = 0, flicker = 1, flickTarget = 1, flickT = 0, hbTimer = 0, stepTimer = 0;
let musicTimer = 0, musicI = 0, hideTarget = null, hideCool = 0, breathShown = false, deathReason = '';
let titleEyes = null, titleT = 0, reviveTarget = null, revP = 0, lastDt = 0.016, reviveHeld = false;

// A floor is made in two steps, so that in multiplayer the host can make it once and send the same house to everyone:
// generateFloor builds the maze and places everything (n = number of players), applyFloor sets the game up from that data.
// the time between her screams: shorter on later floors and with more players, never under 22 s
const huntTime = (i, n, D) => Math.max(22, rnd(45, 65) - i * 6 - (n - 1) * 2 + D.hunt);
function generateFloor(i, n, diff) {
  const F = FLOORS[i], D = DIFFS[diff] || DIFFS.medium;
  genMaze(F.cw, F.ch);
  if (n > 1) for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) grid[y][x] = 0;   // a room for everyone to start in
  const dist = bfsDist(1, 1);
  const far = CELLS.reduce((a, c) => dist[idx(c[0], c[1])] > dist[idx(a[0], a[1])] ? c : a, [1, 1]);
  const maxD = dist[idx(far[0], far[1])];
  const used = new Set(['1,1', '1,3', '3,1', '3,3', far.join(',')]);

  const dead = shuffle(CELLS.filter(c => !used.has(c.join(',')) && wallCount(c[0], c[1]) === 3));
  const closetsD = dead.slice(0, 4 + i * 2 + (n - 1)).map(c => { used.add(c.join(','));
    const [ox, oy] = DIRS.find(([dx, dy]) => !isWall(c[0] + dx, c[1] + dy)); return [c[0], c[1], ox, oy]; });

  const cand = CELLS.filter(c => !used.has(c.join(',')) && dist[idx(c[0], c[1])] > maxD * 0.2);
  const fusesD = [];
  const nFuses = Math.max(2, F.fuses + (n - 1) + D.fuses);
  for (let k = 0; k < nFuses; k++) {                    // together: one more fuse per extra player (and by difficulty)
    let best = null, bs = -1;
    for (let j = 0; j < 50; j++) {
      const c = cand[Math.random() * cand.length | 0]; if (!c || used.has(c.join(','))) continue;
      let sc = Math.hypot(c[0] - 1, c[1] - 1) * 0.7;
      for (const f of fusesD) sc = Math.min(sc, Math.hypot(c[0] - f[0], c[1] - f[1]));
      sc += Math.random(); if (sc > bs) { bs = sc; best = c; }
    }
    if (best) { used.add(best.join(',')); fusesD.push([best[0], best[1]]); }
  }
  const nc = shuffle(CELLS.filter(c => !used.has(c.join(',')) && dist[idx(c[0], c[1])] > 2));
  const notesD = nc.slice(0, 2).map(c => { used.add(c.join(',')); return [c[0], c[1], +rnd(-0.6, 0.6).toFixed(2)]; });

  const decalsD = [];
  CELLS.forEach(c => { if (Math.random() > 0.35) return;
    const r = Math.random(), p = center(c);
    decalsD.push({ x: p.x + rnd(-10, 10), y: p.y + rnd(-10, 10), rot: rnd(0, 6.28),
      type: r < 0.45 ? 'stain' : r < 0.8 ? 'petal' : 'word', s: rnd(5, 12),
      text: DECAL_WORDS[Math.random() * DECAL_WORDS.length | 0] }); });

  const openDir = DIRS.find(([dx, dy]) => !isWall((n > 1 ? 3 : 1) + dx, (n > 1 ? 2 : 1) + dy)) || DIRS.find(([dx, dy]) => !isWall(1 + dx, 1 + dy)) || [1, 0];
  const a0 = Math.atan2(openDir[1], openDir[0]);
  // spawn points: one tile in single player; in multiplayer four spots in the middle of the start room, apart enough not to overlap
  const spawns = n > 1 ? [[-13, -13], [13, 13], [13, -13], [-13, 13]].map(([ox, oy]) => [T * 2.5 + ox, T * 2.5 + oy]) : [[T * 1.5, T * 1.5]];
  const mc = CELLS.filter(c => dist[idx(c[0], c[1])] > maxD * 0.55 && !(c[0] === far[0] && c[1] === far[1]));
  const m0 = mc.length ? mc[Math.random() * mc.length | 0] : far;
  return { i, n, rows: grid.map(r => Array.from(r).join('')), exit: far, closets: closetsD, fuses: fusesD, notes: notesD, decals: decalsD,
    spawns, a0, m0, hunt: huntTime(i, n, D), diff: DIFFS[diff] ? diff : 'medium' };
}
function applyFloor(d, slot) {
  floorIdx = d.i; const F = FLOORS[d.i]; curDiff = d.diff || 'medium'; levelTime = 0; lastFuseAt = 0;
  grid = d.rows.map(r => Uint8Array.from(r, ch => ch === '1' ? 1 : 0)); GH = grid.length; GW = grid[0].length;
  CELLS = []; for (let y = 1; y < GH; y += 2) for (let x = 1; x < GW; x += 2) CELLS.push([x, y]);
  exit = { tx: d.exit[0], ty: d.exit[1], ...center(d.exit) };
  closets = d.closets.map(([tx, ty, ox, oy]) => ({ ...center([tx, ty]), ox, oy }));
  fuses = d.fuses.map(([tx, ty]) => ({ tx, ty, ...center([tx, ty]), got: false }));
  notes = d.notes.map(([tx, ty, rot], k) => ({ ...center([tx, ty]), read: false, text: NOTES[d.i * 2 + k], rot }));
  decals = d.decals;
  const sp = d.spawns[Math.min(slot, d.spawns.length - 1)];
  player = { x: sp[0], y: sp[1], ang: d.a0, pitch: 0, hideYaw: 0, hidePitch: 0, stam: 1, exhausted: false, hidden: false, closet: null,
    moving: false, sprinting: false, down: false, dead: false, downLeft: 0, inv: 0 };
  monster = { ...center(d.m0), ang: 0, state: 'wander', path: [], repath: 0, last: null, seenT: 99,
    searchT: 0, huntT: 0, target: null, knowsCloset: false, kc: null, ti: null, active: false, spawnT: (d.n > 1 ? 6 : 4) + DF().spawn, anim: 0, stepAcc: 0, foot: 1, screamT: 0, vel: 0,
    dir: null, plan: [], checked: new Set(), checking: -1, checkT: 0, listenT: 0, heard: false };
  resetScares(); monster.px = monster.x; monster.py = monster.y; monster.tx = monster.x; monster.ty = monster.y; prints = []; dust = [];

  fusesGot = 0; powerOn = false; huntTimer = d.hunt; hideTarget = null; breathShown = false; phoneCool = 0; updatePhoneBtn(); popT = 0; closetScene = null; sceneCool = 0; $('pop').classList.remove('on');
  shake = 0; deadT = 0; reviveTarget = null; revP = 0;
  $('hFloor').textContent = 'Floor ' + (d.i + 1);
  updateFuseHud();
  setHud(true); show('downMsg', false); show('revive', false);
  state = 'play'; startSong();
  const nf = fuses.length;
  showMsg(d.n > 1 ? (d.i === 0 ? d.n + ' players: she is faster and hears more. Find ' + nf + ' fuses, together.' : F.name + '. Find ' + nf + ' fuses.')
    : d.i === 0 ? 'Find ' + nf + ' fuses to unlock the front door.' : F.name + '. Find ' + nf + ' fuses.', 4);
}
function startFloor(i) { applyFloor(generateFloor(i, 1, settings.difficulty), 0); }
function updateFuseHud() { $('hFuse').textContent = (powerOn ? '🔓 ' : '⚡ ') + fusesGot + '/' + fuses.length; }
function setHud(on) { ['hud', 'stam', 'run', 'phone'].forEach(id => show(id, on)); if (!on) show('hide', false); }

let msgTimer = 0;
function showMsg(t, dur) { const m = $('msg'); m.textContent = t; m.style.opacity = 1; msgTimer = dur || 2.5; }
