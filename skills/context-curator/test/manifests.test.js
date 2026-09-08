'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('./helpers');
const M = require('../lib/manifests');

const PKG = JSON.stringify({
  name: 'web', version: '0.1.0', packageManager: 'pnpm@9.0.0',
  main: 'src/index.js', bin: { web: 'bin/cli.js' },
  scripts: { test: 'vitest', build: 'vite build', dev: 'vite', lint: 'eslint .' },
  dependencies: { react: '^18' }, devDependencies: { vitest: '^1' },
});

const PUBSPEC = `name: demo_app
description: A demo.
version: 1.2.0+3
environment:
  sdk: '>=3.0.0 <4.0.0'
dependencies:
  flutter:
    sdk: flutter
  go_router: ^13.0.0
  # 注释行
  http: any
dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^2.4.0
flutter:
  uses-material-design: true
  assets:
    - assets/
`;

test('parsePackageJson 取名字、脚本、依赖键、包管理器、入口', () => {
  const m = M.parsePackageJson(PKG);
  assert.strictEqual(m.file, 'package.json');
  assert.strictEqual(m.name, 'web');
  assert.strictEqual(m.version, '0.1.0');
  assert.deepStrictEqual(m.scripts, { test: 'vitest', build: 'vite build', dev: 'vite', lint: 'eslint .' });
  assert.deepStrictEqual(m.dependencies, ['react']);
  assert.deepStrictEqual(m.dev_dependencies, ['vitest']);
  assert.strictEqual(m.package_manager, 'pnpm');
  assert.strictEqual(m.main, 'src/index.js');
  assert.deepStrictEqual(m.bin, ['bin/cli.js']);
});

test('parsePackageJson 遇到损坏 JSON 只返回 file', () => {
  assert.deepStrictEqual(M.parsePackageJson('{ not json'), { file: 'package.json' });
});

test('parsePubspec 缩进扫描取依赖键，识别 flutter 与 sdk', () => {
  const m = M.parsePubspec(PUBSPEC);
  assert.strictEqual(m.name, 'demo_app');
  assert.strictEqual(m.version, '1.2.0+3');
  assert.strictEqual(m.sdk, '>=3.0.0 <4.0.0');
  assert.deepStrictEqual(m.dependencies, ['flutter', 'go_router', 'http']);
  assert.deepStrictEqual(m.dev_dependencies, ['flutter_test', 'build_runner']);
  assert.strictEqual(m.flutter, true);
});

test('parsePubspec 纯 Dart 包 flutter 为 false', () => {
  const m = M.parsePubspec('name: cli\ndependencies:\n  args: ^2.0.0\n');
  assert.strictEqual(m.flutter, false);
  assert.deepStrictEqual(m.dependencies, ['args']);
});

test('parseManifests 扫根目录，其他 manifest 用正则取字段', () => {
  const d = tmpDir('mf');
  fs.writeFileSync(path.join(d, 'go.mod'), 'module github.com/x/y\n\ngo 1.22\n');
  fs.writeFileSync(path.join(d, 'Cargo.toml'), '[package]\nname = "rusty"\nversion = "0.3.1"\n');
  fs.writeFileSync(path.join(d, 'pyproject.toml'), '[project]\nname = "py"\nversion = "1.0"\n[tool.pytest.ini_options]\n');
  fs.writeFileSync(path.join(d, 'pom.xml'), '<project><groupId>com.a</groupId><artifactId>app</artifactId></project>');
  fs.writeFileSync(path.join(d, 'Makefile'), 'all:\n');
  const ms = M.parseManifests(d);
  const by = f => ms.find(m => m.file === f);
  assert.deepStrictEqual(by('go.mod'), { file: 'go.mod', module: 'github.com/x/y', go: '1.22' });
  assert.deepStrictEqual(by('Cargo.toml'), { file: 'Cargo.toml', name: 'rusty', version: '0.3.1' });
  assert.deepStrictEqual(by('pyproject.toml'), { file: 'pyproject.toml', name: 'py', version: '1.0', pytest: true });
  assert.deepStrictEqual(by('pom.xml'), { file: 'pom.xml', group_id: 'com.a', artifact_id: 'app' });
  assert.deepStrictEqual(by('Makefile'), { file: 'Makefile' });
  assert.strictEqual(by('package.json'), undefined);
});

test('parseManifests 读 android/app/build.gradle 的 applicationId', () => {
  const d = tmpDir('mf');
  fs.mkdirSync(path.join(d, 'android', 'app'), { recursive: true });
  fs.writeFileSync(path.join(d, 'android', 'app', 'build.gradle'), 'android {\n  defaultConfig {\n    applicationId "com.demo.app"\n  }\n}\n');
  const m = M.parseManifests(d).find(m => m.file === 'android/app/build.gradle');
  assert.strictEqual(m.application_id, 'com.demo.app');
});

test('suggestCommands 按包管理器换前缀，flutter 与 go 走规则表', () => {
  const cmds = M.suggestCommands([
    M.parsePackageJson(PKG),
    M.parsePubspec(PUBSPEC),
    { file: 'go.mod', module: 'x' },
    { file: 'pyproject.toml', name: 'py', pytest: true },
  ]);
  const of = (kind, src) => cmds.filter(c => c.kind === kind && c.source.startsWith(src)).map(c => c.cmd);
  assert.deepStrictEqual(of('test', 'package.json'), ['pnpm run test']);
  assert.deepStrictEqual(of('run', 'package.json'), ['pnpm run dev']);
  assert.deepStrictEqual(of('lint', 'package.json'), ['pnpm run lint']);
  assert.deepStrictEqual(of('test', 'pubspec'), ['flutter test']);
  assert.deepStrictEqual(of('run', 'pubspec'), ['flutter run']);
  assert.deepStrictEqual(of('lint', 'pubspec'), ['dart analyze']);
  assert.deepStrictEqual(of('test', 'go.mod'), ['go test ./...']);
  assert.deepStrictEqual(of('build', 'go.mod'), ['go build ./...']);
  assert.deepStrictEqual(of('test', 'pyproject'), ['pytest']);
  for (const c of cmds) assert.ok(c.source, '每条命令必须带 source');
});

test('suggestCommands 没有 packageManager 时用 npm，纯 Dart 用 dart test', () => {
  const cmds = M.suggestCommands([
    M.parsePackageJson('{"scripts":{"test":"jest"}}'),
    M.parsePubspec('name: cli\ndependencies:\n  args: ^2.0.0\n'),
  ]);
  assert.ok(cmds.some(c => c.cmd === 'npm run test'));
  assert.ok(cmds.some(c => c.cmd === 'dart test'));
  assert.ok(!cmds.some(c => c.cmd === 'flutter run'));
});
