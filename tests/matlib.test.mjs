// The material library (js/matlib.js, spec C5, D1, D7) on its own test page (tests/matlib.html): every material family compiles on
// low, medium and high with no shader error; the programs are counted; the per-frame uniforms (lamps, flicker, moon) change the picture
// without recompiling anything; data textures keep their colour where alpha is 0 (no premultiplication). Screenshots: tests/out/matlib_<tier>.png
// Usage: cd tests && node matlib.test.mjs   (serves the repository itself on port 8778, MATLIB_PORT to change it; with GAME_URL set,
// as tests/run.mjs does, it uses that server instead)
import fs from 'node:fs';
import path from 'node:path';
import { launch, check, summary, OUT } from './lib.mjs';
import { serve } from './server.mjs';

let server = null, origin;
if (process.env.GAME_URL) origin = new URL(process.env.GAME_URL).origin;
else { const port = +process.env.MATLIB_PORT || 8778; server = await serve(port); origin = 'http://127.0.0.1:' + port; }

console.log('== the rules the source must keep');
const src = fs.readFileSync(new URL('../js/matlib.js', import.meta.url), 'utf8');
check(!/InstancedBufferAttribute|TextureLoader|DataTexture|ClampToEdgeWrapping/.test(src), 'js/matlib.js names nothing this three.js build lacks (H25)');
check(!/putImageData/.test(src) && (src.match(/new THREE\.CanvasTexture\(/g) || []).length === 1 && src.includes('new THREE.CanvasTexture(img)'),
  'data maps go ImageData -> CanvasTexture, never through a 2D canvas (H14)');

const b = await launch();
const counts = {};
const near = (a, e, tol) => e.every((v, i) => Math.abs(a[i] - v) <= tol);
const srgbToLin = c => { const x = c / 255; return Math.round(255 * (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); };
for (const tier of ['low', 'medium', 'high']) {
  console.log(`== ${tier}`);
  const ctx = await b.newContext({ viewport: { width: 660, height: 420 } }), p = await ctx.newPage(), cons = [];
  p.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 400)); });
  p.on('pageerror', e => cons.push('pageerror: ' + e.message));
  await p.goto(`${origin}/tests/matlib.html?tier=${tier}`, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.RESULT, null, { timeout: 600000, polling: 500 });
  const R = await p.evaluate(() => window.RESULT);
  await p.locator('#c').screenshot({ path: path.join(OUT, `matlib_${tier}.png`) });
  if (!R.failed) for (const v of ['floor', 'wall']) {   // close views (to look at parallax, wet and dust): still no new program or error
    const after = await p.evaluate(v => window.view(v), v); await p.locator('#c').screenshot({ path: path.join(OUT, `matlib_${tier}_${v}.png`) });
    check(after.errors === R.errors.length && after.programs === R.programsFinal, `${tier}: the ${v} close-up draws with no new program or error`, after);
  }
  if (R.failed) { check(false, `${tier}: the test page ran`, R.errors); await ctx.close(); continue; }
  counts[tier] = R.programs;
  console.log(`  ${R.programs} programs (${R.compileMs} ms to compile and draw), ${R.drawCalls} draws; max samplers ${Math.max(...R.progs.map(q => q.samplers))} of ${R.maxUnits}`);
  for (const q of R.progs) console.log(`    ${q.family.padEnd(20)} ${q.name.padEnd(22)} samplers ${q.samplers}${q.log ? '  log: ' + q.log.replace(/\s+/g, ' ').slice(0, 120) : ''}`);

  check(R.errors.length === 0 && cons.length === 0, `${tier}: no shader compile/link error, no missing chunk, no page error`, [...R.errors, ...cons].slice(0, 5));
  check(R.progs.every(q => q.linked) && !R.progs.some(q => /error/i.test(q.log)), `${tier}: every program links (getProgramInfoLog clean)`, R.progs.filter(q => !q.linked || /error/i.test(q.log)));
  const fams = new Set(R.progs.map(q => q.family));
  check(['mlFloor1', 'mlCeil1', 'mlWall1', 'mlDecal1', 'mlEmit1', 'lightField'].every(f => fams.has(f)) && R.progs.some(q => q.name === 'mlGlow'),
    `${tier}: every family drawn (floor, ceiling, wall, decal, light field, emissive, glow)`, [...fams]);
  check(R.progs.filter(q => q.lf).length >= 4 && R.skinned, `${tier}: the light field compiles on Standard, Lambert, instanced and skinned meshes`, R.progs.filter(q => q.lf).length);
  const std = tier === 'low' ? 'MeshLambertMaterial' : 'MeshStandardMaterial';
  check(R.types.floor === 'MeshStandardMaterial' && R.types.wall === std && R.types.ceil === std && R.types.decal === std,
    `${tier}: floor Standard, walls / ceiling / decals ${std.replace('Mesh', '').replace('Material', '')} (C10)`, R.types);
  const maxS = Math.max(...R.progs.map(q => q.samplers));
  check(maxS <= Math.min(16, R.maxUnits), `${tier}: at most ${Math.min(16, R.maxUnits)} samplers in any program (the WebGL2 minimum is 16): ${maxS}`);
  check(R.lateLightMap, `${tier}: a wall material made after setLevelMaps gets the level's wall lightmap (and holds it for disposal)`);

  const s = R.samples, B = s.base, drop = (k, t, n = 6) => B[k] - s[t][k] > n;
  console.log('    base', JSON.stringify(B));
  check(Object.values(R.visible).every(Boolean), `${tier}: all sample points are on screen`, R.visible);
  check(['steadyFloor', 'wallSteady', 'ceiling', 'boxSteady', 'bulbSteady'].every(k => drop(k, 'lampOff')),
    `${tier}: U.uLampK = 0 darkens floor, wall, ceiling, light-field box and bulb`, Object.fromEntries(Object.keys(B).map(k => [k, [B[k], s.lampOff[k]]])));
  check(s.lampHalf.steadyFloor < B.steadyFloor - 3 && s.lampHalf.steadyFloor > s.lampOff.steadyFloor + 3, `${tier}: setK(0.5) is in between (${s.lampOff.steadyFloor} < ${s.lampHalf.steadyFloor} < ${B.steadyFloor})`);
  check(Math.abs(s.dark.steadyFloor - s.lampOff.steadyFloor) <= 1, `${tier}: setK(dim, dark = true) turns the lamps off`);
  check(['flickFloor', 'wallFlick', 'boxFlick', 'bulbFlick'].every(k => drop(k, 'flickOff', 4)) && Math.abs(B.steadyOnly - s.flickOff.steadyOnly) <= 1.5,
    `${tier}: uFlick[0] = 0 darkens the flickering lamp's floor, wall, light field and bulb, and nothing else`, Object.fromEntries(['flickFloor', 'wallFlick', 'boxFlick', 'bulbFlick', 'steadyOnly'].map(k => [k, [B[k], s.flickOff[k]]])));
  check(['moonFloor', 'wallMoon'].every(k => drop(k, 'moonOff', 3)) && B.boxMoon - s.moonOff.boxMoon > 0.5,
    `${tier}: uMoonK = 0 takes the moon off floor, wall and light field`, Object.fromEntries(['moonFloor', 'wallMoon', 'boxMoon'].map(k => [k, [B[k], s.moonOff[k]]])));
  check(Object.keys(B).every(k => Math.abs(B[k] - s.lmi3[k]) <= 1 && Math.abs(B[k] - s.again[k]) <= 1), `${tier}: lightMapIntensity has no effect (the patch owns the lamps' level), and the picture comes back`);
  check(R.programsAfterUniforms === R.programs && R.versionsSame && R.frameFns === 'uniforms only',
    `${tier}: no recompile, no material version change from the per-frame calls (${R.programs} -> ${R.programsAfterUniforms} programs)`, R.frameFns);
  check(R.release.after < R.release.before && R.release.standIn && R.release.programs === R.programs && R.release.reset === R.programs,
    `${tier}: releaseLevel frees the level's textures (${R.release.before} -> ${R.release.after}) and stand-ins / new maps need no recompile`, R.release);
  check(tier === 'high' ? R.pom.floor > 500 && R.pom.wall > 500 : R.pom.floor === 0 && R.pom.wall === 0,
    `${tier}: parallax ${tier === 'high' ? 'shifts' : 'is off on'} floor and walls (pixels changed by the depth: floor ${R.pom.floor}, wall ${R.pom.wall})`);
  const want = [200, 100, 50], wantS = want.map(srgbToLin);
  check(near(R.probe.a0, want, 2) && near(R.probe.a1, want, 2) && R.probe.alpha0 === 0,
    `${tier}: ImageData texture with A = 0 (and 1) reads back RGB (200, 100, 50) +-2: ${R.probe.a0.slice(0, 3)} / ${R.probe.a1.slice(0, 3)}, alpha ${R.probe.alpha0}`);
  check(near(R.probe.srgb, wantS, 2), `${tier}: the same as sRGB decodes to (${wantS}) +-2 with A = 0: ${R.probe.srgb.slice(0, 3)}`);
  // materials and maps over a level's life (the review's findings)
  const F = R.life;
  console.log('    life', JSON.stringify(F));
  check(F.lf.clone === 1 && F.lf.copy === 1 && F.lf.twice === 1 && F.lf.again === 1,
    `${tier}: the light field survives clone(), patches a copy again, and is applied once however often it's called`, F.lf);
  check(F.wallCloneKey && F.floorCloneKey && F.cloneProgramsShared && F.cloneDefines && F.cloneOwnU && F.cloneFollows,
    `${tier}: a cloned wall / floor material keeps its family patch and program, has its own uniforms, and follows the level's maps`, F);
  check(F.cloneMs < 50 && F.cloneBag, `${tier}: cloning a family material with level-sized maps takes ${F.cloneMs} ms and its disposables are textures`);
  check(F.emitClone && F.glowClone && F.famCopy, `${tier}: emissive and glow clones stay linked to U; a family copy made without clone() is left alone, with a warning`, F);
  check(F.atlasNoMips.every(Boolean), `${tier}: the wall lightmap atlas and wallAux have no mipmaps (LinearFilter)`, F.atlasNoMips);
  check(F.bags.wallSame && F.bags.noStale, `${tier}: replaced level maps leave every material's disposables`, F.bags);
  check(F.planReset && F.planWarn && F.planGlobal && near(F.moonDir, [0, -1, 0], 0.001),
    `${tier}: uPlan resets with the level, comes from the game's GW / GH when the maps have none (else a warning), and moonDir sets uMoonDir`, F);
  check(F.tiers.hi === 'Standard+pom' && F.tiers.HIGH === 'Standard+pom' && F.tiers.md === 'Standard' && F.tiers.lo === 'Lambert' && F.tiers.ultra === 'Lambert' && F.tierWarn,
    `${tier}: tier names hi / md / lo (any case) work, an unknown one warns and falls back to low`, F.tiers);
  check(F.repOwned, `${tier}: a material's repeat copy of a kit texture is tagged as its own, not the kit's`);
  check(F.programsBack === F.programsBefore && R.programsFinal === R.programsWithProbe, `${tier}: the extra materials' programs go when they are disposed (${F.programsBefore} -> ${F.programsBack})`);
  if (R.warnings.length) console.log('    warnings:', R.warnings.slice(0, 6));
  await ctx.close();
}
console.log('\nprograms per tier:', JSON.stringify(counts));
await b.close();
if (server) server.close();
process.exit(summary());
