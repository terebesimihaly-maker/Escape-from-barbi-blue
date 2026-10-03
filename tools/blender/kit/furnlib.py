# Escape from Barbi Blue: what the furniture scripts (furn_<style>.py, WP2.5) share: building a piece from parts (S.Geo with the bake
# attributes the materials read: gpos grain space, opos, prand, ja/jb joints, wear), turned and swept members, cloth laid over
# things, the bake into the piece's own texture set, its animated children (pivots) and sockets, registering it for pack.py, and the
# contact sheets (front, three-quarter, top, and close in a raking light, on the style's own floor against its own wall).
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
from doors import lathe_bm, tube, block, plate, attrs_of, metal_attrs, wood_attrs, member, ATTRS
from kitlib import OPTS, TMP, lin

ITEMS = defs.KIT['items']; BAND = defs.KIT['band']

def wa(grain=(0, 0, 1), depth=(0, -1, 0), wear=0.0, ja=9.0, jb=9.0):
    """wood attributes for one member: its own grain space and tone"""
    gp, pr = member(grain, depth); a = attrs_of(gp, pr, ja, jb); a['wear'] = wear; return a

def ma(wear=0.0):
    a = metal_attrs(); a['wear'] = wear; return a

def turned(G, mat, prof, p0, p1, sides=10, caps=(True, True), attrs=None, smooth=True):
    """a turned member: prof [(t, r)] along p0 -> p1"""
    G.add(lathe_bm(prof, p0, p1, sides, caps), mat, attrs or wa(Vector(p1) - Vector(p0)), smooth=smooth, wrap=False)

def box(G, mat, lo, hi, attrs=None, bevel=0.002, segs=1):
    G.add(block(lo, hi, bevel, segs), mat, attrs or wa(), wrap=False)

def grid_surface(G, mat, P, attrs, closed_u=False, flip_to=None, smooth=True):
    """a quad surface through rows of points P[j][i]; faces turned toward flip_to(face centre) when given"""
    bm = bmesh.new(); V = [[bm.verts.new(p) for p in row] for row in P]; nu = len(P[0])
    for j in range(len(P) - 1):
        for i in range(nu - (0 if closed_u else 1)):
            vs = (V[j][i], V[j][(i + 1) % nu], V[j + 1][(i + 1) % nu], V[j + 1][i])
            if (vs[2].co - vs[0].co).cross(vs[3].co - vs[1].co).length < 1e-12: continue
            f = bm.faces.new(vs); f.normal_update()
            if flip_to is not None and f.normal.dot(flip_to(f.calc_center_median())) < 0: f.normal_flip()
    G.add(bm, mat, attrs, smooth=smooth, wrap=False)

def pillow(G, mat, c, sx, sy, sz, rnd, n=12, sag=0.25):
    """a stuffed pillow / mattress-like cushion: a rounded box puffed in the middle, the seam round its edge, slumped"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=n - 1, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co.x * 2, v.co.y * 2, v.co.z * 2                   # (-1 .. 1)
        r = max(abs(x), abs(y)); puff = (1 - x * x) * (1 - y * y)
        zz = z * (0.15 + 0.85 * puff ** 0.6) - sag * puff * 0.3 * (1 if z > 0 else -0.2)
        nn = mnoise.noise(Vector((x * 2 + c[0] * 7, y * 2, z * 2))) * 0.04
        v.co = Vector((c[0] + x * sx / 2 * (1 - 0.06 * (1 - z * z)), c[1] + y * sy / 2 * (1 - 0.06 * (1 - z * z)), c[2] + zz * sz / 2 + nn * sz))
    G.add(bm, mat, attrs_of(lambda q, o=Vector((rnd.uniform(-9, 9), rnd.uniform(-9, 9), 0)): (q[0] + o.x, q[1] + o.y, q[2]), rnd.random()), smooth=True, wrap=False)

def drape(G, mat, nu, nv, f, attrs, smooth=True, out=None):
    """a cloth surface from f(s, t) -> point (s, t in 0..1); its faces turned away from what it lies on (out(face centre) -> the
       outward direction; by default away from a point well below the cloth's middle: up on top, outward where it hangs)"""
    P = [[f(i / nu, j / nv) for i in range(nu + 1)] for j in range(nv + 1)]
    if out is None:
        pts = [p for row in P for p in row]; c = sum(pts, Vector()) / len(pts); ext = max((p - c).length for p in pts)
        below = Vector((c.x, c.y, min(p.z for p in pts) - 1.5 * ext)); out = lambda q: q - below
    grid_surface(G, mat, P, attrs, smooth=smooth, flip_to=out)

# ---------------------------------------------------------------- bake and register
def build_obj(name, G):
    ob = G.build(name)
    for a in ('wear', 'curv'):
        if a not in ob.data.attributes: kitlib.attr(ob, a, [0.0] * len(ob.data.vertices))
    return ob

RESERVED = ('Glass', 'Emit', 'SkyPlane', 'WallSurface')

def _split_reserved(ob):
    """the faces in reserved materials (glass the game swaps in, emitters) taken out of ob before the bake -> their object or None"""
    idx = [i for i, m in enumerate(ob.data.materials) if m and m.name in RESERVED]
    if not idx: return None
    bm = bmesh.new(); bm.from_mesh(ob.data); rb = bm.copy()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context='FACES')
    bmesh.ops.delete(rb, geom=[f for f in rb.faces if f.material_index not in idx], context='FACES')
    for b in (bm, rb): bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context='VERTS')
    me2 = ob.data.copy(); rb.to_mesh(me2); rb.free(); bm.to_mesh(ob.data); bm.free()
    r = kitlib.link(bpy.data.objects.new(ob.name + '_res', me2)); r.matrix_world = ob.matrix_world.copy(); return r

def bake_objs(name, objs, px=2048, alpha=None, double=False, spread=False):
    """the objects' shared texture set: unwrapped together (islands off the border), baked, the baked material on each; faces in the
       reserved materials (Glass, Emit) are kept out of the bake and joined back after, in their own material"""
    res = {o: _split_reserved(o) for o in objs}
    if spread:
        for i, o in enumerate(objs): o.location.x += 4.0 * i
    kitlib.unwrap(objs, margin=0.004, smart=True, angle=60)
    files = kitlib.bake_set(objs, name, px, 64)
    if spread:
        for i, o in enumerate(objs): o.location.x -= 4.0 * i
    mat = kitlib.baked_material('Kit_' + name, files, double=double, alpha=alpha)
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(mat); o.data.polygons.foreach_set('material_index', [0] * len(o.data.polygons))
        for a in [a.name for a in o.data.attributes if a.name in ATTRS]: o.data.attributes.remove(o.data.attributes[a])
        r = res.get(o)
        if r:
            for a in [a.name for a in r.data.attributes if a.name in ATTRS]: r.data.attributes.remove(r.data.attributes[a])
            if not r.data.uv_layers: r.data.uv_layers.new(name=o.data.uv_layers[0].name)
            nm = o.name; j = kitlib.join([o, r], nm)
            used = sorted(set(p_.material_index for p_ in j.data.polygons)); uniq = []
            for m_ in sorted((j.data.materials[i] for i in used), key=lambda q: 0 if q.name.startswith('Kit_') else 1):
                if m_ not in uniq: uniq.append(m_)
            mi = [uniq.index(j.data.materials[p_.material_index]) for p_ in j.data.polygons]; j.data.materials.clear()
            for m_ in uniq: j.data.materials.append(m_)
            j.data.polygons.foreach_set('material_index', mi)
    return files

def pivot_child(root, name, ob, pivot):
    """an animated part: its origin on the pivot, parented to the root"""
    kitlib.set_origin(ob, pivot); ob.name = name; ob.data.name = name
    ob.parent = root; ob.matrix_parent_inverse.identity(); ob.location = Vector(pivot) - root.location
    return ob

def footprint_check(ob_list, item, slot):
    """how the piece's box sits against the KIT box (printed, so a sheet run shows it)"""
    pts = [o.matrix_world @ v.co for o in ob_list for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return [round(c, 3) for c in lo], [round(c, 3) for c in hi]

# ---------------------------------------------------------------- contact sheets
def sheet(asset, roots, style, wall=False, size=(1.0, 1.0, 1.0)):
    """each root: front, three-quarter, top-down and a raking close-up, on the style's floor (against its wall for wall pieces)"""
    from PIL import Image
    d = os.path.join(TMP, 'sheets', 'furniture'); os.makedirs(d, exist_ok=True)
    man = S.manifest_load()['styles'].get(style, {}); sc = bpy.context.scene; FW = 2.25
    fl = S.ship_mat('sh_floor', man['floor']) if man.get('floor') else kitlib.grey()
    wA = S.ship_mat('sh_wallA', man['wall'], 0) if man.get('wall') else kitlib.grey()
    tmp = []
    def keep(o): tmp.append(o); return o
    for i in (-1, 0, 1):
        for j in (-2, -1, 0): keep(S.quad(f'sh_f{i}{j}', (i * FW - FW / 2, j * FW, 0), (FW, 0, 0), (0, FW, 0), mat=fl))
        keep(S.quad(f'sh_w{i}', (i * FW + FW / 2, 0.002 if wall else 1.6, 0), (-FW, 0, 0), (0, 0, 3.0), mat=wA))
    keep(S.lamp('sh_key', 'AREA', 140, (1.6, -2.4, 2.6), None, 1.2, (1.0, 0.85, 0.66)))
    keep(S.lamp('sh_fill', 'AREA', 50, (-2.0, -1.5, 2.0), None, 1.5, (0.75, 0.82, 1.0)))
    sc.world.color = (0.03, 0.03, 0.035); shots = []
    glm = kitlib.Mat('sh_glass'); glm.b.inputs['Transmission Weight'].default_value = 1.0; glm.b.inputs['Roughness'].default_value = 0.03
    swaps = []                                                              # (the reserved Glass seen as glass, as the game shows it)
    for r in roots:
        for o in [r] + list(r.children_recursive):
            if o.type != 'MESH': continue
            for i, m_ in enumerate(o.data.materials):
                if m_ and m_.name == 'Glass': swaps.append((o, i, m_)); o.data.materials[i] = glm.m
    for r in roots:
        for o in roots:
            for q in [o] + list(o.children_recursive): q.hide_render = o is not r
        bb = [o.matrix_world @ Vector(v) for o in [r] + list(r.children_recursive) if o.type == 'MESH' for v in o.bound_box]
        lo = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb))); hi = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
        c = (lo + hi) / 2; ext = max((hi - lo).x, (hi - lo).y, (hi - lo).z); dist = 1.25 + ext * 1.6
        S.cam_at(c + Vector((0.0, -dist, 0.25 * ext + 0.25)), c, 35); shots.append(S.render(os.path.join(d, f'{r.name}_front.png'), 900, 800, 128))
        S.cam_at(c + Vector((dist * 0.7, -dist * 0.75, 0.45 * ext + 0.5)), c, 35); shots.append(S.render(os.path.join(d, f'{r.name}_34.png'), 900, 800, 128))
        S.cam_at(c + Vector((0.001, -0.25, dist * 1.1)), c, 35); shots.append(S.render(os.path.join(d, f'{r.name}_top.png'), 900, 800, 96))
        S.cam_at(c + Vector((ext * 0.45, -ext * 0.55 - 0.35, ext * 0.25 + 0.15)), c + Vector((0, 0, ext * 0.1)), 50); shots.append(S.render(os.path.join(d, f'{r.name}_close.png'), 900, 800, 128))
    for o, i, m_ in swaps: o.data.materials[i] = m_
    for o in roots: o.hide_render = False
    for r in roots:
        for o in r.children_recursive: o.hide_render = False
    for o in tmp:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o)
    ims = [Image.open(p).convert('RGB') for p in shots]; W = 4; hgt = 400
    ims = [im.resize((int(im.width * hgt / im.height), hgt)) for im in ims]; rows = (len(ims) + W - 1) // W; cw = ims[0].width
    out = Image.new('RGB', (cw * W, hgt * rows))
    for k, im in enumerate(ims): out.paste(im, ((k % W) * cw, (k // W) * hgt))
    out.save(os.path.join(d, f'{asset}.png')); return os.path.join(d, f'{asset}.png')

# ---------------------------------------------------------------- build, bake, register (every style's furniture script)
def build_simple(node, asset, builder, mats, rnd_seed, px=2048):
    """one node from a builder(G, M, rnd): built, baked into its own set; G.sockets [(name, loc)] become empties under it"""
    rnd = random.Random(rnd_seed); M = mats(); G = S.Geo(1, 1, False, False); builder(G, M, rnd)
    body = build_obj(node, G); pivs = getattr(G, 'pivots', [])
    files = bake_objs(asset, [body] + [ob for _, ob, _ in pivs], px)              # (animated parts share the piece's texture set)
    body = bpy.data.objects[node] if node in bpy.data.objects else body
    body.name = node; body.data.name = node; body['kit'] = 'band' if node.startswith('Band_') else 'solid'
    for nm, loc in getattr(G, 'sockets', []):                               # (empties: a fixture's place, where the game seats a doll)
        e = kitlib.empty(nm, loc, body); e.matrix_parent_inverse.identity(); e.location = loc
    for nm, ob, piv in pivs:                                                 # (animated children: (name, object, pivot point))
        pivot_child(body, nm, ob, piv)
    print(f'  {node}: {kitlib.tris(body) + sum(kitlib.tris(c) for c in body.children if c.type == "MESH")} triangles, box {footprint_check([body] + [c for c in body.children if c.type == "MESH"], None, None)}, bake {files["times"]["total"]}s', flush=True)
    return body, files

def run(style, asset, nodes_builders, wall=False):
    """build, bake, sheet and register one asset (one or more nodes)"""
    t0 = time.time(); kitlib.reset(); roots = []; info = {}
    for args in nodes_builders:
        r, f = build_simple(*args); roots.append(r); info[r.name] = {'tris': kitlib.tris(r), 'bake': f['times']['total']}
    if '--sheets' in sys.argv: print('sheet', sheet(asset, roots, style, wall=wall))
    json.dump(info, open(os.path.join(TMP, f'furn_{style}_{asset}.json'), 'w'), indent=1)
    kitlib.register(f'furn_{style}_{asset}', roots); print(f'{asset}: {time.time() - t0:.0f}s', flush=True)

def islands(style, build_fn, ids):
    """islands: build_fn(want) -> (specs [(name, statics, pivot obj, pivot name, pivot point, junk)], new parts, M); the new parts baked
       together, the reused pieces joined in, the animated part on its pivot; one registration per island"""
    t0 = time.time(); kitlib.reset()
    specs, new_parts, M = build_fn(lambda k: k in ids)
    files = bake_objs(f'isl_{style}_' + '_'.join(sorted(i[4:] for i in ids))[:60], new_parts, 2048, spread=True) if new_parts else None
    roots = []; info = {}
    for spec in specs:
        name, statics, piv, piv_name, piv_loc, junk = spec[:6]; socks = spec[6] if len(spec) > 6 else []
        statics = [o for o in statics if o.name in bpy.data.objects]
        body = kitlib.join(statics, name) if len(statics) > 1 else statics[0]
        body.name = name; body.data.name = name; body['kit'] = 'island'
        if piv is not None: pivot_child(body, piv_name, piv, piv_loc)
        for nm, loc in socks:                                            # (a fixture's place: an empty under the island)
            e = kitlib.empty(nm, loc, body); e.matrix_parent_inverse.identity(); e.location = loc
        for j in junk:
            if j.name in bpy.data.objects: bpy.data.objects.remove(j)
        roots.append(body); info[name] = {'tris': kitlib.tris(body) + sum(kitlib.tris(c) for c in body.children if c.type == 'MESH'), 'mats': len(body.data.materials)}
        print(f'  {name}: {info[name]}, box {footprint_check([body] + [c for c in body.children if c.type == "MESH"], None, None)}', flush=True)
    for o in list(bpy.data.objects):                                     # (whatever came along from the appended files and isn't used)
        if o not in roots and o.parent not in roots and o.type in ('EMPTY',): bpy.data.objects.remove(o)
    if '--sheets' in sys.argv: print('sheet', sheet(f'islands_{style}', roots, style))
    blend = os.path.join(TMP, f'furn_{style}_islands_' + '_'.join(sorted(r.name[4:] for r in roots)) + '.blend')
    kitlib.register(f'furn_{style}_islands_tmp', roots, blend=blend)
    reg = os.path.join(TMP, 'assets', f'furn_{style}_islands_tmp.json'); r_ = json.load(open(reg)); os.remove(reg)
    for n in r_['nodes']:                                                # (one registration per island: rebuilding some never drops the others)
        e = dict(r_); e['asset'] = f'furn_{style}_' + n; e['nodes'] = [n]; json.dump(e, open(os.path.join(TMP, 'assets', f'furn_{style}_{n}.json'), 'w'), indent=1)
    print(f'islands: {time.time() - t0:.0f}s', flush=True)

def append(asset, names):
    """the named objects (and their children) from a registered asset's .blend, linked into the scene, keyed by their source names"""
    path = os.path.join(TMP, asset + '.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        want = [n for n in src.objects if any(n == x or n.startswith(x + '_') for x in names)]; dst.objects = list(want)
    out = {}
    for n, o in zip(want, dst.objects):
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

def fa(rnd, sx=1.0, sy=1.0):
    """fabric / generic attributes: the object's own coordinates scaled, offset at random"""
    o = Vector((rnd.uniform(-9, 9), rnd.uniform(-9, 9), 0)); return attrs_of(lambda q, o=o: (q[0] * sx + o.x, q[1] * sy + o.y, q[2]), rnd.random())

def rod(G, mat, pts, r, sides=8, attrs=None, caps=(True, True), sub=1, smooth=True):
    """one continuous round bar along pts (bent, not jointed: rings carried along by parallel transport); sub > 1 rounds the polyline
       through Catmull-Rom first; r a radius or r(t 0..1)"""
    P = [Vector(p) for p in pts]
    if sub > 1:
        Q = []
        for i in range(len(P) - 1):
            a, b, c, d = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
            for k in range(sub):
                t = k / sub; Q.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3))
        Q.append(P[-1]); P = Q
    n = len(P); T = [(P[min(n - 1, i + 1)] - P[max(0, i - 1)]).normalized() for i in range(n)]
    u, _ = kitlib.frame(T[0], (0, 0, 1)); L = [0.0]
    for i in range(1, n): L.append(L[-1] + (P[i] - P[i - 1]).length)
    bm = bmesh.new(); rings = []
    for i in range(n):
        if i: u = (u - T[i] * u.dot(T[i])).normalized()
        v = T[i].cross(u); rr = r(L[i] / max(L[-1], 1e-9)) if callable(r) else r
        rings.append([bm.verts.new(P[i] + (u * math.cos(2 * math.pi * j / sides) + v * math.sin(2 * math.pi * j / sides)) * rr) for j in range(sides)])
    for i in range(n - 1):
        for j in range(sides):
            vs = (rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j]); f = bm.faces.new(vs); f.normal_update()
            if f.normal.dot(f.calc_center_median() - (P[i] + P[i + 1]) / 2) < 0: f.normal_flip()
    for i, on, sg in ((0, caps[0], -1), (n - 1, caps[1], 1)):
        if on:
            f = bm.faces.new(rings[i]); f.normal_update()
            if f.normal.dot(T[i] * sg) < 0: f.normal_flip()
    G.add(bm, mat, attrs or ma(), smooth=smooth, wrap=False)
