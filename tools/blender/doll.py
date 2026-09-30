# Escape from Barbi Blue: the porcelain doll (models/doll.glb), made in Blender. It sits on the floor (or a table) against a
# wall, legs out in front, about 45 cm tall. Its lowest point is exactly at y = 0, so it never floats or sinks.
# Parts (separate meshes so the game can colour them per doll): DollBody (porcelain), DollDress, DollHair, DollShoes, and
# DollHead: the head (a node of its own so it can turn to watch you; the game paints the face on it).
#   python tools/blender/doll.py          (Blender's Python module: pip install bpy)
import sys, os, math, random; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector, Matrix
REPO = os.path.dirname(os.path.dirname(HERE))
bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(11)

def mat(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m
PORCELAIN = mat('Porcelain', (0.93, 0.86, 0.82), 0.22)
DRESS = mat('Dress', (0.9, 0.9, 0.9), 0.8)            # (white: the game tints it)
LACE = mat('Lace', (0.95, 0.93, 0.88), 0.7)
HAIR = mat('Hair', (0.9, 0.9, 0.9), 0.55)
SHOES = mat('Shoes', (0.04, 0.035, 0.035), 0.3)
SOCK = mat('Socks', (0.95, 0.95, 0.95), 0.8)

def smooth(o, levels=2):
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    for p in o.data.polygons: p.use_smooth = True
def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)
def uvsphere(r, loc, segs=24, rings=16, scale=(1, 1, 1), m=None, name='s'):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segs, ring_count=rings); o = bpy.context.object; o.name = name
    o.scale = scale; bpy.ops.object.transform_apply(scale=True)
    for p in o.data.polygons: p.use_smooth = True
    if m: o.data.materials.append(m)
    return o
def capsule(p0, p1, r0, r1, m, name='c', segs=16):
    # a tapered tube with round ends from p0 to p1 (arms, legs)
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = d.length
    bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=L, vertices=segs, location=(p0 + p1) / 2); o = bpy.context.object; o.name = name
    bm = bmesh.new(); bm.from_mesh(o.data)
    for v in bm.verts: t = (v.co.z / L) + 0.5; r = r0 + (r1 - r0) * t; v.co.x *= r; v.co.y *= r
    bm.to_mesh(o.data); bm.free()
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    for p in o.data.polygons: p.use_smooth = True
    o.data.materials.append(m)
    e0 = uvsphere(r0, p0, 16, 10, m=m); e1 = uvsphere(r1, p1, 16, 10, m=m)
    return join([o, e0, e1], name)
def join(objs, name):
    objs = [o for o in objs if o]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]): bpy.ops.object.join()
    objs[0].name = name; return objs[0]

# (Blender: z up, the doll faces -y; the game turns it to face into the room)
# ---- the skirt: a bell of cloth with a wavy, frilled hem, sitting on the floor round the doll
def skirt():
    rings, seg = 7, 64; verts = []
    for i in range(rings):
        t = i / (rings - 1); z = 0.2 - t * 0.19; r = 0.06 + t * 0.105
        for j in range(seg):
            a = j / seg * math.tau; wave = 1 + 0.06 * math.sin(a * 12) * t
            # (it spreads more at the front, over the legs)
            fwd = 1 + 0.25 * max(0, -math.cos(a)) * t
            verts.append((math.sin(a) * r * wave, -math.cos(a) * r * wave * fwd, max(z, 0.012)))
    faces = [(i * seg + j, i * seg + (j + 1) % seg, (i + 1) * seg + (j + 1) % seg, (i + 1) * seg + j) for i in range(rings - 1) for j in range(seg)]
    me = bpy.data.meshes.new('skirt'); me.from_pydata(verts, [], faces); me.update()
    o = bpy.data.objects.new('skirt', me); bpy.context.scene.collection.objects.link(o); o.data.materials.append(DRESS)
    m = o.modifiers.new('so', 'SOLIDIFY'); m.thickness = 0.004; smooth(o, 1); apply_all(o)
    # lace frill at the hem
    rings2 = 3; v2 = []
    for i in range(rings2):
        t = i / (rings2 - 1); r = 0.165 + t * 0.02; z = 0.014 - t * 0.008
        for j in range(seg * 2):
            a = j / (seg * 2) * math.tau; wave = 1 + 0.04 * math.sin(a * 40); fwd = 1 + 0.25 * max(0, -math.cos(a))
            v2.append((math.sin(a) * r * wave, -math.cos(a) * r * wave * fwd, max(z, 0.002)))
    f2 = [(i * seg * 2 + j, i * seg * 2 + (j + 1) % (seg * 2), (i + 1) * seg * 2 + (j + 1) % (seg * 2), (i + 1) * seg * 2 + j) for i in range(rings2 - 1) for j in range(seg * 2)]
    me2 = bpy.data.meshes.new('frill'); me2.from_pydata(v2, [], f2); me2.update()
    fr = bpy.data.objects.new('frill', me2); bpy.context.scene.collection.objects.link(fr); fr.data.materials.append(LACE)
    m = fr.modifiers.new('so', 'SOLIDIFY'); m.thickness = 0.002; apply_all(fr)
    return o, fr
sk, frill = skirt()
# ---- bodice, sleeves, arms, collar
bodice = uvsphere(0.058, (0, 0, 0.27), 24, 16, scale=(1, 0.8, 1.35), m=DRESS, name='bodice')
collar = uvsphere(0.05, (0, -0.004, 0.335), 24, 8, scale=(1.15, 0.95, 0.35), m=LACE, name='collar')
arms = []
for s in (1, -1):
    sleeve = uvsphere(0.03, (s * 0.062, -0.005, 0.31), 16, 10, scale=(1, 1, 1.1), m=DRESS, name='sleeve')
    arm = capsule((s * 0.07, -0.01, 0.29), (s * 0.085, -0.075, 0.2), 0.014, 0.011, PORCELAIN, 'arm', segs=10)
    hand = uvsphere(0.016, (s * 0.087, -0.083, 0.19), 12, 8, scale=(0.8, 1.1, 1), m=PORCELAIN, name='hand')
    arms += [sleeve, arm, hand]
# ---- legs out in front, white socks, black shoes with a strap
legs, shoes = [], []                                     # (the legs are under the skirt: only the socks and shoes show)
for s in (1, -1):
    sock = capsule((s * 0.04, -0.135, 0.032), (s * 0.041, -0.175, 0.03), 0.019, 0.018, SOCK, 'sock', segs=10)
    shoe = uvsphere(0.025, (s * 0.041, -0.2, 0.028), 12, 8, scale=(0.85, 1.35, 1.0), m=SHOES, name='shoe')
    sole = uvsphere(0.024, (s * 0.041, -0.2, 0.012), 12, 6, scale=(0.9, 1.4, 0.45), m=SHOES, name='sole')
    legs.append(sock); shoes += [shoe, sole]
bloomers = uvsphere(0.07, (0, -0.01, 0.06), 20, 12, scale=(1.05, 1.15, 0.6), m=LACE, name='bloomers')

# ---- the head: porcelain, with a little shape (cheeks, chin); ringlet hair and a bonnet
head = uvsphere(0.075, (0, 0, 0.415), 32, 24, m=PORCELAIN, name='DollHead')
bm = bmesh.new(); bm.from_mesh(head.data)
for v in bm.verts:
    p = v.co - Vector((0, 0, 0.415))
    front = max(0.0, -p.y / 0.075)
    # full cheeks, a small chin, the back of the head a little rounder
    for sx in (-1, 1):
        d = (p - Vector((sx * 0.035, -0.055, -0.02))).length
        v.co += Vector((sx * 0.004, -0.006, 0)) * math.exp(-(d / 0.03) ** 2)
    dch = (p - Vector((0, -0.06, -0.05))).length; v.co += Vector((0, -0.005, -0.004)) * math.exp(-(dch / 0.025) ** 2)
    v.co.z += 0.006 * max(0.0, p.z / 0.075) ** 2
bm.to_mesh(head.data); bm.free()
neck = capsule((0, 0, 0.33), (0, 0, 0.37), 0.02, 0.018, PORCELAIN, 'neck')
hair_parts = [uvsphere(0.081, (0, 0.006, 0.425), 32, 20, scale=(1, 1, 1.02), m=HAIR, name='haircap')]
bm = bmesh.new(); bm.from_mesh(hair_parts[0].data)     # (cut the cap away from the face)
kill = [v for v in bm.verts if (v.co.y < -0.02 and v.co.z < 0.455) or v.co.z < 0.37]
bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(hair_parts[0].data); bm.free()
for s in (1, -1):                                        # (ringlets: little spirals hanging by the cheeks and behind)
    for k, (ox, oy) in enumerate(((0.066, -0.01), (0.06, 0.03), (0.035, 0.06))):
        pts = []
        for i in range(40):
            t = i / 39; a = t * 5 * math.tau
            pts.append((s * ox + math.cos(a) * 0.011, oy + math.sin(a) * 0.011, 0.41 - t * 0.12))
        cu = bpy.data.curves.new('curl', 'CURVE'); cu.dimensions = '3D'; sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts): sp.points[i].co = (*p, 1)
        cu.bevel_depth = 0.006; cu.bevel_resolution = 2
        co = bpy.data.objects.new('curl', cu); bpy.context.scene.collection.objects.link(co); co.data.materials.append(HAIR)
        bpy.context.view_layer.objects.active = co
        with bpy.context.temp_override(active_object=co, object=co, selected_editable_objects=[co]): bpy.ops.object.convert(target='MESH')
        hair_parts.append(bpy.context.object if bpy.context.object.name.startswith('curl') else co)
bonnet = uvsphere(0.088, (0, 0.012, 0.43), 32, 16, scale=(1.02, 1, 1), m=LACE, name='bonnet')
bm = bmesh.new(); bm.from_mesh(bonnet.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.035 or v.co.z < 0.43 - 0.03 * max(0, v.co.y + 0.035) / 0.12], context='VERTS')
bm.to_mesh(bonnet.data); bm.free()
m = bonnet.modifiers.new('so', 'SOLIDIFY'); m.thickness = 0.003; apply_all(bonnet)
bow = uvsphere(0.018, (0, -0.02, 0.325), 12, 8, scale=(1.6, 0.5, 0.7), m=DRESS, name='bow')

# ---- assemble: parts grouped by material (so the game can colour each), the head its own node, pivoting at the neck
for o in [bodice, collar] + [a for a in arms if a.name.startswith('sleeve')]: smooth(o, 1)
body = join(arms + legs + [neck], 'DollBody'); apply_all(body)
dress = join([sk, bodice, bow], 'DollDress'); apply_all(dress)
lace = join([frill, collar, bloomers], 'DollLace'); apply_all(lace)
shoe = join(shoes, 'DollShoes'); apply_all(shoe)
smooth(head, 1); apply_all(head)
hair = join(hair_parts + [bonnet], 'DollHair'); apply_all(hair)
# (the head and its hair turn together: parent the hair to the head, pivot at the neck)
pivot = Vector((0, 0, 0.37))
head_node = bpy.data.objects.new('DollHeadPivot', None); head_node.location = pivot; bpy.context.scene.collection.objects.link(head_node)
for o in (head, hair):
    o.data.transform(Matrix.Translation(-pivot)); o.location = (0, 0, 0); o.parent = head_node
# ---- sits exactly on the floor
lowest = min((o.matrix_world @ v.co).z for o in (body, dress, lace, shoe) for v in o.data.vertices)
for o in (body, dress, lace, shoe, head_node): o.location.z -= lowest
print('lowest was', round(lowest, 4))
# UVs for the head: a projection from the front, so the game's painted face lands on it
bpy.context.view_layer.objects.active = head
for ob in bpy.context.view_layer.objects: ob.select_set(ob == head)
with bpy.context.temp_override(active_object=head, object=head, selected_editable_objects=[head]):
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.sphere_project(direction='ALIGN_TO_OBJECT'); bpy.ops.object.mode_set(mode='OBJECT')
def decimate(o, ratio):
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; apply_all(o)
for o, r in ((hair, 0.55), (dress, 0.6), (body, 0.35), (head, 0.7)): decimate(o, r)
counts = {o.name: len(o.data.vertices) for o in bpy.data.objects if o.type == 'MESH'}
path = os.path.join(REPO, 'models', 'doll.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_animations=False)
print('wrote', path, round(os.path.getsize(path) / 1e3), 'KB', counts)
bpy.ops.wm.save_as_mainfile(filepath='/tmp/efbb-doll.blend')
