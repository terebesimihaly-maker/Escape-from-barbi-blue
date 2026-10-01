# Cloth textures for the players' clothes (tileable, 512 x 512, about 5 cm of cloth): a fine jersey knit (T-shirts, long
# sleeves, skirt, shoes), a brushed fleece (hoodie: soft, the knit barely showing, a heathered look) and a twill (trousers,
# shorts). Kept gentle: seen from a few metres a fabric is an even, slightly uneven colour, not a pattern. Each: a colour map (near white: the player's colour tints it) and a normal map.
import numpy as np, sys, os
from PIL import Image
def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.dstack([-gx, gy, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)
def tile_noise(N, cells, rng):
    # smooth tileable noise: random values on a coarse grid, interpolated (wrapping)
    g = rng.random((cells, cells)); x = np.linspace(0, cells, N, endpoint=False); i = x.astype(int); f = x - i; f = f * f * (3 - 2 * f)
    a = g[np.ix_(i % cells, i % cells)]; b = g[np.ix_(i % cells, (i + 1) % cells)]; c = g[np.ix_((i + 1) % cells, i % cells)]; d = g[np.ix_((i + 1) % cells, (i + 1) % cells)]
    fx = f[None, :]; fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
def knit(N=512, rows=40, seed=3):
    rng = np.random.default_rng(seed); y, x = np.mgrid[0:N, 0:N] / N
    # rows of V-shaped stitches: two slanted loops side by side in each column
    cols = rows * 1.25; u = (x * cols) % 1.0; v = (y * rows) % 1.0
    loopL = np.exp(-((u - 0.28 - (v - 0.5) * 0.35) ** 2) / 0.018) ; loopR = np.exp(-((u - 0.72 + (v - 0.5) * 0.35) ** 2) / 0.018)
    h = np.maximum(loopL, loopR) * (0.65 + 0.35 * np.sin(v * np.pi))
    h += 0.15 * tile_noise(N, 32, rng)
    alb = 0.88 + 0.05 * h + 0.05 * (tile_noise(N, 8, rng) - 0.5) + 0.03 * (tile_noise(N, 3, rng) - 0.5)
    return alb, normal_from_height(h, 0.9)
def fleece(N=512, seed=4):
    rng = np.random.default_rng(seed)
    a, n = knit(N, rows=48, seed=seed)
    fuzz = tile_noise(N, 128, rng) * 0.6 + tile_noise(N, 48, rng) * 0.4                # (brushed fibres over the knit)
    heather = (rng.random((N, N)) < 0.04) * rng.uniform(-0.12, 0.1, (N, N))            # (a few lighter and darker fibres)
    alb = np.clip(0.86 + 0.06 * (fuzz - 0.5) + heather + 0.04 * (tile_noise(N, 4, rng) - 0.5), 0, 1)
    h = fuzz * 0.6
    return alb, normal_from_height(h, 0.5)
def twill(N=512, lines=56, seed=5):
    rng = np.random.default_rng(seed); y, x = np.mgrid[0:N, 0:N] / N
    d = ((x + y) * lines) % 1.0                                      # (the diagonal ribs)
    h = np.sin(d * np.pi) ** 2 * 0.8 + 0.2 * tile_noise(N, 64, rng)
    slub = tile_noise(N, 8, rng)                                     # (uneven yarn: lighter and darker streaks)
    alb = 0.84 + 0.07 * h + 0.07 * (slub - 0.5) + 0.03 * (tile_noise(N, 3, rng) - 0.5)
    return alb, normal_from_height(h, 0.8)
if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/efbb-player'; os.makedirs(out, exist_ok=True)
    for name, fn in (('knit', knit), ('fleece', fleece), ('twill', twill)):
        alb, nor = fn()
        Image.fromarray((np.clip(alb, 0, 1) * 255).astype(np.uint8), 'L').convert('RGB').save(f'{out}/cloth_{name}.png')
        Image.fromarray(nor, 'RGB').save(f'{out}/cloth_{name}_n.png')
    print('ok')
