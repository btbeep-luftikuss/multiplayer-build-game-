// The physics of the play area (runs on the TV only): the ground and build pad, the top bar, one claw per
// player hanging from it on a rope, each player's spawn platform, and every building piece.
// Built on planck.js (a JavaScript port of Box2D, chosen for stable stacking). The world is 2D;
// the TV draws it in 3D. Units: metres, kilograms, seconds; y points up.
import { World, Vec2, AABB, Box, Polygon, Circle, Transform, RopeJoint, RevoluteJoint, WeldJoint, PrismaticJoint, testOverlap } from 'planck';
import { SHAPES, PIECES, MATERIALS, extentsOf } from '../shared/pieces.js';

export const STEP = 1 / 60;
export const GRAVITY = 10;
const CAT = { STATIC: 0x1, PIECE: 0x2, CLAW: 0x4, PAD: 0x8 };
const SOLID = CAT.STATIC | CAT.PIECE | CAT.CLAW | CAT.PAD; // what pieces and claws bump into
const DEG = Math.PI / 180;

export const LAYOUT = {
  padTop: 0.3,
  shelfW: 3,
  killY: -8,
  // how much of a 16:9 screen the play area gets (the height meter takes a strip at the side)
  aspect: (16 / 9) * 0.93,
  frameBottom: -1.4,   // the TV shows from the front of the grass…
  frameTop: 1.1,       // …to just above the trolleys on the top bar
};

// Where everything goes for one round. A wide build pad in the middle (wider with more players), and
// spawn shelves beyond it at the far left and right, alternating sides, as solid steps rising like
// stairs towards the edges; each higher step starts 1.8 m further out, so the step below keeps 1.8 m
// of open top for its pieces. The TV camera zooms out as far as the claws spread.
// (Some levels raise everything: `lift` puts the pad up on a mesa and the shelves with it; a rocking
// base is narrower, `padHalf`.)
// (On a lava level with rafts, `raftTop` gives the shelves' height as the lava rises; the rafts sit side
// by side rather than as steps.)
export function makeLayout(topY, players, { padHalf: padOverride = 0, lift = 0, raftTop = null } = {}) {
  const n = Math.max(2, players);
  const levels = Math.max(1, Math.ceil(n / 2));
  const step = 1.8;
  const padHalf = padOverride || 11 + n * 0.5;
  const inner0 = padHalf + 1.4;
  const halfW = inner0 + (levels - 1) * (raftTop ? LAYOUT.shelfW + 0.25 : step) + LAYOUT.shelfW + 0.4;
  void topY;
  return {
    halfW, levels,
    padHalf,
    groundHalf: halfW + 3,
    barHalf: halfW + 0.6,
    // x0/x1: the shelf's inner and outer ends; x: where new pieces arrive (the part a claw can reach)
    slot(s) {
      const side = s % 2 === 0 ? -1 : 1, level = Math.floor(s / 2);
      if (raftTop) {
        const inner = inner0 + level * (LAYOUT.shelfW + 0.25);
        return { side, level, raft: true, top: raftTop(), x0: side * inner, x1: side * (inner + LAYOUT.shelfW), x: side * (inner + LAYOUT.shelfW / 2) };
      }
      const inner = inner0 + level * step;
      return { side, level, top: 1.0 + lift + level * 2.8, x0: side * inner, x1: side * (inner + LAYOUT.shelfW), x: side * (inner + 0.9) };
    },
  };
}

export const CLAW = {
  hubHalfW: 0.45, hubHalfH: 0.18, hubCy: 0.04,
  ropeOnClaw: 0.22,          // the rope ties on here (claw-local y)
  ropeOnTrolley: -0.28,
  jaw: { cx: 0, cy: -0.5, hw: 0.5, hh: 0.36 }, // the space between the fingers where pieces are grabbed
  density: 4,
  vMax: 6.5, accel: 9,       // trolley speed along the bar (m/s, m/s²)
  reelIn: 4.5, reelOut: 6, minRope: 0.9,
  gripTorque: 80,            // how hard the claw holds a piece's angle before it slips (heavy + off-centre = slips)
  servoGain: 12, servoMax: 5,
  gyroK: 55, gyroD: 11, gyroMax: 80, // keeps the claw upright (it still tilts under off-centre loads)
  sway: 0.6,                 // damping ratio of the swing relative to the trolley
};

const ROT_STEP = 45 * DEG;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

let nextPieceId = 1;

function makeShapes(shapeId) {
  return SHAPES[shapeId].parts.map((p) => (p.type === 'circle' ? new Circle(Vec2(0, 0), p.r) : new Polygon(p.pts.map(([x, y]) => Vec2(x, y)))));
}

// the highest point of a body
function bodyTop(body) {
  let top = -Infinity;
  const xf = body.getTransform();
  for (let f = body.getFixtureList(); f; f = f.getNext()) {
    const s = f.getShape();
    if (s.getType() === 'circle') {
      top = Math.max(top, Transform.mulVec2(xf, s.getCenter()).y + s.getRadius());
    } else {
      for (let i = 0; i < s.m_count; i++) top = Math.max(top, Transform.mulVec2(xf, s.m_vertices[i]).y);
    }
  }
  return top;
}

// the lowest point of a body
function bodyBottom(body) {
  let low = Infinity;
  const xf = body.getTransform();
  for (let f = body.getFixtureList(); f; f = f.getNext()) {
    const s = f.getShape();
    if (s.getType() === 'circle') low = Math.min(low, Transform.mulVec2(xf, s.getCenter()).y - s.getRadius());
    else for (let i = 0; i < s.m_count; i++) low = Math.min(low, Transform.mulVec2(xf, s.m_vertices[i]).y);
  }
  return low;
}

export class Piece {
  constructor(sim, type, owner, x, y, angle) {
    const def = PIECES[type];
    this.id = nextPieceId++;
    this.type = type;
    this.def = def;
    this.shape = def.shape;
    this.mat = def.mat;
    this.special = def.special || null;
    this.owner = owner;
    this.heldBy = new Set();
    this.dead = false;
    this.bornAt = sim.time;
    this.releasedAt = -1;
    this.releasedBy = -1;
    this.locked = false;
    this.armed = false;      // specials: active once released
    this.welds = [];
    this.anchoredAt = -1;    // support beams: when they took hold of the ground
    this.tie = null;         // balloons: the string
    const m = MATERIALS[def.mat];
    this.body = sim.world.createBody({
      type: 'dynamic', position: Vec2(x, y), angle,
      linearDamping: def.special === 'balloon' ? 1.6 : def.special === 'meteor' ? 0.9 : 0.02,
      angularDamping: def.special === 'balloon' ? 2 : 0.08,
      bullet: def.special === 'meteor',
    });
    // on the ice (Frozen Lake) everything is slippery, except grippy rubber and goo
    const grip = sim.mods.ice && def.mat !== 'rubber' && def.mat !== 'goo' ? sim.mods.ice.grip : 1;
    for (const shape of makeShapes(def.shape)) {
      this.body.createFixture({
        shape, density: m.density, friction: m.friction * grip, restitution: m.restitution,
        filterCategoryBits: CAT.PIECE, filterMaskBits: SOLID,
      });
    }
    this.body.setUserData({ kind: 'piece', piece: this });
  }
  get mass() { return this.body.getMass(); }
  get top() { return bodyTop(this.body); }
}

export class Claw {
  constructor(sim, slot, x) {
    this.sim = sim;
    this.slot = slot;
    const world = sim.world;
    this.trolley = world.createBody({ type: 'kinematic', position: Vec2(x, sim.topY) });
    this.trolley.setSleepingAllowed(false);
    const startLen = 3.2;
    this.body = world.createBody({
      type: 'dynamic', position: Vec2(x, sim.topY + CLAW.ropeOnTrolley - startLen - CLAW.ropeOnClaw),
      linearDamping: 0.12, angularDamping: 1.5,
    });
    this.body.setSleepingAllowed(false);
    this.body.setUserData({ kind: 'claw', claw: this });
    this.hub = this.body.createFixture({
      shape: new Box(CLAW.hubHalfW, CLAW.hubHalfH, Vec2(0, CLAW.hubCy), 0), density: CLAW.density, friction: 0.6,
      filterCategoryBits: CAT.CLAW, filterMaskBits: SOLID,
    });
    this.fist = null;
    this.ropeLen = startLen;
    this.rope = world.createJoint(new RopeJoint({
      maxLength: startLen, localAnchorA: Vec2(0, CLAW.ropeOnTrolley), localAnchorB: Vec2(0, CLAW.ropeOnClaw), collideConnected: false,
    }, this.trolley, this.body));
    this.state = 'open';     // 'open' | 'closed' (empty fist) | 'holding'
    this.hold = null;        // { piece, joint, target }
    this.input = { mx: 0, ry: 0 };
    this.vx = 0;
    this.auto = null;        // the DROP button's automatic lower-and-grab (or lower-and-release)
    this.rotHold = 0; this.rotHeldFor = 0;
    this.enabled = true;
    this.lastTension = 0;
    this.reeling = 0;        // how fast the rope is moving (for sound)
    this.boostUntil = -1;    // the Super Claw power-up
    this.slipUntil = -1;     // Unstable claws: the grip is weak for a moment
    this.flipUntil = -Infinity; // Mixed-up claws: left and right (and maybe up and down) swapped until then
    this.flipBoth = false;
    this.nextGlitch = sim.time + 4 + Math.random() * 6;
  }

  get boosted() { return this.sim.time < this.boostUntil; }

  get x() { return this.trolley.getPosition().x; }
  get holding() { return this.hold ? this.hold.piece : null; }

  // the claw's share of what it's lifting
  loadMass() {
    if (!this.hold) return 0;
    const p = this.hold.piece;
    let m = p.mass;
    for (const w of p.welds) if (!w.other.dead) m += w.other.mass;
    return m / Math.max(1, p.heldBy.size);
  }

  // longest rope: the claw stops a little above the ground, so its fingers don't sink in
  maxRope() { return this.sim.topY + CLAW.ropeOnTrolley - CLAW.ropeOnClaw - 0.72; }

  ropeDistance() {
    const a = this.trolley.getWorldPoint(Vec2(0, CLAW.ropeOnTrolley));
    const b = this.body.getWorldPoint(Vec2(0, CLAW.ropeOnClaw));
    return Vec2.distance(a, b);
  }

  preStep(dt) {
    const sim = this.sim;
    const body = this.body;
    const load = this.loadMass();
    let inp = this.enabled ? this.input : { mx: 0, ry: 0 };
    if (sim.time < this.flipUntil) inp = { mx: -inp.mx, ry: this.flipBoth ? -inp.ry : inp.ry };
    const boost = this.boosted ? 1.5 : 1;
    // trolley along the bar
    const vmax = CLAW.vMax * boost / (1 + load / 12);
    const target = clamp(inp.mx, -1, 1) * vmax;
    const accel = CLAW.accel * boost * (Math.abs(target) < Math.abs(this.vx) ? 1.2 : 1);
    this.vx += clamp(target - this.vx, -accel * dt, accel * dt);
    const x = this.x;
    if ((x <= -sim.barLimit && this.vx < 0) || (x >= sim.barLimit && this.vx > 0)) {
      this.vx = 0;
      this.trolley.setTransform(Vec2(clamp(x, -sim.barLimit, sim.barLimit), sim.topY), 0);
    }
    this.trolley.setLinearVelocity(Vec2(this.vx, 0));

    // rope: reel in (ry > 0) or let out (ry < 0); the DROP button lowers on its own
    let rate = 0;
    if (this.auto && Math.abs(inp.ry) > 0.35) this.auto = null; // taking over by hand
    if (!this.enabled) rate = CLAW.reelIn; // hands off (time's up): every claw pulls clear of the tower
    else if (this.auto) {
      if (this.auto.mode === 'lower') rate = -CLAW.reelOut * 0.85;
      else if (this.auto.mode === 'raise') rate = CLAW.reelIn / (1 + load / 4);
    } else if (inp.ry > 0) rate = inp.ry * CLAW.reelIn * boost * boost / (1 + load / 4);
    else rate = inp.ry * CLAW.reelOut;
    const dist = this.ropeDistance();
    const maxLen = this.maxRope();
    let len = this.ropeLen - rate * dt;
    if (rate < 0) len = Math.min(len, Math.max(this.ropeLen, dist + 0.6)); // no piling up slack
    len = clamp(len, CLAW.minRope, maxLen);
    this.reeling = (this.ropeLen - len) / dt;
    this.ropeLen = len;
    this.rope.setMaxLength(len);

    // stay upright (a gyro in the hub)
    const ang = wrapAngle(body.getAngle());
    const k = 1 + load / 3;
    const torque = clamp(-CLAW.gyroK * ang - CLAW.gyroD * body.getAngularVelocity(), -CLAW.gyroMax, CLAW.gyroMax) * k;
    body.applyTorque(torque, true);
    // damp the swing (relative to the trolley) while the rope is taut: a few swings, then it settles
    if (dist > len - 0.08) {
      const rel = body.getLinearVelocity().x - this.vx;
      const c = 2 * CLAW.sway * Math.sqrt(GRAVITY / (dist + 0.4));
      body.applyForceToCenter(Vec2(-c * rel * (body.getMass() + load), 0), true);
    }

    // hold the piece at its target angle (it slips if overloaded)
    if (this.hold) {
      const h = this.hold;
      if (this.rotHold) {
        this.rotHeldFor += dt;
        if (this.rotHeldFor > 0.35) h.target += this.rotHold * 1.8 * dt;
      }
      h.joint.setMaxMotorTorque(CLAW.gripTorque * (this.boosted ? 2.5 : 1) * (sim.time < this.slipUntil ? 0.15 : 1));
      const err = h.target - h.joint.getJointAngle();
      h.joint.setMotorSpeed(clamp(CLAW.servoGain * err, -CLAW.servoMax, CLAW.servoMax));
      h.strain = Math.min(1, Math.abs(err) / 0.5);
    }
  }

  postStep(dt) {
    const f = this.rope.getReactionForce(1 / dt);
    this.lastTension = Math.hypot(f.x, f.y);
    // lava is solid to a claw: it sits on the surface instead of dipping in
    this.onLava = false;
    if (this.sim.lavaY > -10) {
      const bottom = this.body.getWorldPoint(Vec2(0, CLAW.hubCy - CLAW.hubHalfH)).y;
      if (bottom < this.sim.lavaY + 0.02) {
        const p = this.body.getPosition(), v = this.body.getLinearVelocity();
        this.body.setTransform(Vec2(p.x, p.y + (this.sim.lavaY + 0.02 - bottom)), this.body.getAngle());
        if (v.y < 0) this.body.setLinearVelocity(Vec2(v.x, 0));
        this.ropeLen = Math.min(this.ropeLen, this.ropeDistance() + 0.3);
        this.rope.setMaxLength(this.ropeLen);
        this.onLava = true;
      }
    }
    // the bar is in the way: a claw swinging up hard (low gravity, a short rope, a sudden stop) bumps
    // its underside instead of looping right over the top
    const ceiling = this.sim.topY + CLAW.ropeOnTrolley - 0.3;
    const knot = this.body.getWorldPoint(Vec2(0, CLAW.ropeOnClaw));
    if (knot.y > ceiling) {
      const p = this.body.getPosition(), v = this.body.getLinearVelocity();
      this.body.setTransform(Vec2(p.x, p.y - (knot.y - ceiling)), this.body.getAngle());
      if (v.y > 0) this.body.setLinearVelocity(Vec2(v.x, -0.3 * v.y));
    }
    if (!this.auto) return;
    const a = this.auto;
    a.t += dt;
    if (a.mode === 'raise') {
      if (a.t > 0.7) this.auto = null;
      return;
    }
    if (this.touchingSomething() || this.onLava || this.ropeLen >= this.maxRope() - 0.02) a.touch += dt;
    else a.touch = 0;
    if (a.touch > 0.12) {
      if (this.hold) {
        this.release();
        this.auto = null;
      } else {
        const got = this.tryGrab();
        this.auto = got ? { mode: 'raise', t: 0 } : null;
      }
    } else if (a.t > 7) this.auto = null;
  }

  // is the claw, or the piece it holds, resting on anything?
  touchingSomething() {
    const held = this.hold ? this.hold.piece.body : null;
    for (let ce = this.body.getContactList(); ce; ce = ce.next) {
      if (ce.contact.isTouching() && ce.other !== held && ce.other.getUserData()?.kind !== 'claw') return true;
    }
    if (held) {
      for (let ce = held.getContactList(); ce; ce = ce.next) {
        if (ce.contact.isTouching() && ce.other !== this.body && ce.other.getUserData()?.kind !== 'claw') return true;
      }
    }
    return false;
  }

  setFist(on) {
    if (on && !this.fist) {
      this.fist = this.body.createFixture({
        shape: new Polygon([Vec2(-0.3, -0.14), Vec2(0.3, -0.14), Vec2(0.12, -0.72), Vec2(-0.12, -0.72)]),
        density: 1, friction: 0.6, filterCategoryBits: CAT.CLAW, filterMaskBits: SOLID,
      });
    } else if (!on && this.fist) {
      this.body.destroyFixture(this.fist);
      this.fist = null;
    }
  }

  // the piece most inside the jaw (between the fingers), if any
  findGrabTarget() {
    const J = CLAW.jaw;
    const hits = new Map();
    const centre = this.body.getWorldPoint(Vec2(J.cx, J.cy));
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        const p = this.body.getWorldPoint(Vec2(J.cx + (i / 4 * 2 - 1) * J.hw * 0.9, J.cy + (j / 3 * 2 - 1) * J.hh * 0.95));
        this.sim.world.queryAABB(new AABB(Vec2(p.x - 0.01, p.y - 0.01), Vec2(p.x + 0.01, p.y + 0.01)), (fx) => {
          const ud = fx.getBody().getUserData();
          if (ud?.kind === 'piece' && !ud.piece.dead && ud.piece.special !== 'meteor' && !fx.getBody().isStatic() && fx.testPoint(p)) {
            hits.set(ud.piece, (hits.get(ud.piece) || 0) + 1);
          }
          return true;
        });
      }
    }
    let best = null, bestScore = -Infinity;
    for (const [piece, n] of hits) {
      const d = Vec2.distance(piece.body.getWorldCenter(), centre);
      const score = n - d * 0.5;
      if (score > bestScore) { best = piece; bestScore = score; }
    }
    return best;
  }

  tryGrab() {
    if (this.hold) return true;
    const piece = this.findGrabTarget();
    if (!piece) {
      this.state = 'closed';
      this.setFist(true);
      this.sim.emit({ type: 'miss', slot: this.slot });
      return false;
    }
    this.attach(piece, true);
    return true;
  }

  attach(piece, assist) {
    this.setFist(false);
    this.sim.unpark(piece);
    const anchor = this.body.getWorldPoint(Vec2(CLAW.jaw.cx, CLAW.jaw.cy));
    const joint = this.sim.world.createJoint(new RevoluteJoint({
      enableMotor: true, maxMotorTorque: CLAW.gripTorque, motorSpeed: 0, collideConnected: false,
    }, this.body, piece.body, anchor));
    let target = 0;
    if (assist) {
      // straighten a piece grabbed slightly crooked
      const rel = wrapAngle(piece.body.getAngle() - this.body.getAngle());
      const snapped = Math.round(rel / ROT_STEP) * ROT_STEP;
      if (Math.abs(snapped - rel) < 12 * DEG) target = snapped - rel;
    }
    this.hold = { piece, joint, target, strain: 0 };
    this.state = 'holding';
    piece.heldBy.add(this);
    piece.locked = false;
    piece.body.setAwake(true);
    this.sim.emit({ type: 'grab', slot: this.slot, piece: piece.id });
  }

  // drop whatever is held (or open an empty fist)
  release() {
    if (this.hold) {
      const piece = this.hold.piece;
      if (!piece.dead) this.sim.world.destroyJoint(this.hold.joint);
      piece.heldBy.delete(this);
      this.hold = null;
      if (!piece.dead) {
        piece.releasedAt = this.sim.time;
        piece.releasedBy = this.slot;
        this.sim.onReleased(piece);
      }
      this.sim.emit({ type: 'release', slot: this.slot, piece: piece.id });
    }
    this.setFist(false);
    this.state = 'open';
    this.rotHold = 0;
  }

  toggleGrab() {
    if (!this.enabled) return;
    this.auto = null;
    if (this.state === 'holding') this.release();
    else if (this.state === 'closed') { this.setFist(false); this.state = 'open'; this.sim.emit({ type: 'open', slot: this.slot }); }
    else this.tryGrab();
  }

  drop() {
    if (!this.enabled) return;
    if (this.state === 'closed') { this.setFist(false); this.state = 'open'; }
    this.auto = { mode: 'lower', t: 0, touch: 0 };
  }

  // turn the held piece one step (dir +1 anticlockwise, -1 clockwise); hold the button to keep turning
  rotateStart(dir) {
    if (!this.hold) return false;
    const h = this.hold;
    const ref = h.joint.getReferenceAngle();
    const rel = h.target + ref; // the angle the claw is steering the piece to
    const next = dir > 0 ? (Math.floor(rel / ROT_STEP + 0.02) + 1) * ROT_STEP : (Math.ceil(rel / ROT_STEP - 0.02) - 1) * ROT_STEP;
    h.target = next - ref;
    this.rotHold = dir;
    this.rotHeldFor = 0;
    return true;
  }

  rotateEnd() {
    if (this.hold && this.rotHold && this.rotHeldFor > 0.35) {
      const h = this.hold, ref = h.joint.getReferenceAngle();
      const step = 15 * DEG;
      h.target = Math.round((h.target + ref) / step) * step - ref;
    }
    this.rotHold = 0;
  }

  // 0..1: how hard the rope is pulling beyond the claw's own weight (1 = a heavy load swinging)
  tension() {
    return clamp((this.lastTension - this.body.getMass() * GRAVITY) / (GRAVITY * 7), 0, 1);
  }

  destroy() {
    if (this.hold) this.release();
    this.sim.world.destroyBody(this.body);
    this.sim.world.destroyBody(this.trolley);
  }
}

export class Sim {
  // mods: the level's mechanics (see shared/levels.js); none in free play
  constructor({ finishHeight = 8, players = 2, mods = {} } = {}) {
    this.world = new World({ gravity: Vec2(0, -GRAVITY), allowSleep: true });
    this.time = 0;
    this.stepCount = 0;
    this.mods = mods;
    // some mechanics need the pad raised: a sinking jelly base, a rocking base on a pivot, a mesa above the lava
    this.softTravel = mods.soft ? 0.75 : 0;
    // lava that rises part way up the tower (`upTo`, a share of the finish height) leaves the pad on the
    // ground and floats the shelves as rafts; lava that stays low raises the pad onto a mesa above it
    this.rafts = !!(mods.lava && mods.lava.upTo);
    // two pads with a gap between: two rooftops (Twin Towers) or two cliffs over a chasm (Bridge the Gap)
    this.split = mods.twin ? mods.twin.gap : mods.bridge ? mods.bridge.gap : 0;
    // a sloping pad (Hillside) is narrower, and raised so its low end is at the usual height
    const padHalf = mods.tilt ? 7 + players * 0.3 : mods.hill ? 8.5 + players * 0.4 : 0;
    const lift = (mods.soft ? 0.8 : 0) + (mods.tilt ? 1.0 : 0) + (mods.lava && !this.rafts ? 1.4 : 0)
      + (mods.hill ? mods.hill.slope * padHalf : 0) + (mods.twin ? 0.9 : 0) + (mods.bridge ? 1.7 : 0);
    this.padTop = LAYOUT.padTop + lift;
    this.finishBase = finishHeight;
    this.finishHeight = finishHeight;
    this.finishY = this.padTop + finishHeight;
    this.lineAmp = mods.moveLine ? mods.moveLine.amp : 0;
    this.lineFrozen = false;
    this.topY = this.finishY + this.lineAmp + 6.5;
    this.layout = makeLayout(this.topY, players, { lift, padHalf, raftTop: this.rafts ? () => this.raftTop() : null });
    this.barLimit = this.layout.halfW - 0.7;
    this.pieces = new Set();
    this.claws = new Map();      // slot -> Claw
    this.platforms = new Map();  // slot -> static body
    this.events = [];
    this.queue = [];             // work that can't happen inside a physics callback
    this.tower = { height: 0, count: 0, top: null, set: new Set(), x: 0 };
    this.towerLog = [];          // recent heights, for spotting collapses
    this.fallLog = [];           // pieces that recently fell off the tower
    this.lastCollapse = -99;
    this.wind = 0;               // now: sideways push, m/s² at the finish line (+ is to the right)
    this.tilt = 0;               // now: the rocking base's angle
    // the lava: the game raises it over the round, up to just under the pad
    this.lavaTop = this.rafts ? this.padTop + mods.lava.upTo * finishHeight : this.padTop - 0.25 - this.softTravel - (mods.tilt ? Math.sin((mods.tilt.amp * Math.PI) / 180) * this.layout.padHalf : 0);
    this.lavaY = mods.lava ? -0.6 : -Infinity;
    // the dangers that come and go (earthquakes, meteors, mixed-up controls) only happen while the game
    // says so: during building, not in the lobby, the countdown or the hands-off checks
    this.hazards = false;
    this.belt = 0;               // now: the conveyor belt's speed (+ is to the right)
    this.quake = mods.quake ? { next: 10, warned: false, start: -1, end: -1, x: 0 } : null;
    this.meteor = mods.meteors ? { next: 8, warn: null } : null;
    this.mixNext = 8;

    const ground = this.world.createBody({ type: 'static' });
    const gh = this.layout.groundHalf;
    if (mods.bridge) {
      // a bottomless chasm between the cliffs
      const g = this.split / 2, w = (gh - g) / 2;
      for (const sx of [-1, 1]) ground.createFixture({ shape: new Box(w, 1, Vec2(sx * (g + w), -1), 0), friction: 0.9, filterCategoryBits: CAT.STATIC });
    } else {
      ground.createFixture({ shape: new Box(gh, 1, Vec2(0, -1), 0), friction: 0.9, filterCategoryBits: CAT.STATIC });
    }
    ground.setUserData({ kind: 'ground' });
    this.ground = ground;
    this.buildPad();

    this.world.on('begin-contact', (c) => this.onBeginContact(c));
  }

  // the build pad: a solid block, or springy jelly segments (soft), or a slab rocking on a pivot (tilt).
  // padBodies: what the tower stands on, with their half sizes (the TV draws them).
  // (cx, cy: where the middle of the box is on its body)
  buildPad() {
    const half = this.layout.padHalf, top = this.padTop, mods = this.mods;
    this.padBodies = [];
    const add = (body, hw, hh, kind, cx = 0, cy = 0) => { body.setUserData({ kind: 'pad' }); this.padBodies.push({ body, hw, hh, kind, cx, cy, x0: body.getPosition().x }); return body; };
    if (mods.tilt) {
      // a slab on a motorised hinge: strong enough to rock any tower, but (unlike something moved by
      // force of will) it stalls rather than crushing whatever gets caught under its end
      const slab = this.world.createBody({ type: 'dynamic', position: Vec2(0, top - 0.2), angularDamping: 0.5 });
      slab.createFixture({ shape: new Box(half, 0.2), density: 2, friction: 0.95, filterCategoryBits: CAT.PAD, filterMaskBits: CAT.PIECE | CAT.CLAW });
      slab.setSleepingAllowed(false);
      this.hinge = this.world.createJoint(new RevoluteJoint({ enableMotor: true, maxMotorTorque: 6000, motorSpeed: 0 }, this.ground, slab, Vec2(0, top - 0.2)));
      add(slab, half, 0.2, 'tilt');
      // a solid base under the pivot, below the slab's reach
      const base = this.world.createBody({ type: 'static' });
      base.createFixture({ shape: new Box(0.8, (top - 1.0) / 2, Vec2(0, (top - 1.0) / 2), 0), friction: 0.9, filterCategoryBits: CAT.STATIC });
      base.setUserData({ kind: 'ground' });
      this.pivot = { hw: 0.8, h: top - 1.0 };
    } else if (mods.soft) {
      const n = Math.max(4, Math.round((half * 2) / 1.6));
      const w = (half * 2) / n;
      if (top - 0.4 - this.softTravel > 0.05) {
        // the box the jelly sits in
        const tub = this.world.createBody({ type: 'static' });
        const h = top - 0.4 - this.softTravel;
        tub.createFixture({ shape: new Box(half, h / 2, Vec2(0, h / 2), 0), friction: 0.9, filterCategoryBits: CAT.STATIC });
        tub.setUserData({ kind: 'ground' });
        this.tub = { hw: half, h };
      }
      for (let i = 0; i < n; i++) {
        const x = -half + w * (i + 0.5);
        const seg = this.world.createBody({ type: 'dynamic', position: Vec2(x, top - 0.2), fixedRotation: true, linearDamping: 0.5 });
        seg.createFixture({ shape: new Box(w / 2 - 0.02, 0.2), density: 1, friction: 0.95, restitution: 0, filterCategoryBits: CAT.PAD, filterMaskBits: CAT.PIECE | CAT.CLAW });
        seg.setSleepingAllowed(false);
        this.world.createJoint(new PrismaticJoint({ enableLimit: true, lowerTranslation: -this.softTravel, upperTranslation: 0.05 }, this.ground, seg, Vec2(x, top - 0.2), Vec2(0, 1)));
        add(seg, w / 2 - 0.02, 0.2, 'soft').__rest = top - 0.2;
      }
    } else if (mods.hill) {
      // a slope rising to the right
      const k = mods.hill.slope;
      const pad = this.world.createBody({ type: 'static' });
      pad.createFixture({ shape: new Polygon([Vec2(-half, 0), Vec2(half, 0), Vec2(half, top + k * half), Vec2(-half, top - k * half)]), friction: 0.95, filterCategoryBits: CAT.STATIC });
      add(pad, half, top / 2, 'hill');
      this.padBodies[this.padBodies.length - 1].slope = k;
    } else {
      // a solid block (or two, with a gap between). An earthquake shakes it and a conveyor belt runs
      // along its top, so then it's kinematic: it moves, but nothing pushes it around.
      const moving = !!(mods.quake || mods.conveyor);
      const g = this.split / 2;
      const parts = g ? [[-(g + half) / 2, (half - g) / 2], [(g + half) / 2, (half - g) / 2]] : [[0, half]];
      const kind = mods.conveyor ? 'belt' : mods.twin ? 'roof' : mods.bridge ? 'cliff' : 'solid';
      for (const [cx, hw] of parts) {
        const pad = this.world.createBody({ type: moving ? 'kinematic' : 'static', position: Vec2(cx, 0) });
        pad.createFixture({ shape: new Box(hw, top / 2, Vec2(0, top / 2), 0), friction: 0.95, filterCategoryBits: CAT.STATIC });
        add(pad, hw, top / 2, kind, 0, top / 2);
      }
      this.padMoves = moving;
    }
    this.pad = this.padBodies[0].body;
  }

  // moves the finish line (in the lobby, as players join); the top bar stays put until the next round
  setFinishHeight(h) {
    this.finishBase = h;
    this.finishHeight = h;
    this.finishY = this.padTop + h;
  }

  emit(ev) { this.events.push(ev); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  addPlayer(slot) {
    if (this.claws.has(slot)) return this.claws.get(slot);
    const L = this.layout.slot(slot);
    let plat;
    if (L.raft) {
      // a raft riding on the lava
      plat = this.world.createBody({ type: 'kinematic', position: Vec2((L.x0 + L.x1) / 2, L.top - 0.25) });
      plat.createFixture({ shape: new Box(LAYOUT.shelfW / 2, 0.25), friction: 0.95, filterCategoryBits: CAT.STATIC });
    } else {
      plat = this.world.createBody({ type: 'static' });
      // a solid step from the ground up (the higher steps, further out, overlap its outer part)
      plat.createFixture({
        shape: new Box(LAYOUT.shelfW / 2, L.top / 2, Vec2((L.x0 + L.x1) / 2, L.top / 2), 0), friction: 0.95, filterCategoryBits: CAT.STATIC,
      });
    }
    plat.setUserData({ kind: 'platform', slot });
    this.platforms.set(slot, plat);
    const claw = new Claw(this, slot, L.x);
    this.claws.set(slot, claw);
    return claw;
  }

  removePlayer(slot) {
    const claw = this.claws.get(slot);
    if (claw) { claw.destroy(); this.claws.delete(slot); }
    for (const p of this.pieces) if (p.parked && p.owner === slot) this.unpark(p);
    const plat = this.platforms.get(slot);
    if (plat) {
      this.world.destroyBody(plat);
      this.platforms.delete(slot);
      for (const p of this.pieces) p.body.setAwake(true);
    }
  }

  // ---------- pieces ----------

  // would a piece of this shape at this pose overlap anything (other than `ignore`)?
  blocked(shapeId, x, y, angle, ignore = null) {
    const shapes = makeShapes(shapeId);
    const xf = new Transform(Vec2(x, y), angle);
    const e = extentsOf(shapeId, angle);
    const box = new AABB(Vec2(x + e.x0 + 0.02, y + e.y0 + 0.02), Vec2(x + e.x1 - 0.02, y + e.y1 - 0.02));
    let hit = false;
    this.world.queryAABB(box, (fx) => {
      const b = fx.getBody();
      if (b === ignore || fx.isSensor()) return true;
      const ud = b.getUserData();
      if (!ud || (ud.kind === 'claw' && ud.claw.trolley === b)) return true;
      for (const s of shapes) {
        if (testOverlap(s, 0, fx.getShape(), 0, xf, b.getTransform())) { hit = true; return false; }
      }
      return true;
    });
    return hit;
  }

  createPiece(type, owner, x, y, angle) {
    const piece = new Piece(this, type, owner, x, y, angle);
    this.pieces.add(piece);
    this.emit({ type: 'spawn', piece: piece.id, slot: owner, x, y });
    return piece;
  }

  // a new piece straight into an empty claw, if there's room under it
  spawnInClaw(slot, type, angle = 0) {
    const claw = this.claws.get(slot);
    if (!claw || claw.hold) return null;
    const shape = PIECES[type].shape;
    const ca = claw.body.getAngle();
    const e = extentsOf(shape, ca + angle);
    const palm = claw.body.getWorldPoint(Vec2(0, CLAW.hubCy - CLAW.hubHalfH - 0.03));
    const x = palm.x - (e.x0 + e.x1) / 2, y = palm.y - e.y1;
    if (y + e.y0 < 0.05 || this.blocked(shape, x, y, ca + angle)) return null;
    claw.setFist(false);
    const piece = this.createPiece(type, slot, x, y, ca + angle);
    piece.body.setLinearVelocity(claw.body.getLinearVelocity());
    claw.attach(piece, false);
    return piece;
  }

  // a new piece on the player's own platform (it drops in from just above)
  spawnOnPlatform(slot, type, angle = 0) {
    if (!this.platforms.has(slot)) return null;
    const shape = PIECES[type].shape;
    const e = extentsOf(shape, angle);
    const L = this.layout.slot(slot);
    for (const dx of this.shelfShifts(L, e)) {
      const x = L.x + dx - (e.x0 + e.x1) / 2, y = L.top + 0.025 - e.y0;
      if (!this.blocked(shape, x, y, angle)) {
        const p = this.createPiece(type, slot, x, y, angle);
        this.park(p);
        return p;
      }
    }
    return null;
  }

  // rafts float on the lava (and sit on the ground until it reaches them)
  raftTop() { return Math.max(0.55, this.lavaY + 0.35); }

  // where to try putting a piece on a shelf: in the middle of the turntable first, then slid further
  // and further in towards the pad (a big piece waiting on a small shelf just overhangs its edge,
  // which is fine: it's held still until it's grabbed), and a little outwards
  shelfShifts(L, e) {
    const out = [0];
    const reach = (e.x1 - e.x0) / 2 + 1;
    for (let d = 0.25; d <= reach; d += 0.25) out.push(-d * L.side);
    out.push(0.25 * L.side, 0.5 * L.side);
    return out;
  }

  // A new piece waits on its shelf's turntable, held still at whatever angle it's turned to (so a cube
  // turned onto its corner doesn't topple). It becomes an ordinary piece once a claw grabs it.
  park(p) {
    p.parked = true;
    p.body.setKinematic();
    p.body.setLinearVelocity(Vec2(0, 0));
    p.body.setAngularVelocity(0);
  }

  unpark(p) {
    if (!p.parked) return;
    p.parked = false;
    p.body.setDynamic();
    p.body.setAwake(true);
  }

  parkedPiece(slot) {
    for (const p of this.pieces) if (p.parked && !p.dead && p.owner === slot) return p;
    return null;
  }

  // is the player's last new piece still waiting on their shelf?
  shelfBusy(slot) { return !!this.parkedPiece(slot); }

  // turn the piece waiting on a player's shelf one step (the shelf is a turntable).
  // 'turned', or why not: 'empty' (nothing waiting) or 'blocked' (no room to turn it there)
  turnPlatformPiece(slot, dir) {
    const p = this.parkedPiece(slot);
    if (!p) return 'empty';
    const a = p.body.getAngle();
    const next = dir > 0 ? (Math.floor(a / ROT_STEP + 0.02) + 1) * ROT_STEP : (Math.ceil(a / ROT_STEP - 0.02) - 1) * ROT_STEP;
    const e = extentsOf(p.shape, next), e0 = extentsOf(p.shape, a);
    const pos = p.body.getPosition();
    // keep the middle of the piece where it was, sitting on the shelf (or slide it in if it no longer fits)
    const L = this.layout.slot(slot);
    const cx = pos.x + (e0.x0 + e0.x1) / 2;
    const y = L.top + 0.025 - e.y0;
    for (const dx of this.shelfShifts(L, e)) {
      const x = cx + dx - (e.x0 + e.x1) / 2;
      if (this.blocked(p.shape, x, y, next, p.body)) continue;
      p.body.setTransform(Vec2(x, y), next);
      this.emit({ type: 'turn', piece: p.id, slot });
      return 'turned';
    }
    return 'blocked';
  }

  removePiece(piece, reason) {
    if (piece.dead) return;
    for (const claw of [...piece.heldBy]) claw.release();
    piece.dead = true;
    for (const w of piece.welds) {
      const back = w.other.welds.findIndex((o) => o.other === piece);
      if (back >= 0) w.other.welds.splice(back, 1);
    }
    piece.welds = [];
    const pos = piece.body.getPosition().clone();
    this.world.destroyBody(piece.body);
    this.pieces.delete(piece);
    this.tower.set.delete(piece);
    this.emit({ type: 'remove', piece: piece.id, reason, owner: piece.owner, releasedBy: piece.releasedBy, pieceType: piece.type, x: pos.x, y: pos.y, special: piece.special });
  }

  // ---------- specials ----------

  onReleased(piece) {
    if (!piece.special || piece.armed) return;
    piece.armed = true;
    piece.armedAt = this.time;
    if (piece.special === 'sticky') {
      for (let ce = piece.body.getContactList(); ce; ce = ce.next) {
        if (ce.contact.isTouching()) this.queue.push(() => this.weld(piece, ce.other));
      }
    }
    if (piece.special === 'balloon') this.queue.push(() => this.tieBalloon(piece));
    this.emit({ type: 'armed', piece: piece.id, special: piece.special });
  }

  weld(piece, otherBody) {
    const ud = otherBody.getUserData();
    if (piece.dead || ud?.kind !== 'piece') return; // glue only holds pieces (never the ground)
    const other = ud.piece;
    if (other.dead || other === piece || !other.body.isDynamic() || other.special === 'balloon' || other.special === 'meteor') return;
    if (piece.welds.some((w) => w.other === other)) return;
    if (piece.welds.length >= (piece.special === 'magnet' ? 8 : 6)) return;
    const a = piece.body.getWorldCenter(), b = other.body.getWorldCenter();
    const joint = this.world.createJoint(new WeldJoint({ frequencyHz: 0, dampingRatio: 0 }, piece.body, other.body, Vec2((a.x + b.x) / 2, (a.y + b.y) / 2)));
    piece.welds.push({ other, joint });
    other.welds.push({ other: piece, joint });
    this.emit({ type: 'weld', piece: piece.id, other: other.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, special: piece.special });
  }

  tieBalloon(balloon) {
    if (balloon.dead || balloon.tie) return;
    const pos = balloon.body.getPosition();
    const knotY = pos.y - 0.55;
    let best = null, bestD = 2.2;
    for (const p of this.pieces) {
      if (p === balloon || p.dead || p.special === 'balloon' || p.special === 'meteor' || p.heldBy.size) continue;
      const c = p.body.getWorldCenter();
      if (c.y > pos.y + 0.3) continue;
      const d = Math.hypot(c.x - pos.x, p.top - knotY);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best) return;
    // tie the string to the top of that piece, above its middle
    const c = best.body.getWorldCenter();
    const anchor = Vec2(c.x, Math.min(best.top, pos.y - 0.4) - 0.05);
    const knot = balloon.body.getWorldPoint(Vec2(0, -0.55));
    const local = best.body.getLocalPoint(anchor);
    const joint = this.world.createJoint(new RopeJoint({
      maxLength: Math.max(0.6, Vec2.distance(knot, anchor) + 0.15), localAnchorA: Vec2(0, -0.55), localAnchorB: local, collideConnected: true,
    }, balloon.body, best.body));
    balloon.tie = { piece: best, joint, local };
    this.emit({ type: 'tie', piece: balloon.id, other: best.id });
  }

  stepSpecials() {
    for (const p of this.pieces) {
      if (!p.special || p.dead) continue;
      if (p.special === 'balloon') {
        // floats on its own; tied to a piece it takes most of that piece's weight (never all of it)
        const tied = p.tie && !p.tie.piece.dead ? p.tie.piece : null;
        let lift = p.heldBy.size ? p.mass : p.mass + 1; // (in a claw it just weighs nothing)
        if (tied) {
          let m = tied.mass;
          for (const w of tied.welds) m += w.other.mass;
          lift = p.mass + Math.min(0.8 * m, 6);
        }
        const v = p.body.getLinearVelocity();
        p.body.applyForceToCenter(Vec2(-3 * v.x, GRAVITY * lift - 3 * v.y), true);
      } else if (p.special === 'magnet' && p.armed && !p.heldBy.size) {
        // a clamp: for a moment after it's let go it pulls in whatever is close, then holds it all fast
        const age = this.time - p.armedAt;
        if (age < 0.8) {
          const c = p.body.getWorldCenter();
          for (const o of this.near(p, 0.6)) {
            const oc = o.body.getWorldCenter();
            const dx = c.x - oc.x, dy = c.y - oc.y, d = Math.hypot(dx, dy) || 1;
            o.body.applyForceToCenter(Vec2(dx / d * 16 * o.mass, dy / d * 16 * o.mass), true);
          }
        } else if (!p.clamped) {
          p.clamped = true;
          for (const o of this.near(p, 0.3)) this.weld(p, o.body);
          this.emit({ type: 'clamp', piece: p.id });
        }
      }
    }
  }

  // loose pieces within `gap` of a piece's bounding box
  near(piece, gap) {
    const out = new Set();
    const box = new AABB(Vec2(Infinity, Infinity), Vec2(-Infinity, -Infinity));
    for (let f = piece.body.getFixtureList(); f; f = f.getNext()) box.combine(box, f.getAABB(0));
    box.lowerBound.x -= gap; box.lowerBound.y -= gap; box.upperBound.x += gap; box.upperBound.y += gap;
    this.world.queryAABB(box, (fx) => {
      const ud = fx.getBody().getUserData();
      const o = ud?.kind === 'piece' ? ud.piece : null;
      if (o && o !== piece && !o.dead && !o.heldBy.size && o.body.isDynamic() && o.special !== 'balloon' && o.special !== 'meteor') out.add(o);
      return true;
    });
    return out;
  }

  // time's up: claws let go, and the temporary helpers (support beams, balloons) go away
  removeAids() {
    for (const claw of this.claws.values()) { claw.auto = null; if (claw.state !== 'open') claw.release(); }
    for (const p of [...this.pieces]) {
      if ((p.special === 'support' || p.special === 'balloon') && p.armed) this.removePiece(p, 'aid');
    }
  }

  // ---------- contacts ----------

  onBeginContact(contact) {
    const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
    const ua = a.getUserData(), ub = b.getUserData();
    for (const [x, y] of [[a, b], [b, a]]) {
      const ud = x.getUserData();
      if (ud?.kind !== 'piece') continue;
      const p = ud.piece;
      if (p.special === 'meteor' && !p.hitSomething) { p.hitSomething = true; this.queue.push(() => this.meteorHit(p, y)); }
      if (p.armed && (p.special === 'sticky' || (p.special === 'magnet' && p.clamped))) this.queue.push(() => this.weld(p, y));
    }
    // a sound and a wobble for anything that hits hard enough
    const pa = ua?.kind === 'piece' ? ua.piece : null, pb = ub?.kind === 'piece' ? ub.piece : null;
    if (!pa && !pb && ua?.kind !== 'claw' && ub?.kind !== 'claw') return;
    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.pointCount) return;
    const pt = wm.points[0], n = wm.normal;
    const va = a.getLinearVelocityFromWorldPoint(pt), vb = b.getLinearVelocityFromWorldPoint(pt);
    const speed = Math.abs((vb.x - va.x) * n.x + (vb.y - va.y) * n.y);
    if (speed < 1.1) return;
    // fragile glass shatters when it hits (or is hit) hard
    if (this.mods.fragile && speed > 3.6) {
      for (const p of [pa, pb]) if (p && p.mat === 'glass' && !p.parked) this.queue.push(() => { if (!p.dead) { const q = p.body.getPosition(); this.removePiece(p, 'shatter'); this.emit({ type: 'shatter', x: q.x, y: q.y }); } });
    }
    const now = this.time;
    if ((a.__hit ?? -1) > now - 0.1 || (b.__hit ?? -1) > now - 0.1) return;
    if (a.isDynamic()) a.__hit = now;
    if (b.isDynamic()) b.__hit = now;
    const ma = a.isDynamic() ? a.getMass() : 0, mb = b.isDynamic() ? b.getMass() : 0;
    const loud = pa && pb ? (pa.mass > pb.mass ? pa : pb) : (pa || pb);
    this.emit({
      type: 'impact', x: pt.x, y: pt.y, strength: Math.min(1, speed / 9), mass: Math.min(20, Math.max(ma, mb)),
      mat: loud ? loud.mat : 'metal', pieces: [pa?.id, pb?.id].filter(Boolean), claw: ua?.kind === 'claw' || ub?.kind === 'claw',
    });
  }

  // ---------- the tower ----------

  // everything standing on the build pad (directly or on other pieces), not held, not flying
  measureTower() {
    const set = new Set();
    const queue = [];
    const ok = (p) => p && !p.dead && !p.heldBy.size && p.body.isDynamic() && p.special !== 'balloon' && p.special !== 'meteor' && p.body.getLinearVelocity().length() < 1.6;
    const pieceOf = (b) => { const ud = b.getUserData(); return ud?.kind === 'piece' ? ud.piece : null; };
    for (const pb of this.padBodies) {
      for (let ce = pb.body.getContactList(); ce; ce = ce.next) {
        if (!ce.contact.isTouching()) continue;
        const p = pieceOf(ce.other);
        if (ok(p) && !set.has(p)) { set.add(p); queue.push(p); }
      }
    }
    // a piece that was in the tower a moment ago and is still sitting there (a springy or rocking base
    // can lift it off for an instant) still counts: the tower hasn't fallen because a contact flickered
    const graced = new Set();
    for (const p of this.tower.set) {
      if (!set.has(p) && ok(p) && this.time - (p.inTowerAt ?? -9) < 0.5 && p.body.getLinearVelocity().length() < 0.6) { set.add(p); queue.push(p); graced.add(p); }
    }
    while (queue.length) {
      const p = queue.pop();
      for (let ce = p.body.getContactList(); ce; ce = ce.next) {
        if (!ce.contact.isTouching()) continue;
        const o = pieceOf(ce.other);
        if (ok(o) && !set.has(o)) { set.add(o); queue.push(o); }
      }
      for (const w of p.welds) if (ok(w.other) && !set.has(w.other)) { set.add(w.other); queue.push(w.other); }
    }
    let top = null, topY = this.padTop, sx = 0;
    for (const p of set) if (!graced.has(p)) p.inTowerAt = this.time; // (the grace runs out half a second after a real contact)
    let sides = null;
    if (this.mods.twin) {
      // two towers: the lower one's height is what counts (each piece belongs to the rooftop it's over)
      const s = [{ y: this.padTop, top: null, x: -this.layout.padHalf / 2, n: 0, sx: 0 }, { y: this.padTop, top: null, x: this.layout.padHalf / 2, n: 0, sx: 0 }];
      for (const p of set) {
        const c = p.body.getWorldCenter(), side = s[c.x < 0 ? 0 : 1];
        side.n++; side.sx += c.x;
        if (p.top > side.y) { side.y = p.top; side.top = p; }
      }
      for (const side of s) if (side.n) side.x = side.sx / side.n;
      sides = s.map((side) => ({ x: side.x, h: Math.max(0, side.y - this.padTop), n: side.n }));
      const low = s[0].y <= s[1].y ? s[0] : s[1];
      topY = low.y; top = low.top;
      for (const p of set) sx += p.body.getWorldCenter().x;
    } else if (this.mods.bridge) {
      // over the chasm: only pieces whose middle is above the gap count towards the height
      const g = this.split / 2 + 0.25;
      for (const p of set) {
        const c = p.body.getWorldCenter();
        sx += c.x;
        if (Math.abs(c.x) < g && p.top > topY) { topY = p.top; top = p; }
      }
    } else {
      for (const p of set) {
        const t = p.top;
        sx += p.body.getWorldCenter().x;
        if (t > topY) { topY = t; top = p; }
      }
    }
    // pieces that were in the tower and now aren't (and nobody picked them up) fell off
    for (const p of this.tower.set) {
      if (!set.has(p) && !p.heldBy.size && !p.dead) this.fallLog.push({ t: this.time, id: p.id });
    }
    const prevCount = this.tower.count;
    this.tower = { height: Math.max(0, topY - this.padTop), count: set.size, top, set, x: set.size ? sx / set.size : 0, topX: top ? top.body.getWorldCenter().x : 0, topY, sides };

    // collapse: a good part of a decent tower falling at once
    this.towerLog.push({ t: this.time, h: this.tower.height, n: set.size });
    while (this.towerLog.length && this.towerLog[0].t < this.time - 3) this.towerLog.shift();
    while (this.fallLog.length && this.fallLog[0].t < this.time - 2) this.fallLog.shift();
    const peak = this.towerLog.reduce((m, e) => (e.h > m.h ? e : m), { h: 0, n: 0 });
    const fell = new Set(this.fallLog.map((f) => f.id)).size;
    if (this.time - this.lastCollapse > 5 && peak.n >= 5 && fell >= Math.max(3, peak.n * 0.3) && peak.h - this.tower.height > 1.5) {
      this.lastCollapse = this.time;
      this.emit({ type: 'collapse', from: peak.h, to: this.tower.height, fell, x: this.tower.x });
      this.fallLog = [];
    }
    return prevCount;
  }

  // ---------- the loop ----------

  step(dt = STEP) {
    for (const claw of this.claws.values()) claw.preStep(dt);
    this.stepMods(dt);
    this.stepSpecials();
    this.world.step(dt, 10, 6);
    if (this.padMoves) for (const pb of this.padBodies) pb.body.setTransform(Vec2(pb.want, pb.wantY), 0);
    // a safety net: nothing flies faster than this (a piece or claw squeezed somewhere it can't be
    // would otherwise be shot out)
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      if (!b.isDynamic()) continue;
      const v = b.getLinearVelocity(), sp = v.length();
      if (sp > 22) b.setLinearVelocity(Vec2(v.x * 22 / sp, v.y * 22 / sp));
    }
    const q = this.queue; this.queue = [];
    for (const fn of q) fn();
    for (const claw of this.claws.values()) claw.postStep(dt);
    this.time += dt;
    this.stepCount++;
    if (this.stepCount % 6 === 0) this.slowStep();
  }

  // the level's mechanics, every step
  stepMods(dt) {
    const m = this.mods, t = this.time;
    // the finish line drifting up and down
    if (this.lineAmp && !this.lineFrozen) {
      this.finishHeight = this.finishBase + this.lineAmp * Math.sin((2 * Math.PI * t) / m.moveLine.period);
      this.finishY = this.padTop + this.finishHeight;
    }
    // the rafts ride up with the lava, carrying the pieces waiting on them
    if (this.rafts) {
      const want = this.raftTop() - 0.25;
      for (const [slot, raft] of this.platforms) {
        const vy = clamp((want - raft.getPosition().y) / dt, -3, 3);
        raft.setLinearVelocity(Vec2(0, vy));
        for (const p of this.pieces) if (p.parked && p.owner === slot) p.body.setLinearVelocity(Vec2(0, vy));
      }
    }
    // the base rocking from side to side
    if (m.tilt) {
      const A = (m.tilt.amp * Math.PI) / 180;
      const w = (2 * Math.PI) / m.tilt.period;
      const want = A * Math.sin(w * (t + dt)), wantSpeed = A * w * Math.cos(w * (t + dt));
      const slab = this.padBodies[0].body;
      this.hinge.setMotorSpeed(clamp(wantSpeed + 6 * (want - slab.getAngle()), -0.6, 0.6));
      this.tilt = slab.getAngle();
    }
    // jelly: each segment of the base sits on its own spring (a heavy base sinks it about 0.2 m)
    if (m.soft) {
      for (const pb of this.padBodies) {
        const b = pb.body;
        const y = b.getPosition().y, vy = b.getLinearVelocity().y;
        b.applyForceToCenter(Vec2(0, b.getMass() * GRAVITY + 140 * (b.__rest - y) - 45 * vy), true);
      }
    }
    // wind: gusts that come and go and change direction, stronger higher up
    if (m.wind) {
      this.wind = m.wind.max * (0.55 * Math.sin(t * 0.21) + 0.3 * Math.sin(t * 0.57 + 1.3) + 0.15 * Math.sin(t * 1.7 + 0.4));
      for (const p of this.pieces) {
        if (p.dead || !p.body.isDynamic()) continue;
        const k = clamp((p.body.getWorldCenter().y - this.padTop) / Math.max(2, this.finishHeight), 0.15, 1.3);
        p.body.applyForceToCenter(Vec2(this.wind * k * p.mass, 0), true);
      }
      for (const c of this.claws.values()) c.body.applyForceToCenter(Vec2(this.wind * 0.4 * c.body.getMass(), 0), true);
    }
    // low gravity on the right half
    if (m.gravity) {
      const up = GRAVITY * (1 - m.gravity.right);
      for (const p of this.pieces) if (!p.dead && p.body.isDynamic() && p.body.getWorldCenter().x > 0) p.body.applyForceToCenter(Vec2(0, up * p.mass), false);
      for (const c of this.claws.values()) if (c.body.getPosition().x > 0) c.body.applyForceToCenter(Vec2(0, up * c.body.getMass()), true);
    }
    // magnetic blocks: opposite poles pull together, the same push apart
    if (m.magnets) {
      const mags = [];
      for (const p of this.pieces) if (p.def.pole && !p.dead && p.body.isDynamic()) mags.push(p);
      for (let i = 0; i < mags.length; i++) {
        for (let j = i + 1; j < mags.length; j++) {
          const a = mags[i], b = mags[j];
          const pa = a.body.getWorldCenter(), pb = b.body.getWorldCenter();
          const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy);
          if (d > 3.2 || d < 0.01) continue;
          // (strong enough up close to slide a block over, but a block stacked on its own pole only gets light)
          const f = Math.min(22, 30 / Math.max(0.75, d) ** 2) * (a.def.pole * b.def.pole < 0 ? 1 : -1);
          a.body.applyForceToCenter(Vec2((dx / d) * f, (dy / d) * f), true);
          b.body.applyForceToCenter(Vec2((-dx / d) * f, (-dy / d) * f), true);
        }
      }
    }
    // the pad moving: an earthquake shakes it from side to side; a conveyor belt's top runs one way, slows
    // and runs back. (A kinematic pad given the belt's speed drags whatever sits on it by friction, and
    // is put back in place after each step, so it's the surface that moves, not the pad.)
    if (this.padMoves) {
      this.belt = m.conveyor ? m.conveyor.speed * Math.sin((2 * Math.PI * t) / m.conveyor.period) : 0;
      const qx = this.stepQuake(dt);
      const moving = qx !== this.quakeX || this.quakeY !== 0 || Math.abs(this.belt) > 0.01;
      for (const pb of this.padBodies) {
        pb.want = pb.x0 + qx;
        pb.wantY = this.quakeY;
        const at = pb.body.getPosition();
        pb.body.setLinearVelocity(Vec2((pb.want - at.x) / dt + this.belt, (pb.wantY - at.y) / dt));
        if (moving) for (let ce = pb.body.getContactList(); ce; ce = ce.next) ce.other.setAwake(true);
      }
      this.quakeX = qx;
    }
    // the night: lightning now and then (just a flash and a rumble)
    if (m.dark && this.hazards && t >= (this.boltNext ?? 6)) {
      this.boltNext = t + 10 + Math.random() * 12;
      if (t > 6) this.emit({ type: 'lightning' });
    }
    // meteors: a target shows where the next one will land, then down it comes
    if (this.meteor) this.stepMeteors(m.meteors);
    // mixed-up claws: now and then someone's controls flip for a while
    if (m.mixup && this.hazards && t >= this.mixNext) {
      this.mixNext = t + m.mixup.min + Math.random() * (m.mixup.max - m.mixup.min);
      const list = [...this.claws.values()].filter((c) => c.enabled && !c.boosted && c.flipUntil + 8 < t); // (and a break between flips)
      if (list.length) {
        const c = list[Math.floor(Math.random() * list.length)];
        c.flipUntil = t + m.mixup.len;
        c.flipBoth = Math.random() < 0.35;
        this.emit({ type: 'flip', slot: c.slot, both: c.flipBoth, len: m.mixup.len });
      }
    } else if (m.mixup && !this.hazards) this.mixNext = Math.max(this.mixNext, t + 6);
    // unstable claws: now and then a grip slips (or lets go), or a rope stretches
    if (m.unstable) {
      for (const c of this.claws.values()) {
        if (!c.enabled || t < c.nextGlitch) continue;
        c.nextGlitch = t + m.unstable.min + Math.random() * (m.unstable.max - m.unstable.min);
        if (c.boosted) continue;
        const r = Math.random();
        if (c.hold && r < m.unstable.drop) { c.release(); this.emit({ type: 'glitch', slot: c.slot, kind: 'drop' }); }
        else if (c.hold && r < 0.6) { c.slipUntil = t + 1.2; this.emit({ type: 'glitch', slot: c.slot, kind: 'slip' }); }
        else {
          c.ropeLen = Math.min(c.maxRope(), c.ropeLen + 0.5 + Math.random() * 0.6);
          c.rope.setMaxLength(c.ropeLen);
          this.emit({ type: 'glitch', slot: c.slot, kind: 'stretch' });
        }
      }
    }
  }

  // the earthquake: warned about, then a few seconds of shaking (smoothly in and out). The pad's offset now.
  stepQuake(dt) {
    const q = this.quake;
    this.quakeY = 0;
    if (!q) return 0;
    const Q = this.mods.quake, t = this.time + dt;
    if (q.start < 0) {
      // none starts in the lobby or while the tower is being judged, nor within 10 s of building resuming
      if (!this.hazards) { q.next = Math.max(q.next, t + 10); q.warned = false; return 0; }
      if (!q.warned && t >= q.next - 2.5) { q.warned = true; this.emit({ type: 'quakewarn' }); }
      if (t < q.next) return 0;
      q.start = t; q.end = t + Q.len;
      this.emit({ type: 'quake', len: Q.len });
    }
    if (t >= q.end) {
      q.start = -1; q.warned = false;
      q.next = t + Q.every * (0.8 + Math.random() * 0.4);
      return 0;
    }
    const u = (t - q.start) / Q.len, env = Math.sin(Math.PI * u) ** 2, w = 2 * Math.PI * Q.hz * (t - q.start);
    this.quakeY = (Q.ay || 0) * env * (1 - Math.cos(2 * w)) / 2; // and a little jolting up and down (never below rest)
    return Q.amp * env * Math.sin(w);
  }

  get quaking() { return !!this.quake && this.quake.start >= 0; }

  stepMeteors(M) {
    const ms = this.meteor, t = this.time;
    if (!this.hazards) { ms.next = Math.max(ms.next, t + 6); ms.warn = null; return; }
    if (!ms.warn && t >= ms.next - 2.2) {
      // most aim at the top of the tower, the rest anywhere over the pad
      const top = this.tower.top;
      const half = this.layout.padHalf - 1;
      const x = top && this.tower.count >= 3 && Math.random() < 0.6 ? top.body.getWorldCenter().x + (Math.random() - 0.5) * 1.2 : (Math.random() * 2 - 1) * half;
      ms.warn = { x: clamp(x, -half, half), at: ms.next };
      this.emit({ type: 'meteorwarn', x: ms.warn.x });
    }
    if (ms.warn && t >= ms.next) {
      const p = new Piece(this, 'meteor', -1, ms.warn.x, this.topY - 0.9, 0);
      p.body.setLinearVelocity(Vec2(0, -3));
      this.pieces.add(p);
      this.emit({ type: 'meteorfall', piece: p.id, x: ms.warn.x });
      ms.warn = null;
      ms.next = t + M.min + Math.random() * (M.max - M.min);
    }
  }

  // a meteor hit something: a claw blocks it, a wooden (burnable) piece burns, anything else just gets a knock
  meteorHit(meteor, other) {
    if (meteor.dead) return;
    const pos = meteor.body.getPosition().clone();
    const ud = other.getUserData();
    let hit = 'ground';
    if (ud?.kind === 'claw') hit = 'claw';
    else if (ud?.kind === 'piece' && !ud.piece.dead && ud.piece.special !== 'meteor') {
      const o = ud.piece;
      hit = 'piece';
      if (MATERIALS[o.mat].burns && !o.special && !o.parked && !o.heldBy.size) {
        const q = o.body.getPosition();
        this.removePiece(o, 'burn');
        this.emit({ type: 'burn', x: q.x, y: q.y });
        hit = 'burn';
      }
    }
    this.removePiece(meteor, 'meteor');
    this.emit({ type: 'meteor', x: pos.x, y: pos.y, hit, slot: ud?.kind === 'claw' ? ud.claw.slot : -1 });
  }

  slowStep() {
    this.measureTower();
    // the lava burns whatever reaches down into it
    if (this.lavaY > -Infinity) {
      for (const p of [...this.pieces]) {
        if (!p.dead && !p.parked && MATERIALS[p.mat].burns && bodyBottom(p.body) < this.lavaY) {
          const pos = p.body.getPosition();
          this.removePiece(p, 'burn');
          this.emit({ type: 'burn', x: pos.x, y: this.lavaY });
        }
      }
    }
    for (const p of [...this.pieces]) {
      const pos = p.body.getPosition();
      if (pos.y < LAYOUT.killY || Math.abs(pos.x) > this.layout.groundHalf + 10) { this.removePiece(p, 'lost'); continue; }
      // a released piece that settles into the tower "locks" in (stats, the clunk)
      if (!p.locked && p.releasedAt >= 0 && !p.heldBy.size) {
        const age = this.time - p.releasedAt;
        if (age > 8) p.releasedAt = -1;
        else if (this.tower.set.has(p) && p.body.getLinearVelocity().length() < 0.25 && Math.abs(p.body.getAngularVelocity()) < 0.4 && age > 0.25) {
          p.locked = true;
          this.emit({ type: 'lock', piece: p.id, slot: p.releasedBy, top: p.top - this.padTop, x: pos.x, y: pos.y, mat: p.mat });
        }
      }
      if (p.special === 'support' && p.armed) {
        if (p.anchoredAt < 0 && p.body.getLinearVelocity().length() < 0.4 && !p.heldBy.size) {
          for (let ce = p.body.getContactList(); ce; ce = ce.next) {
            const k = ce.other.getUserData()?.kind;
            if (ce.contact.isTouching() && (k === 'ground' || k === 'pad' || k === 'platform')) {
              p.anchoredAt = this.time;
              p.body.setStatic();
              this.emit({ type: 'anchor', piece: p.id, x: pos.x, y: pos.y });
              break;
            }
          }
        } else if (p.anchoredAt >= 0 && this.time - p.anchoredAt > 20) {
          this.removePiece(p, 'expired');
        }
      }
      if (p.special === 'balloon' && ((p.armed && this.time - p.armedAt > 40) || pos.y > this.topY + 1.5)) this.removePiece(p, 'pop');
    }
  }
}
