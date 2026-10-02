# Escape from Barbi Blue: the house's mouldings (build spec B5, WP2.2): per style the profiles js/arch.js sweeps along the walls
# (skirting, dado rail, cornice, picture rail) and the trim sheet they are textured from.
# The profiles are period ones (a torus-and-cavetto skirting, a nosed dado rail, a coved cornice with its fillets and bead, a
# picture rail with its hook lip; marble bullnose, concrete curb, plain and beaded boards) written to
# textures/arch/<style>.profiles.json in arch.js's own shape ({skirting, dado, cornice, pictureRail}: {pts: [[d, y]...] out from the
# wall and up from the anchor, y for the rails, v: the band}, null where a style has none). The same polylines are swept in
# Blender with the UVs arch.js gives them (u = metres along / 2.25; v = arc length along the profile inside its band: skirting
# 0-0.4, dado 0.4-0.55, cornice 0.55-0.85, picture rail 0.85-1), normals smoothed where the profile turns less than 40 degrees as
# arch.js does, and baked onto those UVs with the wall, floor and ceiling and a run of moulding past each end in the scene, so
# the AO is right and the sheet tiles along its length: textures/surf/<style>/trim_{color,normal,orh}.<tier>.webp (2048 x 256 hi).
# The materials are the walls' and floors' own (surfaces2.py: the wainscot's paint, distemper, Nero marble, cement) and kitlib's
# woods (varnished mahogany, bare pine), so a moulding matches what it runs along.
#   py -3.11 tools/blender/kit/trims.py [--preview] [--only wood,tile] [--force] [--sheets]
import sys, os, math, json, time, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector
import kitlib, defs
import surfaces2 as S
from kitlib import OPTS, lin

S.UVLOOK = True                                                   # (the baked cavity and edges come back through the trims' own UVs)
W = S.TW; FH = S.FH; CEIL = 3.6                                   # (the cornice under a 3.6 m ceiling: clear of the picture rail at 3.0)
OVER = 0.3                                                        # (baked this far past the tile's end, then blended into its start)
BANDS = {'skirting': (0.0, 0.4), 'dado': (0.4, 0.55), 'cornice': (0.55, 0.85), 'pictureRail': (0.85, 1.0)}
ARCH = os.path.join(defs.REPO, 'textures', 'arch')
TR = defs.KIT['arch']['trims']

# ================================================================ the profiles ([d out from the wall, y up from the anchor])
def arc(cx, cy, rx, ry, a0, a1, n):
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

def batten(h=0.045, d=0.025, e=0.004):
    return [(0.0, -h / 2), (d - e, -h / 2), (d, -h / 2 + e), (d, h / 2 - e), (d - e, h / 2), (0.0, h / 2)]

def picture_rail(h=0.045, d=0.025):
    """a picture rail: an ovolo under it, a flat face, the rounded lip the hooks hang on and the groove behind it"""
    return [(0.0, -h / 2), (0.012, -h / 2)] + arc(0.012, -h / 2 + 0.012, d - 0.012 - 0.001, 0.012, -90, 0, 6)[1:] + [(d - 0.001, 0.006)] + \
           arc(d - 0.0065, 0.012, 0.0055, 0.0055, 0, 180, 8)[1:] + [(d - 0.012, 0.008), (0.009, 0.008), (0.009, h / 2), (0.0, h / 2)]

def nosed_rail(h=0.06, d=0.03):
    """a dado rail: a fillet, a cove up to a torus nosing, a cavetto back to the wall"""
    return [(0.0, -h / 2), (0.008, -h / 2), (0.008, -h / 2 + 0.006)] + arc(0.016, -h / 2 + 0.006, 0.008, 0.012, 180, 90, 5)[1:] + \
           arc(d - 0.012, 0.0, 0.012, 0.0125, -90, 90, 10)[1:] + arc(0.008 + 0.006, h / 2 - 0.006, 0.006, 0.006, -90, 180, 1)[1:2] + \
           [(0.012, h / 2 - 0.004), (0.008, h / 2), (0.0, h / 2)]

def profiles(style):
    t = TR.get(style, {}); sk = t.get('skirting', {}); C = t.get('cornice', {})
    if style == 'wood':
        h, d = sk.get('h', 0.18), sk.get('d', 0.025)
        skirt = [(0.0, 0.0), (d, 0.0), (d, h - 0.062), (d - 0.003, h - 0.061)] + arc(d - 0.009, h - 0.05, 0.009, 0.011, -80, 90, 8)[1:] + \
                [(d - 0.014, h - 0.039), (d - 0.014, h - 0.036)] + [(d - 0.014 - 0.006 * math.sin(math.pi / 2 * k / 5), h - 0.036 + 0.03 * k / 5) for k in range(1, 6)] + \
                [(0.004, h - 0.004), (0.004, h), (0.0, h)]
        ch, cd = C.get('h', 0.14), C.get('d', 0.12)
        corn = [(0.0, -ch), (0.006, -ch), (0.006, -ch + 0.01)] + arc(0.011, -ch + 0.016, 0.005, 0.006, -90, 90, 6)[1:] + \
               [(0.022, -ch + 0.022), (0.022, -ch + 0.028)] + arc(cd - 0.015, -ch + 0.028, cd - 0.037, ch - 0.048, 180, 90, 12)[1:] + \
               [(cd - 0.01, -0.02), (cd - 0.01, -0.014), (cd, -0.014), (cd, 0.0)]
        return {'skirting': skirt, 'dado': nosed_rail(), 'cornice': corn, 'pictureRail': picture_rail()}
    if style == 'tile':
        h, d = sk.get('h', 0.25), 0.03
        skirt = [(0.0, 0.0), (d, 0.0), (d, h - 0.018)] + arc(d - 0.018, h - 0.018, 0.018, 0.018, 0, 90, 10)[1:] + [(0.0, h)]
        ch, cd = C.get('h', 0.2), 0.16
        corn = [(0.0, -ch), (0.01, -ch), (0.01, -ch + 0.02), (0.025, -ch + 0.02), (0.025, -ch + 0.05), (0.035, -ch + 0.05), (0.035, -ch + 0.06)]
        corn += [(0.035 + (cd - 0.055) * (k / 14), -ch + 0.06 + (ch - 0.08) * (0.5 - 0.5 * math.cos(math.pi * k / 14))) for k in range(1, 15)]   # (a cyma recta)
        corn += [(cd - 0.02, -0.02), (cd, -0.02), (cd, 0.0)]
        return {'skirting': skirt, 'dado': nosed_rail(0.064, 0.032), 'cornice': corn, 'pictureRail': picture_rail()}
    if style == 'concrete':
        h, d = sk.get('h', 0.1), sk.get('d', 0.04)
        return {'skirting': [(0.0, 0.0), (d, 0.0), (d, h - 0.012), (d - 0.012, h), (0.0, h)], 'dado': None, 'cornice': None, 'pictureRail': batten()}
    if style == 'attic':
        h, d = sk.get('h', 0.09), sk.get('d', 0.02)
        return {'skirting': [(0.0, 0.0), (d, 0.0), (d, h - 0.005), (d - 0.005, h), (0.0, h)], 'dado': None, 'cornice': None, 'pictureRail': batten()}
    h, d = sk.get('h', 0.14), 0.022
    skirt = [(0.0, 0.0), (d, 0.0), (d, h - 0.015)] + arc(d - 0.005, h - 0.01, 0.005, 0.005, -90, 90, 6)[1:] + [(d - 0.01, h - 0.005), (d - 0.01, h), (0.0, h)]
    corn = [(0.0, -0.12), (0.02, -0.12), (0.02, -0.09), (0.045, -0.09), (0.045, -0.06), (0.065, -0.06), (0.065, -0.03), (0.08, -0.03), (0.08, 0.0)]
    return {'skirting': skirt, 'dado': batten(0.05, 0.04), 'cornice': corn, 'pictureRail': batten()}

def rail_y(style, kind):
    if kind == 'dado': return float(TR.get(style, {}).get('dado', 0.93))
    if kind == 'pictureRail': return float(TR.get(style, {}).get('pictureRail', FH))
    return None

def write_profiles(style, P):
    os.makedirs(ARCH, exist_ok=True); out = {}
    for k in ('skirting', 'dado', 'cornice', 'pictureRail'):
        if P.get(k) is None: out[k] = None; continue
        e = {'pts': [[round(a, 5), round(b, 5)] for a, b in P[k]], 'v': list(BANDS[k])}
        if rail_y(style, k) is not None: e['y'] = rail_y(style, k)
        out[k] = e
    p = os.path.join(ARCH, f'{style}.profiles.json'); json.dump(out, open(p, 'w'), indent=1); return p

# ================================================================ the swept mesh, with arch.js's UVs
def draws(pts, kind):
    """arch.js's draw flags per segment: not on the wall, not the skirting's floor run, not the cornice's ceiling run"""
    out = []
    for k in range(len(pts) - 1):
        (d0, y0), (d1, y1) = pts[k], pts[k + 1]
        on_wall = abs(d0) < 1e-9 and abs(d1) < 1e-9
        on_floor = kind == 'skirting' and abs(y0) < 1e-9 and abs(y1) < 1e-9
        on_ceil = kind == 'cornice' and abs(y0) < 1e-9 and abs(y1) < 1e-9
        out.append(not (on_wall or on_floor or on_ceil))
    return out

def sweep_profile(pts, kind, anchor, x0, x1, nseg=1, ulen=None):
    """the moulding from x0 to x1: one strip of faces per drawn segment, UV (x / W, the band's v by arc length); Blender axes:
       x along the wall, -y out of it (d), z up (anchor + y)"""
    v0, v1 = BANDS[kind]; ar = [0.0]
    for k in range(len(pts) - 1): ar.append(ar[-1] + math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]))
    tot = ar[-1] or 1.0; dr = draws(pts, kind)
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    xs = [x0 + (x1 - x0) * i / nseg for i in range(nseg + 1)]
    V = [[bm.verts.new((x, -d, anchor + y)) for (d, y) in pts] for x in xs]
    for i in range(nseg):
        for k in range(len(pts) - 1):
            if not dr[k]: continue
            f = bm.faces.new((V[i][k], V[i + 1][k], V[i + 1][k + 1], V[i][k + 1]))
            for lp, (xi, kk) in zip(f.loops, ((i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1))):
                lp[uvl].uv = (xs[xi] / (ulen or W), v0 + (v1 - v0) * ar[kk] / tot)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    # outward as arch.js decides it: the strip's faces take the right-hand normal of each segment, outward when the profile
    # (closed back to the wall) runs anticlockwise in (d, y)
    ring = list(pts)
    if abs(pts[-1][0]) > 1e-9: ring.append((0.0, pts[-1][1]))
    if abs(pts[0][0]) > 1e-9: ring.append((0.0, pts[0][1]))
    area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    if area < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.normal_update(); return bm

def to_object(name, bm, mat, attrs):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = kitlib.link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(40))
    n = len(me.vertices)
    for k, v in attrs.items():
        vals = [v(vv.co) for vv in me.vertices] if callable(v) else [v] * n; isv = isinstance(vals[0], tuple)
        a = me.attributes.new(k, 'FLOAT_VECTOR' if isv else 'FLOAT', 'POINT')
        a.data.foreach_set('vector' if isv else 'value', [c for x in vals for c in (x if isv else (x,))])
    return ob

def materials(style):
    """the moulding materials: what each runs along or is made of"""
    if style == 'wood':
        return {'skirting': S.paint_mat('wood_trim_skirt', W, FH, '#c6b796', '#5f6d52', '#8a5a3c', '#9c774c', wv=False, chips=1.3, scuff=0.3, age=1.5, up=2),
                'dado': S.paint_mat('wood_trim_dado', W, FH, '#cabb9b', '#5f6d52', '#8a5a3c', '#9c774c', wv=False, chips=1.4, age=1.4, up=2),
                'cornice': S.distemper_mat('wood_trim_cornice', W, FH, col='#cbc4b0', wv=False, holes=False),
                'pictureRail': kitlib.wood('wood_trim_picture', 'mahogany', 'varnish', stain='#4a2a18', age=1.2)}
    if style == 'tile':
        return {'skirting': S.marble_mat('tile_trim_skirt', W, FH), 'dado': kitlib.wood('tile_trim_dado', 'mahogany', 'varnish', stain='#3e2214', age=1.1),
                'cornice': S.distemper_mat('tile_trim_cornice', W, FH, col='#d0c8b2', wv=False, holes=False),
                'pictureRail': kitlib.wood('tile_trim_picture', 'mahogany', 'varnish', stain='#3e2214', age=1.1)}
    if style == 'concrete':
        return {'skirting': S.concrete_mat('concrete_trim_curb', W, FH), 'pictureRail': kitlib.wood('concrete_trim_picture', 'pine', 'bare', age=1.4)}
    if style == 'attic':
        return {'skirting': kitlib.wood('attic_trim_skirt', 'pine', 'bare', age=1.5), 'pictureRail': kitlib.wood('attic_trim_picture', 'pine', 'bare', age=1.5)}
    return {'skirting': S.paint_mat('workshop_trim_skirt', W, FH, '#3a4839', '#6b4a33', '#7a5238', '#9c774c', wv=False, chips=1.5, scuff=0.3, age=1.4, up=2),
            'dado': S.paint_mat('workshop_trim_dado', W, FH, '#3d4b3c', '#6b4a33', '#7a5238', '#9c774c', wv=False, chips=1.5, age=1.4, up=2),
            'cornice': S.paint_mat('workshop_trim_cornice', W, FH, '#cec7b4', '#8a7c66', '#7a6650', '#8e7356', wv=False, chips=1.2, gloss=0.75, age=1.8, up=2),
            'pictureRail': S.paint_mat('workshop_trim_picture', W, FH, '#3d4b3c', '#6b4a33', '#7a5238', '#9c774c', wv=False, chips=1.2, age=1.3, up=2)}

def anchor(style, kind):
    return 0.0 if kind == 'skirting' else (CEIL if kind == 'cornice' else rail_y(style, kind))

def attrs_for(kind):
    rnd = random.random(); off = (random.uniform(-9, 9), random.uniform(-9, 9), random.uniform(-9, 9))
    return {'gpos': (lambda c, o=off: (c.y + o[0], c.z + o[1], c.x + o[2])), 'prand': rnd, 'wear': (0.25 if kind in ('skirting', 'dado') else 0.05),
            'dark': 1.0, 'crack': 0.0, 'lpos': (0.0, 0.0, 0.0), 'qs': 0.0}

# ================================================================ the bake onto the trims' own UVs
def bake(style, objs, context, px=2048, py=256):
    sc = bpy.context.scene; px, py = kitlib.res(px), kitlib.res(py); pxo = int(round(px * (W + OVER) / W)); spp_ao, spp = kitlib.spp(256), kitlib.spp(16)
    d = os.path.join(kitlib.TMP, 'trims', style); os.makedirs(d, exist_ok=True); times = {}; t0 = time.time()
    for o in sc.objects: o.hide_render = o not in objs and o not in context
    ob = kitlib.join(objs, f'{style}_trims'); kitlib.select([ob], ob)
    b = sc.render.bake; b.use_selected_to_active = False; b.use_clear = True; b.margin = 6; b.margin_type = 'EXTEND'
    def img(k):
        im = bpy.data.images.new(f'{style}_trim_{k}', pxo, py, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'; return im
    def target(im):
        for sl in ob.material_slots:
            nt = sl.material.node_tree; n = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage'); n.name = 'BAKE'; n.image = im; nt.nodes.active = n
    def run(kind, k, n, **kw):
        im = img(k); target(im); sc.cycles.samples = n; t = time.time(); bpy.ops.object.bake(type=kind, **kw); times[k] = round(time.time() - t, 1)
        p = os.path.join(d, k + '.exr'); kitlib.save_exr(im, p); return p
    def dn(p): q = p.replace('.exr', '_dn.exr'); kitlib.denoise_image(p, q); return q
    keep = [sl.material for sl in ob.material_slots]
    plain = bpy.data.materials.get('kit_ao') or kitlib.Mat('kit_ao').out((0.8, 0.8, 0.8), 0.5)
    for sl in ob.material_slots: sl.material = plain
    sc.world.light_settings.distance = 0.02; p_cav = dn(run('AO', 'cav', max(32, spp_ao // 2)))
    sc.world.light_settings.distance = 0.12; p_ao = dn(run('AO', 'ao', spp_ao))
    em = bpy.data.materials.get('trim_edge')
    if not em:
        e = kitlib.Mat('trim_edge'); a = e.n('ShaderNodeAmbientOcclusion', inside=True, only_local=True, samples=16, i_Distance=0.004)
        emi = e.n('ShaderNodeEmission'); e.l(e.remap(e.math('SUBTRACT', 1.0, a.outputs['AO']), 0.10, 0.45, smooth=True), emi.inputs['Color'])
        e.l(emi.outputs[0], e.out_node.inputs['Surface']); em = e.m
    for sl in ob.material_slots: sl.material = em
    p_edge = dn(run('EMIT', 'edge', max(16, spp_ao // 4)))
    for sl, m in zip(ob.material_slots, keep): sl.material = m
    for key, p in (('CAV', p_cav), ('EDGE', p_edge)):
        im = bpy.data.images.load(p, check_existing=False); im.colorspace_settings.name = 'Non-Color'
        for m in keep:
            n = m.node_tree.nodes.get(key)
            if n: n.image = im
    p_n = run('NORMAL', 'normal', spp, normal_space='TANGENT'); p_r = run('ROUGHNESS', 'rough', spp)
    b.use_pass_direct = b.use_pass_indirect = False; b.use_pass_color = True; um = S.no_metal(keep); p_c = run('DIFFUSE', 'col', spp); um()
    def L(p):
        # the strip baked over W + OVER: its overrun (x past W) blended into its start, so the sheet tiles: at u = 0 it is
        # exactly what follows u = 1, and by OVER metres in it is the strip itself again
        a = kitlib.load_exr(p); n = a.shape[1] - px
        if n <= 0: return a[:, :px]
        out = a[:, :px].copy(); t = (np.arange(n, dtype=np.float32) / n)[None, :, None]
        t = t * t * (3 - 2 * t); out[:, :n] = a[:, px:px + n] * (1 - t) + a[:, :n] * t
        return out
    cav = np.clip(L(p_cav)[..., 0], 0, 1); col = L(p_c)[..., :3] * (0.6 + 0.4 * cav[..., None])
    orh = np.stack([np.clip(L(p_ao)[..., 0], 0, 1), np.clip(L(p_r)[..., 0], 0, 1), np.ones_like(cav)], -1)
    base = os.path.join(S.OUT, style, 'trim_')
    S.write(col, base + 'color.hi.webp', 'color'); S.write(L(p_n)[..., :3], base + 'normal.hi.webp', 'normal'); S.write(orh, base + 'orh.hi.webp', 'data')
    sm = S.seam(kitlib.to_srgb(col))
    for im in list(bpy.data.images):
        if im.name.startswith(f'{style}_trim_') or im.filepath.startswith(d): bpy.data.images.remove(im)
    import shutil; shutil.rmtree(d, ignore_errors=True)
    times['total'] = round(time.time() - t0, 1); return {'times': times, 'px': (px, py), 'seam': sm}

# ================================================================ the check: a corner of the room with its mouldings
def trim_mat(name, style):
    f = lambda k: os.path.join(S.OUT, style, f'trim_{k}.hi.webp')
    m = kitlib.Mat(name); uv = m.n('ShaderNodeTexCoord').outputs['UV']
    c = S.tex_node(m, f('color'), True, uv); n = S.tex_node(m, f('normal'), False, uv); o = S.tex_node(m, f('orh'), False, uv)
    nm = m.n('ShaderNodeNormalMap'); m.l(n.outputs['Color'], nm.inputs['Color']); s = m.n('ShaderNodeSeparateColor'); m.l(o.outputs['Color'], s.inputs[0])
    return m.out(c.outputs['Color'], s.outputs[1], nm.outputs['Normal'])

def sheet(style, P):
    sc = kitlib.reset(); man = S.manifest_load()['styles'].get(style, {}); d = os.path.join(kitlib.TMP, 'sheets', 'surf'); os.makedirs(d, exist_ok=True)
    H = FH; wall, floor = man.get('wall'), man.get('floor')
    wA = S.ship_mat('wallA', wall, 0) if wall else S.flatmat('w', (0.5, 0.45, 0.4)); fA = S.ship_mat('floorA', floor, 0) if floor else S.flatmat('f', (0.2, 0.15, 0.1))
    for i in range(3): S.quad(f'back{i}', (i * W, 2 * W, 0), (W, 0, 0), (0, 0, H), mat=wA)
    for j in range(2): S.quad(f'left{j}', (0, (j + 1) * W, 0), (0, -W, 0), (0, 0, H), mat=wA)
    for i in range(3):
        for j in range(2): S.quad(f'fl{i}{j}', (i * W, j * W, 0), (W, 0, 0), (0, W, 0), mat=fA)
    S.quad('ceil', (0, 0, H), (0, 2 * W, 0), (3 * W, 0, 0), mat=S.flatmat('ceilm', (0.6, 0.58, 0.54), 0.9))
    TM = trim_mat('trimsheet', style)
    for k, pts in P.items():
        if pts is None or k == 'pictureRail': continue                       # (the picture rail runs only on walls above 3 m)
        an = H if k == 'cornice' else anchor(style, k)
        for name in ('back', 'left'):
            bm = sweep_profile(pts, k, an, 0.0, 3 * W if name == 'back' else 2 * W, 12)
            if name == 'left':                                       # (onto the left wall: x out of it, along it from y = 2W down; a mirror)
                for v in bm.verts: v.co = Vector((-v.co.y, 2 * W - v.co.x, v.co.z))
                bmesh.ops.reverse_faces(bm, faces=bm.faces)
            else: bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 2 * W, 0))
            me = bpy.data.meshes.new(f'{k}_{name}'); bm.to_mesh(me); bm.free(); o = kitlib.link(bpy.data.objects.new(f'{k}_{name}', me)); me.materials.append(TM)
            me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(40))
    sky = sc.world; sky.use_nodes = True; bg = sky.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.5, 0.56, 0.66, 1); bg.inputs['Strength'].default_value = 0.05
    win = S.lamp('window', 'AREA', 700, loc=(3 * W - 0.05, 1.0, 1.6), rot=(0, math.radians(-90), 0), size=1.2, color=(0.88, 0.93, 1.0)); win.data.shape = 'RECTANGLE'; win.data.size = 1.3; win.data.size_y = 1.6
    S.lamp('lamp', 'POINT', 60, loc=(1.1, 2 * W - 0.6, 1.7), size=0.08, color=(1.0, 0.72, 0.45))
    S.cam_at((2.2, 0.9, 1.4), (0.3, 2 * W - 0.3, 0.9), 24); out = []
    out.append(S.render(os.path.join(d, f'{style}_trim_room.png'), 1350, 900, 256))
    S.cam_at((0.9, 2 * W - 1.0, 0.5), (0.05, 2 * W - 0.05, 0.25), 35); out.append(S.render(os.path.join(d, f'{style}_trim_skirting.png'), 1350, 900, 256))
    if P.get('cornice'): S.cam_at((1.0, 2 * W - 1.2, 2.3), (0.05, 2 * W - 0.05, H - 0.1), 35); out.append(S.render(os.path.join(d, f'{style}_trim_cornice.png'), 1350, 900, 256))
    print('sheets', out, flush=True)

# ================================================================ main
def build(style):
    t0 = time.time(); kitlib.reset(); random.seed(f'trims:{style}')
    P = profiles(style); prof_path = write_profiles(style, P); M = materials(style)
    objs, ctx = [], []
    for k, pts in P.items():
        if pts is None: continue
        an = anchor(style, k)
        objs.append(to_object(f'{k}_bake', sweep_profile(pts, k, an, 0.0, W + OVER, 28, W + OVER), M[k], attrs_for(k)))
        for (a, b) in ((-0.8, 0.0), (W + OVER, W + OVER + 0.8)): ctx.append(to_object(f'{k}_ext', sweep_profile(pts, k, an, a, b, 8), M[k], attrs_for(k)))
    for o in objs + ctx:                                              # (kitlib's woods want these)
        if 'curv' not in o.data.attributes: kitlib.attr(o, 'curv', [0.0] * len(o.data.vertices))
    flat = S.flatmat('trim_room', (0.3, 0.28, 0.25), 0.9)
    ctx.append(S.quad('wallp', (-1.0, 0.0005, -0.1), (W + 2.0, 0, 0), (0, 0, CEIL + 0.2), mat=flat))      # (faces -y)
    ctx.append(S.quad('floorp', (-1.0, -1.0, 0.0), (W + 2.0, 0, 0), (0, 1.0005, 0), mat=flat))
    ctx.append(S.quad('ceilp', (-1.0, 0.0005, CEIL), (W + 2.0, 0, 0), (0, -1.0, 0), mat=flat))
    r = bake(style, objs, ctx)
    S.manifest_put(style, 'trim', {'files': {k: f'{style}/trim_{k}' for k in ('color', 'normal', 'orh')}, 'px': {t: [r['px'][0] // dv, r['px'][1] // dv] for t, dv in kitlib.TIERS.items()},
                                   'bands': BANDS, 'profiles': f'textures/arch/{style}.profiles.json', 'tiles': 'u', 'seam': {'color': r['seam']}, 'bake_s': r['times'],
                                   'notes': 'u = metres along / 2.25, v = arc length along each profile inside its band; orh B unused (1)', 'preview': OPTS.preview})
    print(f'{style} trims: {time.time() - t0:.0f}s ' + json.dumps(r['times']) + ' seam ' + json.dumps(r['seam']), flush=True)
    if '--sheets' in sys.argv: sheet(style, P)

if __name__ == '__main__':
    only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else defs.KIT['styles']
    for st in only: build(st)
