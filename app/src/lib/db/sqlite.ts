import "server-only";
import type { SqliteDatabase, SqliteStatement } from "kysely";

/**
 * Adapts Node's built-in `node:sqlite` module (Node 22.13+) to the interface
 * Kysely's SqliteDialect expects. Using the built-in module means buyers don't
 * need to compile any native addon.
 */

type NodeSqliteValue = null | number | bigint | string | Uint8Array;

interface NodeStatement {
  all(...params: NodeSqliteValue[]): unknown[];
  run(...params: NodeSqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate(...params: NodeSqliteValue[]): IterableIterator<unknown>;
  columns(): unknown[];
}

interface NodeDatabase {
  prepare(sql: string): NodeStatement;
  exec(sql: string): void;
  close(): void;
}

function normalize(params: ReadonlyArray<unknown>): NodeSqliteValue[] {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    return value as NodeSqliteValue;
  });
}

export function openSqlite(file: string): SqliteDatabase {
  // getBuiltinModule loads the builtin at runtime, out of the bundler's reach.
  const sqlite = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync: new (file: string) => NodeDatabase } | undefined;
  if (!sqlite) throw new Error("node:sqlite is not available in this Node.js version.");
  const { DatabaseSync } = sqlite;
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  return {
    close: () => db.close(),
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        reader: stmt.columns().length > 0,
        all: (params) => stmt.all(...normalize(params)),
        run: (params) => stmt.run(...normalize(params)),
        iterate: (params) => stmt.iterate(...normalize(params)),
      };
    },
  };
}
