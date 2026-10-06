// schema.js — tables shared by several of the added modules, plus the list of admin-only URLs.
import { db } from './db.js';

// URLs that need admin access (used by the activity log and the two-factor gate).
export const ADMIN_PATH = /^\/api\/(admin\/(?!login)|dashboard|smart\/(admin-tools|verify|tools\/|suggestions|reports|backups|digest|search-gaps|activity|quote-files(\/download\/\d+)?([?]|$)|link-health|stale-reminder|catalog|quote-pipeline|quiz-stats|errors|newsletter-stats))/;

function ensureColumn(table, column, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL,
      old_pricing TEXT NOT NULL, new_pricing TEXT NOT NULL, changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_history_slug ON price_history(slug);

    CREATE TABLE IF NOT EXISTS tool_extras (
      slug TEXT PRIMARY KEY,
      pros TEXT NOT NULL DEFAULT '[]', cons TEXT NOT NULL DEFAULT '[]',
      use_cases TEXT NOT NULL DEFAULT '[]', faq TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS quiz_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, helpful INTEGER, goal TEXT NOT NULL DEFAULT '',
      answers TEXT NOT NULL DEFAULT '{}', shown TEXT NOT NULL DEFAULT '[]', chosen TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      token TEXT NOT NULL, confirmed_at TEXT, opted_out INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, stack TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS link_health (
      slug TEXT PRIMARY KEY, url TEXT NOT NULL, status INTEGER, ok INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '', consecutive_failures INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maintenance_log (key TEXT PRIMARY KEY, ran_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL,
      ai_key TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_2fa (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret TEXT NOT NULL, enabled_at TEXT, backup_codes TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS admin_2fa_sessions (token_hash TEXT PRIMARY KEY, verified_at INTEGER NOT NULL);
  `);
  ensureColumn('quote_requests', 'stage', "TEXT NOT NULL DEFAULT 'new'");
  ensureColumn('quote_requests', 'loss_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('quote_requests', 'value', 'INTEGER');
  ensureColumn('users', 'digest_opt_out', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'unsub_token', 'TEXT');
  ensureColumn('users', 'email_verified_at', 'TEXT');
}