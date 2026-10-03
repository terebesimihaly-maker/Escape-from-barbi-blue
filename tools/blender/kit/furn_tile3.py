# Escape from Barbi Blue: the gallery floor's islands (WP2.5b, tile style; build spec B4), built by furn_tile.py:
#   Isl_dining        a mahogany dining table laid for six (plates, glasses, folded napkins, a runner), six balloon-back chairs with
#                     velvet seats; the candelabrum (the game's fixture) at Isl_dining_fix in the middle of the table
#   Isl_grand_piano   a grand piano, its lid propped open to 1.9 m on its stick: the gilt iron frame and strings inside, the keyboard
#                     with its fall open, a music desk with a score, three turned legs on castors, the pedal lyre
#   Isl_parlour       two button-back velvet armchairs either side of a tilt-top table with a fringed cloth, a work box on legs, a rug;
#                     the standard lamp (the game's fixture) at Isl_parlour_fix
#   Isl_reading       a library table with books and an inkstand, a buttoned leather chair, a library globe on its stand, a rug
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise
import kitlib
import surfaces2 as S
import doors as Dr
import furnlib as F
from furnlib import wa, ma, turned, box, drape, pillow, grid_surface, fa
from doors import lathe_bm, tube, block, plate, attrs_of
from surfaces2 import sep, comb, finish
from kitlib import lin

LEG = [(0.0, 0.024), (0.06, 0.02), (0.12, 0.026), (0.3, 0.03), (0.5, 0.034), (0.7, 0.03), (0.85, 0.034), (0.92, 0.036), (1.0, 0.036)]

def oriented(c, face):
    c = Vector(c); f = Vector((face[0], face[1], 0)).normalized(); sd = Vector((-f.y, f.x, 0)); return c, f, sd

def local_add(G, mat, bm, c, sd, f, attrs):
    """a bmesh built in the piece's own frame (x along sd, y along f, z up) set down at c"""
    Mx = Matrix(((sd.x, f.x, 0, c.x), (sd.y, f.y, 0, c.y), (0, 0, 1, c.z), (0, 0, 0, 1)))
    bmesh.ops.transform(bm, matrix=Mx, verts=bm.verts); G.add(bm, mat, attrs, wrap=False)

# ================================================================ chairs
def balloon_chair(G, M, c, face, rnd, h=1.1):
    """a balloon-back dining chair: turned front legs; each back leg rises unbroken into the hooped back (one bent rod from floor to
       floor), pinched at the waist where a carved rail crosses; a stuffed seat on its rail"""
    c, f, sd = oriented(c, face); W, D, zs = 0.44, 0.42, 0.46; top = h - 0.016 - zs
    P = lambda a, b, z: c + sd * a + f * b + Vector((0, 0, z))
    for a in (-W / 2 + 0.03, W / 2 - 0.03):
        turned(G, M['mahogany'], LEG[:6] + [(1.0, 0.026)], P(a, D / 2 - 0.035, 0.0), P(a, D / 2 - 0.035, zs - 0.06), 8, attrs=wa((0, 0, 1)))
    side = [(-0.19, -0.255, 0.0), (-0.19, -0.205, zs - 0.06), (-0.18, -0.215, zs + 0.06), (-0.15, -0.225, zs + 0.2), (-0.145, -0.23, zs + 0.25),
            (-0.175, -0.24, zs + 0.36), (-0.19, -0.248, zs + top * 0.78), (-0.15, -0.255, zs + top * 0.94), (-0.07, -0.26, zs + top * 0.995)]
    loop = [P(a, b, z) for a, b, z in side] + [P(0.0, -0.26, zs + top)] + [P(-a, b, z) for a, b, z in reversed(side)]
    F.rod(G, M['mahogany'], loop, 0.016, 8, wa((0, 0, 1), wear=0.35), sub=3)
    F.rod(G, M['mahogany'], [P(-0.145, -0.23, zs + 0.25), P(-0.06, -0.236, zs + 0.23), P(0.0, -0.238, zs + 0.225), P(0.06, -0.236, zs + 0.23), P(0.145, -0.23, zs + 0.25)], 0.012, 6, wa((1, 0, 0)), sub=2)
    G.add(lathe_bm([(0.0, 0.0), (0.3, 0.022), (0.7, 0.024), (1.0, 0.0)], P(0, -0.226, zs + 0.225), P(0, -0.252, zs + 0.225), 8), M['mahogany'], wa((1, 0, 0)), smooth=True, wrap=False)   # (the carved boss)
    local_add(G, M['mahogany'], block((-W / 2, -D / 2, zs - 0.07), (W / 2, D / 2, zs - 0.02), 0.006, 1), c, sd, f, wa((1, 0, 0)))   # (the seat rail)
    pillow(G, M['velvet'], tuple(c + Vector((0, 0, zs + 0.01))), W - 0.01, D - 0.01, 0.07, rnd, n=5, sag=0.3)

def button_chair(G, M, c, face, rnd, h=1.1, mat='velvet', W=0.66, D=0.66, zarm=0.64):
    """a Victorian button-back armchair: the padded back sweeps round in a horseshoe and comes forward into the arms (one stuffed roll,
       highest at the middle, buttoned in diamonds inside, a mahogany show-wood rail along its top); a deep seat cushion, a stuffed
       base, short turned legs on brass castors"""
    c, f, sd = oriented(c, face); zs = 0.42; up = Vector((0, 0, 1)); rx, rb = W / 2 - 0.02, D / 2 - 0.05
    P = lambda a, b, z: c + sd * a + f * b + up * z
    for a in (-W / 2 + 0.06, W / 2 - 0.06):
        for b in (-D / 2 + 0.07, D / 2 - 0.06):
            turned(G, M['mahogany'], [(0.0, 0.022), (0.2, 0.028), (0.5, 0.032), (0.8, 0.026), (1.0, 0.03)], P(a, b, 0.04), P(a, b, 0.2), 8, attrs=wa((0, 0, 1)))
            G.add(lathe_bm([(0.0, 0.02), (1.0, 0.02)], P(a, b, 0.04) - sd * 0.008, P(a, b, 0.04) + sd * 0.008, 10), M['brass'], ma(), wrap=False)
    local_add(G, M[mat], block((-rx, -rb, 0.2), (rx, D / 2, zs - 0.06), 0.03, 2), c, sd, f, fa(rnd, 3, 3))   # (the stuffed base)
    pillow(G, M[mat], tuple(c + f * 0.05 + up * zs), W - 0.13, D - 0.15, 0.12, rnd, n=6, sag=0.35)
    A = 0.7 * math.pi
    def at(u):                                                                 # (round the horseshoe: u 0..1 -> the outer point, outward, top height)
        a = A * (2 * u - 1); o = sd * math.sin(a) * rx - f * math.cos(a) * rb; n = (sd * math.sin(a) / rx - f * math.cos(a) / rb).normalized()
        s_ = abs(a) / A; zt = zarm + (h - zarm) * (math.sin(max(0.0, 1.0 - s_ / 0.75) * math.pi / 2) ** 0.8)   # (a round dome; the arms level in front)
        return o, n, zt
    prof = lambda zt: [(0.0, 0.2), (0.0, zt - 0.05), (0.012, zt - 0.012), (0.04, zt), (0.075, zt - 0.012), (0.095, zt - 0.05), (0.1, zt - 0.12), (0.15, zs + 0.06), (0.17, zs - 0.02)]
    nu = 40; rows = []
    for k in range(9):
        row = []
        for i in range(nu + 1):
            o, n, zt = at(i / nu); d, z = prof(zt)[k]; row.append(c + o - n * d + up * z)
        rows.append(row)
    core = [(c + at(i / nu)[0] - at(i / nu)[1] * 0.05, at(i / nu)[2]) for i in range(nu + 1)]   # (the roll's core line: faces turned away from it)
    def away(q):
        b, zt = min(core, key=lambda m_: (m_[0] - q).xy.length); v = q - b; v.z = 0.0
        if q.z > zt - 0.06: v = v + up * (q.z - (zt - 0.06)) * 2.0
        return v
    grid_surface(G, M[mat], rows, fa(rnd, 3, 3), flip_to=away)
    for i_end in (0, nu):                                                      # (the arm fronts: the roll's section closed, a turned scroll)
        o, n, zt = at(i_end / nu); sec = [c + o - n * d + up * z for d, z in prof(zt)]
        tg = (at(min(1.0, i_end / nu + 0.01))[0] - at(max(0.0, i_end / nu - 0.01))[0]).normalized() * (1 if i_end else -1)
        bm = bmesh.new(); fc_ = bm.faces.new([bm.verts.new(q) for q in sec]); fc_.normal_update()
        if fc_.normal.dot(tg) < 0: fc_.normal_flip()
        bmesh.ops.triangulate(bm, faces=[fc_]); G.add(bm, M[mat], fa(rnd), wrap=False)
        sc = c + o - n * 0.045 + up * (zt - 0.04)
        G.add(lathe_bm([(0.0, 0.03), (0.6, 0.034), (1.0, 0.028)], sc, sc + tg * 0.02, 12), M['mahogany'], wa(tg), smooth=True, wrap=False)
    F.rod(G, M['mahogany'], [c + at(i / 30)[0] - at(i / 30)[1] * 0.04 + up * (at(i / 30)[2] + 0.004) for i in range(2, 29)], 0.011, 6, wa((1, 0, 0), wear=0.4))
    for i in range(6):                                                         # (the buttons in their diamond tufts)
        for j in range(3):
            u = 0.22 + 0.112 * i + (0.056 if j % 2 else 0.0)
            if u > 0.8: continue
            o, n, zt = at(u); zz = zs + 0.12 + 0.17 * j
            if zz > zt - 0.13: continue
            fr = (zz - (zs + 0.06)) / max(zt - 0.12 - (zs + 0.06), 0.01); d = 0.15 + (0.1 - 0.15) * fr; p = c + o - n * (d + 0.003) + up * zz
            G.add(lathe_bm([(0.0, 0.01), (1.0, 0.0)], p, p - n * 0.01, 8), M[mat], fa(rnd), smooth=True, wrap=False)

# ================================================================ the dining set
def dining(G, M, rnd):
    L, Wt, zt = 1.5, 0.82, 0.74
    box(G, M['mahogany'], (-L / 2, -Wt / 2, zt - 0.03), (L / 2, Wt / 2, zt), wa((1, 0, 0), wear=0.4), 0.008, 2)
    box(G, M['mahogany'], (-L / 2 + 0.05, -Wt / 2 + 0.05, zt - 0.12), (L / 2 - 0.05, Wt / 2 - 0.05, zt - 0.03), wa((1, 0, 0)), 0.004)
    for sx in (-1, 1):
        for sy in (-1, 1): turned(G, M['mahogany'], LEG, (sx * (L / 2 - 0.08), sy * (Wt / 2 - 0.08), 0.0), (sx * (L / 2 - 0.08), sy * (Wt / 2 - 0.08), zt - 0.12), 10, attrs=wa((0, 0, 1)))
    drape(G, M['runner'], 18, 3, lambda u, v: Vector((-0.7 + 1.4 * u, -0.17 + 0.34 * v, zt + 0.002)), fa(rnd, 3, 3), out=lambda q: Vector((0, 0, 1)))
    seats = [(-0.4, -0.453, (0, 1)), (0.4, -0.453, (0, 1)), (-0.4, 0.453, (0, -1)), (0.4, 0.453, (0, -1)), (-0.703, 0.0, (1, 0)), (0.703, 0.0, (-1, 0))]
    for (x, y, fc) in seats:
        fv = Vector((fc[0], fc[1], 0)); rt = Vector((fc[1], -fc[0], 0))
        balloon_chair(G, M, (x + rnd.uniform(-0.015, 0.015) * abs(fc[1]), y + rnd.uniform(-0.015, 0.015) * abs(fc[0]), 0.0), fc, rnd, h=1.1)
        p = (Vector((x, -fc[1] * Wt / 2, 0)) if fc[1] else Vector((-fc[0] * L / 2, 0, 0))) + fv * 0.16; p.z = zt + 0.004   # (a place laid: plate, glass, napkin)
        G.add(lathe_bm([(0.0, 0.0), (0.5, 0.1), (0.85, 0.12), (1.0, 0.125)], p, p + Vector((0, 0, 0.015)), 18), M['china'], ma(), smooth=True, wrap=False)
        gp = p + fv * 0.15 + rt * 0.1
        G.add(lathe_bm([(0.0, 0.03), (0.08, 0.004), (0.5, 0.003), (0.55, 0.02), (0.85, 0.032), (1.0, 0.03)], gp, gp + Vector((0, 0, 0.14)), 12, (True, False)), M['glass'], ma(), smooth=True, wrap=False)
        bm = block((-0.04, -0.06, 0.0), (0.04, 0.06, 0.02), 0.006, 1); S.xform(bm, (0, 0, 0), (0, 0, math.atan2(fc[1], fc[0]))); S.xform(bm, tuple(p - rt * 0.17)); G.add(bm, M['napkin'], fa(rnd), wrap=False)
    G.sockets = [('Isl_dining_fix', (0.0, 0.0, zt + 0.002))]

# ================================================================ the grand piano
OUTLINE = [(-0.74, -0.8), (0.74, -0.8), (0.74, -0.35), (0.71, -0.17), (0.6, 0.05), (0.42, 0.3), (0.2, 0.58), (0.02, 0.8), (-0.15, 0.92), (-0.35, 0.97), (-0.58, 0.96), (-0.74, 0.88)]

def piano_outline(n_curve=4):
    """the case outline, the bent side and tail subdivided smooth"""
    pts = OUTLINE; out = [Vector((pts[0][0], pts[0][1], 0)), Vector((pts[1][0], pts[1][1], 0))]
    cr = [Vector((x, y, 0)) for x, y in pts[2:]]
    for i in range(len(cr) - 1):
        a, b = cr[max(0, i - 1)], cr[i]; c_, d = cr[i + 1], cr[min(len(cr) - 1, i + 2)]
        for k in range(n_curve):
            t = k / n_curve
            out.append(0.5 * ((2 * b) + (-a + c_) * t + (2 * a - 5 * b + 4 * c_ - d) * t * t + (-a + 3 * b - 3 * c_ + d) * t ** 3))
    out.append(cr[-1]); return out

def grand_piano(G, M, rnd):
    z0, z1 = 0.62, 0.95; ol = piano_outline()
    n = len(ol); cen = sum(ol, Vector()) / n
    for t_, mat in ((0.0, 'piano'), (0.03, 'piano_in')):                     # (the rim: outside polished, inside plain)
        rows = []
        for z in (z0, z1):
            rows.append([p + (cen - p).normalized() * t_ * Vector((1, 1, 0)).length + Vector((0, 0, z)) for p in ol] + [ol[0] + (cen - ol[0]).normalized() * t_ + Vector((0, 0, z))])
        grid_surface(G, M[mat], rows, wa((1, 0, 0), wear=0.2), flip_to=(lambda q: Vector((q.x - cen.x, q.y - cen.y, 0))) if t_ == 0 else (lambda q: Vector((cen.x - q.x, cen.y - q.y, 0))))
    top_rim = [[p + Vector((0, 0, z1)) for p in ol] + [ol[0] + Vector((0, 0, z1))], [p + (cen - p).normalized() * 0.03 + Vector((0, 0, z1)) for p in ol] + [ol[0] + (cen - ol[0]).normalized() * 0.03 + Vector((0, 0, z1))]]
    grid_surface(G, M['piano'], top_rim, wa((1, 0, 0)), flip_to=lambda q: Vector((0, 0, 1)))
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new(p + Vector((0, 0, z0))) for p in ol]); f.normal_update()
    if f.normal.z > 0: f.normal_flip()
    bmesh.ops.triangulate(bm, faces=[f]); G.add(bm, M['piano'], wa((1, 0, 0)), wrap=False)
    # inside: the gilt iron frame and the strings (a soundboard below them)
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new(p + (cen - p).normalized() * 0.03 + Vector((0, 0, z0 + 0.12))) for p in ol]); f.normal_update()
    if f.normal.z < 0: f.normal_flip()
    bmesh.ops.triangulate(bm, faces=[f]); G.add(bm, M['soundboard'], attrs_of(lambda q: (q[0], q[1], 0.0), 0.5), wrap=False)
    frame = [p * 0.94 + cen * 0.06 for p in ol]
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new(p + Vector((0, 0, z0 + 0.18))) for p in frame]); f.normal_update()
    if f.normal.z < 0: f.normal_flip()
    bmesh.ops.triangulate(bm, faces=[f]); G.add(bm, M['frame'], attrs_of(lambda q: (q[0], q[1], 0.0), 0.5), wrap=False)
    def back_y(x):                                                           # (where the case's far side is, above x)
        ys = []
        for i in range(len(frame)):
            p, q = frame[i], frame[(i + 1) % len(frame)]
            if (p.x - x) * (q.x - x) <= 0 and abs(q.x - p.x) > 1e-9: ys.append(p.y + (q.y - p.y) * (x - p.x) / (q.x - p.x))
        return max(ys) if ys else 0.0
    zs_ = z0 + 0.19; bms = {'wire': bmesh.new(), 'copper': bmesh.new()}       # (the strings: thin strips, wound copper in the bass)
    for i, x in enumerate(np.linspace(-0.66, 0.62, 84)):
        y1 = back_y(x) - 0.05; y0 = -0.7; w = 0.0012 if x > -0.3 else 0.0022
        if y1 - y0 < 0.1: continue
        bm = bms['copper' if x < -0.3 else 'wire']; vs = [bm.verts.new(v) for v in ((x - w, y0, zs_), (x + w, y0, zs_), (x + w, y1, zs_), (x - w, y1, zs_))]
        f_ = bm.faces.new(vs); f_.normal_update()
        if f_.normal.z < 0: f_.normal_flip()
    for k, bm in bms.items(): G.add(bm, M[k], ma(0.2), wrap=False)
    box(G, M['ebony'], (-0.66, -0.6, zs_ + 0.001), (0.5, -0.55, zs_ + 0.035), ma(0.2), 0.003)          # (the dampers' felt row)
    box(G, M['frame'], (-0.68, -0.76, z0 + 0.18), (0.66, -0.68, zs_ + 0.025), ma(0.3), 0.004)           # (the pin block's plate)
    for k in range(5):                                                       # (the frame's struts across the strings)
        a = Vector((-0.6 + 0.25 * k, -0.68, zs_ + 0.02)); b = Vector((-0.65 + 0.2 * k, min(0.75 - 0.1 * k, back_y(-0.65 + 0.2 * k) - 0.06), zs_ + 0.02))
        F.rod(G, M['frame'], [a, b], 0.016, 6, ma(0.3))
    # the keyboard: keybed, white and black keys, the cheeks, the fall open, the key slip
    kz = 0.72; ky0, ky1 = -0.975, -0.82; kx0, kx1 = -0.62, 0.62
    box(G, M['piano'], (-0.74, -0.975, kz - 0.06), (0.74, -0.8, kz - 0.005), wa((1, 0, 0)), 0.004)
    for sx in (-1, 1): box(G, M['piano'], (sx * 0.74 - (0.12 if sx > 0 else 0), -0.975, kz - 0.06), (sx * 0.74 + (0 if sx > 0 else 0.12), -0.8, kz + 0.07), wa((0, 1, 0)), 0.01, 2)
    nw = 52; ww = (kx1 - kx0) / nw
    for i in range(nw):
        x = kx0 + i * ww
        box(G, M['ivory'], (x + 0.0006, ky0, kz), (x + ww - 0.0006, ky1, kz + 0.022), ma(0.4), 0.0015, 1)
    pattern = [1, 1, 0, 1, 1, 1, 0]                                          # (black keys after C D (not E) F G A (not B))
    for i in range(nw - 1):
        if pattern[(i + 5) % 7]:
            x = kx0 + (i + 1) * ww
            box(G, M['ebony'], (x - ww * 0.3, ky0 + 0.06, kz + 0.022), (x + ww * 0.3, ky1, kz + 0.035), ma(0.2), 0.002, 1)
    box(G, M['piano'], (kx0 - 0.005, -0.82, kz), (kx1 + 0.005, -0.77, kz + 0.11), wa((1, 0, 0)), 0.004)   # (the key cover's back)
    bm = block((kx0, -0.012, 0.0), (kx1, 0.012, 0.25), 0.004, 1); S.xform(bm, (0, 0, 0), (-0.35, 0, 0)); S.xform(bm, (0, -0.72, z1 + 0.02)); G.add(bm, M['piano'], wa((1, 0, 0)), wrap=False)   # (the music desk)
    bm = block((-0.2, -0.004, 0.02), (0.2, 0.004, 0.26), 0.002, 1); S.xform(bm, (0, 0, 0), (-0.35, 0, 0)); S.xform(bm, (0, -0.735, z1 + 0.02)); G.add(bm, M['score'], attrs_of(lambda q: (q[0] * 3, q[2] * 3, 0.0), 0.5), wrap=False)
    # legs, castors, the lyre
    for (x, y) in ((-0.64, -0.87), (0.64, -0.87), (-0.42, 0.8)):
        turned(G, M['piano'], [(0.0, 0.04), (0.08, 0.035), (0.2, 0.045), (0.4, 0.055), (0.65, 0.05), (0.8, 0.06), (0.9, 0.065), (1.0, 0.06)], (x, y, 0.04), (x, y, z0), 12, attrs=wa((0, 0, 1)))
        G.add(lathe_bm([(0.0, 0.03), (1.0, 0.03)], (x - 0.01, y, 0.03), (x + 0.01, y, 0.03), 12), M['brass'], ma(), wrap=False)
    ly = Vector((0.0, -0.55, 0.0))
    for sx in (-1, 1): tube(G, M['piano'], [ly + Vector((sx * 0.08, 0, 0.05)), ly + Vector((sx * 0.12, 0, 0.3)), ly + Vector((sx * 0.07, 0, z0))], 0.018, 6, wa((0, 0, 1)))
    box(G, M['piano'], tuple(ly + Vector((-0.12, -0.04, 0.03))), tuple(ly + Vector((0.12, 0.04, 0.07))), wa((1, 0, 0)), 0.006)
    for k in (-1, 0, 1): box(G, M['brass'], tuple(ly + Vector((k * 0.05 - 0.012, -0.12, 0.04))), tuple(ly + Vector((k * 0.05 + 0.012, -0.03, 0.05))), ma(0.5), 0.003)
    # the lid, hinged along the straight (bass) side and propped open: its far edge at 1.9 m
    a = math.asin((1.9 - z1 - 0.02) / 1.48)
    lid = []
    for p in ol:
        d = p.x + 0.74; lid.append(Vector((-0.74 + d * math.cos(a), p.y, z1 + 0.01 + d * math.sin(a))))
    dn = Vector((math.sin(a), 0, -math.cos(a)))
    for t_, side in ((0.0, 1), (0.018, -1)):
        bm = bmesh.new(); f = bm.faces.new([bm.verts.new(q + dn * t_) for q in lid]); f.normal_update()
        if f.normal.dot(-dn * side) < 0: f.normal_flip()
        bmesh.ops.triangulate(bm, faces=[f]); G.add(bm, M['piano'], wa((0, 1, 0), wear=0.15), wrap=False)
    lc = sum(lid, Vector()) / len(lid)
    grid_surface(G, M['piano'], [lid + lid[:1], [q + dn * 0.018 for q in lid + lid[:1]]], wa((0, 1, 0)), flip_to=lambda q: (q - lc) - dn * (q - lc).dot(dn))
    pr0 = Vector((0.66, -0.15, z1 + 0.01)); pr1 = Vector((-0.74, -0.15, z1 + 0.01)) + Vector((math.cos(a), 0, math.sin(a))) * 1.2 + dn * 0.03
    tube(G, M['piano'], [pr0, pr1], 0.012, 6, wa((0, 0, 1)))

# ================================================================ the parlour
def tilt_table(G, M, c, rnd, r=0.34, zt=0.72):
    c = Vector(c)
    G.add(lathe_bm([(0.0, r), (0.5, r + 0.004), (1.0, r)], c + Vector((0, 0, zt - 0.025)), c + Vector((0, 0, zt)), 28, (True, True)), M['mahogany'], wa((1, 0, 0), wear=0.3), smooth=True, wrap=False)
    turned(G, M['mahogany'], [(0.0, 0.05), (0.2, 0.04), (0.4, 0.06), (0.55, 0.035), (0.8, 0.03), (1.0, 0.04)], c + Vector((0, 0, 0.12)), c + Vector((0, 0, zt - 0.025)), 12, attrs=wa((0, 0, 1)))
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.4; d = Vector((math.cos(a), math.sin(a), 0))
        F.rod(G, M['mahogany'], [c + d * 0.03 + Vector((0, 0, 0.2)), c + d * 0.1 + Vector((0, 0, 0.15)), c + d * 0.2 + Vector((0, 0, 0.06)), c + d * 0.29 + Vector((0, 0, 0.02)), c + d * 0.32 + Vector((0, 0, 0.026))], lambda s_: 0.024 - 0.01 * s_, 8, wa(d), sub=3)
    def cloth(u, v):
        a = 2 * math.pi * u
        if v < 0.55: return c + Vector(((r + 0.02) * v / 0.55 * math.cos(a), (r + 0.02) * v / 0.55 * math.sin(a), zt + 0.003))
        s_ = (v - 0.55) / 0.45; rr = r + 0.02 + 0.03 * s_ + 0.022 * s_ ** 0.8 * math.sin(11 * a + 0.8 * math.sin(3 * a))
        return c + Vector((rr * math.cos(a), rr * math.sin(a), zt + 0.003 - 0.012 * s_ ** 0.3 - 0.3 * s_))
    drape(G, M['cloth'], 66, 9, cloth, fa(rnd, 3, 3), out=lambda q: (q - c) * Vector((1, 1, 0)) + Vector((0, 0, 1 if q.z > zt - 0.005 else 0)))
    bm = bmesh.new(); n = 132; V0 = []; V1 = []                              # (the bobble fringe along the hem)
    for i in range(n):
        p = cloth(i / n, 1.0); d = (p - c) * Vector((1, 1, 0)); d.normalize()
        V0.append(bm.verts.new(p + d * 0.002)); V1.append(bm.verts.new(p + d * 0.006 - Vector((0, 0, 0.045))))
    for i in range(n):
        f = bm.faces.new((V0[i], V0[(i + 1) % n], V1[(i + 1) % n], V1[i])); f.normal_update()
        if f.normal.dot(f.calc_center_median() - c) < 0: f.normal_flip()
    G.add(bm, M['fringe'], attrs_of(lambda q: (math.atan2(q[1] - c.y, q[0] - c.x) * 0.3, q[2], 0.0), 0.5), wrap=False)

def parlour(G, M, rnd):
    P = [[Vector((-0.945 + 1.89 * i / 8, -0.795 + 1.59 * j / 8, 0.003 + 0.0015 * math.sin(i + 2 * j))) for i in range(9)] for j in range(9)]
    grid_surface(G, M['rug'], P, attrs_of(lambda q: ((q[0] + 0.945) / 1.89, (q[1] + 0.795) / 1.59, 0.0), 0.5), flip_to=lambda q: Vector((0, 0, 1)))
    tilt_table(G, M, (0.0, 0.0, 0.0), rnd)
    button_chair(G, M, (-0.5, -0.4, 0.0), (0.6, 0.8), rnd, 1.085)
    button_chair(G, M, (0.5, 0.4, 0.0), (-0.6, -0.8), rnd, 1.085)
    wb = Vector((-0.78, 0.5, 0.0))                                           # (a work box on its legs, its lid open on wools)
    for sx in (-1, 1):
        for sy in (-1, 1): tube(G, M['mahogany'], [wb + Vector((sx * 0.1, sy * 0.08, 0.0)), wb + Vector((sx * 0.1, sy * 0.08, 0.5))], 0.012, 6, wa((0, 0, 1)))
    box(G, M['mahogany'], tuple(wb + Vector((-0.12, -0.1, 0.5))), tuple(wb + Vector((0.12, 0.1, 0.62))), wa((1, 0, 0)), 0.004)
    bm = block((-0.12, 0.0, 0.0), (0.12, 0.2, 0.012), 0.003, 1); S.xform(bm, (0, 0, 0), (1.3, 0, 0)); S.xform(bm, tuple(wb + Vector((0, 0.1, 0.62)))); G.add(bm, M['mahogany'], wa((1, 0, 0)), wrap=False)
    for k in range(4): pillow(G, M[('wool1', 'wool2', 'wool1', 'wool2')[k]], tuple(wb + Vector((-0.06 + 0.04 * k, -0.02 + 0.02 * (k % 2), 0.625))), 0.05, 0.05, 0.04, rnd, n=3, sag=0.0)
    for k in range(2):                                                       # (books on the table, a pair of spectacles)
        bm = block((-0.08, -0.11, 0.0), (0.08, 0.11, 0.025), 0.002, 1); S.xform(bm, (0, 0, 0), (0, 0, 0.3 + 0.4 * k)); S.xform(bm, (0.05, -0.05, 0.725 + 0.026 * k)); G.add(bm, M['book'], fa(rnd), wrap=False)
    G.sockets = [('Isl_parlour_fix', (0.68, -0.52, 0.0))]

# ================================================================ the reading corner
def leather_chair(G, M, c, face, rnd):
    c, f, sd = oriented(c, face); W, D, zs = 0.56, 0.48, 0.46; up = Vector((0, 0, 1))
    P = lambda a, b, z: c + sd * a + f * b + up * z
    for a in (-W / 2 + 0.04, W / 2 - 0.04):
        turned(G, M['mahogany'], LEG, P(a, D / 2 - 0.04, 0.0), P(a, D / 2 - 0.04, zs - 0.05), 8, attrs=wa((0, 0, 1)))
        tube(G, M['mahogany'], [P(a, -D / 2 + 0.03, 0.0), P(a, -D / 2 + 0.04, zs - 0.05), P(a, -D / 2 - 0.02, 0.98)], 0.02, 6, wa((0, 0, 1)))
        tube(G, M['mahogany'], [P(a, -D / 2 + 0.03, 0.66), P(a * 1.05, D / 2 - 0.05, 0.66), P(a, D / 2 - 0.04, zs - 0.05)], 0.018, 6, wa((0, 1, 0), wear=0.5))
    pillow(G, M['leather'], tuple(c + up * zs), W - 0.04, D - 0.02, 0.09, rnd, n=5, sag=0.3)
    drape(G, M['leather'], 8, 8, lambda u, v: P((u - 0.5) * (W - 0.06), -D / 2 - 0.0 - 0.06 * v - 0.015 * math.sin(math.pi * u), zs + 0.06 + 0.42 * v), fa(rnd, 3, 3), out=lambda q: f)

def globe(G, M, c, rnd):
    """a library globe: a tripod stand, the brass meridian ring, the globe tilted on its axis"""
    c = Vector(c); R = 0.21; zc = 1.2 - R - 0.02
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.3; d = Vector((math.cos(a), math.sin(a), 0))
        tube(G, M['mahogany'], [c + d * 0.2 + Vector((0, 0, 0.0)), c + d * 0.12 + Vector((0, 0, 0.35)), c + d * 0.05 + Vector((0, 0, 0.62))], 0.02, 6, wa((0, 0, 1)))
    turned(G, M['mahogany'], [(0.0, 0.04), (0.3, 0.05), (0.6, 0.03), (1.0, 0.04)], c + Vector((0, 0, 0.6)), c + Vector((0, 0, zc - R - 0.04)), 10, attrs=wa((0, 0, 1)))
    G.add(lathe_bm([(0.0, R + 0.04), (1.0, R + 0.045)], c + Vector((0, 0, zc - 0.012)), c + Vector((0, 0, zc + 0.012)), 32, (True, True)), M['mahogany'], wa((1, 0, 0)), smooth=True, wrap=False)   # (the horizon ring)
    tilt = math.radians(23.5); ax = Vector((math.sin(tilt), 0, math.cos(tilt)))
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=R); S.xform(bm, (0, 0, 0), (0, tilt, 0)); S.xform(bm, tuple(c + Vector((0, 0, zc))))
    G.add(bm, M['globe'], attrs_of(lambda q, cz=c + Vector((0, 0, zc)): tuple((Vector(q) - cz).normalized()), 0.5), smooth=True, wrap=False)
    ring = [c + Vector((0, 0, zc)) + (ax * math.cos(t) + Vector((math.cos(tilt), 0, -math.sin(tilt))) * math.sin(t)) * (R + 0.015) for t in np.linspace(-math.pi * 0.9, math.pi * 0.9, 25)]
    tube(G, M['brass'], ring, 0.006, 5, ma(0.4))

def persian(name, ground='#5e1719', field='#1e2340', border='#b08f58', age=1.7):
    """a worn Turkey carpet: an outer guard stripe, a wide border of repeating lozenges, an inner guard, the red field strewn with small
       guls round a central medallion; the pile worn down to the warp where feet went, faded, dusty"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); x, y, z = sep(m, g)
    ex = m.math('MINIMUM', x, m.math('SUBTRACT', 1.0, x)); ey = m.math('MINIMUM', y, m.math('SUBTRACT', 1.0, y)); e = m.math('MINIMUM', ex, ey)
    G0, F0, B0 = lin(ground), lin(field), lin(border)
    cx = m.math('SUBTRACT', x, 0.5); cy = m.math('SUBTRACT', y, 0.5)
    dia = m.math('ADD', m.math('ABSOLUTE', m.math('MULTIPLY', cx, 1.3)), m.math('ABSOLUTE', cy))           # (the medallion: a stepped lozenge)
    med = m.remap(dia, 0.2, 0.185); ring = m.math('MULTIPLY', m.remap(dia, 0.24, 0.225), m.remap(dia, 0.2, 0.215))
    gul = m.math('MULTIPLY', m.math('SINE', m.math('MULTIPLY', x, 62.8)), m.math('SINE', m.math('MULTIPLY', y, 62.8)))
    gul = m.remap(m.math('ABSOLUTE', gul), 0.8, 0.95)
    col = m.mix(m.math('MULTIPLY', gul, 0.7), G0, F0); col = m.mix(med, col, F0); col = m.mix(ring, col, B0)
    loz = m.math('ADD', m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', m.math('ADD', x, y), 50.0))), m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', m.math('SUBTRACT', x, y), 50.0))))
    bcol = m.mix(m.remap(loz, 1.1, 1.3), F0, B0)
    inb = m.math('MULTIPLY', m.remap(e, 0.035, 0.04), m.remap(e, 0.12, 0.115))
    col = m.mix(inb, col, bcol)
    guard = m.math('MAXIMUM', m.remap(e, 0.035, 0.03), m.math('MULTIPLY', m.remap(e, 0.12, 0.125), m.remap(e, 0.145, 0.14)))
    col = m.mix(guard, col, m.mix(0.5, G0, B0))
    wear = m.math('MULTIPLY', m.remap(m.noise(m.map(g, (1, 1, 1)), 3.0, 4, 0.6), 0.5, 0.75), m.remap(e, 0.05, 0.25))
    col = m.mix(m.math('MULTIPLY', wear, 0.45), col, lin('#a8957a'))                                  # (worn to the warp: buff threads)
    col = m.mix(m.remap(m.noise(g, 22.0, 3), 0.3, 0.7, 0.0, 0.25), col, m.mix(1.0, col, (0.75, 0.72, 0.68), 'MULTIPLY'))
    col = m.mix(0.18, col, lin('#7a6a58'))                                                             # (faded, dusty)
    pile = m.math('MULTIPLY', m.noise(m.map(g, (1, 1, 1)), 300.0, 2), m.math('SUBTRACT', 1.0, wear))
    return finish(m, col, 0.92, m.math('MULTIPLY', pile, 0.0006))

def globe_material(name):
    """an old globe: varnish gone amber over pale seas and buff continents (blotches of noise on the sphere), a graticule, a cartouche"""
    m = kitlib.Mat(name); g = m.attr('gpos', True)
    land = m.remap(m.noise(m.map(g, (1, 1, 1)), 2.2, 6, 0.55), 0.52, 0.56)
    c = m.mix(land, lin('#b9c4a8'), lin('#c9a874'))
    c = m.mix(m.math('MULTIPLY', land, m.remap(m.noise(g, 8, 3), 0.4, 0.7, 0.0, 0.5)), c, lin('#a07a50'))
    x, y, z = sep(m, g); lat = m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', m.math('ARCSINE', z), 9.0)))
    lon = m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', m.math('ARCTAN2', y, x), 6.0)))
    grid = m.math('MAXIMUM', m.remap(lat, 0.06, 0.0), m.remap(lon, 0.06, 0.0)); c = m.mix(m.math('MULTIPLY', grid, 0.6), c, lin('#6a5a44'))
    c = m.mix(1.0, c, (0.86, 0.76, 0.55), 'MULTIPLY')
    c = m.mix(m.remap(m.noise(g, 5, 3), 0.45, 0.75, 0.0, 0.5), c, m.mix(1.0, c, (0.7, 0.6, 0.45), 'MULTIPLY'))
    return finish(m, c, 0.32, m.math('MULTIPLY', land, 0.0003))

def reading(G, M, rnd):
    P = [[Vector((-0.945 + 1.89 * i / 8, -0.645 + 1.29 * j / 6, 0.003 + 0.0015 * math.sin(i + 2 * j))) for i in range(9)] for j in range(7)]
    grid_surface(G, M['rug'], P, attrs_of(lambda q: ((q[0] + 0.945) / 1.89, (q[1] + 0.645) / 1.29, 0.0), 0.5), flip_to=lambda q: Vector((0, 0, 1)))
    L, Wt, zt, cy = 1.3, 0.72, 0.76, 0.2
    box(G, M['mahogany'], (-L / 2 + 0.12, cy - Wt / 2, zt - 0.03), (L / 2 + 0.12, cy + Wt / 2, zt), wa((1, 0, 0), wear=0.4), 0.008, 2)
    box(G, M['leather'], (-L / 2 + 0.2, cy - Wt / 2 + 0.08, zt), (L / 2 + 0.04, cy + Wt / 2 - 0.08, zt + 0.002), fa(rnd), 0.0)   # (the tooled leather inset)
    box(G, M['mahogany'], (-L / 2 + 0.16, cy - Wt / 2 + 0.04, zt - 0.13), (L / 2 + 0.08, cy + Wt / 2 - 0.04, zt - 0.03), wa((1, 0, 0)), 0.004)
    for sx in (-1, 1):
        for sy in (-1, 1): turned(G, M['mahogany'], LEG, (0.12 + sx * (L / 2 - 0.08), cy + sy * (Wt / 2 - 0.08), 0.0), (0.12 + sx * (L / 2 - 0.08), cy + sy * (Wt / 2 - 0.08), zt - 0.13), 10, attrs=wa((0, 0, 1)))
    button_chair(G, M, (0.12, -0.36, 0.0), (0.0, 1.0), rnd, 1.0, 'leather', 0.62, 0.6, 0.66)
    globe(G, M, (-0.69, -0.38, 0.0), rnd)
    for k in range(5):                                                       # (books: stacked, one open; an inkstand)
        bm = block((-0.09, -0.12, 0.0), (0.09, 0.12, 0.03), 0.002, 1); S.xform(bm, (0, 0, 0), (0, 0, rnd.uniform(-0.3, 0.3))); S.xform(bm, (0.5, cy + 0.15, zt + 0.002 + 0.031 * k)); G.add(bm, M['book'], fa(rnd), wrap=False)
    for sx in (-1, 1):
        bm = block((0.0 if sx > 0 else -0.15, -0.11, 0.0), (0.15 if sx > 0 else 0.0, 0.11, 0.012), 0.002, 1); S.xform(bm, (0, 0, 0), (0, sx * -0.1, 0)); S.xform(bm, (0.0, cy - 0.05, zt + 0.004)); G.add(bm, M['score'], attrs_of(lambda q: (q[0] * 3, q[1] * 3, 0.0), 0.5), wrap=False)
    ik = Vector((-0.35, cy + 0.2, zt + 0.003))
    box(G, M['brass'], tuple(ik + Vector((-0.12, -0.07, 0.0))), tuple(ik + Vector((0.12, 0.07, 0.015))), ma(0.4), 0.004)
    for sx in (-1, 1): G.add(lathe_bm([(0.0, 0.025), (0.7, 0.028), (1.0, 0.012)], ik + Vector((sx * 0.06, 0, 0.015)), ik + Vector((sx * 0.06, 0, 0.07)), 10), M['glass'], ma(), smooth=True, wrap=False)
    tube(G, M['quill'], [ik + Vector((0.0, 0.02, 0.02)), ik + Vector((0.08, 0.05, 0.2))], 0.003, 4, ma())
    st = Vector((0.84, -0.32, 0.0))                                           # (a stack of folios on the floor at the table's end)
    for k in range(6):
        bm = block((-0.09, -0.13, 0.0), (0.09, 0.13, 0.05), 0.003, 1); S.xform(bm, (0, 0, 0), (0, 0, rnd.uniform(-0.2, 0.2))); S.xform(bm, tuple(st + Vector((0, 0, 0.051 * k)))); G.add(bm, M['book'], fa(rnd), wrap=False)

# ================================================================ build
def isl_mats():
    import furn_tile as T
    M = T.tile_mats('isl_tile')
    M['runner'] = kitlib.fabric('isl_tile_runner', '#e6ded0', weave=0.0, fade=0.3, stripes=('#cfc4ae', 0.008), age=1.7); M['napkin'] = M['runner']
    M['piano'] = kitlib.wood('isl_tile_piano', 'mahogany', 'varnish', stain='#140c08', age=1.2); M['piano_in'] = kitlib.wood('isl_tile_pianoin', 'beech', 'bare', age=1.4)
    M['soundboard'] = kitlib.wood('isl_tile_sb', 'pine', 'varnish', age=1.3); M['frame'] = kitlib.metal('isl_tile_frame', 'brass', color='#a88a48', rust=0.0, age=1.6)
    M['ivory'] = kitlib.porcelain('isl_tile_ivory', '#e9dfc6', glaze=False, crackle=0.2, age=1.6)
    M['score'] = kitlib.fabric('isl_tile_score', '#e6dcc4', weave=0.0, fade=0.6, stripes=('#3a3530', 0.012), age=1.8)
    M['cloth'] = kitlib.fabric('isl_tile_cloth', '#4a2a3a', weave=0.0, fade=0.5, velvet=True, age=1.6); M['fringe'] = kitlib.fabric('isl_tile_fringe', '#a8874e', weave=0.0, fade=0.4, stripes=('#6b5430', 0.006), age=1.4)
    M['rug'] = persian('isl_tile_rug'); M['wire'] = kitlib.metal('isl_tile_wire', 'steel', color='#c4c0b6', rust=0.1, age=1.2)
    M['copper'] = kitlib.metal('isl_tile_copper', 'brass', color='#a8673a', rust=0.0, age=1.4)
    M['wool1'] = kitlib.fabric('isl_tile_wool1', '#8a3a4a', weave=0.0, age=1.4); M['wool2'] = kitlib.fabric('isl_tile_wool2', '#3a5a6a', weave=0.0, age=1.4)
    M['book'] = kitlib.fabric('isl_tile_book', '#5a2a24', weave=0.0, fade=0.7, age=1.8); M['leather'] = kitlib.fabric('isl_tile_leather', '#4a2a1c', weave=0.0, fade=0.5, age=1.7)
    M['globe'] = globe_material('isl_tile_globe'); M['quill'] = kitlib.porcelain('isl_tile_quill', '#e8e2d4', glaze=False, crackle=0.0, age=1.5)
    return M

def build_islands(want):
    rnd = random.Random(61); M = isl_mats(); roots = []; parts = []
    for name, fn in (('Isl_dining', dining), ('Isl_grand_piano', grand_piano), ('Isl_parlour', parlour), ('Isl_reading', reading)):
        if not want(name.lower()): continue
        G = S.Geo(1, 1, False, False); fn(G, M, rnd); o = F.build_obj(name.lower() + '_tmp', G); parts.append(o)
        roots.append((name, [o], None, None, None, [], getattr(G, 'sockets', [])))
    return roots, parts, M
