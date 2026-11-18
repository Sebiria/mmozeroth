// Le contenu posé par le joueur. Séparé de l'affichage : la simulation le lira plus tard.
import type { NpcRole } from "./placeholderData";
import type { LootEntry, SimClass } from "../sim/protocol";
import type { ItemStats } from "../sim/rules";
import { CLASS_RULES } from "../sim/rules.ts";

export interface Point {
  x: number;
  y: number;
}

export interface Camp extends Point {
  kind: "camp";
  id: number;
  creature: string;
  minLevel: number;
  maxLevel: number;
  count: number;
  radius: number; // zone de déplacement, en tuiles
  respawn: number; // délai de réapparition, en secondes
  loot: LootEntry[];
}

export interface Npc extends Point {
  kind: "npc";
  id: number;
  name: string;
  role: NpcRole;
  trainerClass: number;
}

export interface Path {
  kind: "path";
  id: number;
  points: Point[];
}

export type QuestType = "kill" | "collect" | "deliver" | "explore";

export interface Quest {
  kind: "quest";
  id: number;
  name: string;
  type: QuestType;
  giverId: number | null; // PNJ de départ
  enderId: number | null; // PNJ d'arrivée
  prevId: number | null; // quête à finir avant (enchaînement)
  minLevel: number;
  campId: number | null; // tuer / ramasser : camp visé
  count: number;
  dropChance: number; // ramasser : chance (%) qu'une créature tuée donne l'objet
  objectItem: string; // ramasser / livrer : nom de l'objet de quête
  target: Point | null; // explorer : lieu à découvrir
  xp: number;
  gold: number; // en pièces de cuivre
  rewardItemId: number | null;
}

// Un objet : repris de 3.3.5 (source = son numéro) ou inventé.
export interface Item extends ItemStats {
  kind: "item";
  id: number;
  name: string;
  icon: string | null; // icône du pack
  quality: number; // 0 médiocre … 4 épique
  source: number | null;
}

// Réglages des classes (un seul par partie).
export interface ClassSettings {
  kind: "classes";
  id: number;
  classes: SimClass[]; // dans l'ordre de CLASSES
}

export interface Boss {
  id: number;
  name: string;
  level: number;
  health: number; // %
  loot: LootEntry[];
}

// Le Gouffre de Ragefeu (un seul par partie).
export interface Dungeon {
  kind: "dungeon";
  id: number;
  minLevel: number;
  maxLevel: number;
  difficulty: number; // %
  trash: number;
  bosses: Boss[];
}

export type Entity = Camp | Npc | Path | Quest | Item | ClassSettings | Dungeon;

export const defaultClasses = (): SimClass[] => CLASS_RULES.map((c) => ({ power: c.power, survival: c.survival }));

// Ce qui empêche une quête d'être proposée aux joueurs (vide si tout va bien).
export function questProblems(q: Quest, content: Content): ("giver" | "ender" | "camp" | "target")[] {
  const out: ("giver" | "ender" | "camp" | "target")[] = [];
  if (content.get(q.giverId)?.kind !== "npc") out.push("giver");
  if (content.get(q.enderId)?.kind !== "npc") out.push("ender");
  if ((q.type === "kill" || q.type === "collect") && content.get(q.campId)?.kind !== "camp") out.push("camp");
  if (q.type === "explore" && !q.target) out.push("target");
  return out;
}

export class Content {
  readonly entities = new Map<number, Entity>();
  private nextId = 1;
  private listeners: (() => void)[] = [];

  add<T extends Entity>(e: T): T {
    e.id = this.nextId++;
    this.entities.set(e.id, e);
    this.changed();
    return e;
  }

  // Un numéro libre, pour ce qui n'est pas un élément à part (un boss).
  newId() {
    return this.nextId++;
  }

  // Supprime un élément ; les quêtes et tables de butin qui y faisaient référence perdent ce lien.
  remove(id: number) {
    if (!this.entities.delete(id)) return;
    for (const e of this.entities.values()) {
      if (e.kind === "camp") e.loot = e.loot.filter((l) => l.itemId !== id);
      if (e.kind === "dungeon") for (const b of e.bosses) b.loot = b.loot.filter((l) => l.itemId !== id);
      if (e.kind !== "quest") continue;
      if (e.rewardItemId === id) e.rewardItemId = null;
      if (e.giverId === id) e.giverId = null;
      if (e.enderId === id) e.enderId = null;
      if (e.prevId === id) e.prevId = null;
      if (e.campId === id) e.campId = null;
    }
    this.changed();
  }

  // Pour le fichier de partie.
  serialize(): { nextId: number; entities: Entity[] } {
    return { nextId: this.nextId, entities: structuredClone([...this.entities.values()]) };
  }

  load(data: { nextId: number; entities: Entity[] }) {
    this.entities.clear();
    for (const e of data.entities) {
      // Parties d'avant l'étape 9
      if (e.kind === "camp") e.loot ??= [];
      if (e.kind === "quest") e.rewardItemId ??= null;
      this.entities.set(e.id, e);
    }
    this.nextId = data.nextId;
    this.changed();
  }

  items(): Item[] {
    return [...this.entities.values()].filter((e): e is Item => e.kind === "item");
  }

  // Les réglages des classes, créés au premier besoin.
  classSettings(): ClassSettings {
    for (const e of this.entities.values()) if (e.kind === "classes") return e;
    return this.add<ClassSettings>({ kind: "classes", id: 0, classes: defaultClasses() });
  }

  dungeon(): Dungeon {
    for (const e of this.entities.values()) if (e.kind === "dungeon") return e;
    return this.add<Dungeon>({ kind: "dungeon", id: 0, minLevel: 13, maxLevel: 18, difficulty: 100, trash: 6, bosses: [] });
  }

  quests(): Quest[] {
    return [...this.entities.values()].filter((e): e is Quest => e.kind === "quest");
  }

  get(id: number | null): Entity | undefined {
    return id === null ? undefined : this.entities.get(id);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  changed() {
    for (const fn of this.listeners) fn();
  }
}
