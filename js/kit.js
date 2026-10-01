/* Escape from Barbi Blue: the house kit (build spec B1-B8, C2, C5, E2, E4, E5, E7). Loads the Blender models of a floor's style
   (models/kit/<tier>/<style>.glb + common.glb, made by tools/blender/kit/) and furnishes a floor with them from its plan (js/dress.js).
   Nothing here decides WHERE anything goes: the boxes come from the floor's data (SOLIDS, js/layout.js) and everything else from
   Dress.plan, so every player sees the same house; the tier only changes how detailed the models are (H7).

   Loading (E4)
     Kit.want(style, tier?) -> Promise<kit | null>   load (once) a style's kit and the tier's common pieces; null if it can't be loaded
                                                     (a failed load is tried again on the next want). tier: 'lo' | 'md' | 'hi' (or
                                                     'low' | 'medium' | 'high'); left out: Kit.tierFor(settings.quality, LOWQ)
     Kit.preload(['common', style, ...], tier?)      several at once (Promise of them all; 'common' alone is allowed)
     Kit.ready(style, tier?) / Kit.get(style, tier?) loaded? / the kit (null when not loaded, or with ?kit=off in the URL)
     Kit.progress() -> 0..1                          bytes so far over everything asked for (sizes from models/kit/manifest.json)
     Kit.release(style)                              throw a style's kits away (every tier; 'common': the common pieces)
     Kit.evict(keep, tier)                           keep only those styles at that tier (Kit.furnish does it on floor entry: E5)
     Kit.tierFor(quality, lowq) -> 'lo' | 'md' | 'hi' low -> lo; medium -> md (lo on phones); high -> hi if MAX_TEXTURE_SIZE >= 8192
                                                     and deviceMemory >= 8 (and not a phone), else md
     A kit: { style, tier, nodes {name: template}, node(name), has(name), isPlaceholder(name) (manifest: a grey stand-in), scene, common }.
     Everything loaded is marked userData.kit / userData.shared (textures too), so disposeLevel never frees it; lights are stripped (H12);
     on lo the Standard materials become Lambert; every kit material gets MatLib.withLightField (C5) the first time a kit is used.

   Furnishing (E2 step 6)
     Kit.furnish(level, plan, opts?) -> R = { group, solids, items, kitCount, placeholder, reserved, stats, update(dt, t), dispose() }
       Adds R.group to level.group and sets level.kit = R (when level is given).
       solids     every SOLIDS entry (same order): its KIT node, rotated rot x 90 deg, exactly on its box (floor pieces centred on it, wall
                  pieces with their back on the wall plane), INSTANCED per (node, primitive, 6x6-tile chunk). With no kit (or no node),
                  a grey box of the exact footprint and height instead (E7: what you bump into is always visible, H5).
                  R.solids[i] = { i, id, kind, node, placeholder, box {x0, z0, x1, z1, h} (m), aabb (Box3, world), matrix, fix }
       band       plan.band: furniture and props against the walls;  windows: plan.windows (glass, sky and the wall part get the
                  reserved materials: R.reserved.{wall, glass, sky} lists the meshes, js/atmos.js may swap their materials)
       fixtures   plan.fixtures: bodies instanced; Fix_*_emit parts as instanced emissive (MatLib.emissiveMesh, colour x state, flicker
                  group); every lit lamp's glow in ONE Points mesh (MatLib.glowPoints); cords of hanging lamps in one instanced mesh
       animated   rocking chairs, mobiles, pendulums, swaying dolls (KIT.anims pivots) and swaying curtains (shape keys) as small separate
                  copies, moved by R.update(dt, t); still with calm effects on, and left in the instances on Low
       Every object carries userData.kit = { kind, node, mount, aabb (node frame), solid [per instance], item [per instance] }, so
       disposeLevel skips it; R.dispose() frees what this furnish made (instance buffers, merged and copied geometry, the glow).
       opts: kit (a kit, or null for placeholders), tier, solids (default SOLIDS), ceilAt(xm, zm) (default ceilAtXZ), wallMat (the level's
             wall material, for windows' wall parts), glassMat, skyMat (else Kit.reserved, else plain stand-ins), wallCells
             (LightBaker's, so windows' wall parts sample their face's lightmap cell; default: LightBaker.packAtlas of plan.faces),
             bakeTier, placeholders (use the manifest's grey stand-in nodes too; default Kit.placeholderArt = true), anim, shadows,
             calm, evict (default true)
     Kit.upgradeInPlace(level, plan?, opts?)         when a kit arrives after its floor was built with placeholders: swaps only what the
                                                     kit owns (level.kit, the wardrobes, the exit door, level.house.upgrade if any).
                                                     Never rebuilds: scares.doll, level.paintings and the boards stay. Returns the new R.
     Kit.wardrobe(c, style, opts?) -> Group | null   makeWardrobe's contract from Ward_body/leafL/leafR: c.doors [{pivot, leaf, side, open}],
                                                     hinges x = +-0.575, z = 0.305; null without the kit (level.js keeps its own)
     Kit.exit(style, opts?) -> { group, door } | null door = level.door { door, lamp, lockedMat, openMat, open, setOpen(on, dt), shared, ... }:
                                                     setOpen(true) drops the boards (0.4 s), then swings the leaf out 0 -> 1.75 rad (1.6 s)
     Kit.placeholderBox(box, opts?) -> Mesh          one grey box {x0, z0, x1, z1 (m), h} (or {x, z, w, d, h}), shared geometry
     Kit.setReserved({ glass, sky })                 js/atmos.js's glass and sky materials for every later furnish */
(function () {
'use strict';

const UM = 0.045, TU = 50, L = TU * UM, CH = 6 * L, PI = Math.PI;
const TEX = ['map', 'emissiveMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'lightMap', 'alphaMap', 'envMap'];
const AXIS = { x: ['x', 1], y: ['z', -1], z: ['y', 1] };       // a Blender axis in three.js (z up -> y up, front -y -> +z)
const WARD = { hx: 0.575, hz: 0.305, hy: 0.025 };              // the wardrobe's hinges (level.js makeWardrobe, render.js)
const EXIT_T = { boards: 0.4, leaf: 1.6, open: 1.75 };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const kitOff = () => typeof location !== 'undefined' && /[?&]kit=off\b/.test(location.search);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function hash(x, y, k) {                                         // (world3d.js's tile hash: phases and looks that don't matter to anyone else)
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((k | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const nameOf = o => (o.userData && o.userData.name) || o.name;
// what a material stands for: the reserved names of B1 are swapped for the level's own materials
function roleOf(m, node) {
  const n = (m && m.name) || '';
  if (/^WallSurface/.test(n)) return 'wall';
  if (/^SkyPlane/.test(n) || /_sky$/.test(node || '')) return 'sky';
  if (/^Glass/.test(n) || /_glass$/.test(node || '')) return 'glass';
  if (/^Emit/.test(n)) return 'emit';
  return null;
}

/* ---------- tiers ---------- */
function tierOf(t) { t = String(t || '').toLowerCase(); return t === 'hi' || t === 'high' ? 'hi' : t === 'md' || t === 'medium' ? 'md' : t === 'lo' || t === 'low' ? 'lo' : null; }
function maxTexture() {
  try {
    if (typeof renderer !== 'undefined' && renderer && renderer.capabilities) return renderer.capabilities.maxTextureSize || 0;
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
  } catch (e) { return 0; }
}
// low -> lo; medium -> md (lo on phones); high -> hi only with 8192 textures and 8 GB, never on a phone (its memory), else md
function tierFor(quality, lowq) {
  const q = tierOf(quality) || 'lo';
  if (q === 'lo') return 'lo';
  if (q === 'md') return lowq ? 'lo' : 'md';
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
  return !lowq && maxTexture() >= 8192 && mem >= 8 ? 'hi' : 'md';
}
const curTier = () => tierFor(typeof settings !== 'undefined' ? settings.quality : 'low', typeof LOWQ !== 'undefined' && LOWQ);
const lowQuality = () => typeof settings !== 'undefined' ? settings.quality === 'low' : true;

/* ---------- loading ---------- */
const files = new Map();     // 'tier/name' -> one GLB: {name, tier, url, state 'loading' | 'done' | 'failed', loaded, total, scene, promise}
const kits = new Map();      // 'tier/style' -> kit
const pending = new Map();   // 'tier/style' -> Promise<kit | null>
let manifest = null, manifestP = null;
const loadManifest = () => manifestP || (manifestP = fetch('models/kit/manifest.json').then(r => r.ok ? r.json() : null).catch(() => null).then(m => (manifest = m)));
function loader() {          // (world3d.js's: it reads the meshopt-compressed models)
  if (typeof gltfLoader === 'function') return gltfLoader();
  const l = new THREE.GLTFLoader(); if (typeof MeshoptDecoder !== 'undefined') l.setMeshoptDecoder(MeshoptDecoder); return l;
}
function loadFile(name, tier) {
  const key = tier + '/' + name; let f = files.get(key);
  if (f && f.state !== 'failed') return f;
  f = { key, name, tier, url: 'models/kit/' + tier + '/' + name + '.glb', state: 'loading', loaded: 0, total: 0, scene: null };
  files.set(key, f);
  f.promise = new Promise(res => {
    let l; try { l = loader(); } catch (e) { f.state = 'failed'; res(null); return; }
    l.load(f.url, g => {
      if (files.get(key) !== f) { disposeScene(g.scene); res(null); return; }      // (released while it loaded)
      try { f.scene = prep(g.scene, tier); f.state = 'done'; } catch (e) { console.error(e); f.state = 'failed'; }
      res(f.scene);
    }, ev => { f.loaded = ev.loaded || 0; if (ev.total) f.total = ev.total; },
    err => { console.warn('Kit: no ' + f.url, (err && err.message) || err); f.state = 'failed'; res(null); });
  });
  return f;
}
// a freshly loaded scene: no lights, everything marked as the kit's (disposeLevel leaves it alone), Lambert on lo
function prep(scene, tier) {
  const lights = []; scene.traverse(o => { if (o.isLight) lights.push(o); });
  for (const o of lights) { if (o.target && o.target.parent) o.target.parent.remove(o.target); if (o.parent) o.parent.remove(o); }
  const lo = new Map();
  scene.traverse(o => {
    const u = o.userData; if (u.kit !== undefined && u.kit !== true) u.kitRole = u.kit;   // (the glTF extras' kit group)
    u.kit = true; u.shared = true;
    if (!o.isMesh) return;
    o.castShadow = tier !== 'lo'; o.receiveShadow = true;
    if (o.geometry && !o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const ms = [].concat(o.material).map(m => {
      if (tier !== 'lo' || !m || !m.isMeshStandardMaterial || roleOf(m, nameOf(o))) return m;
      let l = lo.get(m); if (!l) { l = lambert(m); lo.set(m, l); } return l; });
    o.material = Array.isArray(o.material) ? ms : ms[0];
    for (const m of ms) { if (!m) continue; m.userData.kit = true; m.userData.shared = true;
      for (const k of TEX) if (m[k]) { m[k].userData.shared = true; if (tier !== 'lo' && (k === 'map' || k === 'normalMap')) m[k].anisotropy = 4; } }
  });
  for (const m of lo.keys()) m.dispose();
  return scene;
}
function lambert(m) {        // (the cheap lit material on lo: the same pictures, no roughness or metal)
  const l = new THREE.MeshLambertMaterial({ name: m.name });
  l.color.copy(m.color); l.emissive.copy(m.emissive); l.emissiveIntensity = m.emissiveIntensity;
  for (const k of ['map', 'normalMap', 'aoMap', 'emissiveMap', 'alphaMap']) l[k] = m[k] || null;
  if (m.normalMap) l.normalScale.copy(m.normalScale);
  for (const k of ['aoMapIntensity', 'alphaTest', 'transparent', 'opacity', 'side', 'vertexColors', 'depthWrite']) l[k] = m[k];
  return l;
}
function makeKit(style, tier, scene, common) {
  const nodes = {};
  for (const sc of [common, scene]) if (sc) for (const o of sc.children) nodes[nameOf(o)] = o;
  const isPlaceholder = n => !!(manifest && manifest.nodes && manifest.nodes[n] && manifest.nodes[n].placeholder);
  return { style, tier, scene, common, nodes, node: n => nodes[n] || null, has: n => !!nodes[n], isPlaceholder, prims: new Map(), emitMats: new Map() };
}
function want(style, tier) {
  tier = tierOf(tier) || curTier();
  if (!style || kitOff()) return Promise.resolve(null);
  if (style === 'common') return Promise.all([loadManifest(), loadFile('common', tier).promise]).then(r => r[1] ? true : null);
  const key = tier + '/' + style, k = kits.get(key);
  if (k) return Promise.resolve(k);
  if (pending.has(key)) return pending.get(key);
  const a = loadFile(style, tier), c = loadFile('common', tier);
  const p = Promise.all([a.promise, c.promise, loadManifest()]).then(([s, cm]) => {
    pending.delete(key);
    if (!s || files.get(a.key) !== a) return null;
    const kit = makeKit(style, tier, s, cm && files.get(c.key) === c ? cm : null); kits.set(key, kit); return kit;
  });
  pending.set(key, p); return p;
}
const preload = (list, tier) => Promise.all((list || []).map(n => want(n, tier)));
const ready = (style, tier) => !kitOff() && kits.has((tierOf(tier) || curTier()) + '/' + style);
const get = (style, tier) => kitOff() ? null : kits.get((tierOf(tier) || curTier()) + '/' + style) || null;
function progress() {
  let a = 0, b = 0;
  for (const f of files.values()) {
    const m = manifest && manifest.tiers && manifest.tiers[f.tier] && manifest.tiers[f.tier][f.name], x = m || f.total || Math.max(f.loaded, 1);
    b += x; a += f.state === 'loading' ? Math.min(f.loaded, x) : x;
  }
  return b ? a / b : 1;
}

/* ---------- memory (E5) ---------- */
function disposeScene(sc) {
  if (!sc) return;
  const seen = new Set();
  sc.traverse(o => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    for (const m of [].concat(o.material || [])) { if (!m || seen.has(m)) continue; seen.add(m);
      for (const k in m) { const t = m[k]; if (t && t.isTexture && !seen.has(t)) { seen.add(t); t.dispose(); } }
      m.dispose(); }
  });
}
function dropFile(f) { if (f.state === 'done') disposeScene(f.scene); files.delete(f.key); }
function dropKits(pred) { for (const [key, k] of kits) if (pred(k)) { for (const m of k.emitMats.values()) m.dispose(); kits.delete(key); } }
// throw a style's kits away, every tier ('common': the common pieces, and so every kit that holds them)
function release(style) {
  let n = 0;
  for (const f of [...files.values()]) if (f.name === style && f.state !== 'loading') { dropFile(f); n++; }
  dropKits(k => k.style === style || style === 'common');
  return n;
}
// keep only these styles at this tier, and that tier's common pieces (loads still running are left alone)
function evict(keep, tier) {
  tier = tierOf(tier) || curTier(); const ks = new Set((keep || []).filter(Boolean));
  for (const f of [...files.values()]) {
    if (f.state === 'loading') continue;
    if (f.tier === tier && (f.name === 'common' || ks.has(f.name))) continue;
    dropFile(f);
    dropKits(k => k.tier === f.tier && (k.style === f.name || f.name === 'common'));
  }
}

/* ---------- the pieces of a node ---------- */
let PIV = null;               // (KIT.anims' pivot suffixes: _RockPivot, _MobilePivot, _Pendulum, _SwayPivot)
function pivotOf(name) {
  if (!PIV) PIV = Object.keys(KIT.anims).filter(k => KIT.anims[k].pivot).map(k => [KIT.anims[k].pivot, KIT.anims[k]]);
  for (const [s, a] of PIV) if (name.endsWith(s)) return a; return null;
}
// a node's meshes in its own frame: meshes [{geo, mat, rel, role, name, morph}], emit (under <node>_emit), pivots (its animated parts:
// left out of meshes unless still), fix (its <node>_fix empty), box (the whole node at rest, node frame)
function primsOf(kit, name, still) {
  if (!kit) return null;
  const key = name + (still ? '|still' : '');
  if (kit.prims.has(key)) return kit.prims.get(key);
  const root = kit.nodes[name];
  if (!root) { kit.prims.set(key, null); return null; }
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), relOf = o => new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
  const P = { name, meshes: [], emit: [], pivots: [], fix: null, box: new THREE.Box3() };
  const boxOf = o => o.traverse(m => { if (m.isMesh && m.geometry.boundingBox) P.box.union(m.geometry.boundingBox.clone().applyMatrix4(relOf(m))); });
  const walk = (o, emit) => {
    const nm = nameOf(o);
    if (o !== root) {
      const pv = !still && pivotOf(nm);
      if (pv) { P.pivots.push({ obj: o, name: nm, rel: relOf(o.parent), def: pv }); boxOf(o); return; }
      if (/_fix$/.test(nm) && !P.fix) P.fix = relOf(o);
      if (/_emit$/.test(nm)) emit = true;
    }
    if (o.isMesh) {
      const rec = { geo: o.geometry, mat: o.material, rel: relOf(o), name: nm, role: emit ? 'emit' : roleOf(o.material, nm),
        morph: !!(o.geometry.morphAttributes && o.geometry.morphAttributes.position && o.geometry.morphAttributes.position.length) };
      (emit ? P.emit : P.meshes).push(rec);
      if (o.geometry.boundingBox) P.box.union(o.geometry.boundingBox.clone().applyMatrix4(rec.rel));
    }
    for (const c of o.children) walk(c, emit);
  };
  walk(root, false);
  kit.prims.set(key, P); return P;
}
// the light field (C5) on every kit material, once a kit is used (MatLib may not be loaded: then nothing)
function lightField(kit) {
  if (typeof MatLib === 'undefined' || !MatLib.withLightField) return;
  for (const sc of [kit.scene, kit.common]) {
    if (!sc || sc.userData.kitLF) continue; sc.userData.kitLF = true;
    sc.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && !roleOf(m, nameOf(o))) MatLib.withLightField(m); });
  }
}

/* ---------- shared stand-ins ---------- */
let SH = null;
function shared() {
  if (SH) return SH;
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);           // (a unit box standing on the floor)
  const cyl = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true); cyl.translate(0, 0.5, 0);
  const sph = new THREE.SphereGeometry(0.05, 10, 8);
  const lf = m => { m.userData.shared = true; m.userData.kit = true; if (typeof MatLib !== 'undefined' && MatLib.withLightField) MatLib.withLightField(m); return m; };
  SH = { box, cyl, sph, unit: new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)),
    grey: { lo: lf(new THREE.MeshLambertMaterial({ name: 'KitPlaceholder', color: 0x8a847c })),
            md: lf(new THREE.MeshStandardMaterial({ name: 'KitPlaceholder', color: 0x8a847c, roughness: 0.92, metalness: 0 })) },
    cord: { lo: lf(new THREE.MeshLambertMaterial({ name: 'KitCord', color: 0x141210 })),
            md: lf(new THREE.MeshStandardMaterial({ name: 'KitCord', color: 0x141210, roughness: 0.7, metalness: 0 })) },
    glass: lf(new THREE.MeshStandardMaterial({ name: 'KitGlass', color: 0x9db0c4, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false })),
    sky: new THREE.MeshBasicMaterial({ name: 'KitSky', color: 0x0b1530, fog: false }),        // (E7: no sky -> flat dark blue)
    wall: lf(new THREE.MeshLambertMaterial({ name: 'KitWall', color: 0x6d6258 })) };
  for (const g of [box, cyl, sph]) g.userData.shared = true;
  SH.sky.userData.shared = true;
  return SH;
}
const greyOf = tier => shared().grey[tier === 'lo' ? 'lo' : 'md'];
const reserved = { glass: null, sky: null };
function setReserved(o) { if (o) { if ('glass' in o) reserved.glass = o.glass; if ('sky' in o) reserved.sky = o.sky; } return reserved; }
// one grey box with an exact footprint: {x0, z0, x1, z1, h} in m, or {x, z, w, d, h} (centre, size)
function placeholderBox(b, opts) {
  const o = opts || {}, x0 = b.x0 !== undefined ? b.x0 : b.x - b.w / 2, x1 = b.x1 !== undefined ? b.x1 : b.x + b.w / 2;
  const z0 = b.z0 !== undefined ? b.z0 : b.z - b.d / 2, z1 = b.z1 !== undefined ? b.z1 : b.z + b.d / 2;
  const m = new THREE.Mesh(shared().box, greyOf(tierOf(o.tier) || curTier()));
  m.position.set((x0 + x1) / 2, b.y0 || 0, (z0 + z1) / 2); m.scale.set(x1 - x0, b.h, z1 - z0);
  m.castShadow = (tierOf(o.tier) || curTier()) !== 'lo'; m.receiveShadow = true;
  m.userData.kit = { kind: 'placeholder', mount: 'floor', aabb: [[-0.5, 0, -0.5], [0.5, 1, 0.5]], solid: o.solid !== undefined ? o.solid : -1 };
  return m;
}

/* ---------- geometry helpers ---------- */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = () => V(0, 1, 0);
function place(x, y, z, ry) { return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP(), ry || 0), V(1, 1, 1)); }
const chunkOf = (x, z) => Math.floor(x / CH) + ',' + Math.floor(z / CH);
const boxArr = b => [[b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z]];
// a wall part's uv1 from where it is on its face: u along the face (node x from -L/2), y up, into LightBaker's atlas cell (C4)
const cellUv = (c, lx, ly) => [c.u0 + ((lx + L / 2) / L) * c.su, c.v0 + ly * c.sv];
// meshes merged into one geometry in world space (windows' wall, glass and sky parts: few, and their materials aren't instanced)
function mergeParts(parts, white) {
  let nv = 0, ni = 0;
  for (const q of parts) { const g = q.p.geo; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const hasUv = parts.every(q => q.p.geo.attributes.uv), hasUv1 = parts.every(q => q.cell || q.p.geo.attributes.uv1);
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U0 = hasUv ? new Float32Array(nv * 2) : null, U1 = hasUv1 ? new Float32Array(nv * 2) : null;
  const I = new Uint32Array(ni), v = V(0, 0, 0), lv = V(0, 0, 0), n = V(0, 0, 1), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const q of parts) {
    const g = q.p.geo, pa = g.attributes.position, na = g.attributes.normal, ta = g.attributes.uv, t1 = g.attributes.uv1;
    nm.getNormalMatrix(q.m);
    for (let k = 0; k < pa.count; k++) {
      const o = vo + k;
      v.fromBufferAttribute(pa, k);
      if (U1) { let u; if (q.cell) { lv.copy(v).applyMatrix4(q.p.rel); u = cellUv(q.cell, lv.x, lv.y); } else u = [t1.getX(k), t1.getY(k)];
        U1[o * 2] = u[0]; U1[o * 2 + 1] = u[1]; }
      if (U0) { U0[o * 2] = ta.getX(k); U0[o * 2 + 1] = ta.getY(k); }
      v.applyMatrix4(q.m); P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
      if (na) n.fromBufferAttribute(na, k).applyMatrix3(nm).normalize(); else n.set(0, 0, 1).applyMatrix3(nm).normalize();
      N[o * 3] = n.x; N[o * 3 + 1] = n.y; N[o * 3 + 2] = n.z;
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) I[io++] = vo + g.index.getX(k);
    else for (let k = 0; k < pa.count; k++) I[io++] = vo + k;
    vo += pa.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (U0) geo.setAttribute('uv', new THREE.BufferAttribute(U0, 2));
  if (U1) geo.setAttribute('uv1', new THREE.BufferAttribute(U1, 2));
  if (white) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3).fill(1), 3));   // (an old wall material with vertexColors)
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}
// a copy of a wall part with its uv1 moved into its face's atlas cell (the exit's porch)
function remapUv1(geo, rel, cell) {
  const g = geo.clone(), pa = g.attributes.position, uv1 = new Float32Array(pa.count * 2), v = V(0, 0, 0);
  for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k).applyMatrix4(rel); const u = cellUv(cell, v.x, v.y); uv1[k * 2] = u[0]; uv1[k * 2 + 1] = u[1]; }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  return g;
}
// a copy of a template node at its own origin (shared geometry and materials), marked as the kit's
function cloneNode(kit, name, info) {
  const t = kit && kit.nodes[name]; if (!t) return null;
  const c = t.clone(true); c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1);
  mark(c, info); return c;
}
function mark(o, info) { o.traverse(q => { q.userData = Object.assign({}, q.userData, { kit: info, shared: true }); }); return o; }
const findIn = (root, n) => { let r = null; root.traverse(c => { if (!r && nameOf(c) === n) r = c; }); return r; };

/* ---------- which node a box gets ---------- */
function decode([k, x0, y0, x1, y1, rot, v]) {          // (layout.js decodeSolid, for d.solids arrays)
  const id = KIT.solidIds[k] || null, it = id ? itemOf({ id, v }) : null;
  return { k, id, kind: it ? it.slot : 'pocket', x0: x0 / 2, y0: y0 / 2, x1: x1 / 2, y1: y1 / 2, rot, v, h: it ? it.h : 1, occ: it ? it.occ : 'none' };
}
function itemOf(s) { const b = s.id && KIT.items[s.id]; return b ? Object.assign({}, b, (b.var || [])[s.v | 0] || {}) : null; }
// its look (_v<n>), or for a piece that reaches the ceiling the shortest height (_H<cm>) that still gets there (the rest is hidden above it)
function nodeFor(it, v, ceilMax) {
  if (!it) return null;
  if (it.hcm && it.nodes) { for (let k = 0; k < it.hcm.length; k++) if (it.hcm[k] / 100 >= ceilMax - 0.005) return it.nodes[k]; return it.nodes[it.nodes.length - 1]; }
  if (it.nodes) return it.nodes[v | 0] || it.nodes[0];
  return it.node;
}
const nextStyle = fi => typeof FLOORS !== 'undefined' && FLOORS[(fi | 0) + 1] ? FLOORS[(fi | 0) + 1].style : null;
const isCalm = o => typeof o.calm === 'function' ? !!o.calm() : o.calm !== undefined ? !!o.calm : typeof calm === 'function' ? calm() : false;

/* ---------- furnishing a floor ---------- */
function furnish(level, plan, opts) {
  const t0 = now(), o = Object.assign({}, opts || {}), style = plan.style;
  const kit = o.kit !== undefined ? o.kit : get(style, o.tier);
  const tier = tierOf(o.tier) || (kit && kit.tier) || curTier();
  const shadows = o.shadows !== undefined ? !!o.shadows : tier !== 'lo';
  const anim = o.anim !== undefined ? !!o.anim : !lowQuality();
  const usePH = o.placeholders !== undefined ? !!o.placeholders : api.placeholderArt;
  const ceil = o.ceilAt || (typeof ceilAtXZ === 'function' ? ceilAtXZ : () => 3);
  const solids = (o.solids || (typeof SOLIDS !== 'undefined' ? SOLIDS : [])).map(s => Array.isArray(s) ? decode(s) : s);
  const G = new THREE.Group(); G.name = 'Kit'; G.userData.kit = { kind: 'group', style, tier };
  const R = { group: G, solids: [], items: [], kitCount: 0, placeholder: !kit, kit, style, tier, plan, opts: o, reserved: { wall: [], glass: [], sky: [] },
    anims: [], owned: [], stats: null, disposed: false };
  if (kit) lightField(kit);
  const S = shared(), glassMat = o.glassMat || reserved.glass || S.glass, skyMat = o.skyMat || reserved.sky || S.sky, wallMat = o.wallMat || null;
  const ok = n => !!(kit && n && kit.nodes[n] && (usePH || !kit.isPlaceholder(n)));
  const inst = new Map(), merges = new Map(), emits = new Map(), glows = [], cords = [], ph = new Map();
  let cells;                 // (LightBaker's wall atlas cells, worked out the first time a wall part needs one)
  const cellOf = face => {
    if (cells === undefined) {
      cells = o.wallCells || null;
      if (!cells && typeof LightBaker !== 'undefined' && LightBaker.packAtlas && plan.faces) {
        try { cells = LightBaker.packAtlas(plan.faces, o.bakeTier || (typeof settings !== 'undefined' ? settings.quality : 'low'), plan.faces.map(f => f.h)).cells; }
        catch (e) { console.warn('Kit: no wall atlas for the windows', e.message); cells = null; }
      }
    }
    return cells && face >= 0 ? cells[face] || null : null;
  };
  const addItem = (kind, node, mount, m, box, extra) => {
    R.items.push(Object.assign({ kind, node, mount, matrix: m, aabb: box ? box.clone().applyMatrix4(m) : null, solid: -1 }, extra || {}));
    return R.items.length - 1;
  };
  // an animated part: its own copy (shared geometry), turned about its pivot by R.update
  const animCopy = (pv, m, info, animId) => {
    const a = animId && KIT.anims[animId] && KIT.anims[animId].pivot && pv.name.endsWith(KIT.anims[animId].pivot) ? KIT.anims[animId] : pv.def;
    let meshes = 0; pv.obj.traverse(q => { if (q.isMesh) meshes++; }); if (!meshes) return;
    const holder = new THREE.Object3D(); holder.matrixAutoUpdate = false; holder.matrix.multiplyMatrices(m, pv.rel);
    const c = pv.obj.clone(true); mark(c, info); holder.userData.kit = info;
    c.traverse(q => { if (q.isMesh) { q.castShadow = shadows; q.receiveShadow = true; } });
    holder.add(c); G.add(holder);
    const base = c.rotation.clone(), ax = AXIS[a.axis || 'x'], e = m.elements, ph = hash(Math.round(e[12] * 10), Math.round(e[14] * 10), 71) * 2 * PI;
    R.anims.push({ obj: holder, set: t => { c.rotation.copy(base); if (!t) return;
      c.rotation[ax[0]] += ax[1] * (a.amp ? a.amp * Math.sin(2 * PI * t / a.period + ph) : 2 * PI * t / a.period); } });
  };
  const morphCopy = (p, wm, info) => {
    const c = new THREE.Mesh(p.geo, p.mat); c.matrixAutoUpdate = false; c.matrix.copy(wm); c.userData.kit = info; c.userData.shared = true;
    c.castShadow = false; c.receiveShadow = true; G.add(c);
    const per = (KIT.anims.morph && KIT.anims.morph.period) || 5, ph = hash(Math.round(wm.elements[12] * 10), Math.round(wm.elements[14] * 10), 73) * 2 * PI;
    R.anims.push({ obj: c, set: t => { const f = c.morphTargetInfluences; if (!f || !f.length) return; const a = t ? 0.5 + 0.5 * Math.sin(2 * PI * t / per + ph) : 0;
      f[0] = a; if (f.length > 1) f[1] = t ? 1 - a : 0; } });
  };
  // one placed node: its meshes into the instanced batches of its chunk, reserved parts into merged meshes, animated parts as copies
  const put = (kind, name, mount, m, extra) => {
    const P = primsOf(kit, name, !anim); if (!P) return -1;
    const x = extra || {}, solid = x.solid !== undefined ? x.solid : -1, item = addItem(kind, name, mount, m, P.box, x);
    const ck = chunkOf(m.elements[12], m.elements[14]), info = { kind, node: name, mount, aabb: boxArr(P.box), solid, item };
    P.meshes.forEach((p, k) => {
      const wm = new THREE.Matrix4().multiplyMatrices(m, p.rel);
      if (p.role === 'wall' || p.role === 'sky' || (p.role === 'glass' && kind === 'window')) {
        const mat = p.role === 'wall' ? wallMat || p.mat : p.role === 'sky' ? skyMat : glassMat, key = p.role + '|' + mat.uuid + '|' + ck;
        let b = merges.get(key); if (!b) merges.set(key, b = { role: p.role, mat, kind, parts: [] });
        b.parts.push({ p, m: wm, cell: p.role === 'wall' ? cellOf(x.face !== undefined ? x.face : -1) : null }); return;
      }
      if (p.morph && anim) { morphCopy(p, wm, info); return; }
      const key = name + '|' + k + '|' + ck;
      let b = inst.get(key); if (!b) inst.set(key, b = { p, kind, name, mount, box: P.box, list: [] });
      b.list.push({ m: wm, solid, item });
    });
    for (const pv of P.pivots) animCopy(pv, m, info, x.anim);
    R.kitCount++;
    return item;
  };
  const placeholder = (i, x0, z0, x1, z1, h) => {
    const m = new THREE.Matrix4().compose(V((x0 + x1) / 2, 0, (z0 + z1) / 2), new THREE.Quaternion(), V(x1 - x0, h, z1 - z0));
    const item = addItem('placeholder', null, 'floor', m, S.unit, { solid: i, placeholder: true }), ck = chunkOf((x0 + x1) / 2, (z0 + z1) / 2);
    let b = ph.get(ck); if (!b) ph.set(ck, b = []); b.push({ m, solid: i, item });
    return item;
  };

  /* the furniture you bump into: every box gets its node, or a grey box of its exact size */
  solids.forEach((s, i) => {
    const it = itemOf(s), x0 = s.x0 * UM, z0 = s.y0 * UM, x1 = s.x1 * UM, z1 = s.y1 * UM, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rot = s.rot | 0, th = rot * PI / 2;
    const ceilMax = Math.max(ceil(cx, cz), ceil(x0 + 1e-3, z0 + 1e-3), ceil(x1 - 1e-3, z0 + 1e-3), ceil(x0 + 1e-3, z1 - 1e-3), ceil(x1 - 1e-3, z1 - 1e-3));
    const name = nodeFor(it, s.v, ceilMax), slot = s.kind || (it && it.slot);
    const rec = { i, id: s.id, kind: slot, node: null, placeholder: true, box: { x0, z0, x1, z1, h: s.h }, aabb: null, matrix: null, fix: null };
    if (ok(name)) {
      let ox = cx, oz = cz;
      if (slot === 'wall') { ox -= Math.round(Math.sin(th)) * (x1 - x0) / 2; oz -= Math.round(Math.cos(th)) * (z1 - z0) / 2; }   // (its back on the wall)
      const m = place(ox, 0, oz, th), k = put(slot === 'island' ? 'island' : 'solid', name, slot === 'wall' ? 'wall' : 'floor', m, { solid: i, anim: it.anim });
      if (k >= 0) { const P = primsOf(kit, name, !anim);
        Object.assign(rec, { node: name, placeholder: false, matrix: m, aabb: R.items[k].aabb, fix: P.fix ? new THREE.Matrix4().multiplyMatrices(m, P.fix) : null }); }
    }
    if (rec.placeholder) { const h = it && it.hcm ? Math.max(ceilMax, 0.5) : s.h || (it && it.h) || 1, k = placeholder(i, x0, z0, x1, z1, h); rec.aabb = R.items[k].aabb; }
    R.solids.push(rec);
  });

  if (kit) {
    /* furniture and props against the walls (no collision) */
    (plan.band || []).forEach((b, k) => {
      const def = KIT.band[b.id] || KIT.arch.pieces[b.id] || {};
      let name = b.node;
      if (!kit.nodes[name] && def.nodes) name = def.nodes[(hash(b.face, Math.round(b.u * 1000), 61) * def.nodes.length) | 0];   // (one of its looks)
      if (!ok(name)) return;
      const ry = b.ry + (b.mount === 'corner' && b.end ? -PI / 2 : 0);       // (a corner piece at the face's far end turns into that corner)
      put('band', name, b.mount === 'corner' ? 'corner' : 'wall', place(b.x, (b.z0 || 0) - (def.z0 || 0), b.z, ry), { band: k, face: b.face, anim: def.anim });
    });
    /* windows: the frame and curtain instanced, the wall, glass and sky parts merged with the reserved materials */
    (plan.windows || []).forEach((w, k) => {
      if (!ok(w.node)) return;
      const f = plan.faces && plan.faces[w.face], pos = w.pos || (f ? [(f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2] : null);
      if (!pos) return;
      put('window', w.node, 'face', place(pos[0], pos[1] || 0, pos[2], w.ry !== undefined ? w.ry : f ? Math.atan2(f.nx, f.nz) : 0), { window: k, face: w.face });
    });
    /* lamps: the body like any piece; its emissive part instanced with the lamp's colour and flicker group; its glow; a cord */
    (plan.fixtures || []).forEach((fx, k) => {
      if (!ok(fx.node)) return;
      const P = primsOf(kit, fx.node, !anim), sp = fx.solid !== undefined && fx.solid >= 0 ? R.solids[fx.solid] : null;
      let m;
      if (fx.src === 'practical' && sp && sp.fix) m = sp.fix.clone();               // (at its furniture's <node>_fix empty)
      else if (fx.originIsCentre) { const c = P.box.getCenter(V(0, 0, 0)).applyAxisAngle(UP(), fx.ry || 0); m = place(fx.ox - c.x, fx.oy - c.y, fx.oz - c.z, fx.ry); }
      else m = place(fx.ox, fx.oy, fx.oz, fx.ry);
      put('fixture', fx.node, fx.mount, m, { fixture: k });
      const lvl = fx.state === 'dead' ? 0.03 : 1, col = (fx.color || [1, 0.8, 0.6]).map(c => c * 4 * lvl), grp = fx.state === 'flicker' ? fx.group : -1;
      P.emit.forEach((p, j) => {
        const key = fx.node + '|' + j; let b = emits.get(key); if (!b) emits.set(key, b = { p, node: fx.emitNode || fx.node + '_emit', list: [] });
        b.list.push({ m: new THREE.Matrix4().multiplyMatrices(m, p.rel), col, grp, fixture: k });
      });
      if (fx.state !== 'dead') {
        const def = KIT.fixtures[fx.id] || {}, gk = (fx.state === 'glow' ? 0.4 : 0.3) * Math.min(2.5, fx.k || 1);    // (WP6 calibrates)
        glows.push({ x: fx.x, y: fx.y, z: fx.z, color: (fx.color || [1, 0.8, 0.6]).map(c => c * gk), size: clamp(Math.max(def.W || 0.3, def.H || 0.3) * 1.1, 0.18, 0.9), group: grp });
      }
      if (fx.cord > 0.005) cords.push(place(fx.ox, fx.oy, fx.oz, 0).scale(V(1, fx.cord, 1)));
    });
  }

  /* build the batches */
  const tierMat = tier === 'lo' ? 'lo' : 'md';
  for (const b of inst.values()) {
    const mat = b.p.role === 'glass' ? glassMat : b.p.mat, im = new THREE.InstancedMesh(b.p.geo, mat, b.list.length);
    b.list.forEach((e, j) => im.setMatrixAt(j, e.m)); im.instanceMatrix.needsUpdate = true;
    im.computeBoundingBox(); im.computeBoundingSphere();
    im.castShadow = shadows && b.p.role !== 'glass'; im.receiveShadow = true; im.name = b.name;
    im.userData.kit = { kind: b.kind, node: b.name, mount: b.mount, aabb: boxArr(b.box), solid: b.list.map(e => e.solid), item: b.list.map(e => e.item) };
    G.add(im); R.owned.push(im);
  }
  for (const list of ph.values()) {
    const im = new THREE.InstancedMesh(S.box, S.grey[tierMat], list.length);
    list.forEach((e, j) => im.setMatrixAt(j, e.m)); im.instanceMatrix.needsUpdate = true;
    im.computeBoundingBox(); im.computeBoundingSphere(); im.castShadow = shadows; im.receiveShadow = true; im.name = 'KitPlaceholder';
    im.userData.kit = { kind: 'placeholder', node: null, mount: 'floor', aabb: boxArr(S.unit), solid: list.map(e => e.solid), item: list.map(e => e.item) };
    G.add(im); R.owned.push(im);
  }
  for (const b of merges.values()) {
    const mesh = new THREE.Mesh(mergeParts(b.parts, b.role === 'wall' && b.mat.vertexColors), b.mat);
    mesh.castShadow = shadows && b.role === 'wall'; mesh.receiveShadow = b.role === 'wall'; mesh.name = 'Kit_' + b.role;
    mesh.userData.kit = { kind: b.kind, role: b.role, mount: 'face', owned: true }; mesh.userData.shared = true;
    G.add(mesh); R.owned.push(mesh); R.reserved[b.role].push(mesh);
  }
  const ML = typeof MatLib !== 'undefined' && MatLib.emissiveMesh ? MatLib : null;
  for (const b of emits.values()) {
    let mat = kit.emitMats.get(b.p.mat);
    if (!mat) { const src = b.p.mat || {}, map = src.emissiveMap || src.map || null;
      mat = ML ? ML.emissiveMaterial({ map }) : new THREE.MeshBasicMaterial({ color: 0xffffff, map });
      mat.userData.kit = true; mat.userData.shared = true; kit.emitMats.set(b.p.mat, mat); }
    const n = b.list.length, im = ML ? ML.emissiveMesh(b.p.geo, n, mat) : new THREE.InstancedMesh(b.p.geo, mat, n), c = new THREE.Color();
    b.list.forEach((e, j) => { if (ML) ML.setEmissive(im, j, e.m, e.col, e.grp); else { im.setMatrixAt(j, e.m); im.setColorAt(j, c.setRGB(e.col[0], e.col[1], e.col[2])); } });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingBox(); im.computeBoundingSphere(); im.name = b.node;
    im.userData.kit = { kind: 'emit', node: b.node, mount: 'fixture', fixture: b.list.map(e => e.fixture), ownsGeometry: !!ML };
    G.add(im); R.owned.push(im);
  }
  if (glows.length && ML) { const pts = ML.glowPoints(glows); pts.name = 'KitGlow'; pts.userData.kit = { kind: 'glow', count: glows.length, owned: true }; G.add(pts); R.owned.push(pts); }
  if (cords.length) {
    const im = new THREE.InstancedMesh(S.cyl, S.cord[tierMat], cords.length);
    cords.forEach((m, j) => im.setMatrixAt(j, m)); im.instanceMatrix.needsUpdate = true; im.computeBoundingBox(); im.computeBoundingSphere(); im.name = 'KitCords';
    im.userData.kit = { kind: 'cord', mount: 'ceiling' }; G.add(im); R.owned.push(im);
  }

  let clock = 0;
  R.update = (dt, t) => { clock = t !== undefined ? t : clock + (dt || 0); const still = !anim || isCalm(o); for (const a of R.anims) a.set(still ? 0 : clock); };
  R.dispose = () => {
    if (R.disposed) return; R.disposed = true;
    for (const x of R.owned) {
      if (x.isInstancedMesh) { x.dispose(); if (x.userData.kit.ownsGeometry) x.geometry.dispose(); }
      else if (x.isPoints) { x.geometry.dispose(); x.material.dispose(); }
      else if (x.isMesh) x.geometry.dispose();
    }
    if (G.parent) G.parent.remove(G);
  };
  R.update(0, 0);
  const cnt = k => R.owned.filter(x => x.userData.kit.kind === k).length;
  R.stats = { instanced: R.owned.filter(x => x.isInstancedMesh).length, instances: R.owned.reduce((a, x) => a + (x.isInstancedMesh ? x.count : 0), 0),
    merged: merges.size, emissive: emits.size, glows: glows.length, cords: cords.length, anims: R.anims.length, placeholders: R.solids.filter(s => s.placeholder).length,
    draws: R.owned.length + R.anims.reduce((a, x) => { let n = 0; x.obj.traverse(q => { if (q.isMesh) n++; }); return a + n; }, 0),
    byKind: { solid: cnt('solid'), island: cnt('island'), band: cnt('band'), window: cnt('window'), fixture: cnt('fixture'), placeholder: cnt('placeholder') }, ms: +(now() - t0).toFixed(1) };
  if (level && level.group) level.group.add(G);
  if (level) level.kit = R;
  if (kit && o.evict !== false) evict([style, nextStyle(plan.floorIdx)], kit.tier);
  return R;
}

/* ---------- wardrobes (level.js makeWardrobe's contract) ---------- */
function wardrobe(c, style, opts) {
  const o = opts || {}, kit = o.kit !== undefined ? o.kit : get(style, o.tier), usePH = o.placeholders !== undefined ? !!o.placeholders : api.placeholderArt;
  const names = ['Ward_body_' + style, 'Ward_leafL_' + style, 'Ward_leafR_' + style];
  if (!kit || !names.every(n => kit.nodes[n]) || (!usePH && names.some(n => kit.isPlaceholder(n)))) return null;
  lightField(kit);
  const g = new THREE.Group(), info = { kind: 'wardrobe', node: names[0], mount: 'floor' };
  g.name = names[0]; g.userData.kit = info;
  const body = cloneNode(kit, names[0], info); body.traverse(q => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; } }); g.add(body);
  // two leaves on hinges at the outer edges (x = -+0.575, z = 0.305), each on its own pivot; seen from inside, the right one is at -x
  c.doors = []; c.swingT = -1;
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * WARD.hx, WARD.hy, WARD.hz); pivot.userData.kit = info;
    const leaf = cloneNode(kit, side < 0 ? names[1] : names[2], info); leaf.traverse(q => { if (q.isMesh) q.castShadow = true; });
    pivot.add(leaf); g.add(pivot); c.doors.push({ pivot, leaf, side, open: 0 });
  }
  const back = L / 2 - 0.3 - 0.01;                     // its back against the dead end's wall, the doors facing the way out
  g.position.set(c.x * UM - c.ox * back, 0, c.y * UM - c.oy * back); g.rotation.y = Math.atan2(c.ox, c.oy);
  c.kitWardrobe = true;
  return g;
}

/* ---------- the exit door (level.js makeExit's contract, plus the boards dropping and the leaf swinging out) ---------- */
function exitDoor(style, opts) {
  const o = opts || {}, kit = o.kit !== undefined ? o.kit : get(style, o.tier), usePH = o.placeholders !== undefined ? !!o.placeholders : api.placeholderArt;
  const name = 'Exit_' + style, root = kit && kit.nodes[name];
  if (!root || (!usePH && kit.isPlaceholder(name))) return null;
  const leafT = findIn(root, 'Exit_leaf_' + style), boardsT = findIn(root, 'Exit_boards_' + style), lampT = findIn(root, 'Exit_lamp_' + style);
  if (!leafT) return null;
  lightField(kit);
  // where: the plan's exit module, else level.js's rule (the back wall of the exit's dead end) on the live game
  let pos = null, ry = 0, face = -1;
  const md = o.plan && (o.plan.modules || []).find(q => q.kind === 'exit');
  if (md) { pos = md.pos; ry = md.ry; face = md.face; }
  else {
    const ex = o.exit || (typeof exit !== 'undefined' ? exit : null), dir = o.dir || (typeof exitDir === 'function' ? exitDir() : [0, -1]);
    if (!ex) return null;
    pos = [ex.x * UM + dir[0] * L / 2, 0, ex.y * UM + dir[1] * L / 2]; ry = Math.atan2(-dir[0], -dir[1]);
  }
  const S = shared(), info = { kind: 'exit', node: name, mount: 'face' }, g = new THREE.Group();
  g.name = name; g.userData.kit = info; g.position.set(pos[0], pos[1] || 0, pos[2]); g.rotation.y = ry;
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), relOf = q => new THREE.Matrix4().multiplyMatrices(inv, q.matrixWorld);
  const cell = o.wallCell || (o.wallCells && face >= 0 ? o.wallCells[face] : null), owned = [], sky = [];
  const inside = (q, t) => { for (let p = q; p && p !== root; p = p.parent) if (p === t) return true; return false; };
  // the porch and the wall around it (every mesh of the node but the leaf, the boards and the lamp)
  root.traverse(q => {
    if (!q.isMesh || [leafT, boardsT, lampT].some(t => t && inside(q, t))) return;
    const rel = relOf(q), role = roleOf(q.material, nameOf(q));
    let geo = q.geometry, mat = q.material;
    if (role === 'wall') { mat = o.wallMat || S.wall; if (cell) { geo = remapUv1(geo, rel, cell); owned.push(geo); } }
    else if (role === 'sky') mat = o.skyMat || reserved.sky || S.sky;
    else if (role === 'glass') mat = o.glassMat || reserved.glass || S.glass;
    const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.matrix.copy(rel); m.userData.kit = info; m.userData.shared = true;
    m.castShadow = role === 'wall' || !role; m.receiveShadow = true; g.add(m); if (role === 'sky') sky.push(m);
  });
  // the leaf on its hinge (its origin), with its own copy of its material (level.door's lockedMat: disposeLevel frees it, not the kit's)
  const lrel = relOf(leafT), pivot = new THREE.Group(), lp = V(0, 0, 0), lq = new THREE.Quaternion(), ls = V(1, 1, 1);
  lrel.decompose(lp, lq, ls); pivot.position.copy(lp); pivot.quaternion.copy(lq); pivot.userData.kit = info;
  const leaf = leafT.clone(true); leaf.position.set(0, 0, 0); leaf.quaternion.identity(); mark(leaf, info);
  let lockedMat = null;
  leaf.traverse(q => { if (!q.isMesh) return; q.castShadow = true; q.receiveShadow = true;
    if (!lockedMat) lockedMat = q.material.clone(); q.material = lockedMat; });
  pivot.add(leaf); g.add(pivot);
  const linv = new THREE.Matrix4().copy(leafT.matrixWorld).invert(), lb = new THREE.Box3();
  leafT.traverse(q => { if (q.isMesh && q.geometry.boundingBox) lb.union(q.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(linv, q.matrixWorld))); });
  const swing = lb.isEmpty() || (lb.min.x + lb.max.x) / 2 >= 0 ? 1 : -1;      // (a leaf reaching +x from its hinge opens outward (-z) with +y)
  // the boards nailed across it, and the lamp above (render.js colours its material every frame)
  let boards = null, drop = 0;
  if (boardsT) {
    boards = new THREE.Object3D(); const bp = V(0, 0, 0), bq = new THREE.Quaternion(); relOf(boardsT).decompose(bp, bq, V(1, 1, 1));
    boards.position.copy(bp); boards.quaternion.copy(bq); boards.userData.kit = info;
    const bc = boardsT.clone(true); bc.position.set(0, 0, 0); bc.quaternion.identity(); mark(bc, info); boards.add(bc); g.add(boards);
    const bb = new THREE.Box3(); boardsT.traverse(q => { if (q.isMesh && q.geometry.boundingBox) bb.union(q.geometry.boundingBox.clone().applyMatrix4(relOf(q))); });
    drop = bb.isEmpty() ? 0 : Math.max(0, bb.min.y - 0.02);                // (down to the floor)
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  let lamp;
  if (lampT) { lamp = new THREE.Mesh(lampT.isMesh ? lampT.geometry : S.sph, lampMat); lamp.matrixAutoUpdate = false; lamp.matrix.copy(relOf(lampT)); }
  else { lamp = new THREE.Mesh(S.sph, lampMat); lamp.position.set(0, 2.5, 0.05); }
  lamp.userData.kit = info; lamp.userData.shared = true; g.add(lamp);
  const fr = [Math.sin(ry), Math.cos(ry)], at = { x: pos[0] / UM, y: pos[2] / UM, h: 1.2 }, b0 = boards ? { y: boards.position.y, z: boards.position.z, rx: boards.rotation.x } : null;
  const pose = t => {
    if (boards) { const k = clamp(t / EXIT_T.boards, 0, 1); boards.position.y = b0.y - drop * k * k; boards.position.z = b0.z + 0.12 * k; boards.rotation.x = b0.rx + 0.3 * k * k; }
    const s = clamp((t - EXIT_T.boards) / EXIT_T.leaf, 0, 1), e = s * s * (3 - 2 * s);
    pivot.quaternion.copy(lq).multiply(new THREE.Quaternion().setFromAxisAngle(UP(), swing * EXIT_T.open * e));
  };
  const D = { door: leaf, lamp, lockedMat, openMat: lockedMat, open: false, shared: true, kit: true, group: g, leaf: pivot, boards, sky, t: -1,
    lightPos: V(pos[0] + fr[0] * 0.8, 1.7, pos[2] + fr[1] * 0.8),
    // called every frame with powerOn (render.js): opens once, over 2 s; dt defaults to the frame's (lastDt)
    setOpen(on, dt) {
      if (dt === undefined) dt = typeof lastDt === 'number' ? lastDt : 1 / 60;
      if (!on) { if (this.t >= 0) { this.t = -1; pose(0); } this.open = false; return; }
      this.open = true;
      if (this.t < 0) this.t = 0;
      const was = this.t, end = EXIT_T.boards + EXIT_T.leaf;
      if (was >= end) return;
      this.t = Math.min(end, was + Math.max(0, dt)); pose(this.t);
      if (was < EXIT_T.boards && this.t >= EXIT_T.boards && dt < 1 && typeof sfx !== 'undefined' && sfx.creak) sfx.creak(0.25, at);
    },
    update(dt) { if (this.open) this.setOpen(true, dt); },
    dispose() { lampMat.dispose(); for (const x of owned) x.dispose(); if (lockedMat) lockedMat.dispose(); } };
  pose(0);
  return { group: g, door: D };
}

/* ---------- a kit arriving after its floor was built ---------- */
function disposeTree(o, seen) {      // (what disposeLevel would have freed, for pieces taken out of the level)
  o.traverse(q => {
    const u = q.userData; if (u.shared || u.sharedGeo || u.kit) return;
    if (q.geometry && !seen.has(q.geometry)) { seen.add(q.geometry); q.geometry.dispose(); }
    for (const m of [].concat(q.material || [])) disposeMat(m, seen);
  });
}
function disposeMat(m, seen) {
  if (!m || seen.has(m)) return; seen.add(m);
  for (const k of TEX) { const t = m[k]; if (t && !(t.userData && t.userData.shared) && !seen.has(t)) { seen.add(t); t.dispose(); } }
  m.dispose();
}
function upgradeInPlace(level, plan, opts) {
  if (!level) return null;
  plan = plan || (level.kit && level.kit.plan) || level.plan;
  if (!plan) return null;
  const old = level.kit, o = Object.assign({}, old ? old.opts : {}, opts || {}), kit = o.kit || get(plan.style, o.tier);
  if (!kit) return null;
  o.kit = kit;
  const R = furnish(level, plan, o);                   // (adds its group to level.group and becomes level.kit)
  if (old && old !== R) old.dispose();
  const seen = new Set();
  // the wardrobes level.js built itself: kit ones in their place (render.js finds them through c.doors)
  if (typeof closets !== 'undefined' && o.wardrobes !== false) for (const c of closets) {
    if (c.kitWardrobe || !c.doors || !c.doors[0]) continue;
    const prev = c.doors[0].pivot.parent, swingT = c.swingT, par = prev && prev.parent; if (!par) continue;
    const doors = c.doors, g = wardrobe(c, plan.style, o);
    if (!g) { c.doors = doors; continue; }
    c.swingT = swingT; par.remove(prev); par.add(g); disposeTree(prev, seen);
  }
  // the exit door: the kit's, open if the old one was
  const D = level.door;
  if (D && !D.kit && o.exitDoor !== false) {
    const e = exitDoor(plan.style, Object.assign({ plan }, o));
    if (e) {
      for (const m of [D.door, D.lamp]) if (m && m.parent) { m.parent.remove(m); disposeTree(m, seen); }
      disposeMat(D.openMat, seen); disposeMat(D.lockedMat, seen);
      (level.group || R.group).add(e.group);
      if (D.open) e.door.setOpen(true, 10);
      level.door = e.door;
    }
  }
  if (level.house && typeof level.house.upgrade === 'function') level.house.upgrade(kit, R);
  return R;
}

const api = { want, preload, ready, kitReady: ready, get, progress, release, evict, tierFor, furnish, wardrobe, exit: exitDoor, upgradeInPlace,
  placeholderBox, setReserved, reserved, prims: primsOf, nodeFor, manifest: () => manifest, placeholderArt: true,
  files: () => [...files.values()].map(f => ({ name: f.name, tier: f.tier, state: f.state, loaded: f.loaded, total: f.total })) };
window.Kit = api;
})();
