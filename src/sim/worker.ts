// Moteur de simulation : tourne en arrière-plan, sans rien afficher.
// Il avance par tours fixes (un dixième de seconde de jeu chacun) et envoie l'état du monde à l'affichage.
import type { FromSim, Snapshot, ToSim } from "./protocol";
import { World } from "./world.ts";
import { Career, newCareer } from "./career.ts";

const TICK_MS = 100;

let world: World | null = null;
let career: Career | null = null; // mode carrière seulement
let speed = 1; // tours par intervalle de 100 ms : 0 = pause, 1 = temps normal, 10 = dix fois plus vite

const reply = (m: FromSim, transfer: Transferable[] = []) => postMessage(m, { transfer });

self.onmessage = (e: MessageEvent<ToSim>) => {
  const m = e.data;
  if (m.type === "init") {
    world = new World(m.width, m.height, m.walk, m.spawn, m.players, m.spellLevels);
    career = null;
  }
  if (!world) return;
  if (m.type === "content") world.setContent(m.content);
  else if (m.type === "inspect") world.inspectId = m.id;
  else if (m.type === "load") {
    world.load(m.state);
    if (m.state.career) career = new Career(m.state.career, world);
  } else if (m.type === "save") reply({ type: "saved", state: { ...world.save(), career: career ? structuredClone(career.s) : undefined } });
  else if (m.type === "startCareer") career = new Career(newCareer(), world);
  else if (m.type === "price") career?.setPrice(m.price);
  else if (m.type === "servers") career?.setServers(m.count);
  else if (m.type === "ad") reply({ type: "adBought", ok: !!career?.buyAd() });
  else if (m.type === "publish") {
    // Le contenu n'arrive aux joueurs que si la mise à jour est payée
    const ok = !!career?.publish(m.cost, m.additions);
    if (ok) world.setContent(m.content);
    reply({ type: "published", ok });
  }
  else if (m.type === "speed") speed = m.speed;
  else if (m.type === "setPlayers") world.setTargetPlayers(m.count);
  else if (m.type === "spawn") reply({ type: "spawned", id: world.spawnNow() });
  else if (m.type === "setLevel") world.setLevel(m.id, m.level);
};

setInterval(() => {
  if (!world) return;
  // Après une faillite, le monde s'arrête.
  for (let i = 0; i < speed && career?.s.status !== "bankrupt"; i++) {
    world.step(TICK_MS / 1000);
    career?.step(TICK_MS / 1000);
  }
  // Même en pause, on envoie l'état : la fiche d'un joueur reste à jour (niveau forcé, etc.).
  const s = world.snapshot();
  const msg: Snapshot = { type: "snapshot", tick: world.tick, ...s };
  if (career) {
    msg.career = {
      state: career.s,
      subscribers: world.subscriberCount,
      trials: world.trials,
      capacity: career.capacity,
      arrivalsPerDay: career.arrivalsPerDay(),
      events: career.events,
    };
    career.events = [];
  }
  const transfer: ArrayBuffer[] = [s.players.buffer, s.creatures.buffer];
  if (s.heat) transfer.push(s.heat.buffer);
  reply(msg, transfer);
}, TICK_MS);
