// Icônes du client (objets, sorts, classes), converties en PNG dans icons/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeBlp } from "./blp.ts";
import { Dbc } from "./dbc.ts";
import type { MpqStack } from "./mpq.ts";
import { encodePng } from "./png.ts";

// Ordre des classes dans l'image des classes de l'écran de création (cases de 64 pixels, 4 par ligne).
const CLASS_ATLAS: Record<number, [number, number]> = {
  1: [0, 0], 8: [1, 0], 4: [2, 0], 11: [3, 0], 3: [0, 1], 7: [1, 1], 5: [2, 1], 9: [3, 1], 2: [0, 2],
};

// Renvoie le nom d'icône (en minuscules, sans chemin) de chaque objet et de chaque sort demandés.
export function extractIcons(mpq: MpqStack, out: string, displayIds: Map<number, number>, spellIds: Set<number>) {
  const dir = join(out, "icons");
  mkdirSync(dir, { recursive: true });
  const written = new Set<string>();
  let missing = 0;
  const save = (name: string): string | undefined => {
    const key = name.toLowerCase();
    if (written.has(key)) return key;
    const file = mpq.readFile(`Interface/Icons/${name}.blp`);
    if (!file) {
      missing++;
      return undefined;
    }
    const img = decodeBlp(file)[0];
    writeFileSync(join(dir, `${key}.png`), encodePng(img.width, img.height, img.data));
    written.add(key);
    return key;
  };

  // Objets : numéro d'apparence → icône
  const idi = new Dbc(mpq.readFile("DBFilesClient/ItemDisplayInfo.dbc")!);
  const iconOfDisplay = new Map<number, string>();
  for (let r = 0; r < idi.rows; r++) iconOfDisplay.set(idi.int(r, 0), idi.string(r, 5));
  const itemIcons = new Map<number, string>();
  for (const [item, display] of displayIds) {
    const name = iconOfDisplay.get(display);
    const key = name && save(name);
    if (key) itemIcons.set(item, key);
  }

  // Sorts : icône du sort
  const spell = new Dbc(mpq.readFile("DBFilesClient/Spell.dbc")!);
  const si = new Dbc(mpq.readFile("DBFilesClient/SpellIcon.dbc")!);
  const iconPath = new Map<number, string>();
  for (let r = 0; r < si.rows; r++) iconPath.set(si.int(r, 0), si.string(r, 1));
  const spellIcons = new Map<number, string>();
  for (let r = 0; r < spell.rows; r++) {
    const id = spell.int(r, 0);
    if (!spellIds.has(id)) continue;
    const path = iconPath.get(spell.int(r, 133));
    const key = path && save(path.split("\\").pop()!);
    if (key) spellIcons.set(id, key);
  }

  // Classes : découpées dans l'image de l'écran de création
  const atlasFile = mpq.readFile("Interface/Glues/CharacterCreate/UI-CharacterCreate-Classes.blp");
  if (atlasFile) {
    const atlas = decodeBlp(atlasFile)[0];
    const cell = atlas.width / 4;
    for (const [cls, [cx, cy]] of Object.entries(CLASS_ATLAS)) {
      const img = new Uint8Array(cell * cell * 4);
      for (let y = 0; y < cell; y++) img.set(atlas.data.subarray(((cy * cell + y) * atlas.width + cx * cell) * 4, ((cy * cell + y) * atlas.width + cx * cell + cell) * 4), y * cell * 4);
      writeFileSync(join(dir, `class_${cls}.png`), encodePng(cell, cell, img));
    }
  }
  console.log(`  icons/ : ${written.size} icônes d'objets et de sorts${missing ? ` (${missing} introuvables)` : ""}, ${atlasFile ? 9 : 0} icônes de classe`);
  return { itemIcons, spellIcons };
}
