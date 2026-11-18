// Lecture des archives MPQ du client 3.3.5a (formats 1 et 2, archives de plus de 4 Go comprises).
// Seule la lecture est prise en charge, avec les compressions utilisées par ce client : zlib, bzip2 et PKWARE.
import { closeSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";
import { bunzip2 } from "./bzip2.ts";
import { explode } from "./explode.ts";

const CRYPT = (() => {
  const t = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    for (let j = 0, idx = i; j < 5; j++, idx += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t1 = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      t[idx] = (t1 | (seed & 0xffff)) >>> 0;
    }
  }
  return t;
})();

function hash(name: string, type: number): number {
  let s1 = 0x7fed7fed, s2 = 0xeeeeeeee;
  for (const c of name.toUpperCase().replace(/\//g, "\\")) {
    const ch = c.charCodeAt(0);
    s1 = (CRYPT[type * 0x100 + ch] ^ (s1 + s2)) >>> 0;
    s2 = (ch + s1 + s2 + (s2 << 5) + 3) >>> 0;
  }
  return s1;
}

function decrypt(data: Uint32Array, key: number) {
  let s2 = 0xeeeeeeee;
  for (let i = 0; i < data.length; i++) {
    s2 = (s2 + CRYPT[0x400 + (key & 0xff)]) >>> 0;
    const ch = (data[i] ^ (key + s2)) >>> 0;
    key = (((~key << 0x15) + 0x11111111) | (key >>> 0x0b)) >>> 0;
    s2 = (ch + s2 + (s2 << 5) + 3) >>> 0;
    data[i] = ch;
  }
}

const F_IMPLODE = 0x100, F_COMPRESS = 0x200, F_ENCRYPTED = 0x10000, F_FIX_KEY = 0x20000;
const F_SINGLE = 0x1000000, F_DELETED = 0x2000000, F_CRC = 0x4000000, F_EXISTS = 0x80000000;
const LOCALE_FR = 0x40c;

interface Block {
  offset: number;
  csize: number;
  size: number;
  flags: number;
}

export class MpqArchive {
  readonly name: string;
  private fd: number;
  private base = 0;
  private sectorSize = 4096;
  private hashes: Uint32Array; // 4 nombres par entrée : nomA, nomB, langue|plateforme, bloc
  private blocks: Block[] = [];

  constructor(path: string) {
    this.name = basename(path);
    this.fd = openSync(path, "r");
    // L'en-tête peut être précédé d'autres données : on le cherche tous les 512 octets.
    let h: Buffer;
    for (;;) {
      h = this.read(this.base, 44);
      if (h.readUInt32LE(0) === 0x1a51504d) break;
      this.base += 512;
      if (this.base > 1 << 24) throw new Error(`${path} : en-tête MPQ introuvable`);
    }
    const version = h.readUInt16LE(12);
    this.sectorSize = 512 << h.readUInt16LE(14);
    let hashPos = h.readUInt32LE(16), blockPos = h.readUInt32LE(20);
    const hashCount = h.readUInt32LE(24), blockCount = h.readUInt32LE(28);
    let hiBlockPos = 0;
    if (version >= 1) {
      hiBlockPos = Number(h.readBigUInt64LE(32));
      hashPos += h.readUInt16LE(40) * 2 ** 32;
      blockPos += h.readUInt16LE(42) * 2 ** 32;
    }
    this.hashes = this.table(hashPos, hashCount, hash("(hash table)", 3));
    const bt = this.table(blockPos, blockCount, hash("(block table)", 3));
    const hi = hiBlockPos ? this.read(this.base + hiBlockPos, blockCount * 2) : null;
    for (let i = 0; i < blockCount; i++) {
      this.blocks.push({
        offset: bt[i * 4] + (hi ? hi.readUInt16LE(i * 2) * 2 ** 32 : 0),
        csize: bt[i * 4 + 1],
        size: bt[i * 4 + 2],
        flags: bt[i * 4 + 3],
      });
    }
  }

  private read(pos: number, len: number): Buffer {
    const b = Buffer.alloc(len);
    let done = 0;
    while (done < len) {
      const n = readSync(this.fd, b, done, len - done, pos + done);
      if (!n) break;
      done += n;
    }
    return b;
  }

  private table(pos: number, count: number, key: number): Uint32Array {
    const b = this.read(this.base + pos, count * 16);
    const u = new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    decrypt(u, key);
    return u;
  }

  // Numéro de bloc d'un fichier : version française de préférence, sinon neutre.
  private find(name: string): number {
    const n = this.hashes.length / 4;
    const a = hash(name, 1), b = hash(name, 2);
    let found = -1;
    for (let i = hash(name, 0) & (n - 1), k = 0; k < n; i = (i + 1) & (n - 1), k++) {
      const block = this.hashes[i * 4 + 3];
      if (block === 0xffffffff) break;
      if (this.hashes[i * 4] !== a || this.hashes[i * 4 + 1] !== b || block === 0xfffffffe) continue;
      const locale = this.hashes[i * 4 + 2] & 0xffff;
      if (locale === LOCALE_FR) return block;
      if (locale === 0 || found === -1) found = block;
    }
    return found;
  }

  // « deleted » : un correctif a retiré ce fichier.
  has(name: string): "yes" | "deleted" | "no" {
    const i = this.find(name);
    if (i < 0) return "no";
    const f = this.blocks[i].flags;
    if (f & F_DELETED) return "deleted";
    return f & F_EXISTS ? "yes" : "no";
  }

  readFile(name: string): Buffer | null {
    const i = this.find(name);
    if (i < 0) return null;
    const bl = this.blocks[i];
    if (!(bl.flags & F_EXISTS) || bl.flags & F_DELETED) return null;
    const pos = this.base + bl.offset;
    let key = 0;
    if (bl.flags & F_ENCRYPTED) {
      key = hash(name.split(/[\\/]/).pop()!, 3);
      if (bl.flags & F_FIX_KEY) key = ((key + (bl.offset >>> 0)) ^ bl.size) >>> 0;
    }
    const raw = this.read(pos, bl.csize);
    if (bl.flags & F_SINGLE) {
      if (key) decryptBuf(raw, key);
      return bl.csize < bl.size ? this.decompress(raw, bl.size, bl.flags) : raw;
    }
    if (!(bl.flags & (F_COMPRESS | F_IMPLODE))) {
      if (key) {
        for (let s = 0, k = 0; s < raw.length; s += this.sectorSize, k++) decryptBuf(raw.subarray(s, s + this.sectorSize), key + k);
      }
      return raw.subarray(0, bl.size);
    }
    const sectors = Math.ceil(bl.size / this.sectorSize);
    const tableLen = sectors + 1 + (bl.flags & F_CRC ? 1 : 0);
    const table = new Uint32Array(tableLen);
    for (let k = 0; k < tableLen; k++) table[k] = raw.readUInt32LE(k * 4);
    if (key) decrypt(table, (key - 1) >>> 0);
    const out = Buffer.alloc(bl.size);
    for (let k = 0; k < sectors; k++) {
      const sec = Buffer.from(raw.subarray(table[k], table[k + 1]));
      if (key) decryptBuf(sec, (key + k) >>> 0);
      const want = Math.min(this.sectorSize, bl.size - k * this.sectorSize);
      const data = sec.length < want ? this.decompress(sec, want, bl.flags) : sec;
      data.copy(out, k * this.sectorSize, 0, want);
    }
    return out;
  }

  private decompress(b: Buffer, size: number, flags: number): Buffer {
    if (flags & F_IMPLODE) return explode(b, size);
    const mask = b[0];
    let d: Buffer = b.subarray(1);
    if (mask & 0x10) d = bunzip2(d);
    if (mask & 0x08) d = explode(d, size);
    if (mask & 0x02) d = inflateSync(d);
    if (mask & ~0x1a) throw new Error(`compression non prise en charge : 0x${mask.toString(16)}`);
    return d;
  }

  close() {
    closeSync(this.fd);
  }
}

function decryptBuf(b: Buffer, key: number) {
  const n = b.length >> 2;
  const u = new Uint32Array(n);
  for (let i = 0; i < n; i++) u[i] = b.readUInt32LE(i * 4);
  decrypt(u, key);
  for (let i = 0; i < n; i++) b.writeUInt32LE(u[i], i * 4);
}

// Toutes les archives du client, dans l'ordre où le jeu les charge : les dernières remplacent les premières.
export class MpqStack {
  private archives: MpqArchive[] = [];

  constructor(clientDir: string, locale = "frFR") {
    const data = join(clientDir, "Data");
    const loc = join(data, locale);
    const files = (dir: string) => readdirSync(dir).filter((f) => /\.mpq$/i.test(f));
    const base = ["common.MPQ", "common-2.MPQ", "expansion.MPQ", "lichking.MPQ"];
    const locBase = [`locale-${locale}.MPQ`, `expansion-locale-${locale}.MPQ`, `lichking-locale-${locale}.MPQ`];
    const order: string[] = [];
    const lower = (dir: string) => new Map(files(dir).map((f) => [f.toLowerCase(), join(dir, f)]));
    const inData = lower(data), inLoc = lower(loc);
    for (const f of base) if (inData.has(f.toLowerCase())) order.push(inData.get(f.toLowerCase())!);
    for (const f of locBase) if (inLoc.has(f.toLowerCase())) order.push(inLoc.get(f.toLowerCase())!);
    // Correctifs : patch.MPQ, patch-frFR.MPQ, patch-2.MPQ, patch-frFR-2.MPQ, etc.
    const patchNum = (f: string) => {
      const m = /-(\d+)\.mpq$/i.exec(f);
      return m ? Number(m[1]) : 1;
    };
    const patches = [
      ...[...inData.entries()].filter(([f]) => f.startsWith("patch")).map(([f, p]) => ({ n: patchNum(f), loc: 0, p })),
      ...[...inLoc.entries()].filter(([f]) => f.startsWith(`patch-${locale.toLowerCase()}`)).map(([f, p]) => ({ n: patchNum(f), loc: 1, p })),
    ].sort((a, b) => a.n - b.n || a.loc - b.loc);
    for (const x of patches) order.push(x.p);
    this.archives = order.map((p) => new MpqArchive(p));
  }

  get names() {
    return this.archives.map((a) => a.name);
  }

  readFile(name: string): Buffer | null {
    for (let i = this.archives.length - 1; i >= 0; i--) {
      const a = this.archives[i];
      const state = a.has(name);
      if (state === "deleted") return null;
      if (state === "yes") return a.readFile(name);
    }
    return null;
  }

  close() {
    for (const a of this.archives) a.close();
  }
}
