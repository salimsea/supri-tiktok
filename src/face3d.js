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
const JAW_MAX = 0.28; // radian

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
    const top = sculpt(new THREE.Vector3(0, MOUTH_Y, Math.sqrt(Math.max(0, 1 - MOUTH_Y ** 2))));
    this.mouthCavity.position.set(0, top.y - open * 0.045, top.z - 0.003);
    this.mouthCavity.scale.set(0.12, Math.max(0.001, open * 0.065), 1);
    this.mouthCavity.visible = open > 0.03;
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

  setBlink(amount) {
    for (const eyeGroup of this.eyes) eyeGroup.scale.y = 1 - amount * 0.92;
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
        const inLeftEye = vWorld.every((v) => v.px < -0.17 && v.px > -0.34 && v.py > 0.055 && v.py < 0.145 && v.pz > 0.54);
        const inRightEye = vWorld.every((v) => v.px > 0.17 && v.px < 0.34 && v.py > 0.055 && v.py < 0.145 && v.pz > 0.54);

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
      const inEye = Math.abs(px) > 0.16 && Math.abs(px) < 0.34 && py > 0.04 && py < 0.16 && pz > 0.50;
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

    // Posisi soket mata LeePerrySmith (simetris di depan permukaan mata)
    const eyeConfigs = [
      { side: -1, x: -0.265, y: 0.096, z: 0.640, rotY: 0.06 },
      { side: 1, x: 0.265, y: 0.096, z: 0.640, rotY: -0.06 },
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

      // 5. Kontur kelopak mata almond hijau zamrud tegas
      const lidPts = [];
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * 2 - 1;
        const lx = t * 0.076;
        const ly = (1 - t * t) * (i <= N / 2 ? 0.034 : -0.024);
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

    // 2. Alis (lengkungan di atas mata)
    const browPtsL = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = -0.08 - t * 0.30;
      const y = 0.18 + Math.sin(t * Math.PI) * 0.035 - t * 0.015;
      const z = 0.65 - t * 0.14;
      browPtsL.push(new THREE.Vector3(x, y, z + 0.010));
    }
    const browLineL = new THREE.Line(new THREE.BufferGeometry().setFromPoints(browPtsL), this.browLineMat);

    const browPtsR = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = 0.08 + t * 0.30;
      const y = 0.18 + Math.sin(t * Math.PI) * 0.035 - t * 0.015;
      const z = 0.65 - t * 0.14;
      browPtsR.push(new THREE.Vector3(x, y, z + 0.010));
    }
    const browLineR = new THREE.Line(new THREE.BufferGeometry().setFromPoints(browPtsR), this.browLineMat);
    this.group.add(browLineL, browLineR);

    // 3. Kontur & Bentuk Bibir Cyber Realistis (Presisi 1:1 Mengikuti Topologi Wajah)
    this.lipLineMat = new THREE.LineBasicMaterial({
      color: BLUE_BRIGHT.clone(),
      transparent: true,
      opacity: 0.96,
      depthTest: false,
    });
    this.lipFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x1888dd),
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.lipSeamMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0x0a4070),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });

    // Spline kurva bibir atas (Cupid's bow tajam & pas di model)
    const topControlPoints = [
      new THREE.Vector3(-0.160, -0.320, 0.758),
      new THREE.Vector3(-0.090, -0.286, 0.816),
      new THREE.Vector3(-0.038, -0.272, 0.838),
      new THREE.Vector3(0.000, -0.283, 0.830),
      new THREE.Vector3(0.038, -0.272, 0.838),
      new THREE.Vector3(0.090, -0.286, 0.816),
      new THREE.Vector3(0.160, -0.320, 0.758),
    ];
    const topCurve = new THREE.CatmullRomCurve3(topControlPoints);
    const topPts = topCurve.getPoints(24);
    topPts.forEach((p) => (p.z += 0.004));

    // Spline celah tengah pertemuan bibir atas dan bawah
    const seamControlPoints = [
      new THREE.Vector3(-0.160, -0.320, 0.758),
      new THREE.Vector3(-0.080, -0.320, 0.802),
      new THREE.Vector3(0.000, -0.325, 0.816),
      new THREE.Vector3(0.080, -0.320, 0.802),
      new THREE.Vector3(0.160, -0.320, 0.758),
    ];
    const seamCurve = new THREE.CatmullRomCurve3(seamControlPoints);
    const seamPts = seamCurve.getPoints(24);
    seamPts.forEach((p) => (p.z += 0.005));

    // Spline kurva bawah bibir bawah
    const botControlPoints = [
      new THREE.Vector3(-0.160, -0.320, 0.758),
      new THREE.Vector3(-0.090, -0.356, 0.806),
      new THREE.Vector3(0.000, -0.366, 0.824),
      new THREE.Vector3(0.090, -0.356, 0.806),
      new THREE.Vector3(0.160, -0.320, 0.758),
    ];
    const botCurve = new THREE.CatmullRomCurve3(botControlPoints);
    const botPts = botCurve.getPoints(24);
    botPts.forEach((p) => (p.z += 0.004));

    // Bangun mesh volume bibir atas
    const upperGeo = new THREE.BufferGeometry();
    const upperPos = [];
    const upperIdx = [];
    for (let i = 0; i <= 24; i++) {
      upperPos.push(topPts[i].x, topPts[i].y, topPts[i].z);
      upperPos.push(seamPts[i].x, seamPts[i].y, seamPts[i].z);
      if (i < 24) {
        const base = i * 2;
        upperIdx.push(base, base + 1, base + 2);
        upperIdx.push(base + 1, base + 3, base + 2);
      }
    }
    upperGeo.setAttribute('position', new THREE.Float32BufferAttribute(upperPos, 3));
    upperGeo.setIndex(upperIdx);
    const upperMesh = new THREE.Mesh(upperGeo, this.lipFillMat);
    upperMesh.renderOrder = 96;

    // Garis kontur bibir atas & celah bibir
    this.upperLipLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts), this.lipLineMat);
    this.upperLipLine.renderOrder = 98;
    this.lipSeamLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(seamPts), this.lipSeamMat);
    this.lipSeamLine.renderOrder = 97;
    this.group.add(upperMesh, this.upperLipLine, this.lipSeamLine);

    // Grup bibir bawah (bergerak dinamis bersama rahang saat bicara)
    this.lowerLipGroup = new THREE.Group();

    // Mesh volume bibir bawah
    const lowerGeo = new THREE.BufferGeometry();
    const lowerPos = [];
    const lowerIdx = [];
    for (let i = 0; i <= 24; i++) {
      lowerPos.push(seamPts[i].x, seamPts[i].y, seamPts[i].z);
      lowerPos.push(botPts[i].x, botPts[i].y, botPts[i].z);
      if (i < 24) {
        const base = i * 2;
        lowerIdx.push(base, base + 1, base + 2);
        lowerIdx.push(base + 1, base + 3, base + 2);
      }
    }
    lowerGeo.setAttribute('position', new THREE.Float32BufferAttribute(lowerPos, 3));
    lowerGeo.setIndex(lowerIdx);
    const lowerMesh = new THREE.Mesh(lowerGeo, this.lipFillMat);
    lowerMesh.renderOrder = 96;

    this.lowerLipLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(botPts), this.lipLineMat);
    this.lowerLipLine.renderOrder = 98;
    this.lowerLipGroup.add(lowerMesh, this.lowerLipLine);
    this.group.add(this.lowerLipGroup);

    // 4. Rongga mulut gelap pekat saat berbicara (mangap ada hitam-hitam)
    this.mouthCavity = new THREE.Mesh(
      new THREE.CircleGeometry(0.11, 28),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    this.mouthCavity.position.set(0, -0.324, 0.795);
    this.mouthCavity.scale.set(1.4, 0.001, 1);
    this.mouthCavity.renderOrder = 95;
    this.mouthCavity.visible = false;
    this.group.add(this.mouthCavity);

    // 5. Gigi cyber pearl white di dalam rongga mulut
    const teethMat = new THREE.LineBasicMaterial({ color: 0xe8f4ff, linewidth: 2, depthTest: false });
    const uTeethPts = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * 2 - 1;
      const x = t * 0.105;
      const y = -0.320 - (t * t) * 0.005;
      const z = 0.798 - (t * t) * 0.035;
      uTeethPts.push(new THREE.Vector3(x, y, z));
    }
    this.upperTeeth = new THREE.Line(new THREE.BufferGeometry().setFromPoints(uTeethPts), teethMat);
    this.upperTeeth.renderOrder = 96;
    this.upperTeeth.visible = false;
    this.group.add(this.upperTeeth);

    const lTeethPts = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * 2 - 1;
      const x = t * 0.095;
      const y = -0.334 + (t * t) * 0.004;
      const z = 0.790 - (t * t) * 0.035;
      lTeethPts.push(new THREE.Vector3(x, y, z));
    }
    this.lowerTeeth = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lTeethPts), teethMat);
    this.lowerTeeth.renderOrder = 96;
    this.lowerTeeth.visible = false;
    this.lowerLipGroup.add(this.lowerTeeth);
  }

  setMouth(open) {
    if (this.morphs.length > 0) {
      for (const [m, i] of this.morphs) m.morphTargetInfluences[i] = open;
    }
    if (this.jawWeights && this.jawWeights.length > 0) {
      if (Math.abs(open - (this.lastOpen ?? -1)) < 0.003) return;
      this.lastOpen = open;
      const pos = this.geo.attributes.position;
      const v = new THREE.Vector3();
      const out = new THREE.Vector3();
      for (const [i, w] of this.jawWeights) {
        v.set(this.basePos[i * 3], this.basePos[i * 3 + 1], this.basePos[i * 3 + 2]);
        rotateAroundPivot(v, open * 0.22 * w, out, this.jawPivot);
        pos.setXYZ(i, out.x, out.y, out.z);
      }
      pos.needsUpdate = true;

      // Gerakkan bibir bawah turun saat rahang terbuka
      if (this.lowerLipGroup) {
        this.lowerLipGroup.position.y = -open * 0.048;
      }

      // Rongga mulut hitam tampak saat mulut membuka ("mangap ada hitam-hitam")
      if (this.mouthCavity) {
        this.mouthCavity.scale.set(1.35, Math.max(0.001, open * 0.42), 1);
        this.mouthCavity.position.y = -0.324 - open * 0.024;
        this.mouthCavity.visible = open > 0.025;
      }
      if (this.upperTeeth) this.upperTeeth.visible = open > 0.035;
      if (this.lowerTeeth) this.lowerTeeth.visible = open > 0.035;
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

  setBlink(amount) {
    if (this.blinks && this.blinks.length > 0) {
      for (const [m, i] of this.blinks) if (i !== undefined) m.morphTargetInfluences[i] = amount;
    }
    for (const eyeGroup of this.eyes) {
      eyeGroup.scale.y = Math.max(0.02, 1 - amount * 0.96);
    }
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

    // Gerakan pandangan acak alami (autonomous natural wander)
    this.wanderTargetY = 0;
    this.wanderTargetX = 0;
    this.wanderTargetZ = 0;
    this.wanderNextChange = 1.5;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 0.08, 6.5);

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
    const w = innerWidth,
      h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    // Jaga kepala tetap muat di layar sempit (portrait).
    this.camera.position.z = w / h < 0.9 ? (6.5 / Math.max(w / h, 0.5)) * 0.85 : 6.5;
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

    // Gerakan otonom alami:
    // Saat SPEAKING: wajib hadap lurus ke tengah (center), plus anggukan artikulasi bicara halus
    // Saat IDLE / LISTENING: sesekali menoleh santai ke kiri/kanan secara acak, lalu kembali ke tengah
    if (s === 'SPEAKING') {
      this.wanderTargetY = 0;
      this.wanderTargetX = 0;
      this.wanderTargetZ = 0;
      // Kunci tetap di tengah selama bicara dan 2 detik setelah selesai bicara
      this.wanderNextChange = t + 2.0;
    } else {
      if (t > this.wanderNextChange) {
        // 45% peluang kembali ke tepat tengah, 55% menoleh santai kiri atau kanan
        if (Math.random() < 0.45) {
          this.wanderTargetY = 0;
          this.wanderTargetX = (Math.random() - 0.5) * 0.04;
          this.wanderTargetZ = 0;
        } else {
          // Lirik kiri/kanan acak alami (-12 sampai +12 derajat)
          this.wanderTargetY = (Math.random() - 0.5) * 0.42;
          this.wanderTargetX = (Math.random() - 0.5) * 0.08;
          this.wanderTargetZ = (Math.random() - 0.5) * 0.03;
        }
        this.wanderNextChange = t + 2.5 + Math.random() * 3.5;
      }
    }

    // Mikro-gerakan pernapasan dan artikulasi suara
    const speechNod = s === 'SPEAKING' ? Math.sin(t * 6.5) * 0.018 * this.mouth : 0;
    const idleSwayY = s === 'IDLE' ? Math.sin(t * 0.6) * 0.015 : 0;
    const idleSwayX = s === 'IDLE' ? Math.sin(t * 1.1) * 0.008 : 0;

    const ty = this.wanderTargetY + idleSwayY;
    const tx = this.wanderTargetX + speechNod + idleSwayX;
    const tz = this.wanderTargetZ;

    // Haluskan interpolasi rotasi (saat bicara lebih cepat mengunci ke tengah)
    const smoothRate = s === 'SPEAKING' ? 4.5 : 1.8;
    this.rig.rotation.y = lerp(this.rig.rotation.y, ty, 1 - Math.exp(-dt * smoothRate));
    this.rig.rotation.x = lerp(this.rig.rotation.x, tx, 1 - Math.exp(-dt * smoothRate));
    this.rig.rotation.z = lerp(this.rig.rotation.z, tz, 1 - Math.exp(-dt * smoothRate));

    // Napas pelan
    const breathAmp = s === 'IDLE' ? 0.006 : 0.003;
    const breath = 1 + Math.sin(t * 1.4) * breathAmp;
    this.rig.scale.setScalar(breath);
    this.rig.position.y = Math.sin(t * 1.4) * 0.010 + 0.08;

    // Warna & cahaya per state — mata hijau menyala selalu tampak jelas (sesuai gambar)
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
    const k = 1 - Math.exp(-dt * 6);
    this.wireColor.lerp(wire, k);
    this.eyeColor.lerp(eye, k);
    this.eyeGlow = lerp(this.eyeGlow, glow, k);
    this.head.setColors(this.wireColor, this.eyeColor, this.eyeGlow);
    this.head.setWireOpacity(opacity);
    this.bloom.strength = 0.38 + (s === 'SPEAKING' ? this.mouth * 0.20 : 0) + (s === 'THINKING' ? 0.12 : 0);

    // Kedip: acak, lebih sering saat THINKING
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
    this.head.setBlink(blink);

    // Lip-sync: mulut hanya bergerak saat SPEAKING
    const target = s === 'SPEAKING' ? this.mouthTarget : 0;
    const rate = target > this.mouth ? 28 : 14;
    this.mouth = lerp(this.mouth, target, 1 - Math.exp(-dt * rate));
    if (this.mouth < 0.002) this.mouth = 0;
    this.head.setMouth(this.mouth);

    this.composer.render();
  }
}
