# Escape from Barbi Blue: the doll works' islands (WP2.5e, workshop style; build spec B4), built by furn_workshop.py:
#   Isl_workbench_double  a bench worked from both sides: a doll clamped in the vice, trays of eyes, limbs and heads strewn, stools
#                         pushed under; the anglepoise (the game's fixture) at Isl_workbench_double_fix
#   Isl_kiln              the kiln (its glow at Isl_kiln_fix, its flue to 4.6 m) and a stack of kiln shelves on props, loaded with
#                         fired heads and limbs; tongs, a quench bucket
#   Isl_drying_rack       two drying racks side by side, unfired limbs on their pegs, heads along the tops
#   Isl_sorting_table     a long table of trays of eyes sorted by colour, a jar of them, loose ones rolled about; two stools
#   Isl_office_desk       the works' office: a pedestal desk (ledger open, inkstand, a candlestick telephone), a swivel chair, a safe
#   Isl_hanging_dolls     a rail on two A-frames with dolls hung from it by strings round their necks (they sway on
#                         Isl_hanging_dolls_SwayPivot); a shelf of parts between the frames' feet
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
from kitlib import lin
import furn_workshop as W

ROT90 = Matrix(((0, -1, 0, 0), (1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))   # (a builder's y run along x)

def isl_mats():
    import furn_workshop2 as W2
    M = W2.band_mats('isl')
    M['ledger'] = kitlib.fabric('isl_ws_ledger', '#e2d8c0', weave=0.0, fade=0.7, stripes=('#9aa4b8', 0.008), age=2.0)
    M['ledgerc'] = kitlib.fabric('isl_ws_ledgerc', '#3a2a22', weave=0.0, fade=0.5, age=2.0)
    return M

def stool(G, M, c, rnd, h=0.6):
    c = Vector(c)
    G.add(lathe_bm([(0.0, 0.16), (0.8, 0.17), (1.0, 0.16)], c + Vector((0, 0, h - 0.035)), c + Vector((0, 0, h)), 18), M['bench'], wa((1, 0, 0), wear=0.5), smooth=True, wrap=False)
    for k in range(3):
        a = 2 * math.pi * k / 3 + rnd.random(); d = Vector((math.cos(a), math.sin(a), 0))
        F.rod(G, M['bench'], [c + d * 0.1 + Vector((0, 0, h - 0.035)), c + d * 0.16], 0.015, 6, wa((0, 0, 1)))
        F.rod(G, M['bench'], [c + d * 0.13 + Vector((0, 0, 0.22)), c + Vector((math.cos(a + 2.09), math.sin(a + 2.09), 0)) * 0.13 + Vector((0, 0, 0.22))], 0.008, 5, wa((1, 0, 0)))

# ================================================================ the double bench
def isl_workbench_double(G, M, rnd):
    zt = 0.8
    P = F.Moved(G, ROT90); W.workbench(P, M, rnd, W=1.2, L=1.89, zt=zt, rack=False, items=False)
    jaw = W.vice(G, M, (0.5, -0.42, zt), 0.0, 0.07)                          # (a doll in the vice: her torso across the jaws, her head lolled)
    W.torso(G, M, jaw + Vector((-0.09, 0.0, -0.025)), (1.0, 0.0, 0.0), 1.1)
    W.doll_head(G, M, jaw + Vector((-0.17, -0.02, -0.03)), (-0.2, -1.0), 1.1, 'eyeB', 'bisque', 'hair', tilt=1.2)
    for d, kind in (((0.3, 0.9, 0.0), 'arm'), ((0.4, -0.9, 0.0), 'arm'), ((1.0, 0.25, 0.0), 'leg')):
        W.limb(G, M, jaw + Vector((0.02, 0.0, -0.03)), d, kind, 1.1, 'bisque', 0.3, 7)
    for (x, y, r_) in ((-0.55, -0.3, 0.1), (-0.2, 0.32, -0.12), (0.3, 0.3, 0.05)): W.eye_tray(G, M, (x, y, zt), r_, rnd)
    for k in range(8):
        x, y = rnd.uniform(-0.8, 0.6), rnd.uniform(-0.5, 0.5); a = rnd.uniform(0, 6.28)
        W.limb(G, M, (x, y, zt + 0.014), (math.cos(a), math.sin(a), 0.0), 'arm' if k % 2 else 'leg', rnd.uniform(1.0, 1.3), 'bisque' if k % 3 else 'green_ware', rnd.uniform(0.0, 0.6), 7)
    for k in range(4): W.doll_head(G, M, (rnd.uniform(-0.75, 0.55), rnd.uniform(-0.45, 0.45), zt + 0.05), (rnd.uniform(-1, 1), rnd.uniform(-1, 1)), 1.0, (None, 'eyeB', 'eyeH', None)[k], 'bisque' if k % 2 else 'green_ware', tilt=1.4)
    for k in range(6):                                                         # (brushes and modelling tools lying about)
        p = Vector((rnd.uniform(-0.8, 0.7), rnd.uniform(-0.5, 0.5), zt + 0.005)); a = rnd.uniform(0, 6.28)
        F.rod(G, M['oak'], [p, p + Vector((0.16 * math.cos(a), 0.16 * math.sin(a), 0.0))], 0.004, 4, wa((1, 0, 0)))
    stool(G, M, (-0.45, -0.47, 0.0), rnd); stool(G, M, (0.35, 0.47, 0.0), rnd)
    G.sockets = [('Isl_workbench_double_fix', (0.1, -0.05, zt))]

# ================================================================ the kiln and its shelves
def isl_kiln(G, M, rnd):
    W.kiln(G, M, rnd, (-0.22, 0.0, 0.0), 0.92, 1.55, 4.6, 'Isl_kiln_fix')
    x0, x1 = 0.33, 0.693
    for k, z in enumerate((0.0, 0.32, 0.64, 0.96)):                             # (kiln shelves on props, fired pieces on them)
        zz = z + (0.04 if k == 0 else 0.0)
        for y in (-0.58, 0.0, 0.58):
            for x in (x0 + 0.04, x1 - 0.04): G.add(lathe_bm([(0.0, 0.025), (1.0, 0.025)], (x, y, zz), (x, y, z + 0.28), 8), M['firebrick'], wa(), smooth=True, wrap=False)
        box(G, M['firebrick'], (x0, -0.645, z + 0.28), (x1, 0.645, z + 0.31), wa((0, 1, 0)), 0.004)
        for j in range(5):
            p = Vector((rnd.uniform(x0 + 0.07, x1 - 0.07), -0.48 + 0.24 * j + rnd.uniform(-0.04, 0.04), z + 0.31))
            if rnd.random() < 0.5: W.doll_head(G, M, p + Vector((0, 0, 0.09)), (rnd.uniform(-1, 1), rnd.uniform(-1, 1)), 0.95, None, 'bisque', sides=10)
            else: W.limb(G, M, Vector((x0 + 0.06, p.y, p.z + 0.014)), (1.0, rnd.uniform(-0.15, 0.15), 0.0), rnd.choice(('arm', 'leg')), 1.0, 'bisque', rnd.uniform(0, 0.3), 7)
    box(G, M['firebrick'], (x0, -0.645, 1.27), (x1, 0.645, 1.3), wa((0, 1, 0)), 0.004)
    tb = Vector((0.3, -0.56, 0.0))                                              # (tongs leaning on the shelves; a quench bucket)
    for s in (-1, 1): F.rod(G, M['steel'], [tb + Vector((0.0, s * 0.012, 0.02)), tb + Vector((0.01, s * 0.03, 0.5)), tb + Vector((0.02, 0.0, 0.8)), tb + Vector((0.025, s * 0.015, 1.05))], 0.006, 5, ma(0.4), sub=2)
    bk = Vector((-0.55, -0.49, 0.0))
    G.add(lathe_bm([(0.0, 0.12), (1.0, 0.14)], bk, bk + Vector((0, 0, 0.3)), 16, (True, False)), M['tin'], ma(0.4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.132), (1.0, 0.132)], bk + Vector((0, 0, 0.24)), bk + Vector((0, 0, 0.242)), 16, (False, True)), M['socket'], ma(), wrap=False)

# ================================================================ drying racks
def isl_drying_rack(G, M, rnd):
    for y in (-0.36, 0.36):
        P = F.Moved(G, Matrix.Translation((0.0, y, 0.0)) @ ROT90)
        W.drying_rack(P, M, rnd, 0.56, 1.79, 1.8)

# ================================================================ the sorting table
def isl_sorting_table(G, M, rnd):
    zt = 0.78; L, D = 1.79, 0.9
    box(G, M['oak'], (-L / 2, -D / 2, zt - 0.03), (L / 2, D / 2, zt), wa((1, 0, 0), wear=0.5), 0.005, 1)
    box(G, M['oak'], (-L / 2 + 0.06, -D / 2 + 0.06, zt - 0.11), (L / 2 - 0.06, D / 2 - 0.06, zt - 0.03), wa((1, 0, 0)), 0.003)
    for sx in (-1, 1):
        for sy in (-1, 1): turned(G, M['oak'], [(0.0, 0.025), (0.1, 0.03), (0.3, 0.026), (0.6, 0.03), (0.9, 0.028), (1.0, 0.032)], (sx * (L / 2 - 0.08), sy * (D / 2 - 0.08), 0.0), (sx * (L / 2 - 0.08), sy * (D / 2 - 0.08), zt - 0.11), 10, attrs=wa((0, 0, 1)))
    for k, (x, y) in enumerate(((-0.55, -0.22), (-0.2, -0.22), (0.15, -0.22), (-0.55, 0.2), (-0.2, 0.2), (0.2, 0.18))):
        W.eye_tray(G, M, (x, y, zt), rnd.uniform(-0.05, 0.05), rnd)
    import furn_workshop2 as W2
    W2.eye_jar(G, M, (0.58, 0.15, zt), 0.065, 0.145, rnd, 0.85)
    for k in range(25):
        W.eye(G, M, (rnd.uniform(0.35, 0.75), rnd.uniform(-0.38, 0.0), zt + 0.0075), (rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.5, 1.0)), 0.0075, rnd.choice(('eyeB', 'eyeH', 'eyeG')), (6, 4))
    lp = Vector((0.55, -0.25, zt))                                             # (a reading glass on its stand)
    G.add(lathe_bm([(0.0, 0.04), (1.0, 0.03)], lp, lp + Vector((0, 0, 0.012)), 12), M['brass'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['brass'], [lp + Vector((0, 0, 0.012)), lp + Vector((0, 0, 0.09)), lp + Vector((-0.06, 0.0, 0.11))], 0.004, 5, ma(0.4), sub=2)
    ring = [lp + Vector((-0.1, 0.0, 0.11)) + Vector((0.04 * math.cos(t), 0.0, 0.04 * math.sin(t))) for t in np.linspace(0, 2 * math.pi, 15)]
    F.rod(G, M['brass'], ring, 0.004, 4, ma(0.4), caps=(False, False))
    stool(G, M, (-0.3, -0.47, 0.0), rnd); stool(G, M, (0.3, 0.47, 0.0), rnd)

# ================================================================ the office
def isl_office_desk(G, M, rnd):
    zt = 0.76; x0, x1, y0, y1 = -0.85, 0.36, -0.15, 0.65
    box(G, M['oak'], (x0, y0, zt - 0.035), (x1, y1, zt), wa((1, 0, 0), wear=0.4), 0.006, 1)
    box(G, M['leather'], (x0 + 0.08, y0 + 0.08, zt), (x1 - 0.08, y1 - 0.08, zt + 0.002), fa(rnd, 3, 3), 0.0)
    for px0, px1 in ((x0 + 0.02, x0 + 0.42), (x1 - 0.42, x1 - 0.02)):          # (the pedestals of drawers)
        box(G, M['oak'], (px0, y0 + 0.02, 0.0), (px1, y1 - 0.02, zt - 0.035), wa((0, 0, 1)), 0.004, 1)
        for k in range(4):
            z0 = 0.06 + k * 0.16; box(G, M['oak'], (px0 + 0.02, y0 + 0.008, z0), (px1 - 0.02, y0 + 0.025, z0 + 0.15), wa((1, 0, 0)), 0.003)
            G.add(lathe_bm([(0.0, 0.008), (0.7, 0.012), (1.0, 0.0)], ((px0 + px1) / 2, y0 + 0.008, z0 + 0.09), ((px0 + px1) / 2, y0 - 0.015, z0 + 0.09), 8), M['brass'], ma(0.5), smooth=True, wrap=False)
    lg = Vector((-0.3, 0.2, zt + 0.002))                                       # (the ledger open, an inkstand, a pile of ledgers, the telephone)
    for s in (-1, 1):
        bm = block((0.0 if s > 0 else -0.21, -0.15, 0.0), (0.21 if s > 0 else 0.0, 0.15, 0.012), 0.002, 1); S.xform(bm, (0, 0, 0), (0, s * -0.06, 0)); S.xform(bm, tuple(lg)); G.add(bm, M['ledger'], attrs_of(lambda q: (q[0] * 2, q[1] * 2, 0.0), 0.5), wrap=False)
    box(G, M['ledgerc'], tuple(lg + Vector((-0.22, -0.16, -0.002))), tuple(lg + Vector((0.22, 0.16, 0.0))), fa(rnd), 0.0)
    for k in range(4): box(G, M['ledgerc'], (0.0, 0.35 + 0.0, zt + 0.04 * k), (0.28, 0.6, zt + 0.04 * k + 0.038), fa(rnd, 3, 3), 0.003)
    ik = Vector((-0.65, 0.45, zt))
    box(G, M['brass'], tuple(ik + Vector((-0.1, -0.06, 0.0))), tuple(ik + Vector((0.1, 0.06, 0.012))), ma(0.4), 0.003)
    for sx in (-1, 1): G.add(lathe_bm([(0.0, 0.022), (0.7, 0.025), (1.0, 0.01)], ik + Vector((sx * 0.05, 0, 0.012)), ik + Vector((sx * 0.05, 0, 0.06)), 10), M['glass'], ma(), smooth=True, wrap=False)
    tp = Vector((-0.75, 0.05, zt))
    G.add(lathe_bm([(0.0, 0.055), (0.2, 0.045), (0.3, 0.014), (1.0, 0.012)], tp, tp + Vector((0, 0, 0.285)), 12), M['black'], ma(0.4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.012), (0.3, 0.03), (1.0, 0.026)], tp + Vector((0, 0, 0.285)), tp + Vector((0, -0.02, 0.335)), 12), M['black'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['black'], [tp + Vector((0.0, 0.0, 0.2)), tp + Vector((0.05, 0.0, 0.21)), tp + Vector((0.06, 0.0, 0.18))], 0.004, 4, ma(0.4), sub=2)
    G.add(lathe_bm([(0.0, 0.015), (0.6, 0.017), (1.0, 0.024)], tp + Vector((0.06, 0.0, 0.18)), tp + Vector((0.06, 0.0, 0.09)), 10), M['black'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['rubber'], [tp + Vector((0.03, 0.0, 0.01)), tp + Vector((0.12, 0.0, 0.0)), tp + Vector((0.2, -0.02, 0.0))], 0.004, 4, ma(), sub=2)
    ch = Vector((-0.25, -0.42, 0.0))                                            # (the swivel chair)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2; d = Vector((math.cos(a), math.sin(a), 0))
        F.rod(G, M['oak'], [ch + Vector((0, 0, 0.12)), ch + d * 0.24 + Vector((0, 0, 0.03))], 0.02, 6, wa(d))
        G.add(lathe_bm([(0.0, 0.025), (1.0, 0.025)], ch + d * 0.24 + Vector((0, 0, 0.025)) - Vector((-d.y, d.x, 0)) * 0.01, ch + d * 0.24 + Vector((0, 0, 0.025)) + Vector((-d.y, d.x, 0)) * 0.01, 8), M['iron'], ma(), wrap=False)
    G.add(lathe_bm([(0.0, 0.03), (1.0, 0.03)], ch + Vector((0, 0, 0.1)), ch + Vector((0, 0, 0.42)), 10), M['iron'], ma(0.4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.21), (0.8, 0.22), (1.0, 0.21)], ch + Vector((0, 0, 0.42)), ch + Vector((0, 0, 0.47)), 20), M['oak'], wa((1, 0, 0), wear=0.5), smooth=True, wrap=False)
    bk = [ch + Vector((0.2 * math.cos(t), 0.2 * math.sin(t), 0.0)) for t in np.linspace(math.pi * 1.15, math.pi * 1.85, 9)]
    rows = [[p + Vector((0, 0, z)) - (p - ch).normalized() * 0.01 * z for p in bk] for z in (0.62, 0.78)]
    grid_surface(G, M['oak'], rows, wa((1, 0, 0)), flip_to=lambda q: ch + Vector((0, 0, q.z)) - q)
    for p in bk[::2]: F.rod(G, M['oak'], [p + Vector((0, 0, 0.47)), p + Vector((0, 0, 0.62))], 0.009, 5, wa((0, 0, 1)))
    sf = (0.4, 0.12, 0.85, 0.6)                                                 # (the safe: green iron, brass dial and handle, a maker's plate)
    box(G, M['green'], (sf[0], sf[1], 0.04), (sf[2], sf[3], 0.82), ma(0.4), 0.012, 2)
    for x in (sf[0] + 0.05, sf[2] - 0.05):
        for y in (sf[1] + 0.05, sf[3] - 0.05): G.add(lathe_bm([(0.0, 0.025), (1.0, 0.022)], (x, y, 0.0), (x, y, 0.04), 8), M['iron'], ma(0.4), smooth=True, wrap=False)
    box(G, M['green'], (sf[0] + 0.04, sf[1] - 0.01, 0.1), (sf[2] - 0.04, sf[1], 0.76), ma(0.5), 0.006, 1)
    G.add(lathe_bm([(0.0, 0.045), (0.6, 0.048), (1.0, 0.04)], ((sf[0] + sf[2]) / 2, sf[1] - 0.01, 0.5), ((sf[0] + sf[2]) / 2, sf[1] - 0.035, 0.5), 16), M['brass'], ma(0.5), smooth=True, wrap=False)
    F.rod(G, M['brass'], [((sf[0] + sf[2]) / 2 + 0.12, sf[1] - 0.01, 0.42), ((sf[0] + sf[2]) / 2 + 0.12, sf[1] - 0.05, 0.42), ((sf[0] + sf[2]) / 2 + 0.12, sf[1] - 0.05, 0.3)], 0.009, 6, ma(0.5))
    box(G, M['brass'], (sf[0] + 0.12, sf[1] - 0.012, 0.66), (sf[2] - 0.12, sf[1] - 0.01, 0.71), ma(0.5), 0.001)
    for k in range(3): box(G, M['ledger'], (sf[0] + 0.05 + 0.01 * k, sf[1] + 0.08, 0.82 + 0.004 * k), (sf[2] - 0.08 + 0.01 * k, sf[3] - 0.1, 0.824 + 0.004 * k), attrs_of(lambda q: (q[0] * 2, q[1] * 2, 0.0), 0.5), 0.0)

# ================================================================ the hanging dolls
def hanging_doll(G, M, top, s, rnd, frock, eyes, wig):
    """a doll hung by a string round her neck: head bowed, the stuffed body limp, arms and legs dangling, her frock hanging straight"""
    top = Vector(top); hd = top - Vector((0, 0, 0.06 * s)); f = Vector((rnd.uniform(-1, 1), -1.0, 0.0)).normalized()
    W.doll_head(G, M, hd, (f.x, f.y), s, eyes, 'bisque', wig, tilt=rnd.uniform(0.25, 0.6), sides=10)
    nk = hd - Vector((0, 0, 0.1 * s)); W.torso(G, M, nk - Vector((0, 0, 0.17 * s)), (0, 0, 1), s, 'calico', 10)
    def dress(u, v):
        a = 2 * math.pi * u; z = nk.z - 0.04 * s - 0.3 * s * v; r = (0.05 + 0.045 * v) * s + 0.006 * s * math.sin(7 * a) * v
        return Vector((nk.x + r * math.cos(a), nk.y + r * math.sin(a), z))
    drape(G, M[frock], 16, 5, dress, fa(rnd, 3, 3), out=lambda q: (q - nk) * Vector((1, 1, 0)))
    sd = Vector((-f.y, f.x, 0))
    for sx in (-1, 1):
        W.limb(G, M, nk + sd * sx * 0.055 * s - Vector((0, 0, 0.035 * s)), (sx * 0.15 * sd.x, sx * 0.15 * sd.y, -1.0), 'arm', 1.3 * s, 'bisque', 0.15, 7)
        W.limb(G, M, nk + sd * sx * 0.03 * s - Vector((0, 0, 0.3 * s)), (0.0, 0.05, -1.0), 'leg', 1.4 * s, 'bisque', 0.08, 7)
    F.rod(G, M['string'], [top + Vector((0, 0, 0.0)), nk + Vector((0, 0, 0.05 * s))], 0.002, 3, fa(rnd))
    ring = [nk + Vector((0.035 * s * math.cos(t), 0.035 * s * math.sin(t), 0.0)) for t in np.linspace(0, 2 * math.pi, 9)]
    F.rod(G, M['string'], ring, 0.002, 3, fa(rnd), caps=(False, False))

def isl_hanging_dolls(G, Gd, M, rnd):
    zr = 2.05
    for sx in (-1, 1):                                                         # (the A-frames, the rail, the shelf between their feet)
        x = sx * 0.76
        for sy in (-1, 1): F.rod(G, M['oak'], [(x, sy * 0.62, 0.0), (x, sy * 0.04, zr - 0.02)], 0.022, 6, wa((0, 0, 1)))
        box(G, M['oak'], (x - 0.03, -0.06, zr - 0.06), (x + 0.03, 0.06, zr + 0.04), wa((1, 0, 0)), 0.004)
        box(G, M['oak'], (x - 0.02, -0.56, 0.4), (x + 0.02, 0.56, 0.44), wa((0, 1, 0)), 0.003)
    F.rod(G, M['steel'], [(-0.8, 0.0, zr), (0.8, 0.0, zr)], 0.018, 10, ma(0.3))
    for k in range(5): box(G, M['pine'], (-0.76, -0.55 + 0.22 * k + 0.003, 0.44), (0.76, -0.55 + 0.22 * (k + 1) - 0.003, 0.46), wa((1, 0, 0)), 0.002)
    for k in range(10):                                                        # (parts on the shelf)
        p = Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.4, 0.4), 0.46))
        if k % 3: W.limb(G, M, p + Vector((0, 0, 0.014)), (rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.0), rnd.choice(('arm', 'leg')), 1.2, 'bisque', rnd.uniform(0, 0.5), 7)
        else: W.doll_head(G, M, p + Vector((0, 0, 0.05)), (rnd.uniform(-1, 1), rnd.uniform(-1, 1)), 1.0, rnd.choice((None, 'eyeB')), 'bisque', tilt=1.3, sides=10)
    for k, x in enumerate(np.linspace(-0.5, 0.5, 6)):                          # (the dolls on their strings, at all heights)
        s = rnd.uniform(1.0, 1.5); drop = rnd.uniform(0.1, 0.5)
        hanging_doll(Gd, M, (x + rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), zr - drop), s, rnd, rnd.choice(('frock', 'frock2', 'calico')), rnd.choice((None, 'eyeB', 'eyeH')), rnd.choice((None, 'hair', 'hair2')))
        F.rod(Gd, M['string'], [(x, 0.0, zr - 0.018), (x, 0.0, zr - drop)], 0.002, 3, fa(rnd))

# ================================================================ build
def build_islands(want):
    rnd = random.Random(113); M = isl_mats(); roots = []; parts = []
    for name, fn in (('Isl_workbench_double', isl_workbench_double), ('Isl_kiln', isl_kiln), ('Isl_drying_rack', isl_drying_rack), ('Isl_sorting_table', isl_sorting_table),
                     ('Isl_office_desk', isl_office_desk), ('Isl_hanging_dolls', None)):
        if not want(name.lower()): continue
        G = S.Geo(1, 1, False, False); G.sockets = []
        if fn:
            fn(G, M, rnd); o = F.build_obj(name.lower() + '_tmp', G); parts.append(o)
            roots.append((name, [o], None, None, None, [], getattr(G, 'sockets', [])))
        else:
            Gd = S.Geo(1, 1, False, False); isl_hanging_dolls(G, Gd, M, rnd)
            o = F.build_obj(name.lower() + '_tmp', G); od = F.build_obj(name.lower() + '_dolls', Gd); parts += [o, od]
            roots.append((name, [o], od, name + '_SwayPivot', (0.0, 0.0, 2.05), [], []))
    return roots, parts, M
