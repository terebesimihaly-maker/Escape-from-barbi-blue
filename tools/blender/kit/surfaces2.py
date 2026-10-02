# Escape from Barbi Blue: the house's surface sets (build spec B9, WP2.1), baked in Cycles from real geometry: for each style a
# floor (colour A clean, colour B worn), a wall (A and B side by side in one colour atlas, one shared relief), the upper band
# (above 3.0 m), the ceiling, the servants' wall, the trim sheet (the mouldings js/arch.js sweeps) and, where the style has them,
# beams; plus the three detail tiles every floor shares.
# Each set is a small piece of the real thing: boards with eased edges, cupped and gapped, tiles in grout, bricks in mortar,
# panelling, plaster, built as one mesh (selected-to-active bakes cost twenty times more per extra object) that wraps round
# the tile's edges, with procedural materials whose every noise is periodic over the tile (4D noise on a torus) or belongs to
# one element (its copies across the seam carry the same attributes), so every map tiles without a seam. It is baked onto a
# flat square: cavity (AO 3 cm), edges, AO, then the materials read those back (grime packs into the real crevices, wear
# finds the real edges), then the tangent normal map, the height, roughness and colour (once per variant).
# Writes textures/surf/<style>/<set>_<map>.<tier>.webp (tiers hi, md half, lo quarter): colour (sRGB, x cavity grime),
# normal (tangent, OpenGL), orh (R AO, G roughness, B height: white = top, black = pom metres below it) and
# textures/surf/manifest.json (files, sizes, texel density, pom depth, the heights baked into the walls, bake times).
# UV conventions (js/arch.js, js/matlib.js): floors and ceilings one texture per 2.25 m tile; walls u across the 2.25 m face,
# v = y / 3 (the floor at the bottom), colour A on the left half, B on the right, normal and orh repeat (2, 1); upper band and
# service walls u, v = y / 3, tiling both ways; trims u = metres along / 2.25, v = arc length along the profile inside its band
# (skirting 0-0.4, dado 0.4-0.55, cornice 0.55-0.85, picture rail 0.85-1); beams u = metres along / 2.25, v = once round.
#   py -3.11 tools/blender/kit/surfaces2.py [--preview] [--only wood | wood:floor,tile:wall,common] [--force] [--sheets] [--room]
#   (--sheets: a contact sheet per set: colour, a lit 3 x 3 tiling, grazing light; --room: a corner of each style's room)
import sys, os, math, json, time, random, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, Euler, noise as mnoise
import kitlib, defs
from kitlib import OPTS, TMP, lin

TW = 2.25; FH = float(defs.KIT['arch']['faceH'])               # (a tile; the main wall's height, v = y / FH)
TRIMS = defs.KIT['arch']['trims']
OUT = os.path.join(defs.REPO, 'textures', 'surf'); WORK = os.path.join(TMP, 'surf')
STYLES = list(defs.KIT['styles'])
os.makedirs(WORK, exist_ok=True)

def arg(k, d=None):
    a = sys.argv[1:]
    return a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else d

def wanted(style, kind):
    o = arg('--only')
    if not o: return True
    for w in o.split(','):
        s, _, k = w.partition(':')
        if s == style and (not k or k == kind): return True
    return False

# ================================================================ geometry: one mesh, element by element, wrapped
class Geo:
    """a sample's geometry in the flat frame (x across the tile 0..W, y up it 0..H, z out of the surface toward the viewer),
       built from small bmeshes into one mesh. An element crossing an edge gets copies on the other side (wu, wv: the axes that
       tile) carrying the same attribute values, so its texture continues exactly across the seam."""
    def __init__(s, W, H, wu=True, wv=True, margin=0.34):
        s.W, s.H, s.wu, s.wv, s.margin = W, H, wu, wv, margin
        s.V = []; s.F = []; s.FM = []; s.FS = []; s.mats = []; s.A = {}; s.kind = {}
    def add(s, bm, mat, attrs=None, smooth=False, wrap=True):
        bm.verts.index_update(); co = [v.co.copy() for v in bm.verts]; faces = [[v.index for v in f.verts] for f in bm.faces]
        fs = [bool(smooth)] * len(faces); bm.free()
        if not co: return
        x0, x1 = min(c.x for c in co), max(c.x for c in co); y0, y1 = min(c.y for c in co), max(c.y for c in co)
        shifts = [(0.0, 0.0)]
        if wrap:
            for dx in ((-s.W, 0.0, s.W) if s.wu else (0.0,)):
                for dy in ((-s.H, 0.0, s.H) if s.wv else (0.0,)):
                    if dx == 0 and dy == 0: continue
                    if x1 + dx < -s.margin or x0 + dx > s.W + s.margin or y1 + dy < -s.margin or y0 + dy > s.H + s.margin: continue
                    shifts.append((dx, dy))
        vals = {}
        for k, v in (attrs or {}).items():
            vals[k] = [tuple(v(c)) if s._vec(k, v(co[0])) else float(v(c)) for c in co] if callable(v) else \
                      [tuple(v) if s._vec(k, v) else float(v)] * len(co)
        if mat not in s.mats: s.mats.append(mat)
        mi = s.mats.index(mat); n = len(co)
        for dx, dy in shifts:
            base = len(s.V)
            for k in s.A:                                       # (attributes this element lacks: their default)
                if k not in vals: s.A[k].extend([s.kind[k][1]] * n)
            for k, vv in vals.items():
                if k not in s.A: s.A[k] = [s.kind[k][1]] * base
                s.A[k].extend(vv)
            s.V.extend((c.x + dx, c.y + dy, c.z) for c in co)
            s.F.extend([i + base for i in f] for f in faces); s.FM.extend([mi] * len(faces)); s.FS.extend(fs)
    def _vec(s, k, v):
        if k not in s.kind:
            isv = isinstance(v, (tuple, list, Vector)); s.kind[k] = (isv, (0.0, 0.0, 0.0) if isv else 0.0)
        return s.kind[k][0]
    def build(s, name, sharp=40):
        me = bpy.data.meshes.new(name); me.from_pydata(s.V, [], s.F)
        for m in s.mats: me.materials.append(m)
        me.polygons.foreach_set('material_index', s.FM); me.polygons.foreach_set('use_smooth', s.FS)
        for k, vv in s.A.items():
            isv = s.kind[k][0]; a = me.attributes.new(k, 'FLOAT_VECTOR' if isv else 'FLOAT', 'POINT')
            a.data.foreach_set('vector' if isv else 'value', [c for v in vv for c in v] if isv else vv)
        if any(s.FS):                                       # (it turns every face smooth: flat ones stay flat after)
            me.set_sharp_from_angle(angle=math.radians(sharp)); me.polygons.foreach_set('use_smooth', s.FS)
        me.update()
        ob = kitlib.link(bpy.data.objects.new(name, me))
        print(f'  {name}: {len(s.V)} vertices, {len(s.F)} faces', flush=True); return ob

def box(sx, sy, sz, bevel=0.0, segs=2):
    """a box centred on the origin, its edges eased by bevel (m)"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, sx / 2.1, sy / 2.1, sz / 2.1), offset_type='OFFSET', segments=segs,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm

def cuts(bm, axis, positions):
    """slice the mesh with planes across axis (0 x, 1 y) at positions: vertices to bend"""
    no = Vector((1, 0, 0)) if axis == 0 else Vector((0, 1, 0))
    for p in positions:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=no * p, plane_no=no)
    return bm

def xform(bm, loc=(0, 0, 0), rot=(0, 0, 0)):
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4(), verts=bm.verts); return bm

def deform(bm, f):
    for v in bm.verts: v.co = Vector(f(v.co))
    return bm

def prism(poly, z0, z1):
    """a vertical prism: the polygon [(x, y)...] (anticlockwise) from z0 to z1"""
    bm = bmesh.new(); lo = [bm.verts.new((x, y, z0)) for x, y in poly]; hi = [bm.verts.new((x, y, z1)) for x, y in poly]
    bm.faces.new(hi); bm.faces.new(lo[::-1]); n = len(poly)
    for i in range(n): bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    return bm

def grid(x0, x1, y0, y1, nx, ny, z=0.0):
    """a flat grid facing +z (to displace)"""
    bm = bmesh.new(); V = [[bm.verts.new((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, z)) for i in range(nx + 1)] for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx): bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
    return bm

def pnoise(x, y, W, H, f, seed=0.0):
    """value noise periodic over W x H (python side, for geometry): f features per metre, rounded to whole periods"""
    kx = max(1, round(W * f)); ky = max(1, round(H * f)); a = 2 * math.pi * x / W; b = 2 * math.pi * y / H
    rx, ry = kx / (2 * math.pi), ky / (2 * math.pi)
    return mnoise.noise(Vector((rx * math.cos(a) + seed, rx * math.sin(a), ry * math.cos(b) + 3.1 * seed))) * 0.5 + \
           0.5 * mnoise.noise(Vector((ry * math.sin(b) + 7.7, seed * 1.3, rx * math.cos(a) - ry * math.sin(b))))

# ================================================================ materials: periodic noise, baked lookups, the finish
def sep(m, v):
    s = m.n('ShaderNodeSeparateXYZ'); m.l(v, s.inputs[0]); return s.outputs[0], s.outputs[1], s.outputs[2]

def comb(m, x, y, z):
    c = m.n('ShaderNodeCombineXYZ')
    for i, v in enumerate((x, y, z)):
        (c.inputs[i].__setattr__('default_value', v) if isinstance(v, (int, float)) else m.l(v, c.inputs[i]))
    return c.outputs[0]

class Tor:
    """the tile's point (x, y) on a torus (circles of circumference W and H), so 4D noise of it repeats exactly every W and H
       while keeping its scale in metres; wv=False (main walls: v doesn't tile) keeps y as it is"""
    def __init__(s, m, W, H, wv=True, pos=None):
        x, y, z = sep(m, pos or m.geo('Position'))
        def circ(v, P):
            a = m.math('MULTIPLY', v, 2 * math.pi / P); r = P / (2 * math.pi)
            return m.math('MULTIPLY', m.math('COSINE', a), r), m.math('MULTIPLY', m.math('SINE', a), r)
        cx, sx = circ(x, W)
        if wv: cy, sy = circ(y, H); s.v = comb(m, cx, sx, cy); s.w = sy
        else: s.v = comb(m, cx, sx, y); s.w = m.math('MULTIPLY', z, 1.0)
        s.m = m; s.x, s.y, s.z = x, y, z
    def noise(s, scale, detail=4, rough=0.55, dist=0.0, lac=2.0, off=0.0, color=False):
        m = s.m; nz = m.n('ShaderNodeTexNoise', noise_dimensions='4D', i_Scale=scale, i_Detail=detail, i_Roughness=rough, i_Distortion=dist, i_Lacunarity=lac)
        m.l(s.v, nz.inputs['Vector']); m.l(m.math('ADD', s.w, off) if off else s.w, nz.inputs['W'])
        return nz.outputs['Color' if color else 'Fac']
    def voronoi(s, scale, out='Distance', feature='F1', rand=1.0, off=0.0):
        m = s.m; v = m.n('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature, i_Scale=scale, i_Randomness=rand)
        m.l(s.v, v.inputs['Vector']); m.l(m.math('ADD', s.w, off) if off else s.w, v.inputs['W']); return v.outputs[out]

def noise3(m, vec, scale, detail=4, rough=0.55, dist=0.0, lac=2.0, color=False):
    nz = m.n('ShaderNodeTexNoise', i_Scale=scale, i_Detail=detail, i_Roughness=rough, i_Distortion=dist, i_Lacunarity=lac); m.l(vec, nz.inputs['Vector'])
    return nz.outputs['Color' if color else 'Fac']

def vmul(m, v, s):
    n = m.n('ShaderNodeVectorMath', operation='MULTIPLY'); m.l(v, n.inputs[0]); n.inputs[1].default_value = s; return n.outputs[0]
def vadd(m, a, b):
    n = m.n('ShaderNodeVectorMath', operation='ADD'); m.l(a, n.inputs[0])
    (n.inputs[1].__setattr__('default_value', b) if isinstance(b, tuple) else m.l(b, n.inputs[1])); return n.outputs[0]
def vlen(m, v):
    n = m.n('ShaderNodeVectorMath', operation='LENGTH'); m.l(v, n.inputs[0]); return n.outputs['Value']

def look(m, key, W, H):
    """the baked map key ('CAV' cavity 1 open .. 0 deep, 'EDGE' 1 on outside edges) at this point of the tile (it was baked
       looking straight down: what shows from the front is what was baked)"""
    t = m.nt.nodes.get(key)
    if t is None:
        x, y, z = sep(m, m.geo('Position'))
        t = m.n('ShaderNodeTexImage', name=key, label=key, extension='REPEAT', interpolation='Linear')
        t.image = kitlib._white() if key == 'CAV' else kitlib._flat('kit_black', 0.0); m.l(comb(m, m.math('DIVIDE', x, W), m.math('DIVIDE', y, H), 0.0), t.inputs['Vector'])
    s = m.n('ShaderNodeSeparateColor'); m.l(t.outputs['Color'], s.inputs[0]); return s.outputs[0]

def variant(m):
    """0 for colour A, 1 for B: the bake sets it (one material, two colour bakes)"""
    v = m.nt.nodes.get('VARIANT')
    if v is None: v = m.n('ShaderNodeValue', name='VARIANT', label='VARIANT'); v.outputs[0].default_value = 0.0
    return v.outputs[0]

def edge_fade(m, W, H, d0=0.12, d1=0.42, tor=None, wv=True):
    """1 inside the tile, 0 at its edges (B's damage stays off its borders, so A and B tiles meet without a seam): smooth
       from d0 to d1 metres in, the boundary ragged (periodic noise)"""
    x, y = tor.x, tor.y
    d = m.math('MINIMUM', x, m.math('SUBTRACT', W, x))
    if wv: d = m.math('MINIMUM', d, m.math('MINIMUM', y, m.math('SUBTRACT', H, y)))
    d = m.math('ADD', d, m.math('MULTIPLY', m.math('SUBTRACT', tor.noise(3.0, 3, 0.5), 0.5), (d1 - d0) * 0.9))
    return m.remap(d, d0, d1, smooth=True)

def finish(m, col, rough, h, metal=0.0, bump=1.0):
    """the material's outputs: colour, roughness, metalness and the height (m, relative to the geometry: the normal map's bump
       and the height bake both read it, so relief and parallax agree)"""
    hs = m.math('MULTIPLY', h, 1.0); hs.node.name = 'HEIGHT'
    bp = m.n('ShaderNodeBump', i_Strength=bump, i_Distance=1.0); m.l(hs, bp.inputs['Height'])
    return m.out(col, rough, bp.outputs['Normal'], metal)

def flatmat(name, col, rough=0.9, h=None):
    m = kitlib.Mat(name); return finish(m, col, rough, m.val(0.0) if h is None else h)

# ================================================================ baking
def _target(W, H):
    me = bpy.data.meshes.new('surf_target'); me.from_pydata([(0, 0, 0), (W, 0, 0), (W, H, 0), (0, H, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    for lp in me.loops: c = me.vertices[lp.vertex_index].co; uv.data[lp.index].uv = (c.x / W, c.y / H)
    ob = kitlib.link(bpy.data.objects.new('surf_target', me)); tm = kitlib.Mat('surf_target'); tm.out((1, 1, 1), 1.0); me.materials.append(tm.m)
    return ob, tm

def _swap(geo, mat):
    keep = list(geo.data.materials)
    for i in range(len(keep)): geo.data.materials[i] = mat
    return lambda: [geo.data.materials.__setitem__(i, m) for i, m in enumerate(keep)]

def _height_mats(geo, off=1.0):
    """every material's output turned into emission = z + its HEIGHT + off (a bake of where the visible surface is)"""
    undo = []
    for m in geo.data.materials:
        nt = m.node_tree; out = nt.nodes['Material Output']; old = out.inputs['Surface'].links[0].from_socket
        g = nt.nodes.new('ShaderNodeNewGeometry'); s = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(g.outputs['Position'], s.inputs[0])
        a = nt.nodes.new('ShaderNodeMath'); a.operation = 'ADD'; nt.links.new(s.outputs['Z'], a.inputs[0])
        hn = nt.nodes.get('HEIGHT')
        if hn: nt.links.new(hn.outputs[0], a.inputs[1])
        else: a.inputs[1].default_value = 0.0
        b = nt.nodes.new('ShaderNodeMath'); b.operation = 'ADD'; nt.links.new(a.outputs[0], b.inputs[0]); b.inputs[1].default_value = off
        em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(b.outputs[0], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs['Surface'])
        undo.append((nt, out, old, [g, s, a, b, em]))
    def back():
        for nt, out, old, nodes in undo:
            nt.links.new(old, out.inputs['Surface'])
            for n in nodes: nt.nodes.remove(n)
    return back

def blur_wrap(a, sigma):
    """gaussian blur (sigma in pixels) that wraps round the edges (the tile's neighbours are itself), by FFT"""
    if sigma <= 0.3: return a
    h, w = a.shape; fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)

def save_float(a, path):
    """a float array (row 0 at the top) as an EXR Blender can load"""
    h, w = a.shape[:2]; im = bpy.data.images.new('tmp_save', w, h, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
    c = a if a.ndim == 3 else np.repeat(a[..., None], 3, -1); rgba = np.concatenate([c[..., :3], np.ones((h, w, 1), np.float32)], -1)[::-1]
    im.pixels.foreach_set(rgba.astype(np.float32).ravel()); kitlib.save_exr(im, path); bpy.data.images.remove(im); return path

def bake(name, geo, W, H, px, py, variants=1, ao=0.12, cav=0.03, edge=0.004, pom=0.012, spp_ao=256, spp=16, wv=True):
    """bake geo (one mesh in the flat frame) onto the W x H tile at px x py: returns the float maps (row 0 at the top) and the
       times. Cavity and edges first (the materials read them back), then AO, normal, height, roughness, colour per variant."""
    sc = bpy.context.scene; px, py = kitlib.res(px), kitlib.res(py); spp_ao, spp = kitlib.spp(spp_ao), kitlib.spp(spp)
    sc.cycles.filter_width = 1.0                                     # (the default 1.5 px filter softens a bake)
    d = os.path.join(WORK, name); os.makedirs(d, exist_ok=True); t0 = time.time(); times = {}
    tgt, tm = _target(W, H); node = tm.n('ShaderNodeTexImage', name='BAKE')
    zs = [v.co.z for v in geo.data.vertices]; top, bot = max(zs), min(zs)
    b = sc.render.bake; b.use_selected_to_active = True; b.use_cage = False; b.cage_extrusion = top + 0.03
    b.max_ray_distance = top - bot + 0.08; b.margin = 0; b.use_clear = True
    kitlib.select([geo, tgt], tgt)
    def img(k):
        im = bpy.data.images.get(f'{name}_{k}')
        if im: bpy.data.images.remove(im)
        im = bpy.data.images.new(f'{name}_{k}', px, py, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'; return im
    def run(kind, k, n, **kw):
        im = img(k); node.image = im; tm.nt.nodes.active = node; sc.cycles.samples = n; t = time.time()
        bpy.ops.object.bake(type=kind, **kw); times[k] = round(time.time() - t, 1)
        p = os.path.join(d, k + '.exr'); kitlib.save_exr(im, p); return p
    def dn(p):
        t = time.time(); q = p.replace('.exr', '_dn.exr'); kitlib.denoise_image(p, q); times['dn_' + os.path.basename(p)[:-4]] = round(time.time() - t, 1); return q
    plain = bpy.data.materials.get('kit_ao') or kitlib.Mat('kit_ao').out((0.8, 0.8, 0.8), 0.5)
    back = _swap(geo, plain)
    sc.world.light_settings.distance = cav; p_cav = dn(run('AO', 'cav', max(32, spp_ao // 2)))
    sc.world.light_settings.distance = ao; p_ao = dn(run('AO', 'ao', spp_ao))
    back()
    # edges from the geometry's height field (an inward-looking AO node bakes 300x slower on one big mesh): where the surface
    # stands above its surroundings within a few mm (rounded outside edges, ridges), 0 on flat faces and in hollows
    em = bpy.data.materials.get('surf_z')
    if not em:
        e = kitlib.Mat('surf_z'); x, y, z = sep(e, e.geo('Position')); emi = e.n('ShaderNodeEmission'); e.l(e.math('ADD', z, 1.0), emi.inputs['Color'])
        e.l(emi.outputs[0], e.out_node.inputs['Surface']); em = e.m
    back = _swap(geo, em); p_z = run('EMIT', 'zgeo', 4); back()
    zg = kitlib.load_exr(p_z)[..., 0] - 1.0; pxm = px / W
    edg = np.clip((zg - blur_wrap(zg, edge * pxm)) / (edge * 0.35), 0, 1)
    edg = blur_wrap(edg, 0.6 * edge * pxm * 0.25)
    p_edge = os.path.join(d, 'edge.exr'); save_float(edg, p_edge)
    for key, p in (('CAV', p_cav), ('EDGE', p_edge)):
        im = bpy.data.images.load(p, check_existing=False); im.colorspace_settings.name = 'Non-Color'
        for m in geo.data.materials:
            n = m.node_tree.nodes.get(key)
            if n: n.image = im
    p_n = run('NORMAL', 'normal', spp, normal_space='TANGENT')
    back = _height_mats(geo); p_h = run('EMIT', 'height', spp); back()
    p_r = run('ROUGHNESS', 'rough', spp)
    b.use_pass_direct = b.use_pass_indirect = False; b.use_pass_color = True; cols = []
    for k in range(variants):
        for m in geo.data.materials:
            v = m.node_tree.nodes.get('VARIANT')
            if v: v.outputs[0].default_value = float(k)
        cols.append(run('DIFFUSE', 'col' + 'AB'[k], spp))
    L = kitlib.load_exr
    out = {'cav': np.clip(L(p_cav)[..., 0], 0, 1), 'ao': np.clip(L(p_ao)[..., 0], 0, 1), 'edge': L(p_edge)[..., 0],
           'normal': L(p_n)[..., :3], 'z': L(p_h)[..., 0] - 1.0, 'rough': np.clip(L(p_r)[..., 0], 0, 1), 'col': [L(c)[..., :3] for c in cols]}
    # the seam test: the same colour and normal baked a quarter metre further on; rolled back, it must match (the seam inside it)
    for k in range(variants):
        for m in geo.data.materials:
            v = m.node_tree.nodes.get('VARIANT')
            if v: v.outputs[0].default_value = 0.0
    rx = round(0.25 * px / W); ry = round(0.25 * py / H) if wv else 0                # (a quarter metre on, whole pixels: inside the wrapped copies)
    tgt.location = (rx * W / px, ry * H / py, 0)
    cs = kitlib.load_exr(run('DIFFUSE', 'col_shift', spp))[..., :3]; ns = kitlib.load_exr(run('NORMAL', 'normal_shift', spp, normal_space='TANGENT'))[..., :3]
    roll = lambda a: np.roll(np.roll(a, -rx, axis=1), ry, axis=0)
    out['seam_shift'] = {'color': round(float(np.abs(kitlib.to_srgb(roll(out['col'][0])) - kitlib.to_srgb(cs)).mean()), 4),
                         'normal': round(float(np.abs(roll(out['normal']) - ns).mean()), 4)}
    bpy.data.objects.remove(tgt); times['total'] = round(time.time() - t0, 1); out['times'] = times; out['px'] = (px, py)
    print(f'  baked {name} {px}x{py}: ' + json.dumps(times), flush=True)
    return out

def height01(z, pom, top=None):
    """the height map: white = the top of the surface (its 99.7th percentile), black = pom metres below it"""
    t = np.percentile(z, 99.7) if top is None else top
    return np.clip((z - (t - pom)) / pom, 0, 1)

def albedo(col, cav, k=0.4):
    """colour x cavity grime (B1: 0.6 + 0.4 AO at a few cm): the contact darkening shows under the flashlight too"""
    return col * ((1 - k) + k * cav[..., None])

def write(a, path, kind):
    """one map, hi tier at path (.hi.webp), md and lo beside it"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if kind == 'color': return kitlib.to_webp(a, path, 86, srgb=True)
    if kind == 'normal': return kitlib.to_webp(a, path, 92, normal=True)
    return kitlib.to_webp(a, path, 92)

def seam(a):
    """how well a map tiles: the mean difference across its wrap seam (last column to the first, last row to the first) as a
       share of the full range, next to the mean difference between neighbouring pixels inside it"""
    a = np.asarray(a, np.float32)
    if a.ndim == 2: a = a[..., None]
    du = np.abs(a[:, -1] - a[:, 0]).mean(); dv = np.abs(a[-1] - a[0]).mean()
    iu = np.abs(np.diff(a, axis=1)).mean(); iv = np.abs(np.diff(a, axis=0)).mean()
    return {'u': round(float(du), 4), 'v': round(float(dv), 4), 'inner_u': round(float(iu), 4), 'inner_v': round(float(iv), 4)}

# ================================================================ the manifest, freshness
MANIFEST = os.path.join(OUT, 'manifest.json')
def manifest_load():
    try: return json.load(open(MANIFEST))
    except (OSError, ValueError): return {'version': 1, 'L': TW, 'faceH': FH, 'tiers': {'hi': 1, 'md': 2, 'lo': 4}, 'styles': {}, 'common': {}}

def manifest_put(style, kind, entry):
    man = manifest_load(); man.setdefault('styles', {})
    if style == 'common': man.setdefault('common', {})[kind] = entry
    else: man['styles'].setdefault(style, {})[kind] = entry
    man['kit'] = defs.KIT['version']
    json.dump(man, open(MANIFEST, 'w'), indent=1, sort_keys=True)

def src_digest():
    h = hashlib.sha1()
    for p in (os.path.abspath(__file__), kitlib.__file__, defs.__file__, defs.SRC): h.update(open(p, 'rb').read())
    return h.hexdigest()
DIGEST = src_digest()

def fresh(style, kind, files):
    if OPTS.force: return False
    try: r = json.load(open(os.path.join(WORK, f'{style}_{kind}.json')))
    except (OSError, ValueError): return False
    return r.get('digest') == DIGEST and r.get('preview') == OPTS.preview and all(os.path.exists(os.path.join(OUT, f)) for f in files)

def done(style, kind, files, info):
    json.dump({'digest': DIGEST, 'preview': OPTS.preview, 'files': files, 'info': info}, open(os.path.join(WORK, f'{style}_{kind}.json'), 'w'), indent=1)

# ================================================================ shared material pieces
def lines3(m, vec, scale, width, stretch, rot=0.0):
    """thin random scratches in element space (vec 3D): the zero line of a noise squashed along one direction (rotated first:
       the Mapping node scales before it rotates, which would leave an isotropic noise unturned)"""
    v = m.map(m.map(vec, (1, 1, 1), rot=(0, 0, rot)), (1, stretch, 1)); nz = noise3(m, v, scale, 2, 0.5)
    return m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', nz, 0.5)), width, 0.0)

def strokes(m, vec, rot, spacing, length, width):
    """straight-ish strokes in a plane (vec: x, y in metres), all turned rot: about spacing m apart, length m long (before any
       masking), width m wide: the zero line of a noise stretched along the stroke"""
    v = m.map(m.map(vec, (1, 1, 1), rot=(0, 0, rot)), (1.0 / length, 1.0 / spacing, 1)); nz = noise3(m, v, 1.0, 1, 0.5)
    return m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', nz, 0.5)), 0.6 * width / spacing, 0.0)

def scratches(m, vec, density=1.0, length=60.0):
    """scratch families in several directions, faded in and out in patches; 0..1"""
    s = None
    for k, (sc, w, rot) in enumerate(((7, 0.008, 0.15), (11, 0.006, 1.7), (5, 0.010, 0.9), (17, 0.005, 2.6), (9, 0.007, -0.6))):
        l = lines3(m, vec, sc, w, length, rot)
        l = m.math('MULTIPLY', l, m.remap(noise3(m, vadd(m, vec, (k * 3.1, k * 1.7, k * 5.3)), 3.5, 2), 0.42, 0.62, 0.0, 1.0))
        s = l if s is None else m.math('MAXIMUM', s, l)
    return m.math('MULTIPLY', s, density)

# ================================================================ WOOD style
def oak_mat(name, W, H, tone='#86643f', dark='#4b321c', worn='#7f6e5c'):
    """old oak strip flooring under worn shellac and wax, built for its texel size (1.1 mm): flat-sawn boards show cathedral
       figure (the earlywood pore band dark, sharp on its leading edge, fading into the latewood) from rings of uneven yearly
       width, pore dashes and the short dark ray ticks; quartersawn ones ('qs') straight stripes and pale ray flakes. Every
       board its own tree: tone, figure contrast, a drift along its length, a pale sapwood edge on some ('sap' = +-1), a mineral
       streak on a few, end grain darkened by dirt. Then the finish: amber, patchy wax build-up, crisp scratches that whiten it
       and catch the light, dents, a few stains, dirt in the joints, a trace of dust. Variant B: a path worn through the finish
       on the boards' high edges first: pale grey bare oak, dull, its pores and scratches packed with dirt."""
    m = kitlib.Mat(name); T = Tor(m, W, H); g = m.attr('gpos', True); pr = m.attr('prand'); qs = m.attr('qs'); V = variant(m)
    bx = m.attr('bx'); bl = m.attr('bl'); bL = m.attr('bL'); sap = m.attr('sap')
    gx, gy, gz = sep(m, g); fs = m.math('SUBTRACT', 1.0, qs)
    pr2 = m.math('FRACT', m.math('MULTIPLY', pr, 7.31)); pr3 = m.math('FRACT', m.math('MULTIPLY', pr, 13.7)); pr4 = m.math('FRACT', m.math('MULTIPLY', pr, 3.17))
    def wob(sc, amp, det=3):
        return m.math('MULTIPLY', m.math('SUBTRACT', noise3(m, vmul(m, g, sc), 1.0, det, 0.5), 0.5), amp)
    # the log
    r = m.math('ADD', vlen(m, comb(m, gx, gy, 0.0)), m.math('ADD', wob((2.2, 2.2, 0.16), 0.02), m.math('ADD', wob((12, 12, 0.9), 0.006), m.math('ADD', wob((45, 45, 3), 0.0016), m.math('ADD', wob((160, 160, 9), 0.0004), wob((1.5, 1.5, 1.4), 0.008))))))
    yr = noise3(m, comb(m, m.math('MULTIPLY', r, 26.0), m.math('MULTIPLY', pr, 40.0), 0.0), 1.0, 2, 0.5)       # (good years and lean ones)
    ph = m.math('ADD', m.math('MULTIPLY', r, m.remap(pr, 0, 1, 260, 430)), m.math('MULTIPLY', m.math('SUBTRACT', yr, 0.5), 7.0))
    ring = m.math('FRACT', ph)
    tail = m.remap(noise3(m, vmul(m, g, (30, 30, 2.0)), 1.0, 2, 0.5), 0.3, 0.7, 0.14, 0.4)      # (the band's width wanders)
    fig = m.math('MULTIPLY', m.remap(ring, 0.0, 0.03, smooth=True), m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('DIVIDE', ring, tail))))
    fig = m.math('MULTIPLY', fig, m.remap(noise3(m, vmul(m, g, (55, 55, 3.5)), 1.0, 3, 0.55), 0.25, 0.65, 0.35, 1.0))   # (broken in places)
    late = m.remap(ring, 0.55, 0.98, smooth=True)
    base = lin(tone); dk = lin(dark)
    col = m.mix(m.math('ADD', m.math('MULTIPLY', fig, m.remap(pr3, 0, 1, 0.4, 0.68)), m.math('MULTIPLY', late, 0.14)), base, dk)
    # streaks along the grain, the board's tone drifting from one end to the other
    col = m.mix(m.remap(noise3(m, vmul(m, g, (38, 38, 0.45)), 1.0, 4, 0.55), 0.2, 0.8), m.hsv(col, 0.5, 0.94, 0.84), m.hsv(col, 0.5, 1.05, 1.14))
    col = m.mix(m.remap(noise3(m, vmul(m, g, (150, 150, 1.8)), 1.0, 3, 0.6), 0.3, 0.7), m.hsv(col, 0.5, 1.0, 0.92), m.hsv(col, 0.5, 1.0, 1.07))
    drift = m.math('MULTIPLY', m.math('DIVIDE', bl, m.math('MAXIMUM', bL, 0.1)), m.remap(pr4, 0, 1, -0.22, 0.22))
    col = m.hsv(col, 0.5, 1.0, m.math('ADD', 1.0, drift))
    # pores: dashes along the grain, crowded in the figure band
    po = noise3(m, vmul(m, g, (650, 650, 140)), 1.0, 2, 0.5)
    po2 = noise3(m, vmul(m, g, (1100, 1100, 220)), 1.0, 2, 0.5)
    pores = m.math('MULTIPLY', m.math('MAXIMUM', m.remap(po, 0.6, 0.68), m.math('MULTIPLY', m.remap(po2, 0.62, 0.7), 0.6)), m.math('ADD', 0.3, m.math('MULTIPLY', fig, 0.7)))
    col = m.mix(m.math('MULTIPLY', pores, 0.85), col, m.hsv(col, 0.5, 1.12, 0.34))
    # flat-sawn: the rays cut across, short dark ticks along the grain; quartersawn: the rays split open, pale silky flakes
    rt = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (800, 800, 38)), rt.inputs['Vector'])
    ticks = m.math('MULTIPLY', m.remap(rt.outputs['Distance'], 0.16, 0.04, smooth=True), m.math('MULTIPLY', fs, 0.35))
    col = m.mix(ticks, col, m.hsv(col, 0.5, 1.05, 0.6))
    ry = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (300, 300, 20)), ry.inputs['Vector'])
    rays = m.math('MULTIPLY', m.remap(ry.outputs['Distance'], 0.30, 0.10, smooth=True), m.math('MULTIPLY', qs, m.remap(noise3(m, vmul(m, g, (60, 60, 4)), 1.0, 2), 0.3, 0.6)))
    col = m.mix(m.math('MULTIPLY', rays, 0.8), col, m.hsv(col, 0.5, 0.78, 1.35))
    # every board its own tree: hue, saturation, value; a few darker, a few greyer; sapwood edges; mineral streaks
    col = m.hsv(col, m.remap(pr, 0, 1, 0.49, 0.51), m.remap(pr3, 0, 1, 0.8, 1.0), m.remap(pr2, 0, 1, 0.85, 1.1))
    col = m.mix(m.remap(pr, 0.08, 0.0, smooth=True), col, m.hsv(col, 0.495, 1.04, 0.8))   # (a few darker boards, not so dark the repeat shows)
    col = m.mix(m.remap(pr, 0.9, 1.0, smooth=True), col, m.hsv(col, 0.5, 0.68, 1.0))
    sapw = m.remap(m.math('MULTIPLY', bx, sap), 0.45, 0.85, smooth=True)
    col = m.mix(m.math('MULTIPLY', sapw, 0.8), col, m.hsv(col, 0.515, 0.78, 1.38))
    mineral = m.math('MULTIPLY', m.remap(noise3(m, vmul(m, g, (28, 28, 0.35)), 1.0, 3, 0.5), 0.62, 0.72, smooth=True), m.remap(pr3, 0.86, 0.9))
    col = m.mix(m.math('MULTIPLY', mineral, 0.7), col, m.mix(1.0, col, (0.42, 0.42, 0.4), 'MULTIPLY'))
    endd = m.math('SUBTRACT', m.math('MULTIPLY', bL, 0.5), m.math('ABSOLUTE', bl))
    col = m.mix(m.remap(endd, 0.005, 0.0, smooth=True), col, m.hsv(col, 0.5, 1.1, 0.55))   # (end grain drinks the dirt)
    # the finish: amber shellac, wax built up unevenly
    col = m.mix(1.0, col, (0.93, 0.84, 0.7), 'MULTIPLY')
    col = m.mix(m.remap(T.noise(1.1, 3, 0.5), 0.4, 0.78, 0.0, 0.3), col, m.hsv(col, 0.5, 1.08, 0.76))
    rough = m.math('ADD', m.remap(T.noise(0.7, 3), 0.3, 0.7, 0.22, 0.46), m.remap(T.noise(14, 4), 0.25, 0.75, -0.05, 0.05))
    rough = m.mixf(pores, rough, 0.55); rough = m.mixf(rays, rough, 0.2)
    h = m.math('ADD', m.math('MULTIPLY', fig, -0.00008), m.math('MULTIPLY', pores, -0.00015))
    h = m.math('ADD', h, m.math('MULTIPLY', late, 0.00002))
    # scratches: crisp, the finish whitened in them, rough (they catch the light), in the board's surface plane (along, across)
    sp = comb(m, m.math('ADD', bl, m.math('MULTIPLY', pr, 37.0)), m.math('ADD', m.math('MULTIPLY', bx, 0.065), m.math('MULTIPLY', pr, 11.0)), 0.0)
    scr = None
    for k, (rot, spc, ln, w) in enumerate(((0.06, 0.05, 0.3, 0.0011), (1.5, 0.07, 0.15, 0.0012), (0.75, 0.06, 0.2, 0.0010), (2.3, 0.09, 0.12, 0.0014),
                                            (-0.4, 0.05, 0.25, 0.0010), (0.0, 0.03, 0.6, 0.0008))):
        l = strokes(m, vadd(m, sp, (k * 1.3, k * 2.9, k * 0.7)), rot, spc, ln, w)
        seg = noise3(m, m.map(m.map(vadd(m, sp, (k * 3.1, k * 1.7, k * 5.3)), (1, 1, 1), rot=(0, 0, rot)), (4.0, 30.0, 1)), 1.0, 2)   # (cut into strokes)
        l = m.math('MULTIPLY', l, m.math('MULTIPLY', m.remap(seg, 0.5, 0.6), m.remap(noise3(m, vadd(m, sp, (k * 2.1, k * 0.7, k * 1.3)), 2.5, 2), 0.4, 0.6)))
        scr = l if scr is None else m.math('MAXIMUM', scr, l)
    scr = m.math('MULTIPLY', scr, m.remap(T.noise(1.6, 2, off=2.0), 0.35, 0.7, 0.3, 1.0))
    col = m.mix(m.math('MULTIPLY', scr, 0.38), col, m.hsv(col, 0.5, 0.65, 1.3)); rough = m.mixf(m.math('MULTIPLY', scr, 0.8), rough, 0.62)
    h = m.math('SUBTRACT', h, m.math('MULTIPLY', scr, 0.00005))
    # the haze of fine scratches every old finish has, seen only in its sheen (roughness, not colour)
    mic = None
    for k, rot in enumerate((0.05, 0.9, 1.6, 2.3, -0.4)):
        l = strokes(m, vadd(m, sp, (k * 0.9, k * 1.9, 0.3 * k)), rot, 0.008, 0.05, 0.0006)
        mic = l if mic is None else m.math('MAXIMUM', mic, l)
    mic = m.math('MULTIPLY', mic, m.remap(T.noise(2.2, 3, off=14.0), 0.3, 0.7, 0.35, 1.0))
    rough = m.mixf(m.math('MULTIPLY', mic, 0.7), rough, 0.55)
    dv = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (55, 55, 55)), dv.inputs['Vector'])
    dent = m.math('MULTIPLY', m.remap(dv.outputs['Distance'], 0.10, 0.0, smooth=True), m.remap(noise3(m, vmul(m, g, (9, 9, 9)), 1.0, 2), 0.56, 0.68))
    col = m.mix(m.math('MULTIPLY', dent, 0.35), col, m.hsv(col, 0.5, 1.08, 0.66)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', dent, 0.0004))
    wh = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (240, 240, 240)), wh.inputs['Vector'])   # (old woodworm: pin holes in clusters)
    worm = m.math('MULTIPLY', m.remap(wh.outputs['Distance'], 0.16, 0.08, smooth=True), m.math('MULTIPLY', m.remap(noise3(m, vmul(m, g, (6, 6, 2)), 1.0, 2), 0.6, 0.66), m.remap(pr2, 0.75, 0.8)))
    col = m.mix(worm, col, (0.02, 0.015, 0.01)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', worm, 0.001))
    # stains: a few dark tide-marked blots
    st = T.voronoi(2.2, 'Distance', off=4.0); stn = T.noise(14, 3, off=2.0); sel = m.remap(T.noise(0.9, 2, off=9.0), 0.6, 0.68)
    sd = m.math('ADD', st, m.math('MULTIPLY', m.math('SUBTRACT', stn, 0.5), 0.07))
    blot = m.math('MULTIPLY', m.remap(sd, 0.15, 0.10, smooth=True), sel)
    tide = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(sd, 0.10, 0.115), m.remap(sd, 0.14, 0.115)), sel)
    col = m.mix(m.math('ADD', m.math('MULTIPLY', blot, 0.3), m.math('MULTIPLY', tide, 0.5)), col, m.hsv(col, 0.5, 1.1, 0.5))
    # dirt in the joints and along the board edges, a trace of dust (the game lays its own over the floor)
    cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    gr = m.math('MULTIPLY', m.remap(cav, 0.96, 0.45, smooth=True), m.remap(T.noise(30, 4), 0.3, 0.7, 0.5, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.9), col, (0.03, 0.021, 0.013)); rough = m.mixf(gr, rough, 0.78)
    col = m.mix(m.math('MULTIPLY', edge, 0.2), col, m.hsv(col, 0.5, 0.9, 0.8))
    dust = m.remap(T.noise(1.7, 4, 0.6, off=6.0), 0.45, 0.8, 0.0, 0.12)
    col = m.mix(dust, col, (0.22, 0.195, 0.165)); rough = m.mixf(dust, rough, 0.8)
    # B: the walked path
    wear = m.math('MULTIPLY', edge_fade(m, W, H, 0.10, 0.55, T), m.remap(m.math('ADD', T.noise(0.9, 3, 0.45), m.math('MULTIPLY', T.noise(9, 3), 0.12)), 0.30, 0.62, smooth=True))
    wear = m.math('MULTIPLY', m.math('MULTIPLY', wear, V), m.math('ADD', 0.75, m.math('MULTIPLY', edge, 0.6)))
    wear = m.math('MULTIPLY', wear, m.remap(pr4, 0, 1, 0.65, 1.25))                    # (soft boards wear faster)
    wn = m.math('ADD', wear, m.math('MULTIPLY', m.math('SUBTRACT', noise3(m, vmul(m, g, (90, 90, 6)), 1.0, 4, 0.6), 0.5), 0.55))
    bare = m.mix(0.35, m.hsv(col, 0.5, 0.62, 1.12), lin(worn))
    bare = m.mix(m.math('ADD', m.math('MULTIPLY', pores, 0.9), m.math('ADD', m.math('MULTIPLY', scr, 0.7), m.math('MULTIPLY', fig, 0.35))), bare, (0.075, 0.058, 0.043))
    bare = m.mix(m.remap(T.noise(5, 4, off=3.0), 0.45, 0.8, 0.0, 0.45), bare, m.hsv(bare, 0.5, 0.8, 0.66))
    thin = m.remap(wn, 0.12, 0.42, smooth=True); through = m.math('MULTIPLY', m.remap(wn, 0.42, 0.52, smooth=True), 0.92)
    col = m.mix(m.math('MULTIPLY', thin, 0.6), col, m.hsv(col, 0.5, 0.82, 1.02)); col = m.mix(through, col, bare)
    rough = m.mixf(m.math('MAXIMUM', through, m.math('MULTIPLY', thin, 0.8)), rough, 0.68)
    return finish(m, col, rough, h)

def gapdirt_mat(name, W, H, col='#2b2219'):
    """what fills old floor joints: compacted dust and grit, dark and dull"""
    m = kitlib.Mat(name); T = Tor(m, W, H); n = T.noise(160, 4); c = lin(col)
    col = m.mix(m.remap(n, 0.3, 0.7), (c[0] * 0.7, c[1] * 0.7, c[2] * 0.7), (c[0] * 1.4, c[1] * 1.35, c[2] * 1.3))
    return finish(m, col, 0.92, m.math('MULTIPLY', n, 0.0008))

def row_lengths(W, lo, hi, prev_joints, min_gap=0.14):
    """board lengths for one row adding up to exactly W, started at an offset, joints kept min_gap from the row before's"""
    for _ in range(400):
        lens = []
        while sum(lens) < W - hi: lens.append(random.uniform(lo, hi))
        rest = W - sum(lens)
        if rest < lo * 0.6: lens[-1] += rest
        elif rest > hi: lens += [rest / 2, rest / 2]
        else: lens.append(rest)
        off = random.uniform(0, W); joints = []; x = off
        for L in lens: joints.append(x % W); x += L
        def dist(a, b): d = abs(a - b) % W; return min(d, W - d)
        if all(dist(j, p) > min_gap for j in joints for p in prev_joints) and \
           all(dist(joints[i], joints[k]) > 0.25 for i in range(len(joints)) for k in range(i)):
            return off, lens, joints
    return off, lens, joints

def board(x, y, L, w, t, gx, gy, cup=0.0004, bevel=0.0011, nx=0.07, ny=8):
    """a floorboard (top at z 0): eased edges, cupped across its width (edges standing proud), with vertices to bend"""
    Lb, wb = L - gx, w - gy
    bm = box(Lb, wb, t, bevel, 2)
    cuts(bm, 1, [-wb / 2 + wb * k / ny for k in range(1, ny)])
    k = max(2, round(Lb / nx)); cuts(bm, 0, [-Lb / 2 + Lb * i / k for i in range(1, k)])
    deform(bm, lambda c: (c.x, c.y, c.z + (cup * ((2 * c.y / wb) ** 2) - cup if c.z > 0 else 0.0)))
    return xform(bm, (x + gx / 2 + Lb / 2, y + gy / 2 + wb / 2, -t / 2))

def wood_floor():
    """the nursery's floor: 0.13 m oak strips (17 to a tile), random lengths, staggered joints, cupped, gapped, a few proud"""
    W = H = TW; n = 17; rw = H / n; t = 0.021; G = Geo(W, H)
    OAK = oak_mat('wood_floor', W, H); DIRT = gapdirt_mat('wood_gap', W, H)
    prev = []
    for r in range(n):
        off, lens, joints = row_lengths(W, 0.42, 1.65, prev); prev = joints; x = off
        for L in lens:
            gx, gy = random.uniform(0.0008, 0.003), random.choice((random.uniform(0.0012, 0.004), random.uniform(0.0012, 0.004), random.uniform(0.004, 0.0075)))
            bm = board(x, r * rw, L, rw, t, gx, gy, cup=random.uniform(0.00005, 0.0004))
            dz = random.gauss(0, 0.0002); tilt = (random.gauss(0, 0.0006), random.gauss(0, 0.0002))
            xc, yc = x + L / 2, r * rw + rw / 2
            bm = deform(bm, lambda c, xc=xc, yc=yc, dz=dz, tilt=tilt: (c.x, c.y, c.z + dz + (c.y - yc) * tilt[0] + (c.x - xc) * tilt[1]))
            qsn = 1.0 if random.random() < 0.3 else 0.0; d0 = random.uniform(0.12, 0.36) if not qsn else random.uniform(0.08, 0.3)
            o3 = (random.uniform(-0.02, 0.02), random.uniform(-90, 90)); tl = math.tan(math.radians(random.uniform(0.12, 0.9))) * random.choice((-1, 1))
            if qsn: gp = lambda c, xc=xc, yc=yc, d0=d0, o=o3, tl=tl: (d0 + (c.y - yc), c.z * 3 + (c.x - xc) * tl * 0.3, c.x - xc + o[1])
            else: gp = lambda c, xc=xc, yc=yc, d0=d0, o=o3, tl=tl: (c.y - yc + o[0], d0 + c.z + (c.x - xc) * tl, c.x - xc + o[1])
            wb = rw - gy; sp = random.choice((-1.0, 1.0)) if random.random() < 0.16 else 0.0
            G.add(bm, OAK, {'gpos': gp, 'prand': random.random(), 'qs': qsn, 'sap': sp, 'bL': L - gx,
                            'bx': (lambda c, yc=yc, wb=wb: (c.y - yc) / (wb / 2)), 'bl': (lambda c, xc=xc: c.x - xc)})
            x += L
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -0.0065), DIRT, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'sap': 0.0, 'bL': 1.0, 'bx': 0.0, 'bl': 0.0}, wrap=False)
    return {'geo': G.build('wood_floor'), 'W': W, 'H': H, 'variants': 2, 'ao': 0.1, 'cav': 0.01, 'pom': 0.006,
            'notes': '0.13 m oak strips, 17 per tile; B: a walked path worn through the wax (kept off the tile edges)'}

# ================================================================ TILE style
def ridge(m, vec, scale, detail=5, rough=0.55, power=8.0, dist=0.0):
    """a ridged noise: 1 on the noise's 0.5 contour, falling off fast: veins, cracks, networks"""
    n = noise3(m, vec, scale, detail, rough, dist)
    return m.math('POWER', m.math('SUBTRACT', 1.0, m.math('MULTIPLY', m.math('ABSOLUTE', m.math('SUBTRACT', n, 0.5)), 2.0)), power)

def hardvein(m, vec, scale, width, detail=2, rough=0.45, wvar=None):
    """a hard-edged vein along a noise's 0.5 contour, width in metres of vec: the distance to the contour is |n - 0.5| over the
       noise's gradient (two more samples), so a vein keeps its width where the noise flattens out (no blobs). wvar: 0..1 socket
       that widens and thins it along its way"""
    e = 0.04 / scale
    n0 = noise3(m, vec, scale, detail, rough); nx = noise3(m, vadd(m, vec, (e, 0.0, 0.0)), scale, detail, rough); ny = noise3(m, vadd(m, vec, (0.0, e, 0.0)), scale, detail, rough)
    gx = m.math('SUBTRACT', nx, n0); gy = m.math('SUBTRACT', ny, n0)
    gl = m.math('MAXIMUM', m.math('DIVIDE', m.math('SQRT', m.math('ADD', m.math('MULTIPLY', gx, gx), m.math('MULTIPLY', gy, gy))), e), 1e-4)
    d = m.math('DIVIDE', m.math('ABSOLUTE', m.math('SUBTRACT', n0, 0.5)), gl)
    w = width if wvar is None else m.math('MULTIPLY', m.math('ADD', 0.3, m.math('MULTIPLY', wvar, 1.4)), width)
    return m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('MAXIMUM', 0.0, m.math('DIVIDE', m.math('SUBTRACT', d, m.math('MULTIPLY', w, 0.35)), m.math('MULTIPLY', w, 0.65)))))

def fracvein(m, vec, scale, width, wvar=None, keep=0.5, seed=0.0):
    """calcite in a fracture network: the edges of Voronoi cells (straight runs meeting at angles; jagged once vec is warped),
       width in metres, only some of the edges filled (keep: the share), wvar widening and thinning them along their way"""
    v = m.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=scale, i_Randomness=1.0); m.l(vadd(m, vec, (seed, 2 * seed, 0.0)), v.inputs['Vector'])
    d = m.math('DIVIDE', v.outputs['Distance'], scale)
    w = width if wvar is None else m.math('MULTIPLY', m.math('ADD', 0.25, m.math('MULTIPLY', wvar, 1.5)), width)
    ve = m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('MAXIMUM', 0.0, m.math('DIVIDE', m.math('SUBTRACT', d, m.math('MULTIPLY', w, 0.35)), m.math('MULTIPLY', w, 0.65)))))
    k = m.remap(noise3(m, vadd(m, vec, (seed + 4.0, 1.0, 3.0)), scale * 0.6, 2), 0.5 - keep * 0.25, 0.52 - keep * 0.25)
    return m.math('MULTIPLY', ve, k)

def marble_mat(name, W, H, white='#dfdbd3', vein='#7f807f', black='#1d1c1b', calcite='#d8d3c8', grout='#7b766c', worn_w='#c9c2b6', worn_b='#4a4744'):
    """an old hall's marble checker: white Carrara (soft grey clouds and feathered veins) and black Nero Marquina (crisp white
       calcite veins in networks), every slab cut from its own part of the block ('gpos'), its veins turned its own way;
       polished once, now yellowed, the polish dulled in etch rings and spots, scratched, dirt in the micro-pits and along the
       arrises, a few slabs cracked ('crack'), corners chipped (geometry). Variant B: a path walked dull and grey."""
    m = kitlib.Mat(name); T = Tor(m, W, H); g = m.attr('gpos', True); pr = m.attr('prand'); dk = m.attr('dark'); V = variant(m)
    crk = m.attr('crack'); lp = m.attr('lpos', True)
    pr2 = m.math('FRACT', m.math('MULTIPLY', pr, 7.31)); pr3 = m.math('FRACT', m.math('MULTIPLY', pr, 13.7))
    warp = noise3(m, vmul(m, g, (1.3, 1.3, 1.3)), 1.0, 5, 0.6, color=True)
    wv = m.n('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); m.l(warp, wv.inputs[0]); wv.inputs[1].default_value = (0.35, 0.35, 0.35); m.l(g, wv.inputs[2])
    pw = wv.outputs[0]
    # --- Carrara
    cloud = noise3(m, pw, 1.6, 6, 0.6)
    v1 = ridge(m, m.map(pw, (1.0, 2.6, 1.0)), 2.2, 6, 0.6, 7.0)                 # (main veins, drawn out one way)
    v2 = ridge(m, vadd(m, pw, (3.1, 7.7, 1.3)), 6.5, 5, 0.55, 14.0)               # (fine feathering)
    v3 = ridge(m, vadd(m, pw, (9.1, 1.7, 4.3)), 18.0, 3, 0.5, 18.0)
    vk = m.remap(pr2, 0, 1, 0.55, 1.15)                                           # (some slabs heavily veined, some nearly plain)
    wcol = m.mix(m.remap(cloud, 0.3, 0.75, 0.0, 0.35), lin(white), m.mix(1.0, lin(white), (0.82, 0.83, 0.84), 'MULTIPLY'))
    wcol = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', v1, 0.85), vk), wcol, lin(vein))
    wcol = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', v2, 0.6), vk), wcol, m.mix(0.4, lin(white), lin(vein)))
    wcol = m.mix(m.math('MULTIPLY', v3, 0.3), wcol, lin(vein))
    sp = m.remap(noise3(m, vmul(m, g, (300, 300, 300)), 1.0, 2), 0.7, 0.78)          # (dark specks)
    wcol = m.mix(m.math('MULTIPLY', sp, 0.4), wcol, m.mix(1.0, lin(vein), (0.6, 0.6, 0.6), 'MULTIPLY'))
    # --- Nero Marquina: deep black, a few crisp white calcite fractures (smooth paths: little detail), finer branches near them,
    #     wide plain stretches
    mw = noise3(m, vmul(m, g, (0.9, 0.9, 0.9)), 1.0, 2, 0.5, color=True)
    pb = m.n('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); m.l(mw, pb.inputs[0]); pb.inputs[1].default_value = (0.5, 0.5, 0.5); m.l(g, pb.inputs[2]); pb = pb.outputs[0]
    wvar = noise3(m, vmul(m, g, (6, 6, 6)), 1.0, 2, 0.5)
    jw = noise3(m, vmul(m, pb, (9, 9, 9)), 1.0, 3, 0.6, color=True)                  # (a finer warp: the fractures go jagged)
    pj = m.n('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); m.l(jw, pj.inputs[0]); pj.inputs[1].default_value = (0.03, 0.03, 0.03); m.l(pb, pj.inputs[2]); pj = pj.outputs[0]
    b1 = fracvein(m, pj, 3.2, 0.0024, wvar, 0.55, 0.0)
    b1b = m.math('MULTIPLY', hardvein(m, m.map(vadd(m, pb, (5.0, 2.0, 1.0)), (1.0, 1.7, 1.0)), 1.1, 0.0016, 2, 0.45, wvar), 0.8)
    nv = m.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=3.2, i_Randomness=1.0); m.l(pj, nv.inputs['Vector'])
    near = m.remap(m.math('DIVIDE', nv.outputs['Distance'], 3.2), 0.03, 0.0, smooth=True)
    b2 = m.math('MULTIPLY', fracvein(m, pj, 11.0, 0.0009, wvar, 0.5, 7.0), near)
    b3 = m.math('MULTIPLY', fracvein(m, pj, 26.0, 0.0005, None, 0.25, 13.0), m.math('MULTIPLY', near, near))
    bmask = m.remap(noise3(m, vadd(m, g, (2.0, 0.0, 0.0)), 1.1, 2), 0.3, 0.6, 0.15, 1.0)
    bcol = m.mix(m.remap(noise3(m, pw, 2.5, 4), 0.35, 0.7, 0.0, 0.18), lin(black), m.mix(1.0, lin(black), (1.6, 1.6, 1.65), 'MULTIPLY'))
    bcol = m.mix(m.math('MULTIPLY', m.math('MAXIMUM', b1, m.math('MULTIPLY', b1b, 0.8)), bmask), bcol, lin(calcite))
    bcol = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', b2, 0.75), bmask), bcol, lin(calcite))
    bcol = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', b3, 0.5), bmask), bcol, m.mix(0.5, lin(calcite), lin(black)))
    col = m.mix(dk, wcol, bcol)
    col = m.hsv(col, 0.5, 1.0, m.remap(pr3, 0, 1, 0.95, 1.04))
    h = m.math('MULTIPLY', m.math('ADD', v2, b2), -0.00003)                    # (the softer veins polish a hair lower)
    # --- age: yellowed (the white more), dirt in the pits, cracks, etch rings and spots in the polish, scratches
    col = m.mix(m.math('MULTIPLY', m.remap(T.noise(1.2, 3, 0.5), 0.3, 0.75, 0.25, 0.7), m.math('SUBTRACT', 1.0, m.math('MULTIPLY', dk, 0.6))), col, m.mix(1.0, col, (0.93, 0.87, 0.76), 'MULTIPLY'))
    pits = m.math('MULTIPLY', m.remap(noise3(m, vmul(m, g, (700, 700, 700)), 1.0, 2), 0.68, 0.76), m.remap(T.noise(4, 3), 0.3, 0.7, 0.4, 1.0))
    col = m.mix(m.math('MULTIPLY', pits, 0.6), col, (0.09, 0.08, 0.065))
    lx, ly, lz = sep(m, lp)
    cl = ridge(m, comb(m, m.math('ADD', lx, m.math('MULTIPLY', ly, 0.4)), ly, m.math('MULTIPLY', pr, 50.0)), 4.0, 4, 0.55, 400.0)
    crack = m.math('MULTIPLY', cl, crk)
    col = m.mix(m.math('MULTIPLY', crack, 0.9), col, (0.06, 0.05, 0.04)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', crack, 0.0006))
    rough = m.remap(T.noise(0.8, 3), 0.3, 0.7, 0.1, 0.24)
    rough = m.math('ADD', rough, m.math('MULTIPLY', dk, 0.04))
    st = T.voronoi(5.0, 'Distance', off=6.0); stn = T.noise(25, 3, off=4.0)
    sd = m.math('ADD', st, m.math('MULTIPLY', m.math('SUBTRACT', stn, 0.5), 0.05))
    sel = m.remap(T.noise(1.3, 2, off=12.0), 0.5, 0.6)
    etch = m.math('MULTIPLY', m.math('MAXIMUM', m.math('MULTIPLY', m.remap(sd, 0.05, 0.065), m.remap(sd, 0.085, 0.07)), m.remap(sd, 0.035, 0.02, 0.0, 0.7)), sel)
    rough = m.mixf(etch, rough, 0.5)                                            # (rings where glasses stood, spills: dull)
    col = m.mix(m.math('MULTIPLY', etch, 0.25), col, m.mix(1.0, col, (0.85, 0.8, 0.72), 'MULTIPLY'))
    spl = m.math('ADD', T.x, T.y); spt = comb(m, T.x, T.y, 0.0)
    scr = None
    for k, (rot, spc, ln, w) in enumerate(((0.3, 0.05, 0.3, 0.0011), (1.7, 0.06, 0.18, 0.0012), (2.6, 0.08, 0.2, 0.001), (-0.7, 0.05, 0.25, 0.001))):
        l = strokes(m, vadd(m, vadd(m, g, (k * 1.3, k * 2.9, 0.0)), (0.0, 0.0, 0.0)), rot, spc, ln, w)
        seg = noise3(m, m.map(m.map(vadd(m, g, (k * 3.1, k * 1.7, 0.0)), (1, 1, 1), rot=(0, 0, rot)), (4.0, 30.0, 1)), 1.0, 2)
        l = m.math('MULTIPLY', l, m.math('MULTIPLY', m.remap(seg, 0.5, 0.6), m.remap(noise3(m, vadd(m, g, (k * 2.1, k * 0.7, 0.0)), 2.5, 2), 0.4, 0.6)))
        scr = l if scr is None else m.math('MAXIMUM', scr, l)
    mic = None
    for k, rot in enumerate((0.1, 1.0, 1.8, 2.5)):
        l = strokes(m, vadd(m, g, (k * 0.9, k * 1.9, 0.0)), rot, 0.008, 0.05, 0.0006)
        mic = l if mic is None else m.math('MAXIMUM', mic, l)
    rough = m.mixf(m.math('MULTIPLY', mic, 0.6), rough, 0.4); rough = m.mixf(m.math('MULTIPLY', scr, 0.9), rough, 0.55)
    col = m.mix(m.math('MULTIPLY', scr, m.mixf(dk, 0.12, 0.18)), col, m.mix(dk, m.hsv(col, 0.5, 1.0, 0.85), (0.2, 0.195, 0.19)))   # (scratches on black: faint, they show in the gloss)
    # dirt along the arrises and in the chips (the baked cavity), dust
    cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    gr = m.math('MULTIPLY', m.remap(cav, 0.95, 0.5, smooth=True), m.remap(T.noise(30, 4), 0.3, 0.7, 0.5, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.85), col, (0.05, 0.045, 0.035)); rough = m.mixf(gr, rough, 0.75)
    col = m.mix(m.math('MULTIPLY', edge, 0.15), col, m.mix(dk, m.hsv(col, 0.5, 1.0, 0.85), (0.2, 0.19, 0.18)))
    # B: the path, walked dull and grey, dirt ground into the white
    wear = m.math('MULTIPLY', edge_fade(m, W, H, 0.10, 0.55, T), m.remap(m.math('ADD', T.noise(0.9, 3, 0.45), m.math('MULTIPLY', T.noise(9, 3), 0.15)), 0.3, 0.62, smooth=True))
    wear = m.math('MULTIPLY', wear, V)
    worn = m.mix(dk, m.mix(0.4, m.hsv(col, 0.5, 0.65, 0.88), lin(worn_w)), m.mix(0.28, col, lin(worn_b)))   # (black etched grey, its veins still there)
    worn = m.mix(m.remap(T.noise(6, 4, off=3.0), 0.4, 0.8, 0.0, 0.5), worn, m.mix(dk, m.hsv(worn, 0.5, 0.9, 0.75), worn))
    col = m.mix(m.math('MULTIPLY', wear, 0.85), col, worn); rough = m.mixf(wear, rough, 0.5)
    return finish(m, col, rough, h)

def grout_mat(name, W, H, col='#6e685e', dirt='#2c2822'):
    """cement grout, sandy, darkened with years of dirt, cracked in places"""
    m = kitlib.Mat(name); T = Tor(m, W, H); n = T.noise(400, 3, 0.6); d = T.noise(6, 4, 0.55)
    c = m.mix(m.remap(d, 0.3, 0.7, 0.3, 0.9), lin(col), lin(dirt)); c = m.mix(m.remap(n, 0.3, 0.7, 0.0, 0.3), c, m.hsv(c, 0.5, 1.0, 1.35))
    return finish(m, c, 0.93, m.math('MULTIPLY', n, 0.0004))

def tile_floor():
    """the hall's floor: 0.28 m marble checker (8 to a tile), white Carrara and black Nero Marquina, lipped and tilted a
       little, a few corners chipped, a couple of slabs cracked, one sunk; dirty grout"""
    W = H = TW; n = 8; s = W / n; G = Geo(W, H)
    M = marble_mat('tile_floor', W, H); GR = grout_mat('tile_grout', W, H)
    for i in range(n):
        for j in range(n):
            gap = random.uniform(0.0018, 0.003); a = s - gap; t = 0.02
            bm = box(a, a, t, 0.0007, 2)
            cuts(bm, 0, [-a / 2 + a * k / 6 for k in range(1, 6)]); cuts(bm, 1, [-a / 2 + a * k / 6 for k in range(1, 6)])
            # a chipped corner now and then: a facet cut off it, below the face
            if random.random() < 0.08:
                cx, cy = random.choice((-1, 1)), random.choice((-1, 1)); r = random.uniform(0.003, 0.008)
                co = Vector((cx * a / 2, cy * a / 2, t / 2)); no = Vector((cx, cy, random.uniform(0.8, 1.6))).normalized()
                bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co - no * r * 0.8, plane_no=no, clear_outer=True)
                bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
            sunk = -0.0011 if random.random() < 0.025 else max(-0.0008, random.gauss(0, 0.0003))
            rx, ry = random.gauss(0, 0.0015), random.gauss(0, 0.0015)
            xform(bm, ((i + 0.5) * s + random.gauss(0, 0.0004), (j + 0.5) * s + random.gauss(0, 0.0004), -t / 2 + sunk), (rx, ry, random.gauss(0, 0.002)))
            ang = random.uniform(0, math.pi); off = Vector((random.uniform(-40, 40), random.uniform(-40, 40), random.uniform(-40, 40)))
            cx, cy = (i + 0.5) * s, (j + 0.5) * s; ca, sa = math.cos(ang), math.sin(ang)
            G.add(bm, M, {'gpos': (lambda c, cx=cx, cy=cy, ca=ca, sa=sa, off=off: ((c.x - cx) * ca - (c.y - cy) * sa + off.x, (c.x - cx) * sa + (c.y - cy) * ca + off.y, off.z)),
                          'lpos': (lambda c, cx=cx, cy=cy: ((c.x - cx) / s, (c.y - cy) / s, 0.0)),
                          'prand': random.random(), 'dark': float((i + j) % 2), 'crack': 1.0 if random.random() < 0.05 else 0.0})
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -0.0024), GR, {'gpos': (0, 0, 0), 'lpos': (0, 0, 0), 'prand': 0.5, 'dark': 0.0, 'crack': 0.0}, wrap=False)
    return {'geo': G.build('tile_floor'), 'W': W, 'H': H, 'variants': 2, 'ao': 0.08, 'cav': 0.01, 'pom': 0.004,
            'notes': '0.28 m marble checker (Carrara and Nero Marquina), 8 per tile; B: a path walked dull and grey'}

# ================================================================ printed patterns (drawn in Python, printed by the shader)
def _pattern_image(name, arr):
    """a float array (h, w) or (h, w, 3), row 0 at the top -> a Non-Color Blender image (repeat)"""
    h, w = arr.shape[:2]; im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
    c = arr if arr.ndim == 3 else np.repeat(arr[..., None], 3, -1)
    rgba = np.concatenate([c[..., :3], np.ones((h, w, 1), np.float32)], -1)[::-1]
    im.pixels.foreach_set(rgba.astype(np.float32).ravel()); im.pack(); return im

def damask(px=1024, seed=3):
    """a damask repeat two strips wide (half drop): a mirrored medallion of acanthus scrolls, a palmette and a vase, framed
       by an ogee of leaves, small sprigs between. Returns (motif 0..1, outline 0..1) arrays, 2 px wide per px high cell."""
    from PIL import Image, ImageDraw, ImageFilter
    rnd = random.Random(seed); S = 4; Wc, Hc = px * S, int(px * S * 0.53 / 0.5625)
    cell = Image.new('L', (Wc, Hc), 0); d = ImageDraw.Draw(cell)
    def P(x, y): return (x * Wc, y * Hc)
    def leaf(x, y, ang, L, w, curl=0.0, notch=0):
        pts = []; n = 26
        for side in (1, -1):
            for i in range(n + 1):
                t = i / n if side == 1 else 1 - i / n
                ww = w * math.sin(math.pi * t) ** 0.8 * (1 + (0.25 * math.sin(t * math.pi * (notch * 2 + 1)) if notch else 0))
                a = ang + curl * t * t
                cx = x + math.cos(ang) * L * t + math.cos(a + math.pi / 2) * ww * side * 0.5 * 0
                px_ = x + L * t * math.cos(ang + curl * t * 0.5) - side * ww * math.sin(ang + curl * t)
                py_ = y + L * t * math.sin(ang + curl * t * 0.5) + side * ww * math.cos(ang + curl * t)
                pts.append(P(px_, py_))
        d.polygon(pts, fill=255)
    def scroll(x, y, ang, r0, turns, w0, w1, sign=1):
        pts_l, pts_r = [], []; n = 120
        for i in range(n + 1):
            t = i / n; a = ang + sign * turns * 2 * math.pi * t; r = r0 * (1 - 0.82 * t)
            cx, cy = x + r * math.cos(a), y + r * math.sin(a) * (Wc / Hc)
            w = w0 + (w1 - w0) * t; nx, ny = math.cos(a), math.sin(a) * (Wc / Hc)
            pts_l.append(P(cx + nx * w, cy + ny * w)); pts_r.append(P(cx - nx * w, cy - ny * w))
        d.polygon(pts_l + pts_r[::-1], fill=255)
    # (draw the left half, mirror it)
    cx = 0.5
    # vase and stem
    d.ellipse([P(cx - 0.055, 0.70), P(cx + 0.055, 0.80)], fill=255); d.polygon([P(cx - 0.03, 0.80), P(cx + 0.03, 0.80), P(cx + 0.05, 0.86), P(cx - 0.05, 0.86)], fill=255)
    d.rectangle([P(cx - 0.008, 0.40), P(cx + 0.008, 0.72)], fill=255)
    # palmette: leaves fanned up from the stem
    for k, a in enumerate((-90, -112, -134, -156, -176)):
        L = 0.20 - k * 0.025; leaf(cx, 0.44, math.radians(a), L, 0.035 - k * 0.003, curl=-0.4 if a < -100 else 0.0)
    leaf(cx, 0.44, math.radians(-90), 0.24, 0.03)
    # acanthus scrolls from the vase outward and up
    scroll(cx - 0.17, 0.62, math.radians(10), 0.13, 0.95, 0.022, 0.006, 1)
    scroll(cx - 0.12, 0.30, math.radians(-30), 0.08, 0.8, 0.016, 0.005, -1)
    for t in np.linspace(0.1, 0.9, 6):
        a = math.radians(10) + 0.95 * 2 * math.pi * t * 0.6; r = 0.13 * (1 - 0.6 * t)
        leaf(cx - 0.17 + r * math.cos(a), 0.62 + r * math.sin(a) * (Wc / Hc), a + 1.2, 0.07 * (1 - 0.5 * t), 0.02, curl=0.8, notch=2)
    # the ogee frame: a continuous tapering vine with leaflets alternating off it, buds where the frames meet
    vine_l, vine_r = [], []
    for i in range(161):
        t = i / 160; x = cx - 0.43 * math.sin(math.pi * t) ** 0.85; y = 0.02 + 0.96 * t
        dx = -0.43 * 0.85 * math.pi * math.cos(math.pi * t) * max(1e-3, math.sin(math.pi * t)) ** -0.15 / Wc * Hc; dy = 0.96
        nl = math.hypot(dx, dy); nx, ny = -dy / nl, dx / nl; w = 0.0055 + 0.003 * math.sin(math.pi * t)
        vine_l.append(P(x + nx * w, y + ny * w * Wc / Hc)); vine_r.append(P(x - nx * w, y - ny * w * Wc / Hc))
        if i % 9 == 4 and 0.06 < t < 0.94:
            side = 1 if (i // 9) % 2 else -1; ang = math.atan2(dy, dx) + side * 1.0
            leaf(x, y, ang, 0.06 + 0.02 * math.sin(math.pi * t), 0.017, curl=-side * 0.9, notch=2)
    d.polygon(vine_l + vine_r[::-1], fill=255)
    for (x, y, r) in ((cx - 0.02, 0.03, 0.02), (cx - 0.02, 0.97, 0.02)):
        d.ellipse([P(x - r, y - r * Wc / Hc), P(x + r, y + r * Wc / Hc)], fill=255)
    # veins: dark lines cut through the palmette and the big leaves
    for k, a in enumerate((-90, -112, -134, -156)):
        L = (0.24 if k == 0 else 0.20 - (k - 1) * 0.025) * 0.85; ang = math.radians(a)
        d.line([P(cx, 0.44), P(cx + L * math.cos(ang), 0.44 + L * math.sin(ang))], fill=0, width=max(2, Wc // 700))
    d.ellipse([P(cx - 0.03, 0.73), P(cx + 0.03, 0.77)], fill=0)
    left = cell.crop((0, 0, Wc // 2, Hc)); cell.paste(left.transpose(Image.FLIP_LEFT_RIGHT), (Wc // 2, 0))
    # sprig at the corners (the half drop's medallion): small four-leaf flower
    sp = Image.new('L', (Wc, Hc), 0); ds = ImageDraw.Draw(sp)
    for a in range(4):
        ang = math.radians(45 + 90 * a); L = 0.07
        pts = [P(0.5 + math.cos(ang + s * 0.5) * L * f * 0.5 * (Hc / Wc if False else 1), 0.5 + math.sin(ang + s * 0.5) * L * f * (Wc / Hc)) for s, f in ((0, 0), (1, 1), (0, 1.6), (-1, 1))]
        ds.polygon(pts, fill=255)
    ds.ellipse([P(0.48, 0.5 - 0.02 * Wc / Hc), P(0.52, 0.5 + 0.02 * Wc / Hc)], fill=0)
    sp = sp.resize((Wc // 2, Hc // 2), Image.LANCZOS)
    for ox, oy in ((-Wc // 4, -Hc // 4), (3 * Wc // 4, -Hc // 4), (-Wc // 4, 3 * Hc // 4), (3 * Wc // 4, 3 * Hc // 4)):
        cell.paste(255, (ox, oy), sp)
    a = np.asarray(cell.resize((px, int(px * 0.53 / 0.5625)), Image.LANCZOS), np.float32) / 255
    # two strips side by side, the second dropped half a repeat
    two = np.concatenate([a, np.roll(a, a.shape[0] // 2, axis=0)], axis=1)
    from PIL import Image as I2
    blur = np.asarray(I2.fromarray((two * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(px / 400)), np.float32) / 255
    outline = np.clip(np.abs(two - blur) * 3.0, 0, 1)
    return two, outline

# ================================================================ painted wood (wainscot, skirting, frames)
def paint_mat(name, W, H, color='#d8ccb0', under='#5d6b4f', wood='#a07a4e', wv=True, chips=0.6, gloss=0.35, scuff=0.0, age=1.0, stain=0.0):
    """old oil paint over wood: brush marks along each piece (the 'gpos' attribute: z along the grain), many coats softening
       every edge, chipped on the edges and where knocked to an older green coat and then the wood, yellowed, scuffed low
       (scuff: up to that height, m), grime in the corners, dust on the ledges. Variant B (stain > 0): water-stained, more chipped."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); g = m.attr('gpos', True); pr = m.attr('prand'); V = variant(m)
    c = lin(color); cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    brush = noise3(m, vmul(m, g, (900, 900, 6)), 1.0, 3, 0.6); brush2 = noise3(m, vmul(m, g, (160, 160, 1.5)), 1.0, 3, 0.5)
    col = m.mix(m.remap(T.noise(3.0, 4, 0.55), 0.3, 0.75, 0.0, 0.35 * age), c, (c[0] * 0.9, c[1] * 0.84, c[2] * 0.66))   # (yellowed unevenly)
    col = m.mix(m.remap(brush2, 0.3, 0.7, 0.0, 0.12), col, m.hsv(col, 0.5, 1.0, 0.9))
    col = m.hsv(col, 0.5, 1.0, m.remap(pr, 0, 1, 0.96, 1.03))
    h = m.math('ADD', m.math('MULTIPLY', brush, 0.00006), m.math('MULTIPLY', brush2, 0.00004))
    alligator = T.voronoi(160, 'Distance', 'DISTANCE_TO_EDGE', off=2.0)                       # (old oil paint crazes)
    craze = m.math('MULTIPLY', m.remap(alligator, 0.03, 0.0), m.remap(T.noise(2.0, 3, off=5.0), 0.5, 0.7, 0.0, 0.8 * age))
    col = m.mix(m.math('MULTIPLY', craze, 0.5), col, m.hsv(col, 0.5, 1.1, 0.55)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', craze, 0.00008))
    # chips: on the edges and in ragged patches, to an older coat, then to the wood
    ch = m.math('ADD', m.math('MULTIPLY', edge, chips * 0.5 * (1.0 + 0.4 * stain)), m.math('MULTIPLY', m.math('SUBTRACT', T.noise(22, 5, 0.65, off=1.0), 0.5), 1.1))
    ch = m.math('ADD', ch, m.math('MULTIPLY', V, m.math('MULTIPLY', m.remap(T.noise(1.2, 3, off=8.0), 0.5, 0.75), 0.35 * stain)))
    c1 = m.remap(ch, 0.42, 0.47, smooth=True); c2 = m.remap(ch, 0.56, 0.6, smooth=True)
    col = m.mix(c1, col, m.mix(m.remap(T.noise(40, 3), 0.3, 0.7), lin(under), m.hsv(m.mix(0.0, lin(under), lin(under)), 0.5, 0.8, 1.2))); col = m.mix(c2, col, m.mix(0.4, lin(wood), (0.05, 0.035, 0.022)))
    h = m.math('SUBTRACT', h, m.math('ADD', m.math('MULTIPLY', c1, 0.00025), m.math('MULTIPLY', c2, 0.00025)))
    rough = m.remap(T.noise(12, 3), 0.3, 0.7, gloss, gloss + 0.15); rough = m.mixf(c1, rough, 0.6); rough = m.mixf(c2, rough, 0.8)
    # grime in the corners, dust on the ledges (up: +y on a wall, +z on a floor: the cavity carries both), scuffs low down
    gr = m.math('MULTIPLY', m.remap(cav, 0.85, 0.35, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.3, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.55), col, (0.09, 0.075, 0.055)); rough = m.mixf(gr, rough, 0.8)
    if scuff:
        low = m.remap(T.y, scuff, 0.0, smooth=True)
        sc = m.math('MULTIPLY', low, m.remap(T.noise(28, 3, 0.5, off=21.0), 0.66, 0.74))          # (black kick marks: periodic, as everything here)
        col = m.mix(m.math('MULTIPLY', sc, 0.6), col, (0.04, 0.035, 0.03))
        col = m.mix(m.math('MULTIPLY', low, m.remap(T.noise(4, 4, off=3.0), 0.4, 0.8, 0.0, 0.5)), col, m.hsv(col, 0.5, 0.8, 0.6))
    if stain:
        st = m.math('MULTIPLY', m.remap(T.noise(1.3, 4, 0.6, off=12.0), 0.5, 0.65, smooth=True), V)
        tide = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(T.noise(1.3, 4, 0.6, off=12.0), 0.62, 0.65), m.remap(T.noise(1.3, 4, 0.6, off=12.0), 0.68, 0.65)), V)
        col = m.mix(m.math('ADD', m.math('MULTIPLY', st, 0.35 * stain), m.math('MULTIPLY', tide, 0.6 * stain)), col, m.mix(1.0, col, (0.55, 0.42, 0.26), 'MULTIPLY'))
    return finish(m, col, rough, h)

def paper_mat(name, W, H, motif, outline, ground='#b4948c', ink='#a07c77', line='#87645f', strip=0.5625, rep=0.53, y0=0.93, wv=False):
    """wallpaper on old lime plaster: the printed pattern (the motif in a satin ink a shade darker, a fine darker outline), paper
       fibre, butt joints every strip with a hairline of plaster, the plaster's lumps showing through; faded, yellowed,
       grimy where hands go (just above the rail), foxed, dirtier at the top. Variant B: water stains running down, mould
       and the paper torn at the joints to its pale backing and the plaster (kept off the tile's edges)."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); V = variant(m)
    x, y = T.x, T.y
    uvw = comb(m, m.math('DIVIDE', x, 2 * strip), m.math('DIVIDE', m.math('SUBTRACT', y, y0), rep), 0.0)
    ti = m.n('ShaderNodeTexImage', interpolation='Cubic', extension='REPEAT'); ti.image = motif; m.l(uvw, ti.inputs['Vector'])
    to = m.n('ShaderNodeTexImage', interpolation='Cubic', extension='REPEAT'); to.image = outline; m.l(uvw, to.inputs['Vector'])
    mo = sep(m, ti.outputs['Color'])[0]; ol = sep(m, to.outputs['Color'])[0]
    misreg = m.remap(T.noise(30, 3), 0.3, 0.7, 0.85, 1.0)                                        # (the ink laid unevenly)
    col = m.mix(m.math('MULTIPLY', mo, misreg), lin(ground), lin(ink)); col = m.mix(m.math('MULTIPLY', ol, 0.35), col, lin(line))
    fib = T.noise(900, 3, 0.7); fib2 = T.noise(140, 4, 0.6)
    col = m.mix(m.remap(fib2, 0.3, 0.7, 0.0, 0.1), col, m.hsv(col, 0.5, 1.0, 0.9))
    h = m.math('ADD', m.math('MULTIPLY', mo, 0.00012), m.math('MULTIPLY', fib, 0.00004))
    lump = T.noise(6, 4, 0.5, off=4.0); h = m.math('ADD', h, m.math('MULTIPLY', lump, 0.0012))   # (the plaster under the paper)
    rough = m.mixf(mo, 0.82, 0.55)
    # butt joints every strip: a hairline, the edges lifting a little and dirtier
    fx = m.math('FRACT', m.math('DIVIDE', x, strip)); dj = m.math('MULTIPLY', m.math('MINIMUM', fx, m.math('SUBTRACT', 1.0, fx)), strip)
    joint = m.remap(dj, 0.0004, 0.0001); lift = m.math('MULTIPLY', m.remap(dj, 0.004, 0.0), m.remap(T.noise(4, 3, off=2.0), 0.45, 0.7))
    col = m.mix(m.math('MULTIPLY', lift, 0.3), col, m.hsv(col, 0.5, 1.0, 0.8)); col = m.mix(joint, col, (0.32, 0.29, 0.25))
    h = m.math('ADD', h, m.math('SUBTRACT', m.math('MULTIPLY', lift, 0.0002), m.math('MULTIPLY', joint, 0.0003)))
    # age: faded and yellowed, foxing, hand grime above the rail, soot toward the ceiling
    col = m.mix(m.remap(T.noise(1.0, 3, 0.5, off=7.0), 0.3, 0.7, 0.15, 0.45), col, m.mix(1.0, m.hsv(col, 0.5, 0.65, 1.08), (1.0, 0.93, 0.78), 'MULTIPLY'))
    fox = m.math('MULTIPLY', m.remap(T.voronoi(55, 'Distance', off=3.0), 0.09, 0.03, smooth=True), m.remap(T.noise(3, 2, off=9.0), 0.58, 0.7))
    col = m.mix(m.math('MULTIPLY', fox, 0.5), col, m.mix(1.0, col, (0.62, 0.45, 0.3), 'MULTIPLY'))
    hands = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(y, y0, y0 + 0.12, smooth=True), m.remap(y, 1.55, 1.05, smooth=True)), m.remap(T.noise(3.5, 4, off=1.0), 0.45, 0.75, 0.0, 0.55))
    col = m.mix(hands, col, m.hsv(col, 0.5, 0.7, 0.68)); rough = m.mixf(hands, rough, 0.5)
    soot = m.math('MULTIPLY', m.remap(y, 2.2, 3.0, smooth=True), m.remap(T.noise(1.5, 3, off=6.0), 0.3, 0.7, 0.2, 0.55))
    col = m.mix(soot, col, m.hsv(col, 0.5, 0.5, 0.6))
    # B: water down from above (tide-marked), mould low and high, the paper torn at the joints
    fade = edge_fade(m, W, H, 0.10, 0.28, T, wv=False)
    wn = m.math('ADD', T.noise(0.9, 3, 0.5, off=17.0), m.math('MULTIPLY', m.remap(y, 1.0, 3.0), 0.35))   # (more of it the higher up: it came through the ceiling)
    wn = m.math('ADD', wn, m.math('MULTIPLY', m.math('SUBTRACT', T.noise(9, 4, 0.6, off=3.0), 0.5), 0.06))
    run = m.math('MULTIPLY', m.remap(wn, 0.68, 0.76, smooth=True), m.math('MULTIPLY', fade, V))
    tide = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(wn, 0.66, 0.685), m.remap(wn, 0.72, 0.69)), m.math('MULTIPLY', fade, V))
    col = m.mix(m.math('MULTIPLY', run, 0.4), col, m.mix(1.0, col, (0.78, 0.64, 0.45), 'MULTIPLY')); col = m.mix(m.math('MULTIPLY', tide, 0.75), col, m.mix(1.0, col, (0.5, 0.38, 0.24), 'MULTIPLY'))
    mould = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(T.voronoi(260, 'Distance', off=5.0), 0.25, 0.05), m.remap(T.noise(2.2, 4, off=11.0), 0.55, 0.72)), m.math('MULTIPLY', fade, V))
    col = m.mix(mould, col, (0.03, 0.035, 0.025))
    tear = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(dj, 0.09, 0.0), m.remap(T.noise(3.0, 5, 0.65, off=13.0), 0.58, 0.68, smooth=True)), m.math('MULTIPLY', fade, V))
    torn = m.remap(tear, 0.45, 0.5, smooth=True); backing = m.remap(tear, 0.35, 0.45, smooth=True)
    col = m.mix(m.math('SUBTRACT', backing, torn), col, m.hsv(col, 0.5, 0.3, 1.25)); col = m.mix(torn, col, m.mix(m.remap(lump, 0.3, 0.7), lin('#b9ad98'), lin('#9c8f7b')))
    col = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', m.remap(tear, 0.5, 0.6), m.remap(tear, 0.7, 0.6)), 0.6), col, (0.06, 0.05, 0.04))   # (the shadow under the torn lip)
    h = m.math('SUBTRACT', h, m.math('MULTIPLY', torn, 0.0003)); rough = m.mixf(torn, rough, 0.9)
    return finish(m, col, rough, h)

def wainscot(G, W, paint, top=0.93, pitch=0.75, stile=0.09, base=0.28, field=(0.31, 0.79), rail=(0.80, 0.90), fz=-0.012):
    """raised panels between stiles and rails: the frame's face on the wall plane (z 0), the panels sunk behind it, their fields
       raised on bevelled margins, a rounded cap at the rail height (the moulding js/arch.js sweeps sits on it)"""
    gp = lambda c, k=0: (c.x * 0.001 + k, c.z, c.y)                   # (grain up the stiles)
    gh = lambda c, k=0: (c.y * 0.001 + k, c.z, c.x)                   # (grain along the rails)
    def add_box(sx, sy, sz, cx, cy, cz, grain, bev=0.003):
        k = random.uniform(-50, 50); G.add(xform(box(sx, sy, sz, bev, 2), (cx, cy, cz)), paint, {'gpos': (lambda c, k=k: grain(c, k)), 'prand': random.random()})
    add_box(W + 0.02, base, 0.02, W / 2, base / 2, -0.01, gh)                                      # bottom rail
    add_box(W + 0.02, rail[1] - rail[0], 0.02, W / 2, (rail[0] + rail[1]) / 2, -0.01, gh)          # top rail
    n = round(W / pitch)
    for i in range(n):
        x0 = i * pitch
        add_box(stile, rail[0] - base + 0.004, 0.02, x0, (base + rail[0]) / 2, -0.01, gp)          # stile (wraps at x = 0)
        # the panel: a field raised on bevelled margins, set back behind the frame
        a0, a1 = x0 + stile / 2 + 0.006, x0 + pitch - stile / 2 - 0.006; b0, b1 = base + 0.006, rail[0] - 0.006
        mg = 0.045; bm = bmesh.new()
        O = [bm.verts.new(v) for v in ((a0, b0, fz - 0.004), (a1, b0, fz - 0.004), (a1, b1, fz - 0.004), (a0, b1, fz - 0.004))]
        I = [bm.verts.new(v) for v in ((a0 + mg, b0 + mg, fz + 0.006), (a1 - mg, b0 + mg, fz + 0.006), (a1 - mg, b1 - mg, fz + 0.006), (a0 + mg, b1 - mg, fz + 0.006))]
        bm.faces.new(I)
        for k in range(4): bm.faces.new((O[k], O[(k + 1) % 4], I[(k + 1) % 4], I[k]))
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if all(v in I for v in e.verts)], offset=0.004, segments=2, affect='EDGES')
        k = random.uniform(-50, 50); G.add(bm, paint, {'gpos': (lambda c, k=k: gp(c, k)), 'prand': random.random()})
        # the sticking: a small ovolo where frame meets panel (a bevelled strip round the opening)
        for (sx, sy, cx, cy) in ((a1 - a0, 0.012, (a0 + a1) / 2, b0 + 0.004), (a1 - a0, 0.012, (a0 + a1) / 2, b1 - 0.004),
                                 (0.012, b1 - b0, a0 + 0.004, (b0 + b1) / 2), (0.012, b1 - b0, a1 - 0.004, (b0 + b1) / 2)):
            add_box(sx, sy, 0.012, cx, cy, -0.006, gh if sx > sy else gp, bev=0.005)
    # the cap: a rounded rail at the rail height, standing 12 mm proud
    bm = box(W + 0.02, 0.05, 0.024, 0.011, 4); k = random.uniform(-50, 50)
    G.add(xform(bm, (W / 2, top, 0.0)), paint, {'gpos': (lambda c, k=k: gh(c, k)), 'prand': random.random()})
    # the plaster behind everything (in the joints)
    G.add(grid(-0.4, W + 0.4, -0.1, top + 0.1, 2, 2, -0.02), flatmat('wainscot_back', (0.03, 0.025, 0.02), 0.9), {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False)

def wood_wall():
    """the nursery's wall: dusty-rose damask paper over a painted raised-panel wainscot, the cap at 0.93 m (B5's dado)"""
    W, H = TW, FH; top = float(TRIMS['wood']['dado']); G = Geo(W, H, wv=False)
    mo, ol = damask(1024); MI, OI = _pattern_image('damask_motif', mo), _pattern_image('damask_outline', ol)
    PAPER = paper_mat('wood_paper', W, H, MI, OI, y0=top)
    PAINT = paint_mat('wood_wainscot', W, H, '#d6cbb2', '#5f6d52', '#9c774c', wv=False, chips=0.55, scuff=0.45, stain=1.0)
    G.add(grid(-0.4, W + 0.4, top, H + 0.3, 8, 8, 0.0), PAPER, {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False)
    wainscot(G, W, PAINT, top)
    return {'geo': G.build('wood_wall'), 'W': W, 'H': H, 'variants': 2, 'wv': False, 'ao': 0.12, 'cav': 0.012, 'pom': 0.03,
            'heights': {'dado': top, 'skirting': TRIMS['wood']['skirting']['h'], 'panels': [0.31, 0.79], 'paper_from': top},
            'notes': 'damask paper over raised-panel wainscot, cap rail baked at the dado height; B: stained, mould, paper torn at joints'}

# ================================================================ running a set
SIZES = {'floor': (2048, 2048), 'wall': (2048, 2731), 'upper': (1024, 1365), 'ceil': (1024, 1024), 'service': (1024, 1365),
         'trim': (2048, 256), 'beam': (2048, 512), 'ibeam': (2048, 512)}
MAPS = {'floor': ('colorA', 'colorB', 'normal', 'orh'), 'wall': ('color', 'normal', 'orh')}

def files_of(style, kind):
    return [f'{style}/{kind}_{k}.{t}.webp' for k in MAPS.get(kind, ('color', 'normal', 'orh')) for t in ('hi', 'md', 'lo')]

def run_set(style, kind, fn):
    """build, bake and write one set; skipped when its files exist and were made from these very sources"""
    files = files_of(style, kind)
    if fresh(style, kind, files):
        print(f'{style} {kind}: up to date'); return None
    t0 = time.time(); print(f'{style} {kind}:', flush=True); kitlib.reset(); random.seed(f'{style}:{kind}')
    spec = fn(); W, H = spec['W'], spec['H']; px, py = SIZES[kind]
    if spec.get('bake'): r = spec['bake'](spec, px, py)                # (trims: baked onto their own UVs)
    else: r = bake(f'{style}_{kind}', spec['geo'], W, H, px, py, spec.get('variants', 1), spec.get('ao', 0.12), spec.get('cav', 0.03),
                   spec.get('edge', 0.004), spec.get('pom', 0.012), spec.get('spp_ao', 256), spec.get('spp', 16), spec.get('wv', True))
    pom = spec.get('pom', 0.012); h = r['h'] if 'h' in r else height01(r['z'], pom)
    orh = np.stack([r['ao'], r['rough'], h], -1); cols = [albedo(c, r['cav'], spec.get('grime', 0.4)) for c in r['col']]
    base = os.path.join(OUT, style, kind + '_')
    if kind == 'floor': write(cols[0], base + 'colorA.hi.webp', 'color'); write(cols[1], base + 'colorB.hi.webp', 'color')
    elif kind == 'wall': write(np.concatenate(cols, axis=1), base + 'color.hi.webp', 'color')
    else: write(cols[0], base + 'color.hi.webp', 'color')
    write(r['normal'], base + 'normal.hi.webp', 'normal'); write(orh, base + 'orh.hi.webp', 'data')
    sm = {'shift': r.get('seam_shift'), 'color': seam(kitlib.to_srgb(cols[0])), 'normal': seam(r['normal']), 'orh': seam(orh)}
    if len(cols) > 1:                                               # (A beside B and B beside A must meet as well as A with A)
        a, b_ = kitlib.to_srgb(cols[0]), kitlib.to_srgb(cols[1])
        sm['AB'] = round(float(np.abs(a[:, -1] - b_[:, 0]).mean()), 4); sm['BA'] = round(float(np.abs(b_[:, -1] - a[:, 0]).mean()), 4)
        if kind == 'floor': sm['AB_v'] = round(float(np.abs(a[-1] - b_[0]).mean()), 4)
    cw = r['px'][0] * (2 if kind == 'wall' else 1)
    entry = {'files': {k: f'{style}/{kind}_{k}' for k in MAPS.get(kind, ('color', 'normal', 'orh'))}, 'size_m': [W, H],
             'px': {t: [cw // dv, r['px'][1] // dv] for t, dv in kitlib.TIERS.items()}, 'px_per_m': round(r['px'][0] / W),
             'pom': pom, 'ao_m': spec.get('ao', 0.12), 'variants': spec.get('variants', 1),
             'tiles': spec.get('tiles', 'u' if kind in ('wall', 'trim') else 'uv'),
             'notes': spec.get('notes', ''), 'seam': sm, 'bake_s': r['times'], 'preview': OPTS.preview}
    if kind == 'wall': entry['px_normal_orh'] = {t: [r['px'][0] // dv, r['px'][1] // dv] for t, dv in kitlib.TIERS.items()}
    for k in ('heights', 'bands', 'perimeter'):
        if k in spec: entry[k] = spec[k]
    manifest_put(style, kind, entry); done(style, kind, files, entry)
    print(f'{style} {kind}: done in {time.time() - t0:.0f}s, seams ' + json.dumps(sm), flush=True)
    if '--sheets' in sys.argv: sheet(style, kind, entry)
    return entry

# ================================================================ contact sheets
def tex_node(m, path, srgb, mapping=None):
    t = m.n('ShaderNodeTexImage', interpolation='Cubic', extension='REPEAT'); t.image = bpy.data.images.load(path, check_existing=True)
    t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    if mapping: m.l(mapping, t.inputs['Vector'])
    return t

def ship_mat(name, entry, variant_=0):
    """the set as the game will show it: colour, normal map, roughness from orh G (AO only darkens indirect light: left out)"""
    f = lambda k: os.path.join(OUT, entry['files'][k] + '.hi.webp')
    m = kitlib.Mat(name); uvo = m.n('ShaderNodeTexCoord').outputs['UV']
    ck = 'colorA' if 'colorA' in entry['files'] else 'color'; cm = None
    if ck == 'color' and entry.get('variants', 1) > 1: cm = m.map(uvo, (0.5, 1, 1), (0.5 * variant_, 0, 0))   # (the wall atlas: A left, B right)
    if ck == 'colorA' and variant_: ck = 'colorB'
    c = tex_node(m, f(ck), True, cm or uvo); n = tex_node(m, f('normal'), False, uvo); o = tex_node(m, f('orh'), False, uvo)
    nm = m.n('ShaderNodeNormalMap'); m.l(n.outputs['Color'], nm.inputs['Color'])
    s = m.n('ShaderNodeSeparateColor'); m.l(o.outputs['Color'], s.inputs[0])
    return m.out(c.outputs['Color'], s.outputs[1], nm.outputs['Normal'])

def quad(name, p0, ex, ey, uv0=(0, 0), uv1=(1, 1), mat=None):
    """a rectangle from p0 spanned by ex, ey (facing ex x ey), UVs uv0..uv1"""
    p0, ex, ey = Vector(p0), Vector(ex), Vector(ey); me = bpy.data.meshes.new(name)
    me.from_pydata([p0, p0 + ex, p0 + ex + ey, p0 + ey], [], [(0, 1, 2, 3)]); uv = me.uv_layers.new(name='UVMap')
    for lp, (a, b) in zip(me.loops, ((uv0[0], uv0[1]), (uv1[0], uv0[1]), (uv1[0], uv1[1]), (uv0[0], uv1[1]))): uv.data[lp.index].uv = (a, b)
    ob = kitlib.link(bpy.data.objects.new(name, me))
    if mat: me.materials.append(mat)
    return ob

def cam_at(loc, target, lens=35):
    cam = bpy.data.objects.get('sheet_cam') or kitlib.link(bpy.data.objects.new('sheet_cam', bpy.data.cameras.new('sheet_cam')))
    cam.data.lens = lens; cam.location = Vector(loc); cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam; return cam

def lamp(name, kind, energy, loc=None, rot=None, size=0.1, color=(1, 1, 1)):
    L = kitlib.link(bpy.data.objects.new(name, bpy.data.lights.new(name, kind))); L.data.energy = energy; L.data.color = color
    if kind == 'AREA': L.data.size = size
    elif kind in ('POINT', 'SPOT'): L.data.shadow_soft_size = size
    else: L.data.angle = size
    if loc: L.location = loc
    if rot: L.rotation_euler = rot
    return L

def render(path, w, h, samples=128):
    sc = bpy.context.scene; sc.render.resolution_x, sc.render.resolution_y = w, h; sc.render.resolution_percentage = 100
    sc.cycles.samples = samples; sc.cycles.use_denoising = True; sc.render.filepath = path
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Base Contrast'
    sc.render.image_settings.file_format = 'PNG'; bpy.ops.render.render(write_still=True); return path

def sheet(style, kind, entry):
    """flat colour, a lit 3 x 3 tiling (floors: A and B mixed; walls: A, B, A), a grazing-light close-up: one PNG"""
    from PIL import Image, ImageDraw
    t0 = time.time(); sc = kitlib.reset(); W, H = entry['size_m']; d = os.path.join(TMP, 'sheets', 'surf'); os.makedirs(d, exist_ok=True)
    tiles = []; S = 900
    ck = 'colorA' if 'colorA' in entry['files'] else 'color'
    im = Image.open(os.path.join(OUT, entry['files'][ck] + '.hi.webp')).convert('RGB')
    if ck == 'colorA':
        im2 = Image.open(os.path.join(OUT, entry['files']['colorB'] + '.hi.webp')).convert('RGB')
        both = Image.new('RGB', (im.width * 2, im.height)); both.paste(im, (0, 0)); both.paste(im2, (im.width, 0)); im = both
    im.thumbnail((S * 2, S)); tiles.append(im)
    vertical = kind in ('wall', 'upper', 'service')
    mats = [ship_mat('sA', entry, 0), ship_mat('sB', entry, 1) if entry.get('variants', 1) > 1 else None]
    pattern = [[0, 1, 0], [1, 1, 0], [0, 0, 1]] if kind == 'floor' else [[0, 1, 0]] * 3
    for j in range(3 if not (vertical and kind == 'wall') else 1):
        for i in range(3):
            vb = pattern[j][i] if mats[1] else 0
            if vertical: quad(f'q{i}{j}', (i * W, 0, j * H), (W, 0, 0), (0, 0, H), mat=mats[vb])
            else: quad(f'q{i}{j}', (i * W, j * H, 0), (W, 0, 0), (0, H, 0), mat=mats[vb])
    if vertical: quad('ground', (-2, -6, 0), (12, 0, 0), (0, 6, 0), mat=flatmat('ground', (0.05, 0.045, 0.04), 0.8))
    sky = sc.world; sky.use_nodes = True; bg = sky.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.5, 0.55, 0.62, 1); bg.inputs['Strength'].default_value = 0.35
    if vertical:
        hh = 1.5 if kind == 'wall' else 1.5 * H
        cam_at((1.5 * W, -2.2 * W if kind == 'wall' else -2.6 * W, 1.6), (1.5 * W, 0, hh), 24); lamp('sun', 'SUN', 3.0, rot=(math.radians(55), 0, math.radians(-30)), size=math.radians(2))
    else:
        cam_at((1.5 * W, -0.6 * H, 1.75), (1.5 * W, 1.6 * H, 0), 24); lamp('sun', 'SUN', 3.0, rot=(math.radians(55), 0, math.radians(35)), size=math.radians(2))
    tiles.append(Image.open(render(os.path.join(d, f'{style}_{kind}_lit.png'), int(S * 1.5), S)).convert('RGB'))
    for o in list(sc.objects):
        if o.type == 'LIGHT': bpy.data.objects.remove(o)
    bg.inputs['Strength'].default_value = 0.02
    if vertical:
        lamp('graze', 'SUN', 4.0, rot=(math.radians(90), 0, math.radians(-12)), size=math.radians(1.0))
        cam_at((1.5 * W + 0.3, -1.25, 1.5), (1.5 * W, 0, 1.15), 35)
    else:
        lamp('graze', 'SUN', 4.0, rot=(math.radians(82), 0, math.radians(70)), size=math.radians(1.0))
        cam_at((1.4 * W, 0.9 * H, 1.1), (1.5 * W, 1.5 * H, 0), 35)
    tiles.append(Image.open(render(os.path.join(d, f'{style}_{kind}_graze.png'), int(S * 1.5), S)).convert('RGB'))
    # 4. two snapshots as a photographer would take them: the room lit by a warm lamp, and against the window's light (its
    #    sheen across the surface shows the gloss, the scratches, the wear)
    def clear():
        for o in list(sc.objects):
            if o.type == 'LIGHT': bpy.data.objects.remove(o)
    clear(); bg.inputs['Color'].default_value = (0.55, 0.62, 0.75, 1); bg.inputs['Strength'].default_value = 0.12
    if vertical:
        lamp('key', 'AREA', 220, loc=(1.5 * W - 1.3, -1.6, 2.4), rot=(math.radians(55), 0, math.radians(-40)), size=1.2, color=(1.0, 0.84, 0.66))
        cam_at((1.5 * W + 0.6, -1.9, 1.6), (1.5 * W - 0.2, 0, 1.3), 28)
    else:
        lamp('key', 'AREA', 130, loc=(1.5 * W + 1.1, 1.25 * H, 2.6), rot=(math.radians(25), math.radians(20), 0), size=1.5, color=(1.0, 0.93, 0.84))
        cam_at((1.5 * W, 0.55 * H, 1.45), (1.5 * W + 0.15, 1.45 * H, 0), 30)
    tiles.append(Image.open(render(os.path.join(d, f'{style}_{kind}_photo.png'), int(S * 1.5), S, 192)).convert('RGB'))
    clear(); bg.inputs['Strength'].default_value = 0.05
    if vertical:
        lamp('window', 'AREA', 500, loc=(1.5 * W + 2.4, -0.6, 1.5), rot=(0, math.radians(-80), 0), size=1.4, color=(0.9, 0.95, 1.0))
        cam_at((1.5 * W - 1.0, -1.3, 1.5), (1.5 * W + 0.4, 0, 1.25), 30)
    else:
        win = lamp('window', 'AREA', 900, loc=(1.5 * W, 3.0 * H, 1.3), rot=(math.radians(-90), 0, 0), size=1.6, color=(0.9, 0.95, 1.0))
        win.data.shape = 'RECTANGLE'; win.data.size = 1.4; win.data.size_y = 1.9
        cam_at((1.5 * W + 0.2, 0.45 * H, 1.0), (1.5 * W, 2.0 * H, 0.0), 30)
    tiles.append(Image.open(render(os.path.join(d, f'{style}_{kind}_sheen.png'), int(S * 1.5), S, 192)).convert('RGB'))
    if not vertical:                                                  # (as close as a crouching player looks)
        clear(); bg.inputs['Strength'].default_value = 0.12
        lamp('key', 'AREA', 70, loc=(1.5 * W + 0.8, 1.4 * H, 1.8), rot=(math.radians(30), math.radians(25), 0), size=1.0, color=(1.0, 0.93, 0.84))
        cam_at((1.5 * W, 1.05 * H, 0.75), (1.5 * W + 0.05, 1.4 * H, 0), 35)
        tiles.append(Image.open(render(os.path.join(d, f'{style}_{kind}_close.png'), int(S * 1.5), S, 192)).convert('RGB'))
    Wt = sum(t.width for t in tiles); out = Image.new('RGB', (Wt, S + 30), (22, 22, 24)); x = 0
    for t in tiles: out.paste(t, (x, 30)); x += t.width
    ImageDraw.Draw(out).text((8, 8), f'{style} {kind}   {W:.2f} x {H:.2f} m   {entry["px"]["hi"]} px   pom {entry["pom"]} m   seams {json.dumps(entry["seam"].get("color"))}', fill=(230, 230, 230))
    p = os.path.join(d, f'{style}_{kind}.png'); out.save(p); print('sheet', p, f'{time.time() - t0:.0f}s', flush=True); return p

# ================================================================ main
SETS = {}
def main():
    t0 = time.time(); got = {}
    for style in STYLES + ['common']:
        for kind, fn in SETS.get(style, {}).items():
            if wanted(style, kind): got[f'{style}:{kind}'] = run_set(style, kind, fn)
    print(f'surfaces2: {len(got)} sets in {time.time() - t0:.0f}s')

if __name__ == '__main__':
    SETS['wood'] = {'floor': wood_floor, 'wall': wood_wall}
    SETS['tile'] = {'floor': tile_floor}
    main()
