// The night outside and the air inside (js/atmos.js, spec C6, C7, C10, H12, H13): the windows' sky and glass, the moonlight shafts
// (one mesh per floor, every prism stopped at the first wall), the dust motes (High only, inside the window's light), the flashlight's
// bounce light (its hit point on synthetic rays: floor, wall, ceiling, a sloped ceiling, a box; and on a real floor), and the fixed
// light count. js/atmos.js and the modules it reads (dress, lightbake, matlib, kit, arch) aren't in index.html yet, so they're added
// to the page at run time. Ends with a moonlit window bay per style at medium and high (tests/out/atmos_<style>_<tier>.png).
import { launch, solo, check, summary, pageErrors, OUT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

import zlib from 'node:zlib';

// a small flat PNG (for the glass normal map: a picture bigger than the 4 x 4 stand-in must reach the GPU)
function png(w, h, rgb) {
  const crc = buf => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const b = await launch();
const p = await solo(b, 'low', 480, 300);
await p.route('**/textures/glass/rain_normal.webp', r => r.fulfill({ status: 200, contentType: 'image/png', body: png(64, 64, [40, 200, 255]) }));
p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) console.log('  console:', m.text().slice(0, 300)); });
for (const [g, f] of [['Dress', 'dress'], ['LightBaker', 'lightbake'], ['MatLib', 'matlib'], ['Kit', 'kit'], ['Arch', 'arch'], ['Atmos', 'atmos']])
  if (!await p.evaluate(g => typeof window[g] !== 'undefined', g)) await p.addScriptTag({ url: '/js/' + f + '.js' });
check(await p.evaluate(() => typeof Atmos.build === 'function' && typeof Atmos.skyMaterial === 'function' && typeof Atmos.glassMaterial === 'function'
  && typeof Atmos.bounce.init === 'function' && typeof Atmos.bounce.update === 'function'), 'js/atmos.js loads and exposes build, bounce {init, update}, skyMaterial, glassMaterial');

/* ---------- shafts and motes on real floors ---------- */
const floors = await p.evaluate(() => {
  const out = [];
  // 1-player floors (6 seeds a style) and the bigger 4-player ones (3 seeds a style)
  const runs = []; for (let i = 0; i < 5; i++) { for (const seed of [101, 202, 303, 404, 505, 606]) runs.push([i, 1, seed]); for (const seed of [11, 707, 4242]) runs.push([i, 4, seed]); }
  for (const [i, np, seed] of runs) {
    const d = generateFloor(i, np, 'medium', seed + i * 1000); applyFloor(d, 0);
    const plan = Dress.plan(Dress.envFromData(d)), L = plan.L, GW = plan.GW, GH = plan.GH;
    const isW = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || grid[y][x] === 1;
    const r = { i, np, seed, style: plan.style, windows: plan.windows.length, moonlit: plan.windows.filter(w => w.moonlit).length, tiers: {} };
    for (const tier of ['low', 'medium', 'high']) {
      const R = Atmos.build(null, plan, { tier, grid });
      let shaftMeshes = 0, pointMeshes = 0; R.group.traverse(o => { if (o.isMesh && o.material && o.material.name === 'AtmosShafts') shaftMeshes++; if (o.isPoints) pointMeshes++; });
      const t = { shaftMeshes, pointMeshes, motes: R.stats.motes, verts: R.stats.shaftVerts, steps: R.stats.steps, cookie: R.stats.cookie, badV: [], badRay: [], badY: [], badMote: [], fog: true, samples: 0, shadowed: 0, missBox: 0, merged: R.stats.merged, overflow: R.stats.boxOverflow, hullSteps: [] };
      if (R.shafts) {
        const P = R.shafts.geometry.attributes.position.array, S = R.shafts.geometry.attributes.aS.array, N = R.shafts.geometry.attributes.aN.array;
        t.fog = R.shafts.material.fog; t.depthWrite = R.shafts.material.depthWrite; t.side = R.shafts.material.side; t.blending = R.shafts.material.blending;
        const lit = plan.windows.filter(w => w.moonlit), U = R.shafts.geometry.attributes.aU.array, V = R.shafts.geometry.attributes.aV.array, seen = new Set();
        const m = plan.moon, ce = Math.cos(m.el), D = [-Math.sin(m.az) * ce, -Math.sin(m.el), -Math.cos(m.az) * ce];
        for (let v = 0; v < P.length / 3; v++) {
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], tx = Math.floor(x / L), ty = Math.floor(z / L);
          const w = lit[S[v * 4 + 3]], f = plan.faces[w.face], own = [f.x - Math.round(f.nx), f.y - Math.round(f.nz)]; seen.add(S[v * 4 + 3]);
          if (isW(tx, ty) && !(tx === own[0] && ty === own[1])) t.badV.push([v, x, y, z]);
          if (y < 0.02 - 1e-4) t.badY.push([v, y]);
          // on its slice of the beam: (u, v) back-projected to the opening inside the slice, in front of the wall
          const uq = U[v * 4] * x + U[v * 4 + 1] * y + U[v * 4 + 2] * z + U[v * 4 + 3], vq = V[v * 4] * x + V[v * 4 + 1] * y + V[v * 4 + 2] * z + V[v * 4 + 3], dpl = N[v * 4] * x + N[v * 4 + 2] * z + N[v * 4 + 3];
          if (uq < S[v * 4] - 1e-3 || uq > S[v * 4 + 1] + 1e-3 || vq < -1e-3 || vq > 1 + 1e-3 || dpl < -1e-4) t.badV.push(['slab', v, uq, vq, dpl]);
          // the light's straight path from the opening to this vertex crosses no wall tile (the 2D march stopped it in time)
          const back = dpl / (D[0] * f.nx + D[2] * f.nz), ax = x - D[0] * back, az = z - D[2] * back;
          for (let k = 1; k <= 200; k++) { const qx = ax + (x - ax) * k / 200, qz = az + (z - az) * k / 200;
            if (isW(Math.floor(qx / L), Math.floor(qz / L))) { t.badRay.push([v, qx, qz]); break; } }
        }
        t.windowsWithShaft = seen.size;
        // tall boxes (the bake's moon stops at them): every point of a hull inside one, or whose way back to the window crosses one,
        // has that box among the hull's 2 shader boxes (aB0 / aB1), so the shader darkens it
        const tall = SOLIDS.filter(q => q.occ === 'tall').map(q => [q.x0 * 0.045, q.y0 * 0.045, q.x1 * 0.045, q.y1 * 0.045, q.h || 1]), sl = new Map();
        const B0 = R.shafts.geometry.attributes.aB0.array, B1 = R.shafts.geometry.attributes.aB1.array, H = R.shafts.geometry.attributes.aH.array;
        let rs = (seed * 7919 + i * 31 + np) >>> 0; const rnd = () => (rs = (Math.imul(rs, 1103515245) + 12345) >>> 0) / 4294967296;
        for (let v = 0; v < P.length / 3; v++) { const key = S[v * 4 + 3] + ':' + S[v * 4]; if (!sl.has(key)) sl.set(key, []); sl.get(key).push(v); }
        const Mt = [-D[0], -D[1], -D[2]];
        const blocks = (X, b, tm) => { let a = -Infinity, c = Infinity;
          for (const [k, lo, hi] of [[0, b[0], b[2]], [1, 0, b[4]], [2, b[1], b[3]]]) { if (Math.abs(Mt[k]) < 1e-9) { if (X[k] < lo || X[k] > hi) return false; continue; }
            let t0 = (lo - X[k]) / Mt[k], t1 = (hi - X[k]) / Mt[k]; if (t0 > t1) [t0, t1] = [t1, t0]; a = Math.max(a, t0); c = Math.min(c, t1); }
          return a <= c && c >= 0 && a <= tm; };
        for (const vs of sl.values()) {
          const v0 = vs[0], w = lit[S[v0 * 4 + 3]], f = plan.faces[w.face], has = b => [[B0, H[v0 * 4]], [B1, H[v0 * 4 + 1]]].some(([A, h]) => h >= 0 && Math.abs(A[v0 * 4] - b[0]) < 1e-4 && Math.abs(A[v0 * 4 + 1] - b[1]) < 1e-4);
          t.hullSteps.push(H[v0 * 4 + 2]);
          for (let q = 0; q < 200; q++) { let ws = 0, x = 0, y = 0, z = 0;
            for (let k = 0; k < 4; k++) { const v = vs[Math.floor(rnd() * vs.length)], ww = rnd(); ws += ww; x += P[v * 3] * ww; y += P[v * 3 + 1] * ww; z += P[v * 3 + 2] * ww; }
            x /= ws; y /= ws; z /= ws; t.samples++;
            const dpl = N[v0 * 4] * x + N[v0 * 4 + 2] * z + N[v0 * 4 + 3], tm = dpl / (D[0] * f.nx + D[2] * f.nz);
            const sh = tall.filter(b => blocks([x, y, z], b, tm));
            if (sh.length) { t.shadowed++; if (!sh.some(has) && !t.overflow) t.missBox++; } }
        }
      }
      if (R.motes) {
        const A = R.motes.geometry.attributes, P = A.position.array, U = A.aU.array, V = A.aV.array, N = A.aN.array;
        for (let j = 0; j < A.position.count; j++) { const x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2];
          const u = U[j * 4] * x + U[j * 4 + 1] * y + U[j * 4 + 2] * z + U[j * 4 + 3], v = V[j * 4] * x + V[j * 4 + 1] * y + V[j * 4 + 2] * z + V[j * 4 + 3], dp = N[j * 4] * x + N[j * 4 + 2] * z + N[j * 4 + 3];
          if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1 && dp >= 0 && y > 0)) t.badMote.push([j, u, v, dp, y]);
          if (isW(Math.floor(x / L), Math.floor(z / L))) t.badMote.push(['wall', j]); }
      }
      // the same plan builds the same shafts
      const R2 = Atmos.build(null, plan, { tier, grid });
      t.same = (!R.shafts && !R2.shafts) || (R.shafts && R2.shafts && R.shafts.geometry.attributes.position.array.join() === R2.shafts.geometry.attributes.position.array.join());
      t.ms = R.stats.ms;
      R.dispose(); R2.dispose();
      t.badV = t.badV.slice(0, 3); t.badRay = t.badRay.slice(0, 3); t.badMote = t.badMote.slice(0, 3); t.badY = t.badY.slice(0, 3);
      r.tiers[tier] = t;
    }
    out.push(r);
  }
  return out;
});
const lit = floors.filter(f => f.moonlit > 0);
console.log(`  ${floors.length} floors, ${lit.length} with moonlit windows (${floors.reduce((s, f) => s + f.moonlit, 0)} moonlit of ${floors.reduce((s, f) => s + f.windows, 0)} windows)`);
check(lit.length >= 10 && new Set(lit.map(f => f.style)).size === 5, 'moonlit windows on floors of every style', lit.map(f => f.style + ':' + f.moonlit));
const bad = (k, tier) => floors.filter(f => f.tiers[tier][k].length).map(f => [f.i, f.seed, f.tiers[tier][k]]);
for (const tier of ['medium', 'high']) {
  check(lit.every(f => f.tiers[tier].shaftMeshes === 1) && floors.filter(f => !f.moonlit).every(f => f.tiers[tier].shaftMeshes === 0),
    `${tier}: exactly one shaft mesh per floor with moonlit windows (none without)`, floors.map(f => f.tiers[tier].shaftMeshes));
  check(lit.every(f => f.tiers[tier].windowsWithShaft === f.moonlit), `${tier}: every moonlit window has its shaft in that one mesh`, lit.map(f => [f.tiers[tier].windowsWithShaft, f.moonlit]));
  check(!bad('badV', tier).length, `${tier}: no shaft vertex inside a wall tile beyond the window's own tile; every vertex on its slice of the beam`, bad('badV', tier).slice(0, 3));
  check(!bad('badRay', tier).length, `${tier}: the light's path from the opening to every shaft vertex crosses no wall (clipped at the first wall)`, bad('badRay', tier).slice(0, 3));
  check(!bad('badY', tier).length, `${tier}: shafts end above the floor`, bad('badY', tier).slice(0, 3));
  check(lit.every(f => f.tiers[tier].fog === false && f.tiers[tier].depthWrite === false && f.tiers[tier].side === 1 && f.tiers[tier].blending === 2),
    `${tier}: shafts are additive, back faces, no depth write, no fog`);
  check(floors.every(f => f.tiers[tier].same), `${tier}: the same plan builds the same shafts`);
}
check(lit.every(f => f.tiers.high.steps === 8 && f.tiers.high.cookie && f.tiers.medium.steps === 4 && !f.tiers.medium.cookie), 'steps: high 8 with the cookie, medium 4 without');
check(floors.every(f => f.tiers.low.shaftMeshes === 0 && f.tiers.low.pointMeshes === 0), 'low: no shafts, no motes');
check(floors.every(f => f.tiers.medium.pointMeshes === 0), 'medium: no motes');
check(lit.every(f => f.tiers.high.pointMeshes === 1 && f.tiers.high.motes > 0 && f.tiers.high.motes <= Math.min(600, 60 * f.moonlit)), 'high: one Points mesh, <= 60 motes per window, <= 600 per floor',
  lit.map(f => [f.tiers.high.motes, f.moonlit]));
check(!bad('badMote', 'high').length, 'high: every mote starts inside its window\'s beam, in front of the wall, above the floor, in an open tile', bad('badMote', 'high').slice(0, 3));
for (const tier of ['medium', 'high']) {
  const sh = floors.reduce((s, f) => s + f.tiers[tier].shadowed, 0), sm = floors.reduce((s, f) => s + f.tiers[tier].samples, 0), miss = floors.filter(f => f.tiers[tier].missBox).map(f => [f.style, f.np, f.seed, f.tiers[tier].missBox]);
  console.log(`  ${tier}: ${sh} of ${sm} beam samples inside or behind a tall box; ${floors.filter(f => f.tiers[tier].overflow).length} floors with > 2 boxes in a hull; windows in one hull ${floors.reduce((s, f) => s + f.tiers[tier].merged, 0)} of ${lit.reduce((s, f) => s + f.moonlit, 0)}`);
  check(sh > 0 && !miss.length, `${tier}: every beam point inside or behind a tall box has that box in its hull's shader boxes (darkened)`, miss);
  const want = tier === 'high' ? [8, 3] : [4, 2];
  check(lit.every(f => f.tiers[tier].hullSteps.every(n => want.includes(n))), `${tier}: ${want[0]} samples through a window's single hull, ${want[1]} through each of 3 slices`, [...new Set(floors.flatMap(f => f.tiers[tier].hullSteps))]);
}
check(floors.some(f => f.np === 4 && f.moonlit > 0), '4-player floors with moonlit windows are covered');
console.log(`  build time (high): max ${Math.max(...floors.map(f => f.tiers.high.ms))} ms`);

/* ---------- on the GPU: the sky compiles without fog; the motes light only inside the cookie's mask; uniforms only per frame ---------- */
await p.evaluate(() => new Promise(res => { Atmos.glassMaterial('medium'); const t0 = performance.now();
  (function wait() { const m = Atmos.glassMaterial('medium'); if ((m.normalMap.image && m.normalMap.image.width === 64) || performance.now() - t0 > 5000) res(); else setTimeout(wait, 50); })(); }));
const gpu = await p.evaluate(() => {
  const r = {};
  const R = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); R.setSize(160, 100); R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.2;
  const sky = Atmos.skyMaterial('medium'), glass = Atmos.glassMaterial('medium');
  r.skyFog = sky.fog; r.skyIsShader = !!sky.isShaderMaterial; r.sameSky = Atmos.skyMaterial() === sky; r.glassEnv = glass.envMap && glass.envMap.mapping; r.glassEnvK = glass.envMapIntensity;
  r.glassTransparent = glass.transparent && glass.isMeshStandardMaterial;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x020205, 1.5, 16);
  const cam = new THREE.PerspectiveCamera(70, 1.6, 0.05, 40); cam.position.set(0, 1.5, 3); cam.lookAt(0, 1.9, 0);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), sky); plane.position.set(0, 1.5, -1); scene.add(plane);
  R.compile(scene, cam); R.render(scene, cam);
  const gl = R.getContext(), px = new Uint8Array(4); gl.readPixels(80, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  r.skyPx = Array.from(px); r.skyErr = gl.getError();
  r.programs0 = R.info.programs.length; r.progOk = R.info.programs.every(q => q.diagnostics === undefined || q.diagnostics.runnable !== false);
  // the motes, alone in the dark: lit with the window's light, gone when the cookie says no light comes through
  const d = generateFloor(0, 1, 'medium', 101); applyFloor(d, 0);
  let plan = null, s = 101;
  for (; s < 160; s++) { const dd = generateFloor(0, 1, 'medium', s); applyFloor(dd, 0); plan = Dress.plan(Dress.envFromData(dd)); if (plan.windows.some(w => w.moonlit)) break; }
  const A = Atmos.build(null, plan, { tier: 'high', grid });
  const ms = new THREE.Scene(); ms.add(A.group);
  const w = plan.windows.find(q => q.moonlit), f = plan.faces[w.face], L = plan.L;
  const c = [(f.x0 + f.x1) / 2 + f.nx * 1.2, 1.2, (f.z0 + f.z1) / 2 + f.nz * 1.2];
  const mc = new THREE.PerspectiveCamera(80, 1.6, 0.05, 40); mc.position.set(c[0] + f.nx * 2.6, 1.5, c[2] + f.nz * 2.6); mc.lookAt(c[0], 1.0, c[2]);
  A.shafts.visible = false; A.update(5);
  const count = () => { R.render(ms, mc); const buf = new Uint8Array(160 * 100 * 4); gl.readPixels(0, 0, 160, 100, gl.RGBA, gl.UNSIGNED_BYTE, buf); let n = 0; for (let k = 0; k < buf.length; k += 4) if (buf[k] + buf[k + 1] + buf[k + 2] > 6) n++; return n; };
  // (the procedural cookie is a canvas: wait for nothing, it's drawn at build)
  r.moteLit = count();
  const black = document.createElement('canvas'); black.width = black.height = 8; const bg = black.getContext('2d'); bg.fillStyle = '#000'; bg.fillRect(0, 0, 8, 8);
  const keep = A.motes.material.uniforms.uCookie.value, bt = new THREE.CanvasTexture(black);
  A.motes.material.uniforms.uCookie.value = bt; r.moteDark = count(); A.motes.material.uniforms.uCookie.value = keep;
  // the shafts draw something where the beam is (and the uniforms change nothing in the programs)
  A.motes.visible = false; A.shafts.visible = true; r.shaftLit = count();
  // a tall box over the whole floor in every hull's shader slot: the moonlight's way back to the window is blocked everywhere
  { const g = A.shafts.geometry, B0 = g.attributes.aB0, H = g.attributes.aH, k0 = B0.array.slice(), h0 = H.array.slice();
    for (let v = 0; v < B0.count; v++) { B0.array.set([-100, -100, 200, 200], v * 4); H.array[v * 4] = 10; }
    B0.needsUpdate = H.needsUpdate = true; r.shaftBlocked = count();
    B0.array.set(k0); H.array.set(h0); B0.needsUpdate = H.needsUpdate = true; r.shaftBack = count(); }
  // the glass normal map: the 64 x 64 test picture replaces the 4 x 4 stand-in on the GPU (no GL error, its colour is drawn)
  const gm = Atmos.glassMaterial('medium'), nm = gm.normalMap;
  r.glassImg = nm && nm.image ? [nm.image.width, nm.image.height] : null;
  const gs = new THREE.Scene(), gp = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ map: nm })); gp.position.set(0, 1.5, -1); gs.add(gp);
  R.toneMapping = THREE.NoToneMapping; R.outputColorSpace = 'srgb-linear'; gl.getError();
  R.render(gs, cam); const gpx = new Uint8Array(4); gl.readPixels(80, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, gpx); r.glassPx = Array.from(gpx); r.glassErr = gl.getError();
  R.toneMapping = THREE.ACESFilmicToneMapping; R.outputColorSpace = THREE.SRGBColorSpace; gp.geometry.dispose(); gp.material.dispose();
  const p0 = R.info.programs.length;
  for (let k = 0; k < 5; k++) { A.update(6 + k); Atmos.update(7 + k); R.render(ms, mc); }
  r.programsSame = R.info.programs.length === p0;
  A.dispose(); bt.dispose(); R.dispose();
  return r;
});
check(gpu.skyIsShader && gpu.skyFog === false && gpu.sameSky, 'sky: one shared ShaderMaterial with fog off', gpu);
check(gpu.skyErr === 0 && gpu.progOk && gpu.programs0 >= 1, 'sky compiles and renders (in a scene with fog)', gpu);
check(gpu.skyPx[2] >= gpu.skyPx[0] && gpu.skyPx[2] > 0 && gpu.skyPx[0] + gpu.skyPx[1] + gpu.skyPx[2] < 300, 'sky: a dark blue night when the sky picture is missing', gpu.skyPx);
check(gpu.glassTransparent && gpu.glassEnv === 303 && Math.abs(gpu.glassEnvK - 0.4) < 1e-6, 'glass: transparent Standard, envMap = the sky (303) at 0.4', [gpu.glassEnv, gpu.glassEnvK]);
check(gpu.moteLit > 0, 'motes: visible in the moonlit window\'s beam', gpu.moteLit);
check(gpu.moteDark === 0, 'motes: dark where the cookie lets no moonlight through (lit only inside the mask)', gpu.moteDark);
check(gpu.shaftLit > 50, 'shafts: the beam shows', gpu.shaftLit);
check(gpu.shaftBlocked === 0 && gpu.shaftBack === gpu.shaftLit, 'shafts: dark where a tall box stands between the point and the window', [gpu.shaftBlocked, gpu.shaftBack, gpu.shaftLit]);
check(gpu.glassImg && gpu.glassImg[0] === 64 && gpu.glassErr === 0 && gpu.glassPx[1] > 150 && gpu.glassPx[0] < 90 && gpu.glassPx[1] > 3 * gpu.glassPx[0],
  'glass: a rain_normal picture bigger than the stand-in reaches the GPU (no GL error)', [gpu.glassImg, gpu.glassPx, gpu.glassErr]);
check(gpu.programsSame, 'per frame: uniforms only (no new programs over frames)');

/* ---------- the flashlight bounce: the march on synthetic rays ---------- */
const casts = await p.evaluate(() => {
  const L = 2.25, W = 5, G = [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1];   // a 3 x 3 room (tiles 1..3), walls round it
  const box = { x0: 2.5 / 0.045, y0: 6.0 / 0.045, x1: 3.5 / 0.045, y1: 6.6 / 0.045, h: 1.0 };          // a box 1 x 0.6 m, 1 m high
  const env = { L, wall: (x, y) => x < 0 || y < 0 || x >= W || y >= W || G[y * W + x] === 1, ceil: () => 3.0, solids: [box] };
  const gable = Object.assign({}, env, { ceil: x => 2.5 + 0.2 * (x - 2.25) });
  const B = Atmos.bounce, r = {};
  r.floor = B.cast([4, 1.6, 4], [0, -1, 0], 12, env);
  r.floorSlant = B.cast([4, 1.6, 4], [0.6, -0.8, 0], 12, env);
  r.wall = B.cast([4, 1.6, 4], [1, 0, 0], 12, env);
  r.wallZ = B.cast([4, 1.6, 4], [0, 0.1, -1], 12, env);
  r.ceil = B.cast([4, 1.6, 4], [0, 1, 0], 12, env);
  r.gable = B.cast([4, 1.6, 4], [0, 1, 0], 12, gable);
  r.boxSide = B.cast([3, 0.5, 4], [0, 0, 1], 12, env);
  r.boxTop = B.cast([3, 1.6, 6.3], [0, -1, 0], 12, env);
  r.far = B.cast([4, 1.6, 4], [1, 0, 0], 1.0, env);
  // a ceiling step (3.0 m over tile x = 1, 3.6 m beyond x = 4.5) and a wall tile whose ceiling reads differently (as CEIL can)
  const step = Object.assign({}, env, { ceil: x => x >= 9 ? 0.5 : x < 4.5 ? 3.0 : 3.6 });
  r.stepHit = B.cast([3.0, 1.6, 4], [1.486, 1.4, 0], 12, step);              // meets the 3.0 ceiling 1.4 cm before the step
  r.wallCeil = B.cast([7.0, 1.6, 4], [1.99, 1.4, 0], 12, Object.assign({}, step, { ceil: x => x >= 9 ? 3.6 : 3.0 }));   // 1 cm before the wall
  r.nearWall = B.cast([8.0, 1.6, 4], [0.98, 2.0, 0], 12, step);              // 2 cm from the wall tile (3.6 m): the normal stays -y
  r.nearStep = B.cast([3.0, 1.6, 4], [1.47, 1.4, 0], 12, step);              // 3 cm before the step
  r.det = JSON.stringify(B.cast([4.1, 1.5, 3.9], [0.5, -0.2, 0.7], 12, env)) === JSON.stringify(B.cast([4.1, 1.5, 3.9], [0.5, -0.2, 0.7], 12, env));
  return r;
});
const near = (a, b, e = 0.011) => a.every((v, i) => Math.abs(v - b[i]) <= e);
check(casts.floor.kind === 'floor' && near(casts.floor.p, [4, 0, 4]) && near(casts.floor.n, [0, 1, 0]) && Math.abs(casts.floor.dist - 1.6) < 0.01, 'bounce: straight down hits the floor 1.6 m below', casts.floor);
check(casts.floorSlant.kind === 'floor' && near(casts.floorSlant.p, [5.2, 0, 4]), 'bounce: a slanting ray hits the floor at the right point', casts.floorSlant);
check(casts.wall.kind === 'wall' && near(casts.wall.p, [9, 1.6, 4]) && near(casts.wall.n, [-1, 0, 0]), 'bounce: a level ray hits the wall tile\'s face (x = 9, n -x)', casts.wall);
check(casts.wallZ.kind === 'wall' && near(casts.wallZ.p, [4, 1.6 + 0.1 * (4 - 2.25), 2.25], 0.02) && near(casts.wallZ.n, [0, 0, 1]), 'bounce: toward -z hits the wall at z = 2.25 (n +z)', casts.wallZ);
check(casts.ceil.kind === 'ceiling' && near(casts.ceil.p, [4, 3, 4]) && near(casts.ceil.n, [0, -1, 0]), 'bounce: straight up hits the 3.0 m ceiling', casts.ceil);
const gy = 2.5 + 0.2 * (4 - 2.25), gl = Math.hypot(0.2, 1);
check(casts.gable.kind === 'ceiling' && near(casts.gable.p, [4, gy, 4], 0.005) && near(casts.gable.n, [0.2 / gl, -1 / gl, 0], 0.01), 'bounce: a sloped ceiling: the hit on the slope, its normal tilted', casts.gable);
check(casts.boxSide.kind === 'box' && near(casts.boxSide.p, [3, 0.5, 6.0]) && near(casts.boxSide.n, [0, 0, -1]), 'bounce: a ray into a box stops on its side (n -z)', casts.boxSide);
check(casts.boxTop.kind === 'box' && near(casts.boxTop.p, [3, 1.0, 6.3]) && near(casts.boxTop.n, [0, 1, 0]), 'bounce: a ray down onto a box stops on its top', casts.boxTop);
check(!casts.far.hit && Math.abs(casts.far.dist - 1) < 1e-9, 'bounce: nothing within reach -> no hit', casts.far);
check(casts.stepHit.kind === 'ceiling' && near(casts.stepHit.p, [4.486, 3.0, 4], 0.005), 'bounce: a ceiling met just before a higher ceiling\'s tile is not skipped', casts.stepHit);
check(casts.wallCeil.kind === 'ceiling' && near(casts.wallCeil.p, [8.99, 3.0, 4], 0.005), 'bounce: a ceiling met just before a wall tile is the ceiling, not the wall above it', casts.wallCeil);
check(casts.nearWall.kind === 'ceiling' && near(casts.nearWall.n, [0, -1, 0], 1e-6) && casts.nearStep.kind === 'ceiling' && near(casts.nearStep.n, [0, -1, 0], 1e-6),
  'bounce: the ceiling normal next to a wall tile or a ceiling step stays straight down', [casts.nearWall, casts.nearStep]);
check(casts.det, 'bounce: the march is deterministic');

/* ---------- in the game: the light count, the bounce on a real floor ---------- */
const live = await p.evaluate(() => {
  const r = {};
  bb.startFloor(0); buildLevel();
  const lights = () => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; };
  r.lights0 = lights(); r.auraOnCam = aura.parent === camera;
  Atmos.bounce.init(aura, flash, scene);
  r.lights1 = lights(); r.auraInScene = aura.parent === scene;
  const plan = Dress.plan(Dress.envFromGame());
  const A = Atmos.build(level, plan, { tier: 'high' });
  r.inLevel = A.group.parent === level.group; r.lights2 = lights();
  // look at a wall from the middle of an open tile: the bounce sits 0.35 m in front of what the flashlight hits
  const L = 2.25; let tile = null;
  for (let y = 1; y < GH - 1 && !tile; y++) for (let x = 1; x < GW - 1; x++) if (grid[y][x] === 0 && grid[y][x + 1] === 1 && !SOLIDS.some(s => s.x1 * 0.045 > x * L && s.x0 * 0.045 < (x + 1) * L && s.y1 * 0.045 > y * L && s.y0 * 0.045 < (y + 1) * L)) { tile = [x, y]; break; }
  camera.position.set((tile[0] + 0.5) * L, 1.62, (tile[1] + 0.5) * L); camera.rotation.set(0, -Math.PI / 2, 0); camera.updateMatrixWorld(true);   // (yaw -90 deg: looking along +x)
  flash.intensity = 25;
  let h = null; for (let k = 0; k < 40; k++) { h = Atmos.bounce.update(1 / 60, camera, flash, false); A.update(k / 60); }
  r.hit = h; r.aura = aura.position.toArray(); r.auraI = aura.intensity; r.auraD = aura.distance; r.auraDecay = aura.decay;
  r.wallX = (tile[0] + 1) * L;
  const want = h && h.hit ? 2.5 * ((Atmos.bounce.albedo()[h.kind].reduce((a, b) => a + b, 0)) / 3) * 25 / 25 / (1 + 0.08 * h.dist * h.dist) : -1; r.wantI = want;
  r.lights3 = lights();
  Atmos.bounce.update(1 / 60, camera, flash, true); r.hidden = { p: aura.position.toArray(), cam: camera.getWorldPosition(new THREE.Vector3()).toArray(), i: aura.intensity, d: aura.distance };
  Atmos.bounce.update(1 / 60, camera, flash, 3.5); r.hidden35 = aura.intensity;
  Atmos.bounce.update(1 / 60, camera, flash, 1.2, 4.5); r.dead = { i: aura.intensity, d: aura.distance, p: aura.position.toArray() };
  // the aura never sits inside a wall, a box or above the ceiling: looking into the room's corners and up at its edges
  r.auraSolid = 0; r.auraTries = 0;
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { if (grid[y][x] !== 0) continue;
    for (const [yaw, pitch] of [[0.6, 0.9], [2.2, 0.9], [3.8, 0.9], [5.4, 0.9], [0.8, 0.2], [3.9, -0.6]]) {
      camera.position.set((x + 0.5) * L, 1.62, (y + 0.5) * L); camera.rotation.set(pitch, yaw, 0); camera.updateMatrixWorld(true);
      if (Atmos.bounce.solidAt([camera.position.x, camera.position.y, camera.position.z])) continue;
      for (let k = 0; k < 60; k++) Atmos.bounce.update(1 / 60, camera, flash, false);
      r.auraTries++; if (Atmos.bounce.solidAt(aura.position.toArray())) r.auraSolid++; } }
  r.lights4 = lights();
  r.skySwapped = A.stats.sky; r.glassSwapped = A.stats.glass;
  A.dispose();
  return r;
});
check(live.lights0 === live.lights1 && live.lights1 === live.lights2 && live.lights2 === live.lights3 && live.lights3 === live.lights4, 'the light count never changes (init, build, update, hidden)', [live.lights0, live.lights1, live.lights2, live.lights3, live.lights4]);
check(live.auraOnCam && live.auraInScene, 'bounce.init re-parents aura from the camera to the scene');
check(live.inLevel, 'Atmos.build adds its group to level.group');
check(live.hit && live.hit.kind === 'wall' && Math.abs(live.hit.p[0] - live.wallX) < 0.01 && live.hit.n[0] === -1, 'bounce on a real floor: the flashlight hits the wall ahead', [live.hit, live.wallX]);
check(Math.abs(live.aura[0] - (live.wallX - 0.35)) < 0.05 && live.auraD === 5.5 && live.auraDecay === 2, 'bounce: aura 0.35 m in front of the hit, distance 5.5, decay 2', [live.aura, live.auraD, live.auraDecay]);
check(Math.abs(live.auraI - live.wantI) < 0.01 * live.wantI + 1e-3, 'bounce: intensity 2.5 rho I/25 / (1 + 0.08 d^2) (after easing)', [live.auraI, live.wantI]);
check(live.dead.i === 1.2 && live.dead.d === 4.5 && near(live.dead.p, live.hidden.cam, 1e-6), 'bounce: a given distance at the camera (dead or spectating: 1.2, 4.5 as today)', live.dead);
check(live.auraTries > 50 && live.auraSolid === 0, 'bounce: the aura never ends up inside a wall, a box or above the ceiling', [live.auraSolid, live.auraTries]);
check(near(live.hidden.p, live.hidden.cam, 1e-6) && live.hidden.i === 3.2 && live.hidden.d === 8 && live.hidden35 === 3.5, 'bounce while hidden: today\'s light at the camera (3.2 / 3.5, distance 8)', live.hidden);

/* ---------- pictures: a moonlit window bay per style, at medium and high ---------- */
const TEX = { wood: ['wall_paper1', 'floor_wood1'], tile: ['wall_tile2', 'floor_tile2'], concrete: ['wall_brick3', 'floor_concrete3'], attic: ['wall_attic4', 'floor_wood4'], workshop: ['wall_shop5', 'floor_tile5'] };
const styles = await p.evaluate(() => FLOORS.map(f => f.style));
for (let i = 0; i < 5; i++) {
  const st = styles[i];
  await p.evaluate(s => Kit.want(s, 'lo'), st);
  const shot = await p.evaluate(async ([i, tex]) => {
    // a floor with a moonlit window whose bay is open for 3 tiles
    let d, plan, w, f, seed;
    for (seed = 900; seed < 1100; seed++) {
      d = generateFloor(i, 1, 'medium', seed); applyFloor(d, 0); plan = Dress.plan(Dress.envFromData(d));
      w = plan.windows.find(q => { if (!q.moonlit) return false; const ff = plan.faces[q.face]; for (let k = 0; k < 3; k++) { const x = ff.x + Math.round(ff.nx) * k, y = ff.y + Math.round(ff.nz) * k; if (grid[y][x] !== 0) return false; } return true; });
      if (w) { f = plan.faces[w.face]; break; }
    }
    if (!w) return { err: 'no moonlit window' };
    const load = src => new Promise(res => { const im = new Image(); im.onload = () => { const t = new THREE.CanvasTexture(im); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; res(t); }; im.onerror = () => res(null); im.src = 'textures/' + src + '_color.webp'; });
    const env = Dress.envFromData(d), B = Dress.bakeInput(plan, env), o = { bake: B, tier: 'lo' }, L = plan.L;
    const maps = LightBaker.bake(B, 'lo'); MatLib.tier = 'low'; MatLib.releaseLevel(); MatLib.setLevelMaps(Object.assign({}, maps, { GW: plan.GW, GH: plan.GH }));
    MatLib.setK(0.15);                                   // (the lamps low, so the moon shows)
    const [wt, ft] = await Promise.all([load(tex[0]), load(tex[1])]);
    const lf = c => MatLib.withLightField(new THREE.MeshLambertMaterial({ color: c }));
    const mats = { wall: MatLib.wallMaterial({ map: wt, tier: 'low' }), upper: MatLib.wallMaterial({ map: wt, variant: false, tier: 'low', color: 0xb8b0a8 }),
      service: MatLib.wallMaterial({ tier: 'low', color: 0xd8d0c0 }), ceiling: MatLib.ceilingMaterial({ tier: 'low', color: 0xd8d2c8 }), header: MatLib.wallMaterial({ map: wt, tier: 'low' }),
      trim: lf(0x6b4a34), beam: lf(0x5a4330), ibeam: lf(0x444850), frame: lf(0x6b4a34), leaf: lf(0x7a5a40) };
    const kit = Kit.get(plan.style, 'lo'), scene = new THREE.Scene(), G = new THREE.Group(), oo = Object.assign({ materials: mats, kit, windows: true }, o);   // (windows: Arch places them here, Kit.furnish in the game)
    scene.add(G); scene.background = new THREE.Color(0x020205); scene.fog = new THREE.Fog(0x020205, 1.5, 16);
    const parts = [Arch.walls(plan, oo), Arch.ceilings(plan, oo), Arch.trims(plan, oo), Arch.modules(plan, kit, oo)];
    for (const r of parts) G.add(r.group);
    const fm = MatLib.floorMaterial({ map: ft, tier: 'low', GW: plan.GW, GH: plan.GH }), fg = new THREE.PlaneGeometry(plan.GW * L, plan.GH * L);
    const floor = new THREE.Mesh(fg, fm); floor.rotation.x = -Math.PI / 2; floor.position.set(plan.GW * L / 2, 0, plan.GH * L / 2); G.add(floor);
    scene.add(new THREE.HemisphereLight(0x4a5a8a, 0x140c0c, 0.16));
    const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); R.setSize(480, 300); R.outputColorSpace = THREE.SRGBColorSpace;
    R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.2;
    const cam = new THREE.PerspectiveCamera(75, 480 / 300, 0.05, 18);
    // from across the room, to the side the beam leans away from, looking at the middle of the beam
    const tx = (f.x1 - f.x0) / L, tz = (f.z1 - f.z0) / L, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, m = plan.moon, ce = Math.cos(m.el), se = Math.sin(m.el);
    const D = [-Math.sin(m.az) * ce, -se, -Math.cos(m.az) * ce], lean = D[0] * tx + D[2] * tz, side = lean > 0 ? -1 : 1, tm = (w.v0 + w.v1) / 2 / se * 0.5;
    const tgt = [cx + D[0] * tm, (w.v0 + w.v1) / 2 + D[1] * tm, cz + D[2] * tm];
    let back = 4.4; while (back > 1.5 && grid[Math.floor((cz + f.nz * back + tz * side * 1.4) / L)][Math.floor((cx + f.nx * back + tx * side * 1.4) / L)] !== 0) back -= 0.3;
    cam.position.set(cx + f.nx * back + tx * side * 1.4, 1.6, cz + f.nz * back + tz * side * 1.4); cam.lookAt(tgt[0], tgt[1] - 0.2, tgt[2]);
    const torch = new THREE.SpotLight(0xffe0b0, 3, 14, 0.6, 0.6, 1.2); torch.position.copy(cam.position); torch.target.position.set(tgt[0], 0.6, tgt[2]); scene.add(torch, torch.target);   // (a dim flashlight, for the room around it)
    const out = {}, info = {};
    for (const tier of ['medium', 'high']) {
      const A = Atmos.build({ group: G }, plan, { tier, grid }); A.update(12);
      R.render(scene, cam); out[tier] = R.domElement.toDataURL('image/png');
      info[tier] = { draws: R.info.render.calls, programs: R.info.programs.length, stats: A.stats };
      A.dispose();
    }
    for (const r of parts) r.dispose(); fg.dispose(); R.dispose(); MatLib.releaseLevel();
    return { out, info, seed, win: w.node, curtain: w.curtain, moon: plan.moon };
  }, [i, TEX[st]]);
  if (shot.err) { check(false, `${st}: a moonlit window bay to photograph`, shot.err); continue; }
  for (const tier of ['medium', 'high']) {
    const file = path.join(OUT, `atmos_${st}_${tier}.png`);
    fs.writeFileSync(file, Buffer.from(shot.out[tier].split(',')[1], 'base64'));
    const s = shot.info[tier].stats;
    console.log(`  picture ${file}: seed ${shot.seed}, ${shot.win} (${shot.curtain}), ${s.moonlit} moonlit, sky ${s.sky}, glass ${s.glass}, motes ${s.motes}, ${shot.info[tier].draws} draws`);
    check(s.sky > 0 && s.glass > 0, `${st} ${tier}: the windows' sky and glass got the Atmos materials`, [s.sky, s.glass]);
  }
}

check(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 5));
await b.close();
process.exit(summary());
