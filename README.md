# Escape from Barbi Blue

A first-person 3D horror maze for phones and desktop. Solve the puzzles, unlock the door, and don't let her catch you.

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
  - `js/puzzles.js`: the puzzles (a different kind on every floor)
  - `js/stealth.js`: holding your breath, loose floorboards, fear
  - `js/team.js`: pings, emotes, watching and warning from beyond (playing together)
  - `js/extras.js`: achievements, the torn notes you've collected, the performance overlay
  - `js/account.js`: signing in (or playing as a guest), and your profile: the character creator with a 3D preview
  - `js/cinematics.js`: the death screen and the title screen; `js/main.js`: the main loop and start-up
- `js/house.js`: dresses each floor: skirting, rails and crown molding, framed doorways, lamps that really light the rooms (a few flicker or are dead), rugs and a runner carpet, porcelain dolls whose heads turn when you look away, teddy bears, side tables, grandfather clocks, basement pipes, crates, barrels and puddles, the attic's sheet-covered furniture, trunks and cobwebs, the workshop's workbenches, shelves of doll heads, dress forms and dolls hanging on strings, and a flashlight beam you can see in the air
- `models/character_mobile.glb`: her rigged model (made in Blender)
- `models/barbi.glb`: the earlier version of her model, with the same skeleton; teammates in multiplayer are made from it (only downloaded when you play together)
- `js/barbi-anim.js`: her animations. The model has no animation clips, so they're built in code from the rig's bones.
  Standing, wandering and searching are real human motion capture (see below) with her own touches on top (the O-shaped legs,
  the head snapping sideways). Her sprint is hand-made so she doesn't run like a person: a lurching, uneven stride, bent low,
  head held level and tilted, head and arms moving in stop-motion jerks. `scream`, `lunge` (the kill), `peek` and `lean` are hand-made too.
- `models/mocap.json`: the motion capture, already retargeted onto her rig (made with `tools/retarget-mocap.mjs`)
- `audio/chase.mp3`: her chase song. It's faint when she's far away, gets louder as she gets closer, and plays at full volume when she catches you (a different song can be picked on the title screen)
- `js/player-model.js`: teammates in multiplayer: human figures made from the same rig, animated with motion capture (idle, walk, jog, run) and hand-made dances, plus a downed pose, a working flashlight in the hand and a nametag. Everyone looks the way they made themselves in their profile (see "Accounts and your character"): clothes, hair, skin, eyes, beard, glasses, build and height, on a face made from a seed (so everyone sees the same person): the head reshaped (jaw, chin, nose, cheeks, eyes, mouth, brow, face length) and the face painted (eyebrows, mouth, eyeliner, freckles, blush, a mole, age lines). Anyone without a profile gets a random one from their player id
- `animations.html`: preview each animation (drag to orbit)
- `supabase/migrations/`: the account server's database (see "Accounts and your character")
- `tests/`: browser tests (see "Tests" below)
- `lib/three.min.js`: three.js r186 + GLTFLoader + post-processing (MIT, see `lib/THREE-LICENSE.txt`)
- `lib/peerjs.min.js`: PeerJS 1.5.5 for multiplayer (MIT, see `lib/PEERJS-LICENSE.txt`)

## Floors and difficulty

**Enter the house** shows the five floors: The Nursery, The Doll Hallway, The Basement, The Attic and The Workshop. A floor opens once you've escaped the one before it (your progress and best time per floor are kept on this device). Pick **Easy**, **Medium** or **Hard** above the list:

- Easy: she's slower, hears and sees less, rarely opens wardrobes, rarely pretends to leave; one puzzle less, smaller boards; fewer loose boards; you can hold your breath for 9 s; the phone recharges in 35 s
- Medium: the house as it was meant to be played (45 s phone, 7 s breath)
- Hard: she's faster (a sprint still gets away from her), hears and sees further, opens wardrobes more often, screams more, often pretends to leave; bigger boards, more holes, longer melodies; more loose boards; 6 s breath; 60 s phone

On every difficulty a downed teammate has 90 seconds (1:30) to be revived.

Playing together, the lobby owner picks the floor (from the ones they've opened) and the difficulty for everyone; escaping a floor together opens the next one for all of you.

The game loads its files over HTTP, so open it from a web server (e.g. GitHub Pages, or `python3 -m http.server` locally), not by double-clicking the file.

Controls: left side of the screen, drag to walk. Right side, drag to look. RUN, HIDE, and PHONE buttons; in a wardrobe, hold BREATH; playing together, 📍 pings and 💬 sends a quick message.
Computer: click to lock the cursor, then WASD to move and the mouse to look. Shift or Ctrl runs, E hides, 1 uses the phone, Space (in a wardrobe) holds your breath, Q pings, 2 to 7 send quick messages, F3 shows the performance overlay, Esc frees the cursor and pauses.

Torn notes: every floor has four, and three of them lie somewhere on it (which three, and where, changes every game). The HUD shows this floor's (📜 1/3); every note you read counts once, forever: the floor list shows how many of all 20 you've found.

## The puzzles

Instead of fuses, every floor has wooden puzzle boxes on its walls (3 to 5; one less on Easy), and every floor has its own kind. Walk up and press **USE** (or E):

1. **The Nursery: the labyrinth.** Tilt the board to roll the ball into the gold hole: point the mouse where it should roll (or arrow keys / WASD); on a phone drag your finger, or tap "Tilt your phone". A ball in a hole is loud: she hears it.
2. **The Doll Hallway: the portrait.** A sliding-tile puzzle: slide the pieces back to put the doll's portrait together (numbered on Easy; 4x4 on Hard).
3. **The Basement: the pipes.** Turn the pipes until the water runs from the valve to the drain.
4. **The Attic: the music box.** It plays a melody on four keys; play it back, one note longer each time. A wrong note is loud.
5. **The Workshop: her face.** Turn the rings until her face lines up; turning a ring also turns the next one out.

The game doesn't stop while you play: she can come. Close a puzzle half done (to run, or to hide) and it stays exactly as you left it; the box on the wall shows how far you got, and you carry on when you open it again (the music box plays the melody up to your round again). Each player keeps their own progress. Later floors and Hard have bigger boards, more holes, longer melodies and more rings. Playing together, a box one of you solves is solved for everyone. Stuck? When one box is left, or none has been solved for a minute, an arrow points to the nearest.

## Her

- She wanders slowly, listening. Walking she hears close by; sprinting she hears from far away. When she sees you, she runs at you.
- If she only hears you, she runs to where you're *going*, to cut you off.
- When she loses you she first goes the way you were heading, then checks the wardrobes near where she lost you: she stops at the doors and listens, and sometimes opens them. Hide further away. Now and then she stops completely and listens (she hears further then).
- **Hold your breath.** In a wardrobe, hold Space (or BREATH) and she can't hear you. When she stops at your doors, holding it keeps you almost always safe; breathing, she can hear you (and if she walks past close by for a couple of seconds, she comes to open that one). Hold it too long and you gasp for air: if she's near, she knows exactly which wardrobe you're in.
- **She pretends to leave.** Giving up the search with someone hiding nearby, she sometimes walks off, her footsteps and song fading as if she's far away, and waits, silent, around a corner 3 to 5 tiles from the wardrobe. Come out too soon and she's right there. Stay put and she really leaves.
- **Crouching** (Ctrl, or CROUCH on a phone): slower, but completely silent. She can't hear your steps, and loose floorboards don't creak under you. Run with Shift (or RUN).
- **Loose floorboards.** Old warped boards, lifted and cracked, rusty nails sticking up. Step on one and it creaks loudly: she hears it from rooms away (further if you were running). About nine in ten lie against one side of a corridor or room, with plenty of room to step around them; now and then a long one lies right across a corridor from wall to wall, and there's no way round it: crouch over it.
- **Fear.** The bar at the top. It rises while she's close (that you know of), chasing you, or something scares you, and slowly falls when you're safe. Very afraid, the picture loses its colour and sways, your hands shake (the view drifts and you don't quite walk straight), and you hear things that aren't there: her footsteps behind you, a whisper, the music box, the flashlight dying. (Calm effects: no swaying.)

## Sound

Wear headphones: sounds come from where they happen. You hear her footsteps (heavy, bare, the dragging foot scraping) from her direction, muffled behind walls; the music box and her song come from her side. Your own steps sound different on each floor (creaky boards, tiles, wet concrete), and you hear your teammates walking.

## Accounts and your character

The first thing the game shows is **Sign in** / **Create account**, with **Play as a guest** below it.

- An account is a username (3 to 16 letters, numbers or _) and a password (at least 6 characters). There's no email address, so a forgotten password can't be reset.
- **Your profile**: click your name in the top right corner of the menu. Your character in 3D (drag to turn it round) and everything about it: shirt, trousers and shoes (a colour from the row, or any colour you like), hair (short or long, and its colour), skin, eyes, beard, glasses, freckles, make-up, build and height. **New face** gives a different face and keeps the rest; **Randomize** changes everything.
- Signed in, your character is saved to your account, so it's the same on any device, and the game signs you in by itself next time (for 90 days). As a guest it's kept on this device only; create an account later and it comes with you.
- Playing together, everyone sees everyone else's character.
- The server is a Supabase project (EFBB), set up by `supabase/migrations/`. The game only calls five database functions (sign up, sign in, who am I, save my character, sign out) with the project's public key; the tables are in a schema the API doesn't expose. Passwords are stored only as bcrypt hashes. Signing in gives the device a random session token (only its SHA-256 is stored on the server). 8 wrong passwords in a row lock an account for 10 minutes, and one address can create at most 10 accounts an hour.

## Settings

Look sensitivity, volume, field of view, invert looking up and down, graphics quality, her song, **Calm effects**: no strobing, no screen shake, gentler flicker, no swaying when afraid (for anyone sensitive to flashing or motion), and **Show performance** (also F3): frames per second, frame time, resolution, draw calls, and playing together your ping (the lobby owner sees everyone's).

## Achievements

18 of them, kept on this device (Menu → Achievements): escape the first floor and the last; escape on Hard, and every floor on Hard; a floor in under 3 minutes; without hiding; without her ever chasing you; without stepping on a loose board; without your fear going over half; lose her in a chase; hold your breath while she listens at your doors; stay hidden when she pretends to leave; make her leave with a text; find 10 notes, and all 20; revive a teammate; escape together with nobody lost; warn your team from beyond.

## Jump scares

Every 35 to 60 seconds or so, never while she's after you: a doll that isn't where it was, her face at the end of a corridor, footsteps on the ceiling, every light dying (and her standing right in front of you when they come back), her sprinting across a junction ahead, breathing right behind you, a wardrobe door opening by itself.

The paintings: some portraits have real glass eyes that turn to follow you. Others change: look at one, look away, and when you look back it isn't the same picture any more.

## Playing together (up to 4)

Menu → **Play together** → **Create lobby** shows a 6 digit code; the others enter it and press **Join**. Everyone picks a nametag and presses **Ready**; the game starts when everyone is ready. The lobby owner can kick players.

- Everyone starts in the same room, in the same house. Teammates are solid (no walking through each other).
- It's a bit harder together, but fair: she hears a little further and is a little faster (never faster than a sprinting player), she screams a bit more often, and there's one more wardrobe per extra player. She gives the group a few extra seconds at the start, and after catching someone she walks away so the others can revive them.
- One person per wardrobe: if someone is already inside, it's locked.
- Lost the connection (weak Wi-Fi, a locked phone)? Your place is kept for 90 seconds and the game reconnects by itself. Closed the page by accident? The menu shows **Rejoin game** for 10 minutes: you come back on the same floor, where you were, with the puzzles already solved. (If the lobby owner closes their page, the game ends: it runs in their browser.)
- If she catches someone they go down. Stand next to them and hold **E** (or **REVIVE**) for 3 seconds within 90 seconds; the arrow in the top right corner shows where they are. If nobody reaches them in time they're out until the next floor. If everyone is down, it's game over and everyone goes back to the lobby.
- **Pings and dances.** Q (or 📍) marks what you're looking at for everyone, for 8 seconds: "She's here!" when you look at her, "Puzzle" at a puzzle box, otherwise "Here". Off the screen, a marker sits at the edge pointing the way. Hold R (or tap 💃) for the dance wheel: Floss, Robot, Disco, Chicken, Wave, Twist, Air guitar, Hype. Point at one with the mouse and let go: your figure dances for everyone and your camera pulls back to show you. Moving stops it. (Every key can be changed in Settings → Controls.)
- **Out of the game** you watch the others (click or tap, or ← →, to switch; the camera glides after them) and once every 30 seconds you can warn them (G or WARN): everyone sees a marker where she is right now.
- How it works: peer to peer (WebRTC). The lobby owner's browser runs the game, so they should keep the game open. PeerJS's free public server (0.peerjs.com) only introduces the players. Some strict networks (certain mobile carriers or company Wi-Fi) block direct connections; if joining fails there, try another network.
- For local testing with your own PeerJS server: `index.html?peer=127.0.0.1:9000`.

## Motion capture

The human motion comes from the CMU Graphics Lab Motion Capture Database. The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

Takes used: 77_05 (standing, player idle), 16_15 (walk), 16_35 (jog), 09_02 (run), 77_02 (her idle), 104_41 (zombie-like walk: her wandering), 77_29 (creeping: her search), and 77_19 (a limp, retargeted but not used in the game yet). To rebuild `models/mocap.json`: `npm i three && node tools/retarget-mocap.mjs` (it downloads the BVH files into `tools/.mocap-cache/`).

## Tests

Browser tests with Playwright: single player, multiplayer (4 browsers and a local PeerJS server), her AI, sprint and the scares, the floors and puzzles, rejoining, the stealth features, fear, paintings and achievements (`extras`), pings, dances and spectating (`team`), and accounts and the character creator (`account`, against a stand-in for the account server in `tests/server.mjs`, so the tests never touch the real one).

    cd tests && npm install && npm test          # or: node run.mjs features   (only the suites with "features" in the name)

`CHROME=/path/to/chrome` picks the browser. By default the 3D is drawn in software (slow, but works on any machine, including servers without a graphics card). On your own computer, `GPU=1` uses your installed Chrome (or Edge) and your graphics card, in visible windows; add `HEADLESS=1` to hide them. On Windows (PowerShell):

    cd tests; npm install; $env:GPU=1; npm test

Screenshots go to `tests/out/`. `tests/server.mjs` serves the game with test hooks (`tests/hooks.js`) at `/game.html`; the real game never loads them.

