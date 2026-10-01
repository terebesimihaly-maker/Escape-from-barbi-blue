# Escape from Barbi Blue: the grey-box house kit. Every node js/kitdefs.js names (solids and their looks, islands, columns per
# ceiling height, band decor, fixtures with their _emit child, doorways, closed doors, exits with leaf, boards and lamp, windows
# with frame, glass, sky and curtain, fireplaces, holes, peels, niches, ceiling pieces, wardrobes with the exact hinges) as plain
# boxes with the exact names, sizes and origins, so the game can be built and tested before any real asset is baked, and
# check_kit.py has something to pass. Then packs all three tiers (identical: no textures) and writes the manifest.
#   /tmp/claude-0/bpyenv/bin/python tools/blender/kit/placeholder.py [--only <style>] [--force]
import sys, os, math, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector
import kitlib, defs
from kitlib import OPTS, TMP

def box(bm, lo, hi, mat=0):
    """a closed box from lo to hi (Blender axes), faces out"""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f]).material_index = mat

def quad(bm, pts, mat=0):
    bm.faces.new([bm.verts.new(p) for p in pts]).material_index = mat

def wall_face(bm, hole=None, depth=0.0, back=False, W=2.25, H=3.0, mat=0):
    """the 2.25 x 3 m wall face at y = 0 looking into the room (-y), with a rectangular hole (x0, x1, z0, z1) and its reveal
       running depth into the wall (and a back to it when back)"""
    w = W / 2
    if not hole: quad(bm, ((-w, 0, 0), (w, 0, 0), (w, 0, H), (-w, 0, H)), mat); return
    x0, x1, z0, z1 = hole
    for a, b, c, d in (((-w, 0), (x0, 0), (x0, H), (-w, H)), ((x1, 0), (w, 0), (w, H), (x1, H)), ((x0, 0), (x1, 0), (x1, z0), (x0, z0)), ((x0, z1), (x1, z1), (x1, H), (x0, H))):
        if abs(a[0] - b[0]) > 1e-6 and abs(b[1] - c[1]) > 1e-6:
            quad(bm, ((a[0], 0, a[1]), (b[0], 0, b[1]), (c[0], 0, c[1]), (d[0], 0, d[1])), mat)
    if depth:
        r = depth
        quad(bm, ((x0, 0, z0), (x0, r, z0), (x0, r, z1), (x0, 0, z1)), mat); quad(bm, ((x1, 0, z1), (x1, r, z1), (x1, r, z0), (x1, 0, z0)), mat)
        quad(bm, ((x0, 0, z1), (x0, r, z1), (x1, r, z1), (x1, 0, z1)), mat)
        if z0 > 1e-6: quad(bm, ((x1, 0, z0), (x1, r, z0), (x0, r, z0), (x0, 0, z0)), mat)
        if back: quad(bm, ((x0, r, z0), (x1, r, z0), (x1, r, z1), (x0, r, z1)), mat)

def obj(name, build, mats, loc=(0, 0, 0), parent=None):
    bm = bmesh.new(); build(bm); bm.normal_update()
    o = kitlib.mesh_object(name, bm, mats); o.location = loc
    if parent: o.parent = parent
    return o

def sockets(root, n):
    """anim pivots and fixture sockets as empties where the real model will have them"""
    (x0, y0, z0), (x1, y1, z1) = n['box']; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; h = n.get('h', z1)
    for s in n['sockets']:
        if s.endswith('_RockPivot'): p = (0, cy, min(0.78, z1 * 0.7))
        elif s.endswith('_MobilePivot'): p = (cx, cy, z1)
        elif s.endswith('_Pendulum'): p = (cx, y0 + 0.04, z0 + (z1 - z0) * 0.72)
        elif s.endswith('_SwayPivot'): p = (cx, cy, z1)
        elif s.endswith('_fix'):
            fx = (n.get('piece') or {}).get('fix') or defs.KIT['items'].get(n['id'], {}).get('fix') or defs.KIT['band'].get(n['id'], {}).get('fix')
            mount = defs.KIT['fixtures'][fx]['mount']
            p = (0, 0.22, 0.04) if n['group'] == 'arch' else ((cx, y0 + 0.03, 0.35) if mount == 'practical' else ((x0 + 0.3, y0 + 0.3, 0) if mount == 'floor' else (cx, cy, h)))
        else: p = (cx, cy, z1)
        kitlib.empty(s, p, root)

def furniture(n, M):
    r = obj(n['name'], lambda bm: box(bm, *n['box']), [M['grey']]); sockets(r, n); return r

def fixture(n, M):
    (x0, y0, z0), (x1, y1, z1) = n['box']; zs = z0 + (z1 - z0) * 0.4
    r = obj(n['name'], lambda bm: box(bm, (x0, y0, zs), (x1, y1, z1)), [M['grey']])
    sx, sy = (x1 - x0) * 0.25, (y1 - y0) * 0.25; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    obj(n['children'][0], lambda bm: box(bm, (cx - sx, cy - sy, z0), (cx + sx, cy + sy, zs)), [M['emit']], parent=r)
    return r

def door_frame(n, M):
    p = n['piece']; w = p['W'] / 2; d = p['D'] / 2; post = p['post']; head = p['head']; H = p['H']
    def b(bm):
        for s in (-1, 1): box(bm, (min(s * w, s * (w - post)), -d, 0), (max(s * w, s * (w - post)), d, head))
        box(bm, (-w, -d, head), (w, d, H))
    return obj(n['name'], b, [M['grey']])

def face_module(n, M):
    """everything that replaces a wall face: the face (WallSurface, uv1) with its opening, plus the piece in Kit_grey"""
    p = n['piece']; k = p['kind']; R = p.get('R', 0.0); D = p['D']; kids = n['children']; name = n['name']
    if k == 'door_closed':
        dw, dh = p['door']; hole = (-dw / 2, dw / 2, 0, dh)
        def b(bm):
            wall_face(bm, hole, R, False, mat=0); box(bm, (-dw / 2, 0.04, 0), (dw / 2, 0.085, dh), 1)
            for lo, hi in (((-dw / 2 - 0.08, -D, 0), (-dw / 2, 0, dh + 0.08)), ((dw / 2, -D, 0), (dw / 2 + 0.08, 0, dh + 0.08)), ((-dw / 2, -D, dh), (dw / 2, 0, dh + 0.08))):
                box(bm, lo, hi, 1)
        return obj(name, b, [M['wall'], M['grey']])
    if k == 'exit':
        po, head = p['post'], p['head']; lw, lh = p['leaf']; hole = (-po, po, 0, head)
        def b(bm):
            wall_face(bm, hole, 0, mat=0)
            for s in (-1, 1): box(bm, (min(s * po, s * (po + 0.1)), -D, 0), (max(s * po, s * (po + 0.1)), 0.0, head + 0.1), 1)
            box(bm, (-po, -D, head), (po, 0.0, head + 0.1), 1)
            box(bm, (-po, 0.0, 0.0), (po, R, 0.005), 1); box(bm, (-po - 0.05, 0.0, 0), (-po, R, head), 1); box(bm, (po, 0.0, 0), (po + 0.05, R, head), 1)
            box(bm, (-po, 0.0, head), (po, R, head + 0.05), 1)
            quad(bm, ((-po, R - 0.01, 0), (po, R - 0.01, 0), (po, R - 0.01, head), (-po, R - 0.01, head)), 2)
        r = obj(name, b, [M['wall'], M['grey'], M['sky']])
        obj(kids[0], lambda bm: box(bm, (0, 0.005, 0), (lw, 0.055, lh)), [M['grey']], loc=(-lw / 2, 0, 0), parent=r)    # (hinged at the left post)
        def boards(bm):
            for z in (0.85, 1.55): box(bm, (-po - 0.05, -0.06, z), (po + 0.05, -0.02, z + 0.16), 0)
        obj(kids[1], boards, [M['grey']], parent=r)
        obj(kids[2], lambda bm: box(bm, (-0.05, -0.09, 2.47), (0.05, -0.01, 2.57)), [M['emit']], parent=r)
        return r
    if k == 'window':
        ow, oh, sill = p['open']; hole = (-ow / 2, ow / 2, sill, sill + oh)
        r = obj(name, lambda bm: wall_face(bm, hole, R - 0.01, mat=0), [M['wall']])
        def frame(bm):
            t = 0.06
            for lo, hi in (((-ow / 2, 0.1, sill), (-ow / 2 + t, 0.16, sill + oh)), ((ow / 2 - t, 0.1, sill), (ow / 2, 0.16, sill + oh)),
                           ((-ow / 2, 0.1, sill), (ow / 2, 0.16, sill + t)), ((-ow / 2, 0.1, sill + oh - t), (ow / 2, 0.16, sill + oh))):
                box(bm, lo, hi)
        obj(name + '_frame', frame, [M['grey']], parent=r)
        obj(name + '_glass', lambda bm: quad(bm, ((-ow / 2, 0.13, sill), (ow / 2, 0.13, sill), (ow / 2, 0.13, sill + oh), (-ow / 2, 0.13, sill + oh))), [M['glass']], parent=r)
        obj(name + '_sky', lambda bm: quad(bm, ((-ow / 2, R - 0.01, sill), (ow / 2, R - 0.01, sill), (ow / 2, R - 0.01, sill + oh), (-ow / 2, R - 0.01, sill + oh))), [M['sky']], parent=r)
        if name + '_curtain' in kids:
            cw = min(0.3, (2.25 - ow) / 2 - 0.05); z0, z1 = max(0.0, sill - 0.1), min(p['H'], sill + oh + 0.15)
            def cur(bm):
                for s in (-1, 1): box(bm, (min(s * ow / 2, s * (ow / 2 + cw)), -0.2, z0), (max(s * ow / 2, s * (ow / 2 + cw)), -0.05, z1))
            c = obj(name + '_curtain', cur, [M['grey']], parent=r)
            if (p.get('anim') == 'morph'):                   # (the sway shape keys the game blends)
                c.shape_key_add(name='Basis')
                for i, dx in enumerate((0.03, -0.03)):
                    sk = c.shape_key_add(name=f'sway{i}')
                    for v in sk.data:
                        if v.co.z < z1 - 0.3: v.co.y += dx * (1 - (v.co.z - z0) / (z1 - z0))
        return r
    if k == 'fireplace':
        fw, fh = 0.9, 0.8
        def b(bm):
            wall_face(bm, (-fw / 2, fw / 2, 0, fh), 0, mat=0)
            box(bm, (-0.75, -p['breast'], fh), (0.75, 0.0, p['H']), 0)
            for s in (-1, 1): box(bm, (min(s * fw / 2, s * 0.75), -p['breast'], 0), (max(s * fw / 2, s * 0.75), 0.0, fh), 0)
            box(bm, (-0.85, -D, p['mantel'] - 0.05), (0.85, -p['breast'], p['mantel']), 1)
            box(bm, (-0.8, -D, 0), (0.8, -p['breast'], 0.03), 1)
            box(bm, (-fw / 2, R - 0.02, 0), (fw / 2, R, fh), 1); box(bm, (-fw / 2, 0, fh - 0.02), (fw / 2, R, fh), 1)
            for s in (-1, 1): box(bm, (min(s * fw / 2, s * (fw / 2 - 0.02)), 0, 0), (max(s * fw / 2, s * (fw / 2 - 0.02)), R, fh), 1)
        r = obj(name, b, [M['wall'], M['grey']]); sockets(r, n); return r
    if k == 'wallhole':
        hw, hh = p['hole']; z0 = 1.0; hole = (-hw / 2, hw / 2, z0, z0 + hh)
        def b(bm):
            wall_face(bm, hole, R, True, mat=0); box(bm, (-0.4, -D, 0), (0.4, 0, 0.06), 1)
        return obj(name, b, [M['wall'], M['grey']])
    if k == 'niche':
        nw, nh, nd = p['niche']; z0 = 0.9; hole = (-nw / 2, nw / 2, z0, z0 + nh)
        def b(bm):
            wall_face(bm, hole, nd, True, mat=0); box(bm, (-nw / 2 - 0.04, -D, z0 - 0.06), (nw / 2 + 0.04, 0, z0), 1)
            box(bm, (-0.08, 0.12, z0), (0.08, 0.26, z0 + 0.35), 1)
        return obj(name, b, [M['wall'], M['grey']])
    raise ValueError(k)

def ceiling_piece(n, M):
    p = n['piece']; k = p['kind']; (x0, y0, z0), (x1, y1, z1) = n['box']
    if k in ('ceilhole', 'skylight'):
        hw = 0.6 if k == 'ceilhole' else 0.8
        def b(bm):
            for a, c in (((x0, y0), (-hw, y1)), ((hw, y0), (x1, y1)), ((-hw, y0), (hw, -hw)), ((-hw, hw), (hw, y1))):
                quad(bm, ((a[0], a[1], 0), (a[0], c[1], 0), (c[0], c[1], 0), (c[0], a[1], 0)), 0)
            box(bm, (-hw, -hw, 0), (hw, hw, z1), 0)
            if k == 'ceilhole': box(bm, (-0.3, -0.05, z0), (0.3, 0.05, 0), 0)
            else: quad(bm, ((-hw, -hw, z1 - 0.05), (-hw, hw, z1 - 0.05), (hw, hw, z1 - 0.05), (hw, -hw, z1 - 0.05)), 1)
        return obj(n['name'], b, [M['grey']] + ([M['glass']] if k == 'skylight' else []))
    return obj(n['name'], lambda bm: box(bm, *n['box']), [M['grey']])

def peel(n, M):
    (x0, y0, z0), (x1, y1, z1) = n['box']
    def b(bm):
        for sgn in (1, -1):                                   # (both sides: a sheet curling off the wall)
            top = [bm.verts.new((x, -0.002, z1)) for x in (x0, x1)]; bot = [bm.verts.new((x, y0, z0)) for x in (x0, x1)]
            f = (top[0], bot[0], bot[1], top[1]); bm.faces.new(f if sgn > 0 else f[::-1])
    return obj(n['name'], b, [M['grey']])

def wardrobe(n, M):
    if n['part'] == 'leaf':
        r = obj(n['name'], lambda bm: box(bm, *n['box']), [M['grey']]); r.location = n['hinge']; return r
    bw, bd, bh = n['piece']['body']; (x0, y0, z0), (x1, y1, z1) = n['box']; t = 0.02
    def b(bm):
        box(bm, (-bw / 2, bd / 2 - t, 0), (bw / 2, bd / 2, bh))                                  # back (+y: against the wall)
        for s in (-1, 1): box(bm, (min(s * bw / 2, s * (bw / 2 - t)), -bd / 2, 0), (max(s * bw / 2, s * (bw / 2 - t)), bd / 2, bh))
        box(bm, (-bw / 2, -bd / 2, 0), (bw / 2, bd / 2, t)); box(bm, (-bw / 2, -bd / 2, bh - t), (bw / 2, bd / 2, bh))
        box(bm, (x0, y0, bh), (x1, y1, z1))                                                       # crown
    return obj(n['name'], b, [M['grey']])

def build(style):
    kitlib.reset()
    M = {'grey': kitlib.grey(), 'wall': kitlib.reserved('WallSurface', (0.55, 0.5, 0.45)), 'glass': kitlib.glass(),
         'sky': kitlib.reserved('SkyPlane', (0.05, 0.07, 0.12)), 'emit': kitlib.reserved('Emit', (1.0, 0.75, 0.45), emit=True)}
    roots = []
    for n in defs.nodes(style):
        g = n['group']
        if g in ('solid', 'island', 'col', 'band'): r = furniture(n, M)
        elif g == 'fix': r = fixture(n, M)
        elif g == 'ward': r = wardrobe(n, M)
        else:
            k = n['kind']
            if k == 'door_frame': r = door_frame(n, M)
            elif k == 'door_leaf': r = obj(n['name'], lambda bm: box(bm, *n['box']), [M['grey']])
            elif k == 'peel': r = peel(n, M)
            elif n['mount'] == 'face': r = face_module(n, M)
            else: r = ceiling_piece(n, M)
        r['kit'] = n['group']; roots.append(r)
        if n.get('uv1'): kitlib.unwrap([r] + [c for c in r.children_recursive if c.type == 'MESH'], uv1=True, fast=True)
    kitlib.register('placeholder_' + style, roots)
    return roots

if __name__ == '__main__':
    import pack
    t0 = time.time(); styles = [s for s in defs.files() if OPTS.want(s)]
    for s in styles:
        blend = os.path.join(TMP, f'placeholder_{s}.blend')
        if kitlib.fresh([blend]): print('placeholder', s, 'up to date'); continue
        build(s); print('placeholder', s, f'{time.time() - t0:.1f}s')
    for s in styles:
        for t in kitlib.TIERS: pack.pack(s, t)
    print(f'placeholder kit done in {time.time() - t0:.1f}s')
