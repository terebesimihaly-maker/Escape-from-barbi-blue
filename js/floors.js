/* Escape from Barbi Blue: Game state, and generating and starting a floor (the same floor data is sent to everyone in multiplayer).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- game state ---------- */
let state = 'title', floorIdx = 0, fuses = [], notes = [], closets = [], decals = [], creaks = [], exit = null;
let player, monster, fusesGot = 0, powerOn = false, runTime = 0, huntTimer = 0, creakTimer = 5;
let phoneCool = 0, popT = 0, closetScene = null, sceneCool = 0, levelTime = 0, runFrom = 0, lastFuseAt = 0;
let shake = 0, deadT = 0, flicker = 1, flickTarget = 1, flickT = 0, hbTimer = 0, stepTimer = 0;
// loose floorboards (js/stealth.js): how long one is (world units); the long ones right across a corridor, and how often a board is one
const BOARD_LEN = 24, BOARD_MID_LEN = 46, BOARD_MID_CHANCE = 0.1;
let musicTimer = 0, musicI = 0, hideTarget = null, hideCool = 0, breathShown = false, deathReason = '';
let titleEyes = null, titleT = 0, reviveTarget = null, revP = 0, lastDt = 0.016, realDt = 0.016, reviveHeld = false;

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

  // the puzzles: boxes on the walls (a different kind on every floor), each in its own cell away from the start (js/puzzles.js)
  const cand = shuffle(CELLS.filter(c => !used.has(c.join(',')) && dist[idx(c[0], c[1])] > Math.max(2, maxD * 0.12)));
  const puzzlesD = makePuzzles(puzzleCount(i, diff), cand, i, diff);
  for (const p of puzzlesD) used.add(p.cell.join(','));
  const fusesD = puzzlesD.map(p => p.cell.slice());       // (the stations: solving one counts as a "fuse")
  const nc = shuffle(CELLS.filter(c => !used.has(c.join(',')) && dist[idx(c[0], c[1])] > 2));
  // torn notes: which three of this floor's four, and where, is different every time
  const pick = shuffle(NOTE_POOL[i].map((_, k) => k)).slice(0, NOTES_PER_FLOOR);
  const notesD = nc.slice(0, pick.length).map((c, j) => { used.add(c.join(',')); return [c[0], c[1], +rnd(-0.6, 0.6).toFixed(2), pick[j]]; });
  // loose floorboards: in the rooms and the corridors between them (never at the start, the door, a wardrobe or a puzzle).
  // About nine in ten lie along one side of their tile, with plenty of room to step around them. Now and then (one board in
  // ten) a long one lies right across the middle of a corridor, from wall to wall: there's no way round that one.
  // A board: [x, y, along (its length runs along y), length]
  const open = [];
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) if (!grid[y][x] && !used.has(x + ',' + y) && (x > 4 || y > 4) && dist[idx(x, y)] > 2) open.push([x, y]);
  const nBoards = Math.round(CELLS.length / 10 * D.creaks) + i, cells = shuffle(open);
  const vertical = (x, y) => isWall(x - 1, y) && isWall(x + 1, y), horizontal = (x, y) => isWall(x, y - 1) && isWall(x, y + 1);
  const corridors = cells.filter(([x, y]) => vertical(x, y) !== horizontal(x, y));   // (walls on two opposite sides only)
  let nMid = 0; for (let k = 0; k < nBoards; k++) if (Math.random() < BOARD_MID_CHANCE) nMid++;
  const midCells = corridors.slice(0, nMid), inMid = new Set(midCells.map(c => c.join()));
  const creaksD = midCells.map(([x, y]) => { const v = vertical(x, y), a = rnd(-8, 8);          // (across: its length runs from wall to wall)
    return [Math.round(x * T + T / 2 + (v ? 0 : a)), Math.round(y * T + T / 2 + (v ? a : 0)), v ? 0 : 1, BOARD_MID_LEN]; })
  .concat(cells.filter(c => !inMid.has(c.join())).slice(0, nBoards - midCells.length).map(([x, y]) => {
    const along = vertical(x, y) ? 1 : horizontal(x, y) ? 0 : Math.random() < 0.5 ? 1 : 0;   // (lengthwise along a corridor)
    const side = (Math.random() < 0.5 ? -1 : 1) * rnd(11, 13);                                 // (right against one side)
    return [Math.round(x * T + T / 2 + (along ? side : rnd(-4, 4))), Math.round(y * T + T / 2 + (along ? rnd(-4, 4) : side)), along, BOARD_LEN]; }));

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
  return { i, n, rows: grid.map(r => Array.from(r).join('')), exit: far, closets: closetsD, fuses: fusesD, puzzles: puzzlesD, notes: notesD, decals: decalsD, creaks: creaksD,
    spawns, a0, m0, hunt: huntTime(i, n, D), diff: DIFFS[diff] ? diff : 'medium' };
}
function applyFloor(d, slot) {
  floorIdx = d.i; const F = FLOORS[d.i]; curDiff = d.diff || 'medium'; levelTime = 0; lastFuseAt = 0;
  grid = d.rows.map(r => Uint8Array.from(r, ch => ch === '1' ? 1 : 0)); GH = grid.length; GW = grid[0].length;
  CELLS = []; for (let y = 1; y < GH; y += 2) for (let x = 1; x < GW; x += 2) CELLS.push([x, y]);
  exit = { tx: d.exit[0], ty: d.exit[1], ...center(d.exit) };
  closets = d.closets.map(([tx, ty, ox, oy]) => ({ ...center([tx, ty]), ox, oy }));
  fuses = d.fuses.map(([tx, ty]) => ({ tx, ty, ...center([tx, ty]), got: false }));
  applyPuzzles(d.puzzles);
  notes = d.notes.map(([tx, ty, rot, k]) => ({ ...center([tx, ty]), read: false, text: NOTE_POOL[d.i][k], id: d.i + '-' + k, rot }));
  creaks = (d.creaks || []).map(([x, y, along, len]) => ({ x, y, along, len: len || BOARD_LEN, mid: len > BOARD_LEN, on: false }));
  decals = d.decals;
  const sp = d.spawns[Math.min(slot, d.spawns.length - 1)];
  player = { x: sp[0], y: sp[1], ang: d.a0, pitch: 0, hideYaw: 0, hidePitch: 0, stam: 1, exhausted: false, hidden: false, closet: null,
    moving: false, sprinting: false, crouching: false, down: false, dead: false, downLeft: 0, inv: 0, breath: 1, holding: false, gasping: false, fear: 0, dance: -1, danceT: 0 };
  monster = { ...center(d.m0), ang: 0, state: 'wander', path: [], repath: 0, last: null, seenT: 99,
    searchT: 0, huntT: 0, target: null, knowsCloset: false, kc: null, ti: null, active: false, spawnT: (d.n > 1 ? 6 : 4) + DF().spawn, anim: 0, stepAcc: 0, foot: 1, screamT: 0, vel: 0,
    dir: null, plan: [], checked: new Set(), checking: -1, checkT: 0, listenT: 0, heard: false, quiet: 0, fakeT: 0, fakeCool: 0, fakeFor: null };
  resetScares(); resetFloorExtras(); monster.px = monster.x; monster.py = monster.y; monster.tx = monster.x; monster.ty = monster.y; prints = []; dust = [];

  fusesGot = 0; powerOn = false; huntTimer = d.hunt; hideTarget = null; breathShown = false; phoneCool = 0; updatePhoneBtn(); popT = 0; closetScene = null; sceneCool = 0; $('pop').classList.remove('on');
  shake = 0; deadT = 0; reviveTarget = null; revP = 0;
  $('hFloor').textContent = 'Floor ' + (d.i + 1);
  updateFuseHud();
  setHud(true); show('downMsg', false); show('revive', false);
  state = 'play'; startSong();
  const nf = fuses.length, what = nf === 1 ? 'the puzzle' : 'the ' + nf + ' puzzles';
  showMsg(d.n > 1 ? (d.i === 0 ? d.n + ' players: she is faster and hears more. Solve ' + what + ' together.' : F.name + '. Solve ' + what + '.')
    : d.i === 0 ? 'Solve ' + what + ' to unlock the front door: the wooden boxes on the walls.' : F.name + '. Solve ' + what + '.', 4);
}
function startFloor(i) { applyFloor(generateFloor(i, 1, settings.difficulty), 0); }
function updateFuseHud() { $('hFuse').innerHTML = ico(powerOn ? 'unlock' : 'puzzle') + ' ' + fusesGot + '/' + fuses.length; }
function setHud(on) { ['hud', 'stam', 'run', 'crouch', 'phone', 'fearBar'].forEach(id => show(id, on));
  if (!on) ['hide', 'breath', 'breathBar', 'pingBtn', 'emoteBtn', 'warnBtn'].forEach(id => show(id, false)); closeWheel(false); lastHid = false; teamBtnState = ''; }

let msgTimer = 0;
function showMsg(t, dur) { const m = $('msg'); m.textContent = t; m.style.opacity = 1; msgTimer = dur || 2.5; }
