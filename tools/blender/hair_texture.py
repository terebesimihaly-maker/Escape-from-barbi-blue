# The hair strand texture: four clumps of individual strands (neutral grey so any hair colour can tint it), soft edges and
# thinning tips at the bottom (v = 0), roots at the top. Writes an RGBA PNG.
import numpy as np, sys
from PIL import Image
def make(path, W=512, H=1024, seed=7):
    rng = np.random.default_rng(seed)
    col = np.zeros((H, W), np.float32); cov = np.zeros((H, W), np.float32)
    ys = np.linspace(1.0, 0.0, H)[:, None]                       # (1 = the root, at the top of the picture)
    xs = np.arange(W)[None, :].astype(np.float32)
    for c in range(4):
        cx0 = (c + 0.5) * W / 4
        for s in range(150):
            x0 = cx0 + rng.normal(0, W / 4 * 0.2); wid = rng.uniform(0.5, 1.6)
            tip = rng.uniform(0.0, 0.35)                           # (where this strand ends: some stop short, so the tips thin out)
            amp = rng.uniform(0, 2.5); fr = rng.uniform(3, 9); ph = rng.uniform(0, 6.3)
            bright = rng.uniform(0.55, 1.0)
            xc = x0 + amp * np.sin(ys * fr * 6.28 + ph) + (1 - ys) * rng.normal(0, 4)
            a = np.clip(1.2 - np.abs(xs - xc) / wid, 0, 1)         # (the strand's profile)
            a *= np.clip((ys - tip) / 0.08, 0, 1)                  # (it tapers off at its tip)
            a *= rng.uniform(0.6, 1.0)
            col = col * (1 - a) + bright * a; cov = 1 - (1 - cov) * (1 - a)
    # a little darker at the roots, lighter towards the ends; fine grain along the strands
    grain = 0.9 + 0.1 * rng.random((1, W)).astype(np.float32)
    shade = (0.72 + 0.28 * (1 - ys) ** 0.7) * grain
    rgb = np.clip(col * shade / np.maximum(cov, 1e-3), 0, 1) * np.minimum(cov * 4, 1)
    rgb = np.where(cov > 0.02, np.clip(col * shade / np.maximum(cov, 1e-3), 0, 1), 0.5)
    alpha = np.clip(cov * 1.35, 0, 1)
    img = np.dstack([rgb * 0.92, rgb * 0.92, rgb * 0.92, alpha])
    Image.fromarray((img * 255).astype(np.uint8), 'RGBA').save(path)
if __name__ == '__main__': make(sys.argv[1] if len(sys.argv) > 1 else '/tmp/efbb-player/hair_strands.png')
