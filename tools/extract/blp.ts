// Décodage des images du client (format BLP2) en pixels RGBA.
// Variantes prises en charge : palette 256 couleurs, DXT1, DXT3, DXT5 et BGRA brut.

export interface Image {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

// Renvoie toutes les réductions présentes (mip 0 = taille réelle, puis moitié, quart…).
export function decodeBlp(b: Buffer): Image[] {
  if (b.toString("latin1", 0, 4) !== "BLP2") throw new Error("image BLP2 attendue");
  const compression = b[8], alphaDepth = b[9], alphaType = b[10], hasMips = b[11];
  const width = b.readUInt32LE(12), height = b.readUInt32LE(16);
  const out: Image[] = [];
  for (let level = 0; level < 16; level++) {
    const ofs = b.readUInt32LE(20 + level * 4), size = b.readUInt32LE(84 + level * 4);
    if (!ofs || !size || (level > 0 && !hasMips)) break;
    const w = Math.max(1, width >> level), h = Math.max(1, height >> level);
    const src = b.subarray(ofs, ofs + size);
    let data: Uint8Array;
    if (compression === 1) data = palette(b, src, w, h, alphaDepth);
    else if (compression === 2) data = dxt(src, w, h, alphaType === 0 ? 1 : alphaType === 1 ? 3 : 5, alphaDepth);
    else if (compression === 3) data = bgra(src, w, h);
    else throw new Error(`compression BLP inconnue : ${compression}`);
    out.push({ width: w, height: h, data });
    if (w === 1 && h === 1) break;
  }
  return out;
}

function palette(b: Buffer, src: Buffer, w: number, h: number, alphaDepth: number): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = b.readUInt32LE(148 + src[i] * 4);
    out[i * 4] = (c >> 16) & 255;
    out[i * 4 + 1] = (c >> 8) & 255;
    out[i * 4 + 2] = c & 255;
    let a = 255;
    if (alphaDepth === 8) a = src[n + i];
    else if (alphaDepth === 1) a = (src[n + (i >> 3)] >> (i & 7)) & 1 ? 255 : 0;
    else if (alphaDepth === 4) a = ((src[n + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
    out[i * 4 + 3] = a;
  }
  return out;
}

function bgra(src: Buffer, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = src[i * 4 + 2];
    out[i * 4 + 1] = src[i * 4 + 1];
    out[i * 4 + 2] = src[i * 4];
    out[i * 4 + 3] = src[i * 4 + 3];
  }
  return out;
}

function rgb565(c: number): [number, number, number] {
  return [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
}

function dxt(src: Buffer, w: number, h: number, kind: 1 | 3 | 5, alphaDepth: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const blockSize = kind === 1 ? 8 : 16;
  const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
  const colors = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const alphas = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let o = (by * bw + bx) * blockSize;
      if (o + blockSize > src.length) continue;
      // Transparence du bloc
      if (kind === 3) {
        for (let i = 0; i < 16; i++) alphas[i] = ((src[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        o += 8;
      } else if (kind === 5) {
        const a0 = src[o], a1 = src[o + 1];
        const pal = [a0, a1];
        if (a0 > a1) for (let k = 1; k < 7; k++) pal.push(((7 - k) * a0 + k * a1) / 7);
        else {
          for (let k = 1; k < 5; k++) pal.push(((5 - k) * a0 + k * a1) / 5);
          pal.push(0, 255);
        }
        let bits = 0n;
        for (let k = 0; k < 6; k++) bits |= BigInt(src[o + 2 + k]) << BigInt(8 * k);
        for (let i = 0; i < 16; i++) alphas[i] = pal[Number((bits >> BigInt(3 * i)) & 7n)];
        o += 8;
      }
      // Couleurs du bloc
      const c0 = src.readUInt16LE(o), c1 = src.readUInt16LE(o + 2);
      const [r0, g0, b0] = rgb565(c0), [r1, g1, b1] = rgb565(c1);
      colors[0] = [r0, g0, b0, 255];
      colors[1] = [r1, g1, b1, 255];
      if (c0 > c1 || kind !== 1) {
        colors[2] = [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255];
        colors[3] = [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255];
      } else {
        colors[2] = [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255];
        colors[3] = [0, 0, 0, alphaDepth ? 0 : 255];
      }
      const idx = src.readUInt32LE(o + 4);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= w || y >= h) continue;
        const c = colors[(idx >> (2 * i)) & 3];
        const p = (y * w + x) * 4;
        out[p] = c[0];
        out[p + 1] = c[1];
        out[p + 2] = c[2];
        out[p + 3] = kind === 1 ? c[3] : alphas[i];
      }
    }
  }
  return out;
}
