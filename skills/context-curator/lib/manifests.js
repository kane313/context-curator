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
