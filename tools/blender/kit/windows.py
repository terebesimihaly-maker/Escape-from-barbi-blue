# Escape from Barbi Blue: the windows (WP2.2; build spec B5, C6). Each Win_<id> replaces a whole 2.25 x 3 m border wall face: the
# root is the face (reserved WallSurface: the game gives it the face's own wall and atlas cell) with the opening and its reveal, and
# the children are
#   Win_<id>_frame    sashes, casements or steel, the box, beads, the window board, architraves, hardware (baked)
#   Win_<id>_glass    the panes (reserved Glass)
#   Win_<id>_sky      the sky plane behind them, inside the reveal (reserved SkyPlane)
#   Win_<id>_curtain  cloth: drapes and lace (the lace cut out: an alpha mask), a pelmet, shutters (baked, double-sided)
# Envelope: from 0.20 m into the room to 0.35 m into the wall (curtains no more than 0.20 m out), uv1 on all but glass and sky.
#   Win_sash        wood: a Victorian two-over-two sash, panelled reveal, faded rose velvet drapes on a pole, yellowed lace
#   Win_tall        tile: a tall sash in mahogany, folding shutters in their boxes, a mahogany pelmet, claret damask drapes
#   Win_cellar      concrete: a two-light cellar casement high up, iron bars, a sloping sill (and _short, the head at 2.35 m)
#   Win_dormer      attic: a six-light casement deep in a boarded dormer, a faded cotton curtain on a sagging wire
#   Win_oculus      attic: a round window, its ring and radial bars
#   Win_industrial  workshop: a steel window of 36 small panes, three broken, a sacking curtain that sways (two shape keys)
#   py -3.11 tools/blender/kit/windows.py [--preview] [--force] [--only Win_sash,Win_tall] [--sheets]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
from surfaces2 import sep, comb, finish
from doors import (strip, quad_bm, clean, seg_hint, ovolo, Face, panelled, ring, lathe_bm, tube, block, plate, rounded, member, attrs_of,
                   metal_attrs, wood_attrs, wall_face, architrave, ARCH, MARGIN, AW, ATTRS)
from kitlib import OPTS, TMP, lin

FW = 2.25; FH = 3.0
PIECES = {k: v for k, v in defs.KIT['arch']['pieces'].items() if v['kind'] == 'window'}
PX = 2048
random.seed(31)

# ================================================================ the wall and its reveal
def reveal(G, mat, x0, x1, z0, z1, depth, sill=True):
    """the reveal of a rectangular opening from the wall plane back to depth (WallSurface: the game unwraps it into its depth)"""
    for x, n in ((x0, 1), (x1, -1)):
        G.add(quad_bm([(x, 0, z0), (x, depth, z0), (x, depth, z1), (x, 0, z1)], (n, 0, 0)), mat, attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    G.add(quad_bm([(x0, 0, z1), (x1, 0, z1), (x1, depth, z1), (x0, depth, z1)], (0, 0, -1)), mat, attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    if sill: G.add(quad_bm([(x0, 0, z0), (x1, 0, z0), (x1, depth, z0), (x0, depth, z0)], (0, 0, 1)), mat, attrs_of(lambda c: tuple(c), 0.5), wrap=False)

def sky(G, mat, x0, x1, z0, z1, y):
    G.add(quad_bm([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], (0, -1, 0)), mat, attrs_of(lambda c: tuple(c), 0.5), wrap=False)

def pane(G, mat, x0, x1, z0, z1, y, t=0.003):
    for s in (-1, 1):
        yy = y + s * t / 2
        G.add(quad_bm([(x0, yy, z0), (x1, yy, z0), (x1, yy, z1), (x0, yy, z1)], (0, s, 0)), mat, attrs_of(lambda c: tuple(c), 0.5), wrap=False)

# ================================================================ sashes and casements
GLAZE = ovolo(0.006, 3) + [(0.0075, -0.006), (0.0075, -0.03)]      # (the room side of a sash bar: ovolo, then down to the glass)

def sash(G, mat, x0, x1, z0, z1, y_room, t, cols=1, rows=1, stile=0.05, top=0.05, bottom=0.05, bar=0.022, glass=None, glass_mat=None, horns=0.0):
    """a sash or casement: stiles, rails, glazing bars, moulded round each light on the room side, the glass in rebates behind
       (at y_room + t - 0.012); horns below the stiles of an upper sash"""
    W, H = x1 - x0, z1 - z0; lw = (W - 2 * stile - (cols - 1) * bar) / cols; lh = (H - top - bottom - (rows - 1) * bar) / rows
    holes = []
    for i in range(cols):
        for j in range(rows):
            a = x0 + stile + i * (lw + bar); b = z0 + bottom + j * (lh + bar); holes.append((a, a + lw, b, b + lh))
    gy = y_room + t - 0.012
    prof = [(d, h) for d, h in GLAZE[:-1]] + [(GLAZE[-1][0], -(gy - y_room))]
    mems = {}
    def att(kind, side, rect):
        key = (kind, side, rect if kind != 'cell' else (round((rect[0] + rect[1]) / 2, 3) < x0 + stile or round((rect[0] + rect[1]) / 2, 3) > x1 - stile))
        if key not in mems: mems[key] = member((0, 0, 1) if (kind == 'cell' and key[2]) or (side and side in 'lr') else (1, 0, 0), (0, -1, 0))
        gp, pr = mems[key]; return attrs_of(gp, pr)
    F = Face((0, y_room, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    panelled(G, F, (x0, x1, z0, z1), [], [], [], mat, att, holes=[(h, prof) for h in holes])
    for s_, x in ((1, x0), (-1, x1)):                        # (the stiles' outer edges, the rails' top and bottom: seen in the gaps)
        G.add(quad_bm([(x, y_room, z0), (x, y_room + t, z0), (x, y_room + t, z1), (x, y_room, z1)], (-s_, 0, 0)), mat, wood_attrs((0, 0, 1), (-s_, 0, 0)), wrap=False)
    for n, z in ((-1, z0), (1, z1)):
        G.add(quad_bm([(x0, y_room, z), (x1, y_room, z), (x1, y_room + t, z), (x0, y_room + t, z)], (0, 0, n)), mat, wood_attrs((1, 0, 0), (0, 0, n)), wrap=False)
    if horns:
        for xa in (x0, x1 - stile):
            G.add(block((xa + 0.004, y_room, z0 - horns), (xa + stile - 0.004, y_room + t, z0), 0.003, 1), mat, wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    if glass is not None:
        for h in holes: pane(glass, glass_mat, h[0] - 0.004, h[1] + 0.004, h[2] - 0.004, h[3] + 0.004, gy + 0.004)
    return holes

def board(G, mat, x0, x1, z, y0, y1, t=0.028, nose=0.009):
    """a window board: its top at z from y0 (the room side, a rounded nosing) back to y1"""
    rows = [[Vector((x0, y0 - 0.004 + 0.0, z - t)), Vector((x1, y0 - 0.004, z - t))], [Vector((x0, y0 - 0.008, z - t * 0.55)), Vector((x1, y0 - 0.008, z - t * 0.55))],
            [Vector((x0, y0 - 0.006, z - 0.004)), Vector((x1, y0 - 0.006, z - 0.004))], [Vector((x0, y0, z)), Vector((x1, y0, z))], [Vector((x0, y1, z)), Vector((x1, y1, z))]]
    hints = [Vector((0, -1, -0.6)), Vector((0, -1, 0.3)), Vector((0, -0.5, 1)), Vector((0, 0, 1))]
    G.add(strip(rows, hints), mat, wood_attrs((1, 0, 0), (0, 0, 1)), smooth=True, wrap=False)
    for x, n in ((x0, -1), (x1, 1)):                          # (the ends)
        G.add(quad_bm([(x, y0 - 0.006, z - t), (x, y1, z - t), (x, y1, z), (x, y0 - 0.006, z)], (n, 0, 0)), mat, wood_attrs((1, 0, 0), (n, 0, 0)), wrap=False)

def panel_face(G, mat, F, outline, panels, prof=None, grain=(0, 0, 1)):
    prof = prof or (ovolo(0.006) + [(0.0075, -0.006), (0.0075, -0.009)]); mems = {}
    def att(kind, side, rect):
        key = (kind, side, rect)
        if key not in mems: mems[key] = member(grain if kind != 'mould' or side in ('l', 'r') else (F.U.x, F.U.y, F.U.z), (-F.N.x, -F.N.y, -F.N.z))
        gp, pr = mems[key]; return attrs_of(gp, pr, zone=2.0 if kind == 'field' else 0.0)
    panelled(G, F, outline, panels, prof, [], mat, att)

# ================================================================ cloth
def cloth_grid(nx, nz, f):
    """a quad grid of cloth: f(s, t) -> (point, fabric coordinates (m)); faces toward -y (into the room)"""
    bm = bmesh.new(); V = []; FC = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            p, fc = f(i / nx, j / nz); row.append(bm.verts.new(p)); FC.append(fc)
        V.append(row)
    for j in range(nz):
        for i in range(nx):
            fc = bm.faces.new((V[j][i], V[j + 1][i], V[j + 1][i + 1], V[j][i + 1])); fc.normal_update()
            if fc.normal.y > 0: fc.normal_flip()
    return bm, FC

def add_cloth(G, mat, bm, FC, seed, extra=None):
    """into G with the fabric's own coordinates as grain space (weave and pattern follow the cloth, not the room)"""
    bm.verts.index_update(); lut = {v.co.to_tuple(6): FC[v.index] for v in bm.verts}; pr = random.random()
    a = attrs_of(lambda c, lut=lut: lut.get(tuple(round(x, 6) for x in c), (0.0, 0.0, 0.0)), pr, lp=lambda c, lut=lut: lut.get(tuple(round(x, 6) for x in c), (0.0, 0.0, 0.0)))
    if extra: a.update(extra)
    G.add(bm, mat, a, smooth=True, wrap=False)

def drape(G, mat, xo, xi, zt, zb, y0, folds=7, tie=None, depth=0.042, nx=28, nz=34, seed=0, fullness=2.2):
    """a lined velvet drape hanging from rings: xo the edge at the wall's side, xi its inner edge at the top, from zt down to zb,
       its front at y0; pleated deep at the top, gathered into a tieback (tie = (z, width): the fabric bunched and bulging there)
       and flaring out below it again, or hanging straight (tie None). Folds wander a little; the inner edge curls"""
    W0 = abs(xi - xo); sg = 1 if xi > xo else -1; L = zt - zb; rnd = random.Random(seed); ph = rnd.uniform(0, 9)
    tt = (zt - tie[0]) / L if tie else None
    def width(t):
        if tie is None: return W0 * (1 + 0.06 * t)
        if t <= tt: k = t / tt; return W0 + (tie[1] - W0) * (k ** 1.6)
        k = (t - tt) / (1 - tt); return tie[1] + (W0 * 0.72 - tie[1]) * math.sin(k * math.pi / 2) ** 1.2
    def f(s, t):
        z = zt - t * L; w = width(t)
        bunch = 0.55 * math.exp(-((t - tt) / 0.07) ** 2) if tie else 0.0
        wav = s * folds * 2 * math.pi + 0.7 * mnoise.noise(Vector((s * 3.0 + ph, t * 2.0, ph))) + 0.25 * mnoise.noise(Vector((s * 9.0, t * 6.0 + ph, 1.0)))
        d = depth * (0.55 + 0.45 * min(1.0, s * 6)) * (1.0 + 0.9 * bunch) * (1.0 + 0.15 * mnoise.noise(Vector((s * 4, t * 3, ph + 3))))
        x = xo + sg * s * w
        y = y0 + d * (0.5 - 0.5 * math.cos(wav)) - d - 0.018 * bunch * (1 - abs(2 * s - 1))
        if tie and t > tt: y -= 0.012 * math.sin(math.pi * min(1.0, (t - tt) / (1 - tt)))
        return Vector((x, min(y, y0), z)), (s * W0 * fullness, t * L, seed * 1.7)
    bm, FC = cloth_grid(nx, nz, f); add_cloth(G, mat, bm, FC, seed)
    if tie:                                                   # (where the gathered bundle is at the tie: what the tieback holds)
        pts = [f(i / 40, tt)[0] for i in range(41)]
        return (min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts), tie[0], xo, sg)
    return None

def lace(G, mat, x0, x1, zt, zb, y0, folds=11, depth=0.012, nx=40, nz=24, seed=5):
    """a lace panel hanging straight behind the drapes: soft gathers from its rod, a hem that dips and frays a little"""
    W = x1 - x0; L = zt - zb; ph = seed * 1.31
    def f(s, t):
        z = zt - t * L + 0.006 * t * math.sin(s * math.pi) * 3 + 0.01 * t * mnoise.noise(Vector((s * 5, ph, 0.0)))
        wav = s * folds * 2 * math.pi + 0.5 * mnoise.noise(Vector((s * 4 + ph, t * 1.5, 2.0)))
        y = y0 - depth * (0.5 - 0.5 * math.cos(wav)) * (1.0 - 0.35 * t)
        return Vector((x0 + s * W, y, z)), (s * W * 1.6, t * L, 3.3 + seed)
    bm, FC = cloth_grid(nx, nz, f); add_cloth(G, mat, bm, FC, seed)

def pole(G, M, x0, x1, z, y, r=0.016, rings=10, finial=True, brackets=True):
    """a curtain pole with turned finials, brackets to the wall and rings"""
    G.add(lathe_bm([(0.0, r), (1.0, r)], (x0, y, z), (x1, y, z), 12, (True, True)), M['pole'], metal_attrs(), smooth=True, wrap=False)
    if finial:
        for s, x in ((-1, x0), (1, x1)):
            fp = [(0.0, r * 1.1), (0.15, r * 1.3), (0.3, r * 0.8), (0.55, r * 1.9), (0.8, r * 1.6), (0.95, r * 0.7), (1.0, 0.0)]
            G.add(lathe_bm(fp, (x, y, z), (x + s * 0.09, y, z), 12, (True, False)), M['pole'], metal_attrs(), smooth=True, wrap=False)
    if brackets:
        for x in (x0 + 0.1, x1 - 0.1):
            tube(G, M['pole'], [Vector((x, y, z)), Vector((x, y * 0.4, z + 0.02)), Vector((x, 0.0, z + 0.03))], 0.006)
            G.add(lathe_bm([(0.0, 0.02), (1.0, 0.016)], (x, 0.0, z + 0.03), (x, -0.008, z + 0.03), 10), M['pole'], metal_attrs(), wrap=False)
    for xs in rings:
        rp = [Vector((xs + 0.0, y + (r + 0.006) * math.sin(2 * math.pi * k / 8), z + (r + 0.006) * math.cos(2 * math.pi * k / 8))) for k in range(9)]
        tube(G, M['pole'], rp, 0.003, 5)

def tieback(G, mat, hook_mat, bundle, r=0.0065):
    """a cord tieback holding the drape: drawn tight round the gathered bundle (in front of it, round its inner edge, back between
       it and the wall), both ends to a brass hook on the wall just outside the drape, the loop dipping a little at the front;
       a tassel hangs from the hook"""
    xa, xb, ya, yb, z, xo, sg = bundle
    cx, cy = (xa + xb) / 2, (ya + yb) / 2; rx, ry = (xb - xa) / 2 + r + 0.004, (yb - ya) / 2 + r + 0.004
    hx = xo - sg * 0.035; hook = Vector((hx, -0.012, z + 0.01))
    a0 = math.atan2(0.4, -sg * 1.0)                           # (the loop starts and ends at the bundle's back corner on the hook's side)
    pts = [hook]
    for k in range(17):
        a = a0 + sg * 2 * math.pi * k / 16
        x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
        dip = 0.018 * max(0.0, (cy - y) / ry)               # (the front of the loop sags under the drape's weight)
        pts.append(Vector((x, min(y, -0.004), z - dip)))
    pts.append(hook)
    tube(G, mat, pts, r, 8)
    G.add(lathe_bm([(0.0, 0.006), (0.4, 0.009), (1.0, 0.005)], (hx, 0.0, z + 0.01), (hx, -0.022, z + 0.01), 10), hook_mat, metal_attrs(), smooth=True, wrap=False)   # (the hook)
    tp = hook + Vector((0, -0.004, -0.012))                   # (the tassel: a knot, the bell, the fringe)
    G.add(lathe_bm([(0.0, 0.004), (0.12, 0.011), (0.25, 0.008), (0.35, 0.01), (0.55, 0.014), (1.0, 0.019)], tp, tp + Vector((0, 0, -0.11)), 10, (True, True)), mat, metal_attrs(), smooth=True, wrap=False)

# ================================================================ the windows
def win_sash(M, G, open_, R, tall=False):
    """a Victorian sash: box frame back in the reveal, two sashes (the upper with horns), sash fastener and lifts, the window
       board and apron, architraves; curtains: velvet drapes on a pole, tied back, and lace (tall: folding shutters in panelled
       boxes, a pelmet, damask drapes)"""
    ow, oh, sill = open_; x0, x1, z0, z1 = -ow / 2, ow / 2, sill, sill + oh
    fy = 0.2 if tall else 0.11                                # (the frame's room face, back in the reveal)
    root, frame, glass, skyg, cur = G['root'], G['frame'], G['glass'], G['sky'], G['curtain']
    wall_face(root, M['wall'], (x0, x1, z0, z1))
    sb = 0.075 if tall else 0.0                               # (the shutter boxes take the reveal's sides)
    if tall:
        reveal(root, M['wall'], x0, x1, z0, z1, 0.004, sill=False)
        for sx in (-1, 1):                                    # folded shutters in their boxes: a panelled leaf face, the next leaf's edge
            F = Face((sx * (ow / 2 - sb), 0, 0), (0, 1, 0), (0, 0, 1), (-sx, 0, 0))
            panel_face(cur, M['shutter'], F, (0.0, fy, z0, z1), [(0.03, fy - 0.03, z0 + 0.06, z0 + 0.62), (0.03, fy - 0.03, z0 + 0.72, z1 - 0.06)], grain=(0, 0, 1))
            cur.add(quad_bm([(sx * (ow / 2 - sb), 0.0, z0), (sx * ow / 2, 0.0, z0), (sx * ow / 2, 0.0, z1), (sx * (ow / 2 - sb), 0.0, z1)], (0, -1, 0)), M['shutter'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
            for k in (1, 2):                                   # (the leaves' edges stacked behind, seen at the box front)
                xx = sx * (ow / 2 - sb + 0.024 * k)
                cur.add(block((min(xx, xx - sx * 0.003), 0.0005, z0 + 0.004), (max(xx, xx - sx * 0.003), fy - 0.004, z1 - 0.004), 0.0008, 1), M['shutter'], wood_attrs((0, 0, 1), (-sx, 0, 0)), wrap=False)
        F = Face((0, 0, z1), (1, 0, 0), (0, 1, 0), (0, 0, -1))   # (the soffit, panelled)
        panel_face(frame, M['wood'], F, (x0, x1, 0.0, fy), [(x0 + 0.06, x1 - 0.06, 0.03, fy - 0.03)], grain=(1, 0, 0))
    else:
        reveal(root, M['wall'], x0, x1, z0, z1, fy, sill=False)
    ix0, ix1 = x0 + sb, x1 - sb                               # (the frame's inner width)
    # the box: staff beads, the pulley stiles' faces with the parting bead, the head
    for sx, x in ((1, ix0), (-1, ix1)):
        frame.add(quad_bm([(x, fy, z0), (x, fy + 0.13, z0), (x, fy + 0.13, z1), (x, fy, z1)], (sx, 0, 0)), M['wood'], wood_attrs((0, 0, 1), (-sx, 0, 0)), wrap=False)
        frame.add(block((min(x, x + sx * 0.012), fy + 0.058, z0), (max(x, x + sx * 0.012), fy + 0.066, z1), 0.0015, 1), M['wood'], wood_attrs((0, 0, 1), (-sx, 0, 0)), wrap=False)
        frame.add(block((min(x, x + sx * 0.018), fy - 0.016, z0), (max(x, x + sx * 0.018), fy, z1), 0.004, 2), M['wood'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    frame.add(quad_bm([(ix0, fy, z1), (ix1, fy, z1), (ix1, fy + 0.13, z1), (ix0, fy + 0.13, z1)], (0, 0, -1)), M['wood'], wood_attrs((1, 0, 0), (0, 0, -1)), wrap=False)
    frame.add(block((ix0, fy - 0.016, z1 - 0.018), (ix1, fy, z1), 0.004, 2), M['wood'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    sw0, sw1 = ix0 + 0.018, ix1 - 0.018; mid = z0 + 0.03 + (oh - 0.03) * 0.5
    # the sashes: the lower one inside, its bottom on the sill bead; the upper one behind, overlapping at the meeting rails
    sash(frame, M['wood'], sw0, sw1, z0 + 0.03, mid + 0.02, fy + 0.002, 0.045, cols=2, rows=1, stile=0.052, top=0.04, bottom=0.085, glass=glass, glass_mat=M['glass'])
    sash(frame, M['wood'], sw0, sw1, mid - 0.02, z1 - 0.018, fy + 0.07, 0.045, cols=2, rows=1, stile=0.052, top=0.055, bottom=0.04, glass=glass, glass_mat=M['glass'], horns=0.05)
    frame.add(block((ix0, fy - 0.002, z0), (ix1, fy + 0.13, z0 + 0.03), 0.004, 1), M['wood'], wood_attrs((1, 0, 0), (0, 0, 1)), wrap=False)   # (the sill bead)
    # brass: the fitch fastener on the meeting rails, two lifts on the bottom rail
    frame.add(plate(rounded(0.05, 0.022, 0.004, 2, 0.0, mid + 0.005), fy + 0.002, 0.004), M['brass'], metal_attrs(), wrap=False)
    tube(frame, M['brass'], [Vector((-0.02, fy - 0.006, mid + 0.012)), Vector((0.0, fy - 0.012, mid + 0.014)), Vector((0.03, fy - 0.008, mid + 0.012))], 0.0035, 8)
    for xl in (-ow * 0.28, ow * 0.28):
        frame.add(plate(rounded(0.03, 0.018, 0.003, 2, xl, z0 + 0.075), fy + 0.002, 0.002), M['brass'], metal_attrs(), wrap=False)
        tube(frame, M['brass'], [Vector((xl - 0.01, fy - 0.002, z0 + 0.078)), Vector((xl, fy - 0.02, z0 + 0.07)), Vector((xl + 0.01, fy - 0.002, z0 + 0.078))], 0.003, 6)
    # the board, the apron, the architraves
    board(frame, M['wood'], x0 - AW - 0.035, x1 + AW + 0.035, z0, -0.035, fy, 0.03)
    apron = [(0, 0), (0, 0.006), (0.004, 0.012), (0.01, 0.016), (0.05, 0.016), (0.055, 0.012), (0.06, 0.0)]
    rows = [[Vector((x0 - AW, -h, z0 - 0.03 - w)), Vector((x1 + AW, -h, z0 - 0.03 - w))] for w, h in apron]
    frame.add(strip(rows, [seg_hint(apron[k], apron[k + 1], Vector((0, 0, -1)), Vector((0, -1, 0))) for k in range(len(apron) - 1)]), M['wood'], wood_attrs((1, 0, 0), (0, 1, 0)), smooth=True, wrap=False)
    architrave(frame, M['wood'], ARCH['tile' if tall else 'wood'], ow / 2 + MARGIN, z1 + MARGIN, z0, 0.0, -1)
    sky(skyg, M['sky'], x0, x1, z0, z1, R - 0.012)
    # curtains
    pz = z1 + MARGIN + AW + 0.08
    if tall:
        pw = ow / 2 + AW + 0.2                                # (the pelmet: a mahogany box, a cornice, a shaped lower edge)
        PF = -0.152                                           # (the pelmet's face: its cornice stays inside the 0.20 m envelope)
        cur.add(block((-pw, PF, pz - 0.2), (pw, PF + 0.02, pz + 0.04), 0.004, 1), M['shutter'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
        for sx in (-1, 1): cur.add(block((min(sx * pw, sx * (pw - 0.02)), PF, pz - 0.2), (max(sx * pw, sx * (pw - 0.02)), 0.0, pz + 0.04), 0.004, 1), M['shutter'], wood_attrs((0, 0, 1), (sx, 0, 0)), wrap=False)
        cor = [(0, 0), (0.0, 0.012), (0.008, 0.02), (0.014, 0.03), (0.022, 0.036), (0.03, 0.036), (0.03, 0.044)]
        rows = [[Vector((-pw - h, PF - h, pz + 0.04 + w)), Vector((pw + h, PF - h, pz + 0.04 + w))] for w, h in cor]
        cur.add(strip(rows, [Vector((0, -1, 0.6))] * (len(rows) - 1)), M['shutter'], wood_attrs((1, 0, 0), (0, -1, 0)), smooth=True, wrap=False)
        cur.add(block((-pw - 0.03, PF - 0.03, pz + 0.075), (pw + 0.03, 0.0, pz + 0.084), 0.002, 1), M['shutter'], wood_attrs((1, 0, 0), (0, 0, 1)), wrap=False)
        for sx in (-1, 1):
            b = drape(cur, M['cloth'], sx * (ow / 2 + AW + 0.18), sx * (ow / 2 - 0.12), pz - 0.05, 0.012, -0.03, 6, (1.05, 0.14), 0.055, nx=22, nz=30, seed=3 + sx)
            tieback(cur, M['cord'], M['brass'], b)
    else:
        py = -0.12; px0, px1 = x0 - AW - 0.24, x1 + AW + 0.24
        for sx in (-1, 1):
            b = drape(cur, M['cloth'], sx * (ow / 2 + AW + 0.2), sx * (ow / 2 - 0.13), pz - 0.03, 0.012, py + 0.035, 6, (1.1, 0.14), 0.052, nx=22, nz=30, seed=7 + sx)
            tieback(cur, M['cord'], M['brass'], b)
        pole(cur, M, px0, px1, pz, py, rings=[px0 + 0.12 + k * 0.05 for k in range(6)] + [px1 - 0.12 - k * 0.05 for k in range(6)])
        lace(cur, M['lace'], x0 - 0.04, x1 + 0.04, z1 + 0.06, z0 + 0.04, -0.045)
        tube(cur, M['brass'], [Vector((x0 - 0.06, -0.04, z1 + 0.065)), Vector((x1 + 0.06, -0.04, z1 + 0.065))], 0.004, 8)   # (the lace's rod)

def win_cellar(M, G, open_, R):
    """a cellar window high in the wall: the sill sloping steeply down into the room, a two-light timber casement far back,
       iron bars set into the reveal, cobwebbed corners"""
    ow, oh, sill = open_; x0, x1, z0, z1 = -ow / 2, ow / 2, sill, sill + oh
    root, frame, glass, skyg = G['root'], G['frame'], G['glass'], G['sky']
    fy = 0.22; zs = z0 - 0.14                                # (the sill starts lower at the wall face)
    wall_face(root, M['wall'], (x0, x1, zs, z1))
    for x, n in ((x0, 1), (x1, -1)):
        root.add(quad_bm([(x, 0, zs), (x, fy, z0), (x, fy, z1), (x, 0, z1)], (n, 0, 0)), M['wall'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    root.add(quad_bm([(x0, 0, z1), (x1, 0, z1), (x1, fy, z1), (x0, fy, z1)], (0, 0, -1)), M['wall'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    root.add(quad_bm([(x0, 0, zs), (x1, 0, zs), (x1, fy, z0), (x0, fy, z0)], (0, -0.3, 1)), M['wall'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    # the casement frame and its two lights
    fr = 0.045
    for (a, b, c, d) in ((x0, x0 + fr, z0, z1), (x1 - fr, x1, z0, z1), (x0, x1, z0, z0 + fr), (x0, x1, z1 - fr, z1), (-0.02, 0.02, z0, z1)):
        frame.add(block((a, fy, c), (b, fy + 0.06, d), 0.004, 1), M['wood'], wood_attrs((0, 0, 1) if (b - a) < (d - c) else (1, 0, 0), (0, -1, 0)), wrap=False)
    for (a, b) in ((x0 + fr, -0.02), (0.02, x1 - fr)):
        sash(frame, M['wood'], a + 0.002, b - 0.002, z0 + fr + 0.002, z1 - fr - 0.002, fy - 0.004, 0.042, 1, 1, 0.035, 0.035, 0.035, glass=glass, glass_mat=M['glass'])
    frame.add(plate([(x1 - 0.12, z0 + 0.2), (x1 - 0.06, z0 + 0.2), (x1 - 0.06, z0 + 0.215), (x1 - 0.12, z0 + 0.215)], fy - 0.004, 0.004), M['iron'], metal_attrs(), wrap=False)
    # iron bars from the head down into the sloping sill
    for k in range(5):
        x = x0 + ow * (k + 0.5) / 5; yb = 0.11; zb = zs + (z0 - zs) * yb / fy
        tube(frame, M['iron'], [Vector((x, yb, zb - 0.03)), Vector((x, yb, z1 + 0.04))], 0.009, 10)
    frame.add(block((x0 - 0.02, 0.1, z1 - 0.12), (x1 + 0.02, 0.12, z1 - 0.1), 0.002, 1), M['iron'], metal_attrs(), wrap=False)   # (a flat tie bar)
    sky(skyg, M['sky'], x0, x1, z0, z1, R - 0.012)

def win_dormer(M, G, open_, R):
    """deep in a boarded dormer: a six-light side-hung casement, its stay and catch, a rough window board; a faded cotton
       curtain on a sagging wire, pushed to one side"""
    ow, oh, sill = open_; x0, x1, z0, z1 = -ow / 2, ow / 2, sill, sill + oh
    root, frame, glass, skyg, cur = G['root'], G['frame'], G['glass'], G['sky'], G['curtain']
    fy = 0.25; wall_face(root, M['wall'], (x0, x1, z0, z1))
    # the dormer's boarded cheeks and soffit (baked: boards, not the wall)
    for sx, x in ((1, x0), (-1, x1)):
        for k in range(5):
            za, zb = z0 + oh * k / 5, z0 + oh * (k + 1) / 5 - 0.003
            frame.add(block((min(x, x - sx * 0.018), 0.0, za), (max(x, x - sx * 0.018), fy, zb), 0.0015, 1), M['boards'], wood_attrs((0, 1, 0), (sx, 0, 0)), wrap=False)
    for k in range(3):
        xa, xb = x0 + ow * k / 3, x0 + ow * (k + 1) / 3 - 0.003
        frame.add(block((xa, 0.0, z1), (xb, fy, z1 + 0.018), 0.0015, 1), M['boards'], wood_attrs((0, 1, 0), (0, 0, -1)), wrap=False)
    board(frame, M['boards'], x0 - 0.05, x1 + 0.05, z0, -0.03, fy, 0.026, 0.004)
    fr = 0.05
    for (a, b, c, d) in ((x0, x0 + fr, z0, z1), (x1 - fr, x1, z0, z1), (x0, x1, z0, z0 + fr), (x0, x1, z1 - fr, z1)):
        frame.add(block((a, fy, c), (b, fy + 0.055, d), 0.004, 1), M['wood'], wood_attrs((0, 0, 1) if (b - a) < (d - c) else (1, 0, 0), (0, -1, 0)), wrap=False)
    sash(frame, M['wood'], x0 + fr + 0.002, x1 - fr - 0.002, z0 + fr + 0.002, z1 - fr - 0.002, fy - 0.006, 0.042, 2, 3, 0.042, 0.042, 0.055, 0.02, glass=glass, glass_mat=M['glass'])
    tube(frame, M['iron'], [Vector((x0 + fr + 0.02, fy - 0.012, z0 + fr + 0.02)), Vector((x0 + fr + 0.22, fy - 0.012, z0 + fr + 0.02))], 0.004, 6)   # (the stay)
    for xp in (x0 + fr + 0.08, x0 + fr + 0.16):
        frame.add(lathe_bm([(0.0, 0.005), (1.0, 0.004)], (xp, fy - 0.006, z0 + fr - 0.01), (xp, fy - 0.022, z0 + fr - 0.01), 8), M['iron'], metal_attrs(), wrap=False)
    frame.add(plate(rounded(0.016, 0.06, 0.004, 2, x1 - fr - 0.025, (z0 + z1) / 2), fy - 0.006, 0.003), M['iron'], metal_attrs(), wrap=False)   # (the catch)
    tube(frame, M['iron'], [Vector((x1 - fr - 0.025, fy - 0.01, (z0 + z1) / 2)), Vector((x1 - fr - 0.06, fy - 0.03, (z0 + z1) / 2 - 0.01))], 0.004, 6)
    sky(skyg, M['sky'], x0, x1, z0, z1, R - 0.012)
    # the curtain: on a wire that sags, most of it pushed to the left
    wy, wz = -0.05, z1 + 0.06
    sag = lambda u: -0.025 * math.sin(math.pi * u)
    tube(cur, M['iron'], [Vector((x0 - 0.12 + (ow + 0.24) * k / 8, wy, wz + sag(k / 8))) for k in range(9)], 0.0015, 4)
    for x, sx in ((x0 - 0.1, 1), (x1 + 0.1, -1)): cur.add(lathe_bm([(0.0, 0.004), (1.0, 0.003)], (x, 0.0, wz + 0.005), (x, wy - 0.006, wz), 6), M['iron'], metal_attrs(), wrap=False)
    W0 = 0.36; xo = x0 - 0.1
    def f(s, t):
        u = (s * W0 + 0.02) / (ow + 0.24); zt_ = wz + sag(u) - 0.01; z = zt_ - t * (zt_ - z0 + 0.02)
        wav = s * 6 * 2 * math.pi + 0.6 * mnoise.noise(Vector((s * 3, t * 2, 4.0)))
        d = 0.03 * (1 - 0.4 * t)
        return Vector((xo + s * W0 * (1 + 0.12 * t), wy - 0.004 - d * (0.5 - 0.5 * math.cos(wav)), z)), (s * W0 * 1.8, t * 1.2, 9.1)
    bm, FC = cloth_grid(22, 20, f); add_cloth(cur, M['cloth'], bm, FC, 11)

def circle_wall(G, mat, cz, r, n=48, half=0.5):
    """the wall face with a round hole of radius r at height cz: quads from the circle out to a square, the rest rectangles"""
    w = FW / 2
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        def sq(a):
            c, s = math.cos(a), math.sin(a); m = max(abs(c), abs(s)); return (half * c / m, half * s / m)
        p0 = (r * math.cos(a0), r * math.sin(a0)); p1 = (r * math.cos(a1), r * math.sin(a1)); q0, q1 = sq(a0), sq(a1)
        pts = [(p0[0], 0, cz + p0[1]), (q0[0], 0, cz + q0[1]), (q1[0], 0, cz + q1[1]), (p1[0], 0, cz + p1[1])]
        G.add(quad_bm(pts, (0, -1, 0)), mat, attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    wall_face(G, mat, (-half, half, cz - half, cz + half))

def win_oculus(M, G, open_, R):
    """a round window: the deep round reveal, a moulded timber ring, a cross of glazing bars and an inner ring"""
    ow, oh, sill = open_; r = ow / 2; cz = sill + r
    root, frame, glass, skyg = G['root'], G['frame'], G['glass'], G['sky']
    circle_wall(root, M['wall'], cz, r)
    fy = 0.22; n = 48
    for k in range(n):                                       # (the reveal: a short tube, WallSurface)
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        pts = [(r * math.cos(a0), 0, cz + r * math.sin(a0)), (r * math.cos(a0), fy, cz + r * math.sin(a0)), (r * math.cos(a1), fy, cz + r * math.sin(a1)), (r * math.cos(a1), 0, cz + r * math.sin(a1))]
        root.add(quad_bm(pts, (-math.cos((a0 + a1) / 2), 0, -math.sin((a0 + a1) / 2))), M['wall'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    prof = [(0.0, 0.0), (0.0, 0.01), (0.006, 0.018), (0.014, 0.022), (0.05, 0.022), (0.055, 0.02), (0.058, 0.012), (0.06, 0.0)]   # (d in, h toward the room)
    bm = bmesh.new(); V = [[bm.verts.new((( r - d) * math.cos(2 * math.pi * k / n), fy - h, cz + (r - d) * math.sin(2 * math.pi * k / n))) for k in range(n)] for d, h in prof]
    for j in range(len(prof) - 1):
        for k in range(n):
            vs = [V[j][k], V[j][(k + 1) % n], V[j + 1][(k + 1) % n], V[j + 1][k]]; f = bm.faces.new(vs); f.normal_update()
            mid = sum((v_.co for v_ in vs), Vector()) / 4; inward = -Vector((mid.x, 0, mid.z - cz)).normalized()
            if f.normal.dot(seg_hint(prof[j], prof[j + 1], inward, Vector((0, -1, 0)))) < 0: f.normal_flip()
    frame.add(bm, M['wood'], wood_attrs((0, 0, 1), (0, -1, 0)), smooth=True, wrap=False)
    ri = r - 0.06
    for a in (0.0, math.pi / 2):                             # (the cross of bars)
        c, s = math.cos(a), math.sin(a)
        lo = Vector((-ri * c, fy - 0.012, cz - ri * s)); hi = Vector((ri * c, fy + 0.03, cz + ri * s))
        bx = block((min(lo.x, hi.x) - 0.011 * s, fy - 0.012, min(lo.z, hi.z) - 0.011 * c), (max(lo.x, hi.x) + 0.011 * s, fy + 0.03, max(lo.z, hi.z) + 0.011 * c), 0.003, 1)
        frame.add(bx, M['wood'], wood_attrs((c, 0, s), (0, -1, 0)), wrap=False)
    G['_disc'] = (cz, ri, fy + 0.02)
    gb = bmesh.new(); cv = gb.verts.new((0, fy + 0.02, cz)); ring_ = [gb.verts.new((ri * math.cos(2 * math.pi * k / n), fy + 0.02, cz + ri * math.sin(2 * math.pi * k / n))) for k in range(n)]
    for k in range(n):
        f = gb.faces.new((cv, ring_[(k + 1) % n], ring_[k])); f.normal_update()
        if f.normal.y > 0: f.normal_flip()
    glass.add(gb, M['glass'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    sb = bmesh.new(); cv = sb.verts.new((0, R - 0.012, cz)); ring_ = [sb.verts.new((r * math.cos(2 * math.pi * k / n), R - 0.012, cz + r * math.sin(2 * math.pi * k / n))) for k in range(n)]
    for k in range(n):
        f = sb.faces.new((cv, ring_[(k + 1) % n], ring_[k])); f.normal_update()
        if f.normal.y > 0: f.normal_flip()
    skyg.add(sb, M['sky'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    for k in range(n):                                       # (the reveal on from the ring to the sky, outside)
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        pts = [(r * math.cos(a0), fy + 0.0, cz + r * math.sin(a0)), (r * math.cos(a0), R - 0.012, cz + r * math.sin(a0)), (r * math.cos(a1), R - 0.012, cz + r * math.sin(a1)), (r * math.cos(a1), fy, cz + r * math.sin(a1))]
        root.add(quad_bm(pts, (-math.cos((a0 + a1) / 2), 0, -math.sin((a0 + a1) / 2))), M['wall'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)

def win_industrial(M, G, open_, R):
    """a steel window: 6 x 6 small panes in T-section bars, a centre pivot vent, putty, three panes broken (shards left in the
       putty), a concrete-capped sill; a sacking curtain on a wire over the broken corner, swaying (shape keys)"""
    ow, oh, sill = open_; x0, x1, z0, z1 = -ow / 2, ow / 2, sill, sill + oh
    root, frame, glass, skyg, cur = G['root'], G['frame'], G['glass'], G['sky'], G['curtain']
    fy = 0.14; wall_face(root, M['wall'], (x0, x1, z0, z1)); reveal(root, M['wall'], x0, x1, z0, z1, fy, sill=False)
    board(frame, M['sill'], x0 - 0.04, x1 + 0.04, z0, -0.04, fy, 0.035, 0.003)
    nc, nr = 6, 6; of = 0.035; bw = 0.022; cw = (ow - 2 * of - (nc - 1) * bw) / nc; chh = (oh - 2 * of - (nr - 1) * bw) / nr
    st = M['steel_paint']
    for (a, b, c, d) in ((x0, x0 + of, z0, z1), (x1 - of, x1, z0, z1), (x0, x1, z0, z0 + of), (x0, x1, z1 - of, z1)):
        frame.add(block((a, fy, c), (b, fy + 0.035, d), 0.0015, 1), st, metal_attrs(), wrap=False)
    for i in range(1, nc):
        x = x0 + of + i * cw + (i - 0.5) * bw
        frame.add(block((x - bw / 2, fy + 0.004, z0 + of), (x + bw / 2, fy + 0.008, z1 - of), 0.001, 1), st, metal_attrs(), wrap=False)
        frame.add(block((x - 0.003, fy + 0.008, z0 + of), (x + 0.003, fy + 0.03, z1 - of), 0.0008, 1), st, metal_attrs(), wrap=False)
    for j in range(1, nr):
        z = z0 + of + j * chh + (j - 0.5) * bw
        frame.add(block((x0 + of, fy + 0.004, z - bw / 2), (x1 - of, fy + 0.008, z + bw / 2), 0.001, 1), st, metal_attrs(), wrap=False)
        frame.add(block((x0 + of, fy + 0.008, z - 0.003), (x1 - of, fy + 0.03, z + 0.003), 0.0008, 1), st, metal_attrs(), wrap=False)
    # the pivot vent: the middle two columns, rows 3-4, its own frame standing a little proud
    vx0 = x0 + of + 2 * (cw + bw) - bw / 2; vx1 = vx0 + 2 * cw + 2 * bw; vz0 = z0 + of + 2 * (chh + bw) - bw / 2; vz1 = vz0 + 2 * chh + 2 * bw
    for (a, b, c, d) in ((vx0, vx0 + 0.02, vz0, vz1), (vx1 - 0.02, vx1, vz0, vz1), (vx0, vx1, vz0, vz0 + 0.02), (vx0, vx1, vz1 - 0.02, vz1)):
        frame.add(block((a, fy - 0.004, c), (b, fy + 0.004, d), 0.001, 1), st, metal_attrs(), wrap=False)
    frame.add(plate(rounded(0.04, 0.03, 0.005, 2, (vx0 + vx1) / 2, vz0 + 0.03), fy - 0.004, 0.004), st, metal_attrs(), wrap=False)
    tube(frame, st, [Vector(((vx0 + vx1) / 2, fy - 0.008, vz0 + 0.03)), Vector(((vx0 + vx1) / 2, fy - 0.03, vz0 + 0.0))], 0.004, 6)
    broken = {(0, 1), (1, 1), (0, 2)}                         # (the bottom-left corner: someone threw something)
    gy = fy + 0.012
    for i in range(nc):
        for j in range(nr):
            a = x0 + of + i * (cw + bw); c = z0 + of + j * (chh + bw)
            if (i, j) not in broken: pane(glass, M['glass'], a - 0.002, a + cw + 0.002, c - 0.002, c + chh + 0.002, gy); continue
            rnd = random.Random(i * 7 + j)                    # (shards left in the putty round the edge)
            for edge in range(4):
                n = rnd.randint(1, 3)
                for k in range(n):
                    u0 = rnd.uniform(0.0, 0.7); u1 = min(1.0, u0 + rnd.uniform(0.15, 0.4)); hgt = rnd.uniform(0.02, 0.09)
                    um = (u0 + u1) / 2 + rnd.uniform(-0.1, 0.1)
                    if edge == 0: P = [(a + u0 * cw, c), (a + u1 * cw, c), (a + um * cw, c + hgt)]
                    elif edge == 1: P = [(a + cw, c + u0 * chh), (a + cw, c + u1 * chh), (a + cw - hgt, c + um * chh)]
                    elif edge == 2: P = [(a + u1 * cw, c + chh), (a + u0 * cw, c + chh), (a + um * cw, c + chh - hgt)]
                    else: P = [(a, c + u1 * chh), (a, c + u0 * chh), (a + hgt, c + um * chh)]
                    for s in (-1, 1):
                        bm = bmesh.new(); vs = [bm.verts.new((px, gy + s * 0.0015, pz_)) for px, pz_ in P]; f = bm.faces.new(vs); f.normal_update()
                        if f.normal.y * s < 0: f.normal_flip()
                        glass.add(bm, M['glass'], attrs_of(lambda c_: tuple(c_), 0.5), wrap=False)
    sky(skyg, M['sky'], x0, x1, z0, z1, R - 0.012)
    # the sacking: hung on a wire over the left half, its bottom free (the sway keys move it)
    wy, wz = -0.07, z1 + 0.08
    tube(cur, M['iron'], [Vector((x0 - 0.1, wy, wz)), Vector((0.15, wy, wz - 0.01))], 0.0018, 4)
    W0 = 1.0
    def f(s, t):
        z = wz - 0.01 - t * (wz - z0 - 0.15) - 0.03 * t * math.sin(s * 7.0)
        wav = s * 9 * 2 * math.pi + 0.8 * mnoise.noise(Vector((s * 4, t * 2, 7.0)))
        d = 0.02 + 0.015 * t
        return Vector((x0 - 0.08 + s * W0 * (1 - 0.08 * t), wy - 0.004 - d * (0.5 - 0.5 * math.cos(wav)), z)), (s * W0 * 1.3, t * 2.0, 5.5)
    bm, FC = cloth_grid(30, 30, f); add_cloth(cur, M['cloth'], bm, FC, 21)
    G['_sway'] = (wz, z0 + 0.15)

# ================================================================ materials
def velvet(name, base='#7e4650', fade=0.55, age=1.2):
    """lined velvet curtains: the pile catching the light along the folds, crushed in patches, its colour gone pale and grey on
       the leading edges and down the side that faced the window, dust thick on the top of every fold, the hem grubby"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); u, v, w = sep(m, g); c = lin(base)
    cav = m.math('ADD', m.cavity(), 0.0)
    pile = m.noise(m.map(g, (1, 1, 1)), 9, 5, 0.6, 0.6)
    col = m.mix(m.remap(pile, 0.35, 0.65), m.hsv(m.mix(0.0, c, c), 0.5, 1.05, 0.72), m.hsv(m.mix(0.0, c, c), 0.5, 0.88, 1.32))
    crush = m.remap(m.noise(m.map(g, (1, 1, 1)), 2.2, 4, 0.55), 0.55, 0.75)
    col = m.mix(m.math('MULTIPLY', crush, 0.5), col, m.hsv(col, 0.5, 0.8, 1.35))
    wv = m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', u, 2200.0)))     # (the backing's weave where the pile has gone)
    nrm = sep(m, m.geo('Normal'))
    face_win = m.remap(nrm[1], 0.2, 0.9, 0.0, 1.0)                              # (the side toward the glass)
    edge = m.math('MAXIMUM', m.remap(u, 0.05, 0.0), m.remap(v, 0.04, 0.0))
    fd = m.math('MULTIPLY', m.math('ADD', m.math('MULTIPLY', face_win, 0.8), m.remap(m.noise(op, 1.5, 3), 0.4, 0.75, 0.0, 0.5)), fade)
    col = m.mix(fd, col, m.hsv(col, 0.5, 0.55, 1.5))
    bald = m.math('MULTIPLY', m.remap(m.noise(op, 6, 4, 0.6), 0.62, 0.7), age)
    col = m.mix(bald, col, m.hsv(col, 0.5, 0.6, 1.05))
    hem = m.remap(sep(m, op)[2], 0.25, 0.0, smooth=True)
    col = m.mix(m.math('MULTIPLY', hem, m.remap(m.noise(op, 8, 4), 0.35, 0.7, 0.2, 0.7)), col, m.hsv(col, 0.5, 0.7, 0.55))
    up = m.remap(nrm[2], 0.25, 0.85, smooth=True)
    dust = m.math('MULTIPLY', up, m.remap(m.noise(op, 30, 4, 0.6), 0.3, 0.75, 0.4, 0.95))
    col = m.mix(dust, col, lin('#8b8478'))
    gr = m.remap(cav, 0.9, 0.5, smooth=True); col = m.mix(m.math('MULTIPLY', gr, 0.6), col, m.hsv(col, 0.5, 1.0, 0.5))
    rough = m.mixf(m.math('MULTIPLY', crush, 0.6), 0.86, 0.72); rough = m.mixf(dust, rough, 0.95)
    h = m.math('ADD', m.math('MULTIPLY', pile, 0.0003), m.math('MULTIPLY', wv, 0.00005))
    return finish(m, col, rough, h)

def damask_cloth(name, ground='#5e1d22', figure='#7a2a2e', age=1.2):
    """a silk-and-wool damask: the figure woven in the same colour but a different sheen (satin on a matte ground), faded"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); u, v, w = sep(m, g)
    cav = m.math('ADD', m.cavity(), 0.0)
    path = os.path.join(TMP, 'damask_cloth.png')              # (the house's damask ornament, woven: a 0.45 x 0.48 m repeat)
    if not os.path.exists(path):
        from PIL import Image
        import numpy as np
        Image.fromarray((np.clip(S.damask(512), 0, 1) * 255).astype('uint8')).save(path)
    tx = m.n('ShaderNodeTexImage', interpolation='Linear', extension='REPEAT'); tx.image = bpy.data.images.load(path, check_existing=True); tx.image.colorspace_settings.name = 'Non-Color'
    m.l(comb(m, m.math('DIVIDE', u, 0.45), m.math('DIVIDE', v, 0.48), 0.0), tx.inputs['Vector'])
    mot = m.remap(sep(m, tx.outputs['Color'])[0], 0.3, 0.7)
    col = m.mix(mot, lin(ground), lin(figure))
    nrm = sep(m, m.geo('Normal'))
    col = m.mix(m.math('MULTIPLY', m.remap(nrm[1], 0.2, 0.9), 0.55 * age), col, m.hsv(col, 0.5, 0.6, 1.5))
    hem = m.remap(sep(m, op)[2], 0.25, 0.0, smooth=True)
    col = m.mix(m.math('MULTIPLY', hem, 0.4), col, m.hsv(col, 0.5, 0.7, 0.6))
    up = m.remap(nrm[2], 0.25, 0.85, smooth=True); dust = m.math('MULTIPLY', up, m.remap(m.noise(op, 30, 4, 0.6), 0.3, 0.75, 0.4, 0.95))
    col = m.mix(dust, col, lin('#857e72'))
    col = m.mix(m.math('MULTIPLY', m.remap(cav, 0.9, 0.5, smooth=True), 0.6), col, m.hsv(col, 0.5, 1.0, 0.5))
    rough = m.mixf(mot, 0.82, 0.48); rough = m.mixf(dust, rough, 0.95)
    return finish(m, col, rough, m.math('MULTIPLY', mot, 0.00008))

def lace_mat(name, thread='#e9dfcb', age=1.3):
    """machine lace: a hexagonal net with denser floral medallions and a border, yellowed, greyed with dust toward the hem, a
       few tears and mildew spots; the holes are cut out (the ALPHA node: baked into the albedo's alpha)"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); u, v, w = sep(m, g)
    # the net: hexagonal cells ~7 mm, threads 1 mm
    cell = m.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=1.0, i_Randomness=0.0); m.l(comb(m, m.math('MULTIPLY', u, 140.0), m.math('MULTIPLY', v, 160.0), 0.0), cell.inputs['Vector'])
    net = m.remap(cell.outputs['Distance'], 0.11, 0.06)
    # medallions in a half-drop repeat (12 x 16 cm), petals and a ring; a scalloped border along the hem
    mu = m.math('FRACT', m.math('MULTIPLY', u, 1 / 0.12)); mv = m.math('FRACT', m.math('ADD', m.math('MULTIPLY', v, 1 / 0.16), m.math('MULTIPLY', m.math('FLOOR', m.math('MULTIPLY', u, 1 / 0.12)), 0.5)))
    dx = m.math('MULTIPLY', m.math('SUBTRACT', mu, 0.5), 0.12); dy = m.math('MULTIPLY', m.math('SUBTRACT', mv, 0.5), 0.16)
    r = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', dx, dx), m.math('MULTIPLY', dy, dy))); th = m.math('ARCTAN2', dy, dx)
    petal = m.remap(m.math('DIVIDE', r, m.math('MULTIPLY', m.math('ADD', 0.55, m.math('MULTIPLY', m.math('ABSOLUTE', m.math('COSINE', m.math('MULTIPLY', th, 3.0))), 0.45)), 0.032)), 1.0, 0.85)
    eye = m.remap(r, 0.006, 0.004); ringm = m.math('MULTIPLY', m.remap(r, 0.038, 0.04), m.remap(r, 0.046, 0.044))
    holes_in = m.math('MULTIPLY', m.remap(r, 0.012, 0.0115), m.remap(r, 0.016, 0.0165))
    solid = m.math('MAXIMUM', m.math('SUBTRACT', petal, m.math('ADD', eye, holes_in)), ringm)
    border = m.math('MAXIMUM', m.math('MULTIPLY', m.remap(v, 0.925, 0.93), m.remap(v, 0.975, 0.97)), m.math('MULTIPLY', m.remap(v, 0.94, 0.945), m.remap(v, 0.955, 0.95)))
    dens = m.math('MAXIMUM', m.math('MAXIMUM', m.math('MULTIPLY', solid, 0.9), m.math('MULTIPLY', border, 0.92)), m.math('ADD', 0.1, m.math('MULTIPLY', net, 0.22)))   # (the net a veil)
    tear = m.remap(m.noise(m.map(g, (1, 1, 1)), 3.0, 3, 0.6), 0.71, 0.73)         # (a few tears)
    alpha = m.math('MULTIPLY', dens, m.math('SUBTRACT', 1.0, tear))
    a_node = m.n('ShaderNodeMath', operation='MULTIPLY', name='ALPHA', label='ALPHA'); m.l(alpha, a_node.inputs[0]); a_node.inputs[1].default_value = 1.0
    c = lin(thread)
    col = m.mix(m.remap(m.noise(op, 2.0, 3), 0.3, 0.75, 0.0, 0.5 * age), c, m.mix(1.0, m.mix(0.0, c, c), (0.88, 0.8, 0.64), 'MULTIPLY'))
    col = m.mix(m.math('MULTIPLY', m.remap(v, 0.4, 1.0), 0.6), col, m.hsv(col, 0.5, 0.6, 0.62))   # (dust and grime toward the hem)
    mild = m.math('MULTIPLY', m.remap(m.noise(op, 18, 4), 0.66, 0.72), m.remap(v, 0.5, 1.0))
    col = m.mix(mild, col, (0.18, 0.17, 0.12))
    col = m.mix(m.math('MULTIPLY', solid, 0.2), col, m.hsv(col, 0.5, 1.0, 1.1))
    return finish(m, col, 0.9, m.math('MULTIPLY', solid, 0.0002))

def cotton(name, base='#a8a38e', check='#7f6b56', age=1.4):
    """a faded cotton curtain: a woven check gone soft, sun-bleached, water-stained, frayed at the hem"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); u, v, w = sep(m, g)
    ck = m.math('MULTIPLY', m.remap(m.math('SINE', m.math('MULTIPLY', u, 2 * math.pi / 0.025)), 0.3, 0.6), m.remap(m.math('SINE', m.math('MULTIPLY', v, 2 * math.pi / 0.025)), 0.3, 0.6))
    col = m.mix(m.math('MULTIPLY', ck, 0.6), lin(base), lin(check))
    wv = m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', u, 1800.0)))
    col = m.mix(m.remap(wv, 0.0, 1.0, 0.06, 0.0), col, m.hsv(col, 0.5, 1.0, 0.8))
    nrm = sep(m, m.geo('Normal'))
    col = m.mix(m.math('MULTIPLY', m.remap(nrm[1], 0.0, 0.9), 0.6 * age), col, m.hsv(col, 0.5, 0.5, 1.3))
    st = m.voronoi(op, 4.0, 'Distance'); tide = m.math('MULTIPLY', m.remap(st, 0.14, 0.16), m.remap(st, 0.19, 0.17))
    col = m.mix(m.math('MULTIPLY', m.math('ADD', tide, m.remap(st, 0.17, 0.08, 0.0, 0.25)), m.remap(m.noise(op, 2, 2), 0.5, 0.62)), col, m.mix(1.0, col, (0.62, 0.5, 0.34), 'MULTIPLY'))
    col = m.mix(m.math('MULTIPLY', m.remap(v, 0.7, 1.0), 0.5), col, m.hsv(col, 0.5, 0.7, 0.6))
    return finish(m, col, 0.9, m.math('MULTIPLY', wv, 0.00008))

def sacking(name, base='#7b6a4f', age=1.6):
    """hessian sacking: a coarse open weave, slubs, darned and holed, grimy, a faded stencil on it"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); u, v, w = sep(m, g)
    wa = m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', u, 2 * math.pi / 0.0035))); we = m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', v, 2 * math.pi / 0.0035)))
    thread = m.math('MAXIMUM', wa, we); slub = m.noise(m.map(g, (30, 300, 30)), 1.0, 3)
    col = m.mix(m.remap(thread, 0.2, 1.0, 0.35, 0.0), lin(base), m.hsv(m.mix(0.0, lin(base), lin(base)), 0.5, 1.0, 0.45))
    col = m.mix(m.remap(slub, 0.4, 0.7, 0.0, 0.3), col, m.hsv(col, 0.5, 0.85, 1.25))
    col = m.mix(m.remap(m.noise(op, 2.5, 4, 0.6), 0.35, 0.8, 0.0, 0.6 * age), col, m.hsv(col, 0.5, 0.75, 0.55))
    sten = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', v, 0.7)), 0.09, 0.08), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', u, 0.5)), 0.24, 0.23)),
                      m.remap(m.math('SINE', m.math('MULTIPLY', u, 60.0)), 0.0, 0.4))
    col = m.mix(m.math('MULTIPLY', sten, m.remap(m.noise(op, 9, 3), 0.3, 0.6, 0.2, 0.7)), col, lin('#2c2a28'))
    hole = m.remap(m.noise(m.map(g, (1, 1, 1)), 4.0, 3, 0.6), 0.72, 0.735)
    a_node = m.n('ShaderNodeMath', operation='SUBTRACT', name='ALPHA', label='ALPHA'); a_node.inputs[0].default_value = 1.0; m.l(hole, a_node.inputs[1])
    return finish(m, col, 0.95, m.math('ADD', m.math('MULTIPLY', thread, 0.0004), m.math('MULTIPLY', slub, 0.0003)))

def materials(win):
    k = win; st = PIECES[win]['style']
    M = {'glass': kitlib.glass(), 'wall': kitlib.reserved('WallSurface', (0.55, 0.5, 0.45)), 'sky': kitlib.reserved('SkyPlane', (0.1, 0.12, 0.18)),
         'brass': kitlib.metal(k + '_brass', 'brass', color='#9a7a45', rust=0.0, age=1.3), 'iron': kitlib.metal(k + '_iron', 'iron', rust=0.7, age=1.4)}
    E = None
    if st == 'wood':
        M['wood'] = Dr.paint(k + '_paint', ['#d9cfb6', '#6f7d5f', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.9, gloss=0.3, age=1.4, craze=1.2, joints=False)
        M['cloth'] = velvet(k + '_velvet', '#8f5d66'); M['lace'] = lace_mat(k + '_lace'); M['cord'] = velvet(k + '_cord', '#6a3a42', fade=0.3)
        M['pole'] = kitlib.wood(k + '_pole', 'mahogany', 'varnish', stain='#3e2214', age=1.2)
    elif st == 'tile':
        M['wood'] = Dr.paint(k + '_paint', ['#e0d8c4', '#a19884', '#8a5a3c'], 'pine', [], kick=0.0, chips=0.7, gloss=0.28, age=1.2, craze=1.0, joints=False)
        M['shutter'] = Dr.mahogany(k + '_mahogany', [], kick=0.0)
        M['cloth'] = damask_cloth(k + '_damask'); M['cord'] = velvet(k + '_cord', '#6b5a2a', fade=0.2)
    elif st == 'concrete':
        M['wood'] = Dr.paint(k + '_paint', ['#3f4b3b', '#7a3b28', '#7a3b28'], 'deal', [], kick=0.0, chips=2.4, gloss=0.45, age=1.8, craze=1.4, joints=False)
    elif st == 'attic':
        M['wood'] = Dr.paint(k + '_paint', ['#d6ccb4', '#8a8a78', '#8a5a3c'], 'deal', [], kick=0.0, chips=2.0, gloss=0.4, age=1.7, craze=1.6, joints=False)
        M['boards'] = Dr.bare_boards(k + '_boards', 'deal', [], age=1.5, tone=0.62); M['cloth'] = cotton(k + '_cotton')
    else:
        M['steel_paint'] = Dr.paint(k + '_steel', ['#55625a', '#6d6f68', '#8a3c26'], 'steel', [], kick=0.0, chips=0.45, gloss=0.4, age=1.5, craze=0.2, joints=False, rust=0.5)
        M['sill'] = Dr.paint(k + '_sill', ['#4a564c', '#8b8a82', '#7a3b28'], 'pine', [], kick=0.0, chips=1.8, gloss=0.35, age=1.6, joints=False)
        M['cloth'] = sacking(k + '_sacking')
    return M

# ================================================================ build, bake, register
def bake_child(name, G, M, double=False, veil=None, px=PX):
    """one baked child: its own texture set, uv1 (a lightmap layout) too. veil: the material whose faces get a second, blended
       material on the same maps (lace: a see-through veil beside opaque velvet); cut-outs (holes in sacking) are clipped"""
    ob = G.build(name); mats = list(ob.data.materials)
    vf = [p.index for p in ob.data.polygons if veil is not None and mats[p.material_index] == veil]
    kitlib.unwrap([ob], margin=0.003, smart=True, angle=60)
    files = kitlib.bake_set([ob], name, px, 64)
    mat = kitlib.baked_material('Kit_' + name, files, double=double, alpha=False if vf else None)
    ob.data.materials.clear(); ob.data.materials.append(mat); idx = [0] * len(ob.data.polygons)
    if vf:
        ob.data.materials.append(kitlib.baked_material('Kit_' + name + '_veil', files, double=True, alpha='blend'))
        for i in vf: idx[i] = 1
    ob.data.polygons.foreach_set('material_index', idx)
    finish_obj(ob)
    return ob, files

def finish_obj(ob, uv1=True):
    for a in [a.name for a in ob.data.attributes if a.name in ATTRS]: ob.data.attributes.remove(ob.data.attributes[a])
    if not ob.data.uv_layers: ob.data.uv_layers.new(name='UVMap')
    if uv1:
        if len(ob.data.uv_layers) < 2: ob.data.uv_layers.new(name='UV1')
        ob.data.uv_layers.active_index = 1; kitlib.select([ob], ob)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_MARGIN_DIV=0.3)
        bpy.ops.object.mode_set(mode='OBJECT'); ob.data.uv_layers.active_index = 0; ob.data.uv_layers[0].active_render = True

BUILD = {'Win_sash': lambda M, G, p: win_sash(M, G, p['open'], p['R']), 'Win_tall': lambda M, G, p: win_sash(M, G, p['open'], p['R'], tall=True),
         'Win_cellar': lambda M, G, p: win_cellar(M, G, p['open'], p['R']), 'Win_cellar_short': lambda M, G, p: win_cellar(M, G, p['open'], p['R']),
         'Win_dormer': lambda M, G, p: win_dormer(M, G, p['open'], p['R']), 'Win_oculus': lambda M, G, p: win_oculus(M, G, p['open'], p['R']),
         'Win_industrial': lambda M, G, p: win_industrial(M, G, p['open'], p['R'])}

def build_window(win):
    t0 = time.time(); kitlib.reset(); p = PIECES[win]; M = materials(win)
    G = {k: S.Geo(1, 1, False, False) for k in ('root', 'frame', 'glass', 'sky', 'curtain')}
    BUILD[win](M, G, p)
    root = G['root'].build(win); finish_obj(root); root['kit'] = 'arch'
    kids = []; info = {}
    fr, f1 = bake_child(win + '_frame', G['frame'], M); kids.append(fr); info['frame'] = f1['times']['total']
    for key, nm in (('glass', '_glass'), ('sky', '_sky')):
        o = G[key].build(win + nm); finish_obj(o, uv1=False); kids.append(o)
    if G['curtain'].F and (win + '_curtain') in p.get('children', []):
        cu, f2 = bake_child(win + '_curtain', G['curtain'], M, double=True, veil=M.get('lace')); kids.append(cu); info['curtain'] = f2['times']['total']
        if '_sway' in G:                                     # (two shape keys: the free part swings into the room and back)
            ztop, zbot = G['_sway']; cu.shape_key_add(name='Basis')
            for i, (dy, dx) in enumerate(((-0.06, 0.03), (0.035, -0.02))):
                sk = cu.shape_key_add(name=f'sway{i}')
                for vtx in sk.data:
                    k_ = max(0.0, min(1.0, (ztop - 0.15 - vtx.co.z) / (ztop - 0.15 - zbot))) ** 1.6
                    vtx.co.y += dy * k_; vtx.co.x += dx * k_ * math.sin(vtx.co.z * 3.0)
    for o in kids: o.parent = root; o.matrix_parent_inverse.identity()
    tri = sum(kitlib.tris(o) for o in [root] + kids)
    parts = ', '.join((o.name[len(win):] or 'wall') + ' ' + str(kitlib.tris(o)) for o in [root] + kids)
    print(f'  {win}: {tri} triangles ({parts}), bakes {info}', flush=True)
    if '--sheets' in sys.argv: sheets(win, root, kids)
    json.dump({'tris': tri, 'bake': info}, open(os.path.join(TMP, f'{win}.json'), 'w'), indent=1)
    kitlib.register(win, [root])
    print(f'{win}: done in {time.time() - t0:.0f}s', flush=True)

# ================================================================ contact sheets
def sheets(win, root, kids):
    """the window in a corner of its style's room at night: moonlit sky behind (a stand-in for the game's sky shader), a warm
       lamp inside; front, three-quarter and close"""
    from PIL import Image
    st = PIECES[win]['style']; d = os.path.join(TMP, 'sheets', 'windows'); os.makedirs(d, exist_ok=True)
    man = S.manifest_load()['styles'].get(st, {}); sc = bpy.context.scene; tmp = []
    def keep(o): tmp.append(o); return o
    fl = S.ship_mat('sh_floor', man['floor']) if man.get('floor') else kitlib.grey()
    wA = S.ship_mat('sh_wallA', man['wall'], 0) if man.get('wall') else kitlib.grey()
    sc.world.color = (0.03, 0.035, 0.05)
    for i in range(-1, 2): keep(S.quad(f'sh_f{i}', (i * FW - FW / 2, -2 * FW, 0), (FW, 0, 0), (0, 2 * FW, 0), mat=fl))
    for i in (-1, 1): keep(S.quad(f'sh_w{i}', (i * FW - FW / 2, 0, 0), (FW, 0, 0), (0, 0, FH), mat=wA))
    keep(S.quad('sh_side', (-1.5 * FW, -2 * FW, 0), (0, 2 * FW, 0), (0, 0, FH), mat=wA))
    ws = [i for i, m in enumerate(root.data.materials) if m.name == 'WallSurface']; old = list(root.data.materials)
    if ws:
        root.data.materials[ws[0]] = wA; uv = root.data.uv_layers[0].data
        for p in root.data.polygons:
            for li in p.loop_indices:
                c = root.data.vertices[root.data.loops[li].vertex_index].co; n = p.normal
                u_, v_ = 0.5 + c.x / FW, c.z / FH
                if abs(n.x) > 0.7: u_ = 0.5 + (c.x - math.copysign(1, n.x) * c.y) / FW
                elif abs(n.z) > 0.7: v_ = (c.z + math.copysign(1, n.z) * c.y) / FH
                uv[li].uv = (u_, v_)
    skym = kitlib.Mat('sh_skym')
    em = skym.n('ShaderNodeEmission'); em.inputs['Strength'].default_value = 0.5; em.inputs['Color'].default_value = (0.08, 0.11, 0.2, 1)   # (a night sky)
    skym.l(em.outputs[0], skym.out_node.inputs['Surface'])
    glm = kitlib.Mat('sh_glass'); glm.b.inputs['Transmission Weight'].default_value = 1.0; glm.b.inputs['Roughness'].default_value = 0.04; glm.b.inputs['Base Color'].default_value = (0.92, 0.95, 0.93, 1)
    swaps = []
    for o in kids:
        for i, m in enumerate(o.data.materials):
            if m.name == 'SkyPlane': swaps.append((o, i, m)); o.data.materials[i] = skym.m; o.visible_shadow = False
            elif m.name == 'Glass': swaps.append((o, i, m)); o.data.materials[i] = glm.m; o.visible_shadow = False
    moon = keep(S.lamp('sh_moon', 'SUN', 2.5, None, (math.radians(-70), 0, math.radians(15)), 0.02, (0.65, 0.75, 1.0)))
    moon.rotation_euler = (Vector((0, -1, -0.55))).to_track_quat('-Z', 'Y').to_euler()
    keep(S.lamp('sh_lamp', 'POINT', 60, (1.2, -2.2, 2.0), None, 0.15, (1.0, 0.78, 0.55)))
    keep(S.lamp('sh_fill', 'AREA', 40, (0.0, -3.0, 2.6), (math.radians(60), 0, 0), 2.0, (0.9, 0.85, 0.8)))
    shots = []
    S.cam_at((0.15, -3.6, 1.55), (0.0, 0.0, 1.6), 32); shots.append(S.render(os.path.join(d, f'{win}_front.png'), 1000, 1000, 160))
    S.cam_at((1.5, -2.2, 1.5), (0.0, 0.1, 1.55), 35); shots.append(S.render(os.path.join(d, f'{win}_angle.png'), 1100, 1000, 160))
    zc = PIECES[win]['open'][2] + PIECES[win]['open'][1] * 0.6
    S.cam_at((0.45, -0.95, zc), (0.0, 0.15, zc - 0.15), 40); shots.append(S.render(os.path.join(d, f'{win}_close.png'), 1100, 1000, 160))
    for o, i, m in swaps: o.data.materials[i] = m; o.visible_shadow = True
    if ws: root.data.materials[ws[0]] = old[ws[0]]
    for o in tmp:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o)
    ims = [Image.open(p).convert('RGB') for p in shots]; hgt = 700
    ims = [im.resize((int(im.width * hgt / im.height), hgt)) for im in ims]
    out = Image.new('RGB', (sum(i.width for i in ims), hgt)); x = 0
    for im in ims: out.paste(im, (x, 0)); x += im.width
    out.save(os.path.join(d, f'{win}.png'))

def main():
    for win in [w for w in PIECES if OPTS.want(w, PIECES[w]['style'])]:
        if kitlib.fresh_asset(win) and '--sheets' not in sys.argv: print(f'{win} up to date'); continue
        build_window(win)

if __name__ == '__main__':
    main()
