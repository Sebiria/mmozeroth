// Fiche de l'élément sélectionné, avec ses réglages modifiables, et liste des quêtes.
import { lang, t } from "../i18n";
import { defaultClasses, questProblems, type Content, type Entity, type Item, type Npc, type Point, type Quest, type QuestType } from "../game/content";
import { CLASSES, CREATURES, NPC_ROLES } from "../game/placeholderData";
import type { CareerInfo, LootEntry, PlayerInfo, SimStats } from "../sim/protocol";
import { AD_COST, AD_DAYS, DAY, OBJECTIVES, REF_PRICE, SERVER_CAPACITY, SERVER_COST } from "../sim/career.ts";
import { packIcon } from "../game/gameMap";
import type { PackData, PackItem } from "../game/packData";
import { CLASS_RULES, SLOTS, TALENT_LEVEL, usefulFor, type Slot, type Stat } from "../sim/rules.ts";

const QUALITY_COLORS = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee"];
type View = "items" | "classes" | "dungeon" | "studio";

interface PanelActions {
  onDelete: (id: number) => void;
  onSelect: (id: number | null) => void;
  onPick: (done: (p: Point) => void) => void; // attend un clic sur la carte
  onFollow: (id: number | null) => void; // la caméra suit ce joueur (null : arrêter)
  onSetLevel: (id: number, level: number) => void;
  onPrice: (price: number) => void;
  onServers: (count: number) => void;
  onAd: () => void;
}

type Mode = { kind: "none" } | { kind: "entity"; e: Entity } | { kind: "questList" } | { kind: "player"; id: number } | { kind: "view"; view: View };

export class Panel {
  private mode: Mode = { kind: "none" };
  private stats: SimStats | null = null;
  private inspected: PlayerInfo | undefined;
  private playerInfoEl: HTMLElement | null = null; // seule partie de la fiche joueur redessinée à chaque tour
  private liveEl: HTMLElement | null = null; // statistiques des fiches Classes et Gouffre, redessinées à chaque tour
  private search = "";
  private careerInfo: CareerInfo | null = null;
  following: number | null = null;
  career = false; // mode carrière : pas d'outils de test

  constructor(
    private pack: PackData,
    private el: HTMLElement,
    private content: Content,
    private actions: PanelActions,
  ) {}

  show(e: Entity | undefined) {
    this.mode = e ? { kind: "entity", e } : { kind: "none" };
    this.render();
  }

  showView(view: View) {
    this.mode = { kind: "view", view };
    this.render();
  }

  showQuestList() {
    this.mode = { kind: "questList" };
    this.render();
  }

  showPlayer(id: number) {
    this.mode = { kind: "player", id };
    this.inspected = undefined;
    this.render();
  }

  get playerId(): number | null {
    return this.mode.kind === "player" ? this.mode.id : null;
  }

  // Met à jour les compteurs sans reconstruire la fiche (sinon les champs perdraient le focus).
  // Dans la fiche d'un joueur, seule la partie infos est redessinée ; les outils du bac à sable restent en place.
  updateStats(stats: SimStats, inspected: PlayerInfo | undefined, career: CareerInfo | null = null) {
    this.stats = stats;
    this.careerInfo = career;
    this.inspected = inspected;
    if (this.mode.kind === "player") return this.renderPlayerInfo(this.mode.id);
    if (this.mode.kind === "view") return this.renderLive();
    for (const span of this.el.querySelectorAll<HTMLElement>("[data-qid]")) span.textContent = this.questStatsText(Number(span.dataset.qid));
    for (const span of this.el.querySelectorAll<HTMLElement>("[data-camp]")) span.textContent = this.campStatsText(Number(span.dataset.camp));
    for (const span of this.el.querySelectorAll<HTMLElement>("[data-npc]")) span.textContent = t.npcVisits(stats.npcVisits[Number(span.dataset.npc)] ?? 0);
  }

  private questStatsText(id: number) {
    const s = this.stats?.quests[id];
    return t.questStats(s?.accepted ?? 0, s?.completed ?? 0, s?.rating ?? 0);
  }

  private campStatsText(id: number) {
    const s = this.stats?.camps[id];
    return t.campStats(s?.kills ?? 0, s?.crowded ?? 0);
  }

  private renderPlayer(id: number) {
    this.playerInfoEl = document.createElement("div");
    const tools = document.createElement("div");
    const following = this.following === id;
    const level = number(t.forceLevel, this.inspected?.id === id ? this.inspected.level : 1, 1, 80, () => {});
    tools.append(
      h4(t.sandboxTools),
      button(following ? t.stopFollow : t.follow, () => {
        this.actions.onFollow(following ? null : id);
        this.render();
      }, following ? "active" : ""),
      level,
      button(t.apply, () => this.actions.onSetLevel(id, Number(level.querySelector("input")!.value))),
    );
    this.el.append(this.playerInfoEl);
    if (!this.career) this.el.append(tools);
    this.renderPlayerInfo(id);
  }

  private renderPlayerInfo(id: number) {
    const el = this.playerInfoEl;
    if (!el) return;
    el.replaceChildren();
    const info = this.inspected;
    if (!info || info.id !== id) {
      el.append(h(t.player), p(this.stats ? t.playerGone : "…", "muted"));
      return;
    }
    const cls = CLASSES[info.cls];
    const title = h(info.name);
    title.prepend(packIcon(`class_${cls.id}`, 22));
    el.append(
      title,
      p(`${t.races[info.race]} · ${cls.name[lang]} · ${t.level} ${info.level}`),
      p(`XP : ${info.xp} / ${info.xpNeeded} · ${t.gold} : ${t.formatGold(info.gold)}`),
      p(`${t.profile} : ${t.profiles[info.profile]} · ${t.patience} : ${t.patienceLevel(info.patience)}`),
    );
    // Jauge de satisfaction
    const gauge = document.createElement("div");
    gauge.className = "gauge";
    const bar = document.createElement("div");
    bar.style.width = `${info.satisfaction}%`;
    bar.style.background = info.satisfaction < 30 ? "#d04030" : info.satisfaction < 55 ? "#d8a030" : "#5fb85f";
    gauge.append(bar);
    el.append(p(`${t.satisfaction} : ${Math.round(info.satisfaction)} %`), gauge, p(`${t.mood} : ${t.reasons[info.reason]}`));
    el.append(p(`${t.activity} : ${t.activities[info.activity]}${info.dungeonStage ? ` (${t.dungeonStage(info.dungeonStage.stage + 1, info.dungeonStage.stages)})` : ""}`));
    const tree = info.tree >= 0 ? CLASS_RULES[info.cls].trees[info.tree] : null;
    el.append(
      p(`${t.talents} : ${tree ? `${tree.name[lang]} (${t.roles[tree.role]})` : t.talentsLater(TALENT_LEVEL)}`),
      p(`${t.spells} : ${info.spells} / ${info.spellsAvailable}${info.spellsAvailable - info.spells >= 2 ? ` · ${t.toLearn}` : ""}`),
      p(`${t.dungeonsDone} : ${info.dungeonsDone}`),
    );
    el.append(h4(t.gear));
    const gear = Object.entries(info.gear);
    if (!gear.length) el.append(p(t.none, "muted"));
    const row = document.createElement("div");
    row.className = "gear";
    for (const [slot, id] of gear) {
      const it = this.content.get(id ?? null);
      if (it?.kind !== "item") continue;
      const cell = this.itemLabel(it);
      cell.title = `${t.slots[slot as Slot]} : ${it.name}`;
      row.append(cell);
    }
    el.append(row);
    el.append(h4(`${t.questsActive} (${t.questsDoneCount} : ${info.questsDone})`));
    if (!info.quests.length) el.append(p(t.none, "muted"));
    for (const q of info.quests) {
      const quest = this.content.get(q.id);
      el.append(p(`${quest?.kind === "quest" ? quest.name : "?"} : ${q.progress} / ${q.needed}`));
    }
  }

  render() {
    const el = this.el;
    el.replaceChildren();
    this.playerInfoEl = null;
    this.liveEl = null;
    const m = this.mode;
    if (m.kind === "questList") return this.renderQuestList();
    if (m.kind === "view")
      return m.view === "items" ? this.renderItems() : m.view === "classes" ? this.renderClasses() : m.view === "studio" ? this.renderStudio() : this.renderDungeon();
    if (m.kind === "player") return this.renderPlayer(m.id);
    if (m.kind === "none") {
      el.append(p(t.nothingSelected, "muted"));
      return;
    }
    const e = m.e;
    if (e.kind === "quest") return this.renderQuest(e);
    if (e.kind === "item") return this.renderItem(e);
    if (e.kind === "classes" || e.kind === "dungeon") return;
    const changed = () => this.content.changed();

    if (e.kind === "camp") {
      el.append(h(t.camp));
      el.append(
        select(t.creature, CREATURES.map((c) => [c.id, c.name[lang]]), e.creature, (v) => ((e.creature = v), changed())),
        number(t.minLevel, e.minLevel, 1, 80, (v) => {
          e.minLevel = v;
          if (e.maxLevel < v) e.maxLevel = v;
          changed();
          this.render();
        }),
        number(t.maxLevel, e.maxLevel, 1, 80, (v) => {
          e.maxLevel = v;
          if (e.minLevel > v) e.minLevel = v;
          changed();
          this.render();
        }),
        number(t.count, e.count, 1, 30, (v) => ((e.count = v), changed())),
        number(t.radius, e.radius, 1, 12, (v) => ((e.radius = v), changed())),
        number(t.respawn, e.respawn, 5, 3600, (v) => ((e.respawn = v), changed())),
        h4(t.loot),
        this.lootEditor(e.loot),
        statLine("camp", e.id, this.campStatsText(e.id)),
      );
    } else if (e.kind === "npc") {
      el.append(h(t.npc));
      el.append(
        text(t.name, e.name, (v) => ((e.name = v), changed())),
        select(t.role, NPC_ROLES.map((r) => [r.id, r.name[lang]]), e.role, (v) => {
          e.role = v as typeof e.role;
          changed();
          this.render(); // le champ « classe enseignée » apparaît ou disparaît
        }),
      );
      if (e.role === "trainer")
        el.append(
          select(t.trainerClass, CLASSES.map((c) => [String(c.id), c.name[lang]]), String(e.trainerClass), (v) => {
            e.trainerClass = Number(v);
            changed();
          }),
        );
      el.append(statLine("npc", e.id, t.npcVisits(this.stats?.npcVisits[e.id] ?? 0)));
      el.append(h4(t.questsGiven));
      for (const q of this.content.quests().filter((q) => q.giverId === e.id)) el.append(this.questLink(q));
      el.append(button(t.newQuest, () => this.newQuest(e)));
    } else {
      el.append(h(t.path), p(`${t.points} : ${e.points.length}`), p(t.pathHelp, "muted"));
    }
    el.append(button(t.delete, () => this.actions.onDelete(e.id), "danger"));
  }

  // --- Objets ---
  private itemOptions(): [string, string][] {
    return this.content.items().map((i) => [String(i.id), `${i.name} (${t.slots[i.slot]}, ${t.level} ${i.level})`]);
  }

  private itemLabel(i: Item) {
    const span = document.createElement("span");
    span.className = "item";
    if (i.icon) span.append(packIcon(i.icon, 18));
    const name = document.createElement("span");
    name.textContent = i.name;
    name.style.color = QUALITY_COLORS[i.quality] ?? "";
    span.append(name);
    return span;
  }

  // Un objet de 3.3.5 ajouté à la partie (une seule fois).
  private importItem(pi: PackItem): Item {
    const have = this.content.items().find((i) => i.source === pi.id);
    if (have) return have;
    const { slot, level, stat, armor, power, survival } = pi;
    return this.content.add<Item>({ kind: "item", id: 0, name: pi.name[lang], icon: pi.icon ?? null, quality: pi.quality, source: pi.id, slot, level, stat, armor, power, survival });
  }

  private renderItems() {
    const el = this.el;
    el.append(h(t.toolItems));
    const items = this.content.items().sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    if (!items.length) el.append(p(t.noItems, "muted"));
    for (const i of items) {
      const b = button("", () => this.actions.onSelect(i.id), "link item-link");
      b.append(this.itemLabel(i), Object.assign(document.createElement("small"), { textContent: ` ${t.slots[i.slot]} · ${t.level} ${i.level}` }));
      el.append(b);
    }
    el.append(button(t.newItem, () => {
      const it = this.content.add<Item>({ kind: "item", id: 0, name: t.newItemName, icon: null, quality: 2, source: null, slot: "chest", level: 5, stat: "sta", armor: 0, power: 3, survival: 6 });
      this.actions.onSelect(it.id);
    }));
    // Recherche parmi les objets de 3.3.5 du pack
    el.append(h4(t.importItems));
    if (!this.pack.items.length) {
      el.append(p(t.noPack, "muted"));
      return;
    }
    const results = document.createElement("div");
    const draw = () => {
      const q = this.search.trim().toLowerCase();
      const found = q.length < 2 ? [] : this.pack.items.filter((i) => i.name[lang].toLowerCase().includes(q)).slice(0, 25);
      results.replaceChildren(...found.map((pi) => {
        const b = button("", () => {
          this.importItem(pi);
          this.render();
        }, "link item-link");
        const lbl = document.createElement("span");
        lbl.className = "item";
        if (pi.icon) lbl.append(packIcon(pi.icon, 18));
        const nm = Object.assign(document.createElement("span"), { textContent: `+ ${pi.name[lang]}` });
        nm.style.color = QUALITY_COLORS[pi.quality] ?? "";
        lbl.append(nm);
        b.append(lbl, Object.assign(document.createElement("small"), { textContent: ` ${t.slots[pi.slot]} · ${t.level} ${pi.level}` }));
        return b;
      }));
      if (q.length >= 2 && !found.length) results.append(p(t.none, "muted"));
    };
    const box = text(t.searchItems, this.search, (v) => ((this.search = v), draw()));
    el.append(box, results);
    draw();
  }

  private renderItem(i: Item) {
    const el = this.el;
    const changed = () => this.content.changed();
    const title = h(t.item);
    el.append(button(t.backToItems, () => this.showView("items"), "link"), title);
    if (i.icon) title.prepend(packIcon(i.icon, 22));
    const stats: Stat[] = ["str", "agi", "int", "sta", "none"];
    el.append(
      text(t.name, i.name, (v) => ((i.name = v), changed())),
      select(t.slot, SLOTS.map((k) => [k, t.slots[k]]), i.slot, (v) => ((i.slot = v as Slot), changed())),
      number(t.requiredLevel, i.level, 0, 80, (v) => ((i.level = v), changed())),
      select(t.quality, QUALITY_COLORS.map((_, k) => [String(k), t.qualities[k]]), String(i.quality), (v) => ((i.quality = Number(v)), changed(), this.render())),
      select(t.mainStat, stats.map((k) => [k, t.stats[k]]), i.stat, (v) => ((i.stat = v as Stat), changed())),
      select(t.armorType, [-1, 0, 1, 2, 3].map((k) => [String(k), t.armorTypes[k + 1]]), String(i.armor), (v) => ((i.armor = Number(v)), changed())),
      number(t.power, i.power, 0, 500, (v) => ((i.power = v), changed())),
      number(t.survival, i.survival, 0, 500, (v) => ((i.survival = v), changed())),
      p(t.usefulFor(CLASSES.filter((_, k) => usefulFor(i, k)).map((c) => c.name[lang]).join(", ") || t.none), "muted"),
    );
    if (i.source) el.append(p(t.from3355(i.source), "muted"));
    el.append(button(t.delete, () => this.actions.onDelete(i.id), "danger"));
  }

  // Table de butin : objet et chance (%).
  private lootEditor(loot: LootEntry[]) {
    const box = document.createElement("div");
    const changed = () => this.content.changed();
    const draw = () => {
      box.replaceChildren();
      const options = this.itemOptions();
      for (const l of loot) {
        const row = document.createElement("div");
        row.className = "loot-row";
        const it = this.content.get(l.itemId);
        if (it?.kind === "item") row.append(this.itemLabel(it));
        row.append(
          number("%", l.chance, 1, 100, (v) => ((l.chance = v), changed())),
          button("×", () => {
            loot.splice(loot.indexOf(l), 1);
            changed();
            draw();
          }),
        );
        box.append(row);
      }
      if (!options.length) {
        box.append(p(t.noItemsForLoot, "muted"));
        return;
      }
      box.append(select(t.addLoot, [["", "…"], ...options], "", (v) => {
        if (!v) return;
        loot.push({ itemId: Number(v), chance: 20 });
        changed();
        draw();
      }));
    };
    draw();
    return box;
  }

  // --- Classes ---
  private renderClasses() {
    const el = this.el;
    const cs = this.content.classSettings();
    const changed = () => this.content.changed();
    el.append(h(t.toolClasses), p(t.classesHelp, "muted"));
    CLASS_RULES.forEach((rule, k) => {
      const c = cs.classes[k];
      const title = h4(CLASSES[k].name[lang]);
      title.prepend(packIcon(`class_${rule.id}`, 18));
      el.append(
        title,
        number(t.power, c.power, 10, 300, (v) => ((c.power = v), changed())),
        number(t.survival, c.survival, 10, 300, (v) => ((c.survival = v), changed())),
        p(rule.trees.map((tr) => `${tr.name[lang]} (${t.roles[tr.role]})`).join(" · "), "muted"),
      );
    });
    el.append(button(t.resetClasses, () => {
      cs.classes = defaultClasses();
      changed();
      this.render();
    }));
    el.append(h4(t.classStats));
    this.liveEl = document.createElement("div");
    el.append(this.liveEl);
    this.renderLive();
  }

  // --- Gouffre de Ragefeu ---
  private renderDungeon() {
    const el = this.el;
    const d = this.content.dungeon();
    const changed = () => this.content.changed();
    el.append(h(t.toolDungeon), p(t.dungeonHelp, "muted"));
    el.append(
      number(t.minLevel, d.minLevel, 1, 20, (v) => ((d.minLevel = v), (d.maxLevel = Math.max(d.maxLevel, v)), changed(), this.render())),
      number(t.maxLevel, d.maxLevel, 1, 20, (v) => ((d.maxLevel = v), (d.minLevel = Math.min(d.minLevel, v)), changed(), this.render())),
      number(t.difficulty, d.difficulty, 20, 300, (v) => ((d.difficulty = v), changed())),
      number(t.trash, d.trash, 0, 20, (v) => ((d.trash = v), changed())),
    );
    el.append(h4(t.bosses));
    if (!d.bosses.length) el.append(p(t.noBosses, "warn"));
    for (const b of d.bosses) {
      const box = document.createElement("div");
      box.className = "boss";
      box.append(
        text(t.name, b.name, (v) => ((b.name = v), changed())),
        number(t.level, b.level, 1, 25, (v) => ((b.level = v), changed())),
        number(t.bossHealth, b.health, 20, 500, (v) => ((b.health = v), changed())),
        h4(t.loot),
        this.lootEditor(b.loot),
        button(t.removeBoss, () => {
          d.bosses.splice(d.bosses.indexOf(b), 1);
          changed();
          this.render();
        }, "danger"),
      );
      el.append(box);
    }
    el.append(button(t.addBoss, () => {
      d.bosses.push({ id: this.content.newId(), name: t.newBossName, level: d.maxLevel - 2, health: 100, loot: [] });
      changed();
      this.render();
    }));
    if (this.pack.bosses.length)
      el.append(button(t.originalBosses, () => {
        if (d.bosses.length && !confirm(t.confirmBosses)) return;
        const byId = new Map(this.pack.items.map((i) => [i.id, i]));
        d.bosses = this.pack.bosses.map((pb) => ({
          id: this.content.newId(),
          name: pb.name[lang],
          level: pb.level,
          health: 100,
          loot: pb.loot.filter((l) => byId.has(l.item)).map((l) => ({ itemId: this.importItem(byId.get(l.item)!).id, chance: l.chance })),
        }));
        changed();
        this.render();
      }));
    el.append(h4(t.dungeonStats));
    this.liveEl = document.createElement("div");
    el.append(this.liveEl);
    this.renderLive();
  }

  // --- Studio (mode carrière) : argent, prix, serveurs, publicité, objectifs, concurrents ---
  private renderStudio() {
    const el = this.el;
    const c = this.careerInfo?.state;
    el.append(h(t.toolStudio));
    if (!c) {
      el.append(p("…", "muted"));
      return;
    }
    el.append(
      number(t.price, c.price, 1, 60, (v) => this.actions.onPrice(v)),
      p(t.priceHelp(REF_PRICE), "muted"),
      number(t.servers, c.servers, 1, 20, (v) => this.actions.onServers(v)),
      p(t.serversHelp(SERVER_CAPACITY, this.formatMoney(SERVER_COST)), "muted"),
      button(t.buyAd(this.formatMoney(AD_COST), AD_DAYS), () => this.actions.onAd()),
    );
    this.liveEl = document.createElement("div");
    el.append(this.liveEl);
    this.renderLive();
  }

  private formatMoney(v: number) {
    return t.formatMoney(v);
  }

  private renderLive() {
    const el = this.liveEl;
    const s = this.stats;
    if (!el || this.mode.kind !== "view") return;
    el.replaceChildren();
    if (!s) return;
    if (this.mode.view === "classes") {
      s.classes.forEach((c, k) => {
        el.append(p(t.classLine(CLASSES[k].name[lang], c.players, c.avgLevel, c.satisfaction, c.deaths)));
      });
    } else if (this.mode.view === "studio") {
      const ci = this.careerInfo;
      if (!ci) return;
      const c = ci.state;
      const m = c.month, lm = c.lastMonth;
      el.append(
        h4(t.finances),
        p(`${t.money} : ${this.formatMoney(c.money)}`, c.money < 0 ? "warn" : ""),
        p(t.ledger(t.thisMonth, this.formatMoney(m.subscriptions), this.formatMoney(m.servers), this.formatMoney(m.ads), this.formatMoney(m.updates))),
        p(t.ledger(t.lastMonthL, this.formatMoney(lm.subscriptions), this.formatMoney(lm.servers), this.formatMoney(lm.ads), this.formatMoney(lm.updates)), "muted"),
      );
      if (c.money < 0) el.append(p(t.bankruptWarning(Math.max(0, Math.ceil(10 - c.negativeTime / DAY))), "warn"));
      el.append(
        h4(t.audience),
        p(`${t.reputation} : ${Math.round(c.reputation)} / 100 · ${t.arrivals} : ${ci.arrivalsPerDay.toFixed(1)} ${t.perDay}`),
        p(t.trialLine(ci.subscribers, ci.trials.running, ci.trials.converted, ci.trials.left)),
        p(t.capacityLine(this.stats?.players ?? 0, ci.capacity, c.turnedAway), (this.stats?.players ?? 0) > ci.capacity ? "warn" : ""),
      );
      if (c.adUntil > 0) el.append(p(t.adRunning, "muted"));
      el.append(h4(t.objectives));
      for (const id of OBJECTIVES) el.append(p(`${c.done.includes(id) ? "✔" : "○"} ${t.objectiveNames[id]}`, c.done.includes(id) ? "" : "muted"));
      if (c.status === "won") el.append(p(t.wonLine, "good"));
      el.append(h4(t.rivals));
      for (const r of c.rivals) el.append(p(t.rivalLine(r.name, Math.round(r.reputation), r.subscribers)));
    } else if (this.mode.view === "dungeon") {
      const d = s.dungeon;
      el.append(
        p(t.dungeonLine1(d.queue, d.running)),
        p(t.dungeonLine2(d.formed, d.completed, d.abandoned, d.wipes)),
        p(t.dungeonLine3(d.formed ? d.waitSum / d.formed : 0, d.completed ? d.durationSum / d.completed : 0)),
      );
      for (const b of this.content.dungeon().bosses) {
        const bs = d.bosses[b.id];
        el.append(p(t.bossLine(b.name, bs?.kills ?? 0, bs?.wipes ?? 0)));
      }
    }
  }

  private renderQuestList() {
    const el = this.el;
    el.append(h(t.questList));
    const quests = this.content.quests();
    if (!quests.length) el.append(p(t.noQuests, "muted"));
    // Les chaînes sont affichées à la suite, chaque quête décalée sous la précédente.
    const shown = new Set<number>();
    const add = (q: Quest, depth: number) => {
      if (shown.has(q.id)) return;
      shown.add(q.id);
      const link = this.questLink(q);
      link.style.marginLeft = `${depth * 14}px`;
      el.append(link);
      for (const next of quests.filter((n) => n.prevId === q.id)) add(next, depth + 1);
    };
    for (const q of quests) if (q.prevId === null || !this.content.get(q.prevId)) add(q, 0);
    for (const q of quests) add(q, 0); // chaînes en boucle, par sécurité
    el.append(button(t.newQuest, () => this.newQuest(null)));
  }

  private questLink(q: Quest) {
    const div = document.createElement("div");
    div.className = "quest-link";
    const b = button(`${questProblems(q, this.content).length ? "⚠ " : ""}${q.name}`, () => this.actions.onSelect(q.id));
    const stats = document.createElement("small");
    stats.dataset.qid = String(q.id);
    stats.textContent = this.questStatsText(q.id);
    div.append(b, stats);
    return div;
  }

  private newQuest(giver: Npc | null) {
    const camps = [...this.content.entities.values()].filter((e) => e.kind === "camp");
    const near = giver && camps.sort((a, b) => Math.hypot(a.x - giver.x, a.y - giver.y) - Math.hypot(b.x - giver.x, b.y - giver.y))[0];
    const q = this.content.add<Quest>({
      kind: "quest",
      id: 0,
      name: t.newQuestName,
      type: "kill",
      giverId: giver?.id ?? null,
      enderId: giver?.id ?? null,
      prevId: null,
      minLevel: 1,
      campId: near?.id ?? camps[0]?.id ?? null,
      count: 6,
      dropChance: 50,
      objectItem: "",
      target: null,
      xp: 150,
      gold: 50,
      rewardItemId: null,
    });
    this.actions.onSelect(q.id);
  }

  private renderQuest(q: Quest) {
    const el = this.el;
    const changed = () => this.content.changed();
    const npcs = [...this.content.entities.values()].filter((e): e is Npc => e.kind === "npc");
    const npcOptions: [string, string][] = [["", t.none], ...npcs.map((n): [string, string] => [String(n.id), n.name])];
    const idOf = (v: string) => (v === "" ? null : Number(v));
    const rerender = () => (changed(), this.render());

    el.append(button(t.backToList, () => this.showQuestList(), "link"), h(t.quest));
    el.append(
      text(t.name, q.name, (v) => ((q.name = v), changed())),
      select(t.questType, (Object.keys(t.questTypes) as QuestType[]).map((k) => [k, t.questTypes[k]]), q.type, (v) => {
        q.type = v as QuestType;
        rerender();
      }),
      select(t.giver, npcOptions, String(q.giverId ?? ""), (v) => ((q.giverId = idOf(v)), rerender())),
      select(t.ender, npcOptions, String(q.enderId ?? ""), (v) => ((q.enderId = idOf(v)), rerender())),
      select(
        t.prev,
        [["", t.none], ...this.content.quests().filter((o) => o.id !== q.id).map((o): [string, string] => [String(o.id), o.name])],
        String(q.prevId ?? ""),
        (v) => ((q.prevId = idOf(v)), changed()),
      ),
      number(t.requiredLevel, q.minLevel, 1, 80, (v) => ((q.minLevel = v), changed())),
    );

    // Objectif, selon le type
    if (q.type === "kill" || q.type === "collect") {
      const camps = [...this.content.entities.values()].filter((e) => e.kind === "camp");
      const campOptions: [string, string][] = [
        ["", t.none],
        ...camps.map((c): [string, string] => {
          const name = CREATURES.find((k) => k.id === c.creature)?.name[lang] ?? c.creature;
          return [String(c.id), `${name} ${c.minLevel}-${c.maxLevel} (#${c.id})`];
        }),
      ];
      el.append(select(t.targetCamp, campOptions, String(q.campId ?? ""), (v) => ((q.campId = idOf(v)), rerender())));
      el.append(number(q.type === "kill" ? t.killCount : t.collectCount, q.count, 1, 50, (v) => ((q.count = v), changed())));
      if (q.type === "collect") {
        el.append(text(t.objectItem, q.objectItem, (v) => ((q.objectItem = v), changed())));
        el.append(number(t.dropChance, q.dropChance, 1, 100, (v) => ((q.dropChance = v), changed())));
      }
    } else if (q.type === "deliver") {
      el.append(text(t.objectItem, q.objectItem, (v) => ((q.objectItem = v), changed())), p(t.deliverHelp, "muted"));
    } else {
      el.append(p(`${t.place} : ${q.target ? `${q.target.x}, ${q.target.y}` : t.notChosen}`));
      el.append(
        button(t.pickOnMap, () =>
          this.actions.onPick((pt) => {
            q.target = pt;
            changed();
            if (this.mode.kind === "entity" && this.mode.e === q) this.render();
          }),
        ),
      );
    }

    el.append(
      h4(t.rewards),
      number(t.rewardXp, q.xp, 0, 100000, (v) => ((q.xp = v), changed())),
      number(t.rewardGold, q.gold, 0, 1000000, (v) => ((q.gold = v), changed())),
      select(t.rewardItem, [["", t.none], ...this.itemOptions()], String(q.rewardItemId ?? ""), (v) => ((q.rewardItemId = idOf(v)), changed())),
    );

    const problems = questProblems(q, this.content);
    if (problems.length) el.append(p(t.inactive, "warn"), ...problems.map((k) => p(t.problems[k], "warn")));
    const stats = document.createElement("p");
    stats.dataset.qid = String(q.id);
    stats.textContent = this.questStatsText(q.id);
    el.append(stats, button(t.delete, () => this.actions.onDelete(q.id), "danger"));
  }
}

// --- Petits constructeurs de champs ---
function statLine(kind: "camp" | "npc", id: number, text: string) {
  const e = document.createElement("p");
  e.dataset[kind] = String(id);
  e.className = "muted";
  e.textContent = text;
  return e;
}
function h(s: string) {
  const e = document.createElement("h3");
  e.textContent = s;
  return e;
}
function h4(s: string) {
  const e = document.createElement("h4");
  e.textContent = s;
  return e;
}
function p(s: string, cls = "") {
  const e = document.createElement("p");
  e.textContent = s;
  e.className = cls;
  return e;
}
function button(label: string, onClick: () => void, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls;
  b.onclick = onClick;
  return b;
}
function field(label: string, input: HTMLElement) {
  const l = document.createElement("label");
  l.append(label, input);
  return l;
}
function number(label: string, value: number, min: number, max: number, onChange: (v: number) => void) {
  const i = document.createElement("input");
  Object.assign(i, { type: "number", min: String(min), max: String(max), value: String(value) });
  i.onchange = () => {
    const v = Math.min(max, Math.max(min, Math.round(Number(i.value) || min)));
    i.value = String(v);
    onChange(v);
  };
  return field(label, i);
}
function text(label: string, value: string, onChange: (v: string) => void) {
  const i = document.createElement("input");
  i.value = value;
  i.oninput = () => onChange(i.value);
  return field(label, i);
}
function select(label: string, options: [string, string][], value: string, onChange: (v: string) => void) {
  const s = document.createElement("select");
  for (const [v, name] of options) s.add(new Option(name, v, false, v === value));
  s.onchange = () => onChange(s.value);
  return field(label, s);
}
