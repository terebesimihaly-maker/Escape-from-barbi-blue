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
    def vwarp(s, scale, amp, freq, out='Distance', feature='F1', off=0.0):
        """Voronoi of the torus point pushed about by a periodic noise (amp metres, freq per metre): cell edges that wander"""
        m = s.m; nc = m.n('ShaderNodeTexNoise', noise_dimensions='4D', i_Scale=freq, i_Detail=3, i_Roughness=0.55); m.l(s.v, nc.inputs['Vector']); m.l(m.math('ADD', s.w, off + 3.7), nc.inputs['W'])
        dv = m.n('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); m.l(nc.outputs['Color'], dv.inputs[0]); dv.inputs[1].default_value = (amp, amp, amp); m.l(s.v, dv.inputs[2])
        v = m.n('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature, i_Scale=scale, i_Randomness=1.0)
        m.l(dv.outputs[0], v.inputs['Vector']); m.l(m.math('ADD', m.math('ADD', s.w, m.math('MULTIPLY', nc.outputs['Fac'], amp)), off), v.inputs['W']); return v.outputs[out]
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

UVLOOK = False
def look(m, key, W, H):
    """the baked map key ('CAV' cavity 1 open .. 0 deep, 'EDGE' 1 on outside edges) at this point of the tile (it was baked
       looking straight down: what shows from the front is what was baked)"""
    t = m.nt.nodes.get(key)
    if t is None:
        x, y, z = sep(m, m.geo('Position'))
        t = m.n('ShaderNodeTexImage', name=key, label=key, extension='REPEAT', interpolation='Linear')
        t.image = kitlib._white() if key == 'CAV' else kitlib._flat('kit_black', 0.0)
        if not UVLOOK: m.l(comb(m, m.math('DIVIDE', x, W), m.math('DIVIDE', y, H), 0.0), t.inputs['Vector'])   # (UVLOOK: baked onto the part's own UVs, as trims.py does)
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

def no_metal(mats):
    """metalness off for a colour bake (Cycles' diffuse colour pass is black where a surface is metal); returns the undo"""
    undo = []
    for m in mats:
        pb = m.node_tree.nodes.get('Principled BSDF') if m and m.node_tree else None
        if not pb: continue
        inp = pb.inputs['Metallic']; src = inp.links[0].from_socket if inp.is_linked else None; val = inp.default_value
        if src: m.node_tree.links.remove(inp.links[0])
        inp.default_value = 0.0; undo.append((m, inp, src, val))
    def back():
        for m, inp, src, val in undo:
            inp.default_value = val
            if src: m.node_tree.links.new(src, inp)
    return back

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
    undo_metal = no_metal(geo.data.materials)                          # (a metal has no diffuse colour: the albedo is its base colour)
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
    cs = kitlib.load_exr(run('DIFFUSE', 'col_shift', spp))[..., :3]; undo_metal()
    ns = kitlib.load_exr(run('NORMAL', 'normal_shift', spp, normal_space='TANGENT'))[..., :3]
    roll = lambda a: np.roll(np.roll(a, -rx, axis=1), ry, axis=0)
    out['seam_shift'] = {'color': round(float(np.abs(kitlib.to_srgb(roll(out['col'][0])) - kitlib.to_srgb(cs)).mean()), 4),
                         'normal': round(float(np.abs(roll(out['normal']) - ns).mean()), 4)}
    bpy.data.objects.remove(tgt); times['total'] = round(time.time() - t0, 1); out['times'] = times; out['px'] = (px, py)
    for im in list(bpy.data.images):                                   # (the float images and the EXRs behind them: ~1 GB a set)
        if im.name.startswith(name + '_') or im.filepath.startswith(d): bpy.data.images.remove(im)
    import shutil; shutil.rmtree(d, ignore_errors=True)
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

# ================================================================ CONCRETE style
def concrete_mat(name, W, H, base='#87837b', dark='#625e57', agg=('#9b958a', '#6f6a62', '#b8b2a6', '#7d6f60'), worn='#6c6861'):
    """an old cellar slab, hand trowelled: cement paste with sand in it (grains of their own tone), patchy mottling, faint
       trowel arcs and burnish, shallow pinholes, a few wandering shrinkage cracks packed with dirt and finer crazing, damp
       patches with white salt along the open cracks, water stains with tide lines, oil blots (darker, glossier), rust rings
       where tins stood, dirt in everything low. Variant B: a path where the cement skin has worn off, the fine aggregate
       showing, grime ground in, a little polished by feet."""
    m = kitlib.Mat(name); T = Tor(m, W, H); V = variant(m)
    cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    # the paste and its sand
    mott = T.noise(1.3, 5, 0.6); mott2 = T.noise(5.5, 6, 0.65); grit = T.noise(60, 4, 0.6); fine = T.noise(260, 2, 0.5)
    col = m.mix(m.remap(mott, 0.35, 0.68), lin(base), lin(dark))
    col = m.mix(m.remap(mott2, 0.42, 0.62, 0.0, 0.45), col, m.mix(1.0, col, (0.8, 0.79, 0.77), 'MULTIPLY'))
    col = m.mix(m.remap(T.noise(0.6, 3, 0.5, off=3.0), 0.35, 0.7, 0.0, 0.3), col, m.mix(1.0, col, (1.05, 1.0, 0.9), 'MULTIPLY'))   # (warm and cool batches)
    gc = T.voronoi(300, 'Color', off=71.0); gr_, gg_, gb_ = sep(m, gc); gd = T.voronoi(300, 'Distance', off=71.0)
    grain = m.math('MULTIPLY', m.remap(gd, 0.5, 0.2), m.remap(T.noise(12, 3, off=9.0), 0.3, 0.7, 0.4, 1.0))
    col = m.mix(m.math('MULTIPLY', grain, 0.5), col, m.mix(m.remap(gr_, 0.0, 1.0), m.hsv(col, 0.5, 0.85, 0.78), m.hsv(col, 0.5, 0.9, 1.25)))
    col = m.mix(m.remap(grit, 0.3, 0.7, 0.0, 0.3), col, m.hsv(col, 0.5, 1.0, 0.82))
    col = m.mix(m.remap(fine, 0.25, 0.75), m.hsv(col, 0.5, 1.0, 0.9), m.hsv(col, 0.5, 1.0, 1.1))      # (grit at two or three pixels: it survives the WebP)
    h = m.math('ADD', m.math('MULTIPLY', mott2, 0.0005), m.math('ADD', m.math('MULTIPLY', grain, 0.00015), m.math('MULTIPLY', grit, 0.0001)))
    rough = m.remap(mott2, 0.3, 0.7, 0.74, 0.9)
    # trowel arcs: sweeps of the float round random centres, burnished a little
    tv = T.vwarp(2.0, 0.05, 3.0, 'Distance', off=1.0)
    arcs = m.math('POWER', m.math('ADD', m.math('MULTIPLY', m.math('SINE', m.math('ADD', m.math('MULTIPLY', tv, 2 * math.pi * 22.0), m.math('MULTIPLY', T.noise(6, 2, off=4.0), 6.0))), 0.5), 0.5), 6.0)
    arcs = m.math('MULTIPLY', arcs, m.remap(T.noise(4, 3, off=5.0), 0.5, 0.7, 0.0, 1.0))
    rough = m.math('SUBTRACT', rough, m.math('MULTIPLY', arcs, 0.08)); col = m.mix(m.math('MULTIPLY', arcs, 0.06), col, m.hsv(col, 0.5, 1.0, 0.9))
    # pinholes: shallow, sparse, dark
    ph = T.voronoi(110, 'Distance', off=2.0); pin = m.math('MULTIPLY', m.remap(ph, 0.06, 0.025, smooth=True), m.remap(T.noise(5, 2, off=8.0), 0.45, 0.7, 0.0, 1.0))
    col = m.mix(m.math('MULTIPLY', pin, 0.75), col, m.hsv(col, 0.5, 1.0, 0.4)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', pin, 0.00025))
    # cracks: a few wandering shrinkage cracks (only some edges of a warped network open), crazing finer still
    ce = m.math('DIVIDE', T.vwarp(1.5, 0.06, 2.5, 'Distance', 'DISTANCE_TO_EDGE', off=11.0), 1.5)
    keep = m.remap(T.noise(1.0, 2, off=21.0), 0.5, 0.55)
    cw = m.math('MULTIPLY', m.remap(T.noise(8, 2, off=4.0), 0.3, 0.7, 0.3, 1.3), 0.0012)
    crack = m.math('MULTIPLY', m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('DIVIDE', ce, cw))), keep)
    spall = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(ce, 0.006, 0.0), keep), m.remap(T.noise(20, 3, off=14.0), 0.5, 0.7))
    craze = m.math('MULTIPLY', m.remap(m.math('DIVIDE', T.vwarp(22, 0.004, 30, 'Distance', 'DISTANCE_TO_EDGE', off=13.0), 22.0), 0.0006, 0.0), m.remap(T.noise(2.5, 2, off=17.0), 0.52, 0.66, 0.0, 0.6))
    col = m.mix(m.math('MULTIPLY', crack, 0.9), col, (0.04, 0.038, 0.035)); col = m.mix(m.math('MULTIPLY', craze, 0.4), col, m.hsv(col, 0.5, 1.0, 0.72))
    col = m.mix(m.math('MULTIPLY', spall, 0.5), col, m.hsv(col, 0.5, 1.0, 0.75))
    h = m.math('SUBTRACT', h, m.math('ADD', m.math('MULTIPLY', crack, 0.0015), m.math('ADD', m.math('MULTIPLY', craze, 0.0001), m.math('MULTIPLY', spall, 0.0008))))
    # damp, and salt only along the open cracks where it's damp
    dn = T.noise(0.9, 4, 0.55, off=31.0)
    damp = m.remap(dn, 0.52, 0.68, smooth=True)
    tide = m.math('MULTIPLY', m.remap(dn, 0.5, 0.52), m.remap(dn, 0.55, 0.53))
    col = m.mix(m.math('MULTIPLY', damp, 0.5), col, m.mix(1.0, col, (0.64, 0.64, 0.64), 'MULTIPLY')); rough = m.mixf(m.math('MULTIPLY', damp, 0.35), rough, 0.6)
    col = m.mix(m.math('MULTIPLY', tide, 0.5), col, m.mix(1.0, col, (0.7, 0.66, 0.6), 'MULTIPLY'))
    near = m.math('MULTIPLY', m.remap(ce, 0.012, 0.0, smooth=True), keep)
    salt = m.math('MULTIPLY', m.math('MULTIPLY', near, m.remap(T.noise(30, 4, 0.6, off=6.0), 0.5, 0.72)), m.math('ADD', 0.15, damp))
    col = m.mix(m.math('MULTIPLY', salt, 0.6), col, lin('#d6d3c9')); rough = m.mixf(salt, rough, 0.95); h = m.math('ADD', h, m.math('MULTIPLY', salt, 0.0001))
    # oil blots and rust rings
    ob = T.noise(1.1, 4, 0.6, off=41.0); oil = m.math('MULTIPLY', m.remap(ob, 0.67, 0.73, smooth=True), m.remap(T.noise(12, 3, off=2.0), 0.3, 0.7, 0.6, 1.0))
    col = m.mix(m.math('MULTIPLY', oil, 0.8), col, m.mix(1.0, col, (0.3, 0.28, 0.26), 'MULTIPLY')); rough = m.mixf(oil, rough, 0.42)
    rv = T.voronoi(3.5, 'Distance', off=51.0); rsel = m.remap(T.noise(1.0, 2, off=55.0), 0.62, 0.7)
    ring = m.math('MULTIPLY', m.remap(rv, 0.035, 0.045), m.remap(rv, 0.058, 0.048))
    rust = m.math('MULTIPLY', m.math('ADD', ring, m.math('MULTIPLY', m.remap(rv, 0.05, 0.0), 0.35)), m.remap(T.noise(40, 3, off=7.0), 0.3, 0.7, 0.4, 1.0))
    rust = m.math('MULTIPLY', rust, rsel)
    col = m.mix(m.math('MULTIPLY', rust, 0.7), col, m.mix(0.5, col, lin('#6e3c1c')))
    # dirt in everything low: the joints, the spalls (the baked cavity)
    gr = m.math('MULTIPLY', m.remap(cav, 0.93, 0.45, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.85), col, (0.045, 0.04, 0.035)); rough = m.mixf(gr, rough, 0.9)
    col = m.mix(m.math('MULTIPLY', edge, 0.2), col, m.hsv(col, 0.5, 1.0, 1.12))            # (the joint arrises knocked pale)
    # B: the cement skin worn away along the path: fine aggregate, grime, a little polish
    wear = m.math('MULTIPLY', edge_fade(m, W, H, 0.10, 0.55, T), m.remap(m.math('ADD', T.noise(0.9, 3, 0.45), m.math('MULTIPLY', T.noise(9, 3), 0.15)), 0.3, 0.62, smooth=True))
    wear = m.math('MULTIPLY', wear, V)
    # the aggregate: angular stones (Voronoi cells, a seam of paste between them) at two sizes, close to the paste in tone
    def stones(scale, off):
        ed = m.math('DIVIDE', T.vwarp(scale, 0.3 / scale, scale * 0.6, 'Distance', 'DISTANCE_TO_EDGE', off=off), scale)
        cid = T.vwarp(scale, 0.3 / scale, scale * 0.6, 'Color', 'F1', off=off); cr, cg, cb = sep(m, cid)
        face = m.remap(ed, 0.12 / scale, 0.22 / scale)                                 # (inside the stone, off the paste seam)
        tone = m.mix(m.remap(cr, 0.0, 1.0), lin(agg[0]), lin(agg[1])); tone = m.mix(m.math('MULTIPLY', m.remap(cg, 0.75, 0.9), 0.5), tone, lin(agg[2]))
        tone = m.mix(m.remap(cb, 0.7, 0.95), tone, lin(agg[3])); tone = m.mix(0.45, tone, col)
        sel = m.remap(m.math('FRACT', m.math('MULTIPLY', cr, 7.7)), 0.25, 0.3)         # (not every cell is a stone: some are paste)
        return m.math('MULTIPLY', face, sel), tone
    s1, t1 = stones(70.0, 61.0); s2, t2 = stones(190.0, 67.0)
    reveal = m.remap(m.math('ADD', m.math('ADD', wear, 0.05), m.math('MULTIPLY', m.math('SUBTRACT', grit, 0.5), 0.5)), 0.45, 0.75)
    e1 = m.math('MULTIPLY', s1, reveal); e2 = m.math('MULTIPLY', s2, m.math('MULTIPLY', reveal, 0.8))
    wc = m.mix(0.5, col, lin(worn)); wc = m.mix(m.remap(T.noise(6, 4, off=3.0), 0.4, 0.8, 0.0, 0.6), wc, m.hsv(wc, 0.5, 1.0, 0.72))
    col = m.mix(m.math('MULTIPLY', wear, 0.8), col, wc); col = m.mix(e2, col, t2); col = m.mix(e1, col, t1)
    rough = m.mixf(m.math('MULTIPLY', wear, 0.8), rough, 0.58); rough = m.mixf(m.math('MAXIMUM', e1, e2), rough, 0.45)
    h = m.math('ADD', h, m.math('MULTIPLY', m.math('MAXIMUM', e1, e2), 0.00025))
    return finish(m, col, rough, h)

def concrete_floor():
    """the cellar's floor: a hand-trowelled slab in 2.25 m bays, tooled joints along the tile's edges (rounded, spalled here and
       there, packed with dirt), the surface undulating a millimetre or two"""
    W = H = TW; g = 0.004; r = 0.004; G = Geo(W, H)
    M = concrete_mat('concrete_floor', W, H); D = gapdirt_mat('concrete_joint', W, H, '#2a2724')
    # grid lines: dense near the slab's edges (the rounded arris), 1 cm in the field
    edge_pts = [0.0, 0.0004, 0.001, 0.0018, 0.0028, 0.004, 0.0055, 0.0075, 0.010, 0.014, 0.02]
    field = list(np.arange(0.03, W - 2 * g - 0.03, 0.01)); L = W - 2 * g
    xs = sorted(set([round(x, 6) for x in edge_pts + field + [L - x for x in edge_pts]]))
    bm = bmesh.new(); V = [[bm.verts.new((g + x, g + y, 0.0)) for x in xs] for y in xs]
    for j in range(len(xs) - 1):
        for i in range(len(xs) - 1): bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
    # the skirt round it, down into the joint
    ring = [V[0][i] for i in range(len(xs))] + [V[j][-1] for j in range(1, len(xs))] + [V[-1][i] for i in range(len(xs) - 2, -1, -1)] + [V[j][0] for j in range(len(xs) - 2, 0, -1)]
    low = [bm.verts.new((v.co.x, v.co.y, -0.03)) for v in ring]
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]; c, d = low[(k + 1) % len(ring)], low[k]
        bm.faces.new((a, d, c, b))
    seeds = [random.uniform(0, 50) for _ in range(4)]
    for v in bm.verts:
        if v.co.z < -0.01: continue
        x, y = v.co.x, v.co.y
        und = (pnoise(x, y, W, H, 1.2, seeds[0]) * 0.0016 + pnoise(x, y, W, H, 4.0, seeds[1]) * 0.0005)
        d = min(x - g, W - g - x, y - g, H - g - y)
        z = und - (r - math.sqrt(max(0.0, r * r - (r - d) ** 2)) if d < r else 0.0)
        sp = pnoise(x, y, W, H, 14.0, seeds[2]) + 0.5 * pnoise(x, y, W, H, 40.0, seeds[3])            # (spalls along the arris)
        if d < 0.03 and sp > 0.25: z -= (sp - 0.25) * 0.012 * (1 - d / 0.03) ** 1.5
        v.co.z = z
    G.add(bm, M, {}, wrap=True)
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -0.011), D, {}, wrap=False)
    return {'geo': G.build('concrete_floor'), 'W': W, 'H': H, 'variants': 2, 'ao': 0.1, 'cav': 0.015, 'pom': 0.008,
            'notes': 'hand-trowelled slab, tooled joints along the tile edges; B: the cement skin worn off along a path'}

# ================================================================ ATTIC style
JOIST = 0.45                                                       # (attic joists: every 0.45 m, five to a tile)

def pine_mat(name, W, H, early='#9a7550', late='#4c2f17', dust='#837e74', dusty=0.2, nails=True, worn='#5e4129', board_w=0.2, along_x=True, wall_rows=None, wv=True, sawn=0.0, fig=1.0):
    """old Baltic pine, never finished: tight rings (pale earlywood fading into a sharp dark latewood band), flat-sawn
       cathedrals and straight quartersawn stripes ('qs'), knots with the rings bent round them and resin bleeding along the
       grain, faint saw marks across each board, the soft earlywood worn below the latewood (raised grain), splits at a
       few ends ('spl': where across), darkened with age, grey with dust, rust bleeding from the nails at every joist
       crossing, whitewash splashes, a roof-leak stain. Variant B: the dust walked off a path, the wood burnished darker."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); g = m.attr('gpos', True); pr = m.attr('prand'); qs = m.attr('qs'); V = variant(m)
    bx = m.attr('bx'); bl = m.attr('bl'); bL = m.attr('bL'); spl = m.attr('spl'); bw = m.attr('bw')
    gx, gy, gz = sep(m, g)
    pr2 = m.math('FRACT', m.math('MULTIPLY', pr, 7.31)); pr3 = m.math('FRACT', m.math('MULTIPLY', pr, 13.7)); pr4 = m.math('FRACT', m.math('MULTIPLY', pr, 3.17))
    def wob(sc, amp, det=3):
        return m.math('MULTIPLY', m.math('SUBTRACT', noise3(m, vmul(m, g, sc), 1.0, det, 0.5), 0.5), amp)
    # knots: a few per board, the rings swirling round them
    sp = comb(m, m.math('ADD', bl, m.math('MULTIPLY', pr, 41.0)), m.math('ADD', m.math('MULTIPLY', bx, m.math('MULTIPLY', bw, 0.5)), m.math('MULTIPLY', pr, 13.0)), 0.0)
    kv = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=0.9); m.l(m.map(sp, (2.2, 5.0, 1.0)), kv.inputs['Vector'])
    kd = m.math('DIVIDE', kv.outputs['Distance'], 5.0); ksel = m.remap(sep(m, kv.outputs['Color'])[0], 0.62, 0.66)
    krad = m.mixf(sep(m, kv.outputs['Color'])[1], 0.006, 0.016)
    kin = m.math('MULTIPLY', m.remap(m.math('DIVIDE', kd, krad), 1.0, 0.85, smooth=True), ksel)
    bend = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(m.math('DIVIDE', kd, krad), 5.0, 1.0, smooth=True), ksel), m.math('MULTIPLY', krad, 1.4))
    r = m.math('ADD', vlen(m, comb(m, gx, gy, 0.0)), m.math('ADD', wob((2.2, 2.2, 0.16), 0.02), m.math('ADD', wob((12, 12, 0.9), 0.006), m.math('ADD', wob((60, 60, 4), 0.0015), m.math('ADD', wob((1.5, 1.5, 1.2), 0.008), wob((30, 30, 2.5), 0.003))))))
    r = m.math('ADD', r, bend)
    yr = noise3(m, comb(m, m.math('MULTIPLY', r, 20.0), m.math('MULTIPLY', pr, 40.0), 0.0), 1.0, 2, 0.5)
    ring = m.math('FRACT', m.math('ADD', m.math('MULTIPLY', r, m.remap(pr, 0, 1, 170, 320)), m.math('MULTIPLY', m.math('SUBTRACT', yr, 0.5), 6.0)))
    lws = m.remap(noise3(m, vmul(m, g, (25, 25, 1.5)), 1.0, 3, 0.55), 0.3, 0.7, 0.35, 0.72)       # (where the latewood starts: its width wanders)
    lw = m.math('POWER', m.math('MINIMUM', 1.0, m.math('MAXIMUM', 0.0, m.math('DIVIDE', m.math('SUBTRACT', ring, lws), m.math('SUBTRACT', 0.98, lws)))), 1.4)
    col = m.mix(m.math('MULTIPLY', lw, m.math('MULTIPLY', m.remap(pr3, 0, 1, 0.6 * fig, 0.95 * fig), m.remap(noise3(m, vmul(m, g, (18, 18, 0.8)), 1.0, 2), 0.3, 0.7, 0.75, 1.05))), lin(early), lin(late))
    col = m.mix(m.remap(noise3(m, vmul(m, g, (36, 36, 0.45)), 1.0, 4, 0.55), 0.2, 0.8), m.hsv(col, 0.5, 0.95, 0.86), m.hsv(col, 0.5, 1.05, 1.12))
    fibre = noise3(m, vmul(m, g, (380, 380, 5)), 1.0, 3, 0.65)
    col = m.mix(m.remap(fibre, 0.25, 0.75), m.hsv(col, 0.5, 1.0, 0.86), m.hsv(col, 0.5, 1.0, 1.08))   # (fibre)
    col = m.hsv(col, m.remap(pr, 0, 1, 0.488, 0.512), m.remap(pr3, 0, 1, 0.82, 1.08), m.remap(pr2, 0, 1, 0.8, 1.12))
    col = m.hsv(col, 0.5, 1.0, m.math('ADD', 1.0, m.math('MULTIPLY', m.math('DIVIDE', bl, m.math('MAXIMUM', bL, 0.1)), m.remap(pr4, 0, 1, -0.2, 0.2))))
    kcol = m.mix(m.remap(m.math('FRACT', m.math('ADD', m.math('MULTIPLY', m.math('DIVIDE', kd, krad), 5.0), m.math('MULTIPLY', noise3(m, vmul(m, g, (200, 200, 200)), 1.0, 2), 1.5))), 0.3, 0.8), lin('#2c1a0c'), lin('#4a2c12'))
    col = m.mix(kin, col, kcol); col = m.mix(m.math('MULTIPLY', m.remap(m.math('DIVIDE', kd, krad), 1.15, 0.95), ksel), col, (0.05, 0.03, 0.015))   # (the dark rim of the knot)
    resin = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(m.math('DIVIDE', kd, krad), 6.0, 1.0, smooth=True), ksel), m.remap(noise3(m, vmul(m, g, (90, 90, 2)), 1.0, 3), 0.5, 0.7))
    col = m.mix(m.math('MULTIPLY', resin, 0.6), col, m.hsv(col, 0.48, 1.25, 0.6))
    # saw marks across the board (a circular saw's arcs), faint
    sx_, sy_, _ = sep(m, sp)
    arc = m.math('SINE', m.math('MULTIPLY', m.math('ADD', sx_, m.math('MULTIPLY', m.math('MULTIPLY', sy_, sy_), 0.8)), 2 * math.pi / (0.0035 + 0.0045 * sawn)))
    saw = m.math('MULTIPLY', m.math('ADD', m.math('MULTIPLY', arc, 0.5), 0.5), m.remap(noise3(m, vmul(m, g, (8, 8, 0.6)), 1.0, 2), 0.4, 0.7, 0.0, 0.7))
    col = m.mix(m.math('MULTIPLY', saw, 0.12 + 0.2 * sawn), col, m.hsv(col, 0.5, 1.0, 0.82))
    fuzz = noise3(m, vmul(m, g, (320, 320, 25)), 1.0, 3, 0.7)                                  # (rough-sawn: torn fibres)
    col = m.mix(m.math('MULTIPLY', m.remap(fuzz, 0.25, 0.75), 0.25 * sawn), col, m.hsv(col, 0.5, 0.8, 1.25))
    # raised grain: the latewood stands, the earlywood is worn down; knots stand proud
    h = m.math('ADD', m.math('MULTIPLY', lw, 0.00022), m.math('ADD', m.math('MULTIPLY', saw, 0.00005 + 0.00025 * sawn), m.math('MULTIPLY', fuzz, 0.0001 * sawn)))
    h = m.math('ADD', h, m.math('MULTIPLY', kin, 0.0002))
    rough = m.math('ADD', m.mixf(lw, 0.8, 0.68), 0.12 * sawn)
    # splits at a few ends, along the grain
    endd = m.math('SUBTRACT', m.math('MULTIPLY', bL, 0.5), m.math('ABSOLUTE', bl))
    split = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', bx, spl)), 0.035, 0.0), m.remap(m.math('DIVIDE', endd, m.mixf(pr2, 0.05, 0.22)), 1.0, 0.0, smooth=True))
    split = m.math('MULTIPLY', split, m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', bx, spl)), 0.035, 0.0))
    col = m.mix(split, col, (0.02, 0.014, 0.01)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', split, 0.002))
    col = m.mix(m.remap(endd, 0.006, 0.0, smooth=True), col, m.hsv(col, 0.5, 1.1, 0.6))       # (end grain, darker)
    # age: darker toward amber-brown, unevenly; nails bleed rust at every joist crossing
    col = m.mix(1.0, col, (0.86, 0.8, 0.72), 'MULTIPLY')
    col = m.mix(m.remap(T.noise(1.0, 3, 0.5), 0.3, 0.75, 0.25, 0.65), col, m.mix(1.0, m.hsv(col, 0.5, 0.75, 1.0), (0.78, 0.68, 0.58), 'MULTIPLY'))
    if nails:
        fx = m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', T.x if along_x else T.y, JOIST)), 0.5)
        dn = m.math('SQRT', m.math('ADD', m.math('POWER', m.math('MULTIPLY', fx, JOIST), 2.0),
                                   m.math('POWER', m.math('MULTIPLY', m.math('SUBTRACT', m.math('ABSOLUTE', bx), 0.62), m.math('MULTIPLY', bw, 0.5)), 2.0)))
        hn = noise3(m, vmul(m, g, (120, 120, 120)), 1.0, 3)
        halo = m.math('MULTIPLY', m.remap(m.math('ADD', dn, m.math('MULTIPLY', m.math('SUBTRACT', hn, 0.5), 0.01)), 0.022, 0.003, smooth=True), m.remap(hn, 0.2, 0.7, 0.4, 1.0))
        black = m.remap(dn, 0.007, 0.0025, smooth=True)
        col = m.mix(m.math('MULTIPLY', halo, 0.75), col, m.mix(0.55, m.hsv(col, 0.5, 1.1, 0.5), lin('#4a2410'))); col = m.mix(m.math('MULTIPLY', black, 0.7), col, (0.03, 0.025, 0.02))
    if wall_rows:                                                      # (a wall: nailed to rails, the rust runs down)
        dxn = m.math('MULTIPLY', m.math('SUBTRACT', m.math('ABSOLUTE', bx), 0.6), m.math('MULTIPLY', bw, 0.5))
        rn = noise3(m, vmul(m, g, (120, 120, 120)), 1.0, 3); run = None; head = None
        for k, ry in enumerate(wall_rows):
            dy = m.math('SUBTRACT', ry, T.y)
            d0 = m.math('SQRT', m.math('ADD', m.math('POWER', dy, 2.0), m.math('POWER', dxn, 2.0)))
            hd = m.remap(m.math('ADD', d0, m.math('MULTIPLY', m.math('SUBTRACT', rn, 0.5), 0.01)), 0.03, 0.004, smooth=True)
            ln = m.mixf(m.math('FRACT', m.math('MULTIPLY', pr, 3.7 + k)), 0.15, 0.6)
            wide = m.math('ADD', 0.003, m.math('MULTIPLY', m.math('MAXIMUM', dy, 0.0), 0.05))
            st = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(dy, 0.0, 0.006), m.remap(m.math('DIVIDE', dy, ln), 1.0, 0.15, smooth=True)), m.remap(m.math('DIVIDE', m.math('ABSOLUTE', dxn), wide), 1.0, 0.0, smooth=True))
            st = m.math('MULTIPLY', st, m.remap(noise3(m, vmul(m, g, (300, 12, 40)), 1.0, 3), 0.3, 0.7, 0.55, 1.0))
            run = st if run is None else m.math('MAXIMUM', run, st); head = hd if head is None else m.math('MAXIMUM', head, hd)
        col = m.mix(m.math('MULTIPLY', head, 0.85), col, m.mix(0.6, m.hsv(col, 0.5, 1.1, 0.45), lin('#4a2410')))
        col = m.mix(m.math('MINIMUM', 1.0, m.math('MULTIPLY', run, 1.2)), col, m.mix(0.55, m.hsv(col, 0.5, 1.25, 0.42), lin('#3e1c0a')))
        if not wv: col = m.mix(m.math('MULTIPLY', m.remap(T.y, 1.4, 3.0), 0.55), col, m.hsv(col, 0.5, 0.8, 0.6))   # (darker toward the roof)
    # whitewash splashes, a roof-leak stain with its tide line
    ws = m.math('MULTIPLY', m.remap(T.voronoi(9.0, 'Distance', off=81.0), 0.06, 0.03, smooth=True), m.remap(T.noise(0.8, 2, off=83.0), 0.62, 0.68))
    ws = m.math('MULTIPLY', ws, m.remap(T.noise(60, 3, off=84.0), 0.3, 0.6))
    col = m.mix(m.math('MULTIPLY', ws, 0.85), col, lin('#d8d4c8')); rough = m.mixf(ws, rough, 0.9); h = m.math('ADD', h, m.math('MULTIPLY', ws, 0.0002))
    lk = m.math('ADD', T.noise(0.7, 4, 0.55, off=91.0), -1.0 if wall_rows else 0.0)
    leak = m.remap(lk, 0.6, 0.66, smooth=True); ltide = m.math('MULTIPLY', m.remap(lk, 0.585, 0.6), m.remap(lk, 0.63, 0.61))
    col = m.mix(m.math('MULTIPLY', leak, 0.45), col, m.mix(1.0, col, (0.6, 0.52, 0.45), 'MULTIPLY')); col = m.mix(m.math('MULTIPLY', ltide, 0.55), col, m.mix(1.0, col, (0.45, 0.36, 0.28), 'MULTIPLY'))
    # the edges worn pale and round, dirt in the gaps' lips, dust over everything that isn't walked on
    cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    col = m.mix(m.math('MULTIPLY', edge, 0.3), col, m.hsv(col, 0.5, 0.8, 1.15))
    gr = m.math('MULTIPLY', m.remap(cav, 0.95, 0.45, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.85), col, (0.035, 0.03, 0.025)); rough = m.mixf(gr, rough, 0.9)
    if wall_rows:
        wear = m.val(0.0)
        sn = noise3(m, comb(m, m.math('MULTIPLY', m.math('ADD', T.x, 0.0), 28.0), m.math('MULTIPLY', T.y, 1.1), 0.0), 1.0, 3, 0.55)
        sk = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(sn, 0.55, 0.68, smooth=True), m.remap(T.y, 0.6, 2.6, smooth=True)), m.math('MULTIPLY', V, edge_fade(m, W, H, 0.06, 0.3, T, wv=False)))
        col = m.mix(m.math('MULTIPLY', sk, 0.75), col, m.mix(1.0, m.hsv(col, 0.5, 0.6, 0.9), (0.55, 0.5, 0.45), 'MULTIPLY'))
        mz = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(T.voronoi(220, 'Distance', off=5.0), 0.25, 0.06), m.remap(sn, 0.5, 0.6)), m.math('MULTIPLY', V, edge_fade(m, W, H, 0.06, 0.3, T, wv=False)))
        col = m.mix(m.math('MULTIPLY', mz, 0.8), col, (0.03, 0.035, 0.028))
    else:
        wear = m.math('MULTIPLY', m.math('MULTIPLY', edge_fade(m, W, H, 0.10, 0.55, T), m.remap(m.math('ADD', T.noise(0.9, 3, 0.45), m.math('MULTIPLY', T.noise(9, 3), 0.15)), 0.3, 0.62, smooth=True)), V)
    dn_ = m.math('ADD', T.noise(1.5, 4, 0.6, off=6.0), m.math('MULTIPLY', T.noise(14, 3, off=7.0), 0.3))
    dl = m.math('MULTIPLY', m.remap(dn_, 0.35, 0.95, 0.15 * dusty, 2.2 * dusty, smooth=True), m.math('SUBTRACT', 1.0, m.math('MULTIPLY', wear, 0.95)))   # (thin on the boards, thick in drifts)
    dl = m.math('MULTIPLY', dl, m.math('MULTIPLY', m.remap(cav, 0.6, 1.0, 1.6, 1.0), m.math('ADD', 1.0, m.math('MULTIPLY', m.math('SUBTRACT', 1.0, lw), 0.35))))
    col = m.mix(dl, col, lin(dust)); rough = m.mixf(dl, rough, 0.92)
    col = m.mix(m.math('MULTIPLY', wear, 0.45), col, m.mix(0.3, m.hsv(col, 0.5, 0.9, 0.86), lin(worn))); rough = m.mixf(m.math('MULTIPLY', wear, 0.8), rough, 0.55)
    h = m.math('ADD', h, m.math('MULTIPLY', m.math('MULTIPLY', lw, wear), 0.0001))
    return finish(m, col, rough, h)

def iron_mat(name, W, H, col='#2b2724'):
    """old cut-nail heads and iron: black, rusted at the edges"""
    m = kitlib.Mat(name); T = Tor(m, W, H); n = T.noise(400, 3, 0.6); rr = T.noise(80, 4, 0.6, off=3.0)
    c = m.mix(m.remap(rr, 0.4, 0.7), lin(col), lin('#5a2f16')); c = m.mix(m.remap(n, 0.3, 0.7, 0.0, 0.3), c, m.hsv(c, 0.5, 1.0, 1.4))
    return finish(m, c, m.remap(rr, 0.3, 0.7, 0.55, 0.9), m.math('MULTIPLY', n, 0.0001), metal=m.remap(rr, 0.55, 0.4, 0.0, 0.6))

def split_widths(total, n, lo, hi):
    w = [random.uniform(lo, hi) for _ in range(n)]; k = total / sum(w); return [x * k for x in w]

def attic_floor():
    """the attic's floor: wide rough pine boards of uneven width, butted over the joists (every 0.45 m), face-nailed at every
       joist, cupped, wide dusty gaps, a few ends lifted"""
    W = H = TW; G = Geo(W, H); t = 0.022
    P = pine_mat('attic_floor', W, H); IR = iron_mat('attic_nail', W, H); D = gapdirt_mat('attic_gap', W, H, '#24201b')
    widths = split_widths(H, 11, 0.17, 0.24); y = 0.0
    for wbd in widths:
        nj = random.choice((2, 3, 4, 5)); off = random.randrange(5); x = (off + 0.5) * JOIST
        lens = []; left = 5
        while left > 0:
            k = min(left, random.choice((2, 3, 4, 5))); lens.append(k * JOIST); left -= k
        for L in lens:
            gx, gy = random.uniform(0.001, 0.003), random.uniform(0.002, 0.007)
            cup = random.uniform(0.0004, 0.0014)
            bm = board(x, y, L, wbd, t, gx, gy, cup=cup, bevel=0.0018, nx=0.06, ny=10)
            xc, yc = x + L / 2, y + wbd / 2; lift = random.choice((0.0, 0.0, 0.0, random.uniform(0.0005, 0.0018)))
            dz = random.gauss(0, 0.0004); tilt = random.gauss(0, 0.0015)
            bm = deform(bm, lambda c, xc=xc, yc=yc, dz=dz, tilt=tilt, lift=lift, L=L: (c.x, c.y, c.z + dz + (c.y - yc) * tilt + lift * max(0.0, (abs(c.x - xc) - L / 2 + 0.25) / 0.25) ** 2))
            qsn = 1.0 if random.random() < 0.15 else 0.0; d0 = random.uniform(0.1, 0.3) if not qsn else random.uniform(0.08, 0.3)
            o3 = (random.uniform(-0.02, 0.02), random.uniform(-90, 90)); tl = math.tan(math.radians(random.uniform(0.15, 1.0))) * random.choice((-1, 1))
            if qsn: gp = lambda c, xc=xc, yc=yc, d0=d0, o=o3, tl=tl: (d0 + (c.y - yc), c.z * 3 + (c.x - xc) * tl * 0.3, c.x - xc + o[1])
            else: gp = lambda c, xc=xc, yc=yc, d0=d0, o=o3, tl=tl: (c.y - yc + o[0], d0 + c.z + (c.x - xc) * tl, c.x - xc + o[1])
            wb = wbd - gy
            G.add(bm, P, {'gpos': gp, 'prand': random.random(), 'qs': qsn, 'bL': L - gx, 'bw': wb, 'spl': random.uniform(-0.6, 0.6) if random.random() < 0.25 else 9.0,
                          'bx': (lambda c, yc=yc, wb=wb: (c.y - yc) / (wb / 2)), 'bl': (lambda c, xc=xc: c.x - xc)})
            # cut nails at every joist the board crosses, two across it (and at both ends)
            for k in range(int(round(L / JOIST)) + 1):
                jx = x + k * JOIST + (0.012 if k == 0 else (-0.012 if k == round(L / JOIST) else 0.0))
                for s in (-1, 1):
                    ny_ = yc + s * 0.62 * wb / 2; top = -cup * (1 - 0.62 ** 2) + random.choice((-0.0005, -0.0003, -0.0002, 0.0, 0.0006))   # (most set just below the face, one or two proud)
                    nb = box(0.0052, 0.0038, 0.004, 0.0004, 1); xform(nb, (jx + random.gauss(0, 0.0015), ny_ + random.gauss(0, 0.001), top - 0.002), (0, 0, random.uniform(-0.3, 0.3)))
                    nb = deform(nb, lambda c, xc=xc, yc=yc, dz=dz, tilt=tilt: (c.x, c.y, c.z + dz + (c.y - yc) * tilt))
                    G.add(nb, IR, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'bL': 1.0, 'bw': 0.2, 'spl': 9.0, 'bx': 0.0, 'bl': 0.0})
            x += L
        y += wbd
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -0.009), D, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'bL': 1.0, 'bw': 0.2, 'spl': 9.0, 'bx': 0.0, 'bl': 0.0}, wrap=False)
    return {'geo': G.build('attic_floor'), 'W': W, 'H': H, 'variants': 2, 'ao': 0.1, 'cav': 0.012, 'pom': 0.008,
            'notes': 'wide rough pine boards (11 to a tile, uneven widths) butted over joists every 0.45 m, face-nailed; B: the dust walked off a path'}

# ================================================================ WORKSHOP style
def quarry_mat(name, W, H, reds=('#7a3b26', '#8b4b31', '#5e2d1e', '#6c3727'), blue='#38322f', worn='#94604a'):
    """unglazed quarry tiles: fired clay in a run of red-browns, now and then a Staffordshire blue, kiln flashing across one
       side, grog specks and pits, lime bloom, worn pale on their high edges and corners, a few cracked ('crack'), dirt in
       every low place, oil spots. Variant B: oil-soaked: dark, saturated, glossy blotches that have wicked along the joints."""
    m = kitlib.Mat(name); T = Tor(m, W, H); g = m.attr('gpos', True); pr = m.attr('prand'); lp = m.attr('lpos', True); crk = m.attr('crack'); V = variant(m)
    bl_ = m.attr('blue')
    pr2 = m.math('FRACT', m.math('MULTIPLY', pr, 7.31)); pr3 = m.math('FRACT', m.math('MULTIPLY', pr, 13.7)); pr4 = m.math('FRACT', m.math('MULTIPLY', pr, 3.17))
    lx, ly, lz = sep(m, lp)
    col = m.mix(m.remap(pr, 0.0, 0.5), lin(reds[0]), lin(reds[1])); col = m.mix(m.remap(pr, 0.5, 1.0), col, lin(reds[2]))
    col = m.mix(m.remap(pr2, 0.75, 0.95), col, lin(reds[3]))
    col = m.mix(bl_, col, lin(blue))
    # kiln flashing: darker across one side of the tile, cloudy
    fd = m.math('ADD', m.math('MULTIPLY', lx, m.math('SUBTRACT', m.math('MULTIPLY', pr3, 2.0), 1.0)), m.math('MULTIPLY', ly, m.math('SUBTRACT', m.math('MULTIPLY', pr4, 2.0), 1.0)))
    flash = m.math('MULTIPLY', m.remap(m.math('ADD', fd, m.math('MULTIPLY', m.math('SUBTRACT', noise3(m, vmul(m, g, (6, 6, 6)), 1.0, 4), 0.5), 0.8)), 0.0, 0.7, smooth=True), m.remap(pr2, 0.2, 0.6, 0.2, 0.8))
    col = m.mix(flash, col, m.hsv(col, 0.5, 1.1, 0.62))
    cl = noise3(m, vmul(m, g, (4, 4, 4)), 1.0, 5, 0.6); col = m.mix(m.remap(cl, 0.3, 0.7, 0.0, 0.35), col, m.hsv(col, 0.5, 0.95, 1.15))
    # grog: specks lighter and darker; pits
    gv = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (300, 300, 300)), gv.inputs['Vector'])
    gs = m.remap(gv.outputs['Distance'], 0.3, 0.1); gc_ = sep(m, gv.outputs['Color'])[0]
    col = m.mix(m.math('MULTIPLY', gs, m.remap(gc_, 0.6, 0.9)), col, m.hsv(col, 0.5, 0.6, 1.5)); col = m.mix(m.math('MULTIPLY', gs, m.remap(gc_, 0.3, 0.1)), col, m.hsv(col, 0.5, 1.0, 0.45))
    pv = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (90, 90, 90)), pv.inputs['Vector'])
    pit = m.math('MULTIPLY', m.remap(pv.outputs['Distance'], 0.12, 0.04, smooth=True), m.remap(noise3(m, vmul(m, g, (5, 5, 5)), 1.0, 2), 0.45, 0.7))
    col = m.mix(m.math('MULTIPLY', pit, 0.7), col, m.hsv(col, 0.5, 1.0, 0.4))
    fine = T.noise(240, 3, 0.6); col = m.mix(m.remap(fine, 0.25, 0.75), m.hsv(col, 0.5, 1.0, 0.9), m.hsv(col, 0.5, 1.0, 1.1))
    h = m.math('ADD', m.math('MULTIPLY', cl, 0.0003), m.math('SUBTRACT', m.math('MULTIPLY', fine, 0.00012), m.math('MULTIPLY', pit, 0.0005)))
    rough = m.remap(fine, 0.3, 0.7, 0.74, 0.9)
    # lime bloom, a haze on some tiles
    bloom = m.math('MULTIPLY', m.remap(T.noise(1.3, 4, off=4.0), 0.55, 0.75), m.remap(noise3(m, vmul(m, g, (20, 20, 20)), 1.0, 3), 0.3, 0.7, 0.4, 1.0))
    col = m.mix(m.math('MULTIPLY', bloom, 0.35), col, lin('#c8bfb0'))
    # cracks
    cr = ridge(m, comb(m, m.math('ADD', lx, m.math('MULTIPLY', ly, 0.5)), ly, m.math('MULTIPLY', pr, 50.0)), 3.0, 4, 0.55, 300.0)
    crack = m.math('MULTIPLY', cr, crk)
    col = m.mix(m.math('MULTIPLY', crack, 0.9), col, (0.03, 0.02, 0.015)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', crack, 0.0008))
    # worn pale on the edges and corners (the high places), dirt in the low, oil spots
    cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    ew = m.math('MULTIPLY', edge, m.remap(noise3(m, vmul(m, g, (40, 40, 40)), 1.0, 4, 0.6), 0.3, 0.7, 0.1, 0.6))   # (the arrises worn pale, raggedly)
    col = m.mix(ew, col, m.mix(0.5, col, lin(worn))); rough = m.mixf(m.math('MULTIPLY', ew, 0.8), rough, 0.6)
    col = m.mix(1.0, col, (0.88, 0.84, 0.82), 'MULTIPLY')                                  # (decades of workshop grime in the clay)
    gr = m.math('MULTIPLY', m.remap(cav, 0.95, 0.45, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.85), col, (0.035, 0.026, 0.02)); rough = m.mixf(gr, rough, 0.9)
    dirt = m.math('ADD', m.remap(T.noise(1.6, 4, 0.6, off=6.0), 0.35, 0.85, 0.0, 0.55), m.math('MULTIPLY', m.remap(cav, 0.99, 0.85), 0.3))
    col = m.mix(dirt, col, m.hsv(col, 0.5, 0.6, 0.6))
    os_ = m.math('MULTIPLY', m.remap(T.voronoi(7.0, 'Distance', off=7.0), 0.07, 0.03, smooth=True), m.remap(T.noise(1.0, 2, off=8.0), 0.55, 0.65))
    col = m.mix(m.math('MULTIPLY', os_, 0.8), col, m.mix(1.0, col, (0.3, 0.25, 0.22), 'MULTIPLY')); rough = m.mixf(os_, rough, 0.35)
    # B: oil-soaked: dark, saturated, glossy, wicked along the joints
    on = m.math('ADD', T.noise(1.1, 5, 0.6, off=31.0), m.math('MULTIPLY', m.remap(cav, 1.0, 0.6), 0.25))
    soak = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(on, 0.42, 0.62, smooth=True), edge_fade(m, W, H, 0.10, 0.5, T)), V)
    rim = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(on, 0.38, 0.43), m.remap(on, 0.5, 0.44)), m.math('MULTIPLY', edge_fade(m, W, H, 0.10, 0.5, T), V))
    col = m.mix(m.math('MULTIPLY', soak, 0.9), col, m.hsv(m.mix(1.0, col, (0.32, 0.25, 0.2), 'MULTIPLY'), 0.5, 1.2, 1.0)); rough = m.mixf(soak, rough, 0.28)
    col = m.mix(m.math('MULTIPLY', rim, 0.4), col, m.mix(1.0, col, (0.55, 0.45, 0.38), 'MULTIPLY'))
    return finish(m, col, rough, h)

def workshop_floor():
    """the workshop's floor: 0.15 m quarry tiles (15 to a tile), pressed, a little domed and irregular, in wide cement joints;
       a few blue tiles, chipped corners, cracked tiles"""
    W = H = TW; n = 15; s = W / n; G = Geo(W, H)
    Q = quarry_mat('workshop_floor', W, H); GR = grout_mat('workshop_grout', W, H, '#58534c', '#1c1916')
    for i in range(n):
        for j in range(n):
            a = s - random.uniform(0.006, 0.009); b_ = s - random.uniform(0.006, 0.009); t = 0.018
            bm = box(a, b_, t, random.uniform(0.0018, 0.0028), 3)
            cuts(bm, 0, [-a / 2 + a * k / 6 for k in range(1, 6)]); cuts(bm, 1, [-b_ / 2 + b_ * k / 6 for k in range(1, 6)])
            dome = random.uniform(0.0002, 0.0008)
            deform(bm, lambda c, a=a, b_=b_, dome=dome: (c.x, c.y, c.z + (dome * (1 - (2 * c.x / a) ** 2) * (1 - (2 * c.y / b_) ** 2) if c.z > 0 else 0.0)))
            if random.random() < 0.1:
                cx, cy = random.choice((-1, 1)), random.choice((-1, 1)); r = random.uniform(0.004, 0.012)
                co = Vector((cx * a / 2, cy * b_ / 2, t / 2)); no = Vector((cx, cy, random.uniform(0.7, 1.4))).normalized()
                bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co - no * r * 0.8, plane_no=no, clear_outer=True)
                bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
            cx, cy = (i + 0.5) * s + random.gauss(0, 0.0008), (j + 0.5) * s + random.gauss(0, 0.0008)
            xform(bm, (cx, cy, -t / 2 + max(-0.001, random.gauss(0, 0.0004))), (random.gauss(0, 0.002), random.gauss(0, 0.002), random.gauss(0, 0.012)))
            off = Vector((random.uniform(-40, 40), random.uniform(-40, 40), random.uniform(-40, 40)))
            G.add(bm, Q, {'gpos': (lambda c, cx=cx, cy=cy, off=off: (c.x - cx + off.x, c.y - cy + off.y, off.z)), 'lpos': (lambda c, cx=cx, cy=cy: ((c.x - cx) / s, (c.y - cy) / s, 0.0)),
                          'prand': random.random(), 'crack': 1.0 if random.random() < 0.04 else 0.0, 'blue': 1.0 if random.random() < 0.07 else 0.0})
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -0.003), GR, {'gpos': (0, 0, 0), 'lpos': (0, 0, 0), 'prand': 0.5, 'crack': 0.0, 'blue': 0.0}, wrap=False)
    return {'geo': G.build('workshop_floor'), 'W': W, 'H': H, 'variants': 2, 'ao': 0.08, 'cav': 0.012, 'pom': 0.006,
            'notes': '0.15 m red quarry tiles (15 per tile), wide cement joints, a few blue; B: oil-soaked'}

# ================================================================ printed patterns (drawn in Python, printed by the shader)
def _pattern_image(name, arr):
    """a float array (h, w) or (h, w, 3), row 0 at the top -> a Non-Color Blender image (repeat)"""
    h, w = arr.shape[:2]; im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
    c = arr if arr.ndim == 3 else np.repeat(arr[..., None], 3, -1)
    rgba = np.concatenate([c[..., :3], np.ones((h, w, 1), np.float32)], -1)[::-1]
    im.pixels.foreach_set(rgba.astype(np.float32).ravel()); im.pack(); return im

def damask(px=1024, seed=7, strip=0.5625, rep=0.6):
    """a Victorian damask repeat two strips wide (half drop), drawn as ornament: a palmette of lobed acanthus leaves with
       veins rising from a cup, big leaves curling down from it, C-scrolls with leaflets ending in spirals and rosettes, flower
       sprays, all framed by an ogee vine of leaves and berries that joins its neighbours at rosettes; mirrored. Returns an
       (h, w, 3) array: R the motif (the fill block), G its detail lines (the second block), B the ink's pooled rim."""
    from PIL import Image, ImageDraw, ImageFilter
    S = 4; Wc, Hc = px * S, int(round(px * S * rep / strip))
    fill = Image.new('L', (Wc, Hc), 0); line = Image.new('L', (Wc, Hc), 0)
    D = {'F': ImageDraw.Draw(fill), 'L': ImageDraw.Draw(line)}; asp = Wc / Hc
    def P(x, y): return (x * Wc, y * Hc)
    def stroke(pts, w0, w1=None, to='F', val=255):
        w1 = w0 if w1 is None else w1; L, R = [], []; n = len(pts)
        for i, (x, y) in enumerate(pts):
            a = pts[max(0, i - 1)]; b = pts[min(n - 1, i + 1)]
            dx, dy = (b[0] - a[0]) * Wc, (b[1] - a[1]) * Hc; l = math.hypot(dx, dy) or 1
            nx, ny = -dy / l, dx / l; w = (w0 + (w1 - w0) * i / max(1, n - 1)) * Wc
            L.append((x * Wc + nx * w, y * Hc + ny * w)); R.append((x * Wc - nx * w, y * Hc - ny * w))
        D[to].polygon(L + R[::-1], fill=val)
    def bez(p0, p1, p2, p3, n=40):
        out = []
        for i in range(n + 1):
            t = i / n; u = 1 - t
            out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                        u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
        return out
    def spiral(cx, cy, r0, a0, turns, w0, w1, sign=1, n=90):
        stroke([(cx + r0 * (1 - 0.85 * i / n) * math.cos(a0 + sign * turns * 2 * math.pi * i / n),
                 cy + r0 * (1 - 0.85 * i / n) * math.sin(a0 + sign * turns * 2 * math.pi * i / n) * asp) for i in range(n + 1)], w0, w1)
    def leaf(x, y, ang, L, w, curl=0.0, serr=0, vein=True):
        n = 40; mx, my = x, y; pts = [(mx, my)]; left, right = [], []
        for i in range(1, n + 1):
            a = ang + curl * i / n; mx += L / n * math.cos(a); my += L / n * math.sin(a) * asp; pts.append((mx, my))
        for i, (mx, my) in enumerate(pts):
            t = i / n; a = ang + curl * t
            ww = w * math.sin(math.pi * t ** 0.75) ** 0.65 * (1.0 - 0.25 * t)
            if serr: ww *= 0.86 + 0.24 * abs(math.sin(t * math.pi * serr))                      # (scalloped lobes: acanthus)
            nx, ny = -math.sin(a), math.cos(a) * asp
            left.append((mx + nx * ww, my + ny * ww)); right.append((mx - nx * ww, my - ny * ww))
        D['F'].polygon([P(*p) for p in left + right[::-1]], fill=255)
        if vein:
            stroke(pts[2:-4], w * 0.09, w * 0.03, to='L')
            for k in range(3, n - 6, 7):
                mx, my = pts[k]; a = ang + curl * k / n
                for side in (1, -1):
                    stroke([(mx, my), (mx + math.cos(a + side * 0.7) * w * 1.6, my + math.sin(a + side * 0.7) * w * 1.6 * asp)], w * 0.05, w * 0.02, to='L')
    def disc(x, y, r, val=255, to='F'): D[to].ellipse([P(x - r, y - r * asp), P(x + r, y + r * asp)], fill=val)
    def rosette(x, y, r, petals=8):
        for k in range(petals): leaf(x, y, 2 * math.pi * k / petals, r, r * 0.33, vein=False)
        disc(x, y, r * 0.28, 0); disc(x, y, r * 0.18, 255)
        for k in range(petals):
            a = 2 * math.pi * (k + 0.5) / petals
            stroke([(x + math.cos(a) * r * 0.32, y + math.sin(a) * r * 0.32 * asp), (x + math.cos(a) * r * 0.75, y + math.sin(a) * r * 0.75 * asp)], r * 0.025, r * 0.01, to='L')
    cx = 0.5
    for k, a in enumerate((-90, -106, -122, -138, -154, -170)):                                     # the palmette
        leaf(cx, 0.62, math.radians(a), (0.25, 0.23, 0.2, 0.17, 0.14, 0.12)[k], (0.042, 0.04, 0.037, 0.033, 0.03, 0.026)[k],
             curl=(0.0, -0.2, -0.4, -0.65, -0.95, -1.3)[k], serr=4)
    leaf(cx, 0.645, math.radians(175), 0.19, 0.05, curl=-2.3, serr=5); leaf(cx, 0.66, math.radians(150), 0.12, 0.03, curl=-1.4, serr=3)
    stroke(bez((cx, 0.64), (cx - 0.004, 0.7), (cx + 0.004, 0.74), (cx, 0.79)), 0.012, 0.007)        # the stem and knop
    disc(cx, 0.795, 0.03); disc(cx, 0.795, 0.016, 0); rosette(cx, 0.585, 0.045, 10)
    sc = bez((cx - 0.01, 0.80), (cx - 0.22, 0.86), (cx - 0.36, 0.62), (cx - 0.26, 0.45), 50); stroke(sc, 0.013, 0.008)   # the C-scroll
    spiral(cx - 0.21, 0.47, 0.055, math.pi * 1.05, 0.9, 0.008, 0.004, 1); rosette(cx - 0.215, 0.47, 0.028, 7)
    for i in range(6, 46, 7):
        x, y = sc[i]; x2, y2 = sc[i + 1]; a = math.atan2((y2 - y) / asp, x2 - x); side = 1 if (i // 7) % 2 else -1
        leaf(x, y, a + side * 0.9, 0.065 - i * 0.0006, 0.018, curl=-side * 0.9, serr=3)
    t1 = bez((cx - 0.21, 0.42), (cx - 0.24, 0.34), (cx - 0.20, 0.27), (cx - 0.25, 0.20), 30); stroke(t1, 0.006, 0.004)   # the flower spray
    rosette(cx - 0.25, 0.20, 0.032, 6)
    leaf(cx - 0.225, 0.33, math.radians(-170), 0.07, 0.022, curl=1.0, serr=3); leaf(cx - 0.215, 0.30, math.radians(-20), 0.06, 0.02, curl=-0.9, serr=3)
    for (bx_, by_, ba) in ((cx - 0.33, 0.24, -150), (cx - 0.12, 0.22, -40)):
        stroke(bez((cx - 0.23, 0.26), (bx_ + 0.03, by_ + 0.05), (bx_, by_ + 0.03), (bx_, by_), 20), 0.004, 0.003)
        for d_ in (-0.5, 0.0, 0.5): leaf(bx_, by_, math.radians(ba) + d_, 0.035, 0.012, vein=False)
    og = bez((cx, 0.02), (cx - 0.24, 0.12), (cx - 0.48, 0.30), (cx - 0.5, 0.5), 40) + bez((cx - 0.5, 0.5), (cx - 0.48, 0.70), (cx - 0.24, 0.88), (cx, 0.98), 40)[1:]
    stroke(og, 0.009, 0.009)                                                                      # the ogee vine
    for i in range(4, len(og) - 4, 6):
        x, y = og[i]; x2, y2 = og[i + 1]; a = math.atan2((y2 - y) / asp, x2 - x); side = 1 if (i // 6) % 2 else -1
        leaf(x, y, a + side * 1.0, 0.06, 0.02, curl=-side * 0.9, serr=3)
        if (i // 6) % 3 == 0: disc(x + math.cos(a - side * 1.3) * 0.025, y + math.sin(a - side * 1.3) * 0.025 * asp, 0.006)
    rosette(cx, 0.02, 0.03, 8); rosette(cx, 0.98, 0.03, 8)
    for im in (fill, line):
        left = im.crop((0, 0, Wc // 2, Hc)); im.paste(left.transpose(Image.FLIP_LEFT_RIGHT), (Wc // 2, 0))
    a = np.asarray(fill.resize((px, Hc // S), Image.LANCZOS), np.float32) / 255
    l = np.asarray(line.resize((px, Hc // S), Image.LANCZOS), np.float32) / 255 * a
    two = np.concatenate([a, np.roll(a, a.shape[0] // 2, axis=0)], axis=1); two_l = np.concatenate([l, np.roll(l, l.shape[0] // 2, axis=0)], axis=1)
    bl = np.asarray(Image.fromarray((two * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(px / 500)), np.float32) / 255
    rim = np.clip((two - bl) * 2.5, 0, 1) * two                                                    # (block-printed ink pools at the edge)
    return np.stack([two, two_l, rim], -1)

# ================================================================ painted wood (wainscot, skirting, frames)
def paint_mat(name, W, H, color='#d6cbb2', under='#5f6d52', primer='#8a5a3c', wood='#9c774c', wv=True, chips=1.0, gloss=0.32, scuff=0.0, age=1.0, stain=0.0, up=1, band=None):
    """old oil paint, coat over coat, on wood: brush ridges along each piece (the 'gpos' attribute, z along the grain), its
       edges softened by the coats, yellowed unevenly, crazed in patches; chipped in clusters where things knocked it (on the
       edges there, and ragged flakes off the faces) through an older green coat and the red-brown primer to the wood; grime
       in the corners, dust on the ledges (faces whose normal points up: up = 1 for y on a wall, 2 for z), kick marks up to
       scuff m. Variant B (stain > 0): water-stained and more chipped."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); g = m.attr('gpos', True); pr = m.attr('prand'); V = variant(m)
    c = lin(color); cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    brush = noise3(m, vmul(m, g, (650, 650, 4.5)), 1.0, 3, 0.6); brush2 = noise3(m, vmul(m, g, (120, 120, 1.2)), 1.0, 3, 0.5)
    col = m.mix(m.remap(T.noise(2.5, 4, 0.55), 0.3, 0.75, 0.0, 0.45 * age), c, (c[0] * 0.9, c[1] * 0.83, c[2] * 0.64))      # (yellowed unevenly)
    col = m.mix(m.remap(brush2, 0.3, 0.7, 0.0, 0.1), col, m.hsv(col, 0.5, 1.0, 0.92)); col = m.mix(m.remap(brush, 0.3, 0.7, 0.0, 0.06), col, m.hsv(col, 0.5, 1.0, 0.94))
    col = m.hsv(col, 0.5, 1.0, m.remap(pr, 0, 1, 0.97, 1.03))
    if band:                                                           # (a painted line, hand-ruled)
        yl = m.math('ADD', T.y, m.math('MULTIPLY', m.math('SUBTRACT', T.noise(6, 2, off=44.0), 0.5), 0.002))
        col = m.mix(m.math('MULTIPLY', m.remap(yl, band[0] - 0.0005, band[0] + 0.0005), m.remap(yl, band[1] + 0.0005, band[1] - 0.0005)), col, (0.02, 0.02, 0.018))
    h = m.math('ADD', m.math('MULTIPLY', brush, 0.0001), m.math('MULTIPLY', brush2, 0.00005))
    rough = m.math('ADD', m.remap(T.noise(10, 3), 0.3, 0.7, gloss, gloss + 0.14), m.math('MULTIPLY', brush, 0.08))
    alli = T.voronoi(150, 'Distance', 'DISTANCE_TO_EDGE', off=2.0)                                 # (crazing, in patches)
    craze = m.math('MULTIPLY', m.remap(alli, 0.03, 0.0), m.remap(T.noise(1.8, 3, off=5.0), 0.55, 0.7, 0.0, age))
    col = m.mix(m.math('MULTIPLY', craze, 0.55), col, m.hsv(col, 0.5, 1.1, 0.5)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', craze, 0.0001))
    # chips: clustered where knocked; ragged flakes; deeper chips reach the older coats, the primer, the wood
    knock = m.remap(T.noise(2.0, 3, 0.5, off=1.0), 0.52, 0.72, smooth=True)
    if scuff: knock = m.math('MAXIMUM', knock, m.math('MULTIPLY', m.math('MULTIPLY', m.remap(T.y, scuff, 0.0), m.remap(T.noise(5, 3, off=2.5), 0.45, 0.7)), 0.6))   # (kicked here and there, not all along)
    flake = T.noise(24, 5, 0.65, off=1.0)
    ch = m.math('ADD', m.math('MULTIPLY', m.math('MULTIPLY', edge, knock), 0.55 * chips * (1.0 + 0.5 * stain)), m.math('MULTIPLY', m.math('SUBTRACT', flake, 0.5), 1.0))
    ch = m.math('ADD', ch, m.math('MULTIPLY', knock, 0.18 * chips))
    ch = m.math('ADD', ch, m.math('MULTIPLY', V, m.math('MULTIPLY', m.remap(T.noise(1.2, 3, off=8.0), 0.5, 0.75), 0.3 * stain)))
    c1 = m.remap(ch, 0.48, 0.5, smooth=True); c2 = m.remap(ch, 0.58, 0.6, smooth=True); c3 = m.remap(ch, 0.66, 0.68, smooth=True)
    uc = m.mix(m.remap(T.noise(40, 3), 0.3, 0.7), lin(under), m.hsv(m.mix(0.0, lin(under), lin(under)), 0.5, 0.85, 1.2))
    col = m.mix(c1, col, uc); col = m.mix(c2, col, lin(primer)); col = m.mix(c3, col, m.mix(0.35, lin(wood), (0.06, 0.04, 0.025)))
    h = m.math('SUBTRACT', h, m.math('ADD', m.math('MULTIPLY', c1, 0.00015), m.math('ADD', m.math('MULTIPLY', c2, 0.0001), m.math('MULTIPLY', c3, 0.00015))))
    rough = m.mixf(c1, rough, 0.5); rough = m.mixf(c2, rough, 0.75); rough = m.mixf(c3, rough, 0.82)
    col = m.mix(m.math('MULTIPLY', m.math('SUBTRACT', c1, m.remap(ch, 0.52, 0.54)), 0.5), col, m.hsv(col, 0.5, 1.0, 0.55))   # (the chip's shadowed lip)
    # grime in the corners, dust on the ledges, kick marks low down
    gr = m.math('MULTIPLY', m.remap(cav, 0.9, 0.4, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.4, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.7), col, (0.08, 0.065, 0.05)); rough = m.mixf(gr, rough, 0.8)
    col = m.mix(m.remap(T.noise(1.6, 4, 0.6, off=19.0), 0.4, 0.85, 0.0, 0.4 * age), col, m.hsv(col, 0.5, 0.9, 0.78))   # (handled, smoked, dusted for a century)
    if up is not None:                                                 # (no ledges on a ceiling)
        nrm = sep(m, m.geo('Normal'))[up]
        ledge = m.math('MULTIPLY', m.remap(nrm, 0.4, 0.9, smooth=True), m.remap(T.noise(30, 4, off=12.0), 0.3, 0.7, 0.35, 0.8))
        col = m.mix(ledge, col, lin('#8c8478')); rough = m.mixf(ledge, rough, 0.9)
    if scuff:
        low = m.remap(T.y, scuff, 0.0, smooth=True)
        kicks = m.math('MULTIPLY', low, m.remap(T.noise(28, 3, 0.5, off=21.0), 0.66, 0.74))
        col = m.mix(m.math('MULTIPLY', kicks, 0.6), col, (0.04, 0.035, 0.03))
        col = m.mix(m.math('MULTIPLY', low, m.remap(T.noise(4, 4, off=3.0), 0.4, 0.8, 0.0, 0.45)), col, m.hsv(col, 0.5, 0.85, 0.7))
    if stain:
        sn = T.noise(1.3, 4, 0.6, off=12.0)
        st = m.math('MULTIPLY', m.remap(sn, 0.5, 0.65, smooth=True), V)
        tide = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(sn, 0.62, 0.65), m.remap(sn, 0.68, 0.65)), V)
        col = m.mix(m.math('ADD', m.math('MULTIPLY', st, 0.35 * stain), m.math('MULTIPLY', tide, 0.6 * stain)), col, m.mix(1.0, col, (0.55, 0.42, 0.26), 'MULTIPLY'))
    return finish(m, col, rough, h)

def paper_mat(name, W, H, pattern, ground='#b39189', ink='#9d7672', pool='#7d5550', line='#cdb3a4', strip=0.5625, rep=0.6, y0=0.93, wv=False):
    """wallpaper on old lime plaster: a two-block print (the fill a satin ink a shade darker on a matte ground ruled with a
       fine satin stripe, its detail lines in a paler second block a hair out of register, the ink pooled darker at the motif's
       edges and laid unevenly), paper fibre, butt joints every strip with their edges lifting; faded and yellowed unevenly,
       foxed, greasy where hands go above the rail, dusty on the ledge over the rail, sooted toward the ceiling. Variant B: a
       broad water bloom from above with several tide lines, the paper bleached inside it, mould at its edges and low down,
       the joints lifting (kept off the tile's edges)."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); V = variant(m); x, y = T.x, T.y
    def tex(dx, dy):
        t = m.n('ShaderNodeTexImage', interpolation='Cubic', extension='REPEAT'); t.image = pattern
        m.l(comb(m, m.math('DIVIDE', m.math('ADD', x, dx), 2 * strip), m.math('DIVIDE', m.math('SUBTRACT', m.math('ADD', y, dy), y0), rep), 0.0), t.inputs['Vector'])
        r, g_, b = sep(m, t.outputs['Color']); return r, g_, b
    mo, _, rim = tex(0.0, 0.0); _, li, _ = tex(0.0007, -0.0005)
    dens = m.math('MULTIPLY', m.remap(T.noise(45, 4, 0.6), 0.25, 0.75, 0.72, 1.06), m.remap(T.noise(3, 3, off=2.0), 0.3, 0.7, 0.9, 1.04))
    col = m.mix(m.math('MINIMUM', 1.0, m.math('MULTIPLY', mo, dens)), lin(ground), lin(ink))
    col = m.mix(m.math('MULTIPLY', rim, 0.55), col, lin(pool)); col = m.mix(m.math('MULTIPLY', li, 0.32), col, lin(line))
    stripe = m.math('ADD', 0.5, m.math('MULTIPLY', m.math('SINE', m.math('MULTIPLY', x, 2 * math.pi / 0.0012)), 0.5))
    ground_ = m.math('SUBTRACT', 1.0, mo)
    fib = T.noise(700, 3, 0.7); fib2 = T.noise(130, 4, 0.6)
    col = m.mix(m.remap(fib2, 0.3, 0.7, 0.0, 0.08), col, m.hsv(col, 0.5, 1.0, 0.9)); col = m.mix(m.remap(fib, 0.3, 0.7, 0.0, 0.05), col, m.hsv(col, 0.5, 1.0, 1.08))
    col = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', stripe, ground_), 0.06), col, m.hsv(col, 0.5, 1.0, 1.12))
    h = m.math('ADD', m.math('MULTIPLY', mo, 0.00006), m.math('ADD', m.math('MULTIPLY', fib, 0.00003), m.math('MULTIPLY', m.math('MULTIPLY', stripe, ground_), 0.000025)))
    rough = m.mixf(mo, m.mixf(stripe, 0.9, 0.8), 0.7)
    # the joints: a hairline, the edges lifting and dirtier
    fx = m.math('FRACT', m.math('DIVIDE', x, strip)); dj = m.math('MULTIPLY', m.math('MINIMUM', fx, m.math('SUBTRACT', 1.0, fx)), strip)
    jn = T.noise(4, 3, off=2.0)
    joint = m.remap(dj, 0.0005, 0.0001); lift = m.math('MULTIPLY', m.remap(dj, 0.005, 0.0), m.remap(jn, 0.45, 0.7))
    col = m.mix(m.math('MULTIPLY', lift, 0.25), col, m.hsv(col, 0.5, 1.0, 0.82)); col = m.mix(joint, col, (0.3, 0.27, 0.23))
    h = m.math('ADD', h, m.math('SUBTRACT', m.math('MULTIPLY', lift, 0.00025), m.math('MULTIPLY', joint, 0.0003)))
    # age
    col = m.mix(m.remap(T.noise(0.9, 3, 0.5, off=7.0), 0.3, 0.7, 0.3, 0.65), col, m.mix(1.0, m.hsv(col, 0.5, 0.7, 1.0), (0.95, 0.86, 0.7), 'MULTIPLY'))
    col = m.mix(m.remap(T.noise(2.6, 4, 0.6, off=27.0), 0.5, 0.8, 0.0, 0.5), col, m.mix(1.0, col, (0.86, 0.76, 0.6), 'MULTIPLY'))   # (browned in patches)
    fox = m.math('MULTIPLY', m.remap(T.voronoi(55, 'Distance', off=3.0), 0.12, 0.03, smooth=True), m.remap(T.noise(3, 2, off=9.0), 0.52, 0.66))
    col = m.mix(m.math('MULTIPLY', fox, 0.45), col, m.mix(1.0, col, (0.62, 0.45, 0.3), 'MULTIPLY'))
    hands = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(y, y0 + 0.05, y0 + 0.2, smooth=True), m.remap(y, 1.65, 1.15, smooth=True)), m.remap(T.noise(3.5, 4, off=1.0), 0.4, 0.75, 0.0, 0.7))
    col = m.mix(hands, col, m.hsv(col, 0.5, 0.7, 0.62)); rough = m.mixf(hands, rough, 0.6)
    ledge = m.math('MULTIPLY', m.remap(y, y0 + 0.06, y0 + 0.03), m.remap(y, y0 + 0.02, y0 + 0.03))
    col = m.mix(m.math('MULTIPLY', ledge, 0.4), col, m.hsv(col, 0.5, 0.6, 0.75))
    soot = m.math('MULTIPLY', m.remap(y, 1.9, 3.0, smooth=True), m.remap(T.noise(1.4, 3, off=6.0), 0.3, 0.7, 0.35, 0.75))
    col = m.mix(soot, col, m.hsv(col, 0.5, 0.55, 0.62))
    # B: the water bloom, mould, lifting joints
    fade = edge_fade(m, W, H, 0.10, 0.3, T, wv=False)
    wn = m.math('ADD', T.noise(0.7, 2, 0.45, off=17.0), m.math('MULTIPLY', m.remap(y, 1.0, 3.0), 0.32))
    wn = m.math('ADD', wn, m.math('MULTIPLY', m.math('SUBTRACT', T.noise(6, 2, 0.5, off=3.0), 0.5), 0.025))
    inside = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(wn, 0.66, 0.70, smooth=True), fade), V)
    tides = None
    for lv, k in ((0.665, 0.85), (0.735, 0.3)):
        t_ = m.math('MULTIPLY', m.remap(wn, lv - 0.006, lv, smooth=True), m.remap(wn, lv + 0.03, lv, smooth=True))
        tides = m.math('MULTIPLY', t_, k) if tides is None else m.math('MAXIMUM', tides, m.math('MULTIPLY', t_, k))
    tides = m.math('MULTIPLY', m.math('MULTIPLY', tides, fade), V)
    col = m.mix(m.math('MULTIPLY', inside, 0.6), col, m.mix(1.0, m.hsv(col, 0.5, 0.55, 1.04), (0.95, 0.84, 0.64), 'MULTIPLY'))
    near_t = m.math('MULTIPLY', inside, m.remap(wn, 0.76, 0.67))                            # (the water carried the dirt to its edge)
    col = m.mix(m.math('MULTIPLY', near_t, 0.55), col, m.mix(1.0, col, (0.8, 0.66, 0.46), 'MULTIPLY'))
    col = m.mix(m.math('MULTIPLY', tides, 0.85), col, m.mix(1.0, col, (0.5, 0.36, 0.2), 'MULTIPLY'))
    mz = m.math('MAXIMUM', m.math('MULTIPLY', m.remap(wn, 0.6, 0.66), m.remap(wn, 0.72, 0.66)), m.math('MULTIPLY', m.remap(y, y0 + 0.4, y0), 0.8))
    mould = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(T.voronoi(230, 'Distance', off=5.0), 0.28, 0.06), m.math('MULTIPLY', mz, m.remap(T.noise(2.5, 4, off=11.0), 0.5, 0.7))), m.math('MULTIPLY', fade, V))
    col = m.mix(m.math('MULTIPLY', m.remap(mould, 0.0, 0.4), 0.35), col, m.mix(1.0, col, (0.6, 0.62, 0.55), 'MULTIPLY')); col = m.mix(mould, col, (0.025, 0.028, 0.022))
    jl = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(dj, 0.006, 0.0), m.remap(jn, 0.5, 0.62)), m.math('MULTIPLY', fade, V))
    col = m.mix(m.math('MULTIPLY', jl, 0.5), col, m.hsv(col, 0.5, 0.8, 0.6))
    return finish(m, col, rough, h)

def profile_x(prof, x0, x1):
    """a moulding run along x: prof [(y, z)...] anticlockwise seen from +x, from x0 to x1 (capped)"""
    bm = bmesh.new(); a = [bm.verts.new((x0, yy, zz)) for yy, zz in prof]; b = [bm.verts.new((x1, yy, zz)) for yy, zz in prof]
    n = len(prof); bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)                 # (outward, whichever way the profile ran)
    return bm

def wainscot(G, W, paint, top=0.93, pitch=0.75, stile=0.095, base=0.28, rail=(0.80, 0.885), fz=-0.012):
    """raised panels between stiles and rails: the frame's face on the wall plane (z 0) with paint-softened edges, the panels
       set back, their fields raised on bevelled margins, an ovolo sticking round each opening, a moulded cap at the rail height
       (the moulding js/arch.js sweeps sits on it)"""
    gp = lambda c, k=0: (c.x * 0.001 + k, c.z, c.y); gh = lambda c, k=0: (c.y * 0.001 + k, c.z, c.x)
    def add_box(sx, sy, sz, cx, cy, cz, grain, bev=0.005, segs=4):
        k = random.uniform(-50, 50); G.add(xform(box(sx, sy, sz, bev, segs), (cx, cy, cz)), paint, {'gpos': (lambda c, k=k: grain(c, k)), 'prand': random.random()})
    add_box(W + 0.02, base, 0.02, W / 2, base / 2, -0.01, gh)
    add_box(W + 0.02, rail[1] - rail[0], 0.02, W / 2, (rail[0] + rail[1]) / 2, -0.01, gh)
    for i in range(round(W / pitch)):
        x0 = i * pitch
        add_box(stile, rail[0] - base + 0.004, 0.02, x0, (base + rail[0]) / 2, -0.01, gp)
        a0, a1 = x0 + stile / 2 + 0.006, x0 + pitch - stile / 2 - 0.006; b0, b1 = base + 0.006, rail[0] - 0.006
        mg = 0.045; bm = bmesh.new()
        O = [bm.verts.new(v) for v in ((a0, b0, fz - 0.004), (a1, b0, fz - 0.004), (a1, b1, fz - 0.004), (a0, b1, fz - 0.004))]
        I = [bm.verts.new(v) for v in ((a0 + mg, b0 + mg, fz + 0.006), (a1 - mg, b0 + mg, fz + 0.006), (a1 - mg, b1 - mg, fz + 0.006), (a0 + mg, b1 - mg, fz + 0.006))]
        bm.faces.new(I)
        for k in range(4): bm.faces.new((O[k], O[(k + 1) % 4], I[(k + 1) % 4], I[k]))
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if all(v in I for v in e.verts)], offset=0.006, segments=3, affect='EDGES')
        k = random.uniform(-50, 50); G.add(bm, paint, {'gpos': (lambda c, k=k: gp(c, k)), 'prand': random.random()})
        for (sx, sy, cx, cy) in ((a1 - a0, 0.014, (a0 + a1) / 2, b0 + 0.004), (a1 - a0, 0.014, (a0 + a1) / 2, b1 - 0.004),
                                 (0.014, b1 - b0, a0 + 0.004, (b0 + b1) / 2), (0.014, b1 - b0, a1 - 0.004, (b0 + b1) / 2)):
            add_box(sx, sy, 0.012, cx, cy, -0.006, gh if sx > sy else gp, bev=0.0055, segs=5)
    # the cap: a fillet, an ovolo nosing and a cove under it, 14 mm proud
    prof = [(top - 0.032, -0.02), (top - 0.032, -0.002), (top - 0.024, 0.0), (top - 0.018, 0.002)]
    prof += [(top - 0.012 + 0.012 * math.sin(a), 0.002 + 0.012 * math.cos(a) * 0.95) for a in [math.radians(v) for v in range(-80, 91, 6)]]
    prof += [(top + 0.012, 0.006), (top + 0.022, 0.004), (top + 0.03, 0.0), (top + 0.03, -0.02)]
    k = random.uniform(-50, 50); G.add(profile_x(prof, -0.4, W + 0.4), paint, {'gpos': (lambda c, k=k: gh(c, k)), 'prand': random.random()}, wrap=False)
    G.add(grid(-0.4, W + 0.4, -0.1, top + 0.1, 2, 2, -0.02), flatmat('wainscot_back', (0.03, 0.025, 0.02), 0.9), {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False)

def plaster_grid(x0, x1, y0, y1, W, step=0.012, amp=0.0012, seed=0.0, H=3.0):
    """the paper's ground: lath-and-plaster that was never quite flat (periodic across the tile, and up it every H)"""
    nx = int(round((x1 - x0) / step)); ny = int(round((y1 - y0) / step)); bm = grid(x0, x1, y0, y1, nx, ny, 0.0)
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        v.co.z = amp * (pnoise(x, y, W, H, 1.1, seed) + 0.45 * pnoise(x, y, W, H, 3.5, seed + 3.3) + 0.15 * pnoise(x, y, W, H, 11.0, seed + 7.1))
    return bm

def wood_wall():
    """the nursery's wall: dusty-rose damask paper over a painted raised-panel wainscot, the cap at 0.93 m (B5's dado)"""
    W, H = TW, FH; top = float(TRIMS['wood']['dado']); G = Geo(W, H, wv=False)
    PAT = _pattern_image('damask', damask(1024))
    PAPER = paper_mat('wood_paper', W, H, PAT, y0=top)
    PAINT = paint_mat('wood_wainscot', W, H, '#cabb9b', '#5f6d52', '#8a5a3c', '#9c774c', wv=False, chips=1.3, scuff=0.45, stain=1.0, age=1.4)
    G.add(plaster_grid(-0.4, W + 0.4, top - 0.01, H + 0.3, W, seed=2.0), PAPER, {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False, smooth=True)
    wainscot(G, W, PAINT, top)
    return {'geo': G.build('wood_wall'), 'W': W, 'H': H, 'variants': 2, 'wv': False, 'ao': 0.12, 'cav': 0.012, 'pom': 0.03,
            'heights': {'dado': top, 'skirting': TRIMS['wood']['skirting']['h'], 'panels': [0.31, 0.79], 'paper_from': top},
            'notes': 'damask paper over raised-panel wainscot, cap rail baked at the dado height; B: a water bloom from above, mould, lifting joints'}

def border_print(px=512):
    """the border course's transfer print (one square tile; two side by side): a ruled frame, a lozenge with a quatrefoil
       flower in it, leaves in the corners; 1 = ink"""
    from PIL import Image, ImageDraw, ImageFilter
    S = 4; N = px * S; im = Image.new('L', (N, N), 0); d = ImageDraw.Draw(im)
    def P(x, y): return (x * N, y * N)
    w = int(N * 0.018)
    d.rectangle([P(0.06, 0.06), P(0.94, 0.94)], outline=255, width=w); d.rectangle([P(0.1, 0.1), P(0.9, 0.9)], outline=255, width=max(2, w // 2))
    d.polygon([P(0.5, 0.16), P(0.84, 0.5), P(0.5, 0.84), P(0.16, 0.5)], outline=255, width=w)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4; ox, oy = 0.5 + math.cos(a) * 0.1, 0.5 + math.sin(a) * 0.1
        d.ellipse([P(ox - 0.085, oy - 0.085), P(ox + 0.085, oy + 0.085)], fill=255)
        d.ellipse([P(ox - 0.045, oy - 0.045), P(ox + 0.045, oy + 0.045)], fill=0)
    d.ellipse([P(0.44, 0.44), P(0.56, 0.56)], fill=255); d.ellipse([P(0.475, 0.475), P(0.525, 0.525)], fill=0)
    for (cx, cy, a0) in ((0.1, 0.1, 45), (0.9, 0.1, 135), (0.9, 0.9, 225), (0.1, 0.9, 315)):
        for dd in (-28, 0, 28):
            a = math.radians(a0 + dd); L = 0.14 if dd == 0 else 0.1
            tip = (cx + math.cos(a) * L, cy + math.sin(a) * L); sd = (math.cos(a + math.pi / 2) * 0.025, math.sin(a + math.pi / 2) * 0.025)
            mid = (cx + math.cos(a) * L * 0.5, cy + math.sin(a) * L * 0.5)
            d.polygon([P(cx, cy), P(mid[0] + sd[0], mid[1] + sd[1]), P(*tip), P(mid[0] - sd[0], mid[1] - sd[1])], fill=255)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(S * 0.9)).resize((px, px), Image.LANCZOS), np.float32) / 255
    return np.concatenate([a, a], axis=1)

def glaze_mat(name, W, H, green='#1d4636', cream='#cdbd98', printc='#3d2a1c', cap='#173a2c', body='#e6dfd2', grout='#6e685e', wv=False):
    """Victorian glazed wall tiles: bottle-green field tiles, each its own shade, the glaze pooled dark in the middle and
       thinned pale over the cushioned edges, a crazing network with dirt in it, a few corners chipped to the white body
       ('chip': which corner) and one or two cracked; a cream border course transfer-printed in brown ('kind' 1); a moulded
       green capping ('kind' 2); glossy, wavy enough to waver the reflections; dirty fine joints (the cavity). Variant B:
       salt bloom along the joints, dirtier."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); g = m.attr('gpos', True); pr = m.attr('prand'); kind = m.attr('kind'); lp = m.attr('lpos', True)
    chip = m.attr('chip'); crk = m.attr('crack'); V = variant(m)
    lx, ly, _ = sep(m, lp); cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    pr2 = m.math('FRACT', m.math('MULTIPLY', pr, 7.31)); pr3 = m.math('FRACT', m.math('MULTIPLY', pr, 13.7))
    isb = m.remap(kind, 0.5, 0.6); isc = m.remap(kind, 1.5, 1.6); isb = m.math('SUBTRACT', isb, isc)
    # glaze colour: each tile its own firing, pooled darker toward the middle, thin and pale on the cushion edges
    gcol = m.hsv(m.mix(0.0, lin(green), lin(green)), m.remap(pr, 0, 1, 0.49, 0.51), m.remap(pr3, 0, 1, 0.85, 1.12), m.remap(pr2, 0, 1, 0.8, 1.2))
    mid = m.math('SUBTRACT', 1.0, m.math('MAXIMUM', m.math('ABSOLUTE', lx), m.math('ABSOLUTE', ly)))
    gcol = m.mix(m.remap(mid, 0.5, 0.9, 0.0, 0.35), gcol, m.hsv(gcol, 0.5, 1.15, 0.78))
    cl = noise3(m, vmul(m, g, (18, 18, 18)), 1.0, 4, 0.6); gcol = m.mix(m.remap(cl, 0.3, 0.7, 0.0, 0.3), gcol, m.hsv(gcol, 0.5, 1.1, 0.8))
    bcol = m.mix(m.remap(noise3(m, vmul(m, g, (25, 25, 25)), 1.0, 3), 0.3, 0.7, 0.0, 0.2), lin(cream), m.mix(1.0, lin(cream), (0.9, 0.86, 0.78), 'MULTIPLY'))
    bp = m.n('ShaderNodeTexImage', interpolation='Cubic', extension='REPEAT'); bp.image = bpy.data.images['tile_border']
    m.l(comb(m, m.math('ADD', m.math('MULTIPLY', lx, 0.5), 0.25), m.math('ADD', ly, 0.5), 0.0), bp.inputs['Vector'])
    ink = m.math('MULTIPLY', sep(m, bp.outputs['Color'])[0], m.remap(noise3(m, vmul(m, g, (60, 60, 60)), 1.0, 3), 0.3, 0.7, 0.7, 1.0))
    bcol = m.mix(ink, bcol, lin(printc))
    col = m.mix(isb, gcol, bcol); col = m.mix(isc, col, m.hsv(m.mix(0.0, lin(cap), lin(cap)), m.remap(pr, 0, 1, 0.49, 0.51), 1.0, m.remap(pr2, 0, 1, 0.85, 1.15)))
    thin = m.math('MULTIPLY', edge, 0.75)
    col = m.mix(thin, col, m.mix(0.4, m.hsv(col, 0.5, 0.7, 1.6), lin(body)))
    # crazing: a fine network of cracks in the glaze, dirt in them
    cz = m.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (70, 70, 70)), cz.inputs['Vector'])
    craze = m.math('MULTIPLY', m.remap(m.math('DIVIDE', cz.outputs['Distance'], 70.0), 0.00045, 0.0), m.remap(noise3(m, vmul(m, g, (4, 4, 4)), 1.0, 2), 0.35, 0.6, 0.3, 1.0))
    col = m.mix(m.math('MULTIPLY', craze, 0.7), col, m.hsv(col, 0.5, 1.0, 0.45)); h = m.math('MULTIPLY', craze, -0.00005)
    # chipped corners to the white body; cracks across a tile or two
    cxs = m.math('SUBTRACT', m.math('MULTIPLY', m.remap(chip, 0.5, 2.5, 0.0, 1.0), 2.0), 1.0)
    sx_ = m.math('SIGN', m.math('SUBTRACT', m.math('FRACT', m.math('MULTIPLY', chip, 0.5)), 0.25))
    dc = m.math('ADD', m.math('SUBTRACT', 0.5, m.math('MULTIPLY', lx, sx_)), m.math('SUBTRACT', 0.5, m.math('MULTIPLY', ly, m.math('SIGN', m.math('SUBTRACT', chip, 2.5)))))
    cn = noise3(m, vmul(m, g, (90, 90, 90)), 1.0, 4, 0.6)
    chipm = m.math('MULTIPLY', m.remap(m.math('ADD', dc, m.math('MULTIPLY', m.math('SUBTRACT', cn, 0.5), 0.12)), 0.14, 0.11), m.remap(chip, 0.5, 0.6))
    col = m.mix(chipm, col, m.mix(m.remap(cn, 0.3, 0.7), lin(body), m.mix(1.0, lin(body), (0.8, 0.76, 0.7), 'MULTIPLY')))
    h = m.math('SUBTRACT', h, m.math('MULTIPLY', chipm, 0.0012))
    ckl = ridge(m, comb(m, m.math('ADD', lx, m.math('MULTIPLY', ly, 0.4)), ly, m.math('MULTIPLY', pr, 50.0)), 3.0, 4, 0.55, 300.0)
    crack = m.math('MULTIPLY', ckl, crk); col = m.mix(crack, col, (0.03, 0.03, 0.025)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', crack, 0.0004))
    rough = m.math('ADD', m.remap(T.noise(2.0, 3), 0.3, 0.7, 0.05, 0.13), m.math('MULTIPLY', isb, 0.04))
    rough = m.mixf(chipm, rough, 0.75); rough = m.mixf(craze, rough, 0.4)
    # dirt: the joints (cavity), a film thicker low down, B's salt bloom along the joints
    gr = m.math('MULTIPLY', m.remap(cav, 0.95, 0.5, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.6), col, m.mix(0.5, lin(grout), (0.06, 0.055, 0.05)))
    film = m.math('ADD', m.remap(T.y, 0.5, 0.0, 0.0, 0.35), m.remap(T.noise(1.5, 4, off=4.0), 0.4, 0.8, 0.0, 0.3))
    col = m.mix(film, col, m.hsv(col, 0.5, 0.8, 0.82)); rough = m.mixf(m.math('MULTIPLY', film, 0.5), rough, 0.4)
    salt = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(cav, 0.9, 0.6), m.remap(T.noise(20, 4, off=7.0), 0.45, 0.7)), m.math('MULTIPLY', V, edge_fade(m, W, H, 0.1, 0.3, T, wv=False)))
    col = m.mix(m.math('MULTIPLY', salt, 0.8), col, lin('#d8d4ca')); rough = m.mixf(salt, rough, 0.9)
    return finish(m, col, rough, h)

def tile_wall():
    """the hall's wall: a dado of bottle-green glazed tiles to the 0.87 m rail (four courses of 0.15 m squares, a cream
       transfer-printed border course, one more course, a moulded capping under the rail), Pompeian-red damask above"""
    W, H = TW, FH; top = float(TRIMS['tile']['dado']); G = Geo(W, H, wv=False); s = W / 15
    _pattern_image('tile_border', border_print(512))
    GL = glaze_mat('tile_glaze', W, H); GRT = grout_mat('tile_wgrout', W, H, '#6f695f', '#2e2a25')
    PAT = _pattern_image('damask_red', damask(1024, seed=11))
    PAPER = paper_mat('tile_paper', W, H, PAT, ground='#68271f', ink='#561e18', pool='#3e1410', line='#6f2e25', y0=top)
    rows = [(0.0, s, 0), (s, 2 * s, 0), (2 * s, 3 * s, 0), (3 * s, 4 * s, 0), (4 * s, 5 * s, 1), (5 * s, 5.5 * s, 0)]
    for (y0, y1, kind) in rows:
        for i in range(15):
            a = s - random.uniform(0.0015, 0.0022); b_ = (y1 - y0) - random.uniform(0.0015, 0.0022); t = 0.01
            bm = box(a, b_, t, 0.0032, 5)
            cuts(bm, 0, [-a / 2 + a * k / 5 for k in range(1, 5)]); cuts(bm, 1, [-b_ / 2 + b_ * k / 5 for k in range(1, 5)])
            dome = random.uniform(0.0002, 0.0006)
            deform(bm, lambda c, a=a, b_=b_, dome=dome: (c.x, c.y, c.z + (dome * (1 - (2 * c.x / a) ** 2) * (1 - (2 * c.y / b_) ** 2) if c.z > 0 else 0.0)))
            cx, cy = (i + 0.5) * s + random.gauss(0, 0.0004), (y0 + y1) / 2 + random.gauss(0, 0.0003)
            xform(bm, (cx, cy, -t / 2 + random.gauss(0, 0.0003)), (random.gauss(0, 0.0025), random.gauss(0, 0.0025), random.gauss(0, 0.002)))
            off = Vector((random.uniform(-40, 40), random.uniform(-40, 40), random.uniform(-40, 40)))
            G.add(bm, GL, {'gpos': (lambda c, cx=cx, cy=cy, off=off: (c.x - cx + off.x, c.y - cy + off.y, off.z)),
                           'lpos': (lambda c, cx=cx, cy=cy, a=a, b_=b_: ((c.x - cx) / a, (c.y - cy) / b_, 0.0)),
                           'prand': random.random(), 'kind': float(kind), 'chip': float(random.randint(1, 4)) if random.random() < 0.08 else 0.0,
                           'crack': 1.0 if random.random() < 0.03 else 0.0})
    # the capping: a moulded rail tile (fillet, torus, cove), 18 mm proud, under the rail js/arch.js sweeps at the dado height
    c0 = 5.5 * s; prof = [(c0 + 0.001, -0.01), (c0 + 0.001, 0.002), (c0 + 0.008, 0.004)]
    prof += [(top - 0.004 + 0.022 * math.sin(a), 0.004 + 0.014 * math.cos(a)) for a in [math.radians(v) for v in range(-80, 91, 6)]]
    prof += [(top + 0.026, 0.005), (top + 0.034, 0.0), (top + 0.034, -0.01)]
    for i in range(15):
        x0, x1 = i * s + 0.0009, (i + 1) * s - 0.0009; off = Vector((random.uniform(-40, 40), random.uniform(-40, 40), 0))
        G.add(profile_x(prof, x0, x1), GL, {'gpos': (lambda c, off=off: (c.x + off.x, c.y + off.y, off.z)), 'lpos': (0, 0, 0), 'prand': random.random(), 'kind': 2.0, 'chip': 0.0, 'crack': 0.0})
    G.add(grid(-0.4, W + 0.4, -0.1, top + 0.08, 2, 2, -0.0035), GRT, {'gpos': (0, 0, 0), 'lpos': (0, 0, 0), 'prand': 0.5, 'kind': 0.0, 'chip': 0.0, 'crack': 0.0}, wrap=False)
    G.add(plaster_grid(-0.4, W + 0.4, top + 0.03, H + 0.3, W, seed=5.0), PAPER, {'gpos': (0, 0, 0), 'lpos': (0, 0, 0), 'prand': 0.5, 'kind': 0.0, 'chip': 0.0, 'crack': 0.0}, wrap=False, smooth=True)
    return {'geo': G.build('tile_wall'), 'W': W, 'H': H, 'variants': 2, 'wv': False, 'ao': 0.12, 'cav': 0.008, 'pom': 0.02,
            'heights': {'dado': top, 'skirting': TRIMS['tile']['skirting']['h'], 'border': [4 * s, 5 * s], 'capping': [5.5 * s, top + 0.034], 'paper_from': top + 0.03},
            'notes': 'bottle-green glazed tile dado with a transfer-printed border and moulded capping at the dado height, red damask above; B: water on the paper, salt on the tiles'}

def brick_mat(name, W, H, reds=('#743c2b', '#663427', '#80472f', '#5a3329', '#463029', '#8a5638'), wv=False, wash=0.0, damp=True):
    """old handmade clamp bricks: each brick its own firing (reds, browns, purples, a few overburnt near black, a pale
       replacement now and then), sandy, creased from the mould, frost-spalled faces with pits, edges worn; rising damp
       darkening the wall up to about 0.8 m with a white salt tide line above it and green algae at the foot. Variant B:
       limewash over it all, thin on the arrises, flaking off in patches to the brick."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); g = m.attr('gpos', True); pr = m.attr('prand'); V = variant(m)
    cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H); y = T.y
    pr2 = m.math('FRACT', m.math('MULTIPLY', pr, 7.31)); pr3 = m.math('FRACT', m.math('MULTIPLY', pr, 13.7))
    col = m.mix(m.remap(pr, 0.0, 0.33), lin(reds[0]), lin(reds[1])); col = m.mix(m.remap(pr, 0.33, 0.66), col, lin(reds[2]))
    col = m.mix(m.remap(pr, 0.66, 1.0), col, lin(reds[3])); col = m.mix(m.remap(pr2, 0.86, 0.9), col, lin(reds[4])); col = m.mix(m.remap(pr3, 0.93, 0.95), col, lin(reds[5]))
    col = m.hsv(col, 0.5, m.remap(pr3, 0, 1, 0.85, 1.12), m.remap(pr2, 0, 1, 0.82, 1.15))
    fl = noise3(m, vmul(m, g, (9, 9, 9)), 1.0, 4, 0.6); col = m.mix(m.remap(fl, 0.3, 0.7, 0.0, 0.5), col, m.hsv(col, 0.5, 1.1, 0.68))   # (fire flashing)
    sand = noise3(m, vmul(m, g, (500, 500, 500)), 1.0, 2, 0.5); sand2 = noise3(m, vmul(m, g, (140, 140, 140)), 1.0, 3, 0.6)
    col = m.mix(m.remap(sand, 0.25, 0.75), m.hsv(col, 0.5, 1.0, 0.85), m.hsv(col, 0.5, 0.9, 1.15)); col = m.mix(m.remap(sand2, 0.3, 0.7, 0.0, 0.3), col, m.hsv(col, 0.5, 1.0, 0.82))
    gv = m.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=1.0); m.l(vmul(m, g, (260, 260, 260)), gv.inputs['Vector'])
    grit = m.math('MULTIPLY', m.remap(gv.outputs['Distance'], 0.25, 0.08), m.remap(sep(m, gv.outputs['Color'])[0], 0.7, 0.9))
    col = m.mix(m.math('MULTIPLY', grit, 0.6), col, m.hsv(col, 0.5, 0.5, 1.6))                       # (pale grit in the clay)
    crease = lines3(m, g, 6.0, 0.02, 2.0, 0.3)                                                       # (mould creases)
    col = m.mix(m.math('MULTIPLY', crease, 0.25), col, m.hsv(col, 0.5, 1.0, 0.7))
    h = m.math('ADD', m.math('MULTIPLY', sand, 0.0001), m.math('ADD', m.math('MULTIPLY', sand2, 0.00025), m.math('MULTIPLY', crease, -0.0003)))
    rough = m.remap(sand2, 0.3, 0.7, 0.82, 0.95)
    # worn arrises a little paler; soot and grime in every hollow (the spalls, the mortar recess)
    col = m.mix(m.math('MULTIPLY', edge, 0.3), col, m.hsv(col, 0.5, 0.85, 1.2))
    gr = m.math('MULTIPLY', m.remap(cav, 0.95, 0.4, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0))
    col = m.mix(m.math('MULTIPLY', gr, 0.7), col, (0.04, 0.035, 0.03))
    col = m.mix(m.remap(T.noise(1.3, 4, 0.6, off=9.0), 0.35, 0.85, 0.15, 0.65), col, m.hsv(col, 0.5, 0.75, 0.62))   # (a century of cellar grime and coal smoke)
    col = m.mix(m.remap(T.noise(5, 4, 0.6, off=10.0), 0.45, 0.8, 0.0, 0.35), col, m.hsv(col, 0.5, 0.8, 0.7))
    # rising damp, its salt tide line, algae at the foot
    dl = m.math('ADD', 0.78, m.math('ADD', m.math('MULTIPLY', m.math('SUBTRACT', T.noise(0.9, 3, 0.5, off=3.0), 0.5), 0.9), m.math('MULTIPLY', m.math('SUBTRACT', T.noise(4.0, 3, off=4.0), 0.5), 0.2)))
    wet = m.math('MULTIPLY', m.remap(m.math('SUBTRACT', y, dl), 0.05, -0.15, smooth=True), 1.0 if damp else 0.0)
    col = m.mix(m.math('MULTIPLY', wet, 0.8), col, m.mix(1.0, col, (0.45, 0.45, 0.47), 'MULTIPLY')); rough = m.mixf(m.math('MULTIPLY', wet, 0.4), rough, 0.6)
    tdl = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(m.math('SUBTRACT', y, dl), 0.0, 0.035), m.remap(m.math('SUBTRACT', y, dl), 0.13, 0.035)), 1.0 if damp else 0.0)
    salt = m.math('MULTIPLY', tdl, m.math('MULTIPLY', m.remap(T.noise(30, 5, 0.65, off=6.0), 0.45, 0.75), m.remap(T.noise(3, 3, off=16.0), 0.3, 0.7, 0.2, 1.0)))
    salt = m.math('MAXIMUM', salt, m.math('MULTIPLY', m.math('MULTIPLY', m.remap(cav, 0.9, 0.6), tdl), 0.22))
    salt = m.math('ADD', salt, m.math('MULTIPLY', m.math('MULTIPLY', wet, m.remap(T.noise(45, 4, off=26.0), 0.62, 0.78)), 0.6))   # (crust spots in the damp)
    col = m.mix(m.math('MULTIPLY', salt, 0.7), col, lin('#d2cec3')); rough = m.mixf(salt, rough, 0.95); h = m.math('ADD', h, m.math('MULTIPLY', salt, 0.0002))
    alg = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(y, 0.35, 0.0, smooth=True), m.remap(T.noise(4, 4, 0.6, off=12.0), 0.45, 0.75)), 1.0 if damp else 0.0)
    col = m.mix(m.math('MULTIPLY', alg, 0.6), col, m.mix(0.5, col, lin('#3c4a2a')))
    # B: limewash, thin on the arrises, flaking in patches
    lw_ = m.mix(m.remap(T.noise(8, 4, off=31.0), 0.3, 0.7), lin('#cdc8bb'), lin('#b5ad9c'))
    lw_ = m.mix(m.remap(T.noise(1.5, 4, 0.6, off=32.0), 0.35, 0.8, 0.1, 0.55), lw_, m.hsv(lw_, 0.5, 1.2, 0.72))   # (grimed)
    lw_ = m.mix(m.math('MULTIPLY', wet, 0.5), lw_, m.mix(1.0, lw_, (0.72, 0.72, 0.68), 'MULTIPLY'))           # (the damp greys it)
    lw_ = m.mix(m.math('MULTIPLY', gr, 0.6), lw_, m.hsv(lw_, 0.5, 1.0, 0.55))
    fk = m.math('ADD', T.noise(9, 5, 0.65, off=33.0), m.math('MULTIPLY', m.remap(y, 1.2, 0.0), 0.25 if damp else 0.0))   # (more flaking low down: not on a band that repeats)
    if not wash:
        fk = m.math('ADD', fk, m.math('MULTIPLY', m.math('SUBTRACT', 1.0, edge_fade(m, W, H, 0.04, 0.7, T, wv=False)), 0.6))   # (off the tile's edges in flakes, not a fade)
        fk = m.math('ADD', fk, m.math('MULTIPLY', m.math('SUBTRACT', T.noise(0.9, 3, 0.5, off=35.0), 0.5), 0.5))                # (the remains of an old wash, in big patches)
    keepw = m.remap(fk, 0.62, 0.58, smooth=True)                                                    # (1 where the wash still holds)
    thin = m.math('MULTIPLY', edge, 0.6)
    cover = m.math('MULTIPLY', m.math('MULTIPLY', keepw, m.math('SUBTRACT', 1.0, thin)), m.val(wash) if wash else m.math('MULTIPLY', V, edge_fade(m, W, H, 0.0, 0.03, T, wv=False)))
    col = m.mix(m.math('MULTIPLY', cover, 0.92), col, lw_); rough = m.mixf(cover, rough, 0.92)
    col = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', m.remap(fk, 0.6, 0.57), m.remap(fk, 0.54, 0.57)), m.val(wash) if wash else V), col, m.hsv(col, 0.5, 1.0, 0.6))   # (the flake's edge)
    return finish(m, col, rough, h)

def mortar_mat(name, W, H, col='#7d7466', cement='#6f6d68', wv=False, wash=0.0, damp=True):
    """old lime mortar, recessed and crumbling, sandy; a stretch of grey cement repointing; damp and salt as the bricks;
       B: limewashed"""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); V = variant(m); y = T.y; cav = look(m, 'CAV', W, H)
    sand = T.noise(500, 3, 0.6); lump = T.noise(60, 4, 0.6)
    c = m.mix(m.remap(lump, 0.3, 0.7), lin(col), m.mix(1.0, lin(col), (0.8, 0.78, 0.74), 'MULTIPLY')); c = m.mix(m.remap(sand, 0.3, 0.7, 0.0, 0.3), c, m.hsv(c, 0.5, 1.0, 1.25))
    rep = m.remap(T.noise(0.9, 3, off=44.0), 0.62, 0.66); c = m.mix(rep, c, lin(cement))
    c = m.mix(m.remap(cav, 0.9, 0.4), c, m.hsv(c, 0.5, 1.0, 0.45))
    dl = m.math('ADD', 0.78, m.math('ADD', m.math('MULTIPLY', m.math('SUBTRACT', T.noise(0.9, 3, 0.5, off=3.0), 0.5), 0.9), m.math('MULTIPLY', m.math('SUBTRACT', T.noise(4.0, 3, off=4.0), 0.5), 0.2)))
    wet = m.math('MULTIPLY', m.remap(m.math('SUBTRACT', y, dl), 0.05, -0.15, smooth=True), 1.0 if damp else 0.0)
    c = m.mix(m.math('MULTIPLY', wet, 0.7), c, m.mix(1.0, c, (0.55, 0.55, 0.57), 'MULTIPLY'))
    salt = m.math('MULTIPLY', m.math('MULTIPLY', m.math('MULTIPLY', m.remap(m.math('SUBTRACT', y, dl), 0.0, 0.04), m.remap(m.math('SUBTRACT', y, dl), 0.18, 0.04)), m.remap(T.noise(30, 4, off=6.0), 0.3, 0.6)), 1.0 if damp else 0.0)
    c = m.mix(salt, c, lin('#e0dcd2'))
    c = m.mix(m.remap(T.noise(1.3, 4, 0.6, off=9.0), 0.35, 0.85, 0.15, 0.6), c, m.hsv(c, 0.5, 0.8, 0.6))
    fk = m.math('ADD', m.math('ADD', T.noise(9, 5, 0.65, off=33.0), m.math('MULTIPLY', m.remap(y, 1.2, 0.0), 0.25)), m.math('MULTIPLY', m.math('SUBTRACT', 1.0, edge_fade(m, W, H, 0.04, 0.7, T, wv=False)), 0.6))
    fk = m.math('ADD', fk, m.math('MULTIPLY', m.math('SUBTRACT', T.noise(0.9, 3, 0.5, off=35.0), 0.5), 0.5))
    if wash: fk = m.math('ADD', T.noise(9, 5, 0.65, off=33.0), 0.0)
    c = m.mix(m.math('MULTIPLY', m.remap(fk, 0.66, 0.6), m.val(wash) if wash else m.math('MULTIPLY', V, edge_fade(m, W, H, 0.0, 0.03, T, wv=False))), c, m.mix(0.8, c, lin('#c4bead')))
    h = m.math('ADD', m.math('MULTIPLY', sand, 0.0003), m.math('MULTIPLY', lump, 0.0012))
    return finish(m, c, m.mixf(rep, 0.95, 0.85), h)

def brick_bm(L, Hh, D, seed, spall=0.0):
    """a handmade brick, its face toward +z: wavy faces and arrises, a soft bevel, and on a frost-damaged one a spalled face"""
    bm = box(L, Hh, D, random.uniform(0.003, 0.007), 3)
    cuts(bm, 0, [-L / 2 + L * k / 12 for k in range(1, 12)]); cuts(bm, 1, [-Hh / 2 + Hh * k / 4 for k in range(1, 4)])
    s1, s2 = random.uniform(0, 50), random.uniform(0, 50)
    def f(c):
        nz = mnoise.noise(Vector((c.x * 25 + s1, c.y * 25, s2))) * 0.002 + mnoise.noise(Vector((c.x * 80, c.y * 80 + s1, s2))) * 0.0006
        z = c.z + (nz if c.z > 0 else 0.0)
        x = c.x + mnoise.noise(Vector((c.y * 20 + s2, s1, c.z * 20))) * 0.001
        y = c.y + mnoise.noise(Vector((c.x * 20 + s1, s2, c.z * 20))) * 0.0008
        if spall and c.z > 0:
            sp = mnoise.noise(Vector((c.x * 25 + s2, c.y * 25 + s1, 0.0))) + 0.4 * mnoise.noise(Vector((c.x * 70, c.y * 70, s1)))
            if sp > 0.2: z -= (sp - 0.2) * spall
        return (x, y, z)
    return deform(bm, f)

def concrete_wall():
    """the cellar's wall: English bond (courses of stretchers and of headers), handmade bricks in recessed lime mortar, rising
       damp with its salt line; B: limewashed and flaking"""
    W, H = TW, FH; G = Geo(W, H, wv=False); ch = H / 40; jt = 0.010
    BR = brick_mat('concrete_brick', W, H); MO = mortar_mat('concrete_mortar', W, H)
    for r in range(-1, 41):
        y0 = r * ch; header = (r % 2 == 1); pitch = W / 20 if header else W / 10; off = pitch / 2 if header else 0.0   # (English bond: header joints over the stretchers' middles and joints)
        n = int(round(W / pitch))
        for i in range(n):
            x0 = i * pitch + off; L = pitch - jt - random.uniform(-0.002, 0.007); Hh = ch - jt - random.uniform(-0.001, 0.005)
            spall = random.choice((0.0, 0.0, 0.0, 0.0, random.uniform(0.004, 0.012)))
            bm = brick_bm(L, Hh, 0.06, i * 31 + r, spall)
            cx, cy = x0 + pitch / 2 + random.gauss(0, 0.002), y0 + ch / 2 + random.gauss(0, 0.0015)
            xform(bm, (cx, cy, -0.03 + random.gauss(0, 0.002)), (random.gauss(0, 0.01), random.gauss(0, 0.01), random.gauss(0, 0.009)))
            off3 = Vector((random.uniform(-40, 40), random.uniform(-40, 40), random.uniform(-40, 40)))
            G.add(bm, BR, {'gpos': (lambda c, cx=cx, cy=cy, o=off3: (c.x - cx + o.x, c.y - cy + o.y, c.z + o.z)), 'prand': random.random()})
    G.add(xform(plaster_grid(-0.4, W + 0.4, -0.1, H + 0.3, W, step=0.01, amp=0.0015, seed=9.0), (0, 0, -0.009)), MO, {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False)
    # (the mortar bed sits 9 mm back from the brick faces)
    return {'geo': G.build('concrete_wall'), 'W': W, 'H': H, 'variants': 2, 'wv': False, 'ao': 0.12, 'cav': 0.015, 'pom': 0.02,
            'heights': {'skirting': TRIMS['concrete']['skirting']['h'], 'courses': 40, 'course_m': ch, 'damp_m': 0.78},
            'notes': 'English bond handmade brick, recessed lime mortar, rising damp to ~0.8 m with a salt line; B: limewashed, flaking'}

def vboard(x, wb, y0, y1, t, cup=0.0008, bevel=0.0015, waney=0, seed=0.0):
    """a vertical board from y0 to y1, face at z 0, cupped across its width, an edge waney (bark side: -1 left, 1 right)"""
    L = y1 - y0; bm = box(wb, L, t, bevel, 2)
    cuts(bm, 0, [-wb / 2 + wb * k / 10 for k in range(1, 10)]); k = max(2, round(L / 0.06)); cuts(bm, 1, [-L / 2 + L * i / k for i in range(1, k)])
    def f(c):
        z = c.z + (cup * ((2 * c.x / wb) ** 2) - cup if c.z > 0 else 0.0); xx = c.x
        if waney and c.x * waney > wb * 0.3:
            n = mnoise.noise(Vector((c.y * 6 + seed, seed, 0))) * 0.5 + 0.5
            xx = c.x - waney * n * 0.018 * ((c.x * waney - wb * 0.3) / (wb * 0.2)); z -= n * 0.004 * ((c.x * waney - wb * 0.3) / (wb * 0.2))
        return (xx, c.y, z)
    deform(bm, f)
    return xform(bm, (x, (y0 + y1) / 2, -t / 2))

def attic_wall():
    """the attic's wall: vertical rough-sawn pine boards of uneven width, butted with gaps, nailed to rails at 0.45, 1.5 and
       2.6 m (the rust runs down from every nail), a few joined part way up, one or two with a waney edge"""
    W, H = TW, FH; G = Geo(W, H, wv=False); t = 0.022; rows = (0.45, 1.5, 2.6)
    P = pine_mat('attic_wall', W, H, early='#78664f', late='#4f3e2c', dusty=0.12, nails=False, wall_rows=rows, wv=False, sawn=1.0, fig=0.6)
    IR = iron_mat('attic_wnail', W, H); VOID = flatmat('attic_void', (0.012, 0.01, 0.009), 0.95)
    widths = split_widths(W, 12, 0.14, 0.24); x = 0.0
    for wbd in widths:
        gap = random.uniform(0.002, 0.008); wb = wbd - gap; xc = x + wbd / 2
        pieces = [(-0.3, H + 0.3)]
        if random.random() < 0.3:
            j = random.uniform(1.0, 2.3); pieces = [(-0.3, j - 0.0015), (j + 0.0015, H + 0.3)]
        for (y0, y1) in pieces:
            wan = random.choice((0, 0, 0, 0, 0, 0, -1, 1)); sd = random.uniform(0, 50)
            bm = vboard(xc, wb, y0, y1, t, random.uniform(0.0004, 0.0015), random.uniform(0.001, 0.0025), wan, sd)
            tilt = random.gauss(0, 0.002); dz = random.gauss(0, 0.0006)
            bm = deform(bm, lambda c, xc=xc, tilt=tilt, dz=dz: (c.x, c.y, c.z + dz + (c.x - xc) * tilt))
            yc = (y0 + y1) / 2; L = y1 - y0
            qsn = 1.0 if random.random() < 0.15 else 0.0; d0 = random.uniform(0.1, 0.3); o3 = (random.uniform(-0.02, 0.02), random.uniform(-90, 90))
            tl = math.tan(math.radians(random.uniform(0.15, 1.0))) * random.choice((-1, 1))
            if qsn: gp = lambda c, xc=xc, yc=yc, d0=d0, o=o3, tl=tl: (d0 + (c.x - xc), c.z * 3 + (c.y - yc) * tl * 0.3, c.y - yc + o[1])
            else: gp = lambda c, xc=xc, yc=yc, d0=d0, o=o3, tl=tl: (c.x - xc + o[0], d0 + c.z + (c.y - yc) * tl, c.y - yc + o[1])
            G.add(bm, P, {'gpos': gp, 'prand': random.random(), 'qs': qsn, 'bL': L, 'bw': wb, 'spl': random.uniform(-0.6, 0.6) if random.random() < 0.3 else 9.0,
                          'bx': (lambda c, xc=xc, wb=wb: (c.x - xc) / (wb / 2)), 'bl': (lambda c, yc=yc: c.y - yc)})
        for ry in rows:
            for sgn in (-1, 1):
                nb = box(0.0038, 0.005, 0.004, 0.0004, 1)
                xform(nb, (xc + sgn * 0.6 * wb / 2 + random.gauss(0, 0.001), ry + random.gauss(0, 0.002), -0.0025 + random.choice((0.0, 0.0, 0.0006))), (0, 0, random.uniform(-0.3, 0.3)))
                G.add(nb, IR, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'bL': 1.0, 'bw': 0.2, 'spl': 9.0, 'bx': 0.0, 'bl': 0.0})
        x += wbd
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -0.03), VOID, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'bL': 1.0, 'bw': 0.2, 'spl': 9.0, 'bx': 0.0, 'bl': 0.0}, wrap=False)
    return {'geo': G.build('attic_wall'), 'W': W, 'H': H, 'variants': 2, 'wv': False, 'ao': 0.12, 'cav': 0.012, 'pom': 0.012,
            'heights': {'skirting': TRIMS['attic']['skirting']['h'], 'nail_rows': list(rows)},
            'notes': 'vertical rough-sawn pine boarding, nailed to rails at 0.45 / 1.5 / 2.6 m; B: roof-leak streaks and mould'}

def distemper_mat(name, W, H, col='#b9b19c', plaster='#a89b88', repair='#c9c2b0', wv=False, y_from=0.0, grime_band=(0.85, 1.5), ceiling=False):
    """lime plaster in tired distemper: broad brush marks, patchy, a few repairs in fresher plaster, map cracking and two or
       three long cracks with their edges spalled, plugged and open fixing holes, the distemper flaking in places to the
       plaster, grimy and oily round bench height, sooted toward the ceiling. Variant B: damp patches, heavy flaking, mould."""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); V = variant(m); x, y = T.x, T.y; cav = look(m, 'CAV', W, H)
    c = lin(col)
    bm_ = noise3(m, comb(m, m.math('MULTIPLY', x, 3.0), m.math('MULTIPLY', y, 9.0), 0.0), 1.0, 3, 0.55)          # (broad brush strokes, mostly across)
    col_ = m.mix(m.remap(T.noise(1.4, 4, 0.55), 0.3, 0.75), c, m.mix(1.0, c, (0.86, 0.84, 0.78), 'MULTIPLY'))
    col_ = m.mix(m.remap(bm_, 0.3, 0.7, 0.0, 0.18), col_, m.hsv(col_, 0.5, 1.0, 0.9))
    sand = T.noise(500, 3, 0.6); col_ = m.mix(m.remap(sand, 0.3, 0.7, 0.0, 0.12), col_, m.hsv(col_, 0.5, 1.0, 0.9))
    h = m.math('ADD', m.math('MULTIPLY', sand, 0.00012), m.math('MULTIPLY', bm_, 0.00008))
    rough = m.remap(sand, 0.3, 0.7, 0.85, 0.96)
    rp = T.noise(0.9, 3, 0.5, off=41.0); rep = m.remap(rp, 0.64, 0.66)                                    # (repairs)
    col_ = m.mix(rep, col_, m.mix(m.remap(T.noise(6, 3, off=2.0), 0.3, 0.7, 0.0, 0.2), lin(repair), m.hsv(m.mix(0.0, lin(repair), lin(repair)), 0.5, 1.0, 0.9)))
    col_ = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', m.remap(rp, 0.635, 0.645), m.remap(rp, 0.665, 0.655)), 0.5), col_, m.hsv(col_, 0.5, 1.0, 0.7))
    # cracks: map cracking and long cracks
    ce = m.math('DIVIDE', T.vwarp(2.6, 0.09, 4.0, 'Distance', 'DISTANCE_TO_EDGE', off=11.0), 2.6); keep = m.remap(T.noise(1.0, 2, off=21.0), 0.56, 0.6)
    crack = m.math('MULTIPLY', m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('DIVIDE', ce, m.math('MULTIPLY', m.remap(T.noise(8, 2, off=4.0), 0.3, 0.7, 0.4, 1.3), 0.001)))), keep)
    lc = m.math('DIVIDE', T.vwarp(0.7, 0.12, 1.5, 'Distance', 'DISTANCE_TO_EDGE', off=17.0), 0.7)
    longc = m.math('MULTIPLY', m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('DIVIDE', lc, 0.0014))), m.remap(T.noise(0.8, 2, off=23.0), 0.55, 0.6))
    crack = m.math('MAXIMUM', crack, longc)
    spall = m.math('MULTIPLY', m.math('MAXIMUM', m.math('MULTIPLY', m.remap(ce, 0.004, 0.0), keep), m.math('MULTIPLY', m.remap(lc, 0.005, 0.0), m.remap(T.noise(0.8, 2, off=23.0), 0.55, 0.6))), m.remap(T.noise(25, 3, off=14.0), 0.5, 0.7))
    col_ = m.mix(m.math('MULTIPLY', crack, 0.9), col_, (0.06, 0.055, 0.05)); col_ = m.mix(m.math('MULTIPLY', spall, 0.6), col_, lin(plaster))
    h = m.math('SUBTRACT', h, m.math('ADD', m.math('MULTIPLY', crack, 0.0012), m.math('MULTIPLY', spall, 0.0005)))
    # fixing holes: open ones and wooden plugs
    hv = T.voronoi(6.0, 'Distance', off=51.0); hsel = m.remap(sep(m, T.voronoi(6.0, 'Color', off=51.0))[0], 0.8, 0.82)
    hole = m.math('MULTIPLY', m.remap(hv, 0.025, 0.015, smooth=True), hsel)
    col_ = m.mix(hole, col_, m.mix(m.remap(sep(m, T.voronoi(6.0, 'Color', off=51.0))[1], 0.4, 0.6), (0.03, 0.025, 0.02), lin('#7a5a3a')))
    h = m.math('SUBTRACT', h, m.math('MULTIPLY', hole, 0.002))
    # flaking distemper (a little on A, a lot on B with the damp)
    damp = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(T.noise(0.8, 4, 0.55, off=61.0), 0.5, 0.7, smooth=True), V), edge_fade(m, W, H, 0.08, 0.4, T, wv=wv))
    fk = m.math('ADD', T.noise(12, 5, 0.65, off=33.0), m.math('MULTIPLY', damp, 0.35))
    flaked = m.remap(fk, 0.66, 0.68, smooth=True); lip = m.math('MULTIPLY', m.remap(fk, 0.62, 0.66), m.remap(fk, 0.69, 0.66))
    col_ = m.mix(flaked, col_, m.mix(m.remap(T.noise(30, 3, off=4.0), 0.3, 0.7), lin(plaster), m.hsv(m.mix(0.0, lin(plaster), lin(plaster)), 0.5, 1.0, 0.85)))
    col_ = m.mix(m.math('MULTIPLY', lip, 0.35), col_, m.hsv(col_, 0.5, 1.0, 0.65)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', flaked, 0.0002))
    col_ = m.mix(m.math('MULTIPLY', damp, 0.5), col_, m.mix(1.0, col_, (0.68, 0.68, 0.64), 'MULTIPLY'))
    mould = m.math('MULTIPLY', m.remap(T.voronoi(230, 'Distance', off=5.0), 0.28, 0.06), m.math('MULTIPLY', damp, m.remap(T.noise(2.5, 4, off=11.0), 0.45, 0.7)))
    col_ = m.mix(mould, col_, (0.03, 0.034, 0.026))
    sn = T.noise(1.1, 4, 0.55, off=71.0)                                                           # (old water and tea-coloured stains)
    stn = m.remap(sn, 0.62, 0.7, smooth=True); stt = m.math('MULTIPLY', m.remap(sn, 0.6, 0.62), m.remap(sn, 0.66, 0.62))
    col_ = m.mix(m.math('MULTIPLY', stn, 0.35), col_, m.mix(1.0, col_, (0.85, 0.75, 0.58), 'MULTIPLY')); col_ = m.mix(m.math('MULTIPLY', stt, 0.45), col_, m.mix(1.0, col_, (0.7, 0.58, 0.42), 'MULTIPLY'))
    if ceiling:
        # a ceiling: hairline cracks along the laths, water rings, fly specks, sooted all over in clouds
        lf = m.math('FRACT', m.math('DIVIDE', y, 0.0333)); ld = m.math('MULTIPLY', m.math('MINIMUM', lf, m.math('SUBTRACT', 1.0, lf)), 0.0333)
        lath = m.math('MULTIPLY', m.remap(ld, 0.0004, 0.0), m.remap(m.math('ADD', T.noise(2.0, 3, off=81.0), m.math('MULTIPLY', T.noise(14, 2, off=82.0), 0.3)), 0.72, 0.78))
        lath = m.math('MULTIPLY', lath, m.remap(m.math('FRACT', m.math('MULTIPLY', m.math('FLOOR', m.math('DIVIDE', y, 0.0333)), 0.618)), 0.6, 0.65))   # (only some laths)
        col_ = m.mix(m.math('MULTIPLY', lath, 0.8), col_, (0.07, 0.065, 0.06)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', lath, 0.0006))
        rv = T.voronoi(2.2, 'Distance', off=84.0); rsel = m.remap(T.noise(0.9, 2, off=85.0), 0.55, 0.62)
        rr = m.math('ADD', rv, m.math('MULTIPLY', m.math('SUBTRACT', T.noise(12, 3, off=86.0), 0.5), 0.04))
        ring = m.math('MULTIPLY', m.math('MAXIMUM', m.math('MULTIPLY', m.remap(rr, 0.15, 0.17), m.remap(rr, 0.19, 0.17)), m.math('MULTIPLY', m.math('MULTIPLY', m.remap(rr, 0.1, 0.11), m.remap(rr, 0.125, 0.11)), 0.6)), rsel)
        col_ = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', m.remap(rr, 0.18, 0.12), rsel), 0.3), col_, m.mix(1.0, col_, (0.88, 0.8, 0.64), 'MULTIPLY'))
        col_ = m.mix(m.math('MULTIPLY', ring, 0.8), col_, m.mix(1.0, col_, (0.6, 0.47, 0.3), 'MULTIPLY'))
        fly = m.math('MULTIPLY', m.remap(T.voronoi(120, 'Distance', off=87.0), 0.06, 0.02, smooth=True), m.remap(T.noise(2.0, 2, off=88.0), 0.5, 0.65))
        col_ = m.mix(m.math('MULTIPLY', fly, 0.8), col_, (0.05, 0.04, 0.03))
        soot = m.remap(T.noise(1.0, 4, 0.55, off=6.0), 0.3, 0.8, 0.2, 0.6)
        col_ = m.mix(soot, col_, m.hsv(col_, 0.5, 0.6, 0.66))
    else:
        # grime round the bench, soot toward the ceiling
        gb = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(y, grime_band[0], grime_band[0] + 0.15, smooth=True), m.remap(y, grime_band[1], grime_band[1] - 0.3, smooth=True)),
                    m.remap(T.noise(4, 4, off=1.0), 0.42, 0.78, 0.0, 0.7))
        col_ = m.mix(gb, col_, m.hsv(col_, 0.5, 0.75, 0.6)); rough = m.mixf(gb, rough, 0.6)
        soot = m.math('MULTIPLY', m.remap(y, 1.8, 3.0, smooth=True), m.remap(T.noise(1.4, 3, off=6.0), 0.3, 0.7, 0.35, 0.75))
        col_ = m.mix(soot, col_, m.hsv(col_, 0.5, 0.6, 0.6))
    gr = m.math('MULTIPLY', m.remap(cav, 0.92, 0.5, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0))
    col_ = m.mix(m.math('MULTIPLY', gr, 0.7), col_, (0.06, 0.05, 0.04))
    return finish(m, col_, rough, h)

def workshop_wall():
    """the workshop's wall: dark green painted tongue-and-groove (V-jointed) to a batten at 0.93 m, lime plaster in tired
       distemper above"""
    W, H = TW, FH; top = float(TRIMS['workshop']['dado']); G = Geo(W, H, wv=False); n = 20; bw = W / n
    PAINT = paint_mat('workshop_tg', W, H, '#3d4b3c', '#6b4a33', '#7a5238', '#9c774c', wv=False, chips=1.6, gloss=0.38, scuff=0.65, stain=1.0, age=1.5)
    PL = distemper_mat('workshop_plaster', W, H)
    gp = lambda c, k=0: (c.x * 0.001 + k, c.z, c.y); gh = lambda c, k=0: (c.y * 0.001 + k, c.z, c.x)
    for i in range(n):
        x0 = i * bw; wb = bw - random.uniform(0.0005, 0.0015)
        bm = box(wb, top + 0.02, 0.018, 0.0035, 1)                                               # (the V: a chamfer on each edge)
        cuts(bm, 1, [-(top + 0.02) / 2 + (top + 0.02) * k / 10 for k in range(1, 10)])
        xform(bm, (x0 + bw / 2, (top + 0.02) / 2 - 0.02, -0.009 + random.gauss(0, 0.0003)), (0, random.gauss(0, 0.002), 0))
        k = random.uniform(-50, 50); G.add(bm, PAINT, {'gpos': (lambda c, k=k: gp(c, k)), 'prand': random.random()})
    bt = box(W + 0.02, 0.055, 0.024, 0.004, 3); xform(bt, (W / 2, top, 0.004)); k = random.uniform(-50, 50)
    G.add(bt, PAINT, {'gpos': (lambda c, k=k: gh(c, k)), 'prand': random.random()}, wrap=False)
    G.add(grid(-0.4, W + 0.4, -0.1, top + 0.05, 2, 2, -0.02), flatmat('workshop_back', (0.02, 0.018, 0.015), 0.9), {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False)
    G.add(plaster_grid(-0.4, W + 0.4, top + 0.02, H + 0.3, W, step=0.012, amp=0.002, seed=13.0), PL, {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False, smooth=True)
    return {'geo': G.build('workshop_wall'), 'W': W, 'H': H, 'variants': 2, 'wv': False, 'ao': 0.12, 'cav': 0.012, 'pom': 0.02,
            'heights': {'dado': top, 'skirting': TRIMS['workshop']['skirting']['h'], 'boards': [0.0, top], 'plaster_from': top + 0.03},
            'notes': 'green painted V-jointed boarding to a batten at the dado height, distempered lime plaster above; B: damp, heavy flaking, mould'}

# ================================================================ ceilings (the flat frame: x, y on the ceiling, z down into the room)
def bm_of(ob):
    """an object's mesh as a bmesh (the object is removed): for parts made by kitlib's sweep and lathe"""
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.transform(ob.matrix_world); me = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); return bm

def rib(pts, w=0.05, h=0.022, closed=False, name='rib'):
    """a moulded plaster rib along pts [(x, y)] on the ceiling: a rounded section w wide standing h proud (its lower half
       buried in the field)"""
    path = []; n = len(pts)
    for i, (x, y) in enumerate(pts):
        a = pts[(i - 1) % n] if closed or i > 0 else pts[i]; b = pts[(i + 1) % n] if closed or i < n - 1 else pts[i]
        t = Vector((b[0] - a[0], b[1] - a[1], 0.0)).normalized(); side = Vector((-t.y, t.x, 0.0))
        path.append((Vector((x, y, 0.0)), side, Vector((0, 0, 1))))
    if closed: path.append(path[0])
    sec = kitlib.rounded_rect(w, 2 * h, min(w, h) * 0.45, 4)
    return bm_of(kitlib.sweep(name, path, lambda k: sec, caps=(not closed, not closed)))

def wood_ceil():
    """the nursery's ceiling: lath-and-plaster in yellowed distemper, sagging a little between the joists, hairline cracks
       along the laths, water rings, fly specks, flaking"""
    W = H = TW; G = Geo(W, H)
    M = distemper_mat('wood_ceil', W, H, col='#cdc6b2', plaster='#ab9f8a', repair='#d6d0c0', wv=True, ceiling=True)
    bm = plaster_grid(0.0, W, 0.0, H, W, step=0.015, amp=0.0018, seed=21.0, H=H)
    for v in bm.verts: v.co.z += 0.0022 * (0.5 - 0.5 * math.cos(2 * math.pi * v.co.x / 0.45))      # (sagging between joists every 0.45 m)
    G.add(bm, M, {}, smooth=True, wrap=True)
    return {'geo': G.build('wood_ceil'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.08, 'cav': 0.01, 'pom': 0.006,
            'notes': 'lath-and-plaster in old distemper: lath cracks, water rings, fly specks, soot, flaking'}

def tile_ceil():
    """the hall's ceiling: Jacobean strapwork in plaster (ribs along the tile's edges, a circle, a lozenge through it, small
       circles where the lozenge meets the edges, a boss in the middle), old cream distemper, cracks along the ribs"""
    W = H = TW; G = Geo(W, H); c = W / 2
    M = distemper_mat('tile_ceil', W, H, col='#d2cab4', plaster='#ab9f8a', repair='#ddd6c4', wv=True, ceiling=True)
    G.add(plaster_grid(0.0, W, 0.0, H, W, step=0.02, amp=0.0008, seed=23.0, H=H), M, {}, smooth=True, wrap=True)
    G.add(rib([(x, 0.0) for x in np.linspace(0.0, W, 24)], 0.07, 0.026), M, {})                     # (the edge ribs: the copies make the grid)
    G.add(rib([(0.0, y) for y in np.linspace(0.0, H, 24)], 0.07, 0.026), M, {})
    G.add(rib([(c + 0.55 * math.cos(a), c + 0.55 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 72, endpoint=False)], 0.055, 0.022, closed=True), M, {})
    for (a, b) in (((c, 0.0), (W, c)), ((W, c), (c, H)), ((c, H), (0.0, c)), ((0.0, c), (c, 0.0))):
        G.add(rib([(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in np.linspace(0, 1, 20)], 0.045, 0.018), M, {})
    for (x, y) in ((c, 0.0), (0.0, c)):
        G.add(rib([(x + 0.17 * math.cos(a), y + 0.17 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40, endpoint=False)], 0.04, 0.018, closed=True), M, {})
    # the boss: a dome ringed with petals
    for (r, z, n) in ((0.075, 0.035, 1), (0.03, 0.02, 8)):
        for k in range(n):
            a = 2 * math.pi * k / n; cx, cy = (c, c) if n == 1 else (c + 0.1 * math.cos(a), c + 0.1 * math.sin(a))
            bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
            for v in bm.verts: v.co = Vector((cx + v.co.x * r * (1.6 if n > 1 else 1.0), cy + v.co.y * r, max(-0.002, v.co.z * z)))
            if n > 1: bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector((cx, cy, 0)), matrix=Matrix.Rotation(a, 3, 'Z'))
            G.add(bm, M, {}, smooth=True)
    return {'geo': G.build('tile_ceil'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.12, 'cav': 0.015, 'pom': 0.03,
            'notes': 'Jacobean strapwork plaster ceiling in old distemper (ribs as geometry), boss at the centre'}

def boardmark_mat(name, W, H, col='#8b877f', dark='#6a665f'):
    """a slab cast against boards: each board's grain printed into the concrete (relief and a faint tone), each board strip
       its own shade (the timber drank the water differently), fins and steps at the joints, pinholes, tie holes plugged with
       mortar, lime runs crusting along the cracks, rust bleeding from the steel, water stains, cobweb grime in the corners"""
    m = kitlib.Mat(name); T = Tor(m, W, H); g = m.attr('gpos', True); pr = m.attr('prand'); kind = m.attr('kind'); cav = look(m, 'CAV', W, H)
    gx, gy, gz = sep(m, g)
    r = m.math('ADD', vlen(m, comb(m, gx, gy, 0.0)), m.math('MULTIPLY', m.math('SUBTRACT', noise3(m, vmul(m, g, (12, 12, 0.9)), 1.0, 3, 0.5), 0.5), 0.006))
    ring = m.math('FRACT', m.math('MULTIPLY', r, m.remap(pr, 0, 1, 120, 220))); lw = m.remap(ring, 0.6, 0.95)
    fib = noise3(m, vmul(m, g, (300, 300, 4)), 1.0, 3, 0.6)
    col_ = m.mix(m.remap(T.noise(1.2, 4, 0.55), 0.3, 0.75), lin(col), lin(dark))
    col_ = m.hsv(col_, 0.5, 1.0, m.remap(pr, 0, 1, 0.88, 1.1))
    col_ = m.mix(m.math('MULTIPLY', lw, 0.12), col_, m.hsv(col_, 0.5, 1.0, 0.85)); col_ = m.mix(m.remap(fib, 0.3, 0.7, 0.0, 0.08), col_, m.hsv(col_, 0.5, 1.0, 0.9))
    h = m.math('ADD', m.math('MULTIPLY', lw, 0.0003), m.math('MULTIPLY', fib, 0.0001))
    sand = T.noise(400, 3, 0.6); col_ = m.mix(m.remap(sand, 0.3, 0.7, 0.0, 0.15), col_, m.hsv(col_, 0.5, 1.0, 1.15))
    ph = T.voronoi(110, 'Distance', off=2.0); pin = m.math('MULTIPLY', m.remap(ph, 0.07, 0.025, smooth=True), m.remap(T.noise(5, 2, off=8.0), 0.4, 0.7, 0.0, 1.0))
    col_ = m.mix(m.math('MULTIPLY', pin, 0.7), col_, m.hsv(col_, 0.5, 1.0, 0.4)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', pin, 0.0004))
    plug = m.remap(kind, 1.5, 1.6); col_ = m.mix(plug, col_, m.mix(m.remap(sand, 0.3, 0.7), lin('#9c968a'), lin('#8a8478')))
    ce = m.math('DIVIDE', T.vwarp(1.4, 0.07, 3.0, 'Distance', 'DISTANCE_TO_EDGE', off=11.0), 1.4); keep = m.remap(T.noise(1.0, 2, off=21.0), 0.52, 0.56)
    crack = m.math('MULTIPLY', m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('DIVIDE', ce, 0.0011))), keep)
    col_ = m.mix(m.math('MULTIPLY', crack, 0.9), col_, (0.04, 0.038, 0.035)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', crack, 0.001))
    lime = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(ce, 0.02, 0.0, smooth=True), keep), m.remap(T.noise(25, 4, off=6.0), 0.4, 0.7))
    col_ = m.mix(m.math('MULTIPLY', lime, 0.85), col_, lin('#dcd8cd')); h = m.math('ADD', h, m.math('MULTIPLY', lime, 0.0006))
    rs = T.noise(1.3, 4, 0.6, off=41.0); rust = m.math('MULTIPLY', m.remap(rs, 0.66, 0.74, smooth=True), m.remap(T.noise(20, 3, off=3.0), 0.3, 0.7, 0.5, 1.0))
    col_ = m.mix(m.math('MULTIPLY', rust, 0.7), col_, m.mix(0.5, col_, lin('#7a4220')))
    ws = T.noise(0.9, 3, 0.5, off=51.0); stain = m.remap(ws, 0.6, 0.66, smooth=True); tide = m.math('MULTIPLY', m.remap(ws, 0.585, 0.6), m.remap(ws, 0.63, 0.61))
    col_ = m.mix(m.math('MULTIPLY', stain, 0.4), col_, m.mix(1.0, col_, (0.75, 0.7, 0.62), 'MULTIPLY')); col_ = m.mix(m.math('MULTIPLY', tide, 0.5), col_, m.mix(1.0, col_, (0.6, 0.52, 0.42), 'MULTIPLY'))
    gr = m.math('MULTIPLY', m.remap(cav, 0.95, 0.45, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0))
    col_ = m.mix(m.math('MULTIPLY', gr, 0.8), col_, (0.04, 0.036, 0.032))
    col_ = m.mix(m.remap(T.noise(1.1, 4, 0.55, off=19.0), 0.35, 0.85, 0.1, 0.5), col_, m.hsv(col_, 0.5, 0.85, 0.72))
    return finish(m, col_, m.remap(sand, 0.3, 0.7, 0.82, 0.95), h)

def concrete_ceil():
    """the cellar's ceiling: a slab cast against 0.15 m boards (15 to a tile), a step and a fin at each joint, butt joints in
       the boards, tie holes every 0.75 m plugged with mortar"""
    W = H = TW; G = Geo(W, H); n = 15; bw = H / n
    M = boardmark_mat('concrete_ceil', W, H)
    for r in range(n):
        y0 = r * bw; pieces = [(0.0, W)] if random.random() < 0.5 else (lambda j: [(0.0, j), (j, W)])(random.uniform(0.5, 1.75))
        off = random.uniform(0, W); dz = random.gauss(0, 0.0008)
        for (a, b) in pieces:
            L = b - a; bm = box(L - 0.0006, bw - 0.0006, 0.04, 0.0006, 1)
            cuts(bm, 0, [-L / 2 + L * k / 12 for k in range(1, 12)])
            xc = (off + (a + b) / 2) % W; yc = y0 + bw / 2; tilt = random.gauss(0, 0.004)
            xform(bm, (xc, yc, -0.02 + dz), (tilt, 0, 0))
            d0 = random.uniform(0.08, 0.25); o = random.uniform(-90, 90)
            G.add(bm, M, {'gpos': (lambda c, yc=yc, d0=d0, o=o: (c.y - yc, d0 + c.z, c.x + o)), 'prand': random.random(), 'kind': 0.0})
        # the fin squeezed out between this board and the next, here and there
        if random.random() < 0.6:
            fx = random.uniform(0, W); fl = random.uniform(0.2, 1.2)
            fn = box(fl, 0.0025, 0.004, 0.0008, 1); xform(fn, ((fx + fl / 2) % W, y0 + bw, 0.0005 + abs(dz))); G.add(fn, M, {'gpos': (0, 0, 0), 'prand': 0.5, 'kind': 0.0})
    for i in range(3):
        for j in range(3):
            pl = bmesh.new(); bmesh.ops.create_circle(pl, cap_ends=True, segments=20, radius=0.014)
            xform(pl, ((i + 0.5) * 0.75, (j + 0.5) * 0.75, 0.0012)); G.add(pl, M, {'gpos': (0, 0, 0), 'prand': 0.5, 'kind': 2.0})
    return {'geo': G.build('concrete_ceil'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.1, 'cav': 0.012, 'pom': 0.006,
            'notes': 'board-marked concrete slab, 0.15 m boards, fins and steps at joints, plugged tie holes every 0.75 m'}

def attic_ceil():
    """the attic's ceiling: rafters every 0.45 m (over the joists' lines) with the sarking boards between them, gaps to the
       slates behind"""
    W = H = TW; G = Geo(W, H); rw, rd = 0.05, 0.1
    PR = pine_mat('attic_rafter', W, H, early='#7c6650', late='#4e3c2a', dusty=0.15, nails=False, sawn=1.0, fig=0.6, wall_rows=None)
    PB = pine_mat('attic_sark', W, H, early='#6e5a46', late='#46362a', dusty=0.25, nails=False, sawn=0.8, fig=0.5, wall_rows=None)
    SL = flatmat('attic_slate', (0.015, 0.016, 0.018), 0.8)
    for k in range(5):
        xc = (k + 0.5) * JOIST
        bm = box(rw + random.uniform(-0.004, 0.004), H, rd, 0.003, 2); cuts(bm, 1, [-H / 2 + H * i / 30 for i in range(1, 30)])
        xform(bm, (xc + random.gauss(0, 0.003), H / 2, -rd / 2), (0, random.gauss(0, 0.004), 0))
        d0 = random.uniform(0.1, 0.3); o = random.uniform(-90, 90)
        G.add(bm, PR, {'gpos': (lambda c, xc=xc, d0=d0, o=o: (c.x - xc, d0 + c.z, c.y + o)), 'prand': random.random(), 'qs': 0.0, 'bL': H, 'bw': rw,
                       'spl': 9.0, 'bx': (lambda c, xc=xc: (c.x - xc) / (rw / 2)), 'bl': (lambda c: c.y - H / 2)})
    widths = split_widths(H, 12, 0.15, 0.23); y = 0.0
    for wbd in widths:
        gap = random.uniform(0.003, 0.01); wb = wbd - gap; yc = y + wbd / 2
        bm = box(W, wb, 0.02, 0.0015, 2); cuts(bm, 0, [W * i / 40 for i in range(1, 40)]); cuts(bm, 1, [-wb / 2 + wb * i / 6 for i in range(1, 6)])
        xform(bm, (W / 2, yc, -rd - 0.01 + random.gauss(0, 0.0015)))
        d0 = random.uniform(0.1, 0.3); o = random.uniform(-90, 90)
        G.add(bm, PB, {'gpos': (lambda c, yc=yc, d0=d0, o=o: (c.y - yc, d0 + c.z, c.x + o)), 'prand': random.random(), 'qs': 0.0, 'bL': W, 'bw': wb,
                       'spl': 9.0, 'bx': (lambda c, yc=yc, wb=wb: (c.y - yc) / (wb / 2)), 'bl': (lambda c: c.x - W / 2)})
        y += wbd
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -rd - 0.05), SL, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'bL': 1.0, 'bw': 0.2, 'spl': 9.0, 'bx': 0.0, 'bl': 0.0}, wrap=False)
    return {'geo': G.build('attic_ceil'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.15, 'cav': 0.015, 'pom': 0.06,
            'notes': 'rafters every 0.45 m (along v) with rough sarking boards between them, gaps to dark slates'}

def workshop_ceil():
    """the workshop's ceiling: V-jointed boards (0.1125 m, 20 to a tile) under old limewash, flaking to the wood, sooted"""
    W = H = TW; G = Geo(W, H); n = 20; bw = H / n
    PAINT = paint_mat('workshop_ceil', W, H, '#c9c3b2', '#8a7c66', '#7a6650', '#8e7356', wv=True, chips=1.4, gloss=0.8, age=2.4, up=None)
    gh = lambda c, k=0: (c.y * 0.001 + k, c.z, c.x)
    for i in range(n):
        y0 = i * bw; wb = bw - random.uniform(0.0005, 0.0015)
        bm = box(W, wb, 0.018, 0.0035, 1); cuts(bm, 0, [W * k / 20 for k in range(1, 20)])
        xform(bm, (W / 2, y0 + bw / 2, -0.009 + random.gauss(0, 0.0004)), (random.gauss(0, 0.002), 0, 0))
        k = random.uniform(-50, 50); G.add(bm, PAINT, {'gpos': (lambda c, k=k: gh(c, k)), 'prand': random.random()})
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 2, 2, -0.02), flatmat('workshop_cback', (0.02, 0.018, 0.015), 0.9), {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False)
    return {'geo': G.build('workshop_ceil'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.1, 'cav': 0.012, 'pom': 0.012,
            'notes': 'V-jointed ceiling boards along u under flaking limewash, sooted'}

# ================================================================ upper bands (above 3.0 m) and servants' walls: both tile both ways
def anaglypta(px=512):
    """an embossed relief paper's repeat (one cell, square): a lozenge trellis of beaded ribs, a four-petal flower in each
       lozenge, dots where the ribs cross; returns height 0..1 (soft, as embossed paper is)"""
    from PIL import Image, ImageDraw, ImageFilter
    S = 4; N = px * S; im = Image.new('L', (N, N), 0); d = ImageDraw.Draw(im)
    def P(x, y): return (x * N, y * N)
    w = int(N * 0.03)
    for (a, b) in (((0.5, 0.0), (1.0, 0.5)), ((1.0, 0.5), (0.5, 1.0)), ((0.5, 1.0), (0.0, 0.5)), ((0.0, 0.5), (0.5, 0.0))):
        d.line([P(*a), P(*b)], fill=200, width=w)
        for t in np.linspace(0.08, 0.92, 7):
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t; r = 0.018
            d.ellipse([P(x - r, y - r), P(x + r, y + r)], fill=255)
    for (x, y) in ((0.5, 0.0), (1.0, 0.5), (0.5, 1.0), (0.0, 0.5), (0.5, 0.5)):
        r = 0.05 if (x, y) != (0.5, 0.5) else 0.06; d.ellipse([P(x - r, y - r), P(x + r, y + r)], fill=255)
    for k in range(4):                                                    # the flower in the lozenge
        a = k * math.pi / 2; ox, oy = 0.5 + math.cos(a) * 0.12, 0.5 + math.sin(a) * 0.12
        d.ellipse([P(ox - 0.075, oy - 0.075), P(ox + 0.075, oy + 0.075)], fill=230)
        d.ellipse([P(ox - 0.035, oy - 0.035), P(ox + 0.035, oy + 0.035)], fill=150)
    for (x, y) in ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)):     # (the corners: quarter flowers of the neighbours)
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 4; ox, oy = x + math.cos(a) * 0.1, y + math.sin(a) * 0.1
            d.ellipse([P(ox - 0.06, oy - 0.06), P(ox + 0.06, oy + 0.06)], fill=210)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(S * 2.5)).resize((px, px), Image.LANCZOS), np.float32) / 255
    return a

def relief_paint_mat(name, W, H, relief, cell=(0.28125, 0.3), col='#cdc2a8', depth=0.0022, wv=True):
    """painted embossed relief paper: the relief (an image, one cell repeating) for the height, paint pooled and grimed in
       its hollows and rubbed on its crowns, yellowed, sooted heavily (it's up by the ceiling), streaked from the cornice"""
    m = kitlib.Mat(name); T = Tor(m, W, H, wv); V = variant(m); x, y = T.x, T.y; cav = look(m, 'CAV', W, H)
    t = m.n('ShaderNodeTexImage', interpolation='Cubic', extension='REPEAT'); t.image = relief
    m.l(comb(m, m.math('DIVIDE', x, cell[0]), m.math('DIVIDE', y, cell[1]), 0.0), t.inputs['Vector']); rl = sep(m, t.outputs['Color'])[0]
    c = lin(col)
    col_ = m.mix(m.remap(T.noise(1.3, 4, 0.55), 0.3, 0.75), c, m.mix(1.0, c, (0.86, 0.82, 0.72), 'MULTIPLY'))
    col_ = m.mix(m.math('MULTIPLY', m.remap(rl, 0.3, 0.0), 0.45), col_, m.hsv(col_, 0.5, 1.03, 0.82))   # (grime in the hollows: one paint, the relief does the rest)
    col_ = m.mix(m.math('MULTIPLY', m.remap(rl, 0.8, 1.0), 0.12), col_, m.hsv(col_, 0.5, 0.95, 1.06))   # (crowns rubbed a little)
    fib = T.noise(500, 3, 0.6); h = m.math('ADD', m.math('MULTIPLY', rl, depth), m.math('MULTIPLY', fib, 0.00004))
    rough = m.mixf(rl, 0.78, 0.62)
    soot = m.remap(T.noise(1.0, 4, 0.55, off=6.0), 0.3, 0.8, 0.25, 0.6); col_ = m.mix(soot, col_, m.hsv(col_, 0.5, 0.85, 0.66))
    st = m.math('MULTIPLY', m.remap(T.noise(1.6, 3, 0.5, off=33.0), 0.55, 0.7, smooth=True), m.math('MULTIPLY', V, edge_fade(m, W, H, 0.08, 0.35, T, wv=wv)))
    col_ = m.mix(m.math('MULTIPLY', st, 0.55), col_, m.mix(1.0, col_, (0.75, 0.62, 0.42), 'MULTIPLY'))
    gr = m.math('MULTIPLY', m.remap(cav, 0.93, 0.5, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0)); col_ = m.mix(m.math('MULTIPLY', gr, 0.6), col_, (0.06, 0.05, 0.04))
    return finish(m, col_, rough, h)

def wood_upper():
    """the nursery's upper band: embossed relief paper in yellowed paint, sooted; B: stained from the cornice"""
    W, H = TW, FH; G = Geo(W, H)
    REL = _pattern_image('anaglypta', anaglypta(512))
    M = relief_paint_mat('wood_upper', W, H, REL)
    G.add(plaster_grid(0.0, W, 0.0, H, W, step=0.02, amp=0.0015, seed=31.0, H=H), M, {}, smooth=True)
    return {'geo': G.build('wood_upper'), 'W': W, 'H': H, 'variants': 2, 'ao': 0.08, 'cav': 0.01, 'pom': 0.004,
            'notes': 'painted embossed (Anaglypta-like) relief paper, 8 x 10 cells per tile; B: water-stained'}

def tile_upper():
    """the hall's upper band: a plaster frieze of moulded panels (four across a tile, 0.75 m tall) in old stone-coloured
       distemper"""
    W, H = TW, FH; G = Geo(W, H)
    M = distemper_mat('tile_upper', W, H, col='#c8bea6', plaster='#a89a84', repair='#d2c9b4', wv=True, ceiling=True)
    G.add(plaster_grid(0.0, W, 0.0, H, W, step=0.02, amp=0.0008, seed=33.0, H=H), M, {}, smooth=True)
    pw, ph = W / 4, H / 4
    for i in range(4):
        for j in range(4):
            x0, y0 = i * pw + 0.07, j * ph + 0.08; x1, y1 = (i + 1) * pw - 0.07, (j + 1) * ph - 0.08
            pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            path = []
            for k in range(4):
                a, b = pts[k], pts[(k + 1) % 4]
                for t in np.linspace(0, 1, 12, endpoint=False): path.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            G.add(rib(path, 0.035, 0.014, closed=True), M, {})
            G.add(rib([(x0 + 0.04, y0 + 0.04), (x1 - 0.04, y0 + 0.04), (x1 - 0.04, y1 - 0.04), (x0 + 0.04, y1 - 0.04)] , 0.012, 0.006, closed=True), M, {})
    return {'geo': G.build('tile_upper'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.1, 'cav': 0.012, 'pom': 0.012,
            'notes': 'plaster frieze of moulded panels (4 x 4 per tile) in old distemper'}

def render_mat(name, W, H, col='#8e897f', dark='#6b675f'):
    """rough cement render: coarse sand, float marks, a few cracks, damp patches, grime"""
    m = kitlib.Mat(name); T = Tor(m, W, H); V = variant(m); cav = look(m, 'CAV', W, H)
    sand = T.noise(300, 3, 0.65); grit = T.voronoi(180, 'Distance', off=3.0); mott = T.noise(1.5, 5, 0.6)
    col_ = m.mix(m.remap(mott, 0.3, 0.72), lin(col), lin(dark))
    col_ = m.mix(m.remap(sand, 0.25, 0.75), m.hsv(col_, 0.5, 1.0, 0.85), m.hsv(col_, 0.5, 1.0, 1.15))
    col_ = m.mix(m.remap(grit, 0.3, 0.1, 0.0, 0.4), col_, m.hsv(col_, 0.5, 0.8, 1.3))
    fl = noise3(m, comb(m, m.math('MULTIPLY', T.x, 8.0), m.math('MULTIPLY', T.y, 3.0), 0.0), 1.0, 3, 0.5)      # (float sweeps)
    h = m.math('ADD', m.math('MULTIPLY', sand, 0.0005), m.math('ADD', m.math('MULTIPLY', m.remap(grit, 0.3, 0.1), 0.0006), m.math('MULTIPLY', fl, 0.0008)))
    ce = m.math('DIVIDE', T.vwarp(1.3, 0.08, 3.0, 'Distance', 'DISTANCE_TO_EDGE', off=11.0), 1.3); keep = m.remap(T.noise(1.0, 2, off=21.0), 0.54, 0.58)
    crack = m.math('MULTIPLY', m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('DIVIDE', ce, 0.0012))), keep)
    col_ = m.mix(m.math('MULTIPLY', crack, 0.9), col_, (0.04, 0.038, 0.035)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', crack, 0.0015))
    damp = m.math('ADD', m.remap(T.noise(0.9, 4, 0.55, off=31.0), 0.55, 0.7, smooth=True), m.math('MULTIPLY', V, 0.0))
    col_ = m.mix(m.math('MULTIPLY', damp, 0.45), col_, m.mix(1.0, col_, (0.66, 0.66, 0.66), 'MULTIPLY'))
    gr = m.math('MULTIPLY', m.remap(cav, 0.93, 0.5, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0)); col_ = m.mix(m.math('MULTIPLY', gr, 0.7), col_, (0.05, 0.045, 0.04))
    col_ = m.mix(m.remap(T.noise(1.2, 4, 0.55, off=19.0), 0.35, 0.85, 0.15, 0.55), col_, m.hsv(col_, 0.5, 0.8, 0.68))
    return finish(m, col_, m.remap(sand, 0.3, 0.7, 0.85, 0.97), h)

def concrete_upper():
    W, H = TW, FH; G = Geo(W, H); M = render_mat('concrete_upper', W, H)
    G.add(plaster_grid(0.0, W, 0.0, H, W, step=0.015, amp=0.003, seed=35.0, H=H), M, {}, smooth=True)
    return {'geo': G.build('concrete_upper'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.08, 'cav': 0.01, 'pom': 0.006, 'notes': 'rough cement render, cracks, damp, grime'}

def attic_upper():
    """the attic's upper band: the boarding running on up (full-length boards, nail rows every 3 m at the wall's heights)"""
    W, H = TW, FH; G = Geo(W, H); t = 0.022; rows = (0.7, 1.7, 2.7)
    P = pine_mat('attic_upper', W, H, early='#78664f', late='#4f3e2c', dusty=0.12, nails=False, wall_rows=rows, wv=True, sawn=1.0, fig=0.6)
    IR = iron_mat('attic_unail', W, H); VOID = flatmat('attic_uvoid', (0.012, 0.01, 0.009), 0.95)
    widths = split_widths(W, 12, 0.14, 0.24); x = 0.0
    for wbd in widths:
        gap = random.uniform(0.002, 0.008); wb = wbd - gap; xc = x + wbd / 2
        bm = vboard(xc, wb, 0.0015, H - 0.0015, t, random.uniform(0.0004, 0.0015), random.uniform(0.001, 0.0025), 0, random.uniform(0, 50))   # (3 m boards, butted at the tile's seam)
        d0 = random.uniform(0.1, 0.3); o3 = (random.uniform(-0.02, 0.02), random.uniform(-90, 90)); tl = math.tan(math.radians(random.uniform(0.15, 0.8))) * random.choice((-1, 1))
        gp = lambda c, xc=xc, d0=d0, o=o3, tl=tl: (c.x - xc + o[0], d0 + c.z + (c.y - H / 2) * tl, c.y + o[1])
        G.add(bm, P, {'gpos': gp, 'prand': random.random(), 'qs': 0.0, 'bL': H, 'bw': wb, 'spl': 9.0,
                      'bx': (lambda c, xc=xc, wb=wb: (c.x - xc) / (wb / 2)), 'bl': (lambda c: c.y - H / 2)})
        for ry in rows:
            for sgn in (-1, 1):
                nb = box(0.0038, 0.005, 0.004, 0.0004, 1); xform(nb, (xc + sgn * 0.6 * wb / 2, ry, -0.0025))
                G.add(nb, IR, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'bL': 1.0, 'bw': 0.2, 'spl': 9.0, 'bx': 0.0, 'bl': 0.0})
        x += wbd
    G.add(grid(-0.4, W + 0.4, -0.4, H + 0.4, 4, 4, -0.03), VOID, {'gpos': (0, 0, 0), 'prand': 0.5, 'qs': 0.0, 'bL': 1.0, 'bw': 0.2, 'spl': 9.0, 'bx': 0.0, 'bl': 0.0}, wrap=False)
    return {'geo': G.build('attic_upper'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.12, 'cav': 0.012, 'pom': 0.012, 'notes': 'rough-sawn vertical boarding, tiling every 3 m'}

def workshop_upper():
    """the workshop's upper band: stretcher-bond brick under thick old limewash, flaking"""
    W, H = TW, FH; G = Geo(W, H); ch = H / 40; jt = 0.010
    BR = brick_mat('workshop_ubrick', W, H, wv=True, wash=1.0, damp=False); MO = mortar_mat('workshop_umortar', W, H, wv=True, wash=1.0, damp=False)
    for r in range(40):
        y0 = r * ch; pitch = W / 10; off = pitch / 2 if r % 2 else 0.0
        for i in range(10):
            L = pitch - jt - random.uniform(-0.002, 0.006); Hh = ch - jt - random.uniform(-0.001, 0.004)
            bm = brick_bm(L, Hh, 0.06, i * 31 + r, random.choice((0.0, 0.0, 0.0, 0.006)))
            cx, cy = i * pitch + off + pitch / 2 + random.gauss(0, 0.0015), y0 + ch / 2 + random.gauss(0, 0.001)
            xform(bm, (cx, cy, -0.03 + random.gauss(0, 0.0015)), (random.gauss(0, 0.008), random.gauss(0, 0.008), random.gauss(0, 0.006)))
            o3 = Vector((random.uniform(-40, 40), random.uniform(-40, 40), random.uniform(-40, 40)))
            G.add(bm, BR, {'gpos': (lambda c, cx=cx, cy=cy, o=o3: (c.x - cx + o.x, c.y - cy + o.y, c.z + o.z)), 'prand': random.random()})
    G.add(xform(plaster_grid(-0.4, W + 0.4, -0.4, H + 0.4, W, step=0.012, amp=0.0015, seed=37.0, H=H), (0, 0, -0.009)), MO, {'gpos': (0, 0, 0), 'prand': 0.5}, wrap=False)
    return {'geo': G.build('workshop_upper'), 'W': W, 'H': H, 'variants': 1, 'ao': 0.12, 'cav': 0.015, 'pom': 0.02, 'notes': 'limewashed stretcher-bond brick, flaking'}

# ---------------------------------------------------------------- servants' walls
SERVICE = {'wood': ('#5a4636', '#c9c0a8'), 'tile': ('#3f4a3a', '#cfc6ae'), 'concrete': ('#2e2b28', '#bdb7a8'),
           'attic': ('#6b5a48', '#cbc4b2'), 'workshop': ('#3d4b3c', '#bfb8a3')}
def service(style):
    """a servants' passage: dark oil paint to 1.2 m with a black line, tired distemper above (repeating every 3 m)"""
    def fn():
        W, H = TW, FH; G = Geo(W, H); lo, up = SERVICE[style]; line = 1.2
        PL = paint_mat(f'{style}_svc_paint', W, H, lo, '#7a6a52', '#6a4a34', '#8e7356', wv=True, chips=1.0, gloss=0.4, scuff=0.5, age=1.3, up=None, band=(line, line + 0.015))
        DS = distemper_mat(f'{style}_svc_dist', W, H, col=up, wv=True, grime_band=(1.2, 1.7))
        G.add(plaster_grid(0.0, W, line + 0.015, H, W, step=0.015, amp=0.0018, seed=41.0, H=H), DS, {'gpos': (0, 0, 0), 'prand': 0.5}, smooth=True)
        G.add(plaster_grid(0.0, W, 0.0, line + 0.015, W, step=0.015, amp=0.0018, seed=41.0, H=H), PL, {'gpos': (lambda c: (c.y * 0.001, c.z, c.x)), 'prand': 0.5}, smooth=True)
        return {'geo': G.build(f'{style}_service'), 'W': W, 'H': H, 'variants': 2, 'ao': 0.08, 'cav': 0.01, 'pom': 0.004,
                'heights': {'line': line}, 'notes': f'servants\' passage: {lo} oil paint to {line} m with a black line, {up} distemper above, repeating every 3 m'}
    return fn

# ================================================================ beams (u along 2.25 m, v once round the section: tiles both ways)
BEAM_H = TW * 512 / 2048                                           # (the flat frame's height: square texels)

def aniso(T, scale, kx, ky=1.0, detail=4, rough=0.55, off=0.0):
    """4D noise on the torus, stretched: features 1/kx times longer along x (still periodic)"""
    m = T.m; v = m.n('ShaderNodeVectorMath', operation='MULTIPLY'); m.l(T.v, v.inputs[0]); v.inputs[1].default_value = (kx, kx, ky)
    nz = m.n('ShaderNodeTexNoise', noise_dimensions='4D', i_Scale=scale, i_Detail=detail, i_Roughness=rough)
    m.l(v.outputs[0], nz.inputs['Vector']); m.l(m.math('ADD', m.math('MULTIPLY', T.w, ky), off), nz.inputs['W']); return nz.outputs['Fac']

def timber_mat(name, W, H, tone='#6e5640', dark='#3f3022', rings=90, dust=0.15, wash=0.0, soot=0.0, sawmarks=0.6):
    """a sawn timber's face, grain along u: flame figure from ring lines bent by stretched noise (ring count a whole number
       round v, so it repeats), fibre, band-saw marks across it, seasoning checks running with the grain, knots, dust, cobweb
       grime, old limewash in patches (wash), soot (soot)"""
    m = kitlib.Mat(name); T = Tor(m, W, H); cav = look(m, 'CAV', W, H); x, y = T.x, T.y
    warp = m.math('ADD', m.math('MULTIPLY', m.math('SUBTRACT', aniso(T, 2.2, 1.0, 1.0, 3, off=1.0), 0.5), 16.0), m.math('MULTIPLY', m.math('SUBTRACT', aniso(T, 7.0, 1.0, 1.0, 2, off=2.0), 0.5), 3.0))   # (the figure flows, bent at a few decimetres)
    ph = m.math('ADD', m.math('MULTIPLY', y, rings / H), warp)
    ph = m.math('ADD', ph, m.math('MULTIPLY', m.math('SUBTRACT', aniso(T, 3.0, 0.15, 1.0, 2, off=15.0), 0.5), 6.0))   # (good years and lean ones)
    ring = m.math('FRACT', ph)
    lw = m.math('POWER', m.remap(ring, 0.45, 0.97), 1.3)
    col_ = m.mix(m.math('MULTIPLY', lw, 0.7), lin(tone), lin(dark))
    fib = aniso(T, 120, 0.04, 1.0, 3, 0.6, off=3.0); col_ = m.mix(m.remap(fib, 0.25, 0.75), m.hsv(col_, 0.5, 1.0, 0.88), m.hsv(col_, 0.5, 1.0, 1.1))
    streak = aniso(T, 8, 0.05, 1.0, 4, off=4.0); col_ = m.mix(m.remap(streak, 0.2, 0.8), m.hsv(col_, 0.5, 0.92, 0.78), m.hsv(col_, 0.5, 1.06, 1.18))
    col_ = m.mix(m.remap(aniso(T, 2.0, 0.1, 1.0, 3, off=14.0), 0.55, 0.8, 0.0, 0.5), col_, m.hsv(col_, 0.5, 1.1, 0.62))   # (dark heart streaks)
    saw = m.math('MULTIPLY', m.math('ADD', 0.5, m.math('MULTIPLY', m.math('SINE', m.math('MULTIPLY', m.math('ADD', x, m.math('MULTIPLY', y, 0.04)), 2 * math.pi / (W / 320))), 0.5)), m.remap(T.noise(3, 2, off=5.0), 0.35, 0.7, 0.2, 1.0))
    col_ = m.mix(m.math('MULTIPLY', saw, 0.15 * sawmarks), col_, m.hsv(col_, 0.5, 1.0, 0.8))
    h = m.math('ADD', m.math('MULTIPLY', lw, 0.0002), m.math('ADD', m.math('MULTIPLY', fib, 0.00012), m.math('MULTIPLY', saw, 0.0002 * sawmarks)))
    # seasoning checks with the grain, and a few knots
    ck = aniso(T, 2.5, 0.06, 1.0, 3, 0.5, off=7.0); ckw = m.math('MULTIPLY', m.remap(aniso(T, 3.0, 0.2, 1.0, 2, off=8.0), 0.3, 0.7, 0.3, 1.6), 0.01)
    check = m.math('MULTIPLY', m.math('SUBTRACT', 1.0, m.math('MINIMUM', 1.0, m.math('DIVIDE', m.math('ABSOLUTE', m.math('SUBTRACT', ck, 0.5)), ckw))), m.remap(aniso(T, 1.2, 0.3, 1.0, 2, off=9.0), 0.5, 0.6))
    col_ = m.mix(check, col_, (0.02, 0.015, 0.01)); h = m.math('SUBTRACT', h, m.math('MULTIPLY', check, 0.004))
    kv = T.voronoi(3.0, 'Distance', off=11.0); ks = m.remap(sep(m, T.voronoi(3.0, 'Color', off=11.0))[0], 0.75, 0.78)
    knot = m.math('MULTIPLY', m.remap(kv, 0.05, 0.03, smooth=True), ks); col_ = m.mix(knot, col_, m.mix(m.remap(m.math('FRACT', m.math('MULTIPLY', kv, 150.0)), 0.3, 0.7), lin('#2e1e10'), lin('#4a3018')))
    rough = m.math('ADD', m.mixf(lw, 0.82, 0.72), m.math('MULTIPLY', saw, 0.05))
    # dirt: grime in checks and hollows, dust, cobweb haze, limewash, soot
    gr = m.math('MULTIPLY', m.remap(cav, 0.95, 0.5, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0)); col_ = m.mix(m.math('MULTIPLY', gr, 0.7), col_, (0.04, 0.03, 0.022))
    col_ = m.mix(m.remap(T.noise(1.2, 4, 0.55, off=19.0), 0.35, 0.85, 0.15, 0.55), col_, m.hsv(col_, 0.5, 0.8, 0.68))
    dl = m.math('MULTIPLY', m.remap(m.math('ADD', T.noise(2.0, 4, 0.6, off=6.0), m.math('MULTIPLY', T.noise(12, 3, off=7.0), 0.3)), 0.4, 1.0, 0.0, dust), 1.0)
    col_ = m.mix(dl, col_, lin('#86807a')); rough = m.mixf(dl, rough, 0.92)
    web = m.math('MULTIPLY', m.remap(aniso(T, 5, 0.5, 1.0, 4, 0.7, off=12.0), 0.62, 0.78), 0.4 * dust); col_ = m.mix(web, col_, lin('#9a958e'))
    if wash:
        wf = m.math('ADD', T.noise(9, 5, 0.65, off=33.0), m.math('MULTIPLY', m.math('SUBTRACT', T.noise(0.9, 3, off=35.0), 0.5), 0.5))
        wc = m.math('MULTIPLY', m.remap(wf, 0.62, 0.5, smooth=True), wash); col_ = m.mix(wc, col_, m.mix(0.35, m.mix(m.remap(T.noise(8, 3, off=31.0), 0.3, 0.7), lin('#c9c4b6'), lin('#aaa392')), col_))   # (thin: the grain shows through)
        rough = m.mixf(wc, rough, 0.93)
    if soot: col_ = m.mix(m.remap(T.noise(1.0, 4, 0.55, off=41.0), 0.3, 0.8, 0.3 * soot, 0.8 * soot), col_, m.hsv(col_, 0.5, 0.5, 0.45))
    return finish(m, col_, rough, h)

def steel_mat(name, W, H, paint='#6e3423', under='#5d5650'):
    """a riveted steel I-beam in red-oxide paint, faded, flaking to grey mill scale and orange rust, rust blooming through,
       rivet rows along it, sooted"""
    m = kitlib.Mat(name); T = Tor(m, W, H); cav = look(m, 'CAV', W, H); edge = look(m, 'EDGE', W, H)
    c = m.mix(m.remap(T.noise(2.0, 4, 0.55), 0.3, 0.75), lin(paint), m.mix(1.0, lin(paint), (1.2, 1.1, 1.0), 'MULTIPLY'))
    brush = aniso(T, 200, 0.05, 1.0, 3, off=1.0); c = m.mix(m.remap(brush, 0.3, 0.7, 0.0, 0.12), c, m.hsv(c, 0.5, 1.0, 0.85))
    h = m.math('MULTIPLY', brush, 0.00004)
    fl = m.math('ADD', T.noise(6, 5, 0.65, off=2.0), m.math('MULTIPLY', edge, 0.4))
    scale_ = m.remap(fl, 0.58, 0.6, smooth=True); rustm = m.remap(fl, 0.63, 0.66, smooth=True)
    rc = m.mix(m.remap(T.noise(60, 4, off=3.0), 0.3, 0.7), lin('#6a3014'), lin('#9a5426'))
    c = m.mix(scale_, c, m.mix(m.remap(T.noise(40, 3), 0.3, 0.7), lin(under), m.hsv(m.mix(0.0, lin(under), lin(under)), 0.5, 1.0, 1.3))); c = m.mix(rustm, c, rc)
    bloom = m.math('MULTIPLY', m.remap(T.noise(5, 4, off=4.0), 0.6, 0.75), m.remap(T.noise(80, 3, off=5.0), 0.4, 0.6)); c = m.mix(bloom, c, rc)
    h = m.math('SUBTRACT', h, m.math('ADD', m.math('MULTIPLY', scale_, 0.00004), m.math('MULTIPLY', rustm, 0.00006)))
    rough = m.mixf(scale_, m.remap(T.noise(10, 3), 0.3, 0.7, 0.55, 0.7), 0.6); rough = m.mixf(m.math('MAXIMUM', rustm, bloom), rough, 0.92)
    # rivet rows along u, where the flanges usually fall
    rv = None
    for vv in (0.08, 0.42, 0.58, 0.92):
        dy = m.math('SUBTRACT', T.y, vv * H); dx = m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', T.x, W / 15)), 0.5)
        d = m.math('SQRT', m.math('ADD', m.math('POWER', m.math('MULTIPLY', dx, W / 15), 2.0), m.math('POWER', dy, 2.0)))
        r_ = m.remap(d, 0.011, 0.0); rv = r_ if rv is None else m.math('MAXIMUM', rv, r_)
    h = m.math('ADD', h, m.math('MULTIPLY', m.math('SQRT', m.math('MAXIMUM', rv, 0.0)), 0.006))
    c = m.mix(m.math('MULTIPLY', m.remap(rv, 0.0, 0.3), 0.3), c, rc)
    gr = m.math('MULTIPLY', m.remap(cav, 0.9, 0.4, smooth=True), m.remap(T.noise(25, 4), 0.3, 0.7, 0.5, 1.0)); c = m.mix(m.math('MULTIPLY', gr, 0.3), c, (0.05, 0.04, 0.03))
    c = m.mix(m.remap(T.noise(1.0, 4, 0.55, off=41.0), 0.3, 0.8, 0.2, 0.6), c, m.hsv(c, 0.5, 0.6, 0.55))
    return finish(m, c, rough, h, metal=m.mixf(scale_, 0.0, m.math('SUBTRACT', 1.0, rustm)))

def beam_set(name, mat_fn, amp=0.002):
    def fn():
        W, H = TW, BEAM_H; G = Geo(W, H); M = mat_fn(name, W, H)
        G.add(plaster_grid(0.0, W, 0.0, H, W, step=0.01, amp=amp, seed=51.0, H=H), M, {}, smooth=True)
        return {'geo': G.build(name), 'W': W, 'H': H, 'variants': 1, 'ao': 0.05, 'cav': 0.008, 'pom': 0.006, 'perimeter': 'v once round the section (arch.js)',
                'notes': name.replace('_', ' ')}
    return fn

# ================================================================ the detail tiles (common, data in R): spectral noise, periodic by construction
def spectral(n, beta, seed):
    rng = np.random.default_rng(seed); fx = np.fft.fftfreq(n)[None, :]; fy = np.fft.fftfreq(n)[:, None]; f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / f ** beta; spec[0, 0] = 0
    a = np.real(np.fft.ifft2(spec)); return (a - a.mean()) / (a.std() + 1e-9)

def detail_tiles():
    """dust_detail (fine dust: a fractal field, fibres and grit; averages about 0.5), wet_edge (where a drying edge breaks up:
       contoured mottling), grime_detail (grunge); 512 x 512, tileable, written as grey WebP (the game reads R)"""
    from PIL import Image
    n = 512; out = os.path.join(OUT, 'common'); os.makedirs(out, exist_ok=True); rng = np.random.default_rng(5)
    dust = 0.5 + 0.16 * spectral(n, 1.0, 1) + 0.08 * spectral(n, 0.6, 2)
    fib = np.zeros((n, n), np.float32)
    for _ in range(260):                                                  # (lint and hair: short bright curls, wrapped)
        x, y = rng.uniform(0, n, 2); a = rng.uniform(0, math.pi); L = rng.uniform(6, 40); br = rng.uniform(0.15, 0.4)
        for t in np.linspace(0, 1, int(L * 2)):
            a += rng.normal(0, 0.08); xi, yi = int(x + math.cos(a) * t * L) % n, int(y + math.sin(a) * t * L) % n; fib[yi, xi] = max(fib[yi, xi], br)
    grit = (rng.random((n, n)) > 0.996) * rng.uniform(0.2, 0.5, (n, n))
    dust = np.clip(dust + fib + grit, 0, 1); dust = dust - dust.mean() + 0.5
    w = spectral(n, 1.2, 3); wet = np.clip(0.5 + 0.5 * np.sin(w * 3.0) * np.clip(0.6 + 0.4 * spectral(n, 0.8, 4), 0, 1), 0, 1)
    grime = np.clip(0.5 + 0.22 * spectral(n, 1.1, 5) + 0.1 * spectral(n, 0.5, 6) - 0.12 * np.abs(spectral(n, 1.6, 7)), 0, 1)
    files = {}
    for key, a in (('dust_detail', dust), ('wet_edge', wet), ('grime_detail', grime)):
        img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).convert('RGB')
        for t, k in (('hi', 1), ('md', 1), ('lo', 2)):
            p = os.path.join(out, f'{key}.{t}.webp'); (img if k == 1 else img.resize((n // k, n // k), Image.LANCZOS)).save(p, 'WEBP', quality=92, method=6)
        files[key] = f'common/{key}'
        print(f'  {key}: mean {a.mean():.3f}, seam {abs(a[:, 0] - a[:, -1]).mean():.4f} (inner {np.abs(np.diff(a, axis=1)).mean():.4f})')
    manifest_put('common', 'detail', {'files': files, 'px': {'hi': [n, n], 'md': [n, n], 'lo': [n // 2, n // 2]}, 'channel': 'R', 'tiles': 'uv',
                                      'notes': 'dust_detail averages 0.5 (matlib packs R dust, G wet edge); grime_detail for walls and props'})

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

def room_view(style, kind, entry):
    """a corner of the style's room the way a photographer would stand in it: two walls (the back one A, B, A), the style's
       floor, a plain skirting at the style's height, daylight through a window off to the right and a warm lamp; eye 1.6 m"""
    from PIL import Image
    sc = kitlib.reset(); d = os.path.join(TMP, 'sheets', 'surf'); man = manifest_load()['styles'].get(style, {})
    W, H = TW, FH; walls = man.get('wall') if kind != 'wall' else entry; floor = man.get('floor') if kind != 'floor' else entry
    if not walls: return None
    if kind == 'service': wA = wB = ship_mat('svcA', entry, 0)
    else: wA, wB = ship_mat('wallA', walls, 0), ship_mat('wallB', walls, 1)
    for i, mt in enumerate((wA, wB, wA)): quad(f'back{i}', (i * W, 2 * W, 0), (W, 0, 0), (0, 0, H), mat=mt)          # (faces -y)
    for j, mt in enumerate((wA, wA)): quad(f'left{j}', (0, (j + 1) * W, 0), (0, -W, 0), (0, 0, H), mat=mt)          # (faces +x)
    if kind == 'upper':                                                # (the band above, 1.5 m of it)
        uA = ship_mat('upA', entry, 0)
        for i in range(3): quad(f'bu{i}', (i * W, 2 * W, H), (W, 0, 0), (0, 0, 1.5), uv1=(1, 0.5), mat=uA)
        for j in range(2): quad(f'lu{j}', (0, (j + 1) * W, H), (0, -W, 0), (0, 0, 1.5), uv1=(1, 0.5), mat=uA)
        H = H + 1.5
    if floor:
        fA, fB = ship_mat('floorA', floor, 0), ship_mat('floorB', floor, 1)
        for i in range(3):
            for j in range(2): quad(f'fl{i}{j}', (i * W, j * W, 0), (W, 0, 0), (0, W, 0), mat=fB if (i, j) == (1, 0) else fA)
    sk = TRIMS.get(style, {}).get('skirting', {}); sh, sd = sk.get('h', 0.15), sk.get('d', 0.025)
    skm = flatmat('skirt', (0.32, 0.27, 0.21) if style in ('wood', 'attic', 'workshop') else (0.55, 0.53, 0.5), 0.6)
    for (x0, y0, x1, y1) in ((0, 2 * W - sd, 3 * W, 2 * W), (0, 0, sd, 2 * W)):
        bm = box(x1 - x0, y1 - y0, sh, 0.004, 2); xform(bm, ((x0 + x1) / 2, (y0 + y1) / 2, sh / 2)); me = bpy.data.meshes.new('skirt'); bm.to_mesh(me); bm.free()
        o = kitlib.link(bpy.data.objects.new('skirt', me)); me.materials.append(skm)
    cl = entry if kind == 'ceil' else man.get('ceil')
    quad('ceil', (0, 0, H), (0, 2 * W, 0), (3 * W, 0, 0), uv1=(2, 3), mat=ship_mat('ceilA', cl, 0) if cl else flatmat('ceilm', (0.6, 0.58, 0.54), 0.9))
    sky = sc.world; sky.use_nodes = True; bg = sky.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.5, 0.56, 0.66, 1); bg.inputs['Strength'].default_value = 0.05
    win = lamp('window', 'AREA', 700, loc=(3 * W - 0.05, 1.0, 1.6), rot=(0, math.radians(-90), 0), size=1.2, color=(0.88, 0.93, 1.0))
    win.data.shape = 'RECTANGLE'; win.data.size = 1.3; win.data.size_y = 1.6
    lamp('lamp', 'POINT', 60, loc=(1.1, 2 * W - 0.6, 1.7), size=0.08, color=(1.0, 0.72, 0.45))
    if kind == 'ceil': cam_at((3.4, 0.6, 1.5), (1.2, 2 * W - 0.6, 3.0), 20)
    elif kind == 'upper': cam_at((3.6, 0.5, 1.6), (1.0, 2 * W - 0.2, 3.2), 18)
    else: cam_at((3.2, 0.7, 1.6), (0.9, 2 * W - 0.3, 1.25), 22)
    out = render(os.path.join(d, f'{style}_{kind}_room.png'), 1350, 900, 256); print('room', out, flush=True); return out

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
    p = os.path.join(d, f'{style}_{kind}.png'); out.save(p); print('sheet', p, f'{time.time() - t0:.0f}s', flush=True)
    if kind in ('wall', 'floor', 'ceil', 'upper', 'service'): room_view(style, kind, entry)
    return p

# ================================================================ main
SETS = {}
def main():
    t0 = time.time(); got = {}
    for style in STYLES + ['common']:
        for kind, fn in SETS.get(style, {}).items():
            if not wanted(style, kind): continue
            if style == 'common': detail_tiles(); got['common:detail'] = 1; continue
            got[f'{style}:{kind}'] = run_set(style, kind, fn)
    print(f'surfaces2: {len(got)} sets in {time.time() - t0:.0f}s')

if __name__ == '__main__':
    SETS['wood'] = {'floor': wood_floor, 'wall': wood_wall, 'ceil': wood_ceil, 'upper': wood_upper, 'service': service('wood')}
    SETS['tile'] = {'floor': tile_floor, 'wall': tile_wall, 'ceil': tile_ceil, 'upper': tile_upper, 'service': service('tile')}
    SETS['concrete'] = {'floor': concrete_floor, 'wall': concrete_wall, 'ceil': concrete_ceil, 'upper': concrete_upper, 'service': service('concrete'), 'beam': beam_set('concrete_beam', lambda n, W, H: timber_mat(n, W, H, tone='#6a5440', dust=0.25, wash=0.7))}
    SETS['attic'] = {'floor': attic_floor, 'wall': attic_wall, 'ceil': attic_ceil, 'upper': attic_upper, 'service': service('attic'), 'beam': beam_set('attic_beam', lambda n, W, H: timber_mat(n, W, H, tone='#5e4a36', dark='#352619', rings=80, dust=0.18, sawmarks=1.2))}
    SETS['workshop'] = {'floor': workshop_floor, 'wall': workshop_wall, 'ceil': workshop_ceil, 'upper': workshop_upper, 'service': service('workshop'), 'beam': beam_set('workshop_beam', lambda n, W, H: timber_mat(n, W, H, tone='#4e3c2c', dark='#2a1e14', rings=100, dust=0.12, soot=0.8)), 'ibeam': beam_set('workshop_ibeam', steel_mat, 0.0008)}
    SETS['common'] = {'detail': None}
    main()
