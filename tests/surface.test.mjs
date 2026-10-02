// A floor's surface detail (js/surface.js, Surface.build): the plan-space floor and ceiling overlays, the wall decals and the dust
// prints, on real floors from the game (5 floors, 2 seeds each). Checked here by this test's own reading of the bytes: the sizes per
// tier, the same bytes for the same floor on another page, no wet on a note's tile, the clean paths where the game's own bfsPath
// goes, more dust by the walls than on the paths, decals inside their faces (<= 2 a face, clear of puzzle boxes and portraits), dust
// prints only in thick dust. Then one picture per style, the floor drawn with MatLib.floorMaterial and these overlays, lit by the
// floor's own light bake (tests/out/surface_<style>.png). js/surface.js (and dress, matlib, lightbake, arch) aren't in index.html
// yet, so they're added to the page at run time.
import { launch, solo, check, summary, pageErrors, OUT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SEEDS = process.env.SURFACE_SEEDS !== undefined ? +process.env.SURFACE_SEEDS : 2, L = 2.25;   // (SURFACE_SEEDS=0: only the pictures)
const seedOf = (i, s) => (i * 7919 + s * 15485863 + 424242) >>> 0;
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };

const b = await launch();
const p = await solo(b, 'low', 640, 360), p2 = await solo(b, 'low', 480, 300);
const NAMES = { matlib: 'MatLib', lightbake: 'LightBaker', dress: 'Dress', arch: 'Arch', surface: 'Surface' };
for (const q of [p, p2]) for (const f of Object.keys(NAMES)) if (!await q.evaluate(n => typeof window[n] !== 'undefined', NAMES[f])) await q.addScriptTag({ url: '/js/' + f + '.js' });
check(await p.evaluate(() => typeof Surface === 'object' && typeof Surface.build === 'function' && typeof Dress === 'object' && typeof MatLib === 'object'), 'js/surface.js loads into the game page (with dress, matlib, lightbake, arch)');

// in the page: bytes -> FNV-1a (hex), the same as above
const PAGE_HASH = `(a => { let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ':' + a.length; })`;

const bad = {}, put = (k, v) => { (bad[k] || (bad[k] = [])).push(v); }, ok = (k, c, v) => { if (!c) put(k, v); };
const timing = [];
for (let i = 0; i < 5; i++) for (let s = 0; s < SEEDS; s++) {
  const seed = seedOf(i, s), tag = `F${i + 1}/s${s}`;
  const R = await p.evaluate(([i, seed, PH]) => {
    const H = eval(PH), d = generateFloor(i, 1, "medium", seed), out = { tag: "" }, L = 2.25, plan0 = Dress.plan(Dress.envFromData(d)), GW0 = plan0.GW, GH0 = plan0.GH;
    // the floor line in ovAlbedo is the AO curve itself, in linear light (the texture is sRGB): at the middle of every free face with no
    // box within 0.7 m, the texel nearest 1 cm out decodes to cv(ao.floor, its distance) within 0.03 (High: 0.045, its shade is scaled up
    // bilinearly from the work grid, which rounds off the curve in the first few cm) (on >= 90% of faces: a floor decal
    // or a rug's fringe may lie on a few)
    const curves = Surface.aoCurves(Surface.assets().ao), DEC = Surface.srgb.DEC;
    const boxes0 = (() => { const S0 = []; for (const a of d.solids) S0.push([a[1] / 2 * 0.045, a[2] / 2 * 0.045, a[3] / 2 * 0.045, a[4] / 2 * 0.045]); return S0; })();
    const aoCheck = (S, tol) => { const A = S.ovAlbedo, w = A.width, h = A.height, ppx = w / (GW0 * L), ppy = h / (GH0 * L); let n = 0, good = 0, worst = 0, ex = null;
      for (const f of plan0.faces) { if (f.busy.length || f.skip || f.inset || f.used.length || Math.hypot(f.x1 - f.x0, f.z1 - f.z0) < 2) continue;
        const mx = (f.x0 + f.x1) / 2, mz = (f.z0 + f.z1) / 2;
        if (boxes0.some(([a, b2, c, e]) => mx + f.nx * 0.05 > a - 0.7 && mx + f.nx * 0.05 < c + 0.7 && mz + f.nz * 0.05 > b2 - 0.7 && mz + f.nz * 0.05 < e + 0.7)) continue;
        let i = Math.floor((mx + f.nx * 0.01) * ppx), j = Math.floor((mz + f.nz * 0.01) * ppy), dd = ((i + 0.5) / ppx - mx) * f.nx + ((j + 0.5) / ppy - mz) * f.nz;
        if (dd <= 0) { i += f.nx; j += f.nz; dd = ((i + 0.5) / ppx - mx) * f.nx + ((j + 0.5) / ppy - mz) * f.nz; }
        const o = (j * w + i) * 4, got = DEC[A.data[o + 1]], want = Surface.aoAt(curves.floor, dd), err = Math.abs(got - want);
        n++; if (err <= tol) good++; if (err > worst) { worst = err; ex = [dd, got, want]; } }
      return { n, good, worst: +worst.toFixed(3), ex }; };
    // sizes per tier (long side 512 / 1024 / 2048, the plan's aspect), tileInfo GW x GH, ceiling half size
    out.sizes = {};
    for (const tier of ['low', 'medium', 'high']) { const S = Surface.build(Surface.lvFromData(d, { tier }));
      out.sizes[tier] = { a: [S.ovAlbedo.width, S.ovAlbedo.height], s: [S.ovSurf.width, S.ovSurf.height], t: [S.tileInfo.width, S.tileInfo.height], c: [S.ovCeil.width, S.ovCeil.height],
        alpha: (() => { const a = S.ovAlbedo.data; for (let k = 3; k < a.length; k += 4) if (a[k] !== 255) return false; return true; })(), ms: S.stats.ms, T: S.stats.T,
        ao: tier !== 'low' ? aoCheck(S, tier === 'high' ? 0.045 : 0.03) : null };
      S.dispose(); }
    // build time: the best of 3 warm builds per tier (this machine is shared, other work only adds time)
    out.best = {};
    for (const tier of ['low', 'medium', 'high']) { let b = 1e9; for (let r = 0; r < 3; r++) { const S = Surface.build(Surface.lvFromData(d, { tier, plan: plan0 })); b = Math.min(b, S.stats.ms); S.dispose(); } out.best[tier] = b; }
    // and LightBaker's High on the same floor, timed the same way: on a loaded machine both slow down alike
    { const env0 = Dress.envFromData(d), B0 = Dress.bakeInput(plan0, env0); let b = 1e9; for (let r = 0; r < 3; r++) { const t = performance.now(); LightBaker.bake(B0, 'hi'); b = Math.min(b, performance.now() - t); } out.best.lbHigh = +b.toFixed(1); }
    // the medium build, checked in detail. Math.random may be called (three.js names every object it makes with one), but nothing
    // may depend on it: with Math.random stuck at 0.1, then at 0.9, the bytes must come out the same
    const real = Math.random, mapsHash = X => [H(X.ovAlbedo.data), H(X.ovSurf.data), H(X.tileInfo.data), H(X.ovCeil.data)].join('|');
    let S, lv, hr;
    try { Math.random = () => 0.9; const S9 = Surface.build(Surface.lvFromData(d, { tier: 'medium' })); hr = mapsHash(S9); S9.dispose();
      Math.random = () => 0.1; lv = Surface.lvFromData(d, { tier: 'medium' }); S = Surface.build(lv); } finally { Math.random = real; }
    out.randomSame = hr === mapsHash(S);
    const geo = S.decals.meshes.map(m => H(new Uint8Array(m.geometry.attributes.position.array.buffer)) + H(new Uint8Array(m.geometry.attributes.uv.array.buffer)) + H(new Uint8Array(m.geometry.attributes.uv1.array.buffer))).join();
    out.hash = [H(S.ovAlbedo.data), H(S.ovSurf.data), H(S.tileInfo.data), H(S.ovCeil.data), geo].join('|');
    const q0 = settings.quality; settings.quality = 'high'; const S2 = Surface.build(Surface.lvFromData(d, { tier: 'medium' })); settings.quality = q0;
    out.hashQ = [H(S2.ovAlbedo.data), H(S2.ovSurf.data), H(S2.tileInfo.data), H(S2.ovCeil.data)].join('|'); S2.dispose();
    const P = lv.plan, GW = P.GW, GH = P.GH, w = S.ovSurf.width, h = S.ovSurf.height, sf = S.ovSurf.data, ppx = w / (GW * L), ppy = h / (GH * L);
    const px = (x, z) => (Math.min(h - 1, Math.floor(z * ppy)) * w + Math.min(w - 1, Math.floor(x * ppx))) * 4;
    // no wet on note tiles: every texel whose centre is in a note's tile
    out.noteWet = 0; out.notes = d.notes.length;
    for (const [tx, ty] of d.notes) for (let j = Math.floor(ty * L * ppy); j < Math.ceil((ty + 1) * L * ppy) && j < h; j++) for (let k = Math.floor(tx * L * ppx); k < Math.ceil((tx + 1) * L * ppx) && k < w; k++) {
      const cz = (j + 0.5) / ppy, cx = (k + 0.5) / ppx; if (Math.floor(cz / L) === ty && Math.floor(cx / L) === tx) out.noteWet = Math.max(out.noteWet, sf[(j * w + k) * 4]); }
    let wetPx = 0, open = 0; for (let k = 0; k < sf.length; k += 4) { const j = (k / 4 / w) | 0, q = (k / 4) % w; if (d.rows[Math.floor((j + 0.5) / ppy / L)][Math.floor((q + 0.5) / ppx / L)] === '1') continue; open++; if (sf[k] > 40) wetPx++; } out.wetShare = wetPx / open;
    // the loose boards: no wet texel whose centre is under one
    const boardR = d.creaks.map(([x, y, along, len]) => { const hx = (along ? 6.5 : len / 2) * 0.045, hz = (along ? len / 2 : 6.5) * 0.045; return [x * 0.045 - hx, y * 0.045 - hz, x * 0.045 + hx, y * 0.045 + hz]; });
    const inB = (x, z) => boardR.some(([a, b2, c, e]) => x > a && x < c && z > b2 && z < e);
    out.boardWet = 0; out.boards = boardR.length;
    for (const [a, b2, c, e] of boardR) for (let j = Math.floor(b2 * ppy); j <= Math.ceil(e * ppy) && j < h; j++) for (let k = Math.floor(a * ppx); k <= Math.ceil(c * ppx) && k < w; k++) {
      if (j < 0 || k < 0) continue; const cz = (j + 0.5) / ppy, cx = (k + 0.5) / ppx; if (cx > a && cx < c && cz > b2 && cz < e) out.boardWet = Math.max(out.boardWet, sf[(j * w + k) * 4]); }
    // the static prints: crisp instances at y 0.003, never on a loose board or a rug
    const SP = S.staticPrints, m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(); out.statics = { child: SP.child.count, her: SP.her.count, bad: 0, n: 0, children: S.dustPrints.children.length };
    for (const m of [SP.child, SP.her]) for (let k = 0; k < m.count; k++) { m.getMatrixAt(k, m4); v3.setFromMatrixPosition(m4); out.statics.n++;
      if (Math.abs(v3.y - 0.003) > 1e-6 || inB(v3.x, v3.z) || (P.rugs || []).some(r => Math.abs(v3.x - r.x) < r.w / 2 && Math.abs(v3.z - r.z) < r.l / 2 && !r.rot)) out.statics.bad++; }
    out.sinks = { style: P.style, plan: P.wet.length, all: S.stats.wet };
    // the game's own bfsPath (after applyFloor: its NAV cuts), spawn -> exit and spawn -> each puzzle: B along it
    const st = state; applyFloor(d, 0); const sp = [Math.floor(d.spawns[0][0] / T), Math.floor(d.spawns[0][1] / T)];
    const paths = [bfsPath(sp[0], sp[1], d.exit[0], d.exit[1])].concat(d.puzzles.map(q => bfsPath(sp[0], sp[1], q.cell[0], q.cell[1]))).filter(Boolean).map(pp => [sp].concat(pp));
    state = st;
    let pn = 0, phi = 0, gPath = 0, ePath = 0; const minB = [];
    for (const pp of paths) for (let k = 0; k < pp.length; k++) { const a = pp[k], c = pp[Math.min(pp.length - 1, k + 1)];
      for (const t of [0, 0.5]) { const x = ((a[0] + (c[0] - a[0]) * t) + 0.5) * L, z = ((a[1] + (c[1] - a[1]) * t) + 0.5) * L, o = px(x, z);
        pn++; if (sf[o + 2] > 128) phi++; else if (minB.length < 5) minB.push([a, c, t, sf[o + 2]]);
        gPath += sf[o + 1]; ePath += sf[o + 1] * (1 - sf[o + 2] / 255); } }
    out.path = { n: pn, hi: phi, minB, g: gPath / pn, e: ePath / pn };
    // the routes Surface took are the game's paths (same tiles, same order)
    out.sameRoute = paths.length ? JSON.stringify(S.routes[0]) === JSON.stringify(paths[0]) : true;
    // dust by the walls: 0.08 m out from the middle of every free face (no box in front), against the path centres
    let gw = 0, ew = 0, nw = 0;
    const SOL = SOLIDS.map(s => [s.x0 * 0.045, s.y0 * 0.045, s.x1 * 0.045, s.y1 * 0.045]);
    for (const f of P.faces) { if (f.busy.length || f.skip || f.inset || f.used.length) continue; const x = (f.x0 + f.x1) / 2 + f.nx * 0.08, z = (f.z0 + f.z1) / 2 + f.nz * 0.08;
      if (SOL.some(([a, b2, c, e]) => x > a - 0.6 && x < c + 0.6 && z > b2 - 0.6 && z < e + 0.6)) continue;
      const o = px(x, z); gw += sf[o + 1]; ew += sf[o + 1] * (1 - sf[o + 2] / 255); nw++; }
    out.wall = { n: nw, g: gw / Math.max(1, nw), e: ew / Math.max(1, nw) };
    // decals: the quads, the faces, and what they must keep clear of
    out.quads = S.decals.quads.map(q => ({ face: q.face, kind: q.kind, c: q.corners, centre: q.centre, half: q.half }));
    out.faces = P.faces.map(f => ({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, nx: f.nx, nz: f.nz, h: f.h, hs: f.hs, inset: f.inset, busy: f.busy }));
    out.decor = P.decorFaces.map(q => ({ face: q.face, y: q.y, w: q.w, h: q.h }));
    out.puzzles = d.puzzles; out.wallSrc = P.decalSources.wall.length; out.meshes = S.decals.meshes.length;
    out.uv1 = S.decals.meshes.every(m => !!m.geometry.attributes.uv1); out.matFamily = S.decals.material && S.decals.material.userData.mlFamily;
    // dust prints: someone walks the path centres (clean), then along every free wall 0.25 m out (dusty)
    const stamps = [], take = () => { const a = S.dustPrints.userData.stamped.splice(0); stamps.push(...a); return a.length; };
    let retN = 0, retBad = 0;
    const walk = (pts, kind, id) => { for (let k = 0; k + 1 < pts.length; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
      for (let q = 0; q <= n; q++) { const r = S.update(0.016, [{ x: ax + (bx - ax) * q / n, z: az + (bz - az) * q / n, id, kind }]);
        for (const e of r) { retN++; if (e.kind !== kind || e.id !== id) retBad++; } } } };
    let pathLen = 0; for (const pp of paths) { const pts = pp.map(([x, y]) => [(x + 0.5) * L, (y + 0.5) * L]); for (let k = 0; k + 1 < pts.length; k++) pathLen += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); walk(pts, 'player', 'a' + pathLen); }
    const onPath = take();
    let wallLen = 0; P.faces.forEach((f, k) => { if (f.inset) return; const a = [f.x0 + f.nx * 0.25, f.z0 + f.nz * 0.25], c = [f.x1 + f.nx * 0.25, f.z1 + f.nz * 0.25]; walk([a, c], k & 1 ? 'her' : 'mate', 'w' + k); wallLen += L; });
    const byWall = take();
    const bare = S.dustPrints.children.find(c => c.name === 'SurfDustPrintsBare');
    out.prints = { onPath, pathLen, byWall, wallLen, count: S.dustPrints.count, max: S.dustPrints.instanceMatrix.count, bare: bare ? bare.count : -1, herStamps: stamps.filter(q => q[3] === 'her').length,
      ret: retN, retBad, onBoard: stamps.filter(([x, z]) => inB(x, z)).length,
      // every stamp re-read from the bytes of ovSurf: G (1 - B) > 0.4
      low: stamps.filter(([x, z]) => { const o = px(x, z); return sf[o + 1] / 255 * (1 - sf[o + 2] / 255) <= 0.4; }).length, n: stamps.length,
      y: (() => { const m = new THREE.Matrix4(), v = new THREE.Vector3(); let bad = 0; for (let k = 0; k < S.dustPrints.count; k++) { S.dustPrints.getMatrixAt(k, m); v.setFromMatrixPosition(m); if (Math.abs(v.y - 0.003) > 1e-6) bad++; } return bad; })() };
    out.stats = S.stats; out.GW = GW; out.GH = GH; out.style = P.style;
    S.dispose();
    return out;
  }, [i, seed, PAGE_HASH]);
  timing.push([tag, R.style, ...['low', 'medium', 'high'].map(t => R.sizes[t].ms)]);
  // sizes per tier
  for (const [tier, N] of [['low', 512], ['medium', 1024], ['high', 2048]]) { const z = R.sizes[tier];
    ok('size', Math.max(...z.a) === N && z.a.join() === z.s.join() && Math.abs(z.a[0] / z.a[1] - R.GW / R.GH) < 2 / N * Math.max(R.GW / R.GH, 1) + 1e-9, [tag, tier, z.a, z.s, R.GW, R.GH]);
    ok('tileInfo', z.t[0] === R.GW && z.t[1] === R.GH, [tag, tier, z.t]);
    ok('ceil', Math.abs(z.c[0] - z.a[0] / 2) <= 1 && Math.abs(z.c[1] - z.a[1] / 2) <= 1, [tag, tier, z.c]);
    ok('alpha', z.alpha, [tag, tier]); }
  ok('random', R.randomSame, tag);
  for (const tier of ['medium', 'high']) { const a = R.sizes[tier].ao; ok('aoLinear', a.n >= 4 && a.good / a.n >= 0.9, [tag, tier, a]); }
  // (3 x a 250 ms High budget, the baker's, F4's allowance; or, on a machine loaded so that the baker itself runs over, no slower than it)
  ok('budget', R.best.high <= Math.max(750, R.best.lbHigh), [tag, R.best]);
  ok('boardWet', R.boardWet === 0, [tag, R.boardWet, R.boards]);
  ok('statics', R.statics.bad === 0 && R.statics.n > 0 && R.statics.children === 3, [tag, R.statics]);
  ok('herBare', R.prints.herStamps === 0 || R.prints.bare > 0, [tag, R.prints.bare, R.prints.herStamps]);
  ok('updateRet', R.prints.ret >= R.prints.n && R.prints.ret > 0 && R.prints.retBad === 0, [tag, R.prints.ret, R.prints.n]);
  ok('printBoard', R.prints.onBoard === 0, [tag, R.prints.onBoard]);
  if (R.sinks.style === 'workshop') ok('sinks', R.sinks.all > R.sinks.plan, [tag, R.sinks]);
  ok('quality', R.hash.split('|').slice(0, 4).join('|') === R.hashQ, tag);
  // the same floor on another page (d through JSON, as the host sends it)
  const h2 = await p2.evaluate(([d, PH]) => { const H = eval(PH), S = Surface.build(Surface.lvFromData(d, { tier: 'medium' }));
    const geo = S.decals.meshes.map(m => H(new Uint8Array(m.geometry.attributes.position.array.buffer)) + H(new Uint8Array(m.geometry.attributes.uv.array.buffer)) + H(new Uint8Array(m.geometry.attributes.uv1.array.buffer))).join();
    const r = [H(S.ovAlbedo.data), H(S.ovSurf.data), H(S.tileInfo.data), H(S.ovCeil.data), geo].join('|'); S.dispose(); return r; },
    [await p.evaluate(([i, seed]) => JSON.parse(JSON.stringify(generateFloor(i, 1, 'medium', seed))), [i, seed]), PAGE_HASH]);
  ok('page2', h2 === R.hash, [tag, h2.slice(0, 80), R.hash.slice(0, 80)]);
  ok('noteWet', R.noteWet === 0, [tag, R.noteWet]);
  ok('wetSome', R.style !== 'concrete' || R.wetShare > 0.03, [tag, R.wetShare]);
  ok('pathB', R.path.n > 0 && R.path.hi / R.path.n >= 0.97, [tag, R.path.hi, R.path.n, R.path.minB]);
  ok('route', R.sameRoute, tag);
  ok('dustWall', R.wall.n > 10 && R.wall.g > R.path.g + 20 && R.wall.e > R.path.e + 20, [tag, R.wall, R.path.g, R.path.e]);
  // decals: inside their face, 3 mm proud of it (or its inset), <= 2 a face, 0.5 m clear of puzzle boxes, portraits and words
  const per = {};
  for (const q of R.quads) { const f = R.faces[q.face], len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), tx = (f.x1 - f.x0) / len, tz = (f.z1 - f.z0) / len;
    per[q.face] = (per[q.face] || 0) + 1;
    ok('decalFree', !f.busy.length, [tag, q.face, f.busy]);
    for (const [x, y, z] of q.c) { const u = ((x - f.x0) * tx + (z - f.z0) * tz) / len, dn = (x - f.x0) * f.nx + (z - f.z0) * f.nz;
      let top = f.h; if (f.hs) { const U = [0, 0.14, 0.5, 0.86, 1]; let j = 0; while (j < 3 && u > U[j + 1]) j++; top = f.hs[j] + (f.hs[j + 1] - f.hs[j]) * (u - U[j]) / (U[j + 1] - U[j]); }
      ok('decalIn', u >= -1e-6 && u <= 1 + 1e-6 && y >= -1e-6 && y <= top + 1e-6, [tag, q.face, q.kind, u, y, top]);
      ok('decalProud', dn > 0.0029 && dn < 0.45, [tag, q.face, dn]); } }
  ok('decal2', Object.values(per).every(c => c <= 2), [tag, per]);
  const keep = [];
  for (const pz of R.puzzles) { const k = R.faces.findIndex(f => f.nx === -pz.dir[0] && f.nz === -pz.dir[1] && Math.abs((f.x0 + f.x1) / 2 - (pz.cell[0] + 0.5 + pz.dir[0] * 0.5) * L) < 1e-6 && Math.abs((f.z0 + f.z1) / 2 - (pz.cell[1] + 0.5 + pz.dir[1] * 0.5) * L) < 1e-6);
    if (k >= 0) { const f = R.faces[k]; keep.push([(f.x0 + f.x1) / 2, 1.25, (f.z0 + f.z1) / 2, 0.32, 'puzzle']); } else put('puzzleFace', [tag, pz]); }
  for (const q of R.decor) { const f = R.faces[q.face]; keep.push([(f.x0 + f.x1) / 2, q.y, (f.z0 + f.z1) / 2, Math.max(q.w, q.h) / 2, 'decor']); }
  for (const q of R.quads) for (const k of keep) { const dd = Math.hypot(q.centre[0] - k[0], q.centre[1] - k[1], q.centre[2] - k[2]);
    ok('decalClear', dd >= 0.5 + k[3] + q.half * 0.7 - 1e-6, [tag, q.kind, k[4], dd, k[3], q.half]); }
  ok('decalMesh', R.quads.length > 0 && R.meshes > 0 && R.uv1 && R.matFamily === 'decal', [tag, R.quads.length, R.meshes, R.uv1, R.matFamily]);
  // dust prints: only in dust (every stamp re-read from ovSurf), more of them along dusty walls than on the clean paths
  ok('printsDust', R.prints.low === 0 && R.prints.y === 0, [tag, R.prints]);
  ok('printsWhere', R.prints.byWall / R.prints.wallLen >= R.prints.onPath / Math.max(1, R.prints.pathLen), [tag, R.prints]);
  ok('printsRing', R.prints.count <= 200 && R.prints.max === 200, [tag, R.prints.count]);
  if (R.style === 'attic') ok('printsAttic', R.prints.byWall > 0, [tag, R.prints]);
  console.log(`  ${tag} ${R.style}: ${R.GW}x${R.GH} tiles; wall dust G ${R.wall.g.toFixed(0)} vs path ${R.path.g.toFixed(0)} (effective ${R.wall.e.toFixed(0)} vs ${R.path.e.toFixed(0)}); path texels clean ${R.path.hi}/${R.path.n}; ` +
    `wet ${(R.wetShare * 100).toFixed(1)}%; decals ${R.quads.length}/${R.wallSrc} in ${R.meshes} chunks; prints ${R.prints.byWall} by walls (${R.prints.wallLen.toFixed(0)} m), ${R.prints.onPath} on paths (${R.prints.pathLen.toFixed(0)} m); ` +
    `ms lo/md/hi ${['low', 'medium', 'high'].map(t => R.sizes[t].ms).join('/')} (best of 3: ${['low', 'medium', 'high'].map(t => R.best[t]).join('/')}, LightBaker hi ${R.best.lbHigh}); ` +
    `floor line worst ${R.sizes.medium.ao.worst}/${R.sizes.high.ao.worst} over ${R.sizes.medium.ao.n} faces; static prints ${R.statics.child} + ${R.statics.her} bare; wet patches ${R.sinks.all} (plan ${R.sinks.plan})`);
}
const none = k => !bad[k], show = k => bad[k] && bad[k].slice(0, 3);
check(none('size'), 'ovAlbedo and ovSurf: 512 / 1024 / 2048 px on the long side (low / medium / high), the plan\'s aspect', show('size'));
check(none('tileInfo') && none('ceil'), 'tileInfo is GW x GH; ovCeil is half the floor size', show('tileInfo') || show('ceil'));
check(none('alpha'), 'ovAlbedo is opaque (alpha 255 everywhere)', show('alpha'));
check(none('random') && none('quality'), 'pure: nothing depends on Math.random, the quality setting changes nothing at a given tier', show('random') || show('quality'));
check(none('page2'), 'the same d gives identical bytes on another page (all four maps and the decal meshes)', show('page2'));
check(none('noteWet'), 'no wet texel on any note tile', show('noteWet'));
check(none('wetSome'), 'the basement is wet (>= 3% of its open floor)', show('wetSome'));
check(none('pathB') && none('route'), 'clean paths follow the game\'s bfsPath (spawn -> exit, spawn -> puzzles): B > 0.5 at >= 97% of tile centres and steps', show('pathB') || show('route'));
check(none('dustWall'), 'dust is higher by the walls than at the path centres (G and G(1 - B))', show('dustWall'));
check(none('decalFree') && none('decalIn') && none('decalProud'), 'wall decals: on free faces, every corner inside its face and under the ceiling line, 3 mm proud', show('decalFree') || show('decalIn') || show('decalProud'));
check(none('decal2'), 'at most 2 decals a face', show('decal2'));
check(none('decalClear') && none('puzzleFace'), 'decals 0.5 m clear of puzzle boxes, portraits and words', show('decalClear') || show('puzzleFace'));
check(none('decalMesh'), 'decal meshes per chunk with uv1, in MatLib\'s decal material', show('decalMesh'));
check(none('printsDust') && none('printsWhere') && none('printsRing') && none('printsAttic'), 'dust prints only where G(1 - B) > 0.4, at y 0.003, more by dusty walls than on clean paths, a ring of 200', show('printsDust') || show('printsWhere') || show('printsRing') || show('printsAttic'));
check(none('aoLinear'), 'the floor line in ovAlbedo decodes (sRGB -> linear) to the AO curve at 1 cm from the wall, within 0.03 (medium; High 0.045, scaled up from the 1024 px work grid)', show('aoLinear'));
check(none('budget'), 'build time: High <= 750 ms (best of 3 warm builds; 3 x a 250 ms budget), or no slower than LightBaker High on the same floor when the machine is loaded', show('budget'));
check(none('boardWet') && none('printBoard'), 'no wet under a loose board, no dust print on one', show('boardWet') || show('printBoard'));
check(none('statics'), 'static child and bare prints are crisp instances at y 0.003 (children of dustPrints), never on boards or rugs', show('statics'));
check(none('herBare') && none('updateRet'), 'her dust prints are bare feet (their own ring); update() returns each print it made [{id, kind, x, z}]', show('herBare') || show('updateRet'));
check(none('sinks'), 'workshop floors get their sink wet patches (beside the benches or the paint shelves)', show('sinks'));
const others = Object.keys(bad).filter(k => !['aoLinear', 'budget', 'boardWet', 'printBoard', 'statics', 'herBare', 'updateRet', 'sinks', 'size', 'tileInfo', 'ceil', 'alpha', 'random', 'quality', 'page2', 'noteWet', 'wetSome', 'pathB', 'route', 'dustWall', 'decalFree', 'decalIn', 'decalProud', 'decal2', 'decalClear', 'puzzleFace', 'decalMesh', 'printsDust', 'printsWhere', 'printsRing', 'printsAttic'].includes(k));
check(!others.length, 'no other failures', others);
console.log('  build ms (low / medium / high): ' + timing.map(t => t[0] + ' ' + t.slice(2).join('/')).join(', '));

// Blender's decal atlas (B11), once it exists: faked here with a canvas (a dark disc in each of two cells) to check the file path:
// wall decals take their rects from decals.json, the floor decals are stamped (multiplied) from it, and the result is still pure
const fileAtlas = await p.evaluate(() => {
  const A = Surface.assets(), c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(40,30,20,0.9)'; g.beginPath(); g.arc(64, 64, 50, 0, 7); g.arc(192, 64, 50, 0, 7); g.fill();
  const kinds = Surface.KINDS.slice();
  // (the wall rect is 2:1, unlike any of the built-in aspects: the quads must take the rect's own)
  A.decals = { albedo: c, normal: null, entries: [{ id: 'w', rect: [0, 32, 128, 64], kinds }, { id: 'f', rect: [128, 0, 128, 128], kinds: ['floor_puddle', 'floor_ring', 'floor_rust', 'floor_scorch', 'floor_drain'] }] };
  const asp = q => { const [a, b2, , e] = q.corners, len = (p, r) => Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]); return len(a, b2) / len(a, e); };
  const d = generateFloor(2, 1, 'medium', 99), run = () => { const S = Surface.build(Surface.lvFromData(d, { tier: 'low' })); const r = { src: S.decals.atlas && S.decals.atlas.source, q: S.decals.quads.length,
    sum: S.ovAlbedo.data.reduce((s, v) => s + v, 0), asp: S.decals.quads.map(asp).filter(a => Math.abs(a - 2) > 0.01).length }; S.dispose(); return r; };
  const a = run(), b2 = run(); A.decals = null; const c0 = run();
  return { a, b2, c0 };
});
check(fileAtlas.a.asp === 0, 'with a Blender decal atlas: each quad takes its atlas rect\'s aspect (2:1 here), nothing stretched', fileAtlas.a);
check(fileAtlas.a.src === 'file' && fileAtlas.a.q > 0 && fileAtlas.a.sum === fileAtlas.b2.sum && fileAtlas.a.sum < fileAtlas.c0.sum && fileAtlas.c0.src === 'procedural',
  'with a Blender decal atlas loaded: wall decals use its rects, floor decals are stamped from it (darker albedo), still the same bytes twice', fileAtlas);

// ownership and the live game: S.dispose() leaves MatLib's wall lightmap alone (it sits in the decal material's disposables too);
// the decal atlas is exposed with a texture factory (for lv.materials.decal); lvFromGame in a team game starts the paths at tile (2, 2)
const own = await p.evaluate(() => {
  const d = generateFloor(1, 1, 'medium', 4242), env = Dress.envFromData(d), plan = Dress.plan(env), maps = LightBaker.bake(Dress.bakeInput(plan, env), 'lo');
  MatLib.releaseLevel(); const wm = MatLib.wallMaterial({ tier: 'medium' });
  const S = Surface.build(Surface.lvFromData(d, { tier: 'medium', plan })); MatLib.setLevelMaps(Object.assign({}, maps, S.maps, { GW: plan.GW, GH: plan.GH }));
  const lm = wm.lightMap; let freed = false; lm.addEventListener('dispose', () => { freed = true; });
  const inBag = S.decals.material.userData.disposables.includes(lm);
  const t = S.decals.atlas.texture(), tex = !!t && t.isTexture && (t.image.width || t.image.w) === S.decals.atlas.W; if (t) t.dispose();
  S.dispose(); const r = { inBag, freed, tex }; MatLib.releaseLevel(); wm.dispose();
  // a 4-player floor, applied, with MP on as in a team game
  const d4 = generateFloor(2, 4, 'medium', 77), st = state; applyFloor(d4, 0); const mp = [MP.on, MP.n]; MP.on = true; MP.n = 4;
  try { const pl = Dress.plan(Dress.envFromData(d4)), a = Surface.build(Surface.lvFromData(d4, { tier: 'low', plan: pl })), b2 = Surface.build(Surface.lvFromGame({ tier: 'low', plan: pl }));
    r.mp = { data: a.routes[0] && a.routes[0][0], game: b2.routes[0] && b2.routes[0][0], same: a.routes.length === b2.routes.length && JSON.stringify(a.routes) === JSON.stringify(b2.routes) }; a.dispose(); b2.dispose();
  } finally { MP.on = mp[0]; MP.n = mp[1]; state = st; }
  return r;
});
check(own.inBag && !own.freed, 'S.dispose() frees only its own textures (not MatLib\'s wall lightmap that MatLib keeps in the decal material)', own);
check(own.tex, 'decals.atlas.texture() gives the atlas the quads\' uv0 point into (for lv.materials.decal)', own);
check(own.mp && own.mp.data && own.mp.data.join() === '2,2' && own.mp.same, 'lvFromGame in a team game: the clean paths start at the team\'s spawn tile (2, 2), the same as lvFromData', own.mp);

/* ---------- pictures: the floor with these overlays through MatLib.floorMaterial, the walls and their decals, lit by the bake ---------- */
const TEX = { wood: ['wall_paper1', 'floor_wood1', 'floor_wood'], tile: ['wall_tile2', 'floor_tile2', 'floor_tile'], concrete: ['wall_brick3', 'floor_concrete3', 'floor_concrete'],
  attic: ['wall_attic4', 'floor_wood4', 'floor_wood'], workshop: ['wall_shop5', 'floor_tile5', 'floor_tile'] };
const styles = await p.evaluate(() => FLOORS.map(f => f.style));
for (let i = 0; i < 5; i++) {
  const shot = await p.evaluate(async ([i, seed, tex]) => {
    const load = (src, srgb) => new Promise(res => { const im = new Image(); im.onload = () => { const t = new THREE.CanvasTexture(im); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; res(t); }; im.onerror = () => res(null); im.src = 'textures/' + src + '.webp'; });
    const d = generateFloor(i, 1, 'medium', seed); applyFloor(d, 0);
    const env = Dress.envFromData(d), plan = Dress.plan(env), B = Dress.bakeInput(plan, env), L = plan.L, GW = plan.GW, GH = plan.GH;
    const maps = LightBaker.bake(B, 'lo'); MatLib.tier = 'medium'; MatLib.releaseLevel();
    const lv = Surface.lvFromData(d, { tier: 'medium', plan }); lv.cells = maps.wallCells;
    const [wt, ft, fn] = await Promise.all([load(tex[0] + '_color', true), load(tex[1] + '_color', true), load(tex[2] + '_normal', false)]);
    const mats = { wall: MatLib.wallMaterial({ map: wt, variant: false, tier: 'medium' }), upper: MatLib.wallMaterial({ map: wt, variant: false, tier: 'medium', color: 0xb8b0a8 }),
      service: MatLib.wallMaterial({ tier: 'medium', color: 0xd8d0c0 }), ceiling: MatLib.ceilingMaterial({ tier: 'medium', color: 0xd8d2c8 }), header: MatLib.wallMaterial({ map: wt, variant: false, tier: 'medium' }) };
    const S = Surface.build(lv);
    MatLib.setLevelMaps(Object.assign({}, maps, S.maps, { GW, GH }));
    const scene = new THREE.Scene(), oo = { bake: B, tier: 'lo', materials: mats }, walls = Arch.walls(plan, oo), ceil = Arch.ceilings(plan, oo);
    scene.add(walls.group, S.decals.group);
    const fm = MatLib.floorMaterial({ map: ft, normalMap: fn, tier: 'medium', GW, GH }), fg = new THREE.PlaneGeometry(GW * L, GH * L);
    const floor = new THREE.Mesh(fg, fm); floor.rotation.x = -Math.PI / 2; floor.position.set(GW * L / 2, 0, GH * L / 2); scene.add(floor);
    // the dust prints: someone walked along a wall
    const f0 = plan.faces.find(f => !f.inset && !f.busy.length) || plan.faces[0];
    for (let q = 0; q <= 60; q++) S.update(0.016, [{ x: f0.x0 + (f0.x1 - f0.x0) * q / 60 * 3 + f0.nx * 0.3, z: f0.z0 + (f0.z1 - f0.z0) * q / 60 * 3 + f0.nz * 0.3, id: 1, kind: 'player' }]);
    scene.add(S.dustPrints);
    const flash = new THREE.SpotLight(0xfff1dc, 25, 14, 0.5, 0.45, 1.6); scene.add(flash, flash.target);
    const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); R.setSize(640, 400); R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping;
    const out = [];
    // 1: from above, the stretch of the spawn -> exit path with the most going on (decals, wet, prints), tilted 30 degrees
    const route = S.routes[0] || [[2, 2]], pick = route[Math.min(route.length - 1, 6)], cx = (pick[0] + 0.5) * L, cz = (pick[1] + 0.5) * L;
    const top = new THREE.PerspectiveCamera(13, 640 / 400, 30, 50); top.position.set(cx, 40, cz + 0.01); top.lookAt(cx, 0, cz);   // (nearly straight down: no orthographic camera in this build)
    // (an even light for this one, E about 1.5 everywhere, so the overlays themselves show: dust, wet, paths, prints, shade, decals)
    const even = v => ({ data: new Uint8ClampedArray(64).fill(v).map((c, k) => k % 4 === 3 ? 0 : c), w: 4, h: 4 });
    MatLib.setLevelMaps({ floorLM: even(163), wallLM: even(163) });
    flash.intensity = 0; R.render(scene, top); out.push(R.domElement.toDataURL('image/png'));
    MatLib.setLevelMaps({ floorLM: maps.floorLM, wallLM: maps.wallLM });
    // 2: eye level, looking at a wall with decals, the flashlight on
    scene.add(ceil.group);
    const q = S.decals.quads.find(q => q.kind !== 'soot') || S.decals.quads[0], f = q ? plan.faces[q.face] : f0;
    const ex = (f.x0 + f.x1) / 2 + f.nx * 2.6 + (f.z1 - f.z0) / L * 0.5, ez = (f.z0 + f.z1) / 2 + f.nz * 2.6 - (f.x1 - f.x0) / L * 0.5;
    const eye = new THREE.PerspectiveCamera(70, 640 / 400, 0.05, 30); eye.position.set(ex, 1.6, ez); eye.lookAt((f.x0 + f.x1) / 2, 0.9, (f.z0 + f.z1) / 2);
    flash.intensity = 25; flash.position.copy(eye.position); flash.target.position.set((f.x0 + f.x1) / 2, 0.6, (f.z0 + f.z1) / 2);
    R.render(scene, eye); out.push(R.domElement.toDataURL('image/png'));
    const info = { draws: R.info.render.calls, programs: R.info.programs.length, decals: S.decals.quads.length, style: plan.style, errors: R.info.programs.filter(pr => pr.diagnostics && !pr.diagnostics.runnable).length };
    walls.dispose(); ceil.dispose(); fg.dispose(); S.dispose(); R.dispose(); MatLib.releaseLevel();
    return { out, info };
  }, [i, seedOf(i, 0), TEX[styles[i]]]);
  const both = await p.evaluate(async urls => { const ims = await Promise.all(urls.map(u => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = u; })));
    const c = document.createElement('canvas'); c.width = 640 * ims.length; c.height = 400; const g = c.getContext('2d'); ims.forEach((im, k) => g.drawImage(im, 640 * k, 0)); return c.toDataURL('image/png'); }, shot.out);
  const file = path.join(OUT, 'surface_' + styles[i] + '.png');
  fs.writeFileSync(file, Buffer.from(both.split(',')[1], 'base64'));
  console.log(`  picture ${file}: ${shot.info.draws} draws, ${shot.info.programs} programs, ${shot.info.decals} decals`);
  check(shot.out.length === 2 && shot.info.errors === 0, `${styles[i]}: the floor with its overlays and the walls with their decals rendered`);
}
check(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 3));
await b.close();
process.exit(summary());
