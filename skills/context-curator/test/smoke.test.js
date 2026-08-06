'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { FIXTURES, readFixture, tmpDir } = require('./helpers');

test('三份 fixture 都存在且是合法 JSONL', () => {
  for (const name of ['new-format.jsonl', 'old-format.jsonl', 'noise-only.jsonl']) {
    const lines = readFixture(name).split('\n').filter(l => l.trim());
    assert.ok(lines.length > 0, `${name} 不应为空`);
    for (const l of lines) assert.doesNotThrow(() => JSON.parse(l), `${name} 有非法 JSON 行`);
  }
});

test('tmpDir 每次返回全新空目录', () => {
  const a = tmpDir('x');
  fs.writeFileSync(path.join(a, 'f'), '1');
  const b = tmpDir('x');
  assert.notStrictEqual(a, b);
  assert.strictEqual(fs.readdirSync(b).length, 0);
});
