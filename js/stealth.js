/* Escape from Barbi Blue: Staying hidden: holding your breath, loose floorboards, and fear.
     breath - in a wardrobe, hold Space (or the BREATH button) and she can't hear you breathing. Hold it too long and you
              gasp for air: if she's close, she hears exactly which wardrobe you're in.
     boards - loose floorboards (dark, cracked, nails sticking up) creak loudly when you step on one, and she hears it from
              rooms away. They lie to one side of the corridor: step around them.
     fear   - rises while she's close (that you know of), chasing you, or something scares you; falls slowly when you're safe.
              The more afraid you are, the more the picture swims, your hands shake (the controls drift), and you hear
              things that aren't there.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

let breathHeld = false, breathSndT = 0, halluT = 12, fearTxt = '', breathTxt = '', lastHid = false, fearFilter = '';
const stealth = { hallu: 0, gasps: 0 };                 // (counts, for the tests)
const BOARD_ACROSS = 10;                                  // how close your feet have to come to a board's middle, across it (along it: its half length + 3)

function updateStealth(dt) {
  updateHolding(dt);
  updateBoards();
  updateFear(dt);
  stealthHud();
}

/* ---------- holding your breath ---------- */
function updateHolding(dt) {
  const p = player, can = p.hidden && !p.down && !p.dead && !MP.menu;
  const want = can && (keyDown('breath') || breathHeld) && !p.gasping;
  if (want) { p.breath = Math.max(0, p.breath - dt / DF().breath); if (p.breath <= 0) gasp(); }
  else p.breath = Math.min(1, p.breath + dt / 3.5);
  if (p.gasping && p.breath > 0.4) p.gasping = false;
  p.holding = want && !p.gasping;
  // your own breathing, quietly, while you're in there and not holding it (and panting after a gasp)
  if (p.hidden && !p.holding) { breathSndT -= dt; if (breathSndT <= 0) { breathSndT = p.gasping ? 1.1 : 3.4; sfx.inhale(p.gasping ? 0.1 : 0.03); } }
  else breathSndT = 0.6;
}
function gasp() {
  const p = player; p.gasping = true; p.holding = false; stealth.gasps++;
  sfx.gasp(); shake = Math.max(shake, 2); addFear(0.1); showMsg('You gasp for air.', 1.8);
  if (MP.on) toHost({ t: 'gasp' }); else heardGasp(allPlayers()[0]);
}
// (single player, or the host) someone gasped in a wardrobe: if she's close enough, she knows exactly which one
function heardGasp(q) {
  const m = monster; if (!m.active || !q || !q.hidden) return;
  if (Math.hypot(m.x - q.x, m.y - q.y) > 330 * DF().hear) return;
  if (MP.on) m.kc = q.id; else m.knowsCloset = true;
  m.kcWhy = 'gasp'; m.state = 'chase'; m.last = { x: q.x, y: q.y }; m.ti = q.id; m.fakeFor = null;
}

/* ---------- loose floorboards ---------- */
function updateBoards() {
  const p = player; if (p.hidden || p.down || p.dead) return;
  for (let k = 0; k < creaks.length; k++) {
    const b = creaks[k], dx = Math.abs(p.x - b.x), dy = Math.abs(p.y - b.y);
    const on = (b.along ? dx : dy) < BOARD_ACROSS && (b.along ? dy : dx) < b.len / 2 + 3;
    if (on && !b.on && !p.crouching) stepOnBoard(k, p.sprinting);   // (crouching: you ease your weight on, it doesn't creak)
    b.on = on;
  }
}
function stepOnBoard(k, run) {
  const b = creaks[k]; sfx.board(b, run ? 1 : 0.75); if (!b.mid) fstat.creaks++;   // (the ones across a corridor can't be avoided: they don't spoil "Light feet")
  if (MP.on) toHost({ t: 'creak', k, r: run ? 1 : 0 }); else boardNoise(b, allPlayers()[0].id, run);
}
const boardNoise = (b, id, run) => makeNoise(b.x, b.y, id, (run ? 650 : 450) * DF().hear);
// a loud noise at (x, y), made by player id: if she's within range, she comes to look (the puzzles' mistakes use this too)
function makeNoise(x, y, id, range) {
  const m = monster; if (!m.active || Math.hypot(m.x - x, m.y - y) > range) return false;
  m.last = { x, y }; m.ti = id; m.fakeFor = null; if (m.state !== 'chase') m.state = 'hunt';
  return true;
}

/* ---------- fear ---------- */
const addFear = v => { if (player) player.fear = clamp(player.fear + v, 0, 1); };
// how strong the fear effects are: nothing below 35%, full at 100%
const fearK = () => player ? clamp((player.fear - 0.35) / 0.65, 0, 1) : 0;
// while she only pretends to be gone, you don't feel her there (that's the trick), unless you can actually see her
function herQuiet() {
  const m = monster, p = player; if (!m.quiet) return 0;
  return Math.hypot(m.x - p.x, m.y - p.y) < 420 && !p.hidden && los(p.x, p.y, m.x, m.y) ? 0 : m.quiet;
}
function updateFear(dt) {
  const p = player, m = monster;
  if (p.dead) { p.fear = Math.max(0, p.fear - dt * 0.2); return; }
  let rise = 0;
  if (m.active) {
    const d = Math.hypot(m.x - p.x, m.y - p.y), sees = d < 450 && !p.hidden && los(p.x, p.y, m.x, m.y);
    rise += clamp(1 - d / 380, 0, 1) * (1 - herQuiet()) * 0.25;
    if (m.state === 'chase' && m.ti === (MP.on ? MP.myId : 'me')) rise += 0.2;
    if (sees) rise += 0.06;
  }
  if (p.down) rise += 0.05;
  if (rise > 0.005) p.fear = Math.min(1, p.fear + rise * dt);
  else p.fear = Math.max(0, p.fear - dt * (p.hidden ? 0.05 : 0.035));
  fstat.fearMax = Math.max(fstat.fearMax, p.fear);
  const k = fearK();                                       // very afraid: things that aren't there
  if (k > 0.25 && !p.down) { halluT -= dt * k; if (halluT <= 0) { halluT = rnd(7, 13); hallucinate(); } }
}
function hallucinate() {
  const p = player, a = p.ang + Math.PI + rnd(-0.7, 0.7), r = rnd(70, 150), x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
  stealth.hallu++;
  switch (Math.random() * 4 | 0) {
    case 0: {                                               // her footsteps, coming closer behind you
      let n = 0; const step = () => { if (state !== 'play' || n > 3) return;
        const k = n / 4; sfx.herStep(x + (p.x - x) * k * 0.5, y + (p.y - y) * k * 0.5, false, n % 2 === 1, 0.8); n++; setTimeout(step, 480); };
      step(); break; }
    case 1: sfx.whisper(0.08, { x, y, h: 1.6 }); break;     // a whisper right behind you
    case 2: [0, 1, 2].forEach(i => setTimeout(() => { if (state === 'play') sfx.note(MELODY[i] * 0.94, 0.08, { x, y, h: 1.9 }); }, i * 420)); break;   // her music box
    default: flickTarget = 0.08; flickT = 0.4;               // the flashlight dies for a moment
  }
}
// the fear effects on the picture: the colour drains away and it gets harsher (not on Low, it costs a little)
function setFearFilter(k) {
  const q = settings.quality === 'low' ? 0 : Math.round(k * 10) / 10, f = q > 0 ? 'saturate(' + (1 - 0.6 * q).toFixed(2) + ') contrast(' + (1 + 0.3 * q).toFixed(2) + ')' : '';
  if (f !== fearFilter) { fearFilter = f; $('gl').style.filter = f; }
}
// the screen: a dark pulse at the edges, in time with your heart
function drawFearFx(t) {
  const k = fearK(); setFearFilter(k); if (k <= 0) return;
  const cw = cvs.width, ch = cvs.height, beat = Math.pow(Math.max(0, Math.sin(t * (4 + 5 * k))), 6);
  const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * (0.42 - 0.12 * k), cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
  g.addColorStop(0, 'rgba(20,0,20,0)'); g.addColorStop(1, 'rgba(20,0,16,' + (0.25 + 0.35 * beat) * k + ')');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
}

/* ---------- the HUD: fear, and your breath while you hide ---------- */
function stealthHud() {
  const p = player, hid = p.hidden && !p.down && !p.dead;
  if (hid !== lastHid) { lastHid = hid; show('breath', hid); show('breathBar', hid); if (!p.down && !p.dead) show('run', !hid); }
  if (hid) { const t = Math.round(p.breath * 100) + (p.holding ? 'h' : p.gasping ? 'g' : '');
    if (t !== breathTxt) { breathTxt = t; const b = $('breathBar'); b.firstChild.style.width = Math.round(p.breath * 100) + '%';
      b.classList.toggle('holding', p.holding); b.classList.toggle('gasp', p.gasping); $('breath').classList.toggle('on', p.holding); } }
  const f = Math.round(p.fear * 50) / 50 + '';
  if (f !== fearTxt) { fearTxt = f; const b = $('fearBar'); b.firstChild.style.width = Math.round(p.fear * 100) + '%';
    b.firstChild.style.background = 'hsl(' + Math.round(40 - 40 * p.fear) + ',' + Math.round(40 + 50 * p.fear) + '%,' + Math.round(75 - 25 * p.fear) + '%)';
    b.classList.toggle('high', p.fear > 0.7); }
}
