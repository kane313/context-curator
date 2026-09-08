'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const paths = require('./paths');
const store = require('./store');
const { parseManifests, suggestCommands } = require('./manifests');
const { walk, detectEntrypoints } = require('./walk');

// 项目探测：只读项目，只输出事实。这里没有任何写文件的能力,也不该有。

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

// 与 wc -l 一致：末尾换行不多计一行，空文件为 0。
function lineCount(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text) return 0;
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
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
  // .github/workflows 展开成具体文件,让下游能直接引用
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

// git 不可用、不是仓库、任何子命令失败,都只是少几个字段。
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
