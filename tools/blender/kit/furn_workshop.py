# Escape from Barbi Blue: the doll works' furniture (WP2.5e, workshop style; build spec B3, B4, B6).
#   Solid_workbench        a long beech bench on six legs, its top black with oil and slip: an engineer's vice with a doll's torso
#                          in its jaws, trays of glass eyes, limbs, a pot of brushes; a tool rack down its spine to 1.6 m; the
#                          anglepoise (the game's fixture) at Solid_workbench_fix
#   Solid_kiln             a firebrick kiln bound in iron straps, its guillotine door raised on its chains over the glow
#                          (Solid_kiln_fix), a pyrometer, the flue up past the ceiling to 4.6 m
#   Solid_drying_rack      a long rack of pegs both sides, unfired porcelain arms and legs hung on them, heads along the top
#   Solid_sewing_table     a treadle sewing machine: cast-iron stand and treadle, the belt wheel, the black machine with its
#                          gold transfers, a doll's dress under the needle
#   Solid_dress_form       a dressmaker's form in a full half-made skirt
#   Col_steel_column_H360/H420/H450  a riveted steel stanchion (two channels laced together), base and cap plates, green paint chipped
#   doll parts (heads, glass eyes, limbs, torsos) for the whole works: here; wall pieces furn_workshop2.py; islands furn_workshop3.py
#   py -3.11 tools/blender/kit/furn_workshop.py [--preview] [--force] [--only workbench,kiln,...,bands,islands] [--sheets]
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
import kitlib
import surfaces2 as S
import doors as Dr
import furnlib as F
from furnlib import wa, ma, turned, box, drape, pillow, grid_surface, fa
from doors import lathe_bm, block, attrs_of
from surfaces2 import sep, finish
from kitlib import OPTS, lin

STYLE = 'workshop'
random.seed(503)

# ================================================================ materials
def glass_eye(name, iris='#3a5a7a'):
    """a doll's glass eye: the white, the iris with its threads of colour and a dark ring, the pupil, glossy
       (gpos: the direction from the eye's centre, the eye looking along +z)"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); x, y, z = sep(m, g); c = lin(iris)
    col = m.mix(m.remap(z, 0.86, 0.9), lin('#e9e3d6'), m.mix(m.remap(m.noise(m.map(g, (40, 40, 2)), 1.0, 2), 0.3, 0.7), c, tuple(min(1.0, q * 1.8) for q in c)))
    col = m.mix(m.math('MULTIPLY', m.remap(z, 0.87, 0.89), m.remap(z, 0.9, 0.88)), col, tuple(q * 0.35 for q in c))
    col = m.mix(m.remap(z, 0.955, 0.965), col, (0.01, 0.01, 0.012))
    return finish(m, col, 0.06, m.val(0.0))

def eye_mass(name):
    """a jar packed with loose glass eyes, seen through its glass: a crowd of irises staring every way (voronoi cells)"""
    m = kitlib.Mat(name); op = m.attr('opos', True)
    cell = m.voronoi(m.map(op, (1, 1, 1)), 75, 'Distance'); cid = m.voronoi(m.map(op, (1, 1, 1)), 75, 'Color')
    iris = m.remap(cell, 0.22, 0.19); pupil = m.remap(cell, 0.09, 0.07)
    ic = m.mix(m.remap(sep(m, cid)[0], 0.0, 1.0), lin('#3a5a7a'), lin('#5a3a1e'))
    col = m.mix(iris, lin('#e6e0d2'), ic); col = m.mix(pupil, col, (0.01, 0.01, 0.01))
    col = m.mix(m.remap(cell, 0.48, 0.56), col, (0.12, 0.11, 0.1))
    return finish(m, col, 0.08, m.math('MULTIPLY', cell, 0.0015))

def ws_mats(k):
    import modules as Mo, fixtures as Fx, furn_concrete as C, furn_attic as A
    M = {}
    M['bench'] = kitlib.wood(k + '_bench', 'beech', 'bare', stain='#4a3c2e', age=2.4); M['pine'] = kitlib.wood(k + '_pine', 'pine', 'bare', stain='#8a7a62', age=2.0)
    M['oak'] = kitlib.wood(k + '_oak', 'oak', 'varnish', stain='#5a3a1e', age=2.0)
    M['iron'] = Mo.cast_iron(k + '_iron', 0.5, 0.3); M['steel'] = kitlib.metal(k + '_steel', 'steel', rust=0.5, age=1.8)
    M['green'] = Dr.paint(k + '_green', ['#4a5a48', '#6e6e64', '#3a3836'], 'steel', [], kick=0.3, chips=0.9, gloss=0.25, age=2.0, craze=0.0, joints=False, rust=0.8)
    M['bisque'] = kitlib.porcelain(k + '_bisque', '#ecd5c4', glaze=False, crackle=0.25, age=1.8); M['green_ware'] = kitlib.porcelain(k + '_greenware', '#d6d2c8', glaze=False, crackle=0.0, age=1.6)
    M['glaze'] = kitlib.porcelain(k + '_glaze', '#efe6da', glaze=True, crackle=0.5, age=1.8)
    M['eyeB'] = glass_eye(k + '_eyeB', '#3a5a7a'); M['eyeH'] = glass_eye(k + '_eyeH', '#5a3a1e'); M['eyeG'] = glass_eye(k + '_eyeG', '#4a5a3a'); M['eyemass'] = eye_mass(k + '_eyemass')
    M['socket'] = kitlib.grey(k + '_socket', (0.02, 0.015, 0.012)); M['glass'] = kitlib.glass(); M['face'] = doll_face(k + '_face'); M['kilnbrick'] = kiln_brick(k + '_kilnbrick')
    M['brass'] = kitlib.metal(k + '_brass', 'brass', rust=0.0, age=1.8); M['firebrick'] = Fx.firebrick(k + '_firebrick'); M['soot'] = Mo.soot_brick(k + '_soot')
    M['hair'] = kitlib.fabric(k + '_hair', '#6a4a2c', weave=0.0, fade=0.3, stripes=('#4a3220', 0.004), age=1.8); M['hair2'] = kitlib.fabric(k + '_hair2', '#b89a5a', weave=0.0, fade=0.3, stripes=('#8a6a3a', 0.004), age=1.8)
    M['frock'] = kitlib.fabric(k + '_frock', '#b8868c', weave=0.0, fade=0.55, stripes=('#d8c0b8', 0.012), age=1.9); M['frock2'] = kitlib.fabric(k + '_frock2', '#7f97b0', weave=0.0, fade=0.55, age=1.9)
    M['calico'] = kitlib.fabric(k + '_calico', '#d9d0bc', weave=0.0, fade=0.5, age=2.0); M['string'] = kitlib.fabric(k + '_string', '#b8a67e', weave=0.0, age=1.8)
    M['jersey'] = kitlib.fabric(k + '_jersey', '#c9bca0', weave=0.0, fade=0.6, age=2.0); M['tapem'] = kitlib.fabric(k + '_tapem', '#d8c87a', weave=0.0, stripes=('#2a2a2a', 0.0254), age=1.8)
    M['walnut'] = kitlib.wood(k + '_walnut', 'elm', 'varnish', stain='#3a2618', age=2.0); M['black'] = Dr.paint(k + '_black', ['#121212', '#2a2a28', '#3a3836'], 'steel', [], kick=0.0, chips=0.4, gloss=0.6, age=1.8, craze=0.0, joints=False, rust=0.4)
    M['gold'] = kitlib.metal(k + '_gold', 'brass', color='#c9a24a', rust=0.0, age=1.5); M['rubber'] = kitlib.grey(k + '_rubber', (0.015, 0.014, 0.013))
    M['plaster'] = kitlib.plaster(k + '_plaster', '#e2ddd0', age=1.6); M['tin'] = kitlib.metal(k + '_tin', 'steel', color='#a9aaa4', rust=0.5, age=1.8)
    M['leather'] = kitlib.fabric(k + '_leather', '#3a2418', weave=0.0, fade=0.5, age=2.0); M['card'] = kitlib.fabric(k + '_card', '#8f6c47', weave=0.0, fade=0.7, age=2.2)
    return M

# ================================================================ doll parts
def eye(G, M, c, look, r=0.006, kind='eyeB', seg=(8, 5)):
    """a glass eye at c looking along look"""
    c = Vector(c); lk = Vector(look).normalized(); q = lk.to_track_quat('Z', 'Y').to_matrix().inverted()
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=r); S.xform(bm, tuple(c))
    G.add(bm, M[kind], attrs_of(lambda p, c=c, q=q: tuple(q @ (Vector(p) - c).normalized()), 0.5), smooth=True, wrap=False)

def doll_head(G, M, c, face, s=1.0, eyes='eyeB', mat='bisque', wig=None, tilt=0.0, sides=12, eseg=(6, 4), plate=True):
    """a bisque doll's shoulder-head: the round skull with its pate closed, full cheeks, a little chin and nose, the eye sockets set in
       with glass eyes (eyes = 'eyeB'/'eyeH'/'eyeG') or left empty and dark (None); painted brows, lashes, rouge and a rosebud mouth
       (the 'face' material, in the head's own frame); the neck and a broad, shallow shoulder plate; a mohair wig if wig"""
    c = Vector(c); f = Vector((face[0], face[1], 0)).normalized(); up = Vector((0, 0, 1)); sd = f.cross(up).normalized()
    if tilt: Rt = Matrix.Rotation(tilt, 3, sd); f = Rt @ f; up = Rt @ up
    painted = mat == 'bisque' and 'face' in M; fm = M['face'] if painted else M[mat]
    loc = lambda q: (Vector(q) - c)
    att = attrs_of(lambda q: (loc(q).dot(sd) / s, loc(q).dot(f) / s, loc(q).dot(up) / s), 0.5)
    es = [c + f * 0.036 * s + sd * sx * 0.0185 * s + up * 0.008 * s for sx in (-1, 1)]
    bm = lathe_bm([(0.0, 0.0), (0.07, 0.022 * s), (0.18, 0.036 * s), (0.35, 0.046 * s), (0.55, 0.051 * s), (0.75, 0.049 * s), (0.9, 0.038 * s), (1.0, 0.0)], c - up * 0.055 * s, c + up * 0.058 * s, sides, (True, True))
    for v in bm.verts:
        rel = v.co - c; fw = rel.dot(f); z = rel.dot(up)
        if fw > 0:
            v.co += f * fw * 0.14 * math.exp(-((z + 0.012 * s) / (0.026 * s)) ** 2)            # (the cheeks)
            if z < -0.03 * s: v.co += f * 0.006 * s * min(1.0, fw / (0.03 * s))                # (the chin)
        for e_ in es:
            d = (v.co - e_).length
            if d < 0.016 * s: v.co -= f * 0.004 * s * (1 - d / (0.016 * s))                     # (the sockets)
    G.add(bm, fm, att, smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.0), (0.5, 0.0065 * s), (1.0, 0.0)], c + f * 0.046 * s - up * 0.004 * s, c + f * 0.057 * s - up * 0.012 * s, 6), fm, att, smooth=True, wrap=False)
    for k, e_ in enumerate(es):
        if eyes: eye(G, M, e_ - f * 0.002 * s, f + sd * (k * 2 - 1) * 0.08, 0.0105 * s, eyes, eseg)
        else: G.add(lathe_bm([(0.0, 0.009 * s), (1.0, 0.006 * s)], e_ + f * 0.001 * s, e_ - f * 0.004 * s, 8, (False, True)), M['socket'], ma(), wrap=False)
    if wig: G.add(lathe_bm([(0.0, 0.053 * s), (0.4, 0.055 * s), (0.75, 0.045 * s), (1.0, 0.0)], c - f * 0.008 * s - up * 0.004 * s, c + up * 0.066 * s - f * 0.006 * s, sides, (False, True)), M[wig], fa(random.Random(int(c.x * 999))), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.021 * s), (1.0, 0.024 * s)], c - up * 0.048 * s, c - up * 0.082 * s, sides, (False, False)), fm, att, smooth=True, wrap=False)
    if plate:                                                                   # (the shoulder plate: broad side to side, shallow front to back)
        bm = lathe_bm([(0.0, 0.024 * s), (0.35, 0.05 * s), (0.75, 0.068 * s), (1.0, 0.072 * s)], c - up * 0.08 * s, c - up * 0.112 * s, sides, (False, True))
        for v in bm.verts:
            rel = v.co - c; v.co = c + sd * rel.dot(sd) + f * rel.dot(f) * 0.62 + up * rel.dot(up)
        G.add(bm, fm, att, smooth=True, wrap=False)

def doll_face(name, base='#ecd5c4'):
    """unglazed bisque with the face painted on, in the head's own frame (gpos: x across, y forward, z up, per unit head):
       feathered brows, lashes over the eyes, rouge on the cheeks, a red rosebud mouth; grime in the hollows, a fine craze"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); x, y, z = sep(m, g); op = m.attr('opos', True); c = lin(base)
    col = m.mix(m.remap(m.noise(op, 60, 3), 0.3, 0.7, 0.0, 0.3), c, tuple(q * 0.9 for q in c))
    front = m.remap(y, 0.015, 0.03)
    ax = m.math('ABSOLUTE', x)
    def ell(cx, cz, rx, rz, soft=0.4):
        d = m.math('ADD', m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', ax, cx), rx), 2.0), m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', z, cz), rz), 2.0))
        return m.math('MULTIPLY', m.remap(d, 1.0, 1.0 - soft), front)
    col = m.mix(m.math('MULTIPLY', ell(0.027, -0.012, 0.016, 0.013, 0.9), 0.55), col, lin('#d77f78'))          # (rouge)
    col = m.mix(ell(0.0, -0.031, 0.0085, 0.0042, 0.5), col, lin('#a03a34'))                                   # (the mouth)
    brow = m.math('MULTIPLY', ell(0.019, 0.022, 0.012, 0.0022, 0.6), m.remap(ax, 0.006, 0.01))
    col = m.mix(brow, col, lin('#6e4c34'))
    lash = m.math('MULTIPLY', ell(0.0185, 0.0185, 0.0125, 0.0018, 0.6), 1.0)
    col = m.mix(lash, col, lin('#2a1c16'))
    cr = m.voronoi(m.map(op, (1, 1, 1)), 400, 'Distance', 'DISTANCE_TO_EDGE'); crack = m.math('MULTIPLY', m.remap(cr, 0.03, 0.0), 0.35)
    col = m.mix(crack, col, lin('#8a7a6a'))
    col = m.mix(m.math('MULTIPLY', m.remap(m.cavity(), 0.95, 0.6), 0.6), col, lin('#6a5a4a'))
    return finish(m, col, 0.55, m.math('MULTIPLY', crack, -0.0002))

def kiln_brick(name):
    """buff firebrick in running bond round the kiln (u = x + y), its joints dark, black with soot round the door and up under the
       crown, a glaze of fly-ash where the heat leaked"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op); u = m.math('ADD', x, y)
    row = m.math('FLOOR', m.math('DIVIDE', z, 0.065)); bx = m.math('ADD', u, m.math('MULTIPLY', m.math('MODULO', row, 2.0), 0.115))
    cell = m.math('FLOOR', m.math('DIVIDE', bx, 0.23)); fx = m.math('FRACT', m.math('DIVIDE', bx, 0.23)); fz = m.math('FRACT', m.math('DIVIDE', z, 0.065))
    rnd_ = m.math('FRACT', m.math('MULTIPLY', m.math('SINE', m.math('ADD', m.math('MULTIPLY', cell, 12.9898), m.math('MULTIPLY', row, 78.233))), 43758.5453))
    col = m.mix(m.remap(rnd_, 0.0, 0.5), lin('#c9a479'), lin('#b48f60')); col = m.mix(m.remap(rnd_, 0.5, 1.0), col, lin('#d6b98a'))
    col = m.mix(m.remap(m.noise(op, 200, 3), 0.3, 0.7, 0.0, 0.35), col, m.hsv(col, 0.5, 0.8, 0.8))
    jt = m.math('MAXIMUM', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fz, 0.5)), 0.42, 0.46), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fx, 0.5)), 0.47, 0.49))
    col = m.mix(jt, col, lin('#5e564c'))
    soot = m.math('MAXIMUM', m.math('MULTIPLY', m.remap(z, 1.1, 1.7), m.remap(m.noise(op, 4, 4), 0.3, 0.6)), m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', x), 0.35, 0.15), m.math('MULTIPLY', m.remap(z, 0.3, 0.45), m.remap(z, 1.2, 0.8))))
    col = m.mix(m.math('MULTIPLY', soot, 0.85), col, lin('#1e1a16'))
    return finish(m, col, m.mixf(soot, 0.88, 0.7), m.math('ADD', m.math('MULTIPLY', jt, -0.004), m.math('MULTIPLY', m.noise(op, 220, 3), 0.0006)))

def limb(G, M, p0, d, kind='arm', s=1.0, mat='bisque', bend=0.4, sides=8):
    """a porcelain arm (upper arm, elbow, forearm, a cupped hand) or leg (thigh, knee, calf, a foot), from p0 along d, bent at the joint"""
    p0 = Vector(p0); d = Vector(d).normalized(); n = d.orthogonal().normalized(); L = (0.07 if kind == 'arm' else 0.09) * s
    j = p0 + d * L; d2 = (Matrix.Rotation(bend, 3, n) @ d).normalized(); e = j + d2 * L
    r0, r1 = (0.013 * s, 0.01 * s) if kind == 'arm' else (0.019 * s, 0.013 * s)
    G.add(lathe_bm([(0.0, r0 * 0.8), (0.1, r0), (1.0, r1 * 1.05)], p0, j, sides), M[mat], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r1 * 1.05), (0.9, r1 * 0.85), (1.0, r1 * 0.8)], j, e, sides), M[mat], ma(), smooth=True, wrap=False)
    if kind == 'arm': G.add(lathe_bm([(0.0, r1 * 0.8), (0.4, r1 * 1.2), (1.0, 0.0)], e, e + d2 * 0.03 * s, sides), M[mat], ma(), smooth=True, wrap=False)
    else:
        fw = n.cross(d2).normalized(); G.add(lathe_bm([(0.0, r1 * 0.9), (0.5, r1 * 1.1), (1.0, 0.0)], e - fw * 0.008 * s, e + fw * 0.045 * s, sides), M[mat], ma(), smooth=True, wrap=False)

def torso(G, M, c, axis=(0, 0, 1), s=1.0, mat='bisque', sides=12):
    """a doll's body: a stuffed kid or porcelain torso, chest to hips, open at the neck"""
    c = Vector(c); ax = Vector(axis).normalized()
    G.add(lathe_bm([(0.0, 0.03 * s), (0.2, 0.045 * s), (0.5, 0.05 * s), (0.8, 0.043 * s), (1.0, 0.02 * s)], c, c + ax * 0.16 * s, sides, (True, True)), M[mat], ma(), smooth=True, wrap=False)

# ================================================================ the workbench
def tool(G, M, top, kind, rnd):
    """a tool hung from a nail at top: a saw, a rasp, a pair of pliers, a small hammer, a set of callipers, a modelling knife"""
    t = Vector(top)
    if kind == 'saw':
        box(G, M['oak'], tuple(t + Vector((-0.012, -0.03, -0.1))), tuple(t + Vector((0.012, 0.03, 0.01))), wa((0, 0, 1)), 0.005)
        box(G, M['steel'], tuple(t + Vector((-0.0008, -0.025, -0.36))), tuple(t + Vector((0.0008, 0.03, -0.09))), ma(0.3), 0.0)
    elif kind == 'rasp':
        box(G, M['oak'], tuple(t + Vector((-0.012, -0.012, -0.1))), tuple(t + Vector((0.012, 0.012, 0.0))), wa((0, 0, 1)), 0.004)
        box(G, M['steel'], tuple(t + Vector((-0.004, -0.01, -0.3))), tuple(t + Vector((0.004, 0.01, -0.1))), ma(0.3), 0.001)
    elif kind == 'pliers':
        for s in (-1, 1): F.rod(G, M['steel'], [t + Vector((0, 0, 0.0)), t + Vector((0, s * 0.015, -0.05)), t + Vector((0, s * 0.025, -0.16))], 0.005, 5, ma(0.4))
        F.rod(G, M['steel'], [t, t + Vector((0, 0, 0.05))], 0.006, 5, ma(0.4))
    elif kind == 'hammer':
        box(G, M['steel'], tuple(t + Vector((-0.012, -0.045, -0.012))), tuple(t + Vector((0.012, 0.045, 0.012))), ma(0.4), 0.003)
        F.rod(G, M['oak'], [t, t + Vector((0, 0, -0.26))], 0.01, 6, wa((0, 0, 1)))
    elif kind == 'callipers':
        for s in (-1, 1): F.rod(G, M['steel'], [t, t + Vector((0, s * 0.03, -0.08)), t + Vector((0, s * 0.035, -0.15)), t + Vector((0, s * 0.012, -0.2))], 0.003, 4, ma(0.4), sub=2)
    else:
        box(G, M['oak'], tuple(t + Vector((-0.006, -0.006, -0.11))), tuple(t + Vector((0.006, 0.006, 0.0))), wa((0, 0, 1)), 0.002)
        box(G, M['steel'], tuple(t + Vector((-0.001, -0.004, -0.16))), tuple(t + Vector((0.001, 0.004, -0.11))), ma(0.3), 0.0)

def vice(G, M, c, rot, open_=0.06):
    """an engineer's vice: the cast body bolted down, the fixed jaw, the sliding jaw out on its screw, the tommy bar"""
    P = F.Moved(G, Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot, 4, 'Z'))
    box(P, M['green'], (-0.07, -0.06, 0.0), (0.07, 0.06, 0.025), ma(0.4), 0.004, 1)
    box(P, M['green'], (-0.06, 0.0, 0.025), (0.06, 0.06, 0.12), ma(0.4), 0.006, 1)
    box(P, M['steel'], (-0.065, -0.004, 0.09), (0.065, 0.0, 0.125), ma(0.3), 0.001)
    box(P, M['green'], (-0.06, -open_ - 0.06, 0.04), (0.06, -open_, 0.12), ma(0.4), 0.006, 1)
    box(P, M['steel'], (-0.065, -open_, 0.09), (0.065, -open_ + 0.004, 0.125), ma(0.3), 0.001)
    F.rod(P, M['steel'], [(0.0, 0.06, 0.06), (0.0, -open_ - 0.1, 0.06)], 0.009, 6, ma(0.3))
    F.rod(P, M['steel'], [(-0.08, -open_ - 0.1, 0.06), (0.08, -open_ - 0.1, 0.06)], 0.006, 6, ma(0.4))
    for x in (-0.08, 0.08): G.add(lathe_bm([(0.0, 0.01), (1.0, 0.01)], tuple(Vector(c) + Matrix.Rotation(rot, 3, 'Z') @ Vector((x, -open_ - 0.1, 0.06)) - Vector((0, 0, 0.0))), tuple(Vector(c) + Matrix.Rotation(rot, 3, 'Z') @ Vector((x * 1.12, -open_ - 0.1, 0.06))), 8), M['steel'], ma(0.4), smooth=True, wrap=False)
    return Vector(c) + Matrix.Rotation(rot, 3, 'Z') @ Vector((0.0, -open_ / 2, 0.105))

def eye_tray(G, M, c, rot, rnd, nx=6, ny=4, cell=0.03):
    """a shallow wooden tray of compartments, a glass eye or a pair in each, sorted by colour"""
    W, D = nx * cell + 0.02, ny * cell + 0.02
    P = F.Moved(G, Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot, 4, 'Z'))
    box(P, M['oak'], (-W / 2, -D / 2, 0.0), (W / 2, D / 2, 0.006), wa((1, 0, 0)), 0.0)
    for sy in (-1, 1): box(P, M['oak'], (-W / 2, sy * D / 2 - (0.006 if sy > 0 else 0), 0.0), (W / 2, sy * D / 2 + (0.0 if sy > 0 else 0.006), 0.022), wa((1, 0, 0)), 0.001)
    for sx in (-1, 1): box(P, M['oak'], (sx * W / 2 - (0.006 if sx > 0 else 0), -D / 2, 0.0), (sx * W / 2 + (0.0 if sx > 0 else 0.006), D / 2, 0.022), wa((0, 1, 0)), 0.001)
    R = Matrix.Rotation(rot, 3, 'Z')
    for i in range(nx):
        kind = ('eyeB', 'eyeB', 'eyeH', 'eyeH', 'eyeG', 'eyeB')[i % 6]
        for j in range(ny):
            if rnd.random() < 0.15: continue
            p = Vector((-W / 2 + 0.01 + (i + 0.5) * cell, -D / 2 + 0.01 + (j + 0.5) * cell, 0.014))
            eye(G, M, Vector(c) + R @ p, Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 1.0)), 0.0075, kind, (6, 4))
    return W, D

def workbench(G, M, rnd, W=0.85, L=3.08, zt=0.92, rack=True, items=True):
    for x in (-W / 2 + 0.06, W / 2 - 0.06):
        for y in (-L / 2 + 0.08, 0.0, L / 2 - 0.08): box(G, M['bench'], (x - 0.04, y - 0.04, 0.0), (x + 0.04, y + 0.04, zt - 0.06), wa((0, 0, 1), wear=0.4), 0.004, 1)
        box(G, M['bench'], (x - 0.025, -L / 2 + 0.08, 0.12), (x + 0.025, L / 2 - 0.08, 0.2), wa((0, 1, 0)), 0.003)
    for k in range(5):                                                         # (the lower shelf's boards)
        x0 = -W / 2 + 0.07 + k * (W - 0.14) / 5; box(G, M['pine'], (x0 + 0.002, -L / 2 + 0.1, 0.2), (x0 + (W - 0.14) / 5 - 0.002, L / 2 - 0.1, 0.22), wa((0, 1, 0)), 0.002)
    for k in range(4):                                                         # (the top: four thick boards, oil-black)
        x0 = -W / 2 + k * W / 4; box(G, M['bench'], (x0 + 0.002, -L / 2, zt - 0.06), (x0 + W / 4 - 0.002, L / 2, zt), wa((0, 1, 0), wear=0.6), 0.004, 1)
    if rack:                                                                   # (the tool rack down the spine)
        for y in (-L / 2 + 0.3, 0.0, L / 2 - 0.3): box(G, M['bench'], (-0.025, y - 0.025, zt), (0.025, y + 0.025, 1.6), wa((0, 0, 1)), 0.003)
        box(G, M['pine'], (-0.012, -L / 2 + 0.3, 1.3), (0.012, L / 2 - 0.3, 1.58), wa((0, 1, 0)), 0.002)
        box(G, M['bench'], (-0.03, -L / 2 + 0.28, 1.56), (0.03, L / 2 - 0.28, 1.6), wa((0, 1, 0)), 0.003)
        kinds = ['saw', 'rasp', 'pliers', 'hammer', 'callipers', 'knife', 'rasp', 'pliers', 'knife', 'hammer']
        for sx in (-1, 1):
            for k, y in enumerate(np.linspace(-L / 2 + 0.45, L / 2 - 0.45, 10)):
                if rnd.random() < 0.2: continue
                nail = Vector((sx * 0.012, y, 1.5)); G.add(lathe_bm([(0.0, 0.003), (1.0, 0.003)], nail, nail + Vector((sx * 0.03, 0, 0.005)), 5), M['steel'], ma(0.4), wrap=False)
                tool(G, M, nail + Vector((sx * 0.024, 0, 0.0)), kinds[(k + (sx > 0) * 3) % len(kinds)], rnd)
    if not items: return
    # on the top: the vice with a doll's torso in its jaws; trays of eyes; limbs; a pot of brushes; heads
    jaw = vice(G, M, (W / 2 - 0.135, L / 2 - 0.35, zt), 0.0)
    torso(G, M, jaw + Vector((0.0, 0.0, -0.06)), (0.15, 0.0, 1.0), 1.0)
    doll_head(G, M, jaw + Vector((0.02, 0.0, 0.2)), (0.0, -1.0), 1.0, None, 'bisque', tilt=0.4)
    for (x, y, r_) in ((-0.22, -1.2, 0.1), (0.2, -0.9, -0.15), (-0.2, 0.55, 0.05)): eye_tray(G, M, (x, y, zt), r_, rnd)
    for k in range(6):
        x, y = rnd.uniform(-W / 2 + 0.12, W / 2 - 0.12), rnd.uniform(-L / 2 + 0.3, L / 2 - 0.5)
        if abs(x) < 0.08: x += 0.15
        a = rnd.uniform(0, 6.28); dx = -abs(math.cos(a)) if x > 0 else abs(math.cos(a)); limb(G, M, (x, y, zt + 0.014), (dx, math.sin(a), 0.0), 'arm' if k % 2 else 'leg', rnd.uniform(1.0, 1.3), 'bisque' if k % 3 else 'green_ware', rnd.uniform(0.0, 0.6))
    for k in range(3): doll_head(G, M, (rnd.uniform(0.12, W / 2 - 0.1) * (1 if k % 2 else -1), rnd.uniform(-0.4, 0.3), zt + 0.06), (rnd.uniform(-1, 1), rnd.uniform(-1, 1)), 1.0, (None, 'eyeB', 'eyeH')[k], 'bisque' if k else 'green_ware')
    pb = Vector((-0.25, -0.2, zt))
    G.add(lathe_bm([(0.0, 0.04), (1.0, 0.045)], pb, pb + Vector((0, 0, 0.11)), 12, (True, False)), M['tin'], ma(0.4), smooth=True, wrap=False)
    for k in range(5):
        a = 2 * math.pi * k / 5; tp = pb + Vector((0.03 * math.cos(a), 0.03 * math.sin(a), 0.0)); tt = tp + Vector((0.04 * math.cos(a), 0.04 * math.sin(a), 0.22))
        F.rod(G, M['oak'], [tp + Vector((0, 0, 0.02)), tt], 0.004, 4, wa((0, 0, 1)))
    for k in range(4):                                                         # (boxes and tins on the shelf below)
        box(G, M['card'], (-0.3 + 0.16 * (k % 2), -1.1 + 0.6 * k, 0.22), (-0.1 + 0.16 * (k % 2), -0.85 + 0.6 * k, 0.4), fa(rnd, 3, 3), 0.003)
    G.sockets = [('Solid_workbench_fix', (0.24, -0.45, zt))]

# ================================================================ the kiln
def kiln(G, M, rnd, c=(0, 0, 0), W=0.92, H=1.6, top=4.6, socket='Solid_kiln_fix'):
    c = Vector(c); P = F.Moved(G, Matrix.Translation(c))
    box(P, M['iron'], (-W / 2 - 0.02, -W / 2 - 0.02, 0.0), (W / 2 + 0.02, W / 2 + 0.02, 0.08), ma(0.3), 0.004, 1)
    ox, oz0, oz1 = 0.21, 0.42, 0.74; yf = -W / 2
    for lo, hi in (((-W / 2, -W / 2, 0.08), (W / 2, W / 2, oz0)), ((-W / 2, -W / 2, oz1), (W / 2, W / 2, H)), ((-W / 2, -W / 2, oz0), (-ox, W / 2, oz1)), ((ox, -W / 2, oz0), (W / 2, W / 2, oz1)), ((-ox, -W / 2 + 0.2, oz0), (ox, W / 2, oz1))):
        box(P, M['kilnbrick'], lo, hi, wa((1, 0, 0)), 0.006, 1)
    for lo, hi in (((-ox, yf, oz0), (ox, yf + 0.2, oz0 + 0.004)), ((-ox, yf, oz1 - 0.004), (ox, yf + 0.2, oz1)), ((-ox, yf, oz0), (-ox + 0.004, yf + 0.2, oz1)), ((ox - 0.004, yf, oz0), (ox, yf + 0.2, oz1)), ((-ox, yf + 0.196, oz0), (ox, yf + 0.2, oz1))):
        box(P, M['soot'], lo, hi, ma(), 0.0)
    G.sockets = [(socket, tuple(c + Vector((0.0, yf + 0.08, oz0 + 0.004))))]
    rows = [[Vector((x, -W / 2 * math.cos(t), H + 0.15 * math.sin(t))) for x in (-W / 2, W / 2)] for t in np.linspace(0, math.pi, 9)]   # (the crown's arch)
    grid_surface(P, M['kilnbrick'], rows, wa((1, 0, 0)), flip_to=lambda q: Vector((0, q.y, q.z - H)))
    for sx in (-1, 1):
        bm = bmesh.new(); vs = [bm.verts.new((sx * W / 2, -W / 2 * math.cos(t), H + 0.15 * math.sin(t))) for t in np.linspace(0, math.pi, 9)]; f_ = bm.faces.new(vs); f_.normal_update()
        if f_.normal.x * sx < 0: f_.normal_flip()
        P.add(bm, M['kilnbrick'], wa((1, 0, 0)), wrap=False)
    for z in (0.2, 0.9, H - 0.05):                                             # (iron straps round it, angle irons up the corners, tie rods)
        for sy in (-1, 1): box(P, M['iron'], (-W / 2 - 0.008, sy * W / 2 - (0.008 if sy < 0 else 0), z), (W / 2 + 0.008, sy * W / 2 + (0.008 if sy > 0 else 0), z + 0.05), ma(0.4), 0.002)
        for sx in (-1, 1): box(P, M['iron'], (sx * W / 2 - (0.008 if sx < 0 else 0), -W / 2, z), (sx * W / 2 + (0.008 if sx > 0 else 0), W / 2, z + 0.05), ma(0.4), 0.002)
    for sx in (-1, 1):
        for sy in (-1, 1): box(P, M['iron'], (sx * W / 2 - 0.03 * (sx > 0) - 0.01 * (sx < 0), sy * W / 2 - 0.03 * (sy > 0) - 0.01 * (sy < 0), 0.08), (sx * W / 2 + 0.01 * (sx > 0) + 0.03 * (sx < 0), sy * W / 2 + 0.01 * (sy > 0) + 0.03 * (sy < 0), H + 0.02), ma(0.4), 0.002)
    for g in (-0.2, 0.2):                                                      # (the door's guides, the door raised on its chains)
        gx = (ox + 0.03) * (1 if g > 0 else -1); box(P, M['iron'], (gx - 0.015, yf - 0.03, oz0 - 0.04), (gx + 0.015, yf, oz1 + 0.5), ma(0.4), 0.002)
    box(P, M['iron'], (-ox - 0.04, yf - 0.035, oz1 + 0.12), (ox + 0.04, yf - 0.012, oz1 + 0.12 + (oz1 - oz0) + 0.06), ma(0.4), 0.004, 1)
    G.add(lathe_bm([(0.0, 0.025), (1.0, 0.02)], c + Vector((0.0, yf - 0.035, oz1 + 0.32)), c + Vector((0.0, yf - 0.047, oz1 + 0.32)), 10), M['iron'], ma(0.5), smooth=True, wrap=False)   # (the spy-hole plug)
    for gx in (-ox, ox):
        pts = [c + Vector((gx * 0.8, yf - 0.02, oz1 + 0.12 + (oz1 - oz0) + 0.06)), c + Vector((gx * 0.6, yf - 0.03, H)), c + Vector((gx * 0.3, -W / 4, H + 0.13))]
        F.rod(G, M['steel'], pts, 0.006, 4, ma(0.4), sub=2)
    pg = c + Vector((W / 2 + 0.008, -0.15, 1.2))                               # (the pyrometer)
    G.add(lathe_bm([(0.0, 0.06), (0.7, 0.062), (1.0, 0.055)], pg, pg + Vector((0.035, 0, 0)), 16), M['brass'], ma(0.5), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.052), (1.0, 0.052)], pg + Vector((0.035, 0, 0)), pg + Vector((0.036, 0, 0)), 16, (False, True)), M['glaze'], ma(), wrap=False)
    fl = c + Vector((0.0, 0.1, H + 0.12))                                      # (the flue up through the ceiling)
    G.add(lathe_bm([(0.0, 0.16), (1.0, 0.13)], fl, fl + Vector((0, 0, 0.12)), 16, (False, False)), M['iron'], ma(0.3), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.13), (1.0, 0.13)], fl + Vector((0, 0, 0.12)), Vector((fl.x, fl.y, top)), 16, (False, False)), M['iron'], ma(0.3), smooth=True, wrap=False)
    for z in (2.4, 3.4): G.add(lathe_bm([(0.0, 0.137), (1.0, 0.137)], Vector((fl.x, fl.y, z)), Vector((fl.x, fl.y, z + 0.05)), 16, (False, False)), M['iron'], ma(0.4), smooth=True, wrap=False)

# ================================================================ the drying rack
def drying_rack(G, M, rnd, W=0.6, L=3.0, H=1.9, sides=(-1, 1)):
    for y in np.linspace(-L / 2 + 0.03, L / 2 - 0.03, 4):
        box(G, M['pine'], (-0.03, y - 0.03, 0.0), (0.03, y + 0.03, H), wa((0, 0, 1)), 0.003)
        box(G, M['pine'], (-W / 2, y - 0.025, 0.0), (W / 2, y + 0.025, 0.06), wa((1, 0, 0)), 0.003)
    for z in (0.75, 1.35):
        box(G, M['pine'], (-0.02, -L / 2, z - 0.04), (0.02, L / 2, z + 0.04), wa((0, 1, 0)), 0.003)
    box(G, M['pine'], (-0.1, -L / 2, H - 0.03), (0.1, L / 2, H), wa((0, 1, 0)), 0.003)   # (the top shelf, heads along it)
    for sx in sides:
        for z in (0.75, 1.35):
            for y in np.linspace(-L / 2 + 0.15, L / 2 - 0.15, 7):
                p = Vector((sx * 0.02, y, z)); tip = p + Vector((sx * 0.25, 0, 0.09))
                G.add(lathe_bm([(0.0, 0.007), (1.0, 0.006)], p, tip, 5, (False, True)), M['pine'], wa((1, 0, 0)), wrap=False)
                if rnd.random() < 0.25: continue
                hang = p + Vector((sx * 0.19, 0, 0.068)); kind = 'arm' if rnd.random() < 0.55 else 'leg'
                limb(G, M, hang + Vector((0, 0, 0.012)), (sx * 0.08, rnd.uniform(-0.1, 0.1), -1.0), kind, 1.25 if kind == 'arm' else 1.1, 'green_ware', rnd.uniform(-0.1, 0.25), 6)
    for y in np.linspace(-L / 2 + 0.15, L / 2 - 0.15, 8):
        if rnd.random() < 0.15: continue
        doll_head(G, M, (rnd.uniform(-0.04, 0.04), y, H + 0.055 * 1.0), (rnd.choice((-1, 1)) * 1.0, rnd.uniform(-0.3, 0.3)), 0.95, None, 'green_ware', sides=8)

# ================================================================ the sewing machine
def sewing_table(G, M, rnd):
    W, D, zt = 0.92, 0.53, 0.76
    for sx in (-1, 1):                                                         # (the cast-iron side frames: scrolled legs and a cross bar)
        x = sx * (W / 2 - 0.06)
        for sy in (-1, 1): F.rod(G, M['black'], [(x, sy * 0.2, 0.02), (x, sy * 0.15, 0.25), (x, sy * 0.17, 0.5), (x, sy * 0.19, zt - 0.03)], 0.014, 6, ma(0.4), sub=2)
        F.rod(G, M['black'], [(x, -0.18, 0.3), (x, 0.0, 0.42), (x, 0.18, 0.3)], 0.01, 6, ma(0.4), sub=2)
        for sy in (-1, 1): G.add(lathe_bm([(0.0, 0.025), (1.0, 0.022)], (x, sy * 0.2, 0.0), (x, sy * 0.2, 0.025), 10), M['black'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['black'], [(-(W / 2 - 0.06), 0.0, 0.14), ((W / 2 - 0.06), 0.0, 0.14)], 0.012, 6, ma(0.4))
    bm = block((-0.25, -0.12, -0.008), (0.25, 0.12, 0.008), 0.003, 1); S.xform(bm, (0, 0, 0), (0.18, 0, 0)); S.xform(bm, (0.0, -0.05, 0.1)); G.add(bm, M['black'], ma(0.5), wrap=False)   # (the treadle)
    wc = Vector((W / 2 - 0.1, 0.0, 0.4)); R = 0.18                             # (the belt wheel)
    F.rod(G, M['black'], [wc + Vector((0, R * math.cos(t), R * math.sin(t))) for t in np.linspace(0, 2 * math.pi, 21)], 0.012, 6, ma(0.4), caps=(False, False))
    for k in range(5): F.rod(G, M['black'], [wc, wc + Vector((0, R * math.cos(2 * math.pi * k / 5 + 0.3), R * math.sin(2 * math.pi * k / 5 + 0.3)))], 0.007, 5, ma(0.4))
    F.rod(G, M['leather'], [wc + Vector((0.012, 0.0, R)), Vector((W / 2 - 0.1, 0.02, zt + 0.12))], 0.004, 4, fa(rnd))
    box(G, M['walnut'], (-W / 2, -D / 2, zt), (W / 2, D / 2, zt + 0.03), wa((1, 0, 0), wear=0.4), 0.004, 1)
    for sx in (-1, 1): box(G, M['walnut'], (sx * 0.3 - 0.11, -D / 2 + 0.02, zt - 0.14), (sx * 0.3 + 0.11, D / 2 - 0.02, zt), wa((1, 0, 0)), 0.004, 1)
    for sx in (-1, 1): G.add(lathe_bm([(0.0, 0.008), (0.7, 0.012), (1.0, 0.0)], (sx * 0.3, -D / 2 + 0.02, zt - 0.07), (sx * 0.3, -D / 2 - 0.01, zt - 0.07), 8), M['brass'], ma(0.5), smooth=True, wrap=False)
    z0 = zt + 0.03                                                             # (the machine: bed, pillar, arm, head, wheel)
    box(G, M['black'], (-0.21, -0.09, z0), (0.21, 0.09, z0 + 0.04), ma(0.5), 0.008, 2)
    box(G, M['black'], (0.1, -0.05, z0 + 0.04), (0.19, 0.05, z0 + 0.26), ma(0.5), 0.02, 2)
    box(G, M['black'], (-0.17, -0.045, z0 + 0.18), (0.19, 0.045, z0 + 0.26), ma(0.5), 0.02, 2)
    box(G, M['black'], (-0.2, -0.04, z0 + 0.1), (-0.13, 0.04, z0 + 0.27), ma(0.5), 0.012, 2)
    F.rod(G, M['steel'], [(-0.175, -0.01, z0 + 0.1), (-0.175, -0.01, z0 + 0.06)], 0.003, 4, ma(0.4))
    G.add(lathe_bm([(0.0, 0.065), (0.2, 0.07), (0.8, 0.07), (1.0, 0.06)], (0.19, 0.0, z0 + 0.19), (0.22, 0.0, z0 + 0.19), 18), M['black'], ma(0.5), smooth=True, wrap=False)
    for k in range(3):                                                         # (gold transfers: bands on the arm)
        box(G, M['gold'], (-0.1 + 0.08 * k, -0.046, z0 + 0.2), (-0.07 + 0.08 * k, -0.045, z0 + 0.24), ma(0.4), 0.0)
    F.rod(G, M['steel'], [(0.05, 0.0, z0 + 0.26), (0.05, 0.0, z0 + 0.36)], 0.003, 4, ma(0.4))
    G.add(lathe_bm([(0.0, 0.014), (0.15, 0.016), (0.85, 0.016), (1.0, 0.014)], (0.05, 0.0, z0 + 0.3), (0.05, 0.0, z0 + 0.355), 10), M['frock'], fa(rnd), smooth=True, wrap=False)   # (the spool on its pin)
    pillow(G, M['frock2'], (-0.2, -0.04, z0 + 0.045), 0.22, 0.16, 0.025, rnd, n=4, sag=0.1)   # (a doll's dress under the needle)
    box(G, M['card'], (0.2, 0.05, z0), (0.4, 0.2, z0 + 0.004), fa(rnd, 4, 4), 0.0)       # (a paper pattern)

# ================================================================ the dress form and the steel column
def dress_form_solid(G, M, rnd):
    import furn_attic2 as A2
    A2.dress_form(G, M, (0.0, 0.0, 0.0), rnd, 1.64, 0.3)
    c = Vector((0.0, 0.0, 0.0))
    def skirt(u, v):
        a = 2 * math.pi * u; z = 1.02 - 0.6 * v; r = 0.135 + 0.102 * v ** 0.8 + 0.008 * math.sin(11 * a) * v
        return c + Vector((r * math.cos(a), r * math.sin(a), z))
    drape(G, M['calico'], 40, 8, skirt, fa(rnd, 3, 3), out=lambda q: (q - c) * Vector((1, 1, 0)))
    for k in range(6):                                                         # (pins in the waistband)
        a = 2 * math.pi * k / 6 + 0.3; p = Vector((0.14 * math.cos(a), 0.14 * math.sin(a), 1.0))
        F.rod(G, M['steel'], [p, p + Vector((0.02 * math.cos(a), 0.02 * math.sin(a), 0.01))], 0.0012, 3, ma(0.4))

def steel_column(G, M, rnd, H):
    """two channels, webs out at y = +-0.085 and flanges turned in, laced across their open sides with flat bars, riveted; base and
       cap plates with gussets"""
    box(G, M['green'], (-0.15, -0.15, 0.0), (0.15, 0.15, 0.015), ma(0.4), 0.002)
    box(G, M['green'], (-0.15, -0.15, H - 0.015), (0.15, 0.15, H), ma(0.4), 0.002)
    z0, z1 = 0.015, H - 0.015
    for sy in (-1, 1):
        box(G, M['green'], (-0.075, sy * 0.085 - 0.004, z0), (0.075, sy * 0.085 + 0.004, z1), ma(0.3), 0.001)
        for sx in (-1, 1):
            ya, yb = sorted((sy * 0.081, sy * 0.025)); xa, xb = sorted((sx * 0.075, sx * 0.067))
            box(G, M['green'], (xa, ya, z0), (xb, yb, z1), ma(0.3), 0.001)
        for z in np.arange(0.2, H - 0.1, 0.3):
            for x in (-0.045, 0.045): G.add(lathe_bm([(0.0, 0.007), (0.6, 0.006), (1.0, 0.0)], (x, sy * 0.089, z), (x, sy * 0.096, z), 5), M['green'], ma(0.5), smooth=True, wrap=False)
    for sx in (-1, 1):                                                         # (the lacing: flat bars zig-zagging up both open sides)
        x = sx * 0.079; zs = np.arange(0.25, H - 0.25, 0.2)
        for k, z in enumerate(zs[:-1]):
            a = Vector((x, -0.05 if k % 2 else 0.05, z)); b = Vector((x, 0.05 if k % 2 else -0.05, zs[k + 1]))
            d = b - a; L = d.length; ang = math.atan2(d.z, d.y)
            bm = block((-0.004, -L / 2 - 0.015, -0.016), (0.004, L / 2 + 0.015, 0.016), 0.0, 1); S.xform(bm, (0, 0, 0), (ang, 0, 0)); S.xform(bm, tuple((a + b) / 2)); G.add(bm, M['green'], ma(0.4), wrap=False)
    for k in range(4):                                                         # (gussets at the foot)
        a = math.pi / 2 * k; d = Vector((math.cos(a), math.sin(a), 0)); n = Vector((-d.y, d.x, 0))
        bm = bmesh.new(); P = [Vector((0, 0, 0.015)) + d * 0.09, Vector((0, 0, 0.015)) + d * 0.145, Vector((0, 0, 0.015)) + d * 0.09 + Vector((0, 0, 0.12))]
        vs = [bm.verts.new(p + n * s_) for s_ in (-0.004, 0.004) for p in P]
        for f_ in ((0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)): bm.faces.new([vs[i] for i in f_])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); G.add(bm, M['green'], ma(0.3), wrap=False)

# ================================================================ main
def mats(k): return lambda: ws_mats(k)

def main():
    want = lambda k: OPTS.only is None or k in OPTS.only
    if want('workbench'): F.run(STYLE, 'workbench', [('Solid_workbench', 'workbench', workbench, mats('workbench'), 51, 2048)])
    if want('kiln'): F.run(STYLE, 'kiln', [('Solid_kiln', 'kiln', kiln, mats('kiln'), 53, 2048)])
    if want('drying_rack'): F.run(STYLE, 'drying_rack', [('Solid_drying_rack', 'drying_rack', drying_rack, mats('drying_rack'), 57, 2048)])
    if want('sewing_table'): F.run(STYLE, 'sewing_table', [('Solid_sewing_table', 'sewing_table', sewing_table, mats('sewing_table'), 59, 1024)])
    if want('dress_form'): F.run(STYLE, 'dress_form', [('Solid_dress_form', 'dress_form', dress_form_solid, mats('dress_form'), 61, 1024)])
    if want('columns') or want('steel_column'):
        F.run(STYLE, 'steel_column', [(f'Col_steel_column_H{h}', f'steel_column_H{h}', (lambda G, M, r, h=h: steel_column(G, M, r, h / 100)), mats('steel_column'), 600 + h, 1024) for h in (360, 420, 450)])
    import furn_workshop2 as W2
    for node, nm, fn, px in W2.BANDS:
        if want(nm) or want('bands') or want(node):
            F.run(STYLE, f'band_{nm}', [(node, f'band_{nm}', fn, (lambda nm=nm: W2.band_mats(nm)), hash(nm) & 0xfff, px)], wall=True)
    isl = [k for k in ('isl_workbench_double', 'isl_kiln', 'isl_drying_rack', 'isl_sorting_table', 'isl_office_desk', 'isl_hanging_dolls') if want(k) or want('islands')]
    if isl:
        import furn_workshop3 as W3
        for grp in (('isl_workbench_double', 'isl_sorting_table'), ('isl_kiln', 'isl_drying_rack'), ('isl_office_desk', 'isl_hanging_dolls')):
            ids = [k for k in isl if k in grp]
            if ids: F.islands(STYLE, W3.build_islands, ids)

if __name__ == '__main__':
    main()
