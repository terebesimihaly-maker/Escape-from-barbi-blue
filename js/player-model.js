/* Teammates in multiplayer.
   createHuman: a real human figure: the rigged model from models/barbi.glb (the same skeleton as hers), dressed
   differently for each player (jacket and trousers by lobby slot) with a face of their own (opts.face: their id; see below),
   and moved by motion capture
   (see js/barbi-anim.js). The right hand holds a flashlight that really lights the room, aimed where they look.
   create: a simple figure built from shapes, used only if the model file couldn't be loaded.
   Usage: const pm = PlayerModel.createHuman(THREE, { slot, name, template: gltf.scene, mocap, face: playerId }); scene.add(pm.obj);
          every frame: pm.update(dt, { speed (m/s), sprinting, down, dead, hidden, pitch });
   Figures face +Z. */
(function () {
'use strict';

const JACKETS = [0x3a63b8, 0xb23a36, 0x2f9656, 0xc79a2a];
const HAIR = [0x2a1a10, 0xcfa65e, 0x121212, 0x6b3a1e];
const TAGS = ['#9fb8ff', '#ff9f9a', '#9fe8b8', '#ffd98a'];

function create(THREE, opts) {
  const slot = (opts.slot || 0) % 4;
  const M = c => new THREE.MeshLambertMaterial({ color: c });
  const jacket = M(JACKETS[slot]), pants = M(0x1d2336), skin = M(0xd9ae8a), shoe = M(0x131313), hair = M(HAIR[slot]), dark = M(0x1a1c20);
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; return m; };
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
  const group = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; };

  const root = new THREE.Group();          // stands on the floor, turned to face where the player looks
  const body = group(root);                // tipped over when the player is down
  const hips = group(body, 0, 0.95, 0);
  const pelvis = mesh(cap(0.13, 0.12), pants, 0, 0, 0); pelvis.rotation.z = Math.PI / 2; pelvis.scale.set(1, 1, 0.78); hips.add(pelvis);
  const spine = group(hips, 0, 0.06, 0);
  const torso = mesh(cap(0.16, 0.28), jacket, 0, 0.24, 0); torso.scale.set(1.18, 1, 0.74); spine.add(torso);
  const zip = mesh(new THREE.BoxGeometry(0.012, 0.36, 0.01), dark, 0, 0.24, 0.12); spine.add(zip);
  spine.add(mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.09, 10), skin, 0, 0.5, 0));
  const head = group(spine, 0, 0.58, 0);
  const skull = mesh(new THREE.SphereGeometry(0.105, 18, 14), skin, 0, 0.07, 0); skull.scale.set(0.92, 1.1, 1); head.add(skull);
  const hairCap = mesh(new THREE.SphereGeometry(0.113, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.085, -0.012);
  hairCap.scale.set(0.95, 1.08, 1.04); head.add(hairCap);
  const back = mesh(new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.35), hair, 0, 0.06, -0.02); head.add(back);
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), dark, s * 0.036, 0.085, 0.095));

  // arms: a shoulder joint, an elbow joint, a hand. Her right is -x (the figure faces +z)
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = group(spine, s * 0.215, 0.41, 0);
    sh.add(mesh(cap(0.052, 0.2), jacket, 0, -0.14, 0));
    const el = group(sh, 0, -0.29, 0);
    el.add(mesh(cap(0.046, 0.18), jacket, 0, -0.11, 0));
    el.add(mesh(new THREE.SphereGeometry(0.045, 10, 8), skin, 0, -0.25, 0));
    arms.push({ sh, el, s });
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hp = group(hips, s * 0.1, -0.03, 0);
    hp.add(mesh(cap(0.075, 0.3), pants, 0, -0.215, 0));
    const kn = group(hp, 0, -0.43, 0);
    kn.add(mesh(cap(0.062, 0.3), pants, 0, -0.21, 0));
    const ft = group(kn, 0, -0.44, 0);
    ft.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoe, 0, -0.015, 0.05));
    legs.push({ hp, kn, ft, s });
  }

  // the flashlight, held in front at chest height in the right hand; it points where the player looks
  const aim = group(spine, -0.17, 0.28, 0.32);
  const torch = mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.17, 12), dark, 0, 0, 0); torch.rotation.x = Math.PI / 2; aim.add(torch);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d0).multiplyScalar(3) }));
  lens.position.z = 0.087; aim.add(lens);
  const light = new THREE.SpotLight(0xffe0b0, 14, 13, 0.5, 0.6, 1.0);
  light.position.set(0, 0, 0.09); light.target.position.set(0, 0, 5); aim.add(light, light.target);

  // the nametag floats above the head (hidden by walls like everything else)
  const tagCv = document.createElement('canvas'); tagCv.width = 512; tagCv.height = 128;
  const tagTex = new THREE.CanvasTexture(tagCv); tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false, fog: false }));
  tag.scale.set(1.0, 0.25, 1); tag.position.y = 2.08; tag.renderOrder = 5; root.add(tag);
  let tagText = '';
  function setName(text, alarm) {
    const key = text + '|' + (alarm ? 1 : 0); if (key === tagText) return; tagText = key;
    const g = tagCv.getContext('2d'); g.clearRect(0, 0, 512, 128);
    g.font = '600 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.min(500, g.measureText(text).width + 44);
    g.fillStyle = 'rgba(8,10,20,.62)'; const x = 256 - w / 2;
    g.beginPath(); if (g.roundRect) g.roundRect(x, 20, w, 88, 26); else g.rect(x, 20, w, 88); g.fill();
    g.fillStyle = alarm ? '#ff6b6b' : TAGS[slot]; g.fillText(text, 256, 66, 480);
    tagTex.needsUpdate = true;
  }
  setName(opts.name || 'Player');

  let phase = 0, fall = 0, breath = Math.random() * 6;
  // hidden (in a wardrobe) or away: hide the body and the nametag, but keep the flashlight in the scene (at 0).
  // (turning a light off changes how many lights there are, and that makes every material recompile: a stutter)
  let shown = true;
  function showParts(v) { if (v === shown) return; shown = v;
    root.traverse(o => { if (o.isMesh || o.isSprite) { if (o.userData.vis0 === undefined) o.userData.vis0 = o.visible; o.visible = v && o.userData.vis0; } }); }
  // (detail by distance: someone more than 4 m away keeps only the lower layers of their short hair and beard)
  const furMats = []; root.traverse(o => { if (o.material && o.material.userData && o.material.userData.furTop) furMats.push(o.material.userData.furTop); });
  function update(dt, s) {
    if (s.camDist !== undefined) { const top = s.camDist > 4 ? 0.4 : 1; for (const u of furMats) u.value = top; }
    showParts(!(s.hidden || s.away));
    breath += dt;
    const lying = s.down || s.dead;
    fall += ((lying ? 1 : 0) - fall) * Math.min(1, dt * 6);
    body.rotation.x = -Math.PI / 2 * fall; body.position.y = 0.16 * fall;
    tag.position.y = 2.08 - 1.45 * fall;                     // the nametag comes down with them
    light.intensity = s.dead || s.hidden || s.away || s.lightOn === false ? 0 : 14;
    if (lying) {
      // on their back; while still alive one hand reaches up for help
      const reach = s.dead ? 0 : 1;
      arms[1].sh.rotation.set(-1.3 * reach - 0.2 + Math.sin(breath * 1.3) * 0.25 * reach, 0, 0.25);
      arms[1].el.rotation.x = -0.5 * reach;
      arms[0].sh.rotation.set(0.1, 0, -0.3); arms[0].el.rotation.x = -0.2;
      legs.forEach((l, i) => { l.hp.rotation.x = i ? -0.25 : 0; l.kn.rotation.x = i ? 0.5 : 0.05; });   // one knee up
      spine.rotation.x = -0.05 + Math.sin(breath * 2.2) * 0.02 * reach; head.rotation.set(0, Math.sin(breath * 0.7) * 0.3 * reach, 0);
      aim.rotation.x = 1.2;
      return;
    }
    const sp = Math.max(0, s.speed || 0) / 0.045, run = s.sprinting ? 1 : 0;   // (speed comes in m/s)
    phase += dt * sp * (run ? 0.1 : 0.085);
    const amp = Math.min(1, sp / 100) * (run ? 0.8 : 0.5);
    const sw = Math.sin(phase);
    legs.forEach((l, i) => {
      const k = i ? -1 : 1, a = sw * amp * k;
      l.hp.rotation.x = -a;
      l.kn.rotation.x = Math.max(0, Math.sin(phase * 1 + (i ? Math.PI : 0) + 1.3)) * amp * 1.6 + 0.05;
      l.ft.rotation.x = a * 0.3;
    });
    hips.position.y = 0.95 - Math.abs(Math.cos(phase)) * 0.035 * amp - 0.02 * run;
    spine.rotation.x = 0.08 + 0.18 * run * Math.min(1, amp) + Math.sin(breath * 2) * 0.012;
    spine.rotation.y = sw * 0.12 * amp;
    // left arm swings; right arm holds the flashlight out in front, tilting with the player's view
    const pitch = s.pitch || 0;
    arms[1].sh.rotation.set(sw * amp * 0.9, 0, 0.08); arms[1].el.rotation.x = -0.25 - amp * 0.4;
    arms[0].sh.rotation.set(-1.15 - pitch * 0.7, 0, -0.35); arms[0].el.rotation.x = -0.55 + pitch * 0.3;
    aim.rotation.x = -pitch * 0.9 + Math.sin(phase * 2) * 0.03 * amp;
    head.rotation.set(-pitch * 0.5, 0, 0);
  }
  function dispose() {
    root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
  return { obj: root, setName, update, light, dispose };
}

/* ---------- real people: the rigged model, dressed per player, moved by motion capture ---------- */
const LOOKS = [
  { jacket: 0x2d4f96, pants: 0x1b2640, shoe: 0x161616, hair: 0x3b2414, skin: 0xffffff, long: true, scale: 1.1, flat: 0.55 },
  { jacket: 0x93302c, pants: 0x19191b, shoe: 0x241b14, hair: 0xd9b477, skin: 0xefd9c4, long: false, scale: 1.14, flat: 0.25 },
  { jacket: 0x2f6e48, pants: 0x5b5240, shoe: 0x141414, hair: 0x101010, skin: 0x9d7760, long: true, scale: 1.08, flat: 0.7 },
  { jacket: 0x9b7526, pants: 0x3a3d44, shoe: 0x2b1d12, hair: 0x6e2e14, skin: 0xf2dccd, long: false, scale: 1.12, flat: 0.25 },
];
// recolour a textured part (keeping the texture's light and shade), used for clothes and hair
function recolor(THREE, mat, color, gain) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTint = { value: new THREE.Color(color) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = uTint * (0.35 + 1.3 * dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)));');
  };
  mat.customProgramCacheKey = () => 'tint' + gain;
}
// Which body part each skin vertex belongs to, from the bones that move it: 1 hand, 2 foot, 3 leg, 4 head/neck, 0 torso/arms.
// Worked out once (the body geometry is shared by everyone) and stored as a vertex attribute.
function zoneBody(THREE, mesh) {
  const g = mesh.geometry; if (g.attributes.aZone) return;
  const bones = mesh.skeleton.bones.map(b => b.name), si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = si.count;
  const group = nm => /^(wrist|finger|metacarpal)/.test(nm) ? 1 : /^(foot|toe)/.test(nm) ? 2 : /^(upperleg|lowerleg|pelvis)/.test(nm) ? 3
    : /^(neck|head|jaw|eye|levator|oris|special|tongue|orbicularis|oculi|temporalis|risorius)/.test(nm) ? 4 : 0;
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = [0, 0, 0, 0, 0];
    for (let c = 0; c < 4; c++) w[group(bones[si.getComponent(i, c)] || '')] += sw.getComponent(i, c);
    let best = 0; for (let k = 1; k < 5; k++) if (w[k] > w[best]) best = k;
    z[i] = best;
  }
  g.setAttribute('aZone', new THREE.BufferAttribute(z, 1));
}
// the body gets trousers, a long-sleeved top and shoes painted on, by body part
function dressBody(THREE, mat, look, feetOnly) {
  if (feetOnly) {
    // real clothes over it: the feet are painted the shoes' colour (in case a toe pokes through), and the skin isn't drawn at
    // all where the clothes always cover it (the body at rest, in metres: the torso from under the neckline to above the hem,
    // the legs from the waist to the trousers' or shorts' hems) - otherwise the chest pokes through the shirt
    const legTo = look.bottom === 'trousers' ? 0.13 : look.bottom === 'shorts' ? 0.6 : 9;
    mat.onBeforeCompile = sh => {
      sh.uniforms.uShoe = { value: new THREE.Color(look.shoe) }; sh.uniforms.uLegTo = { value: legTo };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aZone;\nvarying float vZone;\nvarying vec3 vRest;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vZone = aZone; vRest = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vZone;\nvarying vec3 vRest;\nuniform vec3 uShoe;\nuniform float uLegTo;')
        .replace('#include <map_fragment>', `#include <map_fragment>
  if (vZone > 1.5 && vZone < 2.5) diffuseColor.rgb = uShoe;
  if (vRest.y > 0.9 && vRest.y < 1.215 && abs(vRest.x) < 0.145) discard;                       // (under the top)
  if (vRest.y < 0.93 && vRest.y > uLegTo && abs(vRest.x) < 0.2 && vZone > 2.5 && vZone < 3.5) discard;   // (under trousers or shorts)`);
    };
    mat.customProgramCacheKey = () => 'feet' + legTo; return;
  }
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPants = { value: new THREE.Color(look.pants) }; sh.uniforms.uSleeve = { value: new THREE.Color(look.jacket) };
    sh.uniforms.uShoe = { value: new THREE.Color(look.shoe) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aZone;\nvarying float vZone;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vZone = aZone; vRest = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vZone;\nvarying vec3 vRest;\nuniform vec3 uPants, uSleeve, uShoe;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  float weave = 0.92 + 0.08 * sin(vRest.y * 1400.0) * sin(vRest.x * 1100.0 + vRest.z * 900.0);
  if (vZone > 1.5 && vZone < 2.5) diffuseColor.rgb = uShoe * (0.8 + 0.4 * smoothstep(0.0, 0.075, vRest.y));
  else if ((vZone > 2.5 && vZone < 3.5) || (vZone < 0.5 && vRest.y < 0.93)) diffuseColor.rgb = uPants * weave * (0.85 + 0.15 * smoothstep(0.1, 0.9, vRest.y));
  else if (vZone < 0.5 || (vZone > 3.5 && vRest.y < 1.305)) diffuseColor.rgb = uSleeve * weave;   // a long-sleeved top`);
  };
  mat.customProgramCacheKey = () => 'dressed';
}
/* ---------- a face of their own ----------
   The head's face is a photo: hers. Every player gets their own, made from a seed (their player id, so everyone sees the same
   face for the same player): skin tone, hair colour and length, the head reshaped (jaw, chin, nose, cheeks, eyes, mouth, brow,
   the length of the face) and the face repainted (eyebrows, a closed mouth, eye colour, eyeliner and eyeshadow, stubble or a
   beard, freckles, blush, a mole, lines with age), and glasses for some. The scalp under the hair is painted the hair's colour. */
// a seeded random generator (so the same player id always gives the same face)
function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const c of String(seed)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const SKINS = [0xffffff, 0xf7e6da, 0xefd9c4, 0xe2c3aa, 0xc99f83, 0xa8806a, 0x8a624e, 0x6a4838];   // (multiplied with the face's own colour)
const HAIRS = [0x101010, 0x241810, 0x3b2414, 0x5a3a22, 0x6e2e14, 0x8a5a2e, 0xb08850, 0xd9b477, 0xe6cf9f];
function faceSpec(seed) {
  const r = rng(seed), pick = a => a[r() * a.length | 0], rr = (a, b) => a + r() * (b - a), masc = r() < 0.5, age = r();
  const f = { masc, age,
    skin: pick(SKINS), hair: age > 0.85 && r() < 0.6 ? pick([0x8a8a86, 0xb4b2ac, 0x5c5a58]) : pick(HAIRS), long: masc ? r() < 0.15 : r() < 0.7,
    scale: masc ? rr(1.1, 1.16) : rr(1.05, 1.12), flat: masc ? rr(0.15, 0.3) : rr(0.45, 0.8),
    // the shape (metres, or fractions)
    face: rr(-0.08, 0.1), jaw: masc ? rr(0.04, 0.2) : rr(-0.12, 0.05), chin: rr(-0.006, 0.01), chinZ: rr(-0.004, 0.007),
    nose: rr(-0.3, 0.75), noseW: rr(-0.2, 0.45), noseTip: rr(-0.004, 0.004), cheek: rr(0, 0.008), chub: rr(-0.004, 0.011),
    lips: masc ? rr(-0.8, 0.5) : rr(0, 1.2), smile: rr(-1, 0.6), eyeSize: rr(-0.12, 0.14), eyeGap: rr(-0.0025, 0.003), brow: masc ? rr(0.3, 1.2) : rr(0, 0.4),
    // the paint
    browThick: masc ? rr(4.5, 7.5) : rr(2.8, 5), browArch: rr(1, 7), browTilt: rr(-3, 3), browGap: rr(-3, 6), browLen: rr(-6, 6),
    iris: pick([0x5a3a1e, 0x3b2412, 0x6b4a2a, 0x2f5d8a, 0x4a7fa8, 0x4f7a4a, 0x7a6a3a, 0x5f6a70]),
    lipCol: masc ? pick([0xa8685f, 0x9c5c55, 0xb07368]) : pick([0xb8525a, 0xc0606a, 0xa84a55, 0xc47a78, 0x8e3a48]),
    mouthW: masc ? rr(48, 62) : rr(42, 56), lipFull: masc ? rr(0.6, 1) : rr(0.9, 1.4),
    beard: masc ? pick(['none', 'stubble', 'stubble', 'beard', 'moustache', 'goatee']) : 'none',
    liner: !masc && r() < 0.55, shadow: !masc && r() < 0.35 ? pick([0x6a4a7a, 0x5a4030, 0x4a5060, 0x8a5a6a]) : 0,
    blush: !masc && r() < 0.5, freckles: r() < 0.3, mole: r() < 0.25 ? [rr(435, 585), rr(470, 575)] : null,
    glasses: r() < 0.3 ? { round: r() < 0.5, col: pick([0x151515, 0x3a2616, 0x9a7a40, 0x243048]) } : null };
  return f;
}
const sm = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
const gs = (d, r) => Math.exp(-(d * d) / (2 * r * r));
// the head's shape (metres, the model at rest, facing +z; eyes at y 1.469, nose tip 1.44, mouth 1.405, chin 1.367).
// The back of the head, the scalp under the hair and the neck seam never move (so the hair and the body still fit).
function shapeHead(geo, f) {
  const P = geo.attributes.position, n = P.count;
  for (let i = 0; i < n; i++) {
    const x0 = P.getX(i), y0 = P.getY(i), z0 = P.getZ(i);
    const w = sm(0.03, 0.09, z0) * sm(1.335, 1.372, y0) * (1 - sm(1.50, 1.525, y0));
    if (w <= 0) continue;
    let x = x0, y = y0, z = z0;
    if (y0 < 1.469) y -= f.face * (1.469 - y0) * sm(1.469, 1.43, y0);                     // the lower face longer or shorter
    x *= 1 + f.jaw * sm(1.45, 1.385, y0);                                                  // the jaw wider or narrower
    const gc = gs(Math.hypot(x0, y0 - 1.367, (z0 - 0.131) * 0.7), 0.022); y -= f.chin * gc; z += (f.chin * 0.4 + f.chinZ) * gc;   // the chin
    const gn = gs(Math.hypot(x0, (y0 - 1.448) * 0.8, z0 - 0.145), 0.017);                  // the nose: size, width, tip up or down
    z += f.nose * 0.011 * gn; x *= 1 + (f.nose * 0.3 + f.noseW) * gn; y += f.noseTip * gs(Math.hypot(x0, y0 - 1.44, z0 - 0.152), 0.009);
    for (const s of [-1, 1]) {
      const gk = gs(Math.hypot(x0 - s * 0.052, y0 - 1.44, z0 - 0.108), 0.02); x += s * f.cheek * gk; z += f.cheek * 0.5 * gk;      // cheekbones
      const gf = gs(Math.hypot(x0 - s * 0.048, y0 - 1.405, z0 - 0.1), 0.022); x += s * f.chub * gf; z += f.chub * 0.4 * gf;       // full or hollow cheeks
      const gm = gs(Math.hypot(x0 - s * 0.022, y0 - 1.405, z0 - 0.13), 0.008); y += f.smile * 0.0028 * gm; x += s * (f.mouthW - 52) * 0.00008 * gm;   // mouth corners
      const ge = gs(Math.hypot(x0 - s * 0.035, (y0 - 1.469) * 1.2, (z0 - 0.117) * 0.5), 0.013);                                  // the eyes: size and spacing
      x += (x0 - s * 0.035) * f.eyeSize * ge + s * f.eyeGap * ge; y += (y0 - 1.469) * f.eyeSize * ge;
    }
    const gl = gs(Math.hypot(x0 * 0.6, y0 - 1.403, z0 - 0.138), 0.012); z += f.lips * 0.003 * gl;                          // lips
    const gb = gs(Math.hypot(Math.abs(x0) - 0.042, (y0 - 1.494) * 1.5, z0 - 0.12), 0.018); z += f.brow * 0.004 * gb;       // the brow
    P.setXYZ(i, x0 + (x - x0) * w, y0 + (y - y0) * w, z0 + (z - z0) * w);
  }
  P.needsUpdate = true; geo.computeBoundingBox(); geo.computeBoundingSphere();
}
const rgba = (n, a) => 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
function mix(n, m, t) { const ch = s => Math.round((n >> s & 255) * (1 - t) + (m >> s & 255) * t); return (ch(16) << 16) | (ch(8) << 8) | ch(0); }
// which parts of the head are under the hair cap (worked out once: the same for everyone)
const scalpCache = new WeakMap();
function scalpVerts(geo, cap) {
  const g = geo; if (scalpCache.has(g)) return scalpCache.get(g);
  const hp = g.attributes.position, cp = cap.geometry.attributes.position, out = new Uint8Array(hp.count);
  for (let i = 0; i < hp.count; i++) { const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i); let d = 1;
    if (y < 1.39) continue;
    for (let j = 0; j < cp.count; j++) { const dx = cp.getX(j) - x, dy = cp.getY(j) - y, dz = cp.getZ(j) - z, dd = dx * dx + dy * dy + dz * dz; if (dd < d) d = dd; }
    const ear = Math.abs(x) > 0.066 && z > -0.045 && z < 0.055 && y < 1.5;     // (the ears stick out of the hair: they stay skin)
    out[i] = d < 0.015 * 0.015 && !ear ? 1 : 0; }
  scalpCache.set(g, out); return out;
}
// the face painted on (on the 1024 face texture: eyes 462 / 560 at 452, nose 510,490, mouth 510,547, chin 510,602)
function paintFace(THREE, head, sc, f, seed) {
  const img = head.material.map.image, W = img.width, H = img.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), k = W / 1024, r = rng(seed + ':paint');
  // the skin tone goes into the picture itself (the material stays white), so hair, brows and lips can be painted in their
  // own colours on any skin (multiplying afterwards could never make anything lighter than the skin)
  g.drawImage(img, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = rgba(f.skin, 1); g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
  const sample = pts => { const s = [0, 0, 0]; for (const [x, y] of pts) { const d = g.getImageData(x * k, y * k, 1, 1).data; s[0] += d[0]; s[1] += d[1]; s[2] += d[2]; }
    return (Math.round(s[0] / pts.length) << 16) | (Math.round(s[1] / pts.length) << 8) | Math.round(s[2] / pts.length); };
  const skinTop = sample([[500, 400], [520, 400], [510, 410], [470, 410], [550, 410]]), skinLow = sample([[480, 588], [540, 588], [466, 522], [554, 522], [510, 596]]);
  const shade = (n, k) => k ? mix(n, 0x000000, 1 - k) : n;          // (a colour, darkened to k of itself)
  // (eyebrows and facial hair: never lighter than half the skin's brightness)
  const darker = (n, k) => { const ch = s => Math.min(n >> s & 255, Math.round((skinLow >> s & 255) * k)); return (ch(16) << 16) | (ch(8) << 8) | ch(0); };
  // the scalp under the hair: hair coloured, so the gaps along the hairline show hair, not skin
  if (sc) { const uv = head.geometry.attributes.uv, idx = head.geometry.index, hc = rgba(shade(f.hair, 0.72), 1);
    g.fillStyle = hc; g.strokeStyle = hc; g.lineWidth = 2; g.lineJoin = 'round';
    for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), d = idx.getX(t + 2); if (sc[a] + sc[b] + sc[d] < 2) continue;
      g.beginPath(); g.moveTo(uv.getX(a) * W, uv.getY(a) * H); g.lineTo(uv.getX(b) * W, uv.getY(b) * H); g.lineTo(uv.getX(d) * W, uv.getY(d) * H); g.closePath(); g.fill(); g.stroke(); } }
  g.scale(k, k);
  const soft = (x, y, rx, ry, col, a, core) => { g.save(); g.translate(x, y); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, rgba(col, a)); gr.addColorStop(core || 0.55, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(-rx, -rx, rx * 2, rx * 2); g.restore(); };
  // 1. her eyebrows and her mouth, painted away
  for (const x of [458, 562]) { soft(x, 428, 42, 14, skinTop, 1, 0.6); soft(x, 428, 42, 14, skinTop, 0.8); }
  for (let i = 0; i < 3; i++) soft(510, 547, 46, 31, skinLow, 1, 0.62);
  // 2. age: lines on the forehead, round the eyes, from the nose to the mouth
  if (f.age > 0.72) { const a = (f.age - 0.72) * 1.4; g.strokeStyle = rgba(0x5a3a30, a * 0.5); g.lineWidth = 1;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(470, 392 + i * 8); g.quadraticCurveTo(510, 388 + i * 8, 550, 392 + i * 8); g.stroke(); }
    for (const s of [-1, 1]) { const ex = 510 + s * 72; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(ex, 452 + i * 5); g.lineTo(ex + s * 9, 450 + i * 8); g.stroke(); }
      g.beginPath(); g.moveTo(510 + s * 22, 505); g.quadraticCurveTo(510 + s * 34, 530, 510 + s * 32, 552); g.stroke();
      soft(510 + s * 49, 466, 18, 6, 0x6a4a40, a * 0.35); } }
  // 3. facial hair
  const browCol = darker(mix(f.hair, 0x1a120e, 0.5), 0.55);   // (clearly darker than the hair, and than the skin)
  // (the hairs themselves are real: the face's fur, beardMask below; on the skin only the faint shadow of the roots)
  if (f.beard !== 'none') { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = f.beard === 'stubble' ? 0.16 : 0.22;
    g.globalCompositeOperation = 'multiply'; g.drawImage(beardMask(f.beard, mix(darker(f.hair, 0.8), 0x7f8a9a, 0.35), W), 0, 0, W, H); g.restore(); }
  // 4. a closed mouth: the upper lip with its bow, the fuller lower lip, the line between, a little light on the lower lip
  const cx = 510, y0 = 547 - f.smile * 1.5, w = f.mouthW, fl = f.lipFull, lip = shade(f.lipCol), up = f.smile * 3;
  g.fillStyle = rgba(mix(lip, 0x000000, 0.18), 0.92);
  g.beginPath(); g.moveTo(cx - w / 2, y0 + 1 - up);
  g.bezierCurveTo(cx - w * 0.36, y0 - 3 * fl, cx - w * 0.2, y0 - 7 * fl, cx - w * 0.09, y0 - 6.5 * fl);
  g.quadraticCurveTo(cx, y0 - 4.5 * fl, cx + w * 0.09, y0 - 6.5 * fl);
  g.bezierCurveTo(cx + w * 0.2, y0 - 7 * fl, cx + w * 0.36, y0 - 3 * fl, cx + w / 2, y0 + 1 - up);
  g.quadraticCurveTo(cx, y0 + 1.5 + up * 0.3, cx - w / 2, y0 + 1 - up); g.fill();
  g.fillStyle = rgba(lip, 0.92);
  g.beginPath(); g.moveTo(cx - w / 2, y0 + 1 - up); g.quadraticCurveTo(cx, y0 + 2.5 + up * 0.3, cx + w / 2, y0 + 1 - up);
  g.bezierCurveTo(cx + w * 0.3, y0 + 9 * fl, cx - w * 0.3, y0 + 9 * fl, cx - w / 2, y0 + 1 - up); g.fill();
  soft(cx, y0 + 4.5 * fl, w * 0.2, 2.2 * fl, 0xffffff, 0.2);
  g.strokeStyle = 'rgba(60,24,22,.85)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx - w / 2, y0 + 1 - up); g.quadraticCurveTo(cx, y0 + 2.5 + up * 0.3, cx + w / 2, y0 + 1 - up); g.stroke();
  // 5. eyebrows: an arch, thicker at the inner end, with hairs
  for (const s of [-1, 1]) {
    const ix = 510 + s * (22 + f.browGap), ox = 510 + s * (88 + f.browLen), iy = 432, oy = 432 + f.browTilt, px = ix + (ox - ix) * 0.62, py = 428 - f.browArch, t = f.browThick;
    g.fillStyle = rgba(shade(browCol), 0.88); g.beginPath();
    g.moveTo(ix, iy - t * 0.55); g.quadraticCurveTo(px, py - t * 0.55, ox, oy - t * 0.05);
    g.quadraticCurveTo(px, py + t * 0.45, ix, iy + t * 0.5); g.closePath(); g.fill();
    g.strokeStyle = rgba(shade(mix(browCol, 0x000000, 0.2)), 0.6); g.lineWidth = 0.8;
    for (let i = 0; i < 26; i++) { const u = r(), bx = ix + (ox - ix) * u, by = iy + (oy - iy) * u - Math.sin(u * Math.PI) * (iy - py) * 0.9 + (r() - 0.5) * t * 0.6;
      g.beginPath(); g.moveTo(bx, by + 1.5); g.lineTo(bx + s * (2 + r() * 2), by - 1.5); g.stroke(); }
  }
  // 6. the eyes: eyeshadow, their colour (keeping the light and shade), a dark pupil, eyeliner
  if (f.shadow) for (const x of [462, 560]) soft(x, 443, 24, 8, shade(f.shadow), 0.35);
  g.globalCompositeOperation = 'color';
  for (const x of [462, 560]) soft(x, 452, 6, 4.5, f.iris, 1, 0.75);
  g.globalCompositeOperation = 'source-over';
  for (const x of [462, 560]) { soft(x, 452, 5.5, 4, mix(f.iris, 0x000000, 0.35), 0.35, 0.3); soft(x, 452, 1.8, 1.8, 0x080606, 0.8, 0.5); }
  if (f.liner) { g.strokeStyle = 'rgba(20,10,12,.85)'; g.lineWidth = 1.8;
    for (const [x, s] of [[462, -1], [560, 1]]) { g.beginPath(); g.moveTo(x - s * 21, 452); g.quadraticCurveTo(x, 441, x + s * 21, 448); g.lineTo(x + s * 26, 444); g.stroke(); } }
  // 7. freckles, blush, a mole
  if (f.freckles) for (let i = 0; i < 70; i++) { const x = 432 + r() * 156, y = 468 + r() * 44; if (Math.abs(y - 452) < 12) continue;
    g.fillStyle = rgba(shade(0x8a5a3a), 0.3 + r() * 0.3); g.beginPath(); g.arc(x, y, 0.7 + r() * 0.9, 0, 7); g.fill(); }
  if (f.blush) for (const x of [440, 580]) soft(x, 508, 26, 15, 0xe0707a, 0.2);
  if (f.mole) { g.fillStyle = rgba(shade(0x46281a), 0.85); g.beginPath(); g.arc(f.mole[0], f.mole[1], 1.8, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(c), o = head.material.map;
  tex.flipY = o.flipY; tex.colorSpace = o.colorSpace; tex.wrapS = o.wrapS; tex.wrapT = o.wrapT; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}
// where facial hair grows, in the face texture's layout (1024: mouth 510,547, chin 510,602): alpha = how much hair, every
// edge soft, the lips always clear. col: painted in that colour (the skin's shadow); without: white (the fur's density)
const beardCache = {};
function beardMask(style, col, size) {
  const key = style + ':' + (col === undefined ? 'd' : col) + ':' + (size || 512); if (beardCache[key]) return beardCache[key];
  const S = size || 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), k = S / 1024;
  g.scale(k, k); g.filter = 'blur(' + Math.round(9 * k * 2) / 2 + 'px)'; g.fillStyle = col === undefined ? '#fff' : rgba(col, 1);
  const ell = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
  if (style === 'beard' || style === 'stubble') {            // (cheeks, jaw, chin and under it; thinner high on the cheeks)
    const top = style === 'stubble' ? 492 : 476;
    g.beginPath(); g.moveTo(414, top); g.quadraticCurveTo(440, 498, 470, 508); g.quadraticCurveTo(510, 516, 550, 508); g.quadraticCurveTo(580, 498, 606, top);
    g.lineTo(612, 560); g.quadraticCurveTo(600, 650, 510, 680); g.quadraticCurveTo(420, 650, 408, 560); g.closePath(); g.fill();
  }
  if (style === 'moustache' || style === 'goatee') ell(510, 528, 33, 10);
  if (style === 'goatee') { ell(510, 588, 27, 30); g.fillRect(492, 560, 36, 24); }
  g.filter = 'none'; g.globalCompositeOperation = 'destination-out';
  g.filter = 'blur(' + Math.round(3 * k * 2) / 2 + 'px)'; ell(510, 549, 31, 9);                    // (the lips)
  if (style !== 'stubble') { g.fillStyle = 'rgba(0,0,0,0.5)'; ell(510, 508, 16, 6); }              // (under the nose: thinner)
  beardCache[key] = c; return c;
}
// a ring (a torus), for the glasses' rims (the game's three.js build has no TorusGeometry). arc: how much of the circle
function ringGeo(THREE, R, r, seg, tube, arc) {
  const pos = [], nor = [], ind = [], A = arc || Math.PI * 2, closed = !arc;
  for (let i = 0; i <= seg; i++) { const u = i / seg * A, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= tube; j++) { const v = j / tube * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
      pos.push((R + r * cv) * cu, (R + r * cv) * su, r * sv); nor.push(cv * cu, cv * su, sv); } }
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) { const a = i * (tube + 1) + j, b = a + tube + 1; ind.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(ind);
  return g;
}
// a thin bar from point a to point b (for the glasses' arms)
function bar(THREE, mat, a, b, t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), m = new THREE.Mesh(new THREE.BoxGeometry(t, t * 1.2, A.distanceTo(B)), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5); m.lookAt(B); return m;
}
// glasses: thin frames on the head bone, in front of the eyes (built in the head mesh's space: metres at rest, facing +z)
function makeGlasses(THREE, f, head, bone) {
  const G = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: f.glasses.col, metalness: 0.4, roughness: 0.45 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xd8e4ff, transparent: true, opacity: 0.1, depthWrite: false });
  for (const s of [-1, 1]) {
    const rim = f.glasses.round ? ringGeo(THREE, 0.0165, 0.0014, 24, 6) : ringGeo(THREE, 0.019, 0.0016, 4, 4);
    const m = new THREE.Mesh(rim, mat); m.position.set(s * 0.0335, 1.469, 0.137); if (!f.glasses.round) { m.rotation.z = Math.PI / 4; m.scale.set(1.05, 0.72, 1); } G.add(m);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 16), lensMat); lens.position.copy(m.position); if (!f.glasses.round) lens.scale.set(1.1, 0.8, 1); G.add(lens);
    // the arms: from the rim, round the side of the head (7 mm clear of it), to just in front of the ear
    G.add(bar(THREE, mat, [s * 0.0495, 1.4705, 0.137], [s * 0.066, 1.4712, 0.105], 0.0026));
    G.add(bar(THREE, mat, [s * 0.066, 1.4712, 0.105], [s * 0.08, 1.4702, 0.036], 0.0022));
  }
  const bridge = new THREE.Mesh(ringGeo(THREE, 0.009, 0.0012, 10, 5, Math.PI), mat); bridge.position.set(0, 1.473, 0.14); G.add(bridge);
  // put it on the head bone, where the eyes are (the figure is still at rest here)
  head.updateMatrixWorld(true);
  const wm = head.matrixWorld.clone(), inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
  G.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, wm));
  bone.add(G); G.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  return G;
}
// facial hair: the face's fur, shaped like this face (shapeHead), as long as the style (stubble: a fraction of a millimetre)
const BEARD = { stubble: [0.0009, 4, 0, 0.32], moustache: [0.0055, 10, 0, 1], goatee: [0.0065, 10, 0, 1], beard: [0.009, 12, 0, 1] };   // (length, layers, scalp fill, how many hairs)
function faceFur(THREE, mesh, f, look) {
  const B = BEARD[f.beard]; if (!B) { mesh.visible = false; return null; }
  const g = mesh.geometry.clone(); shapeHead(g, f);
  const stack = furGeometry(THREE, g, B[0], B[1]); furStacks.delete(g); g.dispose(); stack.userData.shared = false;
  const tex = new THREE.CanvasTexture(beardMask(f.beard)); tex.flipY = false; tex.anisotropy = 4;
  const col = new THREE.Color(f.hair).multiplyScalar(f.beard === 'stubble' ? 0.8 : 1.15);
  mesh.geometry = stack; mesh.material = furMaterial(THREE, { map: tex }, col, B[2], B[3]); mesh.castShadow = false; mesh.visible = true;
  return { geo: stack, tex };
}
// glasses (made in Blender, tools/blender/player_glasses.py): the pair chosen, in its colour, moved with the face's shape
// (where this face's nose bridge ended up)
function wearGlasses(THREE, meshes, f) {
  const kind = f.glasses ? (f.glasses.round ? 'Round' : 'Square') : null, out = [];
  for (const k of ['Round', 'Square']) for (const n of ['Glasses' + k, 'GlassesLens' + k]) if (meshes[n]) meshes[n].visible = k === kind;
  if (!kind) return null;
  const probe = new THREE.BufferGeometry(); probe.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.469, 0.134, 0.035, 1.469, 0.117], 3));
  shapeHead(probe, f); const P = probe.attributes.position, dz = Math.max(P.getZ(0) - 0.134, P.getZ(1) - 0.117), dy = P.getY(0) - 1.469; probe.dispose();
  for (const n of ['Glasses' + kind, 'GlassesLens' + kind]) {
    const m = meshes[n], g = m.geometry.clone(); g.translate(0, dy, dz); m.geometry = g; out.push(g);
    if (n.startsWith('GlassesLens')) m.material = new THREE.MeshStandardMaterial({ color: 0xeef3ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.14,
      depthWrite: false, side: THREE.DoubleSide });
    else { m.material.color.set(f.glasses.col); m.material.roughness = kind === 'Round' ? 0.28 : 0.35; m.material.metalness = kind === 'Round' ? 0.85 : 0; }
    m.castShadow = false;
  }
  return out;
}
// give a figure its own face (meshes: its parts by name, seed: the player's id)
function makeFace(THREE, meshes, bone, f, seed) {
  const head = meshes.Head, sc = meshes.HairCap ? scalpVerts(head.geometry, meshes.HairCap) : null;
  head.geometry = head.geometry.clone(); shapeHead(head.geometry, f);
  head.material.map = paintFace(THREE, head, sc, f, seed);
  head.material.color.set(0xffffff);                                                   // (the skin tone is in the picture now)
  if (head.material.normalScale) head.material.normalScale.set(0.45, 0.45);           // (her own skin detail, only a little)
  head.material.needsUpdate = true;
  const glasses = f.glasses && bone && !meshes.GlassesRound ? makeGlasses(THREE, f, head, bone) : null;   // (the old model: glasses built here)
  return { glasses, geo: head.geometry, tex: head.material.map };
}

/* ---------- your own look (the profile: js/account.js) ----------
   A look: { seed (the face), shirt, pants, shoes, hair (colours), skin, eyes, hairStyle, beard, glasses, body, freckles,
   makeup, height }. Looks arrive from other players too, so they're always cleaned up (sanitizeLook) before use. */
const LOOK_OPTIONS = {
  shirt: [0x2d4f96, 0x93302c, 0x2f6e48, 0x9b7526, 0x5a3a7a, 0x1d1d1f, 0xd8d4cc, 0x7a7a7a, 0xc86a2a, 0x2a7a8a, 0xc04a7a, 0x6a4a2a],
  pants: [0x1b2640, 0x19191b, 0x5b5240, 0x3a3d44, 0x2a4a7a, 0x6a2a2a, 0x4a5a3a, 0xc8c0b0],
  shoes: [0x161616, 0x241b14, 0xd8d8d8, 0x7a2a2a, 0x2a3a6a, 0x5a4a3a],
  hair: HAIRS.concat([0x8a8a86, 0xb4b2ac, 0x2a4aa8, 0xc0508a, 0x7a2a9a]),
  skin: SKINS, eyes: [0x5a3a1e, 0x3b2412, 0x6b4a2a, 0x2f5d8a, 0x4a7fa8, 0x4f7a4a, 0x7a6a3a, 0x5f6a70],
  hairStyle: ['buzz', 'short', 'bob', 'long', 'ponytail', 'bun', 'curly'], beard: ['none', 'stubble', 'beard', 'moustache', 'goatee'], glasses: ['none', 'round', 'square'],
  top: ['tee', 'long', 'hoodie'], bottom: ['trousers', 'shorts', 'skirt'],
  body: ['a', 'b'], height: [1.02, 1.18] };
// (the meshes in models/player.glb for each choice: the hair close to the head (Fur*), the longer strands, a hair tie)
const TOP_MESH = { tee: 'Tee', long: 'LongTop', hoodie: 'Hoodie' }, BOTTOM_MESH = { trousers: 'Trousers', shorts: 'ShortPants', skirt: 'Skirt' };
const HAIR_MESH = { buzz: ['FurBuzz'], short: ['FurShort', 'HairShort'], bob: ['FurPart', 'HairBob'], long: ['FurPart', 'HairLong'],
  ponytail: ['FurPony', 'HairPony', 'HairTie'], bun: ['FurBun', 'HairBun', 'HairTieBun'], curly: ['FurCurly', 'HairCurly'] };
const HAIR_PARTS = [...new Set(Object.values(HAIR_MESH).flat())];
/* ---------- short hair as real hairs (tools/blender/player_fur.py): the scalp in the file, stacked here into layers a
   fraction of a millimetre apart; every hair a column through them that thins to its tip (textures/hair_fur.webp: colour =
   how light the hair is, alpha = how far it stands out), leaning the way it grows (UV1 at the root, UV2 at the tip).
   The scalp texture's alpha (UV0) says how much hair there is: full inside, thinning out at the hairline. */
// (how long, how many layers, how much the scalp between the hairs is covered: a buzz cut shows the skin)
const FUR = { FurBuzz: [0.0035, 12, 0, 0.78], FurShort: [0.008, 14, 0.6], FurPony: [0.003, 12, 1], FurBun: [0.003, 12, 1], FurPart: [0.003, 10, 1], FurCurly: [0.006, 12, 1] };
const furStacks = new WeakMap();
function furGeometry(THREE, g, h, n, fill) {
  if (furStacks.has(g)) return furStacks.get(g);
  const out = new THREE.BufferGeometry(), cnt = g.attributes.position.count, N = g.attributes.normal;
  for (const [name, a] of Object.entries(g.attributes)) {
    const k = a.itemSize, arr = new Float32Array(cnt * k * n);
    for (let L = 0; L < n; L++) for (let i = 0; i < cnt; i++) for (let c = 0; c < k; c++) arr[(L * cnt + i) * k + c] = a.getComponent(i, c);
    if (name === 'position') for (let L = 0; L < n; L++) { const d = h * L / (n - 1);
      for (let i = 0; i < cnt; i++) { const o = (L * cnt + i) * 3; arr[o] += N.getX(i) * d; arr[o + 1] += N.getY(i) * d; arr[o + 2] += N.getZ(i) * d; } }
    out.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  const lay = new Float32Array(cnt * n); for (let L = 0; L < n; L++) lay.fill(L / (n - 1), L * cnt, (L + 1) * cnt);
  out.setAttribute('_layer', new THREE.BufferAttribute(lay, 1));
  const idx = g.index.array, ind = new Uint32Array(idx.length * n);
  for (let L = 0; L < n; L++) for (let i = 0; i < idx.length; i++) ind[L * idx.length + i] = idx[i] + L * cnt;
  out.setIndex(new THREE.BufferAttribute(ind, 1)); out.userData.shared = true;
  furStacks.set(g, out); return out;
}
let furTex = null;
const furUniform = { value: null };
function furTexture(THREE) {
  if (furTex) return furUniform;
  const c = document.createElement('canvas'); c.width = c.height = 1;            // (until the picture loads: no hairs)
  furTex = new THREE.CanvasTexture(c); furUniform.value = furTex;
  const img = new Image();
  img.onload = () => { const t = new THREE.CanvasTexture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = '';
    t.premultiplyAlpha = false; t.anisotropy = 4; furUniform.value = t; };
  img.src = 'textures/hair_fur.webp';
  return furUniform;
}
// the highlight hair has (Kajiya-Kay): a band across the strands, from the strand's direction (worked out per pixel from how
// its texture coordinates run: hUV, and the direction along them: hDir), a bright one and a second one in the hair's colour a
// little lower, only as strong as the light that actually reaches it
const HAIR_SHEEN = (hUV, hDir, amount) => [
  'vec3 hq0 = dFdx( -vViewPosition ), hq1 = dFdy( -vViewPosition );', 'vec2 hs0 = dFdx( ' + hUV + ' ), hs1 = dFdy( ' + hUV + ' );', 'vec2 hD = ' + hDir + ';',
  'vec3 hN = normalize( normal ), hTu = cross( hq1, hN ) * hs0.x + cross( hN, hq0 ) * hs1.x, hTv = cross( hq1, hN ) * hs0.y + cross( hN, hq0 ) * hs1.y;',
  'vec3 hB = normalize( hTu * hD.x + hTv * hD.y + 1e-6 );',
  'vec3 hV = normalize( vViewPosition ), hL = normalize( vec3( 0.25, 0.75, 0.6 ) );',
  'float hT1 = dot( hB, normalize( hL + hV ) ), hT2 = dot( hB, normalize( hL + hV + hN * 0.35 ) );',
  'float hS = pow( max( 0.0, sqrt( max( 0.0, 1.0 - hT1 * hT1 ) ) ), 80.0 ) * 0.16 + pow( max( 0.0, sqrt( max( 0.0, 1.0 - hT2 * hT2 ) ) ), 20.0 ) * 0.1;',
  'float hLit = dot( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3( 0.3, 0.59, 0.11 ) ) / max( 0.05, dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) );',
  'outgoingLight += sheenTint * hS * ' + amount + ' * clamp( hLit, 0.0, 2.0 ) * diffuseColor.a;'].join('\n');
// hair cards: a neutral strand texture, cut out with soft edges (no sorting), lit like hair: besides the usual light, the
// highlight that runs across the strands (Kajiya-Kay: from the strand's direction, the cards' UV v, worked out per pixel), a
// bright one and a second one in the hair's own colour a little lower, only as strong as the light that actually reaches it
function hairCardMaterial(THREE, src, hair) {
  const col = new THREE.Color(hair), m = new THREE.MeshStandardMaterial({ map: src.map, vertexColors: src.vertexColors, color: col.clone().multiplyScalar(1.1),
    alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.sheenTint = { value: col.clone().lerp(new THREE.Color(0xffffff), 0.18) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 sheenTint;')
      .replace('#include <opaque_fragment>', '#ifdef USE_MAP\n' + HAIR_SHEEN('vMapUv', 'vec2( 0.0, 1.0 )', '1.0') + '\n#endif\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'haircard';
  return m;
}
function furMaterial(THREE, src, color, fill, many) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, color, roughness: 0.72, metalness: 0 });
  m.userData.furTop = { value: 1 };                 // (the highest layer drawn: lower for someone far away, where it can't be seen)
  const fu = furTexture(THREE);
  m.onBeforeCompile = sh => {
    sh.uniforms.sheenTint = { value: color.clone().lerp(new THREE.Color(0xffffff), 0.25) };
    sh.uniforms.furMap = fu; sh.uniforms.furFill = { value: fill }; sh.uniforms.furTop = m.userData.furTop; sh.uniforms.furMany = { value: many === undefined ? 1 : many }; sh.uniforms.furVar = { value: many === undefined ? 0.65 : many < 0.5 ? 0.35 : 0.7 };   // (scalp hair; stubble; beards and a buzz cut)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float _layer;\nvarying float vLayer;\nvarying vec2 vFurRoot;\nvarying vec2 vFurTip;\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\n#ifndef USE_UV2\nattribute vec2 uv2;\n#endif')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayer = _layer; vFurRoot = uv1; vFurTip = uv2;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 sheenTint;\nuniform sampler2D furMap;\nuniform float furFill;\nuniform float furTop;\nuniform float furMany;\nuniform float furVar;\nvarying float vLayer;\nvarying vec2 vFurRoot;\nvarying vec2 vFurTip;')
      .replace('#include <map_fragment>', [
        '#ifdef USE_MAP', 'float dens = texture2D( map, vMapUv ).a;', '#else', 'float dens = 1.0;', '#endif',
        'vec4 fr = texture2D( furMap, mix( vFurRoot, vFurTip, vLayer ) );',
        'float hh = fr.a * step( fract( fr.r * 17.0 ), dens * furMany ) * ( 0.45 + 0.55 * smoothstep( 0.2, 0.9, dens ) );',   // (fewer and shorter hairs at the hairline)
        'if ( vLayer < 0.001 ) { if ( hh < 0.04 && ( dens < 0.92 || furFill < 0.5 ) ) discard; }',   // (the scalp: the hairs\' roots; covered between them too where the hair is thick)
        'else if ( hh < vLayer * 0.97 + 0.02 || vLayer > furTop ) discard;',
        'diffuseColor.rgb *= ( 1.0 - furVar * 0.75 + furVar * fr.r ) * mix( 0.5, 1.05, vLayer );'].join('\n'))   // (darker down among the roots)
      .replace('#include <opaque_fragment>', HAIR_SHEEN('vFurRoot', 'normalize( vFurTip - vFurRoot + vec2( 0.0, 1e-5 ) )', '( 0.4 + 0.6 * vLayer )') + '\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'fur';
  return m;
}
// a random look (a new guest, "Randomize"): the face from the seed, and clothes to go with it
function randomLook(seed) {
  const f = faceSpec(seed), r = rng(seed + ':clothes'), pick = a => a[r() * a.length | 0], O = LOOK_OPTIONS;
  return { v: 1, seed: String(seed), shirt: pick(O.shirt), pants: pick(O.pants), shoes: pick(O.shoes), hair: f.hair, skin: f.skin, eyes: f.iris,
    hairStyle: f.masc ? pick(['buzz', 'short', 'short', 'curly', f.long ? 'long' : 'short']) : f.long ? pick(['long', 'long', 'bob', 'ponytail', 'bun', 'curly']) : pick(['bob', 'short', 'ponytail', 'bun']),
    beard: f.beard, glasses: f.glasses ? (f.glasses.round ? 'round' : 'square') : 'none',
    top: pick(O.top), bottom: f.masc ? pick(['trousers', 'trousers', 'shorts']) : pick(O.bottom),
    body: f.masc ? 'b' : 'a', freckles: !!f.freckles, makeup: !!f.liner, height: +f.scale.toFixed(3) };
}
function sanitizeLook(l) {
  const O = LOOK_OPTIONS, o = l && typeof l === 'object' && !Array.isArray(l) ? l : {};
  const seed = String(o.seed || '').replace(/[^\w-]/g, '').slice(0, 40) || 'look', def = randomLook(seed);
  const col = (v, d) => Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : d, one = (v, list, d) => list.includes(v) ? v : d;
  return { v: 1, seed, shirt: col(o.shirt, def.shirt), pants: col(o.pants, def.pants), shoes: col(o.shoes, def.shoes), hair: col(o.hair, def.hair),
    skin: one(o.skin, O.skin, def.skin), eyes: one(o.eyes, O.eyes, def.eyes), hairStyle: one(o.hairStyle, O.hairStyle, def.hairStyle),
    beard: one(o.beard, O.beard, def.beard), glasses: one(o.glasses, O.glasses, def.glasses), body: one(o.body, O.body, def.body),
    freckles: typeof o.freckles === 'boolean' ? o.freckles : def.freckles, makeup: typeof o.makeup === 'boolean' ? o.makeup : def.makeup,
    top: one(o.top, O.top, def.top), bottom: one(o.bottom, O.bottom, def.bottom),
    height: Number.isFinite(o.height) ? Math.min(O.height[1], Math.max(O.height[0], o.height)) : def.height };
}
// the face for a look: made from its seed, then everything you chose on top
function faceForLook(L) {
  const f = faceSpec(L.seed);
  Object.assign(f, { skin: L.skin, hair: L.hair, long: L.hairStyle === 'long', scale: L.height, flat: L.body === 'a' ? 0.62 : 0.2, masc: L.body === 'b',
    iris: L.eyes, beard: L.beard, glasses: L.glasses === 'none' ? null : { round: L.glasses === 'round', col: (f.glasses && f.glasses.col) || 0x151515 },
    freckles: L.freckles, liner: L.makeup, blush: L.makeup, shadow: L.makeup ? (f.shadow || 0x6a4a60) : 0 });
  return f;
}

function createHuman(THREE, opts) {
  // opts.look: a look someone made (their profile); otherwise a face from opts.face (their id) and clothes by lobby slot
  const slot = (opts.slot || 0) % 4, L = opts.look ? sanitizeLook(opts.look) : null, seed = L ? L.seed : String(opts.face || 'slot' + slot);
  const face = L ? faceForLook(L) : faceSpec(seed);
  // (the clothes still go by lobby slot, so the four of you stay easy to tell apart; everything else is the face's)
  const look = Object.assign({}, LOOKS[slot], { hair: face.hair, skin: face.skin, long: face.long, scale: face.scale, flat: face.flat },
    L ? { jacket: L.shirt, pants: L.pants, shoe: L.shoes, top: L.top, bottom: L.bottom, hairStyle: L.hairStyle }
      : { top: ['long', 'tee', 'hoodie', 'long'][slot], bottom: 'trousers', hairStyle: face.long ? 'long' : 'short' });
  const model = THREE.cloneSkinned(opts.template);
  model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.setScalar(look.scale);
  // (her eye glow isn't theirs; collect first, then remove: removing while walking the tree skips and breaks)
  const sprites = []; model.traverse(o => { o.visible = true; if (o.isSprite) sprites.push(o); });
  sprites.forEach(o => o.parent.remove(o));
  const meshes = {};
  model.traverse(o => { if (o.isMesh) { meshes[o.name] = o; o.material = o.material.clone(); o.castShadow = true; o.frustumCulled = false; } });
  // models/player.glb (made in Blender: tools/blender/) has real clothes and hair to choose from; the older model only her
  // top and shorts, with trousers and sleeves painted on
  const dressed = !!meshes.Tee;
  if (meshes.Body) { zoneBody(THREE, meshes.Body); dressBody(THREE, meshes.Body.material, look, dressed); meshes.Body.material.color.set(look.skin); }
  if (meshes.Head) meshes.Head.material.color.set(look.skin);
  if (dressed) {
    const top = TOP_MESH[look.top] || 'Tee', bottom = BOTTOM_MESH[look.bottom] || 'Trousers', hair = HAIR_MESH[look.hairStyle] || HAIR_MESH.short;
    for (const n of [...Object.values(TOP_MESH), ...Object.values(BOTTOM_MESH)]) if (meshes[n]) meshes[n].visible = n === top || n === bottom;
    for (const n of HAIR_PARTS) if (meshes[n]) meshes[n].visible = hair.includes(n);
    if (meshes.Hair) meshes.Hair.visible = false;
    if (meshes.Top) meshes.Top.visible = false;
    if (meshes.Shorts) meshes.Shorts.visible = false;   // (her old shorts: not worn any more, not even under a skirt)
    if (meshes.BodyFill) { const m = meshes.BodyFill.material;   // (the body texture's average skin, tinted like the body; never drawn under the clothes)
      m.color.set(look.skin).multiply(new THREE.Color().setRGB(0.345, 0.259, 0.235, THREE.SRGBColorSpace));
      const legTo = look.bottom === 'trousers' ? 0.13 : look.bottom === 'shorts' ? 0.6 : 9;
      m.onBeforeCompile = sh => { sh.uniforms.uLegTo = { value: legTo };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRest = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nuniform float uLegTo;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n  if (vRest.y > 0.86 && vRest.y < 1.215 && abs(vRest.x) < 0.17) discard;\n  if (vRest.y < 0.96 && vRest.y > uLegTo && abs(vRest.x) < 0.2) discard;'); };
      m.customProgramCacheKey = () => 'fill' + legTo; }
    const cloth = (m, c) => { if (!m) return; m.material.color.set(c); m.material.side = THREE.DoubleSide; };   // (both sides: you can see into a sleeve)
    cloth(meshes[top], look.jacket); cloth(meshes[bottom], look.pants); cloth(meshes.Sneakers, look.shoe);
    for (const n of HAIR_PARTS) { const o = meshes[n]; if (!o || !o.visible) continue;
      if (FUR[n]) { o.geometry = furGeometry(THREE, o.geometry, FUR[n][0], FUR[n][1]); o.material = furMaterial(THREE, o.material, new THREE.Color(look.hair), FUR[n][2], FUR[n][3]); o.castShadow = false; }
      else if (n.startsWith('HairTie')) o.material.color.set(0x0c0c0e);
      else { const g = o.material; o.material = hairCardMaterial(THREE, g, look.hair); g.dispose(); }
    }
    if (meshes.HairCap) meshes.HairCap.visible = false;
  } else {
    if (meshes.Top) recolor(THREE, meshes.Top.material, look.jacket, 1);
    if (meshes.Shorts) recolor(THREE, meshes.Shorts.material, look.pants, 1);
    if (meshes.Hair) { recolor(THREE, meshes.Hair.material, look.hair, 2); meshes.Hair.visible = look.long; }
    if (meshes.HairCap) recolor(THREE, meshes.HairCap.material, look.hair, 2);
  }
  const bone = n => model.getObjectByName(n);
  for (const n of ['breastL', 'breastR']) { const b = bone(n); if (b) b.scale.setScalar(look.flat); }
  const own = meshes.Head ? makeFace(THREE, meshes, bone('head'), face, seed) : null;
  const beardFur = meshes.FurFace ? faceFur(THREE, meshes.FurFace, face, look) : null;
  const specs = meshes.GlassesRound ? wearGlasses(THREE, meshes, face) : null;
  model.updateMatrixWorld(true);
  for (const n of ['footL', 'footR', 'toe1-1L', 'toe1-1R', 'toe3-1L', 'toe3-1R', 'toe5-1L', 'toe5-1R']) { const b = bone(n); if (b) b.userData.restY = b.getWorldPosition(new THREE.Vector3()).y; }
  const anim = window.BarbiAnim.build(THREE, model, { mocap: opts.mocap, scale: look.scale, set: 'player', maxTime: 2.2 });
  const root = new THREE.Group(); root.add(model);

  // the flashlight in the right hand (the bone's +Y runs along the hand, towards the fingers)
  const hand = bone('wristR'), k = 1 / look.scale;
  const torch = new THREE.Group(); torch.position.set(0, 0.05 * k, 0.025 * k); torch.rotation.x = -Math.PI / 2; torch.scale.setScalar(k);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.7, roughness: 0.35 }));
  tube.rotation.x = Math.PI / 2; tube.castShadow = true; torch.add(tube);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d0).multiplyScalar(3) }));
  lens.position.z = 0.081; torch.add(lens);
  const light = new THREE.SpotLight(0xffe0b0, 14, 13, 0.5, 0.6, 1.0);
  light.position.set(0, 0, 0.085); light.target.position.set(0, 0, 5); torch.add(light, light.target);
  if (hand) hand.add(torch); else root.add(torch);

  // nametag above the head
  const tagCv = document.createElement('canvas'); tagCv.width = 512; tagCv.height = 128;
  const tagTex = new THREE.CanvasTexture(tagCv); tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false, fog: false }));
  const tagH = 1.62 * look.scale + 0.3;
  tag.scale.set(1.0, 0.25, 1); tag.position.y = tagH; tag.renderOrder = 5; root.add(tag);
  let tagText = '';
  function setName(text, alarm) {
    const key = text + '|' + (alarm ? 1 : 0); if (key === tagText) return; tagText = key;
    const g = tagCv.getContext('2d'); g.clearRect(0, 0, 512, 128);
    g.font = '600 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.min(500, g.measureText(text).width + 44);
    g.fillStyle = 'rgba(8,10,20,.62)'; const x = 256 - w / 2;
    g.beginPath(); if (g.roundRect) g.roundRect(x, 20, w, 88, 26); else g.rect(x, 20, w, 88); g.fill();
    g.fillStyle = alarm ? '#ff6b6b' : TAGS[slot]; g.fillText(text, 256, 66, 480);
    tagTex.needsUpdate = true;
  }
  setName(opts.name || 'Player');

  // after the animation: tilt the head and the flashlight arm with where the player looks
  const head = bone('head'), arm = bone('upperarm01R'), _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _ax = new THREE.Vector3();
  const _r = new THREE.Quaternion();
  function turnWorld(b, axis, ang) {
    if (!b) return;
    b.parent.getWorldQuaternion(_p); b.getWorldQuaternion(_q);
    _q.premultiply(_r.setFromAxisAngle(axis, ang));
    b.quaternion.copy(_p.invert().multiply(_q));
  }
  let fall = 0;
  // hidden (in a wardrobe) or away: hide the body and the nametag, but keep the flashlight in the scene (at 0).
  // (turning a light off changes how many lights there are, and that makes every material recompile: a stutter)
  let shown = true;
  function showParts(v) { if (v === shown) return; shown = v;
    root.traverse(o => { if (o.isMesh || o.isSprite) { if (o.userData.vis0 === undefined) o.userData.vis0 = o.visible; o.visible = v && o.userData.vis0; } }); }
  // (detail by distance: someone more than 4 m away keeps only the lower layers of their short hair and beard)
  const furMats = []; root.traverse(o => { if (o.material && o.material.userData && o.material.userData.furTop) furMats.push(o.material.userData.furTop); });
  function update(dt, s) {
    if (s.camDist !== undefined) { const top = s.camDist > 4 ? 0.4 : 1; for (const u of furMats) u.value = top; }
    showParts(!(s.hidden || s.away));
    light.intensity = s.dead || s.hidden || s.away || s.lightOn === false ? 0 : 14;
    const v = s.speed || 0, lying = s.down || s.dead;
    fall += ((lying ? 1 : 0) - fall) * Math.min(1, dt * 6);
    tag.position.y = tagH - (tagH - 0.75) * fall;
    let clip = v < 0.35 ? (s.stand && anim.actions.p_stand ? 'p_stand' : 'p_idle') : v < 2.4 ? 'p_walk' : v < 5.4 ? 'p_jog' : 'p_run';   // (stand: calm, for the profile and the lobby)
    const dancing = !!s.dance && !lying && v < 1.2 && !!anim.actions[s.dance];   // (a dance from the wheel, standing still)
    if (dancing) clip = s.dance;
    if (s.crouching && !lying && !dancing && anim.actions.p_crouch) clip = v < 0.2 ? 'p_crouch' : 'p_sneak';   // (crouching: low, creeping)
    if (lying) clip = s.dead ? 'p_dead' : 'p_down';
    anim.play(clip, lying ? 0.5 : 0.25); if (dancing) anim.setSpeed(0); else anim.setSpeed(v);
    anim.update(dt);
    ground(dt, lying);
    if (!lying && !dancing) {
      root.updateMatrixWorld(true);
      _ax.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
      const pitch = s.pitch || 0;
      turnWorld(arm, _ax, -pitch * 0.9); turnWorld(head, _ax, -pitch * 0.5);
    }
  }
  // Standing on the floor: the captured motion and the hand-made dances each hold the body at their own height, so every
  // frame the lowest foot is put on the floor (the feet's bones, less how high each sits above the sole at rest).
  // Lying down, a fixed height (the pose lies flat).
  const feet = ['footL', 'footR', 'toe1-1L', 'toe1-1R', 'toe3-1L', 'toe3-1R', 'toe5-1L', 'toe5-1R'].map(n => bone(n)).filter(Boolean), _gp = new THREE.Vector3();
  let lift = 0, restH = null;
  function ground(dt, lying) {
    if (!feet.length) return;
    root.updateMatrixWorld(true);
    const rootY = root.getWorldPosition(_gp).y;
    if (!restH) {                                       // (once: each bone's height above the lowest point of the body at rest)
      const body = meshes.Body; if (!body) return; body.geometry.computeBoundingBox();
      const floorY = body.geometry.boundingBox.min.y * look.scale;
      restH = feet.map(b => b.userData.restY - floorY);
    }
    let gap = Infinity;
    feet.forEach((b, i) => { gap = Math.min(gap, b.getWorldPosition(_gp).y - rootY - lift - restH[i]); });
    const want = lying ? -0.1 * look.scale : -gap;
    lift += (want - lift) * Math.min(1, dt * 14); model.position.y = lift;
  }
  function dispose() {
    root.traverse(o => { if (o.material) { if (o.isSprite && o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    tube.geometry.dispose(); lens.geometry.dispose();
    if (own) { own.geo.dispose(); own.tex.dispose(); if (own.glasses) own.glasses.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    if (beardFur) { beardFur.geo.dispose(); beardFur.tex.dispose(); }
    if (specs) specs.forEach(g => g.dispose());
  }
  return { obj: root, setName, update, light, dispose, anim, human: true, face, look };
}

window.PlayerModel = { create, createHuman, TAGS, faceSpec, LOOK_OPTIONS, sanitizeLook, randomLook, furUniform };
})();
