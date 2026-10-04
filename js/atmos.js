/* Escape from Barbi Blue: the night outside and the air inside (build spec C1, C6, C7, C10, B10, E3, H12, H13). The sky seen through
   the windows, their glass, the moonlight shafts that fall through them, the dust motes drifting in those shafts, and the flashlight's
   bounce light. It decides nothing about WHERE anything is: the windows, the moon and the walls come from the floor's plan (js/dress.js)
   and its grid, so every player sees the same beams (H7); the quality tier only changes how they're drawn (C10). It adds no lights:
   the bounce moves the scene's existing aura light (H12), and everything per frame is a uniform (H13).

   Atmos.build(lv, plan, opts?) -> R = { group, update(t), shafts, motes, sky [meshes], glass [meshes], near, stats, dispose() }
     lv       the level ({group, kit}) or null. Its windows' sky parts (material 'SkyPlane', node *_sky, Kit's reserved.sky) get the sky
              material and their glass (a Glass* material under a Win_ node, as Kit's role rule, Kit's reserved.glass) the glass material; R.group is
              added to lv.group. Kit.setReserved({ glass, sky }) is called too, so a later Kit.furnish / upgradeInPlace uses them.
     plan     Dress.plan(env): windows (moonlit ones get a shaft), faces, moon, style, seed, GW, GH, L
     opts     tier 'low' | 'medium' | 'high' (or lo / md / hi; default the game's settings.quality); grid (rows of Uint8Array,
              d.rows strings, or a flat Uint8Array) or env (the env given to Dress.plan), default the game's grid; albedo (bounce
              tints per surface kind, see below); solids (default the env's or the game's SOLIDS: the tall boxes stop the shafts);
              skyPlanes true: add a sky plane 1.0 m behind every window (for a house without the kit's windows, where the wall has
              its openings); strips (shaft slices per window, default 3); shaftDensity (0.09); moteK (1.6)
     Sky      a fog-less ShaderMaterial: dir = normalize(worldPos - cameraPos) looks up textures/sky/night_garden.<lo|md|hi>.webp
              (equirect, three's equirectUv convention) at exposure 0.35, with a slow drifting cloud veil (uTime). Until (or unless)
              the picture loads: a dark blue night with the moon and a tree line. Near layer at 0.7 m behind the glass, when
              textures/sky/well_alpha.webp (concrete floors) or roofs_alpha.webp (attic) exists.
     Glass    MeshStandard, transparent, envMap = the sky (mapping 303) at 0.4; textures/glass/rain_normal.webp (normal) and
              grime_orm.webp (G: roughness) on medium and high when present (flat stand-ins until then, so nothing recompiles).
     Shafts   medium and high: ONE mesh for the floor. Per moonlit window, `strips` slices of the opening, each a prism from the
              opening's corners along the moonlight, cut 2 cm short of the floor, of the first wall tile (2D grid march) and of the
              side of a tall box most of the slice's rays meet; when every slice gets the same cuts they are one prism. Additive,
              back faces, no depth write, no fog. The fragment shader intersects the view ray with the prism's slabs (opening u, v
              back-projected along the moonlight, in front of the wall, above the floor) analytically and marches STEPS samples
              (high 8, medium 4) through a window's single prism, STEPS / 2 through each slice of a split one (about 1.5 STEPS
              through a whole split beam), at the middle of their steps, each the window's cookie (mip-filtered by the spacing) (high only: textures/light/cookies/<type>_<az>.webp, else a
              procedural mullion pattern, each slot's gain set so it passes as much light on average as medium's opening with soft
              edges) times drifting 3D noise (0.03 m/s; an octave finer than twice the spacing is taken once per pixel, at the
              middle of its way through the beam), dark where the way back to the window crosses one of the prism's 2 nearest
              tall boxes (a column's shadow; the bake's moon stops there too); fades within 0.6 m of the camera and past 12-14 m.
              Low: none (the bake's floor patches remain).
     Motes    high only: one Points mesh, <= 60 per window and <= 600 per floor, drifting on the GPU, lit only where the cookie lets
              moonlight through and no tall box is in the way (each point back-projected to the window every frame).
   R.update(t) (also Atmos.update(t), for the last build): the clock for clouds, noise and motes. R.dispose() frees what it made.
   Atmos.skyMaterial(tier?) / Atmos.glassMaterial(tier?): the shared materials (the same objects every call; textures marked shared).
   Atmos.preload(style, tier): start loading the sky, glass and near-layer pictures early (during the loading screen).

   Atmos.bounce (C7): the aura light lit where the flashlight lands.
     bounce.init(aura, flash, scene, opts?)   re-parents aura from the camera to the scene (the light count never changes);
                                              opts.albedo / bounce.setAlbedo({floor, wall, ceiling, box}) as hex or linear [r, g, b]
     bounce.update(dt, camera, flash, hidden, dist?)
                                              not hidden: marches the flashlight's ray (0.1 m steps, <= 12 m) through the grid, the
                                              floor (y = 0), the ceiling (ceilAtXZ) and the SOLIDS boxes; aura at P + 0.35 n (P - 0.35
                                              along the beam when that is inside something), colour = flash colour x the surface's
                                              albedo tint, intensity = 2.5 rho flash.intensity / 25 / (1 + 0.08 d^2), distance 5.5,
                                              decay 2, eased 0.25 per 60 Hz frame. hidden: today's behaviour at the camera (3.2, or
                                              the number given as hidden, e.g. 3.5; distance dist or 8). A dead or spectating player
                                              keeps today's light too: hidden = 1.2 * scares.dim, dist = 4.5 (render.js:104).
     bounce.solidAt([x, y, z], env?)          inside a wall tile, a box, under the floor or above the ceiling?
     bounce.cast(origin, dir, maxD?, env?)    the march alone -> {hit, kind 'floor' | 'wall' | 'ceiling' | 'box' | null, p [x,y,z],
                                              n [x,y,z], dist, box (index)}; env {wall(tx, ty), ceil(x, z), solids (u), L} or the game's */
(function () {
'use strict';

const UM = 0.045, L0 = 50 * UM, PI = Math.PI, CLAMP = 1001, LINEAR = 1006, EQUIRECT = 303, BACK = 1;   // (numbers this build doesn't export: BackSide 1)
const OPEN_MEAN = 0.795;   // (the mean of medium's cookie() below: 0.9 x (1 - 0.06)^2)
const SKY_EXPOSURE = 0.35, GLASS_D = 0.13, NEAR_D = 0.7, SKY_D = Math.min(GLASS_D + 0.9, 1.0), MOTES_PER = 60, MOTES_MAX = 600, CELL = 128, ATL = 4;
const TIER = { low: 'lo', lo: 'lo', medium: 'md', md: 'md', high: 'hi', hi: 'hi' };
const NEAR = { concrete: 'well_alpha', attic: 'roofs_alpha' };            // (B10: the cellar's light well, the attic's roofs)
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const tierOf = t => TIER[String(t || (typeof settings !== 'undefined' ? settings.quality : 'low')).toLowerCase()] || 'lo';
// the tile hash (world3d.js, copied so this file stands alone) mixed with the floor's seed (spec A14)
function hash(x, y, k) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((k | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const vhOf = seed => (x, y, k) => hash(x, y, (Math.imul(k, 2654435761) ^ seed) | 0);

/* ---------- pictures: Image -> CanvasTexture (this three.js build has no TextureLoader); each URL is tried once ---------- */
const imgs = new Map();
function loadImg(url, cb) {
  let e = imgs.get(url);
  if (!e) {
    e = { img: null, done: false, cbs: [] }; imgs.set(url, e);
    if (typeof Image === 'undefined') { e.done = true; } else {
      const im = new Image(), fin = ok => { e.done = true; e.img = ok ? im : null; const c = e.cbs; e.cbs = []; c.forEach(f => f(e.img)); };
      im.onload = () => fin(true); im.onerror = () => fin(false); im.src = url;
    }
  }
  if (e.done) cb(e.img); else e.cbs.push(cb);
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const shared = t => { t.userData.shared = true; return t; };

/* ---------- the shared uniforms of this file's shaders (the moon's from MatLib's U when it's there, the same objects) ---------- */
const A = {
  uTime: { value: 0 },
  uMoonTo: { value: new THREE.Vector3(0.4, 0.55, 0.73).normalize() },   // toward the moon (sky)
  uSky: { value: null }, uHasSky: { value: 0 }, uExposure: { value: SKY_EXPOSURE },
  uMoonCol: { value: new THREE.Color(0x8fa6d8) }, uMoonK: { value: 1 },
};
function moonU() {
  if (typeof MatLib !== 'undefined' && MatLib.U) { A.uMoonCol = MatLib.U.uMoonCol; A.uMoonK = MatLib.U.uMoonK; }
  return A;
}

/* ---------- sky ---------- */
const SKY_V = `
varying vec3 vW;
void main() {
  vec4 p = vec4( position, 1.0 );
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  vec4 w = modelMatrix * p; vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const NOISE = `
float h21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float vn2( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float fbm2( vec2 p ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 4; i ++ ) { s += a * vn2( p ); p = p * 2.03 + 7.1; a *= 0.5; } return s; }`;
const SKY_F = `
uniform sampler2D uSky; uniform float uHasSky, uExposure, uTime, uMoonK; uniform vec3 uMoonTo, uMoonCol;
varying vec3 vW;
${NOISE}
// no picture: a dark blue night, the moon and its halo, a ragged tree line on the horizon
vec3 night( vec3 d ) {
  float h = d.y, md = max( dot( d, normalize( uMoonTo ) ), 0.0 );
  vec3 c = mix( vec3( 0.010, 0.014, 0.028 ), vec3( 0.018, 0.026, 0.055 ), smoothstep( -0.05, 0.6, h ) ) + vec3( 0.010, 0.013, 0.020 ) * exp( - abs( h ) * 10.0 );
  c += uMoonCol * ( smoothstep( 0.99985, 0.99992, md ) * 1.6 + pow( md, 400.0 ) * 0.25 + pow( md, 12.0 ) * 0.025 );
  float az = atan( d.z, d.x ), tl = 0.025 + 0.06 * fbm2( vec2( az * 7.0, 0.0 ) ) * smoothstep( 0.2, 0.7, vn2( vec2( az * 2.0, 3.0 ) ) );
  if ( h < tl ) c = vec3( 0.003, 0.004, 0.007 ) + vec3( 0.004, 0.005, 0.008 ) * smoothstep( -0.3, 0.0, h );
  return c;
}
void main() {
  vec3 d = normalize( vW - cameraPosition );
  vec2 uv = vec2( atan( d.z, d.x ) * 0.1591549 + 0.5, asin( clamp( d.y, - 1.0, 1.0 ) ) * 0.3183099 + 0.5 );
  vec3 c;
  if ( uHasSky > 0.5 ) {
    vec2 dx = dFdx( uv ), dy = dFdy( uv ); dx.x -= floor( dx.x + 0.5 ); dy.x -= floor( dy.x + 0.5 );     // (no mip seam where atan wraps)
    c = textureGrad( uSky, uv, dx, dy ).rgb * uExposure;
  } else c = night( d );
  // clouds drifting across the upper sky: a slow veil that dims the stars and catches a little moonlight
  float up = smoothstep( 0.03, 0.2, d.y ), cl = smoothstep( 0.45, 0.85, fbm2( d.xz / ( d.y + 0.15 ) * 1.4 + uTime * vec2( 0.006, 0.0025 ) ) ) * up;
  c = mix( c, c * 0.6 + uMoonCol * uMoonK * 0.006, cl * ( uHasSky > 0.5 ? 0.35 : 0.8 ) );
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
let skyMat = null;
const skyTier = { want: null };
function newSky() {
  const U = moonU();
  const m = new THREE.ShaderMaterial({ name: 'AtmosSky', vertexShader: SKY_V, fragmentShader: SKY_F, fog: false,
    uniforms: { uSky: U.uSky, uHasSky: U.uHasSky, uExposure: U.uExposure, uTime: U.uTime, uMoonTo: U.uMoonTo, uMoonCol: U.uMoonCol, uMoonK: U.uMoonK } });
  m.userData.atmos = 'sky';
  return m;
}
// the sky material (one object; its picture is a uniform, so it can arrive late without a recompile)
function skyMaterial(tier) {
  if (!skyMat) skyMat = newSky();
  loadSky(tierOf(tier));
  return skyMat;
}
function loadSky(t) {
  if (skyTier.want === t) return; skyTier.want = t;
  let tried = t;
  const got = img => {
    if (skyTier.want !== t) return;
    if (!img && tried !== 'lo') { tried = 'lo'; loadImg('textures/sky/night_garden.lo.webp', got); return; }
    if (!img) return;
    const tex = shared(new THREE.CanvasTexture(img)); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = CLAMP;
    const old = A.uSky.value; A.uSky.value = tex; A.uHasSky.value = 1; if (old && old !== tex) old.dispose();
    paintEnv(img);
  };
  loadImg('textures/sky/night_garden.' + t + '.webp', got);
}

/* ---------- glass: its reflections are a small copy of the sky (always the same size, so the env map never changes the program) ---------- */
let envTex = null, glassMats = {};
function envMap() {
  if (envTex) return envTex;
  const c = canvas(256, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#0d1424'); gr.addColorStop(0.48, '#1a2236'); gr.addColorStop(0.52, '#07080b'); gr.addColorStop(1, '#030304');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  envTex = shared(new THREE.CanvasTexture(c)); envTex.mapping = EQUIRECT; envTex.colorSpace = THREE.SRGBColorSpace;
  return envTex;
}
function paintEnv(img) {
  const t = envMap(), g = t.image.getContext('2d');
  g.drawImage(img, 0, 0, 256, 128); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 256, 128);   // (about the sky's own exposure)
  t.dispose(); t.needsUpdate = true;                                        // (dispose: the renderer's prefiltered copy is made again)
}
function flatTex(r, g, b) { const c = canvas(4, 4), x = c.getContext('2d'); x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, 4, 4);
  const t = shared(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
function glassMaterial(tier) {
  const t = tierOf(tier); if (glassMats[t]) return glassMats[t];
  const m = new THREE.MeshStandardMaterial({ name: 'AtmosGlass', color: 0x14181c, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.2,
    depthWrite: false, envMap: envMap(), envMapIntensity: 0.4 });
  if (t !== 'lo') {
    m.normalMap = flatTex(128, 128, 255); m.roughnessMap = flatTex(255, 26, 0); m.roughness = 1; m.normalScale.set(0.6, 0.6);
    // (dispose first: the renderer gave the 4 x 4 stand-in fixed-size storage, and a bigger picture can't be uploaded into it)
    const swap = (tex, img) => { if (img) { tex.dispose(); tex.image = img; tex.needsUpdate = true; } };
    loadImg('textures/glass/rain_normal.webp', img => swap(m.normalMap, img));
    loadImg('textures/glass/grime_orm.webp', img => swap(m.roughnessMap, img));
  }
  // (glass scatters almost nothing: a dark colour, or the flashlight lights the pane up milky white. And old window glass is never a
  // mirror for the flashlight: Blender's grime map says 0.07-0.27, a hot spot thousands of times the lit wall's brightness that blew
  // the pane out to white (and bloomed on High). At 0.35 or rougher the torch makes a small glint, the night stays visible through
  // it; the sky's reflection hardly changes. Compiled once, never changed)
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
    '#include <roughnessmap_fragment>\n\troughnessFactor = max( roughnessFactor, 0.35 );'); };
  m.customProgramCacheKey = () => 'atmosGlass1';
  m.userData.atmos = 'glass';
  return (glassMats[t] = m);
}
function preload(style, tier) { skyMaterial(tier); glassMaterial(tier); if (NEAR[style]) loadImg('textures/sky/' + NEAR[style] + '.webp', () => {}); }

/* ---------- the walls: the floor's grid in any of its spellings ---------- */
function wallFn(o, GW, GH) {
  const src = o.grid || o.rows || (o.env && (o.env.grid || o.env.rows)) || (typeof grid !== 'undefined' ? grid : null);
  if (!src) return () => false;
  const out = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH;
  if (ArrayBuffer.isView(src)) return (x, y) => out(x, y) || src[y * GW + x] === 1;
  if (typeof src[0] === 'string') return (x, y) => out(x, y) || src[y].charCodeAt(x) === 49;
  return (x, y) => out(x, y) || src[y][x] === 1;
}

/* ---------- cookies: one atlas of 4 x 4 cells of 128 px, one per (window type, moon side, curtains) ---------- */
// a mullion pattern for a window type when its Blender cookie isn't there (window space: x = u from the u0 side, y = 0 at the top).
// Curtains: Kit draws the same curtain shape for 'open' and 'half' and the bake ignores them, so both only darken the edges here
// (a half-drawn curtain in the beam would be a shadow nothing casts)
function drawPattern(g, x0, y0, type, curtain) {
  const S = CELL, P = { sash: [2, 2, 0.05], tall: [2, 4, 0.035], cellar: [5, 1, 0.07], dormer: [2, 3, 0.05], oculus: [2, 2, 0.06], industrial: [4, 5, 0.03] };
  const base = type.replace(/_short$/, ''), [nc, nr, bw] = P[base] || [2, 2, 0.05];
  g.fillStyle = '#000'; g.fillRect(x0, y0, S, S);
  g.save(); g.beginPath(); g.rect(x0, y0, S, S); g.clip();
  if (base === 'oculus') { g.beginPath(); g.arc(x0 + S / 2, y0 + S / 2, S * 0.47, 0, 2 * PI); g.fillStyle = '#e0e0e0'; g.fill(); }
  else { g.fillStyle = '#dcdcdc'; g.fillRect(x0 + S * 0.03, y0 + S * 0.03, S * 0.94, S * 0.94); }
  g.fillStyle = '#000';
  for (let i = 1; i < nc; i++) g.fillRect(x0 + S * (i / nc - bw / 2), y0, S * bw, S);
  for (let j = 1; j < nr; j++) g.fillRect(x0, y0 + S * (j / nr - bw / 2), S, S * bw * (base === 'sash' && j === nr / 2 ? 1.8 : 1));
  if (curtain) { g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(x0, y0, S * 0.1, S); g.fillRect(x0 + S * 0.9, y0, S * 0.1, S); }
  g.restore();
}
const patGain = new Map();                                     // (a procedural pattern's gain: the same every time, measured once)
function cookieAtlas(list) {
  const c = canvas(CELL * ATL, CELL * ATL), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = ''; tex.generateMipmaps = true; tex.minFilter = 1008; tex.magFilter = LINEAR; tex.wrapS = tex.wrapT = CLAMP;   // (1008: LinearMipmapLinear)
  // each slot's gain: medium's soft-edged opening passes OPEN_MEAN of the light, so a cookie passing less is turned up to match
  // and the beam is as bright on both tiers whatever the window (a uniform, so a late Blender cookie only changes numbers)
  const gain = tex.userData.gain = new Array(ATL * ATL).fill(1);
  const measure = (i, x0, y0) => { let a = 0; try { const d = g.getImageData(x0, y0, CELL, CELL).data; for (let k = 0; k < d.length; k += 4) a += d[k];
    a /= 255 * CELL * CELL; } catch (e) { a = OPEN_MEAN; } gain[i] = clamp(OPEN_MEAN / Math.max(a, 1e-3), 0.5, 3); };
  list.forEach((s, i) => {
    const x0 = (i % ATL) * CELL, y0 = Math.floor(i / ATL) * CELL;
    drawPattern(g, x0, y0, s.type, s.curtain);
    const pk = s.type + '|' + (s.curtain ? 1 : 0); if (patGain.has(pk)) gain[i] = patGain.get(pk); else { measure(i, x0, y0); patGain.set(pk, gain[i]); }
    // the Blender cookie, when there is one (az -30 missing -> +30 mirrored, then 0)
    const put = (img, mir) => { if (!img) return false; g.save(); g.fillStyle = '#000'; g.fillRect(x0, y0, CELL, CELL);
      if (mir) { g.translate(x0 + CELL, y0); g.scale(-1, 1); g.drawImage(img, 0, 0, CELL, CELL); } else g.drawImage(img, x0, y0, CELL, CELL);
      g.restore(); measure(i, x0, y0); tex.needsUpdate = true; return true; };
    const f = b => 'textures/light/cookies/' + s.type + '_' + b + '.webp';
    loadImg(f(s.bk), im => { if (put(im, false)) return;
      const next = () => loadImg(f(0), im3 => put(im3, false));
      if (s.bk === -30) loadImg(f(30), im2 => { if (!put(im2, true)) next(); }); else if (s.bk !== 0) next(); });
  });
  return tex;
}

/* ---------- shafts ---------- */
const SHAFT_V = `
attribute vec4 aU, aV, aN, aS, aB0, aB1, aH;
varying vec4 vU, vV, vN, vS, vB0, vB1, vH; varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; vU = aU; vV = aV; vN = aN; vS = aS; vB0 = aB0; vB1 = aB1; vH = aH;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// the moonlight's way from the window to X: blocked by the tall box b (x0, z0, x1, z1 in m) of height h (h < 0: no box)? N is the
// window's wall map (n, -n . wall), so N . X is how far X is in front of the wall, and the way back runs along uMoonTo that far
const BOXES = `
uniform vec3 uMoonTo;
float unblocked( vec3 X, vec4 b, float h, vec4 N ) {
  if ( h < 0.0 ) return 1.0;
  vec3 M = uMoonTo + vec3( 1e-6 ), iv = 1.0 / M;
  float tm = ( dot( N.xyz, X ) + N.w ) / max( - dot( N.xyz, M ), 1e-4 );
  vec3 t0 = ( vec3( b.x, 0.0, b.y ) - X ) * iv, t1 = ( vec3( b.z, h, b.w ) - X ) * iv, tn = min( t0, t1 ), tf = max( t0, t1 );
  float a = max( max( tn.x, tn.y ), tn.z ), c = min( min( tf.x, tf.y ), tf.z );
  return a <= c && c >= 0.0 && a <= tm ? 0.0 : 1.0;
}`;
const COOKIE = `
uniform sampler2D uCookie;
// lod: the atlas's mip level, from how far apart the march's samples land on the cookie (few samples over a long way would
// otherwise alias the mullions into grain)
float cookie( float slot, vec2 q, float lod ) {
#ifdef USE_COOKIE
  q = clamp( q, 0.008, 0.992 ); float col = mod( slot, 4.0 ), row = floor( slot / 4.0 + 0.01 );
  return textureLod( uCookie, vec2( ( col + q.x ) * 0.25, 1.0 - ( row + 1.0 - q.y ) * 0.25 ), lod ).r;
#else
  vec2 e = smoothstep( 0.0, 0.06, q ) * smoothstep( 0.0, 0.06, 1.0 - q ); return 0.9 * e.x * e.y;
#endif
}`;
const SHAFT_F = `
uniform float uTime, uMoonK, uDensity; uniform vec3 uMoonCol;
#ifdef USE_COOKIE
uniform float uGain[ 16 ];
#endif
varying vec4 vU, vV, vN, vS, vB0, vB1, vH; varying vec3 vW;
${COOKIE}
${BOXES}
float h31( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float vn3( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( h31( i ), h31( i + vec3( 1, 0, 0 ) ), f.x ), mix( h31( i + vec3( 0, 1, 0 ) ), h31( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( h31( i + vec3( 0, 0, 1 ) ), h31( i + vec3( 1, 0, 1 ) ), f.x ), mix( h31( i + vec3( 0, 1, 1 ) ), h31( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }
// one affine constraint lo <= A.x + a <= hi along the ray, narrowing [s0, s1]
void slab( vec4 A, float lo, float hi, vec3 ro, vec3 rd, inout float s0, inout float s1 ) {
  float f0 = dot( A.xyz, ro ) + A.w, fd = dot( A.xyz, rd );
  if ( abs( fd ) < 1e-6 ) { if ( f0 < lo || f0 > hi ) s1 = -1.0; return; }
  float ta = ( lo - f0 ) / fd, tb = ( hi - f0 ) / fd; s0 = max( s0, min( ta, tb ) ); s1 = min( s1, max( ta, tb ) );
}
void main() {
  vec3 ro = cameraPosition, rd = vW - ro; float tb = length( rd ); rd /= tb;
  float s0 = 0.0, s1 = tb;
  slab( vU, vS.x, vS.y, ro, rd, s0, s1 );                       // this slice of the opening (u, back-projected along the moonlight)
  slab( vV, 0.0, 1.0, ro, rd, s0, s1 );                         // the opening's height
  slab( vN, 0.0, 1e4, ro, rd, s0, s1 );                         // in front of the wall
  slab( vec4( 0.0, 1.0, 0.0, 0.0 ), 0.0, 1e4, ro, rd, s0, s1 ); // above the floor
  if ( s1 <= s0 ) discard;
#ifdef USE_COOKIE
  float gn = uGain[ int( vS.z + 0.5 ) ];
#else
  float gn = 1.0;
#endif
  // this hull's sample count (STEPS for a window's one hull, STEPS / 2 for each slice of a split one; the same over the whole hull)
  float ns = vH.z, ds = ( s1 - s0 ) / ns;
  // (samples at the middle of their steps: with the cookie filtered and the noise band-limited to the spacing there is nothing left for
  //  a per-pixel jitter to hide, and with this few samples it only shows as a fine grid)
  float j = 0.5, acc = 0.0;
  vec3 drift = uTime * vec3( 0.03, -0.012, 0.021 );
  float lod = min( log2( max( length( vec2( dot( vU.xyz, rd ), dot( vV.xyz, rd ) ) ) * ds * ${CELL}.0, 1.0 ) ), 5.0 );   // (texels per step; 5: 4 px a cell)
  // the noise band-limited to the march: an octave whose period (0.45 m, 0.19 m) is under two samples' spacing is taken once, at the
  // middle of this pixel's way through the beam (smooth from pixel to pixel), instead of at each sample, where the per-pixel jitter
  // would turn it into grain
  vec3 Xm = ro + rd * ( 0.5 * ( s0 + s1 ) );
  float m1 = vn3( ( Xm + drift ) * 2.2 ), m2 = vn3( ( Xm - drift * 0.7 ) * 5.3 );
  float w1 = 1.0 - smoothstep( 0.1, 0.23, ds ), w2 = 1.0 - smoothstep( 0.04, 0.095, ds );
  for ( int i = 0; i < STEPS; i ++ ) {
    if ( float( i ) >= ns ) break;
    float s = s0 + ( float( i ) + j ) * ds; vec3 X = ro + rd * s;
    vec2 q = vec2( dot( vU.xyz, X ) + vU.w, dot( vV.xyz, X ) + vV.w );
    float n1 = w1 > 0.01 ? mix( m1, vn3( ( X + drift ) * 2.2 ), w1 ) : m1, n2 = w2 > 0.01 ? mix( m2, vn3( ( X - drift * 0.7 ) * 5.3 ), w2 ) : m2;
    float n = n1 * 0.65 + n2 * 0.35;
    acc += cookie( vS.z, q, lod ) * gn * unblocked( X, vB0, vH.x, vN ) * unblocked( X, vB1, vH.y, vN ) * ( 0.2 + 1.6 * n * n * n ) * smoothstep( 0.0, 0.6, s ) * ( 1.0 - smoothstep( 12.0, 14.0, s ) );
  }
  gl_FragColor = vec4( uMoonCol * ( uMoonK * uDensity * acc * ds ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const MOTE_V = `
attribute vec4 aU, aV, aN, aS, aB0, aB1, aH;
uniform float uTime, uPx, uSize;
varying float vA;
${COOKIE}
${BOXES}
void main() {
  float sd = aS.w * 6.2831853;
  vec3 p = position + vec3( sin( uTime * 0.21 + sd * 3.7 ) * 0.08 + sin( uTime * 0.047 + sd * 1.1 ) * 0.16,
                            sin( uTime * 0.13 + sd * 2.3 ) * 0.07 + sin( uTime * 0.031 + sd * 0.5 ) * 0.10,
                            cos( uTime * 0.17 + sd * 1.9 ) * 0.08 + cos( uTime * 0.051 + sd * 1.3 ) * 0.16 );
  vec2 q = vec2( dot( aU.xyz, p ) + aU.w, dot( aV.xyz, p ) + aV.w ); float dp = dot( aN.xyz, p ) + aN.w;
  float inb = step( 0.0, q.x ) * step( q.x, 1.0 ) * step( 0.0, q.y ) * step( q.y, 1.0 ) * step( 0.0, dp ) * step( 0.02, p.y );
  vec4 mv = modelViewMatrix * vec4( p, 1.0 ); float dist = - mv.z;
  vA = inb * cookie( aS.z, q, 0.0 ) * unblocked( p, aB0, aH.x, aN ) * unblocked( p, aB1, aH.y, aN ) * smoothstep( 0.25, 0.6, dist ) * ( 1.0 - smoothstep( 10.0, 14.0, dist ) ) * ( 0.55 + 0.45 * sin( uTime * ( 0.5 + aS.w ) + sd * 8.0 ) );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vA > 0.004 ? max( 1.5, uPx * uSize / max( dist, 0.05 ) ) : 0.0;
}`;
const MOTE_F = `
uniform float uMoonK, uMoteK; uniform vec3 uMoonCol;
varying float vA;
void main() {
  float r = length( gl_PointCoord - 0.5 ) * 2.0; if ( r > 1.0 ) discard;
  gl_FragColor = vec4( uMoonCol * ( uMoonK * uMoteK * vA * ( 1.0 - r ) * ( 1.0 - r ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// the moonlight's direction (it travels from the moon down: -toward) and a window's affine maps world -> (u, v in the opening, distance
// in front of the wall), back-projected along it. Rows [ax, ay, az, a0] so that value = a . X + a0.
function windowMaps(f, w, D) {
  const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), tx = (f.x1 - f.x0) / len, tz = (f.z1 - f.z0) / len, nx = f.nx, nz = f.nz;
  const Dn = D[0] * nx + D[2] * nz, Dt = D[0] * tx + D[2] * tz, k = Dt / Dn, du = w.u1 - w.u0, dv = w.v1 - w.v0;
  const cx = (tx - k * nx) / len, cz = (tz - k * nz) / len, c0 = -(cx * f.x0 + cz * f.z0);
  const U = [cx / du, 0, cz / du, (c0 - w.u0) / du];
  const ky = D[1] / Dn, V = [-nx * ky / dv, 1 / dv, -nz * ky / dv, ((f.x0 * nx + f.z0 * nz) * ky - w.v0) / dv];
  const N = [nx, 0, nz, -(f.x0 * nx + f.z0 * nz)];
  return { U, V, N, len, tx, tz, Dn };
}
// how far along the moonlight D a ray from X (on the wall plane, in front of tile (sx, sy)) runs before the floor, the first wall tile
// (2D grid march) or the first tall box (boxes: [x0, z0, x1, z1, h] in m; the bake's moon stops there too, C3). planes (optional):
// the face of that wall tile is added as a half-space {key, n, d} (keep n . X + d >= 0), 2 cm short of it; out (optional): out.box
// is the same half-space for the box side the ray enters by (the caller decides whether enough of a slice's rays meet it)
function clipRay(X, D, isW, L, sx, sy, planes, boxes, out) {
  const tFloor = D[1] < -1e-6 ? (X[1] - 0.02) / -D[1] : 40;
  let ix = sx, iz = sy;
  const dx = D[0], dz = D[2], stx = dx > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1;
  let tmx = Math.abs(dx) < 1e-9 ? Infinity : ((ix + (dx > 0 ? 1 : 0)) * L - X[0]) / dx, tmz = Math.abs(dz) < 1e-9 ? Infinity : ((iz + (dz > 0 ? 1 : 0)) * L - X[2]) / dz;
  const ddx = Math.abs(dx) < 1e-9 ? Infinity : L / Math.abs(dx), ddz = Math.abs(dz) < 1e-9 ? Infinity : L / Math.abs(dz);
  let tWall = 40, wallPl = null;
  for (let n = 0; n < 64; n++) {
    let t, ax;
    if (tmx < tmz) { t = tmx; ix += stx; tmx += ddx; ax = 0; } else { t = tmz; iz += stz; tmz += ddz; ax = 2; }
    if (t >= tFloor) break;
    if (isW(ix, iz)) {
      tWall = t;
      const st = ax ? stz : stx, c = (ax ? iz : ix) * L + (st > 0 ? 0 : L), nv = [0, 0, 0]; nv[ax] = -st;
      wallPl = { key: ax + ':' + c, n: nv, d: st * c - 0.02 };
      break;
    }
  }
  let tBox = 40, boxPl = null;
  for (const b of boxes || []) {                                // (slab entry of the 3D ray into the box, before the wall and floor)
    let t0 = -Infinity, t1 = Infinity, ax = -1;
    for (const [k, lo, hi] of [[0, b[0], b[2]], [1, 0, b[4]], [2, b[1], b[3]]]) {
      if (Math.abs(D[k]) < 1e-9) { if (X[k] <= lo || X[k] >= hi) { t0 = Infinity; break; } continue; }
      let a1 = (lo - X[k]) / D[k], a2 = (hi - X[k]) / D[k]; if (a1 > a2) { const q = a1; a1 = a2; a2 = q; }
      if (a1 > t0) { t0 = a1; ax = k; } if (a2 < t1) t1 = a2;
    }
    if (!(t0 < t1) || t1 <= 0 || t0 >= tBox || t0 >= Math.min(tWall, tFloor)) continue;
    tBox = Math.max(0, t0);
    if (t0 > 0 && ax !== 1) { const st = D[ax] > 0 ? 1 : -1, lo = ax ? b[1] : b[0], hi = ax ? b[3] : b[2], c = st > 0 ? lo : hi, nv = [0, 0, 0]; nv[ax] = -st;
      boxPl = { key: 'box' + ax + ':' + c, n: nv, d: st * c - 0.02 }; } else boxPl = null;   // (in by its top, or from inside: no plane)
  }
  // (the wall's face always cuts: a box only shortens this ray, and the wall must stop the slice's other rays too)
  if (planes && wallPl && !planes.some(q => q.key === wallPl.key)) planes.push(wallPl);
  if (out) out.box = tBox < Math.min(tWall, tFloor) ? boxPl : null;
  return Math.max(0.05, Math.min(tFloor, tWall - 0.02, tBox - 0.02));
}
// a polygon's normal (Newell's method: sound even when its first corners are nearly in a line)
function polyN(p) {
  const n = [0, 0, 0];
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
  return n;
}
// a box [x0, z0, x1, z1, h] (m) as the 6 polygons cutHull takes
function boxPolys(b) {
  const [x0, z0, x1, z1, h] = b, c = (x, y, z) => [x, y, z];
  return [[c(x0, 0, z0), c(x1, 0, z0), c(x1, 0, z1), c(x0, 0, z1)], [c(x0, h, z0), c(x0, h, z1), c(x1, h, z1), c(x1, h, z0)],
    [c(x0, 0, z0), c(x0, h, z0), c(x1, h, z0), c(x1, 0, z0)], [c(x0, 0, z1), c(x1, 0, z1), c(x1, h, z1), c(x0, h, z1)],
    [c(x0, 0, z0), c(x0, 0, z1), c(x0, h, z1), c(x0, h, z0)], [c(x1, 0, z0), c(x1, h, z0), c(x1, h, z1), c(x1, 0, z1)]];
}
// a convex polyhedron (faces: polygons of [x, y, z]) cut by the half-space n . X + d >= 0, the cut closed with a new face
function cutHull(faces, pl) {
  const side = v => pl.n[0] * v[0] + pl.n[1] * v[1] + pl.n[2] * v[2] + pl.d, out = [], cap = [];
  for (const f of faces) {
    const r = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], sa = side(a), sb = side(b);
      if (sa >= 0) r.push(a);
      if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb), q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; r.push(q); cap.push(q); }
    }
    if (r.length >= 3) out.push(r);
  }
  if (cap.length >= 3) {                                       // (order the cut's points round their centre, in the plane)
    const c = cap.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]).map(v => v / cap.length);
    const n = pl.n, ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]], e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    const ang = v => { const q = [v[0] - c[0], v[1] - c[1], v[2] - c[2]]; return Math.atan2(q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2], q[0] * e1[0] + q[1] * e1[1] + q[2] * e1[2]); };
    const uniq = []; for (const v of cap.sort((a, b) => ang(a) - ang(b))) if (!uniq.length || Math.hypot(v[0] - uniq[uniq.length - 1][0], v[1] - uniq[uniq.length - 1][1], v[2] - uniq[uniq.length - 1][2]) > 1e-6) uniq.push(v);
    if (uniq.length > 2 && Math.hypot(uniq[0][0] - uniq[uniq.length - 1][0], uniq[0][1] - uniq[uniq.length - 1][1], uniq[0][2] - uniq[uniq.length - 1][2]) < 1e-6) uniq.pop();
    if (uniq.length >= 3) out.push(uniq);
  }
  return out;
}

function build(lv, plan, opts) {
  const t0 = now(), o = opts || {}, tier = tierOf(o.tier), U = moonU(), L = plan.L || L0, GW = plan.GW, GH = plan.GH;
  const group = new THREE.Group(); group.name = 'atmos';
  const R = { group, shafts: null, motes: null, sky: [], glass: [], near: null, tier, stats: null, update, dispose };
  const isW = wallFn(o, GW, GH), vh = vhOf((plan.seed | 0) >>> 0), K = Math.max(1, Math.min(6, o.strips | 0 || 3));
  const sky = skyMaterial(tier), glass = glassMaterial(tier);
  if (typeof Kit !== 'undefined' && Kit.setReserved) Kit.setReserved({ glass, sky });

  /* the moon (dress.js: toward it is (sin az, cos az) in x, z) */
  const m = plan.moon, ce = m ? Math.cos(m.el) : 0, se = m ? Math.sin(m.el) : 1, mx = m ? Math.sin(m.az) : 0, mz = m ? Math.cos(m.az) : 1;
  A.uMoonTo.value.set(mx * ce, se, mz * ce);
  const D = [-mx * ce, -se, -mz * ce];

  /* sky and glass on the windows already built (Kit.furnish or Arch.modules) */
  if (lv && lv.group) {
    const res = lv.kit && lv.kit.reserved, rs = new Set(res ? res.sky || [] : []), rg = new Set(res ? res.glass || [] : []);
    const winish = obj => { for (let q = obj; q && q !== lv.group; q = q.parent) {
      const k = q.userData && q.userData.kit; if (/^Win_|arch_mod_window/.test(q.name || '') || (k && k.kind === 'window')) return true; } return false; };
    lv.group.traverse(q => {
      if (!q.isMesh || q.userData.atmos) return;
      const mats = Array.isArray(q.material) ? q.material : [q.material];
      let sw = false, gw = false;
      const out = mats.map(x => {
        if (rs.has(q) || (x && x.name === 'SkyPlane') || /(_sky$|^SkyPlane)/.test(q.name || '')) { sw = true; return sky; }
        if (rg.has(q) || (x && /^(Glass|KitGlass)/.test(x.name) && winish(q)) || (/_glass$/.test(q.name || '') && winish(q))) { gw = true; return glass; }
        return x;
      });
      if (sw || gw) { q.material = Array.isArray(q.material) ? out : out[0]; if (sw) R.sky.push(q); if (gw) R.glass.push(q); }
    });
  }

  /* own sky planes, for a house whose walls have the openings but no kit windows */
  const owned = [];
  if (o.skyPlanes) {
    const pos = [];
    for (const w of plan.windows) { const f = plan.faces[w.face]; if (!f) continue;
      const P = (u, v, d) => [f.x0 + (f.x1 - f.x0) * u - f.nx * d, v, f.z0 + (f.z1 - f.z0) * u - f.nz * d];
      // (C6: 0.9 m behind the glass but no deeper than 1.0 m into the border wall tile, so 1.0; behind the near layer at 0.83 m)
      // (wider than the opening, for the parallax at that depth, within u 0.05..0.95 of the face)
      const ua = Math.min(w.u0 - 0.03, Math.max(0.05, w.u0 - 0.25)), ub = Math.max(w.u1 + 0.03, Math.min(0.95, w.u1 + 0.25)), va = Math.max(0, w.v0 - 0.4), vb = w.v1 + 0.4;
      const a = P(ua, va, SKY_D), b = P(ub, va, SKY_D), c = P(ub, vb, SKY_D), e = P(ua, vb, SKY_D);
      pos.push(...a, ...c, ...b, ...a, ...e, ...c); }
    if (pos.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      const sm = newSky(); sm.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(g, sm); mesh.name = 'atmos_sky'; group.add(mesh); R.sky.push(mesh); owned.push(mesh);
    }
  }

  /* the near layer (cellar light well, attic roofs): when its picture exists */
  const nearName = NEAR[plan.style];
  if (nearName && plan.windows.length) loadImg('textures/sky/' + nearName + '.webp', img => {
    if (!img || R.disposed) return;
    const tex = new THREE.CanvasTexture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = CLAMP;
    const pos = [], uv = [], dn = GLASS_D + NEAR_D;
    for (const w of plan.windows) { const f = plan.faces[w.face]; if (!f) continue;
      const P = (u, v) => [f.x0 + (f.x1 - f.x0) * u - f.nx * dn, v, f.z0 + (f.z1 - f.z0) * u - f.nz * dn];
      const u0 = w.u0 - 0.1, u1 = w.u1 + 0.1, v0 = w.v0 - 0.25, v1 = w.v1 + 0.25, q = [[u0, v0, 0, 0], [u1, v0, 1, 0], [u1, v1, 1, 1], [u0, v0, 0, 0], [u1, v1, 1, 1], [u0, v1, 0, 1]];
      for (const [u, v, a, b] of q) { pos.push(...P(u, v)); uv.push(a, b); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    const mat = new THREE.ShaderMaterial({ name: 'AtmosNear', fog: false, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uMap: { value: tex }, uExposure: A.uExposure },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: 'uniform sampler2D uMap; uniform float uExposure; varying vec2 vUv;\nvoid main() { vec4 t = texture2D( uMap, vUv ); gl_FragColor = vec4( t.rgb * uExposure, t.a );\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
    mat.userData.disposables = [tex];
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'atmos_near'; mesh.userData.atmos = true; mesh.renderOrder = -1; group.add(mesh); R.near = mesh; owned.push(mesh);
  });

  /* shafts and motes: moonlit windows, medium and high */
  // the tall boxes (C3: they stop the bake's moonlight), from opts.solids, the env's or the game's SOLIDS (u -> m)
  const sol = o.solids || (o.env && (o.env.solids || o.env.SOLIDS)) || (typeof SOLIDS !== 'undefined' ? SOLIDS : []) || [];
  const tall = sol.map(q => Array.isArray(q) && typeof decodeSolid === 'function' ? decodeSolid(q) : q)
    .filter(q => q && q.occ === 'tall').map(q => [q.x0 * UM, q.y0 * UM, q.x1 * UM, q.y1 * UM, q.h || 1]);
  const lit = m ? plan.windows.map((w, i) => ({ w, i, f: plan.faces[w.face] })).filter(x => x.w.moonlit && x.f && D[0] * x.f.nx + D[2] * x.f.nz > 1e-3) : [];
  const slots = [], slotOf = new Map();
  const useCookie = tier === 'hi';
  for (const x of lit) {
    const f = x.f, len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), out = -(f.nx * mx + f.nz * mz);
    const rel = Math.atan2(mx * (f.x1 - f.x0) / len + mz * (f.z1 - f.z0) / len, out) * 180 / PI, bk = rel > 15 ? 30 : rel < -15 ? -30 : 0;
    const cur = x.w.curtain ? 1 : 0, key = x.w.type + '|' + bk + '|' + cur;
    if (!slotOf.has(key) && slots.length < ATL * ATL) { slotOf.set(key, slots.length); slots.push({ type: x.w.type, bk, curtain: cur }); }
    x.slot = slotOf.has(key) ? slotOf.get(key) : 0; x.maps = windowMaps(f, x.w, D);
  }
  let atlas = null, nMerged = 0, boxOver = 0;
  const NOBOX = [0, 0, 0, 0];
  if (tier !== 'lo' && lit.length) {
    if (useCookie) atlas = cookieAtlas(slots);
    const P = [], aU = [], aV = [], aN = [], aS = [], idx = [];
    lit.forEach((x, k) => { x.k = k; });
    const STEPS = tier === 'hi' ? 8 : 4, aB0 = [], aB1 = [], aH = [];
    for (const x of lit) {
      const f = x.f, w = x.w, M = x.maps;
      const e = 0.005 / M.Dn, at = (u, v) => [f.x0 + (f.x1 - f.x0) * u + D[0] * e, v + D[1] * e, f.z0 + (f.z1 - f.z0) * u + D[2] * e];   // (5 mm in, along the light)
      // each slice of the opening is cut by the floor and by the face of every wall tile its corner and middle rays meet (the 2D
      // march), and by the side of a tall box most of them (5 of the 9) run into: a convex hull, so every view ray leaves it through
      // exactly one back face
      const cutsOf = (ua, ub) => {
        const planes = [{ key: 'floor', n: [0, 1, 0], d: -0.02 }], um = (ua + ub) / 2, vm = (w.v0 + w.v1) / 2, votes = new Map(), hit = {};
        for (const X of [at(ua, w.v0), at(ub, w.v0), at(ub, w.v1), at(ua, w.v1), at(um, w.v0), at(um, vm), at(um, w.v1), at(ua, vm), at(ub, vm)]) {
          clipRay(X, D, isW, L, f.x, f.y, planes, tall, hit);
          if (hit.box) { const v = votes.get(hit.box.key) || { pl: hit.box, n: 0 }; v.n++; votes.set(hit.box.key, v); }
        }
        for (const v of votes.values()) if (v.n >= 5) planes.push(v.pl);
        return planes;
      };
      const cuts = []; for (let k = 0; k < K; k++) cuts.push(cutsOf(w.u0 + (w.u1 - w.u0) * k / K, w.u0 + (w.u1 - w.u0) * (k + 1) / K));
      // when every slice gets the same cuts, one hull for the whole opening is the same shape and a view ray through the beam takes
      // STEPS samples (C6's N). A split window's slices take max(ceil(STEPS / K), STEPS / 2) each (high 4, medium 2): fewer than
      // that alias the mullions into speckles, so a ray through all K takes about 1.5 STEPS, not K x STEPS
      const sig = c => c.map(q => q.key).sort().join('|'), one = cuts.every(c => sig(c) === sig(cuts[0])), nk = one ? 1 : K;
      const steps = Math.max(Math.ceil(STEPS / nk), STEPS / 2); if (one) nMerged++;
      x.nk = nk; x.slicePlanes = []; x.hullBoxes = [];
      for (let k = 0; k < nk; k++) {
        const ua = w.u0 + (w.u1 - w.u0) * k / nk, ub = w.u0 + (w.u1 - w.u0) * (k + 1) / nk, planes = one ? cuts[0] : cuts[k];
        const near = [at(ua, w.v0), at(ub, w.v0), at(ub, w.v1), at(ua, w.v1)], far = near.map(X => [X[0] + D[0] * 14, X[1] + D[1] * 14, X[2] + D[2] * 14]);
        let hull = [[near[0], near[3], near[2], near[1]], [far[0], far[1], far[2], far[3]], [near[0], near[1], far[1], far[0]], [near[1], near[2], far[2], far[1]],
          [near[2], near[3], far[3], far[2]], [near[3], near[0], far[0], far[3]]];
        for (const pl of planes) hull = cutHull(hull, pl);
        x.slicePlanes[k] = planes;
        const pts = [].concat(...hull), cx = pts.reduce((s, v) => s + v[0], 0) / pts.length, cy = pts.reduce((s, v) => s + v[1], 0) / pts.length, cz = pts.reduce((s, v) => s + v[2], 0) / pts.length;
        // the tall boxes inside this hull (a column narrower than the beam can't be cut out of a convex hull): the shader darkens
        // every sample whose way back to the window passes through one, the 2 nearest the window (the bake's moon stops there too)
        const inward = hull.map(poly => { const n = polyN(poly), fc = poly.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]).map(v => v / poly.length);
          const sg = n[0] * (fc[0] - cx) + n[1] * (fc[1] - cy) + n[2] * (fc[2] - cz) < 0 ? 1 : -1, nn = [n[0] * sg, n[1] * sg, n[2] * sg];
          return { n: nn, d: -(nn[0] * poly[0][0] + nn[1] * poly[0][1] + nn[2] * poly[0][2]) }; });
        const fd = f.x0 * f.nx + f.z0 * f.nz;
        const inb = tall.filter(b => inward.reduce((h, pl) => h.length ? cutHull(h, pl) : h, boxPolys(b)).length)
          .sort((a, b) => ((a[0] + a[2]) / 2 * f.nx + (a[1] + a[3]) / 2 * f.nz - fd) - ((b[0] + b[2]) / 2 * f.nx + (b[1] + b[3]) / 2 * f.nz - fd));
        if (inb.length > 2) boxOver++;
        const b0 = inb[0], b1 = inb[1]; x.hullBoxes[k] = inb.slice(0, 2);
        for (const poly of hull) {
          const b = P.length / 3;
          for (const v of poly) { P.push(v[0], v[1], v[2]); aU.push(...M.U); aV.push(...M.V); aN.push(...M.N); aS.push(k / nk, (k + 1) / nk, x.slot, x.k);
            aB0.push(...(b0 ? b0.slice(0, 4) : NOBOX)); aB1.push(...(b1 ? b1.slice(0, 4) : NOBOX)); aH.push(b0 ? b0[4] : -1, b1 ? b1[4] : -1, steps, 0); }
          // fan triangles wound outward (the material draws back faces)
          const n = polyN(poly), fc = poly.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]).map(v => v / poly.length), flip = n[0] * (fc[0] - cx) + n[1] * (fc[1] - cy) + n[2] * (fc[2] - cz) < 0;
          for (let i = 1; i < poly.length - 1; i++) if (flip) idx.push(b, b + i + 1, b + i); else idx.push(b, b + i, b + i + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(aU), 4)); g.setAttribute('aV', new THREE.BufferAttribute(new Float32Array(aV), 4));
    g.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(aN), 4)); g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(aS), 4));
    g.setAttribute('aB0', new THREE.BufferAttribute(new Float32Array(aB0), 4)); g.setAttribute('aB1', new THREE.BufferAttribute(new Float32Array(aB1), 4));
    g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(aH), 4));
    g.setIndex(idx); g.computeBoundingSphere();
    const sm = new THREE.ShaderMaterial({ name: 'AtmosShafts', vertexShader: SHAFT_V, fragmentShader: SHAFT_F, fog: false, transparent: true, depthWrite: false,
      side: BACK, blending: THREE.AdditiveBlending, defines: Object.assign({ STEPS }, useCookie ? { USE_COOKIE: '' } : {}),
      uniforms: { uTime: A.uTime, uMoonTo: A.uMoonTo, uMoonCol: U.uMoonCol, uMoonK: U.uMoonK, uDensity: { value: o.shaftDensity || 0.09 }, uCookie: { value: atlas },
        uGain: { value: atlas ? atlas.userData.gain : new Array(ATL * ATL).fill(1) } } });
    sm.userData.disposables = atlas ? [atlas] : [];
    const mesh = new THREE.Mesh(g, sm); mesh.name = 'atmos_shafts'; mesh.renderOrder = 2; mesh.frustumCulled = true;
    group.add(mesh); R.shafts = mesh;

    /* motes (high only) */
    if (tier === 'hi') {
      const per = Math.min(MOTES_PER, Math.floor(MOTES_MAX / lit.length)), mp = [], mU = [], mV = [], mN = [], mS = [], mB0 = [], mB1 = [], mH = [];
      for (const x of lit) { const f = x.f, w = x.w, M = x.maps;
        for (let j = 0; j < per; j++) {
          const u = w.u0 + (w.u1 - w.u0) * (0.04 + 0.92 * vh(x.i * 131 + j, 7, 951)), v = w.v0 + (w.v1 - w.v0) * (0.04 + 0.92 * vh(x.i * 131 + j, 8, 952));
          const X = [f.x0 + (f.x1 - f.x0) * u, v, f.z0 + (f.z1 - f.z0) * u];
          let t = clipRay(X, D, isW, L, f.x, f.y, null, tall) * (0.08 + 0.84 * vh(x.i * 131 + j, 9, 953));
          const hk = Math.min(x.nk - 1, Math.floor((u - w.u0) / (w.u1 - w.u0) * x.nk)), pls = x.slicePlanes[hk] || [], hb = x.hullBoxes[hk] || [];
          const inside = t => pls.every(q => q.n[0] * (X[0] + D[0] * t) + q.n[1] * (X[1] + D[1] * t) + q.n[2] * (X[2] + D[2] * t) + q.d >= 0);
          for (let n = 0; n < 8 && !inside(t); n++) t *= 0.6;
          mp.push(X[0] + D[0] * t, X[1] + D[1] * t, X[2] + D[2] * t); mU.push(...M.U); mV.push(...M.V); mN.push(...M.N); mS.push(0, 1, x.slot, vh(x.i * 131 + j, 10, 954));
          mB0.push(...(hb[0] ? hb[0].slice(0, 4) : NOBOX)); mB1.push(...(hb[1] ? hb[1].slice(0, 4) : NOBOX)); mH.push(hb[0] ? hb[0][4] : -1, hb[1] ? hb[1][4] : -1, 0, 0);
        } }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mp), 3));
      mg.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(mU), 4)); mg.setAttribute('aV', new THREE.BufferAttribute(new Float32Array(mV), 4));
      mg.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(mN), 4)); mg.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(mS), 4));
      mg.setAttribute('aB0', new THREE.BufferAttribute(new Float32Array(mB0), 4)); mg.setAttribute('aB1', new THREE.BufferAttribute(new Float32Array(mB1), 4));
      mg.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(mH), 4));
      mg.computeBoundingSphere(); if (mg.boundingSphere) mg.boundingSphere.radius += 0.5;     // (they drift up to 0.3 m)
      const pm = new THREE.ShaderMaterial({ name: 'AtmosMotes', vertexShader: MOTE_V, fragmentShader: MOTE_F, fog: false, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, defines: { USE_COOKIE: '' },
        uniforms: { uTime: A.uTime, uMoonTo: A.uMoonTo, uMoonCol: U.uMoonCol, uMoonK: U.uMoonK, uPx: { value: 300 }, uSize: { value: 0.006 }, uMoteK: { value: o.moteK || 1.6 }, uCookie: { value: atlas } } });
      const pts = new THREE.Points(mg, pm); pts.name = 'atmos_motes'; pts.renderOrder = 3;
      const sz = new THREE.Vector2();
      pts.onBeforeRender = (r, s, cam) => { r.getDrawingBufferSize(sz); pm.uniforms.uPx.value = sz.y * 0.5 * cam.projectionMatrix.elements[5]; };
      group.add(pts); R.motes = pts;
    }
  }
  R.stats = { tier, windows: plan.windows.length, moonlit: lit.length, strips: K, shaftVerts: R.shafts ? R.shafts.geometry.attributes.position.count : 0,
    steps: R.shafts ? (tier === 'hi' ? 8 : 4) : 0, merged: nMerged, boxOverflow: boxOver, tallBoxes: tall.length, cookie: !!atlas, cookieSlots: slots.length, motes: R.motes ? R.motes.geometry.attributes.position.count : 0,
    sky: R.sky.length, glass: R.glass.length, ms: Math.round((now() - t0) * 10) / 10 };
  group.traverse(q => { q.userData.atmos = true; });
  if (lv && lv.group) lv.group.add(group);
  last = R;

  function update(t) { if (Number.isFinite(t)) A.uTime.value = t; }
  function dispose() {
    R.disposed = true; if (group.parent) group.parent.remove(group);
    for (const ob of [R.shafts, R.motes, ...owned]) { if (!ob) continue; ob.geometry.dispose(); (ob.material.userData.disposables || []).forEach(t => t.dispose()); ob.material.dispose(); }
    if (last === R) last = null;
  }
  return R;
}
let last = null;

/* ---------- the flashlight's bounce (C7) ---------- */
const bounce = (() => {
  const DEF = { floor: [0.30, 0.22, 0.15], wall: [0.45, 0.40, 0.34], ceiling: [0.62, 0.60, 0.56], box: [0.30, 0.25, 0.20] };
  let aura = null, flash = null, base = null, alb = Object.assign({}, DEF);
  const cur = { p: new THREE.Vector3(), col: new THREE.Color(), i: 0, started: false };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tcol = new THREE.Color();
  const lin = c => Array.isArray(c) ? c : (tcol.set(c), [tcol.r, tcol.g, tcol.b]);
  function setAlbedo(a) { if (a) for (const k of Object.keys(DEF)) if (a[k] !== undefined && a[k] !== null) alb[k] = lin(a[k]); return alb; }
  function init(a, f, scene, o) {
    aura = a; flash = f;
    base = { color: a.color.clone(), intensity: a.intensity, distance: a.distance, decay: a.decay };
    if (scene && a.parent !== scene) { a.updateWorldMatrix(true, false); a.getWorldPosition(cur.p); scene.add(a); a.position.copy(cur.p); }
    cur.col.copy(a.color); cur.i = a.intensity; cur.started = true;
    if (o && o.albedo) setAlbedo(o.albedo);
  }
  // the game's walls, ceilings and boxes (or env's)
  function gameEnv() {
    const ok = typeof grid !== 'undefined' && grid && typeof GW !== 'undefined';
    return {
      L: L0,
      wall: ok ? (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || grid[y][x] === 1 : () => false,
      ceil: typeof ceilAtXZ === 'function' ? ceilAtXZ : typeof ceilAt === 'function' ? (x, z) => ceilAt(Math.floor(x / L0), Math.floor(z / L0)) : () => 3,
      solids: typeof SOLIDS !== 'undefined' && SOLIDS ? SOLIDS : [],
    };
  }
  // the ray from o (m) along unit d: the first floor, ceiling, wall-tile or box surface within maxD, by 0.1 m steps (each refined exactly)
  function cast(o, d, maxD, env) {
    const E = env || gameEnv(), L = E.L || L0, step = 0.1, mD = maxD || 12, sol = E.solids || [];
    const ox = o[0] !== undefined ? o[0] : o.x, oy = o[1] !== undefined ? o[1] : o.y, oz = o[2] !== undefined ? o[2] : o.z;
    let dx = d[0] !== undefined ? d[0] : d.x, dy = d[1] !== undefined ? d[1] : d.y, dz = d[2] !== undefined ? d[2] : d.z;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const at = t => [ox + dx * t, oy + dy * t, oz + dz * t], res = (kind, t, n, extra) => Object.assign({ hit: true, kind, p: at(t), n, dist: t }, extra || {});
    if (E.wall(Math.floor(ox / L), Math.floor(oz / L))) return res('wall', 0, [-dx, 0, -dz]);
    // boxes near the ray's plan path (u -> m)
    const boxes = [];
    sol.forEach((s, i) => { const x0 = s.x0 * UM, x1 = s.x1 * UM, z0 = s.y0 * UM, z1 = s.y1 * UM, h = s.h || 1;
      const lo = [Math.min(ox, ox + dx * mD), Math.min(oz, oz + dz * mD)], hi = [Math.max(ox, ox + dx * mD), Math.max(oz, oz + dz * mD)];
      if (x1 >= lo[0] && x0 <= hi[0] && z1 >= lo[1] && z0 <= hi[1]) boxes.push({ i, b: [x0, 0, z0, x1, h, z1] }); });
    let ix = Math.floor(ox / L), iz = Math.floor(oz / L);
    const stx = dx > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1, ddx = Math.abs(dx) < 1e-9 ? Infinity : L / Math.abs(dx), ddz = Math.abs(dz) < 1e-9 ? Infinity : L / Math.abs(dz);
    let tmx = Math.abs(dx) < 1e-9 ? Infinity : ((ix + (dx > 0 ? 1 : 0)) * L - ox) / dx, tmz = Math.abs(dz) < 1e-9 ? Infinity : ((iz + (dz > 0 ? 1 : 0)) * L - oz) / dz;
    const g = t => { const p = at(t); return p[1] - E.ceil(p[0], p[2]); };
    // the ceiling's normal at p from its slope, sampled only inside p's own tile (a sample across a wall or a ceiling step would
    // read the neighbour's ceiling and tilt the normal into the wall): one-sided next to the tile's edge, flat when it is flat
    const ceilN = p => {
      const e = 0.05, tx = Math.floor(p[0] / L), tz = Math.floor(p[2] / L), c = E.ceil(p[0], p[2]);
      const sl = (xa, za, xb, zb) => { const ia = Math.floor(xa / L) === tx && Math.floor(za / L) === tz, ib = Math.floor(xb / L) === tx && Math.floor(zb / L) === tz;
        return ia && ib ? (E.ceil(xb, zb) - E.ceil(xa, za)) / (2 * e) : ib ? (E.ceil(xb, zb) - c) / e : ia ? (c - E.ceil(xa, za)) / e : 0; };
      const cx = sl(p[0] - e, p[2], p[0] + e, p[2]), cz = sl(p[0], p[2] - e, p[0], p[2] + e), nl = Math.hypot(cx, 1, cz);
      return [cx / nl, -1 / nl, cz / nl];
    };
    for (let ta = 0; ta < mD; ta += step) {
      const tb = Math.min(mD, ta + step);
      let best = null;
      const take = (t, kind, n, extra) => { if (t >= ta - 1e-9 && t <= tb + 1e-9 && (!best || t < best.t)) best = { t: Math.max(0, t), kind, n, extra }; };
      if (dy < 0 && oy + dy * tb <= 0) take(-oy / dy, 'floor', [0, 1, 0]);
      // the tiles the step crosses into (exact entry); a wall tile ends it
      const cuts = []; let wl = null;
      while (Math.min(tmx, tmz) <= tb) {
        let t, n;
        if (tmx < tmz) { t = tmx; ix += stx; tmx += ddx; n = [-stx, 0, 0]; } else { t = tmz; iz += stz; tmz += ddz; n = [0, 0, -stz]; }
        if (E.wall(ix, iz)) { wl = { t, n }; break; }
        cuts.push(t);
      }
      // the ceiling: each piece of the step inside one tile is checked at its end, just short of the next tile (whose ceiling may
      // be higher, or be a wall's), then bisected to the surface
      let sa = ta;
      const ends = cuts.map(t => t - 1e-5).concat([wl ? wl.t - 1e-5 : tb]);
      for (let k = 0; k < ends.length; k++) {
        const se = Math.max(sa, ends[k]);
        if (g(se) >= 0) {
          let a = sa, b2 = se; if (g(a) >= 0) b2 = a; else for (let q = 0; q < 16; q++) { const mm = (a + b2) / 2; if (g(mm) >= 0) b2 = mm; else a = mm; }
          take(b2, 'ceiling', ceilN(at(b2)));
          break;
        }
        sa = k < cuts.length ? cuts[k] + 1e-5 : sa;
      }
      if (wl) take(wl.t, 'wall', wl.n);
      for (const B of boxes) {                                             // boxes: slab entry within this step
        const b = B.b; let t0 = -Infinity, t1 = Infinity, ax = -1;
        for (let k = 0; k < 3; k++) { const oo = [ox, oy, oz][k], dd = [dx, dy, dz][k], lo = b[k], hi = b[k + 3];
          if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) { t0 = Infinity; break; } continue; }
          let a1 = (lo - oo) / dd, a2 = (hi - oo) / dd; if (a1 > a2) { const s = a1; a1 = a2; a2 = s; }
          if (a1 > t0) { t0 = a1; ax = k; } if (a2 < t1) t1 = a2; }
        if (t0 <= t1 && t0 >= 0 && ax >= 0) { const n = [0, 0, 0]; n[ax] = [dx, dy, dz][ax] > 0 ? -1 : 1; take(t0, 'box', n, { box: B.i }); }
      }
      if (best) return res(best.kind, best.t, best.n, best.extra);
    }
    return { hit: false, kind: null, p: at(mD), n: [-dx, -dy, -dz], dist: mD };
  }
  // is a point inside something (a wall tile, under the floor, above the ceiling, in a box)? (the aura must not light through it)
  function solidAt(q, E) {
    const L = E.L || L0;
    if (E.wall(Math.floor(q[0] / L), Math.floor(q[2] / L)) || q[1] <= 0 || q[1] >= E.ceil(q[0], q[2])) return true;
    return (E.solids || []).some(s => q[0] > s.x0 * UM && q[0] < s.x1 * UM && q[2] > s.y0 * UM && q[2] < s.y1 * UM && q[1] < (s.h || 1));
  }
  function update(dt, camera, f, hidden, dist) {
    if (!aura) return null;
    const fl = f || flash;
    if (hidden || !fl || !camera) {                                        // in a wardrobe: today's light around you
      if (camera) { camera.updateWorldMatrix(true, false); camera.getWorldPosition(cur.p); }
      cur.i = typeof hidden === 'number' ? hidden : 3.2; cur.col.copy(base.color);
      aura.position.copy(cur.p); aura.color.copy(cur.col); aura.intensity = cur.i; aura.distance = dist > 0 ? dist : 8; aura.decay = base.decay;
      return null;
    }
    fl.updateWorldMatrix(true, false); fl.getWorldPosition(tmp);
    fl.target.updateWorldMatrix(true, false); fl.target.getWorldPosition(tmp2); tmp2.sub(tmp).normalize();
    const E = gameEnv(), h = cast([tmp.x, tmp.y, tmp.z], [tmp2.x, tmp2.y, tmp2.z], 12, E);
    // 0.35 m off the surface; if that is inside something (a corner, a step in the ceiling), back along the beam instead, which is
    // open all the way to the camera
    let q = [h.p[0] + 0.35 * h.n[0], h.p[1] + 0.35 * h.n[1], h.p[2] + 0.35 * h.n[2]];
    if (h.hit && solidAt(q, E)) { const b = Math.min(0.35, h.dist); q = [h.p[0] - b * tmp2.x, h.p[1] - b * tmp2.y, h.p[2] - b * tmp2.z]; }
    let ti = 0; const tc = tcol.copy(fl.color), tp = tmp.set(q[0], q[1], q[2]);
    if (h.hit) { const a = alb[h.kind] || DEF.wall, rho = (a[0] + a[1] + a[2]) / 3;
      tc.r *= a[0] / Math.max(rho, 1e-3); tc.g *= a[1] / Math.max(rho, 1e-3); tc.b *= a[2] / Math.max(rho, 1e-3);
      ti = 2.5 * rho * fl.intensity / 25 / (1 + 0.08 * h.dist * h.dist); }
    const k = Number.isFinite(dt) && dt > 0 ? 1 - Math.pow(0.75, dt * 60) : 0.25;
    cur.p.lerp(tp, k); cur.col.lerp(tc, k); cur.i += (ti - cur.i) * k;
    aura.position.copy(cur.p); aura.color.copy(cur.col); aura.intensity = cur.i; aura.distance = 5.5; aura.decay = 2;
    return h;
  }
  return { init, update, cast, solidAt: (q, env) => solidAt(q, env || gameEnv()), setAlbedo, albedo: () => alb, state: () => ({ p: cur.p.toArray(), col: cur.col.toArray(), i: cur.i }) };
})();

window.Atmos = { build, update: t => { if (last) last.update(t); }, bounce, skyMaterial, glassMaterial, preload,
  _internal: { windowMaps, clipRay, cutHull, wallFn, cookieAtlas } };
})();
