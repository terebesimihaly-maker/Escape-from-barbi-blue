# Escape from Barbi Blue: the architecture modules (WP2.2; build spec B5, B7) other than doors and windows.
#   Exit_<style>               the way out: the wall face round a doorway, its casing, the frame, a porch 1 m deep behind it open to the
#                              sky (SkyPlane), and the children Exit_leaf_<style> (hinged at x = -0.575 on the wall plane, swinging out
#                              into the porch), Exit_boards_<style> (planks nailed across, a chain and padlock: they drop when the power
#                              comes on) and Exit_lamp_<style> (the lamp's lens: the game colours it red, then green)
#   Mod_fireplace_<style>      chimney breast 0.40 proud (WallSurface), the surround and mantel at 1.25 m, the firebox 0.45 deep, the
#                              hearth; the embers are the game's fixture at Mod_fireplace_<style>_fix (wood: painted pine and tiled
#                              cheeks; tile: marble; workshop: a brick forge with a steel hood)
#   Mod_wallhole_lath_<ABC>_<style>, Mod_breach_brick_<ABC>_concrete, Mod_hole_boards_<ABC>_attic
#                              holes in the wall: broken plaster in its coats, the laths behind it (broken, hanging), the studs and
#                              the dark between; broken bricks; split boards; and what fell out of them on the floor (<= 0.35 m out)
#   Band_peel_<ABCD>_<style>   wallpaper peeling off the wall in a curl (the style's own paper on the front, its pasted back behind),
#                              flaking paint, split boards
#   Mod_niche_tile             an arched niche with a shell hood, a marble shelf and a porcelain figure
#   Band_ceilingrose, Band_coffer_rose, Mod_ceilhole_<style>, Mod_skylight_<style>, Band_attic_ladder: the ceiling pieces
#   py -3.11 tools/blender/kit/modules.py [--preview] [--force] [--only exit,fireplace,wallhole,peel,niche,ceiling] [--sheets]
import sys, os, math, random, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector, noise as mnoise
import kitlib, defs
import surfaces2 as S
import doors as Dr
import windows as Wn
from surfaces2 import sep, comb, finish, noise3
from doors import (strip, quad_bm, clean, seg_hint, ovolo, Face, panelled, ring, lathe_bm, tube, block, plate, rounded, member, attrs_of,
                   metal_attrs, wood_attrs, wall_face, architrave, ARCH, MARGIN, AW, ATTRS, panel_leaf, boards_leaf, nails, knob_set, BEAD,
                   strap_outline, knuckles, wired_glass)
from kitlib import OPTS, TMP, lin

FW, FH = 2.25, 3.0
PIECES = defs.KIT['arch']['pieces']
SURF = os.path.join(defs.REPO, 'textures', 'surf')
PX = 2048
PLANAR = {'Band_ceilingrose'}                                 # (unwrapped straight from below: see bake_parts)
random.seed(41)

def plain(c): return attrs_of(lambda c_: tuple(c_), 0.5)

# ================================================================ shared geometry
def rock(center, size, seed, sub=1, flat=0.55):
    """a lump of rubble (plaster, brick, mortar): a battered icosphere, flattened, its faces broken"""
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    s = Vector((seed * 1.7, seed * 2.3, seed * 0.9))
    for v in bm.verts:
        d = 1.0 + 0.35 * mnoise.noise(v.co * 1.3 + s) + 0.15 * mnoise.noise(v.co * 3.1 + s)
        v.co = Vector((v.co.x * size[0] * d, v.co.y * size[1] * d, v.co.z * size[2] * d * flat))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center)); return bm

def jag_poly(cx, cz, w, h, seed, n=40, rough=0.22, power=2.6):
    """an irregular hole's outline: a superellipse w x h, its edge torn by noise at two scales"""
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n; c, s_ = math.cos(a), math.sin(a)
        sx = math.copysign(abs(c) ** (2 / power), c); sz = math.copysign(abs(s_) ** (2 / power), s_)
        r = 1.0 + rough * mnoise.noise(Vector((c * 1.5 + seed, s_ * 1.5, seed))) + rough * 0.5 * mnoise.noise(Vector((c * 5 + seed, s_ * 5, 2 * seed)))
        pts.append((cx + sx * w / 2 * r, cz + sz * h / 2 * r))
    return pts

def fill_to_rect(G, mat, poly, rect, P, normal, attrs=None):
    """faces between a closed outline poly [(a, b)] and the rectangle rect (a0, a1, b0, b1) round it, along rays from the outline's
       middle, the rectangle's corners put in where a ray pair spans one; P(a, b) -> 3D point"""
    n = len(poly); a0, a1, b0, b1 = rect
    if sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n)) < 0: poly = poly[::-1]   # (anticlockwise)
    ca, cb = sum(q[0] for q in poly) / n, sum(q[1] for q in poly) / n
    def out(q):
        da, db = q[0] - ca, q[1] - cb
        t = min((a1 - ca) / da if da > 1e-9 else (a0 - ca) / da if da < -1e-9 else 1e9, (b1 - cb) / db if db > 1e-9 else (b0 - cb) / db if db < -1e-9 else 1e9)
        return (ca + da * t, cb + db * t)
    ang = lambda q: math.atan2(q[1] - cb, q[0] - ca)
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]; A, B = out(a), out(b)
        span = (ang(B) - ang(A)) % (2 * math.pi)
        corners = sorted([c for c in ((a0, b0), (a1, b0), (a1, b1), (a0, b1)) if 0 < (ang(c) - ang(A)) % (2 * math.pi) < span], key=lambda c: (ang(c) - ang(A)) % (2 * math.pi))
        pts = [a, A] + corners + [B, b]; cl = []
        for q in pts:
            if not cl or math.hypot(q[0] - cl[-1][0], q[1] - cl[-1][1]) > 1e-6: cl.append(q)
        if len(cl) > 2 and math.hypot(cl[0][0] - cl[-1][0], cl[0][1] - cl[-1][1]) < 1e-6: cl.pop()
        if len(cl) < 3: continue
        bm = bmesh.new(); f = bm.faces.new([bm.verts.new(P(q[0], q[1])) for q in cl]); f.normal_update()
        if f.normal.dot(Vector(normal)) < 0: f.normal_flip()
        if len(cl) > 3: bmesh.ops.triangulate(bm, faces=[f])
        G.add(bm, mat, attrs or plain(None), wrap=False)

def wall_round_hole(G, mat, poly, margin=0.12):
    """the 2.25 x 3 m wall face (WallSurface) round an irregular hole: quads from the hole's edge out to a rectangle round it (along
       rays from its middle), the rest of the face as rectangles"""
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    x0, x1, z0, z1 = min(xs) - margin, max(xs) + margin, max(0.0, min(zs) - margin), max(zs) + margin
    fill_to_rect(G, mat, poly, (x0, x1, z0, z1), lambda a, b: (a, 0.0, b), (0, -1, 0))
    wall_face(G, mat, (x0, x1, z0, z1))
    return (x0, x1, z0, z1)

def poly_edge(G, mat, poly, y0, y1, attrs, inward=True, smooth=False):
    """the edge of a hole through a slab from y0 to y1, facing into the hole"""
    n = len(poly); cx = sum(p[0] for p in poly) / n; cz = sum(p[1] for p in poly) / n
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]
        mid = Vector(((a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz))
        G.add(quad_bm([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], -mid if inward else mid), mat, attrs, smooth=smooth, wrap=False)

def inset_poly(poly, d, seed=0.0, jitter=0.0):
    n = len(poly); cx = sum(p[0] for p in poly) / n; cz = sum(p[1] for p in poly) / n; out = []
    for k, p in enumerate(poly):
        dx, dz = p[0] - cx, p[1] - cz; L = math.hypot(dx, dz) or 1.0
        j = d + jitter * mnoise.noise(Vector((k * 0.37, seed, 1.0)))
        out.append((p[0] - dx / L * j, p[1] - dz / L * j))
    return out

def inside(poly, x, z):
    c = False; n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]; x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1): c = not c
    return c

# ================================================================ materials
def surf_tex(m, files, u, v, key='color'):
    """a shipped surface texture sampled at (u, v): its colour, roughness (orh G) and the normal map's vector"""
    def tex(k, srgb):
        t = m.n('ShaderNodeTexImage', interpolation='Linear', extension='REPEAT'); t.image = bpy.data.images.load(os.path.join(SURF, files[k] + '.hi.webp'), check_existing=True)
        t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'; m.l(comb(m, u, v, 0.0), t.inputs['Vector']); return t
    c = tex(key, True); o = tex('orh', False); n = tex('normal', False)
    nm = m.n('ShaderNodeNormalMap'); m.l(n.outputs['Color'], nm.inputs['Color'])
    return c.outputs['Color'], sep(m, o.outputs['Color'])[1], nm.outputs['Normal']

def ceiling_mat(name, style, hole=None, soot=None):
    """the style's own ceiling (its shipped texture over the tile, uv = xy / 2.25), with damage round a hole: cracks running out
       from it, a water stain, the plaster's edge darkened"""
    files = S.manifest_load()['styles'][style]['ceil']['files']
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    u = m.math('DIVIDE', m.math('ADD', x, FW / 2), FW); v = m.math('DIVIDE', m.math('SUBTRACT', FW / 2, y), FW)
    col, rough, nrm = surf_tex(m, files, u, v)
    if hole:
        cx, cy, r = hole; d = m.math('SQRT', m.math('ADD', m.math('POWER', m.math('SUBTRACT', x, cx), 2.0), m.math('POWER', m.math('SUBTRACT', y, cy), 2.0)))
        st = m.math('ADD', d, m.math('MULTIPLY', m.math('SUBTRACT', m.noise(op, 3, 4), 0.5), 0.35))
        stain = m.remap(st, r + 0.45, r + 0.05, smooth=True); tide = m.math('MULTIPLY', m.remap(st, r + 0.36, r + 0.42), m.remap(st, r + 0.48, r + 0.42))
        col = m.mix(m.math('ADD', m.math('MULTIPLY', stain, 0.4), m.math('MULTIPLY', tide, 0.5)), col, m.mix(1.0, col, (0.68, 0.58, 0.42), 'MULTIPLY'))
        cr = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.noise(m.map(op, (6, 6, 6)), 1.0, 3, 0.5, 0.6), 0.5)), 0.012, 0.0), m.remap(d, r + 0.6, r, smooth=True))
        col = m.mix(m.math('MULTIPLY', cr, 0.85), col, (0.1, 0.09, 0.08))
    if soot:
        cx, cy, r = soot; d = m.math('SQRT', m.math('ADD', m.math('POWER', m.math('SUBTRACT', x, cx), 2.0), m.math('POWER', m.math('SUBTRACT', y, cy), 2.0)))
        col = m.mix(m.math('MULTIPLY', m.remap(d, r, 0.0, smooth=True), m.remap(m.noise(op, 6, 3), 0.3, 0.7, 0.4, 0.8)), col, m.mix(1.0, col, (0.45, 0.42, 0.38), 'MULTIPLY'))
    return m.out(col, rough, nrm)

def wall_tex_mat(name, style, lp_attr=True, back=None):
    """the style's own wall (its shipped texture, colour A) at the place the piece came from: the attribute 'lp' holds that flat
       position (x across the face, z up) so a curl of paper keeps its pattern; back: the paper's back where the normal faces the wall"""
    files = S.manifest_load()['styles'][style]['wall']['files']
    m = kitlib.Mat(name); lp = m.attr('lp', True); op = m.attr('opos', True); x, yy, z = sep(m, lp)
    x = m.math('ADD', m.math('MULTIPLY', x, 0.985), 0.012); z = m.math('ADD', m.math('MULTIPLY', z, 0.99), 0.009)   # (the paper shrank as it dried: the print no longer lines up)
    u = m.math('MULTIPLY', m.math('ADD', 0.5, m.math('DIVIDE', x, FW)), 0.5); v = m.math('DIVIDE', z, FH)
    col, rough, nrm = surf_tex(m, files, u, v)
    col = m.mix(0.35, col, m.hsv(col, 0.5, 0.75, 1.12))                     # (faded off the wall)
    edge = m.attr('ja')                                        # (how far from the torn edge)
    col = m.mix(m.math('MULTIPLY', m.remap(edge, 0.05, 0.0, smooth=True), 0.6), col, m.mix(1.0, col, (0.62, 0.5, 0.36), 'MULTIPLY'))
    st = m.noise(op, 3.5, 4, 0.6); tide = m.math('MULTIPLY', m.remap(st, 0.52, 0.56), m.remap(st, 0.6, 0.56))
    col = m.mix(m.math('ADD', m.math('MULTIPLY', m.remap(st, 0.56, 0.7), 0.45), m.math('MULTIPLY', tide, 0.7)), col, m.mix(1.0, col, (0.72, 0.58, 0.4), 'MULTIPLY'))
    mo = m.math('MULTIPLY', m.remap(m.noise(op, 40, 3), 0.64, 0.7), m.remap(st, 0.5, 0.65)); col = m.mix(mo, col, (0.1, 0.1, 0.07))
    return m.out(col, m.mixf(0.5, rough, 0.9), nrm)

def paper_back(name, base='#cfc2a4'):
    """the back of old wallpaper: pulp paper browned with age, smears of dried paste, flecks of plaster and lime stuck to it, mould"""
    m = kitlib.Mat(name); op = m.attr('opos', True); c = lin(base)
    col = m.mix(m.remap(m.noise(op, 6, 4), 0.3, 0.7, 0.0, 0.5), c, m.mix(1.0, m.mix(0.0, c, c), (0.8, 0.7, 0.52), 'MULTIPLY'))
    paste = m.remap(m.noise(m.map(op, (1, 1, 1)), 14, 4, 0.6), 0.5, 0.62)
    col = m.mix(m.math('MULTIPLY', paste, 0.5), col, m.mix(1.0, col, (0.85, 0.78, 0.6), 'MULTIPLY'))
    fl = m.remap(m.noise(op, 160, 2), 0.66, 0.74); col = m.mix(m.math('MULTIPLY', fl, 0.7), col, lin('#e8e2d4'))
    mo = m.math('MULTIPLY', m.remap(m.noise(op, 22, 4), 0.62, 0.7), m.remap(m.noise(op, 2, 2), 0.45, 0.6)); col = m.mix(mo, col, (0.12, 0.13, 0.08))
    return finish(m, col, 0.9, m.math('ADD', m.math('MULTIPLY', paste, 0.0002), m.math('MULTIPLY', fl, 0.00015)))

def plaster_coats(name, finish_col='#e2dccd', brown='#9b8a72'):
    """broken lime plaster seen edge-on and in lumps: a thin hard finish coat over the browning coat, coarse sand and horsehair in it,
       crumbled, dusty; 'opos' y is the depth into the wall"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    sand = m.noise(op, 400, 3, 0.6); lump = m.noise(op, 60, 4, 0.6)
    bc = m.mix(m.remap(lump, 0.3, 0.7), lin(brown), m.hsv(m.mix(0.0, lin(brown), lin(brown)), 0.5, 0.9, 0.8))
    bc = m.mix(m.remap(sand, 0.4, 0.75, 0.0, 0.45), bc, m.hsv(bc, 0.5, 0.6, 1.35))
    hair = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.noise(m.map(op, (1, 1, 1)), 90, 2, 0.5, 2.0), 0.5)), 0.012, 0.0), 0.8)
    bc = m.mix(hair, bc, (0.12, 0.09, 0.06))
    fin = m.remap(y, 0.0045, 0.0035)                          # (the finish coat: the first 4 mm)
    col = m.mix(fin, bc, lin(finish_col))
    col = m.mix(m.remap(m.noise(op, 8, 3), 0.4, 0.75, 0.0, 0.4), col, m.hsv(col, 0.5, 0.8, 0.82))
    return finish(m, col, 0.93, m.math('ADD', m.math('MULTIPLY', sand, 0.0004), m.math('MULTIPLY', lump, 0.0012)))

def brick_body(name, reds=('#7a3e2c', '#6a3527', '#8b4a30', '#4f2e25')):
    """brick broken and whole: fired clay of its own colour per piece, sandy, pale grit, broken faces paler and rougher, mortar crumbs"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); pr = m.attr('prand'); op = m.attr('opos', True)
    col = m.mix(m.remap(pr, 0.0, 0.5), lin(reds[0]), lin(reds[1])); col = m.mix(m.remap(pr, 0.5, 1.0), col, lin(reds[2]))
    col = m.mix(m.remap(m.math('FRACT', m.math('MULTIPLY', pr, 7.3)), 0.85, 0.9), col, lin(reds[3]))
    sand = m.noise(g, 500, 2); grit = m.remap(m.voronoi(m.map(g, (260, 260, 260)), 1.0, 'Distance'), 0.25, 0.08)
    col = m.mix(m.remap(sand, 0.25, 0.75), m.hsv(col, 0.5, 1.0, 0.85), m.hsv(col, 0.5, 0.9, 1.15)); col = m.mix(m.math('MULTIPLY', grit, 0.5), col, m.hsv(col, 0.5, 0.5, 1.6))
    cav = m.math('ADD', m.cavity(), 0.0); col = m.mix(m.math('MULTIPLY', m.remap(cav, 0.95, 0.5), 0.7), col, (0.05, 0.04, 0.035))
    dust = m.math('MULTIPLY', m.remap(sep(m, m.geo('Normal'))[2], 0.4, 0.95, smooth=True), m.remap(m.noise(op, 30, 4), 0.3, 0.7, 0.3, 0.8)); col = m.mix(dust, col, lin('#a39c90'))
    return finish(m, col, m.mixf(dust, 0.88, 0.95), m.math('ADD', m.math('MULTIPLY', sand, 0.0003), m.math('MULTIPLY', grit, 0.0003)))

def brick_coursed(name, ends=False):
    """brickwork in running bond from the shader alone (opos x, z): stretchers 225 x 75 mm, or the broken ends seen in a hole's side
       (ends: shorter, rougher, paler at the fresh breaks), crumbly lime mortar, soot and damp"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    row = m.math('FLOOR', m.math('DIVIDE', z, 0.075)); bx = m.math('ADD', x, m.math('MULTIPLY', m.math('MODULO', row, 2.0), 0.1125))
    if ends: bx = m.math('ADD', m.math('MULTIPLY', y, 1.0), m.math('MULTIPLY', m.math('MODULO', row, 2.0), 0.05))
    L = 0.1125 if ends else 0.225
    cell = m.math('FLOOR', m.math('DIVIDE', bx, L)); fx = m.math('FRACT', m.math('DIVIDE', bx, L)); fz = m.math('FRACT', m.math('DIVIDE', z, 0.075))
    rnd_ = m.math('FRACT', m.math('MULTIPLY', m.math('SINE', m.math('ADD', m.math('MULTIPLY', cell, 12.9898), m.math('MULTIPLY', row, 78.233))), 43758.5453))
    col = m.mix(m.remap(rnd_, 0.0, 0.5), lin('#7a3e2c'), lin('#6a3527')); col = m.mix(m.remap(rnd_, 0.5, 1.0), col, lin('#8b4a30'))
    col = m.mix(m.remap(m.noise(op, 300, 3), 0.3, 0.7, 0.0, 0.4), col, m.hsv(col, 0.5, 0.8, 1.25))
    if ends: col = m.mix(m.remap(m.noise(op, 40, 4), 0.4, 0.7, 0.0, 0.6), col, m.hsv(col, 0.5, 0.75, 1.35))
    jt = m.math('MAXIMUM', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fz, 0.5)), 0.43, 0.47), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fx, 0.5)), 0.47 if not ends else 0.45, 0.49))
    col = m.mix(jt, col, m.mix(m.remap(m.noise(op, 60, 3), 0.3, 0.7), lin('#7f776a'), lin('#5d574e')))
    col = m.mix(m.remap(m.noise(op, 2.5, 3), 0.4, 0.75, 0.0, 0.5), col, m.hsv(col, 0.5, 0.7, 0.55))
    return finish(m, col, 0.9, m.math('ADD', m.math('MULTIPLY', jt, -0.006), m.math('MULTIPLY', m.noise(op, 200, 3), 0.0008)))

def soot_brick(name):
    """the firebox: firebrick and iron blackened by a century of coal smoke, glossy tar in streaks, ash grey where it's hot"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    base = m.mix(m.remap(m.noise(op, 30, 4), 0.3, 0.7), lin('#2a2420'), lin('#141210'))
    tar = m.math('MULTIPLY', m.remap(m.noise(m.map(op, (30, 30, 3)), 1.0, 3), 0.55, 0.7), m.remap(z, 0.2, 0.7))
    ash = m.math('MULTIPLY', m.remap(z, 0.35, 0.05), m.remap(m.noise(op, 12, 4), 0.4, 0.7))
    col = m.mix(ash, base, lin('#6a645e'))
    return finish(m, col, m.mixf(tar, 0.92, 0.35), m.math('MULTIPLY', m.noise(op, 200, 3), 0.0006))

def cast_iron(name, rust=0.5, polish=0.3):
    """cast iron, black-leaded once (a graphite sheen on the high parts), rusting in the hollows and where the damp got it"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True)
    cav = m.math('ADD', m.cavity(), 0.0); edge = m.math('ADD', m.edge(), 0.0)
    col = m.mix(m.remap(m.noise(g, 25, 4), 0.3, 0.7), lin('#1c1b1a'), lin('#2b2a28'))
    rr = m.math('MULTIPLY', m.math('ADD', m.remap(cav, 0.95, 0.6), m.remap(m.noise(g, 8, 5, 0.6), 0.6, 0.75)), rust)
    col = m.mix(m.math('MULTIPLY', rr, 0.8), col, m.mix(m.noise(g, 60, 5), lin('#4a2412'), lin('#7a3c1a')))
    met = m.mixf(m.math('MULTIPLY', edge, polish * 2), 0.25, 0.85)
    rough = m.mixf(m.math('MULTIPLY', edge, polish), 0.6, 0.32); rough = m.mixf(rr, rough, 0.9); met = m.mixf(rr, met, 0.0)
    return finish(m, col, rough, m.math('MULTIPLY', m.noise(g, 300, 4), 0.0003), met)

def marble(name, base='#e3ddd2', vein='#8a8780', dark=False, age=1.2):
    """polished marble (white statuary, or black Belgian with white veins): veins along a warped noise's contours, clouds, the polish
       dulled and stained, dirt in the carving"""
    m = kitlib.Mat(name); g = m.attr('gpos', True); op = m.attr('opos', True)
    w = m.noise(m.map(g, (1, 1, 1)), 2.0, 5, 0.6, color=True)
    wv = m.n('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); m.l(w, wv.inputs[0]); wv.inputs[1].default_value = (0.25, 0.25, 0.25); m.l(g, wv.inputs[2])
    v1 = S.ridge(m, m.map(wv.outputs[0], (1.0, 2.2, 1.0)), 2.5, 5, 0.6, 9.0); v2 = S.ridge(m, wv.outputs[0], 7.0, 4, 0.55, 16.0)
    cloud = m.noise(wv.outputs[0], 2.2, 5, 0.6)
    col = m.mix(m.remap(cloud, 0.3, 0.75, 0.0, 0.35), lin(base), m.mix(1.0, lin(base), (0.85, 0.85, 0.86) if not dark else (1.8, 1.8, 1.8), 'MULTIPLY'))
    col = m.mix(m.math('MULTIPLY', v1, 0.8), col, lin(vein)); col = m.mix(m.math('MULTIPLY', v2, 0.45), col, lin(vein))
    col = m.mix(m.remap(m.noise(op, 1.5, 3), 0.3, 0.75, 0.0, 0.5 * age), col, m.mix(1.0, col, (0.94, 0.88, 0.76), 'MULTIPLY'))
    cav = m.math('ADD', m.cavity(), 0.0); col = m.mix(m.math('MULTIPLY', m.remap(cav, 0.95, 0.5, smooth=True), 0.8), col, (0.08, 0.07, 0.06))
    rough = m.mixf(m.remap(m.noise(op, 4, 3), 0.45, 0.7, 0.0, 1.0), 0.14, 0.38)
    dust = m.math('MULTIPLY', m.remap(sep(m, m.geo('Normal'))[2], 0.6, 0.95, smooth=True), m.remap(m.noise(op, 40, 4), 0.3, 0.75, 0.3, 0.8))
    col = m.mix(dust, col, lin('#9a948a')); rough = m.mixf(dust, rough, 0.9)
    return finish(m, col, rough, m.math('MULTIPLY', v1, -0.00004))

def printed_tiles(name):
    """Victorian printed fireplace tiles (6 x 6 in): a transfer-printed spray of flowers in a border on a cream glaze, crazed, the
       grout sooted; 'lp' u, v run 0..1 over each tile"""
    m = kitlib.Mat(name); lp = m.attr('lp', True); op = m.attr('opos', True); u, v, w = sep(m, lp)
    du = m.math('MINIMUM', m.math('MINIMUM', u, m.math('SUBTRACT', 1.0, u)), m.math('MINIMUM', v, m.math('SUBTRACT', 1.0, v)))
    col = m.mix(m.remap(m.noise(op, 20, 3), 0.3, 0.7, 0.0, 0.2), lin('#e9e0c8'), lin('#d8cbaa'))
    bord = m.math('MULTIPLY', m.remap(du, 0.06, 0.07), m.remap(du, 0.1, 0.09)); col = m.mix(bord, col, lin('#3e5a6a'))
    X = m.math('SUBTRACT', u, 0.5); Y = m.math('SUBTRACT', v, 0.5); r = m.math('SQRT', m.math('ADD', m.math('MULTIPLY', X, X), m.math('MULTIPLY', Y, Y))); th = m.math('ARCTAN2', Y, X)
    pet = m.remap(m.math('DIVIDE', r, m.math('MULTIPLY', m.math('ADD', 0.5, m.math('MULTIPLY', m.math('ABSOLUTE', m.math('COSINE', m.math('MULTIPLY', th, 2.5))), 0.5)), 0.26)), 1.0, 0.88)
    leaf = m.math('MULTIPLY', m.remap(m.math('ABSOLUTE', m.math('SINE', m.math('MULTIPLY', th, 4.0))), 0.75, 0.9), m.math('MULTIPLY', m.remap(r, 0.26, 0.3), m.remap(r, 0.38, 0.34)))
    col = m.mix(m.math('MULTIPLY', leaf, 0.8), col, lin('#4f6e3c')); col = m.mix(m.math('MULTIPLY', pet, 0.85), col, m.mix(m.remap(r, 0.04, 0.2), lin('#c9a64a'), lin('#a8485a')))
    grout = m.remap(du, 0.012, 0.004); col = m.mix(grout, col, (0.07, 0.06, 0.05))
    crz = m.math('MULTIPLY', m.remap(m.voronoi(op, 180, 'Distance', 'DISTANCE_TO_EDGE'), 0.03, 0.0), 0.5); col = m.mix(crz, col, m.hsv(col, 0.5, 1.0, 0.55))
    sootv = m.remap(m.noise(op, 4, 3), 0.4, 0.75, 0.0, 0.45); col = m.mix(sootv, col, m.hsv(col, 0.5, 0.7, 0.6))
    return finish(m, col, m.mixf(grout, 0.1, 0.9), m.math('SUBTRACT', m.math('MULTIPLY', grout, -0.0015), m.math('MULTIPLY', crz, 0.00005)))

def quarry(name, a='#7a2e22', b='#2a2422'):
    """quarry tiles, red and black, worn, the glaze long gone"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    i = m.math('FLOOR', m.math('DIVIDE', x, 0.15)); j = m.math('FLOOR', m.math('DIVIDE', y, 0.15)); chk = m.math('MODULO', m.math('ADD', i, j), 2.0)
    col = m.mix(m.remap(chk, 0.4, 0.6), lin(a), lin(b)); col = m.mix(m.remap(m.noise(op, 30, 4), 0.3, 0.7, 0.0, 0.4), col, m.hsv(col, 0.5, 0.9, 1.25))
    fx = m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', x, 0.15)), 0.5)); fy = m.math('ABSOLUTE', m.math('SUBTRACT', m.math('FRACT', m.math('DIVIDE', y, 0.15)), 0.5))
    gr = m.math('MAXIMUM', m.remap(fx, 0.475, 0.49), m.remap(fy, 0.475, 0.49)); col = m.mix(gr, col, (0.12, 0.1, 0.09))
    ash = m.remap(m.noise(op, 6, 4), 0.45, 0.75, 0.0, 0.6); col = m.mix(ash, col, lin('#8d877e'))
    return finish(m, col, 0.82, m.math('MULTIPLY', gr, -0.002))

def stone_flags(name, base='#77736a'):
    """York stone flags outside: laid in random rectangles, worn smooth where feet go, lichen and moss in the joints, wet"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    v = m.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=1.0); m.l(comb(m, m.math('MULTIPLY', x, 2.2), m.math('MULTIPLY', y, 1.6), 0.0), v.inputs['Vector'])
    joint = m.remap(v.outputs['Distance'], 0.03, 0.012)
    col = m.mix(m.remap(m.noise(op, 3, 5, 0.6), 0.3, 0.7), lin(base), m.mix(1.0, lin(base), (0.78, 0.76, 0.72), 'MULTIPLY'))
    col = m.mix(m.remap(m.noise(op, 40, 3), 0.3, 0.7, 0.0, 0.3), col, m.hsv(col, 0.5, 0.9, 1.2))
    moss = m.math('MULTIPLY', m.remap(v.outputs['Distance'], 0.08, 0.02), m.remap(m.noise(op, 9, 4), 0.4, 0.65))
    col = m.mix(m.math('MULTIPLY', joint, 0.9), col, (0.05, 0.05, 0.04)); col = m.mix(m.math('MULTIPLY', moss, 0.75), col, lin('#3f4a26'))
    wet = m.remap(m.noise(op, 1.2, 3), 0.45, 0.7); col = m.mix(m.math('MULTIPLY', wet, 0.5), col, m.hsv(col, 0.5, 1.1, 0.6))
    return finish(m, col, m.mixf(wet, 0.8, 0.3), m.math('ADD', m.math('MULTIPLY', joint, -0.003), m.math('MULTIPLY', m.noise(op, 60, 4), 0.0006)))

def coir(name):
    """a coir doormat, trodden flat in the middle, its bristles sun-faded, dead leaves and grit in it"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    br = m.noise(m.map(op, (900, 900, 900)), 1.0, 2, 0.6)
    col = m.mix(m.remap(br, 0.3, 0.7), lin('#6a4a2a'), lin('#a07a4a')); col = m.mix(m.remap(m.noise(op, 3, 3), 0.4, 0.7, 0.0, 0.5), col, m.hsv(col, 0.5, 0.6, 0.6))
    return finish(m, col, 0.95, m.math('MULTIPLY', br, 0.0015))

def leaves_mat(name):
    """dead leaves blown into a corner: brown, curled, some still yellow"""
    m = kitlib.Mat(name); pr = m.attr('prand'); op = m.attr('opos', True)
    col = m.mix(m.remap(pr, 0.0, 1.0), lin('#5a3a1e'), lin('#9a6e2a')); col = m.mix(m.remap(m.math('FRACT', m.math('MULTIPLY', pr, 7.0)), 0.8, 0.9), col, lin('#a88a32'))
    vein = m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', m.noise(m.map(op, (80, 80, 80)), 1.0, 2), 0.5)), 0.03, 0.0); col = m.mix(m.math('MULTIPLY', vein, 0.5), col, m.hsv(col, 0.5, 1.0, 0.6))
    return finish(m, col, 0.85, m.math('MULTIPLY', vein, 0.0002))

def plaster_paint(name, col_='#e4ddcc', soot=0.0, age=1.3):
    """moulded plaster under coats of distemper: soft chalky white, the detail clogged with old paint, cracked, flaking in places to
       grey, sooted (soot: how much), cobweb grey in the hollows"""
    m = kitlib.Mat(name); op = m.attr('opos', True); g = m.attr('gpos', True); c = lin(col_)
    cav = m.math('ADD', m.cavity(), 0.0); edge = m.math('ADD', m.edge(), 0.0)
    col = m.mix(m.remap(m.noise(op, 5, 4), 0.3, 0.7, 0.0, 0.45 * age), c, m.mix(1.0, m.mix(0.0, c, c), (0.9, 0.86, 0.76), 'MULTIPLY'))
    fl = m.math('ADD', m.math('MULTIPLY', edge, 0.4), m.math('SUBTRACT', m.noise(op, 30, 5, 0.65), 0.5)); flake = m.remap(fl, 0.33, 0.36)
    col = m.mix(flake, col, lin('#a39c90'))
    crk = m.math('MULTIPLY', m.remap(m.voronoi(m.map(op, (1, 1, 1)), 45, 'Distance', 'DISTANCE_TO_EDGE'), 0.012, 0.0), m.remap(m.noise(op, 3, 3), 0.56, 0.68))
    col = m.mix(m.math('MULTIPLY', crk, 0.4), col, m.mix(1.0, col, (0.55, 0.52, 0.47), 'MULTIPLY'))   # (hairline cracks in the paint: dirt in them, not cuts)
    col = m.mix(m.math('MULTIPLY', m.remap(cav, 0.95, 0.5, smooth=True), 0.75), col, m.mix(1.0, col, (0.5, 0.48, 0.44), 'MULTIPLY'))
    if soot: col = m.mix(m.math('MULTIPLY', m.remap(m.noise(op, 2, 3), 0.3, 0.75), soot), col, m.mix(1.0, col, (0.4, 0.37, 0.33), 'MULTIPLY'))
    return finish(m, col, 0.92, m.math('SUBTRACT', m.math('MULTIPLY', flake, -0.0003), m.math('MULTIPLY', crk, 0.0002)))

def limewash_coat(name):
    """old limewash on brick, flake by flake: grey-white, mottled and grimed, rust-pink where the brick's iron and salts bled through
       the thin coat, the mortar joints printed in it (running bond, as the wall behind), dirt packed into the lifted rims (ja: how
       far from the flake's edge), crazed, dead matte"""
    m = kitlib.Mat(name); op = m.attr('opos', True); ja = m.attr('ja'); x, y, z = sep(m, op)
    col = m.mix(m.remap(m.noise(op, 7, 4, 0.6), 0.3, 0.7), lin('#cbc5b6'), lin('#a8a090'))
    col = m.mix(m.remap(m.noise(op, 1.4, 4, 0.6), 0.3, 0.8, 0.1, 0.75), col, m.mix(1.0, col, (0.66, 0.62, 0.55), 'MULTIPLY'))   # (a century of cellar grime)
    col = m.mix(m.remap(m.noise(op, 12, 4, 0.6), 0.45, 0.75, 0.0, 0.35), col, m.mix(1.0, col, (0.75, 0.72, 0.66), 'MULTIPLY'))
    col = m.mix(m.math('MULTIPLY', m.remap(m.noise(op, 3.0, 3, 0.55), 0.52, 0.72), 0.5), col, lin('#b38c76'))                # (bled through)
    col = m.mix(m.math('MULTIPLY', m.remap(z, 1.0, 0.55), 0.35), col, m.mix(1.0, col, (0.82, 0.82, 0.8), 'MULTIPLY'))       # (the damp greys it low down)
    row = m.math('FLOOR', m.math('DIVIDE', z, 0.075)); bx = m.math('ADD', x, m.math('MULTIPLY', m.math('MODULO', row, 2.0), 0.1125))
    fz = m.math('FRACT', m.math('DIVIDE', z, 0.075)); fx = m.math('FRACT', m.math('DIVIDE', bx, 0.225))
    jt = m.math('MAXIMUM', m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fz, 0.5)), 0.42, 0.48), m.remap(m.math('ABSOLUTE', m.math('SUBTRACT', fx, 0.5)), 0.465, 0.495))
    col = m.mix(m.math('MULTIPLY', jt, 0.45), col, m.mix(1.0, col, (0.7, 0.67, 0.62), 'MULTIPLY'))
    rim = m.remap(ja, 0.006, 0.0, smooth=True)
    col = m.mix(m.math('MULTIPLY', rim, 0.55), col, m.mix(1.0, col, (0.55, 0.5, 0.44), 'MULTIPLY'))
    crz = m.math('MULTIPLY', m.remap(m.voronoi(op, 90, 'Distance', 'DISTANCE_TO_EDGE'), 0.02, 0.0), 0.5)
    col = m.mix(crz, col, m.mix(1.0, col, (0.6, 0.58, 0.54), 'MULTIPLY'))
    h = m.math('ADD', m.math('MULTIPLY', jt, -0.0006), m.math('ADD', m.math('MULTIPLY', m.noise(op, 220, 3), 0.0003), m.math('MULTIPLY', crz, -0.0001)))
    return finish(m, col, 0.95, h)

def bare_plaster(name):
    """plaster where wallpaper came away: lime grey-white, brown paste in streaks along the old strip, scraps of paper still stuck"""
    m = kitlib.Mat(name); op = m.attr('opos', True); x, y, z = sep(m, op)
    col = m.mix(m.remap(m.noise(op, 8, 4), 0.3, 0.7), lin('#cfc6b3'), lin('#a99e88'))
    paste = m.remap(m.noise(m.map(op, (6, 6, 1.5)), 1.0, 4, 0.6), 0.5, 0.66); col = m.mix(m.math('MULTIPLY', paste, 0.6), col, lin('#8c6f48'))
    scrap = m.remap(m.noise(op, 18, 3, 0.6), 0.64, 0.66); col = m.mix(scrap, col, lin('#c9a9a0'))
    return finish(m, col, 0.92, m.math('ADD', m.math('MULTIPLY', scrap, 0.0002), m.math('MULTIPLY', m.noise(op, 200, 3), 0.0003)))

def dust_mat(name, col_='#8f877a'):
    """a heap of plaster dust and grit"""
    m = kitlib.Mat(name); op = m.attr('opos', True)
    col = m.mix(m.remap(m.noise(op, 80, 3), 0.3, 0.7), lin(col_), m.hsv(m.mix(0.0, lin(col_), lin(col_)), 0.5, 0.8, 1.25))
    return finish(m, col, 0.97, m.math('MULTIPLY', m.noise(op, 300, 3), 0.0008))

# ================================================================ the exits
EXIT = {        # leaf paint, leaf kind, porch floor, porch walls (ext brick), casing profile
    'wood': {'paint': ['#2f4a36', '#7a6a4a', '#8a5a3c'], 'leaf': 'panel_glazed', 'floor': 'flags'},
    'tile': {'paint': ['#1d1f1e', '#5a3a2a', '#8a5a3c'], 'leaf': 'panel', 'floor': 'quarry'},
    'concrete': {'paint': ['#4b4f4a', '#7a3b28', '#7a3b28'], 'leaf': 'boards', 'floor': 'concrete'},
    'attic': {'paint': None, 'leaf': 'boards_rough', 'floor': 'boards'},
    'workshop': {'paint': ['#5a6358', '#8a3c26', '#8a3c26'], 'leaf': 'steel', 'floor': 'concrete'},
}
EXIT_LEAF = {'stile': 0.13, 'rails': [(0.0, 0.26), (0.98, 1.18), (2.17, 2.3)], 'cols': [(0.13, 0.52), (0.63, 1.02)], 'prof': Dr.OVOLO, 'field': []}

def build_exit(style, M):
    p = PIECES['Exit_' + style]; po, head = p['post'], p['head']; lw, lh = p['leaf']; R = p['R']
    G = {k: S.Geo(1, 1, False, False) for k in ('root', 'leaf', 'boards', 'lamp')}; root = G['root']
    E = EXIT[style]
    wall_face(root, M['wall'], (-po, po, 0.0, head))
    pl = Dr.PLINTH.get(style)
    architrave(root, M['frame'], ARCH[style], po + MARGIN, head + MARGIN, pl[0] if pl else 0.0, 0.0, -1, pl)
    fy = 0.12                                                  # (the door frame's depth: the leaf hangs in it, the porch begins after)
    jx, jh = lw / 2 + 0.003, lh + 0.003                        # (the frame closes in to 3 mm round the leaf; its face fills the rest)
    for sx in (-1, 1):
        root.add(quad_bm([(sx * jx, 0, 0), (sx * jx, fy, 0), (sx * jx, fy, jh), (sx * jx, 0, jh)], (-sx, 0, 0)), M['frame'], wood_attrs((0, 0, 1), (sx, 0, 0)), wrap=False)
        xa, xb = sorted((sx * jx, sx * po))
        root.add(quad_bm([(xa, 0, 0), (xb, 0, 0), (xb, 0, head), (xa, 0, head)], (0, -1, 0)), M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
        xa, xb = sorted((sx * jx, sx * (jx - 0.014)))         # (the stop: on the room side, the door opening outward against it)
        root.add(block((xa, -0.012, 0.0), (xb, 0.004, jh), 0.002, 1), M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    root.add(quad_bm([(-jx, 0, jh), (jx, 0, jh), (jx, fy, jh), (-jx, fy, jh)], (0, 0, -1)), M['frame'], wood_attrs((1, 0, 0), (0, 0, -1)), wrap=False)
    root.add(quad_bm([(-po, 0, jh), (po, 0, jh), (po, 0, head), (-po, 0, head)], (0, -1, 0)), M['frame'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    root.add(block((-jx, -0.012, jh - 0.014), (jx, 0.004, jh), 0.002, 1), M['frame'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    for sx in (-1, 1):                                          # (the frame's back, toward the porch: seen once the door is open)
        xa, xb = sorted((sx * jx, sx * po))
        root.add(quad_bm([(xa, fy, 0), (xb, fy, 0), (xb, fy, head), (xa, fy, head)], (0, 1, 0)), M['frame'], wood_attrs((0, 0, 1), (0, 1, 0)), wrap=False)
    root.add(quad_bm([(-jx, fy, jh), (jx, fy, jh), (jx, fy, head), (-jx, fy, head)], (0, 1, 0)), M['frame'], wood_attrs((1, 0, 0), (0, 1, 0)), wrap=False)
    root.add(block((-po - 0.03, -0.02, -0.002), (po + 0.03, fy + 0.04, 0.025), 0.004, 1), M['sill'], wood_attrs((1, 0, 0), (0, 0, 1)), wrap=False)   # (the threshold)
    # the porch: its floor, brick sides, a boarded soffit; the sky at its far end
    py0, py1 = fy + 0.04, R - 0.012
    root.add(quad_bm([(-po, py0, 0.0), (po, py0, 0.0), (po, py1, 0.0), (-po, py1, 0.0)], (0, 0, 1)), M['porch_floor'], plain(None), wrap=False)
    for sx in (-1, 1):
        root.add(quad_bm([(sx * po, fy, 0), (sx * po, py1, 0), (sx * po, py1, head), (sx * po, fy, head)], (-sx, 0, 0)), M['porch_wall'], attrs_of(lambda c: tuple(c), random.random()), wrap=False)
    root.add(quad_bm([(-po, fy, head), (po, fy, head), (po, py1, head), (-po, py1, head)], (0, 0, -1)), M['porch_wall'], plain(None), wrap=False)
    Wn.sky(root, M['sky'], -po, po, 0.0, head, py1 + 0.002)
    root.add(block((-0.32, py0 + 0.03, 0.0), (0.32, py0 + 0.45, 0.018), 0.01, 2), M['coir'], plain(None), wrap=False)      # (a doormat outside)
    for k in range(18):                                        # (dead leaves blown into the porch's corners)
        sx = random.choice((-1, 1)); x = sx * (po - random.uniform(0.02, 0.25)); y = random.uniform(py0 + 0.1, py1 - 0.05); r = random.uniform(0.025, 0.05)
        bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=7, radius=r)
        for v in bm.verts: v.co.z = 0.003 + 0.012 * (v.co.x / r) ** 2 + random.uniform(0, 0.004)
        S.xform(bm, (x, y, 0.0), (0, 0, random.uniform(0, 6.28)))
        root.add(bm, M['leaves'], attrs_of(lambda c: tuple(c), random.random()), wrap=False)
    # the lamp above the door: its cast-iron cage on the wall (the root) and the lens (the child the game colours)
    lz = head + MARGIN + AW + 0.12
    root.add(lathe_bm([(0.0, 0.07), (0.5, 0.07), (1.0, 0.055)], (0, 0.0, lz), (0, -0.018, lz), 16, (False, True)), M['iron'], metal_attrs(), smooth=True, wrap=False)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        tube(root, M['iron'], [Vector((0.05 * math.cos(a), -0.018, lz + 0.05 * math.sin(a))), Vector((0.052 * math.cos(a), -0.08, lz + 0.052 * math.sin(a))), Vector((0.0, -0.092, lz))], 0.004, 6)
    G['lamp'].add(lathe_bm([(0.0, 0.044), (0.4, 0.045), (0.8, 0.036), (1.0, 0.0)], (0, -0.018, lz), (0, -0.088, lz), 16, (True, True)), M['emit'], metal_attrs(), smooth=True, wrap=False)
    # the leaf, built at its hinge (x = 0 here; the node sits at x = -lw / 2)
    L = G['leaf']; T = 0.05; oy = 0.03
    kind = E['leaf']
    if kind in ('panel', 'panel_glazed'):
        spec = dict(EXIT_LEAF)
        if kind == 'panel_glazed': spec['glass'] = 1             # (the upper half glazed: the night through it)
        holes = panel_leaf(L, spec, lw, lh, T, M['leafm'], o=(0.0, oy, 0.0))
        for h in holes:
            b = BEAD[-1][0] - 0.004; Wn.pane(L, M['glass'], h[0] + b, h[1] - b, h[2] + b, h[3] - b, oy)
        knob_set(L, M, lw - 0.07, 1.05, -1, oy - T / 2, 0.06, 'brass')
        L.add(plate(rounded(0.26, 0.06, 0.006, 3, lw / 2, 1.08), oy - T / 2, 0.003), M['brass'], metal_attrs(), wrap=False)          # (the letter plate, on the lock rail)
        tube(L, M['brass'], [Vector((lw / 2 - 0.11, oy - T / 2 - 0.006, 1.095)), Vector((lw / 2 + 0.11, oy - T / 2 - 0.006, 1.095))], 0.004, 8)
        if kind == 'panel':                                     # (a knocker on the muntin of the solid door)
            L.add(plate(rounded(0.06, 0.09, 0.02, 4, lw / 2, 1.62), oy - T / 2, 0.006), M['brass'], metal_attrs(), wrap=False)
            tube(L, M['brass'], [Vector((lw / 2 - 0.035, oy - T / 2 - 0.016, 1.59)), Vector((lw / 2 - 0.035, oy - T / 2 - 0.016, 1.5)), Vector((lw / 2 + 0.035, oy - T / 2 - 0.016, 1.5)), Vector((lw / 2 + 0.035, oy - T / 2 - 0.016, 1.59))], 0.008, 8)
        knuckles(L, M['iron'], -0.002, 0.0, (0.25, 1.15, 2.05))
    elif kind in ('boards', 'boards_rough'):
        rough = kind == 'boards_rough'; n = 7 if not rough else 6
        bw = boards_leaf(L, M, lw, lh, T, n, 0.0 if not rough else 0.004, [(0.22, 0.16), (1.15, 0.16), (2.08, 0.16)], [(0.3, 1.07), (1.23, 2.0)] if not rough else [], rough, o=(0.0, oy, 0.0))
        for zc in (0.22, 1.15, 2.08): L.add(plate(strap_outline(-0.004, 0.62, zc, 0.045, 0.03, 'round' if not rough else 'spear'), oy - T / 2, 0.0045, bevel=0.0007), M['iron'], metal_attrs(), wrap=False)
        nails(L, M['iron'], [(i * bw + bw * f, zc + dz) for i in range(n) for zc in (0.22, 1.15, 2.08) for f, dz in ((0.3, 0.04), (0.7, -0.04))], oy - T / 2)
        tube(L, M['iron'], [Vector((lw - 0.1, oy - T / 2 - 0.004 - 0.02 * math.sin(math.pi * k / 8), 0.95 + 0.25 * k / 8)) for k in range(9)], 0.007)
        knuckles(L, M['iron'], -0.002, 0.0, (0.22, 1.15, 2.08))
    else:                                                       # (a steel door: flush, a push bar, a wired vision panel)
        F = Face((0, oy - T / 2, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0)); vp = (lw / 2 - 0.11, lw / 2 + 0.11, 1.35, 1.95)
        mems = {}
        def att(k, s_, r):
            if (k, s_) not in mems: mems[(k, s_)] = metal_attrs()
            return mems[(k, s_)]
        panelled(L, F, (0.004, lw - 0.004, 0.004, lh - 0.004), [], [], [], M['leafm'], att, holes=[(vp, [(-0.012, 0.0), (-0.011, 0.004), (-0.008, 0.006), (0.0, 0.006), (0.0, -0.025)])])
        Fb = Face((0, oy + T / 2, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0)); panelled(L, Fb, (0.004, lw - 0.004, 0.004, lh - 0.004), [], [], [], M['leafm'], att, holes=[(vp, [(0.0, 0.0), (0.0, -0.025)])])
        Dr.perimeter(L, 0.0, lw, 0.0, lh, [(d, y + oy) for d, y in Dr.arris(T, 0.004)], M['leafm'], att)
        wired_glass(L, M['glass'], M['wire'], vp[0], vp[1], vp[2], vp[3], y0=oy)
        for xb in (0.12, lw - 0.12):
            L.add(block((xb - 0.03, oy - T / 2 - 0.06, 0.96), (xb + 0.03, oy - T / 2, 1.06), 0.006, 2), M['steel'], metal_attrs(), wrap=False)
        tube(L, M['steel'], [Vector((0.12, oy - T / 2 - 0.05, 1.01)), Vector((lw - 0.12, oy - T / 2 - 0.05, 1.01))], 0.016, 12)          # (the push bar)
        L.add(plate(rounded(lw - 0.06, 0.3, 0.004, 2, lw / 2, 0.17), oy - T / 2, 0.0015), M['steel'], metal_attrs(), wrap=False)
        knuckles(L, M['steel'], -0.002, 0.0, (0.25, 1.15, 2.05))
    # the boards and the chain across the doorway (they drop when the power comes on)
    B = G['boards']; rnd = random.Random(hash(style) & 0xffff)
    for k, (zc, ang) in enumerate(((0.62, 0.05), (1.28, -0.07), (1.95, 0.04))):
        L_ = 2 * (po + 0.11); bm = block((-L_ / 2, -0.064, -0.075), (L_ / 2, -0.03, 0.075), 0.003, 1); S.deform(bm, lambda c: (c.x, c.y + 0.0015 * math.sin(c.x * 5), c.z))
        S.xform(bm, (0, 0, 0), (0, ang, 0)); S.xform(bm, (rnd.uniform(-0.03, 0.03), 0, zc))
        B.add(bm, M['board'], wood_attrs((math.cos(ang), 0, -math.sin(ang)), (0, -1, 0)), wrap=False)
        nails(B, M['iron'], [(sx * (po + 0.04), zc - sx * ang * (po + 0.04) + dz) for sx in (-1, 1) for dz in (-0.035, 0.035)], -0.064, -1, 0.006, 0.003)
    # the chain: links alternating flat and edge-on, sagging between staples on the architraves, a padlock in the middle
    sx0, sx1, cz_ = -(po + 0.04), po + 0.04, 1.06; nl = 34
    pts = [Vector((sx0 + (sx1 - sx0) * t, -0.075 - 0.01 * math.sin(math.pi * t), cz_ - 0.14 * math.sin(math.pi * t))) for t in (i / nl for i in range(nl + 1))]
    for i in range(nl):
        a, b = pts[i], pts[i + 1]; d = (b - a); c = (a + b) / 2; ha = d.length * 0.62; hb, tr = 0.009, 0.0035
        tor = bmesh.new()
        for j in range(10):                                   # (an oval link: an ellipse swept with a round section)
            th = 2 * math.pi * j / 10
            for k in range(5):
                ph = 2 * math.pi * k / 5
                tor.verts.new((math.cos(th) * (ha + tr * math.cos(ph)), tr * math.sin(ph), math.sin(th) * (hb + tr * math.cos(ph))))
        tor.verts.ensure_lookup_table()
        for j in range(10):
            for k in range(5):
                tor.faces.new((tor.verts[j * 5 + k], tor.verts[((j + 1) % 10) * 5 + k], tor.verts[((j + 1) % 10) * 5 + (k + 1) % 5], tor.verts[j * 5 + (k + 1) % 5]))
        bmesh.ops.recalc_face_normals(tor, faces=tor.faces[:])
        ang = math.atan2(d.z, d.x); S.xform(tor, (0, 0, 0), ((math.pi / 2) if i % 2 else 0.0, -ang, 0)); S.xform(tor, tuple(c))
        B.add(tor, M['chain'], metal_attrs(), smooth=True, wrap=False)
    mid = pts[nl // 2]
    B.add(block((mid.x - 0.03, mid.y - 0.014, mid.z - 0.095), (mid.x + 0.03, mid.y + 0.014, mid.z - 0.04), 0.006, 2), M['steel'], metal_attrs(), wrap=False)   # (the padlock)
    tube(B, M['steel'], [Vector((mid.x - 0.018, mid.y, mid.z - 0.04)), Vector((mid.x - 0.018, mid.y, mid.z - 0.005)), Vector((mid.x + 0.018, mid.y, mid.z - 0.005)), Vector((mid.x + 0.018, mid.y, mid.z - 0.04))], 0.005, 8)
    for sx in (-1, 1):
        B.add(lathe_bm([(0.0, 0.012), (1.0, 0.009)], (sx * (po + 0.04), -0.024, cz_), (sx * (po + 0.04), -0.07, cz_), 8), M['iron'], metal_attrs(), wrap=False)
    return G

# ================================================================ fireplaces
def build_fireplace(style, M):
    p = PIECES['Mod_fireplace_' + style]; mh = p['mantel']; R = p['R']
    br = min(p['breast'], 0.24)                                   # (the breast's face: the surround and shelf stand on it, all inside 0.42)
    G = S.Geo(1, 1, False, False); bw = 0.8                       # (the breast: 1.6 m wide, 0.4 proud, floor to the face's top)
    fw, fh = (0.62, 0.62) if style != 'workshop' else (1.32, 1.44)
    fz0 = 0.0 if style != 'workshop' else 0.76                    # (the forge's hearth stands at working height)
    fb = 0.2                                                      # (the firebox's back, into the wall: 0.44 deep)
    # the wall face either side and the breast (WallSurface), its opening
    wall_face(G, M['wall'], (-bw, bw, 0.0, FH))
    for sx in (-1, 1):
        G.add(quad_bm([(sx * bw, 0, 0), (sx * bw, -br, 0), (sx * bw, -br, FH), (sx * bw, 0, FH)], (sx, 0, 0)), M['wall'], plain(None), wrap=False)
    ow, oh = (1.1, 1.05) if style != 'workshop' else (1.32, 2.2)  # (the opening in the breast that the surround frames; the forge's hood fills it)
    for (a, b, c, d) in ((-bw, -ow / 2, 0, FH), (ow / 2, bw, 0, FH), (-ow / 2, ow / 2, oh, FH)) if style != 'workshop' else ((-bw, -ow / 2, 0, FH), (ow / 2, bw, 0, FH), (-ow / 2, ow / 2, 2.2, FH)):
        G.add(quad_bm([(a, -br, c), (b, -br, c), (b, -br, d), (a, -br, d)], (0, -1, 0)), M['wall'], plain(None), wrap=False)
    # the firebox: sooted brick sides and back, its top
    for sx in (-1, 1):
        G.add(quad_bm([(sx * fw / 2, -br, fz0), (sx * fw / 2, fb, fz0), (sx * fw / 2, fb, fz0 + fh), (sx * fw / 2, -br, fz0 + fh)], (-sx, 0, 0)), M['soot'], plain(None), wrap=False)
    G.add(quad_bm([(-fw / 2, fb, fz0), (fw / 2, fb, fz0), (fw / 2, fb, fz0 + fh), (-fw / 2, fb, fz0 + fh)], (0, -1, 0)), M['soot'], plain(None), wrap=False)
    G.add(quad_bm([(-fw / 2, -br, fz0 + fh), (fw / 2, -br, fz0 + fh), (fw / 2, fb, fz0 + fh), (-fw / 2, fb, fz0 + fh)], (0, 0, -1)), M['soot'], plain(None), wrap=False)
    G.add(quad_bm([(-fw / 2, -br, fz0), (fw / 2, -br, fz0), (fw / 2, fb, fz0), (-fw / 2, fb, fz0)], (0, 0, 1)), M['soot'], plain(None), wrap=False)
    if style == 'workshop':
        build_forge(G, M, br, fw, fh, fz0, fb); return G
    # the cast-iron insert: an arched register grate filling the opening round the firebox, fire basket, ash pan front
    iy = -br - 0.004
    mouth = [(fw / 2 * math.cos(math.pi * k / 16), fh * 0.6 + fh * 0.4 * math.sin(math.pi * k / 16)) for k in range(17)]
    fill_to_rect(G, M['iron'], [(fw / 2, 0.0)] + mouth + [(-fw / 2, 0.0)], (-ow / 2, ow / 2, 0.0, oh), lambda a, b: (a, iy, b), (0, -1, 0), metal_attrs())
    for k in range(16):                                         # (the arch's soffit back into the firebox)
        a, b = mouth[k], mouth[k + 1]
        G.add(quad_bm([(a[0], iy, a[1]), (b[0], iy, b[1]), (b[0], -br + 0.08, b[1]), (a[0], -br + 0.08, a[1])], (-(a[0] + b[0]), 0, -(a[1] + b[1] - 2 * fh * 0.6))), M['iron'], metal_attrs(), wrap=False)
    # tiled cheeks either side of the insert (five printed tiles each), the fire basket, the ash pan front
    if style == 'wood':
        ts = 0.152
        for sx in (-1, 1):
            for k in range(5):
                x0 = sx * (fw / 2 + 0.02); x1 = x0 + sx * ts; z0 = 0.1 + k * ts
                xa, xb = sorted((x0, x1))
                G.add(quad_bm([(xa, iy - 0.003, z0), (xb, iy - 0.003, z0), (xb, iy - 0.003, z0 + ts), (xa, iy - 0.003, z0 + ts)], (0, -1, 0)), M['tiles'],
                      attrs_of(lambda c: tuple(c), 0.5, lp=(lambda c, xa=xa, z0=z0: ((Vector(c).x - xa) / ts, (Vector(c).z - z0) / ts, 1.0))), wrap=False)
    for k in range(7):                                          # (the basket's front bars)
        z = 0.1 + k * 0.035
        tube(G, M['iron'], [Vector((-fw / 2 + 0.06, -br + 0.06, z)), Vector((fw / 2 - 0.06, -br + 0.06, z))], 0.006, 6)
    for sx in (-1, 1):
        G.add(block((sx * (fw / 2 - 0.08) - 0.015, -br + 0.03, 0.0), (sx * (fw / 2 - 0.08) + 0.015, -br + 0.09, 0.36), 0.004, 1), M['iron'], metal_attrs(), wrap=False)
    G.add(block((-fw / 2 + 0.05, -br + 0.03, 0.0), (fw / 2 - 0.05, -br + 0.05, 0.085), 0.004, 1), M['iron'], metal_attrs(), wrap=False)   # (ash pan front)
    for k in range(40):                                         # (coal, cold now, and ash)
        x = random.uniform(-fw / 2 + 0.1, fw / 2 - 0.1); y = random.uniform(-br + 0.08, fb - 0.08); z = 0.13 + random.uniform(0, 0.12)
        G.add(rock((x, y, z), (0.025, 0.022, 0.02), k * 0.7, 1, 0.8), M['coal'], metal_attrs(), wrap=False)
    # the surround: pilasters, frieze, mantel shelf at mh, the hearth
    if style == 'wood': surround_painted(G, M, br, ow, oh, mh)
    else: surround_marble(G, M, br, ow, oh, mh)
    hd = 0.42                                                   # (the hearth)
    hb = block((-ow / 2 - 0.22, -hd, 0.0), (ow / 2 + 0.22, -br + 0.001, 0.035), 0.006, 2)
    G.add(hb, M['hearth'], attrs_of(lambda c: tuple(c), 0.5), wrap=False)
    G.add(quad_bm([(-fw / 2, -br, 0.0005), (fw / 2, -br, 0.0005), (fw / 2, fb, 0.0005), (-fw / 2, fb, 0.0005)], (0, 0, 1)), M['soot'], plain(None), wrap=False)
    # a brass fender along the hearth's edge
    for xs in (-1, 1):
        tube(G, M['brass'], [Vector((xs * (ow / 2 + 0.18), -br - 0.005, 0.06)), Vector((xs * (ow / 2 + 0.18), -hd + 0.03, 0.06)), Vector((0.0, -hd + 0.03, 0.06))], 0.008, 8)
    G.add(block((-ow / 2 - 0.2, -hd + 0.02, 0.035), (ow / 2 + 0.2, -hd + 0.04, 0.05), 0.004, 1), M['brass'], metal_attrs(), wrap=False)
    return G

def surround_painted(G, M, br, ow, oh, mh):
    """a painted pine surround: fluted pilasters on plinths, corbels under the shelf, a plain frieze with a moulded edge, the shelf"""
    ws = 0.16; y0 = -br
    for sx in (-1, 1):
        xa, xb = sorted((sx * ow / 2, sx * (ow / 2 + ws)))
        G.add(block((xa, y0 - 0.035, 0.0), (xb, y0, 0.22), 0.004, 1), M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
        G.add(block((xa + 0.01, y0 - 0.025, 0.22), (xb - 0.01, y0, mh - 0.2), 0.003, 1), M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
        for k in range(3):                                     # (flutes)
            xf = xa + 0.035 + k * (xb - xa - 0.07) / 2
            G.add(block((xf - 0.006, y0 - 0.028, 0.3), (xf + 0.006, y0 - 0.024, mh - 0.28), 0.003, 1), M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
        G.add(block((xa - 0.01, y0 - 0.06, mh - 0.2), (xb + 0.01, y0, mh - 0.04), 0.008, 2), M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)   # (corbel)
    G.add(block((-ow / 2, y0 - 0.02, oh), (ow / 2, y0, mh - 0.04), 0.003, 1), M['frame'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)   # (frieze)
    G.add(block((-ow / 2 - ws - 0.04, y0 - 0.03, oh - 0.03), (ow / 2 + ws + 0.04, y0, oh), 0.006, 2), M['frame'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    W2 = ow / 2 + ws + 0.07
    rows = [[Vector((-W2, y0 - d, mh - 0.04 + h)), Vector((W2, y0 - d, mh - 0.04 + h))] for d, h in [(0.0, 0.0), (0.14, 0.0), (0.155, 0.006), (0.162, 0.018), (0.16, 0.03), (0.15, 0.04), (0.0, 0.04)]]
    G.add(strip(rows, [Vector((0, 0, -1)), Vector((0, -1, -0.5)), Vector((0, -1, 0)), Vector((0, -1, 0.5)), Vector((0, -0.2, 1)), Vector((0, 0, 1))]), M['frame'], wood_attrs((1, 0, 0), (0, 0, 1)), smooth=True, wrap=False)
    for sx in (-1, 1):
        G.add(quad_bm([(sx * W2, y0, mh - 0.04), (sx * W2, y0 - 0.16, mh - 0.04), (sx * W2, y0 - 0.16, mh), (sx * W2, y0, mh)], (sx, 0, 0)), M['frame'], wood_attrs((1, 0, 0), (sx, 0, 0)), wrap=False)

def surround_marble(G, M, br, ow, oh, mh):
    """a marble chimneypiece: jambs with console brackets, a carved frieze with a central tablet, a moulded shelf"""
    ws = 0.2; y0 = -br
    for sx in (-1, 1):
        xa, xb = sorted((sx * ow / 2, sx * (ow / 2 + ws)))
        G.add(block((xa, y0 - 0.05, 0.0), (xb, y0, mh - 0.3), 0.006, 2), M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
        cb = [(0.0, mh - 0.3), (0.0, mh - 0.04), (0.11, mh - 0.04), (0.11, mh - 0.1), (0.07, mh - 0.16), (0.03, mh - 0.26), (0.0, mh - 0.3)]   # (the console's profile)
        bm = bmesh.new(); vs = [bm.verts.new(((xa + xb) / 2 - 0.05, y0 - d, z)) for d, z in cb]; f = bm.faces.new(vs)
        r = bmesh.ops.extrude_face_region(bm, geom=[f]); bmesh.ops.translate(bm, verts=[e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)], vec=(0.1, 0, 0))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); G.add(bm, M['frame'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    G.add(block((-ow / 2, y0 - 0.04, oh), (ow / 2, y0, mh - 0.04), 0.004, 2), M['frame'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
    G.add(block((-0.12, y0 - 0.055, oh + 0.02), (0.12, y0 - 0.04, mh - 0.07), 0.004, 2), M['frame'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)   # (the tablet)
    W2 = ow / 2 + ws + 0.06
    rows = [[Vector((-W2, y0 - d, mh - 0.04 + h)), Vector((W2, y0 - d, mh - 0.04 + h))] for d, h in [(0.0, 0.0), (0.17, 0.0), (0.18, 0.008), (0.19, 0.022), (0.188, 0.036), (0.178, 0.045), (0.0, 0.045)]]
    G.add(strip(rows, [Vector((0, 0, -1)), Vector((0, -1, -0.5)), Vector((0, -1, 0)), Vector((0, -1, 0.5)), Vector((0, -0.2, 1)), Vector((0, 0, 1))]), M['frame'], wood_attrs((1, 0, 0), (0, 0, 1)), smooth=True, wrap=False)
    for sx in (-1, 1):
        G.add(quad_bm([(sx * W2, y0, mh - 0.04), (sx * W2, y0 - 0.19, mh - 0.04), (sx * W2, y0 - 0.19, mh + 0.005), (sx * W2, y0, mh + 0.005)], (sx, 0, 0)), M['frame'], wood_attrs((1, 0, 0), (sx, 0, 0)), wrap=False)

def build_forge(G, M, br, fw, fh, fz0, fb):
    """a smith's forge: a brick hearth at working height right across the opening, its iron top plate and fire pot, coal; a
       sheet-steel hood over it, sloping back to the flue, seen inside and out"""
    hw = 0.66; bl = 0.225; bh = 0.075
    for k in range(10):                                        # (the hearth's brick front, in courses)
        z = k * bh; off = bl / 2 if k % 2 else 0.0; x = -hw - off
        while x < hw:
            x0, x1 = max(-hw, x + 0.004), min(hw, x + bl - 0.004)
            if x1 - x0 > 0.02: G.add(block((x0, -br - 0.002, z + 0.004), (x1, -br + 0.03, z + bh - 0.004), 0.004, 1), M['brick'], attrs_of(member((1, 0, 0), (0, -1, 0))[0], random.random()), wrap=False)
            x += bl
    G.add(quad_bm([(-hw, -br + 0.03, 0.0), (hw, -br + 0.03, 0.0), (hw, -br + 0.03, 0.75), (-hw, -br + 0.03, 0.75)], (0, -1, 0)), M['soot'], plain(None), wrap=False)   # (the joints' shadow)
    G.add(block((-hw - 0.02, -br - 0.03, 0.75), (hw + 0.02, fb, 0.79), 0.004, 1), M['iron'], metal_attrs(), wrap=False)    # (the iron top plate)
    G.add(lathe_bm([(0.0, 0.17), (0.6, 0.15), (1.0, 0.09)], (0, -br * 0.55, 0.791), (0, -br * 0.55, 0.7), 16, (False, True)), M['iron'], metal_attrs(), smooth=True, wrap=False)   # (fire pot)
    for k in range(45):
        x = random.uniform(-0.16, 0.16); y = -br * 0.55 + random.uniform(-0.12, 0.12); z = 0.78 + random.uniform(0, 0.05)
        G.add(rock((x, y, z), (0.02, 0.02, 0.018), k * 1.3, 1, 0.8), M['coal'], metal_attrs(), wrap=False)
    hz0, hz1 = 1.3, 2.2; hy1 = -0.12                              # (the hood: its lip at 1.3 m, back to the flue at 2.2)
    front = [(-0.66, -br, hz0), (0.66, -br, hz0), (0.24, hy1, hz1), (-0.24, hy1, hz1)]
    for side in (1, -1):                                        # (both faces of the sheet: seen from below too)
        G.add(quad_bm(front, (0, -side, 0.5 * side)), M['hood'], metal_attrs(), wrap=False)
        for sx in (-1, 1):
            G.add(quad_bm([(sx * 0.66, -br, hz0), (sx * 0.66, fb, hz0), (sx * 0.24, fb, hz1), (sx * 0.24, hy1, hz1)], (sx * side, 0, 0.2 * side)), M['hood'], metal_attrs(), wrap=False)
    G.add(block((-0.24, hy1, hz1), (0.24, fb, FH), 0.003, 1), M['hood'], metal_attrs(), wrap=False)
    tube(G, M['iron'], [Vector((-0.67, -br - 0.008, hz0)), Vector((0.67, -br - 0.008, hz0))], 0.009, 8)
    for sx in (-1, 1):                                          # (stays from the hood to the wall)
        tube(G, M['iron'], [Vector((sx * 0.6, -br + 0.02, hz0 + 0.02)), Vector((sx * 0.62, fb - 0.01, hz0 + 0.5))], 0.006, 6)

# ================================================================ wall holes
HOLE_Z = {'A': 0.95, 'B': 0.75, 'C': 1.25}

def build_wallhole(node, style, variant, M):
    p = PIECES[node]; hw, hh = p['hole']; R = p['R']; G = S.Geo(1, 1, False, False)
    seed = {'A': 1.3, 'B': 2.7, 'C': 4.1}[variant] + len(style)
    cx, cz = random.uniform(-0.15, 0.15), HOLE_Z[variant] + hh / 2
    if style == 'concrete': return breach(G, M, hw, hh, cx, cz, seed, R)
    if style == 'attic': return boards_hole(G, M, hw, hh, cx, cz, seed, R)
    outer = jag_poly(cx, cz, hw, hh, seed, 44, 0.2)
    wall_round_hole(G, M['wall'], outer)
    poly_edge(G, M['plaster'], outer, 0.0, 0.004, plain(None))  # (the finish coat's broken edge)
    inner = inset_poly(outer, 0.03, seed, 0.02)                  # (the browning coat stands back further: broken in steps)
    n = len(outer)
    for k in range(n):
        a, b, a2, b2 = outer[k], outer[(k + 1) % n], inner[k], inner[(k + 1) % n]
        G.add(quad_bm([(a[0], 0.004, a[1]), (b[0], 0.004, b[1]), (b2[0], 0.004, b2[1]), (a2[0], 0.004, a2[1])], (0, -1, 0)), M['plaster'], plain(None), wrap=False)
    poly_edge(G, M['plaster'], inner, 0.004, 0.022, plain(None))
    # laths: horizontal strips behind the plaster, broken over the hole's middle, some hanging; keys of plaster between them
    xs = [q[0] for q in inner]; zs = [q[1] for q in inner]; lx0, lx1 = min(xs) - 0.03, max(xs) + 0.03
    rnd = random.Random(int(seed * 100)); z = min(zs) - 0.02
    while z < max(zs) + 0.02:
        lwd = 0.032; gap = rnd.uniform(0.006, 0.01)
        broken = abs(z - cz) < hh * 0.32 and rnd.random() < 0.75
        segs = [(lx0, lx1)]
        if broken:
            bx0 = cx + rnd.uniform(-hw * 0.3, -hw * 0.05); bx1 = cx + rnd.uniform(hw * 0.05, hw * 0.3); segs = [(lx0, bx0), (bx1, lx1)]
        for a, b in segs:
            if b - a < 0.04: continue
            bm = block((a, 0.022, z), (b, 0.03, z + lwd), 0.0008, 1)
            if broken:                                         # (the broken ends bent out into the room)
                end = b if a == lx0 else a; S.deform(bm, lambda c, end=end: (c.x, c.y - 0.06 * max(0.0, 1 - abs(c.x - end) / 0.12) ** 2, c.z - 0.02 * max(0.0, 1 - abs(c.x - end) / 0.12) ** 2))
            G.add(bm, M['lath'], wood_attrs((1, 0, 0), (0, -1, 0)), wrap=False)
            if rnd.random() < 0.6:                              # (keys: plaster squeezed through behind)
                for kk in range(3):
                    kx = rnd.uniform(a + 0.02, b - 0.02)
                    if inside(inner, kx, z + lwd + gap / 2): G.add(rock((kx, 0.036, z + lwd + gap / 2), (0.02, 0.008, 0.012), kx * 9, 0, 1.0), M['plaster'], plain(None), wrap=False)
        z += lwd + gap
    for xs_ in (cx - 0.2, cx + 0.2):                            # (the studs)
        if lx0 < xs_ < lx1: G.add(block((xs_ - 0.025, 0.03, cz - hh), (xs_ + 0.025, R - 0.01, cz + hh)), M['lath'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    G.add(quad_bm([(lx0, R - 0.008, cz - hh), (lx1, R - 0.008, cz - hh), (lx1, R - 0.008, cz + hh), (lx0, R - 0.008, cz + hh)], (0, -1, 0)), M['cavity'], plain(None), wrap=False)
    debris(G, M, cx, hw, ('plaster', 'lath'))
    return G

def debris(G, M, cx, hw, kinds, n=18):
    """what fell out: lumps and crumbs on the floor in front of the hole, a few long pieces, a dust heap, no more than 0.33 m out"""
    rnd = random.Random(int(cx * 1000) + n)
    bm = S.grid(cx - hw * 0.6, cx + hw * 0.6, -0.3, 0.0, 14, 8, 0.0)       # (the dust heap: a low irregular mound against the wall)
    sd = cx * 13.0
    for v in bm.verts:
        u = (v.co.x - cx) / (hw * 0.6); w_ = -v.co.y / 0.3
        edge = 1.0 - (u * u + (w_ * 1.1) ** 2) - 0.35 * mnoise.noise(Vector((v.co.x * 6 + sd, v.co.y * 6, 0.0)))
        v.co.z = 0.04 * max(0.0, edge) ** 1.3 * (1 - 0.4 * w_) - (0.002 if edge <= 0 else 0.0) + 0.003 * mnoise.noise(v.co * 40) * (edge > 0)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.z <= 0.0 for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    if bm.faces: G.add(bm, M['dust'], plain(None), smooth=True, wrap=False)
    for k in range(n):
        kind = kinds[k % len(kinds)] if k % 4 else kinds[-1]
        x = cx + rnd.gauss(0, hw * 0.35); y = -abs(rnd.gauss(0.08, 0.08)) - 0.01; y = max(y, -0.32)
        if kind in ('plaster', 'brick', 'mortar'):
            s = rnd.uniform(0.012, 0.045); bm = rock((x, y, s * 0.4), (s, s * 0.8, s * 0.7), k * 1.1, 1, 0.6); a = 0.0
        else:
            L_ = rnd.uniform(0.08, 0.3); a = rnd.uniform(0, math.pi)
            bm = block((-L_ / 2, -0.016, 0.0), (L_ / 2, 0.016, 0.007), 0.0008, 1); S.xform(bm, (0, 0, 0), (rnd.uniform(-0.2, 0.2), rnd.uniform(-0.1, 0.1), a))
            S.xform(bm, (x, y, 0.006))
        lo = min(v.co.y for v in bm.verts); hi = max(v.co.y for v in bm.verts)
        if lo < -0.33: bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -0.33 - lo, 0))   # (pushed back toward the wall)
        if hi > -0.005: bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -0.005 - hi, 0))
        G.add(bm, M[kind], attrs_of(member((1, 0, 0), (0, -1, 0))[0], rnd.random()) if kind in ('plaster', 'brick', 'mortar') else wood_attrs((math.cos(a), math.sin(a), 0), (0, 0, 1)), wrap=False)

def breach(G, M, hw, hh, cx, cz, seed, R):
    """a hole knocked through the cellar's brick: its sides show the bricks' broken ends course by course, broken bricks still jut
       into it, the back leaf behind is holed smaller (dark beyond), rubble below"""
    outer = jag_poly(cx, cz, hw, hh, seed, 40, 0.28, 2.2); wall_round_hole(G, M['wall'], outer)
    poly_edge(G, M['reveal'], outer, 0.0, 0.06, plain(None))        # (the front leaf's broken ends, coursed)
    rnd = random.Random(int(seed * 77)); bl, bh = 0.225, 0.075
    n = len(outer); ocx = sum(q[0] for q in outer) / n; ocz = sum(q[1] for q in outer) / n
    for k in range(0, n, 2):                                     # (broken bricks still jutting into the hole along its edge)
        q = outer[k]; dx, dz = ocx - q[0], ocz - q[1]; L = math.hypot(dx, dz) or 1.0
        if rnd.random() < 0.45: continue
        j = rnd.uniform(0.02, 0.07); zc = round((q[1]) / bh) * bh + bh / 2
        x0 = q[0] + dx / L * j - 0.05; x1 = q[0] + dx / L * j + 0.05
        bm = block((min(x0, x1), rnd.uniform(0.0, 0.02), zc - bh / 2 + 0.006), (max(x0, x1), rnd.uniform(0.045, 0.06), zc + bh / 2 - 0.006), 0.004, 1)
        S.deform(bm, lambda c, s_=rnd.uniform(0, 9): (c.x + 0.006 * mnoise.noise(c * 25 + Vector((s_, 0, 0))), c.y, c.z + 0.004 * mnoise.noise(c * 31 + Vector((0, s_, 0)))))
        G.add(bm, M['brick'], attrs_of(member((1, 0, 0), (0, -1, 0))[0], rnd.random()), wrap=False)
    inner = inset_poly(outer, 0.09, seed + 1, 0.05)               # (the back leaf: brick face, holed smaller)
    xs = [q[0] for q in outer]; zs = [q[1] for q in outer]; rect = (min(xs) - 0.05, max(xs) + 0.05, min(zs) - 0.05, max(zs) + 0.05)
    fill_to_rect(G, M['backleaf'], inner, rect, lambda a, b: (a, 0.06, b), (0, -1, 0))
    poly_edge(G, M['reveal'], inner, 0.06, 0.112, plain(None))
    G.add(quad_bm([(rect[0], 0.114, rect[2]), (rect[1], 0.114, rect[2]), (rect[1], 0.114, rect[3]), (rect[0], 0.114, rect[3])], (0, -1, 0)), M['cavity'], plain(None), wrap=False)
    debris(G, M, cx, hw, ('brick', 'mortar', 'brick'), 20)
    return G

def boards_hole(G, M, hw, hh, cx, cz, seed, R):
    """the attic's boarding stove in: boards broken off in splinters round the hole, the rafters and darkness of the eaves behind"""
    outer = jag_poly(cx, cz, hw, hh, seed, 40, 0.3, 2.0); wall_round_hole(G, M['wall'], outer, 0.15)
    rnd = random.Random(int(seed * 31)); bw = 0.15
    xs = [q[0] for q in outer]; zs = [q[1] for q in outer]
    x = math.floor((min(xs) - 0.15) / bw) * bw
    while x < max(xs) + 0.15:
        mx = x + bw / 2
        hits = [q[1] for q in outer if abs(q[0] - mx) < bw * 0.6]
        if hits:
            zlo, zhi = min(hits), max(hits)
            for (a, b, sgn) in ((min(zs) - 0.2, zlo, 1), (zhi, max(zs) + 0.2, -1)):
                if b - a < 0.03: continue
                bm = block((x + 0.003, 0.0, a), (x + bw - 0.003, 0.02, b), 0.001, 1)
                tip = b if sgn > 0 else a
                for v in bm.verts:                             # (splintered, bent in toward the eaves)
                    t = max(0.0, 1 - abs(v.co.z - tip) / 0.12)
                    v.co.z += sgn * rnd.uniform(-0.03, 0.05) * t * (1 if (v.co.x - x) / bw > rnd.random() else 0.3)
                    v.co.y += 0.04 * t * t
                G.add(bm, M['boards'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
        x += bw
    for xr in (cx - 0.3, cx + 0.3):                             # (rafters and a purlin behind)
        G.add(block((xr - 0.035, 0.03, cz - hh), (xr + 0.035, 0.12, cz + hh)), M['boards'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
    G.add(quad_bm([(min(xs) - 0.1, R - 0.008, min(zs) - 0.1), (max(xs) + 0.1, R - 0.008, min(zs) - 0.1), (max(xs) + 0.1, R - 0.008, max(zs) + 0.1), (min(xs) - 0.1, R - 0.008, max(zs) + 0.1)], (0, -1, 0)), M['cavity'], plain(None), wrap=False)
    debris(G, M, cx, hw, ('boards', 'boards', 'dust_lump'), 18)
    return G

# ================================================================ peeling paper and paint
def build_peel(node, style, variant, M):
    """the paper's top edge still on the wall, the sheet curling away below it (front: the style's paper where it hung; back: pasted),
       its edges torn; or flakes of paint; or split boards"""
    p = PIECES[node]; G = S.Geo(1, 1, False, False); rnd = random.Random(hash(node) & 0xffff)
    z0, z1 = p['z0'], p['z0'] + p['H']
    if style in ('concrete', 'workshop'): return paint_flakes(G, M, rnd, z0, z1, variant)
    if style == 'attic': return split_boards(G, M, rnd, z0, z1)
    w = rnd.uniform(0.4, 0.56) if variant in 'AC' else rnd.uniform(0.28, 0.42); top = rnd.uniform(1.5, 1.58); L = rnd.uniform(0.4, 0.55)
    x0 = rnd.uniform(-0.5, 0.5 - w); curl = rnd.uniform(0.018, 0.026); twist = rnd.uniform(-0.6, 0.6); lean0 = rnd.uniform(0.035, 0.05)
    nx, nz = 14, 20
    def pos(s, t):                                              # (stuck at its top, leaning out from the wall below, curled at the end)
        Lt = L * (0.8 + 0.2 * (0.5 + mnoise.noise(Vector((s * 4 + x0 * 7, 2.1, 0.0)))))       # (its bottom edge torn)
        l = t * Lt; a = Lt * (0.18 + 0.14 * s * twist + 0.05 * mnoise.noise(Vector((s * 3, 5.0, x0))))
        tip = Lt - curl * 2.6
        if l <= a: y, z = 0.0, top - l
        elif l <= tip:                                            # (the flap: bending away along a gentle arc)
            u = (l - a) / max(1e-4, tip - a); lean = lean0 * (1 + 0.4 * (s - 0.5) * twist)
            y = -lean * u ** 1.6; z = top - a - (l - a) * (1 - 0.5 * (lean * u) ** 2)
        else:                                                     # (the end rolled up toward the room)
            u = 1.0; lean = lean0 * (1 + 0.4 * (s - 0.5) * twist); yb = -lean; zb = top - a - (tip - a) * (1 - 0.5 * lean ** 2)
            th = (l - tip) / curl; y, z = yb - curl * math.sin(th) * 0.9, zb - curl * (1 - math.cos(th))
        return Vector((x0 + s * w * (1 + 0.05 * t), max(-0.074, y - 0.0015), max(z0 + 0.01, z))), (x0 + s * w, 0.0, top - l), min(min(s, 1 - s) * w, Lt - l), t
    V = [[pos(i / nx, j / nz) for i in range(nx + 1)] for j in range(nz + 1)]
    for side, mat, off in ((1, M['front'], -0.0003), (-1, M['back'], 0.0003)):
        bm = bmesh.new(); vv = [[bm.verts.new(V[j][i][0] + Vector((0, off, 0))) for i in range(nx + 1)] for j in range(nz + 1)]
        lut = {}
        for j in range(nz + 1):
            for i in range(nx + 1): lut[vv[j][i].co.to_tuple(5)] = (V[j][i][1], V[j][i][2])
        for j in range(nz):
            for i in range(nx):
                f = bm.faces.new((vv[j][i], vv[j][i + 1], vv[j + 1][i + 1], vv[j + 1][i])); f.normal_update()
                if (f.normal.y < 0) != (side > 0): f.normal_flip()
        G.add(bm, mat, attrs_of(lambda c: tuple(c), rnd.random(), ja=lambda c, lut=lut: lut.get(tuple(round(x_, 5) for x_ in c), ((0, 0, 0), 0.0))[1],
                                lp=lambda c, lut=lut: lut.get(tuple(round(x_, 5) for x_ in c), ((0, 0, 0), 0.0))[0]), smooth=True, wrap=False)
    # where it came away: bare plaster with dried paste and scraps of paper, its outline torn
    pts = [(x0 - 0.01 + w * 0.0, top - 0.02)] + [(x0 + w * k / 8, top - L * (0.95 + 0.08 * mnoise.noise(Vector((k * 0.7, x0, 1.0))))) for k in range(9)] + [(x0 + w + 0.01, top - 0.02)]
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new((px, -0.0006, pz)) for px, pz in pts]); f.normal_update()
    if f.normal.y > 0: f.normal_flip()
    bmesh.ops.triangulate(bm, faces=[f])
    G.add(bm, M['bare'], attrs_of(lambda c: tuple(c), 0.5, ja=0.05, lp=lambda c: (Vector(c).x, 0.0, Vector(c).z)), wrap=False)
    return G

def clip_half(poly, p, q):
    """the part of polygon poly nearer p than q (a Voronoi cell's cut)"""
    mx, mz = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2; nx, nz = q[0] - p[0], q[1] - p[1]; out = []
    side = lambda a: (a[0] - mx) * nx + (a[1] - mz) * nz
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]; sa, sb = side(a), side(b)
        if sa <= 0: out.append(a)
        if (sa < 0) != (sb < 0) and abs(sa - sb) > 1e-12:
            t = sa / (sa - sb); out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out

FLAKES = {      # the patch of old coat: its middle (x, z), half sizes, the flakes' spacing, how many have fallen, how many hang loose
    'A': ((-0.05, 1.0), (0.42, 0.36), 0.075, 0.28, 0.08),
    'B': ((0.08, 0.95), (0.3, 0.3), 0.062, 0.34, 0.1),
    'C': ((-0.12, 1.02), (0.22, 0.48), 0.07, 0.3, 0.06),
    'D': ((0.1, 0.9), (0.34, 0.26), 0.058, 0.42, 0.14),
}

def paint_flakes(G, M, rnd, z0, z1, variant='A'):
    """a patch of old limewash (or paint) still on the wall, crazed into irregular flakes (Voronoi cells, split a hair apart, their
       edges ragged), most stuck at their middle and cupped up at their edges (some one way more than the other), a few hanging loose
       from their top, many already fallen, more of them toward the patch's ragged edge, where the wall shows through"""
    (cx, cz), (rx, rz), sp, fall, loose = FLAKES[variant]; sd = rnd.uniform(0, 50)
    x0, x1, zb, zt = -0.56, 0.56, z0 + 0.04, z1 - 0.04
    mask = lambda x, z: 1.0 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2 + 0.55 * mnoise.noise(Vector((x * 3.5 + sd, z * 3.5, 0.0))) + 0.2 * mnoise.noise(Vector((x * 11, z * 11 + sd, 1.0)))
    seeds = []
    nz_ = int((zt - zb) / sp) + 1; nx_ = int((x1 - x0) / sp) + 1
    for j in range(nz_):
        for i in range(nx_):
            x = x0 + (i + 0.5 + rnd.uniform(-0.42, 0.42)) * sp * (1.0 if j % 2 else 1.0) + (sp * 0.5 if j % 2 else 0.0)
            z = zb + (j + 0.5 + rnd.uniform(-0.42, 0.42)) * sp * 0.82          # (a little squashed: limewash crazes along the courses)
            if x0 < x < x1 and zb < z < zt: seeds.append((x, z))
    lut = {}
    def put(bm_pts, ja_vals):
        for co, j_ in zip(bm_pts, ja_vals): lut[tuple(round(c, 5) for c in co)] = j_
    for k, sd_ in enumerate(seeds):
        m_ = mask(*sd_)
        if m_ < 0.0: continue
        clus = mnoise.noise(Vector((sd_[0] * 6 + sd, sd_[1] * 6, 3.0)))         # (they fall in clusters, and more toward the edge)
        if rnd.random() < fall * 0.55 + 0.5 * max(0.0, 0.35 - m_) + (0.45 if clus > 0.28 else 0.0): continue
        ed = max(0.0, min(1.0, 1.0 - m_ / 0.7))                                 # (0 deep in the patch .. 1 at its edge: where it lifts)
        cell = [(sd_[0] - sp * 1.5, sd_[1] - sp * 1.5), (sd_[0] + sp * 1.5, sd_[1] - sp * 1.5), (sd_[0] + sp * 1.5, sd_[1] + sp * 1.5), (sd_[0] - sp * 1.5, sd_[1] + sp * 1.5)]
        for q in seeds:
            if q is sd_ or abs(q[0] - sd_[0]) > sp * 2.2 or abs(q[1] - sd_[1]) > sp * 2.2: continue
            cell = clip_half(cell, sd_, q)
            if len(cell) < 3: break
        if len(cell) < 3: continue
        n = len(cell); ccx = sum(c[0] for c in cell) / n; ccz = sum(c[1] for c in cell) / n
        R = sum(math.hypot(c[0] - ccx, c[1] - ccz) for c in cell) / n
        edge = []                                                               # (shrunk apart, ragged: a jittered point mid-edge on long edges)
        for i in range(n):
            a, b = cell[i], cell[(i + 1) % n]
            for t in ((0.0, 0.5) if math.hypot(b[0] - a[0], b[1] - a[1]) > 0.05 else (0.0,)):
                px, pz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                dx, dz = px - ccx, pz - ccz; L = math.hypot(dx, dz) or 1.0
                g = 0.0005 + 0.003 * ed + rnd.uniform(0.0, 0.0008) + (rnd.uniform(-0.0025, 0.0025) if t else 0.0)   # (hairline where it holds, gaping where it lifts)
                edge.append((px - dx / L * g, pz - dz / L * g))
        curl = (0.0006 + 0.011 * ed ** 1.5) * rnd.uniform(0.6, 1.4)
        cdir = math.atan2(ccz - cz, ccx - cx) + rnd.uniform(-0.8, 0.8)       # (curling up on the side away from the patch's middle)
        hang = rnd.random() < loose * (0.25 + 1.5 * ed); tilt = math.radians(rnd.uniform(12, 32)) if hang else 0.0
        ztop = max(c[1] for c in edge)
        def lift(px, pz, f):                                                    # (y out from the wall for a point f of the way out)
            a = math.atan2(pz - ccz, px - ccx); y = -0.0012 - curl * f * f * (1.0 + 0.8 * math.cos(a - cdir))
            if hang: y -= (ztop - pz) * math.tan(tilt)
            return max(-0.074, y)
        bm = bmesh.new(); c0 = bm.verts.new((ccx, lift(ccx, ccz, 0.0), ccz)); m = len(edge)
        rim = [bm.verts.new((ex, lift(ex, ez, 1.0), ez)) for ex, ez in edge]
        if curl > 0.003 or hang:                                                # (a ring between, so the cup bends)
            mid = [bm.verts.new(((ccx + (ex - ccx) * 0.55), lift(ccx + (ex - ccx) * 0.55, ccz + (ez - ccz) * 0.55, 0.55), ccz + (ez - ccz) * 0.55)) for ex, ez in edge]
            fs = [bm.faces.new((c0, mid[i], mid[(i + 1) % m])) for i in range(m)] + [bm.faces.new((mid[i], rim[i], rim[(i + 1) % m], mid[(i + 1) % m])) for i in range(m)]
            put([c0.co] + [v.co for v in mid] + [v.co for v in rim], [R] + [0.45 * R] * m + [0.0] * m)
        else:
            fs = [bm.faces.new((c0, rim[i], rim[(i + 1) % m])) for i in range(m)]
            put([c0.co] + [v.co for v in rim], [R] + [0.0] * m)
        for f in fs:
            f.normal_update()
            if f.normal.y > 0: f.normal_flip()
        G.add(bm, M['front'], attrs_of(lambda c: tuple(c), rnd.random(), ja=lambda c: lut.get(tuple(round(x_, 5) for x_ in c), 0.0),
                                       lp=lambda c: (Vector(c).x, 0.0, Vector(c).z)), smooth=True, wrap=False)
    return G

def split_boards(G, M, rnd, z0, z1):
    """two or three boards split along the grain, the split pieces warped out from the wall"""
    x = rnd.uniform(-0.45, -0.1)
    for k in range(rnd.randint(2, 3)):
        w = rnd.uniform(0.04, 0.08); za, zb = rnd.uniform(z0 + 0.05, z0 + 0.3), rnd.uniform(z1 - 0.3, z1 - 0.05)
        bm = block((x, -0.018, za), (x + w, 0.0, zb), 0.001, 1)
        for kk in range(1, 12):
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, za + (zb - za) * kk / 12), plane_no=(0, 0, 1))
        bow = rnd.uniform(0.035, 0.055)
        for v in bm.verts:
            t = min(1.0, max(0.0, (v.co.z - za) / (zb - za))); v.co.y -= bow * math.sin(math.pi * t) ** 1.5
        G.add(bm, M['front'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)
        x += w + rnd.uniform(0.04, 0.2)
    return G

# ================================================================ the niche
def build_niche(style, M):
    """an arched niche in the wall: a shell hood in its half dome, the walls painted stone, a moulded architrave with a keystone, a
       marble shelf, and in it a porcelain figure of a girl with a lamb, crazed, one hand missing"""
    p = PIECES['Mod_niche_' + style]; nw, nh, nd = p['niche']; G = S.Geo(1, 1, False, False)
    z0 = 1.05; r = nw / 2; zs = z0 + nh - r                     # (the springing of the arch)
    n = 20
    outline = [(-r, z0)] + [(r * math.cos(math.pi * (1 - k / n)), zs + r * math.sin(math.pi * (1 - k / n))) for k in range(n + 1)] + [(r, z0)]
    rect = (-r - 0.12, r + 0.12, z0 - 0.12, z0 + nh + 0.12)
    wall_face(G, M['wall'], rect)
    fill_to_rect(G, M['wall'], outline, rect, lambda a, b: (a, 0.0, b), (0, -1, 0))
    # its walls (a half cylinder below the springing) and the shell hood (a quarter sphere, fluted)
    m_ = 16
    for k in range(m_):
        a0, a1 = math.pi * k / m_, math.pi * (k + 1) / m_
        q = [(-r * math.cos(a0), nd * math.sin(a0) * 0.0 + r * math.sin(a0) * (nd / r), z0), (-r * math.cos(a1), r * math.sin(a1) * (nd / r), z0),
             (-r * math.cos(a1), r * math.sin(a1) * (nd / r), zs), (-r * math.cos(a0), r * math.sin(a0) * (nd / r), zs)]
        G.add(quad_bm(q, (r * math.cos((a0 + a1) / 2), -math.sin((a0 + a1) / 2), 0)), M['stone'], plain(None), smooth=True, wrap=False)
    rows = 8
    for i in range(rows):
        for k in range(m_):
            def P_(ii, kk):
                ph = (math.pi / 2) * ii / rows; a = math.pi * kk / m_
                fl = 1.0 - 0.06 * abs(math.sin(a * 6)) * (ii / rows)       # (the shell's flutes, deepening toward its rim)
                return Vector((-r * math.cos(a) * math.cos(ph) * fl, r * math.sin(a) * math.cos(ph) * (nd / r) * fl, zs + r * math.sin(ph)))
            q = [P_(i, k), P_(i, k + 1), P_(i + 1, k + 1), P_(i + 1, k)]
            mid = sum(q, Vector()) / 4
            G.add(quad_bm(q, Vector((0, 0, zs)) - mid + Vector((0, 0, 0))), M['stone'], plain(None), smooth=True, wrap=False)
    # the shelf (marble), the architrave round the arch with its keystone
    G.add(block((-r - 0.06, -0.045, z0 - 0.04), (r + 0.06, nd * 0.95, z0), 0.006, 2), M['marble'], wood_attrs((1, 0, 0), (0, 0, 1)), wrap=False)
    prof = [(0, 0), (0, 0.01), (0.006, 0.016), (0.03, 0.018), (0.034, 0.024), (0.05, 0.026), (0.055, 0.02), (0.06, 0.0)]
    def arch_pts(w):
        return [(-r - w, z0)] + [((r + w) * math.cos(math.pi * (1 - k / n)), zs + (r + w) * math.sin(math.pi * (1 - k / n))) for k in range(n + 1)] + [(r + w, z0)]
    for i in range(len(prof) - 1):
        (w0, h0), (w1, h1) = prof[i], prof[i + 1]; pa, pb = arch_pts(w0), arch_pts(w1)
        bm = bmesh.new(); va = [bm.verts.new((x, -h0, z)) for x, z in pa]; vb = [bm.verts.new((x, -h1, z)) for x, z in pb]
        for k in range(len(va) - 1):
            f = bm.faces.new((va[k], va[k + 1], vb[k + 1], vb[k])); f.normal_update()
            mx, mz = (pa[k][0] + pa[k + 1][0]) / 2, (pa[k][1] + pa[k + 1][1]) / 2
            out = Vector((mx, 0, mz - zs)).normalized() if mz > zs + 1e-4 else Vector((math.copysign(1, mx), 0, 0))
            if f.normal.dot(seg_hint(prof[i], prof[i + 1], out, Vector((0, -1, 0)))) < 0: f.normal_flip()
        G.add(bm, M['stone'], wood_attrs((1, 0, 0), (0, -1, 0)), smooth=True, wrap=False)
    G.add(block((-0.035, -0.04, zs + r - 0.02), (0.035, 0.0, zs + r + 0.1), 0.004, 2), M['stone'], wood_attrs((0, 0, 1), (0, -1, 0)), wrap=False)   # (keystone)
    figure(G, M, (0.0, nd * 0.45, z0))
    return G

def figure(G, M, base):
    """a porcelain figure 0.34 m tall: a girl in a bonnet and long dress holding a lamb, on a round gilded base"""
    bx, by, bz = base; B = Vector(base); P = lambda x, y, z: B + Vector((x, y, z))
    G.add(lathe_bm([(0.0, 0.06), (0.3, 0.062), (0.6, 0.058), (1.0, 0.05)], P(0, 0, 0), P(0, 0, 0.025), 20, (False, True)), M['porcelain'], attrs_of(lambda c: tuple(c), 0.5, lp=(0.0, 0.0, 0.0)), smooth=True, wrap=False)
    dress = [(0.0, 0.05), (0.15, 0.048), (0.35, 0.04), (0.55, 0.03), (0.7, 0.024), (0.8, 0.02), (0.88, 0.024), (0.95, 0.022), (1.0, 0.012)]
    G.add(lathe_bm(dress, P(0, 0, 0.025), P(0, 0, 0.255), 18, (False, False)), M['porcelain'], attrs_of(lambda c: tuple(c), 0.5, lp=(1.0, 0.0, 0.0)), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.006), (0.4, 0.007), (1.0, 0.006)], P(0, 0, 0.25), P(0, 0, 0.27), 10, (False, False)), M['porcelain'], attrs_of(lambda c: tuple(c), 0.5, lp=(2.0, 0.0, 0.0)), smooth=True, wrap=False)
    head = [(0.0, 0.0), (0.12, 0.016), (0.35, 0.023), (0.6, 0.024), (0.85, 0.018), (1.0, 0.0)]
    hc = P(0, -0.003, 0.268)
    G.add(lathe_bm(head, hc, hc + Vector((0, -0.004, 0.052)), 16, (False, False)), M['porcelain'], attrs_of(lambda c: tuple(c), 0.5, lp=(lambda c, hc=hc: (3.0, (Vector(c) - hc).x, (Vector(c) - hc).z))), smooth=True, wrap=False)
    bonnet = [(0.0, 0.034), (0.15, 0.036), (0.5, 0.032), (0.85, 0.022), (1.0, 0.0)]
    G.add(lathe_bm(bonnet, hc + Vector((0, 0.012, 0.02)), hc + Vector((0, 0.03, 0.065)), 16, (True, False)), M['porcelain'], attrs_of(lambda c: tuple(c), 0.5, lp=(4.0, 0.0, 0.0)), smooth=True, wrap=False)
    for sx in (-1, 1):                                          # (arms round the lamb; the right hand broken off)
        tube(G, M['porcelain'], [P(sx * 0.024, -0.004, 0.245), P(sx * 0.03, -0.022, 0.2), P(sx * 0.012, -0.034, 0.18 if sx < 0 else 0.19)], 0.007, 8, attrs_of(lambda c: tuple(c), 0.5, lp=(5.0, 0.0, 0.0)))
    lamb = [(0.0, 0.0), (0.2, 0.017), (0.5, 0.022), (0.8, 0.017), (1.0, 0.0)]
    G.add(lathe_bm(lamb, P(-0.04, -0.038, 0.185), P(0.04, -0.038, 0.19), 12, (False, False)), M['porcelain'], attrs_of(lambda c: tuple(c), 0.5, lp=(6.0, 0.0, 0.0)), smooth=True, wrap=False)
    G.add(lathe_bm([(0.0, 0.0), (0.4, 0.011), (1.0, 0.0)], P(0.035, -0.04, 0.2), P(0.06, -0.045, 0.21), 10, (False, False)), M['porcelain'], attrs_of(lambda c: tuple(c), 0.5, lp=(6.0, 0.0, 0.0)), smooth=True, wrap=False)

def porcelain_fig(name):
    """glazed porcelain, hand-painted: a pale blue dress with a gilt hem, a white lamb, flesh, rosy cheeks, two dark eyes and a red
       mouth; the glaze crazed and the craze lines dirty, dust on everything that faces up, a chip on the base"""
    m = kitlib.Mat(name); lp = m.attr('lp', True); op = m.attr('opos', True); part, hx, hz = sep(m, lp); x, y, z = sep(m, op)
    is_ = lambda k: m.math('MULTIPLY', m.remap(part, k - 0.5, k - 0.4), m.remap(part, k + 0.5, k + 0.4))
    col = m.mix(is_(1.0), lin('#f2eee6'), lin('#9fb6c8'))      # (the dress)
    col = m.mix(m.math('MULTIPLY', is_(1.0), m.remap(z, 1.085, 1.08)), col, lin('#c8a24a'))
    col = m.mix(m.math('ADD', is_(2.0), is_(3.0)), col, lin('#efd6c4'))   # (flesh)
    col = m.mix(is_(4.0), col, lin('#efe8dc')); col = m.mix(is_(0.0), col, lin('#f0ece2'))
    col = m.mix(m.math('MULTIPLY', is_(0.0), m.remap(z, 1.074, 1.071)), col, lin('#c4a046'))
    face = is_(3.0)
    for ex in (-0.008, 0.008):                                  # (eyes, cheeks, mouth: painted on the face's front)
        d = m.math('SQRT', m.math('ADD', m.math('POWER', m.math('SUBTRACT', hx, ex), 2.0), m.math('POWER', m.math('SUBTRACT', hz, 0.03), 2.0)))
        col = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', face, m.remap(d, 0.0032, 0.0022)), m.remap(y, -0.04, -0.03) if False else 1.0), col, lin('#1a1412'))
        dc = m.math('SQRT', m.math('ADD', m.math('POWER', m.math('SUBTRACT', hx, ex * 1.4), 2.0), m.math('POWER', m.math('SUBTRACT', hz, 0.02), 2.0)))
        col = m.mix(m.math('MULTIPLY', m.math('MULTIPLY', face, m.remap(dc, 0.008, 0.002)), 0.5), col, lin('#d98a88'))
    dm = m.math('SQRT', m.math('ADD', m.math('POWER', hx, 2.0), m.math('POWER', m.math('SUBTRACT', hz, 0.014), 2.0)))
    col = m.mix(m.math('MULTIPLY', face, m.remap(dm, 0.003, 0.0018)), col, lin('#a83232'))
    crz = m.math('MULTIPLY', m.remap(m.voronoi(op, 260, 'Distance', 'DISTANCE_TO_EDGE'), 0.025, 0.0), 0.6); col = m.mix(crz, col, (0.3, 0.26, 0.2))
    up = m.remap(sep(m, m.geo('Normal'))[2], 0.4, 0.95, smooth=True); dust = m.math('MULTIPLY', up, m.remap(m.noise(op, 60, 3), 0.3, 0.7, 0.3, 0.8))
    col = m.mix(dust, col, lin('#9a948a'))
    gilt = m.math('MULTIPLY', m.math('ADD', m.math('MULTIPLY', is_(1.0), m.remap(z, 1.085, 1.08)), m.math('MULTIPLY', is_(0.0), m.remap(z, 1.074, 1.071))), 0.9)
    return finish(m, col, m.mixf(dust, m.mixf(crz, 0.1, 0.4), 0.9), m.math('MULTIPLY', crz, -0.00003), gilt)

# ================================================================ ceiling pieces
def build_rose(node, M):
    """a plaster ceiling rose: a ring of acanthus leaves round a domed boss and its hook, beads, a cavetto to the ceiling; or a
       coffered surround (applied beams, mitred) with a smaller rose in it"""
    p = PIECES[node]; G = S.Geo(1, 1, False, False)
    def rose(R0, depth, nr=20, na=72):
        def h(rr, a):                                           # (the profile: how far it hangs below the ceiling at radius rr)
            t = rr / R0
            base = depth * (0.12 + 0.18 * (1 - t))
            if t > 0.92: base = depth * 0.12 * (1 - (t - 0.92) / 0.08)
            bead = depth * 0.12 * math.exp(-((t - 0.86) / 0.035) ** 2)
            leaf = depth * 0.5 * max(0.0, math.cos(min(math.pi / 2, abs(((a * 12 / (2 * math.pi)) % 1) - 0.5) * math.pi * 1.4))) * math.exp(-((t - 0.6) / 0.17) ** 2)
            boss = depth * 0.8 * max(0.0, 1 - (t / 0.24) ** 2) ** 0.6
            return -(base + bead + leaf + boss)
        rows = []
        for i in range(nr + 1):
            q_ = i / nr; rr = R0 * (0.55 * q_ ** 0.7 + 0.45 * (0.5 - 0.5 * math.cos(math.pi * q_))); rows.append([Vector((max(rr, 1e-4) * math.cos(2 * math.pi * k / na), max(rr, 1e-4) * math.sin(2 * math.pi * k / na), h(rr, 2 * math.pi * k / na))) for k in range(na)])
        bm = bmesh.new(); V = [[bm.verts.new(p_) for p_ in row] for row in rows]
        for i in range(nr):
            for k in range(na):
                bm.faces.new((V[i][k], V[i + 1][k], V[i + 1][(k + 1) % na], V[i][(k + 1) % na]))
        bm.normal_update()
        if sum(f.normal.z for f in bm.faces) > 0:
            for f in bm.faces: f.normal_flip()
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        return bm
    if node == 'Band_ceilingrose':
        G.add(rose(0.3, 0.078), M['plaster'], plain(None), smooth=True, wrap=False)
        G.add(lathe_bm([(0.0, 0.006), (1.0, 0.004)], (0, 0, -0.07), (0, 0, -0.078), 8), M['iron'], metal_attrs(), wrap=False)   # (the hook)
        return G
    W2 = p['W'] / 2; d = p['H']
    prof = [(0.0, 0.0), (0.0, 0.06), (0.012, 0.075), (0.03, 0.09), (0.05, 0.1), (0.07, 0.13), (0.09, 0.145), (0.13, 0.148), (0.15, 0.12), (0.16, 0.08), (0.17, 0.03), (0.18, 0.0)]   # (w out, depth down)
    for k, (ex, ey) in enumerate(((1, 0), (0, 1), (-1, 0), (0, -1))):   # (four mitred beams of the surround)
        R_, Hs = [], []
        for j, (w, hz) in enumerate(prof):
            a = W2 - 0.18 + w
            if ex: pa, pb = Vector((ex * a, -a, -hz)), Vector((ex * a, a, -hz))
            else: pa, pb = Vector((a, ey * a, -hz)), Vector((-a, ey * a, -hz))
            R_.append([pa, pb])
        for j in range(len(prof) - 1):
            Hs.append(seg_hint(prof[j], prof[j + 1], Vector((ex, ey, 0)), Vector((0, 0, -1))))
        G.add(strip(R_, Hs), M['plaster'], wood_attrs((abs(ey), abs(ex), 0), (0, 0, -1)), smooth=True, wrap=False)
    G.add(rose(0.24, 0.07), M['plaster'], plain(None), smooth=True, wrap=False)
    return G

def build_ceilhole(style, M):
    """a hole in the ceiling: the tile's ceiling (its own texture), broken plaster round a ragged hole, the laths above hanging down
       (no lower than 0.30 m below), joists and the boards of the floor above, dark"""
    G = S.Geo(1, 1, False, False); rnd = random.Random(len(style) * 13)
    hw, hh = 1.0, 0.8; cx, cy = rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2)
    poly = jag_poly(cx, cy, hw, hh, 3.3 + len(style), 44, 0.25)
    # the ceiling round it (z = 0, facing down): quads from the hole out to the tile's edge
    half = FW / 2
    n = len(poly); cxm = sum(q[0] for q in poly) / n; cym = sum(q[1] for q in poly) / n
    def to_edge(q):
        dx, dy = q[0] - cxm, q[1] - cym; t = min((half - cxm) / dx if dx > 0 else (-half - cxm) / dx if dx < 0 else 1e9, (half - cym) / dy if dy > 0 else (-half - cym) / dy if dy < 0 else 1e9)
        return (cxm + dx * t, cym + dy * t)
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]; A, B = to_edge(a), to_edge(b)
        corners = [c for c in ((-half, -half), (half, -half), (half, half), (-half, half))
                   if 0 < (math.atan2(c[1] - cym, c[0] - cxm) - math.atan2(A[1] - cym, A[0] - cxm)) % (2 * math.pi) < (math.atan2(B[1] - cym, B[0] - cxm) - math.atan2(A[1] - cym, A[0] - cxm)) % (2 * math.pi)]
        P = [a, A] + corners + [B, b]
        bm = bmesh.new(); f = bm.faces.new([bm.verts.new((q[0], q[1], 0.0)) for q in P]); f.normal_update()
        if f.normal.z > 0: f.normal_flip()
        if len(P) > 4: bmesh.ops.triangulate(bm, faces=[f])
        G.add(bm, M['ceiling'], plain(None), wrap=False)
    for k in range(n):                                          # (the plaster's broken edge, its thickness)
        a, b = poly[k], poly[(k + 1) % n]; mid = Vector(((a[0] + b[0]) / 2 - cxm, (a[1] + b[1]) / 2 - cym, 0))
        G.add(quad_bm([(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], 0.022), (a[0], a[1], 0.022)], -mid), M['plaster'], plain(None), wrap=False)
    above = 0.25
    px0, px1 = max(-1.1, min(q[0] for q in poly) - 0.15), min(1.1, max(q[0] for q in poly) + 0.15)   # (seen only through the hole)
    py0, py1 = max(-1.1, min(q[1] for q in poly) - 0.15), min(1.1, max(q[1] for q in poly) + 0.15)
    if style == 'concrete':                                     # (a slab: broken concrete, rusted rebar hanging)
        for k in range(n):
            a, b = poly[k], poly[(k + 1) % n]; mid = Vector(((a[0] + b[0]) / 2 - cxm, (a[1] + b[1]) / 2 - cym, 0))
            G.add(quad_bm([(a[0], a[1], 0.022), (b[0], b[1], 0.022), (b[0], b[1], 0.15), (a[0], a[1], 0.15)], -mid), M['concrete'], plain(None), wrap=False)
        for i in range(-4, 5):
            x = cx + i * 0.12
            if not (px0 < x < px1): continue
            pts = [Vector((x, cy - hh * 0.7, 0.12))] + [Vector((x + 0.01 * math.sin(t * 3), cy - hh * 0.7 + t * hh * 0.6, 0.12 - 0.22 * math.sin(math.pi * t) * (0.5 + 0.5 * math.sin(i)))) for t in (k / 6 for k in range(1, 7))]
            tube(G, M['iron'], pts, 0.005, 6)
        G.add(quad_bm([(px0, py0, 0.3), (px1, py0, 0.3), (px1, py1, 0.3), (px0, py1, 0.3)], (0, 0, -1)), M['cavity'], plain(None), wrap=False)
    else:
        for i in range(-3, 4):                                  # (joists across, the boards of the floor above on them)
            y = cy + i * 0.4
            if py0 + 0.03 < y < py1 - 0.03: G.add(block((px0, y - 0.025, 0.03), (px1, y + 0.025, above), 0.003, 1), M['lath'], wood_attrs((1, 0, 0), (0, 0, -1)), wrap=False)
        for j in range(-7, 8):
            x = cx + j * 0.15
            if px0 + 0.073 <= x <= px1 - 0.073: G.add(block((x - 0.073, py0, above), (x + 0.073, py1, above + 0.022), 0.002, 1), M['lath'], wood_attrs((0, 1, 0), (0, 0, -1)), wrap=False)
        xs = [q[0] for q in poly]; z = 0.024; y = min(q[1] for q in poly) - 0.04
        while y < max(q[1] for q in poly) + 0.04:               # (the laths: along x, broken over the hole, some hanging down)
            hang = abs(y - cy) < hh * 0.3 and rnd.random() < 0.5
            if hang:
                L_ = rnd.uniform(0.2, 0.45); x0 = cx + rnd.uniform(-0.3, 0.2)
                bm = block((x0, y, z), (x0 + L_, y + 0.032, z + 0.008), 0.0008, 1)
                ang = rnd.uniform(0.4, 0.75); S.xform(bm, (-x0, 0, -z)); S.xform(bm, (0, 0, 0), (0, ang, 0)); S.xform(bm, (x0, 0, z))
                for v in bm.verts: v.co.z = max(v.co.z, -0.29)
                G.add(bm, M['lath'], wood_attrs((math.cos(ang), 0, -math.sin(ang)), (0, 0, -1)), wrap=False)
            else:
                for a, b in ((min(xs) - 0.05, cx - rnd.uniform(0.1, 0.3)), (cx + rnd.uniform(0.1, 0.3), max(xs) + 0.05)):
                    G.add(block((a, y, z), (b, y + 0.032, z + 0.008), 0.0008, 1), M['lath'], wood_attrs((1, 0, 0), (0, 0, -1)), wrap=False)
            y += 0.04
        for k in range(14):                                     # (plaster dangling on hair and lath)
            x = cx + rnd.uniform(-hw * 0.38, hw * 0.38); y = cy + rnd.uniform(-hh * 0.38, hh * 0.38); s_ = rnd.uniform(0.012, 0.03)
            G.add(rock((x, y, -rnd.uniform(0.02, 0.16)), (s_, s_ * 0.8, s_ * 0.45), k * 2.1, 1, 1.0), M['coat'], plain(None), smooth=True, wrap=False)
    return G

def build_skylight(style, M):
    """a skylight in place of a ceiling tile: the ceiling round a square opening (its own texture), the shaft lined with boards up
       0.6 m, the light at the top (a cast-iron roof light; workshop: a sawtooth north light, glazed on its steep side), glass, sky"""
    G = S.Geo(1, 1, False, False); half = FW / 2; o = 0.6; top = 0.54
    for (a, b, c, d) in ((-half, -o, -half, half), (o, half, -half, half), (-o, o, -half, -o), (-o, o, o, half)):
        G.add(quad_bm([(a, c, 0.0), (b, c, 0.0), (b, d, 0.0), (a, d, 0.0)], (0, 0, -1)), M['ceiling'], plain(None), wrap=False)
    z_lo = top - 0.35
    for (p0, p1, n) in (((-o, -o), (o, -o), (0, 1, 0)), ((o, -o), (o, o), (-1, 0, 0)), ((o, o), (-o, o), (0, -1, 0)), ((-o, o), (-o, -o), (1, 0, 0))):
        zt = z_lo if (style == 'workshop' and n == (0, -1, 0)) else top
        G.add(quad_bm([(p0[0], p0[1], 0.0), (p1[0], p1[1], 0.0), (p1[0], p1[1], zt), (p0[0], p0[1], zt)], n), M['lining'], wood_attrs((0, 0, 1), (-n[0], -n[1], 0)), wrap=False)
    sk = M['sky']
    if style == 'workshop':
        G.add(quad_bm([(-o, o, top), (o, o, top), (o, -o, z_lo), (-o, -o, z_lo)], (0, -0.5, -1)), M['lining'], wood_attrs((1, 0, 0), (0, 0, -1)), wrap=False)   # (the roof's underside, down from the ridge)
        for k in range(5):
            x = -o + 2 * o * k / 4
            G.add(block((x - 0.012, o - 0.02, z_lo - 0.02), (x + 0.012, o + 0.0, top), 0.002, 1), M['steel'], metal_attrs(), wrap=False)
        Wn.pane(G, M['glass'], -o, o, z_lo, top, o - 0.01)
        G.add(quad_bm([(-o, o + 0.06, z_lo - 0.05), (o, o + 0.06, z_lo - 0.05), (o, o + 0.06, top + 0.05), (-o, o + 0.06, top + 0.05)], (0, -1, 0)), sk, plain(None), wrap=False)
        return G
    # a cast-iron roof light: its frame on the shaft's top, four lights, the glass sloping a little, the sky above
    G.add(block((-o, -o, top), (o, -o + 0.05, top + 0.04), 0.003, 1), M['iron'], metal_attrs(), wrap=False)
    G.add(block((-o, o - 0.05, top), (o, o, top + 0.04), 0.003, 1), M['iron'], metal_attrs(), wrap=False)
    G.add(block((-o, -o, top), (-o + 0.05, o, top + 0.04), 0.003, 1), M['iron'], metal_attrs(), wrap=False)
    G.add(block((o - 0.05, -o, top), (o, o, top + 0.04), 0.003, 1), M['iron'], metal_attrs(), wrap=False)
    for x in (-o / 2, 0.0, o / 2):
        G.add(block((x - 0.015, -o, top), (x + 0.015, o, top + 0.035), 0.002, 1), M['iron'], metal_attrs(), wrap=False)
    gl = bmesh.new(); vs = [gl.verts.new((-o, -o, top + 0.03)), gl.verts.new((o, -o, top + 0.03)), gl.verts.new((o, o, top + 0.03)), gl.verts.new((-o, o, top + 0.03))]
    f = gl.faces.new(vs); f.normal_update()
    if f.normal.z > 0: f.normal_flip()
    G.add(gl, M['glass'], plain(None), wrap=False)
    G.add(quad_bm([(-o, -o, top + 0.06), (o, -o, top + 0.06), (o, o, top + 0.06), (-o, o, top + 0.06)], (0, 0, -1)), sk, plain(None), wrap=False)
    for k in range(6):                                          # (leaves and grime lying on the glass, seen against the sky)
        x, y = random.uniform(-o + 0.1, o - 0.1), random.uniform(-o + 0.1, o - 0.1); r = random.uniform(0.03, 0.06)
        bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=7, radius=r); S.xform(bm, (x, y, top + 0.036))
        for fc in bm.faces:
            fc.normal_update()
            if fc.normal.z > 0: fc.normal_flip()
        G.add(bm, M['leaves'], attrs_of(lambda c: tuple(c), random.random()), wrap=False)
    return G

def build_ladder(M):
    """a loft hatch in the ceiling with the ladder folded up inside: the trim round it, the hatch boarded, its hinges and the pull
       ring on a cord, a strip of the ladder's last tread showing at the gap"""
    p = PIECES['Band_attic_ladder']; G = S.Geo(1, 1, False, False); w2, l2 = p['W'] / 2 - 0.05, p['D'] / 2 - 0.05   # (the opening; its trim reaches the footprint)
    tr = [(0, 0), (0, 0.012), (0.004, 0.018), (0.04, 0.02), (0.045, 0.015), (0.05, 0.0)]      # (w out, depth down)
    for k, (ex, ey) in enumerate(((1, 0), (0, 1), (-1, 0), (0, -1))):
        R_, Hs = [], []
        for j, (w, hz) in enumerate(tr):
            if ex: a = w2 + w; pa, pb = Vector((ex * a, -(l2 + w), -hz)), Vector((ex * a, l2 + w, -hz))
            else: a = l2 + w; pa, pb = Vector((w2 + w, ey * a, -hz)), Vector((-(w2 + w), ey * a, -hz))
            R_.append([pa, pb])
        Hs = [seg_hint(tr[j], tr[j + 1], Vector((ex, ey, 0)), Vector((0, 0, -1))) for j in range(len(tr) - 1)]
        G.add(strip(R_, Hs), M['wood'], wood_attrs((0, 1, 0) if ex else (1, 0, 0), (0, 0, -1)), smooth=True, wrap=False)
    for i in range(5):                                          # (the hatch: boards across, a little below the ceiling)
        x0 = -w2 + 0.004 + i * (2 * w2 - 0.008) / 5; x1 = x0 + (2 * w2 - 0.008) / 5 - 0.003
        G.add(block((x0, -l2 + 0.004, -0.008), (x1, l2 - 0.004, 0.012), 0.0015, 1), M['wood'], wood_attrs((0, 1, 0), (0, 0, -1)), wrap=False)
    for y in (-l2 + 0.15, l2 - 0.15):
        G.add(block((-w2 + 0.02, y - 0.015, -0.011), (-w2 + 0.3, y + 0.015, -0.008), 0.001, 1), M['iron'], metal_attrs(), wrap=False)   # (the hinges' straps)
    G.add(lathe_bm([(0.0, 0.012), (1.0, 0.01)], (w2 - 0.08, 0.0, -0.008), (w2 - 0.08, 0.0, -0.018), 10), M['iron'], metal_attrs(), wrap=False)   # (the ring's plate)
    ringp = [Vector((w2 - 0.08 + 0.025 * math.sin(2 * math.pi * k / 14), 0.0, -0.045 - 0.025 * math.cos(2 * math.pi * k / 14))) for k in range(15)]
    tube(G, M['iron'], ringp, 0.004, 6)
    tube(G, M['cord'], [Vector((w2 - 0.08, 0.0, -0.018)), Vector((w2 - 0.08, 0.0, -0.02))], 0.003, 6)
    return G

# ================================================================ materials per piece
def materials(group, style):
    k = f'{group}_{style}'
    M = {'glass': kitlib.glass(), 'wall': kitlib.reserved('WallSurface', (0.55, 0.5, 0.45)), 'sky': kitlib.reserved('SkyPlane', (0.1, 0.12, 0.18)),
         'emit': kitlib.reserved('Emit', (1.0, 0.2, 0.2), emit=True),
         'brass': kitlib.metal(k + '_brass', 'brass', color='#9a7a45', rust=0.0, age=1.3), 'iron': kitlib.metal(k + '_iron', 'iron', rust=0.7, age=1.4),
         'steel': kitlib.metal(k + '_steel', 'steel', rust=0.2, age=1.2), 'wire': kitlib.metal(k + '_wire', 'steel', color='#555758', rust=0.3),
         'void': kitlib.grey(k + '_void', (0.008, 0.006, 0.005))}
    if group == 'exit':
        E = EXIT[style]
        M['frame'] = (Dr.paint(k + '_frame', E['paint'], 'pine', [], kick=0.3, chips=1.4, gloss=0.35, age=1.5) if E['paint'] else Dr.bare_boards(k + '_frame', 'deal', [], 1.5, tone=0.62))
        M['leafm'] = (Dr.paint(k + '_leaf', E['paint'], 'steel' if E['leaf'] == 'steel' else 'pine', [], kick=0.35, chips=1.2, gloss=0.3, age=1.5, joints=E['leaf'] != 'steel', rust=0.5 if E['leaf'] == 'steel' else 0.0,
                               edges=('box', 0.0, 1.15, 0.0, 2.3)) if E['paint'] else Dr.bare_boards(k + '_leaf', 'deal', [], 1.6, tone=0.62))
        M['wood'] = M['leafm']; M['sill'] = kitlib.wood(k + '_sill', 'oak', 'bare', age=1.6)
        M['porch_floor'] = {'flags': stone_flags, 'quarry': lambda n: quarry(n, '#7a2e22', '#d9d0bc'), 'concrete': lambda n: stone_flags(n, '#86827a'), 'boards': lambda n: Dr.bare_boards(n, 'deal', [], 1.8, tone=0.7)}[E['floor']](k + '_porchf')
        M['porch_wall'] = brick_body(k + '_porchw') if style != 'attic' else Dr.bare_boards(k + '_porchw', 'deal', [], 1.8, tone=0.6)
        M['coir'] = coir(k + '_coir'); M['leaves'] = leaves_mat(k + '_leaves')
        M['board'] = Dr.bare_boards(k + '_board', 'deal', [], 1.7); M['chain'] = kitlib.metal(k + '_chain', 'iron', rust=0.9, age=1.5)
    elif group == 'fireplace':
        M['soot'] = soot_brick(k + '_soot'); M['iron'] = cast_iron(k + '_castiron', 0.4, 0.4); M['coal'] = kitlib.metal(k + '_coal', 'iron', color='#121110', rust=0.0)
        if style == 'wood':
            M['frame'] = Dr.paint(k + '_paint', ['#d9cfb6', '#6f7d5f', '#8a5a3c'], 'pine', [], kick=0.3, chips=1.0, gloss=0.3, age=1.4, joints=False)
            M['tiles'] = printed_tiles(k + '_tiles'); M['hearth'] = quarry(k + '_hearth')
        elif style == 'tile':
            M['frame'] = marble(k + '_marble'); M['hearth'] = marble(k + '_hearthm', '#2a2826', '#8a8680', dark=True)
        else:
            M['brick'] = brick_body(k + '_brick'); M['hood'] = Dr.paint(k + '_hood', ['#2c2e2c', '#6a3a24', '#6a3a24'], 'steel', [], kick=0.0, chips=0.8, gloss=0.4, age=1.6, craze=0.2, joints=False, rust=1.0)
    elif group == 'wallhole':
        M['plaster'] = plaster_coats(k + '_plaster'); M['lath'] = Dr.bare_boards(k + '_lath', 'deal', [], 1.7); M['cavity'] = soot_brick(k + '_cavity')
        M['dust'] = dust_mat(k + '_dust'); M['brick'] = brick_body(k + '_brick'); M['mortar'] = plaster_coats(k + '_mortar', '#b8b0a0', '#8f8676')
        M['boards'] = Dr.bare_boards(k + '_boards', 'deal', [], 1.6, tone=0.62); M['dust_lump'] = M['dust']   # (the attic's wall boards round a hole)
        M['reveal'] = brick_coursed(k + '_reveal', ends=True); M['backleaf'] = brick_coursed(k + '_backleaf')
    elif group == 'peel':
        if style in ('wood', 'tile'): M['front'] = wall_tex_mat(k + '_front', style); M['back'] = paper_back(k + '_back'); M['bare'] = bare_plaster(k + '_bare')
        elif style == 'attic': M['front'] = Dr.bare_boards(k + '_front', 'deal', [], 1.8, tone=0.6); M['back'] = M['front']   # (as dark as the attic's wall boards)
        elif style == 'concrete': M['front'] = limewash_coat(k + '_front'); M['back'] = M['front']                       # (limewash flakes)
        else: M['front'] = wall_tex_mat(k + '_front', style); M['back'] = plaster_coats(k + '_back', '#c9c2b2', '#9b9282')
    elif group == 'niche':
        M['stone'] = plaster_paint(k + '_stone', '#d8ccb2'); M['marble'] = marble(k + '_marble'); M['porcelain'] = porcelain_fig(k + '_porcelain')
    elif group == 'ceiling':
        M['plaster'] = plaster_paint(k + '_plaster', '#e2dccb', soot=0.5); M['lath'] = Dr.bare_boards(k + '_lath', 'deal', [], 1.8)
        M['cavity'] = soot_brick(k + '_cavity'); M['concrete'] = plaster_coats(k + '_concrete', '#8a867e', '#77736b'); M['coat'] = plaster_coats(k + '_coat', '#a08f76', '#9b8a72')   # (broken lumps: the brown coat, grey with dust)
        M['lining'] = Dr.bare_boards(k + '_lining', 'deal', [], 1.6) if style == 'attic' else Dr.paint(k + '_lining', ['#cfc8b6', '#8b8a82', '#7a3b28'], 'pine', [], kick=0.0, chips=0.8, gloss=0.4, age=1.6, joints=False)
        M['leaves'] = leaves_mat(k + '_leaves'); M['wood'] = Dr.paint(k + '_hatch', ['#d6ccb4', '#8a8a78', '#8a5a3c'], 'deal', [], kick=0.0, chips=1.2, gloss=0.4, age=1.6, joints=False)
        M['cord'] = kitlib.fabric(k + '_cord', '#7a6a50', weave=0.5, age=1.4)
    return M

# ================================================================ build, bake, register
def bake_parts(name, parts, M, uv1=True, px=PX, double=False):
    """bake several nodes' baked parts into one texture set (they share the atlas): parts = [(node name, Geo, extra reserved-only)]
       -> {node name: object}"""
    objs = {}; reserved = [M['glass'], M['wall'], M['sky'], M['emit']]; res = {}
    for nm, G in parts:
        ob = G.build(nm); keep = [i for i, m in enumerate(ob.data.materials) if m in reserved]
        if keep:
            bm = bmesh.new(); bm.from_mesh(ob.data); rbm = bm.copy()
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in keep], context='FACES')
            bmesh.ops.delete(rbm, geom=[f for f in rbm.faces if f.material_index not in keep], context='FACES')
            for b in (bm, rbm): bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context='VERTS')
            me2 = ob.data.copy(); rbm.to_mesh(me2); rbm.free(); bm.to_mesh(ob.data); bm.free(); ob.data.update(); me2.update()
            res[nm] = kitlib.link(bpy.data.objects.new(nm + '_res', me2))
        objs[nm] = ob
    baked = [o for o in objs.values() if len(o.data.polygons)]
    files = None
    if baked:
        # (a shallow relief seen from below, a ceiling rose: one planar island from above, no seams through its leaves; the rest
        # smart projected; then all packed together)
        planar = [o for o in baked if o.name in PLANAR]; rest = [o for o in baked if o not in planar]
        for o in planar:
            if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
            uvd = o.data.uv_layers[0].data; R = max(max(abs(v.co.x), abs(v.co.y)) for v in o.data.vertices) or 1.0
            for li, lp_ in enumerate(o.data.loops):
                c = o.data.vertices[lp_.vertex_index].co; uvd[li].uv = (0.5 + c.x / (2 * R), 0.5 + c.y / (2 * R))
        if rest: kitlib.unwrap(rest, margin=0.003, smart=True, angle=60)
        kitlib.unwrap(baked, margin=0.003, smart=False)
        files = kitlib.bake_set(baked, name, px, 64)
        mat = kitlib.baked_material('Kit_' + name, files, double=double)
        for o in baked:
            o.data.materials.clear(); o.data.materials.append(mat); o.data.polygons.foreach_set('material_index', [0] * len(o.data.polygons))
    out = {}
    for nm, ob in objs.items():
        parts_ = [ob] if len(ob.data.polygons) else []
        if nm in res:
            if not res[nm].data.uv_layers: res[nm].data.uv_layers.new(name='UVMap')
            if parts_ and parts_[0].data.uv_layers: res[nm].data.uv_layers[0].name = parts_[0].data.uv_layers[0].name
            parts_.append(res[nm])
        for o in parts_:
            for a in [a.name for a in o.data.attributes if a.name in ATTRS]: o.data.attributes.remove(o.data.attributes[a])
            if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
        o = kitlib.join(parts_, nm) if len(parts_) > 1 else parts_[0]
        used = sorted(set(p_.material_index for p_ in o.data.polygons)); uniq = []
        for m_ in sorted((o.data.materials[i] for i in used), key=lambda q: 0 if q.name.startswith('Kit_') else 1):
            if m_ not in uniq: uniq.append(m_)
        mi = [uniq.index(o.data.materials[p_.material_index]) for p_ in o.data.polygons]
        o.data.materials.clear()
        for m_ in uniq: o.data.materials.append(m_)
        o.data.polygons.foreach_set('material_index', mi)
        if uv1 and any(m_.name not in ('Glass', 'SkyPlane', 'Emit') for m_ in uniq): Wn.finish_obj(o, True)
        o.name = nm; o.data.name = nm; o['kit'] = 'arch'; out[nm] = o
    return out, files

def register(asset, roots, t0, info):
    for r in roots: r.location = (0, 0, 0)
    json.dump(info, open(os.path.join(TMP, asset + '.json'), 'w'), indent=1)
    kitlib.register(asset, roots)
    print(f'{asset}: ' + ', '.join(f'{r.name} {sum(kitlib.tris(o) for o in [r] + list(r.children_recursive) if o.type == "MESH")}' for r in roots) + f'; {time.time() - t0:.0f}s', flush=True)

def do_exit(style):
    t0 = time.time(); kitlib.reset(); M = materials('exit', style); G = build_exit(style, M); nm = 'Exit_' + style
    p = PIECES[nm]; lw = p['leaf'][0]
    objs, f1 = bake_parts(nm, [(nm, G['root']), (f'Exit_leaf_{style}', G['leaf']), (f'Exit_boards_{style}', G['boards']), (f'Exit_lamp_{style}', G['lamp'])], M)
    root = objs[nm]
    for k in ('leaf', 'boards', 'lamp'):
        o = objs[f'Exit_{k}_{style}']; o.parent = root; o.matrix_parent_inverse.identity()
    objs[f'Exit_leaf_{style}'].location = (-lw / 2, 0, 0)
    if '--sheets' in sys.argv: sheet('exit', style, [root])
    register(f'exit_{style}', [root], t0, {'bake': f1['times']['total'] if f1 else 0})

def do_simple(group, style, nodes_builders, uv1=True, double=False, sockets=()):
    t0 = time.time(); kitlib.reset(); M = materials(group, style)
    parts = [(nm, b(M)) for nm, b in nodes_builders]
    objs, f1 = bake_parts(f'{group}_{style}', parts, M, uv1=uv1, double=double)
    roots = list(objs.values())
    for nm, loc in sockets:
        e = kitlib.empty(nm, loc, objs[nm.rsplit('_fix', 1)[0]]); e.matrix_parent_inverse.identity(); e.location = loc
    if '--sheets' in sys.argv: sheet(group, style, roots)
    register(f'{group}_{style}', roots, t0, {'bake': f1['times']['total'] if f1 else 0})

def main():
    GROUPS = ('exit', 'fireplace', 'wallhole', 'peel', 'niche', 'ceiling'); only = OPTS.only or set()
    gs = [g for g in GROUPS if g in only] or list(GROUPS); styles = [s for s in defs.KIT['styles'] if s in only] or list(defs.KIT['styles'])
    want = lambda g: g in gs
    for st in styles:
        if want('exit'): do_exit(st)
        if want('fireplace') and f'Mod_fireplace_{st}' in PIECES:
            do_simple('fireplace', st, [(f'Mod_fireplace_{st}', lambda M, st=st: build_fireplace(st, M))], sockets=[(f'Mod_fireplace_{st}_fix', (0.0, -0.06, 0.3))])
        if want('wallhole'):
            names = [n for n in PIECES if PIECES[n]['kind'] == 'wallhole' and PIECES[n]['style'] == st]
            do_simple('wallhole', st, [(n, lambda M, n=n, st=st: build_wallhole(n, st, n.split('_')[-2], M)) for n in names])
        if want('peel'):
            names = [n for n in PIECES if PIECES[n]['kind'] == 'peel' and PIECES[n]['style'] == st]
            do_simple('peel', st, [(n, lambda M, n=n, st=st: build_peel(n, st, n.split('_')[-2], M)) for n in names], uv1=False, double=True)
        if want('niche') and f'Mod_niche_{st}' in PIECES:
            do_simple('niche', st, [(f'Mod_niche_{st}', lambda M, st=st: build_niche(st, M))])
        if want('ceiling'):
            nb = []
            if st == 'wood': nb.append(('Band_ceilingrose', lambda M: build_rose('Band_ceilingrose', M)))
            if st == 'tile': nb.append(('Band_coffer_rose', lambda M: build_rose('Band_coffer_rose', M)))
            if f'Mod_ceilhole_{st}' in PIECES: nb.append((f'Mod_ceilhole_{st}', lambda M, st=st: build_ceilhole(st, M)))
            if f'Mod_skylight_{st}' in PIECES: nb.append((f'Mod_skylight_{st}', lambda M, st=st: build_skylight(st, M)))
            if st == 'attic': nb.append(('Band_attic_ladder', lambda M: build_ladder(M)))
            if nb: do_simple_ceiling(st, nb)

def do_simple_ceiling(st, nb):
    t0 = time.time(); kitlib.reset(); M = materials('ceiling', st); M['ceiling'] = ceiling_mat(f'ceiling_{st}_ceil', st, hole=(0.0, 0.0, 0.55))
    parts = [(nm, b(M)) for nm, b in nb]
    objs, f1 = bake_parts(f'ceiling_{st}', parts, M, uv1=True)
    roots = list(objs.values())
    if '--sheets' in sys.argv: sheet('ceiling', st, roots)
    register(f'ceiling_{st}', roots, t0, {'bake': f1['times']['total'] if f1 else 0})

# ================================================================ contact sheets
def sheet(group, style, roots):
    """each node in a corner of its style's room (wall pieces on the wall, ceiling pieces seen from below), lit warm and low"""
    from PIL import Image
    d = os.path.join(TMP, 'sheets', 'modules'); os.makedirs(d, exist_ok=True)
    man = S.manifest_load()['styles'].get(style, {}); sc = bpy.context.scene
    fl = S.ship_mat('sh_floor', man['floor']) if man.get('floor') else kitlib.grey()
    wA = S.ship_mat('sh_wallA', man['wall'], 0) if man.get('wall') else kitlib.grey()
    ce = S.ship_mat('sh_ceil', man['ceil']) if man.get('ceil') else kitlib.grey()
    glm = kitlib.Mat('sh_glass'); glm.b.inputs['Transmission Weight'].default_value = 1.0; glm.b.inputs['Roughness'].default_value = 0.05
    skym = kitlib.Mat('sh_sky'); em = skym.n('ShaderNodeEmission'); em.inputs['Strength'].default_value = 0.5; em.inputs['Color'].default_value = (0.08, 0.11, 0.2, 1); skym.l(em.outputs[0], skym.out_node.inputs['Surface'])
    emm = kitlib.Mat('sh_emit'); e2 = emm.n('ShaderNodeEmission'); e2.inputs['Strength'].default_value = 6.0; e2.inputs['Color'].default_value = (1.0, 0.15, 0.1, 1); emm.l(e2.outputs[0], emm.out_node.inputs['Surface'])
    shots = []
    for r in roots:
        for o in roots: o.hide_render = o is not r
        tmp = []; swaps = []
        def keep(o): tmp.append(o); return o
        objs = [r] + list(r.children_recursive)
        is_ceil = PIECES.get(r.name, {}).get('mount') == 'ceiling' or (r.name in defs.KIT['band'] and defs.KIT['band'][r.name].get('mount') == 'ceiling') or r.name.startswith('Band_ceil') or r.name.startswith('Band_coffer') or r.name.startswith('Band_attic')
        face_mod = PIECES.get(r.name, {}).get('mount') == 'face'
        for o in objs:
            if o.type != 'MESH': continue
            for i, m_ in enumerate(o.data.materials):
                if m_.name == 'WallSurface':
                    swaps.append((o, i, m_)); o.data.materials[i] = wA; uv = o.data.uv_layers[0].data
                    for p_ in o.data.polygons:
                        if p_.material_index != i: continue
                        for li in p_.loop_indices:
                            c = o.data.vertices[o.data.loops[li].vertex_index].co; n = p_.normal; u_, v_ = 0.5 + c.x / FW, c.z / FH
                            if abs(n.x) > 0.7: u_ = 0.5 + (c.x - math.copysign(1, n.x) * c.y) / FW
                            elif abs(n.z) > 0.7: v_ = (c.z + math.copysign(1, n.z) * c.y) / FH
                            uv[li].uv = (u_, v_)
                elif m_.name == 'Glass': swaps.append((o, i, m_)); o.data.materials[i] = glm.m; o.visible_shadow = False
                elif m_.name == 'SkyPlane': swaps.append((o, i, m_)); o.data.materials[i] = skym.m; o.visible_shadow = False
                elif m_.name == 'Emit': swaps.append((o, i, m_)); o.data.materials[i] = emm.m
        H = 3.0
        if is_ceil:
            r.location = (0, 0, H)
            for i in (-1, 0, 1):
                for j in (-1, 0, 1):
                    if (i, j) != (0, 0) or not r.name.startswith('Mod_'): keep(S.quad(f'sh_c{i}{j}', (i * FW - FW / 2, j * FW + FW / 2, H), (FW, 0, 0), (0, -FW, 0), mat=ce))
            keep(S.quad('sh_f', (-1.5 * FW, -1.5 * FW, 0), (3 * FW, 0, 0), (0, 3 * FW, 0), mat=fl))
            keep(S.lamp('sh_l', 'POINT', 120, (0.8, -1.4, 1.6), None, 0.2, (1.0, 0.82, 0.6)))
            keep(S.lamp('sh_f2', 'AREA', 60, (-1.0, 1.0, 1.0), (math.radians(180), 0, 0), 2.0, (0.8, 0.85, 1.0)))
            S.cam_at((1.6, -2.6, 1.4), (0.0, 0.0, H - 0.1), 30); shots.append(S.render(os.path.join(d, f'{r.name}.png'), 1000, 800, 128))
            S.cam_at((0.4, -0.9, 1.7), (0.0, 0.1, H), 50); shots.append(S.render(os.path.join(d, f'{r.name}_up.png'), 900, 800, 128))
            r.location = (0, 0, 0)
        else:
            if not face_mod: keep(S.quad('sh_w0', (-FW / 2, 0, 0), (FW, 0, 0), (0, 0, H), mat=wA))
            for i in (-1, 1): keep(S.quad(f'sh_w{i}', (i * FW - FW / 2, 0, 0), (FW, 0, 0), (0, 0, H), mat=wA))
            keep(S.quad('sh_f', (-1.5 * FW, -2 * FW, 0), (3 * FW, 0, 0), (0, 2 * FW, 0), mat=fl))
            keep(S.lamp('sh_l', 'POINT', 90, (1.0, -1.8, 2.2), None, 0.2, (1.0, 0.8, 0.58)))
            keep(S.lamp('sh_f2', 'AREA', 50, (-0.8, -2.6, 2.4), (math.radians(60), 0, math.radians(-20)), 2.0, (0.8, 0.85, 1.0)))
            S.cam_at((0.3, -3.2, 1.5), (0.0, 0.0, 1.3), 32); shots.append(S.render(os.path.join(d, f'{r.name}.png'), 1000, 1000, 128))
            S.cam_at((1.0, -1.4, 1.25), (0.0, 0.0, 1.0), 40); shots.append(S.render(os.path.join(d, f'{r.name}_angle.png'), 1000, 1000, 128))
        for o, i, m_ in swaps: o.data.materials[i] = m_; o.visible_shadow = True
        for o in tmp:
            if o.name in bpy.data.objects: bpy.data.objects.remove(o)
    for o in roots: o.hide_render = False
    ims = [Image.open(p_).convert('RGB') for p_ in shots]; hgt = 520
    ims = [im.resize((int(im.width * hgt / im.height), hgt)) for im in ims]
    out = Image.new('RGB', (sum(i.width for i in ims), hgt)); x = 0
    for im in ims: out.paste(im, (x, 0)); x += im.width
    out.save(os.path.join(d, f'{group}_{style}.png'))

if __name__ == '__main__':
    main()
