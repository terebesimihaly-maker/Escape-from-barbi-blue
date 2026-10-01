# Escape from Barbi Blue: the players' glasses, made in Blender and fitted to the head: the bridge rests on the nose, the
# lenses sit about 15 mm in front of the eyes (tilted a little, the outer edges wrapping back), the arms run back along the
# side of the head, clear of it, and hook down behind the ears. Two pairs:
#   round:  thin metal round frames, with nose pads          (GlassesRound, its lenses GlassesLensRound)
#   square: thicker plastic frames with rounded corners       (GlassesSquare, GlassesLensSquare)
# Skinned to the head bone; the game colours the frames (js/player-model.js) and moves them with the face's shape.
import sys, os, math; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

Z0 = 1.468                     # (the lenses' middle height: the eyes are at 1.469)
Y0 = -0.1365                   # (the front of the frames at the nose: the nose's bridge is at -0.134)

def sweep(path, closed, profile, side_of):
    """a tube along path, its cross-section the profile ([(a, b)]: a along side_of(i), b along the forward axis of the ring)"""
    V, F = [], []; n = len(path); m = len(profile)
    for i, p in enumerate(path):
        t = (path[(i + 1) % n] - path[i - 1]) if closed else (path[min(i + 1, n - 1)] - path[max(i - 1, 0)])
        t.normalize(); s = side_of(i, p, t); f = t.cross(s).normalized(); s = f.cross(t).normalized()
        for a, b in profile: V.append(p + s * a + f * b)
    rings = n if closed else n - 1
    for i in range(rings):
        j = (i + 1) % n
        for k in range(m):
            F.append((i * m + k, i * m + (k + 1) % m, j * m + (k + 1) % m, j * m + k))
    if not closed:                                     # (the ends capped)
        F.append(tuple(reversed(range(m)))); F.append(tuple((n - 1) * m + k for k in range(m)))
    return V, F

def rounded_profile(w, d, r, seg=3):
    """a rounded rectangle, w across, d deep, corner radius r (centred)"""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg); pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def lens_outline(kind, s, n=48):
    """the lens edge for side s (+1: the left lens, at +x), as 3-D points on the tilted, wrapped front"""
    pts = []
    for k in range(n):
        a = k / n * 2 * math.pi
        if kind == 'round':
            cx, R = 0.0335, 0.0205; x, z = R * math.cos(a), R * math.sin(a)
        else:                                          # (a superellipse: a square with soft corners, a little wider at the top)
            cx, W, H = 0.0355, 0.0255, 0.0175; c, sn = math.cos(a), math.sin(a)
            x = W * math.copysign(abs(c) ** 0.42, c) * (1 + 0.05 * max(0, sn)); z = H * math.copysign(abs(sn) ** 0.42, sn)
        X = s * cx + x
        wrap = max(0.0, abs(X) - 0.03) * math.tan(math.radians(14))      # (the outer part curves back round the face)
        tilt = (z) * math.tan(math.radians(8))                           # (the bottom nearer the cheeks)
        pts.append(Vector((X, Y0 + wrap + tilt, Z0 + z)))
    return pts

def obj_from(name, V, F, arm, mat):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in V], [], F); me.update()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); o.parent = arm
    o.modifiers.new('Armature', 'ARMATURE').object = arm
    o.vertex_groups.new(name='head').add(list(range(len(V))), 1.0, 'REPLACE')
    o.data.materials.append(mat)
    return o

def build_glasses(arm):
    fm = bpy.data.materials.new('GlassesFrame'); fm.use_nodes = True; b = fm.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.03, 0.03, 0.03, 1); b.inputs['Roughness'].default_value = 0.3
    lm = bpy.data.materials.new('GlassesLens'); lm.use_nodes = True; b = lm.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.85, 0.9, 1.0, 1); b.inputs['Roughness'].default_value = 0.05; b.inputs['Alpha'].default_value = 0.12
    try: lm.surface_render_method = 'BLENDED'
    except Exception: pass
    out = {}
    for kind in ('round', 'square'):
        metal = kind == 'round'
        prof = rounded_profile(0.0013, 0.0013, 0.00064, 2) if metal else rounded_profile(0.0042, 0.0028, 0.0011, 2)
        V, F = [], []
        def add(v, f):
            base = len(V); V.extend(v); F.extend([tuple(i + base for i in q) for q in f])
        rims = {}
        for s in (1, -1):
            rim = lens_outline(kind, s); rims[s] = rim
            ctr = sum(rim, Vector()) / len(rim)
            # (the rim: its cross-section's width lies in the lens' plane, outward from the lens' middle)
            add(*sweep(rim, True, prof, lambda i, p, t, c=ctr: (p - c).normalized()))
        # the bridge: from one rim's inner top to the other's, arching a little over the nose
        inner = {s: min(rims[s], key=lambda p: abs(p.x) - (p.z - Z0) * 0.6) for s in (1, -1)}
        a, c = inner[-1], inner[1]; br = []
        for k in range(13):
            t = k / 12; p = a.lerp(c, t); p = p + Vector((0, -0.0015 * math.sin(t * math.pi), 0.004 * math.sin(t * math.pi))); br.append(p)
        bprof = rounded_profile(0.0016, 0.0016, 0.0007, 2) if metal else rounded_profile(0.0034, 0.0026, 0.001, 2)
        add(*sweep(br, False, bprof, lambda i, p, t: Vector((0, 0, 1))))
        # the hinges and the arms: from the rim's outer edge back along the side of the head (3 mm clear), over the ear and down
        for s in (1, -1):
            o = max(rims[s], key=lambda p: abs(p.x) + (p.z - Z0) * 0.4)
            path = [o, Vector((s * 0.0675, -0.112, Z0 + 0.008)), Vector((s * 0.0705, -0.09, Z0 + 0.009)), Vector((s * 0.0735, -0.065, Z0 + 0.01)),
                    Vector((s * 0.0775, -0.042, Z0 + 0.005)), Vector((s * 0.0802, -0.024, Z0 - 0.001)), Vector((s * 0.0795, -0.01, Z0 - 0.005)),
                    Vector((s * 0.0765, -0.003, Z0 - 0.016)), Vector((s * 0.073, 0.001, Z0 - 0.032))]
            fine = []                                  # (smoothed: a Catmull-Rom through the points)
            for i in range(len(path) - 1):
                p0, p1, p2, p3 = path[max(i - 1, 0)], path[i], path[i + 1], path[min(i + 2, len(path) - 1)]
                for k in range(4):
                    t = k / 4; fine.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            fine.append(path[-1])
            aprof = rounded_profile(0.0028, 0.0012, 0.0005, 2) if metal else rounded_profile(0.0055, 0.0022, 0.0009, 2)
            add(*sweep(fine, False, aprof, lambda i, p, t, s=s: Vector((0, 0, 1))))
            if metal:                                  # (nose pads: small clear ovals either side of the nose)
                c = Vector((s * 0.0105, -0.1305, Z0 - 0.009)); pv = []; pf = []
                for k in range(12):
                    a2 = k / 12 * 2 * math.pi; pv.append(c + Vector((0.0015 * math.cos(a2) * 0.4, 0.0015 * math.cos(a2), 0.0045 * math.sin(a2))))
                pv.append(c + Vector((s * 0.0006, 0, 0))); pf = [(k, (k + 1) % 12, 12) for k in range(12)]
                add(pv, pf)
        out['Glasses' + kind.capitalize()] = obj_from('Glasses' + kind.capitalize(), V, F, arm, fm)
        # the lenses: each a slightly domed disc inside its rim
        LV, LF = [], []
        for s in (1, -1):
            rim = rims[s]; ctr = sum(rim, Vector()) / len(rim); base = len(LV)
            for p in rim: LV.append(ctr + (p - ctr) * 0.97)
            LV.append(ctr + Vector((0, -0.0018, 0)))
            n = len(rim); LF += [(base + k, base + (k + 1) % n, base + n) for k in range(n)]
        out['GlassesLens' + kind.capitalize()] = obj_from('GlassesLens' + kind.capitalize(), LV, LF, arm, lm)
    return out

if __name__ == '__main__':
    bpy.ops.wm.open_mainfile(filepath='/tmp/efbb-player/clothes.blend')
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    g = build_glasses(arm); print({k: len(v.data.polygons) for k, v in g.items()})
    bpy.ops.wm.save_as_mainfile(filepath='/tmp/efbb-player/glasses.blend')
