'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir, touch } = require('./helpers');
const { slugify } = require('../lib/paths');
const P = require('../lib/profile');

test('detectTooling 认测试目录、CI 文件、lint 配置、Docker 与 env 样例', () => {
  const d = tmpDir('tool');
  touch(d, 'test/a_test.dart');
  touch(d, 'integration_test/b_test.dart');
  touch(d, '.github/workflows/ci.yml');
  touch(d, '.github/workflows/release.yaml');
  touch(d, 'analysis_options.yaml');
  touch(d, '.editorconfig');
  touch(d, 'Dockerfile');
  touch(d, '.env.example');
  const t = P.detectTooling(d);
  assert.deepStrictEqual(t.tests, ['test/', 'integration_test/']);
  assert.deepStrictEqual(t.ci, ['.github/workflows/ci.yml', '.github/workflows/release.yaml']);
  assert.deepStrictEqual(t.lint, ['analysis_options.yaml', '.editorconfig']);
  assert.deepStrictEqual(t.docker, ['Dockerfile']);
  assert.deepStrictEqual(t.env_example, ['.env.example']);
});

test('detectTooling 空项目全部为空数组', () => {
  assert.deepStrictEqual(P.detectTooling(tmpDir('t')), { tests: [], ci: [], lint: [], docker: [], env_example: [] });
});

test('contextAssets 报行数（与 wc -l 一致）、docs 两层递归、.claude 子目录与其他 AI 规则文件', () => {
  const d = tmpDir('assets');
  touch(d, 'CLAUDE.md', 'a\nb\nc\n');
  touch(d, 'README.md', 'x\n');
  touch(d, 'docs/a.md');
  touch(d, 'docs/sub/b.md');
  touch(d, 'docs/sub/deep/c.md');
  touch(d, 'docs/sub/deep/deeper/d.md');
  touch(d, 'docs/notes.txt');
  touch(d, 'docs/context/product.md');
  touch(d, 'docs/node_modules/pkg/README.md');
  touch(d, '.claude/rules/r1.md');
  touch(d, '.claude/settings.json', '{}');
  touch(d, '.cursorrules');
  const sessionDir = tmpDir('sess');
  touch(sessionDir, 'memory/MEMORY.md', '');
  const a = P.contextAssets(d, sessionDir);
  assert.deepStrictEqual(a['CLAUDE.md'], { exists: true, lines: 3 });
  assert.deepStrictEqual(a['AGENTS.md'], { exists: false });
  assert.deepStrictEqual(a['README.md'], { exists: true, lines: 1 });
  assert.deepStrictEqual(a.docs,
    ['docs/a.md', 'docs/context/product.md', 'docs/sub/b.md', 'docs/sub/deep/c.md']);
  assert.ok(!a.docs.some(f => f.includes('node_modules')));
  assert.deepStrictEqual(a.docs_context, ['product.md']);
  assert.deepStrictEqual(a.claude_dir, { rules: ['r1.md'], skills: [], commands: [], settings: true });
  assert.deepStrictEqual(a.other_ai_rules, ['.cursorrules']);
  assert.deepStrictEqual(a.memory, { dir: path.join(sessionDir, 'memory'), files: ['MEMORY.md'] });
});

test('contextAssets 没有会话目录时 memory.dir 为 null', () => {
  const a = P.contextAssets(tmpDir('a'), null);
  assert.deepStrictEqual(a.memory, { dir: null, files: [] });
  assert.deepStrictEqual(a.docs, []);
  assert.deepStrictEqual(a.docs_context, []);
});

test('gitInfo 非仓库返回 is_repo false', () => {
  assert.deepStrictEqual(P.gitInfo(tmpDir('nogit')), { is_repo: false });
});

test('gitInfo 在真实仓库上返回分支、提交数、日期与短 sha', t => {
  const d = tmpDir('git');
  const g = args => execFileSync('git', args, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    g(['init', '-q']);
  } catch {
    t.skip('git 不可用');
    return;
  }
  g(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', 'init']);
  const info = P.gitInfo(d);
  assert.strictEqual(info.is_repo, true);
  assert.strictEqual(info.commit_count, 1);
  assert.match(info.last_commit, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(info.first_commit, info.last_commit);
  assert.match(info.head, /^[0-9a-f]{7,}$/);
  assert.ok(typeof info.branch === 'string' && info.branch.length > 0);
  // macOS 的 tmp 目录本身是符号链接，比较前先 realpath
  assert.ok(typeof info.toplevel === 'string' && info.toplevel.length > 0);
  assert.strictEqual(path.resolve(info.toplevel), fs.realpathSync(d));
  assert.strictEqual(info.contributors, 1);
  assert.strictEqual(info.remote, undefined);
});

test('sessionInfo 找到会话目录时报数量与 curator 状态', () => {
  const projects = tmpDir('projects');
  const root = tmpDir('proj');
  const sdir = path.join(projects, slugify(root));
  fs.mkdirSync(sdir);
  touch(sdir, 'a.jsonl', '{}\n');
  touch(sdir, 'b.jsonl', '{}\n');
  touch(sdir, 'context-curator/queue.jsonl',
    JSON.stringify({ session_id: 'a', status: 'pending' }) + '\n' +
    JSON.stringify({ session_id: 'b', status: 'done' }) + '\n');
  const s = P.sessionInfo(root, projects);
  assert.deepStrictEqual(s, { dir: sdir, count: 2, curator: { initialized_at: null, pending: 1, done: 1 } });
});

test('sessionInfo 找不到会话目录返回 dir null', () => {
  assert.deepStrictEqual(P.sessionInfo(tmpDir('proj'), tmpDir('projects')), { dir: null, count: 0 });
});

test('profileProject 组装全部字段', () => {
  const projects = tmpDir('projects');
  const root = tmpDir('proj');
  touch(root, 'pubspec.yaml', 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n');
  touch(root, 'lib/main.dart');
  touch(root, 'CLAUDE.md', 'hi\n');
  const sdir = path.join(projects, slugify(root));
  fs.mkdirSync(path.join(sdir, 'memory'), { recursive: true });
  touch(sdir, 's.jsonl', '{}\n');
  const p = P.profileProject(root, { projectsRoot: projects });
  assert.strictEqual(p.root, root);
  assert.match(p.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.strictEqual(p.truncated, false);
  assert.strictEqual(p.manifests[0].name, 'demo');
  assert.deepStrictEqual(p.languages, [{ name: 'Dart', files: 1 }]);
  assert.deepStrictEqual(p.entrypoints, ['lib/main.dart']);
  assert.ok(p.suggested_commands.some(c => c.cmd === 'flutter test'));
  assert.strictEqual(p.context_assets['CLAUDE.md'].exists, true);
  assert.deepStrictEqual(p.context_assets.memory, { dir: path.join(sdir, 'memory'), files: [] });
  assert.strictEqual(p.sessions.count, 1);
  assert.ok('is_repo' in p.git);
  assert.ok(Array.isArray(p.tooling.tests));
});

test('profileProject 根目录不存在返回 null', () => {
  assert.strictEqual(P.profileProject(path.join(tmpDir('x'), 'nope'), { projectsRoot: tmpDir('p') }), null);
});
