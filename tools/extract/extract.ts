// Outil d'extraction : fabrique le pack de ressources local (dossier resource-pack/, jamais envoyé sur GitHub).
// Données de jeu tirées des fichiers SQL d'AzerothCore ; icônes et terrain tirés du client 3.3.5a (s'il est indiqué).
// Les modèles 3D sont rendus en planches d'images (8 directions, quelques images par animation).
//
// Utilisation : npm run extract -- --azerothcore <dossier azerothcore-wotlk> [--client <dossier du client>]
// Les chemins peuvent aussi être mis dans extract.local.json (ignoré par git).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractIcons } from "./icons.ts";
import { extractModels } from "./models.ts";
import { MpqStack } from "./mpq.ts";
import { readTable, type Row } from "./sqlDump.ts";
import { extractTerrain } from "./terrain.ts";
import { statsOf3355 } from "../../src/sim/rules.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const PACK = join(ROOT, "resource-pack");
const OUT = join(PACK, "data");

function config(): { azerothcore: string; client?: string } {
  const local = join(ROOT, "extract.local.json");
  const cfg = existsSync(local) ? JSON.parse(readFileSync(local, "utf8")) : {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) cfg[args[i].replace(/^--/, "")] = args[i + 1];
  if (!cfg.azerothcore) throw new Error("Indique le dossier d'AzerothCore : --azerothcore <dossier>");
  return cfg;
}

const num = (v: Row[string]) => Number(v ?? 0);
const str = (v: Row[string]) => String(v ?? "");

function frNames(rows: Row[], idCol: string, nameCol: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of rows) if (r.locale === "frFR" && str(r[nameCol])) m.set(num(r[idCol]), str(r[nameCol]));
  return m;
}

function write(name: string, data: unknown) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data));
  const count = Array.isArray(data) ? data.length : Object.keys(data as object).length;
  console.log(`  ${name}.json : ${count} entrées`);
}

const cfg = config();
const sqlDir = join(cfg.azerothcore, "data", "sql", "base", "db_world");
if (!existsSync(sqlDir)) throw new Error(`Fichiers SQL introuvables : ${sqlDir}`);
mkdirSync(OUT, { recursive: true });
console.log(`Lecture des données d'AzerothCore dans ${sqlDir}`);

// --- Objets ---
let items: { id: number; displayId: number; itemLevel: number; icon?: string }[];
{
  const fr = frNames(readTable(sqlDir, "item_template_locale"), "ID", "Name");
  items = readTable(sqlDir, "item_template").map((r) => {
    const stats: Record<number, number> = {};
    for (let k = 1; k <= 10; k++) if (num(r[`stat_value${k}`])) stats[num(r[`stat_type${k}`])] = num(r[`stat_value${k}`]);
    const id = num(r.entry);
    return {
      id,
      name: { fr: fr.get(id) ?? str(r.name), en: str(r.name) },
      class: num(r.class),
      subclass: num(r.subclass),
      quality: num(r.Quality),
      slot: num(r.InventoryType),
      itemLevel: num(r.ItemLevel),
      requiredLevel: num(r.RequiredLevel),
      allowableClass: num(r.AllowableClass),
      displayId: num(r.displayid),
      stats,
      armor: num(r.armor),
      damage: num(r.dmg_max1) ? [num(r.dmg_min1), num(r.dmg_max1)] : undefined,
      delay: num(r.delay) || undefined,
      sellPrice: num(r.SellPrice),
    };
  });
}

// --- Créatures ---
{
  const fr = frNames(readTable(sqlDir, "creature_template_locale"), "entry", "Name");
  const models = new Map<number, number[]>();
  for (const r of readTable(sqlDir, "creature_template_model")) {
    const id = num(r.CreatureID);
    models.set(id, [...(models.get(id) ?? []), num(r.CreatureDisplayID)]);
  }
  const creatures = readTable(sqlDir, "creature_template").map((r) => {
    const id = num(r.entry);
    return {
      id,
      name: { fr: fr.get(id) ?? str(r.name), en: str(r.name) },
      minLevel: num(r.minlevel),
      maxLevel: num(r.maxlevel),
      rank: num(r.rank), // 0 normal, 1 élite, 2 élite rare, 3 boss, 4 rare
      type: num(r.type),
      family: num(r.family),
      unitClass: num(r.unit_class),
      faction: num(r.faction),
      attackTime: num(r.BaseAttackTime),
      health: num(r.HealthModifier),
      damage: num(r.DamageModifier),
      armor: num(r.ArmorModifier),
      displayIds: models.get(id) ?? [],
    };
  });
  write("creatures", creatures);

  // Stats de base d'une créature selon son niveau et sa classe (multipliées par les modificateurs ci-dessus).
  write(
    "creatureLevelStats",
    readTable(sqlDir, "creature_classlevelstats").map((r) => ({
      level: num(r.level),
      unitClass: num(r.class),
      health: num(r.basehp0),
      mana: num(r.basemana),
      armor: num(r.basearmor),
      attackPower: num(r.attackpower),
      damage: num(r.damage_base),
    })),
  );
}

// --- Joueurs : classes, races, XP ---
write(
  "classStats",
  readTable(sqlDir, "player_class_stats").map((r) => ({
    class: num(r.Class),
    level: num(r.Level),
    health: num(r.BaseHP),
    mana: num(r.BaseMana),
    str: num(r.Strength),
    agi: num(r.Agility),
    sta: num(r.Stamina),
    int: num(r.Intellect),
    spi: num(r.Spirit),
  })),
);
write(
  "raceStats",
  readTable(sqlDir, "player_race_stats").map((r) => ({
    race: num(r.Race),
    str: num(r.Strength),
    agi: num(r.Agility),
    sta: num(r.Stamina),
    int: num(r.Intellect),
    spi: num(r.Spirit),
  })),
);
write(
  "xpForLevel",
  readTable(sqlDir, "player_xp_for_level").map((r) => ({ level: num(r.Level), xp: num(r.Experience) })),
);

// --- Sorts appris chez les maîtres de classe (type 0 = maître de classe, Requirement = classe) ---
let classSpells: { class: number; spell: number; level: number; cost: number; icon?: string }[];
{
  const trainerClass = new Map<number, number>();
  for (const r of readTable(sqlDir, "trainer")) if (num(r.Type) === 0) trainerClass.set(num(r.Id), num(r.Requirement));
  const best = new Map<string, { class: number; spell: number; level: number; cost: number }>();
  for (const r of readTable(sqlDir, "trainer_spell")) {
    const cls = trainerClass.get(num(r.TrainerId));
    if (cls === undefined) continue;
    const key = `${cls}:${num(r.SpellId)}`;
    const entry = { class: cls, spell: num(r.SpellId), level: num(r.ReqLevel), cost: num(r.MoneyCost) };
    const prev = best.get(key);
    if (!prev || entry.level < prev.level) best.set(key, entry);
  }
  classSpells = [...best.values()].sort((a, b) => a.class - b.class || a.level - b.level);
}

// --- Client 3.3.5a : icônes et terrain ---
if (cfg.client) {
  console.log(`Lecture du client dans ${cfg.client}`);
  const mpq = new MpqStack(cfg.client);
  // Icônes des objets jusqu'au niveau d'objet 30 (la zone va jusqu'au niveau 20 environ) et des sorts de classe.
  const displays = new Map(items.filter((i) => i.itemLevel <= 30 && i.displayId).map((i) => [i.id, i.displayId]));
  const { itemIcons, spellIcons } = extractIcons(mpq, PACK, displays, new Set(classSpells.map((s) => s.spell)));
  for (const i of items) i.icon = itemIcons.get(i.id);
  for (const s of classSpells) s.icon = spellIcons.get(s.spell);
  // Points tirés d'AzerothCore : arrivée des orcs et entrée du Gouffre de Ragefeu
  const orc = readTable(sqlDir, "playercreateinfo").find((r) => num(r.race) === 2)!;
  const trigger = readTable(sqlDir, "areatrigger_teleport").find((r) => num(r.target_map) === 389)!;
  const portal = readTable(sqlDir, "areatrigger").find((r) => num(r.entry) === num(trigger.ID))!;
  extractTerrain(mpq, PACK, {
    start: { x: num(orc.position_x), y: num(orc.position_y) },
    ragefire: { x: num(portal.x), y: num(portal.y) },
  });
  extractModels(mpq, PACK);
  mpq.close();
}
write("items", items);
write("classSpells", classSpells);

// --- Gouffre de Ragefeu : les quatre boss, leur niveau et leur butin d'équipement ---
// Le butin est souvent rangé dans des tables de référence : on en suit un niveau.
const RAGEFIRE_BOSSES = [11517, 11520, 11518, 11519]; // Oggleflint, Taragaman, Jergosh, Bazzalan (ordre de la visite)
type RawItem = Parameters<typeof statsOf3355>[0] & { id: number; quality: number; itemLevel: number; name: unknown; icon?: string };
const byId = new Map((items as unknown as RawItem[]).map((i) => [i.id, i]));
const wearable = (id: number) => {
  const i = byId.get(id);
  return i && i.quality >= 1 && i.quality <= 4 && statsOf3355(i) ? i : null;
};
{
  const refs = new Map<number, Row[]>();
  for (const r of readTable(sqlDir, "reference_loot_template")) refs.set(num(r.Entry), [...(refs.get(num(r.Entry)) ?? []), r]);
  // Chance d'une ligne : sa chance, ou une part égale de son groupe quand elle vaut 0
  const chances = (rows: Row[]) =>
    rows.map((r) => {
      const c = num(r.Chance);
      if (c > 0 || !num(r.GroupId)) return c || 100;
      const group = rows.filter((o) => num(o.GroupId) === num(r.GroupId));
      const fixed = group.reduce((s, o) => s + num(o.Chance), 0);
      return Math.max(0, 100 - fixed) / group.filter((o) => !num(o.Chance)).length;
    });
  const loot = readTable(sqlDir, "creature_loot_template");
  const creatures = new Map(readTable(sqlDir, "creature_template").map((r) => [num(r.entry), r]));
  const fr = frNames(readTable(sqlDir, "creature_template_locale"), "entry", "Name");
  const bosses = RAGEFIRE_BOSSES.map((entry) => {
    const rows = loot.filter((r) => num(r.Entry) === entry);
    const drops = new Map<number, number>();
    const add = (item: number, chance: number) => {
      if (wearable(item)) drops.set(item, Math.min(100, (drops.get(item) ?? 0) + chance));
    };
    chances(rows).forEach((c, k) => {
      const r = rows[k];
      if (!num(r.Reference)) return add(num(r.Item), c);
      const sub = refs.get(num(r.Reference)) ?? [];
      chances(sub).forEach((c2, j) => add(num(sub[j].Item), (c * c2) / 100));
    });
    const c = creatures.get(entry)!;
    return {
      entry,
      name: { fr: fr.get(entry) ?? str(c.name), en: str(c.name) },
      level: num(c.maxlevel),
      // Les objets les plus probables (au moins 2 %)
      loot: [...drops].filter(([, ch]) => ch >= 2).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([item, chance]) => ({ item, chance: Math.round(chance) })),
    };
  });
  write("ragefire", bosses);

  // Objets proposés dans l'outil « Objets » : l'équipement de la zone (jusqu'au niveau 25), plus le butin des boss.
  const keep = new Set(bosses.flatMap((b) => b.loot.map((l) => l.item)));
  for (const i of byId.values()) if (i.itemLevel <= 30 && i.requiredLevel <= 25 && wearable(i.id)) keep.add(i.id);
  write(
    "zoneItems",
    [...keep].map((id) => {
      const i = byId.get(id)!;
      return { id, name: i.name, icon: i.icon, quality: i.quality, ...statsOf3355(i)! };
    }),
  );
}

writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify({ source: cfg.client ? "azerothcore+client" : "azerothcore", extractedAt: new Date().toISOString() }, null, 2),
);
console.log(`Pack de ressources écrit dans ${PACK}`);
