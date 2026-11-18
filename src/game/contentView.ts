// Dessin du contenu posé : chemins, camps de créatures, PNJ (formes simples de remplacement).
import { Container, Graphics, Text } from "pixi.js";
import type { Content, Point } from "./content";
import { TILE_H, TILE_W, tileCenter } from "./iso";
import { CREATURES, NPC_ROLES } from "./placeholderData";

const SELECTED = 0xffe08a;

// Un cercle de rayon r (en tuiles) devient une ellipse à l'écran.
const RX = (TILE_W / 2) * Math.SQRT2;
const RY = (TILE_H / 2) * Math.SQRT2;

// Position à l'écran d'un point en tuiles non arrondies (le centre de la tuile x est x + 0.5).
function screenOf(p: Point) {
  return tileCenter(p.x, p.y);
}

export class ContentView {
  readonly root = new Container();
  private g = new Graphics();
  private letters = new Map<number, Text>();

  constructor(private content: Content) {
    this.root.addChild(this.g);
  }

  draw(selectedId: number | null) {
    const g = this.g.clear();
    const seen = new Set<number>();

    for (const e of this.content.entities.values()) {
      if (e.kind !== "path" || e.points.length === 0) continue;
      const sel = e.id === selectedId;
      const pts = e.points.map(screenOf);
      if (pts.length > 1) {
        g.moveTo(pts[0].sx, pts[0].sy);
        for (const p of pts.slice(1)) g.lineTo(p.sx, p.sy);
        g.stroke({ width: 12, color: sel ? SELECTED : 0xe0c28a, alpha: 0.85, cap: "round", join: "round" });
      }
      for (const p of pts) g.circle(p.sx, p.sy, sel ? 7 : 4).fill({ color: sel ? SELECTED : 0xc9a46a });
    }

    for (const e of this.content.entities.values()) {
      if (e.kind !== "camp") continue;
      const sel = e.id === selectedId;
      const c = screenOf(e);
      const color = CREATURES.find((k) => k.id === e.creature)?.color ?? 0x888888;
      g.ellipse(c.sx, c.sy, RX * e.radius, RY * e.radius)
        .fill({ color, alpha: 0.12 })
        .stroke({ width: sel ? 3 : 1.5, color: sel ? SELECTED : color, alpha: 0.9 });
      // Repère du centre du camp (les créatures elles-mêmes viennent de la simulation)
      g.poly([c.sx, c.sy - 9, c.sx + 12, c.sy, c.sx, c.sy + 9, c.sx - 12, c.sy])
        .fill({ color: sel ? SELECTED : 0x3a2a1a })
        .stroke({ width: 2, color: color });
    }

    for (const e of this.content.entities.values()) {
      if (e.kind !== "npc") continue;
      seen.add(e.id);
      const sel = e.id === selectedId;
      const c = screenOf(e);
      const role = NPC_ROLES.find((r) => r.id === e.role)!;
      g.ellipse(c.sx, c.sy + 2, 10, 5).fill({ color: 0x000000, alpha: 0.35 });
      g.circle(c.sx, c.sy - 10, 11)
        .fill({ color: role.color })
        .stroke({ width: sel ? 3 : 2, color: sel ? SELECTED : 0x1a1208 });
      let letter = this.letters.get(e.id);
      if (!letter) {
        letter = new Text({
          text: "",
          style: { fontFamily: "system-ui, sans-serif", fontSize: 14, fontWeight: "bold", fill: 0x1a1208 },
          resolution: 2,
        });
        letter.anchor.set(0.5);
        this.root.addChild(letter);
        this.letters.set(e.id, letter);
      }
      letter.text = role.letter;
      letter.position.set(c.sx, c.sy - 10);
      // Pastille jaune : ce PNJ donne au moins une quête.
      if (this.content.quests().some((q) => q.giverId === e.id))
        g.circle(c.sx + 10, c.sy - 21, 5).fill({ color: 0xf2c230 }).stroke({ width: 1.5, color: 0x1a1208 });
    }

    // Quête sélectionnée : trajet PNJ de départ → objectif → PNJ d'arrivée.
    const quest = this.content.get(selectedId);
    if (quest?.kind === "quest") {
      const steps: Point[] = [];
      const giver = this.content.get(quest.giverId);
      const ender = this.content.get(quest.enderId);
      const camp = this.content.get(quest.campId);
      if (giver?.kind === "npc") steps.push(giver);
      if ((quest.type === "kill" || quest.type === "collect") && camp?.kind === "camp") steps.push(camp);
      if (quest.type === "explore" && quest.target) steps.push(quest.target);
      if (ender?.kind === "npc") steps.push(ender);
      const pts = steps.map(screenOf);
      if (pts.length > 1) {
        g.moveTo(pts[0].sx, pts[0].sy);
        for (const pt of pts.slice(1)) g.lineTo(pt.sx, pt.sy);
        g.stroke({ width: 3, color: SELECTED, alpha: 0.9 });
      }
      for (const pt of pts) g.circle(pt.sx, pt.sy, 6).stroke({ width: 3, color: SELECTED });
      if (quest.type === "explore" && quest.target) {
        const c = screenOf(quest.target);
        g.ellipse(c.sx, c.sy, RX * 3, RY * 3).stroke({ width: 2, color: SELECTED, alpha: 0.8 }); // rayon de découverte
      }
    }

    for (const [id, letter] of this.letters) {
      if (!seen.has(id)) {
        letter.destroy();
        this.letters.delete(id);
      }
    }
  }
}
