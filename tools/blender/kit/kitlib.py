# Escape from Barbi Blue: the house kit's shared Blender library. Every kit script starts here: a clean scene (Cycles on the
# best device, metres, z up), procedural materials that look aged (old varnished woods worn to bare wood, chipped paint,
# porcelain, brass, iron and rust, fabrics, plaster), bevels and weighted normals, UV unwrapping, and the bake: albedo (colour
# only, times cavity grime), a tangent normal map, and ORM (R ambient occlusion 0.25 m, G roughness, B metalness). Data bakes go
# to float EXR with the Standard view transform, are denoised through the compositor and only then turned into WebP (Pillow),
# one file per tier (hi, md half, lo quarter). Then the glTF export and the meshopt compression.
#   flags every kit script takes: --preview (quarter resolution, 8 samples), --only <id>[,<id>] (just those), --force (rebuild)
# An asset script saves /tmp/efbb-kit/<asset>.blend holding only its finished nodes and registers them (register()), and
# pack.py collects them into models/kit/<tier>/<style>.glb.
import sys, os, math, json, time, random, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise
import common, defs
REPO = defs.REPO; TMP = defs.WORK; KITDIR = os.path.join(REPO, 'models', 'kit')
# node tools (gltf-transform + meshopt): EFBB_GLTFT if set, else tools/gltf once "npm install" ran there, else the old cloud path
GLTFT = os.environ.get('EFBB_GLTFT') or next((p for p in (os.path.join(REPO, 'tools', 'gltf'), '/tmp/claude-0/gltft')
                                              if os.path.isdir(os.path.join(p, 'node_modules'))), os.path.join(REPO, 'tools', 'gltf'))
TIERS = {'hi': 1, 'md': 2, 'lo': 4}                         # (texture size divisor per tier)
os.makedirs(TMP, exist_ok=True)

# ---------------------------------------------------------------- flags, freshness
class _Opts:
    def __init__(self, argv):
        self.preview = '--preview' in argv; self.force = '--force' in argv; self.only = None
        if '--only' in argv: self.only = set(argv[argv.index('--only') + 1].split(','))
    def want(self, *ids): return self.only is None or any(i in self.only for i in ids)
OPTS = _Opts(sys.argv[1:])

def res(px):                                               # bake resolution, a quarter in --preview
    return max(64, px // 4) if OPTS.preview else px
def spp(n):
    return min(n, 8) if OPTS.preview else n

def fresh(outputs, inputs=()):
    """True when every output exists and is newer than every input, this library, defs.py, js/kitdefs.js and the calling
       script (so a build is skipped when nothing it depends on changed)"""
    if OPTS.force: return False
    base = [os.path.abspath(sys.argv[0]), __file__, defs.__file__, defs.SRC] + list(inputs)
    try: newest = max(os.path.getmtime(p) for p in base if os.path.exists(p)); return all(os.path.getmtime(o) > newest for o in outputs)
    except (OSError, ValueError): return False

def _digest(paths):
    import hashlib
    h = hashlib.sha1()
    for p in paths:
        if os.path.exists(p): h.update(open(p, 'rb').read())
    return h.hexdigest()
# what this run is built from, taken as it starts (a source edited while a build runs must not count as built)
INPUTS = _digest([os.path.abspath(sys.argv[0]), __file__, defs.__file__, defs.SRC])

def fresh_asset(asset, inputs=()):
    """an asset script's skip test: its .blend exists, was built from exactly these sources (the script, this library,
       defs.py, js/kitdefs.js and inputs, by content) and the way this run asks (a --preview build never passes for a full
       one, nor the other way round)"""
    if OPTS.force: return False
    reg = os.path.join(TMP, 'assets', asset + '.json'); blend = os.path.join(TMP, asset + '.blend')
    try: r = json.load(open(reg))
    except (OSError, ValueError): return False
    return os.path.exists(blend) and r.get('preview', False) == OPTS.preview and r.get('inputs') == INPUTS + _digest(inputs)

# ---------------------------------------------------------------- scene
def reset(samples=16):
    """an empty scene: Cycles on the best device (never EEVEE or Workbench: they abort here), metres, Standard view (bakes)"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; common.use_best_device(sc); sc.cycles.samples = samples
    sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (1, 1, 1)
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.render.bake.margin = 8
    return sc

def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob); return ob

def mesh_object(name, bm, mats=()):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for m in mats: me.materials.append(m)
    return ob

def empty(name, loc=(0, 0, 0), parent=None):
    e = link(bpy.data.objects.new(name, None)); e.empty_display_size = 0.1; e.location = loc
    if parent: e.parent = parent
    return e

def select(objs, active=None):
    bpy.context.view_layer.update()                        # (objects just linked or appended aren't in the view layer until then)
    for o in bpy.context.view_layer.objects: o.select_set(o in objs)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)

def join(objs, name):
    """join meshes into one object (keeps their uv layers and attributes when they all have them)"""
    objs = [o for o in objs if o.type == 'MESH']
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]): bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name; return objs[0]

def apply_mods(ob):
    with bpy.context.temp_override(object=ob, active_object=ob):
        for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def set_origin(ob, point):
    """move the object's origin to point (world), leaving the mesh where it is"""
    d = Vector(point) - ob.matrix_world.translation
    ob.data.transform(Matrix.Translation(-d)); ob.matrix_world.translation += d

# ---------------------------------------------------------------- geometry helpers
def bevel(ob, width=0.003, segments=2, angle=35, harden=True):
    """real rounded edges (light catches them) on every edge sharper than angle; then weighted normals so the flat faces
       stay flat next to the rounded edges"""
    m = ob.modifiers.new('bevel', 'BEVEL'); m.width = width; m.segments = segments; m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle); m.harden_normals = harden; m.miter_outer = 'MITER_ARC'
    weighted_normals(ob); return m

def weighted_normals(ob):
    for p in ob.data.polygons: p.use_smooth = True
    if not any(m.type == 'WEIGHTED_NORMAL' for m in ob.modifiers):
        w = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); w.keep_sharp = True; w.weight = 50

def attr(ob, name, values, kind='FLOAT', domain='POINT'):
    """a per-vertex attribute the bake materials read (grain space 'gpos', 'wear', 'curv', 'prand'); never exported"""
    a = ob.data.attributes.get(name) or ob.data.attributes.new(name, kind, domain)
    if kind == 'FLOAT_VECTOR': a.data.foreach_set('vector', [c for v in values for c in v])
    else: a.data.foreach_set('value', list(values))
    return a

def ensure_attrs(ob, wear=0.0, prand=None, grain=None):
    """every bake attribute present (join() keeps an attribute only if all parts have it): grain space defaults to the
       object's own coordinates (grain along z), wear to a constant, prand (this part's random tone) to a random number"""
    me = ob.data; n = len(me.vertices)
    if 'gpos' not in me.attributes:
        M = grain or Matrix.Identity(4); off = Vector((random.uniform(-9, 9), random.uniform(-9, 9), random.uniform(-9, 9)))
        attr(ob, 'gpos', [tuple(M @ v.co + off) for v in me.vertices], 'FLOAT_VECTOR')
    if 'wear' not in me.attributes: attr(ob, 'wear', [wear] * n)
    if 'prand' not in me.attributes: attr(ob, 'prand', [random.random() if prand is None else prand] * n)

def curvature(ob, edge=0.004, flat=0.025, spread=1):
    """convexity per vertex ('curv', 0 flat or hollow .. 1 a sharp outside edge): how fast the normal turns across each edge,
       in 1/m (exact for a circle: 1/r), so a 2 cm spindle stays 0 while a 4 mm rounded edge or a bead's crest is 1, whatever
       the mesh density. Where edge wear and chips go (Cycles' pointiness, but deterministic and scale-true)."""
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table(); bm.normal_update()
    c = []
    for v in bm.verts:
        k = 0.0
        for e in v.link_edges:
            u = e.other_vert(v); d = v.co - u.co; l2 = d.length_squared
            if l2 > 1e-12: k = max(k, (v.normal - u.normal).dot(d) / l2)
        c.append(max(0.0, min(1.0, (k - 1 / flat) / (1 / edge - 1 / flat))))
    for _ in range(spread):
        c = [(2 * c[v.index] + sum(c[e.other_vert(v).index] for e in v.link_edges)) / (2 + len(v.link_edges)) for v in bm.verts]
    bm.free(); attr(ob, 'curv', c)

def surface(name, P, G=None, W=None, UV=None, wrap=False, caps=(False, False), mats=()):
    """a quad-grid mesh: P[i][j] positions (rows i along, columns j across; wrap closes the columns into a tube, outward when j
       runs anticlockwise looking down +i), G[i][j] grain space and W[i][j] wear per vertex, UV[i][j] per corner ((nj + 1)
       columns when wrapped, the seam column continuing past the last). caps close the first / last row with a fan, its UVs
       a little disc beside the grid. Returns the object, smooth shaded, with 'gpos' and 'wear'."""
    ni, nj = len(P), len(P[0]); bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    V = [[bm.verts.new(P[i][j]) for j in range(nj)] for i in range(ni)]
    g = [G[i][j] if G else P[i][j] for i in range(ni) for j in range(nj)]; w = [W[i][j] if W else 0.0 for i in range(ni) for j in range(nj)]
    if UV is None: UV = [[(j / max(1, nj - 1), i / max(1, ni - 1)) for j in range(nj + 1)] for i in range(ni)]
    for i in range(ni - 1):
        for j in range(nj if wrap else nj - 1):
            f = bm.faces.new((V[i][j], V[i][(j + 1) % nj], V[i + 1][(j + 1) % nj], V[i + 1][j]))
            for lp, (a, b) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))): lp[uvl].uv = UV[a][b]
    vmax = max(uv[1] for row in UV for uv in row)
    for end, on in ((0, caps[0]), (ni - 1, caps[1])):
        if not on: continue
        ring = V[end]; c = sum((v.co for v in ring), Vector()) / nj; cv = bm.verts.new(c)
        g.append(tuple(sum((Vector(G[end][j]) for j in range(nj)), Vector()) / nj) if G else tuple(c)); w.append(sum(W[end]) / nj if W else 0.0)
        rad = max((v.co - c).length for v in ring); u0 = 0.02 + rad + (0 if end == 0 else 2.2 * rad + 0.01); v0 = -0.02 - rad
        ex = (ring[0].co - c).normalized(); ey = (ring[1].co - c).cross(ring[0].co - c).normalized().cross(ex)   # (the cap's own plane)
        for j in range(nj if wrap else nj - 1):
            a, b = ring[j], ring[(j + 1) % nj]
            f = bm.faces.new((cv, b, a) if end == 0 else (cv, a, b))
            for lp in f.loops: d = lp.vert.co - c; lp[uvl].uv = (u0 + d.dot(ex), v0 + d.dot(ey))
    bm.normal_update(); ob = mesh_object(name, bm, mats)
    for p in ob.data.polygons: p.use_smooth = True
    attr(ob, 'gpos', [tuple(x) for x in g], 'FLOAT_VECTOR'); attr(ob, 'wear', w)
    return ob

def frame(axis, hint=(0, 1, 0)):
    """two unit vectors across axis: u toward hint (as near as it can), v = axis x u"""
    a = Vector(axis).normalized(); h = Vector(hint)
    if abs(a.dot(h.normalized())) > 0.95: h = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 0, 1))
    u = (h - a * a.dot(h)).normalized(); return u, a.cross(u)

def lathe(name, profile, p0, p1, sides=12, seam=(0, 1, 0), wear=None, pith=None, mats=(), caps=(False, False)):
    """a turned part (leg, spindle, stretcher): profile [(t 0..1 from p0 to p1, radius m)], the seam and the UV cut on the side
       facing seam (keep it out of sight), grain along the axis with the pith off to one side (long streaks, not bullseyes).
       UVs in metres (around: angle x the mean radius; along: distance). wear(t, angle, point) -> 0..1"""
    p0, p1 = Vector(p0), Vector(p1); L = (p1 - p0).length; ax = (p1 - p0) / L; u, v = frame(ax, seam)
    pith = pith or (random.uniform(0.06, 0.2) * random.choice((-1, 1)), random.uniform(0.06, 0.2) * random.choice((-1, 1)), random.uniform(-5, 5))
    rm = sum(r for t, r in profile) / len(profile); P, G, W, UV = [], [], [], []
    for t, r in profile:
        row, grow, wrow, uvrow = [], [], [], []
        for j in range(sides + 1):
            a = j / sides * 2 * math.pi; c, s = math.cos(a), math.sin(a)
            if j < sides:
                q = p0 + ax * (t * L) + (u * c + v * s) * r; row.append(q)
                grow.append((c * r + pith[0], s * r + pith[1], t * L + pith[2])); wrow.append(wear(t, a, q) if wear else 0.0)
            uvrow.append((a * rm, t * L))
        P.append(row); G.append(grow); W.append(wrow); UV.append(uvrow)
    return surface(name, P, G, W, UV, wrap=True, caps=caps, mats=mats)

def sweep(name, path, section, wear=None, caps=(True, True), mats=(), offset=None):
    """a part swept along a path (rockers, arms, rails): path = [(point, side, up)] (unit side and up across the path),
       section(k) -> [(x, y)] in the (side, up) plane, the same count for every k, anticlockwise. Grain runs along the path;
       UVs in metres (along: arc length; around: the section's perimeter). wear(k, j, point) -> 0..1"""
    P, G, W, UV = [], [], [], []; acc = 0.0; off = offset or Vector((random.uniform(-5, 5), random.uniform(-5, 5), random.uniform(-5, 5)))
    fwd = Vector(path[1][0]) - Vector(path[0][0]); flip = Vector(path[0][1]).cross(Vector(path[0][2])).dot(fwd) < 0   # (a left-handed frame turns the faces inward)
    if flip: section = (lambda f: lambda k: f(k)[::-1])(section)
    for k, (pt, side, up) in enumerate(path):
        if k: acc += (Vector(pt) - Vector(path[k - 1][0])).length
        sec = section(k); n = len(sec); per = [0.0]
        for j in range(n): per.append(per[-1] + math.hypot(sec[(j + 1) % n][0] - sec[j][0], sec[(j + 1) % n][1] - sec[j][1]))
        row = [Vector(pt) + Vector(side) * x + Vector(up) * y for x, y in sec]
        P.append(row); G.append([(x + off.x, y + off.y, acc + off.z) for x, y in sec])
        W.append([wear(k, j, row[j]) if wear else 0.0 for j in range(n)]); UV.append([(acc, per[j]) for j in range(n + 1)])
    return surface(name, P, G, W, UV, wrap=True, caps=caps, mats=mats)

def rounded_rect(w, h, r, n=3, cx=0.0, cy=0.0, r_top=None):
    """a rounded rectangle's outline, anticlockwise from the bottom right corner: w x h around (cx, cy), corner radius r
       (r_top for the top two), n points per corner"""
    rt = r if r_top is None else r_top; out = []
    for (x, y, rr, a0) in ((w / 2 - r, -h / 2 + r, r, -90), (w / 2 - rt, h / 2 - rt, rt, 0), (-w / 2 + rt, h / 2 - rt, rt, 90), (-w / 2 + r, -h / 2 + r, r, 180)):
        for i in range(n):
            a = math.radians(a0 + 90 * i / max(1, n - 1)); out.append((cx + x + rr * math.cos(a), cy + y + rr * math.sin(a)))
    return out

# ---------------------------------------------------------------- UVs
def unwrap(objs, margin=0.004, uv1=False, smart=True, angle=66, fast=False):
    """uv0: smart project (unless the object already has hand-made UVs and smart=False), every island scaled to the same
       texel density and packed (convex hulls; fast: bounding boxes, for grey boxes); uv1 (modules):
       lightmap pack, a unique 0..1 layout for the wall atlas"""
    objs = [o for o in (objs if isinstance(objs, (list, tuple)) else [objs]) if o.type == 'MESH']
    for o in objs:
        if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers.active_index = 0; o.data.uv_layers[0].active_render = True
    select(objs); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    if smart: bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=not fast, margin=margin, shape_method='AABB' if fast else 'CONVEX')   # (CONCAVE takes minutes)
    bpy.ops.object.mode_set(mode='OBJECT')
    if uv1:
        for o in objs:
            if len(o.data.uv_layers) < 2: o.data.uv_layers.new(name='UV1')
            o.data.uv_layers.active_index = 1
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_MARGIN_DIV=0.3)
        bpy.ops.object.mode_set(mode='OBJECT')
        for o in objs: o.data.uv_layers.active_index = 0

def uv_scale(ob, pred, k):
    """shrink (k < 1) the UV islands of the faces where pred(polygon) holds, about their middle: less texture for the parts
       nobody looks at (a seat's underside), before packing"""
    uv = ob.data.uv_layers[0].data; idx = [i for p in ob.data.polygons if pred(p) for i in p.loop_indices]
    if not idx: return
    c = sum((Vector(uv[i].uv) for i in idx), Vector((0, 0))) / len(idx)
    for i in idx: uv[i].uv = c + (Vector(uv[i].uv) - c) * k

def pack_uvs(objs, margin=0.004):
    """keep each island's shape (hand-made UVs in metres) but give them all one texel density and pack them into 0..1"""
    unwrap(objs, margin, smart=False)

# ---------------------------------------------------------------- materials (procedural; baked, never exported as such)
def lin(h):
    """'#rrggbb' (sRGB, as a colour picker shows it) -> linear RGB"""
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

class Mat:
    """a node-tree material written as code (the map_textures.py idea): n() makes a node, l() links, the helpers build
       the usual patterns. Values are linear; colours are tuples or sockets."""
    def __init__(self, name):
        self.m = bpy.data.materials.new(name); self.m.use_nodes = True; self.nt = self.m.node_tree
        self.b = self.nt.nodes['Principled BSDF']; self.out_node = self.nt.nodes['Material Output']
        self.m['kit'] = 1; self.m.use_backface_culling = True       # (exported single-sided: doubleSided only where a piece needs it)
    def n(self, kind, **kw):
        node = self.nt.nodes.new(kind)
        for k, v in kw.items():
            if not k.startswith('i_'): setattr(node, k, v); continue
            raw = k[2:]; name = raw.replace('_', ' ')
            inp = next((i for i in node.inputs if i.identifier == raw and i.enabled), None) or next((i for i in node.inputs if i.name == name and i.enabled), None) \
                or next((i for i in node.inputs if i.name == name), None)
            inp.default_value = v
        return node
    def l(self, a, b): self.nt.links.new(a, b); return b
    def val(self, x):                                       # a socket or a constant -> a socket
        if not isinstance(x, (int, float)): return x
        v = self.n('ShaderNodeValue'); v.outputs[0].default_value = x; return v.outputs[0]
    def attr(self, name, vector=False):
        a = self.n('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name=name); return a.outputs['Vector' if vector else 'Fac']
    def geo(self, out): return self.n('ShaderNodeNewGeometry').outputs[out]
    def map(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        mp = self.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = scale; mp.inputs['Location'].default_value = loc
        mp.inputs['Rotation'].default_value = rot; self.l(vec, mp.inputs['Vector']); return mp.outputs[0]
    def noise(self, vec, scale, detail=4, rough=0.55, dist=0.0, color=False):
        nz = self.n('ShaderNodeTexNoise', i_Scale=scale, i_Detail=detail, i_Roughness=rough, i_Distortion=dist); self.l(vec, nz.inputs['Vector'])
        return nz.outputs['Color' if color else 'Fac']
    def voronoi(self, vec, scale, out='Distance', feature='F1', rand=1.0):
        v = self.n('ShaderNodeTexVoronoi', feature=feature, i_Scale=scale, i_Randomness=rand); self.l(vec, v.inputs['Vector']); return v.outputs[out]
    def math(self, op, a, b=None, c=None, clamp=False):
        m = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b, c)):
            if x is None: continue
            (m.inputs[i].__setattr__('default_value', x) if isinstance(x, (int, float)) else self.l(x, m.inputs[i]))
        return m.outputs[0]
    def remap(self, v, a, b, c=0.0, d=1.0, clamp=True, smooth=False):
        m = self.n('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR', clamp=clamp,
                   i_From_Min=a, i_From_Max=b, i_To_Min=c, i_To_Max=d)
        self.l(v, m.inputs['Value']); return m.outputs['Result']
    def mix(self, fac, a, b, mode='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=mode, clamp_factor=True)
        (self.l(fac, m.inputs['Factor']) if not isinstance(fac, (int, float)) else m.inputs['Factor'].__setattr__('default_value', fac))
        for i, c in ((6, a), (7, b)):
            (self.l(c, m.inputs[i]) if not isinstance(c, tuple) else m.inputs[i].__setattr__('default_value', (*c, 1) if len(c) == 3 else c))
        return m.outputs[2]
    def mixf(self, fac, a, b):                              # mix two floats
        m = self.n('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        for i, x in ((0, fac), (2, a), (3, b)):
            (m.inputs[i].__setattr__('default_value', x) if isinstance(x, (int, float)) else self.l(x, m.inputs[i]))
        return m.outputs[0]
    def hsv(self, col, h=0.5, s=1.0, v=1.0):
        n = self.n('ShaderNodeHueSaturation')
        for name, x in (('Hue', h), ('Saturation', s), ('Value', v)):
            (n.inputs[name].__setattr__('default_value', x) if isinstance(x, (int, float)) else self.l(x, n.inputs[name]))
        self.l(col, n.inputs['Color']); return n.outputs['Color']
    def ramp(self, fac, stops):
        r = self.n('ShaderNodeValToRGB'); e = r.color_ramp.elements
        for i, (p, c) in enumerate(stops):
            el = e[i] if i < 2 else e.new(p); el.position = p; el.color = (*c, 1)
        self.l(fac, r.inputs['Fac']); return r.outputs['Color']
    def lines(self, vec, scale, width=0.012, stretch=60.0, rot=0.0):
        """thin random scratches / cracks: the zero line of a noise squashed along one direction"""
        v = self.map(vec, (1, stretch, 1), rot=(0, 0, rot))
        nz = self.noise(v, scale, 2, 0.5)
        d = self.math('ABSOLUTE', self.math('SUBTRACT', nz, 0.5)); return self.remap(d, width, 0.0)
    def cavity(self):
        """the baked, denoised cavity map (AO at 5 cm, 1 = open .. 0 = deep crevice): bake_set() fills the CAV image before
           the colour bake (white until then)"""
        t = self.nt.nodes.get('CAV')                        # (one per material, whoever asks)
        if t: return t.outputs['Color']
        t = self.n('ShaderNodeTexImage', label='CAV', name='CAV'); t.image = _white(); t.interpolation = 'Linear'
        t.image.colorspace_settings.name = 'Non-Color'; return t.outputs['Color']
    def edge(self):
        """the baked, denoised edge map (1 on outside edges, 0 on flat faces and in hollows): where varnish, paint and pile wear
           through first. bake_set() fills the EDGE image (black until then)"""
        t = self.nt.nodes.get('EDGE')
        if t: return t.outputs['Color']
        t = self.n('ShaderNodeTexImage', label='EDGE', name='EDGE'); t.image = _flat('kit_black', 0.0); t.interpolation = 'Linear'
        return t.outputs['Color']
    def bump(self, h, strength=0.5, dist=0.001, normal=None):
        bp = self.n('ShaderNodeBump', i_Strength=strength, i_Distance=dist); self.l(h, bp.inputs['Height'])
        if normal is not None: self.l(normal, bp.inputs['Normal'])
        return bp.outputs['Normal']
    def out(self, color, rough, normal=None, metal=0.0):
        for name, x in (('Base Color', color), ('Roughness', rough), ('Metallic', metal)):
            if isinstance(x, tuple): self.b.inputs[name].default_value = (*x, 1)
            elif isinstance(x, (int, float)): self.b.inputs[name].default_value = x
            else: self.l(x, self.b.inputs[name])
        if normal is not None: self.l(normal, self.b.inputs['Normal'])
        return self.m

def _flat(name, v):
    im = bpy.data.images.get(name)
    if not im: im = bpy.data.images.new(name, 4, 4, float_buffer=True); im.generated_color = (v, v, v, 1)   # (Cycles reads a generated image's colour, not pixels written into it)
    im.colorspace_settings.name = 'Non-Color'; return im
def _white(): return _flat('kit_white', 1.0)

def aged(m, col, rough, h, up_dust=0.5, grime=0.7, edge_wear=0.0, wear_col=None, wear_rough=0.6, dust_col=(0.27, 0.25, 0.215)):
    """the life a piece has had, over any base: grime packed into every crevice (the baked cavity), edges and handled parts
       worn through to what is underneath (the baked edge map and the 'wear' attribute, broken up by noise), dust settled on whatever faces
       up and wasn't touched, fine scratches. Returns colour, roughness and height sockets."""
    pos = m.attr('gpos', True); cav = m.math('POWER', m.cavity(), 1.0)
    cavf = m.n('ShaderNodeSeparateColor'); m.l(cav, cavf.inputs[0]); cav = cavf.outputs[0]
    # worn through: handled areas and sharp edges, ragged
    if edge_wear or wear_col is not None:
        wn = m.noise(pos, 38, 5, 0.6); wn2 = m.noise(pos, 7, 3, 0.5); wn3 = m.noise(pos, 140, 3, 0.6)
        w = m.math('ADD', m.math('MULTIPLY', m.attr('wear'), 1.05), m.math('MULTIPLY', m.math('POWER', m.edge(), 1.0), edge_wear))
        w = m.math('ADD', w, m.math('MULTIPLY', m.math('SUBTRACT', m.math('ADD', m.math('ADD', wn, m.math('MULTIPLY', wn2, 0.6)), m.math('MULTIPLY', wn3, 0.5)), 1.05), 0.9))
        wc = wear_col if wear_col is not None else col
        thin = m.remap(w, 0.30, 0.46, smooth=True); worn = m.remap(w, 0.46, 0.68, smooth=True)   # (thinned first, then through)
        col = m.mix(m.math('MULTIPLY', thin, 0.5), col, wc); col = m.mix(worn, col, wc)
        rough = m.mixf(worn, m.mixf(thin, rough, (wear_rough + 0.4) / 2), wear_rough)
        h = m.math('SUBTRACT', h, m.math('ADD', m.math('MULTIPLY', worn, 0.25), m.math('MULTIPLY', thin, 0.08)))
    else: worn = m.val(0.0)
    # grime in the crevices (darker, browner, duller), heaviest at the very bottom of each
    gn = m.noise(pos, 24, 5, 0.6)
    g = m.math('MULTIPLY', m.remap(cav, 0.92, 0.35, smooth=True), m.remap(gn, 0.3, 0.7, 0.55, 1.0))
    g = m.math('MULTIPLY', g, grime)
    col = m.mix(g, col, (0.018, 0.013, 0.009)); rough = m.mixf(g, rough, 0.82)
    # dust: on faces that look up, thicker in the corners of them, never where hands go
    nz = m.n('ShaderNodeSeparateXYZ'); m.l(m.geo('Normal'), nz.inputs[0])
    up = m.remap(nz.outputs['Z'], 0.6, 0.97, smooth=True)            # (dust settles on what is nearly level, not on a leaning face)
    dn = m.noise(pos, 60, 5, 0.65); dn2 = m.noise(pos, 5, 3, 0.5)
    d = m.math('MULTIPLY', up, m.remap(m.math('ADD', dn, m.math('MULTIPLY', dn2, 0.5)), 0.55, 1.05, 0.25, 1.0))
    d = m.math('MULTIPLY', d, m.math('ADD', 0.55, m.math('MULTIPLY', m.remap(cav, 1.0, 0.6), 0.6)))
    d = m.math('MULTIPLY', m.math('MULTIPLY', d, m.math('SUBTRACT', 1.0, m.math('MULTIPLY', m.attr('wear'), 0.9))), up_dust)
    col = m.mix(d, col, dust_col); rough = m.mixf(d, rough, 0.93)
    return col, rough, h, worn

def wood(name, species='beech', finish='varnish', stain=None, age=1.0, paint=None, chips=0.5):
    """old wood, grain running along each part (the 'gpos' attribute: z along the grain).
       species: oak (open pores, rays), pine (wide soft rings, knots), mahogany (fine, red), beech (close, flecked), elm
       finish: 'varnish' (amber, crazed, worn through to bare wood on edges and handled parts), 'bare', 'paint' (paint over the
       wood, chipped to it on edges and where handled; paint = '#rrggbb'). stain darkens the wood under the varnish."""
    sp = {'oak': ('#b48c5c', '#6e4a2a', 260, 0.9, 0.5), 'pine': ('#d2b07c', '#93622f', 90, 0.0, 0.0), 'mahogany': ('#8a4a2a', '#4f2412', 420, 0.35, 0.1),
          'beech': ('#c99a6c', '#9a6a42', 380, 0.1, 0.35), 'elm': ('#a57a50', '#5e3f24', 200, 0.6, 0.1)}[species]
    early, late, rings, pores, rays = sp
    m = Mat(name); pos = m.attr('gpos', True); pr = m.attr('prand')
    # rings: distance from a pith far off to one side (long cathedral streaks), wandering; fibres along the grain
    warp = m.noise(m.map(pos, (2.5, 2.5, 0.35)), 1.0, 3, 0.5, color=True)
    wv = m.n('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); m.l(warp, wv.inputs[0]); wv.inputs[1].default_value = (0.012, 0.012, 0.0); m.l(pos, wv.inputs[2])
    rg = m.n('ShaderNodeTexWave', wave_type='RINGS', rings_direction='Z', wave_profile='SAW', i_Scale=rings / 6.28, i_Distortion=1.2, i_Detail=3, i_Detail_Scale=2)
    m.l(wv.outputs[0], rg.inputs['Vector']); ring = m.math('POWER', rg.outputs['Fac'], 2.2)
    fib = m.noise(m.map(pos, (900, 900, 9)), 1.0, 3, 0.7)
    fib2 = m.noise(m.map(pos, (160, 160, 2.5)), 1.0, 4, 0.6)
    t = m.math('ADD', m.math('MULTIPLY', ring, 0.75), m.math('MULTIPLY', m.math('SUBTRACT', fib, 0.5), 0.5))
    t = m.math('ADD', t, m.math('MULTIPLY', m.math('SUBTRACT', fib2, 0.5), 0.4))
    col = m.mix(m.math('ADD', t, 0.0, clamp=True), lin(early), lin(late))
    # pores (dark dashes along the grain) and rays (short lighter flecks across it)
    if pores:
        po = m.remap(m.noise(m.map(pos, (1400, 1400, 60)), 1.0, 2, 0.5), 0.62, 0.72, 0.0, pores)
        col = m.mix(po, col, m.hsv(col, 0.5, 1.1, 0.45))
    if rays:
        ry = m.remap(m.voronoi(m.map(pos, (90, 90, 12)), 1.0, 'Distance'), 0.06, 0.02, 0.0, rays)
        col = m.mix(ry, col, m.hsv(col, 0.5, 0.85, 1.35))
    if species == 'pine':                                   # knots
        kn = m.remap(m.voronoi(m.map(pos, (5, 5, 1.6)), 1.0, 'Distance'), 0.05, 0.015)
        col = m.mix(kn, col, (0.05, 0.022, 0.008))
    col = m.hsv(col, m.remap(pr, 0, 1, 0.47, 0.53), m.remap(pr, 0, 1, 0.85, 1.15), m.remap(pr, 0, 1, 0.74, 1.16))   # (no two parts cut from the same board)
    h = m.math('ADD', m.math('MULTIPLY', ring, 0.35), m.math('MULTIPLY', fib, 0.25))
    bare = m.hsv(col, 0.5, 0.75, 0.9)                       # (old bare wood: greyed, a little darker than fresh)
    rough = m.remap(fib, 0.3, 0.7, 0.62, 0.78)
    if finish == 'varnish':
        # the stain takes its hue and saturation, the grain keeps its light and dark (multiplying warm by warm by warm would
        # end orange); then amber varnish, darkened with age
        wc = m.hsv(m.mix(1.0, col, lin(stain), 'COLOR'), 0.5, 1.0, 0.27) if stain else m.hsv(col, 0.5, 1.0, 0.75)
        wc = m.mix(m.math('MULTIPLY', ring, 0.5), wc, m.hsv(wc, 0.5, 1.15, 0.5))         # (the latewood takes more stain: the figure shows through)
        vc = m.mix(1.0, wc, (0.92, 0.8, 0.62), 'MULTIPLY')
        fade = m.remap(m.noise(pos, 2.2, 3, 0.5), 0.45, 0.75, 0.0, 0.35 * age)              # (sun-faded, unevenly darkened clouds in the old finish)
        vc = m.mix(fade, vc, m.hsv(vc, 0.5, 0.8, 1.35)); vc = m.mix(m.remap(m.noise(pos, 3.1, 3, 0.5), 0.5, 0.2, 0.0, 0.3 * age), vc, m.hsv(vc, 0.5, 1.1, 0.7))
        cr = m.voronoi(m.map(pos, (1, 1, 0.45)), 340, 'Distance', 'DISTANCE_TO_EDGE')   # crazing: a fine network of cracks
        crack = m.math('MULTIPLY', m.remap(cr, 0.035, 0.0), m.remap(m.noise(pos, 6, 3), 0.45, 0.65, 0.0, age))
        vc = m.mix(m.math('MULTIPLY', crack, 0.7), vc, m.hsv(vc, 0.5, 1.0, 0.35))
        vr = m.remap(m.noise(pos, 30, 4), 0.3, 0.7, 0.24, 0.40)                    # (old varnish: satin, patchy)
        sc = m.math('MAXIMUM', m.lines(pos, 9, 0.010, 70, 0.4), m.lines(pos, 13, 0.008, 90, 2.1))
        sc = m.math('MULTIPLY', sc, m.remap(m.noise(pos, 3.5, 2), 0.4, 0.62, 0.0, 0.8 * age))
        vc = m.mix(m.math('MULTIPLY', sc, 0.35), vc, m.hsv(bare, 0.5, 0.7, 0.85)); vr = m.mixf(sc, vr, 0.55)
        h = m.math('SUBTRACT', m.math('MULTIPLY', h, 0.35), m.math('ADD', m.math('MULTIPLY', crack, 0.25), m.math('MULTIPLY', sc, 0.3)))
        # half worn: thinned varnish lighter and more orange, then bare (and hand-darkened) wood
        col, rough, h, worn = aged(m, vc, vr, h, up_dust=0.55 * age, grime=0.75, edge_wear=0.7, wear_col=m.mix(0.38, m.hsv(col, 0.5, 0.78, 0.72), (0.07, 0.045, 0.028)), wear_rough=0.45)   # (bare wood, a little lighter than the varnish, greyed and darkened by hand oil)
    elif finish == 'paint':
        pc = lin(paint or '#e8dcc8')
        pn = m.noise(pos, 14, 4); pcol = m.mix(m.remap(pn, 0.3, 0.7, 0.0, 0.25), pc, (pc[0] * 0.82, pc[1] * 0.8, pc[2] * 0.74))   # (yellowed unevenly)
        prough = m.remap(pn, 0.3, 0.7, 0.45, 0.62)
        h = m.math('MULTIPLY', h, 0.08)
        col, rough, h, worn = aged(m, pcol, prough, h, up_dust=0.6 * age, grime=0.8, edge_wear=chips, wear_col=bare, wear_rough=0.72)
        h = m.math('ADD', h, m.math('MULTIPLY', m.math('SUBTRACT', 1.0, worn), 0.12))   # (the paint's edge stands up from the wood)
    else:
        col, rough, h, worn = aged(m, bare, rough, h, up_dust=0.7 * age, grime=0.85)
    return m.out(col, rough, m.bump(h, 0.35, 0.0008))

def fabric(name, color='#9b6e6a', weave=1.0, fade=0.5, stripes=None, velvet=False, age=1.0):
    """cloth: a visible weave, faded where the light fell (tops), darker in folds, stains, dust; velvet = pile that crushes
       into lighter and darker patches and wears bald. stripes = ('#rrggbb', period m) for ticking or a woven stripe"""
    m = Mat(name); pos = m.attr('gpos', True); base = lin(color)
    col = m.mix(0.0, base, base)
    if stripes:
        sx = m.n('ShaderNodeSeparateXYZ'); m.l(pos, sx.inputs[0])
        s = m.math('SINE', m.math('MULTIPLY', sx.outputs['X'], 6.283 / stripes[1]))
        col = m.mix(m.remap(s, 0.35, 0.55, smooth=True), col, lin(stripes[0]))
    # the weave: warp and weft threads (none under a velvet's pile)
    if velvet: weave = 0.0
    sx = m.n('ShaderNodeSeparateXYZ'); m.l(pos, sx.inputs[0]); f = 1500 * weave
    wa = m.math('SINE', m.math('MULTIPLY', sx.outputs['X'], f)); we = m.math('SINE', m.math('MULTIPLY', sx.outputs['Y'], f))
    cell = m.math('SINE', m.math('MULTIPLY', m.math('ADD', sx.outputs['X'], sx.outputs['Y']), f * 0.5))
    thread = m.mixf(m.remap(cell, -1, 1), m.math('ABSOLUTE', wa), m.math('ABSOLUTE', we))
    slub = m.noise(m.map(pos, (30, 400, 30)), 1.0, 3)
    col = m.mix(m.remap(thread, 0.0, 1.0, 0.12, 0.0), col, m.hsv(col, 0.5, 1.0, 0.7))
    col = m.mix(m.remap(slub, 0.4, 0.7, 0.0, 0.15), col, m.hsv(col, 0.5, 0.9, 1.2))
    rough = m.remap(thread, 0.0, 1.0, 0.86, 0.95)
    h = m.math('ADD', m.math('MULTIPLY', thread, 0.6), m.math('MULTIPLY', slub, 0.3))
    if velvet:
        pile = m.noise(pos, 9, 5, 0.6, 0.6)
        col = m.mix(m.remap(pile, 0.35, 0.65), m.hsv(col, 0.5, 1.05, 0.7), m.hsv(col, 0.5, 0.85, 1.35))
    # sun-faded: lighter, greyer where it faced up and out; tide-mark stains
    nz = m.n('ShaderNodeSeparateXYZ'); m.l(m.geo('Normal'), nz.inputs[0])
    fd = m.math('MULTIPLY', m.remap(nz.outputs['Z'], -0.2, 0.9), m.remap(m.noise(pos, 4, 3), 0.3, 0.7, 0.6 * fade, fade))
    col = m.mix(fd, col, m.hsv(col, 0.5, 0.55, 1.45))
    st = m.voronoi(m.map(pos, (1, 1, 1)), 5.5, 'Distance'); stn = m.noise(pos, 12, 4)
    ring = m.math('MULTIPLY', m.remap(m.math('ADD', st, m.math('MULTIPLY', stn, 0.08)), 0.16, 0.19), m.remap(m.math('ADD', st, m.math('MULTIPLY', stn, 0.08)), 0.22, 0.19))
    blot = m.remap(m.math('ADD', st, m.math('MULTIPLY', stn, 0.1)), 0.2, 0.1, 0.0, 0.35)
    stain = m.math('MULTIPLY', m.math('MAXIMUM', ring, blot), m.remap(m.noise(pos, 1.7, 2), 0.5, 0.62, 0.0, age))
    col = m.mix(stain, col, m.mix(1.0, col, (0.55, 0.42, 0.28), 'MULTIPLY'))
    col, rough, h, worn = aged(m, col, rough, h, up_dust=0.45 * age, grime=0.9, edge_wear=0.4 if velvet else 0.0,
                               wear_col=m.hsv(col, 0.5, 0.6, 1.08) if velvet else None, wear_rough=0.95)   # (bald pile: the duller backing)
    return m.out(col, rough, m.bump(h, 0.25, 0.0006))

def metal(name, kind='iron', color=None, rust=0.4, age=1.0):
    """brass (tarnished brown-green in the hollows, bright where handled), iron (black, rust blooming through), rust,
       steel (grey, scratched), enamel-free. Metalness 1 where it's bare metal, 0 under rust and grime."""
    base = {'brass': '#b08d4a', 'iron': '#3a3836', 'steel': '#8c8f92', 'rust': '#6e3a1c'}[kind]
    m = Mat(name); pos = m.attr('gpos', True); c = lin(color or base)
    col = m.mix(m.remap(m.noise(pos, 20, 5), 0.3, 0.7), c, (c[0] * 0.7, c[1] * 0.7, c[2] * 0.7))
    rough = m.remap(m.noise(pos, 40, 4), 0.3, 0.7, 0.35 if kind != 'iron' else 0.55, 0.6 if kind != 'iron' else 0.8)
    metal_ = m.val(1.0 if kind != 'rust' else 0.0)
    h = m.noise(pos, 300, 4)
    if kind == 'brass':
        tar = m.math('MULTIPLY', m.remap(m.cavity(), 0.95, 0.5), 0.9)
        col = m.mix(tar, col, (0.05, 0.06, 0.035)); rough = m.mixf(tar, rough, 0.7)
    r = m.math('MULTIPLY', m.remap(m.noise(pos, 6, 6, 0.65), 0.55 - 0.25 * rust, 0.75 - 0.2 * rust), 1.0 if kind != 'brass' else 0.0)
    if kind == 'rust': r = m.val(1.0)
    rc = m.mix(m.noise(pos, 80, 6), lin('#5a2a10'), lin('#8a4a1e'))
    col = m.mix(r, col, rc); rough = m.mixf(r, rough, 0.9); metal_ = m.mixf(r, metal_, 0.0)
    h = m.math('ADD', h, m.math('MULTIPLY', r, 0.5))
    col, rough, h, worn = aged(m, col, rough, h, up_dust=0.5 * age, grime=0.8)
    return m.out(col, rough, m.bump(h, 0.3, 0.0006), m.mixf(m.remap(rough, 0.85, 0.95), metal_, 0.0))

def porcelain(name, color='#efe6da', glaze=True, crackle=0.6, age=1.0):
    """bisque or glazed porcelain: smooth, glossy, a fine crackle in the glaze holding dirt, chips to the white body"""
    m = Mat(name); pos = m.attr('gpos', True); c = lin(color)
    col = m.mix(m.remap(m.noise(pos, 8, 3), 0.3, 0.7, 0.0, 0.25), c, (c[0] * 0.92, c[1] * 0.88, c[2] * 0.82))
    cr = m.voronoi(pos, 70, 'Distance', 'DISTANCE_TO_EDGE'); crack = m.math('MULTIPLY', m.remap(cr, 0.02, 0.0), crackle)
    col = m.mix(crack, col, (0.12, 0.1, 0.08))
    rough = m.val(0.12 if glaze else 0.55); h = m.math('MULTIPLY', crack, -0.3)
    col, rough, h, worn = aged(m, col, rough, h, up_dust=0.6 * age, grime=0.9, edge_wear=0.5, wear_col=lin('#f4f0ea'), wear_rough=0.6)
    return m.out(col, rough, m.bump(h, 0.2, 0.0004))

def plaster(name, color='#d8d0bf', age=1.0):
    m = Mat(name); pos = m.attr('gpos', True); c = lin(color)
    n1 = m.noise(pos, 6, 6, 0.6); n2 = m.noise(pos, 60, 4)
    col = m.mix(m.remap(n1, 0.3, 0.7), c, (c[0] * 0.8, c[1] * 0.78, c[2] * 0.72))
    col, rough, h, worn = aged(m, col, m.remap(n2, 0.3, 0.7, 0.8, 0.95), m.math('ADD', n1, m.math('MULTIPLY', n2, 0.3)), up_dust=0.5 * age, grime=0.8)
    return m.out(col, rough, m.bump(h, 0.4, 0.002))

def glass():
    """the reserved 'Glass' material: the loader swaps in its shared transparent one, so this stays a plain stand-in"""
    g = bpy.data.materials.get('Glass')
    if g: return g
    m = Mat('Glass'); return m.out((0.6, 0.65, 0.65), 0.05)

def reserved(name, color=(0.5, 0.5, 0.5), emit=False):
    """the other reserved materials (WallSurface, SkyPlane, Emit): plain stand-ins the game's loader replaces"""
    g = bpy.data.materials.get(name)
    if g: return g
    m = Mat(name); m.out(color, 0.9)
    if emit: m.b.inputs['Emission Color'].default_value = (*color, 1); m.b.inputs['Emission Strength'].default_value = 1.0
    return m.m

def grey(name='Kit_grey', color=(0.42, 0.42, 0.42)):
    g = bpy.data.materials.get(name)
    if g: return g
    m = Mat(name); return m.out(color, 0.8)

# ---------------------------------------------------------------- baking
def _bake_image(name, px, float_=True, color=False):
    im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, px, px, alpha=False, float_buffer=float_)
    # raw floats, the colour bake too (it is linear anyway): with a colour space set, image.save() writes display-encoded values
    # into the EXR (0.146 comes back 0.418), and the colour would be encoded twice
    im.colorspace_settings.name = 'Non-Color'
    return im

def _target_nodes(objs, im):
    """point every material of objs at im (the active image node is where Cycles bakes to)"""
    for o in objs:
        for slot in o.material_slots:
            nt = slot.material.node_tree; n = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage'); n.name = 'BAKE'
            n.image = im; nt.nodes.active = n

def save_exr(im, path):
    sc = bpy.context.scene; sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    im.filepath_raw = path; im.file_format = 'OPEN_EXR'; im.save(); return path

def pixels(im):
    """an image's pixels as a float array (height, width, 4), row 0 at the top"""
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)[::-1]

def load_exr(path):
    im = bpy.data.images.load(path, check_existing=False); im.colorspace_settings.name = 'Non-Color'
    a = pixels(im); bpy.data.images.remove(im); return a

def denoise_image(src, dst):
    """denoise an EXR through the compositor (Blender 5: a compositor node group as the scene's compositing tree), written
       as EXR with the Standard view transform so the data passes through untouched"""
    sc = bpy.context.scene; im = bpy.data.images.load(src, check_existing=False); im.colorspace_settings.name = 'Non-Color'
    keep = (sc.render.resolution_x, sc.render.resolution_y, sc.cycles.samples, sc.camera, sc.render.filepath, sc.compositing_node_group)
    hidden = [o for o in sc.objects if not o.hide_render]
    for o in hidden: o.hide_render = True
    tree = bpy.data.node_groups.new('kit_denoise', 'CompositorNodeTree'); sc.compositing_node_group = tree
    inode = tree.nodes.new('CompositorNodeImage'); inode.image = im
    dn = tree.nodes.new('CompositorNodeDenoise'); dn.inputs['HDR'].default_value = True
    for k, v in (('Prefilter', 'ACCURATE'), ('Quality', 'HIGH')):
        try: dn.inputs[k].default_value = v
        except Exception: pass
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor'); go = tree.nodes.new('NodeGroupOutput')
    tree.links.new(inode.outputs['Image'], dn.inputs['Image']); tree.links.new(dn.outputs['Image'], go.inputs[0])
    cam = sc.camera or link(bpy.data.objects.new('kit_dn_cam', bpy.data.cameras.new('kit_dn_cam'))); sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = im.size[0], im.size[1]; sc.render.resolution_percentage = 100
    sc.render.use_compositing = True; sc.cycles.samples = 1
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    s = sc.render.image_settings; s.file_format = 'OPEN_EXR'; s.color_depth = '32'; s.exr_codec = 'ZIP'
    sc.render.filepath = dst; bpy.ops.render.render(write_still=True)
    for o in hidden: o.hide_render = False
    sc.render.resolution_x, sc.render.resolution_y, sc.cycles.samples, sc.camera, sc.render.filepath, sc.compositing_node_group = keep
    if sc.camera is None and 'kit_dn_cam' in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects['kit_dn_cam'])
    bpy.data.node_groups.remove(tree); bpy.data.images.remove(im)
    return dst

def to_srgb(a):
    a = np.clip(a, 0, 1); return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)

def to_webp(a, path, quality=86, srgb=False, normal=False, tiers=True, rgba=False):
    """float pixels (h, w, 3 or 4; row 0 at the top) -> WebP via Pillow, plus the tier copies <name>.md.webp (half) and
       <name>.lo.webp (quarter) when path ends in .hi.webp. Normal maps are renormalised after shrinking. rgba: keep the 4th
       channel as (linear) alpha"""
    from PIL import Image
    al = np.clip(a[..., 3:4], 0, 1) if rgba else None
    a = a[..., :3]; a = to_srgb(a) if srgb else np.clip(a, 0, 1)
    if rgba: a = np.concatenate([a, al], axis=-1)
    img = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGBA' if rgba else 'RGB'); out = [path]
    img.save(path, 'WEBP', quality=quality, method=6)
    if tiers and path.endswith('.hi.webp'):
        for t, k in TIERS.items():
            if k == 1: continue
            w, h = max(16, img.width // k), max(16, img.height // k); small = img.resize((w, h), Image.LANCZOS)
            if normal:
                v = np.asarray(small, np.float32) / 127.5 - 1; v /= np.maximum(1e-6, np.linalg.norm(v, axis=2, keepdims=True))
                small = Image.fromarray(((v + 1) * 127.5 + 0.5).clip(0, 255).astype(np.uint8), 'RGB')
            p = path.replace('.hi.webp', f'.{t}.webp'); small.save(p, 'WEBP', quality=quality, method=6); out.append(p)
    return out

def pack_orm(ao, rough, metal):
    """R = ambient occlusion, G = roughness, B = metalness (glTF's occlusion and metallicRoughness read the same image)"""
    return np.stack([ao[..., 0], rough[..., 0], metal[..., 0]], axis=-1)

def _metal_to_emit(objs):
    """the emission trick: Cycles can't bake metalness, so wire whatever drives each material's Metallic into an Emission
       shader on the output for an EMIT bake. Returns a function that puts the materials back."""
    undo = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material; nt = m.node_tree; b = nt.nodes.get('Principled BSDF'); out = nt.nodes.get('Material Output')
            if not b or not out: continue
            em = nt.nodes.new('ShaderNodeEmission'); src = b.inputs['Metallic']
            if src.is_linked: nt.links.new(src.links[0].from_socket, em.inputs['Color'])
            else: v = src.default_value; em.inputs['Color'].default_value = (v, v, v, 1)
            old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
            nt.links.new(em.outputs[0], out.inputs['Surface']); undo.append((nt, em, out, old))
    def back():
        for nt, em, out, old in undo:
            if old: nt.links.new(old, out.inputs['Surface'])
            nt.nodes.remove(em)
    return back

def _alpha_to_emit(objs):
    """like the metalness trick: each material's 'ALPHA' node (cut-out cloth, lace: data, not wired to the BSDF while baking)
       through an Emission shader, 1 where a material has none. Returns a function that puts the materials back."""
    undo = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material; nt = m.node_tree; out = nt.nodes.get('Material Output')
            if not out: continue
            em = nt.nodes.new('ShaderNodeEmission'); a = nt.nodes.get('ALPHA')
            if a: nt.links.new(a.outputs[0], em.inputs['Color'])
            else: em.inputs['Color'].default_value = (1, 1, 1, 1)
            old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
            nt.links.new(em.outputs[0], out.inputs['Surface']); undo.append((nt, em, out, old))
    def back():
        for nt, em, out, old in undo:
            if old: nt.links.new(old, out.inputs['Surface'])
            nt.nodes.remove(em)
    return back

def bake_set(objs, name, px=2048, samples=64, high=None, cage=0.02, cavity=0.05, ao_dist=0.25, edge=0.008, margin=None, out_dir=None):
    """bake objs (all sharing one uv0 atlas) into name's maps in out_dir (default /tmp/efbb-kit/tex/<name>):
         cavity (AO 5 cm), AO (25 cm, samples spp) and edges (AO looking inward, 8 mm), all denoised; cavity and edges are fed
         back into the materials (CAV, EDGE) so grime, dust and wear follow the real crevices and edges; then DIFFUSE colour, ROUGHNESS, metalness (emission trick) and a tangent
         NORMAL map (selected-to-active from high = {low object: high object} where a sculpted source exists).
       Writes albedo/normal/orm .hi/.md/.lo.webp and returns {map: hi path} plus timings."""
    sc = bpy.context.scene; px = res(px); samples = spp(samples); t0 = time.time(); times = {}
    out_dir = out_dir or os.path.join(TMP, 'tex', name); os.makedirs(out_dir, exist_ok=True)
    sc.render.bake.margin = margin or max(4, px // 128); sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_selected_to_active = False; sc.render.bake.use_clear = True
    shown = {o: o.hide_render for o in sc.objects}
    for o in sc.objects: o.hide_render = o not in objs and o not in (high or {}).values()
    for o in (high or {}).values(): o.hide_render = True
    select(objs)
    def bake(kind, im, n_spp, **kw):
        _target_nodes(objs, im); sc.cycles.samples = n_spp; t = time.time()
        bpy.ops.object.bake(type=kind, **kw); times[kind.lower() + ('_' + im.name.split('_')[-1] if kind == 'AO' else '')] = round(time.time() - t, 1)
    exr = lambda k: os.path.join(out_dir, f'{k}.exr')
    # AO only needs the geometry: a plain material while it bakes (Cycles would evaluate the whole procedural shader, bump and
    # all, at every one of its samples: ten times slower)
    plain = bpy.data.materials.get('kit_ao') or Mat('kit_ao').out((0.8, 0.8, 0.8), 0.5)
    slots = [(sl, sl.material) for o in objs for sl in o.material_slots]
    for sl, _ in slots: sl.material = plain
    for k, dist in (('cav', cavity), ('ao', ao_dist)):
        sc.world.light_settings.distance = dist; im = _bake_image(f'{name}_{k}', px); bake('AO', im, samples)
        save_exr(im, exr(k + '_raw')); t = time.time(); denoise_image(exr(k + '_raw'), exr(k)); times['denoise_' + k] = round(time.time() - t, 1)
    # edges: occlusion looking into the wood (8 mm): a ray from a rounded outside edge soon leaves through the next face, on a
    # flat face of a board it doesn't (a 9 mm spindle scores ~0.2: mild). The same on any mesh density: a vertex attribute
    # can't tell a flat face from a corner when only the corners have vertices.
    em = bpy.data.materials.get('kit_edge')
    if not em:
        e = Mat('kit_edge'); ao = e.n('ShaderNodeAmbientOcclusion', inside=True, only_local=True, samples=16, i_Distance=edge)
        emi = e.n('ShaderNodeEmission'); e.l(e.remap(e.math('SUBTRACT', 1.0, ao.outputs['AO']), 0.10, 0.45, smooth=True), emi.inputs['Color'])
        e.l(emi.outputs[0], e.out_node.inputs['Surface']); em = e.m
    for sl, _ in slots: sl.material = em
    im = _bake_image(f'{name}_edge', px); _target_nodes(objs, im); sc.cycles.samples = max(4, samples // 4); t = time.time()
    bpy.ops.object.bake(type='EMIT'); times['edge'] = round(time.time() - t, 1); save_exr(im, exr('edge_raw')); denoise_image(exr('edge_raw'), exr('edge'))
    for sl, m in slots: sl.material = m
    for key, node in (('cav', 'CAV'), ('edge', 'EDGE')):
        img = bpy.data.images.load(exr(key), check_existing=False); img.colorspace_settings.name = 'Non-Color'
        for o in objs:
            for slot in o.material_slots:
                n = slot.material.node_tree.nodes.get(node)
                if n: n.image = img
    col = _bake_image(f'{name}_col', px, color=True); sc.render.bake.use_pass_direct = sc.render.bake.use_pass_indirect = False
    # (a metal has no diffuse colour: Cycles' colour pass would bake brass and iron black; their albedo is the base colour)
    undo = []
    for o in objs:
        for slot in o.material_slots:
            b_ = slot.material.node_tree.nodes.get('Principled BSDF') if slot.material and slot.material.node_tree else None
            if not b_: continue
            inp = b_.inputs['Metallic']; src = inp.links[0].from_socket if inp.is_linked else None
            if src: slot.material.node_tree.links.remove(inp.links[0])
            undo.append((slot.material, inp, src, inp.default_value)); inp.default_value = 0.0
    sc.render.bake.use_pass_color = True; bake('DIFFUSE', col, max(4, samples // 8)); save_exr(col, exr('col'))
    for m_, inp, src, v in undo:
        inp.default_value = v
        if src: m_.node_tree.links.new(src, inp)
    rough = _bake_image(f'{name}_rough', px); bake('ROUGHNESS', rough, 4); save_exr(rough, exr('rough'))
    met = _bake_image(f'{name}_metal', px); back = _metal_to_emit(objs); bake('EMIT', met, 4); back(); save_exr(met, exr('metal'))
    has_alpha = any(sl.material and sl.material.node_tree.nodes.get('ALPHA') for o in objs for sl in o.material_slots)
    if has_alpha:                                           # (cut-outs: the albedo's alpha channel, a mask)
        alp = _bake_image(f'{name}_alpha', px); back = _alpha_to_emit(objs); bake('EMIT', alp, 8); back(); save_exr(alp, exr('alpha'))
    nrm = _bake_image(f'{name}_normal', px); bake('NORMAL', nrm, 4, normal_space='TANGENT')
    if high:                                                # (sculpted sources baked over their low parts, the rest kept)
        sc.render.bake.use_selected_to_active = True; sc.render.bake.use_clear = False; sc.render.bake.cage_extrusion = cage
        sc.render.bake.max_ray_distance = cage * 3
        for lo, hi in high.items():
            hi.hide_render = False; select([hi, lo], lo); _target_nodes([lo], nrm); t = time.time()
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT'); times['normal_hp_' + lo.name] = round(time.time() - t, 1); hi.hide_render = True
        sc.render.bake.use_selected_to_active = False; sc.render.bake.use_clear = True
    save_exr(nrm, exr('normal'))
    # albedo = colour x cavity grime (0.6 + 0.4 AO at 5 cm): contact shading that shows under the flashlight too
    c = load_exr(exr('col')); cv = load_exr(exr('cav')); ao = load_exr(exr('ao'))
    alb = c[..., :3] * (0.6 + 0.4 * np.clip(cv[..., :1], 0, 1))
    if has_alpha: alb = np.concatenate([alb, load_exr(exr('alpha'))[..., :1]], axis=-1)
    files = {'albedo': to_webp(alb, os.path.join(out_dir, 'albedo.hi.webp'), 86, srgb=True, rgba=has_alpha)[0], 'alpha': has_alpha,
             'normal': to_webp(load_exr(exr('normal')), os.path.join(out_dir, 'normal.hi.webp'), 92, normal=True)[0],
             'orm': to_webp(pack_orm(np.clip(ao, 0, 1), load_exr(exr('rough')), load_exr(exr('metal'))), os.path.join(out_dir, 'orm.hi.webp'), 86)[0]}
    for o, h in shown.items(): o.hide_render = h
    times['total'] = round(time.time() - t0, 1); files['times'] = times; files['px'] = px; files['spp'] = samples
    json.dump(times, open(os.path.join(out_dir, 'times.json'), 'w'))
    return files

def _gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g: return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', socket_type='NodeSocketFloat'); g.interface.new_socket('Thickness', socket_type='NodeSocketFloat')
    g.nodes.new('NodeGroupOutput'); g.nodes.new('NodeGroupInput'); return g

def baked_material(name, files, double=False, alpha=None):
    """the material that ships (single-sided unless double): plain Principled with the baked albedo (sRGB), normal map and ORM (R occlusion through the
       glTF output group, G roughness, B metalness), every map one image file the exporter passes through unchanged"""
    old = bpy.data.materials.get(name)
    if old: old.name = name + '_src'
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    m.use_backface_culling = not double                     # (a peel or a card textured on both sides: double=True)
    def tex(key, srgb):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(files[key], check_existing=True)
        t.image.name = f'{name}_{key}'                     # (unique: every asset's files are called albedo.hi.webp...)
        t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'; return t
    a = tex('albedo', True); nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    alpha = files.get('alpha') if alpha is None else alpha
    if alpha == 'blend':                                     # (a veil: lace, net; glTF BLEND)
        nt.links.new(a.outputs['Alpha'], b.inputs['Alpha'])
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    elif alpha:                                             # (a cut-out: alpha clipped at 0.5, exported as glTF MASK)
        rd = nt.nodes.new('ShaderNodeMath'); rd.operation = 'ROUND'; nt.links.new(a.outputs['Alpha'], rd.inputs[0]); nt.links.new(rd.outputs[0], b.inputs['Alpha'])
        try: m.surface_render_method = 'DITHERED'
        except Exception: pass
    n = tex('normal', False); nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    o = tex('orm', False); sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = _gltf_output_group(); nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    return m

# ---------------------------------------------------------------- saving, export, compression
def register(asset, roots, blend=None, inputs=()):
    """save the scene's finished nodes (roots and everything under them; nothing else) as /tmp/efbb-kit/<asset>.blend and
       record which kit nodes it provides, for pack.py"""
    blend = blend or os.path.join(TMP, asset + '.blend'); keep = set()
    for r in roots: keep.add(r); keep.update(r.children_recursive)
    for o in list(bpy.data.objects):
        if o not in keep: bpy.data.objects.remove(o)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    os.makedirs(os.path.join(TMP, 'assets'), exist_ok=True)
    json.dump({'asset': asset, 'blend': blend, 'nodes': [r.name for r in roots], 'time': time.time(), 'placeholder': asset.startswith('placeholder'),
               'preview': OPTS.preview, 'inputs': INPUTS + _digest(inputs)},
              open(os.path.join(TMP, 'assets', asset + '.json'), 'w'), indent=1)
    return blend

def export_glb(objs, path):
    """glTF binary of objs (with their children): y up, modifiers applied, no lights, no vertex colours (the bake attributes
       stay behind), custom properties as extras, WebP images (files already WebP pass through as they are)"""
    keep = set()
    for o in objs: keep.add(o); keep.update(o.children_recursive)
    select(list(keep))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_lights=False, export_cameras=False, export_vertex_color='NONE', export_extras=True,
                              export_image_format='WEBP', export_image_quality=86, export_texcoords=True, export_normals=True,
                              export_tangents=False, export_attributes=False, export_animations=False, export_skins=False,
                              export_morph=True, export_materials='EXPORT')
    return path

def node_script(src, name):
    """a copy of a node script next to GLTFT's node_modules (node looks for packages beside the script, not
       in the working directory), refreshed when the original changes. src is a path or the script's text."""
    text = open(src).read() if os.path.exists(src) else src; dst = os.path.join(GLTFT, name)
    if not os.path.exists(dst) or open(dst).read() != text: open(dst, 'w').write(text)
    return dst

def compress(src, dst, ratio=None, err=None, targets=None):
    """meshopt compression (positions stay exact floats); ratio/err also simplify (lo: 0.5, 0.0015). compress-kit.mjs is
       tools/compress-glb.mjs keeping the empty socket and pivot nodes, which that one's prune() deletes."""
    js = node_script(os.path.join(HERE, 'compress-kit.mjs'), 'kit-compress.mjs')
    cmd = ['node', js, src, dst] + ([str(ratio), str(err or 0.0015)] + ([targets] if targets else []) if ratio else [])
    r = subprocess.run(cmd, cwd=GLTFT, capture_output=True, text=True)
    if r.returncode: raise RuntimeError('compress-glb failed: ' + r.stderr[-2000:])
    return dst

def glb_json(path):
    import struct
    d = open(path, 'rb').read(); L = struct.unpack('<I', d[12:16])[0]
    return json.loads(d[20:20 + L])
