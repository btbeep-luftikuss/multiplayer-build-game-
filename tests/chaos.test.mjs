// Chaos test, run in Node: several "players" mash every control at random through whole rounds
// (joining and leaving too), checking nothing throws, nothing ends up NaN, and the rules hold.
import { Game } from '../src/sim/game.js';
import { STEP } from '../src/sim/sim.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const g = new Game({ random: rnd });
const ids = [];
for (let i = 0; i < 6; i++) { ids.push('p' + i); g.addPlayer('p' + i, 'P' + i); }
g.settings.roundTime = 60;
let problems = [];
const check = (where) => {
  for (const p of g.sim.pieces) {
    const pos = p.body.getPosition();
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(p.body.getAngle())) problems.push(`${where}: piece ${p.type} has a bad position`);
    if (p.parked && p.heldBy.size) problems.push(`${where}: a held piece is still parked`);
  }
  for (const c of g.sim.claws.values()) {
    const pos = c.body.getPosition();
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) problems.push(`${where}: claw ${c.slot} has a bad position`);
    if (c.hold && c.hold.piece.dead) problems.push(`${where}: claw ${c.slot} holds a removed piece`);
    if (Math.abs(c.x) > g.sim.layout.groundHalf) problems.push(`${where}: trolley ${c.slot} ran off the bar`);
  }
  for (const p of g.players.values()) for (const it of p.inv) if (it.n < 0) problems.push(`${where}: negative piece count`);
};

let rounds = 0, results = [];
try {
  for (let r = 0; r < 4; r++) {
    g.startRound();
    rounds++;
    let steps = 0;
    while (g.phase !== 'result' && steps < 60 * 90) {
      for (const id of ids) {
        if (!g.players.has(id)) continue;
        const x = rnd();
        if (x < 0.02) g.input(id, rnd() * 2 - 1, rnd() * 2 - 1);
        else if (x < 0.024) g.spawn(id, Math.floor(rnd() * 8), Math.floor(rnd() * 8) * Math.PI / 4);
        else if (x < 0.027) g.grab(id);
        else if (x < 0.029) g.drop(id);
        else if (x < 0.031) { g.rotate(id, rnd() < 0.5 ? 1 : -1); g.rotateEnd(id); }
        else if (x < 0.0312) g.input(id, NaN, Infinity); // junk from a broken phone
        else if (x < 0.0313) g.spawn(id, 999, NaN);
      }
      if (steps === 600 && r === 1) { g.setConnected('p5', false); }
      if (steps === 900 && r === 1) { g.addPlayer('late', 'Late'); ids.push('late'); }
      if (steps === 1200 && r === 2) g.removePlayer('p4');
      if (steps % 300 === 0 && g.phase === 'play' && rnd() < 0.3) g.givePowerup(null, false);
      g.step(STEP);
      g.drainEvents();
      steps++;
      if (steps % 60 === 0) check(`round ${r + 1}, ${Math.round(steps / 60)} s`);
    }
    results.push(g.result ? `${g.result.success ? 'win' : 'fail'}${g.result.early ? ' (early)' : ''} at ${g.result.height.toFixed(1)} m` : `no result after ${steps} steps (${g.phase})`);
  }
} catch (err) {
  problems.push('threw: ' + (err.stack || err));
}
console.log(`   ${rounds} rounds: ${results.join(', ')}`);
problems = [...new Set(problems)];
ok(problems.length === 0, `no crashes or broken state${problems.length ? ':\n   ' + problems.slice(0, 8).join('\n   ') : ''}`);
ok(results.length === 4 && results.every((x) => !x.startsWith('no result')), 'every round reaches its result');
console.log(failures ? `\n${failures} check(s) failed` : '\nchaos test passed');
process.exit(failures ? 1 : 0);
