# Escape from Barbi Blue: the loose floorboards (models/boards.glb), made in Blender: a section of four old floorboards
# (14.6 cm wide, 2 cm thick) lifted out of the floor. Each plank is its own warped shape (cupped: its edges curl up; bowed along
# its length; one end lifted; worn, chipped edges; one broken off short with a splintered end), with rusty nails (some bent or
# standing up, one gone, leaving its hole). The wood is baked into the section's own textures: grain with growth rings and
# knots, a worn lighter path down the middle, scratches, cracks at the ends, grime in the gaps and along the edges, rust
# bleeding round the nails. Two sizes: BoardShort (1.08 x 0.585 m) and BoardLong (2.07 m, lying right across a corridor).
# Lying along x, centred on the origin, the floor at y = 0 (in the game).
#   python tools/blender/boards.py          (Blender's Python module: pip install bpy)
import sys, os, math, random; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector, noise
REPO = os.path.dirname(os.path.dirname(HERE)); TMP = '/tmp/efbb-boards'; os.makedirs(TMP, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 24
sc.world = bpy.data.worlds.new('w'); sc.world.color = (1, 1, 1); sc.render.bake.margin = 6

def plank(L, W, T, x0, y0, seed, lift=0.0, broken=0.0, uv_strip=(0, 1), nail_xy=(), dark=0.0):
    """one floorboard as a closed mesh: a height-field top (cupping, bowing, worn edges), sides and a flat bottom.
       uv_strip: the part of the texture (v from, v to) its top face gets; the sides share a thin band at the bottom.
       Vertex colours: R = rust (round the nails), G = how worn the edge is, B = this plank's own darkness"""
    rnd = random.Random(seed); nx, ny = max(12, int(L / 0.04)), 6
    cup, bow, twist = rnd.uniform(0.0015, 0.0035), rnd.uniform(-0.004, 0.004), rnd.uniform(-0.003, 0.003)
    end_r = L / 2 - (broken if broken else 0)
    def surf(u, v):                         # u 0..1 along, v 0..1 across -> (x, y, z) of the top
        x = -L / 2 + u * L; y = -W / 2 + v * W
        if broken and u > 0.9:                                   # (a splintered end: jagged, the broken piece gone)
            x = min(x, end_r + (noise.noise(Vector((v * 9.0, seed * 3.1, 0.5))) * 0.03))
        c = (2 * v - 1) ** 2
        z = T + cup * c + bow * math.sin(math.pi * u) + twist * (2 * v - 1) * (2 * u - 1)
        z += lift * u ** 1.6                                     # (one end lifted)
        z += noise.noise(Vector((x * 7, y * 7, seed))) * 0.0006
        edge = min(v, 1 - v) * W, min(u, 1 - u) * L
        e = min(edge)
        if e < 0.006: z -= (0.006 - e) * 0.55 * (1 + noise.noise(Vector((x * 40, y * 40, seed))) * 0.6)   # (rounded, chipped edges)
        return Vector((x0 + x, y0 + y, z))
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); col = bm.loops.layers.color.new('Col')
    top = [[bm.verts.new(surf(i / nx, j / ny)) for j in range(ny + 1)] for i in range(nx + 1)]
    bot = [[bm.verts.new(Vector((top[i][j].co.x, top[i][j].co.y, lift * (i / nx) ** 1.6 - 0.002))) for j in range(ny + 1)] for i in range(nx + 1)]
    v0, v1 = uv_strip
    def vcol(p):
        rust = 0.0
        for (nxp, nyp) in nail_xy:
            d = math.hypot(p.x - nxp, p.y - nyp); rust = max(rust, math.exp(-(d / 0.018) ** 2) * (1 + 0.5 * noise.noise(Vector((p.x * 90, p.y * 90, 1)))))
        wear = max(0.0, 1 - min(abs(p.y - y0 + W / 2), abs(p.y - y0 - W / 2), abs(p.x - x0 + L / 2), abs(p.x - x0 - L / 2)) / 0.012)
        return (min(1, rust), wear, dark, 1)
    def quad(a, b, c, d, uvs, side=False):
        f = bm.faces.new((a, b, c, d)); f.material_index = 1 if side else 0
        for loop, uv in zip(f.loops, uvs): loop[uvl].uv = uv; loop[col] = vcol(loop.vert.co)
        return f
    for i in range(nx):
        for j in range(ny):
            quad(top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1],
                 [(i / nx, v0 + (v1 - v0) * j / ny), ((i + 1) / nx, v0 + (v1 - v0) * j / ny), ((i + 1) / nx, v0 + (v1 - v0) * (j + 1) / ny), (i / nx, v0 + (v1 - v0) * (j + 1) / ny)])
            quad(bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j], bot[i][j], [(0, 0)] * 4, True)
    sv = (0.005, 0.06)                          # (the sides: a thin band of the texture, the edge of the wood)
    for i in range(nx):
        for j in (0, ny):
            a, b, c, d = (top[i][j], top[i + 1][j], bot[i + 1][j], bot[i][j]) if j == 0 else (top[i + 1][j], top[i][j], bot[i][j], bot[i + 1][j])
            quad(a, b, c, d, [(i / nx, sv[1]), ((i + 1) / nx, sv[1]), ((i + 1) / nx, sv[0]), (i / nx, sv[0])], True)
    for j in range(ny):
        for i in (0, nx):
            a, b, c, d = (top[i][j + 1], top[i][j], bot[i][j], bot[i][j + 1]) if i == 0 else (top[i][j], top[i][j + 1], bot[i][j + 1], bot[i][j])
            quad(a, b, c, d, [(j / ny * 0.05, sv[1]), ((j + 1) / ny * 0.05, sv[1]), ((j + 1) / ny * 0.05, sv[0]), (j / ny * 0.05, sv[0])], True)
    bm.normal_update()
    me = bpy.data.meshes.new('plank'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('plank', me); sc.collection.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    return o

def old_wood(name, seed):
    """old floorboards: cathedral grain and growth rings, knots, a worn lighter path, scratches along the grain, cracks
       at the ends, grime in the gaps and along the edges (ambient occlusion), rust round the nails (vertex colour R)"""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    def N(kind, **kw):
        node = nt.nodes.new(kind)
        for k, v in kw.items():
            if k.startswith('i_'):
                name_ = k[2:].replace('_', ' '); inp = next((i for i in node.inputs if i.identifier == k[2:]), None) or next(i for i in node.inputs if i.name == name_)
                inp.default_value = v
            else: setattr(node, k, v)
        return node
    L = lambda a, b_: nt.links.new(a, b_)
    geo = N('ShaderNodeNewGeometry'); vc = N('ShaderNodeVertexColor', layer_name='Col'); sep = N('ShaderNodeSeparateColor'); L(vc.outputs['Color'], sep.inputs['Color'])
    pos = geo.outputs['Position']
    # grain: rings round the plank's length (rings wave, pushed about by noise), fine fibres along it
    mp = N('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.35, 9, 22); mp.inputs['Location'].default_value = (seed * 1.7, seed * 0.9, 0.3); L(pos, mp.inputs['Vector'])
    warp = N('ShaderNodeTexNoise', i_Scale=1.2, i_Detail=3); L(mp.outputs[0], warp.inputs['Vector'])
    wv = N('ShaderNodeVectorMath', operation='ADD'); L(mp.outputs[0], wv.inputs[0]); L(warp.outputs['Color'], wv.inputs[1])
    rings = N('ShaderNodeTexWave', wave_type='RINGS', rings_direction='X', i_Scale=2.6, i_Distortion=2.5, i_Detail=4, i_Detail_Scale=1.5); L(wv.outputs[0], rings.inputs['Vector'])
    fm = N('ShaderNodeMapping'); fm.inputs['Scale'].default_value = (4, 260, 260); L(pos, fm.inputs['Vector'])
    fibres = N('ShaderNodeTexNoise', i_Scale=1.0, i_Detail=12, i_Roughness=0.75); L(fm.outputs[0], fibres.inputs['Vector'])
    # knots: a few dark round spots with rings bent round them
    kv = N('ShaderNodeTexVoronoi', i_Scale=3.2, i_Randomness=1.0); km = N('ShaderNodeMapping'); km.inputs['Scale'].default_value = (1, 3.5, 1); L(pos, km.inputs['Vector']); L(km.outputs[0], kv.inputs['Vector'])
    knot = N('ShaderNodeMapRange', i_From_Min=0.03, i_From_Max=0.09, i_To_Min=1.0, i_To_Max=0.0); L(kv.outputs['Distance'], knot.inputs['Value'])
    # the colour: dark old wood, lighter latewood bands; each plank its own tone (B), knots near black
    grain = N('ShaderNodeMath', operation='MULTIPLY_ADD', i_Value_001=0.75, i_Value_002=0.0); L(rings.outputs['Fac'], grain.inputs[0])
    g2 = N('ShaderNodeMath', operation='ADD'); L(grain.outputs[0], g2.inputs[0]); fr = N('ShaderNodeMapRange', i_To_Min=-0.22, i_To_Max=0.22); L(fibres.outputs['Fac'], fr.inputs['Value']); L(fr.outputs['Result'], g2.inputs[1])
    ramp = N('ShaderNodeValToRGB'); e = ramp.color_ramp.elements
    e[0].position = 0.25; e[0].color = (0.013, 0.007, 0.0035, 1); e[1].position = 0.85; e[1].color = (0.085, 0.048, 0.024, 1)
    L(g2.outputs[0], ramp.inputs['Fac'])
    tone = N('ShaderNodeHueSaturation'); L(ramp.outputs['Color'], tone.inputs['Color'])
    tv = N('ShaderNodeMapRange', i_To_Min=1.25, i_To_Max=0.62); L(sep.outputs['Blue'], tv.inputs['Value']); L(tv.outputs['Result'], tone.inputs['Value'])
    ts = N('ShaderNodeMapRange', i_To_Min=0.95, i_To_Max=0.6); L(sep.outputs['Blue'], ts.inputs['Value']); L(ts.outputs['Result'], tone.inputs['Saturation'])
    c = tone.outputs['Color']
    def mix(fac, a, bb, mode='MIX'):
        mx = N('ShaderNodeMix', data_type='RGBA', blend_type=mode); (L(fac, mx.inputs['Factor']) if not isinstance(fac, float) else mx.inputs['Factor'].__setattr__('default_value', fac))
        for i, v in ((6, a), (7, bb)): (L(v, mx.inputs[i]) if not isinstance(v, tuple) else mx.inputs[i].__setattr__('default_value', (*v, 1)))
        return mx.outputs[2]
    c = mix(knot.outputs['Result'], c, (0.008, 0.005, 0.003))
    # worn lighter path down the middle (feet), greyed by dust; scratches along the grain
    y = N('ShaderNodeSeparateXYZ'); L(pos, y.inputs[0])
    wn = N('ShaderNodeTexNoise', i_Scale=4, i_Detail=5); L(pos, wn.inputs['Vector'])
    wear = N('ShaderNodeMapRange', i_From_Min=0.45, i_From_Max=0.7, i_To_Min=0.0, i_To_Max=0.35); L(wn.outputs['Fac'], wear.inputs['Value'])
    c = mix(wear.outputs['Result'], c, (0.11, 0.075, 0.045))
    sm = N('ShaderNodeMapping'); sm.inputs['Scale'].default_value = (1.5, 90, 1); L(pos, sm.inputs['Vector'])
    scr = N('ShaderNodeTexNoise', i_Scale=3, i_Detail=2); L(sm.outputs[0], scr.inputs['Vector'])
    sc_ = N('ShaderNodeMapRange', i_From_Min=0.62, i_From_Max=0.68, i_To_Min=0.0, i_To_Max=0.5); L(scr.outputs['Fac'], sc_.inputs['Value'])
    c = mix(sc_.outputs['Result'], c, (0.15, 0.1, 0.062))
    # grime: in the gaps and along the edges (ambient occlusion), and where edges are worn (G) it's lighter bare wood
    ao = N('ShaderNodeAmbientOcclusion', samples=16, only_local=False, i_Distance=0.03)
    aom = N('ShaderNodeMapRange', i_From_Min=0.3, i_From_Max=1.0, i_To_Min=0.25, i_To_Max=1.0); L(ao.outputs['AO'], aom.inputs['Value'])
    gr = N('ShaderNodeCombineColor'); L(aom.outputs['Result'], gr.inputs['Red']); L(aom.outputs['Result'], gr.inputs['Green']); L(aom.outputs['Result'], gr.inputs['Blue'])
    c = mix(1.0, c, gr.outputs['Color'], 'MULTIPLY')
    c = mix(sep.outputs['Green'], c, (0.075, 0.05, 0.03))
    # rust bleeding round the nails (R)
    rn = N('ShaderNodeTexNoise', i_Scale=60, i_Detail=4); L(pos, rn.inputs['Vector'])
    rm = N('ShaderNodeMath', operation='MULTIPLY'); L(sep.outputs['Red'], rm.inputs[0]); rr = N('ShaderNodeMapRange', i_To_Min=0.6, i_To_Max=1.3); L(rn.outputs['Fac'], rr.inputs['Value']); L(rr.outputs['Result'], rm.inputs[1])
    rc = N('ShaderNodeMath', operation='MINIMUM', i_Value_001=0.9); L(rm.outputs[0], rc.inputs[0])
    c = mix(rc.outputs[0], c, (0.06, 0.018, 0.006))
    # cracks at the plank ends: thin dark splits along the grain
    ck = N('ShaderNodeMapping'); ck.inputs['Scale'].default_value = (0.8, 40, 1); L(pos, ck.inputs['Vector'])
    cn = N('ShaderNodeTexNoise', i_Scale=2, i_Detail=3); L(ck.outputs[0], cn.inputs['Vector'])
    crack = N('ShaderNodeMapRange', i_From_Min=0.495, i_From_Max=0.505, i_To_Min=0.0, i_To_Max=1.0, clamp=True); L(cn.outputs['Fac'], crack.inputs['Value'])
    cinv = N('ShaderNodeMath', operation='SUBTRACT', i_Value=1.0); L(crack.outputs['Result'], cinv.inputs[1])
    cmask = N('ShaderNodeMath', operation='MULTIPLY'); L(cinv.outputs[0], cmask.inputs[0]); L(sep.outputs['Green'], cmask.inputs[1])
    c = mix(cmask.outputs[0], c, (0.004, 0.003, 0.002))
    L(c, b.inputs['Base Color'])
    # relief: rings and fibres raised (weathered: the soft wood wears away), knots, scratches and cracks sunk
    h = N('ShaderNodeMath', operation='ADD'); L(rings.outputs['Fac'], h.inputs[0]); L(fibres.outputs['Fac'], h.inputs[1])
    h2 = N('ShaderNodeMath', operation='SUBTRACT'); L(h.outputs[0], h2.inputs[0]); L(cmask.outputs[0], h2.inputs[1])
    h3 = N('ShaderNodeMath', operation='SUBTRACT'); L(h2.outputs[0], h3.inputs[0]); L(sc_.outputs['Result'], h3.inputs[1])
    bump = N('ShaderNodeBump', i_Strength=0.8, i_Distance=0.0011); L(h3.outputs[0], bump.inputs['Height']); L(bump.outputs['Normal'], b.inputs['Normal'])
    rgh = N('ShaderNodeMapRange', i_To_Min=0.62, i_To_Max=0.92); L(wn.outputs['Fac'], rgh.inputs['Value']); L(rgh.outputs['Result'], b.inputs['Roughness'])
    return m

def iron_material():
    m = bpy.data.materials.new('RustyIron'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 300; nz.inputs['Detail'].default_value = 6
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.links.new(nz.outputs['Fac'], mx.inputs['Factor'])
    mx.inputs[6].default_value = (0.03, 0.028, 0.026, 1); mx.inputs[7].default_value = (0.16, 0.05, 0.015, 1); nt.links.new(mx.outputs[2], b.inputs['Base Color'])
    b.inputs['Metallic'].default_value = 0.55; b.inputs['Roughness'].default_value = 0.8
    return m

def nail(x, y, z, up=0.0, bent=0.0, missing=False):
    if missing:                                          # (just the hole it left)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.0028, depth=0.004, location=(x, y, z - 0.0015), vertices=8); return [bpy.context.object]
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0068, depth=0.0022, location=(x, y, z + up), vertices=10); objs = [bpy.context.object]
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0068, location=(x, y, z + up + 0.0006), segments=10, ring_count=5); d = bpy.context.object; d.scale = (1, 1, 0.3); objs.append(d)
    if up > 0.002:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.0019, depth=up + 0.004, location=(x, y, z + up / 2 - 0.002), vertices=6); objs.append(bpy.context.object)
    for o in objs:
        if bent: o.rotation_euler = (bent, 0, 0); o.location.y += math.sin(bent) * up * 0.5
    return objs

def side_mat():
    m = bpy.data.materials.get('EndGrain')
    if m: return m
    m = bpy.data.materials.new('EndGrain'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.02, 0.012, 0.007, 1); b.inputs['Roughness'].default_value = 0.95
    return m
def section(name, L, seed, W=0.585, n=4):
    rnd = random.Random(seed); pw = W / n
    gaps = [rnd.uniform(0.004, 0.009) for _ in range(n)]
    lifted = rnd.randrange(n); broken = (lifted + 1 + rnd.randrange(n - 1)) % n
    wood = old_wood(name + '_wood', seed); planks, nails, holes = [], [], []
    for i in range(n):
        y = -W / 2 + pw * (i + 0.5) + rnd.uniform(-0.002, 0.002); w = pw - gaps[i]
        brk = rnd.uniform(0.09, 0.18) if i == broken else 0.0
        nxy = [(sx * (L / 2 - 0.045), y + sy * w * 0.28) for sx in (-1, 1) for sy in (-1, 1) if not (brk and sx > 0)]
        o = plank(L, w, 0.02 + rnd.uniform(-0.002, 0.002), 0, y, seed * 10 + i, lift=0.034 if i == lifted else rnd.uniform(0, 0.004), broken=brk,
                  uv_strip=(0.07 + i * 0.93 / n, 0.07 + (i + 1) * 0.93 / n - 0.01), nail_xy=nxy, dark=rnd.random())
        o.data.materials.append(wood); o.data.materials.append(side_mat()); planks.append(o)
        for k, (nxp, nyp) in enumerate(nxy):
            sx = 1 if nxp > 0 else -1
            zt = 0.02 + (0.034 if (i == lifted and sx > 0) else 0) + 0.0015
            r = rnd.random()
            if r < 0.12: holes += nail(nxp, nyp, zt, missing=True)
            elif r < 0.3: nails += nail(nxp, nyp, zt, up=rnd.uniform(0.006, 0.014), bent=rnd.uniform(-0.5, 0.5))
            else: nails += nail(nxp, nyp, zt)
    with bpy.context.temp_override(active_object=planks[0], selected_editable_objects=planks, object=planks[0]): bpy.ops.object.join()
    board = planks[0]; board.name = name
    # (bake the wood into the section's own textures: colour, normal map, roughness; then swap the baked images in)
    px = (1024, 512) if L > 1.5 else (512, 512)
    imgs = {k: bpy.data.images.new(f'{name}_{k}', *px, float_buffer=(k == 'normal')) for k in ('color', 'normal', 'rough')}
    for k in ('normal', 'rough'): imgs[k].colorspace_settings.name = 'Non-Color'
    node = wood.node_tree.nodes.new('ShaderNodeTexImage'); wood.node_tree.nodes.active = node
    for ob in bpy.context.view_layer.objects: ob.select_set(ob == board)
    bpy.context.view_layer.objects.active = board; sc.render.bake.use_selected_to_active = False
    for k, kind in (('color', 'DIFFUSE'), ('normal', 'NORMAL'), ('rough', 'ROUGHNESS')):
        node.image = imgs[k]
        if kind == 'DIFFUSE': sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True; bpy.ops.object.bake(type='DIFFUSE')
        elif kind == 'NORMAL': bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        else: bpy.ops.object.bake(type='ROUGHNESS')
        imgs[k].filepath_raw = f'{TMP}/{name}_{k}.png'; imgs[k].file_format = 'PNG'; imgs[k].save()
    baked = bpy.data.materials.new(name + '_baked'); baked.use_nodes = True; nt = baked.node_tree; bb = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = bpy.data.images.load(f'{TMP}/{name}_color.png'); nt.links.new(tc.outputs['Color'], bb.inputs['Base Color'])
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = bpy.data.images.load(f'{TMP}/{name}_rough.png'); tr.image.colorspace_settings.name = 'Non-Color'; nt.links.new(tr.outputs['Color'], bb.inputs['Roughness'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(f'{TMP}/{name}_normal.png'); tn.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bb.inputs['Normal'])
    board.data.materials.clear(); board.data.materials.append(baked); board.data.materials.append(side_mat())
    iron = bpy.data.materials.get('RustyIron') or iron_material()
    dark = bpy.data.materials.get('Gap')
    if not dark:
        dark = bpy.data.materials.new('Gap'); dark.use_nodes = True; db = dark.node_tree.nodes['Principled BSDF']; db.inputs['Base Color'].default_value = (0.003, 0.002, 0.0015, 1); db.inputs['Roughness'].default_value = 1
    for o in nails: o.data.materials.append(iron)
    for o in holes: o.data.materials.append(dark)
    parts = nails + holes
    with bpy.context.temp_override(active_object=parts[0], selected_editable_objects=parts, object=parts[0]): bpy.ops.object.join()
    parts[0].name = name + 'Nails'
    # the dark gap round the loose section (a little irregular), and the dark gaps between the planks
    bm = bmesh.new(); ring = []
    for k in range(64):
        a = k / 64 * math.tau; cx, cy = math.cos(a), math.sin(a)
        sx = (L / 2 + 0.012) * (1 if cx > 0 else -1) * min(1, abs(cx) * 3); sy = (W / 2 + 0.012) * (1 if cy > 0 else -1) * min(1, abs(cy) * 3)
        ring.append(bm.verts.new((sx + rnd.uniform(-0.003, 0.003), sy + rnd.uniform(-0.003, 0.003), 0.0012)))
    bm.faces.new(ring); me = bpy.data.meshes.new(name + 'Gap'); bm.to_mesh(me); bm.free()
    gap = bpy.data.objects.new(name + 'Gap', me); sc.collection.objects.link(gap); gap.data.materials.append(dark)
    return [board, parts[0], gap]

objs = section('BoardShort', 1.08, 3) + section('BoardLong', 2.07, 7)
path = os.path.join(REPO, 'models', 'boards.glb')
for o in bpy.data.objects: o.select_set(o in objs)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_image_format='WEBP', export_image_quality=86)
print('wrote', path, round(os.path.getsize(path) / 1e3), 'KB', {o.name: len(o.data.vertices) for o in objs})
bpy.ops.wm.save_as_mainfile(filepath=TMP + '/boards.blend')
