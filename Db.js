// db.js — SQLite persistence layer for DINASTY.
//
// Everything the old frontend kept only in a JS array (and lost on every
// page refresh) now lives here instead: AI performance reviews, community
// reviews, community projects + their comments, the hero-banner comments/likes,
// quote requests, and users
// requests. The AI catalog itself (AI_INFO in script.js) stays static —
// it's app configuration, not user-generated content, so it doesn't need
// a table.
//
// Uses better-sqlite3: synchronous, zero-config, single-file database.
// Run `npm install` then just start the server — dinasty.db is created
// automatically on first run, tables included.

import Database from 'better-sqlite3';
import 'dotenv/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATABASE_URL is a local SQLite file path in this project.
const DB_PATH = process.env.DATABASE_URL || process.env.DB_PATH || path.join(__dirname, 'dinasty.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ai_key TEXT NOT NULL,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    moderated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_ai_key ON reviews(ai_key);

  CREATE TABLE IF NOT EXISTS community_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    ai_key TEXT NOT NULL,
    description TEXT NOT NULL,
    link TEXT,
    approved INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES community_projects(id) ON DELETE CASCADE,
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
    status TEXT NOT NULL DEFAULT 'new',
    reply TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ai_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, ai_key)
  );

  CREATE TABLE IF NOT EXISTS user_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    ai_keys TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

    CREATE TABLE IF NOT EXISTS ai_tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      website TEXT NOT NULL,
      pricing TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      context_window INTEGER,
      speed TEXT NOT NULL DEFAULT '',
      coding_score REAL,
      reasoning_score REAL,
      image_support INTEGER NOT NULL DEFAULT 0,
      audio_support INTEGER NOT NULL DEFAULT 0,
      api_available INTEGER NOT NULL DEFAULT 0,
      privacy TEXT NOT NULL DEFAULT '',
      logo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'password_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
}
if (!userColumns.some((column) => column.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('reviews', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('reviews', 'moderated', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('community_projects', 'approved', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('community_projects', 'featured', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('quote_requests', 'status', "TEXT NOT NULL DEFAULT 'new'");
ensureColumn('quote_requests', 'reply', "TEXT NOT NULL DEFAULT ''");

// Migrate data from the original table names without deleting the old tables.
// Keeping them makes this safe for existing local databases while all new
// application reads and writes use the canonical names above.
const tableExists = (tableName) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
).get(tableName));

if (tableExists('ai_reviews')) {
  db.prepare(`
    INSERT OR IGNORE INTO reviews (id, ai_key, author, rating, text, created_at)
    SELECT id, ai_key, author, rating, text, created_at FROM ai_reviews
  `).run();
}
if (tableExists('projects')) {
  db.prepare(`
    INSERT OR IGNORE INTO community_projects (id, title, author, ai_key, description, link, created_at)
    SELECT id, title, author, ai_key, description, link, created_at FROM projects
  `).run();
}

// ---------- One-time seed: reproduces the old hardcoded demo content so ----
// ---------- the site looks the same on first run, but now from the DB. ----
function seedIfEmpty() {
  const reviewCount = db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n;
  if (reviewCount === 0) {
    const insert = db.prepare(
      'INSERT INTO reviews (ai_key, author, rating, text, created_at) VALUES (?,?,?,?,?)'
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

  const projectCount = db.prepare('SELECT COUNT(*) AS n FROM community_projects').get().n;
  if (projectCount === 0) {
    const now = Date.now();
    const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
    const insertProject = db.prepare(
      'INSERT INTO community_projects (title, author, ai_key, description, link, created_at) VALUES (?,?,?,?,?,?)'
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
  return db.prepare('SELECT id, author, rating, text, created_at FROM reviews WHERE ai_key = ? AND hidden = 0 ORDER BY id DESC').all(aiKey);
}
export function addReview(aiKey, author, rating, text) {
  const created_at = new Date().toISOString();
  const info = db.prepare('INSERT INTO reviews (ai_key, author, rating, text, created_at) VALUES (?,?,?,?,?)')
    .run(aiKey, author, rating, text, created_at);
  return { id: info.lastInsertRowid, ai_key: aiKey, author, rating, text, created_at };
}

// ---------- Community projects ----------
export function listProjects() {
  return db.prepare(`
    SELECT p.id, p.title, p.author, p.ai_key AS aiKey, p.description, p.link, p.created_at,
           COUNT(c.id) AS commentCount
    FROM community_projects p
    LEFT JOIN project_comments c ON c.project_id = p.id
    WHERE p.approved = 1
    GROUP BY p.id
    ORDER BY p.featured DESC, p.id DESC
  `).all();
}
export function getProject(id) {
  const project = db.prepare('SELECT id, title, author, ai_key AS aiKey, description, link, created_at FROM community_projects WHERE id = ?').get(id);
  if (!project) return null;
  const comments = db.prepare('SELECT id, author, text, created_at FROM project_comments WHERE project_id = ? ORDER BY id DESC').all(id);
  return { ...project, comments };
}
export function addProject({ title, author, aiKey, description, link }) {
  const created_at = new Date().toISOString();
  const info = db.prepare('INSERT INTO community_projects (title, author, ai_key, description, link, created_at) VALUES (?,?,?,?,?,?)')
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

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyUserPassword(email, password) {
  const user = db.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?').get(email);
  if (!user || !user.password_hash) return null;

  const [salt, storedHash] = user.password_hash.split(':');
  const candidateHash = scryptSync(password, salt, 64);
  const expectedHash = Buffer.from(storedHash, 'hex');
  if (candidateHash.length !== expectedHash.length || !timingSafeEqual(candidateHash, expectedHash)) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function upsertUser(name, email, password) {
  const now = new Date().toISOString();
  const passwordHash = password ? hashPassword(password) : null;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    if (passwordHash) {
      db.prepare('UPDATE users SET name = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(name, passwordHash, now, existing.id);
    } else {
      db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name, now, existing.id);
    }
    return db.prepare('SELECT id, name, email, created_at, updated_at FROM users WHERE id = ?').get(existing.id);
  }

  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).run(name, email, passwordHash, 'user', now, now);
  return db.prepare('SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function registerUser(name, email, password) {
  const existing = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  if (existing?.password_hash) return null;
  return upsertUser(name, email, password);
}

export function getUserDashboardData(user) {
  const reviews = db.prepare(`
    SELECT id, ai_key AS aiKey, rating, text, created_at
    FROM reviews WHERE author = ? ORDER BY id DESC LIMIT 50
  `).all(user.name);
  const projects = db.prepare(`
    SELECT p.id, p.title, p.ai_key AS aiKey, p.description, p.link, p.approved, p.featured,
           p.created_at, COUNT(c.id) AS commentCount
    FROM community_projects p
    LEFT JOIN project_comments c ON c.project_id = p.id
    WHERE p.author = ?
    GROUP BY p.id ORDER BY p.id DESC LIMIT 50
  `).all(user.name);
  const quotes = db.prepare(`
    SELECT id, company, service, project, status, reply, created_at
    FROM quote_requests WHERE email = ? ORDER BY id DESC LIMIT 50
  `).all(user.email);
  const savedTools = db.prepare(`
    SELECT ai_key AS aiKey, created_at FROM saved_tools
    WHERE user_id = ? ORDER BY id DESC LIMIT 50
  `).all(user.id);
  const comparisons = db.prepare(`
    SELECT id, title, ai_keys AS aiKeys, created_at FROM user_comparisons
    WHERE user_id = ? ORDER BY id DESC LIMIT 50
  `).all(user.id).map((comparison) => ({ ...comparison, aiKeys: JSON.parse(comparison.aiKeys) }));
  return { user, reviews, projects, quotes, savedTools, comparisons };
}

export function saveTool(userId, aiKey) {
  const created_at = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO saved_tools (user_id, ai_key, created_at) VALUES (?,?,?)').run(userId, aiKey, created_at);
  return db.prepare('SELECT ai_key AS aiKey, created_at FROM saved_tools WHERE user_id = ? AND ai_key = ?').get(userId, aiKey);
}
export function removeSavedTool(userId, aiKey) {
  return db.prepare('DELETE FROM saved_tools WHERE user_id = ? AND ai_key = ?').run(userId, aiKey).changes > 0;
}
export function addUserComparison(userId, title, aiKeys) {
  const created_at = new Date().toISOString();
  const info = db.prepare('INSERT INTO user_comparisons (user_id, title, ai_keys, created_at) VALUES (?,?,?,?)').run(userId, title, JSON.stringify(aiKeys), created_at);
  return db.prepare('SELECT id, title, ai_keys AS aiKeys, created_at FROM user_comparisons WHERE id = ?').get(info.lastInsertRowid);
}

export function listAdminReviews() {
  return db.prepare(`
    SELECT id, ai_key AS aiKey, author, rating, text, hidden, moderated, created_at
    FROM reviews ORDER BY id DESC
  `).all();
}
export function deleteReview(id) {
  return db.prepare('DELETE FROM reviews WHERE id = ?').run(id).changes > 0;
}
export function moderateReview(id, { hidden, moderated }) {
  const fields = [];
  const values = [];
  if (typeof hidden === 'boolean') { fields.push('hidden = ?'); values.push(hidden ? 1 : 0); }
  if (typeof moderated === 'boolean') { fields.push('moderated = ?'); values.push(moderated ? 1 : 0); }
  if (fields.length === 0) return false;
  values.push(id);
  return db.prepare(`UPDATE reviews SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
}

export function listAdminProjects() {
  return db.prepare(`
    SELECT p.id, p.title, p.author, p.ai_key AS aiKey, p.description, p.link,
           p.approved, p.featured, p.created_at, COUNT(c.id) AS commentCount
    FROM community_projects p
    LEFT JOIN project_comments c ON c.project_id = p.id
    GROUP BY p.id ORDER BY p.id DESC
  `).all();
}
export function updateProjectModeration(id, { approved, featured }) {
  const fields = [];
  const values = [];
  if (typeof approved === 'boolean') { fields.push('approved = ?'); values.push(approved ? 1 : 0); }
  if (typeof featured === 'boolean') { fields.push('featured = ?'); values.push(featured ? 1 : 0); }
  if (fields.length === 0) return false;
  values.push(id);
  return db.prepare(`UPDATE community_projects SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
}
export function deleteProject(id) {
  return db.prepare('DELETE FROM community_projects WHERE id = ?').run(id).changes > 0;
}

export function listAdminQuotes() {
  return db.prepare(`
    SELECT id, name, company, email, phone, service, project, status, reply, created_at
    FROM quote_requests ORDER BY id DESC
  `).all();
}
export function listAdminUsers() {
  return db.prepare('SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY id DESC LIMIT 100').all();
}
export function listAdminAiTools() {
  return db.prepare(`
    SELECT id, name, slug, category, description, website, pricing, model,
           context_window AS contextWindow, speed, coding_score AS codingScore,
           reasoning_score AS reasoningScore, image_support AS imageSupport,
           audio_support AS audioSupport, api_available AS apiAvailable,
           privacy, logo, created_at, updated_at
    FROM ai_tools ORDER BY name ASC
  `).all();
}
export function addAiTool(tool) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO ai_tools (name, slug, category, description, website, pricing, model,
      context_window, speed, coding_score, reasoning_score, image_support,
      audio_support, api_available, privacy, logo, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(tool.name, tool.slug, tool.category, tool.description, tool.website, tool.pricing, tool.model,
    tool.contextWindow, tool.speed, tool.codingScore, tool.reasoningScore, tool.imageSupport ? 1 : 0,
    tool.audioSupport ? 1 : 0, tool.apiAvailable ? 1 : 0, tool.privacy, tool.logo, now, now);
  return db.prepare('SELECT * FROM ai_tools WHERE id = ?').get(info.lastInsertRowid);
}
export function deleteAiTool(id) {
  return db.prepare('DELETE FROM ai_tools WHERE id = ?').run(id).changes > 0;
}
export function updateQuote(id, { status, reply }) {
  const fields = [];
  const values = [];
  if (typeof status === 'string') { fields.push('status = ?'); values.push(status); }
  if (typeof reply === 'string') { fields.push('reply = ?'); values.push(reply); }
  if (fields.length === 0) return false;
  values.push(id);
  return db.prepare(`UPDATE quote_requests SET ${fields.join(', ')} WHERE id = ?`).run(...values).changes > 0;
}
export function deleteQuote(id) {
  return db.prepare('DELETE FROM quote_requests WHERE id = ?').run(id).changes > 0;
}

// ---------- Admin dashboard ----------
export function getDashboardData() {
  const reviewSummary = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(AVG(rating), 0) AS avgRating
    FROM reviews
  `).get();
  const reviewsByAi = db.prepare(`
    SELECT ai_key AS aiKey, COUNT(*) AS count, AVG(rating) AS avgRating
    FROM reviews
    GROUP BY ai_key
    ORDER BY count DESC, ai_key ASC
  `).all();
  const ratingRows = db.prepare(`
    SELECT rating, COUNT(*) AS count
    FROM reviews
    GROUP BY rating
  `).all();
  const distribution = [1, 2, 3, 4, 5].map((rating) => {
    const row = ratingRows.find((item) => item.rating === rating);
    return row ? row.count : 0;
  });

  const projectSummary = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE((SELECT COUNT(*) FROM project_comments), 0) AS totalComments
    FROM community_projects
  `).get();
  const recentProjects = db.prepare(`
    SELECT p.id, p.title, p.author, p.ai_key AS aiKey, p.approved, p.featured, p.created_at,
           COUNT(c.id) AS commentCount
    FROM community_projects p
    LEFT JOIN project_comments c ON c.project_id = p.id
    GROUP BY p.id
    ORDER BY p.id DESC
    LIMIT 8
  `).all();

  const recentQuotes = db.prepare(`
    SELECT id, name, company, service, project, status, reply, created_at
    FROM quote_requests
    ORDER BY id DESC
    LIMIT 8
  `).all();
  const quoteServiceRows = db.prepare(`
    SELECT service, COUNT(*) AS count
    FROM quote_requests
    GROUP BY service
    ORDER BY count DESC, service ASC
  `).all();
  const byService = Object.fromEntries(quoteServiceRows.map((row) => [row.service, row.count]));
  const weeklyTrend = (tableName) => db.prepare(`
    SELECT strftime('%Y-%W', created_at) AS week, COUNT(*) AS count
    FROM ${tableName}
    WHERE created_at >= datetime('now', '-56 days')
    GROUP BY week
    ORDER BY week ASC
  `).all();

  return {
    reviews: {
      total: reviewSummary.total,
      avgRating: reviewSummary.avgRating,
      perAi: reviewsByAi,
      distribution,
      management: listAdminReviews()
    },
    projects: {
      total: projectSummary.total,
      totalComments: projectSummary.totalComments,
      recent: recentProjects,
      management: listAdminProjects()
    },
    quotes: {
      total: db.prepare('SELECT COUNT(*) AS total FROM quote_requests').get().total,
      recent: recentQuotes,
      byService,
      management: listAdminQuotes()
    },
    users: {
      total: db.prepare('SELECT COUNT(*) AS total FROM users').get().total,
      management: listAdminUsers()
    },
    aiTools: listAdminAiTools(),
    hero: {
      likes: getLikeCount()
    },
    trends: {
      reviews: weeklyTrend('reviews'),
      projects: weeklyTrend('community_projects'),
      quotes: weeklyTrend('quote_requests')
    }
  };
}