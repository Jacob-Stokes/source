// Multi-key API auth store, SHA-256 hashed.
// Same pattern as obsidian-landing: keys.json holds {id, name, hash, createdAt, lastUsed}.
// Plaintext key is shown ONCE at creation.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface ApiKey {
  id: string;
  name: string;
  hash: string;       // sha256(plaintext)
  createdAt: string;
  lastUsed?: string;
}

const KEYS_FILE = process.env.KEYS_FILE || "/data/keys.json";

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function ensureDir() {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
}

export function readKeys(): ApiKey[] {
  ensureDir();
  if (!fs.existsSync(KEYS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeKeys(keys: ApiKey[]): void {
  ensureDir();
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), "utf-8");
}

export function listKeys(): Array<Omit<ApiKey, "hash">> {
  return readKeys().map(({ hash, ...rest }) => rest);
}

export function createKey(name: string): { id: string; name: string; key: string } {
  // 32 random bytes → 64-char hex; prefix with "ck_" for human recognition
  const plaintext = "ck_" + crypto.randomBytes(32).toString("hex");
  const id = crypto.randomBytes(6).toString("hex");
  const record: ApiKey = {
    id,
    name: name.slice(0, 80) || "(unnamed)",
    hash: sha256(plaintext),
    createdAt: new Date().toISOString(),
  };
  const keys = readKeys();
  keys.push(record);
  writeKeys(keys);
  return { id, name: record.name, key: plaintext };
}

export function revokeKey(id: string): boolean {
  const keys = readKeys();
  const next = keys.filter((k) => k.id !== id);
  if (next.length === keys.length) return false;
  writeKeys(next);
  return true;
}

export function validate(presented: string): { ok: boolean; keyId?: string; name?: string } {
  if (!presented) return { ok: false };
  const hash = sha256(presented);
  const keys = readKeys();
  const match = keys.find((k) => k.hash === hash);
  if (!match) return { ok: false };
  match.lastUsed = new Date().toISOString();
  writeKeys(keys);
  return { ok: true, keyId: match.id, name: match.name };
}
