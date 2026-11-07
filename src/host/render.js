// The TV picture (three.js). The physics is flat (x, y); everything is drawn as chunky 3D toys
// seen from the front, a little from above and to the side, with cartoon shading and outlines.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHAPES, MATERIALS, PIECES, outlineOf } from '../shared/pieces.js';
import { LAYOUT, CLAW } from '../sim/sim.js';
import * as TX from './textures.js';

const DEPTH = 1.0;           // how deep (towards the camera) every piece is
const INK = '#1e1533';       // outline colour
const FINGER_Z = 0.6;        // finger pairs in front of and behind the piece
const ROPE_SEGMENTS = 16;
const MAX_CLAWS = 8;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function outlineMaterial(color, thickness) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, thickness: { value: thickness } },
    vertexShader: 'uniform float thickness; void main() { vec3 p = position + normal * thickness; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); \n#include <colorspace_fragment>\n }',
    side: THREE.BackSide,
  });
}

// the outline shell: the same shape with its corners merged, so pushing out along the normals keeps it closed
function hullOf(geo) {
  const g = geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  const m = mergeVertices(g, 1e-3);
  m.computeVertexNormals();
  g.dispose();
  return m;
}

function extrude(pts, bevel = 0.07, depth = DEPTH) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 10,
  });
  geo.translate(0, 0, -(depth - 2 * bevel) / 2);
  return geo;
}

function roundedRect(w, h, r) {
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}

export class Renderer {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    this.outlines = quality !== 'low';
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.75));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = quality !== 'low';
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 600);
    this.ramp = TX.toonRamp();
    this.mats = new Map();
    this.geos = new Map();
    this.inks = new Map();
    this.pieceViews = new Map();
    this.clawViews = new Map();
    this.platformViews = new Map();
    this.cam = null;
    this.shakeAmt = 0;
    this.time = 0;
    this.sim = null;
    this.world = null;
    this.crossed = false;
    this.inset = 0;          // share of the screen on the left covered by a panel (the lobby)
    this.insetNow = 0;
    this.buildSky();
    this.buildLights();
    this.buildRopes();
    this.buildParticles();
    this.resize();
  }

  // ---------- materials and shapes ----------

  toon(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshToonMaterial({ color, gradientMap: this.ramp, ...opts }));
    return this.mats.get(key);
  }

  ink(color = INK) {
    if (!this.inks.has(color)) this.inks.set(color, outlineMaterial(color, color === INK ? 0.035 : 0.075));
    return this.inks.get(color);
  }

  pieceMaterial(matId, look) {
    const key = 'piece:' + matId + ':' + (look || '');
    if (this.mats.has(key)) return this.mats.get(key);
    const m = MATERIALS[matId];
    const kind = look === 'crate' ? 'crate' : look === 'girder' ? 'girder' : matId;
    const opts = { color: '#ffffff', map: TX.materialTexture(kind, m.color), gradientMap: this.ramp };
    if (matId === 'glass') Object.assign(opts, { transparent: true, opacity: 0.72 });
    if (matId === 'ice') Object.assign(opts, { transparent: true, opacity: 0.88 });
    if (matId === 'goo') Object.assign(opts, { emissive: new THREE.Color('#2a8a10'), emissiveIntensity: 0.35 });
    const mat = new THREE.MeshToonMaterial(opts);
    this.mats.set(key, mat);
    return mat;
  }

  pieceGeometry(shapeId) {
    if (this.geos.has(shapeId)) return this.geos.get(shapeId);
    const s = SHAPES[shapeId];
    let geo;
    if (s.look === 'column') {
      const p = s.parts[0].pts;
      const w = Math.abs(p[1][0] - p[0][0]), h = Math.abs(p[2][1] - p[1][1]);
      geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 24);
    } else if (s.look === 'log') {
      geo = new THREE.CylinderGeometry(s.parts[0].r, s.parts[0].r, DEPTH * 0.92, 24);
      geo.rotateX(Math.PI / 2);
    } else if (s.look === 'ball') {
      geo = new THREE.SphereGeometry(s.parts[0].r, 24, 16);
    } else if (s.look === 'balloon') {
      geo = new THREE.SphereGeometry(s.parts[0].r, 24, 16);
      geo.scale(1, 1.12, 1);
    } else if (s.look === 'magnet') {
      geo = extrude([[-0.65, -0.35], [-0.32, -0.35], [-0.32, 0.03], [0.32, 0.03], [0.32, -0.35], [0.65, -0.35], [0.65, 0.35], [-0.65, 0.35]], 0.06);
    } else {
      const out = outlineOf(shapeId);
      geo = extrude(out.pts, s.look === 'star' ? 0.035 : 0.07);
    }
    const entry = { geo, hull: hullOf(geo) };
    this.geos.set(shapeId, entry);
    return entry;
  }

  // ---------- the scenery that never changes ----------

  buildSky() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#5bb8ff'); grad.addColorStop(0.55, '#a8dcff'); grad.addColorStop(1, '#fff1d6');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    const sky = new THREE.CanvasTexture(c);
    sky.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = sky;

    const back = new THREE.Group();
    // far hills and a skyline: soft, low-contrast, so the play area stands out
    const hillMat = [this.toon('#7cc7a4'), this.toon('#93d6b0'), this.toon('#6db897')];
    for (let i = 0; i < 9; i++) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), hillMat[i % 3]);
      const z = -70 - (i % 3) * 25;
      hill.scale.set(30 + (i * 37) % 25, 9 + (i * 13) % 8, 10);
      hill.position.set(-110 + i * 28, -4, z);
      back.add(hill);
    }
    const cityMat = this.toon('#a9c4e0');
    for (let i = 0; i < 26; i++) {
      const w = 4 + (i * 7) % 6, h = 8 + (i * 29) % 22;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), cityMat);
      b.position.set(-130 + i * 10.5, h / 2 - 2, -150);
      back.add(b);
    }
    // distant cranes, for the building-site feel
    const craneMat = this.toon('#f2c14e');
    for (const [x, s] of [[-75, 1], [60, 0.8]]) {
      const crane = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 46, 1.4), craneMat); mast.position.y = 23; crane.add(mast);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 1.2), craneMat); jib.position.set(10, 45, 0); crane.add(jib);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), this.toon('#e98b3a')); cab.position.set(0, 42, 0); crane.add(cab);
      crane.position.set(x, -2, -120); crane.scale.setScalar(s);
      back.add(crane);
    }
    this.clouds = [];
    const cloudMat = this.toon('#ffffff');
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cloudMat);
        puff.position.set(k * 2.2 - 3, Math.sin(k * 1.7) * 0.6, 0);
        puff.scale.setScalar(1.6 + ((k * 31 + i * 7) % 10) / 8);
        cloud.add(puff);
      }
      cloud.position.set(-90 + i * 22, 22 + (i * 17) % 18, -60 - (i % 3) * 15);
      cloud.scale.set(1.6, 0.8, 1);
      this.clouds.push(cloud);
      back.add(cloud);
    }
    const sun = new THREE.Mesh(new THREE.CircleGeometry(7, 32), new THREE.MeshBasicMaterial({ color: '#fff6b0' }));
    sun.position.set(55, 48, -160);
    back.add(sun);
    this.scene.add(back);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#e4f4ff', '#ffe0b5', 1.25));
    const sun = this.sunLight = new THREE.DirectionalLight('#fff3df', 2.1);
    sun.position.set(-12, 30, 22);
    sun.target.position.set(0, 6, 0);
    sun.castShadow = this.quality !== 'low';
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -6, near: 1, far: 90 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
  }

  // the parts of the play area that depend on the round (bar height, finish line)
  buildWorld(sim) {
    if (this.world) { this.scene.remove(this.world); this.world.traverse((o) => o.geometry && !o.userData.shared && o.geometry.dispose()); }
    const w = this.world = new THREE.Group();
    const gh = LAYOUT.groundHalf;
    // ground: a grassy slab with a dirt front
    const ground = new THREE.Mesh(new THREE.BoxGeometry(gh * 2, 3, 9), [
      this.toon('#9a6942'), this.toon('#9a6942'), this.toon('#ffffff', { map: TX.grassTexture() }), this.toon('#9a6942'),
      this.toon('#ffffff', { map: TX.dirtTexture() }), this.toon('#9a6942'),
    ]);
    ground.position.set(0, -1.5, -1.5);
    ground.receiveShadow = true;
    w.add(ground);
    // the build pad
    const pad = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.padHalf * 2, LAYOUT.padTop, 2.2), [
      this.toon('#ffffff', { map: TX.stripesTexture() }), this.toon('#ffffff', { map: TX.stripesTexture() }),
      this.toon('#ffffff', { map: TX.concreteTexture() }), this.toon('#bdb6aa'),
      this.toon('#ffffff', { map: TX.signTexture('BUILD HERE       ·       BUILD HERE       ·       BUILD HERE', '#ffc21a', '#2a2a2a', 2048, 26) }), this.toon('#bdb6aa'),
    ]);
    pad.position.set(0, LAYOUT.padTop / 2, 0);
    pad.receiveShadow = pad.castShadow = true;
    w.add(pad);
    // the top bar (a gantry): a striped beam held up by two towers at the ends
    const top = sim.topY;
    const barMat = this.toon('#ffffff', { map: TX.stripesTexture('#ff9f1c', '#3a3a48', 8) });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.barHalf * 2 + 2, 0.36, 0.7), barMat);
    bar.material.map.repeat.set(LAYOUT.barHalf * 2 / 4, 1);
    bar.position.set(0, top + 0.18, 0);
    bar.castShadow = true;
    w.add(bar);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.barHalf * 2 + 2, 0.08, 0.9), this.toon('#5b5b6e'));
    rail.position.set(0, top + 0.02, 0);
    w.add(rail);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, top + 0.6, 0.7), this.toon('#ff9f1c'));
      post.position.set(sx * (LAYOUT.barHalf + 1.3), (top + 0.6) / 2, -0.3);
      post.castShadow = true;
      w.add(post);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.4), this.toon('#ff9f1c'));
      brace.position.set(sx * (LAYOUT.barHalf + 0.4), top - 0.6, -0.3);
      brace.rotation.z = sx * 0.6;
      w.add(brace);
    }
    // the finish line: a checkered band behind the build and a glowing sheet across it
    const fy = sim.finishY;
    const fw = LAYOUT.groundHalf * 2;
    const dots = TX.dotsTexture();
    dots.repeat.set(fw / 0.6, 1);
    this.finishBand = new THREE.Mesh(new THREE.PlaneGeometry(fw, 0.3), new THREE.MeshBasicMaterial({ map: dots, transparent: true, depthWrite: false }));
    this.finishBand.position.set(0, fy, -1.05);
    w.add(this.finishBand);
    // and the same dots in front of the build, so the line reads across the tower too
    const front = new THREE.Mesh(new THREE.PlaneGeometry(fw, 0.3), new THREE.MeshBasicMaterial({ map: dots, transparent: true, opacity: 0.55, depthWrite: false }));
    front.position.set(0, fy, 1.05);
    w.add(front);
    this.finishSheet = new THREE.Mesh(new THREE.PlaneGeometry(fw, 2.2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    this.finishSheet.rotation.x = -Math.PI / 2;
    this.finishSheet.position.set(0, fy, 0);
    w.add(this.finishSheet);
    this.finishFlags = [];
    for (const sx of [-1, 1]) {
      const flag = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), this.toon('#eeeeee'));
      pole.position.y = 0.8;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ map: TX.checkerTexture(), side: THREE.DoubleSide }));
      cloth.position.set(sx * 0.45, 1.3, 0);
      flag.add(pole, cloth);
      flag.position.set(sx * (LAYOUT.padHalf + 0.9), fy - 0.8, -1.1);
      w.add(flag);
      this.finishFlags.push(cloth);
    }
    // the tower's current top: a dashed marker
    this.topMarker = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.06), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
    this.topMarker.position.set(0, LAYOUT.padTop, -1.02);
    w.add(this.topMarker);
    this.scene.add(w);
  }

  // ---------- following the simulation ----------

  setSim(sim) {
    for (const v of this.pieceViews.values()) this.scene.remove(v.group);
    this.pieceViews.clear();
    for (const v of this.clawViews.values()) this.disposeClaw(v);
    this.clawViews.clear();
    for (const v of this.platformViews.values()) this.scene.remove(v.group);
    this.platformViews.clear();
    this.sim = sim;
    this.crossed = false;
    this.buildWorld(sim);
    this.cam = null;
  }

  makePieceView(piece) {
    const def = PIECES[piece.type];
    const look = SHAPES[def.shape].look;
    const { geo, hull } = this.pieceGeometry(def.shape);
    const group = new THREE.Group();
    let mesh;
    if (look === 'log') {
      mesh = new THREE.Mesh(geo, [this.toon('#a0612e'), this.toon('#ffffff', { map: TX.materialTexture('wood', '#f0c27a') }), this.toon('#ffffff', { map: TX.materialTexture('wood', '#f0c27a') })]);
    } else {
      mesh = new THREE.Mesh(geo, this.pieceMaterial(def.mat, look));
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    let outline = null;
    if (this.outlines) { outline = new THREE.Mesh(hull, this.ink()); group.add(outline); }
    if (look === 'column') {
      // a capital and a base on columns
      const p = SHAPES[def.shape].parts[0].pts;
      const w = Math.abs(p[1][0] - p[0][0]), h = Math.abs(p[2][1] - p[1][1]);
      for (const sy of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.0, 0.16, w * 1.15), this.toon(MATERIALS[def.mat].dark));
        cap.position.y = sy * (h / 2 - 0.08);
        group.add(cap);
      }
    } else if (look === 'magnet') {
      for (const sx of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.16, DEPTH * 0.98), this.toon('#e8eef5'));
        tip.position.set(sx * 0.485, -0.27, 0);
        group.add(tip);
      }
    } else if (look === 'balloon') {
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 8), this.toon(MATERIALS.balloon.dark));
      knot.position.y = -0.64;
      knot.rotation.x = Math.PI;
      group.add(knot);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
      shine.position.set(-0.2, 0.25, 0.42);
      shine.scale.set(1, 1.5, 0.5);
      group.add(shine);
    } else if (look === 'goo') {
      for (let i = 0; i < 4; i++) {
        const drip = new THREE.Mesh(new THREE.SphereGeometry(0.11 + (i % 2) * 0.04, 10, 8), this.pieceMaterial('goo', 'goo'));
        drip.position.set(-0.35 + i * 0.24, -0.5 - (i % 2) * 0.05, 0.42);
        drip.scale.y = 1.4;
        group.add(drip);
      }
    }
    // a string for balloons (drawn from the knot to whatever it's tied to)
    let string = null;
    if (piece.special === 'balloon') {
      string = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 5), this.toon('#ffffff'));
      string.visible = false;
      this.scene.add(string);
    }
    this.scene.add(group);
    return { group, mesh, outline, string, piece, wobble: 0, phase: 0, born: this.time, inkColor: INK, flash: 0 };
  }

  removePieceView(id) {
    const v = this.pieceViews.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    if (v.string) { this.scene.remove(v.string); v.string.geometry.dispose(); }
    v.group.traverse((o) => { if (o !== v.mesh && o !== v.outline && o.geometry) o.geometry.dispose(); });
    this.pieceViews.delete(id);
  }

  makePlatformView(slot, player) {
    const group = new THREE.Group();
    const color = player?.color || '#999999';
    const L = LAYOUT.slot(slot);
    const t = LAYOUT.shelfThick;
    const sign = TX.signTexture(`${player?.kit?.icon || ''} ${player?.name || ''}`.trim(), color, '#ffffff', 512, 80);
    // the shelf: a coloured board with the player's name on its front edge
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.shelfW, t, 2.0), [
      this.toon(color), this.toon(color), this.toon('#f4f1ea'), this.toon(color), this.toon('#ffffff', { map: sign }), this.toon(color),
    ]);
    shelf.position.set((L.x0 + L.x1) / 2, L.top - t / 2, 0);
    shelf.castShadow = shelf.receiveShadow = true;
    group.add(shelf);
    // the post holding it up, and a bracket under it
    const postH = L.top - t;
    if (postH > 0.05) {
      const px = L.x1 - L.side * 0.2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, postH, 1.6), this.toon('#5b5b6e'));
      post.position.set(px, postH / 2, 0);
      post.castShadow = true;
      const brace = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.2), this.toon('#5b5b6e'));
      brace.position.set(px - L.side * 0.55, L.top - t - 0.45, 0);
      brace.rotation.z = L.side * 0.6;
      group.add(post, brace);
    }
    // the turntable where new pieces arrive (it spins when a piece on it is turned)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 32), new THREE.MeshToonMaterial({ color, gradientMap: this.ramp, transparent: true, opacity: 0.5 }));
    disc.position.set(L.x, L.top + 0.03, 0);
    for (const a of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
      bar.rotation.y = a;
      bar.position.y = 0.03;
      disc.add(bar);
    }
    group.add(disc);
    if (this.outlines) {
      const o = new THREE.Mesh(hullOf(shelf.geometry), this.ink());
      o.position.copy(shelf.position);
      group.add(o);
    }
    this.scene.add(group);
    return { group, disc, name: player?.name, color, sign };
  }

  // ---------- claws ----------

  makeClawView(slot, color) {
    const metal = this.toon('#c8cfdb'), dark = this.toon('#4a4a5e'), col = this.toon(color);
    // the trolley riding on the bar
    const trolley = new THREE.Group();
    const cart = new THREE.Mesh(extrude(roundedRect(1.1, 0.5, 0.12), 0.05, 1.05), col);
    cart.castShadow = true;
    trolley.add(cart);
    const wheels = [];
    for (const sx of [-0.32, 0.32]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.95, 8), dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(sx, 0.3, 0);
      trolley.add(wheel);
      wheels.push(wheel);
    }
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), metal);
    reel.rotation.x = Math.PI / 2;
    reel.position.y = -0.2;
    trolley.add(reel);
    if (this.outlines) trolley.add(new THREE.Mesh(hullOf(cart.geometry), this.ink()));
    // the claw head
    const head = new THREE.Group();
    const hub = new THREE.Mesh(extrude(roundedRect(CLAW.hubHalfW * 2, CLAW.hubHalfH * 2 + 0.04, 0.12), 0.05, 1.3), col);
    hub.position.y = CLAW.hubCy;
    hub.castShadow = true;
    head.add(hub);
    if (this.outlines) { const o = new THREE.Mesh(hullOf(hub.geometry), this.ink()); o.position.copy(hub.position); head.add(o); }
    const band = new THREE.Mesh(new THREE.BoxGeometry(CLAW.hubHalfW * 2 + 0.02, 0.08, 1.32), this.toon('#ffffff'));
    band.position.y = CLAW.hubCy + 0.06;
    head.add(band);
    const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), lampMat);
    lamp.position.set(0, CLAW.hubCy - 0.04, 0.67);
    head.add(lamp);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.12, 10), dark);
    knob.position.y = CLAW.ropeOnClaw;
    head.add(knob);
    // four fingers: a pair in front of the piece, a pair behind it
    const fingers = [];
    const upperGeo = new THREE.BoxGeometry(0.12, 0.36, 0.16); upperGeo.translate(0, -0.18, 0);
    const lowerGeo = new THREE.BoxGeometry(0.1, 0.32, 0.15); lowerGeo.translate(0, -0.16, 0);
    for (const z of [FINGER_Z, -FINGER_Z]) {
      for (const sx of [-1, 1]) {
        const upper = new THREE.Group();
        upper.position.set(sx * 0.34, CLAW.hubCy - CLAW.hubHalfH + 0.02, z);
        const u = new THREE.Mesh(upperGeo, metal); u.castShadow = true;
        const joint = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), col);
        const lower = new THREE.Group();
        lower.position.y = -0.36;
        const l = new THREE.Mesh(lowerGeo, metal); l.castShadow = true;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 8), dark);
        tip.position.y = -0.37; tip.rotation.z = Math.PI;
        lower.add(l, tip);
        upper.add(u, joint, lower);
        head.add(upper);
        fingers.push({ upper, lower, sx });
      }
    }
    // the aiming line straight down, and a target ring where it lands
    const aimMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
    const aim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), aimMat);
    aim.visible = false;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    this.scene.add(trolley, head, aim, ring);
    return { trolley, head, hub, lamp, lampMat, fingers, aim, ring, wheels, open: 1, color };
  }

  disposeClaw(v) {
    this.scene.remove(v.trolley, v.head, v.aim, v.ring);
  }

  buildRopes() {
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
    const mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: this.ramp });
    this.ropes = new THREE.InstancedMesh(geo, mat, MAX_CLAWS * ROPE_SEGMENTS);
    this.ropes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ropes.count = 0;
    this.ropes.frustumCulled = false;
    this.scene.add(this.ropes);
    this.ropeColor = new THREE.Color();
  }

  // ---------- particles ----------

  buildParticles() {
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: this.ramp }), 500);
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.count = 0;
    this.puffs.frustumCulled = false;
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.12), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), 400);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confetti.count = 0;
    this.confetti.frustumCulled = false;
    this.scene.add(this.puffs, this.confetti);
    this.parts = [];
    this.bits = [];
    this.pc = new THREE.Color();
  }

  puff(x, y, { n = 8, color = '#ffffff', size = 0.25, speed = 2, life = 0.6, up = 0.5, z = 0.3, gravity = 0 } = {}) {
    for (let i = 0; i < n && this.parts.length < 500; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({
        x, y, z: z + (Math.random() - 0.5) * 0.8, vx: Math.cos(a) * s, vy: Math.sin(a) * s + up, vz: (Math.random() - 0.5) * s,
        life, max: life, size: size * (0.6 + Math.random() * 0.8), color: new THREE.Color(color), gravity,
      });
    }
  }

  confettiBurst(x, y, n = 120, colors = ['#ff4d5e', '#3d8bff', '#ffc928', '#2fd27a', '#a46bff', '#ff8a2b']) {
    for (let i = 0; i < n && this.bits.length < 400; i++) {
      const a = Math.random() * Math.PI - Math.PI, s = 4 + Math.random() * 9;
      this.bits.push({
        x: x + (Math.random() - 0.5) * 2, y, z: (Math.random() - 0.5) * 3, vx: Math.cos(a) * s * 0.6, vy: 6 + Math.random() * 10, vz: (Math.random() - 0.5) * 3,
        rx: Math.random() * 6, ry: Math.random() * 6, sx: (Math.random() - 0.5) * 12, sy: (Math.random() - 0.5) * 12, life: 4 + Math.random() * 2,
        color: new THREE.Color(colors[i % colors.length]),
      });
    }
  }

  updateParticles(dt) {
    let n = 0;
    this.parts = this.parts.filter((p) => (p.life -= dt) > 0);
    for (const p of this.parts) {
      p.vy -= p.gravity * dt;
      p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; p.vz *= 1 - 2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = p.life / p.max;
      const s = p.size * (f > 0.7 ? (1 - f) / 0.3 + 0.3 : f / 0.7);
      tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ.identity(), tmpS.set(s, s, s));
      this.puffs.setMatrixAt(n, tmpM);
      this.puffs.setColorAt(n, p.color);
      n++;
    }
    this.puffs.count = n;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
    let m = 0;
    this.bits = this.bits.filter((b) => (b.life -= dt) > 0 && b.y > -2);
    const e = new THREE.Euler();
    for (const b of this.bits) {
      b.vy -= 9 * dt;
      b.vx *= 1 - 1.2 * dt; b.vy = Math.max(b.vy, -3.5);
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.rx += b.sx * dt; b.ry += b.sy * dt;
      tmpM.compose(tmpP.set(b.x, b.y, b.z), tmpQ.setFromEuler(e.set(b.rx, b.ry, 0)), tmpS.set(1, 1, 1));
      this.confetti.setMatrixAt(m, tmpM);
      this.confetti.setColorAt(m, b.color);
      m++;
    }
    this.confetti.count = m;
    this.confetti.instanceMatrix.needsUpdate = true;
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
  }

  // ---------- events from the game ----------

  onEvent(e, game) {
    const view = (id) => this.pieceViews.get(id);
    const colorOf = (slot) => { for (const p of game.players.values()) if (p.slot === slot) return p.color; return '#ffffff'; };
    switch (e.type) {
      case 'spawn': this.puff(e.x, e.y, { n: 12, color: colorOf(e.slot), size: 0.3, speed: 3 }); break;
      case 'impact':
        for (const id of e.pieces) { const v = view(id); if (v) v.wobble = Math.min(1, v.wobble + e.strength * 1.4); }
        if (e.strength > 0.35) this.puff(e.x, e.y, { n: Math.round(3 + e.strength * 8), color: '#f3eadb', size: 0.18 + e.strength * 0.2, speed: 1.5 + e.strength * 3 });
        if (e.strength > 0.6 && e.mass > 3) this.shake(0.12 * e.strength);
        break;
      case 'lock': {
        const v = view(e.piece);
        if (v) { v.wobble = Math.min(1, v.wobble + 0.5); v.flash = 1; }
        this.puff(e.x, e.y, { n: 10, color: '#fff3a0', size: 0.13, speed: 3.5, life: 0.5 });
        break;
      }
      case 'turn': { const pv = this.platformViews.get(e.slot); if (pv) pv.spin = 1; const v = view(e.piece); if (v) v.wobble = 0.6; break; }
      case 'remove': this.puff(e.x, e.y, { n: 14, color: e.reason === 'pop' ? MATERIALS.balloon.color : '#ffffff', size: 0.3, speed: 3 }); break;
      case 'weld': this.puff(e.x, e.y, { n: 10, color: e.special === 'magnet' ? '#9fd4ff' : MATERIALS.goo.color, size: 0.16, speed: 2.5 }); break;
      case 'clamp': { const v = view(e.piece); if (v) { v.wobble = 1; v.flash = 1; } break; }
      case 'anchor': this.puff(e.x, LAYOUT.padTop, { n: 16, color: '#d9c39a', size: 0.25, speed: 3 }); break;
      case 'collapse':
        this.shake(0.7);
        this.puff(e.x, LAYOUT.padTop + 0.5, { n: 40, color: '#e9dcc4', size: 0.55, speed: 5, life: 1.2 });
        break;
      case 'result':
        if (e.result.success) {
          const x = this.sim ? this.sim.tower.x : 0;
          this.confettiBurst(x, this.sim ? this.sim.finishY : 8, 260);
        }
        break;
      case 'crossed': this.confettiBurst(this.sim ? this.sim.tower.x : 0, this.sim ? this.sim.finishY : 8, 90); break;
      case 'grab': case 'release': { const v = view(e.piece); if (v) v.wobble = Math.min(1, v.wobble + 0.35); break; }
      default: break;
    }
  }

  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  // ---------- each frame ----------

  update(dt, game) {
    this.time += dt;
    const sim = game.sim;
    if (sim !== this.sim) this.setSim(sim);
    const playerBySlot = new Map([...game.players.values()].map((p) => [p.slot, p]));

    // platforms
    for (const [slot, v] of this.platformViews) {
      const p = playerBySlot.get(slot);
      if (!sim.platforms.has(slot) || !p || p.name !== v.name) { this.scene.remove(v.group); this.platformViews.delete(slot); }
    }
    for (const slot of sim.platforms.keys()) if (!this.platformViews.has(slot)) this.platformViews.set(slot, this.makePlatformView(slot, playerBySlot.get(slot)));
    for (const v of this.platformViews.values()) if (v.spin > 0) { v.spin = Math.max(0, v.spin - dt * 2.5); v.disc.rotation.y += dt * 9 * v.spin; v.disc.material.opacity = 0.5 + 0.4 * v.spin; }

    // pieces
    for (const [id, v] of this.pieceViews) if (v.piece.dead || !sim.pieces.has(v.piece)) this.removePieceView(id);
    for (const piece of sim.pieces) {
      let v = this.pieceViews.get(piece.id);
      if (!v) { v = this.makePieceView(piece); this.pieceViews.set(piece.id, v); }
      const pos = piece.body.getPosition();
      v.group.position.set(pos.x, pos.y, 0);
      v.group.rotation.z = piece.body.getAngle();
      // cartoon squash and stretch after a knock
      v.phase += dt * 28;
      v.wobble *= Math.exp(-dt * 5);
      const age = this.time - v.born;
      const pop = age < 0.3 ? 0.4 + 0.6 * Math.sin((age / 0.3) * Math.PI / 2) + Math.sin((age / 0.3) * Math.PI) * 0.15 : 1;
      const w = v.wobble * 0.09 * Math.sin(v.phase);
      v.group.scale.set(pop * (1 + w), pop * (1 - w), pop * (1 + w * 0.5));
      // who's holding it: an outline in their colour
      const holder = piece.heldBy.size ? [...piece.heldBy][0] : null;
      const ink = holder ? (playerBySlot.get(holder.slot)?.color || INK) : INK;
      if (v.outline && ink !== v.inkColor) { v.outline.material = this.ink(ink); v.inkColor = ink; }
      if (piece.special === 'support') {
        const blink = piece.anchoredAt >= 0 && sim.time - piece.anchoredAt > 15 ? (Math.sin(this.time * 18) > 0 ? 1 : 0.35) : 1;
        v.mesh.visible = blink > 0.5 || piece.anchoredAt < 0;
      }
      if (v.string) {
        const tie = piece.tie && !piece.tie.piece.dead ? piece.tie : null;
        v.string.visible = !!tie;
        if (tie) {
          const a = piece.body.getWorldPoint({ x: 0, y: -0.6 });
          const b = tie.piece.body.getWorldPoint(tie.local);
          this.placeSegment(v.string, a.x, a.y, b.x, b.y, 0.25);
        }
      }
    }

    // claws and ropes
    for (const [slot, v] of this.clawViews) if (!sim.claws.has(slot)) { this.disposeClaw(v); this.clawViews.delete(slot); }
    let ri = 0;
    for (const [slot, claw] of sim.claws) {
      let v = this.clawViews.get(slot);
      const player = playerBySlot.get(slot);
      if (!v) { v = this.makeClawView(slot, player?.color || '#cccccc'); this.clawViews.set(slot, v); }
      const tx = claw.x;
      v.trolley.position.set(tx, sim.topY - 0.05, 0);
      for (const wh of v.wheels) wh.rotation.y = -tx / 0.17;
      const bp = claw.body.getPosition();
      v.head.position.set(bp.x, bp.y, 0);
      v.head.rotation.z = claw.body.getAngle();
      // fingers: splayed open, pinching a piece, or shut tight
      const target = claw.state === 'open' ? 1 : claw.state === 'holding' ? 0.35 : 0;
      v.open = lerp(v.open, target, 1 - Math.exp(-dt * 14));
      for (const f of v.fingers) {
        f.upper.rotation.z = f.sx * lerp(0, 0.62, v.open);
        f.lower.rotation.z = -f.sx * lerp(0.7, 0.35, v.open);
      }
      // the lamp: green when holding, white when open, grey when shut on nothing; dim if the player is away
      const away = player && !player.connected;
      v.lampMat.color.set(away ? '#555555' : claw.state === 'holding' ? '#3dff7a' : claw.state === 'closed' ? '#9aa0b0' : '#ffffff');
      // rope from the trolley to the claw, sagging when slack, warmer in colour under strain
      const a = { x: tx, y: sim.topY - 0.28 };
      const b = claw.body.getWorldPoint({ x: 0, y: CLAW.ropeOnClaw });
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const slack = Math.max(0, claw.ropeLen - dist);
      const sag = Math.min(2.5, Math.sqrt(slack) * 0.9);
      const t = claw.tension();
      this.ropeColor.set('#f6f1e4').lerp(new THREE.Color(t > 0.75 ? '#ff5a3c' : '#ffb21e'), clamp((t - 0.25) * 1.6, 0, 1));
      let px = a.x, py = a.y;
      for (let i = 1; i <= ROPE_SEGMENTS; i++) {
        const u = i / ROPE_SEGMENTS;
        const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u) - sag * 4 * u * (1 - u);
        this.ropeMatrix(px, py, x, y);
        this.ropes.setMatrixAt(ri, tmpM);
        this.ropes.setColorAt(ri, this.ropeColor);
        ri++;
        px = x; py = y;
      }
      // the aim line, while carrying something or lowering
      const showAim = claw.state === 'holding' || claw.auto;
      v.aim.visible = v.ring.visible = !!showAim;
      if (showAim) {
        const bottom = claw.hold ? this.bottomOf(claw.hold.piece) : bp.y - 0.8;
        const hit = this.rayDown(sim, bp.x, bottom - 0.02, claw);
        const len = Math.max(0.01, bottom - hit);
        v.aim.position.set(bp.x, hit + len / 2, 0.75);
        v.aim.scale.set(1, len, 1);
        v.ring.position.set(bp.x, hit + 0.03, 0);
        v.ring.scale.setScalar(0.8 + 0.15 * Math.sin(this.time * 8));
      }
    }
    this.ropes.count = ri;
    this.ropes.instanceMatrix.needsUpdate = true;
    if (this.ropes.instanceColor) this.ropes.instanceColor.needsUpdate = true;

    // the finish line glows green once the tower is over it
    const over = sim.tower.height >= sim.finishHeight;
    this.finishSheet.material.color.set(over ? '#5dff8a' : '#ffffff');
    this.finishSheet.material.opacity = over ? 0.35 + 0.15 * Math.sin(this.time * 6) : 0.18;
    for (const f of this.finishFlags) f.rotation.y = Math.sin(this.time * 3 + f.position.x) * 0.3;
    this.topMarker.position.set(sim.tower.x, LAYOUT.padTop + sim.tower.height, -1.02);
    this.topMarker.visible = sim.tower.height > 0.2;
    this.topMarker.material.color.set(over ? '#5dff8a' : '#ffffff');

    for (const c of this.clouds) { c.position.x += dt * 0.6; if (c.position.x > 110) c.position.x = -110; }
    this.updateParticles(dt);
    this.updateCamera(dt, game);
  }

  bottomOf(piece) {
    const e = this.extentsWorld(piece);
    return e.y0;
  }

  extentsWorld(piece) {
    let y0 = Infinity, y1 = -Infinity;
    const xf = piece.body.getTransform();
    for (let f = piece.body.getFixtureList(); f; f = f.getNext()) {
      const s = f.getShape();
      if (s.getType() === 'circle') {
        const c = piece.body.getWorldPoint(s.getCenter());
        y0 = Math.min(y0, c.y - s.getRadius()); y1 = Math.max(y1, c.y + s.getRadius());
      } else {
        for (let i = 0; i < s.m_count; i++) {
          const v = s.m_vertices[i];
          const y = xf.p.y + xf.q.s * v.x + xf.q.c * v.y;
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
    }
    return { y0, y1 };
  }

  // the first surface straight below (x, y), ignoring the claw and what it carries
  rayDown(sim, x, y, claw) {
    let hitY = 0;
    const held = claw.hold ? claw.hold.piece.body : null;
    sim.world.rayCast({ x, y }, { x, y: -1 }, (fixture, point, normal, fraction) => {
      const b = fixture.getBody();
      if (b === claw.body || b === held || b.getUserData()?.kind === 'claw') return -1;
      hitY = point.y;
      return fraction;
    });
    return hitY;
  }

  ropeMatrix(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 0.001;
    tmpP.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    tmpQ.setFromUnitVectors(UP, new THREE.Vector3(dx / len, dy / len, 0));
    tmpS.set(1, len * 1.04, 1);
    tmpM.compose(tmpP, tmpQ, tmpS);
  }

  placeSegment(mesh, x0, y0, x1, y1, z = 0) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 0.001;
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
    mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx / len, dy / len, 0));
    mesh.scale.set(1, len, 1);
  }

  // keep every claw, every platform in use and the whole tower in view, from the top bar to the ground
  updateCamera(dt, game) {
    const sim = this.sim;
    let x0 = -LAYOUT.padHalf - 1.5, x1 = LAYOUT.padHalf + 1.5;
    for (const slot of sim.platforms.keys()) { const L = LAYOUT.slot(slot); x0 = Math.min(x0, L.x0 - 1, L.x1 - 1); x1 = Math.max(x1, L.x0 + 1, L.x1 + 1); }
    for (const c of sim.claws.values()) {
      const hx = c.body.getPosition().x;
      x0 = Math.min(x0, c.x - 1.6, hx - 1.6); x1 = Math.max(x1, c.x + 1.6, hx + 1.6);
    }
    for (const p of sim.tower.set) { const x = p.body.getPosition().x; x0 = Math.min(x0, x - 2); x1 = Math.max(x1, x + 2); }
    const y0 = -1.2, y1 = sim.topY + 1.0;
    // room for the timer at the top and the height meter at the side
    let w = (x1 - x0) * 1.16, h = (y1 - y0) * 1.16;
    // a little extra on the right, where the height meter is
    let cx = (x0 + x1) / 2 + w * 0.035, cy = (y0 + y1) / 2 + 0.4;
    if (game.phase === 'judge' && sim.tower.count) {
      // time's up: lean in on the tower
      const k = clamp(game.phaseT / 1.2, 0, 1) * 0.35;
      cx = lerp(cx, sim.tower.x, k);
      w = lerp(w, Math.max(14, (sim.tower.topY || 6) * 1.9), k);
      h = lerp(h, (sim.tower.topY || 6) + 4, k);
      cy = lerp(cy, ((sim.tower.topY || 6) + 1) / 2, k);
    }
    this.insetNow = lerp(this.insetNow, this.inset, 1 - Math.exp(-dt * 4));
    const aspect = this.camera.aspect * (1 - this.insetNow);
    const tan = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const dist = Math.max(h / 2 / tan, w / 2 / (tan * aspect));
    const target = { cx, cy, dist };
    if (!this.cam) this.cam = { ...target };
    const k = 1 - Math.exp(-dt * 2.2);
    this.cam.cx = lerp(this.cam.cx, target.cx, k);
    this.cam.cy = lerp(this.cam.cy, target.cy, k);
    this.cam.dist = lerp(this.cam.dist, target.dist, k);
    const yaw = 0.14, pitch = 0.09;
    const c = this.cam;
    this.shakeAmt *= Math.exp(-dt * 5);
    const sh = this.shakeAmt * 0.5;
    this.camera.position.set(
      c.cx + Math.sin(yaw) * Math.cos(pitch) * c.dist + (Math.random() - 0.5) * sh,
      c.cy + Math.sin(pitch) * c.dist + (Math.random() - 0.5) * sh,
      Math.cos(yaw) * Math.cos(pitch) * c.dist,
    );
    this.camera.lookAt(c.cx + Math.sin(yaw) * 0.0, c.cy, 0);
    this.camera.far = c.dist + 400;
    const el = this.renderer.domElement;
    const W = el.clientWidth || 1, H = el.clientHeight || 1;
    if (this.insetNow > 0.002) this.camera.setViewOffset(W, H, -this.insetNow * W / 2, 0, W, H);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // where a point in the world is on screen, in CSS pixels
  project(x, y, z = 0) {
    tmpP.set(x, y, z).project(this.camera);
    const el = this.renderer.domElement;
    return { x: (tmpP.x + 1) / 2 * el.clientWidth, y: (1 - tmpP.y) / 2 * el.clientHeight, behind: tmpP.z > 1 };
  }

  resize() {
    const el = this.renderer.domElement;
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
