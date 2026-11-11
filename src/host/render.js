// The TV picture (three.js). The physics is flat (x, y); everything is drawn as chunky 3D toys
// seen from the front, a little from above and to the side, with cartoon shading and outlines.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHAPES, MATERIALS, PIECES, outlineOf, extentsOf } from '../shared/pieces.js';
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
    if (matId === 'glow') Object.assign(opts, { emissive: new THREE.Color('#6dff2e'), emissiveIntensity: 0.75 });
    if (matId === 'meteor') Object.assign(opts, { emissive: new THREE.Color('#ff5a00'), emissiveIntensity: 1.1 });
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
    } else if (s.look === 'ball' || s.look === 'meteor') {
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
    grad.addColorStop(0, '#3fa4ff'); grad.addColorStop(0.5, '#93d2ff'); grad.addColorStop(0.85, '#d6efff'); grad.addColorStop(1, '#fff0d4');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    const sky = new THREE.CanvasTexture(c);
    sky.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = sky;
    this.daySky = sky;

    const back = new THREE.Group();
    const flat = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });

    // the far backdrop, painted: snowy mountains and a pastel city skyline
    const bd = new THREE.Mesh(new THREE.PlaneGeometry(900, 120), new THREE.MeshBasicMaterial({ map: TX.backdropTexture(), transparent: true, depthWrite: false }));
    bd.position.set(0, 35, -240);
    back.add(bd);

    // the sun, with a soft glow
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: TX.glowTexture(), transparent: true, depthWrite: false }));
    glow.position.set(70, 62, -235);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(8, 40), flat('#fff3a6'));
    sun.position.set(70, 62, -234);
    back.add(glow, sun);

    // rolling hills in two layers (bluer far away), the nearer one dotted with trees
    const hill = (z, base, amp, color, seed) => {
      const pts = [new THREE.Vector2(-320, -30)];
      for (let x = -320; x <= 320; x += 8) pts.push(new THREE.Vector2(x, base + amp * (Math.sin(x / 37 + seed) * 0.6 + Math.sin(x / 13 + seed * 2) * 0.25 + Math.sin(x / 71 + seed * 3) * 0.5)));
      pts.push(new THREE.Vector2(320, -30));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), flat(color));
      m.position.z = z;
      back.add(m);
      return (x) => base + amp * (Math.sin(x / 37 + seed) * 0.6 + Math.sin(x / 13 + seed * 2) * 0.25 + Math.sin(x / 71 + seed * 3) * 0.5);
    };
    hill(-150, 3, 5, '#b4dfd0', 1.3);
    const midY = hill(-95, 0, 4, '#9ed6ad', 2.1);
    const nearY = hill(-55, -3, 2.5, '#88cd95', 0.4);
    // trees: round toon crowns on little trunks (instanced: one draw call each)
    const N = 90;
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.toon('#ffffff'), N);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 1, 6), this.toon('#8a5a36'), N);
    const greens = ['#5cb877', '#6cc485', '#52ad70', '#78cc8c', '#5fb88a'];
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const near = i % 3 !== 0;
      const z = near ? -55 + 1 : -95 + 1;
      const x = -240 + ((i * 97) % 480) + Math.sin(i * 7.3) * 6;
      const y = (near ? nearY(x) : midY(x)) - 0.8;
      const s = (near ? 1.5 : 2.2) * (0.8 + ((i * 37) % 10) / 20);
      tmpM.compose(tmpP.set(x, y + s * 1.6, z), tmpQ.identity(), tmpS.set(s, s * 1.15, s));
      crowns.setMatrixAt(i, tmpM);
      crowns.setColorAt(i, col.set(greens[i % greens.length]));
      tmpM.compose(tmpP.set(x, y + s * 0.5, z - 0.3), tmpQ.identity(), tmpS.set(s * 0.5, s, s * 0.5));
      trunks.setMatrixAt(i, tmpM);
    }
    back.add(crowns, trunks);

    // distant cranes, for the building-site feel, with blinking tip lights
    const craneMat = this.toon('#f2c14e');
    this.blinkers = [];
    for (const [x, s] of [[-85, 1], [75, 0.8]]) {
      const crane = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 46, 1.4), craneMat); mast.position.y = 23; crane.add(mast);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 1.2), craneMat); jib.position.set(10, 45, 0); crane.add(jib);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), this.toon('#e98b3a')); cab.position.set(0, 42, 0); crane.add(cab);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.2, 14, 0.2), this.toon('#555555')); hook.position.set(24, 38, 0); crane.add(hook);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), flat('#ff3b3b')); lamp.position.set(30, 46.5, 0); crane.add(lamp);
      this.blinkers.push(lamp);
      crane.position.set(x, -2, -130); crane.scale.setScalar(s);
      back.add(crane);
    }

    // a fence and bushes along the back of the field
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 1.4, 0.25), this.toon('#fff4e0'), 60);
    for (let i = 0; i < 60; i++) { tmpM.compose(tmpP.set(-59 + i * 2, 0.7, -6.2), tmpQ.identity(), tmpS.set(1, 1, 1)); posts.setMatrixAt(i, tmpM); }
    back.add(posts);
    for (const y of [0.55, 1.1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(120, 0.14, 0.1), this.toon('#fff4e0'));
      rail.position.set(0, y, -6.1);
      back.add(rail);
    }
    const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.toon('#ffffff'), 40);
    for (let i = 0; i < 40; i++) {
      const s = 0.8 + ((i * 13) % 7) / 8;
      tmpM.compose(tmpP.set(-60 + i * 3.1 + Math.sin(i) * 0.8, s * 0.5, -7.2), tmpQ.identity(), tmpS.set(s * 1.3, s, s));
      bushes.setMatrixAt(i, tmpM);
      bushes.setColorAt(i, col.set(greens[(i + 2) % greens.length]));
    }
    back.add(bushes);
    // a meadow between the field and the hills
    const meadow = new THREE.Mesh(new THREE.PlaneGeometry(700, 60), flat('#7fd06b'));
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(0, -0.05, -36);
    back.add(meadow);
    this.meadow = meadow;

    // clouds
    this.clouds = [];
    const cloudMat = this.toon('#ffffff');
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Group();
      const n = 4 + (i % 3);
      for (let k = 0; k < n; k++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cloudMat);
        const r = 1.4 + ((k * 31 + i * 7) % 10) / 7;
        puff.position.set(k * 2.1 - n, (k === 1 || k === 2 ? 0.9 : 0) + Math.sin(k * 1.7) * 0.3, (k % 2) * 0.6);
        puff.scale.setScalar(r);
        cloud.add(puff);
      }
      cloud.position.set(-120 + i * 21, 26 + (i * 17) % 22, -70 - (i % 3) * 18);
      cloud.scale.set(1.7, 0.85, 1);
      this.clouds.push(cloud);
      back.add(cloud);
    }

    // a hot-air balloon drifting by
    const hab = this.airBalloon = new THREE.Group();
    const env = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14), new THREE.MeshToonMaterial({ map: TX.balloonStripes(), gradientMap: this.ramp }));
    env.scale.y = 1.15;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), this.toon('#a0612e'));
    basket.position.y = -4.6;
    for (const sx of [-0.6, 0.6]) {
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), this.toon('#5a3a20'));
      rope.position.set(sx, -3.6, 0);
      hab.add(rope);
    }
    hab.add(env, basket);
    hab.position.set(-60, 34, -80);
    back.add(hab);

    // a few birds
    this.birds = [];
    const birdMat = flat('#2a2140');
    for (let i = 0; i < 5; i++) {
      const bird = new THREE.Group();
      for (const sx of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.1), birdMat);
        wing.geometry.translate(sx * 0.45, 0, 0);
        bird.add(wing);
      }
      bird.position.set(-40 + i * 3.2, 30 + (i % 2) * 1.6 - i * 0.4, -45);
      bird.userData.phase = i * 1.3;
      this.birds.push(bird);
      back.add(bird);
    }
    this.scene.add(back);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight('#e4f4ff', '#ffe0b5', 1.25);
    this.scene.add(this.hemi);
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
    const gh = sim.layout.groundHalf;
    // ground: a grassy slab with a dirt front (snowy on the ice; in two halves either side of a chasm)
    const grassTop = sim.mods.ice ? this.toon('#eef8ff') : this.toon('#ffffff', { map: TX.grassTexture() });
    const groundMats = [this.toon('#9a6942'), this.toon('#9a6942'), grassTop, this.toon('#9a6942'), this.toon('#ffffff', { map: TX.dirtTexture() }), this.toon('#9a6942')];
    const g2 = sim.mods.bridge ? sim.split / 2 : 0;
    for (const [x0, x1] of g2 ? [[-gh, -g2], [g2, gh]] : [[-gh, gh]]) {
      const ground = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 3, 9), groundMats);
      ground.position.set((x0 + x1) / 2, -1.5, -1.5);
      ground.receiveShadow = true;
      w.add(ground);
    }
    if (g2) {
      // the chasm: dark all the way down
      const pit = new THREE.Mesh(new THREE.BoxGeometry(g2 * 2, 30, 9), new THREE.MeshBasicMaterial({ color: '#120d18' }));
      pit.position.set(0, -15 - 0.02, -1.6);
      w.add(pit);
      // and what counts: a golden column over the gap
      const hgt = sim.finishY - sim.padTop + 1.5;
      const col = new THREE.Mesh(new THREE.PlaneGeometry(g2 * 2, hgt), new THREE.MeshBasicMaterial({ color: '#ffd23d', transparent: true, opacity: 0.18, depthWrite: false }));
      col.position.set(0, sim.padTop + hgt / 2, -1.3);
      w.add(col);
      for (const sx of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.06, hgt), new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.7 }));
        edge.position.set(sx * g2, sim.padTop + hgt / 2, -1.25);
        w.add(edge);
      }
    }
    // Lights Out: night falls, and every claw carries a lamp
    this.setNight(!!sim.mods.dark);
    this.lamps = [];
    if (sim.mods.dark) {
      for (let i = 0; i < 8; i++) {
        const lamp = new THREE.PointLight('#ffe9b8', 0, 11, 1.2);
        w.add(lamp);
        this.lamps.push(lamp);
      }
      this.towerLamp = new THREE.PointLight('#b6ff8a', 0, 9, 1.2);
      w.add(this.towerLamp);
    }
    this.flash = 0;
    // Meteor Shower: a target where the next one will land, and a beam above it
    this.meteorMark = null;
    if (sim.mods.meteors) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1), new THREE.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0.18, depthWrite: false }));
      w.add(ring, beam);
      this.meteorMark = { ring, beam };
    }
    // the build pad (and what it stands on), which may move: synced from the physics every frame
    this.buildPad(sim, w);
    // the lava (Levels): a glowing pool that rises up the sides
    this.lava = null;
    if (sim.mods.lava) {
      this.lava = new THREE.Mesh(new THREE.BoxGeometry(gh * 2 + 30, 30, 14), new THREE.MeshToonMaterial({ color: '#ff5a14', emissive: new THREE.Color('#ff3c00'), emissiveIntensity: 0.7, gradientMap: this.ramp }));
      this.lava.position.set(0, -20, -1);
      w.add(this.lava);
    }
    // low gravity on the right (Levels): a purple haze over that half
    this.zone = null;
    if (sim.mods.gravity) {
      this.zone = new THREE.Mesh(new THREE.PlaneGeometry(gh, sim.topY + 2), new THREE.MeshBasicMaterial({ color: '#9b6bff', transparent: true, opacity: 0.16, depthWrite: false }));
      this.zone.position.set(gh / 2, (sim.topY + 2) / 2 - 1, -1.45);
      w.add(this.zone);
    }
    // the top bar (a gantry): a striped beam held up by two towers at the ends
    const top = sim.topY;
    const barMat = this.toon('#ffffff', { map: TX.stripesTexture('#ff9f1c', '#3a3a48', 8) });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(sim.layout.barHalf * 2 + 2, 0.36, 0.7), barMat);
    bar.material.map.repeat.set(sim.layout.barHalf * 2 / 4, 1);
    bar.position.set(0, top + 0.18, 0);
    bar.castShadow = true;
    w.add(bar);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(sim.layout.barHalf * 2 + 2, 0.08, 0.9), this.toon('#5b5b6e'));
    rail.position.set(0, top + 0.02, 0);
    w.add(rail);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, top + 0.6, 0.7), this.toon('#ff9f1c'));
      post.position.set(sx * (sim.layout.barHalf + 1.3), (top + 0.6) / 2, -0.3);
      post.castShadow = true;
      w.add(post);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.4), this.toon('#ff9f1c'));
      brace.position.set(sx * (sim.layout.barHalf + 0.4), top - 0.6, -0.3);
      brace.rotation.z = sx * 0.6;
      w.add(brace);
    }
    // the finish line: a dotted band behind the build and a glowing sheet across it (in a group of its
    // own, which follows the line when it moves)
    const fy = sim.finishY;
    const fg = this.finishGroup = new THREE.Group();
    this.finishBuiltY = fy;
    w.add(fg);
    const fw = sim.layout.groundHalf * 2;
    const dots = TX.dotsTexture();
    dots.repeat.set(fw / 0.6, 1);
    this.finishBand = new THREE.Mesh(new THREE.PlaneGeometry(fw, 0.3), new THREE.MeshBasicMaterial({ map: dots, transparent: true, depthWrite: false }));
    this.finishBand.position.set(0, fy, -1.05);
    fg.add(this.finishBand);
    // and the same dots in front of the build, so the line reads across the tower too
    const front = new THREE.Mesh(new THREE.PlaneGeometry(fw, 0.3), new THREE.MeshBasicMaterial({ map: dots, transparent: true, opacity: 0.55, depthWrite: false }));
    front.position.set(0, fy, 1.05);
    fg.add(front);
    this.finishSheet = new THREE.Mesh(new THREE.PlaneGeometry(fw, 2.2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    this.finishSheet.rotation.x = -Math.PI / 2;
    this.finishSheet.position.set(0, fy, 0);
    fg.add(this.finishSheet);
    // a drifting line (Level 8): a shaded band showing the whole range it swings through
    if (sim.lineAmp) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(fw, sim.lineAmp * 2), new THREE.MeshBasicMaterial({ color: '#ffd23d', transparent: true, opacity: 0.3, depthWrite: false }));
      band.position.set(0, sim.padTop + sim.finishBase, -1.2);
      w.add(band);
      const topLine = new THREE.Mesh(new THREE.PlaneGeometry(fw, 0.08), new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.8 }));
      topLine.position.set(0, sim.padTop + sim.finishBase + sim.lineAmp, -1.15);
      w.add(topLine);
    }
    this.finishFlags = [];
    for (const sx of [-1, 1]) {
      const flag = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), this.toon('#eeeeee'));
      pole.position.y = 0.8;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ map: TX.checkerTexture(), side: THREE.DoubleSide }));
      cloth.position.set(sx * 0.45, 1.3, 0);
      flag.add(pole, cloth);
      flag.position.set(sx * (sim.layout.padHalf + 0.9), fy - 0.8, -1.1);
      fg.add(flag);
      this.finishFlags.push(cloth);
    }
    // the tower's current top: a dashed marker
    this.topMarker = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.06), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
    this.topMarker.position.set(0, sim.padTop, -1.02);
    w.add(this.topMarker);
    this.topMarker2 = null;
    if (sim.mods.twin) {
      this.topMarker2 = this.topMarker.clone();
      this.topMarker2.material = this.topMarker.material.clone();
      w.add(this.topMarker2);
    }
    this.scene.add(w);
  }

  // night (Lights Out): a starry sky, dim moonlight and a dark veil over the scenery
  setNight(on) {
    if (on && !this.night) {
      const veil = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1200), new THREE.MeshBasicMaterial({ color: '#0b0f26', transparent: true, opacity: 0.8, depthWrite: false }));
      veil.position.set(0, 0, -45);
      const moon = new THREE.Mesh(new THREE.CircleGeometry(5, 40), new THREE.MeshBasicMaterial({ color: '#f4f1d0' }));
      moon.position.set(-60, 55, -44);
      this.night = new THREE.Group();
      this.night.add(veil, moon);
      this.scene.add(this.night);
    }
    if (this.night) this.night.visible = on;
    this.isNight = on;
    this.scene.background = on ? TX.nightSkyTexture() : this.daySky;
    this.meadow.material.color.set(on ? '#1f3b2c' : '#7fd06b');
    this.hemi.intensity = on ? 0.16 : 1.25;
    this.sunLight.intensity = on ? 0.35 : 2.1;
    this.sunLight.color.set(on ? '#9fb4ff' : '#fff3df');
  }

  buildPad(sim, w) {
    this.padViews = [];
    const signMat = () => this.toon('#ffffff', { map: TX.signTexture('BUILD HERE       ·       BUILD HERE       ·       BUILD HERE', '#ffc21a', '#2a2a2a', 2048, 26) });
    const stripes = this.toon('#ffffff', { map: TX.stripesTexture() });
    const concrete = this.toon('#ffffff', { map: TX.concreteTexture() });
    const rock = this.toon('#ffffff', { map: TX.materialTexture('stone', '#a39486') });
    const jelly = new THREE.MeshToonMaterial({ color: '#ff8fc8', gradientMap: this.ramp, transparent: true, opacity: 0.88, emissive: new THREE.Color('#ff4fa0'), emissiveIntensity: 0.15 });
    this.beltMat = null;
    for (const pb of sim.padBodies) {
      let mesh;
      if (pb.kind === 'hill') {
        // the slope (the body's own polygon), rock in front, grass on top
        const k = pb.slope, half = sim.layout.padHalf, top = sim.padTop;
        const geo = extrude([[-half, 0], [half, 0], [half, top + k * half], [-half, top - k * half]], 0.08, 2.2);
        mesh = new THREE.Mesh(geo, [rock, this.toon('#79c25a')]);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.3), signMat());
        sign.position.set(0, top - 0.25, 1.11);
        sign.rotation.z = Math.atan(k);
        sign.scale.x = Math.hypot(1, k);
        mesh.add(sign);
      } else if (pb.kind === 'belt') {
        // a conveyor: a belt with chevrons running along the top, rollers in front
        const map = TX.beltTexture().clone();
        map.needsUpdate = true;
        map.repeat.set(pb.hw * 2, 1);
        this.beltMat = new THREE.MeshToonMaterial({ color: '#ffffff', map, gradientMap: this.ramp });
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), [stripes, stripes, this.beltMat, this.toon('#4a4a58'), this.toon('#5b5b6e'), this.toon('#4a4a58')]);
        for (let x = -pb.hw + 0.5; x <= pb.hw - 0.4; x += 1.2) {
          const roller = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(0.13, pb.hh * 0.6), Math.min(0.13, pb.hh * 0.6), 0.1, 14), this.toon('#c9ccd6'));
          roller.rotation.x = Math.PI / 2;
          roller.position.set(x, 0, 1.12);
          mesh.add(roller);
        }
      } else if (pb.kind === 'roof') {
        // Twin Towers: the tops of two buildings
        const walls = this.toon('#ffffff', { map: TX.windowsTexture(pb.body.getPosition().x < 0 ? '#f7c6c7' : '#c6dcf7') });
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), [walls, walls, concrete, walls, walls, walls]);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2 + 0.1, 0.12, 2.3), this.toon('#5b5b6e'));
        rim.position.y = pb.hh - 0.06;
        mesh.add(rim);
      } else if (pb.kind === 'cliff') {
        // Bridge the Gap: rocky cliffs with grass on top
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), [rock, rock, this.toon('#ffffff', { map: TX.grassTexture() }), rock, rock, rock]);
      } else if (sim.mods.ice) {
        // the frozen lake: a slab of ice with snow on its edges
        const ice = this.toon('#ffffff', { map: TX.materialTexture('ice', '#cdf3ff') });
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), [this.toon('#eef8ff'), this.toon('#eef8ff'), ice, this.toon('#bfe9fa'), ice, this.toon('#bfe9fa')]);
      } else if (pb.kind === 'soft') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), jelly);
      } else if (pb.kind === 'tilt') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), [stripes, stripes, concrete, this.toon('#bdb6aa'), signMat(), this.toon('#bdb6aa')]);
      } else if (pb.hh * 2 > 0.6) {
        // a tall pad: a rocky mesa with the sign along its top edge
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), [rock, rock, concrete, rock, rock, rock]);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(pb.hw * 2, 0.3), signMat());
        sign.position.set(0, pb.hh - 0.15, 1.11);
        mesh.add(sign);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(pb.hw * 2, pb.hh * 2, 2.2), [stripes, stripes, concrete, this.toon('#bdb6aa'), signMat(), this.toon('#bdb6aa')]);
      }
      mesh.receiveShadow = mesh.castShadow = true;
      w.add(mesh);
      this.padViews.push({ mesh, body: pb.body, cx: pb.kind === 'hill' ? 0 : pb.cx || 0, cy: pb.kind === 'hill' ? 0 : pb.cy || 0 });
    }
    if (sim.tub) {
      const tub = new THREE.Mesh(new THREE.BoxGeometry(sim.tub.hw * 2 + 0.3, sim.tub.h, 2.3), this.toon('#8a5a36'));
      tub.position.set(0, sim.tub.h / 2, 0);
      w.add(tub);
    }
    if (sim.pivot) {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(sim.pivot.hw * 2, sim.pivot.h, 1.8), rock);
      ped.position.set(0, sim.pivot.h / 2, 0);
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2.3, 16), this.toon('#5b5b6e'));
      hinge.rotation.x = Math.PI / 2;
      hinge.position.set(0, sim.padTop - 0.45, 0);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.5, sim.padTop - 0.45 - sim.pivot.h, 1.6), this.toon('#5b5b6e'));
      neck.position.set(0, (sim.padTop - 0.45 + sim.pivot.h) / 2, 0);
      w.add(ped, hinge, neck);
    }
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
    this.parts = this.parts.filter((p) => !p.keep); // (no snow or sparks left over from another level)
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
    // magnetic blocks wear their pole
    if (def.pole) {
      const ex = extentsOf(def.shape, 0);
      const size = Math.min(0.62, (ex.x1 - ex.x0) * 0.85, (ex.y1 - ex.y0) * 0.85);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: TX.letterTexture(def.pole > 0 ? 'N' : 'S'), transparent: true }));
      plate.position.z = (look === 'column' ? (ex.x1 - ex.x0) / 2 : DEPTH / 2) + 0.01; // (on the front of a round post)
      group.add(plate);
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

  // a player's spawn step: a solid block from the ground up, with a trim board on top and a name sign.
  // Where a higher step stands beside it (further out), only the open part is drawn.
  makePlatformView(slot, player) {
    const group = new THREE.Group();
    const color = player?.color || '#999999';
    const L = this.sim.layout.slot(slot);
    if (L.raft) return this.makeRaftView(slot, player, L);
    const hasHigher = this.sim.platforms.has(slot + 2);
    const w = hasHigher ? 1.8 : LAYOUT.shelfW;
    const xc = L.x0 + L.side * w / 2;
    const dark = new THREE.Color(color).multiplyScalar(0.78).getStyle();
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, L.top, 2.0), [
      this.toon(dark), this.toon(dark), this.toon('#f4f1ea'), this.toon(dark), this.toon(color), this.toon(dark),
    ]);
    block.position.set(xc, L.top / 2, 0);
    block.castShadow = block.receiveShadow = true;
    group.add(block);
    // panel lines down the front, so it reads as a built thing
    for (let y = 0.9; y < L.top - 0.4; y += 0.9) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.05, 0.02), this.toon(dark));
      line.position.set(xc, y, 1.01);
      group.add(line);
    }
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.14, 2.12), this.toon('#fffaf0'));
    trim.position.set(xc, L.top - 0.07, 0);
    trim.receiveShadow = true;
    group.add(trim);
    const signH = Math.min(0.55, L.top - 0.3);
    const sign = TX.signTexture(`${player?.kit?.icon || ''} ${player?.name || ''}`.trim(), color, '#ffffff', 512, Math.round(512 * signH / (w - 0.2)));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, signH), new THREE.MeshBasicMaterial({ map: sign }));
    plate.position.set(xc, L.top - 0.2 - signH / 2, 1.03);
    group.add(plate);
    // the turntable where new pieces arrive (it spins when a piece on it is turned)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 32), new THREE.MeshToonMaterial({ color, gradientMap: this.ramp, transparent: true, opacity: 0.6 }));
    disc.position.set(L.x, L.top + 0.03, 0);
    for (const a of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
      bar.rotation.y = a;
      bar.position.y = 0.03;
      disc.add(bar);
    }
    group.add(disc);
    if (this.outlines) {
      const o = new THREE.Mesh(hullOf(block.geometry), this.ink());
      o.position.copy(block.position);
      group.add(o);
    }
    this.scene.add(group);
    return { group, disc, name: player?.name, color, sign, hasHigher };
  }

  // a raft on the lava: a dark basalt slab with a coloured rim, riding up as the lava rises
  makeRaftView(slot, player, L) {
    const group = new THREE.Group();
    const color = player?.color || '#999999';
    const raft = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.shelfW, 0.5, 2.0), [
      this.toon('#4a4048'), this.toon('#4a4048'), this.toon('#ffffff', { map: TX.materialTexture('stone', '#6b5f66') }), this.toon('#2e272c'), this.toon('#4a4048'), this.toon('#4a4048'),
    ]);
    raft.castShadow = raft.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.shelfW + 0.1, 0.12, 2.1), this.toon(color));
    rim.position.y = 0.2;
    const sign = TX.signTexture(`${player?.kit?.icon || ''} ${player?.name || ''}`.trim(), color, '#ffffff', 512, 80);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.shelfW - 0.3, 0.32), new THREE.MeshBasicMaterial({ map: sign }));
    plate.position.set(0, -0.05, 1.01);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 32), new THREE.MeshToonMaterial({ color, gradientMap: this.ramp, transparent: true, opacity: 0.6 }));
    disc.position.set(L.x - (L.x0 + L.x1) / 2, 0.28, 0);
    group.add(raft, rim, plate, disc);
    if (this.outlines) group.add(new THREE.Mesh(hullOf(raft.geometry), this.ink()));
    this.scene.add(group);
    return { group, disc, name: player?.name, color, sign, hasHigher: this.sim.platforms.has(slot + 2), body: this.sim.platforms.get(slot) };
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
      if (!p.keep) { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; p.vz *= 1 - 2 * dt; }
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
      case 'burn': this.puff(e.x, e.y + 0.2, { n: 18, color: '#ff8a1a', size: 0.3, speed: 3, up: 2 }); break;
      case 'shatter': this.puff(e.x, e.y, { n: 22, color: '#c8f6ff', size: 0.16, speed: 5, gravity: 9, life: 0.9 }); this.shake(0.15); break;
      case 'meteor':
        this.puff(e.x, e.y, { n: 26, color: '#ffb020', size: 0.22, speed: 4, life: 0.6, up: 1 });
        this.puff(e.x, e.y, { n: 14, color: e.hit === 'claw' ? '#ffffff' : '#6b5a52', size: 0.3, speed: 1.6, life: 1.1, up: 1.2 });
        this.shake(e.hit === 'claw' ? 0.12 : 0.25);
        break;
      case 'quake': this.shake(0.3); break;
      case 'lightning': this.flash = 1; break;
      case 'glitch': { const c = this.sim.claws.get(e.slot); if (c) { const p = c.body.getPosition(); this.puff(p.x, p.y, { n: 8, color: '#ff9a9a', size: 0.15, speed: 2 }); } break; }
      case 'boost': { const c = this.sim.claws.get(e.slot); if (c) { const p = c.body.getPosition(); this.puff(p.x, p.y, { n: 24, color: '#ffd84a', size: 0.2, speed: 4 }); } break; }
      case 'anchor': this.puff(e.x, this.sim.padTop, { n: 16, color: '#d9c39a', size: 0.25, speed: 3 }); break;
      case 'collapse':
        this.shake(0.7);
        this.puff(e.x, this.sim.padTop + 0.5, { n: 40, color: '#e9dcc4', size: 0.55, speed: 5, life: 1.2 });
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
      if (!sim.platforms.has(slot) || !p || p.name !== v.name || sim.platforms.has(slot + 2) !== v.hasHigher) {
        this.scene.remove(v.group);
        v.group.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
        v.sign?.dispose();
        this.platformViews.delete(slot);
      }
    }
    for (const slot of sim.platforms.keys()) if (!this.platformViews.has(slot)) this.platformViews.set(slot, this.makePlatformView(slot, playerBySlot.get(slot)));
    for (const v of this.platformViews.values()) if (v.body) { const p = v.body.getPosition(); v.group.position.set(p.x, p.y, 0); }
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
      v.lampMat.color.set(away ? '#555555' : claw.flipUntil > sim.time ? (Math.sin(this.time * 14) > 0 ? '#c77dff' : '#ffffff') : claw.boosted ? (Math.sin(this.time * 20) > 0 ? '#ffd84a' : '#ffffff') : claw.state === 'holding' ? '#3dff7a' : claw.state === 'closed' ? '#9aa0b0' : '#ffffff');
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
    this.topMarker.position.set(sim.mods.bridge ? sim.tower.topX : sim.tower.x, sim.padTop + sim.tower.height, -1.02);
    // the level's moving parts
    for (const v of this.padViews) { const p = v.body.getWorldPoint({ x: v.cx, y: v.cy }); v.mesh.position.set(p.x, p.y, 0); v.mesh.rotation.z = v.body.getAngle(); }
    this.finishGroup.position.y = sim.finishY - this.finishBuiltY;
    this.updateLevelEffects(dt, sim);
    this.topMarker.visible = sim.tower.height > 0.2;
    this.topMarker.material.color.set(over ? '#5dff8a' : '#ffffff');
    if (this.topMarker2 && sim.tower.sides) {
      // two towers: a marker on each
      const [a, b] = sim.tower.sides;
      for (const [m, side] of [[this.topMarker, a], [this.topMarker2, b]]) {
        m.position.set(side.x, sim.padTop + side.h, -1.02);
        m.visible = side.h > 0.2;
        m.material.color.set(side.h >= sim.finishHeight ? '#5dff8a' : '#ffffff');
      }
    }

    for (const c of this.clouds) { c.position.x += dt * 0.6; if (c.position.x > 140) c.position.x = -140; }
    this.airBalloon.position.x += dt * 0.9;
    this.airBalloon.position.y = 34 + Math.sin(this.time * 0.3) * 2;
    if (this.airBalloon.position.x > 120) this.airBalloon.position.x = -120;
    for (const b of this.birds) {
      b.position.x += dt * 2.2;
      if (b.position.x > 70) b.position.x = -70;
      const f = Math.sin(this.time * 7 + b.userData.phase) * 0.5;
      b.children[0].rotation.z = -f; b.children[1].rotation.z = f;
    }
    for (const l of this.blinkers) l.visible = Math.sin(this.time * 3) > 0;
    this.updateParticles(dt);
    this.updateCamera(dt, game);
  }

  updateLevelEffects(dt, sim) {
    const L = sim.layout;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const view = this.cam ? { x0: this.cam.cx - this.cam.dist * 0.5, x1: this.cam.cx + this.cam.dist * 0.5 } : { x0: -L.halfW, x1: L.halfW };
    const add = (p) => { if (this.parts.length < 500) this.parts.push({ z: rnd(-1, 1.5), vz: 0, gravity: 0, keep: true, ...p, max: p.life, color: new THREE.Color(p.color) }); };
    // lava: up it comes, bubbling
    if (this.lava) {
      this.lava.position.y = Math.max(-20, sim.lavaY - 15);
      if (sim.lavaY > -0.5 && Math.random() < dt * 14) add({ x: rnd(view.x0, view.x1), y: sim.lavaY, vx: 0, vy: rnd(0.6, 1.4), life: 0.7, size: rnd(0.1, 0.22), color: Math.random() < 0.5 ? '#ffb020' : '#ff6a1a' });
    }
    // wind: streaks blowing across, more in a strong gust
    if (sim.mods.wind && Math.abs(sim.wind) > 0.15 && Math.random() < dt * 40 * Math.abs(sim.wind) / sim.mods.wind.max) {
      const dir = Math.sign(sim.wind);
      add({ x: dir > 0 ? view.x0 : view.x1, y: rnd(sim.padTop + 0.5, sim.topY - 1), vx: dir * rnd(7, 11), vy: rnd(-0.3, 0.3), life: 3.5, size: 0.07, color: '#ffffff' });
    }
    // a conveyor belt: its chevrons run with the belt
    if (this.beltMat) this.beltMat.map.offset.x -= sim.belt * dt;
    // an earthquake: the camera shakes and dust puffs up along the pad
    if (sim.quaking) {
      this.shakeAmt = Math.max(this.shakeAmt, 0.18);
      if (Math.random() < dt * 25) add({ x: rnd(-L.padHalf, L.padHalf), y: 0.05, vx: rnd(-0.6, 0.6), vy: rnd(0.4, 1.2), life: 1.2, size: rnd(0.15, 0.3), color: '#c9b49a', z: rnd(1.1, 1.5) });
    }
    // the ice: snow drifting down
    if (sim.mods.ice && Math.random() < dt * 30) add({ x: rnd(view.x0, view.x1), y: sim.topY + 1, vx: rnd(-0.3, 0.3), vy: -rnd(0.8, 1.5), life: 12, size: rnd(0.05, 0.11), color: '#ffffff' });
    // meteors: a fiery trail, and a target where the next one will land
    for (const p of sim.pieces) {
      if (p.special !== 'meteor' || Math.random() > dt * 60) continue;
      const q = p.body.getPosition();
      add({ x: q.x + rnd(-0.12, 0.12), y: q.y + 0.2, vx: 0, vy: rnd(0.5, 1.5), life: 0.45, size: rnd(0.12, 0.24), color: Math.random() < 0.5 ? '#ffd040' : '#ff5a14', z: rnd(-0.2, 0.2) });
    }
    if (this.meteorMark) {
      const warn = sim.meteor?.warn;
      const { ring, beam } = this.meteorMark;
      ring.visible = beam.visible = !!warn;
      if (warn) {
        const land = this.rayDown(sim, warn.x, sim.topY - 1, null);
        const left = Math.max(0, warn.at - sim.time);
        const pulse = 0.5 + 0.5 * Math.sin(this.time * (8 + (2.2 - left) * 10));
        ring.position.set(warn.x, land + 0.04, 0);
        ring.scale.setScalar(0.8 + 0.4 * pulse);
        const len = Math.max(0.1, sim.topY - land);
        beam.position.set(warn.x, land + len / 2, -0.2);
        beam.scale.set(1, len, 1);
        beam.material.opacity = 0.1 + 0.15 * pulse;
      }
    }
    // the night: lamps on the claws (and on the tower's top), lightning now and then
    if (this.lamps && this.lamps.length) {
      let i = 0;
      for (const c of sim.claws.values()) {
        if (i >= this.lamps.length) break;
        const q = c.body.getPosition();
        this.lamps[i].position.set(q.x, q.y - 0.6, 1.4);
        this.lamps[i].intensity = 14;
        i++;
      }
      for (; i < this.lamps.length; i++) this.lamps[i].intensity = 0;
      this.towerLamp.intensity = sim.tower.count ? 8 : 0;
      this.towerLamp.position.set(sim.tower.x, sim.padTop + sim.tower.height + 0.8, 1.6);
    }
    if (this.isNight) {
      this.flash = Math.max(0, this.flash - dt * 2.2);
      const f = this.flash > 0.55 || (this.flash > 0.2 && this.flash < 0.35) ? 1 : 0; // a double flicker
      this.hemi.intensity = 0.16 + f * 1.6;
      if (this.night) this.night.children[0].material.opacity = 0.8 - f * 0.5;
    }
    // low gravity: slow purple sparkles drifting up on the right
    if (this.zone && Math.random() < dt * 8) add({ x: rnd(0.3, L.halfW), y: rnd(0, sim.topY - 2), vx: 0, vy: rnd(0.3, 0.8), life: 2.5, size: 0.07, color: '#c9a8ff' });
    // a Super Claw sparkles
    for (const c of sim.claws.values()) {
      if (c.boosted && Math.random() < dt * 20) { const p = c.body.getPosition(); add({ x: p.x + rnd(-0.6, 0.6), y: p.y + rnd(-0.5, 0.4), vx: 0, vy: 0.8, life: 0.6, size: 0.09, color: '#ffd84a' }); }
    }
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
    const held = claw?.hold ? claw.hold.piece.body : null;
    sim.world.rayCast({ x, y }, { x, y: -1 }, (fixture, point, normal, fraction) => {
      const b = fixture.getBody(), ud = b.getUserData();
      if ((claw && b === claw.body) || b === held || ud?.kind === 'claw' || (ud?.kind === 'piece' && ud.piece.special === 'meteor')) return -1;
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
    const L = sim.layout;
    this.insetNow = lerp(this.insetNow, this.inset, 1 - Math.exp(-dt * 4));
    const aspect = this.camera.aspect * (1 - this.insetNow);
    const tan = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const share = LAYOUT.aspect / (16 / 9); // the rest of the width is the height meter's
    // at its closest the view runs from the top bar down to the grass, filling the screen…
    const y0 = LAYOUT.frameBottom, y1 = sim.topY + LAYOUT.frameTop;
    let h = y1 - y0;
    const wMin = h * aspect * share;
    // …and it zooms out to keep every claw and the whole tower in sight (the whole field in the lobby)
    let x0 = -6, x1 = 6;
    if (game.phase === 'lobby') { x0 = -L.halfW; x1 = L.halfW; }
    for (const c of sim.claws.values()) {
      const hx = c.body.getPosition().x, r = c.hold ? 2.6 : 1.8;
      x0 = Math.min(x0, c.x - r, hx - r); x1 = Math.max(x1, c.x + r, hx + r);
    }
    for (const p of sim.tower.set) { const x = p.body.getPosition().x; x0 = Math.min(x0, x - 1.5); x1 = Math.max(x1, x + 1.5); }
    if (x1 - x0 < wMin) {
      // room to spare: centre on the action, but don't look past the ends of the field
      const lim = L.halfW + 0.5;
      let mid = (x0 + x1) / 2;
      mid = clamp(mid, -lim + wMin / 2, lim - wMin / 2);
      if (wMin > 2 * lim) mid = 0;
      x0 = mid - wMin / 2; x1 = mid + wMin / 2;
    }
    let w = (x1 - x0) / share;
    let cx = (x0 + x1) / 2 + w * (1 - share) / 2;
    if ((game.phase === 'judge' || game.phase === 'hold') && sim.tower.count) {
      // time's up: lean in on the tower
      const k = clamp(game.phaseT / 1.2, 0, 1) * 0.35;
      cx = lerp(cx, sim.tower.x, k);
      w = lerp(w, Math.max(14, (sim.tower.topY || 6) * 1.9), k);
      h = lerp(h, (sim.tower.topY || 6) + 4, k);
    }
    const dist = Math.max(h / 2 / tan, w / 2 / (tan * aspect));
    // zoomed out, the grass stays along the bottom and the extra room goes to the sky
    const cy = y0 + dist * tan;
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
