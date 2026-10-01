# Escape from Barbi Blue: contact sheets of the packed kit, to look at what was built. For each node of a file: front, 3/4 and
# top views side by side, labelled with the name, triangles and size, under a neutral studio light (a soft grey dome, a big
# key light, fill and rim, AgX), on a grey floor. With --moody, also one shot the way the game lights a room at night: a single
# warm lamp, a cool moonlight fill from a window, near-black everywhere else, from a standing player's eye height.
# It reads the uncompressed GLB pack.py exported (/tmp/efbb-kit/pack/<tier>/<file>.glb: Blender can't read meshopt); with
# --shipped, the file in models/kit itself, decoded and dequantised first through gltf-transform (to see the lo tier's
# simplified meshes as they ship).
#   /tmp/claude-0/bpyenv/bin/python tools/blender/kit/contact_sheets.py [--file wood] [--tier hi] [--only <node or id>,...]
#       [--out dir] [--size 560] [--samples 96] [--moody] [--closeup] [--shipped] [--real (skip the nodes still grey-box placeholders)]
import sys, os, math, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
from mathutils import Vector
import kitlib, defs
from kitlib import TMP

def arg(k, d=None):
    a = sys.argv[1:]
    return a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else d

def studio(sc):
    """a photographer's grey sweep: soft dome, a large key from the front left, a fill, a rim from behind"""
    w = sc.world; w.use_nodes = True; nt = w.node_tree; bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements; e[0].position = 0.45; e[0].color = (0.05, 0.05, 0.052, 1)
    e[1].position = 0.75; e[1].color = (0.42, 0.42, 0.44, 1); nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.8
    for name, e_, size, loc in (('key', 260, 2.2, (-2.2, -2.6, 3.0)), ('fill', 70, 3.0, (2.8, -1.8, 1.4)), ('rim', 160, 1.6, (1.2, 3.0, 2.6))):
        L = kitlib.link(bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))); L.data.energy = e_; L.data.size = size
        L.location = loc; L['studio'] = 1
    floor('studio_floor', (0.16, 0.16, 0.165), 0.6)
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'

def floor(name, col, rough, size=30):
    me = bpy.data.meshes.new(name); s = size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    o = kitlib.link(bpy.data.objects.new(name, me)); m = kitlib.Mat(name); m.out(col, rough); me.materials.append(m.m); return o

def aim(cam, target, direction, dist):
    cam.location = Vector(target) + Vector(direction).normalized() * dist
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()

def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == 'MESH' for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

def render(sc, path):
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); return path

def sheet(node, objs, out, size, samples, info):
    from PIL import Image, ImageDraw
    sc = bpy.context.scene; sc.cycles.samples = samples; sc.render.resolution_x = sc.render.resolution_y = size
    cam = bpy.data.objects.get('cam') or kitlib.link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))); sc.camera = cam; cam.data.lens = 50
    lo, hi = bounds(objs); c = (lo + hi) / 2; r = max(0.15, (hi - lo).length / 2); d = r / math.tan(cam.data.angle / 2) * 1.08
    tiles = []
    for k, dirn in enumerate(((0, -1, 0.14), (math.sin(0.62), -math.cos(0.62), 0.42), (0.0, -0.32, 1.0))):
        aim(cam, c, dirn, d); tiles.append(Image.open(render(sc, f'{out}.{k}.png')).convert('RGB')); os.remove(f'{out}.{k}.png')
    W = sum(t.width for t in tiles); img = Image.new('RGB', (W, size + 26), (24, 24, 26)); x = 0
    for t in tiles: img.paste(t, (x, 26)); x += t.width
    ImageDraw.Draw(img).text((8, 6), f'{node}   {info}', fill=(230, 230, 230)); img.save(out); return out

def closeup(node, objs, out, size, samples):
    """a tight 3/4 look at the upper half, about as close as a player gets: where texture faults show"""
    sc = bpy.context.scene; cam = sc.camera; sc.render.resolution_x = int(size * 1.5); sc.render.resolution_y = size; sc.cycles.samples = samples
    lo, hi = bounds(objs); c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + (hi.z - lo.z) * 0.62)); r = max(0.15, (hi - lo).length / 2)
    aim(cam, c, (math.sin(0.75), -math.cos(0.75), 0.55), r / math.tan(cam.data.angle / 2) * 0.55); render(sc, out)
    sc.render.resolution_x = sc.render.resolution_y = size; return out

def moody(node, objs, out, size, samples):
    """the game's night: one warm lamp (2700 K), a cool moon fill through a window, the rest near black; eye height 1.6 m"""
    sc = bpy.context.scene
    for o in list(sc.objects):
        if o.get('studio') or o.name == 'studio_floor': o.hide_render = True
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.004
    fl = floor('moody_floor', (0.055, 0.04, 0.03), 0.55)
    wall = floor('moody_wall', (0.09, 0.075, 0.065), 0.9, 8); wall.rotation_euler = (math.pi / 2, 0, 0); wall.location = (0, 1.1, 0)
    lo, hi = bounds(objs); c = (lo + hi) / 2
    lamp = kitlib.link(bpy.data.objects.new('lamp', bpy.data.lights.new('lamp', 'POINT'))); lamp.data.energy = 55; lamp.data.shadow_soft_size = 0.05
    lamp.data.color = (1.0, 0.62, 0.32); lamp.location = (c.x - 1.3, c.y - 0.5, 1.75)
    moon = kitlib.link(bpy.data.objects.new('moon', bpy.data.lights.new('moon', 'SUN'))); moon.data.energy = 0.35; moon.data.angle = math.radians(1.5)
    moon.data.color = (0.55, 0.68, 1.0); moon.rotation_euler = (math.radians(58), 0, math.radians(-120))
    cam = sc.camera; cam.data.lens = 35; sc.render.resolution_x = int(size * 1.5); sc.render.resolution_y = size; sc.cycles.samples = samples * 2
    aim(cam, (c.x, c.y, (lo.z + hi.z) * 0.42), (0.55, -1.0, 0.0), 1.0); cam.location.z = 1.6
    cam.location = Vector((c.x, c.y, 0)) + (cam.location - Vector((c.x, c.y, 0))).normalized() * 2.1; cam.location.z = 1.6
    cam.rotation_euler = (Vector((c.x, c.y, (lo.z + hi.z) * 0.42)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    render(sc, out)
    for o in (fl, wall, lamp, moon): bpy.data.objects.remove(o)
    for o in sc.objects:
        if o.get('studio') or o.name == 'studio_floor': o.hide_render = False
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8; cam.data.lens = 50
    return out

DECODE = r"""
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src); await doc.transform(dequantize());
for (const e of doc.getRoot().listExtensionsUsed()) if (['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(e.extensionName)) e.dispose();
await io.write(dst, doc);
"""
def decoded(path):
    """a copy of a shipped (meshopt, quantised) GLB that Blender can import"""
    import subprocess
    js = kitlib.node_script(DECODE, 'kit-decode.mjs'); out = os.path.join(TMP, 'sheets', 'decoded_' + os.path.basename(os.path.dirname(path)) + '_' + os.path.basename(path))
    os.makedirs(os.path.dirname(out), exist_ok=True); r = subprocess.run(['node', js, path, out], cwd=kitlib.GLTFT, capture_output=True, text=True)
    if r.returncode: raise RuntimeError('decode failed: ' + r.stderr[-1500:])
    return out

def main():
    f = arg('--file', 'wood'); tier = arg('--tier', 'hi'); only = set(arg('--only').split(',')) if arg('--only') else None
    size = int(arg('--size', 560)); samples = int(arg('--samples', 96)); out_dir = arg('--out', os.path.join(TMP, 'sheets', tier, f))
    os.makedirs(out_dir, exist_ok=True); t0 = time.time()
    sc = kitlib.reset(samples); sc.cycles.use_denoising = True; sc.render.film_transparent = False
    src = decoded(os.path.join(kitlib.KITDIR, tier, f + '.glb')) if '--shipped' in sys.argv else os.path.join(TMP, 'pack', tier, f + '.glb')
    bpy.ops.import_scene.gltf(filepath=src)
    studio(sc); outs = []
    try: man = json.load(open(os.path.join(kitlib.KITDIR, 'manifest.json')))['nodes']
    except (OSError, ValueError, KeyError): man = {}
    for n in defs.nodes(f):
        if only and not (n['name'] in only or n['id'] in only): continue
        if '--real' in sys.argv and man.get(n['name'], {}).get('placeholder', True): continue
        root = bpy.data.objects.get(n['name'])
        if not root: print('contact_sheets: no', n['name']); continue
        objs = [root] + list(root.children_recursive); keep = set(objs)
        for o in sc.objects:
            if o.type in ('MESH', 'EMPTY') and not o.get('studio') and o.name not in ('studio_floor',): o.hide_render = o not in keep
        tc = sum(len(p.vertices) - 2 for o in objs if o.type == 'MESH' for p in o.data.polygons)
        lo, hi = bounds(objs); dims = hi - lo
        info = f'{tc} tris   {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f} m   {tier}'
        outs.append(sheet(n['name'], objs, os.path.join(out_dir, n['name'] + '.png'), size, samples, info))
        if '--closeup' in sys.argv: outs.append(closeup(n['name'], objs, os.path.join(out_dir, n['name'] + '_closeup.png'), size, samples))
        if '--moody' in sys.argv: outs.append(moody(n['name'], objs, os.path.join(out_dir, n['name'] + '_moody.png'), size, samples))
        print('sheet', outs[-1], f'{time.time() - t0:.0f}s')
    return outs

if __name__ == '__main__':
    main()
