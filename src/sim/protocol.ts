// Messages échangés entre l'affichage (page) et la simulation (Web Worker).
import type { Mood, Profile, Reason } from "./mood";
import type { ItemStats, Slot } from "./rules";
import type { CareerEvent, CareerState } from "./career";

// Butin : un objet et sa chance (%) de tomber.
export interface LootEntry {
  itemId: number;
  chance: number;
}

export interface SimItem extends ItemStats {
  id: number;
}

// Réglages d'une classe (%), dans l'ordre de CLASSES.
export interface SimClass {
  power: number;
  survival: number;
}

export interface SimBoss {
  id: number;
  level: number;
  health: number; // % de la vie normale d'un boss
  loot: LootEntry[];
}

// Le Gouffre de Ragefeu : l'intérieur n'est pas dessiné, les combats y sont calculés par étapes.
export interface SimDungeon {
  gather: { x: number; y: number }; // tuile praticable devant l'entrée, où les groupes se forment
  minLevel: number; // niveaux conseillés
  maxLevel: number;
  difficulty: number; // %
  trash: number; // groupes de créatures avant les boss
  bosses: SimBoss[];
}

export interface SimCamp {
  id: number;
  x: number;
  y: number;
  minLevel: number;
  maxLevel: number;
  count: number;
  radius: number;
  respawn: number;
  loot: LootEntry[];
}

export interface SimPath {
  points: { x: number; y: number }[];
}

export interface SimNpc {
  id: number;
  x: number;
  y: number;
  trainerClass: number | null; // maître de classe : numéro de classe de 3.3.5
}

// Seules les quêtes complètes (PNJ et objectif présents) sont envoyées.
export interface SimQuest {
  id: number;
  type: "kill" | "collect" | "deliver" | "explore";
  giverId: number;
  enderId: number;
  prevId: number | null;
  minLevel: number;
  campId: number | null;
  count: number;
  dropChance: number;
  target: { x: number; y: number } | null;
  xp: number;
  gold: number;
  rewardItemId: number | null;
}

export type ToSim =
  // spellLevels : pour chaque classe, niveaux où un nouveau sort s'apprend chez le maître de classe
  | { type: "init"; width: number; height: number; walk: Uint8Array; spawn: { x: number; y: number }; players: number; spellLevels?: number[][] }
  | { type: "content"; content: SimContent }
  // Mode carrière
  | { type: "startCareer" }
  | { type: "price"; price: number }
  | { type: "servers"; count: number }
  | { type: "ad" }
  | { type: "publish"; content: SimContent; cost: number; additions: number }
  | { type: "inspect"; id: number | null } // joueur dont on veut la fiche détaillée
  | { type: "load"; state: WorldSave }
  | { type: "save" } // la simulation répond par un message « saved »
  | { type: "speed"; speed: number } // 0 = pause, sinon nombre de tours par dixième de seconde
  | { type: "setPlayers"; count: number }
  | { type: "spawn" } // la simulation répond par un message « spawned »
  | { type: "setLevel"; id: number; level: number };

export interface SimContent {
  camps: SimCamp[];
  paths: SimPath[];
  npcs: SimNpc[];
  quests: SimQuest[];
  items: SimItem[];
  classes: SimClass[];
  dungeon: SimDungeon | null;
}

export interface CareerInfo {
  state: CareerState;
  subscribers: number;
  trials: { running: number; converted: number; left: number };
  capacity: number;
  arrivalsPerDay: number;
  events: CareerEvent[];
}

export type FromSim =
  | Snapshot
  | { type: "saved"; state: WorldSave }
  | { type: "spawned"; id: number }
  | { type: "published"; ok: boolean }
  | { type: "adBought"; ok: boolean };

// État de la simulation dans un fichier de partie.
export interface WorldSave {
  time: number;
  tick: number;
  nextPlayerId: number;
  targetPlayers: number;
  kills: number;
  deaths: number;
  questsDone: number;
  departures: number;
  departureReasons: Partial<Record<Reason, number>>;
  questStats: [number, QuestStats & { ratingSum: number }][];
  campStats: [number, CampStats][];
  npcVisits: [number, number][];
  players: {
    id: number;
    name: string;
    x: number;
    y: number;
    cls: number;
    race: number;
    level: number;
    xp: number;
    hp: number;
    gold: number;
    quests: [number, { progress: number; start: number; waits: number; walk: number }][];
    done: number[];
    mood: Mood;
    seen: number[];
    sinceXp: number;
    tree: number;
    spells: number;
    gear: Partial<Record<Slot, number>>;
    dungeonsDone: number;
    trialUntil?: number;
  }[];
  dungeon?: DungeonStats;
  career?: CareerState;
  classDeaths?: number[];
}

// Un message du canal général. Le texte est choisi par l'affichage (dans la langue choisie) à partir de la clé.
export type ChatKey = Reason | "left" | "trialLeft";
export interface ChatMessage {
  from: string;
  key: ChatKey;
  variant: number;
  level: number;
  campId?: number;
  questId?: number;
  itemId?: number;
  reason?: Reason; // pour « left » : la raison du départ
}

export interface QuestStats {
  accepted: number;
  completed: number;
  rating: number; // note moyenne sur 5 (0 si aucune note)
}

export interface CampStats {
  kills: number;
  crowded: number; // joueurs arrivés alors que toutes les créatures étaient prises
}

export interface DungeonStats {
  queue: number; // joueurs qui attendent un groupe devant l'entrée
  running: number; // groupes à l'intérieur
  formed: number;
  completed: number;
  abandoned: number;
  wipes: number;
  waitSum: number; // somme des attentes avant de trouver un groupe (secondes)
  durationSum: number; // somme des durées des instances terminées
  bosses: Record<number, { kills: number; wipes: number }>;
}

export interface ClassStat {
  players: number;
  avgLevel: number;
  satisfaction: number;
  deaths: number;
}

export interface SimStats {
  players: number;
  avgLevel: number;
  maxLevel: number;
  kills: number;
  deaths: number;
  questsDone: number;
  satisfaction: number; // moyenne
  departures: number;
  departureReasons: Partial<Record<Reason, number>>;
  quests: Record<number, QuestStats>;
  camps: Record<number, CampStats>;
  npcVisits: Record<number, number>;
  dungeon: DungeonStats;
  classes: ClassStat[];
}

export interface PlayerInfo {
  id: number;
  name: string;
  race: number;
  cls: number;
  level: number;
  xp: number;
  xpNeeded: number;
  gold: number;
  profile: Profile;
  patience: number;
  satisfaction: number;
  reason: Reason;
  activity: Activity;
  quests: { id: number; progress: number; needed: number }[];
  questsDone: number;
  tree: number; // −1 avant le niveau des talents
  spells: number;
  spellsAvailable: number;
  gear: Partial<Record<Slot, number>>;
  dungeonStage: { stage: number; stages: number } | null; // dans l'instance
  dungeonsDone: number;
}

export type Activity = "quest" | "npc" | "hunt" | "wander" | "explore" | "rest" | "fight" | "dead" | "train" | "queue" | "dungeon";

// Tableaux à plat pour un envoi rapide. Les positions sont en tuiles non arrondies.
// Joueur : x, y, classe (indice dans CLASSES), niveau, état (0 actif, 1 combat, 2 mort, 3 dans l'instance), éclat de montée de niveau (0 à 1),
// numéro du joueur, satisfaction (0 à 100), race (indice dans la liste des races)
export const P_STRIDE = 9;
// Créature : x, y, numéro du camp, vivante (0 ou 1)
export const C_STRIDE = 4;
// Carte de chaleur : une case pour 4 × 4 tuiles
export const HEAT_CELL = 4;

export interface Snapshot {
  type: "snapshot";
  tick: number;
  time: number; // secondes de jeu écoulées
  players: Float32Array;
  creatures: Float32Array;
  stats: SimStats;
  chat: ChatMessage[];
  heat?: Float32Array; // envoyée une fois par seconde
  career?: CareerInfo;
  inspected?: PlayerInfo;
}
