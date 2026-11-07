// Round and player rules, run in Node: `npm test`.
import { Game, finishHeightFor } from '../src/sim/game.js';
import { STEP, LAYOUT } from '../src/sim/sim.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };
const run = (g, s) => { for (let i = 0; i < Math.round(s / STEP); i++) g.step(); };

console.log('Joining');
const g = new Game();
const a = g.addPlayer('aa', 'Ana'), b = g.addPlayer('bb', '  Bo<b>  ');
ok(a.slot === 0 && b.slot === 1, 'players get slots 0 and 1');
ok(b.name === 'Bob', `names are cleaned ("${b.name}")`);
ok(g.isLeader('aa') && !g.isLeader('bb'), 'the first player leads');
ok(g.sim.claws.size === 2 && g.sim.platforms.size === 2, 'each gets a claw and a platform');
ok(g.sim.finishHeight === finishHeightFor(2, 'normal'), `finish line at ${g.sim.finishHeight} m for two players`);
for (let i = 0; i < 6; i++) g.addPlayer('p' + i, 'P' + i);
ok(g.players.size === 8 && g.addPlayer('ninth', 'Nine') === null, 'eight players fit, a ninth is turned away');
for (let i = 0; i < 6; i++) g.removePlayer('p' + i);
ok(g.players.size === 2 && g.sim.claws.size === 2, 'players can leave');

console.log('Lobby free play');
run(g, 0.5);
const before = a.inv[0].n;
ok(g.spawn('aa', 0, 0), 'spawning works in the lobby');
ok(a.inv[0].n === before, 'and costs nothing');
ok(g.setSetting('roundTime', 180) && g.timeLeft === 180, 'the round time can be changed');
ok(!g.setSetting('roundTime', 7), 'but only to an offered value');

console.log('A round');
g.settings.roundTime = 20;
ok(g.startRound(), 'the round starts');
ok(g.phase === 'countdown' && g.sim.pieces.size === 0, 'with a countdown and an empty world');
ok(!g.spawn('aa', 0, 0), 'no spawning during the countdown');
run(g, 3.1);
const ev = g.drainEvents();
ok(ev.filter((e) => e.type === 'count').map((e) => e.n).join() === '2,1', 'counts down');
ok(ev.some((e) => e.type === 'go') && g.phase === 'play', 'GO!');
ok(g.spawn('aa', 0, 0) && a.inv[0].n === before - 1, 'spawning during the round uses up a piece');
const st = g.statusFor('aa');
ok(st.ph === 'play' && st.sb === true && st.ld === true, 'the cube waits on the shelf, and the phone knows');
ok(!g.spawn('aa', 0, 0) && a.inv[0].n === before - 1, 'no second piece while the first is still on the shelf');
run(g, 0.5);
// pick the cube up (as if the claw had come down for it)
const cube = [...g.sim.pieces].find((x) => x.owner === 0);
g.sim.claws.get(0).attach(cube, false);
ok(g.statusFor('aa').sb === false && g.statusFor('aa').g === 2, 'once it is picked up the shelf is free');
g.input('aa', 0, 1);
run(g, 1.5);
g.input('aa', 0, 0);
ok(g.spawn('aa', 0, 0) && a.inv[0].n === before - 2, 'and the next piece can come');
// build a tower over the line, straight onto the pad
const finish = g.sim.finishHeight;
const n = Math.ceil(finish + 1);
for (let i = 0; i < n; i++) g.sim.createPiece('stone-cube', 0, 0, LAYOUT.padTop + 0.5 + i, 0);
run(g, 2);
ok(g.drainEvents().some((e) => e.type === 'crossed'), 'crossing the line is announced');
run(g, 18.2);
ok(g.phase === 'judge', 'time up: judging');
ok([...g.sim.claws.values()].every((c) => !c.enabled && c.state === 'open'), 'the claws let go and stop');
run(g, 4.2);
ok(g.phase === 'result' && g.result.success, `the tower stands: ${g.result.height.toFixed(1)} m of ${g.result.finish} m, ${g.result.stars} star(s)`);

console.log('Again, and a failure');
ok(g.startRound(), 'play again');
ok(a.inv[0].n === a.inv[0].max && g.sim.pieces.size === 0, 'fresh kits, fresh world');
run(g, 3.1 + 20 + 4.2);
ok(g.phase === 'result' && !g.result.success, 'no tower: the round fails');

console.log('Back to the lobby');
{
  const simBefore = g.sim;
  g.toLobby();
  ok(g.phase === 'lobby' && g.sim !== simBefore && g.sim.claws.size === 2, 'a fresh lobby world with every claw');
  ok(g.setSetting('difficulty', 'hard') && g.sim.finishHeight === finishHeightFor(2, 'hard'), 'settings can change there, and the finish line follows');
  g.setSetting('difficulty', 'normal');
}

console.log('Power-ups and refills');
g.settings.roundTime = 120;
g.startRound();
run(g, 3.1);
g.nextPower = 1;
run(g, 1.5);
const got = [...g.players.values()].find((p) => p.inv.some((it) => it.special));
ok(!!got, 'someone gets a power-up');
const evs = g.drainEvents();
ok(evs.some((e) => e.type === 'powerup') && evs.some((e) => e.type === 'toast' && e.big), 'announced on the TV and the phone');
const idx = got.inv.findIndex((it) => it.special);
const len = got.inv.length;
ok(g.spawn(got.id, idx, 0) && got.inv.length === len - 1, 'using it removes it from the kit');
for (const it of b.inv) if (!it.special) it.n = 0;
b.inv.find((it) => !it.special).n = 1;
b.lastRestock = -99;
run(g, 1.2);
ok(b.inv.reduce((s, it) => s + it.n, 0) === 2, 'a player who is nearly out gets a refill');

console.log('Dropping out');
g.setConnected('bb', false);
ok(!g.isLeader('bb'), 'a disconnected player cannot lead');
g.setConnected('aa', false);
ok(g.leader() === null, 'nobody connected, no leader');
g.setConnected('aa', true);
run(g, 46);
ok(!g.players.has('bb') && g.players.has('aa'), 'a player gone for 45 s loses their claw');
const back = g.addPlayer('aa', 'Ana');
ok(back === a && back.slot === 0, 'rejoining with the same id keeps the slot');

console.log(failures ? `\n${failures} check(s) failed` : '\nall game checks passed');
process.exit(failures ? 1 : 0);
