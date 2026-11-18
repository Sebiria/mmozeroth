// Données de 3.3.5 tirées du pack de ressources : objets de la zone, boss du Gouffre de Ragefeu, sorts par niveau.
// Sans pack, tout est vide : les objets et les boss s'inventent à la main.
import type { ItemStats } from "../sim/rules";
import { CLASS_RULES, MAX_LEVEL } from "../sim/rules.ts";

type Name = { fr: string; en: string };
export interface PackItem extends ItemStats {
  id: number;
  name: Name;
  icon?: string;
  quality: number;
}
export interface PackBoss {
  entry: number;
  name: Name;
  level: number;
  loot: { item: number; chance: number }[];
}
export interface PackSpell {
  class: number;
  spell: number;
  level: number;
  icon?: string;
}

export interface PackData {
  items: PackItem[];
  bosses: PackBoss[];
  spells: PackSpell[]; // jusqu'au niveau maximum
}

async function json<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(`/resource-pack/data/${file}`);
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadPackData(): Promise<PackData> {
  const [items, bosses, spells] = await Promise.all([
    json<PackItem[]>("zoneItems.json"),
    json<PackBoss[]>("ragefire.json"),
    json<PackSpell[]>("classSpells.json"),
  ]);
  return { items: items ?? [], bosses: bosses ?? [], spells: (spells ?? []).filter((s) => s.level <= MAX_LEVEL) };
}

// Pour la simulation : niveaux d'apprentissage des sorts de chaque classe (undefined sans pack).
export function spellLevels(data: PackData): number[][] | undefined {
  if (!data.spells.length) return undefined;
  return CLASS_RULES.map((c) => data.spells.filter((s) => s.class === c.id).map((s) => s.level));
}
