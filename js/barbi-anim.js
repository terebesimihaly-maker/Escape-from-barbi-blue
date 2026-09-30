/* Barbi Blue animations.
   The model (models/barbi.glb) is rigged but has no animation clips, so they are built here from code:
   each clip is a function of time that returns a pose, and the pose is sampled into THREE.AnimationClips.
   Pose angles are in degrees, in the model's own space at rest (she faces +Z, +X is her left, +Y is up):
     x > 0 bends the spine/head forward, and swings a hanging arm or leg backwards (x < 0 = forwards)
     y turns (twist), z tilts sideways (for the left side z > 0 lifts an arm out; the right side is mirrored).
   Her standing, wandering and searching come from motion capture (models/mocap.json, retargeted from the CMU Graphics Lab
   Motion Capture Database by tools/retarget-mocap.mjs); the creepy parts (head tilt, twitches,
   curled fingers) are layered on top in code. Her sprint, the scream, the lunge and the wardrobe scene are hand-made. Without the mocap file the clips fall back
   to the hand-made versions below.
   Usage: const anim = BarbiAnim.build(THREE, gltf.scene, { mocap, scale }); anim.play('walk'); anim.update(dt); */
(function () {
'use strict';

const D = Math.PI / 180;
const sin = Math.sin, cos = Math.cos, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// a short bump around time c (width w): used for twitches and head snaps
const spike = (t, c, w) => { const k = (t - c) / w; return Math.abs(k) >= 1 ? 0 : (1 - k * k) * (1 - k * k); };
// deterministic wobble (tremble) in -1..1
const wob = (t, f, k) => sin(t * f + k) * 0.6 + sin(t * f * 2.13 + k * 1.7) * 0.4;

/* A pose is filled in by the clip functions through this small API. */
class Pose {
  constructor() { this.r = {}; this.root = [0, 0, 0]; this.abs = {}; this.w = {}; }
  // replace a bone's motion-captured rotation with a hand-made one (weight w blends between them)
  set(b, x, y, z, w) { this.abs[b] = [x, y || 0, z || 0]; this.w[b] = w === undefined ? 1 : w; return this; }
  symSet(b, x, y, z, w) { this.set(b + '.L', x, y, z, w); this.set(b + '.R', x, -(y || 0), -(z || 0), w); return this; }
  sideSet(b, s, x, y, z, w) { return s > 0 ? this.set(b + '.L', x, y, z, w) : this.set(b + '.R', x, -(y || 0), -(z || 0), w); }
  rot(b, x, y, z) { const o = this.r[b] || (this.r[b] = [0, 0, 0]); o[0] += x; o[1] += y || 0; o[2] += z || 0; return this; }
  // same motion on both sides, mirrored (x stays, y and z flip for the right side)
  sym(b, x, y, z) { this.rot(b + '.L', x, y, z); this.rot(b + '.R', x, -(y || 0), -(z || 0)); return this; }
  side(b, s, x, y, z) { return s > 0 ? this.rot(b + '.L', x, y, z) : this.rot(b + '.R', x, -(y || 0), -(z || 0)); }
  move(x, y, z) { this.root[0] += x; this.root[1] += y; this.root[2] += z; return this; }
  // spread a bend over the spine so it curves instead of hinging
  spine(x, y, z) { const w = [0.14, 0.2, 0.22, 0.22, 0.22];
    ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'].forEach((b, i) => this.rot(b, x * w[i], (y || 0) * w[i], (z || 0) * w[i])); return this; }
  neck(x, y, z) { ['neck01', 'neck02', 'neck03'].forEach(b => this.rot(b, x / 3, (y || 0) / 3, (z || 0) / 3)); return this; }
  // curl the fingers of one hand (0 = open, 1 = fist, negative = splayed), spread fans them out
  hand(s, curl, spread) {
    for (let f = 2; f <= 5; f++) {
      const fan = (f - 3.5) * (spread || 0);
      this.side('finger' + f + '-1', s, 0, 0, -curl * 55).side('finger' + f + '-1', s, fan, 0, 0);
      this.side('finger' + f + '-2', s, 0, 0, -curl * 70).side('finger' + f + '-3', s, 0, 0, -curl * 50);
    }
    this.side('finger1-2', s, 0, 0, -curl * 25).side('finger1-3', s, 0, 0, -curl * 30);
    return this;
  }
}

/* ---------- the clips ---------- */
// her O-legs (bow legs: knees out, feet in) are part of her design. Motion capture comes from a normal pair of legs,
// so on top of it the thighs are turned out, the shins in, and the feet kept flat.
function oLegs(P, amt) {
  const a = amt === undefined ? 1 : amt;
  P.sym('upperleg01', 0, 0, 9 * a).sym('lowerleg01', 0, 0, -17 * a).sym('foot', 0, 0, 8 * a);
}
// the same while running: the knees bend a lot, so the shins turn in less (or the kicking foot swings across) and the thighs go out more
function oLegsRun(P, amt) {
  const a = amt === undefined ? 1 : amt;
  P.sym('upperleg01', 0, 0, 16 * a).sym('lowerleg01', 0, 0, -4 * a).sym('foot', 0, 0, 7 * a);
}
// Legs for a walk/run cycle. ph: 0..TAU. amp: thigh swing, knee: extra knee bend in the swing, limp: right leg drags.
function legs(P, ph, amp, knee, limp) {
  for (const s of [1, -1]) {
    const p = s > 0 ? ph : ph + Math.PI, a = s < 0 ? amp * (1 - limp * 0.35) : amp;
    const swing = Math.max(0, cos(p));                      // 1 in the middle of the swing forward
    const th = -a * sin(p);                                 // thigh: negative = forward
    const kn = 6 + knee * Math.pow(swing, 1.4) * (s < 0 ? 1 - limp * 0.6 : 1);
    P.side('upperleg01', s, th, 0, -2);
    P.side('lowerleg01', s, kn, 0, 0);
    P.side('foot', s, -th * 0.35 - kn * 0.4 + (s < 0 ? limp * 18 * swing : 0), 0, 0);  // the limp foot drags its toes
  }
}

const CLIPS = {
  // standing: slow breathing, her head hangs to one side, and every few seconds it snaps the other way
  idle: { dur: 4, loop: true, mocap: 'm_idle', over(t, P, k) {                          // (mocap: standing)
    const snap = spike(k, 0.7, 0.05);
    P.rot('head', 6, sin(k * TAU) * 6 - snap * 25, 20 + sin(k * TAU * 2) * 4 - snap * 42).neck(8, 0, 0).spine(6, 0, 0);
    P.hand(1, 0.35 + 0.15 * sin(t * 5), 4).hand(-1, 0.4 + 0.2 * spike(k, 0.3, 0.08), 4); oLegs(P);
  }, fn(t, P) {
    const ph = t / 4 * TAU, br = sin(ph * 2);
    const snap = spike(t, 2.75, 0.18);
    P.spine(8 + br * 2.5, 0, 0).neck(10, 0, 0);
    P.rot('head', 6 + sin(ph) * 3, sin(ph) * 6 - snap * 25, 20 + sin(ph) * 4 - snap * 42);
    P.sym('clavicle', 0, 0, -4 + br * 1.5);
    P.sym('upperarm01', -3, 0, 3).sym('lowerarm01', -10, 0, 0);
    P.rot('upperarm01.L', sin(ph + 1) * 3, 0, 0).rot('upperarm01.R', sin(ph + 2.4) * 3, 0, 0);
    P.hand(1, 0.35 + 0.15 * sin(t * 5), 4).hand(-1, 0.4 + 0.2 * spike(t, 1.3, 0.3), 4);
    P.sym('upperleg01', -3, 0, 0).sym('lowerleg01', 6, 0, 0).sym('foot', -3, 0, 0);
    P.move(sin(ph) * 0.012, -0.012 + br * 0.004, 0);
  } },

  // wandering: a hunched, limping walk; the right foot drags and the head lolls and twitches
  walk: { dur: 1.0, loop: true, speed: 2.6, mocap: 'm_walk', over(t, P, k) {          // (mocap: a real 'zombie walk')
    P.rot('head', 2, 0, 16 + sin(k * TAU) * 3 - spike(k, 0.55, 0.05) * 22).neck(4, 0, 0);
    P.hand(1, 0.45, 5).hand(-1, 0.55, 5); oLegs(P);
  }, fn(t, P) {
    const ph = t / 1.0 * TAU;
    legs(P, ph, 25, 42, 1);
    P.move(sin(ph) * 0.03, -0.03 + 0.03 * cos(ph * 2), 0);
    P.rot('root', 0, sin(ph) * 7, sin(ph) * 3);
    P.spine(22 + cos(ph * 2) * 2, -sin(ph) * 9, -sin(ph) * 3).neck(12, 0, 0);
    P.rot('head', 4, sin(ph) * 5, 20 + sin(ph * 2) * 4 - spike(t, 0.62, 0.07) * 26);
    P.sym('upperarm01', 3, 0, 2).rot('upperarm01.L', 14 * sin(ph - 0.5), 0, 0).rot('upperarm01.R', -9 * sin(ph - 0.5), 0, 0);
    P.sym('lowerarm01', -12, 0, 0).rot('lowerarm01.L', -6 * Math.max(0, -sin(ph - 1)), 0, 0);
    P.hand(1, 0.4, 5).hand(-1, 0.55, 5);
  } },

  // searching: a slower walk, head sweeping left and right, looking for you
  search: { dur: 2.4, loop: true, speed: 3.1, mocap: 'm_creep', over(t, P, k) {        // (mocap: a 'creeping walk')
    const look = sin(k * TAU);
    P.rot('head', 0, look * 34, 10 - look * 6).neck(0, look * 14, 0);
    P.hand(1, 0.3, 6).hand(-1, 0.3, 6); oLegs(P);
  }, fn(t, P) {
    const ph = t / 1.2 * TAU, look = sin(t / 2.4 * TAU);
    legs(P, ph, 22, 38, 0.6);
    P.move(sin(ph) * 0.025, -0.035 + 0.025 * cos(ph * 2), 0);
    P.rot('root', 0, sin(ph) * 5 + look * 8, 0);
    P.spine(16, look * 18 - sin(ph) * 6, 0).neck(6, look * 18, 0);
    P.rot('head', 2 + spike(t, 1.2, 0.1) * 12, look * 38, 14 - look * 8);
    P.sym('upperarm01', 2, 0, 2).rot('upperarm01.L', 10 * sin(ph - 0.5), 0, 0).rot('upperarm01.R', -10 * sin(ph - 0.5), 0, 0);
    P.sym('lowerarm01', -18, 0, 0).hand(1, 0.3, 6).hand(-1, 0.3, 6);
  } },

  // chasing: hand-made, so she doesn't run like a person: a lurching, uneven sprint (a long stride, then a stumbling one),
  // bent low with her head held dead level and tilted, jaw hanging; head and arms move in stop-motion jerks
  // (speed: how fast her planted foot sweeps back at normal playback, measured, so her feet don't skate; she's sped up to match)
  chase: { dur: 0.9, loop: true, speed: 3.5, fn(t, P) { sprint(t, P, 0.9, 1); } },
  // hunting (running to where she heard you): the same sprint, her arms hanging and flopping behind her
  run: { dur: 0.9, loop: true, speed: 3.5, fn(t, P) { sprint(t, P, 0.9, 0); } },

  // the scream: she stops, bends, then throws her head back with her arms spread, shaking
  scream: { dur: 2.0, loop: false, fn(t, P) {
    const wind = smooth(0, 0.3, t) * (1 - smooth(0.3, 0.5, t)), out = smooth(0.3, 0.55, t) * (1 - smooth(1.55, 2.0, t));
    const sh = out * wob(t, 55, 0), sh2 = out * wob(t, 47, 2);
    P.spine(22 * wind - 16 * out + sh * 2, 0, sh2 * 2).neck(15 * wind - 22 * out, 0, 0);
    P.rot('head', 10 * wind - 18 * out + sh * 5, sh2 * 6, 18 * (1 - out) + sh * 4);
    P.rot('jaw', 4 + 30 * out + sh2 * 3, 0, 0);
    P.sym('clavicle', 0, 0, 10 * out);
    P.sym('upperarm01', -10 * wind + 25 * out, 0, -12 * wind + 58 * out + sh * 4);
    P.sym('lowerarm01', -35 * wind - 12 * out, 0, 0);
    P.hand(1, 0.6 * wind - 0.4 * out, 6 + 10 * out).hand(-1, 0.6 * wind - 0.4 * out, 6 + 10 * out);
    P.sym('upperleg01', -8 * wind - 6 * out, 0, 3 * out).sym('lowerleg01', 16 * wind + 10 * out, 0, 0).sym('foot', -8 * wind - 4 * out, 0, 0);
    oLegs(P, 0.8);
    P.move(0, -0.06 * wind - 0.04 * out, -0.04 * out);
  } },

  // the kill: a quick crouch, then she lunges into your face, clawing, mouth wide open
  lunge: { dur: 1.2, loop: false, fn(t, P) {
    const crouch = smooth(0, 0.1, t) * (1 - smooth(0.1, 0.22, t)), go = smooth(0.1, 0.26, t);
    const sh = go * wob(t, 60, 1);
    P.spine(15 * crouch + 32 * go, sh * 3, sh * 2).neck(-22 * go, 0, 0);
    P.rot('head', 8 * crouch - 12 * go + sh * 6, sh * 8, 22 * go + sh * 5);
    P.rot('jaw', 36 * go + sh * 4, 0, 0);
    P.sym('clavicle', 0, 0, 12 * go);
    P.sym('upperarm01', -10 * crouch - 88 * go, 0, 12 * go + sh * 5).sym('lowerarm01', -30 * crouch - 12 * go, 0, 0);
    P.sym('wrist', -25 * go, 0, 0);
    P.hand(1, 0.5 * crouch + 0.55 * go, 14 * go).hand(-1, 0.5 * crouch + 0.6 * go, 14 * go);
    P.sym('upperleg01', -25 * crouch - 30 * go, 0, 0).sym('lowerleg01', 45 * crouch + 25 * go, 0, 0).sym('foot', -20 * crouch, 0, 0); oLegsRun(P, 1);
    P.move(0, -0.14 * crouch - 0.06 * go, 0.3 * go);
  } },

  // outside your wardrobe: leaning in close, head tilted almost sideways, tapping the door with her fingers
  peek: { dur: 3.2, loop: true, fn(t, P) {
    const ph = t / 3.2 * TAU, snap = spike(t, 2.1, 0.12);
    P.spine(34 + sin(ph) * 3, sin(ph) * 5, 0).neck(10, 0, 0);
    P.rot('head', 8 + snap * 10, sin(ph) * 8 + snap * 20, 36 + sin(ph * 2) * 5 - snap * 12);
    P.rot('jaw', 3 + 3 * Math.max(0, sin(ph * 3)), 0, 0);
    P.side('upperarm01', -1, -62, 0, -12).side('lowerarm01', -1, -48, 0, 0).side('wrist', -1, -20, 0, 0);
    P.hand(-1, 0.25 + 0.35 * Math.max(0, sin(t * 9)), 6);
    P.side('upperarm01', 1, 6, 0, -8).side('lowerarm01', 1, -12, 0, 0).hand(1, 0.45, 4);
    P.sym('upperleg01', -12, 0, 0).sym('lowerleg01', 16, 0, 0).sym('foot', -6, 0, 0); oLegs(P, 1.4);
    P.move(0, -0.035, 0.04);
  } },
};

/* ---------- teammates (multiplayer): the same rig, all motion capture ---------- */
// her O-legs are hers alone: the teammates' legs are straightened. The rig's shins are bowed at rest (the lower shin turns in
// about 23 degrees), so that bend is taken out, and the feet turned back flat. stand: the standing capture keeps its knees
// wide apart, so they come in (measured: tests/out/legs.mjs, the thigh and both halves of the shin seen from the front)
function straightLegs(P, stand) {
  const t = stand ? -20.5 : 0, k = stand ? 25.5 : 0;
  P.sym('upperleg01', 0, 0, -12 + t).sym('lowerleg01', 0, 0, 13 + k).sym('lowerleg02', 0, 0, 23).sym('foot', 0, 0, -5 - 23 - t - k);
}
// the right arm holds the flashlight out in front (so it doesn't swing around with the walk)
function torchArm(P, w) {
  P.sideSet('upperarm01', -1, -62, 0, -14, w).sideSet('lowerarm01', -1, -38, 0, 0, w).sideSet('wrist', -1, -6, 0, 0, w);
  P.hand(-1, 0.75, 0);
}
const PLAYER_CLIPS = {
  p_idle: { loop: true, mocap: 'p_idle', over(t, P) { P.hand(-1, 0.75, 0); P.hand(1, 0.3, 3); straightLegs(P, true); } },   // looking around with the flashlight
  p_walk: { loop: true, mocap: 'p_walk', over(t, P) { torchArm(P, 0.85); P.hand(1, 0.35, 3); straightLegs(P); } },
  p_jog: { loop: true, mocap: 'p_jog', over(t, P) { torchArm(P, 0.8); P.hand(1, 0.5, 2); straightLegs(P); } },
  p_run: { loop: true, mocap: 'p_run', over(t, P) { torchArm(P, 0.7); P.hand(1, 0.6, 2); straightLegs(P); } },
  // standing calmly (the profile and the lobby): weight shifting a little, breathing, looking round now and then
  p_stand: { dur: 6, loop: true, fn(t, P) {
    const k = t / 6 * TAU;
    straightLegs(P);
    P.spine(1.5 + sin(k * 2) * 0.8, sin(k) * 4, sin(k) * 1.2).neck(-2, sin(k + 1) * 14, 0).rot('head', 0, sin(k * 2 + 0.5) * 4, 0);
    P.move(sin(k) * 0.006, sin(k * 2) * 0.002, 0);
    P.sym('shoulder01', 0, 0, -4).sym('upperarm01', 2, 0, -6).sym('lowerarm01', -12, 0, 0).sym('wrist', 0, 0, 4);
    P.side('upperleg01', 1, 0, 0, sin(k) * 1.5).side('upperleg01', -1, 0, 0, -sin(k) * 1.5);
    P.hand(1, 0.25, 3).hand(-1, 0.3, 3);
  } },
  // down: lying on the back, one hand reaching up for help (the whole body is laid down by rotating the root)
  p_down: { dur: 3, loop: true, fn(t, P) {
    const k = t / 3 * TAU;
    P.rot('root', -88, 0, 0).move(0, -0.72, -0.05);
    P.spine(-4 + sin(k * 2) * 2, 0, 0).rot('head', -10, 25 + sin(k) * 12, 0);
    P.side('upperarm01', 1, -150 + sin(k) * 14, 0, -10).side('lowerarm01', 1, -25, 0, 0).hand(1, 0.2 + 0.2 * sin(k * 2), 8);
    P.side('upperarm01', -1, 10, 0, 18).side('lowerarm01', -1, -20, 0, 0).hand(-1, 0.5, 2);
    P.side('upperleg01', 1, -28, 0, 4).side('lowerleg01', 1, 50, 0, 0).side('foot', 1, -10, 0, 0);
    P.side('upperleg01', -1, -4, 0, 6).side('lowerleg01', -1, 6, 0, 0); straightLegs(P);
  } },
  p_dead: { dur: 1, loop: true, fn(t, P) {
    P.rot('root', -90, 0, 0).move(0, -0.74, -0.05).rot('head', -6, 50, 0);
    P.side('upperarm01', 1, 12, 0, 28).side('upperarm01', -1, 8, 0, 34).side('lowerarm01', 1, -15, 0, 0).side('lowerarm01', -1, -10, 0, 0);
    P.hand(1, 0.35, 4).hand(-1, 0.3, 4);
    P.side('upperleg01', 1, -6, 0, 6).side('upperleg01', -1, -2, 0, 8); straightLegs(P);
  } },
  /* ---------- dances (the emote wheel, playing together) ---------- */

  // 1. the floss: straight arms swing from side to side, in front and behind, the hips going the other way
  d_floss: { dur: 1.0, loop: true, fn(t, P) {
    const ph = t / 1.0 * TAU, s = sin(ph), fb = cos(ph);
    P.side('upperarm01', 1, 28 * fb, 0, 18 + 34 * s).side('upperarm01', -1, 28 * fb, 0, 18 - 34 * s);
    P.sym('lowerarm01', -6, 0, 0).hand(1, 0.85, 0).hand(-1, 0.85, 0);
    P.move(-0.07 * s, -0.02, 0).spine(0, 0, 8 * s).rot('head', 0, 0, -6 * s);
    P.side('upperleg01', 1, -6 - 6 * Math.max(0, s), 0, 0).side('lowerleg01', 1, 10 + 10 * Math.max(0, s), 0, 0);
    P.side('upperleg01', -1, -6 - 6 * Math.max(0, -s), 0, 0).side('lowerleg01', -1, 10 + 10 * Math.max(0, -s), 0, 0); straightLegs(P);
  } },
  // 2. the robot: stiff, snapping from pose to pose
  d_robot: { dur: 2.4, loop: true, fn(t, P) {
    const k = t / 0.6, i = Math.floor(k) % 4, f = smooth(0, 0.18, k % 1), prev = (i + 3) % 4;
    const poses = [[-90, 0, -90, 0, 30], [-90, 60, -90, 60, -30], [-20, 90, -110, 20, 30], [-110, 20, -20, 90, -30]];   // L thigh/elbow..., head
    const A = poses[prev], B = poses[i], L = (a, b) => a + (b - a) * f;
    P.side('upperarm01', 1, L(A[0], B[0]), 0, 12).side('lowerarm01', 1, -L(A[1], B[1]) - 20, 0, 0);
    P.side('upperarm01', -1, L(A[2], B[2]), 0, 12).side('lowerarm01', -1, -L(A[3], B[3]) - 20, 0, 0);
    P.hand(1, 0, 0).hand(-1, 0, 0).rot('head', 0, L(A[4], B[4]), 0).spine(0, L(A[4], B[4]) * -0.3, 0);
    P.move(0, -0.02 * Math.abs(sin(k * Math.PI)), 0); straightLegs(P);
  } },
  // 3. disco: point up across the sky, then down to the other hip; the other hand on the hip, hips swaying
  d_disco: { dur: 1.6, loop: true, fn(t, P) {
    const ph = t / 1.6 * TAU, up = (sin(ph) + 1) / 2;
    P.side('upperarm01', -1, -30 - 20 * up, 0, 20 + 130 * up).side('lowerarm01', -1, -10, 0, 0).hand(-1, 1, 0);
    P.side('finger2-1', -1, 0, 0, 55).side('finger2-2', -1, 0, 0, 70).side('finger2-3', -1, 0, 0, 50);   // (the pointing finger straight)
    P.side('upperarm01', 1, -10, 0, 32).side('lowerarm01', 1, -95, 0, 0).side('wrist', 1, 0, 0, 30).hand(1, 0.7, 0);   // hand on the hip
    P.move(0.05 * sin(ph * 2), -0.03 - 0.02 * sin(ph * 2 + 1), 0).spine(0, 10 * (up - 0.5), 10 * (0.5 - up)).rot('head', 12 * (0.5 - up), -20 * (up - 0.5), 0);
    P.sym('upperleg01', -10, 0, 0).sym('lowerleg01', 16 + 8 * sin(ph * 2), 0, 0); straightLegs(P);
  } },
  // 4. the chicken: hands in the armpits, elbows flapping, pecking, knees bouncing
  d_chicken: { dur: 1.2, loop: true, fn(t, P) {
    const ph = t / 1.2 * TAU, flap = Math.max(0, sin(ph * 2)), peck = Math.max(0, sin(ph * 2 + 1.2));
    P.sym('upperarm01', 10, 0, 18 + 55 * flap).sym('lowerarm01', -150, 0, 0).sym('wrist', 0, 0, -20).hand(1, 0.9, 0).hand(-1, 0.9, 0);
    P.spine(18 + 8 * peck, 0, 0).neck(-20 - 20 * peck, 0, 0).rot('head', 10 * peck, 0, 0);
    P.move(0, -0.06 - 0.04 * sin(ph * 2), 0.02).sym('upperleg01', -28, 0, 0).sym('lowerleg01', 44 + 10 * sin(ph * 2), 0, 0).sym('foot', -12, 0, 0);
    P.side('upperleg01', 1, 0, 0, 6).side('upperleg01', -1, 0, 0, 6); straightLegs(P);
  } },
  // 5. the wave: arms out to the sides, a wave rolling from one hand, through the shoulders, to the other
  d_wave: { dur: 2.0, loop: true, fn(t, P) {
    const ph = t / 2.0 * TAU, w = x => sin(ph - x);
    P.side('upperarm01', 1, 0, 0, 86 + 16 * w(0)).side('lowerarm01', 1, 0, 0, 30 * w(0.8)).side('wrist', 1, 0, 0, 30 * w(1.4));
    P.side('upperarm01', -1, 0, 0, 86 + 16 * w(3.2)).side('lowerarm01', -1, 0, 0, 30 * w(2.4)).side('wrist', -1, 0, 0, 30 * w(1.8));
    P.side('clavicle', 1, 0, 0, 10 * w(0.4)).side('clavicle', -1, 0, 0, 10 * w(2.8)).spine(0, 0, 6 * w(1.6)).rot('head', 0, 0, 8 * w(1.6));
    P.hand(1, 0.1, 6).hand(-1, 0.1, 6).move(0, -0.02 - 0.02 * sin(ph * 2), 0).sym('lowerleg01', 8 + 6 * sin(ph * 2), 0, 0); straightLegs(P);
  } },
  // 6. the twist: knees bent, hips twisting one way and the shoulders the other
  d_twist: { dur: 1.0, loop: true, fn(t, P) {
    const ph = t / 1.0 * TAU, s = sin(ph);
    P.rot('root', 0, 28 * s, 0).spine(12, -46 * s, 0).rot('head', 0, -8 * s, 0);
    P.move(0, -0.13 - 0.03 * Math.abs(s), 0).sym('upperleg01', -34, 0, 0).sym('lowerleg01', 58, 0, 0).sym('foot', -18, 0, 0);
    P.side('upperarm01', 1, -30 + 25 * s, 0, 30).side('upperarm01', -1, -30 - 25 * s, 0, 30).sym('lowerarm01', -90, 0, 0).hand(1, 0.6, 0).hand(-1, 0.6, 0);
    straightLegs(P);
  } },
  // 7. air guitar: leaning back, one hand on the neck, the other strumming, head banging
  d_guitar: { dur: 1.6, loop: true, fn(t, P) {
    const ph = t / 1.6 * TAU, strum = sin(t * 16), bang = Math.max(0, sin(ph * 4));
    P.side('upperarm01', 1, -38, 0, 62).side('lowerarm01', 1, -22, 0, 0).side('wrist', 1, 0, 0, -25).hand(1, 0.65, 4);    // the neck, out to the side
    P.side('upperarm01', -1, -8, 0, 20).side('lowerarm01', -1, -62, 0, 0).side('wrist', -1, 30 * strum, 0, 0).hand(-1, 0.8, 0);    // strumming at the hip
    P.spine(-20 + 6 * sin(ph), 18, 0).neck(10 + 25 * bang, 0, 0).rot('head', 12 * bang, 0, 0);
    P.move(0, -0.05 - 0.03 * sin(ph * 4), 0).side('upperleg01', 1, -30, 0, 8).side('lowerleg01', 1, 40, 0, 0).side('upperleg01', -1, 8, 0, 6).side('lowerleg01', -1, 12, 0, 0);
    straightLegs(P);
  } },
  // 8. hype: jumping jacks, arms clapping over the head
  d_hype: { dur: 0.9, loop: true, fn(t, P) {
    const ph = t / 0.9 * TAU, open = (1 - cos(ph)) / 2, air = Math.max(0, sin(ph));
    P.move(0, 0.16 * air - 0.03, 0).sym('upperarm01', 0, 0, 25 + 145 * open).sym('lowerarm01', -10 * open, 0, 0).hand(1, 0.1, 6 * open).hand(-1, 0.1, 6 * open);
    P.sym('upperleg01', -4, 0, 4 + 16 * open).sym('lowerleg01', 8 + 12 * (1 - air), 0, 0).sym('foot', 0, 0, -10 * open).neck(-8 * open, 0, 0);
    straightLegs(P);
  } },
};

// in the open wardrobe door: bent deep into the wardrobe, face right up to yours, holding the door with one hand
CLIPS.lean = { dur: 3.0, loop: true, fn(t, P) {
  const ph = t / 3 * TAU, br = sin(ph * 2), snap = spike(t, 1.9, 0.1);
  P.spine(60 + br * 2, sin(ph) * 4, 0).neck(-34, 0, 0);
  P.rot('head', -8 + snap * 8, sin(ph) * 6 + snap * 18, 26 + sin(ph) * 5 - snap * 14);
  P.rot('jaw', 4 + 3 * Math.max(0, sin(ph * 3)), 0, 0);
  P.side('clavicle', 1, 0, 0, 8).side('upperarm01', 1, -70, 0, 34).side('lowerarm01', 1, -38, 0, 0).side('wrist', 1, -10, 0, 0);
  P.hand(1, 0.55, 6);                                                     // gripping the edge of the door
  P.side('upperarm01', -1, -28, 0, -4).side('lowerarm01', -1, -30, 0, 0).hand(-1, 0.3 + 0.3 * Math.max(0, sin(t * 7)), 8);
  P.sym('upperleg01', -30, 0, 0).sym('lowerleg01', 38, 0, 0).sym('foot', -8, 0, 0); oLegsRun(P, 0.9);
  P.move(0, -0.12, 0.08);
} };

// Her sprint. One loop = a long stride with the right leg, then a quick stumbling step with the left.
// reach 1: arms out for your face, clawing; reach 0: arms hanging loose, flopping behind her.
function sprint(t, P, dur, reach) {
  const k = t / dur, ph = k * TAU, w = ph + 0.45 * sin(ph);    // (warped time: the uneven stride)
  const q = Math.floor(k * 4) / 4, qt = q * dur;                // stop-motion time for the head and arms: 4 held poses per loop (it plays fast)
  const stumble = spike(k, 0.62, 0.07), snap = spike(k, 0.34, 0.035), snap2 = spike(k, 0.83, 0.03);
  legs(P, w, 60, 100, 0.25); oLegsRun(P, 1.35);
  P.move(sin(w) * 0.06, -0.09 + 0.06 * Math.abs(cos(w)) - 0.07 * stumble, 0);
  P.rot('root', 9 + stumble * 6, sin(w) * 11, sin(w) * 7 + stumble * 6);              // pitched forward from the hips
  P.spine(48 + cos(w * 2) * 5 + stumble * 10, -sin(w) * 13, -stumble * 4);
  // the head stays level and locked on you whatever the body does, tilted over; it snaps sideways now and then
  P.neck(-36 - stumble * 8, sin(w) * 9, 0);
  P.rot('head', -22 + wob(qt, 21, 0) * 3, -sin(w) * 10 + wob(qt, 13, 1) * 6 + snap * 32 - snap2 * 26, 30 + wob(qt, 9, 2) * 6 - snap * 40 + snap2 * 20);
  P.rot('jaw', 16 + 8 * reach + wob(qt, 17, 3) * 5, 0, 0);
  P.sym('clavicle', 0, 0, 6 * snap + 8 * stumble);
  if (reach) {
    // one arm high at your face, the other lower and further out; the hands claw open and shut
    const j = wob(qt, 11, 4) * 5;
    P.side('upperarm01', 1, -122 + j + sin(w) * 8, 0, -4).side('lowerarm01', 1, -6, 0, 0).side('wrist', 1, -22, 0, 0);
    P.side('upperarm01', -1, -40 - j - sin(w) * 12, 0, 34).side('lowerarm01', -1, -38, 0, 0).side('wrist', -1, -8, 0, 0);
    const claw = Math.max(0, sin(q * TAU * 3));
    P.hand(1, -0.2 + 0.85 * claw, 14).hand(-1, -0.2 + 0.85 * Math.max(0, sin(q * TAU * 3 + 2)), 14);
  } else {
    // dead weight: the arms swing late, far behind the legs
    P.sym('upperarm01', 22, 0, -4).rot('upperarm01.L', 34 * sin(w - 1.3), 0, 0).rot('upperarm01.R', -38 * sin(w - 1.1), 0, 0);
    P.sym('lowerarm01', -12, 0, 0).rot('lowerarm01.L', -20 * Math.max(0, sin(w - 2)), 0, 0).rot('lowerarm01.R', -24 * Math.max(0, -sin(w - 2)), 0, 0);
    P.hand(1, 0.25, 3).hand(-1, 0.3, 3);
  }
}

/* ---------- model prep ---------- */
// The top and shorts sit a few millimetres above the skin, so once she bends the skin pokes through them.
// Games solve this by deleting the skin that clothes cover: a short ray goes out from each skin vertex along
// its normal, and a skin triangle is dropped when all three of its corners are under cloth.
function hideCoveredSkin(THREE, root) {
  const meshes = {}; root.traverse(o => { if (o.isMesh) meshes[o.name] = o; });
  const body = meshes.Body, cloth = [meshes.Top, meshes.Shorts].filter(Boolean);
  if (!body || !cloth.length) return 0;
  const tris = [];
  for (const c of cloth) {
    const pos = c.geometry.attributes.position, ix = c.geometry.index;
    const n = ix ? ix.count : pos.count, g = k => ix ? ix.getX(k) : k;
    for (let k = 0; k < n; k += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, g(k)), b = new THREE.Vector3().fromBufferAttribute(pos, g(k + 1)), d = new THREE.Vector3().fromBufferAttribute(pos, g(k + 2));
      const box = new THREE.Box3().setFromPoints([a, b, d]).expandByScalar(0.05);
      tris.push({ a, b, d, box });
    }
  }
  const bg = body.geometry, bp = bg.attributes.position, bn = bg.attributes.normal;
  const covered = new Uint8Array(bp.count), ray = new THREE.Ray(), p = new THREE.Vector3(), nn = new THREE.Vector3(), hit = new THREE.Vector3();
  const all = new THREE.Box3(); tris.forEach(t => all.union(t.box));
  for (let i = 0; i < bp.count; i++) {
    p.fromBufferAttribute(bp, i); if (!all.containsPoint(p)) continue;
    nn.fromBufferAttribute(bn, i).normalize();
    ray.set(p.clone().addScaledVector(nn, -0.004), nn);
    for (const t of tris) {
      if (!t.box.containsPoint(p)) continue;
      if (ray.intersectTriangle(t.a, t.b, t.d, false, hit) && hit.distanceTo(p) < 0.045) { covered[i] = 1; break; }
    }
  }
  const ix = bg.index, keep = [];
  let dropped = 0;
  for (let k = 0; k < ix.count; k += 3) {
    const a = ix.getX(k), b = ix.getX(k + 1), c = ix.getX(k + 2);
    if (covered[a] && covered[b] && covered[c]) { dropped++; continue; }
    keep.push(a, b, c);
  }
  bg.setIndex(keep);
  // and draw the clothes slightly in front, for whatever small overlap is left
  for (const c of cloth) { const m = c.material; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  return dropped;
}

// The hair is weighted 100% to the head bone, so when she tilts her head the whole sheet of hair swings out
// like a board. Here the lower part of the hair is handed over to the upper back, so it hangs instead.
function relaxHair(THREE, root) {
  root.traverse(o => {
    if (!o.isSkinnedMesh || !/^Hair/.test(o.name)) return;
    const bones = o.skeleton.bones, find = n => bones.findIndex(b => b.name === n);
    const head = find('head'), neck = find('neck02'), back = find('spine01');
    if (head < 0 || neck < 0 || back < 0) return;
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), wh = smooth(1.2, 1.46, y), wn = (1 - wh) * smooth(1.0, 1.3, y) * 0.6, wb = 1 - wh - wn;
      si.setXYZW(i, head, neck, back, 0); sw.setXYZW(i, wh, wn, wb, 0);
    }
    si.needsUpdate = sw.needsUpdate = true;
  });
}

/* ---------- sampling poses into clips ---------- */
function build(THREE, root, opts) {
  opts = opts || {};
  const mocap = opts.mocap || null, scale = opts.scale || 1;
  const TABLE = opts.set === 'player' ? PLAYER_CLIPS : CLIPS;
  hideCoveredSkin(THREE, root);
  relaxHair(THREE, root);
  const bones = {};
  root.traverse(o => { if (o.isBone) bones[o.name] = o; });
  // GLTFLoader strips '.' from node names ('upperarm01.L' -> 'upperarm01L')
  const B = n => bones[n.replace(/[\[\].:\/]/g, '')];
  const rootBone = B('root');
  root.updateMatrixWorld(true);
  const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const rest = new Map();
  for (const b of Object.values(bones)) {
    const pw = b.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(inv);
    rest.set(b, { q: b.quaternion.clone(), p: b.position.clone(), pw, pwi: pw.clone().invert() });
  }
  const eu = new THREE.Euler(), rq = new THREE.Quaternion(), tq = new THREE.Quaternion();
  // local rotation for a model-space offset, applied in the frame the parent had at rest
  const localQ = (b, a) => { const R = rest.get(b); rq.setFromEuler(eu.set(a[0] * D, a[1] * D, a[2] * D));
    return tq.copy(R.pwi).multiply(rq).multiply(R.pw).multiply(R.q); };

  // a clip built on motion capture: the captured rotations, then the hand-made layer on top
  //  P.rot = an extra turn (like a head tilt), P.set = replace the captured rotation (like her reaching arms)
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function sampleMocap(name, def, mc) {
    const n = mc.n, fps = mc.fps, dur = n / fps, nb = mocap.bones.length, times = [], frames = [];
    for (let i = 0; i <= n; i++) {
      const fi = i % n, t = i / fps, P = new Pose(); if (def.over) def.over(t, P, (i % n) / n);
      times.push(t); frames.push({ fi, P });
    }
    const set = new Set(mocap.bones); frames.forEach(({ P }) => { Object.keys(P.r).forEach(k => set.add(k)); Object.keys(P.abs).forEach(k => set.add(k)); });
    const tracks = [];
    for (const k of set) {
      const b = B(k); if (!b) continue;
      const bi = mocap.bones.indexOf(k), R = rest.get(b), vals = [];
      for (const { fi, P } of frames) {
        if (bi >= 0) { const o = (fi * nb + bi) * 4; qa.set(mc.q[o] / 1e4, mc.q[o + 1] / 1e4, mc.q[o + 2] / 1e4, mc.q[o + 3] / 1e4).normalize(); }
        else qa.copy(R.q);
        if (P.abs[k]) { qb.copy(localQ(b, P.abs[k])); if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w); qa.slerp(qb, P.w[k]); }
        if (P.r[k]) { const a = P.r[k]; rq.setFromEuler(eu.set(a[0] * D, a[1] * D, a[2] * D)); qb.copy(R.pwi).multiply(rq).multiply(R.pw); qa.premultiply(qb); }
        qa.toArray(vals, vals.length);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, vals));
    }
    if (rootBone) { const rp = rest.get(rootBone).p, vals = [];
      frames.forEach(({ fi, P }) => vals.push(rp.x + P.root[0], rp.y + mc.ry[fi] / 1000 + P.root[1], rp.z + P.root[2]));
      tracks.push(new THREE.VectorKeyframeTrack(rootBone.name + '.position', times, vals)); }
    def.dur = dur; if (mc.speed) def.speed = mc.speed * scale;
    return new THREE.AnimationClip(name, dur, tracks);
  }
  function sample(name, def) {
    if (def.mocap && mocap && mocap.clips[def.mocap]) return sampleMocap(name, def, mocap.clips[def.mocap]);
    if (!def.fn) return null;
    const fps = 30, n = Math.max(2, Math.round(def.dur * fps)), times = [], poses = [];
    for (let i = 0; i <= n; i++) { const t = def.dur * i / n; const P = new Pose(); def.fn(def.loop && i === n ? 0 : t, P); times.push(t); poses.push(P); }
    const used = new Set(); poses.forEach(P => Object.keys(P.r).forEach(k => used.add(k)));
    const tracks = [];
    for (const k of used) {
      const b = B(k); if (!b) continue;
      const vals = [];
      poses.forEach(P => localQ(b, P.r[k] || [0, 0, 0]).toArray(vals, vals.length));
      tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, vals));
    }
    if (rootBone) { const rp = rest.get(rootBone).p, vals = [];
      poses.forEach(P => vals.push(rp.x + P.root[0], rp.y + P.root[1], rp.z + P.root[2]));
      tracks.push(new THREE.VectorKeyframeTrack(rootBone.name + '.position', times, vals)); }
    return new THREE.AnimationClip(name, def.dur, tracks);
  }

  const mixer = new THREE.AnimationMixer(root), actions = {}, clips = {};
  const defs = {};
  for (const [name, d] of Object.entries(TABLE)) {
    const def = defs[name] = Object.assign({}, d);           // (a copy per model: durations and speeds depend on the model's size)
    clips[name] = sample(name, def);
    if (!clips[name]) { delete defs[name]; continue; }
    const a = mixer.clipAction(clips[name]);
    if (!def.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions[name] = a;
  }
  let cur = null, curName = '';
  // crossfade to a clip. Looping clips keep their phase if already playing.
  function play(name, fade, restart) {
    const a = actions[name]; if (!a) return;
    if (curName === name && !restart) return;
    fade = fade === undefined ? 0.3 : fade;
    a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(a.timeScale || 1);
    if (restart || !a.isRunning()) a.reset();
    a.play();
    if (cur && cur !== a) cur.crossFadeTo(a, fade, false); else a.fadeIn(fade);
    cur = a; curName = name;
  }
  // match the playback speed to how fast she actually moves (so her feet don't slide)
  function setSpeed(metersPerSec) {
    const def = defs[curName]; if (!cur || !def || !def.speed) { if (cur) cur.timeScale = 1; return; }
    cur.timeScale = clamp(metersPerSec / def.speed, 0.4, opts.maxTime || 2.3);
  }
  return {
    mixer, actions, clips, bones: B, play, setSpeed,
    get current() { return curName; },
    get finished() { return !!cur && !defs[curName].loop && cur.time >= defs[curName].dur - 1e-3; },
    update(dt) { mixer.update(dt); },
    // jump straight to a moment of a clip (for the viewer and screenshots)
    pose(name, t) { mixer.stopAllAction(); const a = actions[name]; a.reset(); a.play(); a.setEffectiveWeight(1); cur = a; curName = name; mixer.setTime(t); },
    names: Object.keys(defs), defs,
  };
}

window.BarbiAnim = { build, hideCoveredSkin, CLIPS, PLAYER_CLIPS };
})();
