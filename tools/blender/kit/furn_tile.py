# Escape from Barbi Blue: the gallery floor's furniture (WP2.5b, tile style; build spec B3, B4, B6).
#   Col_column_tile_H350/H400/H450  a Tuscan column of veined marble up to the ceiling: a square plinth, a torus base, the shaft with its
#                                   entasis, astragal, echinus and a square abacus under the ceiling; chipped, grimy where hands went
#   Solid_display_bench     a long mahogany display table (0.7 x 3.1) with three glass domes on ebonised bases, a bisque doll sitting in
#                           each on a little velvet chair (the glass is the game's: reserved Glass)
#   Solid_plinth_bust       a marble pedestal and on it a porcelain bust of a girl under a bell jar (to 1.45 m)
#   Solid_vitrine_double    two glass vitrines back to back on one mahogany stand (0.99 x 2.0, 1.95 m): china, figures and dolls on
#                           glass shelves, seen from both sides
#   wall pieces (band): console + console_mirror, grandfather_clock (its pendulum swinging on Band_grandfather_clock_Pendulum),
#   doll_cabinet, china_cabinet, sideboard, hall_bench, gilt_mirror, umbrella_stand: see furn_tile2.py; islands: furn_tile3.py
#   py -3.11 tools/blender/kit/furn_tile.py [--preview] [--force] [--only columns,display_bench,...,bands,islands] [--sheets]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
import furnlib as F
from furnlib import wa, ma, turned, box, drape, pillow, grid_surface, fa
from doors import lathe_bm, tube, block, plate, attrs_of
from surfaces2 import sep, comb, finish
from kitlib import OPTS, TMP, lin

STYLE = 'tile'
random.seed(211)

# ================================================================ shared materials
def marble(name, base='#e6e1d6', vein='#7f7b74', age=1.3, dark=False):
    import modules as Mo
    return Mo.marble(name, base, vein, dark=dark, age=age)

def gilt(name, age=1.4):
    """gilding over gesso: bright gold on the high relief, rubbed through to red bole on the edges, dark and dusty in the hollows"""
    return kitlib.metal(name, 'brass', color='#b8954a', rust=0.0, age=age)

def mirror_glass(name):
    """old silvered glass: dark, a soft grey reflection, foxed: the silvering gone in blooms from the edges and in spots"""
    m = kitlib.Mat(name); g = m.attr('gpos', True)
    fox = m.remap(m.noise(g, 9, 4, 0.6), 0.58, 0.68); spots = m.remap(m.voronoi(m.map(g, (1, 1, 1)), 40, 'Distance'), 0.05, 0.02)
    dead = m.math('MAXIMUM', fox, m.math('MULTIPLY', spots, 0.8))
    col = m.mix(dead, (0.32, 0.32, 0.31), (0.12, 0.1, 0.08))
    metal_ = m.mixf(dead, 1.0, 0.0); rough = m.mixf(dead, 0.06, 0.7)
    return finish(m, col, rough, m.val(0.0), metal=metal_)

def tile_mats(k):
    M = {}
    M['mahogany'] = Dr.mahogany(k + '_mahogany'); M['marble'] = marble(k + '_marble'); M['gilt'] = gilt(k + '_gilt')
    M['ebony'] = kitlib.wood(k + '_ebony', 'mahogany', 'varnish', stain='#1a1210', age=1.3)
    M['velvet'] = kitlib.fabric(k + '_velvet', '#6a1e2a', weave=0.0, fade=0.5, velvet=True, age=1.5)
    M['brass'] = kitlib.metal(k + '_brass', 'brass', color='#a4824a', rust=0.0, age=1.4); M['glass'] = kitlib.glass()
    M['china'] = kitlib.porcelain(k + '_china', '#f0ebe0', crackle=0.4, age=1.5)
    M['chinaB'] = kitlib.porcelain(k + '_chinaB', '#d9e2ea', crackle=0.3, age=1.5)
    M['dark'] = kitlib.grey(k + '_dark', (0.012, 0.01, 0.008))
    return M

# ================================================================ the columns
def column(G, M, rnd, H):
    """a Tuscan column filling its 0.66 m box from the floor to H (the ceiling): plinth, base mouldings, the shaft (diameter 0.44 at
       the foot, entasis to 0.37 under the capital), astragal, echinus, abacus"""
    pw = 0.66; ph = 0.16; ab = 0.07
    box(G, M['marble'], (-pw / 2, -pw / 2, 0.0), (pw / 2, pw / 2, ph), ma(0.35), 0.008, 2)
    base = [(0.0, 0.3), (0.3, 0.3), (0.45, 0.285), (0.6, 0.26), (0.7, 0.245), (0.8, 0.24), (0.9, 0.232), (1.0, 0.225)]
    turned(G, M['marble'], base, (0, 0, ph), (0, 0, ph + 0.11), 28, attrs=ma(0.3))
    z0, z1 = ph + 0.11, H - ab - 0.19
    prof = [(t, 0.22 - 0.035 * max(0.0, (t - 0.33) / 0.67) ** 1.6) for t in np.linspace(0, 1, 9)]
    turned(G, M['marble'], prof, (0, 0, z0), (0, 0, z1), 28, (False, False), ma(0.1))
    cap = [(0.0, 0.186), (0.08, 0.2), (0.16, 0.2), (0.24, 0.186), (0.3, 0.19), (0.55, 0.205), (0.75, 0.25), (0.88, 0.29), (1.0, 0.3)]
    turned(G, M['marble'], cap, (0, 0, z1), (0, 0, H - ab), 28, (False, True), ma(0.2))
    box(G, M['marble'], (-0.33, -0.33, H - ab), (0.33, 0.33, H), ma(0.1), 0.006, 2)

# ================================================================ the display bench
def bell_jar(G, M, c, r, h, base_h=0.04):
    """a glass dome on a turned ebonised base"""
    c = Vector(c)
    G.add(lathe_bm([(0.0, r + 0.025), (0.4, r + 0.028), (0.75, r + 0.018), (1.0, r + 0.01)], c, c + Vector((0, 0, base_h)), 28, (True, True)), M['ebony'], wa((1, 0, 0)), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r), (0.7, r * 0.99), (0.85, r * 0.9), (0.94, r * 0.7), (0.99, r * 0.35), (1.0, 0.0)], c + Vector((0, 0, base_h)), c + Vector((0, 0, base_h + h)), 28, (False, False)), M['glass'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.018), (0.5, 0.022), (1.0, 0.0)], c + Vector((0, 0, base_h + h - 0.005)), c + Vector((0, 0, base_h + h + 0.03)), 12), M['glass'], ma(), smooth=True, wrap=False)

def little_chair(G, M, c, face, s=1.0):
    """a doll's chair: velvet seat, gilt legs and back"""
    c = Vector(c); f = Vector((face[0], face[1], 0)).normalized(); sd = Vector((-f.y, f.x, 0)); W = 0.12 * s; zs = 0.09 * s
    P = lambda a, b, z: c + sd * a + f * b + Vector((0, 0, z))
    for a in (-W / 2, W / 2):
        for b in (-W / 2, W / 2): tube(G, M['gilt'], [P(a, b, 0.0), P(a, b, zs)], 0.005 * s, 5, ma(0.4))
        tube(G, M['gilt'], [P(a, -W / 2, zs), P(a * 0.9, -W / 2 - 0.01 * s, zs + 0.12 * s)], 0.005 * s, 5, ma(0.4))
    tube(G, M['gilt'], [P(-W / 2 * 0.9, -W / 2 - 0.01 * s, zs + 0.12 * s), P(0, -W / 2 - 0.012 * s, zs + 0.135 * s), P(W / 2 * 0.9, -W / 2 - 0.01 * s, zs + 0.12 * s)], 0.006 * s, 5, ma(0.4))
    pillow(G, M['velvet'], tuple(c + Vector((0, 0, zs + 0.01 * s))), W, W, 0.025 * s, random.Random(int(c.x * 100)), n=4, sag=0.2)
    return c + Vector((0, 0, zs + 0.02 * s)) - f * 0.01 * s

def display_bench(G, M, rnd):
    W, L, zt = 0.69, 3.09, 0.74
    box(G, M['mahogany'], (-W / 2, -L / 2, zt - 0.03), (W / 2, L / 2, zt), wa((0, 1, 0), wear=0.3), 0.006, 2)
    box(G, M['mahogany'], (-W / 2 + 0.03, -L / 2 + 0.03, zt - 0.13), (W / 2 - 0.03, L / 2 - 0.03, zt - 0.03), wa((0, 1, 0)), 0.004, 1)
    for y in (-L / 2 + 0.07, -0.5, 0.5, L / 2 - 0.07):
        for sx in (-1, 1):
            turned(G, M['mahogany'], [(0.0, 0.022), (0.05, 0.03), (0.12, 0.024), (0.3, 0.028), (0.55, 0.032), (0.75, 0.026), (0.85, 0.03), (1.0, 0.03)],
                   (sx * (W / 2 - 0.07), y, 0.0), (sx * (W / 2 - 0.07), y, zt - 0.13), 10, attrs=wa((0, 0, 1)))
    for sx in (-1, 1): box(G, M['mahogany'], (sx * (W / 2 - 0.07) - 0.015, -L / 2 + 0.07, 0.1), (sx * (W / 2 - 0.07) + 0.015, L / 2 - 0.07, 0.13), wa((0, 1, 0)), 0.003)
    box(G, M['velvet'], (-W / 2 + 0.02, -L / 2 + 0.02, zt), (W / 2 - 0.02, L / 2 - 0.02, zt + 0.004), fa(rnd, 3, 3), 0.0)   # (a velvet runner on it)
    import furn_wood4 as W4
    DM = W4.doll_materials('tile_bench')
    for k, v in DM.items(): M.setdefault(k, v)
    for k, y in enumerate((-1.0, 0.0, 1.0)):
        c = Vector((0.0, y, zt + 0.004)); bell_jar(G, M, c, 0.21, 0.43)
        seat = little_chair(G, M, c + Vector((0, 0.03, 0.04)), (0.0, -1.0), 1.0)
        W4.seated_doll(G, M, seat, (0.0, -1.0), rnd, 0.75, bonnet=(k == 1), frock=('frockB', 'frockA', 'frockD')[k], lod=0.75)

# ================================================================ the bust
def bust(G, M, c, s=1.0):
    """a porcelain bust of a girl: a socle, the shoulders and breast draped, the neck, the head with its features softened, hair
       drawn up into a knot, a ribbon (built life-size for a 0.45 m bust, then scaled by s about its foot)"""
    c = Vector(c); up = Vector((0, 0, 1)); f = Vector((0, -1, 0))
    def add(bm, smooth=True):
        for v in bm.verts: v.co = c + (v.co - c) * s
        G.add(bm, M['china'], ma(), smooth=smooth, wrap=False)
    add(block(tuple(c + Vector((-0.06, -0.06, 0.0))), tuple(c + Vector((0.06, 0.06, 0.03))), 0.004, 1), False)   # (a square socle, a waisted stem)
    add(lathe_bm([(0.0, 0.042), (0.3, 0.03), (0.7, 0.032), (1.0, 0.05)], c + up * 0.03, c + up * 0.08, 16))
    sh = c + up * 0.08
    bm = lathe_bm([(0.0, 0.05), (0.2, 0.1), (0.5, 0.125), (0.75, 0.115), (0.9, 0.08), (1.0, 0.032)], sh, sh + up * 0.15, 22, (True, False))
    for v in bm.verts:                                                      # (shoulders: broad, shallow, sloping down from the neck)
        rel = v.co - sh; v.co.x = sh.x + rel.x * 1.3; v.co.y = sh.y + rel.y * 0.5
        if rel.z > 0.06: v.co.z -= 0.05 * min(1.0, abs(rel.x) * 1.3 / 0.16) ** 2 * (rel.z - 0.06) / 0.09
    add(bm)
    nk = sh + up * 0.13; hd = nk + up * 0.1
    add(lathe_bm([(0.0, 0.03), (1.0, 0.026)], nk, nk + up * 0.05, 12))
    bm = lathe_bm([(0.0, 0.0), (0.12, 0.035), (0.35, 0.055), (0.6, 0.06), (0.85, 0.052), (1.0, 0.0)], hd - up * 0.06, hd + up * 0.07, 18)
    for v in bm.verts:
        rel = v.co - hd
        if rel.dot(f) > 0: v.co += f * rel.dot(f) * 0.1 * math.exp(-(rel.z / 0.04) ** 2)
        v.co.y = hd.y + (v.co.y - hd.y) * 1.08
    add(bm)
    add(lathe_bm([(0.0, 0.0), (0.5, 0.008), (1.0, 0.0)], hd + f * 0.058, hd + f * 0.075 - up * 0.012, 8))   # (the nose)
    add(lathe_bm([(0.0, 0.0), (0.4, 0.035), (0.8, 0.03), (1.0, 0.0)], hd - f * 0.03 + up * 0.05, hd - f * 0.07 + up * 0.1, 14))   # (the knot of hair)

def plinth_bust(G, M, rnd):
    box(G, M['marble'], (-0.3, -0.3, 0.0), (0.3, 0.3, 0.08), ma(0.3), 0.008, 2)
    box(G, M['marble'], (-0.26, -0.26, 0.08), (0.26, 0.26, 0.14), ma(0.2), 0.006, 2)
    turned(G, M['marble'], [(0.0, 0.17), (0.08, 0.15), (0.15, 0.14), (0.5, 0.13), (0.85, 0.14), (0.92, 0.15), (1.0, 0.17)], (0, 0, 0.14), (0, 0, 0.94), 24, attrs=ma(0.1))
    box(G, M['marble'], (-0.27, -0.27, 0.94), (0.27, 0.27, 1.0), ma(0.3), 0.006, 2)
    bust(G, M, (0.0, 0.0, 1.04), 0.85)
    bell_jar(G, M, (0.0, 0.0, 1.0), 0.18, 0.38)

# ================================================================ the vitrine
def vitrine_double(G, M, rnd):
    W, L, H = 0.975, 1.985, 1.95; zb = 0.62
    for sx in (-1, 1):                                                       # (the stand: a frame on turned legs)
        for sy in (-1, 1): turned(G, M['mahogany'], [(0.0, 0.025), (0.08, 0.032), (0.2, 0.026), (0.5, 0.03), (0.85, 0.026), (1.0, 0.03)], (sx * (W / 2 - 0.05), sy * (L / 2 - 0.05), 0.0), (sx * (W / 2 - 0.05), sy * (L / 2 - 0.05), zb - 0.1), 10, attrs=wa((0, 0, 1)))
    box(G, M['mahogany'], (-W / 2, -L / 2, zb - 0.1), (W / 2, L / 2, zb), wa((0, 1, 0)), 0.005, 2)
    box(G, M['mahogany'], (-W / 2 + 0.06, -L / 2 + 0.06, 0.12), (W / 2 - 0.06, L / 2 - 0.06, 0.14), wa((0, 1, 0)), 0.003)
    # the case: corner posts, top with a cornice, a middle partition (the two vitrines back to back), glass all round
    for sx in (-1, 1):
        for sy in (-1, 1): box(G, M['mahogany'], (sx * W / 2 - (0.04 if sx > 0 else 0), sy * L / 2 - (0.04 if sy > 0 else 0), zb), (sx * W / 2 + (0 if sx > 0 else 0.04), sy * L / 2 + (0 if sy > 0 else 0.04), H - 0.08), wa((0, 0, 1)), 0.004)
    box(G, M['mahogany'], (-W / 2 - 0.0, -L / 2, H - 0.08), (W / 2, L / 2, H - 0.05), wa((0, 1, 0)), 0.004)
    box(G, M['mahogany'], (-W / 2 + 0.01, -L / 2 + 0.01, H - 0.05), (W / 2 - 0.01, L / 2 - 0.01, H), wa((0, 1, 0), wear=0.2), 0.008, 2)
    box(G, M['mahogany'], (-0.012, -L / 2 + 0.04, zb), (0.012, L / 2 - 0.04, H - 0.08), wa((0, 1, 0)), 0.0)   # (the partition)
    for sx in (-1, 1):                                                        # (glass: the long sides, the ends)
        x = sx * (W / 2 - 0.02)
        G.add(Dr.quad_bm([(x, -L / 2 + 0.04, zb), (x, L / 2 - 0.04, zb), (x, L / 2 - 0.04, H - 0.08), (x, -L / 2 + 0.04, H - 0.08)], (sx, 0, 0)), M['glass'], ma(), wrap=False)
        box(G, M['mahogany'], (x - 0.012, -0.012, zb), (x + 0.012, 0.012, H - 0.08), wa((0, 0, 1)), 0.002)   # (the doors' meeting stiles)
    for sy in (-1, 1):
        y = sy * (L / 2 - 0.02)
        G.add(Dr.quad_bm([(-W / 2 + 0.04, y, zb), (W / 2 - 0.04, y, zb), (W / 2 - 0.04, y, H - 0.08), (-W / 2 + 0.04, y, H - 0.08)], (0, sy, 0)), M['glass'], ma(), wrap=False)
    for z in (zb + 0.42, zb + 0.82):                                          # (glass shelves, each side of the partition)
        for sx in (-1, 1):
            a, b = sorted((sx * 0.015, sx * (W / 2 - 0.04)))
            box(G, M['glass'], (a, -L / 2 + 0.04, z - 0.006), (b, L / 2 - 0.04, z), ma(), 0.0)
    # what's in them: plates standing up against the partition, cups, figures, a doll lying
    for sx in (-1, 1):
        for z in (zb, zb + 0.42, zb + 0.82):
            y = -L / 2 + 0.14
            while y < L / 2 - 0.14:
                kind = rnd.random(); xx = sx * 0.06
                if kind < 0.45:                                               # (a plate on its stand)
                    c = Vector((sx * 0.05, y, z + 0.11)); bm = lathe_bm([(0.0, 0.0), (0.85, 0.108), (1.0, 0.103)], c + Vector((sx * 0.004, 0, 0)), c - Vector((sx * 0.012, 0, 0)), 16, (True, False))
                    S.xform(bm, (-c.x, -c.y, -c.z)); S.xform(bm, (0, 0, 0), (0, sx * -0.25, 0)); S.xform(bm, tuple(c)); G.add(bm, M['chinaB' if rnd.random() < 0.5 else 'china'], ma(), smooth=True, wrap=False); y += 0.27
                elif kind < 0.8:                                              # (a cup and saucer)
                    c = Vector((sx * 0.22, y, z))
                    G.add(lathe_bm([(0.0, 0.0), (0.5, 0.055), (1.0, 0.06)], c, c + Vector((0, 0, 0.008)), 8), M['china'], ma(), smooth=True, wrap=False)
                    G.add(lathe_bm([(0.0, 0.02), (0.4, 0.035), (1.0, 0.04)], c + Vector((0, 0, 0.008)), c + Vector((0, 0, 0.055)), 8, (True, False)), M['china'], ma(), smooth=True, wrap=False); y += 0.2
                else:                                                         # (a little porcelain figure)
                    c = Vector((sx * 0.22, y, z))
                    G.add(lathe_bm([(0.0, 0.03), (0.4, 0.035), (0.6, 0.016), (0.8, 0.02), (1.0, 0.0)], c, c + Vector((0, 0, 0.17)), 7), M['china'], ma(), smooth=True, wrap=False); y += 0.18

# ================================================================ main
def mats(k): return lambda: tile_mats(k)

def main():
    want = lambda k: OPTS.only is None or k in OPTS.only
    if want('columns') or want('column_tile'):
        F.run(STYLE, 'columns', [(f'Col_column_tile_H{h}', f'column_tile_H{h}', (lambda G, M, r, h=h: column(G, M, r, h / 100)), mats('column_tile'), 300 + h, 1024) for h in (350, 400, 450)])
    if want('display_bench'): F.run(STYLE, 'display_bench', [('Solid_display_bench', 'display_bench', display_bench, mats('display_bench'), 31, 2048)])
    if want('plinth_bust'): F.run(STYLE, 'plinth_bust', [('Solid_plinth_bust', 'plinth_bust', plinth_bust, mats('plinth_bust'), 37, 1024)])
    if want('vitrine_double'): F.run(STYLE, 'vitrine_double', [('Solid_vitrine_double', 'vitrine_double', vitrine_double, mats('vitrine_double'), 41, 2048)])
    import furn_tile2 as T2
    for node, nm, fn, px in T2.BANDS:
        if want(nm) or want('bands') or want(node):
            F.run(STYLE, f'band_{nm}', [(node, f'band_{nm}', fn, (lambda nm=nm: T2.band_mats(nm)), hash(nm) & 0xfff, px)], wall=True)
    isl = [k for k in ('isl_dining', 'isl_grand_piano', 'isl_parlour', 'isl_reading') if want(k) or want('islands')]
    if isl:
        import furn_tile3 as T3
        F.islands(STYLE, T3.build_islands, isl)

if __name__ == '__main__':
    main()
