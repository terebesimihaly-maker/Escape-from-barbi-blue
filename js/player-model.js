/* Teammates in multiplayer.
   createHuman: a real human figure: the rigged model from models/barbi.glb (the same skeleton as hers), dressed
   differently for each player (jacket, trousers, hair, skin tone, height) and moved by motion capture
   (see js/barbi-anim.js). The right hand holds a flashlight that really lights the room, aimed where they look.
   create: a simple figure built from shapes, used only if the model file couldn't be loaded.
   Usage: const pm = PlayerModel.createHuman(THREE, { slot, name, template: gltf.scene, mocap }); scene.add(pm.obj);
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
  function update(dt, s) {
    root.visible = !s.hidden;
    breath += dt;
    const lying = s.down || s.dead;
    fall += ((lying ? 1 : 0) - fall) * Math.min(1, dt * 6);
    body.rotation.x = -Math.PI / 2 * fall; body.position.y = 0.16 * fall;
    tag.position.y = 2.08 - 1.45 * fall;                     // the nametag comes down with them
    light.visible = !s.dead && s.lightOn !== false;
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
function dressBody(THREE, mat, look) {
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
function createHuman(THREE, opts) {
  const slot = (opts.slot || 0) % 4, look = LOOKS[slot];
  const model = THREE.cloneSkinned(opts.template);
  model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.setScalar(look.scale);
  // (her eye glow isn't theirs; collect first, then remove: removing while walking the tree skips and breaks)
  const sprites = []; model.traverse(o => { o.visible = true; if (o.isSprite) sprites.push(o); });
  sprites.forEach(o => o.parent.remove(o));
  const meshes = {};
  model.traverse(o => { if (o.isMesh) { meshes[o.name] = o; o.material = o.material.clone(); o.castShadow = true; o.frustumCulled = false; } });
  if (meshes.Body) { zoneBody(THREE, meshes.Body); dressBody(THREE, meshes.Body.material, look); meshes.Body.material.color.set(look.skin); }
  if (meshes.Head) meshes.Head.material.color.set(look.skin);
  if (meshes.Top) recolor(THREE, meshes.Top.material, look.jacket, 1);
  if (meshes.Shorts) recolor(THREE, meshes.Shorts.material, look.pants, 1);
  if (meshes.Hair) { recolor(THREE, meshes.Hair.material, look.hair, 2); meshes.Hair.visible = look.long; }
  if (meshes.HairCap) recolor(THREE, meshes.HairCap.material, look.hair, 2);
  const bone = n => model.getObjectByName(n);
  for (const n of ['breastL', 'breastR']) { const b = bone(n); if (b) b.scale.setScalar(look.flat); }
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
  function turnWorld(b, axis, ang) {
    if (!b) return;
    b.parent.getWorldQuaternion(_p); b.getWorldQuaternion(_q);
    _q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
    b.quaternion.copy(_p.invert().multiply(_q));
  }
  let fall = 0;
  function update(dt, s) {
    root.visible = !s.hidden;
    light.visible = !s.dead && s.lightOn !== false;
    const v = s.speed || 0, lying = s.down || s.dead;
    fall += ((lying ? 1 : 0) - fall) * Math.min(1, dt * 6);
    tag.position.y = tagH - (tagH - 0.75) * fall;
    let clip = v < 0.35 ? 'p_idle' : v < 2.4 ? 'p_walk' : v < 5.4 ? 'p_jog' : 'p_run';
    if (lying) clip = s.dead ? 'p_dead' : 'p_down';
    anim.play(clip, lying ? 0.5 : 0.25); anim.setSpeed(v);
    anim.update(dt);
    if (!lying) {
      root.updateMatrixWorld(true);
      _ax.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
      const pitch = s.pitch || 0;
      turnWorld(arm, _ax, -pitch * 0.9); turnWorld(head, _ax, -pitch * 0.5);
    }
  }
  function dispose() {
    root.traverse(o => { if (o.material) { if (o.isSprite && o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    tube.geometry.dispose(); lens.geometry.dispose();
  }
  return { obj: root, setName, update, light, dispose, anim, human: true };
}

window.PlayerModel = { create, createHuman, TAGS };
})();
