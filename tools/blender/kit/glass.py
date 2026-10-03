# Escape from Barbi Blue: the windows' glass (WP2.7; build spec B10; js/atmos.js glassMaterial).
#   textures/glass/rain_normal.webp  1024 x 1024, tiles: tangent-space normals (OpenGL, green up) of rain on the pane: a mist of fine
#                                    droplets, beads of every size, a few big drops that let go and ran, leaving a clean wet track
#                                    with a bead at its foot
#   textures/glass/grime_orm.webp    1024 x 1024, tiles: R occlusion (1), G roughness (clean glass 0.06; a film of grime thicker
#                                    toward the bottom of the tile, dried water spots ringed with lime, finger smears, cobweb dust in
#                                    patches), B metalness 0
# The tile is taken as 0.6 m of glass (0.59 mm a pixel). Every noise and every drop wraps round the tile's edges.
#   py -3.11 tools/blender/kit/glass.py
import os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np
from PIL import Image
import defs

S = 1024; TILE_M = 0.6; PX_M = TILE_M / S
OUT = os.path.join(defs.REPO, 'textures', 'glass')

def pnoise(f, seed):
    """value noise with f cells across the tile, wrapping (a periodic lattice)"""
    T = np.random.default_rng(seed).random((f, f)).astype(np.float32) * 2 - 1
    c = (np.arange(S) + 0.5) / S * f; i0 = np.floor(c).astype(int); fr = c - i0; s = fr * fr * (3 - 2 * fr); i1 = (i0 + 1) % f; i0 %= f
    a = T[i0][:, i0] * (1 - s)[None, :] + T[i0][:, i1] * s[None, :]; b = T[i1][:, i0] * (1 - s)[None, :] + T[i1][:, i1] * s[None, :]
    return a * (1 - s)[:, None] + b * s[:, None]

def pfbm(f, octaves, seed, rough=0.5):
    out, a, t = 0.0, 1.0, 0.0
    for k in range(octaves): out = out + a * pnoise(f * 2 ** k, seed + 13 * k); t += a; a *= rough
    return out / t

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def stamp(h, cx, cy, r, height, squash=1.0, mode='max'):
    """a droplet: a spherical cap of radius r px (squashed vertically), wrapping round the tile"""
    R = int(math.ceil(r * max(1.0, 1 / squash))) + 2
    ys, xs = np.mgrid[-R:R + 1, -R:R + 1]; dy = (ys + (cy - round(cy))) / squash; dx = xs + (cx - round(cx))
    q = 1 - (dx * dx + dy * dy) / (r * r); cap = np.where(q > 0, np.sqrt(np.clip(q, 0, 1)) * height, 0)
    yy = (ys + int(round(cy))) % S; xx = (xs + int(round(cx))) % S
    h[yy, xx] = np.maximum(h[yy, xx], cap) if mode == 'max' else h[yy, xx] + cap
    return cap > 0, yy, xx

def main():
    os.makedirs(OUT, exist_ok=True); rng = np.random.default_rng(11)
    h = np.zeros((S, S), np.float32); wet = np.zeros((S, S), np.float32)
    # the mist of tiny droplets, denser in patches (where the wind threw it)
    dens = smoothstep(-0.3, 0.4, pfbm(4, 3, 1))
    for k in range(26000):
        x, y = rng.random() * S, rng.random() * S
        if rng.random() > 0.25 + 0.75 * dens[int(y), int(x)]: continue
        r = rng.uniform(0.7, 2.4); stamp(h, x, y, r, r * rng.uniform(0.3, 0.45))
    # beads, every size
    for k in range(2600):
        r = rng.pareto(2.2) * 1.6 + 2.0
        if r > 16: continue
        stamp(h, rng.random() * S, rng.random() * S, r, r * rng.uniform(0.4, 0.55), squash=rng.uniform(0.85, 1.05))
    # runs: a drop grew heavy and ran down, wiping a wet track clear of the mist, a bead at its foot, small beads left along it
    for k in range(14):
        x = rng.random() * S; y0 = rng.random() * S; L = rng.uniform(120, 520); w = rng.uniform(3.0, 6.5)
        n = int(L / 2); xs_ = x + np.cumsum(rng.normal(0, 0.55, n)); ys_ = y0 + np.arange(n) * 2.0
        for i in range(n):
            yy = int(ys_[i]) % S; xa = int(xs_[i] - w) ; xb = int(xs_[i] + w)
            cols = np.arange(xa, xb + 1) % S
            wet[yy, cols] = 1.0                                             # (the track: the mist wiped off, a thin film)
            if rng.random() < 0.03: r = rng.uniform(1.5, 3.5); stamp(h, xs_[i] + rng.normal(0, w * 0.6), ys_[i], r, r * 0.45)
        stamp(h, xs_[-1], ys_[-1] + w, w * 1.15, w * 0.6, squash=1.2)
    for _ in range(3): wet = (wet + np.roll(wet, 1, 0) + np.roll(wet, -1, 0) + np.roll(wet, 1, 1) + np.roll(wet, -1, 1)) / 5   # (soft-edged)
    h = h * (1 - 0.88 * smoothstep(0.1, 0.8, wet))
    film = smoothstep(0.0, 1.0, wet) * 0.6                                  # (the film along a run: a gentle trough)
    hh = h - film
    gy, gx = np.gradient(np.pad(hh, 1, mode='wrap'))
    gx, gy = gx[1:-1, 1:-1], gy[1:-1, 1:-1]
    n = np.stack([-gx * 0.9, gy * 0.9, np.ones_like(hh)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'rain_normal.webp'), 'WEBP', quality=92, method=6)
    # grime: a film (thicker low on the tile), dried spots ringed with lime, finger smears, dust; the runs washed cleaner
    yv = np.linspace(0, 1, S, endpoint=False)[:, None]
    film = np.clip(0.35 + 0.5 * pfbm(3, 4, 21) + 0.25 * np.sin(2 * math.pi * yv) * 0.0, 0, 1) * 0.5 + 0.5 * smoothstep(-0.2, 0.4, pfbm(6, 4, 22))
    spots = np.zeros((S, S), np.float32)
    for k in range(260):
        r = rng.uniform(3, 12); cx, cy = rng.random() * S, rng.random() * S; ph = rng.uniform(0, 6.28, 3)
        R = int(r * 1.3) + 2; ys, xs = np.mgrid[-R:R + 1, -R:R + 1]; ang = np.arctan2(ys, xs)
        d = np.sqrt(xs ** 2 + ys ** 2) / (r * (1 + 0.15 * np.sin(2 * ang + ph[0]) + 0.1 * np.sin(3 * ang + ph[1]) + 0.06 * np.sin(5 * ang + ph[2])))
        ring = (np.clip(1 - np.abs(d - 0.92) / 0.14, 0, 1) * 0.6 + np.clip(1 - d, 0, 1) * 0.2) * rng.uniform(0.4, 1.0)
        yy = (ys + int(cy)) % S; xx = (xs + int(cx)) % S; spots[yy, xx] = np.maximum(spots[yy, xx], ring)
    prints = np.zeros((S, S), np.float32)
    for k in range(10):                                                     # (finger smears: ovals of ridged grease, in clusters)
        cx, cy = rng.random() * S, rng.random() * S
        for f in range(rng.integers(2, 5)):
            px, py = cx + rng.normal(0, 25), cy + rng.normal(0, 25); a, b = rng.uniform(14, 22), rng.uniform(20, 30); th = rng.uniform(0, math.pi)
            R = int(b) + 3; ys, xs = np.mgrid[-R:R + 1, -R:R + 1]; c, s = math.cos(th), math.sin(th)
            u = (xs * c + ys * s) / a; v = (-xs * s + ys * c) / b; d = np.sqrt(u * u + v * v)
            ridge = 0.5 + 0.5 * np.sin(np.sqrt(xs ** 2 + (ys * 1.3) ** 2) * 1.6)
            val = np.clip(1 - d, 0, 1) ** 0.5 * (0.5 + 0.5 * ridge)
            yy = (ys + int(py)) % S; xx = (xs + int(px)) % S; prints[yy, xx] = np.maximum(prints[yy, xx], val)
    rough = 0.06 + 0.32 * film ** 1.5 + 0.35 * spots + 0.3 * prints
    rough = rough * (1 - 0.6 * smoothstep(0.0, 1.0, wet))
    rough = np.clip(rough + 0.08 * smoothstep(0.3, 0.7, pfbm(24, 3, 23)) * film, 0.03, 0.9)
    orm = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1)
    Image.fromarray((orm * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'grime_orm.webp'), 'WEBP', quality=90, method=6)
    print('glass ->', OUT)

if __name__ == '__main__':
    main()
