# Escape from Barbi Blue: the ambient-occlusion curves the light baker and the floor overlays use (WP2.7; build spec B10;
# js/lightbake.js and js/surface.js aoCurves).
#   textures/light/ao_profiles.json  {curves: {inside, outside, floor, ceil, skirting, boxFloor, boxWall}}: 64 multipliers each over
#                                    0 .. 0.6 m from the feature (sample i at i / 63 * 0.6 m)
#     floor     a wall near the floor line (and the floor near a wall: the same 90 degree hollow), by the distance from it
#     ceil      a wall near the ceiling line (a 3 m room)
#     inside    a wall near an inside corner (another wall square to it), at 1.2 m up
#     outside   a wall near an outside corner (nothing hides it: 1)
#     skirting  a wall under a window sill (a 45 mm board 30 mm thick), by the distance below it
#     boxFloor  the floor beside a box standing on it (0.9 x 0.9 x 0.8 m), by the distance from its side
#     boxWall   a wall beside a box standing against it (0.9 wide, 0.5 deep, 0.9 tall), at half its height, by the distance from its side
# The occlusion is worked out exactly for these boxes and planes: cosine-weighted rays from the surface point (the hemisphere over
# its normal), a ray occluded when it meets anything within 0.6 m (so every curve reaches 1 at 0.6 m), 200 000 rays a sample.
#   py -3.11 tools/blender/kit/ao_profiles.py
import os, sys, json, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np
import defs

N, DMAX, REACH, RAYS = 64, 0.6, 0.6, 200000
BIG = 50.0

def hits(o, d, boxes, reach):
    """is each ray o + t d (t in (1e-5, reach]) blocked by any of the boxes [(lo, hi)]?"""
    blocked = np.zeros(len(d), bool); inv = 1.0 / np.where(np.abs(d) < 1e-12, 1e-12, d)
    for lo, hi in boxes:
        t0 = (np.asarray(lo) - o) * inv; t1 = (np.asarray(hi) - o) * inv
        tn = np.minimum(t0, t1).max(1); tf = np.maximum(t0, t1).min(1)
        blocked |= (tn <= tf) & (tf > 1e-5) & (tn < reach)
    return blocked

def ao_at(p, n, boxes, rng):
    """the unoccluded share of the cosine-weighted hemisphere over n at p"""
    u1, u2 = rng.random(RAYS), rng.random(RAYS); r = np.sqrt(u1); phi = 2 * math.pi * u2
    loc = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - u1)], 1)
    n = np.asarray(n, float); a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    t = np.cross(n, a); t /= np.linalg.norm(t); b = np.cross(n, t)
    d = loc[:, :1] * t + loc[:, 1:2] * b + loc[:, 2:] * n
    o = np.asarray(p, float) + n * 1e-5
    return 1.0 - hits(np.broadcast_to(o, d.shape), d, boxes, REACH).mean()

def curve(fn, rng):
    return [round(float(ao_at(*fn(i / (N - 1) * DMAX), rng)), 4) for i in range(N)]

def main():
    rng = np.random.default_rng(7)
    floor = [((-BIG, -BIG, -1.0), (BIG, BIG, 0.0))]                     # (the floor slab, below z = 0)
    def room_wall(y0=0.0): return ((-BIG, -1.0 + y0, -1.0), (BIG, y0, 4.0))   # (a wall, its face at y = y0, the room at y > y0)
    C = {}
    # a wall (face y = 0) near the floor line: point at height d, facing +y
    C['floor'] = curve(lambda d: ((0.0, 0.0, d), (0, 1, 0), floor + [room_wall()]), rng)
    # a wall near the ceiling (3 m): point at 3 - d
    C['ceil'] = curve(lambda d: ((0.0, 0.0, 3.0 - d), (0, 1, 0), [room_wall(), ((-BIG, -BIG, 3.0), (BIG, BIG, 4.0))]), rng)
    # a wall near an inside corner: the other wall's face at x = 0, the point at x = d, 1.2 m up
    C['inside'] = curve(lambda d: ((d, 0.0, 1.2), (0, 1, 0), floor + [room_wall(), ((-1.0, -1.0, -1.0), (0.0, BIG, 4.0))]), rng)
    # an outside corner: the wall turns away from the room (x < 0 behind the corner): nothing in front
    C['outside'] = curve(lambda d: ((d, 0.0, 1.2), (0, 1, 0), floor + [((0.0, -1.0, -1.0), (BIG, 0.0, 4.0)), ((-BIG, -BIG, -1.0), (0.0, 0.0, 4.0))]), rng)
    # under a window sill: the board 0.045 out and 0.03 thick, its underside at 0.8 m
    C['skirting'] = curve(lambda d: ((0.0, 0.0, 0.8 - d), (0, 1, 0), floor + [room_wall(), ((-0.6, 0.0, 0.8), (0.6, 0.045, 0.83))]), rng)
    # the floor beside a box (0.9 x 0.9 x 0.8) standing on it, its side at x = 0
    C['boxFloor'] = curve(lambda d: ((d, 0.0, 0.0), (0, 0, 1), floor + [((-0.9, -0.45, 0.0), (0.0, 0.45, 0.8))]), rng)
    # a wall beside a box standing against it (0.9 wide, 0.5 deep, 0.9 tall), at half its height
    C['boxWall'] = curve(lambda d: ((d, 0.0, 0.45), (0, 1, 0), floor + [room_wall(), ((-0.9, 0.0, 0.0), (0.0, 0.5, 0.9))]), rng)
    for k, c in C.items():
        c = np.maximum.accumulate(np.array(c))                            # (monotonic: the Monte Carlo noise never dips it back)
        C[k] = [round(float(v), 4) for v in c]
        print(f'  {k}: {C[k][0]:.3f} at 0, {C[k][10]:.3f} at 0.095 m, {C[k][32]:.3f} at 0.30 m, {C[k][-1]:.3f} at 0.6 m')
    out = os.path.join(defs.REPO, 'textures', 'light'); os.makedirs(out, exist_ok=True)
    json.dump({'version': 1, 'samples': N, 'range_m': DMAX, 'reach_m': REACH,
               'note': 'cosine-weighted AO on canonical geometry, sample i at i / 63 * 0.6 m from the feature; see tools/blender/kit/ao_profiles.py',
               'curves': C}, open(os.path.join(out, 'ao_profiles.json'), 'w'), separators=(',', ':'))
    print('ao_profiles ->', os.path.join(out, 'ao_profiles.json'))

if __name__ == '__main__':
    main()
