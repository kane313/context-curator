'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const paths = require('./paths');
const store = require('./store');
const { parseManifests, suggestCommands } = require('./manifests');
const { walk, detectEntrypoints, IGNORED } = require('./walk');

// 项目探测：只读项目，只输出事实。这里没有任何写文件的能力,也不该有。

// 路径前缀比较必须按 path.sep 边界走,否则 ~/.claude-backup 会被 ~/.claude 误命中。
// path.relative 顺带处理了 Windows 盘符与 .. 归一化。
function under(child, parent) {
  let rel;
  try {
    rel = path.relative(path.resolve(parent), path.resolve(child));
  } catch {
    return false;
  }
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// 平台判定:决定 init 的主体产物写 AGENTS.md(Codex)还是 CLAUDE.md(Claude Code)。
// 判据按可靠性降序,命中即返回。
//
// 为什么 skill 安装位置排在环境变量之前:Codex 自带 skill 里 CODEX_HOME 的惯用写法是
// ${CODEX_HOME:-$HOME/.codex},带 :- 兜底说明 Codex 不保证把它注入子进程,不能单独依赖;
// 而 base directory 是「谁在加载我」的直接证据。CODEX_PLUGIN_ROOT 这个变量在 Codex 里
// 根本不存在(0.154 二进制里只有裸的 PLUGIN_ROOT,且那是 MCP stdio 配置的路径占位符),
// 别再往回加。
function detectPlatform(baseDir, opts = {}) {
  const env = opts.env || process.env;
  let home = opts.home;
  if (!home) {
    try {
      home = os.homedir();
    } catch {
      home = '';
    }
  }
  if (opts.override === 'codex' || opts.override === 'claude') {
    return { id: opts.override, evidence: '用户显式指定' };
  }
  const codexHome = env.CODEX_HOME || (home ? path.join(home, '.codex') : '');
  const base = typeof baseDir === 'string' && baseDir ? baseDir : null;
  if (base && home) {
    if (under(base, path.join(home, '.agents', 'skills'))) {
      return { id: 'codex', evidence: 'skill 装在 ~/.agents/skills/ 下' };
    }
    if (codexHome && under(base, path.join(codexHome, 'skills'))) {
      return { id: 'codex', evidence: 'skill 装在 <CODEX_HOME>/skills/ 下' };
    }
    if (under(base, path.join(home, '.claude'))) {
      return { id: 'claude', evidence: 'skill 装在 ~/.claude/ 下' };
    }
  }
  if (env.CODEX_HOME && !env.CLAUDE_PLUGIN_ROOT && !env.CLAUDE_CONFIG_DIR) {
    return { id: 'codex', evidence: '环境变量 CODEX_HOME 存在,且无 CLAUDE_* 变量' };
  }
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_CONFIG_DIR) {
    return { id: 'claude', evidence: '环境变量 CLAUDE_PLUGIN_ROOT / CLAUDE_CONFIG_DIR 存在' };
  }
  return { id: 'claude', evidence: '默认(无判据命中)' };
}

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

// 递归收集 md 文件。depth 是还能往下走的目录层数。IGNORED 里的目录名直接跳过。
function mdFilesUnder(dir, rel, depth, out, max) {
  if (depth < 0 || out.length >= max) return;
  for (const name of listNames(dir)) {
    if (out.length >= max) return;
    if (IGNORED.has(name)) continue;
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
  // 直接读 docs/context/，不经过 mdFilesUnder，也不受上面 50 个上限影响
  const docs_context = listNames(path.join(root, 'docs', 'context')).filter(f => /\.md$/i.test(f));
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
    docs_context,
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
  grab('toplevel', ['rev-parse', '--show-toplevel']);
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

module.exports = { under, detectPlatform, detectTooling, contextAssets, gitInfo, sessionInfo, profileProject };
