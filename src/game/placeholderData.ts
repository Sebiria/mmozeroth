// Données de remplacement, utilisées tant que le pack de ressources n'est pas branché (étape 8).
type Name = { fr: string; en: string };

export interface CreatureType {
  id: string;
  name: Name;
  color: number;
}

export const CREATURES: CreatureType[] = [
  { id: "sanglier", name: { fr: "Sanglier", en: "Boar" }, color: 0x8a5a3c },
  { id: "scorpide", name: { fr: "Scorpide", en: "Scorpid" }, color: 0xc9a24a },
  { id: "quasit", name: { fr: "Quasit", en: "Imp" }, color: 0x9a4fd0 },
  { id: "raptor", name: { fr: "Raptor", en: "Raptor" }, color: 0x5f9a4a },
  { id: "hyene", name: { fr: "Hyène", en: "Hyena" }, color: 0xb8925a },
  { id: "harpie", name: { fr: "Harpie", en: "Harpy" }, color: 0x6a8fd0 },
  { id: "centaure", name: { fr: "Centaure", en: "Centaur" }, color: 0x7a6a3a },
  { id: "murloc", name: { fr: "Murloc", en: "Murloc" }, color: 0x3fb0a0 },
  { id: "troll", name: { fr: "Troll ennemi", en: "Hostile troll" }, color: 0x4a7ab0 },
  { id: "humain", name: { fr: "Soldat humain", en: "Human soldier" }, color: 0xc0c0d0 },
];

export type NpcRole = "quest" | "vendor" | "trainer" | "inn" | "flight" | "mailbox" | "guard";

export const NPC_ROLES: { id: NpcRole; name: Name; letter: string; color: number }[] = [
  { id: "quest", name: { fr: "Donneur de quêtes", en: "Quest giver" }, letter: "!", color: 0xf2c230 },
  { id: "vendor", name: { fr: "Marchand", en: "Vendor" }, letter: "$", color: 0x5fb85f },
  { id: "trainer", name: { fr: "Maître de classe", en: "Class trainer" }, letter: "M", color: 0x5f9ad8 },
  { id: "inn", name: { fr: "Aubergiste", en: "Innkeeper" }, letter: "A", color: 0xd8875f },
  { id: "flight", name: { fr: "Maître de vol", en: "Flight master" }, letter: "V", color: 0x9fd8e8 },
  { id: "mailbox", name: { fr: "Boîte aux lettres", en: "Mailbox" }, letter: "@", color: 0xb0b0b0 },
  { id: "guard", name: { fr: "Garde", en: "Guard" }, letter: "G", color: 0xc04040 },
];

// Numéros de classe de 3.3.5 (le chevalier de la mort, 6, est exclu).
export const CLASSES: { id: number; name: Name }[] = [
  { id: 1, name: { fr: "Guerrier", en: "Warrior" } },
  { id: 2, name: { fr: "Paladin", en: "Paladin" } },
  { id: 3, name: { fr: "Chasseur", en: "Hunter" } },
  { id: 4, name: { fr: "Voleur", en: "Rogue" } },
  { id: 5, name: { fr: "Prêtre", en: "Priest" } },
  { id: 7, name: { fr: "Chaman", en: "Shaman" } },
  { id: 8, name: { fr: "Mage", en: "Mage" } },
  { id: 9, name: { fr: "Démoniste", en: "Warlock" } },
  { id: 11, name: { fr: "Druide", en: "Druid" } },
];
