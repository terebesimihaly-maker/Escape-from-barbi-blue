# Escape from Barbi Blue: the players' clothes, made in Blender from the teammate model (models/barbi.glb).
# Run with Blender's Python module:  pip install bpy  then  python tools/blender/player_clothes.py
# Output: /tmp/efbb-player/clothes.blend (tools/blender/player_build.py adds the hair and exports models/player.glb).
# How: the body, her top and her shorts are merged and rebuilt as one closed skin (voxel remesh); each garment is cut
# out of it along smooth curves (clean necklines, cuffs and hems), relaxed, lifted off the body and skinned to the rig.
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from mathutils.bvhtree import BVHTree
OUT = '/tmp/efbb-player'; os.makedirs(OUT, exist_ok=True)
body, arm = load()

def apply_mod(o, m):
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)
def joined(names, name):
    objs = [dup(bpy.data.objects[n], name + '_' + n) for n in names]
    for o in objs:
        for m in list(o.modifiers): o.modifiers.remove(m)
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name; return objs[0]

# ---- one closed skin: body + her top + her shorts, thickened, remeshed, the outside kept
proxy = joined(['Body', 'Top', 'Shorts'], 'Proxy')
bmP = bmesh.new(); bmP.from_mesh(proxy.data); bmP.normal_update(); tree = BVHTree.FromBMesh(bmP)
bmB = bmesh.new(); bmB.from_mesh(body.data); bmB.normal_update(); treeB = BVHTree.FromBMesh(bmB)
skin = dup(proxy, 'Skin')
m = skin.modifiers.new('so', 'SOLIDIFY'); m.thickness = 0.018; m.offset = -1; m.use_rim = True; apply_mod(skin, m)
m = skin.modifiers.new('rm', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = 0.007; m.use_smooth_shade = True; apply_mod(skin, m)
bm = bmesh.new(); bm.from_mesh(skin.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if (lambda r: r[0] is None or (v.co - r[0]).dot(r[1]) < -0.006)(tree.find_nearest(v.co))], context='VERTS')
keep_largest(bm, 0.02)
# (where the bare body poked out through her old top, that test can take bits of the outside too: small holes, filled here)
def boundary_loops(bm):
    seen = set(); loops = []
    for e0 in [e for e in bm.edges if e.is_boundary]:
        if e0 in seen: continue
        stack = [e0]; loop = []; seen.add(e0)
        while stack:
            e = stack.pop(); loop.append(e)
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2.is_boundary and e2 not in seen: seen.add(e2); stack.append(e2)
        loops.append(loop)
    return loops
small = [e for loop in boundary_loops(bm) if len(loop) < 60 for e in loop]
if small:
    res = bmesh.ops.holes_fill(bm, edges=small, sides=0)
    bmesh.ops.triangulate(bm, faces=res['faces'])
print('filled', len(small), 'hole edges')
bm.to_mesh(skin.data); bm.free()

# ---- skin where the body has none (it had her top and shorts over it): shows at a low neckline, under a skirt, in a gap
fill = dup(skin, 'BodyFill'); bm = bmesh.new(); bm.from_mesh(fill.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if (lambda r: r[0] is not None and (f.calc_center_median() - r[0]).length < 0.004)(treeB.find_nearest(f.calc_center_median()))], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.normal_update()
for v in bm.verts: v.co -= v.normal * 0.0015            # (a hair under the body's own surface where they meet)
bm.to_mesh(fill.data); bm.free()

# ---- the cuts (object space = world space here)
def neckline(z0=1.268, dip=0.02, rx=0.074, ry=0.066):
    def f(q):
        if q.z < 1.10: return -1
        dx = q.x / rx; dy = (q.y + 0.006) / ry; r = (dx * dx + dy * dy) ** 0.5
        if r > 1.9: return -1
        return (q.z - (z0 - dip * max(0.0, -(q.y + 0.006) / ry) ** 2)) + (1.0 - r) * 0.05
    return f
def along(a, b, k, side_x, zmax):
    fs = []
    for s in (1, -1):
        A = Vector((a[0] * s, a[1], a[2])); B = Vector((b[0] * s, b[1], b[2])); d = (B - A).normalized(); c = A.lerp(B, k)
        fs.append(lambda q, c=c, d=d, s=s: (q - c).dot(d) if q.x * s > side_x and q.z < zmax else -1)
    return fs
forearm = lambda k: along((0.215, -0.003, 1.035), (0.238, -0.034, 0.826), k, 0.16, 1.1)
upperarm = lambda k: along((0.150, -0.019, 1.243), (0.215, -0.003, 1.035), k, 0.13, 1.3)
hem = lambda z: (lambda q: (z - q.z) if abs(q.x) < 0.195 else -1)
waist = lambda z: (lambda q: (q.z - z) if abs(q.x) < 0.195 or q.z > 1.05 else -1)
no_arms = lambda q: 1 if abs(q.x) > 0.2 and q.z > 0.6 else -1
below = lambda z: (lambda q: z - q.z)
feet_only = lambda z: (lambda q: q.z - z)

def garment(name, cuts, offset, smooth=3, verts=3000, src=None):
    o = dup(src or skin, name); bm = bmesh.new(); bm.from_mesh(o.data)
    for c in cuts: cut(bm, c)
    keep_largest(bm)
    for _ in range(smooth): bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if not v.is_boundary], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in bm.verts:                                     # (never inside the body: at least `offset` outside it)
        loc, no, idx, d = tree.find_nearest(v.co)
        if loc is None: v.co += v.normal * offset; continue
        s = (v.co - loc).dot(no); v.co = loc + no * max(s, 0) + v.normal * offset
    bm.to_mesh(o.data); bm.free()
    decimate(o, verts)
    push_out(o, offset)
    return o
def push_out(o, offset):
    # (after simplifying: every vertex at least `offset` outside the body, her old top and shorts, and the bare body itself,
    # whose chest pokes out through the top it used to wear), then a little smoothing of what moved
    bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update(); moved = set()
    for v in bm.verts:
        for tr, need in ((tree, offset), (treeB, offset + 0.002)):
            loc, no, idx, d = tr.find_nearest(v.co)
            if loc is None: continue
            s = (v.co - loc).dot(no)
            if s < need: v.co += no * (need - s); moved.add(v)
    bmesh.ops.smooth_vert(bm, verts=[v for v in moved if not v.is_boundary], factor=0.3, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update(); bm.to_mesh(o.data); bm.free()
def decimate(o, verts):
    if len(o.data.vertices) <= verts: return
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = verts / len(o.data.vertices); m.use_collapse_triangulate = True; apply_mod(o, m)
def rim(o, depth=0.003):
    # a thin band folded in at every open edge (a neckline, a cuff, a hem): the cloth looks thick where you see its edge
    bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update()
    edges = [e for e in bm.edges if e.is_boundary]
    nor = {v: v.normal.copy() for e in edges for v in e.verts}
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in new:
        src = [e.other_vert(v) for e in v.link_edges if e.other_vert(v) in nor]
        n = src[0].normal if src else v.normal
        v.co -= (nor[src[0]] if src else n) * depth
    bm.normal_update(); bm.to_mesh(o.data); bm.free()

t = time.time()
G = {}
G['Tee'] = garment('Tee', [neckline(dip=0.03)] + upperarm(0.8) + [hem(0.872)], 0.006, verts=2400)
G['LongTop'] = garment('LongTop', [neckline()] + forearm(0.84) + [hem(0.872)], 0.006, verts=2900)
G['Hoodie'] = garment('Hoodie', [neckline(z0=1.285, dip=0.015, rx=0.08, ry=0.072)] + forearm(0.86) + [hem(0.84)], 0.012, smooth=6, verts=2900)
G['Trousers'] = garment('Trousers', [waist(0.955), no_arms, below(0.112)], 0.005, verts=2900)
G['ShortPants'] = garment('ShortPants', [waist(0.955), no_arms, below(0.58)], 0.005, verts=1700)
G['Sneakers'] = garment('Sneakers', [feet_only(0.118)], 0.007, smooth=4, verts=1100)
print('garments %.1fs' % (time.time() - t), {k: len(v.data.vertices) for k, v in G.items()})

# ---- the sneakers: a flat sole under them
bm = bmesh.new(); bm.from_mesh(G['Sneakers'].data)
for v in bm.verts:
    if v.co.z < 0.03: v.co.z = 0.006 + (v.co.z - 0.006) * 0.25 if v.co.z > 0.006 else 0.004
bm.to_mesh(G['Sneakers'].data); bm.free()

# ---- the hoodie: a pocket on the belly and a hood lying on the back
def patch(src, name, f, lift):
    o = dup(src, name); bm = bmesh.new(); bm.from_mesh(o.data); cut(bm, f); keep_largest(bm); bm.normal_update()
    for v in bm.verts: v.co += v.normal * lift
    bm.to_mesh(o.data); bm.free(); return o
pocket = patch(G['Hoodie'], 'HoodiePocket', lambda q: max(abs(q.x) - (0.105 - (q.z - 0.86) * 0.25), q.z - 1.0, 0.865 - q.z, q.y + 0.02) , 0.004)
hood = patch(G['Hoodie'], 'HoodieHood', lambda q: max(q.z - 1.33, 1.13 - q.z, -(q.y - 0.02) + abs(q.x) * 0.25, abs(q.x) - 0.15), 0.014)
bm = bmesh.new(); bm.from_mesh(hood.data); bm.normal_update()
for v in bm.verts:                                          # (a folded hood: fuller in the middle)
    k = max(0.0, 1 - abs(v.co.x) / 0.15) * max(0.0, 1 - abs(v.co.z - 1.25) / 0.1)
    v.co += v.normal * 0.02 * k
bm.to_mesh(hood.data); bm.free()
for p in (pocket, hood):
    with bpy.context.temp_override(active_object=G['Hoodie'], selected_editable_objects=[G['Hoodie'], p], object=G['Hoodie']): bpy.ops.object.join()

# ---- a skirt: a flared tube round the hips (with her shorts kept under it for the gap between the legs)
def skirt():
    import math
    rings, seg = 9, 48; verts = []; faces = []
    for i in range(rings):
        z = 0.955 - i * (0.955 - 0.60) / (rings - 1)
        for j in range(seg):
            a = j / seg * math.tau; dx, dy = math.sin(a), -math.cos(a)
            # (the hips' width at this height, from the skin; then flare out)
            hit = tree.ray_cast(Vector((dx * 0.5, dy * 0.5 - 0.03, z)), Vector((-dx, -dy, 0)), 1.0) if False else None
            r = None
            for rr in [x / 200 for x in range(60, 0, -1)]:
                p = Vector((dx * rr, dy * rr - 0.03, z)); loc, no, idx, d = tree.find_nearest(p)
                if d is not None and d < 0.006: r = rr; break
            base = verts[j][0:2] if False else None
            verts.append((dx, dy, z, r))
    # fill in: each column takes the widest hip it met above it, plus a flare
    out = []
    for j in range(seg):
        widest = 0.0
        for i in range(rings):
            dx, dy, z, r = verts[i * seg + j]; widest = max(widest, (r or 0) + 0.008)
            flare = (0.955 - z) * 0.22
            out.append(Vector((dx * (widest + flare), dy * (widest + flare) - 0.03, z)))
    me = bpy.data.meshes.new('Skirt'); faces = [(i * seg + j, i * seg + (j + 1) % seg, (i + 1) * seg + (j + 1) % seg, (i + 1) * seg + j) for i in range(rings - 1) for j in range(seg)]
    me.from_pydata([tuple(v) for v in out], [], faces); me.update()
    o = bpy.data.objects.new('Skirt', me); bpy.context.scene.collection.objects.link(o)
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = 1; apply_mod(o, m)
    for p in o.data.polygons: p.use_smooth = True
    return o
G['Skirt'] = skirt()

# ---- every garment: a little thickness at the edges, its own UVs (for the cloth texture), skinned like the body under it
for n, o in G.items():
    o.parent = arm
    for mm in list(o.modifiers): o.modifiers.remove(mm)
    if n != 'Skirt': rim(o)
    else: m = o.modifiers.new('so', 'SOLIDIFY'); m.thickness = 0.003; m.offset = -1; m.use_rim = True; apply_mod(o, m)
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.view_layer.objects: ob.select_set(ob == o)
    with bpy.context.temp_override(active_object=o, object=o, selected_editable_objects=[o]):
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    transfer_weights(o, proxy)
    am = o.modifiers.new('Armature', 'ARMATURE'); am.object = arm
decimate(fill, 2200); fill.parent = arm; transfer_weights(fill, proxy); fill.modifiers.new('Armature', 'ARMATURE').object = arm
for n in ('Proxy', 'Skin'): bpy.data.objects.remove(bpy.data.objects[n])
bpy.ops.wm.save_as_mainfile(filepath=OUT + '/clothes.blend')
print('done %.1fs' % (time.time() - t), {k: len(v.data.vertices) for k, v in G.items()}, 'fill', len(fill.data.vertices))
