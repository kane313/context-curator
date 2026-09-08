'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { tmpDir, touch } = require('./helpers');
const { walk, detectEntrypoints, IGNORED } = require('../lib/walk');

function fixtureProject() {
  const d = tmpDir('walk');
  touch(d, 'lib/main.dart');
  touch(d, 'lib/features/home/page.dart');
  touch(d, 'lib/core/x.dart');
  touch(d, 'test/a_test.dart');
  touch(d, 'android/app/Main.kt');
  touch(d, 'node_modules/m/index.js');
  touch(d, 'build/out.js');
  touch(d, '.hidden/z.js');
  touch(d, 'README.md');
  touch(d, 'pubspec.yaml', 'name: x\n');
  return d;
}

test('walk 统计语言时跳过忽略目录与点开头目录', () => {
  const { languages, truncated } = walk(fixtureProject());
  assert.deepStrictEqual(languages, [{ name: 'Dart', files: 4 }, { name: 'Kotlin', files: 1 }]);
  assert.strictEqual(truncated, false);
});

test('walk 顶层树带递归文件数与二级目录名', () => {
  const { tree } = walk(fixtureProject());
  const lib = tree.find(t => t.name === 'lib');
  assert.deepStrictEqual(lib, { name: 'lib', type: 'dir', files: 3, children: ['core', 'features'] });
  assert.deepStrictEqual(tree.find(t => t.name === 'README.md'), { name: 'README.md', type: 'file' });
  assert.ok(!tree.some(t => t.name === 'node_modules'));
  assert.ok(!tree.some(t => t.name === 'build'));
  assert.ok(!tree.some(t => t.name === '.hidden'));
});

test('walk 超过 maxFiles 标 truncated', () => {
  const { truncated } = walk(fixtureProject(), { maxFiles: 2 });
  assert.strictEqual(truncated, true);
});

test('walk 根目录不存在返回空结果不抛', () => {
  assert.deepStrictEqual(walk(path.join(tmpDir('w'), 'nope')), { languages: [], tree: [], truncated: false });
});

test('walk children 最多 30 个', () => {
  const d = tmpDir('many');
  for (let i = 0; i < 40; i++) touch(d, `src/m${String(i).padStart(2, '0')}/a.js`);
  const src = walk(d).tree.find(t => t.name === 'src');
  assert.strictEqual(src.children.length, 30);
  assert.strictEqual(src.files, 40);
});

test('IGNORED 含 node_modules 与 .dart_tool', () => {
  assert.ok(IGNORED.has('node_modules'));
  assert.ok(IGNORED.has('.dart_tool'));
});

test('detectEntrypoints 认固定候选、bin/、cmd/*/main.go 与 package.json 入口', () => {
  const d = tmpDir('entry');
  touch(d, 'lib/main.dart');
  touch(d, 'bin/tool.dart');
  touch(d, 'bin/x.js');
  touch(d, 'cmd/server/main.go');
  touch(d, 'src/index.ts');
  touch(d, 'src/app.ts');
  const eps = detectEntrypoints(d, [{ file: 'package.json', main: './src/app.ts', bin: ['bin/x.js', 'bin/missing.js'] }]);
  assert.deepStrictEqual([...eps].sort(), ['bin/tool.dart', 'bin/x.js', 'cmd/server/main.go', 'lib/main.dart', 'src/app.ts', 'src/index.ts']);
});

test('detectEntrypoints 空项目返回空数组', () => {
  assert.deepStrictEqual(detectEntrypoints(tmpDir('empty')), []);
});
