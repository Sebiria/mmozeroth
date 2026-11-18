// Règles de jeu partagées par la simulation et l'interface : classes, arbres de talents, objets.
// Les chiffres par défaut sont un point de départ : ils se règlent dans l'outil « Classes ».

export type Role = "tank" | "heal" | "dps";
export type Stat = "str" | "agi" | "int" | "sta" | "none";
type Name = { fr: string; en: string };

export const MAX_LEVEL = 20;
export const TALENT_LEVEL = 10; // niveau où le joueur choisit son arbre de talents

export interface TalentTree {
  name: Name;
  role: Role;
  power: number; // multiplicateurs appliqués à la classe
  survival: number;
}

export interface ClassRule {
  id: number; // numéro de classe de 3.3.5
  stats: Stat[]; // caractéristiques utiles
  armor: number; // armure la plus lourde portée à bas niveau : 0 tissu, 1 cuir, 2 mailles, 3 plaques
  power: number; // réglages par défaut (%)
  survival: number;
  trees: [TalentTree, TalentTree, TalentTree];
}

const t = (fr: string, en: string, role: Role, power = 1, survival = 1): TalentTree => ({ name: { fr, en }, role, power, survival });

// Dans l'ordre de CLASSES (indice utilisé par la simulation).
export const CLASS_RULES: ClassRule[] = [
  { id: 1, stats: ["str"], armor: 2, power: 100, survival: 110, trees: [t("Armes", "Arms", "dps", 1.1), t("Fureur", "Fury", "dps", 1.15, 0.95), t("Protection", "Protection", "tank", 0.75, 1.4)] },
  { id: 2, stats: ["str", "int"], armor: 2, power: 90, survival: 115, trees: [t("Sacré", "Holy", "heal", 0.8, 1.05), t("Protection", "Protection", "tank", 0.75, 1.4), t("Vindicte", "Retribution", "dps", 1.15)] },
  { id: 3, stats: ["agi"], armor: 1, power: 110, survival: 95, trees: [t("Maîtrise des bêtes", "Beast Mastery", "dps", 1.05, 1.1), t("Précision", "Marksmanship", "dps", 1.15), t("Survie", "Survival", "dps", 1.1, 1.05)] },
  { id: 4, stats: ["agi"], armor: 1, power: 115, survival: 85, trees: [t("Assassinat", "Assassination", "dps", 1.15), t("Combat", "Combat", "dps", 1.1, 1.05), t("Finesse", "Subtlety", "dps", 1.05, 1.1)] },
  { id: 5, stats: ["int"], armor: 0, power: 90, survival: 85, trees: [t("Discipline", "Discipline", "heal", 0.85, 1.1), t("Sacré", "Holy", "heal", 0.8, 1.05), t("Ombre", "Shadow", "dps", 1.15)] },
  { id: 7, stats: ["int", "agi"], armor: 1, power: 100, survival: 100, trees: [t("Élémentaire", "Elemental", "dps", 1.15), t("Amélioration", "Enhancement", "dps", 1.1, 1.05), t("Restauration", "Restoration", "heal", 0.8, 1.05)] },
  { id: 8, stats: ["int"], armor: 0, power: 115, survival: 75, trees: [t("Arcanes", "Arcane", "dps", 1.1), t("Feu", "Fire", "dps", 1.15), t("Givre", "Frost", "dps", 1.05, 1.1)] },
  { id: 9, stats: ["int"], armor: 0, power: 105, survival: 90, trees: [t("Affliction", "Affliction", "dps", 1.1), t("Démonologie", "Demonology", "dps", 1.05, 1.15), t("Destruction", "Destruction", "dps", 1.15)] },
  { id: 11, stats: ["int", "agi"], armor: 1, power: 100, survival: 100, trees: [t("Équilibre", "Balance", "dps", 1.15), t("Combat farouche", "Feral Combat", "tank", 0.8, 1.35), t("Restauration", "Restoration", "heal", 0.8, 1.05)] },
];

// --- Objets ---
export const SLOTS = ["head", "neck", "shoulder", "back", "chest", "wrist", "hands", "waist", "legs", "feet", "finger", "trinket", "mainhand", "offhand", "ranged"] as const;
export type Slot = (typeof SLOTS)[number];

// Emplacement d'un objet de 3.3.5 d'après son type d'équipement (InventoryType) ; null : ne se porte pas.
export function slotOfInventoryType(t: number): Slot | null {
  const m: Record<number, Slot> = {
    1: "head", 2: "neck", 3: "shoulder", 5: "chest", 20: "chest", 6: "waist", 7: "legs", 8: "feet", 9: "wrist", 10: "hands",
    11: "finger", 12: "trinket", 13: "mainhand", 17: "mainhand", 21: "mainhand", 14: "offhand", 22: "offhand", 23: "offhand",
    15: "ranged", 25: "ranged", 26: "ranged", 16: "back",
  };
  return m[t] ?? null;
}

// Ce que la simulation sait d'un objet.
export interface ItemStats {
  slot: Slot;
  level: number; // niveau requis
  stat: Stat; // caractéristique principale
  armor: number; // type d'armure (0 à 3), −1 si ce n'est pas une armure (arme, bijou, cape)
  power: number;
  survival: number;
}

// Un objet est utile à une classe s'il peut le porter et si sa caractéristique lui sert.
export function usefulFor(item: ItemStats, cls: number): boolean {
  const c = CLASS_RULES[cls];
  if (item.armor > c.armor) return false;
  return item.stat === "sta" || item.stat === "none" || c.stats.includes(item.stat);
}

// Valeur d'un objet pour une classe (0 s'il est inutile).
export function itemScore(item: ItemStats, cls: number): number {
  return usefulFor(item, cls) ? item.power + item.survival : 0;
}

// Conversion d'un objet de 3.3.5 (données d'AzerothCore) : caractéristiques, armure et dégâts d'arme.
export function statsOf3355(raw: {
  slot: number; class: number; subclass: number; requiredLevel: number;
  stats: Record<string, number>; armor: number; damage?: [number, number]; delay?: number;
}): ItemStats | null {
  const slot = slotOfInventoryType(raw.slot);
  if (!slot) return null;
  const s = (k: number) => raw.stats[k] ?? 0;
  const str = s(4), agi = s(3), int = s(5), spi = s(6), sta = s(7);
  const main = Math.max(str, agi, int);
  const stat: Stat = main > 0 ? (main === str ? "str" : main === agi ? "agi" : "int") : sta > 0 ? "sta" : "none";
  const dps = raw.damage && raw.delay ? (raw.damage[0] + raw.damage[1]) / 2 / (raw.delay / 1000) : 0;
  const armor = raw.class === 4 && raw.subclass >= 1 && raw.subclass <= 4 && slot !== "back" ? raw.subclass - 1 : -1;
  return {
    slot,
    level: raw.requiredLevel,
    stat,
    armor,
    power: Math.round(str + agi + int + spi * 0.5 + dps * 0.6),
    survival: Math.round(sta + raw.armor / 10),
  };
}
