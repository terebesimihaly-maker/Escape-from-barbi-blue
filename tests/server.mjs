// A tiny static server for the tests: serves the repository, and /game.html = index.html with the test hooks injected.
// Usage: node tests/server.mjs [port]   (or import { serve } and call serve(port))
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.png': 'image/png', '.txt': 'text/plain',
  '.webp': 'image/webp', '.bin': 'application/octet-stream', '.exr': 'image/x-exr' };

function testPage() {
  let s = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const main = '<script src="js/main.js"></script>';
  if (!s.includes(main)) throw new Error('index.html has no ' + main);
  s = s.replace('<head>', '<head><script src="tests/clock.js"></script>');
  return s.replace(main, '<script src="tests/hooks.js"></script>\n' + main);
}

// A stand-in for the game's account server (the EFBB Supabase project) at /fake/rest/v1/rpc/<function>: the same five
// functions, the same answers (supabase/migrations/*_efbb_accounts.sql), kept in memory. The game uses it with ?api=http://…/fake
import crypto from 'node:crypto';
const fake = { players: new Map(), sessions: new Map(), calls: [], down: false };
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function newSession(name) { const t = crypto.randomBytes(32).toString('hex'); fake.sessions.set(sha(t), name); return t; }
function fakeRpc(fn, a) {
  fake.calls.push(fn);
  const P = n => fake.players.get(String(n || '').toLowerCase()), who = t => fake.sessions.get(sha(t || ''));
  switch (fn) {
    case 'efbb_sign_up': {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(a.p_username || '')) return { error: 'bad_username' };
      if (!a.p_password || a.p_password.length < 6 || Buffer.byteLength(a.p_password) > 72) return { error: 'bad_password' };
      if (P(a.p_username)) return { error: 'taken' };
      const look = a.p_look && typeof a.p_look === 'object' && !Array.isArray(a.p_look) ? a.p_look : {};
      fake.players.set(a.p_username.toLowerCase(), { username: a.p_username, pass: sha('salt' + a.p_password), look, failed: 0, locked: 0 });
      return { token: newSession(a.p_username.toLowerCase()), username: a.p_username, look };
    }
    case 'efbb_sign_in': {
      const p = P(a.p_username); if (!p) return { error: 'bad_login' };
      if (p.locked > Date.now()) return { error: 'locked' };
      if (p.pass !== sha('salt' + (a.p_password || ''))) { if (++p.failed >= 8) { p.failed = 0; p.locked = Date.now() + 600000; } return { error: 'bad_login' }; }
      p.failed = 0; p.locked = 0; return { token: newSession(p.username.toLowerCase()), username: p.username, look: p.look };
    }
    case 'efbb_me': { const n = who(a.p_token), p = n && P(n); return p ? { username: p.username, look: p.look } : { error: 'bad_session' }; }
    case 'efbb_save_look': { const n = who(a.p_token), p = n && P(n); if (!p) return { error: 'bad_session' };
      if (!a.p_look || typeof a.p_look !== 'object' || Array.isArray(a.p_look)) return { error: 'bad_look' }; p.look = a.p_look; return { ok: true }; }
    case 'efbb_rename': { const n = who(a.p_token), p = n && P(n); if (!p) return { error: 'bad_session' };
      if (!/^[A-Za-z0-9_]{3,16}$/.test(a.p_username || '')) return { error: 'bad_username' };
      const to = a.p_username.toLowerCase(); if (to !== n && P(to)) return { error: 'taken' };
      fake.players.delete(n); p.username = a.p_username; fake.players.set(to, p);
      for (const [k, v] of fake.sessions) if (v === n) fake.sessions.set(k, to);      // (every device signed in as this player follows)
      return { ok: true, username: a.p_username }; }
    case 'efbb_sign_out': fake.sessions.delete(sha(a.p_token || '')); return { ok: true };
  }
  return null;
}
export function serve(port = 8766) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/game.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(testPage()); return; }
    if (url.startsWith('/fake/')) {                            // (the stand-in account server; /fake/debug shows what's in it)
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey, content-type', 'content-type': 'application/json' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      if (url === '/fake/debug') { res.writeHead(200, cors); res.end(JSON.stringify({ players: [...fake.players.values()], calls: fake.calls, sessions: fake.sessions.size })); return; }
      if (url === '/fake/down') { fake.down = !fake.down; res.writeHead(200, cors); res.end(JSON.stringify({ down: fake.down })); return; }
      let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
        if (fake.down) { req.socket.destroy(); return; }         // (as if the server can't be reached)
        const m = /^\/fake\/rest\/v1\/rpc\/(\w+)$/.exec(url); let a = {}; try { a = JSON.parse(body || '{}'); } catch (e) {}
        const out = m && req.headers.apikey ? fakeRpc(m[1], a) : null;
        res.writeHead(out ? 200 : 404, cors); res.end(JSON.stringify(out || { message: 'not found' })); });
      return;
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.argv[2] || 8766;
  await serve(port); console.log(`serving the game on http://127.0.0.1:${port}/ (tests use /game.html)`);
}
