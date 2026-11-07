// The rules (runs on the TV): players and their kits, the lobby, the round clock, the final "hold it"
// check, power-ups, refills and the end-of-round results. Everything physical lives in sim.js.
import { Sim, STEP } from './sim.js';
import { KITS, PIECES, SPECIAL_IDS, PLAYER_COLORS } from '../shared/pieces.js';

export const MAX_PLAYERS = 8;
export const DEFAULT_SETTINGS = { roundTime: 240, difficulty: 'normal', powerups: true };
export const SETTING_CHOICES = {
  roundTime: [120, 180, 240, 300, 360],
  difficulty: ['easy', 'normal', 'hard'],
  powerups: [true, false],
};
const COUNTDOWN = 3;
const JUDGE_TIME = 4;
const DROP_AFTER = 45;       // a player gone this long loses their claw

// how high the finish line is, above the build pad
export function finishHeightFor(players, difficulty) {
  const n = Math.max(2, players);
  const [base, per] = { easy: [4.5, 0.5], normal: [6, 0.6], hard: [7.5, 0.8] }[difficulty] || [6, 0.6];
  return Math.round((base + per * n) * 2) / 2;
}

export function cleanName(name, fallback) {
  const s = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return s || fallback;
}

const kitInventory = (slot) => KITS[slot % KITS.length].items.map(([id, n]) => ({ id, n, max: n }));

export class Game {
  constructor({ settings, random = Math.random } = {}) {
    this.settings = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(SETTING_CHOICES)) if (settings && SETTING_CHOICES[k].includes(settings[k])) this.settings[k] = settings[k];
    this.random = random;
    this.players = new Map(); // id -> player
    this.phase = 'lobby';     // lobby | countdown | play | judge | result
    this.phaseT = 0;
    this.timeLeft = this.settings.roundTime;
    this.round = 0;
    this.events = [];
    this.best = 0;
    this.result = null;
    this.crossed = false;
    this.lastRescue = -99;
    this.t = 0;
    this.newSim();
  }

  // ---------- players ----------

  get activeCount() { let n = 0; for (const p of this.players.values()) if (p.present) n++; return n; }

  leader() {
    let best = null;
    for (const p of this.players.values()) if (p.connected && (!best || p.joinedAt < best.joinedAt)) best = p;
    return best;
  }

  isLeader(id) { const l = this.leader(); return !!l && l.id === id; }

  addPlayer(id, name) {
    const known = this.players.get(id);
    if (known) {
      known.connected = true;
      known.leftAt = -1;
      if (name) known.name = cleanName(name, known.name);
      if (!known.present) this.placePlayer(known);
      this.emit({ type: 'rejoin', slot: known.slot, name: known.name });
      return known;
    }
    const used = new Set([...this.players.values()].map((p) => p.slot));
    let slot = -1;
    for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) { slot = s; break; }
    if (slot < 0) return null;
    const p = {
      id, slot, name: cleanName(name, `Player ${slot + 1}`), color: PLAYER_COLORS[slot].hex, colorName: PLAYER_COLORS[slot].name,
      kit: KITS[slot % KITS.length], inv: kitInventory(slot), connected: true, leftAt: -1, present: false,
      joinedAt: this.clock(), stats: this.freshStats(), specialsGot: 0, lastRestock: 0, invVersion: 1,
    };
    this.players.set(id, p);
    this.placePlayer(p);
    this.emit({ type: 'join', slot, name: p.name });
    return p;
  }

  placePlayer(p) {
    p.present = true;
    this.sim.addPlayer(p.slot);
    this.claw(p).enabled = this.phase !== 'judge';
    if (this.phase === 'lobby') this.refreshLobbyLine();
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    p.leftAt = connected ? -1 : this.clock();
    const claw = this.claw(p);
    if (claw && !connected) { claw.input = { mx: 0, ry: 0 }; claw.auto = null; }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.sim.removePlayer(p.slot);
    this.players.delete(id);
    this.emit({ type: 'leave', slot: p.slot, name: p.name });
    if (this.phase === 'lobby') this.refreshLobbyLine();
  }

  rename(id, name) {
    const p = this.players.get(id);
    if (p) p.name = cleanName(name, p.name);
  }

  claw(p) { return p ? this.sim.claws.get(p.slot) : null; }
  freshStats() { return { placed: 0, highest: 0, grabs: 0, lost: 0 }; }
  clock() { return this.t; }

  // ---------- controls (from phones) ----------

  input(id, mx, ry) {
    const p = this.players.get(id), claw = this.claw(p);
    if (!claw) return;
    const num = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    claw.input = { mx: num(mx), ry: num(ry) };
  }

  grab(id) { const c = this.claw(this.players.get(id)); if (c && this.canAct()) c.toggleGrab(); }
  drop(id) { const c = this.claw(this.players.get(id)); if (c && this.canAct()) c.drop(); }

  rotate(id, dir) {
    const p = this.players.get(id), c = this.claw(p);
    if (!c || !this.canAct()) return false;
    dir = dir > 0 ? 1 : -1;
    if (c.rotateStart(dir)) return 'held';
    if (this.sim.turnPlatformPiece(p.slot, dir)) return 'platform';
    this.toast(p, 'Nothing to turn: grab a piece, or put one on your shelf');
    return false;
  }

  rotateEnd(id) { const c = this.claw(this.players.get(id)); if (c) c.rotateEnd(); }

  canAct() { return this.phase !== 'judge'; }
  canSpawn() { return this.phase === 'lobby' || this.phase === 'play'; }

  spawn(id, index, angle = 0) {
    const p = this.players.get(id);
    if (!p || !p.present) return false;
    const item = p.inv[index];
    if (!item || !PIECES[item.id]) return false;
    if (!this.canSpawn()) { this.toast(p, this.phase === 'countdown' ? 'Wait for GO!' : 'Round over'); return false; }
    const free = this.phase === 'lobby';
    if (!free && item.n <= 0) { this.toast(p, `No ${PIECES[item.id].name} left`); return false; }
    angle = Number.isFinite(angle) ? Math.round(angle / (Math.PI / 4)) * (Math.PI / 4) : 0;
    // one at a time: the last piece has to leave the shelf before the next one arrives
    if (this.sim.shelfBusy(p.slot)) { this.toast(p, 'Take your last piece off your shelf first'); return false; }
    const piece = this.sim.spawnOnPlatform(p.slot, item.id, angle);
    if (!piece) { this.toast(p, 'No room on your shelf: clear it first'); return false; }
    if (free) this.tidyLobby();
    else {
      item.n--;
      if (item.special && item.n <= 0) p.inv.splice(index, 1);
      p.invVersion++;
    }
    return true;
  }

  // free play in the lobby: don't let the floor fill up
  tidyLobby() {
    const loose = [...this.sim.pieces].filter((x) => !x.heldBy.size);
    while (loose.length > 50) this.sim.removePiece(loose.shift(), 'tidy');
  }

  setSetting(key, value) {
    if (!(key in SETTING_CHOICES) || !SETTING_CHOICES[key].includes(value)) return false;
    if (this.phase !== 'lobby' && this.phase !== 'result') return false;
    this.settings[key] = value;
    if (this.phase === 'lobby') {
      this.timeLeft = this.settings.roundTime;
      this.refreshLobbyLine();
    }
    this.emit({ type: 'settings' });
    return true;
  }

  // ---------- rounds ----------

  // in the lobby the finish line follows the player count; the top bar only moves (with a fresh
  // lobby world) when the line would get too close to it or too far below it
  refreshLobbyLine() {
    const h = finishHeightFor(this.activeCount, this.settings.difficulty);
    if (h === this.sim.finishHeight) return;
    const gap = this.sim.topY - (this.sim.finishY - this.sim.finishHeight + h);
    if (gap < 5.5 || gap > 8) this.newSim();
    else this.sim.setFinishHeight(h);
  }

  newSim() {
    const h = finishHeightFor(this.activeCount, this.settings.difficulty);
    this.sim = new Sim({ finishHeight: h });
    for (const p of this.players.values()) if (p.present) this.sim.addPlayer(p.slot);
  }

  startRound() {
    if (this.phase === 'countdown' || this.activeCount === 0) return false;
    this.round++;
    this.newSim();
    for (const p of this.players.values()) {
      p.inv = kitInventory(p.slot);
      p.invVersion++;
      p.stats = this.freshStats();
      p.specialsGot = 0;
      p.lastRestock = 0;
    }
    this.result = null;
    this.crossed = false;
    this.timeLeft = this.settings.roundTime;
    this.nextPower = 25 + this.random() * 15;
    this.lastPowerType = null;
    this.lastRescue = -99;
    this.setPhase('countdown');
    return true;
  }

  // back to free play (to change settings, or wait for more players)
  toLobby() {
    this.newSim();
    for (const p of this.players.values()) { p.inv = kitInventory(p.slot); p.invVersion++; }
    this.result = null;
    this.timeLeft = this.settings.roundTime;
    this.setPhase('lobby');
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseT = 0;
    const judging = phase === 'judge';
    for (const c of this.sim.claws.values()) c.enabled = !judging;
    this.emit({ type: 'phase', phase });
  }

  get elapsed() { return this.settings.roundTime - this.timeLeft; }

  step(dt = STEP) {
    this.t += dt;
    this.phaseT += dt;
    if (this.phase === 'countdown') {
      const before = Math.ceil(COUNTDOWN - (this.phaseT - dt));
      const now = Math.ceil(COUNTDOWN - this.phaseT);
      if (now !== before && now > 0) this.emit({ type: 'count', n: now });
      if (this.phaseT >= COUNTDOWN) { this.setPhase('play'); this.emit({ type: 'go' }); }
    } else if (this.phase === 'play') {
      const before = Math.ceil(this.timeLeft);
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const now = Math.ceil(this.timeLeft);
      if (now !== before && now <= 10 && now > 0) this.emit({ type: 'tick', n: now });
      if (now !== before && (now === 60 || now === 30)) this.emit({ type: 'warn', n: now });
      if (this.timeLeft <= 0) {
        this.sim.removeAids();
        this.setPhase('judge');
        this.emit({ type: 'timeup' });
      }
    } else if (this.phase === 'judge') {
      if (this.phaseT >= JUDGE_TIME) this.finishRound();
    }

    this.sim.step(dt);
    for (const e of this.sim.drainEvents()) this.onSimEvent(e);

    if (this.sim.stepCount % 30 === 0) this.slowStep();
  }

  slowStep() {
    const now = this.clock();
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.leftAt >= 0 && now - p.leftAt > DROP_AFTER) this.removePlayer(p.id);
    }
    if (this.phase !== 'play') return;
    const h = this.sim.tower.height;
    if (!this.crossed && h >= this.sim.finishHeight) { this.crossed = true; this.emit({ type: 'crossed', height: h }); }
    else if (this.crossed && h < this.sim.finishHeight - 0.5) { this.crossed = false; this.emit({ type: 'uncrossed', height: h }); }
    // power-ups now and then
    if (this.settings.powerups && this.elapsed >= this.nextPower && this.timeLeft > 15) {
      this.givePowerup(null, false);
      this.nextPower = this.elapsed + 35 + this.random() * 20;
    }
    // a trickle of refills for anyone nearly out
    for (const p of this.players.values()) {
      if (!p.present) continue;
      const left = p.inv.reduce((s, it) => s + (it.special ? 0 : it.n), 0);
      if (left <= 2 && this.elapsed - p.lastRestock >= 10) {
        const short = p.inv.filter((it) => !it.special && it.n < it.max);
        if (!short.length) continue;
        const it = short[Math.floor(this.random() * short.length)];
        it.n++;
        p.invVersion++;
        p.lastRestock = this.elapsed;
        this.toast(p, `Restock: +1 ${PIECES[it.id].name}`);
      }
    }
  }

  givePowerup(type, rescue) {
    const candidates = [...this.players.values()].filter((p) => p.present && p.connected);
    if (!candidates.length) return;
    const least = Math.min(...candidates.map((p) => p.specialsGot));
    const pool = candidates.filter((p) => p.specialsGot === least);
    const p = pool[Math.floor(this.random() * pool.length)];
    if (!type) {
      const options = SPECIAL_IDS.filter((t) => t !== this.lastPowerType);
      type = options[Math.floor(this.random() * options.length)];
    }
    this.lastPowerType = type;
    const have = p.inv.find((it) => it.id === type);
    if (have) { have.n++; have.max++; } else p.inv.unshift({ id: type, n: 1, max: 1, special: true });
    p.specialsGot++;
    p.invVersion++;
    this.emit({ type: 'powerup', slot: p.slot, name: p.name, piece: type, rescue });
    this.toast(p, `${rescue ? 'Rescue! ' : ''}You got a ${PIECES[type].name}: ${PIECES[type].tip}`, true);
  }

  onSimEvent(e) {
    const bySlot = (slot) => { for (const p of this.players.values()) if (p.slot === slot) return p; return null; };
    if (e.type === 'lock') {
      const p = bySlot(e.slot);
      if (p && this.phase === 'play') { p.stats.placed++; p.stats.highest = Math.max(p.stats.highest, e.top); }
    } else if (e.type === 'grab') {
      const p = bySlot(e.slot);
      if (p && this.phase === 'play') p.stats.grabs++;
    } else if (e.type === 'remove' && e.reason === 'lost') {
      const owner = bySlot(e.owner);
      if (owner && !e.special && this.phase !== 'lobby') {
        const it = owner.inv.find((x) => x.id === e.pieceType);
        if (it && it.n < it.max) { it.n++; owner.invVersion++; this.toast(owner, `Your ${PIECES[e.pieceType].name} fell off the world: it's back in your kit`); }
      }
      const dropper = bySlot(e.releasedBy);
      if (dropper && this.phase === 'play') dropper.stats.lost++;
    } else if (e.type === 'collapse') {
      if (this.phase === 'play' && this.settings.powerups && this.elapsed - this.lastRescue > 25 && this.timeLeft > 20) {
        this.lastRescue = this.elapsed;
        this.givePowerup(this.random() < 0.5 ? 'sp-scaffold' : 'sp-balloon', true);
      }
    }
    this.emit(e);
  }

  finishRound() {
    const height = this.sim.tower.height;
    const finish = this.sim.finishHeight;
    const success = height >= finish;
    const stars = !success ? 0 : height >= finish * 1.3 ? 3 : height >= finish * 1.15 ? 2 : 1;
    this.best = Math.max(this.best, height);
    const players = [...this.players.values()].map((p) => ({ slot: p.slot, name: p.name, color: p.color, ...p.stats }));
    const awards = [];
    if (players.length > 1) {
      const top = (key, title, min = 1) => {
        const best = players.reduce((a, b) => (b[key] > a[key] ? b : a), players[0]);
        if (best[key] >= min && players.filter((x) => x[key] === best[key]).length === 1) awards.push({ title, slot: best.slot, name: best.name, value: best[key] });
      };
      top('placed', 'Master Builder');
      top('highest', 'Sky Reacher', 0.5);
      top('grabs', 'Grabby Hands', 3);
      top('lost', 'Butterfingers');
    }
    this.result = { success, height, finish, stars, best: this.best, pieces: this.sim.tower.count, players, awards, round: this.round };
    this.setPhase('result');
    this.emit({ type: 'result', result: this.result });
  }

  // ---------- what the phones get ----------

  toast(p, text, big = false) {
    if (p) this.emit({ type: 'toast', id: p.id, text, big });
  }

  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  statusFor(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const c = this.claw(p);
    const hold = c?.hold;
    return {
      t: 'st',
      ph: this.phase,
      tl: Math.ceil(this.timeLeft),
      cd: this.phase === 'countdown' ? Math.max(1, Math.ceil(COUNTDOWN - this.phaseT)) : 0,
      h: Math.round(this.sim.tower.height * 10) / 10,
      f: this.sim.finishHeight,
      g: !c ? 0 : c.state === 'holding' ? 2 : c.state === 'closed' ? 1 : 0,
      hn: hold ? PIECES[hold.piece.type].name : '',
      tn: c ? Math.round(c.tension() * 100) / 100 : 0,
      sn: hold ? Math.round(hold.strain * 100) / 100 : 0,
      au: !!c?.auto,
      sb: this.sim.shelfBusy(p.slot),
      ld: this.isLeader(id),
      free: this.phase === 'lobby',
      n: this.activeCount,
    };
  }

  inventoryFor(id) {
    const p = this.players.get(id);
    if (!p) return null;
    return { t: 'inv', v: p.invVersion, kit: p.kit.name, icon: p.kit.icon, items: p.inv.map((it) => ({ id: it.id, n: it.n, sp: !!it.special })) };
  }
}
