# Escape from Barbi Blue: the nursery's last islands (WP2.5a, wood style), built by furn_wood.py:
#   Isl_tea_party   a round child's tea table laid with a toy tea set, four tall-backed little chairs round it, a bisque doll sitting
#                   in each (bisque heads, glass eyes, wigs, cloth bodies, faded frocks), one in a bonnet; they are not the scare dolls
#   Isl_dollhouse   the dolls' house (the solid's, larger) on a long low stand, a child's chair before it, a doll's pram behind,
#                   on a worn rug with the toys of a game left off: bricks, a wooden train, a spinning top, a teddy
#   Isl_washstand   a marble-topped washstand with a tiled splashback, jug and basin, soap dish, a towel on its rail; a tin hip
#                   bath on the floor before it, and a towel horse
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
from surfaces2 import sep, finish
from kitlib import TMP, lin

def fa(rnd, sx=1.0, sy=1.0):
    o = Vector((rnd.uniform(-9, 9), rnd.uniform(-9, 9), 0)); return attrs_of(lambda q, o=o: (q[0] * sx + o.x, q[1] * sy + o.y, q[2]), rnd.random())

# ================================================================ a seated doll
def seated_doll(G, M, seat, face, rnd, scale=1.0, bonnet=False, frock='frockA'):
    """a bisque-headed doll sitting on seat (the point under her hips), facing face: the head (a lathe with a chin and a turned-up
       nose), glass eyes, a wig, a shoulder plate; a stuffed cloth body; a frock with a full skirt over her knees; legs out, shoes"""
    s = scale; c = Vector(seat); f = Vector((face[0], face[1], 0)).normalized(); sd = Vector((-f.y, f.x, 0)); up = Vector((0, 0, 1))
    hip = c + up * 0.02 * s; chest = hip + up * 0.16 * s - f * 0.01 * s; neck = chest + up * 0.07 * s; head = neck + up * 0.085 * s + f * 0.006 * s
    # body and frock bodice
    G.add(lathe_bm([(0.0, 0.05 * s), (0.4, 0.062 * s), (0.75, 0.055 * s), (1.0, 0.035 * s)], hip, chest + up * 0.03 * s, 10), M[frock], fa(rnd, 3, 3), smooth=True, wrap=False)
    # the skirt: over the knees and down the chair's front
    knee = hip + f * 0.12 * s + up * 0.01 * s
    def skirt(u, v):
        a = math.pi * (u - 0.5) * 1.6; rr = (0.075 + 0.06 * v) * s
        p = hip.lerp(knee, v * 0.9) + sd * math.sin(a) * rr - up * (0.02 * s * v) + up * math.cos(a) * 0.03 * s * (1 - v)
        p += -up * 0.05 * s * max(0.0, v - 0.75) / 0.25 + f * 0.01 * s * math.sin(7 * u + 2 * v) * v
        return p
    drape(G, M[frock], 10, 6, skirt, fa(rnd, 3, 3))
    hem = [knee + sd * math.sin(math.pi * (u - 0.5) * 1.6) * 0.135 * s - up * 0.07 * s for u in np.linspace(0, 1, 9)]
    for k in range(len(hem) - 1):                                          # (the skirt's front hanging from the knees)
        a, b = hem[k], hem[k + 1]; P = [[a + up * 0.07 * s, b + up * 0.07 * s], [a, b]]
        grid_surface(G, M[frock], P, fa(rnd, 3, 3), flip_to=lambda q: f)
    for sx in (-1, 1):                                                      # (legs out under the hem: stockings, shoes)
        k0 = knee + sd * sx * 0.03 * s; ft = k0 + f * 0.015 * s - up * 0.11 * s
        G.add(lathe_bm([(0.0, 0.016 * s), (1.0, 0.012 * s)], k0, ft, 8), M['stocking'], fa(rnd), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.0), (0.2, 0.015 * s), (0.7, 0.016 * s), (1.0, 0.0)], ft - f * 0.01 * s, ft + f * 0.05 * s, 8), M['shoe'], ma(), smooth=True, wrap=False)
    for sx in (-1, 1):                                                      # (arms: sleeves, bisque hands in the lap)
        sh = chest + sd * sx * 0.055 * s; el = sh - up * 0.07 * s + f * 0.02 * s; hd = el + f * 0.06 * s - sd * sx * 0.02 * s
        G.add(lathe_bm([(0.0, 0.019 * s), (1.0, 0.016 * s)], sh, el, 8), M[frock], fa(rnd), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.012 * s), (1.0, 0.01 * s)], el, hd, 8), M['bisque'], ma(), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.0), (0.3, 0.012 * s), (1.0, 0.0)], hd - f * 0.005 * s, hd + f * 0.022 * s, 8), M['bisque'], ma(), smooth=True, wrap=False)
    # the shoulder plate and neck, the head
    G.add(lathe_bm([(0.0, 0.045 * s), (0.5, 0.03 * s), (1.0, 0.018 * s)], chest + up * 0.02 * s, neck, 10), M['bisque'], ma(), smooth=True, wrap=False)
    bm = lathe_bm([(0.0, 0.0), (0.12, 0.03 * s), (0.35, 0.046 * s), (0.6, 0.05 * s), (0.85, 0.042 * s), (1.0, 0.0)], neck + up * 0.01 * s, head + up * 0.05 * s, 14)
    for v in bm.verts:                                                      # (chubby cheeks forward, the chin, a little nose)
        rel = v.co - head; fw = rel.dot(f)
        if fw > 0: v.co += f * fw * 0.18 * math.exp(-(rel.z / (0.035 * s)) ** 2)
        if fw > 0.04 * s and abs(rel.dot(sd)) < 0.01 * s and abs(rel.z) < 0.012 * s: v.co += f * 0.006 * s
    G.add(bm, M['bisque'], ma(), smooth=True, wrap=False)
    for sx in (-1, 1):                                                      # (glass eyes, a painted mouth)
        e = head + f * 0.044 * s + sd * sx * 0.017 * s + up * 0.008 * s
        G.add(lathe_bm([(0.0, 0.0), (0.5, 0.008 * s), (1.0, 0.0)], e - f * 0.004 * s, e + f * 0.004 * s, 10), M['eye'], ma(), smooth=True, wrap=False)
    # the wig: ringlets round the back and sides; or a bonnet
    if bonnet:
        G.add(lathe_bm([(0.0, 0.062 * s), (0.3, 0.064 * s), (0.7, 0.058 * s), (1.0, 0.0)], head - f * 0.02 * s - up * 0.01 * s, head - f * 0.03 * s + up * 0.075 * s, 14, (False, True)), M['bonnet'], fa(rnd), smooth=True, wrap=False)
        tube(G, M['bonnet'], [head - f * 0.005 * s + sd * 0.06 * s * k + up * 0.02 * s * (1 - abs(k)) for k in np.linspace(-1, 1, 9)], 0.008 * s, 6, fa(rnd))
    else:
        G.add(lathe_bm([(0.0, 0.054 * s), (0.35, 0.056 * s), (0.65, 0.05 * s), (0.85, 0.036 * s), (0.95, 0.02 * s), (1.0, 0.0)], head - f * 0.008 * s, head + up * 0.058 * s - f * 0.004 * s, 14, (False, True)), M['hair'], fa(rnd, 20, 20), smooth=True, wrap=False)
    for k in range(13):                                                      # (ringlets: curls hanging round the back and sides)
        a = math.pi * (0.2 + 1.6 * k / 12); rad = (sd * math.cos(a) - f * math.sin(a)); p0 = head + rad * 0.052 * s - up * 0.0 * s
        L = (0.06 + 0.035 * rnd.random()) * s; ph = rnd.uniform(0, 6.28); pts = []
        for i in range(13):
            tt = i / 12; ax = p0 + rad * 0.012 * s * tt - up * L * tt
            pts.append(ax + (rad.cross(up).normalized() * math.cos(ph + tt * 12) + rad * math.sin(ph + tt * 12)) * 0.006 * s * (0.4 + tt))
        tube(G, M['hair'], pts, 0.0045 * s, 5, fa(rnd, 20, 20))

def doll_materials(k):
    M = {}
    M['bisque'] = kitlib.porcelain(k + '_bisque', '#ecd5c4', glaze=False, crackle=0.25, age=1.6)
    M['eye'] = kitlib.porcelain(k + '_eye', '#3a5a7a', glaze=True, crackle=0.0, age=0.6); M['shoe'] = kitlib.fabric(k + '_shoe', '#1e1814', weave=0.0, fade=0.2, age=1.4)
    M['stocking'] = kitlib.fabric(k + '_stocking', '#e2dccf', weave=0.0, fade=0.3, age=1.6); M['hair'] = kitlib.fabric(k + '_hair', '#6a4a2c', weave=0.0, fade=0.3, stripes=('#4a3220', 0.004), age=1.5)
    M['bonnet'] = kitlib.fabric(k + '_bonnet', '#e6dccb', weave=0.0, fade=0.4, age=1.7)
    for mk, c, st in (('frockA', '#b8868c', ('#d8c0b8', 0.012)), ('frockB', '#7f97b0', None), ('frockC', '#d9cfae', ('#a88c6a', 0.02)), ('frockD', '#8a6a8a', None)):
        M[mk] = kitlib.fabric(f'{k}_{mk}', c, weave=0.0, fade=0.55, stripes=st, age=1.7)
    return M

# ================================================================ the tea party
def tea_chair(G, M, c, face, rnd):
    """a child's tall-backed chair: turned front legs, back posts to 0.93 with finials, three spindles, a solid seat"""
    c = Vector(c); f = Vector((face[0], face[1], 0)).normalized(); sd = Vector((-f.y, f.x, 0)); W, D, zs = 0.3, 0.28, 0.3
    P = lambda a, b, z: c + sd * a + f * b + Vector((0, 0, z))
    for a in (-W / 2 + 0.018, W / 2 - 0.018):
        turned(G, M['chairs'], [(0.0, 0.015), (0.1, 0.017), (0.5, 0.019), (0.9, 0.016), (1.0, 0.016)], P(a, D / 2 - 0.02, 0.0), P(a, D / 2 - 0.02, zs), 6, attrs=wa((0, 0, 1)))
        turned(G, M['chairs'], [(0.0, 0.016), (0.3, 0.018), (0.6, 0.016), (0.88, 0.015), (0.91, 0.019), (0.94, 0.022), (0.97, 0.02), (0.99, 0.012), (1.0, 0.0)],
               P(a, -D / 2 + 0.018, 0.0), P(a, -D / 2 - 0.012, 0.74), 8, attrs=wa((0, 0, 1)))
    for z in (0.5, 0.66):
        tube(G, M['chairs'], [P(-W / 2 + 0.018, -D / 2 + 0.018 - (z - 0.3) * 0.06, z), P(W / 2 - 0.018, -D / 2 + 0.018 - (z - 0.3) * 0.06, z)], 0.012, 5, wa((1, 0, 0)))
    for a in (-0.05, 0.0, 0.05):
        tube(G, M['chairs'], [P(a, -D / 2 + 0.02, zs + 0.02), P(a, -D / 2 + 0.008, 0.5)], 0.007, 5, wa((0, 0, 1)))
    bm = block((-W / 2, -D / 2, zs), (W / 2, D / 2, zs + 0.022), 0.005, 1)
    Mx = Matrix((sd.to_4d(), f.to_4d(), Vector((0, 0, 1, 0)), Vector((0, 0, 0, 1)))).transposed(); Mx.translation = c
    bmesh.ops.transform(bm, matrix=Mx, verts=bm.verts); G.add(bm, M['chairs'], wa((1, 0, 0), wear=0.4), wrap=False)
    return c + Vector((0, 0, zs + 0.022)) - f * 0.02

def tea_party(G, M, rnd):
    zt = 0.5; R = 0.36
    G.add(lathe_bm([(0.0, R), (0.5, R), (1.0, R - 0.005)], (0, 0, zt - 0.022), (0, 0, zt), 32, (True, True)), M['table'], wa((1, 0, 0), wear=0.3), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.0), (0.1, 0.16), (0.2, 0.15), (0.5, 0.04), (0.7, 0.03), (0.85, 0.045), (1.0, 0.04)], (0, 0, 0), (0, 0, zt - 0.022), 12), M['table'], wa((0, 0, 1)), smooth=True, wrap=False)
    # the cloth over it: a round cloth hanging in folds
    def cloth(u, v):
        a = 2 * math.pi * u; r = R * v * 1.32 if v < 0.75 else R * (0.99 + 0.01 * math.sin(a * 9))
        if v < 0.75: z = zt + 0.003
        else: z = zt + 0.003 - (v - 0.75) / 0.25 * 0.16
        rr = r if v < 0.75 else R + 0.012 * math.sin(a * 11 + v * 3) + 0.006
        return Vector((rr * math.cos(a), rr * math.sin(a), z))
    drape(G, M['cloth'], 48, 8, cloth, fa(rnd, 2, 2))
    import furn_wood3 as W3
    W3.braided_rug(G, M, 0.745, 0.695, rnd)
    for k in range(4):                                                      # (chairs round it, a doll in each)
        a = math.pi / 4 + k * math.pi / 2; d = Vector((math.cos(a), math.sin(a), 0))
        c = d * 0.6; seat = tea_chair(G, M, c, (-d.x, -d.y), rnd)
        seated_doll(G, M, seat, (-d.x, -d.y), rnd, (1.3, 1.42, 1.38, 1.25)[k], bonnet=(k == 2), frock=('frockA', 'frockB', 'frockC', 'frockD')[k])
        cp = d * 0.25 + Vector((0, 0, zt + 0.003))                         # (cups and saucers in front of each)
        G.add(lathe_bm([(0.0, 0.0), (0.2, 0.04), (0.6, 0.045), (1.0, 0.05)], cp, cp + Vector((0, 0, 0.006)), 14, (True, True)), M['china'], ma(), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.015), (0.4, 0.025), (1.0, 0.03)], cp + Vector((0, 0, 0.006)), cp + Vector((0, 0, 0.035)), 14, (True, False)), M['china'], ma(), smooth=True, wrap=False)
    tp = Vector((0.02, -0.03, zt + 0.003))                                  # (the teapot, the cake on its stand)
    G.add(lathe_bm([(0.0, 0.03), (0.3, 0.06), (0.6, 0.062), (0.85, 0.045), (1.0, 0.02)], tp, tp + Vector((0, 0, 0.1)), 16, (True, True)), M['china'], ma(), smooth=True, wrap=False)
    tube(G, M['china'], [tp + Vector((0.05, 0, 0.04)), tp + Vector((0.09, 0, 0.07)), tp + Vector((0.105, 0, 0.09))], 0.009, 6, ma())
    tube(G, M['china'], [tp + Vector((-0.055, 0, 0.08)), tp + Vector((-0.09, 0, 0.065)), tp + Vector((-0.06, 0, 0.03))], 0.006, 6, ma())
    G.add(lathe_bm([(0.0, 0.0), (0.4, 0.008), (1.0, 0.0)], tp + Vector((0, 0, 0.1)), tp + Vector((0, 0, 0.12)), 8), M['china'], ma(), smooth=True, wrap=False)
    ck = Vector((-0.08, 0.1, zt + 0.003))                                  # (a three-tier cake stand: china plates on a brass rod, a ring to carry it)
    turned(G, M['brass'], [(0.0, 0.045), (0.05, 0.04), (0.12, 0.008), (0.9, 0.006), (0.94, 0.0)], ck, ck + Vector((0, 0, 0.405)), 10, attrs=ma())
    for k, (z, r) in enumerate(((0.05, 0.12), (0.19, 0.095), (0.31, 0.07))):
        G.add(lathe_bm([(0.0, 0.006), (0.3, r * 0.7), (0.8, r), (1.0, r * 1.02)], ck + Vector((0, 0, z)), ck + Vector((0, 0, z + 0.012)), 18, (True, False)), M['china'], ma(), smooth=True, wrap=False)
        for q in range(4 - k):
            a = q * 2 * math.pi / (4 - k) + k; c_ = ck + Vector((r * 0.5 * math.cos(a), r * 0.5 * math.sin(a), z + 0.012))
            G.add(lathe_bm([(0.0, 0.022), (1.0, 0.02)], c_, c_ + Vector((0, 0, 0.025)), 10, (True, True)), M['cake'], fa(rnd), smooth=True, wrap=False)
    tube(G, M['brass'], [ck + Vector((0.025 * math.cos(a), 0, 0.42 + 0.025 * math.sin(a))) for a in np.linspace(-math.pi / 2, 3 * math.pi / 2, 13)], 0.003, 5, ma())

def tea_materials():
    M = doll_materials('isl_tea'); k = 'isl_tea'
    M['table'] = Dr.paint(k + '_table', ['#e2dccb', '#9db0a4', '#8a5a3c'], 'pine', [], kick=0.3, chips=1.2, gloss=0.32, age=1.6, joints=False)
    M['chairs'] = Dr.paint(k + '_chairs', ['#e2dccb', '#9db0a4', '#8a5a3c'], 'pine', [], kick=0.4, chips=1.3, gloss=0.32, age=1.6, joints=False)
    M['cloth'] = kitlib.fabric(k + '_cloth', '#e6ded0', weave=0.0, fade=0.4, stripes=('#c9a0a0', 0.05), age=1.8)
    import furn_wood3 as W3
    M['rug'] = W3.rug_material(k + '_rug')
    M['brass'] = kitlib.metal(k + '_brass', 'brass', color='#a4824a', rust=0.0, age=1.4)
    M['china'] = kitlib.porcelain(k + '_china', '#f0ebe0', crackle=0.4, age=1.5); M['cake'] = kitlib.fabric(k + '_cake', '#b89a7a', weave=0.0, fade=0.2, age=2.0)
    return M

# ================================================================ the dolls' house set
def toys(G, M, rnd, area, n_bricks=14):
    x0, x1, y0, y1 = area
    for k in range(n_bricks):
        s = rnd.uniform(0.04, 0.055); c = Vector((rnd.uniform(x0, x1), rnd.uniform(y0, y1), s / 2))
        bm = block(Vector((-s, -s, -s)) / 2, Vector((s, s, s)) / 2, 0.003, 1); S.xform(bm, (0, 0, 0), (0, 0, rnd.uniform(0, 3))); S.xform(bm, tuple(c))
        G.add(bm, M['bricks'], wa(), wrap=False)
    # a wooden train: an engine and two trucks on a string
    t0 = Vector((rnd.uniform(x0, x1 - 0.4), rnd.uniform(y0, y1), 0.0)); ang = rnd.uniform(-0.4, 0.4); d = Vector((math.cos(ang), math.sin(ang), 0)); e = Vector((-d.y, d.x, 0))
    for k in range(3):
        c = t0 + d * 0.16 * k; L = 0.13 if k == 0 else 0.11
        bm = block((-L / 2, -0.04, 0.025), (L / 2, 0.04, 0.07), 0.004, 1); S.xform(bm, (0, 0, 0), (0, 0, ang)); S.xform(bm, tuple(c)); G.add(bm, M['train'], wa(), wrap=False)
        if k == 0:
            G.add(lathe_bm([(0.0, 0.025), (1.0, 0.025)], c - d * 0.04 + Vector((0, 0, 0.07)), c + d * 0.05 + Vector((0, 0, 0.07)), 10), M['train'], wa(), smooth=True, wrap=False)
            G.add(lathe_bm([(0.0, 0.012), (0.8, 0.012), (1.0, 0.018)], c + d * 0.035 + Vector((0, 0, 0.09)), c + d * 0.035 + Vector((0, 0, 0.13)), 8), M['train'], wa(), smooth=True, wrap=False)
        for s_ in (-1, 1):
            for w in (-1, 1): G.add(lathe_bm([(0.0, 0.02), (1.0, 0.02)], c + d * w * L * 0.3 + e * s_ * 0.038 + Vector((0, 0, 0.02)), c + d * w * L * 0.3 + e * s_ * 0.05 + Vector((0, 0, 0.02)), 10), M['iron'], ma(), wrap=False)
    # a spinning top on its side; a teddy bear sitting
    tp = Vector((rnd.uniform(x0, x1), rnd.uniform(y0, y1), 0.03))
    G.add(lathe_bm([(0.0, 0.0), (0.3, 0.035), (0.6, 0.04), (0.8, 0.02), (1.0, 0.006)], tp - Vector((0.04, 0, 0)), tp + Vector((0.06, 0.01, 0.0)), 12), M['top'], wa(), smooth=True, wrap=False)
    return tp

def teddy(G, M, c, face, rnd, s=1.0):
    c = Vector(c); f = Vector((face[0], face[1], 0)).normalized(); sd = Vector((-f.y, f.x, 0)); up = Vector((0, 0, 1))
    pillow(G, M['teddy'], tuple(c + up * 0.08 * s), 0.13 * s, 0.11 * s, 0.17 * s, rnd, n=5, sag=0.0)
    hd = c + up * 0.21 * s + f * 0.01 * s
    G.add(lathe_bm([(0.0, 0.0), (0.2, 0.055 * s), (0.6, 0.062 * s), (1.0, 0.0)], hd - up * 0.055 * s, hd + up * 0.06 * s, 12), M['teddy'], fa(rnd), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.025 * s), (1.0, 0.0)], hd + f * 0.04 * s - up * 0.01 * s, hd + f * 0.085 * s - up * 0.015 * s, 10), M['teddy'], fa(rnd), smooth=True, wrap=False)
    for sx in (-1, 1):
        G.add(lathe_bm([(0.0, 0.022 * s), (0.5, 0.025 * s), (1.0, 0.0)], hd + sd * sx * 0.045 * s + up * 0.04 * s, hd + sd * sx * 0.05 * s + up * 0.06 * s - f * 0.005 * s, 8), M['teddy'], fa(rnd), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.0), (0.5, 0.006 * s), (1.0, 0.0)], hd + f * 0.05 * s + sd * sx * 0.022 * s + up * 0.012 * s, hd + f * 0.058 * s + sd * sx * 0.022 * s + up * 0.012 * s, 8), M['eye'], ma(), wrap=False)
        G.add(lathe_bm([(0.0, 0.03 * s), (1.0, 0.025 * s)], c + sd * sx * 0.05 * s + up * 0.03 * s, c + sd * sx * 0.06 * s + f * 0.12 * s + up * 0.02 * s, 8), M['teddy'], fa(rnd), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.022 * s), (1.0, 0.018 * s)], c + sd * sx * 0.07 * s + up * 0.14 * s, c + sd * sx * 0.09 * s + f * 0.06 * s + up * 0.06 * s, 8), M['teddy'], fa(rnd), smooth=True, wrap=False)

def dollhouse_set(G, M, rnd):
    """round the dolls' house (appended, on its own stand): the rug, a child's chair before it, a doll's pram beside it, the toys"""
    rx, ry = 0.795, 0.645
    P = [[Vector((-rx + 2 * rx * i / 10, -ry + 2 * ry * j / 8, 0.004 + 0.002 * math.sin(i * 1.3 + j))) for i in range(11)] for j in range(9)]
    grid_surface(G, M['rug'], P, attrs_of(lambda q: ((q[0] + rx) / (2 * rx), (q[1] + ry) / (2 * ry), 0.0), 0.5), flip_to=lambda q: Vector((0, 0, 1)))
    import furn_wood3 as W3
    W3.chair(G, M, (-0.53, -0.47, 0.0), (0.0, 1.0), rnd)
    pc = Vector((0.645, 0.22, 0.0))
    for sx in (-1, 1):
        for y in (-0.13, 0.13): G.add(lathe_bm([(0.0, 0.07), (1.0, 0.07)], pc + Vector((sx * 0.13, y, 0.07)), pc + Vector((sx * 0.145, y, 0.07)), 12), M['iron'], ma(), wrap=False)
    G.add(lathe_bm([(0.0, 0.08), (0.5, 0.115), (1.0, 0.105)], pc + Vector((0, -0.18, 0.34)), pc + Vector((0, 0.18, 0.34)), 12, (True, True)), M['pram'], ma(), smooth=True, wrap=False)
    tube(G, M['iron'], [pc + Vector((0, 0.18, 0.34)), pc + Vector((0, 0.3, 0.58)), pc + Vector((0, 0.32, 0.64))], 0.006, 6, ma())
    for sx in (-1, 1): tube(G, M['iron'], [pc + Vector((sx * 0.11, -0.12, 0.07)), pc + Vector((sx * 0.1, 0.0, 0.25)), pc + Vector((sx * 0.11, 0.12, 0.07))], 0.005, 6, ma())
    toys(G, M, rnd, (-0.2, 0.45, -0.6, -0.3), 12)
    teddy(G, M, (0.58, -0.4, 0.0), (-0.3, -1.0), rnd, 1.1)

def dh_materials():
    M = doll_materials('isl_dh'); k = 'isl_dh'
    M['stand'] = Dr.paint(k + '_stand', ['#5a4434', '#c9b98f', '#8a5a3c'], 'pine', [], kick=0.3, chips=1.0, gloss=0.35, age=1.5, joints=False)
    M['chair'] = Dr.paint(k + '_chair', ['#8b4a35', '#c9b98f', '#8a5a3c'], 'pine', [], kick=0.4, chips=1.4, gloss=0.3, age=1.6, joints=False)
    M['rush'] = kitlib.fabric(k + '_rush', '#9a8458', weave=0.0, fade=0.3, stripes=('#6f5d3a', 0.008), age=1.6)
    M['rug'] = kitlib.fabric(k + '_rug', '#7a3a32', weave=0.0, fade=0.6, stripes=('#a88c6a', 0.09), age=1.8)
    M['bricks'] = Dr.paint(k + '_bricks', ['#c8a64a', '#3f6a8a', '#a07a50'], 'pine', [], kick=0.0, chips=1.2, gloss=0.35, age=1.6, joints=False)
    M['train'] = Dr.paint(k + '_train', ['#2f4a6a', '#c43a2a', '#a07a50'], 'pine', [], kick=0.0, chips=1.0, gloss=0.4, age=1.5, joints=False)
    M['top'] = Dr.paint(k + '_top', ['#c43a2a', '#e0b440', '#a07a50'], 'pine', [], kick=0.0, chips=0.8, gloss=0.4, age=1.4, joints=False)
    M['iron'] = kitlib.metal(k + '_iron', 'iron', rust=0.6, age=1.4); M['pram'] = kitlib.fabric(k + '_pram', '#3a3028', weave=0.0, fade=0.4, age=1.6)
    M['teddy'] = kitlib.fabric(k + '_teddy', '#9a7a52', weave=0.0, fade=0.4, velvet=True, age=1.8)
    return M

# ================================================================ the washstand
def washstand_set(G, M, rnd):
    W, D, zt = 1.0, 0.48, 0.78; yc = 0.36
    for sx in (-1, 1):                                                      # (turned legs, a stretcher shelf, the marble top, the tiled back)
        for sy in (-1, 1): turned(G, M['wood'], [(0.0, 0.02), (0.08, 0.017), (0.45, 0.022), (0.8, 0.019), (0.88, 0.024), (1.0, 0.024)], (sx * (W / 2 - 0.04), yc + sy * (D / 2 - 0.04), 0.0), (sx * (W / 2 - 0.04), yc + sy * (D / 2 - 0.04), zt - 0.03), 8, attrs=wa((0, 0, 1)))
    box(G, M['wood'], (-W / 2 + 0.03, yc - D / 2 + 0.03, 0.18), (W / 2 - 0.03, yc + D / 2 - 0.03, 0.2), wa((1, 0, 0)), 0.003)
    box(G, M['wood'], (-W / 2 + 0.02, yc - D / 2 + 0.02, zt - 0.12), (W / 2 - 0.02, yc + D / 2 - 0.02, zt - 0.03), wa((1, 0, 0)), 0.003)
    box(G, M['marble'], (-W / 2, yc - D / 2, zt - 0.03), (W / 2, yc + D / 2, zt), ma(), 0.006, 2)
    box(G, M['tiles'], (-W / 2, yc + D / 2 - 0.03, zt), (W / 2, yc + D / 2, 1.06), attrs_of(lambda q: (q[0], q[2], 0.0), 0.5), 0.003)
    box(G, M['wood'], (-W / 2 - 0.01, yc + D / 2 - 0.045, 1.06), (W / 2 + 0.01, yc + D / 2, 1.1), wa((1, 0, 0)), 0.004)
    for sx in (-1, 1): box(G, M['wood'], (sx * W / 2 - (0.02 if sx > 0 else 0), yc - D / 2 + 0.05, zt), (sx * W / 2 + (0.0 if sx > 0 else 0.02), yc + D / 2, zt + 0.18), wa((0, 1, 0)), 0.004)
    # the basin and jug, soap dish; a towel over the rail at the side
    bc = Vector((0.0, yc - 0.02, zt))
    G.add(lathe_bm([(0.0, 0.07), (0.3, 0.12), (0.7, 0.17), (0.9, 0.2), (1.0, 0.205)], bc, bc + Vector((0, 0, 0.11)), 24, (True, False)), M['china'], ma(), smooth=True, wrap=False)
    jc = Vector((0.0, yc - 0.02, zt + 0.015))
    G.add(lathe_bm([(0.0, 0.055), (0.2, 0.08), (0.45, 0.085), (0.7, 0.06), (0.85, 0.05), (1.0, 0.065)], jc, jc + Vector((0, 0, 0.27)), 20, (True, False)), M['china'], ma(), smooth=True, wrap=False)
    tube(G, M['china'], [jc + Vector((-0.06, 0, 0.24)), jc + Vector((-0.12, 0, 0.21)), jc + Vector((-0.12, 0, 0.11)), jc + Vector((-0.07, 0, 0.07))], 0.01, 6, ma())
    sp = Vector((0.33, yc + 0.05, zt))
    G.add(lathe_bm([(0.0, 0.04), (0.5, 0.05), (1.0, 0.055)], sp, sp + Vector((0, 0, 0.025)), 14, (True, False)), M['china'], ma(), smooth=True, wrap=False)
    tube(G, M['wood'], [Vector((W / 2 + 0.01, yc - 0.18, zt + 0.12)), Vector((W / 2 + 0.06, yc - 0.18, zt + 0.12)), Vector((W / 2 + 0.06, yc + 0.18, zt + 0.12)), Vector((W / 2 + 0.01, yc + 0.18, zt + 0.12))], 0.008, 6, wa((0, 1, 0)))
    def towel(u, v):
        y = yc - 0.16 + 0.32 * u; z = zt + 0.12 - 0.45 * v; x = W / 2 + 0.06 + 0.012 * (1 - v) + 0.01 * math.sin(9 * u + 4 * v) * v
        return Vector((x, y, z))
    drape(G, M['towel'], 8, 8, towel, fa(rnd, 2, 2), out=lambda q: Vector((1, 0, 0)))
    drape(G, M['towel'], 8, 4, lambda u, v: Vector((W / 2 + 0.06 - 0.02 - 0.015 * v, yc - 0.16 + 0.32 * u, zt + 0.12 - 0.3 * v)), fa(rnd, 2, 2), out=lambda q: Vector((-1, 0, 0)))
    # the tin hip bath before it: an oval tub with a high back, a rolled rim, japanned outside, cream inside, rusty at the seams
    bcen = Vector((-0.05, -0.33, 0.0)); A, B = 0.56, 0.31
    rows = []
    for j in range(9):
        t = j / 8; zz = 0.02 + 0.44 * t; sc = 0.86 + 0.14 * t
        rows.append([bcen + Vector((A * sc * math.cos(a), B * sc * math.sin(a), zz + (0.16 * t * max(0.0, -math.cos(a)) ** 2 if True else 0))) for a in np.linspace(0, 2 * math.pi, 41)[:-1]])
    grid_surface(G, M['japan'], rows, ma(), closed_u=True, flip_to=lambda q: Vector((q.x - bcen.x, q.y - bcen.y, 0)))
    inner = [[bcen + (p - bcen) * Vector((0.97, 0.95, 1.0)) + Vector((0, 0, 0.0 if j else 0.012)) for p in row] for j, row in enumerate(rows)]
    grid_surface(G, M['enamel'], inner, ma(), closed_u=True, flip_to=lambda q: Vector((bcen.x - q.x, bcen.y - q.y, 0)))
    floor_ = [bcen + Vector((A * 0.83 * math.cos(a) * r, B * 0.81 * math.sin(a) * r, 0.03)) for r in (1.0,) for a in np.linspace(0, 2 * math.pi, 41)[:-1]]
    bm = bmesh.new(); f_ = bm.faces.new([bm.verts.new(p) for p in floor_]); f_.normal_update()
    if f_.normal.z < 0: f_.normal_flip()
    bmesh.ops.triangulate(bm, faces=[f_]); G.add(bm, M['enamel'], ma(), wrap=False)
    tube(G, M['japan'], rows[-1] + [rows[-1][0]], 0.012, 6, ma(0.6))
    # an oilcloth laid under it all, the towel horse at the other side
    P = [[Vector((-0.695 + 1.39 * i / 6, -0.645 + 1.29 * j / 6, 0.003)) for i in range(7)] for j in range(7)]
    grid_surface(G, M['oilcloth'], P, attrs_of(lambda q: (q[0], q[1], 0.0), 0.5), flip_to=lambda q: Vector((0, 0, 1)))
    hx = -0.62
    for y in (-0.14, 0.14): tube(G, M['wood'], [Vector((hx, y, 0.0)), Vector((hx, y, 0.92))], 0.012, 6, wa((0, 0, 1)))
    for z in (0.4, 0.88): tube(G, M['wood'], [Vector((hx, -0.14, z)), Vector((hx, 0.14, z))], 0.01, 6, wa((0, 1, 0)))
    drape(G, M['towel2'], 8, 6, lambda u, v: Vector((hx - 0.015 + 0.03 * v * (1 - v) * 4 * 0 + (0.012 if v < 0.5 else -0.012) * math.sin(math.pi * v), -0.13 + 0.26 * u, 0.88 - 0.5 * v + 0.0 * u)), fa(rnd, 2, 2), out=lambda q: Vector((-1 if q.x < hx else 1, 0, 0)))

def ws_materials():
    k = 'isl_wash'; M = {}
    M['wood'] = kitlib.wood(k + '_wood', 'pine', 'varnish', stain='#6b4a2c', age=1.5)
    M['marble'] = kitlib.porcelain(k + '_marble', '#e6e2da', glaze=False, crackle=0.15, age=1.6)
    M['tiles'] = kitlib.fabric(k + '_tiles', '#d9d4c4', weave=0.0, fade=0.2, stripes=('#5a7a9a', 0.15), age=1.5)
    M['china'] = kitlib.porcelain(k + '_china', '#f0ebe0', crackle=0.5, age=1.6)
    M['towel'] = kitlib.fabric(k + '_towel', '#e3dccb', weave=0.0, fade=0.4, stripes=('#b04a4a', 0.12), age=1.8); M['towel2'] = kitlib.fabric(k + '_towel2', '#d9d0bf', weave=0.0, fade=0.5, age=1.9)
    M['oilcloth'] = kitlib.fabric(k + '_oilcloth', '#6a5a44', weave=0.0, fade=0.6, stripes=('#8a3a2a', 0.1), age=2.0)
    M['japan'] = Dr.paint(k + '_japan', ['#22201c', '#6a3a24', '#6a3a24'], 'steel', [], kick=0.4, chips=1.0, gloss=0.3, age=1.5, joints=False, rust=0.9)
    M['enamel'] = Dr.paint(k + '_enamel', ['#e2dccb', '#3a3a36', '#3a3a36'], 'steel', [], kick=0.0, chips=0.8, gloss=0.2, age=1.6, joints=False, rust=0.7)
    return M
