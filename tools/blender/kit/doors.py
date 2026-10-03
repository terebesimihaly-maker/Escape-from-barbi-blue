# Escape from Barbi Blue: the doorways' doors for every style (WP2.2; build spec B5, A9.3).
#   Door_frame_<style>   across the passage at the doorway tile's centre: posts 0.11 m at +-(1.125 - 0.055), the 0.34 m lining, the
#                        head from 2.60 m, architraves on both faces; its top (2.678 m) is where js/arch.js starts the header wall
#   Door_leaf_<style>    1.00 x 2.55 x 0.045 m, its origin on the hinge axis at the bottom, the leaf along +x (arch.js mirrors it for
#                        the other leaf and hangs both just past the architraves, centred on its box: so no hardware stands more than
#                        0.015 m proud and the box stays the leaf's)
#   Door_closed_<style>  a whole 2.25 x 3 m wall face with a closed 0.90 x 2.10 door in it: the casing at most 0.05 m proud, the leaf
#                        0.04 m back in its lining, the wall round it in the reserved WallSurface material (the game gives it the face's
#                        own wall and atlas cell); uv1 on everything
#   wood      painted pine, four panels, ovolo-moulded: cream over an older green over the primer, finger marks; porcelain plates (hero)
#   tile      mahogany, six raised-and-fielded panels in bolection mouldings, French polish gone dull and crazed, brass (hero)
#   concrete  ledged-and-braced planks under flaking green paint, iron T-hinges and a Suffolk latch; closed: a steel fire door
#   attic     bare boards on ledges, long strap hinges, rose-head nails; closed: a low boarded hatch
#   workshop  half-glazed with wired glass, a kick plate; institutional green
# The geometry carries the real relief (mouldings, beads, plates, hinges, nail heads); paint, wood, metal and their age are baked
# per piece into one albedo / normal / ORM set (the reserved Glass and WallSurface parts stay unbaked).
#   py -3.11 tools/blender/kit/doors.py [--preview] [--force] [--only wood,tile] [--sheets]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector
import kitlib, defs
import surfaces2 as S
from surfaces2 import sep, comb, finish
from kitlib import OPTS, TMP, lin

LW, LH, LT = 1.0, 2.55, 0.045                               # the leaf (arch.js LEAF)
FW, POST, LIN, HEAD = 2.25, 0.11, 0.34, 2.6                 # the doorway (arch.js POST, LINING, HEAD_Y0)
TOP = 2.678                                                 # the head's top: arch.js starts the header wall here (2.60..2.68)
MARGIN = 0.006                                              # how far an architrave stands back from the lining's edge
AW = round(TOP - HEAD - MARGIN, 4)                          # architrave width (0.072: the head can't be any taller)
CW, CH, CR = 0.9, 2.1, 0.1                                  # the closed door's opening, how deep its face module goes
PX = 2048
ATTRS = ('gpos', 'opos', 'prand', 'ja', 'jb', 'zone', 'pz', 'lp', 'wear', 'curv')
random.seed(23)

# ================================================================ geometry
def strip(rows, hints):
    """a quad strip: rows[k] the points across, faces between row k and k + 1 turned to face hints[k] (degenerate ones left out)"""
    bm = bmesh.new(); V = [[bm.verts.new(p) for p in row] for row in rows]
    for k in range(len(rows) - 1):
        for j in range(len(rows[k]) - 1):
            vs = [V[k][j], V[k][j + 1], V[k + 1][j + 1], V[k + 1][j]]
            if (vs[2].co - vs[0].co).cross(vs[3].co - vs[1].co).length < 1e-10: continue
            f = bm.faces.new(vs); f.normal_update()
            if f.normal.dot(hints[k]) < 0: f.normal_flip()
    return bm

def quad_bm(pts, hint):
    return strip([[Vector(pts[0]), Vector(pts[1])], [Vector(pts[3]), Vector(pts[2])]], [Vector(hint)])

def clean(prof):
    out = []
    for p in prof:
        if not out or abs(p[0] - out[-1][0]) > 1e-7 or abs(p[1] - out[-1][1]) > 1e-7: out.append(p)
    return out

def seg_hint(p, q, d_dir, h_dir):
    """the air side of a profile segment p -> q in (d, h), travelled with the air on its left: d along d_dir, h along h_dir"""
    return d_dir * (-(q[1] - p[1])) + h_dir * (q[0] - p[0])

def ovolo(r, n=4):
    return [(r * math.sin(math.pi / 2 * i / n), -r * (1 - math.cos(math.pi / 2 * i / n))) for i in range(n + 1)]

class Face:
    """a flat face of a piece: P(u, v, h) = O + u U + v V + h N (N out of the piece)"""
    def __init__(s, O, U, V, N):
        s.O, s.U, s.V, s.N = Vector(O), Vector(U), Vector(V), Vector(N)
    def P(s, u, v, h=0.0): return s.O + s.U * u + s.V * v + s.N * h
    def uv(s, c): d = Vector(c) - s.O; return d.dot(s.U), d.dot(s.V)

def grid_lines(lo, hi, spans):
    return [x for x in sorted(set([lo, hi] + [x for sp in spans for x in sp])) if lo - 1e-9 <= x <= hi + 1e-9]

def ring(G, F, rect, rows, mat, attrs, field=True):
    """a moulding round the opening rect (u0, u1, v0, v1) of face F: rows [(d, h)] from its edge inward (h out of the face), as
       four strips mitred at the corners; field: the flat panel inside the last row"""
    pu0, pu1, pv0, pv1 = rect; rows = clean(rows)
    sides = (('b', lambda d: (F.P(pu0 + d, pv0 + d), F.P(pu1 - d, pv0 + d)), F.V), ('r', lambda d: (F.P(pu1 - d, pv0 + d), F.P(pu1 - d, pv1 - d)), -F.U),
             ('t', lambda d: (F.P(pu1 - d, pv1 - d), F.P(pu0 + d, pv1 - d)), -F.V), ('l', lambda d: (F.P(pu0 + d, pv1 - d), F.P(pu0 + d, pv0 + d)), F.U))
    for side, ends, din in sides:
        R, Hs = [], []
        for k, (d, h) in enumerate(rows):
            a, b = ends(d); R.append([a + F.N * h, b + F.N * h])
            if k: Hs.append(seg_hint(rows[k - 1], rows[k], din, F.N))
        G.add(strip(R, Hs), mat, attrs('mould', side, rect), smooth=True, wrap=False)
    if field:
        d, h = rows[-1]
        G.add(quad_bm([F.P(pu0 + d, pv0 + d, h), F.P(pu1 - d, pv0 + d, h), F.P(pu1 - d, pv1 - d, h), F.P(pu0 + d, pv1 - d, h)], F.N), mat, attrs('field', None, rect), wrap=False)

def panelled(G, F, outline, panels, prof, field, mat, attrs, holes=()):
    """a face with panels: outline (u0, u1, v0, v1); panels [(u0, u1, v0, v1)] the openings (on a grid with each other), each with
       the moulding prof [(d, h)] from the opening's edge (d inward, h out of the face) down to the panel's margin, a 4 mm strip
       (the shrinkage line) and the panel's own relief field [(d, h)]; holes [(rect, prof)]: openings with only a moulding (glass
       in them). attrs(kind, side, rect) -> the element's attribute dict"""
    u0, u1, v0, v1 = outline; opens = list(panels) + [h[0] for h in holes]
    us = grid_lines(u0, u1, [(p[0], p[1]) for p in opens]); vs = grid_lines(v0, v1, [(p[2], p[3]) for p in opens])
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            a, b, c, d = us[i], us[i + 1], vs[j], vs[j + 1]; cu, cv = (a + b) / 2, (c + d) / 2
            if any(p[0] < cu < p[1] and p[2] < cv < p[3] for p in opens): continue
            G.add(quad_bm([F.P(a, c), F.P(b, c), F.P(b, d), F.P(a, d)], F.N), mat, attrs('cell', None, (a, b, c, d)), wrap=False)
    for rect in panels:
        de, he = prof[-1]; ring(G, F, rect, list(prof) + [(de + 0.004, he)] + list(field), mat, attrs)
    for rect, hp in holes: ring(G, F, rect, hp, mat, attrs, field=False)

def perimeter(G, x0, x1, z0, z1, prof, mat, attrs, smooth=True):
    """round a slab's outline (x0..x1, z0..z1 in the xz plane): prof [(d, y)] from the front face (d = how far in from the outline)
       over the arrises and the edge to the back face"""
    Y = Vector((0, 1, 0)); prof = clean(prof)
    sides = {'b': (lambda d: (Vector((x0 + d, 0, z0 + d)), Vector((x1 - d, 0, z0 + d))), Vector((0, 0, 1))),
             'r': (lambda d: (Vector((x1 - d, 0, z0 + d)), Vector((x1 - d, 0, z1 - d))), Vector((-1, 0, 0))),
             't': (lambda d: (Vector((x1 - d, 0, z1 - d)), Vector((x0 + d, 0, z1 - d))), Vector((0, 0, -1))),
             'l': (lambda d: (Vector((x0 + d, 0, z1 - d)), Vector((x0 + d, 0, z0 + d))), Vector((1, 0, 0)))}
    for sd, (ends, din) in sides.items():
        R, Hs = [], []
        for k, (d, y) in enumerate(prof):
            a, b = ends(d); R.append([a + Y * y, b + Y * y])
            if k: Hs.append(seg_hint(prof[k - 1], prof[k], din, Y))
        G.add(strip(R, Hs), mat, attrs('edge', sd, (x0, x1, z0, z1)), smooth=smooth, wrap=False)

def arris(t, e=0.0025, n=2):
    """an eased slab edge as a perimeter profile: the front face (y = -t/2) over a rounded arris, the edge, the back arris"""
    p = [(e * (1 - math.sin(math.pi / 2 * i / n)), -t / 2 + e * (1 - math.cos(math.pi / 2 * i / n))) for i in range(n + 1)]
    q = [(e * (1 - math.cos(math.pi / 2 * i / n)), t / 2 - e * (1 - math.sin(math.pi / 2 * i / n))) for i in range(n + 1)]
    return p + q

def lathe_bm(prof, p0, p1, sides=12, caps=(True, True)):
    """a turned part: prof [(t 0..1 along p0 -> p1, radius)]"""
    p0, p1 = Vector(p0), Vector(p1); ax = p1 - p0; L = ax.length; ax.normalize(); u, v = kitlib.frame(ax, (0, 0, 1))
    bm = bmesh.new(); V = []
    for t, r in prof:
        c = p0 + ax * (t * L); V.append([bm.verts.new(c + (u * math.cos(2 * math.pi * j / sides) + v * math.sin(2 * math.pi * j / sides)) * max(r, 1e-5)) for j in range(sides)])
    for k in range(len(V) - 1):
        for j in range(sides):
            vs = [V[k][j], V[k][(j + 1) % sides], V[k + 1][(j + 1) % sides], V[k + 1][j]]
            f = bm.faces.new(vs); f.normal_update()
            mid = sum((x.co for x in vs), Vector()) / 4
            if f.normal.dot(mid - (p0 + ax * (mid - p0).dot(ax))) < 0: f.normal_flip()
    for end, on, sgn in ((0, caps[0], -1), (len(V) - 1, caps[1], 1)):
        if not on or prof[end][1] < 1e-4: continue
        f = bm.faces.new(V[end]); f.normal_update()
        if f.normal.dot(ax * sgn) < 0: f.normal_flip()
    return bm

def tube(G, mat, pts, r, sides=8, attrs=None):
    """a round bar along a polyline (a grip, a ring, an arm)"""
    for k in range(len(pts) - 1):
        G.add(lathe_bm([(0.0, r), (1.0, r)], pts[k], pts[k + 1], sides, (k == 0, k == len(pts) - 2)), mat, attrs or metal_attrs(), smooth=True, wrap=False)

def block(lo, hi, bevel=0.0, segs=1):
    lo, hi = Vector(lo), Vector(hi); bm = S.box(*(hi - lo), bevel, segs)
    return S.xform(bm, tuple((lo + hi) / 2))

def plate(outline, y0, t, front=True, bevel=0.0006):
    """a thin plate from a 2D outline [(x, z)] lying on the plane y = y0, t thick toward -y (front) or +y"""
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new((x, y0, z)) for x, z in outline]); f.normal_update()
    want = Vector((0, -1 if front else 1, 0))
    if f.normal.dot(want) > 0: f.normal_flip()
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, verts=[e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)], vec=want * t)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bevel: bmesh.ops.bevel(bm, geom=[e for e in bm.edges if all(abs(v.co.y - y0) > t * 0.5 for v in e.verts)], offset=bevel, segments=1, affect='EDGES', clamp_overlap=True)
    return bm

def rounded(w, h, r, n=3, cx=0.0, cz=0.0):
    return kitlib.rounded_rect(w, h, r, n, cx, cz)

# ================================================================ attributes
def member(grain, depth_axis):
    """one piece of wood: grain space (z along the grain, the pith 8..30 cm behind the face: cathedral figure) and its tone"""
    off = Vector((random.uniform(-9, 9), random.uniform(-9, 9), random.uniform(-9, 9))); d0 = random.uniform(0.08, 0.3)
    A = Vector(grain).normalized(); Dn = Vector(depth_axis).normalized(); B = A.cross(Dn)
    # (the log's axis is never quite the piece's length: tilted a degree or two into the face, the rings cross it in long
    # cathedral arches rather than running in parallel stripes; a little sideways too)
    t1 = math.radians(random.uniform(1.0, 3.5)) * random.choice((-1, 1)); t2 = math.radians(random.uniform(-1.0, 1.0))
    A = (A * math.cos(t1) + Dn * math.sin(t1) + B * math.sin(t2)).normalized(); Dn = (Dn - A * Dn.dot(A)).normalized(); B = A.cross(Dn)
    return (lambda c: (Vector(c).dot(B) + off.x, Vector(c).dot(Dn) + d0, Vector(c).dot(A) + off.z)), random.random()

def attrs_of(gp, pr, ja=9.0, jb=9.0, zone=0.0, pz=1.0, lp=(0.0, 0.0, 0.0)):
    """every element carries every attribute (a missing one would read 0: a joint everywhere)"""
    return {'gpos': gp, 'opos': (lambda c: tuple(c)), 'prand': pr, 'ja': ja, 'jb': jb, 'zone': zone, 'pz': pz, 'lp': lp}

def metal_attrs(lp=(0.0, 0.0, 0.0)):
    off = Vector((random.uniform(-9, 9), random.uniform(-9, 9), random.uniform(-9, 9)))
    return attrs_of(lambda c: tuple(Vector(c) + off), random.random(), lp=lp)

def wood_attrs(grain, depth):
    gp, pr = member(grain, depth); return attrs_of(gp, pr)

# ================================================================ leaves: frame and panel
OVOLO = ovolo(0.009) + [(0.011, -0.009), (0.011, -0.0115)]
BOLECTION = [(-0.006, 0.0), (-0.0045, 0.0046), (0.0, 0.0073), (0.008, 0.0082), (0.015, 0.0074), (0.0205, 0.0043), (0.025, 0.0), (0.026, -0.0035), (0.0265, -0.007)]
RAISED = [(0.036, -0.007), (0.075, -0.0028), (0.0765, -0.0015)]
SQUARE = [(0.0, 0.0), (0.006, -0.006), (0.0065, -0.0115)]
BEAD = [(0.0, 0.0), (0.003, -0.0012), (0.009, -0.0045), (0.014, -0.0095), (0.0165, -0.0155), (0.017, -0.0195)]   # (down to the glass)
LEAVES = {      # stile, rails [(z0, z1)] bottom to top, panel columns [(x0, x1)], moulding, panel relief; glass: the row that's glazed
    'wood': {'stile': 0.12, 'rails': [(0.0, 0.24), (0.93, 1.13), (2.43, LH)], 'cols': [(0.12, 0.45), (0.55, 0.88)], 'prof': OVOLO, 'field': []},
    'tile': {'stile': 0.13, 'rails': [(0.0, 0.26), (0.80, 1.00), (1.98, 2.12), (2.42, LH)], 'cols': [(0.13, 0.44), (0.56, 0.87)], 'prof': BOLECTION, 'field': RAISED},
    'workshop': {'stile': 0.12, 'rails': [(0.0, 0.25), (1.0, 1.15), (2.43, LH)], 'cols': [(0.12, 0.88)], 'prof': SQUARE, 'field': [], 'glass': 1},
}
CLW, CLH, CLZ = CW - 0.006, CH - 0.017, 0.014                # the closed door's leaf: 3 mm gaps, off the threshold
CLOSED = {
    'wood': {'stile': 0.11, 'rails': [(0.0, 0.22), (0.86, 1.04), (CLH - 0.11, CLH)], 'cols': [(0.11, 0.40), (0.494, 0.784)], 'prof': OVOLO, 'field': []},
    'tile': {'stile': 0.12, 'rails': [(0.0, 0.24), (0.74, 0.92), (1.62, 1.74), (CLH - 0.12, CLH)], 'cols': [(0.12, 0.40), (0.494, 0.774)], 'prof': BOLECTION, 'field': RAISED},
    'workshop': {'stile': 0.11, 'rails': [(0.0, 0.24), (0.86, 1.04), (CLH - 0.11, CLH)], 'cols': [(0.11, 0.40), (0.494, 0.784)], 'prof': SQUARE, 'field': []},
}

def panel_leaf(G, spec, W, H, T, mat, back=True, o=(0.0, 0.0, 0.0)):
    """a frame-and-panel leaf, x 0..W from its hinge edge, z 0..H, thickness T about o's y, all moved to o: stiles, rails and
       muntins (each its own piece of wood; ja, jb: how far to the joints where rails meet stiles and muntins meet rails), the
       panels in their mouldings on both faces (back=False: the front only, for a door seen from one side), the eased edges.
       -> the glazed openings"""
    ox, oy, oz = o; st = spec['stile']; rails = spec['rails']; e = 0.0025
    rows = [(rails[i][1], rails[i + 1][0]) for i in range(len(rails) - 1)]
    panels, holes = [], []
    for i, (z0, z1) in enumerate(rows):
        if spec.get('glass') == i: holes.append((st, W - st, z0, z1))
        else: panels += [(x0, x1, z0, z1) for x0, x1 in spec['cols']]
    rel = lambda c: (Vector(c).x - ox, Vector(c).z - oz)
    mems = {}
    def cell_attrs(rect):
        a, b, c, d = rect; cu, cv = (a + b) / 2, (c + d) / 2
        if cu < st or cu > W - st: key, grain, ja, jb = ('stile', cu < st), (0, 0, 1), 9.0, 9.0
        elif any(z0 < cv < z1 for z0, z1 in rows):
            z0, z1 = next((z0, z1) for z0, z1 in rows if z0 < cv < z1); key, grain = ('muntin', z0, cu > W / 2), (0, 0, 1)
            ja, jb = (lambda c_, z0=z0: rel(c_)[1] - z0), (lambda c_, z1=z1: z1 - rel(c_)[1])
        else:
            key, grain = ('rail', round(cv, 3)), (1, 0, 0)
            ja, jb = (lambda c_: rel(c_)[0] - st), (lambda c_: (W - st) - rel(c_)[0])
        if key not in mems: mems[key] = member(grain, (0, -1, 0))
        gp, pr = mems[key]; return attrs_of(gp, pr, ja, jb)
    def attrs(kind, side, rect):
        if kind == 'cell': return cell_attrs(rect)
        key = (kind, side, rect)
        if key not in mems: mems[key] = member((1, 0, 0) if side and side in 'bt' else (0, 0, 1), (0, -1, 0) if kind != 'edge' else ((1, 0, 0) if side in 'lr' else (0, 0, 1)))
        gp, pr = mems[key]
        if kind == 'mould' and rect in panels:
            pu0, pu1, pv0, pv1 = rect; dE = spec['prof'][-1][0]
            def dist(c):
                x, z = rel(c); return min(x - pu0, pu1 - x, z - pv0, pv1 - z)
            return attrs_of(gp, pr, zone=(lambda c: 2.0 if dist(c) > dE - 1e-5 else 1.0), pz=(lambda c: max(0.0, min(1.0, (dist(c) - dE) / 0.004))))
        return attrs_of(gp, pr, zone=2.0 if kind == 'field' else 0.0)
    for s in ((-1, 1) if back else (-1,)):
        F = Face((ox, oy + s * T / 2, oz), (1, 0, 0), (0, 0, 1), (0, s, 0))
        panelled(G, F, (e, W - e, e, H - e), panels, spec['prof'], spec['field'], mat, attrs, holes=[(h, BEAD) for h in holes])
    prof = arris(T, e) if back else arris(T, e)[:3] + [(0.0, 0.012)]
    perimeter(G, ox, ox + W, oz, oz + H, [(d, y + oy) for d, y in prof], mat, attrs)
    return holes

def wired_glass(G, GL, WIRE, x0, x1, z0, z1, y0=0.0, t=0.006, pitch=0.0125, w=0.0009):
    """a pane of Georgian wired glass: the glass (reserved Glass, both faces) and the steel mesh in it (thin ribbons seen from
       both sides, baked with the door)"""
    for s in (-1, 1):
        y = y0 + s * t / 2
        G.add(quad_bm([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], (0, s, 0)), GL, attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    nx, nz = int((x1 - x0) / pitch), int((z1 - z0) / pitch); ox, oz = (x1 - x0 - nx * pitch) / 2, (z1 - z0 - nz * pitch) / 2
    for s in (-1, 1):
        y = y0 + s * 0.0004
        for i in range(nx + 1):
            x = x0 + ox + i * pitch
            G.add(quad_bm([(x - w / 2, y, z0), (x + w / 2, y, z0), (x + w / 2, y, z1), (x - w / 2, y, z1)], (0, s, 0)), WIRE, metal_attrs(), wrap=False)
        for j in range(nz + 1):
            z = z0 + oz + j * pitch
            G.add(quad_bm([(x0, y, z - w / 2), (x1, y, z - w / 2), (x1, y, z + w / 2), (x0, y, z + w / 2)], (0, s, 0)), WIRE, metal_attrs(), wrap=False)

# ---------------------------------------------------------------- hardware
def keyhole(x, z, r=0.0045):
    """a keyhole's outline: the round top, the slot below"""
    return [(x + r * math.cos(math.radians(-55 + 290 * i / 12)), z + r * math.sin(math.radians(-55 + 290 * i / 12))) for i in range(13)] + [(x - 0.0032, z - 0.013), (x + 0.0032, z - 0.013)]

def knob_set(G, M, x, z, s, y_face, proud, kind='brass', big=False, sides=20):
    """a mortice knob on its rose and a keyhole escutcheon below it, on the face at y_face (s: which way is out); proud: how far
       the knob reaches from the face (a real knob on a closed door; squashed flat on a leaf, to stay in its box)"""
    r = 0.028 if big else 0.025; Y = Vector((0, s, 0)); base = Vector((x, y_face, z))
    G.add(lathe_bm([(0.0, r), (0.4, r), (0.75, r * 0.93), (1.0, r * 0.7)], base, base + Y * 0.0035, sides, (False, True)), M[kind], metal_attrs(), smooth=True, wrap=False)
    if proud > 0.035: kp = [(0.0, 0.007), (0.25, 0.0065), (0.4, 0.009), (0.55, 0.018), (0.7, 0.024), (0.85, 0.025), (0.95, 0.021), (1.0, 0.0)]
    else: kp = [(0.0, 0.009), (0.3, 0.011), (0.55, 0.02), (0.8, 0.023), (0.93, 0.02), (1.0, 0.0)]
    G.add(lathe_bm(kp, base + Y * 0.0035, base + Y * proud, sides, (False, True)), M.get('knob', M[kind]), metal_attrs(), smooth=True, wrap=False)
    G.add(plate(rounded(0.026, 0.05, 0.012, 3, x, z - 0.085), y_face, 0.0016, front=(s < 0)), M[kind], metal_attrs(lp=(0.0, 0.0, 1.0)), wrap=False)
    G.add(plate(keyhole(x, z - 0.079), y_face + s * 0.0016, 0.00025, front=(s < 0), bevel=0.0), M['void'], metal_attrs(), wrap=False)

def finger_plate(G, mat, x, z0, z1, w, s, y_face, t=0.003):
    G.add(plate(rounded(w, z1 - z0, 0.006, 3, x, (z0 + z1) / 2), y_face, t, front=(s < 0), bevel=0.0008), mat,
          attrs_of(lambda c: tuple(c), random.random(), lp=(lambda c, x=x, w=w, z0=z0, z1=z1: ((Vector(c).x - (x - w / 2)) / w, (Vector(c).z - z0) / (z1 - z0), 1.0))), wrap=False)

def knuckles(G, mat, x, y, zs, r=0.0075, h=0.1):
    for zc in zs:                                           # (a slight waist where the knuckles meet)
        G.add(lathe_bm([(0.0, r * 0.6), (0.06, r), (0.33, r * 0.94), (0.66, r * 0.94), (0.94, r), (1.0, r * 0.6)],
                       (x, y, zc - h / 2), (x, y, zc + h / 2), 8), mat, metal_attrs(), smooth=True, wrap=False)

def nails(G, mat, pts, y_face, s=-1, r=0.0045, h=0.0016):
    for (x, z) in pts:
        b = Vector((x, y_face, z))
        G.add(lathe_bm([(0.0, r), (0.5, r * 0.8), (1.0, 0.0)], b, b + Vector((0, s, 0)) * h, 6, (False, False)), mat, metal_attrs(), wrap=False)

def strap_outline(x0, x1, zc, w0, w1, end='round', n=6):
    """a strap hinge's outline: w0 wide at the knuckle (x0), tapering to w1 at x1, ending round or in a spear"""
    pts = [(x0, zc - w0 / 2)]
    if end == 'spear': pts += [(x1 - 0.05, zc - w1 / 2), (x1 - 0.04, zc - w1 * 1.1), (x1, zc), (x1 - 0.04, zc + w1 * 1.1), (x1 - 0.05, zc + w1 / 2)]
    else: pts += [(x1 - w1 / 2 + math.cos(a) * w1 / 2, zc + math.sin(a) * w1 / 2) for a in (-math.pi / 2 + math.pi * i / n for i in range(n + 1))]
    return pts + [(x0, zc + w0 / 2)]

# ---------------------------------------------------------------- boarded leaves
def boards_leaf(G, M, W, H, T, n, gap, ledges, braces, rough=False, front_only=False, o=(0.0, 0.0, 0.0)):
    """boards on ledges (and braces): the boards over the front half of the thickness, V-jointed (or butted, rough, with gaps),
       the ledges and braces behind them. -> the boards' width"""
    ox, oy, oz = o; tb = T * 0.49; bw = (W - gap * (n - 1)) / n; yb0, yb1 = oy - T / 2, oy - T / 2 + tb
    for i in range(n):
        bx0 = ox + i * (bw + gap); dz = random.uniform(0.0, 0.012) if rough else 0.0
        bm = block((bx0, yb0, oz + dz), (bx0 + bw, yb1, oz + H - (random.uniform(0, 0.006) if rough else 0.0)), 0.0012 if rough else 0.0028, 1)
        if rough: S.deform(bm, lambda c, a=random.gauss(0, 0.0007), b=random.gauss(0, 0.0005): (c.x, c.y + a * ((c.z - oz) / H - 0.5) * 2 + b * math.sin(c.z * 3.0), c.z))
        G.add(bm, M['wood'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    if front_only: return bw
    yl0, yl1 = yb1, oy + T / 2
    for (zc, h) in ledges:
        G.add(block((ox + 0.02, yl0, oz + zc - h / 2), (ox + W - 0.02, yl1, oz + zc + h / 2), 0.004, 1), M['wood'], wood_attrs((1, 0, 0), (0, 1, 0)), wrap=False)
    for (za, zb) in braces:                                  # (from low on the hinge side up to the latch side: in compression)
        a = Vector((ox + 0.05, 0, oz + za)); b = Vector((ox + W - 0.05, 0, oz + zb)); dv = b - a; L = dv.length; ang = math.atan2(dv.z, dv.x)
        bm = block((-L / 2 - 0.1, yl0, -0.055), (L / 2 + 0.1, yl1 - 0.0005, 0.055), 0.004, 1)
        S.xform(bm, (0, 0, 0), (0, -ang, 0)); S.xform(bm, tuple((a + b) / 2))
        for co, no, inner in (((0, 0, oz + za), (0, 0, 1), True), ((0, 0, oz + zb), (0, 0, 1), False), ((ox + 0.02, 0, 0), (1, 0, 0), True), ((ox + W - 0.02, 0, 0), (1, 0, 0), False)):
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, clear_inner=inner, clear_outer=not inner)
            bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        G.add(bm, M['wood'], wood_attrs((math.cos(ang), 0, math.sin(ang)), (0, 1, 0)), wrap=False)
    return bw

# ================================================================ the leaf
def build_leaf(style, M):
    G = S.Geo(1, 1, False, False); W, H, T = LW, LH, LT
    if style in LEAVES:
        spec = LEAVES[style]; holes = panel_leaf(G, spec, W, H, T, M['wood'])
        kx = W - 0.06; kz = {'wood': 1.03, 'tile': 0.9}.get(style, 1.075)
        for s in (-1, 1):
            yf = s * T / 2
            if style == 'wood':
                knob_set(G, M, kx, kz, s, yf, 0.0145, 'brass'); finger_plate(G, M['plate'], kx, 1.24, 1.52, 0.075, s, yf)
            elif style == 'tile':
                knob_set(G, M, kx, kz, s, yf, 0.0145, 'brass', big=True, sides=12); finger_plate(G, M['brass'], kx, 1.12, 1.44, 0.07, s, yf, 0.0016)
            else:
                knob_set(G, M, kx, kz, s, yf, 0.0145, 'steel')
                G.add(plate(rounded(W - 0.06, 0.235, 0.004, 2, W / 2, 0.1275), yf, 0.0014, front=(s < 0)), M['steel'], metal_attrs(), wrap=False)   # (kick plate)
                finger_plate(G, M['steel'], kx, 1.22, 1.52, 0.09, s, yf, 0.0014)
        for h in holes:
            b = BEAD[-1][0] - 0.004; wired_glass(G, M['glass'], M['wire'], h[0] + b, h[1] - b, h[2] + b, h[3] - b)
        knuckles(G, M['brass'] if style == 'tile' else M['wood'], 0.0076, 0.0, (0.25, 1.3, 2.3))   # (painted over with the door; nothing behind the hinge line x = 0)
        return G
    rough = style == 'attic'; n, gap = (7, 0.0) if style == 'concrete' else (5, 0.004)
    ledges = [(0.2, 0.15), (1.2, 0.15), (2.3, 0.15)]
    bw = boards_leaf(G, M, W, H, T, n, gap, ledges, [(0.275, 1.125), (1.275, 2.225)] if style == 'concrete' else [], rough)
    yf = -T / 2
    nails(G, M['iron'], [(i * (bw + gap) + bw * f, zc + dz) for i in range(n) for (zc, _) in ledges for f, dz in ((0.3, 0.035), (0.7, -0.035))], yf)
    if style == 'concrete':
        for (zc, _) in ledges: G.add(plate(strap_outline(0.0, 0.52, zc, 0.04, 0.03), yf, 0.004, bevel=0.0007), M['iron'], metal_attrs(), wrap=False)
        for zc in (0.94, 1.18):                             # (the Suffolk latch: two cusped plates, the bow grip between them)
            G.add(plate([(0.905, zc - 0.012), (0.935, zc - 0.012), (0.94, zc), (0.935, zc + 0.012), (0.905, zc + 0.012), (0.9, zc)], yf, 0.003), M['iron'], metal_attrs(), wrap=False)
        tube(G, M['iron'], [Vector((0.92, yf - 0.003 - 0.0085 * math.sin(math.pi * k / 8), 0.95 + 0.22 * k / 8)) for k in range(9)], 0.0055)
    else:
        for (zc, _) in ledges: G.add(plate(strap_outline(0.0, 0.68, zc, 0.045, 0.028, 'spear'), yf, 0.0045, bevel=0.0007), M['iron'], metal_attrs(), wrap=False)
        G.add(lathe_bm([(0.0, 0.022), (1.0, 0.022)], (0.9, yf, 1.0), (0.9, yf - 0.003, 1.0), 12, (False, True)), M['iron'], metal_attrs(), wrap=False)   # (a flat iron ring pull)
        tube(G, M['iron'], [Vector((0.9 + 0.035 * math.sin(2 * math.pi * k / 16), yf - 0.0085, 1.0 - 0.035 * math.cos(2 * math.pi * k / 16))) for k in range(17)], 0.0045, 6)
    knuckles(G, M['iron'], 0.0076, 0.0, (0.2, 1.2, 2.3))
    return G

# ================================================================ the frame
ARCH = {        # architrave profiles: (w out from the inner edge, h proud of the lining's end)
    'wood': [(0, 0), (0, 0.007), (0.002, 0.0098), (0.0045, 0.0112), (0.0072, 0.0106), (0.0088, 0.0094), (0.0095, 0.009), (0.036, 0.0118), (0.041, 0.0135),
             (0.046, 0.0165), (0.050, 0.0198), (0.054, 0.0222), (0.058, 0.0236), (0.062, 0.024), (0.066, 0.024), (0.068, 0.0232), (AW, 0.021), (AW, 0.0)],
    'tile': [(0, 0), (0, 0.009), (0.0025, 0.0128), (0.0055, 0.0145), (0.0085, 0.014), (0.0105, 0.0122), (0.011, 0.0118), (0.033, 0.0152), (0.038, 0.0175),
             (0.043, 0.0215), (0.047, 0.0255), (0.0515, 0.0283), (0.056, 0.0296), (0.061, 0.03), (0.066, 0.03), (0.069, 0.0292), (AW, 0.027), (AW, 0.0)],
    'concrete': [(0, 0), (0, 0.016), (0.003, 0.019), (AW - 0.003, 0.019), (AW, 0.016), (AW, 0.0)],
    'attic': [(0, 0), (0, 0.018), (0.0012, 0.0192), (AW - 0.0012, 0.0192), (AW, 0.018), (AW, 0.0)],
    'workshop': [(0, 0), (0, 0.009), (0.0015, 0.0135), (0.0045, 0.0168), (0.009, 0.0185), (AW - 0.009, 0.0185), (AW - 0.0045, 0.0168), (AW - 0.0015, 0.0135), (AW, 0.009), (AW, 0.0)],
}
STEEL_FRAME = [(0, 0), (0, 0.012), (0.003, 0.0155), (0.006, 0.0165), (0.044, 0.0165), (0.047, 0.0155), (0.05, 0.012), (0.05, 0.0)]
PLINTH = {'wood': (0.22, 0.03), 'tile': (0.24, 0.034)}

def architrave(G, mat, prof, xi, zi, zb, y_face, s, plinth=None):
    """an architrave round an opening (inner edge at x = +-xi, head at zi) on the plane y = y_face, standing out toward s: both
       legs and the head, mitred at the corners, from zb up (on the plinth blocks when there are any)"""
    Y = Vector((0, s, 0)); prof = clean(prof)
    for ends, out, grain in ((lambda w: (Vector((-(xi + w), y_face, zb)), Vector((-(xi + w), y_face, zi + w))), Vector((-1, 0, 0)), (0, 0, 1)),
                             (lambda w: (Vector((-(xi + w), y_face, zi + w)), Vector((xi + w, y_face, zi + w))), Vector((0, 0, 1)), (1, 0, 0)),
                             (lambda w: (Vector((xi + w, y_face, zi + w)), Vector((xi + w, y_face, zb))), Vector((1, 0, 0)), (0, 0, 1))):
        R, Hs = [], []
        for k, (w, h) in enumerate(prof):
            a, b = ends(w); R.append([a + Y * h, b + Y * h])
            if k: Hs.append(seg_hint(prof[k - 1], prof[k], out, Y))     # (w outward along out: the air on the left, as in the panels)
        G.add(strip(R, Hs), mat, wood_attrs(grain, (0, -s, 0)), smooth=True, wrap=False)
    if plinth:
        ph, pp = plinth; wd = prof[-1][0] + 0.008
        for sx in (-1, 1):
            xa, xb = sorted((sx * (xi - 0.002), sx * (xi + wd))); ya, yb = sorted((y_face, y_face + s * pp))
            G.add(block((xa, ya, 0.0), (xb, yb, ph), 0.003, 1), mat, wood_attrs((0, 0, 1), (0, -s, 0)), wrap=False)

def build_frame(style, M):
    G = S.Geo(1, 1, False, False); xi = FW / 2 - POST; yl = LIN / 2; mems = {}
    def att(kind, side, rect, grain, depth):
        key = (kind, side, rect)
        if key not in mems: mems[key] = member(grain, depth)
        gp, pr = mems[key]; return attrs_of(gp, pr, zone=2.0 if kind == 'field' else 0.0)
    panelled_lining = style in ('wood', 'tile'); lprof = ovolo(0.006) + [(0.0075, -0.006), (0.0075, -0.009)]
    for sx in (-1, 1):                                       # the posts' faces toward the opening
        F = Face((sx * xi, 0, 0), (0, 1, 0), (0, 0, 1), (-sx, 0, 0))
        panelled(G, F, (-yl, yl, 0.0, HEAD), [(-0.105, 0.105, 0.24, 0.93), (-0.105, 0.105, 1.13, 2.45)] if panelled_lining else [], lprof, [], M['wood'],
                 lambda k, s_, r, sx=sx: att(k, (s_, sx), r, (0, 0, 1) if k != 'mould' or s_ in 'lr' else (0, 1, 0), (-sx, 0, 0)))
    F = Face((0, 0, HEAD), (1, 0, 0), (0, 1, 0), (0, 0, -1))   # the soffit
    panelled(G, F, (-xi, xi, -yl, yl), [(-0.9, 0.9, -0.105, 0.105)] if panelled_lining else [], lprof, [], M['wood'],
             lambda k, s_, r: att(k, ('h', s_), r, (1, 0, 0) if k != 'mould' or s_ in 'bt' else (0, 1, 0), (0, 0, -1)))
    pl = PLINTH.get(style)
    for s in (-1, 1):                                        # the lining's ends round the architraves, the architraves; both faces
        y = s * yl; ax = xi + MARGIN + AW
        for sx in (-1, 1):
            for (a, b) in ((xi, xi + MARGIN), (ax, FW / 2)):
                lo, hi = sorted((sx * a, sx * b))
                G.add(quad_bm([(lo, y, 0), (hi, y, 0), (hi, y, TOP), (lo, y, TOP)], (0, s, 0)), M['wood'], wood_attrs((0, 0, 1), (0, s, 0)), wrap=False)
        G.add(quad_bm([(-xi, y, HEAD), (xi, y, HEAD), (xi, y, HEAD + MARGIN), (-xi, y, HEAD + MARGIN)], (0, s, 0)), M['wood'], wood_attrs((1, 0, 0), (0, s, 0)), wrap=False)
        architrave(G, M['wood'], ARCH[style], xi + MARGIN, HEAD + MARGIN, pl[0] if pl else 0.0, y, s, pl)
    if style == 'workshop':                                  # (steel angles guarding the lining's edges, where trolleys hit them)
        for sx in (-1, 1):
            for s in (-1, 1):
                x, y = sx * xi, s * yl
                G.add(block((min(x, x + sx * 0.0025), min(y, y - s * 0.035), 0.0), (max(x, x + sx * 0.0025), max(y, y - s * 0.035), 1.2), 0.0006), M['steel'], metal_attrs(), wrap=False)
                G.add(block((min(x, x + sx * 0.035), min(y, y + s * 0.0025), 0.0), (max(x, x + sx * 0.035), max(y, y + s * 0.0025), 1.2), 0.0006), M['steel'], metal_attrs(), wrap=False)
    return G

# ================================================================ the closed door
def wall_face(G, mat, hole):
    """the 2.25 x 3 m wall face at y = 0 (the room toward -y) round a hole (x0, x1, z0, z1), in the reserved WallSurface"""
    w = FW / 2; x0, x1, z0, z1 = hole; Hh = 3.0
    for a, b, c, d in (((-w, 0), (x0, 0), (x0, Hh), (-w, Hh)), ((x1, 0), (w, 0), (w, Hh), (x1, Hh)), ((x0, 0), (x1, 0), (x1, z0), (x0, z0)), ((x0, z1), (x1, z1), (x1, Hh), (x0, Hh))):
        if abs(a[0] - b[0]) > 1e-6 and abs(b[1] - c[1]) > 1e-6:
            G.add(quad_bm([(a[0], 0, a[1]), (b[0], 0, b[1]), (c[0], 0, c[1]), (d[0], 0, d[1])], (0, -1, 0)), mat, attrs_of(lambda c: tuple(c), 0.5), wrap=False)

def lining(G, mat, x0, x1, z0, z1, depth, jt=0.025, sill=True):
    """the boards lining an opening's reveal, from the wall plane back depth, and their ends on the wall face (under the casing)"""
    for sx, x in ((1, x0), (-1, x1)):
        G.add(quad_bm([(x, 0, z0), (x, depth, z0), (x, depth, z1), (x, 0, z1)], (sx, 0, 0)), mat, wood_attrs((0, 0, 1), (-sx, 0, 0)), wrap=False)
        xa, xb = sorted((x, x - sx * jt))
        G.add(quad_bm([(xa, 0, z0 - (jt if sill else 0)), (xb, 0, z0 - (jt if sill else 0)), (xb, 0, z1 + jt), (xa, 0, z1 + jt)], (0, -1, 0)), mat, wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    G.add(quad_bm([(x0, 0, z1), (x1, 0, z1), (x1, depth, z1), (x0, depth, z1)], (0, 0, -1)), mat, wood_attrs((1, 0, 0), (0, 0, -1)), wrap=False)
    G.add(quad_bm([(x0, 0, z1), (x1, 0, z1), (x1, 0, z1 + jt), (x0, 0, z1 + jt)], (0, -1, 0)), mat, wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    if sill:
        G.add(quad_bm([(x0, 0, z0), (x1, 0, z0), (x1, depth, z0), (x0, depth, z0)], (0, 0, 1)), mat, wood_attrs((1, 0, 0), (0, 0, 1)), wrap=False)
        G.add(quad_bm([(x0, 0, z0 - jt), (x1, 0, z0 - jt), (x1, 0, z0), (x0, 0, z0)], (0, -1, 0)), mat, wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)

def sign(G, mat, cx, cz, w, h, yl):
    G.add(plate(rounded(w, h, 0.008, 3, cx, cz), yl, 0.002), mat,
          attrs_of(lambda c: tuple(c), 0.5, lp=(lambda c: ((Vector(c).x - (cx - w / 2)) / w, (Vector(c).z - (cz - h / 2)) / h, 1.0))), wrap=False)

def build_closed(style, M):
    G = S.Geo(1, 1, False, False); w2 = CW / 2; jt = 0.025; yl = 0.04   # (yl: the leaf's face, back from the wall plane)
    if style == 'attic':                                     # a low boarded hatch into the eaves
        hw, hz0, hz1 = 0.8, 0.18, 1.38
        wall_face(G, M['wall'], (-hw / 2 - jt, hw / 2 + jt, hz0 - jt, hz1 + jt))
        lining(G, M['wood'], -hw / 2, hw / 2, hz0, hz1, CR, jt)
        architrave(G, M['wood'], ARCH['attic'], hw / 2 + MARGIN, hz1 + MARGIN, hz0 - jt, 0.0, -1)
        G.add(block((-hw / 2 - AW - 0.01, -0.028, hz0 - jt - 0.022), (hw / 2 + AW + 0.01, 0.0, hz0 - jt + 0.004), 0.002, 1), M['wood'], wood_attrs((1, 0, 0), (0, 0, 1)), wrap=False)   # (the sill board)
        bw = boards_leaf(G, M, hw - 0.006, hz1 - hz0 - 0.006, 0.044, 4, 0.004, [], [], rough=True, front_only=True, o=(-hw / 2 + 0.003, yl + 0.022, hz0 + 0.003))
        for zc in (hz0 + 0.18, hz1 - 0.18):
            G.add(plate(strap_outline(-hw / 2 - 0.035, -hw / 2 + 0.5, zc, 0.045, 0.028, 'spear'), yl, 0.0045, bevel=0.0007), M['iron'], metal_attrs(), wrap=False)
        nails(G, M['iron'], [(-hw / 2 + 0.003 + i * (bw + 0.004) + bw * f, zc) for i in range(4) for zc in (hz0 + 0.11, hz0 + 0.25, hz1 - 0.11, hz1 - 0.25) for f in (0.35, 0.65)], yl)
        mz = (hz0 + hz1) / 2                                 # (a wooden turnbutton on the casing, a screw through it)
        G.add(block((hw / 2 - 0.02, -0.036, mz - 0.017), (hw / 2 + 0.1, -0.019, mz + 0.017), 0.003, 1), M['wood'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
        G.add(lathe_bm([(0.0, 0.005), (1.0, 0.004)], (hw / 2 + 0.04, -0.0195, mz), (hw / 2 + 0.04, -0.038, mz), 8), M['iron'], metal_attrs(), wrap=False)
        return G
    wall_face(G, M['wall'], (-w2 - jt, w2 + jt, 0.0, CH + jt))
    lining(G, M['frame'], -w2, w2, 0.0, CH, CR, jt, sill=False)
    G.add(block((-w2, 0.0, -0.001), (w2, CR, 0.012), 0.003, 1), M['sill'], wood_attrs((1, 0, 0), (0, 0, 1)), wrap=False)   # (the threshold)
    if style == 'concrete':                                  # a steel fire door in a pressed-steel frame
        architrave(G, M['frame'], STEEL_FRAME, w2, CH, 0.0, 0.0, -1)
        x0, x1, z0, z1 = -CLW / 2, CLW / 2, CLZ, CLZ + CLH; vp = (0.12, 0.27, 1.25, 1.85)
        Fd = Face((0, yl, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0)); mems = {}
        def att(k, s_, r):
            if (k, s_) not in mems: mems[(k, s_)] = metal_attrs()
            return mems[(k, s_)]
        panelled(G, Fd, (x0 + 0.004, x1 - 0.004, z0 + 0.004, z1 - 0.004), [], [], [], M['wood'], att,
                 holes=[(vp, [(-0.012, 0.0), (-0.011, 0.004), (-0.008, 0.006), (0.0, 0.006), (0.0, -0.02)])])
        perimeter(G, x0, x1, z0, z1, [(d, y + yl + 0.0225) for d, y in arris(0.045, 0.004)[:3]] + [(0.0, yl + 0.02)], M['wood'], att)
        wired_glass(G, M['glass'], M['wire'], vp[0], vp[1], vp[2], vp[3], y0=yl + 0.02)
        G.add(plate(rounded(0.045, 0.22, 0.008, 3, x1 - 0.07, 1.05), yl, 0.004), M['steel'], metal_attrs(), wrap=False)   # (lever on its backplate)
        tube(G, M['steel'], [Vector((x1 - 0.07, yl - 0.004, 1.08)), Vector((x1 - 0.07, yl - 0.05, 1.08)), Vector((x1 - 0.085, yl - 0.062, 1.08)), Vector((x1 - 0.2, yl - 0.062, 1.08))], 0.0095, 10)
        G.add(plate(rounded(CLW - 0.04, 0.3, 0.004, 2, 0.0, 0.17), yl, 0.0015), M['steel'], metal_attrs(), wrap=False)   # (kick plate)
        G.add(block((-0.33, yl - 0.055, 1.98), (0.02, yl, 2.05), 0.006, 1), M['closer'], metal_attrs(), wrap=False)    # (the closer and its arm)
        tube(G, M['closer'], [Vector((-0.02, yl - 0.05, 2.02)), Vector((0.1, yl - 0.07, 2.08)), Vector((0.28, -0.008, 2.125))], 0.007)
        sign(G, M['sign'], -0.17, 1.62, 0.3, 0.12, yl)
        return G
    panel_leaf(G, CLOSED[style], CLW, CLH, 0.045, M['wood'], back=False, o=(-CLW / 2, yl + 0.0225, CLZ))
    pl = PLINTH.get(style)
    architrave(G, M['frame'], ARCH[style], w2 + MARGIN, CH + MARGIN, pl[0] if pl else 0.0, 0.0, -1, pl)
    kx = CLW / 2 - 0.065
    if style == 'wood':
        knob_set(G, M, kx, 1.0, -1, yl, 0.065, 'brass'); finger_plate(G, M['plate'], kx, 1.2, 1.48, 0.075, -1, yl)
    elif style == 'tile':
        knob_set(G, M, kx, 0.95, -1, yl, 0.065, 'brass', big=True); finger_plate(G, M['brass'], kx, 1.1, 1.42, 0.07, -1, yl, 0.0016)
    else:
        knob_set(G, M, kx, 1.0, -1, yl, 0.06, 'steel')
        G.add(plate(rounded(CLW - 0.05, 0.22, 0.004, 2, 0.0, 0.125), yl, 0.0014), M['steel'], metal_attrs(), wrap=False)
        finger_plate(G, M['steel'], kx, 1.18, 1.48, 0.09, -1, yl, 0.0014)
        sign(G, M['sign'], 0.0, 1.62, 0.26, 0.09, yl)
    return G

# ================================================================ materials
def box_mask(m, x, z, b):
    """soft 1 inside the box (x0, x1, z0, z1, feather)"""
    x0, x1, z0, z1, f = b
    return m.math('MULTIPLY', m.math('MULTIPLY', m.remap(x, x0 - f, x0 + f, smooth=True), m.remap(x, x1 + f, x1 - f, smooth=True)),
                  m.math('MULTIPLY', m.remap(z, z0 - f, z0 + f, smooth=True), m.remap(z, z1 + f, z1 - f, smooth=True)))

def wood_base(m, g, pr, species='pine'):
    """bare wood in grain space g (z along the grain): rings round a pith far off (cathedral figure on a flat-sawn face), fibres,
       pores, knots; -> (colour, ring, fibre)"""
    early, late, rings, pores = {'pine': ('#cfae7c', '#8d5c2e', 70, 0.0), 'mahogany': ('#7e4228', '#542616', 160, 0.35), 'deal': ('#c6a676', '#7e5531', 42, 0.0)}[species]
    warp = m.noise(m.map(g, (2.5, 2.5, 0.35)), 1.0, 3, 0.5, color=True)
    wv = m.n('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); m.l(warp, wv.inputs[0]); wv.inputs[1].default_value = (0.012, 0.012, 0.0); m.l(g, wv.inputs[2])
    rg = m.n('ShaderNodeTexWave', wave_type='RINGS', rings_direction='Z', wave_profile='SAW', i_Scale=rings / 6.28, i_Distortion=1.2 if species != 'deal' else 0.7,
             i_Detail=3, i_Detail_Scale=2)
    m.l(wv.outputs[0], rg.inputs['Vector']); ring = m.math('POWER', rg.outputs['Fac'], 2.4 if species != 'mahogany' else 1.4)
    fib = m.noise(m.map(g, (900, 900, 9)), 1.0, 3, 0.7); fib2 = m.noise(m.map(g, (160, 160, 2.5)), 1.0, 4, 0.6)
    t = m.math('ADD', m.math('MULTIPLY', ring, 0.8), m.math('ADD', m.math('MULTIPLY', m.math('SUBTRACT', fib, 0.5), 0.45), m.math('MULTIPLY', m.math('SUBTRACT', fib2, 0.5), 0.4)))
    col = m.mix(m.math('ADD', t, 0.0, clamp=True), lin(early), lin(late))
    if pores: col = m.mix(m.remap(m.noise(m.map(g, (1400, 1400, 60)), 1.0, 2, 0.5), 0.62, 0.72, 0.0, pores), col, m.hsv(col, 0.5, 1.1, 0.45))
    if species != 'mahogany':
        col = m.mix(m.remap(m.voronoi(m.map(g, (4, 4, 1.3)), 1.0, 'Distance'), 0.06, 0.018), col, (0.07, 0.03, 0.012))
    col = m.hsv(col, m.remap(pr, 0, 1, 0.48, 0.52), m.remap(pr, 0, 1, 0.85, 1.12), m.remap(pr, 0, 1, 0.8, 1.15))
    return col, ring, fib

def hands_and_kicks(m, op, hands, kick):
    x, y, z = sep(m, op); hm = None
    for b in hands:
        k = box_mask(m, x, z, b[:5]); k = m.math('MULTIPLY', k, b[5]) if len(b) > 5 else k
        hm = k if hm is None else m.math('MAXIMUM', hm, k)
    return x, y, z, (hm if hm is not None else m.val(0.0)), (m.remap(z, kick, 0.0, smooth=True) if kick else m.val(0.0))

def fingerprints(m, x, z, hm, scale=48.0):
    """greasy finger and palm prints where hands go (ovals in clusters), and the general smear round them"""
    v = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(comb(m, m.math('MULTIPLY', x, scale), m.math('MULTIPLY', z, scale * 0.68), 0.0), v.inputs['Vector'])
    rc, gc, bc = sep(m, v.outputs['Color'])
    size = m.remap(gc, 0.0, 1.0, 0.22, 0.42)                                               # (a fingertip, a thumb, half a print)
    one = m.math('MULTIPLY', m.remap(m.math('DIVIDE', v.outputs['Distance'], size), 1.0, 0.45, smooth=True), m.remap(rc, 0.62, 0.7))
    clus = m.remap(m.noise(comb(m, m.math('MULTIPLY', x, 7.0), m.math('MULTIPLY', z, 5.0), 3.0), 1.0, 2, 0.5), 0.48, 0.62, smooth=True)   # (a hand's worth here and there)
    fp = m.math('MULTIPLY', m.math('MULTIPLY', one, clus), m.math('MULTIPLY', hm, m.remap(bc, 0.0, 1.0, 0.45, 1.0)))
    sm = m.math('MULTIPLY', m.remap(m.noise(comb(m, m.math('MULTIPLY', x, 14.0), m.math('MULTIPLY', z, 3.5), 0.0), 1.0, 4, 0.6), 0.38, 0.72, 0.15, 1.0), hm)
    return fp, sm

def grime_dust(m, col, rough, op, cav, age, dust_col='#8d867a', dirt=(0.06, 0.048, 0.035)):
    gr = m.math('MULTIPLY', m.remap(cav, 0.97, 0.55, smooth=True), m.remap(m.noise(op, 25, 4), 0.3, 0.7, 0.45, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.85), col, dirt); rough = m.mixf(gr, rough, 0.8)
    col = m.mix(m.remap(m.noise(op, 1.4, 4, 0.6), 0.4, 0.85, 0.0, 0.3 * age), col, m.hsv(col, 0.5, 0.9, 0.8))
    up = m.remap(sep(m, m.geo('Normal'))[2], 0.5, 0.95, smooth=True)
    dust = m.math('MULTIPLY', up, m.remap(m.noise(op, 40, 4, 0.6), 0.3, 0.75, 0.35, 0.85))
    return m.mix(dust, col, lin(dust_col)), m.mixf(dust, rough, 0.92)

def arris_dist(m, x, y, z, edges):
    """how far a point is from the piece's knocked arrises (m): a leaf's outline ('box', x0, x1, z0, z1) or the doorway lining's
       edges ('lining': the posts' and the head's front and back arrises). Analytic: a face's UV island never sees its own edge"""
    if not edges: return None
    if edges[0] == 'box':
        _, x0, x1, z0, z1 = edges
        return m.math('MINIMUM', m.math('MINIMUM', m.math('SUBTRACT', x, x0), m.math('SUBTRACT', x1, x)), m.math('MINIMUM', m.math('SUBTRACT', z, z0), m.math('SUBTRACT', z1, z)))
    xi, yl, hz = FW / 2 - POST, LIN / 2, HEAD
    dy = m.math('SUBTRACT', yl, m.math('ABSOLUTE', y)); dx = m.math('ABSOLUTE', m.math('SUBTRACT', m.math('ABSOLUTE', x), xi)); dz = m.math('ABSOLUTE', m.math('SUBTRACT', z, hz))
    ln = lambda a, b: m.math('SQRT', m.math('ADD', m.math('MULTIPLY', a, a), m.math('MULTIPLY', b, b)))
    return m.math('MINIMUM', ln(dx, dy), ln(dz, dy))

def paint(name, coats, base='pine', hands=(), kick=0.32, chips=1.0, gloss=0.34, age=1.0, craze=1.0, joints=True, rust=0.0, edges=None, top_fn=None, space=None):
    """old paint, coat over coat, on wood (or steel): brush ridges along each piece, the grain showing through as relief, yellowed
       and crazed in patches, cracked across the joints where rails meet stiles, a shrinkage line round each panel; chipped where
       knocked (edges first, the kick zone, the handled places) through the older coats to the primer and the wood (or rusting
       steel); greasy finger marks and smears where hands go, kick scuffs low down, grime in the mouldings, dust on the ledges.
       coats: newest first ['#top', '#older', '#primer']; top_fn(m) -> the top coat's colour as a socket (a stencil on it);
       space: the attribute that holds the design position (hands, kicks, edges) when it isn't the object's ('lp' on a mirrored leaf)"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); pr = m.attr('prand')
    ja = m.attr('ja'); jb = m.attr('jb'); zone = m.attr('zone'); pz = m.attr('pz')
    cav = m.math('ADD', m.cavity(), 0.0); edge = m.math('ADD', m.edge(), 0.0)
    x, y, z, hm, low = hands_and_kicks(m, m.attr(space, True) if space else op, hands, kick)
    if base == 'steel':
        wcol = m.mix(m.remap(m.noise(g, 9, 5, 0.6), 0.45, 0.6), m.mix(m.remap(m.noise(g, 30, 4), 0.3, 0.7), lin('#5e6062'), lin('#77797a')), m.mix(m.noise(g, 80, 6), lin('#4a2412'), lin('#8a4a1e')))
        ring = m.val(0.0)
    else:
        wcol, ring, fib = wood_base(m, g, pr, base); wcol = m.mix(0.45, wcol, m.hsv(wcol, 0.5, 0.6, 0.62))   # (old wood under paint: darkened)
    top = top_fn(m) if top_fn else lin(coats[0]); under = lin(coats[1]) if len(coats) > 1 else lin(coats[0]); primer = lin(coats[2]) if len(coats) > 2 else under
    brush = m.noise(m.map(g, (650, 650, 4.5)), 1.0, 3, 0.6); brush2 = m.noise(m.map(g, (120, 120, 1.2)), 1.0, 3, 0.5)
    yel = m.math('ADD', m.remap(m.noise(op, 2.2, 4, 0.55), 0.3, 0.75, 0.0, 0.65 * age), m.remap(z, 0.4, 2.6, 0.0, 0.3 * age))
    col = m.mix(yel, top, m.mix(1.0, top, (0.88, 0.79, 0.58), 'MULTIPLY'))
    col = m.mix(m.remap(m.noise(op, 5.5, 4, 0.6), 0.5, 0.72, 0.0, 0.35 * age), col, m.mix(1.0, col, (0.82, 0.76, 0.64), 'MULTIPLY'))   # (smoke and nicotine in blotches)
    col = m.mix(m.remap(brush2, 0.3, 0.7, 0.0, 0.08), col, m.hsv(col, 0.5, 1.0, 0.93)); col = m.hsv(col, 0.5, 1.0, m.remap(pr, 0, 1, 0.975, 1.025))
    h = m.math('ADD', m.math('MULTIPLY', brush, 0.00016), m.math('ADD', m.math('MULTIPLY', brush2, 0.00006), m.math('MULTIPLY', ring, 0.0001)))   # (brush ridges; the grain's relief through the coats)
    rough = m.math('ADD', m.remap(m.noise(op, 9, 3), 0.3, 0.7, gloss, gloss + 0.16), m.math('MULTIPLY', brush, 0.08))
    # crazing (alligatored old paint: cells drawn out along the grain), in patches, dirt in its cracks
    crz = m.math('MULTIPLY', m.remap(m.voronoi(m.map(g, (1, 1, 0.42)), 150, 'Distance', 'DISTANCE_TO_EDGE'), 0.035, 0.0), m.remap(m.noise(op, 1.6, 3), 0.44, 0.62, 0.0, craze * age))
    col = m.mix(m.math('MULTIPLY', crz, 0.6), col, m.hsv(col, 0.5, 1.1, 0.45)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', crz, 0.00012))
    # the joints: cracked across, chipped along; the panels' shrinkage line
    if joints:
        jd = m.math('MINIMUM', ja, jb)
        jc = m.math('MULTIPLY', m.remap(jd, 0.0011, 0.0), m.remap(m.noise(op, 22, 3), 0.3, 0.55, 0.35, 1.0))
        col = m.mix(m.math('MULTIPLY', jc, 0.85), col, (0.05, 0.04, 0.03)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', jc, 0.00025)); near_j = m.remap(jd, 0.006, 0.0)
    else: near_j = m.val(0.0)
    shrink = m.math('MULTIPLY', m.remap(zone, 1.5, 1.6), m.remap(pz, 0.55, 0.15, smooth=True))
    # chips: knocked in clusters, edges first; the kick zone, the handled places; ragged flakes; through coat after coat
    knock = m.remap(m.noise(op, 2.0, 3, 0.5), 0.5, 0.72, smooth=True); flake = m.noise(m.map(g, (1, 1, 0.6)), 26, 5, 0.65)
    ch = m.math('ADD', m.math('MULTIPLY', m.math('MULTIPLY', edge, m.math('ADD', knock, 0.55)), 0.62 * chips), m.math('SUBTRACT', flake, 0.5))
    ch = m.math('ADD', ch, m.math('ADD', m.math('MULTIPLY', knock, 0.16 * chips), m.math('ADD', m.math('MULTIPLY', low, 0.22 * chips), m.math('MULTIPLY', hm, 0.14 * chips))))
    ch = m.math('ADD', ch, m.math('ADD', m.math('MULTIPLY', near_j, 0.12 * chips), m.math('MULTIPLY', shrink, 0.25)))
    ad = arris_dist(m, x, y, z, edges)
    if ad is not None:                                       # (knocked along the arrises: chips that bite a few mm into the face)
        bite = m.math('MULTIPLY', m.remap(ad, 0.016, 0.0), m.remap(m.noise(op, 9, 4, 0.6), 0.35, 0.7, 0.15, 1.0))
        ch = m.math('ADD', ch, m.math('MULTIPLY', bite, m.math('MULTIPLY', m.math('ADD', 0.46, m.math('MULTIPLY', knock, 0.4)), chips)))
    c1 = m.remap(ch, 0.48, 0.5, smooth=True); c2 = m.remap(ch, 0.58, 0.6, smooth=True); c3 = m.remap(ch, 0.67, 0.69, smooth=True)
    col = m.mix(c1, col, m.mix(m.remap(m.noise(g, 40, 3), 0.3, 0.7), under, m.hsv(m.mix(0.0, under, under), 0.5, 0.85, 1.15)))
    col = m.mix(c2, col, primer); col = m.mix(c3, col, wcol)
    h = m.math('SUBTRACT', h, m.math('ADD', m.math('MULTIPLY', c1, 0.00016), m.math('ADD', m.math('MULTIPLY', c2, 0.00011), m.math('MULTIPLY', c3, 0.00016))))
    rough = m.mixf(c1, rough, 0.5); rough = m.mixf(c2, rough, 0.72); rough = m.mixf(c3, rough, 0.85 if base == 'steel' else 0.8)
    col = m.mix(m.math('MULTIPLY', m.math('SUBTRACT', c1, m.remap(ch, 0.52, 0.54)), 0.5), col, m.hsv(col, 0.5, 1.0, 0.55))   # (the chip's shadowed lip)
    if base == 'steel' or rust:                              # (rust blooms out from the chips and runs down from them)
        rb = m.math('MULTIPLY', m.remap(ch, 0.5, 0.66), m.remap(m.noise(op, 14, 4), 0.35, 0.7, 0.2, 1.0))
        run = m.math('MULTIPLY', m.remap(m.noise(m.map(op, (40, 40, 2.5)), 1.0, 3, 0.5), 0.55, 0.7), m.math('ADD', low, m.math('MULTIPLY', knock, 0.4)))
        rr = m.math('MAXIMUM', rb, m.math('MULTIPLY', run, 0.55 * (rust or 1.0)))
        col = m.mix(m.math('MULTIPLY', rr, 0.7), col, m.mix(m.noise(g, 60, 5), lin('#5a2a12'), lin('#8e4c22'))); rough = m.mixf(rr, rough, 0.88)
    col = m.mix(m.math('MULTIPLY', shrink, 0.85), col, m.mix(0.55, primer, (0.06, 0.045, 0.03)))   # (a sliver of old paint and dirt round each panel)
    fp, sm = fingerprints(m, x, z, hm)
    col = m.mix(m.math('MULTIPLY', sm, 0.38), col, m.mix(1.0, col, (0.7, 0.64, 0.56), 'MULTIPLY')); rough = m.mixf(m.math('MULTIPLY', sm, 0.6), rough, max(0.16, gloss - 0.12))
    col = m.mix(m.math('MULTIPLY', fp, 0.5), col, m.mix(1.0, col, (0.6, 0.55, 0.48), 'MULTIPLY')); rough = m.mixf(m.math('MULTIPLY', fp, 0.8), rough, 0.18)
    kn = m.math('MULTIPLY', low, m.remap(m.noise(m.map(op, (12, 12, 40)), 1.0, 3, 0.5), 0.6, 0.7))      # (kick marks)
    col = m.mix(m.math('MULTIPLY', kn, 0.6), col, (0.05, 0.045, 0.04))
    col = m.mix(m.math('MULTIPLY', low, m.remap(m.noise(op, 5, 4), 0.35, 0.8, 0.1, 0.5)), col, m.hsv(col, 0.5, 0.85, 0.72))
    col, rough = grime_dust(m, col, rough, op, cav, age)
    return finish(m, col, rough, h)

def mahogany(name, hands=(), kick=0.3, age=1.0, space=None):
    """mahogany under an old French polish: the ribbon stripe of quartered wood (bands along the grain that change with the light),
       deep red-brown, the shellac ambered, dull and crazed in patches, worn through to paler wood on the arrises and where hands go
       (greasy round them), a milky bloom low down where it was damp, dust in the mouldings"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); pr = m.attr('prand')
    cav = m.math('ADD', m.cavity(), 0.0); edge = m.math('ADD', m.edge(), 0.0)
    x, y, z, hm, low = hands_and_kicks(m, m.attr(space, True) if space else op, hands, kick)
    wcol, ring, fib = wood_base(m, g, pr, 'mahogany'); gx, gy, gz = sep(m, g)
    rib = m.math('SINE', m.math('ADD', m.math('MULTIPLY', gx, 85.0), m.math('MULTIPLY', m.noise(m.map(g, (3, 3, 0.5)), 1.0, 3), 7.0)))   # (soft ribbon bands, 2..5 cm)
    wcol = m.mix(m.remap(rib, -0.8, 0.9, 0.0, 0.2), wcol, m.hsv(wcol, 0.5, 1.04, 0.8))
    stained = m.hsv(m.mix(1.0, wcol, lin('#4a2214'), 'COLOR'), 0.5, 0.92, 0.33)
    stained = m.mix(m.math('MULTIPLY', ring, 0.22), stained, m.hsv(stained, 0.5, 1.08, 0.75))
    col = m.mix(1.0, stained, (0.9, 0.76, 0.55), 'MULTIPLY')
    col = m.mix(m.remap(m.noise(op, 2.0, 3, 0.5), 0.45, 0.75, 0.0, 0.3 * age), col, m.hsv(col, 0.5, 0.85, 1.25))   # (sun-faded clouds)
    rough = m.mixf(m.remap(rib, -0.2, 0.8, 0.0, 0.25), m.remap(m.noise(op, 6, 3), 0.3, 0.7, 0.16, 0.34), 0.42)       # (the ribbon in the sheen too)
    crz = m.math('MULTIPLY', m.remap(m.voronoi(m.map(g, (1, 1, 0.45)), 320, 'Distance', 'DISTANCE_TO_EDGE'), 0.04, 0.0), m.remap(m.noise(op, 1.4, 3), 0.48, 0.66, 0.0, age))
    col = m.mix(m.math('MULTIPLY', crz, 0.6), col, m.hsv(col, 0.5, 1.0, 0.5)); rough = m.mixf(crz, rough, 0.5)
    h = m.math('ADD', m.math('MULTIPLY', ring, 0.00002), m.math('SUBTRACT', m.math('MULTIPLY', fib, 0.00002), m.math('MULTIPLY', crz, 0.00008)))
    sc = m.math('MULTIPLY', m.math('MAXIMUM', m.lines(g, 9, 0.010, 70, 0.4), m.lines(g, 13, 0.008, 90, 2.1)), m.remap(m.noise(op, 3.5, 2), 0.4, 0.62, 0.0, 0.8 * age))
    col = m.mix(m.math('MULTIPLY', sc, 0.14), col, m.hsv(wcol, 0.5, 0.7, 0.8)); rough = m.mixf(m.math('MULTIPLY', sc, 0.7), rough, 0.5)
    wn = m.math('ADD', m.math('MULTIPLY', edge, 0.75), m.math('ADD', m.math('MULTIPLY', hm, 0.45), m.math('MULTIPLY', m.math('SUBTRACT', m.noise(g, 38, 5, 0.6), 0.5), 0.9)))
    thin = m.remap(wn, 0.32, 0.46, smooth=True); worn = m.remap(wn, 0.46, 0.66, smooth=True)
    col = m.mix(m.math('MULTIPLY', thin, 0.5), col, m.hsv(col, 0.5, 1.1, 1.3)); col = m.mix(worn, col, m.mix(0.4, m.hsv(wcol, 0.5, 0.85, 0.85), (0.1, 0.05, 0.03))); rough = m.mixf(worn, rough, 0.55)
    fp, sm = fingerprints(m, x, z, hm)
    col = m.mix(m.math('MULTIPLY', sm, 0.35), col, m.mix(1.0, col, (0.68, 0.62, 0.58), 'MULTIPLY')); rough = m.mixf(m.math('MULTIPLY', fp, 0.7), rough, 0.12)
    bloom = m.math('MULTIPLY', low, m.remap(m.noise(op, 4, 4), 0.4, 0.7, 0.0, 0.55))
    col = m.mix(bloom, col, m.mix(0.5, col, lin('#b9a99a'))); rough = m.mixf(bloom, rough, 0.6)
    col, rough = grime_dust(m, col, rough, op, cav, age, '#7a7064', (0.03, 0.02, 0.014))
    return finish(m, col, rough, h)

def bare_boards(name, species='deal', hands=(), age=1.0, tone=1.0):
    """old bare softwood: greyed and darkened by a century of dust and air, the soft earlywood sunk between proud latewood (raised
       grain), splits along it, dirt in everything low, dust on every ledge, grease on the handled places"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); pr = m.attr('prand')
    cav = m.math('ADD', m.cavity(), 0.0); edge = m.math('ADD', m.edge(), 0.0)
    x, y, z, hm, low = hands_and_kicks(m, op, hands, 0.3)
    wcol, ring, fib = wood_base(m, g, pr, species)
    col = m.mix(0.7, wcol, m.hsv(wcol, 0.5, 0.38, 0.55))                      # (greyed and darkened by a century of air and dust)
    col = m.mix(m.remap(m.noise(op, 1.8, 4, 0.6), 0.35, 0.8, 0.0, 0.45 * age), col, m.hsv(col, 0.5, 0.7, 0.65))
    h = m.math('ADD', m.math('MULTIPLY', ring, 0.0001), m.math('MULTIPLY', fib, 0.00012))
    split = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.noise(m.map(g, (60, 60, 0.8)), 1.0, 2, 0.5), 0.5)), 0.006, 0.0), m.remap(m.noise(g, 3, 2), 0.55, 0.65))
    col = m.mix(m.math('MULTIPLY', split, 0.9), col, (0.03, 0.022, 0.015)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', split, 0.0008))
    rough = m.remap(fib, 0.3, 0.7, 0.72, 0.9)
    col = m.mix(m.math('MULTIPLY', edge, 0.3), col, m.hsv(col, 0.5, 0.8, 1.2))
    fp, sm = fingerprints(m, x, z, hm)
    col = m.mix(m.math('MULTIPLY', sm, 0.45), col, m.mix(1.0, col, (0.6, 0.55, 0.5), 'MULTIPLY')); rough = m.mixf(m.math('MULTIPLY', sm, 0.6), rough, 0.45)
    col, rough = grime_dust(m, col, rough, op, cav, age, '#8a8276', (0.035, 0.028, 0.02))
    if tone != 1.0: col = m.hsv(col, 0.5, 1.0, tone)          # (to match boards already in the scene)
    return finish(m, col, rough, h)

def plate_mat(name, ground='#efe7d8', line='#b08a3c'):
    """a porcelain finger plate: glazed, a gilt line round it, a little transfer-printed spray of flowers, crazed, grubby"""
    m = kitlib.Mat(name); lp = m.attr('lp', True); op = m.attr('opos', True); u, v, w = sep(m, lp)
    col = m.mix(m.remap(m.noise(op, 30, 3), 0.3, 0.7, 0.0, 0.2), lin(ground), m.mix(1.0, lin(ground), (0.92, 0.88, 0.8), 'MULTIPLY'))
    du = m.math('MINIMUM', m.math('MULTIPLY', m.math('MINIMUM', u, m.math('SUBTRACT', 1.0, u)), 0.075), m.math('MULTIPLY', m.math('MINIMUM', v, m.math('SUBTRACT', 1.0, v)), 0.28))   # (metres in from the edge)
    gl = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', du, 0.0062)), 0.0007, 0.0003), w)
    col = m.mix(gl, col, lin(line))
    X = m.math('MULTIPLY', m.math('SUBTRACT', u, 0.5), 0.075); Yv = m.math('MULTIPLY', v, 0.28)       # (metres on the plate)
    def rosette(cx, cy, R, petals=5):
        dx = m.math('SUBTRACT', X, cx); dy = m.math('SUBTRACT', Yv, cy); r = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', dx, dx), m.math('MULTIPLY', dy, dy)))
        th = m.math('ARCTAN2', dy, dx); rr = m.math('MULTIPLY', m.math('ADD', 0.5, m.math('MULTIPLY', m.math('ABSOLUTE', m.math('COSINE', m.math('MULTIPLY', th, petals / 2))), 0.5)), R)
        pet = m.remap(m.math('DIVIDE', r, rr), 1.0, 0.8, smooth=True); cen = m.remap(r, R * 0.28, R * 0.18, smooth=True)
        return pet, cen
    def leaf(cx, cy, a, L, Wd):
        dx = m.math('SUBTRACT', X, cx); dy = m.math('SUBTRACT', Yv, cy); ca, sa = math.cos(a), math.sin(a)
        p = m.math('ADD', m.math('MULTIPLY', dx, ca), m.math('MULTIPLY', dy, sa)); q = m.math('SUBTRACT', m.math('MULTIPLY', dy, ca), m.math('MULTIPLY', dx, sa))
        e = m.math('ADD', m.math('MULTIPLY', m.math('DIVIDE', p, L), m.math('DIVIDE', p, L)), m.math('MULTIPLY', m.math('DIVIDE', q, Wd), m.math('DIVIDE', q, Wd)))
        return m.remap(e, 1.0, 0.75, smooth=True)
    lf = None
    for (cx, cy, a, L, Wd) in ((0.006, 0.172, 0.6, 0.009, 0.003), (-0.008, 0.15, 2.4, 0.008, 0.0028), (0.004, 0.142, -0.5, 0.0075, 0.0026), (-0.002, 0.19, 1.9, 0.007, 0.0025)):
        l_ = leaf(cx, cy, a, L, Wd); lf = l_ if lf is None else m.math('MAXIMUM', lf, l_)
    stem = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', X, m.math('MULTIPLY', m.math('SINE', m.math('MULTIPLY', Yv, 60.0)), 0.003))), 0.0007, 0.0003),
                  m.math('MULTIPLY', m.remap(Yv, 0.125, 0.135), m.remap(Yv, 0.2, 0.19)))
    col = m.mix(m.math('MULTIPLY', m.math('MAXIMUM', lf, stem), 0.85), col, lin('#6f8a58'))
    for (cx, cy, R) in ((0.0, 0.198, 0.0075), (-0.011, 0.176, 0.0058), (0.011, 0.168, 0.0052), (-0.004, 0.158, 0.0042)):
        pet, cen = rosette(cx, cy, R)
        col = m.mix(m.math('MULTIPLY', pet, 0.88), col, m.mix(m.remap(m.math('DIVIDE', m.math('SQRT', m.math('ADD', m.math('MULTIPLY', m.math('SUBTRACT', X, cx), m.math('SUBTRACT', X, cx)), m.math('MULTIPLY', m.math('SUBTRACT', Yv, cy), m.math('SUBTRACT', Yv, cy)))), R), 0.3, 1.0), lin('#a8485e'), lin('#d991a0')))
        col = m.mix(m.math('MULTIPLY', cen, 0.9), col, lin('#c9a04a'))
    crk = m.math('MULTIPLY', m.remap(m.voronoi(op, 220, 'Distance', 'DISTANCE_TO_EDGE'), 0.03, 0.0), 0.5)
    col = m.mix(crk, col, (0.25, 0.2, 0.15))
    fp = m.remap(m.noise(op, 60, 3), 0.55, 0.7, 0.0, 0.35); col = m.mix(fp, col, m.mix(1.0, col, (0.8, 0.76, 0.7), 'MULTIPLY'))
    return finish(m, col, m.mixf(fp, 0.08, 0.25), m.math('MULTIPLY', crk, -0.00005), m.math('MULTIPLY', gl, 0.9))

def sign_mat(name, ground='#e9e4d6', border='#9a2a22', rust=0.6):
    """an enamelled sign plate: white ground, a border line and a line of stencil letters read from afar, chipped to black and rust
       at the edge"""
    m = kitlib.Mat(name); lp = m.attr('lp', True); op = m.attr('opos', True); u, v, w = sep(m, lp)
    du = m.math('MINIMUM', m.math('MULTIPLY', m.math('MINIMUM', u, m.math('SUBTRACT', 1.0, u)), 2.5), m.math('MINIMUM', v, m.math('SUBTRACT', 1.0, v)))
    col = m.mix(m.remap(m.noise(op, 20, 3), 0.3, 0.7, 0.0, 0.25), lin(ground), m.mix(1.0, lin(ground), (0.9, 0.86, 0.78), 'MULTIPLY'))
    col = m.mix(m.math('MULTIPLY', m.remap(du, 0.1, 0.11), m.remap(du, 0.16, 0.15)), col, lin(border))
    letters = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', v, 0.5)), 0.17, 0.15), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', u, 0.5)), 0.33, 0.31)),
                      m.math('MULTIPLY', m.remap(m.math('SINE', m.math('MULTIPLY', u, 95.0)), 0.1, 0.5), m.remap(m.noise(comb(m, m.math('MULTIPLY', u, 12.0), 0.0, 0.0), 1.0, 1), 0.38, 0.42)))
    col = m.mix(m.math('MULTIPLY', letters, 0.85), col, lin(border))
    chip = m.math('MAXIMUM', m.remap(du, 0.05, 0.0), m.remap(m.noise(op, 18, 5, 0.65), 0.66, 0.7))
    chip = m.math('MULTIPLY', m.math('MAXIMUM', chip, m.math('MULTIPLY', m.remap(m.noise(op, 6, 3), 0.55, 0.7), m.remap(du, 0.12, 0.0))), rust)
    col = m.mix(chip, col, m.mix(m.noise(op, 70, 5), lin('#1e1a18'), lin('#6a3418')))
    return finish(m, col, m.mixf(chip, 0.12, 0.8), m.math('MULTIPLY', chip, -0.0003))

def materials(style, node):
    """the materials one node is built from (baked into its texture set, but for the reserved Glass and WallSurface)"""
    xi = FW / 2 - POST
    E = {'leaf': ('box', 0.0, LW, 0.0, LH), 'frame': ('lining',), 'closed': ('box', -CLW / 2, CLW / 2, CLZ, CLZ + CLH)}[node]
    hands = {'leaf': [(LW - 0.17, LW + 0.02, 0.88, 1.55, 0.04), (LW - 0.07, LW + 0.02, 0.6, 1.9, 0.03, 0.6)],
             'frame': [(-xi - 0.02, -xi + 0.09, 0.8, 1.7, 0.04, 0.8), (xi - 0.09, xi + 0.02, 0.8, 1.7, 0.04, 0.8)],
             'closed': [(CW / 2 - 0.17, CW / 2 + 0.02, 0.85, 1.5, 0.04), (CW / 2 - 0.07, CW / 2 + 0.02, 0.6, 1.8, 0.03, 0.6)]}[node]
    k = f'{style}_{node}'
    M = {'glass': kitlib.glass(), 'wall': kitlib.reserved('WallSurface', (0.55, 0.5, 0.45)),
         'brass': kitlib.metal(k + '_brass', 'brass', color='#9a7a45', rust=0.0, age=1.3), 'iron': kitlib.metal(k + '_iron', 'iron', rust=0.6, age=1.3),
         'steel': kitlib.metal(k + '_steel', 'steel', rust=0.15, age=1.1), 'wire': kitlib.metal(k + '_wire', 'steel', color='#555758', rust=0.3),
         'void': kitlib.grey(k + '_void', (0.008, 0.006, 0.005))}
    if style == 'wood':
        M['wood'] = paint(k + '_paint', ['#d6caae', '#6f7d5f', '#8a5a3c'], 'pine', hands, chips=1.0, gloss=0.3, age=1.3, edges=E)
        M['plate'] = plate_mat(k + '_plate'); M['knob'] = kitlib.porcelain(k + '_knob', '#ece4d4', crackle=0.5, age=1.2)
    elif style == 'tile':
        M['wood'] = mahogany(k + '_mahogany', hands)
    elif style == 'concrete':
        M['wood'] = paint(k + '_paint', ['#3f4b3b', '#7a3b28', '#7a3b28'], 'deal', hands, kick=0.45, chips=2.2, gloss=0.42, age=1.7, craze=1.4, joints=False, edges=E if node == 'frame' else None)
    elif style == 'attic':
        M['wood'] = bare_boards(k + '_boards', 'deal', hands, age=1.4, tone=0.62)   # (weathered as dark as the attic's own boards)
    else:
        M['wood'] = paint(k + '_paint', ['#3c4a3b', '#8b8a82', '#7a3b28'], 'pine', hands, kick=0.28, chips=1.3, gloss=0.32, age=1.3, edges=E)
        M['knob'] = kitlib.metal(k + '_bakelite', 'iron', color='#1c1714', rust=0.0, age=1.0)
    M['frame'] = M['wood']
    if node == 'closed':
        M['sill'] = kitlib.wood(k + '_sill', 'oak', 'bare', age=1.5)
        if style == 'concrete':
            M['wood'] = paint(k + '_steel', ['#59675c', '#8a3c26', '#8a3c26'], 'steel', [(CW / 2 - 0.3, CW / 2, 0.85, 1.4, 0.05)], kick=0.35, chips=1.2, gloss=0.36, age=1.4, craze=0.4, joints=False, rust=0.8, edges=E)
            M['frame'] = paint(k + '_frame', ['#3a3f3c', '#8a3c26', '#8a3c26'], 'steel', [], kick=0.3, chips=1.4, gloss=0.4, age=1.5, craze=0.3, joints=False, rust=0.9)
            M['closer'] = paint(k + '_closer', ['#2c2f2e', '#2c2f2e'], 'steel', [], kick=0.0, chips=0.6, gloss=0.3, age=1.2, craze=0.0, joints=False)
            M['sign'] = sign_mat(k + '_sign')
        if style == 'workshop': M['sign'] = sign_mat(k + '_sign', border='#2b3f6a', rust=0.4)
    return M

# ================================================================ build, bake, register
def finish_node(name, G, M, uv1=False):
    """the piece's mesh: the reserved parts (glass, the wall) split off, the rest unwrapped and baked (paint, wood and metal into one
       texture set), then joined back together with the baked material first; uv1 (a lightmap layout) on everything if asked"""
    ob = G.build(name + '_bake'); reserved = [M['glass'], M['wall']]
    keep = [i for i, m in enumerate(ob.data.materials) if m in reserved]; res_obj = None
    if keep:
        bm = bmesh.new(); bm.from_mesh(ob.data); rbm = bm.copy()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in keep], context='FACES')
        bmesh.ops.delete(rbm, geom=[f for f in rbm.faces if f.material_index not in keep], context='FACES')
        for b in (bm, rbm): bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context='VERTS')
        me2 = ob.data.copy(); rbm.to_mesh(me2); rbm.free(); bm.to_mesh(ob.data); bm.free(); ob.data.update(); me2.update()
        res_obj = kitlib.link(bpy.data.objects.new(name + '_res', me2))
    kitlib.unwrap([ob], margin=0.003, smart=True, angle=60)
    files = kitlib.bake_set([ob], name, PX, 64)
    mat = kitlib.baked_material('Kit_' + name, files)
    ob.data.materials.clear(); ob.data.materials.append(mat)
    ob.data.polygons.foreach_set('material_index', [0] * len(ob.data.polygons))
    parts = [ob]
    if res_obj:
        if not res_obj.data.uv_layers: res_obj.data.uv_layers.new(name=ob.data.uv_layers[0].name)
        parts.append(res_obj)
    for o in parts:
        for a in [a.name for a in o.data.attributes if a.name in ATTRS]: o.data.attributes.remove(o.data.attributes[a])
    if len(parts) > 1: ob = kitlib.join(parts, name)
    used = sorted(set(p.material_index for p in ob.data.polygons)); uniq = []   # (each material the faces use, once, the baked one first)
    for m in sorted((ob.data.materials[i] for i in used), key=lambda m: 0 if m.name.startswith('Kit_') else 1):
        if m not in uniq: uniq.append(m)
    mi = [uniq.index(ob.data.materials[p.material_index]) for p in ob.data.polygons]
    ob.data.materials.clear()
    for m in uniq: ob.data.materials.append(m)
    ob.data.polygons.foreach_set('material_index', mi)
    if uv1:
        if len(ob.data.uv_layers) < 2: ob.data.uv_layers.new(name='UV1')
        ob.data.uv_layers.active_index = 1; kitlib.select([ob], ob)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_MARGIN_DIV=0.3)
        bpy.ops.object.mode_set(mode='OBJECT'); ob.data.uv_layers.active_index = 0; ob.data.uv_layers[0].active_render = True
    ob.name = name; ob.data.name = name; ob['kit'] = 'arch'; ob.location = (0, 0, 0)
    return ob, files

def build_style(style):
    t0 = time.time(); kitlib.reset(); info = {}; roots = []
    for node, build, uv1 in (('leaf', build_leaf, False), ('frame', build_frame, False), ('closed', build_closed, True)):
        name = f'Door_{node}_{style}'; M = materials(style, node); G = build(style, M)
        ob, f = finish_node(name, G, M, uv1); roots.append(ob)
        info[node] = {'tris': kitlib.tris(ob), 'bake': f['times']['total']}
        print(f'  {name}: {info[node]["tris"]} triangles, baked in {info[node]["bake"]}s', flush=True)
    if '--sheets' in sys.argv: sheets(style, roots)
    json.dump(info, open(os.path.join(TMP, f'doors_{style}.json'), 'w'), indent=1)
    kitlib.register(f'doors_{style}', roots)
    print(f'doors {style}: done in {time.time() - t0:.0f}s', flush=True)

# ================================================================ contact sheets
def sheets(style, roots):
    """renders of what ships (the baked materials): the frame with both leaves open in a doorway of the style's own walls and floor
       (and close in on the frame), the leaf closed from both sides and close in a raking light, the closed door in its wall"""
    from PIL import Image
    leaf, frame, closed = roots; d = os.path.join(TMP, 'sheets', 'doors'); os.makedirs(d, exist_ok=True)
    man = S.manifest_load()['styles'].get(style, {}); sc = bpy.context.scene; tmp = []
    def keep(o): tmp.append(o); return o
    fl = S.ship_mat('sh_floor', man['floor']) if man.get('floor') else kitlib.grey()
    wA = S.ship_mat('sh_wallA', man['wall'], 0) if man.get('wall') else kitlib.grey()
    sc.world.color = (0.04, 0.04, 0.045)
    for i in range(-2, 3): keep(S.quad(f'sh_f{i}', (-FW / 2, i * FW, 0), (FW, 0, 0), (0, FW, 0), mat=fl))
    corridor = []
    for i in range(-2, 3):
        corridor.append(keep(S.quad(f'sh_wl{i}', (-FW / 2, i * FW, 0), (0, FW, 0), (0, 0, 3.0), mat=wA)))
        corridor.append(keep(S.quad(f'sh_wr{i}', (FW / 2, (i + 1) * FW, 0), (0, -FW, 0), (0, 0, 3.0), mat=wA)))
    corridor.append(keep(S.quad('sh_hd0', (-FW / 2, -0.14, TOP), (FW, 0, 0), (0, 0, 3.0 - TOP), (0, TOP / 3.0), (1, 1), mat=wA)))
    corridor.append(keep(S.quad('sh_hd1', (FW / 2, 0.14, TOP), (-FW, 0, 0), (0, 0, 3.0 - TOP), (0, TOP / 3.0), (1, 1), mat=wA)))
    keep(S.quad('sh_ceil', (-FW / 2, 3 * FW, 3.0), (FW, 0, 0), (0, -6 * FW, 0), mat=kitlib.grey('sh_ceilm', (0.55, 0.53, 0.5))))
    lv = []
    for sx in (-1, 1):
        o = keep(kitlib.link(bpy.data.objects.new(f'sh_leaf{sx}', leaf.data))); lv.append(o)
        o.location = (sx * (FW / 2 - POST), 0.2 + LT / 2, 0); o.scale = (-1 if sx > 0 else 1, 1, 1); o.rotation_euler = (0, 0, math.radians(78 if sx < 0 else -78))
    keep(S.lamp('sh_key', 'AREA', 150, (0.3, -1.6, 2.9), (0, 0, 0), 1.2, (1.0, 0.86, 0.68)))
    keep(S.lamp('sh_fill', 'AREA', 70, (-0.6, 2.5, 2.8), (0, 0, 0), 1.5, (0.75, 0.82, 1.0)))
    rk = keep(S.lamp('sh_rake', 'SPOT', 260, (1.0, -1.2, 1.7), None, 0.05, (1.0, 0.9, 0.75))); rk.data.spot_size = math.radians(70)
    rk.rotation_euler = (Vector((-0.6, 0.2, 1.3)) - rk.location).to_track_quat('-Z', 'Y').to_euler()
    glm = kitlib.Mat('sh_glass'); glm.b.inputs['Transmission Weight'].default_value = 1.0; glm.b.inputs['Roughness'].default_value = 0.05
    glm.b.inputs['Base Color'].default_value = (0.9, 0.93, 0.9, 1); swaps = []
    for o in roots:
        for i, mm in enumerate(o.data.materials):
            if mm.name == 'Glass': swaps.append((o, i, mm)); o.data.materials[i] = glm.m
    leaf.hide_render = closed.hide_render = True; shots = []
    S.cam_at((0.35, -3.4, 1.6), (0.0, 0.0, 1.35), 30); shots.append(S.render(os.path.join(d, f'{style}_doorway.png'), 1100, 900, 128))
    S.cam_at((-0.4, -0.8, 1.3), (-0.98, 0.15, 1.05), 40); shots.append(S.render(os.path.join(d, f'{style}_frame_close.png'), 1100, 900, 128))
    for o in lv + corridor: o.hide_render = True
    frame.hide_render = True; leaf.hide_render = False; leaf.location = (-LW / 2, 1.0, 0)
    S.cam_at((0.0, -2.7, 1.3), (0.0, 1.0, 1.28), 50); shots.append(S.render(os.path.join(d, f'{style}_leaf_front.png'), 700, 1100, 128))
    S.cam_at((0.0, 4.7, 1.3), (0.0, 1.0, 1.28), 50); shots.append(S.render(os.path.join(d, f'{style}_leaf_back.png'), 700, 1100, 128))
    S.cam_at((0.6, 0.2, 1.4), (0.3, 1.0, 1.1), 45); shots.append(S.render(os.path.join(d, f'{style}_leaf_close.png'), 1100, 900, 128))
    leaf.location = (0, 0, 0); leaf.hide_render = True; closed.hide_render = False; closed.location = (0, 1.4, 0)
    ws = [i for i, m in enumerate(closed.data.materials) if m.name == 'WallSurface']; old = list(closed.data.materials)
    if ws:                                                   # (the wall shown in the style's wall, mapped as the game maps it)
        closed.data.materials[ws[0]] = wA; uv = closed.data.uv_layers[0].data
        for p in closed.data.polygons:
            if p.material_index == ws[0]:
                for li in p.loop_indices:
                    c = closed.data.vertices[closed.data.loops[li].vertex_index].co; uv[li].uv = (0.5 + c.x / FW, c.z / 3.0)
    keep(S.quad('sh_cwl', (-FW / 2 - FW, 1.4, 0), (FW, 0, 0), (0, 0, 3.0), mat=wA)); keep(S.quad('sh_cwr', (FW / 2, 1.4, 0), (FW, 0, 0), (0, 0, 3.0), mat=wA))
    S.cam_at((0.6, -1.7, 1.45), (0.0, 1.4, 1.2), 32); shots.append(S.render(os.path.join(d, f'{style}_closed.png'), 1100, 900, 128))
    S.cam_at((0.4, 0.6, 1.25), (0.25, 1.4, 1.0), 45); shots.append(S.render(os.path.join(d, f'{style}_closed_close.png'), 1100, 900, 128))
    if ws: closed.data.materials[ws[0]] = old[ws[0]]
    for o, i, mm in swaps: o.data.materials[i] = mm
    closed.location = (0, 0, 0)
    for o in roots: o.hide_render = False
    for o in tmp:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o)
    ims = [Image.open(p).convert('RGB') for p in shots]; hgt = 600
    ims = [im.resize((int(im.width * hgt / im.height), hgt)) for im in ims]
    out = Image.new('RGB', (sum(i.width for i in ims), hgt)); x = 0
    for im in ims: out.paste(im, (x, 0)); x += im.width
    out.save(os.path.join(d, f'{style}_doors.png'))

def main():
    for st in [s for s in defs.KIT['styles'] if OPTS.want(s)]:
        if kitlib.fresh_asset(f'doors_{st}') and '--sheets' not in sys.argv: print(f'doors {st} up to date'); continue
        build_style(st)

if __name__ == '__main__':
    main()
