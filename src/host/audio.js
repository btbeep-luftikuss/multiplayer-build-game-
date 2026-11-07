// Every sound is made on the spot with the Web Audio API (no sound files): clunks that depend on the
// material, claw clicks, the countdown, the drumroll, win and fail stings, and a little music loop
// that speeds up in the last 30 seconds. Browsers only allow sound after a click or key press.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note number to Hz

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.recent = [];
    this.fast = false;
    this.step16 = 0;
    this.nextNoteTime = 0;
    this.reelLevel = 0;
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 5;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(comp);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.16 : 0;
      this.musicBus.connect(this.master);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.startReel();
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      setInterval(() => this.scheduleMusic(), 50);
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }
  setMusic(on) { this.musicOn = on; if (this.musicBus) this.musicBus.gain.value = on ? 0.16 : 0; }

  // ---------- building blocks ----------

  tone({ type = 'sine', f = 440, f2 = 0, dur = 0.2, vol = 0.3, attack = 0.004, when = 0, out = this.master, lp = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) { const fl = this.ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    node.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.1, vol = 0.3, type = 'bandpass', freq = 1000, q = 1, when = 0, out = this.master, sweep = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // not too many sounds at once
  allow(max = 10) {
    const now = performance.now();
    this.recent = this.recent.filter((t) => now - t < 120);
    if (this.recent.length >= max) return false;
    this.recent.push(now);
    return true;
  }

  // ---------- game sounds ----------

  impact(mat, strength, mass) {
    if (!this.ready || !this.allow()) return;
    const v = Math.min(0.5, 0.06 + strength * 0.45) * (0.7 + Math.min(1, mass / 6) * 0.5);
    const low = 1 / Math.sqrt(Math.max(0.3, mass)); // heavier: lower
    switch (mat) {
      case 'wood':
        this.noise({ dur: 0.07, vol: v, freq: 900 * low + 300, q: 2.5 });
        this.tone({ type: 'triangle', f: 260 * low + 90, f2: 120, dur: 0.11, vol: v * 0.7 });
        break;
      case 'stone': case 'clay':
        this.noise({ dur: 0.12, vol: v, type: 'lowpass', freq: 700, q: 0.8 });
        this.tone({ f: 110 * low + 50, f2: 50, dur: 0.16, vol: v });
        break;
      case 'metal': case 'gold': case 'magnet': case 'scaffold':
        for (const k of [1, 1.51, 2.39]) this.tone({ f: (620 * low + 300) * k, dur: 0.35 / k, vol: v * 0.35 });
        this.noise({ dur: 0.03, vol: v * 0.6, type: 'highpass', freq: 3000 });
        break;
      case 'rubber':
        this.tone({ f: 340, f2: 120, dur: 0.2, vol: v * 0.9 });
        break;
      case 'glass': case 'ice':
        this.tone({ f: 2300, dur: 0.25, vol: v * 0.3 });
        this.tone({ f: 3450, dur: 0.18, vol: v * 0.2 });
        this.noise({ dur: 0.04, vol: v * 0.3, type: 'highpass', freq: 4000 });
        break;
      case 'goo':
        this.noise({ dur: 0.15, vol: v, type: 'lowpass', freq: 500, sweep: 150 });
        this.tone({ f: 220, f2: 70, dur: 0.18, vol: v * 0.6 });
        break;
      default: // soft things
        this.noise({ dur: 0.09, vol: v * 0.8, type: 'lowpass', freq: 450 });
        this.tone({ f: 160, f2: 90, dur: 0.1, vol: v * 0.5 });
    }
  }

  // a piece settles into the tower: the satisfying clunk
  clunk() {
    this.tone({ f: 150, f2: 62, dur: 0.16, vol: 0.5 });
    this.noise({ dur: 0.05, vol: 0.35, freq: 1700, q: 3 });
    this.tone({ type: 'triangle', f: 1180, dur: 0.12, vol: 0.08, when: 0.05 });
    this.tone({ type: 'triangle', f: 1770, dur: 0.16, vol: 0.06, when: 0.09 });
  }

  grab() {
    this.noise({ dur: 0.03, vol: 0.3, freq: 2400, q: 4 });
    this.tone({ type: 'square', f: 190, f2: 110, dur: 0.08, vol: 0.08, lp: 1200 });
    this.tone({ f: 95, dur: 0.1, vol: 0.25, when: 0.03 });
  }

  release() {
    this.noise({ dur: 0.09, vol: 0.18, type: 'highpass', freq: 1800 });
    this.noise({ dur: 0.02, vol: 0.2, freq: 2600, q: 5 });
  }

  miss() {
    this.noise({ dur: 0.025, vol: 0.3, freq: 2600, q: 6 });
    this.noise({ dur: 0.025, vol: 0.25, freq: 2200, q: 6, when: 0.07 });
  }

  spawn() {
    this.tone({ f: 320, f2: 950, dur: 0.14, vol: 0.18 });
    this.tone({ type: 'triangle', f: 1400, dur: 0.1, vol: 0.06, when: 0.08 });
  }

  pop() { this.noise({ dur: 0.06, vol: 0.5, freq: 1300, q: 1 }); this.tone({ f: 600, f2: 200, dur: 0.08, vol: 0.15 }); }

  turn() { this.tone({ type: 'triangle', f: 500, f2: 700, dur: 0.07, vol: 0.12 }); }

  weld() { this.noise({ dur: 0.18, vol: 0.25, type: 'lowpass', freq: 900, sweep: 200 }); this.tone({ f: 180, f2: 90, dur: 0.15, vol: 0.2 }); }

  anchor() { this.tone({ type: 'square', f: 90, dur: 0.18, vol: 0.12, lp: 600 }); this.noise({ dur: 0.2, vol: 0.25, type: 'lowpass', freq: 500 }); }

  powerup() {
    [72, 76, 79, 84, 88].forEach((n, i) => this.tone({ type: 'triangle', f: NOTE(n), dur: 0.18, vol: 0.18, when: i * 0.07 }));
  }

  count(n) { this.tone({ type: 'square', f: n === 1 ? 880 : 660, dur: 0.14, vol: 0.14, lp: 3000 }); }

  go() {
    for (const n of [72, 76, 79, 84]) this.tone({ type: 'sawtooth', f: NOTE(n), dur: 0.6, vol: 0.09, lp: 2500 });
    this.noise({ dur: 0.5, vol: 0.2, type: 'highpass', freq: 5000 });
  }

  tick(n) {
    const hi = n <= 3;
    this.noise({ dur: 0.05, vol: hi ? 0.4 : 0.28, freq: hi ? 2400 : 1800, q: 9 });
    this.tone({ f: hi ? 1300 : 1000, dur: 0.05, vol: 0.1 });
  }

  warn() { this.tone({ type: 'square', f: 520, dur: 0.12, vol: 0.1, lp: 2000 }); this.tone({ type: 'square', f: 520, dur: 0.12, vol: 0.1, lp: 2000, when: 0.18 }); }

  timeup() {
    this.tone({ type: 'sawtooth', f: 165, dur: 0.9, vol: 0.22, lp: 900 });
    this.tone({ type: 'sawtooth', f: 175, dur: 0.9, vol: 0.18, lp: 900 });
  }

  drumroll(seconds = 3.8) {
    for (let t = 0; t < seconds; t += 0.045) this.noise({ dur: 0.04, vol: 0.05 + 0.2 * (t / seconds), type: 'highpass', freq: 1400, when: 0.5 + t });
  }

  win() {
    const mel = [[72, 0], [76, 0.14], [79, 0.28], [84, 0.42]];
    for (const [n, w] of mel) this.tone({ type: 'square', f: NOTE(n), dur: 0.2, vol: 0.1, when: w, lp: 3500 });
    for (const n of [84, 88, 91]) this.tone({ type: 'triangle', f: NOTE(n), dur: 1.4, vol: 0.14, when: 0.6 });
    this.noise({ dur: 1.2, vol: 0.18, type: 'highpass', freq: 6000, when: 0.6 });
  }

  fail() {
    const notes = [67, 66, 65, 64];
    notes.forEach((n, i) => this.tone({ type: 'sawtooth', f: NOTE(n), f2: i === 3 ? NOTE(n) * 0.85 : 0, dur: i === 3 ? 1.1 : 0.42, vol: 0.13, when: i * 0.45, lp: 1100 }));
  }

  crash() {
    this.noise({ dur: 1.3, vol: 0.55, type: 'lowpass', freq: 600, sweep: 120 });
    for (let i = 0; i < 7; i++) this.noise({ dur: 0.07, vol: 0.25, freq: 600 + Math.random() * 900, q: 2, when: Math.random() * 0.8 });
    this.tone({ f: 70, f2: 35, dur: 0.8, vol: 0.4 });
  }

  creak() { this.tone({ type: 'sawtooth', f: 70 + Math.random() * 30, f2: 50, dur: 0.35, vol: 0.06, lp: 700 }); }

  join() { this.tone({ type: 'triangle', f: NOTE(79), dur: 0.12, vol: 0.15 }); this.tone({ type: 'triangle', f: NOTE(86), dur: 0.2, vol: 0.15, when: 0.1 }); }

  // one shared whirr for every rope being reeled
  startReel() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 6;
    const g = this.ctx.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start();
    this.reel = { f, g };
  }

  setReel(level) {
    if (!this.reel) return;
    this.reelLevel += (level - this.reelLevel) * 0.2;
    const t = this.ctx.currentTime;
    this.reel.g.gain.setTargetAtTime(Math.min(0.12, this.reelLevel * 0.025), t, 0.05);
    this.reel.f.frequency.setTargetAtTime(500 + Math.min(900, this.reelLevel * 120), t, 0.05);
  }

  // ---------- music: C - Am - F - G, bass, plucks and hats ----------

  scheduleMusic() {
    if (!this.ready) return;
    const bpm = this.fast ? 150 : 118;
    const s16 = 60 / bpm / 4;
    const chords = [[48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62]];
    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      const when = this.nextNoteTime - this.ctx.currentTime;
      const i = this.step16 % 64;
      const chord = chords[Math.floor(i / 16)];
      const beat = i % 16;
      const out = this.musicBus;
      if (beat % 4 === 0) this.tone({ type: 'triangle', f: NOTE(chord[0] - 12 + (beat === 8 ? 7 : 0)), dur: s16 * 3, vol: 0.5, when, out });
      if (beat % 4 === 2) for (const n of chord.slice(1)) this.tone({ type: 'square', f: NOTE(n), dur: s16 * 1.4, vol: 0.06, when, out, lp: 1800 });
      if (beat % 2 === 1) this.noise({ dur: 0.03, vol: 0.12, type: 'highpass', freq: 7000, when, out });
      if (beat === 4 || beat === 12) this.noise({ dur: 0.1, vol: 0.18, freq: 1800, q: 0.7, when, out });
      if ([0, 3, 6, 10].includes(beat) && Math.floor(i / 32) % 2 === 1) this.tone({ type: 'triangle', f: NOTE(chord[1 + (beat % 3)] + 12), dur: s16 * 1.8, vol: 0.2, when, out });
      this.nextNoteTime += s16;
      this.step16++;
    }
  }

  // what each game event sounds like
  onEvent(e) {
    switch (e.type) {
      case 'impact': this.impact(e.mat, e.strength, e.mass); break;
      case 'lock': this.clunk(); break;
      case 'grab': this.grab(); break;
      case 'release': this.release(); break;
      case 'miss': this.miss(); break;
      case 'spawn': this.spawn(); break;
      case 'turn': this.turn(); break;
      case 'remove': if (e.reason === 'pop') this.pop(); else if (e.reason === 'expired' || e.reason === 'aid') this.pop(); break;
      case 'weld': this.weld(); break;
      case 'anchor': this.anchor(); break;
      case 'powerup': this.powerup(); break;
      case 'count': this.count(e.n); break;
      case 'phase': if (e.phase === 'countdown') this.count(3); this.fast = false; break;
      case 'go': this.go(); break;
      case 'tick': this.tick(e.n); break;
      case 'warn': this.warn(); if (e.n === 30) this.fast = true; break;
      case 'timeup': this.timeup(); this.drumroll(); break;
      case 'hold': this.warn(); this.drumroll(4.8); break;
      case 'burn': this.noise({ dur: 0.5, vol: 0.3, type: 'highpass', freq: 2500, sweep: 6000 }); this.tone({ f: 120, f2: 60, dur: 0.3, vol: 0.15 }); break;
      case 'shatter': for (let i = 0; i < 6; i++) this.tone({ f: 2000 + Math.random() * 3000, dur: 0.2, vol: 0.08, when: i * 0.03 }); this.noise({ dur: 0.15, vol: 0.3, type: 'highpass', freq: 3500 }); break;
      case 'glitch': this.tone({ type: 'square', f: 300, f2: 120, dur: 0.25, vol: 0.1, lp: 1500 }); break;
      case 'boost': this.tone({ type: 'sawtooth', f: 200, f2: 1600, dur: 0.5, vol: 0.12, lp: 3000 }); this.powerup(); break;
      case 'holdcount': this.tick(e.n); break;
      case 'holdfail': this.crash(); break;
      case 'collapse': this.crash(); break;
      case 'crossed': this.powerup(); break;
      case 'result': if (e.result.success) this.win(); else this.fail(); break;
      case 'join': case 'rejoin': this.join(); break;
      default: break;
    }
  }
}
