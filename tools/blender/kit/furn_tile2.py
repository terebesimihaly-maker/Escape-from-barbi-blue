# Escape from Barbi Blue: the gallery floor's wall pieces (WP2.5b, tile style; build spec B6), built by furn_tile.py. Backs on the wall
# (y = 0, the room toward -y), origin on the wall plane at floor level, at most 0.44 m into the room.
#   Band_console          a marble-topped console on carved scroll legs, gilt
#   Band_console_mirror   the dark overmantel glass above it (z 1.0): foxed silvering in a gilt frame with an arched crest
#   Band_grandfather_clock  a mahogany longcase clock: plinth, trunk with a glazed door, the hood with its arched brass dial; its pendulum
#                         (rod and brass bob) on Band_grandfather_clock_Pendulum, swinging about y at the top of the rod
#   Band_doll_cabinet     a glazed mahogany cabinet of bisque dolls sitting on three shelves (hero)
#   Band_china_cabinet    cupboard below, glazed above: plates on their rails, cups hanging, a tureen
#   Band_sideboard        a pedestal sideboard: two cupboards, three drawers, a back gallery, a silver tray and a runner
#   Band_hall_bench       a long bench on turned legs, a buttoned velvet seat
#   Band_gilt_mirror      an oval glass in a carved gilt frame (z 1.0)
#   Band_umbrella_stand   a majolica umbrella stand: two umbrellas and a walking stick
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
from doors import lathe_bm, tube, block, plate, attrs_of
from kitlib import lin

def band_mats(nm):
    import furn_tile as T
    M = T.tile_mats(f'band_{nm}')
    M['mirror'] = T.mirror_glass(f'band_{nm}_mirror'); M['back'] = Dr.bare_boards(f'band_{nm}_back', 'deal', [], age=1.3, tone=0.6)
    M['dial'] = kitlib.porcelain(f'band_{nm}_dial', '#e9e2cf', glaze=False, crackle=0.2, age=1.6); M['hands'] = kitlib.metal(f'band_{nm}_hands', 'iron', color='#141312', rust=0.1)
    M['silver'] = kitlib.metal(f'band_{nm}_silver', 'steel', color='#b9b5aa', rust=0.0, age=1.6)
    M['runner'] = kitlib.fabric(f'band_{nm}_runner', '#e6ded0', weave=0.0, fade=0.3, stripes=('#cfc4ae', 0.008), age=1.7)
    M['majolica'] = kitlib.porcelain(f'band_{nm}_majolica', '#3a5a4a', glaze=True, crackle=0.4, age=1.5)
    M['hatbox'] = kitlib.fabric(f'band_{nm}_hatbox', '#b9a27a', weave=0.0, fade=0.6, stripes=('#8a6a4a', 0.03), age=1.8)
    M['umbrella'] = kitlib.fabric(f'band_{nm}_umb', '#1c1a18', weave=0.0, fade=0.5, age=1.6); M['umbrella2'] = kitlib.fabric(f'band_{nm}_umb2', '#3a2a2a', weave=0.0, fade=0.5, age=1.6)
    import furn_wood4 as W4
    for k, v in W4.doll_materials(f'band_{nm}_doll').items(): M.setdefault(k, v)
    return M

def frame_rect(G, mat, x0, x1, z0, z1, b, y=0.0, h=0.03, attrs=None):
    """a moulded frame round x0..x1, z0..z1 (b wide, h deep, standing out toward -y), mitred"""
    prof = [(0.0, 0.0), (0.0, h * 0.5), (b * 0.15, h * 0.9), (b * 0.4, h), (b * 0.7, h * 0.85), (b, h * 0.55), (b, 0.0)]
    for (a, c, out) in (((x0, z0), (x1, z0), (0, 0, -1)), ((x1, z0), (x1, z1), (1, 0, 0)), ((x1, z1), (x0, z1), (0, 0, 1)), ((x0, z1), (x0, z0), (-1, 0, 0))):
        o = Vector(out); dv = Vector((c[0] - a[0], 0, c[1] - a[1])).normalized()
        rows = [[Vector((a[0], y - hh, a[1])) + o * w - dv * w, Vector((c[0], y - hh, c[1])) + o * w + dv * w] for w, hh in prof]
        grid_surface(G, mat, rows, attrs or ma(0.4), flip_to=lambda q, o=o: o + Vector((0, -1.5, 0)))

def glass_pane(G, M, x0, x1, z0, z1, y):
    G.add(Dr.quad_bm([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], (0, -1, 0)), M['glass'], ma(), wrap=False)

def case(G, M, W, D, z0, z1, mat='mahogany', t=0.022):
    for sx in (-1, 1): box(G, M[mat], (sx * W / 2 - (t if sx > 0 else 0), -D, z0), (sx * W / 2 + (0 if sx > 0 else t), 0.0, z1), wa((0, 0, 1)), 0.003)
    box(G, M['back'], (-W / 2 + t, -0.012, z0), (W / 2 - t, 0.0, z1), wa((0, 0, 1)), 0.0)

def cornice(G, mat, W, D, z, h=0.07, over=0.03):
    prof = [(0.0, 0.0), (0.004, 0.01), (0.004, 0.02), (0.012, 0.03), (0.022, 0.045), (over, 0.058), (over, h)]
    rows = [[Vector((-W / 2 - d, 0.0, z + hh)), Vector((-W / 2 - d, -D - d, z + hh)), Vector((W / 2 + d, -D - d, z + hh)), Vector((W / 2 + d, 0.0, z + hh))] for d, hh in prof]
    grid_surface(G, mat, rows, wa((1, 0, 0)), flip_to=lambda q: Vector((q.x * 0.5, q.y + D / 2, 0.1)))
    G.add(Dr.quad_bm([(-W / 2 - over, 0.0, z + h), (-W / 2 - over, -D - over, z + h), (W / 2 + over, -D - over, z + h), (W / 2 + over, 0.0, z + h)], (0, 0, 1)), mat, wa((1, 0, 0)), wrap=False)

def knob(G, mat, x, y, z, r=0.012):
    G.add(lathe_bm([(0.0, r * 0.5), (0.4, r * 0.6), (0.8, r), (1.0, 0.0)], (x, y, z), (x, y - 0.016, z), 10), mat, ma(0.6), smooth=True, wrap=False)

# ---------------------------------------------------------------- console and its glass
def console(G, M, rnd):
    W, D, zt = 0.99, 0.395, 0.8
    box(G, M['marble'], (-W / 2, -D, zt), (W / 2, 0.0, zt + 0.03), ma(0.3), 0.006, 2)
    box(G, M['gilt'], (-W / 2 + 0.03, -D + 0.02, zt - 0.1), (W / 2 - 0.03, -0.02, zt), ma(0.4), 0.004, 1)
    for k in range(9):                                                      # (the apron's carved swags: beads along a garland)
        x = -0.36 + 0.09 * k; zz = zt - 0.05 - 0.02 * math.sin(math.pi * (k % 4) / 3)
        G.add(lathe_bm([(0.0, 0.0), (0.5, 0.012), (1.0, 0.0)], (x, -D + 0.02, zz), (x, -D + 0.005, zz), 8), M['gilt'], ma(0.5), smooth=True, wrap=False)
    for sx in (-1, 1):                                                      # (the scroll legs: S-curves from the apron to the stretcher)
        pts = [Vector((sx * (W / 2 - 0.08), -D + 0.06, zt - 0.08))] + [Vector((sx * (W / 2 - 0.08 - 0.06 * math.sin(math.pi * t)), -D + 0.06 + 0.08 * math.sin(2 * math.pi * t) * 0.5, zt - 0.08 - (zt - 0.1) * t)) for t in np.linspace(0.1, 1.0, 9)]
        tube(G, M['gilt'], pts, 0.028, 8, ma(0.4))
        tube(G, M['gilt'], [Vector((sx * (W / 2 - 0.06), -0.02, zt - 0.1)), Vector((sx * (W / 2 - 0.06), -0.03, 0.02))], 0.02, 8, ma(0.3))
        turned(G, M['gilt'], [(0.0, 0.035), (0.6, 0.03), (1.0, 0.025)], (sx * (W / 2 - 0.08), -D + 0.06, 0.0), (sx * (W / 2 - 0.08), -D + 0.06, 0.03), 10, attrs=ma(0.5))
    box(G, M['gilt'], (-W / 2 + 0.08, -D + 0.04, 0.08), (W / 2 - 0.08, -0.03, 0.11), ma(0.4), 0.006, 1)
    c = Vector((0.15, -0.2, zt + 0.03))                                      # (a shallow silver bowl)
    G.add(lathe_bm([(0.0, 0.0), (0.3, 0.06), (0.7, 0.1), (1.0, 0.11)], c, c + Vector((0, 0, 0.02)), 18), M['silver'], ma(0.5), smooth=True, wrap=False)

def console_mirror(G, M, rnd):
    x0, x1, z0, z1 = -0.33, 0.33, 1.07, 1.78; b = 0.05
    G.add(Dr.quad_bm([(x0, -0.008, z0), (x1, -0.008, z0), (x1, -0.008, z1), (x0, -0.008, z1)], (0, -1, 0)), M['mirror'], attrs_of(lambda q: (q[0], q[2], 0.0), 0.5), wrap=False)
    frame_rect(G, M['gilt'], x0, x1, z0, z1, b, 0.0, 0.035)
    pts = [(x0 - b, z1 + b)] + [(0.37 * math.cos(a), z1 + b + 0.1 * math.sin(a)) for a in np.linspace(math.pi, 0, 15)] + [(x1 + b, z1 + b)]   # (the arched crest)
    bm = plate(pts, 0.0, 0.025); G.add(bm, M['gilt'], ma(0.4), wrap=False)
    G.add(lathe_bm([(0.0, 0.02), (0.5, 0.035), (1.0, 0.0)], (0, -0.025, 1.93), (0, -0.05, 1.93), 12), M['gilt'], ma(0.5), smooth=True, wrap=False)
    box(G, M['back'], (x0 - b, -0.004, z0 - b), (x1 + b, 0.0, z1 + b), wa(), 0.0)

# ---------------------------------------------------------------- the longcase clock
def grandfather_clock(G, M, rnd):
    W, D = 0.46, 0.27
    box(G, M['mahogany'], (-0.25, -0.3, 0.0), (0.25, 0.0, 0.08), wa((1, 0, 0), wear=0.4), 0.006, 2)       # (the plinth)
    box(G, M['mahogany'], (-0.23, -0.28, 0.08), (0.23, 0.0, 0.5), wa((0, 0, 1)), 0.004, 1)
    box(G, M['mahogany'], (-0.25, -0.3, 0.5), (0.25, 0.0, 0.54), wa((1, 0, 0)), 0.006, 2)
    case(G, M, 0.36, 0.22, 0.54, 1.5)                                        # (the trunk)
    box(G, M['mahogany'], (-0.18, -0.22, 0.54), (-0.14, -0.2, 1.5), wa((0, 0, 1)), 0.003)
    box(G, M['mahogany'], (0.14, -0.22, 0.54), (0.18, -0.2, 1.5), wa((0, 0, 1)), 0.003)
    for z0, z1 in ((0.54, 0.6), (1.44, 1.5)): box(G, M['mahogany'], (-0.14, -0.22, z0), (0.14, -0.2, z1), wa((1, 0, 0)), 0.003)
    glass_pane(G, M, -0.14, 0.14, 0.6, 1.44, -0.208)                         # (the trunk door's glass: the pendulum seen through it)
    knob(G, M['brass'], 0.15, -0.22, 1.0, 0.008)
    box(G, M['dark'], (-0.16, -0.19, 0.56), (0.16, -0.012, 0.565), ma(), 0.0)
    box(G, M['mahogany'], (-0.25, -0.29, 1.5), (0.25, 0.0, 1.55), wa((1, 0, 0)), 0.006, 2)               # (the waist moulding)
    case(G, M, 0.46, 0.27, 1.55, 2.0)                                        # (the hood: an arched door over the dial)
    box(G, M['mahogany'], (-0.23, -0.27, 1.55), (-0.18, -0.25, 2.0), wa((0, 0, 1)), 0.003); box(G, M['mahogany'], (0.18, -0.27, 1.55), (0.23, -0.25, 2.0), wa((0, 0, 1)), 0.003)
    for sx in (-1, 1): turned(G, M['mahogany'], [(0.0, 0.018), (0.1, 0.014), (0.5, 0.016), (0.9, 0.014), (1.0, 0.018)], (sx * 0.2, -0.272, 1.57), (sx * 0.2, -0.272, 1.98), 8, attrs=wa((0, 0, 1)))
    zc = 1.75; R = 0.15
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=24, radius=R); S.xform(bm, (0, 0, 0), (math.pi / 2, 0, 0)); S.xform(bm, (0, -0.256, zc))
    G.add(bm, M['dial'], attrs_of(lambda q: (q[0] / R, (q[2] - zc) / R, 0.0), 0.5), wrap=False)
    box(G, M['brass'], (-0.17, -0.255, 1.57), (0.17, -0.25, zc), ma(0.3), 0.0)
    for k in range(12):
        a = 2 * math.pi * k / 12; d = Vector((math.sin(a), 0, math.cos(a))); p0 = Vector((0, -0.257, zc)) + d * R * 0.78; p1 = p0 + d * R * (0.12 if k % 3 else 0.18); e = Vector((-d.z, 0, d.x)) * 0.004
        G.add(Dr.quad_bm([tuple(p0 - e), tuple(p1 - e), tuple(p1 + e), tuple(p0 + e)], (0, -1, 0)), M['hands'], ma(), wrap=False)
    for (L, w, a) in ((0.08, 0.007, 2.2), (0.12, 0.005, -0.6)):
        d = Vector((math.sin(a), 0, math.cos(a))); e = Vector((-d.z, 0, d.x))
        G.add(plate([(p.x, p.z) for p in (Vector((0, 0, zc)) + e * w, Vector((0, 0, zc)) + d * L, Vector((0, 0, zc)) - e * w)], -0.258, 0.0015), M['hands'], ma(), wrap=False)
    pts = [(-0.25, 2.0)] + [(0.25 * math.cos(a), 2.0 + 0.08 * math.sin(a)) for a in np.linspace(math.pi, 0, 13)] + [(0.25, 2.0)]   # (the hood's arched pediment)
    bm = plate(pts, -0.28, 0.27, front=False); G.add(bm, M['mahogany'], wa((1, 0, 0)), wrap=False)
    for sx in (-1, 0, 1): turned(G, M['brass'], [(0.0, 0.016), (0.4, 0.02), (0.7, 0.012), (1.0, 0.0)], (sx * 0.2, -0.15, 2.0 + (0.08 if sx == 0 else 0.0)), (sx * 0.2, -0.15, 2.0 + (0.08 if sx == 0 else 0.0) + 0.02), 10, attrs=ma(0.4))
    # the pendulum: a rod from the suspension at 1.52 to the bob, swinging about y (its own node)
    Gp = S.Geo(1, 1, False, False)
    tube(Gp, M['brass'], [Vector((0, -0.11, 1.52)), Vector((0, -0.11, 0.78))], 0.004, 6, ma())
    Gp.add(lathe_bm([(0.0, 0.0), (0.3, 0.075), (0.7, 0.075), (1.0, 0.0)], (0, -0.095, 0.74), (0, -0.125, 0.74), 20), M['brass'], ma(0.2), smooth=True, wrap=False)
    G.pivots = [('Band_grandfather_clock_Pendulum', F.build_obj('pend_tmp', Gp), (0.0, -0.11, 1.52))]

# ---------------------------------------------------------------- cabinets
def glazed_case(G, M, W, D, z0, z1, doors=2):
    """the glazed upper (or whole) case: sides, back, glass doors in thin mahogany frames"""
    case(G, M, W, D, z0, z1)
    dw = (W - 0.044) / doors
    for k in range(doors):
        x0 = -W / 2 + 0.022 + k * dw; x1 = x0 + dw
        for (a, b, c, d) in ((x0, x1, z0, z0 + 0.04), (x0, x1, z1 - 0.04, z1), (x0, x0 + 0.04, z0, z1), (x1 - 0.04, x1, z0, z1)):
            box(G, M['mahogany'], (a, -D - 0.006, c), (b, -D + 0.016, d), wa((1, 0, 0) if b - a > 0.1 else (0, 0, 1), wear=0.3), 0.003)
        glass_pane(G, M, x0 + 0.04, x1 - 0.04, z0 + 0.04, z1 - 0.04, -D + 0.004)
        knob(G, M['brass'], x1 - 0.03 if k == 0 else x0 + 0.03, -D - 0.006, (z0 + z1) / 2, 0.009)

def doll_cabinet(G, M, rnd):
    W, D = 1.18, 0.4
    box(G, M['mahogany'], (-W / 2, -D, 0.0), (W / 2, 0.0, 0.12), wa((1, 0, 0), wear=0.4), 0.006, 2)
    glazed_case(G, M, W, D - 0.02, 0.12, 1.9, 2)
    cornice(G, M['mahogany'], W - 0.02, D - 0.04, 1.9, 0.08, 0.025)
    import furn_wood4 as W4
    for k, z in enumerate((0.15, 0.73, 1.31)):
        box(G, M['mahogany'], (-W / 2 + 0.022, -D + 0.04, z - 0.02), (W / 2 - 0.022, -0.012, z), wa((1, 0, 0)), 0.002)
        n = (0, 1, 2)[k]                                                     # (three dolls: two on top, one with her quilt; a doll's trunk and a hatbox below)
        for i in range(n):
            x = (-0.28 + 0.56 * i if n == 2 else 0.12) + rnd.uniform(-0.04, 0.04)
            W4.seated_doll(G, M, (x, -0.2, z), (rnd.uniform(-0.15, 0.15), -1.0), rnd, 0.95, bonnet=rnd.random() < 0.3, frock=rnd.choice(['frockA', 'frockB', 'frockC', 'frockD']), lod=0.34)
        if k == 1: box(G, M['velvet'], (-0.42, -0.3, z), (-0.16, -0.1, z + 0.03), fa(rnd), 0.008)
        if k == 0:
            box(G, M['mahogany'], (-0.44, -0.3, z), (-0.16, -0.12, z + 0.14), wa((1, 0, 0), wear=0.5), 0.004)
            for xx in (-0.39, -0.21): box(G, M['brass'], (xx - 0.008, -0.302, z - 0.001), (xx + 0.008, -0.118, z + 0.142), ma(0.5), 0.0)
            G.add(lathe_bm([(0.0, 0.11), (0.85, 0.11), (0.9, 0.115), (1.0, 0.115)], (0.2, -0.2, z), (0.2, -0.2, z + 0.16), 16), M['hatbox'], fa(rnd), smooth=True, wrap=False)
            pillow(G, M['velvet'], (0.2, -0.2, z + 0.17), 0.16, 0.12, 0.03, rnd, n=4, sag=0.1)

def china_cabinet(G, M, rnd):
    W, D = 1.08, 0.4
    box(G, M['mahogany'], (-W / 2, -D, 0.0), (W / 2, 0.0, 0.08), wa((1, 0, 0), wear=0.4), 0.006, 2)
    case(G, M, W, D, 0.08, 0.9)
    for k, (x0, x1) in enumerate(((-W / 2 + 0.022, -0.003), (0.003, W / 2 - 0.022))):
        box(G, M['mahogany'], (x0, -D - 0.006, 0.09), (x1, -D + 0.016, 0.88), wa((0, 0, 1), wear=0.25), 0.003)
        box(G, M['mahogany'], (x0 + 0.05, -D - 0.012, 0.15), (x1 - 0.05, -D - 0.005, 0.82), wa((0, 0, 1)), 0.008, 2)
        knob(G, M['brass'], x1 - 0.03 if k == 0 else x0 + 0.03, -D - 0.006, 0.6, 0.009)
    box(G, M['mahogany'], (-W / 2 - 0.01, -D - 0.015, 0.9), (W / 2 + 0.01, 0.0, 0.93), wa((1, 0, 0), wear=0.3), 0.006, 2)
    glazed_case(G, M, W - 0.04, D - 0.12, 0.93, 1.92, 2)
    cornice(G, M['mahogany'], W - 0.06, D - 0.14, 1.92, 0.08, 0.02)
    for z in (1.25, 1.58):
        box(G, M['mahogany'], (-W / 2 + 0.04, -D + 0.14, z - 0.015), (W / 2 - 0.04, -0.012, z), wa((1, 0, 0)), 0.002)
    for z in (0.95, 1.25, 1.58):                                              # (plates on edge in their rails, cups in front)
        for i in range(4):
            x = -0.36 + 0.24 * i; c = Vector((x, -0.06, z + 0.11))
            bm = lathe_bm([(0.0, 0.0), (0.6, 0.095), (0.9, 0.105), (1.0, 0.1)], c + Vector((0, 0.004, 0)), c - Vector((0, 0.014, 0)), 14, (True, False))
            S.xform(bm, (-c.x, -c.y, -c.z)); S.xform(bm, (0, 0, 0), (-0.22, 0, 0)); S.xform(bm, tuple(c)); G.add(bm, M['chinaB' if i % 2 else 'china'], ma(), smooth=True, wrap=False)
        tube(G, M['brass'], [Vector((-W / 2 + 0.04, -0.12, z + 0.03)), Vector((W / 2 - 0.04, -0.12, z + 0.03))], 0.003, 4, ma())

def sideboard(G, M, rnd):
    W, D, zt = 1.6, 0.415, 0.87
    box(G, M['mahogany'], (-W / 2 + 0.02, -D + 0.02, 0.0), (W / 2 - 0.02, -0.012, 0.08), wa((1, 0, 0), wear=0.4), 0.006, 1)
    case(G, M, W - 0.04, D - 0.02, 0.08, zt)
    for (x0, x1) in ((-0.76, -0.36), (0.36, 0.76)):                          # (the pedestal cupboards)
        box(G, M['mahogany'], (x0, -D - 0.004, 0.09), (x1, -D + 0.016, zt - 0.01), wa((0, 0, 1), wear=0.25), 0.003)
        box(G, M['mahogany'], (x0 + 0.05, -D - 0.01, 0.15), (x1 - 0.05, -D - 0.004, zt - 0.07), wa((0, 0, 1)), 0.008, 2)
        knob(G, M['brass'], x1 - 0.04 if x0 < 0 else x0 + 0.04, -D - 0.004, 0.5, 0.01)
    for k, (z0, z1) in enumerate(((0.62, zt - 0.01), (0.36, 0.61), (0.09, 0.35))):   # (three drawers in the middle)
        box(G, M['mahogany'], (-0.355, -D - 0.004, z0), (0.355, -D + 0.016, z1), wa((1, 0, 0), wear=0.25), 0.003)
        for sx in (-1, 1): knob(G, M['brass'], sx * 0.18, -D - 0.004, (z0 + z1) / 2, 0.01)
    box(G, M['mahogany'], (-W / 2, -D, zt), (W / 2, 0.0, zt + 0.03), wa((1, 0, 0), wear=0.4), 0.008, 2)
    box(G, M['mahogany'], (-W / 2 + 0.02, -0.03, zt + 0.03), (W / 2 - 0.02, 0.0, 0.95), wa((1, 0, 0)), 0.006, 2)   # (the back gallery)
    drape(G, M['runner'], 16, 3, lambda u, v: Vector((-0.65 + 1.3 * u, -0.08 - 0.26 * v, zt + 0.031)), fa(rnd, 3, 3), out=lambda q: Vector((0, 0, 1)))
    c = Vector((0.3, -0.21, zt + 0.032))                                      # (a silver tray, a tea caddy)
    G.add(lathe_bm([(0.0, 0.0), (0.85, 0.15), (0.95, 0.16), (1.0, 0.17)], c, c + Vector((0, 0, 0.018)), 22), M['silver'], ma(0.5), smooth=True, wrap=False)
    box(G, M['ebony'], (-0.45, -0.25, zt + 0.031), (-0.33, -0.15, zt + 0.031 + 0.035), wa(), 0.003)

def hall_bench(G, M, rnd):
    W, D, zs = 1.18, 0.4, 0.4
    for sx in (-1, 1):
        for y in (-D + 0.04, -0.04): turned(G, M['mahogany'], [(0.0, 0.02), (0.1, 0.017), (0.3, 0.024), (0.6, 0.02), (0.85, 0.026), (1.0, 0.026)], (sx * (W / 2 - 0.05), y, 0.0), (sx * (W / 2 - 0.05), y, zs), 10, attrs=wa((0, 0, 1)))
    box(G, M['mahogany'], (-W / 2, -D, zs - 0.07), (W / 2, 0.0, zs), wa((1, 0, 0), wear=0.3), 0.006, 2)
    for y in (-D + 0.04, -0.04): box(G, M['mahogany'], (-W / 2 + 0.05, y - 0.012, 0.1), (W / 2 - 0.05, y + 0.012, 0.13), wa((1, 0, 0)), 0.003)
    pillow(G, M['velvet'], (0.0, -D / 2, zs + 0.035), W - 0.02, D - 0.02, 0.08, rnd, n=8, sag=0.3)
    for i in range(5):                                                        # (buttons)
        for j in range(2):
            x = -0.45 + 0.225 * i; y = -D / 2 + (j - 0.5) * 0.18; G.add(lathe_bm([(0.0, 0.009), (1.0, 0.0)], (x, y, zs + 0.065), (x, y, zs + 0.072), 8), M['velvet'], ma(), smooth=True, wrap=False)

def gilt_mirror(G, M, rnd):
    zc, rx, rz, n = 1.445, 0.27, 0.38, 64
    pts = [(rx * math.cos(a), zc + rz * math.sin(a)) for a in np.linspace(0, 2 * math.pi, n + 1)[:-1]]
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new((x, -0.012, z)) for x, z in pts]); f.normal_update()
    if f.normal.y > 0: f.normal_flip()
    bmesh.ops.triangulate(bm, faces=[f]); G.add(bm, M['mirror'], attrs_of(lambda q: (q[0], q[2], 0.0), 0.5), wrap=False)
    ring = []                                                                  # (the oval frame: a swept moulding with a bead along its sight edge)
    for k in range(n + 1):
        a = 2 * math.pi * k / n; o = Vector((math.cos(a) / rx, 0, math.sin(a) / rz)).normalized()
        ring.append((Vector((rx * math.cos(a), 0, zc + rz * math.sin(a))), o))
    prof = [(-0.004, 0.012), (-0.004, 0.02), (0.002, 0.028), (0.008, 0.026), (0.014, 0.035), (0.03, 0.046), (0.046, 0.04), (0.056, 0.026), (0.06, 0.012), (0.06, 0.0)]
    rows = [[p + o * w + Vector((0, -h, 0)) for p, o in ring] for w, h in prof]
    grid_surface(G, M['gilt'], rows, ma(0.4), flip_to=lambda q: Vector((q.x, -1.0, q.z - zc)))
    # the crest: a scallop shell fanned up from the frame's top, a C-scroll curling away each side
    h0 = Vector((0.0, -0.028, zc + rz + 0.035)); R = 0.11
    rows = []
    for r in np.linspace(0.008, R, 7):
        row = []
        for a in np.linspace(0.12 * math.pi, 0.88 * math.pi, 37):
            rib = 0.5 + 0.5 * math.cos(22 * (a - math.pi / 2))
            row.append(h0 + Vector((r * math.cos(a), -0.022 * math.sin(math.pi * r / R * 0.9) * (0.65 + 0.35 * rib) * (r / R) ** 0.3, r * math.sin(a) * (0.97 + 0.03 * rib))))
        rows.append(row)
    grid_surface(G, M['gilt'], rows, ma(0.5), flip_to=lambda q: Vector((0, -1, 0)))
    for sx in (-1, 1):
        sc = Vector((sx * 0.13, -0.03, zc + rz + 0.02)); pts = []
        for th in np.linspace(0, 2.4 * math.pi, 22):
            rr = 0.04 * (1 - th / (2.9 * math.pi)); pts.append(sc + Vector((-sx * rr * math.cos(th + 0.3), 0, rr * math.sin(th + 0.3))))
        pts.insert(0, Vector((sx * 0.06, -0.03, zc + rz + 0.04)))
        tube(G, M['gilt'], pts, 0.009, 6, ma(0.5))
        for k in range(3):                                                    # (leaves trailing down the frame's shoulders)
            a = math.pi / 2 - sx * (0.45 + 0.17 * k); p = Vector((rx * 1.08 * math.cos(a), -0.035, zc + rz * 1.1 * math.sin(a)))
            tng = Vector((-math.sin(a) * rx, 0, math.cos(a) * rz)).normalized() * -sx
            G.add(lathe_bm([(0.0, 0.0), (0.35, 0.016), (0.7, 0.012), (1.0, 0.0)], p, p + tng * 0.07, 6), M['gilt'], ma(0.5), smooth=True, wrap=False)

def umbrella_stand(G, M, rnd):
    c = Vector((0.0, -0.17, 0.0))
    G.add(lathe_bm([(0.0, 0.1), (0.05, 0.12), (0.15, 0.115), (0.5, 0.11), (0.85, 0.12), (0.95, 0.135), (1.0, 0.13)], c, c + Vector((0, 0, 0.58)), 18, (True, False)), M['majolica'], ma(0.3), smooth=True, wrap=False)
    for k, (dx, dy, lean, mk) in enumerate(((-0.04, 0.03, 0.12, 'umbrella'), (0.04, -0.02, -0.1, 'umbrella2'))):
        b = c + Vector((dx, dy, 0.05)); t = b + Vector((math.sin(lean) * 0.85, 0.0, math.cos(lean) * 0.85))
        G.add(lathe_bm([(0.0, 0.004), (0.15, 0.02), (0.6, 0.042), (0.85, 0.035), (0.93, 0.012), (1.0, 0.006)], b, t, 8), M[mk], fa(rnd, 3, 3), smooth=True, wrap=False)
        hk = [t + Vector((0.035 * (1 - math.cos(a)) * (1 if k else -1), 0, 0.035 * math.sin(a))) for a in np.linspace(0, math.pi, 7)]
        tube(G, M['mahogany'], [t] + hk, 0.009, 5, wa())
    tube(G, M['ebony'], [c + Vector((0.0, 0.05, 0.05)), c + Vector((0.07, 0.04, 0.92))], 0.011, 6, wa((0, 0, 1)))
    G.add(lathe_bm([(0.0, 0.016), (0.6, 0.022), (1.0, 0.0)], c + Vector((0.07, 0.04, 0.92)), c + Vector((0.075, 0.04, 0.95)), 10), M['silver'], ma(0.5), smooth=True, wrap=False)

BANDS = [('Band_console', 'console', console, 1024), ('Band_console_mirror', 'console_mirror', console_mirror, 1024),
         ('Band_grandfather_clock', 'grandfather_clock', grandfather_clock, 2048), ('Band_doll_cabinet', 'doll_cabinet', doll_cabinet, 2048),
         ('Band_china_cabinet', 'china_cabinet', china_cabinet, 2048), ('Band_sideboard', 'sideboard', sideboard, 2048), ('Band_hall_bench', 'hall_bench', hall_bench, 1024),
         ('Band_gilt_mirror', 'gilt_mirror', gilt_mirror, 1024), ('Band_umbrella_stand', 'umbrella_stand', umbrella_stand, 1024)]
