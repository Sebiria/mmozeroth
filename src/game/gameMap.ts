// Carte de la partie : le vrai terrain de Durotar si le pack de ressources a été extrait, sinon la fausse carte.
import { LABELS, MAP_H, MAP_W, START, generateMap, type Label, type Terrain, type Tile } from "./placeholderMap";

export type MapId = "placeholder" | "durotar";

export interface GameMap {
  id: MapId;
  width: number;
  height: number;
  start: { x: number; y: number };
  tiles: Tile[][];
  labels: Label[];
  // Sol vu de dessus, en morceaux d'image (positions et tailles en tuiles) ; absent pour la fausse carte.
  ground?: { pxPerTile: number; pieces: { url: string; x: number; y: number; w: number; h: number }[] };
}

const PACK = "/resource-pack";
const CODES: Record<string, Terrain> = { m: "mer", e: "eau", r: "roche", v: "ville", d: "desert", h: "hors", g: "gouffre" };

interface PackMap {
  id: "durotar";
  width: number;
  height: number;
  start: { x: number; y: number };
  pxPerTile: number;
  pieces: { file: string; x: number; y: number; w: number; h: number }[];
  terrain: string[];
  labels: Label[];
}

export function placeholderMap(): GameMap {
  return { id: "placeholder", width: MAP_W, height: MAP_H, start: START, tiles: generateMap(), labels: LABELS };
}

export async function loadMap(): Promise<GameMap> {
  try {
    const res = await fetch(`${PACK}/terrain/map.json`);
    // Sans pack, le serveur de développement renvoie la page d'accueil au lieu d'une erreur : on vérifie le type.
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return placeholderMap();
    const m: PackMap = await res.json();
    return {
      id: m.id,
      width: m.width,
      height: m.height,
      start: m.start,
      tiles: m.terrain.map((row) => [...row].map((c) => ({ terrain: CODES[c] ?? "hors", height: 0, shade: 0 }))),
      labels: m.labels,
      ground: { pxPerTile: m.pxPerTile, pieces: m.pieces.map((p) => ({ ...p, url: `${PACK}/terrain/${p.file}` })) },
    };
  } catch {
    return placeholderMap();
  }
}

// Icône tirée du pack (classe, objet, sort) ; l'image disparaît d'elle-même si le pack est absent.
export function packIcon(name: string, size = 20): HTMLImageElement {
  const img = document.createElement("img");
  img.src = `${PACK}/icons/${name}.png`;
  img.width = img.height = size;
  img.className = "icon";
  img.onerror = () => img.remove();
  return img;
}
