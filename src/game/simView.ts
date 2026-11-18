// Dessin des joueurs simulés et des créatures, à partir des états envoyés par la simulation.
// Les positions sont interpolées entre deux tours pour un mouvement fluide.
// Avec le pack de ressources : images des modèles (8 directions, marche, attaque, mort). Sinon : pastilles de couleur.
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { C_STRIDE, P_STRIDE, type Snapshot } from "../sim/protocol";
import { tileToScreen } from "./iso";

// Couleurs de classe habituelles, dans l'ordre de CLASSES.
const CLASS_COLORS = [0xc79c6e, 0xf58cba, 0xabd473, 0xfff569, 0xffffff, 0x0070de, 0x69ccf0, 0x9482c9, 0xff7d0a];
const TICK_MS = 100;
const WALK_FPS = 10, ATTACK_FPS = 7;

interface SheetInfo {
  file: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  anims: Record<"stand" | "walk" | "attack" | "death", [number, number]>;
}
interface Sheet {
  info: SheetInfo;
  frames: Texture[][]; // [direction][colonne]
}

export class SimView {
  readonly creatures = new Graphics(); // pastilles (sans pack) ; ombres sous les modèles
  readonly players = new Graphics(); // anneau de sélection, éclat de montée de niveau
  readonly sprites = new Container(); // modèles, triés de l'arrière vers l'avant
  private prev: Snapshot | null = null;
  private cur: Snapshot | null = null;
  private receivedAt = 0;
  private sheets = new Map<string, Sheet>();
  private pool: Sprite[] = [];
  private facing = new Map<string, number>(); // dernière direction connue de chaque joueur ou créature
  selectedId: number | null = null; // joueur dont la fiche est ouverte

  constructor(
    private creatureColor: (campId: number) => number,
    private creatureKind: (campId: number) => string | undefined,
  ) {
    this.sprites.sortableChildren = true;
  }

  // Charge les planches d'images du pack de ressources, s'il existe.
  async loadModels() {
    try {
      const res = await fetch("/resource-pack/models/index.json");
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) return;
      const index: Record<string, SheetInfo> = await res.json();
      await Promise.all(
        Object.entries(index).map(async ([key, info]) => {
          const tex: Texture = await Assets.load(`/resource-pack/models/${info.file}`);
          const cols = tex.width / info.w;
          const frames = [...Array(8)].map((_, d) =>
            [...Array(cols)].map((_, c) => new Texture({ source: tex.source, frame: new Rectangle(c * info.w, d * info.h, info.w, info.h) })),
          );
          this.sheets.set(key, { info, frames });
        }),
      );
    } catch {
      // pas de pack : on garde les pastilles
    }
  }

  // Joueur le plus proche d'un point (en tuiles), à moins de 0,6 tuile.
  playerAt(f: { x: number; y: number }): number | null {
    const pl = this.cur?.players;
    if (!pl) return null;
    let best: number | null = null;
    let bestDist = 0.6;
    for (let i = 0; i < pl.length; i += P_STRIDE) {
      const d = Math.hypot(pl[i] - f.x, pl[i + 1] - f.y);
      if (d < bestDist) {
        bestDist = d;
        best = pl[i + 6];
      }
    }
    return best;
  }

  // Position affichée (interpolée) d'un joueur, en tuiles ; null s'il n'existe plus.
  positionOf(id: number): { x: number; y: number } | null {
    const cur = this.cur?.players;
    if (!cur) return null;
    const prev = this.prev?.players;
    const k = Math.min(1, (performance.now() - this.receivedAt) / TICK_MS);
    for (let i = 0; i < cur.length; i += P_STRIDE) {
      if (cur[i + 6] !== id) continue;
      if (!prev || prev.length !== cur.length) return { x: cur[i], y: cur[i + 1] };
      return { x: prev[i] + (cur[i] - prev[i]) * k, y: prev[i + 1] + (cur[i + 1] - prev[i + 1]) * k };
    }
    return null;
  }

  push(s: Snapshot) {
    this.prev = this.cur;
    this.cur = s;
    this.receivedAt = performance.now();
  }

  // Direction (0 à 7) d'un déplacement en tuiles, dans l'ordre des images du pack :
  // 0 = de dos (vers le haut de l'écran), puis dans le sens des aiguilles d'une montre vu de la caméra.
  private direction(key: string, dx: number, dy: number): number {
    if (Math.hypot(dx, dy) < 1e-4) return this.facing.get(key) ?? 4;
    const sx = dx - dy, sy = (dx + dy) / 2; // déplacement à l'écran
    const angle = Math.atan2(-sx, -2 * sy);
    const d = (((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8);
    this.facing.set(key, d);
    return d;
  }

  private sprite(n: number): Sprite {
    let s = this.pool[n];
    if (!s) {
      s = new Sprite();
      this.pool[n] = s;
      this.sprites.addChild(s);
    }
    s.visible = true;
    return s;
  }

  private place(s: Sprite, sheet: Sheet, dir: number, anim: keyof SheetInfo["anims"], frame: number, sx: number, sy: number, alpha = 1) {
    const [start, count] = sheet.info.anims[anim];
    s.texture = sheet.frames[dir][start + (frame % count)];
    s.anchor.set(sheet.info.ax / sheet.info.w, sheet.info.ay / sheet.info.h);
    s.position.set(sx, sy);
    s.zIndex = sy;
    s.alpha = alpha;
  }

  draw() {
    const cur = this.cur;
    if (!cur) return;
    const now = performance.now();
    const k = Math.min(1, (now - this.receivedAt) / TICK_MS);
    const lerp = (a: Float32Array | undefined, b: Float32Array, i: number) => {
      if (!a || a.length !== b.length) return [b[i], b[i + 1], 0, 0];
      return [a[i] + (b[i] - a[i]) * k, a[i + 1] + (b[i + 1] - a[i + 1]) * k, b[i] - a[i], b[i + 1] - a[i + 1]];
    };
    const models = this.sheets.size > 0;
    let n = 0;

    const cg = this.creatures.clear();
    const cr = cur.creatures;
    for (let i = 0; i < cr.length; i += C_STRIDE) {
      if (!cr[i + 3]) continue; // morte, en attente de réapparition
      const [x, y, dx, dy] = lerp(this.prev?.creatures, cr, i);
      const { sx, sy } = tileToScreen(x, y);
      const sheet = models ? this.sheets.get(this.creatureKind(cr[i + 2]) ?? "") : undefined;
      if (!sheet) {
        cg.circle(sx, sy, 6).fill({ color: this.creatureColor(cr[i + 2]) }).stroke({ width: 2, color: 0xf4e6c4, alpha: 0.9 });
        continue;
      }
      cg.ellipse(sx, sy, 9, 4.5).fill({ color: 0x000000, alpha: 0.3 });
      const moving = Math.hypot(dx, dy) > 1e-4;
      const dir = this.direction(`c${i}`, dx, dy);
      this.place(this.sprite(n++), sheet, dir, moving ? "walk" : "stand", Math.floor((now / 1000) * WALK_FPS + i), sx, sy);
    }

    const pg = this.players.clear();
    const pl = cur.players;
    for (let i = 0; i < pl.length; i += P_STRIDE) {
      const [x, y, dx, dy] = lerp(this.prev?.players, pl, i);
      const { sx, sy } = tileToScreen(x, y);
      const state = pl[i + 4];
      const flash = pl[i + 5];
      const id = pl[i + 6];
      // Apparence : race, puis sexe et tenue tirés du numéro du joueur
      const sheet = models ? this.sheets.get(`player_${pl[i + 8]}_${id % 2}_${Math.floor(id / 2) % 2}`) : undefined;
      if (!sheet) {
        if (id === this.selectedId) pg.circle(sx, sy - 6, 10).stroke({ width: 3, color: 0xffe08a });
        if (flash > 0) pg.circle(sx, sy - 6, 9 + (1 - flash) * 14).stroke({ width: 3, color: 0xffd040, alpha: flash });
        pg.ellipse(sx, sy, 5, 2.5).fill({ color: 0x000000, alpha: 0.35 });
        pg.circle(sx, sy - 6, 5)
          .fill({ color: CLASS_COLORS[pl[i + 2]], alpha: state === 2 ? 0.3 : 1 })
          .stroke({ width: 1.5, color: state === 1 ? 0xff3020 : 0x1a1208, alpha: state === 2 ? 0.3 : 1 });
        continue;
      }
      // Sous les pieds : la couleur de la classe ; au-dessus : sélection et montée de niveau
      cg.ellipse(sx, sy, 9, 4.5).fill({ color: CLASS_COLORS[pl[i + 2]], alpha: state === 2 ? 0.25 : 0.7 }).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
      if (id === this.selectedId) pg.ellipse(sx, sy, 14, 7).stroke({ width: 3, color: 0xffe08a });
      if (flash > 0) pg.circle(sx, sy - 16, 12 + (1 - flash) * 18).stroke({ width: 3, color: 0xffd040, alpha: flash });
      const dir = this.direction(`p${id}`, dx, dy);
      const s = this.sprite(n++);
      if (state === 2) this.place(s, sheet, dir, "death", 0, sx, sy, 0.55);
      else if (state === 1) this.place(s, sheet, dir, "attack", Math.floor((now / 1000) * ATTACK_FPS + id), sx, sy);
      else this.place(s, sheet, dir, Math.hypot(dx, dy) > 1e-4 ? "walk" : "stand", Math.floor((now / 1000) * WALK_FPS + id), sx, sy);
    }
    for (let j = n; j < this.pool.length; j++) this.pool[j].visible = false;
  }
}
