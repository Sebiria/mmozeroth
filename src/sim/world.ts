// Le monde simulé : joueurs virtuels et créatures. Aucun affichage ici.
// Puissance et survie dépendent de la classe (réglable), de l'arbre de talents, des sorts appris et de l'équipement.
import type {
  Activity, CampStats, ChatMessage, ClassStat, DungeonStats, LootEntry, PlayerInfo, QuestStats, SimBoss, SimCamp, SimClass,
  SimContent, SimDungeon, SimItem, SimNpc, SimQuest, SimStats, WorldSave,
} from "./protocol";
import { C_STRIDE, HEAT_CELL, P_STRIDE } from "./protocol.ts";
import { DUNGEON_WISH, fade, feel, mainReason, newMood, type Mood, type Reason } from "./mood.ts";
import { CLASS_RULES, MAX_LEVEL, TALENT_LEVEL, itemScore, usefulFor, type Slot } from "./rules.ts";

interface Pt {
  x: number;
  y: number;
}

interface Creature extends Pt {
  campId: number;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  tagged: Player | null; // un seul joueur peut combattre une créature à la fois
  wander: Pt | null;
  wait: number;
}

type State = "idle" | "rest" | "move" | "approach" | "fight" | "dead" | "queue" | "dungeon";

// Ce que le joueur est parti faire au bout de son trajet.
type Task =
  | { kind: "camp"; campId: number }
  | { kind: "npc"; npcId: number }
  | { kind: "explore"; questId: number }
  | { kind: "dungeon" }
  | null;

// Un groupe dans l'instance : une suite d'étapes (groupes de créatures puis boss), chacune un combat calculé.
interface Stage {
  boss: SimBoss | null;
  level: number;
}
interface Run {
  members: Player[];
  stages: Stage[];
  stage: number;
  encounterHp: number;
  pool: number; // vie restante du groupe
  pause: number; // déplacement, repos, retour après un échec
  wipes: number; // échecs sur l'étape en cours
  luck: number; // bonne ou mauvaise tentative : multiplie les dégâts reçus
  start: number;
}

interface QuestProgress {
  progress: number;
  start: number; // moment de l'acceptation (secondes de simulation)
  waits: number; // fois où il a trouvé le camp plein
  walk: number; // secondes de marche pendant la quête
}

interface Player extends Pt {
  id: number;
  name: string;
  cls: number;
  race: number;
  level: number;
  xp: number;
  hp: number;
  state: State;
  activity: Activity;
  idleReason: "idle" | "crowd"; // en errant : rien à son niveau, ou tout est pris
  crowdCampId: number | null; // pour « crowd » : le camp plein le plus proche, cité dans la discussion
  route: Pt[];
  task: Task;
  target: Creature | null;
  gold: number; // en pièces de cuivre
  quests: Map<number, QuestProgress>; // quêtes en cours
  done: Set<number>; // quêtes rendues
  timer: number; // attente avant de rechoisir, ou délai avant de revivre
  flash: number;
  mood: Mood;
  walkTime: number; // marche continue depuis le dernier arrêt
  sinceXp: number; // temps depuis le dernier gain d'XP
  seen: Set<number>; // grandes cases (10 × 10 tuiles) déjà visitées
  avoid: Map<number, number>; // camps trouvés pleins -> moment où il retentera
  chatCooldown: number;
  trialUntil: number; // mode carrière : fin de l'essai gratuit (0 = abonné)
  tree: number; // arbre de talents (−1 avant le niveau des talents)
  spells: number; // sorts appris
  gear: Map<Slot, number>; // objet porté à chaque emplacement
  gearPower: number;
  gearSurvival: number;
  deathTimes: number[]; // morts récentes
  dungeonsDone: number;
  dungeonAt: number; // moment où il pourra de nouveau penser à l'instance
  queuedAt: number;
  run: Run | null;
}

const CLASS_COUNT = 9;
const RACE_COUNT = 5;
const PLAYER_SPEED = 3; // tuiles par seconde
const CREATURE_SPEED = 1;
const ROAD_COST = 0.6;
const EXPLORE_RADIUS = 3; // distance (tuiles) à laquelle un lieu à explorer compte comme découvert
const DISCOVERY_CELL = 10;
const LEAVE_BELOW = 20; // satisfaction sous laquelle un joueur pense à partir…
const LEAVE_AFTER = 60; // … s'il y reste aussi longtemps (secondes)

// --- Formules (ajustées pendant les tests) ---
export const xpToLevel = (l: number) => 40 * l * l + 360 * l; // proche de la table de 3.3.5 (400, 900, 1400…)
const baseHp = (l: number) => 50 + 20 * l;
const baseDps = (l: number) => 8 + 3 * l;
const creatureMaxHp = (l: number) => 30 + 18 * l;
const creatureDps = (l: number) => 3 + 2 * l;
const DEFAULT_CLASSES: SimClass[] = CLASS_RULES.map((c) => ({ power: c.power, survival: c.survival }));
const ROLE_DPS = { tank: 0.7, heal: 0.35, dps: 1 };
function killXp(player: number, mob: number): number {
  const diff = mob - player;
  if (diff <= -5) return 0; // créature grise
  return Math.round((mob * 5 + 45) * Math.max(0.2, 1 + 0.1 * diff));
}

// Note d'une quête au moment où elle est rendue (1 à 5) : longue, bondée ou pleine de marche = moins bien notée.
function rateQuest(q: QuestProgress, now: number): number {
  const r = 5 - Math.max(0, (now - q.start - 120) / 90) - 0.5 * q.waits - (q.walk > 60 ? 1 : 0);
  return Math.max(1, Math.min(5, r));
}

// Générateur pseudo-aléatoire déterministe.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES_A = ["Gro", "Thra", "Ka", "Zug", "Mo", "Ur", "Ta", "Vol", "Jin", "Ro", "Sha", "Ne", "Dra", "Ko", "Ma", "Ze"];
const SYLLABLES_B = ["mash", "gar", "rok", "zul", "thak", "dra", "nel", "ka", "jin", "gosh", "ra", "mok", "lia", "tor"];

export class World {
  tick = 0;
  time = 0; // secondes de simulation (lu par le mode carrière)
  private players: Player[] = [];
  private creatures: Creature[] = [];
  private camps = new Map<number, { camp: SimCamp; key: string }>();
  private items = new Map<number, SimItem>();
  private classes: SimClass[] = DEFAULT_CLASSES;
  private dungeon: SimDungeon | null = null;
  private queue: Player[] = [];
  private runs: Run[] = [];
  private groupTimer = 0;
  private dstats: DungeonStats = { queue: 0, running: 0, formed: 0, completed: 0, abandoned: 0, wipes: 0, waitSum: 0, durationSum: 0, bosses: {} };
  private classDeaths = new Array(CLASS_RULES.length).fill(0);
  private spellLevels: number[][];
  private npcs = new Map<number, SimNpc>();
  private quests = new Map<number, SimQuest>();
  private questStats = new Map<number, QuestStats & { ratingSum: number }>();
  private campStats = new Map<number, CampStats>();
  private npcVisits = new Map<number, number>();
  private questsDone = 0;
  private departures = 0;
  private departureReasons: Partial<Record<Reason, number>> = {};
  private chat: ChatMessage[] = [];
  private chatCooldown = 0;
  private heat: Float32Array;
  private heatW: number;
  inspectId: number | null = null;
  private snapshots = 0;
  private nextPlayerId = 1;
  private road: Uint8Array;
  private spawnTimer = 0;
  private kills = 0;
  private deaths = 0;
  private random = rng(12345);
  private width: number;
  private height: number;
  private walk: Uint8Array; // 1 = praticable
  private spawn: Pt;
  private targetPlayers: number;
  // Réglages du mode carrière (voir career.ts) ; en bac à sable, la population est maintenue au nombre voulu.
  autoFill = true;
  trialLength = 0; // durée de l'essai gratuit (secondes), 0 : pas d'essai
  convertAt = 40; // satisfaction nécessaire pour s'abonner à la fin de l'essai
  priceStrain = 0; // abonnement trop cher : 0 = prix normal
  lag = 0; // surcharge des serveurs : 0 = aucune
  private trialsEnded = { converted: 0, left: 0 };

  // Écrit sans « propriétés de paramètre » pour pouvoir aussi tourner directement dans Node (tests).
  constructor(width: number, height: number, walk: Uint8Array, spawn: Pt, targetPlayers: number, spellLevels?: number[][]) {
    // Sans données de sorts (pas de pack), un nouveau sort tous les deux niveaux.
    this.spellLevels = spellLevels ?? CLASS_RULES.map(() => [1, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    this.width = width;
    this.height = height;
    this.walk = walk;
    this.spawn = spawn;
    this.targetPlayers = targetPlayers;
    this.road = new Uint8Array(width * height);
    this.heatW = Math.ceil(width / HEAT_CELL);
    this.heat = new Float32Array(this.heatW * Math.ceil(height / HEAT_CELL));
  }

  // --- Contenu posé par le joueur ---
  setContent({ camps, paths, npcs, quests, items, classes, dungeon }: SimContent) {
    this.items = new Map(items.map((i) => [i.id, i]));
    this.classes = classes.length === CLASS_RULES.length ? classes : DEFAULT_CLASSES;
    this.dungeon = dungeon && dungeon.bosses.length ? dungeon : null;
    if (!this.dungeon) for (const q of [...this.queue]) this.leaveQueue(q);
    for (const p of this.players) this.refreshGear(p);
    this.npcs = new Map(npcs.map((n) => [n.id, n]));
    this.quests = new Map(quests.map((q) => [q.id, q]));
    // Une quête supprimée (ou devenue incomplète) disparaît des journaux de quêtes.
    for (const p of this.players) for (const id of [...p.quests.keys()]) if (!this.quests.has(id)) p.quests.delete(id);

    const ids = new Set(camps.map((c) => c.id));
    for (const id of [...this.camps.keys()]) {
      if (ids.has(id)) continue;
      this.removeCampCreatures(id);
      this.camps.delete(id);
    }
    for (const camp of camps) {
      const key = JSON.stringify(camp);
      const prev = this.camps.get(camp.id);
      if (prev?.key === key) continue;
      // Camp nouveau ou modifié : on refait ses créatures, sauf si seul le délai de réapparition change.
      const onlyRespawn = prev && JSON.stringify({ ...prev.camp, respawn: 0 }) === JSON.stringify({ ...camp, respawn: 0 });
      this.camps.set(camp.id, { camp, key });
      if (onlyRespawn) continue;
      this.removeCampCreatures(camp.id);
      for (let i = 0; i < camp.count; i++) this.creatures.push(this.newCreature(camp));
    }

    // Chemins : les tuiles de route coûtent moins cher, les joueurs les préfèrent.
    this.road.fill(0);
    for (const path of paths) {
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1], b = path.points[i];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4);
        for (let s = 0; s <= steps; s++) {
          const x = Math.floor(a.x + 0.5 + ((b.x - a.x) * s) / steps);
          const y = Math.floor(a.y + 0.5 + ((b.y - a.y) * s) / steps);
          this.road[y * this.width + x] = 1;
        }
      }
    }
  }

  // --- Puissance d'un joueur ---
  private treeOf(p: Player) {
    return p.tree >= 0 ? CLASS_RULES[p.cls].trees[p.tree] : null;
  }

  private role(p: Player) {
    return this.treeOf(p)?.role ?? "dps";
  }

  private spellsAvailable(p: Player) {
    return this.spellLevels[p.cls].filter((l) => l <= p.level).length;
  }

  private maxHp(p: Player) {
    return baseHp(p.level) * (this.classes[p.cls].survival / 100) * (this.treeOf(p)?.survival ?? 1) + p.gearSurvival * 3;
  }

  private dps(p: Player) {
    const avail = this.spellsAvailable(p);
    const spellFactor = avail ? 0.75 + 0.25 * Math.min(1, p.spells / avail) : 1;
    return baseDps(p.level) * (this.classes[p.cls].power / 100) * (this.treeOf(p)?.power ?? 1) * spellFactor + p.gearPower * 0.3;
  }

  // Recalcule l'apport de l'équipement (un objet supprimé de la liste disparaît aussi des sacs).
  private refreshGear(p: Player) {
    p.gearPower = p.gearSurvival = 0;
    for (const [slot, id] of p.gear) {
      const item = this.items.get(id);
      if (!item) {
        p.gear.delete(slot);
        continue;
      }
      p.gearPower += item.power;
      p.gearSurvival += item.survival;
    }
  }

  // Un objet reçu (butin, récompense) : porté s'il est meilleur, vendu sinon.
  private giveItem(p: Player, itemId: number | null) {
    const item = itemId === null ? undefined : this.items.get(itemId);
    if (!item) return;
    if (!usefulFor(item, p.cls)) {
      this.feelAndSay(p, "useless", -1.5, { itemId: item.id });
      return;
    }
    const cur = p.gear.get(item.slot);
    const curScore = cur === undefined ? 0 : itemScore(this.items.get(cur)!, p.cls);
    if (item.level <= p.level && itemScore(item, p.cls) > curScore) {
      p.gear.set(item.slot, item.id);
      this.refreshGear(p);
      this.feelAndSay(p, "loot", 4, { itemId: item.id });
    } else p.gold += 10 * (item.level + 1); // revendu au marchand
  }

  private rollLoot(p: Player, loot: LootEntry[]) {
    for (const l of loot) if (this.random() * 100 < l.chance) this.giveItem(p, l.itemId);
  }

  private trainerFor(p: Player): SimNpc | null {
    const id = CLASS_RULES[p.cls].id;
    let best: SimNpc | null = null;
    for (const n of this.npcs.values())
      if (n.trainerClass === id && (!best || Math.hypot(n.x - p.x, n.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y))) best = n;
    return best;
  }

  private chooseTree(p: Player) {
    const trees = CLASS_RULES[p.cls].trees;
    // Les amateurs de donjon prennent plus souvent un rôle de tank ou de soigneur, quand la classe en a un.
    const support = trees.map((t, i) => (t.role !== "dps" ? i : -1)).filter((i) => i >= 0);
    p.tree = support.length && p.mood.profile === "dungeon" && this.random() < 0.6
      ? support[Math.floor(this.random() * support.length)]
      : Math.floor(this.random() * 3);
  }

  private removeCampCreatures(campId: number) {
    for (const c of this.creatures) if (c.campId === campId && c.tagged) this.untarget(c.tagged);
    this.creatures = this.creatures.filter((c) => c.campId !== campId);
  }

  private newCreature(camp: SimCamp): Creature {
    const level = camp.minLevel + Math.floor(this.random() * (camp.maxLevel - camp.minLevel + 1));
    const p = this.randomPointInCamp(camp);
    return { ...p, campId: camp.id, level, hp: creatureMaxHp(level), maxHp: creatureMaxHp(level), alive: true, respawnTimer: 0, tagged: null, wander: null, wait: this.random() * 4 };
  }

  private randomPointInCamp(camp: SimCamp): Pt {
    for (let i = 0; i < 12; i++) {
      const a = this.random() * Math.PI * 2;
      const r = Math.sqrt(this.random()) * camp.radius;
      const p = { x: camp.x + 0.5 + Math.cos(a) * r, y: camp.y + 0.5 + Math.sin(a) * r };
      if (this.walkable(Math.floor(p.x), Math.floor(p.y))) return p;
    }
    return { x: camp.x + 0.5, y: camp.y + 0.5 };
  }

  private walkable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const i = y * this.width + x;
    return this.walk[i] === 1 || this.road[i] === 1;
  }

  // --- Un tour de simulation ---
  step(dt: number) {
    this.tick++;
    this.time += dt;
    this.chatCooldown -= dt;
    this.spawnTimer -= dt;
    if (this.autoFill && this.players.length < this.targetPlayers && this.spawnTimer <= 0) {
      this.spawnTimer = 0.2;
      this.players.push(this.newPlayer());
    }
    for (const c of this.creatures) this.stepCreature(c, dt);
    this.groupTimer -= dt;
    if (this.groupTimer <= 0) {
      this.groupTimer = 1;
      this.formGroups();
    }
    for (const run of [...this.runs]) this.stepRun(run, dt);
    const decay = Math.exp(-dt / 120);
    for (let i = 0; i < this.heat.length; i++) this.heat[i] *= decay;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      this.stepPlayer(p, dt);
      this.stepMood(p, dt);
      const cx = Math.floor(p.x / HEAT_CELL), cy = Math.floor(p.y / HEAT_CELL);
      this.heat[cy * this.heatW + cx] += dt;
      let gone = false;
      if (p.mood.lowTime > LEAVE_AFTER) gone = this.leave(p, "left");
      // Fin de l'essai gratuit : il s'abonne s'il est assez content, sinon il s'en va
      else if (p.trialUntil > 0 && this.time >= p.trialUntil) {
        if (p.mood.satisfaction >= this.convertAt) {
          p.trialUntil = 0;
          this.trialsEnded.converted++;
        } else {
          this.trialsEnded.left++;
          gone = this.leave(p, "trialLeft");
        }
      }
      if (!gone) continue;
      // En bac à sable il est remplacé par un nouveau venu ; en carrière, il reviendra (ou pas) selon la réputation.
      if (this.autoFill) this.players[i] = this.newPlayer();
      else this.players.splice(i--, 1);
    }
  }

  // --- Mode carrière ---
  // Un nouveau joueur arrive, en essai gratuit.
  welcome() {
    const p = this.newPlayer();
    p.trialUntil = this.trialLength ? this.time + this.trialLength : 0;
    this.players.push(p);
  }

  get playerCount() {
    return this.players.length;
  }

  get subscriberCount() {
    let n = 0;
    for (const p of this.players) if (p.trialUntil === 0) n++;
    return n;
  }

  get averageSatisfaction() {
    return this.players.reduce((a, p) => a + p.mood.satisfaction, 0) / (this.players.length || 1);
  }

  get dungeonCompleted() {
    return this.dstats.completed;
  }

  get trials() {
    return { ...this.trialsEnded, running: this.players.length - this.subscriberCount };
  }

  private newPlayer(): Player {
    const level = 1;
    const name = SYLLABLES_A[Math.floor(this.random() * SYLLABLES_A.length)] + SYLLABLES_B[Math.floor(this.random() * SYLLABLES_B.length)];
    const p: Player = {
      id: this.nextPlayerId++,
      name,
      x: this.spawn.x + 0.5 + (this.random() - 0.5) * 2,
      y: this.spawn.y + 0.5 + (this.random() - 0.5) * 2,
      cls: Math.floor(this.random() * CLASS_COUNT), // combinaisons race/classe libres
      race: Math.floor(this.random() * RACE_COUNT),
      level,
      xp: 0,
      hp: baseHp(level),
      state: "idle",
      activity: "wander",
      idleReason: "idle",
      crowdCampId: null,
      route: [],
      task: null,
      target: null,
      gold: 0,
      quests: new Map(),
      done: new Set(),
      timer: this.random(),
      flash: 0,
      mood: newMood(this.random),
      walkTime: 0,
      sinceXp: 0,
      seen: new Set(),
      avoid: new Map(),
      chatCooldown: 20 + this.random() * 40,
      trialUntil: 0,
      tree: -1,
      spells: 0,
      gear: new Map(),
      gearPower: 0,
      gearSurvival: 0,
      deathTimes: [],
      dungeonsDone: 0,
      dungeonAt: 0,
      queuedAt: 0,
      run: null,
    };
    p.hp = this.maxHp(p);
    p.seen.add(this.discoveryCell(p));
    return p;
  }

  // Résiliation (ou fin d'essai sans abonnement) : le joueur part, avec la raison principale de son mécontentement.
  private leave(p: Player, key: "left" | "trialLeft"): true {
    this.untarget(p);
    this.leaveQueue(p);
    if (p.run) p.run.members = p.run.members.filter((m) => m !== p);
    const reason = mainReason(p.mood);
    this.departures++;
    this.departureReasons[reason] = (this.departureReasons[reason] ?? 0) + 1;
    this.chat.push({ from: p.name, key, variant: 0, level: p.level, reason });
    if (this.inspectId === p.id) this.inspectId = null;
    return true;
  }

  private discoveryCell(p: Pt) {
    return Math.floor(p.y / DISCOVERY_CELL) * 1000 + Math.floor(p.x / DISCOVERY_CELL);
  }

  // Effets continus sur l'humeur : errer sans but, marcher longtemps, ne plus progresser.
  private stepMood(p: Player, dt: number) {
    const m = p.mood;
    p.chatCooldown -= dt;
    fade(m, dt);
    if (p.state !== "dead") {
      p.sinceXp += dt;
      if (p.state === "queue") {
        if (this.time - p.queuedAt > 45) this.feelAndSay(p, "group", -0.3 * dt);
      } else if (p.state === "dungeon") {
        p.sinceXp = 0; // dans l'instance, il progresse
      } else if (p.activity === "wander") {
        if (p.idleReason === "crowd") this.feelAndSay(p, "crowd", -0.25 * dt, { campId: p.crowdCampId ?? undefined });
        else this.feelAndSay(p, "idle", -0.5 * dt);
      }
      else if (p.sinceXp > 150) this.feelAndSay(p, "slow", -0.2 * dt);
      if (p.state === "move") {
        p.walkTime += dt;
        for (const q of p.quests.values()) q.walk += dt;
        if (p.walkTime > 30) this.feelAndSay(p, "walk", -0.15 * dt);
        const cell = this.discoveryCell(p);
        if (!p.seen.has(cell)) {
          p.seen.add(cell);
          this.feelAndSay(p, "discover", 2);
        }
      }
    }
    // Mode carrière : serveurs surchargés, abonnement trop cher
    if (this.lag > 0) this.feelAndSay(p, "lag", -Math.min(1.5, this.lag * 2) * dt);
    if (this.priceStrain > 0 && p.trialUntil === 0) this.feelAndSay(p, "price", -0.08 * this.priceStrain * dt);
    m.lowTime = m.satisfaction < LEAVE_BELOW ? m.lowTime + dt : Math.max(0, m.lowTime - dt);
  }

  // Applique un effet et, de temps en temps, le joueur en parle dans le canal général.
  private feelAndSay(p: Player, reason: Reason, amount: number, extra: { campId?: number; questId?: number; itemId?: number } = {}) {
    feel(p.mood, reason, amount);
    const wantsToSay = amount < 0 ? p.mood.pending[reason] >= 8 : this.random() < 0.3;
    if (!wantsToSay || p.chatCooldown > 0 || this.chatCooldown > 0) return;
    p.mood.pending[reason] = 0;
    p.chatCooldown = 90;
    this.chatCooldown = 1.5;
    this.chat.push({ from: p.name, key: reason, variant: Math.floor(this.random() * 3), level: p.level, ...extra });
  }

  private stepCreature(c: Creature, dt: number) {
    if (!c.alive) {
      c.respawnTimer -= dt;
      if (c.respawnTimer <= 0) {
        const camp = this.camps.get(c.campId)!.camp;
        Object.assign(c, this.randomPointInCamp(camp), { alive: true, hp: c.maxHp, wander: null });
      }
      return;
    }
    if (c.tagged) return; // en combat, elle reste sur place
    if (c.wait > 0) {
      c.wait -= dt;
      return;
    }
    if (!c.wander) c.wander = this.randomPointInCamp(this.camps.get(c.campId)!.camp);
    if (this.moveToward(c, c.wander, CREATURE_SPEED * dt)) {
      c.wander = null;
      c.wait = 2 + this.random() * 4;
    }
  }

  private stepPlayer(p: Player, dt: number) {
    p.flash = Math.max(0, p.flash - dt);
    const maxHp = this.maxHp(p);
    switch (p.state) {
      case "dead":
        p.timer -= dt;
        if (p.timer <= 0) {
          Object.assign(p, { x: this.spawn.x + 0.5, y: this.spawn.y + 0.5, hp: maxHp, state: "idle", route: [], task: null });
        }
        return;
      case "queue":
        // Trop long : il abandonne et reviendra plus tard.
        if (this.time - p.queuedAt > 240 * p.mood.patience) {
          this.leaveQueue(p);
          p.dungeonAt = this.time + 180;
          this.feelAndSay(p, "group", -3);
        }
        return;
      case "dungeon":
        return; // l'instance avance dans stepRun
      case "rest":
        p.hp = Math.min(maxHp, p.hp + maxHp * 0.06 * dt);
        if (p.hp >= maxHp) p.state = "idle";
        return;
      case "idle":
        p.timer -= dt;
        if (p.timer > 0) return;
        if (p.hp < maxHp * 0.5) {
          p.state = "rest";
          return;
        }
        this.chooseActivity(p);
        return;
      case "move":
        if (this.followRoute(p, PLAYER_SPEED * dt)) this.arrive(p);
        return;
      case "approach": {
        const c = p.target!;
        if (Math.hypot(c.x - p.x, c.y - p.y) < 0.9) p.state = "fight";
        else this.moveToward(p, c, PLAYER_SPEED * dt);
        return;
      }
      case "fight": {
        const c = p.target!;
        c.hp -= this.dps(p) * (0.8 + this.random() * 0.4) * dt;
        p.hp -= creatureDps(c.level) * (0.8 + this.random() * 0.4) * dt;
        if (c.hp <= 0) {
          this.kills++;
          this.campStat(c.campId).kills++;
          c.alive = false;
          c.tagged = null;
          c.respawnTimer = this.camps.get(c.campId)!.camp.respawn;
          p.target = null;
          this.creditQuests(p, c.campId);
          this.rollLoot(p, this.camps.get(c.campId)!.camp.loot);
          feel(p.mood, "progress", 0.4);
          this.gainXp(p, killXp(p.level, c.level));
          p.state = "idle";
          p.timer = 0.5;
        } else if (p.hp <= 0) {
          this.deaths++;
          this.classDeaths[p.cls]++;
          c.hp = c.maxHp;
          this.untarget(p);
          p.hp = 0;
          p.state = "dead";
          p.timer = 10;
          this.feelAndSay(p, "death", -10);
          // Morts à répétition : sa classe lui paraît trop faible.
          p.deathTimes = p.deathTimes.filter((t) => t > this.time - 300);
          p.deathTimes.push(this.time);
          if (p.deathTimes.length >= 3) this.feelAndSay(p, "weak", -6);
        }
        return;
      }
    }
  }

  private gainXp(p: Player, xp: number) {
    if (xp <= 0 || p.level >= MAX_LEVEL) return;
    p.xp += xp;
    p.sinceXp = 0;
    while (p.level < MAX_LEVEL && p.xp >= xpToLevel(p.level)) {
      p.xp -= xpToLevel(p.level);
      p.level++;
      if (p.level >= TALENT_LEVEL && p.tree < 0) this.chooseTree(p);
      p.hp = this.maxHp(p); // la montée de niveau soigne
      p.flash = 1.5;
      this.feelAndSay(p, "level", 6);
      // Des sorts à apprendre, mais aucun maître de sa classe dans la zone
      if (this.spellsAvailable(p) - p.spells >= 3 && !this.trainerFor(p)) this.feelAndSay(p, "trainer", -4);
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
  }

  private untarget(p: Player) {
    if (p.target) p.target.tagged = null;
    p.target = null;
    p.state = "idle";
    p.timer = 0.5;
  }

  private needed(q: SimQuest) {
    return q.type === "kill" || q.type === "collect" ? q.count : 1;
  }

  private canAccept(p: Player, q: SimQuest) {
    return !p.done.has(q.id) && !p.quests.has(q.id) && p.level >= q.minLevel && (q.prevId === null || p.done.has(q.prevId));
  }

  // Une créature tuée fait avancer les quêtes « tuer » de son camp, et parfois les quêtes « ramasser ».
  private creditQuests(p: Player, campId: number) {
    for (const [id, qp] of p.quests) {
      const q = this.quests.get(id)!;
      if (q.campId !== campId || qp.progress >= this.needed(q)) continue;
      if (q.type === "kill" || (q.type === "collect" && this.random() * 100 < q.dropChance)) qp.progress++;
    }
  }

  // Ordre de priorité : rendre une quête finie, en accepter une, faire ses objectifs,
  // sinon chasser dans un camp à son niveau (ou explorer, pour un explorateur), sinon errer.
  // À chaque fois, le plus proche.
  private chooseActivity(p: Player) {
    const pick = { task: null as Task, goal: null as Pt | null, d: Infinity, activity: "wander" as Activity };
    const consider = (task: Task, goal: Pt, activity: Activity) => {
      const d = Math.hypot(goal.x + 0.5 - p.x, goal.y + 0.5 - p.y);
      if (d < pick.d) Object.assign(pick, { task, goal, d, activity });
    };

    for (const [id, qp] of p.quests) {
      const q = this.quests.get(id)!;
      const ender = this.npcs.get(q.enderId);
      if (qp.progress >= this.needed(q) && ender) consider({ kind: "npc", npcId: ender.id }, ender, "npc");
    }
    if (!pick.goal)
      for (const q of this.quests.values()) {
        const giver = this.npcs.get(q.giverId);
        if (giver && this.canAccept(p, q)) consider({ kind: "npc", npcId: giver.id }, giver, "npc");
      }
    if (!pick.goal)
      for (const [id, qp] of p.quests) {
        const q = this.quests.get(id)!;
        if (qp.progress >= this.needed(q)) continue;
        if (q.type === "explore" && q.target) consider({ kind: "explore", questId: q.id }, q.target, "quest");
        const camp = q.campId === null ? undefined : this.camps.get(q.campId)?.camp;
        if (camp && (p.avoid.get(camp.id) ?? 0) <= this.time) consider({ kind: "camp", campId: camp.id }, camp, "quest");
      }
    // Apprendre ses nouveaux sorts chez son maître de classe
    if (!pick.goal && this.spellsAvailable(p) - p.spells >= 2) {
      const trainer = this.trainerFor(p);
      if (trainer) consider({ kind: "npc", npcId: trainer.id }, trainer, "train");
    }
    // L'instance, selon son envie (moins forte s'il l'a déjà faite)
    const d = this.dungeon;
    if (!pick.goal && d && p.level >= d.minLevel && p.level <= d.maxLevel && this.time >= p.dungeonAt) {
      if (this.random() < DUNGEON_WISH[p.mood.profile] * 0.5 ** p.dungeonsDone) consider({ kind: "dungeon" }, d.gather, "queue");
      else p.dungeonAt = this.time + 60;
    }
    const explorer = p.mood.profile === "explorer";
    if (!pick.goal && !(explorer && this.random() < 0.4))
      for (const { camp } of this.camps.values()) {
        if (camp.maxLevel > p.level + 1 || camp.maxLevel < p.level - 4) continue;
        if ((p.avoid.get(camp.id) ?? 0) > this.time) continue;
        if (!this.creatures.some((c) => c.campId === camp.id && c.alive && !c.tagged)) continue;
        consider({ kind: "camp", campId: camp.id }, camp, "hunt");
      }
    if (!pick.goal) {
      // Errer près de soi ; un explorateur part plus loin, de préférence vers des coins pas encore vus.
      const range = explorer ? 50 : 16;
      for (let i = 0; i < 12 && !pick.goal; i++) {
        const g = { x: Math.floor(p.x + (this.random() - 0.5) * range), y: Math.floor(p.y + (this.random() - 0.5) * range) };
        if (!this.walkable(g.x, g.y)) continue;
        if (explorer && i < 8 && p.seen.has(this.discoveryCell(g))) continue;
        pick.goal = g;
      }
      pick.activity = explorer ? "explore" : "wander";
      // Il existe des camps à son niveau, mais tous sont pris : c'est la foule, pas le vide.
      let nearest: SimCamp | null = null;
      for (const { camp } of this.camps.values()) {
        if (camp.maxLevel > p.level + 1 || camp.maxLevel < p.level - 4) continue;
        if (!nearest || Math.hypot(camp.x - p.x, camp.y - p.y) < Math.hypot(nearest.x - p.x, nearest.y - p.y)) nearest = camp;
      }
      p.idleReason = nearest ? "crowd" : "idle";
      p.crowdCampId = nearest?.id ?? null;
    }

    const route = pick.goal && this.findRoute({ x: Math.floor(p.x), y: Math.floor(p.y) }, pick.goal);
    p.activity = pick.activity;
    if (!route) {
      p.timer = 1 + this.random() * 2;
      return;
    }
    p.task = pick.task;
    p.route = route;
    p.state = "move";
  }

  // Arrivé au bout du trajet : parler au PNJ, découvrir le lieu, ou attaquer une créature libre du camp.
  private arrive(p: Player) {
    const task = p.task;
    p.task = null;
    p.state = "idle";
    p.walkTime = 0;
    p.timer = 0.5 + this.random();
    if (task?.kind === "npc") this.visitNpc(p, task.npcId);
    else if (task?.kind === "dungeon") {
      if (!this.dungeon) return;
      p.state = "queue";
      p.queuedAt = this.time;
      this.queue.push(p);
    }
    else if (task?.kind === "explore") {
      for (const [id, qp] of p.quests) {
        const q = this.quests.get(id)!;
        const t = q.target;
        if (q.type === "explore" && t && qp.progress < 1 && Math.hypot(t.x + 0.5 - p.x, t.y + 0.5 - p.y) <= EXPLORE_RADIUS) qp.progress = 1;
      }
    } else if (task?.kind === "camp") {
      let best: Creature | null = null;
      let bestDist = Infinity;
      for (const c of this.creatures) {
        if (c.campId !== task.campId || !c.alive || c.tagged) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (best) {
        best.tagged = p;
        best.wander = null;
        p.target = best;
        p.state = "approach";
      } else {
        // Tout est pris : ça l'agace, et il va voir ailleurs avant de revenir plus tard.
        p.timer = 2 + this.random() * 3;
        p.avoid.set(task.campId, this.time + 20 + this.random() * 20);
        this.campStat(task.campId).crowded++;
        for (const [id, qp] of p.quests) if (this.quests.get(id)!.campId === task.campId) qp.waits++;
        this.feelAndSay(p, "crowd", -2, { campId: task.campId });
      }
    }
  }

  // Chez un PNJ : rendre les quêtes finies qui se terminent ici, puis accepter celles qu'il propose.
  private visitNpc(p: Player, npcId: number) {
    this.npcVisits.set(npcId, (this.npcVisits.get(npcId) ?? 0) + 1);
    if (this.npcs.get(npcId)?.trainerClass === CLASS_RULES[p.cls].id) p.spells = this.spellsAvailable(p);
    for (const [id, qp] of [...p.quests]) {
      const q = this.quests.get(id)!;
      if (q.enderId !== npcId || qp.progress < this.needed(q)) continue;
      p.quests.delete(id);
      p.done.add(id);
      p.gold += q.gold;
      const s = this.questStat(id);
      s.completed++;
      s.ratingSum += rateQuest(qp, this.time);
      s.rating = s.ratingSum / s.completed;
      this.questsDone++;
      this.feelAndSay(p, "quest", 5, { questId: id });
      this.gainXp(p, q.xp);
      this.giveItem(p, q.rewardItemId);
    }
    for (const q of this.quests.values()) {
      if (q.giverId !== npcId || !this.canAccept(p, q)) continue;
      // Livrer : l'objet est remis tout de suite, il ne reste qu'à aller au PNJ d'arrivée.
      p.quests.set(q.id, { progress: q.type === "deliver" ? 1 : 0, start: this.time, waits: 0, walk: 0 });
      this.questStat(q.id).accepted++;
    }
  }

  // --- Groupes et instance ---
  private leaveQueue(p: Player) {
    const i = this.queue.indexOf(p);
    if (i < 0) return;
    this.queue.splice(i, 1);
    if (p.state === "queue") {
      p.state = "idle";
      p.timer = 1;
    }
  }

  // Un groupe de 5 : un tank, un soigneur et trois dégâts si possible ; après 90 s d'attente, n'importe quels 5.
  private formGroups() {
    const d = this.dungeon;
    if (!d) return;
    for (;;) {
      const q = this.queue;
      if (q.length < 5) return;
      const tank = q.find((p) => this.role(p) === "tank");
      const heal = q.find((p) => this.role(p) === "heal");
      const dps = q.filter((p) => this.role(p) === "dps").slice(0, 3);
      let group: Player[];
      if (tank && heal && dps.length === 3) group = [tank, heal, ...dps];
      else if (this.time - q[0].queuedAt > 90) {
        // Groupe incomplet : le tank et le soigneur disponibles d'abord, puis ceux qui attendent depuis le plus longtemps
        group = [tank, heal].filter((p): p is Player => !!p);
        for (const p of q) if (group.length < 5 && !group.includes(p)) group.push(p);
      } else return;
      for (const p of group) {
        this.queue.splice(this.queue.indexOf(p), 1);
        const wait = this.time - p.queuedAt;
        this.dstats.waitSum += wait;
        if (wait < 60) feel(p.mood, "dungeon", 2); // groupe trouvé vite
        p.state = "dungeon";
        p.activity = "dungeon";
      }
      this.dstats.formed++;
      const stages: Stage[] = [];
      const perBoss = Math.ceil(d.trash / d.bosses.length);
      let trashLeft = d.trash;
      for (const boss of d.bosses) {
        for (let k = 0; k < perBoss && trashLeft > 0; k++, trashLeft--) stages.push({ boss: null, level: Math.min(d.maxLevel, d.minLevel + 1 + Math.floor(stages.length / 3)) });
        stages.push({ boss, level: boss.level });
      }
      const run: Run = { members: group, stages, stage: 0, encounterHp: 0, pool: 0, pause: 20, wipes: 0, luck: 1, start: this.time };
      for (const p of group) p.run = run;
      this.startStage(run);
      this.runs.push(run);
    }
  }

  private startStage(run: Run) {
    const st = run.stages[run.stage];
    // La difficulté joue à la fois sur la vie et sur les coups : chacun en reçoit la racine, pour un effet proportionnel.
    const diff = Math.sqrt(this.dungeon!.difficulty / 100);
    run.luck = 0.75 + this.random() * 0.5;
    run.encounterHp = st.boss ? creatureMaxHp(st.level) * 10 * (st.boss.health / 100) * diff : creatureMaxHp(st.level) * 4 * diff;
    run.pool = run.members.reduce((s, m) => s + this.maxHp(m), 0);
  }

  // Un combat calculé : les dégâts du groupe contre la vie de la rencontre ; un tank réduit les coups, un soigneur les rend.
  private stepRun(run: Run, dt: number) {
    const d = this.dungeon;
    if (!d || run.members.length < 3) return this.endRun(run, false); // le groupe s'est trop vidé (joueurs partis)
    if (run.pause > 0) {
      run.pause -= dt;
      return;
    }
    const st = run.stages[run.stage];
    const diff = Math.sqrt(d.difficulty / 100);
    let groupDps = 0, heal = 0, tank = false;
    for (const m of run.members) {
      const role = this.role(m);
      groupDps += this.dps(m) * ROLE_DPS[role];
      if (role === "heal") heal += this.dps(m) * 1.6;
      if (role === "tank") tank = true;
    }
    const incoming = creatureDps(st.level) * (st.boss ? 6 : 4) * diff * run.luck * (tank ? 0.6 : 1);
    run.encounterHp -= groupDps * (0.85 + this.random() * 0.3) * dt;
    const poolMax = run.members.reduce((s, m) => s + this.maxHp(m), 0);
    run.pool = Math.min(poolMax, run.pool - (incoming - heal) * dt);
    if (run.encounterHp <= 0) {
      // Rencontre vaincue : XP, butin du boss, puis repos et marche jusqu'à la suivante
      for (const m of run.members) this.gainXp(m, killXp(m.level, st.level) * (st.boss ? 8 : 4));
      if (st.boss) {
        const b = (this.dstats.bosses[st.boss.id] ??= { kills: 0, wipes: 0 });
        b.kills++;
        for (const l of st.boss.loot) {
          if (this.random() * 100 >= l.chance) continue;
          const item = this.items.get(l.itemId);
          // Il va à un membre pour qui c'est utile, sinon à quelqu'un au hasard
          const wanting = item ? run.members.filter((m) => usefulFor(item, m.cls)) : [];
          const pool = wanting.length ? wanting : run.members;
          this.giveItem(pool[Math.floor(this.random() * pool.length)], l.itemId);
        }
      }
      run.stage++;
      run.wipes = 0;
      if (run.stage >= run.stages.length) return this.endRun(run, true);
      run.pause = st.boss ? 25 : 15;
      this.startStage(run);
    } else if (run.pool <= 0) {
      // Échec : tout le groupe meurt, revient et réessaie ; au troisième échec, il abandonne.
      run.wipes++;
      this.dstats.wipes++;
      if (st.boss) (this.dstats.bosses[st.boss.id] ??= { kills: 0, wipes: 0 }).wipes++;
      for (const m of run.members) {
        this.deaths++;
        this.classDeaths[m.cls]++;
        this.feelAndSay(m, "wipe", -6);
      }
      if (run.wipes >= 3) return this.endRun(run, false);
      run.pause = 40;
      this.startStage(run);
    }
  }

  private endRun(run: Run, done: boolean) {
    this.runs.splice(this.runs.indexOf(run), 1);
    if (done) {
      this.dstats.completed++;
      this.dstats.durationSum += this.time - run.start;
    } else this.dstats.abandoned++;
    for (const m of run.members) {
      m.run = null;
      m.state = "idle";
      m.timer = 2;
      m.hp = this.maxHp(m);
      m.dungeonAt = this.time + (done ? 300 : 240);
      if (done) {
        m.dungeonsDone++;
        this.feelAndSay(m, "dungeon", 12);
      } else this.feelAndSay(m, "wipe", -8);
    }
  }

  private questStat(id: number) {
    let s = this.questStats.get(id);
    if (!s) this.questStats.set(id, (s = { accepted: 0, completed: 0, rating: 0, ratingSum: 0 }));
    return s;
  }

  private campStat(id: number) {
    let s = this.campStats.get(id);
    if (!s) this.campStats.set(id, (s = { kills: 0, crowded: 0 }));
    return s;
  }

  private followRoute(p: Player, dist: number): boolean {
    while (dist > 0 && p.route.length) {
      const next = p.route[0];
      const d = Math.hypot(next.x - p.x, next.y - p.y);
      if (d <= dist) {
        p.x = next.x;
        p.y = next.y;
        dist -= d;
        p.route.shift();
      } else {
        this.moveToward(p, next, dist);
        dist = 0;
      }
    }
    return p.route.length === 0;
  }

  // Avance vers une cible ; renvoie vrai si elle est atteinte.
  private moveToward(a: Pt, b: Pt, dist: number): boolean {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= dist) {
      a.x = b.x;
      a.y = b.y;
      return true;
    }
    a.x += (dx / d) * dist;
    a.y += (dy / d) * dist;
    return false;
  }

  // Recherche de trajet A* sur la grille (8 directions, routes moins chères). Renvoie les centres des tuiles.
  findRoute(from: Pt, to: Pt): Pt[] | null {
    const W = this.width;
    if (!this.walkable(to.x, to.y)) return null;
    const start = from.y * W + from.x, goal = to.y * W + to.x;
    const g = new Map<number, number>([[start, 0]]);
    const parent = new Map<number, number>();
    const heap = new MinHeap();
    const h = (i: number) => Math.hypot((i % W) - to.x, Math.floor(i / W) - to.y) * ROAD_COST;
    heap.push(start, h(start));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (++expanded > 30000) return null;
      const cx = cur % W, cy = Math.floor(cur / W);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.walkable(nx, ny)) continue;
          if (dx && dy && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue; // pas de coin coupé
          const n = ny * W + nx;
          const cost = (dx && dy ? Math.SQRT2 : 1) * (this.road[n] ? ROAD_COST : 1);
          const ng = g.get(cur)! + cost;
          if (ng < (g.get(n) ?? Infinity)) {
            g.set(n, ng);
            parent.set(n, cur);
            heap.push(n, ng + h(n));
          }
        }
      }
    }
    if (!parent.has(goal) && start !== goal) return null;
    const route: Pt[] = [];
    for (let i = goal; i !== start; i = parent.get(i)!) route.push({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
    return route.reverse();
  }

  // --- Bac à sable : nombre de joueurs, apparition, niveau forcé ---
  setTargetPlayers(n: number) {
    this.targetPlayers = n;
    while (this.players.length > n) {
      const p = this.players.pop()!;
      this.untarget(p);
      this.leaveQueue(p);
      if (p.run) p.run.members = p.run.members.filter((m) => m !== p);
    }
  }

  spawnNow(): number {
    const p = this.newPlayer();
    this.players.push(p);
    this.targetPlayers = Math.max(this.targetPlayers, this.players.length);
    return p.id;
  }

  setLevel(id: number, level: number) {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    p.level = level;
    p.xp = 0;
    p.sinceXp = 0;
    if (level >= TALENT_LEVEL && p.tree < 0) this.chooseTree(p);
    if (level < TALENT_LEVEL) p.tree = -1;
    p.spells = Math.min(p.spells, this.spellsAvailable(p));
    p.hp = this.maxHp(p);
    p.flash = 1.5;
  }

  get playerTarget() {
    return this.targetPlayers;
  }

  // --- Sauvegarde ---
  // Les créatures sont recréées à partir des camps ; trajets et combats en cours repartent de zéro.
  save(): WorldSave {
    return {
      time: this.time,
      tick: this.tick,
      nextPlayerId: this.nextPlayerId,
      targetPlayers: this.targetPlayers,
      kills: this.kills,
      deaths: this.deaths,
      questsDone: this.questsDone,
      departures: this.departures,
      departureReasons: { ...this.departureReasons },
      questStats: [...this.questStats],
      campStats: [...this.campStats],
      npcVisits: [...this.npcVisits],
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        cls: p.cls,
        race: p.race,
        level: p.level,
        xp: p.xp,
        hp: p.hp,
        gold: p.gold,
        quests: [...p.quests],
        done: [...p.done],
        mood: p.mood,
        seen: [...p.seen],
        sinceXp: p.sinceXp,
        tree: p.tree,
        spells: p.spells,
        gear: Object.fromEntries(p.gear),
        dungeonsDone: p.dungeonsDone,
        trialUntil: p.trialUntil,
      })),
      dungeon: structuredClone(this.dstats),
      classDeaths: [...this.classDeaths],
    };
  }

  load(s: WorldSave) {
    Object.assign(this, {
      time: s.time,
      tick: s.tick,
      nextPlayerId: s.nextPlayerId,
      targetPlayers: s.targetPlayers,
      kills: s.kills,
      deaths: s.deaths,
      questsDone: s.questsDone,
      departures: s.departures,
      departureReasons: { ...s.departureReasons },
      questStats: new Map(s.questStats),
      campStats: new Map(s.campStats),
      npcVisits: new Map(s.npcVisits),
    });
    // Parties d'avant l'étape 9 : sans ces champs
    if (s.dungeon) this.dstats = { ...structuredClone(s.dungeon), queue: 0, running: 0 };
    if (s.classDeaths) this.classDeaths = [...s.classDeaths];
    this.queue = [];
    this.runs = [];
    this.players = s.players.map((sp) => {
      const p = this.newPlayer();
      this.nextPlayerId--; // newPlayer a pris un numéro : on le rend
      Object.assign(p, sp, {
        quests: new Map(sp.quests.filter(([id]) => this.quests.has(id))),
        done: new Set(sp.done),
        seen: new Set(sp.seen),
        hp: Math.max(1, sp.hp),
        tree: sp.tree ?? (sp.level >= TALENT_LEVEL ? Math.floor(this.random() * 3) : -1),
        spells: sp.spells ?? 0,
        gear: new Map(Object.entries(sp.gear ?? {}).map(([k, v]) => [k as Slot, v as number])),
        dungeonsDone: sp.dungeonsDone ?? 0,
        trialUntil: sp.trialUntil ?? 0,
      });
      this.refreshGear(p);
      return p;
    });
    this.nextPlayerId = s.nextPlayerId;
  }

  // --- Ce que l'affichage reçoit ---
  snapshot() {
    const players = new Float32Array(this.players.length * P_STRIDE);
    let levels = 0, maxLevel = 0, satisfaction = 0;
    this.players.forEach((p, i) => {
      const state = p.state === "dungeon" ? 3 : p.state === "dead" ? 2 : p.state === "fight" ? 1 : 0;
      players.set([p.x, p.y, p.cls, p.level, state, Math.min(1, p.flash), p.id, p.mood.satisfaction, p.race], i * P_STRIDE);
      levels += p.level;
      maxLevel = Math.max(maxLevel, p.level);
      satisfaction += p.mood.satisfaction;
    });
    const creatures = new Float32Array(this.creatures.length * C_STRIDE);
    this.creatures.forEach((c, i) => creatures.set([c.x, c.y, c.campId, c.alive ? 1 : 0], i * C_STRIDE));
    const n = this.players.length || 1;
    const classes: ClassStat[] = CLASS_RULES.map((_, i) => {
      const ps = this.players.filter((p) => p.cls === i);
      const k = ps.length || 1;
      return {
        players: ps.length,
        avgLevel: ps.reduce((a, p) => a + p.level, 0) / k,
        satisfaction: ps.reduce((a, p) => a + p.mood.satisfaction, 0) / k,
        deaths: this.classDeaths[i],
      };
    });
    const stats: SimStats = {
      players: this.players.length,
      avgLevel: levels / n,
      maxLevel,
      kills: this.kills,
      deaths: this.deaths,
      questsDone: this.questsDone,
      satisfaction: satisfaction / n,
      departures: this.departures,
      departureReasons: { ...this.departureReasons },
      quests: Object.fromEntries([...this.questStats].map(([id, s]) => [id, { accepted: s.accepted, completed: s.completed, rating: s.rating }])),
      camps: Object.fromEntries(this.campStats),
      npcVisits: Object.fromEntries(this.npcVisits),
      dungeon: { ...this.dstats, queue: this.queue.length, running: this.runs.length, bosses: { ...this.dstats.bosses } },
      classes,
    };
    const chat = this.chat;
    this.chat = [];
    const heat = this.snapshots++ % 10 === 0 ? this.heat.slice() : undefined;
    return { time: this.time, players, creatures, stats, chat, heat, inspected: this.inspect() };
  }

  private inspect(): PlayerInfo | undefined {
    const p = this.players.find((q) => q.id === this.inspectId);
    if (!p) return undefined;
    const activity: Activity =
      p.state === "dead" ? "dead" : p.state === "rest" ? "rest" : p.state === "fight" ? "fight" : p.state === "queue" ? "queue" : p.state === "dungeon" ? "dungeon" : p.activity;
    return {
      id: p.id,
      name: p.name,
      race: p.race,
      cls: p.cls,
      level: p.level,
      xp: p.xp,
      xpNeeded: xpToLevel(p.level),
      gold: p.gold,
      profile: p.mood.profile,
      patience: p.mood.patience,
      satisfaction: p.mood.satisfaction,
      reason: mainReason(p.mood),
      activity,
      quests: [...p.quests].map(([id, qp]) => ({ id, progress: qp.progress, needed: this.needed(this.quests.get(id)!) })),
      questsDone: p.done.size,
      tree: p.tree,
      spells: p.spells,
      spellsAvailable: this.spellsAvailable(p),
      gear: Object.fromEntries(p.gear),
      dungeonStage: p.run ? { stage: p.run.stage, stages: p.run.stages.length } : null,
      dungeonsDone: p.dungeonsDone,
    };
  }
}

// File de priorité minimale (tas binaire) pour A*.
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    const a = this.items, q = this.prio;
    let i = a.length;
    a.push(item);
    q.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (q[up] <= q[i]) break;
      [a[up], a[i]] = [a[i], a[up]];
      [q[up], q[i]] = [q[i], q[up]];
      i = up;
    }
  }
  pop(): number {
    const a = this.items, q = this.prio;
    const top = a[0];
    const lastItem = a.pop()!, lastP = q.pop()!;
    if (a.length) {
      a[0] = lastItem;
      q[0] = lastP;
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [q[m], q[i]] = [q[i], q[m]];
        i = m;
      }
    }
    return top;
  }
}
