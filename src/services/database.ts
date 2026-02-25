import { Database } from "bun:sqlite";
import type { CoreMessage } from "ai";

const db = new Database("bot_data.sqlite", { create: true });

// Initialize database
db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    user_id INTEGER PRIMARY KEY,
    history TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    name TEXT
  )
`);

export function getUserName(userId: number): string | null {
  const row = db.query("SELECT name FROM users WHERE user_id = ?").get(userId) as { name: string } | null;
  return row ? row.name : null;
}

export function setUserName(userId: number, name: string) {
  db.run("INSERT OR REPLACE INTO users (user_id, name) VALUES (?, ?)", [userId, name]);
}

export function getHistory(userId: number): CoreMessage[] {
  const row = db.query("SELECT history FROM conversations WHERE user_id = ?").get(userId) as { history: string } | null;
  if (row) {
    return JSON.parse(row.history);
  }
  return [];
}

export function saveHistory(userId: number, history: CoreMessage[]) {
  db.run(
    "INSERT OR REPLACE INTO conversations (user_id, history) VALUES (?, ?)",
    [userId, JSON.stringify(history)]
  );
}

export function getMetadata(key: string): string | null {
  const row = db.query("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | null;
  return row ? row.value : null;
}

export function setMetadata(key: string, value: string) {
  db.run("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", [key, value]);
}

export function getAllConversations(): { userId: number, history: CoreMessage[] }[] {
  const rows = db.query("SELECT user_id, history FROM conversations").all() as { user_id: number, history: string }[];
  return rows.map(r => ({
    userId: r.user_id,
    history: JSON.parse(r.history)
  }));
}
