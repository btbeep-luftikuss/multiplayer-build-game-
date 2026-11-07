// The physics of the play area (runs on the TV only): the ground and build pad, the top bar, one claw per
// player hanging from it on a rope, each player's spawn platform, and every building piece.
// Built on planck.js (a JavaScript port of Box2D, chosen for stable stacking). The world is 2D;
// the TV draws it in 3D. Units: metres, kilograms, seconds; y points up.
import { World, Vec2, AABB, Box, Polygon, Circle, Transform, RopeJoint, RevoluteJoint, WeldJoint, testOverlap } from 'planck';
import { SHAPES, PIECES, MATERIALS, extentsOf } from '../shared/pieces.js';

export const STEP = 1 / 60;
export const GRAVITY = 10;
const CAT = { STATIC: 0x1, PIECE: 0x2, CLAW: 0x4 };
const DEG = Math.PI / 180;

export const LAYOUT = {
  padHalf: 12,         // the build pad runs from -12 to 12: most of the ground
  padTop: 0.3,
  groundHalf: 23,
  barHalf: 22.6,
  shelfW: 3,
  killY: -8,
  // Spawn shelves out at the far left and right, alternating sides: solid steps rising like stairs
  // towards the edges. Each higher step starts 1.8 m further out, so the step below keeps 1.8 m of
  // open top for its pieces.
  // x0/x1: the shelf's inner and outer ends; x: where new pieces arrive (the part a claw can reach).
  slot(s) {
    const side = s % 2 === 0 ? -1 : 1, level = Math.floor(s / 2);
    const inner = 14 + level * 1.8;
    return { side, level, top: 1.0 + level * 2.8, x0: side * inner, x1: side * (inner + LAYOUT.shelfW), x: side * (inner + 0.9) };
  },
};

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
      linearDamping: def.special === 'balloon' ? 1.6 : 0.02,
      angularDamping: def.special === 'balloon' ? 2 : 0.08,
    });
    for (const shape of makeShapes(def.shape)) {
      this.body.createFixture({
        shape, density: m.density, friction: m.friction, restitution: m.restitution,
        filterCategoryBits: CAT.PIECE, filterMaskBits: CAT.STATIC | CAT.PIECE | CAT.CLAW,
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
      filterCategoryBits: CAT.CLAW, filterMaskBits: CAT.STATIC | CAT.PIECE | CAT.CLAW,
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
  }

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
    const inp = this.enabled ? this.input : { mx: 0, ry: 0 };
    // trolley along the bar
    const vmax = CLAW.vMax / (1 + load / 12);
    const target = clamp(inp.mx, -1, 1) * vmax;
    const accel = CLAW.accel * (Math.abs(target) < Math.abs(this.vx) ? 1.2 : 1);
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
    } else if (inp.ry > 0) rate = inp.ry * CLAW.reelIn / (1 + load / 4);
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
      const err = h.target - h.joint.getJointAngle();
      h.joint.setMotorSpeed(clamp(CLAW.servoGain * err, -CLAW.servoMax, CLAW.servoMax));
      h.strain = Math.min(1, Math.abs(err) / 0.5);
    }
  }

  postStep(dt) {
    const f = this.rope.getReactionForce(1 / dt);
    this.lastTension = Math.hypot(f.x, f.y);
    if (!this.auto) return;
    const a = this.auto;
    a.t += dt;
    if (a.mode === 'raise') {
      if (a.t > 0.7) this.auto = null;
      return;
    }
    if (this.touchingSomething() || this.ropeLen >= this.maxRope() - 0.02) a.touch += dt;
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
        density: 1, friction: 0.6, filterCategoryBits: CAT.CLAW, filterMaskBits: CAT.STATIC | CAT.PIECE | CAT.CLAW,
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
          if (ud?.kind === 'piece' && !ud.piece.dead && fx.getBody().isDynamic() && fx.testPoint(p)) {
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
  constructor({ finishHeight = 8 } = {}) {
    this.world = new World({ gravity: Vec2(0, -GRAVITY), allowSleep: true });
    this.time = 0;
    this.stepCount = 0;
    this.finishHeight = finishHeight;
    this.finishY = LAYOUT.padTop + finishHeight;
    this.topY = this.finishY + 6.5;
    this.barLimit = LAYOUT.barHalf - 0.6;
    this.pieces = new Set();
    this.claws = new Map();      // slot -> Claw
    this.platforms = new Map();  // slot -> static body
    this.events = [];
    this.queue = [];             // work that can't happen inside a physics callback
    this.tower = { height: 0, count: 0, top: null, set: new Set(), x: 0 };
    this.towerLog = [];          // recent heights, for spotting collapses
    this.fallLog = [];           // pieces that recently fell off the tower
    this.lastCollapse = -99;

    const ground = this.world.createBody({ type: 'static' });
    ground.createFixture({ shape: new Box(LAYOUT.groundHalf, 1, Vec2(0, -1), 0), friction: 0.9, filterCategoryBits: CAT.STATIC });
    ground.setUserData({ kind: 'ground' });
    this.ground = ground;
    const pad = this.world.createBody({ type: 'static' });
    pad.createFixture({ shape: new Box(LAYOUT.padHalf, LAYOUT.padTop / 2, Vec2(0, LAYOUT.padTop / 2), 0), friction: 0.95, filterCategoryBits: CAT.STATIC });
    pad.setUserData({ kind: 'pad' });
    this.pad = pad;

    this.world.on('begin-contact', (c) => this.onBeginContact(c));
  }

  // moves the finish line (in the lobby, as players join); the top bar stays put until the next round
  setFinishHeight(h) {
    this.finishHeight = h;
    this.finishY = LAYOUT.padTop + h;
  }

  emit(ev) { this.events.push(ev); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  addPlayer(slot) {
    if (this.claws.has(slot)) return this.claws.get(slot);
    const L = LAYOUT.slot(slot);
    const plat = this.world.createBody({ type: 'static' });
    // a solid step from the ground up (the higher steps, further out, overlap its outer part)
    plat.createFixture({
      shape: new Box(LAYOUT.shelfW / 2, L.top / 2, Vec2((L.x0 + L.x1) / 2, L.top / 2), 0), friction: 0.95, filterCategoryBits: CAT.STATIC,
    });
    plat.setUserData({ kind: 'platform', slot });
    this.platforms.set(slot, plat);
    const claw = new Claw(this, slot, L.x);
    this.claws.set(slot, claw);
    return claw;
  }

  removePlayer(slot) {
    const claw = this.claws.get(slot);
    if (claw) { claw.destroy(); this.claws.delete(slot); }
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
    const L = LAYOUT.slot(slot);
    for (const dx of [0, -0.5 * L.side, 0.5 * L.side]) {
      const x = L.x + dx - (e.x0 + e.x1) / 2, y = L.top + 0.04 - e.y0;
      if (!this.blocked(shape, x, y, angle)) {
        const p = this.createPiece(type, slot, x, y, angle);
        p.waiting = true;
        return p;
      }
    }
    return null;
  }

  // is the player's last new piece still waiting on their shelf? (grabbed, or gone from the shelf, frees it)
  shelfBusy(slot) {
    const L = LAYOUT.slot(slot);
    for (const p of this.pieces) {
      if (!p.waiting || p.owner !== slot) continue;
      const pos = p.body.getPosition();
      if (p.dead || p.heldBy.size || Math.abs(pos.x - L.x) > 2.6 || pos.y < L.top - 0.5 || pos.y > L.top + 4) p.waiting = false;
      else return true;
    }
    return false;
  }

  // spin the newest loose piece sitting on a player's platform (the platform is a turntable)
  turnPlatformPiece(slot, dir) {
    const plat = this.platforms.get(slot);
    if (!plat) return false;
    let best = null;
    for (const p of this.pieces) {
      if (p.owner !== slot || p.heldBy.size || p.dead || !p.body.isDynamic()) continue;
      let onPlat = false;
      for (let ce = p.body.getContactList(); ce; ce = ce.next) if (ce.other === plat && ce.contact.isTouching()) onPlat = true;
      if (onPlat && (!best || p.bornAt > best.bornAt)) best = p;
    }
    if (!best) return false;
    const a = best.body.getAngle();
    const next = dir > 0 ? (Math.floor(a / ROT_STEP + 0.02) + 1) * ROT_STEP : (Math.ceil(a / ROT_STEP - 0.02) - 1) * ROT_STEP;
    const e = extentsOf(best.shape, next);
    const pos = best.body.getPosition();
    for (const lift of [0.04, 0.4, 0.8, 1.3]) {
      const y = LAYOUT.slot(slot).top - e.y0 + lift;
      if (!this.blocked(best.shape, pos.x, y, next, best.body)) {
        best.body.setTransform(Vec2(pos.x, y), next);
        best.body.setLinearVelocity(Vec2(0, 0));
        best.body.setAngularVelocity(0);
        best.body.setAwake(true);
        this.emit({ type: 'turn', piece: best.id, slot });
        return true;
      }
    }
    return false;
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
    if (other.dead || other === piece || !other.body.isDynamic() || other.special === 'balloon') return;
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
      if (p === balloon || p.dead || p.special === 'balloon' || p.heldBy.size) continue;
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
      if (o && o !== piece && !o.dead && !o.heldBy.size && o.body.isDynamic() && o.special !== 'balloon') out.add(o);
      return true;
    });
    return out;
  }

  // time's up: claws let go, and the temporary helpers (support beams, balloons) go away
  removeAids() {
    for (const claw of this.claws.values()) { claw.auto = null; if (claw.state !== 'open') claw.release(); }
    for (const p of [...this.pieces]) {
      if (p.special === 'support' || p.special === 'balloon') this.removePiece(p, 'aid');
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
    const ok = (p) => p && !p.dead && !p.heldBy.size && p.body.isDynamic() && p.special !== 'balloon' && p.body.getLinearVelocity().length() < 1.6;
    const pieceOf = (b) => { const ud = b.getUserData(); return ud?.kind === 'piece' ? ud.piece : null; };
    for (let ce = this.pad.getContactList(); ce; ce = ce.next) {
      if (!ce.contact.isTouching()) continue;
      const p = pieceOf(ce.other);
      if (ok(p) && !set.has(p)) { set.add(p); queue.push(p); }
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
    let top = null, topY = LAYOUT.padTop, sx = 0;
    for (const p of set) {
      const t = p.top;
      sx += p.body.getWorldCenter().x;
      if (t > topY) { topY = t; top = p; }
    }
    // pieces that were in the tower and now aren't (and nobody picked them up) fell off
    for (const p of this.tower.set) {
      if (!set.has(p) && !p.heldBy.size && !p.dead) this.fallLog.push({ t: this.time, id: p.id });
    }
    const prevCount = this.tower.count;
    this.tower = { height: Math.max(0, topY - LAYOUT.padTop), count: set.size, top, set, x: set.size ? sx / set.size : 0, topY };

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
    this.stepSpecials();
    this.world.step(dt, 10, 6);
    const q = this.queue; this.queue = [];
    for (const fn of q) fn();
    for (const claw of this.claws.values()) claw.postStep(dt);
    this.time += dt;
    this.stepCount++;
    if (this.stepCount % 6 === 0) this.slowStep();
  }

  slowStep() {
    this.measureTower();
    for (const p of [...this.pieces]) {
      const pos = p.body.getPosition();
      if (pos.y < LAYOUT.killY || Math.abs(pos.x) > LAYOUT.groundHalf + 10) { this.removePiece(p, 'lost'); continue; }
      // a released piece that settles into the tower "locks" in (stats, the clunk)
      if (!p.locked && p.releasedAt >= 0 && !p.heldBy.size) {
        const age = this.time - p.releasedAt;
        if (age > 8) p.releasedAt = -1;
        else if (this.tower.set.has(p) && p.body.getLinearVelocity().length() < 0.25 && Math.abs(p.body.getAngularVelocity()) < 0.4 && age > 0.25) {
          p.locked = true;
          this.emit({ type: 'lock', piece: p.id, slot: p.releasedBy, top: p.top - LAYOUT.padTop, x: pos.x, y: pos.y, mat: p.mat });
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
