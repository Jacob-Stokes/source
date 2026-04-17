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

      -- One row per user message → agent run. Durable metrics for debugging
      -- "why did that take N turns?" questions even after the container is rebuilt.
      CREATE TABLE IF NOT EXISTS queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        user_msg TEXT NOT NULL,
        num_turns INTEGER,
        stop_reason TEXT,
        cost_usd REAL,
        duration_ms INTEGER,
        tokens_in INTEGER,
        tokens_out INTEGER,
        cache_read INTEGER,
        cache_create INTEGER,
        final_text TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_queries_chat ON queries(chat_id, id DESC);

      -- One row per tool use inside a query. Truncated input/output to avoid blowing the DB.
      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        idx INTEGER NOT NULL,        -- 1-based order within the query
        tool TEXT NOT NULL,
        input TEXT,                  -- JSON snippet, truncated
        result_preview TEXT,         -- first N chars of tool result
        is_error INTEGER,            -- 1 if the tool result was an error
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (query_id) REFERENCES queries(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tool_calls_query ON tool_calls(query_id, idx);
    `);
  }

  // Start a query row, return its id so tool_calls can reference it.
  startQuery(chatId: number, userMsg: string): number {
    const info = this.db
      .prepare("INSERT INTO queries (chat_id, user_msg) VALUES (?, ?)")
      .run(chatId, userMsg);
    return Number(info.lastInsertRowid);
  }

  finishQuery(
    queryId: number,
    fields: {
      num_turns?: number;
      stop_reason?: string;
      cost_usd?: number;
      duration_ms?: number;
      tokens_in?: number;
      tokens_out?: number;
      cache_read?: number;
      cache_create?: number;
      final_text?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE queries SET
          num_turns = ?,
          stop_reason = ?,
          cost_usd = ?,
          duration_ms = ?,
          tokens_in = ?,
          tokens_out = ?,
          cache_read = ?,
          cache_create = ?,
          final_text = ?
         WHERE id = ?`,
      )
      .run(
        fields.num_turns ?? null,
        fields.stop_reason ?? null,
        fields.cost_usd ?? null,
        fields.duration_ms ?? null,
        fields.tokens_in ?? null,
        fields.tokens_out ?? null,
        fields.cache_read ?? null,
        fields.cache_create ?? null,
        fields.final_text ?? null,
        queryId,
      );
  }

  // Separate from finishQuery so the final_text can be stamped AFTER the result event
  // (which carries the metrics) and the full streamed text is assembled.
  finishQueryFinalText(queryId: number, finalText: string): void {
    this.db.prepare("UPDATE queries SET final_text = ? WHERE id = ?").run(finalText, queryId);
  }

  saveToolCall(
    queryId: number,
    chatId: number,
    idx: number,
    tool: string,
    input: string,
    resultPreview: string,
    isError: boolean,
  ): void {
    this.db
      .prepare(
        "INSERT INTO tool_calls (query_id, chat_id, idx, tool, input, result_preview, is_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(queryId, chatId, idx, tool, input, resultPreview, isError ? 1 : 0);
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
