// Lecture des tables de données du client (fichiers .dbc) : des lignes de champs de 4 octets et un bloc de textes.
export class Dbc {
  readonly rows: number;
  readonly fields: number;
  private recordSize: number;
  private b: Buffer;
  private strings: number;

  constructor(b: Buffer) {
    if (b.toString("latin1", 0, 4) !== "WDBC") throw new Error("fichier DBC invalide");
    this.b = b;
    this.rows = b.readUInt32LE(4);
    this.fields = b.readUInt32LE(8);
    this.recordSize = b.readUInt32LE(12);
    this.strings = 20 + this.rows * this.recordSize;
  }

  int(row: number, field: number) {
    return this.b.readInt32LE(20 + row * this.recordSize + field * 4);
  }

  uint(row: number, field: number) {
    return this.b.readUInt32LE(20 + row * this.recordSize + field * 4);
  }

  float(row: number, field: number) {
    return this.b.readFloatLE(20 + row * this.recordSize + field * 4);
  }

  string(row: number, field: number) {
    const start = this.strings + this.uint(row, field);
    const end = this.b.indexOf(0, start);
    return this.b.toString("utf8", start, end);
  }

  // Texte traduit : 16 emplacements de langue ; le client français remplit le sien, on prend le premier non vide.
  localized(row: number, field: number) {
    for (let k = 0; k < 16; k++) {
      const s = this.string(row, field + k);
      if (s) return s;
    }
    return "";
  }
}
