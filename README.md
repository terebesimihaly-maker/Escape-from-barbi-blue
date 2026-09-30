# Escape from Barbi Blue

A first-person 3D horror maze for phones and desktop. Solve the labyrinth boxes, unlock the door, and don't let her catch you.

- `index.html`: the page (menus, HUD); `css/style.css`: its styles
- The game, in plain scripts that share one scope (loaded in this order by `index.html`, no build step):
  - `js/core.js`: setup, settings, the floors' content, the maze
  - `js/audio.js`: every sound effect (synthesized) and her chase song
  - `js/floors.js`: game state, generating and starting a floor
  - `js/multiplayer.js`: the lobby and the shared game (PeerJS)
  - `js/input.js`: touch, mouse and keyboard, and the screens
  - `js/game.js`: the game loop, the player, the wardrobe scene
  - `js/monster.js`: her AI (see "Her" below)
  - `js/world3d.js`, `js/level.js`, `js/render.js`: the 3D world, building a floor, drawing a frame
  - `js/scares.js`: the jump scares
  - `js/puzzles.js`: the labyrinth boxes (the puzzles)
  - `js/cinematics.js`: the death screen and the title screen; `js/main.js`: the main loop and start-up
- `js/house.js`: dresses each floor: skirting, rails and crown molding, framed doorways, lamps that really light the rooms (a few flicker or are dead), rugs and a runner carpet, porcelain dolls whose heads turn when you look away, teddy bears, side tables, grandfather clocks, basement pipes, crates, barrels and puddles, the attic's sheet-covered furniture, trunks and cobwebs, the workshop's workbenches, shelves of doll heads, dress forms and dolls hanging on strings, and a flashlight beam you can see in the air
- `models/barbi.glb`: her rigged model (made in Blender)
- `js/barbi-anim.js`: her animations. The model has no animation clips, so they're built in code from the rig's bones.
  Standing, wandering and searching are real human motion capture (see below) with her own touches on top (the O-shaped legs,
  the head snapping sideways). Her sprint is hand-made so she doesn't run like a person: a lurching, uneven stride, bent low,
  head held level and tilted, head and arms moving in stop-motion jerks. `scream`, `lunge` (the kill), `peek` and `lean` are hand-made too.
- `models/mocap.json`: the motion capture, already retargeted onto her rig (made with `tools/retarget-mocap.mjs`)
- `audio/chase.mp3`: her chase song. It's faint when she's far away, gets louder as she gets closer, and plays at full volume when she catches you (a different song can be picked on the title screen)
- `js/player-model.js`: teammates in multiplayer: human figures made from the same rig (clothes, hair and skin tone differ per player), animated with motion capture (idle, walk, jog, run), plus a downed pose, a working flashlight in the hand and a nametag
- `animations.html`: preview each animation (drag to orbit)
- `tests/`: browser tests (see "Tests" below)
- `lib/three.min.js`: three.js r186 + GLTFLoader + post-processing (MIT, see `lib/THREE-LICENSE.txt`)
- `lib/peerjs.min.js`: PeerJS 1.5.5 for multiplayer (MIT, see `lib/PEERJS-LICENSE.txt`)

## Floors and difficulty

**Enter the house** shows the five floors: The Nursery, The Doll Hallway, The Basement, The Attic and The Workshop. A floor opens once you've escaped the one before it (your progress and best time per floor are kept on this device). Pick **Easy**, **Medium** or **Hard** above the list:

- Easy: she's slower, hears and sees less, rarely opens wardrobes; one labyrinth box less, smaller mazes; the phone recharges in 35 s; 65 s to revive a teammate
- Medium: the house as it was meant to be played (45 s phone, 50 s to revive)
- Hard: she's faster (a sprint still gets away from her), hears and sees further, opens wardrobes more often, screams more; bigger mazes with more holes; 60 s phone; 40 s to revive

Playing together, the lobby owner picks the floor (from the ones they've opened) and the difficulty for everyone; escaping a floor together opens the next one for all of you.

The game loads its files over HTTP, so open it from a web server (e.g. GitHub Pages, or `python3 -m http.server` locally), not by double-clicking the file.

Controls: left side of the screen, drag to walk. Right side, drag to look. RUN, HIDE, and PHONE buttons.
Computer: click to lock the cursor, then WASD to move and the mouse to look. Shift runs, E hides, 1 uses the phone, Esc frees the cursor and pauses.

## The labyrinth boxes

Instead of fuses, every floor has wooden labyrinth boxes on its walls (1 to 4, more on later floors), like the tilting ball maze game. Walk up and press **USE** (or E): tilt the board to roll the steel ball into the gold hole. Point the mouse where the ball should roll (or use the arrow keys / WASD); on a phone drag your finger, or tap "Tilt your phone". A ball falling into a hole is loud, and she hears it, and the game doesn't stop while you play. Later floors and Hard have bigger mazes with more holes and a faster ball; Easy has one box less, smaller mazes and a slower ball. Playing together, a box one of you solves is solved for everyone. Stuck? When one box is left, or none has been solved for a minute, an arrow points to the nearest.

## Her

- She wanders slowly, listening. Walking she hears close by; sprinting she hears from far away. When she sees you, she runs at you.
- If she only hears you, she runs to where you're *going*, to cut you off.
- When she loses you she first goes the way you were heading, then checks the wardrobes near where she lost you: she stops at the doors and listens, and sometimes opens them. Hide further away. Now and then she stops completely and listens (she hears further then).

## Sound

Wear headphones: sounds come from where they happen. You hear her footsteps (heavy, bare, the dragging foot scraping) from her direction, muffled behind walls; the music box and her song come from her side. Your own steps sound different on each floor (creaky boards, tiles, wet concrete), and you hear your teammates walking.

## Settings

Look sensitivity, volume, field of view, invert looking up and down, graphics quality, her song, and **Calm effects**: no strobing, no screen shake, gentler flicker (for anyone sensitive to flashing).

## Jump scares

Every 35 to 60 seconds or so, never while she's after you: a doll that isn't where it was, her face at the end of a corridor, footsteps on the ceiling, every light dying (and her standing right in front of you when they come back), her sprinting across a junction ahead, breathing right behind you, a wardrobe door opening by itself.

## Playing together (up to 4)

Menu → **Play together** → **Create lobby** shows a 6 digit code; the others enter it and press **Join**. Everyone picks a nametag and presses **Ready**; the game starts when everyone is ready. The lobby owner can kick players.

- Everyone starts in the same room, in the same house. Teammates are solid (no walking through each other).
- It's a bit harder together, but fair: she hears a little further and is a little faster (never faster than a sprinting player), she screams a bit more often, and there's one more wardrobe per extra player. She gives the group a few extra seconds at the start, and after catching someone she walks away so the others can revive them.
- One person per wardrobe: if someone is already inside, it's locked.
- Lost the connection (weak Wi-Fi, a locked phone)? Your place is kept for 90 seconds and the game reconnects by itself. Closed the page by accident? The menu shows **Rejoin game** for 10 minutes: you come back on the same floor, where you were, with the labyrinth boxes already solved. (If the lobby owner closes their page, the game ends: it runs in their browser.)
- If she catches someone they go down. Stand next to them and hold **E** (or **REVIVE**) for 3 seconds within 50 seconds; the arrow in the top right corner shows where they are. If nobody reaches them in time they're out until the next floor. If everyone is down, it's game over and everyone goes back to the lobby.
- How it works: peer to peer (WebRTC). The lobby owner's browser runs the game, so they should keep the game open. PeerJS's free public server (0.peerjs.com) only introduces the players. Some strict networks (certain mobile carriers or company Wi-Fi) block direct connections; if joining fails there, try another network.
- For local testing with your own PeerJS server: `index.html?peer=127.0.0.1:9000`.

## Motion capture

The human motion comes from the CMU Graphics Lab Motion Capture Database. The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

Takes used: 77_05 (standing, player idle), 16_15 (walk), 16_35 (jog), 09_02 (run), 77_02 (her idle), 104_41 (zombie-like walk: her wandering), 77_29 (creeping: her search), and 77_19 (a limp, retargeted but not used in the game yet). To rebuild `models/mocap.json`: `npm i three && node tools/retarget-mocap.mjs` (it downloads the BVH files into `tools/.mocap-cache/`).

## Tests

Browser tests with Playwright: single player, multiplayer (4 browsers and a local PeerJS server), and her AI, sprint and the scares.

    cd tests && npm install && npm test          # or: node run.mjs features   (only the suites with "features" in the name)

`CHROME=/path/to/chrome` picks the browser. Screenshots go to `tests/out/`. `tests/server.mjs` serves the game with test hooks (`tests/hooks.js`) at `/game.html`; the real game never loads them.

