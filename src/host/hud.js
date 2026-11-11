// Everything on the TV that isn't 3D: the timer, the height meter, name tags over the claws, banners,
// the lobby (how to join, players, settings) and the results.
import qrcode from 'qrcode-generator';
import { PIECES } from '../shared/pieces.js';
import { SETTING_CHOICES } from '../sim/game.js';
import { LEVELS, REMIX, MOD_INFO, levelHeight } from '../shared/levels.js';
import { LAYOUT } from '../sim/sim.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m1 = (v) => String(Math.round(v * 10) / 10); // metres to one decimal place
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
        <div id="level-chip"><b class="name"></b><span class="mods"></span></div>
        <div id="level-intro"></div>
        <div id="zone-label">🪐 LOW GRAVITY</div>
        <div id="gap-label">🌉 ONLY WHAT'S OVER THE GAP COUNTS</div>
        <div id="smash-bar"></div>
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
        <div class="tabs"><button data-mode="free">Free Play</button><button data-mode="levels">Levels</button></div>
        <div class="levels-box">
          <div class="level-grid"></div>
          <div class="level-info"></div>
        </div>
        <h2>Players <span class="count"></span></h2>
        <ul class="players"></ul>
        <div class="settings-box">
          <h2>Settings</h2>
          <div class="settings"></div>
        </div>
        <button class="start big">Start the round</button>
        <button class="as-controller">💻 Use this computer as a controller too</button>
        <p class="hint small">Press Enter, or the first player taps <b>Start</b> on their phone. Warm up with your claw while you wait!</p>
      </div>
      <div id="results" class="panel">
        <div class="verdict"></div>
        <div class="level-line"></div>
        <div class="stars"></div>
        <div class="numbers"></div>
        <div class="awards"></div>
        <table class="table"></table>
        <div class="buttons"></div>
        <p class="hint small">Or the first player uses the buttons on their phone.</p>
      </div>
      <div id="menu" class="panel">
        <h2>Menu</h2>
        <button data-act="restart">Restart the round</button>
        <button data-act="lobby">Back to the lobby</button>
        <button data-act="sound">Sound: on</button>
        <button data-act="music">Music: on</button>
        <button data-act="quality">Graphics: high</button>
        <button data-act="fullscreen">Full screen</button>
        <button data-act="controller">Open a controller on this computer</button>
        <button data-act="become">Switch this screen to a controller</button>
        <button data-act="close" class="big">Back to the game</button>
      </div>
      <div id="sound-hint">🔊 Click anywhere to turn on the sound</div>`;
    this.hud = $('#hud', root);
    this.lobby = $('#lobby', root);
    this.results = $('#results', root);
    this.menu = $('#menu', root);
    $('.start', this.lobby).onclick = () => actions.start();
    $('.as-controller', this.lobby).onclick = () => actions.menu('controller');
    for (const b of this.lobby.querySelectorAll('.tabs button')) b.onclick = () => actions.mode(b.dataset.mode);
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
    const resultsUp = phase === 'result' && game.phaseT > 1.2;
    this.results.classList.toggle('show', resultsUp && !game.smashing);
    // smash time: the results shrink to a bar so the whole tower is in view
    const bar = $('#smash-bar', this.root);
    bar.classList.toggle('show', resultsUp && !!game.smashing);
    if (resultsUp && game.smashing && game.result && bar._res !== game.result) {
      bar._res = game.result;
      const r = game.result, lvl = r.level;
      bar.innerHTML = `<span class="msg">😈 Smash time! ${r.success ? '★'.repeat(r.stars) : '✗'} ${lvl ? (r.success ? 'Level complete' : 'Level failed') : r.success ? 'The tower stood' : 'Not tall enough'}</span>`;
      const add = (text, fn, cls = '') => { const b = el('button', cls, text); b.onclick = fn; bar.appendChild(b); };
      if (lvl && r.success && r.next) add('Next ▶', () => this.actions.next(), 'go');
      add(lvl ? 'Retry' : 'Play again', () => this.actions.start(), lvl && r.success && r.next ? '' : 'go');
      add('Results', () => this.actions.smash(false));
    }
    r.inset = inLobby ? 0.36 : 0;

    // timer
    const timer = $('#timer', this.root);
    const t = phase === 'lobby' ? game.settings.roundTime : phase === 'countdown' ? game.settings.roundTime : game.timeLeft;
    $('.t', timer).textContent = fmtTime(Math.ceil(t));
    $('.sub', timer).textContent = phase === 'lobby' ? 'warm-up' : phase === 'judge' || phase === 'hold' ? 'hold it…' : phase === 'result' ? 'round over' : '';
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
    $('.label', meter).innerHTML = `<b>${h.toFixed(1)}</b> / ${m1(sim.finishHeight)} m`;
    meter.classList.toggle('over', h >= sim.finishHeight);

    // labels on the finish line and the tower top
    const fl = $('#finish-label', this.root);
    const fp = r.project(-sim.layout.padHalf - 1.2, sim.finishY, -1.1);
    fl.style.transform = `translate(${Math.max(fp.x, fl.offsetWidth + 12)}px, ${fp.y}px) translate(-100%, -50%)`; // (stays on screen when zoomed in)
    $('b', fl).textContent = `${m1(sim.finishHeight)} m`;
    fl.classList.toggle('over', h >= sim.finishHeight);
    const hl = $('#height-label', this.root);
    if (h > 0.2) {
      // (two towers: next to the lower one; over a chasm: next to the top piece)
      const lowSide = sim.tower.sides ? (sim.tower.sides[0].h <= sim.tower.sides[1].h ? sim.tower.sides[0] : sim.tower.sides[1]) : null;
      const hp = r.project((lowSide ? lowSide.x : sim.mods.bridge ? sim.tower.topX : sim.tower.x) + 3.6, sim.padTop + h, -1);
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

    // the level being played, and its mechanics (the wind's direction and strength live)
    const lv = game.level;
    const chip = $('#level-chip', this.root);
    chip.classList.toggle('show', !!lv && !inLobby && phase !== 'result');
    if (lv && !inLobby) {
      const title = `${game.levelId === 'remix' ? '🎲 Remix' : 'Level ' + game.levelId}: ${lv.name}`;
      if (chip._title !== title) { $('.name', chip).textContent = title; chip._title = title; }
      const bits = [];
      for (const k of Object.keys(lv.mods)) {
        if (k === 'wind') {
          const w = sim.wind, n = Math.min(3, Math.round(Math.abs(w) / sim.mods.wind.max * 3));
          bits.push(`🌬️ ${w < -0.05 ? '◀'.repeat(Math.max(1, n)) : w > 0.05 ? '▶'.repeat(Math.max(1, n)) : '·'}`);
        } else if (k === 'conveyor') {
          const b = sim.belt, n = Math.min(3, Math.round(Math.abs(b) / sim.mods.conveyor.speed * 3));
          bits.push(`🏭 Belt ${b < -0.05 ? '◀'.repeat(Math.max(1, n)) : b > 0.05 ? '▶'.repeat(Math.max(1, n)) : '·'}`);
        } else if (k === 'quake') {
          bits.push(sim.quaking ? '🫨 QUAKE!' : sim.quake.warned ? '⚠️ Quake coming!' : '🫨 Earthquakes');
        } else if (k === 'twin' && sim.tower.sides) {
          bits.push(`🏙️ Left ${sim.tower.sides[0].h.toFixed(1)} m · Right ${sim.tower.sides[1].h.toFixed(1)} m`);
        } else if (k === 'fragile' && lv.mods.unstable) {
          continue;
        } else bits.push(`${MOD_INFO[k].icon} ${MOD_INFO[k].label}`);
      }
      const modsHtml = bits.map((b) => `<span>${esc(b)}</span>`).join('');
      if (chip._mods !== modsHtml) { $('.mods', chip).innerHTML = modsHtml; chip._mods = modsHtml; }
    }
    const intro = $('#level-intro', this.root);
    const showIntro = !!lv && (phase === 'countdown' || (phase === 'play' && game.elapsed < 2.5));
    intro.classList.toggle('show', showIntro);
    if (showIntro && intro._lv !== lv) {
      intro._lv = lv;
      intro.innerHTML = `<div class="t">${lv.icon} ${game.levelId === 'remix' ? 'Endless Remix' : 'Level ' + game.levelId}: ${esc(lv.name)}</div><div>${esc(lv.blurb)}</div><div class="goal">Reach <b>${sim.finishHeight.toFixed(1)} m</b> in <b>${fmtTime(lv.time)}</b>${Object.keys(lv.mods).length ? ' · ' + Object.keys(lv.mods).map((k) => MOD_INFO[k].icon + ' ' + MOD_INFO[k].label).join(' · ') : ''}</div>`;
    }
    const gl = $('#gap-label', this.root);
    gl.classList.toggle('show', !!sim.mods.bridge && phase !== 'result');
    if (sim.mods.bridge) {
      const gp = r.project(0, sim.padTop + 0.35, -1.3);
      gl.style.transform = `translate(${gp.x}px, ${gp.y}px) translate(-50%, 0)`;
    }
    const zl = $('#zone-label', this.root);
    zl.classList.toggle('show', !!sim.mods.gravity);
    if (sim.mods.gravity) {
      const zp = r.project(sim.layout.padHalf * 0.5, sim.padTop + 0.5, -1.3);
      zl.style.transform = `translate(${zp.x}px, ${zp.y}px) translate(-50%, 0)`;
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
    const lvKey = JSON.stringify([game.mode, game.levelId, game.progress, game.activeCount, game.level && game.level.mods]);
    if (lvKey !== this.lastLevelsKey) {
      this.lastLevelsKey = lvKey;
      this.renderLevels(game);
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

  // the lobby in Levels mode: every level (locked or not, done, best time), and the chosen one's details
  renderLevels(game) {
    const levels = game.mode === 'levels';
    this.lobby.classList.toggle('mode-levels', levels);
    for (const b of this.lobby.querySelectorAll('.tabs button')) b.classList.toggle('sel', b.dataset.mode === game.mode);
    $('.start', this.lobby).textContent = levels ? `Start ${game.levelId === 'remix' ? 'the Remix' : 'Level ' + game.levelId}` : 'Start the round';
    if (!levels) return;
    const grid = $('.level-grid', this.lobby);
    grid.innerHTML = '';
    const card = (id, def, locked, done, best) => {
      const b = el('button', 'lv' + (locked ? ' locked' : '') + (done ? ' done' : '') + (game.levelId === id ? ' sel' : ''));
      b.innerHTML = `<span class="num">${id === 'remix' ? '🎲' : id}</span><span class="ic">${locked ? '🔒' : def.icon}</span>${done ? `<span class="tick">✓ ${best !== null ? fmtTime(best) : ''}</span>` : ''}`;
      b.title = def.name;
      if (!locked) b.onclick = () => this.actions.level(id);
      grid.appendChild(b);
    };
    for (const l of LEVELS) {
      const pr = game.progress.levels[l.id];
      card(l.id, l, l.id > game.progress.unlocked, !!pr?.done, pr?.best ?? null);
    }
    card('remix', REMIX, !game.remixUnlocked, game.progress.remix.wins > 0, game.progress.remix.best);
    const lv = game.level;
    const pr = game.levelId === 'remix' ? null : game.progress.levels[game.levelId];
    $('.level-info', this.lobby).innerHTML = `<div class="t">${lv.icon} ${game.levelId === 'remix' ? `Endless Remix <span class="small">(${game.progress.remix.wins} won)</span>` : `Level ${game.levelId}: ${esc(lv.name)}`}</div>` +
      `<div class="small">${esc(lv.blurb)}</div>` +
      `<div class="goal">Reach <b>${levelHeight(lv, game.activeCount).toFixed(1)} m</b> in <b>${fmtTime(lv.time)}</b>${pr?.best != null ? ` · best ${fmtTime(pr.best)}` : ''}</div>` +
      `<div class="mods">${Object.keys(lv.mods).map((k) => `<span>${MOD_INFO[k].icon} ${MOD_INFO[k].label}</span>`).join('') || '<span>🧱 Just building</span>'}</div>`;
  }

  showResult(res) {
    const R = this.results;
    R.classList.toggle('win', res.success);
    const lvl = res.level;
    $('.verdict', R).innerHTML = lvl ? (res.success ? 'LEVEL COMPLETE!' : 'LEVEL FAILED') : res.success ? 'THE TOWER STANDS!' : res.height < 0.5 ? 'NO TOWER…' : 'NOT TALL ENOUGH';
    $('.level-line', R).innerHTML = !lvl ? '' : `${lvl.icon} ${lvl.id === 'remix' ? 'Endless Remix' : 'Level ' + lvl.id}: ${esc(lvl.name)}` +
      (res.success ? ` · in <b>${fmtTime(lvl.time)}</b>${res.newBest ? ' <span class="best">New best!</span>' : ''}` : '') +
      (res.unlocked ? `<div class="unlock">🔓 ${res.unlocked === 'remix' ? 'Endless Remix' : 'Level ' + res.unlocked}${res.remixOpen ? ' and the Endless Remix' : ''} unlocked!</div>` : '') +
      (res.allDone ? '<div class="unlock">🏆 Every level beaten! Try the Endless Remix next</div>' : '');
    const btns = $('.buttons', R);
    btns.innerHTML = '';
    const button = (text, cls, fn) => { const b = el('button', cls, text); b.onclick = fn; btns.appendChild(b); };
    if (lvl) {
      if (res.success && res.next) button(res.next === 'remix' ? (lvl.id === 'remix' ? 'Next remix ▶' : 'Endless Remix ▶') : 'Next level ▶', 'big', () => this.actions.next());
      button('Retry', res.success && res.next ? '' : 'big', () => this.actions.start());
      button('Level select', '', () => this.actions.lobby());
    } else {
      button('Play again', 'big', () => this.actions.start());
      button('Change settings', '', () => this.actions.lobby());
    }
    button('Smash the tower 😈', '', () => this.actions.smash(true));
    $('.stars', R).innerHTML = res.success ? [1, 2, 3].map((i) => `<span class="${i <= res.stars ? 'on' : ''}">★</span>`).join('') : '';
    $('.numbers', R).innerHTML = (res.early ? `<div class="early">Finished with ${fmtTime(Math.ceil(res.timeLeft))} to spare!</div>` : '') + `Height <b>${res.height.toFixed(1)} m</b> · finish line ${m1(res.finish)} m · ${res.pieces} piece${res.pieces === 1 ? '' : 's'} in the tower` +
      (res.success ? (res.stars < 3 ? `<div class="small">Finish within ${fmtTime(Math.floor(res.roundTime * (res.stars === 1 ? 0.75 : 0.5)))} for ${res.stars + 1} stars</div>` : '<div class="small">Top speed!</div>') : `<div class="small">${Math.max(0, res.finish - res.height).toFixed(1)} m short. So close… try again!</div>`);
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
      case 'crossed': this.banner('OVER THE LINE!<div class="small">Keep it there…</div>', 'good', 2.4); break;
      case 'hold': this.banner(`${e.n}<div class="small">Hands off! Will it stand?</div>`, 'count', 1); break;
      case 'holdcount': this.banner(`${e.n}<div class="small">Hands off! Will it stand?</div>`, 'count', 1); break;
      case 'holdfail': this.banner(game.phase === 'play' ? 'IT FELL!<div class="small">Keep building!</div>' : 'IT FELL!', 'bad', 2.2); break;
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
      case 'glitch': { const c = game.sim.claws.get(e.slot); if (c) { const p = c.body.getPosition(); this.pop(r, p.x, p.y + 1, { slip: 'slip!', stretch: 'stretch!', drop: 'oops, dropped!' }[e.kind], '#ffb0b0'); } break; }
      case 'boost': this.feed(`⚡ ${who(e.slot)} has a <b>Super Claw</b>!`); break;
      case 'shatter': this.pop(r, e.x, e.y + 0.5, 'smash!', '#bff6ff'); break;
      case 'quakewarn': this.banner('⚠️ EARTHQUAKE!<div class="small">Hold on to something…</div>', 'bad', 2); break;
      case 'meteor':
        if (e.hit === 'claw') { this.pop(r, e.x, e.y + 0.8, 'blocked!', '#9effc0'); this.feed(`🛡️ ${who(e.slot)} blocked a meteor!`); }
        else if (e.hit === 'burn') this.pop(r, e.x, e.y + 0.6, 'burnt!', '#ffb36b');
        break;
      case 'flip': {
        const c = game.sim.claws.get(e.slot);
        if (c) { const p = c.body.getPosition(); this.pop(r, p.x, p.y + 1, e.both ? '🔀 all mixed up!' : '🔀 flipped!', '#e2b6ff'); }
        this.feed(`🔀 ${who(e.slot)}'s controls are flipped${e.both ? ' (both ways)' : ''}!`);
        break;
      }
      default: break;
    }
  }
}
