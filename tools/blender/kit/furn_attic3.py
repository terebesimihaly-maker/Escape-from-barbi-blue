# Escape from Barbi Blue: the attic's islands (WP2.5d, attic style; build spec B4), built by furn_attic.py:
#   Isl_sheeted_sofa     a sofa under a dust sheet and, behind it, a longcase clock under another, up to 1.9 m
#   Isl_trunk_pile       steamer trunks piled two deep, a smaller one and a hatbox on top; the hurricane lantern (the game's fixture)
#                        stands at Isl_trunk_pile_fix on the front trunk's lid
#   Isl_servant_bed      a narrow iron bed under a grey blanket, a pillow, a chamber pot under it; a bentwood chair at its head with
#                        folded clothes and a candlestick; a rag rug
#   Isl_toy_circle       a ring of old toys set out on the boards round a photograph lying face up (note 4-4): a teddy, a doll, a
#                        horse on wheels (the tallest, 0.40 m), soldiers, a drum, a top, blocks, a ball, a train
#   Isl_sheeted_armoire  a great armoire under a dust sheet, an armchair left in front of it, a frame leaning on it, a box
#   Isl_dress_forms      three dressmaker's forms (one in a half-made dress, one bare with its tape, one under a sheet), a cheval
#                        mirror behind, bolts of cloth in a basket, a sewing box
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
import kitlib
import surfaces2 as S
import furnlib as F
from furnlib import wa, ma, turned, box, drape, pillow, grid_surface, fa
from doors import lathe_bm, block, attrs_of
from surfaces2 import sep, finish
from kitlib import lin
import furn_attic as A

def photo(name):
    """a cabinet photograph gone sepia: a girl in a white dress against a painted backdrop, the print silvered at its edges"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); u, v, _ = sep(m, g)
    def ell(cx, cy, rx, ry, soft=0.25):
        d = m.math('ADD', m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', u, cx), rx), 2.0), m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', v, cy), ry), 2.0))
        return m.remap(d, 1.0, 1.0 - soft)
    col = m.mix(m.remap(v, 0.0, 1.0), lin('#5a4630'), lin('#8a7354'))
    col = m.mix(ell(0.5, 0.3, 0.2, 0.3), col, lin('#d8c8a6')); col = m.mix(ell(0.5, 0.68, 0.075, 0.09), col, lin('#b89a74'))
    col = m.mix(m.math('MULTIPLY', ell(0.5, 0.74, 0.1, 0.07), m.remap(v, 0.72, 0.76)), col, lin('#3a2a1c'))
    edge = m.math('MAXIMUM', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', u, 0.5)), 0.4, 0.5), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', v, 0.5)), 0.4, 0.5))
    col = m.mix(m.math('MULTIPLY', edge, 0.7), col, lin('#6a6a6e'))
    col = m.mix(m.remap(m.noise(g, 30, 3), 0.55, 0.7, 0.0, 0.5), col, lin('#c9b48c'))
    return finish(m, col, 0.35, m.val(0.0))

def isl_mats():
    k = 'isl_attic'; M = A.att_mats(k)
    import furn_wood4 as W4, furn_attic2 as A2, furn_tile as T
    M.update(W4.dh_materials()); M.update(W4.doll_materials(k + '_doll')); M['gilt'] = T.gilt(k + '_gilt', 2.0)
    for key in ('card', 'card2', 'string', 'tape', 'hatbox'): M[key] = A2.band_mats('box_stack')[key] if key not in M else M[key]
    M['jersey'] = kitlib.fabric(k + '_jersey', '#c9bca0', weave=0.0, fade=0.6, age=2.0); M['tapem'] = kitlib.fabric(k + '_tapem', '#d8c87a', weave=0.0, stripes=('#2a2a2a', 0.0254), age=1.8)
    M['dress'] = kitlib.fabric(k + '_dress', '#6a5a7a', weave=0.0, fade=0.6, stripes=('#4e405e', 0.03), age=1.9); M['bolt1'] = kitlib.fabric(k + '_bolt1', '#7a3a3a', weave=0.0, fade=0.6, age=1.9)
    M['bolt2'] = kitlib.fabric(k + '_bolt2', '#3a5a5a', weave=0.0, fade=0.6, stripes=('#2a4040', 0.02), age=1.9); M['wicker'] = kitlib.fabric(k + '_wicker', '#a8875a', weave=0.0, stripes=('#6e5636', 0.01), age=2.0)
    M['blanket'] = kitlib.fabric(k + '_blanket', '#6a6862', weave=0.0, fade=0.5, stripes=('#3a3a4e', 0.25), age=2.0); M['linen'] = kitlib.fabric(k + '_linen', '#d6d0c0', weave=0.0, fade=0.4, age=2.0)
    M['enamel'] = kitlib.porcelain(k + '_enamel', '#e8e4da', glaze=True, crackle=0.2, age=2.0); M['ragrug'] = kitlib.fabric(k + '_ragrug', '#7a5a4a', weave=0.0, fade=0.6, stripes=('#4a5a6a', 0.04), age=2.0)
    M['photo'] = photo(k + '_photo'); M['mirror'] = T.mirror_glass(k + '_mirror'); M['tin'] = kitlib.metal(k + '_tin', 'steel', color='#a9aaa4', rust=0.5, age=1.8)
    M['drumskin'] = kitlib.porcelain(k + '_drumskin', '#d9cdb0', glaze=False, crackle=0.1, age=2.0); M['red'] = kitlib.fabric(k + '_red', '#8a2a24', weave=0.0, fade=0.6, age=1.8)
    M['horse'] = kitlib.wood(k + '_horse', 'beech', 'paint', paint='#d8cfb8', age=2.0); M['soldier'] = kitlib.porcelain(k + '_soldier', '#8a2a24', glaze=True, crackle=0.0, age=1.8)
    M['steel'] = kitlib.metal(k + '_steel', 'steel', rust=0.5, age=1.8); M['wax'] = kitlib.porcelain(k + '_wax', '#e6dcc4', glaze=False, crackle=0.0, age=1.6); M['paper'] = kitlib.fabric(k + '_paper', '#6e5032', weave=0.0, fade=0.7, age=2.2)
    return M

# ================================================================ the sheeted sofa and clock
def clock_case(G, M, c, H=1.86):
    c = Vector(c)
    box(G, M['walnut'], tuple(c + Vector((-0.24, -0.15, 0.0))), tuple(c + Vector((0.24, 0.15, 0.22))), wa((1, 0, 0)), 0.006, 1)
    box(G, M['walnut'], tuple(c + Vector((-0.19, -0.12, 0.22))), tuple(c + Vector((0.19, 0.12, H - 0.45))), wa((0, 0, 1)), 0.004, 1)
    box(G, M['walnut'], tuple(c + Vector((-0.13, -0.13, 0.45))), tuple(c + Vector((0.13, -0.12, H - 0.6))), wa((0, 0, 1)), 0.008, 2)   # (the trunk door)
    box(G, M['walnut'], tuple(c + Vector((-0.25, -0.16, H - 0.45))), tuple(c + Vector((0.25, 0.16, H - 0.05))), wa((1, 0, 0)), 0.006, 1)   # (the hood)
    for sx in (-1, 0, 1): G.add(lathe_bm([(0.0, 0.03), (0.5, 0.02), (1.0, 0.0)], c + Vector((sx * 0.2, 0.0, H - 0.05)), c + Vector((sx * 0.2, 0.0, H)), 8), M['brass'], ma(0.5), smooth=True, wrap=False)

def isl_sheeted_sofa(G, M, rnd):
    P = F.Moved(G, Matrix.Translation((0.0, -0.18, 0.0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))    # (the sofa along x, its back to +y)
    A.sofa_parts(P, M, random.Random(5), L=1.76, D=0.86)
    cc = (0.62, 0.47, 0.0); clock_case(G, M, cc, 1.86)
    sof = A.hulls(A.geo_bmesh(lambda Gt: A.sofa_parts(F.Moved(Gt, Matrix.Translation((0.0, -0.18, 0.0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')), M, random.Random(5), L=1.76, D=0.86)),
                  [lambda c: 0.19 < c.z < 0.62, lambda c: c.y > 0.0 and c.z > 0.4, lambda c: c.x < -0.68 and c.z > 0.4, lambda c: c.x > 0.68 and c.z > 0.4])
    clk = A.hulls(A.geo_bmesh(lambda Gt: clock_case(Gt, M, cc, 1.86)), [lambda c: True])
    A.sheet_over(G, M, sof + clk, (2.3, 1.75), (40, 30), (-0.05, -0.2, 1.1), 0.04, (-0.95, -0.65, 0.0), (0.95, 0.65, 1.9), 60)
    A.sheet_over(G, M, sof + clk, (1.1, 1.0), (20, 18), (0.62, 0.47, 2.05), 0.5, (0.3, 0.2, 0.0), (0.95, 0.65, 1.9), 70, tilt=(0.15, 0.0), mat='sheet2')

# ================================================================ the trunk pile
def isl_trunk_pile(G, M, rnd):
    A.trunk(G, M, rnd, 0.86, 0.5, 0.62, 0.0, (-0.37, -0.37, 0.0), 0.05, labels=3)
    A.trunk(G, M, rnd, 0.82, 0.48, 0.645, 0.13, (0.39, -0.36, 0.0), -0.06, labels=3)
    A.trunk(G, M, rnd, 0.98, 0.54, 0.56, 0.0, (0.0, 0.355, 0.0), 0.02, labels=4)
    A.trunk(G, M, rnd, 0.6, 0.38, 0.38, 0.0, (0.06, 0.355, 0.56), 0.12, labels=2)
    import furn_attic2 as A2
    A2.hatbox(G, M, (0.02, 0.345, 0.94), 0.17, 0.3, rnd)
    G.sockets = [('Isl_trunk_pile_fix', (-0.55, -0.4, 0.628))]

# ================================================================ the servant's bed
def bentwood_chair(G, M, c, face, rnd):
    c = Vector(c); f = Vector((face[0], face[1], 0)).normalized(); sd = Vector((-f.y, f.x, 0)); up = Vector((0, 0, 1)); zs = 0.45
    G.add(lathe_bm([(0.0, 0.2), (0.8, 0.2), (1.0, 0.19)], c + up * (zs - 0.03), c + up * zs, 20), M['walnut'], wa((1, 0, 0), wear=0.4), smooth=True, wrap=False)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2; d = sd * math.cos(a) + f * math.sin(a)
        F.rod(G, M['walnut'], [c + d * 0.16 + up * (zs - 0.03), c + d * 0.2 + up * 0.2, c + d * 0.24], 0.014, 6, wa((0, 0, 1)), sub=2)
    ring = [c + (sd * math.cos(t) + f * math.sin(t)) * 0.2 + up * 0.18 for t in np.linspace(0, 2 * math.pi, 17)]
    F.rod(G, M['walnut'], ring, 0.009, 5, wa((1, 0, 0)), caps=(False, False))
    bk = [c - f * 0.17 + sd * 0.15 + up * (zs - 0.02), c - f * 0.2 + sd * 0.16 + up * 0.75, c - f * 0.21 + sd * 0.08 + up * 0.9, c - f * 0.21 + up * 0.92, c - f * 0.21 - sd * 0.08 + up * 0.9, c - f * 0.2 - sd * 0.16 + up * 0.75, c - f * 0.17 - sd * 0.15 + up * (zs - 0.02)]
    F.rod(G, M['walnut'], bk, 0.014, 6, wa((0, 0, 1)), sub=3)
    F.rod(G, M['walnut'], [c - f * 0.2 + sd * 0.155 + up * 0.62, c - f * 0.205 + up * 0.6, c - f * 0.2 - sd * 0.155 + up * 0.62], 0.01, 5, wa((1, 0, 0)), sub=2)
    return c + up * zs

def isl_servant_bed(G, M, rnd):
    R = Matrix.Translation((0.95, -0.25, 0.0)) @ Matrix(((0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))   # (the bed's length along x, its head at +x)
    P = F.Moved(G, R)
    A.iron_bed(P, M, random.Random(9), W=0.84, L=1.88, hh=1.0, hf=0.72, zm=0.4)
    bed = A.hulls(A.geo_bmesh(lambda Gt: A.iron_bed(F.Moved(Gt, R), M, random.Random(9), W=0.84, L=1.88, hh=1.0, hf=0.72, zm=0.4)),
                  [lambda c: 0.3 < c.z < 0.7 and -0.9 < c.x < 0.88, lambda c: c.x > 0.88, lambda c: c.x < -0.9], 0.006)
    pillow(G, M['linen'], (0.68, -0.25, 0.62), 0.3, 0.55, 0.12, rnd, n=6, sag=0.5)
    A.sheet_over(G, M, bed, (1.65, 1.5), (34, 30), (-0.12, -0.25, 1.05), 0.0, (-0.95, -0.7, 0.0), (0.95, 0.7, 1.0), 60, mat='blanket')
    seat = bentwood_chair(G, M, (0.62, 0.43, 0.0), (0.0, -1.0), rnd)
    for k, (mk, h) in enumerate((('blanket', 0.05), ('linen', 0.04))):         # (folded clothes on the chair, a candlestick)
        pillow(G, M[mk], tuple(seat + Vector((0.0, 0.02, 0.025 + 0.045 * k))), 0.26 - 0.04 * k, 0.22 - 0.03 * k, h, rnd, n=4, sag=0.1)
    cs = seat + Vector((0.12, -0.1, 0.0))
    G.add(lathe_bm([(0.0, 0.05), (0.15, 0.05), (0.3, 0.012), (0.9, 0.012), (1.0, 0.02)], cs, cs + Vector((0, 0, 0.06)), 12), M['enamel'], ma(0.3), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.011), (0.85, 0.011), (1.0, 0.004)], cs + Vector((0, 0, 0.06)), cs + Vector((0, 0, 0.16)), 8), M['wax'], ma(), smooth=True, wrap=False)
    cp = Vector((0.1, -0.3, 0.0))                                                # (the chamber pot under the bed)
    G.add(lathe_bm([(0.0, 0.07), (0.3, 0.1), (0.75, 0.11), (0.9, 0.105), (1.0, 0.125)], cp, cp + Vector((0, 0, 0.15)), 18, (True, False)), M['enamel'], ma(0.3), smooth=True, wrap=False)
    F.rod(G, M['enamel'], [cp + Vector((0.11, 0.0, 0.12)), cp + Vector((0.16, 0.0, 0.1)), cp + Vector((0.15, 0.0, 0.05)), cp + Vector((0.105, 0.0, 0.04))], 0.01, 6, ma(0.3), sub=2)
    rows = [[Vector((0.55 * math.cos(t) * s_ + 0.0, 0.3 * math.sin(t) * s_ + 0.38, 0.004)) for t in np.linspace(0, 2 * math.pi, 25)] for s_ in np.linspace(0.02, 1.0, 5)]
    grid_surface(G, M['ragrug'], rows, attrs_of(lambda q: (math.hypot(q[0] / 0.55, (q[1] - 0.38) / 0.3) * 0.5, 0.0, 0.0), 0.5), flip_to=lambda q: Vector((0, 0, 1)))

# ================================================================ the toy circle
def horse_on_wheels(G, M, c, face, rnd):
    """a carved horse on a wheeled board, the tallest toy: 0.40 m"""
    c = Vector(c); f = Vector((face[0], face[1], 0)).normalized(); sd = Vector((-f.y, f.x, 0)); up = Vector((0, 0, 1))
    box(F.Moved(G, Matrix.Translation(c) @ Matrix.Rotation(math.atan2(f.y, f.x), 4, 'Z')), M['pine'], (-0.17, -0.06, 0.04), (0.17, 0.06, 0.06), wa((1, 0, 0)), 0.004)
    for a in (-0.12, 0.12):
        for s in (-1, 1): G.add(lathe_bm([(0.0, 0.035), (1.0, 0.035)], c + f * a + sd * s * 0.06 + up * 0.035, c + f * a + sd * s * 0.075 + up * 0.035, 12), M['red'], ma(), wrap=False)
    G.add(lathe_bm([(0.0, 0.03), (0.3, 0.06), (0.7, 0.06), (1.0, 0.035)], c - f * 0.12 + up * 0.2, c + f * 0.1 + up * 0.22, 10), M['horse'], wa(f), smooth=True, wrap=False)
    for a in (-0.09, 0.07):
        for s in (-1, 1): F.rod(G, M['horse'], [c + f * a + sd * s * 0.03 + up * 0.2, c + f * a + sd * s * 0.035 + up * 0.06], 0.012, 6, wa((0, 0, 1)))
    F.rod(G, M['horse'], [c + f * 0.08 + up * 0.23, c + f * 0.12 + up * 0.32], 0.028, 8, wa(f))
    G.add(lathe_bm([(0.0, 0.035), (0.6, 0.032), (1.0, 0.015)], c + f * 0.11 + up * 0.33, c + f * 0.21 + up * 0.31, 8), M['horse'], wa(f), smooth=True, wrap=False)
    for s in (-1, 1): G.add(lathe_bm([(0.0, 0.01), (1.0, 0.0)], c + f * 0.12 + sd * s * 0.015 + up * 0.36, c + f * 0.115 + sd * s * 0.018 + up * 0.4, 6), M['horse'], wa(), smooth=True, wrap=False)
    F.rod(G, M['hair'], [c + f * 0.1 + up * 0.36, c + f * 0.06 + up * 0.3, c + f * 0.04 + up * 0.24], 0.012, 5, fa(rnd), sub=2)
    F.rod(G, M['hair'], [c - f * 0.13 + up * 0.21, c - f * 0.18 + up * 0.16, c - f * 0.19 + up * 0.08], 0.012, 5, fa(rnd), sub=2)

def drum(G, M, c, rnd):
    c = Vector(c)
    G.add(lathe_bm([(0.0, 0.1), (1.0, 0.1)], c, c + Vector((0, 0, 0.12)), 18, (False, False)), M['red'], ma(), smooth=True, wrap=False)
    for z in (0.0, 0.12): G.add(lathe_bm([(0.0, 0.103), (1.0, 0.103)], c + Vector((0, 0, z - 0.008)), c + Vector((0, 0, z + 0.008)), 18), M['pine'], wa(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.098), (1.0, 0.098)], c + Vector((0, 0, 0.118)), c + Vector((0, 0, 0.121)), 18, (False, True)), M['drumskin'], ma(), wrap=False)
    for k in range(8):
        a = 2 * math.pi * k / 8; b = a + math.pi / 8
        F.rod(G, M['string'], [c + Vector((0.102 * math.cos(a), 0.102 * math.sin(a), 0.01)), c + Vector((0.102 * math.cos(b), 0.102 * math.sin(b), 0.11))], 0.0015, 3, fa(rnd))
    for s in (-1, 1): F.rod(G, M['pine'], [c + Vector((0.13, s * 0.04, 0.005)), c + Vector((0.3, s * 0.07, 0.01))], 0.006, 5, wa((1, 0, 0)))

def soldier(G, M, c, rnd):
    c = Vector(c)
    G.add(lathe_bm([(0.0, 0.012), (0.1, 0.012), (0.12, 0.007), (0.55, 0.008), (0.62, 0.006), (0.72, 0.0065), (0.8, 0.007), (1.0, 0.006)], c, c + Vector((0, 0, 0.07)), 6), M['soldier'], ma(), smooth=True, wrap=False)

def isl_toy_circle(G, M, rnd):
    rows = [[Vector((0.845 * s_ * math.cos(t), 0.845 * s_ * math.sin(t), 0.003 + 0.001 * math.sin(5 * t) * s_)) for t in np.linspace(0, 2 * math.pi, 41)] for s_ in np.linspace(0.02, 1.0, 7)]
    grid_surface(G, M['ragrug'], rows, attrs_of(lambda q: (math.hypot(q[0], q[1]) * 0.6, 0.0, 0.0), 0.5), flip_to=lambda q: Vector((0, 0, 1)))   # (an old rag rug they sit on)
    fr = Vector((0.0, 0.0, 0.006))                                              # (the photograph in its frame, face up, in the middle)
    box(G, M['walnut'], (-0.1, -0.13, 0.006), (0.1, 0.13, 0.024), wa((1, 0, 0)), 0.003, 1)
    box(G, M['photo'], (-0.075, -0.105, 0.024), (0.075, 0.105, 0.026), attrs_of(lambda q: ((q[0] + 0.075) / 0.15, (q[1] + 0.105) / 0.21, 0.0), 0.5), 0.0)
    R = 0.71; toys = ['teddy', 'soldiers', 'doll', 'top', 'drum', 'horse', 'blocks', 'jack', 'train', 'soldiers2']   # (the tall ones round all four sides)
    import furn_wood4 as W4
    for i, kind in enumerate(toys):
        a = 2 * math.pi * i / len(toys) + 0.1; p = Vector((R * math.cos(a), R * math.sin(a), 0.0)); inward = Vector((-math.cos(a), -math.sin(a), 0.0))
        if kind == 'teddy': W4.teddy(G, M, p, inward, rnd, 1.05)
        elif kind == 'doll':
            import furn_tile as T
            seat = T.little_chair(G, M, p, inward, 1.0); W4.seated_doll(G, M, seat, inward, rnd, 0.65, bonnet=True, frock='frockA', lod=0.8)
        elif kind == 'horse': horse_on_wheels(G, M, p, (-inward.y, inward.x), rnd)
        elif kind == 'drum': drum(G, M, p, rnd)
        elif kind in ('soldiers', 'soldiers2'):
            for k in range(5): soldier(G, M, p + Vector((-inward.y, inward.x, 0)) * (k - 2) * 0.035, rnd)
        elif kind == 'top': G.add(lathe_bm([(0.0, 0.0), (0.3, 0.045), (0.6, 0.05), (0.8, 0.025), (1.0, 0.008)], p, p + Vector((0, 0, 0.11)), 14), M['top'], wa(), smooth=True, wrap=False)
        elif kind == 'jack':                                                    # (a jack-in-the-box sprung open: the box, its lid back, the spring, the clown)
            put = F.Moved(G, Matrix.Translation(p) @ Matrix.Rotation(math.atan2(inward.y, inward.x) + math.pi / 2, 4, 'Z'))
            box(put, M['red'], (-0.06, -0.06, 0.006), (0.06, 0.06, 0.126), wa(), 0.004)
            bm = block((-0.06, 0.0, -0.004), (0.06, 0.12, 0.004), 0.002, 1); S.xform(bm, (0, 0, 0), (1.9, 0, 0)); S.xform(bm, (0.0, 0.06, 0.126)); put.add(bm, M['horse'], wa(), wrap=False)
            F.rod(put, M['steel'], [Vector((0.03 * math.cos(t), 0.03 * math.sin(t), 0.12 + 0.012 * t)) for t in np.linspace(0, 6 * math.pi, 25)], 0.003, 4, ma(0.4))
            sp = bmesh.new(); bmesh.ops.create_uvsphere(sp, u_segments=12, v_segments=8, radius=0.04); S.xform(sp, (0.0, 0.0, 0.235)); put.add(sp, M['bisque'], ma(), smooth=True, wrap=False)
            put.add(lathe_bm([(0.0, 0.035), (1.0, 0.0)], (0.0, 0.0, 0.265), (0.0, 0.0, 0.34), 10), M['red'], ma(), smooth=True, wrap=False)
            for sx in (-1, 1): put.add(lathe_bm([(0.0, 0.0), (0.5, 0.006), (1.0, 0.0)], (sx * 0.014, -0.034, 0.24), (sx * 0.014, -0.042, 0.24), 6), M['eye'], ma(), wrap=False)
        elif kind == 'blocks':                                                  # (a tower of blocks and two fallen ones)
            for k, (dx, dy, z, r) in enumerate(((0.0, 0.0, 0.0, 0.1), (0.005, 0.0, 0.05, 0.5), (0.0, 0.004, 0.1, 0.9), (-0.004, 0.003, 0.15, 0.3), (0.003, -0.002, 0.2, 0.7), (0.09, 0.05, 0.0, 0.3), (-0.08, 0.06, 0.0, 1.1))):
                bm = block((-0.025, -0.025, 0.0), (0.025, 0.025, 0.05), 0.003, 1); S.xform(bm, (0, 0, 0), (0, 0, r)); S.xform(bm, tuple(p + Vector((dx, dy, z + 0.006)))); G.add(bm, M['bricks'], wa(), wrap=False)
        elif kind == 'ball':
            bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.07); S.xform(bm, tuple(p + Vector((0, 0, 0.07)))); G.add(bm, M['red'], fa(rnd, 6, 6), smooth=True, wrap=False)
        elif kind == 'train':
            d = Vector((-inward.y, inward.x, 0))
            for k in range(3):
                c = p + d * (k - 1) * 0.15; L = 0.12
                put = F.Moved(G, Matrix.Translation(c) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, 'Z'))
                box(put, M['train'], (-L / 2, -0.04, 0.025), (L / 2, 0.04, 0.07), wa(), 0.004)
                for w in (-1, 1):
                    for s in (-1, 1): put.add(lathe_bm([(0.0, 0.02), (1.0, 0.02)], (w * L * 0.3, s * 0.038, 0.02), (w * L * 0.3, s * 0.05, 0.02), 10), M['iron'], ma(), wrap=False)
    for k in range(6):                                                           # (marbles strewn)
        p = Vector((rnd.uniform(-0.45, 0.45), rnd.uniform(-0.45, 0.45), 0.0)); bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.008); S.xform(bm, tuple(p + Vector((0, 0, 0.008)))); G.add(bm, M['eye'], ma(), smooth=True, wrap=False)

# ================================================================ the sheeted armoire
def isl_sheeted_armoire(G, M, rnd):
    P = F.Moved(G, Matrix.Translation((0.0, 0.36, 0.0)))
    A.wardrobe(P, M, random.Random(3), W=1.2, D=0.58, H=1.98)
    arm = A.hulls(A.geo_bmesh(lambda Gt: A.wardrobe(F.Moved(Gt, Matrix.Translation((0.0, 0.36, 0.0))), M, random.Random(3), W=1.2, D=0.58, H=1.98)), [lambda c: True])
    C = Matrix.Translation((0.22, -0.285, 0.0))                                  # (an armchair left uncovered in front of it)
    A.chair_parts(F.Moved(G, C), M, 7)
    A.sheet_over(G, M, arm, (2.8, 2.2), (44, 36), (0.12, 0.36, 2.2), 0.08, (-0.65, -0.65, 0.0), (0.65, 0.65, 2.0), 100, tilt=(0.0, 0.1))
    import furn_attic2 as A2
    A2.frame(G, M, (-0.38, -0.08, 0.0), 0.42, 0.55, math.radians(-12), rnd, back=True)
    A2.cbox(G, M, (-0.62, -0.6, 0.0), (-0.3, -0.3, 0.28), rnd, 0.1, 'card', tied=True)

# ================================================================ the dress forms
def isl_dress_forms(G, M, rnd):
    import furn_attic2 as A2
    A2.dress_form(G, M, (-0.48, 0.1, 0.0), rnd, 1.63, -0.3)
    A2.dress_form(G, M, (0.18, -0.12, 0.0), rnd, 1.58, 0.15)
    c = Vector((0.18, -0.12, 0.0))                                               # (a half-made dress pinned on the middle one: the skirt)
    def skirt(u, v):
        a = 2 * math.pi * u; z = 1.0 - 0.6 * v; r = 0.15 + 0.13 * v + 0.012 * math.sin(9 * a) * v
        return c + Vector((r * math.cos(a), r * math.sin(a) * 0.85, z))
    drape(G, M['dress'], 36, 8, skirt, fa(rnd, 3, 3), out=lambda q: (q - c) * Vector((1, 1, 0)))
    c3 = Vector((0.6, 0.3, 0.0)); A2.dress_form(G, M, tuple(c3), rnd, 1.6, 0.6)
    fm = A.hulls(A.geo_bmesh(lambda Gt: A2.dress_form(Gt, M, tuple(c3), random.Random(1), 1.6, 0.6)), [lambda c: c.z > 0.9, lambda c: c.z <= 0.9])
    A.sheet_over(G, M, fm, (1.2, 1.2), (24, 24), (0.6, 0.3, 1.9), 0.4, (0.2, -0.1, 0.0), (0.8, 0.65, 1.65), 60)
    mb = Vector((-0.2, 0.56, 0.0))                                                 # (a cheval mirror behind them)
    for s in (-1, 1):
        F.rod(G, M['walnut'], [mb + Vector((s * 0.3, -0.05, 0.0)), mb + Vector((s * 0.3, 0.0, 0.03)), mb + Vector((s * 0.3, 0.05, 0.0))], 0.015, 6, wa((0, 1, 0)), sub=2)
        F.rod(G, M['walnut'], [mb + Vector((s * 0.3, 0.0, 0.03)), mb + Vector((s * 0.3, 0.0, 1.55))], 0.018, 8, wa((0, 0, 1)))
    Pm = F.Moved(G, Matrix.Translation(mb + Vector((0, 0, 0.85))) @ Matrix.Rotation(0.12, 4, 'X'))
    box(Pm, M['walnut'], (-0.27, -0.025, -0.7), (0.27, 0.0, 0.7), wa((0, 0, 1)), 0.008, 1)
    box(Pm, M['mirror'], (-0.23, -0.03, -0.66), (0.23, -0.025, 0.66), ma(), 0.0)
    bk = Vector((-0.6, -0.45, 0.0))                                                # (bolts of cloth standing in a basket)
    G.add(lathe_bm([(0.0, 0.16), (0.7, 0.19), (1.0, 0.2)], bk, bk + Vector((0, 0, 0.35)), 18, (True, False)), M['wicker'], fa(rnd, 4, 4), smooth=True, wrap=False)
    for k, (dx, dy, lean, mk) in enumerate(((-0.06, -0.04, 0.1, 'bolt1'), (0.07, 0.02, -0.08, 'bolt2'), (0.0, 0.08, 0.05, 'linen'))):
        b = bk + Vector((dx, dy, 0.05)); t_ = b + Vector((math.sin(lean) * 0.9, 0.04, math.cos(lean) * 0.9))
        G.add(lathe_bm([(0.0, 0.05), (1.0, 0.05)], b, t_, 12), M[mk], fa(rnd, 3, 3), smooth=True, wrap=False)
    sb = Vector((0.55, -0.45, 0.0))                                                # (a sewing box on its legs)
    for sx in (-1, 1):
        for sy in (-1, 1): F.rod(G, M['walnut'], [sb + Vector((sx * 0.14, sy * 0.09, 0.0)), sb + Vector((sx * 0.12, sy * 0.08, 0.5))], 0.012, 6, wa((0, 0, 1)))
    box(G, M['walnut'], tuple(sb + Vector((-0.16, -0.11, 0.5))), tuple(sb + Vector((0.16, 0.11, 0.66))), wa((1, 0, 0)), 0.005, 1)

# ================================================================ build
def build_islands(want):
    rnd = random.Random(97); M = isl_mats(); roots = []; parts = []
    for name, fn in (('Isl_sheeted_sofa', isl_sheeted_sofa), ('Isl_trunk_pile', isl_trunk_pile), ('Isl_servant_bed', isl_servant_bed), ('Isl_toy_circle', isl_toy_circle),
                     ('Isl_sheeted_armoire', isl_sheeted_armoire), ('Isl_dress_forms', isl_dress_forms)):
        if not want(name.lower()): continue
        G = S.Geo(1, 1, False, False); G.sockets = []; fn(G, M, rnd); o = F.build_obj(name.lower() + '_tmp', G); parts.append(o)
        roots.append((name, [o], None, None, None, [], getattr(G, 'sockets', [])))
    return roots, parts, M
