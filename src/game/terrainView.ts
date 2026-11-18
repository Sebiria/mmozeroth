// Dessin du terrain et des noms des lieux : le sol vu de dessus du pack de ressources, ou la fausse carte en tuiles en relief.
import { Assets, Container, Graphics, Matrix, Sprite, Text, type Texture } from "pixi.js";
import { lang } from "../i18n";
import type { GameMap } from "./gameMap";
import { TILE_H, TILE_W, tileDiamond, tileToScreen } from "./iso";
import type { Terrain } from "./placeholderMap";

export const LEVEL_PX = 8; // hauteur d'un niveau de relief, en pixels

const COLORS: Record<Terrain, number> = {
  mer: 0x1f4e6b,
  eau: 0x3a7fa0,
  plage: 0xd8c08a,
  desert: 0xae5f3a,
  savane: 0xa8945a,
  roche: 0x7a5038,
  ville: 0x8c6a4a,
  jungle: 0x5f7a3a,
  gouffre: 0x2a0d08,
  hors: 0x2a2620,
};

// Terrains où l'on peut poser camps et PNJ. Les chemins peuvent en plus traverser l'eau peu profonde (gués).
const WALKABLE = new Set<Terrain>(["desert", "savane", "plage", "ville", "jungle"]);
export const canPlace = (t: Terrain) => WALKABLE.has(t);
export const canPath = (t: Terrain) => WALKABLE.has(t) || t === "eau";

export function tint(color: number, f: number): number {
  const r = Math.min(255, ((color >> 16) & 255) * f);
  const g = Math.min(255, ((color >> 8) & 255) * f);
  const b = Math.min(255, (color & 255) * f);
  return (r << 16) | (g << 8) | b;
}

export class TerrainView {
  readonly ground = new Container();
  readonly labelLayer = new Container();
  private labels: Text[] = [];

  constructor(private map: GameMap) {
    if (map.ground) this.loadImages(map.ground);
    else this.drawGround();
    for (const l of map.labels) {
      const { sx, sy } = tileToScreen(l.x, l.y);
      const text = new Text({
        text: "",
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 15,
          fontWeight: "bold",
          fill: l.kind === "instance" ? 0xff7a50 : 0xf4e6c4,
          stroke: { color: 0x000000, width: 4 },
        },
        resolution: 2,
      });
      text.anchor.set(0.5);
      text.position.set(sx, sy + TILE_H / 2 - map.tiles[l.y][l.x].height * LEVEL_PX);
      this.labelLayer.addChild(text);
      this.labels.push(text);
    }
    this.updateLabels();
  }

  updateLabels() {
    this.map.labels.forEach((l, i) => (this.labels[i].text = l.kind === "instance" ? `◆ ${l.name[lang]}` : l.name[lang]));
  }

  // Les noms gardent la même taille à l'écran quel que soit le zoom.
  setZoom(s: number) {
    for (const t of this.labels) t.scale.set(1 / s);
  }

  // Le sol vu de dessus devient isométrique par une simple transformation : rotation de 45° et écrasement vertical.
  private async loadImages(ground: NonNullable<GameMap["ground"]>) {
    const k = 1 / ground.pxPerTile;
    await Promise.all(
      ground.pieces.map(async (p) => {
        const texture: Texture = await Assets.load({ src: p.url, data: { autoGenerateMipmaps: true } });
        const sprite = new Sprite(texture);
        const { sx, sy } = tileToScreen(p.x, p.y);
        sprite.setFromMatrix(new Matrix((TILE_W / 2) * k, (TILE_H / 2) * k, -(TILE_W / 2) * k, (TILE_H / 2) * k, sx, sy));
        this.ground.addChild(sprite);
      }),
    );
  }

  // Dessin dans l'ordre des diagonales (arrière vers avant) pour que le relief se recouvre correctement.
  private drawGround() {
    const { tiles: map, width: MAP_W, height: MAP_H } = this.map;
    const g = new Graphics();
    this.ground.addChild(g);
    const heightAt = (x: number, y: number) => (x < MAP_W && y < MAP_H ? map[y][x].height : 0);
    for (let s = 0; s < MAP_W + MAP_H - 1; s++) {
      for (let x = Math.max(0, s - MAP_H + 1); x <= Math.min(MAP_W - 1, s); x++) {
        const y = s - x;
        const t = map[y][x];
        const lift = t.height * LEVEL_PX;
        const top = tileDiamond(x, y).map((v, i) => (i % 2 ? v - lift : v));
        const base = tint(COLORS[t.terrain], 1 + 0.08 * t.shade + 0.06 * t.height);
        const [, , rx, ry, bx, by, lx, ly] = top;
        // Face droite (vers la tuile x+1) et face gauche (vers la tuile y+1), si le voisin est plus bas.
        const dr = (t.height - heightAt(x + 1, y)) * LEVEL_PX;
        if (dr > 0) g.poly([rx, ry, bx, by, bx, by + dr, rx, ry + dr]).fill({ color: tint(base, 0.72) });
        const dl = (t.height - heightAt(x, y + 1)) * LEVEL_PX;
        if (dl > 0) g.poly([lx, ly, bx, by, bx, by + dl, lx, ly + dl]).fill({ color: tint(base, 0.55) });
        g.poly(top).fill({ color: base });
      }
    }
  }
}
