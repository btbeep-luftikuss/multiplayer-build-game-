// Cartoon textures drawn on canvases (no image files). Each covers a 1 m × 1 m tile, since the
// piece geometry's texture coordinates are in metres.
import * as THREE from 'three';

const cache = new Map();

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// a small, repeatable random (so textures look the same every time)
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const shade = (hex, f) => {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return '#' + c.getHexString();
};

function finish(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

const painters = {
  wood(g, S, color, r) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) {
      const y = (i + 0.5) * S / 9 + (r() - 0.5) * 8;
      g.strokeStyle = shade(color, 0.82 + r() * 0.08); g.lineWidth = 3 + r() * 4;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x / 40 + i) * 4);
      g.stroke();
    }
    for (let k = 0; k < 2; k++) {
      const x = r() * S, y = r() * S;
      g.strokeStyle = shade(color, 0.7); g.lineWidth = 3;
      g.beginPath(); g.ellipse(x, y, 14, 6, 0, 0, Math.PI * 2); g.stroke();
    }
  },
  stone(g, S, color, r) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = shade(color, 0.75 + r() * 0.5);
      g.beginPath(); g.arc(r() * S, r() * S, 2 + r() * 6, 0, Math.PI * 2); g.fill();
    }
  },
  metal(g, S, color, r) {
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, shade(color, 1.15)); grad.addColorStop(0.5, color); grad.addColorStop(1, shade(color, 0.85));
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    g.globalAlpha = 0.25;
    for (let i = 0; i < 60; i++) { g.fillStyle = r() < 0.5 ? '#fff' : '#000'; g.fillRect(0, r() * S, S, 1); }
    g.globalAlpha = 1;
    g.fillStyle = shade(color, 0.6);
    for (const [x, y] of [[24, 24], [S - 24, 24], [24, S - 24], [S - 24, S - 24]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  },
  girder(g, S, color) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    g.fillStyle = shade(color, 0.7);
    g.fillRect(0, 0, S, S * 0.12); g.fillRect(0, S * 0.88, S, S * 0.12);
    g.fillStyle = shade(color, 0.55);
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.17, 0, Math.PI * 2); g.fill();
  },
  rubber(g, S, color) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath(); g.ellipse(S * 0.3, S * 0.3, S * 0.18, S * 0.1, -0.5, 0, Math.PI * 2); g.fill();
  },
  foam(g, S, color, r) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = shade(color, 0.88 + r() * 0.05);
      g.beginPath(); g.arc(r() * S, r() * S, 3 + r() * 5, 0, Math.PI * 2); g.fill();
    }
  },
  ice(g, S, color, r) {
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.4, color); grad.addColorStop(1, shade(color, 0.85));
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30 + r() * 30, y - 20 - r() * 30); g.stroke(); }
  },
  glass(g, S, color) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(S * 0.15, S * 0.6); g.lineTo(S * 0.45, S * 0.2); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(S * 0.3, S * 0.75); g.lineTo(S * 0.55, S * 0.4); g.stroke();
  },
  clay(g, S, color, r) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    g.fillStyle = shade(color, 1.25);
    for (let i = 0; i < 4; i++) g.fillRect(0, i * S / 2 + S / 2 - 6, S, 6);
    for (let i = 0; i < 40; i++) { g.fillStyle = shade(color, 0.85 + r() * 0.3); g.fillRect(r() * S, r() * S, 4, 4); }
  },
  candy(g, S, color) {
    g.fillStyle = '#fff7fb'; g.fillRect(0, 0, S, S);
    g.fillStyle = color;
    for (let i = -4; i < 8; i++) {
      g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4 + S / 8, 0); g.lineTo(i * S / 4 + S / 8 + S, S); g.lineTo(i * S / 4 + S, S); g.fill();
    }
  },
  gold(g, S, color) {
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, '#fff2b0'); grad.addColorStop(0.5, color); grad.addColorStop(1, shade(color, 0.8));
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
  },
  goo(g, S, color, r) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(r() * S, r() * S, 6 + r() * 16, 0, Math.PI * 2); g.fill();
    }
  },
  magnet(g, S, color) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, S * 0.15, S, S * 0.12);
  },
  balloon(g, S, color) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
  },
  scaffold(g, S) {
    g.fillStyle = '#ffcf2e'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#2b2b2b';
    for (let i = -4; i < 8; i++) {
      g.beginPath(); g.moveTo(i * S / 3, 0); g.lineTo(i * S / 3 + S / 6, 0); g.lineTo(i * S / 3 + S / 6 + S, S); g.lineTo(i * S / 3 + S, S); g.fill();
    }
  },
  crate(g, S, color) {
    g.fillStyle = color; g.fillRect(0, 0, S, S);
    g.strokeStyle = shade(color, 0.6); g.lineWidth = 10;
    g.strokeRect(10, 10, S - 20, S - 20);
    g.beginPath(); g.moveTo(14, 14); g.lineTo(S - 14, S - 14); g.stroke();
    g.lineWidth = 3;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(10, i * S / 4); g.lineTo(S - 10, i * S / 4); g.stroke(); }
  },
};

// a texture for a material (or a look such as 'crate')
export function materialTexture(kind, color) {
  const key = kind + color;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(256);
  (painters[kind] || painters.rubber)(g, 256, color, rng(kind.length * 97 + 13));
  const t = finish(c, kind === 'crate' ? 1 / 1.4 : 1);
  cache.set(key, t);
  return t;
}

// hazard stripes (pad edges, the top bar)
export function stripesTexture(a = '#ffc21a', b = '#2a2a2a', n = 4) {
  const key = 'stripes' + a + b + n;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(128);
  g.fillStyle = a; g.fillRect(0, 0, 128, 128);
  g.fillStyle = b;
  for (let i = -n; i < n * 2; i++) {
    const w = 128 / n;
    g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w + w / 2, 0); g.lineTo(i * w + w / 2 + 128, 128); g.lineTo(i * w + 128, 128); g.fill();
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function checkerTexture() {
  if (cache.has('checker')) return cache.get('checker');
  const [c, g] = canvas(64);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#ffffff' : '#1d1d2b'; g.fillRect(i * 32, j * 32, 32, 32); }
  const t = finish(c);
  t.magFilter = THREE.NearestFilter;
  cache.set('checker', t);
  return t;
}

// the finish line: a row of round dots (one per 0.6 m tile)
export function dotsTexture() {
  if (cache.has('dots')) return cache.get('dots');
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.strokeStyle = '#1d1d2b'; g.lineWidth = 7;
  g.beginPath(); g.arc(64, 32, 22, 0, Math.PI * 2); g.fill(); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  cache.set('dots', t);
  return t;
}

export function grassTexture() {
  if (cache.has('grass')) return cache.get('grass');
  const [c, g] = canvas(256);
  const r = rng(7);
  g.fillStyle = '#6fd25a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) { g.fillStyle = r() < 0.5 ? '#63c450' : '#7fde68'; g.fillRect(r() * 256, r() * 256, 3, 8); }
  const t = finish(c);
  cache.set('grass', t);
  return t;
}

export function dirtTexture() {
  if (cache.has('dirt')) return cache.get('dirt');
  const [c, g] = canvas(256);
  const r = rng(11);
  g.fillStyle = '#b07a4f'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 120; i++) { g.fillStyle = r() < 0.5 ? '#9a6942' : '#c18a5c'; g.beginPath(); g.arc(r() * 256, r() * 256, 3 + r() * 7, 0, Math.PI * 2); g.fill(); }
  const t = finish(c);
  cache.set('dirt', t);
  return t;
}

export function concreteTexture() {
  if (cache.has('concrete')) return cache.get('concrete');
  const [c, g] = canvas(256);
  const r = rng(5);
  g.fillStyle = '#d9d4cc'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 200; i++) { g.fillStyle = r() < 0.5 ? '#cfc9c0' : '#e3dfd8'; g.beginPath(); g.arc(r() * 256, r() * 256, 1 + r() * 3, 0, Math.PI * 2); g.fill(); }
  const t = finish(c);
  cache.set('concrete', t);
  return t;
}

// a painted sign: text on a coloured board
export function signTexture(text, bg, fg = '#ffffff', w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `900 ${Math.round(h * 0.55)}px "Baloo 2", "Arial Rounded MT Bold", system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.04, w * 0.92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// the toon shading ramp: three flat bands of light
export function toonRamp() {
  if (cache.has('ramp')) return cache.get('ramp');
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  cache.set('ramp', t);
  return t;
}
