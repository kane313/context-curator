'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tmpDir } = require('./helpers');
const S = require('../lib/store');

test('指纹稳定且区分内容', () => {
  const a = S.fingerprint('CLAUDE.md', '纠错', '改用 Riverpod');
  assert.strictEqual(a, S.fingerprint('CLAUDE.md', '纠错', '改用 Riverpod'));
  assert.notStrictEqual(a, S.fingerprint('CLAUDE.md', '纠错', '改用 Provider'));
  assert.ok(a.startsWith('sha1:'));
});

test('拒绝后 isRejected 为真，重复拒绝不重复记录', () => {
  const d = tmpDir('st');
  const fp = S.fingerprint('CLAUDE.md', '纠错', 'x');
  assert.strictEqual(S.isRejected(d, fp), false);
  S.reject(d, fp, 'CLAUDE.md', 'x');
  assert.strictEqual(S.isRejected(d, fp), true);
  S.reject(d, fp, 'CLAUDE.md', 'x');
  assert.strictEqual(S.readState(d).rejected.length, 1);
});

test('队列追加与去重判断', () => {
  const d = tmpDir('q');
  assert.strictEqual(S.hasSession(d, 's1'), false);
  S.appendQueue(d, { session_id: 's1', status: 'pending' });
  assert.strictEqual(S.hasSession(d, 's1'), true);
  assert.strictEqual(S.readQueue(d).length, 1);
});

test('markDone 只改目标 session', () => {
  const d = tmpDir('q');
  S.appendQueue(d, { session_id: 's1', status: 'pending' });
  S.appendQueue(d, { session_id: 's2', status: 'pending' });
  S.markDone(d, 's1');
  const q = S.readQueue(d);
  assert.strictEqual(q.find(x => x.session_id === 's1').status, 'done');
  assert.strictEqual(q.find(x => x.session_id === 's2').status, 'pending');
  assert.ok(S.readState(d).last_scanned_at);
});

test('队列文件不存在时读取返回空数组而不抛', () => {
  assert.deepStrictEqual(S.readQueue(tmpDir('empty')), []);
});

test('markInitialized 写 initialized_at，不动 rejected 与队列', () => {
  const d = tmpDir('init');
  const fp = S.fingerprint('CLAUDE.md', '纠错', 'x');
  S.reject(d, fp, 'CLAUDE.md', 'x');
  S.appendQueue(d, { session_id: 's1', status: 'pending' });
  S.markInitialized(d);
  const st = S.readState(d);
  assert.match(st.initialized_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.strictEqual(st.rejected.length, 1);
  assert.strictEqual(S.readQueue(d)[0].status, 'pending');
});
