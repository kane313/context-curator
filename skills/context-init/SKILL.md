---
name: context-init
description: Use when the user wants to bootstrap context assets for a local project from scratch — triggers on "初始化上下文", "初始化项目上下文资产", "接手这个项目", "从 PRD 建 CLAUDE.md", "给这个项目建 CLAUDE.md", "bootstrap context", "init context assets", or when a project has no CLAUDE.md and the user hands over a PRD. Reads the PRD, the local source code and the project's past session transcripts, then generates a thin CLAUDE.md plus docs/context/ fact documents. Only creates new files, never overwrites; every statement cites PRD section, code path or session line.
---

# 初始化项目上下文资产

从三个信息源（用户给的 PRD、本地源码、该项目的历史会话）为一个项目**首次**建立上下文资产：一份薄 `CLAUDE.md` 加 `docs/context/` 下几份事实文档，必要时补 memory。

与 `context-curator` skill 的分工：那个是持续养护（攒几个会话跑一次，对已有资产提逐条改动建议）；这个是首次接手（一次生成整份新文件）。初始化完成后交给 `/curate` 持续更新。

## 铁律

1. **不覆盖任何已有文件。** 目标路径已存在就跳过并写进报告，一个字不改。唯一例外：memory 目录下的 `MEMORY.md` 可以**追加**一行索引，已有行一个字不改。
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

探测不到（输出为空）就告诉用户「context-init 依赖同插件的 context-curator skill，请确认插件完整安装」，然后停止。

### 第 1 步：探测项目

```bash
node "$CCH"/bin/profile-project.js . --pretty --skill-base="<本 skill 的 base directory>"
```

输出是一份 JSON，全是确定性事实，拿来就用，不要自己再猜一遍。重点看：

- `platform`：`{ id, evidence }`。`id` 是 `codex` 或 `claude`，决定主体产物写 `AGENTS.md` 还是 `CLAUDE.md`。判错了可以加 `--platform=codex` 或 `--platform=claude` 重跑，`evidence` 要照抄进第 10 步报告，让用户能发现判错。
- `context_assets`：哪些目标文件已存在（决定跳过什么）、已有 `docs/` 清单、memory 目录
- `sessions.dir` / `sessions.count`：有没有历史会话可挖
- `manifests` / `suggested_commands` / `entrypoints` / `tree` / `languages`：技术栈、命令、入口、目录。`tooling` 与 `entrypoints` 只探测仓库根，为空不代表没有——代码 agent 精读时补
- `git`：分支与短 commit（写进页脚）；`git.toplevel` 与 `root` 不一致时说明当前目录不是仓库根，git 事实属于外层仓库，页脚照写但报告里注明
- `truncated` 为 true 时在报告里注明「文件数超过两万，语言统计不完整」

输出是 `{}` 或缺 `root` 时降级：主会话自己 `ls` 顶层目录、读 README，报告里标注「探测降级」。

先按 `context_assets` 算出**本次能写的目标**：

`context_assets.docs_context` 是直接读 `docs/context/` 目录得到的，不受 `docs` 列表 50 个上限影响，判断是否已存在只看它。

先看 `platform.id` 选表。

`platform.id === 'claude'`（表 A）：

| 目标 | 条件 |
|---|---|
| `CLAUDE.md` | `context_assets["CLAUDE.md"].exists` 为 false |
| `docs/context/product.md` | `context_assets.docs_context` 里没有 `product.md`，且有 PRD |
| `docs/context/architecture.md` | `context_assets.docs_context` 里没有 `architecture.md` |
| `docs/context/decisions.md` | `context_assets.docs_context` 里没有 `decisions.md`，且 `sessions.count > 0`（还要看第 4 步粗筛结果：粗筛为空同样不生成） |
| `docs/context/glossary.md` | `context_assets.docs_context` 里没有 `glossary.md` |

表 A 适用：`AGENTS.md` 已存在而 `CLAUDE.md` 不存在时，`CLAUDE.md` 仍然可写，但其中与 `AGENTS.md` 重复的内容一律改为一行指针「见 `AGENTS.md`」，只保留 `AGENTS.md` 没有的部分（指针表、当前状态）。

`platform.id === 'codex'`（表 B）：

| 目标 | 条件 |
|---|---|
| `AGENTS.md`（主体，≤80 行） | `context_assets["AGENTS.md"].exists` 为 false |
| `CLAUDE.md`（3-4 行指针） | `context_assets["CLAUDE.md"].exists` 为 false |
| `docs/context/product.md` | 同表 A |
| `docs/context/architecture.md` | 同表 A |
| `docs/context/decisions.md` | **Codex 下必然不生成**，见第 4 步 |
| `docs/context/glossary.md` | 同表 A |

`AGENTS.md` 主体的行数上限是 80 而不是 `CLAUDE.md` 的 100：Codex 下没有会话源，「本项目约定」一节缺了会话原话这个来源（配置文件那一路仍在），「当前状态」的已知问题也没有会话出处可引，内容天然更少。

`AGENTS.md` 已存在：跳过主体，一个字不改（铁律 1），只补 `CLAUDE.md` 指针，并写进报告的「跳过」段。

Codex 下 `sessions.dir` 为 `null`、`sessions.count` 为 `0` 是**设计如此**，不是探测失败——`findProjectDir` 查的是 `~/.claude/projects/`。本步上面那个「探测降级」分支只针对 profile 输出 `{}` 或缺 `root`，与 `sessions.count` 无关，别把两件事混起来。

全部目标都已存在时，报告「没有可新增的文件」，建议用户跑 `/curate 全量`，然后停止。**不写任何东西。**

### 第 2 步：读入已有资产

按 `context_assets` 清单读：`CLAUDE.md`、`AGENTS.md`、`README.md`、`docs/**/*.md`、`.claude/rules/*.md`、memory 目录下的文件。用途只有两个：避免生成重复内容；让本次生成的 `CLAUDE.md` 指针表指向已有文档而不是再写一份。**不改它们。**

已有 `docs/` 里有同主题文档（比如 `docs/architecture.md`）时，本次对应文件里该小节改为一行指针。

### 第 3 步：读 PRD

用 Read 读文件（pdf 用 `pages` 参数分段）。PRD 不超过 400 行（pdf 不超过 15 页）时主会话自己读并摘要；更长时派一个子 agent，指令：

> 读 `<PRD 文件>`，返回结构化摘要 JSON：`{ one_liner, goals:[{text, ref}], users:[{text, ref}], scenarios:[{text, ref}], features:[{name, desc, ref}], rules:[{text, ref}], nfr:[{text, ref}], terms:[{term, definition, ref}] }`。`ref` 写章节号或标题（pdf 写页码）。不要补充 PRD 没写的内容；找不到的字段留空数组。

### 第 4 步：粗筛会话

`platform.id === 'codex'` 时**整步跳过**：Codex 的会话记录存在 SQLite thread history（`<CODEX_HOME>/thread_history_1.sqlite`），本插件尚未支持读取。这不是失败，直接进第 5 步，并按第 10 步的写法在报告里说明。

`platform.id === 'claude'` 且 `sessions.count > 0` 时：

```bash
node "$CCH"/bin/harvest.js "<sessions.dir>" --min-score 5
```

按 score 降序取前 N 个（`--sessions N`，默认 10）。结果为空就跳过会话这一源，报告里说明「历史会话里没有高信号线索」。

粗筛结果里可能含**当前这次会话**（你正在执行初始化的这一份记录）。把它剔除：会话 agent 读到的内容若是本次初始化的对话（出现 `/context-curator:init`、本 skill 的步骤名），整份跳过。

### 第 5 步：并行精读

主会话**不读原始 jsonl、不通读源码**，派子 agent，一次性并行发出：

**代码 agent。** 含源码文件的顶层目录（`tree` 里 `files > 0`，排除 `docs`、`test`、`tests`、`integration_test` 这类目录）不超过 3 个时一个 agent，否则按顶层目录分给最多 4 个。指令要点：

> 你在分析项目 `<root>` 的 `<目录清单>`。只读，不改任何文件。
> 已知探测事实：`<manifests、entrypoints、tree 对应片段、suggested_commands>`。
> 任务：
> 1. 从入口文件出发，读该范围内的关键文件（入口、路由或注册表、基类、配置），概括：模块职责、分层与依赖方向、数据流、外部依赖与三方服务。每条结论必须带代码路径。
> 2. 对照这份 PRD 功能清单：`<features 或「无」>`，逐项判断 已实现 / 部分 / 未实现，给代码位置；判不出写「待核实」。另列代码里有但清单没提的功能。
> 3. 观察到的约定：只报在 3 处以上一致出现的模式，或有配置文件（lint、analysis_options）支撑的，附路径。（这类『从代码模式观察到的约定』只能进 `architecture.md`，不进 `CLAUDE.md`——`CLAUDE.md` 的约定只收会话原话或配置文件能证明的。）
> 4. 领域术语：类名、表名、枚举里出现的业务名词，附路径。
> 返回 JSON：`{ modules:[{name, path, responsibility, evidence}], layering:[{text, evidence}], data_flow:[{text, evidence}], external_deps:[{name, evidence}], prd_status:[{feature, status, path, note}], extra_features:[{name, path}], conventions:[{rule, evidence}], terms:[{term, identifier, path}] }`。
> 宁缺毋滥：证据指不出来的不要写。

**PRD agent。** 仅当第 3 步判定需要（PRD 超过 400 行）。

**会话 agent。** 仅 `platform.id === 'claude'` 时派。Codex 下没有会话源（第 4 步已跳过），不派会话 agent；代码 agent 与 PRD agent 照常。每 2-3 个会话一个，指令要点：

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
- 原话里含密钥、令牌、手机号邮箱等个人信息、仓库外的绝对路径的——不逐字引用，改为转述并在证据里标「（原话含敏感内容，已转述）」
- 没有出处的任何一条

### 第 8 步：生成与写入

按 `templates/` 下的模板组装，模板路径是本 skill base directory 下的 `templates/*.template.md`。模板里 `{…}` 是占位、括号里的斜体说明是给你的指令，落地时全部替换或删掉，**不要把占位符和说明留在产物里**。

`templates/claude.template.md` 平台中立，`platform.id === 'codex'` 时用同一份模板组装 `AGENTS.md`，只是产物文件名与行数上限不同（≤80 行），不新增模板文件。

组装要点：

- `CLAUDE.md`（表 A）/ `AGENTS.md`（表 B）主体：不超过 100 行 / 80 行；证据不足就更短，铁律 2 优先，不为凑行数编内容。「本项目约定」只收有出处的；一条都没有就写「暂无有据可查的约定，跑 `/curate` 持续沉淀」。「深入阅读」表里本次没生成的行删掉，已有 `docs/` 里相关的文档加进来。
- `product.md`：PRD 什么语言就什么语言，不翻译。对照表状态只用 已实现 / 部分 / 未实现 / PRD 未提 四种，加「待核实」标记。
- `architecture.md`：按顶层目录组织模块小节。
- `decisions.md`：按时间倒序。
- `glossary.md`：PRD 与代码都有术语时出对照表；只有其一时出单列表；两边都没有可用术语时不生成。
- memory：仅当会话 agent 返回了 `user` / `feedback` 类。写到 `context_assets.memory.dir`，memory 目录里已有文件时沿用它们的 frontmatter 形态与文件名风格；没有时用下面的格式。一条一个文件，frontmatter 格式：

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

  Codex 下没有会话 agent，也就没有 `user` / `feedback` 类输入，因此不写 memory。Codex 自己的 memory 存在 SQLite（`memories_1.sqlite`），本 skill 不碰。

- `CLAUDE.md` 指针（仅 `platform.id === 'codex'` 且 `CLAUDE.md` 不存在时）：只有标题、一行指向和页脚，不重复任何规则内容——

  ```markdown
  # <项目名>

  本项目的 AI 上下文规则见 [`AGENTS.md`](AGENTS.md)。

  > 由 /context-curator:init 于 <YYYY-MM-DD> 生成。来源：PRD <文件名或「无」> · 代码 <git.branch>@<git.head> · 会话 跳过（Codex）。此后由项目负责人维护，可用 /curate 持续更新。
  ```

- 每个生成文件末尾加页脚（上面的 `CLAUDE.md` 指针已自带页脚，不要再贴一遍）：

  ```
  > 由 /context-curator:init 于 <YYYY-MM-DD> 生成。来源：PRD <文件名或「无」> · 代码 <git.branch>@<git.head> · 会话 <精读数> 个。此后由项目负责人维护，可用 /curate 持续更新。
  ```

写入规则：

- `--dry-run`：把每个文件的完整内容打印出来，文件名做标题，不写盘。
- 否则用 Write 工具逐个写。**写之前再查一次目标是否存在**，存在就跳过。`docs/context/` 目录不存在由 Write 自动创建。
- 脚本不参与写入。
- 全部会话 agent 都返回空时，不生成 `decisions.md`，进报告的「未生成（证据不足）」。

### 第 9 步：记状态

`platform.id === 'codex'` 时跳过本步（`sessions.dir` 为 `null`，没有 `$CC` 可写）。

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
  平台     <codex | claude>（判据：<platform.evidence>）
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
  MEMORY.md                      追加 <N> 行索引

跳过（已存在，未改）
  <文件> → <处理方式，如：已在 CLAUDE.md 指针表里引用>

未生成（证据不足）
  docs/context/decisions.md → 历史会话里没有 score ≥ 5 的线索

⚠️ 待你处理
  - <填不出的字段 / 待核实的条目 / 探测降级 / 统计截断>
  - decisions.md 引用了会话原话，提交前请通读一遍确认没有敏感信息

下一步：攒几个会话后跑 /curate 结算 持续养护。
```

Codex 下「会话」那行写成 `跳过（Codex 会话存 SQLite thread history，暂不支持挖掘）`，不要写 `0 / 0`——那会让人以为探测坏了。「写入」段里 `AGENTS.md` 与 `CLAUDE.md` 各占一行，指针那行标注「指针」。

`CLAUDE.md` 因已存在被跳过时，在「待你处理」里建议用户在其中加一行指向 `docs/context/`，或交给 `/curate`。

Codex 下 `AGENTS.md` 已存在被跳过时，同样在「待你处理」里建议用户往其中加一行指向 `docs/context/`，或交给 `/curate`。

## 反模式

- ❌ 为了让文件看起来充实，把 PRD 没写的内容补进 `product.md`
- ❌ 把函数签名、字段列表抄进 `architecture.md`——读代码就知道的不写
- ❌ 会话里 AI 自己说的话当成「决策」
- ❌ 把 PRD 事实写进 `CLAUDE.md`（那是 `docs/context/` 的活）
- ❌ 目标文件已存在还「顺手合并一下」——一个字都不改
- ❌ 没有会话记录时硬生成一份空的 `decisions.md`
- ❌ Codex 下看到 `sessions.count` 为 0 就以为探测坏了，转而去乱翻目录找会话记录
- ❌ Codex 下把 `AGENTS.md` 的内容也抄一份进 `CLAUDE.md`——那里只放一行指针
