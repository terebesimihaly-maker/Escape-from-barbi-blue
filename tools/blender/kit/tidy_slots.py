# Escape from Barbi Blue: drops the material slots no face uses from registered asset .blend files (the reserved parts joined back
# after a bake used to bring every source material along as empty slots, and pack.py splits any node with more than two materials
# into parts). Keeps the baked material first. Run after a build, before pack.py; it only rewrites files that change.
#   py -3.11 tools/blender/kit/tidy_slots.py [glob ...]     (default: the doors, windows and modules assets)
import sys, os, glob
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
import defs

def tidy(path):
    bpy.ops.wm.open_mainfile(filepath=path); changed = []
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or not ob.data.materials: continue
        me = ob.data; used = sorted(set(p.material_index for p in me.polygons))
        if len(used) == len(me.materials): continue
        keep = sorted((me.materials[i] for i in used), key=lambda m: 0 if m and m.name.startswith('Kit_') else 1)
        mi = [keep.index(me.materials[p.material_index]) for p in me.polygons]
        me.materials.clear()
        for m in keep: me.materials.append(m)
        me.polygons.foreach_set('material_index', mi); me.update(); changed.append(f'{ob.name} {len(used)}')
    if changed:
        bpy.ops.wm.save_mainfile(filepath=path)
        print(os.path.basename(path) + ': ' + ', '.join(changed))
    return bool(changed)

if __name__ == '__main__':
    pats = sys.argv[1:] or ['doors_*', 'exit_*', 'fireplace_*', 'wallhole_*', 'peel_*', 'niche_*', 'ceiling_*', 'Win_*']
    files = sorted(set(f for p in pats for f in glob.glob(os.path.join(defs.WORK, p + '.blend'))))
    n = sum(tidy(f) for f in files)
    print(f'tidy_slots: {n} of {len(files)} files changed')
