/* Escape from Barbi Blue: Accounts, and your character.
     sign in / create account - a username and a password, kept on the game's server (a Supabase project: EFBB). It's the
               first thing you see when the game opens; below it, "Play as a guest" (your character stays on this device).
     profile - click your name on the title screen: your character in 3D, and everything about it: shirt, trousers, shoes,
               hair (style and colour), skin, eyes, beard, glasses, freckles, make-up, height, build, and a new face.
               It's saved to your account (or, as a guest, this device), and it's how the others see you when you play together.
   The server keeps only a bcrypt hash of your password; signing in gives this device a session token (kept here, 90 days).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';

const API = { url: 'https://zkxnbcrayjwkeyxlungk.supabase.co', key: 'sb_publishable_eYFbPz96BedDPiXiP2anxw_QLiSNt-u' };
{ const q = new URLSearchParams(location.search).get('api'); if (q) { API.url = q; API.key = 'test'; } }   // (the tests: a stand-in server)
const SESSION_KEY = 'bb_session', LOOK_KEY = 'bb_look';
const account = { user: '', token: '', guest: false, look: null, saving: 0 };
const AUTH_ERRORS = {
  bad_username: 'A username is 3 to 16 letters, numbers or _.', bad_password: 'A password needs at least 6 characters.',
  taken: 'That username is taken. Try another.', bad_login: 'Wrong username or password.',
  locked: 'Too many wrong passwords. Try again in 10 minutes.', too_many: 'Too many new accounts from here. Try again later.',
  mismatch: "The two passwords don't match.", offline: "Can't reach the account server. Check your internet, or play as a guest.",
  server: 'Something went wrong on the server. Try again, or play as a guest.' };

// one call to the server: a function in the EFBB project. Always resolves: the answer, or { error }
async function api(fn, args) {
  const ab = new AbortController(), t = setTimeout(() => ab.abort(), 12000);
  try {
    const r = await fetch(API.url + '/rest/v1/rpc/' + fn, { method: 'POST', signal: ab.signal,
      headers: { apikey: API.key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => null);
    return r.ok && j && typeof j === 'object' ? j : { error: 'server' };
  } catch (e) { return { error: 'offline' }; } finally { clearTimeout(t); }
}

/* ---------- your look ---------- */
function localLook() {
  try { const l = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null'); if (l) return PlayerModel.sanitizeLook(l); } catch (e) {}
  const l = PlayerModel.randomLook(Math.random().toString(36).slice(2, 10)); saveLocalLook(l); return l;
}
function saveLocalLook(l) { try { localStorage.setItem(LOOK_KEY, JSON.stringify(l)); } catch (e) {} }
// a change: shown at once, kept on this device, and (signed in) sent to the server a moment later
function setLook(l) {
  account.look = PlayerModel.sanitizeLook(l); saveLocalLook(account.look); updateProfileChip(); previewLook();
  if (account.token) { clearTimeout(account.saveT); account.saveT = setTimeout(pushLook, 900); }
}
async function pushLook() {
  if (!account.token) return; account.saving++;
  const r = await api('efbb_save_look', { p_token: account.token, p_look: account.look }); account.saving--;
  if (r.error === 'bad_session') signedOut('You were signed out. Sign in again to keep your character.');
  $('pfAcct').dataset.saved = r.ok ? '1' : ''; renderAccountLine(r.ok ? '' : r.error);
}

/* ---------- signing in ---------- */
function setSignedIn(user, token, look) {
  Object.assign(account, { user, token, guest: false });
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token })); } catch (e) {}
  saveName(user); $('mpName').value = myName;
  const server = look && Object.keys(look).length ? PlayerModel.sanitizeLook(look) : null;
  account.look = server || localLook(); saveLocalLook(account.look);
  if (!server) pushLook();                                  // (a new account keeps the character you already had)
  updateProfileChip(); showTitleAfterAuth();
}
function becomeGuest() {
  Object.assign(account, { user: '', token: '', guest: true }); account.look = localLook();
  updateProfileChip(); showTitleAfterAuth();
}
function signedOut(msg) {
  const tok = account.token; Object.assign(account, { user: '', token: '', guest: false });
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  if (tok) api('efbb_sign_out', { p_token: tok });
  closePanel(); showAuth(msg || '');
}
function showTitleAfterAuth() { show('auth', false); if (state === 'title') { show('title', true); loadBest(); updateRejoinBtn(); } }
let authMode = 'in';
function showAuth(msg) {
  show('title', false); show('auth', true); setAuthMode(authMode);
  $('auMsg').textContent = msg || ''; $('auMsg').className = 'hint' + (msg ? ' err' : '');
  setTimeout(() => { try { $('auUser').focus(); } catch (e) {} }, 50);
}
function setAuthMode(m) {
  authMode = m; document.querySelectorAll('#authTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === m));
  show('auPass2Row', m === 'up'); $('auGo').textContent = m === 'up' ? 'Create account' : 'Sign in';
  $('auPass').autocomplete = m === 'up' ? 'new-password' : 'current-password'; $('auMsg').textContent = '';
}
async function submitAuth() {
  const user = $('auUser').value.trim(), pass = $('auPass').value, btn = $('auGo');
  if (authMode === 'up' && pass !== $('auPass2').value) { authError('mismatch'); return; }
  btn.disabled = true; $('auMsg').className = 'hint'; $('auMsg').textContent = authMode === 'up' ? 'Creating your account…' : 'Signing in…';
  const r = authMode === 'up' ? await api('efbb_sign_up', { p_username: user, p_password: pass, p_look: localLook() })
    : await api('efbb_sign_in', { p_username: user, p_password: pass });
  btn.disabled = false;
  if (r.error || !r.token) { authError(r.error || 'server'); return; }
  $('auPass').value = $('auPass2').value = '';
  setSignedIn(r.username, r.token, r.look);
}
function authError(code) { $('auMsg').textContent = AUTH_ERRORS[code] || AUTH_ERRORS.server; $('auMsg').className = 'hint err'; }
document.querySelectorAll('#authTabs button').forEach(b => b.onclick = () => setAuthMode(b.dataset.t));
$('auGo').onclick = submitAuth;
['auUser', 'auPass', 'auPass2'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitAuth(); } }));
$('auGuest').onclick = () => { unlockAudio(); becomeGuest(); };
// the game opens: signed in before (and the server still knows the session)? straight to the title. Otherwise: sign in, or guest
async function startAccount() {
  if (window.__autoGuest) { becomeGuest(); return; }      // (the tests: straight in as a guest, unless a test is about signing in)
  let saved = null; try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
  if (!saved || !saved.token) { showAuth(''); return; }
  showAuth(''); $('auMsg').textContent = 'Signing you in as ' + saved.user + '…'; $('auGo').disabled = true;
  const r = await api('efbb_me', { p_token: saved.token }); $('auGo').disabled = false;
  if (r.username) { setSignedIn(r.username, saved.token, r.look); return; }
  if (r.error === 'bad_session') { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} showAuth('Your session ended. Sign in again.'); return; }
  $('auUser').value = saved.user; authError(r.error);      // (offline: sign in later, or play as a guest)
}

/* ---------- the profile: your character ---------- */
function updateProfileChip() {
  const l = account.look; if (!l) return;
  $('pfName').textContent = account.token ? account.user : 'Guest';
  $('pfDot').style.background = '#' + l.shirt.toString(16).padStart(6, '0');
}
function renderAccountLine(err) {
  const el = $('pfAcct');
  if (account.token) el.textContent = 'Signed in as ' + account.user + (err ? ' · not saved: ' + (AUTH_ERRORS[err] || err) : ' · your character is saved to your account');
  else el.textContent = 'Playing as a guest: your character is kept on this device only.';
  show('pfSignOut', !!account.token); show('pfSignUp', !account.token); show('pfNameSave', !!account.token);
  $('pfNameLbl').textContent = account.token ? 'Username' : 'Name';
}
const hexOf = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
// the controls: a row of colour swatches (plus your own colour), or a row of choices
function renderProfileControls() {
  const O = PlayerModel.LOOK_OPTIONS, l = account.look, box = $('pfCtl'); box.textContent = '';
  const row = (label, build) => { const r = document.createElement('div'); r.className = 'pfrow'; const s = document.createElement('span'); s.textContent = label; r.appendChild(s);
    const c = document.createElement('div'); c.className = 'pfopts'; build(c); r.appendChild(c); box.appendChild(r); };
  const colours = (label, key, list, custom) => row(label, c => {
    list.forEach(v => { const b = document.createElement('button'); b.className = 'sw' + (l[key] === v ? ' on' : ''); b.style.background = hexOf(v); b.title = hexOf(v);
      b.dataset.k = key; b.dataset.v = v; b.onclick = () => { setLook(Object.assign({}, account.look, { [key]: v })); focusOn(key); renderProfileControls(); }; c.appendChild(b); });
    if (custom) { const i = document.createElement('input'); i.type = 'color'; i.className = 'swc' + (list.includes(l[key]) ? '' : ' on'); i.value = hexOf(l[key]); i.title = 'Your own colour';
      i.dataset.k = key; i.oninput = () => { setLook(Object.assign({}, account.look, { [key]: parseInt(i.value.slice(1), 16) })); focusOn(key); }; i.onchange = renderProfileControls; c.appendChild(i); }
  });
  const choices = (label, key, list, names) => row(label, c => list.forEach((v, j) => { const b = document.createElement('button'); b.className = 'ch' + (l[key] === v ? ' on' : '');
    b.textContent = names[j]; b.dataset.k = key; b.dataset.v = v; b.onclick = () => { setLook(Object.assign({}, account.look, { [key]: v })); focusOn(key); renderProfileControls(); }; c.appendChild(b); }));
  const toggle = (label, key) => choices(label, key, [false, true], ['No', 'Yes']);
  choices('Top', 'top', O.top, ['T-shirt', 'Long sleeves', 'Hoodie']); colours('Top colour', 'shirt', O.shirt, true);
  choices('Bottoms', 'bottom', O.bottom, ['Trousers', 'Shorts', 'Skirt']); colours('Bottoms colour', 'pants', O.pants, true);
  colours('Shoes', 'shoes', O.shoes, true);
  choices('Hair', 'hairStyle', O.hairStyle, ['Buzz cut', 'Short', 'Bob', 'Long', 'Ponytail', 'Bun', 'Curly']); colours('Hair colour', 'hair', O.hair, true);
  colours('Skin', 'skin', O.skin, false); colours('Eyes', 'eyes', O.eyes, false);
  choices('Beard', 'beard', O.beard, ['None', 'Stubble', 'Beard', 'Moustache', 'Goatee']);
  choices('Glasses', 'glasses', O.glasses, ['None', 'Round', 'Square']);
  toggle('Freckles', 'freckles'); toggle('Make-up', 'makeup');
  choices('Build', 'body', O.body, ['Curvy', 'Straight']);
  row('Height', c => { const i = document.createElement('input'); i.type = 'range'; i.min = O.height[0]; i.max = O.height[1]; i.step = 0.005; i.value = l.height; i.id = 'pfHeight';
    const o = document.createElement('output'); o.textContent = Math.round(l.height * 160) + ' cm';
    i.oninput = () => { o.textContent = Math.round(+i.value * 160) + ' cm'; setLook(Object.assign({}, account.look, { height: +i.value })); focusOn('height'); }; c.append(i, o); });
  renderAccountLine('');
}
function openProfile() {
  if (!account.look) account.look = localLook();
  $('pfNameIn').value = myName; renderProfileControls(); openPanel('profile'); startPreview();
}
$('profileBtn').onclick = () => { unlockAudio(); openProfile(); };
$('pfRandom').onclick = () => { setLook(PlayerModel.randomLook(Math.random().toString(36).slice(2, 10))); focusOn('all'); renderProfileControls(); };
$('pfFace').onclick = () => { setLook(Object.assign({}, account.look, { seed: Math.random().toString(36).slice(2, 10) })); focusOn('seed'); };   // (a new face; the rest stays)
$('pfSignOut').onclick = () => signedOut('Signed out.');
$('pfSignUp').onclick = () => { closePanel(); authMode = 'up'; showAuth('Create an account and your character comes with you.'); };
// your name: a guest's is kept on this device as you type; signed in, it's your username, changed on the server with "Save name"
// (the same rules as a new account: 3 to 16 letters, numbers or _, and nobody else may have it)
$('pfNameIn').addEventListener('input', e => { if (account.token) return; saveName(e.target.value); $('mpName').value = myName; });
$('pfNameIn').addEventListener('keydown', e => { if (e.key === 'Enter' && account.token) { e.preventDefault(); renameAccount(); } });
$('pfNameSave').onclick = () => renameAccount();
async function renameAccount() {
  const name = $('pfNameIn').value.trim(), btn = $('pfNameSave');
  if (!account.token || name === account.user) return;
  btn.disabled = true; $('pfAcct').textContent = 'Changing your username…';
  const r = await api('efbb_rename', { p_token: account.token, p_username: name }); btn.disabled = false;
  if (r.error === 'bad_session') { signedOut('You were signed out. Sign in again to change your username.'); return; }
  if (r.error || !r.username) { $('pfAcct').textContent = AUTH_ERRORS[r.error] || AUTH_ERRORS.server; $('pfNameIn').value = account.user; return; }
  account.user = r.username;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user: account.user, token: account.token })); } catch (e) {}
  saveName(account.user); $('mpName').value = myName; updateProfileChip();
  $('pfAcct').textContent = 'Your username is now ' + account.user + '.';
}

/* ---------- the 3D preview (its own small renderer, made the first time the profile opens; it only draws while it's open) ---------- */
const pv = { r: null, scene: null, cam: null, fig: null, raf: 0, on: false, yaw: 0.35, drag: null, pinch: null, t: 0, dirty: false, zoom: 0, zoomT: 0 };
// the camera shows all of you, or (zoomed in) your face: choosing something for the face zooms in, clothes and build zoom out
const FACE_KEYS = ['seed', 'hair', 'hairStyle', 'skin', 'eyes', 'beard', 'glasses', 'freckles', 'makeup'];
function focusOn(key) { pv.zoomT = FACE_KEYS.includes(key) ? 1 : 0; }
async function startPreview() {
  const cv = $('pfView'); pv.on = true; pv.zoom = pv.zoomT = 0; $('pfLoading').textContent = 'Loading your character…'; show('pfLoading', true);
  loadPlayerTemplate(); await playerTemplateLoad;
  if (!pv.on || pv.raf) return;                              // (closed while loading, or already drawing)
  if (!playerTemplate) { $('pfLoading').textContent = "Couldn't load the character model."; return; }
  show('pfLoading', false);
  if (!pv.r) {
    try { pv.r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); }
    catch (e) { console.error(e); $('pfLoading').textContent = "Can't show your character in 3D here."; show('pfLoading', true); return; }
    pv.r.outputColorSpace = THREE.SRGBColorSpace; pv.r.toneMapping = THREE.ACESFilmicToneMapping; pv.r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    pv.scene = new THREE.Scene();
    pv.scene.add(new THREE.HemisphereLight(0xdde4ff, 0x2a2426, 1.7));
    const key = new THREE.DirectionalLight(0xfff0e0, 2.4); key.position.set(1.5, 3, 3); pv.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7f9cff, 1.6); rim.position.set(-2.5, 2, -2); pv.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.7, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2; pv.scene.add(floor);
    pv.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  }
  pv.dirty = true; let last = performance.now();
  const loop = now => { if (!pv.on) { pv.raf = 0; return; } pv.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; pv.t += dt;
    if (pv.dirty) { pv.dirty = false; buildPreviewFigure(); }
    const w = cv.clientWidth, h = cv.clientHeight, pr = pv.r.getPixelRatio();
    if (w && h && (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr))) { pv.r.setSize(w, h, false); pv.cam.aspect = w / h; pv.cam.updateProjectionMatrix(); }
    pv.zoom += (pv.zoomT - pv.zoom) * Math.min(1, dt * 5);
    if (!pv.drag) {
      if (pv.zoomT > 0.5) { const front = Math.round(pv.yaw / (2 * Math.PI)) * 2 * Math.PI + Math.sin(pv.t * 0.6) * 0.4; pv.yaw += (front - pv.yaw) * Math.min(1, dt * 2); }   // (the face: towards you, turning a little)
      else pv.yaw += dt * 0.35;
    }
    // (the figure is about 1.6 m tall times its height; the eyes are at 1.469 times it)
    const s = account.look ? account.look.height : 1.1, z = pv.zoom * pv.zoom * (3 - 2 * pv.zoom), top = 1.6 * s, eye = 1.469 * s;
    const ty = top * 0.5 + (eye - 0.015 - top * 0.5) * z, d = (top * 0.5 + 0.16) / Math.tan(Math.PI / 12) * (1 - z) + 0.62 * z, cy = ty + 0.3 * (1 - z) + 0.02 * z;
    pv.cam.position.set(Math.sin(pv.yaw) * d, cy, Math.cos(pv.yaw) * d); pv.cam.lookAt(0, ty, 0);
    if (pv.fig) pv.fig.update(dt, { speed: 0, stand: true, lightOn: false });
    pv.r.render(pv.scene, pv.cam); };
  pv.raf = requestAnimationFrame(loop);
}
function buildPreviewFigure() {
  if (!pv.scene || !playerTemplate) return;
  if (pv.fig) { pv.scene.remove(pv.fig.obj); pv.fig.dispose(); }
  pv.fig = PlayerModel.createHuman(THREE, { slot: 0, name: '', template: playerTemplate, mocap: mocapData, look: account.look });
  pv.fig.obj.traverse(o => { if (o.isSprite) o.visible = false; });   // (no nametag here)
  pv.scene.add(pv.fig.obj);
}
function previewLook() { if (pv.on) pv.dirty = true; }
function stopPreview() {
  pv.on = false; if (pv.raf) cancelAnimationFrame(pv.raf); pv.raf = 0; pv.drag = pv.pinch = null; pvPts.clear();
  if (pv.fig) { pv.scene.remove(pv.fig.obj); pv.fig.dispose(); pv.fig = null; }
  if (pv.r) pv.r.renderLists.dispose();
}
// drag the preview to turn your character round; the mouse wheel, pinching or a double click zooms
const pvPts = new Map(), pvGap = () => { const [a, b] = [...pvPts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
$('pfView').addEventListener('pointerdown', e => { e.preventDefault(); pvPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pvPts.size === 1) pv.drag = { x: e.clientX, yaw: pv.yaw }; else { pv.drag = null; pv.pinch = { d: pvGap(), z: pv.zoomT }; } });
addEventListener('pointermove', e => { if (!pvPts.has(e.pointerId)) return; pvPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pv.pinch && pvPts.size >= 2) pv.zoomT = Math.min(1, Math.max(0, pv.pinch.z + (pvGap() - pv.pinch.d) / 160));
  else if (pv.drag) pv.yaw = pv.drag.yaw - (e.clientX - pv.drag.x) * 0.01; });
const pvUp = e => { pvPts.delete(e.pointerId); if (pvPts.size < 2) pv.pinch = null; if (!pvPts.size) pv.drag = null; };
addEventListener('pointerup', pvUp); addEventListener('pointercancel', pvUp);
$('pfView').addEventListener('wheel', e => { e.preventDefault(); pv.zoomT = Math.min(1, Math.max(0, pv.zoomT - Math.sign(e.deltaY) * 0.34)); }, { passive: false });
$('pfView').addEventListener('dblclick', () => { pv.zoomT = pv.zoomT > 0.5 ? 0 : 1; });
