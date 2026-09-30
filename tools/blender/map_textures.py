# Escape from Barbi Blue: the house's surface textures, baked in Blender from real geometry.
# Each surface is a small 3D sample (floorboards with bevelled edges, tiles, bricks, wood panelling), wrapped so it tiles
# seamlessly, baked onto a flat square: colour, normal map (the relief) and roughness. Written to textures/ as WebP.
#   python tools/blender/map_textures.py [name ...]        (Blender's Python module: pip install bpy)
# Floors cover one tile (2.25 m square); walls one tile of wall (2.25 m wide, 3 m high; v = 0 at the floor).
import sys, os, math, random; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
from mathutils import Vector
from PIL import Image
REPO = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(REPO, 'textures'); TMP = '/tmp/efbb-tex'
os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
TW, WH = 2.25, 3.0                                          # (a tile, the walls' height)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 12
    sc.render.bake.margin = 0; sc.world = bpy.data.worlds.new('w'); sc.world.color = (1, 1, 1)
def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
def scale(c, k): return tuple(min(1.0, x * k) for x in c)
def box(size, loc, bevel=0.0, rot=(0, 0, 0), segs=2, mat=None, rand=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o = bpy.context.object
    o.scale = size; bpy.ops.object.transform_apply(scale=True)
    if bevel: m = o.modifiers.new('bv', 'BEVEL'); m.width = bevel; m.segments = segs; m.limit_method = 'ANGLE'
    if mat: o.data.materials.append(mat)
    o['rand'] = random.random() if rand is None else rand
    return o
def cyl(r, h, loc, mat=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=loc, vertices=12); o = bpy.context.object
    if mat: o.data.materials.append(mat)
    o['rand'] = random.random(); return o
def target(W, H):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(W / 2, H / 2, 0)); o = bpy.context.object; o.name = 'Target'
    o.scale = (W, H, 1); bpy.ops.object.transform_apply(scale=True); return o
def wrap(objs, W, H, u=True, v=True):
    # copies of whatever crosses an edge on the other side, so the pattern continues across the seam
    out = list(objs)
    for o in objs:
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]; x0 = min(p.x for p in bb); x1 = max(p.x for p in bb); y0 = min(p.y for p in bb); y1 = max(p.y for p in bb)
        for dx in ((-W, 0, W) if u else (0,)):
            for dy in ((-H, 0, H) if v else (0,)):
                if dx == dy == 0 or x1 + dx < 0 or x0 + dx > W or y1 + dy < 0 or y0 + dy > H: continue
                c = o.copy(); c.data = o.data; c.location = o.location + Vector((dx, dy, 0)); bpy.context.scene.collection.objects.link(c)
                for k in o.keys(): c[k] = o[k]
                out.append(c)
    return out

# ---- materials, from nodes
class M:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name); self.m.use_nodes = True; self.nt = self.m.node_tree; self.b = self.nt.nodes['Principled BSDF']
    def n(self, kind, **kw):
        node = self.nt.nodes.new(kind)
        for k, v in kw.items():
            if not k.startswith('i_'): setattr(node, k, v); continue
            raw = k[2:]; name = raw.replace('_', ' ')
            inp = next((i for i in node.inputs if i.identifier == raw and i.enabled), None) or next((i for i in node.inputs if i.name == name and i.enabled), None) \
                or next((i for i in node.inputs if i.name == name), None)
            inp.default_value = v
        return node
    def l(self, a, b): self.nt.links.new(a, b)
    def rand(self): a = self.n('ShaderNodeAttribute', attribute_type='OBJECT', attribute_name='rand'); return a.outputs['Fac']
    def coords(self, u_period=None, v_period=None, r=1.0):
        # world position; with a period: wrapped round a circle, so noise repeats exactly (seamless)
        g = self.n('ShaderNodeNewGeometry'); sep = self.n('ShaderNodeSeparateXYZ'); self.l(g.outputs['Position'], sep.inputs[0])
        comb = self.n('ShaderNodeCombineXYZ'); w = None
        def circ(val, period):
            a = self.n('ShaderNodeMath', operation='MULTIPLY', i_Value_001=2 * math.pi / period); self.l(val, a.inputs[0])
            c = self.n('ShaderNodeMath', operation='COSINE'); s = self.n('ShaderNodeMath', operation='SINE'); self.l(a.outputs[0], c.inputs[0]); self.l(a.outputs[0], s.inputs[0])
            cm = self.n('ShaderNodeMath', operation='MULTIPLY', i_Value_001=r * period / (2 * math.pi)); sm = self.n('ShaderNodeMath', operation='MULTIPLY', i_Value_001=r * period / (2 * math.pi))
            self.l(c.outputs[0], cm.inputs[0]); self.l(s.outputs[0], sm.inputs[0]); return cm.outputs[0], sm.outputs[0]
        if u_period and v_period:
            a, b = circ(sep.outputs['X'], u_period); c, d = circ(sep.outputs['Y'], v_period)
            self.l(a, comb.inputs['X']); self.l(b, comb.inputs['Y']); self.l(c, comb.inputs['Z']); w = d
        elif u_period:
            a, b = circ(sep.outputs['X'], u_period); self.l(a, comb.inputs['X']); self.l(b, comb.inputs['Y']); self.l(sep.outputs['Y'], comb.inputs['Z'])
        else:
            self.l(sep.outputs['X'], comb.inputs['X']); self.l(sep.outputs['Y'], comb.inputs['Y']); self.l(sep.outputs['Z'], comb.inputs['Z'])
        return comb.outputs[0], w
    def noise(self, vec, w, scale, detail=4, rough=0.55):
        nz = self.n('ShaderNodeTexNoise', noise_dimensions='4D' if w is not None else '3D', i_Scale=scale, i_Detail=detail, i_Roughness=rough)
        self.l(vec, nz.inputs['Vector'])
        if w is not None: self.l(w, nz.inputs['W'])
        return nz.outputs['Fac']
    def remap(self, val, a, b, c, d):
        m = self.n('ShaderNodeMapRange', i_From_Min=a, i_From_Max=b, i_To_Min=c, i_To_Max=d); self.l(val, m.inputs['Value']); return m.outputs['Result']
    def mix(self, fac, c1, c2, mode='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=mode)
        (self.l(fac, m.inputs['Factor']) if not isinstance(fac, float) else m.inputs['Factor'].__setattr__('default_value', fac))
        for i, c in ((6, c1), (7, c2)):
            (self.l(c, m.inputs[i]) if not isinstance(c, tuple) else m.inputs[i].__setattr__('default_value', (*c, 1) if len(c) == 3 else c))
        return m.outputs[2]
    def bump(self, h, strength, dist):
        bp = self.n('ShaderNodeBump', i_Strength=strength, i_Distance=dist); self.l(h, bp.inputs['Height']); self.l(bp.outputs['Normal'], self.b.inputs['Normal'])
    def out(self, color, rough):
        (self.l(color, self.b.inputs['Base Color']) if not isinstance(color, tuple) else self.b.inputs['Base Color'].__setattr__('default_value', (*color, 1)))
        (self.l(rough, self.b.inputs['Roughness']) if not isinstance(rough, float) else self.b.inputs['Roughness'].__setattr__('default_value', rough))
        return self.m
def flat(name, color, rough=0.95):
    m = M(name); return m.out(color, rough)

# ---- baking onto the target square
def bake(objs, name, W, H, px, colours=None, colour_name=None):
    """objs: the sample; colours: {variant: callback()} to re-colour the sample before each colour bake"""
    sc = bpy.context.scene; t = target(W, H); py = int(round(px * H / W))
    tm = bpy.data.materials.new('bake'); tm.use_nodes = True; t.data.materials.append(tm); node = tm.node_tree.nodes.new('ShaderNodeTexImage')
    for o in sc.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    t.select_set(True); bpy.context.view_layer.objects.active = t
    sc.render.bake.use_selected_to_active = True; sc.render.bake.cage_extrusion = 0.08; sc.render.bake.max_ray_distance = 0.2
    def one(kind, file, srgb_out):
        img = bpy.data.images.new(file, px, py, alpha=False, float_buffer=(kind == 'NORMAL'))
        if not srgb_out: img.colorspace_settings.name = 'Non-Color'
        node.image = img; tm.node_tree.nodes.active = node
        if kind == 'DIFFUSE':
            sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
            bpy.ops.object.bake(type='DIFFUSE')
        elif kind == 'NORMAL': bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        else: bpy.ops.object.bake(type=kind)
        img.filepath_raw = f'{TMP}/{file}.png'; img.file_format = 'PNG'; img.save()
        Image.open(f'{TMP}/{file}.png').convert('RGB').save(f'{OUT}/{file}.webp', 'WEBP', quality=88 if kind == 'NORMAL' else 82, method=6)
    one('NORMAL', name + '_normal', False); one('ROUGHNESS', name + '_rough', False)
    for variant, recolour in (colours or {name: None}).items():
        if recolour: recolour()
        one('DIFFUSE', variant + '_color', True)

# ================================================================ floors
def floor_wood():
    """floorboards: 16 rows a tile, boards of random length, staggered, bevelled edges, a little uneven; varnished grain"""
    reset(); random.seed(1); W = H = TW; rows = 16; rw = H / rows; gap = 0.0045
    m = M('wood'); vec, w = m.coords(TW, TW)
    rnd = m.rand()
    # the grain along each board: wave bands on the board's own coordinates, shifted by its random value
    tc = m.n('ShaderNodeTexCoord'); off = m.n('ShaderNodeVectorMath', operation='SCALE', i_Scale=31.0); m.l(rnd, off.inputs[0])
    add = m.n('ShaderNodeVectorMath', operation='ADD'); m.l(tc.outputs['Object'], add.inputs[0]); m.l(off.outputs[0], add.inputs[1])
    mp = m.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.2, 26, 26); m.l(add.outputs[0], mp.inputs['Vector'])
    wave = m.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y', i_Scale=1.1, i_Distortion=3.5, i_Detail=4, i_Detail_Scale=2.0); m.l(mp.outputs[0], wave.inputs['Vector'])
    fine = m.n('ShaderNodeTexNoise', i_Scale=60, i_Detail=8); m.l(mp.outputs[0], fine.inputs['Vector'])
    streak = m.n('ShaderNodeMapping'); streak.inputs['Scale'].default_value = (0.6, 90, 90); m.l(add.outputs[0], streak.inputs['Vector'])
    fib = m.n('ShaderNodeTexNoise', i_Scale=4, i_Detail=10, i_Roughness=0.7); m.l(streak.outputs[0], fib.inputs['Vector'])
    grain = m.n('ShaderNodeMath', operation='MULTIPLY_ADD', i_Value_001=0.75, i_Value_002=0.0); m.l(wave.outputs['Fac'], grain.inputs[0])
    g2 = m.n('ShaderNodeMath', operation='ADD'); m.l(grain.outputs[0], g2.inputs[0]); m.l(m.remap(fib.outputs['Fac'], 0.3, 0.7, -0.25, 0.25), g2.inputs[1]); grain = g2
    ramp = m.n('ShaderNodeValToRGB'); m.l(grain.outputs[0], ramp.inputs['Fac'])
    tint = m.n('ShaderNodeHueSaturation'); m.l(ramp.outputs['Color'], tint.inputs['Color']); m.l(m.remap(rnd, 0, 1, 0.7, 1.28), tint.inputs['Value'])
    m.l(m.remap(rnd, 0, 1, 0.47, 0.53), tint.inputs['Hue']); m.l(m.remap(rnd, 0, 1, 0.75, 1.2), tint.inputs['Saturation'])
    wear = m.noise(vec, w, 3.0, 5)
    col = m.mix(m.remap(wear, 0.45, 0.8, 0.0, 0.45), tint.outputs['Color'], (0.3, 0.26, 0.22), 'MULTIPLY')
    m.bump(grain.outputs[0], 1.0, 0.0035)
    mat = m.out(col, m.remap(wear, 0.2, 0.8, 0.3, 0.75))
    def colour(hexc):
        c = srgb(hexc); e = ramp.color_ramp.elements
        e[0].color = (*scale(c, 0.42), 1); e[1].color = (*scale(c, 1.9), 1)
    objs = []
    for r in range(rows):
        # (boards that add up to exactly one tile, so the row repeats without any overlapping its own copy)
        lens = []
        while sum(lens) < W - 0.75: lens.append(random.uniform(0.75, 1.6))
        lens.append(W - sum(lens)) if W - sum(lens) > 0.3 else lens.__setitem__(-1, lens[-1] + W - sum(lens))
        x = -random.uniform(0, lens[0])
        for L in lens:
            objs.append(box((L - gap, rw - gap, 0.02), (x + L / 2, r * rw + rw / 2, -0.01 + random.uniform(-0.0012, 0.0012)), bevel=0.0038, segs=3,
                            rot=(random.uniform(-0.008, 0.008), random.uniform(-0.003, 0.003), 0), mat=mat)); x += L
    objs = wrap(objs, W, H)
    objs.append(box((W * 3, H * 3, 0.01), (W / 2, H / 2, -0.03), mat=flat('gap', (0.012, 0.009, 0.007), 1.0)))
    colour('#3b2722')
    bake(objs, 'floor_wood', W, H, 1024, colours={'floor_wood1': lambda: colour('#3b2722'), 'floor_wood4': lambda: colour('#3a2c20')})

def floor_tile():
    """checkerboard tiles, 8 a tile (28 cm), bevelled, a few cracked or sunk, grout between"""
    reset(); random.seed(2); W = H = TW; n = 8; s = W / n; gap = 0.005
    m = M('tile'); vec, w = m.coords(TW, TW); rnd = m.rand()
    ca = m.n('ShaderNodeRGB'); cb = m.n('ShaderNodeRGB'); pick = m.n('ShaderNodeAttribute', attribute_type='OBJECT', attribute_name='dark')
    base = m.mix(pick.outputs['Fac'], ca.outputs[0], cb.outputs[0])
    cloud = m.noise(vec, w, 5.0, 6)
    var = m.n('ShaderNodeHueSaturation'); m.l(base, var.inputs['Color']); m.l(m.remap(rnd, 0, 1, 0.85, 1.15), var.inputs['Value'])
    col = m.mix(m.remap(cloud, 0.35, 0.75, 0.0, 0.3), var.outputs['Color'], (0.2, 0.2, 0.2), 'MULTIPLY')
    m.bump(cloud, 0.5, 0.004)
    mat = m.out(col, m.remap(cloud, 0.3, 0.8, 0.12, 0.5))
    def colour(a, b):
        ca.outputs[0].default_value = (*srgb(a), 1); cb.outputs[0].default_value = (*srgb(b), 1)
    objs = []
    for i in range(n):
        for j in range(n):
            sunk = -0.0015 if random.random() < 0.06 else random.uniform(-0.0004, 0.0004)
            o = box((s - gap, s - gap, 0.012), ((i + 0.5) * s, (j + 0.5) * s, -0.006 + sunk), bevel=0.0028, rot=(random.uniform(-0.004, 0.004), random.uniform(-0.004, 0.004), random.uniform(-0.004, 0.004)), mat=mat)
            o['dark'] = float((i + j) % 2); objs.append(o)
    objs = wrap(objs, W, H)
    grout = box((W * 3, H * 3, 0.01), (W / 2, H / 2, -0.016), mat=flat('grout', (0.02, 0.02, 0.02), 1.0)); objs.append(grout)
    gm = grout.data.materials[0].node_tree.nodes['Principled BSDF']
    def recolour(a, b, g): colour(a, b); gm.inputs['Base Color'].default_value = (*srgb(g), 1)
    recolour('#22333a', '#0f181b', '#070b0c')
    bake(objs, 'floor_tile', W, H, 1024, colours={'floor_tile2': lambda: recolour('#2e4650', '#142226', '#0b1012'), 'floor_tile5': lambda: recolour('#5a564e', '#23211e', '#100f0d')})

def floor_concrete():
    """a concrete slab: trowel marks, pits, cracks, damp stains; a joint along the tile's edges"""
    reset(); random.seed(3); W = H = TW
    m = M('concrete'); vec, w = m.coords(TW, TW)
    big = m.noise(vec, w, 1.2, 4); mid = m.noise(vec, w, 7, 6); pits = m.noise(vec, w, 90, 2)
    c0 = srgb('#2c2a25')
    col = m.mix(m.remap(big, 0.3, 0.7, 0, 1), scale(c0, 0.75), scale(c0, 1.35))
    col = m.mix(m.remap(mid, 0.45, 0.75, 0, 0.5), col, (0.08, 0.1, 0.12), 'MULTIPLY')        # (damp)
    h = m.n('ShaderNodeMath', operation='ADD'); m.l(m.remap(mid, 0, 1, 0, 0.6), h.inputs[0]); m.l(m.remap(pits, 0.62, 0.72, 0, -0.5), h.inputs[1])
    m.bump(h.outputs[0], 1.0, 0.03)
    mat = m.out(col, m.remap(mid, 0.3, 0.8, 0.7, 0.95))
    slab = box((W * 3, H * 3, 0.05), (W / 2, H / 2, -0.025), mat=mat)
    objs = [slab]
    for k in range(5):                                         # (cracks: thin dark grooves)
        x, y = random.uniform(0, W), random.uniform(0, H); ang = random.uniform(0, math.pi)
        for seg in range(6):
            L = random.uniform(0.08, 0.2); ang += random.uniform(-0.6, 0.6)
            o = box((L, 0.003, 0.01), (x + math.cos(ang) * L / 2, y + math.sin(ang) * L / 2, 0.0), rot=(0, 0, ang), mat=flat('crack', (0.01, 0.01, 0.01), 1.0))
            o.location.z = -0.002; objs.append(o); x += math.cos(ang) * L; y += math.sin(ang) * L
    for j in (0.0, W):                                         # (the joints at the tile's edges)
        objs.append(box((W * 3, 0.006, 0.02), (W / 2, j, -0.006), mat=flat('joint', (0.02, 0.02, 0.02), 1.0)))
        objs.append(box((0.006, H * 3, 0.02), (j, H / 2, -0.006), mat=flat('joint', (0.02, 0.02, 0.02), 1.0)))
    bake(wrap(objs[1:], W, H) + [slab], 'floor_concrete', W, H, 1024, colours={'floor_concrete3': None})

# ================================================================ walls (x across, y up from the floor)
def pattern_paper(m, vec, w, face, pat, dot):
    """wallpaper: a repeating floral lattice (periodic across the wall), printed, a little embossed"""
    g = m.n('ShaderNodeNewGeometry'); sep = m.n('ShaderNodeSeparateXYZ'); m.l(g.outputs['Position'], sep.inputs[0])
    def per(val, k):   # sin(2 pi k val / TW)
        a = m.n('ShaderNodeMath', operation='MULTIPLY', i_Value_001=2 * math.pi * k / TW); m.l(val, a.inputs[0]); s = m.n('ShaderNodeMath', operation='SINE'); m.l(a.outputs[0], s.inputs[0]); return s.outputs[0]
    su, sv = per(sep.outputs['X'], 6), per(sep.outputs['Y'], 6)
    su2, sv2 = per(sep.outputs['X'], 12), per(sep.outputs['Y'], 12)
    p = m.n('ShaderNodeMath', operation='MULTIPLY'); m.l(su, p.inputs[0]); m.l(sv, p.inputs[1])
    p2 = m.n('ShaderNodeMath', operation='MULTIPLY'); m.l(su2, p2.inputs[0]); m.l(sv2, p2.inputs[1])
    petals = m.n('ShaderNodeMath', operation='ABSOLUTE'); m.l(p.outputs[0], petals.inputs[0])
    motif = m.remap(petals.outputs[0], 0.55, 0.75, 0, 1)
    dots = m.remap(p2.outputs[0], 0.8, 0.95, 0, 1)
    col = m.mix(motif, face, pat); col = m.mix(dots, col, dot)
    age = m.noise(vec, w, 2.0, 5)
    col = m.mix(m.remap(age, 0.5, 0.85, 0, 0.55), col, (0.12, 0.1, 0.07), 'MULTIPLY')    # (stains, water damage)
    h = m.n('ShaderNodeMath', operation='ADD'); m.l(motif, h.inputs[0]); m.l(m.remap(age, 0, 1, 0, 0.3), h.inputs[1])
    return col, h.outputs[0], age
def wall_paper():
    """the nursery: wallpaper above, raised-panel wainscoting below the chair rail (0.93 m)"""
    reset(); random.seed(4); W, H = TW, WH
    m = M('paper'); vec, w = m.coords(TW, None)
    col, h, age = pattern_paper(m, vec, w, srgb('#6a3d54'), srgb('#7f4b66'), srgb('#d3a9bd'))
    m.bump(h, 1.0, 0.004); paper = m.out(col, m.remap(age, 0.3, 0.9, 0.55, 0.85))
    wood = M('panel'); wv, ww = wood.coords(TW, None); gn = wood.noise(wv, ww, 18, 6)
    wc = wood.mix(wood.remap(gn, 0.3, 0.7, 0, 1), scale(srgb('#2a1820'), 0.8), scale(srgb('#2a1820'), 1.4)); wood.bump(gn, 1.0, 0.004)
    panel_m = wood.out(wc, wood.remap(gn, 0.2, 0.8, 0.35, 0.6))
    objs = [box((W * 3, 0.02, 2.2), (W / 2, 0.01, 0.98 + 1.1), mat=paper)]
    for o in objs: o.rotation_euler = (0, 0, 0)
    # panelling: a backing board, two raised panels a tile, framed by rails and stiles
    objs.append(box((W * 3, 0.02, 0.93), (W / 2, 0.01, 0.465), mat=panel_m))
    for k in range(2):
        cx = (k + 0.5) * W / 2
        objs.append(box((W / 2 - 0.16, 0.012, 0.52), (cx, -0.006, 0.18 + 0.33), bevel=0.012, segs=3, mat=panel_m))
    for zc, hh in ((0.19, 0.06), (0.87, 0.07)):
        objs.append(box((W * 3, 0.018, hh), (W / 2, -0.009, zc), bevel=0.004, mat=panel_m))
    for k in range(3):
        objs.append(box((0.07, 0.018, 0.7), (k * W / 2, -0.009, 0.53), bevel=0.004, mat=panel_m))
    # (the sample stands up: turn it so the wall faces +Z like the target square)
    return bake_wall(objs, 'wall_paper', {'wall_paper1': None})

def bake_wall(objs, name, colours):
    W, H = TW, WH
    # the sample was built standing (x across, z up, facing -y): lay it down to face +z, with the floor at y = 0
    for o in objs:
        o.location = Vector((o.location.x, o.location.z, -o.location.y)); o.rotation_euler = (o.rotation_euler.x - math.pi / 2, o.rotation_euler.y, o.rotation_euler.z)
    return bake(wrap(objs, W, H, v=False), name, W, H, 768, colours=colours)

def wall_tile():
    """glazed wall tiles (15 cm), bevelled, darker below the rail (0.87 m); some cracked"""
    reset(); random.seed(5); W, H = TW, WH; n = 15; s = W / n; gap = 0.004
    m = M('wtile'); vec, w = m.coords(TW, None); rnd = m.rand(); low = m.n('ShaderNodeAttribute', attribute_type='OBJECT', attribute_name='low')
    ca, cb = m.n('ShaderNodeRGB'), m.n('ShaderNodeRGB'); base = m.mix(low.outputs['Fac'], ca.outputs[0], cb.outputs[0])
    var = m.n('ShaderNodeHueSaturation'); m.l(base, var.inputs['Color']); m.l(m.remap(rnd, 0, 1, 0.82, 1.18), var.inputs['Value'])
    grime = m.noise(vec, w, 3.0, 6)
    col = m.mix(m.remap(grime, 0.4, 0.8, 0, 0.5), var.outputs['Color'], (0.18, 0.2, 0.16), 'MULTIPLY')
    m.bump(grime, 0.4, 0.003); mat = m.out(col, m.remap(grime, 0.3, 0.8, 0.1, 0.45))
    ca.outputs[0].default_value = (*srgb('#2f5a67'), 1); cb.outputs[0].default_value = (*srgb('#1b3a44'), 1)
    objs = [box((W * 3, 0.02, H + 0.2), (W / 2, 0.012, H / 2), mat=flat('grout', (0.04, 0.045, 0.045), 1.0))]
    rows = int(H / s) + 1
    for i in range(n):
        for j in range(rows):
            z = (j + 0.5) * s
            o = box((s - gap, 0.01, s - gap), ((i + 0.5) * s, -0.004 + random.uniform(-0.0006, 0.0006), z), bevel=0.003, mat=mat,
                    rot=(random.uniform(-0.006, 0.006), 0, random.uniform(-0.004, 0.004)))
            o['low'] = 1.0 if z < 0.87 else 0.0
    objs += [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in objs]
    return bake_wall(objs, 'wall_tile', {'wall_tile2': None})

def wall_brick():
    """the basement: old bricks in mortar, bevelled and chipped, damp near the floor"""
    reset(); random.seed(6); W, H = TW, WH; bw, bh = W / 10, 0.075; gap = 0.011
    m = M('brick'); vec, w = m.coords(TW, None); rnd = m.rand()
    c0 = srgb('#4d3b2e'); var = m.n('ShaderNodeHueSaturation'); var.inputs['Color'].default_value = (*c0, 1)
    m.l(m.remap(rnd, 0, 1, 0.65, 1.35), var.inputs['Value']); m.l(m.remap(rnd, 0, 1, 0.47, 0.53), var.inputs['Hue'])
    rough = m.noise(vec, w, 25, 6); damp = m.noise(vec, w, 1.5, 4)
    g = m.n('ShaderNodeNewGeometry'); sep = m.n('ShaderNodeSeparateXYZ'); m.l(g.outputs['Position'], sep.inputs[0])
    low = m.remap(sep.outputs['Z'], 0.0, 0.9, 0.7, 0.0)                 # (the damp creeps up from the floor)
    col = m.mix(m.remap(rough, 0.3, 0.7, 0, 0.35), var.outputs['Color'], (0.3, 0.28, 0.25), 'MULTIPLY')
    col = m.mix(low, col, (0.06, 0.07, 0.07), 'MULTIPLY')
    m.bump(rough, 1.0, 0.012); mat = m.out(col, m.remap(rough, 0.2, 0.8, 0.7, 0.95))
    objs = [box((W * 3, 0.03, H + 0.2), (W / 2, 0.02, H / 2), mat=flat('mortar', srgb('#241d17'), 1.0))]
    rows = int(H / bh) + 1
    for j in range(rows):
        off = (bw / 2) if j % 2 else 0
        for i in range(-1, 11):
            x = i * bw + off + bw / 2
            objs.append(box((bw - gap, 0.05, bh - gap), (x, -0.012 + random.uniform(-0.002, 0.002), (j + 0.5) * bh), bevel=random.uniform(0.003, 0.007), mat=mat,
                            rot=(random.uniform(-0.01, 0.01), random.uniform(-0.01, 0.01), random.uniform(-0.01, 0.01))))
    return bake_wall(objs, 'wall_brick', {'wall_brick3': None})

def wall_attic():
    """the attic: rough vertical boards with gaps and nail heads"""
    reset(); random.seed(7); W, H = TW, WH; n = 14; bw = W / n
    m = M('board'); vec, w = m.coords(TW, None); rnd = m.rand()
    tc = m.n('ShaderNodeTexCoord'); mp = m.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (14, 14, 0.8)
    off = m.n('ShaderNodeVectorMath', operation='SCALE', i_Scale=23.0); m.l(rnd, off.inputs[0]); add = m.n('ShaderNodeVectorMath', operation='ADD')
    m.l(tc.outputs['Object'], add.inputs[0]); m.l(off.outputs[0], add.inputs[1]); m.l(add.outputs[0], mp.inputs['Vector'])
    wave = m.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', i_Scale=2.2, i_Distortion=2.2, i_Detail=3, i_Detail_Scale=1.5); m.l(mp.outputs[0], wave.inputs['Vector'])
    c0 = srgb('#4a3726'); col = m.mix(wave.outputs['Fac'], scale(c0, 0.55), scale(c0, 1.3))
    var = m.n('ShaderNodeHueSaturation'); m.l(col, var.inputs['Color']); m.l(m.remap(rnd, 0, 1, 0.7, 1.25), var.inputs['Value'])
    m.bump(wave.outputs['Fac'], 1.0, 0.004); mat = m.out(var.outputs['Color'], 0.85)
    objs = [box((W * 3, 0.02, H + 0.2), (W / 2, 0.03, H / 2), mat=flat('behind', (0.01, 0.008, 0.006), 1.0))]
    for i in range(n):
        objs.append(box((bw - random.uniform(0.004, 0.012), 0.022, H + 0.1), ((i + 0.5) * bw, 0.0, H / 2), bevel=0.003, mat=mat, rot=(0, random.uniform(-0.01, 0.01), 0)))
        for z in (0.4, 1.5, 2.6):
            objs.append(cyl(0.006, 0.004, ((i + 0.5) * bw + random.uniform(-0.02, 0.02), -0.012, z), mat=flat('nail', (0.05, 0.045, 0.04), 0.4)))
    for o in objs[1:]:
        if o.name.startswith('Cylinder'): o.rotation_euler = (math.pi / 2, 0, 0)
    return bake_wall(objs, 'wall_attic', {'wall_attic4': None})

def wall_shop():
    """the workshop: cracked, stained plaster painted grey-green above; vertical boards below the rail (0.93 m)"""
    reset(); random.seed(8); W, H = TW, WH
    m = M('plaster'); vec, w = m.coords(TW, None)
    big = m.noise(vec, w, 1.8, 5); fine = m.noise(vec, w, 40, 6)
    c0 = srgb('#4e5647'); col = m.mix(m.remap(big, 0.3, 0.7, 0, 1), scale(c0, 0.7), scale(c0, 1.3))
    col = m.mix(m.remap(big, 0.6, 0.8, 0, 0.6), col, (0.1, 0.09, 0.07), 'MULTIPLY')
    h = m.n('ShaderNodeMath', operation='ADD'); m.l(fine, h.inputs[0]); m.l(big, h.inputs[1]); m.bump(h.outputs[0], 1.0, 0.01)
    plaster = m.out(col, 0.9)
    objs = [box((W * 3, 0.02, 2.2), (W / 2, 0.01, 0.97 + 1.1), mat=plaster)]
    for k in range(4):                                         # (cracks in the plaster)
        x, z = random.uniform(0, W), random.uniform(1.2, 2.8); ang = random.uniform(-2.5, -0.6)
        for seg in range(5):
            L = random.uniform(0.05, 0.15); ang += random.uniform(-0.5, 0.5)
            objs.append(box((L, 0.01, 0.003), (x + math.cos(ang) * L / 2, 0.0, z + math.sin(ang) * L / 2), rot=(0, -ang, 0), mat=flat('crack', (0.01, 0.01, 0.01), 1.0)))
            x += math.cos(ang) * L; z += math.sin(ang) * L
    bm = M('boards'); bv, bwn = bm.coords(TW, None); bn = bm.noise(bv, bwn, 20, 6); c1 = srgb('#2a1d14')
    bcol = bm.mix(bm.remap(bn, 0.3, 0.7, 0, 1), scale(c1, 0.7), scale(c1, 1.4)); bm.bump(bn, 1.0, 0.004); boards = bm.out(bcol, 0.8)
    for i in range(12):
        objs.append(box((W / 12 - 0.006, 0.02, 0.93), ((i + 0.5) * W / 12, -0.012, 0.465), bevel=0.003, mat=boards))
    objs.append(box((W * 3, 0.02, 0.95), (W / 2, 0.02, 0.475), mat=flat('behind', (0.01, 0.01, 0.01), 1.0)))
    return bake_wall(objs, 'wall_shop', {'wall_shop5': None})

ALL = {'floor_wood': floor_wood, 'floor_tile': floor_tile, 'floor_concrete': floor_concrete,
       'wall_paper': wall_paper, 'wall_tile': wall_tile, 'wall_brick': wall_brick, 'wall_attic': wall_attic, 'wall_shop': wall_shop}
if __name__ == '__main__':
    import time
    for name in (sys.argv[1:] or list(ALL)):
        t0 = time.time(); ALL[name](); print(name, 'baked in %.1fs' % (time.time() - t0), flush=True)
