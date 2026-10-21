// Scene Three.js: kepala wireframe neon + mata + lip-sync.
// Default memakai kepala prosedural (tanpa aset, bebas lisensi). Jika ada /head.glb
// dengan morph target `jawOpen`/`mouthOpen`, model itu dipakai sebagai gantinya.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLUE = new THREE.Color(0x2aa8ff);
const AMBER = new THREE.Color(0xffc24a);
const GREEN = new THREE.Color(0x39ff88);
const EYE_DIM = new THREE.Color(0x0d5a30);

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const gauss = (d2, s) => Math.exp(-d2 / s);
const lerp = (a, b, t) => a + (b - a) * t;

// Garis mulut (y) dan engsel rahang.
const MOUTH_Y = -0.42;
const JAW_PIVOT = new THREE.Vector3(0, -0.12, -0.12);
const JAW_MAX = 0.32; // radian

/** Ubah titik di bola satuan menjadi titik di permukaan kepala. */
function sculpt(p) {
  let { x, y, z } = p;
  // Proporsi dasar kepala
  x *= 0.74;
  z *= 0.86;
  y *= 1.02;
  // Rahang/dagu mengecil ke bawah
  const lower = smooth(0.0, -1.0, y);
  x *= 1 - 0.3 * lower * lower;
  if (z > 0) z *= 1 - 0.1 * lower;
  // Sedikit lebih lebar di pelipis/rahang agar tidak berbentuk telur
  x *= 1 + 0.06 * gauss((y + 0.35) ** 2, 0.08);
  // Tempurung belakang sedikit menonjol
  if (z < 0) z *= 1 + 0.1 * smooth(-0.2, 0.6, y);
  if (z > 0) {
    const ax = Math.abs(x);
    // Hidung
    z += 0.22 * gauss(x * x, 0.005) * gauss((y + 0.1) ** 2, 0.03) * smooth(0.1, 0.18, y + 0.32);
    // Rongga mata
    z -= 0.08 * gauss((ax - 0.25) ** 2, 0.01) * gauss((y - 0.13) ** 2, 0.006);
    // Alis
    z += 0.05 * gauss((y - 0.26) ** 2, 0.003) * smooth(0.48, 0.2, ax);
    // Tulang pipi
    x += Math.sign(x) * 0.03 * gauss((y + 0.05) ** 2, 0.02) * smooth(0.2, 0.6, z);
    // Bibir sedikit maju
    z += 0.035 * gauss(x * x, 0.025) * gauss((y - MOUTH_Y) ** 2, 0.006);
    // Dagu
    z += 0.04 * gauss(x * x, 0.02) * gauss((y + 0.78) ** 2, 0.01);
  }
  return new THREE.Vector3(x, y, z);
}

/** Bobot pengaruh rahang untuk suatu titik kepala (0 = tidak ikut, 1 = ikut penuh). */
const jawWeight = (v) => smooth(MOUTH_Y + 0.02, MOUTH_Y - 0.1, v.y) * smooth(-0.35, 0.1, v.z);

function rotateAroundPivot(v, angle, out) {
  const dy = v.y - JAW_PIVOT.y;
  const dz = v.z - JAW_PIVOT.z;
  const c = Math.cos(angle), s = Math.sin(angle);
  out.set(v.x, JAW_PIVOT.y + dy * c - dz * s, JAW_PIVOT.z + dy * s + dz * c);
  return out;
}

class ProceduralHead {
  constructor() {
    this.group = new THREE.Group();
    const geo = new THREE.SphereGeometry(1, 44, 38);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      pos.setXYZ(i, ...sculpt(v).toArray());
    }
    geo.computeVertexNormals();
    this.base = Float32Array.from(pos.array);
    this.jaw = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const w = jawWeight(v);
      if (w > 0.001) this.jaw.push([i, w]);
    }
    this.geo = geo;

    // Pengoklusi gelap agar garis belakang kepala tidak tembus.
    this.occluder = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x020812, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    );
    this.wireMat = new THREE.MeshBasicMaterial({ color: BLUE.clone(), wireframe: true, transparent: true, opacity: 0.55 });
    this.wire = new THREE.Mesh(geo, this.wireMat);
    this.dotsMat = new THREE.PointsMaterial({ color: BLUE.clone(), size: 0.012, transparent: true, opacity: 0.9 });
    this.dots = new THREE.Points(geo, this.dotsMat);
    this.group.add(this.occluder, this.wire, this.dots);

    this.#buildEyes();
    this.#buildLips();
    this.#buildNeck();
  }

  #buildEyes() {
    this.eyeMat = new THREE.MeshBasicMaterial({ color: EYE_DIM.clone() });
    const eyeGeo = new THREE.SphereGeometry(0.055, 20, 12);
    this.eyes = [-1, 1].map((side) => {
      const p = sculpt(new THREE.Vector3(side * 0.34, 0.13, 0.93).normalize());
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.position.set(p.x, p.y, p.z - 0.01);
      eye.scale.set(1.25, 0.7, 0.5);
      this.group.add(eye);
      return eye;
    });
  }

  #lipPoints(open, lower) {
    const pts = [];
    const N = 24;
    const half = 0.42; // sudut setengah lebar mulut (radian di bola satuan)
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = (t - 0.5) * 2 * half;
      const mid = Math.cos((t - 0.5) * Math.PI); // 1 di tengah, 0 di sudut
      const yUnit = MOUTH_Y + (lower ? -0.012 : 0.012);
      const r = Math.sqrt(1 - yUnit * yUnit);
      const p = sculpt(new THREE.Vector3(Math.sin(a) * r, yUnit, Math.cos(a) * r));
      p.z += 0.012;
      if (lower) {
        p.y -= open * 0.06 * mid;
        rotateAroundPivot(p, open * JAW_MAX, p);
      } else {
        p.y += open * 0.018 * mid;
      }
      pts.push(p);
    }
    return pts;
  }

  #buildLips() {
    this.lipMat = new THREE.LineBasicMaterial({ color: BLUE.clone() });
    this.upperLip = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.#lipPoints(0, false)), this.lipMat);
    this.lowerLip = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.#lipPoints(0, true)), this.lipMat);
    // Rongga mulut gelap yang tampak saat mulut terbuka
    this.mouthCavity = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 }),
    );
    this.group.add(this.upperLip, this.lowerLip, this.mouthCavity);
  }

  #buildNeck() {
    const geo = new THREE.CylinderGeometry(0.3, 0.38, 0.5, 20, 4, true);
    const mat = new THREE.MeshBasicMaterial({ color: BLUE.clone(), wireframe: true, transparent: true, opacity: 0.2 });
    const neck = new THREE.Mesh(geo, mat);
    neck.position.set(0, -1.0, -0.15);
    this.group.add(neck);
    this.neckMat = mat;
  }

  setMouth(open) {
    if (Math.abs(open - (this.lastOpen ?? -1)) < 0.003) return;
    this.lastOpen = open;
    const pos = this.geo.attributes.position;
    const v = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (const [i, w] of this.jaw) {
      v.set(this.base[i * 3], this.base[i * 3 + 1], this.base[i * 3 + 2]);
      rotateAroundPivot(v, open * JAW_MAX * w, out);
      pos.setXYZ(i, out.x, out.y, out.z);
    }
    pos.needsUpdate = true;
    this.upperLip.geometry.setFromPoints(this.#lipPoints(open, false));
    this.lowerLip.geometry.setFromPoints(this.#lipPoints(open, true));
    const top = sculpt(new THREE.Vector3(0, MOUTH_Y, Math.sqrt(1 - MOUTH_Y ** 2)));
    this.mouthCavity.position.set(0, top.y - open * 0.05, top.z - 0.005);
    this.mouthCavity.scale.set(0.13, Math.max(0.001, open * 0.07), 1);
    this.mouthCavity.visible = open > 0.03;
  }

  setColors(wire, eye, glow) {
    this.wireMat.color.copy(wire);
    this.dotsMat.color.copy(wire);
    this.lipMat.color.copy(wire);
    this.neckMat.color.copy(wire);
    this.eyeMat.color.copy(eye).multiplyScalar(glow);
  }

  setWireOpacity(o) {
    this.wireMat.opacity = o;
  }

  setBlink(amount) {
    for (const e of this.eyes) e.scale.y = 0.7 * (1 - amount * 0.92);
  }
}

/** Pembungkus untuk model .glb yang punya morph target mulut. */
class GltfHead {
  constructor(root) {
    this.group = new THREE.Group();
    this.wireMat = new THREE.MeshBasicMaterial({ color: BLUE.clone(), wireframe: true, transparent: true, opacity: 0.6 });
    this.morphs = [];
    this.eyeMeshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (/eye/i.test(o.name)) {
        o.material = new THREE.MeshBasicMaterial({ color: EYE_DIM.clone() });
        this.eyeMeshes.push(o);
        return;
      }
      o.material = this.wireMat;
      const dict = o.morphTargetDictionary;
      if (dict) {
        const idx = dict.jawOpen ?? dict.mouthOpen ?? dict.JawOpen ?? dict.MouthOpen;
        if (idx !== undefined) this.morphs.push([o, idx]);
        const blinkL = dict.eyeBlinkLeft ?? dict.eyeBlink_L;
        const blinkR = dict.eyeBlinkRight ?? dict.eyeBlink_R;
        if (blinkL !== undefined) this.blinks = [[o, blinkL], [o, blinkR]];
      }
    });
    // Normalisasi ukuran agar setara kepala prosedural (tinggi ~2 unit).
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 2.1 / Math.max(size.y, 1e-6);
    root.scale.setScalar(s);
    root.position.copy(center.multiplyScalar(-s));
    this.group.add(root);
  }
  get usable() {
    return this.morphs.length > 0;
  }
  setMouth(open) {
    for (const [m, i] of this.morphs) m.morphTargetInfluences[i] = open;
  }
  setColors(wire, eye, glow) {
    this.wireMat.color.copy(wire);
    for (const e of this.eyeMeshes) e.material.color.copy(eye).multiplyScalar(glow);
  }
  setWireOpacity(o) {
    this.wireMat.opacity = o;
  }
  setBlink(amount) {
    for (const [m, i] of this.blinks ?? []) if (i !== undefined) m.morphTargetInfluences[i] = amount;
  }
}

export class Face3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'IDLE';
    this.mouthTarget = 0;
    this.mouth = 0;
    this.mouse = new THREE.Vector2();
    this.blinkT = 0;
    this.nextBlink = 2 + Math.random() * 3;
    this.wireColor = BLUE.clone();
    this.eyeColor = EYE_DIM.clone();
    this.eyeGlow = 1;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 0.05, 6.2);

    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.head = new ProceduralHead();
    this.rig.add(this.head.group);

    this.#buildRings();
    this.#buildParticles();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.35, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.#resize());
    addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    });
    this.#resize();
    this.#tryLoadGltf();

    this.timer = new THREE.Timer();
    renderer.setAnimationLoop((now) => this.#tick(now));
  }

  #buildRings() {
    this.rings = [];
    const mk = (r, opacity, dash) => {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dash
        ? new THREE.LineDashedMaterial({ color: BLUE, transparent: true, opacity, dashSize: 0.08, gapSize: 0.06 })
        : new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity });
      const line = new THREE.Line(geo, mat);
      if (dash) line.computeLineDistances();
      return line;
    };
    const r1 = mk(1.55, 0.35, true);
    r1.rotation.x = 0.25;
    r1.position.y = -0.55;
    const r2 = mk(1.75, 0.18, false);
    r2.rotation.x = -0.15;
    r2.position.y = -0.62;
    const r3 = mk(1.35, 0.25, true);
    r3.rotation.set(1.35, 0, 0.3);
    this.rings.push(r1, r2, r3);
    this.scene.add(r1, r2, r3);
  }

  #buildParticles() {
    const n = 500;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 3 + Math.random() * 6;
      const a = Math.random() * Math.PI * 2;
      arr.set([Math.cos(a) * r, (Math.random() - 0.5) * 7, Math.sin(a) * r - 3], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.particles = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: BLUE, size: 0.018, transparent: true, opacity: 0.45 }),
    );
    this.scene.add(this.particles);
  }

  #tryLoadGltf() {
    new GLTFLoader().load(
      '/head.glb',
      (gltf) => {
        const head = new GltfHead(gltf.scene);
        if (!head.usable) return console.info('[face3d] head.glb tanpa morph jawOpen/mouthOpen, tetap pakai kepala prosedural');
        this.rig.remove(this.head.group);
        this.head = head;
        this.rig.add(head.group);
        console.info('[face3d] memakai head.glb');
      },
      undefined,
      () => {}, // tidak ada head.glb → kepala prosedural
    );
  }

  #resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    // Jaga kepala tetap muat di layar sempit (portrait).
    this.camera.position.z = w / h < 0.9 ? 6.2 / Math.max(w / h, 0.5) * 0.85 : 6.2;
    this.camera.updateProjectionMatrix();
  }

  setState(state) {
    this.state = state;
  }

  /** Nilai buka mulut 0..1 (dari analyser audio atau simulasi). */
  setMouthTarget(v) {
    this.mouthTarget = Math.min(1, Math.max(0, v));
  }

  #tick(now) {
    this.timer.update(now);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();
    const s = this.state;

    // Rotasi mengikuti mouse + idle sway
    const sway = s === 'SPEAKING' ? 0.08 : 0.12;
    const ty = this.mouse.x * 0.45 + Math.sin(t * 0.35) * sway;
    const tx = this.mouse.y * 0.22 + Math.sin(t * 0.7) * sway * 0.5;
    this.rig.rotation.y = lerp(this.rig.rotation.y, ty, 1 - Math.exp(-dt * 3));
    this.rig.rotation.x = lerp(this.rig.rotation.x, tx, 1 - Math.exp(-dt * 3));

    // Napas pelan
    const breath = 1 + Math.sin(t * 1.6) * (s === 'IDLE' ? 0.008 : 0.004);
    this.rig.scale.setScalar(breath);
    this.rig.position.y = Math.sin(t * 1.6) * 0.015 + 0.1;

    // Warna & cahaya per state
    let wire = BLUE, eye = EYE_DIM, glow = 1.6, opacity = 0.38;
    if (s === 'LISTENING') { eye = GREEN; glow = 1; opacity = 0.42; }
    if (s === 'THINKING') {
      wire = BLUE.clone().lerp(AMBER, 0.35 + 0.35 * Math.sin(t * 6));
      eye = GREEN;
      glow = 0.6;
      opacity = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 6));
    }
    if (s === 'SPEAKING') { eye = GREEN; glow = 1.2 + this.mouth * 0.8; opacity = 0.45; }
    const k = 1 - Math.exp(-dt * 6);
    this.wireColor.lerp(wire, k);
    this.eyeColor.lerp(eye, k);
    this.eyeGlow = lerp(this.eyeGlow, glow, k);
    this.head.setColors(this.wireColor, this.eyeColor, this.eyeGlow);
    this.head.setWireOpacity(opacity);
    this.bloom.strength = 0.5 + (s === 'SPEAKING' ? this.mouth * 0.35 : 0) + (s === 'THINKING' ? 0.2 : 0);

    // Kedip: acak, lebih sering saat THINKING
    this.blinkT += dt;
    let blink = 0;
    if (this.blinkT > this.nextBlink) {
      const p = (this.blinkT - this.nextBlink) / 0.16;
      blink = p < 1 ? Math.sin(p * Math.PI) : 0;
      if (p >= 1) {
        this.blinkT = 0;
        this.nextBlink = s === 'THINKING' ? 0.25 + Math.random() * 0.5 : 2 + Math.random() * 4;
      }
    }
    this.head.setBlink(blink);

    // Lip-sync: mulut hanya bergerak saat SPEAKING
    const target = s === 'SPEAKING' ? this.mouthTarget : 0;
    const rate = target > this.mouth ? 28 : 14; // buka cepat, tutup sedikit lebih lambat
    this.mouth = lerp(this.mouth, target, 1 - Math.exp(-dt * rate));
    if (this.mouth < 0.002) this.mouth = 0;
    this.head.setMouth(this.mouth);

    // Cincin HUD & partikel
    const spin = s === 'THINKING' ? 1.6 : s === 'SPEAKING' ? 0.6 : 0.25;
    this.rings[0].rotation.y += dt * spin;
    this.rings[1].rotation.y -= dt * spin * 0.6;
    this.rings[2].rotation.z += dt * spin * 0.4;
    this.particles.rotation.y += dt * 0.02;

    this.composer.render();
  }
}
