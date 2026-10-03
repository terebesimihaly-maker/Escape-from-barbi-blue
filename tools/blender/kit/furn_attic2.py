# Escape from Barbi Blue: the attic's wall pieces (WP2.5d, attic; build spec B6), built by furn_attic.py:
#   Band_box_stack       cardboard boxes stacked against the wall, one tied with string, a flap open, a hatbox on top
#   Band_rolled_rug      two rugs rolled up and stood leaning on the wall, tied round with string
#   Band_leaning_mirror  a tall mirror in a mahogany frame leaning on the wall, its silvering foxed
#   Band_suitcase_pile   suitcases piled flat, a vanity case and a hatbox on top: leather and fibreboard, brass locks, labels
#   Band_mannequin       a dressmaker's form on its tripod, a tape measure round its neck
#   Band_frames_leaning  picture frames leaning on the wall: a dark portrait facing out, the backs of others
#   Band_cobweb_card     cobwebs across a top corner (an alpha card; the strands and the dusty sheets of web in its alpha)
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
from kitlib import lin
import furn_attic as A

# ================================================================ materials
def rug_end(name):
    """the end of a rolled rug: the turns of carpet seen edge on, a spiral of pile and backing (gpos: radius, angle)"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); r, a, _ = sep(m, g)
    sp = m.math('FRACT', m.math('ADD', m.math('DIVIDE', r, 0.012), m.math('DIVIDE', a, 6.283)))
    col = m.mix(m.remap(sp, 0.55, 0.75), lin('#5a2a22'), lin('#b9a888'))
    col = m.mix(m.remap(m.noise(g, 30, 3), 0.3, 0.7, 0.0, 0.4), col, lin('#3a2a24'))
    return finish(m, col, 0.9, m.math('MULTIPLY', m.remap(sp, 0.55, 0.75), -0.001))

def oil_painting(name, kind):
    """a dark Victorian oil, its varnish gone brown and crazed: a portrait of a woman in black (an oval of face against the gloom, a
       white collar) or a landscape (a pale sky, dark trees, a pool)"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); u, v, _ = sep(m, g)
    def ell(cx, cy, rx, ry, soft=0.15):
        d = m.math('ADD', m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', u, cx), rx), 2.0), m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', v, cy), ry), 2.0))
        return m.remap(d, 1.0, 1.0 - soft)
    if kind == 'portrait':
        col = m.mix(m.remap(v, 0.0, 1.0), lin('#1a1410'), lin('#3a2e22'))
        col = m.mix(ell(0.5, 0.2, 0.42, 0.32), col, lin('#0e0c0a'))                               # (the black dress)
        col = m.mix(ell(0.5, 0.42, 0.09, 0.03, 0.4), col, lin('#b8ac94'))                          # (the collar)
        col = m.mix(ell(0.5, 0.6, 0.11, 0.15, 0.3), col, lin('#a07a5a'))                          # (the face)
        col = m.mix(m.math('MULTIPLY', ell(0.5, 0.68, 0.14, 0.1, 0.4), m.remap(v, 0.66, 0.7)), col, lin('#1a120c'))   # (hair)
        for cx in (0.46, 0.54): col = m.mix(ell(cx, 0.62, 0.012, 0.008, 0.5), col, lin('#2a1c14'))
    else:
        col = m.mix(m.remap(v, 0.45, 1.0), lin('#5a5238'), lin('#a89a70'))
        col = m.mix(m.math('MULTIPLY', m.remap(v, 0.62, 0.4), m.remap(m.noise(g, 6, 4), 0.35, 0.6)), col, lin('#1e2214'))
        col = m.mix(ell(0.55, 0.2, 0.25, 0.06, 0.4), col, lin('#8a8a6a'))
    col = m.mix(1.0, col, (0.78, 0.62, 0.4), 'MULTIPLY')                                              # (the brown varnish)
    cr = m.voronoi(m.map(g, (1, 1, 1)), 90, 'Distance', 'DISTANCE_TO_EDGE'); crack = m.remap(cr, 0.03, 0.0)
    col = m.mix(m.math('MULTIPLY', crack, 0.6), col, (0.02, 0.015, 0.01))
    nz = sep(m, m.geo('Normal'))[2]; col = m.mix(m.math('MULTIPLY', m.remap(nz, 0.2, 0.8), 0.6), col, lin('#8c877d'))
    return finish(m, col, m.mixf(crack, 0.35, 0.8), m.math('ADD', m.math('MULTIPLY', crack, -0.0004), m.math('MULTIPLY', m.noise(g, 200, 3), 0.0003)))

def cobweb(name):
    """old cobwebs: radial threads and the spiral between them, broken and sagging, grey with dust, sheets of web clotted in the angle
       (gpos: x, y on the card in m from the corner) -> the strands' alpha in the ALPHA node"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); x, y, _ = sep(m, g)
    r = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', x, x), m.math('MULTIPLY', y, y))); a = m.math('ARCTAN2', y, x)
    wob = m.math('MULTIPLY', m.math('SUBTRACT', m.noise(g, 9, 2), 0.5), 0.12)
    rad = m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('MULTIPLY', m.math('ADD', a, wob), 4.0)), 0.5)), 0.493, 0.5)
    spi = m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('ADD', m.math('MULTIPLY', r, 28.0), m.math('MULTIPLY', a, 0.3))), 0.5)), 0.465, 0.5)
    broken = m.remap(m.noise(g, 7, 3), 0.42, 0.52)
    th = m.math('MULTIPLY', m.math('MAXIMUM', rad, m.math('MULTIPLY', spi, broken)), m.remap(r, 0.55, 0.3))
    sheetw = m.math('MULTIPLY', m.remap(m.noise(g, 5, 4, 0.6), 0.5, 0.75, 0.0, 0.55), m.remap(r, 0.35, 0.05))
    al = m.math('MAXIMUM', th, sheetw); al.node.name = 'ALPHA'
    col = m.mix(m.remap(m.noise(g, 20, 3), 0.3, 0.7), lin('#b9b5ac'), lin('#7c7870'))
    return finish(m, col, 0.95, m.val(0.0))

def band_mats(nm):
    k = f'band_{nm}'; M = A.att_mats(k)
    import furn_concrete as C, furn_tile as T, furn_tile3 as T3
    M['card'] = kitlib.fabric(k + '_card', '#8f6c47', weave=0.0, fade=0.7, age=2.2); M['card2'] = kitlib.fabric(k + '_card2', '#a68a62', weave=0.0, fade=0.7, age=2.2)
    M['string'] = kitlib.fabric(k + '_string', '#b8a67e', weave=0.0, age=1.8); M['tape'] = kitlib.fabric(k + '_tape', '#c9b48a', weave=0.0, fade=0.8, age=2.0)
    M['hatbox'] = kitlib.fabric(k + '_hatbox', '#7a8a8a', weave=0.0, fade=0.7, stripes=('#d6c8a6', 0.04), age=2.2)
    if nm == 'rolled_rug': M['rug'] = T3.persian(k + '_rug'); M['rug2'] = T3.persian(k + '_rug2', '#2a3448', '#5a1a1a', '#a8905a'); M['rugend'] = rug_end(k + '_rugend')
    if nm == 'leaning_mirror': M['mirror'] = T.mirror_glass(k + '_mirror')
    if nm == 'suitcase_pile': M['fibre'] = kitlib.fabric(k + '_fibre', '#6a4a2a', weave=0.0, fade=0.6, age=2.0); M['vanity'] = kitlib.fabric(k + '_vanity', '#3a4a3a', weave=0.0, fade=0.6, age=2.0)
    if nm == 'mannequin': M['jersey'] = kitlib.fabric(k + '_jersey', '#c9bca0', weave=0.0, fade=0.6, age=2.0); M['tapem'] = kitlib.fabric(k + '_tapem', '#d8c87a', weave=0.0, stripes=('#2a2a2a', 0.0254), age=1.8)
    if nm == 'frames_leaning': M['gilt'] = T.gilt(k + '_gilt', 2.0); M['portrait'] = oil_painting(k + '_portrait', 'portrait'); M['landscape'] = oil_painting(k + '_landscape', 'landscape'); M['paper'] = kitlib.fabric(k + '_paper', '#6e5032', weave=0.0, fade=0.7, age=2.2)
    if nm == 'cobweb_card': M['web'] = cobweb(k + '_web')
    return M

# ================================================================ the box stack
def cbox(G, M, lo, hi, rnd, rot=0.0, mat='card', flaps=False, tied=False):
    lo, hi = Vector(lo), Vector(hi); c = (lo + hi) / 2; c.z = lo.z; s = hi - lo
    Pm = F.Moved(G, Matrix.Translation(c) @ Matrix.Rotation(rot, 4, 'Z'))
    box(Pm, M[mat], (-s.x / 2, -s.y / 2, 0.0), (s.x / 2, s.y / 2, s.z), fa(rnd, 3, 3), 0.004, 1)
    box(Pm, M['tape'], (-s.x / 2 - 0.001, -0.025, s.z - 0.0), (s.x / 2 + 0.001, 0.025, s.z + 0.0015), fa(rnd, 5, 5), 0.0)
    for sx in (-1, 1): box(Pm, M['tape'], (sx * s.x / 2 - (0.0015 if sx < 0 else 0), -0.025, s.z - 0.06), (sx * s.x / 2 + (0.0015 if sx > 0 else 0), 0.025, s.z), fa(rnd, 5, 5), 0.0)
    if tied:
        for x in (-s.x / 4, s.x / 4):
            F.rod(Pm, M['string'], [(x, -s.y / 2 - 0.003, 0.0), (x, -s.y / 2 - 0.003, s.z + 0.002), (x, s.y / 2 + 0.003, s.z + 0.002), (x, s.y / 2 + 0.003, 0.0)], 0.0025, 4, fa(rnd))
        F.rod(Pm, M['string'], [(-s.x / 2 - 0.003, 0.0, s.z + 0.002), (s.x / 2 + 0.003, 0.0, s.z + 0.002)], 0.0025, 4, fa(rnd))
    if flaps:
        for sy in (-1, 1):                                                     # (the front flap falls open forward, the back one stands against the wall)
            bm = block((-s.x / 2 + 0.005, 0.0, -0.001), (s.x / 2 - 0.005, s.y * 0.45, 0.002), 0.0, 1); S.xform(bm, (0, 0, 0), (1.4 if sy < 0 else 1.53, 0, 0))
            for v in bm.verts: v.co.y *= sy
            S.xform(bm, (0, sy * s.y / 2, s.z)); Pm.add(bm, M[mat], fa(rnd, 3, 3), wrap=False)

def hatbox(G, M, c, r, h, rnd):
    c = Vector(c)
    G.add(lathe_bm([(0.0, r), (1.0, r)], c, c + Vector((0, 0, h - 0.03)), 20), M['hatbox'], fa(rnd, 4, 4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r + 0.006), (1.0, r + 0.006)], c + Vector((0, 0, h - 0.04)), c + Vector((0, 0, h)), 20), M['card2'], fa(rnd, 4, 4), smooth=True, wrap=False)
    F.rod(G, M['string'], [c + Vector((-r * 0.5, 0, h)), c + Vector((-r * 0.3, 0, h + 0.05)), c + Vector((r * 0.3, 0, h + 0.05)), c + Vector((r * 0.5, 0, h))], 0.004, 5, fa(rnd), sub=2)

def box_stack(G, M, rnd):
    cbox(G, M, (-0.44, -0.42, 0.0), (0.0, -0.01, 0.42), rnd, 0.02, tied=True)
    cbox(G, M, (0.02, -0.4, 0.0), (0.44, -0.02, 0.38), rnd, -0.03, 'card2', flaps=True)
    cbox(G, M, (-0.36, -0.39, 0.42), (0.36, -0.04, 0.78), rnd, 0.04)
    hatbox(G, M, (-0.18, -0.2, 0.78), 0.16, 0.24, rnd)
    cbox(G, M, (0.06, -0.36, 0.78), (0.36, -0.08, 1.2), rnd, -0.08, 'card2')

# ================================================================ rolled rugs
def rolled_rug(G, M, rnd):
    for (bx, by, top, r, L, mat) in ((0.06, -0.2, (0.07, -0.105, 1.68), 0.1, 1.68, 'rug'), (-0.1, -0.24, (-0.13, -0.08, 1.42), 0.075, 1.43, 'rug2')):
        b = Vector((bx, by, r * 0.0)); t_ = Vector(top); ax = (t_ - b).normalized(); L = (t_ - b).length
        u_, v_ = kitlib.frame(ax, (0, 0, 1))
        G.add(lathe_bm([(0.0, r * 0.97), (0.02, r), (0.98, r), (1.0, r * 0.97)], b, t_, 20, (False, False)), M[mat], attrs_of(lambda q, b=b, ax=ax, u_=u_, v_=v_, r=r: (math.atan2((Vector(q) - b).dot(v_), (Vector(q) - b).dot(u_)) * r / 1.6 + 0.5, (Vector(q) - b).dot(ax) / 1.7, 0.0), rnd.random()), smooth=True, wrap=False)
        for e, sgn in ((b, -1), (t_, 1)):                                    # (the ends: the turns of carpet)
            bm = bmesh.new(); ring = [bm.verts.new(e + (u_ * math.cos(2 * math.pi * j / 20) + v_ * math.sin(2 * math.pi * j / 20)) * r * 0.97) for j in range(20)]
            cen = bm.verts.new(e)
            for j in range(20):
                f_ = bm.faces.new((cen, ring[j], ring[(j + 1) % 20])); f_.normal_update()
                if f_.normal.dot(ax * sgn) < 0: f_.normal_flip()
            G.add(bm, M['rugend'], attrs_of(lambda q, e=e, u_=u_, v_=v_: ((Vector(q) - e).length, math.atan2((Vector(q) - e).dot(v_), (Vector(q) - e).dot(u_)) + math.pi, 0.0), 0.5), wrap=False)
        for s in (0.25, 0.75):                                              # (string tied round)
            cc = b + ax * L * s; ring = [cc + (u_ * math.cos(t) + v_ * math.sin(t)) * (r + 0.002) for t in np.linspace(0, 2 * math.pi, 15)]
            F.rod(G, M['string'], ring, 0.003, 4, fa(rnd), caps=(False, False))

# ================================================================ the leaning mirror
def leaning_mirror(G, M, rnd):
    W, H, a = 0.62, 1.55, math.radians(-9.0); b0 = Vector((0.0, -0.27, 0.0))   # (leaning back on the wall: its top toward +y)
    R = Matrix.Rotation(a, 3, 'X'); up = R @ Vector((0, 0, 1)); nrm = R @ Vector((0, -1, 0))
    P = lambda x, z, d=0.0: b0 + Vector((x, 0, 0)) + up * z + nrm * d
    Pm = F.Moved(G, Matrix.Translation(b0) @ Matrix.Rotation(a, 4, 'X'))
    box(Pm, M['mirror'], (-W / 2 + 0.07, -0.008, 0.07), (W / 2 - 0.07, -0.004, H - 0.07), ma(), 0.0)
    for lo, hi in (((-W / 2, -0.04, 0.0), (W / 2, 0.0, 0.07)), ((-W / 2, -0.04, H - 0.07), (W / 2, 0.0, H)), ((-W / 2, -0.04, 0.0), (-W / 2 + 0.07, 0.0, H)), ((W / 2 - 0.07, -0.04, 0.0), (W / 2, 0.0, H))):
        box(Pm, M['mahogany'], lo, hi, wa((0, 0, 1) if hi[2] - lo[2] > 0.5 else (1, 0, 0), wear=0.4), 0.008, 2)
    box(Pm, M['mahogany'], (-W / 2 + 0.06, -0.05, H - 0.08), (W / 2 - 0.06, -0.035, H + 0.04), wa((1, 0, 0)), 0.006, 2)   # (the crest rail)
    box(Pm, M['timber'], (-W / 2 + 0.02, 0.0, 0.05), (W / 2 - 0.02, 0.012, H - 0.05), wa((0, 0, 1)), 0.0)            # (the backboard)

# ================================================================ suitcases
def suitcase(G, M, c, W, D, H, rot, rnd, mat='leather', handle=True, flat=True):
    Pm = F.Moved(G, Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot, 4, 'Z'))
    box(Pm, M[mat], (-W / 2, -D / 2, 0.0), (W / 2, D / 2, H), fa(rnd, 3, 3), 0.02, 2)
    box(Pm, M['canvas2'], (-W / 2 - 0.002, -D / 2 - 0.002, H * 0.55 - 0.004), (W / 2 + 0.002, D / 2 + 0.002, H * 0.55 + 0.004), fa(rnd), 0.002)   # (the seam)
    for x in (-W / 2 + 0.06, W / 2 - 0.06):
        for sy in (-1, 1): box(Pm, M['brass'], (x - 0.02, sy * D / 2 - (0.006 if sy < 0 else 0), H * 0.55 - 0.015), (x + 0.02, sy * D / 2 + (0.006 if sy > 0 else 0), H * 0.55 + 0.02), ma(0.5), 0.002) if sy < 0 else None
    if handle:
        for x in (-0.06, 0.06): box(Pm, M['brass'], (x - 0.01, -D / 2 - 0.006, H * 0.55 + 0.02), (x + 0.01, -D / 2, H * 0.55 + 0.04), ma(0.5), 0.001)
        F.rod(Pm, M['leather'], [(-0.06, -D / 2 - 0.008, H * 0.55 + 0.03), (-0.05, -D / 2 - 0.026, H * 0.55 + 0.035), (0.05, -D / 2 - 0.026, H * 0.55 + 0.035), (0.06, -D / 2 - 0.008, H * 0.55 + 0.03)], 0.008, 6, fa(rnd), sub=2)
    if rnd.random() < 0.8:
        mat_l = M[f'label{rnd.randrange(4)}']; w, h = rnd.uniform(0.08, 0.12), rnd.uniform(0.05, 0.08)
        bm = block((-w / 2, -h / 2, 0.0), (w / 2, h / 2, 0.0015), 0.0, 1); S.xform(bm, (0, 0, 0), (0, 0, rnd.uniform(-0.4, 0.4))); S.xform(bm, (rnd.uniform(-W / 4, W / 4), rnd.uniform(-D / 4, D / 4), H)); Pm.add(bm, mat_l, fa(rnd, 6, 6), wrap=False)

def suitcase_pile(G, M, rnd):
    suitcase(G, M, (0.0, -0.2, 0.0), 0.76, 0.395, 0.22, 0.02, rnd)
    suitcase(G, M, (0.03, -0.2, 0.22), 0.66, 0.37, 0.19, -0.05, rnd, 'fibre')
    suitcase(G, M, (-0.04, -0.19, 0.41), 0.58, 0.33, 0.16, 0.06, rnd, 'leather')
    suitcase(G, M, (-0.16, -0.18, 0.57), 0.34, 0.24, 0.2, 0.15, rnd, 'vanity')
    hatbox(G, M, (0.2, -0.2, 0.57), 0.15, 0.26, rnd)

# ================================================================ the dress form
def dress_form(G, M, c, rnd, H=1.72, rot=0.0, sheet=False):
    """a dressmaker's form: a tripod of turned legs on castors, the pole and its height collar, the padded torso (bust, waist, hips)
       in linen jersey, a turned knob for a neck; a tape measure hung round it"""
    c = Vector(c)
    for k in range(3):
        a = rot + 2 * math.pi * k / 3; d = Vector((math.cos(a), math.sin(a), 0))
        F.rod(G, M['walnut'], [c + d * 0.02 + Vector((0, 0, 0.2)), c + d * 0.12 + Vector((0, 0, 0.1)), c + d * 0.18 + Vector((0, 0, 0.05))], 0.016, 6, wa(d), sub=2)
        G.add(lathe_bm([(0.0, 0.016), (1.0, 0.016)], c + d * 0.18 + Vector((0, 0, 0.032)) - Vector((-d.y, d.x, 0)) * 0.006, c + d * 0.18 + Vector((0, 0, 0.032)) + Vector((-d.y, d.x, 0)) * 0.006, 8), M['brass'], ma(0.4), wrap=False)
    turned(G, M['walnut'], [(0.0, 0.03), (0.15, 0.022), (0.5, 0.016), (0.9, 0.016), (1.0, 0.024)], c + Vector((0, 0, 0.18)), c + Vector((0, 0, 0.95)), 8, attrs=wa((0, 0, 1)))
    G.add(lathe_bm([(0.0, 0.026), (1.0, 0.026)], c + Vector((0, 0, 0.8)), c + Vector((0, 0, 0.84)), 10), M['brass'], ma(0.4), smooth=True, wrap=False)
    prof = [(0.0, 0.1), (0.12, 0.15), (0.3, 0.165), (0.45, 0.13), (0.55, 0.115), (0.7, 0.15), (0.8, 0.165), (0.9, 0.14), (0.96, 0.08), (1.0, 0.045)]
    bm = lathe_bm(prof, c + Vector((0, 0, 0.95)), c + Vector((0, 0, H - 0.09)), 18, (True, True))
    zc0, zc1 = 0.95, H - 0.09
    for v in bm.verts:                                                        # (flattened back to front, the bust forward)
        rel = v.co - c; t = (rel.z - zc0) / (zc1 - zc0); v.co.y = c.y + rel.y * 0.72
        fw = Matrix.Rotation(rot, 3, 'Z') @ Vector((0, -1, 0))
        if 0.62 < t < 0.9 and (v.co - c).xy.dot(fw.xy) > 0: v.co += fw * 0.03 * math.sin(math.pi * (t - 0.62) / 0.28) * max(0.0, (v.co - c).xy.normalized().dot(fw.xy))
    G.add(bm, M['jersey'], fa(rnd, 4, 4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.03), (0.5, 0.035), (1.0, 0.0)], c + Vector((0, 0, H - 0.1)), c + Vector((0, 0, H)), 10), M['walnut'], wa((0, 0, 1)), smooth=True, wrap=False)
    fw = Matrix.Rotation(rot, 3, 'Z') @ Vector((0, -1, 0)); sd = Vector((-fw.y, fw.x, 0))
    pts = [c + Vector((0, 0, H - 0.16)) + sd * 0.07 * s_ - fw * 0.02 for s_ in (-1.0,)] + [c + Vector((0, 0, H - 0.16 - 0.5 * t)) + sd * (0.09 + 0.02 * t) * -1 + fw * (0.1 + 0.02 * t) for t in np.linspace(0.05, 1.0, 6)]
    F.rod(G, M['tapem'], pts, 0.006, 4, fa(rnd, 20, 20), sub=2)
    pts = [c + Vector((0, 0, H - 0.16)) + sd * 0.07 - fw * 0.02] + [c + Vector((0, 0, H - 0.16 - 0.38 * t)) + sd * (0.09 + 0.02 * t) + fw * (0.1 + 0.02 * t) for t in np.linspace(0.05, 1.0, 6)]
    F.rod(G, M['tapem'], pts, 0.006, 4, fa(rnd, 20, 20), sub=2)
    F.rod(G, M['tapem'], [c + Vector((0, 0, H - 0.16)) + sd * 0.07 - fw * 0.02, c + Vector((0, 0, H - 0.13)) - fw * 0.05 * 0 + fw * 0.03, c + Vector((0, 0, H - 0.16)) - sd * 0.07 - fw * 0.02], 0.006, 4, fa(rnd, 20, 20), sub=2)

def mannequin(G, M, rnd):
    dress_form(G, M, (0.0, -0.2, 0.0), rnd, 1.72, 0.2)

# ================================================================ frames leaning
def frame(G, M, b, W, H, a, rnd, face='gilt', pic=None, back=False):
    R = Matrix.Translation(Vector(b)) @ Matrix.Rotation(a, 4, 'X'); Pm = F.Moved(G, R)
    t = 0.07 if face == 'gilt' else 0.04; mat = M['gilt'] if face == 'gilt' else M['mahogany']
    if back:                                                                  # (seen from behind: the stretcher, brown paper, a hanging wire)
        for lo, hi in (((-W / 2, -0.03, 0.0), (W / 2, 0.0, t)), ((-W / 2, -0.03, H - t), (W / 2, 0.0, H)), ((-W / 2, -0.03, 0.0), (-W / 2 + t, 0.0, H)), ((W / 2 - t, -0.03, 0.0), (W / 2, 0.0, H))):
            box(Pm, M['timber'], lo, hi, wa((0, 0, 1) if hi[2] - lo[2] > W else (1, 0, 0)), 0.003)
        box(Pm, M['paper'], (-W / 2 + t, -0.012, t), (W / 2 - t, -0.01, H - t), fa(rnd, 3, 3), 0.0)
        F.rod(Pm, M['iron'], [(-W / 2 + 0.1, -0.032, H * 0.75), (0.0, -0.034, H * 0.82), (W / 2 - 0.1, -0.032, H * 0.75)], 0.0015, 4, ma(0.4))
        return
    rows = []
    prof = [(0.0, 0.0), (0.004, -0.02), (0.02, -0.03), (0.04, -0.028), (t - 0.01, -0.018), (t, 0.0)] if face == 'gilt' else [(0.0, 0.0), (0.0, -0.02), (t, -0.02), (t, 0.0)]
    for d, h in prof:
        rows.append([Vector((x, h, z)) for x, z in ((-W / 2 + d, d), (W / 2 - d, d), (W / 2 - d, H - d), (-W / 2 + d, H - d), (-W / 2 + d, d))])
    grid_surface(Pm, mat, rows, ma(0.4) if face == 'gilt' else wa((1, 0, 0)), flip_to=lambda q: Vector((q.x * 0.3, -1.0, (q.z - H / 2) * 0.3)))
    box(Pm, M[pic], (-W / 2 + t - 0.002, -0.006, t - 0.002), (W / 2 - t + 0.002, -0.002, H - t + 0.002), attrs_of(lambda q, W=W, H=H: ((q[0] + W / 2) / W, q[2] / H, 0.0), 0.5), 0.0)
    box(Pm, M['timber'], (-W / 2 + 0.01, -0.002, 0.01), (W / 2 - 0.01, 0.01, H - 0.01), wa((0, 0, 1)), 0.0)

def frames_leaning(G, M, rnd):
    frame(G, M, (0.05, -0.13, 0.0), 0.95, 0.85, math.radians(-8), rnd, back=True)
    frame(G, M, (-0.25, -0.2, 0.0), 0.55, 0.7, math.radians(-10), rnd, 'gilt', 'portrait')
    frame(G, M, (0.28, -0.2, 0.0), 0.5, 0.4, math.radians(-12), rnd, 'wood', 'landscape')

# ================================================================ cobwebs
def cobweb_card(G, M, rnd):
    """two cards: one sagging across the corner, one along the ceiling's angle with the left wall (corner mount: walls at x = 0, y = 0)"""
    z0 = 2.2; top = 2.7
    rows = []
    for j in range(7):
        s = j / 6; rows.append([Vector((0.42 * s * (1 - u), -0.42 * (1 - s) * (1 - u) * 0 - 0.42 * (1 - s) * (1 - u), top - 0.02 - 0.32 * u * (1 - 0.3 * math.sin(math.pi * s)) - 0.05 * math.sin(math.pi * s) * u)) for u in np.linspace(0, 1, 6)])
    grid_surface(G, M['web'], rows, attrs_of(lambda q: (math.hypot(q[0], q[1]) * 1.2 + (top - q[2]) * 0.6, abs(q[0] - (-q[1])) * 1.2, 0.0), 0.5), flip_to=lambda q: Vector((1, -1, -0.3)))
    rows = [[Vector((0.002, -0.43 * s, top - 0.002 - 0.45 * u * (1 - 0.6 * s))) for s in np.linspace(0, 1, 6)] for u in np.linspace(0, 1, 5)]
    grid_surface(G, M['web'], rows, attrs_of(lambda q: (-q[1] * 1.3, (top - q[2]) * 1.3, 0.0), 0.5), flip_to=lambda q: Vector((1, 0, 0)))
    G.double = True; G.alpha = 'blend'

BANDS = [('Band_box_stack', 'box_stack', box_stack, 1024), ('Band_rolled_rug', 'rolled_rug', rolled_rug, 1024), ('Band_leaning_mirror', 'leaning_mirror', leaning_mirror, 1024),
         ('Band_suitcase_pile', 'suitcase_pile', suitcase_pile, 1024), ('Band_mannequin', 'mannequin', mannequin, 1024), ('Band_frames_leaning', 'frames_leaning', frames_leaning, 1024),
         ('Band_cobweb_card', 'cobweb_card', cobweb_card, 1024)]
