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

db.run(`
  CREATE TABLE IF NOT EXISTS playback_sessions (
    id TEXT PRIMARY KEY,
    last_event TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Sanitize conversation history to prevent prototype pollution and injection attacks
 */
function sanitizeConversationHistory(history: CoreMessage[]): CoreMessage[] {
  return history.map(msg => {
    if (msg.role === 'user') {
      // Sanitize user messages to prevent injection
      if (typeof msg.content === 'string') {
        // Remove potential prototype pollution patterns
        const sanitized = msg.content
          .replace(/__proto__/g, '___proto___')
          .replace(/constructor/g, 'constructor_')
          .replace(/prototype/g, 'prototype_');

        return { ...msg, content: sanitized };
      }
    } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      // Sanitize assistant tool calls and results
      const sanitizedContent = msg.content.map(part => {
        if (part.type === 'tool-call') {
          return {
            ...part,
            args: sanitizeToolArgs(part.args as Record<string, any>)
          };
        } else if (part.type === 'text') {
          return part;
        } else {
          // Handle any other content types
          return part;
        }
      });
      return { ...msg, content: sanitizedContent };
    } else if (msg.role === 'tool' && Array.isArray(msg.content)) {
      // Sanitize tool messages
      const sanitizedContent = msg.content.map(part => {
        if (part.type === 'tool-result') {
          return {
            ...part,
            result: sanitizeToolResult(part.result as any)
          };
        } else if (part.type === 'text') {
          return part;
        } else {
          // Handle any other content types
          return part;
        }
      });
      return { ...msg, content: sanitizedContent };
    }
    return msg;
  });
}

/**
 * Sanitize tool arguments to prevent injection
 */
function sanitizeToolArgs(args: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    // Skip dangerous prototype properties
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    if (typeof value === 'string') {
      sanitized[key] = value
        .replace(/__proto__/g, '___proto___')
        .replace(/constructor/g, 'constructor_')
        .replace(/prototype/g, 'prototype_');
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeToolArgs(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Sanitize tool results to prevent injection
 */
function sanitizeToolResult(result: any): any {
  if (typeof result !== 'object' || result === null) {
    return result;
  }

  // For tool results, we'll just remove dangerous properties
  // and keep the rest intact since they come from our own services
  const sanitized = Array.isArray(result) ? [...result] : { ...result };
  if (typeof sanitized === 'object' && sanitized !== null) {
    delete (sanitized as any)['__proto__'];
    delete (sanitized as any)['constructor'];
    delete (sanitized as any)['prototype'];
  }

  return sanitized;
}

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
  // Sanitize history before saving to prevent injection attacks
  const sanitizedHistory = sanitizeConversationHistory(history);
  db.run(
    "INSERT OR REPLACE INTO conversations (user_id, history) VALUES (?, ?)",
    [userId, JSON.stringify(sanitizedHistory)]
  );
}

export function getMetadata(key: string): string | null {
  const row = db.query("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | null;
  return row ? row.value : null;
}

export function setMetadata(key: string, value: string) {
  db.run("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", [key, value]);
}

export function areNotificationsEnabled(): boolean {
  const value = getMetadata("notifications_enabled");
  return value !== "false"; // Default to true if not set
}

export function setNotificationsEnabled(enabled: boolean) {
  setMetadata("notifications_enabled", String(enabled));
}

export function getPlaybackState(sessionId: string): string | null {
  const row = db.query("SELECT last_event FROM playback_sessions WHERE id = ?").get(sessionId) as { last_event: string } | null;
  return row ? row.last_event : null;
}

export function updatePlaybackState(sessionId: string, event: string) {
  db.run(
    "INSERT OR REPLACE INTO playback_sessions (id, last_event, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
    [sessionId, event]
  );
}

export function getAllConversations(): { userId: number, history: CoreMessage[] }[] {
  const rows = db.query("SELECT user_id, history FROM conversations").all() as { user_id: number, history: string }[];
  return rows.map(r => ({
    userId: r.user_id,
    history: JSON.parse(r.history)
  }));
}
