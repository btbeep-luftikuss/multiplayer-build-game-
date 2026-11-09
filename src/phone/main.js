// The phone: a touch controller for one claw. It shows your pieces, sends your moves to the TV,
// and shows what your claw is doing. Nothing is simulated here.
import { joinRoom, cleanCode } from '../net/net.js';
import { PIECES, SHAPES, MATERIALS, outlineOf } from '../shared/pieces.js';
import css from '../styles/phone.css';

const params = new URLSearchParams(location.search);
const local = params.has('local');
const store = {
  get(k) { try { return localStorage.getItem('claw-' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('claw-' + k, v); } catch { /* private mode */ } },
};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* no vibration */ } };

// who this phone is, kept across reloads (so a reload gets the same claw back). In local mode several
// tabs on one computer are different players, so each tab keeps its own.
const idStore = local ? { get: (k) => { try { return sessionStorage.getItem('claw-' + k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem('claw-' + k, v); } catch { /* private */ } } } : store;
let cid = idStore.get('cid');
if (!cid) { cid = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8); idStore.set('cid', cid); }
const FUN_NAMES = ['Hook', 'Grabby', 'Pinchy', 'Claws', 'Crane', 'Winch', 'Clamp', 'Stacker', 'Wobbles', 'Tilt'];

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
document.body.className = 'phone';
document.body.innerHTML = `
<div id="join" class="screen">
  <h1 class="logo"><span>CLAW</span>STRUCTION</h1>
  <p class="sub">Your phone is the controller. Look at the TV!</p>
  <label>Room code<input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD"></label>
  <label>Your name<input id="name" maxlength="12" autocomplete="nickname" spellcheck="false"></label>
  <button id="go" class="big">Join the game</button>
  <p class="err" id="join-err"></p>
  <a class="host-link" href="?tv">Host the game on this screen instead</a>
  <p class="keys-hint">On a computer: arrow keys or WASD move the claw and rope, Space grabs, X drops, Q/E turn, 1–9 take a piece.</p>
</div>
<div id="pad" class="screen">
  <header>
    <div class="me"><span class="dot"></span><span class="nm"></span></div>
    <div class="clock">0:00</div>
    <div class="hgt"></div>
    <button class="menu-btn" aria-label="Menu">⋯</button>
  </header>
  <div class="status">
    <div class="claw-state">OPEN</div>
    <div class="meter rope"><span>rope</span><i></i></div>
    <div class="meter grip"><span>grip</span><i></i></div>
  </div>
  <div class="leader-bar"></div>
  <div class="inventory">
    <button class="angle" aria-label="Turn new pieces"><svg viewBox="-1 -1 2 2"><path d="M-0.6 0.1 A0.6 0.6 0 1 1 -0.1 0.6" fill="none" stroke="currentColor" stroke-width="0.18"/><path d="M-0.95 -0.15 L-0.6 0.35 L-0.25 -0.1 Z" fill="currentColor"/></svg><b>0°</b></button>
    <div class="cards"></div>
  </div>
  <div class="sticks">
    <div class="stick both"><div class="label"><span class="v">▲ rope up</span><span class="h">◀ MOVE ▶</span><span class="v">▼ rope down</span></div><div class="rail h"></div><div class="rail v"></div><div class="knob"></div></div>
  </div>
  <div class="buttons">
    <button class="turn ccw" data-d="1">⟲<small>turn</small></button>
    <button class="drop">⤓<small>drop</small></button>
    <button class="turn cw" data-d="-1">⟳<small>turn</small></button>
    <button class="grab">GRAB</button>
  </div>
</div>
<div id="overlay" class="sheet"></div>
<div id="toast"></div>
<div id="count"></div>`;

const codeIn = $('#code'), nameIn = $('#name');
codeIn.value = cleanCode(params.get('join') || store.get('code') || '');
nameIn.value = store.get('name') || FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)];
codeIn.addEventListener('input', () => { codeIn.value = cleanCode(codeIn.value); });

let link = null;
let me = null;          // welcome info
let st = null;          // the latest status
let inv = { items: [] };
let cfg = null;
let result = null;
let spawnAngle = 0;     // in 45° steps
let connState = 'idle';

function show(screen) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === screen);
}

function join() {
  const code = cleanCode(codeIn.value);
  const name = nameIn.value.trim().slice(0, 12) || FUN_NAMES[0];
  if (code.length !== 4) { $('#join-err').textContent = 'The room code has 4 letters (it\'s on the TV).'; return; }
  store.set('code', code);
  store.set('name', name);
  $('#join-err').textContent = '';
  if (link) link.close();
  connState = 'connecting';
  renderOverlay();
  link = joinRoom({
    code, local, hello: { cid, name }, relays: params.get('relay') ? params.get('relay').split(',') : undefined,
    onMessage: onMessage,
    onStatus: (s, detail) => { connState = s; connDetail = detail || (s === 'open' ? 'hello' : connDetail); if (s === 'connecting' && !connSince) connSince = Date.now(); renderOverlay(); },
    onClose: () => { connState = 'reconnecting'; renderOverlay(); },
  });
  show('pad');
  keepAwake();
  history.replaceState(null, '', `?join=${code}${local ? '&local' : ''}`);
}
$('#go').onclick = join;
nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.focus(); });

function send(msg) { link?.send(msg); }

// ---------- what the TV says ----------

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      me = m;
      connSince = 0;
      document.documentElement.style.setProperty('--me', m.color);
      $('#pad .nm').textContent = m.name;
      connState = 'open';
      renderOverlay();
      toast(`You're the ${m.colorName} claw! ${m.icon} ${m.kit} kit`);
      break;
    case 'full': connState = 'full'; renderOverlay(); break;
    case 'st': onStatus(m); break;
    case 'inv': inv = m; renderCards(); break;
    case 'cfg': cfg = m.settings; lvInfo = m.lv || null; renderLeaderBar(); renderOverlay(); break;
    case 'toast': toast(m.text, m.big); break;
    case 'buzz': if (Array.isArray(m.p)) buzz(m.p.slice(0, 10)); break;
    case 'res': result = m; renderOverlay(); break;
    default: break;
  }
}

function onStatus(s) {
  const prev = st;
  st = s;
  $('#pad .clock').textContent = s.ph === 'lobby' ? 'warm-up' : s.ph === 'judge' || s.ph === 'hold' ? 'hands off!' : fmtTime(s.tl);
  $('#pad .clock').classList.toggle('hurry', s.ph === 'play' && s.tl <= 30);
  $('#pad .hgt').innerHTML = `<b>${s.h.toFixed(1)}</b>/${s.f} m`;
  $('#pad .hgt').classList.toggle('over', s.h >= s.f);
  const state = $('#pad .claw-state');
  state.className = 'claw-state ' + ['open', 'closed', 'holding'][s.g];
  state.innerHTML = (s.bo ? `⚡${s.bo} ` : '') + (s.g === 2 ? `✊ ${esc(s.hn)}` : s.g === 1 ? '✊ closed' : '✋ open');
  const grab = $('#pad .grab');
  grab.textContent = s.g === 2 ? 'LET GO' : s.g === 1 ? 'OPEN' : 'GRAB';
  grab.classList.toggle('holding', s.g === 2);
  $('#pad .drop').classList.toggle('busy', s.au);
  for (const t of document.querySelectorAll('#pad .turn')) t.classList.toggle('off', s.g === 2); // only on the shelf
  meter('.rope', s.tn);
  meter('.grip', s.g === 2 ? s.sn : 0);
  $('#pad .grip').classList.toggle('off', s.g !== 2);
  // big numbers for the countdown
  const count = $('#count');
  if (s.ph === 'countdown') { count.textContent = s.cd; count.className = 'show'; }
  else if (s.ph === 'hold') { count.innerHTML = `${s.cd}<small>hands off!</small>`; count.className = 'show hold'; }
  else if (prev?.ph === 'countdown' && s.ph === 'play') { count.textContent = 'GO!'; count.className = 'show go'; setTimeout(() => { if (st.ph === 'play') count.className = ''; }, 900); }
  else if (s.ph !== 'play' || !count.classList.contains('go')) count.className = '';
  $('#pad .inventory').classList.toggle('busy', !!s.sb);
  if (s.ph !== 'result') { result = null; resultHidden = false; }
  if (!prev || prev.ph !== s.ph || prev.ld !== s.ld || prev.free !== s.free || prev.lv !== s.lv) { renderLeaderBar(); renderCards(); renderOverlay(); }
}

function meter(sel, v) {
  const i = $(`#pad .meter${sel} i`);
  i.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
  i.style.background = v > 0.75 ? '#ff4d5e' : v > 0.45 ? '#ffb21e' : '#2fd27a';
}

// ---------- pieces ----------

function pieceIcon(id, angle) {
  const def = PIECES[id];
  const m = MATERIALS[def.mat];
  const out = outlineOf(def.shape);
  const deg = -angle * 45;
  let body;
  if (out.r) body = `<circle r="${out.r}" />`;
  else body = `<polygon points="${out.pts.map(([x, y]) => `${x},${-y}`).join(' ')}" />`;
  const look = SHAPES[def.shape].look;
  const extra = look === 'balloon' ? `<path d="M0 ${out.r} q0.15 0.3 0 0.5" fill="none" stroke="#1e1533" stroke-width="0.06"/>` : '';
  // small pieces drawn a bit bigger than life, so they're easy to see (but still smaller than beams)
  const size = out.r ? out.r * 2 : Math.max(...out.pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) * 2;
  const box = Math.max(1.9, size * 1.12);
  return `<svg viewBox="${-box / 2} ${-box / 2} ${box} ${box}"><g transform="rotate(${deg})" fill="${m.color}" stroke="#1e1533" stroke-width="0.09" stroke-linejoin="round">${body}</g>${extra}</svg>`;
}

function renderCards() {
  const box = $('#pad .cards');
  const free = st?.free;
  box.innerHTML = '';
  inv.items.forEach((it, k) => {
    const def = PIECES[it.id];
    if (!def) return;
    const b = document.createElement('button');
    b.className = 'card' + (it.sp ? ' special' : '') + (!free && it.n <= 0 ? ' empty' : '');
    b.innerHTML = `${pieceIcon(it.id, spawnAngle)}<span class="nm">${esc(def.name)}</span><span class="n">${free ? '∞' : '×' + it.n}</span>`;
    b.onclick = () => {
      if (!free && it.n <= 0) { toast(`No ${def.name} left`); return; }
      if (st?.sb) { toast('Pick up the piece on your shelf first'); buzz(40); return; }
      send({ t: 'spawn', k, a: spawnAngle * Math.PI / 4 });
      buzz(12);
      b.classList.remove('tapped'); void b.offsetWidth; b.classList.add('tapped');
    };
    box.appendChild(b);
  });
  $('#pad .angle b').textContent = `${spawnAngle * 45}°`;
}

$('#pad .angle').onclick = () => { spawnAngle = (spawnAngle + 1) % 8; renderCards(); buzz(8); };

// ---------- the sticks ----------

const input = { mx: 0, ry: 0, sentMx: 0, sentRy: 0, sentAt: 0 };

// one big pad: drag left/right to move the claw, up/down to reel the rope, diagonally for both.
// It works from wherever the thumb lands, so there's no need to look at it.
function stick(el) {
  const knob = el.querySelector('.knob');
  let id = null, x0 = 0, y0 = 0;
  const range = () => Math.min(90, Math.min(el.clientWidth, el.clientHeight) * 0.3);
  // each direction has its own small dead zone, so moving sideways doesn't nudge the rope
  const shape = (v) => { const dead = 0.15; return Math.abs(v) < dead ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - dead) / (1 - dead)); };
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    try { el.setPointerCapture(id); } catch { /* some browsers refuse; the pad still works without it */ }
    const r = el.getBoundingClientRect();
    x0 = e.clientX; y0 = e.clientY;
    el.classList.add('active');
    knob.style.left = `${x0 - r.left}px`; knob.style.top = `${y0 - r.top}px`;
    el.style.setProperty('--ox', `${x0 - r.left}px`); el.style.setProperty('--oy', `${y0 - r.top}px`);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const r = el.getBoundingClientRect();
    const R = range();
    let dx = e.clientX - x0, dy = e.clientY - y0;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.left = `${x0 - r.left + dx}px`; knob.style.top = `${y0 - r.top + dy}px`;
    input.mx = shape(dx / R);
    input.ry = shape(-dy / R);
    pushInput();
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    el.classList.remove('active');
    input.mx = 0; input.ry = 0;
    pushInput();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
stick($('#pad .stick.both'));

function pushInput(force = false) {
  const now = performance.now();
  const changed = Math.abs(input.mx - input.sentMx) > 0.04 || Math.abs(input.ry - input.sentRy) > 0.04;
  const zeroed = (input.mx === 0 && input.sentMx !== 0) || (input.ry === 0 && input.sentRy !== 0);
  if (force || zeroed || (changed && now - input.sentAt > 33)) {
    send({ t: 'in', mx: Math.round(input.mx * 100) / 100, ry: Math.round(input.ry * 100) / 100 });
    input.sentMx = input.mx; input.sentRy = input.ry; input.sentAt = now;
  }
}
// keep the TV in step even if a message goes missing
setInterval(() => { if (input.mx || input.ry || input.sentMx || input.sentRy) pushInput(true); }, 200);

// ---------- buttons ----------

function press(el, down, up) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('down'); buzz(10); down(); });
  const release = () => { if (el.classList.contains('down')) { el.classList.remove('down'); up?.(); } };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
}
press($('#pad .grab'), () => send({ t: 'grab' }));
press($('#pad .drop'), () => send({ t: 'drop' }));
for (const b of document.querySelectorAll('#pad .turn')) press(b, () => send({ t: 'rot', d: Number(b.dataset.d) }), () => send({ t: 'rotEnd' }));
$('#pad .menu-btn').onclick = () => { menuOpen = !menuOpen; renderOverlay(); };

// ---------- the leader's controls ----------

const SETTINGS = {
  roundTime: { title: 'Round time', opts: [120, 180, 240, 300, 360], show: fmtTime },
  difficulty: { title: 'Finish line', opts: ['easy', 'normal', 'hard'], show: (v) => ({ easy: 'Low', normal: 'Medium', hard: 'High' }[v]) },
  powerups: { title: 'Power-ups', opts: [true, false], show: (v) => (v ? 'On' : 'Off') },
};
let menuOpen = false;
let settingsOpen = false;
let connDetail = '';   // how far the connection got: server, tv, hello
let connSince = 0;
let lvInfo = null;      // Levels mode: which levels there are, which are unlocked and done
let resultHidden = false; // the results were put away to smash the tower

function renderLeaderBar() {
  const bar = $('#pad .leader-bar');
  if (!st) { bar.innerHTML = ''; return; }
  if (st.ph === 'lobby') {
    const what = st.md === 'levels' && st.lv ? `<div class="lvname">${esc(st.lv)}</div>` : '';
    bar.innerHTML = what + (st.ld
      ? `<button class="start">▶ START</button><button class="settings">⚙ ${st.md === 'levels' ? 'Levels' : 'Settings'}</button>`
      : `<div class="wait">Warm up! The leader starts the round.</div>`);
  } else if (st.ph === 'result' && resultHidden) {
    bar.innerHTML = `<button class="settings" data-bar="results">🏁 Results</button>` + (st.ld ? `<button class="start" data-bar="again">▶ Again</button>` : '');
  } else bar.innerHTML = '';
  bar.querySelector('[data-bar=results]')?.addEventListener('click', () => { resultHidden = false; renderOverlay(); renderLeaderBar(); });
  bar.querySelector('[data-bar=again]')?.addEventListener('click', () => send({ t: 'start' }));
  bar.querySelector('.start')?.addEventListener('click', () => send({ t: 'start' }));
  bar.querySelector('.settings')?.addEventListener('click', () => { settingsOpen = true; renderOverlay(); });
}

function renderOverlay() {
  const o = $('#overlay');
  let html = '';
  if (connState === 'full') html = `<h2>The game is full</h2><p>Eight claws are already taken. Try again when someone leaves.</p><button class="big" data-act="retry">Try again</button>`;
  else if (connState === 'noroom') html = `<h2>No game with code ${esc(cleanCode(codeIn.value))}</h2><p>Check the code on the TV. Still trying…</p><button data-act="code">Change the code</button>`;
  else if (connState === 'offline') html = `<h2>Can't reach the internet</h2><p>Phones need Wi-Fi or data to find the TV. Still trying…</p><button data-act="code">Change the code</button>`;
  else if (connState === 'connecting' || connState === 'reconnecting' || (connState === 'open' && !me)) {
    // say which step it's on, so a stuck connection can be told apart
    const steps = [['server', 'Reaching the game server'], ['tv', `Looking for the TV (room ${esc(cleanCode(codeIn.value))})`], ['hello', 'Connected: waiting for the TV to answer']];
    if (connDetail === 'relay') steps[1] = ['relay', `Trying the backup route to the TV (room ${esc(cleanCode(codeIn.value))})`];
    const link = connDetail.startsWith('link:') ? connDetail.slice(5) : '';
    const at = connState === 'open' ? 2 : link ? 1 : Math.max(0, steps.findIndex(([k]) => k === connDetail));
    const slow = connSince && Date.now() - connSince > 20000;
    html = `<div class="spinner"></div><h2>${connState === 'reconnecting' ? 'Reconnecting…' : 'Connecting to the TV…'}</h2>` +
      `<ol class="steps">${steps.map(([, t], i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${t}</li>`).join('')}</ol>` +
      (link ? `<p class="small">Line to the TV: <b>${esc({ new: 'starting', checking: 'trying the ways through', connected: 'connected', completed: 'connected', failed: 'no way through (the network blocks it)', disconnected: 'dropped', closed: 'closed' }[link] || link)}</b></p>` : '') +
      (slow ? `<p class="small">${link === 'failed' ? 'The TV and this device can\'t reach each other on this network: try both on the same Wi-Fi, or turn off a VPN, Private Relay or Lockdown Mode on this device.' : at === 0 ? 'The game server can\'t be reached: check this device\'s Wi-Fi, and try turning off a VPN, Private Relay or content blocker.' : at === 1 ? 'The TV isn\'t answering: check the room code on the TV, and that the TV page is still open.' : 'The TV saw you but hasn\'t answered: reload the TV page and try again.'}</p>` : '') +
      `<button data-act="retry">Try again</button><button data-act="code">Change the code</button>`;
  }
  else if (settingsOpen && st?.ld && cfg) {
    const mode = lvInfo?.mode || 'free';
    html = `<h2>Game mode</h2><div class="setting"><div class="opts"><button class="${mode === 'free' ? 'sel' : ''}" data-mode="free">Free Play</button><button class="${mode === 'levels' ? 'sel' : ''}" data-mode="levels">Levels</button></div></div>`;
    if (mode === 'levels' && lvInfo) {
      html += '<div class="levels">' + lvInfo.list.map((l) => {
        const locked = l.id > lvInfo.unlocked;
        return `<button class="lv ${lvInfo.level === l.id ? 'sel' : ''} ${l.done ? 'done' : ''}" ${locked ? 'disabled' : ''} data-level="${l.id}"><b>${l.id}</b> ${locked ? '🔒' : l.icon} ${esc(l.name)}${l.done ? ` <span class="best">✓ ${l.best !== null ? fmtTime(l.best) : ''}</span>` : ''}</button>`;
      }).join('') + `<button class="lv ${lvInfo.level === 'remix' ? 'sel' : ''}" ${lvInfo.remix ? '' : 'disabled'} data-level="remix">${lvInfo.remix ? '🎲' : '🔒'} Endless Remix${lvInfo.remix ? ` <span class="best">${lvInfo.remixWins} won</span>` : ' <span class="best">beat Level 10</span>'}</button></div>`;
      html += '<button class="big" data-act="close">Done</button>';
    } else html += '<h2>Settings</h2>' + Object.entries(SETTINGS).map(([k, s]) => `<div class="setting"><div class="t">${s.title}</div><div class="opts">${s.opts.map((v) => `<button class="${cfg[k] === v ? 'sel' : ''}" data-set="${k}" data-val='${JSON.stringify(v)}'>${s.show(v)}</button>`).join('')}</div></div>`).join('') + '<button class="big" data-act="close">Done</button>';
  } else if (st?.ph === 'result' && result && result.lv && !resultHidden) {
    const L = result.lv;
    html = `<h2 class="${result.ok ? 'win' : 'lose'}">${result.ok ? 'LEVEL COMPLETE!' : 'LEVEL FAILED'}</h2>` +
      `<p>${L.id === 'remix' ? 'Endless Remix' : 'Level ' + L.id}: ${esc(L.name)}</p>` +
      (result.ok ? `<p>in <b>${fmtTime(L.time)}</b>${L.best ? ' · <b>new best!</b>' : ''}</p>` : `<p>${result.h.toFixed(1)} m of ${result.f.toFixed(1)} m</p>`) +
      (L.unlocked ? `<p class="awards">🔓 ${L.unlocked === 'remix' ? 'Endless Remix' : 'Level ' + L.unlocked} unlocked!</p>` : '') +
      (st.ld
        ? (result.ok && L.next ? `<button class="big" data-act="next">${L.next === 'remix' ? 'Endless Remix ▶' : 'Next level ▶'}</button><button data-act="again">Retry</button>` : `<button class="big" data-act="again">Retry</button>`) + `<button data-act="lobby">Level select</button>`
        : `<p class="small">Waiting for the leader…</p>`) +
      `<button data-act="hide">Smash the tower 😈</button>`;
  } else if (st?.ph === 'result' && result && !resultHidden) {
    html = `<h2 class="${result.ok ? 'win' : 'lose'}">${result.ok ? 'THE TOWER STANDS!' : 'NOT TALL ENOUGH'}</h2>` +
      (result.ok ? `<div class="stars">${[1, 2, 3].map((i) => `<span class="${i <= result.stars ? 'on' : ''}">★</span>`).join('')}</div>` : '') +
      (result.early ? `<p><b>Finished with ${fmtTime(result.left)} to spare!</b></p>` : '') + `<p>${result.h.toFixed(1)} m of ${result.f} m · you placed ${result.placed} piece${result.placed === 1 ? '' : 's'}</p>` +
      (result.awards.length ? `<p class="awards">${result.awards.map((a) => `🏅 ${esc(a)}`).join('<br>')}</p>` : '') +
      (st.ld ? `<button class="big" data-act="again">Play again</button><button data-act="lobby">Change settings</button>` : `<p class="small">Waiting for the leader to play again…</p>`) +
      `<button data-act="hide">Smash the tower 😈</button>`;
  } else if (menuOpen) {
    html = `<h2>Menu</h2><p>You are <b style="color:var(--me)">${esc(me?.name || '')}</b> (${esc(me?.colorName || '')} claw)</p>` +
      `<label class="rename">Name <input maxlength="12" value="${esc(me?.name || '')}"><button data-act="rename">Save</button></label>` +
      (st?.ld && (st.ph === 'play' || st.ph === 'countdown' || st.ph === 'hold') ? `<button data-act="restart">Restart the round</button>` : '') +
      `<button data-act="fullscreen">Full screen</button><button data-act="code">Leave the game</button><button class="big" data-act="close">Back</button>` +
      `<div class="help"><b>How to play</b><br>On a computer: arrow keys or WASD move the claw and the rope, Space grabs, X drops, Q/E turn, 1–9 take a piece.<br>Tap a piece to get it: it appears on your shelf at the side (one at a time, so pick it up before you take the next). On the big pad, drag left and right to slide your claw along the bar, up and down to raise and lower it (diagonally does both). GRAB closes the claw on whatever is between its fingers. DROP lowers the claw on its own and grabs, or lets go. ⟲ ⟳ turn the piece waiting on your shelf (pieces can't be turned once they're in the claw). Build one tower with everyone, over the finish line, and keep it standing when the time runs out!</div>`;
  }
  o.innerHTML = html;
  o.classList.toggle('show', !!html);
  o.classList.toggle('dismissable', !!html && !['connecting', 'reconnecting', 'noroom', 'offline', 'full'].includes(connState));
}

$('#overlay').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.set) { send({ t: 'set', key: t.dataset.set, val: JSON.parse(t.dataset.val) }); cfg = { ...cfg, [t.dataset.set]: JSON.parse(t.dataset.val) }; renderOverlay(); return; }
  if (t.dataset.mode) { send({ t: 'mode', m: t.dataset.mode }); if (lvInfo) lvInfo = { ...lvInfo, mode: t.dataset.mode }; renderOverlay(); return; }
  if (t.dataset.level) { const id = t.dataset.level === 'remix' ? 'remix' : Number(t.dataset.level); send({ t: 'level', id }); if (lvInfo) lvInfo = { ...lvInfo, mode: 'levels', level: id }; renderOverlay(); return; }
  switch (t.dataset.act) {
    case 'retry': connSince = 0; join(); break;
    case 'next': send({ t: 'next' }); break;
    case 'code': link?.close(); link = null; me = null; connState = 'idle'; menuOpen = false; renderOverlay(); show('join'); break;
    case 'close': settingsOpen = false; menuOpen = false; renderOverlay(); break;
    case 'again': send({ t: 'start' }); break;
    case 'lobby': send({ t: 'lobby' }); break;
    case 'hide': resultHidden = true; send({ t: 'smash', on: true }); renderOverlay(); renderLeaderBar(); break;
    case 'show-results': resultHidden = false; renderOverlay(); renderLeaderBar(); break;
    case 'restart': if (confirm('Restart the round for everyone?')) send({ t: 'restart' }); menuOpen = false; renderOverlay(); break;
    case 'fullscreen': document.documentElement.requestFullscreen?.().catch(() => {}); menuOpen = false; renderOverlay(); break;
    case 'rename': {
      const v = t.parentElement.querySelector('input').value.trim().slice(0, 12);
      if (v) { send({ t: 'name', name: v }); store.set('name', v); if (me) me.name = v; $('#pad .nm').textContent = v; }
      menuOpen = false; renderOverlay();
      break;
    }
    default: break;
  }
});

setInterval(() => { if (connSince && !me && link) renderOverlay(); }, 5000);

// ---------- little things ----------

let toastTimer = 0;
function toast(text, big = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = 'show' + (big ? ' big' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, big ? 4500 : 2600);
}

let wake = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && link) keepAwake(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// if anything goes wrong, say so on screen (an error on a phone is otherwise invisible)
function showError(msg) {
  let bar = document.getElementById('err-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'err-bar'; document.body.appendChild(bar); bar.onclick = () => bar.remove(); }
  bar.textContent = `Something went wrong: ${String(msg).slice(0, 160)} (tap to hide)`;
}
addEventListener('error', (e) => showError(e.message || e.error || 'unknown error'));
addEventListener('unhandledrejection', (e) => showError((e.reason && e.reason.message) || e.reason || 'unknown error'));

// ---------- on a computer: the keyboard works too ----------
// arrows or WASD move the claw and the rope, Space grabs, X drops, Q/E turn, 1–9 take a piece
const keysDown = new Set();
function keyInput() {
  const k = (a, b) => keysDown.has(a) || keysDown.has(b);
  input.mx = (k('arrowright', 'd') ? 1 : 0) - (k('arrowleft', 'a') ? 1 : 0);
  input.ry = (k('arrowup', 'w') ? 1 : 0) - (k('arrowdown', 's') ? 1 : 0);
  pushInput(true);
}
addEventListener('keydown', (e) => {
  if (!link || e.target.closest?.('input') || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(key)) {
    e.preventDefault();
    if (!keysDown.has(key)) { keysDown.add(key); keyInput(); }
    return;
  }
  if (e.repeat) return;
  if (key === ' ') { e.preventDefault(); send({ t: 'grab' }); }
  else if (key === 'x') send({ t: 'drop' });
  else if (key === 'q') send({ t: 'rot', d: 1 });
  else if (key === 'e') send({ t: 'rot', d: -1 });
  else if (/^[1-9]$/.test(key)) document.querySelectorAll('#pad .cards .card')[Number(key) - 1]?.click();
});
addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (keysDown.delete(key)) keyInput();
  if (key === 'q' || key === 'e') send({ t: 'rotEnd' });
});
addEventListener('blur', () => { if (keysDown.size) { keysDown.clear(); keyInput(); } });
if (matchMedia('(pointer: fine)').matches) document.body.classList.add('has-keys');
// a touch-screen computer: a bigger controller, for fingers
if ((navigator.maxTouchPoints || 0) > 0 || matchMedia('(any-pointer: coarse)').matches) document.body.classList.add('touch-big');
document.addEventListener('dblclick', (e) => e.preventDefault());

show('join');
if (params.has('join') && codeIn.value.length === 4 && store.get('name')) join();
else if (codeIn.value.length === 4) nameIn.focus();

window.__pad = { send, get state() { return { st, inv, me, connState, cfg, result }; } };
