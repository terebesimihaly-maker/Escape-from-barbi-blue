# Escape from Barbi Blue

A first-person 3D horror maze for phones and desktop. Find the fuses, unlock the door, and don't let her catch you.

- `index.html`: the game (three.js renderer, with all the game logic and synthesized audio in one file)
- `models/barbi.glb`: her rigged model (made in Blender)
- `js/barbi-anim.js`: her animations. The model has no animation clips, so they're built in code from the rig's bones.
  Her walking, stalking, idle and running are real human motion capture (see below) with her own touches on top: the
  O-shaped legs, the head snapping sideways, the reaching arms. `scream`, `lunge` (the kill), `peek` and `lean` (the wardrobe scene) are hand-made.
- `models/mocap.json`: the motion capture, already retargeted onto her rig (made with `tools/retarget-mocap.mjs`)
- `audio/chase.mp3`: her chase song. It's faint when she's far away, gets louder as she gets closer, and plays at full volume when she catches you (a different song can be picked on the title screen)
- `js/player-model.js`: teammates in multiplayer: human figures made from the same rig (clothes, hair and skin tone differ per player), animated with motion capture (idle, walk, jog, run), plus a downed pose, a working flashlight in the hand and a nametag
- `js/house.js`: dresses each floor: skirting, rails and crown molding, framed doorways, lamps that really light the rooms (a few flicker or are dead), rugs and a runner carpet, porcelain dolls whose heads turn when you look away, teddy bears, side tables, grandfather clocks, basement pipes, crates, barrels and puddles, and a flashlight beam you can see in the air
- `animations.html`: preview each animation (drag to orbit)
- `lib/three.min.js`: three.js r186 + GLTFLoader + post-processing (MIT, see `lib/THREE-LICENSE.txt`)
- `lib/peerjs.min.js`: PeerJS 1.5.5 for multiplayer (MIT, see `lib/PEERJS-LICENSE.txt`)

The game loads its files over HTTP, so open it from a web server (e.g. GitHub Pages, or `python3 -m http.server` locally), not by double-clicking the file.

Controls: left side of the screen, drag to walk. Right side, drag to look. RUN, HIDE, and PHONE buttons.
Computer: click to lock the cursor, then WASD to move and the mouse to look. Shift runs, E hides, 1 uses the phone, Esc frees the cursor and pauses.

## Playing together (up to 4)

Menu → **Play together** → **Create lobby** shows a 6 digit code; the others enter it and press **Join**. Everyone picks a nametag and presses **Ready**; the game starts when everyone is ready. The lobby owner can kick players.

- Everyone starts in the same room, in the same house. Teammates are solid (no walking through each other).
- It's a bit harder together, but fair: she hears a little further and is a little faster (never faster than a sprinting player), she screams a bit more often, and there's one more fuse (and wardrobe) per extra player. She gives the group a few extra seconds at the start, and after catching someone she walks away so the others can revive them.
- One person per wardrobe: if someone is already inside, it's locked.
- If she catches someone they go down. Stand next to them and hold **E** (or **REVIVE**) for 3 seconds within 50 seconds; the arrow in the top right corner shows where they are. If nobody reaches them in time they're out until the next floor. If everyone is down, it's game over and everyone goes back to the lobby.
- How it works: peer to peer (WebRTC). The lobby owner's browser runs the game, so they should keep the game open. PeerJS's free public server (0.peerjs.com) only introduces the players. Some strict networks (certain mobile carriers or company Wi-Fi) block direct connections; if joining fails there, try another network.
- For local testing with your own PeerJS server: `index.html?peer=127.0.0.1:9000`.

## Motion capture

The human motion comes from the CMU Graphics Lab Motion Capture Database. The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

Takes used: 77_05 (standing, player idle), 16_15 (walk), 16_35 (jog), 09_02 (run), 77_02 (her idle), 104_41 (zombie-like walk: her wandering), 77_29 (creeping: her search), and 77_19 (a limp, retargeted but not used in the game yet). To rebuild `models/mocap.json`: `npm i three && node tools/retarget-mocap.mjs` (it downloads the BVH files into `tools/.mocap-cache/`).
