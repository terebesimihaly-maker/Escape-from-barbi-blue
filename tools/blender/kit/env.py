# Escape from Barbi Blue: the dim interior reflection maps (WP2.7; build spec B10: wet floors and glass catch the room).
#   textures/env/<style>.webp  256 x 128 equirect (three's equirectUv convention, as the sky), seen from 1.2 m up in the middle of a
#                              4.5 x 4.5 m room of the style's own shipped floor, walls and ceiling, a window with moonlight coming in
#                              on one side, a warm lamp glowing on another, the rest in the dark; rendered at 1024 x 512, 128 spp,
#                              denoised, averaged down (so it's smooth enough to be blurred as an envMap)
#   py -3.11 tools/blender/kit/env.py [--only wood,tile]
import sys, os, math, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
from mathutils import Vector
import kitlib, defs
import surfaces2 as S
from kitlib import OPTS, TMP

OUT = os.path.join(defs.REPO, 'textures', 'env')
L = 2.25

def room(style):
    man = S.manifest_load()['styles'][style]; H = 3.0
    fl = S.ship_mat('env_floor', man['floor']); wA = S.ship_mat('env_wall', man['wall'], 0); ce = S.ship_mat('env_ceil', man['ceil'])
    for i in (-1, 0):
        for j in (-1, 0):
            S.quad(f'f{i}{j}', (i * L, j * L, 0), (L, 0, 0), (0, L, 0), mat=fl); S.quad(f'c{i}{j}', (i * L, (j + 1) * L, H), (L, 0, 0), (0, -L, 0), mat=ce)
    for k in (-1, 0):                                                      # (four walls, two faces each)
        S.quad(f'wn{k}', ((k + 1) * L, L, 0), (-L, 0, 0), (0, 0, H), mat=wA); S.quad(f'ws{k}', (k * L, -L, 0), (L, 0, 0), (0, 0, H), mat=wA)
        S.quad(f'we{k}', (L, k * L, 0), (0, L, 0), (0, 0, H), mat=wA)
        if k == -1: S.quad(f'ww{k}', (-L, (k + 1) * L, 0), (0, -L, 0), (0, 0, H), mat=wA)
    # the window on the west wall: an opening with the moonlit night beyond (an emissive panel), the moonlight coming in
    S.quad('wwin_lo', (-L, L, 0), (0, -L, 0), (0, 0, 0.8), mat=wA); S.quad('wwin_hi', (-L, L, 2.65), (0, -L, 0), (0, 0, 0.35), mat=wA)
    S.quad('wwin_l', (-L, L, 0.8), (0, -(L - 0.55), 0), (0, 0, 1.85), mat=wA); S.quad('wwin_r', (-L, -0.55 + 0.0, 0.8), (0, -(L - 0.55), 0), (0, 0, 1.85), mat=wA)
    sky = kitlib.Mat('env_sky'); em = sky.n('ShaderNodeEmission'); em.inputs['Color'].default_value = (0.05, 0.07, 0.13, 1); em.inputs['Strength'].default_value = 1.0
    sky.l(em.outputs[0], sky.out_node.inputs['Surface']); S.quad('wsky', (-L - 0.4, 0.55, 0.8), (0, -1.1, 0), (0, 0, 1.85), mat=sky.m)
    moon = kitlib.link(bpy.data.objects.new('moon', bpy.data.lights.new('moon', 'SUN'))); moon.data.energy = 0.6; moon.data.color = (0.6, 0.7, 1.0); moon.data.angle = math.radians(0.5)
    moon.rotation_euler = Vector((1.0, 0.25, -0.7)).to_track_quat('-Z', 'Y').to_euler()
    lamp = kitlib.link(bpy.data.objects.new('lamp', bpy.data.lights.new('lamp', 'POINT'))); lamp.data.energy = 18; lamp.data.color = (1.0, 0.72, 0.45)
    lamp.data.shadow_soft_size = 0.08; lamp.location = (1.2, L - 0.2, 1.95)

def main():
    from PIL import Image
    os.makedirs(OUT, exist_ok=True)
    for st in [s for s in defs.KIT['styles'] if OPTS.want(s)]:
        t0 = time.time(); kitlib.reset(); sc = bpy.context.scene; room(st)
        cam = kitlib.link(bpy.data.objects.new('pano', bpy.data.cameras.new('pano'))); sc.camera = cam
        cam.data.type = 'PANO'; cam.data.panorama_type = 'EQUIRECTANGULAR'; cam.location = (0, 0, 1.2); cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
        p = S.render(os.path.join(TMP, f'env_{st}.png'), 1024, 512, 128)
        Image.open(p).convert('RGB').resize((256, 128), Image.LANCZOS).save(os.path.join(OUT, f'{st}.webp'), 'WEBP', quality=90, method=6)
        print(f'env {st}: {time.time() - t0:.0f}s', flush=True)

if __name__ == '__main__':
    main()
