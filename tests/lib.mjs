import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared helpers for the browser tests. Settings (environment variables):
//   GAME_URL  where the test page is served (default: tests/server.mjs on port 8766)
//   CHROME    a Chromium to use (default: the one this project was developed with, else playwright-core's own)
//   PEER      a local PeerJS server for multiplayer (default 127.0.0.1:9000, started by tests/run.mjs)
export const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');   // screenshots (not committed)
fs.mkdirSync(OUT, { recursive: true });
export const BASE = process.env.GAME_URL || 'http://127.0.0.1:8766/game.html';
export const URL = BASE + '?peer=' + (process.env.PEER || '127.0.0.1:9000');
let fails = 0, passes = 0;
// every check prints PASS or FAIL; summary() returns the number of failures (the exit code)
export function check(cond, label, extra) { if (cond) { passes++; console.log('  PASS', label); } else { fails++; console.log('  FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); } }
export const summary = () => { console.log(`\n${passes} passed, ${fails} failed`); return fails; };
//   GPU=1     draw the 3D on your graphics card (your own Chrome or Edge, in visible windows) instead of in software
//   HEADLESS=1  with GPU=1: no windows (whether headless Chrome uses the GPU depends on the machine)
export async function launch() {
  const dev = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', exe = process.env.CHROME || (fs.existsSync(dev) ? dev : undefined);
  if (process.env.GPU) {
    const pf = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const found = process.env.CHROME || [...pf.map(d => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')), ...pf.map(d => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(f => fs.existsSync(f));
    return chromium.launch({ executablePath: found, channel: found ? undefined : 'chrome', headless: !!process.env.HEADLESS,
      args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  }
  return chromium.launch({ executablePath: exe,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
}
export async function player(b, name, w = 480, h = 300) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(n => { try { localStorage.setItem('bb_settings', JSON.stringify({ sens: 1, vol: 0.5, quality: 'low' })); localStorage.setItem('bb_name', n); } catch (e) {} }, name);
  const p = await ctx.newPage(); p.pname = name;
  p.on('pageerror', e => { console.log(`  [${name}] pageerror:`, e.message); pageErrors.push(e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/404|AudioContext/.test(m.text())) console.log(`  [${name}] console:`, m.text()); });
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 120000, polling: 500 });
  return p;
}
export const visible = (p, id) => p.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
export const text = (p, id) => p.evaluate(id => document.getElementById(id).textContent, id);
export async function until(p, fn, arg, ms = 30000) { try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 200 }); return true; } catch (e) { return false; } }
// the lobby owner's 3D lobby has finished building (its shaders: slow with software rendering, where they can't build in the
// background and hold the page meanwhile; join only after, as a real GPU would have taken well under a second)
export const lobbyBuilt = p => until(p, () => LOB.roomReady && LOB.figs.size > 0 && LOB.stage.children.length === 0, null, 180000);
export async function openMp(p) { await p.evaluate(() => document.querySelector('nav [data-panel=mp]').click()); }
export const click = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); if (!e) throw new Error('no ' + sel); e.click(); }, sel);
export const fill = (p, sel, v) => p.evaluate(([sel, v]) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }, [sel, v]);
// a single-player page (no multiplayer server needed)
export async function solo(b, quality = 'low', w = 640, h = 360) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(q => localStorage.setItem('bb_settings', JSON.stringify({ sens: 1, vol: 0.5, quality: q })), quality);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  pageerror:', e.message); pageErrors.push(e.message); });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => !document.getElementById('play').disabled, null, { timeout: 120000, polling: 500 });
  return p;
}
export const pageErrors = [];
// single player: "Enter the house", then a floor from the list (and optionally a difficulty first)
export async function startSolo(p, lv = 0, diff) {
  await click(p, '#play');
  if (diff) await click(p, `#diffSeg button[data-d="${diff}"]`);
  await click(p, `#lvList button[data-lv="${lv}"]`);
}
