# Escape from Barbi Blue: the nursery's rocking chair (Solid_rocking_chair, wood style), the kit's hero smoke asset: the realism
# bar for the rest of the furniture. A Victorian spindle-back rocker of the Boston kind: bentwood rockers, turned legs, stretchers,
# stiles and spindles (lathe profiles with beads, vases and tenons buried in their sockets), a saddled seat rolled down at the
# front, a crest rail leaning back with the stiles and a carved fan and scrolls (a sculpted source baked into the normal map),
# scrolled arms on turned supports, and a faded velvet squab cushion, tufted, sagging where someone sat, tied to the stiles.
# Beech under a walnut stain and amber varnish, crazed, worn through to bare wood where hands and heads went (arms, crest, the
# stiles' tops), on the edges and the rocker bottoms; grime in every crevice; dust on whatever faces up.
# KIT: pocket slot, box 0.66 x 0.95 m, h 1.10; it rocks +-0.10 rad about the child Solid_rocking_chair_RockPivot (axis x, at
# seat height), staying inside its box grown by 0.05 m. One mesh, one material, a 2048 albedo / normal / ORM set (hi).
#   /tmp/claude-0/bpyenv/bin/python tools/blender/kit/rocking_chair.py [--preview] [--force]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, noise
import kitlib, defs
from kitlib import OPTS, TMP

NODE = 'Solid_rocking_chair'; PIVOT = NODE + '_RockPivot'; ASSET = 'rocking_chair'
PIV = Vector((0, 0, 0.42))                                 # (rocking about the sitter's hips: the tips and the crest stay in the box)
R, XR, YT = 1.1, 0.245, 0.4665                             # rocker radius, rocker centre x, how far the tips reach
LEAN = math.radians(23.0)                                  # the back's rake
SEAT_B = 0.388                                             # seat underside
random.seed(11)

def smooth(t): t = min(1.0, max(0.0, t)); return t * t * (3 - 2 * t)
def catmull(pts, t):
    """a smooth curve through pts (lists of floats) at t 0..1"""
    n = len(pts) - 1; f = min(n - 1e-9, max(0.0, t * n)); i = int(f); u = f - i
    p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(n, i + 2)]
    return [0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3) for a, b, c, d in zip(p0, p1, p2, p3)]

# ---------------------------------------------------------------- the seat (also what the cushion lies on)
SEAT_C = -0.05                                             # (the seat outline's centre line)
def seat_outline(u, n=3.6):
    a = u * 2 * math.pi; ex = lambda v: math.copysign(abs(v) ** (2 / n), v)
    y = SEAT_C + 0.225 * ex(math.sin(a)); hx = 0.255 - 0.04 * (y + 0.275) / 0.45
    return hx * ex(math.cos(a)), y
def seat_top(x, y):
    z = 0.428 - 0.016 * smooth((-0.19 - y) / 0.085) + 0.014 * smooth((y - 0.04) / 0.13)          # (front rolled down, back curled up)
    z -= 0.011 * sum(math.exp(-((x - sx) / 0.085) ** 2 - ((y + 0.03) / 0.11) ** 2) for sx in (-0.1, 0.1))   # (saddled: two hollows)
    return z

def seat(mats):
    cols = 36; rows = [(0.5, 'b', 0), (0.92, 'b', 0), (0.985, 'b', 0.0015), (1.0, 'b', 0.008), (1.006, 'm', 0), (1.0, 't', -0.008), (0.985, 't', -0.002)] + \
           [(r, 't', 0) for r in (0.95, 0.88, 0.78, 0.64, 0.46, 0.26)]
    P, G, W = [], [], []; off = (random.uniform(-3, 3), random.uniform(0.1, 0.2), random.uniform(-3, 3))
    for rho, kind, dz in rows:
        row, g, w = [], [], []
        for j in range(cols):
            ox, oy = seat_outline(j / cols); x, y = rho * ox, SEAT_C + rho * (oy - SEAT_C)
            top = seat_top(x, y); z = SEAT_B + dz if kind == 'b' else (top + dz if kind == 't' else (SEAT_B + top) / 2)
            row.append((x, y, z)); g.append((y + off[0], z + off[1], x + off[2]))                   # (grain side to side)
            w.append(0.55 * smooth((-0.215 - y) / 0.05) * (kind != 'b') + (0.25 if kind == 'm' else 0.0))
        P.append(row); G.append(g); W.append(w)
    return kitlib.surface('seat', P, G, W, None, wrap=True, caps=(True, True), mats=mats)

# ---------------------------------------------------------------- rockers
def rocker(side, mats):
    """a bentwood rocker: its bottom on the R arc (centre straight above the middle), tapering and rounding off at the tips"""
    S = YT * 1.02; best = None
    for _ in range(6):                                      # (find the arc length that puts the rounded tips at YT)
        path, secs = [], []; ks = [math.sin(math.pi / 2 * (2 * i / 33 - 1)) for i in range(34)]
        for k, f in enumerate(ks):
            s = f * S; ph = s / R; tip = max(0.0, (abs(s) - (S - 0.035)) / 0.035)
            pt = Vector((side * XR, R * math.sin(ph), R - R * math.cos(ph))); up = Vector((0, -math.sin(ph), math.cos(ph)))
            h = (0.050 - 0.011 * (abs(s) / S) ** 2.5) * math.sqrt(max(0.0, 1 - tip ** 2.2)) if tip < 1 else 0.0
            w = 0.026 * (math.sqrt(max(0.0, 1 - tip ** 3)) * 0.6 + 0.4)
            hh = max(0.004, h); path.append((pt + up * 0.0, Vector((1, 0, 0)), up)); secs.append((w, hh))
        ymax = max(abs(p[0].y) + 0.002 for p in path)
        S *= YT / ymax
    def sec(k):
        w, h = secs[k]; return kitlib.rounded_rect(w, h, min(0.006, h / 2.2, w / 2.2), 2, 0.0, h / 2, r_top=min(0.008, h / 2.1, w / 2.1))
    wear = lambda k, j, p: 0.85 if p.z < 0.012 + R - math.sqrt(max(0, R * R - p.y * p.y)) else 0.08
    return kitlib.sweep(f'rocker{side:+d}', path, sec, wear, caps=(True, True), mats=mats)

def arc_z(y): return R - math.sqrt(R * R - y * y)

# ---------------------------------------------------------------- turnings (profiles: t 0..1 along, radius m)
FRONT_LEG = [(0, .0105), (.058, .0105), (.064, .0152), (.085, .0168), (.105, .0152), (.118, .0176), (.132, .0150), (.20, .0162), (.33, .0190), (.45, .0203),
             (.55, .0192), (.63, .0158), (.68, .0134), (.71, .0163), (.73, .0184), (.755, .0164), (.79, .0141), (.82, .0166), (.84, .0172), (.87, .0150),
             (.94, .0136), (.955, .0112), (1, .0112)]
BACK_LEG = [(0, .0105), (.058, .0105), (.065, .0150), (.09, .0160), (.11, .0145), (.22, .0158), (.40, .0180), (.60, .0170), (.74, .0150), (.78, .0170),
            (.80, .0172), (.83, .0148), (.94, .0135), (.955, .0112), (1, .0112)]
STILE = [(0, .0118), (.06, .0118), (.068, .0165), (.09, .0182), (.105, .0170), (.12, .0186), (.14, .0166), (.19, .0172), (.30, .0186), (.45, .0175),
         (.60, .0160), (.72, .0150), (.80, .0142), (.84, .0158), (.855, .0164), (.87, .0150), (.90, .0140), (.93, .0152), (.945, .0154), (.96, .0140),
         (.975, .0120), (1, .0112), (1.0, .0112)]
SPINDLE = [(0, .0072), (.05, .0072), (.07, .0088), (.10, .0098), (.12, .0094), (.14, .0102), (.16, .0094), (.30, .0108), (.48, .0104), (.70, .0092),
           (.90, .0080), (.95, .0074), (1, .0072)]
ARM_POST = [(0, .0095), (.06, .0095), (.075, .0130), (.10, .0136), (.13, .0122), (.30, .0152), (.42, .0158), (.55, .0140), (.66, .0108), (.71, .0100),
            (.76, .0128), (.79, .0132), (.83, .0110), (.93, .0098), (1, .0092), (1.0, .0092)]
ARM_SPINDLE = [(0, .0068), (.08, .0068), (.12, .0082), (.40, .0092), (.70, .0084), (.90, .0072), (1, .0068), (1.0, .0068)]
FRONT_STRETCHER = [(0, .0078), (.05, .0078), (.10, .0098), (.22, .0110), (.30, .0100), (.33, .0124), (.36, .0102), (.42, .0130), (.50, .0150),
                   (.58, .0130), (.64, .0102), (.67, .0124), (.70, .0100), (.78, .0110), (.90, .0098), (.95, .0078), (1, .0078)]
SIDE_STRETCHER = [(0, .0074), (.06, .0074), (.12, .0092), (.30, .0108), (.50, .0120), (.70, .0108), (.88, .0092), (.94, .0074), (1, .0074), (1.0, .0074)]

def on_line(p0, p1, z):
    p0, p1 = Vector(p0), Vector(p1); t = (z - p0.z) / (p1.z - p0.z); return p0.lerp(p1, t)

# legs, stiles: (bottom, top) per side
def FL(s): return (s * 0.247, -0.215, 0.048), (s * 0.214, -0.200, 0.402)
def BL(s): return (s * 0.247, 0.205, 0.048), (s * 0.200, 0.128, 0.402)
def ST(s): return (s * 0.195, 0.123, 0.400), (s * 0.213, 0.384, 1.000)

# ---------------------------------------------------------------- crest rail
CREST_S = 0.27; CREST_T = 0.024
CREST_TOP = [(0, 1.100), (.06, 1.097), (.12, 1.085), (.17, 1.069), (.215, 1.066), (.245, 1.075), (.262, 1.078), (.27, 1.071)]
def crest_zt(s):
    a = abs(s); pts = CREST_TOP
    for i in range(len(pts) - 1):
        if a <= pts[i + 1][0] or i == len(pts) - 2:
            t = (a - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return catmull([[p[1]] for p in pts], (i + min(1, max(0, t))) / (len(pts) - 1))[0]
def crest_zb(s): return 0.982 + 0.010 * (1 - (s / CREST_S) ** 2)
def crest_yf(s): return 0.372 + 0.012 * (1 - (s / 0.21) ** 2)
D_UP = Vector((0, math.sin(LEAN), math.cos(LEAN))); D_N = Vector((0, math.cos(LEAN), -math.sin(LEAN)))   # (up the lean; back through it)

def crest_point(s, w, h):
    """s along (x), w through the board (0 front .. T back), h up the lean from the bottom edge"""
    return Vector((s, crest_yf(s), crest_zb(s))) + D_UP * h + D_N * w

def crest_section(H, n_corner, front_rows=0):
    """the crest's cross-section in (w, h): a rounded board T thick, H high; front_rows extra points up the front face"""
    r = 0.0045; pts = []
    def arc(cx, cy, a0):
        for i in range(n_corner): a = math.radians(a0 + 90 * i / (n_corner - 1)); pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    # anticlockwise seen from +s: front face (w = 0) going down, bottom, back face going up, top
    arc(r, H - r, 90); arc(r, r, 180)
    arc(CREST_T - r, r, 270); arc(CREST_T - r, H - r, 0)
    if front_rows:                                          # (more rows up the front face, for the carving)
        top = pts[n_corner - 1]; bot = pts[n_corner]
        mid = [(0.0, top[1] + (bot[1] - top[1]) * (i + 1) / (front_rows + 1)) for i in range(front_rows)]
        pts = pts[:n_corner] + mid + pts[n_corner:]
    return pts

def crest_mesh(name, ns, n_corner, front_rows, mats, carve=False, off=None):
    S = CREST_S; ss = [S * math.sin(math.pi / 2 * (2 * i / (ns - 1) - 1)) for i in range(ns)]
    P, G, W, UV, F = [], [], [], [], []
    for s in ss:
        H = (crest_zt(s) - crest_zb(s)) / math.cos(LEAN); sec = crest_section(H, n_corner, front_rows)
        end = max(0.0, (abs(s) - (S - 0.006)) / 0.006); k = math.sqrt(max(0.0, 1 - end * end)) if end > 0 else 1.0
        row, g, w, uv, fr = [], [], [], [], []; per = 0.0
        for j, (ww, hh) in enumerate(sec):
            cw, ch = CREST_T / 2, H / 2; ww2 = cw + (ww - cw) * k; hh2 = ch + (hh - ch) * k
            p = crest_point(s, ww2, hh2); front = ww < 1e-4 and 0.003 < hh < H - 0.003
            if carve and front: p += D_N * carving(s, hh, H)
            row.append(p); g.append((ww2 + off[0], hh2 + off[1], s + off[2]))
            w.append(min(1.0, 0.7 * smooth((hh - (H - 0.012)) / 0.01) * (1 - abs(s) / S) + 0.3 * smooth(1 - abs(s) / 0.08) * front + 0.25 * smooth((abs(s) - 0.235) / 0.03)))
            if j: per += math.hypot(sec[j][0] - sec[j - 1][0], sec[j][1] - sec[j - 1][1])
            uv.append((s, per)); fr.append(front)
        uv.append((s, per + math.hypot(sec[0][0] - sec[-1][0], sec[0][1] - sec[-1][1])))
        P.append(row); G.append(g); W.append(w); UV.append(uv)
    return kitlib.surface(name, P, G, W, UV, wrap=True, caps=(True, True), mats=mats)

# the carving: a fan (shell) of flutes in the middle of the front face, C-scrolls running out from it, a beaded line under the top
def _spiral(sign):
    pts = []
    for i in range(80):
        t = i / 79; a = math.pi * (0.15 + 2.2 * t); r = 0.012 * math.exp(-0.55 * a)
        pts.append((sign * (0.045 + 0.105 * t) + sign * r * math.cos(a) * 2.2, 0.026 + 0.022 * t ** 0.7 + r * math.sin(a) * 1.4))
    return pts
SCROLLS = [_spiral(1), _spiral(-1)]
def _dist_poly(px, py, poly):
    best = 9.0
    for (ax, ay), (bx, by) in zip(poly, poly[1:]):
        dx, dy = bx - ax, by - ay; t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-12)))
        best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
    return best
def carving(s, h, H):
    """how deep (m, into the board) the carving is at (s, h) on the front face"""
    d = 0.0; cx, cy = 0.0, 0.012; dx, dy = s - cx, h - cy; r = math.hypot(dx, dy)
    if dy > -0.004 and r < 0.072:                           # the fan: lobes between grooves, a scalloped rim, a dished boss at the root
        a = math.atan2(max(dy, 0.0), dx); N = 11; fl = abs(((a / math.pi) * N) % 1 - 0.5) * 2
        lobe = 0.0016 * (1 - fl ** 2) * smooth((0.072 - r) / 0.008) * smooth(r / 0.014)
        groove = 0.0022 * math.exp(-((1 - fl) / 0.09) ** 2) * smooth((0.068 - r) / 0.01) * smooth((r - 0.012) / 0.006)
        d = max(d, groove - lobe * 0.3 + 0.0006)
        rim = 0.068 * (1 + 0.05 * abs(math.sin(a * N))); d = max(d, 0.0024 * math.exp(-((r - rim) / 0.0018) ** 2))
        d = max(d, 0.0018 * math.exp(-(r / 0.009) ** 2))
    for poly in SCROLLS: d = max(d, 0.0019 * math.exp(-(_dist_poly(s, h, poly) / 0.0016) ** 2))
    if abs(s) < CREST_S - 0.03:                              # (the bead line following the top edge)
        d = max(d, 0.0012 * math.exp(-((h - (H - 0.016)) / 0.0011) ** 2))
    return d

# ---------------------------------------------------------------- arms
ARM_PTS = [(0.200, 0.240, 0.648), (0.236, 0.120, 0.645), (0.281, -0.050, 0.640), (0.298, -0.200, 0.634), (0.294, -0.310, 0.630), (0.282, -0.371, 0.627)]
def arm_path(side, n=26):
    out = []
    for i in range(n):
        p = Vector(catmull(ARM_PTS, i / (n - 1))); p.x *= side
        q = Vector(catmull(ARM_PTS, min(1, i / (n - 1) + 0.01))) if i < n - 1 else None
        q0 = Vector(catmull(ARM_PTS, max(0, i / (n - 1) - 0.01)))
        if q is None: q = p; q0.x *= side
        else: q.x *= side; q0.x *= side
        t = (q - q0).normalized(); sd = t.cross(Vector((0, 0, 1))).normalized(); up = sd.cross(t).normalized()
        out.append((p, sd, up))
    return out
def arm_at(y):
    best = min((abs(Vector(catmull(ARM_PTS, i / 400)).y - y), i) for i in range(401)); return Vector(catmull(ARM_PTS, best[1] / 400))

def arm(side, mats):
    path = arm_path(side); n = len(path)
    def sec(k):
        f = k / (n - 1); w = 0.042 + 0.026 * smooth((f - 0.55) / 0.3); th = 0.024 + 0.011 * smooth((f - 0.72) / 0.2)   # (a knuckle at the end)
        tip = max(0.0, (f - 0.92) / 0.08); w *= math.sqrt(max(0.02, 1 - tip ** 2)); th *= math.sqrt(max(0.05, 1 - tip ** 2.5))
        dz = -0.0055 * smooth((f - 0.72) / 0.2)
        return kitlib.rounded_rect(w, th, min(0.005, w / 2.2, th / 2.2), 2, 0.0, dz, r_top=min(0.010, w / 2.1, th / 2.05))
    def wear(k, j, p):                                      # (the hand rest's top and the knuckle, a little down the sides)
        f = k / (n - 1); top = j in (2, 3, 4, 5)
        return min(1.0, 0.8 * smooth((f - 0.6) / 0.3) * (1.0 if top else 0.3) + 0.6 * smooth((f - 0.9) / 0.08) + 0.06)
    return kitlib.sweep(f'arm{side:+d}', path, sec, wear, caps=(True, True), mats=mats)

# ---------------------------------------------------------------- cushion (a tufted squab tied to the stiles)
def cush_outline(u, n=3.0):
    a = u * 2 * math.pi; ex = lambda v: math.copysign(abs(v) ** (2 / n), v)
    y = -0.08 + 0.175 * ex(math.sin(a)); hx = 0.222 - 0.02 * (y + 0.255) / 0.35
    return hx * ex(math.cos(a)), y
TUFTS = [(-0.075, -0.14), (0.075, -0.14), (-0.075, -0.015), (0.075, -0.015)]
def sag(x, y): return 0.013 * math.exp(-(x / 0.12) ** 2 - ((y + 0.07) / 0.1) ** 2)
CUSH_ROWS = [(0.94, 0.002), (0.975, 0.005), (0.993, 0.012), (1.003, 0.017), (1.008, 0.0215), (1.003, 0.026), (0.99, 0.031)] + \
            [(r, None) for r in (0.965, 0.9, 0.78, 0.6, 0.38, 0.18)]
def cush_height(x, y, rho):
    return 0.031 + (0.049 - 0.031) * math.sqrt(max(0.0, 1 - (rho / 0.985) ** 2.6)) - sag(x, y) * smooth((1 - rho) / 0.35)

def cushion(name, cols, rows, mats, hp=False, off=None):
    P, G, W = [], [], []
    for rho, dz in rows:
        row, g, w = [], [], []
        for j in range(cols):
            ox, oy = cush_outline(j / cols); x, y = rho * ox, -0.08 + rho * (oy + 0.08)
            z = seat_top(x, y) + 0.003 + (dz if dz is not None else cush_height(x, y, rho))
            if hp and dz is None: z += cush_detail(x, y, rho)
            row.append((x, y, z)); g.append((x + off[0], y + off[1], z + off[2])); w.append(0.35 * math.exp(-(x / 0.12) ** 2 - ((y + 0.08) / 0.1) ** 2))
        P.append(row); G.append(g); W.append(w)
    return kitlib.surface(name, P, G, W, None, wrap=True, caps=(False, True), mats=mats)   # (open underneath: it lies on the seat)

def cush_detail(x, y, rho):
    """the sculpted top: tuft dimples with creases radiating from them, wrinkles where it sagged, puckers at the edge"""
    d = 0.0
    for tx, ty in TUFTS:
        dx, dy = x - tx, y - ty; r = math.hypot(dx, dy)
        d -= 0.0075 * math.exp(-(r / 0.014) ** 2)
        a = math.atan2(dy, dx)
        for k in range(4):                                   # (creases toward the neighbours and the corners)
            da = math.atan2(math.sin(a - (k * math.pi / 2 + math.pi / 4)), math.cos(a - (k * math.pi / 2 + math.pi / 4)))
            d -= 0.0022 * math.exp(-(da * r / 0.004) ** 2) * math.exp(-(r / 0.05) ** 2) * smooth(r / 0.012)
    n1 = noise.noise(Vector((x * 26, y * 9, 1.7))); n2 = noise.noise(Vector((x * 60, y * 60, 4.2)))
    d -= 0.0018 * max(0.0, n1) * smooth(sag(x, y) / 0.006) + 0.0004 * n2
    d -= 0.0016 * max(0.0, noise.noise(Vector((math.atan2(y + 0.08, x) * 9, 2.0, 0.5)))) * smooth((rho - 0.8) / 0.18)
    return d

def buttons(mats):
    objs = []
    for i, (tx, ty) in enumerate(TUFTS):
        rho = 0.5; z = seat_top(tx, ty) + 0.003 + cush_height(tx, ty, rho) - 0.0055
        prof = [(0, 0.0075), (0.35, 0.0072), (0.75, 0.0052), (1, 0.0001)]
        objs.append(kitlib.lathe(f'button{i}', prof, (tx, ty, z), (tx, ty, z + 0.0042), 10, (0, 1, 0), mats=mats, caps=(True, False)))
    return objs

def ties(mats):
    """a ribbon round each stile just above the cushion, a knot and two tails hanging, and the ribbon back to the cushion corner"""
    objs = []
    for s in (-1, 1):
        p0, p1 = (Vector(v) for v in ST(s)); ax = (p1 - p0).normalized(); z = 0.468; c = on_line(p0, p1, z)
        tr = (z - p0.z) / (p1.z - p0.z); r = np.interp(tr, [t for t, _ in STILE], [rr for _, rr in STILE]) + 0.0022
        u, v = kitlib.frame(ax, (0, -1, 0)); path = []
        for i in range(13):
            a = i / 12 * 2 * math.pi; pt = c + (u * math.cos(a) + v * math.sin(a)) * r
            tn = (-u * math.sin(a) + v * math.cos(a)); path.append((pt, ax, tn.cross(ax).normalized() * -1))
        objs.append(kitlib.sweep(f'tieband{s:+d}', path, lambda k: kitlib.rounded_rect(0.011, 0.0018, 0.0008, 1), caps=(False, False), mats=mats))
        knot = c + u * r + Vector((s * 0.004, -0.003, 0))
        objs.append(kitlib.lathe(f'tieknot{s:+d}', [(0, .001), (.2, .0042), (.5, .0055), (.8, .0042), (1, .001)], knot - Vector((0.0, 0.006, 0)), knot + Vector((0.0, 0.006, 0)), 8, (0, 0, 1), mats=mats))
        for k, (dx, ln) in enumerate(((0.006, 0.085), (-0.004, 0.065))):
            tp = []
            for i in range(6):
                f = i / 5; pt = knot + Vector((s * dx * f * 1.5, -0.006 - 0.012 * f * f, -ln * f)) + Vector((0, 0, 0.0))
                tp.append((pt, Vector((1, 0, 0)), Vector((0, -1, 0.15)).normalized()))
            objs.append(kitlib.sweep(f'tietail{s:+d}{k}', tp, lambda i: kitlib.rounded_rect(0.010 - 0.002 * i / 5, 0.0016, 0.0007, 1), caps=(True, True), mats=mats))
        cx, cy = cush_outline(0.25 - s * 0.13)[0] * 0.97, 0.075; cz = seat_top(cx, cy) + 0.035   # (this side's back corner)
        a0 = Vector((cx, cy, cz)); a1 = knot + Vector((0, 0.004, -0.002)); tp = []
        for i in range(6):
            f = i / 5; pt = a0.lerp(a1, f) + Vector((0, 0, 0.006 * math.sin(math.pi * f)))
            tp.append((pt, Vector((0, 0, 1)), (a1 - a0).cross(Vector((0, 0, 1))).normalized()))
        objs.append(kitlib.sweep(f'tielink{s:+d}', tp, lambda i: kitlib.rounded_rect(0.0016, 0.010, 0.0007, 1), caps=(True, True), mats=mats))
    return objs

# ---------------------------------------------------------------- assembly
def geometry():
    t0 = time.time(); sc = kitlib.reset()
    WOOD = kitlib.wood('rc_wood', 'beech', 'varnish', stain='#6b5038', age=1.0)
    VEL = kitlib.fabric('rc_velvet', '#7e4650', weave=1.0, fade=0.35, velvet=True, age=1.0)
    W = [WOOD]; F = [VEL]; parts = []
    parts.append(seat(W))
    for s in (-1, 1):
        parts.append(rocker(s, W))
        a, b = FL(s); parts.append(kitlib.lathe(f'fleg{s:+d}', FRONT_LEG, a, b, 10, (-s, 1, 0), lambda t, ang, p: 0.35 * smooth((0.2 - t) / 0.12) + 0.06, mats=W))
        a, b = BL(s); parts.append(kitlib.lathe(f'bleg{s:+d}', BACK_LEG, a, b, 10, (-s, 0, 0), lambda t, ang, p: 0.25 * smooth((0.2 - t) / 0.12) + 0.04, mats=W))
        a, b = ST(s); parts.append(kitlib.lathe(f'stile{s:+d}', STILE, a, b, 12, (0, 1, 0), lambda t, ang, p: 0.42 * smooth((t - 0.75) / 0.18) + 0.04, mats=W))
        f, bk = on_line(*FL(s), 0.200), on_line(*BL(s), 0.200)
        parts.append(kitlib.lathe(f'sstr{s:+d}', SIDE_STRETCHER, f, bk, 8, (-s, 0, 0), lambda t, ang, p: 0.05, mats=W))
        top = arm_at(-0.235) * Vector((s, 1, 1)); top.z -= 0.004
        parts.append(kitlib.lathe(f'apost{s:+d}', ARM_POST, (s * 0.226, -0.205, 0.405), top, 10, (-s, 1, 0), lambda t, ang, p: 0.12, mats=W))
        top = arm_at(-0.06) * Vector((s, 1, 1)); top.z -= 0.004
        parts.append(kitlib.lathe(f'aspin{s:+d}', ARM_SPINDLE, (s * 0.229, -0.050, 0.410), top, 8, (-s, 1, 0), mats=W))
        parts.append(arm(s, W))
    parts.append(kitlib.lathe('fstr', FRONT_STRETCHER, on_line(*FL(-1), 0.235), on_line(*FL(1), 0.235), 8, (0, 1, 0),
                              lambda t, ang, p: 0.75 * smooth((math.sin(ang) * -1 + 0.2) / 0.6) * smooth(1 - abs(t - 0.5) / 0.45), mats=W))
    for i, xt in enumerate((-0.13, -0.065, 0.0, 0.065, 0.13)):
        top = crest_point(xt, CREST_T / 2, 0.0) + D_UP * 0.012 - D_UP * 0.0
        parts.append(kitlib.lathe(f'spindle{i}', SPINDLE, (0.88 * xt, 0.112, 0.415), (top.x, top.y, top.z + 0.008), 8, (0, 1, 0),
                                  lambda t, ang, p: 0.08 + 0.15 * smooth((t - 0.75) / 0.2), mats=W))
    coff = (random.uniform(-3, 3), random.uniform(0.15, 0.3), random.uniform(-3, 3))
    crest = crest_mesh('crest', 34, 3, 0, W, off=coff); parts.append(crest)
    koff = (random.uniform(-3, 3), random.uniform(-3, 3), random.uniform(-3, 3))
    cush = cushion('cushion', 32, CUSH_ROWS, F, off=koff); parts.append(cush)
    parts += buttons(F) + ties(F)
    # sculpted sources for the normal map: the carved crest, the tufted cushion (same grain space as their low parts)
    crest_hp = crest_mesh('crest_hp', 420, 14, 70, W, carve=True, off=coff)
    rows_hp = CUSH_ROWS[:7] + [(r, None) for r in np.linspace(0.985, 0.02, 60)]
    cush_hp = cushion('cushion_hp', 260, rows_hp, F, hp=True, off=koff)
    for o in parts + [crest_hp, cush_hp]: kitlib.ensure_attrs(o); kitlib.curvature(o)
    tri = sum(kitlib.tris(o) for o in parts); print(f'rocking chair: {len(parts)} parts, {tri} triangles, built in {time.time() - t0:.1f}s')
    return parts, {crest: crest_hp, cush: cush_hp}

def build():
    t0 = time.time(); parts, high = geometry()
    # UVs: the turned and swept parts came with their own (metres); the seat, crest and cushion get smart projection; then one
    # texel density for all and one 0..1 pack
    kitlib.select([o for o in parts if o.name in ('seat', 'cushion')]); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(52), island_margin=0.0, scale_to_bounds=False); bpy.ops.object.mode_set(mode='OBJECT')
    kitlib.select(parts); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale(); bpy.ops.object.mode_set(mode='OBJECT')
    seat_o = next(o for o in parts if o.name == 'seat')     # (the underside: seen only by someone crouching)
    kitlib.uv_scale(seat_o, lambda p: p.normal.z < -0.7, 0.5)
    kitlib.pack_uvs(parts, margin=0.0035)
    # (Cycles sets up every bake pass once per object: bake three, the crest and the cushion apart for their sculpted sources)
    keep = list(high); rest = kitlib.join([o for o in parts if o not in keep], 'frame'); parts = [rest] + keep
    files = kitlib.bake_set(parts, ASSET, 2048, 64, high=high, cage=0.012)
    print('bake', json.dumps(files['times']))
    mat = kitlib.baked_material('Kit_rocking_chair', files)
    for o in high.values(): bpy.data.objects.remove(o)
    chair = kitlib.join(parts, PIVOT); chair.data.materials.clear(); chair.data.materials.append(mat)
    for a in [a.name for a in chair.data.attributes if a.name in ('gpos', 'wear', 'prand', 'curv')]: chair.data.attributes.remove(chair.data.attributes[a])
    kitlib.set_origin(chair, PIV)
    root = kitlib.empty(NODE); chair.parent = root; chair.matrix_parent_inverse.identity(); chair.location = PIV
    root['kit'] = 'solid'; info = {'tris': kitlib.tris(chair), 'bake': files['times'], 'px': files['px'], 'spp': files['spp']}
    json.dump(info, open(os.path.join(TMP, ASSET + '.json'), 'w'), indent=1)
    kitlib.register(ASSET, [root])
    print(f'rocking chair done: {info["tris"]} triangles, {time.time() - t0:.0f}s')

if __name__ == '__main__':
    if kitlib.fresh_asset(ASSET): print('rocking chair up to date')
    else: build()
