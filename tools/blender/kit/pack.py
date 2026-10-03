# Escape from Barbi Blue: packs the house kit. For one style (or common) and one tier it gathers every KIT node of that style
# from the asset .blend files the kit scripts registered in /tmp/efbb-kit/assets (a real asset always wins over its grey-box
# placeholder; among real ones the newest), points the textures at the tier's copies (md half, lo quarter size), splits any
# node with more than 2 materials into <name>_p0, <name>_p1 under an empty <name>, exports one GLB, compresses it
# (meshopt; lo also simplified to half the triangles) into models/kit/<tier>/<style>.glb and updates models/kit/manifest.json.
#   /tmp/claude-0/bpyenv/bin/python tools/blender/kit/pack.py <style|all> <tier|all> [--if-stale]
import sys, os, json, glob, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
import kitlib, defs, glbinfo
from kitlib import TMP, KITDIR, TIERS

def providers(style):
    """{node name: asset .blend} for the style's nodes"""
    regs = []
    for f in glob.glob(os.path.join(TMP, 'assets', '*.json')):
        r = json.load(open(f))
        if os.path.exists(r['blend']): regs.append(r)
    out = {}
    for n in defs.nodes(style):
        c = [r for r in regs if n['name'] in r['nodes']]
        if not c: raise SystemExit(f'pack: no asset provides {n["name"]} (run placeholder.py first)')
        c.sort(key=lambda r: (not r['placeholder'], r['time'])); out[n['name']] = c[-1]['blend']
    return out

SHARED = set(defs.RESERVED) | {'Kit_grey', 'glTF Material Output'}
def _dedupe(coll):
    """after appending from several files: 'Glass.001' etc. become the one 'Glass' again (reserved names must stay exact).
       Only the shared ones: two assets' meshes, images or own materials may share a name and still differ."""
    for d in list(coll):
        base, dot, num = d.name.rpartition('.')
        if dot and num.isdigit() and base in coll and base in SHARED:
            d.user_remap(coll[base]); coll.remove(d)

def _same_images(a, b):
    files = lambda m: sorted(bpy.path.abspath(n.image.filepath) for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image) if m.node_tree else []
    return files(a) == files(b) and files(a)

def _share():
    """a baked piece used again inside an island (or anywhere) comes in twice from two .blend files: the images that are the same file,
       and the Kit_ materials over the same images, made one again, so the GLB holds their textures once"""
    by = {}
    for im in list(bpy.data.images):
        if not im.filepath: continue
        k = os.path.normcase(os.path.abspath(bpy.path.abspath(im.filepath)))
        if k in by and by[k] is not im: im.user_remap(by[k]); bpy.data.images.remove(im)
        else: by.setdefault(k, im)
    for m in list(bpy.data.materials):
        base, dot, num = m.name.rpartition('.')
        if dot and num.isdigit() and base.startswith('Kit_') and base in bpy.data.materials and _same_images(m, bpy.data.materials[base]):
            m.user_remap(bpy.data.materials[base]); bpy.data.materials.remove(m)

def _load(want):
    """append the wanted roots (and everything under them) from each blend, nothing else"""
    by_blend = {}
    for name, blend in want.items(): by_blend.setdefault(blend, set()).add(name)
    roots = []
    for blend, names in sorted(by_blend.items(), key=lambda kv: 'placeholder' in kv[0]):
        with bpy.data.libraries.load(blend, link=False) as (src, dst): dst.objects = list(src.objects)
        objs = [o for o in dst.objects if o]
        keep = set()
        for o in objs:
            base = o.name.rpartition('.')[0] if o.name.rpartition('.')[2].isdigit() else o.name
            if o.parent is None and base in names: keep.add(o); keep.update(o.children_recursive)
        for o in objs:
            if o not in keep: bpy.data.objects.remove(o)
        for o in keep:
            bpy.context.scene.collection.objects.link(o)
            if o.parent is None: roots.append(o)
        for coll in (bpy.data.materials, bpy.data.node_groups): _dedupe(coll)
        _share()
    for o in bpy.data.objects:                              # (names back to exact, now the clashing copies are gone)
        base, dot, num = o.name.rpartition('.')
        if dot and num.isdigit() and base not in bpy.data.objects: o.name = base
    return roots

def _tier_images(tier):
    for im in bpy.data.images:
        p = im.filepath
        if '.hi.webp' in p and tier != 'hi':
            q = p.replace('.hi.webp', f'.{tier}.webp')
            if os.path.exists(bpy.path.abspath(q)): im.filepath = q; im.reload()

def _split(ob):
    """a node with more than 2 materials: its faces split by material, two materials per part, as children <name>_p0, _p1..
       of an empty that keeps the name and the transform"""
    me = ob.data; mats = list(me.materials); name = ob.name
    groups = [list(range(i, min(i + 2, len(mats)))) for i in range(0, len(mats), 2)]
    holder = kitlib.empty(name + '_tmp', parent=ob.parent); holder.matrix_world = ob.matrix_world.copy()
    for k, g in enumerate(groups):
        part = ob.copy(); part.data = me.copy(); bpy.context.scene.collection.objects.link(part)
        import bmesh
        bm = bmesh.new(); bm.from_mesh(part.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in g], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        for f in bm.faces: f.material_index = g.index(f.material_index)
        bm.to_mesh(part.data); bm.free()
        part.data.materials.clear()
        for i in g: part.data.materials.append(mats[i])
        part.parent = holder; part.matrix_parent_inverse.identity(); part.matrix_basis.identity(); part.name = f'{name}_p{k}'
    for c in list(ob.children): c.parent = holder; c.matrix_parent_inverse.identity()
    bpy.data.objects.remove(ob); holder.name = name
    return holder

def _lo_decimate(style, roots):
    """the lo tier's deep cuts (an island's 25k to 6k): meshopt keeps every UV seam and a kit piece is all seams, so these are cut
       in Blender (collapse, which crosses seams and carries the UVs along) before export -> the meshes it cut"""
    done = set(); budget = {n['name']: n['trisLo'] for n in defs.nodes(style)}
    for r in roots:
        meshes = [o for o in [r] + list(r.children_recursive) if o.type == 'MESH']
        t = sum(kitlib.tris(o) for o in meshes)
        if not t or 0.92 * budget[r.name] / t >= 0.85: continue            # (meshopt manages a light trim; on a piece that is all seams it stalls short of anything more)
        ratio = min(0.5, 0.92 * budget[r.name] / t)
        for o in meshes:
            if o.data.users > 1: o.data = o.data.copy()
            m = o.modifiers.new('lo', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = ratio; m.use_collapse_triangulate = True
            with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier=m.name)
            done.add(o.data.name)
    return done

def _lo_targets(style, roots, cut=()):
    """lo keeps about half the triangles (B1), less where a node's trisLo budget needs it (islands: 25k -> 6k); written as
       {mesh name: [ratio, error]} for compress-kit.mjs"""
    out = {}; budget = {n['name']: n['trisLo'] for n in defs.nodes(style)}
    for r in roots:
        meshes = [o for o in [r] + list(r.children_recursive) if o.type == 'MESH']
        t = sum(kitlib.tris(o) for o in meshes)
        if not t: continue
        ratio = min(0.5, 0.92 * budget[r.name] / t); err = 0.0015 if ratio >= 0.5 else 0.004   # (a deep cut may move a vertex 4 mm per m)
        for o in meshes: out[o.data.name] = [1.0, 0.0015] if o.data.name in cut else [round(ratio, 4), err]
    path = os.path.join(TMP, 'pack', 'lo', style + '.targets.json'); json.dump(out, open(path, 'w')); return path

def stale(style, tier):
    """whether models/kit/<tier>/<style>.glb is older than anything it's made from"""
    out = os.path.join(KITDIR, tier, style + '.glb')
    if not os.path.exists(out): return True
    ins = [os.path.join(HERE, f) for f in ('pack.py', 'kitlib.py', 'defs.py', 'glbinfo.py', 'compress-kit.mjs')] + [defs.SRC]
    ins += list(set(providers(style).values()))
    for b in set(providers(style).values()):            # (and the textures those assets use)
        d = os.path.join(TMP, 'tex', os.path.basename(b)[:-6])
        if os.path.isdir(d): ins += [os.path.join(d, f) for f in os.listdir(d) if f.endswith('.webp')]
    return max(os.path.getmtime(p) for p in ins if os.path.exists(p)) > os.path.getmtime(out)

def pack(style, tier):
    t0 = time.time(); kitlib.reset()
    want = providers(style); roots = _load(want)
    missing = [n for n in want if n not in bpy.data.objects]
    if missing: raise SystemExit(f'pack {style}/{tier}: missing after load: {missing[:8]}')
    _tier_images(tier)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and len(o.data.materials) > 2: _split(o)
    roots = [bpy.data.objects[n] for n in want]
    raw = os.path.join(TMP, 'pack', tier, style + '.glb'); os.makedirs(os.path.dirname(raw), exist_ok=True)
    cut = _lo_decimate(style, roots) if tier == 'lo' else set()
    kitlib.export_glb(roots, raw)
    out = os.path.join(KITDIR, tier, style + '.glb'); os.makedirs(os.path.dirname(out), exist_ok=True)
    if tier == 'lo': kitlib.compress(raw, out, 0.5, 0.0015, _lo_targets(style, roots, cut))
    else: kitlib.compress(raw, out)
    manifest(style, tier, out, {n: ('placeholder' in b) for n, b in want.items()})
    print(f'pack {style}/{tier}: {len(want)} nodes, {os.path.getsize(out) / 1e3:.0f} KB, {time.time() - t0:.1f}s')
    return out

def manifest(style, tier, path, placeholder):
    """models/kit/manifest.json: per node its file, kind, mount, box (three.js axes: y up, the front +z; metres, in the node's
       own frame), triangles per tier, materials, uv1, children; per tier the files' sizes (for the loading bar)"""
    mp = os.path.join(KITDIR, 'manifest.json')
    try: man = json.load(open(mp))
    except (OSError, ValueError): man = {}
    man.update({'version': 1, 'kit': defs.KIT['version'], 'u': defs.U, 'axes': 'three.js: y up, front +z; aabb [min, max] in metres in the node frame'})
    man.setdefault('tiers', {}).setdefault(tier, {})[style] = os.path.getsize(path)
    nodes = man.setdefault('nodes', {}); g = glbinfo.Glb(path)
    for n in defs.nodes(style):
        i = g.find(n['name'])
        if i is None: continue
        b = g.box(i); e = nodes.setdefault(n['name'], {})
        e.update({'file': style, 'group': n['group'], 'id': n['id'], 'mount': n['mount'], 'fit': n['fit'], 'placeholder': placeholder.get(n['name'], True),
                  'materials': g.materials(i), 'uv1': g.uv1(i, defs.RESERVED[1:]), 'children': [g.nodes[c]['name'] for c in g.nodes[i].get('children', [])]})
        if b: e['aabb'] = [[round(b[0][0], 4), round(b[0][2], 4), round(-b[1][1], 4)], [round(b[1][0], 4), round(b[1][2], 4), round(-b[0][1], 4)]]
        e.setdefault('tris', {})[tier] = g.tris(i)
        if 'foot' in n: e.update({'slot': n['slot'], 'foot': n['foot'], 'footU': n['footU']})
        if n['group'] == 'ward' and n.get('hinge'): e['hinge'] = [round(v, 4) for v in glbinfo.b2g(n['hinge'])]
    man['nodes'] = dict(sorted(nodes.items()))
    json.dump(man, open(mp, 'w'), indent=1)

if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    styles = defs.files() if not a or a[0] == 'all' else [a[0]]
    tiers = list(TIERS) if len(a) < 2 or a[1] == 'all' else [a[1]]
    for s in styles:
        for t in tiers:
            if '--if-stale' in sys.argv and not stale(s, t): print(f'pack {s}/{t}: up to date'); continue
            pack(s, t)
