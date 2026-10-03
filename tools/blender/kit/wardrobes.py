# Escape from Barbi Blue: the wardrobes you hide in (WP2.3; build spec B7, H10; level.js makeWardrobe, js/kit.js wardrobe).
#   Ward_body_<style>   the carcass 1.15 x 0.60 x 2.25 m (cornice and base to at most 1.25 x 0.66 x 2.35), open at the front behind
#                       the doors and hollow: its sides, back, floor and roof are seen from inside too; a hanging rail, and the coats
#                       only beyond x = +-0.30 (the middle is where you stand)
#   Ward_leafL_<style>  the left door, 0.575 x 2.2 x 0.03 m from 0.025 m up, its origin on its hinge (x -0.575, y -0.305), along +x
#   Ward_leafR_<style>  the right door (hinge x +0.575), along -x: the same door built again (its own wear) and mirrored, its paint
#                       and stencils read from the door's own design position ('lp'), so nothing on it comes out back to front
#   wood      painted pine, duck-egg over cream over the primer; a stencilled duck on each lower panel, stars along the frieze;
#             louvred above; children's coats and a striped pinafore inside
#   tile      a mahogany armoire: a deep cornice with dentils, raised panels in bolection mouldings below, louvres above, a brass
#             escutcheon and key; a frock coat and a dress
#   concrete  a double steel locker: pressed doors with louvred vents (cut out: you see through them), folded edges, dents, a card
#             holder, a padlock hasp; a raincoat and overalls on hooks
#   attic     a stained pine wardrobe half under a dust sheet (cloth, simulated), thick with dust; two old dresses
#   workshop  a louvred tool cupboard, louvres top to bottom, institutional green, a stencilled number, hasp and padlock; aprons
# The louvres are real slats with real gaps (no cut-outs): from inside you see out between them, from outside in only at a slant.
#   py -3.11 tools/blender/kit/wardrobes.py [--preview] [--force] [--only wood,tile] [--sheets]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
from surfaces2 import sep, comb, finish
from doors import (quad_bm, Face, panelled, lathe_bm, tube, block, plate, rounded, member, attrs_of, metal_attrs, wood_attrs, arris,
                   perimeter, knuckles, OVOLO, BOLECTION, RAISED, SQUARE, ATTRS)
from kitlib import OPTS, TMP, lin

BW, BD, BH = 1.15, 0.6, 2.25                                # the carcass (level.js makeWardrobe)
HX, HY, HZ = 0.575, -0.305, 0.025                           # the hinge axes, the leaves' bottom (kitdefs wardrobes, kit.js WARD)
LW, LH, LT = 0.575, 2.2, 0.03                               # a leaf
YF = -0.288                                                 # the carcass's front edge: the leaves close in front of it (y -0.32 .. -0.29)
YB = BD / 2                                                 # its back, against the wall
CLEAR = 0.30                                                # nothing hangs nearer the middle than this
RAIL_Z = 1.86
OPEN = 1.18                                                 # how far the game swings the doors when you get in (render.js: 0.62 x 1.9 rad)
PX = 2048
random.seed(57)

def lp_of(ox):
    """the leaf's design position (x from its hinge, y, z up): the same on both leaves, though the right one is built 5 m off and mirrored"""
    return lambda c: (Vector(c).x - ox, Vector(c).y, Vector(c).z)

def with_lp(a, lp):
    a = dict(a); a['lp'] = lp; return a

# ================================================================ leaves
LBEAD = [(0.0, 0.0), (0.0018, -0.0006), (0.0035, -0.0022), (0.0042, -0.0045), (0.0042, -LT / 2)]   # (a louvre opening's eased jamb)
LEAF = {        # stile, rails [(z0, z1)] bottom to top, what fills each opening between them, moulding, panel relief
    'wood': {'stile': 0.075, 'rails': [(0.0, 0.16), (1.0, 1.1), (2.08, LH)], 'fill': ['panel', 'louvre'], 'prof': OVOLO, 'field': []},
    'tile': {'stile': 0.085, 'rails': [(0.0, 0.2), (0.96, 1.08), (2.03, LH)], 'fill': ['panel', 'louvre'], 'prof': BOLECTION, 'field': RAISED},
    'attic': {'stile': 0.07, 'rails': [(0.0, 0.15), (1.0, 1.09), (2.1, LH)], 'fill': ['panel', 'louvre'], 'prof': SQUARE, 'field': []},
    'workshop': {'stile': 0.07, 'rails': [(0.0, 0.12), (1.04, 1.13), (2.1, LH)], 'fill': ['louvre', 'louvre'], 'prof': SQUARE, 'field': []},
}

def louvres(G, mat, rect, ox, pitch=0.03, w=0.032, t=0.0065, tilt=40.0):
    """slats across the opening rect (u0, u1, v0, v1), housed in the jambs, each tilted with its front edge down (you look out and down
       between them, not in); no end faces (in the housing)"""
    u0, u1, v0, v1 = rect; x0, x1 = ox + u0 - 0.002, ox + u1 + 0.002; n = int((v1 - v0 - 0.012) / pitch)
    z0 = v0 + (v1 - v0 - (n - 1) * pitch) / 2; a = math.radians(tilt); lp = lp_of(ox)
    for k in range(n):
        bm = block((x0, -w / 2, -t / 2), (x1, w / 2, t / 2), 0.0, 1)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.x) > 0.9], context='FACES')
        S.xform(bm, (0, 0, 0), (a, 0, 0)); S.xform(bm, (0, 0, z0 + k * pitch))
        G.add(bm, mat, with_lp(wood_attrs((1, 0, 0), (0, -1, 0)), lp), wrap=False)

def frame_leaf(G, spec, mat, ox):
    """a frame-and-panel door, x ox .. ox + LW from its hinge edge, z 0 .. LH, LT thick about y = 0: stiles and rails (each its own
       piece of wood, ja / jb the distances to the joints), panels in their mouldings on both faces, louvred openings; the eased
       edges. -> the louvred openings"""
    W, H, T = LW, LH, LT; st = spec['stile']; rails = spec['rails']; e = 0.0022
    rows = [(rails[i][1], rails[i + 1][0]) for i in range(len(rails) - 1)]
    panels = [(st, W - st, z0, z1) for (z0, z1), f in zip(rows, spec['fill']) if f == 'panel']
    holes = [(st, W - st, z0, z1) for (z0, z1), f in zip(rows, spec['fill']) if f == 'louvre']
    lp = lp_of(ox); rel = lambda c: (Vector(c).x - ox, Vector(c).z); mems = {}
    def cell_attrs(rect):
        a, b, c, d = rect; cu, cv = (a + b) / 2, (c + d) / 2
        if cu < st or cu > W - st: key, grain, ja, jb = ('stile', cu < st), (0, 0, 1), 9.0, 9.0
        else:
            key, grain = ('rail', round(cv, 3)), (1, 0, 0)
            ja, jb = (lambda c_: rel(c_)[0] - st), (lambda c_: (W - st) - rel(c_)[0])
        if key not in mems: mems[key] = member(grain, (0, -1, 0))
        gp, pr = mems[key]; return with_lp(attrs_of(gp, pr, ja, jb), lp)
    def attrs(kind, side, rect):
        if kind == 'cell': return cell_attrs(rect)
        key = (kind, side, rect)
        if key not in mems: mems[key] = member((1, 0, 0) if side and side in 'bt' else (0, 0, 1), (0, -1, 0) if kind != 'edge' else ((1, 0, 0) if side in 'lr' else (0, 0, 1)))
        gp, pr = mems[key]
        if kind == 'mould' and rect in panels:
            pu0, pu1, pv0, pv1 = rect; dE = spec['prof'][-1][0]
            def dist(c):
                x, z = rel(c); return min(x - pu0, pu1 - x, z - pv0, pv1 - z)
            return with_lp(attrs_of(gp, pr, zone=(lambda c: 2.0 if dist(c) > dE - 1e-5 else 1.0), pz=(lambda c: max(0.0, min(1.0, (dist(c) - dE) / 0.004)))), lp)
        return with_lp(attrs_of(gp, pr, zone=2.0 if kind == 'field' else 0.0), lp)
    for s in (-1, 1):
        F = Face((ox, s * T / 2, 0.0), (1, 0, 0), (0, 0, 1), (0, s, 0))
        panelled(G, F, (e, W - e, e, H - e), panels, spec['prof'], spec['field'], mat, attrs, holes=[(h, LBEAD) for h in holes])
    perimeter(G, ox, ox + W, 0.0, H, arris(T, e), mat, attrs)
    for h in holes: louvres(G, mat, h, ox)
    return holes

def turned_knob(G, mat, x, z, lp, r=0.017, proud=0.017, sides=12):
    """a small turned knob on the front face"""
    b = Vector((x, -LT / 2, z))
    G.add(lathe_bm([(0.0, r * 0.75), (0.15, r * 0.7), (0.35, r * 0.42), (0.55, r * 0.55), (0.75, r), (0.92, r * 0.85), (1.0, 0.0)], b, b + Vector((0, -proud, 0)), sides, (False, True)),
          mat, with_lp(metal_attrs(), lp), smooth=True, wrap=False)

def escutcheon(G, M, x, z, lp, key=True):
    """a brass keyhole escutcheon, and the key left in the lock (flat to the door, its bow hanging)"""
    G.add(plate(Dr.rounded(0.03, 0.06, 0.014, 3, x, z), -LT / 2, 0.0015), M['brass'], with_lp(metal_attrs(), lp), wrap=False)
    G.add(plate(Dr.keyhole(x, z + 0.008, 0.004), -LT / 2 - 0.0015, 0.0002, bevel=0.0), M['void'], with_lp(metal_attrs(), lp), wrap=False)
    if key:
        y = -LT / 2 - 0.004
        G.add(lathe_bm([(0.0, 0.0028), (1.0, 0.0028)], (x, y, z + 0.004), (x, y, z - 0.03), 6, (False, False)), M['brass'], with_lp(metal_attrs(), lp), smooth=True, wrap=False)
        tube(G, M['brass'], [Vector((x + 0.011 * math.sin(2 * math.pi * k / 10), y, z - 0.041 + 0.011 * math.cos(2 * math.pi * k / 10))) for k in range(11)], 0.0022, 6, with_lp(metal_attrs(), lp))

def hasp(G, M, x_edge, z, lp, staple=True):
    """a hasp and staple across the meeting edge, a padlock hanging from the staple"""
    G.add(plate([(x_edge - 0.11, z - 0.018), (x_edge - 0.005, z - 0.018), (x_edge - 0.005, z + 0.018), (x_edge - 0.11, z + 0.018)], -LT / 2, 0.003), M['iron'], with_lp(metal_attrs(), lp), wrap=False)
    Dr.nails(G, M['iron'], [(x_edge - 0.095, z - 0.008), (x_edge - 0.095, z + 0.008), (x_edge - 0.06, z)], -LT / 2 - 0.003, r=0.004, h=0.0015)
    if staple:
        y = -LT / 2 - 0.006
        tube(G, M['iron'], [Vector((x_edge - 0.03, -LT / 2, z - 0.008)), Vector((x_edge - 0.03, y, z - 0.008)), Vector((x_edge - 0.03, y, z + 0.008)), Vector((x_edge - 0.03, -LT / 2, z + 0.008))], 0.0025, 6, with_lp(metal_attrs(), lp))
        # the padlock: a laminated steel body hanging flat to the door, its shackle through the staple
        bx = x_edge - 0.03; bz = z - 0.05
        G.add(block((bx - 0.022, y - 0.006, bz - 0.022), (bx + 0.022, y + 0.006, bz + 0.016), 0.002, 1), M['lock'], with_lp(metal_attrs(), lp), wrap=False)
        tube(G, M['steel'], [Vector((bx - 0.013, y, bz + 0.016)), Vector((bx - 0.013, y, z - 0.006)), Vector((bx - 0.006, y, z + 0.004)), Vector((bx + 0.006, y, z + 0.004)),
                             Vector((bx + 0.013, y, z - 0.006)), Vector((bx + 0.013, y, bz + 0.016))], 0.0028, 6, with_lp(metal_attrs(), lp))

def stencil_number(m, u, v, cx, cz, h):
    """a stencilled '4' (u, v in metres; character h tall at (cx, cz)): strokes with the stencil's bridges, overspray at the edges"""
    def seg(a, b, w):
        ax, az = cx + a[0] * h, cz + a[1] * h; bx, bz = cx + b[0] * h, cz + b[1] * h; dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz
        t = m.math('DIVIDE', m.math('ADD', m.math('MULTIPLY', m.math('SUBTRACT', u, ax), dx), m.math('MULTIPLY', m.math('SUBTRACT', v, az), dz)), L2)
        t = m.math('MINIMUM', m.math('MAXIMUM', t, 0.0), 1.0)
        px = m.math('SUBTRACT', u, m.math('ADD', ax, m.math('MULTIPLY', t, dx))); pz = m.math('SUBTRACT', v, m.math('ADD', az, m.math('MULTIPLY', t, dz)))
        d = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', px, px), m.math('MULTIPLY', pz, pz)))
        return m.remap(d, w * h, w * h * 0.6, smooth=True)
    s = m.math('MAXIMUM', m.math('MAXIMUM', seg((-0.25, 0.5), (-0.3, -0.12), 0.07), seg((-0.3, -0.12), (0.3, -0.12), 0.07)), seg((0.14, 0.42), (0.14, -0.5), 0.075))
    bridge = m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', v, cz - 0.02 * h)), 0.035 * h, 0.05 * h)   # (the stencil's bridge across the upright)
    return m.math('MULTIPLY', s, m.math('MAXIMUM', bridge, m.remap(u, cx + 0.05 * h, cx + 0.06 * h)))

def duck_stencil(m, u, v):
    """the nursery stencil on each lower panel, in leaf design coordinates: a yellow duck in profile on a blue wave, three stars
       above it; dabbed on through a card stencil (soft overspray, the paint thinner in the middle), half worn away"""
    def ell(cx, cz, rx, rz, rot=0.0):
        du, dv = m.math('SUBTRACT', u, cx), m.math('SUBTRACT', v, cz); c, s_ = math.cos(rot), math.sin(rot)
        p = m.math('ADD', m.math('MULTIPLY', du, c), m.math('MULTIPLY', dv, s_)); q = m.math('SUBTRACT', m.math('MULTIPLY', dv, c), m.math('MULTIPLY', du, s_))
        r = m.math('ADD', m.math('MULTIPLY', m.math('DIVIDE', p, rx), m.math('DIVIDE', p, rx)), m.math('MULTIPLY', m.math('DIVIDE', q, rz), m.math('DIVIDE', q, rz)))
        return m.remap(r, 1.0, 0.82, smooth=True)
    cx, cz = 0.29, 0.56
    body = m.math('MAXIMUM', ell(cx - 0.01, cz, 0.085, 0.05, 0.08), ell(cx - 0.085, cz + 0.02, 0.03, 0.022, 0.6))      # (the body, its tail cocked)
    head = ell(cx + 0.06, cz + 0.07, 0.034, 0.032); neck = ell(cx + 0.045, cz + 0.035, 0.028, 0.04, -0.3)
    duck = m.math('MAXIMUM', m.math('MAXIMUM', body, head), neck)
    beak = ell(cx + 0.103, cz + 0.064, 0.028, 0.011, -0.15)
    wing = ell(cx - 0.02, cz + 0.008, 0.045, 0.022, 0.25); eye = ell(cx + 0.07, cz + 0.08, 0.0055, 0.0055)
    wave = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', v, m.math('ADD', cz - 0.075, m.math('MULTIPLY', m.math('SINE', m.math('MULTIPLY', u, 48.0)), 0.009)))), 0.012, 0.008, smooth=True),
                  m.math('MULTIPLY', m.remap(u, cx - 0.16, cx - 0.14), m.remap(u, cx + 0.16, cx + 0.14)))
    stars = None
    for sx_, sz_, r_ in ((cx - 0.1, cz + 0.2, 0.018), (cx + 0.02, cz + 0.25, 0.013), (cx + 0.12, cz + 0.19, 0.016)):
        du, dv = m.math('SUBTRACT', u, sx_), m.math('SUBTRACT', v, sz_); rr = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', du, du), m.math('MULTIPLY', dv, dv)))
        th = m.math('ARCTAN2', dv, du); lim = m.math('MULTIPLY', r_, m.math('ADD', 0.55, m.math('MULTIPLY', m.math('ABSOLUTE', m.math('COSINE', m.math('MULTIPLY', th, 2.5))), 0.45)))
        st_ = m.remap(m.math('DIVIDE', rr, lim), 1.0, 0.85, smooth=True); stars = st_ if stars is None else m.math('MAXIMUM', stars, st_)
    return duck, beak, wing, eye, wave, stars

def wood_top(m):
    """the duck-egg top coat with the stencil on it (yellow duck, orange beak, blue wave, cream stars), half worn"""
    u, _, v = sep(m, m.attr('lp', True)); op = m.attr('opos', True)
    duck, beak, wing, eye, wave, stars = duck_stencil(m, u, v)
    thin = m.remap(m.noise(op, 30, 4, 0.6), 0.25, 0.75, 0.35, 0.95); worn = m.math('MULTIPLY', thin, m.remap(m.noise(op, 7, 3), 0.25, 0.6, 0.5, 1.0))
    col = m.mix(0.0, lin('#a9bcb0'), lin('#a9bcb0'))
    col = m.mix(m.math('MULTIPLY', wave, worn), col, lin('#6f8fa8'))
    col = m.mix(m.math('MULTIPLY', duck, worn), col, lin('#dcb54e')); col = m.mix(m.math('MULTIPLY', wing, m.math('MULTIPLY', worn, 0.6)), col, lin('#b8892e'))
    col = m.mix(m.math('MULTIPLY', beak, worn), col, lin('#c8682c')); col = m.mix(m.math('MULTIPLY', eye, worn), col, lin('#2b2622'))
    return m.mix(m.math('MULTIPLY', stars, worn), col, lin('#ece2c6'))

def workshop_top(m):
    """the cupboard's green with a white stencilled 4 on the outside of its right side (read from the right: u along +y)"""
    op = m.attr('opos', True); x, y, z = sep(m, op)
    n = m.math('MULTIPLY', stencil_number(m, y, z, 0.0, 1.62, 0.22), m.remap(x, BW / 2 - 0.004, BW / 2 - 0.001))
    worn = m.remap(m.noise(op, 25, 4, 0.6), 0.3, 0.7, 0.4, 1.0)
    return m.mix(m.math('MULTIPLY', n, worn), lin('#4f5d4c'), lin('#e2dccb'))

def build_leaf(style, M, ox):
    """the left door in its design position (hinge at x = ox): -> its Geo"""
    G = S.Geo(1, 1, False, False); lp = lp_of(ox)
    if style == 'concrete': return locker_leaf(G, M, ox)
    frame_leaf(G, LEAF[style], M['leaf'], ox)
    kx = ox + LW - 0.04
    if style == 'wood':
        turned_knob(G, M['knob'], kx, 1.05, lp)
        if ox: escutcheon(G, M, kx, 0.93, lp, key=False)
    elif style == 'tile':
        if ox: escutcheon(G, M, kx, 1.02, lp, key=True)
        else: turned_knob(G, M['brass'], kx, 1.02, lp, 0.014, 0.012, 16)
    elif style == 'attic':
        turned_knob(G, M['leaf'], kx, 1.045, lp, 0.016, 0.016)
    else:
        hasp(G, M, ox + LW, 1.3, lp, staple=not ox)
        G.add(lathe_bm([(0.0, 0.004), (1.0, 0.004)], (kx - 0.01, -LT / 2, 1.1), (kx - 0.01, -LT / 2, 0.98), 6), M['iron'], with_lp(metal_attrs(), lp), smooth=True, wrap=False)
        tube(G, M['iron'], [Vector((kx - 0.01, -LT / 2 - 0.012 * math.sin(math.pi * k / 8), 0.98 + 0.12 * k / 8)) for k in range(9)], 0.0055, 6, with_lp(metal_attrs(), lp))
    knuckles(G, M['brass'] if style in ('tile', 'wood') else M['iron'], ox + 0.0, 0.0, (0.25, 1.1, 1.95), 0.0055, 0.07)
    return G

# ---------------------------------------------------------------- the locker door
VENTS = [(0.14, 6), (1.44, 6), (1.88, 6)]                   # (vent groups: bottom z, louvres)
VPITCH, VH, VW = 0.032, 0.012, 0.3

def vent_rects():
    out = []
    for z0, n in VENTS:
        for k in range(n): out.append((LW / 2 - VW / 2, LW / 2 + VW / 2, z0 + k * VPITCH, z0 + k * VPITCH + VH))
    return out

def locker_leaf(G, M, ox):
    """a pressed steel locker door: the face (dented, oil-canned) with its edges folded back to a return, a hat-section stiffener
       behind, stamped louvres (each a hood pressed out over a slit cut through: the slits are the paint's cut-out, so you see out),
       a lift handle in a pressed cup, a card holder, the padlock hasp"""
    lp = lp_of(ox); W, H = LW, LH; yf = -LT / 2; t = 0.0012; R = 0.004
    dents = [(random.uniform(0.1, 0.47), random.uniform(0.25, 0.8), random.uniform(0.04, 0.09), random.uniform(0.002, 0.005)) for _ in range(3)] + \
            [(random.uniform(0.1, 0.47), random.uniform(1.2, 2.0), random.uniform(0.05, 0.12), random.uniform(0.001, 0.0025)) for _ in range(2)]
    def dent(x, z):
        d = 0.0006 * math.sin(math.pi * x / W) * math.sin(math.pi * z / H * 3)                      # (oil-canned between its stiffeners)
        for cx, cz, r, dep in dents:
            q = ((x - cx) ** 2 + (z - cz) ** 2) / (r * r)
            if q < 1: d += dep * (1 - q) ** 2
        return d
    xs = [R + (W - 2 * R) * i / 6 for i in range(7)]; zs = [R + (H - 2 * R) * j / 24 for j in range(25)]
    for s, yy in ((-1, yf), (1, yf + t)):                       # (the face, front and back)
        rows = [[Vector((ox + x, yy + (dent(x, z) if s < 0 else dent(x, z)), z)) for x in xs] for z in zs]
        G.add(Dr.strip(rows, [Vector((0, s, 0))] * (len(rows) - 1)), M['leaf'], with_lp(metal_attrs(), lp), smooth=True, wrap=False)
    # the folded edges: round the face's rim (radius R) back to a 15 mm return, its lip turned in
    prof = [(R * (1 - math.sin(math.pi / 2 * i / 3)), yf + R * (1 - math.cos(math.pi / 2 * i / 3))) for i in range(4)] + [(0.0, yf + 0.016), (0.012, yf + 0.016)]
    perimeter(G, ox, ox + W, 0.0, H, prof, M['leaf'], lambda kind, side, rect: with_lp(metal_attrs(), lp))
    # the stiffener behind, the hinge-side pin knuckles
    for z0, z1 in ((0.06, 0.12), (1.06, 1.12), (2.08, 2.14)):
        G.add(block((ox + 0.014, yf + t, z0), (ox + W - 0.014, yf + 0.014, z1), 0.0, 1), M['leaf'], with_lp(metal_attrs(), lp), wrap=False)
    # the louvres: hoods pressed out of the face, open at the bottom
    for x0, x1, z0, z1 in vent_rects():
        pr_ = [(z1, 0.0), (z1 - 0.003, -0.0035), (z0 + 0.006, -0.0052), (z0 + 0.0015, -0.0046), (z0, 0.0)]
        rows = [[Vector((ox + x0, yf + y_ * (0.25 if i in (0, 4) else 1.0), z_)), Vector((ox + x1, yf + y_ * (0.25 if i in (0, 4) else 1.0), z_))] for i, (z_, y_) in enumerate(pr_)]
        for r_ in rows: r_.insert(1, (r_[0] + r_[1]) / 2)
        bm = Dr.strip([[Vector((p.x, p.y if j == 1 or k in (0, 4) else p.y, p.z)) for j, p in enumerate(r_)] for k, r_ in enumerate(rows)], [Vector((0, -0.3, 1)), Vector((0, -1, 0.3)), Vector((0, -1, 0)), Vector((0, -0.4, -1))])
        for v in bm.verts:                                                   # (the hood's ends pinched back into the face)
            f = min(1.0, min(v.co.x - (ox + x0), (ox + x1) - v.co.x) / 0.02); v.co.y = yf + (v.co.y - yf) * f
        G.add(bm, M['hood'], with_lp(metal_attrs(), lp), smooth=True, wrap=False)
    # the handle: a pressed cup with a lift lever, the card holder, the padlock hasp
    hx = ox + W - 0.06
    G.add(plate(Dr.rounded(0.05, 0.13, 0.008, 3, hx, 1.06), yf, 0.004, bevel=0.0008), M['steel'], with_lp(metal_attrs(), lp), wrap=False)
    G.add(plate(Dr.rounded(0.026, 0.09, 0.006, 3, hx, 1.07), yf - 0.004, 0.006, bevel=0.0008), M['steel'], with_lp(metal_attrs(), lp), wrap=False)
    G.add(plate([(ox + 0.2, 1.735), (ox + 0.375, 1.735), (ox + 0.375, 1.805), (ox + 0.2, 1.805)], yf, 0.0012), M['steel'], with_lp(metal_attrs(), lp), wrap=False)
    G.add(plate([(ox + 0.21, 1.742), (ox + 0.365, 1.742), (ox + 0.365, 1.796), (ox + 0.21, 1.796)], yf - 0.0012, 0.0004, bevel=0.0), M['card'],
          with_lp(attrs_of(lambda c: tuple(c), random.random(), lp=(lambda c, ox=ox: ((Vector(c).x - ox - 0.21) / 0.155, (Vector(c).z - 1.742) / 0.054, 1.0))), lp), wrap=False)
    hasp(G, M, ox + W, 1.25, lp, staple=not ox)
    for zc in (0.25, 1.95):                                              # (lift-off pin hinges)
        G.add(lathe_bm([(0.0, 0.0045), (0.1, 0.006), (0.9, 0.006), (1.0, 0.0045)], (ox, 0.0, zc - 0.035), (ox, 0.0, zc + 0.035), 6), M['steel'], with_lp(metal_attrs(), lp), smooth=True, wrap=False)
    return G

def vent_cutout(mat):
    """the slits under the locker door's louvre hoods, cut out of its face: the paint material's ALPHA (the door's design position)"""
    m = kitlib.Mat.__new__(kitlib.Mat); m.m = mat; m.nt = mat.node_tree; m.b = m.nt.nodes['Principled BSDF']; m.out_node = m.nt.nodes['Material Output']
    x, _, z = sep(m, m.attr('lp', True)); cut = None
    for x0, x1, z0, z1 in vent_rects():
        r = Dr.box_mask(m, x, z, (x0 + 0.012, x1 - 0.012, z0 + 0.0025, z1 - 0.0025, 0.0004))
        cut = r if cut is None else m.math('MAXIMUM', cut, r)
    a = m.n('ShaderNodeMath', operation='SUBTRACT', use_clamp=True); a.name = 'ALPHA'; a.inputs[0].default_value = 1.0; m.l(cut, a.inputs[1])

# ================================================================ the carcass
def box_part(G, mat, lo, hi, grain=(0, 0, 1), depth=(0, -1, 0), bevel=0.0):
    G.add(block(lo, hi, bevel, 1), mat, wood_attrs(grain, depth), wrap=False)

def sweep3(G, mat, prof, attrs, x_half, y_front, y_back, caps=True, top=True):
    """a moulding run round three sides (left side from the back, the front, the right side back): prof [(d out from the carcass's
       faces, z)] bottom to top; mitred at the front corners; its ends at the back closed; its top a lid if top"""
    prof = Dr.clean(prof); rows = []
    for d, z in prof:
        X = x_half + d; Y = y_front - d
        rows.append([Vector((-X, y_back, z)), Vector((-X, Y, z)), Vector((X, Y, z)), Vector((X, y_back, z))])
    hints = []
    for k in range(len(prof) - 1):
        (d0, z0), (d1, z1) = prof[k], prof[k + 1]; hints.append(None)
    bm = bmesh.new(); V = [[bm.verts.new(p) for p in r] for r in rows]
    for k in range(len(rows) - 1):
        for j in range(3):
            vs = [V[k][j], V[k][j + 1], V[k + 1][j + 1], V[k + 1][j]]
            if (vs[2].co - vs[0].co).cross(vs[3].co - vs[1].co).length < 1e-10: continue
            f = bm.faces.new(vs); f.normal_update()
            mid = sum((v.co for v in vs), Vector()) / 4
            out = Vector((math.copysign(1, mid.x), 0, 0)) if j != 1 else Vector((0, -1, 0))
            dz = prof[k + 1][1] - prof[k][1]; dd = prof[k + 1][0] - prof[k][0]
            want = out * dz + Vector((0, 0, -1)) * dd                # (the air side of the profile segment)
            if f.normal.dot(want) < 0: f.normal_flip()
    if caps:
        for j, sx in ((0, -1), (3, 1)):
            pts = [V[k][j] for k in range(len(rows))]
            inner = [bm.verts.new((sx * x_half, y_back, prof[-1][1])), bm.verts.new((sx * x_half, y_back, prof[0][1]))]
            try:
                f = bm.faces.new(pts + inner); f.normal_update()
                if f.normal.y < 0: f.normal_flip()
            except ValueError: pass
    if top:
        X = x_half + prof[-1][0]; Y = y_front - prof[-1][0]; z = prof[-1][1]
        f = bm.faces.new([V[-1][0], V[-1][1], V[-1][2], V[-1][3]]); f.normal_update()
        if f.normal.z < 0: f.normal_flip()
    G.add(bm, mat, attrs, smooth=False, wrap=False)

CROWN = {       # cornice profiles [(d, z)] from its foot up, base profiles
    'wood': [(0.0, 2.228), (0.004, 2.229), (0.006, 2.233), (0.006, 2.25), (0.009, 2.252), (0.009, 2.268), (0.014, 2.272), (0.022, 2.285), (0.03, 2.3),
             (0.036, 2.315), (0.04, 2.322), (0.042, 2.326), (0.042, 2.336), (0.04, 2.34), (0.0, 2.34)],
    'tile': [(0.0, 2.228), (0.005, 2.23), (0.008, 2.235), (0.008, 2.255), (0.012, 2.257), (0.012, 2.27), (0.03, 2.272), (0.03, 2.284), (0.034, 2.288),
             (0.036, 2.296), (0.04, 2.31), (0.045, 2.326), (0.046, 2.332), (0.046, 2.346), (0.044, 2.35), (0.0, 2.35)],
    'attic': [(0.0, 2.228), (0.012, 2.23), (0.012, 2.26), (0.02, 2.262), (0.03, 2.28), (0.034, 2.29), (0.034, 2.31), (0.0, 2.31)],
    'workshop': [(0.0, 2.24), (0.015, 2.242), (0.015, 2.275), (0.0, 2.275)],
}
BASE = {'wood': [(0.032, 0.0), (0.032, 0.012), (0.026, 0.017), (0.02, 0.02), (0.0, 0.022)],
        'tile': [(0.04, 0.0), (0.04, 0.008), (0.036, 0.013), (0.03, 0.019), (0.02, 0.022), (0.0, 0.023)],
        'attic': [(0.028, 0.0), (0.028, 0.02), (0.0, 0.021)], 'workshop': [(0.02, 0.0), (0.02, 0.02), (0.0, 0.021)]}

def carcass(G, M, style):
    """sides, roof, floor, the boarded back, the front rails, cornice and base, the rail and shelf inside"""
    case = M['case']; inner = M['inner']; t = 0.019; X = BW / 2
    for sx in (-1, 1):                                           # (the sides: one wide board each, grain upright)
        x0, x1 = (sx * X - t, sx * X) if sx > 0 else (sx * X, sx * X + t)
        box_part(G, case, (x0, YF, 0.0), (x1, YB, BH - 0.004), (0, 0, 1), (sx, 0, 0), 0.0015)
    box_part(G, case, (-X, YF, BH - 0.022), (X, YB, BH), (1, 0, 0), (0, 0, 1))          # (the roof)
    box_part(G, inner, (-X + t, YF + 0.01, 0.065), (X - t, YB - 0.012, 0.083), (1, 0, 0), (0, 0, 1))   # (its floor)
    box_part(G, case, (-X + t, YF, 0.022), (X - t, YF + 0.022, 0.083), (1, 0, 0), (0, -1, 0))        # (the front rails)
    box_part(G, case, (-X + t, YF, BH - 0.075), (X - t, YF + 0.022, BH - 0.022), (1, 0, 0), (0, -1, 0))
    n = 9; bw = (BW - 2 * t) / n                                   # (the back: tongued boards, upright)
    for i in range(n):
        x0 = -X + t + i * bw
        box_part(G, inner, (x0 + 0.0008, YB - 0.012, 0.083), (x0 + bw - 0.0008, YB, BH - 0.022), (0, 0, 1), (0, 1, 0), 0.0012)
    if style != 'concrete':
        sweep3(G, case, CROWN[style], wood_attrs((1, 0, 0), (0, -1, 0)), X, YF, YB)
        sweep3(G, case, BASE[style], wood_attrs((1, 0, 0), (0, -1, 0)), X, YF, YB, top=False)
    # inside: the hat shelf and the rail under it, on cleats
    box_part(G, inner, (-X + t, -0.02, RAIL_Z + 0.09), (X - t, YB - 0.012, RAIL_Z + 0.108), (1, 0, 0), (0, 0, 1))
    for sx in (-1, 1):
        box_part(G, inner, (sx * (X - t) - (0.016 if sx > 0 else 0), -0.06, RAIL_Z - 0.03), (sx * (X - t) + (0.016 if sx < 0 else 0), YB - 0.03, RAIL_Z + 0.09), (0, 1, 0), (sx, 0, 0))
    G.add(lathe_bm([(0.0, 0.012), (1.0, 0.012)], (-X + t + 0.016, 0.0, RAIL_Z), (X - t - 0.016, 0.0, RAIL_Z), 10), M['rail'], metal_attrs(), smooth=True, wrap=False)

def locker_carcass(G, M):
    """a double steel locker: folded sheet sides, roof and floor, a sloped top, louvred sides; a shelf and coat hooks inside"""
    case = M['case']; t = 0.0012; X = BW / 2
    for sx in (-1, 1):
        x = sx * X
        for xi in (x, x - sx * t):
            bm = quad_bm([(xi, YF, 0.06), (xi, YB, 0.06), (xi, YB, BH), (xi, YF, BH)], (sx if xi == x else -sx, 0, 0)); G.add(bm, case, metal_attrs(), wrap=False)
        G.add(block((x - sx * 0.025 if sx > 0 else x, YF, 0.06), (x if sx > 0 else x + 0.025, YF + 0.0012, BH), 0.0, 1), case, metal_attrs(), wrap=False)   # (the front flange)
    for z, up in ((BH, 1), (BH - t, -1), (0.083, 1), (0.083 - t, -1)):
        G.add(quad_bm([(-X, YF, z), (X, YF, z), (X, YB, z), (-X, YB, z)], (0, 0, up)), case, metal_attrs(), wrap=False)
    for yb, s in ((YB, 1), (YB - t, -1)):
        G.add(quad_bm([(-X, yb, 0.06), (X, yb, 0.06), (X, yb, BH), (-X, yb, BH)], (0, s, 0)), case, metal_attrs(), wrap=False)
    G.add(block((-X + 0.002, YF, BH - 0.07), (X - 0.002, YF + 0.02, BH - t), 0.0, 1), case, metal_attrs(), wrap=False)
    G.add(block((-X + 0.002, YF, 0.06), (X - 0.002, YF + 0.02, 0.085), 0.0, 1), case, metal_attrs(), wrap=False)
    # the base: a recessed plinth on its feet
    G.add(block((-X + 0.03, YF + 0.03, 0.0), (X - 0.03, YB - 0.01, 0.06), 0.0, 1), M['plinth'], metal_attrs(), wrap=False)
    # the sloped top (dust can't settle on a locker's top: it does on this one)
    bm = bmesh.new(); pts = [(-X - 0.005, YF - 0.008, BH), (X + 0.005, YF - 0.008, BH), (X + 0.005, YB, BH + 0.085), (-X - 0.005, YB, BH + 0.085)]
    f = bm.faces.new([bm.verts.new(p) for p in pts]); f.normal_update()
    if f.normal.z < 0: f.normal_flip()
    G.add(bm, case, metal_attrs(), wrap=False)
    for sx in (-1, 1):
        bm = bmesh.new(); f = bm.faces.new([bm.verts.new(p) for p in ((sx * (X + 0.005), YF - 0.008, BH), (sx * (X + 0.005), YB, BH), (sx * (X + 0.005), YB, BH + 0.085))]); f.normal_update()
        if f.normal.x * sx < 0: f.normal_flip()
        G.add(bm, case, metal_attrs(), wrap=False)
    # inside: a shelf, coat hooks on the sides and the back
    G.add(block((-X + 0.002, -0.05, RAIL_Z + 0.1), (X - 0.002, YB - 0.002, RAIL_Z + 0.115), 0.0, 1), case, metal_attrs(), wrap=False)
    for sx in (-1, 1):
        for yh in (-0.2, 0.0, 0.2):
            b = Vector((sx * (X - 0.002), yh, RAIL_Z + 0.02))
            tube(G, M['hook'], [b, b + Vector((-sx * 0.03, 0, -0.01)), b + Vector((-sx * 0.05, 0, -0.04)), b + Vector((-sx * 0.045, 0, -0.06)), b + Vector((-sx * 0.03, 0, -0.055))], 0.0035, 6)

# ================================================================ coats on hangers
def garment(G, mat, hang_mat, xc, yc, z_top, L, half_w, kind='coat', seed=0, hook=True, sleeves=True):
    """a garment on a hanger from the rail: a hook over the rail, the hanger's arms, the cloth hanging from its shoulders in folds
       that deepen toward the hem (a cross-section round its middle, folds as ripples of it), sleeves down its sides. Its width
       runs along y (the hanger is across the rail), its thickness along x."""
    rnd = random.Random(seed); zs = z_top - 0.075                     # (the shoulders)
    if hook:
        tube(G, hang_mat, [Vector((xc, yc, zs + 0.012)), Vector((xc, yc, z_top + 0.005)), Vector((xc, yc + 0.012, z_top + 0.022)), Vector((xc, yc + 0.026, z_top + 0.012)),
                           Vector((xc, yc + 0.024, z_top - 0.004))], 0.0022, 6)
    arm = [Vector((xc, yc + s_ * half_w * k / 4, zs + 0.01 - 0.028 * (k / 4) ** 1.5)) for s_ in (-1, 1) for k in (4, 3, 2, 1)][:4][::-1] + \
          [Vector((xc, yc, zs + 0.012))] + [Vector((xc, yc + half_w * k / 4, zs + 0.01 - 0.028 * (k / 4) ** 1.5)) for k in (1, 2, 3, 4)]
    tube(G, M_HANGER[0], arm, 0.007, 6, wood_attrs((0, 1, 0), (1, 0, 0)))
    na, nz = 18, 13
    if kind == 'dress': flare, th0, th1 = 1.45, 0.045, 0.1
    elif kind == 'apron': flare, th0, th1 = 1.08, 0.016, 0.032
    elif kind == 'child': flare, th0, th1 = 1.18, 0.05, 0.075
    else: flare, th0, th1 = 1.12, 0.065, 0.11
    ph = [rnd.uniform(0, 6.28) for _ in range(6)]
    def pt(i, j):
        t = j / nz; phi = 2 * math.pi * i / na
        a = half_w * (0.98 + (flare - 1.0) * t ** 1.4) if t > 0.06 else half_w * (0.55 + 0.43 * t / 0.06)
        b = th0 + (th1 - th0) * t ** 0.8 + (th0 * 0.35 * math.sin(math.pi * min(1.0, t / 0.45)) if kind != 'apron' else 0.0)   # (the chest fills it out)
        f = 1.0 + (0.03 + 0.1 * t) * math.sin(5 * phi + ph[0] + 2 * t) + (0.02 + 0.06 * t) * math.sin(9 * phi + ph[1] - 3 * t) + 0.04 * t * math.sin(3 * phi + ph[2])
        y = a * math.cos(phi); x = b * math.sin(phi) * f * (1 + 0.6 * t * abs(math.sin(7 * phi + ph[3])))
        z = zs - t * L - 0.065 * (abs(math.cos(phi)) ** 1.6) * (1 - t) ** 3 + (0.02 * t * math.sin(4 * phi + ph[4]) if j == nz else 0.0)   # (the shoulders slope off the hanger)
        sway = 0.012 * t * t * math.sin(ph[5])
        return Vector((xc + x + sway, yc + y * (1 + 0.02 * math.sin(3 * t + ph[2])), z))
    bm = bmesh.new(); V = [[bm.verts.new(pt(i, j)) for i in range(na)] for j in range(nz + 1)]
    for j in range(nz):
        for i in range(na):
            f = bm.faces.new((V[j][i], V[j][(i + 1) % na], V[j + 1][(i + 1) % na], V[j + 1][i])); f.normal_update()
            c = sum((v.co for v in f.verts), Vector()) / 4
            if f.normal.dot(Vector((c.x - xc, c.y - yc, 0))) < 0: f.normal_flip()
    top = bm.faces.new(V[0]); top.normal_update()
    if top.normal.z < 0: top.normal_flip()
    keep_in(bm)
    gp = lambda c, o=Vector((rnd.uniform(-9, 9), rnd.uniform(-9, 9), 0)): (Vector(c).y - yc + o.x, Vector(c).z + o.y, Vector(c).x - xc)
    G.add(bm, mat, attrs_of(gp, rnd.random()), smooth=True, wrap=False)
    if sleeves and kind != 'apron':                                       # (sleeves down its sides, a little forward and in)
        for s_ in (-1, 1):
            sl = []
            for k in range(6):
                t = k / 5; sl.append(Vector((xc + 0.012 * math.sin(3 * t + ph[s_ + 1]) + s_ * 0.025, yc + s_ * (half_w * 1.02 - 0.02 * t), zs - 0.035 - t * min(0.55, L * 0.72))))
            rs = 0.026 if kind == 'child' else 0.036
            for k in range(5):
                r0, r1 = rs * (1 - 0.1 * k / 5), rs * (1 - 0.1 * (k + 1) / 5) * (1.12 if k == 4 else 1.0)    # (a cuff)
                bm = lathe_bm([(0.0, r0), (1.0, r1)], sl[k], sl[k + 1], 8, (False, k == 4)); keep_in(bm)
                G.add(bm, mat, attrs_of(gp, rnd.random()), smooth=True, wrap=False)

M_HANGER = [None]

def keep_in(bm, lim=BW / 2 - 0.022):
    """cloth pressed against the side, never through it, nor into the middle; behind the doors, in front of the back"""
    for v in bm.verts:
        s_ = 1 if v.co.x > 0 else -1; v.co.x = s_ * min(lim, max(CLEAR + 0.004, abs(v.co.x)))
        v.co.y = max(YF + 0.02, min(YB - 0.025, v.co.y))
COATS = {       # (x centre, kind, length, half width, material key); all beyond |x| 0.30
    'wood': [(-0.48, 'child', 0.72, 0.16, 'coatA'), (-0.375, 'dress', 0.64, 0.15, 'coatB'),
             (0.38, 'child', 0.66, 0.15, 'coatC'), (0.485, 'dress', 0.7, 0.155, 'coatB')],
    'tile': [(-0.48, 'coat', 1.05, 0.21, 'coatA'), (-0.385, 'dress', 1.25, 0.2, 'coatB'), (0.4, 'coat', 1.0, 0.2, 'coatA'), (0.49, 'dress', 1.2, 0.2, 'coatB')],
    'concrete': [(-0.46, 'coat', 1.0, 0.2, 'coatA'), (0.45, 'coat', 1.1, 0.2, 'coatB')],
    'attic': [(-0.48, 'dress', 1.15, 0.19, 'coatA'), (-0.385, 'coat', 1.0, 0.19, 'coatB'), (0.43, 'dress', 1.0, 0.18, 'coatB')],
    'workshop': [(-0.47, 'apron', 0.95, 0.2, 'coatA'), (-0.4, 'apron', 0.9, 0.19, 'coatA'), (0.44, 'coat', 1.1, 0.2, 'coatB')],
}

def build_body(style, M):
    G = S.Geo(1, 1, False, False); M_HANGER[0] = M['hanger']
    if style == 'concrete': locker_carcass(G, M)
    else: carcass(G, M, style)
    for k, (xc, kind, L, hw, mk) in enumerate(COATS[style]):
        hook = style != 'concrete'
        z_top = RAIL_Z + 0.012 if hook else RAIL_Z - 0.02
        garment(G, M[mk], M['hook'], xc, 0.0, z_top, L, hw, kind, seed=k * 7 + len(style), hook=hook)
    return G

# ================================================================ the dust sheet (attic)
def dust_sheet(rnd):
    """a dust sheet thrown over the wardrobe and pulled half off to the left: lying in rucks over the left of the roof (its free edge
       rolled loose across the middle), over the cornice's edge, and hanging down the left side in folds that fan out from the front
       corner, its hem longer toward the back; inside the body's envelope (the side has 7 cm between the carcass and the envelope),
       clear of the left door. -> bmesh, and each vertex's position on the flat sheet (m)"""
    xr = 0.24 + 0.06 * rnd.random(); top = CROWN['attic'][-1][1] + 0.002; X = -(BW / 2 + max(d for d, z in CROWN['attic']) + 0.001)   # (its free edge; the cornice's top and left face)
    nu, nv = 54, 26; y0, y1 = -0.326, 0.352; r = 0.016
    Lr = xr - X; Le = math.pi / 2 * r; ph = [rnd.uniform(0, 6.28) for _ in range(8)]
    def hang_len(v):                                                    # (the hem: higher at the front corner, uneven)
        return 0.95 + 0.72 * v ** 0.8 + 0.06 * math.sin(9 * v + ph[0]) + 0.03 * math.sin(23 * v + ph[1])
    Lmax = Lr + Le + hang_len(1.0) + 0.05
    def P(u, v):
        y = y0 + (y1 - y0) * v
        if u <= Lr:                                                    # (on the roof: rucked, its free edge rolled up a little)
            s_ = u / Lr; x = xr - u
            ruck = 0.012 * max(0.0, math.sin(11 * s_ + 4 * v + ph[2])) ** 2 + 0.006 * math.sin(17 * v + 5 * s_ + ph[3]) ** 2
            roll = 0.018 * math.exp(-u / 0.03)
            return Vector((x + 0.01 * math.sin(6 * v + ph[4]) * math.exp(-u / 0.05), y, top + 0.003 + ruck + roll))
        if u <= Lr + Le:                                               # (over the cornice's edge)
            a = (u - Lr) / Le * math.pi / 2
            return Vector((X - r * math.sin(a) + r * 0.0, y, top - r * (1 - math.cos(a))))
        h = u - Lr - Le; L = hang_len(v); h = min(h, L)                 # (down the side; past the hem: nothing, clamped)
        A = 0.004 + 0.03 * min(1.0, h / 0.55)                          # (folds deepen downward, fan from the front corner)
        f = (math.sin(2 * math.pi * v / 0.21 + ph[5] + h * (6.0 - 5.0 * v)) * 0.6 + math.sin(2 * math.pi * v / 0.13 + ph[6] - h * 3.0) * 0.3
             + math.sin(2 * math.pi * v / 0.37 + ph[7] + h * 2.0) * 0.4)
        x = X - r - 0.012 + A * f
        x = max(-0.643, min(-0.583, x))
        sag = 0.035 * (h / max(L, 1e-3)) ** 2 * math.sin(math.pi * v)   # (the hem swings in at the middle)
        return Vector((x, y, top - r - h + sag * 0.3))
    bm = bmesh.new(); V = []; flat = {}
    for j in range(nv + 1):
        v = j / nv; row = []
        Lv = Lr + Le + hang_len(v)
        for i in range(nu + 1):
            u = Lv * i / nu; p = P(u, v)
            if p.z < 2.25: p.y = max(p.y, -0.296)                       # (clear of the left door)
            p.y = min(p.y, 0.345); p.z = min(p.z, 2.362)
            q = bm.verts.new(p); row.append(q); flat[q] = (u, (y1 - y0) * v)
        V.append(row)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i])); f.normal_update()
            c = f.calc_center_median()
            out = Vector((0, 0, 1)) if c.z > top - 0.002 else Vector((-1, 0, 0))
            if f.normal.dot(out) < 0: f.normal_flip()
    return bm, flat

# ================================================================ materials
def materials(style, part):
    k = f'ward_{style}_{part}'
    M = {'void': kitlib.grey(k + '_void', (0.008, 0.006, 0.005)), 'brass': kitlib.metal(k + '_brass', 'brass', color='#9a7a45', rust=0.0, age=1.3),
         'iron': kitlib.metal(k + '_iron', 'iron', rust=0.7, age=1.4), 'steel': kitlib.metal(k + '_steel', 'steel', rust=0.3, age=1.3)}
    M['lock'] = kitlib.metal(k + '_lock', 'steel', color='#6d6a64', rust=0.55, age=1.4); M['rail'] = M['brass'] if style in ('wood', 'tile') else M['steel']
    M['hook'] = kitlib.metal(k + '_hook', 'steel', color='#8a8c8e', rust=0.35, age=1.3); M['hanger'] = kitlib.wood(k + '_hanger', 'beech', 'varnish', age=1.4)
    LH_ = [(LW - 0.15, LW + 0.01, 0.9, 1.25, 0.04), (LW - 0.06, LW + 0.01, 0.6, 1.8, 0.03, 0.5)]   # (where hands go: by the meeting edge)
    E = ('box', 0.0, LW, 0.0, LH)
    if style == 'wood':
        lf = Dr.paint(k + '_paint', ['#a9bcb0', '#e0d6bc', '#8a5a3c'], 'pine', LH_ if part == 'leaf' else [], kick=0.4, chips=1.25, gloss=0.32, age=1.6,
                      edges=E if part == 'leaf' else None, top_fn=wood_top if part == 'leaf' else None, space='lp' if part == 'leaf' else None)
        M['leaf'] = M['case'] = lf; M['knob'] = kitlib.porcelain(k + '_knob', '#ece4d4', crackle=0.5, age=1.2)
        M['inner'] = Dr.bare_boards(k + '_inner', 'deal', [], age=1.5, tone=0.7)
        M['coatA'] = kitlib.fabric(k + '_coatA', '#7a2e2a', weave=0.6, fade=0.5, age=1.3); M['coatB'] = kitlib.fabric(k + '_coatB', '#c9a9a0', weave=0.9, fade=0.4, stripes=('#ece4d4', 0.011), age=1.3)
        M['coatC'] = kitlib.fabric(k + '_coatC', '#43566b', weave=0.7, fade=0.5, age=1.4)
    elif style == 'tile':
        M['leaf'] = M['case'] = Dr.mahogany(k + '_mahogany', LH_ if part == 'leaf' else [], space='lp' if part == 'leaf' else None)
        M['inner'] = kitlib.wood(k + '_inner', 'mahogany', 'bare', age=1.2)
        M['coatA'] = kitlib.fabric(k + '_coatA', '#25211f', weave=0.6, fade=0.35, age=1.3); M['coatB'] = kitlib.fabric(k + '_coatB', '#9a6f70', weave=0.0, fade=0.5, velvet=True, age=1.3)
    elif style == 'concrete':
        mk = lambda nm: Dr.paint(nm, ['#5b685d', '#7a3b28', '#7a3b28'], 'steel', LH_ if part == 'leaf' else [], kick=0.4, chips=0.55, gloss=0.38, age=1.3, craze=0.15, joints=False,
                                 rust=0.45, edges=E if part == 'leaf' else None, space='lp' if part == 'leaf' else None)
        lf = mk(k + '_paint'); M['leaf'] = M['case'] = lf; M['hood'] = mk(k + '_hood') if part == 'leaf' else lf
        if part == 'leaf': vent_cutout(lf)
        M['plinth'] = Dr.paint(k + '_plinth', ['#2c2f2c', '#7a3b28'], 'steel', [], kick=0.0, chips=1.0, gloss=0.4, age=1.6, joints=False, rust=1.0)
        M['card'] = Dr.sign_mat(k + '_card', ground='#d9cfae', border='#6a5a3a', rust=0.2); M['inner'] = lf
        M['coatA'] = kitlib.fabric(k + '_coatA', '#3c4130', weave=0.3, fade=0.4, age=1.4); M['coatB'] = kitlib.fabric(k + '_coatB', '#3d4c63', weave=1.0, fade=0.6, age=1.5)
    elif style == 'attic':
        M['leaf'] = M['case'] = kitlib.wood(k + '_oak', 'oak', 'varnish', stain='#2c1f16', age=0.95)
        M['inner'] = Dr.bare_boards(k + '_inner', 'deal', [], age=1.6, tone=0.7)
        M['coatA'] = kitlib.fabric(k + '_coatA', '#8a7d68', weave=0.8, fade=0.6, age=1.8); M['coatB'] = kitlib.fabric(k + '_coatB', '#5c4f45', weave=0.0, velvet=True, fade=0.6, age=1.8)
        M['sheet'] = kitlib.fabric(k + '_sheet', '#cfc6b2', weave=1.2, fade=0.3, age=2.0)
    else:
        lf = Dr.paint(k + '_paint', ['#4f5d4c', '#8b8a82', '#7a3b28'], 'pine', LH_ if part == 'leaf' else [], kick=0.3, chips=1.4, gloss=0.3, age=1.5,
                      edges=E if part == 'leaf' else None, top_fn=workshop_top if part == 'body' else None, space='lp' if part == 'leaf' else None)
        M['leaf'] = M['case'] = lf; M['inner'] = Dr.bare_boards(k + '_inner', 'deal', [], age=1.5, tone=0.75)
        M['coatA'] = kitlib.fabric(k + '_coatA', '#4a3426', weave=0.0, fade=0.3, age=1.6); M['coatB'] = kitlib.fabric(k + '_coatB', '#6b6550', weave=1.0, fade=0.5, age=1.6)
    if style == 'wood' and part == 'body':                         # (the frieze's stars: on the cornice, stencilled)
        pass
    return M

# ================================================================ build, bake, register
def bake_group(name, objs, px=PX, double=False, alpha=None):
    kitlib.unwrap(objs, margin=0.006 if alpha else 0.003, smart=True, angle=60)
    files = kitlib.bake_set(objs, name, px, 64)
    mat = kitlib.baked_material('Kit_' + name, files, double=double, alpha=alpha)
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(mat); o.data.polygons.foreach_set('material_index', [0] * len(o.data.polygons))
        for a in [a.name for a in o.data.attributes if a.name in ATTRS]: o.data.attributes.remove(o.data.attributes[a])
        o['kit'] = 'ward'
    return files

def shrink_hidden(ob):
    """less texture where nobody looks: the back against the wall, the roof above everyone's eyes, the undersides"""
    kitlib.uv_scale(ob, lambda p: p.normal.y > 0.9 and p.center.y > YB - 0.004, 0.12)
    kitlib.uv_scale(ob, lambda p: p.normal.z > 0.9 and p.center.z > BH - 0.01, 0.2)
    kitlib.uv_scale(ob, lambda p: p.normal.z < -0.9 and p.center.z < 0.1, 0.15)

def build_style(style):
    t0 = time.time(); kitlib.reset(); info = {}
    # the body
    M = materials(style, 'body'); G = build_body(style, M); body = G.build(f'Ward_body_{style}')
    extra = []
    if style == 'attic':
        bm, flat = dust_sheet(random.Random(5)); rnd = random.Random(3); off = (rnd.uniform(-9, 9), rnd.uniform(-9, 9))
        lut = {tuple(round(q, 5) for q in v.co): fl for v, fl in flat.items()}   # (the weave follows the cloth: its flat position)
        Gs = S.Geo(1, 1, False, False)
        Gs.add(bm, M['sheet'], attrs_of(lambda c: (0.0, 0.0, 0.0), 0.5), smooth=True, wrap=False)
        sh = Gs.build('dust_sheet'); me = sh.data; gp = []
        for v in me.vertices:
            u_, w_ = lut.get(tuple(round(q, 5) for q in v.co), (0.0, 0.0)); gp.append((u_ + off[0], w_ + off[1], 0.0))
        kitlib.attr(sh, 'gpos', gp, 'FLOAT_VECTOR')
        body = kitlib.join([body, sh], f'Ward_body_{style}')
    kitlib.unwrap([body], margin=0.003, smart=True, angle=60); shrink_hidden(body)
    f1 = bake_group(f'ward_{style}_body', [body], double=style == 'attic')
    body.name = f'Ward_body_{style}'; body.data.name = body.name; body.location = (0, 0, 0)
    info['body'] = {'tris': kitlib.tris(body), 'bake': f1['times']['total']}
    # the leaves: the left one where it hangs, the right one built 5 m off (its own wear), then mirrored onto its hinge
    M = materials(style, 'leaf'); leaves = []
    for side, ox in (('L', 0.0), ('R', 5.0)):
        G = build_leaf(style, M, ox); o = G.build(f'Ward_leaf{side}_{style}')
        if side == 'R':
            me = o.data
            for v in me.vertices: v.co.x = -(v.co.x - ox)
            me.flip_normals(); me.update()
        leaves.append(o)
    f2 = bake_group(f'ward_{style}_leaves', leaves, alpha=True if style == 'concrete' else None)
    for o, (side, hx) in zip(leaves, (('L', -HX), ('R', HX))):
        o.location = (hx, HY, HZ); o.data.name = o.name
        o['opens'] = 'outward: about its hinge (z up), away from the carcass into the room (three.js pivot.rotation.y = side * angle, side -1 left, +1 right)'
        info['leaf' + side] = {'tris': kitlib.tris(o)}
    info['leaves_bake'] = f2['times']['total']
    for nm, d in info.items(): print(f'  {nm}: {d}', flush=True)
    roots = [body] + leaves
    if '--sheets' in sys.argv: sheets(style, body, leaves)
    json.dump(info, open(os.path.join(TMP, f'wardrobe_{style}.json'), 'w'), indent=1)
    kitlib.register(f'wardrobe_{style}', roots)
    print(f'wardrobe {style}: done in {time.time() - t0:.0f}s', flush=True)

# ================================================================ contact sheets
def sheets(style, body, leaves):
    """what ships: the wardrobe against a wall of its style, closed (3/4 and close on a door in a raking light), the doors open on the
       coats, and from inside it looking out between the louvres at the lit room"""
    from PIL import Image
    d = os.path.join(TMP, 'sheets', 'wardrobes'); os.makedirs(d, exist_ok=True)
    man = S.manifest_load()['styles'].get(style, {}); sc = bpy.context.scene; tmp = []
    def keep(o): tmp.append(o); return o
    fl = S.ship_mat('sh_floor', man['floor']) if man.get('floor') else kitlib.grey()
    wA = S.ship_mat('sh_wallA', man['wall'], 0) if man.get('wall') else kitlib.grey()
    sc.world.color = (0.03, 0.03, 0.035); FW = 2.25
    for i in (-1, 0, 1):
        for j in (-2, -1, 0): keep(S.quad(f'sh_f{i}{j}', (i * FW - FW / 2, j * FW, 0), (FW, 0, 0), (0, FW, 0), mat=fl))
        keep(S.quad(f'sh_w{i}', (i * FW + FW / 2, YB + 0.003, 0), (-FW, 0, 0), (0, 0, 3.0), mat=wA))         # (the wall behind, facing -y)
    keep(S.quad('sh_wl', (-1.6, -4.5, 0), (0, 4.5 + YB, 0), (0, 0, 3.0), mat=wA))
    keep(S.quad('sh_wf', (-3.4, -3.2, 0), (6.8, 0, 0), (0, 0, 3.0), mat=wA))
    keep(S.quad('sh_c', (-3.4, -3.2, 3.0), (6.8, 0, 0), (0, 3.6, 0), mat=kitlib.grey('sh_cm', (0.5, 0.48, 0.45))))
    keep(S.lamp('sh_key', 'AREA', 110, (0.9, -1.9, 2.5), None, 1.0, (1.0, 0.84, 0.64)))
    keep(S.lamp('sh_fill', 'AREA', 40, (-1.2, -2.6, 2.2), None, 1.5, (0.75, 0.82, 1.0)))
    shots = []
    S.cam_at((1.35, -2.9, 1.45), (0.0, 0.0, 1.2), 30); shots.append(S.render(os.path.join(d, f'{style}_closed.png'), 900, 1100, 128))
    if style == 'attic':                                       # (its dust sheet: over the roof and down the left side)
        S.cam_at((-1.45, -2.5, 1.9), (-0.2, 0.0, 1.35), 30); shots.append(S.render(os.path.join(d, f'{style}_sheet.png'), 900, 1100, 128))
    rk = keep(S.lamp('sh_rake', 'SPOT', 120, (0.9, -0.9, 1.4), None, 0.03, (1.0, 0.88, 0.72))); rk.data.spot_size = math.radians(60)
    rk.rotation_euler = (Vector((-0.2, -0.32, 0.9)) - rk.location).to_track_quat('-Z', 'Y').to_euler()
    S.cam_at((0.75, -1.05, 1.05), (-0.18, -0.32, 0.95), 40); shots.append(S.render(os.path.join(d, f'{style}_door_close.png'), 1000, 1100, 128))
    rk.hide_render = True
    for o, s_ in zip(leaves, (-1, 1)): o.rotation_euler = (0, 0, s_ * OPEN)       # (outward, into the room, as the game swings them)
    S.cam_at((0.2, -2.4, 1.35), (0.0, 0.0, 1.25), 30); shots.append(S.render(os.path.join(d, f'{style}_open.png'), 1000, 1100, 128))
    for o in leaves: o.rotation_euler = (0, 0, 0)
    inner = keep(S.lamp('sh_in', 'POINT', 1.5, (0.0, -0.1, 1.9), None, 0.05, (1.0, 0.85, 0.7)))
    S.cam_at((0.0, 0.0, 1.55), (0.0, -3.0, 1.45), 26); shots.append(S.render(os.path.join(d, f'{style}_inside.png'), 1000, 1100, 128))
    for o in tmp:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o)
    ims = [Image.open(p).convert('RGB') for p in shots]; hgt = 640
    ims = [im.resize((int(im.width * hgt / im.height), hgt)) for im in ims]
    out = Image.new('RGB', (sum(i.width for i in ims), hgt)); x = 0
    for im in ims: out.paste(im, (x, 0)); x += im.width
    out.save(os.path.join(d, f'{style}_wardrobe.png'))

def main():
    for st in [s for s in defs.KIT['styles'] if OPTS.want(s)]:
        if kitlib.fresh_asset(f'wardrobe_{st}') and '--sheets' not in sys.argv: print(f'wardrobe {st} up to date'); continue
        build_style(st)

if __name__ == '__main__':
    main()
