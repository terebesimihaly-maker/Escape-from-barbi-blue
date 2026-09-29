# Escape from Barbi Blue

A first-person 3D horror maze for phones and desktop. Find the fuses, unlock the door, and don't let her catch you.

- `index.html`: the game (three.js renderer, with all the game logic and synthesized audio in one file)
- `models/barbi.glb`: her rigged model (made in Blender)
- `js/barbi-anim.js`: her animations. The model has no animation clips, so they're built in code from the rig's bones:
  `idle`, `walk` (limping), `search`, `run`, `chase` (arms reaching), `scream`, `lunge` (the kill), `peek` (outside your wardrobe)
- `animations.html`: preview each animation (drag to orbit)
- `lib/three.min.js`: three.js r186 + GLTFLoader (MIT, see `lib/THREE-LICENSE.txt`)

The game loads its files over HTTP, so open it from a web server (e.g. GitHub Pages, or `python3 -m http.server` locally), not by double-clicking the file.

Controls: left side of the screen, drag to walk. Right side, drag to look. RUN, HIDE, and PHONE buttons.
Keyboard: WASD, mouse drag or arrow keys to look, Shift to run, E to hide.
