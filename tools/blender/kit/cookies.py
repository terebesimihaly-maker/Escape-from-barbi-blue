# Escape from Barbi Blue: the windows' light cookies (WP2.7; build spec B10, C6; js/atmos.js shafts, js/lightbake.js cookies).
#   textures/light/cookies/<type>_<az>.webp  256 x 256 grey: how much moonlight gets through each point of the window's opening (frame,
#                         glazing bars, the iron bars, broken panes, lace and drapes as they hang) for a moon 35 deg up and az = -30, 0,
#                         +30 deg from the window's outward normal (positive toward x1: to the right looking out). Window space: column 0
#                         the opening's u0 side, row 0 its top. type = the window's id without Win_ (sash, tall, cellar, ...).
# How: the built window (its .blend from windows.py: the wall face round it, frame, glass, curtains with their lace cut-outs) lit by
# a sun lamp of 0.5 deg at that direction; the light falling on a white receiver 0.3 m inside the room is baked (direct only, glass
# clear, the sky plane out of the way), divided by what falls with nothing in the way, and read back along the light onto the
# opening's plane.
#   py -3.11 tools/blender/kit/cookies.py [--preview] [--only sash,tall]
import sys, os, math, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
import numpy as np
from mathutils import Vector
import kitlib, defs, common
from kitlib import OPTS, TMP

OUT = os.path.join(defs.REPO, 'textures', 'light', 'cookies')
PIECES = defs.KIT['arch']['pieces']
EL = math.radians(35.0); AZS = (-30, 0, 30); N = 256
YR = -0.3                                                    # (the receiver, inside the room)
RX0, RX1, RZ0, RZ1, RW, RH = -2.2, 2.2, -1.6, 4.6, 1024, 1440

def bake_light(objs_visible, img):
    sc = bpy.context.scene
    for o in sc.objects: o.hide_render = o not in objs_visible and o.type == 'MESH'
    kitlib.select([REC], REC); sc.render.bake.use_pass_direct = True; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = False
    sc.render.bake.margin = 0; sc.render.bake.use_selected_to_active = False; sc.render.bake.use_clear = True
    REC_TEX.image = img; REC_MAT.node_tree.nodes.active = REC_TEX
    bpy.ops.object.bake(type='DIFFUSE')
    a = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)[..., :3].mean(-1)
    return a                                                 # (row 0 at the bottom, as Blender keeps them)

REC = REC_MAT = REC_TEX = None

def cookie(win, az):
    """the cookie of window win for the moon at az (deg): -> 256 x 256 float, row 0 the opening's top"""
    global REC, REC_MAT, REC_TEX
    sc = bpy.context.scene; w, h, sill = PIECES[win]['open']
    d = Vector((math.sin(math.radians(az)) * math.cos(EL), math.cos(math.radians(az)) * math.cos(EL), math.sin(EL)))   # (toward the moon)
    sun = bpy.data.objects.get('ck_moon')
    if not sun:
        sun = kitlib.link(bpy.data.objects.new('ck_moon', bpy.data.lights.new('ck_moon', 'SUN'))); sun.data.energy = 3.0; sun.data.angle = math.radians(0.5)
    sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    win_objs = [o for o in sc.objects if o.type == 'MESH' and o is not REC and not o.name.endswith('_sky')]
    lit = bake_light(win_objs + [REC], bpy.data.images['ck_lit']); free = bake_light([REC], bpy.data.images['ck_free'])
    T = np.clip(lit / np.maximum(free, 1e-6), 0, 1)
    # read back along the light: the opening's point (x, 0, z) -> the receiver at y = YR
    us = (np.arange(N) + 0.5) / N; vs = (np.arange(N) + 0.5) / N
    X = -w / 2 + us[None, :] * w; Z = sill + h - vs[:, None] * h
    L = -d; t = YR / L.y; XR = X + L.x * t; ZR = Z + L.z * t
    px = (XR - RX0) / (RX1 - RX0) * RW - 0.5; pz = (ZR - RZ0) / (RZ1 - RZ0) * RH - 0.5
    i0 = np.clip(np.floor(px).astype(int), 0, RW - 2); j0 = np.clip(np.floor(pz).astype(int), 0, RH - 2); fx = np.clip(px - i0, 0, 1); fz = np.clip(pz - j0, 0, 1)
    v = T[j0, i0] * (1 - fx) * (1 - fz) + T[j0, i0 + 1] * fx * (1 - fz) + T[j0 + 1, i0] * (1 - fx) * fz + T[j0 + 1, i0 + 1] * fx * fz
    return v

def setup(win):
    global REC, REC_MAT, REC_TEX
    bpy.ops.wm.open_mainfile(filepath=os.path.join(TMP, win + '.blend'))
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; common.use_best_device(sc); sc.cycles.samples = kitlib.spp(256)
    if sc.world: sc.world.color = (0, 0, 0)
    if sc.world and sc.world.use_nodes:
        for n in sc.world.node_tree.nodes:
            if n.type == 'BACKGROUND': n.inputs['Strength'].default_value = 0.0
    for o in list(sc.objects):
        if o.type != 'MESH': continue
        if o.name.endswith('_sky'): o.hide_render = True; continue
        for i, m in enumerate(o.data.materials):                # (glass clear, the wall a dull grey, the rest as baked: lace lets light through)
            if m and m.name == 'Glass':
                g = bpy.data.materials.get('ck_glass') or bpy.data.materials.new('ck_glass'); g.use_nodes = True; nt = g.node_tree
                if not nt.nodes.get('ck_t'):
                    for n in list(nt.nodes):
                        if n.type != 'OUTPUT_MATERIAL': nt.nodes.remove(n)
                    tb = nt.nodes.new('ShaderNodeBsdfTransparent'); tb.name = 'ck_t'; nt.links.new(tb.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
                o.data.materials[i] = g
            elif m and m.name in ('WallSurface', 'SkyPlane'):
                o.data.materials[i] = kitlib.grey('ck_wall', (0.4, 0.4, 0.4))
    me = bpy.data.meshes.new('ck_rec'); me.from_pydata([(RX0, YR, RZ0), (RX1, YR, RZ0), (RX1, YR, RZ1), (RX0, YR, RZ1)], [], [(0, 3, 2, 1)])   # (facing the window)
    uv = me.uv_layers.new(name='UVMap')
    for lp, q in zip(me.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): uv.data[lp.index].uv = q
    REC = kitlib.link(bpy.data.objects.new('ck_rec', me))
    REC_MAT = bpy.data.materials.new('ck_rec'); REC_MAT.use_nodes = True; REC.data.materials.append(REC_MAT)
    REC_TEX = REC_MAT.node_tree.nodes.new('ShaderNodeTexImage')
    for nm in ('ck_lit', 'ck_free'):
        im = bpy.data.images.new(nm, RW, RH, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'

def main():
    os.makedirs(OUT, exist_ok=True); from PIL import Image
    wins = [k for k, p in PIECES.items() if p['kind'] == 'window' and (OPTS.only is None or k.replace('Win_', '') in OPTS.only)]
    for win in wins:
        t0 = time.time(); setup(win); typ = win.replace('Win_', '')
        for az in AZS:
            c = cookie(win, az); a = (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)
            Image.fromarray(a, 'L').save(os.path.join(OUT, f'{typ}_{az}.webp'), 'WEBP', quality=90, method=6)
            print(f'  cookie {typ}_{az}: mean {c.mean():.3f}', flush=True)
        print(f'cookies {typ}: {time.time() - t0:.0f}s', flush=True)

if __name__ == '__main__':
    main()
