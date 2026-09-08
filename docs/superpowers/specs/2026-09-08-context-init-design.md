# context-init 设计：从 PRD + 源码 + 历史会话初始化项目上下文资产

日期：2026-09-08
状态：已批准（设计在会话中逐项确认）

## 1. 目标

给 context-curator 插件新增一个 skill `context-init`，用于**首次**给一个本地项目建立上下文资产。输入三个信息源（用户提供的 PRD、本地源码、该项目的历史 Claude Code 会话记录），产出一份薄 `CLAUDE.md` 和 `docs/context/` 下的几份事实文档，必要时补 memory。

它与现有 `context-curator` skill 的分工：

| | context-curator（已有） | context-init（新增） |
|---|---|---|
| 时机 | 持续养护，每攒几个会话跑一次 | 首次接手 / 项目零资产时跑一次 |
| 数据源 | 会话为主 | PRD + 代码 + 会话 + 已有资产 |
| 产物 | 对已有资产的逐条改动建议 | 整份新文件 |
| 写入方式 | 逐条 y/n/e 确认后写 | 批量生成后写入，只新增不覆盖，最后给总览 |
| 写已有文件 | 会改 | 一律不碰 |

## 2. 已定决策

以下决策由用户在设计阶段确认，实现时不再重议：

1. **产物范围**：`CLAUDE.md` + `docs/context/*.md`。memory 仅当会话里挖到 `user` / `feedback` 类知识时才写。**不写**项目级 skill。
2. **确认粒度**：整体生成后一次性写入，最后给总览。不逐条确认、不按文件确认。安全性由「只新增不覆盖」保证。
3. **已有资产**：目标文件已存在就跳过，一个字不改；已有内容读进来当第四个信息源。
4. **打包方式**：独立 skill 目录 `skills/context-init/`；新增脚本放进 `skills/context-curator/` 这个自包含工具箱；会话挖掘复用现有 `harvest.js` 与 `paths.js`。

## 3. 铁律（初始化版）

1. **不覆盖任何已有文件。** SKILL 层：目标路径存在即跳过并进报告。脚本层：本插件仍然没有任何脚本有能力写 `CLAUDE.md`、`docs/` 或 memory，新增的探测脚本只读项目、只输出 JSON。
2. **无出处不写。** 生成文件里每一段、每一条都必须能指到三者之一：PRD 章节、代码路径、会话文件+行号。三者都指不到就不写。唯一例外是 `CLAUDE.md` 项目声明里实在填不出的字段，写「待定」并列进报告。
3. **事实与规则分层。** PRD 与代码的事实进 `docs/context/`；只有用户原话（会话）或配置文件（lint、analysis_options 等）能证明的约束才进 `CLAUDE.md`。

## 4. 入口

### 4.1 命令

`commands/init.md` 提供 `/context-curator:init`，参数：

```
/context-curator:init [PRD路径] [--dry-run] [--sessions N]
```

- `PRD路径`：可选。本地 `.md` / `.txt` / `.pdf` 文件路径。不给则询问一次；用户说没有就跳过 PRD。
- `--dry-run`：只探测、只分析、把每个将写入文件的完整内容打印出来，不写盘。
- `--sessions N`：精读的会话数上限，默认 10。

### 4.2 自然语言触发

SKILL.md 的 description 覆盖：「初始化上下文」「初始化项目上下文资产」「接手这个项目」「从 PRD 建 CLAUDE.md」「给这个项目建 CLAUDE.md」「bootstrap context」「init context assets」。

### 4.3 PRD 是链接时

给的是飞书 / Lark / 其他 URL：提示用户先导出为本地文件，或用已装的文档读取 skill（lark-doc、feishu-docs）读成本地 md 再来。**本 skill 不自动调用其他插件**。

## 5. 四个信息源

| 源 | 取法 | 缺失时 |
|---|---|---|
| PRD | 主会话用 Read 读文件（pdf 走 pages 参数）；派一个子 agent 做结构化摘要 | 不生成 `product.md`；`CLAUDE.md` 项目一句话改从 README 取 |
| 源码 | 先跑 `profile-project.js` 拿确定性事实，再派子 agent 按顶层目录分片精读入口与关键文件 | 不可能缺失（就是当前目录）；不是 git 仓库、没有 manifest 时事实变少 |
| 历史会话 | `paths.findProjectDir(cwd)` 定位会话目录，`harvest.js` 粗筛排序，取前 N 个 `score ≥ 5` 的会话，子 agent 每 2-3 个一批精读 | 不生成 `decisions.md`；不写 memory |
| 已有资产 | `CLAUDE.md`、`AGENTS.md`、`README.md`、`docs/**/*.md`、`.claude/rules/`、memory 目录，全部读进来 | 无 |

已有资产的用途只有两个：避免生成重复内容；让 `CLAUDE.md`（若本次生成）的指针表指向已有文档而不是再写一份。

## 6. 项目探测脚本 `profile-project.js`

位置：`skills/context-curator/bin/profile-project.js`，逻辑在 `skills/context-curator/lib/profile.js`。纯 Node 内置模块，零依赖，任何失败都 `exit 0` 并输出 `{}`。

用法：

```
node profile-project.js [项目根目录] [--pretty]
```

默认根目录为 `process.cwd()`。输出单个 JSON：

```jsonc
{
  "root": "/abs/path",
  "generated_at": "2026-09-08T06:00:00Z",
  "truncated": false,                  // 文件数超过 20000 时为 true，统计不完整
  "git": {
    "is_repo": true, "branch": "main", "remote": "git@...", "head": "abc1234",
    "commit_count": 123, "first_commit": "2025-01-02", "last_commit": "2026-09-01",
    "contributors": 3
  },                                    // 不是仓库或 git 不可用时 { "is_repo": false }
  "manifests": [
    { "file": "package.json", "name": "...", "version": "...",
      "scripts": { "test": "...", "build": "..." },
      "dependencies": ["react", "..."], "dev_dependencies": ["..."] },
    { "file": "pubspec.yaml", "name": "...", "version": "...",
      "sdk": ">=3.0.0", "flutter": true,
      "dependencies": ["..."], "dev_dependencies": ["..."] },
    { "file": "go.mod", "module": "...", "go": "1.22" },
    { "file": "pyproject.toml", "name": "...", "version": "..." },
    { "file": "Cargo.toml", "name": "...", "version": "..." },
    { "file": "pom.xml", "group_id": "...", "artifact_id": "..." },
    { "file": "build.gradle.kts", "application_id": "..." }
    // 其他仅记 file
  ],
  "languages": [ { "name": "Dart", "files": 312 }, { "name": "Kotlin", "files": 8 } ],
  "tree": [
    { "name": "lib", "type": "dir", "files": 312,
      "children": ["features", "core", "shared"] },
    { "name": "pubspec.yaml", "type": "file" }
  ],                                    // 只列顶层；children 是二级目录名，最多 30 个
  "entrypoints": ["lib/main.dart", "bin/cli.dart"],
  "suggested_commands": [
    { "kind": "test", "cmd": "flutter test", "source": "pubspec.yaml: flutter 依赖" },
    { "kind": "build", "cmd": "npm run build", "source": "package.json scripts.build" }
  ],
  "tooling": {
    "tests": ["test/", "integration_test/"],
    "ci": [".github/workflows/ci.yml"],
    "lint": ["analysis_options.yaml", ".editorconfig"],
    "docker": ["Dockerfile"],
    "env_example": [".env.example"]
  },
  "context_assets": {
    "CLAUDE.md": { "exists": true, "lines": 412 },
    "AGENTS.md": { "exists": false },
    "README.md": { "exists": true, "lines": 80 },
    "docs": ["docs/api.md", "docs/context/architecture.md"],   // 递归深度 2，最多 50 个 md
    "claude_dir": { "rules": ["..."], "skills": ["..."], "commands": ["..."], "settings": true },
    "other_ai_rules": [".cursorrules"],
    "memory": { "dir": "/abs/.claude/projects/<slug>/memory", "files": ["MEMORY.md"] }
  },
  "sessions": {
    "dir": "/abs/.claude/projects/<slug>", "count": 19,
    "curator": { "initialized_at": null, "pending": 4, "done": 12 }
  }
}
```

实现要点：

- **忽略目录**固定清单：`.git node_modules build dist out target .dart_tool .idea .vscode .gradle .next .nuxt coverage __pycache__ .venv venv Pods DerivedData .pub-cache vendor .cache tmp .tmp ephemeral`。不解析 `.gitignore`。
- **语言统计**按扩展名计文件数，不数行（大仓库数行太慢）。扩展名映射表覆盖 Dart / JS / TS / Python / Go / Rust / Java / Kotlin / Swift / Objective-C / Ruby / PHP / C# / C / C++ / Vue / Scala / Shell / Lua。
- **manifest 解析**只做能用正则或逐行扫描稳妥拿到的字段：`package.json` 用 `JSON.parse`；`pubspec.yaml` 用缩进扫描取 `dependencies:` / `dev_dependencies:` 下的顶层键；其余用正则取名字与版本。解析失败只丢字段，不丢整条。
- **入口识别**为固定候选清单的存在性检查：`lib/main.dart`、`bin/*.dart`、`main.go`、`cmd/*/main.go`、`src/index.{js,ts}`、`src/main.{js,ts,tsx}`、`index.js`、`app.py`、`main.py`、`manage.py`、`src/main.rs`，外加 `package.json` 的 `main` / `bin`。
- **命令推断**是规则表，每条带 `source`：`package.json` 有 `scripts.X` 就出 `npm run X`（`packageManager` 指明 pnpm / yarn 时换前缀）；pubspec 含 flutter 出 `flutter test` / `flutter run` / `dart analyze`，否则 `dart test`；`go.mod` 出 `go test ./...` / `go build ./...`；`Cargo.toml` 出 `cargo test` / `cargo build`；pyproject 出 `pytest`（仅当 dev 依赖或 `[tool.pytest]` 出现）。
- **git** 通过 `execFileSync('git', ...)` 取，加 `timeout: 3000`，任何失败退化为 `{ is_repo: false }`。
- **memory 与 sessions** 复用 `lib/paths.js`：`findProjectDir(root)` 找到会话目录，memory 目录为其下 `memory/`，curator 状态从 `store.readState` / `readQueue` 取。找不到会话目录时 `sessions` 为 `{ "dir": null, "count": 0 }`，`memory` 为 `{ "dir": null, "files": [] }`。

## 7. 产物

所有产物都是**新文件**。生成前先查 `context_assets`，目标已存在就跳过。

### 7.1 `CLAUDE.md`（60-100 行）

```
# <项目名>

<一句话：做什么、给谁用>                        ← PRD §x 或 README

## 技术栈与命令
<语言 / 框架 / 版本>                             ← manifests
<测试 / 构建 / 运行 / lint 命令，每条一行>         ← suggested_commands

## 目录导览
<3-8 行，只列会经常进的目录，每行一句话>          ← tree + 代码 agent

## 本项目约定
<只收有证据的，每条末尾标出处：会话 <id>:<行> / <配置文件>>

## 深入阅读
| 主题 | 文件 |
| 产品与需求 | docs/context/product.md |
| 架构 | docs/context/architecture.md |
| 决策与踩坑 | docs/context/decisions.md |
| 术语 | docs/context/glossary.md |
<已有 docs 里相关的也列进来>

## 当前状态
<阶段、未完成项、已知问题>                        ← product.md 对照表 + 会话
```

CLAUDE.md 已存在时整份跳过，报告里建议用户在其中加一行指向 `docs/context/`，或交给 `/curate`。

### 7.2 `docs/context/product.md`

来源：PRD。没有 PRD 不生成。

- 产品目标、目标用户、核心场景
- 功能清单（按 PRD 章节顺序）
- 业务规则与边界条件
- 非功能要求
- **PRD ↔ 代码对照表**：功能 / 状态（已实现 · 部分 · 未实现 · 代码有但 PRD 没提）/ 代码位置 / 依据。代码 agent 拿不准的标「待核实」

每节标注 PRD 章节或页码。

### 7.3 `docs/context/architecture.md`

来源：代码。

- 模块划分（按顶层目录）
- 分层与依赖方向
- 数据流（请求 → 处理 → 存储，或界面 → 状态 → 数据）
- 入口与启动链
- 外部依赖与三方服务
- 构建、测试、发布方式

每条标注代码路径。已有 `docs/` 里有同主题文档时，本文件对应小节改为一行指针。

### 7.4 `docs/context/decisions.md`

来源：会话。没有可用会话不生成。

按时间倒序，每条：

```
### <一句话结论>
- 时间：<会话日期>
- 类型：决策 / 踩坑 / 纠正 / 约定
- 证据：会话 <session_id> 第 <行> 行，你说「<原话>」
- 现状：<代码 agent 核对后的状态：仍然成立 / 已变化 / 待核实>
```

### 7.5 `docs/context/glossary.md`

来源：PRD + 代码。两者都有时生成对照表（PRD 名词 / 代码标识符 / 含义 / 出处）；只有其一时生成单列术语表；两者都没有可用术语时不生成。

### 7.6 memory（按需）

仅当会话 agent 返回 `user` / `feedback` 类知识。写到 `context_assets.memory.dir` 下，一条一个文件，frontmatter 格式见 context-init `SKILL.md` 第 8 步；`MEMORY.md` 加一行索引。目标文件名已存在就跳过。

### 7.7 生成文件的页脚

每个生成的文件末尾：

```
> 由 /context-curator:init 于 <日期> 生成。来源：PRD <文件名> · 代码 <分支>@<短 commit> · 会话 <N> 个。此后由项目负责人维护，可用 /curate 持续更新。
```

## 8. 执行流程（SKILL.md 的步骤骨架）

0. **定位脚本目录 `$CCH`**：本 skill 的 base directory 上一级的 `context-curator/`；找不到时用与现有 SKILL.md 相同的探测命令。探测不到就告知安装不完整并停止。
1. **解析参数**：PRD 路径、`--dry-run`、`--sessions N`。
2. **探测项目**：`node "$CCH"/bin/profile-project.js . --pretty`。输出 `{}` 或缺 `root` 时降级：主会话自己 `ls` 顶层，事实变少，报告标注。
3. **读入已有资产**：按 `context_assets` 清单读。
4. **读 PRD**：Read 文件。URL 按 §4.3 处理。
5. **粗筛会话**：`node "$CCH"/bin/harvest.js <sessions.dir> --min-score 5`，取前 N 个。
6. **并行精读**（子 agent，主会话不读原始 jsonl、不通读源码）：
   - 代码 agent：含源码文件的顶层目录（`tree` 中 `files > 0`，排除 docs / test 类目录）≤ 3 个时一个 agent，否则按顶层目录分给最多 4 个。返回架构事实，每条带路径；同时接收 PRD 功能清单，回填对照表状态。
   - PRD agent：返回结构化摘要与术语表，每条带章节。
   - 会话 agent：每 2-3 个会话一个。返回 `{类型, 内容, 证据:{文件, 行号, 原话}}`，明确告知宁缺毋滥；额外返回 `user` / `feedback` 类候选。
7. **交叉对照**：功能 ↔ 模块；PRD 术语 ↔ 代码标识符；会话约定 ↔ 代码现状，冲突的标「已变化」或「待核实」。
8. **过滤**：丢掉读代码就知道的细节（函数签名）、git 历史已有的、只对当次对话有意义的、已有资产里已写的。无出处的一律丢。
9. **生成与写入**：按 §7 模板组装。`--dry-run` 只打印。目标存在跳过。写入用 Write 工具，脚本不参与。
10. **记状态**：`state.json` 写 `initialized_at`（通过新增的 `state.js init-done <CC>` 子命令）。**不动 queue**——已挖过的会话仍可被 `/curate 结算` 再看一遍，第 6 步的比对会自然去重。
11. **报告**：

```
✅ 上下文资产初始化完成

信息源
  PRD      docs/prd.md（12 节）
  代码     Dart 312 文件 · main@abc1234
  会话     精读 8 / 共 19
  已有资产 README.md（读入，未改）

写入
  CLAUDE.md                      86 行
  docs/context/product.md        对照表 23 项：已实现 14 · 部分 5 · 未实现 3 · PRD 未提 1
  docs/context/architecture.md   6 个模块
  docs/context/decisions.md      11 条
  docs/context/glossary.md       18 个术语
  memory/                        2 条（feedback ×2）

跳过（已存在，未改）
  docs/architecture.md → 已在 CLAUDE.md 指针表里引用

⚠️ 待你处理
  - CLAUDE.md 项目声明「目标用户」填不出，PRD 未提
  - decisions.md 第 3 条与当前代码冲突，标了待核实

下一步：攒几个会话后跑 /curate 结算 持续养护。
```

## 9. 错误处理

| 情况 | 处理 |
|---|---|
| 不是 git 仓库 / 没有 manifest | 照常跑，`git` 与 `manifests` 为空，`CLAUDE.md` 技术栈段按代码 agent 观察填，报告标注 |
| 没有会话记录 | 跳过 `decisions.md` 与 memory，报告说明「这个项目还没有会话记录」 |
| 没有 PRD | 跳过 `product.md`，术语表退化为代码单列，报告说明 |
| PRD 是 URL | 提示导出或用文档 skill 读成本地文件后重跑，本次停止 |
| 探测脚本失败 | 输出 `{}`，skill 降级手动 `ls`，报告标注「探测降级」 |
| 会话 agent 返回为空 | 不硬编，跳过对应文件 |
| 所有目标文件都已存在 | 报告「没有可新增的文件」，建议 `/curate 全量`，不写任何东西 |

## 10. 测试

- `test/profile.test.js`：用 `tmpDir()` 造 fixture 项目。覆盖：`package.json` 解析（scripts / deps / packageManager 换前缀）；`pubspec.yaml` 缩进扫描与 flutter 判定；`go.mod` / `Cargo.toml` / `pyproject.toml` 正则；语言统计与忽略目录（`node_modules` 里的文件不计）；顶层 tree 与 children 上限；入口识别；`context_assets`（CLAUDE.md 行数、docs 递归、`.claude/` 子目录）；损坏的 `package.json` 不崩、只丢字段；`truncated` 阈值可注入以便测试。
- `test/bins.test.js` 追加：`profile-project.js` 目录不存在退出 0 且输出 `{}`；`--pretty` 输出多行；`state.js init-done` 写入 `initialized_at`。
- `test/store.test.js` 追加：`markInitialized` 幂等、不动 `rejected` 与队列。
- 保持无参 `node --test`、零依赖、`test/helpers.js` 无顶层副作用。
- 手工验收：在一个真实项目上跑 `/context-curator:init <prd> --dry-run`，检查每段都有出处、目标存在的文件确实被跳过。

## 11. 文件清单

新增：

```
skills/context-init/SKILL.md                 主体流程
skills/context-init/templates/claude.template.md        五份模板（不叫 CLAUDE.md，避免被当成真资产加载）
skills/context-init/templates/product.template.md
skills/context-init/templates/architecture.template.md
skills/context-init/templates/decisions.template.md
skills/context-init/templates/glossary.template.md
skills/context-curator/lib/profile.js        项目探测逻辑
skills/context-curator/bin/profile-project.js  CLI 入口
skills/context-curator/test/profile.test.js
commands/init.md                             /context-curator:init
```

修改：

```
skills/context-curator/lib/store.js          + markInitialized
skills/context-curator/bin/state.js          + init-done 子命令
skills/context-curator/test/bins.test.js     + 3 个用例
skills/context-curator/test/store.test.js    + 1 个用例
README.md                                    + 「初始化」章节、文件表、Codex 安装两个目录一起链
AGENTS.md                                    + 结构约定：context-init 依赖 context-curator 工具箱；脚本不写资产的铁律同样适用
.claude-plugin/plugin.json                   version 1.0.0 → 1.1.0，description 提一句初始化
.codex-plugin/plugin.json                    同上
```

## 12. 不做的事

- 不写项目级 skill / commands。
- 不改、不删、不备份任何已有文件（没有覆盖就不需要备份）。
- 不自动调用飞书等文档读取插件。
- 不解析 `.gitignore`，不数代码行数。
- 不做多语言 PRD 翻译；PRD 什么语言，`product.md` 就什么语言。
