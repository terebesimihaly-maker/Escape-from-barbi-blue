# Escape from Barbi Blue: the house kit's definitions for the Blender scripts. js/kitdefs.js is the one source of truth;
# this reads the strict JSON between its /*KITDEFS*/ and /*END*/ markers and turns it into the list of nodes the kit must
# contain, each with the box its model has to fill (or stay inside), so placeholder.py, pack.py and check_kit.py agree.
# Boxes are in Blender metres (z up, the front faces -y), in the node's own frame:
#   floor, surface, practical, doorway: centred on the origin, from z0 (0) up    ceiling: centred, z0 is below the ceiling (< 0)
#   wall (and wall-slot solids): x centred, from y = -D (out in the room) to 0 (the wall plane)    face: y from -D to R (into the wall)
#   hinge: from the hinge axis along +x (wardrobe leafR along -x)    corner: x from 0 to D, y from -D to 0 (the two walls)
import json, os
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SRC = os.path.join(REPO, 'js', 'kitdefs.js')
RESERVED = ('WallSurface', 'Glass', 'SkyPlane', 'Emit')        # material names the game's loader swaps for its own

def load(path=SRC):
    text = open(path, encoding='utf-8').read()
    a = text.index('/*KITDEFS*/') + len('/*KITDEFS*/'); b = text.index('/*END*/', a)
    return json.loads(text[a:b])
KIT = load()
U = KIT['u']

def u(m): return int(round(m / U))     # (the game's footprint in units; Python's round agrees with Math.round for every KIT size)

def _box(mount, W, D, H, z0=0.0, R=0.0, side=1):
    if mount in ('wall',): return [[-W / 2, -D, z0], [W / 2, 0.0, z0 + H]]
    if mount == 'face': return [[-W / 2, -D, z0], [W / 2, R, z0 + H]]
    if mount == 'hinge': return [[0.0, -D / 2, z0], [W, D / 2, z0 + H]] if side > 0 else [[-W, -D / 2, z0], [0.0, D / 2, z0 + H]]
    if mount == 'corner': return [[0.0, -D, z0], [D, 0.0, z0 + H]]
    return [[-W / 2, -D / 2, z0], [W / 2, D / 2, z0 + H]]

def nodes(style=None):
    """every node the kit must contain: dicts with name, group (solid, island, col, band, fix, arch, ward), id, style (the file:
       a style or 'common'), mount, box, fit ('exact' within 0.02 m, or 'max' = an envelope), tris, trisLo, uv1, children (names),
       sockets (empties: anim pivots, fixture sockets), and for furniture slot, foot [w, d] (m) and footU (u); hinge for leaves"""
    out = []
    def add(**n):
        n.setdefault('fit', 'exact'); n.setdefault('uv1', False); n.setdefault('children', []); n.setdefault('sockets', [])
        n.setdefault('trisLo', n.get('tris'))
        if style is None or n['style'] == style: out.append(n)
    for k in KIT['solidIds']:
        it = KIT['items'][k]; slot = it['slot']
        names = it.get('nodes') or [it['node']]
        for i, name in enumerate(names):
            var = (it.get('var') or [{}] * len(names))[i] if 'hcm' not in it else {}
            h = var.get('h', it['h'])
            if 'hcm' in it: top = it['hcm'][i] / 100
            else: top = max(it.get('top', h), h)
            box = _box('wall' if slot == 'wall' else 'floor', it['w'], it['d'], top)
            socks = []
            if it.get('anim'): socks.append(name + KIT['anims'][it['anim']]['pivot'])
            if it.get('fix'): socks.append(name + '_fix')
            add(name=name, group='island' if slot == 'island' else ('col' if 'hcm' in it else 'solid'), id=k, style=it['style'],
                mount='wall' if slot == 'wall' else 'floor', slot=slot, box=box, h=h, top=top, tris=it['tris'], trisLo=it.get('trisLo', it['tris']),
                foot=[it['w'], it['d']], footU=[u(it['w']), u(it['d'])], anim=it.get('anim'), sockets=socks, occ=var.get('occ', it['occ']))
    for k, b in KIT['band'].items():
        for name in b.get('nodes') or [b['node']]:
            socks = ([name + KIT['anims'][b['anim']]['pivot']] if b.get('anim') else []) + ([name + '_fix'] if b.get('fix') else [])
            add(name=name, group='band', id=k, style=b['style'], mount=b['mount'], box=_box(b['mount'], b['W'], b['D'], b['H'], b.get('z0', 0.0)),
                fit=b.get('fit', 'exact'), tris=b['tris'], trisLo=b.get('trisLo', b['tris']), sockets=socks, anim=b.get('anim'))
    for k, f in KIT['fixtures'].items():
        add(name=f['node'], group='fix', id=k, style=f['style'], mount=f['mount'], box=_box(f['mount'], f['W'], f['D'], f['H'], f.get('z0', 0.0)),
            fit=f.get('fit', 'exact'), tris=f['tris'], children=[f['emit']], flicker=bool(f.get('flicker')))
    for name, p in KIT['arch']['pieces'].items():
        kids = list(p.get('children', []))
        socks = ([name + '_fix'] if p.get('fix') else []) + ([name + KIT['anims'][p['anim']]['pivot']] if p.get('anim') and 'pivot' in KIT['anims'][p['anim']] else [])
        add(name=name, group='arch', id=name, kind=p['kind'], style=p['style'], mount=p['mount'],
            box=_box(p['mount'], p['W'], p['D'], p['H'], p.get('z0', 0.0), p.get('R', 0.0)), fit=p.get('fit', 'exact'), tris=p['tris'],
            uv1=bool(p.get('uv1')), children=kids, sockets=socks, piece=p)
    for name, w in KIT['wardrobes'].items():
        if w['part'] == 'body':
            add(name=name, group='ward', id=name, part='body', style=w['style'], mount='floor', box=_box('floor', w['W'], w['D'], w['H']),
                fit=w.get('fit', 'exact'), tris=w['tris'], piece=w)
        else:
            hx, hy, hz = w['hinge']; side = 1 if hx < 0 else -1          # (leafL hinges on the left and reaches +x to the middle)
            add(name=name, group='ward', id=name, part='leaf', style=w['style'], mount='hinge', hinge=[hx, hy, hz],
                box=_box('hinge', w['W'], w['D'], w['H'], 0.0, 0.0, side), fit=w.get('fit', 'exact'), tris=w['tris'], piece=w)
    return out

def files():
    """the GLB files the kit is packed into: one per style, plus common"""
    return list(KIT['styles']) + ['common']

def by_name():
    return {n['name']: n for n in nodes()}

if __name__ == '__main__':
    ns = nodes(); print('KIT version', KIT['version'], len(ns), 'nodes')
    for f in files(): print(' ', f, sum(1 for n in ns if n['style'] == f))
