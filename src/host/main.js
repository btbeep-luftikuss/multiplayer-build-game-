// The TV: runs the game, draws it, plays the sound, and talks to the phones.
import { Game } from '../sim/game.js';
import { STEP } from '../sim/sim.js';
import { PIECES } from '../shared/pieces.js';
import { createHost, randomCode, cleanCode } from '../net/net.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Sound } from './audio.js';
import css from '../styles/tv.css';

const params = new URLSearchParams(location.search);
const local = params.has('local');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('claw-' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('claw-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const session = {
  get(k) { try { return sessionStorage.getItem('claw-' + k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem('claw-' + k, v); } catch { /* private mode */ } },
};

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
document.body.className = 'tv';
document.body.innerHTML = '<canvas id="view"></canvas><div id="ui"></div>';
const canvas = document.getElementById('view');

let quality = params.get('quality') || store.get('quality') || 'high';
// Levels mode progress lives on the TV (which levels are unlocked and done, the best team times)
const game = new Game({ settings: store.get('settings') || undefined, progress: store.get('progress'), mode: store.get('mode') || 'free', level: store.get('level') ?? 1 });
let renderer;
try {
  renderer = new Renderer(canvas, { quality });
} catch (err) {
  document.body.innerHTML = `<div class="nogl"><h1>This screen can't show the game</h1><p>Its browser can't draw 3D graphics (WebGL). Try Chrome, Edge, Firefox or Safari on a computer or a streaming stick connected to the TV.</p><p class="small">${String(err && err.message || err).replace(/[<>&]/g, '')}</p></div>`;
  throw err;
}
const sound = new Sound();
sound.setMuted(!!store.get('muted'));
sound.setMusic(store.get('music') !== false);

const hud = new Hud(document.getElementById('ui'), {
  start: () => startOrRestart(),
  lobby: () => game.toLobby(),
  next: () => game.nextLevel(),
  mode: (m) => game.setMode(m),
  level: (id) => game.setLevel(id),
  setting: (k, v) => { if (game.setSetting(k, v)) store.set('settings', game.settings); },
  menu: (act, btn) => {
    if (act === 'restart') game.startRound();
    else if (act === 'lobby') game.toLobby();
    else if (act === 'sound') { sound.setMuted(!sound.muted); store.set('muted', sound.muted); }
    else if (act === 'music') { sound.setMusic(!sound.musicOn); store.set('music', sound.musicOn); }
    else if (act === 'quality') {
      quality = quality === 'high' ? 'low' : 'high';
      store.set('quality', quality);
      location.reload();
    } else if (act === 'fullscreen') toggleFullscreen();
    updateMenuLabels();
    void btn;
  },
});
function updateMenuLabels() {
  const m = document.getElementById('menu');
  m.querySelector('[data-act=sound]').textContent = `Sound: ${sound.muted ? 'off' : 'on'}`;
  m.querySelector('[data-act=music]').textContent = `Music: ${sound.musicOn ? 'on' : 'off'}`;
  m.querySelector('[data-act=quality]').textContent = `Graphics: ${quality}`;
}
updateMenuLabels();

function startOrRestart() {
  if (game.phase === 'lobby' || game.phase === 'result') game.startRound();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// ---------- sound needs a click or key press first ----------
hud.setSoundHint(true);
const unlock = () => { sound.unlock(); if (sound.ready) hud.setSoundHint(false); };
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// ---------- the room ----------
const savedCode = cleanCode(session.get('room'));
let code = savedCode.length === 4 ? savedCode : randomCode();
const lastSent = new Map(); // player id -> what the phone last got

function joinUrl(c) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', c);
  if (local) u.searchParams.set('local', '');
  return u.toString().replace(/=(&|$)/g, '$1');
}

const net = createHost({
  code, local, keep: savedCode.length === 4,
  onReady: (c) => { code = c; session.set('room', c); hud.setJoin(joinUrl(c), c); },
  onJoin: (cid, hello) => {
    const p = game.addPlayer(cid, hello.name);
    if (!p) { net.send(cid, { t: 'full' }); return; }
    lastSent.set(cid, { inv: -1, cfg: '' });
    net.send(cid, { t: 'welcome', slot: p.slot, name: p.name, color: p.color, colorName: p.colorName, kit: p.kit.name, icon: p.kit.icon, code });
    sendInventory(p);
    sendSettings(p);
    if (game.result && game.phase === 'result') net.send(cid, resultFor(p));
  },
  onMessage: (cid, m) => onPhone(cid, m),
  onLeave: (cid) => game.setConnected(cid, false),
  onStatus: (s) => { document.body.dataset.net = s; hud.setNet(s); },
});

function onPhone(cid, m) {
  const p = game.players.get(cid);
  if (!p || typeof m.t !== 'string') return;
  if (!p.connected) game.setConnected(cid, true);
  const leader = game.isLeader(cid);
  switch (m.t) {
    case 'in': game.input(cid, Number(m.mx), Number(m.ry)); break;
    case 'grab': game.grab(cid); break;
    case 'drop': game.drop(cid); break;
    case 'rot': game.rotate(cid, Number(m.d)); break;
    case 'rotEnd': game.rotateEnd(cid); break;
    case 'spawn': game.spawn(cid, Number(m.k) | 0, Number(m.a) || 0); break;
    case 'name': game.rename(cid, m.name); break;
    case 'set': if (leader && game.setSetting(m.key, m.val)) store.set('settings', game.settings); break;
    case 'start': if (leader) startOrRestart(); break;
    case 'restart': if (leader && (game.phase === 'play' || game.phase === 'countdown' || game.phase === 'hold')) game.startRound(); break;
    case 'lobby': if (leader && game.phase === 'result') game.toLobby(); break;
    case 'next': if (leader) game.nextLevel(); break;
    case 'mode': if (leader) game.setMode(m.m); break;
    case 'level': if (leader) game.setLevel(m.id === 'remix' ? 'remix' : Number(m.id)); break;
    default: break;
  }
}

function sendInventory(p) {
  const inv = game.inventoryFor(p.id);
  if (!inv) return;
  net.send(p.id, inv);
  const s = lastSent.get(p.id);
  if (s) s.inv = p.invVersion;
}

const cfgKeyNow = () => JSON.stringify([game.settings, game.mode, game.levelId, game.progress]);
function sendSettings(p) {
  const key = cfgKeyNow();
  net.send(p.id, { t: 'cfg', settings: game.settings, lv: game.levelsInfo() });
  const s = lastSent.get(p.id);
  if (s) s.cfg = key;
}

function resultFor(p) {
  const r = game.result;
  const me = r.players.find((x) => x.slot === p.slot);
  const lv = r.level ? { id: r.level.id, name: r.level.name, time: r.level.time, best: !!r.newBest, unlocked: r.unlocked || null, next: r.next || null } : null;
  return { t: 'res', lv, ok: r.success, early: r.early, left: Math.ceil(r.timeLeft), h: r.height, f: Math.round(r.finish * 10) / 10, stars: r.stars, placed: me?.placed || 0, awards: r.awards.filter((a) => a.slot === p.slot).map((a) => a.title) };
}

const BUZZ = { grab: [25, 30, 25], miss: [70], release: [15], lock: [10, 25, 10] };

function relay(e) {
  const bySlot = (slot) => { for (const p of game.players.values()) if (p.slot === slot) return p; return null; };
  if (e.type === 'toast') { net.send(e.id, { t: 'toast', text: e.text, big: e.big }); return; }
  if (e.type === 'progress') { store.set('progress', e.progress); return; }
  if (e.type === 'settings') { store.set('mode', game.mode); store.set('level', game.levelId); }
  if (e.type === 'glitch') {
    const p = bySlot(e.slot);
    if (p) { net.send(p.id, { t: 'buzz', p: [120, 40, 60] }); net.send(p.id, { t: 'toast', text: { slip: 'Your grip slipped!', stretch: 'Your rope stretched!', drop: 'Your claw let go!' }[e.kind] }); }
  }
  if (e.type === 'boost') { const p = bySlot(e.slot); if (p) net.send(p.id, { t: 'buzz', p: [30, 30, 30, 30, 200] }); }
  if (BUZZ[e.type] && e.slot !== undefined) { const p = bySlot(e.slot); if (p) net.send(p.id, { t: 'buzz', p: BUZZ[e.type] }); }
  if (e.type === 'powerup') { const p = bySlot(e.slot); if (p) net.send(p.id, { t: 'buzz', p: [40, 60, 40, 60, 120] }); }
  const all = (msg) => { for (const p of game.players.values()) if (p.connected) net.send(p.id, msg); };
  if (e.type === 'go') all({ t: 'buzz', p: [200] });
  if (e.type === 'timeup' || e.type === 'hold') all({ t: 'buzz', p: [300] });
  if (e.type === 'holdfail') all({ t: 'buzz', p: [150, 80, 150] });
  if (e.type === 'collapse') all({ t: 'buzz', p: [150, 80, 150] });
  if (e.type === 'result') for (const p of game.players.values()) if (p.connected) { net.send(p.id, resultFor(p)); net.send(p.id, { t: 'buzz', p: e.result.success ? [50, 50, 50, 50, 250] : [500] }); }
}

// status to every phone, ten times a second
setInterval(() => {
  const cfgKey = cfgKeyNow();
  for (const p of game.players.values()) {
    if (!p.connected) continue;
    const s = lastSent.get(p.id);
    if (s && s.inv !== p.invVersion) sendInventory(p);
    if (s && s.cfg !== cfgKey) sendSettings(p);
    net.send(p.id, game.statusFor(p.id), true);
  }
}, 100);

// ---------- a keyboard player, for trying the game without a phone (add ?keys to the address) ----------
const keys = new Set();
if (params.has('keys')) {
  game.addPlayer('keyboard', 'Keys');
  lastSent.set('keyboard', { inv: -1, cfg: '' });
}
addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  const k = ev.key.toLowerCase();
  if (k === 'escape') { hud.toggleMenu(); return; }
  if (hud.menuOpen) return;
  if (k === 'enter' && (game.phase === 'lobby' || game.phase === 'result')) { startOrRestart(); return; }
  if (k === 'f' && !game.players.has('keyboard')) { toggleFullscreen(); return; }
  if (!game.players.has('keyboard')) return;
  keys.add(k);
  if (k === ' ') game.grab('keyboard');
  if (k === 'x') game.drop('keyboard');
  if (k === 'q') game.rotate('keyboard', 1);
  if (k === 'e') game.rotate('keyboard', -1);
  if (/^[1-9]$/.test(k)) game.spawn('keyboard', Number(k) - 1, 0);
  if (k === ' ' || k.startsWith('arrow')) ev.preventDefault();
});
addEventListener('keyup', (ev) => {
  const k = ev.key.toLowerCase();
  keys.delete(k);
  if ((k === 'q' || k === 'e') && game.players.has('keyboard')) game.rotateEnd('keyboard');
});
function keyboardInput() {
  if (!game.players.has('keyboard')) return;
  const mx = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
  const ry = (keys.has('arrowup') || keys.has('w') ? 1 : 0) - (keys.has('arrowdown') || keys.has('s') ? 1 : 0);
  game.input('keyboard', mx, ry);
}

// ---------- the loop ----------
addEventListener('resize', () => renderer.resize());
let last = performance.now(), acc = 0, creakT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  keyboardInput();
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) { game.step(STEP); acc -= STEP; steps++; }
  if (steps === 5) acc = 0;
  for (const e of game.drainEvents()) {
    renderer.onEvent(e, game);
    hud.onEvent(e, game, renderer);
    sound.onEvent(e);
    relay(e);
  }
  // rope sounds: a whirr while reeling, a creak under strain
  let reel = 0, strain = 0;
  for (const c of game.sim.claws.values()) { reel += Math.abs(c.reeling); strain = Math.max(strain, c.tension()); }
  sound.setReel(reel);
  creakT -= dt;
  if (strain > 0.8 && creakT <= 0) { sound.creak(); creakT = 0.6 + Math.random(); }
  renderer.update(dt, game);
  hud.update(game, renderer, dt);
  renderer.render();
}
requestAnimationFrame(frame);

// for automated tests and the curious
window.__claw = { game, renderer, hud, sound, net, PIECES };
