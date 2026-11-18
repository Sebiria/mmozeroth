// Terrain de Durotar (avec Orgrimmar) tiré des fichiers de carte du client (ADT), redessiné vu de dessus.
// Une tuile du jeu = un « morceau » de carte du client (33,3 mètres de côté).
// Sorties : terrain/map.json (type de chaque tuile, noms des lieux, point de départ) et terrain/ground_*.png (sol vu de dessus).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeBlp, type Image } from "./blp.ts";
import { Dbc } from "./dbc.ts";
import type { MpqStack } from "./mpq.ts";
import { encodePng } from "./png.ts";

const DUROTAR = 14, ORGRIMMAR = 1637, GREAT_SEA = 2320, RAGEFIRE = 2437;
const CHUNK = 533.33333 / 16; // côté d'un morceau, en mètres
const QUAD = CHUNK / 8;
const PX = 32; // pixels par tuile dans l'image du sol
const PIECE = 32; // tuiles par côté d'un morceau d'image (1024 px)
const PAD = 4; // bande de mer ou de terrain voisin gardée autour de la zone
// Fenêtre de recherche dans la carte de Kalimdor (numéros de fichiers ADT), assez large pour contenir Durotar.
const SEARCH = { x0: 34, x1: 50, y0: 18, y1: 42 };
// Le client est en français : noms anglais des lieux de la zone, pour la version anglaise du jeu.
const EN_NAMES: Record<number, string> = {
  1637: "Orgrimmar", 368: "Echo Isles", 374: "Bladefist Bay", 373: "Scuttle Coast", 363: "Valley of Trials",
  393: "Darkspear Strand", 375: "Deadeye Shore", 816: "Razormane Grounds", 814: "Southfury River", 369: "Thunder Ridge",
  372: "Tiragarde Keep", 410: "Razorwind Canyon", 370: "Drygulch Ravine", 366: "Kolkar Crag", 362: "Razor Hill",
  1296: "Rocktusk Farm", 367: "Sen'jin Village", 817: "Skull Rock", 1297: "Jaggedswine Farm", 2979: "Tor'kren Farm",
  [RAGEFIRE]: "Ragefire Chasm",
};
// Points tirés d'AzerothCore (coordonnées du monde) : arrivée des orcs, entrée du Gouffre de Ragefeu.
export interface WorldPoints {
  start: { x: number; y: number };
  ragefire: { x: number; y: number };
}

interface Chunk {
  area: number;
  heights: Float32Array; // 145 valeurs (9 × 9 extérieures et 8 × 8 intérieures entremêlées), déjà ajoutées à la hauteur de base
  layers: { tex: string; alpha: Uint8Array | null }[]; // alpha : 64 × 64, de 0 à 255
  shadow: Uint8Array | null; // 64 × 64, 1 = ombre
  liquid: Float32Array | null; // 8 × 8 cases : hauteur de l'eau, NaN = pas d'eau
  ocean: boolean;
}

const tag = (b: Buffer, o: number) => b.toString("latin1", o, o + 4).split("").reverse().join("");

function readChunks(b: Buffer) {
  const map = new Map<string, number[]>();
  for (let o = 0; o + 8 <= b.length; ) {
    const id = tag(b, o), size = b.readUInt32LE(o + 4);
    map.set(id, [...(map.get(id) ?? []), o]);
    o += 8 + size;
  }
  return map;
}

function alphaMap(b: Buffer, at: number, flags: number, big: boolean, fix: boolean): Uint8Array {
  const out = new Uint8Array(64 * 64);
  if (flags & 0x200) {
    // Compressé (alpha 8 bits) : suites répétées ou copiées
    let o = at, i = 0;
    while (i < 4096) {
      const c = b[o++], n = c & 0x7f;
      if (c & 0x80) {
        const v = b[o++];
        for (let k = 0; k < n && i < 4096; k++) out[i++] = v;
      } else for (let k = 0; k < n && i < 4096; k++) out[i++] = b[o++];
    }
  } else if (big) {
    b.copy(out, 0, at, at + 4096);
  } else {
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x += 2) {
        const v = b[at + y * 32 + x / 2];
        out[y * 64 + x] = (v & 15) * 17;
        out[y * 64 + x + 1] = (v >> 4) * 17;
      }
  }
  // Sans le drapeau « ne pas corriger », la dernière ligne et la dernière colonne recopient l'avant-dernière.
  if (fix) {
    for (let y = 0; y < 64; y++) out[y * 64 + 63] = out[y * 64 + 62];
    for (let x = 0; x < 64; x++) out[63 * 64 + x] = out[62 * 64 + x];
  }
  return out;
}

function parseAdt(b: Buffer, bigAlpha: boolean, oceanTypes: Set<number>): Chunk[] {
  const c = readChunks(b);
  const mtex = c.get("MTEX")![0];
  const texNames = b.toString("latin1", mtex + 8, mtex + 8 + b.readUInt32LE(mtex + 4)).split("\0");
  // Eau (format MH2O) : position donnée par l'en-tête MHDR
  const mhdr = c.get("MHDR")![0] + 8;
  const ofsMh2o = b.readUInt32LE(mhdr + 40);
  const mh2o = ofsMh2o ? mhdr + ofsMh2o + 8 : 0;
  const chunks: Chunk[] = new Array(256);
  for (const p of c.get("MCNK") ?? []) {
    const h = p + 8;
    const flags = b.readUInt32LE(h), ix = b.readUInt32LE(h + 4), iy = b.readUInt32LE(h + 8);
    const nLayers = b.readUInt32LE(h + 12);
    const ofsHeight = b.readUInt32LE(h + 20), ofsLayer = b.readUInt32LE(h + 28), ofsAlpha = b.readUInt32LE(h + 36);
    const ofsShadow = b.readUInt32LE(h + 44), sizeShadow = b.readUInt32LE(h + 48);
    const area = b.readUInt32LE(h + 52);
    const ofsLiquid = b.readUInt32LE(h + 96), sizeLiquid = b.readUInt32LE(h + 100);
    const baseZ = b.readFloatLE(h + 104 + 8);
    const heights = new Float32Array(145);
    for (let i = 0; i < 145; i++) heights[i] = baseZ + b.readFloatLE(p + ofsHeight + 8 + i * 4);
    const layers: Chunk["layers"] = [];
    const fix = !(flags & 0x8000);
    for (let l = 0; l < nLayers; l++) {
      const o = p + ofsLayer + 8 + l * 16;
      const tex = texNames[b.readUInt32LE(o)];
      const lflags = b.readUInt32LE(o + 4), ofs = b.readUInt32LE(o + 8);
      layers.push({ tex, alpha: l === 0 ? null : alphaMap(b, p + ofsAlpha + 8 + ofs, lflags, bigAlpha, fix) });
    }
    let shadow: Uint8Array | null = null;
    if (flags & 1 && ofsShadow && sizeShadow) {
      shadow = new Uint8Array(4096);
      for (let i = 0; i < 4096; i++) shadow[i] = (b[p + ofsShadow + 8 + (i >> 3)] >> (i & 7)) & 1;
    }
    let liquid: Float32Array | null = null;
    let ocean = false;
    if (mh2o) {
      const e = mh2o + (iy * 16 + ix) * 12;
      const ofsInst = b.readUInt32LE(e), count = b.readUInt32LE(e + 4);
      for (let k = 0; k < count; k++) {
        const inst = mh2o + ofsInst + k * 24;
        const type = b.readUInt16LE(inst), lvf = b.readUInt16LE(inst + 2);
        const minH = b.readFloatLE(inst + 4);
        const x0 = b[inst + 12], y0 = b[inst + 13], w = b[inst + 14], hh = b[inst + 15];
        const ofsMask = b.readUInt32LE(inst + 16), ofsVerts = b.readUInt32LE(inst + 20);
        if (oceanTypes.has(type)) ocean = true;
        liquid ??= new Float32Array(64).fill(NaN);
        for (let y = 0; y < hh; y++)
          for (let x = 0; x < w; x++) {
            const bit = y * w + x;
            if (ofsMask && !((b[mh2o + ofsMask + (bit >> 3)] >> (bit & 7)) & 1)) continue;
            let level = minH;
            if (ofsVerts && lvf !== 2) level = b.readFloatLE(mh2o + ofsVerts + (y * (w + 1) + x) * 4);
            liquid[(y0 + y) * 8 + x0 + x] = level;
          }
      }
    }
    // Ancien format d'eau (MCLQ), encore utilisé par une partie de Kalimdor : 9 × 9 hauteurs puis 8 × 8 cases
    if (!liquid && sizeLiquid > 8 && flags & 0x3c) {
      let q = p + ofsLiquid;
      if (tag(b, q) === "MCLQ") q += 8;
      liquid = new Float32Array(64).fill(NaN);
      ocean = !!(flags & 0x8);
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          if ((b[q + 8 + 81 * 8 + j * 8 + i] & 0x0f) === 0x0f) continue; // case sans eau
          const v = (a: number, c: number) => b.readFloatLE(q + 8 + (c * 9 + a) * 8 + 4);
          liquid[j * 8 + i] = (v(i, j) + v(i + 1, j) + v(i, j + 1) + v(i + 1, j + 1)) / 4;
        }
    }
    chunks[iy * 16 + ix] = { area, heights, layers, shadow, liquid, ocean };
  }
  return chunks;
}

export function extractTerrain(mpq: MpqStack, out: string, points: WorldPoints) {
  const area = new Dbc(mpq.readFile("DBFilesClient/AreaTable.dbc")!);
  const parent = new Map<number, number>(), frName = new Map<number, string>();
  for (let r = 0; r < area.rows; r++) {
    parent.set(area.int(r, 0), area.int(r, 2));
    frName.set(area.int(r, 0), area.localized(r, 11));
  }
  const root = (id: number) => {
    while (parent.get(id)) id = parent.get(id)!;
    return id;
  };
  const inZone = (id: number) => root(id) === DUROTAR || root(id) === ORGRIMMAR;
  const lt = new Dbc(mpq.readFile("DBFilesClient/LiquidType.dbc")!);
  const oceanTypes = new Set<number>();
  for (let r = 0; r < lt.rows; r++) if (lt.int(r, 3) === 1) oceanTypes.add(lt.int(r, 0));

  // --- Lecture des fichiers de carte de la fenêtre de recherche ---
  const wdt = mpq.readFile("World/Maps/Kalimdor/Kalimdor.wdt")!;
  const wc = readChunks(wdt);
  const bigAlpha = !!(wdt.readUInt32LE(wc.get("MPHD")![0] + 8) & 0x4);
  const main = wc.get("MAIN")![0] + 8;
  const all = new Map<string, Chunk>(); // clé : « gx,gy » (numéro global du morceau)
  let gx0 = 1e9, gx1 = -1, gy0 = 1e9, gy1 = -1;
  for (let ty = SEARCH.y0; ty <= SEARCH.y1; ty++)
    for (let tx = SEARCH.x0; tx <= SEARCH.x1; tx++) {
      if (!(wdt.readUInt32LE(main + (ty * 64 + tx) * 8) & 1)) continue;
      const adt = mpq.readFile(`World/Maps/Kalimdor/Kalimdor_${tx}_${ty}.adt`);
      if (!adt) continue;
      parseAdt(adt, bigAlpha, oceanTypes).forEach((ch, i) => {
        if (!ch) return;
        const gx = tx * 16 + (i % 16), gy = ty * 16 + Math.floor(i / 16);
        all.set(`${gx},${gy}`, ch);
        if (inZone(ch.area) && ch.area !== GREAT_SEA) {
          gx0 = Math.min(gx0, gx); gx1 = Math.max(gx1, gx);
          gy0 = Math.min(gy0, gy); gy1 = Math.max(gy1, gy);
        }
      });
    }
  gx0 -= PAD; gy0 -= PAD; gx1 += PAD; gy1 += PAD;
  const W = gx1 - gx0 + 1, H = gy1 - gy0 + 1;
  console.log(`  terrain : ${W} × ${H} tuiles (${all.size} morceaux lus)`);
  const chunkAt = (x: number, y: number) => all.get(`${x + gx0},${y + gy0}`);
  // Coordonnées du monde (x vers le nord, y vers l'ouest) → tuile du jeu
  const toTile = (p: { x: number; y: number }) => ({ x: 512 - p.y / CHUNK - gx0, y: 512 - p.x / CHUNK - gy0 });

  // --- Grille des hauteurs (sommets extérieurs, 8 cases par tuile) ---
  const GW = W * 8 + 1, GH = H * 8 + 1;
  const grid = new Float32Array(GW * GH);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = chunkAt(x, y);
      for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) grid[(y * 8 + j) * GW + x * 8 + i] = ch ? ch.heights[j * 17 + i] : 0;
    }
  const gh = (i: number, j: number) => grid[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))];
  // Éclairage de chaque sommet : soleil venant du nord-ouest
  const L = [-1, -1, 1.4], Ln = Math.hypot(...L);
  const light = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      const dx = (gh(i + 1, j) - gh(i - 1, j)) / (2 * QUAD), dy = (gh(i, j + 1) - gh(i, j - 1)) / (2 * QUAD);
      const n = Math.hypot(dx, dy, 1);
      const dot = (-dx * L[0] - dy * L[1] + L[2]) / (n * Ln);
      light[j * GW + i] = 0.35 + 0.925 * Math.max(0, dot);
    }
  const bilinear = (g: Float32Array, fx: number, fy: number) => {
    const i = Math.min(GW - 2, Math.floor(fx)), j = Math.min(GH - 2, Math.floor(fy));
    const u = fx - i, v = fy - j;
    const a = g[j * GW + i], b = g[j * GW + i + 1], c = g[(j + 1) * GW + i], d = g[(j + 1) * GW + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  // --- Textures du sol : une réduction de 16 pixels, répétée deux fois par tuile ---
  const textures = new Map<string, Image>();
  const texture = (name: string) => {
    let t = textures.get(name);
    if (!t) {
      const file = mpq.readFile(name);
      const mips = file ? decodeBlp(file) : [];
      t = mips.find((m) => m.width <= 16) ?? mips[mips.length - 1] ?? { width: 1, height: 1, data: new Uint8Array([128, 100, 80, 255]) };
      textures.set(name, t);
    }
    return t;
  };
  const REPEAT = 2;

  // --- Dessin du sol vu de dessus ---
  const IW = W * PX, IH = H * PX;
  const img = new Uint8Array(IW * IH * 4);
  const col = [0, 0, 0];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = chunkAt(x, y);
      const outside = !ch || !inZone(ch.area);
      for (let py = 0; py < PX; py++)
        for (let px = 0; px < PX; px++) {
          col[0] = col[1] = col[2] = 0;
          const a64 = Math.floor((py * 64) / PX) * 64 + Math.floor((px * 64) / PX);
          if (ch) {
            for (const layer of ch.layers) {
              const t = texture(layer.tex);
              const tx = Math.floor(((px * REPEAT) / PX) * t.width) % t.width, ty = Math.floor(((py * REPEAT) / PX) * t.height) % t.height;
              const o = (ty * t.width + tx) * 4;
              const a = layer.alpha ? layer.alpha[a64] / 255 : 1;
              for (let k = 0; k < 3; k++) col[k] = col[k] * (1 - a) + t.data[o + k] * a;
            }
          } else col[0] = col[1] = col[2] = 40;
          const fx = x * 8 + ((px + 0.5) * 8) / PX, fy = y * 8 + ((py + 0.5) * 8) / PX;
          let shade = bilinear(light, fx, fy);
          if (ch?.shadow?.[a64]) shade *= 0.8;
          for (let k = 0; k < 3; k++) col[k] *= shade;
          // Eau par-dessus, plus opaque quand elle est profonde
          const lq = ch?.liquid?.[Math.floor((py * 8) / PX) * 8 + Math.floor((px * 8) / PX)];
          let wet = false;
          if (lq !== undefined && !Number.isNaN(lq)) {
            const depth = lq - bilinear(grid, fx, fy);
            if (depth > 0) {
              wet = true;
              const a = Math.min(0.9, 0.45 + depth * 0.05);
              const w = ch!.ocean ? [26, 74, 106] : [46, 110, 142];
              for (let k = 0; k < 3; k++) col[k] = col[k] * (1 - a) + w[k] * a;
            }
          }
          // Hors de la zone : terres assombries et grisées (la mer reste telle quelle, pour un rivage continu)
          if (outside && !wet) {
            const grey = (col[0] + col[1] + col[2]) / 3;
            for (let k = 0; k < 3; k++) col[k] = (col[k] * 0.5 + grey * 0.5) * 0.45;
          }
          const o = ((y * PX + py) * IW + x * PX + px) * 4;
          img[o] = col[0];
          img[o + 1] = col[1];
          img[o + 2] = col[2];
          img[o + 3] = 255;
        }
    }

  // --- Type de chaque tuile ---
  // m mer · e eau peu profonde · r roche (pente trop forte) · v ville · d terre · h hors de la zone · g entrée d'instance
  const rows: string[] = [];
  const slopeMax = Math.tan((50 * Math.PI) / 180);
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const ch = chunkAt(x, y);
      if (!ch || !inZone(ch.area)) {
        row += "h";
        continue;
      }
      let wet = 0, deep = 0, steep = 0;
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const gi = x * 8 + i, gj = y * 8 + j;
          const hs = [gh(gi, gj), gh(gi + 1, gj), gh(gi, gj + 1), gh(gi + 1, gj + 1)];
          if ((Math.max(...hs) - Math.min(...hs)) / QUAD > slopeMax) steep++;
          const lq = ch.liquid?.[j * 8 + i];
          if (lq !== undefined && !Number.isNaN(lq)) {
            const depth = lq - (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
            if (depth > 0.6) wet++;
            if (depth > 3) deep++;
          }
        }
      if (wet >= 32) row += deep >= 32 || ch.ocean ? "m" : "e";
      else if (steep >= 26) row += "r";
      else row += root(ch.area) === ORGRIMMAR ? "v" : "d";
    }
    rows.push(row);
  }
  const rf = toTile(points.ragefire);
  const rx = Math.floor(rf.x), ry = Math.floor(rf.y);
  rows[ry] = rows[ry].slice(0, rx) + "g" + rows[ry].slice(rx + 1);

  // --- Noms des lieux : au centre des morceaux de chaque sous-zone assez grande ---
  const sums = new Map<number, { x: number; y: number; n: number }>();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = chunkAt(x, y);
      if (!ch || !inZone(ch.area) || ch.area === DUROTAR || ch.area === GREAT_SEA) continue;
      const s = sums.get(ch.area) ?? { x: 0, y: 0, n: 0 };
      s.x += x; s.y += y; s.n++;
      sums.set(ch.area, s);
    }
  const label = (id: number, x: number, y: number, kind: "lieu" | "instance") => ({
    x: Math.round(x), y: Math.round(y), kind,
    name: { fr: frName.get(id) ?? "?", en: EN_NAMES[id] ?? frName.get(id) ?? "?" },
  });
  const labels = [...sums].filter(([, s]) => s.n >= 30).map(([id, s]) => label(id, s.x / s.n, s.y / s.n, "lieu"));
  labels.push(label(RAGEFIRE, rf.x, rf.y - 2, "instance"));

  // --- Écriture ---
  const dir = join(out, "terrain");
  mkdirSync(dir, { recursive: true });
  const pieces = [];
  for (let y = 0; y < H; y += PIECE)
    for (let x = 0; x < W; x += PIECE) {
      const w = Math.min(PIECE, W - x), h = Math.min(PIECE, H - y);
      const pw = w * PX, ph = h * PX;
      const part = new Uint8Array(pw * ph * 4);
      for (let r = 0; r < ph; r++) part.set(img.subarray(((y * PX + r) * IW + x * PX) * 4, ((y * PX + r) * IW + x * PX + pw) * 4), r * pw * 4);
      const file = `ground_${x / PIECE}_${y / PIECE}.png`;
      writeFileSync(join(dir, file), encodePng(pw, ph, part));
      pieces.push({ file, x, y, w, h });
    }
  const start = toTile(points.start);
  writeFileSync(
    join(dir, "map.json"),
    JSON.stringify({
      id: "durotar",
      width: W,
      height: H,
      start: { x: Math.floor(start.x), y: Math.floor(start.y) },
      pxPerTile: PX,
      pieces,
      terrain: rows,
      labels,
    }),
  );
  console.log(`  terrain/map.json et ${pieces.length} images du sol`);
}
