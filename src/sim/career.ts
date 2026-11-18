// Mode carrière : l'économie du studio. Les nouveaux joueurs arrivent selon la réputation, la publicité, le prix
// et la concurrence ; ils essaient le jeu gratuitement puis s'abonnent ou partent. L'argent entre par les
// abonnements et sort par les serveurs, la publicité et les mises à jour.
// Les chiffres sont un point de départ, ajustés pendant les tests.
import type { World } from "./world.ts";

export const DAY = 300; // secondes de simulation par jour de jeu
export const MONTH_DAYS = 30;
export const START_MONEY = 20000;
export const REF_PRICE = 13; // prix « normal » d'un abonnement mensuel (€)
export const SERVER_CAPACITY = 100; // joueurs par palier
export const SERVER_COST = 300; // € par mois et par palier
export const AD_COST = 1500;
export const AD_DAYS = 7;
export const TRIAL_DAYS = 2;
export const BANKRUPT_DAYS = 10; // jours d'argent négatif avant la faillite

// Coût de chaque ajout, payé à la publication de la mise à jour.
export const COSTS = { camp: 150, npc: 100, quest: 80, path: 50, item: 20, boss: 600, update: 500 };

export type ObjectiveId = "subs100" | "subs200sat" | "dungeon25";
export const OBJECTIVES: ObjectiveId[] = ["subs100", "subs200sat", "dungeon25"];

export interface Rival {
  name: string;
  reputation: number;
  subscribers: number;
}

export interface Ledger {
  subscriptions: number;
  servers: number;
  ads: number;
  updates: number;
}

export interface CareerState {
  money: number;
  price: number;
  servers: number;
  reputation: number; // 0 à 100
  updateBonus: number; // part de la réputation due à la dernière mise à jour, qui s'estompe
  adUntil: number; // temps de simulation
  negativeTime: number; // depuis combien de temps l'argent est négatif
  arrivals: number; // fraction de joueur en attente d'arriver
  turnedAway: number; // refusés faute de place sur les serveurs (ce mois)
  updates: number;
  done: ObjectiveId[];
  status: "playing" | "won" | "bankrupt";
  rivals: Rival[];
  month: Ledger; // mois en cours
  lastMonth: Ledger;
  monthIndex: number;
}

export const emptyLedger = (): Ledger => ({ subscriptions: 0, servers: 0, ads: 0, updates: 0 });

export function newCareer(): CareerState {
  return {
    money: START_MONEY,
    price: REF_PRICE,
    servers: 1,
    reputation: 50,
    updateBonus: 0,
    adUntil: 0,
    negativeTime: 0,
    arrivals: 0,
    turnedAway: 0,
    updates: 0,
    done: [],
    status: "playing",
    rivals: [
      { name: "Nordbrume", reputation: 58, subscribers: 420 },
      { name: "Ironpixel", reputation: 46, subscribers: 180 },
    ],
    month: emptyLedger(),
    lastMonth: emptyLedger(),
    monthIndex: 0,
  };
}

// Événements racontés dans le canal général.
export type CareerEvent =
  | { kind: "objective"; id: ObjectiveId }
  | { kind: "won" }
  | { kind: "bankrupt" }
  | { kind: "lowMoney" }
  | { kind: "rivalUpdate"; name: string }
  | { kind: "adEnd" }
  | { kind: "full" };

export class Career {
  s: CareerState;
  events: CareerEvent[] = [];
  private dayTimer = 0;
  private fullWarned = 0;
  private world: World;
  private random: () => number;

  constructor(state: CareerState, world: World, random: () => number = Math.random) {
    this.s = state;
    this.world = world;
    this.random = random;
    this.apply();
  }

  get capacity() {
    return this.s.servers * SERVER_CAPACITY;
  }

  // Ce que les réglages changent pour les joueurs simulés.
  private apply() {
    const w = this.world;
    w.autoFill = false;
    w.trialLength = TRIAL_DAYS * DAY;
    const strain = Math.max(0, (this.s.price - REF_PRICE) / REF_PRICE);
    w.priceStrain = strain;
    w.convertAt = Math.min(85, 40 + 35 * strain); // plus c'est cher, plus il faut être content pour s'abonner
  }

  setPrice(price: number) {
    this.s.price = Math.max(1, Math.min(60, price));
    this.apply();
  }

  setServers(n: number) {
    this.s.servers = Math.max(1, Math.min(20, n));
  }

  // Dépense ponctuelle ; refusée s'il n'y a pas assez d'argent.
  spend(amount: number, on: "ads" | "updates"): boolean {
    if (this.s.status !== "playing" || this.s.money < amount) return false;
    this.s.money -= amount;
    this.s.month[on] += amount;
    return true;
  }

  buyAd(): boolean {
    if (!this.spend(AD_COST, "ads")) return false;
    this.s.adUntil = Math.max(this.s.adUntil, this.world.time) + AD_DAYS * DAY;
    return true;
  }

  // Une mise à jour publiée : son coût, et un bonus d'image selon le nombre d'ajouts.
  publish(cost: number, additions: number): boolean {
    if (!this.spend(cost, "updates")) return false;
    this.s.updates++;
    this.s.updateBonus = Math.min(20, this.s.updateBonus + 1.5 * additions);
    return true;
  }

  // Combien de nouveaux joueurs par jour : le marché, partagé avec les concurrents selon l'attrait de chacun.
  arrivalsPerDay(): number {
    const day = this.world.time / DAY;
    const market = 25 + 0.6 * day;
    const subs = this.world.subscriberCount;
    const attract = (rep: number, n: number) => (rep / 50) ** 2 * (1 + n / 300);
    const mine = attract(this.s.reputation, subs);
    const others = this.s.rivals.reduce((a, r) => a + attract(r.reputation, r.subscribers), 0);
    const price = (REF_PRICE / this.s.price) ** 1.5;
    const ad = this.world.time < this.s.adUntil ? 2 : 1;
    return market * (mine / (mine + others)) * price * ad;
  }

  step(dt: number) {
    const s = this.s, w = this.world;
    if (s.status === "bankrupt") return;
    // Argent : abonnements et serveurs, au fil du temps (prix mensuels ramenés à la seconde)
    const perSec = 1 / (MONTH_DAYS * DAY);
    const income = w.subscriberCount * s.price * perSec * dt;
    const servers = s.servers * SERVER_COST * perSec * dt;
    s.money += income - servers;
    s.month.subscriptions += income;
    s.month.servers += servers;

    // Arrivées : au-delà de 125 % de la capacité, les nouveaux venus ne peuvent pas se connecter.
    s.arrivals += (this.arrivalsPerDay() / DAY) * dt;
    while (s.arrivals >= 1) {
      s.arrivals--;
      if (w.playerCount >= this.capacity * 1.25) {
        s.turnedAway++;
        s.reputation = Math.max(0, s.reputation - 0.05);
        if (w.time > this.fullWarned) {
          this.fullWarned = w.time + DAY;
          this.events.push({ kind: "full" });
        }
      } else w.welcome();
    }
    // Lag : les serveurs surchargés font baisser la satisfaction
    w.lag = Math.max(0, w.playerCount / this.capacity - 1);

    // Réputation : suit la satisfaction des joueurs (bouche-à-oreille), plus le bonus de la dernière mise à jour
    const sat = w.playerCount ? w.averageSatisfaction : 50;
    const goal = Math.min(100, sat + s.updateBonus);
    s.reputation += ((goal - s.reputation) * dt) / (3 * DAY);
    s.updateBonus *= Math.exp(-dt / (10 * DAY));

    if (s.adUntil > 0 && w.time >= s.adUntil) {
      s.adUntil = 0;
      this.events.push({ kind: "adEnd" });
    }

    // Faillite : trop longtemps dans le rouge
    if (s.money < 0) {
      if (s.negativeTime === 0) this.events.push({ kind: "lowMoney" });
      s.negativeTime += dt;
      if (s.negativeTime >= BANKRUPT_DAYS * DAY) {
        s.status = "bankrupt";
        this.events.push({ kind: "bankrupt" });
        return;
      }
    } else s.negativeTime = 0;

    // Une fois par jour : concurrents, objectifs, changement de mois
    this.dayTimer += dt;
    if (this.dayTimer >= DAY) {
      this.dayTimer -= DAY;
      this.daily();
    }
  }

  private daily() {
    const s = this.s, w = this.world;
    for (const r of s.rivals) {
      r.reputation += (50 - r.reputation) * 0.05 + (this.random() - 0.5) * 4;
      if (this.random() < 0.03) {
        r.reputation += 12;
        this.events.push({ kind: "rivalUpdate", name: r.name });
      }
      r.reputation = Math.max(5, Math.min(95, r.reputation));
      r.subscribers = Math.max(0, Math.round(r.subscribers * (1 + (r.reputation - 48) / 1000)));
    }
    const month = Math.floor(w.time / (MONTH_DAYS * DAY));
    if (month !== s.monthIndex) {
      s.monthIndex = month;
      s.lastMonth = s.month;
      s.month = emptyLedger();
      s.turnedAway = 0;
    }
    this.checkObjectives();
  }

  checkObjectives() {
    const s = this.s, w = this.world;
    const reached: Record<ObjectiveId, boolean> = {
      subs100: w.subscriberCount >= 100,
      subs200sat: w.subscriberCount >= 200 && w.averageSatisfaction >= 65,
      dungeon25: w.dungeonCompleted >= 25,
    };
    for (const id of OBJECTIVES)
      if (!s.done.includes(id) && reached[id]) {
        s.done.push(id);
        this.events.push({ kind: "objective", id });
      }
    if (s.status === "playing" && s.done.length === OBJECTIVES.length) {
      s.status = "won";
      this.events.push({ kind: "won" });
    }
  }
}
