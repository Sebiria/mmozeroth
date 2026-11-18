// Rendu logiciel d'un modèle M2 en image vue de 3/4 (caméra orthographique inclinée de 30°, comme la carte isométrique).
import type { Image } from "./blp.ts";
import type { M2, Mat } from "./m2.ts";

const ELEV = (30 * Math.PI) / 180;
const SIN_E = Math.sin(ELEV), COS_E = Math.cos(ELEV);
const SS = 2; // sur-échantillonnage pour des bords lisses

export interface Model {
  m: M2;
  textures: (Image | null)[]; // une par texture du modèle
  submeshes: Set<number>; // indices des sous-maillages affichés
}

// Sommets déformés par les os, puis projetés : x écran, y écran (vers le bas), profondeur, lumière.
export function project(model: Model, mats: Mat[], yaw: number, pxPerUnit: number): Float64Array {
  const { m } = model;
  const out = new Float64Array(m.vertices.length * 4);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const L = [-0.5, 0.6, 0.62]; // lumière venant de l'avant-gauche, en hauteur (repère caméra)
  m.vertices.forEach((v, i) => {
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = v.weights[k];
      if (!w) continue;
      const M = mats[v.bones[k]];
      if (!M) continue;
      const [x, y, z] = v.pos, [a, b, c] = v.normal;
      px += w * (M[0] * x + M[4] * y + M[8] * z + M[12]);
      py += w * (M[1] * x + M[5] * y + M[9] * z + M[13]);
      pz += w * (M[2] * x + M[6] * y + M[10] * z + M[14]);
      nx += w * (M[0] * a + M[4] * b + M[8] * c);
      ny += w * (M[1] * a + M[5] * b + M[9] * c);
      nz += w * (M[2] * a + M[6] * b + M[10] * c);
      wsum += w;
    }
    if (!wsum) [px, py, pz, nx, ny, nz, wsum] = [...v.pos, ...v.normal, 1];
    px /= wsum; py /= wsum; pz /= wsum;
    // Rotation autour de la verticale : le modèle regarde vers +x, la caméra regarde vers +x' en plongée.
    const x2 = px * cy - py * sy, y2 = px * sy + py * cy;
    const nx2 = nx * cy - ny * sy, ny2 = nx * sy + ny * cy;
    out[i * 4] = -y2 * pxPerUnit * SS;
    out[i * 4 + 1] = -(x2 * SIN_E + pz * COS_E) * pxPerUnit * SS;
    out[i * 4 + 2] = x2 * COS_E - pz * SIN_E; // plus grand = plus loin
    // Normale dans le repère caméra : droite = −y', haut = x' sin + z cos, vers la caméra = −(x' cos − z sin)
    const nr = -ny2, nu = nx2 * SIN_E + nz * COS_E, nf = -(nx2 * COS_E - nz * SIN_E);
    const len = Math.hypot(nr, nu, nf) || 1;
    const d = (nr * L[0] + nu * L[1] + nf * L[2]) / len;
    out[i * 4 + 3] = 0.55 + 0.65 * Math.max(0, d);
  });
  return out;
}

// Rectangle (en pixels sur-échantillonnés) couvert par les triangles visibles.
export function bounds(model: Model, p: Float64Array, acc: number[]) {
  for (const b of model.m.batches) {
    if (!model.submeshes.has(b.submesh) || b.blend >= 3) continue;
    const s = model.m.submeshes[b.submesh];
    for (let i = s.triStart; i < s.triStart + s.triCount; i++) {
      const v = model.m.indices[i];
      acc[0] = Math.min(acc[0], p[v * 4]); acc[1] = Math.min(acc[1], p[v * 4 + 1]);
      acc[2] = Math.max(acc[2], p[v * 4]); acc[3] = Math.max(acc[3], p[v * 4 + 1]);
    }
  }
}

// Dessine dans une image de w × h pixels (taille finale), le point (ox, oy) de l'image correspondant à l'origine du modèle.
export function draw(model: Model, p: Float64Array, w: number, h: number, ox: number, oy: number): Uint8Array {
  const W = w * SS, H = h * SS;
  const color = new Float32Array(W * H * 4);
  const depth = new Float32Array(W * H).fill(Infinity);
  const { m } = model;
  // Opaques et découpés d'abord, transparents ensuite ; les effets additifs (lueurs) sont ignorés.
  const batches = m.batches
    .filter((b) => model.submeshes.has(b.submesh) && b.blend < 3)
    .sort((a, b) => (a.blend >= 2 ? 1 : 0) - (b.blend >= 2 ? 1 : 0) || a.priority - b.priority);
  for (const b of batches) {
    const tex = model.textures[b.texture];
    const s = m.submeshes[b.submesh];
    const blend = b.blend >= 2;
    for (let t = s.triStart; t + 2 < s.triStart + s.triCount; t += 3) {
      const i0 = m.indices[t], i1 = m.indices[t + 1], i2 = m.indices[t + 2];
      const x0 = p[i0 * 4] + ox * SS, y0 = p[i0 * 4 + 1] + oy * SS;
      const x1 = p[i1 * 4] + ox * SS, y1 = p[i1 * 4 + 1] + oy * SS;
      const x2 = p[i2 * 4] + ox * SS, y2 = p[i2 * 4 + 1] + oy * SS;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!area) continue; // les faces arrière sont cachées par la profondeur
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const uv0 = m.vertices[i0].uv, uv1 = m.vertices[i1].uv, uv2 = m.vertices[i2].uv;
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
          const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * p[i0 * 4 + 2] + w1 * p[i1 * 4 + 2] + w2 * p[i2 * 4 + 2];
          const o = y * W + x;
          if (z >= depth[o]) continue;
          let r = 200, g = 200, bl = 200, a = 255;
          if (tex) {
            const u = w0 * uv0[0] + w1 * uv1[0] + w2 * uv2[0], v = w0 * uv0[1] + w1 * uv1[1] + w2 * uv2[1];
            const tx = ((Math.floor(u * tex.width) % tex.width) + tex.width) % tex.width;
            const ty = ((Math.floor(v * tex.height) % tex.height) + tex.height) % tex.height;
            const q = (ty * tex.width + tx) * 4;
            r = tex.data[q]; g = tex.data[q + 1]; bl = tex.data[q + 2]; a = tex.data[q + 3];
          }
          // Découpe : les textures à transparence binaire (feuilles, crins) sont coupées à mi-hauteur.
          if (b.blend === 1 && a < 128) continue;
          if (!blend && b.blend === 0) a = 255;
          if (blend && a < 8) continue;
          const light = w0 * p[i0 * 4 + 3] + w1 * p[i1 * 4 + 3] + w2 * p[i2 * 4 + 3];
          const k = blend ? a / 255 : 1;
          const c = o * 4;
          color[c] = color[c] * (1 - k) + Math.min(255, r * light) * k;
          color[c + 1] = color[c + 1] * (1 - k) + Math.min(255, g * light) * k;
          color[c + 2] = color[c + 2] * (1 - k) + Math.min(255, bl * light) * k;
          color[c + 3] = Math.max(color[c + 3], blend ? a : 255);
          if (!blend) depth[o] = z;
        }
    }
  }
  // Réduction : moyenne de SS × SS pixels, en tenant compte de la transparence
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) {
          const c = ((y * SS + j) * W + x * SS + i) * 4;
          const al = color[c + 3];
          r += color[c] * al; g += color[c + 1] * al; b += color[c + 2] * al; a += al;
        }
      const o = (y * w + x) * 4;
      if (a) {
        out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a;
        out[o + 3] = a / (SS * SS);
      }
    }
  return out;
}
