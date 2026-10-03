# Escape from Barbi Blue: more of the nursery's furniture (WP2.5a, wood style), built by furn_wood.py:
#   Solid_iron_bed           a Victorian iron bedstead, head to the wall (0.95 x 2.0, 1.1 m): black enamelled iron chipped to rust,
#                            brass rails, finials and rosettes, cast scrolls; a ticking mattress, a bolster, a sheet thrown over that
#                            hangs in folds down both sides, a blanket folded at the foot; a chamber pot and a child's shoes beneath
#   Solid_toy_chest_v0 / _v1 a panelled toy box (0.9 x 0.5), its lid ajar on its strap hinges, a doll's hand hanging out of the gap,
#                            bricks inside; v0 painted blue-green, v1 red with gilt lining
#   Solid_doll_house         a dolls' house on its stand (0.95 x 0.6, 1.3 m): a stuccoed front with sash windows and a door up two
#                            steps, a slate roof and chimneys; its back open on four papered rooms with their furniture and a doll
#   Solid_rocking_horse      a dapple-grey rocking horse on bow rockers (0.99 x 0.42, 0.9 m): carved body (skinned from its skeleton),
#                            glass eyes, horsehair mane and tail, a red leather saddle, bridle, stirrups
#   Solid_pram               a coach-built perambulator (0.6 x 0.99, 1.05 m): a boat body on C-springs, four spoked wheels, a folding
#                            leathercloth hood on its ribs, the handle with its porcelain grip, a coverlet
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
from kitlib import lin

def fab_attrs(rnd, sx=1.0, sy=1.0):
    o = Vector((rnd.uniform(-9, 9), rnd.uniform(-9, 9), 0))
    return attrs_of(lambda q, o=o: (q[0] * sx + o.x, q[1] * sy + o.y, q[2]), rnd.random())

# ================================================================ the iron bed
def iron_bed(G, M, rnd):
    en, br = M['enamel'], M['brass']; X = 0.455; YH, YF = -0.03, -1.97
    for y, top in ((YH, 1.035), (YF, 0.82)):
        for sx in (-1, 1):
            turned(G, en, [(0.0, 0.019), (0.04, 0.017), (1.0, 0.017)], (sx * X, y, 0.0), (sx * X, y, top), 10, (True, False), ma())
            turned(G, br, [(0.0, 0.017), (0.15, 0.021), (0.3, 0.014), (0.55, 0.032), (0.8, 0.028), (1.0, 0.0)], (sx * X, y, top), (sx * X, y, top + 0.064), 14, (False, True), ma(0.5))
        rails = (1.0, 0.64, 0.3) if y == YH else (0.78, 0.5, 0.3)
        for k, z in enumerate(rails):
            tube(G, br if k == 0 else en, [Vector((-X, y, z)), Vector((X, y, z))], 0.0135 if k == 0 else 0.011, 10, ma(0.4 if k == 0 else 0.0))
        n = 11; z0, z1 = rails[1], rails[0]
        for i in range(n):
            x = -X + 2 * X * (i + 1) / (n + 1)
            tube(G, en, [Vector((x, y, z0)), Vector((x, y, z1))], 0.0062, 6, ma())
            if i % 2 == 0: turned(G, br, [(0.0, 0.009), (0.5, 0.012), (1.0, 0.009)], (x, y, (z0 + z1) / 2 - 0.012), (x, y, (z0 + z1) / 2 + 0.012), 10, attrs=ma(0.3))
        c = Vector((0, y, (z0 + z1) / 2))                                   # (a cast medallion: two scrolls back to back, a rosette)
        for s in (-1, 1):
            pts = [c + Vector((s * (0.02 + 0.07 * (k / 15)) * math.cos(s * 2.4 * math.pi * k / 15 * 0.5) * (1 - 0.4 * k / 15), 0, 0.07 * math.sin(2.4 * math.pi * k / 15 * 0.5) * (1 - 0.5 * k / 15))) for k in range(16)]
            tube(G, en, pts, 0.004, 5, ma())
        turned(G, br, [(0.0, 0.03), (0.3, 0.032), (0.6, 0.022), (1.0, 0.0)], c + Vector((0, 0.008, 0)), c + Vector((0, -0.012, 0)), 16, (True, False), ma(0.5))
    for sx in (-1, 1):                                                      # (the side irons, angle section)
        box(G, M['iron'], (sx * X - 0.02, YF, 0.32), (sx * X + 0.002, YH, 0.325), ma(), 0.0)
        box(G, M['iron'], (sx * X - 0.002, YF, 0.32), (sx * X + 0.002, YH, 0.355), ma(), 0.0)
    for k in range(5): box(G, M['iron'], (-X, YF + 0.2 + k * 0.4, 0.33), (X, YF + 0.23 + k * 0.4, 0.336), ma(), 0.0)
    # bedding
    pillow(G, M['ticking'], (0.0, (YH + YF) / 2, 0.43), 0.88, 1.9, 0.17, rnd, n=8, sag=0.4)
    pillow(G, M['linen'], (0.0, YH - 0.2, 0.555), 0.8, 0.26, 0.13, rnd, n=7, sag=0.15)
    ph = [rnd.uniform(0, 6.28) for _ in range(8)]
    def sheet(s, t):                                                       # (across: on the top, then over the edge and down the side)
        u = (s - 0.5) * 1.3; y = YH - 0.42 + (YF + 0.06 - (YH - 0.42)) * t
        top = 0.535 - 0.008 * math.exp(-((t - 0.5) / 0.3) ** 2) + 0.007 * math.sin(11 * s + ph[0] + 3 * t) * math.sin(6 * t + ph[1])
        top += 0.035 * math.exp(-((t - 0.03) / 0.035) ** 2) * (0.6 + 0.4 * math.sin(9 * s + ph[2]))   # (turned down at the top)
        edge = 0.44
        if abs(u) <= edge: return Vector((u, y, top))
        h = abs(u) - edge; sg = math.copysign(1, u)
        bend = min(h / 0.045, 1.0); hang = max(0.0, h - 0.045)
        fold = 0.012 * math.sin(2 * math.pi * y / 0.19 + ph[3] + hang * 9) * min(1.0, hang / 0.05) + 0.006 * math.sin(2 * math.pi * y / 0.11 + ph[4])
        x = sg * (edge + 0.045 * math.sin(bend * math.pi / 2) + 0.01 + fold)
        z = top - 0.045 * (1 - math.cos(bend * math.pi / 2)) - hang - 0.02 * math.sin(3 * y + ph[5]) * min(1.0, hang / 0.1)
        return Vector((max(-0.472, min(0.472, x)), y, z))
    drape(G, M['sheet'], 34, 30, sheet, fab_attrs(rnd))
    pillow(G, M['blanket'], (0.0, YF + 0.22, 0.58), 0.84, 0.3, 0.07, rnd, n=6, sag=0.1)
    # beneath: a chamber pot, a child's shoes
    pc = Vector((0.18, -1.25, 0.0))
    G.add(lathe_bm([(0.0, 0.07), (0.1, 0.085), (0.5, 0.1), (0.85, 0.095), (0.93, 0.11), (1.0, 0.112)], pc, pc + Vector((0, 0, 0.13)), 20, (True, False)), M['china'], ma(), smooth=True, wrap=False)
    tube(G, M['china'], [pc + Vector((0.1, 0, 0.1)), pc + Vector((0.135, 0, 0.09)), pc + Vector((0.14, 0, 0.06)), pc + Vector((0.1, 0, 0.045))], 0.008, 6, ma())
    for k, sx in enumerate((-0.25, -0.17)):
        b = Vector((sx, -0.75 - k * 0.03, 0.0)); a = math.radians(8 * (k * 2 - 1))
        bm = lathe_bm([(0.0, 0.0), (0.08, 0.026), (0.5, 0.031), (0.85, 0.028), (1.0, 0.0)], b, b + Vector((math.sin(a), -math.cos(a), 0)) * 0.16, 10, (False, False))
        for v in bm.verts: v.co.z = max(0.0, (v.co.z - b.z)) * 1.2 + 0.0
        G.add(bm, M['shoe'], ma(), smooth=True, wrap=False)

def bed_materials():
    k = 'iron_bed'; M = {}
    M['brass'] = kitlib.metal(k + '_brass', 'brass', color='#b08d4a', rust=0.0, age=1.3); M['iron'] = kitlib.metal(k + '_iron', 'iron', rust=0.8, age=1.5)
    M['enamel'] = Dr.paint(k + '_enamel', ['#1f211e', '#3a3a36', '#3a3a36'], 'steel', [(-0.5, 0.5, 0.95, 1.1, 0.04, 0.7)], kick=0.3, chips=1.0, gloss=0.28, age=1.5, craze=0.5, joints=False, rust=0.9)
    M['ticking'] = kitlib.fabric(k + '_ticking', '#d8d1c0', weave=0.0, fade=0.4, stripes=('#3d4a66', 0.016), age=1.3)
    M['linen'] = kitlib.fabric(k + '_linen', '#e4ddcc', weave=0.0, fade=0.3, age=1.2); M['sheet'] = kitlib.fabric(k + '_sheet', '#e6e0d3', weave=0.0, fade=0.35, age=1.2)
    M['blanket'] = kitlib.fabric(k + '_blanket', '#8a6f5d', weave=0.0, fade=0.5, stripes=('#5d4436', 0.06), age=1.2)
    M['china'] = kitlib.porcelain(k + '_china', '#ece6d8', crackle=0.6, age=1.8); M['shoe'] = kitlib.fabric(k + '_shoe', '#2a1f18', weave=0.0, fade=0.2, age=1.5)
    return M

# ================================================================ the toy chest
def toy_chest(G, M, rnd, v):
    p = M['paint']; W, D, H = 0.86, 0.46, 0.46; z0 = 0.04
    for sx in (-1, 1):                                                       # (bracket feet)
        for sy in (-1, 1): box(G, p, (sx * 0.43 - (0.06 if sx > 0 else 0), sy * 0.23 - (0.06 if sy > 0 else 0), 0.0), (sx * 0.43 + (0 if sx > 0 else 0.06), sy * 0.23 + (0 if sy > 0 else 0.06), z0), wa(), 0.004)
    t = 0.018
    for sy in (-1, 1):                                                       # (front and back: frame and two fielded panels)
        y = sy * (D / 2 - t / 2)
        box(G, p, (-W / 2, y - t / 2, z0), (W / 2, y + t / 2, z0 + 0.07), wa((1, 0, 0), wear=0.2), 0.003); box(G, p, (-W / 2, y - t / 2, z0 + H - 0.06), (W / 2, y + t / 2, z0 + H), wa((1, 0, 0), wear=0.3), 0.003)
        for x0, x1 in ((-W / 2, -W / 2 + 0.07), (-0.035, 0.035), (W / 2 - 0.07, W / 2)): box(G, p, (x0, y - t / 2, z0 + 0.07), (x1, y + t / 2, z0 + H - 0.06), wa((0, 0, 1)), 0.003)
        for x0, x1 in ((-W / 2 + 0.07, -0.035), (0.035, W / 2 - 0.07)):
            box(G, p, (x0, y - t / 2 + sy * 0.004, z0 + 0.07), (x1, y + t / 2 + sy * 0.004, z0 + H - 0.06), wa((0, 0, 1)), 0.008, 2)
    for sx in (-1, 1):
        x = sx * (W / 2 - t / 2); box(G, p, (x - t / 2, -D / 2 + t, z0), (x + t / 2, D / 2 - t, z0 + H), wa((0, 1, 0)), 0.003)
        G.add(lathe_bm([(0.0, 0.006), (1.0, 0.006)], (sx * (W / 2 + 0.002), -0.06, z0 + H - 0.1), (sx * (W / 2 + 0.002), 0.06, z0 + H - 0.1), 6), M['iron'], ma(), wrap=False)
        tube(G, M['iron'], [Vector((sx * (W / 2 + 0.003), -0.05, z0 + H - 0.1)), Vector((sx * (W / 2 + 0.028), -0.04, z0 + H - 0.135)), Vector((sx * (W / 2 + 0.028), 0.04, z0 + H - 0.135)), Vector((sx * (W / 2 + 0.003), 0.05, z0 + H - 0.1))], 0.0045, 6, ma())
    box(G, M['deal'], (-W / 2 + t, -D / 2 + t, z0 + 0.01), (W / 2 - t, D / 2 - t, z0 + 0.025), wa((1, 0, 0)), 0.0)
    # inside: bricks, a ball, the doll whose hand hangs over the front
    for k in range(9):
        s = rnd.uniform(0.045, 0.06); c = Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.15, 0.15), z0 + H - 0.12 + rnd.uniform(-0.04, 0.05)))
        bm = block(Vector((-s, -s, -s)) / 2, Vector((s, s, s)) / 2, 0.003, 1)
        S.xform(bm, (0, 0, 0), (rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0, 3))); S.xform(bm, tuple(c))
        G.add(bm, M['bricks'], wa(), wrap=False)
    hb = Vector((0.12, -D / 2 + 0.03, z0 + H - 0.02))
    tube(G, M['bisque'], [hb + Vector((0, 0.05, -0.04)), hb + Vector((0.01, 0.0, 0.0)), hb + Vector((0.02, -0.025, -0.01)), hb + Vector((0.025, -0.03, -0.06))], 0.011, 8, ma())
    hand = hb + Vector((0.025, -0.032, -0.08))
    G.add(lathe_bm([(0.0, 0.004), (0.3, 0.013), (0.7, 0.013), (1.0, 0.008)], hand + Vector((0, 0, 0.022)), hand - Vector((0, 0, 0.012)), 8), M['bisque'], ma(), smooth=True, wrap=False)
    for f in range(4): tube(G, M['bisque'], [hand + Vector((-0.009 + f * 0.006, 0, -0.01)), hand + Vector((-0.01 + f * 0.0065, -0.004, -0.032 + abs(f - 1.5) * 0.004))], 0.0028, 4, ma())
    # the lid, ajar on its hinges at the back
    ang = math.radians(11); hz = z0 + H; hy = D / 2 - 0.005
    bm = block((-W / 2 - 0.012, -D / 2 - 0.012 - hy, 0.0), (W / 2 + 0.012, D / 2 + 0.012 - hy, 0.026), 0.006, 2)
    S.xform(bm, (0, 0, 0), (-ang, 0, 0)); S.xform(bm, (0, hy, hz)); G.add(bm, p, wa((1, 0, 0), wear=0.35), wrap=False)
    for sx in (-0.28, 0.28):
        bm = plate([(sx - 0.018, -0.18), (sx + 0.018, -0.18), (sx + 0.025, 0.02), (sx - 0.025, 0.02)], 0.0, 0.004)
        for vv in bm.verts: vv.co = Vector((vv.co.x, vv.co.z, vv.co.y))
        S.xform(bm, (0, 0, 0.027), (-ang, 0, 0)); S.xform(bm, (0, hy, hz)); G.add(bm, M['iron'], ma(), wrap=False)
        tube(G, M['iron'], [Vector((sx - 0.02, hy + 0.006, hz)), Vector((sx + 0.02, hy + 0.006, hz))], 0.006, 8, ma())

def chest_materials(v):
    k = f'toy_chest_v{v}'; M = {}
    cols = (['#3f5d58', '#c9b98f', '#8a5a3c'] if v == 0 else ['#7a2c24', '#d8c48c', '#8a5a3c'])
    M['paint'] = Dr.paint(k + '_paint', cols, 'pine', [(-0.45, 0.45, 0.45, 0.62, 0.05, 0.8)], kick=0.25, chips=1.3, gloss=0.3, age=1.6, joints=False)
    M['deal'] = Dr.bare_boards(k + '_deal', 'deal', [], age=1.5, tone=0.75); M['iron'] = kitlib.metal(k + '_iron', 'iron', rust=0.7, age=1.5)
    M['bricks'] = Dr.paint(k + '_bricks', ['#c8a64a', '#3f6a8a', '#a07a50'], 'pine', [], kick=0.0, chips=1.2, gloss=0.35, age=1.6, joints=False)
    M['bisque'] = kitlib.porcelain(k + '_bisque', '#ead7c4', glaze=False, crackle=0.3, age=1.7)
    return M

# ================================================================ the dolls' house
def doll_house(G, M, rnd):
    st = M['stand']; X, Y = 0.44, 0.24; zb = 0.34; fl = 0.36; zt = zb + 2 * fl
    for sx in (-1, 1):                                                       # (the stand: a board on four turned legs)
        for sy in (-1, 1): turned(G, st, [(0.0, 0.016), (0.1, 0.02), (0.2, 0.014), (0.6, 0.017), (0.9, 0.02), (1.0, 0.02)], (sx * 0.43, sy * 0.25, 0.0), (sx * 0.43, sy * 0.25, 0.3), 8, attrs=wa((0, 0, 1)))
    box(G, st, (-0.475, -0.295, 0.3), (0.475, 0.295, 0.34), wa((1, 0, 0)), 0.006, 2)
    wl = M['walls']; t = 0.012
    # the front: a board with its openings cut (as rectangles round them)
    wins = [(-0.29, -0.13, zb + 0.1, zb + 0.29), (0.13, 0.29, zb + 0.1, zb + 0.29), (-0.29, -0.13, zb + fl + 0.08, zb + fl + 0.27), (0.13, 0.29, zb + fl + 0.08, zb + fl + 0.27), (-0.05, 0.05, zb + fl + 0.08, zb + fl + 0.27)]
    door = (-0.055, 0.055, zb + 0.04, zb + 0.27)
    holes = wins + [door]
    xs = sorted(set([-X, X] + [h[0] for h in holes] + [h[1] for h in holes])); zs = sorted(set([zb, zt] + [h[2] for h in holes] + [h[3] for h in holes]))
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(h[0] < cx < h[1] and h[2] < cz < h[3] for h in holes): continue
            box(G, wl, (xs[i], -Y - t, zs[j]), (xs[i + 1], -Y, zs[j + 1]), wa((1, 0, 0)), 0.0)
    for (x0, x1, z0, z1) in wins:                                            # (sash frames, glazing bars, sills, dark rooms behind)
        for (a, b, c, d) in ((x0, x1, z0, z0 + 0.012), (x0, x1, z1 - 0.012, z1), (x0, x0 + 0.01, z0, z1), (x1 - 0.01, x1, z0, z1), (x0, x1, (z0 + z1) / 2 - 0.005, (z0 + z1) / 2 + 0.005), ((x0 + x1) / 2 - 0.004, (x0 + x1) / 2 + 0.004, z0, z1)):
            box(G, M['trim'], (a, -Y - t - 0.004, c), (b, -Y - 0.002, d), wa(), 0.0)
        box(G, M['trim'], (x0 - 0.012, -Y - t - 0.018, z0 - 0.014), (x1 + 0.012, -Y - t, z0), wa((1, 0, 0)), 0.002)
        box(G, M['curtain'], (x0 + 0.01, -Y + 0.004, z0 + 0.012), (x1 - 0.01, -Y + 0.006, z1 - 0.012), wa(), 0.0)
    box(G, M['door'], (door[0], -Y - 0.004, door[2]), (door[1], -Y - 0.002, door[3]), wa((0, 0, 1)), 0.0)
    box(G, M['trim'], (door[0] - 0.02, -Y - t - 0.01, door[3]), (door[1] + 0.02, -Y - t, door[3] + 0.03), wa((1, 0, 0)), 0.002)
    for k in range(2): box(G, M['trim'], (-0.08 - k * 0.01, -Y - t - 0.03 - k * 0.025, zb + k * 0.02), (0.08 + k * 0.01, -Y - t, zb + 0.02 + k * 0.02), wa((1, 0, 0)), 0.002)
    for sx in (-1, 1): box(G, M['trim'], (sx * X - 0.02, -Y - t - 0.004, zb), (sx * X + 0.002 * sx, -Y, zt), wa((0, 0, 1)), 0.002)   # (quoins)
    box(G, M['trim'], (-X - 0.01, -Y - t - 0.012, zb + fl - 0.012), (X + 0.01, -Y, zb + fl + 0.004), wa((1, 0, 0)), 0.002)          # (string course)
    box(G, M['trim'], (-X - 0.02, -Y - 0.03, zt - 0.02), (X + 0.02, Y + 0.02, zt + 0.012), wa((1, 0, 0)), 0.003)                   # (cornice)
    # sides, floors, the back open on the rooms: papered walls, a partition, the furniture, a doll at the upper window
    for sx in (-1, 1): box(G, wl, (sx * X - (t if sx > 0 else 0), -Y, zb), (sx * X + (0 if sx > 0 else t), Y, zt), wa((0, 1, 0)), 0.0)
    for z in (zb, zb + fl): box(G, M['floor'], (-X + t, -Y, z), (X - t, Y, z + 0.01), wa((1, 0, 0)), 0.0)
    box(G, M['paper'], (-X + t, -Y + 0.0005, zb + 0.01), (X - t, -Y + 0.001, zt), wa(), 0.0)
    for z in (zb, zb + fl): box(G, M['paper'], (-0.004, -Y, z + 0.01), (0.004, Y - 0.01, z + fl), wa(), 0.0)
    for (cx, cy, z, w, d, h, mk) in ((-0.25, 0.05, zb + 0.01, 0.12, 0.18, 0.06, 'bedding'), (-0.25, 0.14, zb + 0.07, 0.12, 0.012, 0.08, 'stand'), (0.22, 0.06, zb + 0.01, 0.1, 0.07, 0.07, 'stand'),
                                     (0.27, 0.15, zb + 0.01, 0.06, 0.04, 0.16, 'stand'), (-0.24, 0.08, zb + fl + 0.01, 0.15, 0.08, 0.06, 'stand'), (0.24, 0.1, zb + fl + 0.01, 0.12, 0.12, 0.05, 'bedding')):
        box(G, M[mk], (cx - w / 2, cy - d / 2, z), (cx + w / 2, cy + d / 2, z + h), wa(), 0.002)
    dc = Vector((0.0, -Y + 0.03, zb + fl + 0.01))
    G.add(lathe_bm([(0.0, 0.0), (0.05, 0.014), (0.45, 0.012), (0.6, 0.006), (0.65, 0.009), (0.85, 0.011), (1.0, 0.0)], dc, dc + Vector((0, 0, 0.1)), 8), M['dolly'], ma(), smooth=True, wrap=False)
    # the roof: hipped, slate-papered, a ridge, two chimney stacks with pots
    rz = zt + 0.012; rh = 0.17; ov = 0.03
    V = [(-X - ov, -Y - ov, rz), (X + ov, -Y - ov, rz), (X + ov, Y + ov, rz), (-X - ov, Y + ov, rz), (-X + 0.2, 0.0, rz + rh), (X - 0.2, 0.0, rz + rh)]
    for f in ((0, 1, 5, 4), (2, 3, 4, 5), (3, 0, 4), (1, 2, 5)):
        bm = bmesh.new(); vs = [bm.verts.new(V[i]) for i in f]; ff = bm.faces.new(vs); ff.normal_update()
        if ff.normal.z < 0: ff.normal_flip()
        G.add(bm, M['roof'], attrs_of(lambda q: (q[0] * 4, q[1] * 4 + q[2] * 6, 0.0), 0.5), wrap=False)
    tube(G, M['trim'], [Vector((-X + 0.2, 0, rz + rh + 0.004)), Vector((X - 0.2, 0, rz + rh + 0.004))], 0.008, 6, ma())
    for sx in (-1, 1):
        box(G, M['brick'], (sx * 0.28 - 0.04, -0.03, rz + 0.06), (sx * 0.28 + 0.04, 0.05, rz + rh + 0.02), wa(), 0.002)
        for q in (-1, 1): turned(G, M['pot'], [(0.0, 0.011), (0.7, 0.009), (1.0, 0.012)], (sx * 0.28 + q * 0.018, 0.01, rz + rh + 0.02), (sx * 0.28 + q * 0.018, 0.01, rz + rh + 0.04), 8, (False, True), ma())

def dh_materials():
    k = 'doll_house'; M = {}
    M['stand'] = kitlib.wood(k + '_stand', 'mahogany', 'varnish', age=1.3)
    M['walls'] = Dr.paint(k + '_walls', ['#ddd2b8', '#b9a47c', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.8, gloss=0.3, age=1.6, joints=False)
    M['trim'] = Dr.paint(k + '_trim', ['#ece6d6', '#9b9282', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.9, gloss=0.35, age=1.5, joints=False)
    M['door'] = Dr.paint(k + '_door', ['#1f3326', '#7a3b28', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.6, gloss=0.4, age=1.4, joints=False)
    M['curtain'] = kitlib.fabric(k + '_curtain', '#d9cfba', weave=2.0, fade=0.3, age=1.6)
    M['paper'] = kitlib.fabric(k + '_paper', '#b6907a', weave=0.0, fade=0.4, stripes=('#8e6a5a', 0.012), age=1.7)
    M['floor'] = Dr.bare_boards(k + '_floor', 'deal', [], age=1.2, tone=0.85); M['bedding'] = kitlib.fabric(k + '_bedding', '#cfc0a8', weave=1.2, age=1.6)
    M['roof'] = kitlib.fabric(k + '_roof', '#4c4e55', weave=0.0, fade=0.2, stripes=('#33353b', 0.018), age=1.4)
    M['brick'] = kitlib.fabric(k + '_brick', '#7a3e2c', weave=0.0, fade=0.2, stripes=('#5a2e22', 0.01), age=1.4)
    M['pot'] = kitlib.porcelain(k + '_pot', '#9a5a3c', glaze=False, crackle=0.0, age=1.4); M['dolly'] = kitlib.porcelain(k + '_dolly', '#e2c9b4', glaze=True, crackle=0.6, age=1.5)
    return M

# ================================================================ the rocking horse
def skin_mesh(name, verts, edges, radii):
    """a smooth organic body from a skeleton: Blender's skin modifier (radius per vertex) and a level of subdivision, applied"""
    me = bpy.data.meshes.new(name); me.from_pydata(verts, edges, []); ob = kitlib.link(bpy.data.objects.new(name, me))
    sk = ob.modifiers.new('skin', 'SKIN'); sk.use_smooth_shade = True
    for i, r in enumerate(radii): me.skin_vertices[0].data[i].radius = (r, r * 0.92)
    me.skin_vertices[0].data[0].use_root = True
    ob.modifiers.new('sub', 'SUBSURF').levels = 2
    dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg)); bpy.data.objects.remove(ob)
    bm = bmesh.new(); bm.from_mesh(me2); bpy.data.meshes.remove(me2); return bm

def rocking_horse(G, M, rnd):
    R, YR = 1.25, 0.193
    def zb(x): return R - math.sqrt(R * R - x * x)
    for sy in (-1, 1):                                                      # (the bow rockers: a curved bar each, curling up at the ends)
        n = 26; path = []
        for i in range(n + 1):
            x = -0.485 + 0.97 * i / n; z = zb(x); dz = x / math.sqrt(R * R - x * x)
            up = Vector((-dz, 0, 1)).normalized(); path.append((Vector((x, sy * YR, z)), Vector((0, 1, 0)), up))
        bm = bmesh.new(); rows = []
        for p, s, u in path:
            rows.append([bm.verts.new(p + s * dy + u * dz_) for dy, dz_ in ((-0.016, 0.0), (0.016, 0.0), (0.016, 0.05), (-0.016, 0.05))])
        for i in range(n):
            for j in range(4):
                f = bm.faces.new((rows[i][j], rows[i][(j + 1) % 4], rows[i + 1][(j + 1) % 4], rows[i + 1][j])); f.normal_update()
                m_ = f.calc_center_median(); c_ = path[i][0] + path[i][2] * 0.025
                if f.normal.dot(m_ - c_) < 0: f.normal_flip()
        for r_, sgn in ((rows[0], -1), (rows[-1], 1)):
            f = bm.faces.new(r_); f.normal_update()
            if f.normal.x * sgn < 0: f.normal_flip()
        G.add(bm, M['rocker'], wa((1, 0, 0)), wrap=False)
    for x in (-0.36, 0.0, 0.36): turned(G, M['rocker'], [(0.0, 0.012), (0.2, 0.016), (0.5, 0.02), (0.8, 0.016), (1.0, 0.012)], (x, -YR, zb(x) + 0.03), (x, YR, zb(x) + 0.03), 8, attrs=wa((0, 1, 0)))
    # the horse, skinned from its skeleton (x forward)
    V = [(-0.2, 0, 0.555), (-0.02, 0, 0.57), (0.16, 0, 0.575), (0.23, 0, 0.65), (0.28, 0, 0.74), (0.32, 0, 0.8), (0.4, 0, 0.785), (0.47, 0, 0.73)]
    E = [(i, i + 1) for i in range(len(V) - 1)]; Rr = [0.125, 0.135, 0.125, 0.09, 0.07, 0.062, 0.052, 0.04]
    legs = [((0.16, 0.06, 0.49), (0.28, 0.1, 0.32), (0.38, YR, 0.14)), ((0.16, -0.06, 0.49), (0.28, -0.1, 0.32), (0.38, -YR, 0.14)),
            ((-0.18, 0.06, 0.49), (-0.29, 0.1, 0.32), (-0.38, YR, 0.14)), ((-0.18, -0.06, 0.49), (-0.29, -0.1, 0.32), (-0.38, -YR, 0.14))]
    for k, (a, b, c) in enumerate(legs):
        root = 2 if k < 2 else 0; i0 = len(V); V += [a, b, c]; E += [(root, i0), (i0, i0 + 1), (i0 + 1, i0 + 2)]; Rr += [0.06, 0.034, 0.024]
    i0 = len(V); V += [(-0.28, 0, 0.6)]; E += [(0, i0)]; Rr += [0.07]                     # (the rump's swell)
    body = skin_mesh('horse_body', V, E, Rr)
    bmesh.ops.dissolve_degenerate(body, edges=body.edges[:], dist=1e-5)
    me_ = bpy.data.meshes.new('hb'); body.to_mesh(me_); body.free(); ob_ = kitlib.link(bpy.data.objects.new('hb', me_))
    dm = ob_.modifiers.new('dec', 'DECIMATE'); dm.ratio = 0.45                # (level-2 smoothness at about half its triangles)
    dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(ob_.evaluated_get(dg)); bpy.data.objects.remove(ob_)
    body = bmesh.new(); body.from_mesh(me2); bpy.data.meshes.remove(me2)
    hz = lambda x: zb(x) + 0.05
    for v in body.verts:                                                     # (the hooves sit on the rockers)
        v.co.z = max(v.co.z, hz(v.co.x) - 0.002) if v.co.z < 0.2 else v.co.z
    G.add(body, M['horse'], attrs_of(lambda q: tuple(q), 0.5), smooth=True, wrap=False)
    for k, (a, b, c) in enumerate(legs):                                      # (hooves, black, on their stands)
        turned(G, M['hoof'], [(0.0, 0.026), (1.0, 0.021)], (c[0], c[1], hz(c[0])), (c[0], c[1], hz(c[0]) + 0.035), 10, attrs=ma())
    for sy in (-1, 1):                                                       # (ears, glass eyes, nostrils)
        e0 = Vector((0.33, sy * 0.022, 0.84)); turned(G, M['horse'], [(0.0, 0.016), (0.6, 0.012), (1.0, 0.0)], e0, e0 + Vector((-0.01, sy * 0.008, 0.055)), 6, attrs=ma(0.6))
        G.add(lathe_bm([(0.0, 0.0), (0.5, 0.011), (1.0, 0.0)], (0.415, sy * 0.039, 0.785), (0.415, sy * 0.05, 0.785), 10), M['eye'], ma(), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.0), (1.0, 0.008)], (0.495, sy * 0.017, 0.7), (0.485, sy * 0.017, 0.7), 8, (False, True)), M['hoof'], ma(), wrap=False)
    # the handle: a turned peg through the head, a knob each side (where a child holds on)
    turned(G, M['rocker'], [(0.0, 0.0), (0.04, 0.016), (0.14, 0.013), (0.2, 0.009), (0.8, 0.009), (0.86, 0.013), (0.96, 0.016), (1.0, 0.0)], (0.375, -0.205, 0.775), (0.375, 0.205, 0.775), 8, attrs=wa((0, 1, 0), wear=0.6))
    # mane: tufts of horsehair along the neck's crest; tail from the rump
    for k in range(14):
        t = k / 13; p = Vector((0.24 + 0.1 * t, 0, 0.69 + 0.13 * t)) + Vector((0, 0, 0.055 - 0.015 * t)); s = rnd.choice((-1, 1))
        tip = p + Vector((-0.03, s * 0.035, -0.06 - 0.02 * rnd.random()))
        G.add(lathe_bm([(0.0, 0.012), (0.5, 0.009), (1.0, 0.001)], p, tip, 5, (True, False)), M['hair'], attrs_of(lambda q: (q[0] * 30, q[1] * 30, q[2]), rnd.random()), smooth=True, wrap=False)
    tail = [Vector((-0.29, 0, 0.62)), Vector((-0.34, 0, 0.6)), Vector((-0.38, 0.01, 0.52)), Vector((-0.4, 0.02, 0.42)), Vector((-0.41, 0.02, 0.33))]
    for i in range(len(tail) - 1):
        r0 = 0.024 - 0.004 * i; G.add(lathe_bm([(0.0, r0), (1.0, max(0.006, r0 - 0.005))], tail[i], tail[i + 1], 7, (i == 0, i == len(tail) - 2)), M['hair'], attrs_of(lambda q: (q[0] * 30, q[1] * 30, q[2]), 0.3), smooth=True, wrap=False)
    # saddle, saddle cloth, girth, stirrups; bridle and reins
    def on_back(x, y): return 0.56 + 0.112 * math.sqrt(max(0.0, 1 - (y / 0.112) ** 2)) + 0.004 - 0.02 * (x / 0.14) ** 2
    drape(G, M['cloth'], 10, 6, lambda s, t: Vector((-0.12 + 0.24 * s, (t - 0.5) * 0.22, on_back(-0.12 + 0.24 * s, (t - 0.5) * 0.22) + 0.002)), attrs_of(lambda q: (q[0] * 8, q[1] * 8, 0.0), 0.4))
    drape(G, M['saddle'], 8, 6, lambda s, t: Vector((-0.09 + 0.18 * s, (t - 0.5) * 0.19, on_back(-0.09 + 0.18 * s, (t - 0.5) * 0.19) + 0.012 + 0.025 * (abs(2 * s - 1) ** 3))), attrs_of(lambda q: (q[0] * 5, q[1] * 5, 0.0), 0.6))
    for sy in (-1, 1):
        top = Vector((0.0, sy * 0.1, 0.62)); bot = Vector((0.0, sy * 0.125, 0.42))
        tube(G, M['saddle'], [top, bot], 0.004, 4, ma())
        tube(G, M['iron'], [bot + Vector((-0.025, 0, 0)), bot + Vector((-0.025, 0, -0.04)), bot + Vector((0.025, 0, -0.04)), bot + Vector((0.025, 0, 0)), bot + Vector((-0.025, 0, 0))], 0.003, 4, ma())
    for k in range(9):
        a = 2 * math.pi * k / 8; tube(G, M['saddle'], [Vector((0.45, 0.035 * math.cos(a) * 1.2, 0.73 + 0.035 * math.sin(a))) for a in (a, a + math.pi / 4)], 0.003, 4, ma()) if False else None
    nose = [Vector((0.44 + 0.0, 0.036 * math.cos(a), 0.73 + 0.032 * math.sin(a))) for a in np.linspace(0, 2 * math.pi, 13)]
    tube(G, M['saddle'], nose, 0.0035, 4, ma())
    for sy in (-1, 1): tube(G, M['saddle'], [Vector((0.47, sy * 0.034, 0.72)), Vector((0.35, sy * 0.06, 0.66)), Vector((0.15, sy * 0.08, 0.66)), Vector((0.06, sy * 0.06, 0.67))], 0.003, 4, ma())

def horse_materials():
    k = 'rocking_horse'; M = {}
    def dapple(m):                                                           # (dapple grey: rings of darker grey round paler spots)
        op = m.attr('opos', True); v = m.voronoi(m.map(op, (1, 1, 1.4)), 16.0, 'Distance', rand=0.8)
        net = m.math('MULTIPLY', m.remap(v, 0.22, 0.45), m.remap(m.noise(op, 5, 3), 0.25, 0.7, 0.55, 1.0))   # (a darker grey net round pale dapples)
        x, y, z = sep(m, op); low = m.remap(z, 0.5, 0.25)
        spots = m.math('MULTIPLY', m.remap(v, 0.32, 0.12), m.remap(m.noise(op, 9, 3), 0.25, 0.7, 0.5, 1.0))   # (grey dapples dabbed on the white)
        c = m.mix(m.math('MAXIMUM', m.math('MULTIPLY', spots, 0.7), low), lin('#e8e4da'), lin('#86847e'))
        return m.mix(m.remap(x, 0.42, 0.5), c, lin('#6a6662'))           # (a darker muzzle)
    from surfaces2 import sep
    M['horse'] = Dr.paint(k + '_horse', ['#e6e2d8', '#e9dcc0', '#b08a5a'], 'pine', [(0.4, 0.52, 0.66, 0.82, 0.05, 0.8)], kick=0.3, chips=1.3, gloss=0.42, age=1.5, joints=False, top_fn=dapple)
    M['hoof'] = kitlib.metal(k + '_hoof', 'iron', color='#141312', rust=0.0, age=1.2); M['eye'] = kitlib.porcelain(k + '_eye', '#20140c', glaze=True, crackle=0.0, age=0.6)
    M['hair'] = kitlib.fabric(k + '_hair', '#d8d2c6', weave=0.0, fade=0.3, stripes=('#a8a296', 0.003), age=1.5)
    M['saddle'] = kitlib.fabric(k + '_saddle', '#6a1e18', weave=0.0, fade=0.4, age=1.4); M['cloth'] = kitlib.fabric(k + '_cloth', '#2c3f6a', weave=1.0, fade=0.5, age=1.6)
    M['rocker'] = Dr.paint(k + '_rocker', ['#7a2c24', '#c9b98f', '#8a5a3c'], 'pine', [], kick=0.4, chips=1.4, gloss=0.35, age=1.6, joints=False)
    M['iron'] = kitlib.metal(k + '_iron', 'steel', rust=0.4, age=1.4)
    return M

# ================================================================ the pram
def pram(G, M, rnd):
    for (y, r) in ((-0.29, 0.21), (0.323, 0.17)):                             # (wheels: rim, tyre, hub, spokes)
        for sx in (-1, 1):
            x = sx * 0.28; c = Vector((x, y, r))
            bm = bmesh.new(); n = 24; m_ = 5; rings = []
            for i in range(n):
                a = 2 * math.pi * i / n; rr = []
                for j in range(m_):
                    b = 2 * math.pi * j / m_; rho = r - 0.011 + 0.011 * math.cos(b); dx = 0.011 * math.sin(b)
                    rr.append(bm.verts.new(c + Vector((dx, rho * math.cos(a), rho * math.sin(a)))))
                rings.append(rr)
            for i in range(n):
                for j in range(m_):
                    f = bm.faces.new((rings[i][j], rings[(i + 1) % n][j], rings[(i + 1) % n][(j + 1) % m_], rings[i][(j + 1) % m_])); f.normal_update()
                    if f.normal.dot(f.calc_center_median() - (c + Vector((0, (r - 0.011) * math.cos(2 * math.pi * (i + 0.5) / n), (r - 0.011) * math.sin(2 * math.pi * (i + 0.5) / n))))) < 0: f.normal_flip()
            G.add(bm, M['tyre'], ma(0.5), smooth=True, wrap=False)
            turned(G, M['nickel'], [(0.0, 0.012), (0.3, 0.02), (0.7, 0.02), (1.0, 0.012)], c - Vector((0.02, 0, 0)), c + Vector((0.02, 0, 0)), 10, attrs=ma())
            for k in range(14):
                a = 2 * math.pi * k / 14; tube(G, M['spoke'], [c + Vector((-sx * 0.006 * (k % 2), 0, 0)), c + Vector((0, (r - 0.02) * math.cos(a), (r - 0.02) * math.sin(a)))], 0.0022, 4, ma())
        tube(G, M['spoke'], [Vector((-0.28, y, r)), Vector((0.28, y, r))], 0.007, 6, ma())                  # (the axle)
    for (y, r) in ((-0.29, 0.21), (0.323, 0.17)):                              # (C-springs from the axles up to the body)
        for sx in (-1, 1):
            a0 = Vector((sx * 0.2, y, r)); pts = [a0 + Vector((0, -math.copysign(0.07, y) * math.sin(math.pi * k / 10), 0.25 * k / 10)) for k in range(11)]
            tube(G, M['spoke'], pts, 0.006, 6, ma())
    # the body: a boat of panels, the rim rolled, the inside lined
    def bodyp(s, t, inset=0.0):
        y = -0.4 + 0.8 * t; hw = 0.21 * math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.35 - inset; z0, z1 = 0.47, 0.76 + 0.04 * (1 - t)
        a = math.pi * s                                                       # (round the hull: side, bottom, other side)
        return Vector((-hw * math.cos(a), y, z1 - (z1 - z0) * math.sin(a) ** 0.6 - (0.0 if inset == 0 else 0.0)))
    P = [[bodyp(i / 12, j / 16) for i in range(13)] for j in range(17)]
    grid_surface(G, M['body'], P, ma(), flip_to=lambda q: Vector((q.x, 0, q.z - 0.62)))
    Pi = [[bodyp(i / 12, j / 16, 0.006) + Vector((0, 0, 0.0)) for i in range(13)] for j in range(17)]
    grid_surface(G, M['lining'], Pi, fab_attrs(rnd, 5, 5), flip_to=lambda q: Vector((-q.x, 0, 0.62 - q.z)))
    rim = [bodyp(0, j / 16) for j in range(17)] + [bodyp(1, j / 16) for j in range(16, -1, -1)]
    tube(G, M['nickel'], rim, 0.006, 6, ma(0.3))
    for t in (0.0, 1.0):                                                       # (the end panels)
        pts = [bodyp(i / 12, t) for i in range(13)]; bm = bmesh.new(); f = bm.faces.new([bm.verts.new(p) for p in pts]); f.normal_update()
        if f.normal.y * (1 if t > 0.5 else -1) < 0: f.normal_flip()
        G.add(bm, M['body'], ma(), wrap=False)
    # the hood over the head end: ribs and leathercloth, folded half back
    ribs = []
    for k, (y, h) in enumerate(((-0.4, 0.284), (-0.32, 0.262), (-0.22, 0.22), (-0.13, 0.155))):
        pts = [Vector((-0.215 * math.cos(math.pi * i / 12), y - 0.01 * k, 0.76 + h * math.sin(math.pi * i / 12))) for i in range(13)]; ribs.append(pts)
        tube(G, M['nickel'], pts, 0.0035, 4, ma())
    P = [[ribs[j][i] + Vector((0, 0, 0.004)) for i in range(13)] for j in range(len(ribs))]
    for j in range(len(P)):                                                   # (the cloth sags between the ribs)
        if j: P[j] = [p + Vector((0, 0.0, -0.012 * math.sin(math.pi * i / 12))) for i, p in enumerate(P[j])]
    grid_surface(G, M['hood'], P, fab_attrs(rnd, 6, 6), flip_to=lambda q: Vector((q.x, 0, q.z - 0.76)))
    # the coverlet over the foot half, the handle with its grip
    drape(G, M['cover'], 10, 8, lambda s, t: Vector((-0.2 + 0.4 * s, -0.05 + 0.42 * t, 0.735 + 0.012 * math.sin(7 * s + 3 * t) - 0.02 * (abs(2 * s - 1) ** 4))), fab_attrs(rnd, 1, 1))
    for sx in (-1, 1): tube(G, M['nickel'], [Vector((sx * 0.18, -0.38, 0.62)), Vector((sx * 0.19, -0.45, 0.8)), Vector((sx * 0.2, -0.485, 0.98))], 0.007, 6, ma())
    turned(G, M['grip'], [(0.0, 0.014), (0.5, 0.016), (1.0, 0.014)], (-0.2, -0.485, 0.985), (0.2, -0.485, 0.985), 10, attrs=ma(0.6))

def pram_materials():
    k = 'pram'; M = {}
    M['body'] = Dr.paint(k + '_body', ['#1d2734', '#7a3b28', '#7a3b28'], 'steel', [], kick=0.3, chips=0.7, gloss=0.25, age=1.4, craze=0.6, joints=False, rust=0.3)
    M['lining'] = kitlib.fabric(k + '_lining', '#b9a98e', weave=1.2, fade=0.4, age=1.7); M['hood'] = kitlib.fabric(k + '_hood', '#1c1a18', weave=0.4, fade=0.5, age=1.6)
    M['cover'] = kitlib.fabric(k + '_cover', '#cbb8a0', weave=1.0, fade=0.5, stripes=('#a8896a', 0.03), age=1.6)
    M['tyre'] = kitlib.metal(k + '_tyre', 'iron', color='#141312', rust=0.0, age=1.3); M['nickel'] = kitlib.metal(k + '_nickel', 'steel', color='#b8b6ae', rust=0.35, age=1.5)
    M['spoke'] = Dr.paint(k + '_spoke', ['#1d2734', '#5e5e58', '#5e5e58'], 'steel', [], kick=0.0, chips=0.8, gloss=0.3, age=1.4, joints=False, rust=0.5)
    M['grip'] = kitlib.porcelain(k + '_grip', '#ece6d8', crackle=0.5, age=1.6)
    return M
