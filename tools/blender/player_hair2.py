# Escape from Barbi Blue: the players' hair, made in Blender (replaces player_hair.py).
# Close to the head, hair is real hairs (shell fur, tools/blender/player_fur.py): a buzz cut stands up a few millimetres,
# short hair is thicker at the sides, and hair pulled back for a ponytail or a bun lies flat, combed towards the tie.
# Longer hair is strands grown from the scalp the way hair grows, lying on the skull and falling free below its widest
# part, kept out of the face and out of the head, neck and shoulders; each strand a hair card with a strand texture
# (tools/blender/hair_textures2.py), in layers: dense inner ones, loose outer ones. Shading follows the hair's volume (the
# cards' normals point out from the head), so it lights like a head of hair, not like ribbons.
# Objects: FurBuzz, FurShort, FurPony, FurBun, FurPart (under bob and long), FurCurly, FurFace (facial hair); HairShort, HairBob, HairLong,
# HairPony, HairBun, HairCurly (the cards); HairTie, HairTieBun.
import sys, os, math, random, bisect; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from mathutils.bvhtree import BVHTree
import hair_textures2, player_fur
OUT = '/tmp/efbb-player'
C = Vector((0, -0.03, 1.45))                          # (the middle of the head)
UP = Vector((0, 0, 1))
angles = player_fur.angles
def sm(a, b, t): t = min(1, max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t)

def link(name, me, arm):
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); o.parent = arm
    o.modifiers.new('Armature', 'ARMATURE').object = arm
    return o

def build_hair(arm):
    head, body = bpy.data.objects['Head'], bpy.data.objects['Body']
    for n in ('HairCap', 'Hair'):                      # (the old cap and her long hair: replaced)
        if bpy.data.objects.get(n): bpy.data.objects.remove(bpy.data.objects[n])
    bm = bmesh.new()
    for o in (head, body): bm.from_mesh(o.data)
    bm.normal_update(); tree = BVHTree.FromBMesh(bm)
    def near(q):
        loc, no, i, d = tree.find_nearest(q); return loc, no

    # ---------------- materials
    def mat(name, img_name, kind):
        m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
        img = bpy.data.images.load(f'{OUT}/{img_name}'); img.alpha_mode = 'STRAIGHT'
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img
        if kind == 'cards':
            vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
            nt.links.new(tx.outputs['Color'], mx.inputs[6]); nt.links.new(vc.outputs['Color'], mx.inputs[7]); nt.links.new(mx.outputs[2], b.inputs['Base Color'])
        else: nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
        nt.links.new(tx.outputs['Alpha'], b.inputs['Alpha'])
        b.inputs['Roughness'].default_value = 0.45
        try: m.surface_render_method = 'DITHERED'
        except Exception: pass
        m.use_backface_culling = False
        return m
    cards_m, curls_m = mat('HairCards', 'hair_cards.png', 'cards'), mat('HairCurls', 'hair_curls.png', 'cards')
    fur_m = mat('HairFur', 'hair_scalp.png', 'fur')               # (UV0 = the hairline; the hairs themselves: hair_fur, in the game)
    styles = {}

    # ---------------- which way hair grows
    whorl = Vector((0.012, 0.035, 1.566))              # (the crown, a little back and to one side)
    def tangent(p, d):
        n = (p - C).normalized(); d = d - n * d.dot(n); return d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))
    def from_crown(p): return tangent(p, p - whorl)
    def short_flow(p):                                  # (a short cut: out from the crown, the front swept to one side)
        az, el = angles(p); d = from_crown(p)
        if p.y < -0.04 and el > 10: d = (d * 0.5 + Vector((1, 0.25, 0)) * sm(-0.04, -0.11, p.y)).normalized()
        return tangent(p, d)
    G = Vector((0, 0.088, 1.478)); B = Vector((0, 0.062, 1.55))
    def toward(T): return lambda p: tangent(p, T - p)
    def from_part(p):                                   # (a middle parting: away from it, then down)
        side = 1 if p.x >= 0 else -1
        if p.y > 0.03: return from_crown(p)
        return tangent(p, Vector((side, 0.25, -0.6)))

    # ---------------- the short hairs close to the head
    styles['FurBuzz'] = player_fur.build_fur(arm, 'FurBuzz', 0.0035, 0.0018, from_crown, mat=fur_m)
    styles['FurShort'] = player_fur.build_fur(arm, 'FurShort', 0.008, 0.007, short_flow, mat=fur_m)
    styles['FurPony'] = player_fur.build_fur(arm, 'FurPony', 0.003, 0.012, toward(G), mat=fur_m)
    styles['FurBun'] = player_fur.build_fur(arm, 'FurBun', 0.003, 0.012, toward(B), mat=fur_m)
    styles['FurPart'] = player_fur.build_fur(arm, 'FurPart', 0.003, 0.01, from_part, mat=fur_m)
    styles['FurCurly'] = player_fur.build_fur(arm, 'FurCurly', 0.006, 0.002, from_crown, mat=fur_m)
    # facial hair: the lower face, the jaw, the upper lip and under the chin; which of it grows hair (stubble, a beard, a
    # moustache, a goatee) is painted in the game in the face texture's layout (UV0), the hairs leaning down
    # (never any hair on the lips or the nose; the gaps a little smaller than the painted ones, so the hair thins out before them)
    lips = lambda p: abs(p.x) < 0.024 and 1.398 < p.z < 1.413 and p.y < -0.112
    nose = lambda p: abs(p.x) < 0.03 and p.z > 1.426 and p.y < -0.118
    face_region = lambda p: 1.33 < p.z < 1.468 and p.y < 0.012 and not (p.z > 1.44 and abs(p.x) < 0.045 and p.y < -0.1) and not lips(p) and not nose(p)
    styles['FurFace'] = player_fur.build_fur(arm, 'FurFace', 0.006, 0.004, lambda p: Vector((p.x * 2.5, -0.35, -1)), tile=0.009,
                                             region=face_region, head_uv=True, mat=fur_m)

    # ---------------- strands, grown from roots on the scalp
    sb = bmesh.new(); sb.from_mesh(head.data); sb.normal_update()
    bmesh.ops.delete(sb, geom=[f for f in sb.faces if not all((lambda az, el: el > hair_textures2.hairline(az))(*angles(v.co)) for v in f.verts)], context='FACES')
    bmesh.ops.triangulate(sb, faces=sb.faces); sb.normal_update()
    tris = [(f.verts[0].co.copy(), f.verts[1].co.copy(), f.verts[2].co.copy(), f.calc_area()) for f in sb.faces]
    acc = []; s = 0
    for t in tris: s += t[3]; acc.append(s)
    total = s
    def roots(n, rng, keep=lambda p, az, el: True):
        out = []; tries = 0
        while len(out) < n and tries < n * 60:
            tries += 1
            i = min(bisect.bisect(acc, rng.random() * total), len(tris) - 1); a, b, c, _ = tris[i]
            u, v = rng.random(), rng.random()
            if u + v > 1: u, v = 1 - u, 1 - v
            p = a + (b - a) * u + (c - a) * v; az, el = angles(p)
            if el < hair_textures2.hairline(az) + 1.0: continue
            if keep(p, az, el): out.append(p)
        return out
    def guard(q):                                       # (out of the face: nothing hangs in front of the eyes, nose or mouth)
        if -0.17 < q.y < -0.05 and 1.33 < q.z < 1.505 and abs(q.x) < 0.082:
            k = sm(1.505, 1.49, q.z) if q.z > 1.49 else 1
            x = math.copysign(max(abs(q.x), 0.082 * k + abs(q.x) * (1 - k)), q.x if q.x != 0 else 1)
            q = Vector((x, q.y, q.z))
        return q
    def grow(p, d0, L, n, off, grav=1.0, stick_all=False, stop=None, pull=None, curl=None, face=True, wave=0.0, rng=None):
        loc, no = near(p); pts = [loc + no * off(0)]
        d = tangent(p, d0); step = L / n; ph = rng.uniform(0, 6.28) if rng else 0; wv = rng.uniform(0.5, 1.5) if rng else 1
        for i in range(n):
            t = (i + 1) / n
            loc, no = near(pts[-1]); on_skull = stick_all or (no.z > -0.25 and pts[-1].z > 1.43)
            if pull is not None: d = (d * 0.3 + (pull - pts[-1]).normalized() * 0.7).normalized()
            gv = -UP * grav
            if on_skull: gv = gv - no * gv.dot(no)        # (on the skull: gravity only slides it along)
            d = (d + gv * step * 14).normalized()
            q = pts[-1] + d * step
            loc, no = near(q); dist = (q - loc).dot(no); want = off(t)
            if dist < want or (on_skull and dist > want): q = loc + no * want
            if wave: side = d.cross(UP); side = side.normalized() if side.length > 1e-4 else Vector((1, 0, 0)); q = q + side * wave * math.sin(ph + t * 6.28 * wv) * t
            if curl: q = q + curl(t, d)
            if face: q = guard(q)
            d = (q - pts[-1]).normalized(); pts.append(q)
            if stop and stop(q, t): break
        return pts
    def radial(q):
        r = Vector((q.x, q.y, 0)); return r.normalized() if r.length > 1e-4 else Vector((0, 1, 0))
    class Cards:
        def __init__(s): s.V, s.F, s.U, s.K, s.W, s.N = [], [], [], [], [], []
        def add(s, pts, width, rng, col=None, shade=1.0, root_dark=0.6, normal=None, taper=0.45, out_n=None):
            if len(pts) < 2: return
            c = rng.randrange(3) if col is None else col
            u0 = c / 4 + 0.004; u1 = (c + 1) / 4 - 0.004; n = len(pts); base = len(s.V)
            for i, q in enumerate(pts):
                d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
                if normal is not None: nn = normal(q, i)
                else:
                    loc, no = near(q); k = sm(0.012, 0.045, (q - loc).length); nn = (no * (1 - k) + radial(q) * k).normalized()
                w = d.cross(nn); w = w.normalized() if w.length > 1e-5 else Vector((1, 0, 0))
                t = i / (n - 1); k = width * (1 - taper * t ** 1.5)
                s.V += [q - w * k / 2, q + w * k / 2]
                s.U += [(u0, 1 - t), (u1, 1 - t)]
                sh = (root_dark + (1 - root_dark) * t ** 0.5) * shade; s.K += [sh, sh]
                wt = sm(1.30, 1.42, q.z); s.W += [wt, wt]
                # (the light: mostly from the hair's volume, out from the head, a little from the card itself)
                o = out_n(q) if out_n else ((q - C).normalized() if q.z > 1.42 else (radial(q) * 0.8 + (q - C).normalized() * 0.2).normalized())
                if o.dot(nn) < 0: nn = -nn
                vn = (o * 0.7 + nn * 0.3).normalized(); s.N += [vn, vn]
            for i in range(n - 1):
                a = base + i * 2; s.F.append((a, a + 1, a + 3, a + 2))
        def obj(s, name, m):
            me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in s.V], [], s.F); me.update()
            uvl = me.uv_layers.new(name='UVMap')
            for poly in me.polygons:
                for li in poly.loop_indices: uvl.data[li].uv = s.U[me.loops[li].vertex_index]
            ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
            for i, k in enumerate(s.K): ca.data[i].color = (k, k, k, 1)
            for p in me.polygons: p.use_smooth = True
            me.normals_split_custom_set_from_vertices([tuple(n) for n in s.N])
            o = link(name, me, arm)
            gh, gn, gs = o.vertex_groups.new(name='head'), o.vertex_groups.new(name='neck02'), o.vertex_groups.new(name='spine01')
            for i, w in enumerate(s.W):
                if w > 0.999: gh.add([i], 1.0, 'REPLACE')
                elif w < 0.001: gs.add([i], 0.6, 'REPLACE'); gn.add([i], 0.4, 'REPLACE')
                else: gh.add([i], w, 'REPLACE'); gn.add([i], 1 - w, 'REPLACE')
            o.data.materials.append(m)
            return o

    # --- short: the top longer (4-5 cm), lying back over the fur at the sides, the front swept to one side
    rng = random.Random(21); K = Cards()
    for layer, (n, off0, lift, wid, shade) in enumerate([(560, 0.004, 0.003, (0.012, 0.016), 0.7), (460, 0.0065, 0.004, (0.01, 0.014), 0.9), (340, 0.009, 0.004, (0.008, 0.011), 1.0)]):
        for p in roots(n, rng, keep=lambda p, az, el: el > 18 + 10 * sm(60, 120, abs(az))):
            az, el = angles(p); top = sm(18, 55, el)
            L = (0.022 + 0.026 * top) * rng.uniform(0.85, 1.1)
            pts = grow(p, short_flow(p), L, 5, lambda t, a=off0, b=lift: a + b * math.sin(t * math.pi) * 0.7 + 0.002 * t, grav=0.25, stick_all=True, face=False,
                       stop=lambda q, t: (lambda az, el: el < hair_textures2.hairline(az) + 4 and abs(az) < 60)(*angles(q)), rng=rng)
            K.add(pts, rng.uniform(*wid), rng, col=None, shade=shade, root_dark=0.75, taper=0.6)
    styles['HairShort'] = K.obj('HairShort', cards_m)

    # --- bob: to the jaw, parted in the middle, a fringe to the eyebrows, the ends turned under a little
    rng = random.Random(22); K = Cards()
    for layer, (n, off0, lift, wid, shade) in enumerate([(680, 0.003, 0.006, (0.018, 0.024), 0.62), (600, 0.0045, 0.012, (0.015, 0.02), 0.85), (470, 0.006, 0.017, (0.012, 0.016), 1.0)]):
        for p in roots(n, rng):
            az, el = angles(p); side = 1 if p.x >= 0 else -1
            if abs(az) < 38 and el > 22:                    # (the fringe)
                pts = grow(p, Vector((side * 0.12, -1, -0.2)), 0.1, 6, lambda t, a=off0, b=lift: a + b * 0.5 * t, grav=0.9, stick_all=True, face=False, rng=rng,
                           stop=lambda q, t: q.z < 1.498 + rng.uniform(-0.0025, 0.0025))
            else:
                end = 1.372 + rng.uniform(-0.003, 0.003) + 0.014 * sm(-0.02, 0.08, p.y)
                pts = grow(p, from_part(p), 0.26, 10, lambda t, a=off0, b=lift: a + b * math.sin(min(1, t * 1.4) * math.pi * 0.5), grav=1.0, rng=rng,
                           stop=lambda q, t, e=end: q.z < e)
                if len(pts) > 4 and pts[-1].z < 1.42:
                    tip = pts[-1]; pts[-1] = tip - radial(tip) * 0.006 + UP * 0.003
            K.add(pts, rng.uniform(*wid), rng, col=3 if layer == 0 else None, shade=shade, root_dark=0.7)
    styles['HairBob'] = K.obj('HairBob', cards_m)

    # --- long: past the shoulders, parted in the middle, swept back off the face
    rng = random.Random(23); K = Cards()
    for layer, (n, off0, lift, wid, shade) in enumerate([(680, 0.003, 0.006, (0.02, 0.026), 0.62), (600, 0.0045, 0.011, (0.016, 0.022), 0.85), (500, 0.006, 0.016, (0.012, 0.017), 1.0)]):
        for p in roots(n, rng):
            az, el = angles(p); side = 1 if p.x >= 0 else -1
            d0 = from_part(p)
            if abs(az) < 50 and el > 14: d0 = tangent(p, Vector((side, 0.55, -0.15)))       # (the front: back over the temples)
            pts = grow(p, d0, rng.uniform(0.42, 0.5), 14, lambda t, a=off0, b=lift: a + b * math.sin(min(1, t * 1.6) * math.pi * 0.5), grav=1.0, rng=rng,
                       wave=0.006, stop=lambda q, t: q.z < 1.13 + rng.uniform(-0.012, 0.012))
            K.add(pts, rng.uniform(*wid), rng, col=3 if layer == 0 else None, shade=shade, root_dark=0.7, taper=0.4)
    styles['HairLong'] = K.obj('HairLong', cards_m)

    # --- ponytail: the tail hanging from the tie (the hair on the head is the fur, combed back to it)
    rng = random.Random(24); K = Cards()
    spine = [G + Vector((0.004 * math.sin(i / 13 * 3), 0.022 + 0.032 * math.sin(i / 13 * 1.6), -0.25 * i / 13)) for i in range(14)]
    for ring, (n, r0, wid, shade) in enumerate([(40, 0.004, 0.014, 0.6), (62, 0.009, 0.012, 0.8), (80, 0.014, 0.0105, 0.92), (60, 0.018, 0.009, 1.0)]):
        for k in range(n):
            a = k / n * 6.283 + rng.uniform(-0.12, 0.12); L = rng.uniform(0.72, 1.0); m = max(3, int(len(spine) * L)); pts = []
            ph, wv = rng.uniform(0, 6.28), rng.uniform(0.002, 0.004)          # (each strand waves a little of its own)
            for i in range(m):
                t = i / (len(spine) - 1); r = r0 * (1.0 + 0.7 * math.sin(min(1, t * 2.2) * 2.4)) * (1 - 0.65 * t ** 2)
                aa = a + math.sin(ph + t * 5) * wv / max(r, 0.004)
                pts.append(spine[i] + Vector((math.cos(aa) * r, math.sin(aa) * r * 0.85, 0)))
            K.add(pts, wid * rng.uniform(0.85, 1.1), rng, col=3 if ring == 0 else None, shade=shade, root_dark=0.7,
                  normal=lambda q, i, a=a: Vector((math.cos(a), math.sin(a), 0)), taper=0.5, out_n=lambda q, a=a: Vector((math.cos(a), math.sin(a), 0)))
    styles['HairPony'] = K.obj('HairPony', cards_m)

    # --- bun: wound round at the top of the back of the head (the hair on the head: the fur, combed up to it)
    rng = random.Random(25); K = Cards()
    Bc = B + Vector((0, 0.03, 0.012)); R = Vector((0.036, 0.03, 0.032))
    for layer, (n, kr, wid, shade) in enumerate([(50, 0.9, 0.024, 0.62), (64, 1.0, 0.019, 1.0)]):
        for i in range(n):
            tilt = rng.uniform(-1.3, 1.3); a0 = rng.uniform(0, 6.283)
            ax = Vector((math.sin(tilt), 0.35 * math.cos(tilt), math.cos(tilt))).normalized()
            e1 = ax.cross(Vector((0, 1, 0))).normalized(); e2 = ax.cross(e1); pts = []
            for j in range(12):
                a = a0 + j * 0.5; dv = e1 * math.cos(a) + e2 * math.sin(a)
                pts.append(Bc + Vector((dv.x * R.x, dv.y * R.y, dv.z * R.z)) * kr * rng.uniform(0.985, 1.015))
            K.add(pts, wid, rng, col=3 if layer == 0 else None, shade=shade, root_dark=0.85,
                  normal=lambda q, i: (q - Bc).normalized(), taper=0.3, out_n=lambda q: (q - Bc).normalized())
    styles['HairBun'] = K.obj('HairBun', cards_m)

    # --- curly: curly locks springing up and out, to about the jaw, off the face
    rng = random.Random(26); K = Cards()
    for layer, (n, off0, wid, shade, L0) in enumerate([(680, 0.005, (0.02, 0.026), 0.6, 0.07), (680, 0.012, (0.017, 0.022), 0.82, 0.08), (560, 0.02, (0.014, 0.018), 1.0, 0.085)]):
        for p in roots(n, rng):
            az, el = angles(p); out = (p - C).normalized()
            d0 = (out * 0.8 + from_crown(p) * 0.6 + UP * 0.25)
            if abs(az) < 60 and el > 10: d0 = out * 0.9 + UP * 0.7 + Vector((0, 0.5, 0))      # (the front springs up and back, off the face)
            L = L0 * rng.uniform(0.8, 1.15) * (0.55 + 0.45 * sm(-20, 30, el))
            pts = grow(p, d0, L, 7, lambda t, a=off0: a + 0.022 * t * sm(-25, 25, el), grav=0.35, stick_all=True, wave=0.004, rng=rng)
            K.add(pts, rng.uniform(*wid), rng, col=None if layer else 3, shade=shade, root_dark=0.6, taper=0.25)
    styles['HairCurly'] = K.obj('HairCurly', curls_m)

    # --- hair ties: a dark elastic band where the ponytail and the bun are gathered
    tm = bpy.data.materials.new('HairTie'); tm.use_nodes = True; tb = tm.node_tree.nodes['Principled BSDF']
    tb.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1); tb.inputs['Roughness'].default_value = 0.6
    for name, at, rot, R0 in (('HairTie', G + Vector((0, 0.008, -0.002)), (math.pi / 2 - 0.35, 0, 0), 0.0125), ('HairTieBun', B + Vector((0, 0.006, 0.002)), (math.pi / 2 - 1.05, 0, 0), 0.016)):
        bpy.ops.mesh.primitive_torus_add(major_radius=R0, minor_radius=0.0034, major_segments=24, minor_segments=8, location=(0, 0, 0))
        tie = bpy.context.object; tie.name = name; tie.data.name = name
        tie.rotation_euler = rot; tie.location = at
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        tie.data.materials.append(tm); tie.parent = arm; tie.modifiers.new('Armature', 'ARMATURE').object = arm
        tie.vertex_groups.new(name='head').add(list(range(len(tie.data.vertices))), 1.0, 'REPLACE')
        for p in tie.data.polygons: p.use_smooth = True
        styles[name] = tie
    return styles

if __name__ == '__main__':
    bpy.ops.wm.open_mainfile(filepath=OUT + '/clothes.blend')
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    st = build_hair(arm)
    print({k: len(v.data.polygons) for k, v in st.items()})
    bpy.ops.wm.save_as_mainfile(filepath=OUT + '/hair2.blend')
