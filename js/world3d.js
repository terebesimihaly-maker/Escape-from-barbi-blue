/* Escape from Barbi Blue: The 3D world: renderer, lights, post-processing, the title scene, and her 3D model and animation picking.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

/* ---------- rendering (3D, three.js) ---------- */
// The game logic still works in the flat world units above (a tile is T = 50 units, y runs down the map).
// The 3D world is in metres: world (x, y) sits at (x * S, height, y * S).
const S = 0.045, TILE_M = T * S, WALL_H = 3.0, EYE = 1.62, M_SCALE = 1.38;
const LOWQ = matchMedia('(pointer: coarse)').matches;
const FLASH_I = 25;
let renderer = null, scene, camera, flash, aura, exitLight, dustPts, glowTex, level = null;
let composer = null, renderPass = null, bloomPass = null, useBloom = false, flashCookie = null;
let titleScene, titleCam, titleLight, titleBulb, titleBulbLight, titleKey, titleAim = null, barbi = null, deathCam = null;
let mocapData = null, playerTemplate = null, playerTemplateLoad = null;   // (teammates in multiplayer: models/barbi.glb, the same skeleton as hers)
const HER_MODEL = 'models/character_mobile.glb', MATE_MODEL = 'models/player.glb', MATE_OLD = 'models/barbi.glb';   // (player.glb: made in Blender, tools/blender/)
let dust = [], prints = [], stepPhase = 0;
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function toTex(c, rep) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// deterministic per-tile randomness, so the textures of a floor are stable
function hash(x, y, k) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((k | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function init3D() {
  try { renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { renderer = null; return; }
  // (no waiting for each shader's error report: that holds the whole page, connection included, until the graphics driver has
  // finished compiling it, which on a slow device can take seconds; the character preview, js/account.js, still checks them)
  renderer.debug.checkShaderErrors = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  glowTex = glowTexture();
  // post-processing for the glow (bloom) on High: bright things like her eyes, fuses and lamps bleed light
  try {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new THREE.EffectComposer(renderer, rt);
    renderPass = new THREE.RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 1.05);
    composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(new THREE.OutputPass());
  } catch (e) { composer = null; }

  scene = new THREE.Scene(); scene.background = new THREE.Color(0x020205); scene.fog = new THREE.Fog(0x020205, 1.5, 16);
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 18); camera.rotation.order = 'YXZ'; scene.add(camera);   // (the fog hides everything past 16 m)
  scene.add(new THREE.HemisphereLight(0x4a5a8a, 0x140c0c, 0.3));
  // the flashlight is held low and to the right, so her shadow falls on the walls behind her
  flash = new THREE.SpotLight(0xffe0b0, FLASH_I, 22, 0.52, 0.55, 0.95);
  flash.position.set(0.2, -0.25, 0.1); flash.target.position.set(0.1, -0.4, -6);
  camera.add(flash); camera.add(flash.target);
  flash.castShadow = true; const sm = LOWQ ? 1024 : 2048; flash.shadow.mapSize.set(sm, sm); flash.shadow.radius = 2.5;
  // (the beam pattern is Medium and High only, like the shadow: applyQuality, js/core.js, switches it later)
  flashCookie = flashlightCookie(); flash.map = settings.quality !== 'low' ? flashCookie : null;
  { const i = new Image(); i.onload = () => { const t = new THREE.CanvasTexture(i); t.colorSpace = THREE.SRGBColorSpace; flashCookie = t; flash.map = settings.quality !== 'low' ? t : null; };   // (the real beam pattern: tools/blender/flashlight_cookie.py)
    i.src = 'textures/flashlight_cookie.webp'; }
  flash.shadow.camera.near = 0.25; flash.shadow.camera.far = 22; flash.shadow.bias = -0.0006; flash.shadow.normalBias = 0.03;
  aura = new THREE.PointLight(0x8595c8, 1.2, 4.5, 1.4); camera.add(aura);     // a little light around you, even in the wardrobe
  exitLight = new THREE.PointLight(0x50ff90, 0, 9, 1.3); scene.add(exitLight);

  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(50 * 3), 3));
  dg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(50 * 3), 3));
  dustPts = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.03, map: glowTex, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  dustPts.frustumCulled = false; scene.add(dustPts);

  // the title screen: something standing at the end of a dark hallway
  titleScene = new THREE.Scene(); titleScene.background = new THREE.Color(0x010104); titleScene.fog = new THREE.Fog(0x010104, 4, 13);
  titleCam = new THREE.PerspectiveCamera(40, 1, 0.1, 40);
  titleScene.add(new THREE.HemisphereLight(0x33406a, 0x080406, 0.6));
  titleLight = new THREE.SpotLight(0x86a8ff, 40, 12, 0.45, 0.7, 1.2); titleLight.position.set(0.6, 3.6, 1.2);
  titleLight.target.position.set(0, 0.8, -0.3); titleScene.add(titleLight, titleLight.target);
  // a hallway of the nursery: wallpaper, floorboards, a ceiling and a failing bulb above her
  const F = FLOORS[0], len = 30;
  const fc = mkCanvas(320, 320), fg = fc.getContext('2d'); fg.setTransform(4, 0, 0, 4, 0, 0);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) paintFloor(fg, F, x, y);
  const ft = toTex(fc, true); ft.repeat.set(2.2 / (TILE_M * 2), len / (TILE_M * 2));
  const tf = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), new THREE.MeshLambertMaterial({ map: ft, color: new THREE.Color().setScalar(1.8) }));
  tf.rotation.x = -Math.PI / 2; titleScene.add(tf);
  const wt = wallTexture(F); wt.repeat.set(len / TILE_M, 1);
  wt.userData.bump.repeat.copy(wt.repeat);
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_H), new THREE.MeshLambertMaterial({ map: wt, bumpMap: wt.userData.bump, bumpScale: 3 }));
    w.position.set(s * 1.1, WALL_H / 2, 0); w.rotation.y = -s * Math.PI / 2; titleScene.add(w); }
  const ct = ceilingTexture(F); ct.repeat.set(2, len / TILE_M);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), new THREE.MeshLambertMaterial({ map: ct }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; titleScene.add(ceil);
  const end = new THREE.Mesh(new THREE.PlaneGeometry(2.2, WALL_H), new THREE.MeshLambertMaterial({ map: wallTexture(F) }));
  end.position.set(0, WALL_H / 2, -6); titleScene.add(end);
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.56), new THREE.MeshLambertMaterial({ map: portraitTexture(true), emissiveMap: portraitEyes(), emissive: 0xffffff, emissiveIntensity: 2.5 }));
  pm.position.set(-1.085, 1.75, 1.2); pm.rotation.y = Math.PI / 2; titleScene.add(pm);
  titleBulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff0d0 }));
  titleBulb.position.set(0, WALL_H - 0.35, -1.6); titleScene.add(titleBulb);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  cord.position.set(0, WALL_H - 0.15, -1.6); titleScene.add(cord);
  titleBulbLight = new THREE.PointLight(0xffd9a0, 6, 7, 1.4); titleBulbLight.position.copy(titleBulb.position).y -= 0.1; titleScene.add(titleBulbLight);
  // a soft light on her face, so the close-up reads clearly
  titleKey = new THREE.SpotLight(0xffe4cc, 7, 5, 0.5, 0.9, 1.6); titleScene.add(titleKey, titleKey.target);
}

// what a real flashlight throws on a wall: a hot centre, a dimmer band, a faint outer ring, uneven edges
function flashlightCookie() {
  const n = 256, c = mkCanvas(n, n), g = c.getContext('2d'), r = n / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, '#fff'); gr.addColorStop(0.42, '#e0e0e0'); gr.addColorStop(0.6, '#c4c4c4');
  gr.addColorStop(0.74, '#d2d2d2'); gr.addColorStop(0.84, '#909090'); gr.addColorStop(0.97, '#303030'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  for (let k = 0; k < 60; k++) { const a = Math.random() * 6.283, d = r * (0.2 + Math.random() * 0.75);
    g.fillStyle = 'rgba(0,0,0,' + (0.03 + Math.random() * 0.05) + ')'; g.beginPath(); g.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, 4 + Math.random() * 14, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTexture() {
  const c = mkCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ---------- her: the 3D model with the procedural animations from js/barbi-anim.js ---------- */
function loadBarbi() {
  const btn = $('play');
  if (!renderer) { btn.disabled = true; btn.textContent = 'No 3D support';
    $('loadMsg').textContent = "This browser can't show 3D graphics (WebGL is off or not supported)."; return; }
  btn.disabled = true; btn.textContent = 'Loading…';
  const done = () => { btn.disabled = false; btn.textContent = 'Enter the house'; };
  // the motion capture loads next to the model (if it can't be loaded, the hand-made animations are used)
  const mocapLoad = fetch('models/mocap.json').then(r => r.ok ? r.json() : null).catch(() => null);
  new THREE.GLTFLoader().load(HER_MODEL, async gltf => {
    mocapData = await mocapLoad;
    try { setupBarbi(gltf.scene, BarbiAnim.build(THREE, gltf.scene, { mocap: mocapData, scale: M_SCALE })); }
    catch (e) { console.error(e); setupBarbi(standInDoll(), null); }
    done();
  }, e => { if (e.total) btn.textContent = 'Loading… ' + Math.round(e.loaded / e.total * 100) + '%'; },
  err => { console.error(err); setupBarbi(standInDoll(), null); done();
    $('loadMsg').textContent = "Couldn't load her model (" + HER_MODEL + "), so a stand-in is chasing you. The game has to be opened from a web server, not as a local file."; });
}
// a loader that can read the compressed models (tools/compress-glb.mjs: meshopt, decoded by lib/meshopt_decoder.js)
function gltfLoader() { const l = new THREE.GLTFLoader(); if (typeof MeshoptDecoder !== 'undefined') l.setMeshoptDecoder(MeshoptDecoder); return l; }
// the porcelain doll (models/doll.glb, made in Blender: tools/blender/doll.py). Its face is painted on in js/house.js, so the head
// gets UVs here: round the head from the front (the face covers the front 200 degrees; the back is under the bonnet)
let dollTemplate = null;
function loadDollTemplate() {
  if (dollTemplate !== null || !renderer) return; dollTemplate = false;
  gltfLoader().load('models/doll.glb', g => {
    const head = g.scene.getObjectByName('DollHead');
    if (head && head.geometry) {
      const pos = head.geometry.attributes.position, uv = new Float32Array(pos.count * 2), c = new THREE.Vector3(0, 0.045, 0), p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i).sub(c); const r = p.length() || 1;
        uv[i * 2] = 0.5 + Math.atan2(p.x, p.z) / (Math.PI * 200 / 180); uv[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, p.y / r))) / Math.PI; }
      head.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    dollTemplate = g.scene; }, undefined, e => { console.error(e); });
}
// the loose floorboards (models/boards.glb, made in Blender: tools/blender/boards.py): BoardShort and BoardLong (right across a corridor)
let boardsTemplate = null;
function loadBoardsTemplate() {
  if (boardsTemplate !== null || !renderer) return; boardsTemplate = false;
  gltfLoader().load('models/boards.glb', g => { g.scene.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } }); boardsTemplate = g.scene; },
    undefined, e => { console.error(e); });
}
// the portraits painted in Blender (tools/blender/paintings.py): three dolls, the changed one, the watcher (and where its eyes go)
let portraits = null;
function loadPortraits() {
  if (portraits !== null || !renderer) return; portraits = false;
  // (shared: every floor uses the same ones, so they aren't thrown away with a floor: disposeLevel, js/level.js)
  const img = n => new Promise(res => { const i = new Image(); i.onload = () => { const t = new THREE.CanvasTexture(i); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.shared = true; res(t); }; i.onerror = () => res(null); i.src = 'textures/portrait_' + n + '.webp'; });
  Promise.all(['a', 'b', 'c', 'changed', 'watch'].map(img).concat([fetch('textures/portrait_eyes.json').then(r => r.json()).catch(() => null)]))
    .then(([a, b, c, changed, watch, eyes]) => { if (a && b && c && changed && watch && eyes && eyes.eyes) portraits = { plain: [a, b, c], changed, watch, eyes: eyes.eyes }; });
}
// the teammates' model: only downloaded when you go to play together (single player never needs it)
function loadPlayerTemplate() {
  if (playerTemplateLoad || !renderer) return playerTemplateLoad;
  playerTemplateLoad = new Promise(res => { const load = (url, again) => gltfLoader().load(url, g => {
    // (as dark and matte as they always were: they used to share her materials, which setupBarbi darkens)
    g.scene.traverse(o => { if (o.isMesh && o.material && o.material.color) { o.material.color.multiplyScalar(0.72); if (o.material.roughness !== undefined) o.material.roughness = Math.max(o.material.roughness, 0.72); } });
    playerTemplate = g.scene; refreshAvatars(); res(); },
    undefined, e => { console.error(e); if (again) load(again); else res(); });   // (the new model missing: the old one)
    load(MATE_MODEL, MATE_OLD); });
  return playerTemplateLoad;
}
function setupBarbi(model, anim) {
  const obj = new THREE.Group(); obj.add(model);
  if (anim) model.scale.setScalar(M_SCALE);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false;
    // a little darker and less shiny, so the flashlight doesn't turn her white up close
    if (anim && o.material && o.material.color) { o.material.color.multiplyScalar(0.72); if (o.material.roughness !== undefined) o.material.roughness = Math.max(o.material.roughness, 0.72);
      // her light top: darker still and fully matte, or up close in the flashlight it turns into a white blur
      if (o.name === 'Top') { o.material.color.multiplyScalar(0.5); o.material.roughness = 0.95; if (o.material.metalness !== undefined) o.material.metalness = 0; } } } });
  // her eyes glow: if you can see them, she can see you
  const eyes = [];
  for (const n of ['eyeL', 'eyeR']) {
    const b = model.getObjectByName(n); if (!b) continue;
    // a wide, deep blue glow with a brighter blue core
    const k = b.getWorldScale(new THREE.Vector3()).x || 1;
    for (const [col, size, peak] of [[0x1a4dff, 0.19, 1], [0x5aa8ff, 0.06, 2.5]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(col).multiplyScalar(peak), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, depthTest: false, fog: false }));
      s.scale.setScalar(size / k); s.position.set(0, 0.025 / k, 0); s.renderOrder = 10; s.userData.base = size / k;
      b.add(s); eyes.push(s);
    }
  }
  barbi = { obj, model, eyes, anim: anim || { play() {}, setSpeed() {}, update() {}, current: '' } };
}
// if the model can't be loaded: a plain doll shape, so the game still works
function standInDoll() {
  const g = new THREE.Group(), skin = new THREE.MeshLambertMaterial({ color: 0xc9d6f2 });
  const dress = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.5, 12), new THREE.MeshLambertMaterial({ color: 0x2a4390 })); dress.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin); head.position.y = 1.9;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI * 2, 0, 1.9), new THREE.MeshLambertMaterial({ color: 0x07080f }));
  hair.position.y = 1.93; hair.rotation.x = -0.5;
  g.add(dress, head, hair);
  for (const s of [-1, 1]) { const e = new THREE.Object3D(); e.name = s < 0 ? 'eyeL' : 'eyeR'; e.position.set(s * 0.06, 1.92, 0.16); g.add(e); }
  return g;
}
function putBarbi(sc) { if (barbi && barbi.obj.parent !== sc) { sc.add(barbi.obj); for (const e of barbi.eyes) if (e.userData.base) e.scale.setScalar(e.userData.base); } }
function setEyes(a) { if (barbi) for (const e of barbi.eyes) { e.material.opacity = a; e.visible = a > 0.01; } }

// how far the right-hand door (as seen from inside) is open during the wardrobe scene: 0 shut, 1 wide open
function sceneDoor(t) {
  const ease = k => k * k * (3 - 2 * k);
  if (t < SC.open) return 0;
  if (t < SC.openEnd) return ease((t - SC.open) / (SC.openEnd - SC.open));
  if (t < SC.shut) return 1;
  return 1 - ease(clamp((t - SC.shut) / (SC.end - SC.shut - 0.1), 0, 1));
}
// where she stands during the scene, in world units in front of the wardrobe's centre (the doors are at -CLOSET_FRONT)
// (measured from the wardrobe's doors, so the scene looks the same whatever the tile size)
const SC_STAND_D = 13.3, SC_LEAN_D = 7.3;          // (+ CLOSET_FRONT, from js/level.js)
function sceneAlong(t, c) {
  if (t < 0) { let n = 0; while (n < 2 && !isWall(Math.floor(c.x / T) + c.ox * (n + 1), Math.floor(c.y / T) + c.oy * (n + 1))) n++;
    return CLOSET_FRONT + SC_STAND_D + (-t / 1.4) * n * T; }                                     // walking up to the doors
  const k = clamp((t - SC.lean) / (SC.leanEnd - SC.lean), 0, 1);
  return CLOSET_FRONT + SC_STAND_D + (SC_LEAN_D - SC_STAND_D) * k * k * (3 - 2 * k);                  // stepping in through the open door
}
// she moves over to the open door (on your right) while it swings open, and leans in through it
function sceneSide(t) { const k = clamp((t - SC.open) / (SC.lean + 0.3 - SC.open), 0, 1); return 9.5 * k * k * (3 - 2 * k); }
function startScream() {
  monster.screamT = 1.7;
  if (barbi) barbi.anim.play('scream', 0.15, true);
}
// pick her animation from what the AI is doing, and match it to how fast she really moves
function animateMonster(dt) {
  if (!barbi) return;
  const m = monster, a = barbi.anim;
  if (closetScene) {
    const t = closetScene.t;
    if (t < 0) { a.play('walk', 0.3); a.setSpeed(2); } else if (t < SC.lean) a.play('peek', 0.35); else a.play('lean', 0.7);
  }
  else if (scares.app && scares.app.anim) { a.play(scares.app.anim, 0.1); if (scares.app.anim === 'chase') a.setSpeed(7); }
  else if (scares.phantom) a.play('peek', 0.1);                 // the apparition at the end of the corridor (js/scares.js)
  else if (m.screamT > 0) a.play('scream', 0.15);
  else if (m.state === 'check' || m.state === 'lurk') a.play('peek', 0.4);   // at a wardrobe's doors, listening; or waiting around a corner
  else if (m.vel < 8) a.play('idle', 0.4);
  else { a.play(m.state === 'chase' ? 'chase' : m.state === 'hunt' ? 'run' : m.state === 'search' ? 'search' : 'walk', 0.3); a.setSpeed(m.vel * S); }
  a.update(dt);
}
