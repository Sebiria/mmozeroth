// Fausse Durotar en formes simples, générée par code (aucune ressource du client).
// Repère : x vers l'est, y vers le sud. Remplacée par le vrai terrain quand le pack de ressources est extrait.

export const MAP_W = 100;
export const MAP_H = 160;

// Point d'arrivée des nouveaux joueurs : le centre de la Vallée des épreuves.
export const START = { x: 34, y: 132 };

export type Terrain = "mer" | "eau" | "plage" | "desert" | "savane" | "roche" | "ville" | "jungle" | "gouffre" | "hors";

export interface Tile {
  terrain: Terrain;
  height: number; // 0 = plat, 1 à 4 = relief
  shade: number; // petite variation de teinte, de -1 à 1
}

export interface Label {
  x: number;
  y: number;
  name: { fr: string; en: string };
  kind: "lieu" | "instance";
}

// Noms de la fausse carte (ceux de la vraie viennent du client).
export const LABELS: Label[] = [
  { x: 30, y: 20, name: { fr: "Orgrimmar", en: "Orgrimmar" }, kind: "lieu" },
  { x: 23, y: 15, name: { fr: "Gouffre de Ragefeu", en: "Ragefire Chasm" }, kind: "instance" },
  { x: 34, y: 132, name: { fr: "Vallée des épreuves", en: "Valley of Trials" }, kind: "lieu" },
  { x: 55, y: 88, name: { fr: "Tranchecolline", en: "Razor Hill" }, kind: "lieu" },
  { x: 72, y: 131, name: { fr: "Village de Sen'jin", en: "Sen'jin Village" }, kind: "lieu" },
  { x: 89, y: 133, name: { fr: "Îles de l'Écho", en: "Echo Isles" }, kind: "lieu" },
  { x: 77, y: 100, name: { fr: "Fort de Tiragarde", en: "Tiragarde Keep" }, kind: "lieu" },
  { x: 18, y: 58, name: { fr: "Crête du Tonnerre", en: "Thunder Ridge" }, kind: "lieu" },
  { x: 4, y: 95, name: { fr: "Les Tarides", en: "The Barrens" }, kind: "lieu" },
];

// --- Bruit déterministe (même carte à chaque lancement) ---
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number): number {
  return noise(x * 0.08, y * 0.08) * 0.65 + noise(x * 0.2, y * 0.2) * 0.35;
}

// Distance d'un point à un segment.
function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Chaînes de montagnes : [ax, ay, bx, by, largeur]
const RIDGES: [number, number, number, number, number][] = [
  [14, 38, 20, 76, 5], // Crête du Tonnerre
  [55, 24, 67, 46, 4], // ravin au nord-est
  [68, 8, 76, 22, 3], // rocher au nord-est
  [40, 152, 72, 158, 4], // collines du sud
  [44, 60, 48, 72, 3], // massif central
];

const ISLANDS: [number, number, number][] = [
  [88, 128, 5],
  [94, 139, 3],
  [84, 141, 3],
];

// Anneau de montagnes avec une ouverture dans une direction (dx, dy).
function ring(x: number, y: number, cx: number, cy: number, rx: number, ry: number, gapX: number, gapY: number) {
  const ux = (x - cx) / rx, uy = (y - cy) / ry;
  const d = Math.hypot(ux, uy);
  const inGap = (ux * gapX + uy * gapY) / (d || 1) > 0.93;
  return { inside: d < 1, wall: d >= 1 && d < 1.4 && !inGap, d };
}

// Hauteur d'une falaise en anneau : plus haute au milieu de la bande, avec un peu de bruit.
function ringHeight(d: number, top: number, x: number, y: number): number {
  const k = 1 - Math.abs(d - 1.2) / 0.2;
  return Math.max(1, Math.round(1 + k * (top - 1) + (noise(x * 0.5, y * 0.5) - 0.5) * 1.5));
}

export function generateMap(): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: Tile[] = [];
    const coast = 80 + 7 * (noise(0.5, y * 0.05) - 0.5) * 2 - (y > 120 ? (y - 120) * 0.15 : 0);
    const river = 9 + 3 * Math.sin(y * 0.06) + 2 * (noise(3.3, y * 0.1) - 0.5);
    for (let x = 0; x < MAP_W; x++) {
      const n = fbm(x, y);
      const shade = (n - 0.5) * 2;
      let terrain: Terrain = "desert";
      let height = 0;

      if (Math.abs(x - river) < 2.2) terrain = "eau";
      else if (x < river) terrain = "savane";
      else if (x > coast) {
        terrain = x > coast + 4 ? "mer" : "eau";
        for (const [ix, iy, r] of ISLANDS) {
          const d = Math.hypot(x - ix, y - iy) + (noise(x * 0.4, y * 0.4) - 0.5) * 1.5;
          if (d < r) terrain = d < r - 1.2 ? "jungle" : "plage";
        }
      } else if (x > coast - 2) terrain = "plage";

      if (terrain === "desert") {
        // Montagnes de la frontière nord
        if (y < 5) height = 3 + Math.round(noise(x * 0.3, 1));
        for (const [ax, ay, bx, by, w] of RIDGES) {
          const d = distSeg(x, y, ax, ay, bx, by) + (noise(x * 0.3, y * 0.3) - 0.5) * 2;
          if (d < w) height = Math.max(height, 1 + Math.round(3 * (1 - d / w)));
        }
        // Rochers épars
        if (n > 0.8) height = Math.max(height, 1);

        // Orgrimmar : cité entourée de falaises, porte vers le sud-est
        const org = ring(x, y, 30, 22, 16, 14, 0.7, 0.7);
        if (org.inside) {
          terrain = "ville";
          height = 0;
        } else if (org.wall) height = Math.max(height, ringHeight(org.d, 4, x, y));

        // Vallée des épreuves : cuvette avec une sortie vers le nord-est
        const val = ring(x, y, 34, 132, 13, 12, 0.7, -0.7);
        if (val.inside) height = 0;
        else if (val.wall) height = Math.max(height, ringHeight(val.d, 3, x, y));

        if (height > 0) terrain = "roche";
      }
      row.push({ terrain, height, shade });
    }
    tiles.push(row);
  }
  // Entrée du Gouffre de Ragefeu, dans Orgrimmar
  for (const [x, y] of [[23, 17], [24, 17], [23, 18], [24, 18]]) tiles[y][x] = { terrain: "gouffre", height: 0, shade: 0 };
  return tiles;
}
