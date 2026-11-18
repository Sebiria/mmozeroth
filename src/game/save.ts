// Fichier de partie : le contenu posé, l'état de la simulation et quelques réglages.
// Il ne contient que des références (numéros de créatures, d'icônes…), jamais de ressources du client.
import type { WorldSave } from "../sim/protocol";
import type { Entity } from "./content";
import type { MapId } from "./gameMap";

export type GameMode = "sandbox" | "career";

export interface GameSave {
  app: "mmozeroth";
  version: 1;
  mode: GameMode;
  map?: MapId; // carte sur laquelle la partie a été faite (absent : fausse carte, avant l'étape 8)
  savedAt: string; // date ISO
  content: { nextId: number; entities: Entity[] }; // contenu de l'éditeur
  published?: { nextId: number; entities: Entity[] }; // carrière : dernière mise à jour publiée
  sim: WorldSave;
  settings: { speed: number };
  camera: { x: number; y: number; zoom: number };
}

const AUTOSAVE_KEY = "mmozeroth.autosave";

export function parseSave(raw: string): GameSave {
  const s = JSON.parse(raw);
  if (s?.app !== "mmozeroth" || s.version !== 1 || !s.content || !s.sim) throw new Error("invalid save");
  return s;
}

// Le stockage du navigateur peut être bloqué (navigation privée…) : on renvoie faux plutôt que de planter.
export function storeAutosave(save: GameSave): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function readAutosave(): GameSave | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {}
}

export function downloadSave(save: GameSave) {
  const blob = new Blob([JSON.stringify(save)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mmozeroth-${save.savedAt.slice(0, 16).replace(/[:T]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Ouvre le sélecteur de fichier ; renvoie null si l'utilisateur annule.
export function pickSaveFile(): Promise<GameSave | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(parseSave(await file.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
