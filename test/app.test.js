import assert from 'node:assert/strict';
import test from 'node:test';
import { addQuoteRequest, db, deleteQuote, listQuoteRequests, updateQuote } from '../db.js';
import { app, getListenErrorMessage, getRateLimitMessage, smartAgentFallback } from '../server.js';

async function startTestServer(t) {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('database initializes required tables', () => {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('reviews', 'community_projects', 'quote_requests', 'users', 'ai_tools')"
  ).all();

  const names = new Set(tables.map((row) => row.name));
  assert.ok(names.has('reviews'));
  assert.ok(names.has('community_projects'));
  assert.ok(names.has('quote_requests'));
  assert.ok(names.has('users'));
  assert.ok(names.has('ai_tools'));
});

test('quote database functions persist and update request status', () => {
  const saved = addQuoteRequest({
    name: 'Test User',
    company: 'DINASTY Test',
    email: `test-${Date.now()}@example.com`,
    phone: '+1 555 0100',
    service: 'automation',
    project: 'Regression coverage'
  });

  assert.ok(listQuoteRequests().some((quote) => quote.id === saved.id));
  assert.equal(updateQuote(saved.id, { status: 'closed', reply: 'Test reply' }), true);
  const updated = listQuoteRequests().find((quote) => quote.id === saved.id);
  assert.equal(updated.status, 'closed');
  assert.equal(updated.reply, 'Test reply');
  assert.equal(deleteQuote(saved.id), true);
});

test('startup error explains stale-port recovery', () => {
  const message = getListenErrorMessage({ code: 'EADDRINUSE' }, 3000);
  assert.match(message, /Port 3000.*already in use/i);
  assert.match(message, /Stop the active process|change PORT/i);
});

test('smart fallback understands coding intent', () => {
  const reply = smartAgentFallback('I need a coding assistant for debugging and code reviews');
  assert.match(reply, /coding|code review|debugging|Claude Code|Cursor/i);
});

test('write rate limit message explains throttling clearly', () => {
  const message = getRateLimitMessage();
  assert.match(message, /too many|slow down|try again later/i);
});

test('health endpoint responds with service status and security headers', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});

test('unknown browser routes use the branded 404 page', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/missing-page`, { headers: { accept: 'text/html' } });
  const body = await response.text();

  assert.equal(response.status, 404);
  assert.match(body, /DINASTY \/ 404/);
  assert.match(body, /That page moved/);
});

test('admin dashboard data stays protected', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/dashboard`);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

test('quote validation rejects incomplete requests', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test User' })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'all fields are required' });
});
