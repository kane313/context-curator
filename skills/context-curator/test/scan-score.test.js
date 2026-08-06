'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { readFixture } = require('./helpers');
const { scanText } = require('../lib/scan');

test('命中 correction 得 5 分', () => {
  assert.strictEqual(scanText(readFixture('new-format.jsonl')).breakdown.correction, 5);
});

test('命中 memory_intent 得 5 分', () => {
  assert.strictEqual(scanText(readFixture('new-format.jsonl')).breakdown.memory_intent, 5);
});

test('asset_edit 权重仅 1', () => {
  assert.strictEqual(scanText(readFixture('new-format.jsonl')).breakdown.asset_edit, 1);
});

test('interrupt 识别数组形态的 content', () => {
  assert.strictEqual(scanText(readFixture('new-format.jsonl')).breakdown.interrupt, 3);
});

test('「继续」被判为噪声不计分', () => {
  const r = scanText(readFixture('new-format.jsonl'));
  assert.ok(!r.hits.some(h => h.snippet.trim() === '继续'));
});

test('纯流程会话得 0 分', () => {
  assert.strictEqual(scanText(readFixture('noise-only.jsonl')).score, 0);
});

test('同类信号封顶 3 次', () => {
  const line = '{"type":"user","isSidechain":false,"origin":{"kind":"human"},"message":{"role":"user","content":"这里不对啊"}}';
  const r = scanText(Array(5).fill(line).join('\n'));
  assert.strictEqual(r.breakdown.correction, 15);  // 5×3 封顶，不是 5×5
  assert.strictEqual(r.score, 16);                 // 1 基础分 + 15
});

test('损坏行不影响整体打分', () => {
  const good = '{"type":"user","isSidechain":false,"origin":{"kind":"human"},"message":{"role":"user","content":"这里不对啊"}}';
  const r = scanText(good + '\n{坏行\n' + good);
  assert.strictEqual(r.human_count, 2);
});
