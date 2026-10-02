# Final build spec: "Escape from Barbi Blue" realistic house, Blender kit, provably completable floors

**Base design:** safety. It is the only design whose collision, navigation and test plan were fully verified. Nine grafts from the other two designs are listed in section 0.3, and every fatal flaw the judges found is resolved in section 0.4.

**Scratch evidence (written by me, repository untouched):**
- `/tmp/claude-0/design/final/proto3.js`: the final layout algorithm running on the real `genMaze` from core.js:197-264. Its defaults are this spec.
- `/tmp/claude-0/design/final/walk3.js`: her path following with real per-axis collision.
- `/tmp/claude-0/design/final/maxd.js`: longest-path comparison against today.
- `/tmp/claude-0/design/bundlecheck.js`: evaluates the three.js bundle in node.

Units: u = game unit = 0.045 m. A tile T is 50 u = 2.25 m (core.js:6, world3d.js:8).

---

## 0. Basis, evidence, and what changed from the three designs

### 0.1 Measured evidence

Run: `node /tmp/claude-0/design/final/proto3.js 100`, `node walk3.js`, `node maxd.js`.

**Validation, 2,000 houses** (5 floors × 1–4 players × 100 seeds): **0 failures**. Each house passes three checks:
- a cut-graph search (islands excluded);
- a 5-u physical flood for the player (r 11, including `closetBlocked`) reaching the exit within 18 u, every note within 20 u, every puzzle use zone within 36 u and every wardrobe within 28 u;
- a flood for her (r 12) reaching every cell centre.

**Per-floor results:**

| Floor | Halls placed / planned | Islands | Share of open tiles in rooms | Wardrobes short | Puzzles short | Generation time |
|---|---|---|---|---|---|---|
| F1 | 7 / 7 | 7 | 39% | 0% | 0% | 1.3–4.2 ms per floor across all floors |
| F2 | 7 / 7 | 9 | 37% | 0% | 0% | |
| F3 | 8 / 8 | 11 | 34% | 0% | 0% | |
| F4 | 8 / 8 | 11 | 34% | 0% | 0% | |
| F5 | 9 / 9 | 14 | 35% | 0% | 0% | |

- Room coverage was 11–21% in the safety design. Today 13–89% of houses are short of wardrobes.

**Longest path, today vs. this spec:**

| Floor | Today | This spec |
|---|---|---|
| F1 | 54.3 | 52.7 |
| F2 | 64.1 | 63.0 |
| F3 | 67.7 | 74.3 |
| F4 | 65.9 | 73.9 |
| F5 | 70.5 | 79.7 |

- The hall door budget keeps floors as long as today. Without it, paths shrank by 6–19%.

**Her path following, 250 houses × ~36 trips each, with random straight chase bursts:** 0 stuck, 0 overlaps with walls or furniture, 0 timeouts.

**Bundle (node evaluation of lib/three.min.js):**
- 61 exports. `InstancedBufferAttribute` is not exported, but `new InstancedMesh(...).instanceMatrix.constructor` is that class, and constructing it works.
- `setColorAt` exists.

**Blender (from the pipeline probe /tmp/claude-0/design/perf/bk.py):**
- Compositor denoise works through `bpy.data.node_groups.new(name,'CompositorNodeTree')`, `scene.compositing_node_group`, `CompositorNodeDenoise`, then rendering with compositing on.
- Compositor PNG output applies the view transform. **Data bakes must use `view_settings.view_transform='Standard'` and be written to EXR.**
- AO bake of 1024² at 32 spp on a 2.5k-triangle chair took 6.2 s.

### 0.2 What is kept from safety

1. The tile grid stays the only source of walls.
2. Templates only open tiles.
3. Only connector tiles are ever closed, and every closure is checked for connectivity.
4. Furniture with collision is a synced box list `d.solids`, sitting in fixed slots that never cover a tile core (R_NAV = 13).
5. A box may cut a nav edge only if the cut graph stays connected.
6. Boxes are at least 26 u apart, or merged into one.
7. Generation is: validate, then up to 6 reseeded retries, then a classic fallback. Tests assert the fallback is never used.
8. `losSight` (walls plus tall furniture) is used only for her sight, eye glow, fear, `herQuiet` and scare visibility.
9. Her close chase is gated by `clearLine`, with a stall guard.
10. The fixed light count rule.
11. Quality never changes placement or collision.

### 0.3 Grafts

| # | From | What |
|---|---|---|
| 1 | realism | **Islands.** The even/even tiles inside 2-D halls hold furniture sets of 1.26–1.95 m per side with real collision (dining sets, double beds, boiler, kiln). Placed islands per floor: F1 7 … F5 14 (0.1). |
| 2 | realism | **1×N hallway templates** (hallways with side doors), plus a **door budget** per hall (pipeline and realism). |
| 3 | realism | **Crouch-behind-low-cover.** `low` boxes block her sight of a crouching player (`cr` is already synced, multiplayer.js:502, 533, 652-655). |
| 4 | realism | **Flashlight bounce light** using the existing `aura` light, so the light count does not change. |
| 5 | realism | **Attic gable ceilings, 910 px/m surfaces with two albedo variants, and parallax occlusion mapping (POM) on High.** |
| 6 | pipeline | **No lamp pool point lights.** Flickering lamps are baked into a separate flicker channel with group ids and `uFlick[16]` uniforms (lights no longer leak through walls or pop). |
| 7 | pipeline | **Furniture lighting.** Neither per-instance probes nor a blurred field. A per-pixel **light field**: plan-space textures holding irradiance plus a dominant direction, sampled by world xz in every kit and character shader. This needs no per-instance attributes. |
| 8 | pipeline | **Pipeline mechanics:** Blender 5 compositor denoise with Standard view transform plus EXR; placeholder kit first; resumable per-asset builds with a `--preview` mode; texture tiers with a lo tier for phones; wall decals reuse their face's `uv1`. |
| 9 | pipeline | **Draw-call economy:** lamps drawn in 2 draws in total; chunked merges. |

### 0.4 How each judge-flagged flaw is resolved

| Flaw | Resolution |
|---|---|
| (safety) `InstancedBufferAttribute` is not exported | No per-instance light attributes. Furniture and characters use the light field (C5). If a per-instance attribute is ever unavoidable, create it with `new (mesh.instanceMatrix.constructor)(arr, n)` (rule H25). |
| (safety) Halls cover only 11–21% of tiles | 34–39% with the v4 plan, 1-tile hall spacing and 1×N hallways (A4). |
| (safety) Doors barely move; (realism) doors rest half-closed in the walkway | Full 2.03 m opening kept (brief C3). Leaves rest 72–88° open, inside the 0.45 m band. They swing to 89–90° with a creak when someone passes, then drift back slowly (A9.3). They never enter the walkway. |
| (safety) Servant corridor is cosmetic shelving | 0.30 m visual inset walls on both sides, a 2.55 m ceiling, service materials, and no doors. Players have no collision with the insets, so two players can still pass. Boards and puzzles are excluded from these runs (A9.1). |
| (safety) Extras crouch test runs into a box on a cut edge | extras.test.mjs:102-104 stops at cut edges through the new hook `bb.cutAt` (F5). |
| (safety) Floor and wall surfaces too soft at 455 px/m | 910 px/m (2048 px per 2.25 m) at hi (B9). |
| (safety and pipeline) Flickering lamps' pool lights pass through walls | Pool removed; flicker is baked with grid visibility (C3). |
| (safety and realism) Compositor denoise view-transform trap | Rule H17. |
| (realism) Wall furniture that is solid narrows corridors; `mateBlocked` hack | Wall décor stays non-solid and at most 0.44 m deep. No `mateBlocked` change. |
| (realism) Island tiles are open in the grid and break code that walks by `isWall` | Islands are blocked by nav cuts. `aheadOf`, the crouch test, fake-leave spots (`bfsDist` with cuts gives −1) and boards all respect cuts or distances. Players and she cannot enter an island tile, because the inset is at most 11 u (A8.2). |
| (realism) Prototype never tested solids | proto3 places and validates every solid (0.1). |
| (realism) Monster-only "V" solids put cameras inside walls | No monster-only solids exist. |
| (realism) 1.25 GB uncompressed textures at the md tier | Tiers: hi ≤ 1.1 GB (strong desktops only), md ≤ 320 MB, lo ≤ 110 MB. Phones always get lo (E6). |
| (pipeline) Close chase into low furniture | `clearLine` gate plus stall guard (A12), and the "around the table" test (F2.3). |
| (pipeline) Global `los()` changed | `los()` stays walls-only. `losSight` is used only at the 6 sight call sites (A12). |
| (pipeline) Vertex-lit furniture is coarse | Per-pixel light field (C5). |
| (pipeline and realism) Partition doorways narrow the opening | Not adopted. |

---

## 1. Final decisions

## A. Layout, rooms, collision, navigation

### A1. Terms

| Term | Definition |
|---|---|
| Tile core | Square of half-size **R_NAV = 13 u** around an open tile's centre. Never covered by a box, except an island's own tile. |
| Nav edge | Segment between the centres of two 4-adjacent open tiles. Its **band** is that segment widened by 13 u on each side. A band is ≥ 12 u from any wall plane. |
| Cut | A nav edge whose band intersects a box. The pathfinding search skips it. |
| Corner point | (k·T, j·T). Interior if it lies strictly inside a hall rectangle. |
| Island | An even/even tile strictly inside a 2-D hall (all 8 neighbours inside the hall), holding one island set. All 4 of its edges are cut. It is never a nav target. |
| Radii | Player 11 (game.js:131), her 12 (monster.js:171). |
| Gap rule | Two boxes are ≥ **26 u** apart (more than her 24 u width), so no gap exists that only the player can squeeze through. |

### A2. New fields in `d`

All are integers, sent by `hostEmit` and kept in `MP.floorData` (multiplayer.js:353-358, 418-428).

```
d.v       = LAYOUT_VERSION (2)
d.kv      = KIT.version (footprint table version)
d.seed    = uint32
d.rooms   = [[tpl, tx0, ty0, tx1, ty1, flags], ...]     tpl = index into HALL_TEMPLATE_IDS; flags bit0 = gable ridge runs along y
d.runs    = [[0, tx0, ty0, tx1, ty1], ...]              0 = servant run
d.solids  = [[k, x0, y0, x1, y1, rot, v], ...]          k = index into KIT.solidIds; coordinates in HALF-units (integers, divide by 2); rot 0..3 (×90°); v = variant
d.classic = 1 only in fallback mode (never set in tests)
```

- `rows` stays '0'/'1' (floors.js:72, 77).
- Cuts, nav buckets, the occlusion raster, the ceiling array and doorway tiles are **recomputed** on every client by pure functions from `d`. They are never sent.

### A3. `generateFloor(i, n, diff, seed?)` (floors.js:19-74 rewritten; helpers in new js/layout.js)

```
base = seed ?? (Math.random()*2**32)>>>0
for k in 0..5: s = (base + k*0x9E3779B1)>>>0
   d = withSeed(s, () => buildFloorData(i, n, diff, s, FULL)); bad = validateFloor(d)
   if (!bad.length) return d;  LAYOUT_REJECTS.push({i, n, diff, s, bad})
d = withSeed(base ^ 0x5bd1e995, () => buildFloorData(i, n, diff, base, CLASSIC)); d.classic = 1; return d
```

**`withSeed(s, fn)`** sets `Math.random = seededRng(s)` inside try/finally:
- `seededRng` is a copy of puzzles.js:29 placed in core.js, because puzzles.js loads later.
- It makes `rnd`, `shuffle`, `genMaze`, `makePuzzles` and `huntTime` reproducible without changing their signatures.

**`buildFloorData` steps, in order.** In CLASSIC mode steps 3, 4 and 9 are skipped.

| # | Step | Function | Grid change |
|---|---|---|---|
| 1 | Maze | `genMaze(F.cw, F.ch)` | creates |
| 2 | Multiplayer start room | floors.js:22, unchanged | opens 1..3 × 1..3 |
| 3 | Halls | `stampHalls(i)` (A4) | opens only |
| 4 | Door budget | `doorBudget(rooms)` (A5) | closes perimeter connectors, each checked |
| 5 | Wardrobe alcoves | `alcovePass(quota, rooms)` (A6) | closes connectors, each checked |
| 6 | Exit reservation | farthest dead-end cell by plain BFS (fallback: farthest cell with ≥ 1 wall) | — |
| 7 | Wardrobes | `pickClosets(quota)`: same rule as floors.js:28-30, from dead ends excluding the exit | — |
| 8 | Protected tiles | `protectedTiles()`: x ≤ 4 ∧ y ≤ 4; each wardrobe c, c+o, c+2o; exit cell + the tile in front | — |
| 9 | Furniture with collision | `furnishHalls(rooms, prot)`: islands first, then template slots (A8) → `solids`, `cut` | — |
| 10 | Distances | `bfsDist(1, 1, cut)` (islands give −1) | — |
| 11 | Puzzles | `makePuzzles(n, cand, i, diff, okFace)` (A11) | — |
| 12 | Notes | floors.js:37-40, distances with `cut` | — |
| 13 | Servant run | `markRuns(i, rooms, keep)` (A9.1) → `runs` | — |
| 14 | Boards | floors.js:41-57, excluding tiles touched by any box grown by 14 u, servant run tiles, and dist ≤ 2 (islands are −1) | — |
| 15 | Decals, spawns, a0, m0 | floors.js:59-71; m0 uses `dist(cut) > 0.55·maxD` | — |
| 16 | Return | existing fields + `v, kv, seed, rooms, runs, solids` | — |

**Rule:** inside `generateFloor`, every helper receives `cut` (or `null`) explicitly. It must never read the `NAV`, `SOLIDS` or `CEIL` globals of the floor currently being played.

`generateFloor` still overwrites `grid`/`GW`/`GH`/`CELLS`, exactly as today.

### A4. Templates and HALL_PLAN (js/layout.js)

```js
// one entry per template; cells [w,h] are rotated at random when stamped
HALL_TEMPLATES = { id: { style, cells:[w,h], kind:'room'|'hallway', ceil:m, roof:'flat'|'gable', mode:'islands'|'columns',
   islands:{max, pick:[kitIds]}, column:{pattern:'all'|'ring'|'diag', id}, slots:[{type:'pocket'|'bar'|'wall', pick:[ids], max}],
   lights:{...}, rug, decalMul:{...}, identity } }
```

**HALL_PLAN** (per floor, tried in order, 40 tries each; prototype placement rate 100%):

| Floor (style) | Templates `[cells] identity (mode, ceiling)` |
|---|---|
| F1 Nursery (wood) | [2,3] nursery_dormitory (islands; 3.6) · [2,2] playroom (islands; 3.6) · [1,4] landing_hall (hallway; 3.0) · [2,2] night_nursery (islands; 3.3) · [2,2] washroom (islands; 3.0) · [2,3] schoolroom (islands; 3.6) · [1,3] back_landing (hallway; 3.0) |
| F2 Doll Hallway (tile) | [3,3] gallery (columns ring + 2 display benches; 4.5) · [1,5] portrait_hall (hallway; 3.5) · [2,3] dining_room (islands; 4.0) · [2,2] parlour (islands; 4.0) · [2,2] library (islands; 4.0) · [2,3] colonnade (columns all; 4.5) · [1,4] servants_hall (hallway; 3.2) |
| F3 Basement (concrete) | [3,3] boiler_room (islands; 3.3) · [2,3] storage (islands; 3.0) · [1,5] cellar_passage (hallway; 2.7, brick barrel vault visual) · [2,2] laundry (islands; 3.0) · [2,2] coal_store (islands; 2.7) · [2,3] wine_cellar (islands; 3.0) · [2,3] workroom (islands; 3.0) · [1,4] coal_passage (hallway; 2.7) |
| F4 Attic | [3,3] truss_hall (islands, **gable** eave 2.6 → ridge 3.9) · [2,3] storeroom (gable 2.6 → 3.6) · [2,3] servants_dormitory (gable 2.6 → 3.6) · [1,5] plank_passage (hallway; 2.8) · [2,2] hideout (gable 2.6 → 3.4) · [2,2] box_room (gable 2.6 → 3.4) · [2,3] sheet_room (gable 2.6 → 3.6) · [1,4] eaves_passage (hallway; 2.8) |
| F5 Workshop | [3,3] assembly_floor (islands; 4.5, roof trusses + 3 skylights) · [3,3] casting_hall (islands; 4.5) · [2,3] kiln_room (islands; 4.2) · [1,5] workshop_corridor (hallway; 3.4) · [2,2] eye_room (islands; 3.6) · [2,2] office (islands; 3.6) · [2,3] paint_room (islands; 4.2) · [2,3] parts_store (islands; 3.6) · [1,4] materials_passage (hallway; 3.4) |

- In "columns" mode, columns sit at interior corner points and the hall gets **no islands**: every interior corner point of a hall touches an island tile, so the two modes cannot be combined.
- In "islands" mode, island tiles get sets. Corner points that do not touch a placed island may take pocket or bar slots.
- Islands per hall: `max` = 1 for 2×2, 2 for 2×3, 3 for 3×3 (the prototype used ceil(0.75·count)).
- Every template lists its slot picks in the KIT ids of B3/B4.

### A5. `stampHalls`, `doorBudget`

**`stampHalls`.** For each template:
- Pick a random rotation and a cell origin (cx0, cy0) such that the rectangle fits. Tile rectangle: `tx0=2cx0+1, ty0=2cy0+1, tx1=2(cx0+w−1)+1, ty1=2(cy0+h−1)+1`.
- Reject the try if any of these holds:
  - `tx0 ≤ 5 ∧ ty0 ≤ 5` (start zone);
  - the rectangle grown by **1** tile overlaps another hall (`GAPT = 1`, so halls share at most a wall/connector line);
  - more than 1 dead-end cell lies inside the rectangle.
- On accept: set `grid=0` for every tile in the rectangle and push the room. The `flags` bit0 for gable halls is the long axis; a square gable hall uses `rng() < 0.5`.
- This only opens tiles, so it is safe by construction. Its cells were already connected and open, and odd/odd tiles are never touched. The border is untouched.

**`doorBudget`.** For each hall, the perimeter openings are the open tiles directly outside the rectangle.
- Limit: `MAXD = 4` for 2-D halls, `5` for 1×N hallways.
- While the count exceeds the limit: in shuffled order, close an opening if it is a connector ((x+y) odd), not in another hall, not in x ≤ 4 ∧ y ≤ 4, and not on the border. Keep the closure only if `openSetConnected()` still holds (BFS over open tiles from (1,1) reaches every open tile); otherwise reopen it.

### A6. `alcovePass(quota, rooms)` (from safety, unchanged)

- `quota = 4 + 2i + (n−1)` (floors.js:29).
- While the number of dead-end cells (outside the start corners) is below quota + 1:
  - Candidates are open connectors outside halls and outside x ≤ 4 ∧ y ≤ 4, lying between two open tiles in a straight line, where at least one side is a non-hall cell with `wallCount == 2`.
  - In shuffled order, close the first one that keeps the open set connected.
  - Stop if none is accepted. `validateFloor` then reports "wardrobes short", which triggers a retry. That never happened in 2,000 houses.

### A7. (reserved: merged into A8)

### A8. Furniture with collision: slots, islands, cuts

**A8.1 Slot geometry** (game units; corner points (X, Y) are tile corners):

| Slot | Where | Footprint | Cuts | Example |
|---|---|---|---|---|
| pocket | centred on an interior corner point | ≤ 22 × 22 u (0.99 m square) | never (1 u from cores and bands) | rocking chair, column, toy chest, crate stack |
| bar | centred between two neighbouring interior corner points, along the grid line | ≤ 22 × 72 u (0.99 × 3.24 m) | exactly 1 edge | workbench, display bench, back-to-back racks, sheeted sofa |
| wall | at a corner point on a hall wall, both wall tiles behind it solid, the back flush with the wall plane | across ≤ 22 u, depth 13–61 u (0.58–2.74 m) | exactly 1 edge | crib or iron bed head to the wall, boiler |
| island | an island tile, inset 3.33–11 u per side (each axis independently) | each axis 28–43.3 u (1.26–1.95 m) | its 4 edges | dining set, grand piano, double bed, boiler set, kiln set |

**A8.2 Placement rules** (`tryAdd`; all implemented in proto3):
1. The box lies within open tiles. Wall-slot backs touch the wall plane (overlap area 0).
2. The box intersects no open tile core, except an island's own tile.
3. The box intersects no protected tile.
4. The gap rule: ≥ 26 u to every other box.
5. Cuts are computed by `cutsFrom(solids)`: an edge is cut if and only if its band intersects a box. The box is accepted only if the cut graph from (1,1) reaches every open non-island tile.
6. A wall slot is not placed in front of a window face (windows are decided by `vh` from rows, A14). The puzzle filter `okFace` handles puzzle faces.
7. **Island inset ≤ 11 u** on each side, so neither the player (r 11) nor she (r 12) can ever have their centre inside an island tile. Island tiles are therefore never `m.last` or any other nav target.
8. A box's visual stays within the box grown by 0.05 m in xz, and covers ≥ 85% of each extent at some height ≥ 0.4 m. **Nothing looks solid without being solid; nothing solid is invisible.**

**A8.3 Occlusion class** (from KIT):
- `tall`: h ≥ 1.70 m and narrow side ≥ 0.4 m. Blocks her sight of everyone.
- `low`: 1.0 ≤ h < 1.70 m. Blocks only her sight of a crouching player.
- Otherwise `none`.

**A8.4 Runtime nav** (`buildNav(SOLIDS)` in js/layout.js, run in `applyLayout(d)` on every client):

```
NAV = { cut: Uint8Array(GW*GH)   bit0: edge to (x+1,y) cut, bit1: edge to (x,y+1) cut
        bucket: Array(GW*GH)     solid indices whose AABB grown by 14 u touches the tile
        isl: Uint8Array(GW*GH)   1 on island tiles
        occ: Uint8Array(GW*5*GH*5)  10-u raster; bit0 tall, bit1 low; a cell is marked if its centre is inside the box shrunk by 2 u }
```

### A9. Corridors, hallways, doors

**A9.1 Servant run** (`markRuns`, step 13, stored in `d.runs`):
- Choose one run per floor (two on F3) with the seeded RNG. A run is a straight line of ≥ 4 open tiles where:
  - every tile is outside halls and hallways, ≥ 1 tile from any hall, and outside x ≤ 5 ∧ y ≤ 5;
  - every tile has walls on both sides perpendicular to the run, except at most 2 junction tiles;
  - no tile is a wardrobe c/c+o/c+2o, the exit cell or the tile in front of it, or a puzzle cell.
- Treatment (visual only):
  - Inset walls 0.30 m deep on both sides (face quads offset along n by 0.30 m), reveal quads at the run ends and at junctions.
  - Ceiling 2.55 m.
  - Service wall material (tongue-and-groove or whitewashed brick).
  - Wall props only (≤ 0.25 m deep on the inset face): bell board, coat hooks, conduit; batten lights flush with the ceiling.
  - No doorway leaves, portraits or boards.
- Players' camera stays ≥ 0.195 m from the inset face, so it never clips. Two players can still pass (no collision).

**A9.2 1×N hallways** (template kind 'hallway'):
- Runner rug, sconces every 2 tiles, window density 0.5 on border side faces.
- **Fake closed doors** (`Door_closed` modules) on non-border, non-busy side faces, at most 1 per 2 tiles, alternating sides.
- Portrait density ×1.5 on F2.

**A9.3 Doorways (visual; `doorTilesFrom(grid, seed, rooms, runs)` in js/dress.js, pure):**
- A doorway is any connector with walls on both sides that is either a hall perimeter opening (always) or passes `vh(x,y,311) ≤ 0.72`. Servant run tiles are excluded.
- Geometry:
  - Kit `Door_frame_<style>`: posts 0.11 m wide at ±(L/2 − 0.055), header from 2.60 m to `ceilAt` (skipped below 0.08 m), lining 0.34 deep, architraves on both faces.
  - **Two leaves 1.00 × 2.55 × 0.045 m**, hinged on the posts' inner faces (0.11 m from the side walls).
- Rest angle θ (from closed) = 72° + 16°·vh. Leaf tip distance from the wall = 0.11 + cos θ ≤ 0.42 m, which is inside the 0.45 band.
- Animation (cosmetic, local): when any actor comes within 1.6 m (local player, interpolated teammates, her synced position), each leaf eases to 89° over 0.8 s and plays `sfx.creak` positioned at the door. After 6–10 s with nobody near, it drifts back to rest with a softer creak. A ±1.5° draught sway runs while idle.
- The creak is muted while `herQuiet() > 0.5`. It does not feed her hearing.
- **Boards and leaves:**
  - A doorway tile with a side board on side s pins that side's leaf at 90° (leaf at 0.11–0.155 m from the wall; the board starts 0.25 m out).
  - A doorway tile with a long board gets frame and header only, no leaves.
  - Boards are never moved for leaves.

### A10. Ceiling heights

**New `FLOORS` fields** (core.js:118-135): `ceil` = 3.0 / 3.2 / 2.7 / 2.8 / 3.4.
- Hall heights come from their template, servant runs are 2.55, hallways from their template.
- `WALL_H` (world3d.js:8) stays 3.0 as the texture reference and for the title scene.
- `CEIL = Float32Array(GW*GH)` is filled in `applyLayout`.
- `ceilAt(tx, ty)` returns the flat height. `ceilAtXZ(xm, zm)` evaluates gable halls: `h = eave + (ridge − eave)·(1 − |offset from ridge| / halfWidth)`, with the ridge on the hall's long-axis centreline.

**Geometry (js/arch.js):**
- Each open tile gets a ceiling quad at its height, or two sloped quads split at the ridge.
- Between neighbouring open tiles of different height, one vertical step quad runs from the low height to the high one, facing the higher side.
- Wall faces take their tile's height. Gable faces sample `ceilAtXZ` at u ∈ {0, .14, .5, .86, 1}.
- Walls above 3.0 m get an upper band (separate tileable texture) with a picture rail at 3.0 m.

**Clearance:**
- Anything hanging over walkable floor (more than 0.45 m from walls and boxes) has its bottom at ≥ 2.30 m. She is about 2.19 m (measured by test F3.9).
- Minimum ceiling 2.55 m (servant runs only). Elsewhere ≥ 2.7 m.
- Attic collar ties at 2.45 m. Basement pipes at `ceil − 0.38` and `ceil − 0.22` (house.js:245).
- Pendants: bottom ≥ 2.30, or ≥ 1.95 m when entirely over a box footprint.
- Crown moulding at H − 0.12; cobwebs at H − 0.25; bulb drop = min(0.63, H − 2.35).
- Ceiling scare (scares.js:187, 190, 198) uses `ceilAt(player tile)` instead of `WALL_H`.

### A11. Gameplay placement rules (changes in bold)

| Item | Rule |
|---|---|
| Wardrobes | floors.js:28-30, **from dead ends left after the alcove pass, excluding the reserved exit; count = quota in 100% of houses** |
| Exit | **Farthest dead end by plain BFS, reserved before furnishing.** `exitDir` (level.js:526-531) unchanged |
| Puzzles | floors.js:33 candidates using `dist(cut)`. **`makePuzzles(..., okFace)`:** a wall direction is allowed only if no box lies within 20 u in front of the face over ±20 u across. With `okFace` absent, the order of random calls is identical to today |
| Notes | Unchanged (at cell centres, inside the solid-free core) |
| Boards | floors.js:41-57 **minus tiles touched by any box grown by 14 u, minus servant run tiles** (islands are excluded by dist −1) |
| Floor decals | Unchanged |
| Spawns, a0 | Unchanged (no halls or boxes in x ≤ 5 ∧ y ≤ 5) |
| m0 | `dist(cut) > 0.55·maxD(cut)` |

### A12. Code changes

**core.js:**

```js
let SOLIDS = [], NAV = null, CEIL = null, ROOMS = [], RUNS = [], VSEED = 0;
const seededRng = s => { /* copy of puzzles.js:29 */ };
function withSeed(s, fn) { const r = Math.random; Math.random = seededRng(s); try { return fn(); } finally { Math.random = r; } }
const solidAt = (x, y, r) => { if (!NAV) return false; const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return false; const b = NAV.bucket[ty * GW + tx];
  if (b) for (const i of b) { const s = SOLIDS[i]; if (x + r > s.x0 && x - r < s.x1 && y + r > s.y0 && y - r < s.y1) return true; } return false; }; // r <= 14
const blocked = (x, y, r) => wallAt(x - r, y - r) || wallAt(x + r, y - r) || wallAt(x - r, y + r) || wallAt(x + r, y + r) || solidAt(x, y, r);
const cutAt = (x, y, dx, dy, cut = NAV && NAV.cut) => !!cut && !!(dx === 1 ? cut[idx(x, y)] & 1 : dx === -1 ? cut[idx(x - 1, y)] & 1 : dy === 1 ? cut[idx(x, y)] & 2 : cut[idx(x, y - 1)] & 2);
function bfsDist(sx, sy, cut = NAV && NAV.cut)  // neighbour test gains && !cutAt(x, y, dx, dy, cut)   (core.js:236)
function bfsPath(sx, sy, tx, ty, cut = NAV && NAV.cut)   // same (core.js:247)
function losSight(ax, ay, bx, by, crouch) // los() walls + every 8 u: NAV.occ & (crouch ? 3 : 1); samples within 8 u of either end skipped
function clearLine(ax, ay, bx, by, r)     // slab test of the segment against nearby SOLIDS grown by r (solids only; walls stay with los)
```

- `wallCount` is unchanged.
- **`los()` is unchanged.** It stays in use for audio.js:80, puzzles.js:328, game.js:151, team.js:94, monster.js:59 and render.js:67.

**Call sites that need no edit, because `blocked()` now includes boxes:**
- game.js:131-132, 168;
- `moveEntity` (core.js:261-264);
- render.js:44, 67;
- scares.js:49, 111;
- team.js:98.

**monster.js:**
1. **`stepAlongPath(m, target, spd, dt)`** replaces monster.js:172-181:
   - Path from `bfsPath(…)` (cut-aware by default).
   - Path segments between nav centres are free moves (the bands are proven clear).
   - The final leg (path empty) uses `moveEntity(m, …, 12)`.
   - If `bfsPath` returns null, use the target's nearest 4-neighbour open non-island tile centre; otherwise the current tile centre.
   - **Stall guard:** if she moves less than 0.05·step for 1.0 s, set `m.path=[]; m.repath=0`. At 2.5 s, snap to the current tile centre if `!losSight` from every player; otherwise snap to the nearest such cell centre within 3 tiles.
2. **Close chase** (monster.js:169): `seen && sd < T*2.2 && clearLine(m.x, m.y, seen.x, seen.y, 12)`. Otherwise she runs path mode toward `m.last`.
3. **monster.js:81:** `losSight(m.x, m.y, q.x, q.y, q.crouching)`.
4. **`aheadOf`** (monster.js:23): the loop also stops when `cutAt(tx, ty, sx, sy)`.
5. **`planSearch`** (:28) and **`startFakeLeave`** (:57): `bfsDist` is cut-aware by default, so island tiles give −1 and are excluded.

**Other files:**
- stealth.js:77, 84 → `losSight(…, false)`.
- render.js:121 (eye glow) → `losSight(…, false)`.
- scares.js:24 `inView` → `losSight(…, false)`.
- scares.js:81: add `&& !blocked(x, y, 12)`.
- scares.js:111 dash: add `clearLine(x0, y0, x1, y1, 10)`.
- scares.js:187, 190, 198 → `ceilAt` heights.

**floors.js:** `generateFloor` as in A3. `applyFloor` calls `applyLayout(d)` right after floors.js:77-78, which sets `VSEED`, `ROOMS`, `RUNS`, `CEIL`, `SOLIDS` (decoded `{x0,y0,x1,y1,k,rot,v,kind}` in units) and `NAV`. Old-format `d` gives empty data.

**multiplayer.js:**
- In the 'floor' handler (multiplayer.js:418): if `d.v !== LAYOUT_VERSION || d.kv !== KIT.version`, show "This house was built by a different version of the game. Update and rejoin." and `leaveMP()`.
- Lobby Ready gating (E5).

**game.js, input.js:** no change.

**tests/hooks.js** adds:
- `SOLIDS: () => SOLIDS, NAV: () => NAV, CEIL: () => CEIL, ROOMS: () => ROOMS, RUNS: () => RUNS`
- `cutAt, losSight, clearLine, validateFloor, applyLayout, stepAlongPath, LAYOUT_REJECTS: () => LAYOUT_REJECTS`
- `Kit: () => Kit, LightBaker: () => LightBaker, kitReady: s => Kit.ready(s)`

### A13. Completability: argument and `validateFloor`

**Argument:**
1. The open non-island set is connected. Opening only adds; every closure and every box is checked.
2. Every open non-island tile core is box-free.
3. Every uncut band is box-free and ≥ 12 u from walls.
4. The cut graph is connected (rule A8.2.5).

Therefore a body with r ≤ 13 can travel centre to centre along any path of the cut graph, and reaches every open non-island tile centre.

**Every objective is at or next to a reachable centre:**
- exit disc 18 u, note disc 20 u and hide disc 28 u, each centred on the cell centre;
- puzzle use point 13 u from the cell centre, with line of sight inside the core;
- her wardrobe stand point c+o·16 lies in a protected, box-free tile.

**`validateFloor(d)`** is pure. It uses its own grid accessors and never touches globals. Checks:
- (a) every odd/odd tile open; border solid; rows only '0'/'1';
- (b) closets = quota, each a dead end facing open floor;
- (c) puzzles = `puzzleCount`, each with its wall present, not in a wardrobe or exit cell, and `okFace`;
- (d) spawns open and clear by 11 u of walls and boxes;
- (e) box rules A8.2.1–8 (slot legality and footprint against KIT within 0.5 u, rotated);
- (f) the cut graph from every spawn reaches every open non-island tile;
- (g) a 5-u physical flood for the player (r 11, walls + boxes + `closetBlocked` boxes) reaches exit/18, notes/20, puzzle use/36 with a sight line, and wardrobes/28;
- (h) a 5-u flood for her (r 12, walls + boxes, no closets) reaches every cell centre within 4 u and every c+o·16;
- (i) m0 is reachable;
- (j) servant runs are legal (A9.1), and no board lies on a run tile or on a box-touched tile.

### A14. Determinism

**Visual hash:** `vh(x, y, k) = hash(x, y, (Math.imul(k, 2654435761) ^ VSEED) | 0)` (world3d.js:25-28).

**Every visual choice uses `vh`, never `Math.random`:**
- lamp positions and states (house.js:139 changes: ok 65%, flicker 15% subject to the group limit, dead 20%);
- windows, moon direction, modules, band décor, rugs, decals, wall variants, doorway tiles and rest angles;
- wall and ceiling canvas noise (level.js:225-325, through `seededRng(VSEED ^ k)`), wardrobe grain (level.js:479), word drips (level.js:472), puddle outline (house.js:228), `woodCanvas` and `noiseFill` (house.js:48-62).

**Quality and loading never affect placement:**
- Remove `dens` from placement (house.js:67). Low may skip only clutter under 0.3 m and animations.
- Load state never changes placement or collision.
- Dolls are not scaled by quality, so tests always have their dolls.

---

## B. Asset kit (Blender 5.0.1, Cycles)

### B1. Conventions

**Scripts and outputs:**
- Scripts live in `tools/blender/kit/` and run as `/tmp/claude-0/bpyenv/bin/python tools/blender/kit/X.py [--preview] [--only id]`.
- Start from `read_factory_settings(use_empty=True)` and call `common.use_best_device(scene)` (common.py:51-63; CPU here). **Never use EEVEE or Workbench (SIGABRT, exit 134).** Units are metres.
- Temporary files go in `/tmp/efbb-kit/`. Each asset script saves `<asset>.blend` for `pack.py`.

**Axes and origins:**
- Z up; front faces −Y (three's +Z); `export_yup=True, export_apply=True`.
- Floor items: origin at the footprint centre, lowest point z = 0.
- Wall items: origin on the wall plane at floor level, back at Blender y = 0.
- Leaves: origin on the hinge axis at the leaf bottom.
- Modules: origin at the face centre on the wall plane at floor level.

**Node names** (no dots; one mesh with ≤ 2 materials per node; `pack.py` splits anything larger into `<name>_p0`, `<name>_p1`):

| Category | Names |
|---|---|
| Solid furniture | `Solid_<id>[_v<n>]` |
| Islands | `Isl_<id>[_v<n>]` |
| Band décor | `Band_<id>` |
| Modules | `Mod_<id>_<style>` |
| Doorways | `Door_frame_<style>`, `Door_leaf_<style>` (one leaf, mirrored in JS), `Door_closed_<style>` |
| Wardrobes | `Ward_body_<style>`, `Ward_leafL_<style>`, `Ward_leafR_<style>` |
| Fixtures | `Fix_<id>`, with child `Fix_<id>_emit` |
| Windows | `Win_<id>` with children `_frame`, `_glass`, `_sky`, `_curtain` |
| Columns | `Col_<id>_H<cm>` |
| Exit | `Exit_<style>` with `Exit_leaf`, `Exit_boards`, `Exit_lamp` |
| Doll | `Doll2` (optional) |

**Reserved material names** (the loader swaps them):
- `WallSurface`: the level's wall material, with the per-instance `uv1` remap.
- `Glass`: shared transparent Standard material.
- `SkyPlane`: sky shader.
- `Emit`: instanced Basic material.

**Exported material model:** plain Principled only (base colour, metallic/roughness, normal, occlusion, emissive). No transmission, clearcoat or sheen (which would make internal MeshPhysical materials).

**Maps:**
- `albedo`: sRGB, colour-only DIFFUSE bake × cavity grime (0.6 + 0.4·AO at 0.05 m distance).
- `normal`: tangent space, high-to-low selected-to-active where a sculpt or bevel source exists.
- `orm`: R = AO (0.25 m distance, 64 spp, denoised), G = roughness, B = metalness. glTF occlusion and metallicRoughness reference the same image.
- `emissive` only on `Emit`.

**Rules for data bakes** (AO, normal, roughness, height): **float image buffers saved to EXR with `view_transform='Standard'`**. Denoise through the compositor (0.1 recipe), then convert to WebP in Python (Pillow).

**Export:** `export_lights=False, export_vertex_color='NONE', export_extras=True, export_image_format='WEBP'`, quality 86 (normals 92). Then `node tools/compress-glb.mjs in out [ratio]`, run from `/tmp/claude-0/gltft` (meshopt, positions not quantised).

**Tiers:** `models/kit/<tier>/<style>.glb` and `models/kit/<tier>/common.glb`, tier ∈ {hi, md, lo}.
- md: textures half resolution.
- lo: textures quarter resolution, simplify ratio 0.5, error 0.0015.
- Footprints are identical across tiers.

**`models/kit/manifest.json`** (written by `pack.py`): per node, name, AABB, triangle count, mount, footprint, materials, `uv1` present; per tier, file sizes (for the progress bar).

### B2. Single source of truth: `js/kitdefs.js`

`const KIT = /*KITDEFS*/{ ...strict JSON... }/*END*/;` is loaded right after core.js. Blender's `defs.py` reads the text between the markers with `json.loads`.

```json
{ "version": 1,
  "solidIds": ["crib","iron_bed", "..."],
  "items": { "crib": { "style":"wood", "slot":"wall", "w":0.72, "d":1.30, "h":1.05, "occ":"none", "node":"Solid_crib", "vars":2,
                       "tris":6000, "rooms":["nursery_dormitory","night_nursery"], "anim":"mobile" }, "...": {} } }
```

- **Gameplay box** in u = round(m / 0.045). `w` runs across, `d` along the slot depth.
- Islands carry `"ins":[ix,iy]` (u, each 3.33–11).
- `check_kit.py` and test F3 compare every node AABB with these numbers.

### B3. Solid furniture (pocket / bar / wall)

| id | Style | Slot | w × d (m) | h (m) | occ | Notes |
|---|---|---|---|---|---|---|
| crib | wood | wall | 0.72 × 1.30 | 1.05 | none | slats, chipped paint, stained mattress (cloth), turning mobile |
| iron_bed | wood | wall | 0.95 × 2.00 | 1.10 | none | cloth sheet (hero) |
| rocking_chair | wood | pocket | 0.66 × 0.95 | 1.10 | none | rocks ±0.10 rad over a 3.6 s period, inside its box |
| toy_chest | wood | pocket | 0.90 × 0.50 | 0.60 | none | lid ajar |
| doll_house | wood | pocket | 0.95 × 0.60 | 1.30 | low | |
| rocking_horse | wood | pocket | 0.99 × 0.42 | 0.90 | none | |
| pram | wood | pocket | 0.60 × 0.99 | 1.05 | low | |
| nursery_table | wood | bar | 0.85 × 2.60 | 0.62 | none | small chairs inside the box |
| column_tile | tile | pocket | 0.66 × 0.66 | ceiling | tall | `Col_column_tile_H350/H400/H450` |
| display_bench | tile | bar | 0.70 × 3.10 | 1.25 | low | glass domes, baked dolls (hero) |
| plinth_bust | tile | pocket | 0.60 × 0.60 | 1.45 | low | bell jar |
| vitrine_double | tile | bar | 0.99 × 2.00 | 1.95 | tall | |
| brick_pier | concrete | pocket | 0.70 × 0.70 | ceiling | tall | |
| stanchion | concrete | pocket | 0.30 × 0.30 | ceiling | none | |
| shelf_rack | concrete | bar | 0.60 × 3.10 | 2.00 | tall | jars, tins (hero) |
| boiler_wall | concrete | wall | 0.99 × 1.40 | 1.90 + flue | tall | firebox glow fixture |
| chest_freezer | concrete | pocket | 0.99 × 0.66 | 0.88 | none | |
| crate_stack | concrete | pocket | 0.90 × 0.90 | 1.0 / 1.6 | none / low | variants A/B |
| truss_post | attic | pocket | 0.25 × 0.25 | to tie | none | |
| sheet_chair | attic | pocket | 0.95 × 0.95 | 1.10 | low | cloth |
| sheet_tall | attic | pocket | 0.99 × 0.70 | 1.95 | tall | |
| sheet_sofa | attic | bar | 0.95 × 2.20 | 0.95 | none | |
| steamer_trunk | attic | pocket | 0.95 × 0.55 | 0.65 | none | |
| chimney_breast | attic | pocket | 0.99 × 0.99 | ceiling | tall | |
| iron_bed_sheeted | attic | wall | 0.95 × 2.00 | 1.00 | none | |
| workbench | workshop | bar | 0.85 × 3.10 | 0.92 (+ rack 1.6) | low | vices, doll limbs, eye trays (hero) |
| kiln | workshop | pocket | 0.99 × 0.99 | 1.75 + flue | tall | ember glow fixture |
| drying_rack | workshop | bar | 0.60 × 3.00 | 2.00 | tall | porcelain limbs |
| sewing_table | workshop | pocket | 0.95 × 0.55 | 1.15 | low | |
| dress_form | workshop | pocket | 0.50 × 0.50 | 1.65 | none | |
| steel_column | workshop | pocket | 0.30 × 0.30 | ceiling | none | |

### B4. Island sets (each axis 1.26–1.95 m; inset ≤ 11 u per side)

| id | Style | Footprint (m) | h | occ | Content |
|---|---|---|---|---|---|
| isl_crib_rocker | wood | 1.40 × 1.75 | 1.10 | none | crib + rocking chair (`RockPivot` ±0.12 rad) + round rug |
| isl_twin_cribs | wood | 1.40 × 1.85 | 1.05 | none | 2 cribs, mobile turning at 1.55 m (over its own box) |
| isl_bed_screen | wood | 1.95 × 1.45 | 1.65 | low | bed + 3-panel screen |
| isl_tea_party | wood | 1.50 × 1.40 | 0.95 | none | table, 4 baked seated dolls (not scare dolls) |
| isl_dollhouse | wood | 1.60 × 1.30 | 1.45 | low | big dollhouse on a rug with toys |
| isl_washstand | wood | 1.40 × 1.30 | 1.10 | none | tin bath + washstand |
| isl_dining | tile | 1.95 × 1.45 | 1.10 | none | table + 6 chairs, candelabrum (flicker fixture) |
| isl_grand_piano | tile | 1.50 × 1.95 | 1.25 (lid prop to 1.9) | low | |
| isl_parlour | tile | 1.90 × 1.60 | 1.10 | none | round table, 2 armchairs, standard lamp (steady fixture) |
| isl_reading | tile | 1.90 × 1.30 | 1.20 | none | table, chair, globe |
| isl_boiler | concrete | 1.90 × 1.50 | 1.90 + flue | tall | |
| isl_shelving_double | concrete | 1.85 × 1.30 | 2.00 | tall | back-to-back + crates |
| isl_crate_stack | concrete | 1.60 × 1.30 | 1.50 | low | |
| isl_washtubs | concrete | 1.80 × 1.30 | 1.40 | low | tubs + mangle |
| isl_wine_rack | concrete | 1.85 × 1.30 | 1.90 | tall | |
| isl_sheeted_sofa | attic | 1.90 × 1.30 | 1.20 (clock 1.9) | tall | |
| isl_trunk_pile | attic | 1.70 × 1.30 | 1.30 | low | |
| isl_servant_bed | attic | 1.90 × 1.40 | 1.00 | none | |
| isl_toy_circle | attic | 1.70 × 1.70 | 0.40 | none | ring of toys, the photograph from note 4-4 |
| isl_sheeted_armoire | attic | 1.30 × 1.30 | 2.00 | tall | |
| isl_dress_forms | attic | 1.60 × 1.30 | 1.65 | low | |
| isl_workbench_double | workshop | 1.90 × 1.30 | 0.92 (anglepoise) | low | doll in a vice |
| isl_kiln | workshop | 1.40 × 1.30 | 1.70 + flue | tall | |
| isl_drying_rack | workshop | 1.80 × 1.30 | 1.90 | tall | |
| isl_sorting_table | workshop | 1.80 × 1.30 | 0.95 | none | trays of eyes |
| isl_office_desk | workshop | 1.70 × 1.30 | 1.10 | none | ledger, safe |
| isl_hanging_dolls | workshop | 1.60 × 1.30 | 2.10 | tall | dolls hang from a rail over the set only |

### B5. Architecture (per style; geometry in Blender, sweeps and placement in JS)

| Piece | wood | tile | concrete | attic | workshop |
|---|---|---|---|---|---|
| Trim profiles (`<style>.profiles.json` 2D polylines + trim sheet 2048×256 hi) | ogee skirting 0.18 h × 0.025 d, dado rail at **0.93** (on the baked rail), cornice 0.14 × 0.12, picture rail at 3.0 | marble skirting 0.25, dado at **0.87**, cornice 0.20, picture rail | curb 0.10 × 0.04 | board 0.09 × 0.02 | board 0.14, rail at **0.93**, timber cornice |
| `Door_frame` / `Door_leaf` (A9.3) | painted pine, 4-panel, finger marks (hero) | mahogany, 6-panel (hero) | ledged-and-braced planks | boards, strap hinges | half-glazed, wired glass |
| `Door_closed` (full face module, door 0.90 × 2.10, casing ≤ 0.05 proud) | ✓ | ✓ | steel fire door | hatch | ✓ |
| `Exit_<style>` (posts ±0.63, header 2.4, leaf 1.15 × 2.30 opening outward, porch recess 1.0 m, `SkyPlane`, boards, chains) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Window (border face; reveal ≤ 0.35 m inside the wall tile; curtains ≤ 0.20 m into the room; `_short` variant head 2.35 m for ceilings < 2.9) | `Win_sash` 1.10 × 1.85, sill 0.80, lace + velvet drapes | `Win_tall` 1.20 × 2.05, shutters, pelmet | `Win_cellar` 0.90 × 0.45 at 2.05–2.50 m, bars, light well | `Win_dormer` 0.7 × 1.0, `Win_oculus` Ø 0.8 | `Win_industrial` 1.8 × 1.9 steel, 3 panes broken (curtain morph sway) |
| `Mod_skylight` (replaces a ceiling tile; shaft lining 0.6 m) | – | – | – | 2 per truss_hall | sawtooth north light, 3 per assembly_floor |
| `Mod_fireplace` (breast ≤ 0.40 proud, firebox recessed 0.45, mantel 1.25 m, hearth ≤ 0.42 proud, `Emit` embers) | ✓ | marble | – | – | forge variant |
| `Mod_wallhole_lath` A/B/C (0.6 × 0.45 / 1.0 × 0.8 / 0.7 × 0.5; recess 0.12 m, lath, horsehair plaster; debris ≤ 0.35 m out) | ✓ | ✓ | `Mod_breach_brick` | `Mod_hole_boards` | ✓ |
| `Band_peel_A..D` (curled wallpaper, both sides textured, ≤ 0.08 m off the wall) | ✓ | ✓ | flake variant | split boards | flake variant |
| `Mod_niche` (arched, 0.6 × 1.1 × 0.35, porcelain figure) | – | ✓ | – | – | – |
| `Band_ceilingrose`, `Mod_ceilhole` (lath hanging no lower than 2.40) | ✓ | coffer + rose | ceilhole | ceilhole | ceilhole |
| Beams (geometry in JS, Blender tileable textures 2048×512) | – | – | 4-joist group per tile (bottom 2.45) | collar ties 0.15 × 0.20 at 2.45; trusses in halls (ties ≥ 2.60) | timber 0.20 × 0.30 or steel I-beam (bottom ≥ 3.05); hall roof trusses |
| `Band_attic_ladder` (folded into the ceiling) | – | – | – | ✓ | – |

### B6. Band décor and props (non-solid; reach ≤ 0.44 m from the face; within u ∈ [0.05, 0.95])

| Style | Assets (W × D × H, m) |
|---|---|
| wood | dresser 1.0 × 0.44 × 0.95; toy_shelf 1.2 × 0.30 × 1.6; changing_table 0.9 × 0.44 × 0.95; washstand 0.85 × 0.44 × 0.8; radiator 0.8 × 0.12 × 0.65 (under windows); bookshelf_low 0.9 × 0.32 × 1.1; puppet_theatre 1.2 × 0.40 × 1.6; night_stand 0.45 × 0.40 × 0.6; wall clock; kids' frames ×3; coat hooks; doll shelf 1.2 × 0.22 at 1.45 m (seated scare dolls via `makeDoll`) |
| tile | console 1.0 × 0.40 × 0.85 + dark mirror; grandfather_clock 0.5 × 0.30 × 2.1 (pendulum); doll_cabinet 1.2 × 0.42 × 2.0 (glass, baked dolls, hero); china_cabinet 1.1 × 0.42 × 2.0; sideboard 1.6 × 0.44 × 0.95; hall_bench 1.2 × 0.42 × 0.48; gilt mirror; umbrella stand; bell board (servant) |
| concrete | fuse box; water heater Ø 0.42 × 1.6; utility sink 0.6 × 0.44; pegboard; coal bin 0.9 × 0.44; metal shelf 1.2 × 0.40 × 1.9; barrel Ø 0.42 |
| attic | box stack 0.9 × 0.44 × 1.2; rolled rug; leaning mirror; suitcase pile; mannequin Ø 0.42; frames leaning 1.1 × 0.22; cobweb cards (alpha, ≥ 2.2 m, corners) |
| workshop | eye_shelf 1.3 × 0.30 × 1.9 (glossy jars); tool wall; parts_drawers 1.0 × 0.44 × 1.3; limb_hooks (≤ 0.35); paint shelf 1.2 × 0.35 × 1.8; filing cabinet 0.45 × 0.44 × 1.3; head shelf (replaces the InstancedMesh at house.js:356-361) |
| servant (any style) | service shelf 1.4 × 0.25 × 1.8; bell board; conduit; batten light |

**Rugs:**
- Atlas `textures/surf/rug_*.webp` (Persian runner 0.9 m segments, round Ø 1.6, kilim 2.0 × 1.4, oriental 2.4 × 1.7, rag 1.2 × 0.7, jute 1.5 × 1.0).
- Flat merged quads at y = 0.002 with polygonOffset. Never on board tiles.
- Notes (0.006, level.js:572) and footprints (0.004) stay above rugs.

**Clutter** (12–16 per style, a 2048² shared atlas): books, bottles, blocks, teddy, tin soldier, candle stubs, plaster chunks, glass shards, doll limbs, jars, paint cans, coal.
- Placed on furniture sockets (`SOCKET_*` empties) or within the wall band.
- Pieces under 0.3 m may be dropped on Low (the only quality-dependent placement).

**Fixes to today's props:**
- workbench 0.50 → 0.44 against walls (house.js:339);
- dress form 0.52 → 0.42 (house.js:350);
- dust sheets up to 0.58 → 0.44 (house.js:317);
- hanging dolls (house.js:370-377) → wall hooks ≤ 0.35 m from the wall, or hall roof ties with feet ≥ 2.35 m.

### B7. Wardrobes, exit

**Wardrobes**, one variant per style:
- wood: painted pine with nursery stencils;
- tile: mahogany armoire;
- concrete: double steel locker, louvred;
- attic: wardrobe half under a dust sheet;
- workshop: louvred tool cupboard.

**Exact contract** (level.js:497-513, render.js:25, 37, 145-152):
- body 1.15 × 2.25 × 0.6, crown ≤ 2.35;
- hinge axes x = ±0.575, z = 0.305; leaves 0.575 × 2.2 with the origin on the hinge;
- alpha-tested louvres; hollow single-sided interior, coats only beyond x = ±0.30;
- `makeWardrobe` keeps `c.doors[{pivot, leaf, side, open}]`;
- triangles ≤ 8k + 2 × 1.5k.

**Exit:** `level.door = {door, lamp, lockedMat, openMat, open, setOpen, shared:true}`. On `powerOn`, `Exit_boards` drop over 0.4 s, then the leaf swings outward 0 → 1.75 rad over 1.6 s with a creak, revealing porch and sky. The trigger stays the 18 u cell disc (game.js:143-146).

### B8. Light fixtures (each has a Blender emission profile, C3)

| Style | Fixtures |
|---|---|
| wood | `sconce_shade` (pink pleated, plate at 1.95 m, ≤ 0.25 m deep), `pendant_shade` (halls), `night_light` (on dressers, flicker) |
| tile | `sconce_candles` (brass, 2 candles), `chandelier` (Ø 0.9, crystal drops; bottom ≥ 2.80), `standard_lamp` (in isl_parlour) |
| concrete | `bulkhead` (caged, 2.1 m), `bare_bulb` |
| attic | `bulb_batten`, `hurricane_lantern` (on a trunk, flicker) |
| workshop | `green_shade` (enamel Ø 0.45), `anglepoise` (benches) |
| practical glows | `boiler_glow`, `kiln_glow`, `fire_embers`, `candelabrum` |
| servant | `batten_light` |

**Placement:**
- wall sconces: `fixDen` per face (house.js:151);
- hall pendants or chandeliers per template;
- bulbs on cells with `vh(x,y,97) < 0.3` (0.36 workshop) for the bulb styles;
- practical glows on their furniture.

### B9. Surface sets (`surfaces2.py`, extends map_textures.py:104-126 selected-to-active)

| Set | hi | md | lo | Maps |
|---|---|---|---|---|
| Floor (1 tile, 2.25 m) | 2048² | 1024² | 512² | `colorA`, `colorB` (clean/worn), `normal`, `orh` (R AO, G roughness, B height) |
| Wall (2.25 × 3.0 m; A and B side by side) | atlas 4096×2731 colour, 2048×2731 normal / orh | half | quarter | same |
| Upper band (above 3.0 m, tiles vertically) | 1024×1365 | 512 | 256 | color, normal, orh |
| Ceiling (1 tile) | 1024² | 512² | 256² | color, normal, orh |
| Service wall | 1024×1365 | 512 | 256 | color, normal, orh |
| Trim sheet | 2048×256 | 1024×128 | 512×64 | color, normal, orh |
| Beam / ibeam | 2048×512 | 1024×256 | 512×128 | color, normal, orh |
| Detail tiles `dust_detail`, `wet_edge`, `grime_detail` (512², tileable, data) | 512² | 512² | 256² | R channel |

**Per style:**

| Style | Floor | Wall | Ceiling | Upper band |
|---|---|---|---|---|
| wood | 0.13 m oak boards (A clean, B worn paths) | damask paper over raised-panel wainscot, rail 0.93 (B: stained, peeling) | cracked lime plaster | stained frieze |
| tile | 0.28 m marble checker | glazed tile dado to 0.87 + damask | ornate plaster | panelled frieze |
| concrete | slab with joints | brick with rising damp (B: whitewashed, flaking) | board-marked slab | rough render |
| attic | 0.20 m rough planks | vertical boards | sarking between rafters | boarding |
| workshop | 0.15 m quarry tiles (B: oil-soaked) | plaster over tongue-and-groove to 0.93 | timber boarding | limewash brick |

**Wall variant trick:**
- uv0.u = 0.5·u + 0.5·variant (variant from `vh`); map repeat (1, 1).
- `normalMap` and the orh map use repeat (2, 1) with RepeatWrapping, which recovers u.
- The rail and panels baked into the texture (map_textures.py:237-257, 330-349) must stay at the profile heights in B5.

### B10. Lighting and atmosphere data from Blender

| File | Script | Method |
|---|---|---|
| `textures/light/profiles.json` | `fixtures.py` | Each fixture with a 2700 K emitter (r 0.02 m) inside a 5 m white-Lambert sphere. DIFFUSE direct, colour off, 512 spp, EXR + Standard, denoised. Stored as a 64×32 lat-long RGB relative intensity, normalised to mean 1, rounded to 3 decimals; plus `mount` (light-centre offset from the node origin) and `k0` (calibration start) |
| `textures/light/cookies/<win>_<az>.webp` (az ∈ {−30, 0, +30}, mirrored) | `cookies.py` | Window + curtains in a wall, sun 35° elevation, 0.5° disc. Transmittance in window space (opening u, v), 256² grey |
| `textures/light/ao_profiles.json` | `ao_profiles.py` | AO on canonical geometry (inside/outside corner, floor line, ceiling line, under skirting, box contact on floor and on wall vs. distance), float curves of 64 samples over 0–0.6 m |
| `textures/sky/night_garden.<tier>.webp` (4096×2048 / 2048×1024 / 1024×512) | `sky.py` | Equirect camera, moon disc + sun lamp, noise clouds, tree silhouettes, garden wall, ground fog volume, 256 spp + OIDN. Plus near layers `well_alpha` (cellar) and `roofs_alpha` (attic), 2048×1024 |
| `textures/env/<style>.webp` (256×128) | `env.py` | Dim interior equirect from a furnished reference room (wet-floor and glass reflections) |
| `textures/glass/{rain_normal,grime_orm}.webp` (1024²) | `glass.py` | Droplets, streaks, fingerprints |

### B11. Decals (`decals.py`)

**Atlases:** `textures/decals/decals_{albedo,normal}.<tier>.webp` (4096² / 2048² / 1024²; albedo RGBA, alpha = coverage) plus `decals.json` `{id, rect, size_m, kinds, heights:[lo,hi], styles}`.

**Contents:**

| Decal | Count | Notes |
|---|---|---|
| water stains (tide rings) | 8 | |
| mould | 4 | |
| soot plumes | 2 | above every sconce, candle and fireplace |
| scratches | 6 | normal; claw marks at frames and wardrobes |
| crayon drawings | 8 | Bézier strokes, wax shader: stick family, tall figure in a blue dress, house with no door, sun face, tally marks, "LA LA LA", "LET ME OUT", "DONT LET HER IN" |
| handprints | 6 | hand mesh pressed into paint: child L/R, smear, adult, bloody, oil |
| footprints | 4 | child shoe L/R, her bare L/R |
| crack networks | 4 | + normal |
| paint flakes | 4 | |
| rust streaks | 3 | |
| picture ghosts | 2 | |
| damp tide band | 2 | |
| peel_under | 4 | |
| tile_missing | 2 | |
| height chart | 1 | |
| floor | — | puddle masks ×8, water rings ×6, rust rings, scorch, paint spill, dust clumps |
| ceiling | — | rings, mould, soot ring |

Made from real geometry baked orthographically with transparent film, plus procedural noise, then OIDN.

### B12. Budgets

**Triangles (hi / lo):**

| Asset | hi | lo |
|---|---|---|
| Island set | ≤ 25k | 6k |
| Hero solid | ≤ 12k | |
| Medium solid | ≤ 5k | |
| Band item | ≤ 4k | |
| Small prop | ≤ 1.5k | 400 |
| Window + curtains | ≤ 10k | |
| Door frame / leaf | 2k / 2.5k | |
| Fireplace | ≤ 12k | |
| Wardrobe | ≤ 11k | |
| Fixture | ≤ 4k | |
| Column (per height variant) | ≤ 3k | |

**Texel density (hi):**

| Item | px/m |
|---|---|
| Floors and walls | 910 |
| Ceilings | 455 |
| Furniture atlas | ≥ 512 (heroes ≥ 800) |
| Doors | ≈ 800 |
| Trims | 1024 along the length |
| Decals | 430–1700 |

- Furniture: one 4096² page per style (albedo, normal, orm). Architecture, wardrobes and fixtures: one 4096² page per style.

**GPU texture memory (RGBA8 + mips):**

| Tier | Budget | Rough split |
|---|---|---|
| hi | ≤ 1.1 GB | surfaces ~280, kit ~540, decals ~110, sky 45, level maps ~40, existing ~60 MB |
| md | ≤ 320 MB | |
| lo | ≤ 110 MB | |

**Downloads:** hi ≈ 500 MB for all styles, md ≈ 150 MB, lo ≈ 45 MB (the user accepts the size).

### B13. Scripts, checks, bake time

**`tools/blender/kit/`:**
- `kitlib.py`: reset, use_best_device, PBR material builders, bevel + weighted normals, unwrap (smart_project uv0, lightmap_pack for module uv1), `bake_set()` (EXR/Standard), `denoise_image()` (compositor recipe), `to_webp()`, `export_glb()`, `--preview` (¼ resolution, 8 spp) and `--only`.
- `defs.py`: KITDEFS parser.
- `placeholder.py`: grey-box GLBs for every KIT item, wardrobes, doors and modules, with the exact node names and dimensions, in all three tiers. About 2 min.
- Asset scripts: `surfaces2.py`, `trims.py`, `doors.py`, `windows.py`, `modules.py`, `wardrobes.py`, `fixtures.py`, `furn_wood.py`, `furn_tile.py`, `furn_concrete.py`, `furn_attic.py`, `furn_workshop.py`, `islands_<style>` (inside the `furn_*` scripts), `clutter.py`, `decals.py`, `sky.py`, `env.py`, `glass.py`, `cookies.py`, `ao_profiles.py`, `doll2.py` (optional), `lookdev.py`, `contact_sheets.py`.
- Cloth (sheets, curtains, mattress covers, drapes) is simulated headless for 80 frames as in `/tmp/claude-0/clothsim.py`, then applied. Curtains in broken windows get 2 shape keys (morph sway).
- `pack.py <style> <tier>`, `build_all.sh`: queues every job serially on the 4-core machine and skips jobs whose outputs are newer than the script, `kitlib.py` and `js/kitdefs.js`.

**`check_kit.py` fails the build if:**
- any KIT node is missing, or its AABB is more than 0.02 m off;
- a band item is deeper than 0.44 m;
- any node is over its triangle budget;
- a GLB contains a light or `KHR_materials_transmission`;
- a module lacks `TEXCOORD_1`;
- wardrobe hinges are more than 0.005 m off spec;
- a wall item crosses u ∉ [0.05, 0.95].

**CPU bake time** (4 cores; from measured rates: 1024² AO at 32 spp in 6.2 s, map_textures sets 10–458 s at 1024²):

| Job | Time |
|---|---|
| Surfaces | ~5 h |
| Furniture + islands (5 styles) | ~4.5 h |
| Architecture (trims, doors, windows with cloth, modules, exit) | ~2.5 h |
| Wardrobes | 0.5 h |
| Fixtures + profiles | 1 h |
| Decals | 0.7 h |
| Sky / env / glass / cookies / AO profiles | ~2 h |
| Lookdev and contact sheets | 0.5 h |
| **Total hi** | **≈ 16–17 h** (`--preview` ≈ 45 min) |

---

## C. Lighting

### C1. Layers

| Layer | Technique | Tiers |
|---|---|---|
| Steady lamps | JS light baker → floor and ceiling plan lightmaps, wall atlas (uv1), light field for kit and characters | all (resolution per tier) |
| Flickering lamps | Same baker into a separate **flicker** channel. ≤ 16 flicker lamps per floor, ≥ 14 m apart (7 m discs never overlap; extras become steady). `flickId` tile map + `uFlick[16]`, `uFlickCol[16]` | all |
| Dead lamps | dark emissive, nothing baked | all |
| Practical glows | baked at 40% + emissive pulse | all |
| Moon | window cookies → moon channel in floor, wall and field maps; sky shader in windows; shafts + motes | maps all; shafts md/hi; motes hi |
| Flashlight | dynamic spot, the only shadow caster (world3d.js:53-60), unchanged | |
| Flashlight bounce | the existing `aura` light, re-parented to the scene (C7) | all |
| Contact shadow | albedo cavity (assets); wall AO multiply (wall aux B); floor contact shadows painted into `ovAlbedo`; glTF `aoMap` (ORM.R) on kit for indirect light | all |
| Bounce from lamps | 0.35 × blur(E_floor · ρ_floor, σ 1.0 m, wall-masked) added to floor, lower walls and ceiling | all |
| Ambient | hemisphere 0.3 → **0.16** | |

### C2. Fixed lights

The scene always holds exactly:
- hemisphere, `flash`, `aura`, `exitLight` (world3d.js:51-62);
- teammate spots as today.

**The lamp pool (house.js:185-187, 412-416) is removed in both the kit and fallback paths.**
- GLBs carry no lights; the loader also strips `isLight` defensively.
- Nothing per level adds or removes lights.
- A quality change no longer changes the light count.

### C3. Light baker (`js/lightbake.js`, pure functions on typed arrays, no DOM)

`LightBaker.bake(input, tier) → {floorLM, floorAux, ceilLM, ceilAux, wallLM, wallAux, lf0, lf1, flickId, stats}`

**Input** (all derived from `d`, `vh` and KIT, so it is identical on every client):
- grid, `CEIL` + gable rooms, `SOLIDS` (with occ and h);
- fixtures `{pos m, normal, profileId, colour, state, k, group}`;
- windows `{face, type, opening rect, moonlit}`;
- moon `{az = vh(0,0,901)·2π, el = 32° + 6°·vh(0,0,902), colour 0x8fa6d8}`;
- KIT light data; tier.

**Steps:**
1. **Visibility raster per lamp** (8 sub-cells per tile = 0.28 m, within 7 m). A sub-cell is visible if the 2D segment from lamp to sub-cell centre crosses no wall tile (DDA) and no tall box. Low boxes block floor and field receivers when the ray height at the box is below the box top. A ceiling raster ignores low boxes. Sample bilinearly (penumbra about 0.28 m). This is pipeline's measured method: 105–238 ms for 53 lights (lmbench).
2. **Irradiance:** `E = k·I(ω)·max(0, n·l) / max(d², 0.01) · (1 − (d/7)⁴)²₊ · V`. These are three's punctual-light units (lightmap and punctual both pass through `BRDF_Lambert`), so **no π factor**. ω indexes the profile. Floor n = up; ceiling n = down; walls use the face normal and the visibility raster sampled at the column's floor point plus 2 cm into the room.
3. **Light field at 1.1 m:** `E0 = Σ k I(ω)/d² w V` (RGB), dominant direction = normalise(Σ weight·l̂) (xz plus a y component). Same for flicker luminance and moon.
4. **Moon:**
   - A window is moonlit if its outward normal is within 75° of the moon azimuth. Others get a 15% cool skylight stamp of 1.5 m.
   - For each receiver texel, trace back along −moonDir to the window plane. If the hit is inside the opening: `E = K_moon(0.7) · cookie(q) · sinε`, accepted only if the plan path crosses only open tiles (≤ 3-tile DDA) and no tall box.
5. **AO (walls):** inside corners, floor line, ceiling line, behind band items, behind boxes against walls, under-sill shadow, from `ao_profiles`. This replaces the vertex AO at level.js:341-347; `vertexColors` is dropped.
6. **Encoding:** E/E_MAX (E_MAX = 4) → sRGB transfer → ±0.5 LSB blue-noise dither, into `Uint8ClampedArray`. **Textures are `new THREE.CanvasTexture(new ImageData(u8c, w, h))`, never a 2D canvas with alpha below 255** (canvas premultiplication destroys RGB when alpha is small). `flipY=true`, row 0 = grid row 0. Plan uv = (x/(GW·L), 1 − z/(GH·L)), matching the floor plane's own uv.

**Budget:** High ≤ 250 ms (desktop), md ≤ 150 ms, lo ≤ 80 ms. Synchronous inside `buildLevel`. Test F4 asserts ≤ 3× budget on the test machine. If High exceeds budget in WP6, move it to `js/lightbake.worker.js` (the same file via `importScripts`).

### C4. Map formats

| Texture | Res. hi / md / lo | Channels | Colour space |
|---|---|---|---|
| floorLM, ceilLM | 20 / 12 / 8 px/m over GW·L × GH·L | RGB steady, A flicker luminance | sRGB (A linear) |
| floorAux, ceilAux | same | R moon, G bounce-moon (reserved), B,A = 255 | linear |
| wallLM | atlas: smallest of 512², 1024×512, 1024², 2048×1024, 2048² that fits; cells (L·ppm+2) × (H·ppm+2); ppm 20 / 12 / 6 | RGB steady, A flicker | sRGB |
| wallAux | same atlas | R moon, G 0, B AO multiply | linear |
| lf0 | 8 / 8 / 4 px/m | RGB steady E at 1.1 m, A flicker | sRGB (A linear) |
| lf1 | same | R,G dominant direction xz (0.5 + 0.5x), B up component, A moon | linear |
| flickId | GW × GH, nearest (1003), no mipmaps | R = group id + 1 | linear |

**Sampler counts:**
- floor ≤ 13 (map, normal, orh, floorLM, floorAux, ovAlbedo, ovSurf, dust, wet, flickId, tileInfo, shadow, cookie);
- wall ≤ 9;
- kit ≤ 9.

All are within the WebGL2 minimum of 16.

### C5. Shader patches (`js/matlib.js`; shared uniform object `U`; one `customProgramCacheKey` per family)

**Uniforms:** `uLampK`, `uMoonK`, `uMoonCol`, `uMoonDir`, `uEMax`, `uFlick[16]`, `uFlickCol[16]`, `uFlickId`, `uPlan` (1/(GW·L), 1/(GH·L)), `uTime`, `uLF0`, `uLF1`.

**Floor** (MeshStandard on all tiers):
- `map`, `normalMap`, `roughnessMap` (orh.G), repeat (GW, GH).
- `lightMap = floorLM` (channel 0, repeat 1), `lightMapIntensity = uEMax · uLampK` (set per frame).
- Patch at `lights_fragment_maps`:

```glsl
irradiance += texture2D(floorLM, vLightMapUv).a * uEMax * uFlick[id] * uFlickCol[id] * uLampK + texture2D(floorAux, vLightMapUv).r * uMoonK * uMoonCol;
```

  where `id = int(texture2D(uFlickId, vLightMapUv).r * 255. + .5)`.
- Plus D1's surface patch.

**Ceiling:**
- Per-tile merged quads, chunked 6×6 tiles.
- uv0 = world xz / 2.25 (repeating set); **uv1 = plan uv**, so `lightMap.channel = 1`.
- Same patch. `receiveShadow = true`. Standard on md/hi, Lambert on lo.

**Walls:**
- `wallGeometry` writes uv0 (variant trick, v = y/3 per row band) and uv1 (atlas cell). Groups: main / upper / service.
- Standard + normal + orh on md/hi; Lambert + lightMap on lo.
- `lightMap = wallLM` (channel 1); `wallAux` is sampled at `vLightMapUv`: `diffuseColor.rgb *= aux.b;` plus the same flicker and moon terms.
- Flicker id: tile from the world xz varying.

**Light field** (`withLightField(mat)`): kit instances, merged trims, frames, beams, wardrobes, doors, puzzle boxes, dolls, **her and teammates**.
- Vertex: `vLFw = (modelMatrix * (instanceMatrix *) vec4(transformed, 1.)).xyz`.
- Fragment: world normal `nW = inverseTransformDirection(normal, viewMatrix)`, then:

```glsl
vec4 a = texture2D(uLF0, uv), b = texture2D(uLF1, uv);
vec3 dir = normalize(vec3(b.r * 2. - 1., b.b * 2. - 1., b.g * 2. - 1.));
float wrap = .35 + .65 * max(dot(nW, dir), 0.);
irradiance += (a.rgb * uEMax * uLampK + a.a * uEMax * uFlick[id] * uFlickCol[id] * uLampK) * wrap + b.a * uMoonK * uMoonCol * max(dot(nW, -uMoonDir), .25);
```

  where `uv = (vLFw.x * uPlan.x, 1. - vLFw.z * uPlan.y)`.
- The glTF `aoMap` multiplies this (indirect), which is correct.

**Emissive:**
- `Fix_*_emit`: instanced MeshBasic × `instanceColor` (lamp colour × level × 4), updated per frame.
- Glow: one `Points` mesh with per-point colour. **2 draws for all lamps** (today 2 per fixture, house.js:138-150).

**Decals (walls):** merged quads 3 mm proud. `uv1` comes from their face's atlas cell, so they are lit exactly like the wall behind them. Wall patch with `alphaTest 0.02`.

### C6. Moon, windows, shafts, dust

**Sky:**
- `Win_*_sky` / `SkyPlane` 0.9 m behind the glass, inside the border wall tile (depth ≤ 1.0, u ∈ [0.05, 0.95]).
- ShaderMaterial with `fog:false`; `dir = normalize(worldPos − cameraPos)` → equirect lookup in `night_garden` (exposure 0.35, cloud drift via `uTime`).
- Near alpha layer per style at 0.7 m.

**Glass:** MeshStandard, transparent, `rain_normal`, `grime_orm`, `envMap` = sky (mapping 303) at 0.4.

**Shafts:**
- One prism per moonlit window: opening corners plus their projections, clipped at the first wall by 2D march. All merged into **one mesh**.
- Additive ShaderMaterial, back faces, `depthWrite:false`, `fog:false`.
- Analytic ray-prism slab intersection for thickness, then N march steps sampling the cookie (mullions in the beam) and 3D noise drifting at 0.03 m/s.
- Fade near the camera (< 0.6 m) and beyond 14 m.
- Steps: hi 8 with cookie; md 4 without cookie (phones get no shafts, since phones use lo); lo none (floor patches remain).

**Motes:** one `Points` mesh, ≤ 60 per shaft and ≤ 600 per level. GPU drift, lit only inside the cookie mask (vertex back-projection). High only.

### C7. Flashlight bounce (realism graft)

- `aura` is re-parented from the camera to the scene (world3d.js:61). This keeps the light count.
- Each frame while not hidden: march the flashlight ray (0.1 m steps, ≤ 12 m) through the grid, floor, `ceilAt` and box AABBs, giving hit P and normal n.
- `aura.position = P + 0.35 n`; colour = flash colour × hit surface mean-albedo tint (precomputed per material); `intensity = 2.5 · ρ · flash.intensity/25 / (1 + 0.08·dist²)`, distance 5.5, decay 2, lerped 0.25 per frame.
- While hidden, keep today's behaviour (render.js:104: 3.2–3.5, distance 8) at the camera position.

### C8. Per-frame control (render.js after :103 and at :187)

- `U.uLampK = scares.dim · (house.dark ? 0 : 1)` (eased).
- `lightMapIntensity = uEMax · uLampK` on floor, ceiling and wall materials.
- `uMoonK = 1`: **the moon never goes out**, so in the dark scare the windows are the only light.
- `uFlick[g] = lampLevel(fixture, t)` (house.js:401-407 curves; calm holds 0.8).
- Emissive instance colours follow the same levels.
- All of these are uniforms only: **no recompiles**.

### C9. Calibration targets (flashlight stays dominant)

| Quantity | Target |
|---|---|
| 1 m below a working lamp | E ≈ 1.5–2.5 |
| Flashlight at 2 m | ≈ 13 |
| Moon patch | ≈ 0.7 |
| Hemisphere | 0.16 |
| Fixture `k` | starts from `profiles.json` `k0`, tuned in WP6 against `lookdev.py` Cycles renders of a reference room (±25% mean luminance) |

Tone mapping stays ACES at 1.2. AgX (6) is optional behind the F4 brightness test.

### C10. Tiers (lighting and visuals)

| | Low (all tests) | Medium | High |
|---|---|---|---|
| Asset tier | lo | md (lo on phones) | hi if MAX_TEXTURE_SIZE ≥ 8192 and `(navigator.deviceMemory ‖ 8) ≥ 8`, else md |
| Plan maps / wall ppm | 8 / 6 | 12 / 12 | 20 / 20 |
| Light field | 4 px/m | 8 | 8 |
| Floor material | Standard (no POM) | Standard | Standard + POM 12 steps |
| Wall material | Lambert + lightMap | Standard + normal/orh | + POM 12 steps |
| Shafts / motes | – / – | 4 steps / – | 8 steps / ✓ |
| Curtain sway, rocking, mobiles | off | on | on |
| Wet envMap | off | 0.15 | 0.25 |
| Bloom | – | – | ✓ |
| Flashlight shadow | off | on | on |

---

## D. Surface detail (`js/surface.js`)

### D1. Floor overlays

`Surface.build(lv)` paints two plan-space ImageData textures at 2048 / 1024 / 512 px on the long side.
- **`ovAlbedo`** (RGB multiply): corner shade (`paintShade`, level.js:196-204), contact shadows from `ao_profiles` box curves under boxes, wardrobes and band items, floor decals (`paintDecal` + atlas stamps), rug fringe shadows.
- **`ovSurf`** (RGBA data): R wetness, G dust, B clean (walked paths and footprints), A wear (polish).
- **`tileInfo`** (GW × GH, nearest): R albedo variant (A/B), G plank rotation 90° per region (rooms differ from passages; threshold seams at doorways).

**Floor patch** (extends level.js:90-97; key `'floorV2'`):

```glsl
vec4 sf = texture2D(uSurf, vLightMapUv);
float dust = clamp(sf.g * (1. - sf.b) * texture2D(uDustDetail, vUv * uDetailRep).r * 1.6, 0., 1.);
float wet  = clamp(sf.r * (.6 + .8 * texture2D(uWetEdge, vUv * uDetailRep).r) - .3, 0., 1.);
diffuseColor.rgb *= texture2D(uOverlay, vLightMapUv).rgb;
diffuseColor.rgb  = mix(diffuseColor.rgb, uDustCol, dust * .55);
diffuseColor.rgb *= 1. - .45 * wet;
roughnessFactor   = mix(mix(mix(roughnessFactor, .95, dust), roughnessFactor * .6, sf.a), .05, wet);
normal            = normalize(mix(normal, nonPerturbedNormal, max(dust * .6, wet * .85)));
```

- `envMap` = `env_<style>` (mapping 303) × wet on md/hi.
- The flashlight's specular highlight on wet patches (roughness 0.05) gives the glossy reflection.

### D2. Dust, walked paths, footprints

**Dust (G):**
- Base per style: attic 0.85, workshop 0.55, nursery 0.45, concrete 0.35, tile 0.3.
- +0.4 within 0.3 m of walls and boxes; ×1.3 in halls; low-frequency `vh` noise.

**Clean paths (B):**
- `bfsPath` (cut-aware) for spawn → exit, spawn → each puzzle, puzzle → puzzle, and 12 seeded cell pairs.
- Rasterised 0.7 m wide with a ±0.15 m seeded meander, blurred 0.3 m, max-combined. Wear (A) along the same paths on wood and tile.

**Static footprints:**
- Child shoe prints stamped as "clean" every 0.7 m along some paths.
- One trail of her bare prints per floor ending at a wardrobe.

**Dynamic dust prints:** one InstancedMesh of 200 (ring buffer, y = 0.003 above rugs).
- Stamped every 0.65 m where dust > 0.4, read from a CPU copy of ovSurf.
- Sources: player, teammates (multiplayer.js:619), her (monster.js:187-190). Her prints turn grey dust prints in dusty areas; her wet blue prints stay elsewhere.
- Visual only.

### D3. Wet (R)

- Basement: 18% of tiles (replaces the puddle planes at house.js:224-236, same keys via `vh`), plus under pipe drips and floor drains.
- Attic: under ceiling water stains (wet 0.6), with drip `Points` (≤ 6 per stain, High only).
- Elsewhere: 3–5 spills per floor; workshop sinks.
- Never on note tiles.

### D4. Wall decals

- One merged mesh per 6×6-tile chunk; `polygonOffset −1`; `uv1` from the face cell.
- Placement by `vh` per non-busy face, ≤ 2 per face, never within 0.5 m of a puzzle box, portrait or painted word.
- Heights: drawings 0.3–1.1 m (nursery and playrooms ×3), handprints 0.5–1.6 m, soot above fixtures, stains from the ceiling line down, damp band 0–0.8 m.
- Density per face: wood 0.35, tile 0.25, concrete 0.5, attic 0.4, workshop 0.45.

### D5. Damage

- Wall variant B per face.
- `Band_peel_*` on 6% of wood and tile faces, with a stain above.
- Crack decals with normals, plus plaster-chunk clutter below.
- `Mod_wallhole_lath` 2–6 per floor (its face is skipped in `wallGeometry`).
- `Mod_ceilhole` 1–2 per floor with rubble decals below.
- Broken window variants.
- Scuffs on frame casings; scratches baked into wardrobe albedo.

### D6. Ceiling

`ovCeil` (plan-space multiply): water rings (one above every wet patch), soot above lamps, cracks, mould near cold border walls.

### D7. POM

- High only, walls and floors, 12 steps. Height from orh.B; tangent frame from `dFdx`/`dFdy`.
- The same uv offset is applied to every map's varying.
- Off on md, lo and phones.

---

## E. Integration

### E1. Script order (index.html:217-243)

```
… core.js → js/kitdefs.js → js/layout.js → audio.js → floors.js → … world3d.js
  → js/kit.js → js/matlib.js → js/lightbake.js → js/arch.js → js/dress.js → js/surface.js → js/atmos.js → level.js → …
```

New files only define functions and data at load time. They call other files' functions only at runtime.

### E2. `buildLevel()` (level.js:23-57) new order

1. `disposeLevel()`.
2. `kit = Kit.get(style, tier)` (may be null → placeholder boxes).
3. `plan = Dress.plan(...)` (pure; doorway tiles, windows, modules, fixtures, band décor, rugs, decals sources, beams, room identities) → `level.plan`.
4. Floor (D1 material); `Arch.ceilings(plan)`; `Arch.walls(faces, plan)` (heights, insets, uv1, variant trick, module skip predicate); `Arch.trims` (mitred sweeps using the brief B7 corner classes); `Arch.beams`; `Arch.doorways` (frames + leaves); `Arch.modules`.
5. `House.build(THREE, env)`: **fallback only** when `!kit`, or for pieces with no kit asset. It keeps the `dolls`, `fixtures`, `doorTiles`, `beam`, `update`, `dispose`, `calm`, `dark` API.
6. `Kit.furnish(level, plan)`: solids (instanced per (kind, primitive, 6×6 chunk), `castShadow` on md/hi), islands, band décor, fixtures, windows, wardrobes (`makeWardrobe` keeps its API), exit (`makeExit` keeps `level.door`).
7. `wallDecor` (skips wardrobe cells, module, window and servant faces).
8. `LightBaker.bake` → materials.
9. `Surface.build`.
10. `Atmos.build` (sky, glass, shafts, motes).
11. Puzzles, notes, boards (unchanged clones, direct children named `BoardShort`/`BoardLong`, level.js:118-124), prints, dust prints.
12. `scene.add`.
13. `renderer.initTexture()` on new textures; `compileAsync` through the right target (WP0).

**`level.house`** stays a façade: `{group, update, dispose, beam, fixtures, dolls, doorTiles, calm, dark, kitCount, doors, upgrade}`.

### E3. render.js per frame

- After :103: `Light.setK(scares.dim, level.house.dark, calm())`; bounce light update (C7).
- :169-172: `if (D.setOpen) D.setOpen(powerOn)`.
- After :186: `Arch.updateDoors(dt, actors)`, `Atmos.update(t)`, dust-print spawning, emissive instance colours.

### E4. Loading and gating

**`Kit`** (js/kit.js):
- `want(style, tier) → Promise`, `ready(style)`, `get`, `progress()`, `release(style)`.
- Uses the `gltfLoader()` pattern (world3d.js:143-166); surfaces and light data via Image → CanvasTexture (`flipY` true for plane UVs, false for glTF UVs).

**Boot** (main.js:40): `Kit.preload(['common', FLOORS[0].style], tier)` plus light data.
- The Play button stays "Loading the house… n%" until her model and those resolve or fail (extends world3d.js:126-130). Other styles prefetch in floor order.

**Single player:** `playFloor` (input.js:220-223), `tGo` (:250) and `retry` (:246) await `Kit.want(style)` behind an overlay (max 30 s), then call `startFloor(i)`.
- **`startFloor` stays synchronous** (tests call it directly).

**Multiplayer:**
- The lobby Ready button waits for kits of floors L.level..4 (or failure).
- A client still missing a kit at floor start builds with placeholders. `Kit.upgradeInPlace(level)` swaps only kit-owned groups when the kit arrives; it never rebuilds, so `scares.doll`, `level.paintings` and boards are untouched (brief B11). The light bake reruns once.

**Tests:** `lib.mjs` gains `waitKit(p, style)`. `solo()` keeps waiting for `#play`.

### E5. Disposal and memory

- `disposeLevel` (level.js:6-22) map list becomes `['map','emissiveMap','bumpMap','normalMap','roughnessMap','metalnessMap','aoMap','lightMap','alphaMap','envMap']`.
- Plus `material.userData.disposables[]` (overlays, atlases, field, `flickId`).
- It skips `userData.shared` **and** `userData.sharedGeo` and `userData.kit`.
- The house list (house.js:434) is extended the same way.
- Kits are cached per (style, tier). Keep the current and next style; evict the others on floor entry. Lobby `wood1`/`paper1` (lobby3d.js:19-21) are never evicted; old textures stay in the repo.
- Chunking: walls, ceilings, trims, decals and kit instances per 6×6 tiles (13.5 m) so frustum culling works.
- Camera far plane 60 → **18 m** (world3d.js:50).

### E6. Budgets (asserted in F3)

| Tier | Draws incl. shadow pass | Triangles per frame | Programs | Textures |
|---|---|---|---|---|
| High | ≤ 450 | ≤ 1.2 M | ≤ 90 | ≤ 1.1 GB (hi) or ≤ 320 MB (md) |
| Medium | ≤ 320 | ≤ 650 k | — | ≤ 320 MB |
| Low | ≤ 240 | ≤ 300 k | — | ≤ 110 MB |

### E7. Fallbacks and flags

| Failure | Fallback |
|---|---|
| Layout invalid | retry, then classic (A3) |
| Kit missing | placeholder boxes with exact footprints for solids and islands (so collision is always visible); procedural house.js for the rest; module faces not skipped |
| Profiles missing | isotropic profile |
| Cookies missing | trapezoid patch |
| Sky missing | flat dark blue emissive |
| Surfaces missing | painted canvases (today's path) |
| Light bake throws | `uLampK = 0`, hemisphere 0.3 |

**URL flags:** `?kit=off`, `?lookdev=1` (reference room for calibration), `?debug=1` (overlays solids, cuts and islands on the 2D map).

---

## F. Tests

### F1. `tests/layout.test.mjs` (new; logic only; 'low'; ~60 s)

1. **Completable:** 5 floors × n 1–4 × easy/medium/hard × 30 explicit seeds = 1,800 houses.
   - `validateFloor(generateFloor(i,n,diff,seed))` is empty; `LAYOUT_REJECTS` stays empty; no `d.classic`.
   - Report halls placed against planned, islands, boxes, cuts, coverage.
   - **Assert per-floor average coverage ≥ 0.30 of open tiles.**
2. **Independent proof** (the test's own code, not `validateFloor` or `NAV`):
   - Rebuild walls from `rows`, boxes from `d.solids` + KIT, closets from `d.closets`.
   - 5-u flood from **each** spawn at r 11 reaches exit/18, notes/20, puzzle use/36 (with a sight line through walls and tall boxes), wardrobes/28.
   - Flood from m0 at r 12 (no closets) reaches every cell centre within 4, every c+o·16, and every non-island open tile centre.
3. **Invariants:**
   - odd/odd tiles open; border solid; rows only '0'/'1';
   - wardrobes == quota (100%), each a dead end facing open floor;
   - puzzles == `puzzleCount` (100%, now a hard check);
   - exit is a dead end; m0 `dist(cut) > 0.55·maxD`;
   - island inset ≤ 11 u on every side.
4. **Protected zones:** no box in x ≤ 5 ∧ y ≤ 5, wardrobe c/c+o/c+2o, exit + front, note quad + 0.1 m, puzzle fronts (20 × 40 u), board footprint + 14 u, any non-island core. Gaps ≥ 26 u; boxes inside open tiles.
5. **Nav:** every uncut band is box-free; every cut band truly intersects a box; the cut graph is connected; each box matches its KIT footprint (rotated) on a legal slot.
6. **Determinism:**
   - same seed twice gives identical JSON;
   - `applyLayout` round trip gives an identical FNV hash of `NAV.cut`, buckets, occ, `CEIL`, `SOLIDS`;
   - toggling `settings.quality`, `LOWQ` and kit-loaded state leaves `d` unchanged;
   - a second page with the same seed gives the same hash.
7. **Boards:** extras.test.mjs:39-66 rules plus "no board on a servant run or box-touched tile".
8. **Classic:** with `LAYOUT_FORCE_CLASSIC = true`, the original levels.test.mjs:9-33 checks pass.
9. **Speed:** average `generateFloor` including validation ≤ 25 ms (fail above 60 ms).
10. **Path length:** average maxD per floor ≥ 0.9 × today's measured baseline (54 / 64 / 68 / 66 / 70).

### F2. `tests/walk.test.mjs` (new; real game code without rendering; ~3 min)

1. **Player walker** (the end-to-end completion proof): every floor × every difficulty at fixed seeds, plus F2 and F5 at 4 players (slot 0).
   - Setup: `applyFloor`; `m.active=false; m.spawnT=1e9`; `scares.next=1e9`; `player.fear=0`.
   - Route: A* on the test's own 5-u flood. Steer by `player.ang`, set `keys.KeyW=true`, loop the real `updatePlayer(1/60)` synchronously.
   - Asserts:
     - each puzzle reaches `puzzleTarget===k`, then `bb.applyFuse(k)`;
     - each note flips `read` (close the note screen);
     - each wardrobe sets `hideTarget`, and `toggleHide()` hides and leaves;
     - the exit sets `state` to `'trans'` (or `'win'` on F5);
     - the player never ends a step inside a box.
   - Time limit per target: path length / 105 × 2 + 5 simulated seconds.
2. **Monster walker:** real `stepAlongPath` from m0 to 40 seeded cells, every c+o·16 and one fake-leave spot, with random close-chase bursts through `moveEntity` (r 12).
   - Arrival within (tiles × 50/26 × 1.3 + 5) s; `!blocked(m.x, m.y, 11.9)` at every step; the stall guard never fires.
3. **Around the table:** player behind a bar box, her opposite, walls-only `los` true, `clearLine` false. Real `updateMonster` with a `downPlayer` spy: she catches within 12 s.
4. **Breaking sight:**
   - behind a tall box: `losSight` false, `los` true, `seen` stays null;
   - behind a low box: crouching → null; standing → seen.
5. **Multiplayer start room:** no box in tiles 1..5; the body-blocking walk (multiplayer.test.mjs:83-90) still passes.

### F3. `tests/house3d.test.mjs` (new; renders; whole file at 'low' then 'medium'; ~6 min)

1. **Kit contents:**
   - every style's kit loads (`waitKit`, 180 s);
   - every manifest node is present;
   - every `Solid_*`/`Isl_*` AABB matches KIT ±0.02 m;
   - no `isLight` in any kit scene;
   - md materials have map, normalMap and orm; modules have `uv1`.
2. **Geometry per floor** (fixed seed, `buildLevel()`), over `userData.kit = {kind, mount, aabb, solid}`, with instance AABBs from `instanceMatrix × boundingBox`:

   | Mount | Rule |
   |---|---|
   | floor | min.y ∈ [−0.005, 0.02] |
   | wall | ≤ 0.44 m from the face, ≤ 0.02 m past the face ends, never inside a wall tile (5 cm samples against `isWall`, 0.01 tolerance); recess modules only inside their envelope (depth ≤ 1.0, u ∈ [0.05, 0.95]) |
   | ceiling | top within 0.03 of `ceilAtXZ`; bottom ≥ 2.30 over walkable floor |
   | solid / island | visual ⊆ box + 0.05; coverage ≥ 85%; height ±0.05 |

   - **Nothing looks solid without being solid:** any non-solid, non-flat (> 0.03 m tall) object reaching walkable floor (≥ 0.45 m from walls and boxes) below 2.30 m fails.
   - Doorway leaves stay ≤ 0.45 m from the side wall at rest and at 8 sampled animation phases.
   - The structure hooks still hold: boards (extras:67-70), `house.dolls` (features:72-77), `closets[].doors` (features:111), `level.paintings` (extras:219-247), `house.group.children.length > 5 || house.kitCount > 20` (levels:92).
3. **Budgets:** after 3 frames at spawn, the largest hall's centre and a moonlit window tile: `renderer.info.render.calls`, `triangles` and `programs.length` within E6. Texture memory estimate (Σ w·h·4·1.33) within the tier budget; hi is computed from the manifest without rendering.
4. **Disposal:** floors 1 → 5 → 1 in sequence; `renderer.info.memory.{geometries, textures}` within baseline + 2.
5. **Light count** is identical at boot, after each floor build and after an upgrade-in-place.
6. **Data textures:** an ImageData texture with A = 0, RGB = (200, 100, 50) renders through a probe ShaderMaterial; `readPixels` reads ≈ the same RGB (±2).
7. **Her height:** max head-bone y + 0.12 over every clip < 2.30 m.
8. **Visual = collision:** for every `d.solids` entry, its instance's world AABB matches the box within 0.05 m.

### F4. `tests/light.test.mjs` (new; 'medium'; `?clock=manual`; ~2 min)

1. Mean luminance at fixed viewpoints (spawn, window bay, lamp-lit hall, dark passage; flashlight off) within per-view ranges; the dark passage < 6%.
2. A working-lamp view is brighter than a dead-lamp view of the same house.
3. `scares.dim = 0`: a lamp-pool pixel drops ≥ 80%; a moon-patch pixel keeps ≥ 70%.
4. Changing `uFlick[g]` changes a pixel inside that group's disc and not outside it.
5. A lightmap pixel hash is identical across two builds and two pages from the same `d`.
6. Bake time within C3 budget × 3 (logged).
7. Screenshots saved to `tests/out`.

### F5. Existing tests to update

| Test | Change |
|---|---|
| levels.test.mjs:9-33 | Explicit seeds; cut-aware BFS with the test's own cut code from `d.solids` + KIT; `closets.length === quota`; puzzle count becomes a hard check. Keep :35 |
| levels.test.mjs:92 | `house.group.children.length > 5 \|\| house.kitCount > 20` |
| extras.test.mjs:39-66 | Add "no board touches a box (grown by 14) or a servant run"; the lane is also measured against boxes |
| extras.test.mjs:102-104 | `while (!bb.isWall(tx+dx*(n+1), ty+dy*(n+1)) && !bb.cutAt(tx+dx*n, ty+dy*n, dx, dy)) n++` |
| extras.test.mjs:67-70, 219-247; features.test.mjs:42-51, 70-91, 107-113 | Unchanged |
| team.test.mjs:25-26 | Ping not in a wall **or a box** |
| multiplayer.test.mjs, rejoin.test.mjs:43 | Add `d.v`, `d.kv`, `d.seed` equality and an identical `NAV` hash on all clients |
| tests/server.mjs:9-10 | Add `.webp`, `.glb`, `.json`, `.bin` MIME types |
| tests/lib.mjs | `waitKit`; optional `QUALITY` environment variable for `solo()` (default 'low') |

### F6. Runtime

New suites add about 60 s + 3 min + 6 min + 2 min. Existing suites grow by about 20 s.

---

## G. Risks and limits

| Risk | Mitigation |
|---|---|
| A template, door budget, alcove or box breaks reachability, wardrobes or CELLS | Open-only stamping; checked connector-only closures; cut-checked boxes; validate, retry, classic; F1 + F2; prototype 2,000/2,000 |
| Bigger rooms change balance | Door budget keeps the longest path at −3% to +13% of today; tall islands and columns block sight; crouch cover; F1.10 path-length assert |
| She gets stuck or rubs against furniture | Cores and bands clear; `clearLine`-gated chase; final leg with collision; stall guard; F2.2/3; prototype 0 stuck |
| Invisible collision, or visuals walked through | Placeholder boxes until the kit loads; quality never removes boxes; F3 coverage and "looks solid" checks; 0.44 m band; 2.30 m overhead |
| Lighting differs between clients or from fixtures | Everything from `d` + `vh`; F1.6, F4.5 |
| Recompile stutter | Fixed light set, pool removed, uniforms only, High pre-compile fixed (WP0) |
| GPU memory and leaks | Tiers, lo on phones, eviction, chunking, WP0 leak fixes, F3.4 |
| Light-bake hitch | Tiered resolution, budget test, Worker escape hatch |
| Canvas alpha premultiplication corrupts data maps | ImageData-only rule + F3.6 |
| Data bakes come out tone-mapped | Rule H17 + `check_kit` histogram sanity (normal map mean ≈ (0.5, 0.5, 1)) |
| Low/test path not exercising new code | Low runs layout, boxes, lightmaps, field, decals, lo kit; F3 runs low and medium |
| CPU bake time ~16 h | Placeholder kit first; preview mode; resumable per asset; P0/P1/P2 priority order |
| A kit arrives late in multiplayer | Lobby Ready waits; never block a running floor; upgrade in place |

**What cannot be fully hyper-real here, and the closest result:**
1. The maze is random, so there is no whole-house global illumination. Closest: Blender-measured fixture profiles and window cookies, exact 2D occlusion, blurred bounce, per-asset Cycles AO.
2. Only the flashlight casts real-time shadows. Lamp light reaches her and the furniture through the light field (irradiance plus a dominant direction), not per-light shadows.
3. No SSR, SSAO, TAA or volumetric media. Wet floors use the flashlight specular plus an interior env map; shafts are analytic prisms.
4. Walls are 2.25 m solid tiles and corridors 2.25 m wide (tuned gameplay). Doorways read as deep panelled reveals; servant corridors look narrow only through visual insets.
5. Room sizes come in 2.25 m steps. Centre furniture is capped at 0.99 m (pockets), 0.99 × 3.24 m (bars), 1.95 m square (islands).
6. Textures are 8-bit and uncompressed (no KTX2/Draco in the bundle).
7. Cloth is pre-simulated (morph sway only). Doors never close the passage. Window views are a panorama.

---

## 2. Work breakdown

**Ownership:**
- **Owner A** (gameplay) alone writes core.js, floors.js, monster.js, scares.js, stealth.js, js/layout.js and js/kitdefs.js.
- **Owner I** (integration) alone writes index.html, level.js, house.js, render.js, world3d.js, main.js, input.js and lobby3d.js.
- **multiplayer.js** is edited first by A (WP1), then by I (WP4.4), never in parallel.
- **New files** belong to their package.
- **Blender bake runs** are queued serially on the one 4-core machine through `build_all.sh`. Authoring is parallel.

| ID | Title | Deliverables | Depends on | Parallel with | Acceptance | Bake |
|---|---|---|---|---|---|---|
| **WP0** | Prep fixes | level.js:12 (also skip `sharedGeo`), :16 map list, :387-388 portrait textures `shared`, dispose replaced canvases after a surface upgrade (level.js:27-37), `cMat` disposal; house.js:448 → 1001; world3d.js:58 cookie only if quality ≠ low; render.js:129-131 High `compileAsync` with `renderer.setRenderTarget(composer.renderTarget1)` around it; world3d.js:50 far plane 18; level.js:392-394 `wallDecor` skips wardrobe cells; tests/server.mjs MIME | — | WP2.0 | `cd tests && node run.mjs` all suites green; probe: no texture or geometry growth over 3 floors at medium (`renderer.info.memory`); Low cookie null | — |
| **WP1a** | KITDEFS v1 freeze | js/kitdefs.js with every B3/B4 item (gameplay fields final; art fields may grow; adding fields bumps nothing, changing footprints bumps `version`) | WP0 | WP2.0 | `node -e` parses the block with `JSON.parse`; footprints within slot bounds (A8.1) | — |
| **WP1** | Layout, collision, nav, logic tests | js/layout.js (`withSeed`, HALL_TEMPLATES, HALL_PLAN, `stampHalls`, `doorBudget`, `alcovePass`, `pickClosets`, `protectedTiles`, `furnishHalls`, `cutsFrom`, `markRuns`, `buildNav`, `applyLayout`, `validateFloor`, `ceilAt`, `ceilAtXZ`, `LAYOUT_REJECTS`); core.js (A12); floors.js (A3, A11); puzzles.js `makePuzzles(..., okFace)`; monster.js, scares.js, stealth.js, render.js:121 (A12); multiplayer.js version check; tests/hooks.js; tests/layout.test.mjs, tests/walk.test.mjs; updates to levels, extras (boards + crouch), team, multiplayer, rejoin | WP0, WP1a | WP2.*, WP3.* | `node run.mjs layout` (1,800 houses, 0 rejects, coverage ≥ 0.30), `node run.mjs walk`, then levels, extras, features, multiplayer, rejoin, team all green; parity: proto3 statistics within ±10% of the F1 report | — |
| **WP2.0** | Blender foundation + placeholder kit | tools/blender/kit/kitlib.py, defs.py, placeholder.py, pack.py, check_kit.py, contact_sheets.py, build_all.sh; models/kit/{hi,md,lo}/*.glb placeholders + manifest.json | WP1a | WP1, WP3.* | `check_kit.py` passes on placeholders; one smoke asset bakes, denoises (Standard/EXR) and exports; a contact sheet PNG renders | ~5 min |
| **WP2.1** | Surface sets | surfaces2.py → textures/surf/<style>/* (B9) for all tiers | WP2.0 | WP2.2–2.8 | Contact sheets per set (flat, tiled 3×3, grazing-light render); seamless tiling check (edge pixel delta < 2%); dado and rail heights match B5 | ~5 h |
| **WP2.2** | Architecture | trims.py (profiles.json, trim sheets), doors.py, windows.py (cloth curtains, sky planes), modules.py (fireplace, holes, peel, niche, ceilhole, skylight, ladder, Door_closed, Exit_*), beam textures | WP2.0 | WP2.1, 2.3–2.6 | `check_kit` (uv1, depth, envelope); contact sheets; door leaf hinge origin test | ~2.5 h |
| **WP2.3** | Wardrobes | wardrobes.py (5 variants) | WP2.0 | others | Hinge ±0.005; camera-inside render shows louvres; contact sheet | ~0.5 h |
| **WP2.4** | Fixtures + profiles | fixtures.py → `Fix_*` nodes + textures/light/profiles.json | WP2.0 | others | Each profile renders as a lat-long PNG preview; normalisation mean = 1 ± 0.01; shade scallop visible | ~1 h |
| **WP2.5a–e** | Furniture + islands per style (5 packages, one per style) | furn_<style>.py (B3, B4, B6 items, sockets, anims) + clutter.py share | WP2.0 | each other, 2.1–2.4 | `check_kit` AABB = KIT ±0.02; triangle budgets; contact sheets (front, 3/4, top); cloth has no intersections (visual check) | ~55 min each |
| **WP2.6** | Decals | decals.py → atlases + decals.json | WP2.0 | others | Atlas sheet; alpha coverage correct; normal sanity | ~0.7 h |
| **WP2.7** | Sky, env, glass, cookies, AO profiles | sky.py, env.py, glass.py, cookies.py (needs window nodes from WP2.2), ao_profiles.py | WP2.0 (cookies: WP2.2) | others | Panorama seam-free; cookie previews show mullions and curtains; AO curves monotonic | ~2 h |
| **WP2.8** | Lookdev reference | lookdev.py: Cycles renders of a fixed reference room (furnished, lamps, moon) + JSON of view parameters | WP2.1–2.7 | WP3, WP4 | Reference PNGs exist; used by WP6 | ~0.5 h |
| **WP2.9** | doll2 (P2, optional) | doll2.py, 2-primitive doll, keeps the `makeDoll` API | WP2.0 | any | features doll-scare test green | ~15 min |
| **WP3.1** | js/kit.js | loader, tiers, cache, eviction, `Kit.furnish`, instancing per chunk, placeholder boxes, `upgradeInPlace`, `kitReady` | WP1a, WP2.0 placeholders | WP3.2–3.7 | Unit page: furnish a synthetic plan; AABB = KIT; fallback boxes when the kit 404s | — |
| **WP3.2** | js/lightbake.js | C3/C4 baker (pure) + tests/bench-lightbake.mjs (node, synthetic F5) | WP1 (data shapes) | others | Node bench: F5 with 40 lamps hi ≤ 250 ms on this machine; determinism hash; ImageData output sizes | — |
| **WP3.3** | js/matlib.js | C5 patches (floor, ceil, wall, field, decal, emissive), D1 floor patch, POM | — | others | A test page compiles every family on low, medium and high without errors; programs counted | — |
| **WP3.4** | js/arch.js | walls (heights, gables, servant insets, uv0 variant trick, uv1 atlas allocation, skip predicate), ceilings + steps, trims with mitres, beams, doorway frames + leaves + `updateDoors`, module placement | WP1 | others | Synthetic grid: no gaps at height steps (edge-sharing check); mitre angles; leaf band ≤ 0.45 | — |
| **WP3.5** | js/dress.js | `Dress.plan` (doorway tiles, windows, modules, fixtures with `vh` states and flicker groups, band décor, rugs, identities, small-room types), pure | WP1 | others | Same `d` gives an identical plan hash; busy-face rules; no item on a puzzle, exit or wardrobe face | — |
| **WP3.6** | js/surface.js | D1–D6 overlays, wall decal meshes, dust prints | WP1 | others | Overlays built for 5 floors; no wet on note tiles; paths follow `bfsPath` | — |
| **WP3.7** | js/atmos.js | sky and glass materials, shafts, motes, bounce controller | WP1 | others | Shaft prism clipped at walls (2D test); motes inside the masks | — |
| **WP4.1** | Integration: level build | index.html order (E1); level.js `buildLevel` rewrite (E2), `disposeLevel` (E5), `makeWardrobe` and `makeExit` with the kit | WP1, WP3.1–3.7 (placeholders suffice) | — (sequential) | All existing suites green at low with the placeholder kit; F3.1-2 at low pass on placeholders | — |
| **WP4.2** | Integration: house.js fallback | `vh` lamp states, pool removal, `dens` out of placement, hanging-doll fix, prop depth fixes (B6), `busy` extensions, `kitCount` | WP4.1 | — | levels, features, extras green; light count constant | — |
| **WP4.3** | Integration: per frame | render.js (E3, C7, C8), world3d.js (`vh`, `aura` re-parent, hemisphere 0.16, far plane check) | WP4.2 | — | F4 light suite with placeholder profiles; no recompiles on `scares.dim` toggles (program count stable) | — |
| **WP4.4** | Integration: loading gates | main.js:40 preload, world3d.js Play gate, input.js gated `playFloor`/`tGo`/`retry`, multiplayer.js lobby Ready + upgrade-in-place path | WP4.3 | — | single, multiplayer, rejoin, lobby green; manual: throttled network (DevTools) still starts the floor with placeholders, then upgrades | — |
| **WP5.1** | tests/house3d.test.mjs | F3 | WP4.4 (+ real kits for the final run) | WP5.2 | Passes at low and medium | — |
| **WP5.2** | tests/light.test.mjs | F4 | WP4.4 | WP5.1 | Passes at medium | — |
| **WP5.3** | Render-side test updates | levels:92, lib.mjs `waitKit`/`QUALITY`, F5 leftovers | WP4.4 | WP5.1/2 | Full suite green | — |
| **WP6** | Real-kit swap, tuning, ship | `build_all.sh` hi/md/lo; calibration of `k` against WP2.8 lookdev (±25% mean luminance); densities; budgets at `GPU=1 HEADLESS=1`; phone check (lo); README section | all | — | `cd tests && node run.mjs` all green; F3 budgets at medium; GPU run High ≥ 60 fps on a mid-range desktop GPU at 1080p with spikes < 40 ms; screenshots reviewed per floor | full hi build ~16–17 h (cached) |

**Critical path:** WP0 → WP1a → WP1 → WP4.1 → WP4.2 → WP4.3 → WP4.4 → WP5 → WP6. The Blender lane (WP2.*) runs alongside from WP1a. WP3.* runs alongside from WP1's data freeze (end of WP1 week 1).

**Priority for bakes** (if time-boxed):
- P0: WP2.1, 2.2 (doors, windows, trims, exit), 2.3, 2.4, three islands and six solids per style, 2.6 wall decals, 2.7 sky and cookies.
- P1: the remaining furniture, fireplaces, holes, columns.
- P2: clutter variety, ceiling holes, doll2.

---

## 3. Hard rules (every package)

**Layout and collision**
- **H1.** The grid is the only source of walls. Rows stay '0'/'1'. Templates only open tiles.
- **H2.** Only connector tiles ((x+y) odd) are ever closed, each followed by a connectivity check. Never close an odd/odd tile; keep the border solid.
- **H3.** No hall, box, door-budget closure or alcove touches x ≤ 5 ∧ y ≤ 5 (x ≤ 4 ∧ y ≤ 4 for closures).
- **H4.** Every box obeys A8.2:
  - in a legal slot; within open tiles;
  - never on a non-island core or a protected tile; ≥ 26 u from other boxes;
  - accepted only if the cut graph stays connected;
  - island inset 3.33–11 u per side.
- **H5.** Anything that looks solid is solid, and anything solid is visible on every tier and before the kit loads. Non-solid décor reaches ≤ 0.44 m from its face and stays within u ∈ [0.05, 0.95]. Anything over walkable floor has its bottom at ≥ 2.30 m.
- **H6.** `los()` stays walls-only. `losSight` is used only at monster.js:81, stealth.js:77/84, render.js:121 and scares.js:24.
- **H7.** Gameplay data lives only in `d` (host, seeded). Every client derives cuts, nav, CEIL, doorway tiles, windows, lamps and the moon from `d` + `vh` with pure functions. Never use `Math.random`, quality, `LOWQ` or load state for anything placed, collidable, or feeding the light bake.
- **H8.** `generateFloor` passes `cut` explicitly to every helper and never reads the live `NAV`/`SOLIDS`/`CEIL`. `startFloor` stays synchronous.
- **H9.** Tests must never see `d.classic` or a non-empty `LAYOUT_REJECTS`.

**Contracts**
- **H10.** Keep these contracts:
  - wardrobe 1.15 × 2.25 × 0.6, hinges ±0.575 / z 0.305, `c.doors[{pivot, leaf, side, open}]`, hollow interior;
  - `level.door{door, lamp, lockedMat, openMat, open}` (+ `setOpen`);
  - boards as direct children of `level.group` named `BoardShort`/`BoardLong`;
  - `house.dolls {obj, head, ry, target, headWorld}` with `obj` at the group origin;
  - `level.paintings`; `closets[].doors`.
- **H11.** Doorways keep the full 2.03 m opening. Leaves rest at 72–88° and never enter the walkway. A tile with a side board pins that leaf at 90°; a tile with a long board gets no leaves.

**Lights and shaders**
- **H12.** Fixed light set: hemisphere, flash, aura, exitLight, teammate spots. No per-level lights. GLBs are exported with `export_lights=False`, and the loader strips any light.
- **H13.** Per-frame lighting changes are uniforms only: no `material.needsUpdate` or define changes during play.
- **H14.** Data textures are `CanvasTexture(new ImageData(...))` with `flipY=true`, row 0 = grid row 0, plan uv = (x/W, 1 − z/H). Never use a 2D canvas with alpha < 255 for data.
- **H15.** `aoMap` affects only indirect light. Contact shadowing visible under the flashlight goes into albedo (asset cavity), wall aux B, or `ovAlbedo`.

**Blender pipeline**
- **H16.** Cycles only (`use_best_device`), never EEVEE or Workbench. `read_factory_settings(use_empty=True)`; metres; Z up; front −Y.
- **H17.** Data bakes (AO, normal, roughness, height, profiles, cookies) use float buffers, EXR, `view_transform='Standard'`. Denoise through the compositor recipe, then convert to WebP with Pillow. Colour renders may use AgX.
- **H18.** Node names are unique, without dots, with ≤ 2 materials per node, using the B1 scheme. `export_vertex_color='NONE'`. Plain Principled materials only.
- **H19.** Every asset passes `check_kit.py` before packing. KIT footprints are edited only in js/kitdefs.js (`version` bumps on any footprint change).
- **H20.** `compress-glb.mjs` runs from `/tmp/claude-0/gltft`. Positions are never quantised.

**Disposal, culling, budgets**
- **H21.** Clones of loaded templates carry `userData.shared` (and `sharedGeo` for meshes inside the house group). Level-owned textures go in `material.userData.disposables`.
- **H22.** Heavy merges and instances are chunked per 6×6 tiles. Budgets in E6 and B12 are asserted by tests.

**Process**
- **H23.** No repository edits outside a package's file ownership. Packages that edit the same JS file run in sequence. Run the full suite (`cd tests && node run.mjs`) after every integration package.
- **H24.** Every new feature runs on Low (the test tier). Quality changes resolution, level of detail and optional effects only.
- **H25.** Never reference `THREE.InstancedBufferAttribute`, `TextureLoader`, `DataTexture` or `ClampToEdgeWrapping`. Use `mesh.instanceMatrix.constructor`, Image → CanvasTexture, ImageData, and 1001.
- **H26.** Keep the old texture files, `surfaceSet` and the canvas painters for the title scene (world3d.js:78-101) and the lobby (lobby3d.js:19-21).
- **H27.** Commits end with the session's Co-Authored-By / Claude-Session lines. Commit only when the orchestrator asks.