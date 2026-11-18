import { Application, Container, Graphics } from "pixi.js";
import { lang, setLang, t } from "./i18n";
import { Content, questProblems, type Camp, type Npc, type Path, type Point } from "./game/content";
import { ContentView } from "./game/contentView";
import { screenToTileF, tileDiamond, tileToScreen } from "./game/iso";
import { CREATURES } from "./game/placeholderData";
import { loadMap } from "./game/gameMap";
import { SimView } from "./game/simView";
import { HeatView } from "./game/heatView";
import { Chat } from "./ui/chat";
import type { CareerInfo, FromSim, SimCamp, SimContent, SimItem, SimNpc, SimQuest, SimStats, ToSim, WorldSave } from "./sim/protocol";
import { COSTS, DAY, MONTH_DAYS } from "./sim/career.ts";
import { loadPackData, spellLevels } from "./game/packData";
import { clearAutosave, downloadSave, pickSaveFile, readAutosave, storeAutosave, type GameMode, type GameSave } from "./game/save";
import type { Entity } from "./game/content";
import { LEVEL_PX, TerrainView, canPath, canPlace } from "./game/terrainView";
import { Panel } from "./ui/panel";

type Tool = "select" | "camp" | "npc" | "path";

const app = new Application();
await app.init({ resizeTo: window, background: "#1b1a17", antialias: true });
document.body.appendChild(app.canvas);

const [gameMap, packData] = await Promise.all([loadMap(), loadPackData()]);
const { tiles: map, width: MAP_W, height: MAP_H, start: START } = gameMap;
const terrainAt = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < MAP_W && y < MAP_H ? map[y][x].terrain : undefined;

const world = new Container();
app.stage.addChild(world);
const terrain = new TerrainView(gameMap);
const content = new Content();
const contentView = new ContentView(content);
const hover = new Graphics();
const campCreature = (campId: number) => {
  const camp = content.get(campId);
  return camp?.kind === "camp" ? camp.creature : undefined;
};
const simView = new SimView(
  (campId) => CREATURES.find((c) => c.id === campCreature(campId))?.color ?? 0x888888,
  campCreature,
);
simView.loadModels(); // images des modèles, si le pack de ressources existe
const heatView = new HeatView(MAP_W, MAP_H, (x, y) => canPlace(map[y][x].terrain));
world.addChild(terrain.ground, heatView.g, terrain.labelLayer, hover, contentView.root, simView.creatures, simView.sprites, simView.players);

// --- Simulation : moteur séparé, dans un Web Worker ---
const sim = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });
const send = (m: ToSim) => sim.postMessage(m);
const chat = new Chat(document.getElementById("chat")!, content);

// --- État de l'éditeur ---
let tool: Tool = "select";
let selectedId: number | null = null;
let drawingPath: Path | null = null; // chemin en cours de tracé
let hoverTile: Point | null = null;
let simTick = 0;
let simTime = 0; // secondes de jeu
let started = false;
let mode: GameMode = "sandbox";
let career: CareerInfo | null = null; // dernier état de l'économie (mode carrière)
// Mode carrière : ce que les joueurs voient (dernière mise à jour publiée) ; les ajouts restent en préparation jusque-là.
let published: { nextId: number; entities: Entity[] } = { nextId: 1, entities: [] };
let stats: SimStats | null = null;
let pickPoint: ((p: Point) => void) | null = null; // en attente d'un clic sur la carte (lieu à explorer)

const panel = new Panel(packData, document.getElementById("panel")!, content, {
  onDelete: (id) => remove(id),
  onSelect: (id) => select(id),
  onPick: (done) => {
    pickPoint = done;
    renderHint();
  },
  onFollow: (id) => (panel.following = id),
  onSetLevel: (id, level) => send({ type: "setLevel", id, level }),
  onPrice: (price) => send({ type: "price", price }),
  onServers: (count) => send({ type: "servers", count }),
  onAd: () => send({ type: "ad" }),
});
content.onChange(() => {
  contentView.draw(selectedId);
  scheduleSync();
});

function select(id: number | null) {
  inspectPlayer(null);
  panel.following = null;
  selectedId = id;
  contentView.draw(selectedId);
  panel.show(content.get(id));
}

// Fiche d'un joueur simulé : la simulation l'envoie à chaque tour tant qu'elle est ouverte.
function inspectPlayer(id: number | null) {
  simView.selectedId = id;
  send({ type: "inspect", id });
  if (id === null) return;
  selectedId = null;
  contentView.draw(null);
  panel.showPlayer(id);
}

function remove(id: number) {
  if (drawingPath?.id === id) drawingPath = null;
  content.remove(id);
  if (selectedId === id) select(null);
}

function finishPath() {
  if (drawingPath && drawingPath.points.length < 2) remove(drawingPath.id);
  drawingPath = null;
}

function setTool(next: Tool) {
  finishPath();
  tool = next;
  renderToolbar();
  renderHint();
  drawHover();
}

// --- Caméra ---
function setZoom(s: number) {
  world.scale.set(s);
  terrain.setZoom(s);
}
setZoom(0.9);
const start = tileToScreen(START.x, START.y);
world.position.set(app.screen.width / 2 - start.sx * 0.9, app.screen.height / 2 - start.sy * 0.9);

function tileUnder(cx: number, cy: number): { f: Point; tile: Point } {
  const p = world.toLocal({ x: cx, y: cy });
  const f = screenToTileF(p.x, p.y);
  return { f, tile: { x: Math.floor(f.x), y: Math.floor(f.y) } };
}

// --- Recherche de l'élément sous le curseur (en tuiles) ---
type MapEntity = Camp | Npc | Path; // ce qui est posé sur la carte (les quêtes ne le sont pas)
type Hit = { entity: MapEntity; pointIndex?: number };

function distSeg(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy);
}

function hitTest(f: Point): Hit | null {
  const c = (e: Point) => ({ x: e.x + 0.5, y: e.y + 0.5 });
  const all = [...content.entities.values()].reverse();
  const sel = content.get(selectedId);
  if (sel?.kind === "path") {
    const i = sel.points.findIndex((pt) => Math.hypot(f.x - pt.x - 0.5, f.y - pt.y - 0.5) < 0.6);
    if (i !== -1) return { entity: sel, pointIndex: i };
  }
  for (const e of all) if (e.kind === "npc" && Math.hypot(f.x - c(e).x, f.y - c(e).y) < 0.8) return { entity: e };
  for (const e of all) if (e.kind === "camp" && Math.hypot(f.x - c(e).x, f.y - c(e).y) < 1) return { entity: e };
  for (const e of all) {
    if (e.kind !== "path") continue;
    for (let i = 1; i < e.points.length; i++) if (distSeg(f, c(e.points[i - 1]), c(e.points[i])) < 0.5) return { entity: e };
  }
  return null;
}

// --- Souris ---
const canvas = app.canvas;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

type Drag =
  | { kind: "pan"; x: number; y: number }
  | { kind: "move"; entity: MapEntity; pointIndex?: number; from: Point; original: Point[] };
let drag: Drag | null = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button !== 0) {
    drag = { kind: "pan", x: e.clientX, y: e.clientY };
    return;
  }
  const { f, tile } = tileUnder(e.clientX, e.clientY);
  const ground = terrainAt(tile.x, tile.y);

  if (pickPoint) {
    if (!ground || !canPlace(ground)) return;
    const done = pickPoint;
    pickPoint = null;
    renderHint();
    done(tile);
    return;
  }

  if (tool === "select") {
    const hit = hitTest(f);
    const playerId = hit ? null : simView.playerAt(f);
    if (playerId !== null) {
      inspectPlayer(playerId);
      return;
    }
    if (!hit) {
      select(null);
      drag = { kind: "pan", x: e.clientX, y: e.clientY };
      return;
    }
    select(hit.entity.id);
    const original = hit.entity.kind === "path" ? hit.entity.points.map((p) => ({ ...p })) : [{ x: hit.entity.x, y: hit.entity.y }];
    drag = { kind: "move", entity: hit.entity, pointIndex: hit.pointIndex, from: tile, original };
  } else if (tool === "camp") {
    if (!ground || !canPlace(ground)) return;
    const camp = content.add({ kind: "camp", id: 0, ...tile, creature: "sanglier", minLevel: 1, maxLevel: 2, count: 6, radius: 3, respawn: 60, loot: [] });
    select(camp.id);
  } else if (tool === "npc") {
    if (!ground || !canPlace(ground)) return;
    const npc = content.add({ kind: "npc", id: 0, ...tile, name: `${t.newNpc} ${content.entities.size + 1}`, role: "quest", trainerClass: 1 });
    select(npc.id);
  } else if (tool === "path") {
    if (!ground || !canPath(ground)) return;
    if (!drawingPath) {
      drawingPath = content.add({ kind: "path", id: 0, points: [tile] });
      select(drawingPath.id);
      return;
    }
    const last = drawingPath.points[drawingPath.points.length - 1];
    if (last.x === tile.x && last.y === tile.y) finishPath();
    else {
      drawingPath.points.push(tile);
      content.changed();
      panel.show(drawingPath);
    }
  }
});

canvas.addEventListener("pointermove", (e) => {
  const { tile } = tileUnder(e.clientX, e.clientY);
  if (drag?.kind === "pan") {
    if (panel.following !== null && (e.clientX !== drag.x || e.clientY !== drag.y)) {
      panel.following = null;
      panel.render();
    }
    world.x += e.clientX - drag.x;
    world.y += e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
  } else if (drag?.kind === "move") {
    moveEntity(drag, tile);
  }
  hoverTile = tile;
  drawHover();
  renderHud();
});

canvas.addEventListener("pointerup", () => (drag = null));

// Déplace l'élément tiré, seulement vers des tuiles autorisées.
function moveEntity(d: Extract<Drag, { kind: "move" }>, tile: Point) {
  const dx = tile.x - d.from.x, dy = tile.y - d.from.y;
  const e = d.entity;
  if (e.kind === "path") {
    const indices = d.pointIndex === undefined ? e.points.map((_, i) => i) : [d.pointIndex];
    const moved = indices.map((i) => ({ x: d.original[i].x + dx, y: d.original[i].y + dy }));
    if (moved.some((p) => {
      const g = terrainAt(p.x, p.y);
      return !g || !canPath(g);
    })) return;
    indices.forEach((i, k) => (e.points[i] = moved[k]));
  } else {
    const p = { x: d.original[0].x + dx, y: d.original[0].y + dy };
    const g = terrainAt(p.x, p.y);
    if (!g || !canPlace(g)) return;
    e.x = p.x;
    e.y = p.y;
  }
  content.changed();
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const before = world.toLocal({ x: e.clientX, y: e.clientY });
    setZoom(Math.min(3, Math.max(0.12, world.scale.x * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
    const after = world.toGlobal(before);
    world.x += e.clientX - after.x;
    world.y += e.clientY - after.y;
    renderHud();
  },
  { passive: false },
);

// --- Clavier ---
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (!menuEl.hidden) return;
  if (e.key === "Escape" && pickPoint) {
    pickPoint = null;
    renderHint();
  } else if (e.key === "Enter" || e.key === "Escape") {
    if (drawingPath) finishPath();
    else if (e.key === "Escape") select(null);
  } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== null) remove(selectedId);
  else if (e.key === "1") setTool("select");
  else if (e.key === "2") setTool("camp");
  else if (e.key === "3") setTool("npc");
  else if (e.key === "4") setTool("path");
  else if (e.key === "5") showQuests();
  else if (e.key === "6") showView("items");
  else if (e.key === "7") showView("classes");
  else if (e.key === "8") showView("dungeon");
  else if (e.key === "9" && mode === "career") showView("studio");
});

// --- Survol : tuile éclairée, en rouge si on ne peut pas poser ici ---
function drawHover() {
  hover.clear();
  if (!hoverTile) return;
  const g = terrainAt(hoverTile.x, hoverTile.y);
  if (!g) return;
  const placing = pickPoint || tool === "camp" || tool === "npc";
  const ok = placing ? canPlace(g) : tool === "path" ? canPath(g) : true;
  const lift = map[hoverTile.y][hoverTile.x].height * LEVEL_PX;
  hover
    .poly(tileDiamond(hoverTile.x, hoverTile.y).map((v, i) => (i % 2 ? v - lift : v)))
    .fill({ color: ok ? 0xffe08a : 0xff4030, alpha: 0.45 });
}

// --- Interface HTML ---
const hud = document.getElementById("hud")!;
const toolbar = document.getElementById("toolbar")!;
const hint = document.getElementById("hint")!;

function renderHud() {
  const g = hoverTile && terrainAt(hoverTile.x, hoverTile.y);
  const tile = g ? `${hoverTile!.x}, ${hoverTile!.y} (${t.terrain[g]})` : "—";
  const sim = stats
    ? `${t.players} : ${stats.players} (${t.avgLevel} ${stats.avgLevel.toFixed(1)}, ${t.maxLevel_} ${stats.maxLevel}) · ${t.kills} : ${stats.kills} · ${t.deaths} : ${stats.deaths} · ${t.questsDone} : ${stats.questsDone} · ${t.satisfaction} : ${Math.round(stats.satisfaction)} % · ${t.departures} : ${stats.departures} · `
    : "";
  hud.textContent = `${sim}${t.tile} : ${tile} · ${t.zoom} : ${world.scale.x.toFixed(2)} · ${t.simTick} : ${simTick}`;
  if (timeEl) timeEl.textContent = mode === "career" ? t.date(Math.floor(simTime / DAY), MONTH_DAYS) : `${t.gameTime} : ${formatTime(simTime)}`;
}

function formatTime(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// --- Bandeau du haut : vitesse du temps, joueurs, sauvegarde ---
const topbar = document.getElementById("topbar")!;
const SPEEDS = [0, 1, 2, 5, 10, 20, 50];
let speed = 1;
let targetPlayers = 50;
let timeEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let statusTimer = 0;
let careerEl: HTMLElement | null = null;
let publishBtn: HTMLButtonElement | null = null;

function setSpeed(v: number) {
  speed = v;
  send({ type: "speed", speed: v });
  renderTopbar();
}

function flashStatus(msg: string, error = false) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = error ? "#ff8a60" : "";
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => statusEl && (statusEl.textContent = ""), 4000);
}

function renderTopbar() {
  topbar.replaceChildren();
  const group = (...children: HTMLElement[]) => {
    const g = document.createElement("div");
    g.className = "group";
    g.append(...children);
    return g;
  };
  const btn = (label: string, onClick: () => void, active = false) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = active ? "active" : "";
    b.onclick = onClick;
    return b;
  };
  const sep = () => Object.assign(document.createElement("div"), { className: "sep" });
  const speeds = SPEEDS.map((v) => btn(v === 0 ? `⏸ ${t.pause}` : `×${v}`, () => setSpeed(v), speed === v));
  timeEl = document.createElement("span");
  const count = document.createElement("input");
  Object.assign(count, { type: "number", min: "1", max: "500", value: String(targetPlayers), title: t.playerCount });
  count.onchange = () => {
    targetPlayers = Math.min(500, Math.max(1, Math.round(Number(count.value) || 1)));
    count.value = String(targetPlayers);
    send({ type: "setPlayers", count: targetPlayers });
  };
  const countLabel = document.createElement("label");
  countLabel.append(`${t.playerCount} `, count);
  statusEl = document.createElement("span");
  statusEl.className = "status";
  // Carrière : argent, abonnés, satisfaction et mise à jour à publier ; bac à sable : population réglable à la main.
  careerEl = publishBtn = null;
  let middle: HTMLElement[];
  if (mode === "career") {
    careerEl = document.createElement("span");
    publishBtn = btn("", publishUpdate);
    middle = [careerEl, publishBtn];
  } else middle = [countLabel, btn(t.spawnPlayer, () => send({ type: "spawn" }))];
  topbar.append(
    group(...speeds),
    timeEl,
    sep(),
    ...middle,
    sep(),
    group(
      btn(t.save, async () => {
        const ok = storeAutosave(await requestSave());
        flashStatus(ok ? t.saved : t.saveFailed, !ok);
      }),
      btn(t.exportGame, async () => downloadSave(await requestSave())),
      btn(t.importGame, () => importGame()),
      btn(t.menu, async () => {
        storeAutosave(await requestSave());
        showMenu();
      }),
    ),
    statusEl,
  );
  renderCareerBar();
  renderHud();
}

function renderCareerBar() {
  if (careerEl && career) {
    const c = career.state;
    careerEl.textContent = `${t.money} : ${t.formatMoney(c.money)} · ${t.subscribers} : ${career.subscribers} (+${career.trials.running} ${t.onTrial}) · ${t.satisfaction} : ${Math.round(stats?.satisfaction ?? 0)} %`;
    careerEl.style.color = c.money < 0 ? "#ff8a60" : "";
  }
  if (publishBtn) {
    const u = pendingUpdate();
    publishBtn.textContent = u.changes ? t.publish(u.changes, t.formatMoney(u.cost)) : t.nothingToPublish;
    publishBtn.disabled = !u.changes;
    publishBtn.className = u.changes ? "active" : "";
  }
}

function renderHint() {
  hint.textContent = pickPoint ? t.hintPick : { select: t.hintSelect, camp: t.hintCamp, npc: t.hintNpc, path: t.hintPath }[tool];
}

function renderToolbar() {
  toolbar.replaceChildren();
  const tools: [Tool, string][] = [
    ["select", t.toolSelect],
    ["camp", t.toolCamp],
    ["npc", t.toolNpc],
    ["path", t.toolPath],
  ];
  tools.forEach(([id, label], i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 1}. ${label}`;
    b.className = id === tool ? "active" : "";
    b.onclick = () => setTool(id);
    toolbar.append(b);
  });
  const questsBtn = document.createElement("button");
  questsBtn.textContent = `5. ${t.toolQuests}`;
  questsBtn.onclick = () => showQuests();
  toolbar.append(questsBtn);
  const views: ["items" | "classes" | "dungeon", string][] = [["items", t.toolItems], ["classes", t.toolClasses], ["dungeon", t.toolDungeon]];
  views.forEach(([id, label], i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 6}. ${label}`;
    b.onclick = () => showView(id);
    toolbar.append(b);
  });
  if (mode === "career") {
    const b = document.createElement("button");
    b.textContent = `9. ${t.toolStudio}`;
    b.onclick = () => showView("studio");
    toolbar.append(b);
  }
  const sep = document.createElement("div");
  sep.className = "sep";
  const heatBtn = document.createElement("button");
  heatBtn.textContent = t.layerHeat;
  heatBtn.className = heatView.g.visible ? "active" : "";
  heatBtn.onclick = () => {
    heatView.g.visible = !heatView.g.visible;
    renderToolbar();
  };
  const langBtn = document.createElement("button");
  langBtn.textContent = lang === "fr" ? "English" : "Français";
  langBtn.onclick = toggleLang;
  toolbar.append(sep, heatBtn, langBtn);
}

function toggleLang() {
  setLang(lang === "fr" ? "en" : "fr");
  document.documentElement.lang = lang;
  terrain.updateLabels();
  renderToolbar();
  renderTopbar();
  renderHint();
  renderHud();
  panel.render();
  chat.render();
  if (!menuEl.hidden) showMenu();
}

// Objets, classes et instance ne se posent pas sur la carte : leurs réglages s'ouvrent dans la fiche.
function showView(v: "items" | "classes" | "dungeon" | "studio") {
  setTool("select");
  select(null);
  panel.showView(v);
}

// Les quêtes ne se posent pas sur la carte : ce bouton ouvre leur liste dans la fiche.
function showQuests() {
  setTool("select");
  select(null);
  panel.showQuestList();
}

document.documentElement.lang = lang;
renderToolbar();
renderTopbar();
renderHint();
renderHud();
panel.show(undefined);

// --- Simulation : moteur séparé, dans un Web Worker, qui avance par tours fixes ---
const DEFAULT_PLAYERS = 50;

const walk = new Uint8Array(MAP_W * MAP_H);
for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) walk[y * MAP_W + x] = canPlace(map[y][x].terrain) ? 1 : 0;

// Envoie le contenu posé à la simulation, regroupé (les glisser-déposer produisent beaucoup de changements).
// Un minuteur plutôt que requestAnimationFrame, qui ne se déclenche pas quand l'onglet est en arrière-plan.
let syncPending = false;
function scheduleSync() {
  if (mode === "career") return renderTopbar(); // le bouton de mise à jour compte les changements
  if (syncPending) return;
  syncPending = true;
  setTimeout(() => {
    syncPending = false;
    syncNow();
  }, 50);
}

function syncNow() {
  send({ type: "content", content: simContent() });
}

// Le contenu tel que la simulation le lit.
function simContent(): SimContent {
  const camps: SimCamp[] = [];
  const paths: { points: Point[] }[] = [];
  const npcs: SimNpc[] = [];
  const quests: SimQuest[] = [];
  const items: SimItem[] = [];
  let sc: SimContent["classes"] = [];
  let dungeon: SimContent["dungeon"] = null;
  for (const e of content.entities.values()) {
    if (e.kind === "camp") {
      const { id, x, y, minLevel, maxLevel, count, radius, respawn, loot } = e;
      camps.push({ id, x, y, minLevel, maxLevel, count, radius, respawn, loot });
    } else if (e.kind === "path") paths.push({ points: e.points });
    else if (e.kind === "npc") npcs.push({ id: e.id, x: e.x, y: e.y, trainerClass: e.role === "trainer" ? e.trainerClass : null });
    else if (e.kind === "quest" && !questProblems(e, content).length) {
      const { id, type, prevId, minLevel, campId, count, dropChance, target, xp, gold, rewardItemId } = e;
      quests.push({ id, type, giverId: e.giverId!, enderId: e.enderId!, prevId, minLevel, campId, count, dropChance, target, xp, gold, rewardItemId });
    } else if (e.kind === "item") {
      const { id, slot, level, stat, armor, power, survival } = e;
      items.push({ id, slot, level, stat, armor, power, survival });
    } else if (e.kind === "classes") sc = e.classes;
    else if (e.kind === "dungeon" && GATHER) {
      const { minLevel, maxLevel, difficulty, trash, bosses } = e;
      dungeon = { gather: GATHER, minLevel, maxLevel, difficulty, trash, bosses: bosses.map(({ id, level, health, loot }) => ({ id, level, health, loot })) };
    }
  }
  return { camps, paths, npcs, quests, items, classes: sc, dungeon };
}

// --- Mises à jour (mode carrière) ---
// Ce qui a changé depuis la dernière publication, et ce que ça coûte : chaque ajout a son prix, plus un forfait.
function pendingUpdate() {
  const before = new Map(published.entities.map((e) => [e.id, e]));
  let changes = 0, additions = 0, cost = 0;
  const bossesBefore = new Set(published.entities.flatMap((e) => (e.kind === "dungeon" ? e.bosses.map((b) => b.id) : [])));
  for (const e of content.entities.values()) {
    const old = before.get(e.id);
    before.delete(e.id);
    if (e.kind === "dungeon")
      for (const b of e.bosses)
        if (!bossesBefore.has(b.id)) (additions++, (cost += COSTS.boss));
    if (!old) {
      if (e.kind !== "classes" && e.kind !== "dungeon") (additions++, (cost += COSTS[e.kind]));
      changes++;
    } else if (JSON.stringify(old) !== JSON.stringify(e)) changes++;
  }
  changes += before.size; // éléments supprimés
  return { changes, additions, cost: changes ? cost + COSTS.update : 0 };
}

let publishing = false;
function publishUpdate() {
  const u = pendingUpdate();
  if (!u.changes || publishing) return;
  if (!career || career.state.money < u.cost) return flashStatus(t.notEnoughMoney, true);
  publishing = true;
  const snapshot = content.serialize();
  publishWaiter = (ok) => {
    publishing = false;
    if (ok) published = snapshot;
    flashStatus(ok ? t.updatePublished : t.notEnoughMoney, !ok);
    renderTopbar();
  };
  send({ type: "publish", content: simContent(), cost: u.cost, additions: u.additions });
}
let publishWaiter: ((ok: boolean) => void) | null = null;

// Point de rassemblement devant le Gouffre de Ragefeu : la tuile praticable la plus proche de l'entrée.
const GATHER = (() => {
  let gx = 0, gy = 0, n = 0;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (map[y][x].terrain === "gouffre") (gx += x), (gy += y), n++;
  if (!n) return null;
  gx /= n;
  gy /= n;
  let best: Point | null = null, bestD = Infinity;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const d = Math.hypot(x - gx, y - gy);
      if (walk[y * MAP_W + x] && d < bestD) (best = { x, y }), (bestD = d);
    }
  return best;
})();

// --- Sauvegarde ---
// La simulation renvoie son état sur demande ; on y ajoute le contenu posé, la vitesse et la caméra.
let saveWaiters: ((s: WorldSave) => void)[] = [];
let lastSave: GameSave | null = null; // dernier état connu, réécrit tel quel à la fermeture de la page

function requestSave(): Promise<GameSave> {
  return new Promise((resolve) => {
    saveWaiters.push((sim) => {
      lastSave = {
        app: "mmozeroth",
        version: 1,
        mode,
        published: mode === "career" ? structuredClone(published) : undefined,
        savedAt: new Date().toISOString(),
        content: content.serialize(),
        map: gameMap.id,
        sim,
        settings: { speed },
        camera: { x: world.x, y: world.y, zoom: world.scale.x },
      };
      resolve(lastSave);
    });
    send({ type: "save" });
  });
}

// Sauvegarde automatique toutes les 30 secondes, et quand l'onglet passe en arrière-plan.
setInterval(async () => {
  if (started && menuEl.hidden) storeAutosave(await requestSave());
}, 30_000);
document.addEventListener("visibilitychange", async () => {
  if (started && menuEl.hidden && document.visibilityState === "hidden") storeAutosave(await requestSave());
});
// À la fermeture, la simulation n'a plus le temps de répondre : on garde son dernier état connu,
// mais avec le contenu posé à jour.
window.addEventListener("beforeunload", () => {
  if (started && menuEl.hidden && lastSave) storeAutosave({ ...lastSave, savedAt: new Date().toISOString(), content: content.serialize(), settings: { speed } });
});

// Démarre une partie : vide, ou à partir d'une sauvegarde.
function startGame(save: GameSave | null, newMode: GameMode = "sandbox") {
  // Les positions d'une partie n'ont de sens que sur la carte où elle a été faite.
  if (save && (save.map ?? "placeholder") !== gameMap.id) {
    showMenu(t.wrongMap);
    return;
  }
  finishPath();
  select(null);
  setTool("select");
  chat.clear();
  stats = null;
  mode = save?.mode ?? newMode;
  career = null;
  panel.career = mode === "career";
  content.load(save?.content ?? { nextId: 1, entities: [] });
  published = structuredClone(save?.published ?? { nextId: 1, entities: [] });
  // En carrière, les joueurs arrivent d'eux-mêmes : pas de population de départ.
  targetPlayers = mode === "career" ? 0 : (save?.sim.targetPlayers ?? DEFAULT_PLAYERS);
  send({ type: "init", width: MAP_W, height: MAP_H, walk, spawn: START, players: targetPlayers, spellLevels: spellLevels(packData) });
  // Le contenu doit arriver avant l'état : la simulation retire les quêtes inconnues.
  // En carrière, la simulation reçoit la dernière mise à jour publiée, pas les ajouts en préparation.
  if (mode === "career") {
    const working = content.serialize();
    content.load(published);
    syncNow();
    content.load(working);
    if (!save) send({ type: "startCareer" });
  } else syncNow();
  if (save) {
    send({ type: "load", state: save.sim });
    setZoom(save.camera.zoom);
    world.position.set(save.camera.x, save.camera.y);
  } else {
    setZoom(0.9);
    world.position.set(app.screen.width / 2 - start.sx * 0.9, app.screen.height / 2 - start.sy * 0.9);
  }
  speed = save?.settings.speed ?? 1;
  send({ type: "speed", speed });
  started = true;
  renderToolbar();
  lastSave = null;
  menuEl.hidden = true;
  renderTopbar();
  requestSave().then(storeAutosave);
}

async function importGame() {
  try {
    const save = await pickSaveFile();
    if (save) startGame(save);
  } catch {
    if (menuEl.hidden) flashStatus(t.importFailed, true);
    else showMenu(t.importFailed);
  }
}

// --- Menu de départ ---
const menuEl = document.getElementById("menu")!;

function showMenu(error?: string) {
  const card = menuEl.querySelector(".card")!;
  card.replaceChildren();
  const entry = (label: string, desc: string, onClick: (() => void) | null) => {
    const b = document.createElement("button");
    b.append(label);
    if (desc) b.append(Object.assign(document.createElement("small"), { textContent: desc }));
    if (onClick) b.onclick = onClick;
    else b.disabled = true;
    return b;
  };
  const auto = readAutosave();
  card.append(
    Object.assign(document.createElement("h1"), { textContent: t.menuTitle }),
    Object.assign(document.createElement("p"), { className: "sub", textContent: t.menuSubtitle }),
  );
  if (auto) {
    const date = new Date(auto.savedAt).toLocaleString(lang);
    card.append(entry(t.continueGame(date), "", () => startGame(readAutosave())));
  }
  card.append(
    entry(t.newSandbox, t.newSandboxDesc, () => {
      if (!auto || confirm(t.confirmNew)) startGame(null);
    }),
    entry(t.newCareer, t.newCareerDesc, () => {
      if (!auto || confirm(t.confirmNew)) startGame(null, "career");
    }),
    entry(t.importFromFile, "", () => importGame()),
  );
  card.append(entry(lang === "fr" ? "English" : "Français", "", toggleLang));
  if (error) card.append(Object.assign(document.createElement("p"), { className: "error", textContent: error }));
  menuEl.hidden = false;
  if (started) setSpeed(0); // le jeu attend derrière le menu
}

sim.onmessage = (e: MessageEvent<FromSim>) => {
  const m = e.data;
  if (m.type === "saved") {
    saveWaiters.shift()?.(m.state);
    return;
  }
  if (m.type === "published") {
    publishWaiter?.(m.ok);
    publishWaiter = null;
    return;
  }
  if (m.type === "adBought") {
    flashStatus(m.ok ? t.adBought : t.notEnoughMoney, !m.ok);
    return;
  }
  if (m.type === "spawned") {
    targetPlayers = Math.max(targetPlayers, (stats?.players ?? 0) + 1);
    renderTopbar();
    inspectPlayer(m.id);
    return;
  }
  simTick = m.tick;
  simTime = m.time;
  stats = m.stats;
  career = m.career ?? null;
  panel.updateStats(stats, m.inspected, career);
  chat.add(m.chat);
  if (career) {
    for (const ev of career.events) {
      chat.system(t.careerEvent(ev));
      if (ev.kind === "won") flashStatus(t.careerEvent(ev));
      if (ev.kind === "bankrupt") {
        // La partie est finie : plus de sauvegarde automatique, retour au menu.
        started = false;
        clearAutosave();
        showMenu(t.bankruptMenu);
      }
    }
    renderCareerBar();
  }
  if (m.heat) heatView.update(m.heat);
  simView.push(m);
  renderHud();
};

app.ticker.add(() => {
  simView.draw();
  // Caméra qui suit le joueur choisi
  if (panel.following !== null) {
    const pos = simView.positionOf(panel.following);
    if (!pos) return;
    const { sx, sy } = tileToScreen(pos.x, pos.y);
    world.position.set(app.screen.width / 2 - sx * world.scale.x, app.screen.height / 2 - sy * world.scale.x);
  }
});

showMenu();
