/* Escape from Barbi Blue: the lobby, like Dead by Daylight: everyone's character stands side by side in a dim room lit by a
   lantern, as they made themselves (js/account.js), with their nametag (and "ready"). Dance from the lobby's dance bar,
   and talk in the chat (only in the chat box: nothing over anyone's head).
   Chat and dances go through the lobby's owner like everything else (js/multiplayer.js), cleaned and rate limited there.
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

const LOB = { scene: null, cam: null, figs: new Map(), dance: new Map(), lamp: null, throwL: null, t: 0, acc: 1, slow: 0, drew: false, stage: null, prep: 0, roomReady: false };
const CHAT_MAX = 120, CHAT_KEEP = 40;
const cleanChat = t => String(t || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);

function lobbyScene() {
  if (LOB.scene) return;
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x040509); sc.fog = new THREE.Fog(0x040509, 5, 12);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: 0x3a281c, roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 3), new THREE.MeshLambertMaterial({ color: 0x5a3848 })); wall.position.set(0, 1.5, -2.2); sc.add(wall);
  // (the house's own floor and wallpaper, baked in Blender, when they load)
  surfaceSet(['floor_wood1', 'floor_wood']).then(s => { if (!s) return; const m = floor.material; m.map = s.map.clone(); m.map.repeat.set(6, 6); m.normalMap = s.normalMap.clone(); m.normalMap.repeat.set(6, 6);
    m.map.needsUpdate = m.normalMap.needsUpdate = true; m.color.setScalar(1.3); m.needsUpdate = true; });
  surfaceSet(['wall_paper1', 'wall_paper']).then(s => { if (!s) return; const m = wall.material; m.map = s.map.clone(); m.map.repeat.set(14 / TILE_M, 1); m.map.needsUpdate = true; m.color.setScalar(1.1); m.needsUpdate = true; });
  // a lantern on the floor in front of them, flickering
  const lantern = new THREE.Group(); lantern.position.set(0, 0, 1.1);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: 0xffa050, emissiveIntensity: 2.2 }));
  glass.position.y = 0.12; lantern.add(glass);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.4 })); cap.position.y = 0.245; lantern.add(cap);
  // (the lantern's glow; its shadows come from one spotlight thrown up onto the wall behind them: a point light's shadows would
  // draw every character six more times a frame)
  const light = new THREE.PointLight(0xffa860, 7, 7, 1.6); light.position.y = 0.3; lantern.add(light); sc.add(lantern);
  const throwL = new THREE.SpotLight(0xffa860, 5, 9, 1.0, 0.7, 1.4); throwL.position.set(0, 0.3, 1.1); throwL.target.position.set(0, 1.2, -2.2);
  throwL.castShadow = settings.quality !== 'low'; throwL.shadow.mapSize.set(1024, 1024); throwL.shadow.bias = -0.0005; throwL.shadow.radius = 3; sc.add(throwL, throwL.target);
  sc.add(new THREE.HemisphereLight(0x4a5a90, 0x100808, 0.5));
  const key = new THREE.DirectionalLight(0x8fa0ff, 0.7); key.position.set(-2, 3, 4); sc.add(key);
  const cam = new THREE.PerspectiveCamera(36, 1, 0.05, 30); cam.position.set(0, 1.35, 4.6); cam.lookAt(0, 1.0, 0);
  Object.assign(LOB, { scene: sc, stage: new THREE.Scene(), cam, lamp: light, throwL }); prepLobby();
}
// where each of the (up to) four stands: side by side, the owner in the middle left
const LOBBY_SPOTS = [[-0.45, 0], [0.45, 0], [-1.35, -0.25], [1.35, -0.25]];
function syncLobbyFigures() {
  const L = MP.lobby, seen = new Set(); let added = false;
  L.players.forEach((pl, i) => {
    const key = (pl.look ? JSON.stringify(pl.look) : pl.id) + '|' + i;
    let f = LOB.figs.get(pl.id);
    if (!f || f.key !== key) {
      if (f) { f.av.obj.removeFromParent(); f.av.dispose(); }
      const av = PlayerModel.createHuman(THREE, { slot: i, name: pl.name, template: playerTemplate, mocap: mocapData, face: pl.id, look: pl.look || (pl.id === MP.myId ? myLook() : null) });
      const [x, z] = LOBBY_SPOTS[i % 4]; av.obj.position.set(x, 0, z); av.obj.rotation.y = -x * 0.18;
      LOB.stage.add(av.obj); f = { av, key, i }; LOB.figs.set(pl.id, f); added = true;
    }
    seen.add(pl.id); f.av.setName(pl.name + (pl.ready ? '  ✓' : ''), false);
  });
  for (const [id, f] of LOB.figs) if (!seen.has(id)) { f.av.obj.removeFromParent(); f.av.dispose(); LOB.figs.delete(id); }
  return added;
}
// a new character waits off stage while its shaders build in the background, then steps in: compiling them in the middle of
// a frame can hold a slow device for seconds, and with it the connection (someone joining would wait)
function prepLobby() {
  const n = ++LOB.prep, come = () => { if (n !== LOB.prep) return; LOB.roomReady = true; while (LOB.stage.children.length) LOB.scene.add(LOB.stage.children[0]); };
  if (!renderer.compileAsync) { come(); return; }
  const room = LOB.roomReady ? Promise.resolve() : renderer.compileAsync(LOB.scene, LOB.cam);
  room.then(() => renderer.compileAsync(LOB.stage, LOB.cam, LOB.scene)).catch(() => {}).then(come); setTimeout(come, 10000);   // (never wait for ever)
}
function renderLobby3D(dt) {
  if (!renderer || !playerTemplate || !MP.lobby) { renderTitle(dt); return; }
  // (a lobby only needs 30 frames a second: the rest of the time goes to the connection and the page. On a device that can't
  // keep up, below about 8 a second, it draws twice a second instead: they're mostly standing still, and joining stays quick)
  if (LOB.drew) { LOB.slow += (realDt - LOB.slow) * 0.25; LOB.drew = false; }   // (how long the last drawn frame took)
  LOB.acc += realDt; if (LOB.acc < (LOB.slow > 0.12 ? 0.5 : 1 / 31)) return;
  dt = Math.min(0.1, LOB.acc); LOB.acc = 0; LOB.drew = true;
  lobbyScene();
  // (shadows or not change which shaders everything needs: decide before anything is built, and build again if it changes)
  const sh = settings.quality !== 'low'; if (LOB.throwL.castShadow !== sh) { LOB.throwL.castShadow = sh; LOB.roomReady = false; for (const f of LOB.figs.values()) LOB.stage.add(f.av.obj); prepLobby(); }
  if (syncLobbyFigures()) prepLobby(); LOB.t += dt;
  if (!LOB.roomReady) { renderTitle(dt); return; }   // (the old backdrop while the room's shaders build)
  const now = performance.now();
  for (const [id, f] of LOB.figs) {
    const d = LOB.dance.get(id), dancing = d && now < d.until && DANCES[d.k];
    f.av.update(dt, { speed: 0, stand: true, dance: dancing ? DANCES[d.k][2] : null, lightOn: false });
  }
  const fl = calm() ? 1 : 0.85 + 0.15 * Math.sin(LOB.t * 9) * Math.sin(LOB.t * 3.1); LOB.lamp.intensity = 7 * fl; LOB.throwL.intensity = 5 * fl;
  const w = cvs.width, h = cvs.height; if (LOB.cam.aspect !== w / h) { LOB.cam.aspect = w / h; LOB.cam.updateProjectionMatrix(); }
  // (a narrow screen: step back so all four fit)
  LOB.cam.position.z = w < h ? 7.2 : 4.6; LOB.cam.lookAt(0, 1.0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
  draw(LOB.scene, LOB.cam);
}
function leaveLobby3D() {
  for (const f of LOB.figs.values()) { f.av.obj.removeFromParent(); f.av.dispose(); }
  LOB.figs.clear(); LOB.dance.clear();
  $('chatLog').textContent = '';
}

/* ---------- dances ---------- */
function lobbyDance(k) {
  if (!MP.on || state !== 'lobby') return;
  if (MP.host) hostLobbyDance(MP.myId, { k }); else send(MP.hostConn, { t: 'ldance', k });
}
function hostLobbyDance(id, m) {
  const k = m.k | 0; if (DANCES[k] && !teamReady('ld' + id)) return;   // (starting one is rate limited; stopping never is)
  hostEmit({ t: 'ldance', id, k: DANCES[k] ? k : -1 });
}
function gotLobbyDance(m) { if (m.k >= 0) LOB.dance.set(m.id, { k: m.k, until: performance.now() + DANCE_MAX * 1000 }); else LOB.dance.delete(m.id); }
{ const bar = $('lbDances');
  DANCES.forEach(([name, icon], k) => { const b = document.createElement('button'); b.className = 'dz'; b.title = name; b.innerHTML = ico(icon); b.onclick = () => lobbyDance(k); bar.appendChild(b); });
  const stop = document.createElement('button'); stop.className = 'dz'; stop.title = 'Stop dancing'; stop.innerHTML = ico('stop'); stop.onclick = () => lobbyDance(-1); bar.appendChild(stop); }

/* ---------- chat ---------- */
function sendChat() {
  const i = $('chatIn'), text = cleanChat(i.value); i.value = ''; if (!text || !MP.on) return;
  if (MP.host) hostChat(MP.myId, { text }); else send(MP.hostConn, { t: 'chat', text });
}
function hostChat(id, m) {
  const pl = lobbyPlayer(id), text = cleanChat(m.text); if (!pl || !text) return;
  const now = performance.now(); if (LOB.lastChat && now - (LOB.lastChat[id] || 0) < 700) return;   // (no flooding)
  (LOB.lastChat = LOB.lastChat || {})[id] = now;
  hostEmit({ t: 'chat', id, name: pl.name, text });
}
function gotChat(m) {
  const text = cleanChat(m.text), name = cleanName(m.name) || 'Player'; if (!text) return;
  const log = $('chatLog'), li = document.createElement('li'), b = document.createElement('b'); b.textContent = name + ': ';
  li.append(b, document.createTextNode(text)); log.appendChild(li);
  while (log.children.length > CHAT_KEEP) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
$('chatIn').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
$('chatIn').addEventListener('keyup', e => e.stopPropagation());
$('chatGo').onclick = sendChat;
