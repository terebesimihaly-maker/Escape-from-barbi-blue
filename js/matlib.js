/* Escape from Barbi Blue: the materials of the realistic house and their shader patches (spec C5, C8, C10, D1, D4, D7).
   Every lit surface of a floor belongs to one of a few material families, each with ONE program per tier:
     floorMaterial    the floor: Blender boards/tiles, the baked plan lightmap (the lamps), the flickering lamps, moonlight, and the
                      floor overlays of js/surface.js (corner shade, dust, wet patches, walked paths, wear); parallax on High
     ceilingMaterial  ceiling tiles: the plan lightmap through uv1
     wallMaterial     walls: their cell of the wall lightmap atlas through uv1, its AO, flicker and moon; parallax on High
     decalMaterial    wall decals: lit exactly like the wall behind them (they carry their face's uv1)
     withLightField   anything else (furniture, trims, doors, wardrobes, dolls, her and teammates): the baked light field where it stands
     emissiveMaterial / emissiveMesh, glowMaterial / glowPoints   the lamps themselves: bulbs, and one glow sprite each (1 draw for all)
   The lamps' light is baked (js/lightbake.js). What changes while playing (scares dimming the lamps, the dark scare, flickering,
   time) is only written into the shared uniforms U, so nothing recompiles during play (H13). Tier is fixed when a material is made.
     level build:   MatLib.tier = settings.quality; make the materials; MatLib.setLevelMaps({ ...LightBaker.bake(...), ...surface maps, GW, GH });
                    MatLib.setFlick(levels, colours) (the colours of the flicker groups, once)
     every frame:   MatLib.setK(scares.dim, house.dark, calm, dt); MatLib.setFlick(levels); MatLib.setTime(t)
     disposeLevel:  MatLib.releaseLevel()   (the level's textures are also in material.userData.disposables, E5)
   clone() of any of these materials (or of one given the light field) is the same kind of material again, patch included; a clone
   owns no textures (its userData.disposables starts empty), so cloning never serialises the level's pictures.
   This three.js build has no texture loader and no data-texture class: data maps are ImageData -> CanvasTexture (dataTexture). */
(function () {
'use strict';

const TIERS = { low: 0, medium: 1, high: 2, lo: 0, md: 1, hi: 2 };   // (settings.quality, or the kit's asset tier)
const NOCS = '', CLAMP = 1001, NEAREST = 1003, LINEAR = 1006, EQUIRECT = 303;   // (constants this build doesn't export)

/* ---------- the shared uniforms: one object for every material, so one write reaches them all ---------- */
const U = {
  uLampK: { value: 1 },                                   // every lamp: scares.dim, 0 in the dark scare
  uMoonK: { value: 1 },                                   // the moon (never goes out)
  uMoonCol: { value: new THREE.Color(0x8fa6d8) },
  uMoonDir: { value: new THREE.Vector3(0.35, -0.53, 0.77).normalize() },   // the way moonlight travels (from the moon down)
  uEMax: { value: 4 },                                    // lightmaps hold E / uEMax
  uFlick: { value: new Float32Array(16).fill(1) },        // level of each flicker group (0..15)
  uFlickCol: { value: Array.from({ length: 16 }, () => new THREE.Color(1, 0.75, 0.5)) },
  uFlickId: { value: null },                              // GW x GH: R = flicker group + 1 (0: none)
  uPlan: { value: new THREE.Vector2(1, 1) },              // 1 / (GW L), 1 / (GH L): world xz -> plan uv
  uTime: { value: 0 },
  uLF0: { value: null }, uLF1: { value: null },           // the light field at 1.1 m (C4)
  uFloorAux: { value: null }, uCeilAux: { value: null }, uWallAux: { value: null },
  // the floor overlays (D1) and the ceiling's (D6)
  uSurf: { value: null }, uOverlay: { value: null }, uTileInfo: { value: null },
  uDetail: { value: null },                               // the detail tiles, packed: R dust_detail, G wet_edge (one sampler)
  uDetailRep: { value: 1 / 2.25 },                        // detail tiles per metre
  uDustCol: { value: new THREE.Color(0x7d766c) }, uCeilOv: { value: null },
};

/* ---------- data textures ---------- */
// bytes -> texture without a 2D canvas (a canvas premultiplies alpha, which destroys the colour wherever alpha is low: H14).
// src: ImageData, { data: RGBA bytes, w, h } (or width/height), or a texture (returned as it is). Row 0 is the top of the plan
// (v = 1, grid row 0), as plan uv = (x / W, 1 - z / H). o: { srgb, nearest, mips: false, repeat, channel, flipY: false }
function dataTexture(src, o = {}) {
  if (!src) return null;
  if (src.isTexture) return src;
  let img = src;
  if (typeof ImageData === 'undefined' || !(src instanceof ImageData)) {
    const d = src.data, w = src.w || src.width, h = src.h || src.height;
    img = new ImageData(d instanceof Uint8ClampedArray ? d : new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength), w, h);
  }
  const t = new THREE.CanvasTexture(img);
  t.colorSpace = o.srgb ? THREE.SRGBColorSpace : NOCS;   // (sRGB: the GPU decodes RGB; alpha always stays linear)
  t.wrapS = t.wrapT = o.repeat ? THREE.RepeatWrapping : CLAMP;
  if (o.nearest) { t.magFilter = t.minFilter = NEAREST; t.generateMipmaps = false; }
  else if (o.mips === false) { t.minFilter = LINEAR; t.generateMipmaps = false; }
  t.flipY = o.flipY !== false;
  if (o.channel) t.channel = o.channel;
  return t;
}

// stand-ins until the level's maps arrive: every material always has all its textures, so its program never changes shape
let P = null;
function solid(r, g, b, a, srgb, channel) {
  return dataTexture({ data: new Uint8ClampedArray([r, g, b, a]), w: 1, h: 1 }, { srgb, nearest: true, channel });
}
function ensure() {
  if (P) return P;
  P = { white: solid(255, 255, 255, 255, true), black0: solid(0, 0, 0, 0, true), black1: solid(0, 0, 0, 0, true, 1),
    flatN: solid(128, 128, 255, 255), orh: solid(255, 235, 255, 255), aux: solid(0, 0, 255, 255), lf1: solid(128, 128, 255, 0),
    zero: solid(0, 0, 0, 0), detail: solid(255, 255, 255, 255) };
  // (a dim equirect for the wet floor's reflections until the style's env map is given)
  const w = 16, h = 8, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, up = 1 - y / (h - 1); d[i] = 6 + 14 * up; d[i + 1] = 7 + 16 * up; d[i + 2] = 10 + 26 * up; d[i + 3] = 255; }
  P.env = dataTexture({ data: d, w, h }, { srgb: true, mips: false }); P.env.mapping = EQUIRECT;
  for (const k in P) P[k].userData.mlStandIn = true;
  resetU();
  return P;
}
function resetU() {
  U.uFlickId.value = P.zero; U.uLF0.value = P.black0; U.uLF1.value = P.lf1;
  U.uFloorAux.value = U.uCeilAux.value = U.uWallAux.value = P.aux;
  U.uSurf.value = P.zero; U.uOverlay.value = P.white; U.uTileInfo.value = P.zero; U.uCeilOv.value = P.white;
  U.uDetail.value = P.detail;
}

/* ---------- the shader patches ---------- */
// insert GLSL after (or before) an #include; complain once when this three.js build has no such chunk (so tests catch it)
const warned = new Set();
function at(src, chunk, code, before) {
  const a = '#include <' + chunk + '>';
  if (!src.includes(a)) { if (!warned.has(chunk)) { warned.add(chunk); console.error('MatLib: no ' + a + ' to patch'); } return src; }
  return src.replace(a, () => before ? code + '\n' + a : a + '\n' + code);
}
function swap(src, chunk, code) {
  const a = '#include <' + chunk + '>';
  if (!src.includes(a)) { if (!warned.has(chunk)) { warned.add(chunk); console.error('MatLib: no ' + a + ' to patch'); } return src; }
  return src.replace(a, () => code);
}

const COMMON = `
#ifndef ML_COMMON
#define ML_COMMON
uniform float uLampK;
uniform float uMoonK;
uniform float uEMax;
uniform vec3 uMoonCol;
uniform vec3 uMoonDir;
uniform float uFlick[ 16 ];
uniform vec3 uFlickCol[ 16 ];
uniform sampler2D uFlickId;
uniform vec2 uPlan;
vec2 mlPlanUv( vec3 w ) { return vec2( w.x * uPlan.x, 1.0 - w.z * uPlan.y ); }
// the light of the flickering lamp (if any) that reaches this point of the plan, at its level right now
vec3 mlFlick( vec2 planUv ) {
	int id = int( texture2D( uFlickId, planUv ).r * 255.0 + 0.5 ) - 1;
	if ( id < 0 ) return vec3( 0.0 );
	id = min( id, 15 );
	return uFlick[ id ] * uFlickCol[ id ];
}
#endif`;

// a world-position varying: (modelMatrix * (instanceMatrix *) position), after skinning and morphs
const worldPos = name => `
{ vec4 mlW = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mlW = batchingMatrix * mlW;
#endif
#ifdef USE_INSTANCING
	mlW = instanceMatrix * mlW;
#endif
	${name} = ( modelMatrix * mlW ).xyz; }`;
function withWorldPos(vs, name) { return at(at(vs, 'common', 'varying vec3 ' + name + ';'), 'project_vertex', worldPos(name)); }

// the uv every surface map is read at: turned 90 degrees per region (floor tileInfo G), then shifted by parallax (High, D7).
// (the #defines point the chunks that follow at these local copies: varyings can't be written)
const UV_PROLOGUE = `
#ifdef USE_MAP
	vec2 mlMapUv = vMapUv;
#endif
#ifdef USE_NORMALMAP
	vec2 mlNrmUv = vNormalMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	vec2 mlRghUv = vRoughnessMapUv;
#endif
#ifdef ML_TILEINFO
	vec4 mlTi = texture2D( uTileInfo, vLightMapUv );
	if ( mlTi.g > 0.5 ) {   // boards turned in this region: turn the whole plane, so it stays seamless inside the region
	#ifdef USE_MAP
		mlMapUv = vec2( mlMapUv.y, - mlMapUv.x );
	#endif
	#ifdef USE_NORMALMAP
		mlNrmUv = vec2( mlNrmUv.y, - mlNrmUv.x );
	#endif
	#ifdef USE_ROUGHNESSMAP
		mlRghUv = vec2( mlRghUv.y, - mlRghUv.x );
	#endif
	}
#endif
#if defined( ML_POM ) && defined( USE_ROUGHNESSMAP )
	{   // parallax occlusion: 12 steps into the height (orh B, white = top), tangent frame from screen derivatives
		vec3 mlV = normalize( vViewPosition );
		vec3 mlN = normalize( vNormal ) * ( gl_FrontFacing ? 1.0 : - 1.0 );
		vec3 mlQ0 = dFdx( - vViewPosition ), mlQ1 = dFdy( - vViewPosition );
		vec2 mlS0 = dFdx( mlRghUv ), mlS1 = dFdy( mlRghUv );
		vec3 mlQ1p = cross( mlQ1, mlN ), mlQ0p = cross( mlN, mlQ0 );
		vec3 mlTu = mlQ1p * mlS0.x + mlQ0p * mlS1.x, mlTv = mlQ1p * mlS0.y + mlQ0p * mlS1.y;   // (grad u, grad v) * det
		float mlDet = dot( mlQ0, mlQ1p ), mlVn = dot( mlN, mlV );
		if ( abs( mlDet ) > 1e-14 && mlVn > 0.02 ) {
			// the uv shift at full depth: the view ray's sideways run in uv over its descent of uPomDepth metres
			vec2 mlDir = - vec2( dot( mlTu, mlV ), dot( mlTv, mlV ) ) / ( mlDet * max( mlVn, 0.25 ) ) * uPomDepth;
			float mlCur = 0.0, mlPrevCur = 0.0;
			float mlH = 1.0 - textureGrad( roughnessMap, mlRghUv, mlS0, mlS1 ).b, mlPrevH = mlH;
			for ( int i = 0; i < 12; i ++ ) {
				if ( mlCur >= mlH ) break;
				mlPrevCur = mlCur; mlPrevH = mlH; mlCur += 1.0 / 12.0;
				mlH = 1.0 - textureGrad( roughnessMap, mlRghUv + mlDir * mlCur, mlS0, mlS1 ).b;
			}
			float mlAfter = mlH - mlCur, mlBefore = mlPrevH - mlPrevCur;
			float mlS = mlCur > 0.0 && mlBefore - mlAfter > 1e-5 ? mlBefore / ( mlBefore - mlAfter ) : 0.0;
			vec2 mlOff = mlDir * mix( mlPrevCur, mlCur, mlS );
		#ifdef USE_MAP
			mlMapUv += mlOff * uPomK;   // (the albedo's uv scale relative to orh: walls' variant trick reads it at half)
		#endif
		#ifdef USE_NORMALMAP
			mlNrmUv += mlOff;
		#endif
			mlRghUv += mlOff;
		}
	}
#endif
#ifdef USE_MAP
	#define vMapUv mlMapUv
#endif
#ifdef USE_NORMALMAP
	#define vNormalMapUv mlNrmUv
#endif
#ifdef USE_ROUGHNESSMAP
	#define vRoughnessMapUv mlRghUv
#endif
`;
const POM_DECL = `
#ifdef ML_POM
uniform float uPomDepth;
uniform vec2 uPomK;
#endif`;

// the lamps and the moon, from a lightmap (RGB steady, A flicker) and its aux map (R moon). The built-in chunk has already added
// rgb * lightMapIntensity: whatever that is set to, the total comes out as rgb * uEMax * uLampK (the baked units are E / uEMax)
const lampTerms = (aux, flickUv) => `
#if defined( RE_IndirectDiffuse ) && defined( USE_LIGHTMAP )
	{
		vec4 mlLm = texture2D( lightMap, vLightMapUv );
		irradiance += mlLm.rgb * ( uEMax * uLampK - lightMapIntensity ) + mlLm.a * uEMax * uLampK * mlFlick( ${flickUv} )
			+ ${aux}.r * uMoonK * uMoonCol;
	}
#endif`;

/* floor (D1): albedo variant B and turned boards per region (tileInfo), overlay multiply, dust, wet, walked paths, wear */
const FLOOR_DECL = `
uniform sampler2D uFloorAux;
uniform sampler2D uSurf;
uniform sampler2D uOverlay;
uniform sampler2D uTileInfo;
uniform sampler2D uDetail;
uniform float uDetailRep;
uniform vec3 uDustCol;
#ifdef ML_MAPB
uniform sampler2D uMapB;
#endif` + POM_DECL;
const FLOOR_MAP = UV_PROLOGUE + `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef ML_MAPB
		sampledDiffuseColor = mix( sampledDiffuseColor, texture2D( uMapB, vMapUv ), step( 0.5, mlTi.r ) );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif
	vec4 mlAux = texture2D( uFloorAux, vLightMapUv );
	vec4 mlSf = texture2D( uSurf, vLightMapUv );   // R wet, G dust, B clean (walked), A wear
	vec2 mlDet = texture2D( uDetail, vLightMapUv / uPlan * uDetailRep ).rg;   // R dust_detail, G wet_edge
	float mlDust = clamp( mlSf.g * ( 1.0 - mlSf.b ) * mlDet.r * 1.6, 0.0, 1.0 );
	float mlWet = clamp( mlSf.r * ( 0.6 + 0.8 * mlDet.g ) - 0.3, 0.0, 1.0 );
	diffuseColor.rgb *= texture2D( uOverlay, vLightMapUv ).rgb;
	diffuseColor.rgb = mix( diffuseColor.rgb, uDustCol, mlDust * 0.55 );
	diffuseColor.rgb *= 1.0 - 0.45 * mlWet;`;
const FLOOR_ROUGH = `
	roughnessFactor = mix( mix( mix( roughnessFactor, 0.95, mlDust ), roughnessFactor * 0.6, mlSf.a ), 0.05, mlWet );`;
const FLOOR_NORMAL = `
	normal = normalize( mix( normal, nonPerturbedNormal, max( mlDust * 0.6, mlWet * 0.85 ) ) );`;
// the style's env map shows only in wet patches (md/hi), and never lights the dry floor
const FLOOR_WET = `
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	radiance *= mlWet;
	iblIrradiance *= mlWet;
#endif`;
function floorFrag(fs) {
  fs = at(fs, 'common', COMMON + FLOOR_DECL);
  fs = swap(fs, 'map_fragment', FLOOR_MAP);
  fs = at(fs, 'roughnessmap_fragment', FLOOR_ROUGH);
  fs = at(fs, 'normal_fragment_maps', FLOOR_NORMAL);
  return at(fs, 'lights_fragment_maps', lampTerms('mlAux', 'vLightMapUv') + FLOOR_WET);
}

/* ceiling: plan lightmap through uv1, the ceiling overlay (water rings, soot, D6) multiplied in */
function ceilFrag(fs) {
  fs = at(fs, 'common', COMMON + '\nuniform sampler2D uCeilAux;\nuniform sampler2D uCeilOv;');
  fs = at(fs, 'map_fragment', `
	vec4 mlAux = texture2D( uCeilAux, vLightMapUv );
	diffuseColor.rgb *= texture2D( uCeilOv, vLightMapUv ).rgb;`);
  return at(fs, 'lights_fragment_maps', lampTerms('mlAux', 'vLightMapUv'));
}

/* walls and wall decals: their atlas cell through uv1; aux B is AO that darkens every light (H15), the flicker group comes from
   the plan tile 10 cm into the room */
function wallFrag(fs) {
  fs = at(fs, 'common', COMMON + '\nuniform sampler2D uWallAux;\nvarying vec3 vMlW;' + POM_DECL);
  fs = swap(fs, 'map_fragment', UV_PROLOGUE + `
#include <map_fragment>
	vec4 mlAux = texture2D( uWallAux, vLightMapUv );
	diffuseColor.rgb *= mlAux.b;`);
  return at(fs, 'lights_fragment_maps', lampTerms('mlAux', 'mlPlanUv( vMlW + inverseTransformDirection( nonPerturbedNormal, viewMatrix ) * 0.1 )'));
}

/* the light field (C5): baked steady + flicker irradiance at 1.1 m and its main direction, plus the moon, at the world xz */
const LF_DECL = `
uniform sampler2D uLF0;
uniform sampler2D uLF1;
varying vec3 vLFw;`;
const LF_TERM = `
#if defined( RE_IndirectDiffuse )
	{
		vec2 mlU = mlPlanUv( vLFw );
		vec4 mlA = texture2D( uLF0, mlU ), mlB = texture2D( uLF1, mlU );
		vec3 mlNw = inverseTransformDirection( geometryNormal, viewMatrix );
		vec3 mlD = vec3( mlB.r * 2.0 - 1.0, mlB.b * 2.0 - 1.0, mlB.g * 2.0 - 1.0 );
		mlD = dot( mlD, mlD ) > 1e-6 ? normalize( mlD ) : vec3( 0.0, 1.0, 0.0 );
		float mlWrap = 0.35 + 0.65 * max( dot( mlNw, mlD ), 0.0 );
		irradiance += ( mlA.rgb + mlA.a * mlFlick( mlU ) ) * uEMax * uLampK * mlWrap
			+ mlB.a * uMoonK * uMoonCol * max( dot( mlNw, - uMoonDir ), 0.25 );
	}
#endif`;

/* ---------- the families ---------- */
const api = { tier: 'low' };
const reg = { floor: new Set(), ceil: new Set(), wall: new Set(), decal: new Set() };   // (to hand them the level's lightmaps)
let cur = {};                     // this level's maps by name (textures)
const owned = new Set();          // the ones MatLib made: disposed with the level
function tierOf(o) {
  const n = String((o && o.tier) || api.tier).toLowerCase(), t = TIERS[n];
  if (t === undefined && !warned.has('tier ' + n)) { warned.add('tier ' + n); console.warn('MatLib: unknown tier "' + n + '", using low'); }
  return t === undefined ? 0 : t;
}
// what a material is: kept out of userData, which three's clone() / copy() carry over (by JSON) while dropping the patch itself
const famDone = new WeakSet(), lfDone = new WeakSet();
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// userData.disposables (E5): the textures this material frees with the level. It turns into [] when three copies userData by JSON
// (clone / copy), so a clone owns nothing and copying never serialises a level's pictures
const NOJSON = () => [];
function bag(m) {
  let b = m.userData.disposables;
  if (!Array.isArray(b) || b.toJSON !== NOJSON) {
    const a = Array.isArray(b) ? b.filter(t => t && t.isTexture) : [];
    Object.defineProperty(a, 'toJSON', { value: NOJSON });
    m.userData.disposables = b = a;
  }
  return b;
}
function keep(m, t) { const b = bag(m); if (t && !b.includes(t)) b.push(t); }
function unkeep(gone) {           // textures MatLib freed: out of every material's bag (they'd hold the pictures in memory)
  for (const f in reg) for (const m of reg[f]) {
    const b = m.userData.disposables;
    if (Array.isArray(b)) for (let i = b.length - 1; i >= 0; i--) if (gone.has(b[i])) b.splice(i, 1);
  }
}
// the material's own copy of a shared texture with its repeat and repeat wrapping (a CanvasTexture clamps by default; ceilings tile
// uv0 = world xz / 2.25), same image so no new upload, disposed with the material
function rep(m, t, rx, ry) {
  if (t.userData.mlStandIn || (t.repeat.x === rx && t.repeat.y === ry && t.wrapS === THREE.RepeatWrapping && t.wrapT === THREE.RepeatWrapping)) return t;
  const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry);
  c.userData = { mlOwned: true };   // (not the kit's flags, which clone() copies: E5's disposeLevel skips anything tagged kit/shared)
  keep(m, c);
  return c;
}
function colour(c, v) { if (v === undefined || v === null) return c; if (v.isColor) return c.copy(v); if (Array.isArray(v)) return c.setRGB(v[0], v[1], v[2]); return c.set(v); }
// does a level map belong in this family's materials? (lf0, lf1 and flickId name no family: setLevelMaps gives them to floors and walls)
const mapFor = (s, fam) => s.lm ? s.lm.includes(fam) : s.fam ? s.fam === fam : fam === 'floor' || fam === 'wall';
function finish(m, fam, key, own, vert, frag) {
  famDone.add(m); m.userData.mlFamily = fam; bag(m);
  Object.defineProperty(m.userData, 'mlUniforms', { value: own, configurable: true, writable: true });   // (not enumerable: copies skip it)
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    if (vert) sh.vertexShader = vert(sh.vertexShader);
    sh.fragmentShader = frag(sh.fragmentShader);
  };
  m.customProgramCacheKey = () => key;
  // three's clone() would give a plain Standard / Lambert with a raw lightmap: a clone is the same family again (its own copy of the
  // per-material uniforms, the same textures; it owns none of them), registered for the level's maps
  const clone0 = m.clone;
  m.clone = function () {
    const c = clone0.call(this), o = {};
    if (this.defines) c.defines = Object.assign({}, this.defines);
    for (const k in own) { const v = own[k].value; o[k] = { value: v && v.clone && !v.isTexture ? v.clone() : v }; }
    return finish(c, fam, key, o, vert, frag);
  };
  if (reg[fam]) {
    reg[fam].add(m); m.addEventListener('dispose', () => reg[fam].delete(m));
    for (const k in MAPS) if (cur[k] && owned.has(cur[k]) && mapFor(MAPS[k], fam)) keep(m, cur[k]);
  }
  return m;
}
const lmFor = fam => cur[{ floor: 'floorLM', ceil: 'ceilLM', wall: 'wallLM', decal: 'wallLM' }[fam]] || (fam === 'floor' ? P.black0 : P.black1);

// floor: o { map (colour A), mapB (colour B, optional: one more sampler), normalMap, orh (R AO, G roughness, B height), env (the
// style's equirect, md/hi), GW, GH (map repeat: one texture per tile), color, roughness, pomDepth (m), tier }
function floorMaterial(o = {}) {
  ensure();
  const lv = tierOf(o), gw = o.GW || (typeof GW !== 'undefined' ? GW : 1), gh = o.GH || (typeof GH !== 'undefined' ? GH : 1);
  const m = new THREE.MeshStandardMaterial({ color: o.color !== undefined ? o.color : 0xffffff, roughness: o.roughness !== undefined ? o.roughness : 1, metalness: 0 });
  bag(m);
  m.map = rep(m, o.map || P.white, gw, gh);
  m.normalMap = rep(m, o.normalMap || P.flatN, gw, gh);
  m.roughnessMap = rep(m, o.orh || P.orh, gw, gh);
  m.lightMap = lmFor('floor');
  if (lv >= 1) { m.envMap = o.env || P.env; m.envMapIntensity = lv === 2 ? 0.25 : 0.15; }
  m.defines = { ML_TILEINFO: '' };
  if (lv === 2) m.defines.ML_POM = '';
  const own = { uPomDepth: { value: o.pomDepth || 0.012 }, uPomK: { value: new THREE.Vector2(m.map.repeat.x / m.roughnessMap.repeat.x, m.map.repeat.y / m.roughnessMap.repeat.y) } };
  if (o.mapB) { m.defines.ML_MAPB = ''; own.uMapB = { value: rep(m, o.mapB, gw, gh) }; }
  return finish(m, 'floor', 'mlFloor1', own, null, floorFrag);
}

// ceiling (uv0 = world xz / 2.25, uv1 = plan uv; set receiveShadow on the mesh): o { map, normalMap, orh, color, roughness, tier }
// Standard on md/hi, Lambert on Low
function ceilingMaterial(o = {}) {
  ensure();
  const std = tierOf(o) >= 1, color = o.color !== undefined ? o.color : 0xffffff;
  const m = std ? new THREE.MeshStandardMaterial({ color, roughness: o.roughness !== undefined ? o.roughness : 1, metalness: 0 }) : new THREE.MeshLambertMaterial({ color });
  bag(m);
  m.map = rep(m, o.map || P.white, 1, 1);
  if (std) { m.normalMap = rep(m, o.normalMap || P.flatN, 1, 1); m.roughnessMap = rep(m, o.orh || P.orh, 1, 1); }
  m.lightMap = lmFor('ceil');
  return finish(m, 'ceil', 'mlCeil1', {}, null, ceilFrag);
}

// walls (uv0: the variant trick, u = 0.5 u + 0.5 variant, v = y / 3; uv1: the face's atlas cell). o { map (A|B side by side),
// normalMap, orh, variant (default true: normal and orh repeat (2, 1), which recovers u; false for the upper band and service
// walls), color, roughness, pomDepth, tier }. Lambert + lightmap on Low; Standard + normal + orh on md; + parallax on High
function wallMaterial(o = {}) {
  ensure();
  const lv = tierOf(o), std = lv >= 1, color = o.color !== undefined ? o.color : 0xffffff, nx = o.variant === false ? 1 : 2;
  const m = std ? new THREE.MeshStandardMaterial({ color, roughness: o.roughness !== undefined ? o.roughness : 1, metalness: 0 }) : new THREE.MeshLambertMaterial({ color });
  bag(m);
  m.map = rep(m, o.map || P.white, 1, 1);
  if (std) { m.normalMap = rep(m, o.normalMap || P.flatN, nx, 1); m.roughnessMap = rep(m, o.orh || P.orh, nx, 1); }
  m.lightMap = lmFor('wall');
  const own = { uPomDepth: { value: o.pomDepth || 0.008 }, uPomK: { value: new THREE.Vector2(1 / nx, 1) } };
  if (lv === 2) m.defines = { ML_POM: '' };
  return finish(m, 'wall', 'mlWall1', own, vs => withWorldPos(vs, 'vMlW'), wallFrag);
}

// wall decals (merged quads 3 mm proud, uv0 = the atlas rect, uv1 = their face's cell): o { map (RGBA, alpha = coverage),
// normalMap (md/hi), color, roughness, tier }
function decalMaterial(o = {}) {
  ensure();
  const std = tierOf(o) >= 1, color = o.color !== undefined ? o.color : 0xffffff;
  const m = std ? new THREE.MeshStandardMaterial({ color, roughness: o.roughness !== undefined ? o.roughness : 0.9, metalness: 0 }) : new THREE.MeshLambertMaterial({ color });
  bag(m);
  m.map = o.map || P.white;
  if (std) m.normalMap = o.normalMap || P.flatN;
  m.lightMap = lmFor('decal');
  m.alphaTest = 0.02; m.transparent = true; m.depthWrite = false;
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
  return finish(m, 'decal', 'mlDecal1', { uPomDepth: { value: 0 }, uPomK: { value: new THREE.Vector2(1, 1) } }, vs => withWorldPos(vs, 'vMlW'), wallFrag);
}

// the light field on any MeshStandard / MeshLambert material (or on every one inside an object): kit instances (InstancedMesh
// included), trims, frames, beams, wardrobes, doors, puzzle boxes, dolls, her and teammates. Keeps the material's own patch.
// Calling it again is harmless. A clone() of a patched material comes out patched (the dolls and teammates clone theirs); a copy made
// any other way loses three's patch, and withLightField on it patches it again. The glTF aoMap then darkens it (indirect light).
// Low (the test tier, phones): the light field read once per vertex instead of three reads per pixel: the lamps' light where the
// vertex stands, its flickering share at a steady warm average, without the wrap toward the light's direction and without the moon
// (on Low the moon lies only on the floor and walls). On software and phone GPUs this is a fraction of the cost over the whole kit.
// The tier is read when the program is built: a later quality change rebuilds it (withLightField again)
const LF_VDECL = `
uniform sampler2D uLF0;
varying vec3 vLFirr;
vec3 mlLFw;`;
const LF_VTERM = `
	{
		vec4 mlA = texture2D( uLF0, mlPlanUv( mlLFw ) );
		vLFirr = ( mlA.rgb + mlA.a * vec3( 0.8, 0.6, 0.4 ) ) * ( 0.7 * uEMax * uLampK );
	}`;
const LF_FTERM_V = `
#if defined( RE_IndirectDiffuse )
	irradiance += vLFirr;
#endif`;
const lfTier = new WeakMap();
const LF_U = ['uLampK', 'uMoonK', 'uEMax', 'uMoonCol', 'uMoonDir', 'uFlick', 'uFlickCol', 'uFlickId', 'uPlan', 'uLF0', 'uLF1'];
function withLightField(x) {
  if (!x) return x;
  if (x.isObject3D) {
    const seen = new Set();
    x.traverse(o => { if (o.material) for (const m of [].concat(o.material)) if (!seen.has(m)) { seen.add(m); withLightField(m); } });
    return x;
  }
  const m = x;
  const vtx = tierOf(null) === 0;
  if (lfDone.has(m) && hasOwn(m, 'onBeforeCompile') && lfTier.get(m) !== vtx) { lfTier.set(m, vtx); m.needsUpdate = true; return m; }   // (the other tier's way)
  if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial) || famDone.has(m) || (lfDone.has(m) && hasOwn(m, 'onBeforeCompile'))) return m;
  if (m.userData.mlFamily) {      // (a floor / wall / ... copied without clone(): its patch is gone, and the light field isn't its light)
    if (!warned.has('copy')) { warned.add('copy'); console.warn('MatLib: a copy of a ' + m.userData.mlFamily + ' material lost its patch: clone() it instead'); }
    return m;
  }
  ensure();
  lfDone.add(m); lfTier.set(m, vtx);
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey, clone0 = m.clone;
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    if (/varying vec3 vLF(w|irr);/.test(sh.vertexShader)) return;   // (patched once already somewhere down the chain)
    for (const k of LF_U) if (!sh.uniforms[k]) sh.uniforms[k] = U[k];
    if (lfTier.get(this)) {
      sh.vertexShader = at(at(sh.vertexShader, 'common', COMMON + LF_VDECL), 'project_vertex', worldPos('mlLFw') + LF_VTERM);
      sh.fragmentShader = at(at(sh.fragmentShader, 'common', 'varying vec3 vLFirr;'), 'lights_fragment_maps', LF_FTERM_V);
      return;
    }
    sh.vertexShader = withWorldPos(sh.vertexShader, 'vLFw');
    sh.fragmentShader = at(at(sh.fragmentShader, 'common', COMMON + LF_DECL), 'lights_fragment_maps', LF_TERM);
  };
  m.clone = function () { return withLightField(clone0.call(this)); };
  // the old key as if the old patch were still in place (three's default key is the patch function's source)
  m.customProgramCacheKey = function () {
    const now = this.onBeforeCompile; this.onBeforeCompile = prev;
    try { return prevKey.call(this) + (lfTier.get(this) ? '|mlLFv1' : '|mlLF1'); } finally { this.onBeforeCompile = now; }
  };
  m.needsUpdate = true;           // (build time only: a material already drawn gets its new program once)
  return m;
}

// the lamps' emissive parts: instanced MeshBasic x instanceColor (lamp colour x 4 x state: dead ~0.03), times the live level of
// its lamp from U (uLampK, and uFlick[group] for a flickering one): no per-frame work on the CPU
function emissiveMaterial(o = {}) {
  ensure();
  return emitPatch(new THREE.MeshBasicMaterial({ color: o.color !== undefined ? o.color : 0xffffff, map: o.map || null }));
}
function emitPatch(m) {
  m.defaultAttributeValues = { mlGroup: [0] };     // (a mesh without the attribute: steady)
  famDone.add(m); m.userData.mlFamily = 'emit';
  const clone0 = m.clone; m.clone = function () { return emitPatch(clone0.call(this)); };
  m.onBeforeCompile = sh => {
    sh.uniforms.uLampK = U.uLampK; sh.uniforms.uFlick = U.uFlick;
    sh.vertexShader = at(at(sh.vertexShader, 'common', 'attribute float mlGroup;\nvarying float vMlLevel;\nuniform float uLampK;\nuniform float uFlick[ 16 ];'),
      'color_vertex', '\t{ int g = int( mlGroup + 0.5 ) - 1; vMlLevel = uLampK * ( g < 0 ? 1.0 : uFlick[ min( g, 15 ) ] ); }');
    sh.fragmentShader = at(at(sh.fragmentShader, 'common', 'varying float vMlLevel;'), 'color_fragment', '\tdiffuseColor.rgb *= vMlLevel;');
  };
  m.customProgramCacheKey = () => 'mlEmit1';
  return m;
}
// an InstancedMesh for n emissive parts (its own copy of the geometry, which gets the per-instance flicker group)
function emissiveMesh(geometry, n, material) {
  const g = geometry.clone(), mesh = new THREE.InstancedMesh(g, material || emissiveMaterial(), n);
  g.setAttribute('mlGroup', new mesh.instanceMatrix.constructor(new Float32Array(n), 1));   // (the instanced attribute class: not exported)
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < n; i++) mesh.setColorAt(i, white);
  return mesh;
}
// one emissive part: where, its colour (lamp colour x 4 x state), its flicker group (0..15; null or -1: steady)
function setEmissive(mesh, i, matrix, col, group) {
  if (matrix) { mesh.setMatrixAt(i, matrix); mesh.instanceMatrix.needsUpdate = true; }
  if (col !== undefined) { mesh.setColorAt(i, colour(new THREE.Color(), col)); mesh.instanceColor.needsUpdate = true; }
  const a = mesh.geometry.attributes.mlGroup;
  if (a && group !== undefined) { a.setX(i, group === null || group < 0 ? 0 : group + 1); a.needsUpdate = true; }
}

// the glow around every lamp of a level: ONE Points draw, per-point colour, size (m) and flicker group
const GLOW_VS = `
uniform float uLampK;
uniform float uFlick[ 16 ];
uniform float uPx;
attribute vec3 aCol;
attribute float aSize;
attribute float mlGroup;
varying vec3 vCol;
#include <common>
#include <fog_pars_vertex>
void main() {
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	int g = int( mlGroup + 0.5 ) - 1;
	vCol = aCol * uLampK * ( g < 0 ? 1.0 : uFlick[ min( g, 15 ) ] );
	gl_Position = projectionMatrix * mvPosition;
	gl_PointSize = dot( vCol, vCol ) < 1e-6 ? 0.0 : clamp( aSize * projectionMatrix[ 1 ][ 1 ] * 0.5 * uPx / max( - mvPosition.z, 0.05 ), 1.0, 256.0 );
	#include <fog_vertex>
}`;
const GLOW_FS = `
varying vec3 vCol;
#include <common>
#include <fog_pars_fragment>
void main() {
	vec2 c = gl_PointCoord * 2.0 - 1.0;
	float r2 = dot( c, c );
	if ( r2 > 1.0 ) discard;
	float a = ( exp( - 5.0 * r2 ) - exp( - 5.0 ) ) * 0.6 + exp( - 50.0 * r2 ) * 0.4;   // a soft halo with a hot core, 0 at the rim
	gl_FragColor = vec4( vCol, a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`;
function glowMaterial() {
  ensure();
  const m = new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    uniforms: { uLampK: U.uLampK, uFlick: U.uFlick, uPx: { value: 720 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogDensity: { value: 0 } } });
  m.defaultAttributeValues = { aCol: [1, 1, 1], aSize: [0.3], mlGroup: [0] };
  famDone.add(m); m.userData.mlFamily = 'glow'; m.name = 'mlGlow';
  // (ShaderMaterial.clone() deep-copies its uniforms: a clone would stop following the lamps)
  const clone0 = m.clone;
  m.clone = function () { const c = clone0.call(this); c.uniforms.uLampK = U.uLampK; c.uniforms.uFlick = U.uFlick; c.clone = this.clone; famDone.add(c); return c; };
  return m;
}
// list: [{ x, y, z (or pos: Vector3), color (Color, hex or [r, g, b] linear, already x brightness), size (m), group (0..15, or none) }]
function glowPoints(list) {
  const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), grp = new Float32Array(n), c = new THREE.Color();
  list.forEach((l, i) => {
    const p = l.pos || l; pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    colour(c.setRGB(1, 1, 1), l.color).toArray(col, i * 3); size[i] = l.size || 0.3; grp[i] = l.group === undefined || l.group === null || l.group < 0 ? 0 : l.group + 1;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('mlGroup', new THREE.BufferAttribute(grp, 1));
  const pts = new THREE.Points(g, glowMaterial()), sz = new THREE.Vector2();
  pts.renderOrder = 4;
  // (sizes are in metres: the shader needs the height in pixels of whatever it's drawing into, the composer's target on High)
  pts.onBeforeRender = r => { const rt = r.getRenderTarget(); pts.material.uniforms.uPx.value = rt ? rt.height : r.getDrawingBufferSize(sz).y; };
  return pts;
}

/* ---------- the level's maps (C4) ---------- */
// name: how it's stored (colour space, filter), and where it goes: a family's lightMap (with its uv channel) or a shared uniform
const MAPS = {
  floorLM: { srgb: 1, lm: ['floor'], ch: 0 }, ceilLM: { srgb: 1, lm: ['ceil'], ch: 1 }, wallLM: { srgb: 1, lm: ['wall', 'decal'], ch: 1, mips: false },
  floorAux: { u: 'uFloorAux', fam: 'floor' }, ceilAux: { u: 'uCeilAux', fam: 'ceil' }, wallAux: { u: 'uWallAux', fam: 'wall', mips: false },
  lf0: { srgb: 1, u: 'uLF0', mips: false }, lf1: { u: 'uLF1', mips: false }, flickId: { u: 'uFlickId', nearest: 1 },
  ovAlbedo: { srgb: 1, u: 'uOverlay', fam: 'floor' }, ovSurf: { u: 'uSurf', fam: 'floor' }, tileInfo: { u: 'uTileInfo', nearest: 1, fam: 'floor' },
  ovCeil: { srgb: 1, u: 'uCeilOv', fam: 'ceil' }, detail: { u: 'uDetail', repeat: 1, fam: 'floor' },
};
// (the wall atlas has no mipmaps: its cells have a 1 px gutter, and smaller mips would mix in the neighbouring faces)
const STANDIN = { floorLM: 'black0', ceilLM: 'black1', wallLM: 'black1', floorAux: 'aux', ceilAux: 'aux', wallAux: 'aux', lf0: 'black0', lf1: 'lf1',
  flickId: 'zero', ovAlbedo: 'white', ovSurf: 'zero', tileInfo: 'zero', ovCeil: 'white', detail: 'detail' };
// the floor's two detail tiles (B9: dust_detail, wet_edge, data in R) packed into one texture: R dust, G wet edge. The floor
// program is at 15 samplers on md/hi (r186 Standard adds dfgLUT; envMap, shadow and cookie come on top), 16 being the WebGL2 minimum
function pixels(src) {    // RGBA bytes of an ImageData, { data, w, h }, or an opaque picture (or a texture holding one)
  const im = src && src.isTexture ? src.image : src;
  if (!im) return null;
  if (typeof ImageData !== 'undefined' && im instanceof ImageData) return im;
  if (im.data && (im.w || im.width)) return { data: im.data, width: im.w || im.width, height: im.h || im.height };
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  if (!w || !h) return null;
  // (an opaque grey picture read through a canvas: alpha is 255, so nothing is premultiplied away)
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
  return g.getImageData(0, 0, w, h);
}
function packDetail(dust, wet) {
  const a = pixels(dust), b = pixels(wet), base = a || b;
  if (!base) return null;
  const w = base.width, h = base.height, d = new Uint8ClampedArray(w * h * 4);
  const at = (q, x, y) => q ? q.data[(Math.floor(y * q.height / h) * q.width + Math.floor(x * q.width / w)) * 4] : 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = at(a, x, y); d[i + 1] = at(b, x, y); d[i + 3] = 255; }
  return { data: d, w, h };
}
// maps: any of the names above, each ImageData, { data, w, h }, a texture, or null (back to the stand-in); dustDetail and wetEdge
// (pictures, textures or data) instead of a packed detail; plus GW, GH (and L, default 2.25 m) for uPlan (else the game's GW, GH),
// moonDir ([x, y, z] or Vector3, the way moonlight travels: LightBaker.bake gives it), dustCol, detailRep.
// Call it after the materials exist (later ones pick the maps up too).
let planSet = false;              // (uPlan belongs to this level: set since the last releaseLevel)
function setLevelMaps(maps) {
  ensure();
  if (maps.detail === undefined && (maps.dustDetail || maps.wetEdge)) {
    const det = packDetail(maps.dustDetail, maps.wetEdge);
    if (det) maps = Object.assign({}, maps, { detail: det }); else console.warn('MatLib: detail tiles not loaded yet');
  }
  // world xz -> plan uv for the light field and the walls' flicker group (LightBaker's result has no GW, GH: the game's are used)
  const gw = maps.GW || (typeof GW !== 'undefined' && GW), gh = maps.GH || (typeof GH !== 'undefined' && GH);
  if (gw && gh) { const L = maps.L || 2.25; U.uPlan.value.set(1 / (gw * L), 1 / (gh * L)); planSet = true; }
  else if (!planSet) console.warn('MatLib: no GW, GH for this level: uPlan is not set, so the light field and wall flicker are misplaced');
  if (maps.moonDir) setMoon(Array.isArray(maps.moonDir) ? new THREE.Vector3().fromArray(maps.moonDir) : maps.moonDir);
  const gone = new Set();
  for (const k in MAPS) {
    if (maps[k] === undefined) continue;
    const s = MAPS[k], src = maps[k], old = cur[k];
    const t = src === null ? null : src.isTexture ? src : dataTexture(src, { srgb: s.srgb, nearest: s.nearest, mips: s.mips, repeat: s.repeat });
    if (t && !src.isTexture) owned.add(t);
    if (t && s.ch !== undefined) t.channel = s.ch;        // (ceilings and walls read their lightmap through uv1)
    if (old && old !== t && owned.has(old)) { old.dispose(); owned.delete(old); gone.add(old); }
    cur[k] = t;
    const val = t || P[STANDIN[k]];
    if (s.u) U[s.u].value = val;
    const users = Object.keys(reg).filter(f => mapFor(s, f)).flatMap(f => [...reg[f]]);
    if (s.lm) for (const m of users) m.lightMap = val;
    if (t && owned.has(t)) for (const m of users) keep(m, t);   // (disposeLevel finds the level's textures there, E5)
  }
  if (gone.size) unkeep(gone);
  if (maps.dustCol !== undefined) colour(U.uDustCol.value, maps.dustCol);
  if (maps.detailRep) U.uDetailRep.value = maps.detailRep;
}
// the level is gone: free the textures MatLib made for it and put the stand-ins back
function releaseLevel() {
  for (const t of owned) t.dispose();
  unkeep(owned);
  owned.clear(); cur = {}; planSet = false; U.uPlan.value.set(1, 1);
  if (!P) return;
  resetU();
  for (const f in reg) for (const m of reg[f]) m.lightMap = lmFor(f);
}

/* ---------- every frame: uniform writes only ---------- */
let calm = false;
// lamps: scares.dim, all off in the dark scare (eased over ~0.1 s when dt is given); calm ("Calm effects") holds flicker at 0.8
function setK(dim, dark, isCalm, dt) {
  const target = dark ? 0 : Math.max(0, dim === undefined || dim === null ? 1 : dim), k = U.uLampK;
  k.value = dt === undefined || dt === null ? target : k.value + (target - k.value) * Math.min(1, dt * 10);
  calm = !!isCalm;
}
// levels: the level of each flicker group now (house.js lampLevel); colors (optional, once per level): each group's lamp colour
function setFlick(levels, colors) {
  const f = U.uFlick.value;
  if (levels) for (let i = 0; i < 16; i++) f[i] = i < levels.length ? (calm ? 0.8 : +levels[i] || 0) : 1;
  if (colors) for (let i = 0; i < Math.min(16, colors.length); i++) colour(U.uFlickCol.value[i], colors[i]);
}
function setTime(t) { U.uTime.value = t; }
// the moon: the direction its light travels (from the moon down), and its colour
function setMoon(dir, col) { if (dir) U.uMoonDir.value.copy(dir).normalize(); if (col !== undefined) colour(U.uMoonCol.value, col); }
// a set of the shared uniforms for a ShaderMaterial (sky, shafts, motes: js/atmos.js), still the same objects
function uniforms(...names) { ensure(); const o = {}; for (const n of names) o[n] = U[n]; return o; }

Object.assign(api, { U, dataTexture, setLevelMaps, releaseLevel, setK, setFlick, setTime, setMoon, uniforms,
  floorMaterial, ceilingMaterial, wallMaterial, decalMaterial, withLightField, emissiveMaterial, emissiveMesh, setEmissive, glowMaterial, glowPoints,
  maps: () => cur, families: reg });
window.MatLib = api;
})();
