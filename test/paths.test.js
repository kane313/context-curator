'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('./helpers');
const { slugify, findProjectDir, curatorDir } = require('../lib/paths');

test('slugify 把所有非字母数字换成 -（下划线也不例外）', () => {
  assert.strictEqual(slugify('/Users/x/flutter_plant'), '-Users-x-flutter-plant');
  assert.strictEqual(slugify('/a/b-c'), '-a-b-c');
});

test('findProjectDir 优先命中 slug 规则', () => {
  const root = tmpDir('root');
  const target = path.join(root, slugify('/w/proj'));
  fs.mkdirSync(target);
  assert.strictEqual(findProjectDir('/w/proj', root), target);
});

test('findProjectDir 在 slug 目录不存在时按 cwd 反查', () => {
  const root = tmpDir('root');
  const odd = path.join(root, 'some-unexpected-naming');
  fs.mkdirSync(odd);
  fs.writeFileSync(path.join(odd, 's.jsonl'),
    JSON.stringify({ type: 'user', cwd: '/w/other' }) + '\n');
  assert.strictEqual(findProjectDir('/w/other', root), odd);
});

test('findProjectDir 反查时跳过无 cwd 字段的记录，继续往后找', () => {
  const root = tmpDir('root');
  const d = path.join(root, 'x');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 's.jsonl'),
    JSON.stringify({ type: 'summary' }) + '\n' +
    JSON.stringify({ type: 'user', cwd: '/w/deep' }) + '\n');
  assert.strictEqual(findProjectDir('/w/deep', root), d);
});

test('findProjectDir 找不到返回 null', () => {
  assert.strictEqual(findProjectDir('/nowhere', tmpDir('root')), null);
});

test('curatorDir 拼在项目目录下', () => {
  assert.strictEqual(curatorDir(path.join('a', 'b')), path.join('a', 'b', 'context-curator'));
});
