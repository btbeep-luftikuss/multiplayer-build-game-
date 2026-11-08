// The rules (runs on the TV): players and their kits, the lobby, the round clock, the final "hold it"
// check, power-ups, refills and the end-of-round results. Everything physical lives in sim.js.
import { Sim, STEP } from './sim.js';
import { KITS, PIECES, SPECIAL_IDS, PLAYER_COLORS } from '../shared/pieces.js';
import { LEVELS, levelById, levelHeight, remixLevel } from '../shared/levels.js';

export const MAX_PLAYERS = 8;
export const DEFAULT_SETTINGS = { roundTime: 240, difficulty: 'normal', powerups: true };
export const SETTING_CHOICES = {
  roundTime: [120, 180, 240, 300, 360],
  difficulty: ['easy', 'normal', 'hard'],
  powerups: [true, false],
};
const COUNTDOWN = 3;
const JUDGE_TIME = 4;
const OVER_TIME = 3;          // the tower over the line this long starts the hold check…
const HOLD_TIME = 5;
export const STAR3 = 0.5, STAR2 = 0.75; // share of the round time used, for 3 and 2 stars          // …which it has to survive, hands off, to win early
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

// the more players, the fewer pieces each (2 players get the full kit, 8 about half)
export const kitShare = (players) => Math.max(0.45, 1 - (Math.max(2, players) - 2) * 0.09);
const kitInventory = (slot, players = 2, pool = null) => (pool || KITS[slot % KITS.length].items).map(([id, n]) => {
  const m = Math.max(1, Math.round(n * kitShare(players)));
  return { id, n: m, max: m };
});

// Levels mode progress (kept by the TV): which levels are unlocked, done, and the best team times
export function cleanProgress(p) {
  const out = { unlocked: 1, levels: {}, remix: { wins: 0, best: null } };
  if (!p || typeof p !== 'object') return out;
  out.unlocked = Math.max(1, Math.min(LEVELS.length, Number(p.unlocked) | 0 || 1));
  for (const l of LEVELS) {
    const r = p.levels?.[l.id];
    if (r && r.done) out.levels[l.id] = { done: true, best: Number.isFinite(r.best) ? r.best : null };
  }
  if (p.remix) out.remix = { wins: Math.max(0, Number(p.remix.wins) | 0), best: Number.isFinite(p.remix.best) ? p.remix.best : null };
  return out;
}

export class Game {
  constructor({ settings, random = Math.random, progress = null, mode = 'free', level = 1 } = {}) {
    this.progress = cleanProgress(progress);
    this.mode = mode === 'levels' ? 'levels' : 'free';
    this.levelId = 1;
    this.remixDef = null;
    if (this.levelAvailable(level)) this.levelId = level;
    this.settings = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(SETTING_CHOICES)) if (settings && SETTING_CHOICES[k].includes(settings[k])) this.settings[k] = settings[k];
    this.random = random;
    this.players = new Map(); // id -> player
    this.phase = 'lobby';     // lobby | countdown | play | judge | result
    this.phaseT = 0;
    this.timeLeft = this.roundTime();
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
      kit: KITS[slot % KITS.length], inv: kitInventory(slot, this.activeCount + 1, this.level ? this.level.pool : null), connected: true, leftAt: -1, present: false,
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
    this.claw(p).enabled = this.canAct();
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
    // pieces only turn on the spawn shelf (its turntable), never in the claw
    if (c.hold) { this.toast(p, 'Turn pieces on your shelf, before you grab them'); return false; }
    const r = this.sim.turnPlatformPiece(p.slot, dir);
    if (r === 'turned') return 'platform';
    this.toast(p, r === 'blocked' ? 'No room to turn it there: move your claw away' : 'Nothing on your shelf to turn');
    return false;
  }

  rotateEnd(id) { const c = this.claw(this.players.get(id)); if (c) c.rotateEnd(); }

  canAct() { return this.phase !== 'judge' && this.phase !== 'hold'; }
  canSpawn() { return this.phase === 'lobby' || this.phase === 'play'; }

  spawn(id, index, angle = 0) {
    const p = this.players.get(id);
    if (!p || !p.present) return false;
    const item = p.inv[index];
    if (!item || !PIECES[item.id]) return false;
    if (!this.canSpawn()) { this.toast(p, this.phase === 'countdown' ? 'Wait for GO!' : this.phase === 'hold' ? 'Hands off: wait and see if it stands!' : 'Round over'); return false; }
    const free = this.phase === 'lobby';
    if (!free && item.n <= 0) { this.toast(p, `No ${PIECES[item.id].name} left`); return false; }
    angle = Number.isFinite(angle) ? Math.round(angle / (Math.PI / 4)) * (Math.PI / 4) : 0;
    if (PIECES[item.id].special === 'boost') {
      const claw = this.claw(p);
      if (!claw) return false;
      claw.boostUntil = this.sim.time + 20;
      claw.slipUntil = -1;
      if (!free) { item.n--; if (item.n <= 0) p.inv.splice(index, 1); p.invVersion++; }
      this.emit({ type: 'boost', slot: p.slot });
      this.toast(p, 'SUPER CLAW! Faster, quicker, stronger for 20 s', true);
      return true;
    }
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

  // ---------- free play or levels ----------

  get remixUnlocked() { return !!this.progress.levels[LEVELS.length]?.done; }
  levelAvailable(id) { return id === 'remix' ? this.remixUnlocked : Number.isInteger(id) && id >= 1 && id <= this.progress.unlocked; }

  // the level being played (null in free play)
  get level() {
    if (this.mode !== 'levels') return null;
    if (this.levelId === 'remix') return this.remixDef || (this.remixDef = remixLevel(this.progress.remix.wins, this.random));
    return levelById(this.levelId);
  }

  roundTime() { return this.level ? this.level.time : this.settings.roundTime; }
  powerupsOn() { return this.level ? this.level.powerups : this.settings.powerups; }
  targetHeight() { return this.level ? levelHeight(this.level, this.activeCount) : finishHeightFor(this.activeCount, this.settings.difficulty); }
  kitFor(p) { return kitInventory(p.slot, this.activeCount, this.level ? this.level.pool : null); }

  setMode(mode) {
    if ((mode !== 'free' && mode !== 'levels') || (this.phase !== 'lobby' && this.phase !== 'result')) return false;
    this.mode = mode;
    this.afterLevelChange();
    return true;
  }

  setLevel(id) {
    if (!this.levelAvailable(id) || (this.phase !== 'lobby' && this.phase !== 'result')) return false;
    this.mode = 'levels';
    this.levelId = id;
    if (id === 'remix') this.remixDef = null;
    this.afterLevelChange();
    return true;
  }

  // a different mode or level: in the lobby, show it (a fresh world with that level's ground and finish line)
  afterLevelChange() {
    if (this.phase === 'lobby') this.toLobby();
    this.emit({ type: 'settings' });
  }

  // after a won level: on to the next one
  nextLevel() {
    if (this.phase !== 'result' || !this.result?.success || !this.result.next) return false;
    this.levelId = this.result.next;
    if (this.levelId === 'remix') this.remixDef = null;
    this.emit({ type: 'settings' });
    return this.startRound();
  }

  levelsInfo() {
    return {
      mode: this.mode, level: this.levelId, unlocked: this.progress.unlocked, remix: this.remixUnlocked, remixWins: this.progress.remix.wins,
      list: LEVELS.map((l) => ({ id: l.id, name: l.name, icon: l.icon, done: !!this.progress.levels[l.id]?.done, best: this.progress.levels[l.id]?.best ?? null })),
    };
  }

  setSetting(key, value) {
    if (!(key in SETTING_CHOICES) || !SETTING_CHOICES[key].includes(value)) return false;
    if (this.phase !== 'lobby' && this.phase !== 'result') return false;
    this.settings[key] = value;
    if (this.phase === 'lobby') {
      this.timeLeft = this.roundTime();
      this.refreshLobbyLine();
    }
    this.emit({ type: 'settings' });
    return true;
  }

  // ---------- rounds ----------

  // in the lobby the finish line follows the player count; the top bar only moves (with a fresh
  // lobby world) when the line would get too close to it or too far below it
  refreshLobbyLine() {
    const h = this.targetHeight();
    const maxLevel = Math.max(0, ...[...this.players.values()].filter((p) => p.present).map((p) => Math.floor(p.slot / 2)));
    if (maxLevel >= this.sim.layout.levels) { this.newSim(); return; }
    if (h === this.sim.finishHeight) return;
    const gap = this.sim.topY - (this.sim.finishY - this.sim.finishHeight + h);
    if (gap < 5.5 || gap > 8) this.newSim();
    else this.sim.setFinishHeight(h);
  }

  newSim() {
    this.sim = new Sim({ finishHeight: this.targetHeight(), players: Math.max(2, this.activeCount), mods: this.level ? this.level.mods : {} });
    for (const p of this.players.values()) if (p.present) this.sim.addPlayer(p.slot);
  }

  startRound() {
    if (this.phase === 'countdown' || this.activeCount === 0) return false;
    if (this.mode === 'levels' && !this.levelAvailable(this.levelId)) this.levelId = 1;
    if (this.levelId === 'remix' && this.phase !== 'lobby') this.remixDef = null; // a fresh mix each go
    this.round++;
    this.newSim();
    for (const p of this.players.values()) {
      p.inv = this.kitFor(p);
      p.invVersion++;
      p.stats = this.freshStats();
      p.specialsGot = 0;
      p.lastRestock = 0;
    }
    this.result = null;
    this.crossed = false;
    this.overT = 0;
    this.timeLeft = this.roundTime();
    this.nextPower = 25 + this.random() * 15;
    this.lastPowerType = null;
    this.lastRescue = -99;
    this.setPhase('countdown');
    return true;
  }

  // back to free play (to change settings, or wait for more players)
  toLobby() {
    this.newSim();
    for (const p of this.players.values()) { p.inv = this.kitFor(p); p.invVersion++; }
    this.result = null;
    this.timeLeft = this.roundTime();
    this.setPhase('lobby');
  }

  // after a round: put the results away so everyone can see (and knock down) the tower
  smash(on = true) {
    if (this.phase !== 'result') return false;
    this.smashing = on;
    this.emit({ type: 'smash', on });
    return true;
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseT = 0;
    this.smashing = false;
    const handsOff = phase === 'judge' || phase === 'hold';
    for (const c of this.sim.claws.values()) c.enabled = !handsOff;
    this.emit({ type: 'phase', phase });
  }

  get elapsed() { return this.roundTime() - this.timeLeft; }

  step(dt = STEP) {
    this.t += dt;
    this.phaseT += dt;
    if (this.phase === 'countdown') {
      const before = Math.ceil(COUNTDOWN - (this.phaseT - dt));
      const now = Math.ceil(COUNTDOWN - this.phaseT);
      if (now !== before && now > 0) this.emit({ type: 'count', n: now });
      if (this.phaseT >= COUNTDOWN) { this.setPhase('play'); this.emit({ type: 'go' }); }
    } else if (this.phase === 'play' || this.phase === 'hold') {
      const before = Math.ceil(this.timeLeft);
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const now = Math.ceil(this.timeLeft);
      if (now !== before && now <= 10 && now > 0) this.emit({ type: 'tick', n: now });
      if (now !== before && (now === 60 || now === 30)) this.emit({ type: 'warn', n: now });
      if (this.phase === 'hold') this.stepHold(dt);
      else if (this.timeLeft <= 0) {
        this.sim.removeAids();
        this.setPhase('judge');
        this.emit({ type: 'timeup' });
      } else {
        // over the line for 3 s in a row: hands off, and see if it stands for 5 s
        // (not when the finish line moves: there only the end counts)
        this.overT = this.sim.tower.height >= this.earlyGoal() ? (this.overT || 0) + dt : 0;
        if (this.overT >= OVER_TIME) this.startHold();
      }
    } else if (this.phase === 'judge') {
      if (this.phaseT >= JUDGE_TIME) this.finishRound();
    }

    // level mechanics the clock drives: the lava rises over the round; the moving line stops for judging
    const sim = this.sim;
    if (sim.mods.lava) {
      const going = this.phase !== 'lobby' && this.phase !== 'countdown';
      const k = going ? Math.min(1, this.elapsed / (this.roundTime() * sim.mods.lava.rise)) : 0;
      sim.lavaY = -0.6 + (sim.lavaTop + 0.6) * k;
    }
    sim.lineFrozen = this.phase === 'judge' || this.phase === 'result';

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
    // (when the finish line drifts, the tower crossing it back and forth isn't news)
    if (!this.crossed && h >= this.earlyGoal()) { this.crossed = true; this.emit({ type: 'crossed', height: h }); }
    else if (this.crossed && h < this.earlyGoal() - 0.5) { this.crossed = false; this.emit({ type: 'uncrossed', height: h }); }
    // power-ups now and then
    if (this.powerupsOn() && this.elapsed >= this.nextPower && this.timeLeft > 15) {
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
      if (this.phase === 'play' && this.powerupsOn() && this.elapsed - this.lastRescue > 25 && this.timeLeft > 20) {
        this.lastRescue = this.elapsed;
        this.givePowerup(this.random() < 0.5 ? 'sp-scaffold' : 'sp-balloon', true);
      }
    }
    this.emit(e);
  }

  // the height that wins early: the finish line, or when it drifts, the top of its swing
  earlyGoal() { return this.sim.lineAmp ? this.sim.finishBase + this.sim.lineAmp : this.sim.finishHeight; }

  startHold() {
    this.overT = 0;
    this.holdFallT = 0;
    this.sim.removeAids();
    this.setPhase('hold');
    this.emit({ type: 'hold', n: HOLD_TIME });
  }

  stepHold(dt) {
    const before = Math.ceil(HOLD_TIME - (this.phaseT - dt));
    const now = Math.ceil(HOLD_TIME - this.phaseT);
    if (now !== before && now > 0) this.emit({ type: 'holdcount', n: now });
    // fell below the line (for more than a moment): back to building, if there's time left
    this.holdFallT = this.sim.tower.height < this.earlyGoal() - 0.05 ? this.holdFallT + dt : 0;
    if (this.holdFallT > 0.3) {
      this.emit({ type: 'holdfail', height: this.sim.tower.height });
      if (this.timeLeft <= 0) { this.finishRound(); return; }
      this.crossed = false;
      this.setPhase('play');
      return;
    }
    if (this.phaseT >= HOLD_TIME) this.finishRound(true);
  }

  finishRound(early = false) {
    const height = this.sim.tower.height;
    const finish = this.sim.finishHeight;
    const success = height >= finish;
    // stars for speed: 3 for finishing in the first half of the time, 2 within three quarters, 1 otherwise
    const used = this.elapsed / this.roundTime();
    const stars = !success ? 0 : used <= STAR3 ? 3 : used <= STAR2 ? 2 : 1;
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
    this.result = { success, height, finish, stars, roundTime: this.roundTime(), used: this.elapsed, best: this.best, pieces: this.sim.tower.count, players, awards, round: this.round, early: early && success, timeLeft: this.timeLeft };
    if (this.mode === 'levels') this.levelResult(success);
    this.setPhase('result');
    this.emit({ type: 'result', result: this.result });
  }

  // a level won or lost: record it, unlock the next
  levelResult(success) {
    const r = this.result, id = this.levelId, time = Math.round(this.elapsed);
    r.level = { id, name: this.level.name, icon: this.level.icon, time };
    if (!success) return;
    const pr = this.progress;
    if (id === 'remix') {
      pr.remix.wins++;
      r.newBest = pr.remix.best === null || time < pr.remix.best;
      if (r.newBest) pr.remix.best = time;
      r.next = 'remix';
    } else {
      const rec = pr.levels[id] || { done: false, best: null };
      r.newBest = rec.best === null || time < rec.best;
      pr.levels[id] = { done: true, best: r.newBest ? time : rec.best };
      if (id < LEVELS.length) {
        r.unlocked = id + 1 > pr.unlocked ? id + 1 : null;
        pr.unlocked = Math.max(pr.unlocked, id + 1);
        r.next = id + 1;
      } else {
        r.unlocked = 'remix';
        r.next = 'remix';
      }
    }
    this.emit({ type: 'progress', progress: pr });
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
      cd: this.phase === 'countdown' ? Math.max(1, Math.ceil(COUNTDOWN - this.phaseT)) : this.phase === 'hold' ? Math.max(1, Math.ceil(HOLD_TIME - this.phaseT)) : 0,
      h: Math.round(this.sim.tower.height * 10) / 10,
      f: Math.round(this.sim.finishHeight * 10) / 10,
      g: !c ? 0 : c.state === 'holding' ? 2 : c.state === 'closed' ? 1 : 0,
      hn: hold ? PIECES[hold.piece.type].name : '',
      tn: c ? Math.round(c.tension() * 100) / 100 : 0,
      sn: hold ? Math.round(hold.strain * 100) / 100 : 0,
      au: !!c?.auto,
      sb: this.sim.shelfBusy(p.slot),
      ld: this.isLeader(id),
      free: this.phase === 'lobby',
      n: this.activeCount,
      md: this.mode,
      sm: !!this.smashing,
      lv: this.level ? `${this.levelId === 'remix' ? 'Remix' : 'Level ' + this.levelId}: ${this.level.name}` : '',
      bo: c ? Math.max(0, Math.ceil(c.boostUntil - this.sim.time)) : 0,
    };
  }

  inventoryFor(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const lv = this.level;
    return { t: 'inv', v: p.invVersion, kit: lv ? lv.name : p.kit.name, icon: lv ? lv.icon : p.kit.icon, items: p.inv.map((it) => ({ id: it.id, n: it.n, sp: !!it.special })) };
  }
}
