// Scene Three.js: kepala wireframe neon super detail + mata + lip-sync.
// Desain mengikuti referensi: kepala manusia wireframe biru neon dengan telinga,
// mata hijau menyala, konektor di belakang kepala, dan topologi grid yang rapi.
// Default memakai kepala prosedural (tanpa aset, bebas lisensi). Jika ada /head.glb
// dengan morph target `jawOpen`/`mouthOpen`, model itu dipakai sebagai gantinya.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLUE = new THREE.Color(0x2aa8ff);
const BLUE_BRIGHT = new THREE.Color(0x44c0ff);
const AMBER = new THREE.Color(0xffc24a);
const GREEN = new THREE.Color(0x00ff66);          // Hijau zamrud neon hidup & kontras
const GREEN_BRIGHT = new THREE.Color(0x1aff75);   // Hijau zamrud sangat terang
const EYE_SOCKET = new THREE.Color(0x000803);     // Soket mata gelap pekat
const CORAL_LIP = new THREE.Color(0xff4570);      // Rose coral alami futuristik untuk bibir
const CORAL_BRIGHT = new THREE.Color(0xff7092);   // Aksen tepi bibir bercahaya
const TEETH_WHITE = new THREE.Color(0xeef7ff);    // Cyber teeth pearl white
const EYE_DIM = new THREE.Color(0x0d5a30);

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const gauss = (d2, s) => Math.exp(-d2 / s);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Garis mulut (y) dan engsel rahang.
const MOUTH_Y = -0.38;
const JAW_PIVOT = new THREE.Vector3(0, -0.10, -0.10);
const JAW_MAX = 0.38; // radian artikulatif manusiawi

/** Ubah titik di bola satuan menjadi titik di permukaan kepala yang super realistis. */
function sculpt(p) {
  let { x, y, z } = p;

  // ==== Proporsi dasar ====
  // Kepala manusia: lebih lebar dari samping, kurang dari depan-belakang
  x *= 0.73;
  z *= 0.84;
  y *= 1.06;

  // ==== Dahi dan tempurung ====
  // Dahi sedikit rata/datar di depan
  if (y > 0.3 && z > 0) {
    z *= 1 - 0.10 * smooth(0.3, 0.8, y) * smooth(0.0, 0.5, z);
  }
  // Tempurung atas sedikit lebih lebar
  if (y > 0.4) {
    x *= 1 + 0.04 * smooth(0.4, 0.8, y);
  }
  // Tempurung belakang sedikit menonjol (oksiput)
  if (z < 0) {
    z *= 1 + 0.15 * smooth(-0.2, 0.7, y) * gauss((y - 0.15) ** 2, 0.18);
  }

  // ==== Rahang dan dagu ====
  const lower = smooth(0.05, -1.0, y);
  // Rahang menyempit secara progresif
  const jawNarrow = 0.38 * lower * lower;
  x *= 1 - jawNarrow;
  // Dagu runcing tapi tidak terlalu tajam
  if (y < -0.50) {
    const chinFactor = smooth(-0.50, -0.92, -y);
    x *= 1 - 0.28 * chinFactor;
    if (z > 0) z *= 1 + 0.07 * chinFactor; // dagu sedikit maju
  }
  // Rahang menyempit sedikit dari belakang
  if (z > 0) z *= 1 - 0.08 * lower;

  // ==== Tulang rahang (jawline) yang tegas ====
  const jawAngle = gauss((y + 0.32) ** 2, 0.018) * smooth(0.12, 0.52, Math.abs(x));
  x += Math.sign(x) * 0.055 * jawAngle;
  // Garis rahang dari telinga ke dagu
  const jawEdge = gauss((y + 0.42) ** 2, 0.025) * smooth(0.08, 0.45, Math.abs(x));
  x += Math.sign(x) * 0.03 * jawEdge;

  // ==== Pelipis / temporal ====
  // Pelipis cekung di antara dahi dan tulang pipi
  const templeX = gauss((y - 0.12) ** 2, 0.04) * smooth(0.30, 0.62, Math.abs(x));
  x -= Math.sign(x) * 0.035 * templeX;

  // ==== Detail wajah (hanya sisi depan) ====
  if (z > 0) {
    const ax = Math.abs(x);

    // ---- Rongga mata (lebih dalam) ----
    const eyeSocketL = gauss((ax - 0.24) ** 2, 0.009) * gauss((y - 0.10) ** 2, 0.006);
    z -= 0.12 * eyeSocketL;
    // Alis menonjol (supraorbital ridge) — lebih tegas
    const browRidge = gauss((y - 0.23) ** 2, 0.003) * smooth(0.46, 0.10, ax);
    z += 0.08 * browRidge;
    // Area antara alis (glabella)
    const glabella = gauss(x * x, 0.01) * gauss((y - 0.22) ** 2, 0.004);
    z += 0.035 * glabella;

    // ---- Hidung (lebih menonjol) ----
    // Batang hidung (bridge)
    const noseBridge = gauss(x * x, 0.004) * smooth(0.05, 0.28, y + 0.12) * smooth(-0.12, 0.18, y);
    z += 0.18 * noseBridge;
    // Ujung hidung lebih menonjol
    const noseTip = gauss(x * x, 0.003) * gauss((y + 0.10) ** 2, 0.004);
    z += 0.26 * noseTip;
    // Sayap hidung (nostril)
    const nostril = gauss((ax - 0.09) ** 2, 0.004) * gauss((y + 0.15) ** 2, 0.005);
    z += 0.10 * nostril;
    // Cekungan di samping hidung (nasiolabial)
    const nasolabial = gauss((ax - 0.15) ** 2, 0.007) * gauss((y + 0.10) ** 2, 0.015);
    z -= 0.04 * nasolabial;

    // ---- Tulang pipi (zygomatic) — lebih tegas ----
    const cheekBone = gauss((y + 0.0) ** 2, 0.018) * gauss((ax - 0.38) ** 2, 0.012);
    x += Math.sign(x) * 0.055 * cheekBone;
    z += 0.04 * cheekBone;
    // Pipi cekung di bawah tulang pipi
    const cheekHollow = gauss((y + 0.22) ** 2, 0.015) * gauss((ax - 0.26) ** 2, 0.018);
    z -= 0.04 * cheekHollow;
    x -= Math.sign(x) * 0.02 * cheekHollow;

    // ---- Mulut dan bibir ----
    // Bibir sedikit maju
    const lipProtrude = gauss(x * x, 0.02) * gauss((y - MOUTH_Y) ** 2, 0.005);
    z += 0.05 * lipProtrude;
    // Philtrum (cekungan di atas bibir atas)
    const philtrum = gauss(x * x, 0.002) * gauss((y - MOUTH_Y + 0.06) ** 2, 0.002);
    z -= 0.025 * philtrum;

    // ---- Dagu (lebih tegas) ----
    const chinBump = gauss(x * x, 0.012) * gauss((y + 0.72) ** 2, 0.010);
    z += 0.07 * chinBump;
    // Cekungan mentolabial (antara bibir bawah dan dagu)
    const mentolabial = gauss(x * x, 0.012) * gauss((y + 0.56) ** 2, 0.005);
    z -= 0.03 * mentolabial;
  }

  return new THREE.Vector3(x, y, z);
}

/** Bobot pengaruh rahang untuk suatu titik kepala (0 = tidak ikut, 1 = ikut penuh). */
const jawWeight = (v) => smooth(MOUTH_Y + 0.02, MOUTH_Y - 0.12, v.y) * smooth(-0.30, 0.15, v.z);

function rotateAroundPivot(v, angle, out, pivot = JAW_PIVOT) {
  const dy = v.y - pivot.y;
  const dz = v.z - pivot.z;
  const c = Math.cos(angle), s = Math.sin(angle);
  out.set(v.x, pivot.y + dy * c - dz * s, pivot.z + dy * s + dz * c);
  return out;
}

/** Buat geometri telinga prosedural. */
function createEar(side) {
  const group = new THREE.Group();
  const shape = new THREE.Shape();

  // Bentuk telinga: lebih besar dan detail
  const earW = 0.15;
  const earH = 0.26;

  // Helix luar telinga (lebih besar, lebih detail)
  shape.moveTo(0, -earH * 0.48);
  shape.bezierCurveTo(earW * 0.35, -earH * 0.55, earW * 0.95, -earH * 0.38, earW * 1.0, -earH * 0.05);
  shape.bezierCurveTo(earW * 1.05, earH * 0.22, earW * 0.90, earH * 0.52, earW * 0.42, earH * 0.54);
  shape.bezierCurveTo(earW * 0.12, earH * 0.50, -earW * 0.06, earH * 0.32, -earW * 0.06, earH * 0.0);
  shape.bezierCurveTo(-earW * 0.06, -earH * 0.22, earW * 0.0, -earH * 0.42, 0, -earH * 0.48);

  // Extrude tipis
  const extrudeSettings = { depth: 0.025, bevelEnabled: false, curveSegments: 18 };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  const earMat = new THREE.MeshBasicMaterial({
    color: BLUE.clone(),
    wireframe: true,
    transparent: true,
    opacity: 0.5,
  });
  const earMesh = new THREE.Mesh(geo, earMat);

  // Antihelix (lipatan dalam telinga)
  const antihelixShape = new THREE.Shape();
  const ahW = earW * 0.55;
  const ahH = earH * 0.65;
  antihelixShape.moveTo(0, -ahH * 0.45);
  antihelixShape.bezierCurveTo(ahW * 0.5, -ahH * 0.5, ahW * 0.85, -ahH * 0.2, ahW * 0.8, ahH * 0.1);
  antihelixShape.bezierCurveTo(ahW * 0.7, ahH * 0.4, ahW * 0.3, ahH * 0.45, 0, ahH * 0.3);
  antihelixShape.bezierCurveTo(-ahW * 0.1, ahH * 0.1, -ahW * 0.05, -ahH * 0.3, 0, -ahH * 0.45);
  const antihelixGeo = new THREE.ExtrudeGeometry(antihelixShape, { depth: 0.015, bevelEnabled: false, curveSegments: 12 });
  const antihelix = new THREE.Mesh(antihelixGeo, earMat);
  antihelix.position.set(earW * 0.15, 0.01, 0.01);

  // Tragus (tonjolan kecil di depan lubang telinga)
  const tragusGeo = new THREE.SphereGeometry(0.028, 8, 6);
  const tragusMesh = new THREE.Mesh(tragusGeo, earMat);
  tragusMesh.position.set(earW * 0.05, -0.01, 0.018);
  tragusMesh.scale.set(0.7, 1.3, 0.5);

  // Lobe (cuping telinga)
  const lobeGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const lobeMesh = new THREE.Mesh(lobeGeo, earMat);
  lobeMesh.position.set(earW * 0.15, -earH * 0.48, 0.01);
  lobeMesh.scale.set(1.0, 0.8, 0.4);

  group.add(earMesh, antihelix, tragusMesh, lobeMesh);

  // Posisi dan orientasi telinga — terlihat menonjol dari samping kepala
  const headSurface = sculpt(new THREE.Vector3(side * 0.97, 0.0, 0.10).normalize());
  group.position.set(headSurface.x + side * 0.025, headSurface.y + 0.05, headSurface.z - 0.04);
  group.rotation.y = side * 0.35;
  group.rotation.z = side * -0.08;
  group.scale.set(side < 0 ? -1.1 : 1.1, 1.1, 1.1);

  return { group, mat: earMat };
}

class ProceduralHead {
  constructor() {
    this.group = new THREE.Group();

    // Geometri kepala utama dengan resolusi tinggi untuk detail wireframe yang rapi
    const geo = new THREE.SphereGeometry(1, 52, 42);
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
      new THREE.MeshBasicMaterial({
        color: 0x020812,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );

    // Wireframe utama
    this.wireMat = new THREE.MeshBasicMaterial({
      color: BLUE.clone(),
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    this.wire = new THREE.Mesh(geo, this.wireMat);

    // Titik-titik vertex
    this.dotsMat = new THREE.PointsMaterial({
      color: BLUE_BRIGHT.clone(),
      size: 0.008,
      transparent: true,
      opacity: 0.7,
    });
    this.dots = new THREE.Points(geo, this.dotsMat);

    this.group.add(this.occluder, this.wire, this.dots);

    this.#buildEyes();
    this.#buildLips();
    this.#buildNeck();
    this.#buildEars();
  }

  #buildEyes() {
    this.eyeMat = new THREE.MeshBasicMaterial({ color: EYE_DIM.clone() });
    // Bola mata utama
    const eyeGeo = new THREE.SphereGeometry(0.050, 24, 14);
    // Iris ring (ring kecil di tengah mata)
    const irisGeo = new THREE.RingGeometry(0.016, 0.034, 24);
    this.irisMat = new THREE.MeshBasicMaterial({
      color: GREEN.clone(),
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
    // Pupil dot hitam pekat bulat seperti manusia
    const pupilGeo = new THREE.CircleGeometry(0.016, 24);
    this.pupilMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    });

    this.eyes = [-1, 1].map((side) => {
      const p = sculpt(new THREE.Vector3(side * 0.33, 0.10, 0.92).normalize());
      const eyeGroup = new THREE.Group();

      // Bola mata
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.scale.set(1.3, 0.65, 0.45);
      eyeGroup.add(eye);

      // Iris
      const iris = new THREE.Mesh(irisGeo, this.irisMat);
      iris.position.z = 0.025;
      eyeGroup.add(iris);

      // Pupil
      const pupil = new THREE.Mesh(pupilGeo, this.pupilMat);
      pupil.position.z = 0.026;
      eyeGroup.add(pupil);

      eyeGroup.position.set(p.x, p.y, p.z - 0.005);
      this.group.add(eyeGroup);
      return eyeGroup;
    });
  }

  #lipPoints(open, lower) {
    const pts = [];
    const N = 28;
    const half = 0.38;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = (t - 0.5) * 2 * half;
      const mid = Math.cos((t - 0.5) * Math.PI);
      const yUnit = MOUTH_Y + (lower ? -0.012 : 0.012);
      const r = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
      const p = sculpt(new THREE.Vector3(Math.sin(a) * r, yUnit, Math.cos(a) * r));
      p.z += 0.015;
      if (lower) {
        p.y -= open * 0.055 * mid;
        rotateAroundPivot(p, open * JAW_MAX, p);
      } else {
        p.y += open * 0.018 * mid;
      }
      pts.push(p);
    }
    return pts;
  }

  #buildLips() {
    this.lipMat = new THREE.LineBasicMaterial({ color: BLUE.clone(), linewidth: 1.5 });
    this.upperLip = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.#lipPoints(0, false)),
      this.lipMat,
    );
    this.lowerLip = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.#lipPoints(0, true)),
      this.lipMat,
    );
    // Rongga mulut gelap yang tampak saat mulut terbuka
    this.mouthCavity = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.9 }),
    );
    this.group.add(this.upperLip, this.lowerLip, this.mouthCavity);
  }

  #buildNeck() {
    // Leher lebih pendek dan natural
    const geo = new THREE.CylinderGeometry(0.26, 0.34, 0.45, 22, 4, true);
    const mat = new THREE.MeshBasicMaterial({
      color: BLUE.clone(),
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const neck = new THREE.Mesh(geo, mat);
    neck.position.set(0, -0.95, -0.12);
    this.group.add(neck);
    this.neckMat = mat;
  }

  #buildEars() {
    this.earParts = [];
    for (const side of [-1, 1]) {
      const ear = createEar(side);
      this.group.add(ear.group);
      this.earParts.push(ear);
    }
  }

  setMouth(open, grin = 0) {
    if (Math.abs(open - (this.lastOpen ?? -1)) < 0.003 && Math.abs(grin - (this.lastGrin ?? -1)) < 0.01) return;
    this.lastOpen = open;
    this.lastGrin = grin;
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
    const top = sculpt(new THREE.Vector3(0, MOUTH_Y, Math.sqrt(Math.max(0, 1 - MOUTH_Y ** 2))));
    this.mouthCavity.position.set(0, top.y - open * 0.055, top.z - 0.003);
    this.mouthCavity.scale.set(0.12 + grin * 0.03, Math.max(0.001, open * 0.095 + grin * 0.02), 1);
    this.mouthCavity.visible = open > 0.025 || grin > 0.15;
  }

  setBrows(liftL, liftR) {
    // Procedural fallback brows
  }

  setColors(wire, eye, glow) {
    this.wireMat.color.copy(wire);
    this.dotsMat.color.copy(wire);
    this.lipMat.color.copy(wire);
    this.neckMat.color.copy(wire);
    for (const ear of this.earParts) ear.mat.color.copy(wire);
    this.eyeMat.color.copy(eye).multiplyScalar(glow * 0.5);
    this.irisMat.color.copy(eye).multiplyScalar(glow);
    this.pupilMat.color.set(0x000000);
  }

  setWireOpacity(o) {
    this.wireMat.opacity = o;
    this.dotsMat.opacity = clamp(o + 0.15, 0, 1);
    for (const ear of this.earParts) ear.mat.opacity = clamp(o - 0.05, 0, 1);
  }

  setBlink(amount, squint = 0) {
    const sy = Math.max(0.02, (1 - amount * 0.92) * (1 - squint * 0.65));
    for (const eyeGroup of this.eyes) eyeGroup.scale.y = sy;
  }
}

/** Pembungkus untuk model .glb kepala realistis (LeePerrySmith) yang super mirip gambar referensi. */
class GltfHead {
  constructor(scene) {
    this.group = new THREE.Group();

    // Cari mesh utama kepala dari scene GLTF
    let headMesh = null;
    scene.traverse((o) => {
      if (o.isMesh && !headMesh) headMesh = o;
    });

    if (!headMesh) {
      this.usable = false;
      return;
    }
    this.usable = true;

    const origGeo = headMesh.geometry;
    origGeo.computeBoundingBox();
    const size = origGeo.boundingBox.getSize(new THREE.Vector3());
    const center = origGeo.boundingBox.getCenter(new THREE.Vector3());

    // Normalisasi awal & faktor skala untuk kepala manusia yang proporsional
    const sInitial = 2.10 / Math.max(size.y, 1e-5);
    const CUTOFF_Y = -0.36; // Potong dada & bahu lebar agar fokus hanya ke kepala & leher (seperti gambar)

    const posAttr = origGeo.attributes.position;
    const normAttr = origGeo.attributes.normal;
    const indexAttr = origGeo.index;

    // Bersihkan geometri: hapus segitiga & vertex dada di bawah leher
    const oldToNew = new Map();
    const newPos = [];
    const newNorm = [];
    const newIndices = [];

    // Transformasi skala & offset final untuk menempatkan wajah tepat di tengah layar & sejajar simetris
    const FINAL_SCALE = 1.36;
    const FINAL_OFFSET_Y = -0.35 * FINAL_SCALE;
    const FINAL_OFFSET_X = 0.032; // Sejajarkan garis tengah hidung, philtrum, & mulut tepat ke sumbu X = 0

    for (let i = 0; i < indexAttr.count; i += 3) {
      const idxs = [indexAttr.getX(i), indexAttr.getX(i + 1), indexAttr.getX(i + 2)];
      const ys = idxs.map((idx) => (posAttr.getY(idx) - center.y) * sInitial);
      // Simpan segitiga jika berada di atas garis leher
      if (ys.every((y) => y > CUTOFF_Y)) {
        // Cek apakah segitiga berada di dalam bukaan soket mata (agar mata bersih dari kawat bersilang)
        const vWorld = idxs.map((idx) => {
          const px = (posAttr.getX(idx) - center.x) * sInitial * FINAL_SCALE + FINAL_OFFSET_X;
          const py = (posAttr.getY(idx) - center.y) * sInitial * FINAL_SCALE + FINAL_OFFSET_Y;
          const pz = (posAttr.getZ(idx) - center.z) * sInitial * FINAL_SCALE;
          return { px, py, pz };
        });
        const inLeftEye = vWorld.every((v) => v.px < -0.155 && v.px > -0.325 && v.py > 0.075 && v.py < 0.170 && v.pz > 0.56);
        const inRightEye = vWorld.every((v) => v.px > 0.155 && v.px < 0.325 && v.py > 0.075 && v.py < 0.170 && v.pz > 0.56);

        if (!inLeftEye && !inRightEye) {
          for (const oldIdx of idxs) {
            if (!oldToNew.has(oldIdx)) {
              const newIdx = oldToNew.size;
              oldToNew.set(oldIdx, newIdx);
              const px = (posAttr.getX(oldIdx) - center.x) * sInitial * FINAL_SCALE + FINAL_OFFSET_X;
              const py = (posAttr.getY(oldIdx) - center.y) * sInitial * FINAL_SCALE + FINAL_OFFSET_Y;
              const pz = (posAttr.getZ(oldIdx) - center.z) * sInitial * FINAL_SCALE;
              newPos.push(px, py, pz);
              if (normAttr) {
                newNorm.push(normAttr.getX(oldIdx), normAttr.getY(oldIdx), normAttr.getZ(oldIdx));
              }
            }
            newIndices.push(oldToNew.get(oldIdx));
          }
        }
      }
    }

    const cleanGeo = new THREE.BufferGeometry();
    cleanGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
    if (newNorm.length) {
      cleanGeo.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
    } else {
      cleanGeo.computeVertexNormals();
    }
    cleanGeo.setIndex(newIndices);

    this.geo = cleanGeo;
    const pos = cleanGeo.attributes.position;
    this.basePos = Float32Array.from(pos.array);

    // Hitung bobot pergerakan rahang bawah untuk animasi lip-sync mulut
    this.jawWeights = [];
    const JAW_PIVOT_GLTF = new THREE.Vector3(0, -0.15, 0.20);
    this.jawPivot = JAW_PIVOT_GLTF;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Titik di bawah bibir atas (celah mulut y = -0.318) yang ikut bergerak saat rahang membuka
      const w = smooth(-0.316, -0.380, y) * smooth(-0.30, 0.15, z);
      if (w > 0.001) {
        this.jawWeights.push([i, w]);
      }
    }

    // Morph target jika ada
    this.morphs = [];
    this.blinks = [];
    if (headMesh.morphTargetDictionary) {
      const dict = headMesh.morphTargetDictionary;
      const idx = dict.jawOpen ?? dict.mouthOpen ?? dict.JawOpen ?? dict.MouthOpen;
      if (idx !== undefined) this.morphs.push([headMesh, idx]);
      const blinkL = dict.eyeBlinkLeft ?? dict.eyeBlink_L;
      const blinkR = dict.eyeBlinkRight ?? dict.eyeBlink_R;
      if (blinkL !== undefined) this.blinks = [[headMesh, blinkL], [headMesh, blinkR]];
    }

    // 1. Pengoklusi gelap di dalam kepala: mencegah kawat belakang tembus ke depan (kunci estetika referensi!)
    this.occluderMat = new THREE.MeshBasicMaterial({
      color: 0x01050e,
      polygonOffset: true,
      polygonOffsetFactor: 1.5,
      polygonOffsetUnits: 1.5,
    });
    this.occluder = new THREE.Mesh(cleanGeo, this.occluderMat);
    this.occluder.renderOrder = 10;

    // 2. Wireframe biru neon utama
    this.wireMat = new THREE.MeshBasicMaterial({
      color: BLUE.clone(),
      wireframe: true,
      transparent: true,
      opacity: 0.54,
    });
    this.wire = new THREE.Mesh(cleanGeo, this.wireMat);
    this.wire.renderOrder = 50;

    // 3. Titik-titik vertex grid bercahaya (efek holographic point-cloud)
    // Filter titik dots agar area soket mata dan area bibir bersih (tidak tertutup titik-titik biru)
    const dotsPos = [];
    for (let i = 0; i < newPos.length; i += 3) {
      const px = newPos[i], py = newPos[i + 1], pz = newPos[i + 2];
      const inEye = Math.abs(px) > 0.155 && Math.abs(px) < 0.325 && py > 0.075 && py < 0.170 && pz > 0.52;
      const inMouth = Math.abs(px) < 0.18 && py > -0.38 && py < -0.27 && pz > 0.72;
      if (!inEye && !inMouth) {
        dotsPos.push(px, py, pz);
      }
    }
    const dotsGeo = new THREE.BufferGeometry();
    dotsGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotsPos, 3));
    this.dotsMat = new THREE.PointsMaterial({
      color: BLUE_BRIGHT.clone(),
      size: 0.009,
      transparent: true,
      opacity: 0.70,
    });
    this.dots = new THREE.Points(dotsGeo, this.dotsMat);
    this.dots.renderOrder = 52;

    this.group.add(this.occluder, this.wire, this.dots);

    // 4. Mata hijau neon menyala di rongga mata dengan titik pupil hitam manusia
    this.#buildEyes();

    // 5. Garis aksen dahi melengkung, alis, dan rongga mulut
    this.#buildContourLines();
  }

  #buildEyes() {
    this.eyes = [];
    this.eyeMat = new THREE.MeshBasicMaterial({
      color: 0x01050e,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.irisMat = new THREE.MeshBasicMaterial({
      color: GREEN.clone(),
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.pupilMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.eyeLidMat = new THREE.LineBasicMaterial({
      color: GREEN_BRIGHT.clone(),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    // Posisi soket mata LeePerrySmith (simetris presisi sejajar bukaan kelopak mata)
    const eyeConfigs = [
      { side: -1, x: -0.240, y: 0.123, z: 0.648, rotY: 0.065 },
      { side: 1, x: 0.240, y: 0.123, z: 0.648, rotY: -0.065 },
    ];

    for (const cfg of eyeConfigs) {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(cfg.x, cfg.y, cfg.z);
      eyeGroup.rotation.y = cfg.rotY;

      // 1. Dasar soket mata gelap pekat (menutup wireframe wajah di area rongga mata)
      const backGeo = new THREE.CircleGeometry(0.056, 28);
      const backMesh = new THREE.Mesh(backGeo, this.eyeMat);
      backMesh.scale.set(1.45, 0.78, 1);
      backMesh.renderOrder = 95;
      eyeGroup.add(backMesh);

      // 2. Iris hijau zamrud menyala (cincin dengan lubang tengah untuk pupil)
      const irisGeo = new THREE.RingGeometry(0.022, 0.040, 32);
      const irisMesh = new THREE.Mesh(irisGeo, this.irisMat);
      irisMesh.position.z = 0.005;
      irisMesh.scale.set(1.10, 0.92, 1);
      irisMesh.renderOrder = 98;
      eyeGroup.add(irisMesh);

      // 3. Titik pupil mata hitam bulat pekat di tengah iris (seperti manusia umumnya)
      const pupilGeo = new THREE.CircleGeometry(0.023, 32);
      const pupilMesh = new THREE.Mesh(pupilGeo, this.pupilMat);
      pupilMesh.position.z = 0.009;
      pupilMesh.scale.set(1.0, 1.0, 1.0); // Bulat penuh, tidak pipih
      pupilMesh.renderOrder = 104; // Tampil di atas iris dengan warna hitam pekat sempurna
      eyeGroup.add(pupilMesh);

      // 4. Kilauan refleksi specular putih tajam (catchlight)
      const specGeo = new THREE.CircleGeometry(0.005, 16);
      const specMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false });
      const specMesh = new THREE.Mesh(specGeo, specMat);
      specMesh.position.set(0.007, 0.007, 0.013);
      specMesh.renderOrder = 106;
      eyeGroup.add(specMesh);

      // 5. Kontur kelopak mata almond hijau zamrud tegas & simetris
      const lidPts = [];
      const N = 36;
      const width = 0.076;
      const hUpper = 0.034;
      const hLower = 0.026;
      for (let i = 0; i <= N; i++) {
        const theta = (i / N) * Math.PI * 2;
        const lx = Math.cos(theta) * width;
        const ly = Math.sin(theta) > 0 ? Math.sin(theta) * hUpper : Math.sin(theta) * hLower;
        lidPts.push(new THREE.Vector3(lx, ly, 0.014));
      }
      const lidGeo = new THREE.BufferGeometry().setFromPoints(lidPts);
      const lidLine = new THREE.Line(lidGeo, this.eyeLidMat);
      lidLine.renderOrder = 102;
      eyeGroup.add(lidLine);

      this.group.add(eyeGroup);
      this.eyes.push(eyeGroup);
    }
  }

  #buildContourLines() {
    this.foreheadLineMat = new THREE.LineBasicMaterial({
      color: BLUE_BRIGHT.clone(),
      transparent: true,
      opacity: 0.92,
    });
    this.browLineMat = new THREE.LineBasicMaterial({
      color: BLUE_BRIGHT.clone(),
      transparent: true,
      opacity: 0.92,
    });

    // 1. Lengkungan dahi atas (seperti bando / seam line di gambar referensi)
    const foreheadControlPoints = [
      new THREE.Vector3(-0.46, 0.46, 0.50),
      new THREE.Vector3(-0.27, 0.49, 0.72),
      new THREE.Vector3(0.00, 0.44, 0.77),
      new THREE.Vector3(0.27, 0.49, 0.72),
      new THREE.Vector3(0.46, 0.46, 0.50),
    ];
    const foreheadCurve = new THREE.CatmullRomCurve3(foreheadControlPoints);
    const foreheadPts = foreheadCurve.getPoints(36);
    foreheadPts.forEach((p) => p.z += 0.008);

    const foreheadLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(foreheadPts),
      this.foreheadLineMat
    );
    this.group.add(foreheadLine);

    // 2. Alis dinamis dalam grup terpisah (agar bisa bergerak ekspresif saat bicara & mikir)
    this.browGroupL = new THREE.Group();
    this.browGroupR = new THREE.Group();

    const browPtsL = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = -0.08 - t * 0.30;
      const y = 0.18 + Math.sin(t * Math.PI) * 0.035 - t * 0.015;
      const z = 0.65 - t * 0.14;
      browPtsL.push(new THREE.Vector3(x, y, z + 0.010));
    }
    this.browLineL = new THREE.Line(new THREE.BufferGeometry().setFromPoints(browPtsL), this.browLineMat);
    this.browGroupL.add(this.browLineL);

    const browPtsR = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = 0.08 + t * 0.30;
      const y = 0.18 + Math.sin(t * Math.PI) * 0.035 - t * 0.015;
      const z = 0.65 - t * 0.14;
      browPtsR.push(new THREE.Vector3(x, y, z + 0.010));
    }
    this.browLineR = new THREE.Line(new THREE.BufferGeometry().setFromPoints(browPtsR), this.browLineMat);
    this.browGroupR.add(this.browLineR);

    this.group.add(this.browGroupL, this.browGroupR);

    // 3. Kontur, Volume Bibir, Gigi Cyber Pearl, dan Rongga Mulut Artikulatif 3D
    this.lipLineMat = new THREE.LineBasicMaterial({
      color: BLUE_BRIGHT.clone(),
      transparent: true,
      opacity: 0.96,
      depthTest: false,
    });
    this.lipFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x1888dd),
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.lipSeamMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0x0a4070),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    this.cavityMat = new THREE.MeshBasicMaterial({
      color: 0x000206,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.teethMat = new THREE.MeshBasicMaterial({
      color: 0xf0f7ff,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    const N = 24;
    // Mesh volume bibir atas
    const upperGeo = new THREE.BufferGeometry();
    upperGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const upperIdx = [];
    for (let i = 0; i < N; i++) {
      const b = i * 2;
      upperIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    upperGeo.setIndex(upperIdx);
    this.upperMesh = new THREE.Mesh(upperGeo, this.lipFillMat);
    this.upperMesh.renderOrder = 96;

    // Mesh volume bibir bawah
    const lowerGeo = new THREE.BufferGeometry();
    lowerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const lowerIdx = [];
    for (let i = 0; i < N; i++) {
      const b = i * 2;
      lowerIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    lowerGeo.setIndex(lowerIdx);
    this.lowerMesh = new THREE.Mesh(lowerGeo, this.lipFillMat);
    this.lowerMesh.renderOrder = 96;

    // Garis kontur luar bibir atas dan bawah
    this.upperLipLine = new THREE.Line(new THREE.BufferGeometry(), this.lipLineMat);
    this.upperLipLine.renderOrder = 98;
    this.lowerLipLine = new THREE.Line(new THREE.BufferGeometry(), this.lipLineMat);
    this.lowerLipLine.renderOrder = 98;
    this.lipSeamLine = new THREE.Line(new THREE.BufferGeometry(), this.lipSeamMat);
    this.lipSeamLine.renderOrder = 97;

    // Rongga mulut gelap pekat di antara bibir dalam (terlihat berdimensi saat mangap)
    const cavGeo = new THREE.BufferGeometry();
    cavGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const cavIdx = [];
    for (let i = 0; i < N; i++) {
      const b = i * 2;
      cavIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    cavGeo.setIndex(cavIdx);
    this.mouthCavity = new THREE.Mesh(cavGeo, this.cavityMat);
    this.mouthCavity.renderOrder = 94;

    // Barisan gigi cyber pearl white atas & bawah (dental arch ribbon)
    const T = 16;
    const uTeethGeo = new THREE.BufferGeometry();
    uTeethGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((T + 1) * 2 * 3), 3));
    const uTeethIdx = [];
    for (let i = 0; i < T; i++) {
      const b = i * 2;
      uTeethIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    uTeethGeo.setIndex(uTeethIdx);
    this.upperTeeth = new THREE.Mesh(uTeethGeo, this.teethMat);
    this.upperTeeth.renderOrder = 95;

    const lTeethGeo = new THREE.BufferGeometry();
    lTeethGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((T + 1) * 2 * 3), 3));
    const lTeethIdx = [];
    for (let i = 0; i < T; i++) {
      const b = i * 2;
      lTeethIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    lTeethGeo.setIndex(lTeethIdx);
    this.lowerTeeth = new THREE.Mesh(lTeethGeo, this.teethMat);
    this.lowerTeeth.renderOrder = 95;

    this.group.add(
      this.mouthCavity,
      this.upperTeeth,
      this.lowerTeeth,
      this.upperMesh,
      this.lowerMesh,
      this.upperLipLine,
      this.lowerLipLine,
      this.lipSeamLine
    );

    // Inisialisasi bentuk mulut saat diam
    this.#updateMouthCurves(0, 0);
  }

  setBrows(liftL, liftR, tiltL = 0, tiltR = 0) {
    if (this.browGroupL) {
      this.browGroupL.position.y = liftL;
      this.browGroupL.rotation.z = tiltL;
    }
    if (this.browGroupR) {
      this.browGroupR.position.y = liftR;
      this.browGroupR.rotation.z = tiltR;
    }
  }

  #updateMouthCurves(open = 0, grin = 0) {
    const N = 24;
    // Koordinat sudut mulut terhubung mulus tanpa robek
    const cornerW = 0.160 + grin * 0.028 - open * 0.010;
    const cornerY = -0.322 + grin * 0.038 - open * 0.018;
    const cornerZ = 0.758 + grin * 0.012 - open * 0.008;

    // Artikulasi bukaan mulut manusiawi:
    // Bibir atas terangkat sedikit di tengah (Cupid's bow naik memperlihatkan gigi atas)
    const openLift = open * 0.018;
    // Bibir bawah turun lebih dalam mengikuti pergerakan rahang (memperlihatkan rongga & gigi bawah)
    const openDrop = open * 0.082;

    // 1. Kurva kontur luar bibir atas
    const topControl = [
      new THREE.Vector3(-cornerW, cornerY, cornerZ),
      new THREE.Vector3(-0.090, -0.286 + grin * 0.016 + openLift * 0.6, 0.816),
      new THREE.Vector3(-0.038, -0.272 + grin * 0.008 + openLift, 0.838),
      new THREE.Vector3(0.000, -0.283 + grin * 0.008 + openLift * 0.8, 0.830),
      new THREE.Vector3(0.038, -0.272 + grin * 0.008 + openLift, 0.838),
      new THREE.Vector3(0.090, -0.286 + grin * 0.016 + openLift * 0.6, 0.816),
      new THREE.Vector3(cornerW, cornerY, cornerZ),
    ];
    const topPts = new THREE.CatmullRomCurve3(topControl).getPoints(N);

    // 2. Tepi bawah bibir atas (Upper Inner Edge)
    const upperInnerControl = [
      new THREE.Vector3(-cornerW, cornerY, cornerZ),
      new THREE.Vector3(-0.080, -0.320 + grin * 0.018 + openLift * 0.7, 0.804),
      new THREE.Vector3(0.000, -0.322 + grin * 0.010 + openLift, 0.818),
      new THREE.Vector3(0.080, -0.320 + grin * 0.018 + openLift * 0.7, 0.804),
      new THREE.Vector3(cornerW, cornerY, cornerZ),
    ];
    const upperInnerPts = new THREE.CatmullRomCurve3(upperInnerControl).getPoints(N);

    // 3. Tepi atas bibir bawah (Lower Inner Edge)
    const lowerInnerControl = [
      new THREE.Vector3(-cornerW, cornerY, cornerZ),
      new THREE.Vector3(-0.080, -0.320 + grin * 0.018 - openDrop * 0.75, 0.804),
      new THREE.Vector3(0.000, -0.322 + grin * 0.010 - openDrop, 0.818),
      new THREE.Vector3(0.080, -0.320 + grin * 0.018 - openDrop * 0.75, 0.804),
      new THREE.Vector3(cornerW, cornerY, cornerZ),
    ];
    const lowerInnerPts = new THREE.CatmullRomCurve3(lowerInnerControl).getPoints(N);

    // 4. Kurva kontur luar bibir bawah
    const botControl = [
      new THREE.Vector3(-cornerW, cornerY, cornerZ),
      new THREE.Vector3(-0.090, -0.356 + grin * 0.015 - openDrop * 0.60, 0.806),
      new THREE.Vector3(0.000, -0.366 + grin * 0.008 - openDrop * 0.70, 0.824),
      new THREE.Vector3(0.090, -0.356 + grin * 0.015 - openDrop * 0.60, 0.806),
      new THREE.Vector3(cornerW, cornerY, cornerZ),
    ];
    const botPts = new THREE.CatmullRomCurve3(botControl).getPoints(N);

    // Update garis bibir
    this.upperLipLine.geometry.setFromPoints(topPts);
    this.lowerLipLine.geometry.setFromPoints(botPts);

    // Garis celah bibir (terlihat saat mulut terkatup, meredup saat mulut membuka)
    this.lipSeamLine.geometry.setFromPoints(upperInnerPts);
    this.lipSeamLine.visible = open < 0.10;

    // Update Buffer Bibir Atas
    const uPos = this.upperMesh.geometry.attributes.position.array;
    for (let i = 0; i <= N; i++) {
      const idx = i * 6;
      uPos[idx] = topPts[i].x;
      uPos[idx + 1] = topPts[i].y;
      uPos[idx + 2] = topPts[i].z + 0.004;
      uPos[idx + 3] = upperInnerPts[i].x;
      uPos[idx + 4] = upperInnerPts[i].y;
      uPos[idx + 5] = upperInnerPts[i].z + 0.004;
    }
    this.upperMesh.geometry.attributes.position.needsUpdate = true;

    // Update Buffer Bibir Bawah
    const lPos = this.lowerMesh.geometry.attributes.position.array;
    for (let i = 0; i <= N; i++) {
      const idx = i * 6;
      lPos[idx] = lowerInnerPts[i].x;
      lPos[idx + 1] = lowerInnerPts[i].y;
      lPos[idx + 2] = lowerInnerPts[i].z + 0.004;
      lPos[idx + 3] = botPts[i].x;
      lPos[idx + 4] = botPts[i].y;
      lPos[idx + 5] = botPts[i].z + 0.004;
    }
    this.lowerMesh.geometry.attributes.position.needsUpdate = true;

    // Update Rongga Mulut Gelap Pekat (Oral Cavity)
    const cavPos = this.mouthCavity.geometry.attributes.position.array;
    for (let i = 0; i <= N; i++) {
      const idx = i * 6;
      cavPos[idx] = upperInnerPts[i].x;
      cavPos[idx + 1] = upperInnerPts[i].y;
      cavPos[idx + 2] = upperInnerPts[i].z - 0.012;
      cavPos[idx + 3] = lowerInnerPts[i].x;
      cavPos[idx + 4] = lowerInnerPts[i].y;
      cavPos[idx + 5] = lowerInnerPts[i].z - 0.012;
    }
    this.mouthCavity.geometry.attributes.position.needsUpdate = true;
    this.mouthCavity.visible = open > 0.02 || grin > 0.15;

    // Update Ribbon Gigi Cyber Pearl White
    const T = 16;
    const uTeethPos = this.upperTeeth.geometry.attributes.position.array;
    const lTeethPos = this.lowerTeeth.geometry.attributes.position.array;
    const teethArchW = 0.095;
    for (let i = 0; i <= T; i++) {
      const t = (i / T) * 2 - 1;
      const x = t * teethArchW;
      const curveZ = (1 - t * t) * 0.032;

      // Gigi atas
      const uYTop = -0.316 + openLift * 0.8 + (1 - t * t) * 0.003;
      const uYBot = uYTop - 0.016;
      const uZ = 0.796 + curveZ;
      const uIdx = i * 6;
      uTeethPos[uIdx] = x;
      uTeethPos[uIdx + 1] = uYTop;
      uTeethPos[uIdx + 2] = uZ;
      uTeethPos[uIdx + 3] = x;
      uTeethPos[uIdx + 4] = uYBot;
      uTeethPos[uIdx + 5] = uZ;

      // Gigi bawah (turun bersama artikulasi rahang dan bibir bawah)
      const lYBot = -0.328 - openDrop * 0.85;
      const lYTop = lYBot + 0.014;
      const lZ = 0.790 + curveZ;
      const lIdx = i * 6;
      lTeethPos[lIdx] = x * 0.92;
      lTeethPos[lIdx + 1] = lYTop;
      lTeethPos[lIdx + 2] = lZ;
      lTeethPos[lIdx + 3] = x * 0.92;
      lTeethPos[lIdx + 4] = lYBot;
      lTeethPos[lIdx + 5] = lZ;
    }
    this.upperTeeth.geometry.attributes.position.needsUpdate = true;
    this.lowerTeeth.geometry.attributes.position.needsUpdate = true;
    this.upperTeeth.visible = open > 0.03 || grin > 0.18;
    this.lowerTeeth.visible = open > 0.18 || grin > 0.35;
  }

  setMouth(open, grin = 0) {
    if (this.morphs.length > 0) {
      for (const [m, i] of this.morphs) m.morphTargetInfluences[i] = open;
    }

    const openChanged = Math.abs(open - (this.lastOpen ?? -1)) > 0.002;
    const grinChanged = Math.abs(grin - (this.lastGrin ?? -1)) > 0.008;

    if (openChanged || grinChanged) {
      this.lastOpen = open;
      this.lastGrin = grin;

      // Update seluruh kurva dan mesh bibir, rongga mulut, dan gigi
      this.#updateMouthCurves(open, grin);

      // Deformasi rahang bawah pada mesh kepala manusia LeePerrySmith
      if (this.jawWeights && this.jawWeights.length > 0) {
        const pos = this.geo.attributes.position;
        const v = new THREE.Vector3();
        const out = new THREE.Vector3();
        // Faktor rotasi 0.38 radian menghasilkan artikulasi rahang yang jelas dan manusiawi
        for (const [i, w] of this.jawWeights) {
          v.set(this.basePos[i * 3], this.basePos[i * 3 + 1], this.basePos[i * 3 + 2]);
          rotateAroundPivot(v, open * 0.38 * w, out, this.jawPivot);
          pos.setXYZ(i, out.x, out.y, out.z);
        }
        pos.needsUpdate = true;
      }
    }
  }

  setColors(wire, eye, glow) {
    this.wireMat.color.copy(wire);
    this.dotsMat.color.copy(wire);
    if (this.foreheadLineMat) this.foreheadLineMat.color.copy(wire);
    if (this.browLineMat) this.browLineMat.color.copy(wire);

    // Garis bibir cyan bercahaya mengikuti kawat wajah (selaras & keren, tidak norak)
    if (this.lipLineMat) this.lipLineMat.color.copy(wire).multiplyScalar(1.2);
    if (this.lipFillMat) this.lipFillMat.color.copy(wire).multiplyScalar(0.75);

    // Mata: Emerald green bercahaya alami, seimbang agar pupil hitam di tengah tetap tajam
    this.irisMat.color.copy(eye).multiplyScalar(Math.min(0.85, glow * 0.60));
    if (this.eyeLidMat) this.eyeLidMat.color.copy(eye).multiplyScalar(Math.min(1.0, glow * 0.75));
  }

  setWireOpacity(o) {
    this.wireMat.opacity = o;
    this.dotsMat.opacity = clamp(o + 0.18, 0, 1);
    if (this.foreheadLineMat) this.foreheadLineMat.opacity = clamp(o + 0.30, 0, 1);
    if (this.browLineMat) this.browLineMat.opacity = clamp(o + 0.35, 0, 1);
    if (this.lipLineMat) this.lipLineMat.opacity = clamp(o + 0.35, 0, 1);
    if (this.lipFillMat) this.lipFillMat.opacity = clamp(o * 0.65, 0, 0.45);
  }

  setBlink(amount, squint = 0) {
    if (this.blinks && this.blinks.length > 0) {
      for (const [m, i] of this.blinks) if (i !== undefined) m.morphTargetInfluences[i] = Math.max(amount, squint * 0.75);
    }
    const sy = Math.max(0.02, (1 - amount * 0.96) * (1 - squint * 0.65));
    for (const eyeGroup of this.eyes) {
      eyeGroup.scale.y = sy;
      eyeGroup.position.y = 0.123 + squint * 0.006;
    }
  }
}

/**
 * MoshBackdrop: Dynamic commercial-style solid color backdrop.
 * Bergaya visual iklan pop streetwear / kinetic typography / bold color blocking.
 * Berayun ke kiri & kanan secara energetik di belakang kepala saat moshing lagu iPhonekupi.
 */
class MoshBackdrop {
  constructor() {
    this.group = new THREE.Group();
    this.group.position.set(0, 0.08, -1.6);
    this.group.visible = false;

    this.opacity = 0;
    this.targetOpacity = 0;
    this.materials = [];
    this.currentPalette = 0;
    this.lastPaletteBeat = -999;

    this.palettes = [
      {
        left: 0xff0055,       // Vivid Hot Pink
        right: 0xffe600,      // Electric Yellow
        divider: 0x080811,    // Midnight Black
        disc: 0x00f0ff,       // Cyan
        discInner: 0xff0055,  // Pink
        stripe: 0x11111a,     // Deep Black
        bannerBg: '#ffe600',
        bannerText: '#080811',
        banner2Bg: '#ff0055',
        banner2Text: '#ffffff',
      },
      {
        left: 0x00e5ff,       // Neon Cyan
        right: 0xff4b00,      // Hot Orange
        divider: 0xffffff,    // White
        disc: 0xffea00,       // Bright Yellow
        discInner: 0x00e5ff,  // Cyan
        stripe: 0x0c0f18,     // Obsidian
        bannerBg: '#00e5ff',
        bannerText: '#080811',
        banner2Bg: '#ff4b00',
        banner2Text: '#ffffff',
      },
      {
        left: 0x7928ca,       // Cyber Violet
        right: 0x39ff14,      // Lime Acid
        divider: 0xffea00,    // Sun Yellow
        disc: 0xff007f,       // Magenta
        discInner: 0x7928ca,  // Violet
        stripe: 0x0a0316,     // Dark Violet
        bannerBg: '#39ff14',
        bannerText: '#0a0316',
        banner2Bg: '#7928ca',
        banner2Text: '#ffffff',
      },
      {
        left: 0xff1744,       // Crimson Red
        right: 0x2979ff,      // Cobalt Blue
        divider: 0xffffff,    // Pure White
        disc: 0xffea00,       // Neon Yellow
        discInner: 0xff1744,  // Red
        stripe: 0x0d1117,     // Dark Slate
        bannerBg: '#ffea00',
        bannerText: '#0d1117',
        banner2Bg: '#2979ff',
        banner2Text: '#ffffff',
      },
      {
        left: 0x0e0e14,       // Ultra Dark Solid
        right: 0xf0f4f8,      // Clean Bold White
        divider: 0xff0055,    // Hot Pink
        disc: 0xffe600,       // Acid Yellow
        discInner: 0x0e0e14,  // Dark
        stripe: 0xff007f,     // Pink Hazard
        bannerBg: '#ff0055',
        bannerText: '#ffffff',
        banner2Bg: '#f0f4f8',
        banner2Text: '#0e0e14',
      },
    ];

    const regMat = (mat, baseOpacity = 1.0) => {
      mat.userData = { baseOpacity };
      this.materials.push(mat);
      return mat;
    };

    // --- Layer 1: Base Solid Color Split Panels (Kiri & Kanan) ---
    this.bgLayer = new THREE.Group();
    this.bgLayer.position.z = -0.25;
    this.group.add(this.bgLayer);

    const panelGeo = new THREE.PlaneGeometry(12, 16);
    this.leftMat = regMat(new THREE.MeshBasicMaterial({
      color: this.palettes[0].left,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      toneMapped: false,
    }));
    this.leftPanel = new THREE.Mesh(panelGeo, this.leftMat);
    this.leftPanel.position.x = -6.0;
    this.bgLayer.add(this.leftPanel);

    this.rightMat = regMat(new THREE.MeshBasicMaterial({
      color: this.palettes[0].right,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      toneMapped: false,
    }));
    this.rightPanel = new THREE.Mesh(panelGeo, this.rightMat);
    this.rightPanel.position.x = 6.0;
    this.bgLayer.add(this.rightPanel);

    // Garis pemisah vertikal tengah (Divider line tebal solid)
    const divGeo = new THREE.PlaneGeometry(0.14, 16);
    this.dividerMat = regMat(new THREE.MeshBasicMaterial({
      color: this.palettes[0].divider,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      toneMapped: false,
    }));
    this.divider = new THREE.Mesh(divGeo, this.dividerMat);
    this.divider.position.z = 0.02;
    this.bgLayer.add(this.divider);

    // --- Layer 2: Graphic Geometric Cutouts & Stripes ---
    this.shapesLayer = new THREE.Group();
    this.shapesLayer.position.z = -0.10;
    this.group.add(this.shapesLayer);

    // Lingkaran Pop Art / Disc besar di tengah belakang kepala
    const discGeo = new THREE.RingGeometry(1.65, 2.35, 48);
    this.discMat = regMat(new THREE.MeshBasicMaterial({
      color: this.palettes[0].disc,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false,
    }));
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.position.set(0, 0.12, 0);
    this.shapesLayer.add(this.disc);

    // Lingkaran dalam solid
    const innerDiscGeo = new THREE.CircleGeometry(1.15, 48);
    this.innerDiscMat = regMat(new THREE.MeshBasicMaterial({
      color: this.palettes[0].discInner,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      toneMapped: false,
    }), 0.85);
    this.innerDisc = new THREE.Mesh(innerDiscGeo, this.innerDiscMat);
    this.innerDisc.position.set(0, 0.12, -0.01);
    this.shapesLayer.add(this.innerDisc);

    // Garis-garis aksen grafis miring (Dynamic Stripes)
    const stripeGeo = new THREE.PlaneGeometry(14, 0.35);
    this.stripeMat = regMat(new THREE.MeshBasicMaterial({
      color: this.palettes[0].stripe,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      toneMapped: false,
    }), 0.9);

    this.stripe1 = new THREE.Mesh(stripeGeo, this.stripeMat);
    this.stripe1.position.set(-1.0, 1.95, 0.02);
    this.stripe1.rotation.z = -0.18;
    this.shapesLayer.add(this.stripe1);

    this.stripe2 = new THREE.Mesh(stripeGeo, this.stripeMat);
    this.stripe2.position.set(1.0, -1.75, 0.02);
    this.stripe2.rotation.z = -0.18;
    this.shapesLayer.add(this.stripe2);

    // Balok aksen horizontal
    const barGeo = new THREE.PlaneGeometry(3.5, 0.22);
    this.barLeft = new THREE.Mesh(barGeo, this.discMat);
    this.barLeft.position.set(-3.6, 0.12, 0.03);
    this.shapesLayer.add(this.barLeft);

    this.barRight = new THREE.Mesh(barGeo, this.discMat);
    this.barRight.position.set(3.6, 0.12, 0.03);
    this.shapesLayer.add(this.barRight);

    // --- Layer 3: Kinetic Typography Tapes (Streetwear Marquee Banners) ---
    this.tapesLayer = new THREE.Group();
    this.tapesLayer.position.z = 0.05;
    this.group.add(this.tapesLayer);

    const banner1 = this.#createTapeCanvas(
      '★ IPHONEKUPI ★ MOSHPIT PARTY ★ SUPRI LIVE ★ DROP THE BASS ★ SOUND ON ★ ',
      this.palettes[0].bannerBg,
      this.palettes[0].bannerText
    );
    this.tape1Tex = banner1.texture;
    this.tape1Canvas = banner1.canvas;
    this.tape1Ctx = banner1.ctx;
    this.tape1Text = '★ IPHONEKUPI ★ MOSHPIT PARTY ★ SUPRI LIVE ★ DROP THE BASS ★ SOUND ON ★ ';

    const tape1Geo = new THREE.PlaneGeometry(18, 0.52);
    this.tape1Mat = regMat(new THREE.MeshBasicMaterial({
      map: this.tape1Tex,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      toneMapped: false,
    }));
    this.tape1 = new THREE.Mesh(tape1Geo, this.tape1Mat);
    this.tape1.position.set(0, 1.45, 0);
    this.tape1.rotation.z = -0.045;
    this.tapesLayer.add(this.tape1);

    const banner2 = this.#createTapeCanvas(
      '/// HEADBANG /// SENGGOL DONG /// TAP TAP LAYAR /// GASKEUN /// SUPRI VIBES /// ',
      this.palettes[0].banner2Bg,
      this.palettes[0].banner2Text
    );
    this.tape2Tex = banner2.texture;
    this.tape2Canvas = banner2.canvas;
    this.tape2Ctx = banner2.ctx;
    this.tape2Text = '/// HEADBANG /// SENGGOL DONG /// TAP TAP LAYAR /// GASKEUN /// SUPRI VIBES /// ';

    const tape2Geo = new THREE.PlaneGeometry(18, 0.52);
    this.tape2Mat = regMat(new THREE.MeshBasicMaterial({
      map: this.tape2Tex,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      toneMapped: false,
    }));
    this.tape2 = new THREE.Mesh(tape2Geo, this.tape2Mat);
    this.tape2.position.set(0, -1.35, 0);
    this.tape2.rotation.z = 0.038;
    this.tapesLayer.add(this.tape2);
  }

  #createTapeCanvas(text, bgColor, textColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    this.#drawTapeCanvas(ctx, canvas.width, canvas.height, text, bgColor, textColor);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(2, 1);
    return { canvas, ctx, texture };
  }

  #drawTapeCanvas(ctx, w, h, text, bgColor, textColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Border strip kontras
    ctx.fillStyle = textColor;
    ctx.fillRect(0, 0, w, 6);
    ctx.fillRect(0, h - 6, w, 6);

    // Teks bold sans
    ctx.font = '900 46px "Orbitron", Impact, "Arial Black", sans-serif';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  }

  #updatePalette(palIndex) {
    const pal = this.palettes[palIndex];
    if (!pal) return;
    this.leftMat.color.setHex(pal.left);
    this.rightMat.color.setHex(pal.right);
    this.dividerMat.color.setHex(pal.divider);
    this.discMat.color.setHex(pal.disc);
    this.innerDiscMat.color.setHex(pal.discInner);
    this.stripeMat.color.setHex(pal.stripe);

    if (this.tape1Ctx) {
      this.#drawTapeCanvas(this.tape1Ctx, 1024, 128, this.tape1Text, pal.bannerBg, pal.bannerText);
      this.tape1Tex.needsUpdate = true;
    }
    if (this.tape2Ctx) {
      this.#drawTapeCanvas(this.tape2Ctx, 1024, 128, this.tape2Text, pal.banner2Bg, pal.banner2Text);
      this.tape2Tex.needsUpdate = true;
    }
  }

  update(dt, t, isMoshing) {
    this.targetOpacity = isMoshing ? 1.0 : 0.0;
    this.opacity = lerp(this.opacity, this.targetOpacity, 1 - Math.exp(-dt * 9));

    if (this.opacity < 0.005) {
      if (this.group.visible) this.group.visible = false;
      return;
    }
    if (!this.group.visible) this.group.visible = true;

    // Terapkan opacity ke semua material
    for (const mat of this.materials) {
      mat.opacity = this.opacity * (mat.userData.baseOpacity ?? 1.0);
    }

    if (!isMoshing && this.opacity < 0.02) return;

    const beat = t * 8.6; // Tempo moshing ~130 BPM

    // Ganti palet warna solid setiap 16 beat (~3.7 detik)
    const currentBeat16 = Math.floor(beat / 16);
    if (currentBeat16 !== this.lastPaletteBeat) {
      this.lastPaletteBeat = currentBeat16;
      this.currentPalette = (this.currentPalette + 1) % this.palettes.length;
      this.#updatePalette(this.currentPalette);
    }

    // Gerakan goyang kiri-kanan utama (Sway & Inertia)
    // Gerakan horizontal yang dinamis dan punchy agar terasa seperti di iklan aksi moshing!
    const swayPrimary = Math.sin(beat) * 0.72;
    const swaySecondary = Math.cos(beat * 0.5) * 0.38;
    const totalSwayX = swayPrimary + swaySecondary;

    // Gerak tilt / roll miring kiri-kanan
    const tiltZ = -Math.sin(beat) * 0.11;

    // Beat bounce & pulse punch
    const kick = Math.pow(Math.max(0, Math.sin(beat * 2)), 3.5);
    const pulseScale = 1.0 + kick * 0.07;
    const bounceY = 0.08 + Math.abs(Math.sin(beat)) * 0.07;

    // Terapkan gerakan ke group root
    this.group.position.x = totalSwayX * 0.85;
    this.group.position.y = bounceY;
    this.group.rotation.z = tiltZ;
    this.group.scale.set(pulseScale, pulseScale, 1.0);

    // Parallax antar-layer: layer shapes dan tapes bergeser dengan kecepatan berbeda
    this.bgLayer.position.x = -totalSwayX * 0.15;
    this.shapesLayer.position.x = totalSwayX * 0.28;
    this.tapesLayer.position.x = -totalSwayX * 0.22;

    // Putaran disc pop art di belakang kepala
    this.disc.rotation.z = t * 1.8;
    this.innerDisc.scale.setScalar(1.0 + kick * 0.12);

    // Marquee scrolling tape banner teks horizontal
    if (this.tape1Tex) this.tape1Tex.offset.x -= dt * 0.42;
    if (this.tape2Tex) this.tape2Tex.offset.x += dt * 0.48;
  }
}

export class Face3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'IDLE';
    this.mouthTarget = 0;
    this.mouth = 0;
    this.blinkT = 0;
    this.nextBlink = 2 + Math.random() * 3;
    this.wireColor = BLUE.clone();
    this.eyeColor = EYE_DIM.clone();
    this.eyeGlow = 1;

    // Mimik ekspresi: senyum/nyengir dan mata sipit
    this.grin = 0;
    this.grinTarget = 0;
    this.squint = 0;
    this.squintTarget = 0;
    this.laughTimer = 0;
    this.isMoshing = false;

    // Bahasa tubuh presenter & tolehan dinamis ke audiens (saat SPEAKING)
    this.speechYawZone = 0;          // Arah toleh audiens (-0.35 s/d +0.35 rad)
    this.speechNextShift = 0;        // Jadwal waktu ganti sudut pandang presenter
    this.speechLastState = 'IDLE';   // Pelacak transisi state

    // Gerakan pandangan acak alami (autonomous natural wander)
    this.wanderTargetY = 0;
    this.wanderTargetX = 0;
    this.wanderTargetZ = 0;
    this.wanderNextChange = 1.5;

    this.canvas = canvas;
    this.isZoomOut = false;
    this.isStreamMode = false;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 0.08, 6.5);

    // Backdrop iklan moshing warna solid di belakang wajah
    this.moshBackdrop = new MoshBackdrop();
    this.scene.add(this.moshBackdrop.group);

    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.head = new ProceduralHead();
    this.rig.add(this.head.group);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.30, 0.18, 0.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.#resize());
    this.#resize();
    this.#tryLoadGltf();

    this.timer = new THREE.Timer();
    renderer.setAnimationLoop((now) => this.#tick(now));
  }

  setZoomOut(enabled) {
    this.isZoomOut = !!enabled;
    this.#resize();
  }

  setStreamMode(enabled) {
    this.isStreamMode = !!enabled;
    if (enabled) {
      this.isZoomOut = true;
    }
    this.#resize();
  }

  resize() {
    this.#resize();
  }

  #tryLoadGltf() {
    new GLTFLoader().load(
      '/head.glb',
      (gltf) => {
        try {
          const head = new GltfHead(gltf.scene);
          if (!head.usable) {
            console.info('[face3d] head.glb tidak usable, tetap pakai kepala prosedural');
            return;
          }
          this.rig.remove(this.head.group);
          this.head = head;
          this.rig.add(head.group);
          console.info('[face3d] Berhasil memuat head.glb!');
        } catch (err) {
          console.error('[face3d] Error initializing GltfHead:', err);
        }
      },
      undefined,
      (err) => {
        console.warn('[face3d] head.glb tidak ditemukan, tetap pakai kepala prosedural:', err);
      },
    );
  }

  #resize() {
    const rect = this.canvas?.getBoundingClientRect();
    const w = (rect && rect.width > 50) ? Math.round(rect.width) : innerWidth;
    const h = (rect && rect.height > 50) ? Math.round(rect.height) : innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    // Jaga kepala tetap muat & proporsional saat portrait (9:16) atau zoom out
    const zoomFactor = this.isZoomOut ? 1.48 : 1.0;
    const baseZ = w / h < 0.9 ? (6.5 / Math.max(w / h, 0.5)) * 0.85 : 6.5;
    this.camera.position.z = baseZ * zoomFactor;
    this.camera.position.y = this.isZoomOut ? 0.32 : 0.08;
    this.camera.updateProjectionMatrix();
  }

  setState(state) {
    if (this.state !== state && state === 'SPEAKING') {
      // Pemicu awal saat mulai bicara: tentukan sudut toleh presenter perdana
      this.speechYawZone = (Math.random() < 0.5 ? -1 : 1) * (0.24 + Math.random() * 0.12);
      this.speechNextShift = this.timer ? this.timer.getElapsed() + 1.8 + Math.random() * 1.4 : 2.0;
    }
    this.state = state;
  }

  /** Nilai buka mulut 0..1 (dari analyser audio atau simulasi). */
  setMouthTarget(v) {
    this.mouthTarget = Math.min(1, Math.max(0, v));
  }

  /** Pemicu tawa: mata menyipit senang & wajah nyengir lebar. */
  triggerLaugh(duration = 2.8) {
    this.laughTimer = duration;
  }

  /** Aktifkan mode joget mosing tempo cepat kiri-kanan. */
  setMoshing(active) {
    this.isMoshing = !!active;
    if (!active) {
      this.grinTarget = 0;
      this.squintTarget = 0;
    }
  }

  setGrin(v) {
    this.grinTarget = clamp(v, 0, 1);
  }

  setSquint(v) {
    this.squintTarget = clamp(v, 0, 1);
  }

  #tick(now) {
    this.timer.update(now);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();
    const s = this.state;

    // Update backdrop iklan moshing warna solid di belakang kepala
    if (this.moshBackdrop) {
      this.moshBackdrop.update(dt, t, this.isMoshing);
    }

    // Gerakan kepala: Mode Mosing vs Mode Normal
    if (this.isMoshing) {
      // Joget mosing energetik tempo cepat (~130 BPM)
      const beat = t * 8.6;
      const moshRoll = Math.sin(beat) * 0.22;               // goyang miring z kiri-kanan
      const moshYaw = Math.cos(beat * 0.5) * 0.35;          // menoleh y kiri-kanan
      const moshPitch = -0.10 + Math.sin(beat * 2) * 0.18;  // headbang x angguk cepat
      const moshBounce = Math.abs(Math.sin(beat)) * 0.06;   // lompat mantul naik-turun
      const moshSwayX = Math.sin(beat * 0.5) * 0.14;        // translasi badan x kiri-kanan

      this.rig.rotation.z = lerp(this.rig.rotation.z, moshRoll, 0.26);
      this.rig.rotation.y = lerp(this.rig.rotation.y, moshYaw, 0.26);
      this.rig.rotation.x = lerp(this.rig.rotation.x, moshPitch, 0.26);
      this.rig.position.x = lerp(this.rig.position.x, moshSwayX, 0.26);
      this.rig.position.y = 0.08 + moshBounce;

      // Saat mosing mimik muka heboh: mata agak sipit senang dan senyum nyengir
      this.squintTarget = 0.50 + Math.sin(beat) * 0.25;
      this.grinTarget = 0.80 + Math.sin(beat * 0.5) * 0.20;
    } else {
      // Gerakan otonom alami normal:
      // Saat SPEAKING: ekspresi presenter lincah (toleh kiri-kanan ke audiens, goyang badan luwes, angguk aksentuasi)
      // Saat IDLE / LISTENING: sesekali menoleh santai ke kiri/kanan acak
      if (s === 'SPEAKING') {
        // Deteksi awal mulai bicara -> langsung aktifkan tolehan presenter dinamis
        if (this.speechLastState !== 'SPEAKING') {
          this.speechYawZone = (Math.random() < 0.5 ? -1 : 1) * (0.24 + Math.random() * 0.12);
          this.speechNextShift = t + 1.8 + Math.random() * 1.4;
          this.speechLastState = 'SPEAKING';
        }

        // Pergantian fokus audiens presenter secara berkala (tiap 1.8 - 3.4 detik)
        if (t > this.speechNextShift) {
          const curr = this.speechYawZone;
          let next;
          if (Math.abs(curr) < 0.1) {
            // Sedang di tengah -> toleh ke kiri atau kanan
            next = (Math.random() < 0.5 ? -1 : 1) * (0.26 + Math.random() * 0.12);
          } else if (curr < -0.1) {
            // Sedang di kiri -> bisa ke tengah (35%) atau menyeberang ke kanan (65%)
            next = Math.random() < 0.35 ? 0 : (0.26 + Math.random() * 0.12);
          } else {
            // Sedang di kanan -> bisa ke tengah (35%) atau menyeberang ke kiri (65%)
            next = Math.random() < 0.35 ? 0 : -(0.26 + Math.random() * 0.12);
          }
          this.speechYawZone = next;
          this.speechNextShift = t + 2.0 + Math.random() * 1.6;
        }

        // 1. Tolehan dinamis (Yaw / kiri-kanan presenter ke berbagai sudut audiens)
        // Padukan fokus zona audiens utama dengan gelombang mikro intonasi bicara
        const microYaw = Math.sin(t * 2.2) * 0.08 * (0.4 + 0.6 * this.mouth);
        const targetYaw = this.speechYawZone + microYaw;

        // 2. Goyang tubuh & kepala kiri-kanan (Horizontal Translation / Body Sway)
        // Tubuh bergeser santai luwes layaknya pembicara di panggung atau streamer TikTok
        const bodySwayCycle = Math.sin(t * 1.6) * 0.09 + Math.sin(t * 0.8) * 0.04;
        const targetPosX = (this.speechYawZone * 0.38) + bodySwayCycle;

        // 3. Kemiringan kepala luwes (Roll / Head Tilt penyeimbang dan aksen santai)
        const speechRoll = -targetPosX * 0.26 + Math.sin(t * 2.4 + 0.5) * 0.045 * (0.35 + 0.65 * this.mouth);

        // 4. Anggukan artikulasi penekanan kata (Pitch aksentuasi suku kata)
        const speechPitch = -0.025 + (Math.sin(t * 4.4) * 0.045 + Math.sin(t * 2.2) * 0.025) * (0.30 + 0.70 * this.mouth);

        // 5. Pantulan vertikal ritmis napas & energi bicara
        const speechBounce = Math.sin(t * 3.2) * 0.010 + Math.sin(t * 6.4) * 0.005 * this.mouth;

        // Smooth damping tanpa jeda kaku
        const smoothYaw = 3.6;
        const smoothPos = 3.2;
        const smoothPitch = 5.0;
        const smoothRoll = 4.2;

        this.rig.rotation.y = lerp(this.rig.rotation.y, targetYaw, 1 - Math.exp(-dt * smoothYaw));
        this.rig.rotation.x = lerp(this.rig.rotation.x, speechPitch, 1 - Math.exp(-dt * smoothPitch));
        this.rig.rotation.z = lerp(this.rig.rotation.z, speechRoll, 1 - Math.exp(-dt * smoothRoll));

        this.rig.position.x = lerp(this.rig.position.x, targetPosX, 1 - Math.exp(-dt * smoothPos));
        this.rig.position.y = 0.08 + Math.sin(t * 1.5) * 0.008 + speechBounce;
      } else {
        this.speechLastState = s;
        // Kembalikan posisi x perlahan ke netral (0) saat IDLE / LISTENING / THINKING
        if (!this.isMoshing) {
          this.rig.position.x = lerp(this.rig.position.x, 0, 1 - Math.exp(-dt * 3.2));
        }

        if (t > this.wanderNextChange) {
          if (Math.random() < 0.45) {
            this.wanderTargetY = 0;
            this.wanderTargetX = (Math.random() - 0.5) * 0.04;
            this.wanderTargetZ = 0;
          } else {
            this.wanderTargetY = (Math.random() - 0.5) * 0.42;
            this.wanderTargetX = (Math.random() - 0.5) * 0.08;
            this.wanderTargetZ = (Math.random() - 0.5) * 0.03;
          }
          this.wanderNextChange = t + 2.5 + Math.random() * 3.5;
        }

        const idleSwayY = s === 'IDLE' ? Math.sin(t * 0.6) * 0.015 : 0;
        const idleSwayX = s === 'IDLE' ? Math.sin(t * 1.1) * 0.008 : 0;

        const ty = this.wanderTargetY + idleSwayY;
        const tx = this.wanderTargetX + idleSwayX;
        const tz = this.wanderTargetZ;

        const smoothRate = 1.8;
        this.rig.rotation.y = lerp(this.rig.rotation.y, ty, 1 - Math.exp(-dt * smoothRate));
        this.rig.rotation.x = lerp(this.rig.rotation.x, tx, 1 - Math.exp(-dt * smoothRate));
        this.rig.rotation.z = lerp(this.rig.rotation.z, tz, 1 - Math.exp(-dt * smoothRate));

        const breathAmp = s === 'IDLE' ? 0.006 : 0.003;
        const breath = 1 + Math.sin(t * 1.4) * breathAmp;
        this.rig.scale.setScalar(breath);
        this.rig.position.y = Math.sin(t * 1.4) * 0.010 + 0.08;
      }
    }

    // Mimik ketawa (mata sipit & wajah nyengir)
    if (this.laughTimer > 0) {
      this.laughTimer -= dt;
      this.squintTarget = 0.85;
      this.grinTarget = 0.95;
      // Getaran tawa halus di kepala ("hehehe")
      this.rig.rotation.x += Math.sin(t * 24) * 0.014 * Math.min(1, this.laughTimer);
      this.rig.position.y += Math.sin(t * 24) * 0.005 * Math.min(1, this.laughTimer);
    } else if (!this.isMoshing) {
      this.squintTarget = lerp(this.squintTarget, 0, dt * 3.0);
      this.grinTarget = lerp(this.grinTarget, 0, dt * 3.0);
    }

    this.grin = lerp(this.grin, this.grinTarget, 1 - Math.exp(-dt * 8));
    this.squint = lerp(this.squint, this.squintTarget, 1 - Math.exp(-dt * 8));

    // Warna & cahaya per state
    let wire = BLUE, eye = GREEN, glow = 1.4, opacity = 0.52;
    if (s === 'IDLE') {
      eye = GREEN;
      glow = 1.3;
      opacity = 0.50;
    }
    if (s === 'LISTENING') {
      eye = GREEN_BRIGHT;
      glow = 1.6;
      opacity = 0.56;
    }
    if (s === 'THINKING') {
      wire = BLUE.clone().lerp(AMBER, 0.3 + 0.3 * Math.sin(t * 5));
      eye = GREEN;
      glow = 0.9;
      opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 5));
    }
    if (s === 'SPEAKING') {
      eye = GREEN_BRIGHT;
      glow = 1.6 + this.mouth * 1.1;
      opacity = 0.58;
    }
    if (this.isMoshing) {
      wire = new THREE.Color(0xff0088).lerp(BLUE_BRIGHT, 0.5 + 0.5 * Math.sin(t * 8.6));
      eye = GREEN_BRIGHT;
      glow = 1.8 + Math.sin(t * 8.6) * 0.5;
      opacity = 0.65;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.wireColor.lerp(wire, k);
    this.eyeColor.lerp(eye, k);
    this.eyeGlow = lerp(this.eyeGlow, glow, k);
    this.head.setColors(this.wireColor, this.eyeColor, this.eyeGlow);
    this.head.setWireOpacity(opacity);

    if (this.isMoshing) {
      this.bloom.strength = 0.45 + Math.sin(t * 8.6) * 0.12;
    } else {
      this.bloom.strength = 0.38 + (s === 'SPEAKING' ? this.mouth * 0.20 : 0) + (s === 'THINKING' ? 0.12 : 0);
    }

    // Kedip: acak, terpengaruh mata sipit
    this.blinkT += dt;
    let blink = 0;
    if (this.blinkT > this.nextBlink) {
      const p = (this.blinkT - this.nextBlink) / 0.15;
      blink = p < 1 ? Math.sin(p * Math.PI) : 0;
      if (p >= 1) {
        this.blinkT = 0;
        this.nextBlink = s === 'THINKING' ? 0.3 + Math.random() * 0.5 : 2.5 + Math.random() * 4;
      }
    }
    this.head.setBlink(blink, this.squint);

    // Alis dinamis manusiawi (gerakan intonasi saat bicara, ekspresi mikir, dan ketawa)
    if (this.head.setBrows) {
      if (s === 'SPEAKING') {
        const browPulse = Math.sin(t * 3.6) * 0.014 + (this.mouth > 0.35 ? 0.010 : 0);
        const browAsym = Math.sin(t * 1.8) * 0.004;
        this.head.setBrows(browPulse + browAsym, browPulse - browAsym * 0.6, browAsym * 1.2, -browAsym * 0.8);
      } else if (s === 'THINKING') {
        const furrow = -0.010 + Math.sin(t * 2.5) * 0.003;
        this.head.setBrows(furrow, furrow, -0.05, 0.05);
      } else if (this.laughTimer > 0 || this.grin > 0.25) {
        const happyLift = 0.014 + this.grin * 0.008;
        this.head.setBrows(happyLift, happyLift);
      } else {
        this.head.setBrows(0, 0);
      }
    }

    // Tatapan mata dinamis & mikro-lirikan (micro-saccades) seperti manusia
    const saccadeT = t * 0.8;
    const lookX = Math.sin(saccadeT) > 0.75 ? 0.0035 : (Math.sin(saccadeT) < -0.75 ? -0.0035 : 0);
    const lookY = Math.sin(saccadeT * 1.4) * 0.002;
    // Saat berbicara presentasi, tatapan mata ikut menyapa sudut audiens yang sedang dilihat
    const presenterEyeX = s === 'SPEAKING' ? clamp(this.speechYawZone * 0.012, -0.004, 0.004) : 0;
    const finalLookX = lookX + presenterEyeX;

    for (const eyeGroup of this.head.eyes || []) {
      if (eyeGroup.children[1]) {
        eyeGroup.children[1].position.x = lerp(eyeGroup.children[1].position.x, finalLookX, 0.12);
        eyeGroup.children[1].position.y = lerp(eyeGroup.children[1].position.y, lookY, 0.12);
      }
      if (eyeGroup.children[2]) {
        eyeGroup.children[2].position.x = lerp(eyeGroup.children[2].position.x, finalLookX, 0.12);
        eyeGroup.children[2].position.y = lerp(eyeGroup.children[2].position.y, lookY, 0.12);
      }
    }

    // Lip-sync & artikulasi rahang / senyum nyengir
    const target = s === 'SPEAKING' ? this.mouthTarget : 0;
    const rate = target > this.mouth ? 26 : 14;
    this.mouth = lerp(this.mouth, target, 1 - Math.exp(-dt * rate));
    if (this.mouth < 0.002) this.mouth = 0;
    this.head.setMouth(this.mouth, this.grin);

    this.composer.render();
  }
}
