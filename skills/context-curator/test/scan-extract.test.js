'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { readFixture } = require('./helpers');
const { parseSession, humanText, extractHuman } = require('../lib/scan');

function human(name) {
  return extractHuman(parseSession(readFixture(name)));
}

test('新格式：只认 origin.kind=human，得 2 条', () => {
  const r = human('new-format.jsonl');
  assert.strictEqual(r.newFormat, true);
  assert.strictEqual(r.human.length, 2);
});

test('新格式：抓到纠正原文', () => {
  const r = human('new-format.jsonl');
  assert.ok(r.human.some(h => h.text.includes('Riverpod')));
});

test('新格式：排除 sidechain', () => {
  const r = human('new-format.jsonl');
  assert.ok(!r.human.some(h => h.text.includes('子agent')));
});

test('新格式：排除命令注入', () => {
  const r = human('new-format.jsonl');
  assert.ok(!r.human.some(h => h.text.includes('command-name')));
});

test('老格式：回退排除法，得 1 条', () => {
  const r = human('old-format.jsonl');
  assert.strictEqual(r.newFormat, false);
  assert.strictEqual(r.human.length, 1);
  assert.ok(r.human[0].text.includes('analyze'));
});

test('纯流程会话：真人输入为 0', () => {
  assert.strictEqual(human('noise-only.jsonl').human.length, 0);
});

test('humanText 处理数组形态 content', () => {
  const rec = { message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_result', content: 'x' }] } };
  assert.strictEqual(humanText(rec), 'a');
});

test('parseSession 用文件行号，且跳过空行与损坏行不中断', () => {
  const text = '{"a":1}\n\n这不是JSON\n{"b":2}\n';
  const e = parseSession(text);
  assert.strictEqual(e.length, 2);
  assert.strictEqual(e[0].line, 1);
  assert.strictEqual(e[1].line, 4);   // 行号是文件行号，不是记录序号
});
