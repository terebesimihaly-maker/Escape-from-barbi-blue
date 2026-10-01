# Shared helpers for the Blender scripts (run with the bpy module: /tmp/claude-0/bpyenv/bin/python)
import bpy, bmesh, math
from mathutils import Vector
SRC = '/home/user/Escape-from-barbi-blue/models/barbi.glb'

def load(path=SRC):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    ico = bpy.data.objects.get('Icosphere')
    if ico: ico.hide_render = True
    return bpy.data.objects['Body'], [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]

HAND = ('wrist', 'finger', 'metacarpal'); FOOT = ('foot', 'toe'); LEG = ('upperleg', 'lowerleg'); PELVIS = ('pelvis',)
HEAD = ('neck', 'head', 'jaw', 'eye', 'levator', 'oris', 'special', 'tongue', 'orbicularis', 'oculi', 'temporalis', 'risorius')
ARM = ('upperarm', 'lowerarm', 'shoulder')
def zone_of(name):
    for z, pre in (('hand', HAND), ('foot', FOOT), ('leg', LEG), ('pelvis', PELVIS), ('head', HEAD), ('arm', ARM)):
        if name.startswith(pre): return z
    return 'torso'
def vert_zones(obj):
    names = {g.index: zone_of(g.name) for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        w = {}
        for g in v.groups: z = names[g.group]; w[z] = w.get(z, 0) + g.weight
        out.append(max(w, key=w.get) if w else 'torso')
    return out

def dup(obj, name):
    o = obj.copy(); o.data = obj.data.copy(); o.name = name; o.data.name = name
    bpy.context.scene.collection.objects.link(o)
    return o

def transfer_weights(dst, src):
    # skin the new mesh like the body under it: copy the weights from the nearest point of the body
    for g in list(dst.vertex_groups): dst.vertex_groups.remove(g)
    for g in src.vertex_groups: dst.vertex_groups.new(name=g.name)
    m = dst.modifiers.new('wt', 'DATA_TRANSFER'); m.object = src; m.use_vert_data = True
    m.data_types_verts = {'VGROUP_WEIGHTS'}; m.vert_mapping = 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src = 'ALL'; m.layers_vgroup_select_dst = 'NAME'
    # (the modifier has to be first in the stack to be applied before the armature)
    dst.modifiers.move(dst.modifiers.find('wt'), 0)
    bpy.context.view_layer.objects.active = dst
    with bpy.context.temp_override(object=dst, active_object=dst):
        bpy.ops.object.modifier_apply(modifier='wt')
    # at most 4 bones per vertex, weights adding up to 1 (what glTF / three.js use)
    with bpy.context.temp_override(object=dst, active_object=dst, selected_editable_objects=[dst]):
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)

def use_best_device(scene=None):
    """Cycles on the graphics card when this machine has one (NVIDIA: OptiX, then CUDA; AMD: HIP; Intel: oneAPI; Mac: Metal),
       otherwise on the processor. Returns what it picked, e.g. 'OPTIX' or 'CPU'."""
    sc = scene or bpy.context.scene; sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        try: prefs.compute_device_type = kind; prefs.refresh_devices()
        except Exception: continue
        gpus = [d for d in prefs.devices if d.type == kind]
        if not gpus: continue
        for d in prefs.devices: d.use = d.type == kind
        sc.cycles.device = 'GPU'; return kind
    prefs.compute_device_type = 'NONE'; sc.cycles.device = 'CPU'; return 'CPU'

def setup_render(samples=12):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; use_best_device(sc)
    sc.cycles.use_denoising = True
    sc.world = bpy.data.worlds.get('w') or bpy.data.worlds.new('w'); sc.world.color = (0.06, 0.065, 0.09)
    if not bpy.data.objects.get('key'):
        for n, e, rot in (('key', 3.2, (50, 0, 35)), ('fill', 1.1, (70, 0, -120)), ('rim', 2.0, (60, 0, 170))):
            L = bpy.data.objects.new(n, bpy.data.lights.new(n, 'SUN')); L.data.energy = e
            L.rotation_euler = tuple(math.radians(a) for a in rot); sc.collection.objects.link(L)
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.name for i in type(sc.view_settings).bl_rna.properties['view_transform'].enum_items] else 'Filmic'

def render_views(path, center=(0, 0, 0.8), dist=3.0, height=None, lens=50, views=(0, 40, 90, 180), size=(260, 420), samples=12):
    # renders the figure from several sides (0 = the front) and puts the pictures side by side
    from PIL import Image
    setup_render(samples)
    sc = bpy.context.scene
    cam = bpy.data.objects.get('cam')
    if not cam:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
    cam.data.lens = lens; sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    c = Vector(center); h = c.z if height is None else height
    tiles = []
    for i, a in enumerate(views):
        r = math.radians(a)
        cam.location = (c.x + math.sin(r) * dist, c.y - math.cos(r) * dist, h)   # (the figure faces -Y)
        d = c - cam.location; cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        f = f'{path}.{i}.png'; sc.render.filepath = f; bpy.ops.render.render(write_still=True); tiles.append(Image.open(f).convert('RGB'))
    W = sum(t.width for t in tiles); out = Image.new('RGB', (W, tiles[0].height)); x = 0
    for t in tiles: out.paste(t, (x, 0)); x += t.width
    out.save(path)
    import os
    for i in range(len(views)): os.remove(f'{path}.{i}.png')

# ---------- cutting a mesh along a smooth surface ----------
def cut(bm, f, eps=1e-6):
    """Remove everything where f(point) > 0, cutting the faces exactly along f = 0 (clean edges, not the mesh's jagged ones).
       f takes a Vector (object space) and returns a float."""
    bm.verts.ensure_lookup_table()
    val = {v: f(v.co) for v in bm.verts}
    # 1. split every edge that crosses f = 0 at the crossing
    for e in [e for e in bm.edges]:
        a, b = e.verts; fa, fb = val[a], val[b]
        if (fa > eps and fb < -eps) or (fa < -eps and fb > eps):
            t = fa / (fa - fb)
            ne, nv = bmesh.utils.edge_split(e, a, t)
            nv.co = a.co.lerp(b.co, t); val[nv] = 0.0
    # 2. split every face between the zero points on its boundary
    for face in [fc for fc in bm.faces]:
        zs = [v for v in face.verts if abs(val[v]) <= eps]
        if len(zs) < 2: continue
        vs = list(face.verts)
        # (only if there is something on both sides)
        if not any(val[v] > eps for v in vs) or not any(val[v] < -eps for v in vs): continue
        if len(zs) == 2:
            a, b = zs
            if b in [e.other_vert(a) for e in a.link_edges if face in e.link_faces]: continue   # (already an edge)
            try: bmesh.utils.face_split(face, a, b)
            except Exception: pass
    # 3. delete the faces on the positive side
    kill = [fc for fc in bm.faces if sum(val.get(v, f(v.co)) for v in fc.verts) / len(fc.verts) > 0]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')

def keep_largest(bm, min_share=0.0):
    # keep the biggest connected piece (and any others at least min_share of its size)
    bm.faces.ensure_lookup_table(); seen = set(); parts = []
    for f0 in bm.faces:
        if f0 in seen: continue
        stack = [f0]; part = []; seen.add(f0)
        while stack:
            fc = stack.pop(); part.append(fc)
            for e in fc.edges:
                for g in e.link_faces:
                    if g not in seen: seen.add(g); stack.append(g)
        parts.append(part)
    parts.sort(key=len, reverse=True)
    kill = [fc for p in parts[1:] if len(p) < min_share * len(parts[0]) for fc in p]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

def plane(co, no):
    co = Vector(co); no = Vector(no).normalized()
    return lambda p: (p - co).dot(no)
