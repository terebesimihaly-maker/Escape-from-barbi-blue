// The house's light in the game (spec C, WP4.2-4.3): the lamps are the kit's fixtures at the plan's spots with their light baked
// (js/lightbake.js into js/matlib.js's materials), no lamp is a real light (the light count never changes, C2, H12), the moon comes in
// through the windows (the night sky behind every window, moonlight baked on the floor), the scares dim the lamps with uniforms only
// (no new programs, H13), flicker follows the groups, Low leaves out the beams and motes (C10), the same floor bakes the same light
// (F4.5), and without the kit house.js hangs plain lamps at the very same spots (E7).
import { launch, solo, check, summary, pageErrors, BASE, until } from './lib.mjs';

const b = await launch();
const p = await solo(b, 'low', 480, 300);
p.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 300)); });
await until(p, () => typeof LIGHT_DATA !== 'undefined' && !!LIGHT_DATA.data, null, 60000);

// a floor built synchronously (as the tests do), its assets loaded first, nothing to disturb it
async function floor(pg, i, seed) {
  await pg.evaluate(i => floorAssets(i).then(() => !!Kit.get(FLOORS[i].style)), i);   // (the kit, light data, decals, surfaces: E4)
  await pg.evaluate(([i, seed]) => {
    if (seed === undefined) bb.startFloor(i); else applyFloor(generateFloor(i, 1, 'medium', seed), 0);
    bb.state = 'play'; notes.forEach(n => { n.read = true; }); const m = bb.monster; m.active = false; m.spawnT = 1e9; huntTimer = 1e9; scares.next = 1e9; buildLevel();
  }, [i, seed]);
}
const lightCount = pg => pg.evaluate(() => { let n = 0, inLevel = 0; scene.traverse(o => { if (o.isLight) n++; }); level.group.traverse(o => { if (o.isLight) inLevel++; }); return { n, inLevel }; });

/* ---------- the lamps: the kit's, baked; no real lights ---------- */
await floor(p, 0);
{
  const r = await p.evaluate(() => {
    const L = level, plan = L.plan, kit = L.archKit, M = MatLib.maps();
    const inKit = plan.fixtures.filter(fx => kit && kit.nodes[fx.node] && !kit.isPlaceholder(fx.node)).length;
    const px = t => { const d = t && t.image && t.image.data; if (!d) return null; let mx = 0, a = 0; for (let i = 0; i < d.length; i += 4) { mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); a = Math.max(a, d[i + 3]); } return { w: t.image.width, h: t.image.height, mx, a }; };
    const red = t => { const d = t && t.image && t.image.data; if (!d) return -1; let mx = 0; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i]); return mx; };
    const emits = L.kit.group.children.filter(o => o.userData.kit && o.userData.kit.kind === 'emit');
    return { fixtures: plan.fixtures.length, inKit, placed: L.kit.items.filter(x => x.kind === 'fixture').length, house: L.house.fixtures.length, emits: emits.length, emitInst: emits.reduce((a, o) => a + o.count, 0),
      glow: !!L.kit.group.getObjectByName('KitGlow'), bake: !!L.light.bake, floorLM: px(M.floorLM), wallLM: px(M.wallLM), lf0: px(M.lf0), flickId: !!M.flickId,
      moonlit: plan.windows.filter(w => w.moonlit).length, moonR: red(M.floorAux), GW, GH, failed: !!L.light.failed, hemi: hemi.intensity,
      floorFam: L.group.children.some(o => o.material && o.material.userData.mlFamily === 'floor'), wallFam: L.archOpts.materials.wall.userData.mlFamily, ms: L.light.ms };
  });
  console.log('  (floor 1: ' + r.fixtures + ' lamps, ' + r.placed + ' kit fixtures, ' + r.house + ' stand-ins; light built in ' + JSON.stringify(r.ms) + ' ms)');
  check(r.inKit > 0 && r.placed === r.inKit, 'Kit.furnish places a fixture model at every plan lamp the kit has art for', [r.placed, r.inKit, r.fixtures]);
  check(r.house === r.fixtures - r.inKit, 'house.js hangs stand-in lamps only for the plan lamps the kit can\'t show', [r.house, r.fixtures - r.inKit]);
  check(r.emits > 0 && r.emitInst > 0 && r.glow, 'the fixtures\' emissive parts are instanced, and every lit lamp\'s glow is one Points mesh', [r.emits, r.emitInst, r.glow]);
  check(r.bake && !r.failed && r.flickId, 'the floor\'s light is baked (LightBaker.bake into MatLib)', r);
  check(r.floorLM && Math.abs(r.floorLM.w - r.GW * 2.25 * 8) <= 1 && r.floorLM.mx > 40, 'the floor lightmap is 8 px/m on Low and holds the lamps\' light', [r.floorLM, r.GW]);
  check(r.wallLM && r.wallLM.mx > 40 && r.lf0 && r.lf0.mx > 20, 'the walls\' atlas and the light field hold the lamps\' light too', [r.wallLM, r.lf0]);
  check(r.moonlit === 0 || r.moonR > 40, 'moonlight is baked onto the floor below the moonlit windows', [r.moonlit, r.moonR]);
  check(r.floorFam && r.wallFam === 'wall', 'the floor and walls are MatLib\'s families (they take the baked light)', [r.floorFam, r.wallFam]);
  check(Math.abs(r.hemi - 0.16) < 1e-6, 'the ambient is 0.16 now that the lamps are baked (C1)', r.hemi);
}
const lc = await lightCount(p);
check(lc.n === 4 && lc.inLevel === 0, 'exactly 4 lights in the scene (hemisphere, flashlight, aura, exit): none per floor, no lamp pool (C2, H12)', lc);
check(await p.evaluate(() => aura.parent === scene), 'aura lives in the scene: the flashlight\'s bounce moves it (C7)');

/* ---------- the night in the windows ---------- */
{
  // a picture of every window from 1.4 m in front (flashlight and bounce off): the middle of the opening shows the sky, lit (not black)
  // and night-blue; and with the sky meshes hidden for a moment that pixel changes, so what's seen there is the sky itself
  const r = await p.evaluate(() => {
    const plan = level.plan, out = { windows: plan.windows.length, sky: level.atmos ? level.atmos.stats.sky : -1, ok: 0, bad: [] }, skies = level.atmos.sky;
    const fi = flash.intensity, ai = aura.intensity; flash.intensity = 0; aura.intensity = 0;
    const buf = new Uint8Array(4 * 4 * 4), cam = new THREE.PerspectiveCamera(30, 1, 0.05, 18);
    // (drawn to the canvas and read back at once, in the same task: the picture as shown, tone mapped and in sRGB)
    const gl = renderer.getContext(), sz = renderer.getDrawingBufferSize(new THREE.Vector2()); cam.aspect = sz.x / sz.y; cam.updateProjectionMatrix();
    const shot = () => { renderer.setRenderTarget(null); renderer.render(scene, cam); gl.readPixels(Math.round(sz.x * 0.4) - 2, Math.round(sz.y * 0.7) - 2, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let r = 0, g = 0, bl = 0; for (let i = 0; i < 16; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; bl += buf[i * 4 + 2]; } return [r / 16, g / 16, bl / 16]; };
    // (aimed at the middle of each window's own sky plane, seen through its opening from about 2.3 m into the room, from a little below; read
    // in the upper pane, off the glazing bars that cross the middle)
    for (const sm of skies) {
      const bx = new THREE.Box3().setFromObject(sm), c = bx.getCenter(new THREE.Vector3());
      let w = null, best = 1e9; for (const q of plan.windows) { const f = plan.faces[q.face], d = Math.hypot((f.x0 + f.x1) / 2 - c.x, (f.z0 + f.z1) / 2 - c.z); if (d < best) { best = d; w = q; } }
      const f = plan.faces[w.face];
      cam.position.set(c.x + f.nx * 2.6, c.y - 0.3, c.z + f.nz * 2.6); cam.lookAt(c); cam.updateMatrixWorld();
      const a = shot(); for (const m of skies) m.visible = false; const z = shot(); for (const m of skies) m.visible = true;
      const lum = a[0] + a[1] + a[2], lum0 = z[0] + z[1] + z[2];
      if (lum > 6 && a[2] >= a[0] && Math.abs(lum - lum0) > 3) out.ok++; else out.bad.push([w.type, a.map(Math.round), z.map(Math.round)]);
    }
    flash.intensity = fi; aura.intensity = ai;
    return out;
  });
  check(r.windows > 0 && r.sky >= r.windows, 'every window has the night sky behind it (js/atmos.js\'s sky material)', r);
  check(r.ok === r.sky && r.sky >= r.windows, 'through every window the middle of its sky is what you see: lit, night-blue, and it changes when the sky meshes are hidden (flashlight off)', r);
}

/* ---------- per frame: uniforms only ---------- */
{
  const r = await p.evaluate(() => {
    const progs = () => renderer.info.programs.length;
    renderer.render(scene, camera); const p0 = progs();
    scares.dim = 0; for (let k = 0; k < 30; k++) updateLight(0.05, 10 + k * 0.05);
    const off = MatLib.U.uLampK.value, moon = MatLib.U.uMoonK.value; renderer.render(scene, camera); const p1 = progs();
    scares.dim = 1; for (let k = 0; k < 30; k++) updateLight(0.05, 12 + k * 0.05);
    const on = MatLib.U.uLampK.value; renderer.render(scene, camera); const p2 = progs();
    // flicker: the groups' levels move with time, and "Calm effects" holds them at 0.8
    const seen = new Set(); for (let k = 0; k < 40; k++) { updateLight(0.05, 20 + k * 0.37); seen.add(Math.round(MatLib.U.uFlick.value[0] * 100)); }
    settings.calm = true; updateLight(0.05, 40); const calmV = Array.from(MatLib.U.uFlick.value.slice(0, 4)); settings.calm = false; updateLight(0.05, 41);
    return { p0, p1, p2, off, on, moon, flickVals: seen.size, calmV, groups: level.light.bake.groups.length };
  });
  check(r.off < 0.01 && r.on > 0.99 && r.moon === 1, 'the dark scare puts every lamp out and back (uLampK); the moon stays on (C8)', r);
  check(r.p0 === r.p1 && r.p1 === r.p2, 'dimming the lamps compiles no new programs (uniforms only, H13)', [r.p0, r.p1, r.p2]);
  check(r.groups === 0 || r.flickVals > 3, 'the flickering lamps\' groups change level over time', r);
  check(r.calmV.every(v => Math.abs(v - 0.8) < 1e-6), '"Calm effects" holds the flicker at 0.8', r.calmV);
}

/* ---------- Low leaves out the heavy parts (C10) ---------- */
{
  const r = await p.evaluate(() => { const A = level.atmos, M = level.archOpts.materials, fl = level.group.children.find(o => o.material && o.material.userData.mlFamily === 'floor');
    return { shafts: !!(A && A.shafts), motes: !!(A && A.motes), tier: A && A.stats.tier, wallLambert: M.wall.isMeshLambertMaterial, ceilLambert: M.ceiling.isMeshLambertMaterial,
      pom: !!(fl.material.defines && 'ML_POM' in fl.material.defines), env: !!fl.material.envMap }; });
  check(r.tier === 'lo' && !r.shafts && !r.motes, 'Low: no moonlight beams and no motes (the baked patches stay)', r);
  check(r.wallLambert && r.ceilLambert && !r.pom && !r.env, 'Low: Lambert walls and ceilings, no parallax, no wet reflections', r);
}

/* ---------- what you see: lamps pool light, the moon lies on the floor, the glass doesn't flare, the decals ---------- */
// (the game's own camera, so the flashlight (its child) comes along; the picture as shown, read back in the same task)
const VIEW = () => {
  window.__view = (pos, at, flashOn) => {
    const gl = renderer.getContext(), sz = renderer.getDrawingBufferSize(new THREE.Vector2()), buf = new Uint8Array(4 * 16);
    const keep = { p: camera.position.clone(), q: camera.quaternion.clone(), fi: flash.intensity, ai: aura.intensity, ap: aura.position.clone(), apar: aura.parent };
    camera.position.set(pos[0], pos[1], pos[2]); camera.lookAt(at[0], at[1], at[2]); camera.updateMatrixWorld(true);
    flash.intensity = flashOn ? FLASH_I : 0; aura.intensity = 0;
    renderer.setRenderTarget(null); renderer.render(scene, camera);
    gl.readPixels(Math.round(sz.x / 2) - 2, Math.round(sz.y / 2) - 2, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let r = 0, g = 0, b = 0, mx = 0; for (let i = 0; i < 16; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2]; mx = Math.max(mx, buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]); }
    camera.position.copy(keep.p); camera.quaternion.copy(keep.q); camera.updateMatrixWorld(true); flash.intensity = keep.fi; aura.intensity = keep.ai;
    return { rgb: [r / 16, g / 16, b / 16].map(Math.round), lum: Math.round((r + g + b) / 16), mx };
  };
};
await p.evaluate(VIEW);
{
  const r = await p.evaluate(() => {
    const plan = level.plan, M = MatLib.maps(), L = 2.25, out = {};
    // the lamps' pools: the floor's baked light right under each working ceiling lamp, against 3 m off (E = byte decoded x E_MAX)
    const lm = M.floorLM.image, dec = v => { v /= 255; return (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)) * 4; };
    const E = (x, z) => { const u = Math.min(lm.width - 1, Math.max(0, Math.floor(x / (GW * L) * lm.width))), v = Math.min(lm.height - 1, Math.max(0, Math.floor(z / (GH * L) * lm.height)));
      const i = (v * lm.width + u) * 4; return (dec(lm.data[i]) + dec(lm.data[i + 1]) + dec(lm.data[i + 2])) / 3; };
    const ceil = plan.fixtures.filter(f => f.state === 'ok' && f.face < 0);
    const under = ceil.map(f => E(f.x, f.z)).sort((a, b) => a - b);
    out.lamps = ceil.length; out.under = under.length ? [+under[under.length >> 1].toFixed(2), +under[under.length - 1].toFixed(2)] : [0, 0];
    // and on screen: looking down at the floor under the brightest of them, the lamps on vs. out
    if (ceil.length) { const f = ceil.slice().sort((a, b) => E(b.x, b.z) - E(a.x, a.z))[0];
      const at = [f.x, 0, f.z], pos = [f.x + 0.6, 1.62, f.z + 0.6];
      const on = __view(pos, at, false); MatLib.setK(0, true, false); const off = __view(pos, at, false); MatLib.setK(1, false, false);
      out.pool = [on.lum, off.lum]; }
    // the moon: where its light is strongest on the floor, seen from above with the flashlight off, the moon on vs. off
    // (on open floor, clear of the furniture, the lamps out so only the moon is left; looked at from just above)
    const ax = M.floorAux.image, clear = (x, z) => { const tx = Math.floor(x / L), tz = Math.floor(z / L); if (bb.isWall(tx, tz)) return false;
      for (const q of plan.windows) { const f = plan.faces[q.face]; if (f.x === tx && f.y === tz) return false; }
      return !SOLIDS.some(b => x / 0.045 > b.x0 - 15 && x / 0.045 < b.x1 + 15 && z / 0.045 > b.y0 - 15 && z / 0.045 < b.y1 + 15); };
    let best = -1, bx = 0, bz = 0; for (let i = 0; i < ax.data.length; i += 4) if (ax.data[i] > best) { const q = i / 4, x = ((q % ax.width) + 0.5) / ax.width * GW * L, z = (Math.floor(q / ax.width) + 0.5) / ax.height * GH * L;
      if (clear(x, z)) { best = ax.data[i]; bx = x; bz = z; } }
    out.moonR = best;
    if (best > 0) { const U = MatLib.U, k = U.uMoonK.value; MatLib.setK(0, true, false);
      const on = __view([bx + 0.3, 1.5, bz + 0.3], [bx, 0, bz], false); U.uMoonK.value = 0;
      const off = __view([bx + 0.3, 1.5, bz + 0.3], [bx, 0, bz], false); U.uMoonK.value = k; MatLib.setK(1, false, false); out.moon = [on.lum, off.lum, on.rgb]; }
    // the windows under the flashlight from 1.4 m: a soft sheen on the glass, the night still seen through it (never a white flare)
    out.flare = [];
    // (aimed at the middle of the upper left pane, off the glazing bars: the bars themselves are white paint, lit)
    for (const w of plan.windows) { const f = plan.faces[w.face], u = w.u0 + (w.u1 - w.u0) * 0.27, v0 = w.v0 || 0.9, v1 = w.v1 || 2.2, c = [f.x0 + (f.x1 - f.x0) * u, v0 + (v1 - v0) * 0.72, f.z0 + (f.z1 - f.z0) * u];
      const v = __view([c[0] + f.nx * 1.4, c[1], c[2] + f.nz * 1.4], c, true); out.flare.push([w.type, v.mx, v.lum]); }
    // the decals: Blender's atlas (textures/decals), cheap on Low (the small atlas, one merged mesh per chunk)
    const S = level.surface, at = S && S.decals.atlas;
    out.decals = S ? { n: S.stats.decals, chunks: S.stats.decalChunks, src: at.source, w: at.img ? at.img.width : 0, meshes: S.decals.group.children.length } : null;
    return out;
  });
  console.log('  (floor 1: ' + r.lamps + ' ceiling lamps, median E under them ' + r.under + '; pool on/off ' + r.pool + '; moon ' + r.moonR + ' ' + JSON.stringify(r.moon) + '; flashlit windows ' + JSON.stringify(r.flare) + '; decals ' + JSON.stringify(r.decals) + ')');
  check(r.lamps > 0 && r.under[0] >= 0.5 && r.under[1] >= 1, 'the lamps pool light on the floor below them (baked E under a ceiling lamp: median >= 0.5, the brightest >= 1)', r.under);
  check(r.pool && r.pool[0] >= r.pool[1] + 25, 'on screen the floor under a lamp is clearly lit by it (lamps on vs. out)', r.pool);
  check(r.moonR > 40 && r.moon && r.moon[0] >= r.moon[1] + 20 && r.moon[2][2] >= r.moon[2][0], 'the moonlight lies on the floor as a readable cool patch (moon on vs. off, flashlight off)', r.moon);
  check(r.flare.length > 0 && r.flare.every(f => f[1] < 250), 'the flashlight on a window: no white flare, the pane is never blown out', r.flare);
  check(r.decals && r.decals.n > 0 && r.decals.src === 'file' && r.decals.w > 0 && r.decals.w <= 1024 && r.decals.meshes <= r.decals.chunks + 1,
    'Low: the wall decals from Blender\'s atlas, the small one, one mesh per chunk (cheap)', r.decals);
}

/* ---------- the same floor bakes the same light (F4.5) ---------- */
{
  const h = async () => { await floor(p, 1, 424242); return p.evaluate(() => { const d = MatLib.maps().floorLM.image.data; let x = 0x811c9dc5; for (let i = 0; i < d.length; i++) { x ^= d[i]; x = Math.imul(x, 16777619); } return [x >>> 0, d.length]; }); };
  const a = await h(), c = await h();
  check(a[0] === c[0] && a[1] === c[1], 'two builds of the same floor bake identical lightmaps', [a, c]);
  const lc2 = await lightCount(p);
  check(lc2.n === 4 && lc2.inLevel === 0, 'still 4 lights after more floors', lc2);
}
await p.context().close();

/* ---------- Medium: the beams; the light count doesn't change with the quality ---------- */
{
  const m = await solo(b, 'medium', 320, 200);
  await until(m, () => typeof LIGHT_DATA !== 'undefined' && !!LIGHT_DATA.data, null, 60000);
  let r = null;
  for (let s = 0; s < 4 && !(r && r.moonlit); s++) {
    await floor(m, 1, 9000 + s);
    r = await m.evaluate(() => { const A = level.atmos; let n = 0; scene.traverse(o => { if (o.isLight) n++; });
      return { moonlit: level.light.bake.moonlit.length, shafts: !!(A && A.shafts), steps: A && A.stats.steps, motes: !!(A && A.motes), lights: n }; });
  }
  check(r.moonlit === 0 || (r.shafts && r.steps === 4 && !r.motes), 'Medium: one shaft mesh with 4 steps for the moonlit windows, no motes (High only)', r);
  check(r.lights === 4, 'Medium has the same 4 lights as Low (a quality change doesn\'t change the light count)', r.lights);
  await m.context().close();
}

/* ---------- High: the decals' big atlas, beams and motes, and still the same 4 lights ---------- */
{
  const h = await solo(b, 'high', 320, 200);
  await until(h, () => typeof LIGHT_DATA !== 'undefined' && !!LIGHT_DATA.data, null, 60000);
  await h.evaluate(() => floorAssets(1));
  let r = null;
  for (let s = 0; s < 4 && !(r && r.moonlit); s++) {
    await floor(h, 1, 9000 + s);
    r = await h.evaluate(() => { const A = level.atmos, S = level.surface, at = S && S.decals.atlas; let n = 0; scene.traverse(o => { if (o.isLight) n++; });
      return { moonlit: level.light.bake.moonlit.length, shafts: !!(A && A.shafts), steps: A && A.stats.steps, motes: !!(A && A.motes), lights: n,
        decals: S ? S.stats.decals : 0, src: at && at.source, w: at && at.img ? at.img.width : 0 }; });
  }
  check(r.decals > 0 && r.src === 'file' && r.w >= 2048, 'High: the wall decals (stains, damp, scuffs) from Blender\'s big atlas', r);
  check(r.moonlit === 0 || (r.shafts && r.steps === 8 && r.motes), 'High: the moonlight beams with 8 steps and the dust motes in them', r);
  check(r.lights === 4, 'High: still the same 4 lights', r.lights);
  await h.context().close();
}

/* ---------- no kit: plain lamps at the plan's spots, no moonlight through walls that stay closed (E7) ---------- */
{
  const ctx = await b.newContext({ viewport: { width: 320, height: 200 } });
  await ctx.addInitScript(() => localStorage.setItem('bb_settings', JSON.stringify({ sens: 1, vol: 0.5, quality: 'low' })));
  const q = await ctx.newPage();
  q.on('pageerror', e => { console.log('  pageerror:', e.message); pageErrors.push(e.message); });
  await q.goto(BASE + '?kit=off', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await q.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 120000, polling: 500 });
  await until(q, () => typeof LIGHT_DATA !== 'undefined' && !!LIGHT_DATA.data, null, 60000);
  await q.evaluate(() => { bb.startFloor(0); bb.state = 'play'; notes.forEach(n => { n.read = true; }); bb.monster.active = false; bb.monster.spawnT = 1e9; buildLevel(); });
  const r = await q.evaluate(() => ({ kit: !!level.archKit, fixtures: level.plan.fixtures.length, house: level.house.fixtures.length, at: level.house.fixtures.every((f, i) => {
      const fx = level.plan.fixtures[i]; return Math.hypot(f.pos.x - fx.x, f.pos.y - fx.y, f.pos.z - fx.z) < 1e-6; }),
    windows: level.light.bake.windows, moon: (() => { const d = MatLib.maps().floorAux.image.data; let mx = 0; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i]); return mx; })(),
    lights: (() => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; })() }));
  check(!r.kit && r.house === r.fixtures && r.at, 'without the kit house.js hangs a plain lamp at each of the plan\'s lamps, exactly there', r);
  check(r.windows === false && r.moon === 0, 'without the kit the windows stay wall, so no moonlight is baked through them', r);
  check(r.lights === 4, 'without the kit: still 4 lights', r.lights);
  await ctx.close();
}

check(pageErrors.length === 0, 'no page errors', pageErrors);
await b.close();
process.exit(summary());
