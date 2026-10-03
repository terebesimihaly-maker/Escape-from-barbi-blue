# Escape from Barbi Blue: the light fixtures and their emission profiles (WP2.4; build spec B8, B10, C3; js/lightbake.js profiles).
#   Fix_<id>        the fixture's body (baked: brass, iron, enamel, fabric, wax, glass that is no window), mounted as kitdefs says:
#                   wall (origin on the wall plane at floor level), ceiling (on the ceiling, hanging down), floor / surface (standing),
#                   practical (inside its furniture)
#   Fix_<id>_emit   its child: what glows (bulbs, flames, the inside of a fabric shade, embers) in the reserved Emit material, which
#                   the game colours by the lamp's colour and state (flicker, dim, dead)
#   textures/light/profiles.json   {profiles: {id: {w: 64, h: 32, rgb, mount, k0}}}: how the fixture throws its light, as a lat-long
#                   panorama of relative intensity (mean 1) seen from the light centre in fixture-local three.js axes (+z front, +y up,
#                   +x right; column i at longitude atan2(x, z) = (i + .5) / 64 * 2pi - pi, row j at (j + .5) / 32 * pi from straight
#                   up). Baked in Cycles: the fixture (shades translucent, glass clear, reflectors white) round a small white point
#                   light at each of its light centres, inside a 5 m sphere that sees only light (diffuse, direct + what comes through
#                   or off the fixture), 512 spp, EXR (Standard), denoised, averaged to 64 x 32. A wall fixture has the wall behind it,
#                   a practical the box it burns in. mount: the light centre from the node origin (fixture-local, m). k0: where the
#                   game's calibration starts. The emitter is white: the game multiplies in the lamp's colour (2700 K by default).
#   py -3.11 tools/blender/kit/fixtures.py [--preview] [--force] [--only wood,sconce_shade] [--sheets] [--no-profiles | --profiles-only]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
from surfaces2 import sep, comb, finish
from doors import lathe_bm, tube, block, plate, attrs_of, metal_attrs, wood_attrs, ATTRS
from kitlib import OPTS, TMP, lin

FIX = defs.KIT['fixtures']
LIGHT = os.path.join(defs.REPO, 'textures', 'light')
PX = 2048
PW, PH = 64, 32                                              # the profile table
random.seed(71)

def at(*c): return Vector(c)

def lathe(G, mat, prof, p0, p1, sides=16, caps=(True, True), attrs=None, smooth=True):
    G.add(lathe_bm(prof, p0, p1, sides, caps), mat, attrs or metal_attrs(), smooth=smooth, wrap=False)

def bead_chain(G, mat, a, b, n, r, sag=0.0, sides=4):
    """a festoon of cut beads from a to b, hanging in a catenary"""
    a, b = Vector(a), Vector(b)
    for k in range(n):
        t = (k + 0.5) / n; p = a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t)))
        lathe(G, mat, [(0.0, 0.0), (0.5, r), (1.0, 0.0)], p + Vector((0, 0, r * 1.2)), p - Vector((0, 0, r * 1.2)), sides, (False, False), smooth=False)

def prism(G, mat, top, L, w, sides=6):
    """a cut-glass drop: a pointed hexagonal pendeloque hanging from top"""
    top = Vector(top)
    lathe(G, mat, [(0.0, 0.0), (0.08, w * 0.4), (0.55, w), (1.0, 0.0)], top, top - Vector((0, 0, L)), sides, (False, False), smooth=False)

def pleated_shade(G, Gi, mat, emit, c, z_top, z_bot, r_top, r_bot, pleats=32, amp=0.003, scallops=0, sc_depth=0.0, rows=6, bell=0.0, n=None, inner=True):
    """a pleated fabric shade round the vertical axis through c: pleats as a triangle wave in its radius, a bell bulge, its hem
       scalloped; its inside (a smooth shell 2 mm in) goes to the emit geometry Gi (a lit shade glows from within).
       -> [(theta, hem point)] for trims"""
    n = n or pleats * 2; c = Vector(c); bm = bmesh.new(); V = []
    def radius(t, th):
        r = r_top + (r_bot - r_top) * t + bell * math.sin(math.pi * t) * (r_bot - r_top)
        tri = 1.0 - 2.0 * abs(((th * pleats / (2 * math.pi)) % 1.0) - 0.5)
        return r * (1 + amp / max(r, 1e-3) * (2 * tri - 1))
    def zh(t, th): return z_top + (z_bot - z_top) * t - (sc_depth * abs(math.sin(scallops * th / 2)) * t ** 4 if scallops else 0.0)
    for j in range(rows + 1):
        t = j / rows; row = []
        for i in range(n):
            th = 2 * math.pi * i / n; r = radius(t, th); row.append(bm.verts.new(c + Vector((r * math.cos(th), r * math.sin(th), 0)) + Vector((0, 0, zh(t, th) - c.z))))
        V.append(row)
    for j in range(rows):
        for i in range(n):
            f = bm.faces.new((V[j][i], V[j][(i + 1) % n], V[j + 1][(i + 1) % n], V[j + 1][i])); f.normal_update()
            m_ = f.calc_center_median()
            if f.normal.dot(Vector((m_.x - c.x, m_.y - c.y, 0))) < 0: f.normal_flip()
    hem = [(2 * math.pi * i / n, V[-1][i].co.copy()) for i in range(n)]; top = [V[0][i].co.copy() for i in range(n)]
    # (the fabric's grain: around and down the shade)
    G.add(bm, mat, attrs_of(lambda q, c=c: (math.atan2(q[1] - c.y, q[0] - c.x) * 0.1, q[2] * 1.0, 0.0), random.random()), smooth=True, wrap=False)
    if inner:
        bm = bmesh.new(); m = max(16, pleats); W_ = []
        tb = 1.0 - (sc_depth + 0.006) / max(1e-3, z_top - z_bot) if scallops else 0.97   # (it stops above the scallops: no glow through the hem)
        for j in range(3):
            t = tb * j / 2; row = []
            for i in range(m):
                th = 2 * math.pi * i / m; r = r_top + (r_bot - r_top) * t + bell * math.sin(math.pi * t) * (r_bot - r_top) - amp - 0.002
                row.append(bm.verts.new(c + Vector((r * math.cos(th), r * math.sin(th), z_top + (z_bot - z_top) * t - c.z - 0.002 * (1 - 2 * t)))))
            W_.append(row)
        for j in range(2):
            for i in range(m):
                f = bm.faces.new((W_[j][i], W_[j][(i + 1) % m], W_[j + 1][(i + 1) % m], W_[j + 1][i])); f.normal_update()
                m_ = f.calc_center_median()
                if f.normal.dot(Vector((m_.x - c.x, m_.y - c.y, 0))) > 0: f.normal_flip()
        Gi.add(bm, emit, attrs_of(lambda q: tuple(q), 0.5), smooth=True, wrap=False)
    return hem, top

def ring_tube(G, mat, pts, r, sides=6):
    tube(G, mat, list(pts) + [pts[0]], r, sides)

def bulb(Gi, emit, base, kind='candle', s=1.0, sides=None):
    """a bulb's glass (glowing): base = the top of the cap it screws into, the glass hanging below (kind 'pear', 'globe') or
       standing above ('candle')"""
    base = Vector(base)
    if kind == 'candle':
        lathe(Gi, emit, [(0.0, 0.008 * s), (0.25, 0.0118 * s), (0.55, 0.0122 * s), (0.82, 0.008 * s), (1.0, 0.0)], base, base + Vector((0, 0, 0.055 * s)), sides or 12, (True, False))
    else:
        R = 0.03 * s
        lathe(Gi, emit, [(0.0, 0.0125 * s), (0.25, 0.016 * s), (0.45, R * 0.82), (0.7, R), (0.88, R * 0.82), (1.0, 0.0)], base, base - Vector((0, 0, 0.1 * s)), 16, (True, False))

def flame(Gi, emit, base, h=0.028, r=0.0055):
    base = Vector(base)
    lathe(Gi, emit, [(0.0, r * 0.3), (0.12, r * 0.85), (0.3, r), (0.55, r * 0.8), (0.8, r * 0.38), (1.0, 0.0)], base, base + Vector((0, 0, h)), 10, (True, False))

def candle(G, M, base, h, r=0.0115, seed=0):
    """a wax candle burnt down unevenly: its top hollowed round the wick, runs of wax down its side, the black wick"""
    rnd = random.Random(seed); base = Vector(base); top = base + Vector((0, 0, h))
    lathe(G, M['wax'], [(0.0, r), (0.85, r * 1.01), (0.95, r * 1.0), (0.985, r * 0.92), (1.0, r * 0.55)], base, top, 14, (False, True), attrs_of(lambda q: tuple(q), rnd.random()))
    for k in range(rnd.randint(2, 4)):                                  # (drips run down its side)
        a = rnd.uniform(0, 2 * math.pi); L = rnd.uniform(0.2, 0.75) * h; w = rnd.uniform(0.0025, 0.004)
        p0 = top + Vector((math.cos(a) * r * 0.98, math.sin(a) * r * 0.98, -0.002)); p1 = p0 - Vector((0, 0, L))
        lathe(G, M['wax'], [(0.0, w * 0.8), (0.3, w), (0.8, w * 0.9), (1.0, w * 0.4)], p0 + Vector((math.cos(a), math.sin(a), 0)) * 0.0012, p1 + Vector((math.cos(a), math.sin(a), 0)) * 0.0012, 6, (True, True), attrs_of(lambda q: tuple(q), rnd.random()))
    lathe(G, M['wick'], [(0.0, 0.0008), (1.0, 0.0006)], top - Vector((0, 0, 0.002)), top + Vector((0.0005, 0, 0.007)), 5, (False, True))
    return top + Vector((0, 0, 0.007))

def coal_lumps(G, mat, n, box, seed, size=(0.025, 0.04), flat=0.6, glow=None):
    """lumps of coal (or embers) piled in box (x0, x1, y0, y1, z0), each a battered stone"""
    import modules as Mo
    rnd = random.Random(seed); x0, x1, y0, y1, z0 = box; pts = []
    for k in range(n):
        s = rnd.uniform(*size); x, y = rnd.uniform(x0 + s, x1 - s), rnd.uniform(y0 + s, y1 - s)
        z = z0 + s * flat * 0.6 + sum(s * 0.5 for q in pts if (q[0] - x) ** 2 + (q[1] - y) ** 2 < (s + q[2]) ** 2 * 0.5)
        pts.append((x, y, s)); bm = Mo.rock((x, y, z), (s, s * rnd.uniform(0.7, 1.0), s * rnd.uniform(0.7, 1.0)), rnd.uniform(0, 50), 1, flat)
        (glow if glow is not None and rnd.random() < 0.5 else G).add(bm, mat if glow is None else mat, attrs_of(lambda q: tuple(q), rnd.random()), smooth=False, wrap=False)
    return pts

# ================================================================ the fixtures (each -> body Geo, emit Geo, light centres, roles)
def fx_sconce_shade(M):
    """a nursery wall light: a brass rose plate centred at 1.95 m, a swan-neck arm, a candle bulb in a brass cup, and a pleated
       pink silk shade with a scalloped hem, braid at top and hem, tassels at the scallops' points"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False); zc = 1.95
    Gp = plate(Dr.rounded(0.072, 0.118, 0.034, 5, 0, zc), 0.0, 0.007, bevel=0.0018); G.add(Gp, M['brass'], metal_attrs(), wrap=False)
    lathe(G, M['brass'], [(0.0, 0.019), (0.4, 0.016), (0.7, 0.011), (1.0, 0.009)], at(0, -0.007, zc), at(0, -0.024, zc), 16)
    tube(G, M['brass'], [at(0, -0.022, zc), at(0, -0.055, zc - 0.012), at(0, -0.095, zc - 0.008), at(0, -0.12, zc + 0.012), at(0, -0.13, zc + 0.035)], 0.0055, 8)
    cup = at(0, -0.13, zc + 0.035)
    lathe(G, M['brass'], [(0.0, 0.006), (0.15, 0.014), (0.5, 0.0135), (0.85, 0.012), (1.0, 0.0105)], cup, cup + Vector((0, 0, 0.038)), 16)
    bulb(E, M['emit'], cup + Vector((0, 0, 0.038)), 'candle')
    c = at(0, -0.13, 0); zt, zb = 2.112, 1.935
    hem, top = pleated_shade(G, E, M['shade'], M['emit'], c, zt, zb, 0.06, 0.112, pleats=28, amp=0.0028, scallops=8, sc_depth=0.012, rows=6, bell=0.12)
    ring_tube(G, M['braid'], [p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.0015 for p in top[::2]], 0.0028, 5)
    ring_tube(G, M['braid'], [p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.0015 for th, p in hem[::2]], 0.003, 5)
    for k in range(8):                                                   # (tassels where the scallops meet)
        th, p = hem[(k * len(hem)) // 8]; p = p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.002
        lathe(G, M['braid'], [(0.0, 0.0018), (0.25, 0.004), (0.45, 0.0035), (1.0, 0.005)], p, p - Vector((0, 0, 0.022)), 6)
    for k in range(3):                                                   # (the gimbal: three wires from the top ring to the cup)
        a = 2 * math.pi * k / 3 + 0.3; tube(G, M['brass'], [c + Vector((0.058 * math.cos(a), 0.058 * math.sin(a), zt - 0.004)), cup + Vector((0.012 * math.cos(a), 0.012 * math.sin(a), 0.03))], 0.0012, 4)
    return G, E, [cup + Vector((0, 0, 0.065))], {'shade': M['shade']}

def fx_pendant_shade(M):
    """the hall pendant: a brass cord grip and a short length of braided flex, the lampholder, a pear bulb, a big pleated empire
       shade in faded pink silk, its hem scalloped, a braid, silk tassels"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['brass'], [(0.0, 0.016), (0.5, 0.014), (1.0, 0.006)], at(0, 0, 0.0), at(0, 0, -0.035), 16, (True, False))
    lathe(G, M['flex'], [(0.0, 0.0035), (1.0, 0.0035)], at(0, 0, -0.035), at(0, 0, -0.105), 8, (False, False))
    hold = at(0, 0, -0.105)
    lathe(G, M['brass'], [(0.0, 0.009), (0.2, 0.016), (0.8, 0.017), (1.0, 0.015)], hold, hold - Vector((0, 0, 0.05)), 16)
    bulb(E, M['emit'], hold - Vector((0, 0, 0.05)), 'pear', 0.95)
    c = at(0, 0, 0); zt, zb = -0.1, -0.335
    hem, top = pleated_shade(G, E, M['shade'], M['emit'], c, zt, zb, 0.075, 0.205, pleats=40, amp=0.0035, scallops=12, sc_depth=0.016, rows=7, bell=0.18)
    ring_tube(G, M['braid'], [p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.0015 for p in top[::2]], 0.003, 5)
    ring_tube(G, M['braid'], [p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.0015 for th, p in hem[::2]], 0.0035, 5)
    for k in range(12):
        th, p = hem[(k * len(hem)) // 12]; p = p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.002
        L = 0.012 if p.z - 0.03 > -0.35 else 0.0
        lathe(G, M['braid'], [(0.0, 0.002), (0.25, 0.0045), (0.45, 0.004), (1.0, 0.0055)], p, p - Vector((0, 0, 0.012)), 6)
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4; tube(G, M['brass'], [c + Vector((0.072 * math.cos(a), 0.072 * math.sin(a), zt - 0.003)), hold + Vector((0.015 * math.cos(a), 0.015 * math.sin(a), -0.01))], 0.0013, 4)
    return G, E, [hold - Vector((0, 0, 0.1))], {'shade': M['shade']}

def fx_night_light(M):
    """a fairy lamp on a dresser: a pierced brass stand, a pressed opal-glass cup with a nightlight candle in it and an opal dome
       over it (the glass glows when it burns: Emit), a brass vent cap"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['brass'], [(0.0, 0.0), (0.02, 0.066), (0.12, 0.068), (0.2, 0.06), (0.5, 0.045), (0.8, 0.02), (1.0, 0.012)], at(0, 0, 0), at(0, 0, 0.045), 24, (True, False))
    lathe(G, M['brass'], [(0.0, 0.012), (0.3, 0.009), (0.5, 0.013), (0.7, 0.009), (1.0, 0.022)], at(0, 0, 0.045), at(0, 0, 0.088), 16, (False, True))
    for k in range(3):                                                   # (three leaves holding the cup)
        a = 2 * math.pi * k / 3; tube(G, M['brass'], [at(0.018 * math.cos(a), 0.018 * math.sin(a), 0.085), at(0.04 * math.cos(a), 0.04 * math.sin(a), 0.1), at(0.046 * math.cos(a), 0.046 * math.sin(a), 0.115)], 0.0025, 5)
    lathe(E, M['emit'], [(0.0, 0.02), (0.25, 0.038), (0.6, 0.045), (1.0, 0.043)], at(0, 0, 0.09), at(0, 0, 0.135), 24, (True, False))   # (the cup)
    lathe(E, M['emit'], [(0.0, 0.044), (0.35, 0.05), (0.7, 0.042), (0.9, 0.024), (1.0, 0.013)], at(0, 0, 0.136), at(0, 0, 0.215), 24, (False, False))  # (the dome)
    lathe(G, M['brass'], [(0.0, 0.014), (0.5, 0.016), (1.0, 0.0)], at(0, 0, 0.212), at(0, 0, 0.232), 16, (True, False))
    ring_tube(G, M['brass'], [at(0.0455 * math.cos(2 * math.pi * k / 24), 0.0455 * math.sin(2 * math.pi * k / 24), 0.1355) for k in range(24)], 0.0022, 5)
    return G, E, [at(0, 0, 0.135)], {'glowglass': True}

def fx_sconce_candles(M):
    """a brass two-light wall sconce: a cartouche back plate, two scrolled arms out to drip pans and sockets, the candles burnt down
       unevenly, flames; a finial under the plate"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False); zc = 1.93
    pl = [(0.035 * math.sin(math.pi * k / 10) * (1 + 0.4 * math.sin(math.pi * k / 5) ** 2), zc - 0.11 + 0.22 * k / 10) for k in range(11)]
    pl = [(x, z) for x, z in pl] + [(-x, z) for x, z in reversed(pl)]
    G.add(plate([(x + (0.006 if x >= 0 else -0.006), z) for x, z in pl], 0.0, 0.008, bevel=0.002), M['brass'], metal_attrs(), wrap=False)
    lathe(G, M['brass'], [(0.0, 0.016), (0.4, 0.02), (0.7, 0.012), (1.0, 0.007)], at(0, -0.008, zc), at(0, -0.04, zc), 16)
    lathe(G, M['brass'], [(0.0, 0.008), (0.4, 0.012), (0.7, 0.007), (1.0, 0.0)], at(0, -0.004, zc - 0.11), at(0, -0.004, zc - 0.165), 12, (True, False))
    tops = []
    for sx in (-1, 1):
        pts = [at(0, -0.03, zc)]
        for k in range(1, 9):                                            # (an S-scroll: out, down, up to the socket)
            t = k / 8; pts.append(at(sx * 0.125 * t, -0.03 - 0.1 * t, zc - 0.05 * math.sin(math.pi * t) + 0.02 * t))
        tube(G, M['brass'], pts, 0.0058, 8)
        tube(G, M['brass'], [at(sx * 0.03, -0.045, zc - 0.03), at(sx * 0.05, -0.04, zc - 0.06), at(sx * 0.04, -0.03, zc - 0.08), at(sx * 0.025, -0.032, zc - 0.07)], 0.003, 6)   # (the scroll's curl)
        b = at(sx * 0.125, -0.13, zc + 0.02)
        lathe(G, M['brass'], [(0.0, 0.006), (0.3, 0.008), (0.55, 0.034), (0.8, 0.036), (1.0, 0.033)], b - Vector((0, 0, 0.012)), b + Vector((0, 0, 0.004)), 20)   # (the drip pan)
        lathe(G, M['brass'], [(0.0, 0.01), (0.5, 0.0135), (1.0, 0.0145)], b + Vector((0, 0, 0.004)), b + Vector((0, 0, 0.026)), 16)                          # (the socket)
        top = candle(G, M, b + Vector((0, 0, 0.026)), 0.12 if sx < 0 else 0.085, 0.0112, seed=3 + sx)
        flame(E, M['emit'], top - Vector((0, 0, 0.002))); tops.append(top + Vector((0, 0, 0.01)))
    return G, E, tops, {}

def fx_chandelier(M):
    """a brass and crystal chandelier: canopy, a baluster stem, a bowl with a finial, six scrolled arms with sleeves and candle bulbs
       in their cups, a cut-glass drop under each cup, a crown of prisms round the bowl, festoons of beads from arm to arm"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['brass'], [(0.0, 0.0), (0.05, 0.075), (0.3, 0.07), (0.7, 0.04), (1.0, 0.012)], at(0, 0, 0), at(0, 0, -0.07), 16, (True, False))
    stem = [(0.0, 0.012), (0.08, 0.02), (0.12, 0.013), (0.3, 0.012), (0.36, 0.03), (0.42, 0.04), (0.48, 0.03), (0.52, 0.014), (0.7, 0.016), (0.76, 0.026),
            (0.82, 0.016), (1.0, 0.02)]
    lathe(G, M['brass'], stem, at(0, 0, -0.07), at(0, 0, -0.52), 12)
    lathe(G, M['brass'], [(0.0, 0.02), (0.15, 0.08), (0.35, 0.11), (0.5, 0.105), (0.62, 0.07), (0.75, 0.035), (0.9, 0.02), (1.0, 0.0)], at(0, 0, -0.52), at(0, 0, -0.785), 16, (True, False))
    tops = []; R = 0.33
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.26; d = Vector((math.cos(a), math.sin(a), 0))
        pts = []
        for i in range(10):
            t = i / 9; rr = 0.08 + (R - 0.08) * t; z = -0.6 - 0.07 * math.sin(math.pi * t * 0.9) + 0.17 * t ** 2
            pts.append(d * rr + Vector((0, 0, z)))
        tube(G, M['brass'], pts, 0.0065, 6)
        tube(G, M['brass'], [d * 0.1 + Vector((0, 0, -0.62)), d * 0.14 + Vector((0, 0, -0.69)), d * 0.12 + Vector((0, 0, -0.72)), d * 0.1 + Vector((0, 0, -0.7))], 0.0035, 5)
        b = d * R + Vector((0, 0, -0.43))
        lathe(G, M['brass'], [(0.0, 0.006), (0.3, 0.012), (0.6, 0.038), (0.85, 0.041), (1.0, 0.037)], b - Vector((0, 0, 0.012)), b + Vector((0, 0, 0.004)), 10)
        lathe(G, M['sleeve'], [(0.0, 0.0115), (1.0, 0.0115)], b + Vector((0, 0, 0.004)), b + Vector((0, 0, 0.075)), 10, (False, True), attrs_of(lambda q: tuple(q), random.random()))
        bulb(E, M['emit'], b + Vector((0, 0, 0.075)), 'candle', 0.9, 8); tops.append(b + Vector((0, 0, 0.1)))
        prism(G, M['glass'], d * (R + 0.035) + Vector((0, 0, -0.44)), 0.075, 0.011)
        nb = d.copy(); nb.rotate(__import__('mathutils').Matrix.Rotation(2 * math.pi / 6, 3, 'Z'))
        bead_chain(G, M['glass'], d * (R + 0.03) + Vector((0, 0, -0.435)), nb * (R + 0.03) + Vector((0, 0, -0.435)), 7, 0.0068, 0.11)
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8; prism(G, M['glass'], at(0.112 * math.cos(a), 0.112 * math.sin(a), -0.6), 0.06, 0.009)
    return G, E, tops, {'glass': M['glass']}

def fx_standard_lamp(M):
    """a standard lamp beside the parlour chairs: a round stepped mahogany foot, a turned column with brass collars, the lampholder
       and two bulbs, a big tiered silk shade with a beaded-thread fringe"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['wood'], [(0.0, 0.0), (0.02, 0.17), (0.25, 0.17), (0.32, 0.155), (0.5, 0.15), (0.6, 0.11), (0.85, 0.1), (1.0, 0.045)], at(0, 0, 0), at(0, 0, 0.075), 32, (True, False), wood_attrs((1, 0, 0), (0, 0, 1)))
    col = [(0.0, 0.045), (0.02, 0.05), (0.05, 0.034), (0.12, 0.028), (0.2, 0.033), (0.24, 0.042), (0.28, 0.03), (0.6, 0.022), (0.85, 0.02), (0.9, 0.028), (0.94, 0.02), (1.0, 0.018)]
    lathe(G, M['wood'], col, at(0, 0, 0.075), at(0, 0, 1.22), 16, (False, False), wood_attrs((0, 0, 1), (1, 0, 0)))
    for z in (0.32, 1.06, 1.22):
        lathe(G, M['brass'], [(0.0, 0.024), (0.5, 0.03), (1.0, 0.024)], at(0, 0, z - 0.012), at(0, 0, z + 0.012), 16)
    lathe(G, M['brass'], [(0.0, 0.02), (0.3, 0.014), (1.0, 0.012)], at(0, 0, 1.232), at(0, 0, 1.3), 12)
    hold = at(0, 0, 1.3)
    for sx in (-1, 1):
        tube(G, M['brass'], [hold, hold + Vector((sx * 0.04, 0, 0.02)), hold + Vector((sx * 0.055, 0, 0.04))], 0.004, 6)
        h2 = hold + Vector((sx * 0.055, 0, 0.04))
        lathe(G, M['brass'], [(0.0, 0.009), (0.3, 0.014), (1.0, 0.013)], h2, h2 + Vector((0, 0, 0.04)), 12)
        bulb(E, M['emit'], h2 + Vector((0, 0, 0.04)), 'candle', 1.15)
    c = at(0, 0, 0); zt, zb = 1.585, 1.31
    hem, top = pleated_shade(G, E, M['shade'], M['emit'], c, zt, zb, 0.115, 0.205, pleats=36, amp=0.0035, scallops=0, rows=7, bell=-0.08)
    ring_tube(G, M['braid'], [p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.0015 for p in top[::2]], 0.003, 5)
    ring_tube(G, M['braid'], [p + (p - Vector((c.x, c.y, p.z))).normalized() * 0.0015 for th, p in hem[::2]], 0.0035, 5)
    bm = bmesh.new(); n = 96; rr = 0.208; V0 = []; V1 = []                 # (the fringe: threads round the hem, uneven)
    for i in range(n):
        th = 2 * math.pi * i / n; L = 0.05 + 0.008 * math.sin(i * 1.7) + 0.006 * mnoise.noise(Vector((i * 0.31, 2.0, 0.0)))
        V0.append(bm.verts.new((rr * math.cos(th), rr * math.sin(th), zb + 0.004))); V1.append(bm.verts.new(((rr + 0.004) * math.cos(th), (rr + 0.004) * math.sin(th), zb - L)))
    for i in range(n):
        f = bm.faces.new((V0[i], V0[(i + 1) % n], V1[(i + 1) % n], V1[i])); f.normal_update()
        m_ = f.calc_center_median()
        if f.normal.dot(Vector((m_.x, m_.y, 0))) < 0: f.normal_flip()
    G.add(bm, M['fringe'], attrs_of(lambda q: (math.atan2(q[1], q[0]) * 0.2, q[2], 0.0), 0.5), smooth=True, wrap=False)
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4; tube(G, M['brass'], [at(0.11 * math.cos(a), 0.11 * math.sin(a), zt - 0.004), hold + Vector((0.016 * math.cos(a), 0.016 * math.sin(a), 0.07))], 0.0014, 4)
    return G, E, [hold + Vector((0, 0, 0.11))], {'shade': M['shade'], 'fringe': M['fringe']}

def fx_bulkhead(M):
    """a caged cast-iron bulkhead light centred at 2.1 m: an oval body with fixing lugs, a frosted prismatic glass (glowing) and the
       cast grille over it, its screws, rust"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False); zc = 2.1
    def oval(rx, rz, n=24): return [(rx * math.cos(2 * math.pi * k / n), zc + rz * math.sin(2 * math.pi * k / n)) for k in range(n)]
    G.add(plate(oval(0.1, 0.135, 28), 0.0, 0.018, bevel=0.004), M['iron'], metal_attrs(), wrap=False)
    for sz in (-1, 1): G.add(plate(Dr.rounded(0.04, 0.03, 0.012, 3, 0, zc + sz * 0.142), 0.0, 0.008, bevel=0.002), M['iron'], metal_attrs(), wrap=False)
    G.add(plate(oval(0.084, 0.118, 28), -0.018, 0.012, bevel=0.003), M['iron'], metal_attrs(), wrap=False)    # (the bezel)
    bm = lathe_bm([(0.0, 1.0), (0.3, 0.97), (0.6, 0.82), (0.85, 0.5), (1.0, 0.0)], (0, -0.03, 0), (0, -0.115, 0), 24, (False, False))
    for v in bm.verts: v.co.x *= 0.075; v.co.z = zc + v.co.z * 0.108
    E.add(bm, M['emit'], attrs_of(lambda q: tuple(q), 0.5), smooth=True, wrap=False)
    for k in (-1, 0, 1):                                                  # (the grille: upright bars over the glass, a ring round it)
        pts = []
        for i in range(11):
            t = i / 10; a = math.pi * (t - 0.5); z = zc + 0.118 * math.sin(a)
            dep = 0.098 * math.cos(a) * math.cos(k * 0.55); pts.append(at(0.08 * k * math.cos(a) * 0.62, -0.03 - dep - 0.006, z))
        tube(G, M['iron'], pts, 0.0045, 6)
    ring_tube(G, M['iron'], [at(0.08 * math.cos(2 * math.pi * i / 20), -0.075, zc + 0.112 * math.sin(2 * math.pi * i / 20)) for i in range(20)], 0.0045, 6)
    for sx, sz in ((0, 1), (0, -1)):
        lathe(G, M['steel'], [(0.0, 0.006), (0.5, 0.006), (1.0, 0.0)], at(sx, -0.008, zc + sz * 0.142), at(sx, -0.013, zc + sz * 0.142), 8, (False, False))
    return G, E, [at(0, -0.06, zc)], {}

def fx_bare_bulb(M):
    """a bare bulb on its flex: a brown bakelite lampholder with its cord grip, the brass cap, the clear glass (lit: Emit) with the
       filament's coil inside it"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['bakelite'], [(0.0, 0.006), (0.12, 0.012), (0.2, 0.0165), (0.55, 0.0175), (0.6, 0.0165), (0.95, 0.017), (1.0, 0.0155)], at(0, 0, 0.0), at(0, 0, -0.058), 16, (True, False))
    lathe(G, M['brass'], [(0.0, 0.0135), (1.0, 0.0125)], at(0, 0, -0.058), at(0, 0, -0.066), 12, (False, False))
    bulb(E, M['emit'], at(0, 0, -0.064), 'pear', 0.95)
    return G, E, [at(0, 0, -0.105)], {}

def fx_bulb_batten(M):
    """a bulb on a batten holder screwed to the attic's ceiling: a round deal pattress block, the bakelite batten holder, the bulb"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['wood'], [(0.0, 0.056), (0.7, 0.056), (1.0, 0.052)], at(0, 0, 0.0), at(0, 0, -0.024), 24, (False, True), wood_attrs((1, 0, 0), (0, 0, -1)))
    lathe(G, M['bakelite'], [(0.0, 0.032), (0.25, 0.031), (0.35, 0.022), (0.8, 0.0175), (1.0, 0.016)], at(0, 0, -0.024), at(0, 0, -0.068), 20, (False, True))
    for k in range(2):
        a = math.pi * k + 0.6; lathe(G, M['steel'], [(0.0, 0.004), (0.6, 0.004), (1.0, 0.0)], at(0.024 * math.cos(a), 0.024 * math.sin(a), -0.024), at(0.024 * math.cos(a), 0.024 * math.sin(a), -0.0275), 8, (False, False))
    lathe(G, M['brass'], [(0.0, 0.0135), (1.0, 0.0125)], at(0, 0, -0.068), at(0, 0, -0.076), 12, (False, False))
    bulb(E, M['emit'], at(0, 0, -0.074), 'pear', 1.0)
    return G, E, [at(0, 0, -0.118)], {}

def fx_hurricane_lantern(M):
    """a tin hurricane lantern: the fuel font, the burner and its wick, the glass globe, the two air tubes to the top, the cap and
       its bail handle"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['tin'], [(0.0, 0.0), (0.04, 0.072), (0.4, 0.078), (0.75, 0.074), (0.9, 0.05), (1.0, 0.028)], at(0, 0, 0), at(0, 0, 0.075), 28, (True, False))
    lathe(G, M['tin'], [(0.0, 0.028), (0.3, 0.032), (1.0, 0.03)], at(0, 0, 0.075), at(0, 0, 0.095), 20, (False, True))
    lathe(G, M['glass'], [(0.0, 0.03), (0.15, 0.045), (0.45, 0.058), (0.75, 0.05), (0.92, 0.034), (1.0, 0.031)], at(0, 0, 0.095), at(0, 0, 0.245), 24, (False, False))
    lathe(G, M['tin'], [(0.0, 0.034), (0.3, 0.05), (0.55, 0.054), (0.75, 0.032), (1.0, 0.012)], at(0, 0, 0.245), at(0, 0, 0.3), 24, (True, True))
    for sx in (-1, 1):
        tube(G, M['tin'], [at(sx * 0.07, 0, 0.06), at(sx * 0.078, 0, 0.1), at(sx * 0.078, 0, 0.22), at(sx * 0.055, 0, 0.262)], 0.0065, 8)
    tube(G, M['wire'], [at(-0.078, 0, 0.17)] + [at(-0.078 * math.cos(math.pi * k / 12), 0, 0.17 + 0.165 * math.sin(math.pi * k / 12)) for k in range(1, 12)] + [at(0.078, 0, 0.17)], 0.0022, 5)
    flame(E, M['emit'], at(0, 0, 0.112), 0.03, 0.009)
    return G, E, [at(0, 0, 0.128)], {'glass': M['glass']}

def fx_green_shade(M):
    """a green enamel dish shade from the workshop's ceiling: the gallery and cord grip, the shade (green outside, white inside, black
       iron where the enamel has chipped, its rim rolled), the bulb"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['iron'], [(0.0, 0.012), (0.4, 0.014), (0.6, 0.026), (1.0, 0.03)], at(0, 0, 0.0), at(0, 0, -0.06), 16, (True, False))
    prof = [(0.0, 0.033), (0.1, 0.045), (0.25, 0.085), (0.45, 0.135), (0.65, 0.175), (0.82, 0.203), (1.0, 0.218)]
    lathe(G, M['enamel'], prof, at(0, 0, -0.06), at(0, 0, -0.27), 32, (False, False))
    bm = lathe_bm([(t, r - 0.0018) for t, r in prof], (0, 0, -0.061), (0, 0, -0.27), 32, (False, False))
    for f in bm.faces: f.normal_flip()
    G.add(bm, M['white'], metal_attrs(), smooth=True, wrap=False)
    ring_tube(G, M['enamel'], [at(0.2205 * math.cos(2 * math.pi * k / 32), 0.2205 * math.sin(2 * math.pi * k / 32), -0.271) for k in range(32)], 0.0035, 6)
    lathe(G, M['bakelite'], [(0.0, 0.016), (1.0, 0.017)], at(0, 0, -0.06), at(0, 0, -0.095), 16, (False, True))
    bulb(E, M['emit'], at(0, 0, -0.093), 'pear', 1.05)
    return G, E, [at(0, 0, -0.145)], {'white': M['white']}

def fx_anglepoise(M):
    """an anglepoise lamp on a bench: the stepped cast base, the pivot, the twin rods of the lower arm and their three springs, the
       upper arm to the shade, a conical metal shade looking down at the bench, the bulb in it"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    G.add(block((-0.085, 0.07, 0.0), (0.085, 0.24, 0.022), 0.004, 2), M['paint'], metal_attrs(), wrap=False)
    G.add(block((-0.06, 0.1, 0.022), (0.06, 0.21, 0.04), 0.004, 2), M['paint'], metal_attrs(), wrap=False)
    lathe(G, M['paint'], [(0.0, 0.02), (1.0, 0.016)], at(0, 0.155, 0.04), at(0, 0.155, 0.075), 12)
    piv = at(0, 0.155, 0.085); elbow = at(0, 0.075, 0.6); head = at(0, -0.17, 0.5)
    for sx in (-1, 1):
        tube(G, M['steel'], [piv + Vector((sx * 0.012, 0, 0)), elbow + Vector((sx * 0.012, 0, 0))], 0.0045, 6)
        tube(G, M['steel'], [elbow + Vector((sx * 0.01, 0, 0)), head + Vector((sx * 0.01, 0.02, 0.02))], 0.0042, 6)
    tube(G, M['steel'], [elbow + Vector((0, 0.035, -0.02)), elbow + Vector((0, 0.06, 0.02)), elbow + Vector((0, 0.05, 0.05))], 0.0035, 6)
    for k, (sx, dy) in enumerate(((-0.022, 0.0), (0.022, 0.0), (0.0, 0.02))):   # (the springs: tight coils from the base bracket up the arm)
        a = piv + Vector((sx, 0.03 + dy, -0.005)); b = piv + (elbow - piv) * 0.42 + Vector((sx, 0.02 + dy, 0))
        ax = (b - a); L = ax.length; ax.normalize(); u = ax.cross(Vector((1, 0, 0))).normalized(); v = ax.cross(u)
        pts = [a + ax * (L * i / 60) + (u * math.cos(i * 0.9) + v * math.sin(i * 0.9)) * 0.007 for i in range(61)]
        tube(G, M['spring'], pts, 0.0011, 4)
    lathe(G, M['paint'], [(0.0, 0.014), (1.0, 0.014)], elbow + Vector((-0.02, 0, 0)), elbow + Vector((0.02, 0, 0)), 10)
    ax = Vector((0, -0.45, -1)).normalized(); mouth = head + ax * 0.13
    lathe(G, M['paint'], [(0.0, 0.022), (0.25, 0.03), (0.55, 0.05), (0.85, 0.068), (1.0, 0.072)], head, mouth, 24, (True, False))
    bm = lathe_bm([(0.0, 0.019), (0.25, 0.027), (0.55, 0.047), (0.85, 0.065), (1.0, 0.069)], head, mouth, 24, (False, False))
    for f in bm.faces: f.normal_flip()
    G.add(bm, M['white'], metal_attrs(), smooth=True, wrap=False)
    lathe(G, M['bakelite'], [(0.0, 0.014), (1.0, 0.015)], head + ax * 0.012, head + ax * 0.04, 12)
    bm = lathe_bm([(0.0, 0.0125), (0.25, 0.016), (0.45, 0.025), (0.7, 0.028), (0.88, 0.022), (1.0, 0.0)], head + ax * 0.04, head + ax * 0.12, 14, (True, False))
    E.add(bm, M['emit'], attrs_of(lambda q: tuple(q), 0.5), smooth=True, wrap=False)
    return G, E, [head + ax * 0.085], {'white': M['white']}

def fx_boiler_glow(M):
    """what you see through the boiler's fire door: the grate's bars, a bed of coal burning (the glowing lumps: Emit), dead clinker
       and ash round it, the sooted firebrick at the back"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    for k in range(7): G.add(block((-0.17, -0.045 + k * 0.014, 0.0), (0.17, -0.038 + k * 0.014, 0.012), 0.001, 1), M['iron'], metal_attrs(), wrap=False)
    G.add(block((-0.175, 0.03, 0.0), (0.175, 0.05, 0.25), 0.003, 2), M['firebrick'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    coal_lumps(G, M['coal'], 26, (-0.165, 0.165, -0.045, 0.03, 0.012), 7, (0.016, 0.03), 0.65, glow=E if False else None)
    glow = S.Geo(1, 1, False, False)
    import modules as Mo
    rnd = random.Random(4)
    for k in range(18):                                                   # (the burning ones, deep in the bed, glowing through)
        s = rnd.uniform(0.016, 0.028); x, y = rnd.uniform(-0.14, 0.14), rnd.uniform(-0.03, 0.02)
        E.add(Mo.rock((x, y, 0.018 + s * 0.4), (s, s * 0.9, s * 0.8), rnd.uniform(0, 40), 1, 0.65), M['emit'], attrs_of(lambda q: tuple(q), 0.5), smooth=False, wrap=False)
    return G, E, [at(0, -0.01, 0.06)], {'housing': (0.19, 0.06, 0.28)}

def fx_kiln_glow(M):
    """the kiln's open spy door: a reveal of firebricks, inside it the white-hot chamber (Emit) and against the glow the dark shapes of
       what is being fired: a shelf on its props, and on it a row of doll heads"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    for (x0, x1, z0, z1) in ((-0.2, -0.15, 0.0, 0.3), (0.15, 0.2, 0.0, 0.3), (-0.15, 0.15, 0.0, 0.045), (-0.15, 0.15, 0.255, 0.3)):
        G.add(block((x0, -0.05, z0), (x1, 0.03, z1), 0.004, 2), M['firebrick'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    E.add(Dr.quad_bm([(-0.15, 0.045, 0.045), (0.15, 0.045, 0.045), (0.15, 0.045, 0.255), (-0.15, 0.045, 0.255)], (0, -1, 0)), M['emit'], attrs_of(lambda q: tuple(q), 0.5), wrap=False)
    G.add(block((-0.15, -0.01, 0.105), (0.15, 0.035, 0.115), 0.001, 1), M['shelf'], metal_attrs(), wrap=False)
    for sx in (-0.12, 0.12): G.add(block((sx - 0.008, 0.0, 0.045), (sx + 0.008, 0.016, 0.105), 0.001, 1), M['shelf'], metal_attrs(), wrap=False)
    for k in range(5):                                                    # (bisque heads, bald, their eyes still holes)
        x = -0.1 + 0.05 * k; c = at(x, 0.012, 0.115 + 0.032)
        G.add(lathe_bm([(0.0, 0.0), (0.15, 0.022), (0.5, 0.03), (0.8, 0.026), (0.95, 0.014), (1.0, 0.009)], c + Vector((0, 0, 0.034)), c - Vector((0, 0, 0.032)), 12, (False, True)),
              M['bisque'], metal_attrs(), smooth=True, wrap=False)
    return G, E, [at(0, 0.02, 0.15)], {'housing': (0.21, 0.06, 0.32)}

def fx_fire_embers(M):
    """a fire gone low in its grate: the cast-iron basket's front bars and its legs, a bed of coals (the hot ones: Emit), a log half
       burnt through, grey ash"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    for k in range(5):
        z = 0.03 + k * 0.022; tube(G, M['iron'], [at(-0.25, -0.13, z), at(0.25, -0.13, z)], 0.0065, 8)
    for x in (-0.25, -0.125, 0.0, 0.125, 0.25): tube(G, M['iron'], [at(x, -0.13, 0.0), at(x, -0.13, 0.12)], 0.006, 8)
    for x in (-0.23, 0.23): G.add(block((x - 0.015, -0.14, 0.0), (x + 0.015, 0.12, 0.025), 0.003, 1), M['iron'], metal_attrs(), wrap=False)
    G.add(block((-0.24, -0.12, 0.02), (0.24, 0.12, 0.03), 0.002, 1), M['ash'], metal_attrs(), wrap=False)
    coal_lumps(G, M['coal'], 22, (-0.22, 0.22, -0.11, 0.11, 0.03), 9, (0.018, 0.032), 0.6)
    import modules as Mo
    rnd = random.Random(8)
    for k in range(14):
        s = rnd.uniform(0.014, 0.026); x, y = rnd.uniform(-0.17, 0.17), rnd.uniform(-0.08, 0.08)
        E.add(Mo.rock((x, y, 0.035 + s * 0.35), (s, s * 0.9, s * 0.8), rnd.uniform(0, 40), 1, 0.6), M['emit'], attrs_of(lambda q: tuple(q), 0.5), smooth=False, wrap=False)
    lp = [(0.0, 0.034), (0.3, 0.037), (0.55, 0.031), (0.7, 0.02), (0.85, 0.024), (1.0, 0.018)]           # (the log, burnt through in the middle)
    G.add(lathe_bm(lp, (-0.2, 0.02, 0.075), (0.19, -0.03, 0.082), 10, (True, True)), M['char'], wood_attrs((1, 0, 0), (0, -1, 0)), smooth=False, wrap=False)
    return G, E, [at(0, 0, 0.06)], {'housing': (0.3, 0.17, 0.5)}

def fx_candelabrum(M):
    """a three-light candelabrum on the dining table, silver plate worn to the copper and tarnished: a domed foot, a baluster stem,
       two scrolled arms and the middle socket, drip pans, candles burnt to different heights, their flames"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    lathe(G, M['silver'], [(0.0, 0.0), (0.05, 0.062), (0.2, 0.06), (0.45, 0.04), (0.7, 0.022), (1.0, 0.014)], at(0, 0, 0), at(0, 0, 0.045), 28, (True, False))
    lathe(G, M['silver'], [(0.0, 0.014), (0.1, 0.02), (0.18, 0.012), (0.5, 0.01), (0.62, 0.022), (0.72, 0.026), (0.82, 0.015), (1.0, 0.014)], at(0, 0, 0.045), at(0, 0, 0.255), 16)
    tops = []
    for sx in (-1, 1):
        pts = [at(0, 0, 0.245)] + [at(sx * 0.12 * (k / 8), 0, 0.245 - 0.035 * math.sin(math.pi * k / 8) + 0.035 * (k / 8) ** 2) for k in range(1, 9)]
        tube(G, M['silver'], pts, 0.0055, 8)
        b = at(sx * 0.12, 0, 0.282)
        lathe(G, M['silver'], [(0.0, 0.006), (0.4, 0.008), (0.6, 0.026), (0.85, 0.028), (1.0, 0.025)], b - Vector((0, 0, 0.012)), b + Vector((0, 0, 0.003)), 16)
        lathe(G, M['silver'], [(0.0, 0.01), (1.0, 0.0125)], b + Vector((0, 0, 0.003)), b + Vector((0, 0, 0.022)), 12)
        top = candle(G, M, b + Vector((0, 0, 0.022)), 0.085 if sx < 0 else 0.06, 0.0105, seed=11 + sx); flame(E, M['emit'], top - Vector((0, 0, 0.002)))
        tops.append(top + Vector((0, 0, 0.01)))
    b = at(0, 0, 0.255)
    lathe(G, M['silver'], [(0.0, 0.01), (0.5, 0.026), (0.8, 0.028), (1.0, 0.025)], b, b + Vector((0, 0, 0.015)), 16)
    lathe(G, M['silver'], [(0.0, 0.01), (1.0, 0.0125)], b + Vector((0, 0, 0.015)), b + Vector((0, 0, 0.034)), 12)
    top = candle(G, M, b + Vector((0, 0, 0.034)), 0.11, 0.0105, seed=17); flame(E, M['emit'], top - Vector((0, 0, 0.002))); tops.append(top + Vector((0, 0, 0.01)))
    return G, E, tops, {}

def fx_batten_light(M):
    """a two-foot fluorescent batten on the servants' corridor ceiling: the pressed steel channel, its end caps and tube holders, the
       tube (Emit), fly specks"""
    G, E = S.Geo(1, 1, False, False), S.Geo(1, 1, False, False)
    G.add(block((-0.295, -0.032, -0.038), (0.295, 0.032, 0.0), 0.004, 2), M['paint'], metal_attrs(), wrap=False)
    for sx in (-1, 1):
        G.add(block((sx * 0.3 - 0.012, -0.022, -0.074), (sx * 0.3 + 0.012, 0.022, -0.036), 0.003, 2), M['plastic'], metal_attrs(), wrap=False)
    lathe(E, M['emit'], [(0.0, 0.0125), (1.0, 0.0125)], at(-0.288, 0, -0.056), at(0.288, 0, -0.056), 12, (True, True))
    return G, E, [at(0, 0, -0.056)], {}

BUILD = {k: globals()['fx_' + k] for k in FIX}
K0 = {'sconce_shade': 1.5, 'pendant_shade': 2.2, 'night_light': 0.35, 'sconce_candles': 0.7, 'chandelier': 3.4, 'standard_lamp': 1.8, 'bulkhead': 1.8,
      'bare_bulb': 2.6, 'bulb_batten': 2.2, 'hurricane_lantern': 0.75, 'green_shade': 2.6, 'anglepoise': 1.4, 'boiler_glow': 1.0, 'kiln_glow': 1.2,
      'fire_embers': 1.1, 'candelabrum': 0.9, 'batten_light': 2.2}

# ================================================================ materials
def wax(name, base='#e7dcc4', age=1.3):
    """old candle wax: ivory gone yellow, a little translucent at the edges (lighter), soot round the wick, dust in the drips"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op); c = lin(base)
    col = m.mix(m.remap(m.noise(op, 40, 3), 0.3, 0.7, 0.0, 0.25), c, m.mix(1.0, c, (0.93, 0.86, 0.7), 'MULTIPLY'))
    col = m.mix(m.math('MULTIPLY', m.remap(m.edge(), 0.1, 0.6), 0.4), col, m.hsv(col, 0.5, 0.9, 1.12))
    col = m.mix(m.math('MULTIPLY', m.remap(m.cavity(), 0.9, 0.5), 0.6 * age), col, m.mix(1.0, col, (0.6, 0.55, 0.45), 'MULTIPLY'))
    rough = m.remap(m.noise(op, 60, 3), 0.3, 0.7, 0.35, 0.55)
    return finish(m, col, rough, m.math('MULTIPLY', m.noise(op, 300, 3), 0.0002))

def coal(name):
    """coal and clinker: black, glossy on fresh faces, dull and grey with ash where it burnt, rust-brown clinker"""
    m = kitlib.Mat(name); op = m.attr('opos', True); pr = m.attr('prand')
    col = m.mix(m.remap(m.noise(op, 90, 4), 0.3, 0.7), lin('#121110'), lin('#252321'))
    up = m.remap(sep(m, m.geo('Normal'))[2], 0.2, 0.9)
    ash = m.math('MULTIPLY', up, m.remap(m.noise(op, 30, 4, 0.6), 0.35, 0.7, 0.0, 0.9))
    col = m.mix(ash, col, m.mix(m.remap(m.noise(op, 200, 2), 0.3, 0.7), lin('#8c8780'), lin('#bdb7ad')))
    col = m.mix(m.math('MULTIPLY', m.remap(pr, 0.8, 0.9), 0.7), col, lin('#5a3a26'))
    rough = m.mixf(ash, m.remap(m.noise(op, 120, 3), 0.3, 0.7, 0.3, 0.55), 0.95)
    return finish(m, col, rough, m.math('MULTIPLY', m.noise(op, 160, 3), 0.0006))

def char(name):
    """a log burnt black: cracked into squares (alligatored char), grey ash in the cracks and on top, brown wood at the burnt-through end"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True)
    v = m.voronoi(m.map(g, (60, 60, 25)), 1.0, 'Distance', 'DISTANCE_TO_EDGE'); crk = m.remap(v, 0.06, 0.0)
    col = m.mix(m.remap(m.noise(op, 50, 3), 0.3, 0.7), lin('#151311'), lin('#2a2622'))
    col = m.mix(crk, col, lin('#8a857c'))
    col = m.mix(m.math('MULTIPLY', m.remap(sep(m, m.geo('Normal'))[2], 0.3, 0.9), 0.6), col, lin('#9a958c'))
    return finish(m, col, 0.85, m.math('MULTIPLY', crk, -0.0015))

def firebrick(name):
    """firebrick: sandy buff, sooted black where the flame licks, glazed dark at the hot face"""
    m = kitlib.Mat(name); op = m.attr('opos', True)
    col = m.mix(m.remap(m.noise(op, 60, 4), 0.3, 0.7), lin('#b59a6c'), lin('#8e7550'))
    col = m.mix(m.remap(m.noise(op, 400, 2), 0.6, 0.75), col, lin('#d9c9a4'))
    soot = m.remap(m.noise(op, 6, 4, 0.6), 0.3, 0.6, 0.3, 0.95); col = m.mix(soot, col, lin('#1c1814'))
    return finish(m, col, 0.9, m.math('MULTIPLY', m.noise(op, 250, 3), 0.0006))

def bisque(name):
    """unglazed bisque porcelain gone grey with soot"""
    m = kitlib.Mat(name); op = m.attr('opos', True)
    col = m.mix(m.remap(m.noise(op, 20, 3), 0.3, 0.7), lin('#cdbfae'), lin('#9c8f80'))
    return finish(m, col, 0.8, m.math('MULTIPLY', m.noise(op, 200, 3), 0.0002))

def materials(style):
    k = f'fix_{style}'
    M = {'emit': kitlib.reserved('Emit', (1.0, 0.8, 0.55), emit=True), 'glass': kitlib.glass(),
         'brass': kitlib.metal(k + '_brass', 'brass', color='#a4824a', rust=0.0, age=1.4), 'iron': kitlib.metal(k + '_iron', 'iron', rust=0.6, age=1.4),
         'steel': kitlib.metal(k + '_steel', 'steel', rust=0.25, age=1.3), 'bakelite': kitlib.metal(k + '_bakelite', 'iron', color='#2b1c14', rust=0.0, age=1.2),
         'flex': kitlib.fabric(k + '_flex', '#5a4634', weave=1.6, fade=0.3, age=1.4), 'wick': kitlib.grey(k + '_wick', (0.015, 0.012, 0.01)),
         'wax': wax(k + '_wax'), 'wire': kitlib.metal(k + '_wire', 'iron', rust=0.8, age=1.5)}
    M['shade'] = kitlib.fabric(k + '_shade', '#d39aa0' if style == 'wood' else '#c8a77c', weave=1.4, fade=0.55, age=1.5)
    M['braid'] = kitlib.fabric(k + '_braid', '#b77c84' if style == 'wood' else '#a8874e', weave=2.0, fade=0.4, age=1.4)
    M['fringe'] = kitlib.fabric(k + '_fringe', '#a8874e', weave=0.0, fade=0.4, stripes=('#6b5430', 0.006), age=1.4)
    M['sleeve'] = kitlib.porcelain(k + '_sleeve', '#ece6d8', glaze=False, crackle=0.2, age=1.5)
    M['wood'] = Dr.mahogany(k + '_mahogany') if style == 'tile' else Dr.bare_boards(k + '_deal', 'deal', [], age=1.4, tone=0.8)
    M['tin'] = Dr.paint(k + '_tin', ['#7b1e18', '#5e5e58', '#5e5e58'], 'steel', [], kick=0.0, chips=1.3, gloss=0.35, age=1.5, craze=0.0, joints=False, rust=0.9)
    M['enamel'] = Dr.paint(k + '_enamel', ['#3c5a43', '#1b1b1a', '#1b1b1a'], 'steel', [], kick=0.0, chips=0.6, gloss=0.18, age=1.3, craze=0.0, joints=False, rust=0.6)
    M['white'] = Dr.paint(k + '_white', ['#e4e0d4', '#1b1b1a', '#1b1b1a'], 'steel', [], kick=0.0, chips=0.4, gloss=0.15, age=1.2, craze=0.0, joints=False, rust=0.4)
    M['paint'] = Dr.paint(k + '_paint', ['#3b3f3a' if style == 'workshop' else '#d9d4c4', '#1b1b1a', '#1b1b1a'], 'steel', [], kick=0.0, chips=0.6, gloss=0.3, age=1.3, craze=0.0, joints=False, rust=0.5)
    M['spring'] = kitlib.metal(k + '_spring', 'steel', color='#77797b', rust=0.3)
    M['plastic'] = kitlib.porcelain(k + '_plastic', '#d8d2bf', glaze=False, crackle=0.0, age=1.6)
    M['silver'] = kitlib.metal(k + '_silver', 'steel', color='#b9b5aa', rust=0.0, age=1.6)
    M['coal'] = coal(k + '_coal'); M['char'] = char(k + '_char'); M['ash'] = coal(k + '_ash'); M['firebrick'] = firebrick(k + '_firebrick')
    M['shelf'] = firebrick(k + '_shelf'); M['bisque'] = bisque(k + '_bisque')
    return M

# ================================================================ the emission profile
def profile_material(role_mat, kind):
    """stand-ins for the profile bake: a fabric shade lets a third through, tinted (translucent), glass lets it all through, a white
       reflector reflects, everything else is a dull grey"""
    name = f'prof_{kind}_{role_mat.name if role_mat else "x"}'
    m = bpy.data.materials.get(name)
    if m: return m
    M = kitlib.Mat(name); nt = M.nt; out = M.out_node
    for n in list(nt.nodes):
        if n not in (out,): nt.nodes.remove(n)
    if kind == 'glass':
        b = nt.nodes.new('ShaderNodeBsdfTransparent'); nt.links.new(b.outputs[0], out.inputs['Surface'])
    elif kind in ('shade', 'fringe'):
        col = (0.85, 0.62, 0.62) if 'wood' in (role_mat.name if role_mat else '') else (0.85, 0.72, 0.52)
        tr = nt.nodes.new('ShaderNodeBsdfTranslucent'); tr.inputs['Color'].default_value = (*col, 1)
        df = nt.nodes.new('ShaderNodeBsdfDiffuse'); df.inputs['Color'].default_value = (*col, 1)
        mx = nt.nodes.new('ShaderNodeMixShader'); mx.inputs[0].default_value = 0.38 if kind == 'shade' else 0.2
        nt.links.new(df.outputs[0], mx.inputs[1]); nt.links.new(tr.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], out.inputs['Surface'])
    else:
        b = nt.nodes.new('ShaderNodeBsdfDiffuse'); b.inputs['Color'].default_value = ((0.8, 0.79, 0.75, 1) if kind == 'white' else (0.2, 0.19, 0.17, 1))
        nt.links.new(b.outputs[0], out.inputs['Surface'])
    return M.m

def bake_profile(fid, body, centres, roles, mount_kind, housing=None):
    """the fixture's emission profile (see the header). -> (rgb list, mount [x, y, z] three.js fixture-local)"""
    sc = bpy.context.scene; tmp = []; t0 = time.time()
    c = sum(centres, Vector()) / len(centres)
    shown = {o: o.hide_render for o in sc.objects}
    for o in sc.objects: o.hide_render = o is not body
    # the fixture's materials swapped for their light-transport stand-ins
    old = [s.material for s in body.material_slots]
    rmap = {}
    for k, v in roles.items():
        if hasattr(v, 'name'): rmap[v.name] = k
    for s in body.material_slots:
        if s.material is None: continue
        kind = rmap.get(s.material.name, 'glass' if s.material.name == 'Glass' else 'dull')
        s.material = profile_material(s.material, kind)
    # the sphere of directions (UVs = the lat-long table), sees only light
    R = 5.0; nu, nv = PW * 2, PH * 2; me = bpy.data.meshes.new('prof_sphere'); verts, faces, uvs = [], [], []
    for j in range(nv + 1):
        th = math.pi * j / nv
        for i in range(nu + 1):
            lam = 2 * math.pi * i / nu - math.pi; x3, y3, z3 = math.sin(th) * math.sin(lam), math.cos(th), math.sin(th) * math.cos(lam)
            verts.append(tuple(c + Vector((x3, -z3, y3)) * R))
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i; faces.append((a, a + nu + 1, a + nu + 2, a + 1))
    me.from_pydata(verts, [], faces); uvl = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index; j, i = divmod(vi, nu + 1); uvl.data[li].uv = (i / nu, 1.0 - j / nv)
        p.use_smooth = True
    sph = kitlib.link(bpy.data.objects.new('prof_sphere', me)); tmp.append(sph)
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:                                                    # (facing in, toward the light)
        if f.normal.dot(f.calc_center_median() - c) > 0: f.normal_flip()
    bm.to_mesh(me); bm.free()
    sm = kitlib.Mat('prof_white'); sm.out((0.8, 0.8, 0.8), 1.0); sph.data.materials.append(sm.m)
    sph.visible_diffuse = sph.visible_glossy = sph.visible_transmission = False; sph.visible_shadow = False
    blockers = []
    if mount_kind == 'wall':                                              # (the wall behind it: light that goes into it is gone)
        blockers.append(S.quad('prof_wall', (-6, 0.0005, -6), (12, 0, 0), (0, 0, 12)))
    if housing:                                                           # (the firebox: open only at the front)
        hx, hy, hz = housing; z0 = -0.03
        for p0, ex, ey in (((-hx, -hy, z0), (2 * hx, 0, 0), (0, 0, hz)), ):
            pass
        bmh = block((-hx, -0.06, z0), (hx, hy + 0.25, hz), 0.0, 1)
        bmesh.ops.delete(bmh, geom=[f for f in bmh.faces if f.normal.y < -0.9], context='FACES')
        for f in bmh.faces: f.normal_flip()
        hm = bpy.data.meshes.new('prof_housing'); bmh.to_mesh(hm); blockers.append(kitlib.link(bpy.data.objects.new('prof_housing', hm)))
    bk = kitlib.Mat('prof_black'); bk.out((0.0, 0.0, 0.0), 1.0)
    for b in blockers:
        b.data.materials.clear(); b.data.materials.append(bk.m); b.hide_render = False; tmp.append(b)
    for k, p in enumerate(centres):
        L = kitlib.link(bpy.data.objects.new(f'prof_l{k}', bpy.data.lights.new(f'prof_l{k}', 'POINT'))); L.data.energy = 100.0 / len(centres)
        L.data.shadow_soft_size = 0.02 if mount_kind != 'practical' else 0.05; L.location = p; tmp.append(L)
    im = bpy.data.images.new(f'prof_{fid}', nu, nv, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
    tn = sm.nt.nodes.new('ShaderNodeTexImage'); tn.image = im; sm.nt.nodes.active = tn
    kitlib.select([sph], sph); sph.hide_render = False
    sc.cycles.samples = kitlib.spp(512); sc.render.bake.use_pass_direct = True; sc.render.bake.use_pass_indirect = True; sc.render.bake.use_pass_color = False
    sc.render.bake.margin = 2; sc.render.bake.use_selected_to_active = False; sc.render.bake.use_clear = True
    wkeep = None
    if sc.world.use_nodes:                                                 # (no world light: the sphere's own rays escape to it)
        bg = next((n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND'), None)
        if bg: wkeep = (bg, bg.inputs['Strength'].default_value); bg.inputs['Strength'].default_value = 0.0
    wcol = tuple(sc.world.color); sc.world.color = (0, 0, 0)
    bpy.ops.object.bake(type='DIFFUSE')
    if wkeep: wkeep[0].inputs['Strength'].default_value = wkeep[1]
    sc.world.color = wcol
    d = os.path.join(TMP, 'tex', 'profiles'); os.makedirs(d, exist_ok=True)
    kitlib.save_exr(im, os.path.join(d, f'{fid}_raw.exr')); kitlib.denoise_image(os.path.join(d, f'{fid}_raw.exr'), os.path.join(d, f'{fid}.exr'))
    a = np.maximum(kitlib.load_exr(os.path.join(d, f'{fid}.exr'))[..., :3], 0.0)   # (load_exr gives the image's top row first: row 0 = straight up)
    a = a.reshape(PH, 2, PW, 2, 3).mean(axis=(1, 3))
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]; a = a / max(lum.mean(), 1e-9)
    rgb = [round(float(v), 3) for v in a.reshape(-1)]
    for o in tmp:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o)
    bpy.data.images.remove(im)
    for s, m in zip(body.material_slots, old): s.material = m
    for o, h in shown.items():
        if o.name in bpy.data.objects: o.hide_render = h
    from PIL import Image                                                  # (a preview: the table, tone-mapped, big)
    pv = np.clip(a / (1.0 + a) * 1.6, 0, 1) ** (1 / 2.2)
    Image.fromarray((pv * 255).astype(np.uint8)).resize((PW * 8, PH * 8), Image.NEAREST).save(os.path.join(d, f'{fid}.png'))
    mount = [round(c.x, 4), round(c.z, 4), round(-c.y, 4)]
    print(f'  profile {fid}: mean {np.mean(0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]):.3f}, max {a.max():.2f}, {time.time() - t0:.0f}s', flush=True)
    return rgb, mount

# ================================================================ build, bake, register
def build_style(style, ids, profiles):
    t0 = time.time(); kitlib.reset(); M = materials(style); bodies, emits, info = [], [], {}
    for i, fid in enumerate(ids):
        G, E, centres, roles = BUILD[fid](M)
        body = G.build(FIX[fid]['node']); em = E.build(FIX[fid]['emit'])
        for o in (body, em):
            for p in o.data.polygons: pass
        roles = dict(roles); mk = FIX[fid]['mount']
        if 'glowglass' in roles: roles.pop('glowglass')
        housing = roles.pop('housing', None)
        if '--no-profiles' not in sys.argv:
            rgb, mount = bake_profile(fid, body, centres, roles, mk, housing)
            profiles[fid] = {'w': PW, 'h': PH, 'rgb': rgb, 'mount': mount, 'k0': K0[fid], 'mountKind': mk, 'flicker': bool(FIX[fid].get('flicker'))}
        bodies.append(body); emits.append(em); info[fid] = {'tris': kitlib.tris(body) + kitlib.tris(em)}
    if '--profiles-only' in sys.argv: return
    # the bodies baked into the style's atlas (apart while baking), the emit parts keep the reserved Emit
    for i, o in enumerate(bodies): o.location.x += 3.0 * i
    kitlib.unwrap(bodies, margin=0.004, smart=True, angle=60)
    files = kitlib.bake_set(bodies, f'fix_{style}', PX, 64)
    mat = kitlib.baked_material('Kit_fix_' + style, files, double=True)
    for i, (o, em) in enumerate(zip(bodies, emits)):
        o.location.x -= 3.0 * i
        o.data.materials.clear(); o.data.materials.append(mat); o.data.polygons.foreach_set('material_index', [0] * len(o.data.polygons))
        for ob in (o, em):
            for a in [a.name for a in ob.data.attributes if a.name in ATTRS]: ob.data.attributes.remove(ob.data.attributes[a])
            if not ob.data.uv_layers: ob.data.uv_layers.new(name='UVMap')
        em.data.materials.clear(); em.data.materials.append(M['emit'])
        em.parent = o; em.matrix_parent_inverse.identity(); em.location = (0, 0, 0)
        o['kit'] = 'fix'; o.data.name = o.name; em.data.name = em.name
    for fid, d in info.items(): print(f'  {fid}: {d}', flush=True)
    print(f'  bake {files["times"]["total"]}s', flush=True)
    if '--sheets' in sys.argv: sheets(style, ids, bodies)
    json.dump({'info': info, 'bake': files['times']['total']}, open(os.path.join(TMP, f'fixtures_{style}.json'), 'w'), indent=1)
    kitlib.register(f'fixtures_{style}', bodies)
    print(f'fixtures {style}: done in {time.time() - t0:.0f}s', flush=True)

def sheets(style, ids, bodies):
    """each fixture lit (its Emit glowing) where it belongs, in a dim room of its style, and close"""
    from PIL import Image
    d = os.path.join(TMP, 'sheets', 'fixtures'); os.makedirs(d, exist_ok=True); sc = bpy.context.scene
    man = S.manifest_load()['styles'].get(style if style != 'common' else 'concrete', {})
    fl = S.ship_mat('sh_floor', man['floor']) if man.get('floor') else kitlib.grey()
    wA = S.ship_mat('sh_wallA', man['wall'], 0) if man.get('wall') else kitlib.grey()
    em = kitlib.Mat('sh_emit'); e2 = em.n('ShaderNodeEmission'); e2.inputs['Strength'].default_value = 12.0; e2.inputs['Color'].default_value = (1.0, 0.72, 0.45, 1)
    em.l(e2.outputs[0], em.out_node.inputs['Surface'])
    glm = kitlib.Mat('sh_glass'); glm.b.inputs['Transmission Weight'].default_value = 1.0; glm.b.inputs['Roughness'].default_value = 0.03
    shots = []; FW = 2.25
    def show(o, on):
        for q in [o] + list(o.children): q.hide_render = not on
    for o in bodies: show(o, False)
    for fid, o in zip(ids, bodies):
        tmp = []; keep = lambda q: (tmp.append(q), q)[1]; mk = FIX[fid]['mount']; show(o, True)
        kids = [o] + list(o.children); swaps = []
        for q in kids:
            for i, m_ in enumerate(q.data.materials):
                if m_.name == 'Emit': swaps.append((q, i, m_)); q.data.materials[i] = em.m
                elif m_.name == 'Glass': swaps.append((q, i, m_)); q.data.materials[i] = glm.m
        H = 3.0
        keep(S.quad('sh_w', (-FW, 0.0005, 0), (2 * FW, 0, 0), (0, 0, H), mat=wA)); keep(S.quad('sh_f', (-FW, -2 * FW, 0), (2 * FW, 0, 0), (0, 2 * FW, 0), mat=fl))
        keep(S.quad('sh_c', (-FW, 0.0, H), (2 * FW, 0, 0), (0, -2 * FW, 0), mat=kitlib.grey('sh_cm', (0.45, 0.43, 0.4))))
        bb = [o.matrix_world @ Vector(v) for v in o.bound_box]; cz = sum(v.z for v in bb) / 8; size = max(max(v.x for v in bb) - min(v.x for v in bb), max(v.z for v in bb) - min(v.z for v in bb))
        loc = Vector((0, 0, 0))
        if mk == 'ceiling': o.location = (0, -0.8, H); loc = Vector((0, -0.8, H + cz))
        elif mk in ('floor', 'surface', 'practical'): o.location = (0, -0.6, 0.0 if mk == 'floor' else 0.75); loc = Vector((0, -0.6, (0 if mk == 'floor' else 0.75) + cz))
        else: loc = Vector((0, 0, cz))
        if mk in ('surface', 'practical'): keep(kitlib.link(bpy.data.objects.new('sh_table', bpy.data.meshes.new('sh_table')))).data.from_pydata(*_box_data((-0.5, -1.0, 0.0), (0.5, -0.2, 0.75)))
        keep(S.lamp('sh_fill', 'AREA', 60, (1.5, -3.0, 2.2), None, 2.0, (0.7, 0.78, 1.0)))
        dist = max(0.6, size * 3.2)
        S.cam_at(loc + Vector((0.35 * dist, -dist, (-0.3 if mk == 'ceiling' else 0.12) * dist)), loc, 40); shots.append(S.render(os.path.join(d, f'{fid}.png'), 800, 900, 96))
        S.cam_at(loc + Vector((0.6, -2.2, -0.6 if mk in ('wall', 'ceiling') else 0.5)), loc, 30); shots.append(S.render(os.path.join(d, f'{fid}_room.png'), 800, 900, 96))
        for q, i, m_ in swaps: q.data.materials[i] = m_
        o.location = (0, 0, 0); show(o, False)
        for q in tmp:
            if q.name in bpy.data.objects: bpy.data.objects.remove(q)
    for o in bodies: show(o, True)
    ims = [Image.open(p).convert('RGB') for p in shots]; hgt = 450
    ims = [im.resize((int(im.width * hgt / im.height), hgt)) for im in ims]
    out = Image.new('RGB', (sum(i.width for i in ims), hgt)); x = 0
    for im in ims: out.paste(im, (x, 0)); x += im.width
    out.save(os.path.join(d, f'fixtures_{style}.png'))

def _box_data(lo, hi):
    bm = block(lo, hi, 0.0, 1); vs = [tuple(v.co) for v in bm.verts]; fs = [[v.index for v in f.verts] for f in bm.faces]; bm.free(); return vs, [], fs

def main():
    os.makedirs(LIGHT, exist_ok=True); path = os.path.join(LIGHT, 'profiles.json')
    try: prof = json.load(open(path))['profiles']
    except (OSError, ValueError, KeyError): prof = {}
    only = OPTS.only or set()
    for st in list(defs.KIT['styles']) + ['common']:
        ids = [k for k, f in FIX.items() if f['style'] == st]
        if not ids or (only and st not in only and not (only & set(ids))): continue
        if only & set(ids): ids = [k for k in ids if k in only] if not (st in only) else ids
        build_style(st, ids, prof)
        json.dump({'version': 1, 'w': PW, 'h': PH, 'note': 'relative intensity (mean 1) per direction from the light centre, fixture-local three.js axes; '
                   'white emitter; see tools/blender/kit/fixtures.py', 'profiles': dict(sorted(prof.items()))}, open(path, 'w'), separators=(',', ':'))
    print('profiles:', len(prof), '->', path)

if __name__ == '__main__':
    main()
