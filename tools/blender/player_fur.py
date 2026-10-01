# Escape from Barbi Blue: short hair as real hairs (shell fur): the scalp copied N times, each copy a little higher, every
# hair a column through the copies that thins to its tip (the texture: tools/blender/hair_textures2.py fur()). The hairs lean
# the way they grow: each copy's texture is shifted a little further along the hair's flow, so a buzz cut stands up short and
# hair pulled back for a ponytail lies flat, combed towards the tie. Only the scalp itself is in the file; the game stacks the
# copies when it loads (js/player-model.js, the meshes named Fur*; how high and how many: FUR there):
#   UV0: the scalp's spherical layout (the hairline: how much hair there is, from the scalp texture's alpha)
#   UV1: the hairs' own tiling layout at their roots, UV2: the same at their tips (shifted along the flow)
import sys, os, math; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import hair_textures2

C = Vector((0, -0.03, 1.45))
def angles(p):
    d = p - C; return math.degrees(math.atan2(d.x, -d.y)), math.degrees(math.asin(max(-1, min(1, d.z / d.length))))
def sph_uv(p):
    az, el = angles(p); return [0.5 + az / 360, (el - hair_textures2.EL0) / (hair_textures2.EL1 - hair_textures2.EL0)]

def build_fur(arm, name, height, lean, flow, margin=13, tile=0.014, keep=None, mat=None, region=None, head_uv=False):
    """height: how long the hairs stand (m); lean: how far along the flow their tips are from their roots (m);
    flow(p): which way the hair grows at p (any vector: only its part along the scalp counts); keep(p): which faces get hair
    region(p): instead of the scalp, these faces of the head (facial hair); head_uv: UV0 is then the head's own layout (the face
    texture's: where the beard is is painted in the game, js/player-model.js)"""
    head = bpy.data.objects['Head']
    b = bmesh.new(); b.from_mesh(head.data); b.normal_update()
    inside = (lambda v: region(v.co)) if region else (lambda v: (lambda az, el: el > hair_textures2.hairline(az) - margin)(*angles(v.co)) and (keep is None or keep(v.co)))
    bmesh.ops.delete(b, geom=[f for f in b.faces if not all(inside(v) for v in f.verts)], context='FACES')
    bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context='VERTS')
    tmp = bpy.data.meshes.new(name + '_base'); b.to_mesh(tmp); b.free()
    # the hairs' own layout: Blender's smart projection (few seams, little stretching), then scaled so a tile is `tile` metres
    o = bpy.data.objects.new(name + '_base', tmp); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.view_layer.objects: ob.select_set(ob == o)
    huv = tmp.uv_layers[0].data; head_uvs = [[huv[i].uv.copy() for i in p.loop_indices] for p in tmp.polygons]
    tmp.uv_layers.new(name='Fur')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    uvf = tmp.uv_layers['Fur'].data
    a3 = sum(p.area for p in tmp.polygons); au = 0
    for p in tmp.polygons:
        q = [uvf[i].uv for i in p.loop_indices]
        for k in range(1, len(q) - 1): au += abs((q[k] - q[0]).cross(q[k + 1] - q[0])) / 2
    k = math.sqrt(a3 / max(au, 1e-12)) / tile
    vs = [v.co.copy() for v in tmp.vertices]; ns = [v.normal.copy() for v in tmp.vertices]
    wts = [[(head.vertex_groups[g.group].name, g.weight) for g in v.groups] for v in tmp.vertices]
    polys = [(list(p.vertices), [uvf[i].uv * k for i in p.loop_indices]) for p in tmp.polygons]
    bpy.data.objects.remove(o); bpy.data.meshes.remove(tmp)
    # each face: which way its hair grows, in the hairs' layout (how a step on the scalp moves in UV1)
    def shift(pts, uvs):
        P0, P1, P2 = pts[0], pts[1], pts[2]; E1, E2 = P1 - P0, P2 - P0
        n = E1.cross(E2)
        if n.length < 1e-12: return Vector((0, 0))
        n.normalize(); c = sum(pts, Vector()) / len(pts)
        f = flow(c); f = f - n * f.dot(n)
        if f.length < 1e-9: return Vector((0, 0))
        f = f.normalized() * lean
        g11, g12, g22 = E1.dot(E1), E1.dot(E2), E2.dot(E2); det = g11 * g22 - g12 * g12
        if abs(det) < 1e-18: return Vector((0, 0))
        r1, r2 = f.dot(E1), f.dot(E2); a = (r1 * g22 - r2 * g12) / det; bb = (r2 * g11 - r1 * g12) / det
        return (uvs[1] - uvs[0]) * a + (uvs[2] - uvs[0]) * bb
    # (averaged over the faces that share a corner in the layout, so a hair never breaks at a triangle's edge)
    acc = {}
    face_sh = [shift([vs[i] for i in vi], uv) for vi, uv in polys]
    for (vi, uv), sh in zip(polys, face_sh):
        for i, q in zip(vi, uv):
            key = (i, round(q.x, 5), round(q.y, 5)); a = acc.setdefault(key, [Vector((0, 0)), 0]); a[0] += sh; a[1] += 1
    loop_sh = [[acc[(i, round(q.x, 5), round(q.y, 5))][0] / acc[(i, round(q.x, 5), round(q.y, 5))][1] for i, q in zip(vi, uv)] for vi, uv in polys]
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v + n * 0.0005) for v, n in zip(vs, ns)], [], [vi for vi, uv in polys]); me.update()
    u0, u1, u2 = me.uv_layers.new(name='UVMap'), me.uv_layers.new(name='FurUV'), me.uv_layers.new(name='FurTip')
    for p, (vi, uv), sh, hu in zip(me.polygons, polys, loop_sh, head_uvs):
        if head_uv: a = [[q.x, q.y] for q in hu]
        else:
            a = [sph_uv(vs[i]) for i in vi]; us = [q[0] for q in a]
            if max(us) - min(us) > 0.5: a = [[q[0] + 1 if q[0] < 0.5 else q[0], q[1]] for q in a]   # (across the seam at the back)
        for li, qa, qc, d in zip(p.loop_indices, a, uv, sh): u0.data[li].uv = qa; u1.data[li].uv = qc; u2.data[li].uv = qc + d
    u0.active_render = True; me.uv_layers.active = u0               # (the hairline layout first: TEXCOORD_0, what the material's map uses)
    W = wts
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.parent = arm
    ob.modifiers.new('Armature', 'ARMATURE').object = arm
    groups = {}
    for i, w in enumerate(W):
        for g, x in w:
            if g not in groups: groups[g] = ob.vertex_groups.new(name=g)
            groups[g].add([i], x, 'REPLACE')
    if mat: me.materials.append(mat)
    return ob
