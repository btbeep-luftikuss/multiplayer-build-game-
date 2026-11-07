// Physics checks, run in Node: `npm test`. A little bot drives the claws the way a player would.
import { Sim, STEP, LAYOUT } from '../src/sim/sim.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };
const run = (sim, seconds, each) => { const n = Math.round(seconds / STEP); for (let i = 0; i < n; i++) { if (each && each(i * STEP) === false) return false; sim.step(); } return true; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// steer a claw's trolley to x and its rope to a length; true once it's there and calm
function steer(claw, x, len) {
  const dx = x - claw.x;
  claw.input.mx = clamp(dx * 0.9 - claw.vx * 0.25, -1, 1);
  claw.input.ry = clamp((claw.ropeLen - len) * 1.2, -1, 1);
  const v = claw.body.getLinearVelocity();
  return Math.abs(dx) < 0.06 && Math.abs(claw.body.getPosition().x - x) < 0.08 && Math.abs(claw.ropeLen - len) < 0.08 && Math.hypot(v.x, v.y) < 0.25;
}
function steerUntil(sim, claw, x, len, maxSeconds = 12) {
  let done = false;
  run(sim, maxSeconds, () => { if (steer(claw, x, len)) { done = true; return false; } });
  claw.input.mx = 0; claw.input.ry = 0;
  return done;
}
// rope length that puts the claw's palm at height y
const lenFor = (sim, y) => sim.topY - 0.28 - 0.22 - (y + 0.14 + 0.22 - 0.22);

function placeHeld(sim, claw, x, ropeUp = 2.5) {
  steerUntil(sim, claw, claw.x, ropeUp, 6);
  steerUntil(sim, claw, x, ropeUp, 14);
  claw.drop();
  let released = false;
  run(sim, 9, () => { if (!claw.hold) { released = true; return false; } });
  run(sim, 0.4);
  steerUntil(sim, claw, claw.x, ropeUp, 6);
  return released;
}

console.log('Claw swing');
{
  const sim = new Sim({ finishHeight: 8 });
  const claw = sim.addPlayer(0);
  run(sim, 2);
  claw.input.mx = 1;
  run(sim, 1.6);
  claw.input.mx = 0;
  let maxOff = 0;
  run(sim, 1.5, () => { maxOff = Math.max(maxOff, Math.abs(claw.body.getPosition().x - claw.x)); });
  let late = 0;
  run(sim, 3, (t) => { if (t > 2) late = Math.max(late, Math.abs(claw.body.getPosition().x - claw.x)); });
  console.log(`   swing after stopping: ${maxOff.toFixed(2)} m, 3.5-4.5 s later: ${late.toFixed(2)} m`);
  ok(maxOff > 0.3, 'the claw swings when the trolley stops');
  ok(late < 0.35, 'the swing settles within about 4 s');
  ok(Math.abs(claw.body.getAngle()) < 0.2, 'the claw stays upright');
}

console.log('Spawn, grab, carry, place');
{
  const sim = new Sim({ finishHeight: 8 });
  const claw = sim.addPlayer(0);
  run(sim, 1);
  const p = sim.spawnOnPlatform(0, 'wood-cube', 0);
  ok(!!p, 'a cube spawns on the platform');
  run(sim, 1.5);
  ok(Math.abs(p.body.getPosition().y - (LAYOUT.slot(0).top + 0.5)) < 0.05, `it rests on the platform (y=${p.body.getPosition().y.toFixed(2)})`);
  steerUntil(sim, claw, p.body.getPosition().x, 3, 10);
  claw.drop();
  run(sim, 8, () => claw.state === 'holding' && claw.auto === null ? false : undefined);
  ok(claw.state === 'holding' && claw.hold.piece === p, 'DROP lowers the claw and grabs the cube');
  const placed = placeHeld(sim, claw, 0);
  ok(placed, 'DROP over the pad lowers and lets go');
  run(sim, 1.5);
  ok(Math.abs(p.body.getPosition().y - (LAYOUT.padTop + 0.5)) < 0.06, `the cube sits on the pad (y=${p.body.getPosition().y.toFixed(2)})`);
  ok(Math.abs(sim.tower.height - 1) < 0.05, `tower height 1 m (${sim.tower.height.toFixed(2)})`);
  const lock = sim.events.find((e) => e.type === 'lock');
  ok(!!lock, 'placing it raises a lock event');
}

console.log('Stack ten cubes, spawned straight into the claw');
{
  const sim = new Sim({ finishHeight: 8 });
  const claw = sim.addPlayer(1);
  run(sim, 1);
  let placedAll = true;
  for (let i = 0; i < 10; i++) {
    steerUntil(sim, claw, claw.x, 2, 6);
    const p = sim.spawnInClaw(1, 'wood-cube', 0);
    if (!p) { placedAll = false; console.log('   could not spawn into the claw at', i); break; }
    if (!placeHeld(sim, claw, 0.0, 2)) { placedAll = false; console.log('   failed to place', i); break; }
  }
  ok(placedAll, 'ten cubes placed');
  run(sim, 4);
  console.log(`   tower: ${sim.tower.height.toFixed(2)} m, ${sim.tower.count} pieces`);
  ok(sim.tower.height > 9.5, 'the ten-cube tower stands (over 9.5 m)');
  const h0 = sim.tower.height;
  run(sim, 10);
  ok(Math.abs(sim.tower.height - h0) < 0.05, 'and is still standing 10 s later');
}

console.log('A claw reaches a lower shelf under a higher one');
{
  const sim = new Sim({ finishHeight: 8 });
  const claw = sim.addPlayer(0);
  sim.addPlayer(2); sim.addPlayer(4); // the shelves above it, further out
  run(sim, 0.5);
  const p = sim.spawnOnPlatform(0, 'wood-short', 0);
  run(sim, 1.5);
  ok(Math.abs(p.body.getPosition().y - (LAYOUT.slot(0).top + 0.25)) < 0.05, 'a beam spawns on the bottom shelf');
  claw.drop();
  run(sim, 8, () => (claw.state === 'holding' && !claw.auto ? false : undefined));
  ok(claw.hold?.piece === p, 'DROP reaches down past the upper shelves and grabs it');
  steerUntil(sim, claw, claw.x, 3, 8);
  ok(placeHeld(sim, claw, -4, 3), 'and it can be carried out and placed on the pad');
  run(sim, 1);
  ok(sim.tower.set.has(p), 'where it counts as tower');
}

console.log('Heavy pieces reel in slower');
{
  const sim = new Sim({ finishHeight: 8 });
  const a = sim.addPlayer(0), b = sim.addPlayer(1);
  run(sim, 1);
  sim.spawnInClaw(0, 'foam-cube', 0);
  sim.spawnInClaw(1, 'stone-slab', 0);
  run(sim, 1);
  const la = a.ropeLen, lb = b.ropeLen;
  a.input.ry = 1; b.input.ry = 1;
  run(sim, 0.5);
  const da = la - a.ropeLen, db = lb - b.ropeLen;
  console.log(`   reeled in 0.5 s: foam ${da.toFixed(2)} m, slab ${db.toFixed(2)} m`);
  ok(db < da * 0.6, 'the heavy base reels in noticeably slower');
  ok(b.hold && b.hold.piece.type === 'stone-slab', 'and the claw keeps hold of it');
}

console.log('Rotate a held piece');
{
  const sim = new Sim({ finishHeight: 8 });
  const claw = sim.addPlayer(0);
  run(sim, 1);
  const p = sim.spawnInClaw(0, 'wood-short', 0);
  run(sim, 0.5);
  claw.rotateStart(1); claw.rotateEnd();
  run(sim, 1.5);
  const a1 = p.body.getAngle() - claw.body.getAngle();
  claw.rotateStart(1); claw.rotateEnd();
  run(sim, 1.5);
  const a2 = p.body.getAngle() - claw.body.getAngle();
  console.log(`   after one turn ${(a1 * 180 / Math.PI).toFixed(1)}°, two turns ${(a2 * 180 / Math.PI).toFixed(1)}°`);
  ok(Math.abs(a1 - Math.PI / 4) < 0.06, 'one tap turns it 45°');
  ok(Math.abs(a2 - Math.PI / 2) < 0.06, 'two taps turn it 90°');
  claw.rotateStart(-1); claw.rotateEnd();
  run(sim, 1.5);
  ok(Math.abs(p.body.getAngle() - claw.body.getAngle() - Math.PI / 4) < 0.06, 'the other button turns it back');
}

console.log('An off-centre grab on a heavy girder slips; a centred one holds');
{
  for (const [offset, expectSlip] of [[1.4, true], [0, false]]) {
    const sim = new Sim({ finishHeight: 8 });
    const claw = sim.addPlayer(1);
    run(sim, 0.5);
    const g = sim.createPiece('metal-girder', 1, claw.x + offset, LAYOUT.slot(0).top + 0.25, 0);
    run(sim, 1);
    claw.drop();
    run(sim, 8, () => (claw.state === 'holding' && !claw.auto ? false : undefined));
    claw.input.ry = 1;
    run(sim, 1.2);
    claw.input.ry = 0;
    run(sim, 1.5);
    const tilt = Math.abs(g.body.getAngle());
    console.log(`   offset ${offset} m: holding ${claw.hold?.piece === g}, tilt ${(tilt * 180 / Math.PI).toFixed(0)}°`);
    ok(claw.hold?.piece === g && (expectSlip ? tilt > 0.35 : tilt < 0.1), expectSlip ? 'held by the end, it swings down in the grip' : 'held in the middle, it stays level');
  }
}

console.log('Turntable: rotate a piece sitting on the platform');
{
  const sim = new Sim({ finishHeight: 8 });
  sim.addPlayer(0);
  run(sim, 0.5);
  const p = sim.spawnOnPlatform(0, 'wood-beam', 0);
  run(sim, 1.5);
  ok(sim.turnPlatformPiece(0, 1) && sim.turnPlatformPiece(0, 1), 'the beam turns twice');
  run(sim, 2);
  ok(Math.abs(Math.abs(p.body.getAngle()) - Math.PI / 2) < 0.08 || Math.abs(p.body.getPosition().y - LAYOUT.slot(0).top) < 3, `it stands on end or lies on the platform (angle ${(p.body.getAngle() * 180 / Math.PI).toFixed(0)}°)`);
}

console.log('Sticky goo glues');
{
  const sim = new Sim({ finishHeight: 8 });
  const claw = sim.addPlayer(1);
  run(sim, 0.5);
  const base = sim.createPiece('wood-cube', 1, 0, LAYOUT.padTop + 0.5, 0);
  run(sim, 1);
  steerUntil(sim, claw, claw.x, 2, 6);
  sim.spawnInClaw(1, 'sp-goo', 0);
  placeHeld(sim, claw, 0, 2);
  run(sim, 1);
  const weld = sim.events.find((e) => e.type === 'weld');
  ok(!!weld, 'the goo welds to the cube it lands on');
  ok(base.welds.length === 1, 'the cube knows it is glued');
}

console.log('Balloon ties on and lifts');
{
  const sim = new Sim({ finishHeight: 8 });
  const claw = sim.addPlayer(1);
  run(sim, 0.5);
  const base = sim.createPiece('stone-cube', 1, 0, LAYOUT.padTop + 0.5, 0);
  run(sim, 1);
  steerUntil(sim, claw, claw.x, 2, 6);
  const b = sim.spawnInClaw(1, 'sp-balloon', 0);
  steerUntil(sim, claw, 0, lenFor(sim, base.top + 1.3), 14);
  claw.toggleGrab();
  run(sim, 2);
  ok(!!b.tie && b.tie.piece === base, 'the balloon ties onto the stone block');
  ok(b.body.getPosition().y > base.body.getPosition().y + 0.6, 'and floats above it');
  ok(Math.abs(base.body.getPosition().y - (LAYOUT.padTop + 0.5)) < 0.05, 'without carrying the block away');
  const loose = sim.createPiece('sp-balloon', 1, 10, 8, 0);
  sim.onReleased(loose);
  run(sim, 6);
  ok(loose.dead, 'a balloon tied to nothing floats away and pops');
}

console.log('Support beam anchors for 20 s');
{
  const sim = new Sim({ finishHeight: 8 });
  sim.addPlayer(0);
  run(sim, 0.5);
  const s = sim.createPiece('sp-scaffold', 0, 3.2, LAYOUT.padTop + 1.65, 0);
  sim.onReleased(s);
  run(sim, 1.5);
  ok(s.anchoredAt >= 0 && s.body.isStatic(), 'it anchors once it stands on the pad');
  run(sim, 20);
  ok(s.dead, 'and is gone after 20 s');
}

console.log('Magnet pulls and holds');
{
  const sim = new Sim({ finishHeight: 8 });
  sim.addPlayer(0);
  run(sim, 0.5);
  const m = sim.createPiece('sp-magnet', 0, 0, LAYOUT.padTop + 0.35, 0);
  const c = sim.createPiece('metal-beam', 0, 1.9, LAYOUT.padTop + 0.25, 0);
  run(sim, 0.5);
  sim.onReleased(m);
  run(sim, 4);
  ok(c.welds.some((w) => w.other === m), 'a nearby bar gets pulled in and stuck to the magnet');
}

console.log('Collapse and lost pieces');
{
  const sim = new Sim({ finishHeight: 8 });
  sim.addPlayer(0);
  run(sim, 0.5);
  const tall = [];
  for (let i = 0; i < 8; i++) tall.push(sim.createPiece('wood-cube', 0, 0.04 * i, LAYOUT.padTop + 0.5 + i * 1.0, 0));
  run(sim, 2);
  console.log(`   leaning stack before the shove: ${sim.tower.height.toFixed(2)} m`);
  sim.drainEvents();
  tall[1].body.applyLinearImpulse({ x: 14, y: 0 }, tall[1].body.getWorldCenter(), true);
  run(sim, 4);
  const ev = sim.drainEvents();
  ok(ev.some((e) => e.type === 'collapse'), 'knocking the stack over is spotted as a collapse');
  ok(ev.some((e) => e.type === 'impact'), 'and makes impact events');
  const p = sim.createPiece('rubber-ball', 0, LAYOUT.groundHalf + 1, 3, 0);
  run(sim, 3);
  ok(p.dead && sim.drainEvents().some((e) => e.type === 'remove' && e.reason === 'lost'), 'a piece off the edge is removed as lost');
}

console.log('Two claws share a heavy load');
{
  const sim = new Sim({ finishHeight: 8 });
  const a = sim.addPlayer(0), b = sim.addPlayer(2);
  run(sim, 0.5);
  const slab = sim.createPiece('stone-slab', 0, -9, LAYOUT.padTop + 0.4, 0);
  run(sim, 1);
  const L = lenFor(sim, slab.top + 0.02);
  steerUntil(sim, a, -10.1, 3, 12); steerUntil(sim, b, -7.9, 3, 12);
  a.drop(); b.drop();
  run(sim, 8, () => (a.state === 'holding' && b.state === 'holding' && !a.auto && !b.auto ? false : undefined));
  ok(a.hold?.piece === slab && b.hold?.piece === slab, 'both claws hold the heavy base');
  ok(a.loadMass() < slab.mass * 0.6, 'each carries half of it');
  void L;
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall physics checks passed');
process.exit(failures ? 1 : 0);
