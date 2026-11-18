// Canal général : messages des joueurs simulés, écrits dans la langue choisie.
import { lang, t } from "../i18n";
import type { Content } from "../game/content";
import { CREATURES } from "../game/placeholderData";
import type { ChatMessage } from "../sim/protocol";

const MAX = 80;
const BAD = new Set(["idle", "walk", "crowd", "death", "slow", "trainer", "weak", "useless", "group", "wipe", "lag", "price"]);

export class Chat {
  private messages: ChatMessage[] = [];
  private list: HTMLElement;

  constructor(
    private el: HTMLElement,
    private content: Content,
  ) {
    this.list = document.createElement("div");
    this.list.className = "chat-list";
    this.render();
  }

  clear() {
    this.messages = [];
    this.render();
  }

  add(msgs: ChatMessage[]) {
    if (!msgs.length) return;
    this.messages.push(...msgs);
    if (this.messages.length > MAX) this.messages.splice(0, this.messages.length - MAX);
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 4;
    for (const m of msgs) this.list.append(this.line(m));
    while (this.list.children.length > MAX) this.list.firstElementChild!.remove();
    if (atBottom) this.list.scrollTop = this.list.scrollHeight; // ne pas gêner si on relit plus haut
  }

  // Annonce du studio (mode carrière), affichée telle quelle.
  system(text: string) {
    const div = document.createElement("div");
    div.className = "chat-system";
    div.textContent = `★ ${text}`;
    this.list.append(div);
    while (this.list.children.length > MAX) this.list.firstElementChild!.remove();
    this.list.scrollTop = this.list.scrollHeight;
  }

  render() {
    const title = document.createElement("div");
    title.className = "chat-title";
    title.textContent = t.chatTitle;
    this.list.replaceChildren(...this.messages.map((m) => this.line(m)));
    this.el.replaceChildren(title, this.list);
    this.list.scrollTop = this.list.scrollHeight;
  }

  private line(m: ChatMessage): HTMLElement {
    const variants = t.chat[m.key];
    const camp = this.content.get(m.campId ?? null);
    const quest = this.content.get(m.questId ?? null);
    const item = this.content.get(m.itemId ?? null);
    const creature = camp?.kind === "camp" ? CREATURES.find((c) => c.id === camp.creature)?.name[lang].toLowerCase() : undefined;
    const text = variants[m.variant % variants.length]
      .replace("{level}", String(m.level))
      .replace("{camp}", creature ?? "?")
      .replace("{quest}", quest?.kind === "quest" ? quest.name : "?")
      .replace("{item}", item?.kind === "item" ? item.name : "?")
      .replace("{reason}", m.reason ? t.reasons[m.reason] : "?");
    const div = document.createElement("div");
    const name = document.createElement("b");
    const system = m.key === "left" || m.key === "trialLeft";
    name.textContent = system ? m.from : `[${m.from}] `;
    if (system) {
      div.className = "chat-system";
      div.append(name, ` ${text}`);
    } else {
      div.className = BAD.has(m.key) ? "chat-bad" : "chat-good";
      div.append(name, text);
    }
    return div;
  }
}
