# Escape from Barbi Blue: the nursery's long table and its islands (WP2.5a, wood style), built by furn_wood.py:
#   Solid_nursery_table  a long low schoolroom table (0.85 x 2.6, 0.62 m) on turned legs, scrubbed deal top, slates, a primer, an
#                        inkwell and a rag doll on it; six small ladder-back chairs tucked in round it, inside the box
#   Isl_crib_rocker      a cot and the rocking chair beside it on an oval braided rag rug; the chair rocks (Isl_crib_rocker_RockPivot)
#   Isl_twin_cribs       two cots side by side, a mobile on a tall turned stand at their heads turning over them at 1.55 m
#                        (Isl_twin_cribs_MobilePivot); the cots' own mobiles taken down, their bare arms left
#   Isl_bed_screen       the iron bed and a three-leaf folding screen beside it, half closed, nursery chintz in painted frames
# The islands reuse the baked pieces (the cots, the chair, the bed: pack.py shares their textures); only what's new is baked here.
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
import furnlib as F
from furnlib import wa, ma, turned, box, drape, pillow, grid_surface
from doors import lathe_bm, tube, block, plate, attrs_of
from surfaces2 import sep
from kitlib import TMP, lin

# ================================================================ the nursery table
LEG = [(0.0, 0.019), (0.05, 0.016), (0.1, 0.02), (0.14, 0.017), (0.45, 0.022), (0.7, 0.019), (0.8, 0.024), (0.84, 0.024), (1.0, 0.024)]
def chair(G, M, c, face, rnd):
    """a child's ladder-back chair, seat 0.28 up, facing face (unit vector in xy), its back to 0.6"""
    c = Vector(c); fx = Vector((face[0], face[1], 0)).normalized(); sx = Vector((-fx.y, fx.x, 0)); W, D = 0.28, 0.26; zs = 0.28
    P = lambda a, b, z: c + sx * a + fx * b + Vector((0, 0, z))
    for a in (-W / 2 + 0.015, W / 2 - 0.015):
        turned(G, M['chair'], LEG[:5] + [(1.0, 0.015)], P(a, D / 2 - 0.015, 0.0), P(a, D / 2 - 0.015, zs), 6, attrs=wa((0, 0, 1)))
        turned(G, M['chair'], [(0.0, 0.015), (0.5, 0.016), (0.9, 0.013), (1.0, 0.0)], P(a, -D / 2 + 0.015, 0.0), P(a + 0.0, -D / 2 + 0.0, 0.6), 6, attrs=wa((0, 0, 1)))
        tube(G, M['chair'], [P(a, D / 2 - 0.015, 0.1), P(a, -D / 2 + 0.015, 0.1)], 0.008, 5, wa((0, 1, 0)))
    for z in (0.4, 0.5):                                                   # (the ladder's slats, bent)
        pts = [P(-W / 2 + 0.015 + (W - 0.03) * k / 6, -D / 2 + 0.008 - 0.012 * math.sin(math.pi * k / 6), z) for k in range(7)]
        tube(G, M['chair'], pts, 0.009, 4, wa((1, 0, 0)))
    bm = block((-W / 2, -D / 2, zs), (W / 2, D / 2, zs + 0.018), 0.004, 1)        # (the seat, rush-like: woven)
    M_ = Matrix((sx.to_4d(), fx.to_4d(), Vector((0, 0, 1, 0)), Vector((0, 0, 0, 1)))).transposed(); M_.translation = c
    bmesh.ops.transform(bm, matrix=M_, verts=bm.verts); G.add(bm, M['rush'], attrs_of(lambda q: (q[0] * 3, q[1] * 3, 0), rnd.random()), wrap=False)

def nursery_table(G, M, rnd):
    X, Y = 0.36, 1.0; zt = 0.555
    box(G, M['top'], (-0.4, -1.08, zt), (0.4, 1.08, zt + 0.028), wa((0, 1, 0), wear=0.4), 0.004, 2)
    for sx in (-1, 1):
        box(G, M['frame'], (sx * X - 0.011, -Y, zt - 0.09), (sx * X + 0.011, Y, zt), wa((0, 1, 0)), 0.003)
        for sy in (-1, 1): turned(G, M['frame'], LEG, (sx * X, sy * Y, 0.0), (sx * X, sy * Y, zt), 8, attrs=wa((0, 0, 1)))
    for sy in (-1, 1): box(G, M['frame'], (-X, sy * Y - 0.011, zt - 0.09), (X, sy * Y + 0.011, zt), wa((1, 0, 0)), 0.003)
    box(G, M['frame'], (-0.01, -Y, 0.12), (0.01, Y, 0.16), wa((0, 1, 0)), 0.003)
    for sy in (-1, 1): box(G, M['frame'], (-X, sy * Y - 0.012, 0.12), (X, sy * Y + 0.012, 0.16), wa((1, 0, 0)), 0.003)
    for k, y in enumerate((-0.6, 0.0, 0.6)):                                 # (six chairs at the sides, one at each end)
        for sx in (-1, 1):
            if k == 1 and sx > 0: continue
            chair(G, M, (sx * 0.27, y + rnd.uniform(-0.05, 0.05), 0.0), (-sx, rnd.uniform(-0.12, 0.12)), rnd)
    for sy in (-1, 1): chair(G, M, (rnd.uniform(-0.04, 0.04), sy * 1.17, 0.0), (0.08 * sy, -sy), rnd)
    z = zt + 0.028
    for k, (x, y, a) in enumerate(((-0.2, -0.7, 0.2), (0.15, -0.65, -0.1), (-0.18, 0.4, 0.05))):   # (slates in their frames)
        bm = block((-0.12, -0.085, 0.0), (0.12, 0.085, 0.008), 0.002, 1); S.xform(bm, (0, 0, 0), (0, 0, a)); S.xform(bm, (x, y, z)); G.add(bm, M['slate_frame'], wa((1, 0, 0)), wrap=False)
        bm = block((-0.105, -0.07, 0.008), (0.105, 0.07, 0.009), 0.0, 1); S.xform(bm, (0, 0, 0), (0, 0, a)); S.xform(bm, (x, y, z)); G.add(bm, M['slate'], ma(), wrap=False)
    bm = block((-0.08, -0.11, 0.0), (0.08, 0.11, 0.022), 0.003, 1); S.xform(bm, (0, 0, 0), (0, 0, 0.4)); S.xform(bm, (0.12, 0.35, z)); G.add(bm, M['book'], wa(), wrap=False)
    turned(G, M['ink'], [(0.0, 0.022), (0.6, 0.024), (0.8, 0.012), (1.0, 0.009)], (0.05, 0.85, z), (0.05, 0.85, z + 0.05), 12, attrs=ma())
    # a rag doll lying on the table: a stuffed body, limbs, a stitched face, wool hair
    d = Vector((-0.1, 0.0, z)); pillow(G, M['doll'], tuple(d + Vector((0, 0, 0.018))), 0.07, 0.11, 0.035, rnd, n=5, sag=0.1)
    pillow(G, M['doll_face'], tuple(d + Vector((0, 0.09, 0.02))), 0.065, 0.065, 0.04, rnd, n=5, sag=0.05)
    for (a, L) in ((2.4, 0.09), (0.7, 0.09), (-2.2, 0.1), (-0.9, 0.1)):
        e0 = d + Vector((0.025 * math.cos(a), 0.04 * math.sin(a), 0.016)); e1 = e0 + Vector((L * math.cos(a), L * math.sin(a), -0.004))
        G.add(lathe_bm([(0.0, 0.012), (0.85, 0.011), (1.0, 0.004)], e0, e1, 6), M['doll'], ma(), smooth=True, wrap=False)
    for k in range(9):
        a = math.pi * (0.15 + 0.7 * k / 8); p0 = d + Vector((0.03 * math.cos(a), 0.09 + 0.03 * math.sin(a), 0.035))
        tube(G, M['wool'], [p0, p0 + Vector((0.05 * math.cos(a), 0.05 * math.sin(a), -0.02))], 0.0035, 4, ma())

def table_materials():
    k = 'nursery_table'; M = {}
    M['top'] = Dr.bare_boards(k + '_top', 'deal', [(-0.4, 0.4, -1.1, 1.1, 0.0, 0.0)], age=1.3, tone=1.05)
    M['frame'] = Dr.paint(k + '_frame', ['#6b7d6a', '#c9b98f', '#8a5a3c'], 'pine', [], kick=0.4, chips=1.2, gloss=0.3, age=1.5, joints=False)
    M['chair'] = Dr.paint(k + '_chair', ['#8b4a35', '#c9b98f', '#8a5a3c'], 'pine', [], kick=0.4, chips=1.4, gloss=0.3, age=1.6, joints=False)
    M['rush'] = kitlib.fabric(k + '_rush', '#9a8458', weave=0.0, fade=0.3, stripes=('#6f5d3a', 0.008), age=1.6)
    M['slate'] = kitlib.metal(k + '_slate', 'iron', color='#2b2d30', rust=0.0, age=1.2); M['slate_frame'] = kitlib.wood(k + '_sframe', 'beech', 'bare', age=1.5)
    M['book'] = kitlib.fabric(k + '_book', '#6a2a24', weave=0.0, fade=0.6, age=1.6); M['ink'] = kitlib.porcelain(k + '_ink', '#2a3a5a', crackle=0.2, age=1.3)
    M['doll'] = kitlib.fabric(k + '_doll', '#b8a38c', weave=0.0, fade=0.4, stripes=('#9a7f6a', 0.02), age=1.8)
    M['doll_face'] = kitlib.fabric(k + '_dface', '#e2cdb6', weave=0.0, fade=0.3, age=1.8); M['wool'] = kitlib.fabric(k + '_wool', '#5a3a24', weave=0.0, fade=0.2, age=1.4)
    return M

# ================================================================ islands
def append(asset, names):
    """the named objects (and their children) from a registered asset's .blend, linked into the scene"""
    path = os.path.join(TMP, asset + '.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        want = [n for n in src.objects if any(n == x or n.startswith(x + '_') for x in names)]; dst.objects = list(want)
    out = {}
    for n, o in zip(want, dst.objects):                                     # (by the source's names: a second copy comes in as .001)
        if o: bpy.context.scene.collection.objects.link(o); out[n] = o
    return out

def bake_world(ob):
    """the object's mesh moved into world space (its transform applied, its children unparented first)"""
    bpy.context.view_layer.update()
    for c in list(ob.children): mw = c.matrix_world.copy(); c.parent = None; c.matrix_world = mw
    if ob.type == 'MESH': ob.data = ob.data.copy(); ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
    return ob

def place(ob, loc=(0, 0, 0), rot=0.0, scale=(1, 1, 1)):
    ob.matrix_world = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot, 4, 'Z') @ Matrix.Diagonal((*scale, 1.0)) @ ob.matrix_world

def braided_rug(G, M, rx, ry, rnd, z=0.0):
    """an oval braided rag rug: a three-strand braid coiled round and round (the coils as rings of bumps), edged"""
    n = 9; P = []
    for j in range(n + 1):
        t = j / n; row = []
        for i in range(73):
            a = 2 * math.pi * i / 72; row.append(Vector((rx * t * math.cos(a), ry * t * math.sin(a), z + 0.008 * (1 - 0.3 * t ** 6))))
        P.append(row)
    grid_surface(G, M['rug'], P, attrs_of(lambda q: (math.sqrt((q[0] / rx) ** 2 + (q[1] / ry) ** 2), math.atan2(q[1] / ry, q[0] / rx), 0.0), rnd.random()),
                 closed_u=True, flip_to=lambda q: Vector((0, 0, 1)))
    rim = [Vector((rx * math.cos(a), ry * math.sin(a), z + 0.004)) for a in np.linspace(0, 2 * math.pi, 73)]
    tube(G, M['rug'], rim, 0.006, 5, attrs_of(lambda q: (1.0, math.atan2(q[1] / ry, q[0] / rx), 0.0), 0.5))

def rug_material(name):
    """the braid: coils of rag strips in faded reds, browns, blues and creams, each coil its own colour run, the strands' diagonals"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); r, a, _ = sep(m, g)
    coil = m.math('MULTIPLY', r, 26.0); ci = m.math('FLOOR', coil); cf = m.math('FRACT', coil)
    braid = m.math('ABSOLUTE', m.math('SINE', m.math('ADD', m.math('MULTIPLY', a, 150.0), m.math('MULTIPLY', m.math('SUBTRACT', cf, 0.5), 3.0))))
    pick = m.math('FRACT', m.math('MULTIPLY', m.math('ADD', ci, m.math('FLOOR', m.math('MULTIPLY', a, 0.9))), 0.618))
    c = m.ramp(pick, [(0.0, lin('#7a3a32')), (0.25, lin('#a88c6a')), (0.45, lin('#4d5a6e')), (0.65, lin('#cdbd9c')), (0.85, lin('#5c4434'))])
    c = m.mix(m.remap(braid, 0.2, 0.9, 0.35, 0.0), c, m.hsv(c, 0.5, 0.9, 0.55))
    c = m.mix(m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', cf, 0.5)), 0.38, 0.5), 0.6), c, m.hsv(c, 0.5, 0.8, 0.45))   # (between the coils)
    h = m.math('ADD', m.math('MULTIPLY', m.math('SINE', m.math('MULTIPLY', cf, math.pi)), 0.004), m.math('MULTIPLY', braid, 0.0015))
    col, rough, h2, worn = kitlib.aged(m, c, 0.95, h, up_dust=0.6, grime=0.8)
    from surfaces2 import finish
    return finish(m, col, rough, h2)

def mobile_stand(G, Gm, M, base, hub, rnd):
    """a tall turned stand: a cross foot, the pole up to 1.8, an arm out to the mobile's hub"""
    base = Vector(base); hub = Vector(hub)
    for a in (0.0, math.pi / 2):
        d = Vector((math.cos(a), math.sin(a), 0)); e = Vector((-d.y, d.x, 0))
        lo = base - d * 0.12 - e * 0.02; hi = base + d * 0.12 + e * 0.02 + Vector((0, 0, 0.035))
        box(G, M['stand'], tuple(min(lo[i], hi[i]) for i in range(3)), tuple(max(lo[i], hi[i]) for i in range(3)), wa(d), 0.005)
    turned(G, M['stand'], [(0.0, 0.026), (0.04, 0.02), (0.1, 0.017), (0.5, 0.016), (0.9, 0.015), (0.93, 0.02), (0.96, 0.015), (1.0, 0.02)], base + Vector((0, 0, 0.035)), base + Vector((0, 0, 1.78)), 8, attrs=wa((0, 0, 1)))
    turned(G, M['stand'], [(0.0, 0.02), (0.6, 0.024), (1.0, 0.0)], base + Vector((0, 0, 1.78)), base + Vector((0, 0, 1.8)), 8, (False, True), wa((0, 0, 1)))
    d = hub - base
    arm = [base + Vector((0, 0, 1.68)), base + Vector((d.x * 0.45, d.y * 0.45, 1.69)), base + Vector((d.x * 0.9, d.y * 0.9, 1.64)), Vector((hub.x, hub.y, hub.z + 0.05)), hub + Vector((0, 0, 0.012))]
    tube(G, M['brass'], arm, 0.005, 6, ma(0.2))
    import furn_wood as FW
    FW.mobile(Gm, M, hub, rnd)

def folding_screen(G, M, rnd, c, angles, W=0.5, H=1.62):
    """three leaves hinged at their edges, zig-zag: each a painted frame round a stretched chintz panel"""
    p = Vector(c); dirs = []
    for k, a in enumerate(angles):
        d = Vector((math.cos(a), math.sin(a), 0)); n = Vector((-d.y, d.x, 0)); q = p + d * W
        for (u0, u1, z0, z1) in ((0.0, 0.04, 0.03, H), (W - 0.04, W, 0.03, H), (0.04, W - 0.04, H - 0.05, H), (0.04, W - 0.04, 0.12, 0.17)):
            bm = block((u0, -0.012, z0), (u1, 0.012, z1), 0.004, 1)
            S.xform(bm, (0, 0, 0), (0, 0, a)); S.xform(bm, tuple(p)); G.add(bm, M['sframe'], wa(d if z1 - z0 < 0.2 else (0, 0, 1)), wrap=False)
        for (u0, u1) in ((0.0, 0.04), (W - 0.04, W)):                     # (feet)
            bm = block((u0 - 0.005, -0.03, 0.0), (u1 + 0.005, 0.03, 0.03), 0.004, 1); S.xform(bm, (0, 0, 0), (0, 0, a)); S.xform(bm, tuple(p)); G.add(bm, M['sframe'], wa(d), wrap=False)
        for s in (-1, 1):                                                  # (the chintz, stretched, a little slack)
            rows = [[p + d * (0.04 + (W - 0.08) * i / 6) + n * (s * 0.004 + s * 0.004 * math.sin(math.pi * i / 6) * math.sin(math.pi * j / 8)) + Vector((0, 0, 0.17 + (H - 0.22) * j / 8)) for i in range(7)] for j in range(9)]
            grid_surface(G, M['chintz'], rows, attrs_of(lambda q, o=p, d=d: ((Vector(q) - o).dot(d), q[2], 0.0), rnd.random()), flip_to=lambda q, s=s, n=n: n * s)
        if k < len(angles) - 1:
            for z in (0.35, H - 0.3): tube(G, M['brass'], [q + Vector((0, 0, z - 0.04)), q + Vector((0, 0, z + 0.04))], 0.006, 6, ma())
        p = q

def chintz(name):
    """printed nursery chintz: a cream ground, sprigs of roses and blue birds in a half-drop repeat, faded where the light fell"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); u, v, _ = sep(m, g)
    row = m.math('FLOOR', m.math('DIVIDE', v, 0.09)); uu = m.math('ADD', u, m.math('MULTIPLY', m.math('MODULO', row, 2.0), 0.045))
    fu = m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', uu, 0.09)), 0.5); fv = m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', v, 0.09)), 0.5)
    r = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', fu, fu), m.math('MULTIPLY', fv, fv)))
    rose = m.remap(r, 0.2, 0.14, smooth=True); leaf = m.math('MULTIPLY', m.remap(r, 0.3, 0.24, smooth=True), m.remap(r, 0.14, 0.2))
    bird = m.remap(m.math('SQRT', m.math('ADD', m.math('MULTIPLY', m.math('SUBTRACT', fu, -0.35), m.math('SUBTRACT', fu, -0.35)), m.math('MULTIPLY', m.math('SUBTRACT', fv, 0.35), m.math('SUBTRACT', fv, 0.35)))), 0.09, 0.06)
    c = m.mix(0.0, lin('#e3d6bc'), lin('#e3d6bc'))
    c = m.mix(m.math('MULTIPLY', leaf, 0.6), c, lin('#7a8a5a')); c = m.mix(rose, c, lin('#c0606a')); c = m.mix(bird, c, lin('#5a7aa8'))
    c = m.mix(m.remap(m.noise(g, 3, 3), 0.3, 0.7, 0.0, 0.4), c, m.hsv(c, 0.5, 0.6, 1.1))
    col, rough, h, worn = kitlib.aged(m, c, 0.9, m.val(0.0), up_dust=0.3, grime=0.6)
    from surfaces2 import finish
    return finish(m, col, rough, h)

def isl_materials():
    k = 'isl_wood'; M = {}
    M['rug'] = rug_material(k + '_rug'); M['brass'] = kitlib.metal(k + '_brass', 'brass', color='#a4824a', rust=0.0, age=1.4)
    M['stand'] = Dr.paint(k + '_stand', ['#e8e2d1', '#aebdb3', '#8a5a3c'], 'pine', [], kick=0.3, chips=1.0, gloss=0.32, age=1.5, joints=False)
    M['sframe'] = Dr.paint(k + '_sframe', ['#d9cfb6', '#6f7d5f', '#8a5a3c'], 'pine', [], kick=0.3, chips=1.1, gloss=0.3, age=1.5, joints=False)
    M['chintz'] = chintz(k + '_chintz'); M['thread'] = kitlib.grey(k + '_thread', (0.35, 0.33, 0.3))
    for mk, c in (('figA', '#c9473a'), ('figB', '#e0b440'), ('figC', '#e8e2cf'), ('figD', '#4f7aa8')):
        M[mk] = Dr.paint(f'{k}_{mk}', [c, '#d8d0bc', '#a07a50'], 'pine', [], kick=0.0, chips=0.7, gloss=0.35, age=1.3, joints=False)
    return M

def build_islands(want):
    """-> roots"""
    rnd = random.Random(23); M = isl_materials(); roots = []; new_parts = []
    # ---- isl_crib_rocker
    if want('isl_crib_rocker'):
        it = defs.KIT['items']['isl_crib_rocker']; H, D = it['h'], it['d']; amp = defs.KIT['anims'][it['anim']]['amp']
        cr = append('furn_wood_crib', ['Solid_crib_v0']); ch = append('rocking_chair', ['Solid_rocking_chair'])
        crib = cr['Solid_crib_v0']; mob = cr.get('Solid_crib_v0_MobilePivot')
        place(crib, (-0.33, 0.415, 0)); bake_world(crib)
        if mob: bake_world(mob)
        sz = H / max((o.matrix_world @ v.co).z for o in [crib] + ([mob] if mob else []) for v in o.data.vertices)
        for o in [crib] + ([mob] if mob else []): o.data.transform(Matrix.Diagonal((1.0, 1.0, sz, 1.0)))   # (a tall Victorian cot: the island's 1.10 m)
        root_c = ch['Solid_rocking_chair']; chair = ch['Solid_rocking_chair_RockPivot']
        root_c.location = (0.0, 0.0, 0.0); bpy.context.view_layer.update(); bake_world(root_c); bake_world(chair)
        # the chair rocks about its rockers' arc centre (the rockers roll on the floor: they never leave it or sink into it), made a
        # little smaller than the standalone one so its crest at the top of the swing is the island's 1.10 m and no higher, and set
        # forward so its rockers' tips swing inside the island's box
        st = random.getstate(); import rocking_chair as RC; random.setstate(st)
        P = np.array([v.co[:] for v in chair.data.vertices]); c = np.array([0.0, 0.0, P[:, 2].min() + RC.R])
        rx = lambda a: np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
        sw = [(P - c) @ rx(a).T + c for a in np.linspace(-amp, amp, 41)]
        s = (H - 0.002) / max(q[:, 2].max() for q in sw); y1 = max(q[:, 1].max() for q in sw) * s
        yc = min(0.385, D / 2 - 0.006 - y1)
        chair.data.transform(Matrix.Translation((0.37, yc, 0.0)) @ Matrix.Scale(s, 4))
        print(f'  isl_crib_rocker: cot x{sz:.3f} high, chair x{s:.3f} at y {yc:.3f}, rocking about z {c[2] * s:.3f}', flush=True)
        G = S.Geo(1, 1, False, False); braided_rug(G, M, 0.69, 0.86, rnd); rug = F.build_obj('isl_rug', G); new_parts.append(rug)
        roots.append(('Isl_crib_rocker', [crib] + ([mob] if mob else []) + [rug], chair, 'Isl_crib_rocker_RockPivot', (0.37, yc, c[2] * s), [root_c]))
    # ---- isl_twin_cribs
    if want('isl_twin_cribs'):
        a = append('furn_wood_crib', ['Solid_crib_v0', 'Solid_crib_v1']); parts = []
        for v, x in ((0, -0.355), (1, 0.355)):
            c = a[f'Solid_crib_v{v}']; m_ = a.get(f'Solid_crib_v{v}_MobilePivot')
            if m_: bpy.data.objects.remove(m_)
            place(c, (x, 0.36, 0), scale=(0.965, 1.0, 1.0)); bake_world(c); parts.append(c)
        G = S.Geo(1, 1, False, False); Gm = S.Geo(1, 1, False, False)
        mobile_stand(G, Gm, M, (0.0, 0.79, 0.0), (0.0, 0.05, 1.55), rnd)
        st = F.build_obj('isl_stand', G); mb = F.build_obj('isl_mobile', Gm); new_parts += [st, mb]
        roots.append(('Isl_twin_cribs', parts + [st], mb, 'Isl_twin_cribs_MobilePivot', (0.0, 0.05, 1.55), []))
    # ---- isl_bed_screen
    if want('isl_bed_screen'):
        b = append('furn_wood_iron_bed', ['Solid_iron_bed']); bed = b['Solid_iron_bed']
        place(bed, (0.0, 0.0, 0.0), rot=-math.pi / 2, scale=(1.0, 0.965, 1.0)); place(bed, (0.965, -0.238, 0.0)); bake_world(bed)
        G = S.Geo(1, 1, False, False); folding_screen(G, M, rnd, (-0.68, 0.52, 0.0), (0.35, -0.45, 0.35), H=1.65)
        scr = F.build_obj('isl_screen', G); new_parts.append(scr)
        roots.append(('Isl_bed_screen', [bed, scr], None, None, None, []))
    import furn_wood4 as W4
    if want('isl_tea_party'):
        G = S.Geo(1, 1, False, False); W4.tea_party(G, W4.tea_materials(), rnd); o = F.build_obj('isl_tea', G); new_parts.append(o)
        roots.append(('Isl_tea_party', [o], None, None, None, []))
    if want('isl_dollhouse'):
        d = append('furn_wood_doll_house', ['Solid_doll_house']); h = d['Solid_doll_house']
        place(h, (0.0, 0.15, 0.0), scale=(1.13, 1.13, 1.13)); bake_world(h)
        G = S.Geo(1, 1, False, False); W4.dollhouse_set(G, W4.dh_materials(), rnd); o = F.build_obj('isl_dh', G); new_parts.append(o)
        roots.append(('Isl_dollhouse', [h, o], None, None, None, []))
    if want('isl_washstand'):
        G = S.Geo(1, 1, False, False); W4.washstand_set(G, W4.ws_materials(), rnd); o = F.build_obj('isl_wash', G); new_parts.append(o)
        roots.append(('Isl_washstand', [o], None, None, None, []))
    return roots, new_parts, M
