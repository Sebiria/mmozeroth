// Humeur d'un joueur simulé : profil, patience, satisfaction et raisons de son humeur.
// Les poids sont provisoires et seront ajustés pendant les tests.

export type Profile = "quester" | "explorer" | "dungeon" | "collector" | "hurried";
export const PROFILES: Profile[] = ["quester", "explorer", "dungeon", "collector", "hurried"];

// Raisons négatives d'abord, puis positives.
export type Reason =
  | "idle" | "walk" | "crowd" | "death" | "slow" | "trainer" | "weak" | "useless" | "group" | "wipe" | "lag" | "price"
  | "quest" | "level" | "discover" | "progress" | "loot" | "dungeon";
export const REASONS: Reason[] = [
  "idle", "walk", "crowd", "death", "slow", "trainer", "weak", "useless", "group", "wipe", "lag", "price",
  "quest", "level", "discover", "progress", "loot", "dungeon",
];

// Sensibilité de chaque profil à chaque raison (1 = normal).
const WEIGHTS: Record<Profile, Partial<Record<Reason, number>>> = {
  quester: { quest: 1.5, idle: 1.5, discover: 0.5, dungeon: 0.8 },
  explorer: { quest: 0.7, walk: 0.4, idle: 0.8, discover: 2, group: 0.8 },
  dungeon: { discover: 0.5, dungeon: 2, group: 1.3, wipe: 0.7, loot: 1.2 },
  collector: { crowd: 1.2, discover: 0.8, loot: 2, useless: 1.8 },
  hurried: { walk: 2, crowd: 2, idle: 2, slow: 2, discover: 0.3, group: 2, wipe: 1.5, trainer: 1.5, lag: 2 },
};

// Envie d'aller dans l'instance, selon le profil (chance à chaque choix d'activité).
export const DUNGEON_WISH: Record<Profile, number> = { quester: 0.3, explorer: 0.25, dungeon: 0.9, collector: 0.6, hurried: 0.2 };

export interface Mood {
  profile: Profile;
  patience: number; // 0.6 (impatient) à 1.4 (patient) : divise les effets négatifs
  satisfaction: number; // 0 à 100
  scores: Record<Reason, number>; // effets récents par raison (s'effacent avec le temps)
  pending: Record<Reason, number>; // effets négatifs accumulés depuis le dernier message sur ce sujet
  lowTime: number; // temps passé sous le seuil de départ
}

const zero = () => Object.fromEntries(REASONS.map((r) => [r, 0])) as Record<Reason, number>;

export function newMood(random: () => number): Mood {
  return {
    profile: PROFILES[Math.floor(random() * PROFILES.length)],
    patience: 0.6 + random() * 0.8,
    satisfaction: 70,
    scores: zero(),
    pending: zero(),
    lowTime: 0,
  };
}

// Applique un effet (positif ou négatif) selon le profil et la patience. Renvoie l'effet réel.
export function feel(m: Mood, reason: Reason, amount: number): number {
  let d = amount * (WEIGHTS[m.profile][reason] ?? 1);
  if (d < 0) {
    d /= m.patience;
    m.pending[reason] -= d;
  }
  m.satisfaction = Math.max(0, Math.min(100, m.satisfaction + d));
  m.scores[reason] += d;
  return d;
}

// Les souvenirs s'effacent (demi-vie d'environ une minute).
export function fade(m: Mood, dt: number) {
  const k = Math.exp(-dt / 90);
  for (const r of REASONS) m.scores[r] *= k;
}

// Raison principale : la plus forte du bon signe (négative si le joueur est mécontent).
export function mainReason(m: Mood): Reason {
  const unhappy = m.satisfaction < 50;
  let best: Reason = unhappy ? "idle" : "progress";
  let bestScore = 0;
  for (const r of REASONS) {
    const s = unhappy ? -m.scores[r] : m.scores[r];
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return best;
}
