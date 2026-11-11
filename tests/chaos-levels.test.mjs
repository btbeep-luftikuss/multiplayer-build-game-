// Chaos in every level: random players mash every control through each level (and the remix), joining
// and leaving, while invariants are checked. `npm test`
import { Game } from '../src/sim/game.js';
import { STEP } from '../src/sim/sim.js';
import { LEVELS } from '../src/shared/levels.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };
let seed = 777;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const problems = new Set();
const allDone = Object.fromEntries(LEVELS.map((l) => [l.id, { done: true, best: 99 }]));
for (const id of [...LEVELS.map((l) => l.id), 'remix']) {
  const g = new Game({ random: rnd, progress: { unlocked: LEVELS.length, levels: allDone } });
  const ids = [];
  for (let i = 0; i < 4; i++) { ids.push('p' + i); g.addPlayer('p' + i, 'P' + i); }
  g.setLevel(id);
  g.startRound();
  const where = `level ${id}`;
  let steps = 0;
  const cap = 60 * (g.roundTime() + 15);
  try {
    while (g.phase !== 'result' && steps < cap) {
      for (const pid of ids) {
        if (!g.players.has(pid)) continue;
        const x = rnd();
        if (x < 0.03) g.input(pid, rnd() * 2 - 1, rnd() * 2 - 1);
        else if (x < 0.036) g.spawn(pid, Math.floor(rnd() * 8), Math.floor(rnd() * 8) * Math.PI / 4);
        else if (x < 0.04) g.grab(pid);
        else if (x < 0.043) g.drop(pid);
        else if (x < 0.045) { g.rotate(pid, rnd() < 0.5 ? 1 : -1); g.rotateEnd(pid); }
      }
      // build a bit of tower now and then, so towers get tested on every base
      if (steps % 240 === 120 && g.phase === 'play') g.sim.createPiece(rnd() < 0.5 ? 'wood-cube' : 'stone-slab', 0, (rnd() - 0.5) * 3, g.sim.padTop + 0.6 + g.sim.tower.height, 0);
      if (steps === 900) g.setConnected('p3', false);
      if (steps === 1500) g.removePlayer('p2');
      if (steps === 1800) { g.addPlayer('late', 'Late'); ids.push('late'); }
      if (steps % 400 === 0 && g.phase === 'play') g.givePowerup(null, false);
      g.step(STEP);
      g.drainEvents();
      steps++;
      if (steps % 30) continue;
      const s = g.sim;
      for (const p of s.pieces) {
        const pos = p.body.getPosition();
        if (!Number.isFinite(pos.x + pos.y + p.body.getAngle())) problems.add(`${where}: a piece has a bad position`);
        // nothing should end up inside the pad or the mesa under it
        if (Math.abs(pos.x) < s.layout.padHalf - 0.6 && Math.abs(pos.x) > s.split / 2 + 0.6 && pos.y < s.padTop - 1.2 - (s.mods.hill ? s.mods.hill.slope * s.layout.padHalf : 0) && pos.y > -0.5 && !s.mods.soft && !s.mods.tilt) problems.add(`${where}: a ${p.type} fell into the pad (y ${pos.y.toFixed(2)})`);
        if (p.parked && !s.platforms.has(p.owner)) problems.add(`${where}: a waiting piece floats where a shelf was`);
        if (p.parked && p.heldBy.size) problems.add(`${where}: a held piece is still parked`);
      }
      for (const c of s.claws.values()) {
        const pos = c.body.getPosition();
        if (!Number.isFinite(pos.x + pos.y)) problems.add(`${where}: claw ${c.slot} has a bad position`);
        if (pos.y > s.topY + 0.5) problems.add(`${where}: claw ${c.slot} above the bar`);
        if (pos.y < -0.5) problems.add(`${where}: claw ${c.slot} below the ground`);
        if (c.hold && c.hold.piece.dead) problems.add(`${where}: claw ${c.slot} holds a removed piece`);
      }
      if (!Number.isFinite(s.tower.height) || s.tower.height < 0) problems.add(`${where}: bad tower height`);
    }
  } catch (err) {
    problems.add(`${where}: threw ${err.stack || err}`);
  }
  if (g.phase !== 'result') problems.add(`${where}: no result after ${Math.round(steps / 60)} s (${g.phase})`);
  console.log(`   ${where}: ${g.result ? (g.result.success ? 'won' : 'lost') + ` at ${g.result.height.toFixed(1)} m` : g.phase}`);
}
ok(problems.size === 0, `no glitches in any level${problems.size ? ':\n   ' + [...problems].slice(0, 12).join('\n   ') : ''}`);
console.log(failures ? `\n${failures} check(s) failed` : '\nlevel chaos test passed');
process.exit(failures ? 1 : 0);
