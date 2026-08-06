'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir, readFixture } = require('./helpers');

const HARVEST = path.join(__dirname, '..', 'bin', 'harvest.js');
const STATE = path.join(__dirname, '..', 'bin', 'state.js');

function run(bin, args, opts = {}) {
  try {
    const out = execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...opts });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status, out: e.stdout || '' };
  }
}

function batchDir() {
  const d = tmpDir('batch');
  fs.writeFileSync(path.join(d, 'aaa.jsonl'), readFixture('new-format.jsonl'));
  fs.writeFileSync(path.join(d, 'bbb.jsonl'), readFixture('old-format.jsonl'));
  fs.writeFileSync(path.join(d, 'ccc.jsonl'), readFixture('noise-only.jsonl'));
  return d;
}

test('harvest 只输出有分会话且按 score 降序', () => {
  const { out } = run(HARVEST, [batchDir()]);
  const rows = out.trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].session_id, 'aaa');
  assert.ok(rows[0].score >= rows[1].score);
  assert.ok(!rows.some(r => r.session_id === 'ccc'));
});

test('harvest --min-score 过滤生效', () => {
  const { out } = run(HARVEST, [batchDir(), '--min-score', '1000']);
  assert.strictEqual(out.trim(), '');
});

test('harvest 目录不存在也退出 0', () => {
  assert.strictEqual(run(HARVEST, [path.join(tmpDir('x'), 'nope')]).rc, 0);
});

test('state CLI 全流程', () => {
  const d = tmpDir('cc');
  const fp = run(STATE, ['fingerprint', 'CLAUDE.md', '纠错', 'x']).out.trim();
  assert.ok(fp.startsWith('sha1:'));
  assert.strictEqual(run(STATE, ['is-rejected', d, fp]).rc, 1);
  run(STATE, ['reject', d, fp, 'CLAUDE.md', 'x']);
  assert.strictEqual(run(STATE, ['is-rejected', d, fp]).rc, 0);
});

test('state done 标记队列', () => {
  const d = tmpDir('cc');
  fs.writeFileSync(path.join(d, 'queue.jsonl'),
    JSON.stringify({ session_id: 's1', status: 'pending' }) + '\n');
  run(STATE, ['done', d, 's1']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'queue.jsonl'), 'utf8').trim()).status, 'done');
});

test('state 用法错误退出码 2', () => {
  assert.strictEqual(run(STATE, ['bogus']).rc, 2);
});
