// SQLite-backed rolling conversation store. One row per turn, keyed by chat_id.
// Not designed for long-term memory — it's a rolling window. Old turns get
// dropped implicitly by the getRecentTurns query (LIMIT + order by id desc).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Role = "user" | "assistant";

export interface Turn {
  id: number;
  chat_id: number;
  role: Role;
  content: string;
  created_at: string;
}

export class ChatDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_turns_chat ON turns(chat_id, id DESC);
    `);
  }

  saveTurn(chatId: number, role: Role, content: string): void {
    this.db
      .prepare("INSERT INTO turns (chat_id, role, content) VALUES (?, ?, ?)")
      .run(chatId, role, content);
  }

  // Most recent N turns, oldest-first (ready to pass to the model).
  getRecentTurns(chatId: number, limit: number = 20): Turn[] {
    const rows = this.db
      .prepare(
        "SELECT id, chat_id, role, content, created_at FROM turns WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(chatId, limit) as Turn[];
    return rows.reverse();
  }

  // Hard-reset a chat (e.g. the user says /reset).
  clear(chatId: number): number {
    return this.db.prepare("DELETE FROM turns WHERE chat_id = ?").run(chatId).changes;
  }

  // Light maintenance: keep only the last 200 turns per chat — prevents indefinite growth.
  trim(chatId: number, keep: number = 200): void {
    this.db
      .prepare(
        `DELETE FROM turns WHERE chat_id = ? AND id NOT IN (
           SELECT id FROM turns WHERE chat_id = ? ORDER BY id DESC LIMIT ?
         )`,
      )
      .run(chatId, chatId, keep);
  }
}
