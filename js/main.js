/* Escape from Barbi Blue: The main loop and starting everything up. Loaded last.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- loop ---------- */
let last = performance.now(), gameT = 0;
const loopErrors = new Set();
// dynamic resolution: when frames stay slow for a while, draw fewer pixels (down to 60%); when there's room again, more
let frameAvg = 16, slowT = 0, fastT = 0;
function adaptResolution(ms, dt) {
  if (ms > 250) return;                                   // (a hidden tab or a hitch, not a trend)
  frameAvg += (ms - frameAvg) * 0.05;
  if (frameAvg > 26) { slowT += dt; fastT = 0; } else if (frameAvg < 17) { fastT += dt; slowT = 0; } else slowT = fastT = 0;
  if (slowT > 2 && resScale > 0.6) { resScale = Math.max(0.6, resScale * 0.85); slowT = 0; frameAvg = 20; applyQuality(); }
  else if (fastT > 6 && resScale < 1) { resScale = Math.min(1, resScale / 0.85); fastT = 0; applyQuality(); }
}
function frame(now) {
  requestAnimationFrame(frame);        // (first, so one bad frame can never freeze the game)
  const ms = now - last, dt = Math.min(0.05, ms / 1000); last = now; lastDt = dt;
  if (state === 'play' && renderer) adaptResolution(ms, dt);
  if (renderer) renderer.info.reset();                   // (the performance overlay counts this frame's draws: js/extras.js)
  try {
    if (MP.on) mpTick(dt);
    if (state === 'play') { gameT += dt; update(dt); }
    else if (locked() && state !== 'note') document.exitPointerLock();   // (reading a note keeps the mouse: a click carries on)
    if (state === 'play' || state === 'note' || state === 'paused') renderGame(gameT);
    else if (state === 'dead') renderDead(dt);
    else if (state === 'title' || state === 'lobby') renderTitle(dt);
    else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cvs.width, cvs.height); }
    if (state !== 'play' && state !== 'note' && state !== 'paused' && fearFilter) setFearFilter(0);   // (the fear tint only in the game)
    perfFrame(ms);
  } catch (e) {
    // report each different error once (as an uncaught error, so it still shows up in the console and in the tests)
    if (!loopErrors.has(e.message)) { loopErrors.add(e.message); setTimeout(() => { throw e; }); }
  }
}
init3D(); renderer.info.autoReset = false;
addEventListener('resize', resize); resize(); applySettings();
loadBarbi();
loadBest(); updateRejoinBtn();
startAccount();                                          // (sign in, or play as a guest: js/account.js)
requestAnimationFrame(frame);
