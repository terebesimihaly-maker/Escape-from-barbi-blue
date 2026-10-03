# Escape from Barbi Blue: the doll works' wall pieces (WP2.5e, workshop; build spec B6), built by furn_workshop.py:
#   Band_eye_shelf       five shelves of glass jars packed with glass eyes, labelled by colour and size
#   Band_tool_wall       a plank board of the doll maker's tools on nails: modelling tools, knives, rasps, callipers, small hammers
#   Band_parts_drawers   a cabinet of small drawers with brass label frames, three of them pulled out on eyes, hands, teeth
#   Band_limb_hooks      a rail of hooks with porcelain arms and legs hung on them by strings
#   Band_paint_shelf     shelves of paint and slip: tins, jars of pigment, brushes standing in pots, a doll's head half painted
#   Band_filing_cabinet  an oak four-drawer filing cabinet, card frames on the drawers, one pulled out on its files
#   Band_head_shelf      two shelves of doll heads on brackets (1.30, 1.78 m): some with eyes, some with empty sockets, a few wigs
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
import furn_workshop as WS

def band_mats(nm):
    k = f'band_{nm}'; M = WS.ws_mats(k)
    for i, (c, s) in enumerate((('#d8cfb4', '#2a2a2a'), ('#c9b78a', '#6a2a1e'), ('#e6dcc0', '#2a3a5a'))): M[f'label{i}'] = kitlib.fabric(f'{k}_label{i}', c, weave=0.0, fade=0.7, stripes=(s, 0.012), age=2.0)
    for i, c in enumerate(('#8a2a24', '#2a4a7a', '#d8c060', '#3a6a3a', '#e8e0d0', '#1a1a1a')): M[f'paint{i}'] = kitlib.porcelain(f'{k}_paint{i}', c, glaze=True, crackle=0.0, age=1.6)
    return M

def shelf_unit(G, M, W, D, H, levels, mat='pine'):
    """an open shelf unit against the wall: two sides, a back, the shelves at levels"""
    for sx in (-1, 1):
        xa, xb = sorted((sx * W / 2, sx * (W / 2 - 0.02))); box(G, M[mat], (xa, -D, 0.0), (xb, 0.0, H), wa((0, 0, 1)), 0.003)
    box(G, M[mat], (-W / 2 + 0.02, -0.012, 0.0), (W / 2 - 0.02, 0.0, H), wa((0, 0, 1)), 0.0)
    for z in levels: box(G, M[mat], (-W / 2 + 0.02, -D, z - 0.02), (W / 2 - 0.02, -0.012, z), wa((1, 0, 0), wear=0.3), 0.002)
    box(G, M[mat], (-W / 2, -D, H - 0.02), (W / 2, 0.0, H), wa((1, 0, 0)), 0.002)

# ================================================================ jars of eyes
def eye_jar(G, M, c, r, h, rnd, fill=0.8):
    c = Vector(c)
    G.add(lathe_bm([(0.0, r * 0.94), (1.0, r * 0.94)], c + Vector((0, 0, 0.003)), c + Vector((0, 0, h * fill)), 8, (False, True)), M['eyemass'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r), (0.85, r), (1.0, r * 0.8)], c, c + Vector((0, 0, h)), 8, (False, False)), M['glass'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r * 0.84), (1.0, r * 0.8)], c + Vector((0, 0, h)), c + Vector((0, 0, h + 0.02)), 8, (False, True)), M['tin'], ma(0.4), smooth=True, wrap=False)
    lb = rnd.randrange(3); w = r * 1.1
    bm = block((-w / 2, -0.0008, -0.025), (w / 2, 0.0, 0.025), 0.0, 1); S.xform(bm, (c.x, c.y - r - 0.0006, c.z + h * 0.45)); G.add(bm, M[f'label{lb}'], fa(rnd, 8, 8), wrap=False)

def eye_shelf(G, M, rnd):
    W, D, H = 1.3, 0.3, 1.9; levels = [0.06, 0.44, 0.82, 1.2, 1.56]
    shelf_unit(G, M, W, D, H, levels, 'oak')
    for z in levels:
        x = -W / 2 + 0.06
        while x < W / 2 - 0.08:
            r = rnd.uniform(0.055, 0.075); h = min(rnd.uniform(0.15, 0.24), 0.32)
            if x + 2 * r > W / 2 - 0.03: break
            if rnd.random() < 0.18: x += 0.08; continue
            eye_jar(G, M, (x + r, -D / 2 - 0.02 + rnd.uniform(-0.02, 0.02), z), r, h, rnd, rnd.uniform(0.5, 0.9)); x += 2 * r + rnd.uniform(0.01, 0.03)
    for k in range(5):                                                          # (a few loose eyes on the shelves)
        z = rnd.choice(levels); WS.eye(G, M, (rnd.uniform(-0.5, 0.5), -0.05 - rnd.uniform(0, 0.03), z + 0.008), (rnd.uniform(-1, 1), -1.0, rnd.uniform(0, 1)), 0.008, rnd.choice(('eyeB', 'eyeH', 'eyeG')))

# ================================================================ the tool wall
def tool_wall(G, M, rnd):
    z0, z1, Wd = 0.82, 1.98, 1.58
    for k in range(9):                                                          # (vertical boards nailed to two battens)
        x0 = -Wd / 2 + k * Wd / 9; box(G, M['pine'], (x0 + 0.002, -0.032, z0), (x0 + Wd / 9 - 0.002, -0.012, z1), wa((0, 0, 1), wear=0.3), 0.002)
    for z in (z0 + 0.12, z1 - 0.12): box(G, M['pine'], (-Wd / 2, -0.012, z - 0.03), (Wd / 2, 0.0, z + 0.03), wa((1, 0, 0)), 0.002)
    kinds = ['saw', 'rasp', 'pliers', 'hammer', 'callipers', 'knife', 'knife', 'rasp', 'hammer', 'callipers', 'pliers', 'knife']
    for row, z in enumerate((1.86, 1.42)):
        for k, x in enumerate(np.linspace(-0.68, 0.68, 12 if row else 10)):
            if rnd.random() < 0.15: continue
            nail = Vector((x, -0.032, z)); G.add(lathe_bm([(0.0, 0.003), (1.0, 0.003)], nail, nail + Vector((0, -0.03, 0.005)), 5), M['steel'], ma(0.4), wrap=False)
            kind = kinds[(k + row * 5) % len(kinds)]
            if kind == 'saw' and z < 1.5: kind = 'knife'
            WS.tool(G, M, nail + Vector((0, -0.024, 0.0)), kind, rnd)
    for k in range(8):                                                          # (a rack of modelling tools in a strip of leather)
        x = -0.35 + 0.1 * k; box(G, M['oak'], (x - 0.006, -0.045, 1.0), (x + 0.006, -0.033, 1.13), wa((0, 0, 1)), 0.002)
        box(G, M['steel'], (x - 0.004, -0.043, 0.94), (x + 0.004, -0.035, 1.0), ma(0.3), 0.0)
    box(G, M['leather'], (-0.42, -0.05, 1.06), (0.42, -0.032, 1.1), fa(rnd), 0.002)

# ================================================================ the drawers
def parts_drawers(G, M, rnd):
    W, D, H, nc, nr = 1.0, 0.44, 1.3, 5, 8; D0 = 0.3                            # (the carcass 0.3 deep: pulled drawers stay in the band)
    box(G, M['oak'], (-W / 2, -D0, 0.0), (W / 2, 0.0, 0.08), wa((1, 0, 0)), 0.004)
    for sx in (-1, 1):
        xa, xb = sorted((sx * W / 2, sx * (W / 2 - 0.02))); box(G, M['oak'], (xa, -D0, 0.08), (xb, 0.0, H - 0.03), wa((0, 0, 1)), 0.003)
    box(G, M['oak'], (-W / 2 - 0.0, -D0 - 0.01, H - 0.03), (W / 2 + 0.0, 0.0, H), wa((1, 0, 0)), 0.004, 1)
    cw = (W - 0.04) / nc; ch = (H - 0.11) / nr; out = {(1, 4): 0.1, (3, 6): 0.08, (4, 2): 0.132}; D = D0
    for i in range(nc):
        for j in range(nr):
            x0 = -W / 2 + 0.02 + i * cw; z0 = 0.08 + j * ch; o = out.get((i, j), 0.0)
            box(G, M['oak'], (x0 + 0.003, -D + 0.02 - o, z0 + 0.003), (x0 + cw - 0.003, -D + 0.04 - o, z0 + ch - 0.003), wa((1, 0, 0)), 0.0)
            box(G, M['brass'], (x0 + cw / 2 - 0.03, -D + 0.017 - o, z0 + ch * 0.55), (x0 + cw / 2 + 0.03, -D + 0.02 - o, z0 + ch * 0.82), ma(0.5), 0.0)
            box(G, M[f'label{(i + j) % 3}'], (x0 + cw / 2 - 0.026, -D + 0.0168 - o, z0 + ch * 0.58), (x0 + cw / 2 + 0.026, -D + 0.017 - o, z0 + ch * 0.79), fa(rnd, 8, 8), 0.0)
            G.add(lathe_bm([(0.0, 0.006), (0.7, 0.009), (1.0, 0.0)], (x0 + cw / 2, -D + 0.02 - o, z0 + ch * 0.32), (x0 + cw / 2, -D + 0.0 - o, z0 + ch * 0.32), 6), M['brass'], ma(0.5), smooth=True, wrap=False)
            if o:                                                               # (pulled out: its sides and bottom, what's in it)
                for xx in (x0 + 0.006, x0 + cw - 0.012): box(G, M['oak'], (xx, -D + 0.04 - o, z0 + 0.006), (xx + 0.006, -D + 0.06, z0 + ch - 0.02), wa((0, 1, 0)), 0.0)
                box(G, M['oak'], (x0 + 0.006, -D + 0.04 - o, z0 + 0.006), (x0 + cw - 0.006, -D + 0.06, z0 + 0.012), wa((0, 1, 0)), 0.0)
                for k in range(7 if (i, j) != (3, 6) else 3):
                    p = Vector((x0 + rnd.uniform(0.025, cw - 0.025), -D + 0.06 - o + rnd.uniform(0.03, o - 0.01), z0 + 0.02))
                    if (i, j) == (3, 6): WS.limb(G, M, p, (rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.0), 'arm', 0.7, 'bisque', 0.2, 6)
                    else: WS.eye(G, M, p, (rnd.uniform(-1, 1), rnd.uniform(-1, 1), 1.0), 0.0075, rnd.choice(('eyeB', 'eyeH', 'eyeG')), (6, 4))

# ================================================================ limbs on hooks
def limb_hooks(G, M, rnd):
    z = 1.9; box(G, M['oak'], (-0.6, -0.025, z - 0.04), (0.6, 0.0, z + 0.04), wa((1, 0, 0)), 0.004)
    for k, x in enumerate(np.linspace(-0.52, 0.52, 9)):
        hk = Vector((x, -0.025, z))
        F.rod(G, M['steel'], [hk, hk + Vector((0, -0.05, -0.01)), hk + Vector((0, -0.065, 0.015))], 0.004, 5, ma(0.4), sub=1)
        n = rnd.randint(1, 3); bx = hk + Vector((0, -0.05, -0.012))
        for m_ in range(n):                                                     # (strings from the hook, a limb tied on each)
            L = rnd.uniform(0.08, 0.35); end = bx + Vector((rnd.uniform(-0.04, 0.04), rnd.uniform(-0.03, 0.03), -L))
            F.rod(G, M['string'], [bx, end], 0.0015, 3, fa(rnd))
            kind = 'arm' if rnd.random() < 0.55 else 'leg'
            WS.limb(G, M, end, (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), -1.0), kind, rnd.uniform(1.2, 1.6), rnd.choice(('bisque', 'bisque', 'green_ware')), rnd.uniform(0.0, 0.3), 7)

# ================================================================ paint
def paint_shelf(G, M, rnd):
    W, D, H = 1.2, 0.35, 1.8; levels = [0.06, 0.5, 0.94, 1.38]
    shelf_unit(G, M, W, D, H, levels, 'pine')
    for z in levels:
        x = -W / 2 + 0.05
        while x < W / 2 - 0.08:
            kind = rnd.random(); p = Vector((x, -D / 2 + rnd.uniform(-0.05, 0.05), z))
            if kind < 0.4:                                                      # (a paint tin, its lid crusted, a drip down it)
                r = rnd.uniform(0.04, 0.06); h = rnd.uniform(0.06, 0.12); p.x += r
                G.add(lathe_bm([(0.0, r), (1.0, r)], p, p + Vector((0, 0, h)), 10), M['tin'], ma(0.4), smooth=True, wrap=False)
                G.add(lathe_bm([(0.0, r + 0.002), (1.0, r * 0.9)], p + Vector((0, 0, h)), p + Vector((0, 0, h + 0.006)), 10), M[f'paint{rnd.randrange(6)}'], ma(), smooth=True, wrap=False)
                x += 2 * r + 0.02
            elif kind < 0.75:                                                   # (a jar of pigment)
                r = rnd.uniform(0.03, 0.045); h = rnd.uniform(0.1, 0.16); p.x += r
                G.add(lathe_bm([(0.0, r), (1.0, r)], p, p + Vector((0, 0, h * 0.7)), 10), M[f'paint{rnd.randrange(6)}'], ma(), smooth=True, wrap=False)
                G.add(lathe_bm([(0.0, r), (0.7, r), (1.0, r * 0.75)], p + Vector((0, 0, h * 0.7)), p + Vector((0, 0, h)), 10, (False, False)), M['glass'], ma(), smooth=True, wrap=False)
                x += 2 * r + 0.015
            else:                                                               # (brushes standing in a pot)
                r = 0.04; p.x += r
                G.add(lathe_bm([(0.0, r), (1.0, r * 1.05)], p, p + Vector((0, 0, 0.1)), 10, (True, False)), M['glaze'], ma(), smooth=True, wrap=False)
                for k in range(4):
                    a = 2 * math.pi * k / 4 + rnd.random(); bp = p + Vector((0.02 * math.cos(a), 0.02 * math.sin(a), 0.02))
                    tip = bp + Vector((0.04 * math.cos(a), 0.04 * math.sin(a), min(0.22, H - z - 0.08)))
                    F.rod(G, M['oak'], [bp, tip], 0.0035, 4, wa((0, 0, 1)))
                x += 2 * r + 0.02
    hd = Vector((0.35, -D / 2, levels[1] + 0.09))                               # (a head half painted: one cheek rouged, its eyes not in yet)
    WS.doll_head(G, M, hd, (0.0, -1.0), 1.0, None, 'bisque')

# ================================================================ the filing cabinet
def filing_cabinet(G, M, rnd):
    W, D, H = 0.45, 0.44, 1.3
    box(G, M['oak'], (-W / 2, -D + 0.01, 0.0), (W / 2, 0.0, 0.06), wa((1, 0, 0)), 0.004)
    box(G, M['oak'], (-W / 2, -D + 0.03, 0.06), (W / 2, 0.0, H - 0.03), wa((0, 0, 1)), 0.003, 1)
    box(G, M['oak'], (-W / 2 - 0.0, -D + 0.0, H - 0.03), (W / 2, 0.0, H), wa((1, 0, 0)), 0.004, 1)
    for k in range(4):
        z0 = 0.08 + k * 0.3; o = 0.0
        yd = -D + 0.025                                                        # (the drawer fronts, set back so their handles stay in the band)
        box(G, M['oak'], (-W / 2 + 0.02, yd, z0), (W / 2 - 0.02, yd + 0.015, z0 + 0.28), wa((1, 0, 0), wear=0.3), 0.004, 1)
        box(G, M['brass'], (-0.05, yd - 0.004, z0 + 0.2), (0.05, yd, z0 + 0.25), ma(0.5), 0.001)
        box(G, M[f'label{k % 3}'], (-0.045, yd - 0.0042, z0 + 0.205), (0.045, yd - 0.004, z0 + 0.245), fa(rnd, 8, 8), 0.0)
        F.rod(G, M['brass'], [(-0.05, yd, z0 + 0.14), (-0.04, yd - 0.016, z0 + 0.14), (0.04, yd - 0.016, z0 + 0.14), (0.05, yd, z0 + 0.14)], 0.004, 5, ma(0.5), sub=2)
    for k in range(3):                                                          # (papers left on top)
        box(G, M['card'], (-0.16 + 0.01 * k, -0.36 + 0.02 * k, H + 0.002 * k), (0.15 + 0.01 * k, -0.08 + 0.02 * k, H + 0.002 * k + 0.002), fa(rnd, 3, 3), 0.0)

# ================================================================ heads on shelves
def head_shelf(G, M, rnd):
    for z in (1.3, 1.78):
        box(G, M['oak'], (-0.79, -0.24, z - 0.025), (0.79, 0.0, z), wa((1, 0, 0), wear=0.3), 0.003, 1)
        for x in (-0.6, 0.0, 0.6):                                              # (iron brackets)
            F.rod(G, M['iron'], [(x, -0.004, z - 0.075), (x, -0.004, z - 0.03), (x, -0.2, z - 0.03), (x, -0.004, z - 0.075)], 0.006, 4, ma(0.4))
        for k, x in enumerate(np.linspace(-0.66, 0.66, 6)):
            if rnd.random() < 0.12: continue
            eyes = rnd.choice((None, 'eyeB', 'eyeH', None, 'eyeG')); wig = rnd.choice((None, None, 'hair', 'hair2'))
            WS.doll_head(G, M, (x + rnd.uniform(-0.01, 0.01), -0.12 + rnd.uniform(-0.02, 0.02), z + 0.09 * 1.0), (rnd.uniform(-0.35, 0.35), -1.0), 1.0, eyes, rnd.choice(('bisque', 'bisque', 'green_ware')), wig, tilt=rnd.uniform(-0.15, 0.15), sides=10, eseg=(6, 4))

BANDS = [('Band_eye_shelf', 'eye_shelf', eye_shelf, 2048), ('Band_tool_wall', 'tool_wall', tool_wall, 1024), ('Band_parts_drawers', 'parts_drawers', parts_drawers, 1024),
         ('Band_limb_hooks', 'limb_hooks', limb_hooks, 1024), ('Band_paint_shelf', 'paint_shelf', paint_shelf, 1024), ('Band_filing_cabinet', 'filing_cabinet', filing_cabinet, 1024),
         ('Band_head_shelf', 'head_shelf', head_shelf, 1024)]
