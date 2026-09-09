import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listReviews, addReview,
  listProjects, getProject, addProject, addProjectComment,
  listHeroComments, addHeroComment, getLikeCount, adjustLikeCount,
  addQuoteRequest, listQuoteRequests
} from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

// Serve the DINASTY frontend (index.html, style.css, script.js) from the
// same origin as the API, so the browser's fetch() calls in script.js
// just work — no CORS setup needed.
app.use(express.static(path.join(__dirname, 'public')));

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

// =========================================================
// AI performance reviews
// =========================================================

app.get('/api/reviews/:aiKey', (req, res) => {
  const aiKey = cleanStr(req.params.aiKey, MAX_SHORT);
  if (!aiKey) return res.status(400).json({ error: 'aiKey is required' });
  res.json(listReviews(aiKey));
});

app.post('/api/reviews/:aiKey', (req, res) => {
  const aiKey = cleanStr(req.params.aiKey, MAX_SHORT);
  const author = cleanStr(req.body?.author, MAX_SHORT) || 'You';
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
  const title = cleanStr(req.body?.title, MAX_SHORT);
  const author = cleanStr(req.body?.author, MAX_SHORT);
  const aiKey = cleanStr(req.body?.aiKey, MAX_SHORT);
  const description = cleanStr(req.body?.description, MAX_TEXT);
  const link = cleanStr(req.body?.link, 500) || '';

  if (!title || !author || !aiKey || !description) {
    return res.status(400).json({ error: 'title, author, aiKey and description are required' });
  }

  res.status(201).json(addProject({ title, author, aiKey, description, link }));
});

app.post('/api/projects/:id/comments', (req, res) => {
  const id = Number(req.params.id);
  const author = cleanStr(req.body?.author, MAX_SHORT) || 'You';
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
  const author = cleanStr(req.body?.author, MAX_SHORT) || 'You';
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

// Simple owner-only view of submitted quote requests. Not linked from the
// UI — hit it directly (e.g. with curl) with the admin key from .env.
// This is intentionally minimal; swap in real auth before using this in
// production.
app.get('/api/admin/quotes', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'ADMIN_KEY is not configured on the server' });
  }
  if (req.get('x-admin-key') !== adminKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json(listQuoteRequests());
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

app.post('/api/agent-chat', async (req, res) => {
  try {
    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // No key yet — don't hard-fail. Answer with a real reply so the chat
      // UI (bubbles, typing indicator, multi-turn) is fully verifiable the
      // moment someone runs `npm start`, before they've added a key.
      console.warn('ANTHROPIC_API_KEY not set — replying in demo mode. See .env.example.');
      return res.json({
        reply: "I'm running in demo mode right now because no ANTHROPIC_API_KEY is set on the server yet — add one to your .env file (see .env.example) and restart the server to get real, tailored answers from Claude. Once that's done, ask me anything about finding the right AI, performance reviews, the Community section, or requesting a quote."
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
      return res.status(502).json({ error: 'Upstream AI request failed' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DINASTY server running on http://localhost:${PORT}`);
});