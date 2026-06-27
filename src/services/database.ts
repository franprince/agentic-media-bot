import { Database } from "bun:sqlite";
import type { CoreMessage } from "ai";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = "data";
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(join(DATA_DIR, "bot_data.sqlite"), { create: true });

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

db.run(`
  CREATE TABLE IF NOT EXISTS media_events (
    id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS alert_config (
    service TEXT NOT NULL,
    event_type TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    PRIMARY KEY (service, event_type)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS pending_notifications (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    media_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Sanitize conversation history to prevent prototype pollution and injection attacks
 */
function sanitizeConversationHistory(history: CoreMessage[]): CoreMessage[] {
  const sanitized: CoreMessage[] = [];
  
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    let sanitizedMsg = { ...msg };
    
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        sanitizedMsg.content = msg.content
          .replace(/__proto__/g, '___proto___')
          .replace(/constructor/g, 'constructor_')
          .replace(/prototype/g, 'prototype_');
      }
    } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      sanitizedMsg.content = msg.content.map(part => {
        if (part.type === 'tool-call') {
          return {
            ...part,
            args: sanitizeToolArgs(part.args as Record<string, any>)
          };
        }
        return part;
      }) as any;
    } else if (msg.role === 'tool' && Array.isArray(msg.content)) {
      sanitizedMsg.content = msg.content.map(part => {
        if (part.type === 'tool-result') {
          let result = sanitizeToolResult(part.result as any);
          if (Array.isArray(result) || typeof result !== 'object' || result === null) {
            result = { result };
          }
          return {
            ...part,
            result
          };
        }
        return part;
      }) as any;
    }
    
    sanitized.push(sanitizedMsg);
    
    // If a tool message is followed by a user message, insert a dummy assistant message
    // to preserve Gemini's strict alternating turn structure (User -> Model -> User -> Model).
    if (msg.role === 'tool') {
      const nextMsg = history[i + 1];
      if (nextMsg && nextMsg.role === 'user') {
        sanitized.push({
          role: 'assistant',
          content: 'I have processed the tool results.'
        });
      }
    }
  }
  
  return sanitized;
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
    try {
      const parsed = JSON.parse(row.history);
      return sanitizeConversationHistory(parsed);
    } catch (e) {
      console.error("Failed to parse history", e);
      return [];
    }
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

/**
 * Trim history to keep only the most recent messages.
 * This helps prevent the context from becoming too "sticky" or confusing the AI.
 */
export function trimHistory(userId: number, maxMessages: number = 20): CoreMessage[] {
  const history = getHistory(userId);
  if (history.length <= maxMessages) return history;

  const trimmed = history.slice(-maxMessages);
  saveHistory(userId, trimmed);
  return trimmed;
}

/**
 * Clear the conversation history for a user.
 */
export function clearHistory(userId: number): void {
  db.run("DELETE FROM conversations WHERE user_id = ?", [userId]);
}

export function getMetadata(key: string): string | null {
  const row = db.query("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | null;
  return row ? row.value : null;
}

export function setMetadata(key: string, value: string) {
  db.run("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", [key, value]);
}

export function deleteMetadata(key: string) {
  db.run("DELETE FROM metadata WHERE key = ?", [key]);
}

export function areNotificationsEnabled(): boolean {
  const value = getMetadata("notifications_enabled");
  return value !== "false"; // Default to true if not set
}

export function setNotificationsEnabled(enabled: boolean) {
  setMetadata("notifications_enabled", String(enabled));
}

export function getRawTimezone(): string {
  return getMetadata("timezone") || "UTC";
}

export function getTimezone(): string {
  const tz = getRawTimezone();

  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch (e) {
    // Only warn if it's actually invalid and not default
    if (tz !== "UTC") {
      console.warn(`Invalid timezone set in database: "${tz}". Internal features will fall back to UTC.`);
    }
    return "UTC";
  }
}

export function setTimezone(tz: string) {
  setMetadata("timezone", tz);
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

export interface MediaEvent {
  id: string;
  service: string;
  event_type: string;
  title: string;
  message: string;
  timestamp: string;
}

export function saveMediaEvent(service: string, eventType: string, title: string, message: string) {
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO media_events (id, service, event_type, title, message, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now') || 'Z')",
    [id, service, eventType, title, message]
  );
}

export function getRecentMediaEvents(service: string, limit: number = 10, sinceDate?: Date): MediaEvent[] {
  if (sinceDate) {
    const timeStr = sinceDate.toISOString().replace("T", " ").substring(0, 19);
    return db.query("SELECT * FROM media_events WHERE service = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?").all(service, timeStr, limit) as MediaEvent[];
  }
  return db.query("SELECT * FROM media_events WHERE service = ? ORDER BY timestamp DESC LIMIT ?").all(service, limit) as MediaEvent[];
}

export function getEventAlertConfig(service: string, eventType: string): boolean {
  const row = db.query("SELECT enabled FROM alert_config WHERE service = ? AND event_type = ?").get(service, eventType) as { enabled: number } | null;
  if (row) {
    return row.enabled === 1;
  }
  return true; // Default to true if not set
}

export function setEventAlertConfig(service: string, eventType: string, enabled: boolean) {
  db.run(
    "INSERT OR REPLACE INTO alert_config (service, event_type, enabled) VALUES (?, ?, ?)",
    [service, eventType, enabled ? 1 : 0]
  );
}

export function savePendingNotification(userId: number, mediaType: 'movie' | 'series', mediaId: number, title: string) {
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO pending_notifications (id, user_id, media_type, media_id, title) VALUES (?, ?, ?, ?, ?)",
    [id, userId, mediaType, mediaId, title]
  );
}

export function getPendingNotifications(mediaType: 'movie' | 'series', mediaId: number): { user_id: number, title: string, id: string }[] {
  return db.query("SELECT id, user_id, title FROM pending_notifications WHERE media_type = ? AND media_id = ? AND status = 'pending'").all(mediaType, mediaId) as { id: string, user_id: number, title: string }[];
}

export function markNotificationSent(id: string) {
  db.run("UPDATE pending_notifications SET status = 'sent' WHERE id = ?", [id]);
}
