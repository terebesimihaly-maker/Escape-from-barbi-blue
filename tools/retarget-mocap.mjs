// Builds models/mocap.json: motion capture from the CMU Graphics Lab Motion Capture Database
// (BVH conversion by Bruce Hahne, mirrored at github.com/una-dinosauria/cmu-mocap) retargeted onto the
// rig in models/barbi.glb. Run from the repo root:  npm i three  &&  node tools/retarget-mocap.mjs
//
// Retargeting: every BVH file starts with a T-pose frame. For each mapped bone the rotation of the source
// joint relative to that T-pose (in world space) is applied to the target bone in a matching pose.
// The target's legs keep their own (O-shaped) rest pose; the arms, which hang down at rest, are first
// turned into the T-pose so the deltas line up. Each clip is cut to a seamless loop, made to walk
// in place along +Z, resampled to 30 fps and stored as local bone rotations.
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = process.env.MOCAP_CACHE || path.join(ROOT, 'tools', '.mocap-cache');
const SRC = 'https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/';

// name: [CMU motion, what it is, loop search window in seconds [from, to], cycle length range [min, max] s, in place?]
const CLIPS = {
  p_idle:   { take: '77_05', what: 'look around with flashlight', win: [1, 4.2], len: [2.6, 3.4], inPlace: true },
  p_walk:   { take: '16_15', what: 'walk', win: [0.5, 3.8], len: [0.95, 1.35] },
  p_jog:    { take: '16_35', what: 'run/jog', win: [0.3, 1.3], len: [0.55, 0.85] },
  p_run:    { take: '09_02', what: 'run', win: [0.2, 1.05], len: [0.5, 0.8] },
  m_idle:   { take: '77_02', what: 'standing', win: [1, 7.5], len: [3, 4.5], inPlace: true },
  m_walk:   { take: '104_41', what: 'ZombieWalk', win: [1, 12], len: [1.2, 2.4] },
  m_creep:  { take: '77_29', what: 'creeping walk', win: [1, 17], len: [1.2, 2.6] },
  m_limp:   { take: '77_19', what: 'limping, hurt right leg', win: [0.5, 10], len: [1.0, 2.2] },
};

// source joint -> target bone
const MAP = {
  Hips: 'root', LowerBack: 'spine05', Spine: 'spine03', Spine1: 'spine01', Neck: 'neck01', Neck1: 'neck03', Head: 'head',
  LeftShoulder: 'clavicle.L', LeftArm: 'upperarm01.L', LeftForeArm: 'lowerarm01.L', LeftHand: 'wrist.L',
  RightShoulder: 'clavicle.R', RightArm: 'upperarm01.R', RightForeArm: 'lowerarm01.R', RightHand: 'wrist.R',
  LeftUpLeg: 'upperleg01.L', LeftLeg: 'lowerleg01.L', LeftFoot: 'foot.L',
  RightUpLeg: 'upperleg01.R', RightLeg: 'lowerleg01.R', RightFoot: 'foot.R',
};
// target bones whose rest pose is turned to match the source T-pose before the motion is applied
// (bone -> the source joint that ends the source bone: its direction is what the target bone is aligned to)
const ALIGN = { 'upperarm01.L': ['LeftArm', 'LeftForeArm'], 'lowerarm01.L': ['LeftForeArm', 'LeftHand'],
  'upperarm01.R': ['RightArm', 'RightForeArm'], 'lowerarm01.R': ['RightForeArm', 'RightHand'] };
const ALIGN_END = { 'upperarm01.L': 'lowerarm01.L', 'lowerarm01.L': 'wrist.L', 'upperarm01.R': 'lowerarm01.R', 'lowerarm01.R': 'wrist.R' };

/* ---------- BVH ---------- */
function parseBVH(text) {
  const tok = text.replace(/\r/g, '').split(/\s+/).filter(Boolean);
  let i = 0; const joints = [];
  function readJoint(parent) {
    const kind = tok[i++]; const name = kind === 'End' ? (tok[i++], parent.name + '_end') : tok[i++];
    const j = { name, parent, offset: null, channels: [], children: [], end: kind === 'End' };
    if (tok[i++] !== '{') throw new Error('bvh {');
    while (tok[i] !== '}') {
      const k = tok[i++];
      if (k === 'OFFSET') j.offset = new THREE.Vector3(+tok[i++], +tok[i++], +tok[i++]);
      else if (k === 'CHANNELS') { const n = +tok[i++]; for (let c = 0; c < n; c++) j.channels.push(tok[i++]); }
      else if (k === 'JOINT' || k === 'End') { i--; j.children.push(readJoint(j)); }
    }
    i++; joints.push(j); return j;
  }
  if (tok[i++] !== 'HIERARCHY' || tok[i++] !== 'ROOT') throw new Error('bvh header');
  i--; tok[i] = 'JOINT';
  const root = readJoint(null);
  while (tok[i] !== 'MOTION') i++;
  i++; const frames = +tok[i + 1]; const dt = +tok[i + 4]; i += 5;
  const order = []; (function walk(j) { order.push(j); j.children.forEach(walk); })(root);
  const nch = order.reduce((n, j) => n + j.channels.length, 0);
  const data = new Float32Array(frames * nch);
  for (let f = 0; f < frames * nch; f++) data[f] = +tok[i++];
  return { root, order, frames, dt, nch, data };
}
// world rotation and position of every joint in frame f
function poseBVH(b, f) {
  const out = new Map(); let c = f * b.nch;
  const e = new THREE.Euler(), q = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  for (const j of b.order) {
    const local = new THREE.Quaternion(); const pos = j.offset.clone();
    for (const ch of j.channels) {
      const v = b.data[c++];
      if (ch === 'Xposition') pos.x = v; else if (ch === 'Yposition') pos.y = v; else if (ch === 'Zposition') pos.z = v;
      else { const r = v * Math.PI / 180, ax = ch[0];
        tmp.setFromAxisAngle(new THREE.Vector3(ax === 'X' ? 1 : 0, ax === 'Y' ? 1 : 0, ax === 'Z' ? 1 : 0), r); local.multiply(tmp); }
    }
    const P = j.parent && out.get(j.parent.name);
    const wq = P ? P.q.clone().multiply(local) : local;
    const wp = P ? pos.clone().applyQuaternion(P.q).add(P.p) : pos;
    out.set(j.name, { q: wq, p: wp });
  }
  return out;
}

/* ---------- the target rig, from the GLB ---------- */
function loadRig(file) {
  const f = fs.readFileSync(file), jl = f.readUInt32LE(12), J = JSON.parse(f.slice(20, 20 + jl));
  const N = J.nodes, parent = {};
  N.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const bones = new Map();
  const skin = new Set(J.skins[0].joints);
  N.forEach((n, i) => { if (skin.has(i)) bones.set(n.name, { name: n.name, i, parentIdx: parent[i],
    q: new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), p: new THREE.Vector3(...(n.translation || [0, 0, 0])) }); });
  for (const b of bones.values()) { const pn = N[b.parentIdx]; b.parent = pn && bones.get(pn.name) ? pn.name : null; }
  const order = []; const seen = new Set();
  const visit = b => { if (seen.has(b.name)) return; if (b.parent) visit(bones.get(b.parent)); seen.add(b.name); order.push(b.name); };
  for (const b of bones.values()) visit(b);
  return { bones, order };
}
function rigWorld(rig, locals) {                       // locals: Map name -> quaternion (defaults to rest)
  const W = new Map();
  for (const n of rig.order) { const b = rig.bones.get(n), l = (locals && locals.get(n)) || b.q;
    const P = b.parent && W.get(b.parent);
    W.set(n, { q: P ? P.q.clone().multiply(l) : l.clone(), p: P ? b.p.clone().applyQuaternion(P.q).add(P.p) : b.p.clone() }); }
  return W;
}

/* ---------- retargeting ---------- */
async function getBVH(take) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, take + '.bvh');
  if (!fs.existsSync(file)) {
    const s = take.split('_')[0].padStart(3, '0');
    const r = await fetch(SRC + s + '/' + take + '.bvh'); if (!r.ok) throw new Error('download ' + take + ': ' + r.status);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return parseBVH(fs.readFileSync(file, 'utf8'));
}
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
const yawOf = q => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); return Math.atan2(f.x, f.z); };

function retargetClip(rig, bvh, def) {
  const T0 = poseBVH(bvh, 0);                          // the T-pose
  const restW = rigWorld(rig);
  // the target in the source's T-pose: arms turned to point along the source's T-pose arm directions
  const tLocals = new Map();
  for (const n of rig.order) tLocals.set(n, rig.bones.get(n).q.clone());
  for (const tb of ['upperarm01.L', 'lowerarm01.L', 'upperarm01.R', 'lowerarm01.R']) {
    const W = rigWorld(rig, tLocals), [sa, sb] = ALIGN[tb];
    const dT = W.get(ALIGN_END[tb]).p.clone().sub(W.get(tb).p).normalize();
    const dS = T0.get(sb).p.clone().sub(T0.get(sa).p).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(dT, dS);
    const b = rig.bones.get(tb), Pq = W.get(b.parent).q;
    // new world = turn * old world  ->  new local = Pq^-1 * turn * Pq * local
    tLocals.set(tb, Pq.clone().invert().multiply(turn).multiply(Pq).multiply(tLocals.get(tb)));
  }
  const tposeW = rigWorld(rig, tLocals);
  const fps = 1 / bvh.dt, skip = Math.round(def.win[0] * fps), stop = Math.min(bvh.frames - 1, Math.round(def.win[1] * fps));
  const poses = []; for (let f = 0; f < bvh.frames; f++) poses.push(poseBVH(bvh, f));
  // size: source hip height -> target hip height
  const footS = Math.min(T0.get('LeftFoot').p.y, T0.get('RightFoot').p.y), footT = Math.min(restW.get('foot.L').p.y, restW.get('foot.R').p.y);
  const k = (restW.get('upperleg01.L').p.y - footT) / (T0.get('LeftUpLeg').p.y - footS);
  // find the best loop: two frames that look alike, a cycle length apart
  const keyJ = Object.keys(MAP).filter(j => j !== 'Hips');
  let best = null;
  const lmin = Math.round(def.len[0] * fps), lmax = Math.round(def.len[1] * fps);
  for (let a = skip; a < stop - lmin; a += 2) for (let L = lmin; L <= lmax && a + L <= stop; L += 1) {
    const A = poses[a], B = poses[a + L]; let d = 0;
    const ha = A.get('Hips').q, hb = B.get('Hips').q;
    const ia = ha.clone().invert(), ib = hb.clone().invert();
    for (const j of keyJ) d += angle(ia.clone().multiply(A.get(j).q), ib.clone().multiply(B.get(j).q));
    d += Math.abs(A.get('Hips').p.y - B.get('Hips').p.y) * 0.3;
    if (!best || d < best.d) best = { a, L, d };
  }
  const { a, L } = best;
  // travel direction -> +Z (or, in place, the average facing)
  const pa = poses[a].get('Hips').p, pb = poses[a + L].get('Hips').p;
  const travel = new THREE.Vector3(pb.x - pa.x, 0, pb.z - pa.z);
  const yaw = def.inPlace || travel.length() < 1 ? yawOf(poses[a].get('Hips').q) : Math.atan2(travel.x, travel.z);
  const turnBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  // and remove any slow turning over the loop, so it walks straight
  const drift = def.inPlace ? 0 : ((yawOf(poses[a + L].get('Hips').q) - yawOf(poses[a].get('Hips').q) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const speed = def.inPlace ? 0 : travel.length() * k / (L / fps);
  const step = Math.round(fps / 30), n = Math.round(L / step);
  const bones = Object.values(MAP);
  // one source frame -> local rotations of the mapped target bones (+ the root's height)
  function convert(f, along) {
    const P = poses[f];
    const fix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw - drift * along);
    const tw = new Map();
    for (const [sj, tb] of Object.entries(MAP)) {
      const delta = fix.clone().multiply(P.get(sj).q).multiply(T0.get(sj).q.clone().invert());
      tw.set(tb, delta.multiply(tposeW.get(tb).q));
    }
    // world -> local down the target hierarchy (unmapped bones keep their rest rotation)
    const locals = new Map(), W = new Map();
    for (const nm of rig.order) {
      const b = rig.bones.get(nm), Pw = b.parent ? W.get(b.parent) : new THREE.Quaternion();
      const l = tw.has(nm) ? Pw.clone().invert().multiply(tw.get(nm)) : b.q.clone();
      locals.set(nm, l); W.set(nm, Pw.clone().multiply(l));
    }
    return { q: bones.map(bn => locals.get(bn)), y: (P.get('Hips').p.y - T0.get('Hips').p.y) * k };
  }
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(convert(a + i * step, i / n));
  // seamless loop: the last frames cross-fade into the motion that leads into the first frame
  const blend = Math.min(8, Math.floor(n / 4));
  for (let i = 0; i < blend; i++) {
    const fi = n - blend + i, pre = convert(Math.max(0, a - (blend - i) * step), (fi - n) / n + 0), w = (i + 1) / (blend + 1);
    const ww = w * w * (3 - 2 * w);
    frames[fi].q = frames[fi].q.map((q, bi) => { const t = pre.q[bi].clone(); if (q.dot(t) < 0) t.set(-t.x, -t.y, -t.z, -t.w); return q.clone().slerp(t, ww); });
    frames[fi].y = frames[fi].y * (1 - ww) + pre.y * ww;
  }
  return { bones, frames, fps: 30, speed, src: def.take, what: def.what, cycle: L / fps };
}

/* ---------- main ---------- */
const rig = loadRig(path.join(ROOT, 'models', 'barbi.glb'));
const out = { source: 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by Bruce Hahne', bones: Object.values(MAP), clips: {} };
for (const [name, def] of Object.entries(CLIPS)) {
  const bvh = await getBVH(def.take);
  const c = retargetClip(rig, bvh, def);
  // compact: rotations as int16 (x1e4), per frame bones*4, then root y (mm)
  const q = [], ry = [];
  for (const fr of c.frames) { for (const qq of fr.q) q.push(Math.round(qq.x * 1e4), Math.round(qq.y * 1e4), Math.round(qq.z * 1e4), Math.round(qq.w * 1e4)); ry.push(Math.round(fr.y * 1000)); }
  out.clips[name] = { src: c.src, what: c.what, fps: 30, n: c.frames.length, speed: +c.speed.toFixed(3), q, ry };
  console.log(name.padEnd(8), c.src.padEnd(7), c.what.padEnd(30), 'frames', String(c.frames.length).padStart(3), ' cycle', c.cycle.toFixed(2) + 's', ' speed', c.speed.toFixed(2), 'm/s');
}
fs.writeFileSync(path.join(ROOT, 'models', 'mocap.json'), JSON.stringify(out));
console.log('wrote models/mocap.json', (fs.statSync(path.join(ROOT, 'models', 'mocap.json')).size / 1024).toFixed(0), 'KB');
