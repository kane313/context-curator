# Codex 适配设计：让 context-init 在 Codex 下产出正确资产

日期：2026-09-17
状态：已批准（设计在会话中逐项确认）

## 1. 目标

让 `/context-curator:init`（`skills/context-init`）在 Codex 下跑得通、产出对的东西：主体写 `AGENTS.md` 而不是 `CLAUDE.md`，脚本按 Codex 的实际路径探测，历史会话这一源明确降级为跳过。同时修掉三处已确认的 Codex 侧缺陷。

**不在本次范围**：读取 Codex 的会话记录。Codex 0.154 把会话存进 SQLite（见 §3.4），做这件事要引入一个新的会话读取后端，且本机无样本可验证，留待将来。

## 2. 已定决策

以下四条由用户在设计阶段确认，实现时不再重议：

1. **适配深度**：产物侧 + manifest，会话源在 Codex 下降级为跳过。不碰 SQLite，不把「零依赖」门槛从 Node 18 抬到 Node 22+。
2. **产物形态**：Codex 下 `AGENTS.md` 为主体（≤80 行），外加一份 3-4 行的 `CLAUDE.md` 指针指向它。一份真内容两边都能读，不会漂移。`AGENTS.md` 已存在时跳主体、只补指针。
3. **hook 承诺**：`.codex-plugin/plugin.json` 不放 `hooks` 字段（官方验证器拒收，见 §3.2），README 改为指向 `config.toml` 的 `[hooks]` 段，并诚实写明 Codex transcript 格式未验证、队列可能一直为空。
4. **平台判定层**：放脚本层（`lib/profile.js`），由 `profile-project.js` 输出 `platform` 字段，SKILL.md 消费。不在 SKILL.md 里写 shell 判定——`AGENTS.md` 已立过规矩：同一套逻辑出现两份迟早漂移。

## 3. 探测到的 Codex 事实

本次适配的依据全部来自本机 Codex 0.154.0 的官方文件，不是推测。证据来源：

- 官方插件规范：`~/.codex/skills/.system/plugin-creator/references/plugin-json-spec.md`
- 官方验证器：`~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py`
- 主二进制：`/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex`
- `codex doctor` 输出

### 3.1 SessionEnd hook payload

从二进制提取的 `session-end.command.input` JSON schema：

```json
{ "cwd": "string", "hook_event_name": "SessionEnd", "reason": "other",
  "session_id": "string", "transcript_path": "string | null" }
```

字段名与 Claude Code 一致（README 第 122 行那句话成立）。`transcript_path` 可为 `null`，而 `bin/scan-session.js:20` 的 `if (!transcript || !sessionId) return;` 已经覆盖了这种情况——**这里没有缺陷，不需要改**。

### 3.2 plugin.json 字段白名单不含 hooks

`validate_plugin.py:100-114` 的 `allowed_keys`：

```
{id, name, version, description, skills, apps, mcpServers, interface,
 author, homepage, repository, license, keywords}
```

任何白名单外的键报 `` plugin.json field `<key>` is not accepted by plugin validation ``。规范文档末尾自己也写着 "Validation rejects unsupported manifest fields such as `hooks`"。

`interface` 是 `require_object`（`validate_plugin.py:148`）：`displayName`、`shortDescription`、`longDescription`、`developerName`、`category` 五项必填非空字符串；`capabilities` 必须是非空字符串数组；`defaultPrompt` 或 `default_prompt` 至少有一个，最多 3 条、每条 ≤128 字符；`author.url` 与 `interface` 里三个 URL 字段若存在必须是绝对 `https://`。

### 3.3 CODEX_PLUGIN_ROOT 不存在

二进制里的 `CODEX_*` 环境变量名只有：`CODEX_HOME`（67 处）、`CODEX_SQLITE_HOME`、`CODEX_NON_INTERACTIVE`、`CODEX_ACCESS_TOKEN` 等，**没有 `CODEX_PLUGIN_ROOT`**。裸的 `PLUGIN_ROOT` 确实存在，但语境是 MCP stdio 配置里的路径占位符（"Agent Plugins stdio `cwd` must be a contained `./`, `${PLUGIN_ROOT}`, or `${PLUGIN_DATA}` path"），不是给 hook/skill 的环境变量，不能用来定位脚本。

`CODEX_HOME` 在 Codex 自带 skill 里的惯用写法是 `${CODEX_HOME:-$HOME/.codex}`——带 `:-` 兜底，说明 Codex **不保证**把它注入子进程。所以它可以作判据，但不能是唯一判据。

### 3.4 会话记录已迁至 SQLite

`codex doctor` 报 `thread history DB  ~/.codex/thread_history_1.sqlite`。二进制里另有 `memories_1.sqlite`、`state_5.sqlite`、`logs_2.sqlite`、`goals_1.sqlite`、`queue_1.sqlite`，以及 `rollout_ordinal` / `rollout_byte_offset` 字段和 `codex migrate-rollouts` 子命令（把 legacy rollout jsonl 迁进 thread history）。

`lib/paths.js` 按 `~/.claude/projects/<slug>/*.jsonl` 找会话的那套逻辑在 Codex 下完全不成立。

### 3.5 skill 与插件的发现目录

二进制里 `.agents/plugins` 出现 22 次（`~/.agents/plugins/marketplace.json` 是插件市场默认位置），`.codex/skills` 2 次，`.agents/skills` 1 次。README 现在写的 `~/.agents/skills/` 可行，`<CODEX_HOME>/skills/` 同样被支持。

### 3.6 Codex 有自己的 memory 机制

`memories_1.sqlite` + `~/.codex/memories/` 目录 + 二进制里的 `memory_consolidate_global`。init 现在往 `~/.claude/projects/<slug>/memory/` 写 memory 这条路在 Codex 下无意义——但见 §7，这条在本次范围内自动消解，不需要专门处理。

### 3.7 本机无 Codex 会话样本

`thread_history_1.sqlite` 不存在，找不到任何 rollout jsonl，`~/.codex/memories/` 为空。这是决策 1 把会话源排除在范围外的直接原因：做了也无法验证。

## 4. 确定要修的三处缺陷

| # | 位置 | 问题 |
|---|---|---|
| 1 | `.codex-plugin/plugin.json` | 内联了 `hooks` 对象（白名单拒收，且格式也不对——规范里 `hooks` 是字符串路径而非对象）；缺必填的 `interface` 块。两者都会让 manifest 校验失败 |
| 2 | `skills/context-curator/SKILL.md:40`、`skills/context-init/SKILL.md:43`、`.codex-plugin/plugin.json:27` | 用了不存在的 `CODEX_PLUGIN_ROOT` |
| 3 | `README.md:80` | hook 配置位置写成 `~/.codex/hooks.json`，实际在 `config.toml` 的 `[hooks]` 段 |

## 5. 平台判定

### 5.1 `lib/profile.js` 新增 `detectPlatform(baseDir)`

返回 `{ id: 'codex' | 'claude', evidence: '<一句话判据>' }`。按可靠性降序，命中即返回：

| 序 | 判据 | 结论 |
|---|---|---|
| 1 | `baseDir` 落在 `~/.agents/skills/` 或 `<CODEX_HOME>/skills/` 之下（`CODEX_HOME` 未设时即 `~/.codex/skills/`，是同一条判据的两种取值） | codex |
| 2 | `baseDir` 落在 `~/.claude/` 之下（含 `plugins/cache`） | claude |
| 3 | `CODEX_HOME` 非空，且 `CLAUDE_PLUGIN_ROOT`、`CLAUDE_CONFIG_DIR` 均为空 | codex |
| 4 | `CLAUDE_PLUGIN_ROOT` 或 `CLAUDE_CONFIG_DIR` 非空 | claude |
| 5 | 兜底 | claude，evidence 注明「默认」 |

把安装位置排在环境变量之前，理由见 §3.3：`CODEX_HOME` 不保证被注入，而 init 第 0 步本来就已经拿到 base directory，那是「谁在加载我」的直接证据。

实现约束：

- `baseDir` 为空、未传或不是字符串时，跳过判据 1、2，从判据 3 开始。
- 路径比较前先 `path.resolve`，并按 `path.sep` 边界匹配，避免 `~/.claude-backup` 之类的前缀误命中。
- 与 `lib/profile.js` 其余部分一致：任何 `fs` / 环境访问失败都不抛，退到下一条判据，最终兜底 claude。

### 5.2 `profileProject` 输出新字段

顶层新增 `platform: { id, evidence }`。`profileProject(root, opts)` 从 `opts.skillBase` 取 base directory、`opts.platform` 取用户覆盖值；`opts.platform` 是 `'codex'` 或 `'claude'` 时直接采用，evidence 写「用户显式指定」。

### 5.3 `bin/profile-project.js` 新增两个参数

```
node profile-project.js [项目根目录] [--pretty] [--skill-base=<path>] [--platform=<id>]
```

**必须用 `=` 形式**：现有参数解析是 `args.find(a => !a.startsWith('--'))` 取项目根目录，写成 `--skill-base /some/path` 会让 `/some/path` 被当成项目根目录。`--platform` 只接受 `codex` / `claude`，其他值忽略（走自动判定），不报错——与「任何失败都 exit 0」的既有纪律一致。

## 6. 产物路由

### 6.1 SKILL.md 第 1 步的目标表按平台分叉

`platform.id === 'codex'` 时：

| 目标 | 条件 |
|---|---|
| `AGENTS.md`（主体，≤80 行，见下注） | `context_assets["AGENTS.md"].exists` 为 false |
| `CLAUDE.md`（3-4 行指针） | `context_assets["CLAUDE.md"].exists` 为 false |
| `docs/context/product.md` | 同现状（不含 `product.md` 且有 PRD） |
| `docs/context/architecture.md` | 同现状 |
| `docs/context/decisions.md` | 见 §7——Codex 下必然不生成 |
| `docs/context/glossary.md` | 同现状 |

行数上限之所以是 80 而非 claude 路径下 `CLAUDE.md` 的 100：Codex 下没有会话源，「本项目约定」一节缺了会话原话这个来源（配置文件那一路仍在），「当前状态」的已知问题也没有会话出处可引，内容天然更少。100 行的上限留给 claude 路径，不改。

`platform.id === 'claude'` 时**行为一字不变**，包括现有那条「`AGENTS.md` 已存在而 `CLAUDE.md` 不存在时，`CLAUDE.md` 里与 `AGENTS.md` 重复的内容改为一行指针」。

### 6.2 跳过与冲突

- `AGENTS.md` 已存在：跳主体一个字不改（铁律 1），只补 `CLAUDE.md` 指针，并在报告「跳过」段写明。
- `AGENTS.md` 与 `CLAUDE.md` 都已存在：只产 `docs/context/`；两者都无可写时报「没有可新增的文件」并停止，与现状一致。
- 主体写成 `AGENTS.md` 后，`CLAUDE.md` 指针的内容固定为项目名 + 一行「本项目的 AI 上下文规则见 `AGENTS.md`」+ 页脚，不重复任何规则内容。

### 6.3 模板

不新增模板文件。`templates/claude.template.md` 本身是平台中立的（差异只在产物文件名），SKILL.md 第 8 步说明它同时用于 `CLAUDE.md` 与 `AGENTS.md`。`CLAUDE.md` 指针不用模板，内容太短。

## 7. 会话源降级

降级链条**现有逻辑已经承担**，不需要新增降级代码：

- Codex 下 `paths.findProjectDir` 查的是 `~/.claude/projects/`，必然返回 `null` → `sessions: { dir: null, count: 0 }`。
- `decisions.md` 的生成条件已经是 `sessions.count > 0` → 必然不生成。
- memory 的输入只来自会话 agent 的 `user` / `feedback` 类 → 没有会话 agent 就没有 memory 可写，§3.6 那个问题因此自动消解。
- 第 9 步记状态的前置条件已经是 `sessions.dir` 非空 → 必然跳过。

所以本节要改的是**措辞而非逻辑**。SKILL.md 需要补的内容：

- 第 4 步（粗筛会话）开头加平台前置：`platform.id === 'codex'` 时整步跳过，理由是 Codex 会话存 SQLite thread history、本插件尚未支持读取——**不是探测失败**。
- 第 5 步（并行精读）：Codex 下不派会话 agent，代码 agent 与 PRD agent 照常。
- 第 9 步：重申 Codex 下跳过。
- 第 10 步报告的「信息源」段，会话一行在 Codex 下写成明确说明而不是 `0 / 0`，例如：`会话  跳过（Codex 会话存 SQLite thread history，暂不支持挖掘）`。
- 第 1 步要写明：Codex 下 `sessions.dir` 为 `null`、`count` 为 `0` 是设计如此。现有的「探测降级」分支只针对 profile 输出 `{}` 或缺 `root`，与 `sessions.count` 无关，不要把这两件事混起来。

这一条的价值在于挡住执行的 AI 误判：看到 `count: 0` 以为探测坏了，转而去乱翻目录找会话。

## 8. manifest 修正

`.codex-plugin/plugin.json`：

- 删掉整个 `hooks` 块（缺陷 1 与缺陷 2 的第三处一并解决）。
- 新增 `interface`，七项按 §3.2 的约束填：`displayName`、`shortDescription`、`longDescription`、`developerName`、`category`（用 `Productivity`）、`capabilities`（`["Interactive", "Write"]`——本插件确实交互式且会写文件）、`defaultPrompt`（3 条，各约 50 字符以内）。
- `version` 1.1.0 → 1.2.0，`description` 补一句 Codex 下产 `AGENTS.md`。
- `.claude-plugin/plugin.json` 的 `version` 同步到 1.2.0。`.claude-plugin/marketplace.json` **没有 `version` 字段**（已核实），本次只在它的 plugin `description` 里补一句 Codex 下产 `AGENTS.md`。

验证：本机 `validate_plugin.py` 需要 `pyyaml`（未安装）。实现阶段要么装 `pyyaml` 后跑一次真验证，要么按 §3.2 逐条人工核对并在计划里写明没跑成官方验证器。**不得**只凭肉眼就宣称"通过验证"。

## 9. 脚本定位探测修正

`skills/context-curator/SKILL.md` 第 0 步与 `skills/context-init/SKILL.md` 第 0 步的探测片段，把 `CODEX_PLUGIN_ROOT` 那行替换为 `CODEX_HOME`（默认 `~/.codex`）下的 `skills/`，并补一条 `walk(<codexHome>/plugins/cache)`，与现有的 `~/.claude/plugins/cache` 对称：

```js
const cx = process.env.CODEX_HOME || path.join(h, ".codex");
push(path.join(cx, "skills", "context-curator"));
push(path.join(h, ".agents", "skills", "context-curator"));   // 已有，保留
walk(path.join(cx, "plugins", "cache"), 0);                   // 新增
```

两份 SKILL.md 的这段探测逻辑本来就是重复的（一份找 `lib/scan.js`、一份找 `lib/profile.js`），本次保持现状不合并——合并要动 skill 的自包含性，超出本次范围。但两处必须同步改，漏一处就是一个只在某个平台出现的 bug。

## 10. README 修正

- 「安装 · Codex」小节：hook 配置位置从 `~/.codex/hooks.json` 改为 `~/.codex/config.toml` 的 `[hooks]` 段。
- 「两条诚实说明」第 2 条按 §3.4 重写：Codex 0.154 会话存 SQLite thread history，本插件的会话挖掘（hook 攒线索、`/curate 结算`、`/curate 全量`）在 Codex 下不可用；可用的是 `/curate 当下` 与 init 的 PRD + 代码两源。
- 「初始化」相关章节补一句：Codex 下主体产 `AGENTS.md` + `CLAUDE.md` 指针。
- 可选：补 `~/.agents/plugins/marketplace.json` 作为 Codex 插件市场位置。

**留白**：`[hooks]` 段的 TOML 具体写法是从二进制字符串反推的（`HookEventsToml` / `HookHandlerConfig` 的 `type="command"` + `command` + `timeout`），未实测。README 只写「hook 配在 `~/.codex/config.toml` 的 `[hooks]` 段」并指向 Codex 官方文档，**不给**反推的示例。理由与 README 里原有那两条诚实说明一致：给错的示例比不给示例更坏。实现阶段若能实测确认写法，再补示例。

## 11. 测试

`test/profile.test.js` 新增用例，基线 72 pass / 0 fail：

- `detectPlatform` 五条判据各一例（判据 1 用 `~/.agents/skills/x` 与 `<CODEX_HOME>/skills/x` 两种路径）
- `baseDir` 为空 / 非字符串时从判据 3 起判
- `~/.claude-backup` 这类前缀不误命中判据 2
- `opts.platform` 显式覆盖生效，非法值回落自动判定
- `profileProject` 输出含 `platform.id` 与 `platform.evidence`
- `profile-project.js --platform=codex --skill-base=<path>` 端到端，且 `--skill-base=` 的值不被误当项目根目录

环境变量相关用例必须在 `try/finally` 里存取原值，避免污染同进程内其他测试。

## 12. 文件清单

| 文件 | 改动 |
|---|---|
| `skills/context-curator/lib/profile.js` | + `detectPlatform()`；`profileProject` 输出 `platform`、接收 `opts.skillBase` / `opts.platform` |
| `skills/context-curator/bin/profile-project.js` | + `--skill-base=` / `--platform=` 两个参数 |
| `skills/context-curator/test/profile.test.js` | + §11 的用例 |
| `skills/context-init/SKILL.md` | 第 0 步探测改 `CODEX_HOME`；第 1 步目标表按平台分叉；第 4/5/9 步加平台前置；第 8 步说明模板两用与 `CLAUDE.md` 指针；第 10 步报告加平台行与会话说明 |
| `skills/context-curator/SKILL.md` | 第 0 步探测改 `CODEX_HOME` |
| `.codex-plugin/plugin.json` | 删 `hooks`；+ `interface`；version 1.2.0 |
| `.claude-plugin/plugin.json` | version 1.2.0 |
| `.claude-plugin/marketplace.json` | 无 version 字段；仅 plugin `description` 补一句 Codex 产物 |
| `README.md` | §10 的四项 |
| `AGENTS.md` | + 一句：平台判定在 `lib/profile.js`，两份 SKILL.md 的第 0 步探测必须同步改 |
| `commands/init.md` | 第 2 行 `description` 与第 14 行铁律句都提到 `CLAUDE.md`，各补一句 Codex 下主体为 `AGENTS.md` |

## 13. 不做的事

- ❌ 读 Codex 的 SQLite 会话记录（决策 1；且会把零依赖门槛从 Node 18 抬到 Node 22+）
- ❌ 写 Codex 的 `memories_1.sqlite` 或 `~/.codex/memories/`（那是 Codex 内部状态，写坏了风险高；且 §7 说明本次没有 memory 输入）
- ❌ 在 manifest 里赌 `hooks` 的运行时支持（决策 3）
- ❌ 给未实测的 TOML 示例（§10 留白）
- ❌ 合并两份 SKILL.md 的第 0 步探测逻辑（动 skill 自包含性，超范围）
- ❌ 为 Codex 新增 `agents.template.md`（§6.3，模板本就平台中立）
- ❌ 改 `bin/scan-session.js`（§3.1，`transcript_path` 为 null 已被覆盖）
