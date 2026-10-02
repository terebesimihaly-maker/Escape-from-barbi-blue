// The house kit (js/kit.js): loading each style's Blender models (models/kit/<tier>/*.glb) at lo and md, furnishing real floors from
// their plans (js/dress.js) with every piece of furniture exactly on its box (visual = collision, spec F3.8), the grey boxes when a
// kit can't be loaded (E7), upgrading a floor in place when its kit arrives late (E4), throwing kits away (E5), and the wardrobe and
// exit door contracts of level.js (H10). js/kit.js, js/matlib.js and js/dress.js aren't in index.html yet, so they're added to the
// page at run time (when they are, they're used as loaded).
import { launch, solo, check, summary, pageErrors, BASE } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'models/kit/manifest.json'), 'utf8'));
const STYLES = ['wood', 'tile', 'concrete', 'attic', 'workshop'], TIERS = ['lo', 'md'];
const kitSrc = fs.readFileSync(path.join(ROOT, 'js/kitdefs.js'), 'utf8');
const KIT = JSON.parse(kitSrc.slice(kitSrc.indexOf('/*KITDEFS*/') + 11, kitSrc.indexOf('/*END*/')));

async function inject(p) {
  for (const [g, f] of [['MatLib', 'matlib'], ['Dress', 'dress'], ['LightBaker', 'lightbake'], ['Kit', 'kit']])
    if (!await p.evaluate(g => typeof window[g] !== 'undefined', g)) await p.addScriptTag({ url: '/js/' + f + '.js' });
  // helpers inside the page: each solid's world AABB from what's actually in the furnish group (instances and animated copies)
  await p.evaluate(() => {
    window.__kt = {
      aabbs(R) {
        R.group.updateMatrixWorld(true);
        const n = R.solids.length, boxes = Array.from({ length: n }, () => new THREE.Box3()), hits = new Array(n).fill(0), m = new THREE.Matrix4(), b = new THREE.Box3();
        R.group.traverse(o => {
          const k = o.userData.kit; if (!k) return;
          if (o.isInstancedMesh && Array.isArray(k.solid)) {
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            k.solid.forEach((s, j) => { if (s < 0) return; o.getMatrixAt(j, m); m.premultiply(o.matrixWorld); boxes[s].union(b.copy(o.geometry.boundingBox).applyMatrix4(m)); hits[s]++; });
          // (precise: an animated copy is measured where its vertices are, not as its turned bounding box, which pokes through the floor)
          } else if (!o.isInstancedMesh && o.parent === R.group && typeof k.solid === 'number' && k.solid >= 0) { boxes[k.solid].union(new THREE.Box3().setFromObject(o, true)); hits[k.solid]++; }
        });
        return boxes.map((x, i) => ({ hits: hits[i], min: x.min.toArray(), max: x.max.toArray() }));
      },
      // the world AABB of every placed item (band, fixture, window) from its node box: [kind, node, min, max, extra]
      items: R => R.items.filter(it => it.aabb).map(it => ({ kind: it.kind, node: it.node, mount: it.mount, min: it.aabb.min.toArray(), max: it.aabb.max.toArray(),
        band: it.band, fixture: it.fixture, window: it.window, face: it.face, solid: it.solid })),
      ceilMax: s => { const U = 0.045, x0 = s.x0 * U, x1 = s.x1 * U, z0 = s.y0 * U, z1 = s.y1 * U;
        return Math.max(ceilAtXZ((x0 + x1) / 2, (z0 + z1) / 2), ceilAtXZ(x0 + 1e-3, z0 + 1e-3), ceilAtXZ(x1 - 1e-3, z0 + 1e-3), ceilAtXZ(x0 + 1e-3, z1 - 1e-3), ceilAtXZ(x1 - 1e-3, z1 - 1e-3)); },
      lights: o => { let n = 0; o.traverse(q => { if (q.isLight) n++; }); return n; },
      matrices: R => R.items.map(it => it.matrix ? it.matrix.elements.map(v => Math.round(v * 1e5)).join(',') : 'x').join(';'),
    };
  });
}
const b = await launch();
const p = await solo(b, 'low', 480, 300);
p.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 300)); });
await inject(p);
check(await p.evaluate(() => ['want', 'preload', 'ready', 'get', 'progress', 'release', 'evict', 'tierFor', 'furnish', 'wardrobe', 'exit', 'upgradeInPlace', 'placeholderBox']
  .every(k => typeof Kit[k] === 'function')), 'window.Kit has the whole API');

/* ---------- tiers ---------- */
{
  const t = await p.evaluate(() => ({ low: Kit.tierFor('low', false), med: Kit.tierFor('medium', false), medPhone: Kit.tierFor('medium', true), high: Kit.tierFor('high', false),
    highPhone: Kit.tierFor('high', true), max: renderer.capabilities.maxTextureSize, mem: navigator.deviceMemory || 8 }));
  check(t.low === 'lo' && t.med === 'md' && t.medPhone === 'lo', 'tierFor: low -> lo, medium -> md, medium on a phone -> lo', t);
  check(t.high === (t.max >= 8192 && t.mem >= 8 ? 'hi' : 'md') && t.highPhone === 'md', 'tierFor: high -> hi only with 8192 textures and 8 GB (md on a phone)', t);
}

/* ---------- loading: every manifest node, no lights, everything marked as the kit's ---------- */
for (const tier of TIERS) {
  const pr = await p.evaluate(tier => { const ps = ['wood', 'tile', 'concrete', 'attic', 'workshop'].map(s => Kit.want(s, tier)); window.__kp = Promise.all(ps); return Kit.progress(); }, tier);
  check(pr >= 0 && pr < 1, `${tier}: progress() is between 0 and 1 while the kits load`, pr);
  const t0 = Date.now(); await p.evaluate(() => window.__kp); const ms = Date.now() - t0;
  for (const style of STYLES) {
    const want = Object.keys(MAN.nodes).filter(n => MAN.nodes[n].file === style || MAN.nodes[n].file === 'common');
    const r = await p.evaluate(([style, tier, want]) => {
      const k = Kit.get(style, tier); if (!k) return null;
      let lights = 0, unmarked = 0, texUnshared = 0, std = 0, meshes = 0;
      for (const sc of [k.scene, k.common]) sc.traverse(o => { if (o.isLight) lights++; if (!o.userData.kit || !o.userData.shared) unmarked++;
        if (o.isMesh) { meshes++; for (const m of [].concat(o.material)) { if (m.isMeshStandardMaterial && !/^(WallSurface|Glass|SkyPlane|Emit)/.test(m.name)) std++;
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[key] && !m[key].userData.shared) texUnshared++; } } });
      return { missing: want.filter(n => !k.nodes[n]), lights, unmarked, texUnshared, std, meshes, ready: Kit.ready(style, tier), tier: k.tier,
        // every furniture node's box (node frame) against KIT: each face within 0.02 m (F3.1)
        boxes: Object.keys(k.nodes).filter(n => /^(Solid|Isl|Col)_/.test(n)).map(n => { const P = Kit.prims(k, n, true); return [n, P.box.min.toArray(), P.box.max.toArray()]; }) };
    }, [style, tier, want]);
    if (!r) { check(false, `${tier}/${style}: the kit loads`); continue; }
    check(r.missing.length === 0 && r.ready && r.tier === tier, `${tier}/${style}: every manifest node of ${style} + common is in the kit (${want.length})`, r.missing.slice(0, 8));
    check(r.lights === 0, `${tier}/${style}: no lights in the kit`, r.lights);
    check(r.unmarked === 0 && r.texUnshared === 0, `${tier}/${style}: every node, material and texture is marked as the kit's (disposeLevel skips them)`, [r.unmarked, r.texUnshared]);
    if (tier === 'lo') check(r.std === 0, `lo/${style}: Lambert materials on lo`, r.std);
    const bad = [];
    for (const [n, mn, mx] of r.boxes) {
      const man = MAN.nodes[n], id = man.id, it = Object.assign({}, KIT.items[id]), v = /_v(\d+)$/.exec(n);
      if (v && it.var && it.var[+v[1]]) Object.assign(it, it.var[+v[1]]);
      const H = /_H(\d+)$/.exec(n), top = H ? +H[1] / 100 : Math.max(it.h, it.top || 0), wall = it.slot === 'wall';
      const ex = [-it.w / 2, 0, wall ? 0 : -it.d / 2], ey = [it.w / 2, top, wall ? it.d : it.d / 2];
      if ([0, 1, 2].some(a => Math.abs(mn[a] - ex[a]) > 0.02 || Math.abs(mx[a] - ey[a]) > 0.02)) bad.push([n, mn.map(x => +x.toFixed(3)), mx.map(x => +x.toFixed(3)), ex, ey]);
    }
    check(bad.length === 0, `${tier}/${style}: every Solid_/Isl_/Col_ node's box matches KIT within 0.02 m (${r.boxes.length})`, bad.slice(0, 3));
  }
  console.log(`  (${tier}: 5 styles loaded in ${ms} ms)`);
  check(await p.evaluate(() => Kit.progress()) === 1, `${tier}: progress() is 1 when everything has loaded`);
}

/* ---------- furnishing real floors ---------- */
const sums = [];
for (let i = 0; i < 5; i++) for (const tier of TIERS) {
  const style = STYLES[i], tag = `F${i + 1} ${style} ${tier}`;
  const R = await p.evaluate(([i, tier]) => {
    if (tier === 'lo') { bb.startFloor(i); window.__plan = Dress.plan(Dress.envFromGame()); window.__solids = SOLIDS.map(s => Object.assign({}, s)); }
    const plan = window.__plan, kit = Kit.get(plan.style, tier), lv = { group: new THREE.Group() }, lights0 = __kt.lights(scene);
    const R = Kit.furnish(lv, plan, { tier, evict: false, anim: tier !== 'lo' });
    const R2 = Kit.furnish(null, plan, { tier, evict: false, anim: tier !== 'lo' });
    R.update(0.016, 1.3);
    const ab = __kt.aabbs(R), items = __kt.items(R), same = __kt.matrices(R) === __kt.matrices(R2);
    const solidsAt = SOLIDS.map(s => ({ id: s.id, x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, h: s.h, rot: s.rot, kind: s.kind, ceil: __kt.ceilMax(s) }));
    const ims = []; R.group.traverse(o => { if (o.isInstancedMesh) ims.push({ name: o.name, kind: o.userData.kit.kind, mount: o.userData.kit.mount, aabb: !!o.userData.kit.aabb,
      solid: Array.isArray(o.userData.kit.solid) ? o.userData.kit.solid.length === o.count : true, shadow: o.castShadow,
      lf: o.material.customProgramCacheKey ? /mlLF1/.test(o.material.customProgramCacheKey()) : false, emit: o.userData.kit.kind === 'emit', glass: /Glass/.test(o.material.name) }); });
    // draws: the kit alone, seen from the biggest hall's middle (or the spawn), four ways
    const big = plan.identities.spaces.filter(s => s.hall >= 0).map(s => ROOMS[s.hall]).sort((a, b) => (b.tx1 - b.tx0 + 1) * (b.ty1 - b.ty0 + 1) - (a.tx1 - a.tx0 + 1) * (a.ty1 - a.ty0 + 1))[0];
    const L = 2.25, cx = big ? (big.tx0 + big.tx1 + 1) / 2 * L : 1.5 * L, cz = big ? (big.ty0 + big.ty1 + 1) / 2 * L : 1.5 * L;
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 18); sc.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1)); sc.add(lv.group);
    let calls = 0, tris = 0;
    for (let a = 0; a < 4; a++) { cam.position.set(cx, 1.62, cz); cam.rotation.set(0, a * Math.PI / 2, 0); cam.updateMatrixWorld(); renderer.info.reset(); renderer.render(sc, cam);
      calls = Math.max(calls, renderer.info.render.calls); tris = Math.max(tris, renderer.info.render.triangles); }
    sc.remove(lv.group);
    const lights1 = __kt.lights(scene) + __kt.lights(lv.group);
    const out = { style: plan.style, kit: !!kit, ph: R.placeholder, n: SOLIDS.length, solids: solidsAt, ab, items, same, ims, stats: R.stats, kitCount: R.kitCount,
      planN: { band: plan.band.length, fix: plan.fixtures.length, win: plan.windows.length }, faces: plan.faces.map(f => [f.x0, f.z0, f.x1, f.z1, f.nx, f.nz, f.inset || 0, f.h]),
      fixtures: plan.fixtures.map(f => ({ mount: f.mount, src: f.src })), lights0, lights1, calls, tris, anims: R.anims.length, rockers: R.solids.filter(s => s.id === 'rocking_chair').length };
    if (tier !== 'lo') { const a = R.anims.find(x => x.obj.userData.kit && x.obj.userData.kit.node === 'Solid_rocking_chair');
      if (a) { R.update(0, 0.9); const r0 = a.obj.children[0].rotation.x; R.update(0, 1.8); out.rock = [r0, a.obj.children[0].rotation.x]; } }
    R.dispose(); R2.dispose();
    return out;
  }, [i, tier]);
  check(R.kit && !R.ph && R.style === style, `${tag}: furnished from the loaded kit`, [R.kit, R.ph, R.style]);
  check(R.n > 0, `${tag}: the floor has furniture boxes (${R.n})`);
  // visual = collision: every box has an instance whose world AABB is its box (0.05 m), standing on the floor, as tall as KIT says
  const bad = [], missing = [];
  R.solids.forEach((s, k) => {
    const a = R.ab[k], U = 0.045; if (!a.hits) { missing.push([k, s.id]); return; }
    const it = Object.assign({}, KIT.items[s.id]); const top = it.hcm ? null : Math.max(s.h, it.top || 0);
    const okXZ = Math.abs(a.min[0] - s.x0 * U) <= 0.05 && Math.abs(a.max[0] - s.x1 * U) <= 0.05 && Math.abs(a.min[2] - s.y0 * U) <= 0.05 && Math.abs(a.max[2] - s.y1 * U) <= 0.05;
    const okY = a.min[1] >= -0.005 && a.min[1] <= 0.02 && (top !== null ? Math.abs(a.max[1] - top) <= 0.05 : a.max[1] >= s.ceil - 0.01 && a.max[1] <= Math.max(...it.hcm) / 100 + 0.02);
    if (!okXZ || !okY) bad.push([s.id, s.rot, s.kind, [s.x0 * U, s.y0 * U, s.x1 * U, s.y1 * U].map(v => +v.toFixed(3)), a.min.map(v => +v.toFixed(3)), a.max.map(v => +v.toFixed(3))]);
  });
  check(missing.length === 0, `${tag}: every SOLIDS entry has an instance`, missing.slice(0, 5));
  check(bad.length === 0, `${tag}: every instance's world AABB matches its box within 0.05 m, on the floor, at its height (F3.8)`, bad.slice(0, 3));
  // everything the plan asked for is placed (the placeholder kit has every node)
  const cnt = k => R.items.filter(x => x.kind === k).length;
  check(cnt('band') === R.planN.band && cnt('fixture') === R.planN.fix && cnt('window') === R.planN.win, `${tag}: every band piece, lamp and window of the plan is placed`,
    [cnt('band'), R.planN.band, cnt('fixture'), R.planN.fix, cnt('window'), R.planN.win]);
  // wall pieces within 0.44 m of their face (an inset run's 0.30 included), never inside the wall, within its ends
  const far = [];
  for (const it of R.items) {
    if (it.kind !== 'band' && !(it.kind === 'fixture' && R.fixtures[it.fixture].mount === 'wall')) continue;
    const f = R.faces[it.face !== undefined ? it.face : -1];
    if (!f) continue;
    const [x0, z0, x1, z1, nx, nz] = f, d = q => (q[0] - x0) * nx + (q[2] - z0) * nz, tx = Math.sign(x1 - x0), tz = Math.sign(z1 - z0);
    const u = q => ((q[0] - x0) * tx + (q[2] - z0) * tz), corners = [[it.min[0], 0, it.min[2]], [it.max[0], 0, it.max[2]], [it.min[0], 0, it.max[2]], [it.max[0], 0, it.min[2]]];
    const dmin = Math.min(...corners.map(d)), dmax = Math.max(...corners.map(d)), umin = Math.min(...corners.map(u)), umax = Math.max(...corners.map(u));
    if (dmin < -0.011 || dmax > 0.44 + 0.011 || umin < -0.021 || umax > 2.25 + 0.021) far.push([it.node, +dmin.toFixed(3), +dmax.toFixed(3), +umin.toFixed(3), +umax.toFixed(3)]);
  }
  check(far.length === 0, `${tag}: band pieces and wall lamps reach at most 0.44 m from their face and stay inside it`, far.slice(0, 3));
  // hanging lamps: bottom >= 2.30 m (over walkable floor); windows inside their face's envelope (<= 1.0 m into the wall, <= 0.2 m out)
  const low = R.items.filter(it => it.kind === 'fixture' && R.fixtures[it.fixture].mount === 'ceiling' && it.min[1] < 2.3 - 0.005).map(it => [it.node, it.min[1]]);
  check(low.length === 0, `${tag}: hanging lamps keep their bottom at 2.30 m or higher`, low.slice(0, 3));
  const winBad = R.items.filter(it => it.kind === 'window').filter(it => { const [x0, z0, x1, z1, nx, nz] = R.faces[it.face], d = q => (q[0] - x0) * nx + (q[2] - z0) * nz;
    const c = [[it.min[0], 0, it.min[2]], [it.max[0], 0, it.max[2]]].map(d); return Math.min(...c) < -1.0 - 0.01 || Math.max(...c) > 0.2 + 0.01; }).map(it => it.node);
  check(winBad.length === 0, `${tag}: windows stay within 1.0 m behind and 0.2 m in front of their face`, winBad.slice(0, 3));
  // instancing: every batch carries userData.kit, kit materials have the light field, shadows only on md/hi
  check(R.ims.every(m => m.kind && m.mount && (m.emit || m.aabb) && m.solid), `${tag}: every instanced batch carries userData.kit {kind, mount, aabb, solid}`);
  check(R.ims.filter(m => !m.emit).every(m => m.lf), `${tag}: every kit material has the light field (MatLib.withLightField)`, R.ims.filter(m => !m.emit && !m.lf).map(m => m.name).slice(0, 4));
  check(R.ims.filter(m => !m.emit && !m.glass && m.kind !== 'cord').every(m => m.shadow === (tier !== 'lo')), `${tag}: instances cast shadows on md/hi only`);
  check(R.same, `${tag}: the same plan furnishes identically twice`);
  check(R.lights0 === R.lights1, `${tag}: furnishing adds no lights`, [R.lights0, R.lights1]);
  if (R.rock) check(Math.abs(R.rock[0] - R.rock[1]) > 1e-3 && Math.abs(R.rock[0]) <= 0.1 + 1e-6, `${tag}: the rocking chair rocks within ±0.10 rad`, R.rock);
  sums.push({ tag, ...R.stats, calls: R.calls, tris: R.tris });
  console.log(`  ${tag}: ${R.n} boxes, ${R.kitCount} pieces, ${R.stats.instanced} instanced batches (${R.stats.instances} instances), ${R.stats.merged} merged, ` +
    `${R.stats.emissive} emissive, ${R.stats.glows} glows, ${R.stats.anims} animated; up to ${R.calls} draws / ${R.tris} triangles in view; ${R.stats.ms} ms`);
}
// the matrices don't depend on the tier
{
  const same = await p.evaluate(() => { const plan = window.__plan, a = Kit.furnish(null, plan, { tier: 'lo', evict: false, anim: false }), c = Kit.furnish(null, plan, { tier: 'md', evict: false, anim: false });
    const r = __kt.matrices(a) === __kt.matrices(c); a.dispose(); c.dispose(); return r; });
  check(same, 'the pieces stand in the same places on lo and md (H7: the tier changes only the detail)');
}

/* ---------- placeholders when no kit can be loaded, and upgrading in place when it arrives ---------- */
{
  const q = await b.newContext({ viewport: { width: 480, height: 300 } }).then(async c2 => {
    await c2.addInitScript(() => localStorage.setItem('bb_settings', JSON.stringify({ sens: 1, vol: 0.5, quality: 'low' })));
    const pg = await c2.newPage(); pg.on('pageerror', e => { console.log('  pageerror:', e.message); pageErrors.push(e.message); }); return pg; });
  let blocked = true, blockCommon = true;
  await q.route('**/models/kit/lo/concrete.glb', r => blocked ? r.fulfill({ status: 404, body: 'not found' }) : r.continue());
  await q.route('**/models/kit/lo/common.glb', r => blockCommon ? r.fulfill({ status: 404, body: 'not found' }) : r.continue());
  await q.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await q.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 120000, polling: 500 });
  await inject(q);
  if (!await q.evaluate(() => typeof Arch !== 'undefined')) await q.addScriptTag({ url: '/js/arch.js' });
  // common.glb failing: the kit works without its 5 nodes, and the next want() tries common again and adds them
  const C1 = await q.evaluate(async () => { const k = await Kit.want('wood', 'lo'); return { k: !!k, partial: k && k.partial, conduit: k && k.has('Band_conduit') }; });
  blockCommon = false;
  const C2 = await q.evaluate(async () => { const k = await Kit.want('wood', 'lo'); return { same: k === Kit.get('wood', 'lo'), partial: k.partial, conduit: k.has('Band_conduit'), embers: k.has('Fix_fire_embers') }; });
  check(C1.k && C1.partial && !C1.conduit, 'common.glb 404: the style kit still loads, marked partial (no common nodes)', C1);
  check(C2.same && !C2.partial && C2.conduit && C2.embers, 'the next want() loads common again and adds its nodes to the cached kit', C2);
  const A = await q.evaluate(async () => {
    const got = await Kit.want('concrete', 'lo');
    bb.startFloor(2);
    await new Promise(res => { const w = () => (bb.level && bb.level.grid === bb.grid ? res() : requestAnimationFrame(w)); w(); });
    const plan = Dress.plan(Dress.envFromGame()), lights0 = __kt.lights(scene);
    const R = Kit.furnish(level, plan, { tier: 'lo' });
    const ab = __kt.aabbs(R), U = 0.045;
    const exact = SOLIDS.every((s, i) => { const a = ab[i], it = KIT.items[s.id], h = it && it.hcm ? __kt.ceilMax(s) : s.h;
      return a.hits === 1 && Math.abs(a.min[0] - s.x0 * U) < 1e-3 && Math.abs(a.max[0] - s.x1 * U) < 1e-3 && Math.abs(a.min[2] - s.y0 * U) < 1e-3 && Math.abs(a.max[2] - s.y1 * U) < 1e-3
        && Math.abs(a.min[1]) < 1e-6 && Math.abs(a.max[1] - h) < 1e-3; });
    const boards = level.group.children.filter(o => o.children.some(c => /^Board(Short|Long)/.test(c.name)));
    window.__up = { R, plan, boards, paintings: level.paintings, doll: scares.doll, lights0, door: level.door, wards: closets.map(c => c.doors && c.doors[0].pivot.parent) };
    return { got, ready: Kit.ready('concrete', 'lo'), get: Kit.get('concrete', 'lo'), ph: R.placeholder, n: SOLIDS.length, exact, phAll: R.solids.every(s => s.placeholder),
      others: R.items.filter(x => x.kind !== 'placeholder').length, inGroup: R.group.parent === level.group, isLevelKit: level.kit === R, boards: boards.length,
      wardrobe: Kit.wardrobe({ x: 100, y: 100, ox: 1, oy: 0 }, 'concrete', { tier: 'lo' }), exitNull: Kit.exit('concrete', { tier: 'lo', plan }) };
  });
  check(A.got === null && !A.ready && A.get === null, 'a kit that 404s: want() resolves null, ready() is false, get() is null', A);
  check(A.ph && A.phAll && A.n > 0, `no kit: every box (${A.n}) is a grey placeholder`);
  check(A.exact, 'no kit: the placeholders have the exact footprints and heights of the boxes (E7, H5)');
  check(A.others === 0, 'no kit: nothing else is placed (house.js covers it)', A.others);
  check(A.inGroup && A.isLevelKit, 'furnish adds its group to level.group and becomes level.kit');
  check(A.wardrobe === null && A.exitNull === null, 'no kit: wardrobe() and exit() give null (level.js keeps its own)');
  blocked = false;
  const B = await q.evaluate(async () => {
    const kit = await Kit.want('concrete', 'lo'), u = window.__up, old = u.R;
    // the floor's walls as js/arch.js builds them without the kit (E7): every module face keeps its quad
    const walls = Arch.walls(u.plan, { skipModules: false, tier: 'low' }); level.group.add(walls.group);
    // 1. by default (walls with their module quads, nothing said): windows and the exit are not swapped in
    const R = Kit.upgradeInPlace(level, u.plan, { tier: 'lo', placeholders: true });
    const ab = __kt.aabbs(R), U = 0.045;
    const sameSolids = R.solids.length === old.solids.length && R.solids.every((s, i) => s.id === old.solids[i].id && ['x0', 'z0', 'x1', 'z1'].every(k => s.box[k] === old.solids[i].box[k])
      && Math.abs(ab[i].min[0] - s.box.x0) <= 0.05 && Math.abs(ab[i].max[0] - s.box.x1) <= 0.05 && Math.abs(ab[i].min[2] - s.box.z0) <= 0.05 && Math.abs(ab[i].max[2] - s.box.z1) <= 0.05);
    const boardsNow = level.group.children.filter(o => o.children.some(c => /^Board(Short|Long)/.test(c.name)));
    const wards = closets.map(c => c.doors && c.doors[0].pivot.parent);
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));      // (a couple of frames with the new pieces in the game)
    const r1 = { kit: !!kit, ph: R.placeholder, levelKit: level.kit === R, oldGone: old.group.parent === null && old.disposed, newIn: R.group.parent === level.group, sameSolids,
      boards: boardsNow.length === u.boards.length && u.boards.every(o => boardsNow.includes(o)), paintings: level.paintings === u.paintings, doll: scares.doll === u.doll,
      wards: closets.length > 0 && wards.every((g, k) => g && g !== u.wards[k] && g.userData.kit && g.userData.kit.kind === 'wardrobe' && g.parent === level.group),
      hinges: closets.every(c => c.doors.length === 2 && c.doors.every(d => Math.abs(Math.abs(d.pivot.position.x) - 0.575) < 1e-9 && Math.abs(d.pivot.position.z - 0.305) < 1e-9)),
      keptDoor: level.door === u.door && !level.door.kit, noWindows: !R.items.some(x => x.kind === 'window'), planWindows: (u.plan.windows || []).length,
      lights: __kt.lights(scene) === u.lights0, kitCount: R.kitCount, oldCount: old.kitCount };
    // 2. with the walls given: windows and the exit go in, and the quads of the faces they cover are collapsed
    const degenerate = fi => walls.faceVerts[fi].parts.filter(pt => pt.group !== 'upper' && pt.count).every(pt => {
      const pa = walls.meshes[pt.mesh].geometry.attributes.position;
      for (let k = pt.first; k < pt.first + pt.count; k++) if (pa.getX(k) !== pa.getX(pt.first) || pa.getY(k) !== pa.getY(pt.first) || pa.getZ(k) !== pa.getZ(pt.first)) return false;
      return true; });
    const R2 = await Kit.upgradeAsync(level, u.plan, { tier: 'lo', placeholders: true, walls });
    const winFaces = R2.items.filter(x => x.kind === 'window').map(x => x.face), md = (u.plan.modules || []).find(m => m.kind === 'exit'), exitFace = md ? md.face : -1;
    const covered = new Set(winFaces.concat(exitFace >= 0 ? [exitFace] : []));
    const other = u.plan.faces.findIndex((f, i) => !f.skip && !covered.has(i) && walls.faceVerts[i].parts.some(pt => pt.group !== 'upper' && pt.count));
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const r2 = { async: R2 && level.kit === R2 && R.disposed, windows: winFaces.length, collapsed: R2.collapsed, winGone: winFaces.every(degenerate), exitFace,
      exitGone: exitFace < 0 || degenerate(exitFace), otherKept: other >= 0 && !degenerate(other),
      door: level.door !== u.door && level.door.kit === true && typeof level.door.setOpen === 'function' && level.door.group.parent === level.group && u.door.door.parent === null };
    return Object.assign(r1, { r2 });
  });
  check(B.kit && !B.ph && B.levelKit && B.newIn && B.oldGone, 'upgradeInPlace: the kit arrives, the placeholders are swapped for kit pieces (the old group removed and disposed)', B);
  check(B.sameSolids, 'upgradeInPlace: the same solids, each still on its box');
  check(B.boards && B.paintings && B.doll, 'upgradeInPlace: boards, level.paintings and scares.doll are untouched (never a rebuild)', [B.boards, B.paintings, B.doll]);
  check(B.wards && B.hinges, 'upgradeInPlace: the wardrobes become kit wardrobes with the same hinges', [B.wards, B.hinges]);
  check(B.keptDoor && B.noWindows, `upgradeInPlace on walls that still have their module quads: no windows (plan has ${B.planWindows}) and the old exit door stays (no z-fighting)`, B);
  check(B.lights, 'upgradeInPlace: the number of lights in the scene is unchanged (H12)');
  const B2 = B.r2;
  check(B2.async, 'upgradeAsync: compiles first, then swaps (level.kit is the new R, the old one disposed)', B2);
  check(B2.door && B2.exitFace >= 0 && B2.exitGone, 'upgrade with opts.walls: the exit door becomes the kit door and its face quad is collapsed', B2);
  check(B2.winGone && (B.planWindows === 0 || B2.windows > 0), `upgrade with opts.walls: ${B2.windows} windows placed, their face quads collapsed (${B2.collapsed} parts)`, B2);
  check(B2.otherKept, 'upgrade with opts.walls: other faces keep their quads', B2);
  console.log(`  (upgrade: ${B.oldCount} -> ${B.kitCount} kit pieces)`);
  await q.context().close();
}

/* ---------- wardrobes and the exit door: level.js's contracts ---------- */
for (const style of STYLES) {
  const W = await p.evaluate(async style => {
    await Kit.want(style, 'lo');
    const c = { x: closets[0].x, y: closets[0].y, ox: closets[0].ox, oy: closets[0].oy }, c2 = Object.assign({}, c);
    const g = Kit.wardrobe(c, style, { tier: 'lo', placeholders: true }); if (!g) return null;
    const wt = wardrobeMaterials(), ref = makeWardrobe(c2, wt);
    g.updateMatrixWorld(true);
    const doors = c.doors.map(d => ({ side: d.side, open: d.open, pivot: d.pivot.isObject3D, leaf: d.leaf.isObject3D, x: d.pivot.position.x, z: d.pivot.position.z }));
    // each leaf reaches from its hinge to the middle, and swings out of the wardrobe (+z) the way render.js turns it
    const span = c.doors.map(d => { const bx = new THREE.Box3(); d.leaf.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(); d.leaf.traverse(o => { if (o.isMesh) bx.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); });
      d.pivot.rotation.y = d.side * 1 * 1.9; g.updateMatrixWorld(true);
      const bo = new THREE.Box3(); d.leaf.traverse(o => { if (o.isMesh) bo.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); });
      d.pivot.rotation.y = 0; return [bx.min.x, bx.max.x, bo.getCenter(new THREE.Vector3()).z]; });
    const out = { doors, swingT: c.swingT, pos: g.position.toArray(), rot: g.rotation.y, refPos: ref.position.toArray(), refRot: ref.rotation.y, span,
      none: Kit.wardrobe(Object.assign({}, c), style, { kit: null }), strict: Kit.wardrobe(Object.assign({}, c), style, { tier: 'lo', placeholders: false }) === null };
    for (const t of [wt.sideMat, wt.innerMat, wt.leafR, wt.leafL]) { if (t.map) t.map.dispose(); t.dispose(); } wt.geo.dispose(); wt.crown.dispose(); wt.leafGeo.dispose();
    // the exit door: level.door's fields, the boards drop (0.4 s), then the leaf swings out to 1.75 rad (1.6 s)
    const e = Kit.exit(style, { tier: 'lo', placeholders: true, plan: Dress.plan(Dress.envFromGame()) });
    if (!e) return Object.assign(out, { exit: null });
    const D = e.door, q0 = D.leaf.quaternion.clone(), y0 = D.boards ? D.boards.position.y : 0;
    const fields = ['door', 'lamp', 'lockedMat', 'openMat', 'open', 'setOpen'].every(k => k in D) && D.open === false && !!D.lamp.material.color;
    D.setOpen(true, 0.2); const a1 = D.leaf.quaternion.angleTo(q0), y1 = D.boards ? D.boards.position.y : 0;
    D.setOpen(true, 0.3); D.setOpen(true, 0.8); const a2 = D.leaf.quaternion.angleTo(q0);
    for (let k = 0; k < 20; k++) D.setOpen(true, 0.1);
    const a3 = D.leaf.quaternion.angleTo(q0); e.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(e.group.matrixWorld).invert(), lb = new THREE.Box3();
    D.door.traverse(o => { if (o.isMesh) lb.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); });
    D.dispose();
    return Object.assign(out, { exit: { fields, a1, a2, a3, dropped: D.boards ? y0 - y1 : null, open: D.open, leafZ: lb.max.z, exitNull: Kit.exit(style, { kit: null }) === null } });
  }, style);
  if (!W) { check(false, `${style}: Kit.wardrobe builds from the kit`); continue; }
  check(W.doors.length === 2 && W.doors.every(d => d.pivot && d.leaf && d.open === 0 && (d.side === 1 || d.side === -1)) && W.swingT === -1,
    `${style}: wardrobe c.doors = [{pivot, leaf, side, open}] x 2, swingT -1`, W.doors);
  check(W.doors.every(d => d.x === d.side * 0.575 && d.z === 0.305), `${style}: wardrobe hinges exactly at x = ±0.575, z = 0.305`, W.doors.map(d => [d.x, d.z]));
  check(W.pos.every((v, k) => Math.abs(v - W.refPos[k]) < 1e-9) && Math.abs(W.rot - W.refRot) < 1e-9, `${style}: the wardrobe stands where makeWardrobe puts it`, [W.pos, W.refPos]);
  check(W.span.every(([a, c], k) => k === 0 ? Math.abs(a + 0.575) < 0.01 && Math.abs(c) < 0.01 : Math.abs(a) < 0.01 && Math.abs(c - 0.575) < 0.01) && W.span.every(s => s[2] > 0.305),
    `${style}: each leaf reaches from its hinge to the middle and swings outward`, W.span);
  check(W.none === null && W.strict, `${style}: wardrobe() is null without a kit (and for grey stand-ins with placeholders: false)`);
  if (!W.exit) { check(false, `${style}: Kit.exit builds from the kit`); continue; }
  const E = W.exit;
  check(E.fields, `${style}: exit door has level.door's fields {door, lamp, lockedMat, openMat, open, setOpen}`);
  check(E.a1 < 1e-6 && (E.dropped === null || E.dropped > 0), `${style}: exit boards drop first (the leaf still shut at 0.2 s)`, [E.a1, E.dropped]);
  check(E.a2 > 0.05 && E.a2 < 1.75 && Math.abs(E.a3 - 1.75) < 1e-3 && E.open, `${style}: then the leaf swings to 1.75 rad (done by 2.0 s)`, [E.a2, E.a3]);
  check(E.leafZ < 0.05, `${style}: the leaf swings outward, away from the room`, E.leafZ);
  check(E.exitNull, `${style}: exit() is null without a kit`);
}

/* ---------- the exit leaf keeps each of its materials (wood, brass...) as its own copy ---------- */
{
  const X = await p.evaluate(() => {
    const mk = (w, h, d, col, name) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(w / 2, h / 2, 0); g.computeBoundingBox(); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: col, name })); m.name = name; return m; };
    const root = new THREE.Group(); root.name = 'Exit_wood';
    const leaf = new THREE.Group(); leaf.name = 'Exit_leaf_wood'; leaf.position.set(-0.575, 0, 0);
    const wood = mk(1.15, 2.3, 0.05, 0x553311, 'LeafWood'), brass = mk(0.05, 0.05, 0.08, 0xccaa33, 'LeafBrass'); brass.position.set(1.0, 1.0, 0.03);
    leaf.add(wood); leaf.add(brass); root.add(leaf);
    const kit = { style: 'wood', tier: 'lo', scene: root, common: null, nodes: { Exit_wood: root }, node: () => null, has: () => true, isPlaceholder: () => false, prims: new Map(), emitMats: new Map() };
    const e = Kit.exit('wood', { kit, plan: { modules: [{ kind: 'exit', pos: [10, 0, 10], ry: 0, face: -1 }] } });
    const mats = []; e.door.leaf.traverse(o => { if (o.isMesh) mats.push(o.material); });
    let disposed = 0; for (const m of mats) m.addEventListener('dispose', () => disposed++);
    const r = { names: mats.map(m => m.name + ':' + m.color.getHexString()), copies: mats.every(m => m !== wood.material && m !== brass.material), doorMesh: !!e.door.door.isMesh,
      locked: e.door.lockedMat === e.door.door.material && e.door.lockedMat.name === 'LeafWood' && e.door.openMat === e.door.lockedMat };
    e.door.dispose(); r.disposed = disposed; r.n = mats.length; return r;
  });
  check(X.names.sort().join() === 'LeafBrass:ccaa33,LeafWood:553311' && X.copies, 'exit leaf: each source material gets its own copy (the brass handle stays brass)', X.names);
  check(X.doorMesh && X.locked, 'exit: level.door.door is the leaf\'s biggest mesh, lockedMat = openMat = its material copy');
  check(X.disposed === X.n, 'exit: door.dispose() frees every material copy', X);
}

/* ---------- a floor's kit pieces are freed with the floor (disposeLevel's traversal skips userData.kit) ---------- */
{
  const F = await p.evaluate(async () => {
    const kit = await Kit.want('workshop', 'lo');
    bb.startFloor(4);
    await new Promise(res => { const w = () => (bb.level && bb.level.grid === bb.grid ? res() : requestAnimationFrame(w)); w(); });
    const plan = Dress.plan(Dress.envFromGame());
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 400); sc.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1));
    cam.position.set(GW * 1.125, 60, GH * 1.125); cam.lookAt(GW * 1.125, 0, GH * 1.125); cam.updateMatrixWorld(true);
    // disposeLevel as level.js does it: take the group out of the scene, then free what isn't shared or the kit's
    const disposeLevelLike = lv => { sc.remove(lv.group); const seen = new Set();
      lv.group.traverse(o => { const u = o.userData; if (u.shared || u.sharedGeo || u.kit) return; if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); m.dispose(); } });
      if (lv.door) { lv.door.openMat.dispose(); lv.door.lockedMat.dispose(); } };
    const cycle = () => {
      const lv = { group: new THREE.Group(), door: null }; sc.add(lv.group);
      const R = Kit.furnish(lv, plan, { tier: 'lo', evict: false });
      const e = Kit.exit('workshop', { tier: 'lo', plan, level: lv }); if (e) { lv.group.add(e.group); lv.door = e.door; }
      renderer.info.reset(); renderer.render(sc, cam);
      const during = renderer.info.memory.geometries;
      disposeLevelLike(lv); renderer.render(sc, cam);
      return { during, after: renderer.info.memory.geometries, disposed: R.disposed, batches: R.owned.length,
        // H22: every batch (instances, emissive parts, cords) within one 6x6-tile chunk
        chunkBad: R.owned.filter(x => x.isInstancedMesh).filter(im => { const m = new THREE.Matrix4(), ks = new Set();
          for (let j = 0; j < im.count; j++) { im.getMatrixAt(j, m); ks.add(Math.floor(m.elements[12] / 13.5) + ',' + Math.floor(m.elements[14] / 13.5)); } return ks.size > 1; }).map(im => im.name) };
    };
    renderer.render(sc, cam); const base0 = renderer.info.memory.geometries;
    const c1 = cycle(), c2 = cycle(), c3 = cycle();       // (the first uploads the kit's own geometry, which stays: H21)
    return { kit: !!kit, base0, c1, c2, c3 };
  });
  check(F.kit && F.c2.disposed && F.c2.during > F.c2.after, `floor left: furnish's pieces are freed by themselves when disposeLevel removes level.group (${F.c2.during} -> ${F.c2.after} GPU geometries)`, F);
  check(F.c3.after === F.c2.after && F.c2.after === F.c1.after, 'floor after floor: GPU geometries come back to the same count (nothing leaks)', [F.c1, F.c2, F.c3].map(c => [c.during, c.after]));
  check(F.c1.chunkBad.length === 0, 'every instanced batch, emissive parts and cords too, stays within one 6x6-tile chunk (H22)', F.c1.chunkBad);
}

/* ---------- memory: release() and evict() throw kits away ---------- */
{
  const M = await p.evaluate(async () => {
    const k = await Kit.want('tile', 'lo'); const geos = new Set(), mats = new Set(), texs = new Set(), common = [];
    k.scene.traverse(o => { if (o.geometry) geos.add(o.geometry); for (const m of [].concat(o.material || [])) { mats.add(m); for (const key in m) if (m[key] && m[key].isTexture) texs.add(m[key]); } });
    k.common.traverse(o => { if (o.geometry) common.push(o.geometry); });
    let gd = 0, md = 0, td = 0, cd = 0;
    geos.forEach(g => g.addEventListener('dispose', () => gd++)); mats.forEach(m => m.addEventListener('dispose', () => md++)); texs.forEach(t => t.addEventListener('dispose', () => td++));
    common.forEach(g => g.addEventListener('dispose', () => cd++));
    const n = Kit.release('tile');
    const r = { n, geos: geos.size, mats: mats.size, texs: texs.size, gd, md, td, cd, ready: Kit.ready('tile', 'lo'), get: Kit.get('tile', 'lo') };
    // evict: keep wood at lo (and lo's common pieces), everything else goes
    await Kit.want('attic', 'lo'); Kit.evict(['wood'], 'lo');
    r.left = Kit.files().filter(f => f.state === 'done').map(f => f.tier + '/' + f.name).sort();
    r.woodReady = Kit.ready('wood', 'lo'); r.atticReady = Kit.ready('attic', 'lo'); r.mdReady = Kit.ready('wood', 'md');
    const again = await Kit.want('tile', 'lo'); r.again = !!again && Kit.ready('tile', 'lo');
    // keep(): pinned styles (the lobby gate's floors) survive eviction until keep() changes
    await Kit.want('attic', 'lo'); Kit.keep(['attic']); Kit.evict(['wood'], 'lo'); r.pinned = Kit.ready('attic', 'lo') && Kit.ready('wood', 'lo') && !Kit.ready('tile', 'lo');
    Kit.keep([]); Kit.evict(['wood'], 'lo'); r.unpinned = !Kit.ready('attic', 'lo');
    return r;
  });
  check(M.n >= 1 && M.gd === M.geos && M.md === M.mats && M.td === M.texs && M.cd === 0, `release('tile') disposes its ${M.geos} geometries, ${M.mats} materials, ${M.texs} textures (not the common pieces)`, M);
  check(!M.ready && M.get === null, 'after release the kit is gone (ready false, get null)');
  check(M.left.join() === 'lo/common,lo/wood' && M.woodReady && !M.atticReady && !M.mdReady, 'evict([wood], lo) keeps only wood and the common pieces at lo', M.left);
  check(M.again, 'a released kit loads again on the next want()');
  check(M.pinned && M.unpinned, 'Kit.keep([attic]): eviction keeps attic until keep() changes (E4 lobby gate vs E5)', M);
}

/* ---------- the URL flag ?kit=off ---------- */
{
  const r = await p.evaluate(async () => { history.replaceState(null, '', location.pathname + '?kit=off'); const k = await Kit.want('wood', 'lo'), g = Kit.get('wood', 'lo');
    history.replaceState(null, '', location.pathname); return { k, g }; });
  check(r.k === null && r.g === null, '?kit=off: no kit (placeholders and the procedural house)');
}

console.log('\n  draws/instancing per floor:\n' + sums.map(s => `    ${s.tag}: ${s.instanced} batches, ${s.instances} instances, ${s.draws} kit draws in all, ${s.calls} in view, ${s.tris} triangles`).join('\n'));
check(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 3));
await b.close();
process.exit(summary());
