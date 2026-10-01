# Escape from Barbi Blue: the players' hair textures (grey, so the game can tint them any colour).
#   cards(path):  hair cards, 1024 x 1024, four columns of strand clumps: roots at the top (v = 1), tips at the bottom.
#                 Columns 0-2: loose clumps that thin out towards the tips; column 3: a dense clump for the inner layers.
#   scalp(path):  the scalp, 2048 x 1024, in the head's spherical layout (u round the head, front at 0.5; v up the head):
#                 thousands of short hairs inside a natural hairline, the skin showing through where they thin out.
#   facial(path): facial hair, 1024 x 1024, tiling: short coarse hairs for stubble and beards.
import numpy as np, math
from PIL import Image, ImageDraw, ImageFilter

def _strands(W, H, rng, n, x_mid, spread, len_lo, len_hi, wid, wave, dense=False):
    """n strands down a column (a 2-D picture of coverage and brightness); tips taper off"""
    cov = np.zeros((H, W), np.float32); col = np.zeros((H, W), np.float32)
    ys = np.linspace(0, 1, H, dtype=np.float32)[:, None]          # (0 = the root, at the top)
    xs = np.arange(W, dtype=np.float32)[None, :]
    for _ in range(n):
        x0 = x_mid + rng.normal(0, spread); L = rng.uniform(len_lo, len_hi)
        w = rng.uniform(*wid); br = rng.uniform(0.55, 1.0) if rng.random() > 0.06 else rng.uniform(1.0, 1.25)   # (a few light strands)
        amp, fr, ph = rng.uniform(0, wave), rng.uniform(1.5, 5), rng.uniform(0, 6.3)
        drift = rng.normal(0, spread * 0.25)
        xc = x0 + amp * np.sin(ys * fr * 6.283 + ph) + drift * ys ** 1.5
        a = np.clip(1.0 - np.abs(xs - xc) / w, 0, 1) ** 1.5            # (a round strand, soft at its sides)
        taper = np.clip((L - ys) / (0.12 if not dense else 0.05), 0, 1)
        a = a * taper * rng.uniform(0.75, 1.0)
        col = col * (1 - a) + br * a; cov = 1 - (1 - cov) * (1 - a)
    return cov, col

def cards(path, S=1024, seed=11):
    rng = np.random.default_rng(seed); W = S // 4
    out = np.zeros((S, S, 4), np.float32)
    for c in range(4):
        dense = c == 3
        cov, col = _strands(W, S, rng, 900 if dense else 520, W / 2, W * (0.16 if dense else 0.2), 0.7 if dense else 0.45, 1.0,
                            (0.7, 1.5), 3.0 if not dense else 1.5, dense)
        ys = np.linspace(0, 1, S, dtype=np.float32)[:, None]
        shade = 0.62 + 0.38 * ys ** 0.6                              # (darker at the roots, where less light gets in)
        rgb = np.where(cov > 1e-3, col / np.maximum(1 - (1 - cov), 1e-3), 0.6) * shade
        alpha = np.clip(cov * (1.25 if not dense else 1.6), 0, 1)
        # (the card's own edges: always fully clear at the sides, so no straight edge ever shows)
        edge = np.clip(np.minimum(np.arange(W), W - 1 - np.arange(W)) / (W * 0.06), 0, 1)[None, :]
        alpha *= edge
        alpha *= np.clip(ys / 0.1, 0, 1) ** 1.5                     # (the root end fades in: no card ever starts with a straight edge)
        out[:, c * W:(c + 1) * W, 0] = out[:, c * W:(c + 1) * W, 1] = out[:, c * W:(c + 1) * W, 2] = np.clip(rgb, 0, 1)
        out[:, c * W:(c + 1) * W, 3] = alpha
    # (dilate the colour into the clear parts, so filtering never pulls in black at the strands' edges)
    img = Image.fromarray((out * 255).astype(np.uint8), 'RGBA')
    img.save(path)

def curls(path, S=1024, seed=15):
    """curly locks for hair cards: like cards(), but every strand coils (a ringlet seen from the side), four columns"""
    rng = np.random.default_rng(seed); W = S // 4; SS = 2
    out = np.zeros((S, S, 4), np.float32)
    for c in range(4):
        big = Image.new('L', (W * SS, S * SS), 0); dc = Image.new('L', big.size, 0)
        g, gc = ImageDraw.Draw(big), ImageDraw.Draw(dc)
        turns = rng.uniform(5, 7); amp0 = W * rng.uniform(0.17, 0.22)
        for k in range(260 if c < 3 else 420):
            ph = rng.uniform(0, 6.283) * 0.25 + rng.normal(0, 0.35); amp = amp0 * rng.uniform(0.7, 1.15); L = rng.uniform(0.6, 1.0)
            x0 = W / 2 + rng.normal(0, W * 0.05); br = int(rng.uniform(120, 255)); pts = []
            for i in range(160):
                t = i / 159 * L
                a = ph + t * turns * 6.283
                x = x0 + amp * np.sin(a) * (0.55 + 0.45 * min(1, t * 4)); y = t * S
                pts.append((x * SS, y * SS))
            for j in range(len(pts) - 1):
                t = j / len(pts)
                w = max(1, int(SS * (1.6 - 1.0 * t)))
                g.line([pts[j], pts[j + 1]], fill=int(255 * min(1, (L - t * L) / 0.08 + 0.2)), width=w); gc.line([pts[j], pts[j + 1]], fill=br, width=w)
        cov = np.asarray(big.resize((W, S), Image.LANCZOS)).astype(np.float32) / 255
        col = np.asarray(dc.resize((W, S), Image.LANCZOS)).astype(np.float32) / 255
        ys = np.linspace(0, 1, S, dtype=np.float32)[:, None]
        rgb = np.where(cov > 0.02, col / np.maximum(cov, 1e-3), 0.55) * (0.65 + 0.35 * ys ** 0.6)
        edge = np.clip(np.minimum(np.arange(W), W - 1 - np.arange(W)) / (W * 0.05), 0, 1)[None, :]
        out[:, c * W:(c + 1) * W, :3] = np.clip(rgb, 0, 1)[..., None]; out[:, c * W:(c + 1) * W, 3] = np.clip(cov * 1.5, 0, 1) * edge * np.clip(ys / 0.1, 0, 1) ** 1.5
    Image.fromarray((out * 255).astype(np.uint8), 'RGBA').save(path)

def fur(path, S=512, seed=16):
    """the hairs of short hair, seen end on (tiling): colour = how light each hair is, alpha = how far it stands out (0 = no hair).
    Each hair is thickest at its root and thins to its tip, so the higher layers only keep its core (js/player-model.js)."""
    rng = np.random.default_rng(seed)
    hgt = np.zeros((S, S), np.float32); col = np.full((S, S), 0.7, np.float32)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    for _ in range(1900):                                              # (clumps of a few hairs: wide enough to see from a metre away)
        cx, cy, r = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(4.5, 8.5)
        h, br = rng.uniform(0.5, 1.0), rng.uniform(0.35, 1.0) if rng.random() > 0.06 else 1.2
        x0, x1, y0, y1 = int(cx - r - 1), int(cx + r + 2), int(cy - r - 1), int(cy + r + 2)
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                a0, a1, b0, b1 = max(0, x0 + ox), min(S, x1 + ox), max(0, y0 + oy), min(S, y1 + oy)
                if a0 >= a1 or b0 >= b1: continue
                d = np.hypot(xx[b0:b1, a0:a1] - (cx + ox), yy[b0:b1, a0:a1] - (cy + oy)) / r
                prof = np.clip(1 - d, 0, 1) ** 0.6 * h                 # (its height here: the middle reaches the tip)
                m = prof > hgt[b0:b1, a0:a1]
                hgt[b0:b1, a0:a1] = np.where(m, prof, hgt[b0:b1, a0:a1]); col[b0:b1, a0:a1] = np.where(m, br, col[b0:b1, a0:a1])
    out = np.dstack([col, col, col, hgt])
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA').save(path)

def hairline(az):
    """the hairline's elevation (degrees) at an angle round the head (degrees, 0 = the middle of the forehead)"""
    a = abs(az)
    pts = [(0, 31), (18, 33), (36, 37), (48, 31), (60, 14), (68, -6), (74, -16), (82, -16), (86, -2), (94, 9), (104, 12),
           (114, 8), (124, -12), (134, -30), (150, -40), (180, -43)]
    for (a0, e0), (a1, e1) in zip(pts, pts[1:]):
        if a <= a1: t = (a - a0) / (a1 - a0); t = t * t * (3 - 2 * t); return e0 + (e1 - e0) * t
    return pts[-1][1]

EL0, EL1 = -55.0, 90.0                                               # (v = 0 at 55 degrees below the middle, 1 at the top)
def scalp(path, W=2048, H=1024, seed=12, sharp=False):
    """sharp: the outline only (for the extra layers of a buzz cut: hair stands a little above the scalp)"""
    rng = np.random.default_rng(seed); SS = 2                         # (drawn at twice the size, then made smaller: smooth hairs)
    big = Image.new('L', (W * SS, H * SS), 0); dc = Image.new('L', (W * SS, H * SS), 0)
    g, gc = ImageDraw.Draw(big), ImageDraw.Draw(dc)
    def el_of(v): return EL0 + (EL1 - EL0) * v
    n = 260000
    us, vs = rng.random(n), rng.random(n)
    for u, v in zip(us, vs):
        az = (u - 0.5) * 360; el = el_of(v)
        h = hairline(az)
        if el < h - 3: continue
        # (the way the hair grows: away from the crown, down the back and sides, forwards over the forehead)
        cosel = max(0.08, math.cos(math.radians(el)))
        ang = rng.normal(0, 0.35); L = rng.uniform(5, 13) * SS
        dx, dy = math.sin(ang) * L / cosel * 0.5, math.cos(ang) * L        # (down the picture = down the head; u squeezes near the top)
        x, y = u * W * SS, (1 - v) * H * SS
        br = int(rng.uniform(120, 255))
        g.line([(x, y), (x + dx, y + dy)], fill=255, width=SS)
        gc.line([(x, y), (x + dx, y + dy)], fill=br, width=SS)
    big = big.resize((W, H), Image.LANCZOS); dc = dc.resize((W, H), Image.LANCZOS)
    cov = np.asarray(big).astype(np.float32) / 255; col = np.asarray(dc).astype(np.float32) / 255
    # how much hair there is: full inside, thinning out over a few degrees at the hairline (with little gaps and strays)
    uu = (np.arange(W) + 0.5) / W; vv = 1 - (np.arange(H) + 0.5) / H
    AZ = (uu[None, :] - 0.5) * 360; EL = el_of(vv[:, None])
    HL = np.vectorize(hairline)(AZ[0])[None, :]
    noise = np.asarray(Image.fromarray((rng.random((H // 8, W // 8)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float32) / 255
    d = EL - (HL + (noise - 0.5) * 3.5)
    dens = np.clip(d / 5.0 + 0.35, 0, 1) ** 1.3
    # the skin shows through a little everywhere (a buzz cut), more at the hairline; the hair's colour stays even
    cov_s = np.asarray(Image.fromarray((cov * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    # (the alpha is how much hair there is, nothing else: full on the scalp, thinning out over a few degrees at the hairline)
    alpha = np.clip(d / 6.0 + 0.3, 0, 1) ** 1.2 if not sharp else np.clip(cov * 1.6, 0, 1) * np.clip(d / 4.0, 0, 1)
    rgb = np.full_like(alpha, 0.55) if not sharp else np.clip(np.where(cov > 0.02, col / np.maximum(cov, 1e-3), 0.55) * 0.92, 0, 1)
    out = np.dstack([rgb, rgb, rgb, alpha])                          # (the game only reads the alpha: how much hair there is)
    Image.fromarray((out * 255).astype(np.uint8), 'RGBA').save(path)

def facial(path, S=1024, seed=13):
    """tiling coarse short hairs (a stubble or beard layer); the beard's own shape comes from the mesh's vertex colours"""
    rng = np.random.default_rng(seed); SS = 2
    big = Image.new('L', (S * SS * 3, S * SS * 3), 0); dc = Image.new('L', big.size, 0)
    g, gc = ImageDraw.Draw(big), ImageDraw.Draw(dc)
    for _ in range(90000):                                            # (drawn on a 3 x 3 tile and the middle cut out: seamless)
        x, y = rng.uniform(S * SS, 2 * S * SS), rng.uniform(S * SS, 2 * S * SS)
        ang = rng.normal(0, 0.45); L = rng.uniform(6, 16) * SS
        bend = rng.normal(0, 0.3)
        pts = [(x, y)]
        for k in range(3):
            a = ang + bend * k; x += math.sin(a) * L / 3; y += math.cos(a) * L / 3; pts.append((x, y))
        br = int(rng.uniform(110, 255))
        for ox in (-S * SS, 0, S * SS):
            for oy in (-S * SS, 0, S * SS):
                q = [(px + ox, py + oy) for px, py in pts]
                g.line(q, fill=255, width=int(SS * 1.4)); gc.line(q, fill=br, width=int(SS * 1.4))
    c = (S * SS, S * SS, 2 * S * SS, 2 * S * SS)
    cov = np.asarray(big.crop(c).resize((S, S), Image.LANCZOS)).astype(np.float32) / 255
    col = np.asarray(dc.crop(c).resize((S, S), Image.LANCZOS)).astype(np.float32) / 255
    rgb = np.where(cov > 0.02, col / np.maximum(cov, 1e-3), 0.5)
    out = np.dstack([rgb, rgb, rgb, np.clip(cov * 1.4, 0, 1)])
    Image.fromarray((out * 255).astype(np.uint8), 'RGBA').save(path)

if __name__ == '__main__':
    import sys, os
    d = sys.argv[1] if len(sys.argv) > 1 else '/tmp/efbb-player'; os.makedirs(d, exist_ok=True)
    cards(d + '/hair_cards.png'); curls(d + '/hair_curls.png'); fur(d + '/hair_fur.png'); scalp(d + '/hair_scalp.png'); scalp(d + '/hair_scalp_tips.png', seed=14, sharp=True); facial(d + '/facial_hair.png')
    print('ok')
