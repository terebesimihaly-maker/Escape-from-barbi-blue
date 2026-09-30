/* Escape from Barbi Blue: the game's icons: thin line drawings (SVG, the text colour), instead of emoji, so they look the
   same everywhere. ico(name) gives the markup; icoPath(name) a Path2D for drawing one on the canvas (24 x 24 units).
   (The game is split over several plain scripts that share one scope; index.html loads them in order.) */
'use strict';
const ICONS = {
  pin: 'M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  dance: 'M13 4.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM6 9l4-2.5 3 1 3-2.5M13 7.5l-1.5 5.5 3.5 3-1 5M11.5 13L8 16.5 5.5 21M17 3.5l2-1.5M19 6.5l2 .5',
  puzzle: 'M4 8h3.5a2 2 0 1 1 4 0H15v3.5a2 2 0 1 0 0 4V19h-3.5a2 2 0 1 0-4 0H4v-3.5a2 2 0 1 1 0-4z',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2M12 15v2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  note: 'M7 3h8l4 4v14H7zM15 3v4h4M10 11h6M10 15h6M10 19h4',
  trophy: 'M8 3h8v5a4 4 0 0 1-8 0zM8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4M12 12v4M8.5 20h7M10 16h4v4h-4z',
  crown: 'M3.5 17L2.5 7l5 4 4.5-6 4.5 6 5-4-1 10zM4 20h16',
  stop: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7.5-6.5 7.5-2.5 0-4-1.5-5.5-3.5L3 13.5a1.5 1.5 0 0 1 2.3-1.8L8 14',
  ghost: 'M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2zM9.5 11h.01M14.5 11h.01',
  chat: 'M4 5h16v11H9l-5 4z',
  // the dances
  floss: 'M12 5a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 12 5zM12 6.5v7M12 13.5l-3 7.5M12 13.5l3 7.5M12 8l-6 4M12 8l6-4',
  robot: 'M6 8h12v10H6zM9 12h.01M15 12h.01M10 15.5h4M12 8V5M12 4.5h.01M4 12v3M20 12v3',
  disco: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM4 13h16M12 5c-2.5 2.5-2.5 13.5 0 16M12 5c2.5 2.5 2.5 13.5 0 16M12 2v3',
  chicken: 'M8 10a4 4 0 1 1 7 2.5l3 1.5-3 1c0 3-2.5 5-5 5s-4.5-2-4.5-4.5M14 8h.01M8 20l-1 2M11 20.5l.5 1.5M5 9l-2 1 2 1',
  wave: 'M2 13c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M2 18c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3',
  twist: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 12c0-5 4-8 8-6M12 12c0 5-4 8-8 6M12 12c5 0 8 4 6 8M12 12c-5 0-8-4-6-8',
  guitar: 'M14 10l6.5-6.5M19 3l2 2M11 9.5a3.5 3.5 0 0 0-4.5 1L4.5 13a4 4 0 0 0 6.5 6.5l2.5-2a3.5 3.5 0 0 0 1-4.5l-.5-.5 1-2-2.5-1zM9 15h.01',
  hype: 'M7 11V5.5a1.5 1.5 0 0 1 3 0V10M14 10V5.5a1.5 1.5 0 0 1 3 0V11M10 9.5V4a1.5 1.5 0 0 1 3 0v6M5 12c0 5 3 9 7 9s7-4 7-9M3 5l1.5 1.5M21 5l-1.5 1.5M12 1v1',
};
const ico = (name, cls) => '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (ICONS[name] || '') + '"/></svg>';
const _icoPaths = {};
const icoPath = name => _icoPaths[name] || (_icoPaths[name] = new Path2D(ICONS[name] || ''));
// (drawn on the canvas: stroked, at x, y, size px)
function drawIco(g, name, x, y, size, color) {
  g.save(); g.translate(x, y); g.scale(size / 24, size / 24); g.strokeStyle = color; g.lineWidth = 1.8; g.lineCap = g.lineJoin = 'round'; g.stroke(icoPath(name)); g.restore();
}
