# The flashlight's beam pattern (textures/flashlight_cookie.webp): what a real torch throws on a wall. A hot centre with a
# faint square imprint of the LED, the bright ring off the reflector's rim, a dimmer spill with streaks from the reflector's
# facets, specks of dust on the lens, and the edge falling off to black.
import numpy as np, os, sys
from PIL import Image, ImageFilter
N = 512; y, x = (np.mgrid[0:N, 0:N] - N / 2 + 0.5) / (N / 2); r = np.hypot(x, y); a = np.arctan2(y, x)
rng = np.random.default_rng(5)
hot = np.exp(-(r / 0.22) ** 2) * 1.0
die = np.exp(-((np.maximum(abs(x), abs(y)) / 0.07) ** 6)) * 0.12
ring = np.exp(-((r - 0.5) / 0.07) ** 2) * 0.13 + np.exp(-((r - 0.33) / 0.05) ** 2) * 0.05
spill = np.clip(1 - r, 0, 1) ** 0.7 * 0.55
facets = 1 + 0.035 * np.sin(a * 36 + 0.4 * np.sin(a * 7)) * np.clip((r - 0.2) / 0.6, 0, 1)
dust = np.ones((N, N))
for _ in range(90):
    cx, cy, rad = rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), rng.uniform(0.01, 0.06)
    dust -= rng.uniform(0.02, 0.08) * np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / rad ** 2))
edge = np.clip((0.98 - r) / 0.12, 0, 1) ** 1.5
v = np.clip((hot + die + ring + spill) * facets * dust * edge, 0, 1) ** 0.85
img = Image.fromarray((v * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(1.2)).convert('RGB')
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'textures', 'flashlight_cookie.webp')
img.save(out, 'WEBP', quality=90); print('wrote', out)
