// Modèles 3D du client « photographiés » en planches d'images : 8 directions × quelques images par animation.
// Créatures : modèle + texture de variante. Personnages : modèle de race, texture d'habits pré-assemblée par le client
// (celle des PNJ), sous-maillages choisis selon la coiffure et l'équipement.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeBlp, type Image } from "./blp.ts";
import { Dbc } from "./dbc.ts";
import { findSequence, loadM2, pose, type M2 } from "./m2.ts";
import type { MpqStack } from "./mpq.ts";
import { encodePng } from "./png.ts";
import { bounds, draw, project, type Model } from "./render.ts";

const PX_PER_YARD = 16;
// Animations photographiées : numéros d'animation du client (le premier présent est pris) et nombre d'images.
const ANIMS: { name: string; ids: number[]; frames: number; last?: boolean }[] = [
  { name: "stand", ids: [0], frames: 1 },
  { name: "walk", ids: [4, 5], frames: 8 },
  { name: "attack", ids: [16, 17, 18], frames: 6 },
  { name: "death", ids: [1], frames: 1, last: true }, // seulement la pose finale, au sol
];
// Créatures du jeu → créature réelle (numéro d'apparence du client)
export const CREATURE_DISPLAYS: Record<string, number> = {
  sanglier: 503, scorpide: 2485, quasit: 1185, raptor: 1960, hyene: 4636,
  harpie: 3012, centaure: 9442, murloc: 617, troll: 4079, humain: 3734,
};
// Races jouables, dans l'ordre de la simulation : numéro de race du client et dossier du modèle
const RACES = [[2, "Orc"], [8, "Troll"], [6, "Tauren"], [5, "Scourge"], [10, "BloodElf"]] as const;
const LOOKS_PER_RACE_SEX = 2;

export interface SheetInfo {
  file: string;
  w: number; // taille d'une image
  h: number;
  ax: number; // position des pieds dans l'image
  ay: number;
  anims: Record<string, [number, number]>; // première colonne, nombre d'images
}

interface Tables {
  cdi: Dbc; cdiRow: Map<number, number>;
  cmd: Map<number, string>;
  extra: Dbc; extraRow: Map<number, number>;
  idi: Dbc; idiRow: Map<number, number>;
  sections: Dbc;
  hair: Dbc;
  facial: Dbc;
}

function rowIndex(d: Dbc) {
  const m = new Map<number, number>();
  for (let r = 0; r < d.rows; r++) m.set(d.int(r, 0), r);
  return m;
}

export function extractModels(mpq: MpqStack, out: string) {
  const dir = join(out, "models");
  mkdirSync(dir, { recursive: true });
  const load = (n: string) => new Dbc(mpq.readFile(`DBFilesClient/${n}.dbc`)!);
  const cdi = load("CreatureDisplayInfo"), cmdDbc = load("CreatureModelData"), extra = load("CreatureDisplayInfoExtra"), idi = load("ItemDisplayInfo");
  const cmd = new Map<number, string>();
  for (let r = 0; r < cmdDbc.rows; r++) cmd.set(cmdDbc.int(r, 0), cmdDbc.string(r, 2));
  const T: Tables = {
    cdi, cdiRow: rowIndex(cdi), cmd, extra, extraRow: rowIndex(extra), idi, idiRow: rowIndex(idi),
    sections: load("CharSections"), hair: load("CharHairGeosets"), facial: load("CharacterFacialHairStyles"),
  };
  const texCache = new Map<string, Image | null>();
  const tex = (name: string) => {
    const key = name.toLowerCase();
    if (!texCache.has(key)) {
      const f = name ? mpq.readFile(name) : null;
      texCache.set(key, f ? decodeBlp(f)[0] : null);
    }
    return texCache.get(key)!;
  };

  const index: Record<string, SheetInfo> = {};
  const save = (key: string, model: Model | null, scale: number) => {
    if (!model) return console.log(`  modèle introuvable : ${key}`);
    index[key] = renderSheet(model, scale, join(dir, `${key}.png`), `${key}.png`);
  };

  // --- Créatures du jeu ---
  for (const [key, display] of Object.entries(CREATURE_DISPLAYS)) {
    const r = T.cdiRow.get(display);
    if (r === undefined) continue;
    const extraId = cdi.int(r, 3);
    const path = T.cmd.get(cdi.int(r, 1)) ?? "";
    // Les petites créatures sont un peu grossies pour rester lisibles sur la carte.
    const scale = Math.max(0.8, cdi.float(r, 4) || 1);
    const model = extraId ? characterModel(mpq, T, tex, path, extraId) : creatureModel(mpq, tex, path, [6, 7, 8].map((f) => cdi.string(r, f)));
    save(key, model, scale);
  }

  // --- Joueurs : quelques apparences de PNJ par race et par sexe ---
  RACES.forEach(([race, folder], ri) => {
    for (const sex of [0, 1]) {
      const path = `Character\\${folder}\\${sex ? "Female" : "Male"}\\${folder}${sex ? "Female" : "Male"}.m2`;
      let n = 0;
      for (let r = 0; r < extra.rows && n < LOOKS_PER_RACE_SEX; r++) {
        // Avec texture pré-assemblée, une tenue (torse et jambes) et sans casque (les casques ne sont pas encore dessinés)
        if (extra.int(r, 1) !== race || extra.int(r, 2) !== sex || !extra.string(r, 20)) continue;
        if (!extra.int(r, 11) || !extra.int(r, 13) || extra.int(r, 8)) continue;
        const model = characterModel(mpq, T, tex, path, extra.int(r, 0));
        if (!model) continue;
        save(`player_${ri}_${sex}_${n}`, model, 1);
        n++;
      }
    }
  });

  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
  console.log(`  models/ : ${Object.keys(index).length} planches d'images`);
}

function creatureModel(mpq: MpqStack, tex: (n: string) => Image | null, path: string, variations: string[]): Model | null {
  const m = loadM2(mpq, path);
  if (!m) return null;
  const folder = path.slice(0, path.lastIndexOf("\\") + 1);
  const textures = m.textures.map((t) => (t.type === 0 ? tex(t.name) : t.type >= 11 && t.type <= 13 && variations[t.type - 11] ? tex(`${folder}${variations[t.type - 11]}.blp`) : null));
  return { m, textures, submeshes: new Set(m.submeshes.map((_, i) => i)) };
}

function characterModel(mpq: MpqStack, T: Tables, tex: (n: string) => Image | null, path: string, extraId: number): Model | null {
  const m = loadM2(mpq, path);
  const r = T.extraRow.get(extraId);
  if (!m || r === undefined) return null;
  const e = (k: number) => T.extra.int(r, k);
  const race = e(1), sex = e(2), skin = e(3), hairStyle = e(5), hairColor = e(6), facialHair = e(7);
  const baked = tex(`Textures\\BakedNpcTextures\\${T.extra.string(r, 20)}`);
  if (!baked) return null;
  const section = (type: number, variation: number, color: number, field = 4) => {
    for (let k = 0; k < T.sections.rows; k++) {
      const s = T.sections;
      if (s.int(k, 1) === race && s.int(k, 2) === sex && s.int(k, 3) === type && s.int(k, 8) === variation && s.int(k, 9) === color) return s.string(k, field);
    }
    return "";
  };
  // Valeur affichée de chaque groupe de sous-maillages (groupe × 100 + valeur)
  const groups: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 7: 2, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 15: 1, 18: 1 };
  let hairGeoset = 1;
  for (let k = 0; k < T.hair.rows; k++) if (T.hair.int(k, 1) === race && T.hair.int(k, 2) === sex && T.hair.int(k, 3) === hairStyle) hairGeoset = T.hair.int(k, 4);
  for (let k = 0; k < T.facial.rows; k++)
    if (T.facial.int(k, 0) === race && T.facial.int(k, 1) === sex && T.facial.int(k, 2) === facialHair) {
      groups[1] = T.facial.int(k, 3) + 1;
      groups[3] = T.facial.int(k, 4) + 1;
      groups[2] = T.facial.int(k, 5) + 1;
    }
  // Équipement : chaque objet peut changer quelques groupes (gants, bottes, manches, robe…)
  const item = (slot: number) => {
    const id = e(8 + slot);
    const ir = id ? T.idiRow.get(id) : undefined;
    return ir === undefined ? null : { g: [T.idi.int(ir, 7), T.idi.int(ir, 8), T.idi.int(ir, 9)], tex: T.idi.string(ir, 3) };
  };
  const [shirt, chest, belt, legs, boots, gloves, tabard, cape] = [2, 3, 4, 5, 6, 8, 9, 10].map(item);
  for (const top of [shirt, chest]) if (top?.g[0]) groups[8] = top.g[0] + 1;
  if (chest?.g[1]) groups[10] = chest.g[1] + 1;
  if (chest?.g[2]) groups[13] = chest.g[2] + 1;
  if (legs?.g[0]) groups[11] = legs.g[0] + 1;
  if (legs?.g[1]) groups[9] = legs.g[1] + 1;
  if (legs?.g[2]) groups[13] = legs.g[2] + 1;
  if (boots?.g[0]) groups[5] = boots.g[0] + 1;
  if (gloves?.g[0]) groups[4] = gloves.g[0] + 1;
  if (belt?.g[0]) groups[18] = belt.g[0] + 1;
  if (tabard) groups[12] = 2;
  const capeTex = cape?.tex ? tex(`Item\\ObjectComponents\\Cape\\${cape.tex}.blp`) : null;
  if (capeTex) groups[15] = (cape!.g[0] || 0) + 1;
  else delete groups[15];

  const submeshes = new Set<number>();
  m.submeshes.forEach((s, i) => {
    const group = Math.floor(s.id / 100), value = s.id % 100;
    if (s.id === 0 || (group === 0 && value === hairGeoset) || (group > 0 && groups[group] === value)) submeshes.add(i);
  });
  const textures = m.textures.map((t) => {
    if (t.type === 0) return null; // lueur des yeux des chevaliers de la mort : ignorée
    if (t.type === 1) return baked;
    if (t.type === 2) return capeTex;
    if (t.type === 6) return tex(section(3, hairStyle, hairColor));
    if (t.type === 8) return tex(section(0, 0, skin, 5)); // fourrure (taurens)
    return null;
  });
  return { m, textures, submeshes };
}

function renderSheet(model: Model, scale: number, file: string, name: string): SheetInfo {
  const m: M2 = model.m;
  const px = PX_PER_YARD * scale;
  // Toutes les poses, pour connaître la taille commune des images
  const poses: { anim: string; mats: ReturnType<typeof pose> }[] = [];
  for (const a of ANIMS) {
    const seq = findSequence(m, a.ids);
    const fallback = findSequence(m, [0]);
    for (let f = 0; f < a.frames; f++) {
      const s = seq >= 0 ? seq : fallback;
      const dur = s >= 0 ? m.sequences[s].duration : 0;
      const time = a.last ? Math.max(0, dur - 1) : (dur * f) / a.frames;
      poses.push({ anim: a.name, mats: s >= 0 ? pose(m, s, time) : pose(m, 0, 0) });
    }
  }
  const projected: Float64Array[][] = [];
  const acc = [Infinity, Infinity, -Infinity, -Infinity];
  for (let d = 0; d < 8; d++) {
    projected.push(poses.map((p) => project(model, p.mats, (d * Math.PI) / 4, px)));
    for (const p of projected[d]) bounds(model, p, acc);
  }
  const ss = 2;
  const ax = Math.ceil(-acc[0] / ss) + 2, ay = Math.ceil(-acc[1] / ss) + 2;
  const w = ax + Math.ceil(acc[2] / ss) + 2, h = ay + Math.ceil(acc[3] / ss) + 2;
  const cols = poses.length;
  const sheet = new Uint8Array(w * cols * h * 8 * 4);
  for (let d = 0; d < 8; d++)
    projected[d].forEach((p, c) => {
      const img = draw(model, p, w, h, ax, ay);
      for (let y = 0; y < h; y++) sheet.set(img.subarray(y * w * 4, (y + 1) * w * 4), ((d * h + y) * w * cols + c * w) * 4);
    });
  writeFileSync(file, encodePng(w * cols, h * 8, sheet));
  const anims: Record<string, [number, number]> = {};
  let col = 0;
  for (const a of ANIMS) {
    anims[a.name] = [col, a.frames];
    col += a.frames;
  }
  return { file: name, w, h, ax, ay, anims };
}
