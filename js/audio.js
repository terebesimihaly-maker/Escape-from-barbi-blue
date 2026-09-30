/* Escape from Barbi Blue: Sound: every effect is synthesized with the Web Audio API, plus her chase song (audio/chase.mp3 or your own).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- audio (all synthesized) ---------- */
let ac = null, master, noiseBuf;
/* iPhone: while an <audio> element is playing, iOS treats the page as media playback, so the ring/silent
   switch no longer mutes the game. A tiny silent WAV loops for that; audioSession covers newer iOS. */
let unlockEl = null;
function silentWavUrl() {
  const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  try {
    if (!unlockEl) { unlockEl = document.createElement('audio'); unlockEl.src = silentWavUrl(); unlockEl.loop = true;
      unlockEl.setAttribute('playsinline', ''); unlockEl.setAttribute('x-webkit-airplay', 'deny'); }
    if (unlockEl.paused) unlockEl.play().catch(() => {});
  } catch (e) {}
  initAudio();
}
// any tap wakes the sound back up if the phone suspended it (calls, app switching, lock screen)
['pointerdown', 'touchend'].forEach(ev => addEventListener(ev, () => {
  if (state === 'paused') return;
  if (ac && ac.state !== 'running') ac.resume();
  if (unlockEl && unlockEl.paused) unlockEl.play().catch(() => {});
}, true));
function initAudio() {
  if (ac) { if (ac.state !== 'running') ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ac = new AC();
  buildAudioGraph();
}
// the master bus with a limiter, the noise buffer and the low drone of the house
function buildAudioGraph() {
  master = ac.createGain(); master.gain.value = settings.vol;
  const limiter = ac.createDynamicsCompressor(); limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.1; master.connect(limiter); limiter.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const drone = ac.createGain(); drone.gain.value = 0.05; drone.connect(master);
  [44, 44.7, 66.3].forEach(f => { const o = ac.createOscillator(); o.frequency.value = f; o.connect(drone); o.start(); });
  const n = noise(true), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
  const ng = ac.createGain(); ng.gain.value = 0.6; n.connect(lp); lp.connect(ng); ng.connect(drone); n.start();
}
function noise(loop) { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = !!loop; return s; }
function env(g, t, a, peak, dec) {
  peak = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}
function out(node, pan) {
  if (pan !== undefined && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); p.connect(master); }
  else node.connect(master);
}
function distCurve() { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 6); } return c; }
const sfx = {
  thump(v) { if (!ac) return; const t = ac.currentTime;
    [0, 0.17].forEach((o, i) => { const osc = ac.createOscillator(), g = ac.createGain();
      osc.frequency.setValueAtTime(95, t + o); osc.frequency.exponentialRampToValueAtTime(38, t + o + 0.14);
      env(g, t + o, 0.01, v * (i ? 0.6 : 1), 0.16); osc.connect(g); out(g); osc.start(t + o); osc.stop(t + o + 0.35); }); },
  step(run) { if (!ac) return; const t = ac.currentTime, s = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'bandpass'; f.frequency.value = run ? 700 : 500; f.Q.value = 1.2;
    env(g, t, 0.005, run ? 0.14 : 0.05, 0.06); s.connect(f); f.connect(g); out(g); s.start(t); s.stop(t + 0.1); },
  note(freq, v, pan) { if (!ac || v < 0.002) return; const t = ac.currentTime;
    [[1, 'triangle', 1], [2.01, 'sine', 0.35], [3.98, 'sine', 0.12]].forEach(([m, type, k]) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = freq * m;
      env(g, t, 0.004, v * k, 0.9); o.connect(g); out(g, pan); o.start(t); o.stop(t + 1); }); },
  pickup() { if (!ac) return; const t = ac.currentTime;
    [880, 1320, 1760].forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f;
      env(g, t + i * 0.07, 0.005, 0.12, 0.6); o.connect(g); out(g); o.start(t + i * 0.07); o.stop(t + 1); }); },
  sting(v) { if (!ac) return; const t = ac.currentTime, f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(300, t + 1.2);
    env(g, t, 0.01, 0.22 * (v === undefined ? 1 : v), 1.3); f.connect(g); out(g);
    [220, 233, 311, 466].forEach(fr => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 1.5); });
    const n = noise(); n.connect(f); n.start(t); n.stop(t + 0.3); },
  scream(v) { if (!ac) return; const t = ac.currentTime, ws = ac.createWaveShaper(), g = ac.createGain();
    ws.curve = distCurve(); env(g, t, 0.03, 0.45 * v, 1.6); ws.connect(g); out(g);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 27; lg.gain.value = 70; lfo.connect(lg);
    [[900, 'sawtooth'], [1230, 'square']].forEach(([fr, type]) => { const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(fr, t); o.frequency.exponentialRampToValueAtTime(fr * 0.28, t + 1.5);
      lg.connect(o.frequency); const og = ac.createGain(); og.gain.value = 0.3; o.connect(og); og.connect(ws); o.start(t); o.stop(t + 1.8); });
    const n = noise(), bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 1.5); n.connect(bp); bp.connect(ws); n.start(t); n.stop(t + 1.8);
    lfo.start(t); lfo.stop(t + 1.8); },
  buzz() { if (!ac) return; const t = ac.currentTime;
    [0, 0.25].forEach(o => { const osc = ac.createOscillator(), g = ac.createGain(); osc.type = 'square'; osc.frequency.value = 150;
      env(g, t + o, 0.01, 0.07, 0.18); osc.connect(g); out(g); osc.start(t + o); osc.stop(t + o + 0.3); });
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]); },
  voiceBed() { if (!ac) return; const t = ac.currentTime, ws = ac.createWaveShaper(), g = ac.createGain();
    ws.curve = distCurve(); env(g, t + 0.5, 0.3, 0.09, 2.6); ws.connect(g); out(g);
    const trem = ac.createOscillator(), tg = ac.createGain(); trem.frequency.value = 7; tg.gain.value = 0.4; trem.connect(tg); tg.connect(g.gain);
    [[62, 'sawtooth'], [93.5, 'sawtooth']].forEach(([f, type]) => { const o = ac.createOscillator(), bp = ac.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.8, t + 3.2);
      bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 4; o.connect(bp); bp.connect(ws); o.start(t + 0.4); o.stop(t + 3.6); });
    const n = noise(), hp = ac.createBiquadFilter(), ng = ac.createGain(); hp.type = 'highpass'; hp.frequency.value = 3500;
    env(ng, t + 0.5, 0.4, 0.06, 2.5); n.connect(hp); hp.connect(ng); out(ng); n.start(t + 0.4); n.stop(t + 3.6);
    trem.start(t); trem.stop(t + 3.6); },
  rattle() { if (!ac) return; const t = ac.currentTime;          // a locked wardrobe door, shaken
    [0, 0.09, 0.2, 0.28].forEach((o, i) => { const s = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = 'bandpass'; f.frequency.value = 380 + i * 60; f.Q.value = 3; env(g, t + o, 0.004, 0.22, 0.07);
      s.connect(f); f.connect(g); out(g); s.start(t + o); s.stop(t + o + 0.12); });
    const k = ac.createOscillator(), kg = ac.createGain(); k.type = 'square'; k.frequency.value = 1900; env(kg, t + 0.02, 0.002, 0.03, 0.05);
    k.connect(kg); out(kg); k.start(t); k.stop(t + 0.1); },
  // a heavy footstep on the floor above you: a low thud, muffled by the ceiling
  ceilingStep(v, pan) { if (!ac) return; const t = ac.currentTime, lp = ac.createBiquadFilter(), g = ac.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 260; env(g, t, 0.008, v, 0.32); lp.connect(g); out(g, pan);
    const o = ac.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.2); o.connect(lp); o.start(t); o.stop(t + 0.4);
    const n = noise(); n.connect(lp); n.start(t); n.stop(t + 0.12); },
  // something heavy dragged across the floor above
  drag(v, pan) { if (!ac) return; const t = ac.currentTime, bp = ac.createBiquadFilter(), g = ac.createGain(), lp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(180, t); bp.frequency.linearRampToValueAtTime(420, t + 1.6);
    lp.type = 'lowpass'; lp.frequency.value = 900; env(g, t, 0.3, v, 1.5); const n = noise();
    n.connect(bp); bp.connect(lp); lp.connect(g); out(g, pan); n.start(t); n.stop(t + 2); },
  // a breathy whisper right next to you (noise shaped by two moving formants)
  whisper(v, pan) { if (!ac) return; const t = ac.currentTime, g = ac.createGain(); env(g, t, 0.08, v, 0.9); out(g, pan);
    [[700, 1100], [1900, 2600]].forEach(([a, b]) => { const n = noise(), bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
      bp.frequency.setValueAtTime(a, t); bp.frequency.linearRampToValueAtTime(b, t + 0.35); bp.frequency.linearRampToValueAtTime(a * 0.9, t + 0.8);
      n.connect(bp); bp.connect(g); n.start(t); n.stop(t + 1.1); }); },
  creak(v) { if (!ac) return; const t = ac.currentTime, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(rnd(90, 140), t); o.frequency.linearRampToValueAtTime(rnd(50, 80), t + 0.6);
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 12; env(g, t, 0.05, v, 0.6);
    o.connect(f); f.connect(g); out(g); o.start(t); o.stop(t + 0.8); },
};

/* ---------- monster song ---------- */
// Her song is audio/chase.mp3. The player can also pick their own file on the title screen instead.
// Optional: the player can pick an audio/video file from their own device to be her sound instead of the
// music box. The file is decoded in memory, kept only in this browser's storage (IndexedDB), and never
// leaves the device.
let songBuf = null, songNode = null, songBus = null, songOn = false, songBlob = null, songFileName = '', songTesting = false, songCustom = false;
const DEFAULT_SONG = 'audio/chase.mp3', DEFAULT_SONG_NAME = 'Chase song';
function songGraph() { if (!songBus && ac) { songBus = ac.createGain(); songBus.gain.value = 0; songBus.connect(master); } }
function setSongLevel(v, fast) { if (songBus) songBus.gain.setTargetAtTime(v, ac.currentTime, fast ? 0.05 : 0.3); }
function playSongNode() {
  stopSongNode(); songGraph();
  songNode = ac.createBufferSource(); songNode.buffer = songBuf; songNode.loop = true; songNode.connect(songBus); songNode.start();
}
function stopSongNode() { if (songNode) { try { songNode.stop(); } catch (e) {} songNode.disconnect(); songNode = null; } }
function startSong() { stopTest(); if (!songOn || !songBuf || !ac) return; playSongNode(); setSongLevel(0, true); }
function stopSong() { stopTest(); if (songBus) setSongLevel(0, true); stopSongNode(); }
function stopTest() { if (!songTesting) return; songTesting = false; $('songTest').innerHTML = '&#9654; Test'; stopSongNode(); }
$('songTest').onclick = () => {
  unlockAudio(); if (!ac || !songBuf) return;
  if (songTesting) { stopTest(); return; }
  songTesting = true; $('songTest').innerHTML = '&#9632; Stop'; playSongNode(); setSongLevel(0.9, true);
};
function decode(buf) { return new Promise((res, rej) => { const pr = ac.decodeAudioData(buf, res, rej); if (pr && pr.catch) pr.catch(rej); }); }
async function applySong(blob, name, custom) {
  initAudio(); if (!ac) { $('songName').textContent = "This browser can't play audio"; return; }
  stopSong(); songOn = false; songBuf = null; show('songTest', false);
  $('songName').textContent = 'Loading ' + name + '…'; show('songClear', !!custom); songCustom = !!custom;
  try {
    songBuf = await decode(await new Response(blob).arrayBuffer());
    songBlob = blob; songFileName = name; songOn = true;
    const d = Math.round(songBuf.duration);
    $('songName').textContent = '✓ ' + name + ' (' + Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0') + ')';
    show('songTest', true); return true;
  } catch (e) {
    $('songName').textContent = "✗ Can't play this file. Try an MP3.";
    return false;
  }
}
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('bb_song', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function saveSong() { try { const db = await idb(); db.transaction('s', 'readwrite').objectStore('s').put({ blob: songBlob, name: songFileName }, 'song'); } catch (e) {} }
async function clearSavedSong() { try { const db = await idb(); db.transaction('s', 'readwrite').objectStore('s').delete('song'); } catch (e) {} }
async function loadSavedSong() { try { const db = await idb();
  const v = await new Promise((res, rej) => { const r = db.transaction('s').objectStore('s').get('song'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  if (v && v.blob && !songOn) { await applySong(v.blob, v.name, true); return; } } catch (e) {}
  loadDefaultSong(); }
async function loadDefaultSong() {
  try { const r = await fetch(DEFAULT_SONG); if (!r.ok) throw new Error(r.status);
    const b = await r.blob(); if (!songCustom) await applySong(b, DEFAULT_SONG_NAME, false); }
  catch (e) { $('songName').textContent = 'Music box'; }   // (no song file: the synthesized music box plays instead)
}
$('songFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  if (await applySong(f, f.name, true)) saveSong();
});
$('songClear').onclick = () => { stopSong(); clearSavedSong(); songOn = false; songBuf = null; songCustom = false; show('songClear', false); show('songTest', false); loadDefaultSong(); };
loadSavedSong();

// every frame: heartbeat, footsteps, creaks, the music box, and her song getting louder as she gets closer
function updateAudio(dt) {
  const m = monster, p = player;
  if (!m.active) { if (songOn) setSongLevel(0); return; }
  const dx = m.x - p.x, d = Math.hypot(dx, m.y - p.y);
  if (songOn) { // her song: faint when she's far away, louder and louder the closer she gets
    const near = d < 900 ? Math.pow(1 - d / 900, 1.6) : 0;
    setSongLevel(closetScene && closetScene.t > 0 ? 1 : 0.05 + 0.95 * near);
  }
  // The music box is her sound: it gets louder as she gets closer, and while she chases you
  // it always plays at full volume (faster and out of tune), however far away she is.
  const chasing = m.state === 'chase' && !closetScene && (!MP.on || m.ti === MP.myId);
  if (chasing || d < 520) { musicTimer -= dt;
    if (musicTimer <= 0) {
      musicTimer = chasing ? 0.24 : 0.42;
      const f = MELODY[musicI++ % MELODY.length], near = d < 520 ? Math.pow(1 - d / 520, 2) : 0;
      if (f && !songOn) sfx.note(f * (chasing ? 0.94 : 1) * (1 + rnd(-0.012, 0.012)), chasing ? Math.max(0.3, near * 0.4) : near * 0.25, relPan(m.x, m.y) * (chasing ? 0.6 : 0.9)); } }
  const c = clamp(1 - d / 420, 0, 1);
  hbTimer -= dt;
  if (hbTimer <= 0 && c > 0.05) { sfx.thump(0.15 + 0.55 * c); hbTimer = 1.1 - 0.75 * c; if (c > 0.55 && navigator.vibrate) navigator.vibrate(40); }
}
