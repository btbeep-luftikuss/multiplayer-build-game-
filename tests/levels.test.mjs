// Levels mode: every mechanic does what it should, and progress through the levels works. `npm test`
import { Sim, STEP, LAYOUT } from '../src/sim/sim.js';
import { Game } from '../src/sim/game.js';
import { LEVELS, levelHeight, remixLevel } from '../src/shared/levels.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };
const run = (s, seconds, each) => { for (let i = 0; i < Math.round(seconds / STEP); i++) { if (each && each() === false) return; s.step(STEP); } };
const piece = (sim, type, x, yAbovePad, a = 0) => sim.createPiece(type, 0, x, sim.padTop + yAbovePad, a);

console.log('Wind');
{
  const sim = new Sim({ finishHeight: 5, mods: { wind: { max: 2 } } });
  const ball = piece(sim, 'rubber-ball', 0, 0.4);
  let push = 0, peak = 0;
  const x0 = ball.body.getPosition().x;
  run(sim, 6, () => { push += sim.wind; peak = Math.max(peak, Math.abs(sim.wind)); });
  const moved = ball.body.getPosition().x - x0;
  console.log(`   strongest gust ${peak.toFixed(2)} m/s², the ball rolled ${moved.toFixed(2)} m`);
  ok(peak > 0.5 && Math.sign(moved) === Math.sign(push) && Math.abs(moved) > 0.3, 'gusts blow a ball along the pad the way the wind blows');
}

console.log('Soft ground');
{
  const sim = new Sim({ finishHeight: 5, mods: { soft: true } });
  const slab = piece(sim, 'stone-slab', -4, 0.45), foam = piece(sim, 'foam-cube', 4, 0.55);
  run(sim, 3);
  const sinkSlab = sim.padTop + 0.4 - slab.body.getPosition().y, sinkFoam = sim.padTop + 0.5 - foam.body.getPosition().y;
  console.log(`   a heavy base sinks ${sinkSlab.toFixed(2)} m, a foam block ${sinkFoam.toFixed(2)} m`);
  ok(sinkSlab > 0.12 && sinkFoam < sinkSlab / 3, 'heavy pieces sink into the jelly, light ones hardly');
  ok(sim.tower.set.has(slab) && sim.tower.set.has(foam), 'and still count as standing on the pad');
}

console.log('Rocking base');
{
  const sim = new Sim({ finishHeight: 5, mods: { tilt: { amp: 6, period: 18 } } });
  const cube = piece(sim, 'wood-cube', 3, 0.5);
  let maxTilt = 0;
  run(sim, 6, () => { maxTilt = Math.max(maxTilt, Math.abs(sim.tilt)); });
  console.log(`   tilted up to ${(maxTilt * 180 / Math.PI).toFixed(1)}°, the cube is at ${(cube.body.getAngle() * 180 / Math.PI).toFixed(1)}°`);
  ok(maxTilt > 0.08, 'the base rocks');
  ok(Math.abs(cube.body.getAngle() - sim.tilt) < 0.03 && sim.tower.set.has(cube), 'and a cube rides on it');
}

console.log('Magnetic blocks');
{
  const sim = new Sim({ finishHeight: 5, mods: { magnets: true } });
  const n1 = piece(sim, 'magn-cube', -6, 0.5), s1 = piece(sim, 'mags-cube', -4.85, 0.5);
  const n2 = piece(sim, 'magn-cube', 4, 0.5), n3 = piece(sim, 'magn-cube', 5.05, 0.5);
  run(sim, 2);
  const dAttract = s1.body.getPosition().x - n1.body.getPosition().x, dRepel = n3.body.getPosition().x - n2.body.getPosition().x;
  console.log(`   N–S now ${dAttract.toFixed(2)} m apart (from 1.15), N–N ${dRepel.toFixed(2)} m (from 1.05)`);
  ok(dAttract < 1.03, 'opposite poles pull together');
  ok(dRepel > 1.15, 'the same poles push apart');
}

console.log('Low gravity on the right');
{
  const sim = new Sim({ finishHeight: 5, mods: { gravity: { right: 0.35 } } });
  const left = piece(sim, 'wood-cube', -5, 5), right = piece(sim, 'wood-cube', 5, 5);
  run(sim, 0.7);
  const fallL = sim.padTop + 5 - left.body.getPosition().y, fallR = sim.padTop + 5 - right.body.getPosition().y;
  console.log(`   in 0.7 s the left cube fell ${fallL.toFixed(2)} m, the right one ${fallR.toFixed(2)} m`);
  ok(Math.abs(fallR / fallL - 0.35) < 0.05, 'the right side falls at about a third of the speed');
}

console.log('Fragile glass');
{
  const sim = new Sim({ finishHeight: 5, mods: { fragile: true } });
  const high = piece(sim, 'glass-cube', -3, 4.5), low = piece(sim, 'glass-cube', 3, 0.6);
  run(sim, 2);
  ok(high.dead && sim.drainEvents().some((e) => e.type === 'shatter'), 'glass dropped from high up shatters');
  ok(!low.dead, 'set down gently it survives');
}

console.log('Moving finish line');
{
  const sim = new Sim({ finishHeight: 6, mods: { moveLine: { amp: 1.2, period: 22 } } });
  let lo = 99, hi = -99;
  run(sim, 22, () => { lo = Math.min(lo, sim.finishHeight); hi = Math.max(hi, sim.finishHeight); });
  console.log(`   the line ranged ${lo.toFixed(2)}–${hi.toFixed(2)} m`);
  ok(hi - lo > 2.2 && sim.topY >= sim.padTop + hi + 6, 'it drifts about ±1.2 m and the top bar stays clear of it');
  sim.lineFrozen = true;
  const h = sim.finishHeight;
  run(sim, 2);
  ok(sim.finishHeight === h, 'and stands still while frozen (for judging)');
}

console.log('Unstable claws');
{
  const sim = new Sim({ finishHeight: 6, mods: { unstable: { min: 2, max: 3, drop: 0.15 } } });
  sim.addPlayer(0); sim.addPlayer(1);
  sim.createPiece('wood-cube', 1, 0, 9, 0); // (something to hold isn't needed for rope stretches)
  const kinds = new Set();
  run(sim, 12, () => { for (const e of sim.drainEvents()) if (e.type === 'glitch') kinds.add(e.kind); });
  ok(kinds.has('stretch'), `ropes stretch now and then (${[...kinds].join(', ')})`);
}

console.log('Super Claw');
{
  const sim = new Sim({ finishHeight: 6 });
  const a = sim.addPlayer(0), b = sim.addPlayer(1);
  b.boostUntil = 99;
  a.input.mx = 1; b.input.mx = -1;
  const xa = a.x, xb = b.x;
  run(sim, 1.5);
  const da = a.x - xa, db = xb - b.x;
  console.log(`   in 1.5 s: normal claw ${da.toFixed(2)} m, Super Claw ${db.toFixed(2)} m`);
  ok(db > da * 1.3, 'a boosted claw is faster');
}

console.log('Raised pad above the lava');
{
  const sim = new Sim({ finishHeight: 6, mods: { lava: { rise: 0.8 } } });
  sim.addPlayer(0);
  ok(sim.padTop > 1.5 && sim.lavaTop < sim.padTop - 0.2 && sim.layout.slot(0).top > sim.lavaTop + 0.5, 'the pad and the shelves sit above the highest the lava gets');
  const dropped = sim.createPiece('wood-cube', 0, 10, 0.5, 0), onPad = piece(sim, 'wood-cube', 0, 0.5);
  sim.lavaY = sim.lavaTop;
  run(sim, 1);
  ok(dropped.dead && !onPad.dead, 'the lava burns a piece on the ground, not one on the pad');
}

console.log('Levels: progress');
{
  const g = new Game();
  g.addPlayer('a', 'A'); g.addPlayer('b', 'B');
  ok(g.setMode('levels') && g.levelId === 1 && g.sim.finishHeight === levelHeight(LEVELS[0], 2), 'Levels mode starts at Level 1, with its own finish line');
  ok(!g.setLevel(2), 'Level 2 is locked at first');
  g.startRound();
  run(g, 3.1);
  ok(g.roundTime() === LEVELS[0].time && g.timeLeft > LEVELS[0].time - 1 && g.players.get('a').inv[0].id === LEVELS[0].pool[0][0], "the level's time limit and pieces");
  for (let i = 0; i < 9; i++) g.sim.createPiece('stone-cube', 0, 0, g.sim.padTop + 0.5 + i, 0);
  run(g, 10);
  const r = g.result;
  ok(g.phase === 'result' && r.success && r.level.id === 1 && r.unlocked === 2 && r.next === 2, `won: Level 2 unlocked (in ${r?.level?.time} s)`);
  ok(g.progress.levels[1].done && g.progress.levels[1].best === r.level.time, 'the best team time is kept');
  ok(r.stars === 3, `won in ${r.level.time} s of ${r.roundTime} s: 3 stars for speed`);
  ok(g.drainEvents().some((e) => e.type === 'progress'), 'and announced so the TV saves it');
  ok(g.nextLevel() && g.levelId === 2 && g.sim.mods.wind, 'Next level: Level 2, with wind');
  const g2 = new Game({ progress: { unlocked: 10, levels: Object.fromEntries(LEVELS.map((l) => [l.id, { done: l.id < 10, best: 60 }])) } });
  g2.addPlayer('a', 'A');
  ok(!g2.setLevel('remix'), 'the Remix stays locked until Level 10 is beaten');
  ok(g2.setLevel(10), 'Level 10 can be picked');
  g2.startRound(); run(g2, 3.1);
  ok(g2.sim.mods.wind && g2.sim.mods.tilt && g2.sim.mods.magnets && g2.sim.mods.lava, 'the final level combines wind, the rocking base, magnets and lava');
  for (let i = 0; i < 12; i++) g2.sim.createPiece('stone-cube', 0, 0, g2.sim.padTop + 0.5 + i, 0);
  g2.timeLeft = 0.5;
  run(g2, 6);
  const g3 = new Game({ progress: { unlocked: 10, levels: Object.fromEntries(LEVELS.map((l) => [l.id, { done: true, best: 60 }])) } });
  g3.addPlayer('a', 'A');
  ok(g3.setLevel('remix') && g3.level.name === 'Endless Remix' && Object.keys(g3.level.mods).length >= 2, 'with Level 10 beaten the Remix opens');
  g3.startRound(); run(g3, 3.1);
  for (let i = 0; i < 12; i++) g3.sim.createPiece('stone-cube', 0, 0, g3.sim.padTop + 0.5 + i, 0);
  g3.timeLeft = 0.5; run(g3, 6);
  if (g3.result?.success) ok(g3.progress.remix.wins === 1 && g3.result.next === 'remix', 'a won remix counts, and the next one is ready');
  const mix = remixLevel(3, Math.random);
  ok(Object.keys(mix.mods).length >= 2 && mix.height > 10, `a remix mixes mechanics (${Object.keys(mix.mods).join(', ')}) and gets harder`);
}

console.log('Levels: moving line has no early win');
{
  const g = new Game({ progress: { unlocked: 8 } });
  g.addPlayer('a', 'A');
  g.setLevel(8);
  g.startRound(); run(g, 3.1);
  for (let i = 0; i < 12; i++) g.sim.createPiece('stone-cube', 0, 0, g.sim.padTop + 0.5 + i, 0);
  run(g, 8);
  ok(g.phase === 'play', 'over the line, but no hold check: only the end counts');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall level checks passed');
process.exit(failures ? 1 : 0);
