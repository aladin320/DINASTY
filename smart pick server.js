// smart-pick-server.js — server side of the "smarter AI picking" feature.
// Isolated on purpose: server.js only imports this file and calls
// registerSmartPick(app, { requireUserSession, requireAdminAccess }).
//
// What it adds:
//   - ai_tools.verified_at column (when an admin last checked a tool's details)
//   - starting pricing values for tools whose pricing is still blank
//   - GET  /api/smart/meta    -> { slug: { pricing, verifiedAt } } for badges
//   - GET  /api/smart/saved   -> the signed-in user's saved tool slugs
//   - POST /api/smart/verify  -> admin: stamp tools as verified today
//   - GET  /smart-pick.css and /smart-pick.js (the frontend files)

import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Starting values only, written ONLY where pricing is still blank.
// Plans change often, so check them and then stamp each tool with
// POST /api/smart/verify. Until then the site shows "Not verified yet".
const PRICING_HINTS = {
  claude: 'freemium', gpt: 'freemium', gemini: 'freemium', llama: 'free', mistral: 'freemium',
  grok: 'freemium', perplexity: 'freemium', deepseek: 'free', cohere: 'freemium', 'ms-copilot': 'freemium',
  'gh-copilot': 'freemium', cursor: 'freemium', windsurf: 'freemium', zed: 'free', 'notion-ai': 'paid',
  notebooklm: 'freemium', elicit: 'freemium', consensus: 'freemium', scite: 'paid',
  'semantic-scholar': 'free', researchrabbit: 'free', scholarcy: 'freemium', explainpaper: 'freemium',
  humata: 'freemium', chatpdf: 'freemium', otter: 'freemium', fireflies: 'freemium', jasper: 'paid',
  copyai: 'freemium', writesonic: 'freemium', grammarly: 'freemium', deepl: 'freemium',
  midjourney: 'paid', dalle: 'freemium', 'stable-diffusion': 'free', runway: 'freemium',
  elevenlabs: 'freemium', synthesia: 'paid', 'zapier-ai': 'freemium', glean: 'paid', harvey: 'paid',
  you: 'freemium', poe: 'freemium', 'claude-code': 'paid', suno: 'freemium', uizard: 'freemium'
};

export function registerSmartPick(app, { requireUserSession, requireAdminAccess }) {
  // --- schema ---------------------------------------------------------
  const columns = db.prepare('PRAGMA table_info(ai_tools)').all();
  if (!columns.some((column) => column.name === 'verified_at')) {
    db.exec('ALTER TABLE ai_tools ADD COLUMN verified_at TEXT');
  }
  const applyHint = db.prepare("UPDATE ai_tools SET pricing = ? WHERE slug = ? AND pricing = ''");
  db.transaction(() => {
    Object.entries(PRICING_HINTS).forEach(([slug, pricing]) => applyHint.run(pricing, slug));
  })();

  // --- frontend files -------------------------------------------------
  app.get('/smart-pick.css', (_req, res) => res.sendFile(path.join(__dirname, 'smart-pick.css')));
  app.get('/smart-pick.js', (_req, res) => res.sendFile(path.join(__dirname, 'smart-pick.js')));

  // Admin page for pricing + verified dates (separate files because the
  // site's CSP blocks inline scripts).
  app.get('/catalog-admin.html', (_req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.sendFile(path.join(__dirname, 'catalog-admin.html'));
  });
  app.get('/catalog-admin.js', (_req, res) => res.sendFile(path.join(__dirname, 'catalog-admin.js')));

  app.get('/api/smart/admin-tools', (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    res.json(db.prepare(`
      SELECT slug, name, vendor, category, pricing, website, verified_at AS verifiedAt
      FROM ai_tools WHERE retired = 0 ORDER BY name ASC
    `).all());
  });

  // Body: { pricing?: '' | 'free' | 'freemium' | 'paid', verified?: true }
  app.patch('/api/smart/tools/:slug', (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    const body = req.body || {};
    const sets = [];
    const values = [];
    if (body.pricing !== undefined) {
      if (!['', 'free', 'freemium', 'paid'].includes(body.pricing)) {
        return res.status(400).json({ error: 'pricing must be free, freemium, paid or empty' });
      }
      sets.push('pricing = ?');
      values.push(body.pricing);
    }
    if (body.verified === true) {
      sets.push('verified_at = ?');
      values.push(new Date().toISOString());
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_at = ?');
    values.push(new Date().toISOString(), req.params.slug);
    const changed = db.prepare(`UPDATE ai_tools SET ${sets.join(', ')} WHERE slug = ? AND retired = 0`).run(...values).changes;
    if (!changed) return res.status(404).json({ error: 'tool not found' });
    const row = db.prepare('SELECT slug, pricing, verified_at AS verifiedAt FROM ai_tools WHERE slug = ?').get(req.params.slug);
    res.json(row);
  });

  // --- API ------------------------------------------------------------
  app.get('/api/smart/meta', (_req, res) => {
    const rows = db.prepare('SELECT slug, pricing, verified_at AS verifiedAt FROM ai_tools WHERE retired = 0').all();
    res.json(Object.fromEntries(rows.map((row) => [row.slug, { pricing: row.pricing, verifiedAt: row.verifiedAt }])));
  });

  app.get('/api/smart/saved', (req, res) => {
    const session = requireUserSession(req, res);
    if (!session) return;
    const rows = db.prepare('SELECT ai_key AS aiKey FROM saved_tools WHERE user_id = ? ORDER BY id DESC').all(session.user.id);
    res.json(rows.map((row) => row.aiKey));
  });

  app.post('/api/smart/verify', (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    const body = req.body || {};
    const slugs = (Array.isArray(body.slugs) ? body.slugs : [body.slug])
      .filter((slug) => typeof slug === 'string' && slug.trim())
      .slice(0, 100);
    if (!slugs.length) return res.status(400).json({ error: 'slug or slugs is required' });

    const stamp = db.prepare('UPDATE ai_tools SET verified_at = ? WHERE slug = ?');
    const now = new Date().toISOString();
    const updated = db.transaction(() => slugs.reduce((count, slug) => count + stamp.run(now, slug).changes, 0))();
    if (!updated) return res.status(404).json({ error: 'no matching tools' });
    res.json({ success: true, updated, verifiedAt: now });
  });
}