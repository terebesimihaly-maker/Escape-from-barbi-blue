// Runs every test suite (tests/*.test.mjs) one after another, with the game server and a local PeerJS server started for them.
// Usage: cd tests && npm install && npm test          (or: node run.mjs single   to run only the suites whose name contains "single")
//   WEB_PORT=8770 PEER_PORT=9004 node run.mjs ...   other ports, so two runs can go side by side
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url)), only = process.argv[2] || '';
const WEB = +process.env.WEB_PORT || 8766, PEER = +process.env.PEER_PORT || 9000;
const env = { ...process.env, GAME_URL: `http://127.0.0.1:${WEB}/game.html`, PEER: `127.0.0.1:${PEER}`, PEER_PORT: String(PEER) };
const web = await serve(WEB);
const peer = spawn(process.execPath, [path.join(DIR, 'peerserver.cjs')], { stdio: 'ignore', env });
await new Promise(r => setTimeout(r, 1500));
const suites = fs.readdirSync(DIR).filter(f => f.endsWith('.test.mjs') && f.includes(only)).sort();
const results = [];
for (const s of suites) {
  console.log(`\n### ${s}`);
  const code = await new Promise(ok => spawn(process.execPath, [path.join(DIR, s)], { stdio: 'inherit', env }).on('exit', ok));
  results.push([s, code]);
}
peer.kill(); web.close();
console.log('\n' + results.map(([s, c]) => `${c === 0 ? 'OK  ' : 'FAIL'} ${s}`).join('\n'));
process.exit(results.some(([, c]) => c !== 0) ? 1 : 0);
