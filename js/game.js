/* Escape from Barbi Blue: The game loop: updating the player, the wardrobe scene ("I know you're in there") and the sounds of the house.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- update ---------- */
// the phone button shows its cooldown (only touch the page when the text changes)
let phoneTxt = '', hideTxt = '';
function updatePhoneBtn() {
  const b = $('phone'), t = phoneCool > 0 ? Math.ceil(phoneCool) + 's' : 'PHONE';
  if (t !== phoneTxt) { phoneTxt = t; b.textContent = t; b.disabled = phoneCool > 0; }
}
function update(dt) {
  runTime += dt; levelTime += dt;
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').style.opacity = 0; }
  shake = Math.max(0, shake - dt * 12);
  hideCool -= dt;
  updateDust(dt);
  if (popT > 0) { popT -= dt; if (popT <= 0) $('pop').classList.remove('on'); }
  if (phoneCool > 0) { phoneCool = Math.max(0, phoneCool - dt); updatePhoneBtn(); }
  sceneCool -= dt;
  updatePlayer(dt);
  if (state !== 'play') return;
  updateStealth(dt);                                   // your breath, loose floorboards, fear (js/stealth.js)
  updateExtras(dt);                                    // achievements, pings, the performance overlay (js/extras.js, js/team.js)
  if (closetScene) { updateCloset(dt); updateAudio(dt); animateMonster(dt); return; }
  if (!MP.on || MP.host) updateMonster(dt); else updateMonsterClient(dt);     // (in multiplayer only the host runs her AI)
  if (state !== 'play') return;
  animateMonster(dt);
  updateAudio(dt);
  updateScares(dt);

  // flashlight flicker, worse when she's near
  const d = Math.hypot(monster.x - player.x, monster.y - player.y), near = monster.active && d < 220 && herQuiet() < 0.5;
  flickT -= dt;
  if (flickT <= 0) { flickTarget = Math.random() < (near ? 0.4 : 0.1) ? rnd(0.15, 0.6) : 1; flickT = rnd(0.04, near ? 0.2 : 0.9); }
  flicker += (flickTarget - flicker) * Math.min(1, dt * 25);

  // she screams every so often and knows where you are
  if (monster.active && (!MP.on || MP.host)) { huntTimer -= dt;
    if (huntTimer <= 0) { huntTimer = huntTime(floorIdx, MP.n, DF()); monster.huntT = 6;
      if (MP.on) hostEmit({ t: 'scream' });
      else { startScream(); sfx.scream(clamp(1 - d / 700, 0.2, 0.8)); shake = 7; showMsg('A scream tears through the house. She knows where you are. HIDE.', 3.5); } } }
  creakTimer -= dt; if (creakTimer <= 0) { creakTimer = rnd(7, 18);        // the house creaks, somewhere around you
    const a = rnd(0, 6.28), r = rnd(80, 220); sfx.creak(rnd(0.05, 0.1), { x: player.x + Math.cos(a) * r, y: player.y + Math.sin(a) * r, h: rnd(0.5, WALL_H) }); }

  const st = $('stam'); st.firstChild.style.width = (player.stam * 100) + '%'; st.classList.toggle('tired', player.exhausted);
  if (MP.on) updateDownMsg();
}
// the line of text at the bottom while you're down, being revived, or out
let downMsgText = '';
function updateDownMsg() {
  const p = player; let t = '';
  if (p.dead && MP.scareT <= 0) { const w = watched(), n = [...MP.others.values()].filter(o => !o.down && !o.dead && !o.away).length;
    const doing = w ? (w.hidden ? ' (hiding)' : w.sprinting ? ' (running)' : '') : '';
    t = "You didn't make it<small>" + (w ? 'Watching ' + escapeHtml(w.name) + doing + (n > 1 ? (canLock ? ' · ← → to switch' : ' · tap to switch') : '') +
      ' · ' + (team.warnCool > 0 ? 'warn them again in ' + Math.ceil(team.warnCool) + 's' : (canLock ? 'G' : 'WARN') + ': show them where she is') : 'Nobody is left standing') + '</small>'; }
  else if (p.down && MP.scareT <= 0) { const by = [...MP.others.values()].find(o => o.rv === MP.myId);
    t = (by ? escapeHtml(by.name) + ' is reviving you…' : "You're down · " + Math.ceil(p.downLeft) + 's') + '<small>a teammate can get you back up</small>'; }
  if (t !== downMsgText) { downMsgText = t; $('downMsg').innerHTML = t; show('downMsg', !!t); }
}
const escapeHtml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- "I know you're in there" ---------- */
const CLOSET_LINE = "I know you're in here...";
// the wardrobe scene, in seconds (it starts at -1.4 with her footsteps coming closer):
// she walks up to the doors, one door swings open, she leans in to your face, speaks, glitches away, the door creaks shut
const SC = { open: 0.7, openEnd: 1.4, lean: 1.3, leanEnd: 2.3, speak: 2.2, vanish: 4.8, gone: 5.3, shut: 5.4, end: 6.1 };
const SCENE_LEN = SC.end;
function primeVoice() {
  try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
}
function speakCreepy() {
  try {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(CLOSET_LINE);
    const voices = speechSynthesis.getVoices();
    const v = voices.find(v => /^en/i.test(v.lang) && /female|samantha|karen|moira|tessa|victoria|zira/i.test(v.name)) || voices.find(v => /^en/i.test(v.lang));
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'en-US'; u.pitch = 0.1; u.rate = 0.55; u.volume = 1;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function updateCloset(dt) {
  const sc = closetScene; sc.t += dt;
  if (sc.t < 0) { if (Math.random() < dt * 2.5) sfx.step(false); return; }
  if (!sc.started) { sc.started = true; sfx.sting(); shake = 3; sfx.voiceBed(); if (navigator.vibrate) navigator.vibrate([60, 60, 60]); $('msg').style.opacity = 0; msgTimer = 0; }
  if (!sc.creak && sc.t > SC.open) { sc.creak = true; sfx.creak(0.22); }
  if (!sc.leanSting && sc.t > SC.lean + 0.5) { sc.leanSting = true; sfx.sting(); shake = 4; if (navigator.vibrate) navigator.vibrate(90); }
  if (!sc.spoke && sc.t > SC.speak) { sc.spoke = true; speakCreepy(); }
  if (!sc.gone && sc.t > SC.vanish) { sc.gone = true; sfx.buzz(); }
  if (!sc.shutCreak && sc.t > SC.shut) { sc.shutCreak = true; sfx.creak(0.12); }
  if (sc.t >= SCENE_LEN) {
    closetScene = null; sceneCool = 25;
    const m = monster; m.active = false; m.spawnT = 12; m.relocate = true; m.state = 'wander'; m.path = []; m.huntT = 0;
    sfx.creak(0.1); showMsg('...and then she was gone.', 3);
  }
}

function updatePlayer(dt) {
  const p = player; readInput();
  if (MP.menu || MP.reconnecting || pzOpen) { input.x = input.y = 0; input.sprint = input.sprintKey = false; input.turn = 0; }
  if (p.down || p.dead) {                          // down (or out): you can look around, nothing else
    p.moving = p.sprinting = false; if (input.turn) lookBy(input.turn * 2.4 * dt, 0);
    hideTarget = null; reviveTarget = null; revP = 0; show('hide', false); show('revive', false); show('run', false); show('phone', false);
    return;
  }
  const mag = Math.min(1, Math.hypot(input.x, input.y));
  if (p.hidden) {
    if (mag > 0.6 && hideCool <= 0 && !(closetScene && closetScene.t > 0)) exitHide();
    else { p.moving = p.sprinting = false; p.stam = Math.min(1, p.stam + dt / 4); if (input.turn) lookBy(input.turn * 2.4 * dt, 0); return; }
  }
  p.moving = mag > 0.15;
  const wantSprint = (input.sprint || input.sprintKey) && p.moving && !p.exhausted;
  p.sprinting = wantSprint && p.stam > 0;
  if (p.sprinting) { p.stam -= dt / 3; if (p.stam <= 0) { p.stam = 0; p.exhausted = true; showMsg('You are out of breath...', 1.5); } }
  else { p.stam = Math.min(1, p.stam + dt / 5); if (p.exhausted && p.stam > 0.35) p.exhausted = false; }
  if (input.turn) p.ang += input.turn * 2.4 * dt;
  { const fk = fearK() * (calm() ? 0.5 : 1); if (fk > 0) p.ang += Math.sin(levelTime * 0.6) * 0.3 * fk * fk * dt; }   // (and the view drifts)
  if (p.moving) {
    // joystick up = the way you're looking
    const spd = (p.sprinting ? 170 : p.exhausted ? 80 : 105) * mag, fw = -input.y / mag, st = input.x / mag;
    // very afraid: your hands shake, you don't quite walk where you mean to (js/stealth.js)
    const fk = fearK() * (calm() ? 0.5 : 1), wob = fk * fk * Math.sin(levelTime * 1.7) * 0.35;
    const ca = Math.cos(p.ang + wob), sa = Math.sin(p.ang + wob), mx = ca * fw - sa * st, my = sa * fw + ca * st;
    const dx = mx * spd * dt, dy = my * spd * dt;
    // (a wardrobe only blocks you walking into it: if you're somehow already inside its space, you can always get out)
    const inCloset = closetBlocked(p.x, p.y, 11);
    if (!blocked(p.x + dx, p.y, 11) && (inCloset || !closetBlocked(p.x + dx, p.y, 11)) && !mateBlocked(p.x + dx, p.y)) p.x += dx;
    if (!blocked(p.x, p.y + dy, 11) && (inCloset || !closetBlocked(p.x, p.y + dy, 11)) && !mateBlocked(p.x, p.y + dy)) p.y += dy;
    stepTimer -= dt * spd / (p.sprinting ? 55 : 45); stepPhase += dt * spd * 0.12;
    if (stepTimer <= 0) { stepTimer = 1; sfx.step(p.sprinting); }
  }

  updatePuzzles(dt);                                   // the labyrinth box you're next to, and the ball while one is open (js/puzzles.js)
  for (const n of notes) if (!n.read && Math.hypot(n.x - p.x, n.y - p.y) < 20) {
    n.read = true; setSprint(false); joy.id = null; joy.x = joy.y = 0;
    const had = progress.notes.length, all = noteFound(n.id); updateNoteHud();
    openNote(n.text, all > had ? 'Note ' + all + ' of ' + NOTES_TOTAL + ' found' : 'You have read this one before'); noteAchievements(all); return;
  }
  const de = Math.hypot(exit.x - p.x, exit.y - p.y);
  if (de < 18) {
    if (powerOn) { if (!MP.on) { nextFloor(); return; } if (!MP.exitAsked) { MP.exitAsked = true; toHost({ t: 'exit' }); } }
    else if (msgTimer <= 0) showMsg('The door is locked. Solve ' + (fuses.length - fusesGot === 1 ? 'the last puzzle' : 'the puzzles') + ' first.', 2);
  }
  // a downed teammate close by: hold E (or the REVIVE button) for a few seconds to get them up
  reviveTarget = null;
  if (MP.on && !p.hidden) { let bd = 40;
    for (const o of MP.others.values()) if (o.down && !o.dead) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < bd && los(p.x, p.y, o.x, o.y)) { bd = d; reviveTarget = o; } } }
  const holding = !MP.menu && (keys.KeyE || reviveHeld);
  if (reviveTarget && holding && !p.moving) {
    revP += dt / REVIVE_TIME;
    if (revP >= 1) { toHost({ t: 'revive', id: reviveTarget.id }); revP = 0; }
  } else revP = Math.max(0, revP - dt * 2);
  show('revive', !!reviveTarget);
  hideTarget = null;
  if (!reviveTarget) for (const c of closets) if (Math.hypot(c.x - p.x, c.y - p.y) < 28) hideTarget = c;
  // next to a puzzle (and not a wardrobe): the same button says USE
  show('hide', (!!hideTarget || p.hidden || puzzleTarget !== null) && !reviveTarget);
  const lbl = p.hidden ? 'LEAVE' : puzzleTarget !== null && !hideTarget ? 'USE' : 'HIDE';
  if (lbl !== hideTxt) { hideTxt = lbl; $('hide').textContent = lbl; }
  // teammates overlapping you (it can happen after a revive): ease apart
  if (MP.on) for (const o of MP.others.values()) { if (o.hidden || o.down || o.dead) continue;
    const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy);
    if (d > 0.01 && d < 21) { const push = (22 - d) * Math.min(1, dt * 6), nx = p.x + dx / d * push, ny = p.y + dy / d * push;
      if (!blocked(nx, ny, 11)) { p.x = nx; p.y = ny; } } }
}
