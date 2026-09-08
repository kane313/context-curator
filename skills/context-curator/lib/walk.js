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
