# Escape from Barbi Blue: builds models/player.glb (the players' model) in Blender, from models/barbi.glb:
#   python tools/blender/player_clothes.py && python tools/blender/player_build.py      (Blender's Python module: pip install bpy)
# The body and face stay the model's own; added: real clothes (tools/blender/player_clothes.py), six hairstyles
# (tools/blender/player_hair.py) and skin where the body had none. Her model (models/character_mobile.glb) isn't touched.
import sys, os, math; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import *
import numpy as np
import hair_texture, cloth_textures, player_hair
from PIL import Image
OUT = '/tmp/efbb-player'; REPO = os.path.dirname(os.path.dirname(HERE))
bpy.ops.wm.open_mainfile(filepath=OUT + '/clothes.blend')
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
hair_texture.make(OUT + '/hair_strands.png')
for name, fn in (('knit', cloth_textures.knit), ('twill', cloth_textures.twill)):
    alb, nor = fn(); Image.fromarray((np.clip(alb, 0, 1) * 255).astype(np.uint8), 'L').convert('RGB').save(f'{OUT}/cloth_{name}.png'); Image.fromarray(nor, 'RGB').save(f'{OUT}/cloth_{name}_n.png')
styles = player_hair.build_hair(arm)

# ---- the clothes' material: the cloth texture (tinted in the game) times the baked shade (vertex colours), the weave's normal map
def cloth_mat(name, kind):
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bpy.data.images.load(f'{OUT}/cloth_{kind}.png')
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(f'{OUT}/cloth_{kind}_n.png'); tn.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.8
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'AO'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
    nt.links.new(tx.outputs['Color'], mix.inputs[6]); nt.links.new(vc.outputs['Color'], mix.inputs[7]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.88
    return mat
knit, twill = cloth_mat('ClothKnit', 'knit'), cloth_mat('ClothTwill', 'twill')
CLOTHES = {'Tee': knit, 'LongTop': knit, 'Hoodie': knit, 'Skirt': knit, 'Sneakers': knit, 'Trousers': twill, 'ShortPants': twill}
def area3d(o): return sum(p.area for p in o.data.polygons)
def area_uv(o):
    uv = o.data.uv_layers.active.data; s = 0
    for p in o.data.polygons:
        pts = [uv[i].uv for i in p.loop_indices]
        for k in range(1, len(pts) - 1): a, b2, c = pts[0], pts[k], pts[k + 1]; s += abs((b2 - a).cross(c - a)) / 2
    return s
for n, mat in CLOTHES.items():
    o = bpy.data.objects[n]; o.data.materials.clear(); o.data.materials.append(mat)
    k = math.sqrt(area3d(o) / max(area_uv(o), 1e-9)) / 0.05           # (the cloth texture repeats every 5 cm)
    for d in o.data.uv_layers.active.data: d.uv = d.uv * k
    for p in o.data.polygons: p.use_smooth = True

# ---- baked shade (ambient occlusion) into the clothes' vertex colours: darker under the arms, inside the collar, between the legs
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48
sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.light_settings.distance = 0.12
occluders = [bpy.data.objects[n] for n in ('Body', 'Head', 'BodyFill')]
for n in CLOTHES:
    o = bpy.data.objects[n]
    if 'AO' not in o.data.color_attributes: o.data.color_attributes.new('AO', 'BYTE_COLOR', 'POINT')
    o.data.color_attributes.active_color = o.data.color_attributes['AO']
    for ob in bpy.data.objects: ob.hide_render = not (ob == o or ob in occluders or ob.type == 'ARMATURE')
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    try: bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    except Exception as e: print('bake failed', n, e)
    # (not too dark: the game has its own lights and shadows)
    for d in o.data.color_attributes['AO'].data: c = d.color; v = 0.45 + 0.55 * c[0]; d.color = (v, v, v, 1)
for ob in bpy.data.objects: ob.hide_render = False

# ---- skin where the body had none: the body's own average skin colour (the game tints it like the body)
img = bpy.data.images['tex_skin_color']; px = np.array(img.pixels[:]).reshape(-1, 4); avg = px[px[:, 3] > 0.5, :3].mean(0)
fillm = bpy.data.materials.new('SkinFill'); fillm.use_nodes = True; fb = fillm.node_tree.nodes['Principled BSDF']
fb.inputs['Base Color'].default_value = (*avg, 1); fb.inputs['Roughness'].default_value = 0.6
fill = bpy.data.objects['BodyFill']; fill.data.materials.clear(); fill.data.materials.append(fillm)
for p in fill.data.polygons: p.use_smooth = True
print('skin average', [round(float(a), 3) for a in avg])

# ---- what goes in the file: not her old top and long hair, nor the helper sphere
for n in ('Top', 'Hair', 'Icosphere'):
    if bpy.data.objects.get(n): bpy.data.objects.remove(bpy.data.objects[n])
path = os.path.join(REPO, 'models', 'player.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_skins=True, export_animations=False, export_apply=False, export_yup=True,
    export_image_format='WEBP', export_image_quality=86, export_vertex_color='MATERIAL', export_texcoords=True, export_normals=True)
meshes = {o.name: len(o.data.vertices) for o in bpy.data.objects if o.type == 'MESH'}
print('wrote', path, round(os.path.getsize(path) / 1e6, 2), 'MB', meshes, 'total verts', sum(meshes.values()))
