# Escape from Barbi Blue: the players' hair, made in Blender: strands grown from the scalp (the model's hair cap), draped
# over the head and shoulders, turned into thin hair cards with a strand texture (tools/blender/hair_texture.py).
# Styles: HairShort, HairBob, HairLong, HairPony, HairBun, HairCurly (the old cap stays under them all as the scalp).
import sys, os, math, random; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from mathutils.bvhtree import BVHTree
OUT = '/tmp/efbb-player'

def build_hair(arm):
    cap, head, body = bpy.data.objects['HairCap'], bpy.data.objects['Head'], bpy.data.objects['Body']
    # what the hair lies on: the head, the cap and the shoulders (the rest pose)
    bm = bmesh.new()
    for o in (head, cap, body): bm.from_mesh(o.data)
    bm.normal_update(); tree = BVHTree.FromBMesh(bm)
    # root points spread evenly over the cap
    cm = bmesh.new(); cm.from_mesh(cap.data); bmesh.ops.triangulate(cm, faces=cm.faces); cm.normal_update()
    tris = [(f.verts[0].co.copy(), f.verts[1].co.copy(), f.verts[2].co.copy(), f.normal.copy(), f.calc_area()) for f in cm.faces]
    total = sum(t[4] for t in tris)
    def roots(n, rng, keep=lambda p, nor: True):
        out = []
        acc = []; s = 0
        for t in tris: s += t[4]; acc.append(s)
        import bisect
        tries = 0
        while len(out) < n and tries < n * 20:
            tries += 1
            i = bisect.bisect(acc, rng.random() * total); i = min(i, len(tris) - 1); a, b, c, nor, _ = tris[i]
            u, v = rng.random(), rng.random()
            if u + v > 1: u, v = 1 - u, 1 - v
            p = a + (b - a) * u + (c - a) * v
            if keep(p, nor): out.append((p, nor))
        return out
    def surf(p):
        loc, no, idx, d = tree.find_nearest(p); return loc, no, d
    # grow one strand: start along dir0 (projected onto the head), gravity pulls more and more, never inside the head
    def grow(p, nor, dir0, length, n, clear, grav=1.0, stop=None, pull=None, curl=0.0, rng=None):
        pts = [p + nor * clear * 0.5]; d = (dir0 - nor * dir0.dot(nor)).normalized() if (dir0 - nor * dir0.dot(nor)).length > 1e-4 else dir0.normalized()
        d = (d + nor * 0.25).normalized(); step = length / n; ph = rng.random() * 6.28 if rng else 0
        for i in range(n):
            t = (i + 1) / n
            if pull is not None:                              # (pulled back towards a point: a ponytail or a bun)
                d = (d * 0.35 + (pull - pts[-1]).normalized() * 0.65).normalized()
            d = (d + Vector((0, 0, -1)) * grav * (0.45 + 0.8 * t) * step * 14).normalized()
            q = pts[-1] + d * step
            loc, no, dist = surf(q)
            if loc is not None:
                s = (q - loc).dot(no)
                if s < clear: q = loc + no * clear
            if curl:
                ax = d; perp = ax.cross(Vector((0, 0, 1))); perp = perp.normalized() if perp.length > 1e-4 else Vector((1, 0, 0))
                perp2 = ax.cross(perp)
                q = q + (perp * math.cos(ph + t * curl) + perp2 * math.sin(ph + t * curl)) * 0.006
            d = (q - pts[-1]).normalized(); pts.append(q)
            if stop and stop(q): break
        return pts
    def card(verts, faces, uvs, cols, pts, width, rng, axis=None, root_dark=0.55, depth=1.0):
        c = rng.randrange(4); u0 = c / 4 + 0.015; u1 = (c + 1) / 4 - 0.015
        n = len(pts); base = len(verts)
        for i, q in enumerate(pts):
            d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            if axis is None:
                loc, no, dist = surf(q); no = no if loc is not None else Vector((0, 0, 1))
                w = d.cross(no)
            else: w = d.cross(axis)
            w = w.normalized() if w.length > 1e-5 else Vector((1, 0, 0))
            k = width * (1 - 0.35 * i / max(1, n - 1))
            verts += [q - w * k / 2, q + w * k / 2]
            v = 1 - i / max(1, n - 1)
            uvs += [(u0, v), (u1, v)]
            shade = (root_dark + (1 - root_dark) * (i / max(1, n - 1)) ** 0.6) * depth
            cols += [shade, shade]
        for i in range(n - 1):
            a = base + i * 2; faces.append((a, a + 1, a + 3, a + 2))
    def make_obj(name, verts, faces, uvs, cols):
        me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
        uvl = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices: uvl.data[li].uv = uvs[me.loops[li].vertex_index]
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i, s in enumerate(cols): ca.data[i].color = (s, s, s, 1)
        for p in me.polygons: p.use_smooth = True
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); o.parent = arm
        g = o.vertex_groups.new(name='head'); g.add(list(range(len(verts))), 1.0, 'REPLACE')
        for gname in ('neck02', 'spine01'): o.vertex_groups.new(name=gname)
        o.modifiers.new('Armature', 'ARMATURE').object = arm
        return o
    C = Vector((0, -0.04, 1.45))                                 # (about the middle of the head)
    part = lambda p: 1 if p.x >= 0 else -1
    styles = {}

    # --- short: 4-7 cm, swept back and to the side
    rng = random.Random(1); V, F, U, K = [], [], [], []
    for p, nor in roots(1100, rng):
        side = part(p); back = (p.y + 0.02)
        dir0 = Vector((side * 0.25, 1.0, 0.35 if back < 0 else -0.2))
        pts = grow(p, nor, dir0, rng.uniform(0.035, 0.065), 3, rng.uniform(0.003, 0.009), grav=0.25, rng=rng)
        card(V, F, U, K, pts, rng.uniform(0.008, 0.012), rng, root_dark=0.5)
    styles['HairShort'] = make_obj('HairShort', V, F, U, K)

    # --- bob: to the chin, parted in the middle, a fringe over the forehead
    rng = random.Random(2); V, F, U, K = [], [], [], []
    for p, nor in roots(650, rng):
        side = part(p); front = p.y < -0.095 and abs(p.x) < 0.055
        if front:
            pts = grow(p, nor, Vector((side * 0.15, -1, -0.6)), 0.09, 4, rng.uniform(0.004, 0.012), grav=0.8, rng=rng,
                       stop=lambda q: q.z < 1.488 + rng.uniform(-0.006, 0.004))
        else:
            dir0 = Vector((side * 0.6, 0.35 if p.y > -0.05 else -0.05, -0.75))
            endz = 1.365 + rng.uniform(-0.01, 0.01) - max(0, -p.y - 0.02) * 0.2      # (a little longer at the front)
            pts = grow(p, nor, dir0, 0.26, 8, rng.uniform(0.003, 0.011), grav=1.2, rng=rng, stop=lambda q, e=endz: q.z < e)
        card(V, F, U, K, pts, rng.uniform(0.016, 0.026), rng)
    styles['HairBob'] = make_obj('HairBob', V, F, U, K)

    # --- long: past the shoulders, parted in the middle
    rng = random.Random(3); V, F, U, K = [], [], [], []
    for p, nor in roots(560, rng):
        side = part(p); dir0 = Vector((side * 0.55, 0.45 if p.y > -0.05 else 0.05, -0.8))
        if p.y < -0.095: dir0 = Vector((side * 0.9, 0.1, -0.6))      # (the front falls to the sides of the face)
        pts = grow(p, nor, dir0, rng.uniform(0.38, 0.46), 10, rng.uniform(0.003, 0.012), grav=1.2, rng=rng)
        card(V, F, U, K, pts, rng.uniform(0.019, 0.028), rng)
    styles['HairLong'] = make_obj('HairLong', V, F, U, K)

    # --- ponytail: pulled back to the back of the head, a tail hanging from a hair tie
    rng = random.Random(4); V, F, U, K = [], [], [], []
    G = Vector((0, 0.083, 1.462))
    for p, nor in roots(600, rng):
        pts = grow(p, nor, (G - p), 0.2, 5, rng.uniform(0.002, 0.005), grav=0.05, pull=G, rng=rng, stop=lambda q: (q - G).length < 0.018)
        card(V, F, U, K, pts, rng.uniform(0.009, 0.014), rng, root_dark=0.6)
    for i in range(110):                                          # (the tail)
        o = Vector((rng.uniform(-1, 1), rng.uniform(-0.3, 1), rng.uniform(-1, 1))).normalized() * rng.uniform(0, 0.014)
        pts = [G + o]; d = Vector((0, 1, -0.2)).normalized(); L = rng.uniform(0.2, 0.28); n = 9
        for j in range(n):
            t = (j + 1) / n; d = (d + Vector((0, 0, -1)) * 0.28).normalized()
            q = pts[-1] + d * (L / n); q = q + (G + Vector((0, 0.03, -0.3 * t)) - q) * 0.0 + o * (0.25 - t * 0.2)
            loc, no, dist = surf(q)
            if loc is not None and (q - loc).dot(no) < 0.012: q = loc + no * 0.012
            pts.append(q)
        ang = rng.uniform(0, math.pi); axis = Vector((math.cos(ang), 0, math.sin(ang))) if False else Vector((math.cos(ang), math.sin(ang) * 0.3, math.sin(ang))).normalized()
        card(V, F, U, K, pts, rng.uniform(0.018, 0.028), rng, axis=axis, root_dark=0.7)
    styles['HairPony'] = make_obj('HairPony', V, F, U, K)

    # --- bun: pulled up to a round bun at the back of the head
    rng = random.Random(5); V, F, U, K = [], [], [], []
    B = Vector((0, 0.075, 1.535)); Bc = B + Vector((0, 0.03, 0.012)); R = 0.042
    for p, nor in roots(600, rng):
        pts = grow(p, nor, (B - p), 0.2, 5, rng.uniform(0.003, 0.007), grav=0.02, pull=B, rng=rng, stop=lambda q: (q - B).length < 0.02)
        card(V, F, U, K, pts, rng.uniform(0.013, 0.02), rng, root_dark=0.6)
    for i in range(80):                                           # (the bun: strands wound round a ball)
        a0 = rng.uniform(0, 6.28); tilt = rng.uniform(-1.2, 1.2); pts = []
        axis = Vector((math.sin(tilt), math.cos(tilt) * 0.3, math.cos(tilt))).normalized()
        e1 = axis.cross(Vector((0, 1, 0))).normalized(); e2 = axis.cross(e1)
        r = R * rng.uniform(0.85, 1.05)
        for j in range(10):
            a = a0 + j * 0.55; pts.append(Bc + (e1 * math.cos(a) + e2 * math.sin(a)) * r)
        card(V, F, U, K, pts, rng.uniform(0.016, 0.024), rng, axis=None, root_dark=0.75)
    styles['HairBun'] = make_obj('HairBun', V, F, U, K)

    # --- curly: springy curls with volume, to about the jaw
    rng = random.Random(6); V, F, U, K = [], [], [], []
    for p, nor in roots(700, rng):
        side = part(p); dir0 = (p - C).normalized() * 0.5 + Vector((side * 0.2, 0.1, -0.6))
        pts = grow(p, nor, dir0, rng.uniform(0.07, 0.11), 8, rng.uniform(0.006, 0.02), grav=0.8, curl=rng.uniform(10, 15), rng=rng)
        card(V, F, U, K, pts, rng.uniform(0.012, 0.018), rng, root_dark=0.5)
    styles['HairCurly'] = make_obj('HairCurly', V, F, U, K)
    # (the material: the strand texture, cut out by its alpha, both sides)
    img = bpy.data.images.load(OUT + '/hair_strands.png'); img.alpha_mode = 'STRAIGHT'
    mat = bpy.data.materials.new('HairStrands'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']; tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'; mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    nt.links.new(tx.outputs['Color'], mul.inputs[6]); nt.links.new(vc.outputs['Color'], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs['Base Color']); nt.links.new(tx.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.5
    try: mat.surface_render_method = 'DITHERED'
    except Exception: pass
    mat.use_backface_culling = False
    for o in styles.values(): o.data.materials.append(mat)
    return styles

if __name__ == '__main__':
    bpy.ops.wm.open_mainfile(filepath=OUT + '/clothes.blend')
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    st = build_hair(arm)
    print({k: len(v.data.vertices) for k, v in st.items()})
    bpy.ops.wm.save_as_mainfile(filepath=OUT + '/hair.blend')
