# Escape from Barbi Blue: the attic's furniture (WP2.5d, attic style; build spec B3, B4, B5, B6).
#   Solid_truss_post         a hand-hewn pine post on a stone pad up to the truss tie (2.6 m), stop-chamfered, an iron strap and bolts
#                            at its head, a coil of rope hung on a big nail
#   Solid_sheet_chair_v0/v1  a button-back armchair under a dust sheet: v0 covered to its castors, v1 the sheet slipped back off it
#   Solid_sheet_tall_v0/v1   a tall cabinet with a dust sheet thrown over its top: v0 a panelled wardrobe, v1 a tallboy of drawers
#   Solid_sheet_sofa         a sofa under a long dust sheet, its turned feet showing
#   Solid_steamer_trunk_v0/v1  steamer trunks, canvas over pine with oak slats, brass corners, leather handles and straps, travel
#                            labels: v0 the round-topped kind, v1 flat-topped
#   Col_chimney_breast_H400  the brick stack through the roof space: soot leaching from the joints, patches of lime parging, a soot door
#                            and a capped flue hole
#   Solid_iron_bed_sheeted   an iron bedstead, head to the wall, its mattress under a dust sheet; the rails and brass knobs show
#   The dust sheets are simulated cloth (Blender's cloth solver, furnlib.cloth_drape) settled over the real furniture.
#   wall pieces: furn_attic2.py; islands: furn_attic3.py
#   py -3.11 tools/blender/kit/furn_attic.py [--preview] [--force] [--only truss_post,sheet_chair,...,bands,islands] [--sheets]
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
from kitlib import OPTS, lin

STYLE = 'attic'
random.seed(401)

# ================================================================ materials
def dust_sheet_mat(name, base='#d4ccb9'):
    """an old cotton dust sheet: yellowed in clouds, the creases of years folded in a press (on the flat sheet's own u, v), tide
       marks where a leak dripped on it, mildew freckles, grey dust lying thick on whatever faces up, darker down in the folds"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); u, v, _ = sep(m, g); c = lin(base)
    col = m.mix(m.remap(m.noise(g, 1.4, 3), 0.35, 0.72), c, lin('#bfae8c'))
    cu = m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', u, 0.31)), 0.5)), 0.485, 0.5)
    cv = m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', v, 0.43)), 0.5)), 0.485, 0.5)
    crease = m.math('MAXIMUM', cu, cv); col = m.mix(m.math('MULTIPLY', crease, 0.45), col, m.hsv(col, 0.5, 1.1, 0.72))
    d = m.voronoi(m.map(g, (1, 1, 1)), 2.2, 'Distance')
    ring = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(d, 0.3, 0.315), m.remap(d, 0.345, 0.33)), m.remap(m.noise(g, 2.0, 2), 0.5, 0.6))
    col = m.mix(m.math('MULTIPLY', ring, 0.7), col, lin('#8e7550'))
    stain = m.math('MULTIPLY', m.remap(d, 0.33, 0.2), m.remap(m.noise(g, 2.0, 2), 0.5, 0.6)); col = m.mix(m.math('MULTIPLY', stain, 0.35), col, lin('#a99068'))
    mil = m.math('MULTIPLY', m.remap(m.noise(g, 55, 3), 0.68, 0.76), m.remap(m.noise(g, 2.5, 2), 0.55, 0.7)); col = m.mix(mil, col, lin('#4c4a38'))
    nz = sep(m, m.geo('Normal'))[2]; du = m.math('MULTIPLY', m.remap(nz, 0.25, 0.9), m.remap(m.noise(op, 5, 3), 0.25, 0.7, 0.45, 1.0))
    col = m.mix(m.math('MULTIPLY', du, 0.75), col, lin('#8c877d'))
    h = m.math('ADD', m.math('MULTIPLY', m.noise(m.map(g, (1, 1, 1)), 600, 2), 0.00025), m.math('MULTIPLY', crease, -0.0006))
    return finish(m, col, m.mixf(du, 0.9, 0.97), h)

def att_mats(k):
    import furn_tile as T, furn_concrete as C
    M = {}
    M['sheet'] = dust_sheet_mat(k + '_sheet'); M['sheet2'] = dust_sheet_mat(k + '_sheet2', '#cdc7b8')
    M['timber'] = kitlib.wood(k + '_timber', 'oak', 'bare', stain='#3e3226', age=2.0); M['pine'] = kitlib.wood(k + '_pine', 'pine', 'bare', stain='#8a7a62', age=1.8); M['stone'] = kitlib.plaster(k + '_stone', '#8a857a', age=2.0)
    M['iron'] = kitlib.metal(k + '_iron', 'iron', rust=0.7, age=1.8); M['rope'] = kitlib.fabric(k + '_rope', '#9a855c', weave=0.0, stripes=('#6a5a3a', 0.006), age=2.0)
    M['mahogany'] = Dr.mahogany(k + '_mahogany'); M['velvet'] = kitlib.fabric(k + '_velvet', '#5a2a3a', weave=0.0, fade=0.7, velvet=True, age=2.0)
    M['brass'] = kitlib.metal(k + '_brass', 'brass', rust=0.0, age=1.9); M['walnut'] = kitlib.wood(k + '_walnut', 'elm', 'varnish', stain='#3a2618', age=2.0)
    M['brick'] = C.pier_brick(k + '_brick', wash=-9.0)
    M['parge'] = kitlib.plaster(k + '_parge', '#b5ad9c', age=2.4); M['soot'] = kitlib.grey(k + '_soot', (0.012, 0.011, 0.01))
    M['bediron'] = Dr.paint(k + '_bediron', ['#1c1c1a', '#4a4a44', '#3a3836'], 'steel', [], kick=0.2, chips=0.7, gloss=0.3, age=2.0, craze=0.0, joints=False, rust=0.8)
    M['ticking'] = kitlib.fabric(k + '_ticking', '#cfc6b0', weave=0.0, fade=0.6, stripes=('#4e5e7e', 0.022), age=2.2)
    M['canvas'] = kitlib.fabric(k + '_canvas', '#5a5a3c', weave=0.0, fade=0.6, age=2.2); M['canvas2'] = kitlib.fabric(k + '_canvas2', '#3e2e24', weave=0.0, fade=0.5, age=2.2)
    M['oak'] = kitlib.wood(k + '_oak', 'oak', 'varnish', stain='#5a3a1e', age=2.2); M['leather'] = kitlib.fabric(k + '_leather', '#4a2a1a', weave=0.0, fade=0.5, age=2.0)
    for i, (a, b) in enumerate((('#c43a2a', '#e8d8a0'), ('#2a4a8a', '#e6dcc0'), ('#e2c060', '#2a2a2a'), ('#3a7a4a', '#f0e6c8'))): M[f'label{i}'] = kitlib.fabric(f'{k}_label{i}', a, weave=0.0, fade=0.8, stripes=(b, 0.035), age=2.2)
    return M

# ================================================================ helpers
def geo_bmesh(fn):
    """the bmesh (world) of whatever fn(G) builds: a collider for the cloth"""
    Gt = S.Geo(1, 1, False, False); fn(Gt); ob = Gt.build('_coltmp'); bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.transform(bm, matrix=ob.matrix_world, verts=bm.verts)
    me = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); return bm

def hulls(bm, groups, inflate=0.01):
    """closed convex hulls of the vertices each predicate picks (seat, arms, back...), pushed out a centimetre: solid colliders the
       cloth can't work its way through, a little proud of the real thing so the sheet never cuts into it -> [bmesh]"""
    out = []
    for pred in groups:
        pts = [v.co.copy() for v in bm.verts if pred(v.co)]
        if len(pts) < 4: continue
        h = bmesh.new(); [h.verts.new(q) for q in pts]; h.verts.ensure_lookup_table()
        bmesh.ops.convex_hull(h, input=h.verts[:])
        bmesh.ops.delete(h, geom=[v for v in h.verts if not v.link_faces], context='VERTS')
        cen = sum((v.co for v in h.verts), Vector()) / max(1, len(h.verts))
        for v in h.verts: v.co += (v.co - cen).normalized() * inflate
        bmesh.ops.recalc_face_normals(h, faces=h.faces); out.append(h)
    return out

def blocks_bmesh(boxes):
    bm = bmesh.new()
    for lo, hi in boxes:
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r['verts']: v.co = Vector([lo[i] + (v.co[i] + 0.5) * (hi[i] - lo[i]) for i in range(3)])
    return bm

def add_sheet(G, M, bm, uv, box_lo=None, box_hi=None, mat='sheet'):
    """the settled sheet into G: kept inside the piece's box (a fold pushed in where it pooled too far), its flat u, v as gpos"""
    if box_lo is not None:
        for v in bm.verts:
            for i in range(3): v.co[i] = min(max(v.co[i], box_lo[i]), box_hi[i])
    key = lambda c: tuple(round(x, 5) for x in c)
    uvk = {}
    for v in bm.verts: uvk[key(v.co)] = uv.get(key(v.co), (0.0, 0.0))
    G.add(bm, M[mat], attrs_of(lambda c: (uvk.get(key(c), (0.0, 0.0))[0], uvk.get(key(c), (0.0, 0.0))[1], 0.0), 0.5), smooth=True, wrap=False)
    G.double = True

def sheet_over(G, M, colliders, size, segs, loc, rot, box_lo, box_hi, frames=55, tilt=(0.0, 0.0), mat='sheet', bend=0.22):
    # (the uv map is keyed by the settled positions, so clamp after the lookup table is made: add_sheet does both)
    pts = [v.co.copy() for cb in colliders for v in cb.verts]
    inner_lo = [min(q[i] for q in pts) - 0.012 for i in range(3)]; inner_hi = [max(q[i] for q in pts) + 0.012 for i in range(3)]
    bm, uv = F.cloth_drape(colliders, size, segs, loc, frames, rot, bend=bend, tilt=tilt)
    key = lambda c: tuple(round(x, 5) for x in c)
    flat = {v.index: uv.get(key(v.co), (0.0, 0.0)) for v in bm.verts}
    squeeze(bm, box_lo, box_hi, inner_lo, inner_hi)
    uv2 = {key(v.co): flat[v.index] for v in bm.verts}
    add_sheet(G, M, bm, uv2, mat=mat)

def squeeze(bm, lo, hi, inner_lo, inner_hi, keep=0.8):
    """where the sheet pooled out past the piece's box, its outer band pressed in (the folds kept, only closer together) rather than
       cut off flat: along x and y, each side, only what lies beyond the furniture under it (inner_lo, inner_hi: never pushed into
       it) and beyond keep of the half-width; nothing above the top"""
    for i in (0, 1):
        c = (lo[i] + hi[i]) / 2; h = (hi[i] - lo[i]) / 2
        for side in (-1, 1):
            a = min(max(keep * h, side * ((inner_hi if side > 0 else inner_lo)[i] - c)), h - 0.002)
            ext = max([side * (v.co[i] - c) for v in bm.verts] + [0.0])
            if ext <= h: continue
            k = (h - a) / (ext - a)
            for v in bm.verts:
                d = side * (v.co[i] - c)
                if d > a: v.co[i] = c + side * (a + (d - a) * k)
    for v in bm.verts: v.co.z = min(max(v.co.z, lo[2]), hi[2])

# ================================================================ the truss post
def truss_post(G, M, rnd, H=2.6):
    box(G, M['stone'], (-0.125, -0.125, 0.0), (0.125, 0.125, 0.05), ma(0.3), 0.008, 1)
    box(G, M['timber'], (-0.11, -0.11, 0.05), (0.11, 0.11, H - 0.1), wa((0, 0, 1), wear=0.4), 0.014, 1)
    box(G, M['timber'], (-0.125, -0.125, H - 0.1), (0.125, 0.125, H), wa((1, 0, 0)), 0.006, 1)
    for sy in (-1, 1):                                                         # (the iron strap over the head, bolted through)
        box(G, M['iron'], (-0.02, sy * 0.11 - (0.006 if sy < 0 else 0), H - 0.42), (0.02, sy * 0.11 + (0.006 if sy > 0 else 0), H - 0.08), ma(0.4), 0.001)
        for z in (H - 0.37, H - 0.22): G.add(lathe_bm([(0.0, 0.013), (1.0, 0.013)], (0, sy * 0.116, z), (0, sy * 0.124, z), 6), M['iron'], ma(0.5), wrap=False)
    for z, x in ((0.9, 0.04), (1.3, -0.05), (2.1, 0.02)):                     # (old nails and a hook)
        G.add(lathe_bm([(0.0, 0.004), (1.0, 0.003)], (x, -0.11, z), (x, -0.13, z - 0.004), 5), M['iron'], ma(0.4), wrap=False)
    n0 = Vector((0.0, -0.11, 1.78))                                            # (a big nail, a coil of rope hung flat on it)
    G.add(lathe_bm([(0.0, 0.006), (0.9, 0.005), (1.0, 0.01)], n0, n0 + Vector((0, -0.032, 0.008)), 6), M['iron'], ma(0.4), wrap=False)
    for k in range(4):
        cc = n0 + Vector((0.004 * k - 0.006, -0.019 - 0.002 * k, -0.118 - 0.008 * k)); r = 0.115 - 0.005 * k
        ring = [cc + Vector((r * math.sin(t) * 0.95, 0.003 * math.sin(3 * t + k), r * math.cos(t))) for t in np.linspace(0, 2 * math.pi, 21)]
        F.rod(G, M['rope'], ring, 0.008, 6, fa(rnd), caps=(False, False))

# ================================================================ sheeted chairs, cabinets, sofa
def chair_parts(G, M, seed, legs_only=False):
    import furn_tile3 as T3
    rnd = random.Random(seed)
    if not legs_only: T3.button_chair(G, M, (0.0, 0.0, 0.0), (0.0, -1.0), rnd, 1.08, 'velvet', 0.7, 0.7, 0.64); return
    W, D = 0.7, 0.7; P = lambda a, b, z: Vector((a, -b, z))
    for a in (-W / 2 + 0.06, W / 2 - 0.06):
        for b in (-D / 2 + 0.07, D / 2 - 0.06):
            turned(G, M['mahogany'], [(0.0, 0.022), (0.2, 0.028), (0.5, 0.032), (0.8, 0.026), (1.0, 0.03)], P(a, b, 0.04), P(a, b, 0.21), 8, attrs=wa((0, 0, 1)))
            G.add(lathe_bm([(0.0, 0.02), (1.0, 0.02)], P(a, b, 0.04) - Vector((0.008, 0, 0)), P(a, b, 0.04) + Vector((0.008, 0, 0)), 10), M['brass'], ma(), wrap=False)
    box(G, M['velvet'], (-W / 2 + 0.02, -D / 2 + 0.05, 0.2), (W / 2 - 0.02, D / 2, 0.36), fa(rnd, 3, 3), 0.03, 2)

CHAIR_PARTS = [lambda c: c.z > 0.19 and c.z < 0.62 and abs(c.x) < 0.36 and c.y < 0.3, lambda c: c.x < -0.18 and c.z > 0.35, lambda c: c.x > 0.18 and c.z > 0.35,
               lambda c: c.y > 0.08 and c.z > 0.35] + [(lambda c, sx=sx, sy=sy: c.z < 0.22 and c.x * sx > 0.2 and c.y * sy > 0.2) for sx in (-1, 1) for sy in (-1, 1)]

def sheet_chair(G, M, rnd, v):
    col = hulls(geo_bmesh(lambda Gt: chair_parts(Gt, M, 7)), CHAIR_PARTS)
    if v == 0:                                                                 # (the chair 6 cm forward: room behind for the sheet's hem)
        P = F.Moved(G, Matrix.Translation((0.0, -0.06, 0.0)))
        chair_parts(P, M, 7, legs_only=True)
        sheet_over(P, M, col, (1.75, 1.66), (32, 30), (0.0, 0.0, 1.3), 0.2, (-0.47, -0.41, 0.0), (0.47, 0.53, 1.11), 55); G.double = True
    else:                                                                      # (a broader chair, the sheet slipped back off it: built at 1/1.13 and widened)
        k = 1.13; P = F.Moved(G, Matrix.Diagonal((k, k, 1.0, 1.0)))
        chair_parts(P, M, 7)
        sheet_over(P, M, col, (1.5, 1.42), (30, 28), (0.06, 0.1, 1.3), -0.4, (-0.47 / k, -0.47 / k, 0.0), (0.47 / k, 0.47 / k, 1.11), 55, tilt=(0.25, -0.1)); G.double = True

def wardrobe(G, M, rnd, W=0.9, D=0.58, H=1.925):
    y0 = -D / 2
    box(G, M['walnut'], (-W / 2, y0, 0.0), (W / 2, D / 2, 0.1), wa((1, 0, 0), wear=0.4), 0.004, 1)
    box(G, M['walnut'], (-W / 2 + 0.01, y0 + 0.01, 0.1), (W / 2 - 0.01, D / 2 - 0.01, H - 0.08), wa((0, 0, 1)), 0.003, 1)
    box(G, M['walnut'], (-W / 2 - 0.03, y0 - 0.03, H - 0.08), (W / 2 + 0.03, D / 2 + 0.01, H), wa((1, 0, 0)), 0.006, 2)
    for sx in (-1, 1):                                                         # (two panelled doors, a drawer under them)
        x0, x1 = (sx * 0.004, sx * (W / 2 - 0.03))
        x0, x1 = min(x0, x1), max(x0, x1)
        box(G, M['walnut'], (x0, y0 - 0.012, 0.36), (x1, y0 + 0.01, H - 0.12), wa((0, 0, 1)), 0.003, 1)
        for z0, z1 in ((0.43, 0.98), (1.05, H - 0.2)): box(G, M['walnut'], (x0 + 0.06, y0 - 0.02, z0), (x1 - 0.06, y0 - 0.012, z1), wa((0, 0, 1)), 0.01, 2)
        G.add(lathe_bm([(0.0, 0.008), (0.7, 0.012), (1.0, 0.0)], (sx * 0.03, y0 - 0.012, 1.02), (sx * 0.03, y0 - 0.035, 1.02), 8), M['brass'], ma(0.5), smooth=True, wrap=False)
    box(G, M['walnut'], (-W / 2 + 0.03, y0 - 0.012, 0.12), (W / 2 - 0.03, y0 + 0.01, 0.33), wa((1, 0, 0)), 0.003, 1)
    for sx in (-1, 1): G.add(lathe_bm([(0.0, 0.01), (0.7, 0.014), (1.0, 0.0)], (sx * 0.2, y0 - 0.012, 0.225), (sx * 0.2, y0 - 0.04, 0.225), 8), M['brass'], ma(0.5), smooth=True, wrap=False)

def tallboy(G, M, rnd, W=0.88, D=0.56, H=1.925):
    y0 = -D / 2
    box(G, M['mahogany'], (-W / 2, y0, 0.0), (W / 2, D / 2, 0.12), wa((1, 0, 0), wear=0.4), 0.004, 1)
    box(G, M['mahogany'], (-W / 2 + 0.01, y0 + 0.01, 0.12), (W / 2 - 0.01, D / 2 - 0.01, H - 0.06), wa((0, 0, 1)), 0.003, 1)
    box(G, M['mahogany'], (-W / 2 - 0.025, y0 - 0.025, H - 0.06), (W / 2 + 0.025, D / 2 + 0.01, H), wa((1, 0, 0)), 0.006, 2)
    zs = [0.14, 0.41, 0.68, 0.93, 1.16, 1.38, 1.6, H - 0.08]
    for k in range(len(zs) - 1):
        z0, z1 = zs[k] + 0.006, zs[k + 1] - 0.006; split = k >= 5
        for x0, x1 in (((-W / 2 + 0.03, -0.004), (0.004, W / 2 - 0.03)) if split else ((-W / 2 + 0.03, W / 2 - 0.03),)):
            box(G, M['mahogany'], (x0, y0 - 0.014, z0), (x1, y0 + 0.01, z1), wa((1, 0, 0), wear=0.3), 0.004, 1)
            for x in ((x0 + x1) / 2 - 0.1, (x0 + x1) / 2 + 0.1) if not split else ((x0 + x1) / 2,):
                G.add(lathe_bm([(0.0, 0.01), (0.7, 0.014), (1.0, 0.0)], (x, y0 - 0.014, (z0 + z1) / 2), (x, y0 - 0.04, (z0 + z1) / 2), 8), M['brass'], ma(0.5), smooth=True, wrap=False)

def sheet_tall(G, M, rnd, v):
    fn = wardrobe if v == 0 else tallboy
    col = geo_bmesh(lambda Gt: fn(Gt, M, random.Random(3)))
    fn(G, M, random.Random(3))
    lo, hi = (-0.495, -0.35, 0.0), (0.495, 0.35, 1.97)
    if v == 0: sheet_over(G, M, [col], (2.5, 1.9), (40, 32), (0.18, 0.0, 2.15), 0.12, lo, hi, 90, tilt=(0.0, 0.12))
    else: sheet_over(G, M, [col], (2.2, 2.0), (36, 34), (-0.15, 0.05, 2.12), -0.45, lo, hi, 90, tilt=(0.1, -0.15), mat='sheet2')

def sofa_parts(G, M, rnd, L=2.0, D=0.9):
    for y in (-L / 2 + 0.08, 0.0, L / 2 - 0.08):
        for x in (-D / 2 + 0.07, D / 2 - 0.07):
            if y == 0.0 and x < 0: continue
            turned(G, M['mahogany'], [(0.0, 0.022), (0.2, 0.03), (0.5, 0.034), (0.8, 0.026), (1.0, 0.03)], (x, y, 0.03), (x, y, 0.2), 8, attrs=wa((0, 0, 1)))
            G.add(lathe_bm([(0.0, 0.02), (1.0, 0.02)], (x - 0.008, y, 0.03), (x + 0.008, y, 0.03), 10), M['brass'], ma(), wrap=False)
    box(G, M['velvet'], (-D / 2, -L / 2, 0.2), (D / 2, L / 2, 0.42), fa(rnd, 3, 3), 0.03, 2)
    pillow(G, M['velvet'], (0.04, 0.0, 0.47), D - 0.2, L - 0.3, 0.12, rnd, n=6, sag=0.3)
    box(G, M['velvet'], (D / 2 - 0.2, -L / 2, 0.42), (D / 2, L / 2, 0.935), fa(rnd, 3, 3), 0.06, 2)             # (the back, against +x)
    for sy in (-1, 1): box(G, M['velvet'], (-D / 2, sy * (L / 2 - 0.09) - 0.09, 0.42), (D / 2 - 0.15, sy * (L / 2 - 0.09) + 0.09, 0.68), fa(rnd, 3, 3), 0.06, 2)

SOFA_PARTS = [lambda c: 0.19 < c.z < 0.62, lambda c: c.x > 0.2 and c.z > 0.4, lambda c: c.y < -0.8 and c.z > 0.4, lambda c: c.y > 0.8 and c.z > 0.4]

def sheet_sofa(G, M, rnd):
    col = hulls(geo_bmesh(lambda Gt: sofa_parts(Gt, M, random.Random(5))), SOFA_PARTS)
    sofa_parts(G, M, random.Random(5))
    sheet_over(G, M, col, (1.9, 2.55), (32, 44), (0.02, 0.0, 1.15), 0.06, (-0.475, -1.1, 0.0), (0.475, 1.1, 0.955), 60)

# ================================================================ steamer trunks
def trunk(G, M, rnd, W=0.9, D=0.5, H=0.6, dome=0.0, c=(0, 0, 0), rot=0.0, labels=3):
    """a steamer trunk round c: canvas over the pine, oak slats round it and over the lid, brass corners, a lock plate, leather
       handles in iron loops at the ends, two straps over the lid, travel labels pasted on"""
    c = Vector(c); R = Matrix.Rotation(rot, 4, 'Z'); Mx = Matrix.Translation(c) @ R
    Pm = F.Moved(G, Mx); hl = H - dome - 0.01                                   # (the body's top, the lid's seam)
    box(Pm, M['canvas'], (-W / 2, -D / 2, 0.0), (W / 2, D / 2, hl), fa(rnd, 3, 3), 0.008, 1)
    if dome:                                                                   # (the lid: a barrel top)
        rows = [[Vector((x, -(D / 2) * math.cos(t), hl + 0.01 + dome * math.sin(t))) for x in np.linspace(-W / 2, W / 2, 2)] for t in np.linspace(0, math.pi, 13)]
        grid_surface(Pm, M['canvas'], rows, fa(rnd, 3, 3), flip_to=lambda q: Vector((0, q.y, q.z - hl)))
        for sx in (-1, 1):
            bm = bmesh.new(); vs = [bm.verts.new((sx * W / 2, -(D / 2) * math.cos(t), hl + 0.01 + dome * math.sin(t))) for t in np.linspace(0, math.pi, 13)]
            f_ = bm.faces.new(vs); f_.normal_update()
            if f_.normal.x * sx < 0: f_.normal_flip()
            Pm.add(bm, M['canvas'], fa(rnd, 3, 3), wrap=False)
        box(Pm, M['canvas'], (-W / 2, -D / 2, hl), (W / 2, D / 2, hl + 0.01), fa(rnd), 0.0)
        for x in (-W / 2 + 0.12, -0.12, 0.12, W / 2 - 0.12):                   # (slats over the dome)
            F.rod(Pm, M['oak'], [Vector((x, -(D / 2 + 0.008) * math.cos(t), hl + 0.01 + (dome + 0.008) * math.sin(t))) for t in np.linspace(0, math.pi, 9)], 0.012, 4, wa((0, 1, 0)))
    else:
        box(Pm, M['canvas'], (-W / 2, -D / 2, hl), (W / 2, D / 2, H), fa(rnd, 3, 3), 0.01, 1)
        for x in (-W / 2 + 0.12, -0.12, 0.12, W / 2 - 0.12): box(Pm, M['oak'], (x - 0.025, -D / 2 - 0.008, H - 0.002), (x + 0.025, D / 2 + 0.008, H + 0.008), wa((0, 1, 0), wear=0.4), 0.003)
    for z in (0.04, hl - 0.05):                                                # (oak bands round the body)
        for sy in (-1, 1): box(Pm, M['oak'], (-W / 2 - 0.008, sy * D / 2 - 0.008, z), (W / 2 + 0.008, sy * D / 2 + 0.008, z + 0.05), wa((1, 0, 0), wear=0.4), 0.003)
        for sx in (-1, 1): box(Pm, M['oak'], (sx * W / 2 - 0.008, -D / 2, z), (sx * W / 2 + 0.008, D / 2, z + 0.05), wa((0, 1, 0), wear=0.4), 0.003)
    for x in (-W / 2 + 0.12, -0.12, 0.12, W / 2 - 0.12):
        for sy in (-1, 1): box(Pm, M['oak'], (x - 0.025, sy * D / 2 - 0.008, 0.04), (x + 0.025, sy * D / 2 + 0.008, hl - 0.0), wa((0, 0, 1), wear=0.4), 0.003)
    for sx in (-1, 1):                                                         # (brass corners)
        for sy in (-1, 1):
            xa, xb = sorted((sx * (W / 2 - 0.04), sx * (W / 2 + 0.01))); ya, yb = sorted((sy * (D / 2 - 0.04), sy * (D / 2 + 0.01)))
            for z0, z1 in ((0.0, 0.07), (hl - 0.06, hl + 0.01)): box(Pm, M['brass'], (xa, ya, z0), (xb, yb, z1), ma(0.5), 0.002)
    box(Pm, M['brass'], (-0.05, -D / 2 - 0.012, hl - 0.07), (0.05, -D / 2 - 0.006, hl + 0.03), ma(0.5), 0.003)   # (the lock plate)
    for sx in (-1, 1):                                                         # (leather handles in their loops)
        x = sx * (W / 2 + 0.01)
        for y in (-0.08, 0.08): box(Pm, M['iron'], (x - 0.006, y - 0.015, hl * 0.62 - 0.02), (x + 0.006, y + 0.015, hl * 0.62 + 0.02), ma(0.4), 0.002)
        F.rod(Pm, M['leather'], [Vector((x + sx * 0.008, -0.08, hl * 0.62)), Vector((x + sx * 0.025, -0.05, hl * 0.62 - 0.03)), Vector((x + sx * 0.03, 0.0, hl * 0.62 - 0.04)), Vector((x + sx * 0.025, 0.05, hl * 0.62 - 0.03)), Vector((x + sx * 0.008, 0.08, hl * 0.62))], 0.01, 5, fa(rnd), sub=2)
    for k in range(labels):                                                    # (travel labels on the front and lid)
        mat = M[f'label{rnd.randrange(4)}']; w, h = rnd.uniform(0.08, 0.14), rnd.uniform(0.06, 0.1); x = rnd.uniform(-W / 2 + 0.16, W / 2 - 0.16) if k else -W / 2 + 0.2
        z = rnd.uniform(0.12, hl - 0.15); bm = block((-w / 2, -0.0015, -h / 2), (w / 2, 0.0, h / 2), 0.0, 1); S.xform(bm, (0, 0, 0), (0, rnd.uniform(-0.25, 0.25), 0)); S.xform(bm, (x, -D / 2 - 0.0005, z))
        Pm.add(bm, mat, fa(rnd, 6, 6), wrap=False)

def steamer_trunk(G, M, rnd, v):
    if v == 0: trunk(G, M, rnd, 0.86, 0.5, 0.645, 0.13, labels=4)
    else: trunk(G, M, rnd, 0.86, 0.51, 0.635, 0.0, labels=3)
    if v == 1:                                                                 # (two leather straps round it, buckled)
        for x in (-0.27, 0.27):
            rows = [[Vector((x - 0.022, y, z)), Vector((x + 0.022, y, z))] for y, z in ((-0.265, 0.02), (-0.265, 0.625), (0.265, 0.625), (0.265, 0.02))]
            for k in range(3):
                a, b = rows[k], rows[k + 1]; n = Vector((0, -1, 0)) if k == 0 else (Vector((0, 0, 1)) if k == 1 else Vector((0, 1, 0)))
                grid_surface(G, M['leather'], [a, b], fa(rnd), flip_to=lambda q, n=n: n)
            box(G, M['brass'], (x - 0.028, -0.272, 0.47), (x + 0.028, -0.264, 0.52), ma(0.5), 0.002)

# ================================================================ the chimney breast
def chimney_breast(G, M, rnd, H=4.0):
    W = 0.97
    box(G, M['brick'], (-W / 2, -W / 2, 0.0), (W / 2, W / 2, H), ma(0.2), 0.008, 2)
    box(G, M['brick'], (-0.495, -0.495, 0.0), (0.495, 0.495, 0.15), ma(0.2), 0.006, 1)                         # (a plinth course)
    for k in range(5):                                                         # (patches of lime parging where the stack was made good)
        x0 = rnd.uniform(-0.4, 0.2); z0 = rnd.uniform(0.3, 2.6); w, h = rnd.uniform(0.15, 0.3), rnd.uniform(0.2, 0.5); face = k % 4
        lo, hi = [(x0, -W / 2 - 0.006, z0), (x0 + w, -W / 2 + 0.002, z0 + h)], None
        if face == 0: lo, hi = (x0, -W / 2 - 0.006, z0), (x0 + w, -W / 2 + 0.002, z0 + h)
        elif face == 1: lo, hi = (W / 2 - 0.002, x0, z0), (W / 2 + 0.006, x0 + w, z0 + h)
        elif face == 2: lo, hi = (x0, W / 2 - 0.002, z0), (x0 + w, W / 2 + 0.006, z0 + h)
        else: lo, hi = (-W / 2 - 0.006, x0, z0), (-W / 2 + 0.002, x0 + w, z0 + h)
        box(G, M['parge'], lo, hi, ma(0.2), 0.003, 1)
    box(G, M['iron'], (-0.12, -W / 2 - 0.008, 0.35), (0.12, -W / 2, 0.55), ma(0.4), 0.004, 1)                   # (the soot door)
    G.add(lathe_bm([(0.0, 0.012), (1.0, 0.012)], (0.08, -W / 2 - 0.008, 0.45), (0.08, -W / 2 - 0.018, 0.45), 6), M['iron'], ma(0.5), wrap=False)
    G.add(lathe_bm([(0.0, 0.085), (0.6, 0.085), (1.0, 0.075)], (W / 2, 0.1, 1.65), (W / 2 + 0.012, 0.1, 1.65), 16), M['iron'], ma(0.3), smooth=True, wrap=False)   # (a capped flue hole)
    F.rod(G, M['soot'], [(W / 2 + 0.005, 0.1, 1.56), (W / 2 + 0.006, 0.12, 1.2), (W / 2 + 0.003, 0.1, 0.9)], 0.004, 4, ma())   # (a tar run down from it)

# ================================================================ the sheeted iron bed
def iron_bed(G, M, rnd, W=0.92, L=1.995, hh=1.0, hf=0.78, zm=0.42):
    y0, y1 = -L, 0.0                                                           # (head at y = 0, to the wall)
    for y, h in ((y1 - 0.025, hh), (y0 + 0.025, hf)):
        for sx in (-1, 1):
            F.rod(G, M['bediron'], [(sx * (W / 2 - 0.02), y, 0.04), (sx * (W / 2 - 0.02), y, h - 0.03)], 0.019, 8, ma(0.4))
            G.add(lathe_bm([(0.0, 0.02), (0.5, 0.032), (1.0, 0.0)], (sx * (W / 2 - 0.02), y, h - 0.04), (sx * (W / 2 - 0.02), y, h), 10), M['brass'], ma(0.5), smooth=True, wrap=False)
            G.add(lathe_bm([(0.0, 0.022), (1.0, 0.022)], (sx * (W / 2 - 0.02), y, 0.0), (sx * (W / 2 - 0.02), y, 0.04), 8), M['bediron'], ma(0.4), smooth=True, wrap=False)
        for z in (zm - 0.05, h - 0.12): F.rod(G, M['bediron'], [(-(W / 2 - 0.02), y, z), ((W / 2 - 0.02), y, z)], 0.012, 6, ma(0.4))
        for k in range(1, 9):
            x = -(W / 2 - 0.02) + k * (W - 0.04) / 9; F.rod(G, M['bediron'], [(x, y, zm - 0.05), (x, y, h - 0.12)], 0.007, 5, ma(0.4))
        F.rod(G, M['bediron'], [(-(W / 2 - 0.02), y, h - 0.12), (-0.2, y, h - 0.07), (0.0, y, h - 0.05), (0.2, y, h - 0.07), ((W / 2 - 0.02), y, h - 0.12)], 0.01, 6, ma(0.4), sub=2)
    for sx in (-1, 1): box(G, M['bediron'], (sx * (W / 2 - 0.02) - 0.015, y0 + 0.04, zm - 0.06), (sx * (W / 2 - 0.02) + 0.015, y1 - 0.04, zm - 0.03), ma(0.4), 0.002)
    pillow(G, M['ticking'], (0.0, (y0 + y1) / 2, zm + 0.07), W - 0.08, L - 0.1, 0.16, rnd, n=7, sag=0.4)

BED_PARTS = [lambda c: 0.3 < c.z < 0.75 and -1.93 < c.y < -0.03, lambda c: c.y > -0.06, lambda c: c.y < -1.94]

def iron_bed_sheeted(G, M, rnd):
    col = hulls(geo_bmesh(lambda Gt: iron_bed(Gt, M, random.Random(9))), BED_PARTS, 0.006)
    iron_bed(G, M, random.Random(9))
    sheet_over(G, M, col, (1.55, 2.05), (28, 38), (0.02, -0.99, 1.2), 0.03, (-0.475, -2.0, 0.0), (0.475, 0.0, 1.0), 60)

# ================================================================ main
def mats(k): return lambda: att_mats(k)

def main():
    want = lambda k: OPTS.only is None or k in OPTS.only
    if want('truss_post'): F.run(STYLE, 'truss_post', [('Solid_truss_post', 'truss_post', truss_post, mats('truss_post'), 11, 1024)])
    if want('sheet_chair'): F.run(STYLE, 'sheet_chair', [(f'Solid_sheet_chair_v{v}', f'sheet_chair_v{v}', (lambda G, M, r, v=v: sheet_chair(G, M, r, v)), mats('sheet_chair'), 13 + v, 2048) for v in (0, 1)])
    if want('sheet_tall'): F.run(STYLE, 'sheet_tall', [(f'Solid_sheet_tall_v{v}', f'sheet_tall_v{v}', (lambda G, M, r, v=v: sheet_tall(G, M, r, v)), mats('sheet_tall'), 17 + v, 2048) for v in (0, 1)])
    if want('sheet_sofa'): F.run(STYLE, 'sheet_sofa', [('Solid_sheet_sofa', 'sheet_sofa', sheet_sofa, mats('sheet_sofa'), 19, 2048)])
    if want('steamer_trunk'): F.run(STYLE, 'steamer_trunk', [(f'Solid_steamer_trunk_v{v}', f'steamer_trunk_v{v}', (lambda G, M, r, v=v: steamer_trunk(G, M, r, v)), mats('steamer_trunk'), 23 + v, 1024) for v in (0, 1)])
    if want('columns') or want('chimney_breast'): F.run(STYLE, 'chimney_breast', [('Col_chimney_breast_H400', 'chimney_breast_H400', chimney_breast, mats('chimney_breast'), 29, 1024)])
    if want('iron_bed_sheeted'): F.run(STYLE, 'iron_bed_sheeted', [('Solid_iron_bed_sheeted', 'iron_bed_sheeted', iron_bed_sheeted, mats('iron_bed_sheeted'), 31, 2048)], wall=True)
    import furn_attic2 as A2
    for node, nm, fn, px in A2.BANDS:
        if want(nm) or want('bands') or want(node):
            F.run(STYLE, f'band_{nm}', [(node, f'band_{nm}', fn, (lambda nm=nm: A2.band_mats(nm)), hash(nm) & 0xfff, px)], wall=True)
    isl = [k for k in ('isl_sheeted_sofa', 'isl_trunk_pile', 'isl_servant_bed', 'isl_toy_circle', 'isl_sheeted_armoire', 'isl_dress_forms') if want(k) or want('islands')]
    if isl:                                                                    # (three texture sets: one atlas for all six would smear them)
        import furn_attic3 as A3
        for grp in (('isl_sheeted_sofa', 'isl_sheeted_armoire'), ('isl_trunk_pile', 'isl_servant_bed'), ('isl_toy_circle', 'isl_dress_forms')):
            ids = [k for k in isl if k in grp]
            if ids: F.islands(STYLE, A3.build_islands, ids, double=True)

if __name__ == '__main__':
    main()
