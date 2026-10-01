// The house's architecture in 3D (js/arch.js, spec A9, A10, B5, B9, C4, C5, E5, H11, H22): walls, ceilings and their height steps,
// mouldings, beams, doorways and modules built from real floors (5 floors, 1 and 4 players, plus an attic floor with a gable hall),
// each checked here against the game's own ceilings (ceilAtXZ), LightBaker's wall atlas and the plan. js/arch.js, js/dress.js,
// js/lightbake.js, js/matlib.js and js/kit.js aren't in index.html yet, so they're added to the page at run time. Ends with one
// picture per style of a hall and a corridor (tests/out/arch_<style>.png), lit by the floor's own light bake through MatLib.
import { launch, solo, check, summary, pageErrors, OUT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const b = await launch();
const p = await solo(b, 'low', 480, 300);
for (const [g, f] of [['Dress', 'dress'], ['LightBaker', 'lightbake'], ['MatLib', 'matlib'], ['Kit', 'kit'], ['Arch', 'arch']])
  if (!await p.evaluate(g => typeof window[g] !== 'undefined', g)) await p.addScriptTag({ url: '/js/' + f + '.js' });
check(await p.evaluate(() => ['walls', 'ceilings', 'trims', 'beams', 'doorways', 'modules', 'updateDoors'].every(k => typeof Arch[k] === 'function')),
  'js/arch.js loads into the game page and exposes walls, ceilings, trims, beams, doorways, modules, updateDoors');

/* ---------- the checks, run in the page on one floor ---------- */
await p.evaluate(() => {
  window.__archCheck = function (i, n, seed, kitOn) {
    const t0 = performance.now(), d = generateFloor(i, n, 'medium', seed);
    applyFloor(d, 0);                                      // (the game's own CEIL, ROOMS and ceilAtXZ for this floor)
    const env = Dress.envFromData(d), plan = Dress.plan(env), B = Dress.bakeInput(plan, env), o = { bake: B, tier: 'lo' };
    const L = plan.L, GW = plan.GW, GH = plan.GH, PW = GW * L, PH = GH * L, CL = 6 * L, NCX = Math.ceil(GW / 6), F = plan.faces;
    const bad = {}, cnt = {}, put = (k, v) => { cnt[k] = (cnt[k] || 0) + 1; (bad[k] || (bad[k] = [])).length < 4 && bad[k].push(v); }, info = {};
    const ok = (k, c, v) => { if (!c) put(k, v); };
    const isW = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || grid[y][x] === 1;
    const kit = kitOn && typeof Kit !== 'undefined' ? Kit.get(plan.style, 'lo') : null;
    const W = Arch.walls(plan, o), C = Arch.ceilings(plan, o), T = Arch.trims(plan, o), Bm = Arch.beams(plan, o);
    const r6 = v => Math.round(v * 1e4) / 1e4, key = (x, y, z) => r6(x) + ',' + r6(y) + ',' + r6(z);
    const roof = (x, z) => ceilAtXZ(x, z);
    info.ms = { walls: W.stats.ms, ceilings: C.stats.ms, trims: T.stats.ms, beams: Bm.stats.ms };

    /* uv1: the atlas cells are LightBaker's, exactly */
    const pa = LightBaker.packAtlas(B.faces, 'lo', LightBaker.faceHeights(B)), bk = LightBaker.bake(B, 'lo');
    let cellOk = W.cells.length === F.length && W.faces.length === F.length;
    W.cells.forEach((c, k) => { for (const f of ['u0', 'v0', 'su', 'sv']) if (c[f] !== pa.cells[k][f] || c[f] !== bk.wallCells[k][f]) cellOk = false; });
    ok('uv1 cells = LightBaker.packAtlas = bake().wallCells', cellOk);
    W.faces.forEach((f, k) => ok('walls.faces in the bake\'s order', f.x0 === B.faces[k].x0 && f.z0 === B.faces[k].z0 && f.nx === B.faces[k].nx && f.x === B.faces[k].x, k));

    /* walls: every vertex on its face's (inset) plane, uv0 by the variant trick, uv1 in its cell at its spot, tops = ceilAtXZ */
    let gableCols = 0, cols = 0;
    W.group.traverse(m => { if (m.isMesh) { ok('walls have no vertex colours', !m.geometry.attributes.color, m.name); ok('walls have uv1', !!m.geometry.attributes.uv1, m.name); } });
    const ceilV = new Set(), cutT = new Set(C.cut);
    for (const r of W.faceVerts) {
      const f = F[r.face], c = W.cells[r.face], inset = f.inset || 0, tx = (f.x1 - f.x0) / L, tz = (f.z1 - f.z0) / L, colMax = new Map();
      if (f.skip) ok('a skipped face keeps only its upper band', r.parts.every(q => q.group === 'upper'), r.face);
      for (const q of r.parts) {
        const g = W.meshes[q.mesh].geometry, P = g.attributes.position, U0 = g.attributes.uv, U1 = g.attributes.uv1;
        ok('face part in its group', W.meshes[q.mesh].userData.arch === 'walls_' + q.group, [r.face, q.group]);
        for (let v = q.first; v < q.first + q.count; v++) {
          const x = P.getX(v), y = P.getY(v), z = P.getZ(v), u = ((x - f.x0 - f.nx * inset) * tx + (z - f.z0 - f.nz * inset) * tz) / L;
          ok('wall vertex on its face plane (servant runs 0.30 m proud)', Math.abs((x - f.x0) * f.nx + (z - f.z0) * f.nz - inset) < 1e-5, [r.face, x, z]);
          ok('wall vertex within its face', u > -1e-5 && u < 1 + 1e-5, [r.face, u]);
          const eu = q.group === 'main' ? 0.5 * u + 0.5 * (f.variant ? 1 : 0) : u;
          ok('wall uv0: u = 0.5 u + 0.5 variant (main), v = y / 3', Math.abs(U0.getX(v) - eu) < 1e-5 && Math.abs(U0.getY(v) - y / 3) < 1e-5, [r.face, q.group, U0.getX(v), eu]);
          ok('wall uv1 = its cell at (u, y)', Math.abs(U1.getX(v) - (c.u0 + u * c.su)) < 1e-6 && Math.abs(U1.getY(v) - (c.v0 + y * c.sv)) < 1e-6, [r.face, u, y]);
          ok('wall uv1 inside its cell', U1.getX(v) >= c.u0 - 1e-6 && U1.getX(v) <= c.u0 + c.su + 1e-6 && U1.getY(v) >= c.v0 - 1e-6 && U1.getY(v) <= c.v0 + c.H * c.sv + 1e-6, [r.face, y, c.H]);
          const ck = r6(x) + ',' + r6(z); colMax.set(ck, Math.max(colMax.get(ck) || 0, y));
        }
      }
      for (const [ck, y] of colMax) {
        const [x, z] = ck.split(',').map(Number), mx = (f.x0 + f.x1) / 2 - x, mz = (f.z0 + f.z1) / 2 - z, ml = Math.hypot(mx, mz) || 1;
        const h = roof(x + f.nx * 1e-5 + mx / ml * 1e-5, z + f.nz * 1e-5 + mz / ml * 1e-5); cols++; if (f.hs) gableCols++;   // (nudged into the face's own tile)
        ok('wall top = ceilAtXZ (gable faces at u = 0 .14 .5 .86 1)', Math.abs(y - h) < 1e-4, [r.face, x, z, y, h]);
        if (!inset && !cutT.has(f.y * GW + f.x)) ceilV.add(key(x, y, z));
      }
      if (f.hs && !f.skip && Math.max(...f.hs) - Math.min(...f.hs) > 1e-6) ok('gable face has its 5 roof points', colMax.size >= 5, [r.face, colMax.size]);
    }
    info.gableFaces = F.filter(f => f.hs).length; info.wallCols = cols; info.gableCols = gableCols;
    // reveals: from the inset line back to the wall plane, at the run's height
    info.reveals = W.reveals.length; info.insetFaces = F.filter(f => f.inset).length;
    for (const rv of W.reveals) ok('reveal spans the 0.30 m inset', Math.abs(Math.hypot(rv.p1[0] - rv.p0[0], rv.p1[1] - rv.p0[1]) - 0.3) < 1e-6, rv);

    /* ceilings: each open tile covered exactly once (8 x 8 points per tile), at ceilAtXZ, uv0 = xz / 2.25, uv1 = plan uv */
    const cut = new Set(C.cut), cover = new Uint8Array(GW * GH * 64), area = new Float64Array(GW * GH), vert = new Map();
    const stepArea = new Map();
    for (const m of C.meshes) {
      ok('ceiling receives shadows', m.receiveShadow, m.name);
      const g = m.geometry, P = g.attributes.position, U0 = g.attributes.uv, U1 = g.attributes.uv1, I = g.index;
      for (let v = 0; v < P.count; v++) {
        // (vertical step vertices carry the plan uv 1 cm into the higher tile: checked with the steps)
      }
      for (let k = 0; k < I.count; k += 3) {
        const a = I.getX(k), bb = I.getX(k + 1), cc = I.getX(k + 2), A = [P.getX(a), P.getY(a), P.getZ(a)], Bv = [P.getX(bb), P.getY(bb), P.getZ(bb)], Cv = [P.getX(cc), P.getY(cc), P.getZ(cc)];
        const e1 = [Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]], e2 = [Cv[0] - A[0], Cv[1] - A[1], Cv[2] - A[2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], ln = Math.hypot(nx, ny, nz);
        if (ln < 1e-12) continue;
        const cx = (A[0] + Bv[0] + Cv[0]) / 3, cy = (A[1] + Bv[1] + Cv[1]) / 3, cz = (A[2] + Bv[2] + Cv[2]) / 3;
        if (Math.abs(ny / ln) > 0.3) {                     // a ceiling triangle
          ok('ceiling triangles face down', ny < 0, [cx, cz]);
          const tx = Math.floor(cx / L), ty = Math.floor(cz / L), t = ty * GW + tx; area[t] += Math.abs(ny) / 2;
          ok('ceiling triangle over an open tile', !isW(tx, ty) && !cut.has(t), [tx, ty]);
          for (const vi of [a, bb, cc]) {
            const x = P.getX(vi), y = P.getY(vi), z = P.getZ(vi), dl = Math.hypot(cx - x, cz - z) || 1, h = roof(x + (cx - x) / dl * 1e-5, z + (cz - z) / dl * 1e-5);
            ok('ceiling vertex at ceilAtXZ', Math.abs(y - h) < 1e-4, [x, z, y, h]);
            ok('ceiling uv1 = plan uv', Math.abs(U1.getX(vi) - x / PW) < 1e-6 && Math.abs(U1.getY(vi) - (1 - z / PH)) < 1e-6, [x, z]);
            ok('ceiling uv0 = world xz / 2.25', Math.abs(U0.getX(vi) - x / L) < 1e-5 && Math.abs(U0.getY(vi) - z / L) < 1e-5, [x, z]);
            ceilV.has(key(x, y, z)); vert.set(key(x, y, z), 1);
          }
          // which of the tile's 8 x 8 sample points this triangle covers (points off every edge: jittered)
          const xs = [A[0], Bv[0], Cv[0]], zs = [A[2], Bv[2], Cv[2]], s = (px, pz, j) => (xs[(j + 1) % 3] - xs[j]) * (pz - zs[j]) - (zs[(j + 1) % 3] - zs[j]) * (px - xs[j]);
          for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
            const px = tx * L + (sx + 0.5 + 0.0137) * L / 8, pz = ty * L + (sy + 0.5 + 0.0071) * L / 8, s0 = s(px, pz, 0), s1 = s(px, pz, 1), s2 = s(px, pz, 2);
            if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) cover[t * 64 + sy * 8 + sx]++;
          }
        } else {                                           // a step between two ceiling heights
          ok('step quads are vertical', Math.abs(ny / ln) < 1e-6, [cx, cz]);
          const onX = Math.abs(cx / L - Math.round(cx / L)) < 1e-6, ek = onX ? 'x' + Math.round(cx / L) + ':' + Math.floor(cz / L) : 'z' + Math.round(cz / L) + ':' + Math.floor(cx / L);
          stepArea.set(ek, (stepArea.get(ek) || 0) + ln / 2);
          // facing the higher side
          const dn = onX ? [Math.sign(nx), 0] : [0, Math.sign(nz)], hp = roof(cx + dn[0] * 1e-3, cz + dn[1] * 1e-3), hm = roof(cx - dn[0] * 1e-3, cz - dn[1] * 1e-3);
          ok('step quad faces the higher ceiling', hp > hm - 1e-6, [cx, cy, cz, hp, hm]);
          ok('step quad between the two ceilings', cy > Math.min(hp, hm) - 1e-4 && cy < Math.max(hp, hm) + 1e-4, [cx, cy, cz]);
          for (const vi of [a, bb, cc]) {
            const x = P.getX(vi), y = P.getY(vi), z = P.getZ(vi), ex = onX ? 0 : Math.sign(cx - x) * 1e-5, ez = onX ? Math.sign(cz - z) * 1e-5 : 0;   // (nudged along the edge too)
            const ha = roof(x + dn[0] * 1e-5 + ex, z + dn[1] * 1e-5 + ez), hb = roof(x - dn[0] * 1e-5 + ex, z - dn[1] * 1e-5 + ez);
            ok('step vertices sit on one of the two ceiling edges (no gap)', Math.abs(y - ha) < 1e-4 || Math.abs(y - hb) < 1e-4, [x, y, z, ha, hb]);
          }
        }
      }
    }
    let tiles = 0;
    for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
      const t = ty * GW + tx, want = !isW(tx, ty) && !cut.has(t) ? 1 : 0; if (want) tiles++;
      for (let k = 0; k < 64; k++) if (cover[t * 64 + k] !== want) { put('every open ceiling tile covered exactly once', [tx, ty, k, cover[t * 64 + k], want]); break; }
    }
    info.ceilTiles = tiles; info.ceilCut = C.cut.length;
    // step areas: the integral of |h_a - h_b| along every edge between open tiles (64 samples)
    let stepEdges = 0;
    for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
      if (isW(tx, ty)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (isW(tx + dx, ty + dy)) continue;
        let want = 0;
        for (let k = 0; k < 64; k++) { const s = (k + 0.5) / 64; const x = dx ? (tx + 1) * L : (tx + s) * L, z = dx ? (ty + s) * L : (ty + 1) * L;
          want += Math.abs(roof(x - dx * 1e-3, z - dy * 1e-3) - roof(x + dx * 1e-3, z + dy * 1e-3)) * L / 64; }
        const ek = dx ? 'x' + (tx + 1) + ':' + ty : 'z' + (ty + 1) + ':' + tx, got = stepArea.get(ek) || 0;
        if (want > 1e-6 || got > 1e-6) stepEdges++;
        ok('step quad closes each height step exactly (area)', Math.abs(got - want) < 2e-3, [ek, got, want]);
      }
    }
    info.stepEdges = stepEdges;
    // wall tops share their vertices with the ceilings (no cracks along the top of a wall)
    let shared = 0, tops = 0;
    for (const k of ceilV) { tops++; if (vert.has(k)) shared++; else put('wall top vertex is a ceiling vertex (no T-junction gap)', k); }
    info.wallTopsShared = shared + '/' + tops;

    /* trims: mitres meet exactly, at 45 degrees on square corners; rails at their heights; cornice under the ceiling */
    const PR = Arch.profiles(plan.style), jc = {};
    for (const j of T.joints) {
      jc[j.cls] = (jc[j.cls] || 0) + 1;
      let dmax = 0; for (let k = 0; k < j.a.length; k++) dmax = Math.max(dmax, Math.hypot(j.a[k][0] - j.b[k][0], j.a[k][1] - j.b[k][1], j.a[k][2] - j.b[k][2]));
      ok('the two rings of a joint coincide', j.a.length === j.b.length && dmax < 1e-4, [j.kind, j.cls, dmax]);
      let nrm = j.cls === 'flat' ? j.ta : [j.ta[0] - j.tb[0], j.ta[1] - j.tb[1]]; const ln = Math.hypot(nrm[0], nrm[1]); nrm = [nrm[0] / ln, nrm[1] / ln];
      const ds = j.a.map(q => q[0] * nrm[0] + q[2] * nrm[1]);
      ok('joint ring is planar (mitre / butt plane)', Math.max(...ds) - Math.min(...ds) < 1e-4, [j.kind, j.cls, Math.max(...ds) - Math.min(...ds)]);
      if (j.cls !== 'flat') {
        ok('mitre plane at 45 degrees to both walls', Math.abs(Math.abs(j.ta[0] * nrm[0] + j.ta[1] * nrm[1]) - Math.SQRT1_2) < 1e-6, [j.kind, j.ta, j.tb]);
        // inside corner: the moulding's front pulls back from the corner; outside: it runs past it
        const w0 = j.a.reduce((m, q) => { const dd = (q[0] - j.a[0][0]) * j.na[0] + (q[2] - j.a[0][2]) * j.na[1]; return dd < m.d ? { d: dd, q } : m; }, { d: 1e9, q: j.a[0] }).q;
        let worst = 0;
        for (const q of j.a) { const dd = (q[0] - w0[0]) * j.na[0] + (q[2] - w0[2]) * j.na[1], al = (q[0] - w0[0]) * j.ta[0] + (q[2] - w0[2]) * j.ta[1];
          worst = Math.max(worst, Math.abs(al - (j.cls === 'inside' ? -dd : dd))); }
        ok('inside mitres pull back, outside mitres run past the corner', worst < 1e-4, [j.kind, j.cls, worst]);
      }
      const ys = j.a.map(q => q[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (j.kind === 'dado') ok('dado rail at its B5 height', Math.abs((y0 + y1) / 2 - PR.dado.y) < 0.02, [y0, y1, PR.dado.y]);
      if (j.kind === 'pictureRail') ok('picture rail at 3.0 m', Math.abs((y0 + y1) / 2 - 3.0) < 0.03, [y0, y1]);
      if (j.kind === 'skirting') ok('skirting stands on the floor', Math.abs(y0) < 1e-6, y0);
      if (j.kind === 'cornice') { const w = j.a[0], h = roof(w[0] + j.na[0] * 0.01 - j.ta[0] * 0.01, w[2] + j.na[1] * 0.01 - j.ta[1] * 0.01);
        ok('cornice top at the ceiling (follows the face height)', Math.abs(y1 - h) < 1e-4, [w, y1, h]); }
    }
    info.joints = jc;
    ok('trims have inside and outside mitres', (jc.inside || 0) > 0 && (jc.outside || 0) > 0, jc);

    /* beams: bottoms clear her (>= 2.30 m over the walkway), under the ceiling */
    const bk2 = {};
    for (const q of Bm.pieces) {
      bk2[q.kind] = (bk2[q.kind] || 0) + 1;
      if (q.kind === 'post') { ok('king posts stand on their tie (>= 2.30 m) and stop at the roof', q.y0 >= 2.3 - 1e-6 && q.y1 <= roof(q.x0, q.z0) + 0.02, q); continue; }
      ok('beam bottom >= 2.30 m (she is 2.19 m)', q.y0 >= 2.3 - 1e-6, q);
      for (let s = 0.002; s < 1; s += 0.0249) { const x = q.x0 + (q.x1 - q.x0) * s, z = q.z0 + (q.z1 - q.z0) * s;
        if (isW(Math.floor(x / L), Math.floor(z / L))) { put('beams stop at the walls (never through a wall tile)', [q.kind, x, z]); break; } }
      for (const s of [0.02, 0.25, 0.5, 0.75, 0.98]) { const x = q.x0 + (q.x1 - q.x0) * s, z = q.z0 + (q.z1 - q.z0) * s;
        ok('beam top under the ceiling', 'beams stop at the walls (never through a wall tile)', q.y1 <= roof(x, z) + 0.02, [q.kind, x, z, q.y1, roof(x, z)]); }
    }
    info.beams = bk2;
    let bMin = 1e9; Bm.group.traverse(m => { if (m.isMesh) bMin = Math.min(bMin, m.geometry.boundingBox.min.y); });
    const pMin = Math.min(1e9, ...Bm.pieces.filter(q => q.kind !== 'post').map(q => q.y0));
    if (Bm.pieces.some(q => q.kind !== 'post') && !Bm.pieces.some(q => q.kind === 'post')) ok('beam meshes no lower than the plan\'s beams', bMin >= pMin - 1e-6, [bMin, pMin]);

    /* chunk bounds: every chunk mesh inside its 6 x 6 tiles (plus a moulding's reach) */
    const chunkOk = (res, m) => res.group.traverse(o => { if (!o.isMesh || o.userData.chunk === undefined) return;
      const c = o.userData.chunk, cx = c % NCX, cy = Math.floor(c / NCX), bb = o.geometry.boundingBox;
      ok('chunk bounds within its 6 x 6 tiles', bb.min.x >= cx * CL - m && bb.max.x <= (cx + 1) * CL + m && bb.min.z >= cy * CL - m && bb.max.z <= (cy + 1) * CL + m,
        [o.name, c, bb.min.x, bb.max.x, bb.min.z, bb.max.z]); });
    chunkOk(W, 1e-4); chunkOk(C, 1e-4); chunkOk(T, 0.25); chunkOk(Bm, 0.2);

    /* doorways: leaves on their hinges, on their swing side, never in the walkway, at rest and through 8 phases of the animation */
    const leafCheck = (res, label) => {
      const tips = []; let worst = 0;
      for (const door of res.doors) {
        const d = door.d, across = d.axis === 'z' ? 0 : 2, along = d.axis === 'z' ? 2 : 0, cA = d.axis === 'z' ? d.cx : d.cz, cB = d.axis === 'z' ? d.cz : d.cx;
        for (const lf of door.leaves) {
          const wall = cA + lf.side * L / 2, m4 = new THREE.Matrix4(), corner = new THREE.Vector3();
          let tip = 0, near = 1e9, al = 1e9, y0 = 1e9, y1 = -1e9;
          for (const im of lf.ims) { im.getMatrixAt(lf.k, m4); const bx = im.geometry.boundingBox || (im.geometry.computeBoundingBox(), im.geometry.boundingBox);
            for (let c = 0; c < 8; c++) { corner.set(c & 1 ? bx.max.x : bx.min.x, c & 2 ? bx.max.y : bx.min.y, c & 4 ? bx.max.z : bx.min.z).applyMatrix4(m4);
              const xyz = [corner.x, corner.y, corner.z], dw = Math.abs(xyz[across] - wall); tip = Math.max(tip, dw); near = Math.min(near, dw);
              al = Math.min(al, (xyz[along] - cB) * d.swing); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y); } }
          ok(label + ': leaf tip <= 0.45 m from its side wall (H11)', tip <= 0.45 + 1e-6, [d.x, d.y, lf.side, lf.angle, tip]);
          ok(label + ': leaf stays out of the wall', near >= 0.02, [d.x, d.y, lf.side, near]);
          ok(label + ': leaf on its swing side, beyond the lining', al >= 0.17 - 1e-4, [d.x, d.y, lf.side, al]);
          ok(label + ': leaf from the floor up to 2.55 m, under the header', y0 > -1e-4 && y1 <= 2.6, [y0, y1]);
          worst = Math.max(worst, tip); tips.push(tip);
        }
      }
      return worst;
    };
    const plainLeaves = plan.doorways.reduce((s, d) => s + d.leaves.length, 0);
    const doorRes = [], creaks = [];
    for (const k of kitOn && kit ? [null, kit] : [null]) {
      const D = Arch.doorways(plan, k, Object.assign({ herQuiet: () => 0 }, o)), label = k ? 'kit doorways' : 'procedural doorways';
      ok(label + ': one door per plan doorway, the plan\'s leaves', D.doors.length === plan.doorways.length && D.doors.reduce((s, q) => s + q.leaves.length, 0) === plainLeaves);
      ok(label + ': a long board\'s doorway has no leaves', D.doors.every(q => q.d.board !== 'long' || q.leaves.length === 0));
      ok(label + ': a side board pins that leaf at 90 degrees', D.doors.every(q => q.leaves.every(lf => lf.pin === !!q.d.leaves.find(x => x.side === lf.side).pin && (!lf.pin || lf.angle === 90))));
      ok(label + ': kit pieces are shared (H21)', !k || D.group.children.filter(m => /frame|leaf/.test(m.userData.arch || '')).every(m => m.userData.shared && m.userData.kit));
      const rest = leafCheck(D, label + ' at rest');
      // the animation: someone walks up to the first door with leaves, waits, leaves; the sway runs on every other door
      const door = D.doors.find(q => q.leaves.some(lf => !lf.pin)), heard = [];
      const sfx = (kind, at, vol, soft) => heard.push({ kind, vol, soft, at });
      const phase = []; let t = 0, worst = rest;
      const run = (secs, actors) => { for (let s = 0; s < secs; s += 0.05) { Arch.updateDoors(0.05, actors, sfx); t += 0.05; } };
      const nearA = [{ x: door.cx + 0.3, z: door.cz + 0.2 }], far = [{ x: -50, z: -50 }];
      for (const [secs, who] of [[0.2, nearA], [0.2, nearA], [0.4, nearA], [1.0, nearA], [4.0, far], [door.hold - 3.5, far], [1.2, far], [3.0, far]]) {
        run(secs, who); const w = leafCheck(D, label + ' animated'); worst = Math.max(worst, w);
        phase.push({ t: +t.toFixed(2), angles: door.leaves.map(lf => +lf.angle.toFixed(2)), worst: +w.toFixed(4) });
      }
      const p4 = phase[3].angles, p8 = phase[7].angles;
      ok(label + ': leaves open to 89 degrees within 0.8 s of someone near', door.leaves.every((lf, k2) => lf.pin || Math.abs(phase[2].angles[k2] - 89) < 0.01 || p4[k2] > 88.99), phase.slice(0, 4));
      ok(label + ': leaves drift back to rest 6-10 s after (draught sway +-1.5)', door.hold >= 6 && door.hold <= 10 && door.leaves.every((lf, k2) => Math.abs(p8[k2] - lf.rest) <= 1.5 + 1e-6), [door.hold, phase]);
      ok(label + ': a creak at the door on opening and a softer one on closing', heard.length === 2 && !heard[0].soft && heard[1].soft && heard[1].vol < heard[0].vol
        && Math.abs(heard[0].at.x - door.cx) < 1e-9 && Math.abs(heard[0].at.z - door.cz) < 1e-9, heard);
      creaks.push(heard.length); doorRes.push({ label, rest: +rest.toFixed(4), worst: +worst.toFixed(4), phase, procedural: D.procedural, draws: D.stats.draws, tris: D.stats.tris });
      D.dispose();
    }
    // muted while she is quiet
    { const D = Arch.doorways(plan, null, Object.assign({ herQuiet: () => 1 }, o)), heard = [], door = D.doors.find(q => q.leaves.length);
      for (let s = 0; s < 1; s += 0.05) Arch.updateDoors(0.05, [{ x: door.cx, z: door.cz }], () => heard.push(1));
      ok('door creaks are muted while herQuiet() > 0.5', heard.length === 0, heard.length); D.dispose(); }
    info.doors = doorRes;

    /* modules: the kit's pieces where the plan put them */
    if (kit) {
      const M = Arch.modules(plan, kit, o);
      const want = plan.windows.length + plan.modules.filter(m => m.kind !== 'exit').length;
      ok('modules: every plan window and module placed (or reported missing)', M.placed.length + M.missing.length === want, [M.placed.length, M.missing.length, want]);
      for (const q of M.placed) {
        const src = q.kind === 'window' ? plan.windows.find(w => w.face === q.face) : plan.modules.find(m => m.kind === q.kind && m.x === q.x && m.y === q.y && m.face === q.face);
        const pos = src.pos, y = q.face >= 0 ? 0 : pos[1];
        ok('module origin = plan position (wall pieces on the floor at the face centre, B1)', Math.abs(q.obj.position.x - pos[0]) < 1e-6 && Math.abs(q.obj.position.z - pos[2]) < 1e-6 && Math.abs(q.obj.position.y - y) < 1e-6, [q.kind, q.obj.position, pos]);
        if (q.face >= 0) { const f = F[q.face], c = [(f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2];
          ok('face module at its face centre on the wall plane', Math.abs(pos[0] - c[0]) < 1e-3 && Math.abs(pos[2] - c[1]) < 1e-3 || q.kind === 'peel', [q.kind, pos, c]); }
        q.obj.traverse(m => { if (m.isMesh && m.userData.arch === 'wallsurface') { const c = W.cells[q.face], U1 = m.geometry.attributes.uv1;
          for (let v = 0; v < U1.count; v++) ok('module wall part: uv1 in its face\'s cell', U1.getX(v) >= c.u0 - 1e-6 && U1.getX(v) <= c.u0 + c.su + 1e-6 && U1.getY(v) >= c.v0 - 1e-6 && U1.getY(v) <= c.v0 + c.H * c.sv + 1e-6, q.kind); } });
      }
      info.modules = { placed: M.placed.length, missing: [...new Set(M.missing)], draws: M.stats.draws, tris: M.stats.tris };
      M.dispose();
    }

    /* the same plan builds the same geometry */
    const sig = res => { let h = 0x811c9dc5; res.group.traverse(m => { if (!m.isMesh) return; const a = m.geometry.attributes.position.array;
      for (let k = 0; k < a.length; k += 7) { h ^= Math.round(a[k] * 1e4); h = Math.imul(h, 16777619); } }); return h >>> 0; };
    const plan2 = Dress.plan(Dress.envFromData(JSON.parse(JSON.stringify(d)))), o2 = { bake: Dress.bakeInput(plan2, Dress.envFromData(d)), tier: 'lo' };
    const W2 = Arch.walls(plan2, o2), C2 = Arch.ceilings(plan2, o2), T2 = Arch.trims(plan2, o2);
    ok('same floor -> identical walls, ceilings and trims', sig(W) === sig(W2) && sig(C) === sig(C2) && sig(T) === sig(T2));
    for (const r of [W2, C2, T2]) r.dispose();

    info.counts = {};
    for (const [k, r] of [['walls', W], ['ceilings', C], ['trims', T], ['beams', Bm]]) info.counts[k] = { draws: r.stats.draws, tris: r.stats.tris, chunks: r.stats.chunks };
    info.draws = W.stats.draws + C.stats.draws + T.stats.draws + Bm.stats.draws; info.tris = W.stats.tris + C.stats.tris + T.stats.tris + Bm.stats.tris;
    for (const r of [W, C, T, Bm]) r.dispose();
    return { tag: 'F' + (i + 1) + '/' + n + 'p', style: plan.style, GW, GH, faces: F.length, doorways: plan.doorways.length, gables: plan.gables.length, bad, cnt, info, ms: +(performance.now() - t0).toFixed(0) };
  };
});

// the kits (placeholder grey boxes, exact sizes) for the kit paths
const styles = await p.evaluate(() => FLOORS.map(f => f.style));
const kits = await p.evaluate(async st => { const out = {}; for (const s of st) { try { out[s] = !!(await Kit.want(s, 'lo')); } catch (e) { out[s] = 'error ' + e.message; } } return out; }, [...new Set(styles)]);
console.log('  kits (lo):', JSON.stringify(kits));

const runs = [];
for (let i = 0; i < 5; i++) runs.push([i, 1, 4242 + i * 17], [i, 4, 9001 + i * 31]);
// an attic floor whose seed gives a gable hall (spec A10: sloped ceilings, gable end walls)
const gSeed = await p.evaluate(() => { for (let s = 1; s < 400; s++) { const d = generateFloor(3, 1, 'medium', 70000 + s); const env = Dress.envFromData(d); const pl = Dress.plan(env); if (pl.gables.length && pl.faces.some(f => f.hs)) return 70000 + s; } return null; });
check(gSeed !== null, 'found an attic floor with a gable hall', gSeed);
if (gSeed) runs.push([3, 1, gSeed]);
const allBad = {}, allCnt = {};
for (const [i, n, seed] of runs) {
  const R = await p.evaluate(([i, n, seed]) => window.__archCheck(i, n, seed, true), [i, n, seed]);
  const I = R.info;
  console.log(`  ${R.tag} ${R.style} ${R.GW}x${R.GH} seed ${seed}: ${R.faces} faces (${I.insetFaces} inset, ${I.reveals} reveals, ${I.gableFaces} gable), ${I.ceilTiles} ceiling tiles (${I.ceilCut} cut), `
    + `${I.stepEdges} step edges, wall tops shared ${I.wallTopsShared}; joints ${JSON.stringify(I.joints)}; beams ${JSON.stringify(I.beams)}; ${R.doorways} doorways`);
  console.log(`     draws/tris: walls ${I.counts.walls.draws}/${I.counts.walls.tris} (${I.counts.walls.chunks} chunks), ceilings ${I.counts.ceilings.draws}/${I.counts.ceilings.tris}, trims ${I.counts.trims.draws}/${I.counts.trims.tris}, `
    + `beams ${I.counts.beams.draws}/${I.counts.beams.tris}; doors ${I.doors.map(q => q.label.split(' ')[0] + ' ' + q.draws + '/' + q.tris + ' tip rest ' + q.rest + ' anim ' + q.worst).join(', ')}; `
    + `modules ${I.modules ? I.modules.placed + ' placed, ' + I.modules.draws + '/' + I.modules.tris + (I.modules.missing.length ? ' missing ' + I.modules.missing.join(' ') : '') : '-'}; build ms ${JSON.stringify(I.ms)}`);
  for (const k in R.cnt) { allCnt[k] = (allCnt[k] || 0) + R.cnt[k]; (allBad[k] || (allBad[k] = [])).push(R.tag + ' ' + JSON.stringify(R.bad[k])); }
  if (R.gables) check(I.gableFaces > 0 && I.gableCols > 0, `${R.tag}: gable faces checked against ceilAtXZ (${I.gableCols} roof points)`);
}
const KEYS = ['uv1 cells = LightBaker.packAtlas = bake().wallCells', 'walls.faces in the bake\'s order', 'walls have no vertex colours', 'walls have uv1',
  'a skipped face keeps only its upper band', 'wall vertex on its face plane (servant runs 0.30 m proud)', 'wall vertex within its face', 'wall uv0: u = 0.5 u + 0.5 variant (main), v = y / 3',
  'wall uv1 = its cell at (u, y)', 'wall uv1 inside its cell', 'wall top = ceilAtXZ (gable faces at u = 0 .14 .5 .86 1)', 'gable face has its 5 roof points', 'reveal spans the 0.30 m inset',
  'ceiling receives shadows', 'ceiling triangles face down', 'ceiling triangle over an open tile', 'ceiling vertex at ceilAtXZ', 'ceiling uv1 = plan uv', 'ceiling uv0 = world xz / 2.25',
  'every open ceiling tile covered exactly once', 'step quads are vertical', 'step quad faces the higher ceiling', 'step quad between the two ceilings',
  'step vertices sit on one of the two ceiling edges (no gap)', 'step quad closes each height step exactly (area)', 'wall top vertex is a ceiling vertex (no T-junction gap)',
  'the two rings of a joint coincide', 'joint ring is planar (mitre / butt plane)', 'mitre plane at 45 degrees to both walls', 'inside mitres pull back, outside mitres run past the corner',
  'dado rail at its B5 height', 'picture rail at 3.0 m', 'skirting stands on the floor', 'cornice top at the ceiling (follows the face height)', 'trims have inside and outside mitres',
  'king posts stand on their tie (>= 2.30 m) and stop at the roof', 'beam bottom >= 2.30 m (she is 2.19 m)', 'beam top under the ceiling', 'beams stop at the walls (never through a wall tile)', 'beam meshes no lower than the plan\'s beams', 'chunk bounds within its 6 x 6 tiles',
  'door creaks are muted while herQuiet() > 0.5', 'modules: every plan window and module placed (or reported missing)', 'module origin = plan position (wall pieces on the floor at the face centre, B1)',
  'face module at its face centre on the wall plane', 'module wall part: uv1 in its face\'s cell', 'same floor -> identical walls, ceilings and trims'];
for (const k of KEYS) check(!allCnt[k], k + ' (all floors)', allBad[k] && allBad[k].slice(0, 3));
const doorKeys = Object.keys(allCnt).filter(k => !KEYS.includes(k));
for (const pre of ['procedural doorways', 'kit doorways']) {
  const mine = doorKeys.filter(k => k.startsWith(pre));
  check(mine.length === 0, pre + ': hinges, leaves never in the walkway (rest + 8 phases), pins, boards, open/close timing, creaks (all floors)', mine.map(k => k + ' ' + allCnt[k] + ' ' + allBad[k][0]));
}
const other = doorKeys.filter(k => !k.startsWith('procedural doorways') && !k.startsWith('kit doorways'));
check(other.length === 0, 'no other failures', other.map(k => k + ': ' + allBad[k][0]));

/* ---------- pictures: a hall and a corridor per style, lit by the floor's own bake through MatLib ---------- */
const TEX = { wood: ['wall_paper1', 'floor_wood1'], tile: ['wall_tile2', 'floor_tile2'], concrete: ['wall_brick3', 'floor_concrete3'], attic: ['wall_attic4', 'floor_wood4'], workshop: ['wall_shop5', 'floor_tile5'] };
for (let i = 0; i < 5; i++) {
  const seed = i === 3 && gSeed ? gSeed : 4242 + i * 17;
  const shot = await p.evaluate(async ([i, seed, tex]) => {
    const load = src => new Promise(res => { const im = new Image(); im.onload = () => { const t = new THREE.CanvasTexture(im); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; res(t); }; im.onerror = () => res(null); im.src = 'textures/' + src + '_color.webp'; });
    const d = generateFloor(i, 1, 'medium', seed); applyFloor(d, 0);
    const env = Dress.envFromData(d), plan = Dress.plan(env), B = Dress.bakeInput(plan, env), o = { bake: B, tier: 'lo' }, L = plan.L;
    const maps = LightBaker.bake(B, 'lo'); MatLib.tier = 'low'; MatLib.releaseLevel(); MatLib.setLevelMaps(Object.assign({}, maps, { GW: plan.GW, GH: plan.GH }));
    const [wt, ft] = await Promise.all([load(tex[0]), load(tex[1])]);
    const lf = c => MatLib.withLightField(new THREE.MeshLambertMaterial({ color: c }));
    const mats = { wall: MatLib.wallMaterial({ map: wt, tier: 'low' }), upper: MatLib.wallMaterial({ map: wt, variant: false, tier: 'low', color: 0xb8b0a8 }),
      service: MatLib.wallMaterial({ tier: 'low', color: 0xd8d0c0 }), ceiling: MatLib.ceilingMaterial({ tier: 'low', color: 0xd8d2c8 }), header: MatLib.wallMaterial({ map: wt, tier: 'low' }),
      trim: lf(0x6b4a34), beam: lf(0x5a4330), ibeam: lf(0x444850), frame: lf(0x6b4a34), leaf: lf(0x7a5a40) };
    const kit = Kit.get(plan.style, 'lo'), scene = new THREE.Scene(), oo = Object.assign({ materials: mats }, o);
    const parts = [Arch.walls(plan, oo), Arch.ceilings(plan, oo), Arch.trims(plan, oo), Arch.beams(plan, oo), Arch.doorways(plan, null, oo), Arch.modules(plan, kit, oo)];   // (doorways: the procedural frame and leaves, brown; the kit's are grey stand-ins)
    for (const r of parts) scene.add(r.group);
    const fm = MatLib.floorMaterial({ map: ft, tier: 'low', GW: plan.GW, GH: plan.GH }), fg = new THREE.PlaneGeometry(plan.GW * L, plan.GH * L);
    const floor = new THREE.Mesh(fg, fm); floor.rotation.x = -Math.PI / 2; floor.position.set(plan.GW * L / 2, 0, plan.GH * L / 2); scene.add(floor);
    scene.add(new THREE.HemisphereLight(0x8890a0, 0x302820, 0.35));
    const lamp = new THREE.PointLight(0xffe0b0, 6, 9, 1.6); scene.add(lamp);
    const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); R.setSize(480, 300); R.outputColorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(70, 480 / 300, 0.05, 40);
    const isW = (x, y) => x < 0 || y < 0 || x >= plan.GW || y >= plan.GH || grid[y][x] === 1;
    // a hall: from one end of the biggest hall, looking along it; a corridor: from a doorway, looking along the passage
    const gab = (r) => plan.gables.some(g => g.tx0 === r.x0 && g.ty0 === r.y0) ? 1 : 0;      // (a gable hall first: its sloped ceiling)
    const halls = d.rooms.map(r => ({ x0: r[1], y0: r[2], x1: r[3], y1: r[4] })).sort((a, b) => gab(b) - gab(a) || (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) - (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1));
    const views = [];
    if (halls.length) { const h = halls[0], lx = h.x1 - h.x0 >= h.y1 - h.y0;
      views.push(lx ? { p: [(h.x0 + 0.3) * L, 1.6, (h.y0 + h.y1 + 1) / 2 * L], t: [(h.x1 + 1) * L, 1.9, (h.y0 + h.y1 + 1) / 2 * L] } : { p: [(h.x0 + h.x1 + 1) / 2 * L, 1.6, (h.y0 + 0.3) * L], t: [(h.x0 + h.x1 + 1) / 2 * L, 1.9, (h.y1 + 1) * L] }); }
    // the corridor view: the doorway with the longest straight open run behind it
    let best = null;
    for (const dw of plan.doorways) { const ax = dw.axis === 'x' ? [1, 0] : [0, 1];
      for (const s of [-1, 1]) { let k = 1; while (k < 6 && !isW(dw.x - s * ax[0] * k, dw.y - s * ax[1] * k)) k++;
        if (!best || k > best.k) best = { k, dw, s, ax }; } }
    if (best) { const { dw, s, ax, k } = best, back = Math.min(k - 1, 2) + 0.45;
      views.push({ p: [dw.cx - s * ax[0] * back * L, 1.6, dw.cz - s * ax[1] * back * L], t: [dw.cx + s * ax[0] * 2 * L, 1.7, dw.cz + s * ax[1] * 2 * L] }); }
    const out = [];
    for (const v of views) { cam.position.set(...v.p); cam.lookAt(...v.t); lamp.position.set(v.p[0], 2.2, v.p[2]); Arch.updateDoors(0.016, [], null); R.render(scene, cam); out.push(R.domElement.toDataURL('image/png')); }
    const info = { draws: R.info.render.calls, tris: R.info.render.triangles, programs: R.info.programs.length, views: views.length, style: plan.style };
    for (const r of parts) r.dispose(); fg.dispose(); R.dispose(); MatLib.releaseLevel();
    return { out, info };
  }, [i, seed, TEX[styles[i]]]);
  // two views side by side in one PNG (composed in the page, so no image library is needed here)
  const both = await p.evaluate(async urls => { const ims = await Promise.all(urls.map(u => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = u; })));
    const c = document.createElement('canvas'); c.width = 480 * ims.length; c.height = 300; const g = c.getContext('2d'); ims.forEach((im, k) => g.drawImage(im, 480 * k, 0)); return c.toDataURL('image/png'); }, shot.out);
  const file = path.join(OUT, 'arch_' + styles[i] + '.png');
  fs.writeFileSync(file, Buffer.from(both.split(',')[1], 'base64'));
  console.log(`  picture ${file}: ${shot.info.views} views, last view ${shot.info.draws} draws, ${shot.info.tris} tris, ${shot.info.programs} programs`);
  check(shot.info.views === 2, `${styles[i]}: a hall and a corridor rendered`);
}

check(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 5));
await b.close();
process.exit(summary());
