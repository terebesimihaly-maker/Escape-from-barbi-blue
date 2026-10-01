/* Test hooks: served only by tests/server.mjs (injected into the page right before js/main.js), never part of the real game.
   window.bb gives the tests access to the game's state; window.bbAudio renders the game's sound offline (for video captures). */
'use strict';

window.__autoGuest = !/[?&]auth=/.test(location.search);
window.bb = {
  get state() { return state }, set state(v) { state = v },
  get player() { return player }, get monster() { return monster }, get barbi() { return barbi },
  get closets() { return closets }, get fuses() { return fuses }, get exit() { return exit }, get grid() { return grid },
  get camera() { return camera }, get renderer() { return renderer }, get level() { return level },
  get closetScene() { return closetScene }, set closetScene(v) { closetScene = v }, set sceneCool(v) { sceneCool = v },
  set flicker(v) { flicker = v }, get powerOn() { return powerOn }, set powerOn(v) { powerOn = v },
  get fusesGot() { return fusesGot }, get floorIdx() { return floorIdx }, get lastDt() { return lastDt },
  get songOn() { return songOn }, get songLevel() { return songBus ? songBus.gain.value : null }, get songPlaying() { return !!songNode },
  get acState() { return ac && ac.state }, audio: () => ac,
  get MP() { return MP }, get reviveTarget() { return reviveTarget }, get revP() { return revP }, set reviveHeld(v) { reviveHeld = v },
  get scares() { return scares },
  T, isWall, center, los, CELLS: () => CELLS,
  startFloor, die, toggleHide, startScream, downPlayer, allPlayers, hostEmit, applyFuse,
  // the layout (js/layout.js): furniture boxes, nav, ceilings, halls, servant runs; and the pieces that may not exist yet (guarded)
  SOLIDS: () => SOLIDS, NAV: () => NAV, CEIL: () => CEIL, ROOMS: () => ROOMS, RUNS: () => RUNS,
  cutAt, losSight, clearLine, validateFloor, applyLayout, LAYOUT_REJECTS: () => LAYOUT_REJECTS,
  get stepAlongPath() { return typeof stepAlongPath === 'function' ? stepAlongPath : undefined; },
  Kit: () => typeof Kit !== 'undefined' ? Kit : undefined, LightBaker: () => typeof LightBaker !== 'undefined' ? LightBaker : undefined,
  kitReady: s => typeof Kit !== 'undefined' && Kit.ready(s),
};

window.bbAudio = {
  // swap the live audio context for an offline one; set(t) moves its clock, render() returns a WAV (base64)
  start(dur) {
    const off = new OfflineAudioContext(2, Math.ceil(dur * 44100), 44100); let now = 0;
    const px = new Proxy(off, { get(t, k) { if (k === 'currentTime') return now; if (k === 'state') return 'running'; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
    stopSongNode(); ac = px; songBus = null; songNode = null; buildAudioGraph();
    if (songOn) { playSongNode(); setSongLevel(0, true); }
    window.__speakAt = null; this.off = off; this.set = v => { now = v; this.now = v; }; this.now = 0;
  },
  async render() {
    const b = await this.off.startRendering(), n = b.length, L = b.getChannelData(0), R = b.getChannelData(1);
    const buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, 44100, true); v.setUint32(28, 44100 * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
    let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return btoa(s);
  },
};
// (the spoken line can't be rendered offline: the tests only record when it would be said)
speakCreepy = () => { window.__speakAt = window.bbAudio.now; };
