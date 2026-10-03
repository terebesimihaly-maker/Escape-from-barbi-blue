# Escape from Barbi Blue: the night outside the windows (WP2.7; build spec B10, C6; js/atmos.js Sky and the near layers).
#   textures/sky/night_garden.<hi|md|lo>.webp  4096 x 2048 / 2048 x 1024 / 1024 x 512 equirect in three.js's equirectUv convention
#                         (u = atan2(z, x) / 2pi + .5, v = asin(y) / pi + .5; Blender: +x at u .5, -y at u .75, up at the top), seen
#                         from 1.5 m up in the garden: a moonlit night (exposed bright, as atmos.js shows it at 0.35), broken cloud
#                         lit from the moon's side, stars where it's clear, the moon and its halo, bare winter trees and a few firs,
#                         the dark line of a wood beyond, an old brick garden wall, mist lying on the lawn
#   textures/sky/night_garden.json  where its moon is: {moon: {az, el}} in dress.js's terms (toward the moon (sin az, cos az) in three's
#                         x, z): the game turns the picture by (plan az - az) so its moon is where the shafts come from
#   textures/sky/well_alpha.webp    2048 x 1024 RGBA: a cellar window's light well: its brick walls going up, dead leaves, the iron
#                         grating at the top, clear (alpha 0) where the sky shows
#   textures/sky/roofs_alpha.webp   2048 x 1024 RGBA: what an attic window looks out on: wet slate roofs, chimney stacks and pots, a
#                         gable, clear where the sky shows
# Cycles, 256 spp (the near layers 128), OIDN; AgX.
#   py -3.11 tools/blender/kit/sky.py [--preview] [--only garden,well,roofs]
import sys, os, math, random, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector, noise as mnoise
import kitlib, defs
import surfaces2 as S
from surfaces2 import sep, comb
from kitlib import OPTS, TMP, lin

OUT = os.path.join(defs.REPO, 'textures', 'sky')
MOON_AZ, MOON_EL = 0.0, math.radians(35.0)
EYE = 1.5
random.seed(91)

def moon_dir():
    """toward the moon, Blender axes (three +z = Blender -y)"""
    x3, z3 = math.sin(MOON_AZ) * math.cos(MOON_EL), math.cos(MOON_AZ) * math.cos(MOON_EL)
    return Vector((x3, -z3, math.sin(MOON_EL)))

# ================================================================ the sky (world shader)
def world_night():
    """the night sky: deep blue at the zenith, paler and greener toward the horizon (moonlight in the air), the moon's halo, stars,
       broken cloud lit silver on the moon's side and dark on the other"""
    w = bpy.context.scene.world; w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground'); nt.links.new(bg.outputs[0], out.inputs[0])
    m = kitlib.Mat.__new__(kitlib.Mat); m.nt = nt                         # (the Mat helpers on the world's tree)
    d = nt.nodes.new('ShaderNodeTexCoord').outputs['Generated']           # (the view direction in a world shader)
    dx, dy, dz = sep(m, d); M = moon_dir()
    md = m.math('ADD', m.math('ADD', m.math('MULTIPLY', dx, M.x), m.math('MULTIPLY', dy, M.y)), m.math('MULTIPLY', dz, M.z))
    h = m.math('MAXIMUM', dz, 0.0)
    col = m.mix(m.math('POWER', h, 0.45), (0.055, 0.075, 0.1), (0.012, 0.022, 0.055))
    col = m.mix(m.math('MULTIPLY', m.math('POWER', m.math('MAXIMUM', md, 0.0), 6.0), 0.8), col, (0.09, 0.11, 0.14))      # (moonlit air)
    halo = m.math('ADD', m.math('MULTIPLY', m.math('POWER', m.math('MAXIMUM', md, 0.0), 300.0), 0.6), m.math('MULTIPLY', m.math('POWER', m.math('MAXIMUM', md, 0.0), 40.0), 0.12))
    col = m.mix(1.0, col, m.mix(0.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)), 'ADD')
    # stars: a sprinkle, more toward the zenith, fewer near the horizon's haze
    v = nt.nodes.new('ShaderNodeTexVoronoi'); v.inputs['Scale'].default_value = 420.0; nt.links.new(d, v.inputs['Vector'])
    st = m.math('MULTIPLY', m.remap(v.outputs['Distance'], 0.05, 0.0), m.remap(v.outputs['Color'] if False else m.noise(d, 900, 1), 0.72, 0.9))
    st = m.math('MULTIPLY', st, m.remap(dz, 0.05, 0.4))
    # cloud: a broken layer on a dome (direction / height), lit on the moon's side
    cl_uv = m.n('ShaderNodeVectorMath', operation='DIVIDE'); m.l(d, cl_uv.inputs[0]); m.l(comb(m, m.math('ADD', dz, 0.12), m.math('ADD', dz, 0.12), 1.0), cl_uv.inputs[1])
    cn = m.noise(m.map(cl_uv.outputs[0], (1, 1, 0)), 1.3, 6, 0.6, 0.35)
    cl = m.math('MULTIPLY', m.remap(cn, 0.48, 0.7, smooth=True), m.remap(dz, 0.02, 0.12))
    lit = m.remap(md, -0.2, 1.0, 0.25, 1.0)
    ccol = m.mix(lit, (0.03, 0.035, 0.045), (0.22, 0.24, 0.27))
    edge = m.math('MULTIPLY', m.math('MULTIPLY', m.remap(cn, 0.48, 0.56), m.remap(cn, 0.62, 0.56)), m.math('POWER', m.math('MAXIMUM', md, 0.0), 3.0))
    ccol = m.mix(edge, ccol, (0.45, 0.48, 0.52))                         # (silver edges toward the moon)
    sky = m.mix(m.math('SUBTRACT', 1.0, cl), m.mix(st, col, (0.9, 0.92, 1.0), 'ADD'), col)
    sky = m.mix(cl, sky, ccol)
    sky = m.mix(1.0, sky, m.mix(halo, (0.0, 0.0, 0.0), (0.85, 0.9, 1.0)), 'ADD')
    m.l(sky, bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
    return w

# ================================================================ the garden
def mat_simple(name, col, rough=0.9, noise_amt=0.3, scale=3.0):
    m = kitlib.Mat(name); op = m.n('ShaderNodeTexCoord').outputs['Object']
    c = m.mix(m.remap(m.noise(op, scale, 4), 0.3, 0.7, 0.0, noise_amt), lin(col), m.hsv(m.mix(0.0, lin(col), lin(col)), 0.5, 0.8, 0.6))
    return m.out(c, rough)

def mat_grass():
    """a winter lawn: patches greener and browner, molehills and worn ground, the grain of the blades"""
    m = kitlib.Mat('sky_grass'); op = m.n('ShaderNodeTexCoord').outputs['Object']
    c = m.mix(m.remap(m.noise(op, 0.12, 4, 0.6), 0.3, 0.7), lin('#3c4a30'), lin('#4a4632'))
    c = m.mix(m.remap(m.noise(op, 0.9, 4, 0.6), 0.45, 0.7, 0.0, 0.6), c, lin('#2c3424'))
    c = m.mix(m.remap(m.noise(op, 6.0, 3), 0.3, 0.7, 0.0, 0.3), c, m.hsv(c, 0.5, 0.8, 0.7))
    return m.out(c, 0.95, m.bump(m.noise(op, 40.0, 3), 0.3, 0.01))

def mat_brick(name, col='#4a3528', mortar='#5e5a52', w=0.225, h=0.075, rough=0.9, scale=1.0):
    """brick (or slate) courses: Blender's brick texture in object space, each brick its own shade, dirt and damp over it"""
    m = kitlib.Mat(name); op = m.n('ShaderNodeTexCoord').outputs['Object']
    b = m.n('ShaderNodeTexBrick', offset=0.5, squash_frequency=1, i_Scale=1.0, i_Mortar_Size=0.008 * scale, i_Brick_Width=w, i_Row_Height=h, i_Bias=0.0)
    c0 = lin(col); b.inputs['Color1'].default_value = (*c0, 1); b.inputs['Color2'].default_value = (c0[0] * 0.6, c0[1] * 0.6, c0[2] * 0.6, 1)
    b.inputs['Mortar'].default_value = (*lin(mortar), 1)
    xyz = m.n('ShaderNodeVectorMath', operation='MULTIPLY'); m.l(op, xyz.inputs[0]); xyz.inputs[1].default_value = (1, 1, 1)
    sw = m.n('ShaderNodeMapping'); sw.inputs['Rotation'].default_value = (math.pi / 2, 0, 0); m.l(xyz.outputs[0], sw.inputs['Vector'])
    m.l(sw.outputs[0], b.inputs['Vector'])
    c = m.mix(m.remap(m.noise(op, 2.0, 4), 0.3, 0.7, 0.0, 0.6), b.outputs['Color'], m.hsv(b.outputs['Color'], 0.5, 0.7, 0.55))
    return m.out(c, rough, m.bump(m.math('SUBTRACT', 1.0, b.outputs['Fac']), 0.6, 0.004))

def branch(bm, p, d, L, r, depth, rnd, pts):
    """a bare tree's limb: a tapering bent tube, splitting into two or three as it goes, twigs at the ends"""
    n = max(2, int(L / 0.35)); q = p.copy(); rr = r; wob = 0.05 if depth == 0 else 0.1 + 0.03 * depth
    for k in range(n):
        d = (d + Vector((rnd.gauss(0, wob), rnd.gauss(0, wob), rnd.gauss(0.02, wob * 0.6)))).normalized()
        q2 = q + d * (L / n); r2 = max(r * (1 - 0.55 * (k + 1) / n), 0.011)   # (twigs kept a pixel thick at 30 m: the crown's haze)
        pts.append((q.copy(), q2.copy(), rr, r2)); q, rr = q2, r2
    if depth < 6:
        kids = rnd.choice((2, 3, 3)) if depth < 2 else rnd.choice((2, 3, 3, 4))
        for j in range(kids):
            nd = (d + Vector((rnd.gauss(0, 0.65), rnd.gauss(0, 0.65), rnd.gauss(0.35, 0.35)))).normalized()
            branch(bm, q, nd, L * rnd.uniform(0.5, 0.72), r2 * rnd.uniform(0.55, 0.75), depth + 1, rnd, pts)
        if depth >= 1:                                                     # (side shoots along the limb)
            for j in range(rnd.randint(1, 3)):
                a, b, ra, rb = pts[-rnd.randint(1, n)]; nd = (d + Vector((rnd.gauss(0, 1.0), rnd.gauss(0, 1.0), rnd.gauss(0.4, 0.4)))).normalized()
                branch(bm, b, nd, L * rnd.uniform(0.3, 0.5), rb * 0.6, depth + 2, rnd, pts)

def tree(name, pos, height, rnd, mat):
    pts = []; base = Vector(pos)
    branch(None, base, Vector((rnd.gauss(0, 0.04), rnd.gauss(0, 0.04), 1)).normalized(), height * 0.36, height * 0.035, 0, rnd, pts)
    bm = bmesh.new()
    for a, b, ra, rb in pts:
        sides = 8 if ra > 0.08 else 6 if ra > 0.02 else 3
        lb = Dr_lathe([(0.0, ra), (1.0, rb)], a, b, sides); bm2 = lb
        bm2.verts.ensure_lookup_table(); me = bpy.data.meshes.new('t'); bm2.to_mesh(me); bm2.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); ob = kitlib.link(bpy.data.objects.new(name, me)); ob.data.materials.append(mat)
    return ob

def Dr_lathe(prof, p0, p1, sides):
    import doors as Dr
    return Dr.lathe_bm(prof, p0, p1, sides, (False, False))

def fir(name, pos, height, rnd, mat):
    """a fir: tiers of drooping boughs round a trunk, ragged"""
    bm = bmesh.new(); base = Vector(pos); n = int(height / 0.6)
    for k in range(n):
        t = k / n; z = base.z + height * (0.12 + 0.88 * t); r = height * 0.32 * (1 - t) ** 0.9 + 0.1
        ring = []
        for i in range(10):
            a = 2 * math.pi * i / 10 + rnd.uniform(-0.15, 0.15); rr = r * rnd.uniform(0.75, 1.15)
            ring.append(bm.verts.new((base.x + rr * math.cos(a), base.y + rr * math.sin(a), z - r * 0.45)))
        top = bm.verts.new((base.x, base.y, z + 0.5))
        for i in range(10): bm.faces.new((ring[i], ring[(i + 1) % 10], top))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); ob = kitlib.link(bpy.data.objects.new(name, me)); ob.data.materials.append(mat)
    return ob

def garden():
    rnd = random.Random(5)
    grass = mat_grass(); bark = mat_simple('sky_bark', '#2a251e', 0.9, 0.3, 5)
    firm = mat_simple('sky_fir', '#16201a', 0.95, 0.3, 4); brick = mat_brick('sky_brick', '#5a4034'); wood = mat_simple('sky_wood', '#0b0d0b', 0.95, 0.2, 1)
    # the lawn (a big disc with a slight rise far off), the wood's edge (a ring of rough treetops beyond)
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=400, segments=64)
    me = bpy.data.meshes.new('lawn'); bm.to_mesh(me); bm.free(); kitlib.link(bpy.data.objects.new('lawn', me)).data.materials.append(grass)
    bm = bmesh.new(); n = 1440; V0, V1 = [], []
    for i in range(n):
        a = 2 * math.pi * i / n; R = 140 + 25 * mnoise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, 0.5)))
        crowns = (0.5 + 0.5 * mnoise.noise(Vector((math.cos(a) * 60, math.sin(a) * 60, 1.0)))) ** 0.7 + 0.4 * (0.5 + 0.5 * mnoise.noise(Vector((math.cos(a) * 160, math.sin(a) * 160, 3.0))))   # (treetops, uneven)
        hgt = 11 + 5 * mnoise.noise(Vector((math.cos(a) * 9, math.sin(a) * 9, 2.0))) + 3.5 * crowns + 1.5 * mnoise.noise(Vector((math.cos(a) * 90, math.sin(a) * 90, 4.0)))
        V0.append(bm.verts.new((R * math.cos(a), R * math.sin(a), -1))); V1.append(bm.verts.new((R * math.cos(a), R * math.sin(a), hgt)))
    for i in range(n): bm.faces.new((V0[i], V0[(i + 1) % n], V1[(i + 1) % n], V1[i]))
    me = bpy.data.meshes.new('woodline'); bm.to_mesh(me); bm.free(); kitlib.link(bpy.data.objects.new('woodline', me)).data.materials.append(wood)
    # the garden wall: old brick, 2.2 m, round the garden at 11-16 m, a gap for the gate, its coping ragged
    bm = bmesh.new()
    for i in range(140):
        a0, a1 = 2 * math.pi * i / 140, 2 * math.pi * (i + 1) / 140
        if abs(((a0 + 0.6) % (2 * math.pi)) - math.pi) < 0.05: continue
        R0 = 13 + 2.5 * math.sin(a0 * 2 + 1); R1 = 13 + 2.5 * math.sin(a1 * 2 + 1); hh = 2.2 + 0.08 * mnoise.noise(Vector((a0 * 5, 0, 0)))
        p = [(R0 * math.cos(a0), R0 * math.sin(a0)), (R1 * math.cos(a1), R1 * math.sin(a1))]
        vs = [bm.verts.new((p[0][0], p[0][1], 0)), bm.verts.new((p[1][0], p[1][1], 0)), bm.verts.new((p[1][0], p[1][1], hh)), bm.verts.new((p[0][0], p[0][1], hh))]
        bm.faces.new(vs)
    me = bpy.data.meshes.new('wall'); bm.to_mesh(me); bm.free(); kitlib.link(bpy.data.objects.new('wall', me)).data.materials.append(brick)
    # trees: bare oaks and limes inside and beyond the wall, firs in a clump, all at their distances
    for k in range(30):
        a = rnd.uniform(0, 2 * math.pi); R = rnd.choice((rnd.uniform(18, 35), rnd.uniform(35, 80)))
        tree(f'tree{k}', (R * math.cos(a), R * math.sin(a), 0), rnd.uniform(12, 22), rnd, bark)
    for k in range(3):
        a = rnd.uniform(0, 2 * math.pi); R = rnd.uniform(8, 11)
        tree(f'near{k}', (R * math.cos(a), R * math.sin(a), 0), rnd.uniform(8, 12), rnd, bark)
    for k in range(9):
        a = 2.4 + rnd.uniform(-0.4, 0.4); R = rnd.uniform(24, 45)
        fir(f'fir{k}', (R * math.cos(a), R * math.sin(a), 0), rnd.uniform(12, 20), rnd, firm)
    # mist on the lawn: a slab of thin volume, densest at the ground
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); me = bpy.data.meshes.new('mist'); bm.to_mesh(me); bm.free()
    mist = kitlib.link(bpy.data.objects.new('mist', me)); mist.scale = (300, 300, 4); mist.location = (0, 0, 1.0)
    vm = bpy.data.materials.new('sky_mist'); vm.use_nodes = True; nt = vm.node_tree; nt.nodes.remove(nt.nodes['Principled BSDF'])
    pv = nt.nodes.new('ShaderNodeVolumePrincipled'); pv.inputs['Color'].default_value = (0.7, 0.75, 0.8, 1)
    tc = nt.nodes.new('ShaderNodeTexCoord'); sx = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sx.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -0.5; mr.inputs['From Max'].default_value = -0.1
    mr.inputs['To Min'].default_value = 0.09; mr.inputs['To Max'].default_value = 0.0; nt.links.new(sx.outputs['Z'], mr.inputs['Value'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.05; nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ml = nt.nodes.new('ShaderNodeMath'); ml.operation = 'MULTIPLY'; nt.links.new(mr.outputs[0], ml.inputs[0]); nt.links.new(nz.outputs['Fac'], ml.inputs[1])
    nt.links.new(ml.outputs[0], pv.inputs['Density']); nt.links.new(pv.outputs[0], nt.nodes['Material Output'].inputs['Volume']); mist.data.materials.append(vm)
    # the moon: a lamp (0.5 deg) for the light, a disc for the eye
    L = kitlib.link(bpy.data.objects.new('moonlight', bpy.data.lights.new('moonlight', 'SUN'))); L.data.energy = 2.2; L.data.angle = math.radians(0.53)
    L.data.color = (0.75, 0.82, 1.0); L.rotation_euler = (-moon_dir()).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=9.0, location=moon_dir() * 1000.0, segments=48, ring_count=24); mo = bpy.context.object; mo.name = 'moon'
    mm = kitlib.Mat('sky_moon'); op = mm.n('ShaderNodeTexCoord').outputs['Object']
    mar = mm.remap(mm.noise(op, 0.25, 5, 0.6), 0.45, 0.6, 0.0, 0.35)
    em = mm.n('ShaderNodeEmission'); mm.l(mm.mix(mar, (1.0, 0.98, 0.94), (0.6, 0.62, 0.66)), em.inputs['Color']); em.inputs['Strength'].default_value = 3.5
    mm.l(em.outputs[0], mm.out_node.inputs['Surface']); mo.data.materials.append(mm.m); mo.visible_shadow = False

def render_to(path_png, w, h, spp, film_transparent=False, cam=None):
    sc = bpy.context.scene; sc.render.resolution_x, sc.render.resolution_y = w, h; sc.render.resolution_percentage = 100
    sc.cycles.samples = kitlib.spp(spp); sc.cycles.use_denoising = True; sc.render.film_transparent = film_transparent
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Base Contrast'; sc.view_settings.exposure = 0.0
    s = sc.render.image_settings; s.file_format = 'PNG'; s.color_mode = 'RGBA' if film_transparent else 'RGB'; s.color_depth = '8'
    sc.render.filepath = path_png; bpy.ops.render.render(write_still=True); return path_png

def do_garden():
    t0 = time.time(); kitlib.reset(); sc = bpy.context.scene
    world_night(); garden()
    cam = kitlib.link(bpy.data.objects.new('pano', bpy.data.cameras.new('pano'))); sc.camera = cam
    cam.data.type = 'PANO'; cam.data.panorama_type = 'EQUIRECTANGULAR'; cam.location = (0, 0, EYE); cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    sc.cycles.max_bounces = 6; sc.cycles.volume_bounces = 1
    W = 1024 if OPTS.preview else 4096
    p = render_to(os.path.join(TMP, 'sky_night_garden.png'), W, W // 2, 256)
    from PIL import Image
    im = Image.open(p).convert('RGB'); os.makedirs(OUT, exist_ok=True)
    for tier, k in (('hi', 1), ('md', 2), ('lo', 4)):
        (im if k == 1 else im.resize((im.width // k, im.height // k), Image.LANCZOS)).save(os.path.join(OUT, f'night_garden.{tier}.webp'), 'WEBP', quality=88, method=6)
    json.dump({'version': 1, 'moon': {'az': MOON_AZ, 'el': round(MOON_EL, 4)}, 'eye_m': EYE,
               'note': 'equirect, three.js equirectUv; the moon is in the picture at (az, el) in dress.js terms: turn u by (plan.moon.az - az) / 2pi to put it where the shafts come from'},
              open(os.path.join(OUT, 'night_garden.json'), 'w'), indent=1)
    print(f'sky: night_garden {W}x{W // 2} in {time.time() - t0:.0f}s', flush=True)

# ================================================================ the near layers
def do_well():
    """a cellar window's light well, seen from the window: its brick walls (sides and back) rising to a grating at ground level,
       dead leaves and grit on its floor; the sky through the grating clear"""
    t0 = time.time(); kitlib.reset(); sc = bpy.context.scene; world_night()
    brick = mat_brick('well_brick', '#6a4a38', '#7a7468'); iron = kitlib.metal('well_iron', 'iron', rust=0.8, age=1.5); leaf = mat_simple('well_leaves', '#5a4228', 0.9, 0.7, 30)
    W, D, H = 1.6, 0.6, 1.1                                               # (the well: wide as the window and more, 0.6 deep, up 1.1 m to the ground)
    def quad(name, p0, ex, ey, mat): o = S.quad(name, p0, ex, ey, mat=mat); return o
    quad('back', (-W / 2, D, -0.3), (W, 0, 0), (0, 0, H + 0.3), brick); quad('sideL', (-W / 2, 0, -0.3), (0, D, 0), (0, 0, H + 0.3), brick)
    quad('sideR', (W / 2, D, -0.3), (0, -D, 0), (0, 0, H + 0.3), brick); quad('floor', (-W / 2, 0, -0.3), (W, 0, 0), (0, D, 0), leaf)
    for i in range(14):                                                   # (the grating: flat bars across, at the ground)
        x = -W / 2 + W * (i + 0.5) / 14; o = kitlib.link(bpy.data.objects.new(f'bar{i}', bpy.data.meshes.new(f'bar{i}')))
        import doors as Dr
        bm = Dr.block((x - 0.006, -0.05, H), (x + 0.006, D + 0.05, H + 0.03), 0.0, 1); bm.to_mesh(o.data); bm.free(); o.data.materials.append(iron)
    L = kitlib.link(bpy.data.objects.new('moonlight', bpy.data.lights.new('moonlight', 'SUN'))); L.data.energy = 2.5; L.data.color = (0.75, 0.82, 1.0)
    L.rotation_euler = (math.radians(28), math.radians(18), 0)
    A = kitlib.link(bpy.data.objects.new('skylight', bpy.data.lights.new('skylight', 'AREA'))); A.data.energy = 25; A.data.size = 1.6; A.data.color = (0.6, 0.7, 0.95)
    A.location = (0, D / 2, H + 0.6)
    cam = kitlib.link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))); sc.camera = cam; cam.data.lens = 18
    cam.location = (0, -0.75, 0.2); cam.rotation_euler = (Vector((0, D, 0.45)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    p = render_to(os.path.join(TMP, 'sky_well.png'), 1024 if OPTS.preview else 2048, 512 if OPTS.preview else 1024, 128, film_transparent=True)
    from PIL import Image
    Image.open(p).convert('RGBA').save(os.path.join(OUT, 'well_alpha.webp'), 'WEBP', quality=88, alpha_quality=100, method=6)
    print(f'sky: well_alpha in {time.time() - t0:.0f}s', flush=True)

def do_roofs():
    """an attic window's view: the wet slate roofs of the house's other wings and the next houses below the window, chimney stacks
       with their pots, a gable, a dormer; the sky clear"""
    t0 = time.time(); kitlib.reset(); sc = bpy.context.scene; world_night(); rnd = random.Random(8)
    slate = mat_simple('roof_slate', '#2a2d33', 0.55, 0.4, 20); brick = mat_simple('roof_brick', '#3a2820', 0.9, 0.45, 12); pot = mat_simple('roof_pot', '#4a3024', 0.85, 0.3, 30)
    import doors as Dr
    def box(name, lo, hi, mat):
        o = kitlib.link(bpy.data.objects.new(name, bpy.data.meshes.new(name))); bm = Dr.block(lo, hi, 0.0, 1); bm.to_mesh(o.data); bm.free(); o.data.materials.append(mat); return o
    def roof(name, x0, x1, y0, y1, z0, ridge, mat):
        o = kitlib.link(bpy.data.objects.new(name, bpy.data.meshes.new(name))); ym = (y0 + y1) / 2
        o.data.from_pydata([(x0, y0, z0), (x1, y0, z0), (x1, ym, ridge), (x0, ym, ridge), (x0, y1, z0), (x1, y1, z0)], [], [(0, 1, 2, 3), (3, 2, 5, 4)]); o.data.materials.append(mat); return o
    slate = mat_brick('roof_slate', '#3a3f48', '#22252a', 0.26, 0.11, 0.5, 0.6); brick = mat_brick('roof_brick', '#5a3a2c')
    g = S.quad('roofs_ground', (-200, -5, -14.0), (400, 0, 0), (0, 300, 0), mat=mat_simple('roofs_ground', '#1a1a1a', 0.95, 0.3, 1))
    for k in range(9):                                                    # (roofs at every distance, their ridges just under the eye)
        dist = 5 + k * 4.5 + rnd.uniform(-1, 1); xc = rnd.uniform(-14, 14); wdt = rnd.uniform(7, 16); dep = rnd.uniform(5, 8); rz = rnd.uniform(-2.6, -0.4) - k * 0.15
        if k % 3 == 1: x0_, x1_, y0_, y1_ = xc - dep / 2, xc + dep / 2, dist, dist + wdt          # (a wing end-on: a gable toward us)
        else: x0_, x1_, y0_, y1_ = xc - wdt / 2, xc + wdt / 2, dist, dist + dep
        roof(f'roof{k}', x0_, x1_, y0_, y1_, rz - dep * 0.6, rz, slate)
        box(f'walls{k}', (x0_ + 0.2, y0_ + 0.2, -14.0), (x1_ - 0.2, y1_ - 0.2, rz - dep * 0.6 + 0.05), brick)   # (the house under it)
        for c in range(rnd.randint(1, 3)):
            cx = xc + rnd.uniform(-wdt / 2 + 1, wdt / 2 - 1); cy = dist + dep / 2 + rnd.uniform(-0.3, 0.3)
            box(f'stack{k}{c}', (cx - 0.45, cy - 0.3, rz - 1.5), (cx + 0.45, cy + 0.3, rz + rnd.uniform(0.8, 1.6)), brick)
            top = rz + 1.6
            for q in range(rnd.randint(2, 4)):
                px = cx - 0.3 + q * 0.2
                o = kitlib.link(bpy.data.objects.new(f'pot{k}{c}{q}', bpy.data.meshes.new('p'))); bm = Dr.lathe_bm([(0.0, 0.1), (0.6, 0.08), (0.85, 0.09), (1.0, 0.11)], (px, cy, top - 0.05), (px, cy, top + rnd.uniform(0.35, 0.65)), 10, (False, True))
                bm.to_mesh(o.data); bm.free(); o.data.materials.append(pot)
    L = kitlib.link(bpy.data.objects.new('moonlight', bpy.data.lights.new('moonlight', 'SUN'))); L.data.energy = 2.5; L.data.color = (0.75, 0.82, 1.0)
    L.rotation_euler = (math.radians(55), math.radians(-25), math.radians(200))
    cam = kitlib.link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))); sc.camera = cam; cam.data.lens = 18
    cam.location = (0, 0, 0); cam.rotation_euler = (Vector((0, 10, -0.9)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    p = render_to(os.path.join(TMP, 'sky_roofs.png'), 1024 if OPTS.preview else 2048, 512 if OPTS.preview else 1024, 128, film_transparent=True)
    from PIL import Image
    Image.open(p).convert('RGBA').save(os.path.join(OUT, 'roofs_alpha.webp'), 'WEBP', quality=88, alpha_quality=100, method=6)
    print(f'sky: roofs_alpha in {time.time() - t0:.0f}s', flush=True)

def main():
    os.makedirs(OUT, exist_ok=True)
    if OPTS.want('garden'): do_garden()
    if OPTS.want('well'): do_well()
    if OPTS.want('roofs'): do_roofs()

if __name__ == '__main__':
    main()
