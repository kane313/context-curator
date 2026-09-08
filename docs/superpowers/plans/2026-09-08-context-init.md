# context-init 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 context-curator 插件加一个 `context-init` skill：从 PRD + 本地源码 + 历史会话初始化项目上下文资产（薄 `CLAUDE.md` + `docs/context/*.md`），只新增不覆盖，每段带出处。

**Architecture:** 新增独立 skill 目录 `skills/context-init/`（只有 SKILL.md 与五份模板）；新增零 token 的项目探测脚本放进 `skills/context-curator/`（`lib/manifests.js`、`lib/walk.js`、`lib/profile.js`、`bin/profile-project.js`），会话挖掘复用现有 `harvest.js` 与 `paths.js`；`state.js` 加 `init-done` 子命令记录 `initialized_at`。写入资产的动作只由 SKILL 主体（Claude 的 Write 工具）完成，脚本只读项目、只输出 JSON。

**Tech Stack:** Node 18+ 内置模块（`node:fs` / `node:path` / `node:child_process`），`node:test`，Markdown skill 文档。零 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-09-08-context-init-design.md`

## Global Constraints

- 只用 Node 内置模块，零 npm 依赖；Node 18 或更高。
- 测试用无参 `node --test`（在 `skills/context-curator/` 下跑）；`test/` 下所有 `.js` 都会被当测试文件加载，`test/helpers.js` 不得有顶层副作用。
- `skills/context-curator/` 必须保持自包含：`SKILL.md` 与它调用的所有脚本都在这个目录里。
- `skills/context-init/` 只放 `SKILL.md` 与 `templates/`，不放任何脚本；它通过探测找到 `skills/context-curator/` 复用脚本。
- 没有任何脚本有能力写 `CLAUDE.md`、`docs/`、memory。新增的 `profile-project.js` 只读项目、只输出 JSON，任何失败都 `exit 0` 并输出 `{}`。
- `state.js` 用退出码表达语义（是公共约束的明确例外），新子命令沿用。
- 模板文件不叫 `CLAUDE.md`，统一 `*.template.md`，避免被当成真资产加载。
- 所有代码注释、SKILL.md、命令、文档用中文；技术标识符保持原样。
- 每次 commit message 末尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 工作分支 `feat/context-init`（已建）。

---

## 文件结构

新增：

| 文件 | 职责 |
|---|---|
| `skills/context-curator/lib/manifests.js` | 解析根目录 manifest（package.json / pubspec.yaml / go.mod / pyproject.toml / Cargo.toml / pom.xml / gradle）并推断命令 |
| `skills/context-curator/lib/walk.js` | 一次遍历得到语言分布、顶层目录树、截断标记；入口文件识别 |
| `skills/context-curator/lib/profile.js` | 工具链探测、已有上下文资产清单、git 摘要、会话摘要、总编排 `profileProject` |
| `skills/context-curator/bin/profile-project.js` | CLI：`node profile-project.js [根目录] [--pretty]` |
| `skills/context-curator/test/manifests.test.js` | manifest 解析与命令推断用例 |
| `skills/context-curator/test/walk.test.js` | 遍历、忽略目录、截断、入口识别用例 |
| `skills/context-curator/test/profile.test.js` | 工具链、资产清单、git、会话、总编排用例 |
| `skills/context-init/SKILL.md` | 初始化流程主体 |
| `skills/context-init/templates/claude.template.md` | CLAUDE.md 模板 |
| `skills/context-init/templates/product.template.md` | product.md 模板 |
| `skills/context-init/templates/architecture.template.md` | architecture.md 模板 |
| `skills/context-init/templates/decisions.template.md` | decisions.md 模板 |
| `skills/context-init/templates/glossary.template.md` | glossary.md 模板 |
| `commands/init.md` | `/context-curator:init` 命令 |

修改：

| 文件 | 改动 |
|---|---|
| `skills/context-curator/lib/store.js` | + `markInitialized(ccDir)` |
| `skills/context-curator/bin/state.js` | + `init-done <CC>` 子命令 |
| `skills/context-curator/test/store.test.js` | + 1 用例 |
| `skills/context-curator/test/bins.test.js` | + 3 用例 |
| `README.md` | + 「初始化」章节、文件表、Codex 安装两个目录、测试数量 |
| `AGENTS.md` | + 结构约定两条 |
| `.claude-plugin/plugin.json` | version 1.1.0，description 加初始化 |
| `.codex-plugin/plugin.json` | 同上 |
| `.claude-plugin/marketplace.json` | description 加初始化 |
| `docs/superpowers/specs/2026-09-08-context-init-design.md` | git 段补 `head` 字段 |

---

### Task 1: `markInitialized` 与 `state.js init-done`

**Files:**
- Modify: `skills/context-curator/lib/store.js`
- Modify: `skills/context-curator/bin/state.js`
- Test: `skills/context-curator/test/store.test.js`
- Test: `skills/context-curator/test/bins.test.js`

**Interfaces:**
- Consumes: `store.readState(ccDir)`、`store.writeState(ccDir, state)`（已有，`lib/store.js`）
- Produces: `store.markInitialized(ccDir: string): void`，写 `state.json` 的 `initialized_at`（ISO 秒级字符串），不动 `rejected` 与 `queue.jsonl`；CLI `node bin/state.js init-done <CC>` 退出码 0

- [ ] **Step 1: 在 `test/store.test.js` 末尾追加失败用例**

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/context-curator && node --test 2>&1 | grep -E "markInitialized|fail"`
Expected: 该用例 FAIL，报 `S.markInitialized is not a function`

- [ ] **Step 3: 在 `lib/store.js` 的 `markDone` 之后加实现，并导出**

```js
// 初始化流程完成时记时间戳。刻意不动 queue：初始化挖过的会话仍可被结算模式再看一遍，
// 结算第 6 步的资产比对会自然去重。
function markInitialized(ccDir) {
  const state = readState(ccDir);
  state.initialized_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  writeState(ccDir, state);
}
```

`module.exports` 改为：

```js
module.exports = {
  fingerprint, readQueue, appendQueue, hasSession,
  readState, isRejected, reject, markDone, markInitialized,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/context-curator && node --test 2>&1 | tail -8`
Expected: `pass 41`、`fail 0`

- [ ] **Step 5: 在 `test/bins.test.js` 末尾追加 CLI 用例**

```js
test('state init-done 写入 initialized_at', () => {
  const d = tmpDir('cc');
  assert.strictEqual(run(STATE, ['init-done', d]).rc, 0);
  const st = JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8'));
  assert.match(st.initialized_at, /^\d{4}-\d{2}-\d{2}T/);
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd skills/context-curator && node --test 2>&1 | grep -E "init-done|fail"`
Expected: 该用例 FAIL（`state.js` 对未知子命令退出 2，断言 `rc === 0` 不成立）

- [ ] **Step 7: 在 `bin/state.js` 的 `case 'done'` 之后加子命令**

```js
  case 'init-done':
    S.markInitialized(a);
    process.exit(0);
    break;
```

并把用法提示改为：

```js
    process.stderr.write('用法: state.js {fingerprint|reject|is-rejected|done|init-done} ...\n');
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd skills/context-curator && node --test 2>&1 | tail -8`
Expected: `pass 42`、`fail 0`

- [ ] **Step 9: Commit**

```bash
git add skills/context-curator/lib/store.js skills/context-curator/bin/state.js skills/context-curator/test/store.test.js skills/context-curator/test/bins.test.js
git commit -m "feat(store): markInitialized 与 state.js init-done 子命令

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `lib/manifests.js` —— manifest 解析与命令推断

**Files:**
- Create: `skills/context-curator/lib/manifests.js`
- Test: `skills/context-curator/test/manifests.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `parsePackageJson(text: string): { file:'package.json', name?, version?, scripts?, dependencies:string[], dev_dependencies:string[], package_manager?:'npm'|'pnpm'|'yarn'|'bun', main?:string, bin?:string[] }`
  - `parsePubspec(text: string): { file:'pubspec.yaml', name?, version?, sdk?, dependencies:string[], dev_dependencies:string[], flutter:boolean }`
  - `parseManifests(root: string): object[]`（每项都有 `file`）
  - `suggestCommands(manifests: object[]): { kind:'test'|'build'|'run'|'lint', cmd:string, source:string }[]`

- [ ] **Step 1: 写 `test/manifests.test.js`**

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/context-curator && node --test 2>&1 | grep -E "manifests|Cannot find module"`
Expected: 报 `Cannot find module '../lib/manifests'`

- [ ] **Step 3: 写 `lib/manifests.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 只做能用 JSON.parse、缩进扫描或正则稳妥拿到的字段。解析失败只丢字段，不丢整条。

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function keysOf(obj, max = 60) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.keys(obj).slice(0, max);
}

function first(re, text) {
  const m = re.exec(text);
  return m ? m[1] : undefined;
}

function unquote(s) {
  return String(s).replace(/^['"]|['"]$/g, '');
}

function parsePackageJson(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { file: 'package.json' };
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { file: 'package.json' };
  const out = { file: 'package.json' };
  if (typeof j.name === 'string') out.name = j.name;
  if (typeof j.version === 'string') out.version = j.version;
  if (j.scripts && typeof j.scripts === 'object') out.scripts = { ...j.scripts };
  out.dependencies = keysOf(j.dependencies);
  out.dev_dependencies = keysOf(j.devDependencies);
  if (typeof j.packageManager === 'string') out.package_manager = j.packageManager.split('@')[0];
  if (typeof j.main === 'string') out.main = j.main;
  if (typeof j.bin === 'string') out.bin = [j.bin];
  else if (j.bin && typeof j.bin === 'object') out.bin = Object.values(j.bin).filter(v => typeof v === 'string');
  return out;
}

// 取顶层 section 下缩进一级的 key/value。不是完整 YAML 解析：
// 更深的嵌套（如 flutter:\n    sdk: flutter）按缩进跳过，列表项没有冒号自然不匹配。
function yamlSection(text, section) {
  const out = [];
  let inSection = false;
  let indent = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const top = /^([A-Za-z0-9_]+):/.exec(line);
    if (top) {
      inSection = top[1] === section;
      indent = null;
      continue;
    }
    if (!inSection) continue;
    const m = /^(\s+)([^\s:#][^:]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (indent === null) indent = m[1].length;
    if (m[1].length !== indent) continue;
    out.push({ key: m[2], value: unquote(m[3]) });
  }
  return out;
}

function yamlTop(text, key) {
  const v = first(new RegExp('^' + key + ':[ \\t]*(.+?)[ \\t]*$', 'm'), text);
  return v === undefined ? undefined : unquote(v);
}

function parsePubspec(text) {
  const out = { file: 'pubspec.yaml' };
  const name = yamlTop(text, 'name');
  if (name) out.name = name;
  const version = yamlTop(text, 'version');
  if (version) out.version = version;
  const sdk = yamlSection(text, 'environment').find(e => e.key === 'sdk');
  if (sdk) out.sdk = sdk.value;
  out.dependencies = yamlSection(text, 'dependencies').map(e => e.key);
  out.dev_dependencies = yamlSection(text, 'dev_dependencies').map(e => e.key);
  out.flutter = out.dependencies.includes('flutter');
  return out;
}

const GRADLE = t => ({ application_id: first(/applicationId\s*=?\s*["']([^"']+)["']/, t) });

// [文件, 解析器]。解析器返回的 undefined / false 字段会被丢掉。
const OTHER = [
  ['go.mod', t => ({ module: first(/^module\s+(\S+)/m, t), go: first(/^go\s+(\S+)/m, t) })],
  ['pyproject.toml', t => ({
    name: first(/^name\s*=\s*["']([^"']+)["']/m, t),
    version: first(/^version\s*=\s*["']([^"']+)["']/m, t),
    pytest: /\[tool\.pytest|["']pytest/.test(t),
  })],
  ['Cargo.toml', t => ({
    name: first(/^name\s*=\s*["']([^"']+)["']/m, t),
    version: first(/^version\s*=\s*["']([^"']+)["']/m, t),
  })],
  ['pom.xml', t => ({
    group_id: first(/<groupId>([^<]+)<\/groupId>/, t),
    artifact_id: first(/<artifactId>([^<]+)<\/artifactId>/, t),
  })],
  ['build.gradle.kts', GRADLE],
  ['build.gradle', GRADLE],
  ['android/app/build.gradle.kts', GRADLE],
  ['android/app/build.gradle', GRADLE],
  ['requirements.txt', () => ({})],
  ['Gemfile', () => ({})],
  ['composer.json', () => ({})],
  ['Package.swift', () => ({})],
  ['Makefile', () => ({})],
  ['CMakeLists.txt', () => ({})],
];

function parseManifests(root) {
  const out = [];
  const pj = readText(path.join(root, 'package.json'));
  if (pj !== null) out.push(parsePackageJson(pj));
  const ps = readText(path.join(root, 'pubspec.yaml'));
  if (ps !== null) out.push(parsePubspec(ps));
  for (const [file, parse] of OTHER) {
    const t = readText(path.join(root, ...file.split('/')));
    if (t === null) continue;
    const info = { file };
    let extra = {};
    try {
      extra = parse(t) || {};
    } catch {
      extra = {};
    }
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== false) info[k] = v;
    }
    out.push(info);
  }
  return out;
}

// 规则表，每条带 source，让下游能说清「这条命令是从哪推出来的」。
function suggestCommands(manifests) {
  const out = [];
  const add = (kind, cmd, source) => out.push({ kind, cmd, source });
  for (const m of manifests) {
    if (m.file === 'package.json') {
      const pm = ['pnpm', 'yarn', 'bun'].includes(m.package_manager) ? m.package_manager : 'npm';
      const wanted = { test: ['test'], build: ['build'], run: ['dev', 'start'], lint: ['lint'] };
      for (const [kind, names] of Object.entries(wanted)) {
        const s = names.find(n => m.scripts && m.scripts[n]);
        if (s) add(kind, `${pm} run ${s}`, `package.json scripts.${s}`);
      }
    } else if (m.file === 'pubspec.yaml') {
      if (m.flutter) {
        add('test', 'flutter test', 'pubspec.yaml: 依赖 flutter');
        add('run', 'flutter run', 'pubspec.yaml: 依赖 flutter');
        add('lint', 'dart analyze', 'pubspec.yaml: 依赖 flutter');
      } else {
        add('test', 'dart test', 'pubspec.yaml');
        add('lint', 'dart analyze', 'pubspec.yaml');
      }
    } else if (m.file === 'go.mod') {
      add('test', 'go test ./...', 'go.mod');
      add('build', 'go build ./...', 'go.mod');
    } else if (m.file === 'Cargo.toml') {
      add('test', 'cargo test', 'Cargo.toml');
      add('build', 'cargo build', 'Cargo.toml');
    } else if (m.file === 'pyproject.toml' && m.pytest) {
      add('test', 'pytest', 'pyproject.toml: 出现 pytest');
    }
  }
  return out;
}

module.exports = { parsePackageJson, parsePubspec, parseManifests, suggestCommands };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/context-curator && node --test 2>&1 | tail -8`
Expected: `pass 50`、`fail 0`

- [ ] **Step 5: Commit**

```bash
git add skills/context-curator/lib/manifests.js skills/context-curator/test/manifests.test.js
git commit -m "feat(profile): manifest 解析与命令推断

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `lib/walk.js` —— 遍历统计与入口识别

**Files:**
- Create: `skills/context-curator/lib/walk.js`
- Test: `skills/context-curator/test/walk.test.js`

**Interfaces:**
- Consumes: `parsePackageJson` 产出的 `{ file:'package.json', main?, bin? }`（Task 2）
- Produces:
  - `walk(root: string, opts?: { maxFiles?: number }): { languages: {name:string, files:number}[], tree: ({name, type:'dir', files:number, children:string[]} | {name, type:'file'})[], truncated: boolean }`
  - `detectEntrypoints(root: string, manifests?: object[]): string[]`（相对路径，`/` 分隔）
  - `IGNORED: Set<string>`

- [ ] **Step 1: 写 `test/walk.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('./helpers');
const { walk, detectEntrypoints, IGNORED } = require('../lib/walk');

function touch(root, rel, content = '') {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/context-curator && node --test 2>&1 | grep -E "walk|Cannot find module"`
Expected: 报 `Cannot find module '../lib/walk'`

- [ ] **Step 3: 写 `lib/walk.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 固定清单，不解析 .gitignore。
const IGNORED = new Set([
  '.git', 'node_modules', 'build', 'dist', 'out', 'target', '.dart_tool', '.idea', '.vscode',
  '.gradle', '.next', '.nuxt', 'coverage', '__pycache__', '.venv', 'venv', 'Pods', 'DerivedData',
  '.pub-cache', 'vendor', '.cache', 'tmp', '.tmp', 'ephemeral',
]);

const LANG = {
  '.dart': 'Dart',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java',
  '.kt': 'Kotlin', '.kts': 'Kotlin', '.swift': 'Swift',
  '.m': 'Objective-C', '.mm': 'Objective-C',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#',
  '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++',
  '.vue': 'Vue', '.scala': 'Scala', '.sh': 'Shell', '.lua': 'Lua',
};

const DEFAULT_MAX_FILES = 20000;
const MAX_CHILDREN = 30;

function readDirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// 点开头的目录与文件（.github、.claude、.env）一律不进统计——上下文资产与 CI 由 profile.js 单独探测。
function skip(name) {
  return name.startsWith('.') || IGNORED.has(name);
}

// 一次遍历同时得到语言分布、顶层树与截断标记。按扩展名计文件数，不数行。
function walk(root, opts = {}) {
  const maxFiles = opts.maxFiles || DEFAULT_MAX_FILES;
  const top = readDirents(root);
  if (!top) return { languages: [], tree: [], truncated: false };

  const langCount = {};
  let total = 0;
  let truncated = false;

  function countFile(name) {
    total++;
    if (total >= maxFiles) truncated = true;
    const lang = LANG[path.extname(name).toLowerCase()];
    if (lang) langCount[lang] = (langCount[lang] || 0) + 1;
  }

  function countDir(dir) {
    let n = 0;
    const es = readDirents(dir) || [];
    for (const e of es) {
      if (truncated) break;
      if (skip(e.name)) continue;
      if (e.isDirectory()) n += countDir(path.join(dir, e.name));
      else if (e.isFile()) {
        n++;
        countFile(e.name);
      }
    }
    return n;
  }

  const tree = [];
  for (const e of top.sort((a, b) => a.name.localeCompare(b.name))) {
    if (skip(e.name)) continue;
    if (e.isDirectory()) {
      const full = path.join(root, e.name);
      const children = (readDirents(full) || [])
        .filter(c => c.isDirectory() && !skip(c.name))
        .map(c => c.name)
        .sort()
        .slice(0, MAX_CHILDREN);
      tree.push({ name: e.name, type: 'dir', files: countDir(full), children });
    } else if (e.isFile()) {
      countFile(e.name);
      tree.push({ name: e.name, type: 'file' });
    }
  }

  const languages = Object.entries(langCount)
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  return { languages, tree, truncated };
}

const ENTRY_CANDIDATES = [
  'lib/main.dart', 'main.go', 'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
  'src/main.tsx', 'index.js', 'app.py', 'main.py', 'manage.py', 'src/main.rs',
];

function exists(root, rel) {
  try {
    return fs.existsSync(path.join(root, ...rel.split('/')));
  } catch {
    return false;
  }
}

function norm(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
}

// 固定候选清单的存在性检查，不猜。
function detectEntrypoints(root, manifests = []) {
  const out = new Set();
  for (const rel of ENTRY_CANDIDATES) if (exists(root, rel)) out.add(rel);
  for (const e of readDirents(path.join(root, 'bin')) || []) {
    if (e.isFile() && /\.(dart|js)$/.test(e.name)) out.add('bin/' + e.name);
  }
  for (const e of readDirents(path.join(root, 'cmd')) || []) {
    if (e.isDirectory() && exists(root, `cmd/${e.name}/main.go`)) out.add(`cmd/${e.name}/main.go`);
  }
  for (const m of manifests) {
    if (m.file !== 'package.json') continue;
    if (m.main && exists(root, norm(m.main))) out.add(norm(m.main));
    for (const b of m.bin || []) if (exists(root, norm(b))) out.add(norm(b));
  }
  return [...out];
}

module.exports = { walk, detectEntrypoints, IGNORED };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/context-curator && node --test 2>&1 | tail -8`
Expected: `pass 58`、`fail 0`

- [ ] **Step 5: Commit**

```bash
git add skills/context-curator/lib/walk.js skills/context-curator/test/walk.test.js
git commit -m "feat(profile): 目录遍历统计与入口识别

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `lib/profile.js` 与 `bin/profile-project.js`

**Files:**
- Create: `skills/context-curator/lib/profile.js`
- Create: `skills/context-curator/bin/profile-project.js`
- Test: `skills/context-curator/test/profile.test.js`
- Test: `skills/context-curator/test/bins.test.js`
- Modify: `docs/superpowers/specs/2026-09-08-context-init-design.md`（git 段补 `head`）

**Interfaces:**
- Consumes: `parseManifests`、`suggestCommands`（Task 2）；`walk`、`detectEntrypoints`（Task 3）；`paths.findProjectDir(cwd, root?)`、`paths.curatorDir(dir)`（已有）；`store.readState`、`store.readQueue`（已有）
- Produces:
  - `detectTooling(root): { tests:string[], ci:string[], lint:string[], docker:string[], env_example:string[] }`
  - `contextAssets(root, sessionDir: string|null): { 'CLAUDE.md':{exists,lines?}, 'AGENTS.md':{...}, 'README.md':{...}, docs:string[], claude_dir:{rules,skills,commands,settings}, other_ai_rules:string[], memory:{dir:string|null, files:string[]} }`
  - `gitInfo(root): { is_repo:false } | { is_repo:true, branch?, remote?, head?, commit_count?, first_commit?, last_commit?, contributors? }`
  - `sessionInfo(root, projectsRoot?): { dir:string|null, count:number, curator?:{initialized_at, pending, done} }`
  - `profileProject(root, opts?: { maxFiles?, projectsRoot? }): object | null`（spec §6 的 JSON；根目录不存在返回 `null`）
  - CLI：`node bin/profile-project.js [根目录] [--pretty]`，永远 exit 0，失败输出 `{}`；尊重 `CLAUDE_CONFIG_DIR`

- [ ] **Step 1: 写 `test/profile.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir } = require('./helpers');
const { slugify } = require('../lib/paths');
const P = require('../lib/profile');

function touch(root, rel, content = '') {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

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

test('contextAssets 报行数、docs 两层递归、.claude 子目录与其他 AI 规则文件', () => {
  const d = tmpDir('assets');
  touch(d, 'CLAUDE.md', 'a\nb\nc\n');
  touch(d, 'README.md', 'x\n');
  touch(d, 'docs/a.md');
  touch(d, 'docs/sub/b.md');
  touch(d, 'docs/sub/deep/c.md');
  touch(d, 'docs/sub/deep/deeper/d.md');
  touch(d, 'docs/notes.txt');
  touch(d, '.claude/rules/r1.md');
  touch(d, '.claude/settings.json', '{}');
  touch(d, '.cursorrules');
  const sessionDir = tmpDir('sess');
  touch(sessionDir, 'memory/MEMORY.md', '');
  const a = P.contextAssets(d, sessionDir);
  assert.deepStrictEqual(a['CLAUDE.md'], { exists: true, lines: 4 });
  assert.deepStrictEqual(a['AGENTS.md'], { exists: false });
  assert.deepStrictEqual(a['README.md'], { exists: true, lines: 2 });
  assert.deepStrictEqual(a.docs, ['docs/a.md', 'docs/sub/b.md', 'docs/sub/deep/c.md']);
  assert.deepStrictEqual(a.claude_dir, { rules: ['r1.md'], skills: [], commands: [], settings: true });
  assert.deepStrictEqual(a.other_ai_rules, ['.cursorrules']);
  assert.deepStrictEqual(a.memory, { dir: path.join(sessionDir, 'memory'), files: ['MEMORY.md'] });
});

test('contextAssets 没有会话目录时 memory.dir 为 null', () => {
  const a = P.contextAssets(tmpDir('a'), null);
  assert.deepStrictEqual(a.memory, { dir: null, files: [] });
  assert.deepStrictEqual(a.docs, []);
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
  g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const info = P.gitInfo(d);
  assert.strictEqual(info.is_repo, true);
  assert.strictEqual(info.commit_count, 1);
  assert.match(info.last_commit, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(info.first_commit, info.last_commit);
  assert.match(info.head, /^[0-9a-f]{7,}$/);
  assert.ok(typeof info.branch === 'string' && info.branch.length > 0);
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/context-curator && node --test 2>&1 | grep -E "profile|Cannot find module"`
Expected: 报 `Cannot find module '../lib/profile'`

- [ ] **Step 3: 写 `lib/profile.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const paths = require('./paths');
const store = require('./store');
const { parseManifests, suggestCommands } = require('./manifests');
const { walk, detectEntrypoints } = require('./walk');

// 项目探测：只读项目，只输出事实。这里没有任何写文件的能力，也不该有。

function existsRel(root, rel) {
  try {
    return fs.existsSync(path.join(root, ...rel.split('/')));
  } catch {
    return false;
  }
}

function listNames(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function lineCount(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').length;
  } catch {
    return null;
  }
}

const TOOLING = {
  tests: ['test', 'tests', '__tests__', 'spec', 'integration_test', 'test_driver'],
  ci: ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci', 'azure-pipelines.yml',
    'bitbucket-pipelines.yml', 'codemagic.yaml'],
  lint: ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs',
    '.prettierrc', '.prettierrc.json', 'biome.json', 'tsconfig.json', 'analysis_options.yaml', '.editorconfig',
    'ruff.toml', '.flake8', 'setup.cfg', '.golangci.yml', 'rustfmt.toml', '.swiftlint.yml', 'detekt.yml'],
  docker: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yaml'],
  env_example: ['.env.example', '.env.sample', '.env.template'],
};

function detectTooling(root) {
  const out = {};
  for (const [kind, cands] of Object.entries(TOOLING)) {
    out[kind] = cands.filter(c => existsRel(root, c)).map(c => (kind === 'tests' ? c + '/' : c));
  }
  // .github/workflows 展开成具体文件，让下游能直接引用
  const wf = path.join(root, '.github', 'workflows');
  if (out.ci.includes('.github/workflows')) {
    out.ci = out.ci.filter(c => c !== '.github/workflows')
      .concat(listNames(wf).filter(f => /\.ya?ml$/.test(f)).map(f => '.github/workflows/' + f));
  }
  return out;
}

// 递归收集 md 文件。depth 是还能往下走的目录层数。
function mdFilesUnder(dir, rel, depth, out, max) {
  if (depth < 0 || out.length >= max) return;
  for (const name of listNames(dir)) {
    if (out.length >= max) return;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) mdFilesUnder(full, rel + name + '/', depth - 1, out, max);
    else if (/\.md$/i.test(name)) out.push(rel + name);
  }
}

const OTHER_AI_RULES = ['.cursorrules', '.cursor/rules', '.github/copilot-instructions.md', '.windsurfrules', 'GEMINI.md'];

function contextAssets(root, sessionDir) {
  const fileInfo = f => {
    const p = path.join(root, f);
    return fs.existsSync(p) ? { exists: true, lines: lineCount(p) } : { exists: false };
  };
  const docs = [];
  mdFilesUnder(path.join(root, 'docs'), 'docs/', 2, docs, 50);
  const cd = path.join(root, '.claude');
  const claude_dir = {
    rules: listNames(path.join(cd, 'rules')),
    skills: listNames(path.join(cd, 'skills')),
    commands: listNames(path.join(cd, 'commands')),
    settings: fs.existsSync(path.join(cd, 'settings.json')),
  };
  const memDir = sessionDir ? path.join(sessionDir, 'memory') : null;
  return {
    'CLAUDE.md': fileInfo('CLAUDE.md'),
    'AGENTS.md': fileInfo('AGENTS.md'),
    'README.md': fileInfo('README.md'),
    docs,
    claude_dir,
    other_ai_rules: OTHER_AI_RULES.filter(f => existsRel(root, f)),
    memory: { dir: memDir, files: memDir ? listNames(memDir) : [] },
  };
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// git 不可用、不是仓库、任何子命令失败，都只是少几个字段。
function gitInfo(root) {
  try {
    if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return { is_repo: false };
  } catch {
    return { is_repo: false };
  }
  const out = { is_repo: true };
  const grab = (key, args, map) => {
    try {
      const v = git(root, args);
      if (v) out[key] = map ? map(v) : v;
    } catch {
      // 该字段缺失即可
    }
  };
  grab('branch', ['rev-parse', '--abbrev-ref', 'HEAD']);
  grab('remote', ['remote', 'get-url', 'origin']);
  grab('head', ['rev-parse', '--short', 'HEAD']);
  grab('commit_count', ['rev-list', '--count', 'HEAD'], Number);
  grab('last_commit', ['log', '-1', '--format=%as']);
  try {
    const rootSha = git(root, ['rev-list', '--max-parents=0', 'HEAD']).split('\n')[0];
    if (rootSha) grab('first_commit', ['log', '-1', '--format=%as', rootSha]);
  } catch {
    // 同上
  }
  grab('contributors', ['shortlog', '-sn', 'HEAD'], v => v.split('\n').filter(Boolean).length);
  return out;
}

function sessionInfo(root, projectsRoot) {
  const dir = paths.findProjectDir(root, projectsRoot);
  if (!dir) return { dir: null, count: 0 };
  const count = listNames(dir).filter(f => f.endsWith('.jsonl')).length;
  const cc = paths.curatorDir(dir);
  const state = store.readState(cc);
  const q = store.readQueue(cc);
  return {
    dir,
    count,
    curator: {
      initialized_at: state.initialized_at || null,
      pending: q.filter(x => x.status === 'pending').length,
      done: q.filter(x => x.status === 'done').length,
    },
  };
}

function profileProject(root, opts = {}) {
  const abs = path.resolve(root);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;

  const manifests = parseManifests(abs);
  const { languages, tree, truncated } = walk(abs, { maxFiles: opts.maxFiles });
  const sessions = sessionInfo(abs, opts.projectsRoot);
  return {
    root: abs,
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    truncated,
    git: gitInfo(abs),
    manifests,
    languages,
    tree,
    entrypoints: detectEntrypoints(abs, manifests),
    suggested_commands: suggestCommands(manifests),
    tooling: detectTooling(abs),
    context_assets: contextAssets(abs, sessions.dir),
    sessions,
  };
}

module.exports = { detectTooling, contextAssets, gitInfo, sessionInfo, profileProject };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/context-curator && node --test 2>&1 | tail -8`
Expected: `pass 68`、`fail 0`

- [ ] **Step 5: 在 `test/bins.test.js` 顶部常量区加 `PROFILE`，末尾追加 CLI 用例**

顶部 `const STATE = ...` 之后加：

```js
const PROFILE = path.join(__dirname, '..', 'bin', 'profile-project.js');
```

末尾加：

```js
test('profile-project 目录不存在退出 0 且输出 {}', () => {
  const r = run(PROFILE, [path.join(tmpDir('x'), 'nope')], { env: { ...process.env, CLAUDE_CONFIG_DIR: tmpDir('cfg') } });
  assert.strictEqual(r.rc, 0);
  assert.strictEqual(r.out.trim(), '{}');
});

test('profile-project --pretty 输出多行 JSON 且带 root 与 manifest', () => {
  const d = tmpDir('p');
  fs.writeFileSync(path.join(d, 'go.mod'), 'module x\n\ngo 1.22\n');
  const r = run(PROFILE, [d, '--pretty'], { env: { ...process.env, CLAUDE_CONFIG_DIR: tmpDir('cfg') } });
  assert.strictEqual(r.rc, 0);
  assert.ok(r.out.includes('\n  "root"'));
  const j = JSON.parse(r.out);
  assert.strictEqual(j.root, d);
  assert.strictEqual(j.manifests[0].module, 'x');
  assert.deepStrictEqual(j.sessions, { dir: null, count: 0 });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd skills/context-curator && node --test 2>&1 | grep -E "profile-project|fail"`
Expected: 两个用例 FAIL（脚本不存在，`rc` 非 0）

- [ ] **Step 7: 写 `bin/profile-project.js`**

```js
#!/usr/bin/env node
'use strict';
// context-curator —— 项目探测 CLI，供 context-init skill 调用。
// 只读项目、只输出 JSON。任何失败都退出 0 并输出 {}，不中断 skill 流程。
// 用法：node profile-project.js [项目根目录] [--pretty]

function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes('--pretty');
  const root = args.find(a => !a.startsWith('--')) || process.cwd();
  const { profileProject } = require('../lib/profile');
  const profile = profileProject(root) || {};
  process.stdout.write(JSON.stringify(profile, null, pretty ? 2 : 0) + '\n');
}

try {
  main();
} catch {
  try {
    process.stdout.write('{}\n');
  } catch {
    // 连输出都失败就算了
  }
}
process.exit(0);
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd skills/context-curator && node --test 2>&1 | tail -8`
Expected: `pass 70`、`fail 0`

- [ ] **Step 9: 在本仓库上实跑一次，肉眼核对输出**

Run: `cd skills/context-curator && node bin/profile-project.js ../.. --pretty | head -60`
Expected: `root` 是仓库绝对路径；`git.is_repo` 为 true、`branch` 为 `feat/context-init`；`languages` 首项 JavaScript；`tree` 含 `skills`、`commands`、`hooks`、`docs`；`context_assets['AGENTS.md'].exists` 为 true、`README.md` 有行数；`sessions.count ≥ 1`。

- [ ] **Step 10: spec 的 git 段补 `head` 字段**

把 `docs/superpowers/specs/2026-09-08-context-init-design.md` 里

```
    "is_repo": true, "branch": "main", "remote": "git@...",
```

改为

```
    "is_repo": true, "branch": "main", "remote": "git@...", "head": "abc1234",
```

- [ ] **Step 11: Commit**

```bash
git add skills/context-curator/lib/profile.js skills/context-curator/bin/profile-project.js skills/context-curator/test/profile.test.js skills/context-curator/test/bins.test.js docs/superpowers/specs/2026-09-08-context-init-design.md
git commit -m "feat(profile): 项目探测总编排与 profile-project CLI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `skills/context-init/SKILL.md` 与五份模板

**Files:**
- Create: `skills/context-init/SKILL.md`
- Create: `skills/context-init/templates/claude.template.md`
- Create: `skills/context-init/templates/product.template.md`
- Create: `skills/context-init/templates/architecture.template.md`
- Create: `skills/context-init/templates/decisions.template.md`
- Create: `skills/context-init/templates/glossary.template.md`

**Interfaces:**
- Consumes: `node "$CCH"/bin/profile-project.js <root> --pretty`（Task 4）；`node "$CCH"/bin/harvest.js <sessions.dir> --min-score 5`（已有）；`node "$CCH"/bin/state.js init-done <CC>`（Task 1）；`lib/paths.js` 的 `curatorDir`（已有）
- Produces: 可被 Claude Code / Codex 自动发现的 skill（`skills/context-init/SKILL.md`），以及 `commands/init.md`（Task 6）引用的流程

- [ ] **Step 1: 写 `skills/context-init/SKILL.md`**

```markdown
---
name: context-init
description: Use when the user wants to bootstrap context assets for a local project from scratch — triggers on "初始化上下文", "初始化项目上下文资产", "接手这个项目", "从 PRD 建 CLAUDE.md", "给这个项目建 CLAUDE.md", "bootstrap context", "init context assets", or when a project has no CLAUDE.md and the user hands over a PRD. Reads the PRD, the local source code and the project's past session transcripts, then generates a thin CLAUDE.md plus docs/context/ fact documents. Only creates new files, never overwrites; every statement cites PRD section, code path or session line.
---

# 初始化项目上下文资产

从三个信息源（用户给的 PRD、本地源码、该项目的历史会话）为一个项目**首次**建立上下文资产：一份薄 `CLAUDE.md` 加 `docs/context/` 下几份事实文档，必要时补 memory。

与 `context-curator` skill 的分工：那个是持续养护（攒几个会话跑一次，对已有资产提逐条改动建议）；这个是首次接手（一次生成整份新文件）。初始化完成后交给 `/curate` 持续更新。

## 铁律

1. **不覆盖任何已有文件。** 目标路径已存在就跳过并写进报告，一个字不改。
2. **无出处不写。** 每一段、每一条都要能指到三者之一：PRD 章节、代码路径、会话文件 + 行号。指不到就不写。唯一例外是 `CLAUDE.md` 项目声明里实在填不出的字段，写「待定」并列进报告。
3. **事实与规则分层。** PRD 与代码的事实进 `docs/context/`；只有用户原话（会话）或配置文件（lint、analysis_options 等）能证明的约束才进 `CLAUDE.md`。

## 参数

```
[PRD路径] [--dry-run] [--sessions N]
```

- `PRD路径`：可选。本地 `.md` / `.txt` / `.pdf`。不给就问一次「有 PRD 吗？给路径或直接贴」；用户说没有就跳过 PRD。
- `--dry-run`：只探测、只分析、把每个将写入文件的完整内容打印出来，不写盘。
- `--sessions N`：精读的会话数上限，默认 10。

给的是飞书 / Lark / 其他 URL 时：告诉用户先导出成本地文件，或用已装的文档读取 skill（lark-doc、feishu-docs）读成本地 md 再来。**本 skill 不自动调用其他插件。** 本次停止。

## 执行步骤

### 第 0 步：定位脚本目录

本 skill 自己不带脚本，用的是同插件里 `context-curator` skill 的脚本。加载本 skill 时环境会告诉你 base directory（形如 `Base directory for this skill: /some/path/skills/context-init`），把它作为参数传给下面的探测命令，输出即 `$CCH`：

```bash
CCH=$(node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const base=process.argv[1]||"";const h=os.homedir(),hit=[];
const push=p=>{try{if(p&&fs.existsSync(path.join(p,"lib","profile.js")))hit.push(path.resolve(p))}catch{}};
push(base&&path.join(base,"..","context-curator"));
push(process.env.CLAUDE_PLUGIN_ROOT&&path.join(process.env.CLAUDE_PLUGIN_ROOT,"skills","context-curator"));
push(process.env.CODEX_PLUGIN_ROOT&&path.join(process.env.CODEX_PLUGIN_ROOT,"skills","context-curator"));
push(path.join(h,".claude","skills","context-curator"));
push(path.join(h,".agents","skills","context-curator"));
const walk=(d,depth)=>{if(depth>4)return;let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}
  for(const e of es){if(!e.isDirectory())continue;const q=path.join(d,e.name);
    push(path.join(q,"skills","context-curator"));walk(q,depth+1)}};
walk(path.join(h,".claude","plugins","cache"),0);
console.log(hit[0]||"")' "<本 skill 的 base directory>")
```

探测不到（输出为空）就告诉用户「context-init 依赖同插件的 context-curator skill，请确认插件完整安装」，然后停止。

### 第 1 步：探测项目

```bash
node "$CCH"/bin/profile-project.js . --pretty
```

输出是一份 JSON，全是确定性事实，拿来就用，不要自己再猜一遍。重点看：

- `context_assets`：哪些目标文件已存在（决定跳过什么）、已有 `docs/` 清单、memory 目录
- `sessions.dir` / `sessions.count`：有没有历史会话可挖
- `manifests` / `suggested_commands` / `entrypoints` / `tree` / `languages`：技术栈、命令、入口、目录
- `git`：分支与短 commit（写进页脚）
- `truncated` 为 true 时在报告里注明「文件数超过两万，语言统计不完整」

输出是 `{}` 或缺 `root` 时降级：主会话自己 `ls` 顶层目录、读 README，报告里标注「探测降级」。

先按 `context_assets` 算出**本次能写的目标**：

| 目标 | 条件 |
|---|---|
| `CLAUDE.md` | `context_assets["CLAUDE.md"].exists` 为 false |
| `docs/context/product.md` | `context_assets.docs` 里没有它，且有 PRD |
| `docs/context/architecture.md` | `context_assets.docs` 里没有它 |
| `docs/context/decisions.md` | `context_assets.docs` 里没有它，且 `sessions.count > 0` |
| `docs/context/glossary.md` | `context_assets.docs` 里没有它 |

全部目标都已存在时，报告「没有可新增的文件」，建议用户跑 `/curate 全量`，然后停止。**不写任何东西。**

### 第 2 步：读入已有资产

按 `context_assets` 清单读：`CLAUDE.md`、`AGENTS.md`、`README.md`、`docs/**/*.md`、`.claude/rules/*.md`、memory 目录下的文件。用途只有两个：避免生成重复内容；让本次生成的 `CLAUDE.md` 指针表指向已有文档而不是再写一份。**不改它们。**

已有 `docs/` 里有同主题文档（比如 `docs/architecture.md`）时，本次对应文件里该小节改为一行指针。

### 第 3 步：读 PRD

用 Read 读文件（pdf 用 `pages` 参数分段）。PRD 不超过 400 行时主会话自己读并摘要；更长时派一个子 agent，指令：

> 读 `<PRD 文件>`，返回结构化摘要 JSON：`{ one_liner, goals:[{text, ref}], users:[{text, ref}], scenarios:[{text, ref}], features:[{name, desc, ref}], rules:[{text, ref}], nfr:[{text, ref}], terms:[{term, definition, ref}] }`。`ref` 写章节号或标题（pdf 写页码）。不要补充 PRD 没写的内容；找不到的字段留空数组。

### 第 4 步：粗筛会话

`sessions.count > 0` 时：

```bash
node "$CCH"/bin/harvest.js "<sessions.dir>" --min-score 5
```

按 score 降序取前 N 个（`--sessions N`，默认 10）。结果为空就跳过会话这一源，报告里说明「历史会话里没有高信号线索」。

### 第 5 步：并行精读

主会话**不读原始 jsonl、不通读源码**，派子 agent，一次性并行发出：

**代码 agent。** 含源码文件的顶层目录（`tree` 里 `files > 0`，排除 `docs`、`test`、`tests`、`integration_test` 这类目录）不超过 3 个时一个 agent，否则按顶层目录分给最多 4 个。指令要点：

> 你在分析项目 `<root>` 的 `<目录清单>`。只读，不改任何文件。
> 已知探测事实：`<manifests、entrypoints、tree 对应片段、suggested_commands>`。
> 任务：
> 1. 从入口文件出发，读该范围内的关键文件（入口、路由或注册表、基类、配置），概括：模块职责、分层与依赖方向、数据流、外部依赖与三方服务。每条结论必须带代码路径。
> 2. 对照这份 PRD 功能清单：`<features 或「无」>`，逐项判断 已实现 / 部分 / 未实现，给代码位置；判不出写「待核实」。另列代码里有但清单没提的功能。
> 3. 观察到的约定：只报在 3 处以上一致出现的模式，或有配置文件（lint、analysis_options）支撑的，附路径。
> 4. 领域术语：类名、表名、枚举里出现的业务名词，附路径。
> 返回 JSON：`{ modules:[{name, path, responsibility, evidence}], layering:[{text, evidence}], data_flow:[{text, evidence}], external_deps:[{name, evidence}], prd_status:[{feature, status, path, note}], extra_features:[{name, path}], conventions:[{rule, evidence}], terms:[{term, identifier, path}] }`。
> 宁缺毋滥：证据指不出来的不要写。

**PRD agent。** 仅当第 3 步判定需要（PRD 超过 400 行）。

**会话 agent。** 每 2-3 个会话一个。指令要点：

> 精读这些会话文件：`<路径 + hits 行号列表>`。它们是 Claude Code 的 jsonl 记录，`hits[].line` 是正则粗筛命中的行号，只是入口，不是结论。
> 读命中行前后 20-40 行的上下文，判断用户是否表达了：决策、踩坑、纠正 AI、约定或禁令、对 AI 工作方式的偏好。
> 返回 JSON 数组，每条 `{ kind: "decision"|"pitfall"|"correction"|"convention"|"user"|"feedback", gist, evidence:{ file, line, quote }, date }`。`quote` 必须是用户原话，`date` 取记录的 `timestamp`。
> 宁缺毋滥：不确定的丢掉；AI 自己说的话不算证据；只对当次对话有意义的临时上下文不要。

### 第 6 步：交叉对照

拿到全部 agent 结果后，在主会话做三件事：

- **功能 ↔ 模块**：合并各代码 agent 的 `prd_status`，同一功能多个 agent 有结论时取有代码位置的那条；都没有就「待核实」。
- **术语 ↔ 标识符**：PRD `terms` 与代码 `terms` 按名词对齐，对不上的两边各自保留单列。
- **会话约定 ↔ 代码现状**：每条会话 `convention` / `decision` 拿去对照代码 agent 的 `conventions` 与 `modules`：仍成立标「仍然成立」，代码已不是这样标「已变化」，对不上标「待核实」。

### 第 7 步：过滤

丢掉这些：

- 读代码就知道的细节（函数签名、字段列表）
- git 历史里已有的记录
- 只对当次对话有意义的临时上下文
- 已有资产里已经写了的内容
- 没有出处的任何一条

### 第 8 步：生成与写入

按 `templates/` 下的模板组装，模板路径是本 skill base directory 下的 `templates/*.template.md`。模板里 `{…}` 是占位、括号里的斜体说明是给你的指令，落地时全部替换或删掉，**不要把占位符和说明留在产物里**。

组装要点：

- `CLAUDE.md`：60-100 行。「本项目约定」只收有出处的；一条都没有就写「暂无有据可查的约定，跑 `/curate` 持续沉淀」。「深入阅读」表里本次没生成的行删掉，已有 `docs/` 里相关的文档加进来。
- `product.md`：PRD 什么语言就什么语言，不翻译。对照表状态只用 已实现 / 部分 / 未实现 / PRD 未提 四种，加「待核实」标记。
- `architecture.md`：按顶层目录组织模块小节。
- `decisions.md`：按时间倒序。
- `glossary.md`：PRD 与代码都有术语时出对照表；只有其一时出单列表；两边都没有可用术语时不生成。
- memory：仅当会话 agent 返回了 `user` / `feedback` 类。写到 `context_assets.memory.dir`，一条一个文件，frontmatter 格式：

  ```markdown
  ---
  name: <短横线小写 slug>
  description: <一句话>
  metadata:
    type: user | feedback
  ---

  <内容>
  **Why:** <原因>
  **How to apply:** <怎么用>
  ```

  并在同目录 `MEMORY.md` 末尾加一行 `- [<标题>](<文件名>) — <一句话>`；`MEMORY.md` 不存在就新建。目标文件名已存在就跳过。
- 每个生成文件末尾加页脚：

  ```
  > 由 /context-curator:init 于 <YYYY-MM-DD> 生成。来源：PRD <文件名或「无」> · 代码 <git.branch>@<git.head> · 会话 <精读数> 个。此后由项目负责人维护，可用 /curate 持续更新。
  ```

写入规则：

- `--dry-run`：把每个文件的完整内容打印出来，文件名做标题，不写盘。
- 否则用 Write 工具逐个写。**写之前再查一次目标是否存在**，存在就跳过。`docs/context/` 目录不存在由 Write 自动创建。
- 脚本不参与写入。

### 第 9 步：记状态

非 dry-run 且 `sessions.dir` 非空时：

```bash
CC=$(node -e 'const p=require(process.argv[1]+"/lib/paths");console.log(p.curatorDir(process.argv[2]))' "$CCH" "<sessions.dir>")
node "$CCH"/bin/state.js init-done "$CC"
```

**不动队列。** 初始化挖过的会话仍可被 `/curate 结算` 再看一遍，那边的资产比对会自然去重。

### 第 10 步：报告

```
✅ 上下文资产初始化完成

信息源
  PRD      <文件>（<N> 节）/ 无
  代码     <主语言> <文件数> 文件 · <branch>@<head>
  会话     精读 <n> / 共 <count>
  已有资产 <清单>（读入，未改）

写入
  CLAUDE.md                      <行数> 行
  docs/context/product.md        对照表 <N> 项：已实现 a · 部分 b · 未实现 c · PRD 未提 d
  docs/context/architecture.md   <N> 个模块
  docs/context/decisions.md      <N> 条
  docs/context/glossary.md       <N> 个术语
  memory/                        <N> 条

跳过（已存在，未改）
  <文件> → <处理方式，如：已在 CLAUDE.md 指针表里引用>

⚠️ 待你处理
  - <填不出的字段 / 待核实的条目 / 探测降级 / 统计截断>

下一步：攒几个会话后跑 /curate 结算 持续养护。
```

`CLAUDE.md` 因已存在被跳过时，在「待你处理」里建议用户在其中加一行指向 `docs/context/`，或交给 `/curate`。

## 反模式

- ❌ 为了让文件看起来充实，把 PRD 没写的内容补进 `product.md`
- ❌ 把函数签名、字段列表抄进 `architecture.md`——读代码就知道的不写
- ❌ 会话里 AI 自己说的话当成「决策」
- ❌ 把 PRD 事实写进 `CLAUDE.md`（那是 `docs/context/` 的活）
- ❌ 目标文件已存在还「顺手合并一下」——一个字都不改
- ❌ 没有会话记录时硬生成一份空的 `decisions.md`
```

- [ ] **Step 2: 写 `templates/claude.template.md`**

```markdown
# {项目名}

{一句话：做什么、给谁用}（出处：{PRD §x / README}）

## 技术栈与命令

- 语言 / 框架：{…}（{manifest 文件}）
- 测试：`{cmd}`
- 构建：`{cmd}`
- 运行：`{cmd}`
- 静态检查：`{cmd}`

*(没有的命令删掉整行；命令来自探测结果的 suggested_commands，每条都有 source)*

## 目录导览

- `{dir}/` — {一句话职责}

*(3-8 行，只列会经常进的目录；职责来自代码 agent 的 modules)*

## 本项目约定

- {规则}（出处：会话 {session_id}:{行} / {配置文件路径}）

*(只收有出处的；一条都没有就把本节内容换成「暂无有据可查的约定，跑 `/curate` 持续沉淀」)*

## 深入阅读

| 主题 | 文件 |
|---|---|
| 产品与需求 | docs/context/product.md |
| 架构 | docs/context/architecture.md |
| 决策与踩坑 | docs/context/decisions.md |
| 术语 | docs/context/glossary.md |

*(本次没生成的行删掉；项目已有的相关文档加进来)*

## 当前状态

- 阶段：{…}（出处）
- 未完成：{…}（出处：product.md 对照表）
- 已知问题：{…}（出处：会话 {session_id}:{行}）

> 由 /context-curator:init 于 {YYYY-MM-DD} 生成。来源：PRD {文件名} · 代码 {branch}@{head} · 会话 {N} 个。此后由项目负责人维护，可用 /curate 持续更新。
```

- [ ] **Step 3: 写 `templates/product.template.md`**

```markdown
# 产品与需求

来源：{PRD 文件名}。每节末尾的「§」是 PRD 章节或页码。

## 目标

- {目标}（§{x}）

## 目标用户与核心场景

- {用户}：{场景}（§{x}）

## 功能清单

按 PRD 章节顺序。

| # | 功能 | 说明 | 出处 |
|---|---|---|---|
| 1 | {功能名} | {一句话} | §{x} |

## 业务规则与边界条件

- {规则}（§{x}）

## 非功能要求

- {要求}（§{x}）

## PRD ↔ 代码对照

状态只用四种：已实现 / 部分 / 未实现 / PRD 未提。判不出的在依据里写「待核实」。

| 功能 | 状态 | 代码位置 | 依据 |
|---|---|---|---|
| {功能名} | {状态} | `{path}` | {代码 agent 的 note} |

*(没有代码 agent 结论的功能整行写「待核实」；代码有但 PRD 没提的功能状态写「PRD 未提」)*

> 由 /context-curator:init 于 {YYYY-MM-DD} 生成。来源：PRD {文件名} · 代码 {branch}@{head} · 会话 {N} 个。此后由项目负责人维护，可用 /curate 持续更新。
```

- [ ] **Step 4: 写 `templates/architecture.template.md`**

```markdown
# 架构

来源：代码。每条末尾的反引号是代码路径。

## 模块划分

按顶层目录。

### {模块名}（`{path}/`）

{职责一句话}。关键文件：`{file}`、`{file}`。

## 分层与依赖方向

- {描述}（`{path}`）

## 数据流

- {从哪到哪，经过什么}（`{path}` → `{path}`）

## 入口与启动链

- `{entrypoint}` → {做了什么}（`{path}`）

## 外部依赖与三方服务

- {名称}：{用途}（`{manifest 或代码路径}`）

## 构建、测试与发布

- 测试：`{cmd}`（{source}）
- 构建：`{cmd}`（{source}）
- CI：`{ci 文件}`

*(已有 docs/ 里有同主题文档时，对应小节只留一行「见 `{已有文档路径}`」)*

> 由 /context-curator:init 于 {YYYY-MM-DD} 生成。来源：PRD {文件名} · 代码 {branch}@{head} · 会话 {N} 个。此后由项目负责人维护，可用 /curate 持续更新。
```

- [ ] **Step 5: 写 `templates/decisions.template.md`**

```markdown
# 决策与踩坑

来源：历史会话。按时间倒序。每条的「现状」是拿会话结论对照当前代码的结果。

### {一句话结论}

- 时间：{YYYY-MM-DD}
- 类型：{决策 / 踩坑 / 纠正 / 约定}
- 证据：会话 {session_id} 第 {行} 行，你说「{原话}」
- 现状：{仍然成立 / 已变化 / 待核实}{，一句话说明}

> 由 /context-curator:init 于 {YYYY-MM-DD} 生成。来源：PRD {文件名} · 代码 {branch}@{head} · 会话 {N} 个。此后由项目负责人维护，可用 /curate 持续更新。
```

- [ ] **Step 6: 写 `templates/glossary.template.md`**

```markdown
# 术语

来源：PRD 与代码。

## 对照表

| PRD 名词 | 代码标识符 | 含义 | 出处 |
|---|---|---|---|
| {名词} | `{Identifier}` | {一句话} | §{x} / `{path}` |

*(只有 PRD 或只有代码时，去掉对不上的那一列，改成单列术语表)*

> 由 /context-curator:init 于 {YYYY-MM-DD} 生成。来源：PRD {文件名} · 代码 {branch}@{head} · 会话 {N} 个。此后由项目负责人维护，可用 /curate 持续更新。
```

- [ ] **Step 7: 逐条核对 SKILL.md 里的命令能跑**

Run（把 `<base>` 换成本仓库的 `skills/context-init` 绝对路径）：

```bash
cd /Users/shenjinhua/plugins/context-curator
BASE="$PWD/skills/context-init"
CCH=$(node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const base=process.argv[1]||"";const h=os.homedir(),hit=[];
const push=p=>{try{if(p&&fs.existsSync(path.join(p,"lib","profile.js")))hit.push(path.resolve(p))}catch{}};
push(base&&path.join(base,"..","context-curator"));
console.log(hit[0]||"")' "$BASE")
echo "CCH=$CCH"
node "$CCH"/bin/profile-project.js . --pretty | head -5
CC=$(node -e 'const p=require(process.argv[1]+"/lib/paths");console.log(p.curatorDir(process.argv[2]))' "$CCH" "/tmp/fake-sessions")
echo "CC=$CC"
```

Expected: `CCH` 指向 `skills/context-curator` 的绝对路径；profile 前几行有 `"root"`；`CC` 为 `/tmp/fake-sessions/context-curator`。

- [ ] **Step 8: 检查 frontmatter 合法**

Run: `head -4 skills/context-init/SKILL.md && node -e 'const s=require("fs").readFileSync("skills/context-init/SKILL.md","utf8");const m=/^---\n([\s\S]*?)\n---/.exec(s);const d=/description:\s*(.*)/.exec(m[1])[1];console.log("description 长度",d.length)'`
Expected: 以 `---` / `name: context-init` 开头；description 长度小于 1024。

- [ ] **Step 9: Commit**

```bash
git add skills/context-init
git commit -m "feat(context-init): 初始化 skill 主体与五份产物模板

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 命令、README、AGENTS.md、插件清单

**Files:**
- Create: `commands/init.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: `skills/context-init/SKILL.md`（Task 5）
- Produces: `/context-curator:init` 命令；对外文档

- [ ] **Step 1: 写 `commands/init.md`**

```markdown
---
description: 从 PRD + 源码 + 历史会话初始化项目上下文资产（薄 CLAUDE.md + docs/context/），只新增不覆盖
argument-hint: [PRD路径] [--dry-run] [--sessions N]
---

用 context-init skill 初始化当前项目的上下文资产。

参数：$ARGUMENTS

- 第一个不以 `--` 开头的参数是 PRD 路径；没给就问一次，用户说没有就跳过 PRD
- `--dry-run` → 只打印将写入的内容，不写盘
- `--sessions N` → 精读的会话数上限，默认 10

严格遵守 skill 的三条铁律：不覆盖任何已有文件、无出处不写、事实进 docs/context/ 规则才进 CLAUDE.md。
```

- [ ] **Step 2: README「三种模式」表之后加一段，介绍初始化**

在 README 里「三种模式：」表格（以 `| **当下** |` 行结尾）之后、`## 安装` 之前插入：

```markdown
另有一个**初始化**入口，服务「项目还没有任何上下文资产」的场景：

```
/context-curator:init docs/prd.md
```

它读三样东西——你给的 PRD、本地源码、该项目的历史会话——生成一份薄 `CLAUDE.md` 和 `docs/context/` 下的四份事实文档（产品与需求、架构、决策与踩坑、术语）。**只新增，不覆盖**：目标文件已存在就跳过；每一段都标出处（PRD 章节 / 代码路径 / 会话行号），指不到出处的不写。带 `--dry-run` 只打印不写盘。初始化完成后交给 `/curate` 持续养护。
```

- [ ] **Step 3: README「安装 · Codex」小节把 skill 链接改成两个目录**

把

```bash
git clone https://github.com/kane313/context-curator.git ~/.local/share/context-curator
ln -s ~/.local/share/context-curator/skills/context-curator ~/.agents/skills/context-curator
```

改为

```bash
git clone https://github.com/kane313/context-curator.git ~/.local/share/context-curator
ln -s ~/.local/share/context-curator/skills/context-curator ~/.agents/skills/context-curator
ln -s ~/.local/share/context-curator/skills/context-init ~/.agents/skills/context-init
```

并在其后加一句：

```markdown
`context-init` 自己不带脚本，靠探测找到旁边的 `context-curator` 目录复用脚本，所以两个目录要一起链。
```

- [ ] **Step 4: README「手动安装」段补一句**

在「`skills/context-curator/` 这个目录是自包含的……」那段末尾加：

```markdown
`skills/context-init/` 只有 `SKILL.md` 和模板，要和 `context-curator` 放在同一个 skill 目录下。`/context-curator:init` 命令在 `commands/init.md`。
```

- [ ] **Step 5: README「怎么用」章节末尾（`## 文件` 之前）加「首次接手一个零资产的项目」小节**

```markdown
### 项目还没有任何上下文资产

```
/context-curator:init docs/prd.md
```

一次性生成 `CLAUDE.md` + `docs/context/`。PRD 可以不给（跳过产品文档），历史会话可以没有（跳过决策文档），但源码必须在当前目录。已存在的文件一律跳过，报告里会列出来。
```

- [ ] **Step 6: README「文件」树更新**

把

```
commands/curate.md                /curate 斜杠命令
skills/context-curator/           ← 自包含的 skill，可整个搬进任何 agent 的 skill 目录
├── SKILL.md                      主体流程：三种模式、路由规则、确认协议
├── lib/scan.js                   提取真人输入 + 信号打分（hook 与 harvest 共用同一份）
├── lib/paths.js                  跨平台项目定位、slug 推导 + cwd 反查
├── lib/store.js                  队列、状态与拒绝指纹的读写
├── bin/scan-session.js           SessionEnd hook 入口
├── bin/harvest.js                批量粗筛，供全量模式用
├── bin/state.js                  队列状态与拒绝指纹 CLI
└── test/                         node:test 用例 + 三份 fixture + 回归比对记录
```

改为

```
commands/curate.md                /curate 斜杠命令
commands/init.md                  /context-curator:init 斜杠命令
skills/context-init/              ← 初始化 skill：只有流程与模板，脚本借用下面的工具箱
├── SKILL.md                      初始化流程：四个信息源、只新增不覆盖、出处规则
└── templates/                    CLAUDE.md 与四份 docs/context 文档的模板
skills/context-curator/           ← 自包含的 skill，可整个搬进任何 agent 的 skill 目录
├── SKILL.md                      主体流程：三种模式、路由规则、确认协议
├── lib/scan.js                   提取真人输入 + 信号打分（hook 与 harvest 共用同一份）
├── lib/paths.js                  跨平台项目定位、slug 推导 + cwd 反查
├── lib/store.js                  队列、状态与拒绝指纹的读写
├── lib/manifests.js              manifest 解析与命令推断（初始化用）
├── lib/walk.js                   目录遍历统计与入口识别（初始化用）
├── lib/profile.js                项目探测总编排：工具链、已有资产、git、会话
├── bin/scan-session.js           SessionEnd hook 入口
├── bin/harvest.js                批量粗筛，供全量模式与初始化用
├── bin/state.js                  队列状态、拒绝指纹与初始化时间戳 CLI
├── bin/profile-project.js        项目探测 CLI，零 token、只读、只输出 JSON
└── test/                         node:test 用例 + 三份 fixture + 回归比对记录
```

- [ ] **Step 7: README「三条铁律」第 1 条硬保证那句补上新脚本**

把

```
第 1 条有硬保证而非仅靠自觉：全项目的脚本唯一被允许写入的文件只有 `queue.jsonl` 和 `state.json`，没有任何脚本有能力碰 `CLAUDE.md`、memory 或 `docs/`。
```

改为

```
第 1 条有硬保证而非仅靠自觉：全项目的脚本唯一被允许写入的文件只有 `queue.jsonl` 和 `state.json`，没有任何脚本有能力碰 `CLAUDE.md`、memory 或 `docs/`。初始化用的 `profile-project.js` 也一样：只读项目、只输出 JSON。
```

- [ ] **Step 8: AGENTS.md「结构约定」加两段**

在「`SKILL.md` 里不要写死脚本的绝对路径……」那段之后加：

```markdown
`skills/context-init/` 是第二个 skill，**只放 `SKILL.md` 与 `templates/`，不放脚本**。它需要的探测、粗筛、状态脚本全在 `skills/context-curator/` 里，靠 SKILL.md 第 0 步从自己的 base directory 往上一级找 `context-curator/`（找不到再走与 curate 相同的全局探测）。别把脚本复制一份过去，slug 推导之类的逻辑出现两份迟早漂移。

`bin/profile-project.js` 与 `lib/profile.js` / `lib/walk.js` / `lib/manifests.js` 只读项目、只输出 JSON，和 hook 一样任何失败都 `exit 0`。它们没有、也不该有写 `CLAUDE.md`、`docs/` 或 memory 的能力——初始化的写入只由 SKILL 主体在最后一步用 Write 工具完成。
```

- [ ] **Step 9: 两份 plugin.json 与 marketplace.json**

`.claude-plugin/plugin.json`：`"version": "1.0.0"` → `"version": "1.1.0"`；description 改为：

```
把会话里产生的知识沉淀成项目上下文资产（CLAUDE.md / memory / docs / skills）。会话结束时用纯 Node 零 token 粗筛出高信号线索攒进队列；你主动唤起时派子 agent 精读、比对现有资产，逐条确认后才写入。三条铁律：没有确认就不写、没有证据就不提、拒绝过的不再提。另附 /context-curator:init：从 PRD + 源码 + 历史会话为零资产项目一次性生成薄 CLAUDE.md 与 docs/context/，只新增不覆盖、每段带出处。
```

`.codex-plugin/plugin.json`：`"version": "1.0.0"` → `"version": "1.1.0"`；description 改为：

```
把会话里产生的知识沉淀成项目上下文资产（CLAUDE.md / memory / docs / skills）。会话结束时零 token 粗筛攒线索，主动唤起时逐条确认后才写入。另附 context-init skill：从 PRD + 源码 + 历史会话为零资产项目一次性生成薄 CLAUDE.md 与 docs/context/，只新增不覆盖。
```

`.claude-plugin/marketplace.json` 的 plugins[0].description 改为：

```
把会话里产生的知识沉淀成项目上下文资产（CLAUDE.md / memory / docs / skills）。会话结束时零 token 后台粗筛攒线索，你主动唤起时逐条确认后才写入。另附 /context-curator:init 从 PRD + 源码 + 历史会话初始化零资产项目。
```

- [ ] **Step 10: 校验 JSON 合法**

Run: `for f in .claude-plugin/plugin.json .codex-plugin/plugin.json .claude-plugin/marketplace.json; do node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("ok",process.argv[1])' "$f"; done`
Expected: 三行 `ok`

- [ ] **Step 11: Commit**

```bash
git add commands/init.md README.md AGENTS.md .claude-plugin/plugin.json .codex-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat: /context-curator:init 命令、文档与 1.1.0 版本

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 端到端验收

**Files:**
- Modify: `README.md`（「验证安装」里的测试数量）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 验收通过的分支

- [ ] **Step 1: 全量测试**

Run: `cd skills/context-curator && node --test 2>&1 | tail -8`
Expected: `fail 0`，记下 `pass` 后面的数字（应为 70）。

- [ ] **Step 2: README「验证安装」更新测试数量**

把 `node --test   # 应输出「pass 40」「fail 0」` 里的 `40` 改成 Step 1 记下的数字。

- [ ] **Step 3: 在一个真实的 Flutter 项目上跑探测脚本**

Run（`regression.md` 里记录过的项目路径）：

```bash
cd /Users/shenjinhua/plugins/context-curator/skills/context-curator
P=$(node -e 'const p=require("./lib/paths");const d=p.readCwd("/Users/shenjinhua/.claude/projects/-Users-shenjinhua-zergen-flutterProject-pet");console.log(d||"")')
echo "项目: $P"
[ -d "$P" ] && node bin/profile-project.js "$P" --pretty | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify({root:j.root,git:j.git,langs:j.languages.slice(0,3),manifests:j.manifests.map(m=>m.file),entry:j.entrypoints,cmds:j.suggested_commands.map(c=>c.cmd),assets:{claude:j.context_assets["CLAUDE.md"],docs:j.context_assets.docs.length},sessions:{count:j.sessions.count,dir:!!j.sessions.dir}},null,2))'
```

Expected: `manifests` 含 `pubspec.yaml`；`langs` 首项 Dart；`entry` 含 `lib/main.dart`；`cmds` 含 `flutter test`；`sessions.count` 与该目录下 jsonl 数量一致（19 左右）；`sessions.dir` 为 true。项目目录不存在时记录「该项目已不在本机，改用任一本地 Flutter 项目路径重跑」并换一个路径。

- [ ] **Step 4: 在本仓库上 dry-run 走一遍 SKILL 流程（主会话执行，不派 agent 也行）**

按 `skills/context-init/SKILL.md` 第 0 到第 8 步在本仓库上手动走一遍，带 `--dry-run`，PRD 用 `docs/superpowers/specs/2026-09-08-context-init-design.md` 充当。检查：

- 第 1 步的目标表正确判定：本仓库没有 `CLAUDE.md`（可写），`docs/` 下没有 `context/*.md`（可写），`sessions.count ≥ 1`（`decisions.md` 可写）
- 打印出来的每个文件里，每一段都带出处，没有残留 `{…}` 占位或斜体说明
- 没有任何文件被写盘：`git status --short` 只有 README 的改动

- [ ] **Step 5: 完整 diff 自查**

Run: `git diff main --stat && git log main..HEAD --oneline`
Expected: 只包含文件结构表里列出的文件；7 个左右 commit，每个 message 末尾有 Co-Authored-By。

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: 验证安装的测试数量

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 自审记录

**Spec 覆盖：**
- §2 决策 1-4 → Task 5（产物范围、只补缺）、Task 5/6（打包方式）
- §3 铁律 → Task 5 SKILL.md「铁律」与第 8 步写入规则；脚本只读由 Task 4 的实现与 AGENTS.md（Task 6）约束
- §4 入口（命令、触发词、URL 处理）→ Task 6 `commands/init.md`、Task 5 frontmatter 与「参数」节
- §5 四个信息源 → Task 5 第 1-4 步
- §6 探测脚本全部字段 → Task 2（manifests、suggested_commands）、Task 3（languages、tree、truncated、entrypoints）、Task 4（git、tooling、context_assets、sessions、root、generated_at）
- §7 产物（五个文件 + memory + 页脚）→ Task 5 模板与第 8 步
- §8 流程 11 步 → Task 5 第 0-10 步；`init-done` → Task 1
- §9 错误处理 → Task 5 第 1 步降级、第 4 步为空、参数节 URL、第 8 步 glossary 与 memory 条件、Task 4 CLI `{}`
- §10 测试 → Task 1-4 各自的用例；手工验收 → Task 7
- §11 文件清单 → 文件结构表；§12 不做的事 → SKILL.md 反模式

**占位符扫描：** 计划里出现的 `{…}` 全部在模板文件内容里，是模板本身的占位，SKILL.md 第 8 步已要求落地时替换。无 TBD / TODO。

**类型一致性：** `markInitialized(ccDir)` ↔ `state.js init-done <CC>`；`parsePackageJson` 输出 `main` / `bin` ↔ `detectEntrypoints` 读 `m.main` / `m.bin`；`walk` 返回 `{languages, tree, truncated}` ↔ `profileProject` 解构同名；`sessionInfo` 返回 `dir` ↔ `contextAssets(root, sessions.dir)`；`profileProject(root, {maxFiles, projectsRoot})` ↔ 测试传 `projectsRoot`；CLI 通过 `paths.projectsRoot()` 读 `CLAUDE_CONFIG_DIR` ↔ bins 测试设该环境变量。
