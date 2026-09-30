/* Escape from Barbi Blue: The main loop and starting everything up. Loaded last.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- loop ---------- */
let last = performance.now(), gameT = 0;
const loopErrors = new Set();
function frame(now) {
  requestAnimationFrame(frame);        // (first, so one bad frame can never freeze the game)
  const dt = Math.min(0.05, (now - last) / 1000); last = now; lastDt = dt;
  try {
    if (MP.on) mpTick(dt);
    if (state === 'play') { gameT += dt; update(dt); }
    else if (locked()) document.exitPointerLock();
    if (state === 'play' || state === 'note' || state === 'paused') renderGame(gameT);
    else if (state === 'dead') renderDead(dt);
    else if (state === 'title' || state === 'lobby') renderTitle(dt);
    else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cvs.width, cvs.height); }
  } catch (e) {
    // report each different error once (as an uncaught error, so it still shows up in the console and in the tests)
    if (!loopErrors.has(e.message)) { loopErrors.add(e.message); setTimeout(() => { throw e; }); }
  }
}
init3D();
addEventListener('resize', resize); resize(); applySettings();
loadBarbi();
loadBest(); updateRejoinBtn();
requestAnimationFrame(frame);
