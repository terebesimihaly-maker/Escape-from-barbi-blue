# Escape from Barbi Blue: the lookdev reference (WP2.8; build spec C3, WP6 k calibration).
#   One reference room per style, 4.5 x 6.75 m and 3.0 m high, made of the game's own pieces: the style's shipped wall, floor and
#   ceiling surfaces (textures/surf, hi tier), a few of its kit nodes from the packed hi GLB, its light fixtures, and moonlight through
#   a window opening in the east wall. Each lamp is lit the way the game lights it: a point light at the fixture's light centre
#   (profiles.json mount) whose emission follows the fixture's profile (the 64 x 32 lat-long of relative intensity, mean 1), with
#   Cycles power 4 pi k0 W (the game's k: irradiance at 1 m), warm white (2700 K); the fixture's own body doesn't shadow it (the
#   profile already holds that), its Emit parts glow for the camera only. Rendered in Cycles, AgX, two views per room.
#   -> models/kit/lookdev/<style>_<view>.png and models/kit/lookdev/lookdev.json (rooms, surfaces, nodes, fixtures, moon, cameras in
#      three.js axes and metres; each view's exposure and the mean linear luminance of its render) for ?lookdev=1 and WP6.
#   Needs the uncompressed pack (pack.py all hi): /tmp/efbb-kit/pack/hi/<style>.glb.
#   py -3.11 tools/blender/kit/lookdev.py [--only wood,tile] [--samples 256] [--size 960x540] [--preview]
import sys, os, math, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
import numpy as np
from mathutils import Vector, Matrix
import kitlib, defs
import surfaces2 as S
from kitlib import TMP

OUT = os.path.join(defs.REPO, 'models', 'kit', 'lookdev')
RX, RY, RH = 4.5, 6.75, 3.0                                                   # (the room: x 0..4.5, y 0..6.75, z 0..3; east wall x = 4.5)
WIN = (2.875, 3.875, 0.9, 2.3)                                                # (the window opening in the east wall: y0, y1, z0, z1)
LAMP = (1.0, 0.72, 0.42)                                                      # (2700 K, linear)
MOON = {'dir': (-0.74, 0.3, -0.6), 'strength': 0.35, 'colour': (0.58, 0.68, 1.0)}
VIEWS = {'entry': ((0.45, 0.4, 1.6), (3.0, 5.0, 1.1)), 'window': ((4.05, 6.35, 1.6), (1.5, 1.9, 0.9))}
LENS = 18.0                                                                   # (mm on a 36 mm sensor: 90 deg across)

# per style: kit nodes (name, x, y, rot about z) and fixtures (id, where): where = ('ceiling', x, y) | ('wall', 'w'|'n', along) |
# ('socket', socket name) | ('floor', x, y, rot)
ROOMS = {
    'wood': {'nodes': [('Solid_crib_v0', 1.0, 5.4, 0.0), ('Solid_iron_bed', 3.3, 5.2, 0.0), ('Solid_rocking_chair', 1.2, 2.2, -0.6), ('Solid_toy_chest_v0', 3.9, 1.0, math.pi / 2),
                       ('Band_dresser', 2.4, RY, 0.0), ('Isl_tea_party', 2.5, 2.9, 0.0)],
             'fix': [('pendant_shade', ('ceiling', 2.25, 3.4)), ('sconce_shade', ('wall', 'w', 4.3)), ('night_light', ('socket', 'Band_dresser_fix'))]},
    'tile': {'nodes': [('Isl_parlour', 2.2, 4.4, 0.0), ('Band_console', 3.3, RY, 0.0), ('Band_console_mirror', 3.3, RY, 0.0), ('Band_grandfather_clock', 0.0, 2.2, -math.pi / 2),
                       ('Solid_plinth_bust', 3.9, 0.9, 0.0), ('Band_sideboard', 1.4, RY, 0.0)],
             'fix': [('chandelier', ('ceiling', 2.25, 3.2)), ('sconce_candles', ('wall', 'w', 4.6)), ('standard_lamp', ('socket', 'Isl_parlour_fix')), ('candelabrum', ('surface', 'Band_sideboard', 1.4, RY - 0.22, 0.87))]},
    'concrete': {'nodes': [('Solid_boiler_wall', 1.6, RY, 0.0), ('Solid_shelf_rack', 0.75, 3.9, 0.0), ('Solid_chest_freezer', 3.7, 1.0, math.pi / 2), ('Col_brick_pier_H300', 3.5, 5.3, 0.0),
                           ('Band_fuse_box', 3.6, RY, 0.0)],
                 'fix': [('bare_bulb', ('ceiling', 2.4, 3.4)), ('bulkhead', ('wall', 'n', 3.0)), ('boiler_glow', ('socket', 'Solid_boiler_wall_fix'))]},
    'attic': {'nodes': [('Isl_trunk_pile', 2.3, 4.6, 0.0), ('Solid_sheet_chair_v0', 1.0, 2.0, 0.4), ('Solid_sheet_tall_v0', 1.0, 6.3, 0.0), ('Band_box_stack', 0.0, 5.2, -math.pi / 2),
                        ('Band_mannequin', 0.0, 3.1, -math.pi / 2), ('Solid_steamer_trunk_v1', 3.4, 1.1, 0.2)],
              'fix': [('bulb_batten', ('ceiling', 2.25, 3.0)), ('hurricane_lantern', ('socket', 'Isl_trunk_pile_fix'))]},
    'workshop': {'nodes': [('Solid_workbench', 2.4, 3.6, 0.0), ('Solid_kiln', 0.75, 5.95, 0.0), ('Band_head_shelf', 2.9, RY, 0.0), ('Band_eye_shelf', 0.0, 2.2, -math.pi / 2),
                           ('Solid_sewing_table', 3.8, 1.0, math.pi / 2)],
                 'fix': [('green_shade', ('ceiling', 2.4, 3.6)), ('anglepoise', ('socket', 'Solid_workbench_fix')), ('kiln_glow', ('socket', 'Solid_kiln_fix'))]},
}

def arg(k, d=None):
    a = sys.argv[1:]
    return a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else d

def three(v): v = Vector(v); return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]   # (Blender z-up -> three.js y-up)

# ================================================================ the room
def room(style):
    man = S.manifest_load()['styles'][style]; T = 2.25
    wA, wB = S.ship_mat('ld_wallA', man['wall'], 0), S.ship_mat('ld_wallB', man['wall'], 1)
    fA, fB = S.ship_mat('ld_floorA', man['floor'], 0), S.ship_mat('ld_floorB', man['floor'], 1); cl = S.ship_mat('ld_ceil', man['ceil'], 0)
    for i in range(2):
        for j in range(3): S.quad(f'ld_f{i}{j}', (i * T, j * T, 0.0), (T, 0, 0), (0, T, 0), mat=fA if (i + j) % 2 == 0 else fB)
        for j in range(3): S.quad(f'ld_c{i}{j}', (i * T, (j + 1) * T, RH), (T, 0, 0), (0, -T, 0), mat=cl)
    for i in range(2): S.quad(f'ld_s{i}', ((i + 1) * T, 0.0, 0.0), (-T, 0, 0), (0, 0, RH), mat=wA if i % 2 == 0 else wB)          # (south wall, faces +y)
    for i in range(2): S.quad(f'ld_n{i}', (i * T, RY, 0.0), (T, 0, 0), (0, 0, RH), mat=wB if i % 2 == 0 else wA)                # (north, faces -y)
    for j in range(3): S.quad(f'ld_w{j}', (0.0, j * T, 0.0), (0, T, 0), (0, 0, RH), mat=wA if j % 2 == 0 else wB)                # (west, faces +x)
    for j in (0, 2): S.quad(f'ld_e{j}', (RX, (j + 1) * T, 0.0), (0, -T, 0), (0, 0, RH), mat=wA if j == 0 else wB)                # (east, faces -x)
    y0, y1, z0, z1 = WIN; t0 = T * 1                                            # (the middle east tile round the window: four pieces, UVs cut to match)
    for (ya, yb, za, zb) in ((t0, y0, 0.0, RH), (y1, t0 + T, 0.0, RH), (y0, y1, 0.0, z0), (y0, y1, z1, RH)):
        S.quad(f'ld_ew{ya:.2f}{za:.2f}', (RX, yb, za), (0, -(yb - ya), 0), (0, 0, zb - za), ((t0 + T - yb) / T, za / RH), ((t0 + T - ya) / T, zb / RH), mat=wB)
    S.quad('ld_rev0', (RX, y0, z0), (0, 0, z1 - z0), (0.3, 0, 0), mat=wA); S.quad('ld_rev1', (RX, y1, z0), (0.3, 0, 0), (0, 0, z1 - z0), mat=wA)   # (the opening's reveals,
    S.quad('ld_sill', (RX, y0, z0), (0.3, 0, 0), (0, y1 - y0, 0), mat=wA); S.quad('ld_head', (RX, y0, z1), (0, y1 - y0, 0), (0.3, 0, 0), mat=wA)    #  its sill and head)

# ================================================================ kit pieces and lamps
def place(name, x, y, rot):
    ob = bpy.data.objects.get(name)
    if ob is None: print('lookdev: no', name); return None
    ob.matrix_world = Matrix.Translation((x, y, 0.0)) @ Matrix.Rotation(rot, 4, 'Z'); return ob

def glow_materials():
    """the reserved materials as the game shows them: Glass clear, Emit glowing for the camera only"""
    for m in bpy.data.materials:
        if not m.use_nodes: continue
        if m.name.startswith('Glass'):
            b = m.node_tree.nodes.get('Principled BSDF')
            if b: b.inputs['Transmission Weight'].default_value = 1.0; b.inputs['Roughness'].default_value = 0.03; b.inputs['Base Color'].default_value = (1, 1, 1, 1)
        if m.name.startswith('Emit'):
            nt = m.node_tree; out = nt.nodes.get('Material Output'); em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*LAMP, 1); em.inputs['Strength'].default_value = 6.0
            lp = nt.nodes.new('ShaderNodeLightPath'); tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
            nt.links.new(lp.outputs['Is Camera Ray'], mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(em.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], out.inputs['Surface'])

def profile_light(name, prof, centre, rot, k0):
    """a point light emitting through the fixture's profile: the direction of emission (world) turned into the fixture's frame and
       into three.js axes, looked up in the 64 x 32 lat-long; power 4 pi k0"""
    w, h = prof['w'], prof['h']; rgb = np.array(prof['rgb'], dtype=np.float32).reshape(h, w, 3)
    im = bpy.data.images.new('ldp_' + name, w, h, float_buffer=True); px = np.ones((h, w, 4), dtype=np.float32)
    im.colorspace_settings.name = 'Non-Color'                               # (first: changing it later regenerates the image blank)
    px[:, :, :3] = rgb[::-1]; im.pixels.foreach_set(px.ravel()); im.update(); im.pack()
    L = bpy.data.lights.new(name, 'POINT'); L.energy = 4 * math.pi * k0; L.shadow_soft_size = 0.02; L.color = (1, 1, 1); L.use_nodes = True
    nt = L.node_tree; em = nt.nodes['Emission']; n = nt.nodes.new
    tc = n('ShaderNodeTexCoord'); vr = n('ShaderNodeVectorRotate'); vr.rotation_type = 'Z_AXIS'; vr.invert = True; vr.inputs['Angle'].default_value = rot
    nt.links.new(tc.outputs['Normal'], vr.inputs['Vector']); sp = n('ShaderNodeSeparateXYZ'); nt.links.new(vr.outputs[0], sp.inputs[0])
    def m(op, a, b=None):
        q = n('ShaderNodeMath'); q.operation = op
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): q.inputs[i].default_value = v
            else: nt.links.new(v, q.inputs[i])
        return q.outputs[0]
    tx, ty, tz = sp.outputs['X'], sp.outputs['Z'], m('MULTIPLY', sp.outputs['Y'], -1.0)       # (three.js axes: x, y = up, z = front)
    lon = m('ARCTAN2', tx, tz); u = m('DIVIDE', m('ADD', lon, math.pi), 2 * math.pi)
    v = m('SUBTRACT', 1.0, m('DIVIDE', m('ARCCOSINE', m('MINIMUM', m('MAXIMUM', ty, -1.0), 1.0)), math.pi))
    cb = n('ShaderNodeCombineXYZ'); nt.links.new(u, cb.inputs[0]); nt.links.new(v, cb.inputs[1])
    tex = n('ShaderNodeTexImage'); tex.image = im; tex.interpolation = 'Linear'; tex.extension = 'REPEAT'; nt.links.new(cb.outputs[0], tex.inputs['Vector'])
    mc = n('ShaderNodeVectorMath'); mc.operation = 'MULTIPLY'; mc.inputs[1].default_value = LAMP   # (profile x the lamp's colour)
    nt.links.new(tex.outputs['Color'], mc.inputs[0]); nt.links.new(mc.outputs['Vector'], em.inputs['Color'])
    ob = kitlib.link(bpy.data.objects.new(name, L)); ob.location = centre; return ob

def fixture_world(fid, where, H, sockets):
    """where the fixture's node goes -> (position, rotation about z)"""
    kind = where[0]; f = defs.KIT['fixtures'][fid]
    if kind == 'ceiling': return Vector((where[1], where[2], H)), 0.0
    if kind == 'wall':
        side, along = where[1], where[2]
        return (Vector((0.0, along, 0.0)), -math.pi / 2) if side == 'w' else (Vector((along, RY, 0.0)), 0.0)
    if kind == 'socket':
        s = sockets[where[1]]; return s[0], s[1]
    if kind == 'surface': return Vector((where[2], where[3], where[4])), 0.0
    return Vector((where[1], where[2], 0.0)), where[3] if len(where) > 3 else 0.0

# ================================================================ render
def render_view(style, vid, samples, size, exposure):
    sc = bpy.context.scene; (cp, ct) = VIEWS[vid]; S.cam_at(cp, ct, LENS)
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Base Contrast'; sc.view_settings.exposure = exposure
    os.makedirs(OUT, exist_ok=True); exr = os.path.join(TMP, 'lookdev', f'{style}_{vid}.exr'); os.makedirs(os.path.dirname(exr), exist_ok=True)
    png = os.path.join(OUT, f'{style}_{vid}.png')
    bpy.ops.render.render(); rr = bpy.data.images['Render Result']
    sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'; rr.save_render(exr, scene=sc)
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_depth = '8'; rr.save_render(png, scene=sc)
    im = bpy.data.images.load(exr); a = np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)[:, :3]; bpy.data.images.remove(im)
    lum = float((a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).mean())
    vfov = 2 * math.degrees(math.atan(36.0 / 2 / LENS * size[1] / size[0]))
    return {'id': vid, 'pos': three(cp), 'target': three(ct), 'vfov_deg': round(vfov, 3), 'size': list(size), 'png': f'models/kit/lookdev/{style}_{vid}.png',
            'view_transform': 'AgX (Base Contrast)', 'exposure': exposure, 'mean_luminance_linear': round(lum, 6)}

def build(style, samples, size, exposure):
    sc = kitlib.reset(samples); w = bpy.data.worlds.new('ld_night'); sc.world = w; w.use_nodes = True     # (a night outside the window, near black)
    bg = w.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (0.0015, 0.002, 0.004, 1.0); bg.inputs['Strength'].default_value = 1.0
    src = os.path.join(TMP, 'pack', 'hi', style + '.glb'); bpy.ops.import_scene.gltf(filepath=src)
    R = ROOMS[style]; keep = set(); placed = []
    for name, x, y, rot in R['nodes']:
        ob = place(name, x, y, rot)
        if ob: keep.add(ob); placed.append({'node': name, 'pos': three((x, y, 0.0)), 'yaw': round(rot, 4)})
    bpy.context.view_layer.update()
    sockets = {}
    for ob in keep:
        for c in ob.children_recursive:
            if c.name.endswith('_fix'): sockets[c.name] = (c.matrix_world.translation.copy(), ob.matrix_world.to_euler().z)
    profiles = json.load(open(os.path.join(defs.REPO, 'textures', 'light', 'profiles.json')))['profiles']
    fixtures = []
    for fid, where in R['fix']:
        node = defs.KIT['fixtures'][fid]['node']; pos, rot = fixture_world(fid, where, RH, sockets)
        ob = bpy.data.objects.get(node)
        if ob is None: print('lookdev: no fixture', node); continue
        ob.matrix_world = Matrix.Translation(pos) @ Matrix.Rotation(rot, 4, 'Z'); keep.add(ob)
        for o in [ob] + list(ob.children_recursive):
            if o.type == 'MESH': o.visible_shadow = False
        p = profiles[fid]; mt = p['mount']; centre = ob.matrix_world @ Vector((mt[0], -mt[2], mt[1]))
        profile_light(f'ld_{fid}', p, centre, rot, p['k0'])
        fixtures.append({'type': fid, 'node': node, 'pos': three(pos), 'yaw': round(rot, 4), 'light_centre': three(centre), 'k0': p['k0'],
                         'cycles_power_w': round(4 * math.pi * p['k0'], 4), 'colour_linear': list(LAMP)})
    gone = [c.name for ob in bpy.data.objects if ob.parent is None and ob.type in ('MESH', 'EMPTY') and ob not in keep and not ob.name.startswith('ld_')
            for c in [ob] + list(ob.children_recursive)]                       # (the kit's other nodes out of the way)
    for nm in gone:
        if nm in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects[nm], do_unlink=True)
    glow_materials(); room(style)
    d = Vector(MOON['dir']).normalized(); sun = S.lamp('ld_moon', 'SUN', MOON['strength'], (RX + 2, 3.4, 3.5), None, math.radians(0.6), MOON['colour'])
    sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    views = [render_view(style, v, samples, size, exposure) for v in VIEWS]
    return {'style': style, 'size': [RX, RH, RY], 'origin': 'three.js axes, metres: the room spans x 0..4.5, y 0..3.0, z -6.75..0 (Blender y = -z)',
            'surfaces': {'floor': 'floor A/B checker per 2.25 m tile', 'walls': 'wall A/B alternating per tile', 'ceiling': 'ceil'},
            'window': {'wall': 'east (x = 4.5)', 'z_range': [WIN[2], WIN[3]], 'span': [round(-WIN[1], 4), round(-WIN[0], 4)], 'glass': 'none (an opening)'},
            'nodes': placed, 'fixtures': fixtures, 'views': views}

def main():
    only = set(arg('--only').split(',')) if arg('--only') else None; samples = int(arg('--samples', 64 if '--preview' in sys.argv else 256))
    size = tuple(int(q) for q in arg('--size', '960x540').split('x')); exposure = float(arg('--exposure', 2.0)); t0 = time.time()
    path = os.path.join(OUT, 'lookdev.json')
    try: doc = json.load(open(path))
    except (OSError, ValueError): doc = {'version': 1, 'rooms': {}}
    doc['note'] = ('WP2.8 reference rooms for ?lookdev=1 and the WP6 k calibration (+-25% mean luminance). Lamps: point lights through '
                   'textures/light/profiles.json at k0 (Cycles power 4 pi k0 W, Blender convention), fixture bodies cast no shadow; Emit parts glow '
                   'for the camera only. Moon: a sun lamp, direction (three.js axes) and strength in W/m2. Render: Cycles, AgX Base Contrast, the '
                   'stated exposure; mean_luminance_linear is the scene-linear Rec.709 luminance of the render before the view transform.')
    doc['moon'] = {'dir': three(Vector(MOON['dir']).normalized()), 'strength_w_m2': MOON['strength'], 'colour_linear': list(MOON['colour'])}
    doc['world_colour_linear'] = [0.0015, 0.002, 0.004]; doc['lamp_colour_linear'] = list(LAMP)
    for style in ROOMS:
        if only and style not in only: continue
        t1 = time.time(); doc['rooms'][style] = build(style, samples, size, exposure)
        print(f'lookdev {style}: {time.time() - t1:.0f}s', [(v['id'], v['mean_luminance_linear']) for v in doc['rooms'][style]['views']], flush=True)
    json.dump(doc, open(path, 'w'), indent=1); print(f'lookdev: {time.time() - t0:.0f}s ->', path)

if __name__ == '__main__':
    main()
