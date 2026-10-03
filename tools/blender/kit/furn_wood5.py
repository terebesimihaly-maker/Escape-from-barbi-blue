# Escape from Barbi Blue: the nursery's wall pieces (WP2.5a, wood style; build spec B6), built by furn_wood.py. Each stands with its
# back on the wall (y = 0, the room toward -y), its origin on the wall plane at floor level, and reaches at most 0.44 m into the room.
#   Band_dresser          a painted pine chest of drawers (two short, three long, turned knobs), a lace runner, a hairbrush and a framed
#                         photograph on top; the night light stands at Band_dresser_fix
#   Band_toy_shelf        open shelves full of toys: seated dolls, bricks, a drum, a boat, a jack-in-the-box, picture books
#   Band_changing_table   a table with a gallery rail round its padded top, a shelf of folded napkins and an enamel bowl below
#   Band_washstand        a child's washstand: a marble top, a basin with its jug, a towel on the side rail
#   Band_radiator         a cast-iron column radiator on its feet, its pipes into the wall and floor, a wheel valve
#   Band_bookshelf_low    a low bookcase of children's books, some leaning, one lying flat
#   Band_puppet_theatre   a puppet theatre: a painted proscenium, red curtains drawn back, a glove puppet hanging over the stage
#   Band_night_stand      a bedside cupboard: a drawer, a door, a candlestick and a book on it
#   Band_wall_clock       a drop-dial school clock high on the wall (z 1.75)
#   Band_kids_frames_v0..2  framed nursery pictures at 1.25: an animal print, a child's drawing, an alphabet sampler
#   Band_coat_hooks       a hook rail at 1.7 m with children's coats and a hat hanging, down to 0.75
#   Band_doll_shelf       a shelf on brackets, its top at 1.45 m: the game seats its dolls there (Band_doll_shelf_SOCKET_0/1 at +-0.3)
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise
import kitlib
import surfaces2 as S
import doors as Dr
import furnlib as F
from furnlib import wa, ma, turned, box, drape, pillow, grid_surface
from doors import lathe_bm, tube, block, plate, attrs_of
from surfaces2 import sep, comb, finish
from kitlib import TMP, lin

def fa(rnd, sx=1.0, sy=1.0):
    o = Vector((rnd.uniform(-9, 9), rnd.uniform(-9, 9), 0)); return attrs_of(lambda q, o=o: (q[0] * sx + o.x, q[1] * sy + o.y, q[2]), rnd.random())

def knob(G, mat, x, y, z, r=0.014, L=0.016):
    G.add(lathe_bm([(0.0, r * 0.55), (0.25, r * 0.5), (0.5, r * 0.75), (0.8, r), (0.95, r * 0.8), (1.0, 0.0)], (x, y, z), (x, y - L, z), 10), mat, ma(0.6), smooth=True, wrap=False)

def drawer(G, M, x0, x1, z0, z1, yf, knobs=1, r=0.013):
    """a drawer: its front a hair proud of the carcass, a 2 mm gap round it (dark behind), its edges eased, knobs"""
    box(G, M['paint'], (x0 + 0.002, yf - 0.006, z0 + 0.002), (x1 - 0.002, yf + 0.012, z1 - 0.002), wa((1, 0, 0), wear=0.25), 0.003, 1)
    G.add(Dr.quad_bm([(x0, yf + 0.01, z0), (x1, yf + 0.01, z0), (x1, yf + 0.01, z1), (x0, yf + 0.01, z1)], (0, -1, 0)), M['dark'], ma(), wrap=False)
    for k in range(knobs):
        knob(G, M['knob'], x0 + (x1 - x0) * (k + 1) / (knobs + 1), yf - 0.006, (z0 + z1) / 2, r)

def carcass(G, M, W, D, z0, z1, t=0.02, back=True, top=True):
    """sides, back and bottom boards of a case W wide, D deep (y -D .. 0), z0 .. z1"""
    for sx in (-1, 1): box(G, M['paint'], (sx * W / 2 - (t if sx > 0 else 0), -D, z0), (sx * W / 2 + (0 if sx > 0 else t), 0.0, z1), wa((0, 0, 1)), 0.003)
    if back: box(G, M['back'], (-W / 2 + t, -0.012, z0), (W / 2 - t, 0.0, z1), wa((0, 0, 1)), 0.0)
    box(G, M['paint'], (-W / 2 + t, -D, z0), (W / 2 - t, -0.012, z0 + t), wa((1, 0, 0)), 0.0)

def moulded_top(G, mat, W, D, z, th=0.024, over=0.015):
    """a top board with a rounded (thumbnail) front and side edges"""
    prof = [(0.0, 0.0), (0.0, th * 0.35), (0.003, th * 0.75), (0.008, th * 0.95), (0.014, th)]
    rows = []
    for d, h in prof:
        rows.append([Vector((-W / 2 - over + d, 0.0, z + h)), Vector((-W / 2 - over + d, -D - over + d, z + h)), Vector((W / 2 + over - d, -D - over + d, z + h)), Vector((W / 2 + over - d, 0.0, z + h))])
    F.grid_surface(G, mat, rows, wa((1, 0, 0), wear=0.3), flip_to=lambda q: Vector((q.x, q.y + D / 2, 0.3)))
    a = [Vector((-W / 2 - over + 0.014, 0.0, z + th)), Vector((-W / 2 - over + 0.014, -D - over + 0.014, z + th)), Vector((W / 2 + over - 0.014, -D - over + 0.014, z + th)), Vector((W / 2 + over - 0.014, 0.0, z + th))]
    G.add(Dr.quad_bm([tuple(a[0]), tuple(a[1]), tuple(a[2]), tuple(a[3])], (0, 0, 1)), mat, wa((1, 0, 0), wear=0.35), wrap=False)
    G.add(Dr.quad_bm([(-W / 2 - over, 0.0, z), (W / 2 + over, 0.0, z), (W / 2 + over, -D - over, z), (-W / 2 - over, -D - over, z)], (0, 0, -1)), mat, wa((1, 0, 0)), wrap=False)

def plinth(G, mat, W, D, h=0.07, inset=0.0):
    box(G, mat, (-W / 2 + inset, -D + inset, 0.0), (W / 2 - inset, -0.012, h), wa((1, 0, 0), wear=0.4), 0.004, 1)

def book(G, M, rnd, x, z, th, h, d, lean=0.0, flat=False, y0=-0.01):
    """a book: covers, the page block a little in, its spine rounded"""
    mk = rnd.choice(['bookA', 'bookB', 'bookC', 'bookD'])
    bm = block((-th / 2, -d, 0.0), (th / 2, 0.0, h), 0.0015, 1)
    if flat: S.xform(bm, (0, 0, 0), (0, math.pi / 2, 0)); S.xform(bm, (x, y0, z + th / 2))
    else: S.xform(bm, (0, 0, 0), (0, lean, 0)); S.xform(bm, (x, y0, z))
    G.add(bm, M[mk], fa(rnd, 4, 4), wrap=False)

# ================================================================ the dresser
def dresser(G, M, rnd):
    W, D = 0.96, 0.41; plinth(G, M['paint'], W - 0.02, D - 0.01, 0.075); carcass(G, M, W, D, 0.075, 0.915)
    yf = -D
    rows = [(0.08, 0.27), (0.275, 0.465), (0.47, 0.66), (0.665, 0.905)]
    for k, (z0, z1) in enumerate(rows):
        if k < 3: drawer(G, M, -W / 2 + 0.02, W / 2 - 0.02, z0, z1, yf, 2)
        else:
            for (x0, x1) in ((-W / 2 + 0.02, -0.005), (0.005, W / 2 - 0.02)): drawer(G, M, x0, x1, z0, z1, yf, 1)
    box(G, M['paint'], (-0.005, yf, 0.665), (0.005, yf + 0.02, 0.905), wa((0, 0, 1)), 0.0)
    moulded_top(G, M['paint'], W, D, 0.915, 0.024, 0.012)
    zt = 0.939
    drape(G, M['lace'], 16, 4, lambda u, v: Vector((-0.4 + 0.8 * u, -0.06 - 0.3 * v, zt + 0.001 + 0.0015 * math.sin(u * 20 + v * 6))), attrs_of(lambda q: (q[0] * 4, q[1] * 4, 0.0), 0.5), out=lambda q: Vector((0, 0, 1)))
    for sx in (-1, 1):                                                      # (the lace's ends hanging over the sides)
        drape(G, M['lace'], 4, 4, lambda u, v, sx=sx: Vector((sx * (0.4 + 0.012 * math.sin(v * 1.5)), -0.06 - 0.3 * u, zt - 0.11 * v)), attrs_of(lambda q: (q[0] * 4, q[1] * 4, 0.0), 0.5), out=lambda q, sx=sx: Vector((sx, 0, 0)))
    hb = Vector((-0.22, -0.2, zt + 0.003))                                  # (a hairbrush, its bristles down; a framed photograph)
    bm = block((-0.08, -0.03, 0.012), (0.08, 0.03, 0.026), 0.008, 2); S.xform(bm, (0, 0, 0), (0, 0, 0.5)); S.xform(bm, tuple(hb)); G.add(bm, M['brush'], fa(rnd), wrap=False)
    bm = block((-0.06, -0.025, 0.0), (0.06, 0.025, 0.012), 0.002, 1); S.xform(bm, (0, 0, 0), (0, 0, 0.5)); S.xform(bm, tuple(hb)); G.add(bm, M['bristle'], fa(rnd), wrap=False)
    tb = Vector((-0.02, -0.12, zt))                                        # (a little trinket box, a framed photograph lying face up)
    box(G, M['frame'], tuple(tb + Vector((-0.045, -0.03, 0.0))), tuple(tb + Vector((0.045, 0.03, 0.009))), fa(rnd), 0.003)
    box(G, M['knob'], tuple(tb + Vector((-0.047, -0.032, 0.009))), tuple(tb + Vector((0.047, 0.032, 0.012))), ma(0.5), 0.002)
    G.sockets = [('Band_dresser_fix', (0.3, -0.21, zt))]

# ================================================================ the toy shelf
def toy_shelf(G, M, rnd):
    W, D, H = 1.2, 0.3, 1.6; t = 0.022
    for sx in (-1, 1):
        x = sx * (W / 2 - t / 2)
        bm = block((x - t / 2, -D, 0.0), (x + t / 2, 0.0, H), 0.004, 1)
        for v in bm.verts:                                                  # (the sides shaped: a curve cut out at the top front)
            if v.co.z > H - 0.25 and v.co.y < -0.15: v.co.y = -0.15 - (D - 0.15) * max(0.0, 1 - (v.co.z - (H - 0.25)) / 0.25)
        G.add(bm, M['paint'], wa((0, 0, 1), wear=0.2), wrap=False)
    box(G, M['back'], (-W / 2 + t, -0.012, 0.0), (W / 2 - t, 0.0, H), wa((0, 0, 1)), 0.0)
    shelves = [0.06, 0.42, 0.8, 1.18, 1.56]
    for z in shelves: box(G, M['paint'], (-W / 2 + t, -D + 0.005, z - 0.02), (W / 2 - t, -0.012, z), wa((1, 0, 0), wear=0.3), 0.003)
    box(G, M['paint'], (-W / 2 + t, -D, 0.0), (W / 2 - t, -D + 0.02, 0.06), wa((1, 0, 0), wear=0.4), 0.003)
    # the toys, shelf by shelf
    import furn_wood4 as W4
    DM = W4.doll_materials('band_toyshelf')
    for k, v in DM.items(): M.setdefault(k, v)
    W4.seated_doll(G, M, (-0.38, -0.12, 1.18), (0.0, -1.0), rnd, 0.82, frock='frockA', lod=0.5)
    box(G, M['frockC'], (0.0, -0.2, 1.18), (0.22, -0.04, 1.2), fa(rnd), 0.006)   # (a folded doll's quilt)
    W4.teddy(G, M, (0.4, -0.13, 1.18), (-0.2, -1.0), rnd, 0.9)
    G.add(lathe_bm([(0.0, 0.11), (0.1, 0.12), (0.9, 0.12), (1.0, 0.11)], (-0.33, -0.15, 0.8), (-0.33, -0.15, 0.95), 18, (True, True)), M['drum'], fa(rnd, 6, 6), smooth=True, wrap=False)
    for k in range(6):                                                      # (the drum's cords, zig-zag)
        a0, a1 = math.pi * 2 * k / 6, math.pi * 2 * (k + 0.5) / 6
        tube(G, M['cord'], [Vector((-0.33 + 0.122 * math.cos(a0), -0.15 + 0.122 * math.sin(a0), 0.81)), Vector((-0.33 + 0.122 * math.cos(a1), -0.15 + 0.122 * math.sin(a1), 0.94))], 0.0015, 4, ma())
    bx = Vector((0.05, -0.15, 0.8))                                         # (a jack-in-the-box, its lid open, the clown up)
    box(G, M['jbox'], tuple(bx + Vector((-0.07, -0.07, 0.0))), tuple(bx + Vector((0.07, 0.07, 0.14))), wa(), 0.003)
    bm = block((-0.07, 0.0, 0.0), (0.07, 0.14, 0.008), 0.002, 1); S.xform(bm, (0, 0, 0), (-1.9, 0, 0)); S.xform(bm, tuple(bx + Vector((0, 0.07, 0.14)))); G.add(bm, M['jbox'], wa(), wrap=False)
    pts = [bx + Vector((0.008 * math.sin(i), 0.008 * math.cos(i), 0.14 + 0.012 * i)) for i in range(12)]; tube(G, M['knob'], pts, 0.004, 5, ma())
    G.add(lathe_bm([(0.0, 0.0), (0.4, 0.032), (0.8, 0.03), (1.0, 0.0)], bx + Vector((0, 0, 0.27)), bx + Vector((0, 0, 0.34)), 10), M['bisque'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.03), (1.0, 0.0)], bx + Vector((0, 0, 0.33)), bx + Vector((0, 0, 0.39)), 8), M['frockA'], fa(rnd), smooth=True, wrap=False)
    bt = Vector((0.36, -0.15, 0.8))                                         # (a toy boat: hull, mast, a sail)
    bm = lathe_bm([(0.0, 0.0), (0.2, 0.035), (0.6, 0.04), (0.9, 0.03), (1.0, 0.0)], bt - Vector((0.13, 0, -0.035)), bt + Vector((0.13, 0, 0.035)), 10)
    for v in bm.verts: v.co.z = max(v.co.z, bt.z + 0.035) if v.co.z > bt.z + 0.035 else v.co.z
    G.add(bm, M['boat'], fa(rnd), smooth=True, wrap=False)
    tube(G, M['knob'], [bt + Vector((0, 0, 0.07)), bt + Vector((0, 0, 0.3))], 0.004, 5, ma())
    G.add(Dr.quad_bm([tuple(bt + Vector((0.005, 0, 0.09))), tuple(bt + Vector((0.12, 0, 0.09))), tuple(bt + Vector((0.005, 0, 0.29))), tuple(bt + Vector((0.005, 0, 0.29)))][:3] + [tuple(bt + Vector((0.006, 0, 0.29)))], (0, -1, 0)), M['sail'], fa(rnd), wrap=False)
    x = -0.55                                                               # (picture books, standing and leaning; bricks)
    while x < -0.05:
        th = rnd.uniform(0.012, 0.03); h = rnd.uniform(0.2, 0.3); lean = rnd.choice([0.0, 0.0, 0.0, 0.25])
        book(G, M, rnd, x + th / 2, 0.42, th, h, rnd.uniform(0.17, 0.22), lean); x += th + (0.04 if lean else 0.002)
    for k in range(10):
        s = rnd.uniform(0.045, 0.06); c = Vector((rnd.uniform(0.05, 0.5), rnd.uniform(-0.22, -0.06), 0.42 + s / 2 + (s if k > 6 else 0)))
        bm = block(Vector((-s, -s, -s)) / 2, Vector((s, s, s)) / 2, 0.003, 1); S.xform(bm, (0, 0, 0), (0, 0, rnd.uniform(0, 3))); S.xform(bm, tuple(c)); G.add(bm, M['bricks'], wa(), wrap=False)
    for k in range(3): pillow(G, M[('frockB', 'frockC', 'frockD')[k]], (-0.35 + 0.33 * k, -0.15, 0.06 + 0.045), 0.26, 0.2, 0.09, rnd, n=4, sag=0.2)   # (folded dressing-up clothes)

# ================================================================ changing table, washstand, night stand
def changing_table(G, M, rnd):
    W, D = 0.88, 0.43; zt = 0.82
    for sx in (-1, 1):
        for y in (-D + 0.03, -0.03): turned(G, M['paint'], [(0.0, 0.018), (0.1, 0.016), (0.5, 0.019), (0.9, 0.017), (1.0, 0.02)], (sx * (W / 2 - 0.03), y, 0.0), (sx * (W / 2 - 0.03), y, zt), 8, attrs=wa((0, 0, 1)))
    box(G, M['paint'], (-W / 2, -D, zt - 0.08), (W / 2, 0.0, zt), wa((1, 0, 0)), 0.003)
    box(G, M['paint'], (-W / 2 + 0.03, -D + 0.03, 0.18), (W / 2 - 0.03, -0.03, 0.2), wa((1, 0, 0)), 0.003)
    for (a, b, c, d) in ((-W / 2, W / 2, -0.02, 0.0), (-W / 2, -W / 2 + 0.02, -D, 0.0), (W / 2 - 0.02, W / 2, -D, 0.0)):   # (the gallery on three sides)
        box(G, M['paint'], (a, c, zt + 0.1), (b, d, zt + 0.13), wa((1, 0, 0) if b - a > 0.1 else (0, 1, 0), wear=0.4), 0.004)
        n = int(max(b - a, d - c) / 0.06)
        for k in range(1, n):
            p = Vector(((a + b) / 2, (c + d) / 2, 0)) + (Vector((a + (b - a) * k / n - (a + b) / 2, 0, 0)) if b - a > 0.1 else Vector((0, c + (d - c) * k / n - (c + d) / 2, 0)))
            tube(G, M['paint'], [p + Vector((0, 0, zt)), p + Vector((0, 0, zt + 0.1))], 0.006, 5, wa((0, 0, 1)))
    pillow(G, M['pad'], (0.0, -D / 2 - 0.005, zt + 0.03), W - 0.06, D - 0.04, 0.06, rnd, n=6, sag=0.3)
    for k in range(4): pillow(G, M['napkin'], (-0.25 + 0.02 * k, -0.2, 0.2 + 0.015 + 0.03 * k), 0.26, 0.24, 0.028, rnd, n=3, sag=0.0)
    bc = Vector((0.2, -0.2, 0.2))
    G.add(lathe_bm([(0.0, 0.07), (0.4, 0.11), (0.85, 0.15), (1.0, 0.155)], bc, bc + Vector((0, 0, 0.09)), 22, (True, False)), M['enamel'], ma(), smooth=True, wrap=False)
    tube(G, M['enamel'], [bc + Vector((0.155 * math.cos(a), 0.155 * math.sin(a), 0.09)) for a in np.linspace(0, 2 * math.pi, 23)], 0.005, 5, ma())

def washstand(G, M, rnd):
    W, D = 0.84, 0.43; zt = 0.62
    for sx in (-1, 1):
        for y in (-D + 0.03, -0.03): turned(G, M['paint'], [(0.0, 0.017), (0.1, 0.015), (0.5, 0.018), (0.9, 0.016), (1.0, 0.019)], (sx * (W / 2 - 0.03), y, 0.0), (sx * (W / 2 - 0.03), y, zt - 0.025), 8, attrs=wa((0, 0, 1)))
    box(G, M['paint'], (-W / 2 + 0.01, -D + 0.01, zt - 0.1), (W / 2 - 0.01, -0.01, zt - 0.025), wa((1, 0, 0)), 0.003)
    box(G, M['paint'], (-W / 2 + 0.03, -D + 0.03, 0.12), (W / 2 - 0.03, -0.03, 0.14), wa((1, 0, 0)), 0.003)
    box(G, M['marble'], (-W / 2, -D, zt - 0.025), (W / 2, 0.0, zt), ma(), 0.005, 2)
    bc = Vector((0.0, -0.2, zt))
    G.add(lathe_bm([(0.0, 0.06), (0.3, 0.1), (0.7, 0.15), (0.9, 0.17), (1.0, 0.175)], bc, bc + Vector((0, 0, 0.09)), 22, (True, False)), M['china'], ma(), smooth=True, wrap=False)
    jc = bc + Vector((0, 0, 0.012))
    G.add(lathe_bm([(0.0, 0.045), (0.25, 0.065), (0.5, 0.068), (0.75, 0.048), (0.88, 0.04), (1.0, 0.052)], jc, jc + Vector((0, 0, 0.168)), 18, (True, False)), M['china'], ma(), smooth=True, wrap=False)
    tube(G, M['china'], [jc + Vector((-0.05, 0, 0.15)), jc + Vector((-0.095, 0, 0.13)), jc + Vector((-0.095, 0, 0.07)), jc + Vector((-0.055, 0, 0.045))], 0.008, 6, ma())
    box(G, M['paint'], (-W / 2 - 0.0, -0.04, zt + 0.0), (-W / 2 + 0.02, 0.0, 0.8), wa((0, 0, 1)), 0.003)
    box(G, M['paint'], (W / 2 - 0.02, -0.04, zt + 0.0), (W / 2, 0.0, 0.8), wa((0, 0, 1)), 0.003)
    tube(G, M['paint'], [Vector((-W / 2 + 0.01, -0.03, 0.775)), Vector((W / 2 - 0.01, -0.03, 0.775))], 0.008, 6, wa((1, 0, 0)))
    drape(G, M['towel'], 8, 6, lambda u, v: Vector((-0.35 + 0.28 * u, -0.03 - 0.012 * math.sin(math.pi * v) - 0.008, 0.775 - 0.14 * v - 0.01 * math.sin(6 * u + v))), fa(rnd, 2, 2), out=lambda q: Vector((0, -1, 0)))

def night_stand(G, M, rnd):
    W, D = 0.44, 0.38; plinth(G, M['paint'], W - 0.01, D - 0.005, 0.06); carcass(G, M, W, D, 0.06, 0.57)
    drawer(G, M, -W / 2 + 0.02, W / 2 - 0.02, 0.46, 0.565, -D, 1, 0.011)
    box(G, M['paint'], (-W / 2 + 0.02, -D - 0.006, 0.065), (W / 2 - 0.02, -D + 0.012, 0.455), wa((0, 0, 1), wear=0.2), 0.003)   # (the door, its fielded panel)
    box(G, M['paint'], (-W / 2 + 0.06, -D - 0.011, 0.11), (W / 2 - 0.06, -D - 0.005, 0.41), wa((0, 0, 1)), 0.006, 2)
    knob(G, M['knob'], W / 2 - 0.05, -D - 0.006, 0.3, 0.011)
    moulded_top(G, M['paint'], W - 0.01, D - 0.005, 0.565, 0.02, 0.006)
    bm = block((-0.07, -0.1, 0.0), (0.07, 0.1, 0.025), 0.002, 1); S.xform(bm, (0, 0, 0), (0, 0, -0.25)); S.xform(bm, (-0.08, -0.2, 0.59)); G.add(bm, M['bookB'], fa(rnd, 4, 4), wrap=False)

# ================================================================ radiator, bookshelf
def radiator(G, M, rnd):
    W, D, H = 0.76, 0.11, 0.645; n = 13; cw = W / n
    for k in range(n):                                                      # (sections: two columns each, a waist, joined top and bottom)
        x = -W / 2 + cw * (k + 0.5)
        for y in (-0.035, -0.08):
            turned(G, M['iron'], [(0.0, 0.0), (0.04, 0.02), (0.12, 0.022), (0.2, 0.017), (0.8, 0.017), (0.88, 0.022), (0.96, 0.02), (1.0, 0.0)], (x, y, 0.07), (x, y, H), 6, (False, False), ma())
        box(G, M['iron'], (x - cw / 2 + 0.002, -0.095, 0.09), (x + cw / 2 - 0.002, -0.02, 0.115), ma(), 0.004)
        box(G, M['iron'], (x - cw / 2 + 0.002, -0.095, H - 0.045), (x + cw / 2 - 0.002, -0.02, H - 0.02), ma(), 0.004)
    for sx in (-1, 1):
        box(G, M['iron'], (sx * (W / 2 - 0.04) - 0.025, -0.11, 0.0), (sx * (W / 2 - 0.04) + 0.025, -0.01, 0.075), ma(), 0.005)
    tube(G, M['pipe'], [Vector((-W / 2 + 0.02, -0.055, 0.1)), Vector((-W / 2 - 0.0, -0.055, 0.1)), Vector((-W / 2 - 0.0, -0.055, 0.0))], 0.012, 8, ma())
    tube(G, M['pipe'], [Vector((W / 2 - 0.02, -0.055, 0.6)), Vector((W / 2 + 0.0, -0.055, 0.6)), Vector((W / 2 + 0.0, -0.055, 0.25)), Vector((W / 2, 0.0, 0.25))], 0.012, 8, ma())
    vc = Vector((W / 2 + 0.0, -0.055, 0.5))
    G.add(lathe_bm([(0.0, 0.018), (1.0, 0.016)], vc - Vector((0, 0, 0.03)), vc + Vector((0, 0, 0.04)), 10), M['brass'], ma(), smooth=True, wrap=False)
    tube(G, M['brass'], [vc + Vector((0.032 * math.cos(a), 0.032 * math.sin(a), 0.05)) for a in np.linspace(0, 2 * math.pi, 13)], 0.004, 5, ma(0.5))

def bookshelf_low(G, M, rnd):
    W, D, H = 0.9, 0.32, 1.1
    plinth(G, M['paint'], W, D, 0.07); carcass(G, M, W, D, 0.07, H - 0.025)
    moulded_top(G, M['paint'], W - 0.016, D - 0.008, H - 0.025, 0.022, 0.0)
    for z in (0.09, 0.42, 0.75):
        box(G, M['paint'], (-W / 2 + 0.02, -D + 0.005, z - 0.02), (W / 2 - 0.02, -0.012, z), wa((1, 0, 0), wear=0.25), 0.003)
        x = -W / 2 + 0.03; lim = 0.32 if z < 0.5 else 0.3
        while x < W / 2 - 0.05:
            th = rnd.uniform(0.014, 0.038); h = rnd.uniform(0.18, 0.29); lean = 0.22 if rnd.random() < 0.08 else 0.0
            if rnd.random() < 0.05 and x < W / 2 - 0.3:                     # (one lying flat)
                book(G, M, rnd, x + 0.12, z, 0.03, 0.24, 0.17, flat=True, y0=-0.02); x += 0.26; continue
            book(G, M, rnd, x + th / 2, z, th, min(h, lim), rnd.uniform(0.16, 0.22), lean, y0=-0.015); x += th + (0.05 if lean else 0.0015)

# ================================================================ the puppet theatre
def puppet_theatre(G, M, rnd):
    W, D, H = 1.18, 0.38, 1.6; t = 0.02
    for sx in (-1, 1): box(G, M['paint'], (sx * W / 2 - (t if sx > 0 else 0), -D, 0.0), (sx * W / 2 + (0 if sx > 0 else t), 0.0, H - 0.03), wa((0, 0, 1)), 0.003)
    box(G, M['front'], (-W / 2, -D, 0.0), (W / 2, -D + t, 0.85), attrs_of(lambda q: ((q[0] + W / 2) / W, q[2] / 1.6, 0.0), 0.5), 0.003)   # (the painted front below the stage)
    box(G, M['paint'], (-W / 2 - 0.01, -D - 0.03, 0.85), (W / 2 + 0.01, -D + t, 0.88), wa((1, 0, 0), wear=0.5), 0.004)        # (the play board)
    # the proscenium above: a board with an arched opening, a pediment, painted
    ow, oz0, oz1 = 0.8, 0.88, 1.38; pts = []
    for k in range(17):
        a = math.pi * k / 16; pts.append((ow / 2 * math.cos(a), oz1 - 0.12 + 0.12 * math.sin(a)))
    holes = [(-ow / 2, ow / 2, oz0, oz1 - 0.12)]
    for (a, b, c, d) in ((-W / 2, -ow / 2, oz0, H - 0.03), (ow / 2, W / 2, oz0, H - 0.03)):
        box(G, M['front'], (a, -D, c), (b, -D + t, d), attrs_of(lambda q: ((q[0] + W / 2) / W, q[2] / 1.6, 0.0), 0.5), 0.0)
    bm = bmesh.new(); top = [bm.verts.new((x, -D, z)) for x, z in pts]; up = [bm.verts.new((x, -D, H - 0.03)) for x, z in pts]
    for k in range(16): f = bm.faces.new((top[k], top[k + 1], up[k + 1], up[k])); f.normal_update(); (f.normal_flip() if f.normal.y > 0 else None)
    G.add(bm, M['front'], attrs_of(lambda q: ((q[0] + W / 2) / W, q[2] / 1.6, 0.0), 0.5), wrap=False)
    box(G, M['paint'], (-W / 2 - 0.01, -D - 0.02, H - 0.06), (W / 2 + 0.01, -D + t, H), wa((1, 0, 0)), 0.004)   # (the cornice)
    # the curtains, drawn back to the sides in swags; the backdrop
    for sx in (-1, 1):
        def cur(u, v, sx=sx):
            x = sx * (ow / 2 - 0.02 - 0.16 * u * (1 - 0.6 * math.sin(math.pi * v) * 0.0)) ; x = sx * (ow / 2 - 0.02) - sx * 0.16 * u * (1 - v * 0.5)
            return Vector((x, -D + t + 0.03 + 0.012 * math.sin(14 * u + 2 * v), oz1 - 0.1 - (oz1 - oz0 - 0.1) * v))
        drape(G, M['curtain'], 8, 8, cur, fa(rnd, 3, 3), out=lambda q: Vector((0, -1, 0)))
    box(G, M['backdrop'], (-ow / 2 - 0.05, -0.04, oz0), (ow / 2 + 0.05, -0.03, oz1), attrs_of(lambda q: ((q[0] + ow / 2) / ow, (q[2] - oz0) / (oz1 - oz0), 0.0), 0.5), 0.0)
    # a glove puppet (Punch) hanging over the play board
    pc = Vector((0.18, -D + 0.04, 0.86))
    def pup(u, v):
        a = 2 * math.pi * u; r = 0.045 + 0.02 * v
        return pc + Vector((r * math.cos(a), r * 0.6 * math.sin(a), 0.02 - 0.2 * v))
    drape(G, M['punch'], 10, 5, pup, fa(rnd, 3, 3), out=lambda q: Vector((q.x - pc.x, q.y - pc.y, 0)))
    hd = pc + Vector((0, -0.01, 0.07))
    G.add(lathe_bm([(0.0, 0.0), (0.3, 0.04), (0.7, 0.038), (1.0, 0.0)], hd - Vector((0, 0, 0.045)), hd + Vector((0, 0, 0.05)), 12), M['face'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.016), (1.0, 0.004)], hd + Vector((0, -0.03, 0.0)), hd + Vector((0.02, -0.065, -0.03)), 8), M['face'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.04), (0.6, 0.025), (1.0, 0.0)], hd + Vector((0, 0, 0.035)), hd + Vector((0.03, 0.0, 0.13)), 10), M['punch'], fa(rnd), smooth=True, wrap=False)

# ================================================================ clock, frames, hooks, doll shelf
def wall_clock(G, M, rnd):
    z = 1.75; zc = z + 0.33; R = 0.15
    G.add(lathe_bm([(0.0, R + 0.022), (0.4, R + 0.02), (0.7, R + 0.012), (1.0, R + 0.008)], (0, -0.02, zc), (0, -0.075, zc), 22, (False, False)), M['case'], wa((1, 0, 0)), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, R + 0.008), (0.5, R + 0.004), (1.0, R)], (0, -0.075, zc), (0, -0.082, zc), 22, (False, False)), M['brass'], ma(0.4), smooth=True, wrap=False)
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=22, radius=R); S.xform(bm, (0, 0, 0), (math.pi / 2, 0, 0)); S.xform(bm, (0, -0.072, zc))
    G.add(bm, M['dial'], attrs_of(lambda q: (q[0] / R, (q[2] - zc) / R, 0.0), 0.5), wrap=False)
    for k in range(12):                                                    # (the hour marks)
        a = 2 * math.pi * k / 12; d = Vector((math.sin(a), 0, math.cos(a))); p0 = Vector((0, -0.0725, zc)) + d * R * 0.8; p1 = p0 + d * R * (0.12 if k % 3 else 0.17)
        G.add(Dr.quad_bm([tuple(p0 - Vector((-d.z, 0, d.x)) * 0.003), tuple(p1 - Vector((-d.z, 0, d.x)) * 0.003), tuple(p1 + Vector((-d.z, 0, d.x)) * 0.003), tuple(p0 + Vector((-d.z, 0, d.x)) * 0.003)], (0, -1, 0)), M['hands'], ma(), wrap=False)
    for (L, w, a) in ((0.075, 0.006, 1.2), (0.11, 0.004, -2.2)):          # (the hands: spade hour, long minute)
        d = Vector((math.sin(a), 0, math.cos(a)))
        G.add(plate([(p.x, p.z) for p in (Vector((0, 0, zc)) + Vector((-d.z, 0, d.x)) * w, Vector((0, 0, zc)) + d * L, Vector((0, 0, zc)) - Vector((-d.z, 0, d.x)) * w)], -0.073, 0.0015), M['hands'], ma(), wrap=False)
    bm = block((-0.12, -0.075, z), (0.12, -0.02, zc - 0.05), 0.004, 1)    # (the drop: the trunk below, a glass window to the pendulum bob)
    for v in bm.verts:
        if v.co.z < z + 0.01: v.co.x *= 0.7
    G.add(bm, M['case'], wa((0, 0, 1)), wrap=False)
    G.add(lathe_bm([(0.0, 0.025), (1.0, 0.025)], (0, -0.077, z + 0.09), (0, -0.0775, z + 0.09), 16, (False, True)), M['brass'], ma(), wrap=False)
    box(G, M['case'], (-R - 0.02, -0.02, z + 0.04), (R + 0.02, 0.0, zc + R + 0.02), wa((0, 0, 1)), 0.0)

FRAME_PIC = ['animals', 'drawing', 'sampler']
def kids_frame(G, M, rnd, v):
    b = 0.035; z = 1.25; W, H = 0.3 + 0.03 * v, 0.36 + 0.04 * (v % 2); x0, x1, z0, z1 = -W / 2, W / 2, z + b + 0.003, z + b + 0.003 + H
    prof = [(0.0, 0.0), (0.0, 0.012), (0.006, 0.02), (0.016, 0.024), (0.026, 0.02), (b, 0.012), (b, 0.0)]
    for (a, c, out) in (((x0, z0), (x1, z0), (0, 0, -1)), ((x1, z0), (x1, z1), (1, 0, 0)), ((x1, z1), (x0, z1), (0, 0, 1)), ((x0, z1), (x0, z0), (-1, 0, 0))):
        o = Vector(out); dv = Vector((c[0] - a[0], 0, c[1] - a[1])).normalized(); rows = []
        for w, h in prof:                                                  # (w out from the picture's edge, mitred: the ends run out with it)
            rows.append([Vector((a[0], -h, a[1])) + o * w - dv * w, Vector((c[0], -h, c[1])) + o * w + dv * w])
        F.grid_surface(G, M['frame'], rows, wa(Vector((c[0] - a[0], 0, c[1] - a[1])), wear=0.2), flip_to=lambda q, o=o: o + Vector((0, -1.5, 0)))
    G.add(Dr.quad_bm([(x0, -0.004, z0), (x1, -0.004, z0), (x1, -0.004, z1), (x0, -0.004, z1)], (0, -1, 0)), M['pic' + str(v)], attrs_of(lambda q: ((q[0] - x0) / W, (q[2] - z0) / H, 0.0), 0.5), wrap=False)
    G.add(Dr.quad_bm([(x0 - b, -0.0005, z0 - b), (x1 + b, -0.0005, z0 - b), (x1 + b, -0.0005, z1 + b), (x0 - b, -0.0005, z1 + b)], (0, 1, 0)), M['back'], ma(), wrap=False)
    tube(G, M['cord'], [Vector((x0 + 0.04, -0.012, z1 - 0.02)), Vector((0, -0.006, z1 + b + 0.05)), Vector((x1 - 0.04, -0.012, z1 - 0.02))], 0.0015, 4, ma())
    G.add(lathe_bm([(0.0, 0.004), (1.0, 0.004)], (0, 0.0, z1 + b + 0.05), (0, -0.012, z1 + b + 0.05), 6), M['brassn'], ma(), wrap=False)

def coat_hooks(G, M, rnd):
    zr = 1.7; box(G, M['paint'], (-0.45, -0.022, zr - 0.06), (0.45, 0.0, zr + 0.06), wa((1, 0, 0)), 0.005, 2)
    xs = [-0.3, -0.1, 0.1, 0.3]
    for x in xs:                                                            # (brass double hooks)
        tube(G, M['brass'], [Vector((x, -0.022, zr + 0.02)), Vector((x, -0.06, zr + 0.015)), Vector((x, -0.08, zr + 0.04)), Vector((x, -0.072, zr + 0.055))], 0.0045, 6, ma())
        tube(G, M['brass'], [Vector((x, -0.022, zr - 0.01)), Vector((x, -0.1, zr - 0.04)), Vector((x, -0.12, zr - 0.0)), Vector((x, -0.11, zr + 0.015))], 0.0045, 6, ma())
        G.add(lathe_bm([(0.0, 0.012), (1.0, 0.011)], (x, -0.022, zr + 0.005), (x, -0.028, zr + 0.005), 10), M['brass'], ma(), wrap=False)
    import furn_wood4 as W4
    def coat(x, L, w, mat, seed):                                           # (hung by its loop: hood and shoulders gathered on the hook)
        r2 = random.Random(seed); hk = Vector((x, -0.1, zr - 0.035))
        def c(u, v):
            a = math.pi * (u - 0.5) * 1.9; t = v; ww = w * (0.45 + 0.55 * min(1.0, t / 0.18)) * (1 + 0.12 * t)
            y = -0.1 - (0.03 + 0.11 * min(1.0, t / 0.3)) * (0.5 + 0.5 * math.cos(a)) * 1.0
            return Vector((x + ww * math.sin(a) * 0.5 + 0.01 * math.sin(9 * u + 3 * t) * t, y + 0.008 * math.sin(11 * u), zr - 0.04 - L * t))
        drape(G, M[mat], 12, 10, c, fa(r2, 3, 3), out=lambda q: Vector((0, -1, 0)))
        for sx in (-1, 1):
            tube(G, M[mat], [Vector((x + sx * w * 0.42, -0.14, zr - 0.12)), Vector((x + sx * w * 0.48, -0.16, zr - 0.3)), Vector((x + sx * w * 0.44, -0.17, zr - 0.5))], 0.026, 7, fa(r2))
    coat(-0.3, 0.86, 0.22, 'coatA', 1); coat(0.1, 0.78, 0.24, 'coatB', 2)
    drape(G, M['scarf'], 3, 10, lambda u, v: Vector((0.3 - 0.06 + 0.12 * u, -0.105 - 0.01 * math.sin(math.pi * u), zr - 0.04 - 0.5 * v)), fa(rnd, 6, 6), out=lambda q: Vector((0, -1, 0)))   # (a knitted scarf over a hook)
    hc = Vector((-0.1, -0.115, zr - 0.2))                                  # (a straw hat on another, hung by its brim)
    G.add(lathe_bm([(0.0, 0.16), (0.08, 0.15), (0.25, 0.09), (0.5, 0.085), (0.95, 0.08), (1.0, 0.0)], hc - Vector((0, -0.01, 0.0)), hc + Vector((0, -0.09, 0.03)), 22), M['straw'], fa(rnd, 20, 20), smooth=True, wrap=False)

def doll_shelf(G, M, rnd):
    zt = 1.45; W, D = 1.2, 0.2
    moulded_top(G, M['paint'], W - 0.03, D - 0.015, zt - 0.02, 0.02, 0.0)
    for x in (-0.45, 0.45):                                                 # (shaped brackets)
        pts = [(0.0, zt - 0.02), (-0.17, zt - 0.02), (-0.17, zt - 0.05)] + [(-0.17 + 0.17 * (1 - math.cos(math.pi / 2 * k / 6)), zt - 0.05 - 0.13 * math.sin(math.pi / 2 * k / 6)) for k in range(1, 7)] + [(0.0, zt - 0.18)]
        bm = plate([(y, z_) for y, z_ in pts], 0.0, 0.022)
        for v in bm.verts: v.co = Vector((x - 0.011 + (v.co.y + 0.011 if False else 0) * 0, v.co.x, v.co.z)) if False else Vector((x + v.co.y, v.co.x, v.co.z))
        G.add(bm, M['paint'], wa((0, 1, 0)), wrap=False)
    box(G, M['paint'], (-W / 2 + 0.015, -D + 0.005, zt), (W / 2 - 0.015, -D + 0.02, zt + 0.02), wa((1, 0, 0), wear=0.4), 0.003)   # (a lip along the front)
    box(G, M['paint'], (-W / 2 + 0.015, -0.015, zt - 0.06), (W / 2 - 0.015, 0.0, zt - 0.02), wa((1, 0, 0)), 0.003)
    G.sockets = [(f'Band_doll_shelf_SOCKET_{k}', (sx * 0.3, -0.12, zt)) for k, sx in enumerate((-1, 1))]

# ================================================================ materials and the list
def pic_material(name, kind):
    """the framed pictures: a nursery print (a hen and chicks, a cat, flowers), a child's crayon house, a cross-stitch alphabet"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); u, v, _ = sep(m, g)
    if kind == 'animals':
        c = m.mix(m.remap(v, 0.0, 0.35), lin('#8fa27a'), lin('#d9d0b2'))
        sun = m.remap(m.math('SQRT', m.math('ADD', m.math('POWER', m.math('SUBTRACT', u, 0.75), 2.0), m.math('POWER', m.math('SUBTRACT', v, 0.78), 2.0))), 0.09, 0.08)
        c = m.mix(sun, c, lin('#e4b84a'))
        def ell(cx, cy, rx, ry):
            return m.remap(m.math('ADD', m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', u, cx), rx), 2.0), m.math('POWER', m.math('DIVIDE', m.math('SUBTRACT', v, cy), ry), 2.0)), 1.0, 0.85)
        hen = m.math('MAXIMUM', ell(0.4, 0.32, 0.16, 0.1), ell(0.53, 0.42, 0.05, 0.06)); c = m.mix(hen, c, lin('#a5643a'))
        for cx in (0.2, 0.68, 0.8): c = m.mix(ell(cx, 0.18, 0.04, 0.035), c, lin('#e8cd5a'))
        c = m.mix(ell(0.56, 0.43, 0.012, 0.012), c, lin('#1e1a16'))
    elif kind == 'drawing':
        c = m.mix(0.0, lin('#ece5d3'), lin('#ece5d3'))
        wall = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(u, 0.24, 0.25), m.remap(u, 0.76, 0.75)), m.math('MULTIPLY', m.remap(v, 0.14, 0.15), m.remap(v, 0.56, 0.55)))
        edge = m.math('SUBTRACT', wall, m.math('MULTIPLY', m.math('MULTIPLY', m.remap(u, 0.255, 0.265), m.remap(u, 0.745, 0.735)), m.math('MULTIPLY', m.remap(v, 0.155, 0.165), m.remap(v, 0.545, 0.535))))
        c = m.mix(edge, c, lin('#c43a2a'))
        roof = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.math('ADD', m.math('MULTIPLY', m.math('ABSOLUTE', m.math('SUBTRACT', u, 0.5)), 1.2), v), 0.85)), 0.012, 0.004), m.remap(v, 0.54, 0.56))
        c = m.mix(roof, c, lin('#2a2a2a'))
        c = m.mix(m.math('MULTIPLY', m.remap(v, 0.1, 0.085), m.remap(m.noise(g, 30, 2), 0.3, 0.6)), c, lin('#3a8a3a'))
        c = m.mix(m.remap(m.math('SQRT', m.math('ADD', m.math('POWER', m.math('SUBTRACT', u, 0.2), 2.0), m.math('POWER', m.math('SUBTRACT', v, 0.82), 2.0))), 0.07, 0.06), c, lin('#e6b43a'))
    else:
        c = m.mix(0.0, lin('#e2d8bf'), lin('#e2d8bf'))
        cu = m.math('FLOOR', m.math('MULTIPLY', u, 60.0)); cv = m.math('FLOOR', m.math('MULTIPLY', v, 70.0))
        rowk = m.math('FLOOR', m.math('MULTIPLY', v, 7.0)); letter = m.math('FRACT', m.math('MULTIPLY', m.math('ADD', m.math('MULTIPLY', cu, 0.37), m.math('MULTIPLY', cv, 0.61)), 0.5))
        lines = m.math('MULTIPLY', m.remap(m.math('FRACT', m.math('MULTIPLY', v, 7.0)), 0.25, 0.3), m.remap(m.math('FRACT', m.math('MULTIPLY', v, 7.0)), 0.75, 0.7))
        st = m.math('MULTIPLY', m.math('MULTIPLY', lines, m.remap(m.noise(m.map(g, (1, 1, 1)), 40, 2), 0.45, 0.55)), m.math('MULTIPLY', m.remap(u, 0.08, 0.1), m.remap(u, 0.92, 0.9)))
        c = m.mix(st, c, m.mix(m.math('FRACT', m.math('MULTIPLY', rowk, 0.37)), lin('#a03a3a'), lin('#2a4a7a')))
        border = m.math('MAXIMUM', m.math('MAXIMUM', m.remap(u, 0.05, 0.04), m.remap(u, 0.95, 0.96)), m.math('MAXIMUM', m.remap(v, 0.04, 0.03), m.remap(v, 0.96, 0.97)))
        c = m.mix(m.math('MULTIPLY', border, m.remap(m.math('SINE', m.math('MULTIPLY', m.math('ADD', u, v), 120.0)), -0.2, 0.2)), c, lin('#3a6a3a'))
    c = m.mix(m.remap(m.noise(g, 3, 3), 0.4, 0.75, 0.0, 0.45), c, m.mix(1.0, c, (0.86, 0.78, 0.6), 'MULTIPLY'))      # (foxed and yellowed)
    c = m.mix(m.math('MULTIPLY', m.remap(m.noise(g, 25, 3), 0.62, 0.7), 0.6), c, lin('#a07a4a'))
    return finish(m, c, 0.25 if kind != 'sampler' else 0.8, m.val(0.0))

def band_materials(name):
    k = f'band_{name}'; M = {}
    M['paint'] = Dr.paint(k + '_paint', ['#e8e1cf', '#9fb2a6', '#8a5a3c'], 'pine', [], kick=0.3, chips=1.1, gloss=0.32, age=1.5, joints=False)
    M['back'] = Dr.bare_boards(k + '_back', 'deal', [], age=1.3, tone=0.7); M['dark'] = kitlib.grey(k + '_dark', (0.01, 0.008, 0.006))
    M['knob'] = kitlib.metal(k + '_knob', 'brass', color='#a4824a', rust=0.0, age=1.4); M['brass'] = M['knob']; M['brassn'] = M['knob']
    M['iron'] = Dr.paint(k + '_iron', ['#c9c2ad', '#3a3a36', '#3a3a36'], 'steel', [], kick=0.0, chips=0.8, gloss=0.35, age=1.6, craze=0.4, joints=False, rust=0.7)
    M['pipe'] = M['iron']; M['marble'] = kitlib.porcelain(k + '_marble', '#e6e2da', glaze=False, crackle=0.15, age=1.6)
    M['china'] = kitlib.porcelain(k + '_china', '#f0ebe0', crackle=0.5, age=1.6); M['enamel'] = M['china']
    M['towel'] = kitlib.fabric(k + '_towel', '#e3dccb', weave=0.0, fade=0.4, stripes=('#b04a4a', 0.12), age=1.8)
    M['lace'] = kitlib.fabric(k + '_lace', '#ebe4d4', weave=0.0, fade=0.3, stripes=('#d8d0bd', 0.006), age=1.7)
    M['brush'] = kitlib.wood(k + '_brush', 'beech', 'varnish', age=1.4); M['bristle'] = kitlib.grey(k + '_bristle', (0.05, 0.04, 0.03))
    M['frame'] = kitlib.wood(k + '_frame', 'mahogany', 'varnish', age=1.4); M['photo'] = kitlib.fabric(k + '_photo', '#8a7a62', weave=0.0, fade=0.7, age=2.0)
    M['pad'] = kitlib.fabric(k + '_pad', '#c9b8a4', weave=0.0, fade=0.4, stripes=('#a8927a', 0.025), age=1.8); M['napkin'] = kitlib.fabric(k + '_napkin', '#ece6d8', weave=0.0, fade=0.3, age=1.6)
    M['wax'] = kitlib.porcelain(k + '_wax', '#e7dcc4', glaze=False, crackle=0.0, age=1.5)
    for mk, c in (('bookA', '#6a2a24'), ('bookB', '#2a4a3a'), ('bookC', '#3a3a6a'), ('bookD', '#8a6a3a')): M[mk] = kitlib.fabric(f'{k}_{mk}', c, weave=0.0, fade=0.7, age=1.8)
    M['drum'] = Dr.paint(k + '_drum', ['#b0302a', '#e8e1cf', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.9, gloss=0.4, age=1.5, joints=False); M['cord'] = kitlib.grey(k + '_cord', (0.6, 0.55, 0.45))
    M['jbox'] = Dr.paint(k + '_jbox', ['#2f4a7a', '#e0b440', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.9, gloss=0.4, age=1.5, joints=False)
    M['boat'] = Dr.paint(k + '_boat', ['#e8e1cf', '#b0302a', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.9, gloss=0.4, age=1.5, joints=False); M['sail'] = M['lace']
    M['bricks'] = Dr.paint(k + '_bricks', ['#c8a64a', '#3f6a8a', '#a07a50'], 'pine', [], kick=0.0, chips=1.2, gloss=0.35, age=1.6, joints=False)
    M['front'] = Dr.paint(k + '_front', ['#7a2c34', '#e0b440', '#8a5a3c'], 'pine', [], kick=0.3, chips=1.0, gloss=0.4, age=1.5, joints=False)
    M['curtain'] = kitlib.fabric(k + '_curtain', '#8a1f24', weave=0.0, fade=0.5, velvet=True, age=1.5); M['backdrop'] = pic_material(k + '_backdrop', 'animals')
    M['punch'] = kitlib.fabric(k + '_punch', '#b02a2a', weave=0.0, fade=0.5, stripes=('#e0b440', 0.03), age=1.6); M['face'] = kitlib.porcelain(k + '_face', '#e2b89c', glaze=False, crackle=0.2, age=1.5)
    M['case'] = kitlib.wood(k + '_case', 'mahogany', 'varnish', age=1.5); M['dial'] = kitlib.porcelain(k + '_dial', '#ece6d6', glaze=True, crackle=0.3, age=1.5)
    M['hands'] = kitlib.metal(k + '_hands', 'iron', color='#141312', rust=0.1, age=1.1)
    M['teddy'] = kitlib.fabric(k + '_teddy', '#9a7a52', weave=0.0, fade=0.4, velvet=True, age=1.8)
    for v, kind in enumerate(FRAME_PIC): M['pic' + str(v)] = pic_material(f'{k}_pic{v}', kind)
    M['coatA'] = kitlib.fabric(k + '_coatA', '#6a2a2a', weave=0.0, fade=0.5, age=1.5); M['coatB'] = kitlib.fabric(k + '_coatB', '#3c4a5e', weave=0.0, fade=0.5, age=1.6)
    M['scarf'] = kitlib.fabric(k + '_scarf', '#a88a4a', weave=0.0, fade=0.5, stripes=('#7a2a24', 0.04), age=1.7); M['straw'] = kitlib.fabric(k + '_straw', '#c9aa6a', weave=0.0, fade=0.3, stripes=('#a8884a', 0.004), age=1.6)
    return M

BANDS = [('Band_dresser', 'dresser', dresser, 2048), ('Band_toy_shelf', 'toy_shelf', toy_shelf, 2048), ('Band_changing_table', 'changing_table', changing_table, 1024),
         ('Band_washstand', 'washstand', washstand, 1024), ('Band_radiator', 'radiator', radiator, 1024), ('Band_bookshelf_low', 'bookshelf_low', bookshelf_low, 1024),
         ('Band_puppet_theatre', 'puppet_theatre', puppet_theatre, 2048), ('Band_night_stand', 'night_stand', night_stand, 1024), ('Band_wall_clock', 'wall_clock', wall_clock, 1024),
         ('Band_kids_frames_v0', 'kids_frames_v0', lambda G, M, r: kids_frame(G, M, r, 0), 1024), ('Band_kids_frames_v1', 'kids_frames_v1', lambda G, M, r: kids_frame(G, M, r, 1), 1024),
         ('Band_kids_frames_v2', 'kids_frames_v2', lambda G, M, r: kids_frame(G, M, r, 2), 1024), ('Band_coat_hooks', 'coat_hooks', coat_hooks, 1024), ('Band_doll_shelf', 'doll_shelf', doll_shelf, 1024)]
