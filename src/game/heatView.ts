// Calque de fréquentation : rouge là où les joueurs passent beaucoup de temps, bleu là où il n'y a personne.
import { Graphics } from "pixi.js";
import { HEAT_CELL } from "../sim/protocol";
import { tileToScreen } from "./iso";

export class HeatView {
  readonly g = new Graphics();
  private cellsW: number;
  private land: Float32Array; // part de tuiles praticables dans chaque case (les cases de mer ne sont pas colorées)

  constructor(width: number, height: number, walkable: (x: number, y: number) => boolean) {
    this.cellsW = Math.ceil(width / HEAT_CELL);
    const cellsH = Math.ceil(height / HEAT_CELL);
    this.land = new Float32Array(this.cellsW * cellsH);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (walkable(x, y)) this.land[Math.floor(y / HEAT_CELL) * this.cellsW + Math.floor(x / HEAT_CELL)] += 1 / (HEAT_CELL * HEAT_CELL);
    this.g.visible = false;
  }

  update(heat: Float32Array) {
    const g = this.g.clear();
    let max = 0;
    for (const v of heat) max = Math.max(max, v);
    const scale = Math.max(max, 1);
    for (let i = 0; i < heat.length; i++) {
      if (this.land[i] < 0.3) continue;
      const cx = (i % this.cellsW) * HEAT_CELL, cy = Math.floor(i / this.cellsW) * HEAT_CELL;
      // Échelle racine : les petites fréquentations restent visibles à côté des grosses.
      const k = Math.sqrt(heat[i] / scale);
      const color = k < 0.02 ? 0x3060d0 : lerpColor(0xf0d040, 0xe02010, k);
      const top = tileToScreen(cx, cy), right = tileToScreen(cx + HEAT_CELL, cy);
      const bottom = tileToScreen(cx + HEAT_CELL, cy + HEAT_CELL), left = tileToScreen(cx, cy + HEAT_CELL);
      g.poly([top.sx, top.sy, right.sx, right.sy, bottom.sx, bottom.sy, left.sx, left.sy]).fill({ color, alpha: k < 0.02 ? 0.25 : 0.25 + 0.4 * k });
    }
  }
}

function lerpColor(a: number, b: number, k: number) {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
