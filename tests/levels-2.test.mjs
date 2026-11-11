// Levels 11-20: every new mechanic does what it should, and every level can be won. `npm test`
import { Sim, STEP } from '../src/sim/sim.js';
import { Game } from '../src/sim/game.js';
import { LEVELS, REMIX_AFTER, remixLevel } from '../src/shared/levels.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };
const run = (s, seconds, each) => { for (let i = 0; i < Math.round(seconds / STEP); i++) { if (each && each() === false) return; s.step(STEP); } };
const mods = (id) => LEVELS.find((l) => l.id === id).mods;
// drop pieces one at a time onto the top of what's there (at x), letting each settle
const stackUp = (sim, types, x = 0, settle = 1.2) => { for (const t of types) { sim.createPiece(t, 0, x, sim.padTop + sim.tower.height + 0.9, 0); run(sim, settle); } return sim.tower.height; };
const allDone = (upTo) => ({ levels: Object.fromEntries(LEVELS.filter((l) => l.id <= upTo).map((l) => [l.id, { done: true, best: 60 }])) });

ok(LEVELS.length === 20 && LEVELS.every((l, i) => l.id === i + 1), 'there are twenty levels, numbered 1 to 20');
ok(new Set(LEVELS.map((l) => JSON.stringify(l.pool.map(([id]) => id).sort()))).size === 20, 'each has its own set of pieces');

console.log('Level 11, Frozen Lake: slippery');
{
  const sim = new Sim({ finishHeight: 9, mods: mods(11) });
  const ice = sim.createPiece('ice-cube', 0, -3, sim.padTop + 0.5, 0), rub = sim.createPiece('rubber-cube', 0, 3, sim.padTop + 0.5, 0);
  run(sim, 1);
  ice.body.setLinearVelocity({ x: 3, y: 0 }); rub.body.setLinearVelocity({ x: 3, y: 0 });
  const a = ice.body.getPosition().x, b = rub.body.getPosition().x;
  run(sim, 3);
  const di = ice.body.getPosition().x - a, dr = rub.body.getPosition().x - b;
  console.log(`   pushed the same: an ice cube slid ${di.toFixed(2)} m, a rubber cube ${dr.toFixed(2)} m`);
  ok(di > 1.5 && dr < di / 3, 'pieces slide on the ice, rubber grips');
  const s2 = new Sim({ finishHeight: 9, mods: mods(11) });
  const h = stackUp(s2, ['rubber-mat', 'ice-cube', 'ice-cube', 'rubber-cube', 'ice-cube', 'wood-cup', 'ice-cube', 'ice-cube']);
  ok(s2.tower.count === 8 && h > 6.3, `a careful stack still stands on the ice (all 8 pieces, ${h.toFixed(1)} m: a cube sits down inside the cup)`);
}

console.log('Level 12, Hillside: sloping ground');
{
  const sim = new Sim({ finishHeight: 10, mods: mods(12) });
  const k = mods(12).hill.slope, half = sim.layout.padHalf;
  let lo = Infinity, hi = -Infinity;
  sim.world.rayCast({ x: -half + 0.2, y: 20 }, { x: -half + 0.2, y: -1 }, (f, p, n, fr) => { lo = p.y; return fr; });
  sim.world.rayCast({ x: half - 0.2, y: 20 }, { x: half - 0.2, y: -1 }, (f, p, n, fr) => { hi = p.y; return fr; });
  ok(Math.abs(hi - lo - k * 2 * (half - 0.2)) < 0.05 && lo > 0.25, `the pad slopes up to the right (${lo.toFixed(2)} m to ${hi.toFixed(2)} m)`);
  const shim = sim.createPiece('wood-shim', 0, -2, sim.padTop - 2 * k + 0.7, 0);
  run(sim, 2);
  ok(Math.abs(shim.body.getAngle()) < 0.02 && sim.tower.set.has(shim), 'a Leveller sits on the slope with its top level');
  const h = stackUp(sim, Array(7).fill('stone-cube'), -2);
  ok(h > 6, `and a tower stands straight on it (${h.toFixed(1)} m)`);
  const ball = sim.createPiece('rubber-ball', 0, 4, sim.padTop + 4 * k + 0.6, 0);
  const x0 = ball.body.getPosition().x;
  run(sim, 2);
  ok(ball.body.getPosition().x < x0 - 1, 'a ball rolls downhill');
}

console.log('Level 13, Conveyor Belt');
{
  const sim = new Sim({ finishHeight: 10, mods: mods(13) });
  const h0 = stackUp(sim, Array(5).fill('crate'));
  let lo = Infinity, hi = -Infinity;
  run(sim, mods(13).conveyor.period, () => { lo = Math.min(lo, sim.tower.x); hi = Math.max(hi, sim.tower.x); });
  console.log(`   the tower rode from x ${lo.toFixed(2)} to ${hi.toFixed(2)}`);
  ok(hi - lo > 2.5 && sim.tower.height > h0 - 0.2, 'the belt carries a tower one way and back, and it stays standing');
  ok(sim.padBodies.every((pb) => Math.abs(pb.body.getPosition().x - pb.x0) < 1e-6 && Math.abs(pb.body.getPosition().y) < 1e-6), 'the pad itself stays put (only its surface moves)');
  const end = sim.createPiece('crate', 0, sim.layout.padHalf - 0.8, sim.padTop + 0.75, 0);
  let gone = false;
  run(sim, 20, () => { if (end.dead || end.body.getPosition().x > sim.layout.padHalf + 0.5) gone = true; });
  ok(gone, 'a crate left at the end of the belt is carried off it');
}

console.log('Level 14, Earthquake');
{
  const sim = new Sim({ finishHeight: 10, mods: mods(14) });
  run(sim, 30);
  ok(!sim.quaking && sim.quakeX === 0, 'no quakes in the lobby');
  stackUp(sim, Array(9).fill('stone-big'));
  const h0 = sim.tower.height;
  const ev = [];
  sim.hazards = true;
  sim.quake.next = sim.time + 3;
  let most = 0;
  run(sim, 9, () => { most = Math.max(most, Math.abs(sim.quakeX || 0)); for (const e of sim.drainEvents()) ev.push(e.type); });
  ok(ev.indexOf('quakewarn') >= 0 && ev.indexOf('quakewarn') < ev.indexOf('quake'), 'a warning comes first, then the quake');
  ok(most > 0.08, `the ground shakes (${most.toFixed(2)} m)`);
  ok(sim.tower.height > h0 - 0.3, `a tower of big blocks rides it out (${h0.toFixed(1)} m → ${sim.tower.height.toFixed(1)} m)`);
  ok(sim.padBodies.every((pb) => Math.abs(pb.body.getPosition().x - pb.x0) < 1e-6), 'and the ground settles back where it was');
  const s2 = new Sim({ finishHeight: 10, mods: mods(14) });
  const h2 = stackUp(s2, ['stone-slab', 'wood-post', 'wood-plank', 'wood-post', 'wood-plank', 'wood-post', 'wood-plank']);
  s2.hazards = true; s2.quake.next = s2.time + 0.5;
  run(s2, 6);
  ok(s2.tower.height < h2 - 1, `a spindly tower on stilts falls (${h2.toFixed(1)} m → ${s2.tower.height.toFixed(1)} m)`);
}

console.log('Level 15, Twin Towers');
{
  const sim = new Sim({ finishHeight: 8, mods: mods(15) });
  stackUp(sim, Array(6).fill('stone-cube'), -5);
  ok(sim.tower.height === 0 && sim.tower.sides[0].h > 5.5, 'one tall tower alone counts for nothing');
  stackUp(sim, Array(3).fill('stone-cube'), 5);
  const [a, b] = sim.tower.sides;
  ok(Math.abs(sim.tower.height - Math.min(a.h, b.h)) < 1e-9 && sim.tower.height > 2.5, `the height is the lower tower's (${a.h.toFixed(1)} m and ${b.h.toFixed(1)} m → ${sim.tower.height.toFixed(1)} m)`);
}

console.log('Level 16, Meteor Shower');
{
  const sim = new Sim({ finishHeight: 11, mods: mods(16) });
  stackUp(sim, ['stone-cube', 'stone-cube', 'stone-cube', 'wood-cube']);
  const top = sim.tower.top;
  sim.hazards = true;
  sim.meteor.next = sim.time + 2.3;
  const ev = [];
  run(sim, 6, () => { for (const e of sim.drainEvents()) ev.push(e); });
  const warn = ev.find((e) => e.type === 'meteorwarn'), hit = ev.find((e) => e.type === 'meteor');
  ok(warn && hit && ev.indexOf(warn) < ev.findIndex((e) => e.type === 'meteorfall'), 'a target shows first, then a meteor falls');
  console.log(`   it hit: ${hit?.hit}; the wooden top piece is ${top.dead ? 'burnt' : 'still there'}`);
  ok([...sim.pieces].every((p) => p.special !== 'meteor'), 'meteors are gone once they hit');
  // a claw held over the target blocks it
  const s2 = new Sim({ finishHeight: 11, players: 2, mods: mods(16) });
  const claw = s2.addPlayer(0);
  claw.trolley.setTransform({ x: 0, y: s2.topY }, 0); claw.body.setTransform({ x: 0, y: s2.topY - 3 }, 0);
  run(s2, 1);
  s2.hazards = true;
  s2.meteor.next = s2.time + 2.3;
  run(s2, 0.2);
  if (s2.meteor.warn) s2.meteor.warn.x = claw.body.getPosition().x;
  const ev2 = [];
  run(s2, 5, () => { for (const e of s2.drainEvents()) ev2.push(e); });
  ok(ev2.some((e) => e.type === 'meteor' && e.hit === 'claw' && e.slot === 0), 'a claw under a meteor blocks it');
  // nothing in the tower is a meteor, and claws can't grab them
  ok(![...s2.tower.set].some((p) => p.special === 'meteor'), 'meteors are never part of the tower');
}

console.log('Level 17, Bridge the Gap');
{
  const g = new Game({ progress: { unlocked: 17, ...allDone(16) } });
  g.addPlayer('a', 'A');
  g.setLevel(17); g.startRound(); run(g, 3.1);
  const sim = g.sim;
  stackUp(sim, Array(5).fill('stone-cube'), -4);
  ok(sim.tower.height === 0, 'a tower on a cliff top counts for nothing');
  sim.createPiece('metal-bridge', 0, 0, sim.padTop + 0.3, 0); run(sim, 2);
  ok(sim.tower.height > 0.3, `a beam across the gap does (${sim.tower.height.toFixed(2)} m)`);
  const h = stackUp(sim, Array(4).fill('wood-cube'), 0);
  ok(h > 4, `and so does what's built on it (${h.toFixed(1)} m)`);
  const p = g.players.get('a');
  const item = p.inv.find((it) => it.id === 'wood-cube');
  const had = item.n;
  item.n = Math.max(0, item.n - 1);
  sim.createPiece('wood-cube', 0, 0, sim.padTop - 0.6, 0).releasedBy = 0;
  let lost = false;
  run(g, 4, () => { for (const e of g.drainEvents()) if (e.type === 'remove' && e.reason === 'lost') lost = true; });
  ok(lost && item.n === Math.min(had, item.max), 'a piece that falls into the chasm is lost, and goes back in the kit');
}

console.log('Level 18, Lights Out');
{
  const sim = new Sim({ finishHeight: 11, mods: mods(18) });
  let bolts = 0;
  run(sim, 30, () => { for (const e of sim.drainEvents()) if (e.type === 'lightning') bolts++; });
  ok(bolts === 0, 'no lightning in the lobby');
  sim.hazards = true;
  run(sim, 45, () => { for (const e of sim.drainEvents()) if (e.type === 'lightning') bolts++; });
  ok(bolts >= 2, `lightning flashes while building (${bolts} in 45 s)`);
}

console.log('Level 19, Mixed-Up Claws');
{
  const g = new Game({ progress: { unlocked: 19, ...allDone(18) } });
  g.addPlayer('a', 'A');
  g.setLevel(19);
  run(g, 30);
  ok(g.sim.claws.get(0).flipUntil < 0, 'no flips in the lobby');
  g.startRound(); run(g, 3.1);
  const claw = g.sim.claws.get(0);
  g.sim.mixNext = g.sim.time;
  const ev = [];
  run(g, 0.2, () => { ev.push(...g.drainEvents()); });
  ok(ev.some((e) => e.type === 'flip' && e.slot === 0) && ev.some((e) => e.type === 'toast' && e.big && e.id === 'a'), 'a player gets flipped, and their phone is told');
  ok(g.statusFor('a').fx > 0, 'the phone shows it while it lasts');
  g.sim.mixNext = Infinity; // (no second flip during this check)
  claw.flipBoth = false;
  const x0 = claw.x;
  g.input('a', 1, 0);
  run(g, 1);
  ok(claw.x < x0 - 1, 'pushing right moves the claw left');
  run(g, mods(19).mixup.len);
  g.input('a', 1, 0);
  const x1 = claw.x;
  run(g, 1);
  ok(g.statusFor('a').fx === 0 && claw.x > x1 + 1, 'then it wears off');
  g.sim.mixNext = g.sim.time;
  run(g, 0.2);
  ok(claw.flipUntil < g.sim.time, 'and nobody is flipped again straight away');
}

console.log('Every new level can be won');
for (let id = 11; id <= 20; id++) {
  const g = new Game({ progress: { unlocked: id, ...allDone(id - 1) } });
  g.addPlayer('a', 'A'); g.addPlayer('b', 'B');
  ok(g.setLevel(id), `Level ${id} can be picked once Level ${id - 1} is beaten`);
  g.startRound(); run(g, 3.1);
  const s = g.sim, goal = s.finishHeight;
  const tall = (x, type = 'stone-big') => { let i = 0; while (s.tower.height < goal + 0.6 && i++ < 30) { s.createPiece(type, 0, x, s.padTop + s.tower.height + (s.mods.hill ? 1.4 : 0.7), 0); run(g, 0.5); } };
  if (s.mods.twin) {
    for (let i = 0; i < 12; i++) { s.createPiece('stone-big', 0, -5, s.padTop + 0.6 + i * 1.05, 0); s.createPiece('stone-big', 0, 5, s.padTop + 0.6 + i * 1.05, 0); }
    run(g, 4);
  } else if (s.mods.bridge) {
    s.createPiece('metal-bridge', 0, 0, s.padTop + 0.3, 0); run(g, 1.5);
    tall(0);
  } else if (s.mods.hill) {
    s.createPiece('stone-shim', 0, -1, s.padTop + 0.6, 0); run(g, 1.5);
    tall(-1);
  } else tall(0);
  run(g, 14, () => g.phase !== 'result');
  const r = g.result;
  ok(r && r.success && r.level.id === id && (id < 20 ? r.next === id + 1 : r.allDone && r.next === 'remix'), `Level ${id} won with a ${s.tower.height.toFixed(1)} m tower (goal ${goal} m)${id === 20 ? ': every level beaten, on to the Remix' : ''}`);
}

console.log('Progress');
{
  const g = new Game({ progress: { unlocked: 10, ...allDone(10) } });
  ok(g.progress.unlocked === 11 && g.levelAvailable(11) && g.remixUnlocked, 'progress saved with ten levels opens Level 11 (and the Remix stays open)');
  const g2 = new Game({ progress: { unlocked: 10, ...allDone(9) } });
  g2.addPlayer('a', 'A'); g2.setLevel(10); g2.startRound(); run(g2, 3.1);
  for (let i = 0; i < 14; i++) g2.sim.createPiece('stone-cube', 0, 0, g2.sim.padTop + 0.5 + i, 0);
  g2.timeLeft = 0.5; run(g2, 6);
  if (g2.result?.success) ok(g2.result.unlocked === 11 && g2.result.remixOpen && g2.remixUnlocked && REMIX_AFTER === 10, 'beating Level 10 opens Level 11 and the Remix');
  let pads = 0;
  for (let i = 0; i < 300; i++) {
    const m = remixLevel(i % 10, Math.random).mods;
    if (['soft', 'tilt', 'quake'].filter((k) => m[k]).length > 1) pads++;
  }
  ok(pads === 0, 'a remix never mixes two kinds of moving ground');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall new-level checks passed');
process.exit(failures ? 1 : 0);
