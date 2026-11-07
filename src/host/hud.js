// Everything on the TV that isn't 3D: the timer, the height meter, name tags over the claws, banners,
// the lobby (how to join, players, settings) and the results.
import qrcode from 'qrcode-generator';
import { PIECES } from '../shared/pieces.js';
import { SETTING_CHOICES } from '../sim/game.js';
import { LAYOUT } from '../sim/sim.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function drawQR(canvas, text, dark = '#1e1533') {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const size = canvas.width;
  const cell = size / (n + quiet * 2);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) g.fillRect(Math.floor((c + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
  }
}

const SETTING_LABELS = {
  roundTime: { title: 'Round time', show: (v) => fmtTime(v) },
  difficulty: { title: 'Finish line', show: (v) => ({ easy: 'Low', normal: 'Medium', hard: 'High' }[v]) },
  powerups: { title: 'Power-ups', show: (v) => (v ? 'On' : 'Off') },
};

export class Hud {
  constructor(root, actions) {
    this.root = root;
    this.actions = actions;
    this.tags = new Map();
    this.bannerTimer = 0;
    this.lastPlayersKey = '';
    this.lastSettingsKey = '';
    this.lastResult = null;
    root.innerHTML = `
      <div id="hud">
        <div id="join-chip"><canvas width="160" height="160"></canvas><div><div class="small">Join on your phone</div><div class="code"></div><div class="url"></div></div></div>
        <div id="timer"><span class="t">4:00</span><span class="sub"></span></div>
        <div id="meter"><div class="track"><div class="fill"></div><div class="goal"><span>FINISH</span></div><div class="best"></div></div><div class="label"></div></div>
        <div id="finish-label">FINISH <b></b></div>
        <div id="height-label"></div>
        <div id="tags"></div>
        <div id="pops"></div>
        <div id="banner"></div>
        <div id="feed"></div>
        <button id="menu-btn" title="Menu (Esc)">☰</button>
      </div>
      <div id="lobby" class="panel">
        <h1 class="logo"><span>CLAW</span>STRUCTION</h1>
        <p class="tagline">Build one tower together before the clock runs out. Your phone is the controller.</p>
        <div class="join">
          <canvas class="qr" width="400" height="400"></canvas>
          <div class="how">
            <div class="step">1. Scan with your phone camera</div>
            <div class="step small">or open <b class="url"></b></div>
            <div class="step">2. Room code</div>
            <div class="bigcode"></div>
            <div class="net">Connecting to the internet…</div>
          </div>
        </div>
        <h2>Players <span class="count"></span></h2>
        <ul class="players"></ul>
        <h2>Settings</h2>
        <div class="settings"></div>
        <button class="start big">Start the round</button>
        <p class="hint small">Press Enter, or the first player taps <b>Start</b> on their phone. Warm up with your claw while you wait!</p>
      </div>
      <div id="results" class="panel">
        <div class="verdict"></div>
        <div class="stars"></div>
        <div class="numbers"></div>
        <div class="awards"></div>
        <table class="table"></table>
        <div class="buttons"><button class="again big">Play again</button><button class="tolobby">Change settings</button></div>
        <p class="hint small">Or the first player taps <b>Play again</b> on their phone.</p>
      </div>
      <div id="menu" class="panel">
        <h2>Menu</h2>
        <button data-act="restart">Restart the round</button>
        <button data-act="lobby">Back to the lobby</button>
        <button data-act="sound">Sound: on</button>
        <button data-act="music">Music: on</button>
        <button data-act="quality">Graphics: high</button>
        <button data-act="fullscreen">Full screen</button>
        <button data-act="close" class="big">Back to the game</button>
      </div>
      <div id="sound-hint">🔊 Click anywhere to turn on the sound</div>`;
    this.hud = $('#hud', root);
    this.lobby = $('#lobby', root);
    this.results = $('#results', root);
    this.menu = $('#menu', root);
    $('.start', this.lobby).onclick = () => actions.start();
    $('.again', this.results).onclick = () => actions.start();
    $('.tolobby', this.results).onclick = () => actions.lobby();
    $('#menu-btn', root).onclick = () => this.toggleMenu();
    this.menu.addEventListener('click', (ev) => {
      const act = ev.target?.dataset?.act;
      if (!act) return;
      if (act === 'close') this.toggleMenu(false);
      else actions.menu(act, ev.target);
      if (act === 'restart' || act === 'lobby') this.toggleMenu(false);
    });
  }

  toggleMenu(show = !this.menu.classList.contains('show')) { this.menu.classList.toggle('show', show); }
  get menuOpen() { return this.menu.classList.contains('show'); }

  setJoin(url, code) {
    this.url = url; this.code = code;
    const pretty = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
    drawQR($('#lobby .qr', this.root), url);
    drawQR($('#join-chip canvas', this.root), url);
    $('#lobby .url', this.root).textContent = pretty;
    $('#lobby .bigcode', this.root).textContent = code;
    $('#join-chip .code', this.root).textContent = code;
    $('#join-chip .url', this.root).textContent = pretty;
  }

  // is the room reachable? (phones need the TV registered with the matchmaking server)
  setNet(state) {
    const n = $('#lobby .net', this.root);
    n.className = 'net ' + state;
    n.textContent = state === 'ready' ? '' : state === 'offline' ? 'No internet: phones can\'t join yet. Retrying…' : 'Connecting to the internet…';
  }

  setSoundHint(show) { $('#sound-hint', this.root).classList.toggle('show', show); }

  // ---------- each frame ----------

  update(game, r, dt = 1 / 60) {
    const sim = game.sim;
    const phase = game.phase;
    this.root.dataset.phase = phase;
    const inLobby = phase === 'lobby';
    this.lobby.classList.toggle('show', inLobby);
    this.results.classList.toggle('show', phase === 'result' && game.phaseT > 1.2);
    r.inset = inLobby ? 0.36 : 0;

    // timer
    const timer = $('#timer', this.root);
    const t = phase === 'lobby' ? game.settings.roundTime : phase === 'countdown' ? game.settings.roundTime : game.timeLeft;
    $('.t', timer).textContent = fmtTime(Math.ceil(t));
    $('.sub', timer).textContent = phase === 'lobby' ? 'warm-up' : phase === 'judge' ? 'hold it…' : phase === 'result' ? 'round over' : '';
    timer.classList.toggle('hurry', phase === 'play' && game.timeLeft <= 30);
    timer.classList.toggle('panic', phase === 'play' && game.timeLeft <= 10);

    // height meter
    const top = sim.finishHeight * 1.3;
    const h = sim.tower.height;
    const meter = $('#meter', this.root);
    $('.fill', meter).style.height = `${Math.min(100, (h / top) * 100)}%`;
    $('.goal', meter).style.bottom = `${(sim.finishHeight / top) * 100}%`;
    $('.best', meter).style.bottom = `${Math.min(100, (Math.max(game.best, h) / top) * 100)}%`;
    $('.best', meter).style.display = game.best > 0 ? '' : 'none';
    $('.label', meter).innerHTML = `<b>${h.toFixed(1)}</b> / ${sim.finishHeight} m`;
    meter.classList.toggle('over', h >= sim.finishHeight);

    // labels on the finish line and the tower top
    const fl = $('#finish-label', this.root);
    const fp = r.project(-sim.layout.padHalf - 1.2, sim.finishY, -1.1);
    fl.style.transform = `translate(${Math.max(fp.x, fl.offsetWidth + 12)}px, ${fp.y}px) translate(-100%, -50%)`; // (stays on screen when zoomed in)
    $('b', fl).textContent = `${sim.finishHeight} m`;
    fl.classList.toggle('over', h >= sim.finishHeight);
    const hl = $('#height-label', this.root);
    if (h > 0.2) {
      const hp = r.project(sim.tower.x + 3.6, LAYOUT.padTop + h, -1);
      hl.style.display = '';
      hl.style.transform = `translate(${hp.x}px, ${hp.y}px) translate(0, -50%)`;
      hl.textContent = `${h.toFixed(1)} m`;
    } else hl.style.display = 'none';

    // name tags over each trolley
    const bySlot = new Map([...game.players.values()].map((p) => [p.slot, p]));
    const tagsEl = $('#tags', this.root);
    for (const [slot, tag] of this.tags) if (!sim.claws.has(slot)) { tag.remove(); this.tags.delete(slot); }
    for (const [slot, claw] of sim.claws) {
      const p = bySlot.get(slot);
      if (!p) continue;
      let tag = this.tags.get(slot);
      if (!tag) { tag = el('div', 'tag'); tagsEl.appendChild(tag); this.tags.set(slot, tag); }
      // just above the claw head, so it moves with the claw
      const hp = claw.body.getPosition();
      const pos = r.project(hp.x, hp.y + 0.62, 0.6);
      tag.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
      tag.style.background = p.color;
      const icon = claw.state === 'holding' ? ' ✊' : '';
      const text = esc(p.name) + icon + (p.connected ? '' : ' 💤');
      if (tag._text !== text) { tag.innerHTML = text; tag._text = text; }
      tag.classList.toggle('away', !p.connected);
    }

    // join chip stays up during a round, for late arrivals
    $('#join-chip', this.root).classList.toggle('show', !inLobby && !!this.url);

    if (inLobby) this.updateLobby(game);
    if (phase === 'result' && game.result !== this.lastResult) { this.lastResult = game.result; this.showResult(game.result); }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) $('#banner', this.root).classList.remove('show');
    }
  }

  updateLobby(game) {
    const players = [...game.players.values()].sort((a, b) => a.slot - b.slot);
    const leader = game.leader();
    const key = players.map((p) => `${p.slot}${p.name}${p.connected}${leader === p}`).join('|');
    if (key !== this.lastPlayersKey) {
      this.lastPlayersKey = key;
      const ul = $('.players', this.lobby);
      ul.innerHTML = '';
      for (let s = 0; s < 8; s++) {
        const p = players.find((x) => x.slot === s);
        const li = el('li', p ? 'on' : 'empty');
        if (p) {
          li.style.setProperty('--c', p.color);
          li.innerHTML = `<span class="dot"></span><span class="name">${esc(p.name)}${leader === p ? ' <span class="lead">★ leader</span>' : ''}${p.connected ? '' : ' 💤'}</span><span class="kit" title="${esc(p.kit.name)}">${p.kit.icon}</span>`;
        } else li.innerHTML = '<span class="dot"></span><span class="name">waiting…</span>';
        ul.appendChild(li);
      }
      $('.count', this.lobby).textContent = `${players.length}/8`;
      $('.start', this.lobby).disabled = players.length === 0;
    }
    const skey = JSON.stringify(game.settings);
    if (skey !== this.lastSettingsKey) {
      this.lastSettingsKey = skey;
      const box = $('.settings', this.lobby);
      box.innerHTML = '';
      for (const [k, meta] of Object.entries(SETTING_LABELS)) {
        const row = el('div', 'setting');
        row.appendChild(el('span', 'title', meta.title));
        const opts = el('span', 'opts');
        for (const v of SETTING_CHOICES[k]) {
          const b = el('button', game.settings[k] === v ? 'sel' : '', meta.show(v));
          b.onclick = () => this.actions.setting(k, v);
          opts.appendChild(b);
        }
        row.appendChild(opts);
        box.appendChild(row);
      }
    }
  }

  showResult(res) {
    const R = this.results;
    R.classList.toggle('win', res.success);
    $('.verdict', R).innerHTML = res.success ? 'THE TOWER STANDS!' : res.height < 0.5 ? 'NO TOWER…' : 'NOT TALL ENOUGH';
    $('.stars', R).innerHTML = res.success ? [1, 2, 3].map((i) => `<span class="${i <= res.stars ? 'on' : ''}">★</span>`).join('') : '';
    $('.numbers', R).innerHTML = `Height <b>${res.height.toFixed(1)} m</b> · finish line ${res.finish} m · ${res.pieces} piece${res.pieces === 1 ? '' : 's'} in the tower` +
      (res.success ? (res.stars < 3 ? `<div class="small">Next star at ${(res.finish * (res.stars === 1 ? 1.15 : 1.3)).toFixed(1)} m</div>` : '') : `<div class="small">${Math.max(0, res.finish - res.height).toFixed(1)} m short. So close… try again!</div>`);
    $('.awards', R).innerHTML = res.awards.map((a) => `<div class="award"><span class="title">${esc(a.title)}</span> ${esc(a.name)}</div>`).join('');
    const rows = res.players.sort((a, b) => b.placed - a.placed).map((p) => `<tr><td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</td><td>${p.placed}</td><td>${p.highest.toFixed(1)} m</td><td>${p.lost}</td></tr>`).join('');
    $('.table', R).innerHTML = `<tr><th></th><th>placed</th><th>highest</th><th>dropped</th></tr>${rows}`;
  }

  banner(text, kind = '', seconds = 2.2) {
    const b = $('#banner', this.root);
    b.className = 'show ' + kind;
    b.innerHTML = text;
    // restart the pop-in animation
    void b.offsetWidth;
    b.classList.add('anim');
    this.bannerTimer = seconds;
  }

  pop(r, x, y, text, color = '#ffffff') {
    const p = r.project(x, y, 0.5);
    const d = el('div', 'pop', esc(text));
    d.style.left = `${p.x}px`; d.style.top = `${p.y}px`; d.style.color = color;
    $('#pops', this.root).appendChild(d);
    setTimeout(() => d.remove(), 1300);
  }

  feed(html) {
    const f = $('#feed', this.root);
    const d = el('div', 'item', html);
    f.appendChild(d);
    while (f.children.length > 4) f.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 5000);
    setTimeout(() => d.remove(), 6000);
  }

  onEvent(e, game, r) {
    const bySlot = (slot) => { for (const p of game.players.values()) if (p.slot === slot) return p; return null; };
    const who = (slot) => { const p = bySlot(slot); return p ? `<b style="color:${p.color}">${esc(p.name)}</b>` : 'Someone'; };
    switch (e.type) {
      case 'phase':
        if (e.phase === 'countdown') { this.banner('3', 'count', 1); this.lockedTop = 0; }
        if (e.phase === 'lobby') this.lastResult = null;
        break;
      case 'count': this.banner(String(e.n), 'count', 1); break;
      case 'go': this.banner('BUILD!', 'go', 1.3); break;
      case 'warn': this.banner(e.n === 60 ? '1 minute left' : '30 seconds!', 'warn', 1.6); break;
      case 'timeup': this.banner("TIME'S UP!<div class='small'>Hands off… will it stand?</div>", 'timeup', 3.6); break;
      case 'crossed': this.banner('OVER THE LINE!<div class="small">Now keep it standing until the end</div>', 'good', 2.6); break;
      case 'uncrossed': this.feed('⚠️ The tower dropped below the line!'); break;
      case 'collapse': this.banner('COLLAPSE!', 'bad', 1.8); break;
      case 'powerup':
        this.feed(`${e.rescue ? '🚑 Rescue! ' : '🎁 '}${who(e.slot)} got a <b>${esc(PIECES[e.piece].name)}</b>`);
        break;
      case 'lock':
        // a piece that raised the tower gets a "+0.8 m"
        if (game.phase === 'play' && e.top > (this.lockedTop || 0) + 0.05) {
          this.pop(r, e.x, e.y + 0.7, `+${(e.top - (this.lockedTop || 0)).toFixed(1)} m`, '#7dff9e');
          this.lockedTop = e.top;
        } else this.pop(r, e.x, e.y + 0.6, 'clunk!', '#fff6a8');
        break;
      case 'join': this.feed(`👋 ${who(e.slot)} joined`); break;
      case 'leave': this.feed(`${esc(e.name)} left`); break;
      case 'anchor': this.pop(r, e.x, e.y + 1.8, 'propped for 20 s', '#ffd95e'); break;
      case 'tie': this.feed('🎈 A balloon is holding something up'); break;
      default: break;
    }
  }
}
