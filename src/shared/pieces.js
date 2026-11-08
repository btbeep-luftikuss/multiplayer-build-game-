// Building pieces: shapes, materials, the eight player kits and the special (power-up) pieces.
// Data only (no physics or graphics code), so the phone controller can draw the same pieces as icons.
// Units are metres; y points up; every shape is centred on its own middle.

// burns: lava burns (or melts) it; stone, metal, brick, glass and gold don't burn
export const MATERIALS = {
  wood:     { density: 1.0,  friction: 0.75, restitution: 0.05, color: '#e3a35a', dark: '#b87533', burns: true, sound: 'wood' },
  stone:    { density: 2.6,  friction: 0.95, restitution: 0.0,  color: '#a9acb5', dark: '#7c808c', sound: 'stone' },
  metal:    { density: 3.2,  friction: 0.5,  restitution: 0.05, color: '#79a8d6', dark: '#4f7aa8', sound: 'metal' },
  rubber:   { density: 1.1,  friction: 1.2,  restitution: 0.55, color: '#ff5d8f', dark: '#d63a6c', burns: true, sound: 'rubber' },
  foam:     { density: 0.25, friction: 0.85, restitution: 0.1,  color: '#ffe066', dark: '#e8b830', burns: true, sound: 'soft' },
  ice:      { density: 0.9,  friction: 0.04, restitution: 0.05, color: '#bfefff', dark: '#86cfe8', burns: true, sound: 'glass' },
  glass:    { density: 2.0,  friction: 0.35, restitution: 0.1,  color: '#9eead2', dark: '#5fc3a6', sound: 'glass' },
  clay:     { density: 1.8,  friction: 0.9,  restitution: 0.02, color: '#e0674b', dark: '#b1462f', sound: 'stone' },
  candy:    { density: 0.8,  friction: 0.9,  restitution: 0.15, color: '#ff9ad5', dark: '#e46bb3', burns: true, sound: 'soft' },
  gold:     { density: 2.4,  friction: 0.6,  restitution: 0.05, color: '#ffc93c', dark: '#d69a12', sound: 'metal' },
  magN:     { density: 2.4,  friction: 0.7,  restitution: 0.02, color: '#ff5a5a', dark: '#c03030', sound: 'metal' },
  magS:     { density: 2.4,  friction: 0.7,  restitution: 0.02, color: '#4f8dff', dark: '#2a5cc0', sound: 'metal' },
  // special pieces
  goo:      { density: 1.2,  friction: 1.5,  restitution: 0.0,  color: '#7dff5a', dark: '#3fc22a', burns: true, sound: 'goo' },
  magnet:   { density: 2.6,  friction: 0.7,  restitution: 0.0,  color: '#ff4b4b', dark: '#c22424', sound: 'metal' },
  balloon:  { density: 0.05, friction: 0.4,  restitution: 0.3,  color: '#ff6fb5', dark: '#d84a90', burns: true, sound: 'soft' },
  scaffold: { density: 1.4,  friction: 0.9,  restitution: 0.0,  color: '#ffcf2e', dark: '#333333', sound: 'metal' },
};

const rect = (w, h, cx = 0, cy = 0) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
const poly = (pts) => ({ type: 'poly', pts });
const circle = (r) => ({ type: 'circle', r });
// a polygon moved so its centroid (by vertex average) is at the origin
const centred = (pts) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [+(x - cx).toFixed(4), +(y - cy).toFixed(4)]);
};

function starShape(R, r) {
  const outer = [], inner = [];
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + i * (2 * Math.PI / 5);
    outer.push([R * Math.cos(a), R * Math.sin(a)]);
    const b = a + Math.PI / 5;
    inner.push([r * Math.cos(b), r * Math.sin(b)]);
  }
  const parts = [poly(inner)];
  const outline = [];
  for (let i = 0; i < 5; i++) {
    parts.push(poly([inner[(i + 4) % 5], outer[i], inner[i]]));
    outline.push(outer[i], inner[i]);
  }
  return { parts, outline };
}

const wedge = centred([[0, 0], [1.2, 0], [0, 1.2]]);
const ramp = centred([[0, 0], [2, 0], [0, 1]]);
const roof = centred([[-1, 0], [1, 0], [0, 1]]);
const spire = centred([[-0.5, 0], [0.5, 0], [0, 1.6]]);
const star = starShape(0.72, 0.32);

// parts: convex pieces for the physics; outline: the whole silhouette for drawing (omitted when the
// shape is a single polygon); look: how the TV draws it beyond a plain extrusion.
export const SHAPES = {
  cube:     { parts: [poly(rect(1, 1))] },
  brick:    { parts: [poly(rect(1, 0.5))] },
  crate:    { parts: [poly(rect(1.4, 1.4))], look: 'crate' },
  beam:     { parts: [poly(rect(4, 0.5))] },
  shortbeam:{ parts: [poly(rect(2, 0.5))] },
  plank:    { parts: [poly(rect(3, 0.3))] },
  post:     { parts: [poly(rect(0.5, 2))], look: 'column' },
  slab:     { parts: [poly(rect(3, 0.8))] },
  girder:   { parts: [poly(rect(3.5, 0.4))], look: 'girder' },
  wedge:    { parts: [poly(wedge)] },
  ramp:     { parts: [poly(ramp)] },
  roof:     { parts: [poly(roof)] },
  spire:    { parts: [poly(spire)] },
  log:      { parts: [circle(0.45)], look: 'log' },
  ball:     { parts: [circle(0.38)], look: 'ball' },
  arch: {
    parts: [poly(rect(0.55, 0.9, -0.925, -0.2)), poly(rect(0.55, 0.9, 0.925, -0.2)), poly(rect(2.4, 0.4, 0, 0.45))],
    outline: [[-1.2, -0.65], [-0.65, -0.65], [-0.65, 0.25], [0.65, 0.25], [0.65, -0.65], [1.2, -0.65], [1.2, 0.65], [-1.2, 0.65]],
  },
  lblock: {
    parts: [poly(rect(0.5, 1.5, -0.5, 0)), poly(rect(1.0, 0.5, 0.25, -0.5))],
    outline: [[-0.75, -0.75], [0.75, -0.75], [0.75, -0.25], [-0.25, -0.25], [-0.25, 0.75], [-0.75, 0.75]],
  },
  tblock: {
    parts: [poly(rect(2, 0.4, 0, 0.6)), poly(rect(0.5, 1.2, 0, -0.2))],
    outline: [[-0.25, -0.8], [0.25, -0.8], [0.25, 0.4], [1, 0.4], [1, 0.8], [-1, 0.8], [-1, 0.4], [-0.25, 0.4]],
  },
  star:     { parts: star.parts, outline: star.outline, look: 'star' },
  goo:      { parts: [poly(rect(1, 1))], look: 'goo' },
  magnet:   { parts: [poly(rect(1.3, 0.7))], look: 'magnet' },
  balloon:  { parts: [circle(0.55)], look: 'balloon' },
  scaffold: { parts: [poly(rect(0.4, 3.2))], look: 'scaffold' },
  // more shapes, so each level's pieces feel different
  hex: { parts: [poly([[0.6, 0], [0.3, 0.52], [-0.3, 0.52], [-0.6, 0], [-0.3, -0.52], [0.3, -0.52]])] },
  pyramid: { parts: [poly(centred([[-1.2, 0], [1.2, 0], [0, 1.2]]))] },
  cup: {
    parts: [poly(rect(1.6, 0.3, 0, -0.35)), poly(rect(0.3, 0.7, -0.65, 0.15)), poly(rect(0.3, 0.7, 0.65, 0.15))],
    outline: [[-0.8, -0.5], [0.8, -0.5], [0.8, 0.5], [0.5, 0.5], [0.5, -0.2], [-0.5, -0.2], [-0.5, 0.5], [-0.8, 0.5]],
  },
  stairs: {
    parts: [poly(rect(1.8, 0.4, 0, -0.4)), poly(rect(1.2, 0.4, 0.3, 0)), poly(rect(0.6, 0.4, 0.6, 0.4))],
    outline: [[-0.9, -0.6], [0.9, -0.6], [0.9, 0.6], [0.3, 0.6], [0.3, 0.2], [-0.3, 0.2], [-0.3, -0.2], [-0.9, -0.2]],
  },
  plus: {
    parts: [poly(rect(1.5, 0.5)), poly(rect(0.5, 1.5))],
    outline: [[-0.25, -0.75], [0.25, -0.75], [0.25, -0.25], [0.75, -0.25], [0.75, 0.25], [0.25, 0.25], [0.25, 0.75], [-0.25, 0.75], [-0.25, 0.25], [-0.75, 0.25], [-0.75, -0.25], [-0.25, -0.25]],
  },
  tall:     { parts: [poly(rect(0.8, 3))] },
  raft:     { parts: [poly(rect(3.6, 0.4))] },
  // only ever an icon (the Super Claw power-up isn't a piece)
  bolt: {
    parts: [poly(rect(0.8, 1.6))],
    outline: [[0.15, 0.8], [-0.45, -0.05], [-0.05, -0.05], [-0.2, -0.8], [0.45, 0.1], [0.05, 0.1]],
  },
};

// the silhouette of a shape: { pts } for polygons, { r } for circles
export function outlineOf(shapeId) {
  const s = SHAPES[shapeId];
  if (s.outline) return { pts: s.outline };
  const p = s.parts[0];
  return p.type === 'circle' ? { r: p.r } : { pts: p.pts };
}

// half extents of a shape turned by `angle` (for placing it)
export function extentsOf(shapeId, angle = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of SHAPES[shapeId].parts) {
    if (p.type === 'circle') {
      x0 = Math.min(x0, -p.r); x1 = Math.max(x1, p.r); y0 = Math.min(y0, -p.r); y1 = Math.max(y1, p.r);
      continue;
    }
    for (const [x, y] of p.pts) {
      const X = x * c - y * s, Y = x * s + y * c;
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
  }
  return { x0, x1, y0, y1 };
}

export const PIECES = {
  'wood-cube':    { shape: 'cube', mat: 'wood', name: 'Cube' },
  'wood-beam':    { shape: 'beam', mat: 'wood', name: 'Long Beam' },
  'wood-short':   { shape: 'shortbeam', mat: 'wood', name: 'Beam' },
  'wood-plank':   { shape: 'plank', mat: 'wood', name: 'Plank' },
  'wood-wedge':   { shape: 'wedge', mat: 'wood', name: 'Wedge' },
  'wood-post':    { shape: 'post', mat: 'wood', name: 'Pillar' },
  'wood-log':     { shape: 'log', mat: 'wood', name: 'Log' },
  'crate':        { shape: 'crate', mat: 'wood', name: 'Crate' },
  'stone-slab':   { shape: 'slab', mat: 'stone', name: 'Heavy Base' },
  'stone-brick':  { shape: 'brick', mat: 'stone', name: 'Stone Brick' },
  'stone-cube':   { shape: 'cube', mat: 'stone', name: 'Stone Block' },
  'stone-arch':   { shape: 'arch', mat: 'stone', name: 'Arch' },
  'stone-post':   { shape: 'post', mat: 'stone', name: 'Column' },
  'metal-girder': { shape: 'girder', mat: 'metal', name: 'Girder' },
  'metal-l':      { shape: 'lblock', mat: 'metal', name: 'L-Bracket' },
  'metal-t':      { shape: 'tblock', mat: 'metal', name: 'T-Beam' },
  'metal-ramp':   { shape: 'ramp', mat: 'metal', name: 'Ramp' },
  'metal-beam':   { shape: 'shortbeam', mat: 'metal', name: 'Steel Bar' },
  'gold-spire':   { shape: 'spire', mat: 'gold', name: 'Golden Spire' },
  'rubber-ball':  { shape: 'ball', mat: 'rubber', name: 'Bouncy Ball' },
  'rubber-cube':  { shape: 'cube', mat: 'rubber', name: 'Jelly Cube' },
  'foam-star':    { shape: 'star', mat: 'foam', name: 'Star' },
  'foam-cube':    { shape: 'cube', mat: 'foam', name: 'Foam Block' },
  'foam-roof':    { shape: 'roof', mat: 'foam', name: 'Foam Roof' },
  'foam-plank':   { shape: 'plank', mat: 'foam', name: 'Foam Plank' },
  'ice-cube':     { shape: 'cube', mat: 'ice', name: 'Ice Cube' },
  'ice-wedge':    { shape: 'wedge', mat: 'ice', name: 'Ice Wedge' },
  'ice-post':     { shape: 'post', mat: 'ice', name: 'Ice Pillar' },
  'glass-plank':  { shape: 'plank', mat: 'glass', name: 'Glass Plank' },
  'glass-cube':   { shape: 'cube', mat: 'glass', name: 'Glass Block' },
  'clay-brick':   { shape: 'brick', mat: 'clay', name: 'Brick' },
  'clay-roof':    { shape: 'roof', mat: 'clay', name: 'Roof' },
  'clay-arch':    { shape: 'arch', mat: 'clay', name: 'Brick Arch' },
  'clay-beam':    { shape: 'shortbeam', mat: 'clay', name: 'Brick Lintel' },
  'candy-cube':   { shape: 'cube', mat: 'candy', name: 'Candy Cube' },
  'candy-roof':   { shape: 'roof', mat: 'candy', name: 'Candy Roof' },
  'candy-post':   { shape: 'post', mat: 'candy', name: 'Candy Cane' },
  'candy-beam':   { shape: 'shortbeam', mat: 'candy', name: 'Wafer' },
  'candy-spire':  { shape: 'spire', mat: 'candy', name: 'Cone' },
  'wood-hex':     { shape: 'hex', mat: 'wood', name: 'Hex Block' },
  'stone-hex':    { shape: 'hex', mat: 'stone', name: 'Stone Hex' },
  'glass-hex':    { shape: 'hex', mat: 'glass', name: 'Glass Hex' },
  'stone-pyramid':{ shape: 'pyramid', mat: 'stone', name: 'Pyramid' },
  'wood-cup':     { shape: 'cup', mat: 'wood', name: 'Wooden Cup' },
  'metal-cup':    { shape: 'cup', mat: 'metal', name: 'Steel Cup' },
  'wood-stairs':  { shape: 'stairs', mat: 'wood', name: 'Stairs' },
  'clay-stairs':  { shape: 'stairs', mat: 'clay', name: 'Brick Stairs' },
  'stone-plus':   { shape: 'plus', mat: 'stone', name: 'Stone Cross' },
  'metal-plus':   { shape: 'plus', mat: 'metal', name: 'Steel Cross' },
  'wood-tall':    { shape: 'tall', mat: 'wood', name: 'Tall Pillar' },
  'stone-tall':   { shape: 'tall', mat: 'stone', name: 'Tall Column' },
  'wood-raft':    { shape: 'raft', mat: 'wood', name: 'Wide Board' },
  'foam-raft':    { shape: 'raft', mat: 'foam', name: 'Foam Board' },
  // magnetic blocks (Levels mode): opposite poles pull together, the same push apart
  'magn-cube':    { shape: 'cube', mat: 'magN', name: 'North Cube', pole: 1 },
  'mags-cube':    { shape: 'cube', mat: 'magS', name: 'South Cube', pole: -1 },
  'magn-bar':     { shape: 'shortbeam', mat: 'magN', name: 'North Bar', pole: 1 },
  'mags-bar':     { shape: 'shortbeam', mat: 'magS', name: 'South Bar', pole: -1 },
  'magn-post':    { shape: 'post', mat: 'magN', name: 'North Post', pole: 1 },
  'mags-post':    { shape: 'post', mat: 'magS', name: 'South Post', pole: -1 },
  'magn-plate':   { shape: 'plank', mat: 'magN', name: 'North Plate', pole: 1 },
  'mags-plate':   { shape: 'plank', mat: 'magS', name: 'South Plate', pole: -1 },
  // special pieces (power-ups): handed out during a round
  'sp-goo':       { shape: 'goo', mat: 'goo', name: 'Sticky Goo', special: 'sticky', tip: 'Glues itself to every piece it touches' },
  'sp-magnet':    { shape: 'magnet', mat: 'magnet', name: 'Magnet', special: 'magnet', tip: 'Pulls nearby pieces in and holds them' },
  'sp-balloon':   { shape: 'balloon', mat: 'balloon', name: 'Balloon', special: 'balloon', tip: 'Ties onto a piece and lifts it' },
  'sp-scaffold':  { shape: 'scaffold', mat: 'scaffold', name: 'Support Beam', special: 'support', tip: 'Stand it on the ground: it props the tower up for 20 s' },
  'sp-boost':     { shape: 'bolt', mat: 'gold', name: 'Super Claw', special: 'boost', tip: 'Tap it: for 20 s your claw is faster, reels quicker and grips harder', instant: true },
};

export const SPECIAL_IDS = ['sp-goo', 'sp-magnet', 'sp-balloon', 'sp-scaffold', 'sp-boost'];

// one kit per player slot: [piece id, how many]
export const KITS = [
  { name: 'Lumberyard', icon: '🪵', items: [['wood-cube', 5], ['wood-beam', 2], ['wood-short', 3], ['wood-plank', 3], ['wood-wedge', 2], ['wood-post', 3], ['crate', 2]] },
  { name: 'Quarry', icon: '🪨', items: [['stone-slab', 2], ['stone-brick', 6], ['stone-cube', 3], ['stone-arch', 2], ['stone-post', 2], ['wood-plank', 2]] },
  { name: 'Steel Mill', icon: '🔩', items: [['metal-girder', 3], ['metal-l', 3], ['metal-t', 3], ['metal-beam', 3], ['metal-ramp', 2], ['gold-spire', 1]] },
  { name: 'Toy Box', icon: '🧸', items: [['foam-cube', 4], ['rubber-cube', 3], ['rubber-ball', 2], ['foam-star', 2], ['foam-roof', 2], ['foam-plank', 2], ['wood-log', 2]] },
  { name: 'Ice Palace', icon: '❄️', items: [['ice-cube', 4], ['ice-wedge', 3], ['ice-post', 3], ['glass-plank', 3], ['glass-cube', 3]] },
  { name: 'Brickworks', icon: '🧱', items: [['clay-brick', 8], ['clay-beam', 3], ['clay-arch', 2], ['clay-roof', 2]] },
  { name: 'Junkyard', icon: '🛞', items: [['crate', 2], ['wood-log', 2], ['metal-girder', 1], ['stone-slab', 1], ['metal-l', 2], ['wood-plank', 3], ['metal-t', 1], ['rubber-ball', 1]] },
  { name: 'Candy Shop', icon: '🍬', items: [['candy-cube', 4], ['candy-beam', 3], ['candy-post', 3], ['candy-roof', 2], ['rubber-cube', 2], ['candy-spire', 1]] },
];

export const PLAYER_COLORS = [
  { name: 'Red', hex: '#ff4d5e' },
  { name: 'Blue', hex: '#3d8bff' },
  { name: 'Yellow', hex: '#ffc928' },
  { name: 'Green', hex: '#2fd27a' },
  { name: 'Purple', hex: '#a46bff' },
  { name: 'Orange', hex: '#ff8a2b' },
  { name: 'Pink', hex: '#ff6bcb' },
  { name: 'Teal', hex: '#1fd6d0' },
];
