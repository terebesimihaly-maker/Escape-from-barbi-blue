// A tiny static server for the tests: serves the repository, and /game.html = index.html with the test hooks injected.
// Usage: node tests/server.mjs [port]   (or import { serve } and call serve(port))
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.png': 'image/png', '.txt': 'text/plain' };

function testPage() {
  let s = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const main = '<script src="js/main.js"></script>';
  if (!s.includes(main)) throw new Error('index.html has no ' + main);
  s = s.replace('<head>', '<head><script src="tests/clock.js"></script>');
  return s.replace(main, '<script src="tests/hooks.js"></script>\n' + main);
}

export function serve(port = 8766) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/game.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(testPage()); return; }
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
