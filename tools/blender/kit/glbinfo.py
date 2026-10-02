# Escape from Barbi Blue: reads a packed kit GLB without Blender, for pack.py's manifest and check_kit.py. From the glTF JSON:
# the node tree and transforms, each node's bounding box (from the accessors' min/max), triangles, materials, whether it has a
# second UV set, and which extensions are used. For the checks that need the vertices themselves (how much of its box a solid
# covers, where a rocking chair swings), a small node script undoes the meshopt compression with gltf-transform and hands the
# positions over. Boxes come back in Blender axes (z up, the front -y), like defs.py's.
import json, os, struct, subprocess
import numpy as np
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
GLTFT = os.environ.get('EFBB_GLTFT') or next((p for p in (os.path.join(_REPO, 'tools', 'gltf'), '/tmp/claude-0/gltft')
                                              if os.path.isdir(os.path.join(p, 'node_modules'))), os.path.join(_REPO, 'tools', 'gltf'))   # (as kitlib.GLTFT)

def b2g(p): return (p[0], p[2], -p[1])                     # Blender (z up) -> glTF (y up)
def g2b_box(lo, hi): return [[lo[0], -hi[2], lo[1]], [hi[0], -lo[2], hi[1]]]

def trs(n):
    if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0]); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t; return M

class Glb:
    def __init__(self, path):
        d = open(path, 'rb').read(); L = struct.unpack('<I', d[12:16])[0]
        self.path = path; self.size = len(d); self.js = js = json.loads(d[20:20 + L])
        self.nodes = js.get('nodes', []); self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []): self.parent[c] = i
        self.world = [None] * len(self.nodes)
        def w(i):
            if self.world[i] is None: self.world[i] = (w(self.parent[i]) if i in self.parent else np.eye(4)) @ trs(self.nodes[i])
            return self.world[i]
        for i in range(len(self.nodes)): w(i)
        self.index = {}
        for i, n in enumerate(self.nodes): self.index.setdefault(n.get('name', ''), i)
        self.ext = set(js.get('extensionsUsed', [])); self.pos = None
    def find(self, name): return self.index.get(name)
    def subtree(self, i):
        out = [i]
        for c in self.nodes[i].get('children', []): out += self.subtree(c)
        return out
    def rel(self, i, frame):                               # i's transform in frame's own space
        return np.linalg.inv(self.world[frame]) @ self.world[i]
    def prims(self, i):
        for j in self.subtree(i):
            n = self.nodes[j]
            if 'mesh' in n:
                for p in self.js['meshes'][n['mesh']]['primitives']: yield j, p
    def tris(self, i):
        t = 0
        for j, p in self.prims(i):
            if p.get('mode', 4) != 4: continue
            acc = self.js['accessors'][p['indices'] if 'indices' in p else p['attributes']['POSITION']]
            t += acc['count'] // 3
        return t
    def materials(self, i):
        out = []
        for j, p in self.prims(i):
            name = self.js['materials'][p['material']].get('name', '?') if 'material' in p else None
            if name not in out: out.append(name)
        return out
    def uv1(self, i, skip=()):
        """every primitive under i (except those using a material in skip) has TEXCOORD_1"""
        ps = [p for j, p in self.prims(i) if not ('material' in p and self.js['materials'][p['material']].get('name') in skip)]
        return bool(ps) and all('TEXCOORD_1' in p['attributes'] for p in ps)
    def box(self, i, frame=None):
        """the subtree's box in frame's space (default: i's own), Blender axes, from the accessor bounds (exact for nodes
           that are only moved; a rotated part is boxed by its corners)"""
        frame = i if frame is None else frame; lo = np.full(3, np.inf); hi = np.full(3, -np.inf)
        for j, p in self.prims(i):
            a = self.js['accessors'][p['attributes']['POSITION']]
            if 'min' not in a: continue
            mn, mx = a['min'], a['max']; M = self.rel(j, frame)
            for c in ((x, y, z) for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])):
                q = M @ np.array([*c, 1.0]); lo = np.minimum(lo, q[:3]); hi = np.maximum(hi, q[:3])
        if not np.isfinite(lo).all(): return None
        return g2b_box(lo, hi)
    # ---- vertices (meshopt-decoded through node)
    def vertices(self, i, frame=None):
        """(points (n, 3), triangles (m, 3) indices into points) of i's subtree in frame's space, Blender axes"""
        if self.pos is None: self.pos = _decode(self.path)
        frame = i if frame is None else frame; P = []; T = []; base = 0
        for j in self.subtree(i):
            for pts, idx in self.pos.get(self.nodes[j].get('name', ''), []):
                M = self.rel(j, frame); q = (np.c_[pts, np.ones(len(pts))] @ M.T)[:, :3]
                P.append(np.c_[q[:, 0], -q[:, 2], q[:, 1]]); T.append(idx + base); base += len(pts)
        if not P: return np.zeros((0, 3)), np.zeros((0, 3), int)
        return np.concatenate(P), np.concatenate(T).reshape(-1, 3)

DUMP = r"""
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src), root = doc.getRoot(), nodes = root.listNodes(), out = [], bufs = []; let off = 0;
nodes.forEach((n, i) => { const m = n.getMesh(); if (!m) return;
  for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); if (!pos) continue;
    const arr = new Float32Array(pos.getCount() * 3); for (let k = 0; k < pos.getCount(); k++) { const v = pos.getElement(k, []); arr.set(v, k * 3); }
    const ix = p.getIndices(); const id = new Uint32Array(ix ? ix.getArray() : arr.length / 3);
    if (!ix) for (let k = 0; k < id.length; k++) id[k] = k;
    out.push({ name: n.getName(), n: pos.getCount(), off, ni: id.length, ioff: off + arr.byteLength }); bufs.push(Buffer.from(arr.buffer), Buffer.from(id.buffer)); off += arr.byteLength + id.byteLength;
  } });
fs.writeFileSync(dst + '.bin', Buffer.concat(bufs)); fs.writeFileSync(dst + '.json', JSON.stringify(out));
"""

def _decode(path):
    js = os.path.join(GLTFT, 'kit-glbdump.mjs')
    if not os.path.exists(js) or open(js).read() != DUMP: open(js, 'w').write(DUMP)
    import defs; tmp = os.path.join(defs.WORK, 'check'); os.makedirs(tmp, exist_ok=True); dst = os.path.join(tmp, os.path.basename(path).replace('.glb', '') + '_' + str(abs(hash(path)) % 10 ** 8))
    r = subprocess.run(['node', js, path, dst], cwd=GLTFT, capture_output=True, text=True)
    if r.returncode: raise RuntimeError('glbdump failed: ' + r.stderr[-1500:])
    meta = json.load(open(dst + '.json')); raw = open(dst + '.bin', 'rb').read(); out = {}
    for e in meta:
        pts = np.frombuffer(raw, np.float32, e['n'] * 3, e['off']).reshape(-1, 3).astype(float)
        idx = np.frombuffer(raw, np.uint32, e['ni'], e['ioff']).astype(int)
        out.setdefault(e['name'], []).append((pts, idx))
    for ext in ('.json', '.bin'): os.remove(dst + ext)
    return out

def clip_box(P, T, z0):
    """the box of the part of a mesh at or above height z0 (triangles cut at z0): how much of its footprint a solid's
       visible body covers above knee height"""
    if not len(T): return None
    lo = np.full(3, np.inf); hi = np.full(3, -np.inf)
    keep = P[:, 2] >= z0
    if keep.any(): lo = P[keep].min(0); hi = P[keep].max(0)
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    for u, v in ((a, b), (b, c), (c, a)):                   # (where edges cross z0)
        s = (u[:, 2] - z0) * (v[:, 2] - z0) < 0
        if s.any():
            t = ((z0 - u[s, 2]) / (v[s, 2] - u[s, 2]))[:, None]; q = u[s] + (v[s] - u[s]) * t
            lo = np.minimum(lo, q.min(0)); hi = np.maximum(hi, q.max(0))
    return None if not np.isfinite(lo).all() else [lo.tolist(), hi.tolist()]
