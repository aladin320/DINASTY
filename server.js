import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { randomBytes, timingSafeEqual } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listReviews, addReview,
  listProjects, getProject, addProject, addProjectComment,
  listHeroComments, addHeroComment, getLikeCount, adjustLikeCount,
  addQuoteRequest, listQuoteRequests, getDashboardData, registerUser,
  listAdminReviews, deleteReview, moderateReview,
  listAdminProjects, updateProjectModeration, deleteProject,
  listAdminQuotes, updateQuote, deleteQuote,
  listAdminAiTools, addAiTool, deleteAiTool,
  verifyUserPassword, getUserDashboardData, saveTool, removeSavedTool, addUserComparison
} from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests; try again later' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many auth requests; try again later' }
});

app.use(generalLimiter);
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', authLimiter);
app.use('/api/admin/login', authLimiter);
const adminSessions = new Map();
const authSessions = new Map();
const loginRateLimits = new Map();
const failedLogins = new Map();
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const FAILED_LOGIN_MAX_ATTEMPTS = 5;
const FAILED_LOGIN_LOCK_MS = 15 * 60 * 1000;

// Serve the frontend files from the project root, where index.html, style.css
// and script.js live, so the browser's API calls stay same-origin.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/script.js', (_req, res) => res.sendFile(path.join(__dirname, 'script.js')));
app.get('/Architecture.html', (_req, res) => res.sendFile(path.join(__dirname, 'Architecture.html')));
app.get('/Dashboard.html', (_req, res) => res.sendFile(path.join(__dirname, 'Dashboard.html')));
app.get('/dashboard.html', (_req, res) => res.sendFile(path.join(__dirname, 'Dashboard.html')));
app.get('/UserDashboard.html', (_req, res) => res.sendFile(path.join(__dirname, 'UserDashboard.html')));
app.get('/user-dashboard.html', (_req, res) => res.sendFile(path.join(__dirname, 'UserDashboard.html')));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'dinasty', timestamp: new Date().toISOString() });
});

// ---------- Small validation helpers ----------
// Nothing fancy — just enough to keep obviously-bad data (empty strings,
// wrong types, oversized pastes, out-of-range ratings) out of the DB, since
// every one of these endpoints is reachable directly from the browser.
const MAX_TEXT = 2000;
const MAX_SHORT = 200;

function cleanStr(value, maxLen) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function createAdminSession() {
  const token = randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  return token;
}

function parseCookies(req) {
  const header = req.get('cookie') || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function setAuthCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `dinasty_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'dinasty_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
}

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error:', error);
  res.status(500).json({ error: 'internal server error' });
});

function clientAddress(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function loginRateLimited(req) {
  const now = Date.now();
  const key = clientAddress(req);
  const current = loginRateLimits.get(key);
  if (!current || current.resetAt <= now) {
    loginRateLimits.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > LOGIN_MAX_ATTEMPTS;
}

function failedLoginLocked(req, email) {
  const entry = failedLogins.get(`${clientAddress(req)}:${email}`);
  return Boolean(entry && entry.lockedUntil > Date.now());
}

function recordFailedLogin(req, email) {
  const key = `${clientAddress(req)}:${email}`;
  const now = Date.now();
  const current = failedLogins.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + LOGIN_WINDOW_MS, lockedUntil: 0 }
    : current;
  entry.count += 1;
  if (entry.count >= FAILED_LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + FAILED_LOGIN_LOCK_MS;
  failedLogins.set(key, entry);
}

function clearFailedLogins(req, email) {
  failedLogins.delete(`${clientAddress(req)}:${email}`);
}

function adminKeyMatches(candidate, expected) {
  if (typeof candidate !== 'string' || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function requireAdminAccess(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    res.status(503).json({ error: 'ADMIN_KEY is not configured on the server' });
    return false;
  }
  if (adminKeyMatches(req.get('x-admin-key'), adminKey)) return true;

  const authenticatedUser = getAuthSession(req);
  if (authenticatedUser?.user.role === 'admin') return true;

  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expiresAt = token && adminSessions.get(token);

  if (!expiresAt) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  if (expiresAt <= Date.now()) {
    adminSessions.delete(token);
    res.status(401).json({ error: 'session expired' });
    return false;
  }
  return true;
}

function getAuthSession(req) {
  const cookies = parseCookies(req);
  const authorization = req.get('authorization') || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const token = cookies.dinasty_session || bearer;
  const session = token && authSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireUserSession(req, res, roles = ['user', 'admin']) {
  const session = getAuthSession(req);
  if (!session) {
    res.status(401).json({ error: 'authentication required' });
    return null;
  }
  if (!roles.includes(session.user.role)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return session;
}

app.post('/api/admin/login', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'ADMIN_KEY is not configured on the server' });
  }
  if (req.body?.key !== adminKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ token: createAdminSession(), expiresIn: ADMIN_SESSION_TTL_MS });
});

function cleanEmail(value) {
  const email = cleanStr(value, MAX_SHORT)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function createAuthSession(user) {
  const token = randomBytes(32).toString('hex');
  authSessions.set(token, { user, expiresAt: Date.now() + AUTH_SESSION_TTL_MS });
  return token;
}

app.post('/api/auth/login', (req, res) => {
  if (loginRateLimited(req)) return res.status(429).json({ error: 'too many login attempts; try again later' });
  const email = cleanEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || password.length < 8) {
    return res.status(400).json({ error: 'valid email and password are required' });
  }
  if (failedLoginLocked(req, email)) return res.status(429).json({ error: 'account temporarily locked; try again later' });

  const user = verifyUserPassword(email, password);
  if (!user) {
    recordFailedLogin(req, email);
    return res.status(401).json({ error: 'invalid email or password' });
  }

  clearFailedLogins(req, email);
  const token = createAuthSession(user);
  setAuthCookie(res, token, AUTH_SESSION_TTL_MS / 1000);
  res.json({
    expiresIn: AUTH_SESSION_TTL_MS,
    user
  });
});

app.post('/api/auth/logout', (req, res) => {
  const session = getAuthSession(req);
  if (session) authSessions.delete(session.token);
  clearAuthCookie(res);
  res.status(204).end();
});

app.get('/api/auth/me', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  res.json({ user: session.user, expiresAt: session.expiresAt });
});

app.get('/api/user/dashboard', (req, res) => {
  const session = requireUserSession(req, res, ['user', 'admin']);
  if (!session) return;
  res.json(getUserDashboardData(session.user));
});

app.post('/api/user/saved-tools', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  const aiKey = cleanStr(req.body?.aiKey, MAX_SHORT);
  if (!aiKey) return res.status(400).json({ error: 'aiKey is required' });
  res.status(201).json(saveTool(session.user.id, aiKey));
});

app.delete('/api/user/saved-tools/:aiKey', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  if (!removeSavedTool(session.user.id, req.params.aiKey)) return res.status(404).json({ error: 'saved tool not found' });
  res.status(204).end();
});

app.post('/api/user/comparisons', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  const title = cleanStr(req.body?.title, MAX_SHORT);
  const aiKeys = Array.isArray(req.body?.aiKeys) ? req.body.aiKeys.filter((key) => typeof key === 'string').slice(0, 10) : [];
  if (!title || aiKeys.length < 2) return res.status(400).json({ error: 'title and at least two aiKeys are required' });
  res.status(201).json(addUserComparison(session.user.id, title, aiKeys));
});

app.post('/api/auth/register', (req, res) => {
  const name = cleanStr(req.body?.name, MAX_SHORT);
  const email = cleanEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || !email || password.length < 8) {
    return res.status(400).json({ error: 'name, valid email and password of at least 8 characters are required' });
  }
  const user = registerUser(name, email, password);
  if (!user) return res.status(409).json({ error: 'an account with this email already exists' });
  res.status(201).json(user);
});

// =========================================================
// AI performance reviews
// =========================================================

app.get('/api/reviews/:aiKey', (req, res) => {
  const aiKey = cleanStr(req.params.aiKey, MAX_SHORT);
  if (!aiKey) return res.status(400).json({ error: 'aiKey is required' });
  res.json(listReviews(aiKey));
});

app.post('/api/reviews/:aiKey', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  const aiKey = cleanStr(req.params.aiKey, MAX_SHORT);
  const author = session.user.name;
  const text = cleanStr(req.body?.text, MAX_TEXT);
  const rating = Number(req.body?.rating);

  if (!aiKey) return res.status(400).json({ error: 'aiKey is required' });
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
  }

  res.status(201).json(addReview(aiKey, author, rating, text));
});

// =========================================================
// Community projects + comments
// =========================================================

app.get('/api/projects', (_req, res) => {
  res.json(listProjects());
});

app.get('/api/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid project id' });
  const project = getProject(id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  res.json(project);
});

app.post('/api/projects', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  const title = cleanStr(req.body?.title, MAX_SHORT);
  const author = session.user.name;
  const aiKey = cleanStr(req.body?.aiKey, MAX_SHORT);
  const description = cleanStr(req.body?.description, MAX_TEXT);
  const link = cleanStr(req.body?.link, 500) || '';

  if (!title || !author || !aiKey || !description) {
    return res.status(400).json({ error: 'title, author, aiKey and description are required' });
  }

  res.status(201).json(addProject({ title, author, aiKey, description, link }));
});

app.post('/api/projects/:id/comments', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  const id = Number(req.params.id);
  const author = session.user.name;
  const text = cleanStr(req.body?.text, MAX_TEXT);

  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid project id' });
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });

  res.status(201).json(addProjectComment(id, author, text));
});

// =========================================================
// Hero banner: comments + likes
// =========================================================

app.get('/api/hero', (_req, res) => {
  res.json({ likes: getLikeCount(), comments: listHeroComments() });
});

app.post('/api/hero/comments', (req, res) => {
  const session = requireUserSession(req, res);
  if (!session) return;
  const author = session.user.name;
  const text = cleanStr(req.body?.text, MAX_TEXT);
  if (!text) return res.status(400).json({ error: 'text is required' });
  res.status(201).json(addHeroComment(author, text));
});

app.post('/api/hero/like', (req, res) => {
  // liked: true means "the button was just turned on" (+1),
  // liked: false means "just turned off" (-1). The client tracks its own
  // on/off state locally; there's no login system, so this is a shared
  // counter rather than a per-user like — same trade-off the original
  // in-memory version made.
  const delta = req.body?.liked ? 1 : -1;
  res.json({ likes: adjustLikeCount(delta) });
});

// =========================================================
// Quote requests
// =========================================================

app.post('/api/quote', (req, res) => {
  const name = cleanStr(req.body?.name, MAX_SHORT);
  const company = cleanStr(req.body?.company, MAX_SHORT);
  const email = cleanStr(req.body?.email, MAX_SHORT);
  const phone = cleanStr(req.body?.phone, MAX_SHORT);
  const service = cleanStr(req.body?.service, MAX_SHORT);
  const project = cleanStr(req.body?.project, MAX_SHORT);

  if (!name || !company || !email || !phone || !service || !project) {
    return res.status(400).json({ error: 'all fields are required' });
  }

  const saved = addQuoteRequest({ name, company, email, phone, service, project });
  res.status(201).json({ success: true, id: saved.id });
});

// Owner-only dashboard data. The browser sends the real ADMIN_KEY in the
// x-admin-key header; no dashboard data is returned without authentication.
app.get('/api/dashboard', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  res.json(getDashboardData());
});

function adminId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'invalid id' });
    return null;
  }
  return id;
}

app.get('/api/admin/reviews', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  res.json(listAdminReviews());
});
app.patch('/api/admin/reviews/:id', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const id = adminId(req, res);
  if (!id) return;
  if (!moderateReview(id, req.body || {})) return res.status(404).json({ error: 'review not found or no changes supplied' });
  res.json({ success: true });
});
app.delete('/api/admin/reviews/:id', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const id = adminId(req, res);
  if (!id) return;
  if (!deleteReview(id)) return res.status(404).json({ error: 'review not found' });
  res.status(204).end();
});

app.get('/api/admin/projects', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  res.json(listAdminProjects());
});
app.patch('/api/admin/projects/:id', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const id = adminId(req, res);
  if (!id) return;
  if (!updateProjectModeration(id, req.body || {})) return res.status(404).json({ error: 'project not found or no changes supplied' });
  res.json({ success: true });
});
app.delete('/api/admin/projects/:id', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const id = adminId(req, res);
  if (!id) return;
  if (!deleteProject(id)) return res.status(404).json({ error: 'project not found' });
  res.status(204).end();
});

app.get('/api/admin/ai-tools', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  res.json(listAdminAiTools());
});
app.post('/api/admin/ai-tools', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const body = req.body || {};
  const required = ['name', 'slug', 'category', 'description', 'website'];
  if (required.some((field) => !cleanStr(body[field], field === 'description' ? MAX_TEXT : MAX_SHORT))) {
    return res.status(400).json({ error: 'name, slug, category, description and website are required' });
  }
  try {
    res.status(201).json(addAiTool({
      name: cleanStr(body.name, MAX_SHORT), slug: cleanStr(body.slug, MAX_SHORT),
      category: cleanStr(body.category, MAX_SHORT), description: cleanStr(body.description, MAX_TEXT),
      website: cleanStr(body.website, 500), pricing: cleanStr(body.pricing, MAX_SHORT) || '',
      model: cleanStr(body.model, MAX_SHORT) || '', contextWindow: Number(body.contextWindow) || null,
      speed: cleanStr(body.speed, MAX_SHORT) || '', codingScore: Number(body.codingScore) || null,
      reasoningScore: Number(body.reasoningScore) || null, imageSupport: Boolean(body.imageSupport),
      audioSupport: Boolean(body.audioSupport), apiAvailable: Boolean(body.apiAvailable),
      privacy: cleanStr(body.privacy, MAX_TEXT) || '', logo: cleanStr(body.logo, 500) || ''
    }));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'slug already exists' });
    throw error;
  }
});
app.delete('/api/admin/ai-tools/:id', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const id = adminId(req, res);
  if (!id) return;
  if (!deleteAiTool(id)) return res.status(404).json({ error: 'AI tool not found' });
  res.status(204).end();
});

app.get('/api/admin/quotes', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  res.json(listAdminQuotes());
});
app.patch('/api/admin/quotes/:id', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const id = adminId(req, res);
  if (!id) return;
  const body = req.body || {};
  const allowedStatuses = ['new', 'in-progress', 'replied', 'closed'];
  if (body.status !== undefined && !allowedStatuses.includes(body.status)) {
    return res.status(400).json({ error: 'invalid quote status' });
  }
  if (body.reply !== undefined && typeof body.reply !== 'string') {
    return res.status(400).json({ error: 'reply must be text' });
  }
  if (!updateQuote(id, { status: body.status, reply: body.reply })) return res.status(404).json({ error: 'quote not found or no changes supplied' });
  res.json({ success: true });
});
app.delete('/api/admin/quotes/:id', (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  const id = adminId(req, res);
  if (!id) return;
  if (!deleteQuote(id)) return res.status(404).json({ error: 'quote not found' });
  res.status(204).end();
});

// =========================================================
// AI Agent: real, Claude-powered onboarding chat
// =========================================================

const MODEL = 'claude-opus-5'; // more capable than Sonnet — better reasoning, nuance, and judgment for open-ended questions
const MAX_TURNS = 20; // cap how much history we forward, per request
const MAX_MESSAGE_CHARS = 4000; // defensive cap per message so one huge paste can't blow up cost/latency

const SYSTEM_PROMPT = `You are the DINASTY Guide, an assistant embedded in the DINASTY website — an AI tool discovery platform for software teams. Answer whatever the person actually asks, as helpfully and directly as a knowledgeable assistant would — don't limit yourself to platform questions or redirect people away from what they asked.

Think before you answer. Don't default to the shortest possible reply — match the depth of your answer to the question: a quick factual question gets a quick answer, but a real question deserving explanation, comparison, or judgment gets one, with the reasoning shown, not just a conclusion. If a question is ambiguous, ask what they mean rather than guessing. If you're not sure about something, say so instead of making it up. Keep it conversational, not a wall of text — but don't sacrifice substance for brevity.

You have specific, accurate knowledge of this platform, and should use it whenever it's relevant to what's being asked — reference the actual UI by name so people know exactly what to click:
- Goal-based AI picker: category cards on the home page (Writing, Image Generation, Video, Music, Coding, Productivity, Education, Research, Marketing, Business, Automation, Voice, Design), plus a "Dev AI" card that scrolls to a dedicated developer-tools section instead of opening the picker. Clicking a goal card, or the "Sign in" button in the nav, opens a modal that jumps straight to the single best-fit AI tool for that goal, with a plain explanation of how it works and why it's the pick. From there people can search or browse the full catalog of 46 AI tools.
- Dev AI section: a dedicated area further down the home page with 10 developer-focused categories (coding assistants, code editors, debugging, code generation, code review, agents, terminal/CLI, testing, documentation, DevOps/cloud). Each shows a curated set of tools with a "View AI" button that opens that tool's detail view in the sign-in modal.
- Performance reviews: inside each AI's detail view in that same modal there's a "Performance reviews" section — an average star rating and comments from people who've actually used that tool, plus a form to leave a new star rating and comment. These are stored in a real database now, so they persist.
- Community section: people click "Share your project" to post something they built with AI (a title, which AI they used, a description, and an optional link). Every shared project has its own comment thread so others can react to the work. Also database-backed.
- Docs: a "Docs" link in the nav opens a knowledge-center modal with Documentation, AI Learning, Tool Guides (browsable by category), and Comparisons.
- Request a quote: a button in the top navigation (and in the Product section) opens a form asking for name, company, contact details, the service they want AI for, and a project title; submitting it saves the request to the database for the team to follow up on.

For anything outside that — general questions, advice, technical problems, whatever the person brings up — just answer normally and honestly, the way you would in any other conversation. Never invent DINASTY features that aren't listed above, but don't restrict the conversation to DINASTY topics only.`;

export function smartAgentFallback(userInput = '') {
  const text = String(userInput || '').toLowerCase();

  if (/(coding|developer|debug|code review|bug|refactor|testing|terminal|cli|api|devops)/.test(text)) {
    return 'For coding and debugging, start in the Dev AI section and compare coding assistants, code review tools, and testing workflows. Claude Code, Cursor, and GitHub Copilot are strong fits depending on whether you want AI pair programming, debugging, or code review support.';
  }

  if (/(write|writing|email|copy|blog|content|docs|summarize|article)/.test(text)) {
    return 'For writing and content work, use the Writing category on the home page. Claude and ChatGPT are typically strongest for long-form writing, brainstorming, and rewriting, while more focused tools can help with style and speed.';
  }

  if (/(image|design|logo|mockup|illustration|visual)/.test(text)) {
    return 'For visual creation, open the Image Generation category and compare tools by image quality, editing flexibility, and how quickly they fit into your design workflow.';
  }

  if (/(research|compare|analysis|market|report|brief|study)/.test(text)) {
    return 'For research-heavy work, use the Research or Productivity categories and compare tools by context window, citation quality, and workflow integration. The Docs section is also a good place to evaluate options.';
  }

  if (/(quote|pricing|buy|contact|demo|request)/.test(text)) {
    return 'If you want to talk pricing or request a custom recommendation, use the Request a Quote flow from the top nav or the Product section. That lets the team follow up with the right service and project context.';
  }

  if (/(community|project|share|review|compare)/.test(text)) {
    return 'The Community section is where people share projects built with AI. Start with “Share your project” to post a build, then browse project comments and Performance Reviews to see how real teams are using tools.';
  }

  return 'Start with the Goal-based AI picker on the homepage, or use the Dev AI section for coding and technical tools. From there, open a tool detail to read Performance Reviews, compare options, and request a quote if you want a tailored recommendation.';
}

app.post('/api/agent-chat', async (req, res) => {
  try {
    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const lastUserMessage = [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0);
      console.warn('ANTHROPIC_API_KEY not set — replying in smart demo mode. See .env.example.');
      return res.json({
        reply: smartAgentFallback(lastUserMessage?.content || messages.map((m) => m?.content || '').join(' '))
      });
    }

    // Only forward well-formed turns, cap how far back we go, and cap each
    // message's length so a single oversized paste can't spike cost/latency.
    const trimmed = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
      .slice(-MAX_TURNS)
      .map(m => ({
        role: m.role,
        content: m.content.length > MAX_MESSAGE_CHARS ? m.content.slice(0, MAX_MESSAGE_CHARS) : m.content
      }));

    if (trimmed.length === 0) {
      return res.status(400).json({ error: 'messages array had no valid turns' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: SYSTEM_PROMPT,
        messages: trimmed
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      const lastUserMessage = [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0);
      return res.status(502).json({
        reply: smartAgentFallback(lastUserMessage?.content || messages.map((m) => m?.content || '').join(' '))
      });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(block => block.type === 'text');
    const reply = textBlock ? textBlock.text : "Sorry, I couldn't generate a reply just now.";

    res.json({ reply });
  } catch (err) {
    console.error('Agent chat error:', err);
    res.status(500).json({ error: 'Something went wrong handling your message' });
  }
});

export function getListenErrorMessage(error, port) {
  if (error && error.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Stop the active process or change PORT and restart the server.`;
  }
  return error ? error.message : 'Server failed to start.';
}

export function startServer(port = Number(process.env.PORT) || 3000) {
  const server = app.listen(port, () => {
    console.log(`DINASTY server running on http://localhost:${port}`);
  });

  server.on('error', (error) => {
    console.error(getListenErrorMessage(error, port));
    process.exitCode = 1;
  });

  return server;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  startServer(Number(process.env.PORT) || 3000);
}