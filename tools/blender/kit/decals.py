# Escape from Barbi Blue: the decal atlas (WP2.6; build spec B11, D4; js/surface.js atlasFor / floorStamps).
#   textures/decals/decals_albedo.<hi|md|lo>.webp  4096 / 2048 / 1024 square, RGBA: colour, alpha = coverage (straight; the colour
#                                                   bled out under the clear parts, so filtering never darkens an edge)
#   textures/decals/decals_normal.<tier>.webp       tangent-space normals (OpenGL: green up), flat where nothing is
#   textures/decals/decals.json                     {W, H, decals: [{id, rect [x, y, w, h] in px of the hi atlas (y down), size_m [w, h],
#                                                   kinds, heights [lo, hi] (m, where on a wall it belongs), styles (null: any)}]}
# Wall kinds (surface.js KINDS): stain (tide rings), mould, soot (plumes), scratch (and claw marks), drawing (crayon), handprint,
# crack, flakes, rust (streaks), ghost (where a picture hung), damp (the tide band), height_chart; and footprint, peel_under,
# tile_missing. Floor stamps: floor_puddle, floor_ring, floor_rust, floor_scorch, floor_paint, floor_dust. Ceiling: ceil_ring,
# ceil_mould, ceil_soot.
# Everything is drawn at its final size (px per metre per decal, 430..1700) from shapes (polygons, strokes, a stroke font for the
# children's writing, hands and soles) and noise (value-noise fBm, domain warping, Voronoi), with a height for each that the
# normals come from. No two variants share a seed.
#   py -3.11 tools/blender/kit/decals.py [--only stain,drawing] [--review]
import sys, os, math, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import defs

OUT = os.path.join(defs.REPO, 'textures', 'decals')
WORK = os.path.join(defs.WORK, 'decals')
ATLAS = 4096; PAD = 10

# ================================================================ noise and shapes
_T = {}
def _table(seed):
    if seed not in _T: _T[seed] = np.random.default_rng(seed).random((256, 256), dtype=np.float32) * 2 - 1
    return _T[seed]

def vnoise(x, y, f, seed):
    T = _table(seed); gx, gy = x * f, y * f; i0 = np.floor(gx).astype(np.int64); j0 = np.floor(gy).astype(np.int64)
    fx, fy = gx - i0, gy - j0; sx = fx * fx * (3 - 2 * fx); sy = fy * fy * (3 - 2 * fy)
    i1, j1 = (i0 + 1) & 255, (j0 + 1) & 255; i0 &= 255; j0 &= 255
    a = T[i0, j0] + (T[i1, j0] - T[i0, j0]) * sx; b = T[i0, j1] + (T[i1, j1] - T[i0, j1]) * sx
    return a + (b - a) * sy

def fbm(x, y, f, octaves=4, seed=0, rough=0.5, lac=2.03):
    s, a, t = 0.0, 1.0, 0.0
    for k in range(octaves): s = s + a * vnoise(x, y, f * lac ** k, seed * 31 + 17 * k); t += a; a *= rough
    return s / t

def blur(a, r):
    """three box passes: about a gaussian of sigma ~ r"""
    r = int(round(r))
    if r < 1: return a
    for ax in (0, 1):
        for _ in range(3):
            c = np.cumsum(np.pad(a, [(r + 1, r) if k == ax else (0, 0) for k in range(a.ndim)], mode='edge'), axis=ax)
            a = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return a

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def raster(w, h, draw, ss=3):
    """a coverage mask drawn with PIL at ss x supersampling (draw(d, s) with s the scale from decal px), averaged down"""
    im = Image.new('L', (w * ss, h * ss), 0); d = ImageDraw.Draw(im); draw(d, ss)
    return np.asarray(im.resize((w, h), Image.BOX), np.float32) / 255.0

def stroke(d, s, pts, width):
    """a polyline of round-ended segments, width in px (pts in px)"""
    P = [(x * s, y * s) for x, y in pts]; w = max(1, int(round(width * s)))
    d.line(P, fill=255, width=w, joint='curve')
    for x, y in (P[0], P[-1]): d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=255)

class Decal:
    """one decal being drawn: its pixel grid (x right, y down, metres from its top-left), colour, coverage and height"""
    def __init__(self, w_m, h_m, ppm, seed):
        self.ppm = ppm; self.W = max(8, int(round(w_m * ppm))); self.H = max(8, int(round(h_m * ppm))); self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.x, self.y = np.meshgrid((np.arange(self.W) + 0.5) / ppm, (np.arange(self.H) + 0.5) / ppm)
        self.col = np.zeros((self.H, self.W, 3), np.float32); self.a = np.zeros((self.H, self.W), np.float32)
        self.h = np.zeros((self.H, self.W), np.float32)
    def m(self, v): return v * self.ppm                      # (metres -> px)
    def paint(self, cov, col):
        """lay a coat of colour col (rgb 0..1, or an HxWx3 array) over what is there with coverage cov (straight alpha 'over')"""
        cov = np.clip(cov, 0, 1)[..., None]; col = np.asarray(col, np.float32)
        a0 = self.a[..., None]; a1 = cov + a0 * (1 - cov)
        self.col = np.where(a1 > 1e-6, (col * cov + self.col * a0 * (1 - cov)) / np.maximum(a1, 1e-6), self.col); self.a = a1[..., 0]
    def noise(self, f, oct=4, s=0, rough=0.5): return fbm(self.x, self.y, f, oct, self.seed * 7 + s, rough)
    def mask(self, draw, ss=3): return raster(self.W, self.H, draw, ss)
    def dist_from(self, cov, r):
        """a soft distance inward from cov's edge (0 at the edge .. 1 at r px inside)"""
        return np.clip(blur(cov, r) * 2 - 1, 0, 1)

def srgb(h):
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)

# ================================================================ the decals
def blob_mask(D, cx, cy, rx, ry, rough=0.35, f=3.0, s=0):
    """an irregular blob: an ellipse its edge pushed about by warped noise"""
    dx, dy = (D.x - cx) / rx, (D.y - cy) / ry
    wx = D.noise(f / max(rx, ry), 3, s) * rough; wy = D.noise(f / max(rx, ry), 3, s + 1) * rough
    return 1.0 - np.sqrt((dx + wx) ** 2 + (dy + wy) ** 2)

def g_stain(D, v):
    """a water stain (a leak that dried, again and again): nested tide lines, brown and sharp on their outer side, soft inside, the
       stained area tea-coloured, runs where it ran down; on a wall, bleeding out of the plaster"""
    W, H = D.W / D.ppm, D.H / D.ppm; cx, cy = W / 2, H * (0.38 + 0.1 * D.rng.random())
    e = blob_mask(D, cx, cy, W * 0.42, H * 0.34, 0.45, 2.5, 1)
    for k in range(int(D.rng.integers(2, 6))):                          # (runs down from it: wandering, thinning, a bead at the end)
        x0 = cx + (D.rng.random() - 0.5) * W * 0.6; L = H * (0.25 + 0.45 * D.rng.random()); wd = W * (0.015 + 0.035 * D.rng.random())
        y0 = cy + H * 0.1; t = np.clip((D.y - y0) / L, 0, 1)
        xx = x0 + 0.012 * np.sin(D.y * 9 + k * 2.1) + 0.006 * fbm(D.y, D.y * 0 + k, 30, 2, D.seed + 40 + k)
        wdt = wd * (1 - 0.65 * t) * (0.85 + 0.3 * fbm(D.y, D.y * 0 + k, 40, 2, D.seed + 50 + k))
        run = (1 - np.abs(D.x - xx) / np.maximum(wdt, 1e-4)) * (D.y > y0 - 0.05) * (D.y < y0 + L)
        bead = 1 - np.sqrt(((D.x - x0 - 0.012 * np.sin((y0 + L) * 9 + k * 2.1)) / (wd * 0.6)) ** 2 + ((D.y - y0 - L) / (wd * 0.8)) ** 2)
        e = np.maximum(e, np.maximum(run, bead) * 0.9 - 0.05)
    area = smoothstep(-0.02, 0.15, e); base = srgb('#9a7a4c'); dark = srgb('#5e4224')
    tone = 0.25 + 0.2 * (D.noise(6, 4, 3) + 0.5)
    D.paint(area * tone * (0.8 + 0.4 * D.noise(15, 3, 4)), base)
    for k, lvl in enumerate((0.0, 0.18, 0.37, 0.55)[:int(D.rng.integers(2, 5))]):   # (the tide lines: each a dried edge)
        ee = e - lvl + 0.05 * D.noise(20, 3, 10 + k)
        line = smoothstep(-0.035, 0.0, ee) * (1 - smoothstep(0.0, 0.08, ee))
        D.paint(line * (0.75 - 0.12 * k) * (0.7 + 0.3 * D.noise(30, 3, 20 + k)), dark * (1.0 + 0.1 * k))
    D.h += area * 0.0001

def g_mould(D, v):
    """black mould spreading from damp: colonies (patches of specks), the specks of every size from a dust of tiny ones to a few
       big fuzzy spots, merging into solid black where a colony is oldest, a grey-green bloom round it all"""
    W, H = D.W / D.ppm, D.H / D.ppm; cx, cy = W * (0.4 + 0.2 * D.rng.random()), H * (0.4 + 0.2 * D.rng.random())
    e = blob_mask(D, cx, cy, W * 0.45, H * 0.45, 0.6, 2.0, 2)
    col = smoothstep(-0.1, 0.35, e + 0.55 * D.noise(9, 4, 5))            # (the colonies)
    D.paint(smoothstep(-0.2, 0.6, e) * 0.3 * (0.6 + 0.4 * D.noise(8, 3, 1)), srgb('#5e6450'))
    speck = np.zeros_like(D.a)
    for k, (f, thr) in enumerate(((900, 0.4), (420, 0.45), (170, 0.5))):     # (fine dust of specks, middling, a few big ones)
        nz = fbm(D.x, D.y, f, 2, D.seed + 60 + k) + 0.25 * fbm(D.x, D.y, f * 0.3, 2, D.seed + 70 + k)
        speck = np.maximum(speck, smoothstep(thr - 0.06 * col, thr - 0.06 * col + 0.05, nz + 0.25 * (col - 0.5)))
    speck = speck * smoothstep(0.05, 0.4, col)
    solid = smoothstep(0.92, 1.05, col * (0.7 + 0.5 * e.clip(0, 1)) + 0.25 * D.noise(30, 3, 7))
    m = np.clip(np.maximum(speck, solid * 0.9), 0, 1); m = np.clip(blur(m, 0.6) * 1.15, 0, 1)
    D.paint(m * 0.88, srgb('#1b1e17') * (0.85 + 0.3 * (D.noise(50, 2, 8)[..., None] + 0.5)))
    D.h += m * 0.0002

def blob_mask_pt(D, pts, cx, cy, rx, ry):
    return 1.0 - np.sqrt(((pts[:, 0] - cx) / rx) ** 2 + ((pts[:, 1] - cy) / ry) ** 2) + 0.4 * fbm(pts[:, 0], pts[:, 1], 3 / rx, 3, D.seed * 7 + 2)

def g_soot(D, v):
    """the soot a lamp or a candle laid on the wall above it: a plume widening as it rises, darkest just above the flame, streaked
       upward, its edge feathered"""
    W, H = D.W / D.ppm, D.H / D.ppm; t = 1 - D.y / H                    # (0 at the bottom (the flame) .. 1 at the top)
    half = W * (0.12 + 0.36 * t ** 0.7); dx = np.abs(D.x - W / 2 - 0.03 * W * D.noise(2, 3, 1)) / half
    k = (1 - smoothstep(0.3, 1.0, dx)) * (1 - smoothstep(0.75, 1.0, t)) * smoothstep(0.0, 0.08, t)
    streak = 0.75 + 0.35 * fbm(D.x * 8, D.y * 0.8, 9, 3, D.seed + 3)
    D.paint(np.clip(k * (0.85 - 0.55 * t) * streak, 0, 1), srgb('#191512'))

def g_scratch(D, v):
    """scratches through the paint: a few dragged across together, each its own width, tapering in and out, broken where the point
       skipped, the under-coat and plaster in them, a dark shadow on the far lip and a light one on the near; or claw marks: four
       gouges dragged down, ragged, deep in the middle, tailing off, crumbs of paint torn out along them"""
    W, H = D.W / D.ppm, D.H / D.ppm; claw = v >= 3; r = D.rng
    n = 4 if claw else int(r.integers(3, 7)); ang = (math.pi / 2 + r.uniform(-0.3, 0.3)) if claw else r.uniform(-0.5, 0.5)
    ux, uy = math.cos(ang), math.sin(ang); px_, py_ = -uy, ux
    groove = np.zeros_like(D.a)
    for k in range(n):
        off = ((k - (n - 1) / 2) * (0.021 if claw else r.uniform(0.004, 0.016))) + r.normal(0, 0.002)
        L = (H * r.uniform(0.62, 0.85)) if claw else r.uniform(0.35, 0.9) * min(W, H)
        sh = r.uniform(-0.1, 0.1) * L
        c0 = np.array([W / 2 + px_ * off, H / 2 + py_ * off]) - np.array([ux, uy]) * (L / 2 + sh)
        wmax = r.uniform(0.004, 0.0075) if claw else r.uniform(0.0006, 0.0018); bend = r.normal(0, 0.012 if claw else 0.006)
        seg = []; N = 40
        for i in range(N + 1):
            tt = i / N; p = c0 + np.array([ux, uy]) * L * tt + np.array([px_, py_]) * bend * math.sin(math.pi * tt)
            wd = wmax * (math.sin(math.pi * min(1.0, tt * (1.6 if claw else 1.0))) ** (0.6 if claw else 0.8)) * (1 - 0.6 * tt if claw else 1.0)
            seg.append((p, max(wd, 0.0002)))
        skip = set(i for i in range(N) if not claw and r.random() < 0.08)
        m = D.mask(lambda d, s: [stroke(d, s, [tuple(seg[i][0] * D.ppm), tuple(seg[i + 1][0] * D.ppm)], seg[i][1] * D.ppm) for i in range(N) if i not in skip], 3)
        groove = np.maximum(groove, m)
    rag = smoothstep(-0.25, 0.15, fbm(D.x, D.y, 260, 2, D.seed + 3)) if claw else 1.0
    groove = groove * (0.75 + 0.25 * rag)
    shift = max(1, int(D.ppm * 0.0008))
    far = np.clip(np.roll(groove, shift, 0) - groove, 0, 1); near = np.clip(np.roll(groove, -shift, 0) - groove, 0, 1)
    if claw:                                                               # (torn paint along the gouges)
        torn = np.clip(blur(groove, 3) * 2.2 - groove, 0, 1) * smoothstep(0.05, 0.35, fbm(D.x, D.y, 120, 3, D.seed + 4))
        D.paint(torn * 0.9, srgb('#c9bea8')); D.h -= torn * 0.0002
    D.paint(far * 0.55, srgb('#1e1813')); D.paint(near * 0.35, srgb('#efe8da'))
    inner = srgb('#d6ccb6') * (0.85 + 0.2 * (D.noise(60, 2, 1)[..., None] + 0.5))
    D.paint(groove * 0.9, inner)
    if claw:
        D.paint(groove * smoothstep(0.5, 1.0, blur(groove, 1.5)) * 0.75, srgb('#8a775c'))
        D.paint(groove * 0.25 * smoothstep(0.6, 1.0, blur(groove, 2)), srgb('#2a2018'))
    D.h -= groove * (0.0012 if claw else 0.0003)

# ---------------------------------------------------------------- the children's crayon
FONT = {        # a child's capitals as strokes in a 0..1 box (x right, y down)
    'A': [[(0.0, 1.0), (0.5, 0.0), (1.0, 1.0)], [(0.22, 0.6), (0.78, 0.6)]], 'D': [[(0.1, 0.0), (0.1, 1.0)], [(0.1, 0.0), (0.6, 0.08), (0.92, 0.5), (0.6, 0.92), (0.1, 1.0)]],
    'E': [[(0.85, 0.0), (0.1, 0.0), (0.1, 1.0), (0.85, 1.0)], [(0.1, 0.5), (0.7, 0.5)]], 'H': [[(0.1, 0.0), (0.1, 1.0)], [(0.9, 0.0), (0.9, 1.0)], [(0.1, 0.5), (0.9, 0.5)]],
    'I': [[(0.5, 0.0), (0.5, 1.0)]], 'L': [[(0.15, 0.0), (0.15, 1.0), (0.85, 1.0)]], 'M': [[(0.0, 1.0), (0.08, 0.0), (0.5, 0.65), (0.92, 0.0), (1.0, 1.0)]],
    'N': [[(0.1, 1.0), (0.1, 0.0), (0.9, 1.0), (0.9, 0.0)]], 'O': [[(0.5 + 0.45 * math.cos(a), 0.5 + 0.5 * math.sin(a)) for a in np.linspace(-1.6, 2 * math.pi - 1.3, 20)]],
    'R': [[(0.12, 1.0), (0.12, 0.0), (0.7, 0.05), (0.85, 0.25), (0.65, 0.48), (0.12, 0.5)], [(0.4, 0.5), (0.9, 1.0)]], 'T': [[(0.0, 0.0), (1.0, 0.0)], [(0.5, 0.0), (0.5, 1.0)]],
    'U': [[(0.1, 0.0), (0.1, 0.7), (0.3, 0.98), (0.7, 0.98), (0.9, 0.7), (0.9, 0.0)]], "'": [[(0.5, 0.0), (0.45, 0.25)]], ' ': [],
}

class Crayon:
    """strokes in a decal's metres, laid down as wax crayon: the line wanders (a child's hand), its width and pressure vary along it,
       the wax catches only on the wall's tooth (broken, grainy), heavier where it was pressed, a little build-up at the ends"""
    def __init__(s, D, col, width=0.006, wobble=0.004): s.D, s.col, s.w, s.wob = D, srgb(col) if isinstance(col, str) else col, width, wobble; s.lines = []
    def line(s, pts, press=1.0):
        P = np.array(pts, np.float32); n = max(2, int(np.sum(np.linalg.norm(np.diff(P, axis=0), axis=1)) / 0.004))
        t = np.linspace(0, 1, n); seglen = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]; seglen /= max(seglen[-1], 1e-9)
        Q = np.stack([np.interp(t, seglen, P[:, 0]), np.interp(t, seglen, P[:, 1])], -1)
        r = s.D.rng; ph = r.uniform(0, 6.28, 3)
        Q = Q + np.stack([s.wob * (np.sin(t * 7 + ph[0]) * 0.6 + np.sin(t * 19 + ph[1]) * 0.3), s.wob * (np.sin(t * 9 + ph[2]) * 0.6 + np.sin(t * 23 + ph[0]) * 0.3)], -1)
        s.lines.append((Q, press * (0.75 + 0.25 * np.sin(t * 5 + ph[1])))); return s
    def draw(s, alpha=0.95):
        D = s.D; m = np.zeros_like(D.a)
        for Q, pr in s.lines:
            mm = D.mask(lambda d, ss: [stroke(d, ss, [tuple(Q[i] * D.ppm), tuple(Q[i + 1] * D.ppm)], s.w * D.ppm * (0.75 + 0.35 * pr[i])) for i in range(len(Q) - 1)], 2)
            m = np.maximum(m, mm * np.interp(np.arange(1), [0], [1]))
        g = fbm(D.x, D.y, 520, 2, D.seed + 91) + 0.3 * fbm(D.x, D.y, 130, 2, D.seed + 92)
        tooth = smoothstep(-0.45, -0.05, g + 0.5 * (m - 0.5))             # (the wall's grain: skips at the stroke's edges, solid in its middle)
        cov = np.clip(m * 1.25, 0, 1) * tooth * alpha
        D.paint(cov, s.col * (0.85 + 0.25 * (fbm(D.x, D.y, 300, 2, D.seed + 93)[..., None] + 0.5)))
        D.h += cov * 0.00015

def text_width(text, h, spacing=0.75):
    return sum((h * (0.25 if ch == 'I' else 0.7)) + h * (0.25 if ch != ' ' else 0.45) * spacing for ch in text)

def text_strokes(text, x0, y0, h, D, slope=0.0, spacing=0.75):
    """a child's capitals: each letter its own size and tilt, the baseline drifting"""
    out = []; x = x0; r = D.rng
    for ch in text:
        sc = h * r.uniform(0.85, 1.2); a = r.uniform(-0.15, 0.15); wdt = sc * (0.25 if ch == 'I' else 0.7); by = y0 + slope * (x - x0) + r.normal(0, h * 0.06)
        for st in FONT.get(ch, []):
            pts = []
            for px_, py_ in st:
                lx, ly = (px_ - 0.5) * wdt, (py_ - 0.5) * sc
                pts.append((x + wdt / 2 + lx * math.cos(a) - ly * math.sin(a), by - sc / 2 + lx * math.sin(a) + ly * math.cos(a)))
            out.append(pts)
        x += wdt + sc * (0.25 if ch != ' ' else 0.45) * spacing
    return out

def g_drawing(D, v):
    """the eight crayon drawings (B11): a stick family; a tall figure in a blue dress; a house with no door; a sun with a face; tally
       marks; LA LA LA; LET ME OUT; DONT LET HER IN"""
    W, H = D.W / D.ppm, D.H / D.ppm; r = D.rng
    def fig(cx, base, hgt, col, dress=None, hair=None, arms_up=False, face=True):
        c = Crayon(D, col); hr = hgt * 0.12; hc = (cx, base - hgt + hr)
        c.line([(hc[0] + hr * math.cos(a), hc[1] + hr * 1.05 * math.sin(a)) for a in np.linspace(-1.2, 2 * math.pi - 0.9, 16)])
        neck = base - hgt + 2 * hr; hip = base - hgt * 0.42
        if dress is None:
            c.line([(cx, neck), (cx + r.normal(0, 0.003), hip)]); c.line([(cx, hip), (cx - hgt * 0.14, base)]); c.line([(cx, hip), (cx + hgt * 0.13, base)])
        else:
            dc = Crayon(D, dress, 0.007); w2 = hgt * 0.2
            for k in range(7): dc.line([(cx - w2 * 0.15 + r.normal(0, 0.002), neck + 0.01 + k * 0.004), (cx - w2 + k * w2 * 0.32, hip + hgt * 0.12)], 0.9)
            dc.line([(cx, neck), (cx - w2, hip + hgt * 0.12), (cx + w2, hip + hgt * 0.12), (cx, neck)]); dc.draw()
            c.line([(cx - w2 * 0.4, hip + hgt * 0.12), (cx - w2 * 0.45, base)]); c.line([(cx + w2 * 0.4, hip + hgt * 0.12), (cx + w2 * 0.45, base)])
        ay = neck + hgt * 0.08
        if arms_up: c.line([(cx - hgt * 0.22, ay - hgt * 0.15), (cx, ay), (cx + hgt * 0.22, ay - hgt * 0.15)])
        else: c.line([(cx - hgt * 0.24, ay + hgt * 0.06), (cx, ay - 0.004), (cx + hgt * 0.24, ay + hgt * 0.07)])
        if face:
            c.line([(hc[0] - hr * 0.35, hc[1] - hr * 0.15), (hc[0] - hr * 0.33, hc[1] - hr * 0.1)]); c.line([(hc[0] + hr * 0.35, hc[1] - hr * 0.15), (hc[0] + hr * 0.37, hc[1] - hr * 0.1)])
            c.line([(hc[0] - hr * 0.4, hc[1] + hr * 0.35), (hc[0], hc[1] + hr * 0.55), (hc[0] + hr * 0.4, hc[1] + hr * 0.35)])
        c.draw()
        if hair:
            hcr = Crayon(D, hair, 0.004)
            for k in range(9): a = math.pi + (k / 8) * math.pi; hcr.line([(hc[0] + hr * math.cos(a), hc[1] + hr * math.sin(a)), (hc[0] + hr * 1.5 * math.cos(a) * (1.2 if k in (0, 8) else 1.0), hc[1] + hr * (1.2 + (3.5 if k in (0, 1, 7, 8) else 0.4)) * abs(math.sin(a)) * 0.6 + (hr * 2.5 if k in (0, 8) else 0))])
            hcr.draw()
    if v == 0:                                                           # (the family: mummy, daddy, me, holding hands; a crooked sun)
        base = H * 0.88
        fig(W * 0.22, base, H * 0.62, '#2f2f8a', dress='#c4362f', hair='#6a3f1c'); fig(W * 0.5, base, H * 0.72, '#2a2a2a'); fig(W * 0.74, base, H * 0.42, '#3a7a3a', dress='#d7a92c', hair='#d7a92c')
        Crayon(D, '#2a2a2a', 0.005).line([(W * 0.3, base - H * 0.5), (W * 0.42, base - H * 0.47)]).line([(W * 0.58, base - H * 0.47), (W * 0.68, base - H * 0.3)]).draw()
        sc = Crayon(D, '#e2b22c', 0.006); scx, scy, sr = W * 0.88, H * 0.14, H * 0.08
        sc.line([(scx + sr * math.cos(a), scy + sr * math.sin(a)) for a in np.linspace(0, 6.6, 18)])
        for k in range(8): a = k * math.pi / 4; sc.line([(scx + sr * 1.3 * math.cos(a), scy + sr * 1.3 * math.sin(a)), (scx + sr * 1.9 * math.cos(a), scy + sr * 1.9 * math.sin(a))])
        sc.draw()
    elif v == 1:                                                         # (her: tall, thin, the blue dress, the long black hair, no face; a little one)
        base = H * 0.95
        fig(W * 0.62, base, H * 0.9, '#1f1f1f', dress='#2f5fb8', hair='#111111', face=False)
        e = Crayon(D, '#111111', 0.004); hc = (W * 0.62, base - H * 0.9 + H * 0.9 * 0.12)
        for sx in (-1, 1): e.line([(hc[0] + sx * 0.02 - 0.006, hc[1] - 0.01), (hc[0] + sx * 0.02 + 0.006, hc[1] + 0.002)]).line([(hc[0] + sx * 0.02 + 0.006, hc[1] - 0.01), (hc[0] + sx * 0.02 - 0.006, hc[1] + 0.002)])
        e.draw(); fig(W * 0.22, base, H * 0.32, '#8a2a2a', arms_up=True)
    elif v == 2:                                                         # (a house with no door, windows barred, smoke)
        c = Crayon(D, '#1f1f1f', 0.0065); x0, x1, y0, y1 = W * 0.18, W * 0.82, H * 0.42, H * 0.92
        c.line([(x0, y1), (x0, y0), (x1, y0), (x1, y1), (x0, y1)]).line([(x0 - 0.02, y0 + 0.01), ((x0 + x1) / 2, H * 0.1), (x1 + 0.02, y0 + 0.01)]).draw()
        wc = Crayon(D, '#2a4a9a', 0.005)
        for wx in (0.3, 0.58):
            a, b = W * wx, W * wx + W * 0.13; t0, t1 = H * 0.52, H * 0.68; wc.line([(a, t0), (b, t0), (b, t1), (a, t1), (a, t0)])
            for k in range(1, 4): wc.line([(a + (b - a) * k / 4, t0), (a + (b - a) * k / 4, t1)])
        wc.draw(); Crayon(D, '#555555', 0.005).line([(W * 0.68, H * 0.22), (W * 0.7, H * 0.08), (W * 0.66, H * 0.0), (W * 0.72, H * -0.05)]).draw()
        Crayon(D, '#3a7a3a', 0.006).line([(W * 0.02, H * 0.94), (W * 0.98, H * 0.95)]).draw()
    elif v == 3:                                                         # (the sun with a face, smiling; its rays uneven)
        sc = Crayon(D, '#dca128', 0.007); cx, cy, rr = W / 2, H / 2, min(W, H) * 0.25
        sc.line([(cx + rr * math.cos(a), cy + rr * 1.03 * math.sin(a)) for a in np.linspace(-0.3, 6.3, 22)])
        for k in range(11): a = k * 2 * math.pi / 11 + r.normal(0, 0.06); L = rr * r.uniform(1.25, 1.75); sc.line([(cx + rr * 1.12 * math.cos(a), cy + rr * 1.12 * math.sin(a)), (cx + L * math.cos(a), cy + L * math.sin(a))])
        sc.draw(); f = Crayon(D, '#3a2a1a', 0.005)
        for sx in (-1, 1): f.line([(cx + sx * rr * 0.35, cy - rr * 0.25), (cx + sx * rr * 0.38, cy - rr * 0.15)])
        f.line([(cx + rr * 0.5 * math.cos(a), cy + rr * 0.1 + rr * 0.42 * math.sin(a)) for a in np.linspace(0.35, math.pi - 0.35, 10)]).draw()
    elif v == 4:                                                         # (tally marks: days, in fives, the later ones harder)
        c = Crayon(D, '#2b2b2b', 0.0045); n = int(r.integers(22, 34)); x = W * 0.06; row = 0
        for k in range(n):
            g = k % 5; y0 = H * (0.12 + 0.3 * row)
            if g < 4: c.line([(x + g * 0.016, y0 + r.normal(0, 0.004)), (x + g * 0.016 + r.normal(0, 0.004), y0 + H * 0.22)], 0.7 + 0.5 * k / n)
            else: c.line([(x - 0.008, y0 + H * 0.17), (x + 0.065, y0 + H * 0.04)], 1.0); x += 0.11
            if x > W * 0.88: x = W * 0.06; row += 1
        c.draw()
    else:                                                               # (the words)
        txt = {5: ['LA LA LA'], 6: ['LET ME OUT'], 7: ['DONT LET', 'HER IN']}[v]; col = {5: '#c4362f', 6: '#222222', 7: '#8a1f1f'}[v]
        c = Crayon(D, col, 0.0062, 0.002)
        for k, line in enumerate(txt):
            hgt = min(H * (0.42 if len(txt) == 1 else 0.3), W * 0.86 / text_width(line, 1.0) / 1.08)
            for st in text_strokes(line, W * 0.05 + k * 0.03, H * (0.58 if len(txt) == 1 else 0.36 + 0.42 * k), hgt, D, slope=r.uniform(-0.1, 0.04)): c.line(st, r.uniform(0.8, 1.1))
        c.draw()
        if v == 6: Crayon(D, '#222222', 0.004).line([(W * 0.08, H * 0.88), (W * 0.9, H * 0.86)]).draw()      # (underlined)

# ---------------------------------------------------------------- hands and feet
def hand_shape(cx, cy, scale, mirror, spread=0.0, rot=0.0):
    """a hand seen palm-on: the palm and its heel, four fingers in two phalanges' capsules, the thumb out to the side.
       -> [(polyline, width)] in metres (each finger a capsule chain), the palm polygon"""
    s = scale; m = -1 if mirror else 1; ca, sa = math.cos(rot), math.sin(rot)
    def T(x, y): x *= m; return (cx + (x * ca - y * sa) * s, cy + (x * sa + y * ca) * s)
    palm = [T(-0.42, 0.55), T(-0.48, 0.05), T(-0.4, -0.35), T(0.0, -0.42), T(0.4, -0.38), T(0.48, 0.0), T(0.44, 0.45), T(0.2, 0.72), T(-0.15, 0.74)]
    fingers = []
    for k, (bx, L, a) in enumerate(((-0.33, 0.62, -0.18), (-0.1, 0.78, -0.05), (0.13, 0.74, 0.06), (0.34, 0.56, 0.18))):
        a += spread * (k - 1.5) * 0.12; b = (bx, -0.38); tip = (bx + L * math.sin(a), -0.38 - L * math.cos(a))
        mid = (b[0] + (tip[0] - b[0]) * 0.5, b[1] + (tip[1] - b[1]) * 0.5)
        fingers.append(([T(*b), T(*mid), T(*tip)], 0.2 * s if k != 3 else 0.17 * s))
    th = [T(0.45, 0.25), T(0.75, 0.0), T(0.95, -0.25)]; fingers.append((th, 0.23 * s))
    return palm, fingers

def g_handprint(D, v):
    """hand prints left on the wall (B11): a child's left and right in grime, a child's dragged down (a smear), an adult's, a bloody
       one that ran, an oily black one; pressed hardest at the finger pads, the heel and the ball of the hand, the hollow of the
       palm barely touching, the skin's creases and pores printed"""
    W, H = D.W / D.ppm, D.H / D.ppm; r = D.rng
    child = v in (0, 1, 2); s = 0.066 if child else 0.092; mirror = v in (1, 4)
    palm, fingers = hand_shape(W / 2, H * 0.62, s, mirror, spread=r.uniform(0.0, 1.0), rot=r.uniform(-0.25, 0.25))
    def draw_hand(d, ss):
        d.polygon([(x * D.ppm * ss, y * D.ppm * ss) for x, y in palm], fill=255)
        for pts, wd in fingers:
            P = [(x * D.ppm, y * D.ppm) for x, y in pts]; stroke(d, ss, P, wd * D.ppm)
    m = D.mask(draw_hand, 3); m = np.clip(blur(m, 1.2) * 1.15, 0, 1)
    # where it pressed: pads and the heel and ball, not the hollow; creases; pores
    pres = np.zeros_like(m)
    for pts, wd in fingers:
        for q in pts[1:]: pres = np.maximum(pres, np.exp(-(((D.x - q[0]) ** 2 + (D.y - q[1]) ** 2) / (wd * 0.9) ** 2)))
    pc = np.mean(np.array(palm), 0); hollow = np.exp(-(((D.x - pc[0]) ** 2 + (D.y - pc[1] + 0.02 * s / 0.1) ** 2) / (0.28 * s) ** 2))
    pres = np.clip(0.45 + 0.75 * pres - 0.32 * hollow + 0.45 * D.noise(28, 3, 2), 0, 1)
    grain = 0.82 + 0.18 * smoothstep(-0.3, 0.3, fbm(D.x, D.y, 700, 2, D.seed + 5))
    def creases(d, ss):                                                  # (the joints across each finger, the palm's three lines)
        for pts, wd in fingers[:4]:
            (bx, by_), (tx, ty) = pts[0], pts[-1]; dx, dy = tx - bx, ty - by_; L = math.hypot(dx, dy); nx, ny = -dy / L, dx / L
            for f in (0.38, 0.7):
                cx_, cy_ = bx + dx * f, by_ + dy * f; hw = wd * 0.55
                d.line([((cx_ - nx * hw) * D.ppm * ss, (cy_ - ny * hw) * D.ppm * ss), ((cx_ + nx * hw) * D.ppm * ss, (cy_ + ny * hw) * D.ppm * ss)], fill=255, width=max(1, int(0.0013 * D.ppm * ss)))
        pc_ = np.mean(np.array(palm), 0); sgn = -1 if mirror else 1
        for (a0, b0, a1, b1, a2, b2) in ((-0.45, -0.22, 0.0, -0.3, 0.45, -0.18), (-0.45, -0.05, 0.0, 0.0, 0.3, 0.12), (0.35, -0.3, 0.12, 0.1, 0.1, 0.55)):
            P = [(pc_[0] + sgn * a * s, pc_[1] + b * s) for a, b in ((a0, b0), (a1, b1), (a2, b2))]
            d.line([(x * D.ppm * ss, y * D.ppm * ss) for x, y in P], fill=255, width=max(1, int(0.0011 * D.ppm * ss)), joint='curve')
    crease = 1 - 0.85 * D.mask(creases, 3)
    cov = smoothstep(0.28, 0.72, m * pres) * grain * crease
    col = {0: '#4e3a2c', 1: '#4e3a2c', 2: '#4a3a30', 3: '#3a3028', 4: '#5e1214', 5: '#16120e'}[v]
    if v == 2:                                                           # (dragged down: streaked, fading)
        cov2 = np.zeros_like(cov)
        for k in range(28): sh = int(D.m(0.004) * k); cov2[sh:] = np.maximum(cov2[sh:], cov[:cov.shape[0] - sh] * (1 - k / 28) ** 1.5 * (0.8 + 0.2 * np.sin(D.x[sh:] * 400 + k)))
        cov = np.maximum(cov, cov2 * 0.8)
    if v == 4:                                                           # (blood: runs from the fingers' and palm's lower edge)
        for k in range(int(r.integers(3, 6))):
            x0 = W / 2 + r.uniform(-0.6, 0.6) * s; y0 = H * 0.62 + r.uniform(0.2, 0.55) * s; L = r.uniform(0.04, 0.12); wd = r.uniform(0.002, 0.004)
            tt = np.clip((D.y - y0) / L, 0, 1); xx = x0 + 0.002 * np.sin(D.y * 60 + k)
            run = (1 - smoothstep(0.5, 1.0, np.abs(D.x - xx) / (wd * (1 - 0.5 * tt)))) * smoothstep(y0 - 0.002, y0 + 0.004, D.y) * (D.y < y0 + L)
            drop = 1 - smoothstep(0.6, 1.0, np.sqrt(((D.x - xx) / (wd * 0.9)) ** 2 + ((D.y - y0 - L) / (wd * 1.25)) ** 2)); cov = np.maximum(cov, np.maximum(run, drop) * 0.9)
    D.paint(cov * (0.85 if v in (4, 5) else 0.7), srgb(col) * (0.9 + 0.2 * (D.noise(40, 2, 8)[..., None] + 0.5)))
    if v == 4: D.paint(cov * smoothstep(0.6, 0.9, cov) * 0.6, srgb('#3a0808'))
    D.h += cov * 0.0001

def g_footprint(D, v):
    """footprints: a child's shoe (left, right), her bare foot (left, right) wet and grey with dust"""
    W, H = D.W / D.ppm, D.H / D.ppm; r = D.rng; mirror = v % 2 == 1; bare = v >= 2; m_ = -1 if mirror else 1
    cx = W / 2
    if not bare:
        L, Wf = 0.19, 0.068
        def sole(d, ss):
            pts = [(cx + m_ * Wf * 0.5 * math.sin(a) * (0.82 if math.cos(a) > 0 else 1.0) + m_ * 0.008 * math.cos(a), H / 2 - L / 2 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 40)]
            d.polygon([(x * D.ppm * ss, y * D.ppm * ss) for x, y in pts], fill=255)
        m = D.mask(sole); heel = (D.y > H / 2 + L * 0.18) & (D.y < H / 2 + L * 0.24)
        bars = smoothstep(-0.2, 0.2, np.sin(D.y * 2 * math.pi / 0.009)) * smoothstep(-0.2, 0.2, np.sin((D.x - cx) * 2 * math.pi / 0.014 + 1.0))
        worn = np.exp(-(((D.x - cx) / 0.02) ** 2 + ((D.y - H / 2 + L * 0.22) / 0.03) ** 2))
        tread = np.maximum(bars, worn * 0.8) * (1 - heel)
        cov = m * (0.25 + 0.6 * tread) * smoothstep(-0.35, 0.25, D.noise(60, 3, 1) + 0.1)
        D.paint(cov * 0.75, srgb('#6e655a'))
    else:
        L = 0.24; parts = []
        def foot(d, ss):
            heel = (cx - m_ * 0.004, H / 2 + L * 0.34, 0.033, 0.042); ball = (cx + m_ * 0.006, H / 2 - L * 0.12, 0.045, 0.034)
            for (x, y, rx, ry) in (heel, ball): d.ellipse(((x - rx) * D.ppm * ss, (y - ry) * D.ppm * ss, (x + rx) * D.ppm * ss, (y + ry) * D.ppm * ss), fill=255)
            d.line([((cx + m_ * 0.03) * D.ppm * ss, (H / 2 + L * 0.3) * D.ppm * ss), ((cx + m_ * 0.035) * D.ppm * ss, (H / 2 - L * 0.05) * D.ppm * ss)], fill=255, width=int(0.016 * D.ppm * ss))
            for k, (tx, ty, tr) in enumerate(((-0.024, -0.37, 0.014), (0.0, -0.395, 0.0105), (0.017, -0.385, 0.0095), (0.031, -0.365, 0.0085), (0.042, -0.335, 0.0075))):
                x, y = cx + m_ * tx, H / 2 + L * ty * 0.95; d.ellipse(((x - tr) * D.ppm * ss, (y - tr * 1.2) * D.ppm * ss, (x + tr) * D.ppm * ss, (y + tr * 1.2) * D.ppm * ss), fill=255)
        m = np.clip(blur(D.mask(foot), 2.0) * 1.2, 0, 1)
        cov = m * (0.6 + 0.4 * smoothstep(-0.2, 0.3, D.noise(120, 3, 2)))
        D.paint(cov * 0.6, srgb('#4f5054'))
    D.h += cov * 0.00005

# ---------------------------------------------------------------- the wall's damage
def crack_paths(D, x0, y0, ang, L, depth, rng, out):
    pts = [(x0, y0)]; x, y = x0, y0; n = max(3, int(L / 0.009)); a0 = ang
    for k in range(n):
        ang += rng.normal(0, 0.12) + (rng.choice((-1, 1)) * rng.uniform(0.3, 0.7) if rng.random() < 0.07 else 0.0)
        ang = a0 + max(-0.9, min(0.9, ang - a0)); x += math.cos(ang) * L / n; y += math.sin(ang) * L / n; pts.append((x, y))
        if depth < 3 and rng.random() < 0.1: crack_paths(D, x, y, ang + rng.choice((-1, 1)) * rng.uniform(0.5, 1.0), L * rng.uniform(0.2, 0.45), depth + 1, rng, out)
    out.append((pts, 0.0032 / (1 + depth * 0.8)))

def g_crack(D, v):
    """a crack network in the plaster: a main crack wandering across, branching, finer branches; its edges chipped a little, dirt in
       it, the paint either side lifted a hair (a dark line with a light lip)"""
    W, H = D.W / D.ppm, D.H / D.ppm; r = D.rng; paths = []
    for k in range(int(r.integers(1, 3))):
        crack_paths(D, r.uniform(0.05, 0.2) * W, r.uniform(0.2, 0.8) * H, r.uniform(-0.6, 0.6), W * r.uniform(0.7, 1.0), 0, r, paths)
    m = D.mask(lambda d, s: [stroke(d, s, [(x * D.ppm, y * D.ppm) for x, y in pts], wd * D.ppm) for pts, wd in paths], 3)
    chip = smoothstep(0.15, 0.4, fbm(D.x, D.y, 200, 2, D.seed + 8)) * np.clip(blur(m, 2) * 3, 0, 1)   # (bits of the edge spalled off)
    m = np.maximum(m * (0.75 + 0.25 * smoothstep(-0.3, 0.2, D.noise(80, 2, 3))), chip * 0.55)
    halo = np.clip(blur(m, 3) * 3, 0, 1)
    D.paint(halo * 0.22, srgb('#6a5a46')); D.paint(m, srgb('#1e1914'))
    D.h -= m * 0.0006; D.h += np.clip(halo - m, 0, 1) * 0.00008

def g_flakes(D, v):
    """paint flaking in a patch: islands of the top coat gone to the coat under it (and in places to the plaster), crisp edges, the
       lifted rims casting a hair of shadow"""
    W, H = D.W / D.ppm, D.H / D.ppm; r = D.rng
    e = blob_mask(D, W / 2, H / 2, W * 0.42, H * 0.42, 0.55, 2.5, 4)
    cells = fbm(D.x, D.y, 45, 3, D.seed + 7) + 0.6 * e - 0.3
    gone = smoothstep(0.0, 0.02, cells); deep = smoothstep(0.18, 0.2, cells + 0.15 * D.noise(30, 2, 9))
    under = srgb(['#b9b19a', '#9fa58f', '#c7b48c', '#a59a86'][v % 4]); plaster = srgb('#a8987e')
    D.paint(gone * 0.95, under * (0.92 + 0.12 * (D.noise(60, 3, 5)[..., None] + 0.5)))
    D.paint(deep * 0.95, plaster * (0.9 + 0.15 * (D.noise(120, 3, 6)[..., None] + 0.5)))
    rim = np.clip(blur(gone, 1.5) * 2 - gone, 0, 1); D.paint(rim * 0.45, srgb('#2c261f'))
    D.h += (1 - gone) * 0.0004 * smoothstep(-0.3, 0.0, cells) - deep * 0.0003

def g_rust(D, v):
    """rust run down the wall from an iron fixing (a nail, a bracket, a pipe clip): the bloom round the source, streaks down from it,
       paler and thinner as they go, orange in the middle of each run and brown at its edges"""
    W, H = D.W / D.ppm, D.H / D.ppm; r = D.rng; sx, sy = W / 2, H * 0.08; cov = np.zeros_like(D.a)
    src = np.exp(-(((D.x - sx) / (W * 0.12)) ** 2 + ((D.y - sy) / (H * 0.04)) ** 2)); cov = np.maximum(cov, src)
    for k in range(int(r.integers(4, 9))):
        x0 = sx + r.normal(0, W * 0.07); L = H * r.uniform(0.35, 0.9); wd = W * r.uniform(0.02, 0.07)
        xx = x0 + 0.004 * np.sin(D.y * 25 + k) + 0.01 * (D.y - sy) * r.normal(0, 0.3)
        run = (1 - smoothstep(wd * 0.3, wd, np.abs(D.x - xx))) * smoothstep(sy, sy + 0.02, D.y) * (1 - smoothstep(sy, sy + L, D.y)) ** 0.7
        cov = np.maximum(cov, run * r.uniform(0.5, 1.0))
    cov = cov * (0.7 + 0.3 * smoothstep(-0.3, 0.3, fbm(D.x * 3, D.y * 0.4, 40, 3, D.seed + 2)))
    D.paint(cov * 0.8, srgb('#7a3a18')); D.paint(np.clip(cov * 1.4 - 0.5, 0, 1) * 0.6, srgb('#a2531f'))
    D.paint(np.exp(-(((D.x - sx) / 0.006) ** 2 + ((D.y - sy) / 0.006) ** 2)), srgb('#2a1a10'))   # (the nail head)
    D.h += cov * 0.00005

def g_ghost(D, v):
    """where a picture hung for fifty years: the wall under it cleaner and less faded (a paler panel, sharp-ish), a band of dust along
       its bottom edge, the nail hole and the cord's two scuffs above"""
    W, H = D.W / D.ppm, D.H / D.ppm; mx, my = W * 0.08, H * 0.12
    inside = smoothstep(0.0, 0.006, np.minimum(np.minimum(D.x - mx, W - mx - D.x), np.minimum(D.y - my, H - my * 0.6 - D.y)))
    D.paint(inside * 0.38 * (0.9 + 0.1 * D.noise(6, 3, 1)), srgb('#efe6d2'))
    bot = (1 - smoothstep(0.0, 0.012, np.abs(D.y - (H - my * 0.6)))) * smoothstep(mx - 0.004, mx + 0.01, D.x) * smoothstep(mx - 0.004, mx + 0.01, W - D.x)
    D.paint(bot * 0.5, srgb('#5a5044'))
    nail = np.exp(-(((D.x - W / 2) / 0.003) ** 2 + ((D.y - my * 0.35) / 0.003) ** 2)); D.paint(nail, srgb('#1a1612')); D.h -= nail * 0.0006
    for sx in (-1, 1):
        cord = (1 - smoothstep(0.0, 0.003, np.abs((D.y - my * 0.35) - (D.x - W / 2) * sx * -0.5))) * (np.abs(D.x - W / 2) < W * 0.3) * (D.y > my * 0.35) * (D.y < my)
        D.paint(cord * 0.25, srgb('#4a4036'))

def g_damp(D, v):
    """rising damp: the wall darker and browner up to an uneven tide line, a fringe of white salts crusting just above it"""
    W, H = D.W / D.ppm, D.H / D.ppm; line = H * (0.3 + 0.12 * fbm(D.x, D.x * 0, 2.5, 3, D.seed + 1) + 0.04 * fbm(D.x, D.x * 0, 14, 2, D.seed + 2))
    wet = smoothstep(0.0, 0.05, D.y - line)
    D.paint(wet * 0.4 * (0.8 + 0.3 * D.noise(5, 3, 3)), srgb('#5a4630'))
    tide = (1 - smoothstep(0.0, 0.03, np.abs(D.y - line))) * 0.55; D.paint(tide, srgb('#4a3824'))
    salt = smoothstep(-0.05, 0.0, line - D.y) * (1 - smoothstep(0.0, 0.07, line - D.y)) * smoothstep(0.05, 0.35, D.noise(90, 3, 4) + 0.15)
    D.paint(salt * 0.85, srgb('#e6e2d6')); D.h += salt * 0.0003

def g_peel_under(D, v):
    """what a strip of wallpaper left when it came away: bare lime plaster with dried paste in brush-wide streaks along the strip, torn
       scraps of the paper and its backing still stuck along the edges, the edge itself ragged"""
    W, H = D.W / D.ppm, D.H / D.ppm
    e = np.minimum(blob_mask(D, W / 2, H / 2, W * 0.46, H * 0.47, 0.25, 3.5, 2), 1 - np.abs(D.x - W / 2) / (W * 0.46) + 0.25 * D.noise(9, 3, 5))
    area = smoothstep(0.0, 0.02, e)
    D.paint(area * 0.92, srgb('#a49b88') * (0.86 + 0.2 * (D.noise(7, 4, 1)[..., None] + 0.5)))
    bx = D.x + 0.08 * np.sin(D.y * 6.0 + D.x * 3.0)                      # (paste in the brush's arcs)
    paste = smoothstep(0.05, 0.4, fbm(bx * 0.6, D.y * 1.6, 22, 3, D.seed + 3)) * smoothstep(-0.2, 0.3, D.noise(5, 2, 13)) * area
    D.paint(paste * 0.32, srgb('#8f7650'))
    D.paint(area * smoothstep(0.2, 0.5, D.noise(40, 3, 14)) * 0.15, srgb('#d9d2c2'))
    scraps = smoothstep(0.0, 0.02, e) * (1 - smoothstep(0.0, 0.06, e)) * smoothstep(0.1, 0.15, D.noise(25, 3, 6))
    D.paint(scraps * 0.9, srgb('#d6c7a4')); D.h += scraps * 0.0002 - area * 0.00015

def g_tile_missing(D, v):
    """the hole a fallen glazed tile left: the grey bed of mortar with the trowel's combing in it, a broken sliver of the tile still in
       one corner, the grout line round it torn"""
    W, H = D.W / D.ppm, D.H / D.ppm; t = 0.15; m0 = (W - t) / 2
    inside = smoothstep(0.0, 0.002, np.minimum(np.minimum(D.x - m0, W - m0 - D.x), np.minimum(D.y - m0, H - m0 - D.y)))
    comb = 0.5 + 0.5 * np.sin((D.x + 0.15 * D.y) * 2 * math.pi / 0.008 + 0.8 * D.noise(30, 2, 1))
    D.paint(inside, srgb('#8d897f') * (0.92 + 0.08 * comb[..., None]) * (0.88 + 0.18 * (D.noise(70, 3, 2)[..., None] + 0.5)))
    sliver = inside * (D.x - m0 + D.y - m0 < 0.035 + 0.01 * D.noise(60, 2, 3)); D.paint(sliver, srgb('#1f4f3a'))
    D.h += -inside * 0.004 + comb * inside * 0.0006 + sliver * 0.0045

def g_height_chart(D, v):
    """a painted height chart by the nursery door: a cream strip with a ruler's marks, and the children's own pencil marks beside it,
       each with a line and a smudge of a name"""
    W, H = D.W / D.ppm, D.H / D.ppm; r = D.rng
    D.paint(np.ones_like(D.a) * 0.95, srgb('#e3d7b8') * (0.9 + 0.12 * (D.noise(12, 3, 1)[..., None] + 0.5)))
    for k in range(int(H / 0.01) + 1):
        y = H - k * 0.01; L = W * (0.45 if k % 10 == 0 else 0.28 if k % 5 == 0 else 0.16)
        D.paint((np.abs(D.y - y) < 0.0007) * (D.x < 0.004 + L), srgb('#2a2018'))
    for k in range(int(r.integers(4, 7))):
        y = H - r.uniform(0.75, 1.3); c = Crayon(D, '#3a3a3a', 0.0016, 0.0005); c.line([(W * 0.45, y), (W * 0.95, y + r.normal(0, 0.002))])
        for st in text_strokes(''.join(r.choice(list('AEILMNORTU'), int(r.integers(3, 5)))), W * 0.55, y - 0.012, 0.012, D): c.line(st)
        c.draw(0.8)
    D.paint(smoothstep(0.0, 0.01, -np.abs(D.y - H / 2) + H / 2) * 0.0, srgb('#000000'))

# ---------------------------------------------------------------- floors and ceilings
def g_floor_puddle(D, v):
    """a puddle's mark: the wet patch (dark, its colour the floor's darkened: grey-blue here), the edge a little darker"""
    W, H = D.W / D.ppm, D.H / D.ppm; e = blob_mask(D, W / 2, H / 2, W * 0.44, H * 0.42, 0.5, 2.2, v)
    for k in range(int(D.rng.integers(0, 3))):
        e = np.maximum(e, blob_mask(D, W * D.rng.uniform(0.2, 0.8), H * D.rng.uniform(0.2, 0.8), W * 0.15, H * 0.15, 0.5, 3, v + 10 + k))
    wet = smoothstep(0.0, 0.08, e); D.paint(wet * 0.55, srgb('#2a2e36')); D.paint((smoothstep(-0.02, 0.0, e) - smoothstep(0.0, 0.03, e)).clip(0, 1) * 0.35, srgb('#1a1c20'))

def g_floor_ring(D, v):
    """a water ring where something stood and the water dried: the tide line, sharp outside, fading inward, a bloom inside"""
    W, H = D.W / D.ppm, D.H / D.ppm; e = blob_mask(D, W / 2, H / 2, W * 0.4, H * 0.4, 0.12, 4.0, v)
    D.paint(smoothstep(-0.03, 0.0, e) * (1 - smoothstep(0.0, 0.12, e)) * 0.6, srgb('#6b5638')); D.paint(smoothstep(0.0, 0.3, e) * 0.12, srgb('#8a7350'))

def g_floor_rust(D, v):
    W, H = D.W / D.ppm, D.H / D.ppm; e = blob_mask(D, W / 2, H / 2, W * 0.38, H * 0.38, 0.1, 4.0, v)
    ring = smoothstep(-0.08, 0.0, e) * (1 - smoothstep(0.0, 0.25, e)); D.paint(ring * 0.7 * (0.6 + 0.6 * D.noise(30, 3, 1)), srgb('#7a3a18'))
    D.paint(smoothstep(0.1, 0.6, e) * 0.25 * (0.5 + D.noise(15, 3, 2)), srgb('#8a4a20'))

def g_floor_scorch(D, v):
    W, H = D.W / D.ppm, D.H / D.ppm; e = blob_mask(D, W / 2, H / 2, W * 0.42, H * 0.42, 0.5, 2.5, v)
    D.paint(smoothstep(-0.1, 0.6, e) * 0.75 * (0.7 + 0.4 * D.noise(20, 4, 1)), srgb('#14100c'))

def g_floor_paint(D, v):
    """a dried paint spill: a pool and its splashes, glossy, cracked where it was thick, the drip marks of the tin's rim"""
    W, H = D.W / D.ppm, D.H / D.ppm; col = srgb(['#8a2a26', '#2f4a7a', '#d8d0bc'][v % 3])
    e = blob_mask(D, W * 0.45, H * 0.5, W * 0.3, H * 0.28, 0.45, 2.5, v)
    for k in range(9): e = np.maximum(e, blob_mask(D, W * D.rng.uniform(0.1, 0.9), H * D.rng.uniform(0.1, 0.9), W * D.rng.uniform(0.01, 0.04), H * D.rng.uniform(0.01, 0.04), 0.3, 2, v * 10 + k))
    m = smoothstep(0.0, 0.03, e); D.paint(m * 0.97, col * (0.9 + 0.15 * (D.noise(20, 3, 3)[..., None] + 0.5)))
    crk = m * smoothstep(0.3, 0.6, e) * (1 - smoothstep(0.0, 0.08, np.abs(fbm(D.x, D.y, 60, 2, D.seed + 9)))); D.paint(crk * 0.6, col * 0.4)
    D.h += m * 0.0006 - crk * 0.0003

def g_floor_dust(D, v):
    """a dust clump: grey fluff, fibres and hair in it, thicker in the middle"""
    W, H = D.W / D.ppm, D.H / D.ppm; e = blob_mask(D, W / 2, H / 2, W * 0.4, H * 0.38, 0.6, 3.0, v)
    fib = smoothstep(0.1, 0.4, np.abs(fbm(D.x * 3, D.y, 120, 3, D.seed + 3))) + smoothstep(0.1, 0.4, np.abs(fbm(D.x, D.y * 3, 120, 3, D.seed + 4)))
    cov = smoothstep(-0.1, 0.5, e) * (0.4 + 0.4 * fib)
    D.paint(cov * 0.85, srgb('#8a857c') * (0.85 + 0.25 * (D.noise(50, 3, 5)[..., None] + 0.5))); D.h += cov * 0.001

def g_ceil_ring(D, v):
    W, H = D.W / D.ppm, D.H / D.ppm; e = blob_mask(D, W / 2, H / 2, W * 0.42, H * 0.42, 0.4, 2.5, v); D.seed += 0
    D.paint(smoothstep(0.0, 0.3, e) * 0.28, srgb('#9a7a4c'))
    for k, l in enumerate((0.0, 0.2, 0.4)):
        ee = e - l + 0.04 * D.noise(20, 3, 10 + k); D.paint(smoothstep(-0.03, 0.0, ee) * (1 - smoothstep(0.0, 0.06, ee)) * (0.65 - 0.15 * k), srgb('#6a4a28'))

def g_ceil_mould(D, v): g_mould(D, v)

def g_ceil_soot(D, v):
    W, H = D.W / D.ppm, D.H / D.ppm; d = np.sqrt((D.x - W / 2) ** 2 + (D.y - H / 2) ** 2) / (min(W, H) * 0.48)
    D.paint((1 - smoothstep(0.2, 1.0, d + 0.15 * D.noise(4, 3, 1))) * 0.7, srgb('#1a1612'))

# ================================================================ the catalogue
ALL = None
#        kind              count  size (m)        px/m   heights          styles
SPEC = [('stain',              8, (0.7, 0.95),     520, (0.6, 2.8),     None),
        ('mould',              4, (0.55, 0.5),     620, (0.0, 2.9),     None),
        ('soot',               2, (0.45, 0.8),     520, (1.9, 3.0),     None),
        ('scratch',            6, (0.3, 0.3),     1300, (0.3, 1.9),     None),
        ('drawing',            8, (0.72, 0.55),    900, (0.25, 1.25),   None),
        ('handprint',          6, (0.2, 0.24),    1500, (0.5, 1.7),     None),
        ('footprint',          4, (0.1, 0.3),     1100, (0.0, 0.0),     None),
        ('crack',              4, (0.8, 0.55),     720, (0.3, 2.9),     None),
        ('flakes',             4, (0.4, 0.36),     900, (0.3, 2.6),     None),
        ('rust',               3, (0.24, 0.62),    720, (0.6, 2.6),     ['concrete', 'workshop', 'attic']),
        ('ghost',              2, (0.5, 0.66),     420, (1.1, 2.2),     None),
        ('damp',               2, (2.0, 0.66),     430, (0.0, 0.7),     None),
        ('peel_under',         4, (0.62, 0.72),    600, (0.4, 1.7),     ['wood', 'tile', 'workshop']),
        ('tile_missing',       2, (0.17, 0.17),   1200, (0.05, 0.85),   ['tile']),
        ('height_chart',       1, (0.22, 1.45),    800, (0.1, 1.55),    ['wood']),
        ('floor_puddle',       8, (0.8, 0.6),      430, (0.0, 0.0),     None),
        ('floor_ring',         6, (0.4, 0.4),      620, (0.0, 0.0),     None),
        ('floor_rust',         2, (0.5, 0.5),      520, (0.0, 0.0),     ['concrete', 'workshop']),
        ('floor_scorch',       2, (0.6, 0.6),      430, (0.0, 0.0),     None),
        ('floor_paint',        3, (0.6, 0.5),      620, (0.0, 0.0),     ['workshop']),
        ('floor_dust',         3, (0.4, 0.3),      720, (0.0, 0.0),     None),
        ('ceil_ring',          2, (0.9, 0.9),      430, (0.0, 0.0),     None),
        ('ceil_mould',         2, (0.6, 0.6),      500, (0.0, 0.0),     None),
        ('ceil_soot',          2, (0.7, 0.7),      430, (0.0, 0.0),     None)]
GEN = {k: globals()['g_' + k] for k, *_ in SPEC}

def make(kind, v, size, ppm):
    D = Decal(size[0], size[1], ppm, seed=hash((kind, v)) & 0xffff)
    GEN[kind](D, v)
    return D

def normals(h, ppm):
    """tangent-space normals from a height (m): OpenGL (green up), a row of pixels down the image is -v"""
    gy, gx = np.gradient(h * ppm)
    n = np.stack([-gx, gy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def bleed(col, a, passes=24):
    """the colour pushed out under the clear pixels (so filtering and mipmaps never pull in black)"""
    w = (a > 0.02).astype(np.float32); c = col * w[..., None]
    for k in range(passes):
        if w.min() > 0: break
        cb = blur(c, 2); wb = blur(w, 2); fill = wb > 1e-4
        c = np.where((w[..., None] > 0), c, np.where(fill[..., None], cb / np.maximum(wb, 1e-4)[..., None], 0)); w = np.maximum(w, fill.astype(np.float32))
    return np.where(w[..., None] > 0, c, col.mean((0, 1)))

def pack(items):
    """skyline packing (each piece, tallest first, where it ends lowest; then leftmost): -> {key: (x, y)}"""
    sky = np.zeros(ATLAS // 4 + 1, np.int64); out = {}                 # (the skyline in 4 px columns)
    for k in sorted(items, key=lambda k: (-items[k][1], -items[k][0])):
        w, h = items[k]; cw = (w + PAD + 3) // 4; best = None
        for c in range(0, len(sky) - cw):
            y = int(sky[c:c + cw].max())
            if y + h + PAD > ATLAS: continue
            if best is None or y < best[1]: best = (c, y)
        if best is None: raise SystemExit(f'decals: atlas full at {k}')
        c, y = best; out[k] = (c * 4 + PAD, y + PAD); sky[c:c + cw] = y + h + PAD
    return out

def main():
    t0 = time.time(); os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
    only = None
    if '--only' in sys.argv: only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    decals = {}
    for kind, n, size, ppm, hts, styles in SPEC:
        for v in range(n):
            if only and kind not in only: continue
            t = time.time(); D = make(kind, v, size, ppm); decals[(kind, v)] = D
            print(f'  {kind}_{v}: {D.W}x{D.H}, {time.time() - t:.1f}s', flush=True)
    if only:
        review(decals); return
    pos = pack({k: (D.W, D.H) for k, D in decals.items()})
    A = np.zeros((ATLAS, ATLAS, 4), np.float32); N = np.zeros((ATLAS, ATLAS, 3), np.float32); N[..., :] = (0.5, 0.5, 1.0)
    entries = []
    for (kind, n, size, ppm, hts, styles) in SPEC:
        for v in range(n):
            D = decals[(kind, v)]; x, y = pos[(kind, v)]
            col = bleed(D.col, D.a); A[y:y + D.H, x:x + D.W, :3] = col; A[y:y + D.H, x:x + D.W, 3] = D.a
            N[y:y + D.H, x:x + D.W] = normals(blur(D.h, 0.7), D.ppm)
            entries.append({'id': f'{kind}_{v}', 'rect': [int(x), int(y), int(D.W), int(D.H)], 'size_m': [round(D.W / D.ppm, 3), round(D.H / D.ppm, 3)],
                            'kinds': [kind] + (['floor'] if kind.startswith('floor_') else []), 'heights': list(hts), 'styles': styles})
    A[..., :3] = bleed(A[..., :3], A[..., 3], 6)                       # (between the decals too)
    for tier, k in (('hi', 1), ('md', 2), ('lo', 4)):
        s = ATLAS // k
        al = Image.fromarray((np.clip(A, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA'); nm = Image.fromarray((np.clip(N, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
        if k > 1: al = al.resize((s, s), Image.LANCZOS); nm = nm.resize((s, s), Image.LANCZOS)
        al.save(os.path.join(OUT, f'decals_albedo.{tier}.webp'), 'WEBP', quality=88, alpha_quality=100, method=6)
        nm.save(os.path.join(OUT, f'decals_normal.{tier}.webp'), 'WEBP', quality=92, method=6)
    json.dump({'version': 1, 'W': ATLAS, 'H': ATLAS, 'note': 'rect in px of the hi atlas (4096; y down): scale by image width / W for md and lo',
               'decals': entries}, open(os.path.join(OUT, 'decals.json'), 'w'), indent=0)
    print(f'decals: {len(entries)} in the atlas, {time.time() - t0:.0f}s')
    if '--review' in sys.argv: review(decals)

def review(decals):
    """each decal over a wall (or floor) of the house, in a grid: what it will look like on a wall, not on black"""
    from surfaces2 import manifest_load
    surf = os.path.join(defs.REPO, 'textures', 'surf'); man = manifest_load()['styles']
    def bg(style, kind, w, h):
        e = man[style]['floor' if kind.startswith('floor') else 'ceil' if kind.startswith('ceil') else 'wall']; key = 'colorA' if 'colorA' in e['files'] else 'color'
        im = Image.open(os.path.join(surf, e['files'][key] + '.md.webp')).convert('RGB')
        return np.asarray(im.crop((0, 0, min(im.width, w), min(im.height, h))).resize((w, h)), np.float32) / 255
    tiles = []
    for (kind, v), D in decals.items():
        st = ['wood', 'tile', 'concrete', 'attic', 'workshop'][v % 5]
        b = bg(st, kind, D.W, D.H) ** 2.2; c = D.col ** 2.2; a = D.a[..., None]
        o = (b * (1 - a) + c * a) ** (1 / 2.2)
        tiles.append(Image.fromarray((np.clip(o, 0, 1) * 255).astype(np.uint8)).resize((max(1, D.W * 300 // max(D.W, D.H)), max(1, D.H * 300 // max(D.W, D.H)))))
    cols = 6; rows = (len(tiles) + cols - 1) // cols; sheet = Image.new('RGB', (cols * 310, rows * 310), (20, 20, 20))
    for i, t in enumerate(tiles): sheet.paste(t, ((i % cols) * 310 + 5, (i // cols) * 310 + 5))
    p = os.path.join(WORK, 'review.png'); sheet.save(p); print('review:', p)

if __name__ == '__main__':
    main()
