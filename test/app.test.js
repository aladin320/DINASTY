import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../db.js';
import { getListenErrorMessage, smartAgentFallback } from '../server.js';

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

test('startup error explains stale-port recovery', () => {
  const message = getListenErrorMessage({ code: 'EADDRINUSE' }, 3000);
  assert.match(message, /Port 3000.*already in use/i);
  assert.match(message, /Stop the active process|change PORT/i);
});

test('smart fallback understands coding intent', () => {
  const reply = smartAgentFallback('I need a coding assistant for debugging and code reviews');
  assert.match(reply, /coding|code review|debugging|Claude Code|Cursor/i);
});
