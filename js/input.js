/* Escape from Barbi Blue: Input (touch, mouse, keyboard) and the screens (title, pause, death, win).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- input ---------- */
const input = { x: 0, y: 0, sprint: false };
const keys = {};
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const look = { id: null, x: 0, y: 0 };
const LOOK_SENS = 0.0065, MOUSE_SENS = 0.0024;
// Desktop: the cursor is locked to the game (like any first-person game) and the mouse turns the camera.
// Esc frees the cursor and pauses. Any menu or screen frees it too.
const canLock = matchMedia('(pointer: fine)').matches && 'requestPointerLock' in cvs;
if (matchMedia('(pointer: fine)').matches) document.body.classList.add('pc');   // show the keys next to the buttons
const locked = () => document.pointerLockElement === cvs;
function lockMouse() {
  if (!canLock || locked()) return;
  try { const r = cvs.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
}
// Pointer lock sometimes reports one huge, fake mouse movement: right after the lock starts (or comes back), and now and
// then at random in some browsers. That's the view "jumping" by itself. Skip the first moves after locking, and impossible jumps.
let lockSkip = 0;
document.addEventListener('pointerlockchange', () => { lockSkip = 3; if (!locked() && state === 'play' && !pzOpen) pause(); });
// turn the view. Inside a wardrobe you can still look around, but only through the doors
function lookBy(dx, dy) {
  const p = player; if (state !== 'play') return;
  if (settings.invert) dy = -dy;
  if (p.hidden) { p.hideYaw = clamp(p.hideYaw + dx, -0.7, 0.7); p.hidePitch = clamp(p.hidePitch - dy, -0.4, 0.4); }
  else { p.ang += dx; p.pitch = clamp(p.pitch - dy, -1.1, 1.1); }
}
document.addEventListener('mousemove', e => {
  if (!locked()) return;
  if (lockSkip > 0) { lockSkip--; return; }
  const dx = e.movementX || 0, dy = e.movementY || 0;
  if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;   // (no hand moves a mouse that far between two events)
  lookBy(dx * MOUSE_SENS * settings.sens, dy * MOUSE_SENS * settings.sens);
});
// left side of the screen: a joystick to walk; right side (or a mouse drag, if the cursor isn't locked): look around
cvs.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  if (MP.on && player.dead) { MP.spec++; return; }       // out of the game: tap to watch another teammate (js/team.js: WARN them)
  if (e.pointerType === 'mouse' && canLock) { lockMouse(); return; }
  if (e.pointerType === 'mouse' || e.clientX > W * 0.45) {
    if (look.id === null) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; }
  } else if (joy.id === null) { joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0; }
});
addEventListener('pointermove', e => {
  if (e.pointerId === look.id) {
    const dx = e.clientX - look.x, dy = e.clientY - look.y; look.x = e.clientX; look.y = e.clientY;
    lookBy(dx * LOOK_SENS * settings.sens, dy * LOOK_SENS * settings.sens);
    return;
  }
  if (e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const d = Math.hypot(dx, dy), R = 55;
  if (d > R) { dx = dx / d * R; dy = dy / d * R; }
  joy.x = dx / R; joy.y = dy / R;
});
const endJoy = e => { if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; } if (e.pointerId === look.id) look.id = null; };
addEventListener('pointerup', endJoy); addEventListener('pointercancel', endJoy);

const runBtn = $('run');
const setSprint = v => { input.sprint = v; runBtn.classList.toggle('on', v); };
runBtn.addEventListener('pointerdown', e => { e.preventDefault(); setSprint(true); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => runBtn.addEventListener(ev, () => setSprint(false)));
$('hide').addEventListener('pointerdown', e => { e.preventDefault(); toggleHide(); });
$('phone').addEventListener('pointerdown', e => { e.preventDefault(); usePhone(); });
$('revive').addEventListener('pointerdown', e => { e.preventDefault(); reviveHeld = true; });
// in a wardrobe: hold BREATH (js/stealth.js)
$('breath').addEventListener('pointerdown', e => { e.preventDefault(); breathHeld = true; });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('breath').addEventListener(ev, () => { breathHeld = false; }));
// playing together: ping, emotes, and (out of the game) warning the others (js/team.js)
$('pingBtn').addEventListener('pointerdown', e => { e.preventDefault(); doPing(); });
$('warnBtn').addEventListener('pointerdown', e => { e.preventDefault(); warnTeam(); });
$('emoteBtn').addEventListener('pointerdown', e => { e.preventDefault(); showEmoteBar($('emoteBar').classList.contains('hidden')); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('revive').addEventListener(ev, () => { reviveHeld = false; }));

// the phone: one text a minute. If she's chasing you, she drops everything and leaves for 15 seconds.
function usePhone() {
  if (state !== 'play' || phoneCool > 0 || player.down || player.dead || MP.menu || pzOpen) return;
  if (MP.on) {                                      // together: the host decides if she leaves; the phone recharges slower
    phoneCool = DF().phone + 5; updatePhoneBtn(); sfx.buzz(); $('popRes').textContent = ''; $('pop').classList.add('on'); popT = 3.5; toHost({ t: 'phone' }); return;
  }
  phoneCool = DF().phone; updatePhoneBtn(); sfx.buzz();
  const m = monster, chasing = m.active && (m.state === 'chase' || m.state === 'hunt');
  $('popRes').textContent = '';
  $('pop').classList.add('on'); popT = 3.5;
  setTimeout(() => { if (state !== 'play') return;
    if (chasing && monster === m && m.active) {
      m.active = false; m.spawnT = 15; m.relocate = true; m.state = 'wander'; m.path = []; m.huntT = 0; m.knowsCloset = false;
      $('popRes').textContent = 'Seen ✓✓ ... she stopped and walked away.'; unlock('phone');
      showMsg('The music box goes quiet. She left. You have 15 seconds.', 3); sfx.sting();
    } else $('popRes').textContent = 'Delivered';
  }, 900);
}

addEventListener('keydown', e => { keys[e.code] = true;
  if (e.code === 'F3') { e.preventDefault(); setPerf(!settings.perf); return; }          // the performance overlay (js/extras.js)
  if (e.code === 'Space' && state === 'play') e.preventDefault();                        // (Space holds your breath: it mustn't press a button)
  if (!e.repeat && (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') && !$('note').classList.contains('hidden')) { closeNote(); return; }
  if (state === 'title') {
    if (e.code === 'Escape' && !$('panel').classList.contains('hidden')) closePanel();
    else if (e.code === 'Enter' && $('panel').classList.contains('hidden') && !$('play').disabled && document.activeElement.tagName !== 'BUTTON' && document.activeElement.tagName !== 'A') $('play').click();
  }
  if (e.code === 'KeyE' && !e.repeat && !reviveTarget) toggleHide();   // next to a downed teammate, E revives instead
  if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) usePhone();
  if (MP.on && state === 'play' && !e.repeat) {                                          // playing together (js/team.js)
    const n = /^(Digit|Numpad)([2-7])$/.exec(e.code);
    if (n) doEmote(+n[2] - 2);
    if (e.code === 'KeyQ') doPing();
    if (e.code === 'KeyG' && player.dead) warnTeam();
    if (player.dead && (e.code === 'ArrowLeft' || e.code === 'KeyA')) MP.spec--;       // out of the game: watch someone else
    if (player.dead && (e.code === 'ArrowRight' || e.code === 'KeyD')) MP.spec++;
  }
  if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'play') pause(); });
addEventListener('keyup', e => { keys[e.code] = false; });
function readInput() {
  let kx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let ky = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  if (kx || ky) { const d = Math.hypot(kx, ky); input.x = kx / d; input.y = ky / d; }
  else { input.x = joy.x; input.y = joy.y; }
  input.sprintKey = !!(keys.ShiftLeft || keys.ShiftRight);
  input.turn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
}

// one person per wardrobe: if a teammate is already inside, it's locked
function closetTaken(c) {
  if (!MP.on) return false;
  const k = closets.indexOf(c);
  return [...MP.others.values()].some(o => o.hidden && o.closet === k);
}
let lockedT = 0;
function lockedOut() {
  if (performance.now() - lockedT < 700) return; lockedT = performance.now();
  sfx.rattle(); showMsg("It's locked from the inside. Someone is already hiding in there.", 2.2);
}
function toggleHide() {
  if (state !== 'play' || player.down || player.dead || MP.menu) return;
  const p = player;
  if (p.hidden) { if (!(closetScene && closetScene.t > 0)) exitHide(); return; }
  if (puzzleTarget !== null && !hideTarget) { openPuzzle(puzzleTarget); return; }   // (the button says USE next to a puzzle)
  if (!hideTarget) return;
  if (closetTaken(hideTarget)) { lockedOut(); return; }
  p.hidden = true; p.closet = hideTarget; p.x = hideTarget.x; p.y = hideTarget.y; hideCool = 0.5; p.hideYaw = p.hidePitch = 0; fstat.hid = true;
  sfx.creak(0.12);
  const m = monster, d = Math.hypot(m.x - p.x, m.y - p.y);
  if (MP.on) { if (MP.host) onPlayerHid(MP.myId, p.x, p.y); }        // (the wardrobe scene is single player only)
  else if (m.active && m.state === 'chase' && m.seenT < 0.8 && d < 230) { m.knowsCloset = true; m.kcWhy = ''; }
  else if (m.active && sceneCool <= 0) closetScene = { t: -1.4, spoke: false };
  $('hide').textContent = 'LEAVE';
}
function exitHide() { closetScene = null; const p = player, c = p.closet;
  if (c) { p.x = c.x + c.ox * (CLOSET_FRONT + 14); p.y = c.y + c.oy * (CLOSET_FRONT + 14); p.ang = Math.atan2(c.oy, c.ox); p.pitch = 0; }   // step out in front of the doors
  p.hidden = false; p.closet = null; p.holding = false; breathHeld = false; hideCool = 0.3; sfx.creak(0.1); $('hide').textContent = 'HIDE'; breathShown = false; }

/* ---------- screens ---------- */
function toTitle() {
  stopSong(); state = 'title'; setHud(false); show('downMsg', false); show('revive', false);
  ['dead', 'win', 'trans', 'paused', 'note', 'lobby'].forEach(s => show(s, false)); show('title', true); loadBest(); updateRejoinBtn();
  // (screens reused by multiplayer get their single player words back)
  $('dTitle').textContent = 'SHE GOT YOU'; $('retry').textContent = 'Try again'; $('menu1').textContent = 'Main menu';
  $('again').textContent = 'Play again'; show('winLeave', false); show('tGo', true); $('pText').textContent = 'She is waiting.';
}
function loadBest() { try { const b = localStorage.getItem('bb_best'); $('best').textContent = b ? 'Best escape: ' + fmtTime(+b) : ''; } catch (e) {} }
const fmtTime = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
// "Enter the house" opens the floor list (with the difficulty); a floor starts from there
$('play').onclick = () => { unlockAudio(); renderLevels(); openPanel('levels'); };
function playFloor(i) {
  if (!unlocked(i)) return;
  closePanel(); primeVoice(); show('title', false); runTime = 0; runFrom = i; startFloor(i); lockMouse();
}
function renderLevels() {
  document.querySelectorAll('#diffSeg button').forEach(b => b.classList.toggle('on', b.dataset.d === settings.difficulty));
  $('diffHint').textContent = (DIFFS[settings.difficulty] || DIFFS.medium).text;
  const ul = $('lvList'); ul.textContent = '';
  FLOORS.forEach((F, i) => {
    const open = unlocked(i), done = !!progress.done[i], li = document.createElement('li'), b = document.createElement('button');
    b.className = 'lv' + (open ? '' : ' locked') + (done ? ' done' : ''); b.dataset.lv = i; b.disabled = !open;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
    const t = document.createElement('span'); t.className = 't';
    const nm = document.createElement('b'); nm.textContent = F.name;
    const sub = document.createElement('small');
    const found = NOTE_POOL[i].filter((_, k) => progress.notes.includes(i + '-' + k)).length;
    sub.textContent = (!open ? 'Locked · escape ' + FLOORS[i - 1].name + ' first' : done ? 'Escaped' + (progress.best[i] ? ' · best ' + fmtTime(progress.best[i]) : '') : i === 0 ? 'Start here' : 'Not escaped yet') +
      (open ? ' · 📜 ' + found + '/' + NOTE_POOL[i].length : '');
    t.append(nm, sub);
    const st = document.createElement('span'); st.className = 's'; st.textContent = !open ? '🔒' : done ? '✓' : '▶';
    b.append(n, t, st); b.onclick = () => playFloor(i);
    li.appendChild(b); ul.appendChild(li);
  });
  $('lvNotes').textContent = 'Torn notes found: ' + progress.notes.length + ' of ' + NOTES_TOTAL;
}
document.querySelectorAll('#diffSeg button').forEach(b => b.onclick = () => { settings.difficulty = b.dataset.d; saveSettings(); renderLevels(); });
$('retry').onclick = () => { unlockAudio(); stopSong(); show('dead', false); if (MP.on) { showLobby(); return; } startFloor(floorIdx); lockMouse(); };
$('menu1').onclick = () => { if (MP.on) leaveMP(); toTitle(); };
$('menu2').onclick = () => { if (ac) ac.resume(); if (MP.on) leaveMP(); toTitle(); };
$('winLeave').onclick = () => { leaveMP(); toTitle(); };
$('tGo').onclick = () => { unlockAudio(); show('trans', false); startFloor(floorIdx + 1); lockMouse(); };
$('again').onclick = () => { show('win', false); if (MP.on) { showLobby(); return; } toTitle(); };
$('pause').onclick = pause;
$('resume').onclick = () => { show('paused', false); unlockAudio(); if (MP.on) MP.menu = false; else state = 'play'; lockMouse(); };
// a torn note: click anywhere, tap, or press E / Space / Enter to carry on. On a computer the mouse stays captured the whole time
// (it used to be released too late, or in multiplayer not at all, so there was no cursor to click the note with)
let noteAt = 0;
function openNote(text, count) {
  if (MP.on) MP.menu = true; else state = 'note';                   // (in multiplayer the game keeps going while you read)
  $('paper').innerHTML = '<b>A TORN NOTE</b>'; $('paper').appendChild(document.createTextNode(text));
  if (count) { const c = document.createElement('small'); c.className = 'count'; c.textContent = count; $('paper').appendChild(c); }
  show('note', true); noteAt = performance.now();
}
function closeNote() {
  if ($('note').classList.contains('hidden') || performance.now() - noteAt < 350) return false;   // (not the click you were already making)
  show('note', false); if (MP.on) MP.menu = false; else state = 'play'; lockMouse(); return true;
}
$('note').onclick = closeNote;
document.addEventListener('mousedown', () => { if (locked()) closeNote(); });   // (with the mouse captured, clicks go to the game, not the note)
function pause() {
  if (state !== 'play') return;
  setSprint(false);
  if (locked()) document.exitPointerLock();          // (the menu needs a cursor: in multiplayer the game doesn't stop to release it)
  // together the game can't stop for one player: the menu opens over the running game
  if (MP.on) { MP.menu = true; $('pText').textContent = 'The game keeps going for everyone while this is open.'; show('paused', true); return; }
  state = 'paused'; show('paused', true); if (ac) ac.suspend();
}
document.addEventListener('visibilitychange', () => { if (document.hidden && !MP.on) pause(); });

function die(reason) {
  closePuzzle();
  if (songOn && songBuf && ac) { playSongNode(); setSongLevel(1, true); } else stopSong();   // she caught you: her song, full volume
  closetScene = null;
  $('pop').classList.remove('on');
  prepDeath(); $('msg').style.opacity = 0; msgTimer = 0;
  state = 'dead'; deadT = 0; deathReason = reason; setHud(false); setSprint(false);
  joy.id = null; joy.x = joy.y = 0; look.id = null;
  if (songOn) sfx.sting(); else { sfx.scream(1); sfx.sting(); }
  if (navigator.vibrate) navigator.vibrate([300, 80, 500]);
}
function nextFloor() {
  stopSong();
  $('pop').classList.remove('on');
  floorDone(floorIdx, levelTime); floorAchievements(floorIdx, levelTime);   // (opens the next floor in the menu; js/extras.js)
  if (floorIdx >= FLOORS.length - 1) {
    state = 'win'; setHud(false);
    $('wTime').textContent = 'Time: ' + fmtTime(runTime);
    // (the best escape only counts for a run from the first floor)
    if (runFrom === 0) try { const b = +localStorage.getItem('bb_best'); if (!b || runTime < b) localStorage.setItem('bb_best', runTime); } catch (e) {}
    show('win', true); return;
  }
  state = 'trans'; setHud(false); setSprint(false);
  const F = FLOORS[floorIdx + 1];
  $('tNum').textContent = 'Floor ' + (floorIdx + 2); $('tName').textContent = F.name; $('tText').textContent = F.text;
  show('trans', true);
}
