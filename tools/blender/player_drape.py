# Escape from Barbi Blue: the players' clothes made to hang like real ones (tools/blender/player_build.py runs this on the
# garments from tools/blender/player_clothes.py, which follow the body like a second skin).
#   Below the chest a top falls straight down from the widest point instead of clinging to the stomach and the waist;
#   below the hips trousers fall straight down each leg instead of clinging to the knees and calves.
#   Then the folds clothes really have: soft waves along a T-shirt's hem, creases under the arms, trousers bunching above
#   the shoes and behind the knees, a hoodie's ribbed hem and cuffs gathered in.
# Everything moves only outwards from the body, so nothing pokes through; the weights (skinning) stay as they were.
import sys, os, math; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def subdivide(o, levels=1):
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = levels; m.render_levels = levels; m.uv_smooth = 'PRESERVE_BOUNDARIES'
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)

def column_fall(bm, sel, axis_of, top, bottom, fall=0.0, cinch=None, bins=64, dz=0.01):
    """the cloth under `top` hangs: in each direction round the axis, never closer in than it is higher up (less `fall` a cm)"""
    vs = [v for v in bm.verts if sel(v.co) and bottom - 0.02 <= v.co.z <= top + 0.02]
    if not vs: return
    def polar(co):
        c = axis_of(co.z); d = Vector((co.x - c.x, co.y - c.y)); return math.atan2(d.x, -d.y), d.length, d
    nz = int((top - bottom) / dz) + 3; R = [[0.0] * nz for _ in range(bins)]
    info = {}
    for v in vs:
        th, r, d = polar(v.co); b = int((th + math.pi) / (2 * math.pi) * bins) % bins; k = max(0, min(nz - 1, int((top - v.co.z) / dz)))
        R[b][k] = max(R[b][k], r); info[v] = (th, r, d, b, k)
    for b in range(bins):                               # (running down each column)
        run = 0.0
        for k in range(nz):
            run = max(R[b][k], run - fall * dz * 100 if run else 0.0); R[b][k] = run
    sm = [[(R[(b - 1) % bins][k] + 2 * R[b][k] + R[(b + 1) % bins][k]) / 4 for k in range(nz)] for b in range(bins)]
    for v, (th, r, d, b, k) in info.items():
        f = (th + math.pi) / (2 * math.pi) * bins - 0.5; b0 = int(math.floor(f)) % bins; b1 = (b0 + 1) % bins; t = f - math.floor(f)
        want = sm[b0][k] * (1 - t) + sm[b1][k] * t
        if cinch: want = cinch(v.co.z, want, r)
        if v.co.z > top: continue
        w = min(1.0, (top - v.co.z) / 0.04)              # (blend in just under the chest / the hips)
        grow = (want - r) * w
        if abs(grow) > 1e-5 and d.length > 1e-6: v.co += Vector((d.x, d.y, 0)).normalized() * max(-0.006, min(0.05, grow))

def flatten_chest(o, keep=0.62):
    """the body's chest is made smaller in the game (its chest bones scaled: 0.62 or 0.2); a top that followed those bones
    crumpled into two pinched folds. So the top is shaped round a chest of `keep` here and no longer follows those bones"""
    arm = o.parent; gi = {g.index: g.name for g in o.vertex_groups}
    heads = {n: arm.matrix_world @ arm.data.bones[n].head_local for n in ('breast.L', 'breast.R') if n in arm.data.bones}
    if not heads: return
    spine = o.vertex_groups.get('spine02') or o.vertex_groups.new(name='spine02')
    moved = []
    for v in o.data.vertices:
        for g in v.groups:
            n = gi.get(g.group)
            if n in heads and g.weight > 0: moved.append((v.index, n, g.weight)); v.co -= (v.co - heads[n]) * (1 - keep) * g.weight
    for i, n, w in moved:
        o.vertex_groups[n].remove([i]); spine.add([i], w, 'ADD')

ARM = ('upperarm', 'lowerarm', 'wrist', 'finger', 'thumb', 'metacarpal', 'hand', 'shoulder', 'clavicle')
LEG = ('upperleg', 'lowerleg', 'foot', 'toe', 'knee')
def family(bone, x):
    """which part of the body a bone moves: the torso, an arm or a leg (by side)"""
    n = bone.lower(); side = 'L' if x > 0 else 'R'
    if any(k in n for k in ARM) and 'clavicle' not in n: return 'arm' + side
    if any(k in n for k in LEG): return 'leg' + side
    return 'torso'
def dominant(groups_of_vertex, names):
    best = max(groups_of_vertex, key=lambda g: g[1], default=None); return names.get(best[0]) if best else None
def body_trees(o, keep=0.62):
    """one BVH tree per part of the body (chest made smaller and smoothed like body_tree): cloth is only ever laid on, or kept
    out of, the part that moves it (a trouser leg never on the hand hanging next to it)"""
    from mathutils.bvhtree import BVHTree
    names = {g.index: g.name for g in o.vertex_groups}
    fam = [family(dominant([(g.group, g.weight) for g in v.groups], names) or 'spine', v.co.x) for v in o.data.vertices]
    full = body_mesh(o, keep); out = {}
    for f in set(fam):
        b = full.copy(); b.verts.ensure_lookup_table()
        bmesh.ops.delete(b, geom=[fc for fc in b.faces if any(fam[v.index] != f for v in fc.verts)], context='FACES')
        if b.faces: b.normal_update(); out[f] = BVHTree.FromBMesh(b)
        b.free()
    full.normal_update(); out['all'] = BVHTree.FromBMesh(full); full.free()
    return out
def body_mesh(o, keep=0.62):
    arm = o.parent; gi = {g.index: g.name for g in o.vertex_groups}
    heads = {n: arm.matrix_world @ arm.data.bones[n].head_local for n in ('breast.L', 'breast.R') if arm and n in arm.data.bones}
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    for v in o.data.vertices:
        for g in v.groups:
            n = gi.get(g.group)
            if n in heads and g.weight > 0: bm.verts[v.index].co -= (v.co - heads[n]) * (1 - keep) * g.weight
    chest = [v for v in bm.verts if 1.03 < v.co.z < 1.27 and v.co.y < 0.0 and abs(v.co.x) < 0.15 and not v.is_boundary]
    for _ in range(12): bmesh.ops.smooth_vert(bm, verts=chest, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    return bm

def body_tree(o, keep=0.62):
    """a BVH tree of a body part with its chest made smaller like flatten_chest (what the clothes must stay outside of)"""
    from mathutils.bvhtree import BVHTree
    arm = o.parent; gi = {g.index: g.name for g in o.vertex_groups}
    heads = {n: arm.matrix_world @ arm.data.bones[n].head_local for n in ('breast.L', 'breast.R') if arm and n in arm.data.bones}
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    for v in o.data.vertices:
        for g in v.groups:
            n = gi.get(g.group)
            if n in heads and g.weight > 0: bm.verts[v.index].co -= (v.co - heads[n]) * (1 - keep) * g.weight
    # (only a few dozen of its vertices follow the chest bones, so made smaller the chest creases: smoothed into a clean shape)
    chest = [v for v in bm.verts if 1.03 < v.co.z < 1.27 and v.co.y < 0.0 and abs(v.co.x) < 0.15 and not v.is_boundary]
    for _ in range(12): bmesh.ops.smooth_vert(bm, verts=chest, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update(); t = BVHTree.FromBMesh(bm); bm.free(); return t

def reshape(bm, trees_of, offset, rim=0.003, axis=None):
    """the garment laid evenly over the body: every point `offset` above the body (so none of the creases of the clothes these
    were first cut from are left); its open edges keep their fold, `rim` under the cloth. Where axis(co) gives a centre line
    (the torso, a leg), straight out from it onto the outermost skin (the nearest point would fold the cloth into every hollow,
    like the one under the chest); elsewhere (shoulders, sleeves) onto the nearest point"""
    bm.normal_update()
    edge = {v for v in bm.verts if v.is_boundary}
    for v in bm.verts:
        trees = trees_of(v)
        c = axis(v.co) if axis else None
        if c is not None:
            d = Vector((v.co.x - c.x, v.co.y - c.y, 0))
            if d.length > 1e-5:
                d.normalize(); best = None
                for t in trees:
                    hit = t.ray_cast(c + d * 0.6, -d, 0.6)
                    if hit[0] is not None and (best is None or (hit[0] - c).length > (best - c).length): best = hit[0]
                if best is not None: v.co = best + d * offset; continue
        best = None
        for t in trees:
            loc, no, i, dd = t.find_nearest(v.co)
            if loc is not None and (best is None or dd < best[2]): best = (loc, no, dd)
        if best: v.co = best[0] + best[1] * offset
    for _ in range(4): bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v not in edge], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in edge: v.co -= v.normal * rim

def keep_out(bm, trees_of, gap, axis):
    """nothing of the body through the cloth: on the torso and the legs straight out from their middle (like reshape: the
    nearest point's direction flips in the hollows and throws the cloth out in spikes), elsewhere along the nearest point"""
    for v in bm.verts:
        trees = trees_of(v)
        c = axis(v.co)
        if c is not None:
            d = Vector((v.co.x - c.x, v.co.y - c.y, 0)); r = d.length
            if r < 1e-5: continue
            d.normalize(); far = 0.0
            for t in trees:
                hit = t.ray_cast(c + d * 0.6, -d, 0.6)
                if hit[0] is not None: far = max(far, (hit[0] - c).length)
            if r < far + gap: v.co += d * (far + gap - r)
        else:                                           # (along the cloth's own direction: the body's flips in the armpits)
            loc, no, i, dd = trees[0].find_nearest(v.co)
            if loc is None: continue
            s = (v.co - loc).dot(no)
            if s < gap: v.co += v.normal * min(0.006, gap - s)
    pits = [v for v in bm.verts if 0.08 < abs(v.co.x) < 0.2 and 1.05 < v.co.z < 1.28 and not v.is_boundary]
    for _ in range(3): bmesh.ops.smooth_vert(bm, verts=pits, factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)

def push_out(bm, tree, gap):
    for v in bm.verts:
        loc, no, i, dd = tree.find_nearest(v.co)
        if loc is None: continue
        s = (v.co - loc).dot(no)
        if s < gap: v.co += no * (gap - s)

def make_skirt(arm, fam_trees, body):
    """an A-line skirt: a smooth round waist (under the top's hem), over the widest part of the hips, flaring out to just
    above the knees, with soft folds that deepen towards the hem; a fold of cloth at the hem; skinned like the body under it"""
    old = bpy.data.objects.get('Skirt')
    if old: bpy.data.objects.remove(old)
    seg, rings, z0, z1 = 112, 26, 0.955, 0.6
    axis = Vector((0, -0.016, 0)); trees = [t[f] for t in fam_trees for f in ('torso', 'legL', 'legR') if f in t]   # (not the hands beside it)
    # (the body's outline round the hips, from the waist down: the outermost skin in each direction at each height)
    R = [[0.0] * seg for _ in range(rings)]
    for i in range(rings):
        z = z0 - (z0 - z1) * i / (rings - 1)
        for j in range(seg):
            a = j / seg * 2 * math.pi; d = Vector((math.sin(a), -math.cos(a), 0)); c = Vector((axis.x, axis.y, z)); far = 0.0
            for t in trees:
                hit = t.ray_cast(c + d * 0.6, -d, 0.6)
                if hit[0] is not None: far = max(far, (hit[0] - c).length)
            R[i][j] = far
    for _ in range(6):                                   # (smooth round: no corners)
        R = [[(R[i][j - 1] + 2 * R[i][j] + R[i][(j + 1) % seg]) / 4 for j in range(seg)] for i in range(rings)]
    V = []
    for j in range(seg):
        run = 0.0
        for i in range(rings):
            run = max(run, R[i][j]); R[i][j] = run          # (never in again below the widest part)
    for i in range(rings):
        z = z0 - (z0 - z1) * i / (rings - 1); t = i / (rings - 1)
        for j in range(seg):
            a = j / seg * 2 * math.pi
            r = R[i][j] + 0.006 + 0.07 * t ** 1.3 + 0.006 * t ** 1.5 * math.sin(a * 11 + math.sin(a * 3) * 1.2)
            V.append(Vector((axis.x + math.sin(a) * r, axis.y - math.cos(a) * r, z)))
    F = [(i * seg + j, i * seg + (j + 1) % seg, (i + 1) * seg + (j + 1) % seg, (i + 1) * seg + j) for i in range(rings - 1) for j in range(seg)]
    me = bpy.data.meshes.new('Skirt'); me.from_pydata([tuple(v) for v in V], [], F); me.update()
    uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index; i, j = divmod(vi, seg)
            jj = j if not (j == 0 and any(me.loops[k].vertex_index % seg == seg - 1 for k in p.loop_indices)) else seg
            uv.data[li].uv = (jj / seg * 1.4, (z0 - V[vi].z) / 0.4)
    o = bpy.data.objects.new('Skirt', me); bpy.context.scene.collection.objects.link(o); o.parent = arm
    for p in me.polygons: p.use_smooth = True
    m = o.modifiers.new('so', 'SOLIDIFY'); m.thickness = 0.0025; m.offset = -1; m.use_rim = True
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)
    # (skinned like the body: each point takes the weights of the nearest skin)
    for g in body.vertex_groups: o.vertex_groups.new(name=g.name)
    dt = o.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = body; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=dt.name)
    o.modifiers.new('Armature', 'ARMATURE').object = arm
    print('skirt', len(o.data.vertices))
    return o

def drape_all(bodies):
    """bodies: the bare body's parts (to lay the cloth on and keep it outside of)"""
    fam_trees = [body_trees(b) for b in bodies]
    make_skirt(bodies[0].parent, fam_trees, bodies[0])
    from mathutils.bvhtree import BVHTree
    torso_axis = lambda z: Vector((0, -0.012, z))
    def leg_axis(objs_bm, s):
        cache = {}
        def f(z):
            k = round(z, 2)
            if k not in cache:
                pts = [v.co for v in objs_bm.verts if v.co.x * s > 0.02 and abs(v.co.z - z) < 0.02]
                cache[k] = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), z)) if pts else Vector((s * 0.09, -0.015, z))
            return cache[k]
        return f
    for name in ('Tee', 'LongTop', 'Hoodie', 'Trousers', 'ShortPants'):
        o = bpy.data.objects.get(name)
        if not o: continue
        subdivide(o)
        if name in ('Tee', 'LongTop', 'Hoodie'): flatten_chest(o)
        bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update()
        dl = bm.verts.layers.deform.active; gnames = {g.index: g.name for g in o.vertex_groups}
        vfam = {v: family(dominant(list(v[dl].items()), gnames) or 'spine', v.co.x) for v in bm.verts}
        trees_of = lambda v: [t.get(vfam.get(v, 'torso'), t['all']) for t in fam_trees]
        trees = [t['all'] for t in fam_trees]
        if name in ('Tee', 'LongTop', 'Hoodie'):           # (the torso straight out from its middle; shoulders and sleeves: nearest)
            ax = lambda co: torso_axis(co.z) if abs(co.x) < (0.12 if co.z > 1.05 else 0.165) and 0.8 < co.z < 1.23 else None
        else:                                               # (each leg straight out from its middle, below the crotch)
            ax = lambda co: Vector((math.copysign(0.088, co.x), -0.015, co.z)) if co.z < 0.8 and abs(co.x) > 0.015 else None
        reshape(bm, trees_of, {'Tee': 0.0085, 'LongTop': 0.008, 'Hoodie': 0.014}.get(name, 0.004), axis=ax)   # (tops clear of the trousers' waist under them)
        zs = [v.co.z for v in bm.verts]; hem = min(zs)
        if name in ('Tee', 'LongTop', 'Hoodie'):
            torso = lambda co: abs(co.x) < (0.13 if co.z > 1.06 else 0.168)   # (not the sleeves hanging beside it)
            cinch = None
            if name == 'Hoodie':                            # (the ribbed band at the bottom: gathered in a little)
                cinch = lambda z, want, r, h=hem: want - 0.012 * max(0.0, 1 - (z - h) / 0.05)
            column_fall(bm, torso, torso_axis, 1.22, hem, fall=0.0 if name == 'Hoodie' else 0.0006, cinch=cinch)
            bm.normal_update()
            for v in bm.verts:                              # (the folds)
                z, x = v.co.z, v.co.x; th = math.atan2(x, -(v.co.y + 0.012)); n = v.normal
                d = 0.0
                if name != 'Hoodie' and z < hem + 0.07 and abs(x) < 0.2:                  # (soft waves along the hem)
                    d += 0.0035 * math.sin(th * 9 + math.sin(th * 3) * 1.5) * (1 - (z - hem) / 0.07)
                if 0.1 < abs(x) < 0.16 and 1.08 < z < 1.22:                                # (creases under the arms)
                    d += 0.0022 * math.sin((z * 1.0 + abs(x) * 0.9) * 140) * math.sin(min(1, (1.22 - z) / 0.14) * math.pi)
                if name == 'Hoodie' and abs(x) > 0.19 and z < 0.93:                          # (the sleeves gathered at the cuffs)
                    d += 0.0028 * math.sin(z * 260 + th * 2) * min(1, (0.93 - z) / 0.03)
                v.co += n * d
        else:
            legs_bm = bm
            for s in (1, -1):
                lax = leg_axis(legs_bm, s)
                column_fall(bm, lambda co, s=s: co.x * s > 0.012 and co.z < 0.66, lax, 0.62, hem, fall=0.0009)
            bm.normal_update()
            for v in bm.verts:
                z = v.co.z; n = v.normal; th = math.atan2(v.co.x, -(v.co.y + 0.015)); d = 0.0
                if name == 'Trousers' and z < 0.24:                                           # (bunched above the shoes, unevenly)
                    d += 0.0024 * math.sin(z * 170 + th * 1.5 + math.sin(th * 3 + z * 40) * 2) * min(1, (0.24 - z) / 0.08)
                if 0.4 < z < 0.52 and v.co.y > 0.0:                                           # (behind the knees)
                    d += 0.0016 * math.sin(z * 190 + v.co.x * 60) * math.sin((z - 0.4) / 0.12 * math.pi)
                if 0.86 < z < 0.95 and v.co.y < -0.03:                                        # (the crotch and the zip)
                    d += 0.0018 * math.sin(abs(v.co.x) * 300) * math.sin((z - 0.86) / 0.09 * math.pi)
                v.co += n * d
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if not v.is_boundary], factor=0.25, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.normal_update()
        keep_out(bm, trees_of, 0.004, ax)                      # (after smoothing: the body never shows through)
        bm.normal_update(); bm.to_mesh(o.data); bm.free()
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = min(1.0, 7000 / len(o.data.vertices))   # (back down to a size a phone can draw)
        with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
        with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)
        print('draped', name, len(o.data.vertices))
