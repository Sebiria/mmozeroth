// Lecture des fichiers SQL d'AzerothCore (data/sql/base/db_world/*.sql) sans MySQL.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Row = Record<string, string | number | null>;

// Lit une table : les colonnes viennent du CREATE TABLE, les lignes des INSERT INTO ... VALUES.
export function readTable(dir: string, table: string): Row[] {
  const sql = readFileSync(join(dir, `${table}.sql`), "utf8");
  const create = sql.slice(sql.indexOf("CREATE TABLE"), sql.indexOf("ENGINE", sql.indexOf("CREATE TABLE")));
  const columns = [...create.matchAll(/^\s+`([A-Za-z0-9_]+)`/gm)].map((m) => m[1]);
  if (!columns.length) throw new Error(`Colonnes introuvables pour ${table}`);

  const rows: Row[] = [];
  const marker = `INSERT INTO \`${table}\` VALUES`;
  let pos = sql.indexOf(marker);
  while (pos !== -1) {
    pos = parseValues(sql, pos + marker.length, columns, rows);
    pos = sql.indexOf(marker, pos);
  }
  return rows;
}

// Analyse une suite de tuples (a,'b',NULL),(...) jusqu'au « ; » final. Renvoie la position atteinte.
function parseValues(sql: string, i: number, columns: string[], rows: Row[]): number {
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === ";") return i + 1;
    if (c !== "(") {
      i++;
      continue;
    }
    i++;
    const values: (string | number | null)[] = [];
    while (true) {
      while (sql[i] === " " || sql[i] === "\n" || sql[i] === "\r") i++;
      if (sql[i] === "'") {
        let s = "";
        i++;
        while (sql[i] !== "'" || sql[i + 1] === "'") {
          if (sql[i] === "\\") {
            const e = sql[i + 1];
            s += e === "n" ? "\n" : e === "r" ? "\r" : e === "t" ? "\t" : e === "0" ? "\0" : e;
            i += 2;
          } else if (sql[i] === "'") {
            s += "'";
            i += 2;
          } else s += sql[i++];
        }
        i++;
        values.push(s);
      } else {
        let j = i;
        while (sql[j] !== "," && sql[j] !== ")") j++;
        const raw = sql.slice(i, j).trim();
        values.push(raw === "NULL" ? null : Number(raw));
        i = j;
      }
      if (sql[i] === ",") {
        i++;
        continue;
      }
      i++; // « ) »
      break;
    }
    if (values.length !== columns.length) throw new Error(`Ligne de ${values.length} valeurs pour ${columns.length} colonnes`);
    const row: Row = {};
    columns.forEach((col, k) => (row[col] = values[k]));
    rows.push(row);
  }
  return i;
}
