# Codex 适配实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/context-curator:init` 在 Codex 下产出 `AGENTS.md` 主体 + `CLAUDE.md` 指针，脚本按 Codex 真实路径探测，历史会话源明确降级为跳过，并修掉三处已确认的 Codex 侧缺陷。

**Architecture:** 平台判定做成 `lib/profile.js` 里一个可注入的纯函数 `detectPlatform(baseDir, opts)`，由 `bin/profile-project.js` 通过新增的 `--skill-base=` / `--platform=` 参数暴露，输出到 profile 的 `platform` 字段；两份 SKILL.md 只消费这个字段，不自己判平台。会话源的降级链条现有逻辑已经承担，本次只改措辞不加代码。

**Tech Stack:** Node 18+ 内置模块（`node:fs` / `node:path` / `node:os`），`node --test` 内置测试运行器，零 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-09-17-codex-adaptation-design.md`

## Global Constraints

- **零依赖**：只用 Node 内置模块。不引入任何 npm 包，**不使用 `node:sqlite`**（会把 Node 门槛从 18 抬到 22+，spec §13 明确排除）。
- **跨平台**：路径一律走 `node:path`，不依赖 shell 通配符展开，不用 `sed` / `find` / `jq`。
- **脚本纪律**：`bin/` 下脚本只读项目、只输出 JSON，任何失败路径都 `exit 0`，绝不抛错。`profile-project.js` 失败时输出 `{}`。
- **测试命令**：`cd skills/context-curator && node --test`（**无参**。写成 `node --test test/` 会让 Node 把 `test` 当模块 require 并报 MODULE_NOT_FOUND）。
- **测试基线**：改动前 `72 pass / 0 fail`。
- **`test/` 目录下所有 `.js` 都被当测试文件加载**，`test/helpers.js` 里只能有函数定义和 `module.exports`，不得有顶层副作用。
- **平台 id 只有两个合法值**：`'codex'` 和 `'claude'`。其他值一律回落自动判定，不报错。
- **铁律 1 不覆盖任何已有文件**，本次不放宽。
- **注释与 evidence 文案用中文**，与现有代码风格一致。
- **`profile-project.js` 的新参数必须用 `=` 形式**（`--skill-base=<path>`）。现有解析是 `args.find(a => !a.startsWith('--'))` 取项目根目录，空格形式会让路径值被当成项目根目录。

---

### Task 1: `detectPlatform()` 平台判定纯函数

**Files:**
- Modify: `skills/context-curator/lib/profile.js`（加 `node:os` require；新增 `under()` / `detectPlatform()`；加进 `module.exports`）
- Test: `skills/context-curator/test/profile.test.js`

**Interfaces:**
- Produces: `detectPlatform(baseDir, opts = {})` → `{ id: 'codex' | 'claude', evidence: string }`。
  `opts` 支持三个键：`home`（覆盖 `os.homedir()`，测试用）、`env`（覆盖 `process.env`，测试用）、`override`（用户显式指定的平台，只有 `'codex'` / `'claude'` 生效）。
  同时导出 `under(child, parent)` → `boolean`，供测试直接验证路径边界判定。

- [ ] **Step 1: 写失败的测试**

追加到 `skills/context-curator/test/profile.test.js` 末尾：

```js
// —— 平台判定 ——
// detectPlatform 不需要路径真实存在（纯路径比较），所以下面只造路径不建文件。
// home 与 env 全部注入，测试绝不读真实 ~ 与 process.env。

test('detectPlatform 判据 1：skill 装在 ~/.agents/skills 下判 codex', () => {
  const home = tmpDir('home');
  const r = P.detectPlatform(path.join(home, '.agents', 'skills', 'context-init'), { home, env: {} });
  assert.strictEqual(r.id, 'codex');
  assert.match(r.evidence, /\.agents/);
});

test('detectPlatform 判据 1：skill 装在 CODEX_HOME/skills 下判 codex', () => {
  const home = tmpDir('home');
  const cx = tmpDir('codexhome');
  const r = P.detectPlatform(path.join(cx, 'skills', 'context-init'), { home, env: { CODEX_HOME: cx } });
  assert.strictEqual(r.id, 'codex');
  assert.match(r.evidence, /CODEX_HOME/);
});

test('detectPlatform 判据 1：CODEX_HOME 未设时退到 ~/.codex/skills', () => {
  const home = tmpDir('home');
  const r = P.detectPlatform(path.join(home, '.codex', 'skills', 'context-init'), { home, env: {} });
  assert.strictEqual(r.id, 'codex');
});

test('detectPlatform 判据 2：skill 装在 ~/.claude 插件缓存下判 claude', () => {
  const home = tmpDir('home');
  const base = path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'context-curator', 'skills', 'context-init');
  const r = P.detectPlatform(base, { home, env: {} });
  assert.strictEqual(r.id, 'claude');
  assert.match(r.evidence, /\.claude/);
});

test('detectPlatform 判据 2 按路径分隔符边界比较，~/.claude-backup 不误命中', () => {
  const home = tmpDir('home');
  // .claude-backup 以 .claude 为字符串前缀，但不是它的子目录：不该命中判据 2，
  // 也没有别的判据命中，最终落到兜底 claude，evidence 必须是「默认」而非「装在 ~/.claude 下」
  const r = P.detectPlatform(path.join(home, '.claude-backup', 'skills', 'x'), { home, env: {} });
  assert.strictEqual(r.id, 'claude');
  assert.match(r.evidence, /默认/);
});

test('detectPlatform 判据 3：只有 CODEX_HOME 时判 codex', () => {
  const home = tmpDir('home');
  const r = P.detectPlatform(null, { home, env: { CODEX_HOME: '/somewhere/.codex' } });
  assert.strictEqual(r.id, 'codex');
  assert.match(r.evidence, /CODEX_HOME/);
});

test('detectPlatform 判据 3 不命中：CODEX_HOME 与 CLAUDE_* 同时存在时判 claude', () => {
  const home = tmpDir('home');
  const r = P.detectPlatform(null, {
    home,
    env: { CODEX_HOME: '/somewhere/.codex', CLAUDE_PLUGIN_ROOT: '/somewhere/plugin' },
  });
  assert.strictEqual(r.id, 'claude');
});

test('detectPlatform 判据 4：CLAUDE_CONFIG_DIR 存在判 claude', () => {
  const home = tmpDir('home');
  const r = P.detectPlatform(null, { home, env: { CLAUDE_CONFIG_DIR: '/somewhere/.claude' } });
  assert.strictEqual(r.id, 'claude');
  assert.match(r.evidence, /CLAUDE_/);
});

test('detectPlatform 判据 5：无任何判据时兜底 claude 并标默认', () => {
  const home = tmpDir('home');
  const r = P.detectPlatform(undefined, { home, env: {} });
  assert.strictEqual(r.id, 'claude');
  assert.match(r.evidence, /默认/);
});

test('detectPlatform baseDir 非字符串或空串时跳过判据 1、2', () => {
  const home = tmpDir('home');
  for (const bad of [null, undefined, '', 123, {}]) {
    const r = P.detectPlatform(bad, { home, env: { CODEX_HOME: '/x/.codex' } });
    assert.strictEqual(r.id, 'codex', `baseDir=${JSON.stringify(bad)} 应落到判据 3`);
  }
});

test('detectPlatform override 显式指定生效，非法值回落自动判定', () => {
  const home = tmpDir('home');
  const claudeBase = path.join(home, '.claude', 'skills', 'context-init');
  const forced = P.detectPlatform(claudeBase, { home, env: {}, override: 'codex' });
  assert.strictEqual(forced.id, 'codex');
  assert.match(forced.evidence, /显式指定/);
  // 非法值不报错，回落到自动判定（此处判据 2 命中 claude）
  const bogus = P.detectPlatform(claudeBase, { home, env: {}, override: 'gemini' });
  assert.strictEqual(bogus.id, 'claude');
  assert.doesNotMatch(bogus.evidence, /显式指定/);
});

test('under 只在真正的子路径上为真', () => {
  const home = tmpDir('home');
  assert.strictEqual(P.under(path.join(home, 'a', 'b'), path.join(home, 'a')), true);
  assert.strictEqual(P.under(path.join(home, 'a'), path.join(home, 'a')), true);
  assert.strictEqual(P.under(path.join(home, 'ab'), path.join(home, 'a')), false);
  assert.strictEqual(P.under(path.join(home, 'a'), path.join(home, 'a', 'b')), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/context-curator && node --test`
Expected: FAIL —— 报 `P.detectPlatform is not a function` 与 `P.under is not a function`（新增 12 个测试全红，原有 72 个仍绿）

- [ ] **Step 3: 实现**

`skills/context-curator/lib/profile.js` 顶部 require 段加一行（现有只有 fs / path / child_process / paths / store / manifests / walk，**没有 os**）：

```js
const os = require('node:os');
```

在 `function existsRel(` 之前插入：

```js
// 路径前缀比较必须按 path.sep 边界走，否则 ~/.claude-backup 会被 ~/.claude 误命中。
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

// 平台判定：决定 init 的主体产物写 AGENTS.md（Codex）还是 CLAUDE.md（Claude Code）。
// 判据按可靠性降序，命中即返回。
//
// 为什么 skill 安装位置排在环境变量之前：Codex 自带 skill 里 CODEX_HOME 的惯用写法是
// ${CODEX_HOME:-$HOME/.codex}，带 :- 兜底说明 Codex 不保证把它注入子进程，不能单独依赖；
// 而 base directory 是「谁在加载我」的直接证据。CODEX_PLUGIN_ROOT 这个变量在 Codex 里
// 根本不存在（0.154 二进制里只有裸的 PLUGIN_ROOT，且那是 MCP stdio 配置的路径占位符），
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
    return { id: 'codex', evidence: '环境变量 CODEX_HOME 存在，且无 CLAUDE_* 变量' };
  }
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_CONFIG_DIR) {
    return { id: 'claude', evidence: '环境变量 CLAUDE_PLUGIN_ROOT / CLAUDE_CONFIG_DIR 存在' };
  }
  return { id: 'claude', evidence: '默认（无判据命中）' };
}
```

文件末尾 `module.exports` 改为：

```js
module.exports = { under, detectPlatform, detectTooling, contextAssets, gitInfo, sessionInfo, profileProject };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/context-curator && node --test`
Expected: PASS，`tests 84` / `pass 84` / `fail 0`（原 72 + 新增 12）

- [ ] **Step 5: 提交**

```bash
git add skills/context-curator/lib/profile.js skills/context-curator/test/profile.test.js
git commit -m "feat(profile): 平台判定 detectPlatform

按可靠性降序判 codex / claude：skill 安装位置 > 环境变量 > 兜底。
安装位置排在环境变量前，因为 CODEX_HOME 的惯用写法带 :- 兜底，说明
Codex 不保证把它注入子进程；base directory 才是「谁在加载我」的直接证据。

路径比较走 path.relative 按分隔符边界判定，挡住 ~/.claude-backup 被
~/.claude 误命中。home 与 env 都可注入，测试不碰真实环境。"
```

---

### Task 2: `platform` 字段接线到 profile 输出与 CLI

**Files:**
- Modify: `skills/context-curator/lib/profile.js`（`profileProject` 内调用 `detectPlatform`，输出 `platform` 字段）
- Modify: `skills/context-curator/bin/profile-project.js`（新增 `--skill-base=` / `--platform=`，更新用法注释）
- Test: `skills/context-curator/test/profile.test.js`

**Interfaces:**
- Consumes: Task 1 的 `detectPlatform(baseDir, opts)` → `{ id, evidence }`
- Produces: `profileProject(root, opts)` 的返回对象新增顶层 `platform: { id, evidence }`；`opts` 新增 `skillBase`（string）与 `platform`（string，用户覆盖值）。
  CLI 用法变为 `node profile-project.js [项目根目录] [--pretty] [--skill-base=<path>] [--platform=codex|claude]`。

- [ ] **Step 1: 写失败的测试**

追加到 `skills/context-curator/test/profile.test.js` 末尾：

```js
test('profileProject 输出 platform 字段并透传 skillBase 与覆盖值', () => {
  const projects = tmpDir('projects');
  const root = tmpDir('proj');
  touch(root, 'package.json', '{"name":"demo"}\n');
  const auto = P.profileProject(root, { projectsRoot: projects });
  assert.strictEqual(typeof auto.platform.id, 'string');
  assert.ok(['codex', 'claude'].includes(auto.platform.id));
  assert.ok(auto.platform.evidence.length > 0);
  const forced = P.profileProject(root, { projectsRoot: projects, platform: 'codex' });
  assert.strictEqual(forced.platform.id, 'codex');
  assert.match(forced.platform.evidence, /显式指定/);
});

test('profile-project.js 认 --platform= 与 --skill-base=，且路径值不被当成项目根目录', () => {
  const root = tmpDir('cliproj');
  touch(root, 'package.json', '{"name":"cli"}\n');
  const bin = path.join(__dirname, '..', 'bin', 'profile-project.js');
  const out = execFileSync('node', [bin, root, `--skill-base=${path.join(root, '.agents', 'skills', 'x')}`, '--platform=codex'], { encoding: 'utf8' });
  const p = JSON.parse(out);
  // --skill-base= 的值绝不能被 args.find(a => !a.startsWith('--')) 当成项目根目录
  assert.strictEqual(p.root, root);
  assert.strictEqual(p.platform.id, 'codex');
});

test('profile-project.js 非法 --platform= 值回落自动判定而不报错', () => {
  const root = tmpDir('cliproj2');
  touch(root, 'package.json', '{"name":"cli2"}\n');
  const bin = path.join(__dirname, '..', 'bin', 'profile-project.js');
  const out = execFileSync('node', [bin, root, '--platform=gemini'], { encoding: 'utf8' });
  const p = JSON.parse(out);
  assert.ok(['codex', 'claude'].includes(p.platform.id));
  assert.doesNotMatch(p.platform.evidence, /显式指定/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/context-curator && node --test`
Expected: FAIL —— `Cannot read properties of undefined (reading 'id')`（`platform` 字段还不存在）

- [ ] **Step 3: 实现**

`skills/context-curator/lib/profile.js` 的 `profileProject` 里，`return {` 之后紧跟 `generated_at` 的下一行插入 `platform`，并在函数体内先算出它。改动后 `profileProject` 的尾部形如：

```js
  const manifests = parseManifests(abs);
  const { languages, tree, truncated } = walk(abs, { maxFiles: opts.maxFiles });
  const sessions = sessionInfo(abs, opts.projectsRoot);
  return {
    root: abs,
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platform: detectPlatform(opts.skillBase, { override: opts.platform }),
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
```

`skills/context-curator/bin/profile-project.js` 的用法注释与 `main()` 改为：

```js
// 用法:node profile-project.js [项目根目录] [--pretty] [--skill-base=<path>] [--platform=codex|claude]
// 新参数一律用 = 形式:空格形式会让路径值被下面的 args.find 当成项目根目录。

function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes('--pretty');
  const root = args.find(a => !a.startsWith('--')) || process.cwd();
  const opt = name => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const { profileProject } = require('../lib/profile');
  const profile = profileProject(root, { skillBase: opt('skill-base'), platform: opt('platform') }) || {};
  emit(JSON.stringify(profile, null, pretty ? 2 : 0) + '\n');
}
```

（`hit.slice(name.length + 3)` 里的 3 = 两个连字符加一个等号。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/context-curator && node --test`
Expected: PASS，`tests 87` / `pass 87` / `fail 0`（Task 1 的 84 + 新增 3）

- [ ] **Step 5: 手动验证 CLI 在本仓库上的真实输出**

Run: `cd /Users/shenjinhua/plugins/context-curator && node skills/context-curator/bin/profile-project.js . --pretty --skill-base=$HOME/.agents/skills/context-init | head -20`
Expected: 输出 JSON，`platform.id` 为 `codex`，`evidence` 为「skill 装在 ~/.agents/skills/ 下」

Run: `cd /Users/shenjinhua/plugins/context-curator && node skills/context-curator/bin/profile-project.js . --pretty | head -12`
Expected: `platform.id` 为 `claude`（本会话在 Claude Code 里跑，`CLAUDE_*` 环境变量存在或落到兜底）

- [ ] **Step 6: 提交**

```bash
git add skills/context-curator/lib/profile.js skills/context-curator/bin/profile-project.js skills/context-curator/test/profile.test.js
git commit -m "feat(profile): profile 输出 platform 字段，CLI 加 --skill-base= / --platform=

新参数用 = 形式是硬要求:现有解析用 args.find(a => !a.startsWith('--'))
取项目根目录,空格形式会让路径值被当成项目根目录。"
```

---

### Task 3: 两份 SKILL.md 的第 0 步探测同步改用 `CODEX_HOME`

**Files:**
- Modify: `skills/context-curator/SKILL.md:36-47`（第 0 步探测片段）
- Modify: `skills/context-init/SKILL.md:39-52`（第 0 步探测片段）

**Interfaces:**
- Consumes: 无（纯文档内嵌脚本）
- Produces: 两份 SKILL.md 的探测片段都能在 Codex 安装下找到 `context-curator` 目录

这两段探测逻辑本来就是重复的（一份找 `lib/scan.js`、一份找 `lib/profile.js`），本次**不合并**——合并要动 skill 的自包含性，超出范围。但两处必须同步改，漏一处就是只在某个平台出现的 bug。

- [ ] **Step 1: 改 `skills/context-curator/SKILL.md` 第 0 步**

把探测代码块整体替换为（改动点：删掉 `CODEX_PLUGIN_ROOT` 那行，加 `cx` 变量、`<CODEX_HOME>/skills` 与 `<CODEX_HOME>/plugins/cache`）：

```bash
CCH=$(node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const h=os.homedir(),hit=[];
const cx=process.env.CODEX_HOME||path.join(h,".codex");
const push=p=>{try{if(p&&fs.existsSync(path.join(p,"lib","scan.js")))hit.push(p)}catch{}};
push(process.env.CLAUDE_PLUGIN_ROOT&&path.join(process.env.CLAUDE_PLUGIN_ROOT,"skills","context-curator"));
push(path.join(h,".claude","skills","context-curator"));
push(path.join(cx,"skills","context-curator"));
push(path.join(h,".agents","skills","context-curator"));
const walk=(d,depth)=>{if(depth>4)return;let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}
  for(const e of es){if(!e.isDirectory())continue;const q=path.join(d,e.name);
    push(path.join(q,"skills","context-curator"));walk(q,depth+1)}};
walk(path.join(h,".claude","plugins","cache"),0);
walk(path.join(cx,"plugins","cache"),0);
console.log(hit[0]||"")')
```

同一段的说明文字里，「本 skill 可能装在三种位置之一（Claude 插件缓存 / `~/.claude/skills/` / Codex 的 `~/.agents/skills/`）」改为：

> 本 skill 可能装在几种位置之一（Claude 插件缓存 / `~/.claude/skills/` / Codex 的 `~/.agents/skills/` / `<CODEX_HOME>/skills/` / Codex 插件缓存），所以不要写死路径。

- [ ] **Step 2: 改 `skills/context-init/SKILL.md` 第 0 步**

把探测代码块整体替换为（与上一步同构，差别是找 `lib/profile.js`、多一条从 base directory 往上一级找的判据）：

```bash
CCH=$(node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const base=process.argv[1]||"";const h=os.homedir(),hit=[];
const cx=process.env.CODEX_HOME||path.join(h,".codex");
const push=p=>{try{if(p&&fs.existsSync(path.join(p,"lib","profile.js")))hit.push(path.resolve(p))}catch{}};
push(base&&path.join(base,"..","context-curator"));
push(process.env.CLAUDE_PLUGIN_ROOT&&path.join(process.env.CLAUDE_PLUGIN_ROOT,"skills","context-curator"));
push(path.join(h,".claude","skills","context-curator"));
push(path.join(cx,"skills","context-curator"));
push(path.join(h,".agents","skills","context-curator"));
const walk=(d,depth)=>{if(depth>4)return;let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}
  for(const e of es){if(!e.isDirectory())continue;const q=path.join(d,e.name);
    push(path.join(q,"skills","context-curator"));walk(q,depth+1)}};
walk(path.join(h,".claude","plugins","cache"),0);
walk(path.join(cx,"plugins","cache"),0);
console.log(hit[0]||"")' "<本 skill 的 base directory>")
```

- [ ] **Step 3: 确认 `CODEX_PLUGIN_ROOT` 在两份 SKILL.md 里已绝迹**

Run: `cd /Users/shenjinhua/plugins/context-curator && grep -rn 'CODEX_PLUGIN_ROOT' skills/`
Expected: 无输出（`docs/superpowers/plans/2026-09-08-context-init.md` 里那处是历史计划文档，保留不改）

- [ ] **Step 4: 实跑两段探测，确认真能找到目录**

本机 `~/.agents/skills/context-curator` 是指向本仓库的软链，两段探测都应命中。把 init 那段的 base directory 参数换成真实路径试：

Run:
```bash
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const base=process.argv[1]||"";const h=os.homedir(),hit=[];
const cx=process.env.CODEX_HOME||path.join(h,".codex");
const push=p=>{try{if(p&&fs.existsSync(path.join(p,"lib","profile.js")))hit.push(path.resolve(p))}catch{}};
push(base&&path.join(base,"..","context-curator"));
push(process.env.CLAUDE_PLUGIN_ROOT&&path.join(process.env.CLAUDE_PLUGIN_ROOT,"skills","context-curator"));
push(path.join(h,".claude","skills","context-curator"));
push(path.join(cx,"skills","context-curator"));
push(path.join(h,".agents","skills","context-curator"));
const walk=(d,depth)=>{if(depth>4)return;let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}
  for(const e of es){if(!e.isDirectory())continue;const q=path.join(d,e.name);
    push(path.join(q,"skills","context-curator"));walk(q,depth+1)}};
walk(path.join(h,".claude","plugins","cache"),0);
walk(path.join(cx,"plugins","cache"),0);
console.log(hit[0]||"（未找到）")' "$HOME/.agents/skills/context-init"
```
Expected: 打印一个真实存在的 `context-curator` 目录路径，不是「（未找到）」

- [ ] **Step 5: 提交**

```bash
git add skills/context-curator/SKILL.md skills/context-init/SKILL.md
git commit -m "fix: 脚本探测改用 CODEX_HOME，CODEX_PLUGIN_ROOT 并不存在

Codex 0.154 二进制里的 CODEX_* 变量只有 CODEX_HOME / CODEX_SQLITE_HOME /
CODEX_NON_INTERACTIVE 等,没有 CODEX_PLUGIN_ROOT。裸的 PLUGIN_ROOT 确实
存在,但那是 MCP stdio 配置里的路径占位符,不是给 skill 的环境变量。

两份 SKILL.md 的第 0 步探测是同构的重复逻辑,必须同步改,漏一处就是只在
某个平台出现的 bug。顺带补上 <CODEX_HOME>/plugins/cache,与 .claude 侧对称。"
```

---

### Task 4: init SKILL.md 按平台分叉产物与会话源

**Files:**
- Modify: `skills/context-init/SKILL.md`（第 1、4、5、8、9、10 步 + 反模式）

**Interfaces:**
- Consumes: Task 2 产出的 `profile.platform.id`（`'codex'` / `'claude'`）与 `profile.platform.evidence`
- Produces: 无代码接口，是 skill 执行流程的行为契约

- [ ] **Step 1: 第 1 步的探测命令带上 base directory**

把第 1 步的命令改为：

```bash
node "$CCH"/bin/profile-project.js . --pretty --skill-base="<本 skill 的 base directory>"
```

并在输出说明的字段清单里加一行（放在 `context_assets` 那条之前）：

> - `platform`：`{ id, evidence }`。`id` 是 `codex` 或 `claude`，决定主体产物写 `AGENTS.md` 还是 `CLAUDE.md`。判错了可以加 `--platform=codex` 或 `--platform=claude` 重跑，`evidence` 要照抄进第 10 步报告，让用户能发现判错。

- [ ] **Step 2: 第 1 步的目标表按平台分叉**

把现有那张「目标 / 条件」表替换为两张，前面加一句 `先看 platform.id 选表：`。

`platform.id === 'claude'`（表 A，与现状一字不差）：

| 目标 | 条件 |
|---|---|
| `CLAUDE.md` | `context_assets["CLAUDE.md"].exists` 为 false |
| `docs/context/product.md` | `context_assets.docs_context` 里没有 `product.md`，且有 PRD |
| `docs/context/architecture.md` | `context_assets.docs_context` 里没有 `architecture.md` |
| `docs/context/decisions.md` | `context_assets.docs_context` 里没有 `decisions.md`，且 `sessions.count > 0`（还要看第 4 步粗筛结果：粗筛为空同样不生成） |
| `docs/context/glossary.md` | `context_assets.docs_context` 里没有 `glossary.md` |

`platform.id === 'codex'`（表 B）：

| 目标 | 条件 |
|---|---|
| `AGENTS.md`（主体，≤80 行） | `context_assets["AGENTS.md"].exists` 为 false |
| `CLAUDE.md`（3-4 行指针） | `context_assets["CLAUDE.md"].exists` 为 false |
| `docs/context/product.md` | 同表 A |
| `docs/context/architecture.md` | 同表 A |
| `docs/context/decisions.md` | **Codex 下必然不生成**，见第 4 步 |
| `docs/context/glossary.md` | 同表 A |

表 B 后面紧跟三段说明：

> `AGENTS.md` 主体的行数上限是 80 而不是 `CLAUDE.md` 的 100：Codex 下没有会话源，「本项目约定」一节缺了会话原话这个来源（配置文件那一路仍在），「当前状态」的已知问题也没有会话出处可引，内容天然更少。
>
> `AGENTS.md` 已存在：跳过主体，一个字不改（铁律 1），只补 `CLAUDE.md` 指针，并写进报告的「跳过」段。
>
> Codex 下 `sessions.dir` 为 `null`、`sessions.count` 为 `0` 是**设计如此**，不是探测失败——`findProjectDir` 查的是 `~/.claude/projects/`。本步现有的「探测降级」分支只针对 profile 输出 `{}` 或缺 `root`，与 `sessions.count` 无关，别把两件事混起来。

现有这句保留，但限定到表 A：

> （表 A 适用）`AGENTS.md` 已存在而 `CLAUDE.md` 不存在时，`CLAUDE.md` 仍然可写，但其中与 `AGENTS.md` 重复的内容一律改为一行指针「见 `AGENTS.md`」，只保留 `AGENTS.md` 没有的部分（指针表、当前状态）。

- [ ] **Step 3: 第 4 步、第 5 步、第 9 步加平台前置**

第 4 步开头（`sessions.count > 0` 时：`之前`）插入：

> `platform.id === 'codex'` 时**整步跳过**：Codex 的会话记录存在 SQLite thread history（`<CODEX_HOME>/thread_history_1.sqlite`），本插件尚未支持读取。这不是失败，直接进第 5 步，并在第 10 步报告里照第 10 步的写法说明。

第 5 步的 agent 清单里，**会话 agent** 那段开头加一句：

> 仅 `platform.id === 'claude'` 时派。Codex 下没有会话源（第 4 步已跳过），不派会话 agent；代码 agent 与 PRD agent 照常。

第 9 步开头加一句：

> `platform.id === 'codex'` 时跳过本步（`sessions.dir` 为 `null`，没有 `$CC` 可写）。

- [ ] **Step 4: 第 8 步说明模板两用与指针内容**

第 8 步「组装要点」的第一条 `CLAUDE.md` 那项前面，插入一条总说明：

> `templates/claude.template.md` 平台中立，`platform.id === 'codex'` 时用同一份模板组装 `AGENTS.md`，只是产物文件名与行数上限不同（≤80 行），不新增模板文件。

在同一列表末尾追加一条：

> - `CLAUDE.md` 指针（仅 Codex 下、且 `CLAUDE.md` 不存在时）：只有标题、一行指向和页脚，不重复任何规则内容——
>
>   ```markdown
>   # <项目名>
>
>   本项目的 AI 上下文规则见 [`AGENTS.md`](AGENTS.md)。
>
>   > 由 /context-curator:init 于 <YYYY-MM-DD> 生成。来源：PRD <文件名或「无」> · 代码 <git.branch>@<git.head> · 会话 跳过（Codex）。此后由项目负责人维护，可用 /curate 持续更新。
>   ```

同一步 memory 那条追加一句：

> Codex 下没有会话 agent，也就没有 `user` / `feedback` 类输入，因此不写 memory。Codex 自己的 memory 存在 SQLite（`memories_1.sqlite`），本 skill 不碰。

- [ ] **Step 5: 第 10 步报告加平台行与会话说明**

报告模板的「信息源」段改为：

```
信息源
  平台     <codex | claude>（判据：<platform.evidence>）
  PRD      <文件>（<N> 节）/ 无
  代码     <主语言> <文件数> 文件 · <branch>@<head>
  会话     精读 <n> / 共 <count>
  已有资产 <清单>（读入，未改）
```

并在模板下方加一句：

> Codex 下「会话」那行写成 `跳过（Codex 会话存 SQLite thread history，暂不支持挖掘）`，不要写 `0 / 0`——那会让人以为探测坏了。「写入」段里 `AGENTS.md` 与 `CLAUDE.md` 各占一行，指针那行标注「指针」。

「待你处理」段现有那条 `CLAUDE.md 因已存在被跳过时……` 之后追加：

> Codex 下 `AGENTS.md` 已存在被跳过时，同样在「待你处理」里建议用户往其中加一行指向 `docs/context/`，或交给 `/curate`。

- [ ] **Step 6: 反模式追加两条**

在「反模式」列表末尾追加：

```markdown
- ❌ Codex 下看到 `sessions.count` 为 0 就以为探测坏了，转而去乱翻目录找会话记录
- ❌ Codex 下把 `AGENTS.md` 的内容也抄一份进 `CLAUDE.md`——那里只放一行指针
```

- [ ] **Step 7: 核对改动完整性**

Run: `cd /Users/shenjinhua/plugins/context-curator && grep -c 'platform' skills/context-init/SKILL.md && grep -n 'AGENTS.md' skills/context-init/SKILL.md`
Expected: `platform` 出现 10 次以上；`AGENTS.md` 在第 1 步两张表、表 A 说明、第 8 步指针与 memory 说明、第 10 步待处理段都有出现

Run: `cd /Users/shenjinhua/plugins/context-curator && node -e 'const t=require("fs").readFileSync("skills/context-init/SKILL.md","utf8");const m=t.match(/^---\n[\s\S]*?\n---\n/);if(!m)throw new Error("frontmatter 坏了");console.log("frontmatter ok, 全文",t.split("\n").length,"行")'`
Expected: `frontmatter ok`，行数比改动前（248 行）增加

- [ ] **Step 8: 提交**

```bash
git add skills/context-init/SKILL.md
git commit -m "feat(context-init): 按平台分叉产物，Codex 下产 AGENTS.md + CLAUDE.md 指针

第 1 步目标表按 platform.id 分两张:claude 侧一字不变,codex 侧主体写
AGENTS.md(≤80 行)加一份三四行的 CLAUDE.md 指针,一份真内容两边都能读。

会话源在 Codex 下降级为跳过。降级链条现有逻辑本来就承担了(findProjectDir
查 ~/.claude/projects 必然返回 null → count 0 → decisions.md 不生成 →
没有 user/feedback 就不写 memory),所以这次只改措辞不加代码;重点是挡住
执行的 AI 把 count 0 误读成探测失败去乱翻目录。"
```

---

### Task 5: `.codex-plugin/plugin.json` 按官方规范修正

**Files:**
- Modify: `.codex-plugin/plugin.json`（删 `hooks`、加 `interface`、version → 1.2.0）
- Modify: `.claude-plugin/plugin.json`（version → 1.2.0，description 补一句）
- Modify: `.claude-plugin/marketplace.json`（**无 version 字段**，只改 plugin `description`）

**Interfaces:**
- Consumes: 无
- Produces: 一份能过 Codex 官方验证器的 manifest

依据（spec §3.2）：`validate_plugin.py:100-114` 的 `allowed_keys` 不含 `hooks`；`interface` 是 `require_object`，`displayName` / `shortDescription` / `longDescription` / `developerName` / `category` 五项必填非空，`capabilities` 必须是非空字符串数组，`defaultPrompt` 至少一条、最多 3 条、每条 ≤128 字符。

- [ ] **Step 1: 重写 `.codex-plugin/plugin.json`**

整份替换为：

```json
{
  "name": "context-curator",
  "version": "1.2.0",
  "description": "把会话里产生的知识沉淀成项目上下文资产。会话结束时零 token 粗筛攒线索，主动唤起时逐条确认后才写入。另附 context-init skill：从 PRD + 源码为零资产项目一次性生成上下文资产，Codex 下产 AGENTS.md 主体加 CLAUDE.md 指针，只新增不覆盖。",
  "author": {
    "name": "kane313",
    "url": "https://github.com/kane313"
  },
  "homepage": "https://github.com/kane313/context-curator",
  "repository": "https://github.com/kane313/context-curator",
  "license": "MIT",
  "keywords": [
    "context",
    "memory",
    "knowledge-capture",
    "session-history",
    "documentation"
  ],
  "skills": "./skills/",
  "interface": {
    "displayName": "Context Curator",
    "shortDescription": "把会话知识沉淀成项目上下文资产",
    "longDescription": "从历史会话、PRD 与源码里提取值得留下的知识，变成 AGENTS.md / CLAUDE.md 与 docs/context/ 里的事实文档。三条铁律：没有确认不写、没有证据不提、拒绝过的不再提。",
    "developerName": "kane313",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "defaultPrompt": [
      "初始化这个项目的上下文资产",
      "沉淀一下这次会话里的知识",
      "把历史会话扫一遍整理上下文"
    ]
  }
}
```

注意 `hooks` 块整体消失——这同时解决了 spec §4 缺陷 2 的第三处（`CODEX_PLUGIN_ROOT` 的最后一处引用）。

- [ ] **Step 2: 同步另外两份清单**

`.claude-plugin/plugin.json`：`"version": "1.1.0"` → `"1.2.0"`；`description` 末尾在「只新增不覆盖、每段带出处。」之前补「Codex 下产 `AGENTS.md` 主体加 `CLAUDE.md` 指针，」。

`.claude-plugin/marketplace.json`：**没有 `version` 字段，不要加**。只把 `plugins[0].description` 末尾的「另附 /context-curator:init 从 PRD + 源码 + 历史会话初始化零资产项目。」改为「另附 /context-curator:init 从 PRD + 源码 + 历史会话初始化零资产项目，Codex 下产 AGENTS.md。」

- [ ] **Step 3: 三份 JSON 语法自检**

Run:
```bash
cd /Users/shenjinhua/plugins/context-curator && for f in .claude-plugin/plugin.json .codex-plugin/plugin.json .claude-plugin/marketplace.json; do node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("ok",process.argv[1])' "$f"; done
```
Expected: 三行 `ok`

- [ ] **Step 4: 按官方约束逐条自检**

Run:
```bash
cd /Users/shenjinhua/plugins/context-curator && node -e '
const m=JSON.parse(require("fs").readFileSync(".codex-plugin/plugin.json","utf8"));
const allowed=new Set(["id","name","version","description","skills","apps","mcpServers","interface","author","homepage","repository","license","keywords"]);
const bad=Object.keys(m).filter(k=>!allowed.has(k));
if(bad.length)throw new Error("白名单外字段: "+bad);
if(!/^\d+\.\d+\.\d+$/.test(m.version))throw new Error("version 非严格 semver");
for(const f of ["name","version","description"])if(!m[f]||!String(m[f]).trim())throw new Error("缺 "+f);
if(!m.author||!m.author.name)throw new Error("缺 author.name");
if(m.author.url&&!m.author.url.startsWith("https://"))throw new Error("author.url 必须 https");
const i=m.interface;if(!i||typeof i!=="object")throw new Error("缺 interface");
for(const f of ["displayName","shortDescription","longDescription","developerName","category"])
  if(!i[f]||!String(i[f]).trim())throw new Error("缺 interface."+f);
if(!Array.isArray(i.capabilities)||!i.capabilities.length||!i.capabilities.every(v=>typeof v==="string"&&v.trim()))
  throw new Error("interface.capabilities 必须是非空字符串数组");
const dp=i.defaultPrompt||i.default_prompt;
if(!Array.isArray(dp)||!dp.length)throw new Error("缺 interface.defaultPrompt");
if(dp.length>3)throw new Error("defaultPrompt 超过 3 条");
dp.forEach((s,n)=>{if(s.length>128)throw new Error("defaultPrompt["+n+"] 超 128 字符")});
const ifaceAllowed=new Set(["displayName","shortDescription","longDescription","developerName","category","capabilities","websiteURL","privacyPolicyURL","termsOfServiceURL","brandColor","composerIcon","logo","logoDark","screenshots","defaultPrompt","default_prompt"]);
const ibad=Object.keys(i).filter(k=>!ifaceAllowed.has(k));
if(ibad.length)throw new Error("interface 白名单外字段: "+ibad);
if(m.skills&&!require("fs").existsSync(m.skills))throw new Error("skills 路径不存在: "+m.skills);
console.log("按 validate_plugin.py 的约束逐条自检通过")'
```
Expected: `按 validate_plugin.py 的约束逐条自检通过`

- [ ] **Step 5: 尝试跑官方验证器**

官方验证器需要 `pyyaml`，本机未装。用临时 venv 跑，不污染系统 Python：

Run:
```bash
V=/private/tmp/claude-501/-Users-shenjinhua-plugins-context-curator/c0bfefa0-357d-4c22-b089-eec770adcec9/scratchpad/venv
python3 -m venv "$V" && "$V"/bin/pip -q install pyyaml && \
"$V"/bin/python ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/shenjinhua/plugins/context-curator; echo "退出码 $?"
```
Expected: 验证器报通过（退出码 0、无 error 行）。

**如果 venv 或 pip 装不上**（离线等）：跳过本步，Step 4 的逐条自检已覆盖 §3.2 的全部约束。此时 commit message 里必须写明「官方验证器因缺 pyyaml 未跑成，按其约束逐条自检通过」——**不许**只凭肉眼就宣称「通过官方验证」。

- [ ] **Step 6: 提交**

```bash
git add .codex-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "fix(codex): manifest 去掉 hooks、补上 interface，过官方验证器

Codex 官方验证器(~/.codex/skills/.system/plugin-creator/scripts/
validate_plugin.py:100-114)的字段白名单不含 hooks,规范文档末尾也写着
'Validation rejects unsupported manifest fields such as hooks';而
interface 是 require_object,五项必填字符串加 capabilities 与 defaultPrompt
一个都不能少。现有 manifest 两条都不满足,装不上。

删掉 hooks 块同时干掉了 CODEX_PLUGIN_ROOT 的最后一处引用。Codex 下的
hook 改由 README 指导用户配在 config.toml 的 [hooks] 段。

marketplace.json 没有 version 字段(已核实),只改 description。"
```

---

### Task 6: README、AGENTS.md、commands/init.md 文档对齐

**Files:**
- Modify: `README.md`（Codex 安装小节的 hook 位置、两条诚实说明第 2 条、初始化章节、文件表）
- Modify: `AGENTS.md`（加平台判定与两处探测同步的约定）
- Modify: `commands/init.md`（第 2 行 description、第 14 行铁律句）

**Interfaces:**
- Consumes: Task 1-5 的全部结论
- Produces: 与实现一致的对外文档

- [ ] **Step 1: README 的 Codex hook 小节改配置位置**

把「想要会话结束自动攒线索，在 `~/.codex/hooks.json` 里加上（路径换成你的实际路径）：」及其后整个 JSON 代码块，替换为：

> 想要会话结束自动攒线索，Codex 的 hook 配在 `~/.codex/config.toml` 的 `[hooks]` 段（不是 `hooks.json`；Codex 还有一道 hook 信任机制，首次启用要确认）。具体写法请查 Codex 官方文档——**本项目没有在真机上验证过这段 TOML 的确切字段，所以不给可能是错的示例**。
>
> 要执行的命令是：`node <仓库路径>/skills/context-curator/bin/scan-session.js`，事件是 `SessionEnd`，超时 5 秒。
>
> 不配 hook 也能用，只是要靠 `/curate 全量` 手动扫——但先读下面「两条诚实说明」的第 2 条，Codex 下这条路目前走不通。

- [ ] **Step 2: README 的「两条诚实说明」第 2 条整条重写**

替换为：

> 2. **Codex 下的会话挖掘不可用。** Codex 0.154 把会话记录存进 SQLite（`~/.codex/thread_history_1.sqlite`），不再是 Claude Code 那样的 jsonl；legacy 的 rollout jsonl 要靠 `codex migrate-rollouts` 迁进去。本插件的信号提取是照着 Claude Code 的 transcript 格式写的，所以 Codex 下这三条路目前走不通：hook 攒线索、`/curate 结算`、`/curate 全量`。
>
>    Codex 下可用的是：`/curate 当下`（只分析当前对话），以及 `/context-curator:init` 的 PRD + 源码两个信息源——init 在 Codex 下会明确跳过会话这一源并在报告里说明，主体产物是 `AGENTS.md` 加一份 `CLAUDE.md` 指针。
>
>    有 Codex 会话样本、或愿意帮忙验证 SQLite 表结构的话，欢迎提 issue。

- [ ] **Step 3: README 的初始化章节与跨平台章节补平台差异**

- 「跨平台」小节里「Claude Code 与 Codex 的 `SessionEnd` hook payload 字段一致（`session_id` / `transcript_path` / `cwd`），所以两边共用同一个 `scan-session.js`。」后面补一句：「Codex 的 `transcript_path` 可以是 `null`，`scan-session.js` 已经按 falsy 处理并安静退出。」
- 介绍 `/context-curator:init` 产物的地方补一句：「Codex 下主体产 `AGENTS.md`（≤80 行）加一份三四行的 `CLAUDE.md` 指针，`docs/context/` 照旧；平台判错了可以让它带 `--platform=claude` 重跑。」
- 文件表里 `.codex-plugin/plugin.json` 那行的说明保持，无需改动。

- [ ] **Step 4: AGENTS.md 加两条开发约定**

在「## 结构约定」小节末尾追加：

```markdown
平台判定只有一处实现：`lib/profile.js` 的 `detectPlatform()`，由 `bin/profile-project.js` 以 `--skill-base=` / `--platform=` 暴露，输出到 profile 的 `platform` 字段。两份 SKILL.md 只消费这个字段，**不要**在 markdown 里自己写 shell 判平台——理由和上面那条「slug 推导出现两份迟早漂移」是一样的。

两份 SKILL.md 第 0 步的脚本探测片段是同构的重复逻辑（一份找 `lib/scan.js`、一份找 `lib/profile.js`），**改一处必须同步改另一处**，漏一处就是只在某个平台出现的 bug。另外别再往里加 `CODEX_PLUGIN_ROOT`：这个环境变量在 Codex 里不存在，Codex 侧认的是 `CODEX_HOME`（默认 `~/.codex`）。
```

- [ ] **Step 5: commands/init.md 两处补 Codex 产物**

- 第 2 行 frontmatter 的 `description`：`从 PRD + 源码 + 历史会话初始化项目上下文资产（薄 CLAUDE.md + docs/context/），只新增不覆盖` → `从 PRD + 源码 + 历史会话初始化项目上下文资产（薄 CLAUDE.md 或 Codex 下的 AGENTS.md + docs/context/），只新增不覆盖`
- 第 14 行：`严格遵守 skill 的三条铁律：不覆盖任何已有文件、无出处不写、事实进 docs/context/ 规则才进 CLAUDE.md。` → `严格遵守 skill 的三条铁律：不覆盖任何已有文件、无出处不写、事实进 docs/context/ 规则才进 CLAUDE.md（Codex 下规则进 AGENTS.md，CLAUDE.md 只放一行指针）。`

- [ ] **Step 6: 确认 README 里已无错误的 hook 路径**

Run: `cd /Users/shenjinhua/plugins/context-curator && grep -n 'codex/hooks.json' README.md; echo "命中 $? （1 表示已绝迹）"`
Expected: 无输出、`命中 1`

Run: `cd /Users/shenjinhua/plugins/context-curator && grep -n 'thread_history\|config.toml' README.md`
Expected: 两处都有命中（SQLite 说明与 hook 配置位置）

- [ ] **Step 7: 跑全量测试与安装验证数字**

Run: `cd /Users/shenjinhua/plugins/context-curator/skills/context-curator && node --test 2>&1 | tail -8`
Expected: `pass 87` / `fail 0`

README「验证安装」小节写的是「应输出『pass 72』『fail 0』」，改成实测到的数字（预期 87，以实际输出为准）。

- [ ] **Step 8: 提交**

```bash
git add README.md AGENTS.md commands/init.md
git commit -m "docs: 文档对齐 Codex 适配

README:hook 配置位置从 ~/.codex/hooks.json 改为 config.toml 的 [hooks]
段,但不给示例——那段 TOML 的确切字段是从二进制字符串反推的,没实机验证过,
给错的示例比不给更坏。两条诚实说明第 2 条按实情重写:Codex 0.154 会话存
SQLite thread history,hook 攒线索与 /curate 结算/全量 在 Codex 下走不通,
可用的是 /curate 当下 与 init 的 PRD + 源码两源。

AGENTS.md 立两条规矩:平台判定只有 detectPlatform 一处实现;两份 SKILL.md
第 0 步的探测片段必须同步改。"
```

---

## Self-Review

**1. Spec 覆盖检查**

| spec 小节 | 落在哪个任务 |
|---|---|
| §3.1 `transcript_path` 可为 null，无需改 | 无任务（Task 6 Step 3 在 README 里说明）✓ |
| §3.2 白名单与 interface 约束 | Task 5 Step 1、4、5 ✓ |
| §3.3 `CODEX_PLUGIN_ROOT` 不存在 | Task 3（两份 SKILL.md）+ Task 5 Step 1（manifest 第三处）✓ |
| §3.4 会话存 SQLite | Task 4 Step 3、Task 6 Step 2 ✓ |
| §4 三处缺陷 | 缺陷 1 → Task 5；缺陷 2 → Task 3 + Task 5；缺陷 3 → Task 6 Step 1 ✓ |
| §5.1 `detectPlatform` 五条判据 + 实现约束 | Task 1 ✓ |
| §5.2 `profileProject` 输出 `platform` | Task 2 ✓ |
| §5.3 CLI 两个参数与 `=` 形式 | Task 2 ✓ |
| §6.1 目标表分叉 | Task 4 Step 2 ✓ |
| §6.2 跳过与冲突 | Task 4 Step 2（三段说明）+ Step 5（待处理段）✓ |
| §6.3 模板不新增 | Task 4 Step 4 ✓ |
| §7 会话源降级五条措辞 | Task 4 Step 1（第 1 步说明）、3（第 4/5/9 步）、5（第 10 步报告）✓ |
| §8 manifest 修正与验证纪律 | Task 5 ✓ |
| §9 两处探测同步改 | Task 3 ✓ |
| §10 README 四项与 TOML 留白 | Task 6 Step 1-3 ✓ |
| §11 测试用例清单 | Task 1 Step 1（12 个）+ Task 2 Step 1（3 个）✓ |
| §12 文件清单 11 个文件 | 全部有任务覆盖 ✓ |
| §13 不做的事 | 计划里无任何任务触碰 ✓ |

一处偏差已记录：spec §11 预估「新增 6-8 个用例」，实际计划写了 15 个（12 + 3），覆盖更全，总数 72 → 87。

**2. 占位符扫描**

无 TBD / TODO / 「类似 Task N」/ 「加上适当的错误处理」。每个代码步骤都给了完整可粘贴的代码，每个文档步骤都给了完整替换文本。

**3. 类型与命名一致性**

- `detectPlatform(baseDir, opts)` → `{ id, evidence }`：Task 1 定义，Task 2 消费（`opts.skillBase` / `opts.platform` → `override`），Task 4 消费（`platform.id` / `platform.evidence`）。三处命名一致 ✓
- `under(child, parent)`：Task 1 定义并导出，仅 Task 1 测试使用 ✓
- `'codex'` / `'claude'` 两个字面量：Task 1、2、4 一致，无第三种取值 ✓
- CLI 参数名 `--skill-base=` / `--platform=`：Task 2 实现、Task 4 Step 1 使用、Task 6 Step 3 文档提及，三处一致 ✓
- `module.exports` 里新增两项与 Task 2 的 `profileProject` 改动不冲突 ✓
