'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir, readFixture } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'scan-session.js');

function runHook(payload) {
  try {
    execFileSync(process.execPath, [BIN], { input: payload, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    return e.status === undefined ? -1 : e.status;
  }
}

function setup(fixture, name) {
  const proj = tmpDir('proj');
  const f = path.join(proj, name + '.jsonl');
  fs.writeFileSync(f, readFixture(fixture));
  return { proj, f, cc: path.join(proj, 'context-curator') };
}

test('有信号的会话入队一行，字段完整', () => {
  const { f, cc } = setup('new-format.jsonl', 'sess-1');
  const rc = runHook(JSON.stringify({ session_id: 'sess-1', transcript_path: f, cwd: '/p', reason: 'clear' }));
  assert.strictEqual(rc, 0);
  const lines = fs.readFileSync(path.join(cc, 'queue.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.strictEqual(rec.session_id, 'sess-1');
  assert.strictEqual(rec.status, 'pending');
  assert.ok(rec.score > 0);
  assert.ok(!('human' in rec), 'human 全文不应进队列');
});

test('同一 session 重复触发不重复入队', () => {
  const { f, cc } = setup('new-format.jsonl', 'sess-1');
  const p = JSON.stringify({ session_id: 'sess-1', transcript_path: f, cwd: '/p', reason: 'clear' });
  runHook(p); runHook(p);
  assert.strictEqual(fs.readFileSync(path.join(cc, 'queue.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('零分的纯流程会话不入队', () => {
  const { f, cc } = setup('noise-only.jsonl', 'sess-2');
  runHook(JSON.stringify({ session_id: 'sess-2', transcript_path: f, cwd: '/p', reason: 'clear' }));
  assert.strictEqual(fs.existsSync(path.join(cc, 'queue.jsonl')), false);
});

test('各种坏输入一律退出码 0 且不产生队列', () => {
  for (const bad of ['', 'not json', '{"a":', '{}', JSON.stringify({ session_id: 'x', transcript_path: '/nope/none.jsonl' })]) {
    assert.strictEqual(runHook(bad), 0, `坏输入应 exit 0: ${bad}`);
  }
});
