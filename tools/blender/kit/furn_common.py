# Escape from Barbi Blue: the servants' runs' wall pieces (WP2.5, 'common': any style's servant run and the F2 servants' hall;
# build spec B6 'servant'), packed into common.glb:
#   Band_service_shelf  a tall open dresser of painted deal against the passage wall: plinth, a boarded back, five shelves, the
#                       bottom one split into two bays, a plate rail; on it what a servant fetches and carries: ironstone plates on
#                       edge, a stack of them flat, bowls, jugs, a brown teapot, japanned tea and sugar canisters, folded linen, a brass
#                       chamberstick and a candle box, a stack of trays, a lamp-oil can, a box of boot brushes, a bucket
#   Band_bell_board     the servants' bell board high on the wall: a varnished pine board with moulded top and bottom, six brass bells
#                       hung on coiled spring arms from brass mounts, each with its clapper, under the rooms' names painted on ivorine
#                       plates (lettered from a font into a label atlas, baked), the bell wires coming out of the board above each mount
#   Band_conduit        what runs along the passage under the ceiling: a lead water pipe on iron pipe hooks with a wiped joint, two
#                       black steel conduits on a spacer-bar saddle, a round cast-iron junction box with its screwed lid; each run comes
#                       out of the wall at one end and goes back into it at the other
#   py -3.11 tools/blender/kit/furn_common.py [--preview] [--only service_shelf,bell_board,conduit] [--sheets]
import sys, os, math, random, zlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
import kitlib
import surfaces2 as S
import doors as Dr
import furnlib as F
from furnlib import wa, ma, box, pillow, fa
from doors import lathe_bm, tube, block, attrs_of
from surfaces2 import sep, comb, finish
from kitlib import OPTS, TMP, lin

STYLE = 'common'; LOOK = 'tile'          # (the sheets: on the F2 floor's boards against its wall, where the servants' hall is)

# ================================================================ materials
ROOMS = ('FRONT DOOR', 'DRAWING ROOM', 'DINING ROOM', 'LIBRARY', 'NURSERY', 'BEDROOM  No. 1')
FONTS = ('BOD_R.TTF', 'BASKVILL.TTF', 'CENTURY.TTF', 'times.ttf', 'georgia.ttf', 'DejaVuSerif.ttf')

def label_atlas(names, path, w=640, h=160):
    """the rooms' names, one label a row (white letters on black: the ink), spaced capitals in a Victorian serif within a ruled border"""
    from PIL import Image, ImageDraw, ImageFont
    font = next((os.path.join(d, f) for f in FONTS for d in (r'C:\Windows\Fonts', '/usr/share/fonts/truetype/dejavu', '/Library/Fonts')
                 if os.path.exists(os.path.join(d, f))), None)
    im = Image.new('L', (w, h * len(names)), 0); dr = ImageDraw.Draw(im)
    def fit(nm, size):
        fnt = ImageFont.truetype(font, size) if font else ImageFont.load_default(); track = size * 0.14
        widths = [dr.textlength(c, font=fnt) for c in nm]; return fnt, track, widths, sum(widths) + track * (len(nm) - 1)
    size = 84                                                            # (one size for every label, as a signwriter would: the longest fits)
    while size > 28 and max(fit(nm, size)[3] for nm in names) > w * 0.82: size -= 4
    for i, nm in enumerate(names):
        fnt, track, widths, tw = fit(nm, size)
        bb = dr.textbbox((0, 0), 'H', font=fnt); x = (w - tw) / 2; y = i * h + (h - (bb[3] - bb[1])) / 2 - bb[1]
        for c, cw in zip(nm, widths): dr.text((x, y), c, fill=255, font=fnt); x += cw + track
        dr.rectangle((12, i * h + 12, w - 13, (i + 1) * h - 13), outline=200, width=3)
    im.save(path); return path

def ivorine(name, img, n):
    """ivorine label plates (cream celluloid) with the rooms' names painted on in black: yellowed, darker toward the edges, the paint
       rubbed thin and flecked off where fingers pointed, a fine craze; lp = (u, v across the plate's face, which label)"""
    m = kitlib.Mat(name); lp = m.attr('lp', True); op = m.attr('opos', True); u, v, i = sep(m, lp)
    vv = m.math('ADD', m.math('SUBTRACT', 1.0, m.math('DIVIDE', m.math('ADD', i, 1.0), n)), m.math('DIVIDE', v, n))
    t = m.n('ShaderNodeTexImage', interpolation='Cubic', extension='EXTEND'); t.image = bpy.data.images.load(img, check_existing=True)
    t.image.colorspace_settings.name = 'Non-Color'; m.l(comb(m, u, vv, 0.0), t.inputs['Vector'])
    ink = m.math('MULTIPLY', t.outputs['Color'], 1.0)
    rub = m.math('MAXIMUM', m.remap(m.noise(op, 220, 4, 0.6), 0.64, 0.74), m.remap(m.noise(op, 35, 3), 0.62, 0.7, 0.0, 0.6))
    ink = m.math('MULTIPLY', ink, m.math('SUBTRACT', 1.0, m.math('MULTIPLY', rub, 0.85)))
    du = m.math('MINIMUM', m.math('MULTIPLY', m.math('MINIMUM', u, m.math('SUBTRACT', 1.0, u)), 4.0), m.math('MINIMUM', v, m.math('SUBTRACT', 1.0, v)))
    ground = m.mix(m.remap(m.noise(op, 30, 3), 0.3, 0.7), lin('#e9dfc6'), lin('#d8c79e'))
    ground = m.mix(m.remap(du, 0.25, 0.0, 0.0, 0.6), ground, lin('#a88b5c'))
    cr = m.voronoi(op, 260, 'Distance', 'DISTANCE_TO_EDGE'); ground = m.mix(m.math('MULTIPLY', m.remap(cr, 0.03, 0.0), 0.5), ground, lin('#7a6440'))
    col = m.mix(ink, ground, lin('#1b1511'))
    rough = m.mixf(ink, 0.28, 0.5); h = m.math('MULTIPLY', ink, 0.00012)
    col, rough, h, worn = kitlib.aged(m, col, rough, h, up_dust=0.6, grime=0.8)
    return finish(m, col, rough, h)

def mats(nm):
    k = f'band_{nm}'; M = {}
    M['brass'] = kitlib.metal(k + '_brass', 'brass', color='#a8864a', rust=0.0, age=1.6); M['iron'] = kitlib.metal(k + '_iron', 'iron', rust=0.6, age=1.6)
    M['steel'] = kitlib.metal(k + '_steel', 'steel', color='#7c7f80', rust=0.45, age=1.6)
    if nm == 'service_shelf':
        M['paint'] = Dr.paint(k + '_paint', ['#cbc3a8', '#6d7a63', '#c4b393'], 'pine', [(-0.7, 0.7, 0.8, 1.3, 0.03, 0.5)], kick=0.3, chips=1.15,
                              gloss=0.3, age=1.7, joints=False)
        M['back'] = Dr.paint(k + '_back', ['#c7bea2', '#6d7a63', '#c4b393'], 'pine', [], kick=0.0, chips=0.5, gloss=0.25, age=1.8, joints=False)
        M['iron_st'] = kitlib.porcelain(k + '_ironstone', '#ece6d8', glaze=True, crackle=0.7, age=1.7)
        M['blue'] = kitlib.porcelain(k + '_blue', '#d9dee3', glaze=True, crackle=0.5, age=1.6)
        M['betty'] = kitlib.porcelain(k + '_betty', '#4a2414', glaze=True, crackle=0.2, age=1.5)
        M['japan'] = Dr.paint(k + '_japan', ['#2a1d16', '#7a2a1c', '#5a5a58'], 'steel', [], kick=0.0, chips=0.7, gloss=0.5, age=1.8, craze=0.0, joints=False, rust=0.6)
        M['japan2'] = Dr.paint(k + '_japan2', ['#5a1a14', '#2a1d16', '#5a5a58'], 'steel', [], kick=0.0, chips=0.7, gloss=0.5, age=1.8, craze=0.0, joints=False, rust=0.6)
        M['linen'] = kitlib.fabric(k + '_linen', '#e4ddcb', weave=1.1, fade=0.3, age=1.6)
        M['linen2'] = kitlib.fabric(k + '_linen2', '#d9d2c2', weave=1.0, fade=0.3, stripes=('#9a5a4a', 0.05), age=1.7)
        M['deal'] = kitlib.wood(k + '_deal', 'pine', 'bare', stain='#8a7a62', age=2.0)
        M['tray'] = Dr.paint(k + '_tray', ['#1e1a17', '#6a2a1a', '#5a5a58'], 'steel', [], kick=0.0, chips=0.9, gloss=0.55, age=1.6, craze=0.0, joints=False, rust=0.4)
        M['galv'] = kitlib.metal(k + '_galv', 'steel', color='#a3a6a2', rust=0.35, age=1.8)
        M['bristle'] = kitlib.fabric(k + '_bristle', '#1e1a16', weave=0.0, stripes=('#3a322a', 0.003), age=1.8)
        M['wax'] = kitlib.porcelain(k + '_wax', '#e8dfc4', glaze=False, crackle=0.0, age=1.4)
    if nm == 'bell_board':
        M['board'] = kitlib.wood(k + '_board', 'pine', 'varnish', stain='#5a3a20', age=1.25)
        img = label_atlas(ROOMS, os.path.join(TMP, 'tex', 'bell_board_labels.png'))
        M['label'] = ivorine(k + '_ivorine', img, len(ROOMS)); M['spring'] = kitlib.metal(k + '_spring', 'iron', rust=0.35, age=1.5)
    if nm == 'conduit':
        M['lead'] = kitlib.metal(k + '_lead', 'steel', color='#6c6f70', rust=0.0, age=2.0)
        M['tube'] = Dr.paint(k + '_tube', ['#1d1e1b', '#2c2b27', '#6a5a4a'], 'steel', [], kick=0.0, chips=0.6, gloss=0.42, age=1.9, craze=0.0, joints=False, rust=0.7)
        import modules as Mo
        M['cast'] = Mo.cast_iron(k + '_cast', 0.55, 0.3)
    return M

# ================================================================ small turned things
def lathe(G, mat, prof, p0, p1, sides=12, caps=(True, True), attrs=None):
    G.add(lathe_bm(prof, p0, p1, sides, caps), mat, attrs or ma(), smooth=True, wrap=False)

def handle(G, mat, c, side, r, z0, z1, wire=0.006):
    """a jug's or a cup's loop handle on its side (side +-1 along x), from z0 down to z1 on the body's surface at radius r"""
    out = 0.035 * (z0 - z1) / 0.1 + 0.012
    pts = [Vector((c.x + side * r * 0.96, c.y, z0)), Vector((c.x + side * (r + out * 0.8), c.y, z0 + 0.004)), Vector((c.x + side * (r + out), c.y, (z0 + z1) / 2)),
           Vector((c.x + side * (r + out * 0.6), c.y, z1 + 0.004)), Vector((c.x + side * r * 0.96, c.y, z1))]
    F.rod(G, mat, pts, wire, 4, ma(), sub=2)

PLATE = [(0.0, 0.0), (0.0, 0.055), (0.35, 0.1), (0.85, 0.121), (1.0, 0.125), (0.92, 0.104), (0.55, 0.0)]   # (foot, rim, well)

def plate(G, mat, c, axis, R=1.0, th=0.022, sides=12):
    a = Vector(axis).normalized(); c = Vector(c)
    lathe(G, mat, [(t, r * R) for t, r in PLATE], c, c + a * th, sides, (False, False))

# ================================================================ the service shelf
def service_shelf(G, M, rnd):
    W, D, H, t = 1.4, 0.25, 1.8, 0.022
    P, B = M['paint'], M['back']; xi = W / 2 - 0.012 - t                 # (inside face of the ends)
    for sx in (-1, 1):                                                    # (the ends, grain upright, rounded at the front)
        x0, x1 = (W / 2 - 0.012 - t, W / 2 - 0.012) if sx > 0 else (-W / 2 + 0.012, -W / 2 + 0.012 + t)
        box(G, P, (x0, -D + 0.008, 0.0), (x1, 0.0, H - 0.024), wa((0, 0, 1), wear=0.25), 0.004, 1)
    box(G, P, (-W / 2, -D, H - 0.024), (W / 2, 0.0, H), wa((1, 0, 0), wear=0.2), 0.005, 1)              # (the top, overhanging)
    box(G, P, (-xi, -D + 0.022, 0.0), (xi, -D + 0.04, 0.08), wa((1, 0, 0), wear=0.6), 0.003, 1)          # (the plinth, set back)
    levels = (0.08, 0.47, 0.84, 1.18, 1.5)
    for z in levels: box(G, P, (-xi, -D + 0.014, z), (xi, -0.012, z + 0.02), wa((1, 0, 0), wear=0.35), 0.003, 1)
    box(G, P, (-0.011, -D + 0.02, 0.1), (0.011, -0.012, 0.47), wa((0, 0, 1)), 0.003, 1)                # (the bottom bays' divider)
    box(G, P, (-xi, -0.078, 1.545), (xi, -0.0635, 1.562), wa((1, 0, 0), wear=0.3), 0.003, 1)          # (the plate rail, the plates' rims on it)
    n = 8; bw = 2 * xi / n                                              # (the boarded back: tongued boards, a dark hairline between)
    for i in range(n):
        x0 = -xi + i * bw + 0.0012; box(G, B, (x0, -0.012, 0.08), (x0 + bw - 0.0024, -0.003, H - 0.024), wa((0, 0, 1)), 0.0, 1)
    # ---- the top shelf: three plates on edge behind the rail, leaning back on the boards
    for i, x in enumerate((-0.42, 0.0, 0.42)):
        lean = 0.2; a = Vector((0, -math.cos(lean), math.sin(lean)))     # (the plate's face toward the room, tipped up)
        c = Vector((x + rnd.uniform(-0.02, 0.02), -0.016 - 0.125 * math.sin(lean) - 0.004, 1.52 + 0.125 * math.cos(lean)))
        plate(G, M['blue'] if i % 2 else M['iron_st'], c - a * 0.022, a)
    # ---- shelf 4 (1.20): bowls nested, two jugs, the brown teapot, cups
    z = 1.2
    lathe(G, M['iron_st'], [(0.0, 0.0), (0.0, 0.05), (0.45, 0.09), (0.55, 0.095), (0.6, 0.1), (1.0, 0.108), (0.95, 0.098), (0.15, 0.0)],
          (-0.5, -0.12, z), (-0.5, -0.12, z + 0.1), 10, (False, False))
    for x, s_, mat in ((-0.27, 1.0, 'iron_st'), (-0.12, 0.85, 'blue')):  # (jugs: a turned body, a lip, a loop handle)
        c = Vector((x, -0.11, z)); hh = 0.2 * s_
        lathe(G, M[mat], [(0.0, 0.045 * s_), (0.35, 0.065 * s_), (0.6, 0.06 * s_), (0.85, 0.048 * s_), (1.0, 0.055 * s_), (0.98, 0.05 * s_), (0.9, 0.0)],
              c, c + Vector((0, 0, hh)), 10, (True, False))
        handle(G, M[mat], c, 1, 0.055 * s_, z + hh * 0.85, z + hh * 0.35)
    c = Vector((0.12, -0.12, z))                                         # (the brown betty)
    lathe(G, M['betty'], [(0.0, 0.05), (0.15, 0.08), (0.45, 0.092), (0.75, 0.08), (0.95, 0.05), (1.0, 0.045)], c, c + Vector((0, 0, 0.13)), 10)
    lathe(G, M['betty'], [(0.0, 0.046), (0.5, 0.04), (0.8, 0.012), (1.0, 0.014)], c + Vector((0, 0, 0.13)), c + Vector((0, 0, 0.165)), 10)
    F.rod(G, M['betty'], [c + Vector((-0.07, 0, 0.04)), c + Vector((-0.11, 0, 0.08)), c + Vector((-0.135, 0, 0.13))], lambda q: 0.014 - 0.006 * q, 6, ma(), sub=2)
    handle(G, M['betty'], c, 1, 0.08, z + 0.115, z + 0.04, 0.007)
    for x in (0.38,):                                                    # (a cup on its saucer)
        c = Vector((x, -0.1, z))
        lathe(G, M['iron_st'], [(0.0, 0.0), (0.0, 0.045), (1.0, 0.072), (0.8, 0.06), (0.6, 0.0)], c, c + Vector((0, 0, 0.015)), 10, (False, False))
        lathe(G, M['iron_st'], [(0.0, 0.0), (0.0, 0.025), (0.2, 0.034), (1.0, 0.045), (0.95, 0.04), (0.3, 0.0)], c + Vector((0, 0, 0.012)), c + Vector((0, 0, 0.072)), 10, (False, False))
        handle(G, M['iron_st'], c, -1, 0.04, z + 0.07, z + 0.035, 0.004)
    # ---- shelf 3 (0.86): linen folded in stacks, canisters, the chamberstick and candle box
    z = 0.86
    for x, n_ in ((-0.52, 2), (-0.3, 1)):
        zz = z
        for k in range(n_):
            hk = rnd.uniform(0.04, 0.055); off = rnd.uniform(-0.01, 0.01)
            pillow(G, M['linen2' if (k + n_) % 3 == 0 else 'linen'], (x + off, -0.115, zz + hk / 2), 0.2, 0.19, hk, rnd, n=2, sag=0.05); zz += hk * 0.92
    for x, mat in ((-0.08, 'japan'), (0.04, 'japan2')):                  # (tea and sugar: japanned tins, a lid with a knob)
        c = Vector((x, -0.11, z))
        lathe(G, M[mat], [(0.0, 0.048), (1.0, 0.048)], c, c + Vector((0, 0, 0.15)), 10)
        lathe(G, M[mat], [(0.0, 0.05), (0.45, 0.05), (0.6, 0.01), (1.0, 0.01)], c + Vector((0, 0, 0.146)), c + Vector((0, 0, 0.17)), 10)
    box(G, M['deal'], (0.18, -0.2, z), (0.44, -0.08, z + 0.085), wa((1, 0, 0)), 0.003, 1)               # (the candle box, its lid slid back)
    box(G, M['deal'], (0.2, -0.2, z + 0.085), (0.44, -0.095, z + 0.093), wa((1, 0, 0)), 0.0, 1)
    for k in range(3): F.rod(G, M['wax'], [(0.23 + 0.02 * k, -0.18 + 0.012 * k, z + 0.0985), (0.42 - 0.01 * k, -0.18 + 0.012 * k, z + 0.0985)], 0.0055, 6, ma())   # (spare candles on the lid)
    c = Vector((0.56, -0.12, z))                                         # (a brass chamberstick: saucer, socket, a finger ring, a stub)
    lathe(G, M['brass'], [(0.0, 0.0), (0.0, 0.06), (0.5, 0.077), (1.0, 0.082), (0.85, 0.07), (0.4, 0.0)], c, c + Vector((0, 0, 0.022)), 10, (False, False))
    lathe(G, M['brass'], [(0.0, 0.016), (0.4, 0.012), (0.85, 0.014), (1.0, 0.018)], c + Vector((0, 0, 0.015)), c + Vector((0, 0, 0.07)), 10)
    lathe(G, M['wax'], [(0.0, 0.0105), (0.8, 0.0105), (1.0, 0.004)], c + Vector((0, 0, 0.07)), c + Vector((0, 0, 0.11)), 8, (False, True))
    F.rod(G, M['brass'], [c + Vector((0.07, 0, 0.018)), c + Vector((0.1, 0, 0.022)), c + Vector((0.11, 0, 0.04)), c + Vector((0.095, 0, 0.05)), c + Vector((0.078, 0, 0.03))], 0.003, 5, ma())
    # ---- shelf 2 (0.49): plates stacked flat, trays on edge, the lamp-oil can
    z = 0.49
    c = Vector((-0.45, -0.12, z)); prof = [(0.0, 0.0), (0.0, 0.06)]
    for k in range(4): prof += [(k / 4 + 0.06, 0.121), ((k + 1) / 4, 0.111)]
    lathe(G, M['iron_st'], prof + [(1.0, 0.09), (0.97, 0.0)], c, c + Vector((0, 0, 0.07)), 11, (False, False))
    for k in range(3):                                                    # (japanned trays stood on edge, each leaning on the one behind)
        lean = 0.1 + 0.05 * k
        bm = block((-0.2, -0.006, 0.0), (0.2, 0.0, 0.26), 0.0, 1); S.xform(bm, (0, 0, 0), (-lean, 0, 0))
        S.xform(bm, (-0.06 + 0.03 * k, -0.013 - 0.26 * math.sin(lean) - 0.007 * k, z)); G.add(bm, M['tray'], ma(), wrap=False)
    c = Vector((0.4, -0.12, z))                                          # (the oil can: a drum, a cone top, the long spout, a strap handle)
    lathe(G, M['galv'], [(0.0, 0.07), (0.85, 0.07), (1.0, 0.066)], c, c + Vector((0, 0, 0.17)), 10)
    lathe(G, M['galv'], [(0.0, 0.066), (0.7, 0.025), (1.0, 0.016)], c + Vector((0, 0, 0.17)), c + Vector((0, 0, 0.21)), 10)
    F.rod(G, M['galv'], [c + Vector((-0.045, 0, 0.15)), c + Vector((-0.1, 0, 0.2)), c + Vector((-0.14, 0, 0.25))], lambda q: 0.009 - 0.005 * q, 6, ma(0.3), sub=2)
    F.rod(G, M['galv'], [c + Vector((0.065, 0, 0.05)), c + Vector((0.09, 0, 0.1)), c + Vector((0.085, 0, 0.16)), c + Vector((0.055, 0, 0.19))], 0.005, 5, ma(0.3), sub=2)
    # ---- the bottom bays (0.10): boot brushes in their box; a bucket, a pile of dusters
    z = 0.1
    bx0, bx1 = -0.6, -0.26
    box(G, M['deal'], (bx0, -0.2, z), (bx1, -0.05, z + 0.012), wa((1, 0, 0)), 0.0, 1)
    for x0, x1 in ((bx0, bx0 + 0.012), (bx1 - 0.012, bx1)): box(G, M['deal'], (x0, -0.2, z), (x1, -0.05, z + 0.11), wa((0, 1, 0)), 0.0, 1)
    for y0, y1 in ((-0.2, -0.19), (-0.06, -0.05)): box(G, M['deal'], (bx0, y0, z), (bx1, y1, z + 0.08), wa((1, 0, 0)), 0.0, 1)
    box(G, M['deal'], (bx0 + 0.012, -0.131, z), (bx1 - 0.012, -0.119, z + 0.19), wa((1, 0, 0)), 0.0, 1)     # (the middle board it's carried by)
    for k, (x, y, rot) in enumerate(((-0.52, -0.17, 0.1), (-0.39, -0.165, -0.2), (-0.47, -0.085, 0.3))):
        bm = block((-0.05, -0.02, 0.0), (0.05, 0.02, 0.028), 0.006, 1); S.xform(bm, (0, 0, 0), (0, 0, rot)); S.xform(bm, (x, y, z + 0.032 + 0.008 * (k % 2)))
        G.add(bm, M['deal'], wa((1, 0, 0)), wrap=False)
        bm = block((-0.046, -0.017, 0.0), (0.046, 0.017, 0.022), 0.0, 1); S.xform(bm, (0, 0, 0), (0, 0, rot)); S.xform(bm, (x, y, z + 0.012 + 0.008 * (k % 2)))
        G.add(bm, M['bristle'], fa(rnd, 3, 3), wrap=False)
    c = Vector((0.3, -0.12, z))                                          # (the galvanised bucket, its bail down against the rim)
    lathe(G, M['galv'], [(0.0, 0.0), (0.0, 0.085), (0.9, 0.11), (1.0, 0.113), (0.97, 0.105), (0.05, 0.08), (0.03, 0.0)], c, c + Vector((0, 0, 0.24)), 12, (False, False))
    bail = [c + Vector((0.116 * math.cos(t), -0.04 * math.sin(t), 0.215 + 0.01 * math.sin(t))) for t in np.linspace(math.pi, 0.0, 8)]
    F.rod(G, M['steel'], bail, 0.0028, 4, ma(0.4))
    for sx in (-1, 1): lathe(G, M['galv'], [(0.0, 0.012), (1.0, 0.012)], c + Vector((sx * 0.111, 0, 0.215)), c + Vector((sx * 0.118, 0, 0.215)), 8, (False, True))
    pillow(G, M['linen2'], (0.55, -0.12, z + 0.03), 0.17, 0.2, 0.06, rnd, n=2, sag=0.3)
    G.dens = [(lambda p: p.normal.y > 0.9 and p.center.y > -0.0035, 0.2)]     # (the back boards' rear, against the wall)

# ================================================================ the bell board
NB = 6
def bell_board(G, M, rnd):
    zb, zt, Wb = 1.97, 2.4, 0.86
    box(G, M['board'], (-Wb / 2, -0.02, zb), (Wb / 2, 0.0, zt), wa((1, 0, 0), wear=0.2), 0.004, 2)
    # top: a moulded cap (a fillet, a cove and a projecting lip); bottom: a bead
    for lo, hi, bv in (((-0.45, -0.032, zt), (0.45, 0.0, zt + 0.016), 0.004), ((-0.44, -0.026, zt + 0.016), (0.44, 0.0, zt + 0.032), 0.008),
                       ((-0.452, -0.044, zt + 0.032), (0.452, 0.0, zt + 0.052), 0.007), ((-0.44, -0.03, zb - 0.026), (0.44, 0.0, zb), 0.01)):
        box(G, M['board'], lo, hi, wa((1, 0, 0), wear=0.3), bv, 1)
    xs = [(-0.5 + (i + 0.5) / NB) * 0.84 for i in range(NB)]
    for i, x in enumerate(xs):
        # the room's name on its ivorine plate (lp: where on the plate, which label), two brass pins
        x0, x1, z0, z1 = x - 0.06, x + 0.06, 2.325, 2.355
        box(G, M['label'], (x0, -0.0235, z0), (x1, -0.02, z1), attrs_of(lambda q: (0.0, 0.0, 0.0), 0.5, lp=lambda q, x0=x0, z0=z0, i=i: ((q[0] - x0) / 0.12, (q[2] - z0) / 0.03, float(i))), 0.0, 1)
        for px in (x0 + 0.006, x1 - 0.006): lathe(G, M['brass'], [(0.0, 0.0022), (1.0, 0.0014)], (px, -0.0235, 2.34), (px, -0.026, 2.34), 5, (False, True))
        # the mount: a brass plate, a stud out of it, the spring coiled on the stud and its arm down to the bell
        box(G, M['brass'], (x - 0.016, -0.024, 2.262), (x + 0.016, -0.02, 2.312), ma(0.5), 0.0, 1)
        st = Vector((x, -0.024, 2.29)); lathe(G, M['brass'], [(0.0, 0.0055), (0.8, 0.005), (1.0, 0.0065)], st, st + Vector((0, -0.016, 0)), 8)
        rc, turns, ph0 = 0.0071, 1.6, rnd.uniform(-0.3, 0.3)          # (wound tight on the stud)
        coil = [st + Vector((rc * math.cos(a), -0.004 - 0.009 * k / 12, rc * math.sin(a))) for k, a in enumerate(np.linspace(math.pi / 2 + ph0, math.pi / 2 + ph0 - 2 * math.pi * turns, 13))]
        bell_top = Vector((x + rnd.uniform(-0.004, 0.004), -0.07, 2.205)); e = coil[-1]
        arm = [e + (bell_top + Vector((0, 0, -0.002)) - e) * t + Vector((0, -0.03 * math.sin(math.pi * t), 0.012 * math.sin(math.pi * t))) for t in np.linspace(0.15, 1.0, 5)]
        F.rod(G, M['spring'], coil + arm, 0.0019, 5, ma(0.4))
        # the bell (mouth down: crown, shoulder, waist, sound bow, lip, and the hollow inside), the clapper hanging in it
        bt = bell_top; ax = Vector((0, 0, -1)); L = 0.058
        prof = [(0.0, 0.0), (0.0, 0.006), (0.1, 0.017), (0.3, 0.029), (0.6, 0.031), (0.85, 0.037), (1.0, 0.0405), (0.96, 0.034), (0.2, 0.0)]
        lathe(G, M['brass'], prof, bt, bt + ax * L, 12, (False, False))
        F.rod(G, M['iron'], [bt + ax * 0.012, bt + ax * (L - 0.004)], 0.0016, 4, ma(0.4))
        lathe(G, M['iron'], [(0.0, 0.0), (0.25, 0.007), (0.6, 0.0085), (1.0, 0.0)], bt + ax * (L - 0.012), bt + ax * (L + 0.004), 6, (False, False))
        # the bell wire out of the board just above the mount (a brass eyelet, under the label), down to the coil's top
        ey = Vector((x + 0.009, -0.024, 2.318)); lathe(G, M['brass'], [(0.0, 0.0035), (1.0, 0.003)], ey + Vector((0, 0.004, 0)), ey, 6, (False, True))
        F.rod(G, M['steel'], [ey, ey + Vector((-0.004, -0.003, -0.008)), coil[0] + Vector((0, 0, 0.0015))], 0.0008, 4, ma(0.3), sub=2)
    G.dens = [(lambda p: p.normal.y < -0.9 and -0.0245 < p.center.y < -0.022 and 2.32 < p.center.z < 2.36, 3.0),   # (the lettering)
              (lambda p: p.normal.y > 0.9 and p.center.y > -0.001, 0.15)]                                         # (the back, on the wall)

# ================================================================ the conduit run
def conduit(G, M, rnd):
    def run(y, z, r, x0, x1, R, n=5):
        """a pipe out of the wall at x0, along it at depth y, back into the wall at x1 (quarter bends of radius R)"""
        a = [Vector((x0, 0.004, z))] + [Vector((x0 + R - R * math.cos(t), y + R - R * math.sin(t), z)) for t in np.linspace(0, math.pi / 2, n)]
        b = [Vector((x1 - R + R * math.sin(t), y + R - R * math.cos(t), z)) for t in np.linspace(0, math.pi / 2, n)] + [Vector((x1, 0.004, z))]
        return a + b
    # the lead water pipe (bends of its own soft kind), a wiped joint where two lengths meet, iron pipe hooks over it
    zl, yl, rl = 2.2, -0.034, 0.016
    F.rod(G, M['lead'], run(yl, zl, rl, -0.975, 0.975, 0.034 + rl * 0.0, 5), rl, 10, ma(0.3))
    lathe(G, M['lead'], [(0.0, rl + 0.0005), (0.25, rl + 0.006), (0.5, rl + 0.0085), (0.75, rl + 0.006), (1.0, rl + 0.0005)], (0.29, yl, zl), (0.39, yl, zl), 10)
    for x in (-0.62, -0.02, 0.62):
        hk = [Vector((x, 0.006, zl + rl + 0.004)), Vector((x, yl + 0.004, zl + rl + 0.0035))]
        hk += [Vector((x, yl - (rl + 0.0028) * math.sin(t), zl + (rl + 0.0028) * math.cos(t))) for t in np.linspace(0.25, 1.9, 6)]
        F.rod(G, M['iron'], hk, 0.0028, 4, ma(0.5))
    # two black steel conduits, a spacer-bar saddle over both at each third, a round junction box on the upper one
    zc = (2.38, 2.445); yc = -0.0135; rc = 0.0095
    for k, z in enumerate(zc): F.rod(G, M['tube'], run(yc, z, rc, -0.94 + 0.02 * k, 0.94 - 0.02 * k, 0.022, 4), rc, 8, ma(0.3))
    for x in (-0.5, 0.5):
        pts = [Vector((x, -0.0015, zc[0] - rc - 0.012))]
        for z in zc: pts += [Vector((x, yc - (rc + 0.0015) * math.cos(t), z + (rc + 0.0015) * math.sin(t))) for t in np.linspace(-1.35, 1.35, 5)]
        pts += [Vector((x, -0.0015, zc[1] + rc + 0.012))]
        bm = bmesh.new()
        for i in range(len(pts) - 1):                                     # (a flat strip, 12 mm wide, bent round the tubes)
            p, q = pts[i], pts[i + 1]
            vs = [bm.verts.new(p + Vector((-0.006, 0, 0))), bm.verts.new(p + Vector((0.006, 0, 0))), bm.verts.new(q + Vector((0.006, 0, 0))), bm.verts.new(q + Vector((-0.006, 0, 0)))]
            f = bm.faces.new(vs); f.normal_update()
            if f.normal.y > 0: f.normal_flip()
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        ex = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces)); bmesh.ops.translate(bm, verts=[e for e in ex['geom'] if isinstance(e, bmesh.types.BMVert)], vec=(0, 0.0012, 0))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); G.add(bm, M['steel'], ma(0.5), wrap=False)
        for z in (zc[0] - rc - 0.008, zc[1] + rc + 0.008): lathe(G, M['steel'], [(0.0, 0.0035), (0.6, 0.0035), (1.0, 0.002)], (x, -0.0027, z), (x, -0.0045, z), 6, (False, True))
    jx = 0.18; jc = Vector((jx, yc, zc[1]))
    lathe(G, M['cast'], [(0.0, 0.031), (0.75, 0.031), (0.8, 0.034), (1.0, 0.033)], jc + Vector((0, 0.0135, 0)), jc + Vector((0, -0.024, 0)), 16)
    lathe(G, M['cast'], [(0.0, 0.03), (0.6, 0.029), (1.0, 0.02)], jc + Vector((0, -0.024, 0)), jc + Vector((0, -0.029, 0)), 16, (False, True))
    for a in (0.6, 0.6 + math.pi):
        p = jc + Vector((0.024 * math.cos(a), -0.029, 0.024 * math.sin(a))); lathe(G, M['steel'], [(0.0, 0.0035), (1.0, 0.003)], p, p + Vector((0, -0.003, 0)), 6, (False, True))
    for sx in (-1, 1): lathe(G, M['cast'], [(0.0, rc + 0.003), (1.0, rc + 0.002)], jc + Vector((sx * 0.031, 0, 0)), jc + Vector((sx * 0.043, 0, 0)), 8, (False, False))
    G.dens = [(lambda p: p.normal.y > 0.9 and p.center.y > -0.002, 0.2)]

BANDS = [('Band_service_shelf', 'service_shelf', service_shelf, 2048), ('Band_bell_board', 'bell_board', bell_board, 2048), ('Band_conduit', 'conduit', conduit, 1024)]

def main():
    want = lambda k: OPTS.only is None or k in OPTS.only
    for node, nm, fn, px in BANDS:
        if want(nm) or want(node) or want('bands'):
            F.run(STYLE, f'band_{nm}', [(node, f'band_{nm}', fn, (lambda nm=nm: mats(nm)), zlib.crc32(nm.encode()) & 0xfff, px)], wall=True, look=LOOK)

if __name__ == '__main__':
    main()
