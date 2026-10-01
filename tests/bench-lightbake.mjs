// Light baker bench and checks (node only, no browser): a synthetic Workshop-sized house (21 x 33 tiles: a random 1-tile maze,
// a few halls, 40 lamps of which 10 flicker, 6 windows, tall and low boxes) baked by js/lightbake.js at hi / md / lo.
// Asserts: hi within 250 ms (the best of N warm runs: other processes on this machine only ever add time, so the median, process
// CPU time and load average are printed beside it rather than gated), the same input bakes the same bytes, map sizes per spec C4
// (and the atlas is provably the smallest that fits), packAtlas gives bake()'s cells when handed the same heights, no lamp light
// through a wall tile, flicker light only inside the flicker lamps' discs (and their flickId tiles), a tall box shadows the floor
// while a low box leaves the ceiling alone, moon patches only from moonlit windows; edge cases: lamps on tile edges, wall fixtures
// without a mount, pinched corners, ceiling height steps, flicker group ids and colours, non-finite records.
// Also times a 4-player Workshop (60 lamps, 16 flicker): reported against the budget, gated only at F4's 3x allowance.
// Usage: node tests/bench-lightbake.mjs [--no-dump] [--runs=5]      PNG dumps go to $LB_DUMP or /tmp/claude-0/map/lightbake/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = process.argv.includes('--no-dump') ? null : process.env.LB_DUMP || '/tmp/claude-0/map/lightbake';
const RUNS = +(process.argv.find(a => a.startsWith('--runs=')) || '--runs=5').slice(7);
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/lightbake.js'), 'utf8'), { filename: 'js/lightbake.js' });
const LB = globalThis.LightBaker, L = 2.25, U = 0.045, E_MAX = LB.E_MAX;

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const rng = s => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const fnv = bufs => { let h = 0x811c9dc5; for (const b of bufs) for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619); return (h >>> 0).toString(16); };
const srgbToLin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/* ---------- synthetic fixture profiles and window cookies (stand-ins for textures/light/*) ---------- */
function makeProfile(fn) {
  const w = 64, h = 32, d = new Float32Array(w * h * 3); let sum = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const th = (j + 0.5) / h * Math.PI, ph = (i + 0.5) / w * 2 * Math.PI - Math.PI, v = fn(th, ph);
    d.set([v[0], v[1], v[2]], (j * w + i) * 3); sum += (v[0] + v[1] + v[2]) / 3;
  }
  const m = sum / (w * h); for (let k = 0; k < d.length; k++) d[k] /= m;
  return { w, h, rgb: d, k0: 2 };
}
const profiles = {
  // a pleated pink shade on a wall plate: open top and bottom, dim through the fabric, nothing into the wall, a scalloped hem
  sconce_shade: makeProfile((th, ph) => { const back = Math.abs(ph) > 1.75 ? 0.04 : 1, dn = th > 2.3 ? 1.6 : th < 0.75 ? 1.1 : 0.32 + 0.1 * Math.cos(ph * 12);
    return [dn * back, dn * back * (th > 0.75 && th < 2.3 ? 0.8 : 1), dn * back * (th > 0.75 && th < 2.3 ? 0.85 : 1)]; }),
  // an enamel shade: light pours down, little sideways, none up
  green_shade: makeProfile(th => { const c = -Math.cos(th), v = c > 0.35 ? 0.2 + 2.2 * c * c : c > 0 ? 0.25 * c : 0.02; return [v, v, v]; }),
};
function makeCookie() {                                    // a sash window: 2 x 3 panes behind lace
  const w = 64, h = 64, d = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = (i + 0.5) / w, v = (j + 0.5) / h, bar = Math.abs(u - 0.5) < 0.03 || Math.abs(v - 0.34) < 0.025 || Math.abs(v - 0.67) < 0.025;
    const lace = 0.75 + 0.2 * Math.sin(u * 60) * Math.sin(v * 60);
    d[j * w + i] = bar ? 0 : Math.round(255 * lace);
  }
  return { w, h, data: d };
}
const cookies = { sash_0: makeCookie(), sash_30: makeCookie() };

/* ---------- the synthetic house ---------- */
function house(seed, nLamps = 40, nFlick = 10) {
  const R = rng(seed), GW = 21, GH = 33, CW = 10, CH = 16, g = new Uint8Array(GW * GH).fill(1), at = (x, y) => y * GW + x;
  const seen = new Uint8Array(CW * CH), st = [[0, 0]]; seen[0] = 1; g[at(1, 1)] = 0;
  while (st.length) {                                      // recursive backtracker over cells (odd, odd)
    const [cx, cy] = st[st.length - 1], nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => { const x = cx + dx, y = cy + dy; return x >= 0 && y >= 0 && x < CW && y < CH && !seen[y * CW + x]; });
    if (!nb.length) { st.pop(); continue; }
    const [dx, dy] = nb[Math.floor(R() * nb.length)], x = cx + dx, y = cy + dy; seen[y * CW + x] = 1;
    g[at(2 * cx + 1 + dx, 2 * cy + 1 + dy)] = 0; g[at(2 * x + 1, 2 * y + 1)] = 0; st.push([x, y]);
  }
  for (let k = 0; k < 30; k++) {                           // a few loops
    const x = 1 + Math.floor(R() * (GW - 2)), y = 1 + Math.floor(R() * (GH - 2)); if ((x + y) % 2 === 1) g[at(x, y)] = 0;
  }
  const halls = [[7, 9, 11, 13, 4.5, 0], [11, 19, 15, 23, 3.9, 1], [3, 25, 5, 29, 4.2, 0]];   // tx0 ty0 tx1 ty1 ceil gable
  for (const [x0, y0, x1, y1] of halls) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[at(x, y)] = 0;
  const ceil = new Float32Array(GW * GH).fill(3.4), gables = [];
  for (const [x0, y0, x1, y1, c, gab] of halls) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ceil[at(x, y)] = gab ? 2.6 : c;
    if (gab) gables.push({ tx0: x0, ty0: y0, tx1: x1, ty1: y1, eave: 2.6, ridge: c, alongY: 1 });
  }
  const isW = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || g[at(x, y)] === 1;
  const faces = LB.facesFromGrid(g, GW, GH, L);
  // boxes (game units): in hall 1 a tall cabinet against the north wall, a freestanding tall shelf and a low workbench; more in hall 2/3
  const T = 50, box = (tx, ty, ox, oy, w, d, h, occ) => ({ x0: (tx * T + ox), y0: (ty * T + oy), x1: (tx * T + ox + w), y1: (ty * T + oy + d), h, occ });
  const solids = [
    box(8, 9, 10, 0, 30, 13, 2.0, 'tall'), box(10, 11, 30, 8, 30, 12, 1.9, 'tall'), box(9, 12, 20, 25, 34, 14, 1.2, 'low'),
    box(12, 20, 25, 14, 13, 34, 2.1, 'tall'), box(14, 22, 5, 30, 30, 15, 1.1, 'low'), box(4, 26, 30, 20, 20, 20, 0.8, 'none'),
    box(3, 28, 0, 10, 13, 30, 1.8, 'tall'),
  ];
  // lamps: pendants over hall tiles and some corridor cells, sconces on faces; nFlick of them flicker, 2 dead, 1 practical glow
  const fixtures = [], usedF = new Set();
  const pend = (x, y) => fixtures.push({ x: (x + 0.5) * L, y: ceil[at(x, y)] - 0.63, z: (y + 0.5) * L, nx: 0, nz: 0, profile: R() < 0.5 ? 'green_shade' : 'bare_bulb', color: [1, 0.86, 0.62], state: 'ok' });
  const sconce = f => fixtures.push({ x: (f.x0 + f.x1) / 2 + f.nx * 0.2, y: 1.95, z: (f.z0 + f.z1) / 2 + f.nz * 0.2, nx: f.nx, nz: f.nz, profile: 'sconce_shade', color: [1, 0.74, 0.62], state: 'ok' });
  pend(9, 11); pend(13, 21); pend(4, 27); pend(9, 9);
  const cells = []; for (let y = 1; y < GH; y += 2) for (let x = 1; x < GW; x += 2) cells.push([x, y]);
  while (fixtures.length < Math.round(nLamps * 0.45)) { const [x, y] = cells[Math.floor(R() * cells.length)]; if (!fixtures.some(f => Math.abs(f.x - (x + 0.5) * L) < 0.1 && Math.abs(f.z - (y + 0.5) * L) < 0.1)) pend(x, y); }
  while (fixtures.length < nLamps) { const k = Math.floor(R() * faces.length); if (usedF.has(k)) continue; usedF.add(k); sconce(faces[k]); }
  for (let k = 0, n = 0; n < nFlick; k = (k + 7) % nLamps) { if (fixtures[k].state === 'ok') { fixtures[k].state = 'flicker'; n++; } }
  fixtures[5].state = 'dead'; fixtures[33].state = 'dead'; fixtures[20].state = 'glow';
  // windows on border faces: 3 north (facing the moon), 1 south, 1 west, 1 east
  const border = f => { const bx = f.x - f.nx, by = f.y - f.nz; return bx === 0 || by === 0 || bx === GW - 1 || by === GH - 1; };
  const pick = (pred, n) => { const out = []; for (let k = 0; k < faces.length && out.length < n; k++) { const f = faces[k]; if (border(f) && pred(f) && !usedF.has(k) && !out.some(q => Math.hypot(faces[q].x - f.x, faces[q].y - f.y) < 4)) out.push(k); } return out; };
  const wf = [...pick(f => f.nz === 1, 3), ...pick(f => f.nz === -1, 1), ...pick(f => f.nx === 1, 1), ...pick(f => f.nx === -1, 1)];
  const windows = wf.map((k, i) => ({ face: k, type: i % 2 ? 'tall' : 'sash', u0: 0.255, u1: 0.745, v0: 0.8, v1: 2.65 }));
  const moon = { az: Math.PI + 0.15, el: 35 * Math.PI / 180, color: [0.56, 0.65, 0.85] };
  return { GW, GH, grid: g, L, ceil, gables, solids, faces, fixtures, windows, moon, profiles, cookies, albedo: { floor: [0.34, 0.27, 0.2], wall: 0.5, ceil: 0.6 }, isW };
}

/* ---------- PNG writer (node zlib, no dependencies) ---------- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png(file, w, h, px, ch) {                         // px: w*h*ch bytes (ch 1 grey, 3 RGB)
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * ch + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * w * ch, w * ch).copy(raw, y * (w * ch + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 3 ? 2 : 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
const channel = (m, c) => { const o = new Uint8Array(m.w * m.h); for (let k = 0; k < o.length; k++) o[k] = m.data[k * 4 + c]; return o; };
const rgbOf = m => { const o = new Uint8Array(m.w * m.h * 3); for (let k = 0; k < m.w * m.h; k++) { o[k * 3] = m.data[k * 4]; o[k * 3 + 1] = m.data[k * 4 + 1]; o[k * 3 + 2] = m.data[k * 4 + 2]; } return o; };

/* ---------- run ---------- */
const H = house(20261001), inp = { ...H };
console.log(`house ${H.GW} x ${H.GH} tiles, ${H.faces.length} faces, ${H.fixtures.length} fixtures (${H.fixtures.filter(f => f.state === 'flicker').length} flicker), ${H.windows.length} windows, ${H.solids.length} boxes`);

// 1. timing. Other processes (browser tests with software WebGL) can share this machine, which only ever adds time, so the check
// uses the best of the warm runs and the median, CPU time and load average are printed next to it.
const budget = { hi: 250, md: 150, lo: 80 }, res = {}, load = () => fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
console.log(`load average before: ${load()} (${(await import('node:os')).cpus().length} cores)`);
{ const t = performance.now(); LB.warm(); console.log(`LightBaker.warm() (tables + a tiny bake, meant for boot): ${(performance.now() - t).toFixed(0)} ms`); }
for (const tier of ['hi', 'md', 'lo']) {
  const t0 = performance.now(); const cold = LB.bake(inp, tier); const coldMs = performance.now() - t0;
  const runs = [], cpu = []; let last = cold, best = null;
  for (let k = 0; k < RUNS; k++) {
    const c = process.cpuUsage(), t = performance.now(); last = LB.bake(inp, tier); const ms = performance.now() - t, cu = process.cpuUsage(c);
    runs.push(ms); cpu.push((cu.user + cu.system) / 1000); if (!best || ms < best.ms) best = { ms, st: last.stats.ms };
  }
  const sr = [...runs].sort((a, b) => a - b), sc = [...cpu].sort((a, b) => a - b), med = sr[sr.length >> 1];
  res[tier] = last;
  console.log(`${tier}: first bake ${coldMs.toFixed(0)} ms | warm best ${sr[0].toFixed(0)} ms, median ${med.toFixed(0)}, max ${sr[sr.length - 1].toFixed(0)} | process CPU median ${sc[sc.length >> 1].toFixed(0)} ms | budget ${budget[tier]}`);
  console.log(`   best run: ` + Object.entries(best.st).map(([k, v]) => `${k} ${v}`).join(', '));
  if (tier === 'hi') ok(sr[0] <= budget.hi, `hi bake ${sr[0].toFixed(0)} ms <= 250 ms (best of ${RUNS} warm runs; median ${med.toFixed(0)} ms at load ${load()})`);
  else console.log(`info ${tier} best ${sr[0].toFixed(0)} ms, median ${med.toFixed(0)} ms vs budget ${budget[tier]} ms: ${sr[0] <= budget[tier] ? 'within' : 'OVER'}`);
}
// 1b. a 4-player Workshop: 60 lamps, 16 of them asked to flicker. Reported against the budget, gated only at F4's 3x allowance:
// if WP6 finds such houses over budget on a real desktop, the worker route of spec C3 applies (bake() has no DOM)
{
  const i60 = { ...house(20261001, 60, 16) };
  for (const tier of ['hi', 'md']) {
    LB.bake(i60, tier); const runs = []; let st;
    for (let k = 0; k < RUNS; k++) { const t = performance.now(), r = LB.bake(i60, tier); runs.push(performance.now() - t); st = r.stats; }
    const sr = runs.sort((a, b) => a - b), med = sr[sr.length >> 1], v = x => x <= budget[tier] ? 'within' : 'OVER';
    console.log(`60 lamps ${tier}: warm best ${sr[0].toFixed(0)} ms (${v(sr[0])}), median ${med.toFixed(0)} (${v(med)}) vs budget ${budget[tier]} | lamps ${st.lamps}, flicker ${st.flicker} in ${st.groups} groups, demoted ${st.demoted}, evaluations ${st.evals}, walls ${st.ms.walls} ms`);
    ok(sr[0] <= 3 * budget[tier], `60-lamp ${tier} bake ${sr[0].toFixed(0)} ms <= ${3 * budget[tier]} ms (F4's 3x allowance)`);
  }
}
console.log(`load average after: ${load()}`);
const S = res.hi.stats;
console.log(`hi stats: lamps ${S.lamps} (steady ${S.steady}, flicker ${S.flicker} in ${S.groups} groups, demoted ${S.demoted}, dead ${S.dead}, glow ${S.glow}), moonlit ${S.moonlit}/${S.windows}, atlas ${S.atlas}, plan ${S.plan}, field ${S.field}, texel-lamp evaluations ${S.evals}`);

// 2. determinism
const all = r => ['floorLM', 'floorAux', 'ceilLM', 'ceilAux', 'wallLM', 'wallAux', 'lf0', 'lf1', 'flickId'].map(k => r[k].data);
const h1 = fnv(all(LB.bake(inp, 'hi'))), h2 = fnv(all(LB.bake(inp, 'hi'))), hc = fnv(all(LB.bake(JSON.parse(JSON.stringify({ ...inp, grid: Array.from(inp.grid), ceil: Array.from(inp.ceil), profiles: { sconce_shade: { ...profiles.sconce_shade, rgb: Array.from(profiles.sconce_shade.rgb) }, green_shade: { ...profiles.green_shade, rgb: Array.from(profiles.green_shade.rgb) } }, cookies: { sash_0: { ...cookies.sash_0, data: Array.from(cookies.sash_0.data) }, sash_30: { ...cookies.sash_30, data: Array.from(cookies.sash_30.data) } } })), 'hi')));
ok(h1 === h2, `two hi bakes hash the same (${h1})`);
ok(h1 === hc, `the same input through JSON (plain arrays) hashes the same (${hc})`);

// 3. sizes (C4)
const C4 = { hi: [20, 20, 8], md: [12, 12, 8], lo: [8, 6, 4] }, ATL = ['512x512', '1024x512', '1024x1024', '2048x1024', '2048x2048'];
for (const tier of ['hi', 'md', 'lo']) {
  const r = res[tier], [pp, wp, fp] = C4[tier], P = Math.round(L * pp), Pf = Math.round(L * fp);
  const sz = m => `${m.w}x${m.h}`, okLen = m => m.data instanceof Uint8ClampedArray && m.data.length === m.w * m.h * 4;
  ok(['floorLM', 'floorAux', 'ceilLM', 'ceilAux'].every(k => r[k].w === H.GW * P && r[k].h === H.GH * P && okLen(r[k])), `${tier} plan maps ${sz(r.floorLM)} = GW*L*${pp} x GH*L*${pp}`);
  ok(r.lf0.w === H.GW * Pf && r.lf0.h === H.GH * Pf && r.lf1.w === r.lf0.w && okLen(r.lf0) && okLen(r.lf1), `${tier} light field ${sz(r.lf0)} = ${fp} px/m`);
  ok(r.flickId.w === H.GW && r.flickId.h === H.GH && okLen(r.flickId), `${tier} flickId ${sz(r.flickId)} = GW x GH`);
  const A = `${r.wallLM.w}x${r.wallLM.h}`; ok(ATL.includes(A) && sz(r.wallAux) === A && okLen(r.wallLM), `${tier} wall atlas ${A} is one of the allowed sizes`);
  // every cell (L*ppm + 2) x (H*ppm + 2), inside the atlas, no overlaps, the smallest atlas that fits
  const cs = r.wallCells, ppm = r.atlas.ppm; let bad = 0, over = 0;
  cs.forEach((c, i) => { const f = H.faces[i], tile = f.y * H.GW + f.x, gab = H.gables.find(q => f.x >= q.tx0 && f.x <= q.tx1 && f.y >= q.ty0 && f.y <= q.ty1);
    const Hm = gab ? null : H.ceil[tile]; if (c.w !== Math.round(L * ppm) + 2 || (Hm && c.h !== Math.round(Hm * ppm) + 2) || c.x < 0 || c.y < 0 || c.x + c.w > r.wallLM.w || c.y + c.h > r.wallLM.h) bad++; });
  const byRow = [...cs].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < byRow.length; i++) for (let j = i + 1; j < byRow.length && byRow[j].y < byRow[i].y + byRow[i].h; j++) { const a = byRow[i], b = byRow[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) over++; }
  ok(!bad && !over && ppm === wp, `${tier} ${cs.length} wall cells: sizes ${bad ? bad + ' bad' : 'ok'}, ${over} overlaps, ppm ${ppm}`);
  // the smallest that fits, checked independently of the baker's packer: the cells' total area exceeds the next smaller size (so
  // no packing could fit), or else a first-fit shelf packer (never worse than the baker's next-fit one) fails at every smaller size
  const area = cs.reduce((s, c) => s + c.w * c.h, 0), ai = ATL.indexOf(A), prev = ai > 0 ? ATL[ai - 1].split('x').map(Number) : null;
  const ffdh = (W, Hh) => { const sh = []; let top = 0;
    for (const c of [...cs].sort((a, b) => b.h - a.h || b.w - a.w)) { let s = sh.find(q => q.h >= c.h && q.x + c.w <= W);
      if (!s) { if (top + c.h > Hh || c.w > W) return false; sh.push(s = { y: top, h: c.h, x: 0 }); top += c.h; } s.x += c.w; } return true; };
  const why = !prev ? 'it is the smallest allowed size' : area > prev[0] * prev[1] ? `the cells cover ${area} px > ${ATL[ai - 1]} = ${prev[0] * prev[1]}`
    : ATL.slice(0, ai).every(q => !ffdh(...q.split('x').map(Number))) ? `cells cover ${area} px; a first-fit shelf packer fits no smaller size` : null;
  ok(!!why, `${tier} atlas ${A} is the smallest that fits: ${why || 'a smaller size takes these cells'}`);
  // uv1 before the bake: packAtlas with faceHeights(input), or with the input itself, gives exactly bake()'s cells; with no heights
  // and faces without h it refuses
  const same = p => p.W === r.wallLM.w && p.H === r.wallLM.h && p.cells.every((c, i) => ['x', 'y', 'w', 'h', 'lw', 'lh', 'u0', 'v0', 'su', 'sv'].every(k => c[k] === cs[i][k]));
  let threw = ''; try { LB.packAtlas(H.faces, tier); } catch (e) { threw = e.message; }
  ok(same(LB.packAtlas(H.faces, tier, LB.faceHeights(inp))) && same(LB.packAtlas(H.faces, tier, inp)) && same(LB.packAtlas(H.faces.map((f, i) => ({ ...f, h: cs[i].H })), tier)) && /no h/.test(threw),
    `${tier} packAtlas(faces, tier, faceHeights(input) | input | faces with h) = bake's wallCells; without heights it throws ("${threw.slice(0, 40)}...")`);
}
// face heights per spec A10: a flat face its tile's CEIL; a gable face the highest gable point on the face line at u = 0, .14, .5, .86, 1
{
  const hs = LB.faceHeights(inp); let bad = 0, gab = 0;
  H.faces.forEach((f, i) => { const q = H.gables.find(g => f.x >= g.tx0 && f.x <= g.tx1 && f.y >= g.ty0 && f.y <= g.ty1); let want;
    if (!q) want = H.ceil[f.y * H.GW + f.x];
    else { gab++; const c = (q.tx0 + q.tx1 + 1) * L / 2, hw = (q.tx1 - q.tx0 + 1) * L / 2; want = Math.max(...[0, 0.14, 0.5, 0.86, 1].map(u => q.eave + (q.ridge - q.eave) * Math.max(0, 1 - Math.abs(f.x0 + (f.x1 - f.x0) * u - c) / hw))); }
    if (Math.abs(hs[i] - want) > 1e-6) bad++; });
  ok(!bad && gab > 0, `faceHeights follow spec A10 on all ${hs.length} faces (${gab} under a gable), ${bad} differ`);
}

// 4. no lamp light through a wall tile: one sconce alone; texels behind its wall tile that no straight ray can reach stay at 0
const wallHit = (ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.01); for (let k = 1; k < n; k++) { const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n; if (H.isW(Math.floor(x / L), Math.floor(z / L))) return true; } return false; };
{
  let done = false;
  for (const f of H.fixtures) {
    if (f.nx === 0 && f.nz === 0) continue;
    const tx = Math.floor(f.x / L), ty = Math.floor(f.z / L), wx = tx - f.nx, wy = ty - f.nz, bx = tx - 2 * f.nx, by = ty - 2 * f.nz;
    if (!H.isW(wx, wy) || H.isW(bx, by)) continue;
    const one = LB.bake({ ...inp, fixtures: [{ ...f, state: 'ok' }], windows: [], moon: null }, 'hi'), m = one.floorLM, c = one.ceilLM, P = m.w / H.GW;
    let hidden = 0, lit = 0, leaks = 0, ownLit = 0;
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const X = bx * P + i, Y = by * P + j, x = (X + 0.5) * L / P, z = (Y + 0.5) * L / P, d = (Y * m.w + X) * 4;
      const reach = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3]].some(([ox, oz]) => !wallHit(f.x, f.z, x + ox, z + oz));
      if (reach) { lit++; continue; }
      hidden++; if (m.data[d] | m.data[d + 1] | m.data[d + 2] | c.data[d] | c.data[d + 1] | c.data[d + 2]) leaks++;
    }
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) { const d = ((ty * P + j) * m.w + tx * P + i) * 4; if (m.data[d] > 20) ownLit++; }
    ok(hidden > 100 && leaks === 0 && ownLit > P * P / 2, `sconce at tile ${tx},${ty}: ${hidden} texels behind wall tile ${wx},${wy} that no ray reaches, ${leaks} with any floor/ceiling light (own tile lit: ${ownLit}/${P * P})`);
    done = true; break;
  }
  ok(done, 'found a sconce with an open tile behind its wall');
}

// 5. flicker light only inside the flicker lamps' 7 m discs, and only where flickId names that lamp's group
{
  const r = res.hi, gl = H.fixtures.map((f, i) => ({ f, g: r.fixGroup[i] })).filter(q => q.g >= 0);
  const check = (m, pos, label) => {
    let on = 0, bad = 0;
    for (let Y = 0; Y < m.h; Y++) for (let X = 0; X < m.w; X++) {
      const p = pos(X, Y); if (!p) continue; const a = m.data[(Y * m.w + X) * 4 + 3]; if (!a) continue; on++;
      const id = r.flickId.data[(Math.floor(p[2] / L) * H.GW + Math.floor(p[0] / L)) * 4];
      if (!gl.some(q => q.g + 1 === id && Math.hypot(q.f.x - p[0], q.f.y - p[1], q.f.z - p[2]) <= 7.001)) bad++;
    }
    ok(on > 0 && bad === 0, `${label}: ${on} texels carry flicker light, ${bad} outside a flicker disc or its flickId tiles`);
  };
  const plan = (m, y) => (X, Y) => { const x = (X + 0.5) * H.GW * L / m.w, z = (Y + 0.5) * H.GH * L / m.h; return H.isW(Math.floor(x / L), Math.floor(z / L)) ? null : [x, typeof y === 'function' ? y(x, z) : y, z]; };
  check(r.floorLM, plan(r.floorLM, 0), 'floorLM A');
  check(r.lf0, plan(r.lf0, 1.1), 'lf0 A');
  const cellOf = []; r.wallCells.forEach((c, i) => cellOf.push([c, H.faces[i]]));
  check(r.wallLM, (X, Y) => { for (const [c, f] of cellOf) if (X > c.x && X < c.x + c.w - 1 && Y > c.y && Y < c.y + c.h - 1) { const u = (X - c.x - 0.5) / c.lw, y = c.H - (Y - c.y - 0.5) * c.H / c.lh; return [f.x0 + (f.x1 - f.x0) * u + f.nx * 0.01, y, f.z0 + (f.z1 - f.z0) * u + f.nz * 0.01]; } return null; }, 'wallLM A');
  const groupsLit = r.groups.filter(G => { const f = H.fixtures[G.lamps[0]], P = r.floorLM.w / H.GW, X = Math.floor(f.x / L * P), Y = Math.floor(f.z / L * P); return r.floorLM.data[(Y * r.floorLM.w + X) * 4 + 3] > 0; }).length;
  ok(groupsLit === r.groups.length, `every flicker group (${r.groups.length}) has flicker light under its lamp; steady channel there: ${(() => { const G = r.groups[0], f = H.fixtures[G.lamps[0]], P = r.floorLM.w / H.GW, d = (Math.floor(f.z / L * P) * r.floorLM.w + Math.floor(f.x / L * P)) * 4; return r.floorLM.data.slice(d, d + 4).join(','); })()}`);
}

// 6. a tall box shadows the floor behind it; a low box shadows the floor near it but never the ceiling
{
  const GW = 9, GH = 9, g = new Uint8Array(GW * GH).fill(1); for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) g[y * GW + x] = 0;
  const lx = 4.5 * L, lz = 4.5 * L, lamp = { x: lx, y: 2.4, z: lz, nx: 0, nz: 0, state: 'ok', k: 2, color: [1, 1, 1] };
  const base = { GW, GH, grid: g, ceil: 3.2, fixtures: [lamp], moon: null, albedo: { floor: 0 } };   // (no bounce: it would carry the floor's shadow up)
  const bx = (h, occ) => [{ x0: (lx + 1.0) / U, y0: (lz - 0.6) / U, x1: (lx + 1.6) / U, y1: (lz + 0.6) / U, h, occ }];
  const none = LB.bake({ ...base, solids: [] }, 'hi'), tall = LB.bake({ ...base, solids: bx(2.0, 'tall') }, 'hi'), low = LB.bake({ ...base, solids: bx(1.2, 'low') }, 'hi');
  const E = (r, key, dx, dz) => { const m = r[key], P = m.w / GW, X = Math.floor((lx + dx) / L * P), Y = Math.floor((lz + dz) / L * P), d = (Y * m.w + X) * 4; return E_MAX * srgbToLin(m.data[d + 1]); };
  const span = (r, key, a, b) => { let s = 0; for (let d = a; d <= b; d += 0.1) for (const z of [-0.2, 0, 0.2]) s += E(r, key, d, z); return s; };
  const t26 = span(tall, 'floorLM', 2.0, 6.0) / span(none, 'floorLM', 2.0, 6.0), l23 = span(low, 'floorLM', 2.0, 2.8) / span(none, 'floorLM', 2.0, 2.8), l45 = span(low, 'floorLM', 4.0, 5.0) / span(none, 'floorLM', 4.0, 5.0);
  const ceilSame = low.ceilLM.data.every((v, i) => v === none.ceilLM.data[i]);
  const front = span(tall, 'floorLM', -3, -2) / span(none, 'floorLM', -3, -2);
  console.log(`info box shadows: floor E at 1 m from the lamp ${E(none, 'floorLM', 1, 0).toFixed(2)}, below it ${E(none, 'floorLM', 0, 0).toFixed(2)}`);
  ok(t26 < 0.1 && front > 0.99, `tall box: floor 2-6 m behind it keeps ${(t26 * 100).toFixed(1)}% of its light (in front: ${(front * 100).toFixed(1)}%)`);
  ok(l23 < 0.1 && l45 > 0.9, `low box: floor 2-2.8 m behind it keeps ${(l23 * 100).toFixed(1)}%, 4-5 m behind (the ray passes over) ${(l45 * 100).toFixed(1)}%`);
  ok(ceilSame, 'low box: the ceiling map is byte-identical to the bake without it');
  const tallField = span(tall, 'lf0', 2.0, 5.0) / span(none, 'lf0', 2.0, 5.0), onBox = E(tall, 'lf0', 1.3, 0) / E(none, 'lf0', 1.3, 0);
  ok(tallField < 0.15 && onBox > 0.9, `tall box: light field behind it ${(tallField * 100).toFixed(1)}%, on the box itself ${(onBox * 100).toFixed(1)}% (a box doesn't shade itself)`);
}

// 7. moon patches only from moonlit windows (independent trace back to the openings); the others only a faint skylight stamp
{
  const r = res.hi, m = r.floorAux, P = m.w / H.GW, mo = H.moon, ce = Math.cos(mo.el), se = Math.sin(mo.el), mx = Math.sin(mo.az), mz = Math.cos(mo.az);
  const STAMP = Math.ceil(0.15 * 0.7 * 255) + 1;
  const through = (w, x, z) => { const f = H.faces[w.face], dpl = (x - f.x0) * f.nx + (z - f.z0) * f.nz, mn = mx * f.nx + mz * f.nz; if (dpl <= 0 || mn >= 0) return false;
    const t = -dpl / (ce * mn), qx = x + t * ce * mx, qz = z + t * ce * mz, qy = t * se, len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), u = ((qx - f.x0) * (f.x1 - f.x0) + (qz - f.z0) * (f.z1 - f.z0)) / (len * len);
    return u >= w.u0 - 0.02 && u <= w.u1 + 0.02 && qy >= w.v0 - 0.05 && qy <= w.v1 + 0.05; };
  let bright = 0, unexplained = 0; const per = H.windows.map(() => ({ max: 0, n: 0 }));
  for (let Y = 0; Y < m.h; Y++) for (let X = 0; X < m.w; X++) {
    const x = (X + 0.5) / P * L, z = (Y + 0.5) / P * L; if (H.isW(Math.floor(x / L), Math.floor(z / L))) continue;
    const v = m.data[(Y * m.w + X) * 4]; if (!v) continue;
    H.windows.forEach((w, wi) => { const f = H.faces[w.face], a = (x - f.x0) * f.nx + (z - f.z0) * f.nz, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, b = Math.abs((x - cx) * (f.x1 - f.x0) + (z - cz) * (f.z1 - f.z0)) / L;
      const lit = r.moonlit.includes(wi), byLit = r.moonlit.some(q => through(H.windows[q], x, z));
      if (lit ? through(w, x, z) : a > 0 && a < 1.5 && b < 1.2 && !byLit) { per[wi].max = Math.max(per[wi].max, v); if (v >= 64) per[wi].n++; } });
    if (v > STAMP) { bright++; if (!r.moonlit.some(wi => through(H.windows[wi], x, z))) unexplained++; }
  }
  ok(r.moonlit.length >= 2 && r.moonlit.length < H.windows.length, `${r.moonlit.length} of ${H.windows.length} windows face the moon (${r.moonlit.join(',')})`);
  ok(bright > 0 && unexplained === 0, `${bright} floor texels brighter than a skylight stamp, ${unexplained} not traced back to a moonlit window's opening`);
  H.windows.forEach((w, wi) => { const lit = r.moonlit.includes(wi);
    ok(lit ? per[wi].n > 200 : per[wi].max > 0 && per[wi].max <= STAMP, `window ${wi} (${w.type}, face normal ${H.faces[w.face].nx},${H.faces[w.face].nz}) ${lit ? `moonlit: patch of ${per[wi].n} texels, peak E ${(per[wi].max / 255).toFixed(2)}` : `not moonlit: stamp peak ${(per[wi].max / 255).toFixed(3)} <= ${(STAMP / 255).toFixed(3)}`}`); });
  let wallMoon = 0; for (let k = 0; k < r.wallAux.data.length; k += 4) if (r.wallAux.data[k] > STAMP) wallMoon++;
  console.log(`info wall texels with a moon patch: ${wallMoon}; moonDir ${r.moonDir.map(v => v.toFixed(3))}`);
}

// 8. edge cases (small rooms)
{
  const room = (GW, GH) => { const g = new Uint8Array(GW * GH); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!x || !y || x === GW - 1 || y === GH - 1) g[y * GW + x] = 1; return g; };
  const Ep = (m, GW, x, z, R = 0) => {                    // decoded E (green) at a plan point, averaged over (2R+1)^2 texels (the dither)
    const P = m.w / GW / L, X = Math.floor(x * P), Y = Math.floor(z * P); let s = 0;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) s += srgbToLin(m.data[((Y + j) * m.w + X + i) * 4 + 1]);
    return E_MAX * s / (2 * R + 1) ** 2; };
  const lit = (m, GW, tx, tz, ch = [0, 1, 2]) => { const P = m.w / GW; let n = 0;
    for (let Y = tz * P; Y < tz * P + P; Y++) for (let X = tx * P; X < tx * P + P; X++) if (ch.some(c => m.data[(Y * m.w + X) * 4 + c])) n++; return n; };
  const white = { k: 2, color: [1, 1, 1] };

  // a. light centres on a tile edge or corner: a pendant at each corner / edge of a pillar is baked, and the mirror cases match
  {
    const GW = 9, GH = 9, g = room(GW, GH); g[4 * GW + 4] = 1;
    const one = (x, z) => LB.bake({ GW, GH, grid: g, albedo: { floor: 0 }, fixtures: [{ x, y: 2.3, z, nx: 0, nz: 0, ...white }] }, 'md');
    const [a, b, c, d] = [[4 * L, 4 * L], [5 * L, 5 * L], [4 * L, 4.5 * L], [5 * L, 4.5 * L]].map(p => one(...p));
    const ea = Ep(a.floorLM, GW, 4 * L - 0.8, 4 * L - 0.8, 3), eb = Ep(b.floorLM, GW, 5 * L + 0.8, 5 * L + 0.8, 3), ec = Ep(c.floorLM, GW, 4 * L - 0.8, 4.5 * L, 3), ed = Ep(d.floorLM, GW, 5 * L + 0.8, 4.5 * L, 3);
    const sk = [a, b, c, d].reduce((s, r) => s + r.stats.skipped, 0);
    ok([a, b, c, d].every(r => r.stats.lamps === 1) && !sk && Math.abs(ea - eb) <= 0.03 * eb && Math.abs(ec - ed) <= 0.03 * ed && ea > 0.1 && ec > 0.1,
      `pendants on a pillar's corner and edge are all baked (skipped ${sk}); floor 0.8 m out: corner ${ea.toFixed(3)} vs its mirror ${eb.toFixed(3)}, edge ${ec.toFixed(3)} vs ${ed.toFixed(3)}`);
  }
  // b. a wall fixture without a profile mount, origin on its wall plane: the centre goes 0.1 m out for every facing, so its own wall
  // gets E = k cos / d^2 of a light 0.1 m away (sampled 0.5 m along the wall at the lamp's height)
  {
    const GW = 9, GH = 9, g = room(GW, GH), faces = LB.facesFromGrid(g, GW, GH, L), out = [];
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = faces.findIndex(f => f.nx === nx && f.nz === nz && (nx ? f.y === 4 : f.x === 4)), f = faces[k];
      const r = LB.bake({ GW, GH, grid: g, faces, ceil: 3, albedo: { floor: 0 }, fixtures: [{ x: (f.x0 + f.x1) / 2, y: 1.95, z: (f.z0 + f.z1) / 2, nx, nz, ...white }] }, 'hi');
      const c = r.wallCells[k], j = Math.floor((c.H - 1.95) / c.H * c.lh); let got = 0, want = 0;
      for (const i of [Math.floor(c.lw * (0.5 + 0.5 / L)), Math.floor(c.lw * (0.5 - 0.5 / L))]) {
        got += E_MAX * srgbToLin(r.wallLM.data[((c.y + 1 + j) * r.wallLM.w + c.x + 1 + i) * 4 + 1]);
        const lat = Math.abs((i + 0.5) / c.lw - 0.5) * L, dy = 1.95 - (c.H - (j + 0.5) * c.H / c.lh), d2 = 0.01 + lat * lat + dy * dy;
        want += 2 * 0.1 / d2 ** 1.5 * (1 - (d2 / 49) ** 2) ** 2;
      }
      out.push([`n=(${nx},${nz})`, got / 2, want / 2, r.stats.skipped]);
    }
    ok(out.every(([, got, want, sk]) => !sk && Math.abs(got - want) <= 0.05 * want), `wall fixture without a mount, 0.5 m along its own wall: ${out.map(([n, got, want]) => `${n} E ${got.toFixed(3)} (expected ${want.toFixed(3)})`).join(', ')}`);
  }
  // c. a pinched corner (open tiles (2,2) and (3,3) meet only at a corner): no lamp light gets through it to floor, ceiling, field
  // or walls, and the lamp's own side has no dark speck at the corner
  {
    const GW = 8, GH = 8, g = room(GW, GH); g[2 * GW + 3] = 1; g[3 * GW + 2] = 1;
    const faces = LB.facesFromGrid(g, GW, GH, L), f33 = faces.map((f, i) => i).filter(i => faces[i].x === 3 && faces[i].y === 3);
    const msg = [];
    let leak = 0, ratio = 1;
    for (const [lx, lz] of [[2.5 * L, 2.5 * L], [3 * L - 0.3, 3 * L - 0.1]]) {
      const r = LB.bake({ GW, GH, grid: g, faces, ceil: 3, albedo: { floor: 0 }, fixtures: [{ x: lx, y: 2.0, z: lz, ...white }] }, 'hi');
      const nW = f33.reduce((s, i) => { const c = r.wallCells[i]; let n = 0; for (let j = 0; j < c.lh; j++) for (let k = 0; k < c.lw; k++) if (r.wallLM.data[((c.y + 1 + j) * r.wallLM.w + c.x + 1 + k) * 4 + 1]) n++; return s + n; }, 0);
      const n = [lit(r.floorLM, GW, 3, 3), lit(r.ceilLM, GW, 3, 3), lit(r.lf0, GW, 3, 3), nW]; leak += n.reduce((s, v) => s + v, 0);
      msg.push(`lamp (${(lx / L).toFixed(2)}, ${(lz / L).toFixed(2)}) tiles: floor ${n[0]}, ceiling ${n[1]}, field ${n[2]}, wall ${n[3]} texels lit in (3,3)`);
      if (lz !== lx) ratio = Ep(r.floorLM, GW, 3 * L - 0.04, 3 * L - 0.04) / Ep(r.floorLM, GW, 3 * L - 0.3, 3 * L - 0.04);
    }
    ok(!leak && ratio > 0.85, `pinched corner: ${msg.join('; ')}; own floor at the corner / 0.26 m before it ${ratio.toFixed(2)}`);
  }
  // d. a ceiling height step (2.55 m corridor, 3.4 m hall): a corridor lamp leaves the hall ceiling dark where its rays would cross
  // the step quad above 2.55 m, lights it where they pass below, and its floor is byte-identical to a bake without the step
  {
    const GW = 9, GH = 9, g = room(GW, GH), ceil = new Float32Array(GW * GH).map((_, t) => t % GW <= 3 ? 2.55 : 3.4), sx = 4 * L, lx = sx - 1.1, lz = 4.5 * L;
    const base = { GW, GH, grid: g, albedo: { floor: 0 }, fixtures: [{ x: lx, y: 2.0, z: lz, ...white }] };
    const r = LB.bake({ ...base, ceil }, 'hi'), flat = LB.bake({ ...base, ceil: 3.4 }, 'hi');
    const e = [0.5, 1, 1.5, 2.5].map(b => Ep(r.ceilLM, GW, sx + b, lz)), low = Ep(r.ceilLM, GW, lx, lz), sameFloor = r.floorLM.data.every((v, i) => v === flat.floorLM.data[i]);
    ok(e[0] + e[1] + e[2] === 0 && e[3] > 0.02 && low > 0.5 && sameFloor, `ceiling step: hall ceiling 0.5 / 1 / 1.5 m past the step E ${e.slice(0, 3).map(v => v.toFixed(3)).join(' / ')} (rays cross the step above 2.55 m), 2.5 m ${e[3].toFixed(3)} (below), corridor ceiling over the lamp ${low.toFixed(2)}; floor identical to no step: ${sameFloor}`);
  }
  // e. flicker groups: explicit ids are kept free of auto ones, a bad id is demoted and reported, a mixed-colour group gets the
  // k-weighted mean colour (and a warning), different groups closer than 14 m are refused
  {
    const GW = 41, GH = 41, g = room(GW, GH), fl = (x, z, o = {}) => ({ x, y: 2.3, z, state: 'flicker', ...o });
    const a = LB.bake({ GW, GH, grid: g, fixtures: [fl(10, 10), fl(60, 60, { group: 0 })] }, 'lo');
    const b = LB.bake({ GW, GH, grid: g, fixtures: [fl(10, 10, { group: 16 }), fl(30, 30, { group: 2.5 }), fl(60, 60, { group: -1 })] }, 'lo');
    const c = LB.bake({ GW, GH, grid: g, fixtures: [fl(10, 10, { group: 2, color: [1, 0, 0], k: 3 }), fl(60, 60, { group: 2, color: [0, 0, 1], k: 1 })] }, 'lo');
    const d = LB.bake({ GW, GH, grid: g, fixtures: [fl(10, 10, { group: 0 }), fl(15, 10, { group: 1 })] }, 'lo');
    const col = c.groups[0].color.map(v => +v.toFixed(3));
    ok(a.fixGroup[0] !== a.fixGroup[1] && a.fixGroup[1] === 0 && a.groups.length === 2, `auto lamp + explicit group 0 far away -> groups [${[...a.fixGroup]}] (not merged)`);
    ok(b.fixGroup[0] === -1 && b.fixGroup[1] === -1 && b.fixGroup[2] === 0 && b.stats.badGroup === 2 && b.stats.demoted === 2 && b.stats.warnings.length === 2,
      `group 16 and 2.5 are demoted (badGroup ${b.stats.badGroup}), -1 means auto -> [${[...b.fixGroup]}]; warning: "${b.stats.warnings[0]}"`);
    ok(col.join() === '0.75,0,0.25' && c.stats.warnings.some(w => /mixes/.test(w)), `a red (k 3) + blue (k 1) group gets colour [${col}] and a warning`);
    ok(d.fixGroup[0] === 0 && d.fixGroup[1] === -1 && d.stats.demoted === 1, `explicit groups 0 and 1 only 5 m apart -> [${[...d.fixGroup]}]`);
  }
  // f. records with non-finite numbers are skipped and reported, never thrown on
  {
    const GW = 9, GH = 9, g = room(GW, GH); let r = null, err = '';
    try { r = LB.bake({ GW, GH, grid: g, fixtures: [{ x: NaN, y: 2, z: 10 }, { x: 10, y: Infinity, z: 10 }, { x: 10, y: 2.4, z: 10 }],
      solids: [{ x0: NaN, y0: 0, x1: 10, y1: 10, h: 2, occ: 'tall' }], windows: [{ face: 999, u0: 0.2, u1: 0.8, v0: 1, v1: 2 }, { face: 0, u0: NaN, u1: 0.8, v0: 1, v1: 2 }], moon: { az: NaN, el: 0.6 } }, 'lo'); } catch (e) { err = e.message; }
    ok(r && r.stats.lamps === 1 && r.stats.skipped === 2 && r.stats.warnings.length === 5, err ? `non-finite records threw: ${err}` : `non-finite records: ${r.stats.lamps} lamp baked, ${r.stats.skipped} skipped; warnings: ${r.stats.warnings.join(' | ')}`);
  }
}

// calibration glance (C9): E under a few steady lamps
{
  const r = res.hi, m = r.floorLM, P = m.w / H.GW, out = [];
  H.fixtures.forEach((f, i) => { if (f.state !== 'ok' || out.length >= 6) return; const X = Math.floor(f.x / L * P), Y = Math.floor(f.z / L * P), d = (Y * m.w + X) * 4;
    out.push(`${f.profile}@${f.y.toFixed(2)}m: ${(E_MAX * srgbToLin(m.data[d + 1])).toFixed(2)}`); });
  console.log('info floor E (green channel) right under steady lamps:', out.join(' | '));
}

// dumps for a human look
if (DUMP) {
  fs.mkdirSync(DUMP, { recursive: true });
  const r = res.hi, m = r.floorLM, P = m.w / H.GW;
  png(path.join(DUMP, 'floorLM_rgb.png'), m.w, m.h, rgbOf(m), 3);
  png(path.join(DUMP, 'floorLM_flicker.png'), m.w, m.h, channel(m, 3), 1);
  png(path.join(DUMP, 'floorAux_moon.png'), m.w, m.h, channel(r.floorAux, 0), 1);
  png(path.join(DUMP, 'ceilLM_rgb.png'), m.w, m.h, rgbOf(r.ceilLM), 3);
  png(path.join(DUMP, 'wallLM_rgb.png'), r.wallLM.w, r.wallLM.h, rgbOf(r.wallLM), 3);
  png(path.join(DUMP, 'wallAux_ao.png'), r.wallAux.w, r.wallAux.h, channel(r.wallAux, 2), 1);
  png(path.join(DUMP, 'wallAux_moon.png'), r.wallAux.w, r.wallAux.h, channel(r.wallAux, 0), 1);
  png(path.join(DUMP, 'lf0_rgb.png'), r.lf0.w, r.lf0.h, rgbOf(r.lf0), 3);
  png(path.join(DUMP, 'lf1_dir.png'), r.lf1.w, r.lf1.h, rgbOf(r.lf1), 3);
  // a composite to read the plan: lamp light + flicker (red) + moon (blue), walls dark slate, boxes outlined, lamps marked
  const o = rgbOf(m), mark = (x, y, c) => { if (x >= 0 && y >= 0 && x < m.w && y < m.h) o.set(c, (y * m.w + x) * 3); };
  for (let Y = 0; Y < m.h; Y++) for (let X = 0; X < m.w; X++) {
    const k = Y * m.w + X; if (H.isW(Math.floor(X / P), Math.floor(Y / P))) { o.set([38, 42, 52], k * 3); continue; }
    o[k * 3] = Math.min(255, o[k * 3] + m.data[k * 4 + 3] * 2); o[k * 3 + 2] = Math.min(255, o[k * 3 + 2] + r.floorAux.data[k * 4] * 1.5);
  }
  for (const b of H.solids) { const x0 = Math.round(b.x0 * U / L * P), x1 = Math.round(b.x1 * U / L * P), y0 = Math.round(b.y0 * U / L * P), y1 = Math.round(b.y1 * U / L * P), c = b.occ === 'tall' ? [255, 0, 255] : b.occ === 'low' ? [0, 255, 255] : [128, 128, 128];
    for (let x = x0; x <= x1; x++) { mark(x, y0, c); mark(x, y1, c); } for (let y = y0; y <= y1; y++) { mark(x0, y, c); mark(x1, y, c); } }
  H.fixtures.forEach((f, i) => { const X = Math.round(f.x / L * P), Y = Math.round(f.z / L * P), c = f.state === 'dead' ? [90, 90, 90] : r.fixGroup[i] >= 0 ? [255, 40, 40] : f.state === 'flicker' ? [255, 160, 0] : [40, 255, 40];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) mark(X + dx, Y + dy, c); });
  H.windows.forEach(w => { const f = H.faces[w.face]; for (let u = w.u0; u <= w.u1; u += 0.01) for (let k = 0; k < 4; k++) mark(Math.round((f.x0 + (f.x1 - f.x0) * u + f.nx * k * 0.03) / L * P), Math.round((f.z0 + (f.z1 - f.z0) * u + f.nz * k * 0.03) / L * P), [255, 230, 0]); });
  png(path.join(DUMP, 'floor_composite.png'), m.w, m.h, o, 3);
  console.log(`dumped PNGs to ${DUMP}`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
