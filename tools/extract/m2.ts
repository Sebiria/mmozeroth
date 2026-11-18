// Lecture des modèles 3D du client 3.3.5a (format M2, version 264) : sommets, os, animations et sous-maillages (fichier .skin).
// Les animations peuvent être rangées dans des fichiers .anim à part.
import type { MpqStack } from "./mpq.ts";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

interface Track<T> {
  globalSeq: number;
  times: Uint32Array[]; // une liste par animation
  values: T[][];
}

export interface Bone {
  parent: number;
  pivot: Vec3;
  flags: number;
  translation: Track<Vec3>;
  rotation: Track<Quat>;
  scale: Track<Vec3>;
}

export interface Sequence {
  id: number;
  variation: number;
  duration: number;
  flags: number;
  alias: number;
}

export interface Submesh {
  id: number; // groupe × 100 + variante (0 = corps)
  triStart: number;
  triCount: number;
}

export interface Batch {
  submesh: number;
  texture: number; // indice dans textures
  blend: number; // 0 opaque, 1 découpe, 2 transparent, 3 et plus : additif
  flags: number;
  priority: number;
}

export interface M2 {
  vertices: { pos: Vec3; normal: Vec3; uv: [number, number]; bones: number[]; weights: number[] }[];
  bones: Bone[];
  sequences: Sequence[];
  globalSeqs: number[];
  textures: { type: number; name: string }[];
  indices: number[]; // triangles, en numéros de sommets du modèle
  submeshes: Submesh[];
  batches: Batch[];
}

export function loadM2(mpq: MpqStack, path: string): M2 | null {
  const file = path.replace(/\.(mdx|mdl)$/i, ".m2");
  const raw = mpq.readFile(file);
  if (!raw || raw.toString("latin1", 0, 4) !== "MD20") return null;
  const b: Buffer = raw;
  const u32 = (o: number) => b.readUInt32LE(o);
  const arr = (o: number) => ({ n: u32(o), ofs: u32(o + 4) });

  const globalSeqs: number[] = [];
  { const a = arr(20); for (let i = 0; i < a.n; i++) globalSeqs.push(u32(a.ofs + i * 4)); }

  const sequences: Sequence[] = [];
  { const a = arr(28);
    for (let i = 0; i < a.n; i++) {
      const o = a.ofs + i * 64;
      sequences.push({ id: b.readUInt16LE(o), variation: b.readUInt16LE(o + 2), duration: u32(o + 4), flags: u32(o + 12), alias: b.readUInt16LE(o + 62) });
    } }

  // Données d'animation rangées à part : un fichier .anim par animation qui n'a pas le drapeau 0x20.
  const base = file.replace(/\.m2$/i, "");
  const external = sequences.map((s) =>
    s.flags & 0x20 ? null : mpq.readFile(`${base}${String(s.id).padStart(4, "0")}-${String(s.variation).padStart(2, "0")}.anim`),
  );

  function track<T>(o: number, size: number, read: (buf: Buffer, at: number) => T): Track<T> {
    const globalSeq = b.readInt16LE(o + 2);
    const ts = arr(o + 4), vs = arr(o + 12);
    const times: Uint32Array[] = [], values: T[][] = [];
    for (let i = 0; i < ts.n; i++) {
      const t = arr(ts.ofs + i * 8), v = arr(vs.ofs + i * 8);
      // Dans le modèle, sauf pour une animation rangée à part (sans drapeau 0x20) : son .anim, ou rien s'il manque.
      const outside = globalSeq < 0 && i < sequences.length && !(sequences[i].flags & 0x20);
      const src = outside ? external[i] : b;
      if (!src || t.n === 0) {
        times.push(new Uint32Array(0));
        values.push([]);
        continue;
      }
      const tt = new Uint32Array(t.n);
      for (let k = 0; k < t.n; k++) tt[k] = src.readUInt32LE(t.ofs + k * 4);
      const vv: T[] = [];
      for (let k = 0; k < v.n; k++) vv.push(read(src, v.ofs + k * size));
      times.push(tt);
      values.push(vv);
    }
    return { globalSeq, times, values };
  }
  const vec3 = (buf: Buffer, at: number): Vec3 => [buf.readFloatLE(at), buf.readFloatLE(at + 4), buf.readFloatLE(at + 8)];
  const short = (v: number) => (v < 0 ? v + 32768 : v - 32767) / 32767;
  const quat = (buf: Buffer, at: number): Quat => [short(buf.readInt16LE(at)), short(buf.readInt16LE(at + 2)), short(buf.readInt16LE(at + 4)), short(buf.readInt16LE(at + 6))];

  const bones: Bone[] = [];
  { const a = arr(44);
    for (let i = 0; i < a.n; i++) {
      const o = a.ofs + i * 88;
      bones.push({
        flags: u32(o + 4),
        parent: b.readInt16LE(o + 8),
        translation: track(o + 16, 12, vec3),
        rotation: track(o + 36, 8, quat),
        scale: track(o + 56, 12, vec3),
        pivot: vec3(b, o + 76),
      });
    } }

  const vertices: M2["vertices"] = [];
  { const a = arr(60);
    for (let i = 0; i < a.n; i++) {
      const o = a.ofs + i * 48;
      vertices.push({
        pos: vec3(b, o),
        weights: [b[o + 12], b[o + 13], b[o + 14], b[o + 15]],
        bones: [b[o + 16], b[o + 17], b[o + 18], b[o + 19]],
        normal: vec3(b, o + 20),
        uv: [b.readFloatLE(o + 32), b.readFloatLE(o + 36)],
      });
    } }

  const textures: M2["textures"] = [];
  { const a = arr(80);
    for (let i = 0; i < a.n; i++) {
      const o = a.ofs + i * 16;
      const len = u32(o + 8), ofs = u32(o + 12);
      textures.push({ type: u32(o), name: len ? b.toString("latin1", ofs, ofs + len - 1) : "" });
    } }
  const renderFlags: { flags: number; blend: number }[] = [];
  { const a = arr(112); for (let i = 0; i < a.n; i++) renderFlags.push({ flags: b.readUInt16LE(a.ofs + i * 4), blend: b.readUInt16LE(a.ofs + i * 4 + 2) }); }
  const texLookup: number[] = [];
  { const a = arr(128); for (let i = 0; i < a.n; i++) texLookup.push(b.readInt16LE(a.ofs + i * 2)); }

  // Sous-maillages : premier niveau de détail (fichier 00.skin)
  const skin = mpq.readFile(`${base}00.skin`);
  if (!skin) return null;
  const sa = (o: number) => ({ n: skin.readUInt32LE(o), ofs: skin.readUInt32LE(o + 4) });
  const lookup = sa(4), tris = sa(12), subs = sa(28), units = sa(36);
  const indices: number[] = [];
  for (let i = 0; i < tris.n; i++) indices.push(skin.readUInt16LE(lookup.ofs + skin.readUInt16LE(tris.ofs + i * 2) * 2));
  const submeshes: Submesh[] = [];
  for (let i = 0; i < subs.n; i++) {
    const o = subs.ofs + i * 48;
    submeshes.push({ id: skin.readUInt16LE(o), triStart: skin.readUInt16LE(o + 8) + (skin.readUInt16LE(o + 2) << 16), triCount: skin.readUInt16LE(o + 10) });
  }
  const batches: Batch[] = [];
  for (let i = 0; i < units.n; i++) {
    const o = units.ofs + i * 24;
    const rf = renderFlags[skin.readUInt16LE(o + 10)] ?? { flags: 0, blend: 0 };
    batches.push({
      priority: skin.readInt8(o + 1),
      submesh: skin.readUInt16LE(o + 4),
      texture: texLookup[skin.readUInt16LE(o + 16)] ?? 0,
      blend: rf.blend,
      flags: rf.flags,
    });
  }
  return { vertices, bones, sequences, globalSeqs, textures, indices, submeshes, batches };
}

// --- Pose d'un squelette à un instant donné ---
function sample<T>(tr: Track<T>, anim: number, time: number, globalSeqs: number[], lerp: (a: T, b: T, k: number) => T, dflt: T): T {
  let a = anim, t = time;
  if (tr.globalSeq >= 0) {
    a = 0;
    t = globalSeqs[tr.globalSeq] ? time % globalSeqs[tr.globalSeq] : 0;
  }
  const times = tr.times[a], values = tr.values[a];
  if (!times || !times.length || !values.length) return dflt;
  if (times.length === 1 || t <= times[0]) return values[0];
  if (t >= times[times.length - 1]) return values[values.length - 1];
  let i = 1;
  while (times[i] < t) i++;
  const k = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
  return lerp(values[i - 1], values[i], k);
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function nlerp(a: Quat, b: Quat, k: number): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  const q: Quat = [a[0] + (s * b[0] - a[0]) * k, a[1] + (s * b[1] - a[1]) * k, a[2] + (s * b[2] - a[2]) * k, a[3] + (s * b[3] - a[3]) * k];
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

// Matrices 4 × 4 en colonnes (comme OpenGL), stockées dans des tableaux de 16 nombres.
export type Mat = Float64Array;
function mul(a: Mat, b: Mat): Mat {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
    r[c * 4 + row] = s;
  }
  return r;
}
function trs(t: Vec3, q: Quat, s: Vec3, p: Vec3): Mat {
  const [x, y, z, w] = q;
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  const m = new Float64Array(16);
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) m[c * 4 + row] = r[c * 3 + row] * s[c];
  // M = T(p) · T(t) · R · S · T(−p)
  for (let row = 0; row < 3; row++) m[12 + row] = p[row] + t[row] - (m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2]);
  m[15] = 1;
  return m;
}

export function pose(m: M2, anim: number, time: number): Mat[] {
  const out: Mat[] = [];
  m.bones.forEach((bone, i) => {
    const t = sample(bone.translation, anim, time, m.globalSeqs, lerp3, [0, 0, 0]);
    const q = sample(bone.rotation, anim, time, m.globalSeqs, nlerp, [0, 0, 0, 1]);
    const s = sample(bone.scale, anim, time, m.globalSeqs, lerp3, [1, 1, 1]);
    const local = trs(t, q, s, bone.pivot);
    out[i] = bone.parent >= 0 && bone.parent < i ? mul(out[bone.parent], local) : local;
  });
  return out;
}

// Indice de la première animation ayant ce numéro (0 attente, 4 marche, 16 attaque à mains nues, 1 mort…).
export function findSequence(m: M2, ids: number[]): number {
  for (const id of ids) {
    let i = m.sequences.findIndex((s) => s.id === id);
    if (i < 0) continue;
    // Les alias renvoient vers une autre animation
    for (let guard = 0; m.sequences[i].flags & 0x40 && guard < 8; guard++) i = m.sequences[i].alias;
    return i;
  }
  return -1;
}
