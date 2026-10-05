// extras-quotes.js — confirmation email, status/reply emails, and file attachments for quotes.
import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { sendMail, siteUrl } from './mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads', 'quotes');
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 3;
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Allowed types, with a check on the file's first bytes so a renamed .exe can't pass as a .pdf.
const TYPES = {
  pdf: (b) => b.subarray(0, 4).toString() === '%PDF',
  png: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  docx: (b) => b.subarray(0, 2).toString() === 'PK',
  txt: (b) => !b.includes(0),
  md: (b) => !b.includes(0)
};

const STATUS_COPY = {
  contacted: 'We have started on your request and will be in touch.',
  closed: 'We have closed this request. Reply to this email if you would like to reopen it.',
  new: 'Your request is back in our queue.'
};

export function registerQuotes(app, { requireAdminAccess }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_upload_tokens (
      quote_id INTEGER PRIMARY KEY REFERENCES quote_requests(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quote_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // 1) New quote: add an upload token to the response and email the client a confirmation.
  app.post('/api/quote', (req, res, next) => {
    const send = res.json.bind(res);
    let quoteId = null;
    res.json = (body) => {
      if (res.statusCode === 201 && body?.id) {
        quoteId = body.id;
        const token = randomBytes(24).toString('hex');
        try {
          db.prepare('INSERT OR REPLACE INTO quote_upload_tokens (quote_id, token_hash) VALUES (?,?)').run(quoteId, sha(token));
          body = { ...body, uploadToken: token };
        } catch (error) { console.error('Could not create upload token:', error); }
      }
      return send(body);
    };
    res.on('finish', () => {
      const email = String(req.body?.email || '').trim();
      if (res.statusCode !== 201 || !quoteId || !EMAIL.test(email)) return;
      sendMail({
        to: email,
        subject: `We received your request: ${String(req.body?.project || '').slice(0, 80)}`,
        text: `Hi ${String(req.body?.name || '').slice(0, 80)},\n\nThanks for contacting DINASTY. We received your quote request (reference #${quoteId}) and will reply by email.\n\nYou can follow its status in your dashboard: ${siteUrl()}/UserDashboard.html\n\nIf any detail is wrong, just reply to this email.`
      }).catch((error) => console.error('Quote confirmation failed:', error));
    });
    next();
  });

  // 2) Admin changes the status or writes a reply: tell the client.
  app.patch('/api/admin/quotes/:id', (req, res, next) => {
    const before = db.prepare('SELECT status, reply FROM quote_requests WHERE id = ?').get(Number(req.params.id));
    res.on('finish', () => {
      if (res.statusCode !== 200 || !before) return;
      const after = db.prepare('SELECT name, email, project, status, reply FROM quote_requests WHERE id = ?').get(Number(req.params.id));
      if (!after || !EMAIL.test(after.email)) return;
      const replyChanged = after.reply && after.reply !== before.reply;
      const statusChanged = after.status !== before.status;
      if (!replyChanged && !statusChanged) return;
      const lines = [`Hi ${after.name},`, '', `Update on your request "${after.project}":`, ''];
      if (replyChanged) lines.push(after.reply, '');
      if (statusChanged) lines.push(STATUS_COPY[after.status] || `Status: ${after.status}.`, '');
      lines.push(`Dashboard: ${siteUrl()}/UserDashboard.html`);
      sendMail({ to: after.email, subject: `Update on your DINASTY request: ${after.project.slice(0, 80)}`, text: lines.join('\n') })
        .catch((error) => console.error('Quote update email failed:', error));
    });
    next();
  });

  // 3) File upload. Raw body, authorised by the token returned when the quote was created.
  app.post('/api/smart/quote-files/:quoteId', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), (req, res) => {
    const quoteId = Number(req.params.quoteId);
    const row = db.prepare('SELECT token_hash FROM quote_upload_tokens WHERE quote_id = ?').get(quoteId);
    if (!row || row.token_hash !== sha(req.get('x-upload-token') || '')) return res.status(403).json({ error: 'upload not allowed for this request' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'file is empty or too large (max 5 MB)' });
    if (db.prepare('SELECT COUNT(*) AS n FROM quote_files WHERE quote_id = ?').get(quoteId).n >= MAX_FILES) {
      return res.status(400).json({ error: `up to ${MAX_FILES} files per request` });
    }

    const original = path.basename(decodeURIComponent(req.get('x-filename') || 'file')).replace(/[^\w.\- ]/g, '_').slice(0, 120);
    const ext = path.extname(original).slice(1).toLowerCase();
    if (!TYPES[ext]) return res.status(400).json({ error: 'allowed types: pdf, png, jpg, docx, txt, md' });
    if (!TYPES[ext](req.body)) return res.status(400).json({ error: 'the file content does not match its type' });

    const stored = `${randomBytes(12).toString('hex')}.${ext}`;
    fs.mkdirSync(path.join(UPLOAD_DIR, String(quoteId)), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, String(quoteId), stored), req.body, { flag: 'wx' });
    const info = db.prepare('INSERT INTO quote_files (quote_id, original_name, stored_name, size, created_at) VALUES (?,?,?,?,?)')
      .run(quoteId, original, stored, req.body.length, new Date().toISOString());
    res.status(201).json({ success: true, id: info.lastInsertRowid });
  });

  app.use('/api/smart/quote-files', (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'file is too large (max 5 MB)' });
    return next(error);
  });

  // Files are never served publicly; only admins can list and download them.
  app.get('/api/smart/quote-files', (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    res.json(db.prepare(`
      SELECT f.id, f.quote_id AS quoteId, f.original_name AS name, f.size, f.created_at AS createdAt,
             q.company, q.project
      FROM quote_files f JOIN quote_requests q ON q.id = f.quote_id ORDER BY f.id DESC LIMIT 200
    `).all());
  });

  app.get('/api/smart/quote-files/download/:id', (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    const file = db.prepare('SELECT * FROM quote_files WHERE id = ?').get(Number(req.params.id));
    const location = file && path.join(UPLOAD_DIR, String(file.quote_id), file.stored_name);
    if (!file || !fs.existsSync(location)) return res.status(404).json({ error: 'file not found' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(location, file.original_name);
  });
}