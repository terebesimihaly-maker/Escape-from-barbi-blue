# The house kit (Blender) — how to build it on a PC with a graphics card

The realistic house's furniture, architecture, textures and decals are made here, in Blender, by Python scripts.
The full plan is `docs/house-build-spec.md` (section B is the asset kit, section 3 the hard rules, section 2's WP2.* rows
the packages). `js/kitdefs.js` is the single source of truth for every node name and size: never change a footprint there
without bumping its `version` (it changes gameplay).

## Setup (once)

- Python 3.11 with Blender as a module: `py -3.11 -m pip install bpy==5.0.1 pillow numpy` (Windows) or `pip install ...`.
- Node.js, then the glTF compressor's packages: `cd tools/gltf && npm install`.
- Check the graphics card is used (NVIDIA: prints OPTIX or CUDA):
  `py -3.11 -c "import sys; sys.path.insert(0,'tools/blender'); import bpy, common; bpy.ops.wm.read_factory_settings(use_empty=True); print(common.use_best_device())"`

Scripts use `common.use_best_device()` (via `kitlib.reset()`), so Cycles runs on the GPU wherever one exists.
Scratch files (bake intermediates, the asset `.blend`s, contact sheets, renders) go to the work folder (`defs.WORK`): `EFBB_WORK`
if set, else a `renders` folder beside the repository if one exists (this PC: `D:\Dokumentumok\EFBB\renders`), else `/tmp/efbb-kit`.
A surface bake deletes its own intermediates (about 1 GB a set) when it finishes.

## Running

- One asset script: `py -3.11 tools/blender/kit/<script>.py [--preview] [--only id] [--force]`
  (`--preview`: quarter resolution, 8 samples — use it while iterating).
- Pack the registered assets into the game's files: `py -3.11 tools/blender/kit/pack.py <style|all> <tier|all>`
  → `models/kit/{hi,md,lo}/<style>.glb` and `models/kit/manifest.json`.
- Check everything against `js/kitdefs.js`: `py -3.11 tools/blender/kit/check_kit.py` (must pass before pushing).
- Contact sheets to look at: `py -3.11 tools/blender/kit/contact_sheets.py --file <style> --only <node>`.
- Everything in order: `bash tools/blender/kit/build_all.sh` (Git Bash on Windows).

`rocking_chair.py` is the finished example and the realism bar: model real geometry (lathe, sweep, bevels), aged
procedural materials, bake albedo / normal / ORM with `kitlib.bake_set`, render a contact sheet, look at it honestly,
fix what looks fake, repeat.

## Working beside the cloud session

The cloud session works on the game code (js/, tests/) on the same branch, `claude/elegant-babbage-h8btki`.
The PC session owns only: `tools/blender/**`, `models/kit/**`, `textures/surf/**`, `textures/light/**`, `textures/sky/**`,
`textures/env/**`, `textures/glass/**`, `textures/decals/**`, `textures/arch/**`.
Before each push: `git pull --rebase origin claude/elegant-babbage-h8btki`, then push. Never edit js/ or tests/ files.

## What to build, in order (spec section 2, priority P0 first)

1. WP2.1 surface sets (`surfaces2.py`): floors, walls (A/B variants), ceilings, upper bands, trim sheets, beams, detail tiles.
2. WP2.2 architecture: trims and profiles, doors (frame, leaf, closed door), windows with cloth curtains and sky planes,
   exits, fireplaces, wall holes, peeling paper, niches, ceiling pieces.
   Built by `trims.py`, `doors.py`, `windows.py` and `modules.py` (each header says what it makes and how).
   Cut-outs (lace, holed sacking): a material's node named `ALPHA` is baked into the albedo's alpha channel by
   `kitlib.bake_set`; `kitlib.baked_material(..., alpha='blend')` exports it as glTF BLEND (a veil), `alpha=True` as MASK.
3. WP2.3 wardrobes (5 styles, exact hinge contract), WP2.4 light fixtures + emission profiles.
4. WP2.6 decals atlas, WP2.7 sky panorama, env maps, glass, window cookies, AO profiles.
5. WP2.5 furniture and island sets per style (3 islands + 6 solids per style first, then the rest).
