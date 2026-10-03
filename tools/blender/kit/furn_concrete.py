# Escape from Barbi Blue: the basement's furniture (WP2.5c, concrete style; build spec B3, B4, B6).
#   Col_brick_pier_H270/H300/H330   a pier of soft red brick to the ceiling: a plinth on a slate damp course, a splayed weathering
#                                   course, the shaft (a few bricks proud of the rest), two corbel courses under the ceiling; limewashed
#                                   to shoulder height and flaking, a damp tide mark with salts, coal dust low, soot high; a conduit
#                                   running up to an old Bakelite switch
#   Col_stanchion_H300/H330         an adjustable steel prop (red oxide, rusting): a bolted base plate, the outer tube, its threaded
#                                   collar nut with handles, the pinned inner tube, the jack head under a timber packer and a beam plate
#   Solid_shelf_rack       slotted-angle shelving (0.6 x 3.1 x 2.0) loaded from both sides: preserving jars, tins, paint cans,
#                          bottles, stoneware crocks, cardboard boxes, sacks
#   Solid_boiler_wall      a cast-iron sectional boiler on a brick plinth, back to the wall, its fire door open on the fire (the
#                          game's glow at Solid_boiler_wall_fix); the flow and return pipes along the wall, lagged; the flue up past
#                          the ceiling to 3.4 m; a shovel, a poker on its hook, a coal scuttle
#   Solid_chest_freezer    an enamelled chest freezer gone cream, chrome handle and lock, rust along its foot
#   Solid_crate_stack_v0/v1  slatted pine crates stacked two (1.0 m) and three (1.6 m) high, straw behind the slats, rope handles
#   wall pieces: furn_concrete2.py; islands: furn_concrete3.py
#   py -3.11 tools/blender/kit/furn_concrete.py [--preview] [--force] [--only columns,shelf_rack,...,bands,islands] [--sheets]
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
from doors import lathe_bm, tube, block, attrs_of
from surfaces2 import sep, finish
from kitlib import OPTS, lin

STYLE = 'concrete'
random.seed(307)

# ================================================================ materials
def pier_brick(name, wash=1.55):
    """soft red brick in running bond round all four faces (u = x + y keeps the coursing continuous round the corners), lime mortar;
       limewashed up to about wash and flaking off in patches, a damp tide mark with white salts, coal dust low, soot under the ceiling"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op); u = m.math('ADD', x, y)
    row = m.math('FLOOR', m.math('DIVIDE', z, 0.075)); bx = m.math('ADD', u, m.math('MULTIPLY', m.math('MODULO', row, 2.0), 0.1125))
    cell = m.math('FLOOR', m.math('DIVIDE', bx, 0.225)); fx = m.math('FRACT', m.math('DIVIDE', bx, 0.225)); fz = m.math('FRACT', m.math('DIVIDE', z, 0.075))
    rnd_ = m.math('FRACT', m.math('MULTIPLY', m.math('SINE', m.math('ADD', m.math('MULTIPLY', cell, 12.9898), m.math('MULTIPLY', row, 78.233))), 43758.5453))
    col = m.mix(m.remap(rnd_, 0.0, 0.5), lin('#64321f'), lin('#56291d')); col = m.mix(m.remap(rnd_, 0.5, 1.0), col, lin('#714028'))
    col = m.mix(m.remap(m.math('FRACT', m.math('MULTIPLY', rnd_, 7.0)), 0.86, 0.9), col, lin('#3a221c'))           # (an overburnt one here and there)
    col = m.mix(m.remap(m.noise(op, 300, 3), 0.3, 0.7, 0.0, 0.4), col, m.hsv(col, 0.5, 0.8, 1.25))
    jt = m.math('MAXIMUM', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fz, 0.5)), 0.43, 0.47), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fx, 0.5)), 0.47, 0.49))
    col = m.mix(jt, col, m.mix(m.remap(m.noise(op, 60, 3), 0.3, 0.7), lin('#8a8274'), lin('#635c52')))
    top = m.math('ADD', wash, m.math('MULTIPLY', m.math('SUBTRACT', m.noise(op, 3.0, 3), 0.5), 0.3))
    under = m.remap(m.math('SUBTRACT', top, z), 0.0, 0.03)
    keep = m.remap(m.noise(m.map(op, (1, 1, 1.6)), 9.0, 6, 0.65), 0.36, 0.44)                                     # (where the wash still holds: most of it)
    lw = m.math('MULTIPLY', under, m.math('MAXIMUM', keep, m.math('MULTIPLY', jt, 0.8)))
    wcol = m.mix(m.remap(m.noise(op, 18, 4), 0.3, 0.7), lin('#bdb5a3'), lin('#9d9584'))
    wcol = m.mix(m.remap(m.noise(m.map(op, (6, 6, 0.6)), 4.0, 3), 0.45, 0.7, 0.0, 0.6), wcol, lin('#6e665a'))   # (dirty streaks run down it)
    col = m.mix(m.math('MULTIPLY', lw, 0.88), col, wcol)
    damp = m.remap(z, 0.82 + 0.0, 0.25); tide = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', z, m.math('ADD', 0.78, m.math('MULTIPLY', m.noise(op, 2.0, 3), 0.12)))), 0.03, 0.0), 0.6)
    col = m.mix(m.math('MULTIPLY', damp, 0.55), col, m.hsv(col, 0.5, 0.85, 0.62))
    salt = m.math('MULTIPLY', m.remap(m.noise(op, 22, 5, 0.6), 0.56, 0.68), m.math('MULTIPLY', m.remap(z, 0.25, 0.45), m.remap(z, 0.85, 0.7)))
    col = m.mix(m.math('MAXIMUM', salt, tide), col, lin('#e4e0d4'))
    col = m.mix(m.remap(z, 0.35, 0.0, 0.0, 0.6), col, lin('#262422'))                                                 # (coal dust kicked up)
    col = m.mix(m.remap(z, 2.2, 3.3, 0.0, 0.55), col, lin('#2a2624'))                                                 # (soot from the boiler)
    return finish(m, col, m.mixf(lw, 0.9, 0.95), m.math('ADD', m.math('MULTIPLY', jt, -0.006), m.math('ADD', m.math('MULTIPLY', m.noise(op, 200, 3), 0.0008), m.math('MULTIPLY', lw, 0.0004))))

def slotted(name, col='#596656'):
    """slotted-angle steel, stove-enamelled grey-green: the slots (from the flange's own across / along position in gpos), chipped to
       bright steel at the edges, rust blooming in the slots and where the damp got it, dust on the tops"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True); a, zz, _ = sep(m, g)
    slot = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', a, 0.02)), 0.0065, 0.005), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', zz, 0.0375)), 0.5)), 0.36, 0.33))
    c = lin(col); base = m.mix(m.remap(m.noise(op, 30, 4), 0.3, 0.7), c, tuple(q * 0.75 for q in c))
    edge = m.math('ADD', m.edge(), 0.0)
    chip = m.math('MAXIMUM', m.remap(m.noise(op, 40, 5, 0.6), 0.63, 0.68), m.math('MULTIPLY', m.remap(edge, 0.5, 0.9), m.remap(m.noise(op, 12, 4), 0.45, 0.6)))
    rust = m.mix(m.noise(op, 80, 5), lin('#5a2a10'), lin('#8a4a1e')); rr = m.math('MAXIMUM', m.remap(m.noise(op, 5, 5, 0.6), 0.6, 0.72), m.math('MULTIPLY', slot, 0.6))
    colr = m.mix(chip, base, (0.32, 0.31, 0.3)); colr = m.mix(m.math('MULTIPLY', rr, 0.85), colr, rust)
    colr = m.mix(slot, colr, (0.008, 0.008, 0.008))
    dust = m.math('MULTIPLY', m.remap(sep(m, m.geo('Normal'))[2], 0.5, 0.95), 0.7); colr = m.mix(dust, colr, lin('#8c877c'))
    return finish(m, colr, m.mixf(chip, m.mixf(rr, 0.55, 0.9), 0.35), m.math('ADD', m.math('MULTIPLY', slot, -0.002), m.math('MULTIPLY', rr, 0.0004)), metal=m.math('MULTIPLY', chip, m.math('SUBTRACT', 1.0, rr)))

def preserve(name, col):
    """fruit in syrup seen through the jar: dark at the edges of each piece, light through the middle, a few bubbles"""
    m = kitlib.Mat(name); op = m.attr('opos', True); c = lin(col)
    fr = m.remap(m.voronoi(m.map(op, (1, 1, 1)), 70, 'Distance'), 0.05, 0.4)
    colr = m.mix(fr, tuple(min(1.0, q * 1.35) for q in c), tuple(q * 0.45 for q in c))
    return finish(m, colr, 0.12, m.math('MULTIPLY', fr, 0.0005))

def glossy(name, col, rough=0.12, dust=0.7):
    """dark bottle glass (or a glazed crock): glossy, dust settled on the shoulders, finger marks through it"""
    m = kitlib.Mat(name); op = m.attr('opos', True); c = lin(col)
    colr = m.mix(m.remap(m.noise(op, 12, 3), 0.3, 0.7), c, tuple(min(1.0, q * 1.4) for q in c))
    du = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(sep(m, m.geo('Normal'))[2], 0.1, 0.9), m.remap(m.noise(op, 25, 4), 0.35, 0.65)), dust)
    colr = m.mix(du, colr, lin('#8a8478'))
    return finish(m, colr, m.mixf(du, rough, 0.85), m.math('MULTIPLY', du, 0.0003))

def con_mats(k):
    import modules as Mo, fixtures as Fx
    M = {}
    M['brick'] = pier_brick(k + '_brick'); M['slate'] = kitlib.grey(k + '_slate', (0.03, 0.032, 0.035))
    M['prop'] = Dr.paint(k + '_prop', ['#6e3420', '#4e3a2c', '#3a3836'], 'steel', [], kick=0.3, chips=1.0, gloss=0.15, age=2.2, craze=0.0, joints=False, rust=1.0)
    M['plate'] = kitlib.metal(k + '_plate', 'iron', rust=0.7, age=1.6); M['thread'] = kitlib.metal(k + '_thread', 'steel', rust=0.6, age=1.6)
    M['timber'] = kitlib.wood(k + '_timber', 'pine', 'bare', stain='#7a6c58', age=2.3); M['pine'] = M['timber']
    M['angle'] = slotted(k + '_angle'); M['glass'] = kitlib.glass()
    for i, c in enumerate(('#5a0f1e', '#b8641c', '#6a7a1e', '#3a0c2a', '#a2300f')): M[f'pres{i}'] = preserve(f'{k}_pres{i}', c)
    for i, (c, s) in enumerate((('#c9b78a', '#8a2a1e'), ('#6a7a5a', '#d8cfb4'), ('#d8cfb4', '#2a3a5a'))): M[f'label{i}'] = kitlib.fabric(f'{k}_label{i}', c, weave=0.0, fade=0.7, stripes=(s, 0.03), age=1.9)
    M['tin'] = kitlib.metal(k + '_tin', 'steel', color='#a9aaa4', rust=0.5, age=1.6); M['galv'] = kitlib.metal(k + '_galv', 'steel', color='#a3a6a2', rust=0.3, age=1.7)
    M['paintcan'] = Dr.paint(k + '_can', ['#d8d2c2', '#7a7a74', '#5a5a58'], 'steel', [], kick=0.0, chips=0.5, gloss=0.3, age=1.8, craze=0.0, joints=False, rust=0.7)
    M['bottle_g'] = glossy(k + '_bottleg', '#14240f'); M['bottle_b'] = glossy(k + '_bottleb', '#2a160a'); M['crock'] = glossy(k + '_crock', '#7a5634', 0.3, 0.5)
    M['cork'] = kitlib.wood(k + '_cork', 'oak', 'bare', age=1.6); M['card'] = kitlib.fabric(k + '_card', '#8f6c47', weave=0.0, fade=0.6, age=1.9)
    M['sack'] = kitlib.fabric(k + '_sack', '#9b8462', weave=0.0, fade=0.4, stripes=('#7e6a4c', 0.004), age=1.9); M['rope'] = kitlib.fabric(k + '_rope', '#a08a60', weave=0.0, stripes=('#6a5a3a', 0.006), age=1.8)
    M['iron'] = Mo.cast_iron(k + '_iron', 0.55, 0.3); M['soot'] = Mo.soot_brick(k + '_soot'); M['coal'] = Fx.coal(k + '_coal')
    M['lagging'] = kitlib.plaster(k + '_lag', '#9e9582', age=2.2); M['flue'] = Mo.cast_iron(k + '_flue', 0.8, 0.1); M['brass'] = kitlib.metal(k + '_brass', 'brass', rust=0.0, age=1.6)
    M['dial'] = kitlib.porcelain(k + '_dial', '#e6dfcc', glaze=False, crackle=0.3, age=1.7)
    M['enamel'] = Dr.paint(k + '_enamel', ['#d9cfb4', '#bdb5a0', '#4a4a48'], 'steel', [], kick=0.45, chips=0.8, gloss=0.4, age=2.2, craze=0.0, joints=False, rust=0.9)
    M['chrome'] = kitlib.metal(k + '_chrome', 'steel', color='#c9c9c4', rust=0.35, age=1.4); M['rubber'] = kitlib.grey(k + '_rubber', (0.015, 0.014, 0.013))
    M['straw'] = kitlib.fabric(k + '_straw', '#b39a5a', weave=0.0, fade=0.3, stripes=('#7a6634', 0.005), age=1.6)
    M['bakelite'] = glossy(k + '_bakelite', '#24150e', 0.25, 0.6)
    return M

# ================================================================ helpers
def put(G, mat, bm, c=(0, 0, 0), rot=0.0, attrs=None, smooth=False):
    """a part built round the origin, turned about z by rot and set down at c"""
    if rot: S.xform(bm, (0, 0, 0), (0, 0, rot))
    S.xform(bm, tuple(c)); G.add(bm, mat, attrs or ma(), smooth=smooth, wrap=False)

def hexnut(G, mat, p, axis, r=0.009, h=0.007):
    G.add(lathe_bm([(0.0, r), (1.0, r)], p, Vector(p) + Vector(axis) * h, 6), mat, ma(0.3), wrap=False)

# ================================================================ the brick pier
def pier(G, M, rnd, H):
    W, S_ = 0.7, 0.665
    box(G, M['brick'], (-W / 2, -W / 2, 0.0), (W / 2, W / 2, 0.225), ma(0.3), 0.006, 1)                         # (the plinth)
    box(G, M['slate'], (-W / 2 - 0.003, -W / 2 - 0.003, 0.14), (W / 2 + 0.003, W / 2 + 0.003, 0.152), ma(), 0.0)  # (the slate damp course)
    sq = lambda r, z: [Vector((sx * r, sy * r, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
    grid_surface(G, M['brick'], [sq(W / 2, 0.225), sq(S_ / 2, 0.3)], ma(0.3), flip_to=lambda q: Vector((q.x, q.y, 0.6)))
    bm = block((-S_ / 2, -S_ / 2, 0.3), (S_ / 2, S_ / 2, H - 0.15), 0.008, 2)
    for v in bm.verts: v.co.x += 0.005 * (v.co.z / H); v.co.y -= 0.003 * (v.co.z / H)                            # (a little out of plumb)
    G.add(bm, M['brick'], ma(0.2), wrap=False)
    box(G, M['brick'], (-0.34, -0.34, H - 0.15), (0.34, 0.34, H - 0.075), ma(0.2), 0.004, 1)                       # (the corbel courses)
    box(G, M['brick'], (-W / 2, -W / 2, H - 0.075), (W / 2, W / 2, H), ma(0.2), 0.004, 1)
    for face in range(4):                                                     # (bricks a few mm proud, true to the shader's coursing)
        for k in range(10):
            row = rnd.randrange(5, int((H - 0.2) / 0.075) - 2); z0 = row * 0.075 + 0.005; z1 = z0 + 0.065
            off = (row % 2) * 0.1125; j = rnd.randrange(-2, 3); u0 = j * 0.225 - off + 0.005; u1 = u0 + 0.215
            h_ = rnd.uniform(0.002, 0.006); zm = (z0 + z1) / 2; lx, ly = 0.005 * zm / H, -0.003 * zm / H
            if face == 0: lo, hi = (u0 + S_ / 2, -S_ / 2 + ly - h_, z0), (u1 + S_ / 2, -S_ / 2 + ly + 0.01, z1)    # (-y: u = x - S/2)
            elif face == 1: lo, hi = (u0 - S_ / 2, S_ / 2 + ly - 0.01, z0), (u1 - S_ / 2, S_ / 2 + ly + h_, z1)   # (+y: u = x + S/2)
            elif face == 2: lo, hi = (S_ / 2 + lx - 0.01, u0 - S_ / 2, z0), (S_ / 2 + lx + h_, u1 - S_ / 2, z1)   # (+x: u = S/2 + y)
            else: lo, hi = (-S_ / 2 + lx - h_, u0 + S_ / 2, z0), (-S_ / 2 + lx + 0.01, u1 + S_ / 2, z1)           # (-x: u = y - S/2)
            ax = 0 if face < 2 else 1
            if lo[ax] < -S_ / 2 + 0.01 or hi[ax] > S_ / 2 - 0.01: continue
            box(G, M['brick'], lo, hi, ma(0.2), 0.002, 1)
    # the conduit up the front face to a Bakelite switch
    yf = -S_ / 2 - 0.003; x0 = 0.16
    G.add(lathe_bm([(0.0, 0.036), (0.6, 0.036), (1.0, 0.028)], (x0, yf, 1.32), (x0, yf - 0.018, 1.32), 14), M['bakelite'], ma(), smooth=True, wrap=False)
    F.rod(G, M['bakelite'], [(x0, yf - 0.018, 1.32), (x0, yf - 0.028, 1.33)], 0.005, 6, ma())
    F.rod(G, M['plate'], [(x0, yf - 0.009, 1.35), (x0, yf - 0.009, H - 0.15), (x0, -0.34 - 0.009, H - 0.15 + 0.01), (x0, -0.35 - 0.009, H - 0.02)], 0.008, 6, ma(0.3), sub=1)
    for z in np.arange(1.6, H - 0.3, 0.45): box(G, M['plate'], (x0 - 0.02, yf - 0.019, z), (x0 + 0.02, yf, z + 0.012), ma(0.3), 0.001)   # (saddles)

# ================================================================ the steel prop
def stanchion(G, M, rnd, H):
    box(G, M['prop'], (-0.15, -0.15, 0.0), (0.15, 0.15, 0.012), ma(0.4), 0.002)
    for sx in (-1, 1):
        for sy in (-1, 1): hexnut(G, M['thread'], (sx * 0.115, sy * 0.115, 0.012), (0, 0, 1), 0.011, 0.009)
    for k in range(4):                                                        # (gussets: the tube welded to its plate)
        a = math.pi / 2 * k; d = Vector((math.cos(a), math.sin(a), 0)); n = Vector((-d.y, d.x, 0))
        bm = bmesh.new(); P = [Vector((0, 0, 0.012)) + d * 0.03, Vector((0, 0, 0.012)) + d * 0.09, Vector((0, 0, 0.012)) + d * 0.03 + Vector((0, 0, 0.08))]
        vs = [bm.verts.new(p + n * s) for s in (-0.003, 0.003) for p in P]
        for f_ in ((0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)): bm.faces.new([vs[i] for i in f_])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); G.add(bm, M['prop'], ma(0.3), wrap=False)
    zc = 1.62
    G.add(lathe_bm([(0.0, 0.031), (1.0, 0.031)], (0, 0, 0.012), (0, 0, zc - 0.07), 16, (False, False)), M['prop'], ma(0.3), smooth=True, wrap=False)
    G.add(lathe_bm([(t, 0.032 + 0.0025 * (k % 2)) for k, t in enumerate(np.linspace(0, 1, 12))], (0, 0, zc - 0.07), (0, 0, zc - 0.025), 16, (False, False)), M['thread'], ma(0.2), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.044), (0.2, 0.05), (0.8, 0.05), (1.0, 0.044)], (0, 0, zc - 0.025), (0, 0, zc + 0.03), 12), M['prop'], ma(0.4), smooth=False, wrap=False)
    for sx in (-1, 1): F.rod(G, M['prop'], [(sx * 0.045, 0, zc), (sx * 0.12, 0, zc), (sx * 0.135, 0, zc + 0.015)], 0.009, 6, ma(0.4))
    G.add(lathe_bm([(0.0, 0.024), (1.0, 0.024)], (0, 0, zc + 0.03), (0, 0, H - 0.074), 16, (False, True)), M['prop'], ma(0.2), smooth=True, wrap=False)
    for z in np.arange(zc + 0.13, H - 0.2, 0.1):                              # (the pin holes right through the inner tube)
        G.add(lathe_bm([(0.0, 0.0075), (1.0, 0.0075)], (-0.0245, 0, z), (0.0245, 0, z), 8), M['rubber'], ma(), wrap=False)
    F.rod(G, M['thread'], [(-0.07, 0.0, zc + 0.06), (0.05, 0.0, zc + 0.06), (0.065, 0.0, zc + 0.05), (0.07, 0.0, zc + 0.02)], 0.0065, 6, ma(0.3), sub=2)   # (the pin, bent)
    box(G, M['prop'], (-0.08, -0.08, H - 0.074), (0.08, 0.08, H - 0.062), ma(0.3), 0.002)
    box(G, M['timber'], (-0.125, -0.15, H - 0.062), (0.125, 0.15, H - 0.012), wa((0, 1, 0)), 0.003)
    box(G, M['plate'], (-0.15, -0.15, H - 0.012), (0.15, 0.15, H), ma(0.3), 0.002)

# ================================================================ the shelf rack and what's on it
def angle_upright(G, M, x, y, z0, z1, fx, fy, rnd):
    """a slotted angle: one flange along x (fx: which way), one along y; gpos (across the flange, up it) for the slots"""
    t, w = 0.002, 0.04
    G.add(block((min(x, x + fx * w), min(y, y + fy * t), z0), (max(x, x + fx * w), max(y, y + fy * t), z1), 0.0, 1), M['angle'], attrs_of(lambda q, x=x: (abs(q[0] - x), q[2], 0.0), rnd.random()), wrap=False)
    G.add(block((min(x, x + fx * t), min(y, y + fy * w), z0), (max(x, x + fx * t), max(y, y + fy * w), z1), 0.0, 1), M['angle'], attrs_of(lambda q, y=y: (abs(q[1] - y), q[2], 0.0), rnd.random()), wrap=False)

def jar(G, M, x, y0, z, rnd):
    r = rnd.uniform(0.042, 0.055); h = rnd.uniform(0.13, 0.19); fill = rnd.uniform(0.55, 0.88); p = Vector((x, y0 + r, z))
    G.add(lathe_bm([(0.0, r), (1.0, r)], p, p + Vector((0, 0, h * fill)), 8), M[f'pres{rnd.randrange(5)}'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r), (0.75, r), (1.0, r * 0.78)], p + Vector((0, 0, h * fill)), p + Vector((0, 0, h)), 8, (False, False)), M['glass'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r * 0.82), (1.0, r * 0.8)], p + Vector((0, 0, h)), p + Vector((0, 0, h + 0.018)), 8, (False, True)), M['tin'], ma(0.4), smooth=True, wrap=False)
    return 2 * r

def tin(G, M, x, y0, z, rnd):
    r = rnd.uniform(0.036, 0.045); h = rnd.uniform(0.09, 0.13); p = Vector((x, y0 + r, z))
    G.add(lathe_bm([(0.0, r), (1.0, r)], p, p + Vector((0, 0, h)), 8), M[f'label{rnd.randrange(3)}'], fa(rnd, 4, 4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r + 0.0012), (1.0, r + 0.0012)], p + Vector((0, 0, h - 0.005)), p + Vector((0, 0, h + 0.001)), 8, (False, True)), M['tin'], ma(0.4), smooth=True, wrap=False)
    return 2 * r

def paint_can(G, M, x, y0, z, rnd):
    r = rnd.uniform(0.07, 0.085); h = rnd.uniform(0.13, 0.17); p = Vector((x, y0 + r + 0.005, z)); a = rnd.uniform(0, 6.28)
    d = Vector((math.cos(a), math.sin(a), 0)); sd = Vector((-d.y, d.x, 0)); up = Vector((0, 0, 1))
    G.add(lathe_bm([(0.0, r), (1.0, r)], p, p + up * h, 12), M['paintcan'], ma(0.3), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r + 0.003), (1.0, r * 0.92)], p + up * h, p + up * (h + 0.008), 12, (False, True)), M['tin'], ma(0.4), smooth=True, wrap=False)
    for s in (-1, 1): box(G, M['tin'], tuple(p + d * s * (r - 0.004) + Vector((-0.006, -0.006, h - 0.03))), tuple(p + d * s * (r + 0.004) + Vector((0.006, 0.006, h - 0.012))), ma(0.4), 0.0)   # (the lugs)
    flat = rnd.random() < 0.6                                                 # (the wire handle: lying across the lid, or stood up)
    pts = [p + up * (h - 0.02) + d * (r + 0.003) * math.cos(t) + ((sd * math.sin(t) * r * 0.85 + up * min(1.0, 4 * math.sin(t)) * 0.032) if flat else up * math.sin(t) * r * 0.95) for t in np.linspace(0, math.pi, 7)]
    F.rod(G, M['tin'], pts, 0.0025, 4, ma(0.4))
    return 2 * r + 0.01

def bottle(G, M, x, y0, z, rnd):
    r = rnd.uniform(0.03, 0.038); h = rnd.uniform(0.22, 0.29); p = Vector((x, y0 + r, z))
    G.add(lathe_bm([(0.0, r), (0.58, r), (0.72, r * 0.5), (0.8, 0.013), (1.0, 0.014)], p, p + Vector((0, 0, h)), 8), M['bottle_g' if rnd.random() < 0.6 else 'bottle_b'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.0105), (1.0, 0.011)], p + Vector((0, 0, h - 0.004)), p + Vector((0, 0, h + 0.012)), 5, (False, True)), M['cork'], ma(), smooth=True, wrap=False)
    return 2 * r

def card_box(G, M, x, y0, z, rnd, wmax=0.3, hmax=0.25):
    w = rnd.uniform(0.15, wmax); d = rnd.uniform(0.17, 0.25); h = rnd.uniform(0.1, hmax); p = Vector((x, y0 + w / 2, z))
    box(G, M['card'], tuple(p + Vector((-d / 2, -w / 2, 0.0))), tuple(p + Vector((d / 2, w / 2, h))), fa(rnd, 3, 3), 0.0)
    if hmax > 0.2 and rnd.random() < 0.4:                                     # (its flaps open, leaning out)
        for s in (-1, 1):
            bm = block((-d / 2, 0.0, -0.001), (d / 2, w * 0.45, 0.002), 0.0, 1); S.xform(bm, (0, 0, 0), (0.9, 0, 0))
            for v in bm.verts: v.co.y *= s
            put(G, M['card'], bm, p + Vector((0, s * w / 2, h)), 0.0, fa(rnd, 3, 3))
    return w

def crock(G, M, x, y0, z, rnd):
    r = rnd.uniform(0.08, 0.095); h = rnd.uniform(0.18, 0.24); p = Vector((x, y0 + r * 1.02, z))
    G.add(lathe_bm([(0.0, r * 0.88), (0.6, r * 1.02), (0.88, r * 0.84), (1.0, r * 0.86)], p, p + Vector((0, 0, h)), 12, (True, False)), M['crock'], ma(), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r * 0.86), (0.5, r * 0.86), (1.0, 0.0)], p + Vector((0, 0, h - 0.002)), p + Vector((0, 0, h + 0.02)), 12, (False, False)), M['slate'], ma(), smooth=True, wrap=False)
    return 2 * r * 1.02

def sack(G, M, x, y0, z, rnd):
    w = rnd.uniform(0.25, 0.33); pillow(G, M['sack'], (x, y0 + w / 2, z + 0.06), 0.22, w, 0.13, rnd, n=3, sag=0.2); return w

KINDS = {0: (crock, card_box, card_box, sack), 1: (paint_can, paint_can, card_box, bottle), 2: (jar, jar, tin, card_box), 3: (jar, bottle, bottle, card_box), 4: (card_box, card_box, tin, jar)}

SIZE = {jar: 0.11, tin: 0.09, paint_can: 0.18, bottle: 0.08, card_box: 0.3, crock: 0.2, sack: 0.35}     # (most room each takes along the shelf)
DEP = {jar: 0.11, tin: 0.09, paint_can: 0.18, bottle: 0.08, card_box: 0.25, crock: 0.2, sack: 0.24}

def fill_shelf(G, M, rnd, z, y0, y1, side, level, xmax=0.3, kinds=None):
    """items along one shelf bay from y0 to y1, on one side of the rack (side: +1 the +x half, -1 the -x half)"""
    y = y0 + rnd.uniform(0.01, 0.06)
    while True:
        fn = rnd.choice((kinds or KINDS)[level])
        size = SIZE[fn]
        if y + size > y1 - 0.01: break
        if rnd.random() < 0.22: y += rnd.uniform(0.08, 0.25); continue      # (a gap where something was taken)
        dep = DEP[fn]
        x = side * (xmax - 0.015 - rnd.uniform(0.0, 0.04) - dep / 2)
        w = fn(G, M, x, y, z, rnd, 0.3, 0.2) if (fn is card_box and level == 4) else fn(G, M, x, y, z, rnd)
        y += max(w, 0.04) + rnd.uniform(0.005, 0.03)

def shelf_rack(G, M, rnd, W=0.6, L=3.1, H=2.0, levels=(0.08, 0.5, 0.92, 1.34, 1.76), sides=(-1, 1), mid=False, kinds=None):
    ys = np.linspace(-L / 2, L / 2, 4)
    for x in (-W / 2, W / 2) + ((-0.002, 0.002) if mid else ()):              # (mid: two racks back to back, their uprights touching)
        for y in ys:
            fy = 1 if y < L / 2 - 1e-6 else -1
            angle_upright(G, M, x, y, 0.0, H, (-1 if x > 0 else 1) * (-1 if abs(x) < 0.01 else 1), fy, rnd)
    for k, z in enumerate(levels):
        for b in range(3):
            y0, y1 = ys[b] + 0.002, ys[b + 1] - 0.002
            box(G, M['angle'], (-W / 2 + 0.002, y0, z - 0.001), (W / 2 - 0.002, y1, z), attrs_of(lambda q: (9.0, q[2], 0.0), rnd.random()), 0.0)
            for x in (-W / 2 + 0.002, W / 2 - 0.003):                          # (the shelf's turned-down lips)
                box(G, M['angle'], (x, y0, z - 0.03), (x + 0.001, y1, z), attrs_of(lambda q: (9.0, q[2], 0.0), rnd.random()), 0.0)
            for x in (-W / 2, W / 2):
                for y in ((y0, y1) if b == 0 else (y1,)): G.add(lathe_bm([(0.0, 0.007), (1.0, 0.007)], (x, y + (0.02 if y == y0 else -0.02), z - 0.015), (x + (0.005 if x > 0 else -0.005), y + (0.02 if y == y0 else -0.02), z - 0.015), 4, (False, True)), M['thread'], ma(0.3), wrap=False)
            for s in sides: fill_shelf(G, M, rnd, z, y0 + 0.02, y1 - 0.02, s, k, W / 2, kinds)
    for x in (-W / 2, W / 2):                                                 # (corner gussets low down)
        for y in (ys[0], ys[-1]):
            sy = 1 if y < 0 else -1; sx = -1 if x > 0 else 1
            bm = bmesh.new(); P = [Vector((x, y, 0.1)), Vector((x, y + sy * 0.12, 0.1)), Vector((x, y, 0.22))]
            vs = [bm.verts.new(p + Vector((sx * o, 0, 0))) for o in (0.0, 0.002) for p in P]
            for f_ in ((0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)): bm.faces.new([vs[i] for i in f_])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces); G.add(bm, M['angle'], attrs_of(lambda q: (9.0, q[2], 0.0), 0.3), wrap=False)

# ================================================================ the boiler
def gate_valve(G, M, p, axis, up=(0, 0, 1), r=0.028):
    p = Vector(p); ax = Vector(axis).normalized(); u = Vector(up)
    G.add(lathe_bm([(0.0, r * 1.15), (0.2, r * 1.6), (0.8, r * 1.6), (1.0, r * 1.15)], p - ax * 0.05, p + ax * 0.05, 10), M['brass'], ma(0.4), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r * 0.9), (1.0, r * 0.5)], p, p + u * 0.09, 8), M['brass'], ma(0.4), smooth=True, wrap=False)
    v = ax.cross(u); ring = [p + u * 0.1 + (ax * math.cos(t) + v * math.sin(t)) * 0.045 for t in np.linspace(0, 2 * math.pi, 13)]
    F.rod(G, M['iron'], ring, 0.005, 5, ma(0.3), caps=(False, False))
    for t in (0, math.pi / 2): F.rod(G, M['iron'], [p + u * 0.1 + (ax * math.cos(t) + v * math.sin(t)) * 0.045, p + u * 0.1 - (ax * math.cos(t) + v * math.sin(t)) * 0.045], 0.004, 5, ma(0.3))

def dial(G, M, p, n, r=0.045):
    p = Vector(p); n = Vector(n).normalized()
    G.add(lathe_bm([(0.0, r), (0.7, r + 0.004), (1.0, r)], p, p + n * 0.025, 16), M['brass'], ma(0.5), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, r - 0.004), (1.0, r - 0.004)], p + n * 0.025, p + n * 0.026, 16, (False, True)), M['dial'], attrs_of(lambda q: tuple(q), 0.5), wrap=False)

def boiler(G, M, rnd, front=-0.97, back=-0.3, w=0.62, zb=0.12, zt=1.15, socket='Solid_boiler_wall_fix', door_open=1.6):
    """the boiler, front at y = front: plinth, sections, the front plate round the fire door's opening (the firebox behind it, sooted),
       the fire door swung open, the ash pit door, the cleaning door; dials and the safety valve on top; the smoke collar at the back"""
    box(G, M['brick'], (-w / 2 - 0.08, front - 0.04, 0.0), (w / 2 + 0.08, back + 0.02, zb), ma(0.3), 0.006, 1)
    yf = front + 0.1
    secs = np.linspace(yf, back, 6); ox, oz0, oz1 = 0.18, 0.5, 0.76
    for k in range(5):
        y0, y1 = secs[k] + 0.007, secs[k + 1] - 0.007
        if k: box(G, M['iron'], (-w / 2, y0, zb), (w / 2, y1, zt), ma(0.3), 0.014, 2)
        else:                                                                  # (the first section: a frame round the firebox)
            for lo, hi in (((-w / 2, y0, zb), (-ox - 0.02, y1, zt)), ((ox + 0.02, y0, zb), (w / 2, y1, zt)), ((-ox - 0.02, y0, zb), (ox + 0.02, y1, oz0 - 0.02)), ((-ox - 0.02, y0, oz1 + 0.02), (ox + 0.02, y1, zt))):
                box(G, M['iron'], lo, hi, ma(0.3), 0.01, 1)
    box(G, M['iron'], (-w / 2 + 0.03, secs[1], zb + 0.02), (w / 2 - 0.03, back - 0.01, zt - 0.02), ma(0.3), 0.0)   # (the core behind the section joints)
    for lo, hi in (((-w / 2, front, zb), (-ox, yf, zt)), ((ox, front, zb), (w / 2, yf, zt)), ((-ox, front, zb), (ox, yf, oz0)), ((-ox, front, oz1), (ox, yf, zt))):
        box(G, M['iron'], lo, hi, ma(0.4), 0.008, 1)
    for lo, hi in (((-ox, yf, oz0 - 0.02), (ox, yf + 0.13, oz0)), ((-ox, yf, oz1), (ox, yf + 0.13, oz1 + 0.02)), ((-ox - 0.02, yf, oz0), (-ox, yf + 0.13, oz1)), ((ox, yf, oz0), (ox + 0.02, yf + 0.13, oz1)), ((-ox, yf + 0.12, oz0), (ox, yf + 0.14, oz1))):
        box(G, M['soot'], lo, hi, ma(), 0.0)
    for lo, hi in (((-ox, front - 0.002, oz0), (ox, yf, oz0 + 0.004)), ((-ox - 0.004, front - 0.002, oz0), (-ox, yf, oz1)), ((ox, front - 0.002, oz0), (ox + 0.004, yf, oz1)), ((-ox, front - 0.002, oz1 - 0.004), (ox, yf, oz1))):
        box(G, M['soot'], lo, hi, ma(), 0.0)                                  # (the opening's throat, sooted)
    G.sockets = [(socket, (0.0, yf + 0.06, oz0))]
    # the fire door, hinged at its left and swung open
    hz = Vector((-ox - 0.03, front - 0.012, 0.0)); a = -door_open
    bm = block((0.0, -0.025, oz0 - 0.03), (2 * ox + 0.06, 0.0, oz1 + 0.03), 0.006, 1); S.xform(bm, (0, 0, 0), (0, 0, a)); S.xform(bm, tuple(hz)); G.add(bm, M['iron'], ma(0.4), wrap=False)
    dvec = Vector((math.cos(a), math.sin(a), 0)); nvec = Vector((-dvec.y, dvec.x, 0)) * -1
    for z in (oz0 + 0.02, oz1 - 0.02): G.add(lathe_bm([(0.0, 0.012), (1.0, 0.012)], hz + Vector((0, 0, z - 0.03)), hz + Vector((0, 0, z + 0.03)), 8), M['iron'], ma(0.4), smooth=True, wrap=False)
    hd = hz + dvec * (2 * ox + 0.02) + Vector((0, 0, (oz0 + oz1) / 2))
    F.rod(G, M['iron'], [hd + nvec * 0.0, hd + nvec * 0.035, hd + nvec * 0.04 - dvec * 0.05], 0.007, 6, ma(0.5))
    bm = block((-0.09, -0.003, -0.06), (0.09, 0.0, 0.06), 0.0, 1)             # (the cast name plate on the door's face)
    S.xform(bm, (0, 0, 0), (0, 0, a)); S.xform(bm, tuple(hz + dvec * (ox + 0.03) + nvec * 0.0 + Vector((0, 0, (oz0 + oz1) / 2)))); G.add(bm, M['iron'], ma(0.6), wrap=False)
    # the ash pit door (closed, its air slide), the cleaning door
    box(G, M['iron'], (-0.16, front - 0.018, zb + 0.06), (0.16, front, zb + 0.26), ma(0.4), 0.005, 1)
    box(G, M['iron'], (-0.1, front - 0.026, zb + 0.13), (0.1, front - 0.018, zb + 0.19), ma(0.6), 0.002, 1)
    G.add(lathe_bm([(0.0, 0.012), (1.0, 0.016)], (0.12, front - 0.018, zb + 0.16), (0.12, front - 0.05, zb + 0.16), 8), M['iron'], ma(0.5), smooth=True, wrap=False)
    box(G, M['iron'], (-0.14, front - 0.015, zt - 0.27), (0.14, front, zt - 0.1), ma(0.4), 0.005, 1)
    G.add(lathe_bm([(0.0, 0.01), (1.0, 0.014)], (0.0, front - 0.015, zt - 0.185), (0.0, front - 0.045, zt - 0.185), 8), M['iron'], ma(0.5), smooth=True, wrap=False)
    # dials, the safety valve, the smoke collar
    dial(G, M, (-0.12, front + 0.06, zt), (0, -0.4, 1)); dial(G, M, (0.12, front + 0.06, zt), (0, -0.4, 1), 0.04)
    G.add(lathe_bm([(0.0, 0.025), (0.3, 0.03), (0.4, 0.02), (0.8, 0.018), (1.0, 0.024)], (0.18, back - 0.15, zt), (0.18, back - 0.15, zt + 0.12), 10), M['brass'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['brass'], [(0.18, back - 0.15, zt + 0.1), (0.05, back - 0.15, zt + 0.11)], 0.005, 5, ma(0.4))
    G.add(lathe_bm([(0.0, 0.12), (0.5, 0.11), (1.0, 0.1)], (0.0, back + 0.02 - 0.15, zt), (0.0, back + 0.02 - 0.15, zt + 0.1), 16, (False, True)), M['iron'], ma(0.3), smooth=True, wrap=False)
    return yf

def boiler_wall(G, M, rnd):
    front, back = -0.97, -0.3
    boiler(G, M, rnd, front, back)
    # the flue: up from the smoke collar, back to the wall, up past the ceiling; collars at the joints, a damper
    fl = [Vector((0, back - 0.13, 1.25)), Vector((0, back - 0.13, 1.45)), Vector((0, back + 0.02, 1.62)), Vector((0, -0.13, 1.8)), Vector((0, -0.13, 3.4))]
    F.rod(G, M['flue'], fl, 0.09, 16, ma(0.3), caps=(False, False), sub=3)
    for z in (2.2, 2.8): G.add(lathe_bm([(0.0, 0.096), (1.0, 0.096)], (0, -0.13, z), (0, -0.13, z + 0.05), 16, (False, False)), M['flue'], ma(0.4), smooth=True, wrap=False)
    F.rod(G, M['iron'], [(0.0, -0.22, 2.0), (0.0, -0.27, 2.0), (0.06, -0.3, 2.0)], 0.007, 5, ma(0.5))
    for z in (1.95, 2.9): box(G, M['iron'], (-0.11, -0.04, z), (0.11, 0.0, z + 0.02), ma(0.3), 0.002)   # (wall straps)
    # flow: from the top to the wall and away to the right, lagged; return: low from the back, up the wall and away to the left
    flow = [(0.2, back - 0.25, 1.15), (0.2, back - 0.25, 1.7), (0.2, back - 0.15, 1.82), (0.2, -0.06, 1.84), (0.3, -0.06, 1.85), (0.495, -0.06, 1.85)]
    F.rod(G, M['iron'], flow, 0.022, 8, ma(0.3), sub=2)
    F.rod(G, M['lagging'], [(0.2, back - 0.25, 1.25), (0.2, back - 0.25, 1.68)], 0.042, 10, fa(rnd, 6, 6))
    gate_valve(G, M, (0.2, back - 0.25, 1.4), (0, 0, 1), (0, -1, 0))
    ret = [(-0.2, back - 0.1, 0.3), (-0.2, -0.06, 0.3), (-0.3, -0.06, 0.3), (-0.4, -0.06, 0.32), (-0.4, -0.06, 1.6), (-0.42, -0.06, 1.72), (-0.495, -0.06, 1.72)]
    F.rod(G, M['iron'], ret, 0.022, 8, ma(0.3), sub=2)
    F.rod(G, M['lagging'], [(-0.4, -0.06, 0.6), (-0.4, -0.06, 1.5)], 0.04, 10, fa(rnd, 6, 6))
    gate_valve(G, M, (-0.4, -0.06, 0.45), (0, 0, 1), (0, -1, 0))
    for x, z in ((0.35, 1.85), (-0.4, 1.0), (-0.45, 1.72)): box(G, M['iron'], (x - 0.012, -0.03, z - 0.03), (x + 0.012, 0.0, z + 0.03), ma(0.3), 0.002)   # (pipe clips)
    # a shovel against the right side, a poker on its hook on the left, a coal scuttle
    T = Vector((0.36, -1.33, 0.006)); Tp = Vector((0.29, front - 0.012, 0.86))   # (the shovel: tip on the floor, handle on the boiler)
    ax = (Tp - T).normalized(); ac = (Vector((1, 0, 0)) - ax * ax.x).normalized(); nr = ac.cross(ax)
    P = [[T + ax * s + ac * a * (0.11 - 0.035 * s / 0.28) + nr * 0.035 * a * a for a in np.linspace(-1, 1, 7)] for s in np.linspace(0.0, 0.28, 4)]
    grid_surface(G, M['plate'], P, ma(0.4), flip_to=lambda q: nr)
    F.rod(G, M['pine'], [T + ax * 0.26, Tp - ax * 0.12], 0.016, 6, wa(ax))
    F.rod(G, M['iron'], [Tp - ax * 0.12, Tp - ax * 0.02], 0.017, 6, ma(0.3))
    F.rod(G, M['pine'], [Tp - ax * 0.02 - ac * 0.05, Tp - ax * 0.02 + ac * 0.05], 0.014, 6, wa(ac))
    hk = Vector((-0.31, -0.7, 0.95)); box(G, M['iron'], tuple(hk + Vector((-0.004, -0.01, -0.01))), tuple(hk + Vector((0.0, 0.01, 0.01))), ma(0.3), 0.0)
    F.rod(G, M['iron'], [hk, hk + Vector((-0.04, 0, 0)), hk + Vector((-0.045, 0, 0.025))], 0.005, 5, ma(0.4))
    ring = [hk + Vector((-0.03, 0, 0)) + Vector((0, math.sin(t), -math.cos(t))) * 0.025 + Vector((0, 0, -0.022)) for t in np.linspace(0, 2 * math.pi, 11)]
    F.rod(G, M['iron'], ring, 0.004, 5, ma(0.4), caps=(False, False))
    F.rod(G, M['iron'], [hk + Vector((-0.03, 0, -0.046)), hk + Vector((-0.03, 0.0, -0.85))], 0.008, 6, ma(0.4))
    sc = Vector((-0.32, -1.2, 0.0))
    G.add(lathe_bm([(0.0, 0.13), (0.7, 0.15), (1.0, 0.16)], sc, sc + Vector((0, 0, 0.3)), 14, (True, False)), M['galv'], ma(0.4), smooth=True, wrap=False)
    import fixtures as Fx
    Fx.coal_lumps(G, M['coal'], 9, (sc.x - 0.1, sc.x + 0.1, sc.y - 0.1, sc.y + 0.1, 0.24), 5, (0.025, 0.04), 0.6)

# ================================================================ the freezer
def chest_freezer(G, M, rnd):
    box(G, M['rubber'], (-0.47, -0.3, 0.0), (0.47, 0.3, 0.06), ma(), 0.004)
    box(G, M['enamel'], (-0.495, -0.33, 0.06), (0.495, 0.33, 0.8), wa((1, 0, 0)), 0.03, 3)
    box(G, M['rubber'], (-0.485, -0.32, 0.797), (0.485, 0.32, 0.807), ma(), 0.002)
    box(G, M['enamel'], (-0.495, -0.33, 0.804), (0.495, 0.33, 0.88), wa((1, 0, 0)), 0.035, 3)
    F.rod(G, M['chrome'], [(-0.13, -0.325, 0.845), (-0.13, -0.334, 0.85), (0.13, -0.334, 0.85), (0.13, -0.325, 0.845)], 0.008, 8, ma(0.5), sub=2)
    G.add(lathe_bm([(0.0, 0.012), (0.7, 0.013), (1.0, 0.011)], (0.0, -0.336, 0.85), (0.0, -0.343, 0.85), 10), M['chrome'], ma(0.5), smooth=True, wrap=False)
    box(G, M['rubber'], (-0.0015, -0.3435, 0.845), (0.0015, -0.342, 0.856), ma(), 0.0)
    for x in (-0.3, 0.3): box(G, M['chrome'], (x - 0.04, 0.32, 0.78), (x + 0.04, 0.34, 0.83), ma(0.4), 0.004, 1)
    box(G, M['chrome'], (0.15, -0.336, 0.68), (0.4, -0.329, 0.72), ma(0.5), 0.002, 1)                         # (the maker's badge)
    box(G, M['rubber'], (0.48, -0.16, 0.14), (0.496, 0.16, 0.36), ma(), 0.0)                                   # (the vent grille)
    for k in range(7):
        bm = block((-0.003, -0.15, -0.012), (0.003, 0.15, 0.012), 0.0, 1); S.xform(bm, (0, 0, 0), (0.0, 0.5, 0.0)); S.xform(bm, (0.488, 0.0, 0.16 + 0.03 * k)); G.add(bm, M['enamel'], wa((0, 1, 0)), wrap=False)
    F.rod(G, M['rubber'], [(-0.35, 0.325, 0.12), (-0.35, 0.342, 0.1), (-0.34, 0.342, 0.02), (-0.3, 0.342, 0.006), (-0.1, 0.342, 0.006)], 0.004, 5, ma(), sub=2)   # (the flex)

# ================================================================ crates
def crate(G, M, c, size, rot, rnd, missing=False):
    """a slatted pine crate: corner battens, slats with gaps (the straw lining behind), lid boards nailed across, rope handles"""
    W, D, Hc = size; c = Vector(c); t = 0.018
    def P(bm, mat, attrs=None): put(G, mat, bm, c, rot, attrs or wa((1, 0, 0)))
    P(block((-W / 2 + 0.025, -D / 2 + 0.025, 0.02), (W / 2 - 0.025, D / 2 - 0.025, Hc - 0.03), 0.0, 1), M['straw'], fa(rnd, 3, 3))
    for sx in (-1, 1):
        for sy in (-1, 1): P(block((sx * (W / 2 - t) - 0.022, sy * (D / 2 - t) - 0.022, 0.0), (sx * (W / 2 - t) + 0.022, sy * (D / 2 - t) + 0.022, Hc), 0.002, 1), M['pine'], wa((0, 0, 1)))
    zs = np.arange(0.01, Hc - 0.09, 0.128)
    for z in zs:
        for sy in (-1, 1): P(block((-W / 2, sy * D / 2 - (t if sy > 0 else 0), z), (W / 2, sy * D / 2 + (0 if sy > 0 else t), z + 0.1), 0.002, 1), M['pine'], wa((1, 0, 0)))
        for sx in (-1, 1): P(block((sx * W / 2 - (t if sx > 0 else 0), -D / 2 + t, z), (sx * W / 2 + (0 if sx > 0 else t), D / 2 - t, z + 0.1), 0.002, 1), M['pine'], wa((0, 1, 0)))
    nb = 5; bw = (W - 0.02) / nb
    for k in range(nb):
        if missing and k == 2: continue
        x0 = -W / 2 + 0.01 + k * bw
        P(block((x0 + 0.004, -D / 2, Hc - 0.02), (x0 + bw - 0.004, D / 2, Hc), 0.002, 1), M['pine'], wa((0, 1, 0)))
    for sx in (-1, 1):                                                        # (rope handles through the end slats)
        zz = zs[-1] + 0.05 if len(zs) else Hc * 0.6
        pts = [Vector((sx * W / 2 - sx * 0.01, -0.07, zz)), Vector((sx * W / 2 + sx * 0.015, -0.06, zz - 0.01)), Vector((sx * W / 2 + sx * 0.022, 0.0, zz - 0.025)), Vector((sx * W / 2 + sx * 0.015, 0.06, zz - 0.01)), Vector((sx * W / 2 - sx * 0.01, 0.07, zz))]
        F.rod(G, M['rope'], [c + Matrix.Rotation(rot, 3, 'Z') @ q for q in pts], 0.008, 6, fa(rnd), sub=2)

def crate_stack(G, M, rnd, v):
    if v == 0:
        crate(G, M, (0.0, 0.0, 0.0), (0.86, 0.86, 0.52), 0.02, rnd)
        crate(G, M, (0.05, -0.06, 0.52), (0.72, 0.62, 0.48), 0.12, rnd, missing=True)
    else:
        crate(G, M, (0.0, 0.0, 0.0), (0.86, 0.86, 0.55), -0.02, rnd)
        crate(G, M, (-0.02, 0.04, 0.55), (0.78, 0.7, 0.5), 0.08, rnd)
        crate(G, M, (0.08, -0.05, 1.05), (0.6, 0.5, 0.55), -0.15, rnd, missing=True)

# ================================================================ main
def mats(k): return lambda: con_mats(k)

def main():
    want = lambda k: OPTS.only is None or k in OPTS.only
    if want('columns') or want('brick_pier'):
        F.run(STYLE, 'brick_pier', [(f'Col_brick_pier_H{h}', f'brick_pier_H{h}', (lambda G, M, r, h=h: pier(G, M, r, h / 100)), mats('brick_pier'), 400 + h, 1024) for h in (270, 300, 330)])
    if want('columns') or want('stanchion'):
        F.run(STYLE, 'stanchion', [(f'Col_stanchion_H{h}', f'stanchion_H{h}', (lambda G, M, r, h=h: stanchion(G, M, r, h / 100)), mats('stanchion'), 500 + h, 1024) for h in (300, 330)])
    if want('shelf_rack'): F.run(STYLE, 'shelf_rack', [('Solid_shelf_rack', 'shelf_rack', shelf_rack, mats('shelf_rack'), 61, 2048)])
    if want('boiler_wall'): F.run(STYLE, 'boiler_wall', [('Solid_boiler_wall', 'boiler_wall', boiler_wall, mats('boiler_wall'), 67, 2048)], wall=True)
    if want('chest_freezer'): F.run(STYLE, 'chest_freezer', [('Solid_chest_freezer', 'chest_freezer', chest_freezer, mats('chest_freezer'), 71, 1024)])
    if want('crate_stack'): F.run(STYLE, 'crate_stack', [(f'Solid_crate_stack_v{v}', f'crate_stack_v{v}', (lambda G, M, r, v=v: crate_stack(G, M, r, v)), mats('crate_stack'), 73 + v, 1024) for v in (0, 1)])
    import furn_concrete2 as C2
    for node, nm, fn, px in C2.BANDS:
        if want(nm) or want('bands') or want(node):
            F.run(STYLE, f'band_{nm}', [(node, f'band_{nm}', fn, (lambda nm=nm: C2.band_mats(nm)), hash(nm) & 0xfff, px)], wall=True)
    isl = [k for k in ('isl_boiler', 'isl_shelving_double', 'isl_crate_stack', 'isl_washtubs', 'isl_wine_rack') if want(k) or want('islands')]
    if isl:                                                                    # (in three texture sets: one 2048 atlas for all five smears them)
        import furn_concrete3 as C3
        for grp in (('isl_boiler', 'isl_washtubs'), ('isl_shelving_double', 'isl_crate_stack'), ('isl_wine_rack',)):
            ids = [k for k in isl if k in grp]
            if ids: F.islands(STYLE, C3.build_islands, ids)

if __name__ == '__main__':
    main()
