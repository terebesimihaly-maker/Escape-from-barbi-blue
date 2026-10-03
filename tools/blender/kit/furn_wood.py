# Escape from Barbi Blue: the nursery's furniture (WP2.5a, wood style; build spec B3, B4, B6).
#   Solid_crib_v0 / _v1   a cot, head to the wall (0.72 x 1.30, 1.05 m): v0 painted pine, turned spindles, on brass castors; v1 an
#                         iron cot, enamelled, brass knobs. A ticking mattress stained and sagging, a pillow, a wool blanket turned
#                         back; a nursery mobile on a wire arm from the head rail (the child <node>_MobilePivot, turning about z)
#   py -3.11 tools/blender/kit/furn_wood.py [--preview] [--force] [--only crib] [--sheets]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
import furnlib as F
from furnlib import wa, ma, turned, box, drape, pillow
from doors import lathe_bm, tube, block, plate, attrs_of
from kitlib import OPTS, TMP, lin

STYLE = 'wood'
random.seed(101)

# ================================================================ the cot
CW, CD, CH = 0.72, 1.30, 1.05
PX, PY0, PY1 = 0.335, -0.03, -1.27                                  # (the posts: x, head and foot y)
SPINDLE = [(0.0, 0.0085), (0.08, 0.0104), (0.5, 0.0114), (0.92, 0.0104), (1.0, 0.0085)]
FINIAL = [(0.0, 0.016), (0.15, 0.019), (0.3, 0.012), (0.45, 0.017), (0.7, 0.021), (0.88, 0.016), (1.0, 0.0)]

def castor(G, M, x, y):
    """a brass castor under a post: the plate, the swivel, the fork and a small porcelain wheel"""
    turned(G, M['brass'], [(0.0, 0.018), (1.0, 0.012)], (x, y, 0.048), (x, y, 0.034), 8, attrs=ma())
    for s in (-1, 1): box(G, M['brass'], (x - 0.012, y + s * 0.011 - 0.0015, 0.012), (x + 0.012, y + s * 0.011 + 0.0015, 0.036), ma(), 0.0)
    turned(G, M['wheel'], [(0.0, 0.016), (0.3, 0.019), (0.7, 0.019), (1.0, 0.016)], (x, y - 0.009, 0.019), (x, y + 0.009, 0.019), 10, attrs=ma(0.3))

def cot_wood(G, M):
    paint = M['paint']
    for py in (PY0, PY1):
        for sx in (-1, 1):
            x = sx * PX; top = 0.985 if py == PY0 else 0.935
            box(G, paint, (x - 0.022, py - 0.022, 0.05), (x + 0.022, py + 0.022, top), wa((0, 0, 1)), 0.004, 2)
            turned(G, paint, FINIAL, (x, py, top), (x, py, top + (0.06 if py == PY0 else 0.055)), 8, (False, True), wa((0, 0, 1)))
            castor(G, M, x, py)
    for sx in (-1, 1):                                                   # (the long sides: rails and turned spindles)
        x = sx * PX
        box(G, paint, (x - 0.017, PY1 + 0.02, 0.895), (x + 0.017, PY0 - 0.02, 0.94), wa((0, 1, 0), wear=0.4), 0.006, 2)
        box(G, paint, (x - 0.014, PY1 + 0.02, 0.30), (x + 0.014, PY0 - 0.02, 0.345), wa((0, 1, 0)), 0.004, 1)
        n = 13
        for k in range(n):
            y = PY1 + 0.075 + (PY0 - PY1 - 0.15) * k / (n - 1)
            turned(G, paint, SPINDLE, (x, y, 0.343), (x, y, 0.897), 6, (False, False), wa((0, 0, 1)))
    for py, top in ((PY0, 0.97), (PY1, 0.92)):                           # (the ends: an arched top rail, a bottom rail, spindles)
        n = 6; pts = [(-PX + 0.02 + (2 * PX - 0.04) * i / n, top - 0.03 + 0.03 * math.sin(math.pi * i / n)) for i in range(n + 1)]
        for i in range(n):
            (xa, za), (xb, zb) = pts[i], pts[i + 1]
            bm = block((xa, py - 0.017, min(za, zb) - 0.045), (xb + 0.001, py + 0.017, max(za, zb)), 0.0, 1)
            for v in bm.verts:                                           # (the rail's top follows the arch)
                t = (v.co.x - xa) / max(1e-6, xb - xa); zt = za + (zb - za) * t
                if v.co.z > (za + zb) / 2 - 0.02: v.co.z += zt - max(za, zb)
                else: v.co.z += zt - max(za, zb)
            G.add(bm, paint, wa((1, 0, 0), wear=0.35), wrap=False)
        box(G, paint, (-PX + 0.02, py - 0.014, 0.30), (PX - 0.02, py + 0.014, 0.345), wa((1, 0, 0)), 0.004, 1)
        for k in range(7):
            x = -PX + 0.08 + (2 * PX - 0.16) * k / 6; zt = top - 0.03 + 0.03 * math.sin(math.pi * (x + PX - 0.02) / (2 * PX - 0.04)) - 0.04
            turned(G, paint, SPINDLE, (x, py, 0.343), (x, py, zt), 6, (False, False), wa((0, 0, 1)))
    for k in range(6):                                                   # (the mattress base: slats across)
        y = PY1 + 0.08 + (PY0 - PY1 - 0.16) * k / 5
        box(G, M['deal'], (-PX + 0.015, y - 0.035, 0.33), (PX - 0.015, y + 0.035, 0.345), wa((1, 0, 0)), 0.002, 1)

def cot_iron(G, M):
    en = M['enamel']
    for py in (PY0, PY1):
        for sx in (-1, 1):
            x = sx * PX; top = 1.0 if py == PY0 else 0.94
            turned(G, en, [(0.0, 0.0125), (1.0, 0.0125)], (x, py, 0.045), (x, py, top), 10, (False, False), ma())
            turned(G, M['brass'], [(0.0, 0.013), (0.2, 0.016), (0.35, 0.011), (0.55, 0.019), (0.85, 0.017), (1.0, 0.0)], (x, py, top), (x, py, top + 0.045), 10, (False, True), ma(0.5))
            turned(G, en, [(0.0, 0.016), (0.5, 0.014), (1.0, 0.0125)], (x, py, 0.03), (x, py, 0.06), 10, attrs=ma())
            castor(G, M, x, py)
    for sx in (-1, 1):
        x = sx * PX
        for z in (0.33, 0.9):
            tube(G, en, [Vector((x, PY1, z)), Vector((x, PY0, z))], 0.009, 8, ma(0.3 if z > 0.5 else 0.0))
        for k in range(21):
            y = PY1 + 0.05 + (PY0 - PY1 - 0.1) * k / 20
            tube(G, en, [Vector((x, y, 0.33)), Vector((x, y, 0.9))], 0.0052, 6, ma())
    for py, top in ((PY0, 0.96), (PY1, 0.9)):
        for z in (0.33, top):
            tube(G, en, [Vector((-PX, py, z)), Vector((PX, py, z))], 0.009, 8, ma(0.3 if z > 0.5 else 0.0))
        for k in range(11):
            x = -PX + 0.05 + (2 * PX - 0.1) * k / 10
            tube(G, en, [Vector((x, py, 0.33)), Vector((x, py, top))], 0.0052, 6, ma())
        for sx in (-1, 1):                                                # (a cast scroll in each top corner)
            c = Vector((sx * (PX - 0.075), py, top - 0.06)); pts = []
            for i in range(18):
                a = sx * (math.pi * 0.2 + 2.6 * math.pi * i / 17); r = 0.045 * math.exp(-0.5 * 2.6 * math.pi * i / 17 / math.pi)
                pts.append(c + Vector((r * math.cos(a), 0, r * math.sin(a))))
            tube(G, en, pts, 0.0038, 4, ma())
    for k in range(5):
        y = PY1 + 0.1 + (PY0 - PY1 - 0.2) * k / 4
        tube(G, M['iron'], [Vector((-PX, y, 0.335)), Vector((PX, y, 0.335))], 0.005, 6, ma())

def bedding(G, M, rnd, blanket):
    """the mattress (ticking, buttoned, sagging in the middle), a pillow at the head, the blanket turned back over the foot two thirds"""
    pillow(G, M['ticking'], (0.0, (PY0 + PY1) / 2, 0.402), 0.64, 1.18, 0.11, rnd, n=6, sag=0.35)
    pillow(G, M['linen'], (0.02, PY0 - 0.15, 0.487), 0.38, 0.22, 0.075, rnd, n=6, sag=0.2)
    y0, y1 = PY0 - 0.3, PY1 + 0.04; x0, x1 = -0.3, 0.3; ph = [rnd.uniform(0, 6.28) for _ in range(5)]
    def blank(s, t):                                                      # (lying over the mattress, rumpled, the top edge turned back)
        x = x0 + (x1 - x0) * s; y = y0 + (y1 - y0) * t
        z = 0.462 - 0.012 * (abs(2 * s - 1) ** 3) + 0.008 * math.sin(9 * s + ph[0] + 4 * t) * math.sin(5 * t + ph[1]) + 0.006 * math.sin(17 * s + ph[2])
        z += 0.03 * math.exp(-((t - 0.05) / 0.05) ** 2) * (0.6 + 0.4 * math.sin(7 * s + ph[3]))     # (the turned-back roll at the top)
        z -= 0.012 * math.exp(-((s - 0.5) / 0.3) ** 2) * math.exp(-((t - 0.5) / 0.35) ** 2)          # (sunk where the mattress sags)
        return Vector((x, y, z))
    drape(G, blanket, 12, 17, blank, attrs_of(lambda q, o=rnd.uniform(-9, 9): (q[0] + o, q[1] * 1.0, 0.0), rnd.random()))

def mobile(Gm, M, hub, rnd, wire='brass'):
    """the mobile: a hub, four arms, threads, and turned wooden figures (a bird, a star, a crescent moon, a fish), painted"""
    hub = Vector(hub)
    turned(Gm, M[wire], [(0.0, 0.006), (0.5, 0.008), (1.0, 0.004)], hub + Vector((0, 0, 0.01)), hub - Vector((0, 0, 0.012)), 10, attrs=ma())
    figs = [('bird', 'figA', 0.14), ('star', 'figB', 0.18), ('moon', 'figC', 0.12), ('fish', 'figD', 0.16)]
    for k, (kind, mk, drop) in enumerate(figs):
        a = math.pi / 4 + k * math.pi / 2; d = Vector((math.cos(a), math.sin(a), 0)); end = hub + d * 0.13 + Vector((0, 0, -0.012))
        tube(Gm, M[wire], [hub, hub + d * 0.065 + Vector((0, 0, 0.004)), end], 0.0015, 4, ma())
        tube(Gm, M['thread'], [end, end - Vector((0, 0, drop))], 0.0006, 3, ma())
        c = end - Vector((0, 0, drop + 0.025))
        if kind == 'bird':
            Gm.add(Dr.lathe_bm([(0.0, 0.0), (0.2, 0.012), (0.55, 0.016), (0.85, 0.01), (1.0, 0.0)], c - d * 0.03, c + d * 0.035, 8), M[mk], wa((0, 0, 1)), smooth=True, wrap=False)
            w = Vector((-d.y, d.x, 0))
            for s in (-1, 1): Gm.add(plate([(0.0, 0.0), (0.03, 0.006), (0.045, 0.0), (0.03, -0.004)], 0.0, 0.003), M[mk], wa(), wrap=False) if False else None
            Gm.add(block(c - w * 0.04 + Vector((0, 0, 0.002)) - d * 0.012, c + w * 0.04 + Vector((0, 0, 0.006)) + d * 0.012, 0.002, 1), M[mk], wa((1, 0, 0)), wrap=False)
        elif kind == 'star':
            pts = [(0.03 * (1 if i % 2 == 0 else 0.45) * math.cos(math.pi / 2 + i * math.pi / 5), 0.03 * (1 if i % 2 == 0 else 0.45) * math.sin(math.pi / 2 + i * math.pi / 5)) for i in range(10)]
            bm = plate([(c.x + p[0], c.z + p[1]) for p in pts], c.y + 0.004, 0.008, bevel=0.0015); Gm.add(bm, M[mk], wa((1, 0, 0)), wrap=False)
        elif kind == 'moon':
            pts = [(0.028 * math.cos(t), 0.028 * math.sin(t)) for t in np.linspace(0.5, 2 * math.pi - 0.5, 12)] + [(0.022 * math.cos(t) + 0.012, 0.022 * math.sin(t)) for t in np.linspace(2 * math.pi - 0.75, 0.75, 10)]
            bm = plate([(c.x + p[0], c.z + p[1]) for p in pts], c.y + 0.004, 0.008, bevel=0.0015); Gm.add(bm, M[mk], wa((1, 0, 0)), wrap=False)
        else:
            Gm.add(Dr.lathe_bm([(0.0, 0.0), (0.25, 0.011), (0.6, 0.012), (0.85, 0.005), (1.0, 0.0)], c - d * 0.035, c + d * 0.03, 8), M[mk], wa((0, 0, 1)), smooth=True, wrap=False)
            for s in (-1, 1): Gm.add(block(c - d * 0.05 + Vector((0, 0, s * 0.012)) - Vector((0.003, 0.003, 0.004)), c - d * 0.035 + Vector((0, 0, s * 0.002)) + Vector((0.003, 0.003, 0.004)), 0.001, 1), M[mk], wa(), wrap=False)

def mobile_arm(G, M, hub, wire='brass'):
    """the arm: a clamp on the head rail's middle, a stem up and over to the hub"""
    b = Vector((0.0, PY0, 0.955))
    box(G, M[wire], b + Vector((-0.02, -0.022, -0.03)), b + Vector((0.02, 0.022, 0.0)), ma(), 0.002)
    pts = [b + Vector((0, 0, 0.0)), b + Vector((0, -0.01, 0.06)), Vector((0, PY0 - 0.06, 1.035)), Vector((0, (PY0 + hub[1]) / 2, 1.042)), Vector(hub) + Vector((0, 0, 0.012))]
    tube(G, M[wire], pts, 0.0035, 6, ma(0.2))

def cot_materials(v):
    k = f'crib_v{v}'; M = {}
    M['brass'] = kitlib.metal(k + '_brass', 'brass', color='#a4824a', rust=0.0, age=1.4); M['iron'] = kitlib.metal(k + '_iron', 'iron', rust=0.7, age=1.5)
    M['wheel'] = kitlib.porcelain(k + '_wheel', '#e8e0d0', crackle=0.4, age=1.6); M['thread'] = kitlib.grey(k + '_thread', (0.35, 0.33, 0.3))
    hands = [(-PX - 0.03, PX + 0.03, 0.88, 0.98, 0.04, 0.8)]
    M['paint'] = Dr.paint(k + '_paint', ['#e8e2d1', '#aebdb3', '#8a5a3c'], 'pine', hands, kick=0.25, chips=1.1, gloss=0.32, age=1.5, joints=False)
    M['enamel'] = Dr.paint(k + '_enamel', ['#e4dcc6', '#2b2b29', '#2b2b29'], 'steel', hands, kick=0.2, chips=0.9, gloss=0.3, age=1.5, craze=0.6, joints=False, rust=0.6)
    M['deal'] = Dr.bare_boards(k + '_deal', 'deal', [], age=1.3, tone=0.9)
    M['ticking'] = kitlib.fabric(k + '_ticking', '#d7d0bf', weave=0.0, fade=0.4, stripes=('#5b6a86', 0.013), age=1.3)
    M['linen'] = kitlib.fabric(k + '_linen', '#e4ddcc', weave=0.0, fade=0.3, age=1.2)
    M['blanket'] = kitlib.fabric(k + '_blanket', '#c79fa2' if v == 0 else '#9db0c4', weave=0.0, fade=0.55, age=1.2)
    for mk, c in (('figA', '#c9473a'), ('figB', '#e0b440'), ('figC', '#e8e2cf'), ('figD', '#4f7aa8')):
        M[mk] = Dr.paint(f'{k}_{mk}', [c, '#d8d0bc', '#a07a50'], 'pine', [], kick=0.0, chips=0.7, gloss=0.35, age=1.3, joints=False)
    return M

def build_crib(v):
    t0 = time.time(); rnd = random.Random(31 + v); M = cot_materials(v)
    node = f'Solid_crib_v{v}'; G = S.Geo(1, 1, False, False); Gm = S.Geo(1, 1, False, False)
    (cot_wood if v == 0 else cot_iron)(G, M)
    bedding(G, M, rnd, M['blanket'])
    hub = (0.0, -0.42, 1.03); mobile_arm(G, M, hub); mobile(Gm, M, hub, rnd)
    body = F.build_obj(node, G); mob = F.build_obj(node + '_MobilePivot', Gm)
    files = F.bake_objs(f'crib_v{v}', [body, mob], 2048)
    body.name = node; body.data.name = node; body['kit'] = 'solid'
    F.pivot_child(body, node + '_MobilePivot', mob, hub)
    print(f'  {node}: {kitlib.tris(body)} + mobile {kitlib.tris(mob)} triangles, box {F.footprint_check([body, mob], None, None)}, bake {files["times"]["total"]}s', flush=True)
    return body, files

def build_simple(node, asset, builder, mats, rnd_seed, px=2048):
    rnd = random.Random(rnd_seed); M = mats(); G = S.Geo(1, 1, False, False); builder(G, M, rnd)
    body = F.build_obj(node, G); files = F.bake_objs(asset, [body], px)
    body.name = node; body.data.name = node; body['kit'] = 'solid'
    print(f'  {node}: {kitlib.tris(body)} triangles, box {F.footprint_check([body], None, None)}, bake {files["times"]["total"]}s', flush=True)
    return body, files

def run(asset, nodes_builders, wall=False):
    """build, bake, sheet and register one asset (one or more nodes)"""
    t0 = time.time(); kitlib.reset(); roots = []; info = {}
    for args in nodes_builders:
        r, f = build_simple(*args); roots.append(r); info[r.name] = {'tris': kitlib.tris(r), 'bake': f['times']['total']}
    if '--sheets' in sys.argv: print('sheet', F.sheet(asset, roots, STYLE, wall=wall))
    json.dump(info, open(os.path.join(TMP, f'furn_wood_{asset}.json'), 'w'), indent=1)
    kitlib.register(f'furn_wood_{asset}', roots); print(f'{asset}: {time.time() - t0:.0f}s', flush=True)

def main():
    import furn_wood2 as W2
    want = lambda k: OPTS.only is None or k in OPTS.only
    if want('crib'):
        t0 = time.time(); roots = []; info = {}; kitlib.reset()
        for v in (0, 1):
            r, f = build_crib(v); roots.append(r); info[r.name] = {'tris': kitlib.tris(r) + sum(kitlib.tris(c) for c in r.children), 'bake': f['times']['total']}
        if '--sheets' in sys.argv: print('sheet', F.sheet('crib', roots, STYLE, wall=True))
        json.dump(info, open(os.path.join(TMP, 'furn_wood_crib.json'), 'w'), indent=1)
        kitlib.register('furn_wood_crib', roots)
        print(f'crib: {time.time() - t0:.0f}s', flush=True)
    if want('iron_bed'): run('iron_bed', [('Solid_iron_bed', 'iron_bed', W2.iron_bed, W2.bed_materials, 7)], wall=True)
    if want('toy_chest'): run('toy_chest', [(f'Solid_toy_chest_v{v}', f'toy_chest_v{v}', (lambda G, M, r, v=v: W2.toy_chest(G, M, r, v)), (lambda v=v: W2.chest_materials(v)), 11 + v, 1024) for v in (0, 1)])
    if want('doll_house'): run('doll_house', [('Solid_doll_house', 'doll_house', W2.doll_house, W2.dh_materials, 13)])
    if want('rocking_horse'): run('rocking_horse', [('Solid_rocking_horse', 'rocking_horse', W2.rocking_horse, W2.horse_materials, 17)])
    if want('pram'): run('pram', [('Solid_pram', 'pram', W2.pram, W2.pram_materials, 19)])
    import furn_wood3 as W3
    if want('nursery_table'): run('nursery_table', [('Solid_nursery_table', 'nursery_table', W3.nursery_table, W3.table_materials, 29)])
    isl = [k for k in ('isl_crib_rocker', 'isl_twin_cribs', 'isl_bed_screen') if want(k) or want('islands')]
    if isl: islands(W3, isl)

def islands(W3, ids):
    """the islands: their new parts baked together, the reused pieces joined in, the animated part on its pivot"""
    t0 = time.time(); kitlib.reset()
    specs, new_parts, M = W3.build_islands(lambda k: k in ids)
    files = F.bake_objs('isl_wood', new_parts, 2048, spread=True) if new_parts else None
    roots = []; info = {}
    for name, statics, piv, piv_name, piv_loc, junk in specs:
        statics = [o for o in statics if o.name in bpy.data.objects]
        body = kitlib.join(statics, name) if len(statics) > 1 else statics[0]
        body.name = name; body.data.name = name; body['kit'] = 'island'
        if piv is not None: F.pivot_child(body, piv_name, piv, piv_loc)
        for j in junk:
            if j.name in bpy.data.objects: bpy.data.objects.remove(j)
        roots.append(body); info[name] = {'tris': kitlib.tris(body) + sum(kitlib.tris(c) for c in body.children), 'mats': len(body.data.materials)}
        print(f'  {name}: {info[name]}, box {F.footprint_check([body] + list(body.children), None, None)}', flush=True)
    for o in list(bpy.data.objects):                                     # (whatever came along from the appended files and isn't used)
        if o not in roots and o.parent not in roots and o.type in ('EMPTY',): bpy.data.objects.remove(o)
    if '--sheets' in sys.argv: print('sheet', F.sheet('islands_wood', roots, STYLE))
    json.dump({'info': info, 'bake': files['times']['total'] if files else 0}, open(os.path.join(TMP, 'furn_wood_islands.json'), 'w'), indent=1)
    kitlib.register('furn_wood_islands', roots); print(f'islands: {time.time() - t0:.0f}s', flush=True)

if __name__ == '__main__':
    main()
