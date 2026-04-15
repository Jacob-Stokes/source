import { Database } from "bun:sqlite";

const db = new Database("/data/keys.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  )
`);

export function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "bk_" + Buffer.from(bytes).toString("hex");
}

export function createKey(name: string): { id: number; name: string; key: string; created_at: string } {
  const key = generateKey();
  const stmt = db.prepare("INSERT INTO api_keys (name, key) VALUES (?, ?) RETURNING id, name, key, created_at");
  return stmt.get(name, key) as any;
}

export function listKeys(): { id: number; name: string; key: string; created_at: string; last_used_at: string | null }[] {
  return db.query("SELECT id, name, key, created_at, last_used_at FROM api_keys ORDER BY created_at DESC").all() as any;
}

export function revokeKey(id: number): boolean {
  const result = db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  return result.changes > 0;
}

export function validateKey(key: string): boolean {
  const row = db.query("SELECT id FROM api_keys WHERE key = ?").get(key);
  if (!row) return false;
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE key = ?").run(key);
  return true;
}
