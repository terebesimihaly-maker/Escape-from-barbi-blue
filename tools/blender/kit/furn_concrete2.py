# Escape from Barbi Blue: the basement's wall pieces (WP2.5c, concrete; build spec B6), built by furn_concrete.py:
#   Band_fuse_box       an Edwardian fuse board: a slate panel on a varnished backboard, the knife switch thrown open, porcelain fuse
#                       carriers in their brass clips, a cast-iron main switch with its lever, cloth-covered cables up to the ceiling
#   Band_water_heater   a copper hot-water cylinder on its timber stand, a quilted red jacket strapped round it, the pipes up to 1.6 m
#   Band_utility_sink   a Belfast sink on brick piers, brass bib taps on the wall, a scrubbing brush and soap, a bucket underneath
#   Band_pegboard       a perforated hardboard on battens, tools hung on its hooks: a saw, a hammer, spanners, pliers, a coil of
#                       wire, a brace, chisels in their rack, a paintbrush
#   Band_coal_bin       a timber coal bunker with a sloping lid, its lowest front board gone and the coal spilling out
#   Band_metal_shelf    slotted-angle shelving against the wall: tins, jars, paint, boxes
#   Band_barrel         a coopered barrel: staves, iron hoops, a head with its bung
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
from doors import lathe_bm, tube, block, attrs_of
from surfaces2 import sep, finish
from kitlib import lin
import furn_concrete as C

def pegboard_mat(name):
    """tempered hardboard, brown, a grid of holes every 25 mm (gpos: its own x, z), greasy round the hooks, dusty along the top"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); x, z, _ = sep(m, g)
    hx = m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', x, 0.025)), 0.5); hz = m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', z, 0.025)), 0.5)
    hole = m.remap(m.math('ADD', m.math('MULTIPLY', hx, hx), m.math('MULTIPLY', hz, hz)), 0.03, 0.02)
    col = m.mix(m.remap(m.noise(op, 40, 4), 0.3, 0.7), lin('#6e5034'), lin('#57402a'))
    col = m.mix(m.remap(m.noise(op, 4, 3), 0.5, 0.75, 0.0, 0.5), col, lin('#3a2c20'))
    col = m.mix(hole, col, (0.01, 0.009, 0.008))
    return finish(m, col, m.mixf(hole, 0.6, 0.95), m.math('MULTIPLY', hole, -0.002))

def band_mats(nm):
    k = f'band_{nm}'; M = C.con_mats(k)
    if nm == 'fuse_box':
        M['board'] = kitlib.wood(k + '_board', 'pine', 'varnish', stain='#4a2e1a', age=1.9)
        M['porcelain'] = kitlib.porcelain(k + '_porc', '#ece6d6', glaze=True, crackle=0.5, age=1.8); M['copper'] = kitlib.metal(k + '_copper', 'brass', color='#a8673a', rust=0.0, age=1.6)
        M['cable'] = kitlib.fabric(k + '_cable', '#1c1a18', weave=0.0, stripes=('#2c2824', 0.004), age=1.8)
    if nm == 'water_heater':
        M['copper'] = kitlib.metal(k + '_copper', 'brass', color='#a8673a', rust=0.0, age=1.8)
        M['jacket'] = kitlib.fabric(k + '_jacket', '#7a2a22', weave=0.0, fade=0.6, stripes=('#4e1a16', 0.09), age=2.0)
    if nm == 'utility_sink':
        M['fireclay'] = kitlib.porcelain(k + '_fireclay', '#e6e0d0', glaze=True, crackle=0.6, age=2.0); M['soap'] = kitlib.porcelain(k + '_soap', '#c9b48a', glaze=False, crackle=0.0, age=1.5)
        M['bristle'] = kitlib.fabric(k + '_bristle', '#c2a97a', weave=0.0, stripes=('#8a7450', 0.003), age=1.8)
    if nm == 'pegboard':
        M['peg'] = pegboard_mat(k + '_peg'); M['steel'] = kitlib.metal(k + '_steel', 'steel', rust=0.5, age=1.6); M['handle'] = kitlib.wood(k + '_handle', 'beech', 'varnish', age=1.8)
        M['bristle'] = kitlib.fabric(k + '_bristle', '#2a2420', weave=0.0, stripes=('#4a4038', 0.003), age=1.8); M['wire'] = kitlib.metal(k + '_wire', 'brass', color='#a8673a', rust=0.0, age=1.5)
    if nm == 'barrel':
        M['oak'] = kitlib.wood(k + '_oak', 'oak', 'bare', stain='#5e4a36', age=2.2)
    return M

# ================================================================ the fuse board
def fuse_box(G, M, rnd):
    z0 = 1.46
    box(G, M['board'], (-0.22, -0.022, z0), (0.22, 0.0, z0 + 0.52), wa((0, 0, 1), wear=0.3), 0.003, 1)
    box(G, M['slate'], (-0.18, -0.04, z0 + 0.17), (0.08, -0.022, z0 + 0.47), ma(0.2), 0.002, 1)
    for x in (-0.12, -0.04):                                                  # (the knife switch: jaws above, blades swung open from below)
        box(G, M['copper'], (x - 0.006, -0.06, z0 + 0.39), (x + 0.006, -0.04, z0 + 0.43), ma(0.4), 0.001)
        box(G, M['porcelain'], (x - 0.015, -0.055, z0 + 0.23), (x + 0.015, -0.04, z0 + 0.26), ma(), 0.002)
        bm = block((-0.003, -0.004, 0.0), (0.003, 0.004, 0.16), 0.0, 1); S.xform(bm, (0, 0, 0), (0.55, 0, 0)); S.xform(bm, (x, -0.048, z0 + 0.245)); G.add(bm, M['copper'], ma(0.5), wrap=False)
    hb = Vector((-0.08, -0.048 - 0.16 * math.sin(0.55), z0 + 0.245 + 0.16 * math.cos(0.55)))
    F.rod(G, M['copper'], [hb + Vector((-0.045, 0, 0)), hb + Vector((0.045, 0, 0))], 0.004, 6, ma(0.4))
    G.add(lathe_bm([(0.0, 0.012), (0.8, 0.014), (1.0, 0.01)], hb, hb + Vector((0, -0.05, 0.02)), 8), M['bakelite'], ma(), smooth=True, wrap=False)
    for i in range(4):                                                        # (the fuse carriers in their clips)
        x = -0.16 + 0.05 * i
        box(G, M['copper'], (x - 0.012, -0.045, z0 + 0.185), (x + 0.012, -0.04, z0 + 0.21), ma(0.4), 0.0)
        if i != 2: box(G, M['porcelain'], (x - 0.015, -0.075, z0 + 0.18), (x + 0.015, -0.045, z0 + 0.22), ma(), 0.004, 1)
    box(G, M['iron'], (0.1, -0.1, z0 + 0.16), (0.2, -0.022, z0 + 0.36), ma(0.3), 0.006, 1)                 # (the iron main switch)
    F.rod(G, M['iron'], [(0.2, -0.06, z0 + 0.3), (0.215, -0.07, z0 + 0.3), (0.215, -0.09, z0 + 0.2)], 0.006, 6, ma(0.4))
    G.add(lathe_bm([(0.0, 0.01), (1.0, 0.012)], (0.215, -0.09, z0 + 0.2), (0.215, -0.11, z0 + 0.17), 8), M['bakelite'], ma(), smooth=True, wrap=False)
    for k, x in enumerate((-0.12, -0.04, 0.15)):                              # (cables up out of the top, cloth-covered, sagging a little)
        top = x + rnd.uniform(-0.03, 0.03)
        F.rod(G, M['cable'], [(x, -0.045 if k < 2 else -0.06, z0 + (0.43 if k < 2 else 0.36)), (x, -0.05, z0 + 0.48), (top, -0.035, z0 + 0.52), (top, -0.02, 2.0)], 0.007, 6, fa(rnd), sub=2)

# ================================================================ the hot-water cylinder
def water_heater(G, M, rnd):
    c = Vector((0.0, -0.21, 0.0))
    for sx in (-1, 1):
        for sy in (-1, 1): box(G, M['timber'], tuple(c + Vector((sx * 0.17 - 0.025, sy * 0.17 - 0.025, 0.0))), tuple(c + Vector((sx * 0.17 + 0.025, sy * 0.17 + 0.025, 0.28))), wa((0, 0, 1)), 0.003)
    box(G, M['timber'], tuple(c + Vector((-0.2, -0.2, 0.28))), tuple(c + Vector((0.2, 0.2, 0.31))), wa((1, 0, 0)), 0.003)
    G.add(lathe_bm([(0.0, 0.12), (0.03, 0.19), (0.08, 0.2), (0.9, 0.2), (0.96, 0.17), (1.0, 0.06)], c + Vector((0, 0, 0.31)), c + Vector((0, 0, 1.45)), 24), M['copper'], ma(0.3), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.205), (0.5, 0.208), (1.0, 0.204)], c + Vector((0, 0, 0.42)), c + Vector((0, 0, 1.3)), 24, (False, False)), M['jacket'], fa(rnd, 2, 2), smooth=True, wrap=False)
    for z in (0.62, 1.05): G.add(lathe_bm([(0.0, 0.21), (1.0, 0.21)], c + Vector((0, 0, z)), c + Vector((0, 0, z + 0.025)), 24, (False, False)), M['rope'], fa(rnd), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.035), (0.6, 0.035), (1.0, 0.028)], c + Vector((0, 0, 1.44)), c + Vector((0, 0, 1.49)), 10), M['brass'], ma(0.4), smooth=True, wrap=False)   # (the immersion heater's boss)
    F.rod(G, M['rubber'], [c + Vector((0, 0, 1.49)), c + Vector((0.0, 0.05, 1.53)), (0.0, -0.01, 1.56), (0.0, -0.005, 1.6)], 0.005, 5, ma(), sub=2)
    F.rod(G, M['copper'], [c + Vector((0.12, 0, 1.4)), c + Vector((0.12, 0, 1.52)), (0.12, -0.1, 1.55), (0.12, -0.02, 1.56), (0.12, -0.02, 1.6)], 0.011, 8, ma(0.3), sub=2)   # (the hot draw-off)
    F.rod(G, M['copper'], [c + Vector((-0.19, 0.0, 0.42)), c + Vector((-0.2, 0.08, 0.42)), (-0.16, -0.02, 0.45), (-0.16, -0.02, 1.6)], 0.011, 8, ma(0.3), sub=2)   # (the cold feed)
    C.gate_valve(G, M, (-0.16, -0.02, 0.9), (0, 0, 1), (0, -1, 0), 0.011)
    for z in (0.7, 1.3): box(G, M['iron'], (-0.175, -0.035, z), (-0.145, 0.0, z + 0.02), ma(0.3), 0.002)

# ================================================================ the Belfast sink
def utility_sink(G, M, rnd):
    W, D, z0, z1, t = 0.6, 0.44, 0.6, 0.85, 0.045
    for sx in (-1, 1): box(G, M['brick'], (sx * 0.22 - 0.06, -0.4, 0.0), (sx * 0.22 + 0.06, -0.02, z0), ma(0.3), 0.004, 1)
    for lo, hi in (((-W / 2, -D, z0), (W / 2, -0.01, z0 + t)), ((-W / 2, -D, z0), (W / 2, -D + t, z1)), ((-W / 2, -0.01 - t, z0), (W / 2, -0.01, z1)), ((-W / 2, -D, z0), (-W / 2 + t, -0.01, z1)), ((W / 2 - t, -D, z0), (W / 2, -0.01, z1))):
        box(G, M['fireclay'], lo, hi, ma(0.3), 0.012, 2)
    G.add(lathe_bm([(0.0, 0.025), (1.0, 0.025)], (0.0, -0.225, z0 + t), (0.0, -0.225, z0 + t + 0.002), 12, (False, True)), M['rubber'], ma(), wrap=False)   # (the plughole)
    for sx in (-1, 1):                                                        # (bib taps on the wall over it, their pipes up to the ceiling run)
        x = sx * 0.12
        F.rod(G, M['brass'], [(x, -0.005, 1.1), (x, -0.005, 0.99), (x, -0.06, 0.98), (x, -0.09, 0.98), (x, -0.1, 0.94)], 0.01, 8, ma(0.4), sub=2)
        G.add(lathe_bm([(0.0, 0.014), (1.0, 0.012)], (x, -0.075, 0.99), (x, -0.075, 1.04), 8), M['brass'], ma(0.4), smooth=True, wrap=False)
        for a in (0.3, 0.3 + math.pi / 2): F.rod(G, M['brass'], [(x - 0.025 * math.cos(a), -0.075 - 0.025 * math.sin(a), 1.045), (x + 0.025 * math.cos(a), -0.075 + 0.025 * math.sin(a), 1.045)], 0.004, 5, ma(0.4))
        box(G, M['iron'], (x - 0.015, -0.012, 1.03), (x + 0.015, 0.0, 1.05), ma(0.3), 0.001)
    bb = Vector((0.18, -0.06, z1))                                            # (a scrubbing brush and the soap on the back rim)
    box(G, M['timber'], tuple(bb + Vector((-0.07, -0.02, 0.008))), tuple(bb + Vector((0.07, 0.02, 0.025))), wa((1, 0, 0)), 0.004)
    box(G, M['bristle'], tuple(bb + Vector((-0.065, -0.017, 0.0))), tuple(bb + Vector((0.065, 0.017, 0.009))), fa(rnd), 0.0)
    box(G, M['soap'], (-0.22, -0.075, z1), (-0.15, -0.035, z1 + 0.025), ma(), 0.008, 2)
    bk = Vector((0.0, -0.2, 0.0))
    G.add(lathe_bm([(0.0, 0.11), (1.0, 0.14)], bk, bk + Vector((0, 0, 0.27)), 16, (True, False)), M['galv'], ma(0.3), smooth=True, wrap=False)
    F.rod(G, M['galv'], [bk + Vector((0.14 * math.cos(t), 0.14 * math.sin(t) * 0.3, 0.27 + 0.1 * math.sin(t))) for t in np.linspace(0, math.pi, 9)], 0.003, 4, ma(0.4))

# ================================================================ the pegboard and its tools
def pegboard(G, M, rnd):
    zb, zt = 0.95, 1.85
    for z in (zb + 0.05, zt - 0.05): box(G, M['timber'], (-0.6, -0.02, z - 0.02), (0.6, 0.0, z + 0.02), wa((1, 0, 0)), 0.002)
    box(G, M['peg'], (-0.6, -0.025, zb), (0.6, -0.02, zt), attrs_of(lambda q: (q[0], q[2], 0.0), 0.5), 0.0)
    y0 = -0.025
    def hook(x, z, L=0.05):
        F.rod(G, M['steel'], [(x, y0 + 0.004, z), (x, y0 - L, z), (x, y0 - L - 0.006, z + 0.015)], 0.0025, 5, ma(0.4)); return Vector((x, y0 - L * 0.6, z))
    # the saw, hung by its handle on a hook
    h = hook(-0.45, 1.68, 0.045)
    box(G, M['handle'], tuple(h + Vector((-0.05, -0.006, -0.12))), tuple(h + Vector((0.05, 0.012, 0.02))), wa((0, 0, 1)), 0.008, 1)
    bm = bmesh.new(); P = [h + Vector((-0.045, 0.002, -0.1)), h + Vector((0.035, 0.002, -0.1)), h + Vector((0.06, 0.002, -0.62)), h + Vector((-0.06, 0.002, -0.62))]
    vs = [bm.verts.new(p + Vector((0, d, 0))) for d in (-0.0006, 0.0006) for p in P]
    for f_ in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)): bm.faces.new([vs[i] for i in f_])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); G.add(bm, M['steel'], ma(0.3), wrap=False)
    # the hammer, its head across two hooks, the shaft hanging
    a, b = hook(-0.28, 1.7), hook(-0.2, 1.7)
    box(G, M['iron'], ((a.x - 0.03), a.y - 0.016, a.z + 0.003), (b.x + 0.03, a.y + 0.012, a.z + 0.03), ma(0.4), 0.004, 1)
    F.rod(G, M['handle'], [Vector(((a.x + b.x) / 2, a.y, a.z + 0.01)), Vector(((a.x + b.x) / 2, a.y, a.z - 0.3))], 0.012, 6, wa((0, 0, 1)))
    # spanners on a row of hooks, each by its ring
    for i, L in enumerate((0.16, 0.2, 0.24, 0.28)):
        h = hook(-0.06 + 0.06 * i, 1.72)
        ring = [h + Vector((0, 0, -0.012)) + Vector((math.cos(t), 0, math.sin(t))) * 0.014 for t in np.linspace(0, 2 * math.pi, 9)]
        F.rod(G, M['steel'], ring, 0.004, 4, ma(0.4), caps=(False, False))
        box(G, M['steel'], tuple(h + Vector((-0.008, -0.003, -L))), tuple(h + Vector((0.008, 0.003, -0.025))), ma(0.4), 0.002)
        box(G, M['steel'], tuple(h + Vector((-0.017, -0.003, -L - 0.03))), tuple(h + Vector((0.017, 0.003, -L))), ma(0.4), 0.002)
    # a coil of copper wire on its hook
    h = hook(0.3, 1.68, 0.05)
    for k in range(3):
        ring = [h + Vector((0, -0.004 * k, -0.075)) + Vector((math.cos(t), 0, math.sin(t))) * (0.075 - 0.004 * k) for t in np.linspace(0, 2 * math.pi, 17)]
        F.rod(G, M['wire'], ring, 0.004, 4, ma(0.3), caps=(False, False))
    # pliers on a hook, by their crossed handles
    h = hook(0.47, 1.66)
    for s in (-1, 1): F.rod(G, M['steel'], [h + Vector((0, 0, 0.005)), h + Vector((s * 0.02, 0, -0.04)), h + Vector((s * 0.03, 0, -0.17))], 0.005, 5, ma(0.4))
    F.rod(G, M['steel'], [h + Vector((0, 0, 0.0)), h + Vector((0, 0, 0.05))], 0.007, 5, ma(0.4))
    # a brace (the carpenter's drill) on two hooks
    a, b = hook(-0.45, 1.25), hook(-0.3, 1.25)
    F.rod(G, M['steel'], [a + Vector((-0.04, 0, 0.012)), a + Vector((0.0, 0, 0.012)), a + Vector((0.03, 0, 0.012)), a + Vector((0.05, 0, -0.06)), b + Vector((-0.04, 0, -0.06)), b + Vector((-0.02, 0, 0.012)), b + Vector((0.04, 0, 0.012))], 0.006, 6, ma(0.4), sub=2)
    G.add(lathe_bm([(0.0, 0.025), (1.0, 0.022)], a + Vector((-0.04, 0, 0.012)), a + Vector((-0.1, 0, 0.012)), 8), M['handle'], wa((1, 0, 0)), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.012), (1.0, 0.004)], b + Vector((0.04, 0, 0.012)), b + Vector((0.12, 0, 0.012)), 6), M['steel'], ma(0.3), smooth=True, wrap=False)
    # the chisel rack: a batten with holes, five chisels through it
    box(G, M['timber'], (-0.12, -0.075, 1.3), (0.2, -0.025, 1.33), wa((1, 0, 0)), 0.003)
    for i in range(5):
        x = -0.09 + 0.065 * i; w_ = 0.006 + 0.003 * i
        G.add(lathe_bm([(0.0, 0.012), (0.7, 0.015), (1.0, 0.012)], (x, -0.05, 1.33), (x, -0.05, 1.43), 8), M['handle'], wa((0, 0, 1)), smooth=True, wrap=False)
        box(G, M['steel'], (x - w_, -0.053, 1.12 + 0.02 * (i % 2)), (x + w_, -0.047, 1.33), ma(0.3), 0.0)
    # a paintbrush on a hook
    h = hook(0.45, 1.3)
    box(G, M['handle'], tuple(h + Vector((-0.012, -0.006, -0.17))), tuple(h + Vector((0.012, 0.006, 0.02))), wa((0, 0, 1)), 0.004)
    box(G, M['tin'], tuple(h + Vector((-0.025, -0.008, -0.21))), tuple(h + Vector((0.025, 0.008, -0.17))), ma(0.4), 0.002)
    box(G, M['bristle'], tuple(h + Vector((-0.024, -0.007, -0.27))), tuple(h + Vector((0.024, 0.007, -0.21))), fa(rnd), 0.003)

# ================================================================ the coal bunker
def coal_bin(G, M, rnd):
    W, D, hb, hf = 0.9, 0.42, 0.8, 0.56
    for sx in (-1, 1):                                                        # (the sides: back high, front low)
        x = sx * (W / 2 - 0.011)
        bm = bmesh.new(); P = [Vector((0, -0.0, 0)), Vector((0, -D, 0)), Vector((0, -D, hf)), Vector((0, 0.0, hb))]
        vs = [bm.verts.new(p + Vector((x + d, 0, 0))) for d in (-0.011, 0.011) for p in P]
        for f_ in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)): bm.faces.new([vs[i] for i in f_])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); G.add(bm, M['pine'], wa((0, 1, 0)), wrap=False)
        box(G, M['pine'], (x - 0.011, -D + 0.02, 0.0), (x + 0.011, -D + 0.045, hf), wa((0, 0, 1)), 0.002)   # (the groove battens)
    box(G, M['pine'], (-W / 2, -0.02, 0.0), (W / 2, 0.0, hb), wa((1, 0, 0)), 0.002)
    for k, z in enumerate(np.arange(0.12, hf - 0.05, 0.11)):                  # (front boards in the grooves: the lowest one gone)
        box(G, M['pine'], (-W / 2 + 0.022, -D + 0.045, z), (W / 2 - 0.022, -D + 0.065, z + 0.105), wa((1, 0, 0), wear=0.5), 0.003)
    a = math.atan2(hb - hf, D); L = math.hypot(D, hb - hf) + 0.004
    for k in range(4):                                                        # (the lid's boards, sloping)
        x0 = -W / 2 + k * W / 4
        bm = block((x0 + 0.003, -L, 0.0), (x0 + W / 4 - 0.003, 0.0, 0.02), 0.002, 1); S.xform(bm, (0, 0, 0), (a, 0, 0)); S.xform(bm, (0, 0.0, hb - 0.02)); G.add(bm, M['pine'], wa((0, 1, 0), wear=0.3), wrap=False)
    for x in (-0.3, 0.3): box(G, M['iron'], (x - 0.03, -0.012, hb - 0.03), (x + 0.03, 0.002, hb + 0.0), ma(0.3), 0.001)   # (hinges)
    import fixtures as Fx
    Fx.coal_lumps(G, M['coal'], 40, (-W / 2 + 0.03, W / 2 - 0.03, -D + 0.07, -0.03, 0.0), 11, (0.03, 0.05), 0.6)
    Fx.coal_lumps(G, M['coal'], 18, (-0.3, 0.3, -D + 0.02, -D + 0.08, 0.0), 13, (0.02, 0.035), 0.5)

# ================================================================ the shelving
def metal_shelf(G, M, rnd):
    W, D, H = 1.2, 0.4, 1.9; levels = (0.08, 0.5, 0.92, 1.34, 1.66)
    for x in (-W / 2, 0.0, W / 2):
        for y in (-D, 0.0):
            fx = -1 if x > 0.01 else 1; fy = 1 if y < -0.01 else -1
            if abs(x) < 0.01: fx = 1
            C.angle_upright(G, M, x, y, 0.0, H, fx, fy, rnd)
    P = F.Moved(G, Matrix(((0, -1, 0, 0), (1, 0, 0, -D / 2), (0, 0, 1, 0), (0, 0, 0, 1))))   # (the rack's frame: depth along x, length along y)
    for k, z in enumerate(levels):
        box(G, M['angle'], (-W / 2 + 0.002, -D + 0.002, z - 0.001), (W / 2 - 0.002, -0.002, z), attrs_of(lambda q: (9.0, q[2], 0.0), rnd.random()), 0.0)
        box(G, M['angle'], (-W / 2 + 0.002, -D + 0.002, z - 0.03), (W / 2 - 0.002, -D + 0.003, z), attrs_of(lambda q: (9.0, q[2], 0.0), rnd.random()), 0.0)
        for y0, y1 in ((-W / 2 + 0.02, -0.02), (0.02, W / 2 - 0.02)):
            C.fill_shelf(P, M, rnd, z, y0, y1, -1, min(k, 4), D / 2)

# ================================================================ the barrel
def barrel(G, M, rnd):
    c = Vector((0.0, -0.21, 0.0)); H = 0.62; n = 18
    rad = lambda z: 0.178 + 0.03 * math.sin(math.pi * z / H)                  # (the bilge)
    for i in range(n):                                                        # (the staves, each its own curved board)
        a0, a1 = 2 * math.pi * (i + 0.004) / n, 2 * math.pi * (i + 0.996) / n
        rows = [[c + Vector((rad(z) * math.cos(a), rad(z) * math.sin(a), z)) for a in np.linspace(a0, a1, 3)] for z in np.linspace(0, H, 7)]
        grid_surface(G, M['oak'], rows, attrs_of(lambda q, i=i: (q[0] * 3 + i, q[1] * 3, q[2]), rnd.random()), flip_to=lambda q: (q - c) * Vector((1, 1, 0)))
        top = [c + Vector((rad(H) * f_ * math.cos(a), rad(H) * f_ * math.sin(a), H)) for f_ in (1.0, 0.9) for a in (a0, a1)]
        bm = bmesh.new(); f_ = bm.faces.new([bm.verts.new(v) for v in (top[0], top[1], top[3], top[2])]); f_.normal_update()
        if f_.normal.z < 0: f_.normal_flip()
        G.add(bm, M['oak'], attrs_of(lambda q, i=i: (q[0] * 3 + i, q[1] * 3, q[2]), rnd.random()), wrap=False)
    G.add(lathe_bm([(0.0, rad(H) * 0.9), (1.0, rad(H) * 0.9)], c + Vector((0, 0, H - 0.03)), c + Vector((0, 0, H)), n, (False, False)), M['oak'], wa((1, 0, 0)), smooth=False, wrap=False)
    G.add(lathe_bm([(0.0, rad(H) * 0.9), (1.0, rad(H) * 0.9)], c + Vector((0, 0, H - 0.035)), c + Vector((0, 0, H - 0.03)), n, (False, True)), M['oak'], wa((1, 0, 0)), wrap=False)   # (the head)
    G.add(lathe_bm([(0.0, 0.02), (1.0, 0.018)], c + Vector((0.07, 0.02, H - 0.03)), c + Vector((0.07, 0.02, H - 0.018)), 8), M['cork'], ma(), smooth=True, wrap=False)   # (the bung)
    for z, w_ in ((0.04, 0.03), (0.17, 0.035), (H - 0.17, 0.035), (H - 0.07, 0.03)):
        G.add(lathe_bm([(0.0, rad(z) + 0.003), (1.0, rad(z + w_) + 0.003)], c + Vector((0, 0, z)), c + Vector((0, 0, z + w_)), 24, (False, False)), M['iron'], ma(0.4), smooth=True, wrap=False)

BANDS = [('Band_fuse_box', 'fuse_box', fuse_box, 1024), ('Band_water_heater', 'water_heater', water_heater, 1024), ('Band_utility_sink', 'utility_sink', utility_sink, 1024),
         ('Band_pegboard', 'pegboard', pegboard, 1024), ('Band_coal_bin', 'coal_bin', coal_bin, 1024), ('Band_metal_shelf', 'metal_shelf', metal_shelf, 2048), ('Band_barrel', 'barrel', barrel, 1024)]
