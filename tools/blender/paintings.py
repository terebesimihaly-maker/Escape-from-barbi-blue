# Escape from Barbi Blue: the portraits on the walls (textures/portrait_*.webp), made in Blender: the porcelain doll
# (tools/blender/doll.py) sits for her portrait with a painted face, lit low and warm from one side, then the picture is given
# an oil-painting finish (brush smears, canvas weave, cracked varnish) and put in a carved gilt frame rendered in 3D.
# Variants: portrait_a/b/c (three dolls), portrait_changed (the same doll... wrong), portrait_watch (dark sockets where the
# watcher's real 3D eyes sit; their positions are written to textures/portrait_eyes.json).
#   python tools/blender/doll.py && python tools/blender/paintings.py
import sys, os, math, json, random; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
REPO = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(REPO, 'textures'); TMP = '/tmp/efbb-paint'; os.makedirs(TMP, exist_ok=True)
FW, FH = 520, 662                                    # (the whole painting, frame included: the game's 0.44 x 0.56 m plane)

def face_texture(path, kind, iris=(70, 110, 200)):
    """the painted porcelain face, laid out like the game's (js/house.js dollFaceCanvas): u round the head, front at 0.5"""
    S = 1024; im = Image.new('RGB', (S, S), (238, 226, 216)); d = ImageDraw.Draw(im, 'RGBA')
    ex = [S * 0.36, S * 0.64]; ey = S * 0.47
    for x in ex:                                     # (rosy cheeks)
        for r in range(90, 0, -6): d.ellipse([x - r, ey + 120 - r * 0.8, x + r, ey + 120 + r * 0.8], fill=(215, 120, 125, 5))
    for x in ex:
        if kind == 'changed':
            d.ellipse([x - 44, ey - 52, x + 44, ey + 52], fill=(4, 2, 2, 255))
            d.line([x - 6, ey + 40, x - 12, ey + 210], fill=(8, 3, 3, 220), width=10); d.line([x + 10, ey + 40, x + 16, ey + 160], fill=(8, 3, 3, 200), width=7)
        elif kind == 'watch':
            d.ellipse([x - 40, ey - 46, x + 40, ey + 46], fill=(6, 5, 8, 255))
        else:
            d.ellipse([x - 42, ey - 50, x + 42, ey + 50], fill=(245, 245, 250, 255))
            d.ellipse([x - 30, ey - 36, x + 30, ey + 36], fill=iris + (255,))
            d.ellipse([x - 13, ey - 15, x + 13, ey + 15], fill=(5, 5, 10, 255))
            d.ellipse([x - 22, ey - 26, x - 8, ey - 12], fill=(255, 255, 255, 230))
            d.arc([x - 50, ey - 62, x + 50, ey + 40], 200, 340, fill=(30, 20, 20, 255), width=9)     # (lashes)
        d.arc([x - 55, ey - 110, x + 55, ey - 50], 200, 340, fill=(90, 60, 45, 200), width=8)          # (brows)
    my = S * 0.69
    if kind == 'changed':
        d.chord([S * 0.36, my - 40, S * 0.64, my + 60], 0, 180, fill=(50, 4, 8, 255))
        for k in range(9): x = S * 0.38 + k * S * 0.029; d.line([x, my + 5, x, my + 30], fill=(220, 210, 190, 255), width=5)
        d.line([S * 0.58, S * 0.2, S * 0.62, S * 0.36, S * 0.57, S * 0.45], fill=(40, 30, 30, 220), width=5)   # (a crack)
    else:
        d.ellipse([S * 0.465, my - 14, S * 0.535, my + 16], fill=(170, 30, 45, 255)); d.line([S * 0.465, my, S * 0.535, my], fill=(90, 15, 25, 255), width=3)
    im.filter(ImageFilter.GaussianBlur(1.5)).save(path)

def setup(kind, dress, hair, iris):
    bpy.ops.wm.open_mainfile(filepath='/tmp/efbb-doll.blend')
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
    head = bpy.data.objects['DollHead']
    # UVs like the game's: round the head from the front
    me = head.data; uvl = me.uv_layers.active or me.uv_layers.new(); c = Vector((0, 0, 0.415))
    for poly in me.polygons:
        for li in poly.loop_indices:
            p = head.matrix_world @ me.vertices[me.loops[li].vertex_index].co - c; r = p.length or 1
            uvl.data[li].uv = (0.5 + math.atan2(p.x, -p.y) / math.radians(200), 0.5 + math.asin(max(-1, min(1, p.z / r))) / math.pi)
    face_texture(f'{TMP}/face_{kind}.png', kind, iris)
    m = bpy.data.materials.new('face'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bpy.data.images.load(f'{TMP}/face_{kind}.png'); tx.extension = 'EXTEND'
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.3
    head.data.materials.clear(); head.data.materials.append(m)
    for mat, col in (('Dress', dress), ('Hair', hair)):
        if bpy.data.materials.get(mat): bpy.data.materials[mat].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*col, 1)
    if kind == 'changed': bpy.data.objects['DollHeadPivot'].rotation_euler = (0, 0.28, 0.12)    # (the head tilted, wrong)
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.004, 0.003, 0.003)
    back = bpy.data.objects.new('back', bpy.data.meshes.new('back')); sc.collection.objects.link(back)
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.5); bm.to_mesh(back.data); bm.free()
    back.rotation_euler = (math.pi / 2, 0, 0); back.location = (0, 0.5, 0.4)
    bmm = bpy.data.materials.new('bk'); bmm.use_nodes = True; bmm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.03, 0.022, 0.018, 1); back.data.materials.append(bmm)
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'AREA')); key.data.energy = 16; key.data.size = 0.4; key.data.color = (1.0, 0.82, 0.6)
    key.location = (-0.55, -0.6, 0.75); key.rotation_euler = (Vector((0, 0, 0.38)) - key.location).to_track_quat('-Z', 'Y').to_euler(); sc.collection.objects.link(key)
    rim = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'AREA')); rim.data.energy = 5; rim.data.color = (0.5, 0.6, 1.0)
    rim.location = (0.5, 0.4, 0.7); rim.rotation_euler = (Vector((0, 0, 0.4)) - rim.location).to_track_quat('-Z', 'Y').to_euler(); sc.collection.objects.link(rim)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.lens = 85; sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0.04, -1.05, 0.37); cam.rotation_euler = (Vector((0, 0, 0.35)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x, sc.render.resolution_y = 400, 530; sc.render.film_transparent = False
    return sc, cam, head

def eyes_on_screen(sc, cam, head):
    # where the painted eyes are in the picture (for the watcher's 3D eyes): through the same UV rule, onto the head, into the camera
    c = Vector((0, 0, 0.415)); out = []
    for u in (0.36, 0.64):
        lon = (u - 0.5) * math.radians(200); lat = (0.53 - 0.5) * math.pi
        dirv = Vector((math.sin(lon) * math.cos(lat), -math.cos(lon) * math.cos(lat), math.sin(lat)))
        # (cast in from outside onto the head's surface)
        mi = head.matrix_world.inverted(); o = mi @ (c + dirv * 0.4); d = (mi.to_3x3() @ -dirv).normalized()
        ok, loc, nrm, idx = head.ray_cast(o, d); best = head.matrix_world @ loc if ok else None
        p = best or c + dirv * 0.078
        v = world_to_camera_view(sc, cam, p); out.append((v.x, 1 - v.y))
    return out

def oil(src, dst):
    """an oil-painting finish: smeared strokes along the forms, canvas weave, dark varnish, fine cracks"""
    im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(np.float32) / 255
    sm = np.asarray(im.filter(ImageFilter.ModeFilter(5)).filter(ImageFilter.SMOOTH_MORE)).astype(np.float32) / 255
    a = a * 0.45 + sm * 0.55
    h, w = a.shape[:2]; y, x = np.mgrid[0:h, 0:w]
    weave = 0.93 + 0.07 * (np.sin(x * 1.9) * np.sin(y * 1.9))
    rng = np.random.default_rng(3); cr = np.ones((h, w), np.float32)
    im2 = Image.new('L', (w, h), 255); d = ImageDraw.Draw(im2)
    for _ in range(420):                                 # (a fine craquelure: many short, faint hairlines)
        px, py = rng.uniform(0, w), rng.uniform(0, h); pts = [(px, py)]
        for __ in range(4): px += rng.normal(0, 5); py += rng.normal(0, 5); pts.append((px, py))
        d.line(pts, fill=int(rng.uniform(212, 238)), width=1)
    cr = np.asarray(im2).astype(np.float32) / 255
    varnish = np.array([1.0, 0.9, 0.7])                  # (old yellowed varnish, darker at the edges)
    vig = 1 - 0.45 * (((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2)
    a = a * weave[..., None] * cr[..., None] * varnish * vig[..., None]
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(dst)

def framed(art, dst):
    """the carved gilt frame, in 3D, round the painting, seen straight on"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 40; sc.cycles.use_denoising = True
    W, H = 0.44, 0.56; bw = 0.06                           # (the plane in the game; the frame's width)
    iw, ih = W - 2 * bw, H - 2 * bw
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0)); pic = bpy.context.object; pic.scale = (iw, ih, 1)
    pm = bpy.data.materials.new('art'); pm.use_nodes = True; nt = pm.node_tree; b = nt.nodes['Principled BSDF']
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bpy.data.images.load(art); nt.links.new(tx.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.5
    pic.data.materials.append(pm)
    gold = bpy.data.materials.new('gilt'); gold.use_nodes = True; g = gold.node_tree; gb = g.nodes['Principled BSDF']
    nz = g.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 60; nz.inputs['Detail'].default_value = 8
    mx = g.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; g.links.new(nz.outputs['Fac'], mx.inputs['Factor'])
    mx.inputs[6].default_value = (0.55, 0.38, 0.12, 1); mx.inputs[7].default_value = (0.12, 0.08, 0.03, 1); g.links.new(mx.outputs[2], gb.inputs['Base Color'])
    gb.inputs['Metallic'].default_value = 0.9; gb.inputs['Roughness'].default_value = 0.38
    bp = g.nodes.new('ShaderNodeBump'); bp.inputs['Distance'].default_value = 0.002; g.links.new(nz.outputs['Fac'], bp.inputs['Height']); g.links.new(bp.outputs['Normal'], gb.inputs['Normal'])
    # the moulding: a profile (a rounded outer bead, a cove, an inner lip) swept round the rectangle
    prof = [(0.0, 0.004), (0.006, 0.02), (0.014, 0.026), (0.022, 0.022), (0.03, 0.014), (0.04, 0.018), (0.05, 0.012), (0.056, 0.006), (0.06, 0.0)]
    verts, faces = [], []
    corners = [(-W / 2, -H / 2), (W / 2, -H / 2), (W / 2, H / 2), (-W / 2, H / 2)]
    ring = []
    for (cx, cy) in corners:
        sx = 1 if cx > 0 else -1; sy = 1 if cy > 0 else -1; col = []
        for (t, z) in prof:
            col.append(len(verts)); verts.append((cx - sx * t, cy - sy * t, z))
        ring.append(col)
    n = len(prof)
    for k in range(4):
        a, bb = ring[k], ring[(k + 1) % 4]
        for j in range(n - 1): faces.append((a[j], bb[j], bb[j + 1], a[j + 1]))
    me = bpy.data.meshes.new('frame'); me.from_pydata(verts, [], faces); me.update()
    fr = bpy.data.objects.new('frame', me); sc.collection.objects.link(fr); fr.data.materials.append(gold)
    for p in fr.data.polygons: p.use_smooth = False
    # small carved rosettes in the corners only
    for (x, y) in corners:
        x = x - (0.028 if x > 0.1 else -0.028 if x < -0.1 else 0) ; y = y - (0.028 if y > 0.2 else -0.028 if y < -0.2 else 0)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.011, location=(x, y, 0.02), segments=16, ring_count=8); o = bpy.context.object; o.scale = (1, 1, 0.4); o.data.materials.append(gold)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.013, minor_radius=0.0025, location=(x, y, 0.018)); t = bpy.context.object; t.data.materials.append(gold)
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.02, 0.018, 0.016)
    L = bpy.data.objects.new('L', bpy.data.lights.new('L', 'AREA')); L.data.energy = 6; L.data.size = 0.6; L.location = (-0.35, 0.4, 0.6)
    L.rotation_euler = (Vector((0, 0, 0)) - L.location).to_track_quat('-Z', 'Y').to_euler(); sc.collection.objects.link(L)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.type = 'ORTHO'; cam.data.ortho_scale = H; sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, 0, 1); sc.render.resolution_x, sc.render.resolution_y = FW, FH
    sc.render.filepath = dst; bpy.ops.render.render(write_still=True)

VARIANTS = {'a': ((0.18, 0.22, 0.42), (0.03, 0.02, 0.015), (70, 110, 200)), 'b': ((0.4, 0.12, 0.16), (0.55, 0.35, 0.12), (60, 120, 70)),
            'c': ((0.35, 0.33, 0.28), (0.12, 0.05, 0.02), (90, 70, 40)), 'changed': ((0.18, 0.22, 0.42), (0.03, 0.02, 0.015), (70, 110, 200)),
            'watch': ((0.18, 0.22, 0.42), (0.03, 0.02, 0.015), (70, 110, 200))}
eyes = None
for kind, (dress, hair, iris) in VARIANTS.items():
    sc, cam, head = setup(kind if kind in ('changed', 'watch') else 'plain', dress, hair, iris)
    sc.render.filepath = f'{TMP}/sit_{kind}.png'; bpy.ops.render.render(write_still=True)
    if kind == 'watch': eyes = eyes_on_screen(sc, cam, head)
    oil(f'{TMP}/sit_{kind}.png', f'{TMP}/oil_{kind}.png')
    framed(f'{TMP}/oil_{kind}.png', f'{TMP}/framed_{kind}.png')
    Image.open(f'{TMP}/framed_{kind}.png').convert('RGB').save(f'{OUT}/portrait_{kind}.webp', 'WEBP', quality=85)
    print('painted', kind, flush=True)
# the watcher's eyes: where they are on the 0.44 x 0.56 plane (metres from its middle), inside the frame
W, H, bw = 0.44, 0.56, 0.06
pos = [((x - 0.5) * (W - 2 * bw), (0.5 - y) * (H - 2 * bw)) for x, y in eyes]
json.dump({'eyes': pos}, open(f'{OUT}/portrait_eyes.json', 'w')); print('eyes', pos)
