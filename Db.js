// db.js — SQLite persistence layer for DINASTY.
//
// Everything the old frontend kept only in a JS array (and lost on every
// page refresh) now lives here instead: AI performance reviews, community
// projects + their comments, the hero-banner comments/likes, and quote
// requests. The AI catalog itself (AI_INFO in script.js) stays static —
// it's app configuration, not user-generated content, so it doesn't need
// a table.
//
// Uses better-sqlite3: synchronous, zero-config, single-file database.
// Run `npm install` then just start the server — dinasty.db is created
// automatically on first run, tables included.

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dinasty.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ai_key TEXT NOT NULL,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_ai_key ON ai_reviews(ai_key);

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    ai_key TEXT NOT NULL,
    description TEXT NOT NULL,
    link TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comments_project_id ON project_comments(project_id);

  CREATE TABLE IF NOT EXISTS hero_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hero_likes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quote_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    service TEXT NOT NULL,
    project TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ---------- One-time seed: reproduces the old hardcoded demo content so ----
// ---------- the site looks the same on first run, but now from the DB. ----
function seedIfEmpty() {
  const reviewCount = db.prepare('SELECT COUNT(*) AS n FROM ai_reviews').get().n;
  if (reviewCount === 0) {
    const insert = db.prepare(
      'INSERT INTO ai_reviews (ai_key, author, rating, text, created_at) VALUES (?,?,?,?,?)'
    );
    const now = Date.now();
    const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
    const seed = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
    seed([
      ['claude', 'Wren D.', 5, 'Rewrote our onboarding docs in one pass — barely needed edits.', daysAgo(3)],
      ['claude-code', 'Sam I.', 5, 'Refactored a gnarly auth module without breaking a single test.', daysAgo(7)],
      ['claude-code', 'Priya R.', 4, 'Great for small PRs, needs tighter guidance on large refactors.', daysAgo(14)],
      ['midjourney', 'Theo K.', 5, 'Turned around a full concept-art set for our pitch deck in an afternoon.', daysAgo(4)],
      ['perplexity', 'Nadia F.', 4, 'Sources are solid, though it occasionally misses the newest articles.', daysAgo(6)]
    ]);
  }

  const projectCount = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  if (projectCount === 0) {
    const now = Date.now();
    const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
    const insertProject = db.prepare(
      'INSERT INTO projects (title, author, ai_key, description, link, created_at) VALUES (?,?,?,?,?,?)'
    );
    const insertComment = db.prepare(
      'INSERT INTO project_comments (project_id, author, text, created_at) VALUES (?,?,?,?)'
    );
    const seed = db.transaction(() => {
      const p1 = insertProject.run(
        'Invoice reconciliation bot', 'Dana M.', 'claude-code',
        'Built an agent that matches incoming invoices against POs and flags mismatches before they hit accounting.',
        '', daysAgo(6)
      );
      insertComment.run(p1.lastInsertRowid, 'Marcus T.', 'Saved our AP team hours every week.', daysAgo(4));

      insertProject.run(
        'Spring launch key art', 'Ines V.', 'midjourney',
        'Generated the full key-art series for our spring launch, then refined the picks in Photoshop.',
        '', daysAgo(9)
      );

      const p3 = insertProject.run(
        'Weekly customer digest', 'Owen P.', 'claude',
        "Drafts a plain-language summary of the week's support tickets every Monday morning, grouped by theme.",
        '', daysAgo(11)
      );
      insertComment.run(p3.lastInsertRowid, 'Leila S.', 'Reads like a person wrote it, not a bot.', daysAgo(5));
    });
    seed();
  }

  const heroCommentCount = db.prepare('SELECT COUNT(*) AS n FROM hero_comments').get().n;
  if (heroCommentCount === 0) {
    const now = Date.now();
    const insert = db.prepare('INSERT INTO hero_comments (author, text, created_at) VALUES (?,?,?)');
    insert.run('Marie K.', "The 3.4x shipping stat matches what we're seeing on our own team since we adopted agentic reviews.", new Date(now - 2 * 3600000).toISOString());
    insert.run('Tunde N.', 'Curious how the 40% fewer bugs figure was measured — across which repo sizes?', new Date(now - 5 * 3600000).toISOString());
  }

  const likesRow = db.prepare('SELECT count FROM hero_likes WHERE id = 1').get();
  if (!likesRow) {
    db.prepare('INSERT INTO hero_likes (id, count) VALUES (1, 128)').run();
  }
}
seedIfEmpty();

// ---------- Reviews ----------
export function listReviews(aiKey) {
  return db.prepare('SELECT id, author, rating, text, created_at FROM ai_reviews WHERE ai_key = ? ORDER BY id DESC').all(aiKey);
}
export function addReview(aiKey, author, rating, text) {
  const created_at = new Date().toISOString();
  const info = db.prepare('INSERT INTO ai_reviews (ai_key, author, rating, text, created_at) VALUES (?,?,?,?,?)')
    .run(aiKey, author, rating, text, created_at);
  return { id: info.lastInsertRowid, ai_key: aiKey, author, rating, text, created_at };
}

// ---------- Community projects ----------
export function listProjects() {
  return db.prepare(`
    SELECT p.id, p.title, p.author, p.ai_key AS aiKey, p.description, p.link, p.created_at,
           COUNT(c.id) AS commentCount
    FROM projects p
    LEFT JOIN project_comments c ON c.project_id = p.id
    GROUP BY p.id
    ORDER BY p.id DESC
  `).all();
}
export function getProject(id) {
  const project = db.prepare('SELECT id, title, author, ai_key AS aiKey, description, link, created_at FROM projects WHERE id = ?').get(id);
  if (!project) return null;
  const comments = db.prepare('SELECT id, author, text, created_at FROM project_comments WHERE project_id = ? ORDER BY id DESC').all(id);
  return { ...project, comments };
}
export function addProject({ title, author, aiKey, description, link }) {
  const created_at = new Date().toISOString();
  const info = db.prepare('INSERT INTO projects (title, author, ai_key, description, link, created_at) VALUES (?,?,?,?,?,?)')
    .run(title, author, aiKey, description, link || '', created_at);
  return getProject(info.lastInsertRowid);
}
export function addProjectComment(projectId, author, text) {
  const created_at = new Date().toISOString();
  const info = db.prepare('INSERT INTO project_comments (project_id, author, text, created_at) VALUES (?,?,?,?)')
    .run(projectId, author, text, created_at);
  return { id: info.lastInsertRowid, project_id: projectId, author, text, created_at };
}

// ---------- Hero banner: comments + likes ----------
export function listHeroComments() {
  return db.prepare('SELECT id, author, text, created_at FROM hero_comments ORDER BY id DESC').all();
}
export function addHeroComment(author, text) {
  const created_at = new Date().toISOString();
  const info = db.prepare('INSERT INTO hero_comments (author, text, created_at) VALUES (?,?,?)').run(author, text, created_at);
  return { id: info.lastInsertRowid, author, text, created_at };
}
export function getLikeCount() {
  return db.prepare('SELECT count FROM hero_likes WHERE id = 1').get().count;
}
export function adjustLikeCount(delta) {
  db.prepare('UPDATE hero_likes SET count = MAX(0, count + ?) WHERE id = 1').run(delta);
  return getLikeCount();
}

// ---------- Quote requests ----------
export function addQuoteRequest({ name, company, email, phone, service, project }) {
  const created_at = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO quote_requests (name, company, email, phone, service, project, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(name, company, email, phone, service, project, created_at);
  return { id: info.lastInsertRowid, created_at };
}
export function listQuoteRequests() {
  return db.prepare('SELECT * FROM quote_requests ORDER BY id DESC').all();
}