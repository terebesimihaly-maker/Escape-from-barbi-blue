# Escape from Barbi Blue: checks the packed house kit (models/kit/<tier>/<file>.glb and manifest.json) against js/kitdefs.js
# and fails the build (exit 1) if:
#   a KIT node is missing, or its box is more than 0.02 m off (or, for an envelope, sticks out of it by more than 0.02 m);
#   wall decor reaches more than 0.44 m out from its face, or a wall item crosses u outside [0.05, 0.95] (|x| > 1.0125 m);
#   a node is over its triangle budget (hi and md: tris; lo: trisLo); a GLB has a light or a material extension that would
#   make three.js build a MeshPhysicalMaterial (transmission, clearcoat, sheen, ior, specular, volume, ...);
#   a module (uv1) lacks TEXCOORD_1; a wardrobe hinge is more than 0.005 m off; a declared child, pivot or socket is missing;
#   node names repeat or contain dots, a mesh has more than 2 materials, a reserved material's name is mangled ('Glass.001');
#   a solid or island covers less than 85% of its box's width or depth above 0.4 m, or swings (rock, mobile) out of its box
#   grown by 0.05 m, below the floor (5 mm) or to a top more than 0.05 m off its h at any moment of the swing (F3.8, every tier);
#   a piece whose box starts at the floor reaches more than 5 mm below it; a wardrobe body is off-centre (5 mm) or reaches behind
#   its back (into the wall); a KIT node isn't at the origin (only wardrobe leaves sit on their hinges); the manifest disagrees.
#   /tmp/claude-0/bpyenv/bin/python tools/blender/kit/check_kit.py [--tier hi] [--file wood] [--only <node or id>] [--dir models/kit] [--quiet]
import sys, os, json, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np
import defs, glbinfo
KITDIR = os.path.join(defs.REPO, 'models', 'kit'); TOL = 0.02; HINGE = 0.005; BAND = 0.44; UMAX = 1.0125; FLOOR = 0.005
PHYSICAL = ('KHR_lights_punctual', 'KHR_materials_transmission', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_ior',
            'KHR_materials_specular', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion')
DECOR = ('band', 'fix')                                      # (non-solid: the 0.44 m band rule)
# The rocking chair is WP2.0's hero smoke asset, built to the hero solid budget (B12: 12k) while js/kitdefs.js still gives it a
# medium solid's 5000; its lo tier keeps to 5000. Drop this once kitdefs.js says 12000.
HERO = {'Solid_rocking_chair': 12000}

def arg(k, d=None):
    a = sys.argv[1:]
    return a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else d

def rot(axis, a):
    c, s = math.cos(a), math.sin(a)
    return {'x': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), 'y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            'z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]

def check_file(path, f, tier, only, fails, notes):
    g = glbinfo.Glb(path); js = g.js; err = lambda node, msg: fails.append(f'{tier}/{f} {node}: {msg}')
    for e in sorted(g.ext & set(PHYSICAL)): err('-', f'uses {e}')
    if any('KHR_lights_punctual' in n.get('extensions', {}) for n in g.nodes): err('-', 'contains a light')
    names = [n.get('name', '') for n in g.nodes]
    for nm in set(x for x in names if names.count(x) > 1): err(nm, 'node name used twice')
    for nm in names:
        if '.' in nm or not nm: err(nm or '?', 'node name empty or has a dot')
    for m in js.get('meshes', []):
        mats = {p.get('material') for p in m['primitives']}
        if len(mats) > 2: err(m.get('name', '?'), f'{len(mats)} materials in one mesh (at most 2)')
    for m in js.get('materials', []):
        base = m.get('name', '').rpartition('.')[0]
        if base in defs.RESERVED: err(m['name'], 'reserved material name mangled')
    roots = set(js['scenes'][js.get('scene', 0)]['nodes'])
    for n in defs.nodes(f):
        if only and not (n['name'] in only or n['id'] in only): continue
        i = g.find(n['name'])
        if i is None: err(n['name'], 'missing'); continue
        lo, hi = np.array(n['box'][0]), np.array(n['box'][1])
        # where it sits: at the origin (a wardrobe leaf on its hinge), a top-level node
        W = g.world[i]; t = np.array([W[0, 3], -W[2, 3], W[1, 3]])
        want = np.array(n['hinge']) if n.get('hinge') else np.zeros(3)
        if np.abs(t - want).max() > (HINGE if n.get('hinge') else 1e-4): err(n['name'], f'origin at {np.round(t, 4).tolist()}, should be {want.tolist()}' + (' (hinge)' if n.get('hinge') else ''))
        if np.abs(W[:3, :3] - np.eye(3)).max() > 1e-4: err(n['name'], 'rotated or scaled (the kit node must be axis-aligned at scale 1)')
        if i not in roots: notes.append(f'{tier}/{f} {n["name"]}: not a top-level node')
        # the box (vertices when they can be decoded, else the accessor bounds)
        try: P, T = g.vertices(i); b = [P.min(0), P.max(0)] if len(P) else None
        except Exception as ex: P = T = None; b = g.box(i); notes.append(f'{tier}/{f}: vertices not decoded ({ex}); boxes from accessor bounds')
        if b is None: err(n['name'], 'no geometry'); continue
        b = [np.array(b[0]), np.array(b[1])]
        # standing on the floor: nothing of a piece whose box starts at the floor is below it (the game allows 5 mm, F3.8)
        if n['group'] != 'arch' and lo[2] == 0 and b[0][2] < -FLOOR: err(n['name'], f'sits {-b[0][2]:.4f} m below the floor (at most {FLOOR})')
        # a wardrobe body: centred on its hinges (x), and nothing behind its back, which stands 1 cm off the wall (kit.js wardrobe)
        if n['group'] == 'ward' and n.get('part') == 'body':
            back = n['piece']['body'][1] / 2; cx = (b[0][0] + b[1][0]) / 2
            if b[1][1] > back + 2e-3: err(n['name'], f'reaches {b[1][1] - back:.3f} m behind its back (y {b[1][1]:.3f} > {back}): into the wall')
            if abs(cx) > HINGE: err(n['name'], f'off-centre: x {b[0][0]:.3f}..{b[1][0]:.3f} (centre {cx:+.4f}, at most {HINGE} off)')
        if n['fit'] == 'max':
            out = np.maximum(lo - b[0], b[1] - hi).max()
            if out > TOL: err(n['name'], f'sticks out of its envelope by {out:.3f} m (box {np.round(b[0], 3).tolist()}..{np.round(b[1], 3).tolist()}, envelope {lo.tolist()}..{hi.tolist()})')
        else:
            off = np.maximum(np.abs(b[0] - lo), np.abs(b[1] - hi)).max()
            if off > TOL: err(n['name'], f'box off by {off:.3f} m (box {np.round(b[0], 3).tolist()}..{np.round(b[1], 3).tolist()}, KIT {lo.tolist()}..{hi.tolist()})')
        # wall decor: the 0.44 m band, u within [0.05, 0.95]
        decor = n['group'] in DECOR or (n['group'] == 'arch' and n['mount'] in ('wall', 'face'))
        if decor and n['mount'] in ('wall', 'face') and -b[0][1] > BAND + 1e-3: err(n['name'], f'reaches {-b[0][1]:.3f} m from the wall (at most {BAND})')
        if decor and n['mount'] == 'corner' and (b[1][0] > BAND + 1e-3 or -b[0][1] > BAND + 1e-3): err(n['name'], 'reaches more than 0.44 m from a wall')
        if decor and n['mount'] == 'wall' and max(-b[0][0], b[1][0]) > UMAX + 2e-3: err(n['name'], f'crosses u outside [0.05, 0.95] (|x| up to {max(-b[0][0], b[1][0]):.3f} m)')
        # triangles, uv1, children and sockets
        budget = n['trisLo'] if tier == 'lo' else max(n['tris'], HERO.get(n['name'], 0)); tc = g.tris(i)
        if tier != 'lo' and n['name'] in HERO and tc > n['tris']: notes.append(f'{tier}/{f} {n["name"]}: {tc} triangles on the hero budget {HERO[n["name"]]} (KIT says {n["tris"]})')
        if tc > budget: err(n['name'], f'{tc} triangles, budget {budget}')
        if n['uv1'] and not g.uv1(i, defs.RESERVED[1:]): err(n['name'], 'module without TEXCOORD_1 (uv1)')
        sub = {g.nodes[j].get('name') for j in g.subtree(i)}
        for c in n['children'] + n['sockets']:
            if c not in sub: err(n['name'], f'child {c} missing')
        # solids and islands: cover the box above knee height (hi); swing inside it (every tier: lo is cut down, the game tests lo and md)
        if n['group'] in ('solid', 'island') and P is not None and len(P):
            z0 = min(0.4, 0.5 * hi[2]); cb = glbinfo.clip_box(P, T, z0)
            for k, ax in ((0, 'width'), (1, 'depth')):
                share = 0 if cb is None else (cb[1][k] - cb[0][k]) / (hi[k] - lo[k])
                if share < 0.85 and tier == 'hi': err(n['name'], f'covers {share:.0%} of its {ax} above {z0:.2f} m (at least 85%)')
            an = defs.KIT['anims'].get(n.get('anim') or '', {})
            piv = g.find(n['name'] + an['pivot']) if an.get('pivot') else None
            if piv is not None and an.get('axis'):
                Q, _ = g.vertices(piv, piv)
                if len(Q):
                    M = g.rel(piv, i); c = np.array([M[0, 3], -M[2, 3], M[1, 3]])
                    angs = np.linspace(-an['amp'], an['amp'], 9) if 'amp' in an else np.linspace(0, 2 * math.pi, 16, endpoint=False)
                    poses = [Q @ rot(an['axis'], a).T + c for a in angs]
                    sw = np.concatenate(poses); s0, s1 = sw.min(0), sw.max(0)
                    out = max((lo[:2] - s0[:2]).max(), (s1[:2] - hi[:2]).max())
                    if out > 0.05: err(n['name'], f'swings {out:.3f} m out of its box (at most 0.05): {np.round(s0, 3).tolist()}..{np.round(s1, 3).tolist()}')
                    # up and down: at every moment of the swing the piece stands on the floor and is as tall as KIT says (F3.8:
                    # its bottom >= -5 mm, its top within 0.05 m of h), the static part and the swinging one together
                    S, _ = g.vertices(i, skip=piv); zs0 = S[:, 2].min() if len(S) else np.inf; zs1 = S[:, 2].max() if len(S) else -np.inf
                    bot = min(min(zs0, q[:, 2].min()) for q in poses); tops = [max(zs1, q[:, 2].max()) for q in poses]
                    if bot < -FLOOR: err(n['name'], f'dips {-bot:.4f} m below the floor as it swings (at most {FLOOR})')
                    if min(tops) < hi[2] - 0.05 or max(tops) > hi[2] + 0.05: err(n['name'], f'its top goes {min(tops):.3f}..{max(tops):.3f} m as it swings (KIT h {hi[2]}, within 0.05)')
                    notes.append(f'{tier}/{f} {n["name"]}: swing box {np.round(s0, 3).tolist()}..{np.round(s1, 3).tolist()}, bottom {bot:+.4f}, top {min(tops):.3f}..{max(tops):.3f}')
    return g

def main():
    global KITDIR
    KITDIR = arg('--dir', KITDIR)
    tiers = [arg('--tier')] if arg('--tier') else ['hi', 'md', 'lo']; files = [arg('--file')] if arg('--file') else defs.files()
    only = set(arg('--only').split(',')) if arg('--only') else None
    fails, notes, sizes = [], [], {}
    try: man = json.load(open(os.path.join(KITDIR, 'manifest.json')))
    except (OSError, ValueError): man = None; fails.append('manifest.json missing or unreadable')
    for t in tiers:
        for f in files:
            p = os.path.join(KITDIR, t, f + '.glb')
            if not os.path.exists(p): fails.append(f'{t}/{f}.glb missing'); continue
            check_file(p, f, t, only, fails, notes); sizes[f'{t}/{f}'] = os.path.getsize(p)
            if man and man.get('tiers', {}).get(t, {}).get(f) != os.path.getsize(p): fails.append(f'manifest: {t}/{f} size {man.get("tiers", {}).get(t, {}).get(f)} != {os.path.getsize(p)}')
    if man:
        for n in defs.nodes():
            if n['style'] in files and n['name'] not in man.get('nodes', {}): fails.append(f'manifest: {n["name"]} missing')
        if man.get('kit') != defs.KIT['version']: fails.append(f'manifest: kit version {man.get("kit")} != KIT {defs.KIT["version"]}')
    if '--quiet' not in sys.argv:
        for x in notes: print('  note', x)
    print(f'check_kit: {len(defs.nodes())} KIT nodes, {len(sizes)} files ({sum(sizes.values()) / 1e6:.2f} MB)')
    for x in fails: print('  FAIL', x)
    print('check_kit:', 'FAILED (%d)' % len(fails) if fails else 'all checks passed')
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main())
