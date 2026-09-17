#!/usr/bin/env node
'use strict';
// context-curator —— Codex 安装脚本。
//
// 用法：
//   node scripts/install-codex.js              插件模式：调 codex plugin 命令装当前这份代码
//   node scripts/install-codex.js --link       开发者模式：在 ~/.agents/skills/ 下建链接，改代码立即生效
//   node scripts/install-codex.js --dry-run    只打印将做什么，不动任何东西
//
// Codex 原生就能装这个插件（codex plugin marketplace add + codex plugin add），本脚本
// 只做原生命令不管的事：前置检查、装完验证、同名 skill 冲突检测、hook 指引。
//
// ⚠️ 与 skills/context-curator/bin/ 下那些脚本的纪律相反：那些是 hook 与 skill 的
// 被调脚本，任何失败都必须 exit 0，绝不能拖累会话；这个是用户手动跑的安装脚本,
// 装失败必须让用户知道，所以失败一律非 0 退出。别"统一"成 exit 0。
//
// 零依赖，只用 Node 内置模块；目录链接用 junction，Windows 上免管理员权限。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKILLS = ['context-curator', 'context-init'];
const MIN_NODE = 18;

// ——————————————————————————— 纯逻辑（可测） ———————————————————————————

// Codex 直接读 .claude-plugin/marketplace.json（实测：codex plugin list 会打印这个路径），
// 所以不需要单独造一份 Codex 格式的市场清单。名字从文件里读，不硬编码。
function readMarketplaceName(repoRoot) {
  const file = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`读不到 ${file}——请在仓库根目录跑这个脚本`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} 不是合法 JSON：${e.message}`);
  }
  const marketplace = json && json.name;
  const plugin = json && Array.isArray(json.plugins) && json.plugins[0] && json.plugins[0].name;
  if (!marketplace) throw new Error(`${file} 缺 name 字段`);
  if (!plugin) throw new Error(`${file} 的 plugins[0].name 缺失`);
  return { marketplace, plugin, selector: `${plugin}@${marketplace}` };
}

// 「绝不覆盖」铁律的实现：只有 absent 才动手，ok 跳过，其余一律报错退出。
function linkState(target, linkPath) {
  let st;
  try {
    st = fs.lstatSync(linkPath);
  } catch {
    return 'absent';
  }
  if (!st.isSymbolicLink()) return 'occupied';
  let dest;
  try {
    dest = fs.realpathSync(linkPath);
  } catch {
    return 'conflict'; // 断链
  }
  let want;
  try {
    want = fs.realpathSync(target);
  } catch {
    return 'conflict';
  }
  return dest === want ? 'ok' : 'conflict';
}

// 解析 codex plugin list 的输出。
// 陷阱：未安装那行写的是 "not installed"，里面也含 "installed" 子串，不能直接 includes。
function parseInstalled(listOutput, selector) {
  for (const line of String(listOutput).split('\n')) {
    if (!line.includes(selector)) continue;
    if (/\bnot installed\b/.test(line)) return false;
    if (/\binstalled\b/.test(line)) return true;
  }
  return false;
}

// 插件模式装的是快照副本，若用户同时还有软链版本，Codex 会看到两份同名 skill。
function detectSkillConflicts(homeDir, codexHome) {
  const roots = [path.join(homeDir, '.agents', 'skills'), path.join(codexHome, 'skills')];
  const hits = [];
  for (const root of roots) {
    for (const name of SKILLS) {
      const p = path.join(root, name);
      try {
        if (fs.existsSync(p)) hits.push(p);
      } catch {
        // 读不到就当没有
      }
    }
  }
  return hits;
}

// ——————————————————————————— 副作用 ———————————————————————————

const log = s => process.stdout.write(s + '\n');
function die(msg) {
  process.stderr.write(`\n✖ ${msg}\n`);
  process.exit(1);
}

function codexHomeDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function preflight(repoRoot) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE) die(`需要 Node ${MIN_NODE} 或更高，当前 ${process.versions.node}`);
  for (const name of SKILLS) {
    const p = path.join(repoRoot, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(p)) die(`仓库不完整：找不到 ${p}`);
  }
  const probe = path.join(repoRoot, 'skills', 'context-curator', 'lib', 'profile.js');
  if (!fs.existsSync(probe)) die(`仓库不完整：找不到 ${probe}——context-init 依赖它`);
  log(`✓ Node ${process.versions.node}，仓库完整（${SKILLS.join(' / ')}）`);
}

function requireCodexCli() {
  try {
    const v = execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
    log(`✓ 找到 Codex CLI：${v}`);
  } catch {
    die('PATH 里找不到 codex 命令。装一个（npm i -g @openai/codex）再来，\n'
      + '  或者用 --link 开发者模式（不需要 codex 命令，但没有版本管理）。');
  }
}

function runCodex(args, dryRun) {
  log(`  $ codex ${args.join(' ')}`);
  if (dryRun) return '';
  try {
    return execFileSync('codex', args, { encoding: 'utf8', timeout: 120000 });
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    die(`codex ${args.join(' ')} 失败：\n${out || e.message}`);
  }
}

function installAsPlugin(repoRoot, dryRun) {
  const { marketplace, selector } = readMarketplaceName(repoRoot);
  log(`\n插件模式：把 ${repoRoot} 作为本地市场 \`${marketplace}\` 装进 Codex`);
  runCodex(['plugin', 'marketplace', 'add', repoRoot], dryRun);
  runCodex(['plugin', 'add', selector], dryRun);

  if (dryRun) {
    log(`\n[dry-run] 装完会验证 \`codex plugin list\` 里 ${selector} 是否为 installed`);
    return;
  }
  const list = runCodex(['plugin', 'list'], false);
  if (!parseInstalled(list, selector)) {
    die(`装完但 codex plugin list 里 ${selector} 不是 installed 状态：\n${list}`);
  }
  log(`✓ ${selector} 已安装并启用`);
  log('\n提示：插件模式装的是当前代码的快照副本。改了仓库代码要重装才生效\n'
    + `  （codex plugin remove ${selector} 后再跑一次），或者改用 --link 开发者模式。`);
}

function installAsLinks(repoRoot, dryRun) {
  const dest = path.join(os.homedir(), '.agents', 'skills');
  log(`\n开发者模式：在 ${dest} 下建链接，改仓库代码立即生效`);
  if (!dryRun) fs.mkdirSync(dest, { recursive: true });

  for (const name of SKILLS) {
    const target = path.join(repoRoot, 'skills', name);
    const link = path.join(dest, name);
    const state = linkState(target, link);
    if (state === 'ok') {
      log(`  = ${name} 已链接到本仓库，跳过`);
      continue;
    }
    if (state === 'conflict') {
      die(`${link} 已是链接但指向别处。本脚本绝不覆盖已有文件——\n`
        + '  自己确认后删掉它再跑，或者用插件模式。');
    }
    if (state === 'occupied') {
      die(`${link} 已存在且不是链接（可能是实体目录，里面的东西别处没有副本）。\n`
        + '  本脚本绝不覆盖——自己处理后再跑。');
    }
    log(`  + ${name} → ${target}`);
    if (dryRun) continue;
    // junction：Windows 上建目录链接不需要管理员权限；非 Windows 上 Node 退化为普通 symlink
    fs.symlinkSync(target, link, 'junction');
  }

  if (dryRun) {
    log('\n[dry-run] 建完会验证链接可读且 lib/profile.js 能 require');
    return;
  }
  const probe = path.join(dest, 'context-curator', 'lib', 'profile.js');
  try {
    const P = require(probe);
    if (typeof P.detectPlatform !== 'function') throw new Error('detectPlatform 不见了');
  } catch (e) {
    die(`链接建好了但读不通 ${probe}：${e.message}`);
  }
  log('✓ 两个 skill 已链接，lib/profile.js 可正常 require');
}

function reportConflicts(mode) {
  const hits = detectSkillConflicts(os.homedir(), codexHomeDir());
  if (mode === 'link' || hits.length === 0) return;
  log('\n⚠️  检测到同名 skill 已存在于：');
  for (const h of hits) log(`     ${h}`);
  log('  插件模式装的是快照副本，Codex 会同时看到这些目录里的同名 skill。\n'
    + '  二选一：删掉上面这些（若是你自己建的链接），或者卸掉插件改用 --link。');
}

function hookGuide(repoRoot) {
  const script = path.join(repoRoot, 'skills', 'context-curator', 'bin', 'scan-session.js');
  log('\n———— hook（可选，本脚本不动你的 config.toml）————\n');
  log(`想要会话结束自动攒线索，在 ${path.join(codexHomeDir(), 'config.toml')} 的 [hooks] 段挂`);
  log('SessionEnd 事件，执行：\n');
  log(`  node ${script}\n`);
  if (process.platform === 'win32') {
    log('你在 Windows 上：hook 的命令要填进 commandWindows 字段（与 command 并列）。\n');
  } else {
    log('在 Windows 上装时，这条命令要填进 hook 的 commandWindows 字段（与 command 并列），\n'
      + '路径换成那台机器上的实际盘符路径。\n');
  }
  log('具体 TOML 写法请查 Codex 官方文档。本项目没有在真机上验证过那段 TOML 的确切字段，');
  log('所以不在这里给可能是错的示例；而且 Codex 的 hook 有信任机制，写进配置后仍需你在');
  log('Codex 里确认信任，本来就不可能全自动配好。');
  log('\n另外：Codex 下会话挖掘目前走不通（会话存在 SQLite thread history），所以就算配了');
  log('hook 队列也可能一直是空的。详见 README 的「两条诚实说明」第 2 条。');
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const link = args.includes('--link');
  if (args.includes('-h') || args.includes('--help')) {
    log('用法：node scripts/install-codex.js [--link] [--dry-run]');
    log('  --link     开发者模式：在 ~/.agents/skills/ 下建链接，改代码立即生效');
    log('  --dry-run  只打印将做什么，不动任何东西');
    return;
  }
  const repoRoot = path.resolve(__dirname, '..');
  log(`context-curator → Codex${dryRun ? '（dry-run，不动任何东西）' : ''}`);
  log(`仓库：${repoRoot}\n`);

  preflight(repoRoot);
  if (link) {
    installAsLinks(repoRoot, dryRun);
  } else {
    requireCodexCli();
    installAsPlugin(repoRoot, dryRun);
  }
  reportConflicts(link ? 'link' : 'plugin');
  hookGuide(repoRoot);
  log('\n装好之后在 Codex 里说一句「初始化这个项目的上下文资产」或「沉淀一下」即可。');
}

if (require.main === module) main();

module.exports = { readMarketplaceName, linkState, parseInstalled, detectSkillConflicts };
