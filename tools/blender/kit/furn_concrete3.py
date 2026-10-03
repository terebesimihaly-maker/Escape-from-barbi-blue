# Escape from Barbi Blue: the basement's islands (WP2.5c, concrete style; build spec B4), built by furn_concrete.py:
#   Isl_boiler           the house boiler standing free on its plinth, fire door open on the glow (Isl_boiler_fix); its flue and the
#                        flow and return risers going up past the ceiling to 3.4 m; a brick coal bunker heaped with coal, a shovel
#                        in it, an ash bin
#   Isl_shelving_double  two slotted-angle racks back to back, loaded both sides; small crates on the bottom shelves
#   Isl_crate_stack      a pile of slatted crates, two and three high, a coil of rope on top
#   Isl_washtubs         a cast-iron mangle (wooden rollers, the big flywheel and its crank, the pressure screw); two galvanised tubs
#                        of grey water on a bench, a washboard, a posser, a sheet over a tub's rim; a wicker basket of linen
#   Isl_wine_rack        wine bins back to back, bottles lying in them necks out, dusty; some bins empty
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
import furn_concrete as C

def water(name):
    """grey wash water: dark, glossy, a scum of soap gathered in islands"""
    m = kitlib.Mat(name); op = m.attr('opos', True)
    scum = m.remap(m.noise(op, 18, 5, 0.6), 0.55, 0.7)
    col = m.mix(scum, lin('#2e3230'), lin('#b9b6aa'))
    return finish(m, col, m.mixf(scum, 0.04, 0.6), m.math('MULTIPLY', scum, 0.0005))

def isl_mats():
    k = 'isl_concrete'; M = C.con_mats(k)
    M['water'] = water(k + '_water'); M['beech'] = kitlib.wood(k + '_beech', 'beech', 'bare', stain='#c9b89a', age=2.0)
    M['linen'] = kitlib.fabric(k + '_linen', '#d9d4c6', weave=0.0, fade=0.3, age=1.8); M['wicker'] = kitlib.fabric(k + '_wicker', '#a8875a', weave=0.0, stripes=('#6e5636', 0.01), age=1.9)
    M['copper'] = kitlib.metal(k + '_copper', 'brass', color='#a8673a', rust=0.0, age=1.8); M['foil'] = kitlib.metal(k + '_foil', 'steel', color='#4e3e36', rust=0.2, age=1.8)
    M['dusty'] = C.glossy(k + '_dustybottle', '#16240f', 0.15, 1.0); M['dusty2'] = C.glossy(k + '_dustybottle2', '#24120a', 0.15, 1.0)
    M['rackwood'] = kitlib.wood(k + '_rack', 'oak', 'bare', stain='#2e2218', age=1.4); M['back'] = kitlib.grey(k + '_back', (0.012, 0.01, 0.009))
    return M

# ================================================================ the boiler
def coal_heap(G, M, x0, x1, y0, y1, h, rnd, n=8):
    """a heap of coal: a lumpy mound (its slack) with lumps strewn over it"""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    def z(x, y):
        d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        return 0.005 + h * max(0.0, 1.0 - d) ** 0.8 + 0.015 * math.sin(x * 37 + y * 23) * math.sin(x * 19 - y * 41)
    P = [[Vector((x, y, z(x, y))) for x in np.linspace(x0, x1, n + 2)] for y in np.linspace(y0, y1, n + 2)]
    grid_surface(G, M['coal'], P, attrs_of(lambda q: tuple(q), rnd.random()), flip_to=lambda q: Vector((0, 0, 1)), smooth=False)
    import fixtures as Fx
    pts = Fx.coal_lumps(G, M['coal'], 0, (x0, x1, y0, y1, 0.0), 1)
    for k in range(int(30 * (x1 - x0) * (y1 - y0) / 0.25) + 10):
        x, y = rnd.uniform(x0 + 0.03, x1 - 0.03), rnd.uniform(y0 + 0.03, y1 - 0.03); s = rnd.uniform(0.025, 0.05)
        import modules as Mo
        bm = Mo.rock((x, y, z(x, y) + s * 0.3), (s, s * rnd.uniform(0.7, 1.0), s * rnd.uniform(0.6, 0.9)), rnd.uniform(0, 50), 1, 0.6)
        G.add(bm, M['coal'], attrs_of(lambda q: tuple(q), rnd.random()), smooth=False, wrap=False)

def isl_boiler(G, M, rnd):
    P = F.Moved(G, Matrix.Translation((-0.3, 0.0, 0.0)))
    C.boiler(P, M, rnd, front=-0.33, back=0.34, socket='Isl_boiler_fix')
    G.sockets = P.moved_sockets()
    bx, back = -0.3, 0.34
    fl = [Vector((bx, back - 0.13, 1.25)), Vector((bx, back - 0.13, 2.2)), Vector((bx, back - 0.05, 2.45)), Vector((bx, back + 0.12, 2.7)), Vector((bx, back + 0.14, 3.4))]
    F.rod(G, M['flue'], fl, 0.09, 16, ma(0.3), caps=(False, False), sub=3)
    for z in (1.7, 3.0): G.add(lathe_bm([(0.0, 0.096), (1.0, 0.096)], (bx, fl[-1].y if z > 2.6 else back - 0.13, z), (bx, fl[-1].y if z > 2.6 else back - 0.13, z + 0.05), 16, (False, False)), M['flue'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['iron'], [(bx, back - 0.13 - 0.09, 1.9), (bx, back - 0.13 - 0.15, 1.9), (bx + 0.06, back - 0.13 - 0.18, 1.9)], 0.007, 5, ma(0.5))   # (the damper's handle)
    flow = [(bx + 0.2, back - 0.25, 1.15), (bx + 0.2, back - 0.25, 1.6), (bx + 0.25, back - 0.1, 1.8), (bx + 0.3, 0.2, 2.0), (bx + 0.3, 0.2, 3.4)]
    F.rod(G, M['iron'], flow, 0.022, 8, ma(0.3), sub=2)
    F.rod(G, M['lagging'], [(bx + 0.3, 0.2, 2.1), (bx + 0.3, 0.2, 3.3)], 0.042, 10, fa(rnd, 6, 6))
    C.gate_valve(G, M, (bx + 0.2, back - 0.25, 1.35), (0, 0, 1), (0, -1, 0))
    ret = [(bx - 0.2, back - 0.05, 0.3), (bx - 0.2, back + 0.15, 0.3), (bx - 0.25, back + 0.25, 0.32), (bx - 0.25, back + 0.25, 3.4)]
    F.rod(G, M['iron'], ret, 0.022, 8, ma(0.3), sub=2)
    C.gate_valve(G, M, (bx - 0.25, back + 0.25, 0.6), (0, 0, 1), (0, -1, 0))
    # the coal bunker: three low brick walls, the coal heaped in it and spilling out of its open front
    for lo, hi in (((0.15, 0.62, 0.0), (0.93, 0.73, 0.7)), ((0.82, -0.2, 0.0), (0.93, 0.73, 0.7)), ((0.15, -0.2, 0.0), (0.26, 0.73, 0.7))):
        box(G, M['brick'], lo, hi, ma(0.3), 0.004, 1)
    for lo, hi in (((0.14, 0.61, 0.7), (0.94, 0.74, 0.72)), ((0.81, -0.21, 0.7), (0.94, 0.74, 0.72)), ((0.14, -0.21, 0.7), (0.27, 0.74, 0.72))):
        box(G, M['timber'], lo, hi, wa((1, 0, 0)), 0.003)                     # (the copings)
    coal_heap(G, M, 0.26, 0.82, -0.3, 0.62, 0.55, rnd)
    coal_heap(G, M, 0.3, 0.78, -0.5, -0.2, 0.08, rnd, 5)
    sb = Vector((0.5, -0.05, 0.35)); tp = Vector((0.42, -0.32, 1.05)); ax = (tp - sb).normalized()   # (the shovel thrust into the heap)
    F.rod(G, M['pine'], [sb + ax * 0.12, tp], 0.016, 6, wa(ax))
    ac = (Vector((1, 0, 0)) - ax * ax.x).normalized(); nr = ac.cross(ax)
    Pp = [[sb + ax * s + ac * a * 0.1 + nr * 0.03 * a * a for a in np.linspace(-1, 1, 5)] for s in np.linspace(-0.06, 0.12, 3)]
    grid_surface(G, M['plate'], Pp, ma(0.4), flip_to=lambda q: nr)
    F.rod(G, M['pine'], [tp - ac * 0.05, tp + ac * 0.05], 0.014, 6, wa(ac))
    ab = Vector((-0.765, -0.5, 0.0))                                            # (the galvanised ash bin, its lid askew)
    G.add(lathe_bm([(0.0, 0.14), (0.1, 0.15), (0.5, 0.15), (0.55, 0.155), (0.6, 0.15), (1.0, 0.15)], ab, ab + Vector((0, 0, 0.62)), 16, (True, False)), M['galv'], ma(0.4), smooth=True, wrap=False)
    bm = lathe_bm([(0.0, 0.158), (0.4, 0.15), (0.8, 0.08), (1.0, 0.0)], (0, 0, 0), (0, 0, 0.05), 16); S.xform(bm, (0, 0, 0), (0.12, 0.0, 0.0)); S.xform(bm, tuple(ab + Vector((0.0, 0.02, 0.63)))); G.add(bm, M['galv'], ma(0.4), smooth=True, wrap=False)
    for s in (-1, 1): F.rod(G, M['galv'], [ab + Vector((s * 0.15, -0.03, 0.5)), ab + Vector((s * 0.175, 0.0, 0.5)), ab + Vector((s * 0.15, 0.03, 0.5))], 0.005, 5, ma(0.4))

# ================================================================ shelving back to back
def small_crate(G, M, x, y0, z, rnd):
    C.crate(G, M, (x, y0 + 0.19, z), (0.26, 0.36, 0.26), rnd.uniform(-0.04, 0.04), rnd, missing=rnd.random() < 0.5); return 0.38

def isl_shelving_double(G, M, rnd):
    C.SIZE[small_crate] = 0.4; C.DEP[small_crate] = 0.3
    kinds = dict(C.KINDS); kinds[0] = (small_crate, small_crate, C.crock, C.sack)
    P = F.Moved(G, Matrix(((0, -1, 0, 0), (1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))))
    C.shelf_rack(P, M, rnd, W=1.28, L=1.84, H=2.0, mid=True, kinds=kinds)

# ================================================================ the crate pile
def isl_crate_stack(G, M, rnd):
    for c, size, rot, miss in (((-0.38, -0.316, 0.0), (0.76, 0.6, 0.5), 0.03, False), ((0.42, -0.306, 0.0), (0.68, 0.62, 0.55), -0.05, False),
                               ((-0.08, 0.33, 0.0), (0.86, 0.58, 0.45), 0.02, False), ((0.6, 0.36, 0.0), (0.34, 0.5, 0.35), 0.1, True),
                               ((-0.3, -0.12, 0.5), (0.68, 0.5, 0.5), 0.1, False), ((0.4, -0.25, 0.55), (0.58, 0.48, 0.45), -0.12, True),
                               ((-0.27, -0.1, 1.0), (0.5, 0.42, 0.42), 0.25, True)):
        C.crate(G, M, c, size, rot, rnd, missing=miss)
    rc = Vector((-0.25, -0.12, 1.42))                                         # (a coil of rope on top)
    for k in range(3):
        ring = [rc + Vector((math.cos(t) * (0.12 - 0.01 * k), math.sin(t) * (0.12 - 0.01 * k) * 0.9, 0.012 + 0.022 * k)) for t in np.linspace(0, 2 * math.pi, 19)]
        F.rod(G, M['rope'], ring, 0.012, 6, fa(rnd), caps=(False, False))

# ================================================================ the wash house
def mangle(G, M, rnd, cx=0.6):
    """the mangle: cast-iron A-frames at y = +-0.3, two wooden rollers between them, the pressure screw, the flywheel and crank"""
    for y in (-0.3, 0.3):
        for sx in (-1, 1): F.rod(G, M['iron'], [(cx + sx * 0.26, y, 0.0), (cx + sx * 0.2, y, 0.3), (cx + sx * 0.07, y, 0.8), (cx + sx * 0.06, y, 1.12)], 0.022, 6, ma(0.4), sub=2)
        F.rod(G, M['iron'], [(cx - 0.21, y, 0.3), (cx, y, 0.36), (cx + 0.21, y, 0.3)], 0.016, 6, ma(0.4), sub=2)
        box(G, M['iron'], (cx - 0.09, y - 0.025, 0.74), (cx + 0.09, y + 0.025, 1.14), ma(0.4), 0.008, 1)   # (the roller housings)
        for sx in (-1, 1): G.add(lathe_bm([(0.0, 0.04), (1.0, 0.035)], (cx + sx * 0.26, y, 0.0), (cx + sx * 0.26, y, 0.025), 10), M['iron'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['iron'], [(cx, -0.3, 0.12), (cx, 0.3, 0.12)], 0.016, 6, ma(0.4))
    for z in (0.86, 1.0):
        G.add(lathe_bm([(0.0, 0.06), (0.03, 0.068), (0.97, 0.068), (1.0, 0.06)], (cx, -0.27, z), (cx, 0.27, z), 16), M['beech'], wa((0, 1, 0), wear=0.6), smooth=True, wrap=False)
        F.rod(G, M['iron'], [(cx, -0.33, z), (cx, 0.33, z)], 0.015, 6, ma(0.3))
    box(G, M['iron'], (cx - 0.09, -0.33, 1.14), (cx + 0.09, 0.33, 1.18), ma(0.4), 0.006, 1)
    F.rod(G, M['iron'], [(cx, 0.0, 1.18), (cx, 0.0, 1.38)], 0.014, 8, ma(0.3))
    ring = [Vector((cx + 0.075 * math.cos(t), 0.075 * math.sin(t), 1.39)) for t in np.linspace(0, 2 * math.pi, 13)]
    F.rod(G, M['iron'], ring, 0.008, 5, ma(0.4), caps=(False, False))
    for t in (0, math.pi / 2): F.rod(G, M['iron'], [(cx + 0.075 * math.cos(t), 0.075 * math.sin(t), 1.39), (cx - 0.075 * math.cos(t), -0.075 * math.sin(t), 1.39)], 0.006, 5, ma(0.4))
    hub = Vector((cx, 0.38, 0.86)); R = 0.27                                  # (the flywheel on the lower roller's shaft)
    rim = [hub + Vector((R * math.cos(t), 0, R * math.sin(t))) for t in np.linspace(0, 2 * math.pi, 25)]
    F.rod(G, M['iron'], rim, 0.016, 6, ma(0.4), caps=(False, False))
    for k in range(6):
        a = 2 * math.pi * k / 6; b = a + 0.35
        F.rod(G, M['iron'], [hub + Vector((0.03 * math.cos(a), 0, 0.03 * math.sin(a))), hub + Vector((0.15 * math.cos(a + 0.25), 0, 0.15 * math.sin(a + 0.25))), hub + Vector(((R - 0.01) * math.cos(b), 0, (R - 0.01) * math.sin(b)))], 0.009, 5, ma(0.4), sub=2)
    G.add(lathe_bm([(0.0, 0.04), (1.0, 0.04)], hub - Vector((0, 0.05, 0)), hub + Vector((0, 0.03, 0)), 10), M['iron'], ma(0.4), smooth=True, wrap=False)
    hp = hub + Vector((R * math.cos(1.1), 0, R * math.sin(1.1)))
    F.rod(G, M['iron'], [hp, hp + Vector((0, 0.03, 0))], 0.01, 6, ma(0.4))
    G.add(lathe_bm([(0.0, 0.016), (0.5, 0.019), (1.0, 0.015)], hp + Vector((0, 0.03, 0)), hp + Vector((0, 0.13, 0)), 8), M['beech'], wa((0, 1, 0), wear=0.8), smooth=True, wrap=False)
    bm = block((-0.2, -0.28, -0.008), (0.2, 0.28, 0.008), 0.002, 1); S.xform(bm, (0, 0, 0), (0, 0.35, 0)); S.xform(bm, (cx - 0.12, 0.0, 0.7)); G.add(bm, M['timber'], wa((1, 0, 0)), wrap=False)   # (the catch board)

def tub(G, M, c, r, h, rnd, water_z=0.7):
    c = Vector(c)
    G.add(lathe_bm([(0.0, r * 0.82), (0.05, r * 0.85), (0.9, r), (0.95, r * 1.01), (1.0, r * 1.03)], c, c + Vector((0, 0, h)), 20, (True, False)), M['galv'], ma(0.4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r * 0.98), (1.0, r * 0.97)], c + Vector((0, 0, h)), c + Vector((0, 0, h - 0.04)), 20, (False, False)), M['galv'], ma(0.3), smooth=True, wrap=False)   # (the rolled rim, inside)
    rr = r * (0.85 + 0.15 * water_z)
    G.add(lathe_bm([(0.0, rr), (1.0, rr)], c + Vector((0, 0, h * water_z - 0.002)), c + Vector((0, 0, h * water_z)), 20, (False, True)), M['water'], ma(), wrap=False)
    for s in (-1, 1): F.rod(G, M['galv'], [c + Vector((s * r * 0.98, -0.05, h - 0.05)), c + Vector((s * (r + 0.035), -0.04, h - 0.03)), c + Vector((s * (r + 0.035), 0.04, h - 0.03)), c + Vector((s * r * 0.98, 0.05, h - 0.05))], 0.006, 5, ma(0.4), sub=2)

def isl_washtubs(G, M, rnd):
    mangle(F.Moved(G, Matrix.Translation((0.0, 0.135, 0.0))), M, rnd, 0.6)
    zb = 0.45                                                                 # (the bench)
    box(G, M['timber'], (-0.9, -0.56, zb - 0.03), (0.2, 0.56, zb), wa((1, 0, 0), wear=0.4), 0.004, 1)
    for x in (-0.84, 0.14):
        for y in (-0.5, 0.5): box(G, M['timber'], (x - 0.03, y - 0.03, 0.0), (x + 0.03, y + 0.03, zb - 0.03), wa((0, 0, 1)), 0.003)
        box(G, M['timber'], (x - 0.02, -0.5, 0.1), (x + 0.02, 0.5, 0.14), wa((0, 1, 0)), 0.002)
    tub(G, M, (-0.56, 0.0, zb), 0.27, 0.3, rnd, 0.72); tub(G, M, (-0.05, 0.12, zb), 0.22, 0.27, rnd, 0.6)
    wb = Vector((-0.56, -0.12, zb + 0.06))                                    # (the washboard leaning in the first tub)
    a = -0.45
    for sx in (-1, 1):
        bm = block((sx * 0.14 - 0.015, -0.01, 0.0), (sx * 0.14 + 0.015, 0.01, 0.6), 0.003, 1); S.xform(bm, (0, 0, 0), (a, 0, 0)); S.xform(bm, tuple(wb)); G.add(bm, M['timber'], wa((0, 0, 1)), wrap=False)
    rows = [[Vector((x, 0.004 * math.sin(z * 260), z)) for x in (-0.125, 0.125)] for z in np.linspace(0.12, 0.45, 23)]
    rot = Matrix.Rotation(a, 3, 'X')
    grid_surface(G, M['galv'], [[wb + rot @ p for p in row] for row in rows], ma(0.4), flip_to=lambda q: rot @ Vector((0, -1, 0)))
    for z in (0.08, 0.5): bm = block((-0.14, -0.012, z), (0.14, 0.012, z + 0.05), 0.002, 1); S.xform(bm, (0, 0, 0), (a, 0, 0)); S.xform(bm, tuple(wb)); G.add(bm, M['timber'], wa((1, 0, 0)), wrap=False)
    pb = Vector((0.08, 0.28, zb + 0.02))                                      # (the posser leaning on the second tub)
    tp = Vector((0.0, 0.2, 1.2)); ax = (tp - pb).normalized()
    G.add(lathe_bm([(0.0, 0.1), (0.4, 0.09), (1.0, 0.03)], pb, pb + ax * 0.14, 14, (False, True)), M['copper'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['beech'], [pb + ax * 0.12, tp], 0.016, 6, wa(ax))
    F.rod(G, M['beech'], [tp - Vector((0.08, 0, 0)), tp + Vector((0.08, 0, 0))], 0.014, 6, wa((1, 0, 0)))
    def sheet(u, v):                                                          # (a wet sheet hung over the first tub's rim, down its front)
        x = -0.75 + 0.38 * u; y = -0.24 - 0.05 * v ** 2; return Vector((x + 0.01 * math.sin(9 * v + 3 * u), y - 0.03 * math.sin(5 * u + 2) * v, zb + 0.31 - 0.4 * v + 0.02 * math.sin(7 * u)))
    drape(G, M['linen'], 10, 8, sheet, fa(rnd, 3, 3), out=lambda q: Vector((0, -1, 0.3)))
    bk = Vector((-0.4, -0.44, 0.0))                                           # (a wicker basket of folded linen in front)
    G.add(lathe_bm([(0.0, 0.17), (0.6, 0.2), (1.0, 0.21)], bk, bk + Vector((0, 0, 0.3)), 18, (True, False)), M['wicker'], fa(rnd, 4, 4), smooth=True, wrap=False)
    for k in range(2): pillow(G, M['linen'], tuple(bk + Vector((0.0, 0.0, 0.2 + 0.07 * k))), 0.3, 0.28, 0.07, rnd, n=4, sag=0.1)
    for s in (-1, 1): F.rod(G, M['wicker'], [bk + Vector((s * 0.21, 0, 0.28)), bk + Vector((s * 0.25, 0, 0.3)), bk + Vector((s * 0.21, 0, 0.32))], 0.012, 5, fa(rnd), sub=2)

# ================================================================ the wine bins
def isl_wine_rack(G, M, rnd):
    W, D, H, z0 = 1.84, 1.28, 1.9, 0.1; nc, nr = 15, 14; cw = W / nc; ch = (H - z0 - 0.04) / nr
    box(G, M['rackwood'], (-W / 2, -D / 2, 0.0), (W / 2, D / 2, z0), wa((1, 0, 0)), 0.004)                   # (the plinth)
    box(G, M['rackwood'], (-W / 2 - 0.005, -D / 2 - 0.005, H - 0.04), (W / 2 + 0.005, D / 2 + 0.005, H), wa((1, 0, 0)), 0.004)
    box(G, M['back'], (-W / 2, -0.008, z0), (W / 2, 0.008, H - 0.04), ma(), 0.0)
    for i in range(nc + 1):
        x = -W / 2 + i * cw; box(G, M['rackwood'], (x - 0.007, -D / 2, z0), (x + 0.007, D / 2, H - 0.04), wa((0, 0, 1)), 0.0)
    for j in range(1, nr):
        z = z0 + j * ch; box(G, M['rackwood'], (-W / 2, -D / 2, z - 0.006), (W / 2, D / 2, z + 0.006), wa((1, 0, 0)), 0.0)
    for sy in (-1, 1):
        empty = set()
        for _ in range(4):                                                    # (some bins emptied, in runs)
            i0, j0 = rnd.randrange(nc), rnd.randrange(nr)
            for d in range(rnd.randrange(2, 6)): empty.add(((i0 + d) % nc, j0))
        for i in range(nc):
            for j in range(nr):
                if (i, j) in empty or rnd.random() < 0.15: continue
                x = -W / 2 + (i + 0.5) * cw + rnd.uniform(-0.008, 0.008); z = z0 + j * ch + 0.006 + 0.037
                r = 0.036; y0 = sy * (D / 2 - 0.015 - rnd.uniform(0.0, 0.04)); y1 = y0 - sy * 0.3   # (lying base out, the punt toward you)
                G.add(lathe_bm([(0.0, r * 0.93), (0.04, r), (0.55, r), (0.7, 0.014), (1.0, 0.013)], (x, y0, z), (x, y1, z), 7, (True, False)), M['dusty' if rnd.random() < 0.65 else 'dusty2'], ma(), smooth=True, wrap=False)

# ================================================================ build
def build_islands(want):
    rnd = random.Random(83); M = isl_mats(); roots = []; parts = []
    for name, fn in (('Isl_boiler', isl_boiler), ('Isl_shelving_double', isl_shelving_double), ('Isl_crate_stack', isl_crate_stack), ('Isl_washtubs', isl_washtubs), ('Isl_wine_rack', isl_wine_rack)):
        if not want(name.lower()): continue
        G = S.Geo(1, 1, False, False); G.sockets = []; fn(G, M, rnd); o = F.build_obj(name.lower() + '_tmp', G); parts.append(o)
        roots.append((name, [o], None, None, None, [], getattr(G, 'sockets', [])))
    return roots, parts, M
